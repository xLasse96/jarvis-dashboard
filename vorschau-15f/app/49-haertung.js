// JARVIS Dashboard – Modul „haertung“ (ab 11-09q). Härtungen aus dem Sicherheitsaudit der 09er-Serie (docs/SICHERHEIT_09.md):
//   - Order-Wörter („kaufe …“, „verkaufe …“, „order …“) sind in Workflows und mehrteiligen Aufträgen ausdrücklich verboten. Vorher
//     wurden sie angenommen, weil der Aktien-Skill sie als Abfrage einstuft – ausgeführt hätte er nur seine Absage („Orders gibt es per
//     Sprache nicht“), aber ein Ablauf mit Kaufbefehl ist irreführend und darf gar nicht erst entstehen.
// Keine Anfrage, kein Speicher.
function haertungOrderWort(text) {
  try { return Boolean(window.AktienAssistent && typeof window.AktienAssistent.intentErkennen === "function" && window.AktienAssistent.intentErkennen(String(text || "")).intent === "order_abgelehnt"); } catch (e) { return false; }
}
if (typeof routinenSchrittPruefen === "function") {
  const original = routinenSchrittPruefen;
  routinenSchrittPruefen = function (befehl) {
    const z = typeof wfSchrittZerlegen === "function" ? wfSchrittZerlegen(befehl) : { befehl };
    if (haertungOrderWort(z.befehl || befehl)) return { fehler: "Orders (Kauf/Verkauf) sind in Workflows nie möglich – auch keine Paper-Buchung" };
    return original(befehl);
  };
}
if (typeof auftragSchrittEinstufen === "function") {
  const original = auftragSchrittEinstufen;
  auftragSchrittEinstufen = function (text) {
    const e = original(text);
    if (e.skill && haertungOrderWort(text)) return { ...e, art: "blockiert", grund: "Orders (Kauf/Verkauf) nie per Auftrag" };
    return e;
  };
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("haertung");
