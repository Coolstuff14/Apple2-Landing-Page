// The aquarium on the dresser. The glass box, gravel, rocks and hood are lightmapped room geometry (atlas H);
// this module adds everything that moves or is transparent: glass and water surface, the two tubes, plants,
// bubbles, food flakes and the fish with their small steering simulation. Layout comes from meta.tank.
import * as THREE from 'three';
import { WATER_GLSL } from './water.js';
import { ENV_GLSL } from './materials.js';
import { createSchool, mulberry32 } from './fishkit.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const addc = (c, o, k) => { c.r += o.r * k; c.g += o.g * k; c.b += o.b * k; return c; };      // THREE.Color has no addScaledVector
const DAY = new THREE.Color(1.0, 0.97, 0.90), BLUE = new THREE.Color(0.10, 0.30, 1.0);
// premultiplied "over" for colour, destination alpha untouched: the CRT's hole in the canvas must survive
const OVER = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
const ADD = { ...OVER, blendDst: THREE.OneFactor };
const WVERT = /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const TAIL = /* glsl */`
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

/** How the tank lights a fish: hood light from above with caustics, the room's ambient, fog by water depth. */
export const TANK_FISH_LIGHT = /* glsl */`
${WATER_GLSL}
vec3 shade(vec3 P, vec3 N, vec3 V, vec3 albedo, float glow, float fin) {
  float up = N.y;
  vec3 L = uTankLight * (0.50 + 0.50 * up + 0.40 * caustic(P) * max(up, 0.0)) + uAmb * 0.28;      // little of the room's light gets in
  vec3 c = albedo * L;
  c += uTankLight * pow(max(dot(N, normalize(V + vec3(0.0, 1.0, 0.0))), 0.0), 26.0) * 0.45 * (1.0 - fin);
  c += albedo * glow * (0.06 + 0.9 * uBlueLvl + 0.35 * dot(uTankLight, vec3(0.2)));      // the iridescent stripe carries its own light
  c += albedo * caveGlow(P) * 2.5;
  return waterFog(c, P);
}`;

export function createAquarium({ scene, meta, fx, shared, envTex, still = false, reduceMotion = false, query = null }) {
  const T = meta.tank, U = shared.tankU;
  if (!T || !U) return null;
  const b2t = (v) => new THREE.Vector3(v[0], v[2], -v[1]);
  const rnd = mulberry32(1998);
  const lo = U.uTankMin.value, hi = U.uTankMax.value;                  // the water volume
  const G = T.gravel;
  function gravelAt(x, z) {
    const u = clamp((x - G.x0) / (G.x1 - G.x0), 0, 1) * G.nx, v = clamp((-z - G.y0) / (G.y1 - G.y0), 0, 1) * G.ny;
    const i = Math.min(G.nx - 1, Math.floor(u)), j = Math.min(G.ny - 1, Math.floor(v)), fu = u - i, fv = v - j, w = G.nx + 1;
    return (G.z[j * w + i] * (1 - fu) + G.z[j * w + i + 1] * fu) * (1 - fv) + (G.z[(j + 1) * w + i] * (1 - fu) + G.z[(j + 1) * w + i + 1] * fu) * fv;
  }
  const colliders = T.colliders.map((c) => ({ c: b2t(c.c), r: new THREE.Vector3(c.r[0], c.r[2], c.r[1]), cos: Math.cos(c.rot || 0), sin: Math.sin(c.rot || 0) }));
  const cave = { mouth: b2t(T.cave.mouth), inside: b2t(T.cave.inside), r: T.cave.r };
  const q = new THREE.Vector3();
  /** Keep a sphere inside the water and out of the rocks. Returns true when something was touched. */
  function constrain(p, rad, cam = false) {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) for (const c of colliders) {
      // into the ellipsoid's frame (rotated about the vertical; Blender +rot about Z = three -rot about Y)
      const dx = p.x - c.c.x, dz = p.z - c.c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos, ly = p.y - c.c.y;
      const rx = c.r.x + rad, ry = c.r.y + rad, rz = c.r.z + rad, d = Math.sqrt((lx / rx) ** 2 + (ly / ry) ** 2 + (lz / rz) ** 2);
      if (d >= 1 || d < 1e-5) continue;
      const k = 1 / d, nx = lx * k, ny = ly * k, nz = lz * k;
      p.x = c.c.x + nx * c.cos + nz * c.sin; p.y = c.c.y + ny; p.z = c.c.z - nx * c.sin + nz * c.cos; hit = true;
    }
    const m = cam ? 0.004 : rad;
    const x = clamp(p.x, lo.x + m, hi.x - m), z = clamp(p.z, lo.z + m, hi.z - m);
    const y = clamp(p.y, gravelAt(x, z) + (cam ? 0.006 : rad * 0.8), hi.y - (cam ? 0.004 : rad * 0.6));
    if (x !== p.x || y !== p.y || z !== p.z) hit = true;
    p.set(x, y, z);
    return hit;
  }

  // ---------------------------------------------------------------- lights
  const init = (query && query.get('tank')) || 'day';
  const state = { day: init === 'day' || init === 'both', blue: init === 'blue' || init === 'both', bubbler: !(query && query.get('bubbler') === '0') };
  const lvl = { day: state.day ? 1 : 0, blue: state.blue ? 1 : 0 };
  const tint = new THREE.Color(), rave = { glow: 0.35, beat: 0 };
  const tubeMat = { day: emissive(), blue: emissive() };
  function emissive() {
    return new THREE.ShaderMaterial({ uniforms: { uC: { value: new THREE.Color() } }, vertexShader: WVERT,
      fragmentShader: `precision highp float; uniform vec3 uC; void main() { gl_FragColor = vec4(uC, 1.0); ${TAIL} }` });
  }
  if (fx.fx_tank_tube_day) fx.fx_tank_tube_day.material = tubeMat.day;
  if (fx.fx_tank_tube_blue) fx.fx_tank_tube_blue.material = tubeMat.blue;
  function applyLight() {
    addc(addc(tint.setRGB(0, 0, 0), DAY, lvl.day), BLUE, lvl.blue * 0.75);
    U.uTankLight.value.copy(tint).multiplyScalar(1.15);
    U.uBlueLvl.value = lvl.blue * (1 - 0.7 * lvl.day);
    addc(U.uWaterCol.value.setRGB(0.020 * lvl.day + 0.005 * lvl.blue, 0.105 * lvl.day + 0.028 * lvl.blue, 0.135 * lvl.day + 0.170 * lvl.blue), shared.uProxyLight.value, 0.05);
    tubeMat.day.uniforms.uC.value.copy(DAY).multiplyScalar(0.03 + 7 * lvl.day);
    tubeMat.blue.uniforms.uC.value.copy(BLUE).multiplyScalar(0.03 + 7 * lvl.blue).addScalar(0.01);
  }

  // ---------------------------------------------------------------- glass, water surface, cave glow
  const glassMat = new THREE.ShaderMaterial({
    name: 'fx_tank_glass', ...OVER,
    uniforms: { tEnv: { value: envTex }, uEnvPos: shared.uEnvPos, uBoxMin: shared.uBoxMin, uBoxMax: shared.uBoxMax, uEnvScale: shared.uEnvScale, uPackSqrt: shared.uPackSqrt,
      uCamIn: { value: 0 }, uWaterCol: U.uWaterCol, uHot: { value: 0 }, uMid: { value: lo.clone().add(hi).multiplyScalar(0.5) } },
    vertexShader: WVERT,
    fragmentShader: /* glsl */`
      precision highp float; varying vec3 vN; varying vec3 vP;
      uniform float uCamIn, uHot; uniform vec3 uWaterCol, uMid;
      ${ENV_GLSL}
      void main() {
        vec3 N = normalize(vN), V = normalize(cameraPosition - vP);
        float ndv = abs(dot(N, V)); vec3 col; float a;
        if (uCamIn < 0.5) {                          // from the room: a faint reflection of the room on the outer faces
          if (dot(N, vP - uMid) < 0.0) discard;      // (the far pane's inner face is behind water)
          float F = 0.012 + 0.988 * pow(1.0 - ndv, 5.0);
          col = min(envSample(vP, reflect(-V, N)), vec3(3.0)) * F + vec3(0.010, 0.014, 0.012) * uHot; a = F * 0.8 + 0.015;
        } else {                                     // from the water: beyond the critical angle the pane is a mirror
          float tir = smoothstep(0.68, 0.56, ndv);
          col = uWaterCol * (0.10 + 1.05 * tir); a = 0.10 + 0.88 * tir;
        }
        gl_FragColor = vec4(col, a);
        ${TAIL}
      }`,
  });
  const glass = [];
  for (const k of Object.keys(fx)) if (k.startsWith('fx_tank_glass')) { fx[k].material = glassMat; fx[k].renderOrder = 12; fx[k].userData.tankGlass = true; glass.push(fx[k]); }
  const surfMat = new THREE.ShaderMaterial({
    name: 'fx_tank_water', side: THREE.DoubleSide,
    uniforms: { ...U, uTubes: { value: new THREE.Color() } },
    vertexShader: WVERT,
    fragmentShader: /* glsl */`
      precision highp float; varying vec3 vP; uniform vec3 uTubes;
      ${WATER_GLSL}
      void main() {
        vec3 V = normalize(cameraPosition - vP);
        vec2 p = vP.xz * 70.0; float t = uWTime * 1.3;
        vec3 n = normalize(vec3(0.16 * cos(p.x + t) + 0.10 * cos(p.x * 2.3 - p.y * 1.1 + t * 1.6), 1.0, 0.16 * cos(p.y * 1.2 - t * 0.9) + 0.10 * sin(p.y * 2.6 + p.x * 0.7 + t * 1.3)));
        float c = abs(dot(n, V));
        vec3 col;
        if (cameraPosition.y < vP.y) {               // from below: Snell's window onto the hood, a mirror around it
          float win = smoothstep(0.60, 0.74, c);
          vec3 mirror = uWaterCol * (1.25 - 0.45 * pow(1.0 - c, 2.0)) + uTankLight * 0.05 * caustic(vP * 0.6);
          vec3 sky = uTubes * (0.55 + 0.45 * sin(p.x * 0.5 + t) * sin(p.y * 0.4 - t)) + uTankLight * 0.5;
          col = waterFog(mix(mirror, sky, win), vP);
        } else col = uWaterCol * 0.6 + uTankLight * 0.25 * pow(1.0 - c, 3.0);
        gl_FragColor = vec4(col, 1.0);
        ${TAIL}
      }`,
  });
  if (fx.fx_tank_water) { fx.fx_tank_water.material = surfMat; fx.fx_tank_water.userData.tankGlass = true; }
  const glowMat = new THREE.ShaderMaterial({
    name: 'fx_cave_glow', ...ADD, uniforms: { uRaveCol: U.uRaveCol }, vertexShader: WVERT,
    fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; uniform vec3 uRaveCol;
      void main() { vec2 d = (vUv - vec2(0.5, 0.42)) * vec2(2.0, 2.3); float a = smoothstep(1.0, 0.1, length(d)); gl_FragColor = vec4(uRaveCol * a * a * 1.6, 0.0); ${TAIL} }`,
  });
  if (fx.fx_cave_glow) { fx.fx_cave_glow.material = glowMat; fx.fx_cave_glow.renderOrder = 9; }

  // ---------------------------------------------------------------- plants (one mesh, swaying in the vertex shader)
  const plants = (() => {
    const P = [], Nn = [], Tt = [], Ph = [], Kd = [], Ln = [], I = [];
    const r = mulberry32(77);
    const blade = (root, L, w, lean, yaw, kind, segs) => {
      const ph = r(), base = P.length / 3, dx = Math.cos(yaw), dz = Math.sin(yaw), wx = -dz, wz = dx;
      const tw = (r() - 0.5) * 1.6;                                 // ribbons face slightly different ways
      for (let j = 0; j <= segs; j++) {
        const t = j / segs, y = root.y + L * t * (1 - 0.25 * lean * t), off = lean * L * t * t;
        const wd = kind === 2 ? w * (0.12 + Math.sin(Math.PI * Math.pow(t, 0.75)) * 0.95) : w * (1 - 0.75 * t * t);
        const a = tw * t, ax = wx * Math.cos(a) + dx * Math.sin(a), az = wz * Math.cos(a) + dz * Math.sin(a);
        for (const sd of [-0.5, 0.5]) { P.push(root.x + dx * off + ax * wd * sd, y, root.z + dz * off + az * wd * sd); Nn.push(dx, 0.2, dz); Tt.push(t, sd + 0.5); Ph.push(ph); Kd.push(kind); Ln.push(L); }
        if (j < segs) { const a0 = base + j * 2; I.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
      }
    };
    for (const c of T.plants) {
      const rr = mulberry32(c.seed * 131);
      for (let i = 0; i < c.n; i++) {
        const a = rr() * Math.PI * 2, d = Math.sqrt(rr()), bx = c.c[0] + Math.cos(a) * d * c.rx, by = c.c[1] + Math.sin(a) * d * c.ry;
        const x = clamp(bx, lo.x + 0.006, hi.x - 0.006), z = clamp(-by, lo.z + 0.006, hi.z - 0.006);
        const root = new THREE.Vector3(x, gravelAt(x, z) - 0.003, z);
        const L = Math.min(c.h0 + (c.h1 - c.h0) * rr(), hi.y - root.y - 0.004);
        if (c.kind === 'val') blade(root, L, 0.0042 + 0.0030 * rr(), 0.10 + 0.30 * rr(), rr() * 6.283, 0, 9);
        else if (c.kind === 'hair') blade(root, L, 0.0013, 0.2 + 0.7 * rr(), rr() * 6.283, 1, 2);
        else blade(root, L, 0.030 + 0.012 * rr(), 0.45 + 0.5 * rr(), (i / c.n) * 6.283 + rr() * 0.5, 2, 6);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(Tt, 2)); g.setAttribute('aPh', new THREE.Float32BufferAttribute(Ph, 1));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(Kd, 1)); g.setAttribute('aLen', new THREE.Float32BufferAttribute(Ln, 1)); g.setIndex(I);
    const m = new THREE.ShaderMaterial({
      name: 'tank_plants', side: THREE.DoubleSide, uniforms: { ...U, uPush: { value: new THREE.Vector3(0, -9, 0) }, uSway: { value: still || reduceMotion ? 0.25 : 1 } },
      vertexShader: /* glsl */`
        attribute float aPh, aKind, aLen; uniform float uWTime, uSway; uniform vec3 uPush;
        varying vec2 vUv; varying vec3 vP; varying float vKind; varying vec3 vN;
        void main() {
          vUv = uv; vKind = aKind; vec3 p = position; float h = uv.x;
          float a = uWTime * (0.8 + 0.5 * aPh) + aPh * 6.2831;
          float amp = aLen * (aKind < 0.5 ? 0.11 : aKind < 1.5 ? 0.16 : 0.05) * uSway;
          p.xz += vec2(sin(a + h * 2.4), cos(a * 0.83 + h * 1.9)) * amp * h * h;
          vec3 d = p - uPush; float k = exp(-dot(d, d) * 700.0);              // blades part around the swimmer
          p.xz += normalize(d.xz + vec2(1e-4)) * k * 0.022 * h;
          vec4 wp = modelMatrix * vec4(p, 1.0); vP = wp.xyz; vN = normal;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        precision highp float; varying vec2 vUv; varying vec3 vP; varying float vKind; varying vec3 vN;
        ${WATER_GLSL}
        void main() {
          float h = vUv.x, rib = smoothstep(0.10, 0.0, abs(vUv.y - 0.5)), edge = smoothstep(0.5, 0.25, abs(vUv.y - 0.5));
          vec3 c = vKind < 0.5 ? mix(vec3(0.035, 0.20, 0.03), vec3(0.30, 0.62, 0.10), h) : vKind < 1.5 ? mix(vec3(0.08, 0.30, 0.04), vec3(0.36, 0.70, 0.14), h)
            : mix(vec3(0.03, 0.17, 0.03), vec3(0.14, 0.44, 0.07), h);
          c *= (1.0 - 0.35 * rib * step(0.5, abs(vKind - 1.0))) * (0.72 + 0.28 * edge);
          c *= 0.9 + 0.2 * sin(h * 40.0 + vP.x * 300.0);                       // faint cross-banding along the ribbon
          c *= 0.80 + 0.35 * fract(vKind * 0.37 + floor(vP.x * 90.0) * 0.13 + floor(vP.z * 90.0) * 0.29);
          vec3 L = uTankLight * (0.16 + 0.44 * h + 0.35 * caustic(vP) * h) + uAmb * 0.20;
          vec3 col = c * L + c * caveGlow(vP) * 5.0;
          gl_FragColor = vec4(waterFog(col, vP), 1.0);
          ${TAIL}
        }`,
    });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.name = 'tank_plants'; scene.add(mesh);
    return { mesh, mat: m };
  })();

  // ---------------------------------------------------------------- bubbles: two columns, animated on the GPU
  const bubbles = (() => {
    const n = 150, pos = new Float32Array(n * 3), seed = new Float32Array(n), src = new Float32Array(n);
    for (let i = 0; i < n; i++) { seed[i] = rnd(); src[i] = i % 2; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aSrc', new THREE.BufferAttribute(src, 1));
    const m = new THREE.ShaderMaterial({
      name: 'tank_bubbles', ...OVER,
      uniforms: { ...U, uSrc: { value: T.bubblers.map(b2t) }, uTop: { value: hi.y }, uPx: { value: 800 }, uOnAt: { value: -1e3 }, uOffAt: { value: -2e3 }, uOn: { value: state.bubbler ? 1 : 0 } },
      vertexShader: /* glsl */`
        attribute float aSeed, aSrc; uniform vec3 uSrc[2]; uniform float uTop, uWTime, uPx, uOnAt, uOffAt, uOn; varying float vA; varying float vS;
        void main() {
          vec3 s = aSrc < 0.5 ? uSrc[0] : uSrc[1];
          float period = 2.1 + 1.4 * fract(aSeed * 13.7), life = fract(uWTime / period + aSeed * 7.31), born = uWTime - life * period;
          float vis = uOn > 0.5 ? step(uOnAt, born) : step(born, uOffAt) * step(uOnAt, born);
          vec3 p = s; p.y = mix(s.y, uTop, life);
          float w = 0.003 + 0.016 * life, a = aSeed * 40.0 + life * (9.0 + 6.0 * fract(aSeed * 3.3));
          p.xz += vec2(sin(a), cos(a * 1.3)) * w;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          float size = (0.0012 + 0.0030 * fract(aSeed * 5.1)) * (0.7 + 0.5 * life);
          gl_PointSize = max(1.6, size * uPx / max(0.02, -mv.z)); vS = gl_PointSize;
          vA = vis * smoothstep(0.0, 0.04, life) * smoothstep(1.0, 0.97, life);
        }`,
      fragmentShader: /* glsl */`
        precision highp float; varying float vA; varying float vS; uniform vec3 uTankLight, uAmb;
        void main() {
          vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; if (d > 1.0 || vA < 0.01) discard;
          float ring = smoothstep(0.45, 0.95, d) * smoothstep(1.0, 0.9, d), spec = smoothstep(0.35, 0.0, length(c - vec2(-0.16, -0.18)) * 2.0);
          float a = (vS < 4.0 ? 0.55 : 0.10 + 0.6 * ring + 0.8 * spec) * vA;
          gl_FragColor = vec4((uTankLight * 0.9 + uAmb * 0.4 + 0.02) * a, a * 0.6);
          ${TAIL}
        }`,
    });
    const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 11; scene.add(p);
    return m;
  })();

  // ---------------------------------------------------------------- food flakes
  const FLAKES = 64;
  const flakes = [];
  const flakeGeo = new THREE.BufferGeometry(); const flakePos = new Float32Array(FLAKES * 3), flakeCol = new Float32Array(FLAKES * 3);
  flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3).setUsage(THREE.DynamicDrawUsage)); flakeGeo.setAttribute('color', new THREE.BufferAttribute(flakeCol, 3));
  flakeGeo.setDrawRange(0, 0);
  const flakeMat = new THREE.ShaderMaterial({
    name: 'tank_flakes', uniforms: { ...U, uPx: bubbles.uniforms.uPx },
    vertexShader: /* glsl */`attribute vec3 color; uniform float uPx; varying vec3 vC; varying vec3 vP;
      void main() { vC = color; vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(2.0, 0.0038 * uPx / max(0.02, -mv.z)); }`,
    fragmentShader: /* glsl */`precision highp float; varying vec3 vC; varying vec3 vP;
      ${WATER_GLSL}
      void main() { vec2 c = gl_PointCoord - 0.5; if (abs(c.x) + abs(c.y) * 1.6 > 0.5) discard;
        gl_FragColor = vec4(waterFog(vC * (uTankLight * 0.9 + uAmb * 0.35), vP), 1.0); ${TAIL} }`,
  });
  const flakePts = new THREE.Points(flakeGeo, flakeMat); flakePts.frustumCulled = false; scene.add(flakePts);
  const FLAKE_COLS = [[0.75, 0.16, 0.08], [0.85, 0.50, 0.10], [0.30, 0.42, 0.10], [0.80, 0.68, 0.22]];
  const feedAt = b2t(T.feed);
  const feeds = [];
  /** A pinch of flakes on the surface. Returns false when the fish have had plenty for now. */
  function feed(now = performance.now()) {
    while (feeds.length && now - feeds[0] > 90000) feeds.shift();
    if (feeds.length >= 3) return false;
    feeds.push(now);
    for (let i = 0; i < 20 && flakes.length < FLAKES; i++) {
      const c = FLAKE_COLS[Math.floor(rnd() * FLAKE_COLS.length)];
      flakes.push({ pos: new THREE.Vector3(feedAt.x + (rnd() - 0.5) * 0.10, hi.y - 0.002, feedAt.z + (rnd() - 0.5) * 0.30), float: 0.6 + rnd() * 4.5, sink: 0.010 + rnd() * 0.012, seed: rnd() * 100, rest: 0, c });
    }
    for (const f of fishes) f.appetite = f.kind === 'pleco' ? 0 : 3 + Math.floor(rnd() * 3);
    return true;
  }
  function stepFlakes(dt, time) {
    for (let i = flakes.length - 1; i >= 0; i--) {
      const f = flakes[i];
      if (f.float > 0) f.float -= dt;
      else {
        const floor = gravelAt(f.pos.x, f.pos.z) + 0.003;
        if (f.pos.y > floor) { f.pos.y -= f.sink * dt; f.pos.x += Math.sin(time * 2.1 + f.seed) * 0.006 * dt; f.pos.z += Math.cos(time * 1.7 + f.seed * 1.3) * 0.006 * dt; }
        else if ((f.rest += dt) > 25) { flakes.splice(i, 1); continue; }
      }
      f.pos.x = clamp(f.pos.x, lo.x + 0.004, hi.x - 0.004); f.pos.z = clamp(f.pos.z, lo.z + 0.004, hi.z - 0.004);
    }
    for (let i = 0; i < flakes.length; i++) { flakes[i].pos.toArray(flakePos, i * 3); flakeCol.set(flakes[i].c, i * 3); }
    flakeGeo.setDrawRange(0, flakes.length); flakeGeo.attributes.position.needsUpdate = true; flakeGeo.attributes.color.needsUpdate = true;
  }
  /** Something with a mouth at `p` eats the nearest flake within reach. */
  function eatNear(p, reach) {
    for (let i = 0; i < flakes.length; i++) if (flakes[i].pos.distanceToSquared(p) < reach * reach) { flakes.splice(i, 1); return true; }
    return false;
  }

  // ---------------------------------------------------------------- fish
  const light = { glsl: TANK_FISH_LIGHT, uniforms: U };
  const CAST = [['neon', 7], ['platy', 3], ['danio', 3], ['angel', 1], ['cory', 2], ['pleco', 1]];
  const schools = {}, fishes = [];
  const band = { neon: [0.30, 0.62], platy: [0.35, 0.80], danio: [0.72, 0.93], angel: [0.38, 0.72], cory: [0, 0], pleco: [0, 0] };
  const parkSpots = [[2.93, -1.37, 0.012], [3.05, -1.0, 0.118], [2.90, -1.16, 0.012], [3.03, -1.58, 0.012]].map(([x, y, dz]) => new THREE.Vector3(x, gravelAt(x, -y) + dz, -y));
  const groups = {};                        // a shared roaming point per schooling species
  const randomPoint = (kind, out) => {
    const x = lo.x + 0.03 + rnd() * (hi.x - lo.x - 0.06), z = lo.z + 0.05 + rnd() * (hi.z - lo.z - 0.10), g0 = gravelAt(x, z), [a, b] = band[kind];
    return out.set(x, kind === 'cory' ? g0 + 0.016 : g0 + 0.02 + (a + (b - a) * rnd()) * (hi.y - g0 - 0.03), z);
  };
  for (const [kind, n] of CAST) {
    const sc = (schools[kind] = createSchool(kind, n, light)); scene.add(sc.mesh);
    groups[kind] = { target: randomPoint(kind, new THREE.Vector3()), next: 0 };
    for (let i = 0; i < n; i++) {
      const f = { kind, sp: sc.sp, school: sc, i, index: fishes.length, pos: randomPoint(kind, new THREE.Vector3()), dir: new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize(),
        speed: sc.sp.cruise, phase: rnd() * 6.28, bend: 0, roll: 0, target: new THREE.Vector3(), next: 0, wait: 0, mode: 'swim', appetite: 0, hot: 0,
        size: sc.sp.len * (0.9 + 0.2 * rnd()), off: new THREE.Vector3((rnd() - 0.5) * 0.09, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.12), boost: 1 };
      if (kind === 'pleco') { f.mode = 'park'; f.spot = 0; f.pos.copy(parkSpots[0]); f.dir.set(-0.5, 0.25, 0.85).normalize(); f.next = 30 + rnd() * 20; }
      sc.setTint(i, rnd()); fishes.push(f);
    }
  }
  let player = null;                                          // the fish the visitor is steering
  const desired = new THREE.Vector3(), tmp = new THREE.Vector3(), prev = new THREE.Vector3();
  function stepFish(f, dt, time) {
    if (f === player) { f.phase += dt * (5 + f.speed * 105); return; }
    if (f.mode === 'park') {
      f.phase += dt * 1.5; f.speed = 0;
      if (time > f.next && !still) { f.spot = (f.spot + 1 + Math.floor(rnd() * (parkSpots.length - 1))) % parkSpots.length; f.target.copy(parkSpots[f.spot]); f.mode = 'swim'; f.next = time + 30; }
      return;
    }
    const grp = groups[f.kind], schooling = f.kind === 'neon' || f.kind === 'danio';
    if (schooling) {
      if (player && player.kind === f.kind) grp.target.copy(player.pos).addScaledVector(player.dir, -0.04);      // the school follows its own kind
      else if (time > grp.next || f.i === 0 && f.pos.distanceToSquared(grp.target) < 0.0025) { randomPoint(f.kind, grp.target); grp.next = time + 4 + rnd() * 6; }
      f.target.copy(grp.target).add(f.off);
    } else if (f.kind !== 'pleco' && (time > f.next || f.pos.distanceToSquared(f.target) < 0.0004)) {
      if (f.kind === 'cory' && f.wait <= 0 && rnd() < 0.6) f.wait = 0.8 + rnd() * 2.5;
      randomPoint(f.kind, f.target); f.next = time + 5 + rnd() * 8;
    }
    let want = f.sp.cruise;
    if (f.appetite > 0 && flakes.length) {                      // go for the nearest flake
      let best = null, bd = 1e9;
      for (const fl of flakes) { const d = fl.pos.distanceToSquared(f.pos); if (d < bd) { bd = d; best = fl; } }
      f.target.copy(best.pos); want *= 2.2;
      tmp.copy(f.pos).addScaledVector(f.dir, f.size * 0.45);
      if (eatNear(tmp, 0.012 + f.size * 0.2)) f.appetite--;
    } else if (f.wait > 0) { f.wait -= dt; want = 0.004; }
    desired.copy(f.target).sub(f.pos);
    const dist = desired.length(); if (dist > 1e-5) desired.multiplyScalar(1 / dist);
    if (f.kind === 'pleco' && dist < 0.02) { f.mode = 'park'; f.next = time + 25 + rnd() * 30; return; }
    for (const o of fishes) {                                   // keep a little room between bodies
      if (o === f) continue;
      const r = (f.size + o.size) * (o === player ? 1.1 : 0.75), d2 = tmp.copy(f.pos).sub(o.pos).lengthSq();
      if (d2 < r * r && d2 > 1e-9) { const d = Math.sqrt(d2); desired.addScaledVector(tmp, (r - d) / r * 2.2 / d); }
    }
    for (const c of colliders) {                                // steer around the rocks before touching them
      tmp.copy(f.pos).sub(c.c); const m = 0.03, d = Math.sqrt((tmp.x / (c.r.x + m)) ** 2 + (tmp.y / (c.r.y + m)) ** 2 + (tmp.z / (c.r.z + m)) ** 2);
      if (d < 1 && d > 1e-5) desired.addScaledVector(tmp.normalize(), (1 - d) * 4);
    }
    const wm = 0.035;                                           // and away from the glass
    if (f.pos.x < lo.x + wm) desired.x += (lo.x + wm - f.pos.x) / wm; if (f.pos.x > hi.x - wm) desired.x -= (f.pos.x - hi.x + wm) / wm;
    if (f.pos.z < lo.z + wm) desired.z += (lo.z + wm - f.pos.z) / wm; if (f.pos.z > hi.z - wm) desired.z -= (f.pos.z - hi.z + wm) / wm;
    desired.y = clamp(desired.y, -0.6, 0.6); desired.normalize();
    prev.copy(f.dir);
    const ang = f.dir.angleTo(desired);
    if (ang > 1e-4) f.dir.lerp(desired, Math.min(1, f.sp.turn * dt / ang)).normalize();
    const yawRate = (prev.x * f.dir.z - prev.z * f.dir.x) / Math.max(dt, 1e-3);
    f.bend += (clamp(-yawRate * 0.10, -0.30, 0.30) - f.bend) * Math.min(1, dt * 6);
    f.speed += (want * (0.45 + 0.55 * Math.min(1, dist / 0.05)) - f.speed) * Math.min(1, dt * 2.5);
    f.pos.addScaledVector(f.dir, f.speed * dt);
    constrain(f.pos, f.size * 0.3);
    f.phase += dt * (4 + f.speed * 105);
  }

  /** Hand a fish back to the simulation after the visitor has been steering it. */
  function release(f) {
    f.roll = 0; f.bend = 0; f.wait = 0; f.next = 0; f.speed = Math.min(f.speed, f.sp.cruise);
    if (f.kind === 'pleco') {                                   // it swims to the nearest resting place and settles there
      let best = 0; parkSpots.forEach((s, i) => { if (s.distanceToSquared(f.pos) < parkSpots[best].distanceToSquared(f.pos)) best = i; });
      f.spot = best; f.target.copy(parkSpots[best]); f.mode = 'swim'; f.next = simTime + 30;
    } else { f.mode = 'swim'; randomPoint(f.kind, f.target); f.next = simTime + 4; }
    if (player === f) player = null;
  }
  let hover = -1, simTime = 0;
  const sphere = new THREE.Sphere();
  /** Nearest fish along a ray (generous spheres: they are small and they move). */
  function pickFish(ray) {
    let best = null;
    for (const f of fishes) {
      sphere.center.copy(f.pos); sphere.radius = Math.max(f.size * 0.55, 0.019);
      const hit = ray.intersectSphere(sphere, tmp); if (!hit) continue;
      const d = hit.distanceTo(ray.origin); if (!best || d < best.dist) best = { index: f.index, dist: d, fish: f };
    }
    return best;
  }

  function toggle(key, on) { state[key] = on === undefined ? !state[key] : !!on; if (key === 'bubbler') { bubbles.uniforms[state.bubbler ? 'uOnAt' : 'uOffAt'].value = U.uWTime.value; bubbles.uniforms.uOn.value = state.bubbler ? 1 : 0; } }
  /** Off -> daylight -> daylight + blue -> blue -> off. */
  function cycleLights() { const s = (state.day ? 1 : 0) + (state.blue ? 2 : 0), n = { 0: 1, 1: 3, 3: 2, 2: 0 }[s]; state.day = !!(n & 1); state.blue = !!(n & 2); }
  const lightName = () => (state.day && state.blue ? 'daylight and blue' : state.day ? 'daylight' : state.blue ? 'blue moonlight' : 'off');

  const RAVE_COLS = [new THREE.Color(1.0, 0.05, 0.6), new THREE.Color(0.1, 0.9, 1.0), new THREE.Color(0.5, 1.0, 0.1), new THREE.Color(1.0, 0.55, 0.0), new THREE.Color(0.55, 0.2, 1.0)];
  const raveCol = new THREE.Color();
  /** Advance the tank. Returns true while a light level is still easing (the lightmaps need recompositing). */
  function update(dt, time, { camera, pxHeight, inside = false, beat = null }) {
    const sdt = still ? 0 : dt; simTime += sdt;
    U.uWTime.value = simTime;
    let easing = false;
    for (const k of ['day', 'blue']) { const t = state[k] ? 1 : 0, d = t - lvl[k]; if (d !== 0) { lvl[k] = Math.abs(d) < 0.004 ? t : lvl[k] + d * (1 - Math.exp(-dt * 7)); easing = true; } }
    applyLight();
    addc(surfMat.uniforms.uTubes.value.copy(DAY).multiplyScalar(2.2 * lvl.day), BLUE, 2.2 * lvl.blue);
    glassMat.uniforms.uCamIn.value = inside ? 1 : 0;
    for (const g of glass) g.renderOrder = inside ? 8 : 12;
    bubbles.uniforms.uPx.value = pxHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    // the light leaking from under the rock: slow colour drift from the room, on the beat once the music is audible
    const b = beat == null ? simTime * 0.5 : beat, i0 = Math.floor(b) % RAVE_COLS.length, fr = b - Math.floor(b);
    raveCol.copy(RAVE_COLS[(i0 + RAVE_COLS.length) % RAVE_COLS.length]).lerp(RAVE_COLS[(i0 + 1) % RAVE_COLS.length], beat == null ? fr : Math.min(1, fr * 4));
    const pulse = beat == null || reduceMotion ? 0.8 : 0.45 + 0.75 * Math.exp(-fr * 3.5);
    U.uRaveCol.value.copy(raveCol).multiplyScalar(rave.glow * pulse);
    if (sdt > 0) { for (const f of fishes) stepFish(f, sdt, simTime); if (flakes.length) stepFlakes(sdt, simTime); else if (flakeGeo.drawRange.count) flakeGeo.setDrawRange(0, 0); }
    for (const f of fishes) { f.hot += ((f.index === hover ? 1 : 0) - f.hot) * Math.min(1, dt * 12); f.school.set(f.i, f.pos, f.dir, f.roll, f.size, f.phase, f.bend, f.hot); }
    for (const k in schools) schools[k].commit();
    plants.mat.uniforms.uPush.value.copy(player ? player.pos : tmp.set(0, -9, 0));
    return easing;
  }
  applyLight();

  return {
    T, state, lvl, tint, rave, fishes, flakes, schools, colliders, cave, lo, hi, light,
    update, constrain, gravelAt, pickFish, feed, eatNear, toggle, cycleLights, lightName, release,
    setHover(i) { hover = i; }, setGlassHot(v) { glassMat.uniforms.uHot.value = v; },
    get player() { return player; }, setPlayer(f) { player = f || null; },
    get time() { return simTime; },
  };
}
