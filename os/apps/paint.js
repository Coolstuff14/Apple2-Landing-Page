// Paint: un-antialiased pixel drawing on a canvas whose bitmap size equals its CSS
// size, so event.offsetX/offsetY map 1:1 to canvas pixels under any CSS transform.

import { h } from '../dom.js';
import { iconSvg } from '../icons.js';

const CW = 360, CH = 240, MAX_UNDO = 16;
const PALETTE = [
  '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080', '#808040', '#004040', '#0080ff', '#004080', '#4000ff', '#804000',
  '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffff80', '#00ff80', '#80ffff', '#8080ff', '#ff0080', '#ff8040',
];
const TOOLS = [
  ['pencil', 'Pencil: draws a free-form line one pixel wide.'],
  ['brush', 'Brush: draws with a round brush of the selected size.'],
  ['eraser', 'Eraser: paints with the background colour.'],
  ['fill', 'Fill With Colour: fills an area with the current colour.'],
  ['picker', 'Pick Colour: copies a colour from the picture.'],
  ['line', 'Line: draws a straight line of the selected width.'],
  ['rect', 'Rectangle: draws a rectangle of the selected width.'],
  ['ellipse', 'Ellipse: draws an ellipse of the selected width.'],
];
const SIZES = [1, 2, 3, 5];

const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
const rgb = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

// ---- raster primitives (no anti-aliasing) -------------------------------------------
function stamp(g, x, y, size, round) {
  if (size <= 1) { g.fillRect(x, y, 1, 1); return; }
  const o = Math.floor(size / 2);
  if (!round || size < 3) { g.fillRect(x - o, y - o, size, size); return; }
  const r = size / 2;
  for (let dy = -o; dy <= o; dy++) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    g.fillRect(x - half, y + dy, half * 2 + 1, 1);
  }
}
function line(x0, y0, x1, y1, plot) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function ellipse(x0, y0, x1, y1, plot) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  if (rx < 1 || ry < 1) { line(x0, y0, x1, y1, plot); return; }
  const steps = Math.ceil(Math.PI * 2 * Math.max(rx, ry) * 1.6);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    plot(Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a)));
  }
}
function flood(g, x, y, color) {
  if (x < 0 || y < 0 || x >= CW || y >= CH) return;
  const img = g.getImageData(0, 0, CW, CH), d = img.data;
  const [r, gg, b] = rgb(color);
  const at = (px, py) => (py * CW + px) * 4;
  const i0 = at(x, y), tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
  if (tr === r && tg === gg && tb === b) return;
  const match = i => d[i] === tr && d[i + 1] === tg && d[i + 2] === tb;
  const stack = [[x, y]];
  while (stack.length) {
    let [px, py] = stack.pop();
    while (px >= 0 && match(at(px, py))) px--;
    px++;
    let up = false, down = false;
    while (px < CW && match(at(px, py))) {
      const i = at(px, py);
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
      if (py > 0) { const m = match(at(px, py - 1)); if (m && !up) stack.push([px, py - 1]); up = m; }
      if (py < CH - 1) { const m = match(at(px, py + 1)); if (m && !down) stack.push([px, py + 1]); down = m; }
      px++;
    }
  }
  g.putImageData(img, 0, 0);
}

