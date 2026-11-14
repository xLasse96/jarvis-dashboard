// JARVIS Dashboard – Modul „portfolio-plus“ (ab 11-07l). Zusammenfassung der US-Aktien-Simulation (Paper-Kern, Spielgeld) – nur Anzeige:
//   - Gesamtübersicht: Startkapital, Bargeld (Cash-Quote), Positionswert, realisiertes und nicht realisiertes Ergebnis, Gebühren
//   - Positionen mit Einstand, Bewertungskurs (nur aus einer Analyse dieser Sitzung), nicht realisiertem Ergebnis – ohne Kurs „nicht
//     bewertbar“ statt geschätzt
//   - Gebührenübersicht (Kauf/Verkauf, Anteil am Volumen) und realisierte Ergebnisse je Symbol
//   - Ledger-Filter nach Symbol (zusätzlich zu Seite/Zustand)
// Keine Buchung, keine Order, keine Anfrage; ändert weder Handelssperren noch den gespeicherten Stand.
function simZusammenfassung(p, analysen = {}) {
  if (!p) return null;
  const ledger = Array.isArray(p.ledger) ? p.ledger : [];
  const gefuellt = ledger.filter((e) => e && e.zustand === "gefuellt");
  const summe = (xs, f) => Math.round(xs.reduce((s, e) => s + (Number.isFinite(f(e)) ? f(e) : 0), 0) * 100) / 100;
  const gebuehrKauf = summe(gefuellt.filter((e) => e.seite === "kauf"), (e) => e.gebuehr), gebuehrVerkauf = summe(gefuellt.filter((e) => e.seite === "verkauf"), (e) => e.gebuehr);
  const volumen = summe(gefuellt, (e) => e.volumen);
  const verkaeufe = gefuellt.filter((e) => e.seite === "verkauf" && Number.isFinite(e.ergebnis));
  const realisiertJe = {};
  for (const e of verkaeufe) realisiertJe[e.symbol] = Math.round(((realisiertJe[e.symbol] || 0) + e.ergebnis) * 100) / 100;
  const positionen = Object.entries(p.positionen || {}).filter(([, x]) => x && x.menge > 0).map(([symbol, x]) => {
    const a = analysen[symbol], kurs = a && Number.isFinite(a.kurs) && a.kurs > 0 ? a.kurs : null;
    const einstandWert = Math.round(x.menge * x.einstand * 100) / 100;
    return { symbol, menge: x.menge, einstand: x.einstand, einstand_wert: einstandWert, kurs, kurs_quelle: kurs === null ? null : a.synthetisch ? "synthetische Testdaten" : a.frisch === false ? "veraltete Analyse" : "Analyse dieser Sitzung",
      wert: kurs === null ? null : Math.round(x.menge * kurs * 100) / 100, unrealisiert: kurs === null ? null : Math.round(x.menge * (kurs - x.einstand) * 100) / 100 };
  });
  const bewertet = positionen.filter((x) => x.wert !== null);
  const positionswert = Math.round(positionen.reduce((s, x) => s + (x.wert !== null ? x.wert : x.einstand_wert), 0) * 100) / 100;
  const bargeld = Number.isFinite(p.bargeld) ? p.bargeld : 0, gesamt = Math.round((bargeld + positionswert) * 100) / 100;
  return {
    startkapital: Number.isFinite(p.startkapital) ? p.startkapital : null, bargeld, positionswert, gesamt, cash_quote_pct: gesamt > 0 ? Math.round((bargeld / gesamt) * 1000) / 10 : null,
    realisiert: summe(verkaeufe, (e) => e.ergebnis), realisiert_je: realisiertJe,
    unrealisiert: bewertet.length ? Math.round(bewertet.reduce((s, x) => s + x.unrealisiert, 0) * 100) / 100 : null,
    nicht_bewertet: positionen.filter((x) => x.wert === null).map((x) => x.symbol),
    gebuehren: { kauf: gebuehrKauf, verkauf: gebuehrVerkauf, gesamt: Math.round((gebuehrKauf + gebuehrVerkauf) * 100) / 100, anteil_volumen_pct: volumen > 0 ? Math.round(((gebuehrKauf + gebuehrVerkauf) / volumen) * 10000) / 100 : null, volumen },
    buchungen: { gesamt: ledger.length, ausgefuehrt: gefuellt.length, blockiert: ledger.filter((e) => e && e.zustand === "abgelehnt").length, unklar: ledger.filter((e) => e && e.zustand === "unklar").length },
    positionen,
  };
}
function simZusammenfassungZeigen() {
  const box = document.getElementById("sim-zusammenfassung");
  if (!box) return null;
  if (!SIM.bereit || SIM.dbFehler || SIM.beschaedigt || !SIM.portfolio) { box.textContent = !SIM.bereit ? "Simulationsstand wird geladen …" : SIM.beschaedigt ? "⚠ Gespeicherter Simulationsstand beschädigt – keine Zusammenfassung." : SIM.dbFehler ? "⚠ Simulationsspeicher nicht verfügbar." : "Noch kein Simulations-Portfolio."; return null; }
  const z = simZusammenfassung(SIM.portfolio, APROFIL.analysen || {});
  const u = (x) => (x === null || x === undefined ? "nicht bewertbar" : simUsd(x)), pz = (x) => (x === null ? "–" : x.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " %");
  box.replaceChildren(
    wzKnoten("div", { "data-teil": "gesamt", text: `SIMULATION (Spielgeld) · Start ${z.startkapital === null ? "unbekannt" : simUsd(z.startkapital)} · Gesamtwert ${simUsd(z.gesamt)} · Bargeld ${simUsd(z.bargeld)} (Cash-Quote ${pz(z.cash_quote_pct)}) · Positionen ${simUsd(z.positionswert)}` }),
    wzKnoten("div", { "data-teil": "ergebnis", text: `Realisiert ${simUsd(z.realisiert)} · nicht realisiert ${u(z.unrealisiert)}${z.nicht_bewertet.length ? ` (ohne ${z.nicht_bewertet.join(", ")} – kein Kurs aus einer Analyse dieser Sitzung, Wert zum Einstand gezählt)` : ""}` }),
    wzKnoten("div", { "data-teil": "gebuehren", text: `Gebühren ${simUsd(z.gebuehren.gesamt)} (Kauf ${simUsd(z.gebuehren.kauf)}, Verkauf ${simUsd(z.gebuehren.verkauf)}; ${pz(z.gebuehren.anteil_volumen_pct)} des Volumens ${simUsd(z.gebuehren.volumen)}) · Buchungen ${z.buchungen.ausgefuehrt} ausgeführt, ${z.buchungen.blockiert} blockiert, ${z.buchungen.unklar} unklar` }),
    z.positionen.length ? wzKnoten("table", { klasse: "wz-tabelle", "data-teil": "positionen" }, wzKnoten("tr", {}, ...["Symbol", "Menge", "Einstand", "Kurs (Quelle)", "nicht realisiert"].map((t) => wzKnoten("th", { text: t }))),
      ...z.positionen.map((x) => wzKnoten("tr", { "data-symbol": x.symbol }, ...[x.symbol, x.menge.toLocaleString("de-DE"), x.einstand.toLocaleString("de-DE", { maximumFractionDigits: 4 }), x.kurs === null ? "nicht verfügbar" : `${x.kurs.toLocaleString("de-DE", { maximumFractionDigits: 4 })} (${x.kurs_quelle})`, u(x.unrealisiert)].map((t) => wzKnoten("td", { text: t }))))) : wzKnoten("div", { klasse: "klein", text: "Keine offenen Positionen." }),
    Object.keys(z.realisiert_je).length ? wzKnoten("div", { klasse: "klein", "data-teil": "realisiert-je", text: "Realisiert je Symbol: " + Object.entries(z.realisiert_je).map(([s, v]) => `${s} ${simUsd(v)}`).join(" · ") }) : null,
  );
  return z;
}
// Symbolfilter des Ledgers: Auswahl aus den gebuchten Symbolen; wirkt zusätzlich zu Seite und Zustand
function simSymbolFilterAuffrischen() {
  const sel = document.getElementById("sim-filter-symbol");
  if (!sel) return;
  const symbole = [...new Set(((SIM.portfolio && SIM.portfolio.ledger) || []).map((e) => e && e.symbol).filter(Boolean))].sort();
  const gew = sel.value;
  sel.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "alle Symbole" }), ...symbole.map((s) => Object.assign(document.createElement("option"), { value: s, textContent: s })));
  sel.value = symbole.includes(gew) ? gew : "";
}
{
  const original = simLedgerZeigen;
  simLedgerZeigen = function () {
    simSymbolFilterAuffrischen(); // der Filter selbst wirkt in simLedgerZeigen über PaperKern.ledgerFiltern
    const r = original();
    try { simZusammenfassungZeigen(); } catch (e) { const b = document.getElementById("sim-zusammenfassung"); if (b) b.textContent = "Zusammenfassung nicht verfügbar: " + e.message; }
    return r;
  };
}
document.getElementById("sim-filter-symbol").addEventListener("change", () => simLedgerZeigen());
simLedgerZeigen();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("portfolio-plus");
