import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { LayerCompositor, loadLayerTexture } from './lighting.js';
import { makeBakedMaterial, makeScreenMaterial, makeEmissiveMaterial, makeLavaMaterial, makeBulbMaterial, makeProxyMaterial } from './materials.js';
import { ITEM_DEFS, stereoRegion, STEREO_LABEL, keyFor, drawCalendar } from './items.js';
import { createTankUniforms } from './water.js';
import { createAquarium } from './aquarium.js';
import { SPECIES } from './fishkit.js';
import { createFishMode } from './fishmode.js';
import { createFishAudio } from './fishaudio.js';

const $ = (s) => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const ASSETS = /^[\w-]+$/.test(Q.get('assets') || '') ? `./${Q.get('assets')}/` : './assets/';   // ?assets=assets_draft for draft bakes
const b2t = (v) => new THREE.Vector3(v[0], v[2], -v[1]);      // Blender (Z up) -> three.js (Y up)
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (matchMedia('(pointer: coarse)').matches) $('#hint').textContent = 'Drag to look around · pinch to move closer · tap things';

const loaderEl = $('#loader'), barEl = $('#bar'), msgEl = $('#msg');
if (Q.has('still')) loaderEl.style.transition = 'none';
const progress = (f, msg) => { barEl.style.width = `${Math.round(f * 100)}%`; if (msg) msgEl.textContent = msg; };

boot().catch((err) => {
  console.error(err);
  loaderEl.classList.add('error');
  msgEl.textContent = `Could not start: ${err.message || err}`;
});

