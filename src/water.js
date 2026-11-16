// Shared GLSL + uniforms for everything that sits in the aquarium's water: the lightmapped decor (materials.js)
// and the unbaked fish, plants, bubbles and glass (aquarium.js). All positions are three.js world space.
import * as THREE from 'three';

export const NOISE_GLSL = /* glsl */`
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

export const WATER_GLSL = /* glsl */`
uniform vec3 uTankMin, uTankMax, uWaterCol, uTankLight, uCavePos, uRaveCol, uAmb;
uniform float uFogK, uWTime, uBlueLvl;
${NOISE_GLSL}
// length of the camera -> P segment that runs through the water box (works from inside and from the room)
float waterPath(vec3 P) {
  vec3 d = P - cameraPosition; float len = length(d); d /= max(len, 1e-5);
  vec3 inv = 1.0 / (d + (1.0 - abs(sign(d))) * 1e-5);
  vec3 t0 = (uTankMin - cameraPosition) * inv, t1 = (uTankMax - cameraPosition) * inv;
  vec3 tn = min(t0, t1), tf = min(max(t0, t1), vec3(len));
  return max(min(min(tf.x, tf.y), tf.z) - max(max(tn.x, tn.y), max(tn.z, 0.0)), 0.0);
}
vec3 waterFog(vec3 col, vec3 P) { return mix(uWaterCol, col, exp(-waterPath(P) * uFogK)); }
float inWater(vec3 P) { vec3 b = step(uTankMin, P) * step(P, uTankMax); return b.x * b.y * b.z; }
// light focused by the rippling surface: bright ridges where a sum of warped waves crosses zero
float caustic(vec3 P) {
  vec2 p = P.xz * 52.0; float t = uWTime;
  vec2 q = p + 1.7 * vec2(sin(p.y * 0.71 + t * 0.9), cos(p.x * 0.63 - t * 0.7));
  float a = sin(q.x * 1.3 + t) + sin(q.y * 1.7 - t * 1.2) + sin((q.x + q.y) * 0.9 + t * 0.6) + sin((q.x - q.y) * 1.1 - t * 0.8);
  return pow(clamp(1.0 - abs(a) * 0.55, 0.0, 1.0), 5.0);
}
float grain(vec3 P) { return vnoise(P * 380.0) * 0.6 + vnoise(P * 1100.0) * 0.4; }
// what the party under the rock leaks into the water around its entrance
vec3 caveGlow(vec3 P) { vec3 d = P - uCavePos; return uRaveCol / (1.0 + 700.0 * dot(d, d)); }`;

/** One set of uniform objects, shared by reference between every material that needs the water. */
export function createTankUniforms(meta, shared) {
  const T = meta.tank;
  if (!T) return null;
  return {
    uTankMin: { value: new THREE.Vector3(T.lo[0], T.lo[2], -T.hi[1]) },
    uTankMax: { value: new THREE.Vector3(T.hi[0], T.water, -T.lo[1]) },
    uWaterCol: { value: new THREE.Color(0.05, 0.2, 0.25) }, uTankLight: { value: new THREE.Color(1, 1, 1) },
    uCavePos: { value: new THREE.Vector3(T.cave.glow[0], T.cave.glow[2], -T.cave.glow[1]) }, uRaveCol: { value: new THREE.Color(0, 0, 0) },
    uAmb: shared.uProxyLight, uFogK: { value: 1.15 }, uWTime: { value: 0 }, uBlueLvl: { value: 0 },
  };
}
