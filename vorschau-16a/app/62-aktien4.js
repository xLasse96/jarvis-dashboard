// JARVIS Dashboard – Modul „aktien4“ (ab 11-10m). Aktienassistent 4.0 – ergänzt 45-aktien-ueberblick.js (Watchlist-Zusammenfassung,
// Bewertungsvergleich, Risiken, Quellen, Stichtage, Historien, Renditeversprechen) und die Aktienmodule (Analyse, Screener-Erklärungen,
// Chancen/Risiken, Indikatoren, Paper-Simulation). Rechnet keine neuen Signale:
//   - Aussagekraft je Symbol (gering / eingeschränkt / brauchbar) mit Gründen – Darstellung der Unsicherheit, keine Prognose
//   - Vergleich zweier analysierter Symbole (Kennzahlen, Stichtag, Quelle, Aussagekraft) – Einordnung, keine Empfehlung
//   - Kennzahlenerklärung per Sprache („Was bedeutet KGV?“) aus den vorhandenen Screener-Erklärungen
//   - Paper-Entwicklung aus den gemerkten Ständen (Einstandsbasis + Bargeld, Gebühren) – ausdrücklich simuliert
//   - Kennzeichnung von „Echtzeitsignalen“ in KI-Antworten (z. B. „jetzt kaufen“, „Kaufsignal“) – historische Daten sind kein Signal
// Keine Order-, Buchungs- oder Netzfunktionen; HandelsWache, Not-Aus und Order-Sperren bleiben unberührt.
const AKT4_BEGRIFFE = { kgv: "pe", "kurs-gewinn-verhältnis": "pe", peg: "peg", kuv: "kuv", "kurs-umsatz-verhältnis": "kuv", kbv: "kbv", "kurs-buchwert-verhältnis": "kbv", eigenkapitalrendite: "roe", "ek-rendite": "roe", roe: "roe", eps: "eps_ttm", "gewinn je aktie": "eps_ttm", bruttomarge: "gross_margin", betriebsmarge: "operating_margin", marktwert: "marktwert", börsenwert: "marktwert" };
const AKT4_SIGNAL = [/\bjetzt\s+(sofort\s+)?(kaufen|verkaufen|einsteigen|aussteigen)\b/i, /\b(klares|starkes|aktuelles|eindeutiges)\s+(kauf|verkaufs)signal\b/i, /\bist\s+eine?\s+(kauf|verkaufs)signal\b/i, // erklärende Texte („Kauf- und Verkaufssignal der EMA-Kreuzung“) bleiben unmarkiert
   /\b(heute|sofort)\s+(noch\s+)?(zuschlagen|kaufen)\b/i, /\bstrong\s+buy\b/i];
