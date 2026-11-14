// Standalone-only self test (loaded by standalone.html?selftest=1). It drives the OS
// with synthetic pointer/keyboard events. Client coordinates for those events are
// derived from a 1x1 probe element placed at a logical position inside the OS tree, so
// the test is valid under any CSS transform on the mount box. (getBoundingClientRect is
// used HERE ONLY, to aim synthetic events; the OS itself never uses it.)

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function runSelfTest({ os, mount, getAudio, calls, hostSet, out }) {
  const screen = mount.querySelector('.os98');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    const line = document.createElement('div');
    line.className = ok ? 'pass' : 'fail';
    line.textContent = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`;
    out.appendChild(line);
  };

  /** Client coordinates of logical point (x, y) inside `parent`'s padding box. */
  function clientPoint(x, y, parent = screen) {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:1px;height:1px;pointer-events:none;margin:0`;
    parent.appendChild(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  /** Logical screen position of an element-local point (layout offsets, test copy). */
  function logicalOf(el, lx = 0, ly = 0) {
    let x = lx + el.clientLeft, y = ly + el.clientTop, n = el;
    while (n && n !== screen) {
      x += n.offsetLeft; y += n.offsetTop;
      let p = n.parentNode;
      const op = n.offsetParent;
      while (p && p !== screen) { x -= p.scrollLeft; y -= p.scrollTop; if (p === op) break; p = p.parentNode; }
      if (!op || op === screen) break;
      x += op.clientLeft; y += op.clientTop;
      n = op;
    }
    return { x, y };
  }
  function fire(type, x, y, opts = {}) {
    const c = clientPoint(x, y);
    const target = opts.target || document.elementFromPoint(c.x, c.y);
    if (!target) throw new Error(`no element at logical ${x},${y}`);
    const ev = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: c.x, clientY: c.y, pointerId: 1, pointerType: opts.pointerType || 'mouse', isPrimary: true,
      button: type === 'pointermove' ? -1 : (opts.button || 0),
      buttons: type === 'pointerup' ? 0 : (opts.buttons ?? 1),
    });
    target.dispatchEvent(ev);
    return target;
  }
  async function dragLogical(x0, y0, x1, y1, steps = 6, opts = {}) {
    fire('pointerdown', x0, y0, opts);
    for (let i = 1; i <= steps; i++) fire('pointermove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, opts);
    fire('pointerup', x1, y1, opts);
    await sleep(20);
  }
  const tap = async (x, y, opts) => { fire('pointerdown', x, y, opts); fire('pointerup', x, y, opts); const c = clientPoint(x, y); document.elementFromPoint(c.x, c.y)?.click(); await sleep(20); };
  const dbl = async (x, y) => { fire('pointerdown', x, y); fire('pointerup', x, y); fire('pointerdown', x, y); fire('pointerup', x, y); await sleep(30); };
  const centre = el => { const p = logicalOf(el); return { x: p.x + el.clientWidth / 2, y: p.y + el.clientHeight / 2 }; };
  const key = (target, k, extra = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  const rect = el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) });
  const winOf = id => screen.querySelector(`.os-win[data-app="${id}"]`);
  const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

  try {
    // 0. wait for desktop
    for (let i = 0; i < 100 && os.getState() !== 'on'; i++) await sleep(50);
    check('desktop is up', os.getState() === 'on' && os.isOn());
    os.closeAll();

    // 1. harness sanity: capture-layer offsetX/Y must equal the logical point
    {
      const layer = screen.querySelector('.os-capture');
      layer.style.display = 'block';
      let got = null;
      const fn = e => { got = { x: e.offsetX, y: e.offsetY }; };
      layer.addEventListener('pointermove', fn);
      fire('pointermove', 123, 77);
      const a = got;
      fire('pointermove', 600.5, 440.25);
      const b = got;
      layer.removeEventListener('pointermove', fn);
      layer.style.display = 'none';
      check('harness: capture layer offsetX/Y == logical point', a && b && near(a.x, 123, 0.75) && near(a.y, 77, 0.75) && near(b.x, 600.5, 0.75) && near(b.y, 440.25, 0.75),
        JSON.stringify([a, b]));
    }

    // 2. open / taskbar
    os.open('notepad');
    await sleep(30);
    let np = winOf('notepad');
    check('open(notepad) creates a window + task button', !!np && !!screen.querySelector('.os-task'));

    // 3. drag by title bar
    {
      const r0 = rect(np);
      await dragLogical(r0.x + 70, r0.y + 11, r0.x + 70 + 113, r0.y + 11 + 57);
      const r1 = rect(np);
      check('drag window by title bar tracks exactly', near(r1.x - r0.x, 113) && near(r1.y - r0.y, 57), `moved ${r1.x - r0.x},${r1.y - r0.y} (want 113,57)`);
      // touch drag (implicit capture released)
      await dragLogical(r1.x + 70, r1.y + 11, r1.x + 30, r1.y - 9, 5, { pointerType: 'touch' });
      const r2 = rect(np);
      check('touch drag works', near(r2.x - r1.x, -40) && near(r2.y - r1.y, -20), `moved ${r2.x - r1.x},${r2.y - r1.y} (want -40,-20)`);
      // clamp: cannot lose the title bar
      await dragLogical(r2.x + 70, r2.y + 11, r2.x + 70, 479);
      const r3 = rect(np);
      check('window clamped so title bar stays reachable', r3.y <= 452 - 18, `y=${r3.y}`);
      await dragLogical(r3.x + 70, r3.y + 11, 200, 60);
    }

    // 4. resize from SE corner and W edge
    {
      const r0 = rect(np);
      await dragLogical(r0.x + r0.w - 3, r0.y + r0.h - 3, r0.x + r0.w - 3 + 41, r0.y + r0.h - 3 + 29);
      const r1 = rect(np);
      check('resize from SE corner tracks exactly', near(r1.w - r0.w, 41) && near(r1.h - r0.h, 29), `grew ${r1.w - r0.w},${r1.h - r0.h} (want 41,29)`);
      await dragLogical(r1.x + 1, r1.y + r1.h / 2, r1.x + 1 - 30, r1.y + r1.h / 2);
      const r2 = rect(np);
      check('resize from W edge keeps right edge fixed', near(r2.x - r1.x, -30) && near(r2.w - r1.w, 30), `x ${r2.x - r1.x}, w ${r2.w - r1.w}`);
      await dragLogical(r2.x + r2.w - 3, r2.y + r2.h - 3, r2.x + 10, r2.y + 10);
      const r3 = rect(np);
      check('resize respects minimum size', r3.w >= 140 && r3.h >= 80, `${r3.w}x${r3.h}`);
      await dragLogical(r3.x + r3.w - 3, r3.y + r3.h - 3, r3.x + 300, r3.y + 220);
    }

    // 5. maximize by double pointerdown on title; restore
    {
      const r0 = rect(np);
      await dbl(r0.x + 80, r0.y + 11);
      const m = rect(np);
      check('double-click title maximizes to work area', np.classList.contains('max') && m.x === 0 && m.y === 0 && m.w === 640 && m.h === 452, JSON.stringify(m));
      await sleep(500);
      await dbl(120, 9);
      const r1 = rect(np);
      check('double-click again restores', !np.classList.contains('max') && r1.w === r0.w && r1.x === r0.x, JSON.stringify(r1));
      await sleep(500);
    }

    // 6. minimize / taskbar toggle / close
    {
      np.querySelector('.os-tb-min').click();
      await sleep(20);
      check('minimize hides window', np.style.display === 'none');
      const task = screen.querySelector('.os-task');
      const c = centre(task);
      await tap(c.x, c.y);
      check('task button restores window', np.style.display !== 'none' && np.classList.contains('active'));
      const c2 = centre(screen.querySelector('.os-task'));
      await tap(c2.x, c2.y);
      check('task button minimizes active window', np.style.display === 'none');
      const c3 = centre(screen.querySelector('.os-task'));
      await tap(c3.x, c3.y);
      // z-order
      os.open('about');
      await sleep(30);
      const ab = winOf('about');
      check('new window is on top + active', Number(ab.style.zIndex) > Number(np.style.zIndex) && ab.classList.contains('active') && !np.classList.contains('active'));
      const r = rect(np);
      fire('pointerdown', r.x + 6, r.y + 30); fire('pointerup', r.x + 6, r.y + 30);
      await sleep(20);
      const hit = document.elementFromPoint(clientPoint(r.x + 6, r.y + 30).x, clientPoint(r.x + 6, r.y + 30).y);
      check('click raises a window', np.contains(hit) ? Number(np.style.zIndex) > Number(ab.style.zIndex) : true);
      ab.querySelector('.os-tb-close').click();
      await sleep(20);
      check('close button removes window', !winOf('about'));
    }

    // 7. Notepad: typing, dirty star, save into fake FS, reopen via explorer
    {
      const ta = np.querySelector('textarea');
      ta.focus();
      ta.value = 'selftest line';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(20);
      const title = np.querySelector('.os-title-text').textContent;
      check('notepad marks unsaved changes with *', title.includes('*'), title);
      // File > Save -> Save As dialog
      const file = np.querySelector('.os-mb-item');
      const c = centre(file);
      fire('pointerdown', c.x, c.y); fire('pointerup', c.x, c.y);
      await sleep(20);
      const items = [...screen.querySelectorAll('.os-menu .os-menu-item')];
      check('File menu opens inside root', items.length >= 4 && mount.contains(items[0]));
      items.find(i => i.querySelector('.os-mi-label').textContent.trim() === 'Save')?.click();
      await sleep(40);
      const dlgInput = screen.querySelector('.os-win.active input.os-input');
      check('Save opens a file name dialog', !!dlgInput);
      if (dlgInput) {
        dlgInput.value = 'selftest';
        key(dlgInput, 'Enter');
        await sleep(40);
      }
      const t2 = np.querySelector('.os-title-text').textContent;
      check('saved: title shows file name, no *', /selftest\.txt/.test(t2) && !t2.includes('*'), t2);
      np.querySelector('.os-tb-close').click();
      await sleep(30);
      check('notepad closes cleanly after save', !winOf('notepad'));
    }

    // 8. Paint stroke accuracy
    {
      os.open('paint');
      await sleep(60);
      const pw = winOf('paint');
      const cv = pw.querySelector('canvas.os-paint-canvas');
      const o = logicalOf(cv);
      const px = (x, y) => [...cv.getContext('2d').getImageData(x, y, 1, 1).data];
      const isBlack = p => p[0] < 40 && p[1] < 40 && p[2] < 40 && p[3] > 200;
      const isWhite = p => p[0] > 220 && p[1] > 220 && p[2] > 220;
      await dragLogical(o.x + 20, o.y + 20, o.x + 120, o.y + 60, 20);
      check('paint pencil stroke lands on the cursor path', isBlack(px(20, 20)) && isBlack(px(70, 40)) && isBlack(px(120, 60)) && isWhite(px(70, 48)) && isWhite(px(70, 32)),
        JSON.stringify([px(20, 20), px(70, 40), px(120, 60), px(70, 48)]));
      // rectangle tool
      pw.querySelector('[data-tool="rect"]').click();
      await dragLogical(o.x + 150, o.y + 30, o.x + 200, o.y + 70, 8);
      check('paint rectangle tool', isBlack(px(150, 50)) && isBlack(px(175, 30)) && isBlack(px(200, 50)) && isWhite(px(175, 50)));
      // fill
      pw.querySelector('[data-tool="fill"]').click();
      const sw = pw.querySelector('.os-pal-sw[data-color="#ff0000"]');
      const sc = centre(sw);
      await tap(sc.x, sc.y);
      await tap(o.x + 175, o.y + 50);
      const f = px(175, 50);
      check('paint flood fill + palette', f[0] > 200 && f[1] < 60 && f[2] < 60 && isWhite(px(140, 50)), JSON.stringify(f));
      // undo
      key(pw, 'z', { ctrlKey: true });
      await sleep(20);
      check('paint undo', isWhite(px(175, 50)) && isBlack(px(150, 50)));
      check('paint window has no layout overflow', pw.querySelector('.os-win-body').scrollWidth <= pw.querySelector('.os-win-body').clientWidth + 1);
      pw.querySelector('.os-tb-close').click();
      await sleep(40);
      // unsaved-drawing prompt may appear; dismiss by choosing No
      [...screen.querySelectorAll('.os-win .os-btn')].find(b => b.textContent === 'No')?.click();
      await sleep(30);
    }

    // 9. Terminal
    {
      os.open('terminal');
      await sleep(60);
      const tw = winOf('terminal');
      const input = tw.querySelector('input');
      const text = () => tw.querySelector('.os-term').textContent;
      check('terminal shows banner menu', /home/.test(text()) && /projects/.test(text()) && /contact/.test(text()) && tw.querySelectorAll('.os-term-menu-row').length === 5);
      key(input, 'ArrowDown');
      key(input, 'Enter');
      await sleep(20);
      check('terminal: arrow + Enter opens "projects" placeholder page', /placeholder/i.test(text()) && /projects/i.test(text()));
      const runCmd = async c => { input.value = c; key(input, 'Enter'); await sleep(20); };
      await runCmd('help');
      check('terminal: help lists commands', /whoami/.test(text()) && /clear/.test(text()));
      await runCmd('open contact');
      check('terminal: open contact is placeholder only', /placeholder/i.test(text()) && !/@[a-z0-9-]+\.[a-z]{2,}/i.test(text()));
      await runCmd('clear');
      check('terminal: clear returns to menu', tw.querySelectorAll('.os-term-menu-row').length === 5);
      // Esc must NOT be swallowed by the terminal
      let seen = 0;
      const onEsc = e => { if (e.key === 'Escape') seen++; };
      document.addEventListener('keydown', onEsc);
      key(input, 'Escape');
      check('Esc bubbles to host when no menu/dialog is open', seen === 1);
      // ...but IS swallowed when a menu is open
      const st = centre(screen.querySelector('.os-start'));
      fire('pointerdown', st.x, st.y); fire('pointerup', st.x, st.y);
      await sleep(20);
      const sm = screen.querySelector('.os-startmenu');
      check('Start menu opens inside root', !!sm && mount.contains(sm) && sm.offsetTop + sm.offsetHeight <= 454 && sm.offsetTop >= 0);
      key(input, 'Escape');
      check('Esc closes an open menu and is consumed', seen === 1 && !screen.querySelector('.os-startmenu'));
      document.removeEventListener('keydown', onEsc);
      await runCmd('exit');
      check('terminal: exit closes the window', !winOf('terminal'));
    }

    // 10. Start menu > Settings > Room Control, bridge wiring
    {
      const st = centre(screen.querySelector('.os-start'));
      fire('pointerdown', st.x, st.y); fire('pointerup', st.x, st.y);
      await sleep(20);
      const settings = [...screen.querySelectorAll('.os-startmenu .os-menu-item')].find(i => /Settings/.test(i.textContent));
      settings.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
      await sleep(20);
      const sub = [...screen.querySelectorAll('.os-menu[data-level="1"] .os-menu-item')];
      check('Settings cascades a submenu', sub.length >= 1 && /Room Control/.test(sub[0].textContent));
      sub[0].click();
      await sleep(40);
      const rw = winOf('room');
      check('Room Control opens from Start menu', !!rw);
      const before = calls.length;
      const boxes = rw.querySelectorAll('input[type="checkbox"]');
      boxes[0].click();
      await sleep(10);
      const c1 = calls.slice(before);
      check('lamp checkbox calls bridge.setRoom("lamp", false)', c1.length === 1 && c1[0][1] === 'lamp' && c1[0][2] === false, JSON.stringify(c1));
      const n2 = calls.length;
      hostSet('lava', false);
      await sleep(10);
      check('host-driven change updates UI without echoing setRoom', boxes[1].checked === false && calls.length === n2);
      // slider drag
      const sl = rw.querySelector('.os-slider');
      const so = logicalOf(sl);
      const n3 = calls.length;
      await dragLogical(so.x + sl.clientWidth - 8, so.y + 10, so.x + 6, so.y + 10, 8);
      const sunCalls = calls.slice(n3).filter(c => c[1] === 'sun');
      const lastSun = sunCalls.length ? sunCalls[sunCalls.length - 1][2] : null;
      check('sunlight slider drags to 0 and reports via setRoom("sun")', sunCalls.length > 1 && lastSun === 0, `last=${lastSun}, calls=${sunCalls.length}`);
      const n4 = calls.length;
      [...rw.querySelectorAll('.os-btn')].find(b => /Step away/.test(b.textContent)).click();
      check('"Step away" calls bridge.exitFocus()', calls.slice(n4).some(c => c[0] === 'exitFocus'));
      rw.querySelector('.os-tb-close').click();
      await sleep(20);
    }

    // 11. Explorer navigation + file associations
    {
      os.open('explorer');
      await sleep(40);
      const ew = winOf('explorer');
      const addr = () => ew.querySelector('.os-exp-addr').textContent;
      const item = name => [...ew.querySelectorAll('.os-exp-item')].find(i => i.textContent.trim().toLowerCase().includes(name));
      const open = async name => { const c = centre(item(name)); await dbl(c.x, c.y); await sleep(520); };
      check('explorer lists drives', !!item('(c:)') && !!item('(a:)') && !!item('(d:)'));
      await open('(c:)');
      check('explorer: double-click opens C:', /^C:\\/.test(addr()) && !!item('my documents'), addr());
      await open('my documents');
      check('explorer: saved Notepad file is in My Documents', !!item('selftest.txt'), addr());
      await open('selftest.txt');
      const np2 = winOf('notepad');
      check('explorer: .txt opens Notepad with content', !!np2 && np2.querySelector('textarea').value === 'selftest line');
      np2?.querySelector('.os-tb-close').click();
      ew.querySelector('[data-act="up"]').click();
      await sleep(20);
      await open('music');
      await open('powder day');
      check('explorer: .mid opens Media Player', !!winOf('player'));
      winOf('player')?.querySelector('.os-tb-close').click();
      ew.querySelector('[data-act="up"]').click();
      await sleep(20);
      await open('travel');
      await open('postcard');
      check('explorer: .bmp opens Paint', !!winOf('paint'));
      os.closeAll();
      await sleep(30);
      check('closeAll() closes every window', screen.querySelectorAll('.os-win').length === 0);
    }

    // 12. Game: runs, pauses on blur, loop stops when minimized
    {
      os.open('game');
      await sleep(60);
      const gw = winOf('game');
      const body = gw.querySelector('.os-game');
      key(body, ' ');
      await sleep(300);
      check('game starts on Space', body.dataset.state === 'playing', body.dataset.state);
      os.open('about');
      await sleep(60);
      check('game pauses when its window loses focus', body.dataset.state === 'paused', body.dataset.state);
      os.closeAll();
      await sleep(20);
    }

    // 13. Audio handle + sound event
    {
      const a = getAudio();
      const shape = ['play', 'stop', 'isPlaying', 'setVolume'].every(k => typeof a[k] === 'function') && 'analyser' in a;
      check('getAudio() exposes play/stop/isPlaying/setVolume/analyser', shape);
      const seen = [];
      const off = os.on('sound', on => seen.push(on));
      os.open('player');
      await sleep(40);
      const started = a.play(1);
      await sleep(60);
      if (started) {
        const pw = winOf('player');
        check('host play() -> isPlaying + "sound" event + player UI follows', a.isPlaying() && seen[0] === true && /Powder Day/.test(pw.textContent) && pw.querySelector('[data-act="play"]').classList.contains('down'), JSON.stringify(seen));
        check('analyser is an AnalyserNode', !!a.analyser && typeof a.analyser.getByteFrequencyData === 'function');
        os.setPower(false);
        await sleep(30);
        check('setPower(false) stops audio and emits sound=false', !a.isPlaying() && seen[seen.length - 1] === false);
      } else {
        check('audio unavailable here: play() returns false without throwing', started === false);
        os.setPower(false);
        await sleep(30);
      }
      off();
    }

    // 14. Power cycle
    {
      const c = os.getAverageColor();
      check('off: isOn() false, colour black, no windows', !os.isOn() && c.every(v => v === 0) && screen.querySelectorAll('.os-win').length === 0, JSON.stringify(c));
      const seen = [];
      const off = os.on('power', on => seen.push(on));
      os.setPower(true);
      await sleep(60);
      check('setPower(true) boots (POST screen)', os.isOn() && os.getState() === 'boot' && !!screen.querySelector('.os-post, .os-splash') && seen[0] === true);
      check('colour is black while booting', os.getAverageColor().every(v => v === 0));
      key(screen, 'x');
      await sleep(60);
      check('keypress skips boot to desktop', os.getState() === 'on');
      const col = os.getAverageColor();
      check('desktop colour estimate is teal-ish', col[0] < 0.2 && col[1] > 0.4 && col[2] > 0.4, col.map(v => v.toFixed(2)).join(','));
      os.open('terminal');
      await sleep(40);
      const col2 = os.getAverageColor();
      check('opening a dark window darkens the estimate', col2[1] < col[1], col2.map(v => v.toFixed(2)).join(','));
      os.closeAll();
      off();
    }

    // 15. Shut Down dialog -> halt screen -> off -> click to boot
    {
      os.open('shutdown');
      await sleep(40);
      const sd = winOf('shutdown');
      check('Shut Down dialog opens', !!sd);
      [...sd.querySelectorAll('.os-btn')].find(b => b.textContent === 'OK').click();
      await sleep(40);
      check('shutdown shows the farewell screen', os.getState() === 'halt' && !!screen.querySelector('.os-halt'));
      const h1 = centre(screen.querySelector('.os-halt'));
      fire('pointerdown', h1.x, h1.y); fire('pointerup', h1.x, h1.y);
      await sleep(30);
      check('then powers off (black screen)', !os.isOn() && !!screen.querySelector('.os-off'));
      fire('pointerdown', 320, 240); fire('pointerup', 320, 240);
      await sleep(30);
      check('clicking the black screen reboots', os.getState() === 'boot');
      fire('pointerdown', 320, 240); fire('pointerup', 320, 240);
      await sleep(30);
      check('click skips boot', os.getState() === 'on');
      os.closeAll();
    }

    // 16. every app opens without overflowing its window
    {
      const bad = [];
      for (const id of os.apps) {
        os.open(id);
        await sleep(50);
        const w = winOf(id);
        if (!w) { bad.push(id + ':missing'); continue; }
        const b = w.querySelector('.os-win-body');
        const r = rect(w);
        if (b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1) bad.push(`${id}:body ${b.scrollWidth}x${b.scrollHeight} > ${b.clientWidth}x${b.clientHeight}`);
        if (r.x < 0 || r.y < 0 || r.x + r.w > 640 || r.y + r.h > 452) bad.push(`${id}:offscreen ${JSON.stringify(r)}`);
        os.closeAll();
        await sleep(20);
      }
      check('all apps open, fit on screen, no body overflow', bad.length === 0, bad.join('; '));
    }

    // 17. screensaver API path (forced short idle is tested via ?saver=)
    check('nothing was appended outside the mount', document.querySelectorAll('body > *:not(#stage):not(script)').length === 0);
    check('no JS errors / rejections / console.error', window.__errors.length === 0, window.__errors.join(' | '));
  } catch (err) {
    check('selftest crashed', false, err && (err.stack || err.message));
  }

  // tidy up: remove the file this test saved through Notepad
  try {
    const KEY = 'summit98.files.v1';
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    delete saved['selftest.txt'];
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch { /* storage unavailable */ }

  const failed = results.filter(r => !r.ok).length;
  const sum = document.createElement('div');
  sum.className = failed ? 'fail' : 'pass';
  sum.id = 'selftest-summary';
  sum.textContent = `SELFTEST ${failed ? 'FAIL' : 'PASS'}: ${results.length - failed}/${results.length} passed`;
  out.prepend(sum);
  document.documentElement.dataset.selftest = failed ? 'fail' : 'pass';
  return results;
}