// ---- procedurally generated sample pictures (for .bmp files) --------------------------
function drawPicture(g, kind) {
  let seed = kind === 'sunset' ? 77 : 1998;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const R = (c, x, y, w, hh) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(hh)); };
  if (kind === 'grid') {
    R('#ffffff', 0, 0, CW, CH);
    for (let x = 0; x < CW; x += 20) R(x % 100 ? '#c0e0ff' : '#80b0e0', x, 0, 1, CH);
    for (let y = 0; y < CH; y += 20) R(y % 100 ? '#c0e0ff' : '#80b0e0', 0, y, CW, 1);
    g.fillStyle = '#000080';
    line(40, 200, 120, 60, (x, y) => stamp(g, x, y, 2));
    line(120, 60, 200, 200, (x, y) => stamp(g, x, y, 2));
    line(80, 130, 160, 130, (x, y) => stamp(g, x, y, 2));
    g.fillStyle = '#ff0000';
    ellipse(220, 80, 320, 180, (x, y) => stamp(g, x, y, 2));
    return;
  }
  const sky = kind === 'sunset' ? ['#281848', '#582860', '#a03860', '#e06040', '#ff9838', '#ffd060'] : ['#3878c8', '#5090d8', '#70a8e0', '#90c0e8', '#b0d4f0', '#d0e8f8'];
  sky.forEach((c, i) => {
    R(c, 0, i * 24, CW, 24);
    if (i) for (let x = (i % 2) * 2; x < CW; x += 4) R(c, x, i * 24 - 2, 2, 2);      // dithered band edge
  });
  R(kind === 'sunset' ? '#fff0a0' : '#fff8d0', kind === 'sunset' ? 250 : 286, kind === 'sunset' ? 104 : 26, 22, 22);
  const peak = (ax, ay, base, body, shade, snow) => {
    for (let y = ay; y < base; y++) {
      const half = (y - ay) * 0.9;
      R(body, ax - half, y, half * 2, 1);
      R(shade, ax, y, half, 1);
      if (y - ay < 34) { const j = ((y * 7 + ax) % 5) - 2; R(snow, ax - half, y, half * 2 + j * ((y - ay) > 24 ? 1 : 0), 1); }
    }
  };
  const dusk = kind === 'sunset';
  peak(250, 66, 176, dusk ? '#503058' : '#6080a0', dusk ? '#382040' : '#486888', dusk ? '#ffc0a0' : '#ffffff');
  peak(110, 40, 176, dusk ? '#684068' : '#7890b0', dusk ? '#402848' : '#506c90', dusk ? '#ffd0b0' : '#ffffff');
  R(dusk ? '#402848' : '#e8f0f8', 0, 176, CW, 64);
  R(dusk ? '#583860' : '#c8dcf0', 0, 176, CW, 3);
  for (let i = 0; i < 26; i++) {
    const x = 6 + rnd() * (CW - 12), y = 182 + rnd() * 46, s = 5 + Math.floor(rnd() * 5);
    for (let k = 0; k < s * 2; k++) R(dusk ? '#18101c' : '#1c5030', x - k / 2, y - s * 2 + k, k + 1, 1);
    R(dusk ? '#100810' : '#503018', x - 1, y, 2, 3);
  }
}