function aktienAussagekraft(x) {
  if (!x || !x.analysiert) return { stufe: "keine", gruende: ["noch nicht analysiert"] };
  const g = [];
  if (x.synthetisch) g.push("Testdaten");
  if (x.veraltet) g.push(x.alterStunden === null ? "Datenzeit unbekannt" : `Daten ${Math.round(x.alterStunden)} h alt`);
  if (/gering|schlecht|unbekannt/i.test(x.qualitaet)) g.push("Datenqualität " + x.qualitaet);
  if (x.blockaden) g.push(`${x.blockaden} Blockade(n)`);
  const fehlend = Object.values(x.kennzahlen || {}).filter((v) => v === null).length;
  if (fehlend >= 3) g.push(`${fehlend} von 5 Bewertungskennzahlen fehlen`);
  if (!x.stichtag) g.push("kein Stichtag der Kennzahlen");
  const stufe = x.synthetisch || g.length >= 3 ? "gering" : g.length ? "eingeschränkt" : "brauchbar";
  return { stufe, gruende: g, text: `Aussagekraft ${stufe}${g.length ? " (" + g.join(", ") + ")" : ""} – keine Prognose, kein Handelssignal.` };
}
function aktienVergleichZwei(a, b, jetzt = Date.now()) {
  const u = aktienUebersicht(jetzt), A = u.find((x) => x.symbol === String(a).toUpperCase()), B = u.find((x) => x.symbol === String(b).toUpperCase());
  if (!A || !B || !A.analysiert || !B.analysiert) return { fehler: `Für den Vergleich müssen beide Symbole in dieser Sitzung analysiert sein (${[A && A.analysiert ? "" : String(a).toUpperCase(), B && B.analysiert ? "" : String(b).toUpperCase()].filter(Boolean).join(", ")} fehlt).` };
  const zeilen = AUEB_KENNZAHLEN.map(([m, n]) => ({ kennzahl: n, a: A.kennzahlen[m], b: B.kennzahlen[m] }));
  return { a: A, b: B, zeilen, aussagekraft: [aktienAussagekraft(A), aktienAussagekraft(B)], hinweis: "Einordnung vorhandener Werte, keine Empfehlung. Kennzahlen sind branchenabhängig und beziehen sich auf den jeweiligen Stichtag." };
}
function kennzahlErklaeren(begriff) {
  const b = String(begriff || "").toLowerCase().replace(/[?.!]/g, "").trim(), k = AKT4_BEGRIFFE[b];
  const e = window.AktienScreener && window.AktienScreener.ERKLAERUNG ? window.AktienScreener.ERKLAERUNG : {};
  return k && e[k] ? e[k] : null;
}
function paperEntwicklung() {
  const s = auebLesen().staende;
  if (s.length < 2) return { verfuegbar: false, text: "Für eine Entwicklung braucht es mindestens zwei gemerkte Stände der Paper-Simulation." };
  const neu = s[0], alt = s[s.length - 1], diff = neu.gesamt - alt.gesamt, pct = alt.gesamt ? (diff / alt.gesamt) * 100 : null;
  return { verfuegbar: true, von: alt.zeit, bis: neu.zeit, diff, pct, gebuehren: neu.gebuehren, text: `Paper-Simulation ${new Date(alt.zeit).toLocaleDateString("de-DE")} → ${new Date(neu.zeit).toLocaleDateString("de-DE")}: ${diff >= 0 ? "+" : ""}${auebZahl(diff)} USD${pct === null ? "" : ` (${pct >= 0 ? "+" : ""}${auebZahl(pct, 2)} %)`} auf Basis Einstand + Bargeld, Gebühren gesamt ${auebZahl(neu.gebuehren)} USD. Simuliert, kein echtes Geld; vergangene Werte sagen nichts über künftige.` };
}
function echtzeitSignal(text) { return AKT4_SIGNAL.map((m) => (m.exec(String(text || "")) || [])[0]).filter(Boolean); }
if (typeof dialogKennzeichnen === "function") {
  const original = dialogKennzeichnen;
  dialogKennzeichnen = function (element, antwort, recherche) {
    const m = original(element, antwort, recherche), s = echtzeitSignal(antwort);
    if (s.length) { element.dataset.signal = "1"; element.setAttribute("aria-description", [element.getAttribute("aria-description"), "enthält eine Handelsaufforderung („" + s[0] + "“) – JARVIS gibt keine Echtzeitsignale; Analysen beruhen auf historischen Daten"].filter(Boolean).join("; ")); }
    return { ...m, signal: s };
  };
}
function akt4Anzeigen(jetzt = Date.now()) {
  const el = (id) => document.getElementById(id);
  if (!el("akt4-aussagekraft")) return;
  const u = aktienUebersicht(jetzt).filter((x) => x.analysiert), li = (t, k = "") => Object.assign(document.createElement("li"), { textContent: t, className: k });
  el("akt4-aussagekraft").replaceChildren(...(u.length ? u.map((x) => { const a = aktienAussagekraft(x); return li(`${x.symbol}: ${a.text}`, a.stufe === "gering" ? "wz-wichtig" : ""); }) : [li("Noch keine Analyse in dieser Sitzung.")]));
  el("akt4-paper").textContent = paperEntwicklung().text;
}
skillRegistrieren({
  name: "kennzahlen-erklaerung", // nicht „aktien…“ (feste Reihenfolge der Aktien-Skills)
  risiko: "abfrage",
  hilfeKurz: "Kennzahlen",
  beschreibung: "Kennzahl erklären, zwei Analysen vergleichen, Aussagekraft, Paper-Entwicklung (nur lesend, kein Signal)",
  beispiele: ["Was bedeutet KGV?", "Vergleiche AAPL mit MSFT", "Aussagekraft von AAPL"],
  passt: (text) => /^(was (bedeutet|ist) (das |der |die )?(kgv|peg|kuv|kbv|roe|eps|eigenkapitalrendite|ek-rendite|bruttomarge|betriebsmarge|marktwert|börsenwert|gewinn je aktie|kurs-\S+-verhältnis)|erkläre? (das |den |die )?(kgv|peg|kuv|kbv|roe|eps|eigenkapitalrendite|bruttomarge|betriebsmarge)|vergleiche? [a-z]{1,5}( mit| und) [a-z]{1,5}|aussagekraft (von |zu )?[a-z]{1,5}|wie (aussagekräftig|verlässlich|belastbar) ist [a-z]{1,5}|simulationsverlauf|entwicklung der simulation|wie hat sich (die |meine )?simulation entwickelt)$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const t = befehlNormalisieren(text);
    let m = /^(?:was (?:bedeutet|ist) (?:das |der |die )?|erkläre? (?:das |den |die )?)(.+)$/.exec(t);
    if (m) { const e = kennzahlErklaeren(m[1]); lokalAntworten(e ? `${m[1].toUpperCase()}: ${e}` : `Zu „${m[1]}“ habe ich keine Erklärung.`); return true; }
    if ((m = /^vergleiche? ([a-z]{1,5})(?: mit| und) ([a-z]{1,5})$/.exec(t))) {
      const v = aktienVergleichZwei(m[1], m[2]);
      lokalAntworten(v.fehler ? v.fehler : `${v.a.symbol} vs. ${v.b.symbol}: ` + v.zeilen.map((z) => `${z.kennzahl} ${auebZahl(z.a)} / ${auebZahl(z.b)}`).join(" · ") + `. Stichtage ${v.a.stichtag || "–"} / ${v.b.stichtag || "–"}. ${v.a.symbol}: ${v.aussagekraft[0].text} ${v.b.symbol}: ${v.aussagekraft[1].text} ${v.hinweis}`);
      return true;
    }
    if ((m = /([a-z]{1,5})$/.exec(t)) && /^(aussagekraft|wie (aussagekräftig|verlässlich|belastbar))/.test(t)) { const x = aktienUebersicht().find((y) => y.symbol === m[1].toUpperCase()); lokalAntworten(x ? `${x.symbol}: ${aktienAussagekraft(x).text}` : `${m[1].toUpperCase()} ist weder auf der Watchlist noch analysiert.`); return true; }
    lokalAntworten(paperEntwicklung().text);
    return true;
  },
});
(function akt4Einordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();
if (typeof auebAnzeigen === "function") {
  const original = auebAnzeigen;
  auebAnzeigen = function (...a) { const r = original.apply(this, a); try { akt4Anzeigen(...a); } catch (e) { /* Zusatz */ } return r; };
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("aktien4");
