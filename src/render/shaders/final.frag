#version 300 es
// Film-style post: chromatic aberration -> bloom + soft focus -> ACES -> grade ->
// vignette -> grain, then blend with the untouched painting by uIntensity.
precision highp float;

#define MODE_GRADED 0
#define MODE_RAW 1
#define MODE_ALBEDO 2

uniform sampler2D uScene;   // HDR lit scene, scene res, nearest
uniform sampler2D uBlur;    // blurred HDR scene, linear
uniform sampler2D uAlbedo;  // the original painting
uniform vec2 uRes;          // output size
uniform vec2 uSceneRes;
uniform int uMode;
uniform float uIntensity;
uniform float uTime;

uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uTemperature;
uniform float uVignette;
uniform float uBloom;
uniform float uBloomThreshold;
uniform float uSoftFocus;
uniform float uChromatic;   // max offset in scene pixels at the corners
uniform float uGrain;

out vec4 outColor;

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 original = texture(uAlbedo, uv).rgb;
  if (uMode == MODE_ALBEDO) { outColor = vec4(original, 1.0); return; }
  if (uMode == MODE_RAW) { outColor = vec4(pow(clamp(texture(uScene, uv).rgb, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0); return; }

  // Radial chromatic aberration: red pushed out, blue pulled in.
  vec2 off = (uv - 0.5) * 2.0 * uChromatic / uSceneRes;
  vec3 c = vec3(texture(uScene, uv + off).r, texture(uScene, uv).g, texture(uScene, uv - off).b);

  vec3 blur = texture(uBlur, uv).rgb;
  c = mix(c, blur, uSoftFocus);
  c += max(blur - uBloomThreshold, 0.0) * uBloom;

  c = aces(c * exp2(uExposure));
  c = pow(c, vec3(1.0 / 2.2));

  c = c * uGain + uLift * (1.0 - c);
  c = (c - 0.5) * uContrast + 0.5;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, uSaturation);
  c *= vec3(1.0 + uTemperature, 1.0, 1.0 - uTemperature);

  vec2 q = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  c *= mix(1.0, smoothstep(1.05, 0.2, length(q)), uVignette);

  // Grain stronger in midtones, re-rolled every frame.
  float g = hash12(gl_FragCoord.xy + fract(uTime) * 1000.0) - 0.5;
  c += g * uGrain * (1.0 - abs(luma - 0.5));

  outColor = vec4(mix(original, clamp(c, 0.0, 1.0), uIntensity), 1.0);
}
