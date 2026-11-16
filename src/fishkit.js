// Procedural fish: geometry (a lofted body plus flat fins), a swim animation in the vertex shader and a
// painted-on pattern per species in the fragment shader. Used by the aquarium and by the party under the rock,
// which light the same fish differently: the caller supplies a GLSL chunk defining
//     vec3 shade(vec3 P, vec3 N, vec3 V, vec3 albedo, float glow, float fin)
// Fish space: nose at x = +0.5, tail tip at x = -0.5, y up, z sideways; an instance matrix scales it to size.
import * as THREE from 'three';

export const SPECIES = {
  neon:  { name: 'Neon tetra', shape: 'slender', pat: 0, len: 0.034, amp: 0.085, turn: 3.2, cruise: 0.060, fin: 0.42 },
  platy: { name: 'Platy', shape: 'stout', pat: 1, len: 0.046, amp: 0.070, turn: 2.4, cruise: 0.045, fin: 0.85 },
  angel: { name: 'Angelfish', shape: 'disc', pat: 2, len: 0.064, amp: 0.045, turn: 1.4, cruise: 0.028, fin: 0.88 },
  danio: { name: 'Zebra danio', shape: 'slender', pat: 3, len: 0.042, amp: 0.095, turn: 3.6, cruise: 0.095, fin: 0.50 },
  cory:  { name: 'Bronze cory', shape: 'cory', pat: 4, len: 0.046, amp: 0.075, turn: 2.6, cruise: 0.040, fin: 0.60 },
  pleco: { name: 'Pleco', shape: 'pleco', pat: 5, len: 0.095, amp: 0.050, turn: 1.2, cruise: 0.030, fin: 0.95 },
};

