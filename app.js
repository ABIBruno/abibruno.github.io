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
  let pending = null;

  /* ---------- Speicher (sicher gekapselt) ---------- */
  const store = {
    get(s, k) { try { return window[s].getItem(k); } catch { return null; } },
    set(s, k, v) { try { window[s].setItem(k, v); } catch {} },
    del(s, k) { try { window[s].removeItem(k); } catch {} },
  };

  /* ---------- Krypto ---------- */
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));

  async function deriveKey(pw) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(META.salt), iterations: META.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function decrypt(k, blob) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, k, b64(blob.ct));
    return new TextDecoder().decode(pt);
  }
  async function tryKey(k) {
    try { return (await decrypt(k, META.check)) === 'ABIdasmuss-ok'; } catch { return false; }
  }
  async function restoreKey() {
    const raw = store.get('sessionStorage', 'abi-key');
    if (!raw) return;
    try {
      const k = await crypto.subtle.importKey('raw', b64(raw), { name: 'AES-GCM' }, true, ['decrypt']);
      if (await tryKey(k)) key = k;
    } catch {}
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Laden fehlgeschlagen: ' + src));
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

  /* ---------- Sperre ---------- */
  const lockModal = document.getElementById('m-lock');
  const pwInput = document.getElementById('pw');
  const pwErr = document.getElementById('pwErr');
  const lockBtn = document.getElementById('lockBtn');

  function updateLockBtn() {
    lockBtn.textContent = key ? '🔓' : '🔒';
    lockBtn.title = key ? 'Wieder sperren' : 'Entsperren';
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
    if (key) {
      key = null; for (const k in cache) delete cache[k];
      store.del('sessionStorage', 'abi-key'); updateLockBtn();
      location.hash = '#/';
      render();
    } else requireUnlock(render);
  });

  /* ---------- Modals ---------- */
  function openModal(id) { document.getElementById('m-' + id).classList.add('open'); }
  function closeModals() { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); }
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) openModal(o.dataset.open);
    if (e.target.closest('[data-close]') || e.target.classList.contains('modal')) {
      if (lockModal.classList.contains('open') && pending && !key) { pending = null; if (!location.hash || location.hash === '#/') render(); else location.hash = '#/'; }
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
      <div class="tiles">
        ${tiles}
        <a class="tile" href="#/zufall"><span class="emoji">🎲</span><span class="t">Zufalls&shy;aufgabe</span><span class="s">Überrasch mich</span></a>
        <a class="tile" href="#/alle"><span class="emoji">🚀</span><span class="t">Alle Aufgaben</span><span class="s">66 Aufgaben</span></a>
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

  async function listLB(n, filter = 'alle') {
    const l = LB[n];
    app.innerHTML = '<p class="loading">ENTSCHLÜSSLE …</p>';
    const data = await getLB(n);
    const tasks = applyFilter(data.tasks, filter);
    app.innerHTML = `
      <div class="pagehead"><a class="back" href="#/" aria-label="Zurück">←</a>
        <div><h1>LB${n} · ${esc(l.name)}</h1><div class="meta">${esc(l.full)} · ${data.tasks.length} Aufgaben</div></div></div>
      ${chipsHTML(data.tasks, filter)}
      <div class="cards">${tasks.map(t => cardHTML(t, n)).join('')}</div>`;
    app.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => listLB(n, c.dataset.f)));
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
      const needsKey = ['lb', 'zufall', 'alle'].includes(parts[0]);
      if (needsKey && !key) { home(); return requireUnlock(render); }
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
