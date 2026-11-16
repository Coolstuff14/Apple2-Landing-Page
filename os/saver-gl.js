// A very small WebGL 1 renderer for the 3D screensavers (no dependencies, like the rest of the OS).
// There is exactly ONE context for the whole page, on a hidden 640x480 canvas: every 3D saver renders a full
// frame into it and the caller copies the result onto its own 2D canvas (full screen or the 128x96 preview).
// Browsers cap live WebGL contexts and evict the oldest one, which here would be the room's own renderer,
// so nothing in the OS may create a context per run.
//
// Vertex layout (11 floats): position 3, normal 3, colour 3, uv 2. Matrices are column-major Float32Array(16).

const STRIDE = 11;
export const FLOATS = STRIDE;

// ---------------------------------------------------------------- matrices
export const M4 = {
  ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
  persp(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = 2 * far * near / (near - far);
    return o;
  },
  lookAt(e, c, u) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]; let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx; l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  },
  trans: (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
  scale: (x, y = x, z = x) => new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]),
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
  chain(...ms) { return ms.reduce((a, b) => M4.mul(a, b)); },
};

// ---------------------------------------------------------------- geometry builder
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const perp = (d) => norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));

/** Accumulates triangles; `data` is a plain array of floats in the vertex layout above. */
export class Geo {
  constructor() { this.data = []; }
  get count() { return this.data.length / STRIDE; }
  v(p, n, c, u = 0, w = 0) { this.data.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], u, w); }
  /** quad a-b-c-d (counter-clockwise), one normal, uv corners (0,0) (1,0) (1,1) (0,1) scaled by uv = [u0, v0, u1, v1] */
  quad(a, b, c, d, n, col, uv = [0, 0, 1, 1]) {
    const [u0, v0, u1, v1] = uv;
    this.v(a, n, col, u0, v0); this.v(b, n, col, u1, v0); this.v(c, n, col, u1, v1);
    this.v(a, n, col, u0, v0); this.v(c, n, col, u1, v1); this.v(d, n, col, u0, v1);
  }
  /** a tube swept along `pts` (each [x,y,z]) with smooth normals; `frame0` keeps the seam from twisting on bends */
  tube(pts, r, col, sides = 12) {
    let n = null; const rings = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      n = n ? norm(cross(cross(t, n), t)) : perp(t);
      const bn = cross(t, n), ring = [];
      for (let s = 0; s <= sides; s++) { const an = s / sides * Math.PI * 2, cs = Math.cos(an), sn = Math.sin(an), d = [n[0] * cs + bn[0] * sn, n[1] * cs + bn[1] * sn, n[2] * cs + bn[2] * sn]; ring.push([[pts[i][0] + d[0] * r, pts[i][1] + d[1] * r, pts[i][2] + d[2] * r], d]); }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) for (let s = 0; s < sides; s++) {
      const a = rings[i][s], b = rings[i][s + 1], c = rings[i + 1][s + 1], d = rings[i + 1][s];
      this.v(a[0], a[1], col); this.v(b[0], b[1], col); this.v(c[0], c[1], col); this.v(a[0], a[1], col); this.v(c[0], c[1], col); this.v(d[0], d[1], col);
    }
  }
  sphere(c, r, col, seg = 14, rings = 9) {
    const P = (i, j) => { const th = j / rings * Math.PI, ph = i / seg * Math.PI * 2, d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; return [[c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r], d]; };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
      this.v(a[0], a[1], col); this.v(b[0], b[1], col); this.v(cc[0], cc[1], col); this.v(a[0], a[1], col); this.v(cc[0], cc[1], col); this.v(d[0], d[1], col);
    }
  }
  array() { return new Float32Array(this.data); }
}

