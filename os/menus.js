// Popup menus (menu bars, cascading submenus, Start menu). Every menu element is
// appended to the in-root menu layer and positioned in logical pixels.

import { h, accel, clamp } from './dom.js';
import { iconSvg } from './icons.js';

export function createMenus({ screen, layer, pointer, sfx }) {
  const stack = [];          // open menu elements, index = nesting level
  let rootClose = null;

  const val = v => (typeof v === 'function' ? v() : v);

  function build(items, level, opts) {
    const el = h('div.os-menu' + (opts.className ? '.' + opts.className : ''), { 'data-level': level });
    el.addEventListener('mousedown', e => e.preventDefault());       // keep text focus where it is
    el.addEventListener('contextmenu', e => e.preventDefault());
    if (opts.banner) el.appendChild(h('div.os-menu-banner', { html: opts.banner }));
    for (const it of val(items)) {
      if (it.sep) { el.appendChild(h('div.os-menu-sep')); continue; }
      const disabled = !!val(it.disabled) || (!it.action && !it.items);
      const row = h('div.os-menu-item' + (disabled ? '.disabled' : ''), null,
        h('span.os-mi-mark', { html: it.icon ? iconSvg(it.icon, opts.large ? 24 : 16) : (val(it.checked) ? '&#10003;' : '') }),
        h('span.os-mi-label', { html: accel(it.label) }),
        it.hint ? h('span.os-mi-hint', { text: it.hint }) : null,
        it.items ? h('span.os-mi-arrow') : null);
      row.addEventListener('pointerenter', () => {
        for (const r of el.querySelectorAll('.os-menu-item.hot')) r.classList.remove('hot');
        row.classList.add('hot');
        closeFrom(level + 1);
        if (it.items && !disabled) openSub(row, it.items, level + 1);
      });
      row.addEventListener('click', () => {
        if (disabled) return;
        if (it.items) { if (!stack[level + 1]) openSub(row, it.items, level + 1); return; }
        closeAll();
        sfx('menu');
        it.action();
      });
      el.appendChild(row);
    }
    return el;
  }

  function place(el, x, y, opts) {
    layer.appendChild(el);
    const w = el.offsetWidth, hgt = el.offsetHeight;
    if (opts.up) y -= hgt;
    if (opts.flipX != null && x + w > screen.clientWidth) x = opts.flipX - w;
    el.style.left = clamp(x, 0, Math.max(0, screen.clientWidth - w)) + 'px';
    el.style.top = clamp(y, 0, Math.max(0, screen.clientHeight - hgt)) + 'px';
  }

  function openSub(row, items, level) {
    const parent = stack[level - 1];
    const el = build(items, level, {});
    stack[level] = el;
    place(el, parent.offsetLeft + parent.offsetWidth - 3, parent.offsetTop + row.offsetTop - 3, { flipX: parent.offsetLeft + 3 });
  }

  function closeFrom(level) {
    while (stack.length > level) stack.pop().remove();
  }

  function closeAll() {
    if (!stack.length) return false;
    closeFrom(0);
    const cb = rootClose;
    rootClose = null;
    cb?.();
    return true;
  }

  /** Open a root popup at logical (x, y). opts: { up, className, banner, large, onClose } */
  function popup(items, x, y, opts = {}) {
    closeAll();
    const doc = screen.ownerDocument;
    if (!screen.contains(doc.activeElement)) screen.focus({ preventScroll: true });
    const el = build(items, 0, opts);
    stack[0] = el;
    rootClose = opts.onClose || null;
    place(el, x, y, opts);
    return el;
  }

  const onDown = e => {
    if (!stack.length) return;
    if (e.target.closest?.('.os-menu, [data-menu-owner]')) return;
    closeAll();
  };
  screen.addEventListener('pointerdown', onDown, true);

  /** Wire a menu bar element. spec: [{ label:'&File', items:[...] | () => [...] }] */
  function menubar(bar, spec) {
    let openIdx = -1;
    const labels = spec.map((m, i) => {
      const lab = h('div.os-mb-item', { html: accel(m.label), 'data-menu-owner': '' });
      const show = () => {
        const o = pointer.offsetOf(lab);
        popup(m.items, o.x, o.y + lab.offsetHeight, {
          onClose: () => { openIdx = -1; lab.classList.remove('open'); },
        });
        openIdx = i;
        lab.classList.add('open');
      };
      lab.addEventListener('mousedown', e => e.preventDefault());
      lab.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        if (openIdx === i) closeAll(); else show();
      });
      lab.addEventListener('pointerenter', () => { if (openIdx >= 0 && openIdx !== i) show(); });
      bar.appendChild(lab);
      return lab;
    });
    return labels;
  }

  return {
    popup, menubar, closeAll,
    isOpen: () => stack.length > 0,
    destroy() { closeAll(); screen.removeEventListener('pointerdown', onDown, true); },
  };
}
