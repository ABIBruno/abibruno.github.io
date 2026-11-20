// Morgenbriefing – Service Worker
// App startet auch offline; die letzten Folgen bleiben (verschlüsselt) im Speicher.
const SHELL = "mb-shell-v1";
const FOLGEN = "mb-folgen-v1";
const MAX_FOLGEN = 6;
const DATEIEN = ["./", "index.html", "podcast.css?v=1", "podcast.js?v=1", "manifest.webmanifest",
  "icon-180.png", "icon-192.png", "icon-512.png", "../fonts/fonts.css", "../fonts/inter.woff2", "../fonts/orbitron.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mb-") && ![SHELL, FOLGEN].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.startsWith("/podcast-daten/folgen/")) {
    // Folgen ändern sich nie: Cache zuerst
    e.respondWith(caches.open(FOLGEN).then(async (c) => {
      const treffer = await c.match(url.pathname);
      if (treffer) return treffer;
      const antwort = await fetch(e.request);
      if (antwort.ok) {
        await c.put(url.pathname, antwort.clone());
        const keys = await c.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - MAX_FOLGEN))) await c.delete(k);
      }
      return antwort;
    }));
    return;
  }
  if (url.pathname.startsWith("/podcast-daten/")) {
    // Katalog & Schlüsselinfo: immer frisch, offline aus dem Speicher
    e.respondWith(fetch(e.request).then((r) => {
      const kopie = r.clone();
      caches.open(SHELL).then((c) => c.put(url.pathname, kopie));
      return r;
    }).catch(() => caches.match(url.pathname)));
    return;
  }
  if (url.pathname.startsWith("/podcast/") || url.pathname.startsWith("/fonts/")) {
    // App-Dateien: Netz zuerst (Updates kommen sofort an), sonst Speicher
    e.respondWith(fetch(e.request).then((r) => {
      const kopie = r.clone();
      caches.open(SHELL).then((c) => c.put(e.request, kopie));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
