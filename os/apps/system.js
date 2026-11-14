// Small system applets: Room Control, About, Welcome, Date/Time, Run, Shut Down.

import { h } from '../dom.js';
import { icon, logoSvg } from '../icons.js';
import { button, checkbox, slider, dialog, listBox } from '../ui.js';
import { runSaver } from '../screensaver.js';

// ---------------------------------------------------------------- Room Control
export const room = {
  id: 'room', title: 'Room Control', icon: 'room', single: true,
  open(sys) {
    const win = sys.wm.open({ appId: 'room', title: 'Room Control', icon: 'room', w: 262, h: 312, resizable: false, bodyClass: 'os-room' });
    const st = sys.room.get();
    const lamp = checkbox('Desk <u>l</u>amp', st.lamp, v => sys.room.set('lamp', v));
    const lava = checkbox('La<u>v</u>a lamp', st.lava, v => sys.room.set('lava', v));
    const stereo = checkbox('<u>S</u>tereo', st.stereo, v => sys.room.set('stereo', v));
    let lastSun = -1;
    const sunLabel = h('span.os-room-sunval');
    const describe = v => (v < 0.15 ? 'Night' : v < 0.45 ? 'Dusk' : v < 0.8 ? 'Afternoon' : 'Golden hour');
    const sun = slider(sys, {
      value: Number(st.sun) || 0, min: 0, max: 1, width: 214,
      onInput: v => {
        const r = Math.round(v * 100) / 100;
        sunLabel.textContent = describe(r);
        if (r !== lastSun) { lastSun = r; sys.room.set('sun', r); }
      },
    });
    sunLabel.textContent = describe(sun.get());

    win.body.append(
      h('div.os-room-head', null, icon('room', 32), h('div', { text: 'Change things in the room around this computer.' })),
      h('fieldset.os-group', null, h('legend', { text: 'Lights' }), lamp.el, lava.el),
      h('fieldset.os-group', null, h('legend', { text: 'Sound' }), stereo.el),
      h('fieldset.os-group', null, h('legend', null, 'Sunlight: ', sunLabel), sun.el,
        h('div.os-room-ticks', null, h('span', { text: 'Night' }), h('span', { text: 'Golden hour' }))),
      h('div.os-dialog-btns.right', null,
        button('Step away from the computer', () => { sys.sfx('click'); sys.room.exitFocus(); }, { default: true }),
        button('Close', () => win.close(), { small: true })),
    );
    sun.refresh();

    // Host-driven updates only repaint the controls; they never call setRoom back.
    const off = sys.room.on(s => {
      lamp.set(s.lamp); lava.set(s.lava); stereo.set(s.stereo);
      if (!sun.isDragging()) { sun.set(Number(s.sun) || 0); lastSun = Math.round(sun.get() * 100) / 100; sunLabel.textContent = describe(sun.get()); }
    });
    win.on('close', off);
    return win;
  },
};

// ---------------------------------------------------------------- About
export const about = {
  id: 'about', title: 'About Summit 98', icon: 'about', single: true,
  open(sys) {
    const win = sys.wm.open({ appId: 'about', title: 'About Summit 98', icon: 'about', w: 336, h: 254, resizable: false, minimizable: false, bodyClass: 'os-about' });
    win.body.append(
      h('div.os-about-top', null,
        h('div.os-about-logo', { html: logoSvg(96, 54) }),
        h('div', null,
          h('div.os-about-name', { html: 'Summit <i>98</i>' }),
          h('div', { text: 'Version 4.10.1998 (tribute edition)' }),
          h('div', { text: 'A pretend operating system for a pretend desk.' }))),
      h('div.os-about-specs.os-field', null,
        h('div', { html: '<b>This computer</b>' }),
        h('div', { text: 'Processor:  Pentium II, 300 MHz' }),
        h('div', { text: 'Memory:     64 MB RAM' }),
        h('div', { text: 'Display:    640 x 480, 256 colours' }),
        h('div', { text: 'Hard disk:  4.3 GB (mostly snow photos)' })),
      h('div.os-about-note', { text: 'A tribute UI — not affiliated with Microsoft.' }),
      h('div.os-dialog-btns.right', null, button('OK', () => win.close(), { default: true })),
    );
    return win;
  },
};

