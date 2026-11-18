// JARVIS Dashboard – Modul „aktien-ueberblick“ (ab 11-09m). Aktienassistent 3.0: bündelt, was die vorhandenen Aktienmodule schon
// liefern (Analyse, Kennzahlen, Datenqualität, Chancen/Risiken, Paper-Simulation), in einer Übersicht – rechnet keine neuen Signale:
//   - Watchlist-Zusammenfassung je Symbol (analysiert ja/nein, Quelle, Stichtag, Alter, Testdaten, Datenqualität, Chancen/Risiken)
//   - Bewertungsvergleich (KGV, PEG, KUV, KBV, Eigenkapitalrendite) mit Stichtag; fehlende Werte als „–“
//   - Risikozusammenfassung (Testdaten, veraltete Daten, Blockaden, Konzentration im Paper-Portfolio nach Einstandswert, Gebühren)
//   - Quellenübersicht, Analysehistorie und Simulationshistorie (Stände) – gespeichert in „jarvis-aktien-historie“
//   - Prüfung auf Renditeversprechen in KI-Antworten (Kennzeichnung, Text unverändert)
// Synthetische oder ältere Daten ergeben nie ein „Signal“. Keine Order-, Paper-Buchungs- oder Netzfunktionen.
const AUEB = { schluessel: "jarvis-aktien-historie", maxAnalysen: 50, maxStaende: 60, veraltetStunden: 24, konzentrationPct: 40 };
const AUEB_KENNZAHLEN = [["pe", "KGV"], ["peg", "PEG"], ["kuv", "KUV"], ["kbv", "KBV"], ["roe", "EK-Rendite %"]];
const RENDITE_MUSTER = [/garantiert\w*\s+(gewinn|rendite|ertrag)/i, /(sichere?|sicheren|risikolose?n?)\s+(gewinn|rendite|anlage|ertrag)/i, /\bohne\s+risiko\b/i, /\bverdoppel\w*\s+(dein|ihr|das)\s+(geld|kapital|depot)/i,
  /\b(wird|werden)\s+(sicher|garantiert|bestimmt)\s+(steigen|zulegen|gewinnen)/i, /\bkaufen sie (jetzt|sofort)\b|\bjetzt (sofort )?kaufen\b/i, /\b\d+\s?%\s+(rendite|gewinn)\s+(garantiert|sicher)/i, /\bkann nicht (verlieren|fallen)\b/i];
