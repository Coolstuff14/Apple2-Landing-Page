// Screensavers: the set that shipped with Windows 98, redrawn from scratch (no original code, bitmaps or textures).
//   3D Flower Box · 3D Flying Objects · 3D Maze · 3D Pipes · 3D Text        -> savers3d.js (one shared WebGL context)
//   Blank Screen · Curves and Colors · Flying Through Space · Flying Windows · Mystify Your Mind · Scrolling Marquee
// Each saver is { id, name, init() -> state, draw(g, state, t, dt), dispose?(state) } on a 640x480 logical screen;
// the same functions feed the full-screen overlay and the small preview in Display Properties.

import { h } from './dom.js';
import { SAVERS_3D } from './savers3d.js';

export const DEFAULT_SAVER = 'pipes';
const rnd = (a, b) => a + Math.random() * (b - a);
const black = g => { g.fillStyle = '#000'; g.fillRect(0, 0, 640, 480); };

/** The mark that flies in "Flying Windows" and waves in "3D Flying Objects": a four-pane flag with a trail of
 *  blocks, in the box (0, 0, w, h). `cols` = one colour, or [top-left, top-right, bottom-left, bottom-right].
 *  This is the only place the mark is drawn: swap this function to fly something else. */
export function drawFlag(g, w, hgt, cols) {
  const c = typeof cols === 'string' ? [cols, cols, cols, cols] : cols;
  const x0 = 0.36 * w, x1 = 0.98 * w, mid = (x0 + x1) / 2, gap = 0.035 * w, top = 0.16 * hgt, bot = 0.86 * hgt, my = (top + bot) / 2;
  const wave = x => Math.sin((x - x0) / (x1 - x0) * Math.PI * 1.25 + 0.5) * 0.07 * hgt - (x - x0) / (x1 - x0) * 0.06 * hgt;
  const pane = (xa, xb, ya, yb, col) => {
    g.fillStyle = col; g.beginPath();
    for (let i = 0; i <= 8; i++) { const x = xa + (xb - xa) * i / 8; g.lineTo(x, ya + wave(x)); }
    for (let i = 8; i >= 0; i--) { const x = xa + (xb - xa) * i / 8; g.lineTo(x, yb + wave(x)); }
    g.closePath(); g.fill();
  };
  pane(x0, mid - gap / 2, top, my - gap / 2, c[0]); pane(mid + gap / 2, x1, top, my - gap / 2, c[1]);
  pane(x0, mid - gap / 2, my + gap / 2, bot, c[2]); pane(mid + gap / 2, x1, my + gap / 2, bot, c[3]);
  for (let col = 0; col < 4; col++) {                 // the trail: blocks shrinking away to the left
    const s = (0.085 - col * 0.017) * w, x = x0 - (col + 1) * 0.085 * w;
    for (let row = 0; row < 4; row++) {
      if (col > 1 && (row + col) % 2) continue;
      g.fillStyle = c[row < 2 ? 0 : 2]; g.fillRect(x, top + (bot - top) * (row + 0.5) / 4 - s * 0.45 + wave(x0), s, s * 0.9);
    }
  }
}

// ---------------------------------------------------------------- Flying Through Space
const stars = {
  id: 'stars', name: 'Flying Through Space',
  init: () => Array.from({ length: 64 }, () => ({ x: rnd(-1, 1), y: rnd(-1, 1), z: Math.random() })),
  draw(g, list, t, dt) {
    black(g);
    g.fillStyle = '#fff';
    for (const s of list) {
      s.z -= dt * 0.30;
      const px = 320 + s.x / s.z * 300, py = 240 + s.y / s.z * 300;
      if (s.z <= 0.02 || px < 0 || px >= 640 || py < 0 || py >= 480) { s.x = rnd(-1, 1); s.y = rnd(-1, 1); s.z = 1; continue; }
      const sz = s.z < 0.2 ? 3 : s.z < 0.5 ? 2 : 1;
      g.fillRect(Math.round(px), Math.round(py), sz, sz);
    }
  },
};

