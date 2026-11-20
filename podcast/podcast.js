/* Morgenbriefing – Podcast-App auf ABIdasmuss
 *
 * Folgen und Katalog liegen AES-256-GCM-verschlüsselt unter /podcast-daten/.
 * Der Schlüssel wird im Browser per PBKDF2-SHA256 aus dem Passwort abgeleitet;
 * das Passwort verlässt das Gerät nie.
 */
(() => {
  "use strict";
  const DATEN = "../podcast-daten/";
  const K_SCHLUESSEL = "mb-schluessel", K_POS = "mb-pos-", K_GEHOERT = "mb-gehoert-", K_TEMPO = "mb-tempo";
  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const tob64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* privat-Modus */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* egal */ } },
  };

  let schluessel = null, katalog = [], filter = "alle";
  let aktuell = null;                 // Eintrag der geladenen Folge
  const blobs = new Map();            // slug -> Promise<blobUrl>

  // ------------------------------------------------------------------ Krypto
  async function holen(datei, art = "arrayBuffer", frisch = false) {
    const r = await fetch(DATEN + datei + (frisch ? `?t=${Date.now()}` : ""), { cache: frisch ? "no-store" : "default" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r[art]();
  }
  const entschluesseln = (key, daten) => {
    const d = new Uint8Array(daten);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: d.slice(0, 12) }, key, d.slice(12));
  };
  async function ableiten(passwort, info) {
    const basis = await crypto.subtle.importKey("raw", enc.encode(passwort), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: b64(info.salz), iterations: info.iterationen },
      basis, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }

  // ------------------------------------------------------------------ Anmeldung
  $("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("login-btn");
    btn.disabled = true; btn.textContent = "Wird geprüft …"; $("login-msg").textContent = "";
    try {
      const info = await holen("schluessel.json", "json", true);
      const key = await ableiten($("pw").value, info);
      if (dec.decode(await entschluesseln(key, b64(info.pruefung))) !== "morgenbriefing-ok") throw new DOMException("", "OperationError");
      ls.set(K_SCHLUESSEL, tob64(await crypto.subtle.exportKey("raw", key)));
      schluessel = key; $("pw").value = "";
      await starten();
    } catch (err) {
      $("login-msg").textContent = err.name === "OperationError" ? "Das Passwort stimmt nicht." : "Keine Verbindung. Versuch es gleich nochmal.";
    } finally {
      btn.disabled = false; btn.textContent = "Entsperren";
    }
  });

  function abmelden(text = "") {
    ls.del(K_SCHLUESSEL); schluessel = null; audio.pause();
    $("app").hidden = true; $("mini").hidden = true; sheet(false);
    $("login").hidden = false; $("login-msg").textContent = text;
  }

  // ------------------------------------------------------------------ Katalog
  async function katalogLaden() {
    try {
      const daten = await holen("katalog.enc", "arrayBuffer", true);
      katalog = JSON.parse(dec.decode(await entschluesseln(schluessel, daten)));
    } catch (err) {
      if (err.name === "OperationError") return abmelden("Das Passwort wurde geändert. Bitte gib das neue ein.");
      if (!katalog.length) { $("leer").hidden = false; }
      return;
    }
    zeichnen();
    if (katalog[0]) vorladen(katalog[0]);      // neueste Folge im Hintergrund entschlüsseln
  }

  const zeit = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sek = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sek}` : `${m}:${sek}`;
  };
  const tag = (iso) => new Date(iso + "T12:00:00");
  const istHeute = (iso) => tag(iso).toDateString() === new Date().toDateString();
  const datumLang = (iso) => istHeute(iso) ? "Heute" : tag(iso).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const gehoert = (e) => ls.get(K_GEHOERT + e.slug) === "1";
  const position = (e) => parseFloat(ls.get(K_POS + e.slug) || "0");
  const minuten = (e) => `${Math.max(1, Math.round(e.dauer_sek / 60))} Min.`;
  const spielt = (e) => aktuell && aktuell.slug === e.slug && !audio.paused;

  function svg(id) { return `<svg><use href="#${id}"/></svg>`; }

  function zeichnen() {
    const top = katalog[0];
    $("featured").hidden = !top;
    if (top) {
      const sonder = top.typ === "sonderfolge";
      $("f-badge").textContent = sonder ? "Sonderfolge" : gehoert(top) ? "Gehört" : "Neu";
      $("f-badge").className = "badge" + (sonder ? " sonder" : "");
      $("f-meta").textContent = `${datumLang(top.datum)} · ${minuten(top)}`;
      $("f-titel").textContent = top.titel;
      $("f-beschr").textContent = top.beschreibung;
      const p = position(top);
      $("f-progress").hidden = !(p > 5 && !gehoert(top));
      $("f-progress").firstElementChild.style.width = `${Math.min(100, (p / top.dauer_sek) * 100)}%`;
      $("f-play").innerHTML = spielt(top) ? `${svg("i-pause")}<span>Pause</span>`
        : `${svg("i-play")}<span>${gehoert(top) ? "Nochmal hören" : p > 5 ? "Weiterhören" : "Jetzt hören"}</span>`;
    }

    const liste = $("liste");
    liste.innerHTML = "";
    const eintraege = katalog.filter((e, i) => (filter === "alle" ? i > 0 : e.typ === filter));
    $("leer").hidden = eintraege.length > 0 || (filter === "alle" && !!top);
    for (const e of eintraege) {
      const d = tag(e.datum), p = position(e), fertig = gehoert(e);
      const li = document.createElement("li");
      li.innerHTML = `
        <button class="row${spielt(e) ? " playing" : ""}${fertig ? " gehoert" : ""}">
          <span class="datum"><b>${d.getDate()}</b><small>${d.toLocaleDateString("de-DE", { month: "short" }).replace(".", "")}</small></span>
          <span class="row-text">
            <b></b>
            <small>${fertig ? svg("i-check") : ""}${e.typ === "sonderfolge" ? "Sonderfolge · " : ""}${minuten(e)}${fertig ? " · gehört" : ""}</small>
            ${p > 5 && !fertig ? `<span class="progress"><span style="width:${Math.min(100, (p / e.dauer_sek) * 100)}%"></span></span>` : ""}
          </span>
          <span class="row-icon">${svg(spielt(e) ? "i-pause" : "i-play")}</span>
        </button>`;
      li.querySelector(".row-text b").textContent = e.titel;
      li.querySelector("button").addEventListener("click", () => abspielen(e));
      liste.appendChild(li);
    }
  }

  // ------------------------------------------------------------------ Laden & Abspielen
  function vorladen(e) {
    if (!blobs.has(e.slug)) {
      const p = holen(`folgen/${e.slug}.enc`)
        .then((d) => entschluesseln(schluessel, d))
        .then((mp3) => URL.createObjectURL(new Blob([mp3], { type: "audio/mpeg" })));
      p.catch(() => blobs.delete(e.slug));
      blobs.set(e.slug, p);
      // Nur wenige entschlüsselte Folgen im Speicher halten
      while (blobs.size > 3) {
        const [alt, prom] = blobs.entries().next().value;
        if (aktuell && alt === aktuell.slug) break;
        prom.then(URL.revokeObjectURL).catch(() => {});
        blobs.delete(alt);
      }
    }
    return blobs.get(e.slug);
  }

  // Ein winziges stilles WAV: einmal im Tipp-Moment abspielen, damit iOS das
  // Audio-Element freigibt, auch wenn die echte Folge erst noch entschlüsselt wird.
  const STILLE = (() => {
    const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const s = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE"); s(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    s(36, "data"); v.setUint32(40, n * 2, true);
    return "data:audio/wav;base64," + tob64(buf);
  })();

  async function abspielen(e) {
    if (aktuell && aktuell.slug === e.slug && audio.src) {
      audio.paused ? audio.play().catch(() => {}) : audio.pause();
      return;
    }
    if (aktuell) ls.set(K_POS + aktuell.slug, String(audio.currentTime));
    aktuell = e;
    playerFuellen(e, "Wird geladen …");
    if (!audio.src || audio.src.startsWith("data:")) { audio.src = STILLE; audio.play().catch(() => {}); }
    try {
      const url = await vorladen(e);
      if (aktuell !== e) return;
      audio.src = url;
      audio.playbackRate = parseFloat(ls.get(K_TEMPO) || "1");
      const start = gehoert(e) ? 0 : position(e);
      audio.addEventListener("loadedmetadata", () => { audio.currentTime = start; }, { once: true });
      await audio.play();
      $("mini-sub").textContent = datumLang(e.datum);
    } catch (err) {
      $("mini-sub").textContent = err.name === "NotAllowedError" ? "Zum Abspielen auf Play tippen" : "Konnte nicht geladen werden";
    }
    zeichnen();
  }

  function playerFuellen(e, status) {
    $("mini").hidden = false;
    $("mini-titel").textContent = e.titel;
    $("mini-sub").textContent = status;
    $("s-titel").textContent = e.titel;
    $("s-meta").textContent = `${e.typ === "sonderfolge" ? "Sonderfolge · " : ""}${datumLang(e.datum)}`;
    const q = $("s-quellen");
    q.hidden = !e.quellen_html;
    q.querySelector("div").innerHTML = e.quellen_html || "";
    q.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: e.titel, artist: "Morgenbriefing", album: e.typ === "sonderfolge" ? "Sonderfolgen" : "Morgenfolgen",
        artwork: [192, 512].map((n) => ({ src: new URL(`icon-${n}.png`, location.href).href, sizes: `${n}x${n}`, type: "image/png" })),
      });
    }
  }

  // ------------------------------------------------------------------ Player-Ereignisse
  const echteFolge = () => aktuell && audio.src && !audio.src.startsWith("data:");
  let letzteSicherung = 0;
  audio.addEventListener("timeupdate", () => {
    if (!echteFolge() || !audio.duration) return;
    const anteil = audio.currentTime / audio.duration;
    $("seek").value = Math.round(anteil * 1000);
    $("seek").style.setProperty("--p", `${anteil * 100}%`);
    $("mini-bar").style.width = `${anteil * 100}%`;
    $("t-now").textContent = zeit(audio.currentTime);
    $("t-left").textContent = "−" + zeit(audio.duration - audio.currentTime);
    if (Date.now() - letzteSicherung > 5000) {
      letzteSicherung = Date.now();
      ls.set(K_POS + aktuell.slug, String(audio.currentTime));
      if (audio.duration - audio.currentTime < 25) ls.set(K_GEHOERT + aktuell.slug, "1");
      if ("mediaSession" in navigator && navigator.mediaSession.setPositionState) {
        try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: audio.currentTime }); } catch { /* alt */ }
      }
    }
  });
  const playIcons = () => {
    const id = audio.paused ? "i-play" : "i-pause";
    $("mini-play").innerHTML = svg(id); $("b-play").innerHTML = svg(id);
    $("sheet").classList.toggle("spielt", !audio.paused);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  };
  audio.addEventListener("play", () => { playIcons(); if (echteFolge()) zeichnen(); });
  audio.addEventListener("pause", () => {
    playIcons();
    if (echteFolge()) { ls.set(K_POS + aktuell.slug, String(audio.currentTime)); zeichnen(); }
  });
  audio.addEventListener("ended", () => {
    if (!echteFolge()) return;
    ls.set(K_GEHOERT + aktuell.slug, "1"); ls.set(K_POS + aktuell.slug, "0");
    if (schlaf === "ende") schlafSetzen(0);
    zeichnen();
  });
  audio.addEventListener("ratechange", () => { $("b-speed").textContent = String(audio.playbackRate).replace(".", ",") + "×"; });

  const umschalten = () => { if (aktuell) (audio.paused ? audio.play().catch(() => {}) : audio.pause()); };
  const springen = (s) => { if (echteFolge()) audio.currentTime = Math.min(Math.max(0, audio.currentTime + s), audio.duration || 0); };
  $("mini-play").onclick = umschalten;
  $("b-play").onclick = umschalten;
  $("b-back").onclick = () => springen(-15);
  $("b-fwd").onclick = () => springen(30);
  $("f-play").onclick = () => katalog[0] && abspielen(katalog[0]);
  $("seek").addEventListener("input", (ev) => { if (audio.duration) audio.currentTime = (ev.target.value / 1000) * audio.duration; });

  const TEMPI = [1, 1.15, 1.25, 1.5, 1.75, 2, 0.85];
  $("b-speed").onclick = () => {
    const t = TEMPI[(TEMPI.indexOf(audio.playbackRate) + 1) % TEMPI.length];
    audio.playbackRate = t; ls.set(K_TEMPO, String(t));
  };
  $("b-speed").textContent = (ls.get(K_TEMPO) || "1").replace(".", ",") + "×";

  // Schlaf-Timer: Aus → 10 → 20 → 30 Min. → Ende der Folge → Aus
  let schlaf = 0, schlafUhr = null;
  const SCHLAF = [0, 10, 20, 30, "ende"];
  function schlafSetzen(wert) {
    schlaf = wert; clearTimeout(schlafUhr);
    const btn = $("b-sleep");
    btn.classList.toggle("on", !!wert);
    btn.querySelector("span").textContent = !wert ? "Schlaf-Timer" : wert === "ende" ? "Ende der Folge" : `${wert} Min.`;
    if (typeof wert === "number" && wert) schlafUhr = setTimeout(() => { audio.pause(); schlafSetzen(0); }, wert * 60000);
  }
  $("b-sleep").onclick = () => schlafSetzen(SCHLAF[(SCHLAF.indexOf(schlaf) + 1) % SCHLAF.length]);

  if ("mediaSession" in navigator) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* nicht unterstützt */ } };
    h("play", () => audio.play()); h("pause", () => audio.pause());
    h("seekbackward", () => springen(-15)); h("seekforward", () => springen(30));
    h("seekto", (d) => { if (echteFolge()) audio.currentTime = d.seekTime; });
  }

  // ------------------------------------------------------------------ Großer Player
  function sheet(auf) {
    $("sheet").classList.toggle("open", auf);
    $("sheet").setAttribute("aria-hidden", String(!auf));
    document.body.style.overflow = auf ? "hidden" : "";
  }
  $("mini-open").onclick = () => sheet(true);
  $("sheet-close").onclick = () => sheet(false);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") sheet(false);
    if (ev.key === " " && ev.target === document.body && aktuell) { ev.preventDefault(); umschalten(); }
  });
  let startY = null;
  $("sheet").addEventListener("touchstart", (ev) => { startY = $("sheet").scrollTop <= 0 ? ev.touches[0].clientY : null; }, { passive: true });
  $("sheet").addEventListener("touchend", (ev) => {
    if (startY !== null && ev.changedTouches[0].clientY - startY > 110) sheet(false);
    startY = null;
  });

  // ------------------------------------------------------------------ Oberfläche
  document.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".seg").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-selected", String(x === b)); });
    filter = b.dataset.filter; zeichnen();
  }));

  const themeIcon = () => { $("theme-btn").innerHTML = svg(document.documentElement.dataset.theme === "light" ? "i-moon" : "i-sun"); };
  $("theme-btn").onclick = () => {
    const hell = document.documentElement.dataset.theme !== "light";
    if (hell) document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
    ls.set("abi-theme", hell ? "light" : "dark");
    document.querySelector('meta[name="theme-color"]').content = hell ? "#eef2f9" : "#05070f";
    themeIcon();
  };
  themeIcon();

  $("menu-btn").onclick = (ev) => { ev.stopPropagation(); $("menu").hidden = !$("menu").hidden; };
  document.addEventListener("click", () => { $("menu").hidden = true; });
  $("refresh-btn").onclick = () => katalogLaden();
  $("logout-btn").onclick = () => abmelden();

  let installEvent = null;
  addEventListener("beforeinstallprompt", (ev) => { ev.preventDefault(); installEvent = ev; $("install-btn").hidden = false; });
  $("install-btn").onclick = () => { if (installEvent) { installEvent.prompt(); installEvent = null; $("install-btn").hidden = true; } };
  const installiert = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !installiert) $("ios-hint").hidden = false;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && schluessel && audio.paused) katalogLaden();
  });

  async function starten() {
    $("login").hidden = true; $("app").hidden = false;
    $("heute").textContent = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
    await katalogLaden();
  }

  (async () => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    const gespeichert = ls.get(K_SCHLUESSEL);
    if (gespeichert) {
      try {
        schluessel = await crypto.subtle.importKey("raw", b64(gespeichert), "AES-GCM", true, ["decrypt"]);
        return starten();
      } catch { ls.del(K_SCHLUESSEL); }
    }
    $("login").hidden = false;
  })();
})();
