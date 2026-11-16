// The five OpenGL screensavers of Windows 98, rebuilt on the small renderer in saver-gl.js:
// 3D Flower Box, 3D Flying Objects, 3D Maze, 3D Pipes, 3D Text. Geometry and textures are generated here.
// Each renders a whole frame into the shared hidden canvas and then copies it to the caller's 2D canvas, so the
// usual saver contract (init / draw(g, state, t, dt)) holds and previews need no context of their own.

import { gl3d, M4, Geo, FLOATS } from './saver-gl.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const ASPECT = 640 / 480;
function hsv(h, s, v) { const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; }
const canvas2d = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };

/** Wraps a 3D saver: acquires the shared renderer (or runs the 2D fallback), rebuilds after a lost context,
 *  blits the frame, and frees the saver's buffers when it stops. `owned` in the saver state lists what to free. */
function saver3d(def, fallback) {
  return {
    id: def.id, name: def.name,
    init: () => ({ kit: null, s: null, fb: null }),
    draw(g, st, t, dt) {
      const kit = gl3d();
      if (!kit) { st.fb ||= fallback.init(); fallback.draw(g, st.fb, t, dt); return; }
      if (st.kit !== kit) { st.kit = kit; st.s = def.setup(kit); }
      def.frame(kit, st.s, t, dt);
      g.drawImage(kit.canvas, 0, 0, 640, 480);
      def.after?.(g, st.s, t, dt);
    },
    dispose(st) { if (st.kit && st.s && !st.kit.lost) st.kit.free(...(st.s.owned || [])); st.s = null; },
  };
}

