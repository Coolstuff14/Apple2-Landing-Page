// Desktop shell: wallpaper + icons, taskbar (Start, task buttons, tray, clock) and the
// Start menu. Purely presentational; all actions go through `sys`.

import { h } from './dom.js';
import { icon, iconSvg } from './icons.js';
import { TASKBAR_H, SCREEN_H } from './wm.js';
import * as audio from './audio.js';

const DESKTOP_APPS = ['explorer', 'terminal', 'notepad', 'paint', 'player', 'game', 'room'];
const PROGRAM_APPS = ['terminal', 'explorer', 'notepad', 'paint', 'player', 'game', 'welcome', 'about'];

export function formatClock(d) {
  const hrs = d.getHours(), m = d.getMinutes();
  return `${String(hrs % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${hrs < 12 ? 'AM' : 'PM'}`;
}

export function createShell(sys) {
  const { wm, menus, pointer } = sys;
  let clockTimer = 0, tip = null;

  // ---------------------------------------------------------------- desktop
  const iconsEl = h('div.os-desk-icons');
  const deskIcons = DESKTOP_APPS.map(id => {
    const app = sys.apps[id];
    const el = h('div.os-desk-icon', { 'data-app': id }, icon(app.icon, 32), h('span.os-di-label', { text: app.deskLabel || app.title }));
    el.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      const wasSel = el.classList.contains('sel');
      const dbl = pointer.isDouble(e, el);
      select(el);
      if (dbl || (wasSel && e.pointerType !== 'mouse')) { select(null); sys.open(id); }
    });
    el.addEventListener('click', () => {});     // marks the icon as a tap target (touch adjustment)
    iconsEl.appendChild(el);
    return el;
  });
  function select(el) { for (const d of deskIcons) d.classList.toggle('sel', d === el); }
  sys.desktopEl.appendChild(iconsEl);
  sys.desktopEl.addEventListener('pointerdown', e => {
    if (e.target === sys.desktopEl || e.target === iconsEl) { select(null); wm.blur(); sys.screen.focus({ preventScroll: true }); }
  });
  sys.desktopEl.addEventListener('contextmenu', e => e.preventDefault());

  // ---------------------------------------------------------------- taskbar
  const startBtn = h('div.os-start', { 'data-menu-owner': '', html: iconSvg('start', 16) + '<span>Start</span>' });
  const tasksEl = h('div.os-tasks');
  const speaker = h('div.os-tray-btn', { 'data-tray': 'speaker', html: iconSvg('speaker', 16) });
  const clock = h('div.os-clock', { 'data-tray': 'clock' });
  const taskbar = h('div.os-taskbar', null, startBtn, tasksEl, h('div.os-tray', null, speaker, clock));
  sys.screen.appendChild(taskbar);
  taskbar.addEventListener('contextmenu', e => e.preventDefault());
  taskbar.addEventListener('mousedown', e => e.preventDefault());

  const programs = () => PROGRAM_APPS.map(id => ({ label: sys.apps[id].title, icon: sys.apps[id].icon, action: () => sys.open(id) }));
  const startItems = () => [
    { label: 'jakelee.info', icon: 'terminal', action: () => sys.open('terminal') },
    { sep: true },
    { label: '&Programs', icon: 'programs', items: programs },
    { label: '&Settings', icon: 'settings', items: [
      { label: '&Room Control', icon: 'room', action: () => sys.open('room') },
      { label: '&Date/Time', icon: 'datetime', action: () => sys.open('datetime') },
      { label: '&Screen Saver', icon: 'settings', action: () => sys.open('display') },
    ] },
    { label: '&Help', icon: 'welcome', action: () => sys.open('welcome') },
    { label: '&Run...', icon: 'run', action: () => sys.open('run') },
    { sep: true },
    { label: 'Sh&ut Down...', icon: 'shutdown', action: () => sys.open('shutdown') },
  ];
  let startOpen = false;
  function toggleStart() {
    if (startOpen) { menus.closeAll(); return; }
    menus.popup(startItems, 2, SCREEN_H - TASKBAR_H + 2, {
      up: true, large: true, className: 'os-startmenu', banner: '<span>Summit <i>98</i></span>',
      onClose: () => { startOpen = false; startBtn.classList.remove('open'); },
    });
    startOpen = true;
    startBtn.classList.add('open');
    sys.sfx('click');
  }
  startBtn.addEventListener('pointerdown', e => { if (e.button > 0) return; toggleStart(); });
  startBtn.addEventListener('click', () => {});

  function renderTasks() {
    const active = wm.active();
    tasksEl.replaceChildren(...wm.list().filter(w => w.taskbar).map(w => {
      const b = h('div.os-task' + (w === active && !w.minimized ? '.active' : ''), { 'data-win': w.id },
        icon(w.icon, 16), h('span.os-task-label', { text: w.title }));
      b.addEventListener('pointerdown', e => { if (e.button > 0) return; wm.toggle(w); });
      b.addEventListener('click', () => {});
      return b;
    }));
  }
  wm.on('change', type => { if (type !== 'move' && type !== 'resize' && type !== 'color') renderTasks(); });

  // ---------------------------------------------------------------- tray
  const renderSpeaker = () => { speaker.innerHTML = iconSvg(audio.isMuted() ? 'muted' : 'speaker', 16); };
  speaker.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    audio.setMuted(!audio.isMuted());
    renderSpeaker();
    sys.sfx('click');
    showTip(speaker, audio.isMuted() ? 'Sound: muted' : 'Sound: on');
  });
  audio.onAudio('mute', renderSpeaker);

  function showTip(anchor, text) {
    hideTip();
    tip = h('div.os-tooltip', { text });
    sys.menuLayer.appendChild(tip);
    const o = pointer.offsetOf(anchor);
    tip.style.left = Math.max(0, Math.min(640 - tip.offsetWidth - 2, o.x + anchor.offsetWidth / 2 - tip.offsetWidth / 2)) + 'px';
    tip.style.top = (o.y - tip.offsetHeight - 6) + 'px';
  }
  function hideTip() { tip?.remove(); tip = null; }
  speaker.addEventListener('pointerenter', () => showTip(speaker, audio.isMuted() ? 'Sound: muted' : 'Sound: on'));
  speaker.addEventListener('pointerleave', hideTip);
  clock.addEventListener('pointerenter', () => showTip(clock, new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })));
  clock.addEventListener('pointerleave', hideTip);
  clock.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    if (pointer.isDouble(e, clock) || e.pointerType !== 'mouse') { hideTip(); sys.open('datetime'); }
  });

  const tickClock = () => { const t = formatClock(new Date()); if (clock.textContent !== t) clock.textContent = t; };

  return {
    taskbar,
    start() { tickClock(); renderSpeaker(); renderTasks(); clearInterval(clockTimer); clockTimer = setInterval(tickClock, 1000); },
    stop() { clearInterval(clockTimer); clockTimer = 0; hideTip(); select(null); },
    toggleStart,
  };
}
