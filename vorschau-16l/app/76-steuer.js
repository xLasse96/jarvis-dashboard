// JARVIS Dashboard – Modul „steuer“ (ab 14ze). Karte „Steuer-Information (US-Regeln)“ nach trader-tax (aktien/steuer.js).
// Rechnet nur auf dem Ledger der Simulation (Paper-Kern) und zeigt an – keine Order, keine Änderung am Paper-Kern oder an Grenzen.
// Jede Ausgabe beginnt mit dem Hinweis „keine (deutsche) Steuerberatung“.
const steuerEl = (id) => document.getElementById(id);
function steuerListe(el, zeilen) { el.replaceChildren(...zeilen.map((t) => Object.assign(document.createElement("li"), { textContent: t }))); }
// Preise: letzter Schluss des gewählten Datensatzes; eigene Preise „SYMBOL=PREIS“ überschreiben ihn (lots.py:383-385, --price hat Vorrang)
function steuerPreise() {
  const ds = typeof SIM !== "undefined" ? SIM.datensatz : null, preise = {}, quellen = {}, fehler = [];
  if (ds && ds.kerzen && ds.kerzen.length) { const k = ds.kerzen[ds.kerzen.length - 1]; preise[ds.symbol] = k.c; quellen[ds.symbol] = `letzter Kurs „${ds.name}“ vom ${simDatum(k.t)}`; }
  // ab 14zg: gemeinsamer Kursspeicher der Alarme (ALR-S13, wie prices.json im Original) für Symbole ohne Datensatzpreis; eigene Preise haben Vorrang
  try { const sp = JSON.parse(localStorage.getItem("jarvis-aktien-kursspeicher") || "null"); if (sp && sp.prices) for (const [s, v] of Object.entries(sp.prices)) if (!(s in preise) && Number(v) > 0) { preise[s] = Number(v); quellen[s] = `Kursspeicher (Stand ${String(sp.as_of || "?").slice(0, 16).replace("T", " ")} UTC, ${sp.source || "Quelle unbekannt"}; verzögert)`; } } catch (e) { /* kein Speicher */ }
  // ab 16j: Kursdatei (prices.json wie im Original) vor den eigenen Preisen; Stand und Herkunft werden genannt
  if (STEUER.kurse) for (const [s, v] of Object.entries(STEUER.kurse.prices)) { preise[s] = v; quellen[s] = `Kursdatei „${STEUER.kurse.name}“ (Stand ${STEUER.kurse.as_of || "unbekannt"})`; }
  for (const teil of String(steuerEl("steuer-preise").value || "").split(/[,;\n]/)) {
    const t = teil.trim(); if (!t) continue;
    const m = /^([A-Za-z][A-Za-z.\-]{0,9})\s*=\s*(\d+(?:\.\d+)?)$/.exec(t);
    if (!m || !(Number(m[2]) > 0)) { fehler.push(t.slice(0, 30)); continue; }
    preise[m[1].toUpperCase()] = Number(m[2]); quellen[m[1].toUpperCase()] = "eigener Preis";
  }
  return { preise, quellen, fehler };
}
function steuerStichtag() { const S = window.AktienSteuer, v = steuerEl("steuer-stichtag").value; return S.tag(v || new Date().toISOString().slice(0, 10)); }
// ab 16j (TAX-S14): eigene Dateien – Portfolio mit Losen (positions[].lots[]: date, shares, cost) und Kursdatei; Fehler klar benannt
const STEUER = { datei: null, kurse: null };
async function steuerDateiLesen(art) {
  const st = steuerEl("steuer-datei-status"), S = window.AktienSteuer, inp = steuerEl(art === "kurse" ? "steuer-kursdatei" : "steuer-datei");
  const f = inp.files && inp.files[0];
  if (art === "kurse") STEUER.kurse = null; else STEUER.datei = null;
  const d = typeof lokalDateiLesen === "function" ? await lokalDateiLesen(f, ["json"]) : { fehler: "Dateilesen nicht verfügbar." };
  if (d.fehler) { st.textContent = (art === "kurse" ? "Kursdatei" : "Portfolio-Datei") + " nicht eingelesen: " + d.fehler; return; }
  let j;
  try { j = JSON.parse(d.text); } catch (e) { st.textContent = `„${d.name}“ ist kein gültiges JSON: ${String(e.message).slice(0, 120)}`; return; }
  try {
    if (art === "kurse") {
      const p = j && typeof j === "object" && j.prices && typeof j.prices === "object" ? j.prices : null;
      if (!p) throw new S.SteuerFehler("keine Kurse (Feld „prices“ fehlt).");
      const prices = {}, falsch = [];
      for (const [s, v] of Object.entries(p)) { if (/^[A-Z][A-Z.\-]{0,9}$/.test(String(s).toUpperCase()) && Number(v) > 0) prices[String(s).toUpperCase()] = Number(v); else falsch.push(String(s).slice(0, 12)); }
      if (j.as_of !== undefined) S.tag(j.as_of); // Stand muss ein Datum sein (JJJJ-MM-TT …)
      STEUER.kurse = { prices, as_of: j.as_of ? String(j.as_of).slice(0, 20) : null, name: d.name };
      st.textContent = `Kursdatei aus ${lokalHerkunft(d)}: ${Object.keys(prices).length} Kurse, Stand ${STEUER.kurse.as_of || "unbekannt"}${falsch.length ? ` · ungültig übersprungen: ${falsch.join(", ")}` : ""}. Nicht gegen Marktdaten geprüft.`;
    } else {
      if (!j || typeof j !== "object" || !Array.isArray(j.positions)) throw new S.SteuerFehler("kein Portfolio (Feld „positions“ fehlt).");
      const lose = S.lose(j); // prüft Daten (JJJJ-MM-TT) und Positionen ohne Lose
      STEUER.datei = { portfolio: j, name: d.name, herkunft: lokalHerkunft(d) };
      steuerEl("steuer-quelle").value = "datei";
      st.textContent = `Portfolio-Datei aus ${lokalHerkunft(d)}: ${Object.keys(lose).length} Positionen, ${Object.values(lose).reduce((s, l) => s + l.length, 0)} Lose. Grundlage auf „Portfolio-Datei“ gestellt.`;
    }
  } catch (e) { st.textContent = `„${d.name}“ nicht verwendbar: ${String((e && e.message) || e).slice(0, 160)}`; }
}
function steuerDaten() {
  const S = window.AktienSteuer, ledger = (typeof SIM !== "undefined" && SIM.portfolio && SIM.portfolio.ledger) || [];
  const orders = typeof AKTIEN !== "undefined" && Array.isArray(AKTIEN.orders) ? AKTIEN.orders : [];
  if (steuerEl("steuer-quelle").value === "datei") {
    if (!STEUER.datei) throw new S.SteuerFehler("keine Portfolio-Datei eingelesen – Datei wählen oder Grundlage „Ledger der Simulation“.");
    return { S, portfolio: STEUER.datei.portfolio, realisiert: [], grundlage: "Portfolio-Datei " + STEUER.datei.herkunft, ...steuerPreise(), heute: steuerStichtag(), orders };
  }
  return { S, ...S.ausLedger(ledger), grundlage: "Ledger der Simulation (Spielgeld)", ...steuerPreise(), heute: steuerStichtag(), orders };
}
// ab 16j (TAX-S11, wie lots.py harvest --write): Vorschlagsdatei; mit Wash-Konflikt nur bei Häkchen. Nie eine Order.
function steuerVorschlagsDokument() {
  const { S, portfolio, preise, heute, orders, grundlage } = steuerDaten();
  const minVerlust = Math.max(0, Number(steuerEl("steuer-minverlust").value) || 0);
  const kand = S.harvest(portfolio, preise, heute, { minVerlust, orders: orders.filter((o) => String(o.side || "").toLowerCase() === "buy") });
  const vorschlaege = S.harvestVorschlaege(kand, { mitWash: steuerEl("steuer-mitwash").checked });
  const dok = vorschlaege.length ? { created_by: "trader-tax", created_at: new Date().toISOString().slice(0, 19), status: "proposed", paper: true, grundlage, stichtag: S.iso(heute),
    note: "Vorschläge zur Verlustverrechnung nach US-Regeln, keine Steuerberatung. Es wird nichts gesendet: jede Order muss erst die Risiko-Prüfung bestehen und von dir einzeln bestätigt werden.",
    orders: vorschlaege.map((v) => ({ symbol: v.symbol, side: "sell", qty: v.stueck, type: "market", time_in_force: "day", why: v.warum })) } : null;
  return { kand, dok };
}
function steuerVorschlagSpeichern() {
  const st = steuerEl("steuer-vorschlag-status");
  try {
    const { kand, dok } = steuerVorschlagsDokument();
    if (!kand.length) { st.textContent = "Keine Datei: kein Los mit dem Mindestverlust. Keine Steuerberatung."; return null; }
    if (!dok) { st.textContent = "Keine Datei: jeder Kandidat hat einen Wash-Sale-Konflikt (Häkchen setzen, um sie trotzdem vorzuschlagen)."; return null; }
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([JSON.stringify(dok, null, 2) + "\n"], { type: "application/json" })), download: `steuer-vorschlaege-${dok.stichtag}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    st.textContent = `${dok.orders.length} Verkaufsvorschlag/-vorschläge (${dok.orders.map((o) => o.symbol).join(", ")}) als Datei gespeichert – status „proposed“, keine Order. Grundlage: ${dok.grundlage}.`;
    return dok;
  } catch (e) { st.textContent = "Nicht gespeichert: " + String((e && e.message) || e).slice(0, 200); return null; }
}
function steuerBerechnen() {
  const aus = steuerEl("steuer-ergebnis");
  try {
    const { S, portfolio, realisiert, preise, quellen, fehler, heute, orders, grundlage } = steuerDaten();
    const z = [S.HINWEIS, `Stichtag ${S.iso(heute)} · Grundlage: ${grundlage}.`];
    if (fehler.length) z.push(`Eigene Preise nicht verstanden: ${fehler.join(", ")} – Form „SYMBOL=PREIS“, z. B. AAPL=190.5.`);
    const u = S.unrealisiert(portfolio, preise, heute);
    if (!portfolio.positions.length) z.push("Keine offenen Lose in der Grundlage.");
    for (const s of u.summen) z.push(`${s.ticker}: ${S.stueck(s.shares)} Stück · Kosten ${S.geld(s.cost)} · Wert ${S.geld(s.value)} (${quellen[s.ticker] || "Preis"}) · nicht realisiert ${S.geld(s.gewinn)} (${s.pct.toLocaleString("de-DE")} %; kurzfristig ${S.geld(s.kurz)}, langfristig ${S.geld(s.lang)})`);
    for (const r of u.zeilen) z.push(`  Los ${r.id}: gekauft ${r.datum}, ${S.stueck(r.shares)} Stück, Kosten ${S.geld(r.cost)}, ${r.gewinn < 0 ? "Verlust" : "Gewinn"} ${S.geld(r.gewinn)} – ${r.frist === "lang" ? "langfristig" : "kurzfristig"} (langfristig ab ${r.lang_ab})`);
    for (const t of u.fehlend) z.push(`Kein Preis für ${t}: unter „Eigene Preise“ eintragen (z. B. ${t}=100) – sonst nicht bewertet.`);
    const j = S.realisiertJahr(realisiert, new Date(heute).getUTCFullYear());
    z.push(`Realisiert ${new Date(heute).getUTCFullYear()} (Verkäufe im Ledger, ${j.anzahl}): kurzfristig ${S.geld(j.kurz)}, langfristig ${S.geld(j.lang)}${j.nicht_abziehbar ? `, davon wegen Wash-Sale nicht abziehbar ${S.geld(j.nicht_abziehbar)}` : ""}.`);
    const minVerlust = Math.max(0, Number(steuerEl("steuer-minverlust").value) || 0), kand = S.harvest(portfolio, preise, heute, { minVerlust, orders });
    if (!kand.length) z.push(`Verlustverrechnung: keine Lose mit mindestens ${S.geld(minVerlust)} Verlust.`);
    for (const c of kand) z.push(`Verlustverrechnung-Kandidat ${c.ticker}: Lose ${c.lose.join(", ")}, ${S.stueck(c.shares)} Stück, Verlust ${S.geld(c.verlust)} (${c.pct.toLocaleString("de-DE")} %)${c.wash.length ? ` – Wash-Sale-Konflikt: ${c.wash.map((h) => `${h.ticker} ${h.datum} (${h.quelle})`).join("; ")}, nicht abziehbar ${S.geld(c.nicht_abziehbar)}` : ""} · Rückkauf frühestens ${c.rueckkauf_ab}`);
    for (const v of S.harvestVorschlaege(kand, { mitWash: steuerEl("steuer-mitwash").checked })) z.push(`Vorschlag (keine Order): ${v.warum}`); // ab 16j: mit Wash-Konflikt nur bei Häkchen (TAX-S11)
    for (const t of [...new Set([...portfolio.positions.map((p) => p.ticker), ...realisiert.map((r) => r.symbol)])]) {
      const vv = S.verlustVerkaeufe(t, heute, realisiert);
      if (vv.length) z.push(`Wash-Sale-Hinweis vor einem Kauf von ${S.familie(t).join("/")}: Verlustverkauf am ${vv.map((r) => r.datum).join(", ")} – ein Kauf bis ${S.rueckkaufAb(S.tag(vv[vv.length - 1].datum))} (ausschließlich) wäre ein Wash-Sale.`);
    }
    steuerListe(aus, z);
  } catch (e) {
    steuerListe(aus, [window.AktienSteuer ? window.AktienSteuer.HINWEIS : "Keine Steuerberatung.", "Nicht berechnet: " + String((e && e.message) || e).slice(0, 200)]);
  }
}
function steuerVerkaufSimulieren() {
  const aus = steuerEl("steuer-verkauf");
  try {
    const { S, portfolio, preise, heute, orders } = steuerDaten();
    const t = String(steuerEl("steuer-symbol").value || "").trim().toUpperCase(), stueck = Number(steuerEl("steuer-stueck").value);
    if (!t) throw new S.SteuerFehler("Symbol fehlt.");
    if (!(stueck > 0)) throw new S.SteuerFehler("Stückzahl größer als 0 angeben.");
    const ls = S.lose(portfolio)[t];
    if (!ls || !ls.length) throw new S.SteuerFehler(`Keine Lose für ${t} im Ledger der Simulation.`);
    const preis = Number(steuerEl("steuer-preis").value) || preise[t];
    if (!(preis > 0)) throw new S.SteuerFehler(`Kein Preis für ${t}: Preis eintragen.`);
    const methode = steuerEl("steuer-methode").value, ids = String(steuerEl("steuer-lose").value || "").split(",").map((x) => x.trim()).filter(Boolean);
    const v = S.verkaufSimulieren(ls, stueck, preis, heute, methode, ids);
    const treffer = v.gewinn < 0 ? S.washPruefen(t, heute, v.lose, portfolio, orders, preise) : [];
    const z = [S.HINWEIS, `Simulierter Verkauf (keine Order): ${S.stueck(stueck)} ${t} zu ${S.geld(preis)} am ${S.iso(heute)} (${methode.toUpperCase()}) – Erlös ${S.geld(v.erloes)}, Basis ${S.geld(v.basis)}, Ergebnis ${S.geld(v.gewinn)} (kurzfristig ${S.geld(v.kurz)}, langfristig ${S.geld(v.lang)})`];
    for (const l of v.lose) z.push(`  Los ${l.id}: gekauft ${l.gekauft}, ${S.stueck(l.shares)} Stück, Basis ${S.geld(l.basis)}, Erlös ${S.geld(l.erloes)}, ${S.geld(l.gewinn)} (${l.frist === "lang" ? "langfristig" : "kurzfristig"})`);
    if (v.gewinn < 0) z.push(treffer.length ? `Wash-Sale: ${treffer.map((h) => `${h.ticker} ${h.datum} – ${h.quelle}`).join("; ")} → nicht abziehbar ${S.geld(S.nichtAbziehbar(v.gewinn, stueck, treffer))}; Rückkauf frühestens ${S.rueckkaufAb(heute)}.` : `Kein Wash-Sale in den Losen der Simulation erkannt (andere Konten sieht JARVIS nicht). Rückkauf frühestens ${S.rueckkaufAb(heute)}, wenn der Verlust zählen soll.`);
    steuerListe(aus, z);
  } catch (e) {
    steuerListe(aus, [window.AktienSteuer ? window.AktienSteuer.HINWEIS : "Keine Steuerberatung.", "Nicht simuliert: " + String((e && e.message) || e).slice(0, 200)]);
  }
}
steuerEl("steuer-berechnen").addEventListener("click", steuerBerechnen);
steuerEl("steuer-simulieren").addEventListener("click", steuerVerkaufSimulieren);
steuerEl("steuer-datei").addEventListener("change", () => steuerDateiLesen("portfolio"));
steuerEl("steuer-kursdatei").addEventListener("change", () => steuerDateiLesen("kurse"));
steuerEl("steuer-vorschlag-datei").addEventListener("click", steuerVorschlagSpeichern);
;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("steuer");
