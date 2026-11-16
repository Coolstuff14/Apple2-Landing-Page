// Sound for the swim, all synthesized: a low underwater rumble, and the music of the party under the rock.
// From the open tank the music arrives through the stone (low-passed, louder as you get closer); inside it
// opens up. Nothing here plays in the room: start() runs from the click that turns you into a fish.
// A 32-bar loop at 140 BPM: 8 bars groove, 8 with the arpeggio, 8 breakdown, 8 drop. beat() is the clock the
// lights follow.
export const BPM = 140;
const S16 = 60 / BPM / 4;
const ROOTS = [45, 45, 41, 41, 48, 48, 43, 43];                   // A, F, C, G: two bars each
const MINOR = [true, true, false, false, false, false, false, false];
const ACID = [0, null, 0, 12, null, 0, 7, null, 0, 12, null, 0, 3, null, 10, 12];
const ARP = [0, 7, 12, 15, 19, 15, 12, 7, 0, 7, 12, 15, 24, 19, 15, 12];
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createFishAudio() {
  let ctx = null, master, wall1, wall2, raveGain, drums, synth, delay, ambGain, noise, meter, meterBuf, sleepTimer = 0, timer = 0, t0 = 0, step = 0, nextT = 0;
  let on = false, muted = false, inside = false, prox = 0, fallback0 = performance.now() / 1000;
  function ensure() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
      meter = ctx.createAnalyser(); meter.fftSize = 1024; meterBuf = new Float32Array(1024); master.connect(meter);
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.16;
      wall1 = ctx.createBiquadFilter(); wall2 = ctx.createBiquadFilter();
      for (const w of [wall1, wall2]) { w.type = 'lowpass'; w.frequency.value = 220; w.Q.value = 0.6; }
      raveGain = ctx.createGain(); raveGain.gain.value = 0.05;
      comp.connect(wall1); wall1.connect(wall2); wall2.connect(raveGain); raveGain.connect(master);
      drums = ctx.createGain(); drums.gain.value = 0.9; drums.connect(comp);
      synth = ctx.createGain(); synth.gain.value = 0.8; synth.connect(comp);
      delay = ctx.createDelay(1); delay.delayTime.value = S16 * 3;
      const fb = ctx.createGain(); fb.gain.value = 0.38; delay.connect(fb); fb.connect(delay); delay.connect(synth);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // underwater bed: looped noise through a low filter
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.4;
      ambGain = ctx.createGain(); ambGain.gain.value = 0.10;
      src.connect(lp); lp.connect(ambGain); ambGain.connect(master); src.start();
    } catch (e) { ctx = null; }
    return ctx;
  }
  const env = (g, t, peak, decay) => { g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0008, t + decay); };
  function osc(type, f, t, dur, dest) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.connect(dest); o.start(t); o.stop(t + dur); return o; }
  function nz(t, dur, dest) { const s = ctx.createBufferSource(); s.buffer = noise; s.connect(dest); s.start(t, Math.random() * 1.5, dur); return s; }
  function kick(t) {
    const g = ctx.createGain(); g.connect(drums); env(g, t, 1.0, 0.30);
    const o = osc('sine', 160, t, 0.32, g); o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const c = ctx.createGain(); c.connect(drums); env(c, t, 0.25, 0.02); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500; f.connect(c); nz(t, 0.03, f);
  }
  function hat(t, open, vol) {
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500; const g = ctx.createGain(); f.connect(g); g.connect(drums);
    env(g, t, vol, open ? 0.16 : 0.035); nz(t, open ? 0.18 : 0.05, f);
  }
  function clap(t) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.9; const g = ctx.createGain(); f.connect(g); g.connect(drums);
    g.gain.setValueAtTime(0, t); for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(0.5, t + i * 0.012); g.gain.exponentialRampToValueAtTime(0.06, t + i * 0.012 + 0.010); }
    g.gain.setValueAtTime(0.45, t + 0.036); g.gain.exponentialRampToValueAtTime(0.001, t + 0.20); nz(t, 0.22, f);
  }
  function bass(t, midi, accent, sweep) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 12; const g = ctx.createGain(); f.connect(g); g.connect(synth);
    const top = (accent ? 3000 : 1300) * sweep + 250; f.frequency.setValueAtTime(top, t); f.frequency.exponentialRampToValueAtTime(190, t + (accent ? 0.16 : 0.10));
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(accent ? 0.36 : 0.27, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + S16 * 0.95);
    osc('sawtooth', hz(midi), t, S16, f);
  }
  function pluck(t, midi, vol) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2; f.frequency.setValueAtTime(3600, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.16);
    const g = ctx.createGain(); f.connect(g); g.connect(synth); g.connect(delay); env(g, t, vol, 0.20);
    for (const d of [-8, 8]) { const o = osc('sawtooth', hz(midi), t, 0.22, f); o.detune.value = d; }
  }
  function pad(t, root, minor, dur) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; const g = ctx.createGain(); f.connect(g); g.connect(synth);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.055, t + dur * 0.4); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const n of [0, minor ? 3 : 4, 7, 12]) for (const d of [-6, 6]) { const o = osc('sawtooth', hz(root + 12 + n), t, dur, f); o.detune.value = d; }
  }
  function riser(t, dur) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.5; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ctx.createGain(); f.connect(g); g.connect(synth); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.30, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    nz(t, Math.min(1.9, dur + 0.05), f);
  }
  const sectionOf = (bar) => (bar < 8 ? 0 : bar < 16 ? 1 : bar < 24 ? 2 : 3);
  function playStep(n, t) {
    const s = n % 16, bar = Math.floor(n / 16) % 32, sec = sectionOf(bar), root = ROOTS[bar % 8], minor = MINOR[bar % 8];
    if (sec !== 2) {
      if (s % 4 === 0) kick(t);
      if (s % 4 === 2) hat(t, true, 0.20); else if (sec !== 0 || s % 2 === 1) hat(t, false, 0.07);
      if (s === 4 || s === 12) clap(t);
      const a = ACID[s];
      if (a != null) bass(t, root - 12 + a, s === 3 || s === 9 || s === 15, 0.35 + 0.65 * (0.5 - 0.5 * Math.cos((bar % 8 + s / 16) / 8 * Math.PI * 2)) + (sec === 3 ? 0.4 : 0));
    } else {
      if (s === 0 && bar % 2 === 0) pad(t, root, minor, S16 * 32);
      if (bar === 23 && s === 0) riser(t, S16 * 16);
      if (bar >= 22 && s % 2 === 0) hat(t, false, 0.05 + 0.01 * (bar - 22) * 8);
    }
    if (sec === 1 || sec === 3 || (sec === 2 && s % 2 === 0)) {
      let iv = ARP[s]; if (!minor && (iv === 15)) iv = 16;
      pluck(t, root + 24 + iv, sec === 2 ? 0.07 : sec === 3 ? 0.13 : 0.10);
    }
  }
  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    if (nextT < ctx.currentTime - 0.3) {                           // the tab was asleep: jump ahead, keep the grid
      const skip = Math.ceil((ctx.currentTime - nextT) / S16); step += skip; nextT += skip * S16;
    }
    while (nextT < ctx.currentTime + 0.14) { playStep(step, nextT); step++; nextT += S16; }
  }
  function apply(fast) {
    if (!ctx) return;
    const t = ctx.currentTime, tc = fast ? 0.05 : 0.25, p2 = prox * prox;
    const cut = inside ? 18000 : 190 + 900 * p2, gain = inside ? 0.85 : 0.035 + 0.55 * p2;
    wall1.frequency.setTargetAtTime(cut, t, tc); wall2.frequency.setTargetAtTime(cut, t, tc);
    raveGain.gain.setTargetAtTime(gain, t, tc); ambGain.gain.setTargetAtTime(inside ? 0.02 : 0.10, t, 0.3);
    master.gain.setTargetAtTime(on && !muted ? 0.8 : 0, t, 0.12);
  }
  return {
    /** call from a user gesture */
    start() {
      on = true; fallback0 = performance.now() / 1000;
      if (!ensure()) return;
      clearTimeout(sleepTimer);
      try { ctx.resume?.(); } catch (e) { /* blocked: the lights fall back to their own clock */ }
      t0 = ctx.currentTime + 0.08; step = 0; nextT = t0; inside = false; prox = 0;
      clearInterval(timer); timer = setInterval(schedule, 25); apply(true);
    },
    /** silence, then put the context to sleep so an open tab costs nothing once you are back in the room */
    stop() { on = false; clearInterval(timer); timer = 0; apply(true); clearTimeout(sleepTimer); sleepTimer = setTimeout(() => { if (!on && ctx) { try { ctx.suspend?.(); } catch (e) { /* ignore */ } } }, 700); },
    setProximity(p) { const v = Math.min(1, Math.max(0, p)); if (Math.abs(v - prox) > 0.01) { prox = v; apply(false); } },
    setInside(v) { inside = !!v; apply(true); },
    toggleMute() { muted = !muted; apply(true); return muted; },
    get muted() { return muted; }, get running() { return !!ctx && ctx.state === 'running' && on; }, get on() { return on; }, get state() { return ctx ? ctx.state : 'none'; },
    /** RMS of what is going to the speakers right now (test hook) */
    level() { if (!meter) return 0; meter.getFloatTimeDomainData(meterBuf); let s = 0; for (let i = 0; i < meterBuf.length; i++) s += meterBuf[i] * meterBuf[i]; return Math.sqrt(s / meterBuf.length); },
    /** beats since the music started (fractional). Falls back to wall-clock time when audio is unavailable. */
    beat() { return Math.max(0, (ctx && ctx.state === 'running' ? ctx.currentTime - t0 : performance.now() / 1000 - fallback0) * BPM / 60); },
    info() { const b = this.beat(), bar = Math.floor(b / 4) % 32; return { beat: b, bar, sec: sectionOf(bar), frac: b - Math.floor(b) }; },
    blip(f = 520) {
      if (!ctx || !on || muted) return;
      const t = ctx.currentTime, g = ctx.createGain(); g.connect(master); env(g, t, 0.16, 0.09); const o = osc('sine', f, t, 0.1, g); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.07);
    },
    splash() {
      if (!ctx || !on || muted) return;
      const t = ctx.currentTime, f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(180, t + 0.7);
      const g = ctx.createGain(); f.connect(g); g.connect(master); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9); nz(t, 1.0, f);
    },
  };
}