// ================================================================ 3D Pipes
// Pipes grow node by node through a 3D lattice, turning at right angles through elbows (sometimes a ball joint),
// each pipe in its own colour, until the space is crowded; then the picture dissolves in blocks and starts again
// from another angle.
const GX = 13, GY = 10, GZ = 10, PR = 0.26, BEND = 0.40, BALL = 0.39, PIPE_CAP = 170000;
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const PIPE_COLS = [[0.85, 0.10, 0.10], [0.10, 0.68, 0.16], [0.14, 0.24, 0.90], [0.90, 0.80, 0.10], [0.10, 0.72, 0.78], [0.78, 0.14, 0.78], [0.85, 0.85, 0.85], [0.90, 0.45, 0.10], [0.42, 0.42, 0.48]];
const at = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const world = p => [p[0] - (GX - 1) / 2, p[1] - (GY - 1) / 2, p[2] - (GZ - 1) / 2];
const pipes = {
  id: 'pipes', name: '3D Pipes',
  setup(kit) {
    const mesh = kit.mesh(null, true, PIPE_CAP);
    const s = { mesh, owned: [mesh], occ: new Uint8Array(GX * GY * GZ), pipe: null, acc: 0, phase: 'grow', dis: 0, tiles: null, resets: 0, speed: 20 };
    this.reset(s);
    return s;
  },
  reset(s) {
    s.occ.fill(0); s.mesh.n = 0; s.pipe = null; s.pipes = 0; s.nodes = 0; s.phase = 'grow'; s.dis = 0; s.last = null;
    s.limit = Math.round(rnd(300, 400)); s.maxPipes = Math.round(rnd(6, 9));
    s.view = M4.mul(M4.rotX(rnd(-0.28, 0.28)), M4.rotY(rnd(0.25, 0.6) * (Math.random() < 0.5 ? -1 : 1)));
  },
  free: (s, p) => p[0] >= 0 && p[1] >= 0 && p[2] >= 0 && p[0] < GX && p[1] < GY && p[2] < GZ && !s.occ[(p[2] * GY + p[1]) * GX + p[0]],
  take(s, p) { s.occ[(p[2] * GY + p[1]) * GX + p[0]] = 1; s.nodes++; },
  dissolve(s) { s.phase = 'dissolve'; s.dis = 0; s.tiles = Array.from({ length: 40 * 30 }, (_, i) => i).sort(() => Math.random() - 0.5); },
  /** grow the picture by one lattice node */
  step(kit, s) {
    const g = new Geo();
    const emit = () => { if (g.count && !kit.append(s.mesh, g.array())) this.dissolve(s); };
    if (!s.pipe) {                                    // a new pipe starts with a ball
      if (s.nodes >= s.limit || s.pipes >= s.maxPipes) { this.dissolve(s); return; }
      let p = null;
      for (let i = 0; i < 60 && !p; i++) { const q = [Math.floor(rnd(1, GX - 1)), Math.floor(rnd(1, GY - 1)), Math.floor(rnd(1, GZ - 1))]; if (this.free(s, q)) p = q; }
      if (!p) { this.dissolve(s); return; }
      let col = pick(PIPE_COLS); if (col === s.last) col = PIPE_COLS[(PIPE_COLS.indexOf(col) + 1) % PIPE_COLS.length]; s.last = col;
      this.take(s, p);
      const open = DIRS.filter(d => this.free(s, at(p, d, 1)));
      g.sphere(world(p), BALL, col, 12, 8);
      if (!open.length) { emit(); s.pipes++; return; }
      const d = pick(open), w = world(p);
      g.tube([w, at(w, d, 0.5)], PR, col, 10);
      s.pipe = { p: at(p, d, 1), d, col, len: 1, max: Math.round(rnd(45, 130)) }; this.take(s, s.pipe.p);
      emit(); return;
    }
    const P = s.pipe, w = world(P.p), d = P.d;
    const open = DIRS.filter(n => !(n[0] === -d[0] && n[1] === -d[1] && n[2] === -d[2]) && this.free(s, at(P.p, n, 1)));
    if (!open.length || P.len >= P.max) {             // boxed in, or long enough: cap it with a ball
      g.tube([at(w, d, -0.5), w], PR, P.col, 10); g.sphere(w, BALL, P.col, 12, 8);
      s.pipe = null; s.pipes++; emit(); return;
    }
    const nd = open.includes(d) && Math.random() < 0.6 ? d : pick(open);
    if (nd === d) g.tube([at(w, d, -0.5), at(w, d, 0.5)], PR, P.col, 10);
    else if (Math.random() < 0.22) {                  // ball joint
      g.tube([at(w, d, -0.5), w], PR, P.col, 10); g.sphere(w, BALL, P.col, 12, 8); g.tube([w, at(w, nd, 0.5)], PR, P.col, 10);
    } else {                                          // elbow: a quarter turn of radius BEND
      const c = at(at(w, d, -BEND), nd, BEND), path = [at(w, d, -0.5)];
      for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2, sn = Math.sin(a), cs = Math.cos(a); path.push([c[0] + (d[0] * sn - nd[0] * cs) * BEND, c[1] + (d[1] * sn - nd[1] * cs) * BEND, c[2] + (d[2] * sn - nd[2] * cs) * BEND]); }
      path.push(at(w, nd, 0.5));
      g.tube(path, PR, P.col, 10);
    }
    P.d = nd; P.p = at(P.p, nd, 1); P.len++; this.take(s, P.p);
    emit();
  },
  frame(kit, s, t, dt) {
    if (s.phase === 'grow') { s.acc += dt * s.speed; let guard = 0; while (s.acc >= 1 && s.phase === 'grow' && guard++ < 40) { s.acc -= 1; this.step(kit, s); } }
    else { s.dis += dt / 0.9; if (s.dis >= 1.15) { this.reset(s); s.resets++; } }
    kit.begin(0, 0, 0);
    kit.camera(M4.persp(0.72, ASPECT, 0.5, 60), M4.lookAt([0, 0, 15], [0, 0, 0], [0, 1, 0]), [0, 0, 15], [-0.45, 0.65, 0.75]);
    kit.draw(s.mesh, s.view, { spec: 0.5, shin: 26, amb: 0.2 });
  },
  after(g, s) {                                       // the dissolve: 16 px blocks go black in random order
    if (s.phase !== 'dissolve') return;
    const n = Math.min(s.tiles.length, Math.floor(s.dis * s.tiles.length));
    g.fillStyle = '#000';
    for (let i = 0; i < n; i++) { const k = s.tiles[i]; g.fillRect((k % 40) * 16, Math.floor(k / 40) * 16, 16, 16); }
  },
};