// hs / ws: body half-height / half-width along the body (0 = nose, 1 = tail root), as fractions of h / w.
// fins: polygons [x, y(, z)] fanned from their first point; `pair` fins are mirrored to the other side.
const SHAPES = {
  slender: { h: 0.135, w: 0.062, end: -0.30, top: 1, bot: 1, eye: [0.085, 0.20, 0.030],
    hs: [[0, 0.0], [0.05, 0.46], [0.16, 0.80], [0.36, 1.0], [0.6, 0.86], [0.82, 0.52], [1, 0.27]],
    ws: [[0, 0.0], [0.05, 0.52], [0.2, 0.95], [0.4, 1.0], [0.65, 0.7], [0.85, 0.34], [1, 0.12]],
    fins: [{ p: [[-0.29, 0], [-0.30, 0.036], [-0.5, 0.155], [-0.425, 0.0], [-0.5, -0.155], [-0.30, -0.036]] },
      { p: [[0.03, 0.125], [-0.03, 0.235], [-0.10, 0.20], [-0.13, 0.115]] }, { p: [[-0.06, -0.115], [-0.13, -0.215], [-0.23, -0.07]] },
      { p: [[0.08, -0.125], [0.03, -0.20], [-0.01, -0.125]] }, { p: [[0.22, -0.03, 0.055], [0.10, -0.07, 0.115], [0.12, 0.0, 0.065]], pair: true }] },
  stout: { h: 0.175, w: 0.085, end: -0.29, top: 1, bot: 1.08, eye: [0.085, 0.22, 0.027],
    hs: [[0, 0.0], [0.05, 0.42], [0.18, 0.80], [0.40, 1.0], [0.62, 0.90], [0.84, 0.58], [1, 0.36]],
    ws: [[0, 0.0], [0.05, 0.55], [0.2, 0.95], [0.42, 1.0], [0.66, 0.72], [0.86, 0.36], [1, 0.14]],
    fins: [{ p: [[-0.28, 0], [-0.29, 0.062], [-0.46, 0.145], [-0.5, 0.06], [-0.5, -0.06], [-0.46, -0.145], [-0.29, -0.062]] },
      { p: [[0.02, 0.165], [-0.05, 0.30], [-0.15, 0.27], [-0.17, 0.15]] }, { p: [[-0.05, -0.17], [-0.12, -0.27], [-0.21, -0.11]] },
      { p: [[0.09, -0.17], [0.04, -0.25], [0.0, -0.17]] }, { p: [[0.22, -0.04, 0.075], [0.09, -0.09, 0.14], [0.12, 0.0, 0.085]], pair: true }] },
  disc: { h: 0.30, w: 0.060, end: -0.24, top: 1, bot: 1, eye: [0.10, 0.16, 0.036],
    hs: [[0, 0.0], [0.04, 0.24], [0.16, 0.66], [0.36, 0.95], [0.52, 1.0], [0.72, 0.86], [0.90, 0.46], [1, 0.20]],
    ws: [[0, 0.0], [0.06, 0.6], [0.25, 1.0], [0.5, 0.95], [0.75, 0.6], [1, 0.16]],
    fins: [{ p: [[-0.23, 0], [-0.24, 0.058], [-0.5, 0.22], [-0.44, 0.0], [-0.5, -0.22], [-0.24, -0.058]] },
      { p: [[0.06, 0.285], [-0.02, 0.50], [-0.30, 0.80], [-0.19, 0.42], [-0.19, 0.16]] }, { p: [[0.0, -0.285], [-0.06, -0.50], [-0.30, -0.78], [-0.19, -0.40], [-0.19, -0.15]] },
      { p: [[0.16, -0.25, 0.012], [0.07, -0.84, 0.02], [0.115, -0.27, 0.012]], pair: true }, { p: [[0.20, -0.06, 0.05], [0.07, -0.12, 0.10], [0.11, 0.0, 0.06]], pair: true }] },
  cory: { h: 0.150, w: 0.100, end: -0.29, top: 1.15, bot: 0.62, eye: [0.10, 0.42, 0.030],
    hs: [[0, 0.0], [0.04, 0.50], [0.14, 0.92], [0.30, 1.0], [0.55, 0.80], [0.8, 0.48], [1, 0.30]],
    ws: [[0, 0.0], [0.05, 0.62], [0.18, 1.0], [0.4, 0.9], [0.65, 0.6], [0.85, 0.32], [1, 0.12]],
    fins: [{ p: [[-0.28, 0.01], [-0.29, 0.05], [-0.5, 0.17], [-0.43, 0.01], [-0.5, -0.13], [-0.29, -0.04]] },
      { p: [[0.14, 0.165], [0.06, 0.34], [-0.03, 0.27], [-0.05, 0.15]] }, { p: [[-0.12, -0.07], [-0.17, -0.16], [-0.24, -0.05]] },
      { p: [[0.20, -0.07, 0.085], [0.06, -0.11, 0.17], [0.10, -0.05, 0.09]], pair: true }] },
  pleco: { h: 0.100, w: 0.130, end: -0.27, top: 1.1, bot: 0.40, eye: [0.115, 0.60, 0.020],
    hs: [[0, 0.0], [0.03, 0.42], [0.12, 0.88], [0.26, 1.0], [0.5, 0.78], [0.78, 0.46], [1, 0.30]],
    ws: [[0, 0.0], [0.03, 0.62], [0.10, 0.95], [0.22, 1.0], [0.45, 0.66], [0.7, 0.36], [1, 0.12]],
    fins: [{ p: [[-0.26, 0.01], [-0.27, 0.035], [-0.5, 0.20], [-0.44, 0.02], [-0.5, -0.12], [-0.27, -0.025]] },
      { p: [[0.16, 0.105], [0.10, 0.33], [-0.08, 0.30], [-0.10, 0.09]] },
      { p: [[0.24, -0.03, 0.12], [0.06, -0.035, 0.30], [0.12, -0.025, 0.125]], pair: true }, { p: [[-0.02, -0.03, 0.08], [-0.12, -0.035, 0.19], [-0.10, -0.025, 0.07]], pair: true }] },
};

function curve(pts) {            // cubic Hermite through control points
  const n = pts.length, m = pts.map((_, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; return (b[1] - a[1]) / Math.max(1e-6, b[0] - a[0]); });
  return (s) => {
    let i = 1; while (i < n - 1 && s > pts[i][0]) i++;
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], h = x1 - x0, t = Math.min(1, Math.max(0, (s - x0) / h)), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i - 1] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i];
  };
}

