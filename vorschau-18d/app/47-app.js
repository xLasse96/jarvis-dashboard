// JARVIS Dashboard – Modul „app“ (ab 11-09o). Windows-, Tablet- und Web-App-Vorbereitung ohne neue Berechtigungen:
//   - anpassbare Startseite (Cockpit / Analyse / Trading); Sprungadresse #cockpit/#analyse/#trading (auch für Manifest-Verknüpfungen)
//   - Installation: „Installieren“ nur, wenn der Browser es anbietet (beforeinstallprompt), sonst Anleitung; Anzeige, ob als App geöffnet
//   - verständliche Offline-Anzeige – trennt „Browser offline“ von „Worker erreichbar“ (keine falsche Online-Meldung)
//   - Vollbild, soweit der Browser es kann; Bildschirmtastatur: passende Eingabetasten (enterkeyhint/inputmode)
//   - Versionsanzeige mit geladenen Modulen und Ladefehlern; Aktualisierungshinweis bleibt der vorhandene Tab-Abgleich (04-simulation)
// Bewusst ohne Service Worker und ohne Offline-Cache: jede neue Version gilt sofort, keine veralteten Sicherheitsmodule aus einem Cache.
// Speicher „jarvis-start“ { art, version, ansicht }.
const APP = { schluessel: "jarvis-start", installation: null, ansichten: ["cockpit", "analyse", "trading"] };
function appStartLesen() { const d = speicherJsonLesen(APP.schluessel, (x) => istObjekt(x) && x.art === "jarvis-start"); return d && APP.ansichten.includes(d.ansicht) ? d.ansicht : "cockpit"; }
function appStartSetzen(ansicht) {
  if (!APP.ansichten.includes(ansicht) || speicherBeschaedigt(APP.schluessel)) return false;
  try { localStorage.setItem(APP.schluessel, JSON.stringify({ art: "jarvis-start", version: 1, ansicht })); return true; } catch (e) { return false; }
}
// Startansicht: Sprungadresse vor Einstellung; ungültige Adresse → Einstellung
function appStartansicht(hash = location.hash) { const h = String(hash || "").replace(/^#/, "").toLowerCase(); return APP.ansichten.includes(h) ? h : appStartLesen(); }
function appModus() {
  const standalone = (window.matchMedia && (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches)) || navigator.standalone === true;
  return standalone ? "als installierte App geöffnet" : "im Browser-Tab geöffnet";
}
function appVersion() {
  const skripte = [...document.querySelectorAll('script[src^="app/"]')].map((s) => s.getAttribute("src").replace(/^app\/\d+-/, "").replace(/\.js$/, ""));
  const geladen = window.JARVIS_MODULE || [];
  const fehlt = skripte.filter((n) => !geladen.includes(n));
  const hinweis = document.getElementById("version-hinweis");
  return { stand: typeof JARVIS_STAND !== "undefined" ? JARVIS_STAND : "", module: geladen.length, erwartet: skripte.length, fehlt, ladefehler: hinweis && !hinweis.hidden ? hinweis.textContent.trim().slice(0, 200) : "" };
}
// Netz: Browser-Zustand ehrlich benennen; über den Worker sagt navigator.onLine nichts
function appNetzText(online = navigator.onLine) {
  return online ? "Browser meldet eine Netzverbindung. Ob der eigene Worker erreichbar ist, zeigt die Statuszeile („VERBUNDEN“/„NICHT ERREICHBAR“) – „online“ heißt nicht „verbunden“."
    : "Offline – der Browser meldet keine Netzverbindung. Lokale Funktionen (Aufgaben, Notizen, Projekte, Rechnen, Dateien) gehen weiter; KI, Kurse und Worker nicht.";
}
function appNetzAnzeigen() {
  const el = document.getElementById("app-netz");
  if (!el) return;
  el.textContent = appNetzText();
  el.classList.toggle("wz-wichtig", !navigator.onLine);
  const banner = document.getElementById("app-offline");
  if (banner) { banner.hidden = navigator.onLine; banner.textContent = navigator.onLine ? "" : "⚠ Offline – lokale Funktionen gehen weiter, KI und Kurse nicht."; }
}
function appVollbildUmschalten() {
  const d = document;
  if (!d.fullscreenEnabled || !d.documentElement.requestFullscreen) return { fehler: "Vollbild wird von diesem Browser hier nicht unterstützt (bei installierter App ggf. über das Fenstermenü)." };
  if (d.fullscreenElement) { d.exitFullscreen(); return { text: "Vollbild beendet." }; }
  return d.documentElement.requestFullscreen().then(() => ({ text: "Vollbild an – Esc beendet es." }), (e) => ({ fehler: "Vollbild abgelehnt: " + e.message }));
}
// Bildschirmtastatur: passende Eingabetaste je Feldart (nur Attribute, keine Verhaltensänderung)
function appTastaturHinweise(wurzel = document) {
  let n = 0;
  for (const f of wurzel.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=date]):not([type=time]), textarea")) {
    if (f.hasAttribute("enterkeyhint")) continue;
    f.setAttribute("enterkeyhint", f.id === "befehl" ? "send" : f.type === "search" ? "search" : f.tagName === "TEXTAREA" ? "enter" : f.closest("form") ? "done" : "go");
    if (f.type === "number" && !f.hasAttribute("inputmode")) f.setAttribute("inputmode", f.step && f.step !== "1" ? "decimal" : "numeric");
    n++;
  }
  return n;
}
function appAnzeigen() {
  const el = (id) => document.getElementById(id);
  if (!el("app-start")) return;
  el("app-start").value = appStartLesen();
  const v = appVersion();
  el("app-version").textContent = `Stand ${v.stand || "unbekannt"} · ${v.module} von ${v.erwartet} Modulen geladen` + (v.fehlt.length ? ` · ⚠ fehlt: ${v.fehlt.join(", ")}` : "") + (v.ladefehler ? ` · ${v.ladefehler}` : "") + ` · ${appModus()}`;
  el("app-installieren").hidden = !APP.installation;
  el("app-installation").textContent = APP.installation ? "Der Browser bietet die Installation an – „Installieren“ öffnet seinen eigenen Dialog."
    : appModus().startsWith("als installierte") ? "JARVIS läuft bereits als installierte App." : "Installieren: in Edge/Chrome im Adressfeld auf das App-Symbol bzw. Menü „…“ → „Apps“ → „Diese Website als App installieren“. Auf dem Tablet: Browsermenü → „Zum Startbildschirm“. Danach startet JARVIS in einem eigenen Fenster.";
  appNetzAnzeigen();
}
(function appEinrichten() {
  const el = (id) => document.getElementById(id);
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); APP.installation = e; appAnzeigen(); });
  window.addEventListener("appinstalled", () => { APP.installation = null; appAnzeigen(); });
  window.addEventListener("online", appNetzAnzeigen);
  window.addEventListener("offline", appNetzAnzeigen);
  window.addEventListener("hashchange", () => { const a = appStartansicht(); if (location.hash && typeof ansichtZeigen === "function") ansichtZeigen(a); });
  if (!el("app-start")) return;
  el("app-start").addEventListener("change", () => { el("app-meldung").textContent = appStartSetzen(el("app-start").value) ? "Startseite gespeichert – gilt beim nächsten Öffnen." : "Nicht gespeichert: " + SPEICHER_SCHADEN_TEXT; });
  el("app-installieren").addEventListener("click", async () => {
    const p = APP.installation; if (!p) return;
    APP.installation = null; p.prompt();
    try { const r = await p.userChoice; el("app-meldung").textContent = r && r.outcome === "accepted" ? "Installation gestartet." : "Installation abgelehnt."; } catch (e) { /* Browser */ }
    appAnzeigen();
  });
  el("app-vollbild").addEventListener("click", async () => { const r = await appVollbildUmschalten(); el("app-meldung").textContent = r.fehler || r.text; });
  appTastaturHinweise();
  appAnzeigen();
  // Startansicht erst nach dem Laden aller Module (Cockpit bleibt der Standard)
  const start = appStartansicht();
  if (start !== "cockpit" && typeof ansichtZeigen === "function") setTimeout(() => ansichtZeigen(start), 0);
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("app");
