#version 300 es
// Deferred lighting over a 2D painting.
//
// Inputs are Canvas2D layers (albedo, depth, normal, emissive) rasterised from the
// authored 2.5D proxy data. Per pixel we rebuild the world position from depth,
// then trace shadow rays analytically against the aperture (the one opening the
// light comes through), the proxy boxes, and flat cut-out layers (tree silhouettes,
// window tracery) whose textures are sampled where the ray crosses them.
// No meshes, no shadow maps: the scene is small enough to loop over every box.
precision highp float;
precision highp sampler2DArray;

// Array sizes, injected from RENDER in config.ts.
#define MAX_PANES __MAX_PANES__
#define MAX_BOXES __MAX_BOXES__
#define MAX_LAMPS __MAX_LAMPS__
#define MAX_OCCLUDERS __MAX_OCCLUDERS__
#define MAX_SHADOW_SAMPLES __MAX_SHADOW_SAMPLES__
#define MAX_BEAM_STEPS __MAX_BEAM_STEPS__

#define VIEW_FINAL 0
#define VIEW_DEPTH 2
#define VIEW_NORMAL 3
#define VIEW_DIRECT 4

uniform sampler2D uAlbedo;
uniform sampler2D uDepth;
uniform sampler2D uNormal;
uniform sampler2D uEmissive;   // R sky, G lamp, B tv coverage
uniform sampler2D uDust;
uniform sampler2DArray uOccluders;  // solid coverage per cut-out layer (mipmapped; level = sun-disc blur)

uniform vec2 uRes;
uniform vec2 uCenter;
uniform vec4 uCam;          // x, y, dist, focal  (mirrors camera.ts)
uniform vec2 uDepthRange;   // 1/w at far, 1/w at near
uniform float uRoomNear;    // z where the scene shell starts (beam march start)

uniform vec3 uToLight;
uniform vec3 uLightColor;
uniform float uSunSoftness;
uniform int uShadowSamples;
uniform float uNormalBias;

uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform vec3 uBounce;

// Planes: axis 0 -> x = at, (u, v) = (z, y); 1 -> y = at, (x, z); 2 -> z = at, (x, y).
uniform int uApertureAxis;
uniform float uApertureAt;
uniform int uPaneCount;
uniform vec4 uPanes[MAX_PANES];   // u0, v0, u1, v1
uniform int uOccluderCount;
uniform vec2 uOccluderPlane[MAX_OCCLUDERS];  // axis, at
uniform vec4 uOccluderRect[MAX_OCCLUDERS];   // (u, v) area its texture covers
uniform vec3 uOccluderBlur[MAX_OCCLUDERS];   // texels of blur per unit distance, wind amplitude, wind speed
uniform float uPhaseG;            // Henyey-Greenstein anisotropy of the air (0 = isotropic, >0 = glows toward the light)
uniform vec3 uSun;                // visible sun in the sky: disc gain, disc sharpness, halo gain
uniform int uBoxCount;
uniform vec3 uBoxMin[MAX_BOXES];
uniform vec3 uBoxMax[MAX_BOXES];

uniform int uLampCount;
uniform vec3 uLampPos[MAX_LAMPS];
uniform vec3 uLampColor;          // already scaled by lamp level
uniform float uLampFalloff;
uniform vec3 uLampEmit;
uniform vec3 uTvEmit;
uniform float uTvFlicker;

uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform vec2 uSkyRange;           // y range the sky gradient spans

uniform float uTime;
uniform int uDirect;
uniform int uBeam;
uniform int uFog;
uniform int uDustOn;
uniform int uBeamSteps;
uniform float uBeamDensity;
uniform float uShaftScale;
uniform float uShaftAmount;
uniform float uFogDensity;
uniform float uFogHeightFalloff;
uniform float uFogDrift;
uniform vec3 uFogColor;
uniform float uDustLitGain;
uniform float uDustAmbientGain;
uniform int uView;

out vec4 outColor;

// ------------------------------------------------------------------ noise

// Interleaved gradient noise: cheap per-pixel jitter that reads as dithering at pixel scale.
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

// ------------------------------------------------------------- visibility

bool blocked(vec3 o, vec3 d, float tMax) {
  vec3 dd = mix(d, vec3(1e-6), vec3(lessThan(abs(d), vec3(1e-6))));
  vec3 inv = 1.0 / dd;
  for (int i = 0; i < MAX_BOXES; i++) {
    if (i >= uBoxCount) break;
    vec3 t0 = (uBoxMin[i] - o) * inv, t1 = (uBoxMax[i] - o) * inv;
    vec3 tn = min(t0, t1), tf = max(t0, t1);
    float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
    // a > 0 skips boxes containing the origin, so foliage blobs inside their own shadow proxy still get lit.
    if (a > 0.0 && b > a && a < tMax) return true;
  }
  return false;
}

