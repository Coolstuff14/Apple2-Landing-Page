// Runtime side of the baked lighting.
// Every light in the room was path-traced separately in Cycles (white light, irradiance without albedo)
// into its own RGBM lightmap layer. Light transport is linear, so  final = Σ tintᵢ · layerᵢ  is exact for
// any colour / intensity of each light. The compositor sums the layers into one float render target per
// atlas whenever a light changes; surface shaders then need a single lightmap lookup.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Layer encodings (lightmaps.json "encoding" / "env_encoding"):
//   rgbm  lossless site/: RGBA PNG, value = rgb * a * range
//   cbrt  packed reflections: value = rgb^3 * range
//   yc    packed lightmaps (tools/pack_site.py): grey layer m = r^3 * range at full resolution, times a colour
//         n in [0,1] read from this atlas's low-resolution chroma image (one tile per layer, COLS tiles per row)
const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D t0, t1, t2, t3, t4, t5, t6, t7;
uniform vec3 w[8];            // tint * range per layer (unused slots: weight 0, 1x1 black texture)
uniform float uOutScale, uSqrt; // float targets: 1, 0. Without float render targets HDR is packed as sqrt(c * scale) in 8 bits
#if ENC == 2
uniform sampler2D tC;
uniform vec2 uGrid;           // tiles per row, rows
uniform float uTile;          // tile size in texels
vec3 chroma(float i) {
  vec2 cell = vec2(mod(i, uGrid.x), floor(i / uGrid.x));
  vec2 inner = clamp(vUv, 0.5 / uTile, 1.0 - 0.5 / uTile);   // never filter across into the neighbouring tile
  return texture2D(tC, (cell + inner) / uGrid).rgb;
}
#endif
vec3 dec(sampler2D t, float i) {
  vec4 c = texture2D(t, vUv);
#if ENC == 0
  return c.rgb * c.a;
#elif ENC == 1
  return c.rgb * c.rgb * c.rgb;
#else
  return c.r * c.r * c.r * chroma(i);
#endif
}
void main() {
  vec3 c = dec(t0, 0.0) * w[0] + dec(t1, 1.0) * w[1] + dec(t2, 2.0) * w[2] + dec(t3, 3.0) * w[3]
         + dec(t4, 4.0) * w[4] + dec(t5, 5.0) * w[5] + dec(t6, 6.0) * w[6] + dec(t7, 7.0) * w[7];
  c *= uOutScale;
  gl_FragColor = vec4(uSqrt > 0.5 ? sqrt(c) : c, 1.0);
}`;

const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); BLACK.needsUpdate = true;
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
quad.frustumCulled = false;
const quadScene = new THREE.Scene().add(quad);
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export function loadLayerTexture(loader, url) {
  return loader.loadAsync(url).then((t) => {
    t.colorSpace = THREE.NoColorSpace;
    t.flipY = false;               // row 0 of the PNG is v = 1 in Blender = v = 0 in glTF convention
    t.generateMipmaps = false;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping;
    t.premultiplyAlpha = false;
    t.needsUpdate = true;
    return t;
  });
}

export class LayerCompositor {
  /** layers: [{ name, tex, range }]; encoding 'rgbm' | 'cbrt' | 'yc' (yc needs chroma: { tex, tile, cols, rows }, tiles in layer order) */
  constructor(renderer, layers, width, height, { wrapS = THREE.ClampToEdgeWrapping, useFloat = true, outScale = 1, encoding = 'rgbm', chroma = null } = {}) {
    this.renderer = renderer;
    if (layers.length > 8) throw new Error('LayerCompositor supports at most 8 layers');
    this.ranges = layers.map((l) => l.range);
    this.names = layers.map((l) => l.name);
    this.rt = new THREE.WebGLRenderTarget(width, height, {
      type: useFloat ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, wrapS,
      colorSpace: THREE.NoColorSpace,
    });
    const u = { w: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) }, uOutScale: { value: outScale }, uSqrt: { value: useFloat ? 0 : 1 } };
    for (let i = 0; i < 8; i++) u['t' + i] = { value: layers[i] ? layers[i].tex : BLACK };
    const ENC = { rgbm: 0, cbrt: 1, yc: 2 }[encoding];
    if (ENC === undefined) throw new Error(`unknown lightmap encoding ${encoding}`);
    if (ENC === 2) {
      if (!chroma) throw new Error('yc encoding needs a chroma image');
      Object.assign(u, { tC: { value: chroma.tex }, uGrid: { value: new THREE.Vector2(chroma.cols, chroma.rows) }, uTile: { value: chroma.tile } });
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: u, defines: { ENC }, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, toneMapped: false,
    });
  }
  get texture() { return this.rt.texture; }
  /** tints: { layerName: THREE.Color-like {r,g,b} (linear) } */
  render(tints) {
    const w = this.material.uniforms.w.value;
    for (let i = 0; i < this.names.length; i++) { const t = tints[this.names[i]]; if (t) w[i].set(t.r, t.g, t.b).multiplyScalar(this.ranges[i]); else w[i].set(0, 0, 0); }
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevXr = r.xr.enabled; r.xr.enabled = false;
    quad.material = this.material;
    r.setRenderTarget(this.rt);
    r.render(quadScene, quadCam);
    r.setRenderTarget(prev);
    r.xr.enabled = prevXr;
  }
}
