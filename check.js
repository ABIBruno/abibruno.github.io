/* ABIdasmuss – Antwort prüfen
   Vergleicht eine eigene Antwort mit dem Erwartungsbild (der Lösung).
   Stufe 1: Stichwort- und Zahlenabgleich (sofort, offline).
   Stufe 2: optional ein kleines KI-Modell, das auf dem eigenen Gerät läuft
            und auch umschriebene Inhalte erkennt (einmaliger Download nach Zustimmung).
   Der eingegebene Text verlässt nie das Gerät. */
(function () {
  'use strict';

  const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
  const MODEL_MB = 120;
  const CONSENT_KEY = 'abi-ki-ok';
  const DRAFT_KEY = 'abi-pr-';
  const LIB = new URL('vendor/tfjs/', document.baseURI).href;

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

  // KI-Zuordnung: ein Satz der Antwort zählt nur für die Erwartungspunkte, zu denen er
  // (fast) am besten passt – sonst würde ein allgemeiner Satz überall „ähnlich“ wirken.
  function assignSem(m, margin = 0.03) {
    const J = m.length ? m[0].length : 0;
    const best = Array.from({ length: J }, (_, j) => Math.max(...m.map(r => r[j])));
    return m.map(r => Math.max(0, ...r.map((v, j) => v >= best[j] - margin ? v : 0)));
  }

  /* ---------- Stufe 2: KI auf dem Gerät ---------- */
  let extractorP = null;
  function loadModel(onProgress) {
    if (extractorP) return extractorP;
    extractorP = (async () => {
      const T = await import(LIB + 'transformers.min.js');
      T.env.allowLocalModels = false;
      T.env.useBrowserCache = true;
      T.env.backends.onnx.wasm.wasmPaths = LIB;
      T.env.backends.onnx.wasm.numThreads = 1;
      T.env.backends.onnx.wasm.proxy = false;
      const files = {};
      return T.pipeline('feature-extraction', MODEL, {
        dtype: 'q8', device: 'wasm',
        progress_callback: e => {
          if (e.status === 'progress' && e.total) {
            files[e.file] = [e.loaded, e.total];
            const v = Object.values(files), l = v.reduce((s, x) => s + x[0], 0), t = v.reduce((s, x) => s + x[1], 0);
            onProgress && onProgress(l, t);
          }
        }
      });
    })();
    extractorP.catch(() => { extractorP = null; });
    return extractorP;
  }

  async function embed(ex, texts, onStep) {
    const out = [];
    for (let i = 0; i < texts.length; i += 8) {
      const r = await ex(texts.slice(i, i + 8), { pooling: 'mean', normalize: true });
      out.push(...r.tolist());
      onStep && onStep(Math.min(texts.length, i + 8), texts.length);
      await new Promise(res => setTimeout(res, 0)); // Seite bleibt bedienbar
    }
    return out;
  }
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  function userChunks(text) {
    const s = text.replace(/\s+/g, ' ').replace(/\b([zdu])\.\s?([Bha])\./g, '$1§ $2§')
      .split(/(?<=[.!?:])\s+(?=[A-ZÄÖÜ„"(])/).map(x => x.replace(/§/g, '.').trim()).filter(x => x.length > 5);
    const list = s.length ? s : [text];
    const chunks = [...list];
    for (let i = 0; i + 1 < list.length; i++) chunks.push(list[i] + ' ' + list[i + 1]);
    // Aufzählungssätze zusätzlich in Teilsätze zerlegen – das Erwartungsbild besteht oft aus kurzen Stichpunkten
    for (const x of list) {
      const cl = x.split(/,\s+|;\s+|\s+und\s+|\s+sowie\s+|\s+aber\s+/).map(c => c.trim()).filter(c => c.split(/\s+/).length >= 2);
      if (cl.length > 1) chunks.push(...cl);
    }
    return [...new Set(chunks)].slice(0, 160);
  }

  /* ---------- Oberfläche ---------- */
  function html(id, official) {
    return `
    <section class="panel pruef" id="pruef">
      <h2>🔍 ANTWORT PRÜFEN</h2>
      <p class="pr-intro">Schreib deine Lösung hier rein (oder füg sie ein). Die Seite vergleicht sie mit dem ${official ? '<b>offiziellen Erwartungsbild</b> (Lösungsvorschlag des Kultusministeriums)' : 'Erwartungsbild'} und zeigt dir, welche Punkte drin sind und was noch fehlt. <b>Dein Text bleibt auf deinem Gerät</b> – er wird nirgendwohin geschickt.</p>
      <label class="pr-sel">Prüfen für <select id="prPart"></select></label>
      <textarea id="prText" rows="9" placeholder="Deine Antwort …" spellcheck="true"></textarea>
      <div class="pr-actions">
        <button class="btn" id="prGo">PRÜFEN</button>
        <button class="btn ghost" id="prKI" title="Erkennt auch umschriebene Inhalte – läuft auf deinem Gerät">🧠 GENAUER PRÜFEN (KI)</button>
        <span class="pr-count" id="prCount"></span>
      </div>
      <div class="info pr-consent" id="prConsent" hidden>
        <p><b>🧠 KI-Prüfung auf deinem Gerät</b></p>
        <p>Dafür wird einmalig ein kleines Sprachmodell (ca. ${MODEL_MB} MB) von <b>Hugging Face</b> geladen und im Browser gespeichert. Danach rechnet dein Gerät selbst – das kann beim ersten Mal ein bis zwei Minuten dauern. Dein Text wird dabei <b>nicht</b> verschickt. Beim Download erhält Hugging Face (USA) deine IP-Adresse, wie bei jedem Seitenaufruf – in den USA gilt nicht unbedingt dasselbe Datenschutzniveau wie in der EU (mehr unter Datenschutz). Tipp: lieber im WLAN.</p>
        <p>Die KI bleibt gespeichert, bis du sie hier mit <b>„KI vom Gerät entfernen“</b> löschst – damit nimmst du auch deine Zustimmung zurück. <b>iPhone:</b> Safari löscht gespeicherte Seitendaten nach 7 Tagen ohne Besuch, dann wird die KI neu geladen und du wirst nochmal gefragt. Das passiert nicht, wenn du die Seite über <i>Teilen → Zum Home-Bildschirm</i> wie eine App speicherst.</p>
        <div class="pr-actions"><button class="btn green" id="prYes">ZUSTIMMEN &amp; LADEN</button><button class="btn ghost" id="prNo">ABBRECHEN</button></div>
      </div>
      <div class="pr-status" id="prStatus" hidden></div>
      <p class="pr-remove" id="prRemoveRow" hidden><button class="linkbtn" id="prRemove" type="button">🗑️ KI vom Gerät entfernen</button> <span>· löscht das gespeicherte Sprachmodell und deine Zustimmung</span></p>
      <div id="prOut" aria-live="polite"></div>
      <p class="pr-note">Das ist keine Note: Der Check sieht, ob Inhalte vorkommen – nicht, ob deine Begründung stimmt oder gut formuliert ist.</p>
    </section>`;
  }

  function mount(task, after) {
    if (!task || !(task.ewb || task.solution) || !after) return;
    const old = document.getElementById('pruef'); if (old) old.remove();
    after.insertAdjacentHTML('afterend', html(task.id, !!task.ewb));
    const $ = id => document.getElementById(id);
    const official = !!task.ewb;
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

    let semOn = false, busy = false, listMode = false;
    const current = () => { const v = $('prPart').value; return v === '' ? all : all.filter(p => p.group === groups[+v]); };
    const status = (msg, pct) => {
      const s = $('prStatus');
      if (msg == null) { s.hidden = true; return; }
      s.hidden = false;
      s.innerHTML = `<span>${msg}</span>` + (pct != null ? `<div class="pr-bar"><i style="width:${Math.round(pct * 100)}%"></i></div>` : '');
    };

    async function run() {
      const text = ta.value.trim();
      if (text.length < 20) { $('prOut').innerHTML = '<p class="pr-empty">Schreib erst ein paar Sätze – dann kann ich vergleichen.</p>'; return; }
      const pts = current();
      pts.forEach(p => { p.sem = null; });
      listMode = scoreKeywords(pts, analyseUser(text));
      if (semOn) {
        busy = true;
        try {
          const ex = await loadModel((l, t) => status(`Lade KI-Modell … ${Math.round(l / 1e6)} von ${Math.round(t / 1e6)} MB`, l / t));
          status('KI vergleicht die Bedeutung …', 0);
          const exp = await embed(ex, pts.map(p => p.text.slice(0, 600)), (a, b) => status('KI vergleicht die Bedeutung …', a / (b * 2)));
          const chunks = userChunks(text);
          const usr = await embed(ex, chunks, (a, b) => status('KI vergleicht die Bedeutung …', 0.5 + a / (b * 2)));
          const sem = assignSem(exp.map(e => usr.map(u => dot(e, u))));
          pts.forEach((p, i) => { p.sem = sem[i]; });
          status(null);
        } catch (e) {
          console.error(e);
          status('⚠️ Die KI-Prüfung konnte nicht geladen werden (Verbindung oder Browser zu alt). Der Stichwort-Check unten funktioniert trotzdem.');
          semOn = false;
        } finally { busy = false; }
      }
      render(pts);
    }

    function render(pts) {
      const { lv, pct: share, counted } = levelsOf(pts);
      const ok = counted.filter(x => x === 2).length, half = counted.filter(x => x === 1).length, miss = counted.length - ok - half;
      const pct = Math.round(share * 100), tot = counted.length || 1;
      let h = `<div class="pr-sum">
        <div class="pr-big">${pct}<small>%</small></div>
        <div><b>${ok} von ${counted.length} nötigen Punkten drin</b>${half ? ` · ${half} teilweise` : ''}${miss ? ` · ${miss} fehlen` : ''}
        <div class="pr-bar three"><i class="g" style="width:${ok / tot * 100}%"></i><i class="y" style="width:${half / tot * 100}%"></i></div>
        <small>${semOn ? '🧠 mit KI-Bedeutungsabgleich' : 'Stichwort-Abgleich · erkennt eigene Formulierungen nur teilweise – „Genauer prüfen (KI)“ ist da deutlich besser'}</small></div></div>`;
      if (listMode) h += `<div class="info pr-warn">📝 <b>Das sieht nach einer Stichwortliste aus.</b> Im Abi gibt es Punkte für Erklärungen und Zusammenhänge, nicht für Begriffe allein – deshalb ist hier nichts grün. Schreib ganze Sätze, dann prüf nochmal.</div>`;
      let g = null, a = null;
      pts.forEach((p, i) => {
        if (p.group !== g) { g = p.group; a = null; h += `<div class="pr-group">${esc(g)}</div>`; }
        if (p.alt && p.alt !== a && p.needN < p.altSize) h += `<div class="pr-need">Hier reichen ${p.needN} von ${p.altSize} Punkten</div>`;
        a = p.alt || null;
        const cls = p.opt && lv[i] === 0 ? 'opt' : ['miss', 'half', 'ok'][lv[i]];
        const lbl = p.opt && lv[i] === 0 ? 'nicht nötig' : ['fehlt', 'teilweise', 'drin'][lv[i]];
        const chips = p.terms.map(t => `<span class="${t.hit >= 1 ? 'hit' : t.hit > 0 ? 'part' : 'no'}">${esc(t.label)}</span>`).join('');
        h += `<div class="pr-pt ${cls}"><span class="pr-dot" title="${lbl}"></span><div>
          <div class="pr-chips">${chips}</div>
          <details><summary>${official ? 'Erwartungsbild anzeigen' : 'Erwartung anzeigen'}${p.sem != null ? ` · Bedeutung ${Math.round(p.sem * 100)} %` : ''}</summary><p>${esc(p.text)}</p></details>
        </div></div>`;
      });
      h += `<p class="pr-legend"><span class="hit">gefunden</span><span class="part">ähnlich</span><span class="no">fehlt</span></p>`;
      $('prOut').innerHTML = h;
    }

    $('prGo').onclick = () => { if (!busy) run(); };
    $('prPart').onchange = () => { if ($('prOut').innerHTML && !busy) run(); };
    $('prKI').onclick = () => {
      if (busy) return;
      if (store.get(CONSENT_KEY) === '1') { semOn = true; $('prKI').classList.add('on'); run(); }
      else { $('prConsent').hidden = false; $('prConsent').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    };
    $('prYes').onclick = () => { store.set(CONSENT_KEY, '1'); $('prConsent').hidden = true; semOn = true; $('prKI').classList.add('on'); showRemove(); run(); };
    // Widerruf: Modell + Zustimmung löschen (genauso einfach wie zustimmen)
    const showRemove = () => { $('prRemoveRow').hidden = store.get(CONSENT_KEY) !== '1'; };
    showRemove();
    $('prRemove').onclick = async () => {
      if (busy) return;
      store.set(CONSENT_KEY, null);
      try { if (window.caches) await caches.delete('transformers-cache'); } catch (e) { /* egal */ }
      extractorP = null; semOn = false;
      $('prKI').classList.remove('on'); showRemove();
      status('✅ KI und Zustimmung wurden von diesem Gerät gelöscht. Der Stichwort-Check funktioniert weiter.');
      if ($('prOut').innerHTML) run();
    };
    $('prNo').onclick = () => { $('prConsent').hidden = true; };
  }

  window.AbiCheck = { mount, _levels: levelsOf, _buildPoints: buildPoints, _analyse: analyseUser, _score: scoreKeywords, _level: levelOf, _assign: assignSem, _chunks: userChunks, _isList: isList };
})();
