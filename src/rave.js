// "The Gravel Pit": the party under the rock. Bigger inside than the rock is outside, so it is its own small scene
// (nothing baked, nothing shared with the room except the fish kit), drawn instead of the room while you are in it.
// Lighting is analytic in every shader: four moving heads, a mirror ball's dots, UV lamps and a colour wash, all
// driven by the music's beat clock (fishaudio.js). Units are metres, the same fish sizes as in the tank.
import * as THREE from 'three';
import { NOISE_GLSL } from './water.js';
import { SPECIES, createSchool, mulberry32 } from './fishkit.js';

const R = 0.56, H = 0.40;                       // cavern half-width and height
const TAIL = /* glsl */`
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;
const ADD = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
const VERT = /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`;

export const RAVE_GLSL = /* glsl */`
uniform float uBallRot, uBallI, uStrobe, uUV;
uniform vec3 uSpotPos[4]; uniform vec3 uSpotDir[4]; uniform vec3 uSpotCol[4];
uniform vec3 uBallPos, uWash, uFogCol;
${NOISE_GLSL}
vec3 raveLight(vec3 P, vec3 N) {
  vec3 L = uWash * (0.55 + 0.45 * N.y);
  for (int i = 0; i < 4; i++) {
    vec3 d = P - uSpotPos[i]; float dist = length(d); d /= dist;
    float cone = smoothstep(0.945, 0.985, dot(d, uSpotDir[i]));
    L += uSpotCol[i] * cone * (0.25 + 0.75 * max(dot(N, -d), 0.0)) * 1.0 / (0.25 + dist * dist * 5.0);
  }
  vec3 bd = normalize(P - uBallPos);                         // the mirror ball throws a turning lattice of dots
  float ca = cos(uBallRot), sa = sin(uBallRot); vec3 r = vec3(bd.x * ca - bd.z * sa, bd.y, bd.x * sa + bd.z * ca);
  vec2 g = vec2(atan(r.z, r.x) * 4.4563, asin(clamp(r.y, -1.0, 1.0)) * 8.0), id = floor(g), f = fract(g) - 0.5;
  float dots = smoothstep(0.26, 0.12, length(f)) * step(0.45, h21(id));
  vec3 dc = 0.55 + 0.45 * cos(6.2831 * (h21(id + 7.7) + vec3(0.0, 0.33, 0.67)));
  L += dc * dots * uBallI * (0.3 + 0.7 * max(dot(N, -bd), 0.0));
  L += vec3(0.85, 0.92, 1.0) * uStrobe * (0.5 + 0.5 * N.y);
  vec3 bq = P - vec3(0.0, 0.16, -0.40); L += vec3(1.0, 0.72, 0.42) * 0.9 / (1.0 + 260.0 * dot(bq, bq));      // a work light over the decks
  return L;
}
vec3 raveFog(vec3 c, vec3 P) { return mix(uFogCol, c, exp(-distance(cameraPosition, P) * 1.3)); }`;
export const RAVE_FISH_LIGHT = /* glsl */`
${RAVE_GLSL}
vec3 shade(vec3 P, vec3 N, vec3 V, vec3 albedo, float glow, float fin) {
  vec3 c = albedo * raveLight(P, N) + albedo * glow * uUV * 2.4;            // under UV the stripes fluoresce
  c += uWash * pow(max(dot(N, normalize(V + vec3(0.0, 1.0, 0.0))), 0.0), 20.0) * 0.6 * (1.0 - fin);
  return raveFog(c, P);
}`;

const PAL = [[1.0, 0.05, 0.55], [0.05, 0.85, 1.0], [0.45, 1.0, 0.08], [1.0, 0.50, 0.0], [0.55, 0.18, 1.0], [1.0, 0.95, 0.2]].map((c) => new THREE.Color(...c));