export default {
  id: 'paint', title: 'Paint', icon: 'paint',
  /** args: { picture: 'mountain' | 'sunset' | 'grid', name } */
  open(sys, args) {
    const st = { tool: 'pencil', size: 1, fg: '#000000', bg: '#ffffff', undo: [], name: args?.name || 'untitled' };
    const canvas = h('canvas.os-paint-canvas', { width: CW, height: CH });
    canvas.style.width = CW + 'px';
    canvas.style.height = CH + 'px';
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;

    const statusL = h('div.grow', { text: TOOLS[0][1] }), statusR = h('div', { style: { width: '64px' } });
    const fgEl = h('div.os-pal-fg'), bgEl = h('div.os-pal-bg');
    const toolBtns = new Map(), sizeBtns = new Map();

    const blank = () => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, CW, CH); };
    const pushUndo = () => { st.undo.push(g.getImageData(0, 0, CW, CH)); if (st.undo.length > MAX_UNDO) st.undo.shift(); };
    const undo = () => { const img = st.undo.pop(); if (img) g.putImageData(img, 0, 0); else sys.sfx('ding'); };
    const title = () => win.setTitle(`${st.name} - Paint`);

    function setTool(t) {
      st.tool = t;
      toolBtns.forEach((b, k) => b.classList.toggle('down', k === t));
      statusL.textContent = TOOLS.find(x => x[0] === t)[1];
    }
    function setSize(s) { st.size = s; sizeBtns.forEach((b, k) => b.classList.toggle('sel', k === s)); }
    function setColor(which, c) { st[which] = c; fgEl.style.background = st.fg; bgEl.style.background = st.bg; }

    function savePng() {
      try {
        canvas.toBlob(blob => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = h('a', { href: url, download: st.name.replace(/\.[a-z0-9]+$/i, '') + '.png', style: { display: 'none' } });
          win.body.appendChild(a);          // stays inside the OS root
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        }, 'image/png');
      } catch (err) {
        sys.msgBox({ title: 'Paint', icon: 'error', text: 'The picture could not be saved.' });
      }
    }

    const win = sys.wm.open({
      appId: 'paint', title: 'untitled - Paint', icon: 'paint', w: 452, h: 372, minW: 300, minH: 250,
      color: [0.82, 0.82, 0.82], bodyClass: 'os-paint',
      menu: [
        { label: '&File', items: [
          { label: '&New', action: () => { pushUndo(); blank(); st.name = 'untitled'; title(); } },
          { label: '&Save as PNG...', hint: 'Ctrl+S', action: savePng },
          { sep: true },
          { label: 'Set As &Wallpaper' },
          { sep: true },
          { label: 'E&xit', action: () => win.close() },
        ] },
        { label: '&Edit', items: () => [
          { label: '&Undo', hint: 'Ctrl+Z', disabled: !st.undo.length, action: undo },
          { sep: true },
          { label: '&Clear Image', action: () => { pushUndo(); g.fillStyle = st.bg; g.fillRect(0, 0, CW, CH); } },
        ] },
        { label: '&Help', items: [{ label: '&About Summit 98', action: () => sys.open('about') }] },
      ],
    });

    // ---- toolbox ---------------------------------------------------------------------
    const toolGrid = h('div.os-paint-toolgrid', null, TOOLS.map(([id, tip]) => {
      const b = h('button.os-btn.small.os-paint-tool', { type: 'button', 'data-tool': id, 'aria-label': tip.split(':')[0], html: iconSvg('tool-' + id, 16) });
      b.addEventListener('click', () => { setTool(id); sys.sfx('click'); });
      toolBtns.set(id, b);
      return b;
    }));
    const sizeBox = h('div.os-paint-sizes.os-field', null, SIZES.map(s => {
      const b = h('div.os-paint-size', { 'data-size': s }, h('i', { style: { height: s + 'px' } }));
      b.addEventListener('pointerdown', () => setSize(s));
      sizeBtns.set(s, b);
      return b;
    }));
    const palette = h('div.os-paint-palette', null, PALETTE.map(c => {
      const sw = h('div.os-pal-sw', { 'data-color': c, style: { background: c } });
      sw.addEventListener('pointerdown', e => { e.preventDefault(); setColor(e.button === 2 ? 'bg' : 'fg', c); });
      return sw;
    }));
    palette.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    win.body.append(
      h('div.os-paint-main', null,
        h('div.os-paint-side', null, toolGrid, sizeBox),
        h('div.os-paint-area.os-field', null, canvas)),
      h('div.os-paint-bottom', null, h('div.os-pal-cur.os-field', null, bgEl, fgEl), palette),
      h('div.os-status', null, statusL, statusR),
    );

    // ---- drawing ---------------------------------------------------------------------
    canvas.addEventListener('pointermove', e => { statusR.textContent = `${Math.floor(e.offsetX)},${Math.floor(e.offsetY)}`; });
    canvas.addEventListener('pointerleave', () => { statusR.textContent = ''; });
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      const alt = e.button === 2;
      const sx = e.offsetX, sy = e.offsetY;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const color = alt ? st.bg : st.fg;
      const tool = st.tool;
      if (tool === 'picker') {
        const p = g.getImageData(Math.min(CW - 1, Math.max(0, x0)), Math.min(CH - 1, Math.max(0, y0)), 1, 1).data;
        setColor(alt ? 'bg' : 'fg', hex(p[0], p[1], p[2]));
        return;
      }
      pushUndo();
      if (tool === 'fill') { flood(g, x0, y0, color); return; }
      const free = tool === 'pencil' || tool === 'brush' || tool === 'eraser';
      const size = tool === 'pencil' ? 1 : tool === 'brush' ? st.size * 2 + 1 : tool === 'eraser' ? st.size * 4 : st.size;
      const round = tool === 'brush';
      const paintColor = tool === 'eraser' ? (alt ? st.fg : st.bg) : color;
      const plot = (x, y) => stamp(g, x, y, size, round);
      const base = free ? null : g.getImageData(0, 0, CW, CH);
      let lx = x0, ly = y0;
      g.fillStyle = paintColor;
      plot(x0, y0);
      sys.pointer.drag(e, {
        cursor: 'crosshair',
        onMove: (px, py, dx, dy) => {
          const x = Math.floor(sx + dx), y = Math.floor(sy + dy);
          statusR.textContent = `${x},${y}`;
          g.fillStyle = paintColor;
          if (free) { line(lx, ly, x, y, plot); lx = x; ly = y; return; }
          g.putImageData(base, 0, 0);
          g.fillStyle = paintColor;
          if (tool === 'line') line(x0, y0, x, y, plot);
          else if (tool === 'rect') { line(x0, y0, x, y0, plot); line(x, y0, x, y, plot); line(x, y, x0, y, plot); line(x0, y, x0, y0, plot); }
          else ellipse(x0, y0, x, y, plot);
        },
      });
    });

    win.el.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); undo(); }
      else if (k === 's') { e.preventDefault(); savePng(); }
    });

    blank();
    if (args?.picture) drawPicture(g, args.picture);
    title();
    setTool('pencil'); setSize(1); setColor('fg', '#000000');
    return win;
  },
};
