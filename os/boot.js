// Full-screen sequences shown on the overlay layer: POST text, splash, the
// "you can switch off now" screen and the powered-off black screen.

import { h } from './dom.js';
import { logoSvg } from './icons.js';

const POST_LINES = [
  [0, '<b>SummitBIOS v4.51</b>  -  A Friendly Tribute BIOS'],
  [0, 'Copyright (C) 1998, Not A Real BIOS Company'],
  [0, ''],
  [250, 'Main Processor : <b>Pentium II 300MHz</b>'],
  [150, 'Memory Test    : <span data-mem>0</span>K<span data-memok></span>'],
  [1050, ''],
  [80, 'Detecting drives...'],
  [260, '  Primary Master   : <b>SUMMIT ST-4300A  4.3 GB</b>'],
  [220, '  Primary Slave    : None'],
  [220, '  Secondary Master : <b>CD-ROM 24X</b>'],
  [180, '  Secondary Slave  : None'],
  [160, '  Floppy Drive A:  : 1.44 MB  3.5 in.'],
  [200, ''],
  [60, 'Keyboard ... detected      Mouse ... detected'],
  [260, ''],
  [60, 'Starting <b>Summit 98</b>...'],
];

/**
 * Runs POST -> splash inside `overlay`, then calls onDone(). Returns { skip, cancel }.
 * All timers are tracked so power-off can cancel cleanly.
 */
export function runBoot(overlay, onDone) {
  const timers = new Set();
  let finished = false, memTimer = 0;
  const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };

  const post = h('div.os-post');
  const text = h('div');
  post.append(h('div.os-post-logo', { html: logoSvg(96, 54) }), text, h('div.os-post-foot', { text: 'Press any key or click to skip' }));
  overlay.replaceChildren(post);
  overlay.style.display = 'block';

  let at = 300;
  POST_LINES.forEach(([delay, line]) => {
    at += delay;
    later(at, () => {
      text.appendChild(h('div', { html: line || '&nbsp;' }));
      const mem = text.querySelector('[data-mem]');
      if (mem && !memTimer) {
        let k = 0;
        memTimer = setInterval(() => {
          k = Math.min(65536, k + 4096);
          mem.textContent = String(k);
          if (k === 65536) { clearInterval(memTimer); text.querySelector('[data-memok]').textContent = ' OK'; }
        }, 55);
      }
    });
  });
  later(at + 700, splash);

  function splash() {
    clearInterval(memTimer);
    overlay.replaceChildren(h('div.os-splash', null,
      h('div.os-splash-logo', { html: logoSvg(192, 108) }),
      h('div.os-splash-name', { html: 'Summit <i>98</i>' }),
      h('div.os-splash-tag', { text: 'A FRESH VIEW FROM THE TOP' }),
      h('div.os-skip', { text: 'click to skip' }),
      h('div.os-splash-bar')));
    later(2800, finish);
  }

  function stop() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    clearInterval(memTimer);
  }
  function finish() {
    if (finished) return;
    finished = true;
    stop();
    onDone();
  }
  return { skip: finish, cancel() { finished = true; stop(); } };
}

/** Shutdown screen. Calls onDone after a pause or on click. Returns { cancel }. */
export function runHalt(overlay, onDone) {
  let done = false;
  const el = h('div.os-halt', null,
    h('div', { html: logoSvg(128, 72) }),
    h('div.os-halt-msg', { html: 'All packed up.<br>You can switch your computer off now.' }),
    h('div.os-halt-sub', { text: 'Summit 98 has saved your settings and gone to sleep.' }));
  overlay.replaceChildren(el);
  overlay.style.display = 'block';
  const finish = () => { if (done) return; done = true; clearTimeout(id); onDone(); };
  const id = setTimeout(finish, 3500);
  el.addEventListener('pointerdown', e => { e.stopPropagation(); finish(); });
  return { cancel() { done = true; clearTimeout(id); } };
}

/** Powered-off black screen; pointerdown calls onWake. */
export function showOff(overlay, onWake) {
  const el = h('div.os-off', null, h('div.os-off-hint', { text: 'click to power on' }));
  el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); onWake(); });
  overlay.replaceChildren(el);
  overlay.style.display = 'block';
}