async function boot() {
  progress(0.03, 'Dialing up…');
  // room.glb, meta.json and the lightmaps must come from one bake, and the host caches assets/** for a day. The two
  // small JSON files are therefore always revalidated, and every other asset URL carries a fingerprint of them.
  const [metaTxt, lmTxt] = await Promise.all(['meta.json', 'lightmaps.json'].map((f) => fetch(ASSETS + f, { cache: 'no-cache' }).then((r) => r.text())));
  const meta = JSON.parse(metaTxt), lmInfo = JSON.parse(lmTxt);
  let fp = 2166136261;
  for (const t of [metaTxt, lmTxt]) for (let i = 0; i < t.length; i++) fp = Math.imul(fp ^ t.charCodeAt(i), 16777619);
  const BAKE = (fp >>> 0).toString(36);
  THREE.DefaultLoadingManager.setURLModifier((url) => (url.startsWith(ASSETS) && !url.includes('?') ? `${url}?v=${BAKE}` : url));
  const LAYERS = lmInfo.layers;

  // ------------------------------------------------------------------ renderers
  const canvas = $('#gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, reinhard: THREE.ReinhardToneMapping }[Q.get('tm') || 'neutral'] || THREE.NeutralToneMapping;
  const css = new CSS3DRenderer({ element: $('#css3d') });
  const scene = new THREE.Scene();
  const cssScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(31, 1.5, 0.03, 40);

  // ------------------------------------------------------------------ assets
  const texLoader = new THREE.TextureLoader();
  const jobs = [];
  let done = 0;
  const track = (p) => { jobs.push(p); p.then(() => { done++; progress(0.1 + 0.85 * done / jobs.length, 'Loading baked light…'); }); return p; };
  // site/ serves lossless RGBM PNGs; dist/ (npm run pack) serves WebP brightness + chroma ("yc"), see tools/pack_site.py
  const LM_ENC = lmInfo.encoding || 'rgbm', ENV_ENC = lmInfo.env_encoding || 'rgbm';
  const lmTex = {}; const envTex = {}; const chromaTex = {};
  for (const key of Object.keys(lmInfo.atlases)) {
    lmTex[key] = {};
    for (const l of Object.keys(lmInfo.atlases[key].layers)) track(loadLayerTexture(texLoader, ASSETS + lmInfo.atlases[key].layers[l].file).then((t) => { lmTex[key][l] = t; }));
    const ch = lmInfo.atlases[key].chroma;
    if (ch) track(loadLayerTexture(texLoader, ASSETS + ch.file).then((t) => { t.wrapS = THREE.ClampToEdgeWrapping; chromaTex[key] = t; }));
  }
  for (const l of LAYERS) {
    envTex[l] = [];
    lmInfo.env[l].files.forEach((f, i) => track(loadLayerTexture(texLoader, ASSETS + f).then((t) => { envTex[l][i] = t; })));
  }
  let gltf;
  const gltfLoader = new GLTFLoader();
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);   // dist/ geometry is meshopt-compressed (tools/pack_glb.mjs); unused for site/
  track(gltfLoader.loadAsync(ASSETS + 'room.glb').then((g) => { gltf = g; }));
  await Promise.all(jobs);
  progress(0.97, 'Warming up the CRT…');

  // ------------------------------------------------------------------ light compositors
  // HDR light sums need a float render target; fall back to scaled 8-bit where the GPU cannot render to one.
  const canFloat = Q.get('nofloat') !== '1' && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  const PACK_LM = canFloat ? 1 : 6, PACK_ENV = canFloat ? 1 : 12;
  const comp = {};
  for (const key of Object.keys(lmInfo.atlases)) {
    const info = lmInfo.atlases[key].layers;
    const names = Object.keys(info);          // each atlas carries only the light layers that apply to it
    const size = Math.max(...names.map((l) => info[l].size));
    const ch = lmInfo.atlases[key].chroma;
    if (ch && ch.order.join() !== names.join()) throw new Error(`chroma tiles of atlas ${key} are out of order`);
    comp[key] = new LayerCompositor(renderer, names.map((l) => ({ name: l, tex: lmTex[key][l], range: info[l].range })), size, size,
      { useFloat: canFloat, outScale: 1 / PACK_LM, encoding: LM_ENC, chroma: ch && { tex: chromaTex[key], tile: ch.tile, cols: ch.cols, rows: ch.rows } });
  }
  const envComp = lmInfo.env_levels.map((w, i) => new LayerCompositor(renderer,
    LAYERS.map((l) => ({ name: l, tex: envTex[l][i], range: lmInfo.env[l].range })), w, w / 2, { wrapS: THREE.RepeatWrapping, useFloat: canFloat, outScale: 1 / PACK_ENV, encoding: ENV_ENC }));

  // ------------------------------------------------------------------ materials
  const room = meta.room;
  const shared = {
    uDebug: { value: Q.get('lm') === '1' ? 1 : 0 },
    uLmScale: { value: PACK_LM }, uEnvScale: { value: PACK_ENV }, uPackSqrt: { value: canFloat ? 0 : 1 },
    uEnvPos: { value: b2t(meta.pano.pos) },
    uBoxMin: { value: new THREE.Vector3(0, 0, 0) },
    uBoxMax: { value: new THREE.Vector3(room.w, room.h, room.d) },
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    // per-item feedback and the vertex animations that leave the baked light untouched
    uHover: { value: new THREE.Vector2(0, 0) }, uKeys: { value: new Float32Array(112) },
    uKeyDown: { value: b2t(meta.keyboard.down).multiplyScalar(meta.keyboard.travel) },
    uMouseItem: { value: -1 }, uMouseOff: { value: new THREE.Vector3() }, uSway: { value: 0 }, uTime: { value: 0 }, uSpin: { value: 0 },
    uProxyLight: { value: new THREE.Color(0.3, 0.26, 0.2) },
    uRaise: { value: 0 }, uRaiseTop: { value: meta.window.z1 - 0.05 }, uStage: { value: 0 }, uWilt: { value: 0 }, uHideSub: { value: -1 }, uLeafFade: { value: 0 },
  };
  shared.tankU = createTankUniforms(meta, shared);      // null for asset sets baked before the aquarium existed
  const fx = {};
  const matCache = new Map();
  const pickables = [], matByName = {}, atlasMeshes = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    let atlas = null, name = o.name;
    for (let p = o; p; p = p.parent) {
      if (p.name && p.name.startsWith('fx_')) name = p.name;
      if (p.userData && p.userData.atlas) { atlas = p.userData.atlas; break; }
    }
    if (atlas) {
      const src = o.material;
      const k = atlas + ':' + src.uuid;
      if (!matCache.has(k)) {
        const lvl = src.roughness < 0.3 ? 0 : src.roughness < 0.5 ? 1 : 2;
        matCache.set(k, makeBakedMaterial(src, comp[atlas].texture, envComp[lvl].texture, shared, atlas));
      }
      o.material = matCache.get(k);
      if (atlas === 'A' || atlas === 'B' || !matByName[src.name]) matByName[src.name] = o.material;
      (atlasMeshes[atlas] ||= []).push(o); o.userData.atlasKey = atlas;
      pickables.push(o);
    } else {
      const fxName = name.replace(/_\d+$/, '');
      fx[fxName] = o;
      const key = meta.fx_items?.[fxName];
      if (key && key !== 'outside') { o.userData.itemKey = key; pickables.push(o); }
    }
  });
  scene.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);

  const screenMat = makeScreenMaterial(envComp[0].texture, shared);
  if (fx.fx_screen) fx.fx_screen.material = screenMat;
  const bulbMat = makeBulbMaterial();
  if (fx.fx_bulb) fx.fx_bulb.material = bulbMat;
  const backdropMat = makeEmissiveMaterial({ map: fx.fx_backdrop?.material.map || null, intensity: 2.5 });
  if (fx.fx_backdrop) fx.fx_backdrop.material = backdropMat;
  const displayMat = makeEmissiveMaterial({ map: fx.fx_stereo_display?.material.map || null, intensity: 0.5 });
  if (fx.fx_stereo_display) fx.fx_stereo_display.material = displayMat;
  const ledPc = makeEmissiveMaterial({ color: 0x38ff5a, intensity: 4 });
  const ledMon = makeEmissiveMaterial({ color: 0x38ff5a, intensity: 4 });
  const ledHdd = makeEmissiveMaterial({ color: 0xffa020, intensity: 0 });
  if (fx.fx_led_power) fx.fx_led_power.material = ledPc;
  if (fx.fx_led_monitor) fx.fx_led_monitor.material = ledMon;
  if (fx.fx_led_hdd) fx.fx_led_hdd.material = ledHdd;
  const lavaC = b2t([meta.shelf.lava_xy[0], meta.shelf.lava_xy[1], meta.shelf.lava_base_z]);
  const lavaMat = makeLavaMaterial(lavaC, meta.shelf.lava_base_z + 0.12, 0.165);
  if (fx.fx_lava_glass) fx.fx_lava_glass.material = lavaMat;

  const aq = createAquarium({ scene, meta, fx, shared, envTex: envComp[0].texture, still: Q.has('still'), reduceMotion, query: Q });

  // soft halos around the two practical lights (additive, alpha-preserving so the CRT hole stays intact)
  const haloTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const halo = (pos, size, color) => {
    const m = new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    const s = new THREE.Sprite(m); s.position.copy(pos); s.scale.setScalar(size); scene.add(s); return s;
  };
  const bulbHalo = halo(b2t(meta.lamp.bulb), 0.42, 0xffb060);
  const lavaHalo = halo(b2t(meta.shelf.lava), 0.5, 0x2a9cff);

  // dust motes drifting through the sun shafts
  const dust = (() => {
    const n = 260; const pos = new Float32Array(n * 3); const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = 0.05 + Math.random() * 1.5; pos[i * 3 + 1] = 0.7 + Math.random() * 1.3; pos[i * 3 + 2] = 0.15 + Math.random() * 2.2; seed[i] = Math.random() * 100; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uI: { value: 1 }, uScale: { value: 1 } },
      vertexShader: /* glsl */`attribute float seed; uniform float uTime, uScale; varying float vA;
        void main() { vec3 p = position; float t = uTime * 0.05 + seed;
          p += vec3(sin(t * 1.3 + seed), sin(t * 0.9 + seed * 2.0) * 0.6, cos(t * 1.1 + seed * 3.0)) * 0.06;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          vA = 0.35 + 0.65 * fract(seed * 7.13); gl_PointSize = uScale * (1.2 + 2.2 * fract(seed * 3.7)) / max(0.3, -mv.z); }`,
      fragmentShader: /* glsl */`precision highp float; uniform float uI; varying float vA;
        void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * uI;
          gl_FragColor = vec4(vec3(1.0, 0.72, 0.42) * a * 0.32, 0.0); }`,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, toneMapped: false,
    });
    const p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p); return m;
  })();

  // ------------------------------------------------------------------ room state -> light tints
  const num = (k, d) => (Q.has(k) ? parseFloat(Q.get(k)) : d);
  const HAS = { blinds: !!lmInfo.atlases.D, bed: !!lmInfo.atlases.F, grow: !!lmInfo.atlases.G };      // which two-state bakes this asset set contains
  const state = { lamp: num('lamp', 1) > 0, lava: num('lava', 1) > 0, sun: clamp01(num('sun', 1)), stereo: false, monitor: true,
    blinds: HAS.blinds && Q.get('blinds') === 'open', bedMade: HAS.bed && Q.get('bed') === 'made' };
  const cur = { lamp: state.lamp ? 1 : 0, lava: state.lava ? 1 : 0, sun: state.sun, crt: 0, blinds: state.blinds ? 1 : 0 };
  // one shape of each two-state thing is drawn (and pickable) at a time
  let pickList = pickables;
  function applyVariants() {
    const show = { C: cur.blinds < 0.97, D: cur.blinds >= 0.97, E: !state.bedMade, F: state.bedMade };
    for (const k in show) (atlasMeshes[k] || []).forEach((m) => { m.visible = show[k]; });
    pickList = pickables.filter((m) => m.visible);
    shared.uRaise.value = cur.blinds;
  }
  const crtColor = new THREE.Color(0.0, 0.5, 0.5);
  const crtTarget = new THREE.Color(0.0, 0.5, 0.5);
  const L = meta.lights;
  const tints = {};                       // layer name -> colour, consumed by every compositor
  // artistic gains on top of the baked nominal intensities (exact, since each light is its own layer)
  const GAIN = { sun: num('gsun', 1.0), sky: num('gsky', 2.5), lamp: num('glamp', 0.75), lava: num('glava', 0.7), crt: num('gcrt', 0.45), open: num('gopen', 0.6), tank: num('gtank', 1.0) };
  const col = (a) => new THREE.Color(a[0], a[1], a[2]);
  const LAVA_LIGHT = new THREE.Color(0.10, 0.62, 1.0);      // blue liquid with green wax: the baked layer is white, so the colour is a free runtime choice
  const sunHi = col(L.sun.color), sunLo = new THREE.Color(1.0, 0.30, 0.09), skyDay = col(L.sky.color), skyNight = new THREE.Color(0.10, 0.16, 0.34);
  let lightsDirty = true;
  const roomListeners = [];
  function computeTints(time) {
    const s = cur.sun;
    const flick = 1 + 0.035 * Math.sin(time * 1.7) + 0.02 * Math.sin(time * 4.3);
    const o = cur.blinds, sunC = sunLo.clone().lerp(sunHi, smooth(s)).multiplyScalar(Math.pow(s, 1.6) * GAIN.sun);
    const skyC = skyNight.clone().multiplyScalar(0.5).lerp(skyDay.clone(), smooth(s)).multiplyScalar(GAIN.sky);
    const out = {
      // the blinds are a crossfade between two baked light states
      sun: sunC.clone().multiplyScalar(1 - o), sun_open: sunC.clone().multiplyScalar(o * GAIN.open),
      sky: skyC.clone().multiplyScalar(1 - o), sky_open: skyC.clone().multiplyScalar(o * GAIN.open),
      lamp: col(L.lamp.color).multiplyScalar(cur.lamp * GAIN.lamp),
      lava: LAVA_LIGHT.clone().multiplyScalar(cur.lava * flick * GAIN.lava),
      crt: crtColor.clone().multiplyScalar(cur.crt * GAIN.crt),
      tank: aq ? aq.tint.clone().multiplyScalar(GAIN.tank) : new THREE.Color(0, 0, 0),
    };
    Object.assign(tints, out);
  }
  function setRoom(key, value, silent) {
    if (!(key in state)) return;
    state[key] = key === 'sun' ? clamp01(+value) : !!value;
    if (key === 'stereo') setStereo(state.stereo);
    lightsDirty = true;
    syncHud();
    if (!silent) roomListeners.forEach((cb) => { try { cb({ ...state }); } catch (e) { console.warn(e); } });
  }

  // ------------------------------------------------------------------ camera rig
  const home = { pos: b2t(meta.camera.pos), target: null };
  home.target = home.pos.clone().addScaledVector(b2t(meta.camera.forward), 2.36);
  camera.position.copy(home.pos);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(home.target);
  Object.assign(controls, { enableDamping: !Q.has('still'), dampingFactor: 0.08, rotateSpeed: 0.42, zoomSpeed: 0.7, panSpeed: 0.5,
    minDistance: 0.4, maxDistance: 3.3, minPolarAngle: 0.85, maxPolarAngle: 1.9, minAzimuthAngle: -1.75, maxAzimuthAngle: 1.3 });      // -1.57 faces the right wall (the aquarium) head-on
  controls.update();
  const B = meta.bounds;
  const camMin = new THREE.Vector3(B.lo[0], B.lo[2], -B.hi[1]), camMax = new THREE.Vector3(B.hi[0], B.hi[2], -B.lo[1]);
  const tgtMin = new THREE.Vector3(0.1, 0.3, 0.0), tgtMax = new THREE.Vector3(room.w - 0.15, 2.0, 2.2);
  function clampPos(p) {
    p.clamp(camMin, camMax);
    if (p.x < B.bed.x1 && -p.z < B.bed.y1 && p.y < B.bed.zmin) p.y = B.bed.zmin;    // stay above the bed
    if (B.desk && -p.z > B.desk.y0 && p.y < B.desk.zmin) p.y = B.desk.zmin;         // and above the desk top when leaning in
    return p;
  }
  function clampCamera() { controls.target.clamp(tgtMin, tgtMax); clampPos(camera.position); }
  const REF_ASPECT = 1.5, HFOV = THREE.MathUtils.degToRad(meta.camera.hfov_deg);
  function fit() {
    const w = window.innerWidth, h = window.innerHeight, a = w / h;
    const v = a >= REF_ASPECT ? 2 * Math.atan(Math.tan(HFOV / 2) / REF_ASPECT) : Math.min(2 * Math.atan(Math.tan(HFOV / 2) / a), 1.35);
    roomFov = THREE.MathUtils.radToDeg(v);
    if (!fm?.on) camera.fov = roomFov;          // while you are a fish the swim controller owns the lens
    camera.aspect = a; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false); css.setSize(w, h);
    dust.uniforms.uScale.value = Math.min(h, 1100) * renderer.getPixelRatio() / 1000;
    if (mode === 'monitor' && !tween) { const v2 = monitorView(); camera.position.copy(v2.pos); controls.target.copy(v2.target); camera.lookAt(v2.target); }
  }
  const scr = meta.screen;
  const scrC = b2t(scr.center);
  function monitorView() {
    const v = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    const d = Math.max((scr.h / 2) / Math.tan(v / 2), (scr.w / 2) / Math.tan(hf / 2)) / 0.84;
    return { pos: scrC.clone().add(new THREE.Vector3(0, 0, d)), target: scrC.clone() };
  }
  let mode = 'room';                 // 'room' | 'monitor' | 'notebook' | 'fish'
  let fm = null, roomFov = 31;       // fish mode (created further down, once the aquarium's items exist)
  let tween = null, saved = null;
  function flyTo(view, ms, after) {
    const from = { pos: camera.position.clone(), target: controls.target.clone() };
    controls.enabled = false;
    tween = { from, to: view, t0: performance.now(), ms: reduceMotion || Q.has('still') ? 1 : ms, after };
  }
  function focusMonitor() {
    if (mode === 'monitor') return;
    saved = { pos: camera.position.clone(), target: controls.target.clone() };
    if (!monPower) setMonPower(true);
    examined = null; unsay();
    mode = 'monitor'; document.body.classList.add('focus'); $('#btn-back').hidden = false; hideTip();
    flyTo(monitorView(), 1100, () => { if (mode === 'monitor') { canvas.classList.add('pass'); mount.focus({ preventScroll: true }); } });
  }
  function exitFocus() {
    if (mode !== 'monitor') return;
    mode = 'room'; document.body.classList.remove('focus'); $('#btn-back').hidden = true; canvas.classList.remove('pass');
    if (document.activeElement && mount.contains(document.activeElement)) document.activeElement.blur();
    flyTo(saved || home, 900, () => { controls.enabled = true; });
  }
  function lookAt(view) {
    flyTo({ pos: b2t(view.pos), target: b2t(view.target) }, 900, () => { controls.enabled = true; });
  }

  // ------------------------------------------------------------------ desktop OS on the CRT (CSS3D behind the canvas)
  // Chrome rasterises perspective-transformed layers at 1x, so the 640x480 desktop is laid out inside a
  // K-times larger carrier element (scaled back down in 3D) to keep its text sharp when you lean in.
  const K = Q.has('k') ? Math.max(1, parseInt(Q.get('k'), 10) || 1) : ((window.devicePixelRatio || 1) > 1.5 ? 3 : 2);
  const carrier = document.createElement('div');
  carrier.className = 'crt-carrier'; carrier.style.width = `${640 * K}px`; carrier.style.height = `${480 * K}px`;
  const mount = document.createElement('div');
  mount.className = 'crt-mount'; mount.tabIndex = -1; mount.style.transform = `scale(${K})`;
  carrier.appendChild(mount);
  const mountObj = new CSS3DObject(carrier);
  mountObj.position.copy(scrC); mountObj.scale.setScalar(scr.w / (640 * K));
  cssScene.add(mountObj);
  let os = null, osAudio = null, stereoDisplayDirty = false;
  const bridge = {
    getRoomState: () => ({ lamp: state.lamp, lava: state.lava, sun: state.sun, stereo: state.stereo }),
    setRoom: (k, v) => setRoom(k, v, true),
    onRoomChange: (cb) => { roomListeners.push(cb); },
    exitFocus: () => exitFocus(),
  };
  function onScreenColor() {
    if (!os) return;
    try { const c = os.getAverageColor(); crtTarget.setRGB(c[0], c[1], c[2]); } catch (e) { /* keep last */ }
  }
  if (Q.get('noos') === '1') {
    screenMat.uniforms.uHole.value = 0;
  } else {
    try {
      const mod = await import('../os/os.js');
      os = mod.createOS(mount, bridge, { skipBoot: Q.has('skipBoot'), autoOpen: Q.has('app') ? Q.get('app').split(',').filter(Boolean) : ['terminal'] });   // the reference photo shows the jakelee.info text-mode page on the CRT
      osAudio = typeof mod.getAudio === 'function' ? mod.getAudio() : null;
      os.on?.('power', (on) => { state.monitor = !!on; lightsDirty = true; });
      os.on?.('screencolor', onScreenColor);
      os.on?.('sound', (playing) => { stereoDisplayDirty = true; if (state.stereo !== !!playing) { state.stereo = !!playing; lightsDirty = true; syncHud(); roomListeners.forEach((cb) => { try { cb({ ...state }); } catch (e) { /* ignore */ } }); } });
      osAudio?.onChange?.(() => { stereoDisplayDirty = true; });      // track changes while already playing
      onScreenColor();
    } catch (err) {
      console.warn('Desktop UI failed to load', err);
      mount.innerHTML = '<div class="crt-fallback">Summit 98 could not start</div>';
    }
  }
  function setStereo(on) {
    try { if (osAudio) { on ? osAudio.play() : osAudio.stop(); } } catch (e) { console.warn(e); }
  }

  // ------------------------------------------------------------------ items: every object answers
  // The export writes a per-vertex item id, so picking is a plain ray cast against the real geometry (correct
  // occlusion, no hand-placed boxes). Content lives in items.js, behaviour below.
  const itemById = new Map(), itemByKey = new Map();
  for (const it of meta.items) {
    const rec = { ...it, ...(ITEM_DEFS[it.key] || { label: it.key, text: '' }), box: new THREE.Box3().setFromPoints([b2t(it.lo), b2t(it.hi)]) };
    itemById.set(it.id, rec); itemByKey.set(it.key, rec);
  }
  pickables.forEach((o) => { if (o.userData.itemKey) o.userData.itemId = itemByKey.get(o.userData.itemKey)?.id; });
  const FISH_ID = 9001;                      // the fish are not baked geometry: one runtime item, sub = which fish
  if (aq) { const rec = { id: FISH_ID, key: 'fish', ...ITEM_DEFS.fish, box: new THREE.Box3(aq.lo.clone(), aq.hi.clone()) }; itemById.set(FISH_ID, rec); itemByKey.set('fish', rec); }
  {  // the gaps between the slats should still read as "blinds"
    const w = meta.window;
    const proxy = new THREE.Mesh(new THREE.PlaneGeometry(w.y1 - w.y0, w.z1 - w.z0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    proxy.position.set(-0.062, (w.z0 + w.z1) / 2, -(w.y0 + w.y1) / 2); proxy.rotation.y = Math.PI / 2; proxy.updateMatrixWorld(true);
    proxy.userData.itemId = itemByKey.get('blinds')?.id; pickables.push(proxy);
  }
  shared.uMouseItem.value = itemByKey.get('mouse')?.id ?? -1;
  const authored = Object.fromEntries((meta.hotspots || []).filter((h) => h.view).map((h) => [h.id, { pos: b2t(h.view.pos), target: b2t(h.view.target) }]));

  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  function pickAt(x, y) {
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickList, false);
    const fish = aq ? aq.pickFish(ray.ray) : null;       // fish swim behind glass: they win over the pane, lose to anything opaque in front
    for (const h of hits) {
      if (fish && (h.object.userData.tankGlass || fish.dist < h.distance)) {
        const solid = hits.find((o) => !o.object.userData.tankGlass);
        if (!solid || fish.dist < solid.distance) return { item: itemById.get(FISH_ID), sub: fish.index, uv: null, point: fish.fish.pos.clone(), mat: '' };
      }
      const g = h.object.geometry; let id = h.object.userData.itemId, sub = 0;
      if (id == null && g.attributes._item && h.face) { id = Math.round(g.attributes._item.getX(h.face.a)); sub = Math.round(g.attributes._sub ? g.attributes._sub.getX(h.face.a) : 0); }
      if (h.object.userData.atlasKey === 'G' && sub > shared.uStage.value + 0.5) continue;      // plant growth that has not appeared yet
      if (shared.uLeafFade.value > 0.5 && /^(leaf|stem)$/.test(h.object.material?.name || '')) continue;     // foliage faded away from the photo board
      const item = itemById.get(id);
      if (item) return { item, sub, uv: h.uv || null, point: h.point, mat: h.object.material?.name || '' };
    }
    return null;
  }

  // ---- the bubble: one small label next to the pointer, for hover descriptions and for click feedback
  const tip = $('#tip'), tipName = tip.querySelector('b'), tipText = tip.querySelector('span'), tipHint = tip.querySelector('i');
  const ptr = { x: 0, y: 0, on: false, dirty: false };
  let note = null;                  // click feedback pinned for a few seconds: { key, until, x, y }
  function paintTip(name, text, hint, x, y, handwritten = false) {
    tip.classList.toggle('note', !!handwritten);
    tipName.textContent = name; tipText.textContent = text || ''; tipText.hidden = !text; tipHint.textContent = hint || ''; tipHint.hidden = !hint;
    tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.hidden = false;
    tip.classList.toggle('flip-x', x > window.innerWidth - 250); tip.classList.toggle('flip-y', y > window.innerHeight - 96);
  }
  const hideTip = () => { tip.hidden = true; canvas.classList.remove('hot'); shared.uHover.value.x = 0; };
  function say(name, text, hint, key = null, ms = 4200, handwritten = false) { note = { key, until: performance.now() + ms, x: ptr.x, y: ptr.y }; paintTip(name, text, hint, ptr.x, ptr.y, handwritten); }
  const unsay = () => { note = null; };

  applyVariants();

  // ---- behaviour state
  let examined = null, monPower = true, crtPow = 1, crtFlash = 0, muted = false, vol = 0.8, calMonth = 9, globeVel = 0;
  const pcState = () => (os ? (os.getState ? os.getState() : (os.isOn() ? 'on' : 'off')) : 'none');
  const stereoRegionOf = (hit) => (hit.mat === 'stereo_front' && hit.uv ? stereoRegion(hit.uv.x * 768, hit.uv.y * 480) : 'toggle');
  const cdCover = (sub) => ((Math.floor(sub / 2) % 2 === 0 ? 2 : 0) + (sub % 2)) % meta.cds.covers.length;   // matches the UV cell each case shows
  const timeName = (v) => (v > 0.75 ? 'Golden hour' : v > 0.2 ? 'Dusk' : 'Night');
  function setMonPower(on) { if (monPower === !!on) return; monPower = !!on; if (monPower) { crtFlash = 1; carrier.style.visibility = ''; } lightsDirty = true; }
  function openOnPc(app, args, it) {
    const st = pcState();
    if (st === 'none') { say(it.label, 'The desktop is not running in this session.', '', it.key); return false; }
    if (st === 'off' || st === 'halt') { say(it.label, 'The computer is off. Press the power button on the tower first.', '', it.key); return false; }
    os.open(app, args); focusMonitor(); return true;
  }
  function tipFor(hit) {
    const it = hit.item, onoff = (v) => (v ? 'on' : 'off');
    switch (it.key) {
      case 'lamp': return `Desk lamp — ${onoff(state.lamp)}`;
      case 'lava': return `Lava lamp — ${onoff(state.lava)}`;
      case 'window': return `Window — ${timeName(state.sun).toLowerCase()}`;
      case 'mon_power': return `Monitor power — ${onoff(monPower)}`;
      case 'pc_power': return `PC power — ${pcState() === 'on' || pcState() === 'boot' ? 'on' : 'off'}`;
      case 'speakers': return `PC speakers — ${muted ? 'muted' : 'on'}`;
      case 'books': return `Book: ${meta.books.titles[hit.sub] ?? 'untitled'}`;
      case 'cds': return `CD: ${meta.cds.covers[cdCover(hit.sub)]}`;
      case 'stereo': { const r = stereoRegionOf(hit); return `Stereo — ${r.startsWith('track') ? 'disc ' + (+r.slice(5) + 1) : STEREO_LABEL[r]}${r === 'toggle' && state.stereo ? ' (playing)' : ''}`; }
      default: return it.label;
    }
  }
  const exKey = (hit) => (hit.item.perSub ? `${hit.item.key}:${hit.sub}` : hit.item.key);     // each pinned print is examined on its own
  /** What the bubble says about the thing under the pointer. Feature modules add entries to DESCRIBE. */
  const DESCRIBE = {};
  function describe(hit) {
    const it = hit.item, own = DESCRIBE[it.key2 || it.key]?.(hit);
    if (own) return own;
    if (it.mode === 'hover') return { name: tipFor(hit), text: it.text, hint: '' };
    if (it.mode === 'instant') return { name: tipFor(hit), text: it.text || '', hint: it.verb || '' };
    return { name: tipFor(hit), text: it.text, hint: examined === exKey(hit) ? (ACT[it.key] ? it.hint : '') : 'Click to look closer' };
  }

  // ---- stereo front panel and display
  const dispCanvas = document.createElement('canvas'); dispCanvas.width = 256; dispCanvas.height = 80;
  const dispTex = new THREE.CanvasTexture(dispCanvas); dispTex.flipY = false; dispTex.colorSpace = THREE.SRGBColorSpace;
  let dispText = '';
  function drawDisplay() {
    const g = dispCanvas.getContext('2d'); g.fillStyle = '#0a0602'; g.fillRect(0, 0, 256, 80);
    const playing = !!osAudio && osAudio.isPlaying();
    g.fillStyle = '#ff961e'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 40px "Courier New", Courier, monospace';
    g.shadowColor = '#ff961e'; g.shadowBlur = 6;
    dispText = playing ? `CD ${(osAudio.trackIndex ?? 0) + 1}  ▶` : 'FM 98.7';
    g.fillText(dispText, 128, 42); g.shadowBlur = 0;
    dispTex.needsUpdate = true;
  }
  displayMat.uniforms.map.value = dispTex; displayMat.uniforms.uUseMap.value = 1; drawDisplay();
  function stereoAct(hit) {
    const r = stereoRegionOf(hit), a = osAudio;
    if (!a || r === 'toggle') { setRoom('stereo', !state.stereo); return; }
    const n = a.tracks?.length || 4, cur_ = a.trackIndex ?? 0;
    if (r === 'play') a.play(); else if (r === 'stop') a.stop();
    else if (r === 'next') a.play((cur_ + 1) % n); else if (r === 'prev') a.play((cur_ + n - 1) % n);
    else if (r.startsWith('track')) a.play(+r.slice(5) % n);
    else {
      vol = r === 'louder' ? Math.min(1, vol + 0.2) : r === 'quieter' ? Math.max(0, vol - 0.2) : (vol >= 0.99 ? 0.2 : Math.min(1, vol + 0.2));
      a.setVolume(muted ? 0 : vol); say('Stereo', `Volume ${Math.round(vol * 100)} %`, '', 'stereo');
    }
  }

  // ---- calendar pages (texture swap only: the baked light on the paper is unchanged)
  const calMat = matByName.calendar, calOrig = calMat?.uniforms.map.value || null;
  let calTex = null;
  function turnCalendar() {
    if (!calMat) return;
    calMonth = (calMonth + 1) % 12;
    let name = 'October';
    if (calMonth === 9) calMat.uniforms.map.value = calOrig;
    else {
      const cv = calTex ? calTex.image : document.createElement('canvas');
      name = drawCalendar(cv, calOrig?.image || null, calMonth);
      if (!calTex) { calTex = new THREE.CanvasTexture(cv); calTex.flipY = false; calTex.colorSpace = THREE.SRGBColorSpace; calTex.anisotropy = shared.anisotropy; }
      calTex.needsUpdate = true; calMat.uniforms.map.value = calTex;
    }
    say('Calendar', `${name} 1998`, 'Click again to turn the page', 'calendar');
  }

  // ---- notebook: sit over the page and write on it with the pencil (strokes go into the page's texture)
  const nbMat = matByName.notebook_page, nbMesh = pickables.find((o) => o.material === nbMat) || null;
  const nbCanvas = document.createElement('canvas'); nbCanvas.width = 512; nbCanvas.height = 640;
  const nbInk = document.createElement('canvas'); nbInk.width = 512; nbInk.height = 640;      // strokes only, saved in the browser
  let nbTex = null, nbStroke = null, nbSaveTimer = 0;
  const NB_KEY = 'room1998.notebook';
  function nbCompose() {
    const g = nbCanvas.getContext('2d'); const base = nbMat?.userData.base;
    if (base) g.drawImage(base, 0, 0, 512, 640); else { g.fillStyle = '#eeece2'; g.fillRect(0, 0, 512, 640); }
    g.drawImage(nbInk, 0, 0); if (nbTex) nbTex.needsUpdate = true;
  }
  if (nbMat) {
    nbMat.userData.base = nbMat.uniforms.map.value?.image || null;
    nbTex = new THREE.CanvasTexture(nbCanvas); nbTex.flipY = false; nbTex.colorSpace = THREE.SRGBColorSpace; nbTex.anisotropy = shared.anisotropy;
    nbMat.uniforms.map.value = nbTex; nbMat.uniforms.uUseMap.value = 1; nbCompose();
    try {
      const saved = localStorage.getItem(NB_KEY);
      if (saved) { const im = new Image(); im.onload = () => { nbInk.getContext('2d').drawImage(im, 0, 0); nbCompose(); }; im.src = saved; }
    } catch (e) { /* storage unavailable: notes last for this visit only */ }
  }
  const nbRay = new THREE.Raycaster();
  function nbPoint(e) {
    if (!nbMesh) return null;
    nbRay.setFromCamera(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1), camera);
    const h = nbRay.intersectObject(nbMesh, false)[0];
    return h && h.uv ? { x: h.uv.x * 512, y: h.uv.y * 640 } : null;
  }
  function nbDraw(a, b) {
    const g = nbInk.getContext('2d'); g.strokeStyle = 'rgba(52,52,60,0.86)'; g.lineWidth = 2.1; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x + 0.01, b.y + 0.01); g.stroke(); nbCompose();
  }
  const nbSave = () => { clearTimeout(nbSaveTimer); nbSaveTimer = setTimeout(() => { try { localStorage.setItem(NB_KEY, nbInk.toDataURL('image/png')); } catch (e) { /* ignore */ } }, 400); };
  function nbClear() { nbInk.getContext('2d').clearRect(0, 0, 512, 640); nbCompose(); try { localStorage.removeItem(NB_KEY); } catch (e) { /* ignore */ } }
  function enterNotebook() {
    const it = itemByKey.get('notebook'); if (!it || mode !== 'room') return;
    const c = it.box.getCenter(new THREE.Vector3());
    saved = { pos: camera.position.clone(), target: controls.target.clone() };
    examined = null; unsay(); hideTip();
    mode = 'notebook'; document.body.classList.add('writing'); $('#btn-back').hidden = false; $('#btn-clear').hidden = false;
    flyTo({ pos: new THREE.Vector3(c.x, c.y + 0.5, c.z + 0.13), target: c }, 900, () => {});
  }
  function exitNotebook() {
    if (mode !== 'notebook') return;
    nbStroke = null; mode = 'room'; document.body.classList.remove('writing'); $('#btn-back').hidden = true; $('#btn-clear').hidden = true;
    flyTo(saved || home, 900, () => { controls.enabled = true; ptr.dirty = true; });
  }

  const RUN = {       // first click acts
    lamp: () => setRoom('lamp', !state.lamp),
    lava: () => setRoom('lava', !state.lava),
    window: () => { setRoom('sun', state.sun > 0.75 ? 0.45 : state.sun > 0.2 ? 0.0 : 1.0); say('Window', timeName(state.sun), 'Click to change the time of day', 'window'); },
    blinds: () => { if (!HAS.blinds) return RUN.window(); state.blinds = !state.blinds; lightsDirty = true; },
    monitor: () => focusMonitor(), keyboard: () => focusMonitor(), mouse: () => focusMonitor(),
    mon_power: () => setMonPower(!monPower),
    pc_power: () => { const st = pcState(); if (st === 'none') return; os.setPower(st === 'off' || st === 'halt'); },
    pc_reset: () => { if (pcState() === 'none') return; os.setPower(false); os.setPower(true); },
    speakers: () => { muted = !muted; try { osAudio?.setVolume(muted ? 0 : vol); } catch (e) { /* no audio */ } },
    stereo: (hit) => stereoAct(hit),
    notebook: () => enterNotebook(), pen: () => enterNotebook(),
  };
  const ACT = {       // second click on the item you are already looking at
    globe: () => { globeVel += 2.4; },
    zip_drive: (hit) => openOnPc('explorer', { path: [] }, hit.item),
    pin_note: (hit) => openOnPc('notepad', { name: `note-${hit.sub + 1}.txt`, content: (meta.notes.pin[hit.sub] || []).join('\r\n') }, hit.item),
    books: (hit) => openOnPc('notepad', { name: 'bookshelf.txt', content: [`You pulled out: ${meta.books.titles[hit.sub] ?? 'an unlabelled book'}`, '', 'Spines on the shelf', '-------------------', ...meta.books.titles.map((t, i) => (i === hit.sub ? '> ' : '  ') + t)].join('\r\n') }, hit.item),
    calendar: () => turnCalendar(),
  };

  // ---- aquarium: hood light (two tubes), air pump, food; the fish themselves are in aquarium.js
  const tankView = () => {      // head-on, wide enough for the pump and the food can beside the tank, whatever the aspect ratio
    const T = meta.tank, v = THREE.MathUtils.degToRad(roomFov), hf = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);      // the room lens, also while you are a fish
    const y0 = T.outer_lo[1] - 0.05, y1 = Math.max(T.outer_hi[1], T.food[1] + 0.04, T.pump[1] + 0.07) + 0.03, cz = -(y0 + y1) / 2;
    const h = T.outer_hi[2] - T.outer_lo[2] + 0.12, cy = (T.outer_hi[2] + T.outer_lo[2]) / 2;
    const d = Math.max((h / 2) / Math.tan(v / 2), ((y1 - y0) / 2) / Math.tan(hf / 2));
    return { pos: clampPos(new THREE.Vector3(T.front - d, cy + 0.04, cz)), target: new THREE.Vector3(T.front + 0.16, cy - 0.01, cz) };
  };
  const nearTank = () => !!aq && camera.position.distanceTo(b2t(meta.tank.center)) < 2.1;
  if (aq) {
    const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1), sw = (v) => (v ? 'on' : 'off');
    RUN.tank_hood = () => { aq.cycleLights(); say('Aquarium light', cap(aq.lightName()) + '.', 'Click to change it', 'tank_hood'); };
    RUN.tank_sw_day = () => aq.toggle('day'); RUN.tank_sw_blue = () => aq.toggle('blue');
    RUN.tank_pump = () => aq.toggle('bubbler');
    RUN.tank_food = () => { const ok = aq.feed(); say('Fish food', ok ? 'A pinch of flakes on the water.' : 'That is plenty for now. Leftovers foul the water.', '', 'tank_food'); };
    RUN.fish = (hit) => { if (!nearTank()) { examine({ item: itemByKey.get('aquarium'), sub: 0, uv: null, point: null, mat: '' }); return; } enterFish(hit.sub); };
    DESCRIBE.tank_hood = () => ({ name: 'Aquarium hood', text: `Light: ${aq.lightName()}.`, hint: 'Click to change the light' });
    DESCRIBE.tank_sw_day = () => ({ name: `Daylight tube — ${sw(aq.state.day)}`, text: '', hint: 'Click to switch' });
    DESCRIBE.tank_sw_blue = () => ({ name: `Blue tube — ${sw(aq.state.blue)}`, text: '', hint: 'Click to switch' });
    DESCRIBE.tank_pump = () => ({ name: `Air pump — ${sw(aq.state.bubbler)}`, text: aq.state.bubbler ? 'Humming. It feeds the chest and the air stone.' : 'Silent.', hint: 'Click to switch the bubbles' });
    DESCRIBE.tank_food = () => ({ name: 'Fish food', text: 'Tropical flakes.', hint: 'Click to feed the fish' });
    DESCRIBE.aquarium = () => ({ name: 'Aquarium', text: ITEM_DEFS.aquarium.text, hint: nearTank() ? 'Click a fish to swim as that fish' : 'Click to look closer' });
    DESCRIBE.fish = (hit) => ({ name: SPECIES[aq.fishes[hit.sub].kind].name, text: '', hint: nearTank() ? 'Click to swim as this fish' : 'Click to look closer' });
  }
  // ---- swimming as one of the fish (fishmode.js); the party under the rock is built the first time you find it
  const backBtn = $('#btn-back'), backHtml = backBtn.innerHTML;
  const fishAudio = createFishAudio();
  if (aq) {
    fm = createFishMode({
      camera, canvas, aq, audio: fishAudio, roomFov: () => roomFov, tankView, reduceMotion, still: Q.has('still'),
      makeRave: () => (raveMod ? raveMod.createRave({ reduceMotion }) : null),
      hooks: {
        say: (name, text, hint, key, ms) => { ptr.x = window.innerWidth * 0.5 - 115; ptr.y = window.innerHeight * 0.86; say(name, text, hint, key, ms); },
        onEnter: () => {
          if (!raveMod && !raveLoading) { raveLoading = true; import('./rave.js').then((m) => { raveMod = m; }).catch((e) => { raveLoading = false; console.warn('the party could not be loaded', e); }); }
          mode = 'fish'; controls.enabled = false; tween = null; examined = null; unsay(); hideTip(); aq.setHover(-1);
          document.body.classList.add('swimming'); backBtn.innerHTML = '← Back to the room <kbd>Esc</kbd>'; backBtn.hidden = false;
        },
        onSwim: () => {          // inside the water: the CRT is a speck at best, so stop re-placing its DOM layer every frame
          $('#css3d').style.visibility = 'hidden'; screenMat.uniforms.uHole.value = 0;
          const coarse = matchMedia('(pointer: coarse)').matches;
          ptr.x = window.innerWidth * 0.5 - 115; ptr.y = window.innerHeight * 0.86;
          say(`You are a ${SPECIES[fm.me.kind].name.toLowerCase()}`, coarse ? 'Drag to steer. Keep a finger down to swim fast.' : 'The pointer steers (or the arrow keys). Hold the button or Space to swim fast.', coarse ? '' : 'M mutes the sound', 'fish', 7000);
        },
        onSurface: () => { $('#css3d').style.visibility = ''; if (Q.get('noos') !== '1') screenMat.uniforms.uHole.value = 1; cssDirty = true; lightsDirty = true; },
        onExit: (view) => {
          mode = 'room'; document.body.classList.remove('swimming'); backBtn.hidden = true; backBtn.innerHTML = backHtml;
          controls.target.copy(view.target); camera.up.set(0, 1, 0); camera.lookAt(view.target); controls.enabled = true; unsay(); hideTip(); lightsDirty = true; ptr.dirty = true; fit();
        },
      },
    });
  }
  let raveMod = null, raveLoading = false;
  function enterFish(i) { if (fm && mode === 'room') fm.enter(i); }

  // ---- bed: two baked states
  RUN.bed = () => { if (!HAS.bed) return; state.bedMade = !state.bedMade; applyVariants(); ptr.dirty = true; };
  DESCRIBE.bed = () => ({ name: 'Bed', text: state.bedMade ? 'Made, for once.' : 'Unmade.', hint: HAS.bed ? (state.bedMade ? 'Click to mess it up again' : 'Click to make the bed') : '' });

  // ---- plant: water it, wait, and it grows a stage; water it too often and it browns
  const GROW_MS = num('growms', 90000);
  const plant = { stage: 0, wateredAt: -1e9, pending: false, extra: 0, wilt: 0 };
  const plantWet = () => performance.now() - plant.wateredAt < GROW_MS;
  RUN.plant = () => {
    shared.uSway.value = 1;
    if (!plantWet()) {
      plant.wateredAt = performance.now(); plant.extra = 0; plant.pending = HAS.grow && plant.stage < 2;
      say('Pothos', 'Watered.', plant.pending ? `New growth in about ${Math.max(1, Math.round(GROW_MS / 1000))} seconds, if you are still here.` : 'It is as big as it gets.', 'plant');
    } else if (++plant.extra < 2) {
      say('Pothos', 'The soil is still wet.', 'More water now will hurt it', 'plant');
    } else {
      plant.wilt = Math.min(1, plant.wilt + 0.35); plant.pending = false;
      say('Pothos', plant.wilt > 0.6 ? 'Drowning. The leaves are going brown.' : 'Overwatered. The leaf edges are turning brown.', 'Leave it alone for a while', 'plant');
    }
  };
  DESCRIBE.plant = () => ({
    name: 'Pothos',
    text: plant.wilt > 0.3 ? 'Overwatered: brown leaves.' : ['A young pothos, a few vines down the cabinet.', 'It has put out new leaves.', 'Thriving: vines most of the way to the floor.'][plant.stage],
    hint: plantWet() ? (plant.pending ? 'Watered · growing' : 'Soil is wet') : 'Click to water',
  });

  // ---- removable media: a floppy or CD travels to its drive as an unbaked proxy and is mounted on the desktop
  const FLOPPY_FILES = [
    { label: 'GAMES', files: [{ name: 'README.TXT', content: 'GAMES\r\n\r\nPowder Day is already installed:\r\nStart > Programs > Powder Day.' }, { name: 'SCORES.TXT', content: '[placeholder — nobody has written their scores down yet]' }] },
    { label: 'TRIP PICS', files: [{ name: 'PEAK.BMP', picture: 'mountain' }, { name: 'DUSK.BMP', picture: 'sunset' }, { name: 'CAPTIONS.TXT', content: '[placeholder — add what the pictures are]' }] },
    { label: 'BACKUP', files: [{ name: 'BACKUP.TXT', content: '[placeholder — nothing has been backed up to this disk yet]' }] },
  ];
  const media = { floppy: null, cd: null, flights: [] };
  const drivePos = { floppy: b2t(meta.drives?.floppy || [1.076, -0.503, 0.911]), cd: b2t(meta.drives?.cd || [1.076, -0.503, 1.003]) };
  const disksTex = matByName.disks?.uniforms.map.value || null;
  const cdsItem = itemByKey.get('cds');
  const cdHome = cdsItem ? new THREE.Vector3((cdsItem.box.min.x + cdsItem.box.max.x) / 2, cdsItem.box.max.y + 0.004, (cdsItem.box.min.z + cdsItem.box.max.z) / 2) : new THREE.Vector3();
  function floppyProxy(i) {
    const g = new THREE.BoxGeometry(0.09, 0.0033, 0.094); const uv = g.attributes.uv, pos = g.attributes.position;
    for (let k = 0; k < uv.count; k++) {
      const top = k >= 8 && k < 12;                 // BoxGeometry face order: +x, -x, +y, -y, +z, -z
      if (top) uv.setXY(k, (i + pos.getX(k) / 0.09 + 0.5) / 3, pos.getZ(k) / 0.094 + 0.5); else uv.setXY(k, (i + 0.03) / 3, 0.985);
    }
    return new THREE.Mesh(g, makeProxyMaterial({ map: disksTex, shared }));
  }
  function cdProxy() {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.06, 40), makeProxyMaterial({ shared, disc: true })); m.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group(); holder.add(m); return holder;
  }
  /** Fly a proxy between its resting place and the drive slot; `into` = true inserts. */
  function fly(kind, mesh, home, homeYaw, into, done) {
    const slot = drivePos[kind], front = slot.clone().add(new THREE.Vector3(0, 0, 0.075)), inside = slot.clone().add(new THREE.Vector3(0, 0, -0.07));
    const lift = home.clone().add(new THREE.Vector3(0, 0.07, 0));
    const path = into ? [home, lift, front, inside] : [inside, front, lift, home];
    scene.add(mesh);
    media.flights.push({ mesh, path, yaw: into ? [homeYaw, 0, 0, 0] : [0, 0, 0, homeYaw], t: 0, ms: reduceMotion || Q.has('still') ? 1 : 1150, done: () => { scene.remove(mesh); done && done(); } });
  }
  const flying = () => media.flights.length > 0;
  function ejectFloppy(after) {
    const i = media.floppy; if (i == null) { after && after(); return; }
    media.floppy = null; os?.mountDisk?.('A:', null);
    const d = meta.disks[i];
    fly('floppy', floppyProxy(i), b2t(d.pos), d.rot, false, () => { if (media.floppy == null) shared.uHideSub.value = -1; after && after(); });
  }
  function insertFloppy(i) {
    if (flying() || !meta.disks) return;
    if (media.floppy === i) { ejectFloppy(); return; }
    ejectFloppy(() => {
      const d = meta.disks[i]; shared.uHideSub.value = i; media.floppy = i;
      fly('floppy', floppyProxy(i), b2t(d.pos), d.rot, true, () => {
        os?.mountDisk?.('A:', FLOPPY_FILES[i]);
        if (pcState() === 'on') os.open('explorer', { path: ['A:'] });
        ptr.dirty = true;
      });
    });
  }
  function ejectCd(after) {
    const i = media.cd; if (i == null) { after && after(); return; }
    media.cd = null; os?.mountDisk?.('D:', null); try { if (osAudio?.isPlaying()) osAudio.stop(); } catch (e) { /* no audio */ }
    fly('cd', cdProxy(), cdHome, 0, false, after);
  }
  function insertCd(i) {
    if (flying()) return;
    if (media.cd === i) { ejectCd(); return; }
    ejectCd(() => {
      media.cd = i;
      fly('cd', cdProxy(), cdHome, 0, true, () => {
        const name = meta.cds.covers[i], n = osAudio?.tracks?.length || 4;
        os?.mountDisk?.('D:', { label: name, files: [{ name: 'TRACK01.MID', track: i % n }] });
        if (pcState() === 'on') os.open('player', { track: i % n, play: true });
        ptr.dirty = true;
      });
    });
  }
  os?.mountDisk?.('A:', null); os?.mountDisk?.('D:', null);        // the room starts with both drives empty
  RUN.disks = (hit) => insertFloppy(hit.sub);
  RUN.cds = (hit) => insertCd(cdCover(hit.sub));
  RUN.floppy = (hit) => { if (media.floppy != null) ejectFloppy(); else openOnPc('explorer', { path: ['A:'] }, hit.item); };
  RUN.cdrom = (hit) => { if (media.cd != null) ejectCd(); else openOnPc('explorer', { path: ['D:'] }, hit.item); };
  DESCRIBE.disks = (hit) => ({ name: `Floppy: ${FLOPPY_FILES[hit.sub]?.label ?? 'disk'}`, text: media.floppy === hit.sub ? 'In the drive.' : '', hint: media.floppy === hit.sub ? 'Click to take it out' : 'Click to put it in the drive' });
  DESCRIBE.cds = (hit) => { const i = cdCover(hit.sub); return { name: `CD: ${meta.cds.covers[i]}`, text: media.cd === i ? 'In the drive.' : '', hint: media.cd === i ? 'Click to take it out' : 'Click to play it' }; };
  DESCRIBE.floppy = () => ({ name: 'Floppy drive', text: media.floppy != null ? `${FLOPPY_FILES[media.floppy].label} is in the drive.` : 'Empty.', hint: media.floppy != null ? 'Click to eject' : 'Click to open drive A: · click a floppy on the desk to insert it' });
  DESCRIBE.cdrom = () => ({ name: 'CD-ROM drive', text: media.cd != null ? `${meta.cds.covers[media.cd]} is in the drive.` : 'Empty.', hint: media.cd != null ? 'Click to eject' : 'Click to open drive D: · click a CD on the desk to play it' });

  // ---- photo board: the user's albums. Each frame shows one picture of an album; its name is the handwritten
  // note; clicking the frame you are looking at flips to the album's next picture.
  const userAssets = await fetch(ASSETS + 'user/manifest.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const loadUserTex = async (file) => {
    const t = await texLoader.loadAsync(ASSETS + 'user/' + file);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = shared.anisotropy; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  const albums = {};                         // 'photo:3' | 'note:0' -> { caption, images, rect, index }
  for (const a of userAssets.albums || []) albums[`${a.kind}:${a.sub}`] = { ...a, index: 0 };
  let boardCanvas = null, boardTex = null;
  try {
    if (userAssets.mug && matByName.mug) { const t = await loadUserTex(userAssets.mug); matByName.mug.uniforms.map.value = t; matByName.mug.uniforms.uUseMap.value = 1; }
    if (userAssets.pinboard && matByName.pinboard_items) {
      const t = await loadUserTex(userAssets.pinboard);
      boardCanvas = document.createElement('canvas'); boardCanvas.width = t.image.width; boardCanvas.height = t.image.height;
      boardCanvas.getContext('2d').drawImage(t.image, 0, 0);
      boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.flipY = false; boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = shared.anisotropy;
      matByName.pinboard_items.uniforms.map.value = boardTex; matByName.pinboard_items.uniforms.uUseMap.value = 1;
    }
  } catch (e) { console.warn('user images could not be loaded', e); }
  const pinKey = (hit) => `${hit.item.key === 'pin_note' ? 'note' : 'photo'}:${hit.sub}`;
  const albumImages = new Map();
  async function flipAlbum(key) {
    const a = albums[key]; if (!a || !boardCanvas || a.images.length < 2 || a.busy) return;
    a.busy = true;
    const next = (a.index + 1) % a.images.length, file = a.images[next];
    try {
      if (!albumImages.has(file)) { const im = new Image(); im.src = ASSETS + 'user/' + file; await im.decode(); albumImages.set(file, im); }
      boardCanvas.getContext('2d').drawImage(albumImages.get(file), a.rect[0], a.rect[1], a.rect[2], a.rect[3]);
      boardTex.needsUpdate = true; a.index = next;
    } catch (e) { console.warn('album picture could not be loaded', file); }
    a.busy = false;
  }
  function describePin(hit, fallback) {
    const a = albums[pinKey(hit)];
    if (!a) return fallback;
    const n = a.images.length, here = examined === exKey(hit);
    return { name: n > 1 ? `Photo ${a.index + 1} of ${n}` : 'Photo', text: a.caption, note: true, hint: here ? (n > 1 ? 'Click for the next one' : '') : 'Click to look closer' };
  }
  DESCRIBE.pin_photo = (hit) => describePin(hit, { name: 'Photo', text: 'A print pinned to the board.', hint: examined === exKey(hit) ? '' : 'Click to look closer' });
  DESCRIBE.pin_note = (hit) => describePin(hit, { name: 'Pinned note', text: 'A handwritten note.', hint: examined === exKey(hit) ? 'Click again to read it in Notepad' : 'Click to look closer' });
  const flipAndSay = async (hit) => { await flipAlbum(pinKey(hit)); const d = describe(hit); say(d.name, d.text, d.hint, hit.item.key, 9000, true); };
  ACT.pin_photo = (hit) => { if (albums[pinKey(hit)]) flipAndSay(hit); };
  const readNote = ACT.pin_note;
  ACT.pin_note = (hit) => (albums[pinKey(hit)] ? flipAndSay(hit) : readNote(hit));
  const slotView = {};
  for (const sl of meta.pin_slots || []) {      // slightly from the right and above: clear of the plant
    const c = b2t(sl.center); slotView[`${sl.kind}:${sl.sub}`] = { pos: clampPos(new THREE.Vector3(c.x + 0.10, c.y + 0.07, c.z + 0.66)), target: c };
  }

  const CROUCH = new THREE.Vector3(1.5, 0.95, 1.9);      // low spot right of the bed with a clear line under the desk
  function viewFor(it, hit) {
    if ((it.key === 'pin_photo' || it.key === 'pin_note') && hit && hit.point && slotView[pinKey(hit)]) { const v = slotView[pinKey(hit)]; return { pos: v.pos.clone(), target: v.target.clone() }; }
    if (it.key === 'aquarium' && aq) return tankView();      // framed for the current aspect ratio
    const a = authored[it.view || it.key];
    if (a) return { pos: a.pos.clone(), target: a.target.clone() };
    const spread = it.spread && hit?.point;             // items in several places: go to the part that was clicked
    const c = spread ? hit.point.clone() : it.box.getCenter(new THREE.Vector3());
    const r = spread ? 0.08 : THREE.MathUtils.clamp(it.box.getSize(new THREE.Vector3()).length() / 2, 0.05, 0.7);
    if (it.far) return { pos: clampPos(CROUCH.clone()), target: c.clone().clamp(tgtMin, tgtMax) };
    const v = THREE.MathUtils.degToRad(camera.fov);
    const dist = THREE.MathUtils.clamp(r / Math.tan(v / 2) * 1.35, 0.45, 1.7);
    const dir = home.pos.clone().sub(c).normalize();
    const target = c.clone().clamp(tgtMin, tgtMax);
    return { pos: clampPos(target.clone().addScaledVector(dir, dist)), target };   // clamped up front, so the pose holds after the tween
  }
  function examine(hit) {
    const it = hit.item; examined = exKey(hit);
    const d = describe(hit); say(d.name, d.text, d.hint, it.key, d.note ? 9000 : 6000, d.note);
    flyTo(viewFor(it, hit), 900, () => { controls.enabled = true; ptr.dirty = true; });
  }
  function clickItem(hit) {
    const it = hit.item;
    if (it.mode === 'instant') { unsay(); RUN[it.key2 || it.key]?.(hit); ptr.dirty = true; return; }
    if (it.mode === 'hover') { const d = describe(hit); say(d.name, d.text, '', it.key); return; }     // a tap on touch screens shows what hover shows
    if (examined === exKey(hit) && ACT[it.key]) { ACT[it.key](hit); return; }
    examine(hit);
  }

  // ---- pointer
  let hover = null;
  function updateHover() {
    hover = ptr.on && mode === 'room' && !tween && !down ? pickAt(ptr.x, ptr.y) : null;
    shared.uHover.value.x = hover && hover.item.mode !== 'hover' && !hover.item.nohl ? hover.item.id : 0;
    canvas.classList.toggle('hot', !!hover && hover.item.mode !== 'hover');
    aq?.setHover(hover && hover.item.key === 'fish' ? hover.sub : -1);
    if (note && performance.now() < note.until && (!hover || hover.item.key === note.key || (hover.item.key2 && hover.item.key2 === note.key) || Math.hypot(ptr.x - note.x, ptr.y - note.y) < 28)) return;
    note = null;
    if (!hover || hover.item.silent) { tip.hidden = true; return; }
    const d = describe(hover); paintTip(d.name, d.text, d.hint, ptr.x, ptr.y, d.note);
  }
  let down = null, downOutside = false;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (mode === 'notebook') { nbStroke = nbPoint(e); if (nbStroke) nbDraw(nbStroke, nbStroke); return; }
    if (mode === 'room') canvas.classList.add('dragging');
    tip.hidden = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (mode !== 'notebook' || !nbStroke || !e.buttons) return;
    const p = nbPoint(e); if (p) { nbDraw(nbStroke, p); nbStroke = p; }
  });
  window.addEventListener('pointerup', (e) => {
    canvas.classList.remove('dragging');
    const d = down; down = null; ptr.dirty = true;
    if (!d || e.target !== canvas) return;
    const click = Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && performance.now() - d.t < 500;
    if (mode === 'notebook') { const drew = !!nbStroke; nbStroke = null; if (drew) nbSave(); else if (click && !tween) exitNotebook(); return; }
    if (!click || tween || mode !== 'room') return;
    ptr.x = e.clientX; ptr.y = e.clientY;            // touch has no hover: the bubble appears where the finger was
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) clickItem(hit); else unsay();
  });
  // Monitor mode: the canvas is click-through (class "pass") so the DOM desktop behind it gets every pointer and
  // keyboard event natively, including drags that leave the glass. A press + release outside the glass steps away.
  const outsideDesktop = (e) => !carrier.contains(e.target) && !e.target.closest?.('#btn-back, #btn-reset');
  document.addEventListener('pointerdown', (e) => { downOutside = mode === 'monitor' && !tween && outsideDesktop(e); }, true);
  document.addEventListener('pointerup', (e) => { if (downOutside && mode === 'monitor' && !tween && outsideDesktop(e)) exitFocus(); downOutside = false; }, true);
  const mouseTarget = new THREE.Vector3();
  document.addEventListener('pointermove', (e) => {
    if (mode === 'monitor') {              // the modelled mouse follows the cursor across the desktop
      if (carrier.contains(e.target)) { const r = carrier.getBoundingClientRect(); mouseTarget.set(((e.clientX - r.left) / r.width - 0.5) * 0.05, 0, ((e.clientY - r.top) / r.height - 0.5) * 0.036); }
      return;
    }
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.on = e.target === canvas && !e.buttons; ptr.dirty = true;    // picked once per frame in tick()
  }, true);
  canvas.addEventListener('pointerleave', () => { ptr.on = false; hideTip(); });
  // keys on the modelled keyboard travel with the real ones
  const KB = meta.keyboard, keyTarget = new Float32Array(112);
  const keyIndex = (label, nth) => { let n = 0; for (let i = 0; i < KB.keys.length; i++) if (KB.keys[i] === label && n++ === nth) return i; return -1; };
  const setKey = (e, v) => { const k = keyFor(e.code); if (!k) return; const i = keyIndex(k[0], k[1]); if (i >= 0) keyTarget[i] = v; };
  window.addEventListener('keydown', (e) => { if (!e.repeat) setKey(e, 1); }, true);
  window.addEventListener('keyup', (e) => setKey(e, 0), true);
  window.addEventListener('blur', () => keyTarget.fill(0));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (mode === 'monitor') exitFocus(); else if (mode === 'notebook') exitNotebook(); else if (mode === 'fish') fm.exit();
  });

  // ------------------------------------------------------------------ the only on-screen controls: reset view, step away, clear page
  function syncHud() { /* nothing on screen mirrors room state now; the desktop's Room Control listens through the bridge */ }
  $('#btn-reset').addEventListener('click', () => { if (mode !== 'room') return; examined = null; unsay(); flyTo(home, 900, () => { controls.enabled = true; ptr.dirty = true; }); });
  $('#btn-back').addEventListener('click', () => (mode === 'notebook' ? exitNotebook() : mode === 'fish' ? fm.exit() : exitFocus()));
  $('#btn-clear').addEventListener('click', nbClear);

  // ------------------------------------------------------------------ loop
  window.addEventListener('resize', fit); fit();
  if (Q.has('cam')) {
    const c = Q.get('cam').split(',').map(Number);
    camera.position.copy(b2t(c.slice(0, 3))); controls.target.copy(b2t(c.slice(3, 6))); controls.update();
  }
  if (Q.get('focus') === 'monitor') { focusMonitor(); }
  const baseExposure = num('exposure', 1.1);
  const clock = new THREE.Clock();
  let lastComposite = -1, frames = 0, partied = false;
  // Frame pacing. Full display rate while anything moves (input in the last 2 s, camera, tweens, flying disks,
  // lights easing, CRT power animation); otherwise only the slow ambient motion is left (lava wax, dust, LEDs)
  // and IDLE_FPS is plenty (10 fps while the browser window is not focused). ?fps=N overrides the idle rate (0 = never throttle).
  const IDLE_FPS = num('fps', 30), IDLE_MS = IDLE_FPS > 0 ? 1000 / IDLE_FPS : 0, FLICKER_S = 0.25;
  let busy = true, lastTick = -1e9, lastInput = performance.now(), rafId = 0;
  for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart']) window.addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true, capture: true });
  const camPrev = new Float32Array(32); let cssDirty = true;
  window.addEventListener('resize', () => { cssDirty = true; });
  function cameraMoved() {
    const a = camera.matrixWorld.elements, b = camera.projectionMatrix.elements; let moved = false;
    for (let i = 0; i < 16; i++) { if (Math.abs(a[i] - camPrev[i]) > 1e-7 || Math.abs(b[i] - camPrev[16 + i]) > 1e-7) moved = true; camPrev[i] = a[i]; camPrev[16 + i] = b[i]; }
    return moved;
  }
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!busy && IDLE_FPS > 0 && now - lastTick < (document.hasFocus() ? IDLE_MS : Math.max(IDLE_MS, 100)) - 1) return;   // 10 fps while another window has focus
    lastTick = now;
    try { tick(); } catch (err) { cancelAnimationFrame(rafId); console.error(err); loaderEl.classList.remove('done'); loaderEl.classList.add('error'); msgEl.textContent = `Renderer stopped: ${err.message || err}`; }
  }
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.1), time = clock.elapsedTime;
    // ease light levels towards their targets
    const k = 1 - Math.exp(-dt * 7);
    const step = (key, target) => { const d = target - cur[key]; if (Math.abs(d) > 1e-3) { cur[key] += d * k; lightsDirty = true; } else if (d !== 0) { cur[key] = target; lightsDirty = true; } };
    step('lamp', state.lamp ? 1 : 0); step('lava', state.lava ? 1 : 0); step('sun', state.sun); step('crt', state.monitor && monPower ? 1 : 0);
    { const t = state.blinds ? 1 : 0; if (cur.blinds !== t) { cur.blinds = reduceMotion || Q.has('still') ? t : THREE.MathUtils.clamp(cur.blinds + (t > cur.blinds ? dt : -dt) / 0.9, 0, 1); lightsDirty = true; applyVariants(); } }
    if (!crtColor.equals(crtTarget)) { crtColor.lerp(crtTarget, k); if (Math.abs(crtColor.r - crtTarget.r) + Math.abs(crtColor.g - crtTarget.g) + Math.abs(crtColor.b - crtTarget.b) < 0.004) crtColor.copy(crtTarget); lightsDirty = true; }
    if (aq && aq.update(dt, time, { camera, pxHeight: canvas.height, inside: !!fm?.inside, beat: fm?.beat ?? null })) lightsDirty = true;
    const easing = lightsDirty;          // a light is still fading towards its target
    const flickerDue = cur.lava > 0.01 && time - lastComposite > FLICKER_S && !Q.has('still');   // the lava lamp's slow 3 % shimmer
    if (lightsDirty || flickerDue) {
      computeTints(time);
      for (const key in comp) comp[key].render(tints);
      envComp.forEach((c) => c.render(tints));
      lightsDirty = false; lastComposite = time;
      bulbMat.uniforms.uOn.value = cur.lamp; bulbHalo.material.opacity = 0.55 * cur.lamp;
      // one ambient colour for the few unbaked things (disks in flight, the cold bulb)
      shared.uProxyLight.value.setRGB(0.02, 0.02, 0.025).add(tints.lamp.clone().multiplyScalar(0.55)).add(tints.sky.clone().add(tints.sky_open).multiplyScalar(0.35))
        .add(tints.sun.clone().add(tints.sun_open).multiplyScalar(0.10)).add(tints.crt.clone().multiplyScalar(0.25));
      bulbMat.uniforms.uAmb.value.copy(shared.uProxyLight.value).multiplyScalar(0.5);
      lavaHalo.material.opacity = 0.16 * cur.lava; lavaMat.uniforms.uOn.value = cur.lava;
      const s = cur.sun;
      backdropMat.uniforms.uI.value = 0.02 + 3.2 * Math.pow(s, 1.4);
      backdropMat.uniforms.uColor.value.setRGB(1.0, 0.55 + 0.4 * s, 0.35 + 0.5 * s).lerp(new THREE.Color(0.3, 0.45, 1.0), 1 - smooth(clamp01(s * 3)));
      dust.uniforms.uI.value = Math.pow(s, 1.5);
      screenMat.uniforms.uGlow.value.copy(crtColor);
      ledMon.uniforms.uI.value = monPower ? 0.6 + 3.4 * cur.crt : 0; displayMat.uniforms.uI.value = state.stereo ? 3.0 : 0.45;
      renderer.toneMappingExposure = baseExposure * (1 + 0.9 * (1 - smooth(s)) * (1 - 0.5 * cur.lamp));
    }
    ledHdd.uniforms.uI.value = state.monitor && Math.sin(time * 23) * Math.sin(time * 3.1) > 0.35 ? 5 : 0;
    lavaMat.uniforms.uTime.value = time; dust.uniforms.uTime.value = time;
    // item feedback
    if (note && performance.now() > note.until) { note = null; ptr.dirty = true; }
    if (ptr.dirty) { ptr.dirty = false; updateHover(); }
    shared.uHover.value.y = 0.85 + 0.15 * Math.sin(time * 4.0);
    // CRT power animation: the picture collapses to a line, then a dot (and blooms back on)
    const powT = monPower ? 1 : 0;
    if (crtPow !== powT) {
      crtPow = reduceMotion || Q.has('still') ? powT : THREE.MathUtils.clamp(crtPow + (powT - crtPow > 0 ? dt / 0.55 : -dt / 0.42), 0, 1);
      if (crtPow === 0) carrier.style.visibility = 'hidden';          // only once the collapse has finished
    }
    crtFlash *= Math.exp(-dt * 3.2);
    screenMat.uniforms.uPow.value = crtPow; screenMat.uniforms.uFlash.value = crtFlash;
    screenMat.uniforms.uOn.value = state.monitor ? 1 : 0;      // signal from the PC; the monitor's own power button is the uPow collapse
    shared.uTime.value = time;
    const kk = Math.min(1, dt * 38), keys = shared.uKeys.value;
    for (let i = 0; i < KB.keys.length; i++) keys[i] += (keyTarget[i] - keys[i]) * kk;
    shared.uMouseOff.value.lerp(mouseTarget, Math.min(1, dt * 14));
    shared.uSway.value *= Math.exp(-dt * 1.8);
    if (globeVel > 1e-3) { shared.uSpin.value = (shared.uSpin.value + globeVel * dt * 0.35) % 1; globeVel *= Math.exp(-dt * 0.9); }
    if (stereoDisplayDirty) { stereoDisplayDirty = false; drawDisplay(); }
    // plant: one new stage per watering, after the wait
    if (plant.pending && performance.now() - plant.wateredAt >= GROW_MS && plant.wilt < 0.5) { plant.pending = false; plant.stage = Math.min(2, plant.stage + 1); ptr.dirty = true; }
    shared.uStage.value += THREE.MathUtils.clamp(plant.stage - shared.uStage.value, -dt * 0.45, dt * 0.45);
    plant.wilt = Math.max(0, plant.wilt - dt / 400);
    shared.uWilt.value += (plant.wilt - shared.uWilt.value) * Math.min(1, dt * 0.8);
    { const t = mode === 'room' && examined && examined.startsWith('pin_') ? 1 : 0; shared.uLeafFade.value = reduceMotion || Q.has('still') ? t : THREE.MathUtils.clamp(shared.uLeafFade.value + (t ? dt : -dt) / 0.45, 0, 1); }
    // disks in flight
    for (let i = media.flights.length - 1; i >= 0; i--) {
      const f = media.flights[i]; f.t = Math.min(1, f.t + dt * 1000 / f.ms);
      const n = f.path.length - 1, u = Math.min(n - 1e-6, f.t * n), k = Math.floor(u), e = smooth(u - k);
      f.mesh.position.lerpVectors(f.path[k], f.path[k + 1], e);
      f.mesh.rotation.y = f.yaw[k] + (f.yaw[k + 1] - f.yaw[k]) * e;
      if (f.t >= 1) { media.flights.splice(i, 1); f.done(); }
    }

    if (mode === 'fish') fm.update(dt);
    else if (tween) {
      const f = clamp01((performance.now() - tween.t0) / tween.ms), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      camera.position.lerpVectors(tween.from.pos, tween.to.pos, e);
      controls.target.lerpVectors(tween.from.target, tween.to.target, e);
      camera.lookAt(controls.target);
      if (f >= 1) { const after = tween.after; tween = null; after && after(); }
    } else if (mode === 'room') {
      controls.update(); clampCamera(); camera.lookAt(controls.target);
    }
    const party = mode === 'fish' && fm.where === 'rave' && fm.rave;
    if (party) { renderer.toneMappingExposure = 1.0; renderer.render(fm.rave.scene, camera); partied = true; }
    else { if (partied) { partied = false; lightsDirty = true; } renderer.render(scene, camera); }
    const camMoved = cameraMoved();
    if ((camMoved || cssDirty || frames < 3) && !fm?.hideCss) { css.render(cssScene, camera); cssDirty = false; }   // the DOM desktop only needs re-placing when the view changes
    busy = mode === 'fish' || camMoved || easing || !!tween || media.flights.length > 0 || crtPow !== powT || cur.blinds !== (state.blinds ? 1 : 0)
      || performance.now() - lastInput < 2000 || globeVel > 1e-3;
    if (++frames === 3) { loaderEl.classList.add('done'); document.body.dataset.ready = '1'; }
  }
  const project = (bp) => { const v = b2t(bp).project(camera); return [(v.x + 1) / 2 * window.innerWidth, (1 - v.y) / 2 * window.innerHeight]; };
  const probe = (x, y) => { const h = pickAt(x, y); return h ? { key: h.item.key, sub: h.sub, label: h.item.label, tip: tipFor(h), mode: h.item.mode || 'examine', hasText: !!h.item.text, hasAct: !!(RUN[h.item.key2 || h.item.key] || ACT[h.item.key]) } : null; };
  window.__room = { tank: aq, get fish() { return fm; }, tankView, get fishAudio() { return fishAudio; }, get frames() { return frames; }, state, setRoom, focusMonitor, exitFocus, camera, controls, meta, project, probe,
    items: [...itemByKey.values()].map((i) => ({ key: i.key, label: i.label, mode: i.mode || 'examine', text: i.text || '', run: !!RUN[i.key2 || i.key], act: !!ACT[i.key] })),
    get os() { return os; }, get examined() { return examined; }, get monPower() { return monPower; }, get calMonth() { return calMonth; },
    get keys() { return Array.from(shared.uKeys.value.slice(0, KB.keys.length)); }, get mouseOffset() { return shared.uMouseOff.value.toArray(); },
    examine: (key) => { const it = itemByKey.get(key); if (it) examine({ item: it, sub: 0, uv: null, point: null, mat: '' }); return !!it; },
    get spin() { return shared.uSpin.value; }, get crtPow() { return crtPow; }, get glassOn() { return screenMat.uniforms.uOn.value; }, get mode() { return mode; }, plant, media, has: HAS, albums, get stageShown() { return shared.uStage.value; }, get wiltShown() { return shared.uWilt.value; },
    get notebookInk() { const d = nbInk.getContext('2d').getImageData(0, 0, 512, 640).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; }, get sway() { return shared.uSway.value; }, get muted() { return muted; }, get displayText() { return dispText; } };
  rafId = requestAnimationFrame(frame);
}