// ---------------------------------------------------------------- Welcome
const TIPS = [
  'Double-click the icons on the desktop to open them. On a touch screen, tap an icon to select it, then tap it again to open it.',
  'Try Room Control (Start, then Settings) to switch the desk lamp and the lava lamp, or to change the time of day outside the window.',
  'Press Esc to step away from the monitor and look around the room.',
  'jakelee.info is on the desktop. Use the arrow keys and Enter to browse it, or type "help" at its prompt.',
];
export const welcome = {
  id: 'welcome', title: 'Welcome', icon: 'welcome', single: true,
  open(sys) {
    const win = sys.wm.open({ appId: 'welcome', title: 'Welcome to Summit 98', icon: 'welcome', w: 404, h: 214, resizable: false, minimizable: false, center: true, bodyClass: 'os-welcome' });
    let i = 0;
    const tip = h('div.os-welcome-tip', { text: TIPS[0] });
    const count = h('div.os-welcome-count', { text: `Tip 1 of ${TIPS.length}` });
    win.body.append(
      h('div.os-welcome-side', { html: logoSvg(64, 36) }),
      h('div.os-welcome-main', null,
        h('div.os-welcome-title', { html: 'Welcome to Summit <i>98</i>' }),
        h('div.os-welcome-box.os-field', null, h('div.os-welcome-dyk', null, icon('welcome', 32), h('b', { text: 'Did you know...' })), tip),
        count),
      h('div.os-welcome-btns', null,
        button('<u>N</u>ext Tip', () => { i = (i + 1) % TIPS.length; tip.textContent = TIPS[i]; count.textContent = `Tip ${i + 1} of ${TIPS.length}`; }, { default: true }),
        button('<u>R</u>oom Control', () => sys.open('room')),
        button('<u>C</u>lose', () => win.close())),
    );
    return win;
  },
};

// ---------------------------------------------------------------- Date/Time
export const datetime = {
  id: 'datetime', title: 'Date/Time', icon: 'datetime', single: true,
  open(sys) {
    const win = sys.wm.open({ appId: 'datetime', title: 'Date/Time Properties', icon: 'datetime', w: 226, h: 286, resizable: false, minimizable: false, bodyClass: 'os-datetime' });
    // The calendar on the wall says October 1998, so does this one. Today's real
    // day-of-month is highlighted for flavour.
    const today = new Date().getDate();
    const first = new Date(1998, 9, 1).getDay();
    const days = new Date(1998, 10, 0).getDate();
    const grid = h('div.os-cal-grid');
    for (const d of 'SMTWTFS') grid.appendChild(h('div.os-cal-head', { text: d }));
    for (let i = 0; i < first; i++) grid.appendChild(h('div'));
    for (let d = 1; d <= days; d++) grid.appendChild(h('div.os-cal-day' + (d === today ? '.today' : ''), { text: d }));
    const time = h('div.os-cal-time.os-field');
    const tick = () => {
      const now = new Date(), hrs = now.getHours();
      time.textContent = `${String(hrs % 12 || 12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${hrs < 12 ? 'AM' : 'PM'}`;
    };
    win.body.append(
      h('fieldset.os-group', null, h('legend', { text: 'Date' }),
        h('div.os-cal-month', null, h('div.os-field', { text: 'October' }), h('div.os-field', { text: '1998' })),
        h('div.os-cal.os-field', null, grid)),
      h('fieldset.os-group', null, h('legend', { text: 'Time' }), time),
      h('div.os-dialog-btns.right', null, button('OK', () => win.close(), { default: true })),
    );
    tick();
    win.every(500, tick).start();
    return win;
  },
};

// ---------------------------------------------------------------- Run
export const run = {
  id: 'run', title: 'Run', icon: 'run', single: true,
  open(sys) {
    const ids = Object.keys(sys.apps).filter(id => !['run', 'shutdown'].includes(id));
    dialog(sys, { appId: 'run', title: 'Run', icon: 'run', w: 330, modal: false }, (win, done) => {
      const input = h('input.os-input', { type: 'text', spellcheck: false, autocomplete: 'off', 'data-autofocus': '', style: { flex: '1', minWidth: '0' } });
      const go = () => {
        const id = input.value.trim().toLowerCase().replace(/\.exe$/, '');
        if (!id) return;
        if (!sys.apps[id]) {
          sys.msgBox({ title: 'Run', icon: 'error', text: `Cannot find '${input.value.trim()}'.\nTry one of: ${ids.join(', ')}.`, w: 320 });
          return;
        }
        done(id);
        sys.open(id);
      };
      win.body.append(
        h('div.os-dialog-row', null, icon('run', 32),
          h('div.os-dialog-text', { text: 'Type the name of a program and Summit 98 will open it for you.' })),
        h('div.os-run-row', null, h('span', { html: '<u>O</u>pen:' }), input),
        h('div.os-run-hint', { text: 'Programs: ' + ids.join(', ') }),
        h('div.os-dialog-btns.right', null, button('OK', go, { default: true }), button('Cancel', () => done(null))),
      );
    });
    return sys.wm.find('run');
  },
};

