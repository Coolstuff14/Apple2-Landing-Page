// Surface shaders. Baked surfaces are  albedo × lightmap  plus a view-dependent reflection taken from
// path-traced panoramas of the same room (box-projected so reflections line up with the walls).
import * as THREE from 'three';
import { WATER_GLSL } from './water.js';

// Baked surfaces carry two per-vertex ids written by the Blender export: _item (which logical object) and
// _sub (index inside it: keyboard key, book spine, CD ...). They drive hover feedback and the few vertex
// animations that do not disturb the baked light (key travel, mouse nudge, leaf sway, globe spin).
const BAKED_VERT = /* glsl */`
attribute vec2 uv1;
attribute float _item;
attribute float _sub;
varying vec2 vUv;
varying vec2 vUv1;
varying vec3 vN;
varying vec3 vP;
varying float vItem;
varying float vSub;
#ifdef RAISE
  uniform float uRaise, uRaiseTop;
#endif
#ifdef KEYS
  uniform float uKeys[112];
  uniform vec3 uKeyDown;
#endif
#ifdef MOUSE
  uniform float uMouseItem;
  uniform vec3 uMouseOff;
#endif
#ifdef SWAY
  uniform float uSway, uTime;
#endif
#ifdef GLOBE
  uniform float uSpin;
#endif
void main() {
  vUv = uv; vUv1 = uv1; vItem = _item; vSub = _sub;
  vec3 pos = position;
  #ifdef RAISE
    pos.y = mix(pos.y, uRaiseTop - (uRaiseTop - pos.y) * 0.1, uRaise * uRaise);      // blinds gather upwards while the light crossfades
  #endif
  #ifdef KEYS
    pos += uKeyDown * uKeys[int(_sub + 0.5)];
  #endif
  #ifdef MOUSE
    if (abs(_item - uMouseItem) < 0.5) pos += uMouseOff * (_sub > 0.5 ? (_sub - 1.0) * 0.01 : 1.0);
  #endif
  #ifdef SWAY
    pos += vec3(sin(uTime * 9.0 + position.y * 37.0), 0.25 * sin(uTime * 7.0 + position.x * 29.0), cos(uTime * 8.0 + position.z * 41.0)) * 0.0035 * uSway;
  #endif
  #ifdef GLOBE
    vUv.x += uSpin;
  #endif
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const COMMON_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vP;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const ENV_GLSL = /* glsl */`
uniform sampler2D tEnv;
uniform vec3 uEnvPos, uBoxMin, uBoxMax;
uniform float uEnvScale, uPackSqrt;
vec2 equirect(vec3 d) {                      // d in three.js world space; panorama looks along -Z, up +Y
  float lon = atan(d.x, -d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  return vec2(0.5 + lon * 0.15915494, 0.5 - lat * 0.31830989);
}
vec3 boxDir(vec3 P, vec3 R) {                // parallax-correct the lookup against the room box
  vec3 inv = 1.0 / (R + vec3(1e-5));
  vec3 tm = max((uBoxMax - P) * inv, (uBoxMin - P) * inv);
  float t = min(min(tm.x, tm.y), tm.z);
  return normalize(P + R * t - uEnvPos);
}
vec3 envSample(vec3 P, vec3 R) {
  vec2 uv = equirect(boxDir(P, R));
  vec3 e = texture2D(tEnv, uv).rgb;
  return mix(e, e * e, uPackSqrt) * uEnvScale;
}`;

const BAKED_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
varying vec2 vUv1;
varying vec3 vN;
varying vec3 vP;
varying float vItem;
varying float vSub;
uniform float uStage, uWilt, uHideSub, uLeafFade;
uniform vec2 uHover;            // x = hovered item id (0 = none), y = strength
uniform sampler2D tLM;
uniform sampler2D map;
uniform vec3 uColor;
uniform float uUseMap, uSpec, uMetal, uAlpha, uDebug, uLmScale;
${ENV_GLSL}
#ifdef TANK
${WATER_GLSL}
#endif
void main() {
  vec4 tex = uUseMap > 0.5 ? texture2D(map, vUv) : vec4(1.0);
  float a = tex.a * uAlpha;
  #ifdef ALPHA_DECAL
    if (a < 0.02) discard;
  #endif
  #ifdef GROW
    if (vSub > 0.5) {            // later growth stages fade in through a dither
      float ga = clamp(uStage - (vSub - 1.0), 0.0, 1.0);
      if (ga < fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) + 0.001) discard;
    }
  #endif
  #ifdef HIDE_SUB
    if (abs(vSub - uHideSub) < 0.5) discard;
  #endif
  #ifdef FOLIAGE
    // the plant thins out of the way while you look at the photo board behind it
    if (uLeafFade > fract(sin(dot(floor(gl_FragCoord.xy), vec2(41.21, 17.93))) * 24634.63) * 0.999) discard;
  #endif
  vec3 albedo = uColor * tex.rgb;
  #ifdef WILT
    float wv = fract(sin(floor(vP.x * 31.0) * 12.9898 + floor(vP.y * 27.0) * 78.233 + floor(vP.z * 29.0) * 37.719) * 43758.5453);
    albedo = mix(albedo, vec3(0.36, 0.23, 0.07) * (0.5 + 1.6 * dot(albedo, vec3(0.333))), clamp(uWilt * 1.7 - wv * 0.7, 0.0, 1.0));
  #endif
  #ifdef TANK_DETAIL
    // seen from a fish's distance the albedo texture runs out: add grain that fades in as the camera closes in
    albedo *= mix(1.0, 0.66 + 0.68 * grain(vP), smoothstep(0.55, 0.10, distance(cameraPosition, vP)));
  #endif
  vec3 irr = texture2D(tLM, vUv1).rgb;
  irr = mix(irr, irr * irr, uPackSqrt) * uLmScale;
  vec3 col = albedo * irr * (1.0 - 0.55 * uMetal);
  #ifdef TANK
    float wet = inWater(vP);
    col += albedo * uTankLight * (caustic(vP) * 0.50 * (0.25 + 0.75 * clamp(normalize(vN).y, 0.0, 1.0)) * wet);
    col += albedo * caveGlow(vP) * 3.0 * wet;
  #endif
  if (uDebug > 0.5) col = irr * 0.5;
  #ifdef USE_SPEC
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vP);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    vec3 R = reflect(-V, N);
    vec3 F0 = mix(vec3(0.04), albedo, uMetal);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
    // crude specular occlusion: surfaces sitting in deep shadow should not mirror a bright room
    float occ = clamp(dot(irr, vec3(0.3333)) * 6.0, 0.08, 1.0);
    col += envSample(vP, R) * F * uSpec * occ * (uDebug > 0.5 ? 0.0 : 1.0);
  #endif
  #ifdef TANK
    col = waterFog(col, vP);
  #endif
  float hl = (uHover.x > 0.5 && abs(vItem - uHover.x) < 0.5) ? uHover.y : 0.0;
  col = col * (1.0 + 0.16 * hl) + vec3(0.012, 0.009, 0.004) * hl;      // hover feedback: a slight lift, no extra geometry
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeBakedMaterial(src, lmTex, envTex, shared, atlas = 'A') {
  const ud = src.userData || {};
  const spec = ud.spec || 0;
  const alphaDecal = !!ud.alpha_tex;
  const feat = {};
  if (src.name === 'keys') feat.KEYS = 1;
  if (src.name === 'beige_plastic' || src.name === 'beige_plastic_dark') feat.MOUSE = 1;
  if (src.name === 'leaf') feat.SWAY = 1;
  if (src.name === 'globe') feat.GLOBE = 1;
  if (atlas === 'C') feat.RAISE = 1;
  if (atlas === 'G') feat.GROW = 1;
  if (src.name === 'leaf') feat.WILT = 1;
  if (src.name === 'leaf' || src.name === 'stem') feat.FOLIAGE = 1;
  if (src.name === 'disks') feat.HIDE_SUB = 1;
  const tank = atlas === 'H' && shared.tankU ? shared.tankU : null;      // the aquarium: caustics, water fog, close-up grain
  if (tank) { feat.TANK = 1; if (/^(gravel|tank_rock|driftwood|wood_mid)$/.test(src.name)) feat.TANK_DETAIL = 1; }
  const m = new THREE.ShaderMaterial({
    name: src.name,
    uniforms: {
      tLM: { value: lmTex }, tEnv: { value: envTex }, map: { value: src.map || null },
      uColor: { value: src.color ? src.color.clone() : new THREE.Color(1, 1, 1) },
      uUseMap: { value: src.map ? 1 : 0 }, uSpec: { value: spec * 1.6 },
      uMetal: { value: spec >= 0.7 ? 1 : 0 }, uAlpha: { value: 1 }, uDebug: shared.uDebug,
      uEnvPos: shared.uEnvPos, uBoxMin: shared.uBoxMin, uBoxMax: shared.uBoxMax,
      uLmScale: shared.uLmScale, uEnvScale: shared.uEnvScale, uPackSqrt: shared.uPackSqrt,
      uHover: shared.uHover, uKeys: shared.uKeys, uKeyDown: shared.uKeyDown, uMouseItem: shared.uMouseItem, uMouseOff: shared.uMouseOff,
      uSway: shared.uSway, uTime: shared.uTime, uSpin: shared.uSpin,
      uRaise: shared.uRaise, uRaiseTop: shared.uRaiseTop, uStage: shared.uStage, uWilt: shared.uWilt, uHideSub: shared.uHideSub, uLeafFade: shared.uLeafFade,
      ...(tank || {}),
    },
    vertexShader: BAKED_VERT, fragmentShader: BAKED_FRAG,
    side: ud.two_sided ? THREE.DoubleSide : THREE.FrontSide,
    transparent: alphaDecal, depthWrite: !alphaDecal,
    polygonOffset: alphaDecal, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    defines: Object.assign(feat, spec > 0 ? { USE_SPEC: 1 } : {}, alphaDecal ? { ALPHA_DECAL: 1 } : {}),
  });
  if (src.map) { src.map.anisotropy = shared.anisotropy; }
  return m;
}

// ---------------------------------------------------------------------------------------------------
// CRT glass. The live DOM desktop sits *behind* the WebGL canvas (CSS3D); this shader punches a hole in
// the canvas alpha and adds the room's reflection + edge shading on top of it (premultiplied output).
export function makeScreenMaterial(envTex, shared) {
  return new THREE.ShaderMaterial({
    name: 'fx_screen',
    uniforms: {
      tEnv: { value: envTex }, uOn: { value: 1 }, uHole: { value: 1 }, uGlow: { value: new THREE.Color(0, 0.5, 0.5) },
      uPow: { value: 1 }, uFlash: { value: 0 },
      uEnvPos: shared.uEnvPos, uBoxMin: shared.uBoxMin, uBoxMax: shared.uBoxMax, uEnvScale: shared.uEnvScale, uPackSqrt: shared.uPackSqrt,
    },
    vertexShader: COMMON_VERT,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      uniform float uOn, uHole, uPow, uFlash; uniform vec3 uGlow;
      ${ENV_GLSL}
      void main() {
        vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vP);
        // fake tube curvature for the reflection only
        vec2 c = vUv - 0.5;
        N = normalize(N + vec3(c.x * 0.16, c.y * 0.13, 0.0));
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float F = 0.028 + 0.972 * pow(1.0 - ndv, 5.0);
        vec3 refl = envSample(vP, reflect(-V, N)) * F;
        vec2 e = smoothstep(vec2(0.5), vec2(0.478), abs(c));       // soft dark edge of the tube mask
        float edge = 1.0 - e.x * e.y;
        // power animation (uPow 1 -> 0): the raster first collapses vertically to a bright line, then to a dot
        float pv = smoothstep(0.38, 1.0, uPow), ph = smoothstep(0.0, 0.38, uPow);
        float hy = mix(0.004, 0.5, pv * pv), hx = 0.5 * ph;
        float lit = step(abs(c.x), hx) * step(abs(c.y), hy);       // where the picture still is
        float cover = mix(1.0, edge * 0.8 + 0.015, uOn * uHole * lit);   // 1 = opaque glass, ~0 = see the DOM
        vec3 base = uGlow * (1.0 - uHole) * uOn * lit;              // stand-in emission when no DOM is mounted
        float beam = (1.0 - pv) * smoothstep(0.0, 0.06, uPow) * step(abs(c.x), hx + 0.004) * smoothstep(hy + 0.035, hy * 0.5, abs(c.y));
        vec3 glow = vec3(0.80, 1.0, 0.94) * (beam * (1.2 + 3.0 * (1.0 - ph)) + uFlash * lit * 0.45) * uOn;
        gl_FragColor = vec4(refl + base + glow, cover);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.NoBlending, transparent: false,
  });
}

export function makeEmissiveMaterial({ map = null, color = 0xffffff, intensity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uUseMap: { value: map ? 1 : 0 }, uColor: { value: new THREE.Color(color) }, uI: { value: intensity } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; uniform sampler2D map; uniform float uUseMap, uI; uniform vec3 uColor;
      void main() {
        vec3 c = uColor * (uUseMap > 0.5 ? texture2D(map, vUv).rgb : vec3(1.0)) * uI;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

// Lava lamp: blobs are 2D metaballs evaluated in a camera-facing plane through the lamp axis.
export function makeLavaMaterial(center, zBase, height) {
  return new THREE.ShaderMaterial({
    name: 'fx_lava',
    uniforms: { uTime: { value: 0 }, uOn: { value: 1 }, uCenter: { value: center }, uBase: { value: zBase }, uH: { value: height } },
    vertexShader: /* glsl */`
      varying vec3 vP; varying vec3 vN;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vP; varying vec3 vN;
      uniform float uTime, uOn, uBase, uH; uniform vec3 uCenter;
      float blob(vec2 p, vec2 c, float r) { vec2 d = p - c; d.x *= 1.25; float q = r * r / (dot(d, d) + 1e-5); return q * q; }
      void main() {
        vec3 V = normalize(cameraPosition - vP);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), V));
        // approximate the point where the view ray crosses the lamp's mid-plane
        vec3 Vh = vec3(V.x, 0.0, V.z);
        vec3 mid = vP - V * (dot(vP - uCenter, Vh) / max(dot(Vh, Vh), 1e-3));
        float h = clamp((mid.y - uBase) / uH, 0.0, 1.0);
        float x = dot(mid - uCenter, right) / (0.045 * mix(1.0, 0.5, h));
        vec2 p = vec2(x * 0.5, h);
        float t = uTime * 0.11;
        float f = 0.0;
        f += blob(p, vec2(0.10 * sin(t * 1.3), 0.50 + 0.36 * sin(t * 0.9)), 0.17);
        f += blob(p, vec2(0.14 * sin(t * 0.7 + 2.0), 0.48 + 0.40 * sin(t * 0.6 + 1.7)), 0.14);
        f += blob(p, vec2(0.12 * cos(t * 1.1 + 4.0), 0.55 + 0.38 * sin(t * 1.25 + 4.2)), 0.11);
        f += blob(p, vec2(0.05 * sin(t), 0.0), 0.24);                       // pool at the bottom
        f += blob(p, vec2(0.04 * cos(t * 0.8), 0.99), 0.12);                 // cap at the top
        float m = smoothstep(0.92, 1.12, f);
        vec3 liquid = mix(vec3(0.012, 0.085, 0.62), vec3(0.03, 0.22, 0.85), h) * (0.5 + 0.4 * (1.0 - h));     // blue liquid
        vec3 wax = vec3(0.10, 1.0, 0.22) * (1.05 - 0.25 * h) * (0.85 + 0.15 * smoothstep(1.1, 3.0, f));           // green bubbles
        vec3 col = mix(liquid, wax, m);
        vec3 off = mix(vec3(0.010, 0.030, 0.085), vec3(0.020, 0.10, 0.035), m);
        float rim = pow(1.0 - clamp(dot(normalize(vN), V), 0.0, 1.0), 3.0);
        col = mix(off, col, uOn) + rim * vec3(0.25, 0.2, 0.16);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Frosted incandescent bulb: a hot core that falls off towards the silhouette, cooling to orange at the neck.
