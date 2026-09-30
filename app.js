/* ABIdasmuss – VBWL-Abiturtrainer
   Inhalte liegen verschlüsselt (AES-GCM, Schlüssel per PBKDF2 aus dem Passwort) in data/lbN.js
   und werden erst im Browser nach Passworteingabe entschlüsselt. */
(() => {
  'use strict';

  const META = window.__META;
  const LB = {
    1: { name: 'Beschaffung', full: 'Beschaffung von Produktionsfaktoren', emoji: '📦', accent: 'var(--lb1)' },
    2: { name: 'Leistungs\u00ADerstellung', full: 'Leistungserstellung (Kosten- und Leistungsrechnung)', emoji: '🏭', accent: 'var(--lb2)' },
    3: { name: 'Marketing', full: 'Marketing', emoji: '📣', accent: 'var(--lb3)' },
    4: { name: 'Finanzie\u00ADrung', full: 'Finanzierungsprozesse im Unternehmen', emoji: '💰', accent: 'var(--lb4)' },
    5: { name: 'Wirtschafts\u00ADpolitik', full: 'Wirtschaftspolitisches Handeln des Staates / Markt und Preis', emoji: '🏛️', accent: 'var(--lb5)' },
    6: { name: 'Geldpolitik', full: 'Geldtheorie und Geldpolitik', emoji: '🏦', accent: 'var(--lb6)' },
  };
  const PART = { A: 'Teil A', B: 'Teil B', Alt: 'Altformat' };

  const app = document.getElementById('app');
  const cache = {};
  let key = null;
  let pkey = null;
  let pending = null;
  let lectCache = null, privCache = null;
  const blobCache = {};

  /* ---------- Speicher (sicher gekapselt) ---------- */
  const store = {
    get(s, k) { try { return window[s].getItem(k); } catch { return null; } },
    set(s, k, v) { try { window[s].setItem(k, v); } catch {} },
    del(s, k) { try { window[s].removeItem(k); } catch {} },
  };

  /* ---------- Krypto ---------- */
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));

  async function deriveKey(pw, salt = META.salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(salt), iterations: META.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function decrypt(k, blob) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, k, b64(blob.ct));
    return new TextDecoder().decode(pt);
  }
  async function tryKey(k) {
    try { return (await decrypt(k, META.check)) === 'ABIdasmuss-ok'; } catch { return false; }
  }
  async function tryPKey(k) {
    try { return (await decrypt(k, META.pcheck)) === 'ABIdasmuss-privat-ok'; } catch { return false; }
  }
  async function restoreKey() {
    const imp = raw => crypto.subtle.importKey('raw', b64(raw), { name: 'AES-GCM' }, true, ['decrypt']);
    try { const raw = store.get('sessionStorage', 'abi-key'); if (raw) { const k = await imp(raw); if (await tryKey(k)) key = k; } } catch {}
    try { const raw = store.get('sessionStorage', 'abi-pkey'); if (raw) { const k = await imp(raw); if (await tryPKey(k)) pkey = k; } } catch {}
  }
  async function decryptFile(k, url) {
    const res = await fetch(url + '?v=' + (window.__V || '1'));
    if (!res.ok) throw new Error('Datei nicht gefunden: ' + url);
    const buf = new Uint8Array(await res.arrayBuffer());
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, k, buf.slice(12));
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src + '?v=' + (window.__V || '1'); s.onload = res; s.onerror = () => rej(new Error('Laden fehlgeschlagen: ' + src));
      document.head.appendChild(s);
    });
  }
  async function getLB(n) {
    if (cache[n]) return cache[n];
    if (!window.__ENC || !window.__ENC[n]) await loadScript(`data/lb${n}.js`);
    cache[n] = JSON.parse(await decrypt(key, window.__ENC[n]));
    return cache[n];
  }
  const getAll = () => Promise.all([1, 2, 3, 4, 5, 6].map(getLB));
  async function getLect() {
    if (lectCache) return lectCache;
    if (!window.__LECT) await loadScript('data/lect.js');
    return (lectCache = JSON.parse(await decrypt(key, window.__LECT)));
  }
  async function getPriv() {
    if (privCache) return privCache;
    if (!window.__PRIV) await loadScript('data/priv.js');
    return (privCache = JSON.parse(await decrypt(pkey, window.__PRIV)));
  }

  /* ---------- Sperre ---------- */
  const lockModal = document.getElementById('m-lock');
  const pwInput = document.getElementById('pw');
  const pwErr = document.getElementById('pwErr');
  const lockBtn = document.getElementById('lockBtn');

  function updateLockBtn() {
    lockBtn.textContent = (key || pkey) ? '🔓' : '🔒';
    lockBtn.title = (key || pkey) ? 'Wieder sperren' : 'Entsperren';
    lockBtn.setAttribute('aria-label', lockBtn.title);
  }
  function requireUnlock(then) {
    if (key) return then();
    pending = then;
    pwErr.hidden = true; pwInput.value = '';
    openModal('lock');
    setTimeout(() => pwInput.focus(), 50);
  }
  document.getElementById('lockForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('pwBtn');
    btn.disabled = true; btn.textContent = 'PRÜFE …';
    const k = await deriveKey(pwInput.value.trim());
    btn.disabled = false; btn.textContent = 'ENTSPERREN';
    if (await tryKey(k)) {
      key = k;
      store.set('sessionStorage', 'abi-key', toB64(await crypto.subtle.exportKey('raw', k)));
      updateLockBtn(); closeModals();
      const p = pending; pending = null;
      if (p) p(); else render();
    } else {
      pwErr.hidden = false;
      const box = lockModal.querySelector('.modal-box');
      box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      pwInput.select();
    }
  });
  lockBtn.addEventListener('click', () => {
    if (key || pkey) {
      key = null; pkey = null; lectCache = null; privCache = null;
      for (const k in timers) delete timers[k]; activeTimer = null;
      for (const k in cache) delete cache[k];
      for (const k in blobCache) { URL.revokeObjectURL(blobCache[k]); delete blobCache[k]; }
      store.del('sessionStorage', 'abi-key'); store.del('sessionStorage', 'abi-pkey'); updateLockBtn();
      location.hash = '#/';
      render();
    } else requireUnlock(render);
  });

  /* ---------- Privat-Sperre ---------- */
  const privModal = document.getElementById('m-priv');
  const ppwInput = document.getElementById('ppw');
  const ppwErr = document.getElementById('ppwErr');
  let ppending = null;
  function requirePriv(then) {
    if (pkey) return then();
    ppending = then; ppwErr.hidden = true; ppwInput.value = '';
    openModal('priv'); setTimeout(() => ppwInput.focus(), 50);
  }
  document.getElementById('privForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('ppwBtn');
    btn.disabled = true; btn.textContent = 'PRÜFE …';
    const k = await deriveKey(ppwInput.value.trim(), META.psalt);
    btn.disabled = false; btn.textContent = 'ÖFFNEN';
    if (await tryPKey(k)) {
      pkey = k;
      store.set('sessionStorage', 'abi-pkey', toB64(await crypto.subtle.exportKey('raw', k)));
      updateLockBtn(); closeModals();
      const p = ppending; ppending = null; if (p) p(); else render();
    } else {
      ppwErr.hidden = false;
      const box = privModal.querySelector('.modal-box');
      box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      ppwInput.select();
    }
  });

  /* ---------- Modals ---------- */
  function openModal(id) { document.getElementById('m-' + id).classList.add('open'); }
  function closeModals() { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); }
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) openModal(o.dataset.open);
    if (e.target.closest('[data-close]') || e.target.classList.contains('modal')) {
      if (lockModal.classList.contains('open') && pending && !key) { pending = null; if (!location.hash || location.hash === '#/') render(); else location.hash = '#/'; }
      if (privModal.classList.contains('open') && ppending && !pkey) { ppending = null; if (location.hash.startsWith('#/privat')) location.hash = '#/'; }
      closeModals();
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
  /* ---------- Hell/Dunkel ---------- */
  const themeBtn = document.getElementById('themeBtn');
  function setTheme(t, save) {
    document.documentElement.dataset.theme = t;
    themeBtn.textContent = t === 'light' ? '🌙' : '☀️';
    themeBtn.title = t === 'light' ? 'Dunkler Modus' : 'Heller Modus';
    themeBtn.setAttribute('aria-label', themeBtn.title);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f4f6fb' : '#05070f');
    if (save) try { localStorage.setItem('abi-theme', t); } catch (e) {}
  }
  setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', false);
  themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true));

  /* ---------- Hintergrundfarbe (Farbtabelle) ---------- */
  const PALETTE = '000c82,0923a4,08349b,014393,055899,0872a1,0b89a7,0b889b,0c8790,0b8783,0b8674,0c8664,0e8653,2d8450,49834a,568248,6a8045,787f43;0000e1,002be8,034be0,036bf0,0a8adc,0faada,00ffff,13e0cf,14e5c2,12e1b3,11e8a4,11f48f,13fa75,45e274,6cd773,8ad271,a0d170,b6cf70;1731d6,1244da,1657d8,1d73d5,2194d7,23afd8,2edad9,23ded1,22e1c3,20e4b5,20e6a8,26e896,30ea85,4ce17a,6cd773,8dd577,a1d170,b6ce6f;3159d2,275bd3,316fd2,2d7ed4,379ed6,3cb6d7,40d7d8,38d9d1,33ddc3,31dfb9,3be0ac,3de29f,45e18f,4de17a,6fd977,8dd577,a3d275,b6ce6f;4976d2,457cd1,4381d2,4d96d5,4da9d7,4fbed7,53d7d9,50d7d3,49d9c6,4fdabc,56ddb4,57deaa,61e09d,67dd8e,82d98c,98d688,b3d793,c1d285;70a2d9,70a2d9,70a2d9,69a7d7,66b6da,66c4d7,67d4d5,67d4d5,67d3d4,65d4d8,6cdbba,70ddb5,77e0a9,79de9a,8edb98,a3d996,b3d794,c4d591;88bceb,88bceb,88bceb,88c0e2,89c8e1,8bd1e0,80d7d9,7ed6d8,79d7cc,7adbc7,81ddc0,86debf,8ce0b5,8adea8,9bdda5,acd9a1,badb9f,cbd89c;97c6e2,97c6e2,96c7e1,91c4df,94cee0,8fd2df,93dbdb,92dbdb,8fdad0,90ddcc,8dddc4,96dfc7,9be2bf,9ae1b4,a2e0b2,b7deae,c2ddaa,d1dba8;aad9eb,aad9eb,abd9ea,abd9ea,a5d8e3,a3dde2,a3dde2,a8dfdc,a3ded5,a5e1d2,a2e2cd,a5e1ce,a0e5c2,aae4c0,b5e1bc,bfe1ba,cae0b5,d7deb2;bfe5e7,bee6e7,c2e7e7,c2e7e7,c2e7e7,c2e7e7,c2e7e7,bce5e2,b5e3db,b5e5d8,b2e4d2,b2e4d2,b1e7cc,b8e7ca,bfe6c6,c7e4c2,d1e3be,dbe1bb;c9e9e5,c8e9e6,caeae6,cbe9e6,cbeae6,cbeae6,caeae7,c4e9e4,c2e9e1,c0eade,c0e9d9,bfead9,c1ead2,c1ead2,c7e9ce,cde6c9,d5e7c8,e0e5c2;d1f2ef,d1f2ef,d1f2ef,d1f2ef,d1f2ef,d1f2ef,d1f2ef,c8e9e4,c4e8df,c1eadd,c4ebdb,c4ecd9,c3ecd7,c6ead5,cae9d1,d0e8cd,d7e6c8,e0e6c5;a6783b,ac7336,b3692f,bf5e26,cb511c,c5481d,ff3c0d,d53e26,c7403b,bd4052,b84160,b4426d,b1437c,913d84,793789,60308f,3e2596,291fba;d1cb71,debd69,fbaf61,ffa055,ff8d47,ff6c29,ff5415,ff543e,fd5963,ff577b,ff5891,ff5aa1,ff5aac,ff52b1,ae46b4,803cb9,5c31c1,3b26c9;d1d086,dcbe6d,fab064,ffa35c,ff914e,ff7737,ff5b1c,ff5c3e,fd5f5f,ff6076,ff6094,ff5fa4,ff61ae,dd55b3,ad51b5,8648ba,623fc0,4b3fc5;d1d087,d7c375,fab064,ffaa67,ff914e,ff8344,ff6629,ff6849,fe6b67,ff6a7e,ff6c99,ff6aa7,ff6cb2,ff61ae,b25fb8,8d5abc,6d52c0,5a54c5;d1d086,d8c57f,e2bb7a,fab075,ffa167,ff9051,ff763c,ff7a57,fe7a73,ff7b88,ff7aa1,ff78ae,ff79b6,d771ba,b771bc,976ec0,7d6ac3,6b6bc7;d3d391,d7cb8c,dec187,eab984,ffad76,ff9f62,ff8a51,ff8b65,fe8a7d,ff8a91,ff8aa9,ff86b4,ff88bd,d683bf,bd84c0,a182c2,8b81c6,7c81c7;d7d59b,d9cf97,ddc894,e4c292,f0b684,ffaa6f,ff9f67,ff9b72,fe9a89,ff9a9c,ff99b3,ff96bd,ff98c2,d794c4,c396c5,ac98c8,9b99c9,8c96ca;dbd9a6,ddd4a2,dfd09f,e4cb9f,e8c092,fbb17a,f7b278,ffa883,fea89b,ffa9aa,ffa9bd,ffa7c7,ffa7cb,dda6ca,c9a8cb,b8aacd,aaadce,9caace;dfddaf,e1d9ad,e2d7ac,e5d4ac,e6cda3,e7c395,e5bd87,fcba9c,febaab,f9b8af,ffb7c6,ffb4ce,ffb5d1,e1b5d1,d1b9d2,c2bbd3,b8c1d6,aabcd3;e2e1b8,e3e0b8,e5ddb7,e8dcb7,e7d7b2,e5d0a9,e3cda1,eccbaf,edc9ba,f7c7c4,fac3ce,ffc1d7,f5c2d7,d9c7d9,d9c7d9,c9c9d9,c2d0dd,b5cad8;e6e4bf,e6e3bf,e8e3be,e6e2be,e5e0bc,e6dcb7,e6dbb7,e8d7bc,ecd3c3,f0d0cb,f4ccd4,f5cbdc,f5cadd,eacdde,eacdde,d2d5e0,cadae0,c0d9df;e7e5c2,e7e3bf,e6e5c2,e7e5c2,e8e5c2,e5e4c0,e7e4c2,e7e2c4,e9d9c7,f0d5cf,f3d1d8,f6cfe0,f3cede,ebd0df,dfd4e1,d6d9e1,d0e2e5,cae7e4;000000,1e2020,2d2f30,3e4041,4f5252,5f6262,666666,6f7372,818484,909494,999999,9fa2a3,adb0b0,b8bbbb,c4c6c6,cccccc,d4d5d5,ffffff'.split(';').map(r => r.split(',').map(c => '#' + c));
  const lum = hex => { const v = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  let colorMode = 'bg';   // 'bg' = Hintergrund, 'fg' = Schrift
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const curVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function markSwatches() {
    const cur = colorMode === 'bg' ? curVar('--userbg') : curVar('--userfg');
    document.querySelectorAll('#bgGrid .sw').forEach(b => b.classList.toggle('on', b.dataset.c === cur));
    document.querySelectorAll('.bgtab').forEach(t => t.classList.toggle('on', t.dataset.mode === colorMode));
    document.getElementById('bgHint').textContent = colorMode === 'bg'
      ? 'Such dir eine Hintergrundfarbe aus. Hell oder dunkel stellt sich automatisch passend ein.'
      : 'Such dir eine Farbe für Überschriften und Beschriftungen aus. Aufgaben- und Lösungstext bleiben unverändert.';
    // Lesbarkeit: Schrift gegen die Kästen (dunkel bzw. weiß)
    const panel = document.documentElement.dataset.theme === 'light' ? '#ffffff' : '#0f131c';
    const fg = curVar('--userfg') || (document.documentElement.dataset.theme === 'light' ? '#0270a0' : '#38d6ff');
    const k = contrast(fg, panel), pv = document.getElementById('fgPreview');
    pv.style.background = panel; pv.style.color = fg;
    pv.querySelector('b').textContent = k >= 4.5 ? '✓ gut lesbar' : k >= 3 ? '~ noch lesbar' : '⚠️ schwer lesbar';
    pv.querySelector('b').className = k >= 4.5 ? 'ok' : k >= 3 ? 'mid' : 'bad';
  }
  function setBg(c) {
    const root = document.documentElement;
    if (c) { root.style.setProperty('--userbg', c); root.classList.add('custombg'); setTheme(lum(c) > .22 ? 'light' : 'dark', true); }
    else { root.style.removeProperty('--userbg'); root.classList.remove('custombg'); }
    try { c ? localStorage.setItem('abi-bg', c) : localStorage.removeItem('abi-bg'); } catch (e) {}
    markSwatches();
  }
  function setFg(c) {
    const root = document.documentElement;
    if (c) { root.style.setProperty('--userfg', c); root.classList.add('customfg'); }
    else { root.style.removeProperty('--userfg'); root.classList.remove('customfg'); }
    try { c ? localStorage.setItem('abi-fg', c) : localStorage.removeItem('abi-fg'); } catch (e) {}
    markSwatches();
  }
  document.getElementById('bgBtn').addEventListener('click', () => {
    const g = document.getElementById('bgGrid');
    if (!g.childElementCount) {
      g.innerHTML = PALETTE.map((row, i) => (i === 12 ? '<div class="bgsep">Komplementärfarben</div>' : '') + '<div class="bgrow">' +
        row.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="Farbe ${c.toUpperCase()}"></button>`).join('') + '</div>').join('');
      g.addEventListener('click', e => { const b = e.target.closest('.sw'); if (b) (colorMode === 'bg' ? setBg : setFg)(b.dataset.c); });
      document.querySelectorAll('.bgtab').forEach(t => t.addEventListener('click', () => { colorMode = t.dataset.mode; markSwatches(); }));
    }
    markSwatches();
    openModal('bg');
  });
  document.getElementById('bgReset').addEventListener('click', () => { if (colorMode === 'bg') { setBg(null); setTheme('dark', true); markSwatches(); } else setFg(null); });

  document.getElementById('fsBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.();
  });

  /* ---------- Hilfen ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const twoTone = t => { const w = t.split(' '); if (w.length < 2) return `<span class="hl">${esc(t)}</span>`; const l = w.pop(); return `${esc(w.join(' '))} <span class="hl">${esc(l)}</span>`; };
  const label = t => `Abiturprüfung ${t.year} · ${PART[t.part]} · Aufgabe ${t.nr}`;
  const plain = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; };

  function cardHTML(t, lbn) {
    const acc = LB[lbn].accent;
    return `<a class="card" style="--accent:${acc}" href="#/lb/${lbn}/${t.id}">
      <div class="top">
        <span class="badge year">${t.year}</span>
        <span class="badge part">${PART[t.part]} · ${esc(t.nr)}</span>
        <span class="badge be">${t.be} BE · ⏱ ${t.minutes || t.be * 3} min</span>
      </div>
      <h3>${twoTone(t.topic)}</h3>
      <p>LB${lbn} · ${esc(LB[lbn].name)} · ${label(t)}</p>
    </a>`;
  }

  const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  const isNew = v => v.added && (Date.now() - new Date(v.added).getTime()) < 21 * 864e5;
  function lectCardHTML(v, kind = 'v') {
    const acc = LB[v.lb]?.accent || 'var(--cyan)';
    const href = kind === 'v' ? `#/vorlesung/${v.id}` : `#/privat/${v.id}`;
    const n = v.tasks ? v.tasks.length : 0;
    return `<a class="card lect" style="--accent:${acc}" href="${href}">
      <div class="top">
        <span class="badge" style="color:${acc};border-color:color-mix(in srgb,${acc} 40%,transparent)">LB${v.lb}</span>
        ${v.topic ? `<span class="badge part">${esc(v.topic)}</span>` : ''}
        <span class="badge">${v.pages} S.</span>
        ${isNew(v) ? '<span class="badge neu">NEU</span>' : ''}
      </div>
      <h3><span class="docico">${kind === 'v' ? '📄' : '🔐'}</span>${twoTone(v.title)}</h3>
      <p>${kind === 'v' ? (n ? `Passt zu ${n} Prüfungsaufgabe${n > 1 ? 'n' : ''}` : 'Grundlagen') : 'Zusammenfassung'} · ${mb(v.size)}</p>
    </a>`;
  }
  function topicChips(list, active, attr = 'data-topic') {
    const topics = [...new Set(list.map(v => v.topic))];
    return `<div class="chips">${['alle', ...topics].map(o => `<button class="chip${o === active ? ' on' : ''}" ${attr}="${esc(o)}">${o === 'alle' ? 'ALLE THEMEN' : esc(o.toUpperCase())}</button>`).join('')}</div>`;
  }

  /* ---------- Timer ---------- */
  const timers = {};          // id -> { acc, start, total, lb, label, beeped }
  let activeTimer = null;     // id des zuletzt gestarteten Timers
  const fmt = ms => { const neg = ms < 0; ms = Math.abs(ms); const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return (neg ? '+' : '') + (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(sec).padStart(2, '0'); };
  const elapsed = tm => tm.acc + (tm.start ? Date.now() - tm.start : 0);
  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, .35, .7].forEach(d => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(.0001, ac.currentTime + d); g.gain.exponentialRampToValueAtTime(.25, ac.currentTime + d + .02); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + d + .25);
        o.start(ac.currentTime + d); o.stop(ac.currentTime + d + .3); });
    } catch {}
  }
  const pill = document.createElement('a');
  pill.className = 'timerpill'; pill.hidden = true;
  document.body.appendChild(pill);
  function tick() {
    for (const id in timers) {
      const tm = timers[id], el = elapsed(tm), left = tm.total - el, over = left < 0;
      if (over && tm.start && !tm.beeped) { tm.beeped = true; beep(); }
      const box = document.querySelector(`.timer[data-id="${id}"]`);
      if (box) {
        box.querySelector('.tdisp').textContent = fmt(over ? left : left + 999);
        box.classList.toggle('over', over); box.classList.toggle('running', !!tm.start);
        box.querySelector('.tbar i').style.width = Math.min(100, el / tm.total * 100) + '%';
        box.querySelector('.tstart').textContent = tm.start ? '❚❚ PAUSE' : (el ? '▶ WEITER' : '▶ START');
        box.querySelector('.tstate').textContent = over ? 'Zeit abgelaufen – Überzeit' : tm.start ? 'läuft …' : el ? 'pausiert' : 'bereit';
        const min = el / 60000;
        box.querySelectorAll('.plan li').forEach(li => {
          const a = +li.dataset.a, e = +li.dataset.e;
          li.classList.toggle('done', min >= e); li.classList.toggle('now', min >= a && min < e);
        });
      }
    }
    const tm = activeTimer && timers[activeTimer];
    const onPage = activeTimer && document.querySelector(`.timer[data-id="${activeTimer}"]`);
    if (tm && tm.start && !(onPage && onPage.dataset.visible === '1')) {
      const left = tm.total - elapsed(tm);
      pill.hidden = false; pill.href = `#/lb/${tm.lb}/${activeTimer}`;
      pill.classList.toggle('over', left < 0);
      pill.innerHTML = `<span>⏱</span><b>${fmt(left < 0 ? left : left + 999)}</b><small>${esc(tm.label)}</small>`;
    } else pill.hidden = true;
  }
  setInterval(tick, 250);

  function timerHTML(t, lbn) {
    if (!timers[t.id]) timers[t.id] = { acc: 0, start: null, total: t.minutes * 60000, lb: lbn, label: `${t.year} · ${t.nr}`, beeped: false };
    let a = 0;
    const plan = (t.plan || []).map(([nr, be, mins]) => { const li = `<li data-a="${a}" data-e="${a + mins}"><span class="pnr">${esc(nr)}</span><span class="pbe">${be} BE</span><span class="pmin">${mins} min</span><span class="pto">bis ${a + mins}′</span></li>`; a += mins; return li; }).join('');
    return `<div class="box timer" data-id="${t.id}">
      <div class="lbl">⏱ Prüfungs-Timer</div>
      <div class="tdisp">${fmt(t.minutes * 60000 + 999)}</div>
      <div class="tstate">bereit</div>
      <div class="tbar"><i></i></div>
      <div class="tbtns"><button class="btn tstart">▶ START</button><button class="btn ghost treset" title="Zurücksetzen">↺</button></div>
      <p class="tnote">${t.be} BE × 3 min = <b>${t.minutes} min</b> · so viel Zeit hast du in der echten Prüfung (ohne Lese- und Auswahlzeit).</p>
      ${plan ? `<details class="planbox" open><summary>Zeitplan Teilaufgaben</summary><ol class="plan">${plan}</ol></details>` : ''}
    </div>`;
  }
  function bindTimer(id) {
    const box = document.querySelector(`.timer[data-id="${id}"]`); if (!box) return;
    const tm = timers[id];
    box.querySelector('.tstart').onclick = () => {
      if (tm.start) { tm.acc += Date.now() - tm.start; tm.start = null; }
      else {
        for (const o in timers) if (o !== id && timers[o].start) { timers[o].acc += Date.now() - timers[o].start; timers[o].start = null; }
        tm.start = Date.now(); activeTimer = id;
      }
      tick();
    };
    box.querySelector('.treset').onclick = () => { tm.acc = 0; tm.start = null; tm.beeped = false; tick(); };
    if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => { box.dataset.visible = e.isIntersecting ? '1' : '0'; tick(); })).observe(box);
    tick();
  }

  /* ---------- Seiten ---------- */
  function home() {
    const tiles = Object.entries(LB).map(([n, l]) => `
      <a class="tile" style="--accent:${l.accent}" href="#/lb/${n}">
        <span class="lbtag">LB${n}</span>
        ${key ? '' : '<span class="lockbadge">🔒</span>'}
        <span class="emoji">${l.emoji}</span>
        <span class="t">${esc(l.name)}</span>
        <span class="s">${META.lbs[n].count} Aufgaben</span>
      </a>`).join('');
    app.innerHTML = `
      <section class="hero">
        <h1 class="brand">ABIdasmuss</h1>
        <p class="subtitle">Das VBWL-Abitur-Universum</p>
        <p class="tagline">Abiturprüfungen 2017 – 2024 · nach Lernbereichen</p>
      </section>
      <div class="searchrow">
        <label class="search"><span>🔍</span><input id="q" type="search" placeholder="Aufgabe suchen …" autocomplete="off"></label>
      </div>
      <div class="results" id="results"></div>
      <div class="sechead"><h2><b>6</b> LERNBEREICHE</h2></div>
      <div class="tiles lbtiles">${tiles}</div>
      <div class="sechead"><h2>EXTRAS</h2></div>
      <div class="tiles extras">
        <a class="tile" style="--accent:var(--sky)" href="#/vorlesungen">${key ? '' : '<span class="lockbadge">🔒</span>'}<span class="emoji">📚</span><span class="t">Vorlesungen</span><span class="s">Nach Thema filtern</span></a>
        <a class="tile" href="#/zufall"><span class="emoji">🎲</span><span class="t">Zufalls&shy;aufgabe</span><span class="s">Überrasch mich</span></a>
        <a class="tile" href="#/alle"><span class="emoji">🚀</span><span class="t">Alle Aufgaben</span><span class="s">66 Aufgaben</span></a>
        <a class="tile" style="--accent:var(--pink)" href="#/privat"><span class="lockbadge">${pkey ? '🔓' : '🔐'}</span><span class="emoji">🗝️</span><span class="t">Privat</span><span class="s">Extra-Passwort</span></a>
        <a class="tile" style="--accent:var(--green)" href="#/upload"><span class="emoji">⬆️</span><span class="t">Hochladen</span><span class="s">Für Lehrkräfte</span></a>
        <button class="tile" data-open="about"><span class="emoji">💡</span><span class="t">So geht's</span><span class="s">Kurze Anleitung</span></button>
      </div>`;
    const q = document.getElementById('q');
    q.addEventListener('focus', () => { if (!key) { q.blur(); requireUnlock(() => { render(); setTimeout(() => document.getElementById('q')?.focus(), 30); }); } });
    let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(q.value), 150); });
  }

  async function search(term) {
    const box = document.getElementById('results');
    term = term.trim().toLowerCase();
    if (term.length < 2) { box.innerHTML = ''; return; }
    const all = await getAll();
    const hits = [];
    all.forEach((lb, i) => lb.tasks.forEach(t => {
      if (!t._txt) t._txt = (t.topic + ' ' + t.year + ' ' + t.nr + ' ' + plain(t.task)).toLowerCase();
      if (t._txt.includes(term)) hits.push(cardHTML(t, i + 1));
    }));
    box.innerHTML = hits.length
      ? `<div class="cards" style="margin-top:6px">${hits.slice(0, 30).join('')}</div>`
      : '<p class="loading" style="padding:20px 0">Nichts gefunden.</p>';
  }

  function chipsHTML(tasks, active) {
    const years = [...new Set(tasks.map(t => t.year))].sort();
    const opts = ['alle', 'A', 'B', ...years];
    return `<div class="chips">${opts.map(o => `<button class="chip${o === active ? ' on' : ''}" data-f="${o}">${o === 'alle' ? 'ALLE' : o === 'A' ? 'TEIL A' : o === 'B' ? 'TEIL B / ALT' : o}</button>`).join('')}</div>`;
  }
  const applyFilter = (tasks, f) => f === 'alle' ? tasks : f === 'A' ? tasks.filter(t => t.part === 'A') : f === 'B' ? tasks.filter(t => t.part !== 'A') : tasks.filter(t => t.year === f);

  async function listLB(n, filter = 'alle', topic = 'alle', open = true) {
    const l = LB[n];
    app.innerHTML = '<p class="loading">ENTSCHLÜSSLE …</p>';
    const [data, lect] = await Promise.all([getLB(n), getLect()]);
    const tasks = applyFilter(data.tasks, filter);
    const mine = lect.filter(v => v.lb == n);
    const shown = topic === 'alle' ? mine : mine.filter(v => v.topic === topic);
    app.innerHTML = `
      <div class="pagehead"><a class="back" href="#/" aria-label="Zurück">←</a>
        <div><h1>LB${n} · ${esc(l.name)}</h1><div class="meta">${esc(l.full)} · ${data.tasks.length} Aufgaben · ${mine.length} Vorlesungen</div></div></div>
      <details class="lectbox" style="--accent:${l.accent}" ${open ? 'open' : ''}>
        <summary><span>📚 VORLESUNGEN ZU LB${n}</span><span class="cnt">${mine.length}</span></summary>
        ${mine.length ? `${topicChips(mine, topic)}<div class="cards small">${shown.map(v => lectCardHTML(v)).join('')}</div>`
          : '<p class="empty">Zu diesem Lernbereich gibt es noch keine Vorlesungen – im Teams-Kurs ist hierzu noch nichts hochgeladen.</p>'}
      </details>
      <div class="sechead"><h2>AUFGABEN</h2></div>
      ${chipsHTML(data.tasks, filter)}
      <div class="cards">${tasks.map(t => cardHTML(t, n)).join('')}</div>`;
    app.querySelectorAll('.chip[data-f]').forEach(c => c.addEventListener('click', () => listLB(n, c.dataset.f, topic, app.querySelector('.lectbox').open)));
    app.querySelectorAll('.chip[data-topic]').forEach(c => c.addEventListener('click', () => listLB(n, filter, c.dataset.topic, true)));
  }

  async function lectPage(lbSel = 'alle', topic = 'alle') {
    app.innerHTML = '<p class="loading">ENTSCHLÜSSLE …</p>';
    const lect = await getLect();
    const inLb = lbSel === 'alle' ? lect : lect.filter(v => String(v.lb) === String(lbSel));
    const shown = topic === 'alle' ? inLb : inLb.filter(v => v.topic === topic);
    const lbs = [...new Set(lect.map(v => v.lb))].sort();
    app.innerHTML = `
      <div class="pagehead"><a class="back" href="#/" aria-label="Zurück">←</a>
        <div><h1>Vorlesungen</h1><div class="meta">${lect.length} Vorlesungen aus dem Unterricht · nach Lernbereich und Thema filtern</div></div></div>
      <div class="chips">${['alle', ...lbs].map(o => `<button class="chip${String(o) === String(lbSel) ? ' on' : ''}" data-lb="${o}">${o === 'alle' ? 'ALLE LB' : 'LB' + o + ' · ' + esc(plain(LB[o].name).toUpperCase())}</button>`).join('')}</div>
      ${lbSel === 'alle' ? '' : topicChips(inLb, topic)}
      <div class="cards">${shown.map(v => lectCardHTML(v)).join('')}</div>
      ${lbs.includes(6) ? '' : '<p class="empty" style="margin-top:22px">Für LB6 (Geldpolitik) gibt es noch keine Vorlesungen.</p>'}`;
    app.querySelectorAll('.chip[data-lb]').forEach(c => c.addEventListener('click', () => lectPage(c.dataset.lb, 'alle')));
    app.querySelectorAll('.chip[data-topic]').forEach(c => c.addEventListener('click', () => lectPage(lbSel, c.dataset.topic)));
  }

  async function privPage(lbSel = 'alle') {
    app.innerHTML = '<p class="loading">ENTSCHLÜSSLE …</p>';
    const zf = await getPriv();
    const lbs = [...new Set(zf.map(v => v.lb))].sort();
    const shown = lbSel === 'alle' ? zf : zf.filter(v => String(v.lb) === String(lbSel));
    app.innerHTML = `
      <div class="pagehead"><a class="back" href="#/" aria-label="Zurück">←</a>
        <div><h1>Privat</h1><div class="meta">${zf.length} Zusammenfassungen · mit Extra-Passwort geschützt</div></div></div>
      <div class="chips">${['alle', ...lbs].map(o => `<button class="chip${String(o) === String(lbSel) ? ' on' : ''}" data-lb="${o}">${o === 'alle' ? 'ALLE LB' : 'LB' + o + ' · ' + esc(plain(LB[o].name).toUpperCase())}</button>`).join('')}</div>
      <div class="cards">${shown.map(v => lectCardHTML(v, 'p')).join('')}</div>`;
    app.querySelectorAll('.chip[data-lb]').forEach(c => c.addEventListener('click', () => privPage(c.dataset.lb)));
  }

  async function viewer(kind, id) {
    app.innerHTML = '<p class="loading">ENTSCHLÜSSLE DOKUMENT …</p>';
    const list = kind === 'v' ? await getLect() : await getPriv();
    const v = list.find(x => x.id === id);
    if (!v) { location.hash = kind === 'v' ? '#/vorlesungen' : '#/privat'; return; }
    const ck = kind + id;
    if (!blobCache[ck]) {
      const buf = await decryptFile(kind === 'v' ? key : pkey, `data/${kind}/${id}.bin`);
      blobCache[ck] = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
    }
    const url = blobCache[ck];
    const back = kind === 'v' ? `#/lb/${v.lb}` : '#/privat';
    let tasksHTML = '';
    if (kind === 'v' && v.tasks.length) {
      const all = await getAll();
      const found = [];
      all.forEach((lb, i) => lb.tasks.forEach(t => { if (v.tasks.includes(t.id)) found.push(`<a class="minitask" href="#/lb/${i + 1}/${t.id}"><b>${t.year} · ${esc(t.nr)}</b> ${esc(t.topic)}</a>`); }));
      tasksHTML = `<div class="box"><div class="lbl">Passende Prüfungsaufgaben</div><div class="minitasks">${found.join('')}</div></div>`;
    }
    app.innerHTML = `
      <div class="pagehead"><a class="back" href="${back}" id="vback" aria-label="Zurück">←</a>
        <div><h1>${esc(v.title)}</h1><div class="meta">LB${v.lb} · ${esc(LB[v.lb].full)} · ${v.pages} Seiten</div></div></div>
      <div class="task-layout">
        <aside class="side">
          <div class="box" style="display:grid;gap:8px">
            <div class="lbl">Dokument</div>
            <a class="btn" href="${url}" target="_blank" rel="noopener">IN NEUEM TAB ÖFFNEN</a>
            <a class="btn ghost" href="${url}" download="${esc(v.file)}">HERUNTERLADEN</a>
          </div>
          ${tasksHTML}
        </aside>
        <div class="pdfwrap"><iframe class="pdf" src="${url}#view=FitH" title="${esc(v.title)}"></iframe>
          <p class="pdfhint">Wird das Dokument nicht angezeigt (z. B. am Handy)? Nutze „In neuem Tab öffnen“ oder „Herunterladen“.</p></div>
      </div>`;
    document.getElementById('vback').addEventListener('click', e => { if (history.length > 1) { e.preventDefault(); history.back(); } });
    window.scrollTo(0, 0);
  }

  async function listAll() {
    app.innerHTML = '<p class="loading">ENTSCHLÜSSLE …</p>';
    const all = await getAll();
    let html = '';
    all.forEach((lb, i) => {
      const ts = lb.tasks;
      html += `<div class="sechead"><h2 style="color:${LB[i + 1].accent}">LB${i + 1} <span>·</span> ${esc(LB[i + 1].name.toUpperCase())}</h2></div>
               <div class="cards">${ts.map(t => cardHTML(t, i + 1)).join('')}</div>`;
    });
    app.innerHTML = `
      <div class="pagehead"><a class="back" href="#/" aria-label="Zurück">←</a>
        <div><h1>Alle Aufgaben</h1><div class="meta">66 Aufgaben aus 8 Prüfungsjahren</div></div></div>
      ${html}`;
  }

  async function taskPage(n, id) {
    app.innerHTML = '<p class="loading">ENTSCHLÜSSLE …</p>';
    const [data, lectAll] = await Promise.all([getLB(n), getLect()]);
    const i = data.tasks.findIndex(t => t.id === id);
    if (i < 0) { location.hash = `#/lb/${n}`; return; }
    const t = data.tasks[i], prev = data.tasks[i - 1], next = data.tasks[i + 1];
    const tl = [...new Set([...(t.lectures || []), ...lectAll.filter(v => (v.tasks || []).includes(t.id)).map(v => v.id)])];
    app.innerHTML = `
      <div class="pagehead"><a class="back" href="#/lb/${n}" aria-label="Zurück">←</a>
        <div><h1>${esc(t.topic)}</h1><div class="meta">LB${n} · ${esc(LB[n].name)} · ${label(t)}</div></div></div>
      <div class="task-layout">
        <aside class="side">
          <div class="box">
            <div class="lbl">Steckbrief</div>
            <div class="kv"><span>Jahr</span><b>${t.year}</b></div>
            <div class="kv"><span>Teil</span><b>${PART[t.part]}</b></div>
            <div class="kv"><span>Aufgabe</span><b>${esc(t.nr)}</b></div>
            <div class="kv"><span>Punkte</span><b>${t.be} BE</b></div>
            <div class="kv"><span>Zeit</span><b>${t.minutes} min</b></div>
          </div>
          ${timerHTML(t, n)}
          <div class="box" style="display:grid;gap:8px">
            <div class="lbl">Aktionen</div>
            <button class="btn" id="showSol">LÖSUNG ZEIGEN</button>
            <button class="btn lectbtn" id="lectBtn" ${tl.length ? '' : 'disabled'}>📚 ${tl.length ? `VORLESUNG${tl.length > 1 ? 'EN' : ''} (${tl.length})` : 'KEINE VORLESUNG'}</button>
            <div class="nav2">
              <a class="btn ghost" href="#/lb/${n}/${prev?.id || ''}" ${prev ? '' : 'disabled'}>← ZURÜCK</a>
              <a class="btn ghost" href="#/lb/${n}/${next?.id || ''}" ${next ? '' : 'disabled'}>WEITER →</a>
            </div>
          </div>
        </aside>
        <div>
          <section class="panel aufgabe"><h2>📝 AUFGABENSTELLUNG</h2><div class="content">${t.task}</div></section>
          <section class="panel loesung" id="sol">
            <h2>✅ LÖSUNG</h2>
            <div class="reveal" id="reveal"><p>Erst selbst probieren – dann aufdecken.</p><button class="btn" id="showSol2">LÖSUNG AUFDECKEN</button></div>
            <div id="solBody" hidden>
              <div class="content">${t.solution}</div>
              ${t.check ? `<div class="info check">${t.check}</div>` : ''}
              ${t.extra ? `<div class="info extra">${t.extra}</div>` : ''}
            </div>
          </section>
        </div>
      </div>`;
    const reveal = () => {
      document.getElementById('reveal').hidden = true;
      document.getElementById('solBody').hidden = false;
      document.getElementById('showSol').textContent = 'ZUR LÖSUNG ↓';
      document.getElementById('sol').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    document.getElementById('showSol').onclick = reveal;
    document.getElementById('showSol2').onclick = reveal;
    bindTimer(t.id);
    document.getElementById('lectBtn').onclick = async () => {
      const lect = await getLect();
      const items = tl.map(id => lect.find(v => v.id === id)).filter(Boolean);
      let html = items.map(v => `<a class="lectitem" href="#/vorlesung/${v.id}" data-close><span>📄</span><span><b>${esc(v.title)}${isNew(v) ? ' <em class="neu">NEU</em>' : ''}</b><small>LB${v.lb} · ${esc(v.topic)} · ${v.pages} Seiten</small></span><span class="go">→</span></a>`).join('');
      if (pkey) {
        const zf = (await getPriv()).filter(z => (z.lect || []).some(id => tl.includes(id)));
        if (zf.length) html += `<div class="privhead">🔐 PRIVAT · ZUSAMMENFASSUNGEN</div>` +
          zf.map(z => `<a class="lectitem priv" href="#/privat/${z.id}" data-close><span>🗝️</span><span><b>${esc(z.title)}</b><small>LB${z.lb} · Zusammenfassung · ${z.pages} Seiten</small></span><span class="go">→</span></a>`).join('');
      }
      document.getElementById('lectList').innerHTML = html;
      openModal('lect');
    };
    window.scrollTo(0, 0);
  }

  /* ---------- Upload (Lehrkräfte) ---------- */
  const UPLOAD = window.__UPLOAD || '';
  function uploadPage() {
    const code = store.get('localStorage', 'abi-upcode') || '';
    app.innerHTML = `
      <div class="pagehead"><a class="back" href="#/" aria-label="Zurück">←</a>
        <div><h1>Vorlesung hochladen</h1><div class="meta">Für Lehrkräfte · PDFs werden automatisch eingeordnet, verschlüsselt und veröffentlicht</div></div></div>
      ${UPLOAD ? '' : '<p class="empty" style="margin:18px 0">⚠️ Der Upload-Dienst ist noch nicht eingerichtet.</p>'}
      <div class="uplayout">
        <section class="panel">
          <h2 style="color:var(--green)">⬆️ HOCHLADEN</h2>
          <label class="fld"><span>Upload-Code</span>
            <input id="upcode" type="password" autocomplete="off" value="${esc(code)}" placeholder="Code vom Seitenbetreiber"></label>
          <label class="fld"><span>Lernbereich</span>
            <select id="uplb"><option value="0">Automatisch erkennen</option>${Object.entries(LB).map(([n, l]) => `<option value="${n}">LB${n} · ${esc(plain(l.name))}</option>`).join('')}</select></label>
          <label class="drop" id="drop">
            <input type="file" id="upfile" accept="application/pdf,.pdf" multiple hidden>
            <span class="dropico">📄</span>
            <b>PDF hierher ziehen</b><small>oder klicken zum Auswählen · max. 25 MB · mehrere möglich</small>
          </label>
          <div id="uplist" class="uplist"></div>
        </section>
        <aside class="panel uphelp">
          <h2>ℹ️ SO FUNKTIONIERT'S</h2>
          <ol>
            <li>Upload-Code eingeben (wird im Browser gemerkt).</li>
            <li>PDF auswählen – den Lernbereich kannst du angeben oder erkennen lassen.</li>
            <li>Die Datei wird automatisch gelesen und einem <b>Lernbereich</b>, einem <b>Thema</b> und passenden <b>Prüfungsaufgaben</b> zugeordnet.</li>
            <li>Nach ca. 1–2 Minuten erscheint hier das Ergebnis – und die Vorlesung ist auf der Seite.</li>
          </ol>
          <p class="empty">Tipp: Aussagekräftige Dateinamen (z. B. „Preisbildung am Markt.pdf“) werden als Titel verwendet.</p>
        </aside>
      </div>`;
    const input = document.getElementById('upfile'), drop = document.getElementById('drop');
    input.onchange = () => { handle([...input.files]); input.value = ''; };
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => handle([...e.dataTransfer.files]));
  }
  function b64file(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
  }
  async function handle(files) {
    const code = document.getElementById('upcode').value.trim();
    const lb = document.getElementById('uplb').value;
    const list = document.getElementById('uplist');
    if (!UPLOAD) { alertRow(list, 'Upload-Dienst noch nicht eingerichtet.'); return; }
    if (!code) { alertRow(list, 'Bitte zuerst den Upload-Code eingeben.'); document.getElementById('upcode').focus(); return; }
    store.set('localStorage', 'abi-upcode', code);
    for (const f of files) {
      const row = document.createElement('div'); row.className = 'uprow';
      row.innerHTML = `<span class="upico">📄</span><div><b>${esc(f.name)}</b><small class="upst">Wird hochgeladen …</small></div>`;
      list.prepend(row);
      const st = row.querySelector('.upst');
      const fail = m => { row.classList.add('err'); st.textContent = '❌ ' + m; };
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { fail('Nur PDF-Dateien sind erlaubt.'); continue; }
      if (f.size > 25 * 1048576) { fail('Datei ist größer als 25 MB.'); continue; }
      try {
        const body = await b64file(f);
        const r = await fetch(UPLOAD + '/upload', { method: 'POST', headers: { 'X-Upload-Code': code, 'X-LB': lb, 'X-File-Name': encodeURIComponent(f.name), 'Content-Type': 'text/plain' }, body });
        const j = await r.json().catch(() => ({ ok: false, error: 'Antwort unlesbar (' + r.status + ')' }));
        if (!j.ok) { fail(j.error || 'Fehler beim Hochladen'); if (r.status === 401) store.del('localStorage', 'abi-upcode'); continue; }
        row.classList.add('wait'); st.textContent = '⏳ Hochgeladen – wird eingeordnet (ca. 1–2 Minuten) …';
        poll(j.name, code, row, st);
      } catch (e) { fail('Keine Verbindung zum Upload-Dienst.'); }
    }
  }
  function alertRow(list, msg) { const d = document.createElement('div'); d.className = 'uprow err'; d.innerHTML = `<span class="upico">⚠️</span><div><b>${esc(msg)}</b></div>`; list.prepend(d); }
  async function poll(name, code, row, st, tries = 0) {
    if (!document.body.contains(row)) return;
    if (tries > 60) { st.textContent = '⌛ Dauert länger als erwartet – das Ergebnis kommt als Meldung per E-Mail an den Seitenbetreiber.'; return; }
    try {
      const r = await fetch(UPLOAD + '/status?name=' + encodeURIComponent(name), { headers: { 'X-Upload-Code': code } });
      const j = await r.json();
      if (j.ok && !j.pending) {
        const x = j.result; row.classList.remove('wait');
        if (x.status === 'ok') {
          row.classList.add('ok');
          if (x.duplikat) st.innerHTML = `♻️ <b>Schon vorhanden</b> – diese Datei ist bereits auf der Seite (${esc(x.titel || '')}, LB${x.lb}) und wurde nicht doppelt eingetragen.`; else
          st.innerHTML = `✅ Veröffentlicht als <b>LB${x.lb} · ${esc(x.thema)}</b>` + (x.aufgaben && x.aufgaben.length ? `<br>Passt zu: ${x.aufgaben.map(esc).join(' · ')}` : '<br>Keine passenden Prüfungsaufgaben gefunden.') + '<br><span class="upnote">Kann bis zu 10 Minuten dauern, bis sie bei allen erscheint.</span>';
        } else { row.classList.add('err'); st.textContent = '❌ ' + (x.fehler || 'Konnte nicht verarbeitet werden.'); }
        return;
      }
    } catch {}
    setTimeout(() => poll(name, code, row, st, tries + 1), 5000);
  }

  async function randomTask() {
    const all = await getAll();
    const pool = [];
    all.forEach((lb, i) => lb.tasks.forEach(t => pool.push([i + 1, t.id])));
    const [n, id] = pool[Math.floor(Math.random() * pool.length)];
    location.replace(`#/lb/${n}/${id}`);
  }

  /* ---------- Router ---------- */
  async function render() {
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean);
    try {
      if (!parts.length) return home();
      if (parts[0] === 'upload') return uploadPage();
      if (parts[0] === 'privat') {
        if (!pkey) { home(); return requirePriv(render); }
        return parts[1] ? viewer('p', parts[1]) : privPage();
      }
      const needsKey = ['lb', 'zufall', 'alle', 'vorlesungen', 'vorlesung'].includes(parts[0]);
      if (needsKey && !key) { home(); return requireUnlock(render); }
      if (parts[0] === 'vorlesungen') return lectPage();
      if (parts[0] === 'vorlesung' && parts[1]) return viewer('v', parts[1]);
      if (parts[0] === 'lb' && LB[parts[1]]) return parts[2] ? taskPage(parts[1], parts[2]) : listLB(parts[1]);
      if (parts[0] === 'zufall') return randomTask();
      if (parts[0] === 'alle') return listAll();
      location.hash = '#/';
    } catch (err) {
      console.error(err);
      app.innerHTML = `<p class="loading">Fehler beim Laden – bitte Seite neu laden.</p>`;
    }
  }
  window.addEventListener('hashchange', render);

  /* ---------- Sternenhimmel ---------- */
  function stars() {
    const c = document.getElementById('stars'), ctx = c.getContext('2d');
    let pts = [];
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function size() {
      c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
      const n = Math.round(innerWidth * innerHeight / 3500);
      pts = Array.from({ length: n }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, r: Math.random() * 1.3 + .2, p: Math.random() * 6.28, s: Math.random() * .02 + .005 }));
    }
    function draw() {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const s of pts) {
        s.p += s.s;
        ctx.globalAlpha = .35 + .5 * Math.abs(Math.sin(s.p));
        ctx.fillStyle = '#cfe4ff';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * devicePixelRatio, 0, 6.28); ctx.fill();
      }
      if (!reduce) requestAnimationFrame(draw);
    }
    size(); draw(); addEventListener('resize', () => { size(); if (reduce) draw(); });
  }

  /* ---------- Start ---------- */
  stars();
  restoreKey().then(() => { updateLockBtn(); render(); });
})();
