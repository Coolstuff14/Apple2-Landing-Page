// WebAudio engine: one lazily created AudioContext shared by sound effects and a small
// step sequencer that synthesizes ORIGINAL tunes from note data. Nothing here throws if
// audio is blocked/unavailable; every entry point degrades to a silent no-op.

import { clamp, emitter } from './dom.js';

let ctx = null, master = null, musicGain = null, analyser = null, sfxGain = null, noiseBuf = null;
let muted = false;
let volume = 0.7;
const events = emitter();

function ensure() {
  if (ctx) return ctx;
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    analyser.connect(master);
    musicGain = ctx.createGain();
    musicGain.gain.value = volume * 0.55;
    musicGain.connect(analyser);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.22;
    sfxGain.connect(master);
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call from a user gesture: creates/resumes the context. Never rejects. */
export function unlock() {
  const c = ensure();
  if (!c || c.state !== 'suspended') return;
  try { const p = c.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* blocked */ }
}

const running = () => !!ctx && ctx.state === 'running';

// ---------------------------------------------------------------- voices ----------

function tone(dest, type, freq, t, dur, vol, opt = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (opt.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.slide), t + dur);
  const a = opt.attack ?? 0.006, rel = opt.release ?? 0.06;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.setTargetAtTime(vol * (opt.sustain ?? 0.65), t + a, 0.06);
  g.gain.setTargetAtTime(0, t + Math.max(a, dur), rel / 3);
  o.connect(g); g.connect(dest);
  o.start(t);
  o.stop(t + dur + rel * 2 + 0.02);
  o.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
  return o;
}

function noise(dest, t, dur, vol, filterType, freq) {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf;
  f.type = filterType; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t, Math.random() * 0.3);
  src.stop(t + dur + 0.02);
  src.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
  return src;
}

// ---------------------------------------------------------------- sfx -------------

const SFX = {
  click: t => tone(sfxGain, 'square', 1100, t, 0.012, 0.18, { release: 0.02 }),
  menu: t => tone(sfxGain, 'square', 760, t, 0.01, 0.1, { release: 0.02 }),
  open: t => { tone(sfxGain, 'triangle', 520, t, 0.05, 0.4); tone(sfxGain, 'triangle', 780, t + 0.05, 0.07, 0.4); },
  close: t => { tone(sfxGain, 'triangle', 700, t, 0.05, 0.4); tone(sfxGain, 'triangle', 440, t + 0.05, 0.07, 0.4); },
  min: t => tone(sfxGain, 'triangle', 600, t, 0.08, 0.35, { slide: 320 }),
  max: t => tone(sfxGain, 'triangle', 360, t, 0.08, 0.35, { slide: 640 }),
  ding: t => { tone(sfxGain, 'sine', 1318.5, t, 0.05, 0.7, { release: 0.5 }); tone(sfxGain, 'sine', 1975.5, t, 0.04, 0.3, { release: 0.4 }); },
  error: t => { tone(sfxGain, 'sawtooth', 196, t, 0.16, 0.3); tone(sfxGain, 'sawtooth', 155.6, t, 0.16, 0.3); },
  gate: t => { tone(sfxGain, 'square', 880, t, 0.04, 0.22); tone(sfxGain, 'square', 1318.5, t + 0.05, 0.07, 0.22); },
  miss: t => tone(sfxGain, 'square', 220, t, 0.12, 0.25, { slide: 110 }),
  crash: t => { noise(sfxGain, t, 0.25, 0.8, 'lowpass', 1400); tone(sfxGain, 'triangle', 160, t, 0.2, 0.5, { slide: 50 }); },
  chime: t => {
    // original startup motif: an open D-major swell
    const seq = [[293.66, 0, 1.5], [440, 0.14, 1.4], [587.33, 0.28, 1.3], [739.99, 0.44, 1.2], [880, 0.62, 1.4], [1174.66, 0.84, 1.6]];
    for (const [f, dt, d] of seq) {
      tone(sfxGain, 'sine', f, t + dt, 0.2, 0.55, { attack: 0.02, release: d });
      tone(sfxGain, 'triangle', f * 2, t + dt, 0.08, 0.1, { attack: 0.01, release: d * 0.5 });
    }
    tone(sfxGain, 'triangle', 146.83, t, 1.2, 0.4, { attack: 0.08, release: 1.2 });
  },
  shutdown: t => {
    const seq = [[880, 0], [659.25, 0.16], [493.88, 0.32], [293.66, 0.5]];
    for (const [f, dt] of seq) tone(sfxGain, 'sine', f, t + dt, 0.18, 0.5, { attack: 0.02, release: 0.9 });
  },
};

