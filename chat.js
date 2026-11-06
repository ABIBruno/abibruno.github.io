/* ABIdasmuss – Schüler-Gruppenchat (VBWL + Geso)
   - Wer nicht weiterkommt, markiert in der Aufgabe eine Teilaufgabe (💬) und landet mit diesem Bezug im Gruppenchat des Fachs.
   - Verschlüsselung: AES-256-GCM im Browser. Der Chat-Schlüssel wird per HKDF-SHA-256 aus dem Schlüssel des Fach-Passworts
     abgeleitet (eigener Schlüssel nur für den Chat, je Fach verschieden). Supabase speichert nur IV + Chiffretext –
     Name, Text und Aufgabenbezug sind dort nicht lesbar. Mitlesen kann nur, wer das Fach-Passwort kennt.
   Konfiguration im HTML: window.__CHAT = { fach: 'vbwl' | 'geso', keyName: '<sessionStorage-Name des Inhaltsschlüssels>' } */
window.AbiChat = (() => {
  const SB_URL = 'https://qnqglxpsyjovkfxgqkpo.supabase.co';
  const SB_KEY = 'sb_publishable_zbOIKKGUYdT14u_qrByNmw_me1W_-4U';   // öffentlicher Schlüssel – Rechte regelt RLS
  const TABLE = SB_URL + '/rest/v1/chat_nachrichten';
  const cfg = window.__CHAT || {};
  const FACH = cfg.fach;
  const NAMEN = { vbwl: 'VBWL', geso: 'Geso' };
  const MAX_TEXT = 1000, MAX_NAME = 30, POLL_MS = 4000;
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} }, del: k => { try { sessionStorage.removeItem(k); } catch {} } };
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const REF_KEY = 'abi-chat-ref-' + FACH;

  // Eigene (zufällige) Kennung, damit eigene Nachrichten rechts erscheinen – verrät nichts über die Person
  let me = ls.get('abi-chat-me');
  if (!me) { me = toB64(crypto.getRandomValues(new Uint8Array(9))); ls.set('abi-chat-me', me); }

  /* ---------- Schlüssel ---------- */
  let ckey = null, ckeyFrom = null;
  async function chatKey() {
    const raw = ss.get(cfg.keyName);
    if (!raw) return null;
    if (raw === ckeyFrom && ckey) return ckey;
    const base = await crypto.subtle.importKey('raw', b64(raw), 'HKDF', false, ['deriveKey']);
    ckey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: te.encode('ABIdasmuss-chat-v1'), info: te.encode('gruppenchat:' + FACH) },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    ckeyFrom = raw;
    return ckey;
  }
  async function seal(obj) {
    const k = await chatKey(); if (!k) throw new Error('gesperrt');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(FACH) }, k, te.encode(JSON.stringify(obj)));
    return { iv: toB64(iv), ct: toB64(ct) };
  }
  async function open(row) {
    try {
      const k = await chatKey();
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(row.iv), additionalData: te.encode(FACH) }, k, b64(row.ct));
      const m = JSON.parse(td.decode(pt));
      if (typeof m.m !== 'string') return null;
      return { id: row.id, at: row.created_at, n: String(m.n || 'Anonym').slice(0, MAX_NAME), m: m.m.slice(0, MAX_TEXT), u: m.u, r: m.r && typeof m.r === 'object' ? m.r : null };
    } catch { return null; }   // nicht entschlüsselbar (fremder Schlüssel / Müll) -> ignorieren
  }

  /* ---------- Supabase (REST) ---------- */
  const H = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  async function laden(afterId) {
    const q = `?select=id,iv,ct,created_at&fach=eq.${FACH}` + (afterId ? `&id=gt.${afterId}&order=id.asc&limit=200` : '&order=id.desc&limit=150');
    const r = await fetch(TABLE + q, { headers: H });
    if (!r.ok) throw new Error('Laden fehlgeschlagen (' + r.status + ')');
    const rows = await r.json();
    return afterId ? rows : rows.reverse();
  }
  async function senden(obj) {
    const r = await fetch(TABLE, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ fach: FACH, ...(await seal(obj)) }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || ('Senden fehlgeschlagen (' + r.status + ')')); }
  }

  /* ---------- Teilaufgaben in der Aufgabe markieren ---------- */
  const TEIL_RE = /^\s*(?:Aufgabe\s+|Teilaufgabe\s+)?[–\-•]?\s*(\d+(?:\.\d+)+|\d+[a-z]?\)|[a-z]\))/i;
  function mark(t, lb) {
    const content = document.querySelector('.panel.aufgabe .content');
    if (!content) return;
    const aufgabe = `${t.year} · ${t.nr}`;
    const go = (teil, txt) => {
      ss.set(REF_KEY, JSON.stringify({ lb: String(lb), id: t.id, a: aufgabe, topic: String(t.topic || '').slice(0, 120), teil, txt: txt.replace(/\s+/g, ' ').trim().slice(0, 320) }));
      location.hash = '#/chat';
    };
    let found = 0;
    content.querySelectorAll(':scope > p, :scope > h3, :scope > h4, :scope > li, :scope > ol > li, :scope > ul > li').forEach(el => {
      const m = el.textContent.match(TEIL_RE);
      if (!m) return;
      found++;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'askbtn'; b.title = `Teilaufgabe ${m[1]} im Gruppenchat fragen`;
      b.textContent = '💬 FRAGEN';
      b.onclick = () => go(m[1].replace(/\)$/, ''), el.textContent);
      el.appendChild(b);
    });
    // Knopf für die ganze Aufgabe in der Aktionen-Box
    const lectBtn = document.getElementById('lectBtn');
    if (lectBtn) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn chatbtn'; b.textContent = '💬 IM GRUPPENCHAT FRAGEN';
      b.title = found ? 'Oder direkt an einer Teilaufgabe auf „💬 FRAGEN“ klicken' : 'Diese Aufgabe im Gruppenchat fragen';
      b.onclick = () => go('', content.textContent);
      lectBtn.insertAdjacentElement('afterend', b);
    }
  }

  /* ---------- Chat-Seite ---------- */
  let session = 0;
  function zeit(iso) {
    const d = new Date(iso), heute = new Date();
    const hm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === heute.toDateString() ? hm : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
  }
  function refHTML(r, withFilter) {
    if (!r || !r.id) return '';
    return `<div class="chatref">
      <a href="#/lb/${encodeURIComponent(r.lb)}/${encodeURIComponent(r.id)}"><b>📌 Aufgabe ${esc(r.a)}${r.teil ? ' · Teil ' + esc(r.teil) : ''}</b>${r.topic ? `<small>${esc(r.topic)}</small>` : ''}</a>
      ${r.txt ? `<blockquote>${esc(r.txt)}</blockquote>` : ''}
      ${withFilter ? `<button type="button" class="linkbtn" data-filter="${esc(r.id)}">Alle Fragen zu dieser Aufgabe</button>` : ''}
    </div>`;
  }
  function msgHTML(m) {
    const mine = m.u && m.u === me;
    return `<div class="chatmsg${mine ? ' mine' : ''}" data-id="${m.id}">
      <div class="chathead"><b>${esc(m.n)}</b><span>${esc(zeit(m.at))}</span></div>
      ${refHTML(m.r, true)}
      <div class="chattext">${esc(m.m).replace(/\n/g, '<br>')}</div>
    </div>`;
  }

  async function page() {
    const app = document.getElementById('app');
    const my = ++session;
    if (!FACH) { app.innerHTML = '<p class="empty">Chat ist hier nicht eingerichtet.</p>'; return; }
    let ref = null;
    try { ref = JSON.parse(ss.get(REF_KEY) || 'null'); } catch {}
    let filter = null, msgs = [], lastId = 0;
    app.innerHTML = `
      <div class="pagehead"><a class="back" href="#/" aria-label="Zurück">←</a>
        <div><h1>Gruppenchat</h1><div class="meta">${NAMEN[FACH]} · 🔒 Ende-zu-Ende verschlüsselt (AES-256) · nur mit dem ${NAMEN[FACH]}-Passwort lesbar</div></div></div>
      <div class="chatwrap">
        <div class="chatfilter" id="chatfilter" hidden></div>
        <div class="chatlog" id="chatlog"><p class="loading">ENTSCHLÜSSLE …</p></div>
        <form class="chatform panel" id="chatform" autocomplete="off">
          <div id="chatdraft"></div>
          <div class="chatrow">
            <input id="chatname" maxlength="${MAX_NAME}" placeholder="Name (Spitzname reicht)" value="${esc(ls.get('abi-chat-name') || '')}">
          </div>
          <textarea id="chatmsg" maxlength="${MAX_TEXT}" rows="3" placeholder="Wo hängst du? Was hast du schon versucht?"></textarea>
          <div class="chatrow"><small class="chatinfo" id="chatinfo">Strg + Enter zum Senden · Nachrichten bleiben 90 Tage sichtbar</small><button class="btn" id="chatsend">SENDEN</button></div>
        </form>
        <p class="empty chatnote">Bitte keine echten Nachnamen, Telefonnummern oder Fotos von anderen. Lösungen erklären statt nur abschreiben lassen 🙂</p>
      </div>`;
    const log = document.getElementById('chatlog'), form = document.getElementById('chatform'), info = document.getElementById('chatinfo');
    const draftBox = document.getElementById('chatdraft'), filterBox = document.getElementById('chatfilter');
    const showDraft = () => {
      draftBox.innerHTML = ref ? `<div class="chatdraft">${refHTML(ref, false)}<button type="button" class="linkbtn" id="dropref" title="Bezug entfernen">✕ Bezug entfernen</button></div>` : '';
      const d = document.getElementById('dropref');
      if (d) d.onclick = () => { ref = null; ss.del(REF_KEY); showDraft(); };
    };
    const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const draw = (keepPos) => {
      const shown = filter ? msgs.filter(m => m.r && m.r.id === filter) : msgs;
      const stick = !keepPos || atBottom();
      log.innerHTML = shown.length ? shown.map(msgHTML).join('') : `<p class="empty">${filter ? 'Zu dieser Aufgabe gibt es noch keine Fragen.' : 'Noch keine Nachrichten – stell die erste Frage!'}</p>`;
      filterBox.hidden = !filter;
      if (filter) {
        const r = (msgs.find(m => m.r && m.r.id === filter) || {}).r;
        filterBox.innerHTML = `<span>Gefiltert: Aufgabe ${esc(r ? r.a : filter)}</span><button type="button" class="chip on" id="nofilter">✕ ALLE NACHRICHTEN</button>`;
        document.getElementById('nofilter').onclick = () => { filter = null; draw(); };
      }
      log.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; draw(); });
      if (stick) log.scrollTop = log.scrollHeight;
    };
    showDraft();
    if (ref) { filter = null; document.getElementById('chatmsg').focus(); }

    async function poll(first) {
      if (my !== session || !document.body.contains(log)) return;
      try {
        const rows = await laden(first ? 0 : lastId);
        if (my !== session) return;
        const neu = (await Promise.all(rows.map(open))).filter(Boolean);
        if (rows.length) lastId = Math.max(lastId, ...rows.map(r => r.id));
        if (first || neu.length) { msgs = msgs.concat(neu); draw(!first); }
      } catch (e) {
        if (first) log.innerHTML = `<p class="empty">⚠️ ${esc(e.message)} – bitte später nochmal versuchen.</p>`;
      }
      setTimeout(() => poll(false), document.hidden ? POLL_MS * 4 : POLL_MS);
    }
    poll(true);

    const send = async () => {
      const name = document.getElementById('chatname').value.trim().slice(0, MAX_NAME);
      const ta = document.getElementById('chatmsg'), text = ta.value.trim().slice(0, MAX_TEXT);
      if (!name) { info.textContent = 'Bitte einen Namen eintragen.'; document.getElementById('chatname').focus(); return; }
      if (!text) { info.textContent = 'Bitte eine Nachricht schreiben.'; ta.focus(); return; }
      ls.set('abi-chat-name', name);
      const btn = document.getElementById('chatsend'); btn.disabled = true; info.textContent = 'Wird verschlüsselt und gesendet …';
      try {
        await senden({ v: 1, n: name, m: text, u: me, r: ref });
        ta.value = ''; ref = null; ss.del(REF_KEY); showDraft();
        info.textContent = 'Gesendet ✓';
      } catch (e) { info.textContent = '❌ ' + e.message; }
      btn.disabled = false;
    };
    form.onsubmit = e => { e.preventDefault(); send(); };
    document.getElementById('chatmsg').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  }

  return { mark, page, enabled: !!FACH };
})();
