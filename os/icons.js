// Original pixel-art icons, described as rectangles on a 32x32 (or 16x16) grid and
// emitted as inline SVG (crisp at any CSS/3D scale). Nothing here is copied artwork.

const PAL = {
  K: '#000000', W: '#ffffff', g: '#c0c0c0', d: '#808080', D: '#404040',
  t: '#008080', T: '#00a8a8', n: '#000080', b: '#0000ff', s: '#7fb8e8', S: '#b8dcf8',
  y: '#ffe030', l: '#ffffa8', Y: '#b08800', B: '#804000', o: '#ff8000',
  r: '#e00000', R: '#800000', G: '#008000', L: '#00e000', p: '#a000a0', c: '#00e0e0',
  m: '#3c5878', M: '#607c9c', P: '#ffa0b8',
};

/** Parse "K3,2,26,20 g4,3,24,18" into rect tuples. */
function parse(spec) {
  return spec.trim().split(/\s+/).map(tok => {
    const [x, y, w, hh] = tok.slice(1).split(',').map(Number);
    return [x, y, w, hh, tok[0]];
  });
}

function disc(cx, cy, r, c) {
  const out = [];
  for (let y = -r; y <= r; y++) {
    const half = Math.round(Math.sqrt(r * r - y * y));
    if (half > 0) out.push([cx - half, cy + y, half * 2, 1, c]);
  }
  return out;
}

/** Triangle with apex at (ax, ay), growing 1px per side per row. */
function tri(ax, ay, rows, c, step = 1) {
  const out = [];
  for (let i = 0; i < rows; i++) out.push([ax - Math.floor(i * step), ay + i, Math.floor(i * step) * 2 + 2, 1, c]);
  return out;
}

function diag(x, y, n, dx, dy, w, hh, c) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([x + i * dx, y + i * dy, w, hh, c]);
  return out;
}

const PAGE = 'W7,3,14,26 W21,8,4,21 K6,2,16,1 K6,2,1,28 K6,29,20,1 K25,7,1,23 K21,3,1,5 K22,7,4,1 K22,3,1,1 K23,4,1,1 K24,5,1,1 K25,6,1,1 g22,4,1,3 g23,5,1,2 g24,6,1,1';

