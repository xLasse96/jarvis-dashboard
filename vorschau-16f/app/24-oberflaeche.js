// JARVIS Dashboard – Modul „oberflaeche“ (ab 11-06j). Einheitliche Navigation und Statusanzeigen, ohne neue Daten:
//   - Sprungleiste: je Ansicht ein Knopf pro Karte (aus den vorhandenen Kartentiteln); öffnet zugeklappte Karten und setzt den Fokus
//   - Einstellungen: Schnellzugriff auf alle Stellen mit Einstellungen (auch in anderen Ansichten)
//   - Kopfzeile: Zustand von Mikrofon und Vorlesen (gespiegelt aus der Karte „Funktionen“ und der laufenden Aufnahme)
// Keine Anfrage, kein Speicher.
const EINSTELLUNGEN_ZIELE = [
  { text: "Verbindung", ansicht: "cockpit", titel: "Verbindung" },
  { text: "Stimme & Sprache", ansicht: "cockpit", element: "stimme-wahl" },
  { text: "Freigaben", ansicht: "cockpit", titel: "Fähigkeiten & Freigaben" },
  { text: "Daten auf diesem Gerät", ansicht: "cockpit", element: "daten-karte" },
  { text: "Risiko-Warnschwellen", ansicht: "trading", element: "sim-schwellen-form" },
  { text: "Not-Aus", ansicht: "trading", titel: "Not-Aus" },
];
const kartenTitelText = (h) => [...h.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
function zuElementSpringen(ziel) {
  if (!ziel) return false;
  const nav = document.getElementById("sprung-details");
  if (nav) nav.open = false; // Navigationsfeld nach dem Sprung schließen
  const d = ziel.closest("details");
  if (d && !d.open) d.open = true;
  // ab 14ze: Karte im eingeklappten Bereich Weitere Werkzeuge – Bereich für den Sprung öffnen
  if (ziel.closest(".karte.weitere") && document.body.classList.contains("weitere-zu") && typeof weitereSetzen === "function") weitereSetzen(false);
  const zuKarte = ziel.closest("article.karte-zu"); // ab 11-07a: eingeklappte Karte für den Sprung öffnen (ohne Speichern)
  if (zuKarte) karteSetzen(zuKarte, false);
  const fokus = ziel.matches("h2, h3") ? ziel : ziel.querySelector("h2, h3, input, select, button") || ziel;
  if (fokus.matches("h2, h3") && !fokus.hasAttribute("tabindex")) fokus.setAttribute("tabindex", "-1");
  if (typeof ziel.scrollIntoView === "function") ziel.scrollIntoView({ block: "start" });
  fokus.focus({ preventScroll: true });
  return true;
}
function titelFinden(ansicht, titel) { return [...document.querySelectorAll(`#ansicht-${ansicht} .karte-titel`)].find((h) => kartenTitelText(h) === titel) || null; }
function einstellungAnspringen(z) {
  if (typeof ansichtZeigen === "function" && document.getElementById("ansicht-" + z.ansicht).hidden) ansichtZeigen(z.ansicht);
  return zuElementSpringen(z.element ? document.getElementById(z.element) : titelFinden(z.ansicht, z.titel));
}
function sprungleisteAktualisieren(name) {
  const nav = document.getElementById("sprungleiste");
  if (!nav) return;
  const sektion = document.getElementById("ansicht-" + (name || "cockpit"));
  const titel = sektion ? [...sektion.querySelectorAll(".karte-titel")].filter((h) => kartenTitelText(h)) : [];
  const knopf = (text, f, label) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "sprung", textContent: text }); b.setAttribute("aria-label", label || text); b.addEventListener("click", f); return b; };
  const karten = document.getElementById("sprung-karten"), einst = document.getElementById("sprung-einstellungen");
  // ab 11-07b: neben jeder Karte ein Merk-Knopf (Favorit); Sprünge über die Navigation landen in „Zuletzt“
  const favs = new Set(navListeLesen(NAV.fav));
  karten.replaceChildren(...titel.map((h) => {
    const id = `karte:${name || "cockpit"}:${karteSchluessel(h)}`, t = kartenTitelText(h);
    const eintrag = Object.assign(document.createElement("span"), { className: "sprung-eintrag" });
    const fav = knopf(favs.has(id) ? "★" : "☆", () => navFavoritUmschalten(id), (favs.has(id) ? "Favorit entfernen: " : "Als Favorit merken: ") + t);
    fav.classList.add("sprung-fav");
    fav.setAttribute("aria-pressed", String(favs.has(id)));
    eintrag.append(knopf(t, () => navAnspringen(id), "Zur Karte " + t), fav);
    return eintrag;
  }));
  einst.replaceChildren(...EINSTELLUNGEN_ZIELE.filter((z) => z.element ? document.getElementById(z.element) : titelFinden(z.ansicht, z.titel)).map((z) => knopf(z.text, () => navAnspringen("einst:" + z.text), "Einstellung: " + z.text)));
  navListenAnzeigen();
}
// ---------- Suche, Favoriten, zuletzt genutzt (ab 11-07b) ----------
// Ein Verzeichnis aller Ziele: Bereiche, Karten aller drei Ansichten, Einstellungen und einige Befehle. Favoriten und die letzten
// fünf Sprünge stehen als Ziel-IDs in localStorage („jarvis-nav-favoriten“, „jarvis-nav-zuletzt“). Ein Ziel, das es nicht mehr gibt,
// wird nur ausgeblendet, nicht gelöscht. Beschädigter Speicher → leer anzeigen, nichts überschreiben. Kein Befehl schaltet etwas
// Sicherheitsrelevantes: „Zum Not-Aus“ springt nur.
const NAV = { fav: "jarvis-nav-favoriten", zuletzt: "jarvis-nav-zuletzt", maxZuletzt: 5, maxTreffer: 12 };
const ANSICHT_NAMEN = { cockpit: "Cockpit", analyse: "Analyse", trading: "Trading" };
const navFalten = (s) => String(s).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFKD").replace(/[̀-ͯ]/g, "");
const navListeLesen = (k) => speicherJsonLesen(k, (x) => Array.isArray(x) && x.every((y) => typeof y === "string")) || [];
function navListeSchreiben(k, liste) {
  if (speicherBeschaedigt(k)) return false;
  try { localStorage.setItem(k, JSON.stringify(liste)); return true; } catch (e) { return false; }
}
function ansichtSicherstellen(a) { if (typeof ansichtZeigen === "function" && document.getElementById("ansicht-" + a).hidden) ansichtZeigen(a); }
function alleKartenAufklappen() {
  for (const art of document.querySelectorAll("article.karte-zu")) karteSetzen(art, false);
  kartenZuLesen(); // prüft den Speicher; beschädigt → nicht überschreiben
  const ok = navListeSchreiben(KARTEN_ZU.schluessel, []);
  const nav = document.getElementById("sprung-details");
  if (nav) nav.open = false;
  return ok;
}
function navZiele() {
  const ziele = [], ids = new Set();
  const dazu = (z) => { if (!ids.has(z.id)) { ids.add(z.id); ziele.push(z); } };
  for (const a of Object.keys(ANSICHT_NAMEN)) {
    dazu({ id: "ansicht:" + a, text: ANSICHT_NAMEN[a], art: "Bereich", ansicht: a, los: () => { ansichtSicherstellen(a); return zuElementSpringen(document.getElementById("reiter-" + a)); } });
    for (const h of document.querySelectorAll(`#ansicht-${a} .karte-titel`)) {
      const t = kartenTitelText(h);
      if (t) dazu({ id: `karte:${a}:${karteSchluessel(h)}`, text: t, art: "Karte", ansicht: a, los: () => { ansichtSicherstellen(a); return zuElementSpringen(h); } });
    }
  }
  for (const z of EINSTELLUNGEN_ZIELE) {
    if (z.element ? document.getElementById(z.element) : titelFinden(z.ansicht, z.titel)) dazu({ id: "einst:" + z.text, text: z.text, art: "Einstellung", ansicht: z.ansicht, los: () => einstellungAnspringen(z) });
  }
  dazu({ id: "befehl:notaus", text: "Zum Not-Aus springen", art: "Befehl", ansicht: "trading", stichworte: "stopp notfall", los: zumNotaus });
  dazu({ id: "befehl:eingabe", text: "Befehl an JARVIS eingeben", art: "Befehl", ansicht: "cockpit", stichworte: "chat frage nachricht", los: () => { ansichtSicherstellen("cockpit"); return zuElementSpringen(document.getElementById("befehl")); } });
  dazu({ id: "befehl:aufklappen", text: "Alle Karten ausklappen", art: "Befehl", ansicht: "", stichworte: "oeffnen einklappen", los: alleKartenAufklappen });
  return ziele;
}
// Alle Suchwörter müssen vorkommen (Titel, Art, Ansicht, Stichworte; Umlaute gleichwertig zu ae/oe/ue). Rang: Titelanfang vor Titel vor Rest.
function navSuchen(frage) {
  const woerter = navFalten(frage).split(/\s+/).filter(Boolean);
  if (!woerter.length) return [];
  return navZiele().map((z) => {
    const t = navFalten(z.text), voll = [t, navFalten(z.art), navFalten(ANSICHT_NAMEN[z.ansicht] || ""), navFalten(z.stichworte || "")].join(" ");
    if (!woerter.every((w) => voll.includes(w))) return null;
    return { z, rang: t.startsWith(woerter[0]) ? 0 : woerter.every((w) => t.includes(w)) ? 1 : 2 };
  }).filter(Boolean).sort((a, b) => a.rang - b.rang).slice(0, NAV.maxTreffer).map((x) => x.z);
}
function navAnspringen(id) {
  const z = navZiele().find((x) => x.id === id);
  if (!z) return false;
  const liste = navListeLesen(NAV.zuletzt);
  navListeSchreiben(NAV.zuletzt, [id, ...liste.filter((x) => x !== id)].slice(0, NAV.maxZuletzt));
  const ok = z.los() !== false;
  navListenAnzeigen();
  return ok;
}
function navFavoritUmschalten(id) {
  const liste = navListeLesen(NAV.fav);
  const neu = liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id];
  const ok = navListeSchreiben(NAV.fav, neu);
  const aktiv = Object.keys(ANSICHT_NAMEN).find((a) => !document.getElementById("ansicht-" + a).hidden) || "cockpit";
  const fokusIndex = [...document.querySelectorAll("#sprung-karten .sprung-fav")].indexOf(document.activeElement);
  sprungleisteAktualisieren(aktiv);
  if (fokusIndex >= 0) { const f = document.querySelectorAll("#sprung-karten .sprung-fav")[fokusIndex]; if (f) f.focus(); }
  const status = document.getElementById("sprung-suche-status");
  if (status) status.textContent = ok ? "" : "Favoriten nicht gespeichert: " + SPEICHER_SCHADEN_TEXT;
  return ok;
}
function navZielKnopf(z) {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "sprung" });
  const ort = z.art === "Befehl" ? "Befehl" : z.art === "Bereich" ? "Bereich" : z.art + " · " + (ANSICHT_NAMEN[z.ansicht] || "");
  b.append(z.text, Object.assign(document.createElement("span"), { className: "klein sprung-ort", textContent: " (" + ort + ")" }));
  b.setAttribute("aria-label", z.text + ", " + ort);
  b.dataset.ziel = z.id;
  b.addEventListener("click", () => navAnspringen(z.id));
  return b;
}
function navListenAnzeigen() {
  const ziele = new Map(navZiele().map((z) => [z.id, z]));
  for (const [gruppe, k] of [["favoriten", NAV.fav], ["zuletzt", NAV.zuletzt]]) {
    const el = document.getElementById("sprung-" + gruppe);
    if (!el) continue;
    const knoepfe = navListeLesen(k).map((id) => ziele.get(id)).filter(Boolean).map(navZielKnopf);
    el.replaceChildren(...knoepfe);
    document.getElementById("sprung-" + gruppe + "-gruppe").hidden = knoepfe.length === 0;
  }
}
function navSucheAnzeigen() {
  const feld = document.getElementById("sprung-suche");
  const treffer = navSuchen(feld.value);
  document.getElementById("sprung-treffer").replaceChildren(...treffer.map(navZielKnopf));
  document.getElementById("sprung-treffer-gruppe").hidden = !feld.value.trim();
  document.getElementById("sprung-suche-status").textContent = !feld.value.trim() ? "" : treffer.length ? treffer.length + " Treffer – Enter springt zum ersten." : "Keine Treffer.";
  return treffer;
}
// Nach Löschen/Übernehmen des Bereichs „Oberfläche“ (Datenkarte): Kartenzustand und Listen sofort aus dem Speicher übernehmen
function oberflaecheNeuLaden() {
  const zu = kartenZuLesen();
  for (const h of document.querySelectorAll("article.karte > h2.karte-titel")) {
    if (h.querySelector(".karte-klappe")) karteSetzen(h.parentElement, zu.has(karteSchluessel(h)));
  }
  const aktiv = Object.keys(ANSICHT_NAMEN).find((a) => !document.getElementById("ansicht-" + a).hidden) || "cockpit";
  sprungleisteAktualisieren(aktiv);
}
function navOeffnen() {
  const nav = document.getElementById("sprung-details");
  nav.open = true;
  const feld = document.getElementById("sprung-suche");
  feld.focus();
  feld.select();
}
(function navSucheEinrichten() {
  const feld = document.getElementById("sprung-suche"), nav = document.getElementById("sprung-details");
  feld.addEventListener("input", navSucheAnzeigen);
  feld.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); const t = navSucheAnzeigen(); if (t.length) navAnspringen(t[0].id); }
    if (e.key === "ArrowDown") { const b = document.querySelector("#sprung-treffer button"); if (b) { e.preventDefault(); b.focus(); } }
  });
  // Esc im Navigationsfeld schließt es und gibt den Fokus an „Navigation“ zurück
  nav.addEventListener("keydown", (e) => { if (e.key === "Escape" && nav.open) { e.preventDefault(); nav.open = false; nav.querySelector("summary").focus(); } });
  nav.addEventListener("toggle", () => { if (nav.open) navListenAnzeigen(); });
  // Strg+K bzw. ⌘+K öffnet die Suche aus jeder Ansicht (auch aus Eingabefeldern)
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); navOeffnen(); }
  });
})();
function kopfSpracheAktualisieren() {
  const el = document.getElementById("kopf-sprache");
  if (!el) return;
  const t = (id) => ((document.getElementById(id) || {}).textContent || "").trim();
  const laeuft = typeof window.spracheingabeLaeuft === "function" && window.spracheingabeLaeuft();
  // Zustand aus der Klasse der Statusfelder („ok“ = unterstützt bzw. eingeschaltet), nicht aus dem Text (Stimmennamen)
  const ok = (id) => (document.getElementById(id) || {}).className === "ok";
  const mikro = laeuft ? "hört zu" : ok("spracheingabe-status") ? "bereit" : "aus";
  const vorlesen = ok("vorlesen-status") ? "an" : "aus";
  const text = `MIKRO: ${mikro.toUpperCase()} · VORLESEN: ${vorlesen.toUpperCase()}`;
  if (el.textContent !== text) el.textContent = text;
  el.dataset.mikro = mikro;
  el.title = `Spracheingabe: ${t("spracheingabe-status") || "unbekannt"} · Vorlesen: ${t("vorlesen-status") || "unbekannt"}`;
}
// ---------- Einklappbare Karten (ab 11-07a) ----------
// Jede Karte mit Titel (h2.karte-titel) bekommt einen Knopf „einklappen/ausklappen“. Zustand je Karte (Titel-ID bzw. Titeltext) in
// localStorage „jarvis-karten-zu“ (Liste). Ausgenommen: Not-Aus-Karte (muss immer sichtbar bleiben) und Karten in <details>.
// Beschädigter Speicher → nichts eingeklappt, nichts überschrieben (SPEICHER_SCHADEN).
const KARTEN_ZU = { schluessel: "jarvis-karten-zu", nie: (art) => art.classList.contains("notaus-karte") };
const karteSchluessel = (h) => h.id || "titel:" + kartenTitelText(h);
function kartenZuLesen() { const d = speicherJsonLesen(KARTEN_ZU.schluessel, (x) => Array.isArray(x) && x.every((y) => typeof y === "string")); return new Set(d || []); }
function karteSetzen(art, zu) {
  const inhalt = art.querySelector(":scope > .karte-inhalt"), knopf = art.querySelector(":scope > .karte-titel .karte-klappe");
  if (!inhalt || !knopf) return;
  inhalt.hidden = zu;
  art.classList.toggle("karte-zu", zu);
  knopf.setAttribute("aria-expanded", String(!zu));
  knopf.setAttribute("aria-label", (zu ? "Ausklappen: " : "Einklappen: ") + kartenTitelText(art.querySelector(":scope > .karte-titel")));
}
function karteUmschalten(art) {
  const h = art.querySelector(":scope > .karte-titel");
  const zu = !art.classList.contains("karte-zu");
  karteSetzen(art, zu);
  if (speicherBeschaedigt(KARTEN_ZU.schluessel)) return false; // nur für diese Sitzung
  const menge = kartenZuLesen();
  if (zu) menge.add(karteSchluessel(h)); else menge.delete(karteSchluessel(h));
  try { localStorage.setItem(KARTEN_ZU.schluessel, JSON.stringify([...menge])); return true; } catch (e) { return false; }
}
function kartenKlappenEinrichten() {
  const zu = kartenZuLesen();
  for (const h of document.querySelectorAll("article.karte > h2.karte-titel")) {
    const art = h.parentElement;
    if (KARTEN_ZU.nie(art) || art.querySelector(":scope > .karte-titel .karte-klappe") || !art.querySelector(":scope > .karte-inhalt")) continue;
    const b = Object.assign(document.createElement("button"), { type: "button", className: "karte-klappe" });
    b.addEventListener("click", (e) => { e.stopPropagation(); karteUmschalten(art); });
    h.prepend(b);
    karteSetzen(art, zu.has(karteSchluessel(h)));
  }
}
// Not-Aus dauerhaft erreichbar: Kopfzeilen-Knopf springt zur Not-Aus-Karte (schaltet NICHTS – das bleibt dem Knopf in der Karte)
function zumNotaus() {
  if (typeof ansichtZeigen === "function") ansichtZeigen("trading");
  const n = document.getElementById("notaus");
  if (n && typeof n.scrollIntoView === "function") n.scrollIntoView({ block: "center" });
  if (n) n.focus();
  return Boolean(n);
}
document.getElementById("kopf-notaus").addEventListener("click", zumNotaus);
document.addEventListener("DOMContentLoaded", () => {
  kartenKlappenEinrichten();
  const aktiv = ["cockpit", "analyse", "trading"].find((a) => !document.getElementById("ansicht-" + a).hidden) || "cockpit";
  sprungleisteAktualisieren(aktiv);
  kopfSpracheAktualisieren();
});
// ab 11-07o: im verborgenen Tab nicht aktualisieren (beim Zurückkehren sofort)
setInterval(() => { if (document.visibilityState !== "hidden") kopfSpracheAktualisieren(); }, 1500);
document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "hidden") kopfSpracheAktualisieren(); });

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("oberflaeche");