// ---------------------------------------------------------------- Flying Windows
const FLY_COLS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#ffffff', '#ff8000', '#c0c0c0'];
const windows = {
  id: 'windows', name: 'Flying Windows',
  init: () => Array.from({ length: 28 }, () => ({ x: rnd(-1, 1), y: rnd(-1, 1), z: Math.random(), c: FLY_COLS[Math.floor(Math.random() * FLY_COLS.length)] })),
  draw(g, list, t, dt) {
    black(g);
    list.sort((a, b) => b.z - a.z);
    for (const s of list) {
      s.z -= dt * 0.26;
      const size = Math.min(96, 7 / s.z), px = 320 + s.x / s.z * 260, py = 240 + s.y / s.z * 260;
      if (s.z <= 0.03 || px < -90 || px > 730 || py < -70 || py > 550) { s.x = rnd(-1, 1); s.y = rnd(-1, 1); s.z = 1; s.c = FLY_COLS[Math.floor(Math.random() * FLY_COLS.length)]; continue; }
      g.save(); g.translate(Math.round(px - size * 0.65), Math.round(py - size / 2)); drawFlag(g, size * 1.3, size, s.c); g.restore();
    }
  },
};

// ---------------------------------------------------------------- Mystify Your Mind
const hsl = hue => `hsl(${Math.round(hue) % 360},100%,55%)`;
const bouncer = () => ({ x: rnd(20, 620), y: rnd(20, 460), vx: rnd(110, 210) * (Math.random() < 0.5 ? -1 : 1), vy: rnd(110, 210) * (Math.random() < 0.5 ? -1 : 1) });
const bounce = (p, dt) => {
  p.x += p.vx * dt; p.y += p.vy * dt;
  if (p.x < 0 || p.x > 639) { p.vx = -p.vx; p.x = Math.max(0, Math.min(639, p.x)); }
  if (p.y < 0 || p.y > 479) { p.vy = -p.vy; p.y = Math.max(0, Math.min(479, p.y)); }
};
const mystify = {
  id: 'mystify', name: 'Mystify Your Mind',
  init: () => ({ acc: 0, polys: [0, 1].map(i => ({ pts: [0, 1, 2, 3].map(bouncer), trail: [], hue: i ? 300 : 180, dh: i ? 14 : -11 })) }),
  draw(g, st, t, dt) {
    black(g);
    st.acc += dt;
    const snap = st.acc > 0.045; if (snap) st.acc = 0;
    g.lineWidth = 1;
    for (const p of st.polys) {
      p.pts.forEach(q => bounce(q, dt)); p.hue = (p.hue + p.dh * dt + 360) % 360;
      if (snap) { p.trail.push(p.pts.map(q => [q.x, q.y])); if (p.trail.length > 6) p.trail.shift(); }
      g.strokeStyle = hsl(p.hue);
      for (const shape of [...p.trail, p.pts.map(q => [q.x, q.y])]) {
        g.beginPath(); shape.forEach((q, i) => (i ? g.lineTo(Math.round(q[0]) + 0.5, Math.round(q[1]) + 0.5) : g.moveTo(Math.round(q[0]) + 0.5, Math.round(q[1]) + 0.5))); g.closePath(); g.stroke();
      }
    }
  },
};

// ---------------------------------------------------------------- Curves and Colors
const curves = {
  id: 'curves', name: 'Curves and Colors',
  init: () => ({ acc: 0, hue: Math.random() * 360, pts: Array.from({ length: 12 }, bouncer), trail: [] }),
  draw(g, st, t, dt) {
    black(g);
    st.pts.forEach(q => bounce(q, dt * 0.8)); st.hue = (st.hue + 40 * dt) % 360; st.acc += dt;
    if (st.acc > 0.06) { st.acc = 0; st.trail.push({ hue: st.hue, p: st.pts.map(q => [q.x, q.y]) }); if (st.trail.length > 9) st.trail.shift(); }
    g.lineWidth = 1;
    for (const f of [...st.trail, { hue: st.hue, p: st.pts.map(q => [q.x, q.y]) }]) {
      const p = f.p, n = p.length;
      g.strokeStyle = hsl(f.hue); g.beginPath(); g.moveTo(p[0][0], p[0][1]);
      for (let i = 0; i < n; i += 3) g.bezierCurveTo(p[i + 1][0], p[i + 1][1], p[i + 2][0], p[i + 2][1], p[(i + 3) % n][0], p[(i + 3) % n][1]);       // a closed chain of four cubic segments
      g.stroke();
    }
  },
};

