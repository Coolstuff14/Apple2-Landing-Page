// What every object in the room says and how it reacts. Keys match blender/items_def.py (meta.items[].key).
//   mode 'instant' : acts on the first click (lights, power buttons, the computer, disks, the bed ...)
//   mode 'hover'   : description on hover only (on touch: on tap); no click action, no glow, no camera move
//   default        : first click walks up to the object; a second click runs the action named in `hint`
// Behaviour functions live in main.js (they need the scene); this file is content only.
export const ITEM_DEFS = {
  // ---- surfaces: nothing on hover, the description shows on click / tap
  wall:        { label: 'Wall', mode: 'hover', silent: true, text: 'Painted plaster, striped by the sun through the blinds.' },
  floor:       { label: 'Carpet', mode: 'hover', silent: true, text: 'Wall-to-wall carpet.' },
  ceiling:     { label: 'Ceiling', mode: 'hover', silent: true, text: 'The overhead light is off.' },
  // ---- hover description only
  ceiling_lamp:{ label: 'Ceiling light', mode: 'hover', text: 'Switched off. Nobody uses the big light at this hour.' },
  rug:         { label: 'Rug', mode: 'hover', text: 'Plaid rug in front of the dresser.' },
  door:        { label: 'Door', mode: 'hover', text: 'The bedroom door. It stays shut.' },
  cabinet:     { label: 'Filing cabinet', mode: 'hover', text: 'Three steel drawers of manuals and warranty cards.' },
  sticker_ok:  { label: 'Sticker', mode: 'hover', text: 'An oval “NH” sticker. New Hampshire.' },
  sticker_ski: { label: 'Sticker', mode: 'hover', text: 'A flag sticker with SKI across the bottom.' },
  tape:        { label: 'Cassette case', mode: 'hover', text: 'An unlabelled cassette in its case.' },
  desk:        { label: 'Desk', mode: 'hover', text: 'Wooden desk with a pedestal shelf on the right.' },
  console:     { label: 'Beige box', mode: 'hover', text: 'Parked on the pedestal shelf, cables unplugged.' },
  manuals:     { label: 'Manuals', mode: 'hover', text: 'A short stack nobody has opened twice.' },
  cables:      { label: 'Power strip', mode: 'hover', text: 'Power strip and the cable nest behind the desk.' },
  box:         { label: 'Cardboard box', mode: 'hover', text: 'The box the computer came in, kept just in case.' },
  mousepad:    { label: 'Mouse pad', mode: 'hover', text: 'Navy foam mouse pad.' },
  shelf_box:   { label: 'Box', mode: 'hover', text: 'A cardboard box on the top shelf.' },
  bookshelf:   { label: 'Bookshelf', mode: 'hover', nohl: true, text: 'Tall wooden bookshelf with cupboard doors below.' },
  corkboard:   { label: 'Cork board', mode: 'hover', nohl: true, text: 'Photos and notes, pinned up over the years.' },
  poster2:     { label: 'Poster', mode: 'hover', text: 'The same mountain, larger.' },
  dresser:     { label: 'Dresser', mode: 'hover', text: 'Three drawers, and thirty gallons of water on top.' },
  chair:       { label: 'Chair', mode: 'hover', text: 'The desk chair, pushed out of the way.' },
  outside:     { label: 'Outside', mode: 'hover', text: 'Trees in the last light of the afternoon.' },
  speakers:    { label: 'PC speakers', mode: 'instant', verb: 'Click to mute or unmute' },
  // ---- act on click
  blinds:      { label: 'Blinds', mode: 'instant', verb: 'Click to open or close' },
  window:      { label: 'Window', mode: 'instant', verb: 'Click to change the time of day' },
  bed:         { label: 'Bed', mode: 'instant', key2: 'bed' },
  duvet:       { label: 'Bed', mode: 'instant', key2: 'bed' },
  pillow:      { label: 'Bed', mode: 'instant', key2: 'bed' },
  stereo:      { label: 'Stereo', mode: 'instant' },
  plant:       { label: 'Pothos', mode: 'instant' },
  mon_power:   { label: 'Monitor power', mode: 'instant', verb: 'Click to switch' },
  monitor:     { label: 'Monitor', mode: 'instant', verb: 'Click to use the computer' },
  keyboard:    { label: 'Keyboard', mode: 'instant', verb: 'Click to use the computer' },
  mouse:       { label: 'Mouse', mode: 'instant', verb: 'Click to use the computer' },
  pc_power:    { label: 'PC power', mode: 'instant', verb: 'Click to switch' },
  pc_reset:    { label: 'Reset button', mode: 'instant', verb: 'Click to restart the computer' },
  lamp:        { label: 'Desk lamp', mode: 'instant', verb: 'Click to switch' },
  lava:        { label: 'Lava lamp', mode: 'instant', verb: 'Click to switch' },
  notebook:    { label: 'Notebook', mode: 'instant', verb: 'Click to write in it' },
  pen:         { label: 'Pencil', mode: 'instant', verb: 'Click to write in the notebook' },
  floppy:      { label: 'Floppy drive', mode: 'instant' },
  cdrom:       { label: 'CD-ROM drive', mode: 'instant' },
  cds:         { label: 'CD', mode: 'instant' },
  disks:       { label: 'Floppy disk', mode: 'instant' },
  tank_hood:   { label: 'Aquarium hood', mode: 'instant', verb: 'Click to change the light' },
  tank_sw_day: { label: 'Daylight tube', mode: 'instant', verb: 'Click to switch' },
  tank_sw_blue:{ label: 'Blue tube', mode: 'instant', verb: 'Click to switch' },
  tank_pump:   { label: 'Air pump', mode: 'instant', verb: 'Click to switch the bubbles' },
  tank_food:   { label: 'Fish food', mode: 'instant', verb: 'Click to feed the fish' },
  fish:        { label: 'Fish', mode: 'instant', verb: 'Click to swim as this fish' },
  // ---- walk up on the first click, act on the second
  aquarium:    { label: 'Aquarium', text: 'Thirty gallons: neon tetras, platies, danios, an angelfish, two corys and a pleco.', hint: 'Click a fish to swim as that fish' },
  car:         { label: 'Model car', text: 'A 2004 rally sedan in blue and gold, parked on the monitor.' },
  globe:       { label: 'Desk globe', text: 'A small globe on a brass stand.', hint: 'Click again to spin it' },
  tower:       { label: 'Tower', text: 'Mini-tower PC. The buttons and both drives work.' },
  zip_drive:   { label: 'External drive', text: 'External disk drive beside the tower.', hint: 'Click again to browse My Computer' },
  mug:         { label: 'Mug', text: 'Still half full.' },
  books:       { label: 'Book', view: 'bookshelf', text: 'Manuals, games and field guides.', hint: 'Click a spine again for the shelf index' },
  pin_note:    { label: 'Pinned note', view: 'corkboard', perSub: true, text: 'A handwritten note.', hint: 'Click again to read it in Notepad' },
  pin_photo:   { label: 'Photo', view: 'corkboard', perSub: true, text: 'A print pinned to the board.' },
  calendar:    { label: 'Calendar', text: 'Wall calendar, 1998.', hint: 'Click again to turn the page' },
  poster:      { label: 'Poster', text: 'A mountain print, slightly sun-faded.' },
};