const geoCache = {};
export function fishGeometry(shape) {
  if (geoCache[shape]) return geoCache[shape];
  const P = SHAPES[shape], hs = curve(P.hs), ws = curve(P.ws);
  const R = 14, K = 12, pos = [], uv = [], fin = [], idx = [];
  for (let i = 0; i <= R; i++) {
    const s = i / R, x = 0.5 - s * (0.5 - P.end), hh = Math.max(0, hs(s)) * P.h, hw = Math.max(0, ws(s)) * P.w;
    for (let k = 0; k <= K; k++) {
      const a = (k / K) * Math.PI * 2, sy = Math.sin(a), y = hh * sy * (sy > 0 ? P.top : P.bot);
      pos.push(x, y, hw * Math.cos(a)); uv.push(0.5 - x, y / P.h); fin.push(0);
    }
  }
  for (let i = 0; i < R; i++) for (let k = 0; k < K; k++) { const a = i * (K + 1) + k, b = a + K + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); body.setIndex(idx); body.computeVertexNormals();
  const nor = Array.from(body.attributes.normal.array);
  for (const f of P.fins) for (const side of f.pair ? [1, -1] : [1]) {
    const base = pos.length / 3;
    for (const q of f.p) { pos.push(q[0], q[1], (q[2] || 0) * side); uv.push(0.5 - q[0], q[1] / P.h); fin.push(1); nor.push(0, f.pair ? 1 : 0, f.pair ? 0 : 1); }
    for (let k = 1; k < f.p.length - 1; k++) idx.push(base, base + k, base + k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 1)); g.setIndex(idx);
  g.userData.eye = new THREE.Vector4(P.eye[0], P.eye[1], P.eye[2], P.h);
  return (geoCache[shape] = g);
}

const VERT = /* glsl */`
attribute float aFin, aPhase, aBend, aHot, aTint;
uniform float uAmp;
varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying float vFin; varying float vHot; varying float vTint;
void main() {
  vUv = uv; vFin = aFin; vHot = aHot; vTint = aTint;
  vec3 p = position;
  float s = clamp(0.5 - p.x, 0.0, 1.0);
  p.z += uAmp * (0.10 + 0.90 * s * s) * sin(aPhase - s * 5.5) + aBend * s * s;        // the body wave travels towards the tail
  p.z += aFin * 0.012 * sin(aPhase * 1.7 + p.x * 20.0 + p.y * 16.0);
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(p, 1.0);
  vP = wp.xyz; vN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SKIN = /* glsl */`
