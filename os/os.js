// Summit 98 — a self-contained retro desktop UI for a fixed 640x480 DOM surface.
//
//   import { createOS, getAudio } from './os/os.js';
//   const os = createOS(rootEl, bridge, { skipBoot: false, autoOpen: ['welcome'] });
//
// The module never reads `location`, never touches document.body and never uses
// viewport-relative units; see pointer.js for how input survives CSS 3D transforms.

import { h, emitter, store } from './dom.js';
import { createPointer } from './pointer.js';
import { createMenus } from './menus.js';
import { createWM, SCREEN_W, SCREEN_H, WORK_H } from './wm.js';
import { createShell } from './shell.js';
import { createFS } from './fs.js';
import { createScreensaver, SAVERS, saverById } from './screensaver.js';
import { runBoot, runHalt, showOff } from './boot.js';
import { msgBox } from './ui.js';
import * as audio from './audio.js';

import notepad from './apps/notepad.js';
import paint from './apps/paint.js';
import explorer from './apps/explorer.js';
import terminal from './apps/terminal.js';
import player from './apps/player.js';
import game from './apps/game.js';
import { room, about, welcome, datetime, run, shutdown, display } from './apps/system.js';

export { getAudio } from './audio.js';

const APPS = { notepad, paint, explorer, terminal, player, game, room, about, welcome, datetime, run, shutdown, display };
const WALLPAPER = [0, 0.5, 0.5];
const TASKBAR_SHARE = 28 / 480;

/** App ids accepted by open(). */
export const APP_IDS = Object.keys(APPS);

function createRoom(bridge) {
  let state = { lamp: true, lava: true, sun: 0.8, stereo: false };
  const ev = emitter();
  const merge = s => { if (s && typeof s === 'object') state = { ...state, ...s }; };
  const read = () => { try { merge(bridge?.getRoomState?.()); } catch { /* host error */ } return state; };
  read();
  try { bridge?.onRoomChange?.(s => { merge(s); ev.emit('change', state); }); } catch { /* host error */ }
  return {
    get: read,
    /** User-initiated change: forwarded to the host exactly once. */
    set(key, value) {
      state = { ...state, [key]: value };
      try { bridge?.setRoom?.(key, value); } catch (err) { console.warn('[os98] bridge.setRoom failed', err); }
    },
    on: cb => ev.on('change', cb),
    exitFocus() { try { bridge?.exitFocus?.(); } catch (err) { console.warn('[os98] bridge.exitFocus failed', err); } },
  };
}