// Regions of the stereo's front panel in texture pixels (768 x 480, origin top-left), see tools/gen_textures.py.
export function stereoRegion(px, py) {
  if (Math.hypot(px - 105, py - 115) < 70) return 'volume';
  if (Math.hypot(px - 665, py - 115) < 60) return 'next';
  if (px > 205 && px < 565 && py > 55 && py < 175) return 'toggle';
  if (py > 200 && py < 246) {
    if (px >= 36 && px < 408) return ['prev', 'play', 'stop', 'next', 'quieter', 'louder'][Math.min(5, Math.floor((px - 36) / 62))];
    if (px >= 426 && px < 736) { const i = Math.min(4, Math.floor((px - 426) / 62)); return i < 4 ? `track${i}` : 'stop'; }
  }
  return 'toggle';
}
export const STEREO_LABEL = { volume: 'volume knob', next: 'next track', prev: 'previous track', play: 'play', stop: 'stop', quieter: 'quieter', louder: 'louder', toggle: 'play / stop' };

// KeyboardEvent.code -> [label on the modelled keyboard, which occurrence of that label (0 = first in layout order)]
export function keyFor(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return [m[1], 0];
  if ((m = /^Digit(\d)$/.exec(code))) return [m[1], 0];
  if ((m = /^Numpad(\d)$/.exec(code))) return [m[1], 1];
  if ((m = /^F(\d{1,2})$/.exec(code))) return ['F' + m[1], 0];
  const T = {
    Escape: ['Esc', 0], Backquote: ['`', 0], Minus: ['-', 0], Equal: ['=', 0], Backspace: ['Bksp', 0], Tab: ['Tab', 0],
    BracketLeft: ['[', 0], BracketRight: [']', 0], Backslash: ['\\', 0], CapsLock: ['Caps', 0], Semicolon: [';', 0], Quote: ["'", 0],
    Enter: ['Enter', 0], NumpadEnter: ['Enter', 1], ShiftLeft: ['Shift', 0], ShiftRight: ['Shift', 1], Comma: [',', 0], Period: ['.', 0],
    Slash: ['/', 1], NumpadDivide: ['/', 0], ControlLeft: ['Ctrl', 0], ControlRight: ['Ctrl', 1], AltLeft: ['Alt', 0], AltRight: ['Alt', 1],
    Space: ['', 0], ArrowUp: ['Up', 0], ArrowDown: ['Down', 0], ArrowLeft: ['Left', 0], ArrowRight: ['Right', 0],
    Insert: ['Ins', 0], Home: ['Home', 0], PageUp: ['PgUp', 0], Delete: ['Del', 0], End: ['End', 0], PageDown: ['PgDn', 0],
    PrintScreen: ['PrtSc', 0], ScrollLock: ['ScrLk', 0], Pause: ['Pause', 0], NumLock: ['Num', 0], NumpadMultiply: ['*', 0],
    NumpadSubtract: ['-', 1], NumpadAdd: ['+', 0], NumpadDecimal: ['.', 1],
  };
  return T[code] || null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Draws a 1998 calendar page onto a canvas laid out like blender/tex/calendar.jpg (photo on top, grid below). */
export function drawCalendar(canvas, photo, month) {
  const W = 808, H = 1216; canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgb(236,233,224)'; g.fillRect(0, 0, W, H);
  if (photo) g.drawImage(photo, 0, 0, photo.width, photo.height * 546 / H, 0, 0, W, 546);
  g.fillStyle = 'rgb(120,116,108)'; g.fillRect(0, 545, W, 3);
  g.fillStyle = 'rgb(60,50,40)'; g.beginPath(); g.arc(W / 2, 561, 9, 0, 6.3); g.fill();
  g.fillStyle = 'rgb(46,44,60)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '62px "Times New Roman", Times, serif'; g.fillText(`${MONTHS[month].toUpperCase()}   1998`, W / 2, 612);
  const gx0 = 44, gy0 = 668, gx1 = W - 44, gy1 = H - 50, cw = (gx1 - gx0) / 7;
  const first = new Date(1998, month, 1).getDay(), days = new Date(1998, month + 1, 0).getDate();
  const rows = Math.ceil((first + days) / 7), gy = gy0 + 30, ch = (gy1 - gy0 - 30) / rows;
  g.font = '17px Arial, Helvetica, sans-serif'; g.fillStyle = 'rgb(70,70,80)';
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].forEach((d, i) => g.fillText(d, gx0 + cw * (i + 0.5), gy0 + 14));
  g.strokeStyle = 'rgb(60,60,70)'; g.lineWidth = 2; g.beginPath();
  for (let r = 0; r <= rows; r++) { g.moveTo(gx0, gy + r * ch); g.lineTo(gx1, gy + r * ch); }
  for (let c = 0; c <= 7; c++) { g.moveTo(gx0 + c * cw, gy); g.lineTo(gx0 + c * cw, gy + rows * ch); }
  g.stroke();
  g.font = 'bold 24px Arial, Helvetica, sans-serif'; g.fillStyle = 'rgb(40,40,52)'; g.textAlign = 'left'; g.textBaseline = 'top';
  for (let d = 1; d <= days; d++) { const i = d - 1 + first; g.fillText(String(d), gx0 + (i % 7) * cw + 9, gy + Math.floor(i / 7) * ch + 6); }
  return MONTHS[month];
}