// ================================================================ 3D Flower Box
// A checkered cube that tumbles and bounces while its faces swell into petals and pull back into spikes.
const flowerbox = {
  id: 'flowerbox', name: '3D Flower Box',
  setup(kit) {
    const n = 10, cells = [];
    for (let f = 0; f < 6; f++) {
      const ax = f >> 1, sg = f & 1 ? 1 : -1, u = (ax + 1) % 3, v = (ax + 2) % 3;
      const P = (i, j) => { const p = [0, 0, 0]; p[ax] = sg; p[u] = -1 + 2 * i / n; p[v] = -1 + 2 * j / n; return p; };
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cells.push({ q: sg > 0 ? [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)] : [P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j)], odd: (i + j) & 1 });
    }
    const mesh = kit.mesh(new Float32Array(cells.length * 6 * FLOATS), true);
    return { mesh, owned: [mesh], cells, data: new Float32Array(cells.length * 6 * FLOATS), x: 0, y: 0, vx: 1.1, vy: 0.8 };
  },
  frame(kit, s, t, dt) {
    const e = 1.0 + 1.7 * Math.sin(t * 0.8), S3 = Math.sqrt(3), hue = (t * 0.05) % 1;
    const A = hsv(hue, 0.9, 1), B = hsv((hue + 0.5) % 1, 0.75, 0.95);
    const morph = p => { const r = Math.hypot(p[0], p[1], p[2]), k = 1.9 * Math.pow(r / S3, e) / r; return [p[0] * k, p[1] * k, p[2] * k]; };
    const d = s.data; let o = 0;
    for (const c of s.cells) {
      const [a, b, cc, dd] = c.q.map(morph), col = c.odd ? A : B;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = dd[0] - a[0], vy = dd[1] - a[1], vz = dd[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (const p of [a, b, cc, a, cc, dd]) { d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = nx; d[o + 4] = ny; d[o + 5] = nz; d[o + 6] = col[0]; d[o + 7] = col[1]; d[o + 8] = col[2]; o += FLOATS; }
    }
    kit.update(s.mesh, d);
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (Math.abs(s.x) > 2.3) { s.vx = -s.vx; s.x = Math.sign(s.x) * 2.3; } if (Math.abs(s.y) > 1.4) { s.vy = -s.vy; s.y = Math.sign(s.y) * 1.4; }
    kit.begin(0, 0, 0);
    kit.camera(M4.persp(0.75, ASPECT, 0.5, 60), M4.lookAt([0, 0, 9], [0, 0, 0], [0, 1, 0]), [0, 0, 9]);
    kit.draw(s.mesh, M4.chain(M4.trans(s.x, s.y, 0), M4.rotY(t * 0.9), M4.rotX(t * 0.6)), { spec: 0.35, shin: 20, amb: 0.3 });
  },
};

