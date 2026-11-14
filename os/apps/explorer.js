// My Computer: icon-view explorer over the fake filesystem.

import { h } from '../dom.js';
import { icon, iconSvg } from '../icons.js';

const UP_GLYPH = '<svg class="os-ico" width="14" height="12" viewBox="0 0 14 12" shape-rendering="crispEdges"><path d="M1 3h5v1H2v7h10v1H1z" fill="#808000"/><path d="M2 4h4v1h6v6H2z" fill="#ffe030"/><path d="M9 0h1v1h1v1h1v1h-2v3H9V3H7V2h1V1h1z" fill="#008000"/></svg>';

function iconFor(sys, node) {
  if (node.kind) return node.kind;                       // drive | floppy | cdrom
  if (node.type === 'dir') return 'folder';
  const e = sys.fs.ext(node.name);
  return e === 'txt' ? 'txt' : e === 'bmp' ? 'bmp' : (e === 'mid' || e === 'wav') ? 'audio' : 'txt';
}

export default {
  id: 'explorer', title: 'My Computer', icon: 'computer',
  /** args: { path: ['C:', 'Music'] } */
  open(sys, args) {
    let path = Array.isArray(args?.path) ? args.path.slice() : [];
    let selected = null, sig = '';

    const addrIcon = h('span.os-exp-addr-icon');
    const addrText = h('span.os-exp-addr', { text: '' });
    const upBtn = h('button.os-btn.small', { type: 'button', 'data-act': 'up', html: UP_GLYPH + '<span>Up</span>' });
    const view = h('div.os-exp-view.os-field');
    const statusL = h('div.grow'), statusR = h('div', { style: { width: '110px' } });

    const labelOf = node => node.label || node.name;

    function openNode(node) {
      if (node.type === 'dir') { path = [...path, node.name]; render(); return; }
      const e = sys.fs.ext(node.name);
      if (e === 'txt') sys.open('notepad', { name: node.name, content: node.content ?? '', path: [...path, node.name] });
      else if (e === 'bmp') sys.open('paint', { picture: node.picture, name: node.name });
      else if (e === 'mid' || e === 'wav') sys.open('player', { track: node.track, play: true });
      else sys.msgBox({ title: node.name, icon: 'info', text: 'Summit 98 does not know how to open this kind of file.' });
    }

    function render() {
      const node = sys.fs.node(path) || sys.fs.node(path = []);
      const kids = sys.fs.list(path).slice().sort((a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1));
      selected = null;
      sig = signature();
      const name = path.length ? labelOf(node) : 'My Computer';
      win.setTitle(name);
      addrIcon.innerHTML = iconSvg(path.length ? iconFor(sys, node) : 'computer', 16);
      addrText.textContent = path.length ? sys.fs.pathString(path) : 'My Computer';
      upBtn.disabled = !path.length;
      view.replaceChildren(...kids.map(k => {
        const el = h('div.os-exp-item', null, icon(iconFor(sys, k), 32), h('span.os-exp-label', { text: labelOf(k) }));
        el.addEventListener('pointerdown', e => {
          if (e.button > 0) return;
          const wasSel = selected === k;
          const dbl = sys.pointer.isDouble(e, el);
          select(k, el);
          if (dbl || (wasSel && e.pointerType !== 'mouse')) openNode(k);
        });
        el.addEventListener('click', () => {});   // tap target
        return el;
      }));
      view.scrollTop = 0;
      statusL.textContent = `${kids.length} object(s)`;
      statusR.textContent = path.length ? (node.readonly || sys.fs.node([path[0]])?.readonly ? 'Read-only' : '') : 'My Computer';
    }

    const signature = () => path.join('\\') + '|' + sys.fs.list(path).map(k => k.name).join('|');

    function select(node, el) {
      selected = node;
      for (const c of view.children) c.classList.toggle('sel', c === el);
      statusL.textContent = node ? labelOf(node) : `${view.children.length} object(s)`;
    }

    const up = () => { if (path.length) { path = path.slice(0, -1); render(); } };

    const win = sys.wm.open({
      appId: 'explorer', title: 'My Computer', icon: 'computer', w: 356, h: 272, minW: 220, minH: 160,
      color: [0.9, 0.9, 0.9], bodyClass: 'os-explorer',
      menu: [
        { label: '&File', items: () => [
          { label: '&Open', disabled: !selected, action: () => selected && openNode(selected) },
          { sep: true },
          { label: '&Close', action: () => win.close() },
        ] },
        { label: '&Go', items: () => [
          { label: '&Up One Level', disabled: !path.length, action: up },
          { label: '&My Computer', action: () => { path = []; render(); } },
          { label: 'My &Documents', action: () => { path = sys.fs.SAVE_DIR.slice(); render(); } },
        ] },
        { label: '&View', items: [
          { label: 'Large &Icons', checked: true },
          { label: '&Details' },
          { sep: true },
          { label: '&Refresh', action: () => render() },
        ] },
        { label: '&Help', items: [{ label: '&About Summit 98', action: () => sys.open('about') }] },
      ],
    });
    upBtn.addEventListener('click', up);
    view.addEventListener('pointerdown', e => { if (e.target === view) select(null, null); });
    win.body.append(
      h('div.os-exp-bar', null, upBtn, h('span', { text: 'Address' }), h('div.os-exp-addrbox.os-field', null, addrIcon, addrText)),
      view,
      h('div.os-status', null, statusL, statusR),
    );
    win.on('focus', () => { if (!win.closed && signature() !== sig) render(); });   // pick up files saved meanwhile
    render();
    return win;
  },
};