// ---------------------------------------------------------------- the one context
const VS = `attribute vec3 aP; attribute vec3 aN; attribute vec3 aC; attribute vec2 aU;
uniform mat4 uVP; uniform mat4 uM; varying vec3 vN; varying vec3 vP; varying vec3 vC; varying vec2 vU;
void main() { vec4 w = uM * vec4(aP, 1.0); vP = w.xyz; vN = (uM * vec4(aN, 0.0)).xyz; vC = aC; vU = aU; gl_Position = uVP * w; }`;
const FS = `precision mediump float;
varying vec3 vN; varying vec3 vP; varying vec3 vC; varying vec2 vU;
uniform sampler2D uT; uniform float uTex, uLit, uCut, uSpec, uShin, uAmb; uniform vec3 uEye, uL, uTint;
void main() {
  vec4 t = uTex > 0.5 ? texture2D(uT, vU) : vec4(1.0);
  if (uCut > 0.0 && t.a < uCut) discard;
  vec3 c = vC * t.rgb * uTint;
  if (uLit > 0.5) {
    vec3 n = normalize(vN), v = normalize(uEye - vP);
    if (dot(n, v) < 0.0) n = -n;                 // light whichever side faces the viewer (sheets, and either winding)
    float d = max(dot(n, uL), 0.0);
    float s = pow(max(dot(n, normalize(uL + v)), 0.0), uShin) * uSpec * step(0.001, d);
    c = c * (uAmb + (1.0 - uAmb) * d) + vec3(s);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

let kit = null, dead = false;
/** The shared renderer, or null when WebGL is not available (callers then fall back to a 2D saver). */
export function gl3d() {
  if (kit && !kit.lost) return kit;
  if (dead) return null;
  try {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!gl) { dead = true; return null; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    ['aP', 'aN', 'aC', 'aU'].forEach((n, i) => gl.bindAttribLocation(prog, i, n));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const U = {}; for (const n of ['uVP', 'uM', 'uT', 'uTex', 'uLit', 'uCut', 'uSpec', 'uShin', 'uAmb', 'uEye', 'uL', 'uTint']) U[n] = gl.getUniformLocation(prog, n);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.uniform1i(U.uT, 0);
    for (let i = 0; i < 4; i++) gl.enableVertexAttribArray(i);
    const k = { canvas, gl, lost: false, serial: Math.random() };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); k.lost = true; });
    k.mesh = (data, dynamic = false, capacity = 0) => {
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      if (capacity) gl.bufferData(gl.ARRAY_BUFFER, capacity * STRIDE * 4, gl.DYNAMIC_DRAW); else gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      return { buf, n: capacity ? 0 : data.length / STRIDE, cap: capacity };
    };
    k.update = (m, data) => { gl.bindBuffer(gl.ARRAY_BUFFER, m.buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); m.n = data.length / STRIDE; };
    /** add vertices to a mesh made with a capacity; returns false when it is full */
    k.append = (m, data) => { const add = data.length / STRIDE; if (m.n + add > m.cap) return false; gl.bindBuffer(gl.ARRAY_BUFFER, m.buf); gl.bufferSubData(gl.ARRAY_BUFFER, m.n * STRIDE * 4, data); m.n += add; return true; };
    k.texture = (src, { nearest = false, repeat = false } = {}) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      const f = nearest ? gl.NEAREST : gl.LINEAR, w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
      return t;
    };
    k.free = (...things) => { for (const x of things) { if (!x) continue; if (x.buf) gl.deleteBuffer(x.buf); else gl.deleteTexture(x); } };
    k.begin = (r = 0, g = 0, b = 0) => { gl.viewport(0, 0, 640, 480); gl.clearColor(r, g, b, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); };
    k.camera = (proj, view, eye, light = [0.35, 0.6, 0.72]) => {
      gl.uniformMatrix4fv(U.uVP, false, M4.mul(proj, view)); gl.uniform3fv(U.uEye, eye);
      const l = Math.hypot(light[0], light[1], light[2]); gl.uniform3f(U.uL, light[0] / l, light[1] / l, light[2] / l);
    };
    /** opts: lit, tex, cut (alpha test threshold), spec, shin, amb, tint, first/count (vertex range) */
    k.draw = (m, model, o = {}) => {
      if (!m || !m.n) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * 4, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE * 4, 12);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, STRIDE * 4, 24); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, STRIDE * 4, 36);
      gl.uniformMatrix4fv(U.uM, false, model || M4.ident());
      gl.uniform1f(U.uLit, o.lit === false ? 0 : 1); gl.uniform1f(U.uTex, o.tex ? 1 : 0); gl.uniform1f(U.uCut, o.cut || 0);
      gl.uniform1f(U.uSpec, o.spec ?? 0.5); gl.uniform1f(U.uShin, o.shin ?? 30); gl.uniform1f(U.uAmb, o.amb ?? 0.22);
      const t = o.tint || [1, 1, 1]; gl.uniform3f(U.uTint, t[0], t[1], t[2]);
      if (o.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, o.tex); }
      gl.drawArrays(gl.TRIANGLES, o.first || 0, o.count ?? m.n);
    };
    kit = k;
    return kit;
  } catch (err) {
    console.warn('[os98] 3D screensavers unavailable', err); dead = true; return null;
  }
}