// ================================================================ 3D Flying Objects
// The default style: a flag rippling in a breeze while it drifts about the screen.
const flyingObjects = drawFlag => ({
  id: 'objects', name: '3D Flying Objects',
  setup(kit) {
    const [cv, g] = canvas2d(256, 128);
    drawFlag(g, 256, 128, ['#e8281e', '#28b428', '#1e50dc', '#f0c814']);
    const tex = kit.texture(cv), nx = 34, ny = 14;
    const mesh = kit.mesh(new Float32Array(nx * ny * 6 * FLOATS), true);
    return { mesh, tex, owned: [mesh, tex], nx, ny, data: new Float32Array(nx * ny * 6 * FLOATS), x: 0.4, y: 0.2, vx: 0.55, vy: 0.4 };
  },
  frame(kit, s, t, dt) {
    const { nx, ny, data: d } = s, W = 3.4, H = 1.7;
    const P = (i, j) => {
      const u = i / nx, v = j / ny, x = (u - 0.5) * W, y = (v - 0.5) * H, k = 0.25 + 0.75 * u;
      const ph = x * 2.3 - t * 3.4, z = (0.20 * Math.sin(ph) + 0.06 * Math.sin(x * 4.1 + y * 2.6 - t * 4.6)) * k;
      const dz = (0.20 * 2.3 * Math.cos(ph) + 0.06 * 4.1 * Math.cos(x * 4.1 + y * 2.6 - t * 4.6)) * k, l = Math.hypot(dz, 1);
      return [x, y, z, -dz / l, 0, 1 / l, u, v];
    };
    let o = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (const [a, b] of [[i, j], [i + 1, j], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i, j + 1]]) {
      const p = P(a, b); d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = p[3]; d[o + 4] = p[4]; d[o + 5] = p[5]; d[o + 6] = 1; d[o + 7] = 1; d[o + 8] = 1; d[o + 9] = p[6]; d[o + 10] = p[7]; o += FLOATS;
    }
    kit.update(s.mesh, d);
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (Math.abs(s.x) > 1.5) { s.vx = -s.vx; s.x = Math.sign(s.x) * 1.5; } if (Math.abs(s.y) > 1.1) { s.vy = -s.vy; s.y = Math.sign(s.y) * 1.1; }
    kit.begin(0, 0, 0);
    kit.camera(M4.persp(0.8, ASPECT, 0.5, 60), M4.lookAt([0, 0, 7], [0, 0, 0], [0, 1, 0]), [0, 0, 7]);
    kit.draw(s.mesh, M4.chain(M4.trans(s.x, s.y, 0.6 * Math.sin(t * 0.5)), M4.rotY(0.55 * Math.sin(t * 0.62)), M4.rotX(0.3 * Math.sin(t * 0.41))), { tex: s.tex, cut: 0.5, spec: 0.45, shin: 24, amb: 0.35 });
  },
});

