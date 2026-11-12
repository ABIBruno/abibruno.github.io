/* ABIdasmuss – Cookie-Einwilligung, Geräte-ID und Statistik-Ping
   Kategorien:
     notwendig – immer an (Darstellung, Entsperren, Entwürfe; kein Cookie nötig)
     stat      – Statistik: zählt Anmeldungen pro Gerät (Geräte-ID als Cookie, beim Server nur gehasht)
     ki        – KI-Prüfung: Text wird an den KI-Anbieter weitergegeben; Geräte-ID für das Nutzungslimit
   Gespeichert wird die Wahl im Cookie „abi_consent“ (1 Jahr), die Geräte-ID im Cookie „abi_did“
   (nur wenn stat oder ki erlaubt ist, sonst wird sie gelöscht). */
(function () {
  'use strict';
  const WORKER = window.__UPLOAD || 'https://abidasmuss-upload.brunokmoch08.workers.dev';
  const C_CONSENT = 'abi_consent', C_DID = 'abi_did', YEAR = 365 * 24 * 3600, VERSION = '1';

  const getC = n => { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; };
  const setC = (n, v, age) => { document.cookie = `${n}=${encodeURIComponent(v)}; Max-Age=${age}; Path=/; SameSite=Lax; Secure`; };
  const delC = n => { document.cookie = `${n}=; Max-Age=0; Path=/; SameSite=Lax; Secure`; };

  function read() {
    const raw = getC(C_CONSENT);
    if (!raw) return null;
    const [v, stat, ki] = raw.split('.');
    if (v !== VERSION) return null;
    return { stat: stat === '1', ki: ki === '1' };
  }
  function save(c) {
    setC(C_CONSENT, [VERSION, c.stat ? 1 : 0, c.ki ? 1 : 0].join('.'), YEAR);
    if (!c.stat && !c.ki) delC(C_DID);
    close();
    document.dispatchEvent(new CustomEvent('abi-consent', { detail: c }));
  }
  function deviceId() {
    const c = read();
    if (!c || (!c.stat && !c.ki)) return null;
    let id = getC(C_DID);
    if (!/^[a-f0-9]{32}$/.test(id || '')) {
      const b = crypto.getRandomValues(new Uint8Array(16));
      id = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    }
    setC(C_DID, id, YEAR);
    return id;
  }

  /* ---------- Banner ---------- */
  const CSS = `.cookiebar{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;display:flex;justify-content:center;font-family:Inter,system-ui,sans-serif}
.cookiebar .cb-in{max-width:640px;width:100%;background:#0d1226;color:#e8ecff;border:1px solid #3a4b8a;border-radius:16px;padding:16px 18px;box-shadow:0 10px 40px rgba(0,0,0,.6);font-size:14px;line-height:1.45}
.cookiebar p{margin:6px 0 10px}.cookiebar .cb-row{display:flex;gap:10px;align-items:flex-start;margin:8px 0;cursor:pointer}
.cookiebar input{margin-top:3px;accent-color:#22d3ee;width:18px;height:18px;flex:none}.cookiebar small{display:block;margin-top:10px;opacity:.75}.cookiebar a{color:#22d3ee}
.cookiebar .cb-btns{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:12px}
.cookiebar button{font:inherit;font-weight:700;letter-spacing:.06em;border-radius:10px;padding:9px 14px;cursor:pointer;border:1px solid #22d3ee;background:transparent;color:#e8ecff}
.cookiebar #cbAll{background:linear-gradient(90deg,#22d3ee,#a855f7);border:0;color:#050816}
@media(max-width:520px){.cookiebar .cb-btns button{flex:1 1 100%}}`;
  let box = null;
  function close() { if (box) { box.remove(); box = null; } }
  function open() {
    close();
    const c = read() || { stat: false, ki: false };
    if (!document.getElementById('cb-css')) { const st = document.createElement('style'); st.id = 'cb-css'; st.textContent = CSS; document.head.appendChild(st); }
    box = document.createElement('div');
    box.className = 'cookiebar';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Cookie-Einstellungen');
    box.innerHTML = `
      <div class="cb-in">
        <b>🍪 Cookies &amp; Daten</b>
        <p>Die Seite funktioniert ohne Zustimmung. Für zwei Zusatzfunktionen brauchen wir deine Erlaubnis:</p>
        <label class="cb-row"><input type="checkbox" checked disabled> <span><b>Notwendig</b> – Darstellung, Entsperren, Entwürfe (nur in deinem Browser)</span></label>
        <label class="cb-row"><input type="checkbox" id="cbStat" ${c.stat ? 'checked' : ''}> <span><b>Statistik</b> – zählt, wie oft sich Geräte anmelden. Dafür bekommt dein Browser eine zufällige Kennung; beim Server kommt sie nur unlesbar (gehasht) an.</span></label>
        <label class="cb-row"><input type="checkbox" id="cbKi" ${c.ki ? 'checked' : ''}> <span><b>KI-Prüfung</b> – dein Text, die Aufgabe und das Erwartungsbild werden zur Bewertung an einen KI-Anbieter geschickt (Weitergabe an Dritte). Zufällige Kennung für das Nutzungslimit.</span></label>
        <div class="cb-btns">
          <button class="btn ghost" id="cbNo" type="button">ABLEHNEN</button>
          <button class="btn ghost" id="cbSave" type="button">AUSWAHL SPEICHERN</button>
          <button class="btn" id="cbAll" type="button">ALLE AKZEPTIEREN</button>
        </div>
        <small>Mehr in der <a href="${new URL('datenschutz.html', document.querySelector('script[src*="consent.js"]').src).href}">Datenschutzerklärung</a>. Ändern geht jederzeit unten über „Cookie-Einstellungen“.</small>
      </div>`;
    document.body.appendChild(box);
    box.querySelector('#cbNo').onclick = () => save({ stat: false, ki: false });
    box.querySelector('#cbAll').onclick = () => save({ stat: true, ki: true });
    box.querySelector('#cbSave').onclick = () => save({ stat: box.querySelector('#cbStat').checked, ki: box.querySelector('#cbKi').checked });
  }

  /* ---------- Statistik ---------- */
  // Ohne Zustimmung: nur ein anonymer Zähler (keine Kennung, kein Cookie). Mit Zustimmung: Anmeldung pro gehashtem Gerät.
  function ping(ev, fach) {
    try {
      const c = read();
      const did = c && c.stat ? deviceId() : null;
      const body = JSON.stringify({ ev: ev === 'login' ? 'login' : 'visit', fach: String(fach || 'start').slice(0, 20) });
      fetch(WORKER + '/ping', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(did ? { 'X-Device': did } : {}) }, body, keepalive: true }).catch(() => {});
    } catch (e) { /* Statistik darf nie stören */ }
  }

  function init() {
    // Footer-Link „Cookie-Einstellungen“
    document.querySelectorAll('footer.footer').forEach(f => {
      if (f.querySelector('.cookielink')) return;
      const b = document.createElement('button');
      b.className = 'link cookielink'; b.type = 'button'; b.textContent = 'COOKIE-EINSTELLUNGEN';
      b.onclick = open;
      f.appendChild(b);
    });
    if (!read()) open();
    try { if (!sessionStorage.getItem('abi-visit')) { sessionStorage.setItem('abi-visit', '1'); ping('visit', window.__CHAT && window.__CHAT.fach); } } catch (e) { /* egal */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.AbiConsent = { get: read, has: k => !!(read() || {})[k], deviceId, open, ping, worker: WORKER };
})();
