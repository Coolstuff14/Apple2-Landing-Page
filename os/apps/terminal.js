// jakelee.info — a green-phosphor text-mode front page with a keyboard menu and a
// tiny command prompt. All section copy is deliberately placeholder text.

import { h, esc } from '../dom.js';
import { formatClock } from '../shell.js';

// 5x7 pixel glyphs for the banner (drawn as SVG "phosphor pixels").
const GLYPHS = {
  j: ['..#', '...', '..#', '..#', '..#', '#.#', '.#.'],
  a: ['....', '....', '.##.', '...#', '.###', '#..#', '.###'],
  k: ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'],
  e: ['....', '....', '.##.', '#..#', '####', '#...', '.###'],
  l: ['#.', '#.', '#.', '#.', '#.', '#.', '.#'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  i: ['#', '.', '#', '#', '#', '#', '#'],
  n: ['....', '....', '###.', '#..#', '#..#', '#..#', '#..#'],
  f: ['.##', '#..', '###', '#..', '#..', '#..', '#..'],
  o: ['....', '....', '.##.', '#..#', '#..#', '#..#', '.##.'],
};

function bannerSvg(text, px) {
  let x = 0, rects = '';
  for (const ch of text) {
    const gl = GLYPHS[ch];
    if (!gl) { x += 3; continue; }
    gl.forEach((row, y) => {
      [...row].forEach((c, i) => { if (c === '#') rects += `<rect x="${(x + i) * px}" y="${y * px}" width="${px - 1}" height="${px - 1}"/>`; });
    });
    x += gl[0].length + 1;
  }
  const w = (x - 1) * px, hgt = 7 * px;
  return `<svg class="os-ico" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" shape-rendering="crispEdges" role="img" aria-label="${esc(text)}">${rects}</svg>`;
}

const SECTIONS = ['home', 'projects', 'travel', 'notes', 'contact'];

// Every page is placeholder copy on purpose: the real content is not known here.
const PAGES = {
  home: [
    '<b>HOME</b>',
    '',
    '<i>[placeholder — a short welcome goes here]</i>',
    '',
    'This is the text-mode front page of jakelee.info.',
    'Pick a section from the menu, or type <b>help</b>.',
  ],
  projects: [
    '<b>PROJECTS</b>',
    '',
    '<i>[placeholder — add your projects here]</i>',
    '',
    '  01  [project name] ........ [one-line description]',
    '  02  [project name] ........ [one-line description]',
    '  03  [project name] ........ [one-line description]',
  ],
  travel: [
    '<b>TRAVEL</b>',
    '',
    '<i>[placeholder — add your travel log here]</i>',
    '',
    '  [where]            [when]      [a few words]',
    '  ----------------   ---------   ------------------',
    '  [place]            [year]      [note]',
    '  [place]            [year]      [note]',
  ],
  notes: [
    '<b>NOTES</b>',
    '',
    '<i>[placeholder — add your notes here]</i>',
    '',
    '  * [note title] ............ [date]',
    '  * [note title] ............ [date]',
  ],
  contact: [
    '<b>CONTACT</b>',
    '',
    '<i>[placeholder — contact details go here]</i>',
    '',
    'No contact details have been added yet.',
  ],
};

const HELP = [
  '<b>COMMANDS</b>',
  '',
  '  help              this list',
  '  ls                list sections',
  '  cd &lt;section&gt;      open a section (or: open &lt;name&gt;)',
  '  cd ..             back to the menu',
  '  clear             clear the screen',
  '  date              current date and time',
  '  whoami            who is logged in',
  '  exit              close this window',
  '',
  'Keys: Up/Down + Enter work in the menu.',
];

export default {
  id: 'terminal', title: 'jakelee.info', icon: 'terminal', single: true,
  open(sys) {
    let mode = 'menu';          // 'menu' | 'page' | 'log'
    let sel = 0;
    let log = [];
    const history = [];
    let hIdx = -1;

    const clock = h('span.os-term-clock');
    const body = h('div.os-term-body');
    const input = h('input.os-term-input', { type: 'text', spellcheck: false, autocomplete: 'off', autocapitalize: 'off', maxLength: 48, 'aria-label': 'command' });
    const hint = h('div.os-term-hint');
    const term = h('div.os-term', null,
      h('div.os-term-status', null, h('span', { text: 'jakelee.info' }), h('span.os-term-fill'), h('span', { text: 'text mode' }), h('span.os-term-fill.short'), clock),
      h('div.os-term-banner', { html: bannerSvg('jakelee.info', 8) }),
      h('div.os-term-rule'),
      body,
      hint,
      h('div.os-term-prompt', null, h('span', { text: '>' }), input),
      h('div.os-term-scan'));

    const lines = arr => arr.map(l => `<div>${l || '&nbsp;'}</div>`).join('');

    function render() {
      if (mode === 'menu') {
        body.replaceChildren(...SECTIONS.map((s, i) => {
          const row = h('div.os-term-menu-row' + (i === sel ? '.sel' : ''), { 'data-section': s }, h('span.os-term-cur', { text: i === sel ? '>' : ' ' }), h('span', { text: s }));
          row.addEventListener('click', () => { sel = i; show(s); });
          row.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && sel !== i) { sel = i; render(); } });
          return row;
        }));
        hint.textContent = 'up/down: select    enter: open    or type a command';
      } else if (mode === 'page') {
        body.innerHTML = lines(PAGES[SECTIONS[sel]]);
        hint.textContent = "backspace: menu    type 'help' for commands";
      } else {
        body.innerHTML = lines(log);
        body.scrollTop = body.scrollHeight;
        hint.textContent = "type 'clear' to return to the menu";
      }
    }

    function show(section) { sel = SECTIONS.indexOf(section); mode = 'page'; render(); sys.sfx('menu'); }
    function menu() { mode = 'menu'; log = []; render(); }
    function print(...out) {
      if (mode !== 'log') { mode = 'log'; log = []; }
      log.push(...out);
      if (log.length > 60) log = log.slice(-60);
      render();
    }

    function exec(raw) {
      const cmd = raw.trim();
      if (!cmd) return;
      history.push(cmd); hIdx = -1;
      const [name, ...rest] = cmd.toLowerCase().split(/\s+/);
      const arg = (rest[0] || '').replace(/\/$/, '');
      const echo = `<span class="dim">&gt; ${esc(cmd)}</span>`;
      switch (name) {
        case 'help': case '?': print(echo, ...HELP, ''); break;
        case 'ls': case 'dir': print(echo, SECTIONS.map(s => s + '/').join('   '), ''); break;
        case 'cd': case 'open':
          if (!arg || arg === '..' || arg === '/' || arg === '~' || arg === 'menu') menu();
          else if (SECTIONS.includes(arg)) show(arg);
          else print(echo, `no such section: ${esc(arg)}`, `try: ${SECTIONS.join(', ')}`, '');
          break;
        case 'clear': case 'cls': case 'menu': menu(); break;
        case 'date': print(echo, esc(new Date().toString()), ''); break;
        case 'whoami': print(echo, 'guest', '<i>[placeholder — an "about me" line goes here]</i>', ''); break;
        case 'exit': case 'quit': case 'logout': win.close(); break;
        default:
          if (SECTIONS.includes(name)) show(name);
          else print(echo, `command not found: ${esc(name)}`, "type 'help' for a list of commands", '');
      }
    }

    const win = sys.wm.open({
      appId: 'terminal', title: 'jakelee.info', icon: 'terminal', w: 448, h: 388, resizable: false,
      color: [0.02, 0.1, 0.04], bodyClass: 'os-term-wrap',
    });
    win.body.appendChild(term);
    win.focusEl = input;

    input.addEventListener('keydown', e => {
      const empty = input.value === '';
      if (e.key === 'Enter') {
        e.preventDefault();
        if (empty && mode === 'menu') show(SECTIONS[sel]);
        else { const v = input.value; input.value = ''; exec(v); }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        if (mode === 'menu' && empty) { sel = (sel + d + SECTIONS.length) % SECTIONS.length; render(); }
        else if (mode === 'page' && empty) { sel = (sel + d + SECTIONS.length) % SECTIONS.length; render(); }
        else if (history.length) {
          hIdx = hIdx < 0 ? history.length - 1 : Math.max(0, Math.min(history.length - 1, hIdx + d));
          input.value = history[hIdx];
        }
      } else if (e.key === 'Backspace' && empty && mode !== 'menu') {
        e.preventDefault();
        menu();
      }
      // Escape is intentionally not handled: it bubbles to the host.
    });
    // clicking anywhere in the terminal keeps the caret in the prompt
    term.addEventListener('mousedown', e => { if (e.target !== input) { e.preventDefault(); input.focus({ preventScroll: true }); } });

    const tick = () => { clock.textContent = formatClock(new Date()); };
    tick();
    win.every(1000, tick).start();
    render();
    input.focus({ preventScroll: true });
    return win;
  },
};
