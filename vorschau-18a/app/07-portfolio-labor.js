// JARVIS Dashboard – Modul „portfolio-labor“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).
// ---------- Portfolio-Labor (ab 11-02u; Szenarien, Archiv und Datenmodell Version 2 ab 11-02v): hypothetische Musterportfolios ----------
// Nur Browserspeicher (Schlüssel jarvis-portfolio-labor), nie an Worker oder Broker. Rechnung: Zielbetrag = Budget × Zielgewicht.
// Wiederverwendet: Watchlist (wlLaden), Analysen der Sitzung (APROFIL.analysen), AktienRebalance.zieleNormieren (Normieren),
// AktienWorkflow.US_TICKER (Symbolprüfung). Kein Kurs wird geschätzt, keine Order, kein Paper-Eintrag.
// Datenmodell Version 2 (ab 11-02v):
//   { art: "jarvis-portfolio-labor", version: 2, aktiv, portfolios: [Portfolio], papierkorb: [{ portfolio, szenario, geloescht }] }
//   Portfolio: { id "pl-…", name, budget | null, positionen: [{ symbol, gewicht }], notiz, archiviert, erstellt, geaendert,
//                szenarien: [{ id "sz-…", name, erstellt, schnappschuss: { budget, positionen, notiz } }] }
//   Zeitpunkte als ISO-Text; null nur bei aus Version 1 übernommenen Einträgen („unbekannt (vor 02v)“).
//   Ein Szenario ist ein unveränderlicher Schnappschuss – nur sein Name lässt sich ändern. Version-1-Daten werden beim Laden
//   verlustfrei übernommen (und erst mit der nächsten Änderung als Version 2 gespeichert).
const PL_SCHLUESSEL = "jarvis-portfolio-labor";
const PL_GRENZEN = { maxPortfolios: 20, maxPositionen: 20, maxBudget: 10000000, maxName: 60, maxNotiz: 500, maxSzenarien: 50, maxPapierkorb: 10, maxImportZeichen: 200000, maxSpeicherZeichen: 1500000 };
// Sitzungszustand der Ansicht (nie gespeichert); wird beim Wechsel des Portfolios zurückgesetzt
const PL = { vergleich: "", loeschenBestaetigen: false, portfolioLoeschen: "", szAuswahl: "", szA: "", szB: "", szLoeschen: "", szLaden: "", aktivBeiAnzeige: "" };
const plTicker = () => (window.AktienWorkflow && window.AktienWorkflow.US_TICKER) || /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
const plUsd = (x) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plProzent = (x) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const plJetzt = () => new Date().toISOString();
const plZeit = (iso) => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "unbekannt (vor 02v)");
const plIsoOk = (s) => typeof s === "string" && s.length <= 40 && Number.isFinite(Date.parse(s));
const plBudgetOk = (b) => b === null || (typeof b === "number" && Number.isFinite(b) && b > 0 && b <= PL_GRENZEN.maxBudget);
const plNameKey = (s) => String(s).trim().toLocaleLowerCase("de-DE");
function plPositionenPruefen(liste, wo, f) {
  if (!Array.isArray(liste) || liste.length > PL_GRENZEN.maxPositionen) { f.push(wo + `: Positionen fehlen oder mehr als ${PL_GRENZEN.maxPositionen}`); return; }
  const symbole = new Set();
  liste.forEach((x, k) => {
    if (!x || typeof x.symbol !== "string" || !plTicker().test(x.symbol) || symbole.has(x.symbol)) f.push(`${wo}, Position ${k + 1}: Symbol ungültig oder doppelt`); else symbole.add(x.symbol);
    if (!x || !(typeof x.gewicht === "number" && Number.isFinite(x.gewicht) && x.gewicht >= 0 && x.gewicht <= 100)) f.push(`${wo}, Position ${k + 1}: Gewicht muss 0 bis 100 sein`);
  });
}
function plNotizOk(n) { return typeof n === "string" && n.length <= PL_GRENZEN.maxNotiz; }
// Ein Szenario (gespeichert, im Papierkorb oder importiert); szIds sammelt Kennungen gegen Doppelte
function plSzenarioPruefen(s, wo, f, szIds) {
  if (!s || typeof s !== "object" || Array.isArray(s)) { f.push(wo + ": kein Objekt"); return; }
  if (typeof s.id !== "string" || !/^sz-[a-z0-9-]{1,40}$/.test(s.id) || (szIds && szIds.has(s.id))) f.push(wo + ": Kennung ungültig oder doppelt"); else if (szIds) szIds.add(s.id);
  if (typeof s.name !== "string" || !s.name.trim() || s.name.length > PL_GRENZEN.maxName) f.push(wo + `: Name fehlt oder länger als ${PL_GRENZEN.maxName} Zeichen`);
  if (!plIsoOk(s.erstellt)) f.push(wo + ": Erstellungszeit ungültig");
  const sn = s.schnappschuss;
  if (!sn || typeof sn !== "object" || Array.isArray(sn)) { f.push(wo + ": Schnappschuss fehlt"); return; }
  if (!plBudgetOk(sn.budget)) f.push(wo + ": Budget ungültig");
  if (!plNotizOk(sn.notiz)) f.push(wo + `: Notiz fehlt oder länger als ${PL_GRENZEN.maxNotiz} Zeichen`);
  plPositionenPruefen(sn.positionen, wo, f);
}
// Prüft einen vollständigen Datenstand (gespeichert oder importiert), Version 1 oder 2; Ergebnis { ok, fehler: [] }
function plPruefen(d) {
  const f = [];
  if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, fehler: ["kein JSON-Objekt"] };
  if (d.art !== "jarvis-portfolio-labor") f.push("„art“ ist nicht „jarvis-portfolio-labor“");
  if (d.version !== 1 && d.version !== 2) f.push("unbekannte Version");
  const v2 = d.version === 2;
  if (!Array.isArray(d.portfolios)) f.push("„portfolios“ fehlt");
  else {
    if (d.portfolios.length > PL_GRENZEN.maxPortfolios) f.push(`mehr als ${PL_GRENZEN.maxPortfolios} Portfolios`);
    const ids = new Set(), szIds = new Set();
    d.portfolios.forEach((p, n) => {
      const wo = `Portfolio ${n + 1}`;
      if (!p || typeof p !== "object") { f.push(wo + ": kein Objekt"); return; }
      if (typeof p.id !== "string" || !/^pl-[a-z0-9-]{1,40}$/.test(p.id) || ids.has(p.id)) f.push(wo + ": Kennung ungültig oder doppelt"); else ids.add(p.id);
      if (typeof p.name !== "string" || !p.name.trim() || p.name.length > PL_GRENZEN.maxName) f.push(wo + `: Name fehlt oder länger als ${PL_GRENZEN.maxName} Zeichen`);
      if (!plBudgetOk(p.budget)) f.push(wo + ": Budget ungültig");
      plPositionenPruefen(p.positionen, wo, f);
      if (!v2) return;
      if (!plNotizOk(p.notiz)) f.push(wo + `: Notiz fehlt oder länger als ${PL_GRENZEN.maxNotiz} Zeichen`);
      if (typeof p.archiviert !== "boolean") f.push(wo + ": „archiviert“ fehlt");
      for (const z of ["erstellt", "geaendert"]) if (!(p[z] === null || plIsoOk(p[z]))) f.push(wo + `: Zeitpunkt „${z}“ ungültig`);
      if (!Array.isArray(p.szenarien) || p.szenarien.length > PL_GRENZEN.maxSzenarien) { f.push(wo + `: Szenarien fehlen oder mehr als ${PL_GRENZEN.maxSzenarien}`); return; }
      const namen = new Set();
      p.szenarien.forEach((s, k) => {
        plSzenarioPruefen(s, `${wo}, Szenario ${k + 1}`, f, szIds);
        if (s && typeof s.name === "string") { if (namen.has(plNameKey(s.name))) f.push(`${wo}, Szenario ${k + 1}: Name doppelt`); namen.add(plNameKey(s.name)); }
      });
    });
    if (d.aktiv !== null && d.aktiv !== undefined && !d.portfolios.some((p) => p && p.id === d.aktiv)) f.push("aktives Portfolio unbekannt");
    if (v2) {
      if (!Array.isArray(d.papierkorb) || d.papierkorb.length > PL_GRENZEN.maxPapierkorb) f.push("Papierkorb ungültig");
      else d.papierkorb.forEach((x, k) => {
        if (!x || typeof x.portfolio !== "string" || !plIsoOk(x.geloescht)) { f.push(`Papierkorb ${k + 1}: unvollständig`); return; }
        plSzenarioPruefen(x.szenario, `Papierkorb ${k + 1}`, f, szIds);
      });
    }
  }
  return { ok: f.length === 0, fehler: f };
}
// Version 1 → 2 ohne Verlust: alle gültigen Werte bleiben, neue Felder mit neutralen Werten (Zeitpunkte unbekannt = null)
function plMigrieren(d) {
  if (d.version === 2) return d;
  return { art: d.art, version: 2, aktiv: d.aktiv === undefined ? null : d.aktiv, papierkorb: [],
    portfolios: d.portfolios.map((p) => ({ id: p.id, name: p.name, budget: p.budget, positionen: p.positionen.map((x) => ({ symbol: x.symbol, gewicht: x.gewicht })),
      notiz: "", archiviert: false, erstellt: null, geaendert: null, szenarien: [] })) };
}
// Import: nur die bekannten Felder eines (geprüften) Schnappschusses übernehmen – Zusatzfelder fremder Dateien bleiben draußen
const plSchnappschussKopie = (sn) => ({ budget: sn.budget, positionen: sn.positionen.map((x) => ({ symbol: x.symbol, gewicht: x.gewicht })), notiz: sn.notiz });
// Version 2 → 1 nur für die Exportdatei des Rückwegs (Stand 02u): genau die Felder, die 02u kennt; Szenarien usw. entfallen
function plAlsVersion1(d) {
  return { art: "jarvis-portfolio-labor", version: 1, aktiv: d.aktiv === undefined ? null : d.aktiv,
    portfolios: d.portfolios.map((p) => ({ id: p.id, name: p.name, budget: p.budget, positionen: p.positionen.map((x) => ({ symbol: x.symbol, gewicht: x.gewicht })) })) };
}
function plLaden() {
  let roh;
  try { roh = localStorage.getItem(PL_SCHLUESSEL); } catch (e) { return { daten: null, beschaedigt: true, grund: "Browserspeicher gesperrt" }; }
  if (roh === null) return { daten: { art: "jarvis-portfolio-labor", version: 2, portfolios: [], aktiv: null, papierkorb: [] }, beschaedigt: false };
  let d;
  try { d = JSON.parse(roh); } catch (e) { return { daten: null, beschaedigt: true, grund: "gespeicherter Inhalt ist kein gültiges JSON" }; }
  const p = plPruefen(d);
  return p.ok ? { daten: plMigrieren(d), beschaedigt: false, migriert: d.version === 1 } : { daten: null, beschaedigt: true, grund: p.fehler.slice(0, 3).join("; ") };
}
// Speichern nur geprüft und mit Größengrenze; voller Browserspeicher → verständliche Meldung, der alte Stand bleibt erhalten
function plSpeichern(d) {
  const p = plPruefen(d);
  if (!p.ok || d.version !== 2) return "nicht gespeichert: " + (p.fehler.slice(0, 2).join("; ") || "falsche Version");
  const text = JSON.stringify(d);
  if (text.length > PL_GRENZEN.maxSpeicherZeichen) return `nicht gespeichert: Das Portfolio-Labor würde ${Math.round(text.length / 1000)} kB belegen (Grenze ${PL_GRENZEN.maxSpeicherZeichen / 1000} kB). Bitte exportieren und alte Szenarien oder Portfolios löschen – der bisherige Stand bleibt unverändert.`;
  try { localStorage.setItem(PL_SCHLUESSEL, text); return null; } catch (e) {
    return e && (e.name === "QuotaExceededError" || e.code === 22) ? "Browserspeicher voll – nichts gespeichert, der bisherige Stand bleibt unverändert. Bitte exportieren und alte Szenarien löschen." : "Browserspeicher nicht beschreibbar – nichts gespeichert.";
  }
}
function plStatus(text, fehler, ziel = "pl-status") {
  const s = ablaufEl(ziel);
  s.textContent = (fehler ? "✖ " : "") + text;
  s.classList.toggle("wz-wichtig", Boolean(fehler));
}
// Eine Änderung: laden, ändern, prüfen, speichern, neu zeichnen (nie mit beschädigtem Speicher). Ändert die Funktion das aktive
// Portfolio, wird dessen „geaendert“ gesetzt. statusZiel: pl-status (Portfolio) oder pl-sz-status (Szenarien)
function plAendern(aenderung, erfolg, statusZiel = "pl-status") {
  const st = plLaden();
  if (st.beschaedigt) { plStatus("Gespeicherte Musterportfolios sind beschädigt (" + st.grund + ") – nichts geändert.", true, statusZiel); plZeigen(); return false; }
  const d = st.daten;
  const p = d.portfolios.find((x) => x.id === d.aktiv) || null;
  const vorher = p ? JSON.stringify([p.name, p.budget, p.positionen, p.notiz, p.archiviert]) : "";
  const fehler = aenderung(d, p);
  if (fehler) { plStatus(fehler, true, statusZiel); return false; }
  if (p && d.portfolios.includes(p) && JSON.stringify([p.name, p.budget, p.positionen, p.notiz, p.archiviert]) !== vorher) p.geaendert = plJetzt();
  const s = plSpeichern(d);
  if (s) { plStatus(s, true, statusZiel); return false; }
  plZeigen();
  if (erfolg) plStatus(typeof erfolg === "function" ? erfolg(d) : erfolg, false, statusZiel);
  return true;
}
const plNeueKennung = (praefix = "pl") => praefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
// Freier Name im Portfolio (Groß-/Kleinschreibung egal); vorschlagen: an einen belegten Namen „(2)“, „(3)“ … anhängen
function plSzNameFrei(p, name, ohneId) { return !p.szenarien.some((s) => s.id !== ohneId && plNameKey(s.name) === plNameKey(name)); }
function plSzNameEindeutig(p, name) {
  const basis = String(name).trim().slice(0, PL_GRENZEN.maxName - 5);
  if (plSzNameFrei(p, basis)) return basis;
  for (let n = 2; n < 100; n++) if (plSzNameFrei(p, `${basis} (${n})`)) return `${basis} (${n})`;
  return null;
}
function plSymbolPruefen(roh, p) {
  const s = String(roh || "").trim().toUpperCase();
  if (!s) return { fehler: "Kein Symbol angegeben – bitte ein US-Aktiensymbol eintragen, z. B. KO." };
  if (!plTicker().test(s)) return { fehler: `„${s.slice(0, 12)}“ ist kein gültiges US-Aktiensymbol (1–5 Buchstaben, optional Klasse wie BRK.B).` };
  if (p.positionen.some((x) => x.symbol === s)) return { fehler: `${s} ist schon im Musterportfolio.` };
  if (p.positionen.length >= PL_GRENZEN.maxPositionen) return { fehler: `Höchstens ${PL_GRENZEN.maxPositionen} Positionen je Musterportfolio.` };
  return { symbol: s };
}
// Analysedaten dieser Sitzung je Symbol (nur Anzeige, nichts wird geladen)
function plAnalyseText(symbol) {
  const a = APROFIL.analysen && APROFIL.analysen[symbol];
  if (!a) return { text: "keine Analyse in dieser Sitzung – unter „US-Aktie analysieren“ prüfen", fehlt: true };
  const kx = a.dispatch && a.dispatch.kontext;
  const an = a.dispatch && a.dispatch.ergebnisse ? a.dispatch.ergebnisse.find((x) => x.modul === "analyse") : null;
  const n = an && an.daten && an.daten.kerzen_anzahl > 0 ? an.daten.kerzen_anzahl : 0;
  const zr = kx && kx.zeitraum ? `${kx.zeitraum.von} bis ${kx.zeitraum.bis}` : "alle verfügbaren Tageskerzen";
  return { text: `${a.quelle}${/synthetisch/i.test(a.quelle) ? " – SYNTHETISCH" : ""} · ${zr}${n ? ` · ${n} Tageskerzen` : " · keine Tageskerzen"}${a.frisch === false ? " · VERALTET" : ""}`, fehlt: !n };
}
// Zielbeträge: Cent-genau gerundet; Rundungsdifferenz und nicht verteilter Rest werden ausgewiesen (für Portfolio und Schnappschuss)
function plRechnen(p) {
  const summe = p.positionen.reduce((s, x) => s + x.gewicht, 0);
  const budget = p.budget;
  const zeilen = p.positionen.map((x) => ({ symbol: x.symbol, gewicht: x.gewicht, betrag: budget ? Math.round(budget * x.gewicht) / 100 : null }));
  const exakt = budget ? (budget * summe) / 100 : null;
  const gerundet = budget ? zeilen.reduce((s, z) => s + z.betrag, 0) : null;
  // „|| 0“: aus -0 wird 0 (sonst stünde „-0,00 USD“ da)
  return { summe, budget, zeilen, exakt, gerundet, rundung: budget ? Math.round((gerundet - exakt) * 100) / 100 || 0 : null, rest: budget ? Math.round((budget - exakt) * 100) / 100 || 0 : null };
}
const PL_BEDIEN = ["pl-auswahl", "pl-name", "pl-neu", "pl-umbenennen", "pl-archivieren", "pl-loeschen", "pl-notiz", "pl-budget", "pl-wl-symbol", "pl-wl-hinzu", "pl-symbol", "pl-hinzu", "pl-gleich", "pl-normieren", "pl-vergleich", "pl-export", "pl-export-v1", "pl-import-knopf", "pl-sz-name", "pl-sz-speichern", "pl-sz-rueckgaengig", "pl-sz-a", "pl-sz-b", "pl-sz-import-knopf"];
function plZeigen() {
  const st = plLaden();
  const auswahl = ablaufEl("pl-auswahl"), zeilen = ablaufEl("pl-zeilen");
  ablaufEl("pl-verwerfen").hidden = !st.beschaedigt;
  const aus = (ids, an) => ids.forEach((id) => { ablaufEl(id).disabled = !an; });
  if (st.beschaedigt) {
    auswahl.replaceChildren(); zeilen.replaceChildren(); ablaufEl("pl-sz-liste").replaceChildren();
    for (const id of ["pl-summe", "pl-rechnung", "pl-konzentration", "pl-vergleich-ergebnis", "pl-meta", "pl-sz-vergleich", "pl-sz-vorschau"]) ablaufEl(id).textContent = "";
    aus(PL_BEDIEN, false);
    plStatus("Gespeicherte Musterportfolios sind beschädigt (" + st.grund + ") – nichts überschrieben. „Beschädigten Speicher verwerfen“ löscht nur diesen Bereich.", true);
    return;
  }
  const d = st.daten;
  const p = d.portfolios.find((x) => x.id === d.aktiv) || null;
  // Portfoliowechsel (auch per Import/Löschen): Auswahl, Vorschau und Vergleich der Szenarien gehören zum alten Portfolio
  if (PL.aktivBeiAnzeige !== (p ? p.id : "")) {
    Object.assign(PL, { szAuswahl: "", szA: "", szB: "", szLoeschen: "", szLaden: "", portfolioLoeschen: "", aktivBeiAnzeige: p ? p.id : "" });
    ablaufEl("pl-sz-status").textContent = "";
  }
  const option = (x) => Object.assign(document.createElement("option"), { value: x.id, textContent: x.name + (x.archiviert ? " (archiviert)" : ""), selected: x.id === d.aktiv });
  const aktive = d.portfolios.filter((x) => !x.archiviert), archiv = d.portfolios.filter((x) => x.archiviert);
  const gruppe = (label, liste) => { const g = Object.assign(document.createElement("optgroup"), { label }); g.append(...liste.map(option)); return g; };
  // Kein aktives trotz vorhandener Portfolios (z. B. Datei ohne „aktiv“): Platzhalter statt scheinbar gewähltem ersten Eintrag
  const platzhalter = !p && d.portfolios.length ? [Object.assign(document.createElement("option"), { value: "", textContent: "– Musterportfolio wählen –", selected: true })] : [];
  auswahl.replaceChildren(...platzhalter, ...(!d.portfolios.length ? [Object.assign(document.createElement("option"), { value: "", textContent: "– noch keins –" })]
    : archiv.length ? [gruppe("Aktiv", aktive), gruppe("Archiviert", archiv)].filter((g) => g.children.length) : aktive.map(option)));
  const bearbeitbar = Boolean(p && !p.archiviert);
  aus(["pl-auswahl"], d.portfolios.length > 0);
  aus(["pl-umbenennen", "pl-archivieren", "pl-loeschen", "pl-vergleich", "pl-sz-a", "pl-sz-b"], Boolean(p));
  aus(["pl-export", "pl-export-v1"], d.portfolios.length > 0);
  aus(["pl-notiz", "pl-budget", "pl-wl-symbol", "pl-wl-hinzu", "pl-symbol", "pl-hinzu", "pl-gleich", "pl-normieren", "pl-sz-name", "pl-sz-speichern", "pl-sz-import-knopf"], bearbeitbar);
  aus(["pl-name", "pl-neu", "pl-import-knopf"], true);
  ablaufEl("pl-name").value = p ? p.name : "";
  ablaufEl("pl-budget").value = p && p.budget !== null ? String(p.budget) : "";
  ablaufEl("pl-notiz").value = p ? p.notiz : "";
  ablaufEl("pl-archivieren").textContent = p && p.archiviert ? "Wiederherstellen" : "Archivieren";
  ablaufEl("pl-archivieren").setAttribute("aria-label", p ? (p.archiviert ? `„${p.name}“ wiederherstellen` : `„${p.name}“ archivieren (Szenarien bleiben erhalten)`) : "Musterportfolio archivieren");
  const loeschen = ablaufEl("pl-loeschen");
  const bestaetigen = Boolean(p && PL.portfolioLoeschen === p.id);
  loeschen.textContent = bestaetigen ? `Wirklich endgültig löschen? (${p.szenarien.length} Szenario(s) gehen mit verloren)` : "Endgültig löschen …";
  loeschen.setAttribute("aria-label", p ? (bestaetigen ? `Endgültiges Löschen von „${p.name}“ bestätigen` : `„${p.name}“ endgültig löschen (fragt nach)`) : "Musterportfolio endgültig löschen");
  ablaufEl("pl-meta").textContent = p ? `Angelegt ${plZeit(p.erstellt)} · zuletzt geändert ${plZeit(p.geaendert)} · ${p.szenarien.length} Szenario(s)` + (p.archiviert ? " · ARCHIVIERT – nur ansehen; zum Bearbeiten „Wiederherstellen“." : "") + (st.migriert ? " · aus dem Format vor 02v übernommen (wird beim nächsten Speichern umgestellt)." : "") : "";
  plWlOptionen(bearbeitbar ? p : null);
  if (!p) {
    zeilen.replaceChildren();
    ablaufEl("pl-summe").textContent = d.portfolios.length ? `Kein Musterportfolio ausgewählt – bitte oben eins der ${d.portfolios.length} vorhandenen wählen.`
      : "Noch kein Musterportfolio – Namen eintragen und „Neu anlegen“ (oder eine JSON-Datei importieren).";
    for (const id of ["pl-rechnung", "pl-konzentration", "pl-vergleich-ergebnis"]) ablaufEl(id).textContent = "";
    // Auswahlfelder nie leer: sie nennen immer einen Wert (Barrierefreiheit)
    for (const id of ["pl-vergleich", "pl-sz-a", "pl-sz-b"]) ablaufEl(id).replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "– erst ein Musterportfolio anlegen –" }));
    plSzenarienZeigen(d, null);
    return;
  }
  const r = plRechnen(p);
  zeilen.replaceChildren(...(p.positionen.length ? r.zeilen : [null]).map((z, i) => {
    const tr = document.createElement("tr");
    if (!z) { const td = Object.assign(document.createElement("td"), { colSpan: 6, textContent: bearbeitbar ? "Noch keine Positionen – Symbol aus der Watchlist oder von Hand hinzufügen." : "Keine Positionen." }); tr.append(td); return tr; }
    const zelle = (beschriftung, inhalt) => { const td = document.createElement("td"); td.dataset.beschriftung = beschriftung; if (typeof inhalt === "string") td.textContent = inhalt; else td.append(...inhalt); return td; };
    const eingabe = Object.assign(document.createElement("input"), { className: "feld pl-gewicht", type: "number", min: "0", max: "100", step: "0.01", value: String(z.gewicht), disabled: !bearbeitbar });
    eingabe.setAttribute("aria-label", `Zielgewicht ${z.symbol} in Prozent`);
    eingabe.dataset.symbol = z.symbol;
    const huelle = Object.assign(document.createElement("span"), { className: "pl-balken-huelle" });
    huelle.setAttribute("aria-hidden", "true");
    const balken = Object.assign(document.createElement("span"), { className: "pl-balken" });
    balken.style.width = Math.max(0, Math.min(100, z.gewicht)) + "%";
    huelle.append(balken);
    const anteil = Object.assign(document.createElement("span"), { textContent: ` ${plProzent(z.gewicht)} %` });
    const knopf = (text, aktion, label, ausgeschaltet) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", textContent: text, disabled: Boolean(ausgeschaltet) || !bearbeitbar }); b.dataset.plAktion = aktion; b.dataset.symbol = z.symbol; b.setAttribute("aria-label", label); return b; };
    const info = plAnalyseText(z.symbol);
    tr.dataset.symbol = z.symbol;
    tr.append(zelle("Symbol", z.symbol), zelle("Zielgewicht (%)", [eingabe]), zelle("Anteil", [huelle, anteil]),
      zelle("Zielbetrag (USD)", r.budget ? plUsd(z.betrag) : "nicht berechenbar – Budget fehlt"),
      zelle("Analysedaten", (info.fehlt ? "⚠ " : "") + info.text),
      zelle("Reihenfolge / Entfernen", [knopf("↑", "hoch", `${z.symbol} nach oben`, i === 0), knopf("↓", "runter", `${z.symbol} nach unten`, i === p.positionen.length - 1), knopf("Entfernen", "weg", `${z.symbol} aus dem Musterportfolio entfernen`)]));
    return tr;
  }));
  const summeOk = Math.abs(r.summe - 100) < 0.005;
  ablaufEl("pl-summe").textContent = !p.positionen.length ? "" : `Summe der Zielgewichte: ${plProzent(r.summe)} %` + (summeOk ? " ✔" : ` – ⚠ nicht 100 % (${r.summe < 100 ? "es bleiben " + plProzent(100 - r.summe) + " % unverteilt" : "um " + plProzent(r.summe - 100) + " % zu viel"}). „Auf 100 % normieren“ oder „Gleichmäßig verteilen“ hilft.`);
  ablaufEl("pl-rechnung").textContent = !p.positionen.length ? "" : !r.budget ? "Zielbeträge: nicht berechenbar – kein Budget eingetragen."
    : `Zielbeträge = ${plUsd(r.budget)} USD × Zielgewicht, je Position auf Cent gerundet. Summe der gerundeten Beträge ${plUsd(r.gerundet)} USD`
      + ` (Rundungsdifferenz ${r.rundung >= 0 ? "+" : ""}${plUsd(r.rundung)} USD)` + (Math.abs(r.rest) >= 0.005 ? `; ${r.rest > 0 ? "nicht verteilt" : "über dem Budget"}: ${plUsd(Math.abs(r.rest))} USD (Gewichtssumme ${plProzent(r.summe)} %).` : ".");
  plKonzentrationZeigen(p, r);
  plVergleichZeigen(d, p);
  plSzenarienZeigen(d, p);
}
function plWlOptionen(p) {
  const w = typeof wlLaden === "function" ? wlLaden() : { eintraege: [] };
  const frei = (w.eintraege || []).map((e) => e.symbol).filter((s) => !p || !p.positionen.some((x) => x.symbol === s));
  ablaufEl("pl-wl-symbol").replaceChildren(...(frei.length && p ? frei : [null]).map((s) => Object.assign(document.createElement("option"), s ? { value: s, textContent: s } : { value: "", textContent: w.beschaedigt ? "Watchlist beschädigt" : !p ? "– kein bearbeitbares Musterportfolio –" : "– keine weiteren Watchlist-Symbole –" })));
  ablaufEl("pl-wl-hinzu").disabled = !p || !frei.length;
}
// Konzentration (beschreibend, keine Prognose, keine Empfehlung). 25 % = Deckel maxPositionPct der vorhandenen Budget-Regel
function plKonzentrationZeigen(p, r) {
  const feld = ablaufEl("pl-konzentration");
  const mit = p.positionen.filter((x) => x.gewicht > 0);
  if (!mit.length || !(r.summe > 0)) { feld.textContent = p.positionen.length ? "Konzentration: nicht berechenbar – alle Zielgewichte sind 0 %." : ""; return; }
  const groesste = mit.reduce((a, b) => (b.gewicht > a.gewicht ? b : a));
  const anteil = (100 * groesste.gewicht) / r.summe;
  const deckel = window.AktienBudget ? window.AktienBudget.STANDARD.maxPositionPct : 25;
  const hinweise = [];
  if (anteil > 50) hinweise.push("mehr als die Hälfte steckt in einer einzigen Position");
  else if (anteil > deckel) hinweise.push(`über dem ${deckel}-%-Deckel je Position der Budget-Regel dieses Projekts`);
  if (mit.length <= 2) hinweise.push(`nur ${mit.length} Position(en) mit Gewicht`);
  feld.textContent = `Größte Position: ${groesste.symbol} mit ${plProzent(anteil)} % der verteilten Gewichte (${mit.length} Positionen mit Gewicht). `
    + (hinweise.length ? "Hinweis: " + hinweise.join("; ") + " – Schwankungen dieser Werte wirken entsprechend stark auf das Musterportfolio." : "Keine Position über dem Deckel von " + deckel + " %.")
    + " Beschreibung der Eingaben, keine Prognose und keine Empfehlung.";
}
// Gemeinsame Vergleichsrechnung A → B (Portfolio gegen Portfolio, ab 11-02v auch Szenario gegen Szenario): je Symbol Zielgewicht
// in Prozentpunkten und – nur wenn beide Budgets gültig sind – Zielbetrag in USD. Nur berechnete Werte, keine Order.
function plVergleichListe(a, b) {
  const ra = plRechnen(a), rb = plRechnen(b);
  const symbole = [...new Set([...a.positionen.map((x) => x.symbol), ...b.positionen.map((x) => x.symbol)])];
  const liste = document.createElement("ul");
  liste.append(...symbole.map((s) => {
    const inA = a.positionen.some((x) => x.symbol === s), inB = b.positionen.some((x) => x.symbol === s);
    const ga = (a.positionen.find((x) => x.symbol === s) || { gewicht: 0 }).gewicht, gb = (b.positionen.find((x) => x.symbol === s) || { gewicht: 0 }).gewicht;
    const ba = ra.budget ? Math.round(ra.budget * ga) / 100 : null, bb = rb.budget ? Math.round(rb.budget * gb) / 100 : null;
    const dpp = Math.round((gb - ga) * 100) / 100 || 0, dusd = ba !== null && bb !== null ? Math.round((bb - ba) * 100) / 100 || 0 : null;
    const art = !inA ? "neu aufnehmen (nur in B)" : !inB ? "herausnehmen (nur in A)" : ga === 0 && gb > 0 ? "neu aufnehmen" : gb === 0 && ga > 0 ? "herausnehmen"
      : dusd === null ? (dpp > 0 ? "Gewicht erhöhen" : dpp < 0 ? "Gewicht senken" : "unverändert") : dusd > 0 ? "erhöhen" : dusd < 0 ? "verringern" : dpp !== 0 ? "Betrag unverändert" : "unverändert";
    const li = Object.assign(document.createElement("li"), { textContent: `${s}: ${art} – Zielgewicht ${plProzent(ga)} % → ${plProzent(gb)} % (${dpp > 0 ? "+" : ""}${plProzent(dpp)} Prozentpunkte); `
      + (dusd === null ? "USD-Änderung nicht berechenbar (Budget fehlt)" : `Zielbetrag ${plUsd(ba)} → ${plUsd(bb)} USD (${dusd > 0 ? "+" : ""}${plUsd(dusd)} USD)`) });
    if (!inA || !inB) li.className = "wz-wichtig";
    return li;
  }));
  return { liste, ra, rb };
}
// Vergleich: aktives Portfolio (A) → gewähltes Vergleichsportfolio (B); unverbindlicher Änderungsvorschlag nur aus den Eingaben
function plVergleichZeigen(d, p) {
  const sel = ablaufEl("pl-vergleich"), aus = ablaufEl("pl-vergleich-ergebnis");
  const andere = d.portfolios.filter((x) => x.id !== p.id);
  if (!andere.some((x) => x.id === PL.vergleich)) PL.vergleich = "";
  sel.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: andere.length ? "– kein Vergleich –" : "– zweites Musterportfolio anlegen –" }),
    ...andere.map((x) => Object.assign(document.createElement("option"), { value: x.id, textContent: x.name + (x.archiviert ? " (archiviert)" : ""), selected: x.id === PL.vergleich })));
  sel.disabled = !andere.length;
  aus.replaceChildren();
  const b = andere.find((x) => x.id === PL.vergleich);
  if (!b) return;
  const { liste, ra, rb } = plVergleichListe(p, b);
  liste.setAttribute("aria-label", "Änderungen je Symbol von A nach B");
  const kopf = Object.assign(document.createElement("p"), { textContent: `Von „${p.name}“ (A) zu „${b.name}“ (B). Annahmen: Zielbetrag = Budget × Zielgewicht, auf Cent gerundet; Budget A ${ra.budget ? plUsd(ra.budget) + " USD" : "fehlt"}, Budget B ${rb.budget ? plUsd(rb.budget) + " USD" : "fehlt"}; Gewichtssummen A ${plProzent(ra.summe)} %, B ${plProzent(rb.summe)} %. Grundlage sind nur deine Eingaben – keine Kurse, keine Analysedaten (auch keine synthetischen).` });
  const fuss = Object.assign(document.createElement("p"), { className: "wz-wichtig", textContent: "Unverbindlicher Vorschlag nur aus deinen hypothetischen Eingaben – keine Order, wird nie automatisch ausgeführt, nichts wird gesendet. Paper-Buchungen gibt es nur über den Paper-Vorschlag oben mit ausdrücklicher Bestätigung." });
  aus.append(kopf, liste, fuss);
}
// ---------- Szenarien (ab 11-02v) ----------
const plSzKurz = (sn) => `Budget ${sn.budget ? plUsd(sn.budget) + " USD" : "nicht festgelegt"} · ${sn.positionen.length} Symbol(e)${sn.positionen.length ? " (" + sn.positionen.map((x) => `${x.symbol} ${plProzent(x.gewicht)} %`).join(", ") + ")" : ""} · Gewichtssumme ${plProzent(sn.positionen.reduce((s, x) => s + x.gewicht, 0))} %`;
function plSzenarienZeigen(d, p) {
  const liste = ablaufEl("pl-sz-liste"), rueck = ablaufEl("pl-sz-rueckgaengig");
  const szenarien = p ? p.szenarien : [];
  for (const k of ["szAuswahl", "szA", "szB", "szLoeschen", "szLaden"]) if (PL[k] && !szenarien.some((s) => s.id === PL[k])) PL[k] = "";
  const letzte = p ? [...d.papierkorb].reverse().find((x) => x.portfolio === p.id) : null;
  rueck.hidden = !letzte;
  rueck.textContent = letzte ? `Löschen rückgängig: „${letzte.szenario.name}“` : "Löschen rückgängig";
  rueck.disabled = !letzte || !p || p.archiviert;
  if (letzte) rueck.setAttribute("aria-label", `Gelöschtes Szenario „${letzte.szenario.name}“ (gelöscht ${plZeit(letzte.geloescht)}) wiederherstellen`);
  liste.replaceChildren(...(szenarien.length ? szenarien : [null]).map((s) => {
    const li = document.createElement("li");
    if (!s) { li.textContent = !p ? "Erst ein Musterportfolio anlegen." : "Noch keine Szenarien – Namen eintragen und „Als neues Szenario speichern“ hält den jetzigen Stand fest."; return li; }
    li.dataset.szenario = s.id;
    const gewaehlt = PL.szAuswahl === s.id;
    if (gewaehlt) li.setAttribute("aria-current", "true");
    const text = Object.assign(document.createElement("div"), { textContent: `${gewaehlt ? "✔ AUSGEWÄHLT: " : ""}„${s.name}“ · gespeichert ${plZeit(s.erstellt)} · ${plSzKurz(s.schnappschuss)}${s.schnappschuss.notiz ? " · Notiz: " + s.schnappschuss.notiz : ""}` });
    const knopf = (textK, aktion, label, ausgeschaltet) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", textContent: textK, disabled: Boolean(ausgeschaltet) }); b.dataset.szAktion = aktion; b.dataset.szenario = s.id; b.setAttribute("aria-label", label); return b; };
    const nurLesen = p.archiviert;
    const loeschen = PL.szLoeschen === s.id;
    const k = [knopf(gewaehlt ? "Ausgewählt" : "Auswählen", "auswahl", `Szenario „${s.name}“ auswählen`), knopf("Umbenennen", "umbenennen", `Szenario „${s.name}“ umbenennen (Name aus dem Feld „Szenarioname“)`, nurLesen),
      knopf("Duplizieren", "duplizieren", `Szenario „${s.name}“ duplizieren (Name aus dem Feld „Szenarioname“ oder automatisch)`, nurLesen),
      knopf("In Portfolioeingaben laden …", "laden", `Szenario „${s.name}“ in die aktuellen Portfolioeingaben laden (zeigt vorher eine Vorschau)`, nurLesen),
      knopf("Exportieren", "export", `Szenario „${s.name}“ als JSON exportieren`),
      knopf(loeschen ? "Wirklich löschen?" : "Löschen …", "loeschen", loeschen ? `Löschen von „${s.name}“ bestätigen` : `Szenario „${s.name}“ löschen (fragt nach)`, nurLesen)];
    k[0].setAttribute("aria-pressed", gewaehlt ? "true" : "false");
    if (loeschen) k.push(knopf("Nicht löschen", "loeschen-nein", `Löschen von „${s.name}“ abbrechen`));
    li.append(text, ...k);
    return li;
  }));
  // Vergleichsauswahl (nur Szenarien dieses Portfolios)
  for (const [id, schluessel] of [["pl-sz-a", "szA"], ["pl-sz-b", "szB"]]) {
    ablaufEl(id).replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: szenarien.length >= 2 ? "– Szenario wählen –" : "– mindestens zwei Szenarien speichern –" }),
      ...szenarien.map((s) => Object.assign(document.createElement("option"), { value: s.id, textContent: s.name, selected: PL[schluessel] === s.id })));
    ablaufEl(id).disabled = szenarien.length < 2;
  }
  plSzVergleichZeigen(p);
  plSzVorschauZeigen(p);
}
// Vergleich zweier Szenarien: gespeicherte Fakten getrennt von berechneten Werten; Reihenfolge und Notiz ohne finanzielle Differenz
function plSzVergleichZeigen(p) {
  const aus = ablaufEl("pl-sz-vergleich");
  aus.replaceChildren();
  if (!p) return;
  const a = p.szenarien.find((s) => s.id === PL.szA), b = p.szenarien.find((s) => s.id === PL.szB);
  if (!a || !b) { if (p.szenarien.length >= 2) aus.append(Object.assign(document.createElement("p"), { textContent: "Zwei Szenarien wählen, um sie zu vergleichen." })); return; }
  if (a.id === b.id) { aus.append(Object.assign(document.createElement("p"), { textContent: "Bitte zwei verschiedene Szenarien wählen." })); return; }
  const fakten = Object.assign(document.createElement("p"), { textContent: "Gespeicherte Werte (Fakten aus den Schnappschüssen):" });
  const tab = document.createElement("table");
  tab.className = "pl-tabelle pl-sz-fakten";
  const kopfZeile = document.createElement("tr");
  for (const t of ["", `A: „${a.name}“`, `B: „${b.name}“`]) kopfZeile.append(Object.assign(document.createElement("th"), { scope: "col", textContent: t }));
  const zeile = (titel, va, vb) => { const tr = document.createElement("tr"); tr.append(Object.assign(document.createElement("th"), { scope: "row", textContent: titel })); for (const [v, l] of [[va, "A"], [vb, "B"]]) { const td = Object.assign(document.createElement("td"), { textContent: v }); td.dataset.beschriftung = l; tr.append(td); } return tr; };
  const sa = a.schnappschuss, sb = b.schnappschuss, summe = (sn) => sn.positionen.reduce((s, x) => s + x.gewicht, 0);
  const thead = document.createElement("thead"); thead.append(kopfZeile);
  const tbody = document.createElement("tbody");
  tbody.append(zeile("Gespeichert", plZeit(a.erstellt), plZeit(b.erstellt)), zeile("Budget", sa.budget ? plUsd(sa.budget) + " USD" : "nicht festgelegt", sb.budget ? plUsd(sb.budget) + " USD" : "nicht festgelegt"),
    zeile("Gesamtgewicht", plProzent(summe(sa)) + " %", plProzent(summe(sb)) + " %"), zeile("Symbole", String(sa.positionen.length), String(sb.positionen.length)));
  tab.append(thead, tbody);
  const huelle = Object.assign(document.createElement("div"), { className: "pl-tabelle-huelle" }); huelle.append(tab);
  const berechnet = Object.assign(document.createElement("p"), { textContent: "Berechnete Vergleichswerte (A → B, Zielbetrag = Budget × Zielgewicht, auf Cent gerundet):" });
  const { liste } = plVergleichListe(sa, sb);
  liste.setAttribute("aria-label", `Unterschiede je Symbol von „${a.name}“ nach „${b.name}“`);
  const gemeinsam = sa.positionen.map((x) => x.symbol).filter((s) => sb.positionen.some((y) => y.symbol === s));
  const reihenA = gemeinsam.join(", "), reihenB = sb.positionen.map((x) => x.symbol).filter((s) => gemeinsam.includes(s)).join(", ");
  const weitere = Object.assign(document.createElement("ul"), {});
  weitere.setAttribute("aria-label", "Weitere Unterschiede ohne finanzielle Bedeutung");
  weitere.append(Object.assign(document.createElement("li"), { textContent: reihenA === reihenB ? "Reihenfolge der gemeinsamen Symbole: gleich." : `Reihenfolge der gemeinsamen Symbole unterschiedlich – A: ${reihenA || "–"}; B: ${reihenB || "–"} (nur Anordnung, keine finanzielle Differenz).` }),
    Object.assign(document.createElement("li"), { textContent: sa.notiz === sb.notiz ? `Notiz: gleich${sa.notiz ? " („" + sa.notiz + "“)" : " (keine)"}.` : `Notiz unterschiedlich – A: ${sa.notiz ? "„" + sa.notiz + "“" : "keine"}; B: ${sb.notiz ? "„" + sb.notiz + "“" : "keine"} (keine finanzielle Differenz).` }));
  const fuss = Object.assign(document.createElement("p"), { className: "wz-wichtig", textContent: "Vergleich gespeicherter Planungswerte – keine Kurse, keine Prognose, keine Order. Nichts wird gesendet oder ausgeführt." });
  aus.append(fakten, huelle, berechnet, liste, Object.assign(document.createElement("p"), { textContent: "Weitere Unterschiede (keine finanzielle Differenz):" }), weitere, fuss);
}
// Vorschau vor dem Laden: welche aktuellen Werte durch den Schnappschuss ersetzt würden
function plSzVorschauZeigen(p) {
  const v = ablaufEl("pl-sz-vorschau");
  const s = p && p.szenarien.find((x) => x.id === PL.szLaden);
  v.replaceChildren();
  v.hidden = !s;
  if (!s) return;
  const sn = s.schnappschuss;
  const f = [];
  plSzenarioPruefen(s, "Szenario", f, null);
  const titel = Object.assign(document.createElement("p"), { textContent: `Vorschau: „${s.name}“ in die aktuellen Eingaben von „${p.name}“ laden. Ersetzt würden:` });
  const liste = document.createElement("ul");
  const aktuell = { budget: p.budget, positionen: p.positionen, notiz: p.notiz };
  liste.append(Object.assign(document.createElement("li"), { textContent: `Budget: ${aktuell.budget ? plUsd(aktuell.budget) + " USD" : "nicht festgelegt"} → ${sn.budget ? plUsd(sn.budget) + " USD" : "nicht festgelegt"}` }),
    Object.assign(document.createElement("li"), { textContent: `Positionen: ${aktuell.positionen.map((x) => `${x.symbol} ${plProzent(x.gewicht)} %`).join(", ") || "keine"} → ${sn.positionen.map((x) => `${x.symbol} ${plProzent(x.gewicht)} %`).join(", ") || "keine"}` }),
    Object.assign(document.createElement("li"), { textContent: `Notiz: ${aktuell.notiz ? "„" + aktuell.notiz + "“" : "keine"} → ${sn.notiz ? "„" + sn.notiz + "“" : "keine"}` }));
  const hinweis = Object.assign(document.createElement("p"), { className: "klein", textContent: "Name und gespeicherte Szenarien des Portfolios bleiben unverändert. Das ändert nur lokale Planungswerte – keine Order, nichts wird gesendet." });
  const ja = Object.assign(document.createElement("button"), { type: "button", className: "knopf", id: "pl-sz-laden-ja", textContent: "Laden bestätigen", disabled: f.length > 0 });
  const nein = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", id: "pl-sz-laden-nein", textContent: "Abbrechen" });
  const zeile = Object.assign(document.createElement("div"), { className: "order-zeile" }); zeile.append(ja, nein);
  v.append(titel, liste, hinweis);
  if (f.length) v.append(Object.assign(document.createElement("p"), { className: "wz-wichtig", textContent: "✖ Szenario beschädigt oder unvollständig – Laden gesperrt: " + f.slice(0, 3).join("; ") }));
  v.append(zeile);
}
function plSzSchnappschuss(p) { return { budget: p.budget, positionen: p.positionen.map((x) => ({ symbol: x.symbol, gewicht: x.gewicht })), notiz: p.notiz }; }
function plSzName(roh) {
  const n = String(roh || "").trim();
  if (!n) return { fehler: "Bitte einen Szenarionamen eintragen (1 bis 60 Zeichen)." };
  if (n.length > PL_GRENZEN.maxName) return { fehler: `Szenarioname höchstens ${PL_GRENZEN.maxName} Zeichen.` };
  return { name: n };
}
// Nach Neuzeichnen der Liste: verlorenen Fokus auf denselben Knopf des Szenarios setzen, sonst auf dessen Auswahl, sonst auf
// die Statusmeldung (z. B. nach dem Löschen). Ein bewusst gesetzter Fokus (Vorschau, Rückfrage) bleibt unangetastet.
function plSzFokus(id, aktion) {
  const f = document.activeElement;
  if (f && f !== document.body && document.contains(f) && !f.closest("[hidden]")) return;
  const liste = ablaufEl("pl-sz-liste");
  const ziel = (id && (liste.querySelector(`button[data-sz-aktion="${aktion}"][data-szenario="${id}"]:not(:disabled)`) || liste.querySelector(`button[data-sz-aktion="auswahl"][data-szenario="${id}"]`))) || ablaufEl("pl-sz-status");
  ziel.focus();
}
function plSzAktion(aktion, id) {
  const feldName = () => ablaufEl("pl-sz-name").value;
  if (aktion === "auswahl") { PL.szAuswahl = id; if (!PL.szA) PL.szA = id; plZeigen(); const st = plLaden(); const p = st.daten && st.daten.portfolios.find((x) => x.id === st.daten.aktiv); const s = p && p.szenarien.find((x) => x.id === id); if (s) plStatus(`Szenario „${s.name}“ ausgewählt (für den Vergleich als A vorgemerkt, falls A leer war).`, false, "pl-sz-status"); return; }
  if (aktion === "loeschen-nein") { PL.szLoeschen = ""; plZeigen(); plStatus("Nicht gelöscht.", false, "pl-sz-status"); return; }
  if (aktion === "laden") { PL.szLaden = id; plZeigen(); const ja = ablaufEl("pl-sz-laden-ja"); if (ja && !ja.disabled) ja.focus(); else { const nein = ablaufEl("pl-sz-laden-nein"); if (nein) nein.focus(); } return; }
  if (aktion === "export") {
    const st = plLaden(); const p = st.daten && st.daten.portfolios.find((x) => x.id === st.daten.aktiv); const s = p && p.szenarien.find((x) => x.id === id);
    if (!s) return;
    const inhalt = { art: "jarvis-portfolio-szenario", version: 2, exportiert: plJetzt(), aus_portfolio: p.name, szenario: s };
    const dateiname = "jarvis-szenario-" + s.name.replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g, "-").slice(0, 40) + ".json";
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([JSON.stringify(inhalt, null, 2)], { type: "application/json" })), download: dateiname });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    plStatus(`Szenario „${s.name}“ exportiert (${dateiname}) – nur Name, Zeitpunkt, Budget, Symbole, Gewichte und Notiz.`, false, "pl-sz-status");
    return;
  }
  if (aktion === "loeschen" && PL.szLoeschen !== id) { PL.szLoeschen = id; plZeigen(); const b = ablaufEl("pl-sz-liste").querySelector(`button[data-sz-aktion="loeschen"][data-szenario="${id}"]`); if (b) b.focus(); plStatus("Noch einmal „Wirklich löschen?“ drücken, um das Szenario zu löschen – es lässt sich danach mit „Löschen rückgängig“ wiederherstellen.", false, "pl-sz-status"); return; }
  plAendern((d, p) => {
    if (!p) return "Kein Musterportfolio ausgewählt.";
    if (p.archiviert) return "Archiviertes Musterportfolio – erst „Wiederherstellen“.";
    const i = p.szenarien.findIndex((s) => s.id === id);
    if (i < 0) return "Szenario nicht gefunden.";
    const s = p.szenarien[i];
    if (aktion === "umbenennen") {
      const n = plSzName(feldName()); if (n.fehler) return n.fehler;
      if (!plSzNameFrei(p, n.name, s.id)) return `Name „${n.name}“ gibt es in diesem Portfolio schon – bitte einen anderen wählen.`;
      PL.letzteMeldung = `Szenario „${s.name}“ heißt jetzt „${n.name}“ – gespeicherte Werte unverändert.`;
      s.name = n.name;
      return null;
    }
    if (aktion === "duplizieren") {
      if (p.szenarien.length >= PL_GRENZEN.maxSzenarien) return `Höchstens ${PL_GRENZEN.maxSzenarien} Szenarien je Musterportfolio.`;
      const wunsch = String(feldName() || "").trim();
      if (wunsch.length > PL_GRENZEN.maxName) return `Szenarioname höchstens ${PL_GRENZEN.maxName} Zeichen.`;
      if (wunsch && !plSzNameFrei(p, wunsch)) return `Name „${wunsch}“ gibt es in diesem Portfolio schon – bitte einen anderen wählen.`;
      const name = wunsch || plSzNameEindeutig(p, `Kopie von ${s.name}`);
      if (!name) return "Kein freier Name gefunden – bitte einen eintragen.";
      const neu = { id: plNeueKennung("sz"), name, erstellt: plJetzt(), schnappschuss: JSON.parse(JSON.stringify(s.schnappschuss)) };
      p.szenarien.push(neu);
      PL.szAuswahl = neu.id;
      PL.letzteMeldung = `Kopie „${name}“ von „${s.name}“ angelegt (gleiche Werte, neuer Zeitpunkt).`;
      return null;
    }
    if (aktion === "loeschen") {
      p.szenarien.splice(i, 1);
      d.papierkorb.push({ portfolio: p.id, szenario: s, geloescht: plJetzt() });
      while (d.papierkorb.length > PL_GRENZEN.maxPapierkorb) d.papierkorb.shift();
      PL.szLoeschen = "";
      PL.letzteMeldung = `Szenario „${s.name}“ gelöscht. „Löschen rückgängig“ stellt es wieder her (die letzten ${PL_GRENZEN.maxPapierkorb} Löschungen bleiben dafür gespeichert).`;
      return null;
    }
    return "Unbekannte Aktion.";
  }, () => PL.letzteMeldung, "pl-sz-status");
  if (aktion === "duplizieren" || aktion === "umbenennen") ablaufEl("pl-sz-name").value = "";
}
function plStarten() {
  if (!ablaufEl("pl-bereich")) return;
  ablaufEl("pl-neu").addEventListener("click", () => {
    const name = String(ablaufEl("pl-name").value || "").trim();
    const st = plLaden();
    if (st.beschaedigt) { plZeigen(); return; }
    // Steht im Feld noch der Name des aktiven Portfolios, bekommt das neue einen eigenen Standardnamen (keine Verwechslung)
    const aktivName = (st.daten.portfolios.find((x) => x.id === st.daten.aktiv) || {}).name;
    const vorschlag = name && name !== aktivName ? name : `Musterportfolio ${st.daten.portfolios.length + 1}`;
    plAendern((d) => {
      if (d.portfolios.length >= PL_GRENZEN.maxPortfolios) return `Höchstens ${PL_GRENZEN.maxPortfolios} Musterportfolios.`;
      if (vorschlag.length > PL_GRENZEN.maxName) return `Name höchstens ${PL_GRENZEN.maxName} Zeichen.`;
      const id = plNeueKennung();
      const jetzt = plJetzt();
      d.portfolios.push({ id, name: vorschlag, budget: null, positionen: [], notiz: "", archiviert: false, erstellt: jetzt, geaendert: jetzt, szenarien: [] });
      d.aktiv = id;
      PL.vergleich = "";
      return null;
    }, `„${vorschlag}“ angelegt (leer, nur auf diesem Gerät).`);
  });
  ablaufEl("pl-umbenennen").addEventListener("click", () => {
    const name = String(ablaufEl("pl-name").value || "").trim();
    feldUngueltig("pl-name", !name);
    if (!name) { plStatus("Bitte einen Namen eintragen (1 bis 60 Zeichen).", true); return; }
    plAendern((d, p) => { if (!p) return "Kein Musterportfolio ausgewählt."; p.name = name; return null; }, `Umbenannt in „${name}“.`);
  });
  ablaufEl("pl-auswahl").addEventListener("change", () => {
    const id = ablaufEl("pl-auswahl").value;
    // Wechsel: alles wird aus dem gewählten Portfolio neu gezeichnet – keine Ergebnisse des vorigen bleiben stehen
    plAendern((d) => { if (!d.portfolios.some((x) => x.id === id)) return "Unbekanntes Musterportfolio."; d.aktiv = id; if (PL.vergleich === id) PL.vergleich = ""; return null; }, (d) => `„${d.portfolios.find((x) => x.id === id).name}“ ausgewählt.`);
  });
  ablaufEl("pl-archivieren").addEventListener("click", () => plAendern((d, p) => {
    if (!p) return "Kein Musterportfolio ausgewählt.";
    p.archiviert = !p.archiviert;
    PL.letzteMeldung = p.archiviert ? `„${p.name}“ archiviert – ${p.szenarien.length} Szenario(s) bleiben erhalten; ansehen ja, bearbeiten erst nach „Wiederherstellen“.` : `„${p.name}“ wiederhergestellt – wieder bearbeitbar.`;
    return null;
  }, () => PL.letzteMeldung));
  ablaufEl("pl-loeschen").addEventListener("click", () => {
    const st = plLaden();
    const p = st.daten && st.daten.portfolios.find((x) => x.id === st.daten.aktiv);
    if (!p) return;
    if (PL.portfolioLoeschen !== p.id) {
      PL.portfolioLoeschen = p.id;
      plZeigen();
      ablaufEl("pl-loeschen").focus();
      plStatus(`Endgültig löschen entfernt „${p.name}“ mit ${p.szenarien.length} Szenario(s) ohne Rückgängig – vorher exportieren, falls du sie behalten willst. Zum Bestätigen noch einmal drücken; jede andere Aktion bricht ab.`, true);
      return;
    }
    const name = p.name, anzahl = p.szenarien.length;
    plAendern((d) => {
      d.portfolios = d.portfolios.filter((x) => x.id !== p.id);
      d.papierkorb = d.papierkorb.filter((x) => x.portfolio !== p.id);
      d.aktiv = (d.portfolios.find((x) => !x.archiviert) || d.portfolios[0] || { id: null }).id;
      PL.portfolioLoeschen = "";
      return null;
    }, `„${name}“ endgültig gelöscht (mit ${anzahl} Szenario(s)).`);
  });
  ablaufEl("pl-notiz").addEventListener("change", () => {
    const n = String(ablaufEl("pl-notiz").value || "");
    const zuLang = n.length > PL_GRENZEN.maxNotiz;
    feldUngueltig("pl-notiz", zuLang);
    if (zuLang) { plStatus(`Notiz höchstens ${PL_GRENZEN.maxNotiz} Zeichen – nichts geändert.`, true); return; }
    plAendern((d, p) => { if (!p) return "Kein Musterportfolio ausgewählt."; p.notiz = n.trim(); return null; }, "Notiz gespeichert (nur auf diesem Gerät).");
  });
  ablaufEl("pl-budget").addEventListener("change", () => {
    const roh = String(ablaufEl("pl-budget").value).trim();
    const wert = roh === "" ? null : Number(roh);
    // Zahlenfeld: Buchstaben liefern einen leeren Wert mit validity.badInput – das ist „keine Zahl“, nicht „Budget entfernen“
    const fehler = ablaufEl("pl-budget").validity && ablaufEl("pl-budget").validity.badInput ? "Budget ist keine Zahl." : roh === "" ? null : !Number.isFinite(wert) ? "Budget ist keine Zahl." : wert <= 0 ? "Budget muss größer als 0 USD sein." : wert > PL_GRENZEN.maxBudget ? `Budget über ${plUsd(PL_GRENZEN.maxBudget)} USD – für ein Musterportfolio nicht vorgesehen.` : null;
    feldUngueltig("pl-budget", Boolean(fehler));
    if (fehler) { plStatus(fehler + " Nichts geändert.", true); return; }
    plAendern((d, p) => { if (!p) return "Kein Musterportfolio ausgewählt."; p.budget = wert === null ? null : Math.round(wert * 100) / 100; return null; }, wert === null ? "Budget entfernt – Zielbeträge werden nicht berechnet." : `Budget ${plUsd(wert)} USD übernommen (hypothetisch).`);
  });
  const hinzufuegen = (roh, quelle) => plAendern((d, p) => {
    if (!p) return "Erst ein Musterportfolio anlegen.";
    const s = plSymbolPruefen(roh, p);
    if (s.fehler) { if (quelle === "hand") feldUngueltig("pl-symbol", true); return s.fehler + " Nichts geändert."; }
    p.positionen.push({ symbol: s.symbol, gewicht: 0 });
    return null;
  }, `${String(roh).trim().toUpperCase()} hinzugefügt (Zielgewicht 0 % – bitte festlegen).`);
  ablaufEl("pl-hinzu").addEventListener("click", () => { if (hinzufuegen(ablaufEl("pl-symbol").value, "hand")) { ablaufEl("pl-symbol").value = ""; feldUngueltig("pl-symbol", false); } });
  ablaufEl("pl-symbol").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); ablaufEl("pl-hinzu").click(); } });
  ablaufEl("pl-symbol").addEventListener("input", () => feldUngueltig("pl-symbol", false));
  ablaufEl("pl-wl-hinzu").addEventListener("click", () => { const s = ablaufEl("pl-wl-symbol").value; if (s) hinzufuegen(s, "watchlist"); });
  ablaufEl("pl-wl-symbol").addEventListener("focus", () => { const st = plLaden(); if (!st.beschaedigt) { const p = st.daten.portfolios.find((x) => x.id === st.daten.aktiv) || null; plWlOptionen(p && !p.archiviert ? p : null); } });
  // Tabelle: Gewichte und Knöpfe per Ereignisdelegation
  ablaufEl("pl-zeilen").addEventListener("change", (ev) => {
    const f = ev.target.closest(".pl-gewicht");
    if (!f) return;
    const w = Number(String(f.value).trim().replace(",", "."));
    if (String(f.value).trim() === "" || !Number.isFinite(w) || w < 0 || w > 100) { f.setAttribute("aria-invalid", "true"); plStatus(`Zielgewicht ${f.dataset.symbol}: bitte eine Zahl von 0 bis 100 eintragen. Nichts geändert.`, true); return; }
    plAendern((d, p) => { const x = p && p.positionen.find((y) => y.symbol === f.dataset.symbol); if (!x) return "Position nicht gefunden."; x.gewicht = Math.round(w * 100) / 100; return null; }, `Zielgewicht ${f.dataset.symbol} = ${plProzent(w)} %.`);
  });
  ablaufEl("pl-zeilen").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-pl-aktion]");
    if (!b) return;
    const s = b.dataset.symbol, a = b.dataset.plAktion;
    plAendern((d, p) => {
      if (!p) return "Kein Musterportfolio ausgewählt.";
      const i = p.positionen.findIndex((x) => x.symbol === s);
      if (i < 0) return "Position nicht gefunden.";
      if (a === "weg") p.positionen.splice(i, 1);
      else { const j = a === "hoch" ? i - 1 : i + 1; if (j < 0 || j >= p.positionen.length) return null; [p.positionen[i], p.positionen[j]] = [p.positionen[j], p.positionen[i]]; }
      return null;
    }, a === "weg" ? `${s} entfernt.` : `${s} ${a === "hoch" ? "nach oben" : "nach unten"} verschoben.`);
    // Fokus nachvollziehbar halten: auf denselben Knopf der Position bzw. auf das Symbolfeld
    const ziel = a === "weg" ? ablaufEl("pl-symbol") : ablaufEl("pl-zeilen").querySelector(`button[data-pl-aktion="${a}"][data-symbol="${s}"]:not(:disabled)`) || ablaufEl("pl-zeilen").querySelector(`tr[data-symbol="${s}"] .pl-gewicht`);
    if (ziel) ziel.focus();
  });
  ablaufEl("pl-gleich").addEventListener("click", () => plAendern((d, p) => {
    if (!p || !p.positionen.length) return "Keine Positionen zum Verteilen.";
    const n = p.positionen.length, basis = Math.floor(10000 / n) / 100, rest = Math.round((100 - basis * n) * 100);
    p.positionen.forEach((x, i) => { x.gewicht = Math.round((basis + (i < rest ? 0.01 : 0)) * 100) / 100; });
    PL.letzteErklaerung = `Gleichmäßig verteilt: je ${plProzent(basis)} %` + (rest ? ` (die ersten ${rest} Positionen +0,01 %, damit die Summe genau 100 % ergibt)` : "") + ".";
    return null;
  }, () => PL.letzteErklaerung));
  ablaufEl("pl-normieren").addEventListener("click", () => plAendern((d, p) => {
    if (!p || !p.positionen.length) return "Keine Positionen zum Normieren.";
    const vorher = p.positionen.reduce((s, x) => s + x.gewicht, 0);
    if (!(vorher > 0)) return "Alle Zielgewichte sind 0 % – Normieren nicht möglich (erst Gewichte eintragen oder gleichmäßig verteilen).";
    const R = window.AktienRebalance;
    if (!R) return "Rechenmodul aktien/rebalance.js nicht geladen.";
    const n = R.zieleNormieren(p.positionen.filter((x) => x.gewicht > 0));
    if (n.fehler) return n.fehler;
    p.positionen.forEach((x) => { x.gewicht = n.gewichte[x.symbol] ? Math.round(n.gewichte[x.symbol] * 100) / 100 : 0; });
    // Rundungsrest (höchstens wenige Hundertstel) der größten Position zuschlagen, damit die Summe genau 100 % ist
    const summe = p.positionen.reduce((s, x) => s + x.gewicht, 0), rest = Math.round((100 - summe) * 100) / 100;
    if (rest) { const g = p.positionen.reduce((a, b) => (b.gewicht > a.gewicht ? b : a)); g.gewicht = Math.round((g.gewicht + rest) * 100) / 100; }
    PL.letzteErklaerung = `Auf 100 % normiert: Summe vorher ${plProzent(vorher)} %, jedes Gewicht × ${plProzent(100 / vorher)} (Verhältnisse bleiben gleich, 0 % bleibt 0 %)` + (rest ? `; Rundungsrest ${rest > 0 ? "+" : ""}${plProzent(rest)} % bei der größten Position.` : ".");
    return null;
  }, () => PL.letzteErklaerung));
  ablaufEl("pl-vergleich").addEventListener("change", () => { PL.vergleich = ablaufEl("pl-vergleich").value; plZeigen(); });
  ablaufEl("pl-export").addEventListener("click", () => {
    const st = plLaden();
    if (st.beschaedigt || !st.daten.portfolios.length) { plStatus("Nichts zu exportieren.", true); return; }
    // Export ohne Papierkorb: nur Portfolios mit ihren Szenarien
    const inhalt = { art: st.daten.art, version: 2, aktiv: st.daten.aktiv, portfolios: st.daten.portfolios, papierkorb: [] };
    // ab 11-13c: Selbstprüfung – die erzeugte Datei muss die eigene Importprüfung bestehen, sonst kein Download (keine unvollständigen Dateien)
    const text = JSON.stringify(inhalt, null, 2);
    let probe; try { probe = plPruefen(JSON.parse(text)); } catch (e) { probe = { ok: false, fehler: [e.message] }; }
    if (!probe.ok) { plStatus("Export abgebrochen – die erzeugte Datei wäre ungültig: " + probe.fehler.slice(0, 2).join("; ") + ". Es wurde nichts heruntergeladen.", true); return; }
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: "jarvis-portfolio-labor.json" });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const vorschau = st.daten.portfolios.slice(0, 5).map((p) => `${p.name} (${p.positionen.length} Position(en))`).join(", ") + (st.daten.portfolios.length > 5 ? " …" : "");
    const meldung = `Export erstellt: ${st.daten.portfolios.length} Musterportfolio(s) mit ${st.daten.portfolios.reduce((s, p) => s + p.szenarien.length, 0)} Szenario(s) – nur Namen, Budgets, Symbole, Gewichte, Notizen und Zeitpunkte, keine Zugangs- oder Kontodaten. Inhalt: ${vorschau}.`;
    plStatus(meldung, false);
    plPruefsumme(text).then((h) => { PL.letzterExportSha = h; if (h) plStatus(meldung + ` SHA-256 der Datei: ${h.slice(0, 16)}…`, false); });
  });
  // Rückweg: Stand 02u liest nur Version 1 – Datei ohne Szenarien, Notizen, Archiv und Zeitpunkte (der Speicher bleibt unverändert)
  ablaufEl("pl-export-v1").addEventListener("click", () => {
    const st = plLaden();
    if (st.beschaedigt || !st.daten.portfolios.length) { plStatus("Nichts zu exportieren.", true); return; }
    const inhalt = plAlsVersion1(st.daten);
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([JSON.stringify(inhalt, null, 2)], { type: "application/json" })), download: "jarvis-portfolio-labor-fuer-02u.json" });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const sz = st.daten.portfolios.reduce((s, p) => s + p.szenarien.length, 0), ar = st.daten.portfolios.filter((p) => p.archiviert).length;
    plStatus(`Export für Stand 02u erstellt: ${inhalt.portfolios.length} Musterportfolio(s) mit Namen, Budgets, Symbolen und Gewichten. Nicht enthalten: ${sz} Szenario(s), Notizen und Zeitpunkte${ar ? `; ${ar} archivierte erscheinen dort als normale Portfolios` : ""}. Für alles zusätzlich „Alle Musterportfolios exportieren“ nutzen.`, false);
  });
  ablaufEl("pl-import-knopf").addEventListener("click", () => ablaufEl("pl-import").click());
  ablaufEl("pl-import").addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (f) plImportieren(f);
  });
  ablaufEl("pl-verwerfen").addEventListener("click", () => {
    if (!PL.loeschenBestaetigen) { PL.loeschenBestaetigen = true; ablaufEl("pl-verwerfen").textContent = "Wirklich verwerfen? Erneut klicken"; plStatus("Noch einmal klicken, um den beschädigten Speicher des Portfolio-Labors zu löschen – nichts anderes wird gelöscht.", true); return; }
    PL.loeschenBestaetigen = false;
    ablaufEl("pl-verwerfen").textContent = "Beschädigten Speicher verwerfen";
    try { localStorage.removeItem(PL_SCHLUESSEL); } catch (e) { plStatus("Browserspeicher gesperrt – nichts gelöscht.", true); return; }
    plZeigen();
    plStatus("Beschädigter Speicher verworfen – das Portfolio-Labor ist leer.", false);
  });
  // Szenarien (ab 11-02v)
  ablaufEl("pl-sz-speichern").addEventListener("click", () => {
    const n = plSzName(ablaufEl("pl-sz-name").value);
    feldUngueltig("pl-sz-name", Boolean(n.fehler));
    if (n.fehler) { plStatus(n.fehler, true, "pl-sz-status"); return; }
    if (plAendern((d, p) => {
      if (!p) return "Erst ein Musterportfolio anlegen.";
      if (p.archiviert) return "Archiviertes Musterportfolio – erst „Wiederherstellen“.";
      if (p.szenarien.length >= PL_GRENZEN.maxSzenarien) return `Höchstens ${PL_GRENZEN.maxSzenarien} Szenarien je Musterportfolio – bitte ältere löschen.`;
      if (!plSzNameFrei(p, n.name)) return `Ein Szenario „${n.name}“ gibt es in diesem Portfolio schon – nichts überschrieben. Bitte einen anderen Namen wählen.`;
      const s = { id: plNeueKennung("sz"), name: n.name, erstellt: plJetzt(), schnappschuss: plSzSchnappschuss(p) };
      p.szenarien.push(s);
      PL.szAuswahl = s.id;
      return null;
    }, `Szenario „${n.name}“ gespeichert – Schnappschuss von Budget, Symbolen, Reihenfolge, Gewichten und Notiz (unveränderlich).`, "pl-sz-status")) { ablaufEl("pl-sz-name").value = ""; feldUngueltig("pl-sz-name", false); }
  });
  ablaufEl("pl-sz-name").addEventListener("input", () => feldUngueltig("pl-sz-name", false));
  ablaufEl("pl-sz-liste").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-sz-aktion]");
    if (!b) return;
    plSzAktion(b.dataset.szAktion, b.dataset.szenario);
    plSzFokus(b.dataset.szenario, b.dataset.szAktion === "loeschen-nein" ? "loeschen" : b.dataset.szAktion);
  });
  for (const [id, schluessel] of [["pl-sz-a", "szA"], ["pl-sz-b", "szB"]]) ablaufEl(id).addEventListener("change", () => { PL[schluessel] = ablaufEl(id).value; plZeigen(); });
  ablaufEl("pl-sz-rueckgaengig").addEventListener("click", () => plAendern((d, p) => {
    if (!p) return "Kein Musterportfolio ausgewählt.";
    if (p.archiviert) return "Archiviertes Musterportfolio – erst „Wiederherstellen“.";
    let idx = -1;
    for (let k = d.papierkorb.length - 1; k >= 0; k--) if (d.papierkorb[k].portfolio === p.id) { idx = k; break; }
    if (idx < 0) return "Nichts zum Wiederherstellen.";
    if (p.szenarien.length >= PL_GRENZEN.maxSzenarien) return `Höchstens ${PL_GRENZEN.maxSzenarien} Szenarien – bitte erst eines löschen.`;
    const s = d.papierkorb.splice(idx, 1)[0].szenario;
    const name = plSzNameFrei(p, s.name) ? s.name : plSzNameEindeutig(p, s.name);
    if (!name) return "Kein freier Name zum Wiederherstellen gefunden.";
    PL.letzteMeldung = `Szenario „${s.name}“ wiederhergestellt` + (name !== s.name ? ` als „${name}“ (Name war inzwischen vergeben).` : " (unverändert).");
    s.name = name;
    p.szenarien.push(s);
    PL.szAuswahl = s.id;
    return null;
  }, () => PL.letzteMeldung, "pl-sz-status") && plSzFokus(PL.szAuswahl, "auswahl"));
  // Laden-Vorschau: Bestätigen / Abbrechen (per Ereignisdelegation, die Knöpfe werden neu gezeichnet)
  ablaufEl("pl-sz-vorschau").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.id === "pl-sz-laden-nein") { const war = PL.szLaden; PL.szLaden = ""; plZeigen(); plStatus("Nicht geladen – die aktuellen Eingaben sind unverändert.", false, "pl-sz-status"); plSzFokus(war, "laden"); return; }
    if (b.id !== "pl-sz-laden-ja") return;
    const id = PL.szLaden;
    plAendern((d, p) => {
      if (!p) return "Kein Musterportfolio ausgewählt.";
      if (p.archiviert) return "Archiviertes Musterportfolio – erst „Wiederherstellen“.";
      const s = p.szenarien.find((x) => x.id === id);
      if (!s) return "Szenario nicht gefunden – nichts geladen.";
      const f = []; plSzenarioPruefen(s, "Szenario", f, null);
      if (f.length) return "Szenario beschädigt oder unvollständig – nichts geladen: " + f.slice(0, 2).join("; ");
      p.budget = s.schnappschuss.budget;
      p.positionen = s.schnappschuss.positionen.map((x) => ({ symbol: x.symbol, gewicht: x.gewicht }));
      p.notiz = s.schnappschuss.notiz;
      PL.szLaden = "";
      PL.szAuswahl = s.id;
      PL.letzteMeldung = `Szenario „${s.name}“ in die aktuellen Eingaben von „${p.name}“ geladen. Geändert wurden nur lokale Planungswerte (Budget, Positionen, Notiz) – keine Order, nichts gesendet; das Szenario selbst bleibt unverändert.`;
      return null;
    }, () => PL.letzteMeldung, "pl-sz-status");
    ablaufEl("pl-sz-status").focus();
  });
  ablaufEl("pl-sz-import-knopf").addEventListener("click", () => ablaufEl("pl-sz-import").click());
  ablaufEl("pl-sz-import").addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (f) plSzImportieren(f);
  });
  // Jede andere Aktion im Labor bricht ein angefordertes endgültiges Löschen des Portfolios ab
  ablaufEl("pl-bereich").addEventListener("click", (ev) => { if (PL.portfolioLoeschen && !ev.target.closest("#pl-loeschen")) { PL.portfolioLoeschen = ""; ablaufEl("pl-loeschen").textContent = "Endgültig löschen …"; } }, true);
  plZeigen();
}
async function plDateiLesen(datei, statusZiel) {
  plStatus(`Datei „${String(datei.name).slice(0, 60)}“ wird gelesen …`, false, statusZiel);
  if (datei.size > PL_GRENZEN.maxImportZeichen) { plStatus("Datei zu groß (über 200 KB) – nichts importiert.", true, statusZiel); return null; }
  try { return JSON.parse(await datei.text()); } catch (e) { plStatus("Datei ist kein gültiges JSON – nichts importiert.", true, statusZiel); return null; }
}
// Import ganzer Bestände (Version 1 oder 2): gültige Portfolios werden ZUSÄTZLICH angelegt (neue Kennungen), nie überschrieben
// ab 11-13c: SHA-256 eines Textes (zum Vergleich von Export- und Importdatei); ohne Web Crypto leer
async function plPruefsumme(text) {
  try { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase(); } catch (e) { return ""; }
}
async function plImportieren(datei) {
  try { PL.letzterImportSha = await plPruefsumme(await datei.text()); } catch (e) { PL.letzterImportSha = ""; }
  const roh = await plDateiLesen(datei, "pl-status");
  if (!roh) return;
  const p = plPruefen(roh);
  if (!p.ok) { plStatus("Datei abgelehnt: " + p.fehler.slice(0, 3).join("; ") + (p.fehler.length > 3 ? ` (und ${p.fehler.length - 3} weitere)` : "") + " – nichts importiert.", true); return; }
  const d = plMigrieren(roh);
  plAendern((ziel) => {
    if (ziel.portfolios.length + d.portfolios.length > PL_GRENZEN.maxPortfolios) return `Zu viele Musterportfolios: vorhanden ${ziel.portfolios.length}, in der Datei ${d.portfolios.length}, höchstens ${PL_GRENZEN.maxPortfolios} – nichts importiert.`;
    const jetzt = plJetzt();
    for (const x of d.portfolios) ziel.portfolios.push({ id: plNeueKennung(), name: x.name.trim().slice(0, PL_GRENZEN.maxName), budget: x.budget, positionen: x.positionen.map((y) => ({ symbol: y.symbol, gewicht: y.gewicht })),
      notiz: x.notiz, archiviert: x.archiviert, erstellt: x.erstellt || jetzt, geaendert: jetzt,
      szenarien: x.szenarien.map((s) => ({ id: plNeueKennung("sz"), name: s.name, erstellt: s.erstellt, schnappschuss: plSchnappschussKopie(s.schnappschuss) })) });
    if (!ziel.aktiv && ziel.portfolios.length) ziel.aktiv = ziel.portfolios[0].id;
    return null;
  }, `${d.portfolios.length} Musterportfolio(s) importiert (mit ${d.portfolios.reduce((s, x) => s + x.szenarien.length, 0)} Szenario(s); zusätzlich, nichts überschrieben).` + (PL.letzterImportSha ? ` SHA-256 der Datei: ${PL.letzterImportSha.slice(0, 16)}… (mit der Exportmeldung vergleichbar)` : ""));
}
// Import eines einzelnen Szenarios in das aktive Portfolio: neue Kennung, Name bei Gleichheit mit „(2)“ usw.; nie überschrieben
async function plSzImportieren(datei) {
  const roh = await plDateiLesen(datei, "pl-sz-status");
  if (!roh) return;
  const f = [];
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) f.push("kein JSON-Objekt");
  else {
    if (roh.art !== "jarvis-portfolio-szenario") f.push("„art“ ist nicht „jarvis-portfolio-szenario“");
    if (roh.version !== 2) f.push("unbekannte Version");
    plSzenarioPruefen(roh.szenario, "Szenario", f, null);
  }
  if (f.length) { plStatus("Datei abgelehnt: " + f.slice(0, 3).join("; ") + (f.length > 3 ? ` (und ${f.length - 3} weitere)` : "") + " – nichts importiert.", true, "pl-sz-status"); return; }
  plAendern((d, p) => {
    if (!p) return "Erst ein Musterportfolio auswählen – nichts importiert.";
    if (p.archiviert) return "Archiviertes Musterportfolio – erst „Wiederherstellen“; nichts importiert.";
    if (p.szenarien.length >= PL_GRENZEN.maxSzenarien) return `Höchstens ${PL_GRENZEN.maxSzenarien} Szenarien – nichts importiert.`;
    const name = plSzNameFrei(p, roh.szenario.name) ? roh.szenario.name : plSzNameEindeutig(p, roh.szenario.name);
    if (!name) return "Kein freier Name gefunden – nichts importiert.";
    const s = { id: plNeueKennung("sz"), name, erstellt: roh.szenario.erstellt, schnappschuss: plSchnappschussKopie(roh.szenario.schnappschuss) };
    p.szenarien.push(s);
    PL.szAuswahl = s.id;
    PL.letzteMeldung = `Szenario „${roh.szenario.name}“ in „${p.name}“ importiert` + (name !== roh.szenario.name ? ` als „${name}“ (Name war schon vergeben)` : "") + " – vorhandene Szenarien unverändert.";
    return null;
  }, () => PL.letzteMeldung, "pl-sz-status");
}
document.addEventListener("DOMContentLoaded", plStarten);

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("portfolio-labor");