float axisOf(vec3 p, int a) { return a == 0 ? p.x : (a == 1 ? p.y : p.z); }
vec2 planeUv(vec3 q, int a) { return a == 0 ? q.zy : (a == 1 ? q.xz : q.xy); }

// Wind sway (u offset) of a layer at height v; mirrors windOffset() in lighting.ts.
float windOffset(float v, vec3 blur) { return blur.y * sin(uTime * blur.z + v * 0.9); }

// Fraction of light that gets through every cut-out layer between `o` and the aperture.
// Each gap is a pinhole: its spot is the sun disc, blurred by distance * softness,
// which is what the mip level of a box-filtered coverage texture approximates.
float occluderTransmit(vec3 o, vec3 L, float tMax) {
  float transmit = 1.0;
  for (int i = 0; i < MAX_OCCLUDERS; i++) {
    if (i >= uOccluderCount) break;
    int axis = int(uOccluderPlane[i].x);
    float la = axisOf(L, axis);
    if (abs(la) < 1e-4) continue;
    float t = (uOccluderPlane[i].y - axisOf(o, axis)) / la;
    // Skip crossings at the origin: a ray starting on a painted layer must not shadow itself.
    if (t <= 0.02 || t >= tMax) continue;
    vec2 uv = planeUv(o + L * t, axis);
    vec3 blur = uOccluderBlur[i];
    uv.x += windOffset(uv.y, blur);
    vec4 r = uOccluderRect[i];
    // Texture rows grow down from the top of the rect (see rasterizeLayer).
    vec2 st = vec2((uv.x - r.x) / (r.z - r.x), (r.w - uv.y) / (r.w - r.y));
    if (any(lessThan(st, vec2(0.0))) || any(greaterThan(st, vec2(1.0)))) continue;
    float lod = log2(max(t * blur.x, 1.0));
    transmit *= 1.0 - textureLod(uOccluders, vec3(st, float(i)), lod).r;
    if (transmit <= 0.002) return 0.0;
  }
  return transmit;
}

// Light (0..1) reaching `o`: the ray toward the light has to cross the aperture inside a pane
// without hitting a box, dimmed by the cut-out layers. `hit` = (u, v) on the aperture plane.
float lightVisible(vec3 o, vec3 L, out vec2 hit) {
  hit = vec2(0.0);
  float la = axisOf(L, uApertureAxis);
  if (abs(la) < 1e-4) return 0.0;
  float t = (uApertureAt - axisOf(o, uApertureAxis)) / la;
  if (t <= 0.0) return 0.0;
  hit = planeUv(o + L * t, uApertureAxis);
  bool inside = false;
  for (int i = 0; i < MAX_PANES; i++) {
    if (i >= uPaneCount) break;
    vec4 p = uPanes[i];
    inside = inside || (hit.x >= p.x && hit.x <= p.z && hit.y >= p.y && hit.y <= p.w);
  }
  if (!inside || blocked(o, L, t)) return 0.0;
  return occluderTransmit(o, L, t);
}

// Henyey-Greenstein phase, scaled so g = 0 gives 1 (the room's isotropic look stays as it was).
float phase(float cosTheta) {
  float g = uPhaseG;
  return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
}

// Streaky "dirty glass" modulation, keyed on where the ray crosses the aperture,
// so everything lit through the same spot of glass shares it -> visible shafts.
float shaft(vec2 hit) {
  float n = vnoise(vec3(hit.x * uShaftScale, hit.y * uShaftScale * 0.35, uTime * 0.05));
  return mix(1.0, 0.35 + 1.3 * n, uShaftAmount);
}

vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }

