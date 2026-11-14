// Tiny DOM helpers shared by every module. No globals, no document.body access.

/**
 * h('div.cls1.cls2', {attrs}, ...children) -> HTMLElement
 * attrs: html, text, style (object), on<event>, dataset-ish attributes, DOM props.
 */
export function h(tag, attrs, ...kids) {
  const parts = tag.split('.');
  const el = document.createElement(parts[0] || 'div');
  if (parts.length > 1) el.className = parts.slice(1).join(' ');
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k.startsWith('data-') || k === 'for' || k === 'tabindex' || k === 'role') el.setAttribute(k, v === true ? '' : v);
      else if (k in el) { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) add(el, kid);
    else el.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** "&File" -> "<u>F</u>ile" (escaped). */
export function accel(label) {
  const i = label.indexOf('&');
  if (i < 0 || i === label.length - 1) return esc(label);
  return esc(label.slice(0, i)) + '<u>' + esc(label[i + 1]) + '</u>' + esc(label.slice(i + 2));
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** localStorage wrapper that never throws. */
export const store = {
  get(key, fallback) {
    try {
      const raw = globalThis.localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { globalThis.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
};

/** Minimal event emitter. */
export function emitter() {
  const map = new Map();
  return {
    on(evt, cb) {
      if (typeof cb !== 'function') return () => {};
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(cb);
      return () => map.get(evt)?.delete(cb);
    },
    emit(evt, ...args) {
      const set = map.get(evt);
      if (!set) return;
      for (const cb of [...set]) { try { cb(...args); } catch (err) { console.warn('[os98] listener failed', err); } }
    },
  };
}
