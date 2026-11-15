// JARVIS Dashboard – Modul „entscheidung“ (ab 11-07m). Entscheidungshilfe zur Aktienanalyse – ordnet nur vorhandene Ergebnisse,
// entscheidet nichts und bucht nichts:
//   - Fakten (belegte Werte mit Herkunft) getrennt von Einordnungen (Deutung, Chartlage, Stärken/Schwächen)
//   - Argumente dafür / dagegen / offen (aus Chancen-Risiken und Stärken-Schwächen), Unsicherheiten und fehlende Grundlagen
//   - Datenqualität als Stufe mit Gründen (keine Punktzahl): synthetisch, veraltet, Abdeckung der Kennzahlen, Widersprüche
//   - Gewinnschwelle: nötiger Kursanstieg, um Gebühr und Slippage für Kauf und Verkauf zu decken (Annahmen der Simulation)
//   - Analysehistorie dieser Sitzung (nur Arbeitsspeicher) und Vergleich zweier Zeitpunkte inklusive geänderter Annahmen
// Keine Order, keine Freigabe, keine Anfrage. Handelssperren bleiben unberührt.
const ENTSCHEIDUNG = { verlauf: [], max: 20, nummer: 0 };
const ENT_KENNZAHLEN = ["kurs", "pe", "peg", "kuv", "kbv", "roe", "revenue_growth_yoy", "operating_margin", "net_margin", "perf_3m", "rsi14", "volatilitaet_20t"];
const ENT_PFLICHT = ["kurs", "pe", "roe", "revenue_growth_yoy", "operating_margin", "rsi14"];
// Kursanstieg in %, der Kauf- und Verkaufskosten deckt: (1+s)(1+g) / ((1−s)(1−g)) − 1
function gewinnschwelle(gebuehrPct, slippagePct) {
  const g = Number(gebuehrPct) / 100, s = Number(slippagePct) / 100;
  if (!Number.isFinite(g) || !Number.isFinite(s) || g < 0 || s < 0 || g >= 0.5 || s >= 0.5) return null;
  return Math.round((((1 + s) * (1 + g)) / ((1 - s) * (1 - g)) - 1) * 100000) / 1000;
}
function entKennzahlen(r) {
  const sch = (r && r.schritte) || [];
  const s = sch.find((x) => x.id === "screener-fundamental") || sch.find((x) => x.id === "screener-technisch");
  return (s && s.details && s.details.kennzahlen) || {};
}
function entTechnik(r) {
  const t = ((r && r.schritte) || []).find((x) => x.id === "technik");
  const sig = (t && t.details && Array.isArray(t.details.signale)) ? t.details.signale : [];
  const trend = sig.find((x) => x.art === "trend");
  return { punkte: sig.length ? sig.reduce((a, x) => a + x.punkte, 0) : null, trend: trend ? (trend.punkte > 0 ? "aufwärts" : "abwärts") : sig.length ? "uneinheitlich" : null };
}
// Datenqualität: Stufe + Gründe. Synthetisch ist nie eine Entscheidungsgrundlage.
function datenqualitaet(r, k = entKennzahlen(r)) {
  const gruende = [], q = (r && r.quelle) || {};
  const da = ENT_PFLICHT.filter((m) => Number.isFinite(k[m]));
  const abdeckung = Math.round((da.length / ENT_PFLICHT.length) * 100);
  const widersprueche = ((r && r.widersprueche) || []).length + (k._widerspruch ? 1 : 0);
  if (q.synthetisch) gruende.push("synthetische Testdaten – keine echten Kurse");
  if (r && r.frisch === false) gruende.push("Kursdaten veraltet");
  gruende.push(`${da.length} von ${ENT_PFLICHT.length} Kernkennzahlen vorhanden`);
  if (widersprueche) gruende.push(`${widersprueche} widersprüchliche Signale`);
  if ((k._hinweise || []).some((h) => /veraltet|enden am/.test(h))) gruende.push("SEC-Zahlen veraltet");
  const stufe = q.synthetisch ? "nur Testdaten – keine Entscheidungsgrundlage" : r && r.frisch === false ? "eingeschränkt (veraltet)" : abdeckung >= 80 && !widersprueche ? "gut" : abdeckung >= 40 ? "eingeschränkt" : "unzureichend";
  return { stufe, abdeckung_pct: abdeckung, fehlend: ENT_PFLICHT.filter((m) => !Number.isFinite(k[m])), gruende };
}
function entSchnappschuss(r, annahmen) {
  const k = entKennzahlen(r), t = entTechnik(r), q = (r && r.quelle) || {}, c = (r && r.chancen_risiken) || { dafuer: [], dagegen: [], offen: [] };
  return { nr: ++ENTSCHEIDUNG.nummer, zeit: Date.now(), symbol: r.symbol, quelle: q.name || "?", synthetisch: Boolean(q.synthetisch), frisch: r.frisch === undefined ? null : r.frisch, datenzeit: r.datenzeit || null,
    kennzahlen: Object.fromEntries(ENT_KENNZAHLEN.map((m) => [m, Number.isFinite(k[m]) ? k[m] : null])), punkte: t.punkte, trend: t.trend,
    widersprueche: (r.widersprueche || []).length, dafuer: c.dafuer.length, dagegen: c.dagegen.length, offen: c.offen.length, annahmen: { ...annahmen } };
}
function entAnnahmen() {
  const a = typeof SIM !== "undefined" && SIM.annahmen ? SIM.annahmen : {}, s = typeof risikoSchwellenLesen === "function" ? risikoSchwellenLesen() : {};
  const budget = document.getElementById("profil-budget");
  return { gebuehrPct: Number.isFinite(a.gebuehrPct) ? a.gebuehrPct : null, slippagePct: Number.isFinite(a.slippagePct) ? a.slippagePct : null, annahmen_quelle: a.quelle || null,
    schwelle_position_pct: Number.isFinite(s.position) ? s.position : null, schwelle_sektor_pct: Number.isFinite(s.sektor) ? s.sektor : null, budget: budget && budget.value ? Number(budget.value) : null };
}
// Unterschiede zweier Schnappschüsse: Werte und Annahmen getrennt
function entVergleich(a, b) {
  if (!a || !b) return { fehler: "Zwei Analysezeitpunkte wählen." };
  const diff = (x, y) => Object.keys({ ...x, ...y }).filter((f) => !(x[f] === y[f] || (Number.isFinite(x[f]) && Number.isFinite(y[f]) && Math.abs(x[f] - y[f]) < 1e-9))).map((f) => ({ feld: f, vorher: x[f] ?? null, nachher: y[f] ?? null }));
  const kopf = (s) => ({ symbol: s.symbol, quelle: s.quelle, synthetisch: s.synthetisch, frisch: s.frisch, datenzeit: s.datenzeit, punkte: s.punkte, trend: s.trend, widersprueche: s.widersprueche, dafuer: s.dafuer, dagegen: s.dagegen });
  return { werte: [...diff(kopf(a), kopf(b)), ...diff(a.kennzahlen, b.kennzahlen)], annahmen: diff(a.annahmen, b.annahmen), anderesSymbol: a.symbol !== b.symbol };
}
function entscheidungZeigen(r) {
  const box = document.getElementById("ablauf-entscheidung");
  if (!box) return null;
  // ab Trader produktiv (D-2): ohne gültiges Symbol nicht die Entscheidungshilfe des vorigen Laufs stehen lassen
  if (!r || !r.symbol) { box.textContent = "Keine Entscheidungshilfe – kein gültiges Symbol analysiert."; return null; }
  const k = entKennzahlen(r), dq = datenqualitaet(r, k), an = entAnnahmen();
  const S = window.AktienScreener, ue = S && S.kennzahlenUebersicht ? S.kennzahlenUebersicht(k) : [], ss = S && S.staerkenSchwaechen ? S.staerkenSchwaechen(k) : { staerken: [], schwaechen: [], widersprueche: [] };
  const c = r.chancen_risiken || { dafuer: [], dagegen: [], offen: [] };
  const zahl = (v) => (Number.isFinite(v) ? v.toLocaleString("de-DE", { maximumFractionDigits: 2 }) : "–");
  const fakten = ue.filter((z) => z.wert !== null).map((z) => `${z.name}: ${zahl(z.wert)} (${z.quelle}${z.stichtag ? ", Stand " + z.stichtag : ""}${z.status !== "ok" ? ", " + z.status : ""})`);
  // nur aus diesem Lauf (r) – nie aus der Anzeige, die noch einen früheren Lauf zeigen könnte
  const t = entTechnik(r);
  const deutung = [...ue.filter((z) => z.deutung).map((z) => `${z.name}: ${z.deutung}`), ...(t.trend ? [`Trend laut Chart-Scanner: ${t.trend} (${t.punkte > 0 ? "+" : ""}${t.punkte} Punkte, nur Einordnung)`] : [])];
  const dafuer = [...c.dafuer.map((x) => x.text + " – " + x.quelle), ...ss.staerken.map((x) => x.text + " – " + x.quelle)];
  const dagegen = [...c.dagegen.map((x) => x.text + " – " + x.quelle), ...ss.schwaechen.map((x) => x.text + " – " + x.quelle)];
  const unsicher = [...c.offen.map((x) => x.text + " – " + x.quelle), ...dq.fehlend.map((m) => `fehlende Grundlage: ${(S && S.NAMEN && S.NAMEN[m]) || m}`), ...(r.widersprueche || []).map((x) => "Widerspruch: " + x.text), ...ss.widersprueche.map((x) => "Widerspruch: " + x)];
  const gs = gewinnschwelle(an.gebuehrPct, an.slippagePct);
  const liste = (titel, art, xs) => [wzKnoten("h4", { text: `${titel} (${xs.length})` }), wzKnoten("ul", { "data-art": art }, ...(xs.length ? xs : ["keine"]).map((t) => wzKnoten("li", { text: t })))];
  box.replaceChildren(
    wzKnoten("p", { "data-teil": "qualitaet", klasse: dq.stufe === "gut" ? "" : "wz-wichtig", text: `Datenqualität: ${dq.stufe} – ${dq.gruende.join(" · ")}.` }),
    ...liste("Fakten (belegte Werte mit Herkunft)", "fakten", fakten),
    ...liste("Einordnungen (Deutung, keine Tatsache)", "einordnung", deutung),
    ...liste("Was dafür spricht", "dafuer", dafuer),
    ...liste("Was dagegen spricht", "dagegen", dagegen),
    ...liste("Unsicherheiten und fehlende Grundlagen", "unsicher", unsicher),
    wzKnoten("p", { "data-teil": "gewinnschwelle", klasse: "klein", text: gs === null ? "Gewinnschwelle: nicht berechenbar (Gebühr/Slippage unbekannt)." : `Gewinnschwelle: Der Kurs muss nach dem Kauf um mindestens ${gs.toLocaleString("de-DE", { maximumFractionDigits: 3 })} % steigen, um Gebühr (${an.gebuehrPct.toLocaleString("de-DE", { maximumFractionDigits: 3 })} %) und Slippage (${an.slippagePct.toLocaleString("de-DE", { maximumFractionDigits: 3 })} %) für Kauf und Verkauf zu decken – Annahme: ${an.annahmen_quelle || "unbekannt"}.` }),
    wzKnoten("p", { klasse: "klein", text: "Entscheidungshilfe ordnet vorhandene Ergebnisse – keine Empfehlung, keine Prognose, keine Order. Buchungen gibt es nur im Paper-Vorschlag mit ausdrücklicher Bestätigung; echte Orders sind gesperrt." }));
  ENTSCHEIDUNG.verlauf = [entSchnappschuss(r, an), ...ENTSCHEIDUNG.verlauf].slice(0, ENTSCHEIDUNG.max);
  entVerlaufZeigen();
  return { dq, fakten, deutung, dafuer, dagegen, unsicher, gewinnschwelle: gs };
}
// ab Analyseauftrag 1311: Systemeinschätzung „Kaufkandidat“ / „Kein Kaufkandidat“ / „Keine belastbare Einschätzung möglich“ aus den
// Ergebnissen dieses Laufs – Kriterien G1–G4 (Grundlage) und B1–B4 (Bewertung) wie in docs/ANALYSE_EINSCHAETZUNG_14I.md; neue Kennzahlen
// oder Handelsregeln gibt es nicht. Fehlende oder unbekannte Daten führen nie zu „Kaufkandidat“. Bucht nichts, erstellt keinen Vorschlag.
const EINSCHAETZUNG = { kauf: "Kaufkandidat", kein: "Kein Kaufkandidat", keine: "Keine belastbare Einschätzung möglich" };
// ab 14n (AJ2): Regeln der Screener-Vorlage „fundamental“ direkt aus aktien/screener.js VORLAGEN – Erklärung, Sollwerte und Rechnung können
// nicht auseinanderlaufen (14j–14m nannten hier fälschlich die Regeln der Vorlage „kombiniert“)
const EIN_OPS = { ">=": "≥", "<=": "≤", ">": ">", "<": "<", "==": "=" };
function einFundamental() {
  const S = window.AktienScreener, v = S && S.VORLAGEN && S.VORLAGEN.fundamental;
  return v ? { name: String(v.name).replace(/\s*\(.*\)\s*$/, ""), rules: v.rules } : { name: "Wachsend, profitabel (Vorlage nicht geladen)", rules: [] };
}
function einRegelText(rule, wert, mitWert = true) {
  const N = (window.AktienScreener && window.AktienScreener.NAMEN) || {}, roh = N[rule.metric] || rule.metric, e = / %$/.test(roh) ? " %" : "", name = roh.replace(/ %$/, "");
  const z = (x) => Number(x).toLocaleString("de-DE", { maximumFractionDigits: 2 });
  const soll = rule.op === "between" ? `zwischen ${z(rule.value[0])} und ${z(rule.value[1])}${e}` : `${EIN_OPS[rule.op] || rule.op} ${z(rule.value)}${e}`;
  return mitWert ? `${name} ${Number.isFinite(wert) ? z(wert) + e : "fehlt"} (Soll ${soll})` : `${name} ${soll}`;
}
function einschaetzungBerechnen(r) {
  if (!r || !r.symbol) return null;
  const k = entKennzahlen(r), dq = datenqualitaet(r, k), t = entTechnik(r), q = r.quelle || {};
  const S = window.AktienScreener, ss = S && S.staerkenSchwaechen ? S.staerkenSchwaechen(k) : { staerken: [], schwaechen: [], widersprueche: [] };
  const c = r.chancen_risiken || { dafuer: [], dagegen: [], offen: [] }, schritt = (id) => ((r.schritte || []).find((x) => x.id === id));
  const widersprueche = (r.widersprueche || []).length + (k._widerspruch ? 1 : 0) + ss.widersprueche.length;
  const dafuer = c.dafuer.length + ss.staerken.length, dagegen = c.dagegen.length + ss.schwaechen.length;
  const fund = schritt("screener-fundamental"), ein = schritt("einstieg"), kurs = Number.isFinite(r.kurs) ? r.kurs : Number.isFinite(k.kurs) ? k.kurs : null;
  const K = (id, name, status, wert) => ({ id, name, status, wert });
  const kriterien = [
    K("G1", "Echte Kursdaten", q.synthetisch ? "nicht erfüllt" : "erfüllt", q.synthetisch ? "synthetische Testdaten" : q.name || "?"),
    K("G2", "Aktuelle Kursdaten", kurs === null ? "nicht erfüllt" : r.frisch === false ? "nicht erfüllt" : "erfüllt", kurs === null ? "keine Kursdaten" : r.frisch === false ? "veraltet" : "aktuell"),
    // ab AJ5: widersprüchliche Pflichtwerte (z. B. EPS und Nettogewinn mit verschiedenem Vorzeichen) getrennt von fehlenden benennen
    K("G3", "Kernkennzahlen vorhanden (mind. 5 von 6)", dq.abdeckung_pct >= 80 ? "erfüllt" : "nicht erfüllt", `${dq.abdeckung_pct} % – fehlend: ${dq.fehlend.map((m) => ((S && S.NAMEN && S.NAMEN[m]) || m) + (k._ungueltig && k._ungueltig[m] ? ` (${k._ungueltig[m]})` : "")).join(", ") || "keine"}`),
    K("G4", "Keine widersprüchlichen Signale", widersprueche ? "nicht erfüllt" : "erfüllt", widersprueche ? `${widersprueche} widersprüchliche Signale (gemischtes Signal)` : "keine"),
    K("B1", `Screener „${einFundamental().name}“ bestanden`, !fund ? "unbekannt" : fund.status === "ok" ? "erfüllt" : fund.status === "warnung" ? "nicht erfüllt" : "unbekannt", `${fund ? fund.status : "kein Screener-Ergebnis"} – ${einFundamental().rules.map((rl) => einRegelText(rl, k[rl.metric])).join("; ")}`),
    K("B2", "Trend laut Chart-Scanner aufwärts", t.punkte === null ? "unbekannt" : t.punkte > 0 ? "erfüllt" : "nicht erfüllt", t.punkte === null ? "keine Signale (Soll > 0)" : `${t.punkte > 0 ? "+" : ""}${t.punkte} Punkte (Soll > 0)`),
    K("B3", "Entry-Timer nicht blockiert", !ein ? "unbekannt" : ein.status === "blockiert" ? "nicht erfüllt" : "erfüllt", `${ein ? ein.status + (ein.text ? " – " + String(ein.text).slice(0, 90) : "") : "kein Entry-Timer-Ergebnis"} (Soll: nicht „blockiert“)`),
    K("B4", "Mehr Argumente dafür als dagegen", dafuer > dagegen ? "erfüllt" : "nicht erfüllt", `${dafuer} dafür / ${dagegen} dagegen (Soll: mehr dafür)`),
  ];
  const grund = kriterien.filter((x) => x.id[0] === "G" && x.status !== "erfüllt"), unbekannt = kriterien.filter((x) => x.id[0] === "B" && x.status === "unbekannt");
  const nicht = kriterien.filter((x) => x.id[0] === "B" && x.status === "nicht erfüllt");
  const kategorie = grund.length || unbekannt.length ? EINSCHAETZUNG.keine : nicht.length ? EINSCHAETZUNG.kein : EINSCHAETZUNG.kauf;
  const ausgeloest = (grund.length ? grund : unbekannt.length ? unbekannt : nicht.length ? nicht : kriterien).map((x) => `${x.name}: ${x.status} (${x.wert})`);
  return { kategorie, ausgeloest, kriterien, dq, q, kurs, k };
}
// ab 14j (Anschluss nach 14i): Bedeutung je Kriterium (Werte aus aktien/screener.js:59 und aktien/einstieg.js:18) und – bei „keine
// belastbare Einschätzung“ – welcher Beleg fehlt und woher er käme. Nur Erklärtext; die Entscheidung bleibt einschaetzungBerechnen.
const EIN_BEDEUTUNG = {
  G1: "Nur echte Börsenkurse beschreiben ein echtes Unternehmen; lokale Testdaten sind künstlich erzeugt.",
  G2: "Tageskerzen dürfen höchstens 5 Tage alt sein (Standard der Analyse), sonst gilt die Analyse als veraltet.",
  G3: "Kurs, KGV, Eigenkapitalrendite, Umsatzwachstum, Betriebsmarge und RSI 14 – ohne Ertrags- und Bewertungszahlen lässt sich ein Unternehmen nicht beurteilen.",
  G4: "Widersprechen sich die Bausteine der Analyse, ist das Bild gemischt – dann keine Einschätzung.",
  B1: null, // aus einFundamental() erzeugt (siehe einB1Bedeutung)
  B2: "Summe der Chart-Scanner-Punkte (u. a. Lage von Kurs, EMA 50 und EMA 200) größer als 0.",
  B3: "Der Entry-Timer prüft u. a. Aufwärtstrend, RSI ≤ 70, Abstand zur EMA 20 ≤ 3 % und keine Quartalszahlen in den nächsten 3 Tagen; „warten“ zählt als nicht blockiert.",
  B4: "Mehr Argumente dafür (Chancen, Stärken) als dagegen (Risiken, Schwächen) aus dieser Analyse.",
};
function einB1Bedeutung() {
  const f = einFundamental();
  return `Screener-Vorlage „${f.name}“: ${f.rules.map((rl) => einRegelText(rl, null, false)).join(", ")} – alle Regeln müssen erfüllt sein; fehlende Werte gelten als nicht erfüllt.`;
}
function einschaetzungFehlt(e) {
  const S = window.AktienScreener, name = (m) => (S && S.NAMEN && S.NAMEN[m]) || m;
  return e.kriterien.filter((x) => (x.id[0] === "G" && x.status !== "erfüllt") || (x.id[0] === "B" && x.status === "unbekannt")).map((x) => ({
    G1: "echte Tageskerzen statt Testdaten – Datenquelle „Worker: Alpaca IEX und SEC EDGAR“, braucht einen eingerichteten Worker",
    G2: e.kurs === null ? "Kursdaten für dieses Symbol – keine gültigen Tageskerzen geladen (Symbol oder Datenquelle prüfen)" : "aktuelle Tageskerzen (höchstens 5 Tage alt) – Zeitraum bis heute wählen und neu analysieren",
    G3: e.k && e.k._ungueltig && e.dq.fehlend.some((m) => e.k._ungueltig[m])
      ? `widerspruchsfreie Quartalszahlen: ${e.dq.fehlend.filter((m) => e.k._ungueltig[m]).map(name).join(", ")} sind widersprüchlich (z. B. EPS und Nettogewinn mit verschiedenem Vorzeichen) – Originalmeldung bei der SEC prüfen` + (e.dq.fehlend.some((m) => !e.k._ungueltig[m]) ? `; fehlend: ${e.dq.fehlend.filter((m) => !e.k._ungueltig[m]).map(name).join(", ")} – nur über den Worker aus SEC EDGAR` : "")
      : `Quartalszahlen: ${e.dq.fehlend.map(name).join(", ")} – nur über den Worker aus SEC EDGAR (braucht SEC_USER_AGENT)`,
    G4: `eindeutige Lage statt ${x.wert} – die widersprüchlichen Signale stehen in der Entscheidungshilfe`,
    B1: `Ergebnis der Screener-Vorlage „${einFundamental().name}“ – braucht SEC-Quartalszahlen`,
    B2: "Signale des Chart-Scanners – braucht genügend Tageskerzen",
    B3: "Ergebnis des Entry-Timers – braucht aktuelle Tageskerzen",
  })[x.id] || `${x.name}: ${x.wert}`);
}
// Firmenname nur, wenn der SEC-Schritt (über den Worker) ihn geliefert hat; eine Unternehmensbeschreibung hat JARVIS nicht
function einschaetzungUnternehmen(r) {
  const sec = ((r && r.schritte) || []).find((x) => x.id === "sec");
  const name = sec && sec.status === "ok" ? String(sec.text || "").split(", Quartal bis")[0] : "";
  if (name && name !== r.symbol) return { name, grund: sec.text, quelle: "Name laut SEC EDGAR" };
  // ab Folgeauftrag nach 14q: Name aus dem Jahresbericht (SEC-Meldungsliste bzw. eingelesener Bericht), nie aus dem Ticker
  const be = ((r && r.schritte) || []).find((x) => x.id === "beschreibung"), bd = be && be.details;
  if (bd && bd.ok && bd.firma) return { name: String(bd.firma).slice(0, 200), grund: be.text, quelle: bd.quelle_datei ? "Name laut eingelesenem Jahresbericht" : "Name laut SEC-Meldungsliste" };
  return { name: "", grund: sec ? sec.text : "kein SEC-Schritt in dieser Analyse" };
}
function einschaetzungStatus(text) { const box = document.getElementById("ablauf-einschaetzung"); if (box) box.textContent = text; }
function einschaetzungZeigen(r, ent) {
  const box = document.getElementById("ablauf-einschaetzung");
  if (!box) return null;
  if (!r || !r.symbol) { box.textContent = "Keine Einschätzung – kein gültiges Symbol analysiert."; return null; }
  const e = einschaetzungBerechnen(r), u = einschaetzungUnternehmen(r), q = e.q;
  const zeit = Number.isFinite(r.datenzeit) ? new Date(r.datenzeit).toISOString().slice(0, 16).replace("T", " ") + " UTC" + (q.synthetisch ? " (künstliches Datum)" : "") : "–";
  // verständliche Bezeichnungen statt Regel-Schlüsseln (Namen aus aktien/screener.js NAMEN; nur Anzeige, Inhalt unverändert)
  const N = (window.AktienScreener && window.AktienScreener.NAMEN) || {};
  const lesbar = (s) => String(s).replace(/^ueber_ema200 1 == 1/, "Kurs liegt über dem 200-Tage-Durchschnitt (EMA 200)").replace(/^ueber_ema200 0 == 1/, "Kurs liegt nicht über dem 200-Tage-Durchschnitt (EMA 200)")
    .replace(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g, (m, key) => N[key] || m).replace(/^([a-z][a-z0-9]+) /, (m, key) => (N[key] ? N[key] + " " : m)).replace(/ – Screener technisch$/, " (Screener-Regel „Aufwärtstrend ohne Übertreibung“)");
  const kurz3 = (xs) => (xs && xs.length ? xs.slice(0, 3).map(lesbar) : ["keine"]);
  const zeichen = { "erfüllt": "✔", "nicht erfüllt": "✖", "unbekannt": "?" };
  // ab 14o (AJ3): Nummer nur, wenn entscheidungZeigen diesen Lauf gerade in den Verlauf geschrieben hat (ent vorhanden)
  const lauf = ent && ENTSCHEIDUNG.verlauf[0] && ENTSCHEIDUNG.verlauf[0].symbol === r.symbol ? ENTSCHEIDUNG.verlauf[0] : null;
  EIN_BERICHT.r = r;
  box.replaceChildren(
    lauf ? wzKnoten("p", { "data-teil": "bericht", klasse: "klein", text: `Bericht zu Analyse #${lauf.nr} von ${r.symbol} (${new Date(lauf.zeit).toLocaleTimeString("de-DE")})` }) : null,
    wzKnoten("p", { "data-teil": "unternehmen", text: `Unternehmen: ${r.symbol}` + (u.name ? ` – ${u.name} (${u.quelle || "Name laut SEC EDGAR"})` : ` – Firmenname nicht verfügbar (${u.grund})`)
      + (((r.schritte || []).find((x) => x.id === "beschreibung") || {}).details && r.schritte.find((x) => x.id === "beschreibung").details.ok
        ? ". Beschreibung: siehe „Unternehmensbeschreibung“ – wörtlich aus dem SEC-Jahresbericht; aus Ticker oder Namen wird nichts abgeleitet."
        : ". Beschreibung: keine belegte Unternehmensbeschreibung vorhanden (siehe Grund unten); aus Ticker oder Namen wird nichts abgeleitet.") }),
    einBeschreibungKnoten(r),
    wzKnoten("p", { "data-teil": "quelle", klasse: "klein", text: `Kursdaten – Datenquelle: ${q.name || "?"}${q.beschreibung ? " – " + q.beschreibung : ""} · Datenstand: ${zeit}${r.frisch === false ? " – VERALTET" : ""}` }),
    q.synthetisch ? wzKnoten("p", { "data-teil": "synthetisch", klasse: "wz-wichtig", text: "SYNTHETISCHE TESTDATEN: Es wird kein echtes Unternehmen bewertet." }) : null,
    wzKnoten("p", { "data-teil": "ergebnis", klasse: e.kategorie === EINSCHAETZUNG.kauf ? "" : "wz-wichtig", text: `Systemeinschätzung: ${e.kategorie}` }),
    wzKnoten("p", { "data-teil": "grund", text: (e.kategorie === EINSCHAETZUNG.kauf ? "Ausgelöst, weil alle Kriterien erfüllt sind: " : "Grund: ") + e.ausgeloest.join(" · ") }),
    ...(e.kategorie === EINSCHAETZUNG.keine ? [wzKnoten("h4", { text: "Was für eine belastbare Einschätzung fehlt" }), wzKnoten("ul", { "data-art": "e-fehlt" }, ...einschaetzungFehlt(e).map((x) => wzKnoten("li", { text: x })))] : []),
    wzKnoten("h4", { text: "Was dafür spricht (informativ – geht nur als Anzahl in B4 ein)" }), wzKnoten("ul", { "data-art": "e-dafuer" }, ...kurz3(ent && ent.dafuer).map((x) => wzKnoten("li", { text: x }))),
    wzKnoten("h4", { text: "Risiken und was dagegen spricht (informativ – geht nur als Anzahl in B4 ein)" }), wzKnoten("ul", { "data-art": "e-dagegen" }, ...kurz3(ent && ent.dagegen).map((x) => wzKnoten("li", { text: x }))),
    wzKnoten("h4", { text: "Unsicherheit (informativ)" }), wzKnoten("ul", { "data-art": "e-unsicher" }, ...kurz3(ent && ent.unsicher).map((x) => wzKnoten("li", { text: x }))),
    wzKnoten("details", {}, wzKnoten("summary", { text: "Alle Kriterien der Einschätzung (8)" }),
      wzKnoten("ul", { "data-art": "e-kriterien" }, ...e.kriterien.map((x) => wzKnoten("li", { "data-status": x.status, text: `${zeichen[x.status]} ${x.id} ${x.name}: ${x.status}${x.id[0] === "B" ? (x.status === "unbekannt" ? " (Datenmangel)" : x.status === "nicht erfüllt" ? " (negatives Signal)" : "") : ""} – ${x.wert}. Bedeutung: ${x.id === "B1" ? einB1Bedeutung() : EIN_BEDEUTUNG[x.id]}` })))),
    wzKnoten("p", { klasse: "klein", text: "Systemeinschätzung nach festen Regeln aus den Daten dieser Analyse – keine persönliche Anlageberatung, keine Aussage über künftige Kurse, keine Gewinnzusage. JARVIS kennt deine finanzielle Lage und Risikobereitschaft nicht. Die Analyse bucht nichts; Paper-Handel nur über „Paper-Vorschlag erstellen“ und dein ausdrückliches Ja. Vollständige Listen in der Entscheidungshilfe weiter unten." }),
    wzKnoten("div", { "data-teil": "kopier-bereich" },
      wzKnoten("button", { type: "button", klasse: "knopf zweit", "data-teil": "kopieren", text: "Bericht kopieren" }),
      wzKnoten("p", { "data-teil": "kopier-status", role: "status", "aria-live": "polite", klasse: "klein", text: "Kopiert genau diesen Bericht als Text in die Zwischenablage – erst nach Klick, bucht nichts." })));
  box.querySelector('[data-teil="kopieren"]').addEventListener("click", einBerichtKopieren);
  return e;
}
// ab Folgeauftrag nach 14q: Bereich „Unternehmensbeschreibung“ – wörtlicher Auszug aus dem 10-K/20-F (Schritt „beschreibung“ des
// Ablaufs oder eine selbst gespeicherte Berichtsdatei), mit Quelle, Formular, Einreichungsdatum und Geschäftsjahr. Getrennt von
// Kursdaten, Kennzahlen und Einschätzung; ohne Beleg „nicht verfügbar“ mit Grund. Löst nichts aus.
function einBeschreibungKnoten(r) {
  const s = ((r && r.schritte) || []).find((x) => x.id === "beschreibung"), e = s && s.details;
  const titel = wzKnoten("h4", { id: "ein-beschreibung-titel", text: "Unternehmensbeschreibung (Angaben des Unternehmens im SEC-Jahresbericht)" });
  // Klasse „feld“: mindestens 44 px hoch wie alle Eingabefelder (Schrift-Abnahme: Bedienelemente ≥ 32 px)
  const datei = wzKnoten("input", { type: "file", klasse: "feld", accept: ".htm,.html,text/html", "data-teil": "bericht-datei", "aria-describedby": "ein-beschreibung-datei-hinweis" });
  datei.addEventListener("change", () => einBerichtDateiLesen(r, datei));
  // ab 14v: Abbruch der Dateiwahl (Dialog „Abbrechen“) beendet einen laufenden Import ohne Übernahme
  datei.addEventListener("cancel", () => einBerichtAbbrechen());
  const dateiTeil = wzKnoten("p", { klasse: "klein" }, wzKnoten("label", {}, "Gespeicherten Jahresbericht (10-K/20-F, .htm) einlesen: ", datei),
    wzKnoten("span", { id: "ein-beschreibung-datei-hinweis", text: " – nur lokal gelesen, keine Abfrage; der Bericht muss diesen Ticker nennen." }));
  let inhalt;
  if (e && e.ok) {
    const link = /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//.test(String(e.link || "")) ? wzKnoten("a", { href: e.link, target: "_blank", rel: "noopener noreferrer", text: "Bericht bei der SEC öffnen" }) : null;
    inhalt = [
      wzKnoten("p", { "data-teil": "beschreibung", lang: "en", text: e.auszug + (e.gekuerzt ? " […]" : "") }),
      wzKnoten("p", { "data-teil": "beschreibung-quelle", klasse: e.veraltet ? "klein wz-wichtig" : "klein",
        text: `Quelle: SEC EDGAR${e.quelle_datei ? " (eingelesene Datei „" + e.quelle_datei + "“)" : ""} · Formular ${e.form} · eingereicht ${e.eingereicht || "– nicht in der Datei enthalten (im EDGAR-Index nachsehen)"} · Geschäftsjahr bis ${e.zeitraum || "?"}${e.geschaeftsjahr ? " (GJ " + e.geschaeftsjahr + ")" : ""} · Abschnitt „${e.abschnitt}“${e.format ? " · Dokument " + e.format : ""}${e.cik ? " · CIK " + e.cik : e.cik_dokument ? " · CIK " + e.cik_dokument + " (laut Dokument, nicht mit der SEC-Meldungsliste abgeglichen)" : ""} · wörtlicher Auszug, englisch (Originaltext aus dem Bericht${e.gekuerzt ? ", gekürzt – nicht die vollständige Einreichung" : ""}) – Selbstauskunft des Unternehmens, von JARVIS nicht geprüft oder übersetzt.`
          + (e.quelle_datei ? "" : e.abgerufen ? ` Abgerufen ${e.abgerufen.slice(0, 16).replace("T", " ")} UTC${e.aus_cache ? " (aus dem Zwischenspeicher des Workers, höchstens 1 Tag alt)" : " (frisch von der SEC)"}.` : " Abrufzeit unbekannt.")
          + (e.veraltet ? ` VERALTET: Bericht ${e.alter_tage} Tage alt.` : "") + (e.hinweise && e.hinweise.length ? " Hinweis: " + e.hinweise.join("; ") + "." : "") }, link ? " " : null, link),
    ];
  } else {
    const q = (r && r.quelle) || {};
    const ohneSchritt = q.synthetisch ? `Die Datenquelle „${q.name || "?"}“ liefert keine SEC-Jahresberichte (10-K/20-F). Mit eingerichtetem Worker (SEC_USER_AGENT) kommt die Beschreibung aus dem Jahresbericht; ohne Worker kann ein selbst gespeicherter Bericht unten eingelesen werden`
      : `Die Datenquelle „${q.name || "?"}“ hat keinen Abruf von SEC-Jahresberichten in dieser Analyse`;
    inhalt = [wzKnoten("p", { "data-teil": "beschreibung", text: `Unternehmensbeschreibung nicht verfügbar: ${(e && e.grund) || (s ? s.text : ohneSchritt)}${s && s.text && e && e.grund && !s.text.includes(e.grund) ? " – " + s.text : ""}. Es wird nichts aus Ticker, Namen oder Kursen abgeleitet. (Das betrifft nur die Beschreibung, nicht die Kursdaten.)` })];
  }
  return wzKnoten("section", { "data-teil": "beschreibung-bereich", "aria-labelledby": "ein-beschreibung-titel" }, titel, ...inhalt, dateiTeil,
    wzKnoten("p", { "data-teil": "beschreibung-status", role: "status", "aria-live": "polite", klasse: "klein" }));
}
// Selbst gespeicherte Berichtsdatei lesen (Demo ohne Worker): nur für die angezeigte, letzte Analyse; Ticker im Dokument muss passen
// ab 14v: jede Dateiwahl bekommt eine Nummer – nur der zuletzt gewählte Import wird übernommen; ein Abbruch erhöht die Nummer ebenfalls
const EIN_IMPORT = { nr: 0, laeuft: false };
const EIN_NAECHSTER = "Nächster Schritt: von sec.gov nur das Hauptdokument des 10-K/20-F (.htm) speichern und erneut wählen – die Analyse bleibt ohne Datei nutzbar.";
// ab 14y: Zeichensatz der Berichtsdatei beachten – BOM bzw. <meta charset> in den ersten 2 KB. Vom Browser gespeicherte SEC-Berichte sind
// oft als windows-1252 erklärt (am echten AAPL-10-K gefunden: „Company’s“ wurde als UTF-8 gelesen zu „Company�s“). Unbekannt → UTF-8.
async function einDateiText(f) {
  const puffer = await f.arrayBuffer(), b = new Uint8Array(puffer);
  let kodierung = "utf-8";
  if (b[0] === 0xff && b[1] === 0xfe) kodierung = "utf-16le";
  else if (b[0] === 0xfe && b[1] === 0xff) kodierung = "utf-16be";
  else if (!(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)) {
    const kopf = new TextDecoder("windows-1252").decode(b.subarray(0, 2048));
    const m = /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_-]+)/i.exec(kopf) || /<\?xml[^>]+encoding\s*=\s*["']([A-Za-z0-9_-]+)/i.exec(kopf);
    if (m) kodierung = m[1].toLowerCase();
  }
  try { return new TextDecoder(kodierung).decode(puffer); } catch (e) { return new TextDecoder("utf-8").decode(puffer); }
}
function einBerichtAbbrechen() {
  if (!EIN_IMPORT.laeuft) return;
  EIN_IMPORT.nr++; EIN_IMPORT.laeuft = false;
  const st = document.querySelector('#ablauf-einschaetzung [data-teil="beschreibung-status"]');
  if (st) st.textContent = "Einlesen abgebrochen – nichts übernommen.";
}
function einBerichtDateiLesen(r, input) {
  const box = document.getElementById("ablauf-einschaetzung"), st = box && box.querySelector('[data-teil="beschreibung-status"]'), SB = window.AktienSecBeschreibung;
  const f = input.files && input.files[0];
  if (!f) { einBerichtAbbrechen(); return; }
  if (!st) return;
  const nr = ++EIN_IMPORT.nr; EIN_IMPORT.laeuft = false;
  if (!SB) { st.textContent = "Modul für Unternehmensbeschreibungen nicht geladen."; return; }
  if (!APROFIL.letztes || APROFIL.letztes.analyse !== r) { st.textContent = "Nicht eingelesen: Die angezeigte Analyse ist nicht mehr die aktuelle – bitte neu „Analysieren“."; return; }
  if (f.size > 30 * 1024 * 1024) { st.textContent = "Nicht eingelesen: Datei größer als 30 MB (vermutlich die vollständige Einreichung). " + EIN_NAECHSTER; return; }
  st.textContent = "Lese Bericht …"; EIN_IMPORT.laeuft = true;
  einDateiText(f).then((html) => {
    if (nr !== EIN_IMPORT.nr) return; // inzwischen neue Dateiwahl oder Abbruch – dieses Ergebnis nicht übernehmen
    EIN_IMPORT.laeuft = false;
    if (!APROFIL.letztes || APROFIL.letztes.analyse !== r) { st.textContent = "Nicht eingelesen: inzwischen neue Analyse – bitte erneut wählen."; return; }
    const e = SB.ergebnisBauen(null, SB.beschreibungLesen(html, { form: "auto" }), r.symbol, { tickerPflicht: true });
    const details = e.ok ? { ...e, quelle_datei: String(f.name).slice(0, 80) } : { ok: false, grund: `Datei „${String(f.name).slice(0, 80)}“: ${e.grund} ${EIN_NAECHSTER}` };
    r.schritte = [...(r.schritte || []).filter((x) => x.id !== "beschreibung"), { id: "beschreibung", titel: "Unternehmensbeschreibung (SEC)", status: e.ok ? "ok" : "nicht_verfuegbar", text: e.ok ? `aus eingelesener Datei (${e.form})` : details.grund, details }];
    einschaetzungZeigen(r, EIN_BERICHT.ent);
    const st2 = document.querySelector('#ablauf-einschaetzung [data-teil="beschreibung-status"]');
    // ab 14t: Fokus auf die Meldung (Tastatur/Screenreader erfahren das Ergebnis sofort, auch beim Fehler)
    if (st2) { st2.textContent = e.ok ? `Bericht eingelesen: ${e.form}${e.zeitraum ? ", Geschäftsjahr bis " + e.zeitraum : ""}.` : details.grund; st2.tabIndex = -1; st2.focus(); }
  }, () => { if (nr !== EIN_IMPORT.nr) return; EIN_IMPORT.laeuft = false; st.textContent = "Nicht eingelesen: Datei nicht lesbar. " + EIN_NAECHSTER; });
}
// ab 14o (AJ3): „Bericht kopieren“. Der Text entsteht erst beim Klick aus genau dem sichtbaren Bericht dieser Box plus dem Datenzeitraum
// der Kerzen (wie im Kopf der Analyse) – und nur, wenn die Box noch zur letzten Analyse (APROFIL.letztes) und zum Symbolfeld passt.
// Schreibt nur in die Zwischenablage; bucht nichts, erstellt keinen Vorschlag. Ohne Zwischenablage: markierter Text zum Selbstkopieren.
const EIN_BERICHT = { r: null, ent: null };
function einBerichtText(box, r) {
  const zeilen = [], L = APROFIL.letztes, k = L && L.kerzen && Array.isArray(L.kerzen.kerzen) ? L.kerzen.kerzen : [];
  const tag = (t) => new Date(t).toISOString().slice(0, 10);
  zeilen.push(`JARVIS – Analysebericht ${r.symbol} (lokale Paper-Trading-Demo, Spielgeld)`,
    k.length && Number.isFinite(k[0].t) && Number.isFinite(k[k.length - 1].t) ? `Datenzeitraum der Kerzen: ${tag(k[0].t)} bis ${tag(k[k.length - 1].t)} (${k.length} Tageskerzen)` : "Datenzeitraum der Kerzen: nicht verfügbar", "");
  const lauf = (el) => { for (const x of el.children) {
    if (x.dataset.teil === "kopier-bereich") continue;
    const t = x.textContent.replace(/\s+/g, " ").trim();
    if (x.tagName === "UL" || x.tagName === "DETAILS" || x.tagName === "SECTION") lauf(x);
    else if (x.tagName === "H4" || x.tagName === "SUMMARY") zeilen.push("", t + ":");
    else if (x.tagName === "LI") zeilen.push("- " + t);
    else if (t) zeilen.push(t);
  } };
  lauf(box);
  return zeilen.join("\n");
}
function einBerichtKopieren() {
  const box = document.getElementById("ablauf-einschaetzung"), st = box && box.querySelector('[data-teil="kopier-status"]'), bereich = box && box.querySelector('[data-teil="kopier-bereich"]');
  if (!st || !bereich) return null;
  const r = EIN_BERICHT.r, L = APROFIL.letztes, feld = String((document.getElementById("ablauf-symbol") || {}).value || "").trim().toUpperCase().slice(0, 12);
  const nein = ABLAUF.laeuft ? "Analyse läuft – erst danach kopieren." : !r || !L || L.analyse !== r ? "Nicht kopiert: Dieser Bericht gehört nicht zur letzten Analyse – bitte neu „Analysieren“."
    : feld && feld !== r.symbol ? `Nicht kopiert: Der Bericht gilt für ${r.symbol}, im Symbolfeld steht ${feld} – erst „Analysieren“, dann kopieren.` : "";
  if (nein) { st.textContent = nein; return null; }
  const text = einBerichtText(box, r), aktuell = () => EIN_BERICHT.r === r && st.isConnected;
  const ausweg = (warum) => {
    let ta = bereich.querySelector('textarea[data-teil="kopier-text"]');
    if (!ta) { ta = wzKnoten("textarea", { "data-teil": "kopier-text", rows: "8", "aria-label": "Bericht als Text zum Kopieren" }); ta.style.width = "100%"; bereich.append(ta); }
    ta.readOnly = true; ta.value = text; ta.focus(); ta.select();
    st.textContent = `${warum} – der Bericht steht markiert im Feld darunter: mit Strg+C (Mac: ⌘+C) kopieren.`;
  };
  const cb = navigator.clipboard;
  if (!cb || typeof cb.writeText !== "function") { ausweg("Zwischenablage in diesem Browser nicht verfügbar"); return text; }
  st.textContent = "Kopiere …";
  cb.writeText(text).then(() => { if (aktuell()) st.textContent = `Bericht kopiert (${text.split("\n").length} Zeilen) – nur Text, nichts gebucht.`; }, () => { if (aktuell()) ausweg("Zwischenablage nicht erlaubt"); });
  return text;
}
function entVerlaufZeigen() {
  const ul = document.getElementById("ent-verlauf"), a = document.getElementById("ent-a"), b = document.getElementById("ent-b");
  if (!ul) return;
  const text = (s) => `#${s.nr} ${new Date(s.zeit).toLocaleTimeString("de-DE")} · ${s.symbol} · ${s.synthetisch ? "synthetisch" : s.frisch === false ? "veraltet" : "Tageskerzen"} · Trend ${s.trend || "–"} · ${s.dafuer} dafür / ${s.dagegen} dagegen`;
  ul.replaceChildren(...(ENTSCHEIDUNG.verlauf.length ? ENTSCHEIDUNG.verlauf.map((s) => wzKnoten("li", { "data-nr": String(s.nr), text: text(s) })) : [wzKnoten("li", { text: "Noch keine Analyse in dieser Sitzung." })]));
  for (const [sel, vorgabe] of [[a, 1], [b, 0]]) {
    const gew = sel.value;
    sel.replaceChildren(...(ENTSCHEIDUNG.verlauf.length ? ENTSCHEIDUNG.verlauf.map((s) => Object.assign(document.createElement("option"), { value: String(s.nr), textContent: text(s) }))
      : [Object.assign(document.createElement("option"), { value: "", textContent: "noch keine Analyse" })]));
    if ([...sel.options].some((o) => o.value === gew)) sel.value = gew; else if (ENTSCHEIDUNG.verlauf[vorgabe]) sel.value = String(ENTSCHEIDUNG.verlauf[vorgabe].nr);
  }
}
function entVergleichZeigen() {
  const nr = (id) => Number(document.getElementById(id).value);
  const a = ENTSCHEIDUNG.verlauf.find((s) => s.nr === nr("ent-a")), b = ENTSCHEIDUNG.verlauf.find((s) => s.nr === nr("ent-b"));
  const box = document.getElementById("ent-vergleich");
  const v = entVergleich(a, b);
  if (v.fehler) { box.textContent = v.fehler; return v; }
  const z = (x) => (x === null || x === undefined ? "–" : typeof x === "number" ? x.toLocaleString("de-DE", { maximumFractionDigits: 2 }) : String(x));
  const zeilen = (xs) => (xs.length ? xs : [null]).map((d) => wzKnoten("li", { text: d ? `${d.feld}: ${z(d.vorher)} → ${z(d.nachher)}` : "keine Änderung" }));
  box.replaceChildren(wzKnoten("p", { klasse: "klein", text: `Vergleich #${a.nr} (früher) mit #${b.nr}` + (v.anderesSymbol ? " – Achtung: verschiedene Symbole." : "") }),
    wzKnoten("h4", { text: "Geänderte Werte" }), wzKnoten("ul", { "data-art": "werte" }, ...zeilen(v.werte)),
    wzKnoten("h4", { text: "Geänderte Annahmen" }), wzKnoten("ul", { "data-art": "annahmen" }, ...zeilen(v.annahmen)));
  return v;
}
{
  const original = ablaufKennzahlenZeigen;
  ablaufKennzahlenZeigen = function (r) {
    const e = original(r);
    let ent = null;
    try { ent = entscheidungZeigen(r); } catch (x) { const b = document.getElementById("ablauf-entscheidung"); if (b) b.textContent = "Entscheidungshilfe nicht verfügbar: " + x.message; }
    EIN_BERICHT.ent = ent;
    try { einschaetzungZeigen(r, ent); } catch (x) { einschaetzungStatus("Keine belastbare Einschätzung möglich – Einschätzung nicht berechenbar: " + x.message); }
    return e;
  };
}
document.getElementById("ent-vergleichen").addEventListener("click", entVergleichZeigen);
entVerlaufZeigen();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("entscheidung");
