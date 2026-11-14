// Window manager: creation, focus/z-order, drag, resize, minimize/maximize, modal
// blockers and per-window animation loops that pause while a window is hidden.

import { h, clamp, emitter } from './dom.js';
import { iconSvg } from './icons.js';

export const SCREEN_W = 640, SCREEN_H = 480, TASKBAR_H = 28, WORK_H = SCREEN_H - TASKBAR_H;

const GLYPH = {
  min: '<svg class="os-ico" width="8" height="7" viewBox="0 0 8 7"><rect x="0" y="5" width="6" height="2"/></svg>',
  max: '<svg class="os-ico" width="9" height="8" viewBox="0 0 9 8"><path d="M0 0h9v8H0zM1 2v5h7V2z" fill-rule="evenodd"/></svg>',
  restore: '<svg class="os-ico" width="9" height="8" viewBox="0 0 9 8"><path d="M2 0h7v6H7V5h1V2H3v1H2zM0 3h7v5H0zM1 5v2h5V5z" fill-rule="evenodd"/></svg>',
  close: '<svg class="os-ico" width="8" height="7" viewBox="0 0 8 7"><path d="M0 0h2l2 2 2-2h2L5 3.5 8 7H6L4 5 2 7H0l3-3.5z"/></svg>',
};

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export function createWM({ layer, pointer, menus, sfx }) {
  const wins = [];           // z-order, last = top
  const order = [];          // creation order (taskbar)
  const events = emitter();
  let active = null, seq = 0, cascade = 0;

  const changed = type => events.emit('change', type);

  function restack() {
    wins.forEach((w, i) => {
      w.el.style.zIndex = 10 + i * 2;
      if (w.blocker) w.blocker.style.zIndex = 9 + i * 2;
    });
  }

  function setActive(win) {
    if (active === win) return;
    const prev = active;
    active = win;
    if (prev) { prev.el.classList.remove('active'); prev.events.emit('blur'); }
    if (win) { win.el.classList.add('active'); win.events.emit('focus'); }
    changed('focus');
  }

  function topVisible(except) {
    for (let i = wins.length - 1; i >= 0; i--) if (!wins[i].minimized && wins[i] !== except) return wins[i];
    return null;
  }

  function applyRect(win) {
    const s = win.el.style;
    if (win.maximized) { s.left = '0px'; s.top = '0px'; s.width = SCREEN_W + 'px'; s.height = WORK_H + 'px'; }
    else { s.left = win.x + 'px'; s.top = win.y + 'px'; s.width = win.w + 'px'; s.height = win.h + 'px'; }
  }

  function clampPos(win) {
    win.x = Math.round(clamp(win.x, 48 - win.w, SCREEN_W - 40));
    win.y = Math.round(clamp(win.y, 0, WORK_H - 20));
  }

  function open(spec) {
    const win = {
      id: ++seq, appId: spec.appId || null, spec,
      title: spec.title || '', icon: spec.icon || 'about',
      w: spec.w || 320, h: spec.h || 220,
      minW: spec.minW || 140, minH: spec.minH || 80,
      resizable: spec.resizable !== false, taskbar: spec.taskbar !== false,
      minimized: false, maximized: false, closed: false,
      color: spec.color || [0.76, 0.76, 0.76],
      events: emitter(), loops: new Set(), focusEl: null, blocker: null, beforeClose: spec.beforeClose || null,
    };
    win.w = Math.min(win.w, SCREEN_W); win.h = Math.min(win.h, WORK_H);
    if (spec.center || spec.modal) {
      win.x = Math.round((SCREEN_W - win.w) / 2); win.y = Math.round((WORK_H - win.h) / 2.4);
    } else if (spec.x != null) {
      win.x = spec.x; win.y = spec.y ?? 20;
    } else {
      const step = cascade++ % 7;
      win.x = 84 + step * 22; win.y = 10 + step * 20;
      if (win.x + win.w > SCREEN_W) win.x = Math.max(0, SCREEN_W - win.w);
      if (win.y + win.h > WORK_H) win.y = Math.max(0, WORK_H - win.h);
    }

    const canMax = win.resizable && spec.maximizable !== false;
    const canMin = spec.minimizable !== false && !spec.modal && win.taskbar;
    const btn = (name, enabled) => h('button.os-tb-btn.os-tb-' + name, { type: 'button', html: GLYPH[name], disabled: !enabled, tabIndex: -1, 'aria-label': name });
    win.btnMin = canMin || canMax ? btn('min', canMin) : null;
    win.btnMax = canMin || canMax ? btn('max', canMax) : null;
    win.btnClose = btn('close', true);
    win.titleText = h('span.os-title-text', { text: win.title });
    win.titleIcon = h('span.os-title-icon', { html: iconSvg(win.icon, 16) });
    win.titleEl = h('div.os-title', null, win.titleIcon, win.titleText,
      h('span.os-title-btns', null, win.btnMin, win.btnMax, win.btnClose));
    win.menubarEl = spec.menu ? h('div.os-menubar') : null;
    win.body = h('div.os-win-body' + (spec.bodyClass ? '.' + spec.bodyClass : ''));
    win.el = h('div.os-win' + (spec.className ? '.' + spec.className : ''), { tabindex: -1, 'data-app': win.appId || '', 'data-win': win.id },
      win.titleEl, win.menubarEl, win.body);
    if (spec.menu) menus.menubar(win.menubarEl, spec.menu);
    if (win.resizable) for (const edge of EDGES) win.el.appendChild(h('div.os-rs.os-rs-' + edge, { 'data-edge': edge }));
    if (spec.modal) {
      win.blocker = h('div.os-modal-blocker');
      win.blocker.addEventListener('pointerdown', e => { e.preventDefault(); sfx('ding'); focus(win); });
      layer.appendChild(win.blocker);
    }

    // ---- behaviour -------------------------------------------------------------
    win.el.addEventListener('pointerdown', () => focus(win), true);
    win.titleEl.addEventListener('pointerdown', e => {
      if (e.button > 0 || e.target.closest('.os-tb-btn')) return;
      if (pointer.isDouble(e, win.titleEl)) { if (canMax) toggleMax(win); return; }
      if (win.maximized) return;
      const ox = win.x, oy = win.y;
      pointer.drag(e, {
        onMove: (x, y, dx, dy) => { win.x = ox + dx; win.y = oy + dy; clampPos(win); applyRect(win); },
        onEnd: () => changed('move'),
      });
    });
    // keep keyboard focus where it is when the frame is clicked
    win.titleEl.addEventListener('mousedown', e => e.preventDefault());
    win.btnClose.addEventListener('click', () => close(win));
    win.btnMin?.addEventListener('click', () => minimize(win));
    win.btnMax?.addEventListener('click', () => toggleMax(win));
    win.el.addEventListener('pointerdown', e => {
      const edge = e.target.dataset?.edge;
      if (!edge || e.button > 0 || win.maximized) return;
      e.preventDefault();
      const r = { x: win.x, y: win.y, w: win.w, h: win.h };
      pointer.drag(e, {
        cursor: getComputedStyle(e.target).cursor,
        onMove: (x, y, dx, dy) => {
          if (edge.includes('e')) win.w = Math.max(win.minW, r.w + dx);
          if (edge.includes('s')) win.h = Math.max(win.minH, r.h + dy);
          if (edge.includes('w')) { win.w = Math.max(win.minW, r.w - dx); win.x = r.x + r.w - win.w; }
          if (edge.includes('n')) {
            const top = clamp(r.y + dy, 0, r.y + r.h - win.minH);
            win.h = r.y + r.h - top; win.y = top;
          }
          win.w = Math.round(win.w); win.h = Math.round(win.h); win.x = Math.round(win.x); win.y = Math.round(win.y);
          applyRect(win);
          win.events.emit('resize');
        },
        onEnd: () => changed('resize'),
      });
    });

    // ---- public window API -----------------------------------------------------
    win.on = (evt, cb) => win.events.on(evt, cb);
    win.setTitle = t => { win.title = t; win.titleText.textContent = t; changed('title'); };
    win.close = force => close(win, force);
    win.minimize = () => minimize(win);
    win.restore = () => focus(win);
    win.focus = () => focus(win);
    win.toggleMax = () => toggleMax(win);
    win.isActive = () => active === win;
    win.setColor = c => { win.color = c; changed('color'); };
    /** Shrink-wrap the window height around its content (dialogs). */
    win.fit = () => {
      win.el.style.height = 'auto';
      win.h = Math.min(WORK_H, win.el.offsetHeight);
      if (spec.center || spec.modal) win.y = Math.round((WORK_H - win.h) / 2.4);
      applyRect(win);
    };
    /** requestAnimationFrame loop bound to the window: paused while minimized, stopped on close. */
    win.loop = fn => {
      const L = {
        want: false, on: false, id: 0, last: 0,
        start() { L.want = true; if (!L.on && !win.minimized && !win.closed) { L.on = true; L.last = 0; L.id = requestAnimationFrame(step); } },
        stop() { L.want = false; L.halt(); },
        halt() { L.on = false; cancelAnimationFrame(L.id); },
        get running() { return L.on; },
      };
      function step(t) {
        if (!L.on) return;
        const dt = L.last ? Math.min(0.05, (t - L.last) / 1000) : 1 / 60;
        L.last = t;
        L.id = requestAnimationFrame(step);
        fn(dt, t);
      }
      win.loops.add(L);
      return L;
    };
    /** setInterval bound to the window (same pause rules as loop()). */
    win.every = (ms, fn) => {
      const L = {
        want: false, on: false, id: 0,
        start() { L.want = true; if (!L.on && !win.minimized && !win.closed) { L.on = true; L.id = setInterval(fn, ms); } },
        stop() { L.want = false; L.halt(); },
        halt() { L.on = false; clearInterval(L.id); },
        get running() { return L.on; },
      };
      win.loops.add(L);
      return L;
    };

    wins.push(win); order.push(win);
    layer.appendChild(win.el);
    clampPos(win);
    applyRect(win);
    restack();
    if (spec.maximized && canMax) { win.maximized = true; win.el.classList.add('max'); win.btnMax.innerHTML = GLYPH.restore; applyRect(win); }
    changed('open');
    focus(win);
    if (!spec.silent) sfx('open');
    return win;
  }

  function focus(win) {
    if (!win || win.closed) return;
    // a modal dialog keeps everything opened before it out of reach
    const modal = wins.findLast(w => w.blocker && !w.closed);
    if (modal && win !== modal && wins.indexOf(win) < wins.indexOf(modal)) { sfx('ding'); win = modal; }
    if (win.minimized) {
      win.minimized = false;
      win.el.style.display = '';
      for (const L of win.loops) if (L.want) L.start();
      win.events.emit('restore');
      changed('restore');
    }
    const i = wins.indexOf(win);
    if (i !== wins.length - 1) { wins.splice(i, 1); wins.push(win); restack(); }
    const was = active;
    setActive(win);
    const doc = win.el.ownerDocument;
    if (was !== win || !win.el.contains(doc.activeElement)) {
      const target = win.focusEl && win.focusEl.isConnected ? win.focusEl : win.el;
      target.focus({ preventScroll: true });
    }
  }

  function minimize(win) {
    if (win.minimized || win.closed) return;
    win.minimized = true;
    win.el.style.display = 'none';
    for (const L of win.loops) L.halt();
    win.events.emit('minimize');
    sfx('min');
    if (active === win) {
      setActive(null);
      const next = topVisible(win);
      if (next) focus(next);
    }
    changed('minimize');
  }

  function toggleMax(win) {
    if (win.closed || !win.btnMax || win.btnMax.disabled) return;
    win.maximized = !win.maximized;
    win.el.classList.toggle('max', win.maximized);
    win.btnMax.innerHTML = win.maximized ? GLYPH.restore : GLYPH.max;
    applyRect(win);
    sfx('max');
    win.events.emit('resize');
    changed('resize');
  }

  function close(win, force) {
    if (win.closed) return true;
    if (!force && win.beforeClose && win.beforeClose(win) === false) return false;
    win.closed = true;
    for (const L of win.loops) L.stop();
    win.loops.clear();
    win.events.emit('close', !!force);
    win.el.remove();
    win.blocker?.remove();
    wins.splice(wins.indexOf(win), 1);
    order.splice(order.indexOf(win), 1);
    if (!wins.length) cascade = 0;
    if (active === win) {
      active = null;
      const next = topVisible();
      if (next) focus(next); else changed('focus');
    }
    if (!force) sfx('close');
    changed('close');
    return true;
  }

  return {
    open, focus, minimize, close, toggleMax,
    on: (evt, cb) => events.on(evt, cb),
    list: () => order.slice(),
    stack: () => wins.slice(),
    active: () => active,
    find: appId => order.find(w => w.appId === appId) || null,
    blur() { setActive(null); },
    /** Taskbar button behaviour: focus, or minimize if already active. */
    toggle(win) { if (active === win && !win.minimized) minimize(win); else focus(win); },
    closeAll() { for (const w of order.slice()) close(w, true); cascade = 0; },
  };
}