export function createOS(rootEl, bridge, options = {}) {
  const events = emitter();
  const screen = h('div.os98', { tabindex: -1 });
  const desktopEl = h('div.os-desktop');
  const winLayer = h('div.os-windows');
  const menuLayer = h('div.os-menus');
  const overlay = h('div.os-overlay');
  screen.append(desktopEl, winLayer, menuLayer, overlay);
  rootEl.appendChild(screen);

  const pointer = createPointer(screen);
  const sfx = name => audio.sfx(name);
  const menus = createMenus({ screen, layer: menuLayer, pointer, sfx });
  const wm = createWM({ layer: winLayer, pointer, menus, sfx });
  const saver = createScreensaver(overlay);

  let state = 'off';              // 'off' | 'boot' | 'on' | 'halt'
  let boot = null, halt = null, restartTimer = 0, idleTimer = 0, colorTimer = 0;
  let firstDesktop = true, destroyed = false;
  let pending = [];
  let lastColor = [0, 0, 0];
  // Screensaver choice and wait time are the user's (Display Properties) and persist; options.screensaverMs overrides the wait for tests.
  const saverCfg = Object.assign({ id: 'snow', wait: 90 }, store.get('summit98.saver', null) || {});
  if (saverCfg.id !== 'none' && !saverById(saverCfg.id)) saverCfg.id = 'snow';
  const idleMs = () => (Number(options.screensaverMs) > 0 ? Number(options.screensaverMs) : Math.max(15, Number(saverCfg.wait) || 90) * 1000);

  const sys = {
    screen, desktopEl, menuLayer, pointer, menus, wm, sfx, audio,
    fs: createFS(),
    room: createRoom(bridge),
    apps: APPS,
    open: launch,
    saver: {
      list: SAVERS.map(s => ({ id: s.id, name: s.name })),
      get: () => ({ ...saverCfg }),
      set(cfg) { Object.assign(saverCfg, cfg); store.set('summit98.saver', saverCfg); resetIdle(); },
      preview: id => startSaver(id),
    },
    msgBox: opts => msgBox(sys, opts),
    shutdown: () => beginShutdown(false),
    restart: () => beginShutdown(true),
  };
  const shell = createShell(sys);

  // ---------------------------------------------------------------- apps
  function launch(appId, args) {
    const id = String(appId || '').trim().toLowerCase();
    const app = APPS[id];
    if (!app) {
      if (state === 'on') msgBox(sys, { title: 'Summit 98', icon: 'error', text: `Cannot find '${appId}'.\nCheck the name and try again.` });
      return null;
    }
    if (state !== 'on') { pending.push([id, args]); return null; }
    if (app.single) {
      const existing = wm.find(id);
      if (existing) { wm.focus(existing); if (args !== undefined) existing.events.emit('args', args); return existing; }
    }
    try {
      return app.open(sys, args) || null;
    } catch (err) {
      console.warn(`[os98] ${id} failed to open`, err);
      return null;
    }
  }

  // ---------------------------------------------------------------- screen colour estimate
  function computeColor() {
    if (state !== 'on' || saver.active()) return [0, 0, 0];
    let c = WALLPAPER.slice();
    for (const w of wm.stack()) {
      if (w.minimized) continue;
      const x = w.maximized ? 0 : w.x, y = w.maximized ? 0 : w.y;
      const ww = w.maximized ? SCREEN_W : w.w, wh = w.maximized ? WORK_H : w.h;
      const vw = Math.max(0, Math.min(SCREEN_W, x + ww) - Math.max(0, x));
      const vh = Math.max(0, Math.min(WORK_H, y + wh) - Math.max(0, y));
      const a = (vw * vh) / (SCREEN_W * SCREEN_H);
      c = c.map((v, i) => v * (1 - a) + w.color[i] * a);
    }
    return c.map(v => v * (1 - TASKBAR_SHARE) + 0.75 * TASKBAR_SHARE);
  }
  function refreshColor() {
    const c = computeColor();
    if (Math.max(...c.map((v, i) => Math.abs(v - lastColor[i]))) > 0.015) {
      lastColor = c;
      events.emit('screencolor', c.slice());
    }
  }
  function queueColor() {
    if (colorTimer) return;
    colorTimer = setTimeout(() => { colorTimer = 0; refreshColor(); }, 0);
  }
  wm.on('change', queueColor);

  // ---------------------------------------------------------------- idle / screensaver
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = 0;
    if (state === 'on' && saverCfg.id !== 'none') idleTimer = setTimeout(startSaver, idleMs());
  }
  function startSaver(id) {
    if (state !== 'on') return;
    menus.closeAll(); pointer.cancel(); saver.show(typeof id === 'string' ? id : saverCfg.id); refreshColor();
  }
  function activity(e) {
    if (e.type !== 'pointermove' && e.type !== 'wheel') audio.unlock();
    if (saver.active()) {
      if (e.type === 'pointermove' && saver.age() < 400) return;
      saver.hide();
      refreshColor();
      if (e.type === 'pointerdown') { e.stopPropagation(); e.preventDefault(); }
    }
    if (state === 'on') resetIdle();
  }
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel']) screen.addEventListener(type, activity, true);

  // ---------------------------------------------------------------- keyboard
  screen.addEventListener('keydown', e => {
    if (state === 'boot') { boot?.skip(); return; }
    if (e.key !== 'Escape' || state !== 'on') return;
    // Esc is only consumed when it actually dismisses a menu or dialog; otherwise it
    // bubbles to the host (which uses it to leave the monitor close-up).
    if (menus.closeAll()) { e.stopPropagation(); e.preventDefault(); return; }
    const top = wm.active();
    if (top && top.spec.dialog) { top.close(); e.stopPropagation(); e.preventDefault(); }
  });
  overlay.addEventListener('pointerdown', () => { if (state === 'boot') boot?.skip(); });
  screen.addEventListener('contextmenu', e => { if (!e.target.closest?.('input, textarea')) e.preventDefault(); });
  // An overflow:hidden host box can still be scrolled by focus/selection; pin it.
  const pin = () => { if (rootEl.scrollLeft || rootEl.scrollTop) { rootEl.scrollLeft = 0; rootEl.scrollTop = 0; } };
  rootEl.addEventListener('scroll', pin);

  // ---------------------------------------------------------------- power state machine
  const unsubSound = audio.onAudio('change', s => {
    if (s.playing !== lastPlaying) { lastPlaying = s.playing; events.emit('sound', s.playing, { track: s.index, title: audio.music.tracks[s.index].title }); }
  });
  let lastPlaying = audio.music.isPlaying();

  function teardown(hard) {
    boot?.cancel(); boot = null;
    halt?.cancel(); halt = null;
    clearTimeout(restartTimer); restartTimer = 0;
    clearTimeout(idleTimer); idleTimer = 0;
    saver.hide();
    pointer.cancel();
    menus.closeAll();
    wm.closeAll();
    if (hard) audio.stopAll(); else audio.music.stop();
    shell.stop();
    pending = [];
  }

  function enterDesktop(silent) {
    boot = null;
    state = 'on';
    overlay.replaceChildren();
    overlay.style.display = 'none';
    shell.start();
    resetIdle();
    if (!silent) audio.chime();
    const queue = pending; pending = [];
    if (firstDesktop) {
      firstDesktop = false;
      const auto = Array.isArray(options.autoOpen) ? options.autoOpen : null;
      if (auto) auto.forEach(id => launch(id)); else launch('welcome');
    }
    queue.forEach(([id, args]) => launch(id, args));
    refreshColor();
  }

  function powerOn(skipBoot) {
    if (state !== 'off' || destroyed) return;
    clearTimeout(restartTimer); restartTimer = 0;
    state = 'boot';
    const doc = screen.ownerDocument;
    if (!doc.activeElement || doc.activeElement === doc.body) screen.focus({ preventScroll: true });
    events.emit('power', true);
    if (skipBoot) enterDesktop(true);
    else boot = runBoot(overlay, () => enterDesktop(false));
  }

  function powerOff(hard = true) {
    const was = state;
    teardown(hard);
    state = 'off';
    showOff(overlay, () => powerOn(false));
    if (was !== 'off') events.emit('power', false);
    refreshColor();
  }

  function beginShutdown(restart) {
    if (state !== 'on') return;
    audio.sfx('shutdown');
    if (restart) {
      powerOff(false);
      restartTimer = setTimeout(() => powerOn(false), 900);
      return;
    }
    teardown(false);
    state = 'halt';
    refreshColor();
    halt = runHalt(overlay, () => powerOff(true));
  }

  // ---------------------------------------------------------------- public API
  const api = {
    /** Open an app by id, optionally with app-specific args (queued until the desktop is up). Returns false for an unknown id. */
    open(id, args) {
      const known = !!APPS[String(id || '').trim().toLowerCase()];
      launch(id, args);
      return known;
    },
    closeAll() { menus.closeAll(); wm.closeAll(); },
    setPower(on) { if (on) powerOn(false); else powerOff(true); },
    isOn: () => state !== 'off',
    getAverageColor: () => computeColor(),
    on: (evt, cb) => events.on(evt, cb),
    /** Extras (not part of the minimum contract). */
    getState: () => state,
    /** Removable media: mountDisk('A:' | 'D:', { label, files }) or mountDisk(drive, null) to empty the drive. */
    mountDisk: (drive, disk) => sys.fs.mount(drive, disk),
    /** Screensaver: { id: 'snow'|'stars'|'ribbons'|'logo'|'blank'|'none', wait: seconds }. */
    getScreensaver: () => ({ ...saverCfg }),
    setScreensaver: cfg => sys.saver.set(cfg),
    screensaverActive: () => saver.active(),
    apps: APP_IDS.slice(),
    destroy() {
      if (destroyed) return;
      teardown(true);
      destroyed = true;
      state = 'off';
      unsubSound();
      menus.destroy();
      pointer.destroy();
      rootEl.removeEventListener('scroll', pin);
      screen.remove();
    },
  };

  showOff(overlay, () => powerOn(false));
  if (options.power !== false) powerOn(!!options.skipBoot);
  return api;
}