// ---------------------------------------------------------------- Scrolling Marquee
const marquee = {
  id: 'marquee', name: 'Scrolling Marquee',
  init: () => ({ x: 660, y: 240, text: 'Summit 98' }),
  draw(g, st, t, dt) {
    black(g);
    g.font = 'italic bold 56px "Times New Roman", Times, serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    const w = g.measureText(st.text).width;
    st.x -= 150 * dt;
    if (st.x < -w - 20) { st.x = 660; st.y = rnd(60, 420); }       // position: random, a new height on every pass
    g.fillStyle = '#ff00ff'; g.fillText(st.text, Math.round(st.x), Math.round(st.y));
  },
};

const blank = { id: 'blank', name: 'Blank Screen', still: true, init: () => null, draw: black };

// In the order of the original list box.
export const SAVERS = [...SAVERS_3D({ fallback: mystify, drawFlag }), blank, curves, stars, windows, mystify, marquee];
export const saverById = id => SAVERS.find(s => s.id === id) || null;

/** Runs one saver on a canvas of any size (scaled from 640x480). Returns stop(), which also carries `.state`. */
export function runSaver(canvas, id) {
  const def = saverById(id); if (!def) return () => {};
  const g = canvas.getContext('2d'); const st = def.init();
  let raf = 0, last = 0, t = 0, failed = false, looked = -1e9, visible = true;
  g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
  // A screensaver can stay up for the rest of a visit (in the room nothing reaches the desktop until you sit down),
  // so it is paced: about 30 frames a second, and nothing at all while its canvas is not shown.
  const frame = now => {
    raf = requestAnimationFrame(frame);
    if (last && now - last < 28) return;
    if (now - looked > 400) { looked = now; visible = !canvas.checkVisibility || canvas.checkVisibility({ visibilityProperty: true }); }
    if (!visible) { last = now; return; }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.033; last = now; t += dt;
    g.save(); g.scale(canvas.width / 640, canvas.height / 480);
    try { if (!failed) def.draw(g, st, t, dt); else black(g); } catch (err) { failed = true; console.warn(`[os98] screensaver ${id} stopped`, err); }      // an idle screen must never break the desktop
    g.restore();
    if (def.still) cancelAnimationFrame(raf);          // nothing moves: one frame is enough
  };
  raf = requestAnimationFrame(frame);
  const stop = () => { cancelAnimationFrame(raf); try { def.dispose?.(st); } catch { /* context already gone */ } };
  stop.state = st;
  return stop;
}

export function createScreensaver(overlay) {
  let canvas = null, stop = null, shownAt = 0, current = null;
  return {
    active: () => !!canvas,
    /** ms since the saver appeared (used to ignore the pointer jitter that follows). */
    age: () => (canvas ? performance.now() - shownAt : 0),
    /** id and live state of the running saver (test hook) */
    info: () => (canvas ? { id: current, state: stop?.state ?? null, canvas } : null),
    show(id = DEFAULT_SAVER) {
      if (canvas || !saverById(id)) return;
      canvas = h('canvas.os-saver', { width: 640, height: 480 });
      overlay.replaceChildren(canvas);
      overlay.style.display = 'block';
      shownAt = performance.now(); current = id;
      stop = runSaver(canvas, id);
    },
    hide() {
      if (!canvas) return;
      stop?.(); stop = null; canvas = null; current = null;
      overlay.replaceChildren();
      overlay.style.display = 'none';
    },
  };
}
