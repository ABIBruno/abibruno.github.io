/* ABIdasmuss – Antwort prüfen
   Stufe 1: Stichwort- und Zahlenabgleich mit dem Erwartungsbild (sofort, im Browser, kostenlos).
   Stufe 2: KI-Feedback über die API (Worker /ki) – nur nach Zustimmung in den Cookie-Einstellungen.
   Das frühere KI-Modell im Browser (Hugging Face) wurde entfernt. */
(function () {
  'use strict';

  const DRAFT_KEY = 'abi-pr-';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* egal */ } }
  };

  /* ---------- Text-Hilfen ---------- */
  const norm = s => String(s).toLowerCase()
    .replace(/­/g, '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

  const STOP = new Set(('aber alle allem allen aller alles also andere anderen anderer anderes auch bereits besonders beide beiden bzw dabei dadurch daher damit danach dann darauf daraus darin darueber darum dass davon dazu dennoch deren derzeit deshalb desto dessen diese diesem diesen dieser dieses dort durch eben ebenfalls eigentlich einem einen einer eines einige einigen einmal etwa etwas folgende folgenden ganz gegen gegenueber genau gerade gibt hier hierbei hierzu hingegen immer indem insgesamt jedoch jeder jedes jeweils kann koennen koennte lediglich mehr mehrere meist muss muessen nach naechste neben nicht noch nunmehr oder ohne schon sehr sich sind sodass sofern solche solchen sondern sowie sowohl ueber unter viele vielmehr vom vor waehrend wann warum weil weiter welche welcher wenn werden wieder wird wobei wodurch wurde wurden zudem zugleich zum zur zwar zwischen somit ergibt ergeben ergibt ergeben beispiel beispielsweise insbesondere allerdings aufgabe teilaufgabe loesung ausserdem gleichzeitig zunaechst schliesslich letztlich folglich naemlich laut gemaess bezueglich hinsichtlich aufgrund anhand mithilfe innerhalb ausserhalb oberhalb unterhalb hinaus heraus herum wegen trotz statt anstatt seit sobald solange bevor nachdem obwohl falls weshalb wieso weshalb dafuer dagegen damals deswegen ebenso genauso ausgehend vergleicht betraegt betragen liegen liegt stehen steht gilt gelten handelt handeln bedeutet bezeichnet zeigt zeigen fuehrt fuehren erfolgt erfolgen entsteht entstehen').split(' '));

  function stem(w) {
    for (const suf of ['en', 'er', 'es', 'em', 'e', 'n', 's']) {
      if (w.endsWith(suf) && w.length - suf.length >= 5) return w.slice(0, -suf.length);
    }
    return w;
  }

  // deutsche Zahl -> number (35.841,00 € / 35841 / 6,5 % / 0.5)
  function parseNum(s) {
    s = String(s).replace(/[\s%€]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const v = parseFloat(s);
    return isFinite(v) ? v : null;
  }
  const NUM_RE = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;
  const DATE_RE = /\b\d{1,2}\.\s?\d{1,2}\.(?:\s?\d{2,4})?/g;

  function numbersIn(text, strict) {
    const out = [];
    const t = String(text).replace(DATE_RE, ' ');
    for (const m of t.matchAll(NUM_RE)) {
      const raw = m[0];
      // „3.1“ / „3.2.1“ mit Punkt sind Aufgabennummern, keine Dezimalzahlen
      if (strict && /^\d+\.\d+$/.test(raw) && !/^\d{1,3}\.\d{3}$/.test(raw)) continue;
      if (strict && /\d\.\d+\.\d/.test(t.slice(m.index, m.index + raw.length + 3))) continue;
      const v = parseNum(raw);
      if (v == null) continue;
      if (strict && (v === 0 || v === 1)) continue;
      out.push({ raw, v });
    }
    return out;
  }

  /* ---------- Erwartungsbild zerlegen ---------- */
  function sentences(text) {
    let t = text.replace(/\s+/g, ' ').trim();
    t = t.replace(/\b([zdu])\.\s?([Bha])\./g, '$1§ $2§')
      .replace(/\b(bzw|ca|evtl|ggf|inkl|zzgl|vgl|Nr|bspw|usw|etc|max|min|mind|abzgl|insb|sog|Mio|Mrd|Tsd|ff|Abb|Abs|Art|ggü|i\.d\.R)\./g, '$1§');
    let parts = t.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„"(])/);
    // sehr lange Sätze an Semikolon / Gedankenstrich teilen
    parts = parts.flatMap(p => {
      if (p.length < 240) return [p];
      const sub = p.split(/;\s+|\s[–—]\s(?=\S)/).map(x => x.trim()).filter(Boolean);
      const merged = [];
      for (const s of sub) {
        if (merged.length && (s.length < 60 || merged[merged.length - 1].length < 60)) merged[merged.length - 1] += ' – ' + s;
        else merged.push(s);
      }
      return merged;
    });
    return parts.map(p => p.replace(/§/g, '.').trim()).filter(p => p.length > 15);
  }

  function termsOf(sentence, frag) {
    const words = sentence.match(/[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß/-]*[A-Za-zÄÖÜäöüß]/g) || [];
    const seen = new Set(), list = [];
    words.forEach((w0, idx) => {
      const pieces = w0.includes('-') || w0.includes('/') ? w0.split(/[-/]+/) : [w0];
      for (const w of pieces) {
        if (w.length < 5) continue;
        const n = norm(w);
        if (STOP.has(n)) continue;
        const noun = /^[A-ZÄÖÜ]/.test(w);
        if (!noun && w.length < (frag ? 9 : 11)) continue;
        if (idx === 0 && !frag && w.length < 9) continue; // Satzanfang ist oft kein Fachbegriff
        const key = stem(n);
        if (key.length < 4 || seen.has(key)) continue;
        seen.add(key);
        list.push({ type: 'w', label: w, key });
      }
    });
    // spezifische (lange) Begriffe zuerst, max. 8
    list.sort((a, b) => b.key.length - a.key.length);
    const words8 = list.slice(0, 8);
    const nums = [];
    for (const n of numbersIn(sentence, true)) {
      if (nums.some(x => x.v === n.v)) continue;
      nums.push({ type: 'n', label: n.raw, v: n.v });
      if (nums.length >= 6) break;
    }
    // in Originalreihenfolge zurück
    const order = t => { const m = new RegExp('(^|[^\\d.,])' + t.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\d])').exec(sentence); return m ? m.index : 1e9; };
    return [...words8, ...nums].sort((a, b) => order(a) - order(b));
  }

  // Offizielles Erwartungsbild (Feld „ewb“, aus den Lösungsvorschlägen des Kultusministeriums):
  // <p class="lead"> = Oberbegriff (kein Prüfpunkt), <table class="rows"> = jede Zeile ein Punkt,
  // <div data-need="N"> = nur N der Punkte darin sind nötig („z“ = Beispiele: etwa die Hälfte)
  function blocksOf(html, official) {
    const root = document.createElement('div');
    root.innerHTML = html;
    root.querySelectorAll('script,style,img,svg,figure,.noprint').forEach(n => n.remove());
    const out = [];
    let group = official ? 'Erwartungsbild' : 'Lösung', altN = 0;
    const altOf = n => { const d = n.closest('[data-need]'); if (!d) return {}; if (!d.dataset.alt) d.dataset.alt = String(++altN); return { alt: d.dataset.alt, need: d.dataset.need }; };
    const noBE = t => t.replace(/\(?\s*\d+\s*BE\s*\)?/g, ' ').replace(/\s+/g, ' ').trim();
    const walk = el => {
      for (const n of el.children) {
        const tag = n.tagName;
        if (/^H[1-6]$/.test(tag)) { group = n.textContent.trim().replace(/:$/, '') || group; continue; }
        if (official && n.classList.contains('lead')) continue;
        if (tag === 'TABLE' && n.classList.contains('rows')) {
          const trs = [...n.querySelectorAll('tr')];
          const numCells = tr => [...tr.children].filter(c => /^\s*[-+=]?\s*[\d.,]+\s*(%|€)?\s*$/.test(c.textContent)).length;
          const isHead = tr => trs.length > 2 && tr === trs[0] && (
            !/\d/.test(tr.textContent) && [...tr.children].every(c => c.textContent.trim().split(/\s+/).length <= 3) ||
            numCells(tr) === 0 && numCells(trs[1]) >= 2);   // Spaltenköpfe über einer Zahlentabelle
          for (const tr of trs) {
            if (isHead(tr)) continue;   // Spaltenüberschriften sind kein Prüfpunkt
            const text = noBE([...tr.children].map(c => c.textContent.trim()).filter(Boolean).join(' | '));
            if (text) out.push({ group, table: true, row: true, text, ...altOf(tr) });
          }
          continue;
        }
        if (tag === 'TABLE') {
          const rows = [...n.querySelectorAll('tr')].map(tr => [...tr.children].map(c => c.textContent.trim()).filter(Boolean).join(' | ')).filter(Boolean);
          if (rows.length) out.push({ group, table: true, text: rows.join(' ; ') });
          continue;
        }
        if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' && !n.querySelector('p,li')) {
          let text = n.textContent.replace(/\s+/g, ' ').trim();
          if (official) text = noBE(text);
          if (!text) continue;
          if (official && /:$/.test(text) && text.length < 60) continue;   // „Die Schüler erklären folgende Rechte:“ – Überleitung, kein Inhalt
          if (official) { out.push({ group, text, frag: tag === 'LI' || n.classList.contains('skizze'), ...altOf(n) }); continue; }
          const strongOnly = n.children.length === 1 && /^(STRONG|B)$/.test(n.children[0].tagName) && n.children[0].textContent.trim() === text;
          if (strongOnly && text.length < 80) { group = text.replace(/:$/, ''); continue; }
          const m = text.match(/^([^:]{3,70}?):\s+(.{20,})$/s);
          if (m && tag === 'P' && !/[.!?]\s/.test(m[1]) && (/\(\s*\d[\d.,\s–-]*\)\s*$/.test(m[1]) || m[1].length <= 35)) { group = m[1].trim(); text = m[2]; }
          out.push({ group, text });
          continue;
        }
        walk(n);
      }
    };
    walk(root);
    return out;
  }

  function buildPoints(html, official) {
    const pts = [];
    for (const b of blocksOf(html, official)) {
      const parts = b.table || b.frag ? [b.text] : sentences(b.text);
      for (const s of parts) {
        const terms = termsOf(s, b.frag || b.row);
        if (terms.length < (b.table || b.frag ? 1 : 2)) continue;
        pts.push({ group: b.group, text: b.table && !b.row ? 'Tabelle: ' + s.replace(/ ; /g, ' · ') : s, terms, table: !!b.table, alt: b.alt, need: b.need });
      }
    }
    // Mengenangaben: Anzahl nötiger Punkte je Block
    const alts = {};
    pts.forEach(p => { if (p.alt) (alts[p.alt] = alts[p.alt] || []).push(p); });
    for (const list of Object.values(alts)) {
      const need = list[0].need === 'z' ? Math.ceil(list.length / 2) : Math.min(list.length, parseInt(list[0].need, 10) || list.length);
      list.forEach(p => { p.needN = need; p.altSize = list.length; });
    }
    return pts;
  }

  // Wertung: in Blöcken mit Mengenangabe zählen nur die besten N Punkte, der Rest ist „nicht nötig“
  function levelsOf(pts) {
    const lv = pts.map(levelOf);
    const seen = new Set();
    pts.forEach(p => { p.opt = false; });
    pts.forEach(p => {
      if (!p.alt || seen.has(p.alt)) return;
      seen.add(p.alt);
      const idx = pts.map((q, j) => q.alt === p.alt ? j : -1).filter(j => j >= 0).sort((a, b) => lv[b] - lv[a]);
      idx.slice(p.needN).forEach(j => { pts[j].opt = true; });
    });
    const counted = lv.filter((_, i) => !pts[i].opt);
    return { lv, pct: counted.length ? counted.reduce((s, x) => s + x / 2, 0) / counted.length : 0, counted };
  }

  /* ---------- Stufe 1: Stichworte + Zahlen ---------- */
  function analyseUser(text) {
    const n = norm(text);
    return { raw: text, n, squash: n.replace(/[^a-z0-9]/g, ''), nums: numbersIn(text, false).map(x => x.v) };
  }

  function wordHit(key, u) {
    if (u.n.includes(key) || u.squash.includes(key)) return 1;
    for (const cut of key.length >= 12 ? [2, 3] : key.length >= 9 ? [2] : []) { // Wortformen: ausscheidender ~ ausscheiden
      const k = key.slice(0, -cut);
      if (u.n.includes(k) || u.squash.includes(k)) return 0.75;
    }
    if (key.length >= 10) { // Komposita: beide Teile vorhanden?
      for (let i = 4; i <= key.length - 5; i++) {
        const a = key.slice(0, i), b = key.slice(i);
        if (u.n.includes(b) && (u.n.includes(a) || u.n.includes(a.replace(/s$/, '')))) return 0.75;
      }
    }
    return 0;
  }
  const numHit = (v, u) => u.nums.some(x => Math.abs(x - v) <= Math.max(0.011, Math.abs(v) * 0.005)) ? 1 : 0;

  // Reine Stichwortliste? (kurze Abschnitte zwischen Kommas/Zeilen, kaum ganze Sätze)
  function isList(text) {
    const segs = String(text).split(/[,;\n.•·–-]+/).map(s => s.trim()).filter(Boolean);
    if (segs.length < 4) return false;
    const avg = segs.reduce((a, s) => a + s.split(/\s+/).length, 0) / segs.length;
    return avg < 3.2;
  }

  function scoreKeywords(points, u) {
    const list = isList(u.raw);
    for (const p of points) {
      let got = 0, total = 0, nNum = 0, nHit = 0;
      for (const t of p.terms) {
        const w = t.type === 'n' ? 1.5 : 1;
        t.hit = t.type === 'n' ? numHit(t.v, u) : wordHit(t.key, u);
        if (t.type === 'n') { nNum++; nHit += t.hit; }
        got += t.hit * w; total += w;
      }
      p.kw = total ? got / total : 0;
      // Rechenpunkt mit (überwiegend) falschen Zahlen: höchstens „teilweise“
      p.cap = list || (nNum >= 2 && nHit / nNum < 0.5) ? 1 : 2;
    }
    return list;
  }

  /* Ampel je Punkt – Schwellen aus dem Qualitätstest (qa/testset_ewb.json):
     nur Stichworte: 0.50 / 0.25 · mit KI: Stichworte 0.60 / 0.30, Bedeutung 0.72 / 0.60,
     kombiniert (mind. 20 % Fachwörter): Bedeutung 0.62 / 0.50 */
  const levelOf = p => {
    let lvl;
    if (p.sem == null) lvl = p.kw >= 0.5 ? 2 : p.kw >= 0.25 ? 1 : 0;
    else {
      lvl = Math.max(p.kw >= 0.6 ? 2 : p.kw >= 0.3 ? 1 : 0, p.sem >= 0.72 ? 2 : p.sem >= 0.6 ? 1 : 0);
      // KI fast sicher + mindestens ein passendes Fachwort/Zahl -> zählt auch
      if (p.kw >= 0.2) lvl = Math.max(lvl, p.sem >= 0.62 ? 2 : p.sem >= 0.5 ? 1 : 0);
    }
    return Math.min(lvl, p.cap == null ? 2 : p.cap);
  };


  /* =====================================================================
     KI-Prüfung über API (Grundgerüst, modular)
     ---------------------------------------------------------------------
     Ablauf: 1) Stichwort-Check im Browser (kostenlos)  2) schlankes Paket an
     den Worker (/ki)  3) Worker fragt den KI-Anbieter  4) Bericht als Tabelle.
     Bausteine zum Austauschen:
       • WISSEN.modus  – welches Vorwissen mitgeht (siehe wissen())
       • Anbieter      – steckt komplett im Worker (KI_PROVIDER), nicht hier
     ===================================================================== */
  const WISSEN = { modus: 'titel' };   // 'titel' | 'index' | 'anbieter'
  const MAX_ANTWORT = 12000;            // Zeichen – längere Texte werden gekürzt (Kostenbremse)
  const CACHE_KEY = 'abi-ki-';
  const BASE = (document.currentScript && document.currentScript.src) || document.baseURI;

  // Wissens-Baustein: liefert nur Quellen, die der User gerade sehen darf (kommt von app.js)
  async function wissen(sources, pts) {
    const quellen = sources.map(s => ({ id: s.id, title: s.title, topic: s.topic || '', kind: s.kind }));
    if (WISSEN.modus === 'index' && window.AbiIndex) {
      // später: eigener Suchindex – die besten Textausschnitte zu den offenen Punkten
      const q = pts.filter(p => p.lvl < 2).map(p => p.text).join(' ');
      return { modus: 'index', quellen, auszuege: (await window.AbiIndex.search(q, sources, 5)).map(a => ({ id: a.id, text: String(a.text).slice(0, 800) })) };
    }
    if (WISSEN.modus === 'anbieter') return { modus: 'anbieter', quellen, auszuege: [] }; // Anbieter durchsucht hinterlegte Dateien selbst
    return { modus: 'titel', quellen, auszuege: [] };
  }

  async function hash(s) {
    const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
    return [...b].slice(0, 12).map(x => x.toString(16).padStart(2, '0')).join('');
  }

  // PDF bleibt im Browser: Text wird hier ausgelesen, die Datei selbst geht nirgendwohin
  let pdfP = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfP) return pdfP;
    pdfP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL('konverter/lib/pdf.min.js', BASE).href;
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('konverter/lib/pdf.worker.min.js', BASE).href; res(window.pdfjsLib); };
      s.onerror = () => { pdfP = null; rej(new Error('pdf.js')); };
      document.head.appendChild(s);
    });
    return pdfP;
  }
  async function pdfText(file) {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let out = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const c = await (await pdf.getPage(i)).getTextContent();
      out += c.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
    }
    return out.replace(/[ \t]+/g, ' ').trim();
  }

  const plain = h => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent.replace(/\s+/g, ' ').trim(); };

  /* ---------- Oberfläche ---------- */
  function html(official) {
    return `
    <section class="panel pruef" id="pruef">
      <h2>🔍 ANTWORT PRÜFEN</h2>
      <p class="pr-intro">Schreib deine Lösung rein oder lade sie als PDF hoch. Erst vergleicht die Seite selbst mit dem ${official ? '<b>offiziellen Erwartungsbild</b>' : 'Erwartungsbild'} (bleibt auf deinem Gerät). Mit <b>„KI-Feedback“</b> bekommst du zusätzlich eine Bewertung je Anforderung mit Tipps, wo du nachlesen kannst.</p>
      <label class="pr-sel">Prüfen für <select id="prPart"></select></label>
      <textarea id="prText" rows="9" placeholder="Deine Antwort …" spellcheck="true"></textarea>
      <div class="pr-actions">
        <button class="btn" id="prGo">PRÜFEN</button>
        <button class="btn ghost" id="prKI" title="Bewertung durch eine KI – nur mit Zustimmung (Cookie-Einstellungen)">🤖 KI-FEEDBACK</button>
        <label class="btn ghost pr-file">📄 PDF LADEN<input type="file" id="prFile" accept="application/pdf" hidden></label>
        <span class="pr-count" id="prCount"></span>
      </div>
      <div class="pr-status" id="prStatus" hidden></div>
      <div id="prOut" aria-live="polite"></div>
      <p class="pr-note">Das ist keine Note: Der Check sieht, ob Inhalte vorkommen. Auch die KI kann sich irren – im Zweifel gilt das Erwartungsbild.</p>
    </section>`;
  }

  const LV = ['fehlt', 'teilweise', 'gut erfüllt'];
  const CLS = ['miss', 'half', 'ok'];

  function mount(task, after, ctx) {
    if (!task || !(task.ewb || task.solution) || !after) return;
    const old = document.getElementById('pruef'); if (old) old.remove();
    const official = !!task.ewb;
    after.insertAdjacentHTML('afterend', html(official));
    const $ = id => document.getElementById(id);
    const all = buildPoints(official ? task.ewb : task.solution, official);
    if (!all.length) { $('pruef').remove(); return; }
    const groups = [...new Set(all.map(p => p.group))];
    $('prPart').innerHTML = `<option value="">Ganze Aufgabe (${all.length} Punkte)</option>` +
      groups.map((g, i) => `<option value="${i}">${esc(g.length > 60 ? g.slice(0, 57) + '…' : g)}</option>`).join('');
    if (groups.length < 2) $('prPart').closest('label').hidden = true;

    const ta = $('prText');
    ta.value = store.get(DRAFT_KEY + task.id) || '';
    const count = () => { const w = (ta.value.match(/\S+/g) || []).length; $('prCount').textContent = w ? `${w} Wörter` : ''; };
    count();
    let tmr;
    ta.addEventListener('input', () => { count(); clearTimeout(tmr); tmr = setTimeout(() => store.set(DRAFT_KEY + task.id, ta.value.trim() ? ta.value : null), 400); });

    let busy = false, last = null;
    const current = () => { const v = $('prPart').value; return v === '' ? all : all.filter(p => p.group === groups[+v]); };
    const status = msg => { const s = $('prStatus'); s.hidden = msg == null; if (msg != null) s.innerHTML = msg; };
    const getSources = async () => { try { return ctx && ctx.sources ? await ctx.sources() : []; } catch (e) { return []; } };

    function local() {
      const text = ta.value.trim();
      if (text.length < 20) { $('prOut').innerHTML = '<p class="pr-empty">Schreib erst ein paar Sätze – dann kann ich vergleichen.</p>'; return null; }
      const pts = current();
      pts.forEach(p => { p.sem = null; });
      const listMode = scoreKeywords(pts, analyseUser(text));
      const { lv } = levelsOf(pts);
      pts.forEach((p, i) => { p.lvl = lv[i]; p.ki = null; });
      return { text, pts, listMode };
    }

    async function render(r, sources, kiInfo) {
      const { pts, listMode } = r;
      const { lv, pct: share, counted } = levelsOf(pts);
      const lvOf = i => pts[i].ki ? pts[i].ki.lvl : lv[i];
      const cnt = pts.map((p, i) => p.opt && lvOf(i) === 0 ? null : lvOf(i)).filter(x => x != null);
      const ok = cnt.filter(x => x === 2).length, half = cnt.filter(x => x === 1).length, miss = cnt.length - ok - half;
      const pct = kiInfo ? Math.round(cnt.reduce((s, x) => s + x / 2, 0) / (cnt.length || 1) * 100) : Math.round(share * 100);
      const tot = cnt.length || 1;
      const link = s => `<a class="pr-src" href="${s.kind === 'p' ? '#/privat/' : '#/vorlesung/'}${encodeURIComponent(s.id)}">${s.kind === 'p' ? '🗝️' : s.kind === 'sn' ? '📝' : '📄'} ${esc(s.title)}</a>`;
      const byId = Object.fromEntries(sources.map(s => [String(s.id), s]));
      let h = `<div class="pr-sum">
        <div class="pr-big">${pct}<small>%</small></div>
        <div><b>${ok} gut erfüllt</b>${half ? ` · ${half} teilweise` : ''}${miss ? ` · ${miss} fehlen` : ''} <small>(${cnt.length} nötige Punkte)</small>
        <div class="pr-bar three"><i class="g" style="width:${ok / tot * 100}%"></i><i class="y" style="width:${half / tot * 100}%"></i></div>
        <small>${kiInfo ? '🤖 mit KI-Bewertung' : 'Stichwort-Abgleich – für eine inhaltliche Bewertung „KI-Feedback“ nutzen'}</small></div></div>`;
      if (kiInfo && kiInfo.fazit) h += `<div class="info pr-fazit">💬 ${esc(kiInfo.fazit)}</div>`;
      if (listMode) h += `<div class="info pr-warn">📝 <b>Das sieht nach einer Stichwortliste aus.</b> Im Abi gibt es Punkte für Erklärungen und Zusammenhänge – schreib ganze Sätze.</div>`;
      h += `<div class="tblwrap"><table class="pr-tab"><thead><tr><th>Anforderung (Erwartungsbild)</th><th>Bewertung</th><th>Hinweis / Verbesserung</th><th>Nachschauen</th></tr></thead><tbody>`;
      let g = null;
      pts.forEach((p, i) => {
        if (p.group !== g) { g = p.group; h += `<tr class="pr-grp"><td colspan="4">${esc(g)}</td></tr>`; }
        const l = lvOf(i), opt = p.opt && l === 0;
        const chips = p.terms.map(t => `<span class="${t.hit >= 1 ? 'hit' : t.hit > 0 ? 'part' : 'no'}">${esc(t.label)}</span>`).join('');
        const hint = p.ki && p.ki.hinweis ? esc(p.ki.hinweis) : opt ? 'nicht nötig (es reichen ' + p.needN + ' von ' + p.altSize + ')' : l === 2 ? '–' : `<div class="pr-chips">${chips}</div>`;
        const qs = (p.ki && p.ki.quellen && p.ki.quellen.length ? p.ki.quellen.map(id => byId[String(id)]).filter(Boolean) : l < 2 && !opt ? sources.slice(0, 2) : []);
        h += `<tr class="${opt ? 'opt' : CLS[l]}"><td>${esc(p.text)}</td><td><span class="pr-dot"></span>${opt ? 'nicht nötig' : LV[l]}</td><td>${hint}</td><td>${qs.map(link).join('<br>') || '–'}</td></tr>`;
      });
      h += '</tbody></table></div>';
      $('prOut').innerHTML = h;
    }

    $('prGo').onclick = async () => { if (busy) return; const r = local(); if (r) { last = r; render(r, await getSources(), null); } };
    $('prPart').onchange = () => { if ($('prOut').innerHTML && !busy) $('prGo').onclick(); };

    $('prFile').onchange = async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) { status('⚠️ Die PDF ist zu groß (max. 15 MB).'); return; }
      status('📄 Lese PDF … (die Datei bleibt auf deinem Gerät)');
      try { ta.value = (await pdfText(f)).slice(0, MAX_ANTWORT); ta.dispatchEvent(new Event('input')); status(null); }
      catch (err) { console.error(err); status('⚠️ Die PDF konnte nicht gelesen werden. Ist es ein Scan (Bild)? Dann bitte den Text eintippen.'); }
    };

    $('prKI').onclick = async () => {
      if (busy) return;
      const C = window.AbiConsent;
      if (!C || !C.has('ki')) {
        status(`🚫 <b>Keine Berechtigung – Cookies wurden abgelehnt.</b> Für das KI-Feedback muss dein Text an einen KI-Anbieter geschickt werden. Das geht nur, wenn du unter „Cookie-Einstellungen“ die <b>KI-Prüfung</b> erlaubst. <button class="linkbtn" id="prCk" type="button">Cookie-Einstellungen öffnen</button>`);
        const b = $('prCk'); if (b && C) b.onclick = () => C.open();
        return;
      }
      const r = local(); if (!r) return;
      busy = true; $('prKI').classList.add('on');
      try {
        const sources = await getSources();
        const kontext = await wissen(sources, r.pts);
        const payload = {
          fach: (window.__CHAT && window.__CHAT.fach) || 'vbwl',
          aufgabe: plain(task.task).slice(0, 3000),
          punkte: r.pts.map((p, i) => ({ i, text: p.text.slice(0, 500), vorab: LV[p.lvl], optional: !!p.opt })),
          antwort: r.text.slice(0, MAX_ANTWORT),
          kontext
        };
        const key = CACHE_KEY + await hash(JSON.stringify(payload));
        let res = null;
        try { res = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) { /* egal */ }
        if (!res) {
          status('🤖 Die KI bewertet deine Antwort …');
          const resp = await fetch(C.worker + '/ki', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': C.deviceId() || '' }, body: JSON.stringify(payload) });
          res = await resp.json().catch(() => ({ ok: false, error: 'Unerwartete Antwort vom Server.' }));
          if (!resp.ok || !res.ok) throw Object.assign(new Error(res.error || 'Fehler'), { user: true });
          try { sessionStorage.setItem(key, JSON.stringify(res)); } catch (e) { /* egal */ }
        }
        const map = { gut: 2, teilweise: 1, fehlt: 0 };
        for (const row of res.rows || []) {
          const p = r.pts[row.i]; if (!p) continue;
          p.ki = { lvl: map[row.status] ?? p.lvl, hinweis: String(row.hinweis || '').slice(0, 400), quellen: Array.isArray(row.quellen) ? row.quellen.slice(0, 3) : [] };
        }
        status(null);
        last = r;
        render(r, sources, { fazit: String(res.fazit || '').slice(0, 600) });
      } catch (e) {
        console.error(e);
        status('⚠️ ' + (e.user ? esc(e.message) : 'Das KI-Feedback ist gerade nicht erreichbar.') + ' Der Stichwort-Check unten funktioniert trotzdem.');
        if (!last) { const rr = local(); if (rr) render(rr, await getSources(), null); }
      } finally { busy = false; $('prKI').classList.remove('on'); }
    };
  }

  window.AbiCheck = { mount, WISSEN, _levels: levelsOf, _buildPoints: buildPoints, _analyse: analyseUser, _score: scoreKeywords, _level: levelOf, _isList: isList };
})();