function renditeVersprechen(text) { return RENDITE_MUSTER.map((m) => (m.exec(String(text || "")) || [])[0]).filter(Boolean); }
function auebLesen() {
  const d = speicherJsonLesen(AUEB.schluessel, (x) => istObjekt(x) && x.art === "jarvis-aktien-historie" && Array.isArray(x.analysen) && Array.isArray(x.staende));
  return d ? { analysen: d.analysen.filter((a) => a && typeof a.symbol === "string"), staende: d.staende.filter((s) => s && typeof s.zeit === "string") } : { analysen: [], staende: [] };
}
function auebSchreiben(s) {
  if (speicherBeschaedigt(AUEB.schluessel)) return false;
  try { localStorage.setItem(AUEB.schluessel, JSON.stringify({ art: "jarvis-aktien-historie", version: 1, analysen: s.analysen.slice(0, AUEB.maxAnalysen), staende: s.staende.slice(0, AUEB.maxStaende) })); return true; } catch (e) { return false; }
}
const auebZahl = (x, n = 2) => (typeof x === "number" && Number.isFinite(x) ? x.toLocaleString("de-DE", { maximumFractionDigits: n }) : "–");
function auebAlterStunden(zeit, jetzt = Date.now()) { const t = Date.parse(zeit); return Number.isFinite(t) ? (jetzt - t) / 3600000 : null; }
// Eine Zeile je Symbol (Watchlist ∪ analysiert)
function aktienUebersicht(jetzt = Date.now()) {
  const wl = typeof wlLaden === "function" ? (wlLaden().eintraege || []).map((e) => e.symbol) : [];
  const an = typeof APROFIL !== "undefined" ? APROFIL.analysen || {} : {};
  const symbole = [...new Set([...wl, ...Object.keys(an)])].sort();
  return symbole.map((s) => {
    const a = an[s];
    if (!a) return { symbol: s, analysiert: false, watchlist: wl.includes(s) };
    let r = null, dq = null;
    try { r = a.dispatch && a.dispatch.ergebnisse ? (a.dispatch.ergebnisse.find((x) => x.modul === "analyse") || {}).daten || null : null; } catch (e) { r = null; }
    try { dq = r && typeof datenqualitaet === "function" ? datenqualitaet(r) : null; } catch (e) { dq = null; }
    const k = istObjekt(a.kennzahlen) ? a.kennzahlen : {};
    const alter = auebAlterStunden(a.datenzeit, jetzt), synth = Boolean(a.synthetisch);
    const cr = r && r.chancen_risiken ? r.chancen_risiken : null;
    return { symbol: s, analysiert: true, watchlist: wl.includes(s), quelle: a.quelle && a.quelle.name ? a.quelle.name : String(a.quelle || "unbekannt"), synthetisch: synth, datenzeit: a.datenzeit || null,
      alterStunden: alter, veraltet: alter === null || alter > AUEB.veraltetStunden, status: a.status || (r && r.blockaden && r.blockaden.length ? "eingeschränkt" : "ok"),
      qualitaet: dq ? `${dq.stufe}${Number.isFinite(dq.abdeckung_pct) ? ` (${Math.round(dq.abdeckung_pct)} % belegt)` : ""}` : "unbekannt",
      dafuer: cr && Array.isArray(cr.dafuer) ? cr.dafuer.length : null, dagegen: cr && Array.isArray(cr.dagegen) ? cr.dagegen.length : null, offen: cr && Array.isArray(cr.offen) ? cr.offen.length : null,
      blockaden: r && Array.isArray(r.blockaden) ? r.blockaden.length : 0, kennzahlen: Object.fromEntries(AUEB_KENNZAHLEN.map(([m]) => [m, typeof k[m] === "number" && Number.isFinite(k[m]) ? k[m] : null])),
      stichtag: k.period_end || null,
      signal: synth ? "kein Signal – Testdaten" : alter === null || alter > AUEB.veraltetStunden ? "kein aktuelles Signal – Daten älter als 24 h" : "nur Einordnung, kein Handelssignal" };
  });
}
// Konzentration im Paper-Portfolio nach Einstandswert (kein Marktpreis nötig, klar so benannt)
function paperKonzentration() {
  const p = typeof SIM !== "undefined" && SIM.bereit && !SIM.beschaedigt && !SIM.dbFehler ? SIM.portfolio : null;
  if (!p || !istObjekt(p.positionen)) return { verfuegbar: false };
  const pos = Object.entries(p.positionen).map(([s, x]) => ({ symbol: s, wert: Number(x.menge) * Number(x.einstand) })).filter((x) => Number.isFinite(x.wert) && x.wert > 0);
  const investiert = pos.reduce((a, x) => a + x.wert, 0), bar = Number(p.bargeld) || 0, gesamt = investiert + bar;
  const anteile = pos.map((x) => ({ ...x, anteil: gesamt ? (x.wert / gesamt) * 100 : 0 })).sort((a, b) => b.anteil - a.anteil);
  const gebuehren = (p.ledger || []).filter((l) => l.zustand === "gefuellt").reduce((a, l) => a + (Number(l.gebuehr) || 0), 0);
  return { verfuegbar: true, positionen: anteile, investiert, bargeld: bar, gesamt, gebuehren, buchungen: (p.ledger || []).length, groesste: anteile[0] || null };
}
function aktienRisiken(jetzt = Date.now()) {
  const u = aktienUebersicht(jetzt).filter((x) => x.analysiert), k = paperKonzentration(), r = [];
  const synth = u.filter((x) => x.synthetisch).map((x) => x.symbol), alt = u.filter((x) => !x.synthetisch && x.veraltet).map((x) => x.symbol), block = u.filter((x) => x.blockaden).map((x) => x.symbol);
  if (synth.length) r.push(`Testdaten (keine Entscheidungsgrundlage): ${synth.join(", ")}`);
  if (alt.length) r.push(`Daten älter als ${AUEB.veraltetStunden} h: ${alt.join(", ")}`);
  if (block.length) r.push(`Analyse eingeschränkt (Blockaden): ${block.join(", ")}`);
  const ohne = u.filter((x) => Object.values(x.kennzahlen).every((v) => v === null)).map((x) => x.symbol);
  if (ohne.length) r.push(`ohne Bewertungskennzahlen: ${ohne.join(", ")}`);
  if (k.verfuegbar && k.groesste && k.groesste.anteil > AUEB.konzentrationPct) r.push(`Paper-Portfolio konzentriert: ${k.groesste.symbol} ${auebZahl(k.groesste.anteil, 1)} % nach Einstandswert (Schwelle ${AUEB.konzentrationPct} %)`);
  if (k.verfuegbar && k.investiert > 0 && k.gebuehren / k.investiert > 0.01) r.push(`Gebühren ${auebZahl((k.gebuehren / k.investiert) * 100, 2)} % des investierten Einstandswerts`);
  return r;
}
function aktienQuellen() {
  const m = new Map();
  for (const x of aktienUebersicht().filter((y) => y.analysiert)) { const e = m.get(x.quelle) || { quelle: x.quelle, synthetisch: x.synthetisch, symbole: [] }; e.symbole.push(x.symbol); m.set(x.quelle, e); }
  return [...m.values()];
}
// Historie: jede angezeigte Analyse einmal (Symbol + Datenzeit); Stände der Paper-Simulation auf Klick bzw. einmal am Tag
function auebAnalyseMerken(r) {
  if (!r || typeof r.symbol !== "string") return false;
  const s = auebLesen(), schl = r.symbol + "|" + (r.datenzeit || "");
  if (s.analysen.some((a) => a.symbol + "|" + (a.datenzeit || "") === schl)) return false;
  s.analysen.unshift({ symbol: r.symbol, zeit: new Date().toISOString(), datenzeit: r.datenzeit || null, quelle: r.quelle && r.quelle.name ? r.quelle.name : "unbekannt", synthetisch: Boolean(r.quelle && r.quelle.synthetisch),
    blockaden: Array.isArray(r.blockaden) ? r.blockaden.length : 0, dafuer: r.chancen_risiken && Array.isArray(r.chancen_risiken.dafuer) ? r.chancen_risiken.dafuer.length : null, dagegen: r.chancen_risiken && Array.isArray(r.chancen_risiken.dagegen) ? r.chancen_risiken.dagegen.length : null });
  return auebSchreiben(s);
}
function auebStandMerken(grund = "manuell") {
  const k = paperKonzentration();
  if (!k.verfuegbar) return { fehler: "Paper-Simulation nicht geladen." };
  const s = auebLesen();
  s.staende.unshift({ zeit: new Date().toISOString(), grund, bargeld: k.bargeld, investiert: k.investiert, gesamt: k.gesamt, positionen: k.positionen.length, buchungen: k.buchungen, gebuehren: k.gebuehren });
  return auebSchreiben(s) ? { stand: s.staende[0] } : { fehler: "Nicht gespeichert: " + SPEICHER_SCHADEN_TEXT };
}
if (typeof ablaufZeigen === "function") {
  const original = ablaufZeigen;
  ablaufZeigen = function (r) { const x = original(r); try { auebAnalyseMerken(r); auebAnzeigen(); } catch (e) { /* Übersicht ist Zusatz */ } return x; };
}
// Renditeversprechen in KI-Antworten kennzeichnen (Merkmal, Text unverändert) – ergänzt die Kennzeichnung aus 09i
if (typeof dialogKennzeichnen === "function") {
  const original = dialogKennzeichnen;
  dialogKennzeichnen = function (element, antwort, recherche) {
    const m = original(element, antwort, recherche), r = renditeVersprechen(antwort);
    if (r.length) { element.dataset.rendite = "1"; element.setAttribute("aria-description", [element.getAttribute("aria-description"), "enthält ein Renditeversprechen („" + r[0] + "“) – keine Anlageberatung, Gewinne sind nie sicher"].filter(Boolean).join("; ")); }
    return { ...m, rendite: r };
  };
}
// ---------- Anzeige ----------
function auebAnzeigen(jetzt = Date.now()) {
  const el = (id) => document.getElementById(id);
  if (!el("aueb-liste")) return;
  const u = aktienUebersicht(jetzt);
  const zeit = (x) => (x ? new Date(x).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–");
  el("aueb-liste").replaceChildren(...(u.length ? u.map((x) => Object.assign(document.createElement("li"), { textContent: x.analysiert
    ? `${x.symbol}${x.watchlist ? " (Watchlist)" : ""}: ${x.quelle}${x.synthetisch ? " – Testdaten" : ""} · Stand ${zeit(x.datenzeit)} · Datenqualität ${x.qualitaet} · dafür ${x.dafuer ?? "–"} / dagegen ${x.dagegen ?? "–"} / offen ${x.offen ?? "–"}${x.blockaden ? ` · ${x.blockaden} Blockade(n)` : ""} · ${x.signal}`
    : `${x.symbol} (Watchlist): noch nicht analysiert` })) : [Object.assign(document.createElement("li"), { textContent: "Keine Watchlist-Einträge und keine Analysen in dieser Sitzung." })]));
  // als Liste je Symbol (passt auch auf 320 px; eine breite Tabelle würde über den Rand laufen)
  const an = u.filter((x) => x.analysiert), ul = Object.assign(document.createElement("ul"), { className: "statusliste" });
  ul.setAttribute("aria-label", "Bewertungsvergleich");
  ul.append(...an.map((x) => Object.assign(document.createElement("li"), { textContent: `${x.symbol}${x.synthetisch ? " (Test)" : ""}: ` + AUEB_KENNZAHLEN.map(([m, n]) => `${n} ${auebZahl(x.kennzahlen[m])}`).join(" · ") + ` · Stichtag ${x.stichtag || "–"}` })));
  el("aueb-bewertung").replaceChildren(an.length ? ul : Object.assign(document.createElement("p"), { className: "klein", textContent: "Noch keine Analyse – erst „US-Aktie analysieren“." }));
  const ri = aktienRisiken(jetzt);
  el("aueb-risiken").replaceChildren(...(ri.length ? ri : ["Keine Auffälligkeiten erkannt (das ist keine Aussage über künftige Kurse)."]).map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  const q = aktienQuellen();
  el("aueb-quellen").replaceChildren(...(q.length ? q.map((x) => `${x.quelle}${x.synthetisch ? " (synthetische Testdaten)" : ""}: ${x.symbole.join(", ")}`) : ["Noch keine Quellen."]).map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  const k = paperKonzentration();
  el("aueb-paper").textContent = !k.verfuegbar ? "Paper-Simulation nicht geladen." : `Paper-Portfolio: ${k.positionen.length} Position(en), investiert ${auebZahl(k.investiert)} USD (Einstand), Bargeld ${auebZahl(k.bargeld)} USD, Gebühren gesamt ${auebZahl(k.gebuehren)} USD, ${k.buchungen} Buchung(en)` + (k.groesste ? ` · größte Position ${k.groesste.symbol} ${auebZahl(k.groesste.anteil, 1)} %` : "") + ". Simuliert, kein echtes Geld.";
  const h = auebLesen();
  el("aueb-historie").replaceChildren(...(h.analysen.length ? h.analysen.slice(0, 10).map((a) => `${zeit(a.zeit)} · ${a.symbol} · ${a.quelle}${a.synthetisch ? " (Test)" : ""} · Daten ${zeit(a.datenzeit)} · dafür ${a.dafuer ?? "–"} / dagegen ${a.dagegen ?? "–"}`) : ["Noch keine Analyse gemerkt."]).map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  el("aueb-staende").replaceChildren(...(h.staende.length ? h.staende.slice(0, 10).map((s) => `${zeit(s.zeit)} · gesamt ${auebZahl(s.gesamt)} USD (Einstand + Bargeld) · ${s.positionen} Position(en) · Gebühren ${auebZahl(s.gebuehren)} USD · ${s.grund}`) : ["Noch kein Stand gemerkt."]).map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  if (speicherBeschaedigt(AUEB.schluessel)) el("aueb-meldung").textContent = "Aktien-Historie beschädigt – " + SPEICHER_SCHADEN_TEXT;
}
skillRegistrieren({
  name: "ueberblick-aktien", // nicht „aktien…“: die Aktien-Skills haben eine feste, geprüfte Reihenfolge
  risiko: "abfrage",
  hilfeKurz: "Aktienüberblick",
  beschreibung: "Überblick über Watchlist, Analysen und Paper-Portfolio (nur lesend, kein Signal)",
  beispiele: ["Aktienüberblick", "Wie steht meine Watchlist?"],
  passt: (text) => /^(aktien ?überblick|aktienueberblick|aktien-überblick|überblick aktien|wie steht (es um )?meine (aktien-)?watchlist|zusammenfassung (der |meiner )?watchlist)$/.test(befehlNormalisieren(text)),
  aktion: async () => {
    const u = aktienUebersicht(), an = u.filter((x) => x.analysiert), ri = aktienRisiken();
    lokalAntworten(!u.length ? "Noch keine Watchlist und keine Analyse, Sir." : `${u.length} Symbol(e), ${an.length} in dieser Sitzung analysiert` + (an.length ? ": " + an.map((x) => `${x.symbol} (${x.synthetisch ? "Testdaten" : x.quelle}, dafür ${x.dafuer ?? "–"}/dagegen ${x.dagegen ?? "–"})`).join(", ") : "") + "."
      + (ri.length ? " Zu beachten: " + ri.join("; ") + "." : "") + " Das ist eine Einordnung, kein Handelssignal und keine Anlageberatung.");
    return true;
  },
});
(function auebEinordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();
(function auebEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("aueb-liste")) return;
  el("aueb-aktualisieren").addEventListener("click", () => auebAnzeigen());
  el("aueb-stand").addEventListener("click", () => { const r = auebStandMerken("manuell"); el("aueb-meldung").textContent = r.fehler || "Stand der Paper-Simulation gemerkt."; auebAnzeigen(); });
  el("aueb-details").addEventListener("toggle", () => { if (el("aueb-details").open) auebAnzeigen(); });
  auebAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("aktien-ueberblick");
