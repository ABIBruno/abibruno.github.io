/* ABIdasmuss – PDF → Word / PowerPoint, läuft komplett im Browser.
   Idee: Jede Seite wird zweimal gezeichnet – einmal normal, einmal OHNE Text.
   Das Bild ohne Text wird Seitenhintergrund (Bilder, Linien, Tabellen sehen 1:1 aus),
   der Text kommt als bearbeitbare Textfelder genau an seine Stelle darüber. */
(function () {
  'use strict';
  var pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

  var $ = function (id) { return document.getElementById(id); };
  var fileInput = $('fileInput'), drop = $('drop'), goBtn = $('go');
  var file = null;

  /* ---------- Oberfläche ---------- */
  function setFile(f) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { setStatus('Das ist keine PDF-Datei.', 'err', true); return; }
    file = f;
    $('fileName').textContent = f.name;
    $('fileHint').textContent = (f.size / 1048576).toFixed(1).replace('.', ',') + ' MB · andere Datei? Einfach nochmal klicken';
    drop.classList.add('has');
    goBtn.disabled = false;
    setStatus('', '', false);
  }
  fileInput.addEventListener('change', function () { setFile(fileInput.files[0]); });
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]); });
  document.querySelectorAll('input[name=fmt]').forEach(function (r) {
    r.addEventListener('change', function () { $('wordModes').style.display = fmt() === 'docx' ? '' : 'none'; });
  });
  function fmt() { return document.querySelector('input[name=fmt]:checked').value; }
  function mode() { return document.querySelector('input[name=mode]:checked').value; }

  function setStatus(msg, cls, show) {
    $('progress').classList.toggle('on', !!show);
    $('status').textContent = msg;
    $('status').className = 'status ' + (cls || '');
  }
  function setProgress(p) { $('barFill').style.width = Math.round(p * 100) + '%'; }

  goBtn.addEventListener('click', function () {
    if (!file) return;
    goBtn.disabled = true;
    setProgress(0);
    setStatus('PDF wird geöffnet …', '', true);
    run().then(function () {
      setProgress(1);
      setStatus('Fertig! Der Download sollte jetzt starten.', 'ok', true);
    }).catch(function (err) {
      console.error(err);
      var msg = (err && err.name === 'PasswordException') ? 'Das PDF ist mit einem Passwort geschützt – bitte erst entsperren.' : 'Da ist etwas schiefgelaufen: ' + (err && err.message ? err.message : err);
      setStatus(msg, 'err', true);
    }).then(function () { goBtn.disabled = false; });
  });

  /* ---------- Text beim Zeichnen ausblenden ---------- */
  var HIDE_TEXT = false;
  [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D].forEach(function (C) {
    if (!C) return;
    var P = C.prototype;
    ['fillText', 'strokeText'].forEach(function (fn) {
      var orig = P[fn];
      P[fn] = function () {
        if (HIDE_TEXT) {
          var m = this.getTransform();
          // nur waagerechten Text weglassen – gedrehter Text bleibt im Bild
          if (Math.abs(m.b) < 1e-3 && Math.abs(m.c) < 1e-3) return;
        }
        return orig.apply(this, arguments);
      };
    });
  });

  /* ---------- Hilfsfunktionen ---------- */
  var FAMILY_MAP = {
    'arial': 'Arial', 'helvetica': 'Arial', 'liberation sans': 'Arial', 'arimo': 'Arial',
    'times': 'Times New Roman', 'times new roman': 'Times New Roman', 'times roman': 'Times New Roman', 'liberation serif': 'Times New Roman',
    'courier': 'Courier New', 'courier new': 'Courier New', 'symbol': 'Cambria Math', 'symbol mt': 'Cambria Math', 'zapf dingbats': 'Wingdings'
  };
  function fontInfo(page, fontName, styles) {
    var raw = '', obj = null;
    try { if (page.commonObjs.has(fontName)) obj = page.commonObjs.get(fontName); } catch (e) { obj = null; }
    if (obj && obj.name) raw = obj.name;
    var n = raw.replace(/^[A-Z]{6}\+/, '');
    var bold = /bold|black|heavy|semibold|demibold|demi\b/i.test(n) || !!(obj && (obj.bold || obj.black));
    var italic = /italic|oblique|kursiv/i.test(n) || !!(obj && obj.italic);
    var light = /light/i.test(n) && !bold;
    var fam = n.split(/[-,_]/)[0].replace(/(PSMT|PS|MT)$/, '').replace(/(Bold|Italic|Regular|Oblique)+$/i, '');
    fam = fam.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    var key = fam.toLowerCase();
    if (FAMILY_MAP[key]) fam = FAMILY_MAP[key];
    if (!fam || fam.length < 3 || /^(F|TT|T|C)\d+$/i.test(fam.replace(/\s/g, ''))) {
      var gen = styles[fontName] && styles[fontName].fontFamily || 'sans-serif';
      fam = /serif/.test(gen) && !/sans/.test(gen) ? 'Times New Roman' : (/mono/.test(gen) ? 'Courier New' : 'Arial');
    }
    if (light && !/light/i.test(fam)) fam += ' Light';
    return { family: fam, bold: bold, italic: italic };
  }

  function hex(r, g, b) { return [r, g, b].map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join('').toUpperCase(); }

  // Textfarbe: Vergleich Seite mit Text vs. ohne Text
  function sampleColor(full, bg, W, H, x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    var best = [], maxD = 0;
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var i = (y * W + x) * 4;
        var d = Math.abs(full[i] - bg[i]) + Math.abs(full[i + 1] - bg[i + 1]) + Math.abs(full[i + 2] - bg[i + 2]);
        if (d > 30) { best.push([d, i]); if (d > maxD) maxD = d; }
      }
    }
    if (best.length < 3) return null; // unsichtbarer Text (z. B. OCR-Schicht über einem Scan)
    var r = 0, g = 0, b = 0, c = 0;
    for (var k = 0; k < best.length; k++) {
      if (best[k][0] >= maxD * 0.8) { var j = best[k][1]; r += full[j]; g += full[j + 1]; b += full[j + 2]; c++; }
    }
    r /= c; g /= c; b /= c;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 48 && mx - mn < 14) return '000000';       // Kantenglättung → echtes Schwarz
    if (mn > 225 && mx - mn < 14) return 'FFFFFF';
    return hex(r, g, b);
  }

  async function renderPage(page, scale, hideText) {
    var vp = page.getViewport({ scale: scale });
    var canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    HIDE_TEXT = hideText;
    try { await page.render({ canvasContext: ctx, viewport: vp, background: '#ffffff' }).promise; }
    finally { HIDE_TEXT = false; }
    return canvas;
  }

  function canvasToJpeg(canvas) {
    return new Promise(function (res) {
      canvas.toBlob(function (blob) {
        blob.arrayBuffer().then(function (buf) { res(new Uint8Array(buf)); });
      }, 'image/jpeg', 0.88);
    });
  }
  function bytesToBase64(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }

  /* ---------- Eine Seite analysieren ---------- */
  async function analysePage(page, needImage) {
    var vp1 = page.getViewport({ scale: 1 });
    var pw = vp1.width, ph = vp1.height;
    var S = Math.min(2.5, 3400 / Math.max(pw, ph));          // ca. 180 dpi
    var full = await renderPage(page, S, false);               // lädt auch die Schriften
    var bgCanvas = await renderPage(page, S, true);
    var W = full.width, H = full.height;
    var fullPx = full.getContext('2d').getImageData(0, 0, W, H).data;
    var bgPx = bgCanvas.getContext('2d').getImageData(0, 0, W, H).data;

    var tc = await page.getTextContent();
    var items = [], hidden = 0;
    tc.items.forEach(function (it) {
      if (!it.str || !it.str.trim() && !it.str.length) return;
      var t = pdfjsLib.Util.transform(vp1.transform, it.transform);
      var fs = Math.hypot(t[2], t[3]);
      if (fs < 1) return;
      if (Math.abs(t[1]) > 0.01 * fs || Math.abs(t[2]) > 0.01 * fs || t[3] > 0 || t[0] <= 0) return; // gedreht/gespiegelt → bleibt im Bild
      var x = t[4], base = t[5];
      var w = it.width * (vp1.scale || 1);
      if (it.dir === 'rtl') return;
      if (x > pw || base < 0 || x + w < 0 || base - fs > ph) return;
      var color = sampleColor(fullPx, bgPx, W, H, x * S, (base - fs * 0.85) * S, (x + Math.max(w, fs * 0.3)) * S, (base + fs * 0.25) * S);
      if (!it.str.trim()) return;                                  // reine Leerzeichen
      if (!color && it.str.trim().length > 2) { hidden++; return; } // unsichtbarer Text (z. B. Scan mit OCR)
      var f = fontInfo(page, it.fontName, tc.styles);
      items.push({ str: it.str, x: x, base: base, w: w, fs: fs, font: f.family, bold: f.bold, italic: f.italic, color: color });
    });
    // sehr kleine Zeichen (Bindestrich, Punkt …) haben kaum Pixel → Farbe vom Nachbarn übernehmen
    var visible = items.filter(function (i) { return i.color; }).length;
    if (visible < hidden) items = items.filter(function (i) { return i.color; });
    var lastColor = '000000';
    items.forEach(function (i) { if (i.color) lastColor = i.color; else i.color = lastColor; });

    var lines = groupLines(items);
    var blocks = groupBlocks(lines);
    var img = null;
    if (needImage) img = { bytes: await canvasToJpeg(bgCanvas), pxW: W, pxH: H };
    full.width = full.height = 0; bgCanvas.width = bgCanvas.height = 0;
    return { w: pw, h: ph, blocks: blocks, img: img };
  }

  /* Text-Stücke zu Zeilen-Segmenten zusammenfassen (Spalten/Tabellenzellen bleiben getrennt) */
  function groupLines(items) {
    items.sort(function (a, b) { return Math.abs(a.base - b.base) > Math.min(a.fs, b.fs) * 0.35 ? a.base - b.base : a.x - b.x; });
    var rows = [];
    items.forEach(function (it) {
      var row = rows.length ? rows[rows.length - 1] : null;
      if (row && Math.abs(row.base - it.base) <= Math.min(row.fs, it.fs) * 0.35) row.items.push(it);
      else rows.push({ base: it.base, fs: it.fs, items: [it] });
    });
    var segs = [];
    rows.forEach(function (row) {
      row.items.sort(function (a, b) { return a.x - b.x; });
      var seg = null;
      row.items.forEach(function (it) {
        var end = seg ? seg.x + seg.w : 0;
        var gap = seg ? it.x - end : 0;
        var ref = seg ? Math.max(seg.fsMax, it.fs) : it.fs;
        if (seg && gap < ref * 0.6 && gap > -ref * 0.5) {
          var last = seg.runs[seg.runs.length - 1];
          var needSpace = gap > ref * 0.12 && !/\s$/.test(last.text) && !/^\s/.test(it.str);
          if (needSpace) last.text += ' ';
          addRun(seg, it);
          seg.w = Math.max(seg.w, it.x + it.w - seg.x);
        } else {
          seg = { x: it.x, base: row.base, w: it.w, fsMax: it.fs, runs: [] };
          addRun(seg, it);
          segs.push(seg);
        }
        seg.fsMax = Math.max(seg.fsMax, it.fs);
        if (it.base > seg.base && it.fs >= seg.fsMax * 0.9) seg.base = it.base;
      });
    });
    segs.forEach(function (s) {
      // Leerzeichen am Rand entfernen
      s.runs[0].text = s.runs[0].text.replace(/^\s+/, '');
      var l = s.runs[s.runs.length - 1]; l.text = l.text.replace(/\s+$/, '');
      s.runs = s.runs.filter(function (r) { return r.text.length; });
    });
    return segs.filter(function (s) { return s.runs.length; });
  }
  function addRun(seg, it) {
    var last = seg.runs[seg.runs.length - 1];
    var size = Math.round(it.fs * 2) / 2; // halbe Punkte
    if (last && last.font === it.font && last.size === size && last.bold === it.bold && last.italic === it.italic && last.color === it.color) last.text += it.str;
    else seg.runs.push({ text: it.str, font: it.font, size: size, bold: it.bold, italic: it.italic, color: it.color });
  }

  /* Untereinander stehende Zeilen mit gleichem Einzug zu einem Absatz-Block verbinden */
  function groupBlocks(segs) {
    segs.sort(function (a, b) { return a.base - b.base || a.x - b.x; });
    // Segmente mit Nachbarn in derselben Zeile (z. B. "1.  Überschrift", Tabellenzellen) nicht zu Absätzen verbinden
    segs.forEach(function (a) {
      a.solo = !segs.some(function (o) { return o !== a && Math.abs(o.base - a.base) < Math.min(o.fsMax, a.fsMax) * 0.35; });
    });
    var blocks = [];
    var used = new Array(segs.length);
    for (var i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      var b = { x: segs[i].x, w: segs[i].w, lines: [segs[i]], fs: segs[i].fsMax, gap: 0 };
      var cur = segs[i];
      for (var j = i + 1; j < segs.length; j++) {
        if (used[j]) continue;
        var s = segs[j];
        var d = s.base - cur.base;
        if (d > b.fs * 2.2) break;
        if (d < b.fs * 0.9) continue;
        if (Math.abs(s.x - b.x) > 2 || Math.abs(s.fsMax - b.fs) > b.fs * 0.12) continue;
        if (!s.solo || !cur.solo) continue;
        if (b.gap && Math.abs(d - b.gap) > b.gap * 0.12) continue;
        if (d > b.fs * 1.9) continue;
        b.gap = b.gap || d;
        used[j] = true; b.lines.push(s); b.w = Math.max(b.w, s.w); cur = s;
      }
      blocks.push(b);
    }
    blocks.forEach(function (b) {
      b.lh = b.gap || b.fs * 1.2;     // Zeilenabstand in pt
      b.base0 = b.lines[0].base;     // Grundlinie der ersten Zeile
      b.top = b.base0 - b.fs;
      b.bottom = b.lines[b.lines.length - 1].base + b.fs * 0.3;
    });
    // Platz nach rechts bis zum nächsten Textblock: Textfelder etwas breiter machen,
    // damit nichts umbricht, wenn eine Schrift auf dem PC minimal breiter ist
    blocks.forEach(function (b) {
      var limit = Infinity, end = b.x + b.w;
      blocks.forEach(function (o) {
        if (o === b || o.x < end - 1) return;
        if (o.bottom <= b.top || o.top >= b.bottom) return;
        limit = Math.min(limit, o.x - 2);
      });
      b.room = Math.max(b.w * 1.04 + 3, Math.min(limit - b.x, b.w * 1.3 + 10));
    });
    return blocks;
  }

  /* ---------- Gesamter Ablauf ---------- */
  async function run() {
    var data = new Uint8Array(await file.arrayBuffer());
    var pdf = await pdfjsLib.getDocument({
      data: data, isEvalSupported: false, fontExtraProperties: true,
      standardFontDataUrl: 'lib/standard_fonts/', disableFontFace: false
    }).promise;
    var n = pdf.numPages, pages = [];
    var format = fmt(), md = format === 'docx' ? mode() : 'exact';
    for (var p = 1; p <= n; p++) {
      setStatus('Seite ' + p + ' von ' + n + ' wird gelesen …', '', true);
      var page = await pdf.getPage(p);
      pages.push(await analysePage(page, md === 'exact'));
      page.cleanup();
      setProgress(p / n * 0.9);
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    setStatus('Datei wird erstellt …', '', true);
    var base = file.name.replace(/\.pdf$/i, '');
    if (format === 'pptx') await buildPptx(pages, base);
    else if (md === 'flow') await buildDocxFlow(pages, base);
    else await buildDocxExact(pages, base);
    pdf.destroy();
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  /* ---------- PowerPoint ---------- */
  async function buildPptx(pages, base) {
    var pptx = new window.PptxGenJS();
    var SW = pages[0].w / 72, SH = pages[0].h / 72; // Folie = Größe der ersten Seite (Zoll)
    pptx.defineLayout({ name: 'PDF', width: SW, height: SH });
    pptx.layout = 'PDF';
    pages.forEach(function (pg) {
      var slide = pptx.addSlide();
      var k = Math.min(SW * 72 / pg.w, SH * 72 / pg.h);        // falls Seiten verschieden groß sind
      var ox = (SW * 72 - pg.w * k) / 2, oy = (SH * 72 - pg.h * k) / 2;
      if (pg.img) {
        var b64 = 'data:image/jpeg;base64,' + bytesToBase64(pg.img.bytes);
        if (k === 1 && ox === 0 && oy === 0) slide.background = { data: b64 };
        else slide.addImage({ data: b64, x: ox / 72, y: oy / 72, w: pg.w * k / 72, h: pg.h * k / 72 });
      }
      pg.blocks.forEach(function (b) {
        var lh = b.lh * k;
        var runs = [];
        b.lines.forEach(function (ln, li) {
          ln.runs.forEach(function (r, ri) {
            runs.push({ text: r.text, options: {
              fontFace: r.font, fontSize: Math.max(1, r.size * k), bold: r.bold, italic: r.italic, color: r.color,
              breakLine: ri === ln.runs.length - 1 && li < b.lines.length - 1
            } });
          });
        });
        var top = oy + (b.base0 * k) - lh * 0.8 - b.fs * k * 0.02;
        var h = lh * b.lines.length;
        slide.addText(runs, {
          x: (ox + b.x * k) / 72, y: top / 72, w: Math.max(12, Math.min(b.room, pg.w - b.x) * k) / 72, h: h / 72,
          margin: 0, valign: 'top', align: 'left', wrap: false, fit: 'none',
          lineSpacing: Math.round(lh * 100) / 100, paraSpaceBefore: 0, paraSpaceAfter: 0
        });
      });
    });
    var blob = await pptx.write({ outputType: 'blob' });
    download(blob, base + '.pptx');
  }

  /* ---------- Word: Aussehen wie im PDF ---------- */
  var TW = 20;                 // 1 pt = 20 twips
  var EMU = 12700;             // 1 pt = 12700 EMU
  function wordRuns(b) {
    var D = window.docx, out = [];
    b.lines.forEach(function (ln, li) {
      ln.runs.forEach(function (r, ri) {
        out.push(new D.TextRun({ text: r.text, font: r.font, size: Math.max(2, Math.round(r.size * 2)), bold: r.bold, italics: r.italic, color: r.color, break: (li > 0 && ri === 0) ? 1 : undefined }));
      });
    });
    return out;
  }
  async function buildDocxExact(pages, base) {
    var D = window.docx;
    var sections = pages.map(function (pg) {
      var children = [];
      var anchorRuns = [];
      if (pg.img) {
        anchorRuns.push(new D.ImageRun({
          data: pg.img.bytes,
          transformation: { width: pg.w * 96 / 72, height: pg.h * 96 / 72 },
          floating: {
            horizontalPosition: { relative: D.HorizontalPositionRelativeFrom.PAGE, offset: 0 },
            verticalPosition: { relative: D.VerticalPositionRelativeFrom.PAGE, offset: 0 },
            behindDocument: true, allowOverlap: true, lockAnchor: true,
            wrap: { type: D.TextWrappingType.NONE }
          }
        }));
      }
      children.push(new D.Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: D.LineRuleType.EXACT }, children: anchorRuns }));
      pg.blocks.forEach(function (b) {
        var lh = b.lh;
        var top = b.base0 - lh * 0.8 - b.fs * 0.02;
        var w = Math.max(12, Math.min(b.room, pg.w - b.x));
        children.push(new D.Paragraph({
          frame: {
            type: 'absolute',
            position: { x: Math.round(b.x * TW), y: Math.round(top * TW) },
            width: Math.round(w * TW), height: Math.round(lh * b.lines.length * TW),
            anchor: { horizontal: D.FrameAnchorType.PAGE, vertical: D.FrameAnchorType.PAGE },
            wrap: D.FrameWrap.NONE, rule: 'atLeast', space: { horizontal: 0, vertical: 0 }
          },
          spacing: { before: 0, after: 0, line: Math.round(lh * TW), lineRule: D.LineRuleType.EXACT },
          children: wordRuns(b)
        }));
      });
      return {
        properties: { page: { size: { width: Math.round(pg.w * TW), height: Math.round(pg.h * TW), orientation: pg.w > pg.h ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT },
          margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0 } } },
        children: children
      };
    });
    var doc = new D.Document({ creator: 'ABIdasmuss PDF-Konverter', title: base, sections: sections });
    download(await D.Packer.toBlob(doc), base + '.docx');
  }

  /* ---------- Word: Fließtext ---------- */
  async function buildDocxFlow(pages, base) {
    var D = window.docx;
    // häufigste Schriftgröße = normaler Text
    var count = {};
    pages.forEach(function (pg) { pg.blocks.forEach(function (b) { var s = Math.round(b.fs); count[s] = (count[s] || 0) + b.lines.length; }); });
    var bodySize = +Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0] || 11;
    var children = [];
    pages.forEach(function (pg, pi) {
      // Lesereihenfolge: Blöcke auf derselben Höhe bilden eine Zeile (mit Tabulator getrennt)
      var bl = pg.blocks.slice().sort(function (a, b) { return a.base0 - b.base0 || a.x - b.x; });
      var rows = [];
      bl.forEach(function (b) {
        var r = rows[rows.length - 1];
        if (r && Math.abs(b.base0 - r.base) < Math.min(r.fs, b.fs) * 0.4) r.blocks.push(b);
        else rows.push({ base: b.base0, fs: b.fs, blocks: [b] });
      });
      rows.forEach(function (row, ri0) {
        row.blocks.sort(function (a, b) { return a.x - b.x; });
        var runs = [], big = 0;
        row.blocks.forEach(function (b, bi) {
          big = Math.max(big, b.fs);
          b.lines.forEach(function (ln, li) {
            ln.runs.forEach(function (r, ri) {
              var t = r.text;
              if (ri === 0 && li === 0 && bi > 0) t = '\t' + t;
              else if (li > 0 && ri === 0) {
                var prev = runs[runs.length - 1];
                if (prev && /[a-zäöüß]-$/.test(prev.t) && /^[a-zäöüß]/.test(t)) prev.t = prev.t.slice(0, -1); // Silbentrennung entfernen
                else t = ' ' + t;
              }
              runs.push({ t: t, r: r });
            });
          });
        });
        var heading = big >= bodySize * 1.35 && row.blocks.length === 1 && row.blocks[0].lines.length <= 3;
        var parts = [];
        runs.forEach(function (x) {
          x.t.split('\t').forEach(function (piece, k) {
            if (k > 0) parts.push(new D.TextRun({ children: [new D.Tab()] }));
            if (piece) parts.push(new D.TextRun({ text: piece, font: x.r.font, size: Math.round(x.r.size * 2), bold: x.r.bold, italics: x.r.italic, color: x.r.color }));
          });
        });
        children.push(new D.Paragraph({
          heading: heading ? (big >= bodySize * 1.8 ? D.HeadingLevel.HEADING_1 : D.HeadingLevel.HEADING_2) : undefined,
          pageBreakBefore: pi > 0 && ri0 === 0,
          spacing: { after: 100 },
          children: parts
        }));
      });
    });
    if (!children.length) children.push(new D.Paragraph({ children: [new D.TextRun('In diesem PDF wurde kein Text gefunden (vermutlich eingescannt).')] }));
    var doc = new D.Document({ creator: 'ABIdasmuss PDF-Konverter', title: base, sections: [{ children: children }] });
    download(await D.Packer.toBlob(doc), base + '.docx');
  }
})();
