/**
 * Minimal WebGL2 layer: fullscreen-triangle passes whose uniforms are set by name
 * from a plain object, with types read back from the linked program.
 */

export type UniformValue = number | boolean | ArrayLike<number> | WebGLTexture;

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

interface UniformInfo {
  loc: WebGLUniformLocation;
  type: number;
}

export class Pass {
  private program: WebGLProgram;
  private uniforms = new Map<string, UniformInfo>();

  constructor(private gl: WebGL2RenderingContext, fragment: string) {
    this.program = link(gl, FULLSCREEN_VS, fragment);
    const count = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(this.program, i)!;
      // Arrays report as "name[0]"; the base location takes the whole flattened array.
      this.uniforms.set(info.name.replace(/\[0\]$/, ''), { loc: gl.getUniformLocation(this.program, info.name)!, type: info.type });
    }
  }

  /** Draw into `target` (null = canvas). Unknown/optimised-out uniform names are ignored. */
  run(target: RenderTarget | null, size: { width: number; height: number }, values: Record<string, UniformValue>) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);
    gl.viewport(0, 0, size.width, size.height);
    gl.useProgram(this.program);
    let unit = 0;
    for (const [name, value] of Object.entries(values)) {
      const u = this.uniforms.get(name);
      if (!u) continue;
      if (value instanceof WebGLTexture) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.uniform1i(u.loc, unit++);
      } else {
        setUniform(gl, u, value);
      }
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function setUniform(gl: WebGL2RenderingContext, u: UniformInfo, value: number | boolean | ArrayLike<number>) {
  const v = typeof value === 'object' ? Array.from(value) : [Number(value)];
  switch (u.type) {
    case gl.FLOAT: return gl.uniform1fv(u.loc, v);
    case gl.FLOAT_VEC2: return gl.uniform2fv(u.loc, v);
    case gl.FLOAT_VEC3: return gl.uniform3fv(u.loc, v);
    case gl.FLOAT_VEC4: return gl.uniform4fv(u.loc, v);
    case gl.INT:
    case gl.BOOL: return gl.uniform1iv(u.loc, v.map(Math.round));
    default: throw new Error(`Unsupported uniform type 0x${u.type.toString(16)}`);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
  return s;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program link failed');
  return p;
}

export function createTexture(gl: WebGL2RenderingContext, filter: number) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Upload a canvas as raw bytes: no color-space conversion, no premultiply, row 0 at the bottom. */
export function uploadCanvas(gl: WebGL2RenderingContext, tex: WebGLTexture, source: HTMLCanvasElement) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}

/** HDR (half float) target when the GPU can render to it, otherwise 8-bit. */
export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, filter: number, hdr: boolean): RenderTarget {
  const tex = createTexture(gl, filter);
  if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { fbo, tex, width, height };
}