vec3 skin(vec2 q, float fin, float tint, out float glow) {
  float u = q.x, v = q.y; glow = 0.0; vec3 c;
#if PAT == 0
  c = mix(vec3(0.72, 0.76, 0.74), vec3(0.20, 0.23, 0.13), smoothstep(-0.15, 0.75, v));
  float st = smoothstep(0.10, 0.20, v) * smoothstep(0.55, 0.42, v) * smoothstep(0.03, 0.08, u) * smoothstep(0.66, 0.58, u);
  c = mix(c, vec3(0.03, 0.72, 1.0), st); glow = st;
  float rd = smoothstep(-0.60, -0.45, v) * smoothstep(0.10, 0.0, v) * smoothstep(0.40, 0.47, u) * smoothstep(0.80, 0.70, u);
  c = mix(c, vec3(0.95, 0.07, 0.05), rd); glow = max(glow, rd * 0.45);
  if (fin > 0.5) c = mix(vec3(0.50, 0.56, 0.50), c, 0.35);
#elif PAT == 1
  vec3 b = mix(vec3(0.98, 0.42, 0.05), vec3(0.93, 0.13, 0.05), tint);
  c = mix(b * 1.12, b * 0.78, smoothstep(-0.6, 0.8, v));
  if (fin > 0.5) c = mix(c, vec3(0.03), smoothstep(0.80, 0.90, u));
#elif PAT == 2
  c = mix(vec3(0.84, 0.84, 0.78), vec3(0.55, 0.56, 0.48), smoothstep(0.0, 1.0, v));
  float bar = max(max(smoothstep(0.035, 0.0, abs(u - 0.13)), smoothstep(0.05, 0.01, abs(u - 0.36))), smoothstep(0.055, 0.01, abs(u - 0.60)));
  c = mix(c, vec3(0.03, 0.03, 0.04), bar * 0.92);
  if (fin > 0.5) c = mix(c, vec3(0.78, 0.76, 0.62), 0.3);
#elif PAT == 3
  float sp = smoothstep(-0.2, 0.2, sin(v * 9.5 + 0.6));
  c = mix(vec3(0.07, 0.10, 0.42), vec3(0.88, 0.80, 0.50), sp);
  c = mix(c, vec3(0.90, 0.90, 0.86), smoothstep(-0.55, -0.80, v));
  glow = (1.0 - sp) * 0.25;
#elif PAT == 4
  c = mix(vec3(0.80, 0.68, 0.60), vec3(0.42, 0.33, 0.18), smoothstep(-0.45, 0.2, v));
  c = mix(c, vec3(0.14, 0.20, 0.13), smoothstep(0.30, 0.0, abs(v - 0.35)) * smoothstep(0.2, 0.3, u) * smoothstep(0.8, 0.6, u) * 0.75);
#else
  vec2 g = vec2(u * 26.0, v * 7.0); vec2 id = floor(g), f = fract(g) - 0.5;
  float spot = smoothstep(0.34, 0.2, length(f + (vec2(h21(id), h21(id + 3.1)) - 0.5) * 0.4));
  c = mix(vec3(0.10, 0.07, 0.045), vec3(0.36, 0.27, 0.15), spot * 0.8);
  c = mix(c, vec3(0.45, 0.40, 0.33), smoothstep(-0.5, -0.9, v));
#endif
  return c;
}`;

/** light = { glsl: 'vec3 shade(...) {...}' (may declare its own uniforms), uniforms: {...} } */
export function makeFishMaterial(kind, light) {
  const sp = SPECIES[kind], eye = fishGeometry(sp.shape).userData.eye;
  return new THREE.ShaderMaterial({
    name: 'fish_' + kind, defines: { PAT: sp.pat }, side: THREE.DoubleSide,
    uniforms: { uAmp: { value: sp.amp }, uEye: { value: eye }, uFinA: { value: sp.fin }, ...light.uniforms },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying float vFin; varying float vHot; varying float vTint;
      uniform vec4 uEye; uniform float uFinA;
      ${light.glsl}
      ${SKIN}
      float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
      float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      void main() {
        // fin membranes are see-through: a screen-door pattern stands in for blending (no sorting, no extra pass)
        if (vFin > 0.5 && bayer4(gl_FragCoord.xy) > uFinA) discard;
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vP);
        float glow = 0.0;
        vec3 albedo = skin(vUv, vFin, vTint, glow);
        if (vFin < 0.5) {
          float de = length(vec2(vUv.x - uEye.x, (vUv.y - uEye.y) * uEye.w)) / uEye.z;
          albedo = mix(albedo, vec3(0.86, 0.83, 0.70), smoothstep(1.0, 0.86, de));
          albedo = mix(albedo, vec3(0.012), smoothstep(0.64, 0.52, de));
        }
        vec3 col = shade(vP, N, V, albedo, glow, vFin) * (1.0 + 0.16 * vHot);      // the same faint lift as the room's hover
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M = new THREE.Matrix4();
/** `count` fish of one species drawn as one instanced mesh. */
export function createSchool(kind, count, light) {
  const sp = SPECIES[kind], geo = fishGeometry(sp.shape).clone();
  const at = {};
  for (const n of ['aPhase', 'aBend', 'aHot', 'aTint']) { at[n] = new THREE.InstancedBufferAttribute(new Float32Array(count), 1); at[n].setUsage(THREE.DynamicDrawUsage); geo.setAttribute(n, at[n]); }
  const mesh = new THREE.InstancedMesh(geo, makeFishMaterial(kind, light), count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.name = 'school_' + kind;
  return {
    kind, sp, mesh, count,
    /** dir must be normalised; roll in radians around the swimming direction; size = body length in metres */
    set(i, pos, dir, roll, size, phase, bend, hot = 0) {
      X.copy(dir); Z.crossVectors(X, UP); if (Z.lengthSq() < 1e-6) Z.set(0, 0, 1); Z.normalize(); Y.crossVectors(Z, X);
      if (roll) { const c = Math.cos(roll), s = Math.sin(roll), yx = Y.x, yy = Y.y, yz = Y.z; Y.set(yx * c + Z.x * s, yy * c + Z.y * s, yz * c + Z.z * s); Z.set(Z.x * c - yx * s, Z.y * c - yy * s, Z.z * c - yz * s); }
      M.set(X.x * size, Y.x * size, Z.x * size, pos.x, X.y * size, Y.y * size, Z.y * size, pos.y, X.z * size, Y.z * size, Z.z * size, pos.z, 0, 0, 0, 1);
      mesh.setMatrixAt(i, M); at.aPhase.array[i] = phase; at.aBend.array[i] = bend; at.aHot.array[i] = hot;
    },
    setTint(i, t) { at.aTint.array[i] = t; at.aTint.needsUpdate = true; },
    commit() { mesh.instanceMatrix.needsUpdate = true; at.aPhase.needsUpdate = true; at.aBend.needsUpdate = true; at.aHot.needsUpdate = true; },
  };
}

export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
