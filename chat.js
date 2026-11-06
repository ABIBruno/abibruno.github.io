/* ABIdasmuss – Schüler-Gruppenchat (VBWL + Geso)
   - Wer nicht weiterkommt, markiert in der Aufgabe eine Teilaufgabe (💬) und landet mit diesem Bezug im Gruppenchat des Fachs.
   - Verschlüsselung: AES-256-GCM im Browser. Der Chat-Schlüssel wird per HKDF-SHA-256 aus dem Schlüssel des Fach-Passworts
     abgeleitet (eigener Schlüssel nur für den Chat, je Fach verschieden). Supabase speichert nur IV + Chiffretext –
     Name, Text und Aufgabenbezug sind dort nicht lesbar. Mitlesen kann nur, wer das Fach-Passwort kennt.
   - Antworten (Threads): Die ID der Hauptnachricht steckt im verschlüsselten Inhalt (p) – Supabase sieht keine Thread-Struktur.
   - Löschen: Beim Senden entsteht ein zufälliger Lösch-Token (nur im eigenen Browser). Supabase kennt nur dessen SHA-256-Hash;
     die Funktion chat_loeschen löscht nur bei passendem Token.
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
      return { id: row.id, at: row.created_at, n: String(m.n || 'Anonym').slice(0, MAX_NAME), m: m.m.slice(0, MAX_TEXT), u: m.u, r: !m.p && m.r && typeof m.r === 'object' ? m.r : null, p: Number.isInteger(m.p) && m.p > 0 ? m.p : null };
    } catch { return null; }   // nicht entschlüsselbar (fremder Schlüssel / Müll) -> ignorieren
  }

  /* ---------- Supabase (REST) ---------- */
  const H = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  const COLS = 'id,iv,ct,created_at';
  async function laden(afterId) {
    const q = `?select=${COLS}&fach=eq.${FACH}` + (afterId ? `&id=gt.${afterId}&order=id.asc&limit=200` : '&order=id.desc&limit=200');
    const r = await fetch(TABLE + q, { headers: H });
    if (!r.ok) throw new Error('Laden fehlgeschlagen (' + r.status + ')');
    const rows = await r.json();
    return afterId ? rows : rows.reverse();
  }
  // Welche IDs ab minId gibt es noch? (zum Erkennen gelöschter Nachrichten)
  async function vorhandene(minId) {
    const r = await fetch(TABLE + `?select=id&fach=eq.${FACH}&id=gte.${minId}&order=id.asc&limit=1000`, { headers: H });
    if (!r.ok) throw new Error('Abgleich fehlgeschlagen');
    return new Set((await r.json()).map(x => x.id));
  }
  const sha256hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
  // Lösch-Tokens der eigenen Nachrichten (nur in diesem Browser)
  const DEL_KEY = 'abi-chat-del-' + FACH;
  const delTokens = () => { try { return JSON.parse(ls.get(DEL_KEY) || '{}'); } catch { return {}; } };
  async function senden(obj) {
    const token = toB64(crypto.getRandomValues(new Uint8Array(24)));
    const body = { fach: FACH, ...(await seal(obj)), loesch_hash: await sha256hex(token) };
    const r = await fetch(TABLE + '?select=id', { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || ('Senden fehlgeschlagen (' + r.status + ')')); }
    const [row] = await r.json();
    if (row && row.id) { const t = delTokens(); t[row.id] = token; ls.set(DEL_KEY, JSON.stringify(t)); }
    return row && row.id;
  }
  async function loeschen(id) {
    const t = delTokens();
    if (!t[id]) throw new Error('Diese Nachricht kann nur im Browser gelöscht werden, mit dem sie geschrieben wurde.');
    const r = await fetch(SB_URL + '/rest/v1/rpc/chat_loeschen', { method: 'POST', headers: H, body: JSON.stringify({ p_id: id, p_token: t[id] }) });
    if (!r.ok) throw new Error('Löschen fehlgeschlagen (' + r.status + ')');
    if (!(await r.json())) throw new Error('Löschen nicht erlaubt.');
    delete t[id]; ls.set(DEL_KEY, JSON.stringify(t));
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

  async function page() {
    const app = document.getElementById('app');
    const my = ++session;
    if (!FACH) { app.innerHTML = '<p class="empty">Chat ist hier nicht eingerichtet.</p>'; return; }
    let ref = null;
    try { ref = JSON.parse(ss.get(REF_KEY) || 'null'); } catch {}
    let filter = null, lastId = 0;
    const msgs = new Map();            // id -> entschlüsselte Nachricht
    const offen = new Set();           // Threads, deren Antworten ausgeklappt sind
    let replyTo = null, confirmDel = null;
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
          <textarea id="chatmsg" maxlength="${MAX_TEXT}" rows="3" placeholder="Neue Frage: Wo hängst du? Was hast du schon versucht?"></textarea>
          <div class="chatrow"><small class="chatinfo" id="chatinfo">Strg + Enter zum Senden · Nachrichten bleiben 90 Tage sichtbar</small><button class="btn" id="chatsend">SENDEN</button></div>
        </form>
        <p class="empty chatnote">Bitte keine echten Nachnamen, Telefonnummern oder Fotos von anderen. Lösungen erklären statt nur abschreiben lassen 🙂</p>
      </div>`;
    const log = document.getElementById('chatlog'), info = document.getElementById('chatinfo');
    const draftBox = document.getElementById('chatdraft'), filterBox = document.getElementById('chatfilter');
    const nameVal = () => document.getElementById('chatname').value.trim().slice(0, MAX_NAME);
    const showDraft = () => {
      draftBox.innerHTML = ref ? `<div class="chatdraft">${refHTML(ref, false)}<button type="button" class="linkbtn" id="dropref">✕ Bezug entfernen</button></div>` : '';
      const d = document.getElementById('dropref');
      if (d) d.onclick = () => { ref = null; ss.del(REF_KEY); showDraft(); };
    };

    const mineTok = () => delTokens();
    function bubble(m, isReply, toks) {
      const mine = m.u && m.u === me;
      const kannLoeschen = !!toks[m.id];
      const del = kannLoeschen ? (confirmDel === m.id
        ? `<span class="delask">Wirklich löschen? <button type="button" class="linkbtn danger" data-delyes="${m.id}">Ja, löschen</button> <button type="button" class="linkbtn" data-delno="1">Abbrechen</button></span>`
        : `<button type="button" class="linkbtn" data-del="${m.id}" title="Eigene Nachricht löschen">🗑️ Löschen</button>`) : '';
      return `<div class="chatmsg${mine ? ' mine' : ''}${isReply ? ' reply' : ''}" data-id="${m.id}">
        <div class="chathead"><b>${esc(m.n)}</b><span>${esc(zeit(m.at))}</span></div>
        ${isReply ? '' : refHTML(m.r, true)}
        <div class="chattext">${esc(m.m).replace(/\n/g, '<br>')}</div>
        ${del ? `<div class="chatactions">${del}</div>` : ''}
      </div>`;
    }
    function draw() {
      // Eingaben in einem offenen Antwortfeld über das Neuzeichnen retten
      const rta = log.querySelector('.replybox textarea');
      const rText = rta ? rta.value : '', rFocus = rta && document.activeElement === rta;
      const keepBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80, keepTop = log.scrollTop;
      const toks = mineTok();
      const all = [...msgs.values()].sort((a, b) => a.id - b.id);
      const kids = new Map();
      for (const m of all) if (m.p) { if (!kids.has(m.p)) kids.set(m.p, []); kids.get(m.p).push(m); }
      // Wurzeln: Hauptnachrichten + Platzhalter für Antworten, deren Hauptnachricht gelöscht/zu alt ist
      const roots = all.filter(m => !m.p);
      for (const pid of kids.keys()) if (!msgs.has(pid)) roots.push({ id: pid, gone: true, at: kids.get(pid)[0].at });
      roots.sort((a, b) => a.id - b.id);
      const shown = filter ? roots.filter(m => m.r && m.r.id === filter) : roots;
      log.innerHTML = shown.length ? shown.map(m => {
        const rep = kids.get(m.id) || [];
        const auf = offen.has(m.id) || replyTo === m.id;
        const head = m.gone ? `<div class="chatmsg gone">🗑️ Diese Nachricht wurde gelöscht.</div>` : bubble(m, false, toks);
        const toggle = rep.length ? `<button type="button" class="linkbtn" data-toggle="${m.id}">${auf ? '▾ Antworten ausblenden' : `▸ ${rep.length} Antwort${rep.length > 1 ? 'en' : ''} anzeigen`}</button>` : '';
        const answer = m.gone ? '' : `<button type="button" class="linkbtn" data-reply="${m.id}">↩ Antworten</button>`;
        return `<div class="thread" data-thread="${m.id}">${head}
          <div class="threadbar">${answer}${toggle}</div>
          ${auf && rep.length ? `<div class="replies">${rep.map(r => bubble(r, true, toks)).join('')}</div>` : ''}
          ${replyTo === m.id ? `<div class="replybox"><textarea maxlength="${MAX_TEXT}" rows="2" placeholder="Antwort an ${esc(m.n || '')} … (Strg + Enter)"></textarea><div class="chatrow"><button type="button" class="linkbtn" data-replycancel="1">Abbrechen</button><button type="button" class="btn" data-replysend="${m.id}">ANTWORTEN</button></div></div>` : ''}
        </div>`;
      }).join('') : `<p class="empty">${filter ? 'Zu dieser Aufgabe gibt es noch keine Fragen.' : 'Noch keine Nachrichten – stell die erste Frage!'}</p>`;
      filterBox.hidden = !filter;
      if (filter) {
        const r = (all.find(m => m.r && m.r.id === filter) || {}).r;
        filterBox.innerHTML = `<span>Gefiltert: Aufgabe ${esc(r ? r.a : filter)}</span><button type="button" class="chip on" id="nofilter">✕ ALLE NACHRICHTEN</button>`;
        document.getElementById('nofilter').onclick = () => { filter = null; draw(); };
      }
      const nta = log.querySelector('.replybox textarea');
      if (nta) { nta.value = rText; if (rFocus) nta.focus(); }
      log.scrollTop = keepBottom ? log.scrollHeight : keepTop;
    }

    // Klicks im Verlauf (Antworten, Aufklappen, Löschen, Filtern)
    log.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      const d = b.dataset;
      if (d.filter) { filter = d.filter; draw(); }
      else if (d.toggle) { const id = +d.toggle; offen.has(id) ? offen.delete(id) : offen.add(id); if (replyTo === id) replyTo = null; draw(); }
      else if (d.reply) { replyTo = +d.reply; offen.add(replyTo); draw(); const t = log.querySelector('.replybox textarea'); if (t) { t.focus(); t.scrollIntoView({ block: 'nearest' }); } }
      else if (d.replycancel) { replyTo = null; draw(); }
      else if (d.replysend) await sendReply(+d.replysend);
      else if (d.del) { confirmDel = +d.del; draw(); }
      else if (d.delno) { confirmDel = null; draw(); }
      else if (d.delyes) {
        const id = +d.delyes; b.disabled = true;
        try { await loeschen(id); msgs.delete(id); confirmDel = null; info.textContent = 'Nachricht gelöscht ✓'; draw(); }
        catch (err) { confirmDel = null; info.textContent = '❌ ' + err.message; draw(); }
      }
    });
    log.addEventListener('keydown', e => {
      if (e.target.matches('.replybox textarea') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendReply(replyTo); }
    });

    async function holen(first) {
      const rows = await laden(first ? 0 : lastId);
      if (my !== session) return false;
      const neu = (await Promise.all(rows.map(open))).filter(Boolean);
      if (rows.length) lastId = Math.max(lastId, ...rows.map(r => r.id));
      neu.forEach(m => msgs.set(m.id, m));
      let changed = first || neu.length > 0;
      // gelöschte Nachrichten (auch von anderen) entfernen
      if (!first && msgs.size) {
        const minId = Math.min(...msgs.keys()), noch = await vorhandene(minId);
        for (const id of [...msgs.keys()]) if (!noch.has(id)) { msgs.delete(id); changed = true; }
      }
      return changed;
    }
    async function poll(first) {
      if (my !== session || !document.body.contains(log)) return;
      try { if (await holen(first)) draw(); }
      catch (e) { if (first) log.innerHTML = `<p class="empty">⚠️ ${esc(e.message)} – bitte später nochmal versuchen.</p>`; }
      setTimeout(() => poll(false), document.hidden ? POLL_MS * 4 : POLL_MS);
    }
    showDraft();
    if (ref) document.getElementById('chatmsg').focus();
    poll(true);

    async function abschicken(obj, onOk) {
      const name = nameVal();
      if (!name) { info.textContent = 'Bitte unten einen Namen eintragen.'; document.getElementById('chatname').focus(); return; }
      if (!obj.m) { info.textContent = 'Bitte eine Nachricht schreiben.'; return; }
      ls.set('abi-chat-name', name);
      info.textContent = 'Wird verschlüsselt und gesendet …';
      try { await senden({ v: 2, n: name, u: me, ...obj }); onOk(); info.textContent = 'Gesendet ✓'; await holen(false); draw(); }
      catch (e) { info.textContent = '❌ ' + e.message; }
    }
    async function sendReply(pid) {
      const t = log.querySelector('.replybox textarea'); if (!t || !pid) return;
      const text = t.value.trim().slice(0, MAX_TEXT);
      await abschicken({ m: text, p: pid }, () => { t.value = ''; replyTo = null; offen.add(pid); });
    }
    const sendMain = async () => {
      const ta = document.getElementById('chatmsg');
      const btn = document.getElementById('chatsend'); btn.disabled = true;
      await abschicken({ m: ta.value.trim().slice(0, MAX_TEXT), r: ref }, () => { ta.value = ''; ref = null; ss.del(REF_KEY); showDraft(); });
      btn.disabled = false;
    };
    document.getElementById('chatform').onsubmit = e => { e.preventDefault(); sendMain(); };
    document.getElementById('chatmsg').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendMain(); } });
  }

  return { mark, page, enabled: !!FACH };
})();
