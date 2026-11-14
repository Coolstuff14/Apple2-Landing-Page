// Screensavers: original canvas designs drawn on a 640x480 logical screen.
// Each saver is { id, name, init() -> state, draw(g, state, t, dt) }; the same draw functions feed the
// full-screen overlay and the small preview in Display Properties.

import { h } from './dom.js';

const ridge = x => 426 - 46 * Math.abs(Math.sin(x * 0.011 + 0.6)) - 28 * Math.abs(Math.sin(x * 0.027 + 2)) - 10 * Math.sin(x * 0.09);

const snow = {
  id: 'snow', name: 'Snowfall',
  init: () => Array.from({ length: 140 }, () => {
    const depth = Math.random();
    return {
      x: Math.random() * 640, y: Math.random() * 480, s: depth > 0.8 ? 3 : depth > 0.4 ? 2 : 1,
      v: 18 + depth * 46, a: 8 + depth * 16, w: 0.6 + Math.random() * 1.4, p: Math.random() * 6.28,
      c: depth > 0.8 ? '#ffffff' : depth > 0.4 ? '#c8d8f0' : '#7088b0',
    };
  }),
  draw(g, flakes, t, dt) {
    g.fillStyle = '#000008'; g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#070f20';
    for (let x = 0; x < 640; x += 4) { const y = Math.round(ridge(x) / 2) * 2; g.fillRect(x, y, 4, 480 - y); }
    g.fillStyle = '#0c1830';
    for (let x = 0; x < 640; x += 4) { const y = Math.round((ridge(x * 0.6 + 300) + 44) / 2) * 2; g.fillRect(x, y, 4, 480 - y); }
    for (const f of flakes) {
      f.y += f.v * dt; f.p += dt * f.w; f.x += Math.sin(f.p) * f.a * dt + 6 * dt;
      if (f.y > 484) { f.y = -4; f.x = Math.random() * 640; }
      if (f.x > 644) f.x -= 648;
      g.fillStyle = f.c; g.fillRect(Math.round(f.x), Math.round(f.y), f.s, f.s);
    }
  },
};

const stars = {
  id: 'stars', name: 'Starfield',
  init: () => Array.from({ length: 170 }, () => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random() })),
  draw(g, list, t, dt) {
    g.fillStyle = '#000'; g.fillRect(0, 0, 640, 480);
    for (const s of list) {
      s.z -= dt * 0.32;
      if (s.z <= 0.02) { s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2; s.z = 1; }
      const px = 320 + s.x / s.z * 300, py = 240 + s.y / s.z * 300;
      if (px < 0 || px >= 640 || py < 0 || py >= 480) { s.z = 0; continue; }
      const b = Math.round(255 * Math.min(1, 1.25 - s.z)), sz = s.z < 0.25 ? 3 : s.z < 0.55 ? 2 : 1;
      g.fillStyle = `rgb(${b},${b},${Math.min(255, b + 30)})`; g.fillRect(Math.round(px), Math.round(py), sz, sz);
    }
  },
};

const ribbons = {
  id: 'ribbons', name: 'Ribbons',
  init: () => ({ trail: [], hue: Math.random() * 360 }),
  draw(g, st, t) {
    g.fillStyle = 'rgba(0,0,6,0.10)'; g.fillRect(0, 0, 640, 480);
    const pt = k => [320 + 250 * Math.sin(t * 0.61 + k) * Math.cos(t * 0.23), 240 + 180 * Math.sin(t * 0.83 + k * 1.3 + 1.1)];
    st.hue = (st.hue + 0.4) % 360;
    for (let r = 0; r < 3; r++) {
      const a = pt(r * 0.9), b = pt(r * 0.9 + 1.7 + 0.5 * Math.sin(t * 0.2));
      g.strokeStyle = `hsl(${(st.hue + r * 70) % 360},90%,60%)`; g.lineWidth = 2;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
  },
};

const logo = {
  id: 'logo', name: 'Wandering summit',
  init: () => ({ x: 120, y: 90, vx: 74, vy: 52, c: 0 }),
  draw(g, s, t, dt) {
    const W = 132, H = 78, cols = ['#30c0c0', '#f0c040', '#e06060', '#70d070', '#c090f0'];
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (s.x < 0 || s.x > 640 - W) { s.vx = -s.vx; s.x = Math.max(0, Math.min(640 - W, s.x)); s.c = (s.c + 1) % cols.length; }
    if (s.y < 0 || s.y > 480 - H) { s.vy = -s.vy; s.y = Math.max(0, Math.min(480 - H, s.y)); s.c = (s.c + 1) % cols.length; }
    g.fillStyle = '#000'; g.fillRect(0, 0, 640, 480);
    const x = Math.round(s.x), y = Math.round(s.y);
    g.fillStyle = cols[s.c];
    g.beginPath(); g.moveTo(x + 6, y + 50); g.lineTo(x + 44, y + 6); g.lineTo(x + 66, y + 30); g.lineTo(x + 84, y + 16); g.lineTo(x + 126, y + 50); g.closePath(); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(x + 44, y + 6); g.lineTo(x + 34, y + 18); g.lineTo(x + 43, y + 22); g.lineTo(x + 50, y + 16); g.lineTo(x + 56, y + 20); g.closePath(); g.fill();
    g.font = 'bold 17px Tahoma, Geneva, Verdana, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = cols[s.c]; g.fillText('Summit 98', x + W / 2, y + 56);
  },
};

const blank = { id: 'blank', name: 'Blank screen', init: () => null, draw(g) { g.fillStyle = '#000'; g.fillRect(0, 0, 640, 480); } };

export const SAVERS = [snow, stars, ribbons, logo, blank];
export const saverById = id => SAVERS.find(s => s.id === id) || null;

/** Runs one saver on a canvas of any size (scaled from 640x480). Returns stop(). */
export function runSaver(canvas, id) {
  const def = saverById(id); if (!def) return () => {};
  const g = canvas.getContext('2d'); const st = def.init();
  let raf = 0, last = 0, t = 0;
  g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
  const frame = now => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now; t += dt;
    g.save(); g.scale(canvas.width / 640, canvas.height / 480); def.draw(g, st, t, dt); g.restore();
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

export function createScreensaver(overlay) {
  let canvas = null, stop = null, shownAt = 0;
  return {
    active: () => !!canvas,
    /** ms since the saver appeared (used to ignore the pointer jitter that follows). */
    age: () => (canvas ? performance.now() - shownAt : 0),
    show(id = 'snow') {
      if (canvas || !saverById(id)) return;
      canvas = h('canvas.os-saver', { width: 640, height: 480 });
      overlay.replaceChildren(canvas);
      overlay.style.display = 'block';
      shownAt = performance.now();
      stop = runSaver(canvas, id);
    },
    hide() {
      if (!canvas) return;
      stop?.(); stop = null; canvas = null;
      overlay.replaceChildren();
      overlay.style.display = 'none';
    },
  };
}
