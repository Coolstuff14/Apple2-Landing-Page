// Powder Day — an original slalom game. Steer a skier through gates on an endless,
// procedurally generated slope. Score = gates cleared; three slips and the run is over.
// All sprites are drawn in code. The loop only runs while playing and focused.

import { h, clamp, store } from '../dom.js';

const GW = 150, GH = 160, SCALE = 2;      // logical game pixels, drawn at 2x
const SKIER_Y = 42;
const BEST_KEY = 'summit98.powderday.best';

function hash(n) {                       // deterministic 0..1 noise
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export default {
  id: 'game', title: 'Powder Day', icon: 'game', single: true,
  open(sys) {
    const canvas = h('canvas.os-game-canvas', { width: GW * SCALE, height: GH * SCALE });
    canvas.style.width = GW * SCALE + 'px';
    canvas.style.height = GH * SCALE + 'px';
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    const overlay = h('div.os-game-overlay');
    const body = h('div.os-game', { tabindex: 0 }, canvas, overlay);
    const sGates = h('div', { style: { width: '74px' } }), sBest = h('div', { style: { width: '66px' } }), sLives = h('div.grow');

    let best = Number(store.get(BEST_KEY, 0)) || 0;
    let state = 'title';                  // 'title' | 'playing' | 'paused' | 'over'
    let run = null;
    const keys = { left: false, right: false };
    let pointerX = null;

    const R = (c, x, y, w, hh) => { g.fillStyle = c; g.fillRect(Math.round(x) * SCALE, Math.round(y) * SCALE, w * SCALE, hh * SCALE); };

    function newRun() {
      const seed = Math.floor(Math.random() * 10000);
      return { seed, x: GW / 2, vx: 0, dist: 0, speed: 46, score: 0, lives: 3, gates: [], trees: [], nextGate: 0, nextTreeRow: 0, trail: [], tumble: 0, flash: 0, flashColor: '' };
    }
    const gateCenter = (r, i) => clamp(GW / 2 + Math.sin(i * 0.83 + r.seed) * 38 + (hash(r.seed + i * 3.1) - 0.5) * 30, 26, GW - 26);
    const gateY = i => 150 + i * 62;
    function pathX(r, y) {                // corridor centre at world y (lerp between gates)
      const f = clamp((y - 150) / 62, 0, 1e6), i = Math.floor(f), t = f - i;
      return gateCenter(r, i) * (1 - t) + gateCenter(r, i + 1) * t;
    }

    function populate(r) {
      const bottom = r.dist + GH + 30;
      while (gateY(r.nextGate) < bottom) {
        const i = r.nextGate++;
        r.gates.push({ i, y: gateY(i), x: gateCenter(r, i), gap: Math.max(24, 36 - i * 0.25), done: 0 });
      }
      while (r.nextTreeRow * 14 < bottom) {
        const row = r.nextTreeRow++, y = row * 14 + 60;
        const n = hash(r.seed + row * 7.7) < 0.75 ? 1 : 2;
        for (let k = 0; k < n; k++) {
          const x = 6 + hash(r.seed + row * 13.3 + k * 5.1) * (GW - 12);
          if (Math.abs(x - pathX(r, y)) > 36 && y > 110) r.trees.push({ x, y, s: hash(row + k) > 0.5 ? 1 : 0 });
        }
      }
      r.gates = r.gates.filter(q => q.y > r.dist - 20);
      r.trees = r.trees.filter(q => q.y > r.dist - 24);
    }

    // ---- sprites ---------------------------------------------------------------------
    function drawTree(x, y, big) {
      const hgt = big ? 15 : 11;
      R('#5a3a1c', x - 1, y - 2, 2, 3);
      for (let i = 0; i < hgt; i++) {
        const w = 1 + Math.floor((i % 5) * 1.4 + i * 0.35);
        R(i % 5 === 0 ? '#e8f4ff' : '#1c6a3a', x - w, y - 3 - hgt + i, w * 2, 1);
        if (i % 5 !== 0) R('#124a28', x, y - 3 - hgt + i, w, 1);
      }
      R('#b8cce4', x - 4, y + 1, 9, 1);      // shadow
    }
    function drawFlag(x, y, color, done) {
      R('#b8cce4', x, y + 1, 4, 1);
      R('#303848', x, y - 9, 1, 10);
      R(done === 1 ? '#18b048' : color, x + 1, y - 9, 5, 3);
      R(done === 1 ? '#18b048' : color, x + 1, y - 6, 3, 1);
    }
    function drawSkier(x, y, lean, down) {
      if (down) {                          // tumbled in the snow
        R('#b8cce4', x - 5, y + 2, 11, 1);
        R('#303848', x - 6, y - 1, 8, 1); R('#303848', x - 2, y + 1, 8, 1);
        R('#f07818', x - 3, y - 3, 6, 3); R('#18a0a0', x + 3, y - 4, 3, 2); R('#f0c8a0', x + 3, y - 2, 2, 2);
        return;
      }
      const d = lean;                      // -1, 0, 1
      R('#b8cce4', x - 3 + d, y + 6, 7, 1);
      R('#303848', x - 3 - d, y + 1, 1, 6); R('#303848', x + 2 - d, y + 1, 1, 6);          // skis
      R('#303848', x - 3 - d * 2, y + 5, 1, 2); R('#303848', x + 2 - d * 2, y + 5, 1, 2);
      R('#202c60', x - 2, y, 2, 3); R('#202c60', x + 1, y, 2, 3);                        // legs
      R('#f07818', x - 3, y - 5, 6, 5);                                                   // jacket
      R('#c85808', x - 3, y - 1, 6, 1);
      R('#f07818', x - 4 + d, y - 4, 1, 3); R('#f07818', x + 3 + d, y - 4, 1, 3);        // arms
      R('#606878', x - 5 + d * 2, y - 2, 1, 5); R('#606878', x + 4 + d * 2, y - 2, 1, 5);// poles
      R('#f0c8a0', x - 1, y - 7, 3, 2);                                                   // face
      R('#18a0a0', x - 2, y - 9, 4, 2); R('#ffffff', x - 1, y - 10, 2, 1);               // hat
      R('#202020', x - 1 + d, y - 7, 3, 1);                                               // goggles
    }

    function render() {
      const r = run;
      R('#f2f7fd', 0, 0, GW, GH);
      const dist = r ? r.dist : 0, seed = r ? r.seed : 7;
      // snow texture: scattered soft bumps that scroll with the slope
      const first = Math.floor(dist / 8) - 1;
      for (let row = first; row < first + GH / 8 + 3; row++) {
        for (let k = 0; k < 3; k++) {
          const x = hash(row * 3.3 + k * 9.1 + seed) * GW, y = row * 8 + hash(row + k) * 8 - dist;
          R('#d6e4f4', x, y, 3, 1); R('#ffffff', x, y - 1, 2, 1);
        }
      }
      if (!r) { drawTree(20, 44, 1); drawTree(130, 30, 0); drawTree(122, 154, 1); drawTree(26, 150, 0); drawFlag(54, 72, '#d82020', 0); drawFlag(94, 72, '#2040d8', 0); drawSkier(GW / 2, 50, 0, false); return; }
      for (const p of r.trail) { R('#c4d6ea', p.x - 2, p.y - r.dist, 1, 2); R('#c4d6ea', p.x + 2, p.y - r.dist, 1, 2); }
      const things = [];
      for (const t of r.trees) things.push({ y: t.y, draw: () => drawTree(t.x, t.y - r.dist, t.s) });
      for (const q of r.gates) {
        things.push({ y: q.y, draw: () => {
          if (q.done === 2) R('#f0b0b0', q.x - q.gap / 2, q.y - r.dist, q.gap, 1);
          drawFlag(q.x - q.gap / 2 - 1, q.y - r.dist, '#d82020', q.done);
          drawFlag(q.x + q.gap / 2, q.y - r.dist, '#2040d8', q.done);
        } });
      }
      const sy = r.dist + SKIER_Y;
      things.push({ y: sy + 1, draw: () => drawSkier(r.x, SKIER_Y, r.vx < -18 ? -1 : r.vx > 18 ? 1 : 0, r.tumble > 0) });
      things.sort((a, b) => a.y - b.y).forEach(t => t.draw());
      if (r.flash > 0) { g.globalAlpha = Math.min(0.35, r.flash); R(r.flashColor, 0, 0, GW, GH); g.globalAlpha = 1; }
    }

    function hud() {
      const r = run;
      sGates.textContent = `Gates: ${r ? r.score : 0}`;
      sBest.textContent = `Best: ${best}`;
      const left = r ? Math.max(0, r.lives) : 3;
      sLives.textContent = 'Slips left: ' + '\u2665'.repeat(left) + ' -'.repeat(3 - left);
    }

    function setState(s, html) {
      state = s;
      body.dataset.state = s;
      overlay.innerHTML = html || '';
      overlay.style.display = html ? 'flex' : 'none';
      if (s === 'playing') loop.start(); else loop.stop();
      hud();
      render();
    }

    function step(dt) {
      const r = run;
      r.flash = Math.max(0, r.flash - dt);
      if (r.tumble > 0) {
        r.tumble -= dt;
        r.speed = Math.max(8, r.speed - 160 * dt);
        if (r.tumble <= 0 && r.lives <= 0) return gameOver();
      } else {
        const target = 46 + Math.min(84, r.score * 2.6);
        r.speed += (target - r.speed) * Math.min(1, dt * 1.5);
        let ax = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        if (ax) pointerX = null;
        if (pointerX != null) ax = clamp((pointerX - r.x) / 10, -1, 1);
        r.vx += (ax * 92 - r.vx) * Math.min(1, dt * 7);
        r.x = clamp(r.x + r.vx * dt, 8, GW - 8);
      }
      const prev = r.dist + SKIER_Y;
      r.dist += r.speed * dt;
      const now = r.dist + SKIER_Y;
      populate(r);
      if (!r.trail.length || now - r.trail[r.trail.length - 1].y >= 2) { r.trail.push({ x: r.x, y: now + 4 }); if (r.trail.length > 40) r.trail.shift(); }
      for (const q of r.gates) {
        if (q.done || q.y > now || q.y <= prev - 1) continue;
        if (Math.abs(r.x - q.x) <= q.gap / 2) { q.done = 1; r.score++; sys.sfx('gate'); r.flash = 0.12; r.flashColor = '#40ff80'; }
        else { q.done = 2; slip(r, false); }
        hud();
      }
      if (r.tumble <= 0) {
        for (const t of r.trees) {
          if (Math.abs(t.y - now) < 4 && Math.abs(t.x - r.x) < 5) { t.y -= 400; slip(r, true); hud(); break; }
        }
      }
      render();
    }

    function slip(r, crash) {
      r.lives--;
      r.flash = 0.25; r.flashColor = '#ff5040';
      sys.sfx(crash ? 'crash' : 'miss');
      if (crash) { r.tumble = 0.9; r.vx = 0; }
      else if (r.lives <= 0) r.tumble = 0.5;
    }

    function gameOver() {
      const record = run.score > best;
      if (record) { best = run.score; store.set(BEST_KEY, best); }
      sys.sfx(record ? 'ding' : 'close');
      setState('over', `<b>${record ? 'New best run!' : 'Run over'}</b><span>Gates cleared: ${run.score}</span><span>Best: ${best}</span><i>Press Space or click to ski again</i>`);
    }

    const start = () => { run = newRun(); populate(run); pointerX = null; keys.left = keys.right = false; setState('playing'); };
    const pause = () => { if (state === 'playing') setState('paused', '<b>Paused</b><i>Press Space or click to resume</i>'); };
    const resume = () => { if (state === 'paused') setState('playing'); };
    const go = () => { if (state === 'paused') resume(); else if (state !== 'playing') start(); };

    const win = sys.wm.open({
      appId: 'game', title: 'Powder Day', icon: 'game', w: GW * SCALE + 10, h: GH * SCALE + 18 + 18 + 21 + 10, resizable: false,
      color: [0.9, 0.93, 0.97], bodyClass: 'os-game-wrap',
      menu: [
        { label: '&Game', items: () => [
          { label: '&New Run', hint: 'F2', action: start },
          { label: state === 'paused' ? '&Resume' : '&Pause', hint: 'P', disabled: state !== 'playing' && state !== 'paused', action: () => (state === 'paused' ? resume() : pause()) },
          { sep: true },
          { label: 'E&xit', action: () => win.close() },
        ] },
        { label: '&Help', items: [
          { label: '&How to Play', action: () => { pause(); sys.msgBox({ title: 'Powder Day', icon: 'info', winIcon: 'game', w: 300, text: 'Ski between the red and blue flags of every gate.\n\nSteer with the Left/Right arrow keys, or point (or drag) where you want to go.\n\nMissing a gate or hitting a tree costs a slip. Three slips end the run. The slope gets faster as you go.' }); } },
        ] },
      ],
    });
    const loop = win.loop(dt => { if (state === 'playing') step(dt); });
    win.body.append(body, h('div.os-status', null, sGates, sBest, sLives));
    win.focusEl = body;

    win.el.addEventListener('keydown', e => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = true; e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = true; e.preventDefault(); }
      else if (k === ' ' || k === 'Enter') { if (e.target.closest('.os-menubar')) return; e.preventDefault(); go(); }
      else if (k === 'p' || k === 'P') { if (state === 'paused') resume(); else pause(); }
      else if (k === 'F2') { e.preventDefault(); start(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') e.preventDefault();
    });
    win.el.addEventListener('keyup', e => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
    });
    canvas.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      if (state !== 'playing') { go(); return; }
      pointerX = e.offsetX / SCALE;
    });
    canvas.addEventListener('pointermove', e => { if (state === 'playing' && e.target === canvas) pointerX = clamp(e.offsetX / SCALE, 0, GW); });
    overlay.addEventListener('pointerdown', e => { if (e.button > 0) return; go(); });
    win.on('blur', () => { keys.left = keys.right = false; pause(); });
    win.on('minimize', pause);

    setState('title', '<b class="big">Powder Day</b><span>Ski through the gates.<br>Left / Right arrows, or point to steer.</span><i>Press Space or click to start</i>');
    return win;
  },
};
