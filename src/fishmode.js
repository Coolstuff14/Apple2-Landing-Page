// Being a fish. Click a fish in the aquarium and the camera dives in behind it; from then on the pointer steers
// (or the arrow keys / WASD; on touch, drag), holding the button or Space swims fast. Swimming into the passage
// under the rock pile changes the scene to the party (rave.js); its exit brings you back out in front of the rock.
// The same camera and the same controller serve both places; only the "world" (collision + player record) differs.
import * as THREE from 'three';
import { SPECIES } from './fishkit.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (f) => (f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2);
const FOV = 62, NEAR = 0.004, CRUISE = 0.085, FAST = 0.24;

export function createFishMode({ camera, canvas, aq, audio, makeRave, roomFov, tankView, hooks, reduceMotion = false, still = false }) {
  const fadeEl = document.getElementById('fade');
  const fm = { on: false, where: 'tank', phase: 'idle', inside: false, beat: null, rave: null, hideCss: false };
  let me = null;                               // the record being steered: a tank fish or the rave's player
  let yaw = 0, pitch = 0, t = 0, from = null, to = null, nearRoom = camera.near, hinted = false, swum = 0;
  const steer = new THREE.Vector2(), keys = new Set();
  const ptr = { x: 0, y: 0, has: false, down: false, touch: false, ox: 0, oy: 0 };
  const dir = new THREE.Vector3(), camWant = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3(), mouthAt = new THREE.Vector3();
  const world = () => (fm.where === 'rave' ? fm.rave : aq);

  // ---- input (listeners stay installed; they only act while the mode is on)
  const live = () => fm.on && fm.phase === 'swim';
  window.addEventListener('pointermove', (e) => { if (!fm.on) return; ptr.x = e.clientX; ptr.y = e.clientY; ptr.has = true; ptr.touch = e.pointerType === 'touch'; }, true);
  canvas.addEventListener('pointerdown', (e) => { if (!fm.on) return; ptr.down = true; ptr.ox = ptr.x = e.clientX; ptr.oy = ptr.y = e.clientY; ptr.has = true; ptr.touch = e.pointerType === 'touch'; });
  window.addEventListener('pointerup', () => { ptr.down = false; if (ptr.touch) ptr.has = false; });
  canvas.addEventListener('pointerleave', () => { if (!ptr.down) ptr.has = false; });
  window.addEventListener('blur', () => { keys.clear(); ptr.down = false; ptr.has = false; });
  const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'ShiftLeft', 'ShiftRight'];
  window.addEventListener('keydown', (e) => {
    if (!fm.on) return;
    if (KEYS.includes(e.code)) { keys.add(e.code); e.preventDefault(); }
    if (e.code === 'KeyM' && !e.repeat) hooks.say('Sound', audio.toggleMute() ? 'Muted.' : 'On.', '', 'fish', 1800);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  function readInput(dt) {
    let x = 0, y = 0;
    if (ptr.has && !ptr.touch) {                 // mouse: where the pointer sits relative to the middle of the view
      const s = Math.min(window.innerWidth, window.innerHeight) * 0.42;
      x = (ptr.x - window.innerWidth / 2) / s; y = (ptr.y - window.innerHeight / 2) / s;
    } else if (ptr.down && ptr.touch) { x = (ptr.x - ptr.ox) / 70; y = (ptr.y - ptr.oy) / 70; }       // touch: a thumb-stick wherever the finger landed
    const l = Math.hypot(x, y), dead = 0.10;
    if (l < dead) { x = 0; y = 0; } else { const k = Math.min(1, (l - dead) / (1 - dead)) / l; x *= k; y *= k; }
    if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1; if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) y -= 1; if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;
    steer.lerp(tmp.set(clamp(x, -1, 1), clamp(y, -1, 1), 0), Math.min(1, dt * 9));
    return ptr.down || keys.has('Space') || keys.has('ShiftLeft') || keys.has('ShiftRight');
  }

  function chase(dt, snap = false) {
    const back = 0.022 + me.size * 1.5;
    camWant.copy(me.pos).addScaledVector(me.dir, -back); camWant.y += back * 0.36;
    world().constrain(camWant, 0.008, true);
    if (snap) camera.position.copy(camWant); else camera.position.lerp(camWant, 1 - Math.exp(-dt * 7));
    look.copy(me.pos).addScaledVector(me.dir, me.size * 1.3); look.y += me.size * 0.12;
    camera.up.set(0, 1, 0); camera.lookAt(look);
  }
  /** Through black: `mid` swaps the scene while nothing is visible. Whatever happens in it, the screen comes back. */
  function fade(ms, mid, done) {
    const run = () => { try { mid(); return true; } catch (e) { console.error(e); return false; } };
    const after = (ok) => { if (ok) { done && done(); } else if (fm.on && fm.phase === 'fade') fm.phase = 'swim'; };
    if (!fadeEl || still) { fm.phase = 'fade'; after(run()); return; }
    fm.phase = 'fade'; fadeEl.style.transitionDuration = ms + 'ms'; fadeEl.classList.add('on');
    setTimeout(() => { const ok = run(); requestAnimationFrame(() => { fadeEl.classList.remove('on'); setTimeout(() => after(ok), ms * 0.6); }); }, ms + 30);
  }
  /** Put the tank fish just outside the rock pile, heading away from it (leaving the party by either route). */
  function surfaceAtRock() {
    fm.where = 'tank'; me = fm.tankFish; audio.setInside(false);
    me.pos.copy(aq.cave.mouth); me.pos.z += 0.035;
    yaw = Math.PI / 2; pitch = 0.1; setDir(); me.dir.copy(dir); aq.constrain(me.pos, Math.max(0.010, me.size * 0.28)); chase(0, true);
  }
  const setDir = () => { dir.set(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)); return dir; };
  const takeHeading = (d) => { yaw = Math.atan2(d.z, d.x); pitch = Math.asin(clamp(d.y, -0.95, 0.95)); };

  /** Become fish number `index` of the aquarium. Must be called from a user gesture (it starts the sound). */
  fm.enter = (index) => {
    if (fm.on || !aq.fishes[index]) return false;
    me = fm.tankFish = aq.fishes[index]; me.mode = 'swim'; aq.setPlayer(me); takeHeading(me.dir); pitch *= 0.3;
    fm.on = true; fm.where = 'tank'; fm.phase = 'dive'; t = 0; swum = 0; hinted = false;
    from = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
    nearRoom = camera.near; camera.near = NEAR; camera.updateProjectionMatrix();
    aq.rave.glow = 1.0; audio.start(); audio.splash();
    hooks.onEnter();
    return true;
  };
  /** Back to the room, from wherever you are. */
  fm.exit = () => {
    if (!fm.on || fm.phase === 'surface' || fm.phase === 'fade') return;
    const go = () => {
      fm.where = 'tank'; fm.hideCss = false; hooks.onSurface(); audio.setInside(false);
      fm.phase = 'surface'; t = 0; to = tankView();
      from = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
    };
    if (fm.where === 'rave') fade(300, () => { surfaceAtRock(); go(); }, () => {}); else go();
  };
  function finish() {
    fm.on = false; fm.phase = 'idle'; fm.inside = false; fm.beat = null;
    if (fm.tankFish) aq.release(fm.tankFish); aq.setPlayer(null); me = null; fm.tankFish = null;
    aq.rave.glow = 0.35; audio.stop();
    camera.near = nearRoom; camera.fov = roomFov(); camera.updateProjectionMatrix();
    hooks.onExit(to);
  }
  function goRave() {
    const kind = me.kind, size = me.size;
    fade(320, () => {
      fm.rave.enter(kind, size); fm.where = 'rave';
      me = fm.rave.player; yaw = fm.rave.spawn.yaw; pitch = 0; setDir(); me.dir.copy(dir); audio.setInside(true); chase(0, true);
      hooks.say('The Gravel Pit', 'So that is where the thumping came from.', 'Swim back through the EXIT to leave', 'fish', 6000);
    }, () => { fm.phase = 'swim'; });
  }
  function leaveRave() {
    fade(320, surfaceAtRock, () => { fm.phase = 'swim'; });
  }

  fm.update = (dt) => {
    if (!fm.on) return;
    const info = audio.info(); fm.beat = info.beat;
    if (fm.where === 'rave' && fm.rave) fm.rave.update(dt, info, camera, canvas.height);
    const inTank = fm.where === 'tank';
    fm.inside = inTank && camera.position.x > aq.lo.x && camera.position.x < aq.hi.x && camera.position.z > aq.lo.z && camera.position.z < aq.hi.z && camera.position.y < aq.hi.y + 0.03;
    if (fm.phase === 'dive' || fm.phase === 'surface') {
      t += dt / (reduceMotion || still ? 0.01 : fm.phase === 'dive' ? 1.7 : 1.3);
      const e = ease(clamp(t, 0, 1));
      if (fm.phase === 'dive') {
        me.speed += (CRUISE * 0.5 - me.speed) * Math.min(1, dt * 3); me.pos.addScaledVector(me.dir, me.speed * dt); aq.constrain(me.pos, me.size * 0.3);
        chase(0, true); camWant.copy(camera.position); const q = camera.quaternion.clone();
        camera.position.lerpVectors(from.pos, camWant, e); camera.quaternion.slerpQuaternions(from.quat, q, e); camera.fov = from.fov + (FOV - from.fov) * e;
        if (t >= 1) { fm.phase = 'swim'; fm.hideCss = true; hooks.onSwim(); }
      } else {
        tmp.copy(to.target); const m = new THREE.Matrix4().lookAt(to.pos, tmp, camera.up), q = new THREE.Quaternion().setFromRotationMatrix(m);
        camera.position.lerpVectors(from.pos, to.pos, e); camera.quaternion.slerpQuaternions(from.quat, q, e); camera.fov = from.fov + (roomFov() - from.fov) * e;
        if (t >= 1) { finish(); return; }
      }
      camera.updateProjectionMatrix();
      return;
    }
    if (fm.phase !== 'swim') return;
    const fast = readInput(dt), w = world();
    yaw += steer.x * 2.5 * dt; pitch = clamp(pitch - steer.y * 1.7 * dt, -1.05, 1.05);
    if (Math.abs(steer.y) < 0.05) pitch *= Math.exp(-dt * 0.7);                       // level out when left alone
    setDir();
    me.speed += ((fast ? FAST : CRUISE) - me.speed) * Math.min(1, dt * (fast ? 4 : 2));
    me.dir.copy(dir); me.pos.addScaledVector(dir, me.speed * dt); swum += me.speed * dt;
    const rad = Math.max(0.010, me.size * 0.28);
    w.constrain(me.pos, rad);
    me.bend += (clamp(-steer.x * 0.22, -0.3, 0.3) - me.bend) * Math.min(1, dt * 6);
    me.roll += (steer.x * 0.45 - me.roll) * Math.min(1, dt * 5);
    if (!inTank) me.phase += dt * (5 + me.speed * 105);
    chase(dt);
    if (camera.fov !== FOV) { camera.fov = FOV; camera.updateProjectionMatrix(); }
    if (inTank) {
      mouthAt.copy(me.pos).addScaledVector(dir, me.size * 0.45);
      if (aq.eatNear(mouthAt, 0.013 + me.size * 0.15)) { audio.blip(480 + Math.random() * 200); hooks.say(SPECIES[me.kind].name, 'A flake. Not bad.', '', 'fish', 1600); }
      const d = me.pos.distanceTo(aq.cave.mouth);
      audio.setProximity(1 - d / 0.55);
      if (!hinted && swum > 0.25 && d < 0.30) { hinted = true; hooks.say('Something is thumping', 'It comes from under the rock pile, behind the tall grass.', '', 'fish', 5200); }
      if (me.pos.distanceToSquared(aq.cave.inside) < (aq.cave.r + 0.006) ** 2) {
        fm.rave ||= makeRave();                  // null until rave.js has arrived: until then the passage is just a dead end
        if (fm.rave) goRave();
      }
    } else if (w.atExit(me.pos)) leaveRave();
  };
  /** test hook: put the swimmer somewhere (three.js coordinates) */
  fm.warp = (x, y, z, heading) => { if (!me) return; me.pos.set(x, y, z); if (heading !== undefined) { yaw = heading; pitch = 0; setDir(); me.dir.copy(dir); } chase(0, true); };
  fm.steer = (x, y, fast = false) => { ptr.has = false; keys.clear(); if (x < 0) keys.add('KeyA'); if (x > 0) keys.add('KeyD'); if (y < 0) keys.add('KeyW'); if (y > 0) keys.add('KeyS'); if (fast) keys.add('Space'); };
  Object.defineProperty(fm, 'me', { get: () => me });
  Object.defineProperty(fm, 'heading', { get: () => ({ yaw, pitch }) });
  return fm;
}
