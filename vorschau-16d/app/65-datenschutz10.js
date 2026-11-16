// JARVIS Dashboard – Modul „datenschutz10“ (ab 11-10p). Sicherheit und Datenschutz über alle Bereiche der 10er-Serie – ergänzt
// 17-uebersichten-freigaben.js (Datenbereiche, Export/Import mit Vorschau, Löschen) und 48-datenpruefung.js (Prüfung, Sicherung,
// Wiederherstellung, Abgleich zwischen Tabs, Speichergrenze, unterbrochene Schreibvorgänge):
//   - Grundformen (Schema) der neuen Speicher (Modell, Vorschläge, Datenquellen, Seitenleiste) für Prüfung und Wiederherstellung
//   - Neuladen dieser Bereiche, wenn ein anderer Tab sie ändert (statt mit veraltetem Stand weiterzuschreiben)
//   - Abdeckungsprüfung: jeder „jarvis-…“-Schlüssel im Browserspeicher muss zu einem Datenbereich gehören – sonst fehlte er in
//     Sicherung, Export und „Alles löschen“. Gefundene Lücken werden gemeldet (nicht automatisch gelöscht).
// Kein eigener Speicher.
const DS10_FORMEN = {
  "jarvis-modell": (x) => istObjekt(x) && (x.anbieter === undefined || ["worker", "mock"].includes(x.anbieter)),
  "jarvis-vorschlaege": (x) => istObjekt(x) && x.art === "jarvis-vorschlaege" && istObjekt(x.zustand) && Array.isArray(x.historie),
  "jarvis-datenquellen": (x) => istObjekt(x) && x.art === "jarvis-datenquellen" && Array.isArray(x.abrufe),
  "jarvis-seitenleiste": (x) => istObjekt(x) && x.art === "jarvis-seitenleiste" && typeof x.an === "boolean",
};
for (const [k, f] of Object.entries(DS10_FORMEN)) if (!SPEICHER_FORMEN[k]) SPEICHER_FORMEN[k] = f;
// ---------- ab 11-12c: Grundformen der drei Handelsspeicher (vorher nur JSON-Prüfung) ----------
// Wirken bei Wiederherstellung/Import (speicherWertPruefen) und in der Datenprüfung – NICHT in der Handelslogik: Laden, Buchen,
// HandelsWache, Not-Aus und Order-Sperren bleiben unverändert. Unbekannte Zusatzfelder sind erlaubt (ältere/neuere Stände).
// Jede Form merkt sich den ersten Grund, damit die Meldung verständlich ist („Form passt nicht (…): Grund“).
const HANDEL_FORM = { grund: "", maxBetrag: 1e12, maxMenge: 1e9, maxPreis: 1e7, maxLedger: 100000 };
const hfZahl = (x, min, max) => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
const hfZeit = (x) => (typeof x === "number" && Number.isFinite(x) && x > 0) || (typeof x === "string" && !isNaN(Date.parse(x)));
function hfNein(grund) { HANDEL_FORM.grund = grund; return false; }
function formPaperKernSim(x) {
  HANDEL_FORM.grund = "";
  const TICKER = window.PaperKern ? window.PaperKern.US_TICKER : /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/, ZUST = window.PaperKern ? window.PaperKern.ZUSTAENDE : [];
  if (!istObjekt(x) || x.art !== "simulation" || x.simuliert !== true) return hfNein("keine Simulation (art/simuliert)");
  if (!hfZahl(x.startkapital, 0.01, HANDEL_FORM.maxBetrag)) return hfNein("Startkapital ungültig");
  if (!hfZahl(x.bargeld, -0.01, HANDEL_FORM.maxBetrag)) return hfNein("Bargeld ungültig (negativ, zu groß oder keine Zahl)");
  if (!istObjekt(x.positionen)) return hfNein("Positionen fehlen");
  for (const [s, p] of Object.entries(x.positionen)) {
    if (!TICKER.test(s)) return hfNein(`ungültiges Aktiensymbol „${String(s).slice(0, 12)}“`);
    if (!istObjekt(p) || !hfZahl(p.menge, 0, HANDEL_FORM.maxMenge) || !hfZahl(p.einstand, 0, HANDEL_FORM.maxPreis)) return hfNein(`Position ${s}: Menge oder Einstand ungültig`);
  }
  if (!Array.isArray(x.ledger) || x.ledger.length > HANDEL_FORM.maxLedger) return hfNein("Ledger fehlt oder zu groß");
  const ids = new Set();
  for (const e of x.ledger) {
    if (!istObjekt(e)) return hfNein("Ledger-Eintrag ist kein Objekt");
    if (ZUST.length && e.zustand !== undefined && !ZUST.includes(e.zustand)) return hfNein(`unbekannter Buchungszustand „${String(e.zustand).slice(0, 20)}“`);
    if (e.symbol !== undefined && !TICKER.test(e.symbol)) return hfNein(`Buchung mit ungültigem Symbol „${String(e.symbol).slice(0, 12)}“`);
    for (const k of ["menge", "preis", "gebuehr", "volumen"]) if (e[k] !== undefined && e[k] !== null && !hfZahl(e[k], 0, k === "volumen" ? HANDEL_FORM.maxBetrag : k === "menge" ? HANDEL_FORM.maxMenge : HANDEL_FORM.maxPreis * 10)) return hfNein(`Buchung: ${k} ungültig`);
    if (e.zeit !== undefined && !hfZeit(e.zeit)) return hfNein("Buchung mit ungültigem Zeitstempel");
    if (typeof e.trade_id === "string") { if (ids.has(e.trade_id)) return hfNein(`doppelte Buchung (trade_id ${e.trade_id.slice(0, 30)})`); ids.add(e.trade_id); }
  }
  for (const k of ["orders", "ausfuehrungen", "verlauf"]) if (x[k] !== undefined && !Array.isArray(x[k])) return hfNein(`${k} ist keine Liste`);
  return true;
}
function formPaperBot(x) {
  HANDEL_FORM.grund = "";
  if (!istObjekt(x) || x.version !== 1) return hfNein("Version fehlt oder unbekannt");
  const pb = typeof PAPERBOT !== "undefined" ? PAPERBOT : null;
  if (pb && !pb.symbole.includes(x.symbol)) return hfNein(`ungültiges Symbol „${String(x.symbol).slice(0, 12)}“`);
  if (pb && !pb.intervallMs[x.intervall]) return hfNein(`unbekanntes Intervall „${String(x.intervall).slice(0, 8)}“`);
  if (typeof x.zustand !== "string") return hfNein("Bot-Stand fehlt");
  const b = window.PaperBot ? window.PaperBot.ausJson(x.zustand) : { fehler: "Paper-Bot nicht geladen" };
  return b && b.fehler ? hfNein("Bot-Stand ungültig: " + b.fehler) : true;
}
function formKryptoWatchlist(x) {
  HANDEL_FORM.grund = "";
  const SYM = /^[A-Z0-9]{5,15}$/;
  if (!istObjekt(x)) return hfNein("kein Objekt");
  if (x.version !== undefined && x.version !== 1) return hfNein("unbekannte Version");
  if (!Array.isArray(x.werte) || !Array.isArray(x.alarme)) return hfNein("Werte oder Alarme fehlen");
  const sym = new Set(), ids = new Set();
  for (const v of x.werte) {
    if (!istObjekt(v) || !SYM.test(v.symbol)) return hfNein(`ungültiges Symbol „${String(v && v.symbol).slice(0, 15)}“`);
    if (sym.has(v.symbol)) return hfNein(`doppeltes Symbol ${v.symbol}`); sym.add(v.symbol);
    if (v.notiz !== undefined && (typeof v.notiz !== "string" || v.notiz.length > 200)) return hfNein(`Notiz zu ${v.symbol} ungültig`);
  }
  for (const a of x.alarme) {
    if (!istObjekt(a) || !SYM.test(a.symbol)) return hfNein("Alarm mit ungültigem Symbol");
    if (!["ueber", "unter"].includes(a.richtung)) return hfNein(`Alarm ${a.symbol}: Richtung ungültig`);
    if (!hfZahl(a.preis, 1e-12, 1e12)) return hfNein(`Alarm ${a.symbol}: Preis ungültig (≤ 0, zu groß oder keine Zahl)`);
    if (a.ausgeloest !== undefined && a.ausgeloest !== null && !hfZeit(a.ausgeloest)) return hfNein(`Alarm ${a.symbol}: Zeitstempel ungültig`);
    if (a.erstellt !== undefined && !hfZeit(a.erstellt)) return hfNein(`Alarm ${a.symbol}: Erstellzeit ungültig`);
    if (typeof a.id === "string") { if (ids.has(a.id)) return hfNein("doppelte Alarm-Kennung"); ids.add(a.id); }
  }
  return true;
}
Object.assign(SPEICHER_FORMEN, { "jarvis-paper-kern-sim": formPaperKernSim, "jarvis-paper-bot": formPaperBot, "jarvis-watchlist": formKryptoWatchlist });
// ab 11-12d: Grundform für die Aktionsliste aus 11a (bis dahin nur JSON-Prüfung)
SPEICHER_FORMEN["jarvis-aktionen"] = (x) => istObjekt(x) && x.art === "jarvis-aktionen" && Array.isArray(x.eintraege) && x.eintraege.length <= 100 && x.eintraege.every((e) => istObjekt(e) && typeof e.zeit === "string" && !isNaN(Date.parse(e.zeit)) && typeof e.befehl === "string");
// verständliche Meldung: Grund der Handelsform anhängen
if (typeof speicherWertPruefen === "function") {
  const original = speicherWertPruefen;
  speicherWertPruefen = function (schluessel, wert) {
    HANDEL_FORM.grund = "";
    const r = original(schluessel, wert);
    return r && HANDEL_FORM.grund && /^Form passt nicht/.test(r) ? `${r}: ${HANDEL_FORM.grund}` : r;
  };
}// Schlüssel ohne eigene Daten, die bewusst zu keinem Bereich gehören (nur Merker der Seite)
const DS10_OHNE_BEREICH = new Set(["jarvis-routinen-beispiele", "jarvis-auftrag-lauf"]); // ab 11-13a: kurzlebige Lauf-Sperre, keine Nutzerdaten
if (typeof DATEN_NEULADEN !== "undefined") Object.assign(DATEN_NEULADEN, {
  modell: () => { if (typeof modellAnzeigen === "function") modellAnzeigen(); },
  vorschlaege: () => { if (typeof vorschlaegeAnzeigen === "function") vorschlaegeAnzeigen(); },
  datenquellen: () => { if (typeof dqAnzeigen === "function") dqAnzeigen(); },
  seitenleiste: () => { if (typeof sleisteAnzeigen === "function") sleisteAnzeigen(); },
});
function speicherAbdeckung() {
  const bekannt = new Set(DATEN_BEREICHE.flatMap((b) => b.schluessel)), ohne = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("jarvis-") && !bekannt.has(k) && !DS10_OHNE_BEREICH.has(k)) ohne.push(k); }
  const ohneForm = [...bekannt].filter((k) => DATEN_BEREICHE.find((b) => b.schluessel.includes(k)).json && !SPEICHER_FORMEN[k]);
  return { ohneBereich: ohne.sort(), ohneForm: ohneForm.sort(), bereiche: DATEN_BEREICHE.length, schluessel: bekannt.size };
}
(function ds10Anzeige() {
  const m = document.getElementById("daten-abgleich");
  if (!m || !m.parentElement) return;
  const p = Object.assign(document.createElement("p"), { id: "ds10-abdeckung", className: "klein" });
  m.parentElement.insertBefore(p, m.nextSibling);
  const zeigen = () => { const a = speicherAbdeckung(); p.textContent = `Abdeckung: ${a.schluessel} Schlüssel in ${a.bereiche} Bereichen` + (a.ohneBereich.length ? ` · ⚠ nicht zugeordnet (fehlen in Sicherung und Löschen): ${a.ohneBereich.join(", ")}` : " · alle JARVIS-Schlüssel sind einem Bereich zugeordnet") + "."; p.className = a.ohneBereich.length ? "klein wz-wichtig" : "klein"; };
  const karte = document.getElementById("daten-karte");
  if (karte) karte.addEventListener("toggle", zeigen, true);
  zeigen();
  window.ds10AbdeckungZeigen = zeigen;
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("datenschutz10");