// ---------------------------------------------------------------- Shut Down
export const shutdown = {
  id: 'shutdown', title: 'Shut Down', icon: 'shutdown', single: true,
  open(sys) {
    dialog(sys, { appId: 'shutdown', title: 'Shut Down Summit 98', icon: 'shutdown', w: 300 }, (win, done) => {
      const off = checkbox('<u>S</u>hut down', true, null, 'radio', 'os98-shutdown');
      const re = checkbox('<u>R</u>estart', false, null, 'radio', 'os98-shutdown');
      win.body.append(
        h('div.os-dialog-row', null, icon('shutdown', 32),
          h('div.os-dialog-text', null, h('div', { text: 'What do you want the computer to do?', style: { marginBottom: '8px' } }), off.el, re.el)),
        h('div.os-dialog-btns.right', null,
          button('OK', () => done(re.get() ? 'restart' : 'shutdown'), { default: true }),
          button('Cancel', () => done(null))),
      );
    }).then(choice => {
      if (choice === 'restart') sys.restart();
      else if (choice === 'shutdown') sys.shutdown();
    });
    return sys.wm.find('shutdown');
  },
};

// ---------------------------------------------------------------- Display Properties (screen saver)
export const display = {
  id: 'display', title: 'Display Properties', icon: 'settings', single: true,
  open(sys) {
    const win = sys.wm.open({ appId: 'display', title: 'Display Properties', icon: 'settings', w: 300, h: 358, resizable: false, minimizable: false, bodyClass: 'os-display' });
    const cfg = sys.saver.get();
    const rows = [{ label: '(None)', value: 'none' }, ...sys.saver.list.map(s => ({ label: s.name, value: s.id }))];
    const canvas = h('canvas.os-display-screen', { width: 128, height: 96 });
    let stop = null, chosen = cfg.id;
    const showPreview = id => {
      stop?.(); stop = null;
      const g = canvas.getContext('2d'); g.fillStyle = id === 'none' ? '#008080' : '#000'; g.fillRect(0, 0, 128, 96);
      if (id !== 'none') stop = runSaver(canvas, id);
    };
    const list = listBox(sys, { onSelect: r => { chosen = r.value; showPreview(chosen); }, onOpen: r => sys.saver.preview(r.value) });
    list.setRows(rows); list.select(Math.max(0, rows.findIndex(r => r.value === cfg.id)), true);
    const waits = [15, 30, 60, 90, 180, 300, 600];
    const fmt = s => (s < 60 ? `${s} seconds` : `${s / 60 === Math.round(s / 60) ? s / 60 : (s / 60).toFixed(1)} minute${s === 60 ? '' : 's'}`);
    const waitLabel = h('span');
    let waitIdx = Math.max(0, waits.findIndex(w => w >= cfg.wait));
    const wait = slider(sys, { value: waitIdx, min: 0, max: waits.length - 1, width: 150, onInput: v => { waitIdx = Math.round(v); waitLabel.textContent = fmt(waits[waitIdx]); } });
    waitLabel.textContent = fmt(waits[waitIdx]);
    const apply = () => sys.saver.set({ id: chosen, wait: waits[waitIdx] });
    win.body.append(
      h('div.os-display-monitor', null, canvas),
      h('fieldset.os-group', null, h('legend', { text: 'Screen Saver' }), list.el),
      h('div.os-display-wait', null, h('span', { text: 'Wait:' }), wait.el, waitLabel),
      h('div.os-dialog-btns.right', null,
        button('Pre<u>v</u>iew', () => { if (chosen !== 'none') sys.saver.preview(chosen); }, { small: true }),
        button('OK', () => { apply(); win.close(); }, { default: true }),
        button('Cancel', () => win.close(), { small: true })),
    );
    wait.refresh();
    showPreview(chosen);
    win.on('close', () => { stop?.(); stop = null; });
    return win;
  },
};
