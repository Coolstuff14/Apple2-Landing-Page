// In-memory fake filesystem. User files written by Notepad are persisted in
// localStorage (best effort; everything keeps working if storage throws).
// All sample contents are flavour text or clearly marked placeholders.

import { store } from './dom.js';

const KEY = 'summit98.files.v1';
const SAVE_DIR = ['C:', 'My Documents'];

const dir = (name, children) => ({ name, type: 'dir', children });
const txt = (name, content) => ({ name, type: 'file', content });
const bmp = (name, picture) => ({ name, type: 'file', picture });
const snd = (name, track) => ({ name, type: 'file', track });

const PLACEHOLDER = what => `[placeholder — ${what}]\r\n\r\nThis file ships empty on purpose.\r\nReplace it with your own words.`;

function buildTree() {
  return [
    {
      name: 'C:', label: 'Summit (C:)', type: 'dir', kind: 'drive', children: [
        dir('My Documents', [
          txt('readme.txt',
            'Welcome to Summit 98\r\n====================\r\n\r\nThis is a pretend computer living on a desk in 1998.\r\n\r\n' +
            ' * Double-click things. Most of them open.\r\n * Notepad can save here, in My Documents.\r\n' +
            ' * Room Control (Start > Settings) flips the lamp.\r\n * jakelee.info is on the desktop.\r\n\r\nNothing you do here can break anything.'),
          txt('todo.txt', PLACEHOLDER('add your to-do list here')),
        ]),
        dir('Projects', [
          txt('projects.txt', PLACEHOLDER('add your projects here')),
          bmp('sketch.bmp', 'grid'),
        ]),
        dir('Travel', [
          txt('trip-notes.txt', PLACEHOLDER('add your travel notes here')),
          bmp('postcard.bmp', 'mountain'),
          bmp('sunset.bmp', 'sunset'),
        ]),
        dir('Notes', [
          txt('notes.txt', PLACEHOLDER('add your notes here')),
        ]),
        dir('Music', [
          snd('Summit Sunrise.mid', 0),
          snd('Powder Day.mid', 1),
          snd('Lava Lamp Lounge.mid', 2),
          snd('Dial-Up Dreams.mid', 3),
        ]),
      ],
    },
    {
      name: 'A:', label: '3½ Floppy (A:)', type: 'dir', kind: 'floppy', children: [
        txt('label.txt', PLACEHOLDER('a floppy disk with nothing on it yet')),
      ],
    },
    {
      name: 'D:', label: 'Summit98 (D:)', type: 'dir', kind: 'cdrom', readonly: true, children: [
        txt('README.TXT',
          'SUMMIT 98 COMPANION DISC\r\n\r\nSummit 98 is a tribute user interface built for fun.\r\nIt is not affiliated with Microsoft or any other company.\r\n\r\nSee \\AUDIO for sample sounds and \\ART for pictures.'),
        dir('AUDIO', [snd('SUNRISE.WAV', 0), snd('LOUNGE.WAV', 2)]),
        dir('ART', [bmp('PEAKS.BMP', 'mountain'), bmp('DUSK.BMP', 'sunset')]),
      ],
    },
  ];
}

export function createFS() {
  const drives = buildTree();
  const saved = store.get(KEY, {});

  const find = (list, name) => list.find(n => n.name.toLowerCase() === String(name).toLowerCase());

  function node(path) {
    if (!path.length) return { name: 'My Computer', type: 'dir', children: drives };
    let cur = find(drives, path[0]);
    for (let i = 1; cur && i < path.length; i++) cur = cur.type === 'dir' ? find(cur.children, path[i]) : null;
    return cur || null;
  }

  // merge persisted user files into the save directory
  const saveDir = node(SAVE_DIR);
  if (saved && typeof saved === 'object') {
    for (const name of Object.keys(saved)) {
      if (typeof saved[name] !== 'string') continue;
      const existing = find(saveDir.children, name);
      if (existing) existing.content = saved[name];
      else saveDir.children.push({ name, type: 'file', content: saved[name], user: true });
    }
  }

  const ext = name => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();

  return {
    SAVE_DIR,
    ext,
    node,
    /** Children of a directory path (array of names), [] if missing. */
    list(path) {
      const n = node(path);
      return n && n.type === 'dir' ? n.children : [];
    },
    /**
     * Put a disk in a removable drive, or take it out (disk = null).
     * disk: { label, files: [{ name, content? , picture?, track? }] }
     */
    mount(drive, disk) {
      const d = find(drives, drive);
      if (!d || !['floppy', 'cdrom'].includes(d.kind)) return false;
      if (!disk) { d.label = d.kind === 'floppy' ? '3½ Floppy (A:)' : 'CD-ROM (D:)'; d.children = []; return true; }
      d.label = `${disk.label} (${d.name})`;
      d.children = (disk.files || []).map(f => ({ name: f.name, type: 'file', content: f.content, picture: f.picture, track: f.track }));
      return true;
    },
    pathString(path) {
      if (!path.length) return 'My Computer';
      return path[0] + '\\' + path.slice(1).join('\\');
    },
    /** Every file with one of the given extensions: [{ path, node }]. */
    findAll(exts) {
      const out = [];
      const walk = (n, p) => {
        if (n.type === 'dir') n.children.forEach(c => walk(c, [...p, c.name]));
        else if (exts.includes(ext(n.name))) out.push({ path: p, node: n });
      };
      drives.forEach(d => walk(d, [d.name]));
      return out;
    },
    /** Save a text file into C:\My Documents. Returns its path. */
    saveText(name, content) {
      let clean = String(name).trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'untitled';
      if (!/\.[a-z0-9]+$/i.test(clean)) clean += '.txt';
      const existing = find(saveDir.children, clean);
      if (existing) { existing.content = content; clean = existing.name; }
      else saveDir.children.push({ name: clean, type: 'file', content, user: true });
      saved[clean] = content;
      store.set(KEY, saved);
      return [...SAVE_DIR, clean];
    },
  };
}
