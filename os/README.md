# Summit 98 (site/os)

A late-90s desktop UI as plain ES modules: no build step, no dependencies, no network resources.
It renders a fixed 640x480 DOM tree and works under CSS scale / 3D transforms (pointer math uses
only `offsetX/offsetY` and layout offsets; see `pointer.js`).

```js
import { createOS, getAudio, APP_IDS } from './os/os.js';   // plus <link rel="stylesheet" href="os/os.css">
const os = createOS(rootEl /* 640x480, relative, overflow hidden */, bridge, { skipBoot: false });
```

## API
- `createOS(rootEl, bridge, options)` returns
  - `open(appId, args?)` -> boolean (false for an unknown id; queued until the desktop is up), `closeAll()`;
    args: notepad `{ name, content }`, explorer `{ path: ['A:'] }`, player `{ track, play }`
  - `setPower(on)`, `isOn()`, `getAverageColor()` -> `[r,g,b]` 0..1 (black when off / booting / screensaver)
  - `on(evt, cb)` -> unsubscribe; events `'power'(on)`, `'screencolor'([r,g,b])`, `'sound'(playing, {track, title})`
  - `mountDisk('A:' | 'D:', { label, files: [{ name, content | picture | track }] } | null)` fills or empties a removable drive
  - extras: `getState()` (`off|boot|on|halt`), `apps`, `destroy()`, `getScreensaver()` / `setScreensaver({ id, wait })`
    (ids `flowerbox objects maze pipes text3d blank curves stars windows mystify marquee none`, default `pipes`; chosen in
    Start > Settings > Screen Saver, stored in localStorage), `screensavers` (id + name), `previewScreensaver(id)`,
    `screensaverInfo()`
- `options`: `skipBoot`, `autoOpen: string[]` (omitted = Welcome window, `[]` = nothing);
  extras `screensaverMs` (default 90000), `power: false` (start switched off).
- `bridge`: `getRoomState()`, `setRoom(key, value)`, `onRoomChange(cb)`, `exitFocus()` (all guarded).
- `getAudio()` (module level, valid before/after `createOS`): `play(trackIndex?)`, `stop()`, `isPlaying()`,
  `setVolume(v)`, `analyser` (getter: creates the AudioContext on first read; `null` without WebAudio);
  extras `pause() next() prev() getVolume() trackIndex tracks onChange(cb) unlock()`.
- App ids: `notepad paint explorer terminal player game room about welcome datetime run shutdown display`.

## Files and testing
`os.js` entry/power · `wm.js` · `shell.js` · `menus.js` · `ui.js` · `pointer.js` · `audio.js` · `fs.js` · `icons.js` ·
`boot.js` · `screensaver.js` (registry + 2D savers) · `savers3d.js` · `saver-gl.js` (the one shared WebGL context) · `dom.js` · `apps/*.js` · `os.css` (every rule under `.os98`).
`standalone.html` mounts the OS with a logging mock bridge. Params: `scale=2`, `skew=1`, `skipBoot=1`,
`open=notepad,paint`, `saver=<ms>`, `demo=start`, `selftest=1` (`selftest.js`: synthetic-input PASS/FAIL list).