const ICONS = {
  computer: () => parse(
    'K3,2,26,20 g4,3,24,18 W4,3,24,1 W4,3,1,18 d27,4,1,17 d5,20,23,1 K6,5,20,13 t7,6,18,11 ' +
    'W15,9,2,1 W14,10,4,1 g13,11,6,1 d12,12,8,1 d11,13,10,1 d10,14,12,2 T7,6,18,1 ' +
    'd12,22,8,2 K5,24,22,5 g6,25,20,3 W6,25,20,1 d6,27,20,1 L22,26,2,1'),
  drive: () => parse(
    'K3,10,26,13 g4,11,24,11 W4,11,24,1 W4,11,1,11 d27,12,1,10 d5,21,23,1 D7,15,13,2 d7,18,13,1 L23,15,2,2 K23,19,3,1'),
  floppy: () => parse(
    'K5,4,22,24 n6,5,20,22 W9,5,14,10 d11,7,10,1 d11,9,10,1 d11,11,7,1 g10,19,12,8 D17,20,3,6 K5,4,2,1'),
  cdrom: () => [
    ...disc(16, 16, 13, 'D'), ...disc(16, 16, 12, 'g'),
    ...parse('c18,7,5,2 c20,9,5,2 y21,11,5,2 p8,19,4,2 p9,21,5,2 b11,23,5,2 W9,8,5,1 W7,10,4,1'),
    ...disc(16, 16, 4, 'd'), ...disc(16, 16, 2, 'W'),
  ],
  folder: () => parse(
    'K3,6,10,1 K2,7,1,3 y3,7,10,3 K13,7,1,2 K2,9,28,18 y3,10,26,16 l3,10,26,1 l3,10,1,16 Y3,25,26,1 Y28,11,1,15 K14,8,16,1'),
  txt: () => parse(PAGE + ' n9,10,10,1 n9,13,13,1 n9,16,12,1 n9,19,13,1 n9,22,8,1'),
  bmp: () => parse(PAGE + ' s9,11,14,12 y19,12,3,3 W15,14,2,1 W14,15,4,1 d13,16,6,1 d12,17,8,1 d11,18,10,2 G9,20,14,3 K9,11,14,1 K9,23,14,1 K9,11,1,13 K22,11,1,13'),
  audio: () => parse(PAGE + ' K12,11,10,2 K12,11,2,10 K20,11,2,9 K9,19,5,3 K10,18,3,5 K17,18,5,3 K18,17,3,5'),
  notepad: () => parse(
    'K6,4,20,25 W7,5,18,23 n7,5,18,4 K9,2,2,5 K13,2,2,5 K17,2,2,5 K21,2,2,5 g9,2,1,2 g13,2,1,2 g17,2,1,2 g21,2,1,2 ' +
    'd9,12,14,1 d9,15,14,1 d9,18,14,1 d9,21,10,1 d9,24,12,1'),
  paint: () => parse(
    'B8,22,2,8 B22,22,2,8 B15,22,2,6 K5,3,22,20 W6,4,20,18 r8,6,5,5 y14,6,5,5 b20,6,4,5 G8,12,5,6 o14,12,5,6 p20,12,4,6 ' +
    'K21,15,2,2 Y23,17,2,2 Y25,19,2,2 Y27,21,2,2 Y29,23,2,2 r19,13,2,2'),
  terminal: () => parse(
    'K2,4,28,23 g3,5,26,21 W3,5,26,1 W3,5,1,21 d28,6,1,20 n4,6,24,3 K4,10,24,15 L6,12,1,1 L7,13,1,1 L6,14,1,1 L9,14,6,1 L6,17,11,1 L6,20,7,1 L14,20,3,1 L6,23,2,1'),
  player: () => parse(
    'K3,7,26,19 g4,8,24,17 W4,8,24,1 W4,8,1,17 d27,9,1,16 d5,24,23,1 K6,10,20,7 L7,15,2,1 L10,13,2,3 L13,11,2,5 L16,14,2,2 L19,12,2,4 L22,15,2,1 ' +
    'd6,19,5,4 d12,19,5,4 d18,19,5,4 K8,20,1,2 K14,20,2,2 K20,20,1,2 K21,20,1,2 W24,20,2,2'),
  game: () => [
    ...parse('K2,3,28,26 S3,4,26,24 W3,10,26,18'),
    ...tri(22, 4, 6, 'M'), ...tri(22, 4, 2, 'W'), ...tri(9, 6, 4, 'M'), ...tri(9, 6, 1, 'W'),
    ...parse('K9,13,1,7 r10,13,4,3 K23,18,1,7 b24,18,4,3 t15,11,3,2 o14,13,5,4 K15,17,1,2 K17,17,1,2 K13,19,3,1 K17,19,3,1 ' +
      'G6,22,1,1 G5,23,3,1 G4,24,5,1 B6,25,1,2 S12,22,1,3 S19,23,1,3'),
  ],
  room: () => parse(
    'D12,3,8,1 Y11,4,10,2 y10,6,12,2 y8,8,16,3 Y7,11,18,1 l11,12,10,2 l13,14,6,1 d15,12,2,11 g15,12,1,11 K10,23,12,1 D8,24,16,3 g9,24,14,1 ' +
    'y3,13,2,1 y27,13,2,1 y4,17,2,1 y26,17,2,1'),
  about: () => [
    ...disc(16, 16, 14, 'K'), ...disc(16, 16, 13, 'W'),
    ...parse('n14,7,4,4 n12,13,6,2 n14,15,4,8 n12,23,8,2'),
  ],
  info: () => ICONS.about(),
  warn: () => [
    ...tri(15, 3, 26, 'K', 0.5), ...tri(15, 5, 23, 'y', 0.5).map(r => [r[0], r[1], r[2], r[3], r[4]]),
    ...parse('K14,11,4,10 K15,21,2,2 K14,24,4,3 K2,28,28,1'),
  ],
  error: () => [
    ...disc(16, 16, 14, 'R'), ...disc(16, 16, 13, 'r'),
    ...parse('W9,9,3,3 W12,12,3,3 W15,15,2,2 W17,17,3,3 W20,20,3,3 W20,9,3,3 W17,12,3,3 W12,17,3,3 W9,20,3,3'),
  ],
  question: () => [
    ...disc(16, 16, 14, 'K'), ...disc(16, 16, 13, 'W'),
    ...parse('n11,8,10,3 n10,9,4,4 n18,9,4,6 n15,14,5,3 n14,16,4,3 n14,22,4,3'),
  ],
  welcome: () => [
    ...disc(16, 12, 10, 'K'), ...disc(16, 12, 9, 'y'),
    ...parse('l11,6,3,5 l13,5,3,1 K12,21,8,1 g13,22,6,2 d13,24,6,2 K12,22,1,5 K19,22,1,5 K13,26,6,1 K15,27,2,2 Y15,13,2,8 Y13,13,6,1'),
  ],
  run: () => parse(
    'K3,6,26,20 g4,7,24,18 n4,7,24,4 W23,8,3,2 K6,13,20,6 W7,14,18,4 K8,15,1,2 g15,21,10,3 W15,21,10,1 d15,23,10,1 d24,21,1,3'),
  shutdown: () => [
    ...disc(16, 17, 12, 'R'), ...disc(16, 17, 11, 'r'), ...disc(16, 17, 7, 'W'),
    ...parse('W12,4,8,9 R14,3,4,13 r15,4,2,11'),
  ],
  settings: () => parse(
    'K4,4,24,24 g5,5,22,22 W5,5,22,1 W5,5,1,22 d26,6,1,21 d6,26,21,1 D10,8,1,16 D16,8,1,16 D22,8,1,16 K8,10,5,4 n9,11,3,2 K14,18,5,4 r15,19,3,2 K20,13,5,4 G21,14,3,2'),
  programs: () => parse(
    'K3,6,10,1 K2,7,1,3 y3,7,10,3 K13,7,1,2 K2,9,28,18 y3,10,26,16 l3,10,26,1 Y3,25,26,1 Y28,11,1,15 K12,13,15,11 W13,14,13,9 n13,14,13,3 d15,19,9,1 d15,21,6,1'),
  datetime: () => [
    ...disc(16, 16, 14, 'K'), ...disc(16, 16, 13, 'g'), ...disc(16, 16, 11, 'W'),
    ...parse('K15,6,2,2 K15,24,2,2 K6,15,2,2 K24,15,2,2 K15,9,2,8 K15,15,7,2 r15,15,2,2'),
  ],
  // ---- 16x16 glyph icons -------------------------------------------------------------
  start: () => [
    ...tri(6, 3, 10, 'm'), ...tri(11, 7, 6, 'M'), ...tri(6, 3, 3, 'W'), ...tri(11, 7, 2, 'W'),
    ...parse('W4,6,2,1 W8,6,1,1 y13,2,2,2 G0,13,16,1'),
  ],
  speaker: () => parse('K2,6,3,4 K5,5,1,6 K6,4,1,8 K7,3,1,10 g3,7,2,2 K9,6,1,4 K11,5,1,1 K12,6,1,4 K11,10,1,1 K13,3,1,1 K14,4,1,8 K13,12,1,1'),
  // paint tools
  'tool-pencil': () => [...diag(11, 1, 5, -2, 2, 3, 3, 'K'), ...diag(12, 2, 4, -2, 2, 1, 1, 'y'), ...parse('y12,2,1,1 K2,12,2,2 Y3,10,2,2')],
  'tool-brush': () => [...diag(12, 1, 4, -2, 2, 2, 2, 'B'), ...parse('g5,8,3,2 g4,9,2,2 K2,10,4,4 K1,12,2,3 D3,11,2,2')],
  'tool-eraser': () => parse('K3,5,9,1 K2,6,1,5 K12,6,1,5 K3,11,9,1 P3,6,9,3 W3,9,9,2 K3,8,9,1'),
  'tool-fill': () => parse('K4,4,6,1 K3,5,1,7 K10,5,1,7 K4,12,6,1 g4,5,6,3 b4,8,6,4 K6,2,1,3 K7,2,2,1 b12,7,1,2 b13,9,2,3 b12,10,1,2'),
  'tool-picker': () => [...parse('K11,1,3,3 K10,3,2,2'), ...diag(9, 4, 4, -1, 1, 2, 2, 'd'), ...parse('W9,5,1,1 W8,6,1,1 W7,7,1,1 K4,10,2,2 K2,12,2,2')],
  'tool-line': () => diag(13, 2, 12, -1, 1, 1, 1, 'K'),
  'tool-rect': () => parse('K2,4,12,1 K2,12,12,1 K2,4,1,9 K13,4,1,9'),
  'tool-ellipse': () => [...disc(8, 8, 6, 'K'), ...disc(8, 8, 5, 'g')],
  muted: () => parse('K2,6,3,4 K5,5,1,6 K6,4,1,8 K7,3,1,10 g3,7,2,2 r9,5,2,2 r11,7,2,2 r13,9,2,2 r13,5,2,2 r9,9,2,2'),
};

