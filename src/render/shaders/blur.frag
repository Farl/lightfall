#version 300 es
// Separable 9-tap Gaussian. Also used as the downsample step (uDir = 0 just resamples
// with bilinear filtering into the smaller target).
precision highp float;

uniform sampler2D uSrc;
uniform vec2 uRes;   // target size
uniform vec2 uDir;   // texel step in source uv, (0,0) for plain resample

out vec4 outColor;

const float W[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture(uSrc, uv).rgb * W[0];
  for (int i = 1; i < 5; i++) {
    c += texture(uSrc, uv + uDir * float(i)).rgb * W[i];
    c += texture(uSrc, uv - uDir * float(i)).rgb * W[i];
  }
  outColor = vec4(c, 1.0);
}