export function sfx(name) {
  if (muted || !running() || !SFX[name]) return;
  try { SFX[name](ctx.currentTime + 0.005); } catch { /* ignore */ }
}

/** Startup chime: plays only if the context is (or quickly becomes) running. */
export function chime() {
  const c = ensure();
  if (!c || muted) return;
  if (c.state === 'running') { sfx('chime'); return; }
  try {
    const started = Date.now();
    const p = c.resume();
    if (p && p.then) p.then(() => { if (Date.now() - started < 1500) sfx('chime'); }).catch(() => {});
  } catch { /* blocked */ }
}

// ---------------------------------------------------------------- tunes -----------
// Lead lines are written in 8th-note steps: a note name starts a note, "-" holds it,
// "." rests, "|" is a visual bar line. Bass, arpeggio and drums are generated from the
// chord chart. All four pieces were composed for this project.

const TRACKS = [
  {
    title: 'Summit Sunrise', file: 'Summit Sunrise.mid', bpm: 108, style: 'pop',
    lead: { wave: 'square', cutoff: 1900, vol: 0.13 }, arp: { wave: 'triangle', vol: 0.09 }, bass: { wave: 'triangle', vol: 0.3 },
    chords: 'C Am F G C Am Dm G F G Em Am F G C C',
    notes: `E5 - G5 - C6 - B5 G5 | A5 - - E5 A5 - C6 - | A5 - F5 - C5 - F5 A5 | G5 - - - D5 E5 G5 - |
            E5 - G5 - C6 - D6 E6 | C6 - - A5 E5 - A5 - | F5 - A5 - D6 - C6 A5 | B5 - - - G5 - . . |
            C6 - A5 F5 A5 - C6 - | D6 - B5 G5 B5 - D6 - | E6 - - D6 B5 - G5 - | A5 - - - E5 A5 C6 E6 |
            F6 - E6 C6 A5 - C6 - | D6 - C6 B5 G5 - B5 D6 | C6 - - - G5 - E5 - | C5 - - - - - . .`,
  },
  {
    title: 'Powder Day', file: 'Powder Day.mid', bpm: 138, style: 'drive',
    lead: { wave: 'square', cutoff: 2600, vol: 0.12 }, arp: { wave: 'square', vol: 0.045 }, bass: { wave: 'sawtooth', vol: 0.2, cutoff: 500 },
    chords: 'Am Am F G Am Am F E C G Am F C G E E',
    notes: `A4 C5 E5 A5 . G5 E5 C5 | A4 C5 E5 A5 - . E5 G5 | F5 A5 C6 A5 . F5 A5 C6 | B5 - G5 B5 D6 - B5 G5 |
            A4 C5 E5 A5 . G5 E5 C5 | E5 A5 C6 E6 - . D6 C6 | A5 - F5 A5 C6 - A5 F5 | G#5 - B5 - E6 - - . |
            E6 - C6 G5 E5 G5 C6 E6 | D6 - B5 G5 D5 G5 B5 D6 | C6 - A5 E5 A5 - C6 E6 | C6 - A5 - F5 - A5 - |
            E6 - C6 G5 E5 G5 C6 E6 | G6 - D6 B5 G5 B5 D6 G6 | E6 - - B5 G#5 - B5 - | E5 G#5 B5 E6 G#6 - - .`,
  },
  {
    title: 'Lava Lamp Lounge', file: 'Lava Lamp Lounge.mid', bpm: 80, style: 'lounge', swing: 0.18,
    lead: { wave: 'triangle', cutoff: 2200, vol: 0.2 }, arp: { wave: 'sine', vol: 0.07 }, bass: { wave: 'sine', vol: 0.36 },
    chords: 'Dm7 G7 Cmaj7 Am7 Dm7 G7 Cmaj7 Cmaj7 Fmaj7 Em7 Dm7 G7',
    notes: `. F5 A5 C6 - A5 - . | . F5 - D5 B4 - D5 - | E5 - - G5 B5 - - G5 | A5 - G5 E5 - C5 - . |
            . D5 F5 A5 - C6 - A5 | B5 - A5 G5 - F5 - D5 | E5 - - - G5 - E5 - | . . B4 C5 E5 - - . |
            A5 - C6 - E6 - C6 - | G5 - B5 - D6 - B5 - | F5 - A5 - C6 - A5 F5 | D5 - F5 - B4 - - .`,
  },
  {
    title: 'Dial-Up Dreams', file: 'Dial-Up Dreams.mid', bpm: 124, style: 'arp',
    lead: { wave: 'sawtooth', cutoff: 1700, vol: 0.11 }, arp: { wave: 'square', vol: 0.05 }, bass: { wave: 'square', vol: 0.14, cutoff: 420 },
    chords: 'Em C G D Em C Am B G D Em C G D C B',
    notes: `B5 - - E5 G5 - B5 - | C6 - - G5 E5 - G5 - | D6 - B5 - G5 - B5 D6 | A5 - - F#5 D5 - . . |
            B5 - - E5 G5 - B5 E6 | E6 - D6 C6 G5 - E5 - | A5 - C6 - E6 - C6 A5 | B5 - - D#6 F#6 - - . |
            G6 - D6 B5 G5 - B5 D6 | F#6 - D6 A5 F#5 - A5 D6 | E6 - - B5 G5 - E5 - | G5 - C6 - E6 - - . |
            G6 - D6 B5 G5 - B5 D6 | A6 - F#6 D6 A5 - D6 F#6 | E6 - C6 - G5 - E5 - | D#5 F#5 B5 D#6 F#6 - - .`,
  },
];

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pc = n => SEMI[n[0]] + (n[1] === '#' ? 1 : n[1] === 'b' ? -1 : 0);
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
function midiOf(name) {
  const m = /^([A-G][#b]?)(\d)$/.exec(name);
  return m ? 12 * (Number(m[2]) + 1) + pc(m[1]) : null;
}
function parseChord(sym) {
  const m = /^([A-G][#b]?)(maj7|m7|m|7)?$/.exec(sym) || ['', 'C', ''];
  const tones = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11] }[m[2] || ''];
  return { root: pc(m[1]), tones };
}

const STYLES = {
  // bass: [step, semitone offset from root, length in steps]; drums: 16 sixteenth steps
  pop: { bass: [[0, 0, 3], [3, 0, 1], [4, 7, 2], [6, 12, 2]], arp: [0, 1, 2, 1, 0, 1, 2, 1], arpDiv: 1, drums: 'k...h...s...h.k.', fill: 'k...h...s.s.s.ss' },
  drive: { bass: [[0, 0, 1], [1, 0, 1], [2, 12, 1], [3, 0, 1], [4, 0, 1], [5, 0, 1], [6, 12, 1], [7, 7, 1]], arp: [0, 2, 1, 2], arpDiv: 2, drums: 'k.h.s.h.k.k.s.h.', fill: 'k.h.s.h.s.s.ssss' },
  lounge: { bass: [[0, 0, 3], [3, 7, 1], [4, 12, 2], [6, 7, 2]], arp: null, pad: true, drums: 'k...h..hs...h..h', fill: 'k...h..hs...h.hh' },
  arp: { bass: [[0, 0, 2], [2, 0, 1], [3, 12, 1], [4, 0, 2], [6, 7, 1], [7, 12, 1]], arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 2, 1, 0, 1], arpDiv: 2, drums: 'k..hs..hk.k.s..h', fill: 'k..hs..hk.ssssss' },
};

function compile(tr) {
  const st = STYLES[tr.style];
  const step = 60 / tr.bpm / 2;               // one 8th note
  const chords = tr.chords.split(/\s+/).map(parseChord);
  const bars = chords.length;
  const swing = i => ((i % 2) ? (tr.swing || 0) * step : 0);
  const ev = [];
  // lead
  const toks = tr.notes.split(/\s+/).filter(t => t && t !== '|');
  let cur = null;
  toks.forEach((tok, i) => {
    if (tok === '-') { if (cur) cur.d += step; return; }
    cur = null;
    if (tok === '.') return;
    const m = midiOf(tok);
    if (m == null) return;
    cur = { t: i * step + swing(i), d: step * 0.92, f: hz(m), ch: 'lead' };
    ev.push(cur);
  });
  for (let b = 0; b < bars; b++) {
    const c = chords[b], t0 = b * 8 * step;
    for (const [s, off, len] of st.bass) {
      ev.push({ t: t0 + s * step + swing(s), d: len * step * 0.85, f: hz(36 + c.root + off), ch: 'bass' });
    }
    if (st.arp) {
      const n = 8 * st.arpDiv, d = step / st.arpDiv;
      for (let i = 0; i < n; i++) {
        const idx = st.arp[i % st.arp.length] % c.tones.length;
        const oct = st.arp[i % st.arp.length] >= c.tones.length ? 12 : 0;
        ev.push({ t: t0 + i * d, d: d * 0.8, f: hz(60 + c.root + c.tones[idx] + oct), ch: 'arp' });
      }
    }
    if (st.pad) {
      for (const tn of c.tones) ev.push({ t: t0, d: 8 * step * 0.96, f: hz(60 + c.root + tn), ch: 'pad' });
      for (const s of [3, 6]) for (const tn of c.tones.slice(1)) ev.push({ t: t0 + s * step + swing(s), d: step * 0.5, f: hz(72 + c.root + tn), ch: 'arp' });
    }
    const pat = (b % 4 === 3) ? st.fill : st.drums;
    for (let i = 0; i < 16; i++) {
      const k = pat[i];
      if (k !== '.') ev.push({ t: t0 + i * step / 2 + ((i % 4) === 2 ? swing(1) : 0), d: 0, f: 0, ch: k });
    }
  }
  ev.sort((a, b) => a.t - b.t);
  return { events: ev, dur: bars * 8 * step };
}

const compiled = TRACKS.map(() => null);
const getCompiled = i => compiled[i] || (compiled[i] = compile(TRACKS[i]));

// ---------------------------------------------------------------- sequencer -------

const LOOKAHEAD = 0.25;
const M = { index: 0, playing: false, pos: 0, loopStart: 0, ptr: 0, timer: 0, session: null };

function startSession(tr) {
  const out = ctx.createGain();
  out.connect(musicGain);
  const bus = (cutoff) => {
    if (!cutoff) return out;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.7;
    f.connect(out);
    return f;
  };
  return { out, lead: bus(tr.lead.cutoff), bass: bus(tr.bass.cutoff), arp: bus(3200), nodes: new Set() };
}

function endSession() {
  const s = M.session;
  M.session = null;
  if (!s) return;
  try { s.out.disconnect(); } catch { /* gone */ }
  for (const n of s.nodes) { try { n.stop(); } catch { /* already stopped */ } }
  s.nodes.clear();
}

function scheduleEvent(e, base) {
  const s = M.session, tr = TRACKS[M.index];
  const t = Math.max(ctx.currentTime, base + e.t);
  let node = null;
  switch (e.ch) {
    case 'lead': node = tone(s.lead, tr.lead.wave, e.f, t, e.d, tr.lead.vol, { release: 0.09 }); break;
    case 'bass': node = tone(s.bass, tr.bass.wave, e.f, t, e.d, tr.bass.vol, { release: 0.05, sustain: 0.8 }); break;
    case 'arp': node = tone(s.arp, tr.arp.wave, e.f, t, e.d, tr.arp.vol, { release: 0.04, sustain: 0.4 }); break;
    case 'pad': node = tone(s.arp, 'sine', e.f, t, e.d, 0.045, { attack: 0.12, release: 0.3, sustain: 0.9 }); break;
    case 'k': node = tone(s.out, 'sine', 150, t, 0.11, 0.5, { slide: 42, release: 0.05, sustain: 1 }); break;
    case 's': node = noise(s.out, t, 0.13, 0.2, 'bandpass', 1900); tone(s.out, 'triangle', 190, t, 0.04, 0.12, { slide: 120 }); break;
    case 'h': node = noise(s.out, t, 0.035, 0.07, 'highpass', 7000); break;
  }
  if (node) {
    s.nodes.add(node);
    node.addEventListener('ended', () => s.nodes.delete(node));
  }
}

function tick() {
  if (!M.playing || !ctx || !M.session) return;
  const tr = getCompiled(M.index), horizon = ctx.currentTime + LOOKAHEAD;
  for (let guard = 0; guard < 4; guard++) {
    while (M.ptr < tr.events.length && M.loopStart + tr.events[M.ptr].t < horizon) {
      try { scheduleEvent(tr.events[M.ptr], M.loopStart); } catch { /* ignore */ }
      M.ptr++;
    }
    if (M.ptr >= tr.events.length && M.loopStart + tr.dur < horizon) { M.loopStart += tr.dur; M.ptr = 0; } else break;
  }
}

function begin(offset) {
  endSession();
  clearInterval(M.timer);
  const tr = getCompiled(M.index);
  M.session = startSession(TRACKS[M.index]);
  M.loopStart = ctx.currentTime + 0.06 - offset;
  M.ptr = tr.events.findIndex(e => e.t >= offset - 0.001);
  if (M.ptr < 0) M.ptr = tr.events.length;
  M.playing = true;
  M.timer = setInterval(tick, 40);
  tick();
}

function halt() {
  clearInterval(M.timer);
  M.timer = 0;
  endSession();
  M.playing = false;
}

const notify = () => events.emit('change', { playing: M.playing, index: M.index });

export const music = {
  tracks: TRACKS.map(t => ({ title: t.title, file: t.file })),
  get index() { return M.index; },
  duration(i = M.index) { return getCompiled(i).dur; },
  isPlaying: () => M.playing,
  position() {
    if (!M.playing || !ctx) return M.pos;
    const d = getCompiled(M.index).dur, t = ctx.currentTime - M.loopStart;
    return t <= 0 ? 0 : t % d;      // t < 0 while the context is still suspended
  },
  /** play() resumes/starts the current track; play(i) starts track i from the top. */
  play(i) {
    const c = ensure();
    if (!c) return false;
    unlock();
    let offset = M.pos;
    if (Number.isInteger(i)) {
      const n = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
      if (M.playing && n === M.index) return true;
      M.index = n; offset = 0;
    } else if (M.playing) return true;
    begin(offset);
    notify();
    return true;
  },
  pause() {
    if (!M.playing) return;
    M.pos = music.position();
    halt();
    notify();
  },
  stop() {
    const was = M.playing || M.pos !== 0;
    halt();
    M.pos = 0;
    if (was) notify();
  },
  select(i) {
    const n = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
    if (M.playing) { music.play(n); return; }
    M.index = n; M.pos = 0;
    notify();
  },
  next() { music.select(M.index + 1); },
  prev() { music.select(M.index - 1); },
  seek(frac) {
    M.pos = clamp(frac, 0, 0.999) * getCompiled(M.index).dur;
    if (M.playing && ctx) begin(M.pos);
    notify();
  },
  setVolume(v) {
    volume = clamp(Number(v) || 0, 0, 1);
    if (musicGain) { try { musicGain.gain.setTargetAtTime(volume * 0.55, ctx.currentTime, 0.02); } catch { /* ignore */ } }
    events.emit('volume', volume);
  },
  getVolume: () => volume,
};

export function setMuted(m) {
  muted = !!m;
  if (master) { try { master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.01); } catch { /* ignore */ } }
  events.emit('mute', muted);
}
export const isMuted = () => muted;
export const onAudio = (evt, cb) => events.on(evt, cb);
export const getAnalyser = () => analyser;
export const isRunning = running;

/** Stop everything that makes sound (used when the machine powers off). */
export function stopAll() {
  music.stop();
  if (ctx && sfxGain) {
    try {
      const t = ctx.currentTime;
      sfxGain.gain.cancelScheduledValues(t);
      sfxGain.gain.setValueAtTime(0, t);
      sfxGain.gain.setValueAtTime(0.22, t + 2);
    } catch { /* ignore */ }
  }
}

/** Host-facing handle (re-exported from os.js as getAudio()). */
const hostAudio = {
  play: i => music.play(i),
  stop: () => music.stop(),
  pause: () => music.pause(),
  isPlaying: () => music.isPlaying(),
  setVolume: v => music.setVolume(v),
  getVolume: () => music.getVolume(),
  next: () => music.next(),
  prev: () => music.prev(),
  /** AnalyserNode for the music bus. Created on first access; null if WebAudio is unavailable. */
  get analyser() { ensure(); return analyser; },
  get trackIndex() { return M.index; },
  tracks: music.tracks,
  onChange: cb => events.on('change', cb),
  unlock,
};
export function getAudio() { return hostAudio; }