export function makeBulbMaterial() {
  return new THREE.ShaderMaterial({
    name: 'fx_bulb',
    uniforms: { uOn: { value: 1 }, uAmb: { value: new THREE.Color(0.2, 0.18, 0.15) } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vP; varying float vH;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vH = uv.y;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec3 vN; varying vec3 vP; varying float vH; uniform float uOn; uniform vec3 uAmb;
      void main() {
        float ndv = clamp(dot(normalize(vN), normalize(cameraPosition - vP)), 0.0, 1.0);
        float neck = smoothstep(0.0, 0.32, vH);                              // uv.y runs from the socket (0) to the tip (1)
        vec3 hot = mix(vec3(1.0, 0.42, 0.10), vec3(1.0, 0.80, 0.52), neck) * (6.0 + 30.0 * pow(ndv, 1.6) * neck);
        hot += vec3(1.0, 0.93, 0.80) * 60.0 * pow(ndv, 9.0) * neck;          // the filament showing through the frosting
        vec3 cold = uAmb * (0.55 + 0.45 * ndv) + vec3(0.10) * pow(1.0 - ndv, 3.0);
        gl_FragColor = vec4(mix(cold, hot, uOn), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Things that move (a disk on its way to the drive) are not lightmapped: they take a single ambient colour.
export function makeProxyMaterial({ map = null, color = 0xffffff, shared, disc = false }) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uUseMap: { value: map ? 1 : 0 }, uColor: { value: new THREE.Color(color) }, uLight: shared.uProxyLight },
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      uniform sampler2D map; uniform float uUseMap; uniform vec3 uColor, uLight;
      void main() {
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vP);
        vec3 c = uColor * (uUseMap > 0.5 ? texture2D(map, vUv).rgb : vec3(1.0));
        ${disc ? `
        vec2 q = vUv - 0.5; float r = length(q) * 2.0, a = atan(q.y, q.x);
        float hub = smoothstep(0.30, 0.28, r), hole = step(r, 0.12);
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (r * 1.4 + dot(N, V) * 1.8 + a * 0.16) + vec3(0.0, 2.1, 4.2));
        c = mix(mix(vec3(0.72, 0.74, 0.78), rainbow, 0.55), vec3(0.85), hub);
        if (hole > 0.5 || r > 1.0) discard;` : ''}
        float lit = 0.62 + 0.38 * clamp(N.y, 0.0, 1.0);
        gl_FragColor = vec4(c * uLight * lit + vec3(0.04) * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}
