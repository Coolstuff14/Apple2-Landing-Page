// Small widget kit: buttons, checkboxes, sliders, list boxes and modal dialogs.
// Everything is plain DOM inside the OS root (no native popups, no <select>).

import { h, clamp } from './dom.js';
import { icon } from './icons.js';

export function button(label, onClick, opts = {}) {
  const b = h('button.os-btn' + (opts.small ? '.small' : '') + (opts.default ? '.default' : ''), { type: 'button', html: label, disabled: !!opts.disabled });
  if (opts.title) b.setAttribute('aria-label', opts.title);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export function checkbox(label, checked, onChange, type = 'checkbox', name) {
  const input = h('input', { type, checked: !!checked });
  if (name) input.name = name;
  const el = h('label.os-check', null, input, h('span', { html: label }));
  input.addEventListener('change', () => onChange?.(input.checked));
  return { el, input, set(v) { input.checked = !!v; }, get: () => input.checked };
}

/**
 * Custom slider driven by the transform-safe drag helper.
 * opts: { value, min, max, width, thin, onInput(v), onChange(v) }
 */
export function slider(sys, opts = {}) {
  const min = opts.min ?? 0, max = opts.max ?? 1;
  const thumbW = opts.thin ? 9 : 11;
  const thumb = h('div.os-slider-thumb');
  const el = h('div.os-slider' + (opts.thin ? '.thin' : ''), null, h('div.os-slider-track'), thumb);
  if (opts.width) el.style.width = opts.width + 'px';
  let value = clamp(opts.value ?? min, min, max);
  let dragging = false;

  const span = () => Math.max(1, el.clientWidth - thumbW);
  const paint = () => { thumb.style.left = Math.round(((value - min) / (max - min || 1)) * span()) + 'px'; };
  const fromX = x => clamp(min + ((x - thumbW / 2) / span()) * (max - min), min, max);

  el.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target !== el) return;
    e.preventDefault();
    const x0 = e.offsetX;
    dragging = true;
    value = fromX(x0); paint(); opts.onInput?.(value);
    sys.pointer.drag(e, {
      onMove: (x, y, dx) => { value = fromX(x0 + dx); paint(); opts.onInput?.(value); },
      onEnd: () => { dragging = false; opts.onChange?.(value); },
    });
  });
  // layout may not exist yet when created; paint again once attached
  queueMicrotask(paint);
  return {
    el,
    get: () => value,
    set(v) { if (dragging) return; value = clamp(v, min, max); paint(); },
    refresh: paint,
    isDragging: () => dragging,
  };
}

/** Single-select list box. rows: [{ label, icon?, value }] */
export function listBox(sys, opts = {}) {
  const el = h('div.os-list', { tabindex: 0 });
  let rows = [], sel = -1;
  function render() {
    el.replaceChildren(...rows.map((r, i) => {
      const row = h('div.os-list-row' + (i === sel ? '.sel' : ''), null, r.icon ? icon(r.icon, 16) : null, h('span', { text: r.label, style: { pointerEvents: 'none' } }));
      row.addEventListener('pointerdown', e => {
        const dbl = sys.pointer.isDouble(e, row) && i === sel;
        select(i);
        if (dbl) opts.onOpen?.(rows[i], i);
      });
      return row;
    }));
  }
  /** scroll the list (only the list: never an ancestor) so the selected row is in view */
  function reveal() {
    const c = el.children[sel], first = el.children[0]; if (!c || !first) return;
    const top = c.offsetTop - first.offsetTop, bottom = top + c.offsetHeight;
    if (top < el.scrollTop) el.scrollTop = top; else if (bottom > el.scrollTop + el.clientHeight - 4) el.scrollTop = bottom - el.clientHeight + 4;
  }
  function select(i, silent) {
    sel = i;
    [...el.children].forEach((c, j) => c.classList.toggle('sel', j === sel));
    reveal();
    if (!silent) opts.onSelect?.(rows[i], i);
  }
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) select(clamp(sel + (e.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1));
    } else if (e.key === 'Enter' && sel >= 0) { e.stopPropagation(); opts.onOpen?.(rows[sel], sel); }
  });
  return {
    el,
    setRows(r, keep) { rows = r; if (!keep) sel = -1; render(); },
    select: (i, silent) => select(i, silent),
    reveal,
    selected: () => (sel >= 0 ? rows[sel] : null),
    index: () => sel,
  };
}

/**
 * Generic modal dialog window. `build(win, done)` fills win.body; call done(value) to
 * close. Resolves with the value (null when dismissed with Esc / close button).
 */
export function dialog(sys, spec, build) {
  return new Promise(resolve => {
    let result = null, settled = false;
    const win = sys.wm.open({
      appId: spec.appId, title: spec.title || 'Summit 98', icon: spec.icon || 'about', w: spec.w || 300, h: spec.h || 130,
      resizable: false, minimizable: false, taskbar: false, modal: spec.modal !== false, center: true,
      bodyClass: 'os-dialog', dialog: true, silent: spec.silent,
    });
    const done = value => { result = value; win.close(true); };
    win.on('close', () => { if (!settled) { settled = true; resolve(result); } });
    win.el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      const def = win.body.querySelector('.os-btn.default:not(:disabled)');
      if (def) { e.preventDefault(); e.stopPropagation(); def.click(); }
    });
    build(win, done);
    if (spec.fit !== false) win.fit();
    const first = win.body.querySelector('[data-autofocus]') || win.body.querySelector('.os-btn.default');
    if (first) { win.focusEl = first; first.focus({ preventScroll: true }); }
  });
}

/** Message box. opts: { title, text, icon: info|warn|error|question, buttons: ['OK'] } */
export function msgBox(sys, opts) {
  const buttons = opts.buttons || ['OK'];
  if (opts.icon === 'error' || opts.icon === 'warn') sys.sfx('ding');
  return dialog(sys, { title: opts.title, icon: opts.winIcon || 'about', w: opts.w || 290 }, (win, done) => {
    win.body.append(
      h('div.os-dialog-row', null, icon(opts.icon || 'info', 32), h('div.os-dialog-text', { text: opts.text })),
      h('div.os-dialog-btns', null, buttons.map((b, i) => button(b, () => done(b), { default: i === 0 }))),
    );
  });
}
