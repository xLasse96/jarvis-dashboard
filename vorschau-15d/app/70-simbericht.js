// JARVIS Dashboard – Modul „simbericht“ (ab 11-11e). Aktien und Paper-Portfolio – ergänzt 30-portfolio-plus.js (Zusammenfassung,
// Gebühren, realisierte/nicht realisierte Ergebnisse, Ledger-Filter), 05 (Ledger als CSV), 08/29 (Watchlist-Suche, Vergleich, Meta),
// 45/62 (Überblick, Aussagekraft, Konzentration):
//   - Simulationsbericht per Sprache/Chat: „Wie läuft meine Simulation?“, „Simulationsübersicht“ – Gesamtwert gegenüber Startkapital,
//     realisiert, nicht realisiert (nur mit Kurs aus einer Analyse, Testdaten gekennzeichnet), Gebühren, Cash-Quote, größte Position,
//     nicht bewertbare Positionen. Ausdrücklich simuliert, keine Prognose; keine Buchung, keine Order, keine Anfrage.
function simBerichtText() {
  if (typeof SIM === "undefined" || !SIM.bereit) return "Die Paper-Simulation ist noch nicht geladen.";
  if (SIM.beschaedigt || SIM.dbFehler) return "Die Paper-Simulation ist beschädigt oder nicht lesbar – im Trading-Reiter prüfen. Es wurde nichts geändert.";
  const z = typeof simZusammenfassung === "function" ? simZusammenfassung(SIM.portfolio, typeof APROFIL !== "undefined" ? APROFIL.analysen || {} : {}) : null;
  if (!z) return "Die Paper-Simulation enthält noch kein Portfolio – im Reiter „Trading“ unter „US-Aktien-Simulation“ mit Spielgeld beginnen. Es wurde nichts geändert."; // ab 11-12e: vorher nur „Keine Simulationsdaten.“
  const usd = (x) => (Number.isFinite(x) ? x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD" : "–");
  const diff = Number.isFinite(z.startkapital) ? z.gesamt - z.startkapital : null;
  const k = typeof paperKonzentration === "function" ? paperKonzentration() : { verfuegbar: false };
  const test = z.positionen.filter((p) => p.kurs_quelle === "synthetische Testdaten").map((p) => p.symbol);
  return [`Paper-Simulation (Spielgeld): Gesamtwert ${usd(z.gesamt)}` + (diff === null ? "" : ` – ${diff >= 0 ? "+" : ""}${usd(diff)} gegenüber dem Startkapital ${usd(z.startkapital)}`) + ".",
    `Realisiert ${usd(z.realisiert)}` + (z.unrealisiert === null ? ", nicht realisiert nicht bewertbar (kein Kurs aus einer Analyse dieser Sitzung)" : `, nicht realisiert ${usd(z.unrealisiert)}`) + `; Gebühren ${usd(z.gebuehren.gesamt)}; Cash-Quote ${z.cash_quote_pct === null ? "–" : z.cash_quote_pct.toLocaleString("de-DE") + " %"}.`,
    z.positionen.length ? `${z.positionen.length} Position(en)` + (k.verfuegbar && k.groesste ? `, größte ${k.groesste.symbol} mit ${auebZahl(k.groesste.anteil, 1)} % nach Einstand` : "") + (z.nicht_bewertet.length ? `; ohne Kurs: ${z.nicht_bewertet.join(", ")}` : "") + (test.length ? `; bewertet mit Testdaten: ${test.join(", ")}` : "") + "." : "Keine offenen Positionen.",
    `${z.buchungen.ausgefuehrt} ausgeführte Buchung(en)${z.buchungen.blockiert ? `, ${z.buchungen.blockiert} blockiert` : ""}. Simuliert – vergangene Werte sagen nichts über künftige.`].join(" ");
}
skillRegistrieren({
  name: "simulation-bericht", risiko: "abfrage", hilfeKurz: "Simulationsbericht",
  beschreibung: "Paper-Simulation zusammenfassen (nur lesend, Spielgeld)", beispiele: ["Wie läuft meine Simulation?"],
  passt: (text) => /^(wie läuft (meine |die )?simulation|simulationsübersicht|simulationsbericht|zusammenfassung (der |meiner )?simulation|wie steht (meine |die )?simulation)$/.test(befehlNormalisieren(text)),
  aktion: async () => { lokalAntworten(simBerichtText()); return true; },
});
(function simbEinordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("simbericht");
