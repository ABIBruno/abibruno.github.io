/* ABIdasmuss – Geschichte · Methodenwerkstatt
   Gleiches Konzept wie Geso/Deutsch: Inhalte liegen verschlüsselt (AES-GCM, Schlüssel per PBKDF2 aus dem Passwort)
   in data/w.js (Schemata, Operatoren, Übungen) und data/p/*.bin (Original-PDFs/Word) und werden erst im Browser entschlüsselt.
   Quelle/Build: privates Repo ABIdasmuss-Werkzeuge, Ordner geschichte/. */
(() => {
  'use strict';

  const META = window.__META;
  const app = document.getElementById('app');
  const KEYNAME = 'abi-geschichte-key';
  let key = null, data = null, pending = null;

  const store = {
    get(s, k) { try { return window[s].getItem(k); } catch { return null; } },
    set(s, k, v) { try { window[s].setItem(k, v); } catch {} },
    del(s, k) { try { window[s].removeItem(k); } catch {} },
  };
  const jget = (k, d) => { try { return JSON.parse(store.get('localStorage', k)) ?? d; } catch { return d; } };
  const jset = (k, v) => store.set('localStorage', k, JSON.stringify(v));

  /* ---------- Krypto ---------- */
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  async function deriveKey(pw) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(META.salt), iterations: META.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function decrypt(k, blob) {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, k, b64(blob.ct)));
  }
  async function tryKey(k) { try { return (await decrypt(k, META.check)) === 'ABIdasmuss-geschichte-ok'; } catch { return false; } }
  async function restoreKey() {
    try {
      const raw = store.get('sessionStorage', KEYNAME);
      if (raw) { const k = await crypto.subtle.importKey('raw', b64(raw), { name: 'AES-GCM' }, true, ['decrypt']); if (await tryKey(k)) key = k; }
    } catch {}
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src + '?v=' + (window.__V || '1'); s.onload = res; s.onerror = () => rej(new Error('Laden fehlgeschlagen: ' + src));
      document.head.appendChild(s);
    });
  }
  let loading = null;
  function getData() {
    if (data) return Promise.resolve(data);
    return loading || (loading = (async () => {
      if (!window.__ENC || !window.__ENC.w) await loadScript('data/w.js');
      data = JSON.parse(await decrypt(key, window.__ENC.w));
      return data;
    })().finally(() => { loading = null; }));
  }
  const fileCache = {};
  async function fileURL(d) {
    if (fileCache[d.id]) return fileCache[d.id];
    const res = await fetch(`data/p/${d.id}.bin?v=${window.__V || '1'}`);
    if (!res.ok) throw new Error('Datei nicht gefunden');
    const buf = new Uint8Array(await res.arrayBuffer());
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12) }, key, buf.subarray(12));
    return (fileCache[d.id] = URL.createObjectURL(new Blob([pt], { type: d.mime || 'application/octet-stream' })));
  }

  /* ---------- Sperre ---------- */
  const lockModal = document.getElementById('m-lock');
  const pwInput = document.getElementById('pw'), pwErr = document.getElementById('pwErr'), lockBtn = document.getElementById('lockBtn');
  function updateLockBtn() {
    lockBtn.textContent = key ? '🔓' : '🔒';
    lockBtn.title = key ? 'Wieder sperren' : 'Entsperren';
    lockBtn.setAttribute('aria-label', lockBtn.title);
  }
  function requireUnlock(then) {
    if (key) return then();
    pending = then; pwErr.hidden = true; pwInput.value = '';
    openModal('lock'); setTimeout(() => pwInput.focus(), 50);
  }
  document.getElementById('lockForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('pwBtn');
    btn.disabled = true; btn.textContent = 'PRÜFE …';
    const k = await deriveKey(pwInput.value.trim());
    btn.disabled = false; btn.textContent = 'ENTSPERREN';
    if (await tryKey(k)) {
      key = k; store.set('sessionStorage', KEYNAME, toB64(await crypto.subtle.exportKey('raw', k)));
      updateLockBtn(); closeModals();
      const p = pending; pending = null; p ? p() : render();
    } else {
      pwErr.hidden = false;
      const box = lockModal.querySelector('.modal-box');
      box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      pwInput.select();
    }
  });
  lockBtn.addEventListener('click', () => {
    if (key) {
      key = null; data = null;
      for (const k in fileCache) { URL.revokeObjectURL(fileCache[k]); delete fileCache[k]; }
      store.del('sessionStorage', KEYNAME); updateLockBtn();
      location.hash = '#/'; render();
    } else requireUnlock(render);
  });

  /* ---------- Modals, Hell/Dunkel, Vollbild ---------- */
  function openModal(id) { document.getElementById('m-' + id).classList.add('open'); }
  function closeModals() { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); }
  function dismissModals() {
    if (lockModal.classList.contains('open') && pending && !key) { pending = null; if (!location.hash || location.hash === '#/') render(); else location.hash = '#/'; }
    closeModals();
  }
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) openModal(o.dataset.open);
    if (e.target.closest('[data-close]') || e.target.classList.contains('modal')) dismissModals();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('.modal.open')) dismissModals(); });
  const themeBtn = document.getElementById('themeBtn');
  function setTheme(t, save) {
    document.documentElement.dataset.theme = t;
    themeBtn.textContent = t === 'light' ? '🌙' : '☀️';
    themeBtn.title = t === 'light' ? 'Dunkler Modus' : 'Heller Modus';
    themeBtn.setAttribute('aria-label', themeBtn.title);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f4f6fb' : '#05070f');
    if (save) store.set('localStorage', 'abi-theme', t);
  }
  setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', false);
  themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true));
  document.getElementById('fsBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.();
  });

  /* ---------- Hilfen ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plain = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; };
  const ROM = ['', 'I', 'II', 'III'];
  const AFBCOL = { 1: 'var(--cyan)', 2: 'var(--violet)', 3: 'var(--amber)', 0: 'var(--green)' };
  const afbName = n => +n ? `AFB ${ROM[n]}` : 'AFB I–III';
  const lockB = () => key ? '' : '<span class="lockbadge">🔒</span>';
  const head = (title, meta, back = '#/') => `<div class="pagehead"><a class="back" href="${back}" aria-label="Zurück">←</a><div><h1>${esc(title)}</h1>${meta ? `<div class="meta">${meta}</div>` : ''}</div></div>`;
  const kb = n => (n / 1024 > 900 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB').replace('.', ',');

  /* ---------- Startseite ---------- */
  function home() {
    const n = META.n || {};
    app.innerHTML = `
      <section class="hero">
        <h1 class="brand">ABIdasmuss</h1>
        <p class="subtitle">Die Geschichts-Methodenwerkstatt</p>
        <p class="tagline">Quellen interpretieren · Operatoren anwenden · Schritt für Schritt</p>
      </section>
      <div class="sechead"><h2>WERKZEUGE</h2></div>
      <div class="tiles">
        <a class="tile" style="--accent:var(--cyan)" href="#/schema/text">${lockB()}<span class="emoji">📜</span><span class="t">Textquellen</span><span class="s">Interpretations-Schema</span></a>
        <a class="tile" style="--accent:var(--violet)" href="#/schema/bild">${lockB()}<span class="emoji">🖼️</span><span class="t">Bildquellen</span><span class="s">Interpretations-Schema</span></a>
        <a class="tile" style="--accent:var(--amber)" href="#/operatoren">${lockB()}<span class="emoji">🧭</span><span class="t">Operatoren</span><span class="s">${n.operatoren || ''} Operatoren · AFB I–III</span></a>
        <a class="tile" style="--accent:var(--green)" href="#/trainer">${lockB()}<span class="emoji">🎯</span><span class="t">Operator-Trainer</span><span class="s">Quiz zum Üben</span></a>
      </div>
      <div class="sechead"><h2><b>${n.uebungen || ''}</b> ÜBUNGEN</h2></div>
      <div class="tiles g3">
        <a class="tile" style="--accent:var(--lb5)" href="#/uebung/vesuv">${lockB()}<span class="lbtag">TEXT</span><span class="emoji">🌋</span><span class="t">Vesuv 79 n. Chr.</span><span class="s">Plinius-Briefe &amp; SPIEGEL-Artikel</span></a>
        <a class="tile" style="--accent:var(--lb3)" href="#/uebung/falling-man">${lockB()}<span class="lbtag">BILD</span><span class="emoji">📷</span><span class="t">The Falling Man</span><span class="s">Pressefoto 11. September 2001</span></a>
        <a class="tile" style="--accent:var(--sky)" href="#/material">${lockB()}<span class="emoji">📚</span><span class="t">Material</span><span class="s">${n.dateien || ''} Originaldateien</span></a>
      </div>
      <p class="wip">🛠️ Die Werkstatt wächst: Die Grundlagen sind da, weitere Module aus dem Unterricht folgen.</p>
      <div class="sechead"><h2>EXTRAS</h2></div>
      <div class="tiles g3">
        <button class="tile" data-open="about"><span class="emoji">💡</span><span class="t">So geht's</span><span class="s">Kurze Anleitung</span></button>
        <a class="tile" href="#/zufall">${lockB()}<span class="emoji">🎲</span><span class="t">Zufallsübung</span><span class="s">Überrasch mich</span></a>
      </div>`;
  }

  /* ---------- Schema als Checkliste ---------- */
  function schemaPage(id) {
    const s = data.schemata[id]; if (!s) { location.hash = '#/'; return; }
    const ck = 'abi-gesch-check-' + id, done = new Set(jget(ck, []));
    let total = 0;
    const phases = s.phasen.map((p, pi) => `
      <section class="panel phase p${pi + 1}"><h2><span class="pnr">${pi + 1}</span>${esc(p.name.toUpperCase())}</h2>
        ${p.gruppen.map((g, gi) => `<div class="grp"><h3>${esc(g.titel)}</h3><ol class="qlist">${g.fragen.map((f, fi) => {
          const qid = `${pi}-${gi}-${fi}`; total++;
          return `<li><label><input type="checkbox" data-q="${qid}"${done.has(qid) ? ' checked' : ''}><span class="qnr">${fi + 1}.</span><span>${f}</span></label></li>`; }).join('')}</ol></div>`).join('')}
      </section>`).join('');
    const ueb = data.uebungen.filter(u => u.schema === id);
    const df = data.dateien.find(d => d.id === s.datei);
    app.innerHTML = `${head(s.title, esc(s.kurz))}
      <div class="task-layout">
        <aside class="side">
          <div class="box"><div class="lbl">Fortschritt</div><div class="progress"><i id="prog"></i></div><small id="progTxt" class="meta"></small></div>
          <div class="box" style="display:grid;gap:8px"><div class="lbl">Aktionen</div>
            <button class="btn ghost" id="reset">HÄKCHEN ZURÜCKSETZEN</button>
            <button class="btn ghost" id="print">🖨️ ALS SPICKZETTEL DRUCKEN</button>
            ${df ? `<a class="btn ghost" href="#/datei/${df.id}">📄 ORIGINAL-ARBEITSBLATT</a>` : ''}
          </div>
          ${ueb.length ? `<div class="box"><div class="lbl">Direkt üben</div><ul class="mini">${ueb.map(u => `<li>${u.emoji} <a href="#/uebung/${u.id}">${esc(u.title)}</a></li>`).join('')}</ul></div>` : ''}
        </aside>
        <div>
          <p class="ghint noprint">Nutze die Fragen als Checkliste, während du interpretierst – abgehakte Punkte werden in deinem Browser gemerkt.</p>
          ${phases}
          ${s.merke ? `<div class="merke">💡 ${s.merke}</div>` : (id === 'text' ? `<div class="merke">💡 ${data.schemata.bild.merke}</div>` : '')}
        </div>
      </div>`;
    const upd = () => {
      const n = app.querySelectorAll('[data-q]:checked').length;
      document.getElementById('prog').style.width = (100 * n / total) + '%';
      document.getElementById('progTxt').textContent = `${n} von ${total} Fragen bearbeitet`;
    };
    app.querySelectorAll('[data-q]').forEach(c => c.onchange = () => {
      c.checked ? done.add(c.dataset.q) : done.delete(c.dataset.q); jset(ck, [...done]); upd();
    });
    document.getElementById('reset').onclick = () => { done.clear(); jset(ck, []); app.querySelectorAll('[data-q]').forEach(c => c.checked = false); upd(); };
    document.getElementById('print').onclick = () => print();
    upd();
  }

  /* ---------- Operatoren ---------- */
  let opFilter = 'alle', opQuery = '';
  function opsPage() {
    const chips = ['alle', '1', '2', '3', '0'].map(a => `<button class="chip${opFilter === a ? ' on' : ''}" data-afb="${a}">${a === 'alle' ? 'ALLE' : esc(afbName(a))}</button>`).join('');
    app.innerHTML = `${head('Operatoren im Fach Geschichte', 'Drei Anforderungsbereiche (AFB) mit gestuftem Schwierigkeitsgrad')}
      <div class="afbinfo">${['1', '2', '3'].map(a => `<div style="border-color:color-mix(in srgb,${AFBCOL[a]} 45%,transparent)"><b style="color:${AFBCOL[a]}">AFB ${ROM[a]} · ${esc(data.afb[a].name.toUpperCase())}</b>${esc(data.afb[a].text)}</div>`).join('')}</div>
      <div class="searchrow"><label class="search"><span>🔍</span><input id="oq" type="search" placeholder="Operator suchen …" autocomplete="off" value="${esc(opQuery)}"></label></div>
      <div class="chips">${chips}</div>
      <div class="opgrid" id="ops"></div>
      <p style="text-align:center;margin-top:22px"><a class="btn" href="#/trainer">🎯 JETZT IM TRAINER ÜBEN</a></p>`;
    const draw = () => {
      const q = opQuery.trim().toLowerCase();
      const list = data.operatoren.filter(o => (opFilter === 'alle' || String(o.afb) === opFilter) && (!q || (o.name + ' ' + o.erl + ' ' + o.schritte.join(' ')).toLowerCase().includes(q)));
      document.getElementById('ops').innerHTML = list.length ? list.map(o => `
        <article class="op" style="--accent:${AFBCOL[o.afb]}"><div class="afb">${afbName(o.afb)}</div><h3>${esc(o.name)}</h3><p>${esc(o.erl)}</p>
          ${o.schritte.length ? `<details><summary>Arbeitsschritte (${o.schritte.length})</summary><ol>${o.schritte.map(s => `<li>${esc(s)}</li>`).join('')}</ol></details>` : ''}
        </article>`).join('') : '<p class="empty">Kein Operator gefunden.</p>';
    };
    app.querySelectorAll('[data-afb]').forEach(b => b.onclick = () => { opFilter = b.dataset.afb; opsPage(); });
    const inp = document.getElementById('oq');
    inp.oninput = () => { opQuery = inp.value; draw(); };
    draw();
  }

  /* ---------- Operator-Trainer ---------- */
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function trainerPage() {
    const score = jget('abi-gesch-score', { r: 0, n: 0 });
    const ops = data.operatoren;
    const mode = Math.random() < .5 ? 'afb' : 'erl';
    let q, opts, right;
    if (mode === 'afb') {
      q = ops.filter(o => o.afb)[Math.floor(Math.random() * ops.filter(o => o.afb).length)];
      opts = ['1', '2', '3'].map(a => ({ v: a, t: `AFB ${ROM[a]} – ${data.afb[a].name}` })); right = String(q.afb);
    } else {
      q = ops[Math.floor(Math.random() * ops.length)];
      opts = shuffle([q, ...shuffle(ops.filter(o => o !== q)).slice(0, 3)]).map(o => ({ v: o.name, t: o.name })); right = q.name;
    }
    app.innerHTML = `${head('Operator-Trainer', 'Anforderungsbereich zuordnen oder Operator erkennen')}
      <div class="quiz"><div class="qcard">
        <div class="qtype">${mode === 'afb' ? 'WELCHER ANFORDERUNGSBEREICH?' : 'WELCHER OPERATOR IST GEMEINT?'}</div>
        <div class="qtext">${mode === 'afb' ? `Der Operator <b>„${esc(q.name)}“</b>` : `„${esc(q.erl)}“`}</div>
        <div class="ans">${opts.map(o => `<button data-v="${esc(o.v)}">${esc(o.t)}</button>`).join('')}</div>
        <div class="fb" id="fb" hidden></div>
        <div style="margin-top:16px" id="nextWrap" hidden><button class="btn" id="next">NÄCHSTE FRAGE →</button></div>
      </div>
      <div class="score" id="score">${score.r} / ${score.n} RICHTIG</div>
      <p><button class="btn ghost" id="sreset" style="margin-top:10px">PUNKTE ZURÜCKSETZEN</button> <a class="btn ghost" href="#/operatoren" style="margin-top:10px">📖 ALLE OPERATOREN</a></p></div>`;
    app.querySelectorAll('.ans button').forEach(b => b.onclick = () => {
      const ok = b.dataset.v === right;
      app.querySelectorAll('.ans button').forEach(x => { x.disabled = true; if (x.dataset.v === right) x.classList.add('ok'); });
      if (!ok) b.classList.add('no');
      score.n++; if (ok) score.r++; jset('abi-gesch-score', score);
      document.getElementById('score').textContent = `${score.r} / ${score.n} RICHTIG`;
      const fb = document.getElementById('fb'); fb.hidden = false;
      fb.innerHTML = `${ok ? '✅ <b>Richtig!</b>' : '❌ <b>Nicht ganz.</b>'} <b>„${esc(q.name)}“</b> gehört zu ${afbName(q.afb)}: ${esc(q.erl)}.`;
      document.getElementById('nextWrap').hidden = false; document.getElementById('next').focus();
    });
    document.getElementById('next').onclick = trainerPage;
    document.getElementById('sreset').onclick = () => { jset('abi-gesch-score', { r: 0, n: 0 }); document.getElementById('score').textContent = '0 / 0 RICHTIG'; };
  }

  /* ---------- Übung ---------- */
  function matHTML(m) {
    return `<div class="mtyp">MATERIAL ${esc(m.id)} · ${esc(m.typ.toUpperCase())}</div><h3 style="margin:4px 0 14px">${esc(m.title)}</h3>
      <div class="mat">${m.abs.map(p => { const t = plain(p).trim(); return t.length > 80 ? `<p class="num">${p}</p>` : `<p class="head">${p}</p>`; }).join('')}</div>`;
  }
  function uebungPage(id) {
    const u = data.uebungen.find(x => x.id === id); if (!u) { location.hash = '#/'; return; }
    const s = data.schemata[u.schema];
    const files = (u.dateien || []).map(fid => data.dateien.find(d => d.id === fid)).filter(Boolean);
    const nk = 'abi-gesch-notiz-' + id;
    let nStep = 0;
    const ew = u.ew.parts.map(p => `<div class="ewpart"><h3>${esc(p.title)}</h3>${p.steps.map(st => `
      <div class="ewstep"><button aria-expanded="false">${esc(st.title)} <small>aufdecken ▾</small></button><div class="ewb" hidden>${st.html}</div></div>`).join('')}</div>`).join('');
    u.ew.parts.forEach(p => nStep += p.steps.length);
    app.innerHTML = `${head(u.title, `${esc(u.untertitel)} · Schema: ${esc(s.title)}`)}
      <div class="task-layout">
        <aside class="side">
          <div class="box"><div class="lbl">Steckbrief</div>${u.steckbrief.map(([k, v]) => `<div class="kv2"><span>${esc(k)}</span>${esc(v)}</div>`).join('')}</div>
          <div class="box" style="display:grid;gap:8px"><div class="lbl">Aktionen</div>
            <a class="btn ghost" href="#/schema/${u.schema}">${s.emoji} SCHEMA ÖFFNEN</a>
            <button class="btn" id="toEw">ERWARTUNGSBILD</button>
            ${files.map(d => `<a class="btn ghost" href="#/datei/${d.id}">📄 ${esc(d.title.toUpperCase())}</a>`).join('')}
          </div>
          <div class="box"><div class="lbl">Schema-Phasen</div><ul class="mini">${s.phasen.map((p, i) => `<li>${i + 1}. ${esc(p.name)} – ${p.gruppen.map(g => esc(g.titel)).join(' / ')}</li>`).join('')}</ul></div>
        </aside>
        <div>
          <section class="panel aufgabe"><h2>📝 ARBEITSAUFTRAG</h2><div class="content">${u.aufgabe}</div></section>
          ${u.bild ? `<section class="panel"><h2>🖼️ DIE BILDQUELLE</h2><div class="bildbox">⚠️ ${esc(u.bild.hinweis)}<br><br><a class="btn ghost" href="${esc(u.bild.link)}" target="_blank" rel="noopener noreferrer">FOTO BEI WIKIPEDIA ANSEHEN ↗</a></div></section>` : ''}
          ${u.material && u.material.length ? `<section class="panel"><h2>📖 MATERIAL</h2>
            <div class="mtabs">${u.material.map((m, i) => `<button class="chip${i ? '' : ' on'}" data-m="${i}">${esc(m.id)} · ${esc(m.typ.toUpperCase())}</button>`).join('')}</div>
            <div id="matBox">${matHTML(u.material[0])}</div></section>` : ''}
          <section class="panel notes"><h2>✍️ DEINE NOTIZEN</h2><p class="ghint">Erst selbst nach Schema arbeiten – deine Notizen bleiben nur in diesem Browser gespeichert.</p>
            <textarea id="notes" placeholder="Analyse … Erläuterung … Beurteilung …">${esc(store.get('localStorage', nk) || '')}</textarea></section>
          <section class="panel loesung" id="ew"><h2>✅ ERWARTUNGSBILD</h2>
            <div class="reveal" id="reveal"><p>Erst selbst interpretieren – dann Schritt für Schritt vergleichen.</p><button class="btn" id="showEw">ERWARTUNGSBILD ÖFFNEN</button></div>
            <div id="ewBody" hidden>
              <div class="content ewb">${u.ew.intro}</div>
              <p><button class="btn ghost" id="allEw">ALLE ${nStep} SCHRITTE AUFDECKEN</button></p>
              ${ew}
              ${u.ew.outro ? `<div class="merke">${u.ew.outro}</div>` : ''}
            </div></section>
        </div>
      </div>`;
    app.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
      app.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b));
      document.getElementById('matBox').innerHTML = matHTML(u.material[+b.dataset.m]);
    });
    let t; const ta = document.getElementById('notes');
    ta.oninput = () => { clearTimeout(t); t = setTimeout(() => store.set('localStorage', nk, ta.value), 300); };
    const openEw = () => { document.getElementById('reveal').hidden = true; document.getElementById('ewBody').hidden = false; };
    document.getElementById('showEw').onclick = openEw;
    document.getElementById('toEw').onclick = () => { openEw(); document.getElementById('ew').scrollIntoView({ behavior: 'smooth' }); };
    const toggle = (st, open) => {
      open = open ?? !st.classList.contains('open');
      st.classList.toggle('open', open); st.querySelector('.ewb').hidden = !open;
      st.querySelector('button').setAttribute('aria-expanded', open);
      st.querySelector('small').textContent = open ? 'zuklappen ▴' : 'aufdecken ▾';
    };
    app.querySelectorAll('.ewstep>button').forEach(b => b.onclick = () => toggle(b.parentElement));
    document.getElementById('allEw').onclick = () => app.querySelectorAll('.ewstep').forEach(st => toggle(st, true));
    window.scrollTo(0, 0);
  }

  /* ---------- Material / Dateien ---------- */
  function materialPage() {
    const groups = [...new Set(data.dateien.map(d => d.art))];
    app.innerHTML = `${head('Material', 'Originaldateien aus dem Unterricht')}
      ${groups.map(g => `<section class="panel"><h2>${esc(g.toUpperCase())}</h2>${data.dateien.filter(d => d.art === g).map(d => `
        <div class="dlrow"><div><b>${d.ext === '.pdf' ? '📄' : '📝'} ${esc(d.title)}</b><br><small>${esc(d.file)} · ${kb(d.size || 0)}</small></div>
          <div class="acts"><a class="btn ghost" href="#/datei/${d.id}">${d.ext === '.pdf' ? 'ANSEHEN' : 'ÖFFNEN'}</a></div></div>`).join('')}</section>`).join('')}`;
  }
  let navSeq = 0;
  async function filePage(id) {
    const d = data.dateien.find(x => x.id === id); if (!d) { location.hash = '#/material'; return; }
    app.innerHTML = '<p class="loading">ENTSCHLÜSSLE DATEI …</p>';
    const seq = navSeq, url = await fileURL(d);
    if (seq !== navSeq) return;
    const pdf = d.ext === '.pdf';
    app.innerHTML = `<div class="pagehead"><a class="back" href="#/material" id="fback" aria-label="Zurück">←</a><div><h1>${esc(d.title)}</h1><div class="meta">${esc(d.art)} · ${esc(d.file)}</div></div></div>
      <div class="task-layout">
        <aside class="side"><div class="box" style="display:grid;gap:8px"><div class="lbl">Dokument</div>
          ${pdf ? `<a class="btn" href="${url}" target="_blank" rel="noopener">IN NEUEM TAB ÖFFNEN</a>` : ''}
          <a class="btn ${pdf ? 'ghost' : ''}" href="${url}" download="${esc(d.file)}">HERUNTERLADEN</a></div></aside>
        ${pdf ? `<div class="pdfwrap"><iframe class="pdf" src="${url}#view=FitH" title="${esc(d.title)}"></iframe>
          <p class="pdfhint">Wird das PDF nicht angezeigt (z. B. am Handy)? Nutze „In neuem Tab öffnen“ oder „Herunterladen“.</p></div>`
        : `<section class="panel"><h2>📝 WORD-DOKUMENT</h2><p>Word-Dateien kann der Browser nicht direkt anzeigen. Lade die Datei herunter und öffne sie in Word oder OneDrive.</p>
          <p class="ghint">Den Inhalt findest du auch direkt in der passenden Übung.</p></section>`}
      </div>`;
    document.getElementById('fback').addEventListener('click', e => { if (history.length > 1) { e.preventDefault(); history.back(); } });
  }

  /* ---------- Router ---------- */
  async function render() {
    navSeq++;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    try {
      if (!parts.length) return home();
      if (!key) { home(); return requireUnlock(render); }
      app.innerHTML = '<p class="loading">ENTSCHLÜSSLE …</p>';
      await getData();
      window.scrollTo(0, 0);
      switch (parts[0]) {
        case 'schema': return schemaPage(parts[1]);
        case 'operatoren': return opsPage();
        case 'trainer': return trainerPage();
        case 'uebung': return uebungPage(parts[1]);
        case 'material': return materialPage();
        case 'datei': return await filePage(parts[1]);
        case 'zufall': { const u = data.uebungen[Math.floor(Math.random() * data.uebungen.length)]; return location.replace('#/uebung/' + u.id); }
      }
      location.hash = '#/';
    } catch (err) {
      console.error(err);
      app.innerHTML = '<p class="loading">Fehler beim Laden – bitte Seite neu laden.</p>';
    }
  }
  window.addEventListener('hashchange', render);

  /* ---------- Sternenhimmel ---------- */
  function stars() {
    const c = document.getElementById('stars'), ctx = c.getContext('2d');
    let pts = [], last = 0, rt;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, dpr = Math.min(devicePixelRatio || 1, 2);
    function size() {
      c.width = innerWidth * dpr; c.height = innerHeight * dpr;
      pts = Array.from({ length: Math.round(innerWidth * innerHeight / 3500) }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, r: Math.random() * 1.3 + .2, p: Math.random() * 6.28, s: Math.random() * .02 + .005 }));
    }
    function draw(now = 0) {
      if (!reduce) requestAnimationFrame(draw);
      if (now - last < 33) return;
      const step = last ? Math.min((now - last) / 16.7, 4) : 1; last = now;
      ctx.clearRect(0, 0, c.width, c.height); ctx.fillStyle = '#ffe2bf';
      for (const s of pts) { s.p += s.s * step; ctx.globalAlpha = .35 + .5 * Math.abs(Math.sin(s.p)); ctx.beginPath(); ctx.arc(s.x, s.y, s.r * dpr, 0, 6.28); ctx.fill(); }
    }
    size(); draw(); if (reduce) draw(34);
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { size(); if (reduce) { last = 0; draw(34); } }, 150); });
  }

  stars();
  restoreKey().then(() => { updateLockBtn(); render(); });
})();