export function createRave({ reduceMotion = false } = {}) {
  const scene = new THREE.Scene();
  const rnd = mulberry32(140);
  const ballPos = new THREE.Vector3(0, 0.265, -0.02);
  const RU = {
    uBallRot: { value: 0 }, uBallI: { value: 0.6 }, uStrobe: { value: 0 }, uUV: { value: 0.6 },
    uSpotPos: { value: [[-0.26, 0.335, 0.16], [0.26, 0.335, 0.16], [-0.24, 0.335, -0.22], [0.24, 0.335, -0.22]].map((p) => new THREE.Vector3(...p)) },
    uSpotDir: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, -1, 0)) }, uSpotCol: { value: [0, 1, 2, 3].map(() => new THREE.Color(0, 0, 0)) },
    uBallPos: { value: ballPos }, uWash: { value: new THREE.Color(0.05, 0.02, 0.1) }, uFogCol: { value: new THREE.Color(0.01, 0.005, 0.03) },
  };
  const light = { glsl: RAVE_FISH_LIGHT, uniforms: RU };
  /** A lit surface: `body` sets `vec3 albedo` and may add to `vec3 em` (emission). */
  const lit = (body, extra = {}, opt = {}) => new THREE.ShaderMaterial({
    uniforms: { ...RU, ...extra }, vertexShader: VERT, side: opt.side ?? THREE.FrontSide,
    fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      ${RAVE_GLSL}
      ${opt.decl || ''}
      void main() { vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; vec3 albedo = vec3(0.2), em = vec3(0.0);
        ${body}
        gl_FragColor = vec4(raveFog(albedo * raveLight(vP, N) + em, vP), 1.0); ${TAIL} }`,
  });
  const glow = (body, extra = {}, opt = {}) => new THREE.ShaderMaterial({
    uniforms: { ...RU, ...extra }, vertexShader: opt.vert || VERT, side: THREE.DoubleSide, ...ADD,
    fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; varying vec3 vN; varying vec3 vP; ${opt.decl || ''}
      void main() { vec3 c = vec3(0.0); ${body} gl_FragColor = vec4(c, 0.0); ${TAIL} }`,
  });
  const add = (mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); scene.add(mesh); return mesh; };

  // ---- the cavern: a lumpy dome whose lower half is pressed flat into a sand floor
  const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const L = (a, b, t) => a + (b - a) * t;
    return L(L(L(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), L(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
      L(L(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), L(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v), w);
  };
  {
    const g = new THREE.IcosahedronGeometry(1, 14), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.16 * (vn(x * 2.6 + 3, y * 2.6, z * 2.6) - 0.5) + 0.07 * (vn(x * 7, y * 7 + 5, z * 7) - 0.5);
      p.setXYZ(i, x * R * 1.04 * k, y > 0 ? y * H * 1.05 * k : 0.004 * Math.sin(x * 40) * Math.sin(z * 33), z * R * 1.04 * k);
    }
    g.computeVertexNormals();
    add(new THREE.Mesh(g, lit(/* glsl */`
      float floorK = smoothstep(0.03, 0.0, vP.y) * step(0.3, N.y);
      vec3 rock = mix(vec3(0.07, 0.065, 0.075), vec3(0.24, 0.21, 0.20), vnoise(vP * 22.0) * 0.6 + vnoise(vP * 70.0) * 0.4);
      vec3 sand = vec3(0.50, 0.43, 0.32) * (0.65 + 0.5 * vnoise(vP * 160.0)) * (0.85 + 0.3 * vnoise(vP * 18.0));
      albedo = mix(rock, sand, floorK);
      // UV paint daubed on the walls
      float sp = smoothstep(0.72, 0.76, vnoise(vP * 46.0 + 11.0)) * smoothstep(0.45, 0.62, vnoise(vP * 9.0)) * (1.0 - floorK) * smoothstep(0.03, 0.10, vP.y);
      em = (0.5 + 0.5 * cos(6.2831 * (vnoise(vP * 6.0) * 2.0 + vec3(0.0, 0.33, 0.67)))) * sp * uUV * 0.5;`, {}, { side: THREE.BackSide })));
  }

  // ---- mirror ball on a fishing line
  const ball = add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 28, 18), lit(/* glsl */`
      vec3 ln = normalize(vL); vec2 g = vec2(atan(ln.z, ln.x) * 5.4, asin(clamp(ln.y, -1.0, 1.0)) * 9.0), id = floor(g), f = abs(fract(g) - 0.5);
      float tile = smoothstep(0.5, 0.42, max(f.x, f.y));
      albedo = vec3(0.35) * tile;
      vec3 V = normalize(cameraPosition - vP); float sp = pow(h21(id + floor(uBallRot * 3.0)), 14.0);
      em = (uWash * 3.0 + uSpotCol[0] + uSpotCol[1] + uSpotCol[2] + uSpotCol[3]) * (0.10 + 2.5 * sp) * tile * (0.4 + 0.6 * max(dot(N, V), 0.0));`,
  {}, { decl: 'varying vec3 vL;' })), ballPos.x, ballPos.y, ballPos.z);
  ball.material.vertexShader = /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vL;
    void main() { vUv = uv; vL = position; vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.12, 5), lit('albedo = vec3(0.5);')), ballPos.x, ballPos.y + 0.10, ballPos.z);

  // ---- moving heads: a small housing on the ceiling and a visible beam through the murk
  const beams = RU.uSpotPos.value.map((p, i) => {
    add(new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), lit('albedo = vec3(0.04); em = uSpotCol[IDX] * 0.6;'.replace('IDX', i))), p.x, p.y + 0.008, p.z);
    const g = new THREE.ConeGeometry(1, 1, 24, 1, true); g.translate(0, -0.5, 0);
    const m = glow(/* glsl */`vec3 V = normalize(cameraPosition - vP); float edge = pow(abs(dot(normalize(vN), V)), 2.2);
      c = uCol * edge * (0.15 + 0.85 * vUv.y) * smoothstep(1.0, 0.9, vUv.y);`, { uCol: { value: new THREE.Color() }, uS: { value: new THREE.Vector3(1, 1, 1) } },
      { decl: 'uniform vec3 uCol;', vert: /* glsl */`uniform vec3 uS; varying vec2 vUv; varying vec3 vN; varying vec3 vP;
        void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix) * (normal / (uS * uS))); gl_Position = projectionMatrix * viewMatrix * wp; }` });
    const mesh = add(new THREE.Mesh(g, m), p.x, p.y, p.z); mesh.frustumCulled = false; return mesh;
  });

  // ---- lasers: thin additive bars fanning out from two emitters beside the booth
  const NL = 12, laserGeo = new THREE.BoxGeometry(1, 1, 1); laserGeo.translate(0, 0, 0.5);
  const laserCol = new THREE.InstancedBufferAttribute(new Float32Array(NL * 3), 3); laserGeo.setAttribute('aCol', laserCol);
  const lasers = new THREE.InstancedMesh(laserGeo, new THREE.ShaderMaterial({ ...ADD, uniforms: { uI: { value: 0 } },
    vertexShader: `attribute vec3 aCol; varying vec3 vC; void main() { vC = aCol; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; varying vec3 vC; uniform float uI; void main() { gl_FragColor = vec4(vC * uI, 0.0); ${TAIL} }` }), NL);
  lasers.frustumCulled = false; scene.add(lasers);
  const laserSrc = [new THREE.Vector3(-0.17, 0.20, -0.47), new THREE.Vector3(0.17, 0.20, -0.47)];

  // ---- DJ booth: a slab on two stones, two decks (compact discs), a mixer
  const stone = lit('albedo = mix(vec3(0.10), vec3(0.24, 0.22, 0.20), vnoise(vP * 60.0));');
  add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.022, 0.095), stone), 0, 0.066, -0.37);
  for (const sx of [-0.09, 0.09]) add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.058, 0.07), stone), sx, 0.028, -0.37);
  const deckMat = lit(/* glsl */`vec2 q = vUv - 0.5; float r = length(q) * 2.0, a = atan(q.y, q.x) + uSpin;
      vec3 V = normalize(cameraPosition - vP);
      vec3 rb = 0.5 + 0.5 * cos(6.2831 * (r * 1.3 + a * 0.32 + dot(N, V)) + vec3(0.0, 2.1, 4.2));
      albedo = mix(vec3(0.5), rb, 0.7) * step(0.16, r) * step(r, 1.0) + vec3(0.03) * step(r, 0.16);
      em = rb * 0.10 * step(0.16, r) * step(r, 1.0); if (r > 1.0) discard;`, { uSpin: { value: 0 } }, { decl: 'uniform float uSpin;' });
  for (const sx of [-0.07, 0.07]) { const d = add(new THREE.Mesh(new THREE.CircleGeometry(0.032, 32), deckMat), sx, 0.0782, -0.37); d.rotation.x = -Math.PI / 2; }
  add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.05), lit(/* glsl */`albedo = vec3(0.03);
      vec2 g = fract(vP.xz * 110.0) - 0.5; float led = smoothstep(0.22, 0.1, length(g)) * step(0.5, N.y) * step(0.55, h21(floor(vP.xz * 110.0) + floor(uTick)));
      em = mix(vec3(0.1, 1.0, 0.2), vec3(1.0, 0.2, 0.1), h21(floor(vP.xz * 110.0))) * led * 1.5;`, { uTick: { value: 0 } }, { decl: 'uniform float uTick;' })), 0, 0.083, -0.37);
  const mixerMat = scene.children[scene.children.length - 1].material;

  // ---- speaker stacks; the woofers pump with the kick
  const woofers = [];
  const cabinet = lit('albedo = vec3(0.035, 0.035, 0.04) + 0.02 * vnoise(vP * 300.0);');
  const coneMat = lit(/* glsl */`float r = length(vUv - 0.5) * 2.0; albedo = mix(vec3(0.05), vec3(0.16), smoothstep(0.9, 0.2, r)) * (0.6 + 0.4 * sin(r * 30.0));
      em = uRing * smoothstep(0.08, 0.0, abs(r - 0.92)) * 1.2;`, { uRing: { value: new THREE.Color() } }, { decl: 'uniform vec3 uRing;' });
  for (const sx of [-1, 1]) {
    const grp = new THREE.Group(); grp.position.set(sx * 0.31, 0, -0.33); grp.rotation.y = -sx * 0.5; scene.add(grp);
    for (let k = 0; k < 2; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.105, 0.075), cabinet); b.position.set(0, 0.0525 + k * 0.107, 0); grp.add(b);
      const c = new THREE.Mesh(new THREE.CircleGeometry(0.038, 28), coneMat); c.position.set(0, 0.0525 + k * 0.107, 0.0380); grp.add(c); woofers.push(c);
    }
  }

  // ---- signs (canvas textures; additive so they read as tube light)
  const sign = (text, w, h, color, font, px = 512) => {
    const c = document.createElement('canvas'); c.width = px; c.height = Math.round(px * h / w); const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.lineJoin = 'round';
    for (const [blur, a] of [[28, 0.9], [12, 1], [0, 1]]) { g.shadowBlur = blur; g.globalAlpha = a; g.strokeStyle = blur ? color : '#fff'; g.lineWidth = blur ? 7 : 2.2; g.strokeText(text, c.width / 2, c.height / 2 + 2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), glow('c = texture2D(map, vUv).rgb * uI;', { map: { value: t }, uI: { value: 1.5 } }, { decl: 'uniform sampler2D map; uniform float uI;' }));
  };
  const neon = add(sign('THE GRAVEL PIT', 0.30, 0.075, '#ff2aa8', 'italic 700 86px Georgia, "Times New Roman", serif'), 0, 0.235, -0.405); neon.rotation.x = 0.22;
  const exitSign = add(sign('EXIT', 0.07, 0.035, '#35ff6a', '700 150px Arial, Helvetica, sans-serif', 384), 0, 0.118, 0.512); exitSign.rotation.y = Math.PI;
  // the way out: a dark mouth in the wall under the sign
  const mouth = add(new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.016, 10, 20, Math.PI), stone), 0, 0.0, 0.535);
  add(new THREE.Mesh(new THREE.CircleGeometry(0.046, 20, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x000000 })), 0, 0.0, 0.531).rotation.y = Math.PI;
  mouth.rotation.y = Math.PI;
  const exitAt = new THREE.Vector3(0, 0.034, 0.505), spawn = { pos: new THREE.Vector3(0, 0.07, 0.40), yaw: -Math.PI / 2 };

  // ---- glowing corals around the edge
  const NC = 70, coralGeo = new THREE.CylinderGeometry(0.4, 1, 1, 6, 1); coralGeo.translate(0, 0.5, 0);
  const coralCol = new THREE.InstancedBufferAttribute(new Float32Array(NC * 3), 3); coralGeo.setAttribute('aCol', coralCol);
  const corals = new THREE.InstancedMesh(coralGeo, new THREE.ShaderMaterial({ uniforms: { ...RU, uPulse: { value: 0 }, uT: { value: 0 } },
    vertexShader: /* glsl */`attribute vec3 aCol; varying vec3 vC; varying vec3 vP; varying float vH; uniform float uT;
      void main() { vC = aCol; vH = position.y; vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        wp.xz += vec2(sin(uT * 1.3 + wp.x * 30.0), cos(uT * 1.1 + wp.z * 30.0)) * 0.004 * position.y; vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`precision highp float; varying vec3 vC; varying vec3 vP; varying float vH; uniform float uPulse;
      ${RAVE_GLSL}
      void main() { vec3 c = vC * (0.10 + (0.5 + 0.8 * vH) * uUV * (0.7 + 0.6 * uPulse)); gl_FragColor = vec4(raveFog(c, vP), 1.0); ${TAIL} }` }), NC);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(); let n = 0;
    for (let c = 0; c < 10 && n < NC; c++) {
      const a = 0.5 + c * 0.6 + rnd() * 0.3, rr = 0.42 + rnd() * 0.06, col = PAL[c % PAL.length];
      if (Math.abs(Math.sin(a)) > 0.93 && Math.cos(a) < 0.2) continue;                  // keep the booth wall and the exit clear
      for (let k = 0; k < 7 && n < NC; k++, n++) {
        p.set(Math.cos(a) * rr + (rnd() - 0.5) * 0.06, 0, Math.sin(a) * rr + (rnd() - 0.5) * 0.06); e.set((rnd() - 0.5) * 0.5, rnd() * 6, (rnd() - 0.5) * 0.5); q.setFromEuler(e);
        const w = 0.005 + rnd() * 0.006; s.set(w, 0.03 + rnd() * 0.08, w); corals.setMatrixAt(n, m.compose(p, q, s)); coralCol.setXYZ(n, col.r, col.g, col.b);
      }
    }
    corals.count = n; corals.frustumCulled = false; scene.add(corals);
  }

  // ---- bubbles hanging in the beams
  const haze = (() => {
    const n = 140, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * R * 0.85; pos.set([Math.cos(a) * r, 0, Math.sin(a) * r], i * 3); seed[i] = rnd(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({ ...ADD, uniforms: { ...RU, uT: { value: 0 }, uPx: { value: 800 } },
      vertexShader: /* glsl */`attribute float aSeed; uniform float uT, uPx; varying vec3 vP; varying float vA;
        void main() { vec3 p = position; float life = fract(uT * (0.03 + 0.04 * aSeed) + aSeed * 9.0); p.y = life * 0.36; p.xz += vec2(sin(uT * 0.7 + aSeed * 40.0), cos(uT * 0.6 + aSeed * 31.0)) * 0.012;
          vP = p; vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(1.5, (0.002 + 0.004 * fract(aSeed * 5.0)) * uPx / max(0.02, -mv.z));
          vA = smoothstep(0.0, 0.05, life) * smoothstep(1.0, 0.9, life); }`,
      fragmentShader: /* glsl */`precision highp float; varying vec3 vP; varying float vA;
        ${RAVE_GLSL}
        void main() { float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; float ring = smoothstep(0.5, 0.95, d) + 0.2;
          gl_FragColor = vec4(raveLight(vP, vec3(0.0, 1.0, 0.0)) * ring * vA * 0.5, 0.0); ${TAIL} }` });
    const p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p); return m;
  })();

  // ---- the crowd
  const want = { neon: 12, platy: 5, danio: 5, angel: 2, cory: 3, pleco: 1 };
  const schools = {}, dancers = [];
  for (const k in want) { schools[k] = createSchool(k, want[k], light); scene.add(schools[k].mesh); }
  const used = {};
  const dancer = (kind, style, x, y, z, extra = {}) => {
    const i = (used[kind] = (used[kind] ?? -1) + 1), sc = schools[kind];
    sc.setTint(i, rnd());
    dancers.push({ kind, sc, i, style, base: new THREE.Vector3(x, y, z), pos: new THREE.Vector3(x, y, z), dir: new THREE.Vector3(0, 0, -1), ph: rnd() * 6.283, size: sc.sp.len * (0.9 + 0.25 * rnd()), push: new THREE.Vector3(), ...extra });
  };
  dancer('pleco', 5, 0, 0.125, -0.455, { size: 0.125 });                                            // the DJ
  for (let i = 0; i < 6; i++) dancer('neon', 2, 0, 0, 0, { ph: i / 6 * 6.283 });                     // a ring circling the mirror ball
  dancer('angel', 3, -0.20, 0.13, -0.20); dancer('angel', 3, 0.20, 0.13, -0.20);                    // podium dancers either side
  for (const sx of [-0.20, 0.20]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.05, 9), stone), sx, 0.025, -0.20);
  for (let i = 0; i < 3; i++) dancer('cory', 4, 0.34 + rnd() * 0.06, 0.012, 0.10 + i * 0.07);        // the chill-out corner
  const floorKinds = [['neon', 6], ['platy', 5], ['danio', 5]];
  for (const [kind, n] of floorKinds) for (let i = 0; i < n; i++) {
    let x, z; do { x = (rnd() - 0.5) * 0.52; z = -0.24 + rnd() * 0.52; } while (Math.hypot(x, z) > 0.33 || (Math.abs(Math.abs(x) - 0.20) < 0.07 && Math.abs(z + 0.20) < 0.07));
    dancer(kind, rnd() < 0.25 ? 1 : 0, x, 0.035 + rnd() * 0.10, z);
  }
  // glow sticks for some of the dancers on the floor
  const NG = 14, stickGeo = new THREE.CapsuleGeometry(0.0011, 0.010, 3, 6);
  const stickCol = new THREE.InstancedBufferAttribute(new Float32Array(NG * 3), 3); stickGeo.setAttribute('aCol', stickCol);
  const sticks = new THREE.InstancedMesh(stickGeo, new THREE.ShaderMaterial({ ...ADD, uniforms: {},
    vertexShader: `attribute vec3 aCol; varying vec3 vC; void main() { vC = aCol; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; varying vec3 vC; void main() { gl_FragColor = vec4(vC * 1.1, 0.0); ${TAIL} }` }), NG);
  sticks.frustumCulled = false; scene.add(sticks);
  const stickOwners = dancers.filter((d) => d.style <= 1).slice(0, NG);
  stickOwners.forEach((d, i) => { const c = PAL[i % PAL.length]; stickCol.setXYZ(i, c.r, c.g, c.b); });
  // headphones for the DJ
  const phones = new THREE.Group(); scene.add(phones);
  { const dark = lit('albedo = vec3(0.03); em = uWash * 0.3;');
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.0155, 0.0022, 6, 14, Math.PI), dark); band.rotation.y = Math.PI / 2; phones.add(band);
    for (const s of [-1, 1]) { const cup = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 10, 8), dark); cup.position.set(0, 0.001, s * 0.0155); phones.add(cup); } }

  // ---- the visitor
  const player = { kind: null, sc: null, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), speed: 0, phase: 0, bend: 0, roll: 0, size: 0.04 };
  function enter(kind, size) {
    if (player.sc) { scene.remove(player.sc.mesh); player.sc.mesh.geometry.dispose(); player.sc.mesh.material.dispose(); }
    player.kind = kind; player.size = size; player.sc = createSchool(kind, 1, light); scene.add(player.sc.mesh);
    player.pos.copy(spawn.pos); player.dir.set(0, 0, -1); player.speed = 0.05;
  }
  const obstacles = [[0, 0.06, -0.37, 0.14, 0.085, 0.07], [-0.31, 0.10, -0.33, 0.075, 0.12, 0.07], [0.31, 0.10, -0.33, 0.075, 0.12, 0.07], [ballPos.x, ballPos.y, ballPos.z, 0.05, 0.05, 0.05],
    [-0.20, 0.02, -0.20, 0.06, 0.04, 0.06], [0.20, 0.02, -0.20, 0.06, 0.04, 0.06]];
  /** Keep a sphere inside the cavern and out of the furniture. */
  function constrain(p, rad, cam = false) {
    for (const [cx, cy, cz, rx, ry, rz] of obstacles) {
      const lx = p.x - cx, ly = p.y - cy, lz = p.z - cz, d = Math.sqrt((lx / (rx + rad)) ** 2 + (ly / (ry + rad)) ** 2 + (lz / (rz + rad)) ** 2);
      if (d < 1 && d > 1e-5) p.set(cx + lx / d, cy + ly / d, cz + lz / d);
    }
    const m = cam ? 0.93 : 0.90, d = Math.sqrt((p.x / (R * m)) ** 2 + (Math.max(p.y, 0) / (H * m)) ** 2 + (p.z / (R * m)) ** 2);
    if (d > 1) { p.x /= d; p.y /= d; p.z /= d; }
    p.y = Math.max(p.y, cam ? 0.012 : rad * 0.9);
  }
  const atExit = (p) => p.distanceToSquared(exitAt) < 0.036 * 0.036;

  const tmp = new THREE.Vector3(), aim = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0), mtx = new THREE.Matrix4(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color(), eul = new THREE.Euler();
  let energy = 0.5, t = 0;
  /** info = { beat, bar, sec, frac } from the audio clock. */
  function update(dt, info, camera, pxHeight) {
    t += dt;
    const { beat, bar, sec, frac } = info, calm = reduceMotion;
    energy += ([0.55, 0.8, 0.22, 1.0][sec] - energy) * Math.min(1, dt * 1.5);
    const kick = sec === 2 ? 0 : calm ? 0.3 : Math.exp(-frac * 5);
    RU.uBallRot.value = calm ? t * 0.05 : beat * 0.11; RU.uBallI.value = sec === 2 ? 1.5 : 0.55 + 0.3 * kick;
    RU.uUV.value = 0.55 + 0.45 * (1 - energy) + 0.25 * kick;
    RU.uStrobe.value = !calm && sec === 3 && bar >= 30 ? 0.22 * Math.exp(-frac * 7) : 0;          // one soft flash per beat (2.3 per second), last two bars of the drop
    col.copy(PAL[Math.floor(beat / 8) % PAL.length]).lerp(PAL[(Math.floor(beat / 8) + 1) % PAL.length], (beat / 8) % 1);
    RU.uWash.value.copy(col).multiplyScalar(0.022 + 0.028 * energy + 0.035 * kick * energy).addScalar(0.008);
    RU.uFogCol.value.copy(col).multiplyScalar(0.006 + 0.010 * energy).addScalar(0.002);
    for (let i = 0; i < 4; i++) {
      const sp = sec === 2 ? 0.12 : 0.5 + 0.5 * energy, a = (calm ? t * 0.2 : beat * 0.5 * sp) * (i % 2 ? -1 : 1) + i * 1.571;
      const rr = 0.16 + 0.14 * Math.sin(a * 0.37 + i);
      aim.set(Math.cos(a) * rr * 1.3, 0, Math.sin(a) * rr - 0.04);
      const pos = RU.uSpotPos.value[i], dir = RU.uSpotDir.value[i].copy(aim).sub(pos); const len = dir.length(); dir.multiplyScalar(1 / len);
      const c = RU.uSpotCol.value[i].copy(sec === 2 ? PAL[1] : PAL[(bar + i * 2) % PAL.length]).multiplyScalar(sec === 2 ? 0.30 : 0.45 + 0.55 * energy + 0.35 * kick);
      const b = beams[i]; b.quaternion.setFromUnitVectors(DOWN, dir); b.scale.set(len * 0.21, len, len * 0.21); b.material.uniforms.uS.value.copy(b.scale);
      b.material.uniforms.uCol.value.copy(c).multiplyScalar(0.10);
    }
    // lasers: two fans, on for the arpeggio and the drop
    const li = sec === 1 || sec === 3 ? 0.55 + 0.3 * kick : 0; lasers.material.uniforms.uI.value += (li - lasers.material.uniforms.uI.value) * Math.min(1, dt * 6);
    for (let i = 0; i < NL; i++) {
      const s = laserSrc[i % 2], k = Math.floor(i / 2) - 2.5, sw = calm ? 0.2 : Math.sin(beat * 0.785 + (i % 2) * 1.57);
      aim.set((i % 2 ? -1 : 1) * (0.05 + k * 0.10 * (0.6 + 0.4 * sw)) + sw * 0.18, 0.02 + 0.10 * Math.abs(Math.sin(beat * 0.39 + k)), 0.42).sub(s);
      const len = aim.length(); tmp.copy(s).add(aim); mtx.lookAt(tmp, s, up); quat.setFromRotationMatrix(mtx); scl.set(0.0008, 0.0008, len);
      lasers.setMatrixAt(i, mtx.compose(s, quat, scl)); const c = i % 2 ? PAL[2] : PAL[(bar >> 1) % 2 ? 0 : 1]; laserCol.setXYZ(i, c.r, c.g, c.b);
    }
    lasers.instanceMatrix.needsUpdate = true; laserCol.needsUpdate = true;
    for (const w of woofers) { const s = 1 + 0.10 * kick; w.scale.set(s, s, 1); w.position.z = 0.038 + 0.004 * kick; }
    coneMat.uniforms.uRing.value.copy(col).multiplyScalar(0.4 + 1.2 * kick);
    deckMat.uniforms.uSpin.value = beat * 1.2; mixerMat.uniforms.uTick.value = beat * 4;
    neon.material.uniforms.uI.value = 0.95 + 0.35 * kick - (Math.sin(t * 13.0) > 0.97 && !calm ? 0.5 : 0);
    corals.material.uniforms.uPulse.value = kick; corals.material.uniforms.uT.value = t; haze.uniforms.uT.value = t;
    haze.uniforms.uPx.value = pxHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    // crowd
    const hop = calm ? 0.3 : Math.abs(Math.sin(beat * Math.PI)), e2 = 0.4 + 0.6 * energy;
    for (const d of dancers) {
      let yaw = 0, pitch = 0, roll = 0, tail = beat * Math.PI * 2 + d.ph;
      if (d.style === 2) {                       // conga ring
        const a = d.ph + (calm ? t * 0.3 : beat * 0.32);
        d.pos.set(ballPos.x + Math.cos(a) * 0.15, ballPos.y - 0.075 + 0.02 * Math.sin(beat * 1.57 + d.ph), ballPos.z + Math.sin(a) * 0.15); yaw = -a - Math.PI / 2 + Math.PI; roll = -0.4;
        d.dir.set(-Math.sin(a), 0, Math.cos(a));
      } else {
        d.pos.copy(d.base);
        if (d.style === 5) { pitch = -0.10 - 0.16 * hop * e2; yaw = 0; d.pos.y += 0.004 * hop; tail = beat * Math.PI + d.ph; }
        else if (d.style === 4) { yaw = 2.2 + 0.2 * Math.sin(t * 0.4 + d.ph); roll = 0.08 * Math.sin(beat * 0.785 + d.ph); tail = t * 2 + d.ph; }
        else if (d.style === 3) { d.pos.y += 0.022 * hop * e2; yaw = 0.5 * Math.sin(beat * 0.785 + d.ph); pitch = 0.25 * Math.sin(beat * 1.571 + d.ph) * e2; }
        else if (d.style === 1) { d.pos.y += 0.012 * hop * e2; yaw = d.ph + (calm ? t : beat * 1.571); roll = 0.3; }
        else { d.pos.y += 0.014 * hop * e2; yaw = Math.PI + 0.6 * Math.sin(beat * 0.785 + d.ph) * e2; roll = 0.35 * Math.sin(beat * Math.PI + d.ph) * e2; pitch = 0.15 * Math.sin(beat * 1.571 + d.ph); }
        d.dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      }
      if (d.style !== 5 && player.kind) {        // make room for the visitor
        tmp.copy(d.pos).sub(player.pos); const l = tmp.length(), rr = 0.07;
        d.push.lerp(l < rr && l > 1e-4 ? tmp.multiplyScalar((rr - l) / l) : tmp.set(0, 0, 0), Math.min(1, dt * 6)); d.pos.add(d.push);
      }
      d.sc.set(d.i, d.pos, d.dir, roll, d.size, tail, 0.12 * Math.sin(beat * Math.PI + d.ph));
    }
    for (const k in schools) schools[k].commit();
    stickOwners.forEach((d, i) => {
      const a = beat * Math.PI + i * 1.7; tmp.set(Math.sin(a) * 0.016, 0.012 + Math.sin(a * 2) * 0.008, 0.010).add(d.pos);
      scl.set(1, 1, 1); quat.setFromEuler(eul.set(a, a * 0.7, 0)); sticks.setMatrixAt(i, mtx.compose(tmp, quat, scl));
    });
    sticks.count = stickOwners.length; sticks.instanceMatrix.needsUpdate = true;
    { const dj = dancers[0]; phones.position.copy(dj.pos).addScaledVector(dj.dir, dj.size * 0.30); phones.position.y += dj.size * 0.085; phones.rotation.set(0, Math.atan2(dj.dir.x, dj.dir.z) - Math.PI / 2, 0); }
    if (player.sc) { player.sc.set(0, player.pos, player.dir, player.roll, player.size, player.phase, player.bend); player.sc.commit(); }
  }
  return { scene, light, player, enter, update, constrain, atExit, spawn, exitAt, dancers, RU, get energy() { return energy; } };
}
