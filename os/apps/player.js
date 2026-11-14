// Media Player: a view onto the shared audio engine (audio.js). The UI always renders
// from the engine state, because the host can start/stop playback through getAudio().

import { h } from '../dom.js';
import { slider, listBox } from '../ui.js';
import { music, onAudio, getAnalyser } from '../audio.js';

const G = {
  prev: '<path d="M0 0h2v8H0zM8 0v8L3 4zM13 0v8L8 4z"/>',
  play: '<path d="M2 0l8 4-8 4z"/>',
  pause: '<path d="M1 0h3v8H1zM7 0h3v8H7z"/>',
  stop: '<path d="M1 0h8v8H1z"/>',
  next: '<path d="M11 0h2v8h-2zM5 0v8l5-4zM0 0v8l5-4z"/>',
};
const glyph = k => `<svg class="os-ico" width="13" height="8" viewBox="0 0 13 8" shape-rendering="crispEdges">${G[k]}</svg>`;
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default {
  id: 'player', title: 'Media Player', icon: 'player', single: true,
  /** args: { track: number, play: boolean } */
  open(sys, args) {
    const win = sys.wm.open({
      appId: 'player', title: 'Media Player', icon: 'player', w: 288, h: 292, resizable: false,
      color: [0.5, 0.52, 0.5], bodyClass: 'os-player',
      menu: [
        { label: '&File', items: [{ label: '&Open...' }, { sep: true }, { label: 'E&xit', action: () => win.close() }] },
        { label: '&Play', items: () => [
          { label: '&Play / Pause', action: () => (music.isPlaying() ? music.pause() : music.play()) },
          { label: '&Stop', action: () => music.stop() },
          { sep: true },
          { label: 'P&revious', action: () => music.prev() },
          { label: '&Next', action: () => music.next() },
        ] },
        { label: '&View', items: () => [
          { label: '&Spectrum', checked: viz === 'bars', action: () => { viz = 'bars'; draw(); } },
          { label: '&Oscilloscope', checked: viz === 'scope', action: () => { viz = 'scope'; draw(); } },
        ] },
      ],
    });

    let viz = 'bars';
    let seeking = false;
    const titleEl = h('div.os-pl-title');
    const timeEl = h('div.os-pl-time');
    const canvas = h('canvas.os-pl-viz', { width: 258, height: 56 });
    const g = canvas.getContext('2d');
    const seek = slider(sys, {
      thin: true, value: 0,
      onInput: () => { seeking = true; },
      onChange: v => { seeking = false; music.seek(v); },
    });
    const vol = slider(sys, { thin: true, value: music.getVolume(), width: 68, onInput: v => music.setVolume(v) });
    const btn = (act, fn) => {
      const b = h('button.os-btn.small.os-pl-btn', { type: 'button', 'data-act': act, 'aria-label': act, html: glyph(act) });
      b.addEventListener('click', fn);
      return b;
    };
    const buttons = {
      prev: btn('prev', () => music.prev()),
      play: btn('play', () => music.play()),
      pause: btn('pause', () => music.pause()),
      stop: btn('stop', () => music.stop()),
      next: btn('next', () => music.next()),
    };
    const list = listBox(sys, {
      onSelect: (row, i) => { if (i !== music.index) music.select(i); },
      onOpen: (row, i) => music.play(i),
    });
    list.setRows(music.tracks.map((t, i) => ({ label: `${i + 1}. ${t.title}   (${mmss(music.duration(i))})`, icon: 'audio' })));
    const status = h('div.grow');

    win.body.append(
      h('div.os-pl-display', null, h('div.os-pl-head', null, titleEl, timeEl), canvas),
      seek.el,
      h('div.os-pl-controls', null, buttons.prev, buttons.play, buttons.pause, buttons.stop, buttons.next,
        h('span.os-pl-vol', { text: 'Vol' }), vol.el),
      list.el,
      h('div.os-status', null, status),
    );
    seek.refresh(); vol.refresh();
    canvas.addEventListener('pointerdown', () => { viz = viz === 'bars' ? 'scope' : 'bars'; draw(); });

    const freq = new Uint8Array(128), wave = new Uint8Array(256);

    function draw() {
      const W = canvas.width, H = canvas.height;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#003818';
      for (let y = 7; y < H; y += 8) g.fillRect(0, y, W, 1);
      const an = getAnalyser();
      const live = an && music.isPlaying();
      if (viz === 'bars') {
        if (live) an.getByteFrequencyData(freq);
        const n = 32, bw = Math.floor(W / n);
        for (let i = 0; i < n; i++) {
          const v = live ? (freq[Math.floor(i * 1.6) + 1] / 255) : 0;
          const bh = Math.max(1, Math.round(v * (H - 6) / 4) * 4);
          g.fillStyle = '#20e060';
          for (let y = 0; y < bh; y += 4) { g.fillStyle = y > H * 0.62 ? '#ffd040' : '#20e060'; g.fillRect(1 + i * bw, H - 2 - y - 3, bw - 2, 3); }
        }
      } else {
        if (live) an.getByteTimeDomainData(wave);
        g.fillStyle = '#20e060';
        let py = H / 2;
        for (let x = 0; x < W; x++) {
          const v = live ? (wave[Math.floor(x * wave.length / W)] - 128) / 128 : 0;
          const y = Math.round(H / 2 + v * (H / 2 - 4) * 2.2);
          const a = Math.min(py, y), b = Math.max(py, y);
          g.fillRect(x, Math.max(0, a), 1, Math.max(1, b - a + 1));
          py = y;
        }
      }
    }

    function sync() {
      const i = music.index, playing = music.isPlaying(), pos = music.position(), dur = music.duration();
      titleEl.textContent = `${i + 1}. ${music.tracks[i].title}`;
      timeEl.textContent = `${mmss(pos)} / ${mmss(dur)}`;
      buttons.play.classList.toggle('down', playing);
      buttons.pause.classList.toggle('down', !playing && pos > 0);
      if (list.index() !== i) list.select(i, true);
      if (!seeking) seek.set(pos / dur);
      status.textContent = playing ? `Playing — ${music.tracks[i].file}` : pos > 0 ? 'Paused' : 'Stopped';
      draw();
    }

    const loop = win.loop(() => {
      const pos = music.position(), dur = music.duration();
      timeEl.textContent = `${mmss(pos)} / ${mmss(dur)}`;
      if (!seeking) seek.set(pos / dur);
      draw();
    });
    const offChange = onAudio('change', () => { sync(); if (music.isPlaying()) loop.start(); else loop.stop(); });
    const offVol = onAudio('volume', v => vol.set(v));
    // Closing the player by hand stops the music; a forced close (closeAll / power) leaves
    // that decision to the caller.
    win.on('close', forced => { offChange(); offVol(); if (!forced) music.stop(); });
    win.on('args', a => handle(a));

    function handle(a) {
      if (!a || !Number.isInteger(a.track)) return;
      if (a.play) { if (!music.play(a.track)) sys.msgBox({ title: 'Media Player', icon: 'warn', text: 'Sound is not available in this browser.' }); }
      else music.select(a.track);
    }

    sync();
    if (music.isPlaying()) loop.start();
    handle(args);
    return win;
  },
};