const GRID = { start: 16, speaker: 16, muted: 16 };
for (const t of ['pencil', 'brush', 'eraser', 'fill', 'picker', 'line', 'rect', 'ellipse']) GRID['tool-' + t] = 16;
const cache = new Map();

/** SVG markup for an icon at a given CSS pixel size. */
export function iconSvg(name, size = 32) {
  const key = ICONS[name] ? name : 'txt';
  if (!cache.has(key)) {
    let d = '';
    for (const [x, y, w, hh, c] of ICONS[key]()) {
      if (w > 0 && hh > 0) d += `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="${PAL[c] || c}"/>`;
    }
    cache.set(key, d);
  }
  const g = GRID[key] || 32;
  return `<svg class="os-ico" width="${size}" height="${size}" viewBox="0 0 ${g} ${g}" shape-rendering="crispEdges" aria-hidden="true">${cache.get(key)}</svg>`;
}

/** Icon wrapped in a span element. */
export function icon(name, size = 32) {
  const span = document.createElement('span');
  span.className = 'os-icon';
  span.style.width = span.style.height = size + 'px';
  span.innerHTML = iconSvg(name, size);
  return span;
}

/** Larger original logo art (mountain + sun) used on splash / about / banner. */
export function logoSvg(w = 96, hgt = 64) {
  const rects = [
    ...disc(50, 12, 6, 'y'),
    ...tri(22, 8, 24, 'm'), ...tri(42, 16, 16, 'M'), ...tri(22, 8, 7, 'W'), ...tri(42, 16, 4, 'W'),
    ...parse('W17,15,3,1 W23,15,2,1 W27,15,2,2 W40,20,2,1 W44,20,2,1 G0,32,64,2'),
  ];
  let d = '';
  for (const [x, y, ww, hh, c] of rects) d += `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" fill="${PAL[c]}"/>`;
  return `<svg class="os-ico" width="${w}" height="${hgt}" viewBox="0 0 64 36" shape-rendering="crispEdges" aria-hidden="true">${d}</svg>`;
}
