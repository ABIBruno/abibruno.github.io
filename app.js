/* ABIdasmuss – VBWL-Abiturtrainer
   Inhalte liegen verschlüsselt (AES-GCM, Schlüssel per PBKDF2 aus dem Passwort) in data/lbN.js
   und werden erst im Browser nach Passworteingabe entschlüsselt. */
(() => {
  'use strict';

  const META = window.__META;
  const LB = {
    1: { name: 'Beschaffung', full: 'Beschaffung von Produktionsfaktoren', emoji: '📦', accent: '#38d6ff' },
    2: { name: 'Leistungs\u00ADerstellung', full: 'Leistungserstellung (Kosten- und Leistungsrechnung)', emoji: '🏭', accent: '#ffd24a' },
    3: { name: 'Marketing', full: 'Marketing', emoji: '📣', accent: '#f08ad8' },
    4: { name: 'Finanzie\u00ADrung', full: 'Finanzierungsprozesse im Unternehmen', emoji: '💰', accent: '#5be3a1' },
    5: { name: 'Wirtschafts\u00ADpolitik', full: 'Wirtschaftspolitisches Handeln des Staates / Markt und Preis', emoji: '🏛️', accent: '#ff9f5a' },
    6: { name: 'Geldpolitik', full: 'Geldtheorie und Geldpolitik', emoji: '🏦', accent: '#b58cff' },
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
        <span class="badge be">${t.be} BE</span>
      </div>
      <h3>${twoTone(t.topic)}</h3>
      <p>LB${lbn} · ${esc(LB[lbn].name)} · ${label(t)}</p>
    </a>`;
  }

  const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  function lectCardHTML(v, kind = 'v') {
    const acc = LB[v.lb]?.accent || 'var(--cyan)';
    const href = kind === 'v' ? `#/vorlesung/${v.id}` : `#/privat/${v.id}`;
    const n = v.tasks ? v.tasks.length : 0;
    return `<a class="card lect" style="--accent:${acc}" href="${href}">
      <div class="top">
        <span class="badge" style="color:${acc};border-color:${acc}66">LB${v.lb}</span>
        ${v.topic ? `<span class="badge part">${esc(v.topic)}</span>` : ''}
        <span class="badge">${v.pages} S.</span>
      </div>
      <h3><span class="docico">${kind === 'v' ? '📄' : '🔐'}</span>${twoTone(v.title)}</h3>
      <p>${kind === 'v' ? (n ? `Passt zu ${n} Prüfungsaufgabe${n > 1 ? 'n' : ''}` : 'Grundlagen') : 'Zusammenfassung'} · ${mb(v.size)}</p>
    </a>`;
  }
  function topicChips(list, active, attr = 'data-topic') {
    const topics = [...new Set(list.map(v => v.topic))];
    return `<div class="chips">${['alle', ...topics].map(o => `<button class="chip${o === active ? ' on' : ''}" ${attr}="${esc(o)}">${o === 'alle' ? 'ALLE THEMEN' : esc(o.toUpperCase())}</button>`).join('')}</div>`;
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
        <a class="tile" style="--accent:#9ad8ff" href="#/vorlesungen">${key ? '' : '<span class="lockbadge">🔒</span>'}<span class="emoji">📚</span><span class="t">Vorlesungen</span><span class="s">Nach Thema filtern</span></a>
        <a class="tile" href="#/zufall"><span class="emoji">🎲</span><span class="t">Zufalls&shy;aufgabe</span><span class="s">Überrasch mich</span></a>
        <a class="tile" href="#/alle"><span class="emoji">🚀</span><span class="t">Alle Aufgaben</span><span class="s">66 Aufgaben</span></a>
        <a class="tile" style="--accent:#f08ad8" href="#/privat"><span class="lockbadge">${pkey ? '🔓' : '🔐'}</span><span class="emoji">🗝️</span><span class="t">Privat</span><span class="s">Extra-Passwort</span></a>
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
    const lbs = [...new Set(lect.map(v => v.lb))];
    app.innerHTML = `
      <div class="pagehead"><a class="back" href="#/" aria-label="Zurück">←</a>
        <div><h1>Vorlesungen</h1><div class="meta">${lect.length} Vorlesungen aus dem Unterricht · nach Lernbereich und Thema filtern</div></div></div>
      <div class="chips">${['alle', ...lbs].map(o => `<button class="chip${String(o) === String(lbSel) ? ' on' : ''}" data-lb="${o}">${o === 'alle' ? 'ALLE LB' : 'LB' + o + ' · ' + esc(plain(LB[o].name).toUpperCase())}</button>`).join('')}</div>
      ${lbSel === 'alle' ? '' : topicChips(inLb, topic)}
      <div class="cards">${shown.map(v => lectCardHTML(v)).join('')}</div>
      <p class="empty" style="margin-top:22px">Für LB6 (Geldpolitik) gibt es noch keine Vorlesungen.</p>`;
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
    const data = await getLB(n);
    const i = data.tasks.findIndex(t => t.id === id);
    if (i < 0) { location.hash = `#/lb/${n}`; return; }
    const t = data.tasks[i], prev = data.tasks[i - 1], next = data.tasks[i + 1];
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
          </div>
          <div class="box" style="display:grid;gap:8px">
            <div class="lbl">Aktionen</div>
            <button class="btn" id="showSol">LÖSUNG ZEIGEN</button>
            <button class="btn lectbtn" id="lectBtn" ${t.lectures.length ? '' : 'disabled'}>📚 ${t.lectures.length ? `VORLESUNG${t.lectures.length > 1 ? 'EN' : ''} (${t.lectures.length})` : 'KEINE VORLESUNG'}</button>
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
    document.getElementById('lectBtn').onclick = async () => {
      const lect = await getLect();
      const items = t.lectures.map(id => lect.find(v => v.id === id)).filter(Boolean);
      let html = items.map(v => `<a class="lectitem" href="#/vorlesung/${v.id}" data-close><span>📄</span><span><b>${esc(v.title)}</b><small>LB${v.lb} · ${esc(v.topic)} · ${v.pages} Seiten</small></span><span class="go">→</span></a>`).join('');
      if (pkey) {
        const zf = (await getPriv()).filter(z => (z.lect || []).some(id => t.lectures.includes(id)));
        if (zf.length) html += `<div class="privhead">🔐 PRIVAT · ZUSAMMENFASSUNGEN</div>` +
          zf.map(z => `<a class="lectitem priv" href="#/privat/${z.id}" data-close><span>🗝️</span><span><b>${esc(z.title)}</b><small>LB${z.lb} · Zusammenfassung · ${z.pages} Seiten</small></span><span class="go">→</span></a>`).join('');
      }
      document.getElementById('lectList').innerHTML = html;
      openModal('lect');
    };
    window.scrollTo(0, 0);
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