// ================================================================ 3D Text
// Extruded lettering rocking from side to side as it wanders around the screen. The outline is traced from a
// rendered bitmap (marching squares), so any font the browser has will do.
const text3d = {
  id: 'text3d', name: '3D Text',
  setup(kit) {
    const W = 512, H = 128, STEP = 2, text = 'OpenGL';
    const [cv, g] = canvas2d(W, H);
    g.font = 'bold 104px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    const tw = Math.min(W - 16, g.measureText(text).width);
    g.fillText(text, W / 2, H / 2 + 6, W - 16);
    const px = g.getImageData(0, 0, W, H).data;
    const f = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : px[(Math.round(y) * W + Math.round(x)) * 4 + 3] / 255);
    const k = 4.4 / W, depth = 0.24, X = x => (x - W / 2) * k, Y = y => (H / 2 - y) * k;
    const geo = new Geo(), side = [0.60, 0.64, 0.80], face = [0.90, 0.92, 1.0];
    // sides: one quad per contour segment, normal pointing out of the letter
    const cross = (xa, ya, va, xb, yb, vb) => { const q = (0.5 - va) / (vb - va || 1e-6); return [xa + (xb - xa) * q, ya + (yb - ya) * q]; };
    for (let y = 0; y < H - STEP; y += STEP) for (let x = 0; x < W - STEP; x += STEP) {
      const a = f(x, y), b = f(x + STEP, y), c = f(x + STEP, y + STEP), dd = f(x, y + STEP);
      const code = (a > 0.5 ? 1 : 0) | (b > 0.5 ? 2 : 0) | (c > 0.5 ? 4 : 0) | (dd > 0.5 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const T = () => cross(x, y, a, x + STEP, y, b), R = () => cross(x + STEP, y, b, x + STEP, y + STEP, c), Bm = () => cross(x, y + STEP, dd, x + STEP, y + STEP, c), L = () => cross(x, y, a, x, y + STEP, dd);
      const segs = { 1: [[L, T]], 2: [[T, R]], 3: [[L, R]], 4: [[R, Bm]], 5: [[L, T], [R, Bm]], 6: [[T, Bm]], 7: [[L, Bm]], 8: [[L, Bm]], 9: [[T, Bm]], 10: [[T, R], [L, Bm]], 11: [[R, Bm]], 12: [[L, R]], 13: [[T, R]], 14: [[L, T]] }[code];
      for (const [e0, e1] of segs) {
        const p = e0(), q = e1(); let nx = q[1] - p[1], ny = -(q[0] - p[0]); const l = Math.hypot(nx, ny); if (l < 1e-5) continue; nx /= l; ny /= l;
        if (f((p[0] + q[0]) / 2 + nx * 1.6, (p[1] + q[1]) / 2 + ny * 1.6) > 0.5) { nx = -nx; ny = -ny; }
        const n = [nx, -ny, 0];
        geo.quad([X(p[0]), Y(p[1]), depth], [X(q[0]), Y(q[1]), depth], [X(q[0]), Y(q[1]), -depth], [X(p[0]), Y(p[1]), -depth], n, side);
      }
    }
    const nSide = geo.count;
    // front and back: the bitmap itself, cut out by its alpha
    const x0 = X(0), x1 = X(W), y0 = Y(H), y1 = Y(0);
    geo.quad([x0, y0, depth], [x1, y0, depth], [x1, y1, depth], [x0, y1, depth], [0, 0, 1], face);
    geo.quad([x1, y0, -depth], [x0, y0, -depth], [x0, y1, -depth], [x1, y1, -depth], [0, 0, -1], face, [1, 0, 0, 1]);
    const mesh = kit.mesh(geo.array()), tex = kit.texture(cv);
    return { mesh, tex, owned: [mesh, tex], nSide, half: tw * k / 2, x: 0, y: 0, vx: 0.5, vy: 0.36 };
  },
  frame(kit, s, t, dt) {
    s.x += s.vx * dt; s.y += s.vy * dt;
    const bx = Math.max(0.2, 2.9 - s.half), by = 1.5;
    if (Math.abs(s.x) > bx) { s.vx = -s.vx; s.x = Math.sign(s.x) * bx; } if (Math.abs(s.y) > by) { s.vy = -s.vy; s.y = Math.sign(s.y) * by; }
    kit.begin(0, 0, 0);
    kit.camera(M4.persp(0.8, ASPECT, 0.5, 60), M4.lookAt([0, 0, 6.6], [0, 0, 0], [0, 1, 0]), [0, 0, 6.6]);
    const m = M4.chain(M4.trans(s.x, s.y, 0), M4.rotY(0.95 * Math.sin(t * 1.05)), M4.rotX(0.16 * Math.sin(t * 0.7)));     // "see-saw" spin
    kit.draw(s.mesh, m, { first: 0, count: s.nSide, spec: 0.6, shin: 30, amb: 0.25 });
    kit.draw(s.mesh, m, { first: s.nSide, count: s.mesh.n - s.nSide, tex: s.tex, cut: 0.5, spec: 0.6, shin: 30, amb: 0.3 });
  },
};

