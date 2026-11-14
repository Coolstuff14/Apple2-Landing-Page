// Pointer coordinate handling.
//
// The OS root lives under arbitrary CSS transforms (scale, matrix3d), so client
// coordinates and bounding rects are meaningless here. Everything is expressed in
// logical OS pixels (0..640 x 0..480) and derived ONLY from:
//   - event.offsetX / offsetY  (local, untransformed coordinates of the target), and
//   - layout offsets (offsetLeft/Top), which ignore ancestor transforms.
//
// During a drag a full-size transparent capture layer is raised inside the screen;
// its offsetX/offsetY ARE the logical pointer position.

import { h } from './dom.js';

export function createPointer(screen) {
  const layer = h('div.os-capture');
  screen.appendChild(layer);
  let active = null;

  /** Layout offset of `node`'s border box inside the screen element (logical px). */
  function offsetOf(node) {
    let x = 0, y = 0, n = node;
    while (n && n !== screen) {
      x += n.offsetLeft; y += n.offsetTop;
      const op = n.offsetParent;
      // scroll of every container between the node and its offsetParent (inclusive)
      let p = n.parentNode;
      while (p && p !== screen && p.nodeType === 1) {
        x -= p.scrollLeft; y -= p.scrollTop;
        if (p === op) break;
        p = p.parentNode;
      }
      if (!op || op === screen) break;
      x += op.clientLeft; y += op.clientTop;
      n = op;
    }
    return { x, y };
  }

  /** Logical position of a pointer event anywhere inside the screen. */
  function point(e) {
    const t = e.target;
    if (t === layer || t === screen) return { x: e.offsetX, y: e.offsetY };
    const o = offsetOf(t);
    return { x: o.x + t.clientLeft + e.offsetX, y: o.y + t.clientTop + e.offsetY };
  }

  function end(cancelled) {
    if (!active) return;
    const a = active;
    active = null;
    layer.style.display = 'none';
    layer.style.cursor = '';
    a.h.onEnd?.(a.last.x, a.last.y, a.last.x - a.start.x, a.last.y - a.start.y, !!cancelled);
  }

  /**
   * Begin a drag from a pointerdown event. Handlers receive logical coordinates:
   *   onMove(x, y, dx, dy, event)   onEnd(x, y, dx, dy, cancelled)
   * Returns the logical start point.
   */
  function drag(e, handlers) {
    if (active) end(true);
    // Touch pointers are implicitly captured by the pointerdown target; release so
    // that subsequent moves hit-test onto the capture layer.
    try { if (e.target.hasPointerCapture?.(e.pointerId)) e.target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const start = point(e);
    active = { id: e.pointerId, mouse: e.pointerType === 'mouse', h: handlers, start, last: start };
    layer.style.cursor = handlers.cursor || 'default';
    layer.style.display = 'block';
    return start;
  }

  layer.addEventListener('pointermove', ev => {
    if (!active || ev.pointerId !== active.id) return;
    if (active.mouse && ev.buttons === 0) { end(false); return; }   // button released off-screen
    const x = ev.offsetX, y = ev.offsetY;
    active.last = { x, y };
    active.h.onMove?.(x, y, x - active.start.x, y - active.start.y, ev);
  });
  layer.addEventListener('contextmenu', ev => ev.preventDefault());

  const onUp = ev => { if (active && ev.pointerId === active.id) end(ev.type === 'pointercancel'); };
  const view = screen.ownerDocument.defaultView;
  view.addEventListener('pointerup', onUp, true);
  view.addEventListener('pointercancel', onUp, true);

  /**
   * Double-activation detector based on pointerdown timestamps (native dblclick is
   * unreliable once a capture layer appears between down and up).
   */
  let lastKey = null, lastTime = 0, lastPt = { x: 0, y: 0 };
  function isDouble(e, key) {
    const now = e.timeStamp || performance.now();
    const pt = point(e);
    const dbl = key === lastKey && now - lastTime < 450 && Math.abs(pt.x - lastPt.x) < 6 && Math.abs(pt.y - lastPt.y) < 6;
    lastKey = dbl ? null : key;
    lastTime = now;
    lastPt = pt;
    return dbl;
  }

  return {
    point, offsetOf, drag, isDouble,
    cancel: () => end(true),
    dragging: () => !!active,
    destroy() {
      end(true);
      view.removeEventListener('pointerup', onUp, true);
      view.removeEventListener('pointercancel', onUp, true);
      layer.remove();
    },
  };
}
