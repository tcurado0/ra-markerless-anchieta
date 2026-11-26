import { PIN_META, PIN_POSITIONS_B64, PIN_NORMALS_B64, PIN_INDICES_B64 } from './pinMesh.js';
import { perspective, multiply, viewMatrix } from './math3d.js';

const VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform float uPosScale;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec4 w = uModel * vec4(aPos * uPosScale, 1.0);
  vW = w.xyz;
  vN = normalize((uModel * vec4(aNormal, 0.0)).xyz);
  gl_Position = uViewProj * w;
}`;

const FS = `
precision mediump float;
varying vec3 vN;
varying vec3 vW;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uUnlit;
uniform vec3 uEye;
void main() {
  if (uUnlit > 0.5) { gl_FragColor = vec4(uColor, uAlpha); return; }
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.0) n = -n;
  vec3 L1 = normalize(vec3(0.35, -0.25, 0.9));
  vec3 L2 = v;
  float diff = max(dot(n, L1), 0.0) * 0.65 + max(dot(n, L2), 0.0) * 0.45;
  vec3 h = normalize(L1 + v);
  float spec = pow(max(dot(n, h), 0.0), 32.0) * 0.35;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.25;
  vec3 c = uColor * (0.22 + diff) + vec3(spec) + vec3(rim);
  gl_FragColor = vec4(c, uAlpha);
}`;

function b64ToBuffer(b64) {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export class PinRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL não suportado neste aparelho.');
    this.gl = gl;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;
    this.loc = {
      aPos: gl.getAttribLocation(p, 'aPos'),
      aNormal: gl.getAttribLocation(p, 'aNormal'),
    };
    ['uModel', 'uViewProj', 'uPosScale', 'uColor', 'uAlpha', 'uUnlit', 'uEye'].forEach(
      (n) => (this.loc[n] = gl.getUniformLocation(p, n))
    );

    this.pin = {
      pos: this._buffer(gl.ARRAY_BUFFER, b64ToBuffer(PIN_POSITIONS_B64)),
      nrm: this._buffer(gl.ARRAY_BUFFER, b64ToBuffer(PIN_NORMALS_B64)),
      idx: this._buffer(gl.ELEMENT_ARRAY_BUFFER, b64ToBuffer(PIN_INDICES_B64)),
      count: PIN_META.triangleCount * 3,
      type: gl.SHORT, normalized: true, scale: PIN_META.positionScale,
    };
    this.pinColor = PIN_META.diffuse;

    const ring = [], seg = 64;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0, Math.cos(a), Math.sin(a), 0);
    }
    this.ring = { pos: this._buffer(gl.ARRAY_BUFFER, new Float32Array(ring)), count: (seg + 1) * 2 };

    const grid = [], R = 600, step = 20;
    for (let v = -R; v <= R; v += step) grid.push(v, -R, 0, v, R, 0, -R, v, 0, R, v, 0);
    this.grid = { pos: this._buffer(gl.ARRAY_BUFFER, new Float32Array(grid)), count: grid.length / 3 };

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.viewProj = null;
  }

  _buffer(target, data) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  setCamera(camQuat, camPos, fovY) {
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    this.proj = perspective(fovY, aspect, 0.3, 6000);
    this.view = viewMatrix(camQuat, camPos);
    this.viewProj = multiply(this.proj, this.view);
    this.eye = camPos;
  }

  begin() {
    const gl = this.gl;
    this.resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc.uViewProj, false, this.viewProj);
    gl.uniform3fv(this.loc.uEye, this.eye);
  }

  _bindPositions(buf, type, normalized, stride = 0) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(this.loc.aPos);
    gl.vertexAttribPointer(this.loc.aPos, 3, type, normalized, stride, 0);
  }

  drawGrid(center) {
    const gl = this.gl;

    const ox = Math.round(center[0] / 20) * 20, oy = Math.round(center[1] / 20) * 20;
    gl.uniformMatrix4fv(this.loc.uModel, false, new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, ox,oy,0,1]));
    gl.uniform1f(this.loc.uPosScale, 1);
    gl.uniform1f(this.loc.uUnlit, 1);
    gl.uniform3fv(this.loc.uColor, [1, 1, 1]);
    gl.uniform1f(this.loc.uAlpha, 0.35);
    this._bindPositions(this.grid.pos, gl.FLOAT, false);
    gl.disableVertexAttribArray(this.loc.aNormal);
    gl.vertexAttrib3f(this.loc.aNormal, 0, 0, 1);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, this.grid.count);
    gl.depthMask(true);
  }

  drawPin(pos, h, { yaw = 0, color = this.pinColor, alpha = 1 } = {}) {
    const gl = this.gl;

    let fx = this.eye[0] - pos[0], fy = this.eye[1] - pos[1];
    const l = Math.hypot(fx, fy) || 1;
    fx /= l; fy /= l;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    [fx, fy] = [fx * c - fy * s, fx * s + fy * c];
    const rx = -fy, ry = fx;
    const m = new Float32Array([
      rx * h, ry * h, 0, 0,
      0, 0, h, 0,
      fx * h, fy * h, 0, 0,
      pos[0], pos[1], pos[2], 1,
    ]);
    gl.uniformMatrix4fv(this.loc.uModel, false, m);
    gl.uniform1f(this.loc.uPosScale, this.pin.scale);
    gl.uniform1f(this.loc.uUnlit, 0);
    gl.uniform3fv(this.loc.uColor, color);
    gl.uniform1f(this.loc.uAlpha, alpha);
    this._bindPositions(this.pin.pos, this.pin.type, true);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pin.nrm);
    gl.enableVertexAttribArray(this.loc.aNormal);
    gl.vertexAttribPointer(this.loc.aNormal, 3, gl.SHORT, true, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.pin.idx);
    gl.drawElements(gl.TRIANGLES, this.pin.count, gl.UNSIGNED_SHORT, 0);
  }

  drawRing(pos, radius, color, alpha) {
    const gl = this.gl;
    const m = new Float32Array([radius,0,0,0, 0,radius,0,0, 0,0,1,0, pos[0],pos[1],pos[2] + 0.05,1]);
    gl.uniformMatrix4fv(this.loc.uModel, false, m);
    gl.uniform1f(this.loc.uPosScale, 1);
    gl.uniform1f(this.loc.uUnlit, 1);
    gl.uniform3fv(this.loc.uColor, color);
    gl.uniform1f(this.loc.uAlpha, alpha);
    this._bindPositions(this.ring.pos, gl.FLOAT, false);
    gl.disableVertexAttribArray(this.loc.aNormal);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.ring.count);
    gl.depthMask(true);
  }

  project(p) {
    const m = this.viewProj;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w <= 0.1) return null;
    return {
      x: ((x / w) * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (1 - ((y / w) * 0.5 + 0.5)) * this.canvas.clientHeight,
    };
  }
}