// ================================================================ 3D Maze
// A walk through a brick maze, keeping a hand on the wall. A smiley marks the way out, a rat wanders the
// corridors, and touching one of the grey spinning stones turns the world upside down.
const MZ = 10, WH = 0.72, EYE = WH / 2;      // wall height and eye level; cells are 1 x 1
function mazeTextures(kit) {
  const noise = (g, w, h, amt) => { const im = g.getImageData(0, 0, w, h); for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() - 0.5) * amt; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; } g.putImageData(im, 0, 0); };
  let [c, g] = canvas2d(64, 64);
  g.fillStyle = '#b4aca0'; g.fillRect(0, 0, 64, 64);
  for (let r = 0; r < 8; r++) for (let b = -1; b < 2; b++) {
    const x = b * 32 + (r % 2 ? 16 : 0), sh = 0.82 + Math.random() * 0.3;
    g.fillStyle = `rgb(${Math.round(168 * sh)},${Math.round(56 * sh)},${Math.round(40 * sh)})`; g.fillRect(x + 1, r * 8 + 1, 30, 6);
  }
  noise(g, 64, 64, 26); const brick = kit.texture(c, { nearest: true, repeat: true });
  [c, g] = canvas2d(64, 64);
  for (let p = 0; p < 4; p++) { const sh = 0.85 + Math.random() * 0.25; g.fillStyle = `rgb(${Math.round(150 * sh)},${Math.round(104 * sh)},${Math.round(58 * sh)})`; g.fillRect(0, p * 16, 64, 15); g.fillStyle = '#4a3018'; g.fillRect(0, p * 16 + 15, 64, 1); g.fillRect((p * 23 + 9) % 64, p * 16, 1, 15); }
  noise(g, 64, 64, 20); const floor = kit.texture(c, { nearest: true, repeat: true });
  [c, g] = canvas2d(64, 64);
  g.fillStyle = '#c4c4bc'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#a0a098'; g.fillRect(0, 0, 64, 1); g.fillRect(0, 0, 1, 64);
  noise(g, 64, 64, 30); const ceil = kit.texture(c, { nearest: true, repeat: true });
  [c, g] = canvas2d(64, 64);
  g.fillStyle = '#ffe020'; g.beginPath(); g.arc(32, 32, 28, 0, 6.3); g.fill(); g.lineWidth = 3; g.strokeStyle = '#000'; g.stroke();
  g.fillStyle = '#000'; g.fillRect(21, 20, 5, 9); g.fillRect(38, 20, 5, 9); g.beginPath(); g.arc(32, 34, 15, 0.25, Math.PI - 0.25); g.stroke();
  const smiley = kit.texture(c, { nearest: true });
  [c, g] = canvas2d(64, 64);
  g.strokeStyle = '#d09090'; g.lineWidth = 2; g.beginPath(); g.moveTo(14, 46); g.quadraticCurveTo(2, 44, 4, 30); g.stroke();
  g.fillStyle = '#8a8a8a'; g.beginPath(); g.ellipse(30, 44, 18, 11, 0, 0, 6.3); g.fill(); g.beginPath(); g.ellipse(48, 42, 10, 8, -0.2, 0, 6.3); g.fill();
  g.fillStyle = '#b0a0a0'; g.beginPath(); g.arc(46, 33, 5, 0, 6.3); g.fill(); g.fillStyle = '#000'; g.fillRect(51, 40, 2, 2); g.fillStyle = '#e09090'; g.fillRect(57, 43, 3, 2);
  g.fillStyle = '#6a6a6a'; g.fillRect(20, 53, 4, 4); g.fillRect(36, 53, 4, 4);
  const rat = kit.texture(c, { nearest: true });
  return { brick, floor, ceil, smiley, rat };
}
const MDIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];       // +x, +z, -x, -z
const maze = {
  id: 'maze', name: '3D Maze',
  setup(kit) {
    const tex = mazeTextures(kit), walls = kit.mesh(null, true, MZ * MZ * 4 * 6 + 12), sprites = kit.mesh(null, true, 6 * 4);
    const stone = new Geo(), V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const [a, b, c2] of [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]]) {
      const p = V[a], q = V[b], r = V[c2], n = [p[0] + q[0] + r[0], p[1] + q[1] + r[1], p[2] + q[2] + r[2]].map(x => x / Math.sqrt(3));
      for (const x of [p, q, r]) stone.v(x, n, [0.72, 0.72, 0.76]);
    }
    const stoneMesh = kit.mesh(stone.array());
    const s = { tex, walls, sprites, stoneMesh, owned: [walls, sprites, stoneMesh, ...Object.values(tex)], solved: 0 };
    this.build(kit, s);
    return s;
  },
  build(kit, s) {
    const open = Array.from({ length: MZ * MZ }, () => [false, false, false, false]), seen = new Uint8Array(MZ * MZ), stack = [0];
    seen[0] = 1;
    while (stack.length) {                             // depth-first carve: one twisting path to everywhere
      const cur = stack[stack.length - 1], cx = cur % MZ, cz = Math.floor(cur / MZ);
      const opts = [0, 1, 2, 3].filter(d => { const x = cx + MDIR[d][0], z = cz + MDIR[d][1]; return x >= 0 && z >= 0 && x < MZ && z < MZ && !seen[z * MZ + x]; });
      if (!opts.length) { stack.pop(); continue; }
      const d = pick(opts), nxt = (cz + MDIR[d][1]) * MZ + cx + MDIR[d][0];
      open[cur][d] = true; open[nxt][(d + 2) % 4] = true; seen[nxt] = 1; stack.push(nxt);
    }
    const g = new Geo();
    for (let cz = 0; cz < MZ; cz++) for (let cx = 0; cx < MZ; cx++) {
      const o = open[cz * MZ + cx];
      if (!o[0]) g.quad([cx + 1, 0, cz + 1], [cx + 1, 0, cz], [cx + 1, WH, cz], [cx + 1, WH, cz + 1], [-1, 0, 0], [0.80, 0.80, 0.80]);
      if (!o[2]) g.quad([cx, 0, cz], [cx, 0, cz + 1], [cx, WH, cz + 1], [cx, WH, cz], [1, 0, 0], [0.80, 0.80, 0.80]);
      if (!o[1]) g.quad([cx, 0, cz + 1], [cx + 1, 0, cz + 1], [cx + 1, WH, cz + 1], [cx, WH, cz + 1], [0, 0, -1], [1, 1, 1]);
      if (!o[3]) g.quad([cx + 1, 0, cz], [cx, 0, cz], [cx, WH, cz], [cx + 1, WH, cz], [0, 0, 1], [1, 1, 1]);
    }
    s.nWall = g.count;
    g.quad([0, 0, MZ], [MZ, 0, MZ], [MZ, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 1], [0, 0, MZ, MZ]);
    g.quad([0, WH, 0], [MZ, WH, 0], [MZ, WH, MZ], [0, WH, MZ], [0, -1, 0], [1, 1, 1], [0, 0, MZ, MZ]);
    s.walls.n = 0; kit.append(s.walls, g.array());
    // start in a random cell; the way out is the cell farthest from it
    const start = Math.floor(Math.random() * MZ * MZ), dist = new Int16Array(MZ * MZ).fill(-1), q = [start]; dist[start] = 0; let far = start;
    for (let i = 0; i < q.length; i++) { const cur = q[i]; if (dist[cur] > dist[far]) far = cur; for (let d = 0; d < 4; d++) if (open[cur][d]) { const n = cur + MDIR[d][0] + MDIR[d][1] * MZ; if (dist[n] < 0) { dist[n] = dist[cur] + 1; q.push(n); } } }
    const cells = [...dist.keys()].filter(i => i !== start && i !== far).sort(() => Math.random() - 0.5);
    Object.assign(s, { open, cell: start, dir: open[start].indexOf(true), ang: 0, goal: far, stones: cells.slice(0, 2), act: null, roll: 0, rollTo: 0, fade: 1, fadeTo: 0, done: 0,
      rat: { cell: cells[2], from: cells[2], k: 1 } });
    s.ang = s.dir * Math.PI / 2;
  },
  frame(kit, s, t, dt) {
    s.fade += Math.sign(s.fadeTo - s.fade) * Math.min(Math.abs(s.fadeTo - s.fade), dt / 0.6);
    if (s.done) { s.done += dt; if (s.done > 1.0) s.fadeTo = 1; if (s.done > 1.8) { s.solved++; this.build(kit, s); } }
    else if (!s.act) {                                  // at a cell centre: left hand on the wall
      if (s.cell === s.goal) s.done = 0.001;
      else {
        const nd = [3, 0, 1, 2].map(k => (s.dir + k) % 4).find(d => s.open[s.cell][d]);
        if (nd !== s.dir) { let da = ((nd - s.dir + 4) % 4) * Math.PI / 2; if (da > Math.PI) da -= 2 * Math.PI; s.act = { turn: true, from: s.ang, to: s.ang + da, k: 0, dur: Math.abs(da) > 2 ? 0.55 : 0.30, nd }; }
        else s.act = { turn: false, from: s.cell, to: s.cell + MDIR[nd][0] + MDIR[nd][1] * MZ, k: 0, dur: 0.42 };
      }
    }
    let ex = (s.cell % MZ) + 0.5, ez = Math.floor(s.cell / MZ) + 0.5;
    if (s.act) {
      const a = s.act; a.k = Math.min(1, a.k + dt / a.dur);
      if (a.turn) { s.ang = a.from + (a.to - a.from) * a.k; if (a.k >= 1) { s.dir = a.nd; s.ang = s.dir * Math.PI / 2; s.act = null; } }
      else {
        ex += MDIR[s.dir][0] * a.k; ez += MDIR[s.dir][1] * a.k;
        if (a.k >= 1) { s.cell = a.to; s.act = null; const i = s.stones.indexOf(s.cell); if (i >= 0) { s.stones.splice(i, 1); s.rollTo += Math.PI; } }
      }
    }
    s.roll += Math.sign(s.rollTo - s.roll) * Math.min(Math.abs(s.rollTo - s.roll), dt * 3.2);
    const R = s.rat; R.k += dt / 0.5;
    if (R.k >= 1) { R.k = 0; R.from = R.cell; const o = [0, 1, 2, 3].filter(d => s.open[R.cell][d]); const d = pick(o); R.cell = R.cell + MDIR[d][0] + MDIR[d][1] * MZ; }
    const hx = Math.cos(s.ang), hz = Math.sin(s.ang), rx = -hz, rz = hx, cr = Math.cos(s.roll), sr = Math.sin(s.roll);
    kit.begin(0, 0, 0);
    kit.camera(M4.persp(1.2, ASPECT, 0.04, 40), M4.lookAt([ex, EYE, ez], [ex + hx, EYE, ez + hz], [rx * sr, cr, rz * sr]), [ex, EYE, ez]);
    const I = M4.ident(), flat = { lit: false };
    kit.draw(s.walls, I, { ...flat, tex: s.tex.brick, first: 0, count: s.nWall });
    kit.draw(s.walls, I, { ...flat, tex: s.tex.floor, first: s.nWall, count: 6 });
    kit.draw(s.walls, I, { ...flat, tex: s.tex.ceil, first: s.nWall + 6, count: 6 });
    for (const c of s.stones) kit.draw(s.stoneMesh, M4.chain(M4.trans((c % MZ) + 0.5, EYE, Math.floor(c / MZ) + 0.5), M4.rotY(t * 2.2), M4.rotX(t * 1.3), M4.scale(0.17)), { spec: 0.5, shin: 20, amb: 0.45 });
    // billboards: the smiley at the way out, and the rat
    const sp = new Geo(), bb = (cx, cz, y, size) => { const a = [cx - rx * size, y - size, cz - rz * size], b = [cx + rx * size, y - size, cz + rz * size]; sp.quad(a, b, [b[0], y + size, b[2]], [a[0], y + size, a[2]], [0, 0, 1], [1, 1, 1]); };
    bb((s.goal % MZ) + 0.5, Math.floor(s.goal / MZ) + 0.5, EYE, 0.22);
    const fx = (R.from % MZ) + 0.5, fz = Math.floor(R.from / MZ) + 0.5, tx = (R.cell % MZ) + 0.5, tz = Math.floor(R.cell / MZ) + 0.5;
    bb(fx + (tx - fx) * R.k, fz + (tz - fz) * R.k, 0.14, 0.14);
    s.sprites.n = 0; kit.append(s.sprites, sp.array());
    kit.draw(s.sprites, I, { ...flat, tex: s.tex.smiley, cut: 0.5, first: 0, count: 6 });
    kit.draw(s.sprites, I, { ...flat, tex: s.tex.rat, cut: 0.5, first: 6, count: 6 });
  },
  after(g, s) { if (s.fade > 0.01) { g.fillStyle = `rgba(0,0,0,${Math.min(1, s.fade)})`; g.fillRect(0, 0, 640, 480); } },
};

/** The 3D savers in list-box order. `fallback` is the 2D saver drawn when WebGL is unavailable. */
export const SAVERS_3D = ({ fallback, drawFlag }) => [flowerbox, flyingObjects(drawFlag), maze, pipes, text3d].map(d => saver3d(d, fallback));
