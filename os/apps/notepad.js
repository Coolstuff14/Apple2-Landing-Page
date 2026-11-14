// Notepad: a real <textarea> with New/Open/Save into the fake filesystem.

import { h } from '../dom.js';
import { button, listBox, dialog } from '../ui.js';

function saveAsDialog(sys, suggested) {
  return dialog(sys, { title: 'Save As', icon: 'notepad', w: 300 }, (win, done) => {
    const input = h('input.os-input', { type: 'text', value: suggested, spellcheck: false, autocomplete: 'off', 'data-autofocus': '', style: { flex: '1', minWidth: '0' } });
    const go = () => { if (input.value.trim()) done(input.value.trim()); };
    win.body.append(
      h('div', { text: 'Save in:  ' + sys.fs.pathString(sys.fs.SAVE_DIR) }),
      h('div.os-run-row', null, h('span', { html: 'File <u>n</u>ame:' }), input),
      h('div.os-dialog-btns.right', null, button('Save', go, { default: true }), button('Cancel', () => done(null))),
    );
    queueMicrotask(() => input.select());
  });
}

function openDialog(sys) {
  return dialog(sys, { title: 'Open', icon: 'notepad', w: 320 }, (win, done) => {
    const files = sys.fs.findAll(['txt']);
    const list = listBox(sys, { onOpen: row => done(row.value), onSelect: () => { ok.disabled = false; } });
    list.el.style.height = '120px';
    list.setRows(files.map(f => ({ label: sys.fs.pathString(f.path), icon: 'txt', value: f })));
    const ok = button('Open', () => { const r = list.selected(); if (r) done(r.value); }, { default: true, disabled: true });
    win.body.append(
      h('div', { text: 'Text documents on this computer:' }),
      list.el,
      h('div.os-dialog-btns.right', null, ok, button('Cancel', () => done(null))),
    );
  });
}

export default {
  id: 'notepad', title: 'Notepad', icon: 'notepad',
  /** args: { name, content, path } */
  open(sys, args) {
    const st = { name: null, saveName: null, dirty: false, wrap: true };
    const ta = h('textarea.os-notepad-text', { spellcheck: false, autocomplete: 'off', wrap: 'soft' });

    const title = () => `${st.dirty ? '*' : ''}${st.name || 'Untitled'} - Notepad`;
    const setDirty = d => { if (st.dirty !== d) { st.dirty = d; win.setTitle(title()); } };

    function load(file) {
      ta.value = file?.content ?? '';
      st.name = file?.name ?? null;
      const inSaveDir = file?.path && file.path.length === sys.fs.SAVE_DIR.length + 1 && sys.fs.SAVE_DIR.every((p, i) => p === file.path[i]);
      st.saveName = inSaveDir ? file.name : null;
      st.dirty = false;
      win.setTitle(title());
      ta.setSelectionRange(0, 0);
      ta.scrollTop = 0;
    }

    async function save(forceAs) {
      let name = st.saveName;
      if (!name || forceAs) {
        name = await saveAsDialog(sys, st.name || 'untitled.txt');
        if (!name) return false;
      }
      const path = sys.fs.saveText(name, ta.value);
      st.name = st.saveName = path[path.length - 1];
      st.dirty = false;
      win.setTitle(title());
      win.focus();
      return true;
    }

    /** Resolves true when it is OK to discard/replace the current text. */
    async function settle() {
      if (!st.dirty) return true;
      const answer = await sys.msgBox({
        title: 'Notepad', icon: 'warn', winIcon: 'notepad', buttons: ['Yes', 'No', 'Cancel'],
        text: `The text in ${st.name || 'Untitled'} has changed.\n\nDo you want to save the changes?`,
      });
      if (answer === 'Yes') return save(false);
      return answer === 'No';
    }

    const actions = {
      new: async () => { if (await settle()) load(null); },
      open: async () => {
        if (!(await settle())) return;
        const f = await openDialog(sys);
        if (f) load({ name: f.node.name, content: f.node.content, path: f.path });
      },
      selectAll: () => { ta.focus({ preventScroll: true }); ta.select(); },
      timeDate: () => {
        const now = new Date();
        const stamp = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' ' + now.toLocaleDateString();
        ta.focus({ preventScroll: true });
        ta.setRangeText(stamp, ta.selectionStart, ta.selectionEnd, 'end');
        setDirty(true);
      },
      wrap: () => { st.wrap = !st.wrap; ta.wrap = st.wrap ? 'soft' : 'off'; ta.classList.toggle('nowrap', !st.wrap); },
    };

    const win = sys.wm.open({
      appId: 'notepad', title: 'Untitled - Notepad', icon: 'notepad', w: 360, h: 260, minW: 200, minH: 120,
      color: [0.95, 0.95, 0.95],
      menu: [
        { label: '&File', items: [
          { label: '&New', action: actions.new },
          { label: '&Open...', action: actions.open },
          { label: '&Save', hint: 'Ctrl+S', action: () => save(false) },
          { label: 'Save &As...', action: () => save(true) },
          { sep: true },
          { label: 'Page Set&up...' },
          { label: '&Print' },
          { sep: true },
          { label: 'E&xit', action: () => win.close() },
        ] },
        { label: '&Edit', items: () => [
          { label: 'Select &All', hint: 'Ctrl+A', action: actions.selectAll },
          { label: 'Time/&Date', hint: 'F5', action: actions.timeDate },
          { sep: true },
          { label: '&Word Wrap', checked: st.wrap, action: actions.wrap },
        ] },
        { label: '&Help', items: [
          { label: '&About Summit 98', action: () => sys.open('about') },
        ] },
      ],
      beforeClose: () => {
        if (!st.dirty) return true;
        settle().then(ok => { if (ok) win.close(true); });
        return false;
      },
    });
    win.body.appendChild(ta);
    win.focusEl = ta;
    ta.addEventListener('input', () => setDirty(true));
    win.el.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
      else if (e.key === 'F5') { e.preventDefault(); actions.timeDate(); }
    });
    if (args && (args.content != null || args.name)) load(args);
    ta.focus({ preventScroll: true });
    return win;
  },
};
