// WebGL2 rendering for the photo editor.
//   pass 1: geometry (rotate/flip/straighten/crop via one matrix) + color adjustments + filter matrix
//   pass 2: sharpness, definition, noise reduction, vignette (need neighboring pixels)
// Works at any output size, so the same code renders the live preview and the full-size export.

import { outputToSource } from './geometry.js';
import { effectiveParams } from './state.js';

const VS = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = vec2((pos.x + 1.0) * 0.5, (1.0 - pos.y) * 0.5); // uv origin = top-left of the output
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FS_COLOR = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D src;
uniform mat3 toSource;
uniform float exposure, brilliance, highlights, shadows, contrast, brightness, blackPoint;
uniform float saturation, vibrance, warmth, tint;
uniform mat3 colorMatrix;

vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toGamma(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 tone(vec3 c, float amount, float weight) {
  // Push toward white (amount > 0) or toward black (amount < 0), scaled by a luminance mask.
  return c + amount * weight * (amount > 0.0 ? (1.0 - c) : c);
}

void main() {
  vec2 s = (toSource * vec3(uv, 1.0)).xy;
  vec3 c = texture(src, s).rgb;

  c = toGamma(toLinear(c) * exp2(exposure * 1.5));

  float sh = shadows + brilliance * 0.6;
  float hi = highlights - brilliance * 0.45;
  float l = luma(c);
  c = tone(c, hi * 0.6, smoothstep(0.45, 1.0, l));
  l = luma(c);
  c = tone(c, sh * 0.6, 1.0 - smoothstep(0.0, 0.55, l));

  c = pow(max(c, 0.0), vec3(exp2(-brightness * 0.8)));

  float k = contrast - brilliance * 0.12;
  c = (c - 0.5) * (1.0 + k * (k > 0.0 ? 1.0 : 0.8)) + 0.5;

  if (blackPoint > 0.0) { float t = blackPoint * 0.18; c = (c - t) / (1.0 - t); }
  else { float t = -blackPoint * 0.18; c = c * (1.0 - t) + t; }

  l = luma(c);
  c = mix(vec3(l), c, 1.0 + saturation);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, 1.0 + vibrance * (1.0 - clamp(sat, 0.0, 1.0)) * 1.2);

  c.r += warmth * 0.08 + tint * 0.03;
  c.b += -warmth * 0.08 + tint * 0.03;
  c.g -= tint * 0.08;

  c = clamp(c, 0.0, 1.0) * colorMatrix;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const FS_DETAIL = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D img;
uniform vec2 texel;
uniform float sharpness, definition, noise, vignette, aspect;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 at(vec2 p) { return texture(img, vec2(p.x, 1.0 - p.y)).rgb; } // pass-1 texture rows are bottom-up

void main() {
  vec3 c = at(uv);
  if (sharpness > 0.0 || noise > 0.0) {
    vec3 b = (at(uv + vec2(texel.x, 0.0)) + at(uv - vec2(texel.x, 0.0)) + at(uv + vec2(0.0, texel.y)) + at(uv - vec2(0.0, texel.y))
            + at(uv + texel) + at(uv - texel) + at(uv + vec2(texel.x, -texel.y)) + at(uv + vec2(-texel.x, texel.y))) / 8.0;
    float edge = smoothstep(0.02, 0.15, length(c - b));
    c = mix(c, b, noise * 0.85 * (1.0 - edge));
    c += sharpness * 1.4 * (c - b);
  }
  if (definition != 0.0) {
    float r = 0.012 * min(1.0 / texel.x, 1.0 / texel.y);
    vec2 d = texel * r;
    vec3 big = (at(uv + vec2(d.x, 0.0)) + at(uv - vec2(d.x, 0.0)) + at(uv + vec2(0.0, d.y)) + at(uv - vec2(0.0, d.y))
              + at(uv + d * 0.7) + at(uv - d * 0.7) + at(uv + vec2(d.x, -d.y) * 0.7) + at(uv + vec2(-d.x, d.y) * 0.7)) / 8.0;
    c += definition * 0.9 * vec3(luma(c) - luma(big));
  }
  if (vignette != 0.0) {
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0) * 2.0;
    float f = smoothstep(0.35, 1.25, length(p));
    c = vignette > 0.0 ? c * (1.0 - vignette * 0.75 * f) : mix(c, vec3(1.0), -vignette * 0.6 * f);
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader error: ${gl.getShaderInfoLog(s)}`);
  return s;
}

function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Link error: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const { name } = gl.getActiveUniform(p, i); uniforms[name] = gl.getUniformLocation(p, name); }
  return { p, u: uniforms };
}

export class Renderer {
  /** canvas: the element to draw into (its pixel size is set on each render). */
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('This browser does not support WebGL 2, which the editor needs.');
    this.gl = gl;
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.color = program(gl, FS_COLOR);
    this.detail = program(gl, FS_DETAIL);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.source = null;
    this.fbo = gl.createFramebuffer();
    this.fboTex = null;
    this.fboSize = [0, 0];
  }

  /** Upload the image (ImageBitmap/canvas). Must fit maxTexture on both sides. */
  setSource(image) {
    const gl = this.gl;
    if (this.source) gl.deleteTexture(this.source);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.source = tex;
    this.srcW = image.width;
    this.srcH = image.height;
  }

  ensureFbo(w, h) {
    const gl = this.gl;
    if (this.fboTex && this.fboSize[0] === w && this.fboSize[1] === h) return;
    if (this.fboTex) gl.deleteTexture(this.fboTex);
    this.fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    this.fboSize = [w, h];
  }

  /**
   * Render `state` at width×height into the canvas. Geometry is taken from `state`; pass a
   * modified state (e.g. full crop) to show the uncropped frame while cropping.
   */
  render(state, width, height) {
    const gl = this.gl;
    if (!this.source) return;
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    const { adjust, matrix } = effectiveParams(state);
    const M = outputToSource(state, this.srcW, this.srcH);

    // pass 1 → framebuffer texture
    this.ensureFbo(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.color.p);
    const u = this.color.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.uniform1i(u.src, 0);
    // mat3 uniforms are column-major: transpose the row-major affine matrix.
    gl.uniformMatrix3fv(u.toSource, false, [M[0], M[3], 0, M[1], M[4], 0, M[2], M[5], 1]);
    for (const k of ['exposure', 'brilliance', 'highlights', 'shadows', 'contrast', 'brightness', 'blackPoint', 'saturation', 'vibrance', 'warmth', 'tint']) gl.uniform1f(u[k], adjust[k]);
    // GLSL `c * colorMatrix` dots c with each column, so column i must hold row i of our row-major
    // matrix: the column-major upload of the row-major array does exactly that.
    gl.uniformMatrix3fv(u.colorMatrix, false, matrix);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 2 → canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.detail.p);
    const d = this.detail.u;
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.uniform1i(d.img, 0);
    gl.uniform2f(d.texel, 1 / width, 1 / height);
    gl.uniform1f(d.sharpness, Math.max(0, adjust.sharpness));
    gl.uniform1f(d.noise, Math.max(0, adjust.noise));
    gl.uniform1f(d.definition, adjust.definition);
    gl.uniform1f(d.vignette, adjust.vignette);
    gl.uniform1f(d.aspect, width / height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** RGBA pixels of the current canvas, top row first. */
  readPixels() {
    const gl = this.gl;
    const { width: w, height: h } = this.canvas;
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const out = new Uint8Array(buf.length);
    const row = w * 4;
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return out;
  }

  destroy() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