// ------------------------------------------------------------------- main

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 albedo = srgbToLinear(texture(uAlbedo, uv).rgb);
  vec4 dep = texture(uDepth, uv);
  vec3 N = normalize(texture(uNormal, uv).rgb * 2.0 - 1.0);
  vec3 emit = texture(uEmissive, uv).rgb;
  float emitted = max(max(emit.r, emit.g), emit.b);

  // Rebuild the world position: P = camera + ray * w (see camera.ts viewRay).
  float w = 1.0 / mix(uDepthRange.x, uDepthRange.y, dep.r);
  vec2 s = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 rd = vec3((s.x - uCenter.x) / uCam.w, -(s.y - uCenter.y) / uCam.w, 1.0);
  vec3 camPos = vec3(uCam.x, uCam.y, -uCam.z);
  vec3 P = camPos + rd * w;

  float jitter = ign(gl_FragCoord.xy);
  vec3 L = normalize(uToLight);
  vec2 hit;

  // Direct light with a soft penumbra: jitter the light direction over a small disc.
  vec3 direct = vec3(0.0);
  float ndl = dot(N, L);
  if (uDirect == 1 && emitted < 1.0 && ndl > 0.0) {
    vec3 T = normalize(cross(L, abs(L.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
    vec3 B = cross(L, T);
    float vis = 0.0;
    for (int k = 0; k < MAX_SHADOW_SAMPLES; k++) {
      if (k >= uShadowSamples) break;
      float a = (float(k) + jitter) * 2.39996; // golden angle
      float r = sqrt((float(k) + 0.5) / float(uShadowSamples)) * uSunSoftness;
      vec3 Lk = normalize(L + (T * cos(a) + B * sin(a)) * r);
      vis += lightVisible(P + N * uNormalBias, Lk, hit);
    }
    direct = uLightColor * ndl * vis / float(uShadowSamples);
  }

  // Hemisphere ambient + one-bounce fill.
  vec3 ambient = mix(uAmbientGround, uAmbientSky, N.y * 0.5 + 0.5) + uBounce;

  // Ceiling lamps: point lights with a hard shadow ray each.
  vec3 lamp = vec3(0.0);
  for (int i = 0; i < MAX_LAMPS; i++) {
    if (i >= uLampCount) break;
    vec3 d = uLampPos[i] - P;
    float dist = length(d);
    vec3 l = d / dist;
    float nl = dot(N, l);
    if (nl > 0.0 && emitted < 1.0 && !blocked(P + N * uNormalBias, l, dist)) lamp += uLampColor * nl / (1.0 + uLampFalloff * dist * dist);
  }

  vec3 color = albedo * (ambient + direct + lamp);
  vec3 sky = albedo * mix(uSkyBottom, uSkyTop, clamp((P.y - uSkyRange.x) / (uSkyRange.y - uSkyRange.x), 0.0, 1.0));
  // The sun itself, seen in the sky between the silhouettes: a disc plus a wide halo.
  float toSun = max(dot(normalize(rd), L), 0.0);
  sky += uLightColor * (uSun.x * pow(toSun, uSun.y) + uSun.z * pow(toSun, 6.0));
  color = mix(color, sky, emit.r);
  color += albedo * uLampEmit * emit.g;
  color += albedo * uTvEmit * (0.85 + 0.15 * sin(uTime * uTvFlicker)) * emit.b;

  // Volumetric beam: march the camera ray from the near plane of the scene to the surface,
  // accumulating in-scattered light wherever the sample can see the light through the aperture.
  if (uBeam == 1) {
    float w0 = uCam.z + uRoomNear;
    float seg = max(w - w0, 0.0) / float(uBeamSteps);
    float acc = 0.0;
    for (int k = 0; k < MAX_BEAM_STEPS; k++) {
      if (k >= uBeamSteps) break;
      vec3 S = camPos + rd * (w0 + (float(k) + jitter) * seg);
      float v = lightVisible(S, L, hit);
      if (v > 0.0) {
        float dens = uFog == 1 ? 0.4 + 1.2 * fbm(S * 1.3 + vec3(uTime * uFogDrift, 0.0, 0.0)) : 1.0;
        acc += v * dens * shaft(hit);
      }
    }
    color += uLightColor * acc * seg * length(rd) * uBeamDensity * phase(dot(normalize(rd), L));
  }

  // Dust motes: R lit by the beam, G ambient-only.
  if (uDustOn == 1) {
    vec2 dust = texture(uDust, uv).rg;
    color += dust.r * uLightColor * uDustLitGain + dust.g * ambient * uDustAmbientGain;
  }

  // Flowing ground fog, thicker low and far.
  if (uFog == 1) {
    float h = exp(-max(P.y, 0.0) * uFogHeightFalloff);
    float n = fbm(vec3(P.x * 0.5 + uTime * uFogDrift, P.y * 1.1, P.z * 0.5 - uTime * uFogDrift * 0.5));
    float f = clamp(uFogDensity * h * n * (1.0 - exp(-w * 0.12)), 0.0, 1.0);
    color = mix(color, uFogColor, f);
  }

  if (uView == VIEW_DEPTH) color = vec3(dep.r);
  if (uView == VIEW_NORMAL) color = N * 0.5 + 0.5;
  if (uView == VIEW_DIRECT) color = direct / max(max(uLightColor.r, uLightColor.g), max(uLightColor.b, 1e-3));

  outColor = vec4(color, 1.0);
}
