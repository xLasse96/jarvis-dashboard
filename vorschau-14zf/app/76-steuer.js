// JARVIS Dashboard – Modul „steuer“ (ab 14ze). Karte „Steuer-Information (US-Regeln)“ nach trader-tax (aktien/steuer.js).
// Rechnet nur auf dem Ledger der Simulation (Paper-Kern) und zeigt an – keine Order, keine Änderung am Paper-Kern oder an Grenzen.
// Jede Ausgabe beginnt mit dem Hinweis „keine (deutsche) Steuerberatung“.
const steuerEl = (id) => document.getElementById(id);
function steuerListe(el, zeilen) { el.replaceChildren(...zeilen.map((t) => Object.assign(document.createElement("li"), { textContent: t }))); }
// Preise: letzter Schluss des gewählten Datensatzes; eigene Preise „SYMBOL=PREIS“ überschreiben ihn (lots.py:383-385, --price hat Vorrang)
function steuerPreise() {
  const ds = typeof SIM !== "undefined" ? SIM.datensatz : null, preise = {}, quellen = {}, fehler = [];
  if (ds && ds.kerzen && ds.kerzen.length) { const k = ds.kerzen[ds.kerzen.length - 1]; preise[ds.symbol] = k.c; quellen[ds.symbol] = `letzter Kurs „${ds.name}“ vom ${simDatum(k.t)}`; }
  for (const teil of String(steuerEl("steuer-preise").value || "").split(/[,;\n]/)) {
    const t = teil.trim(); if (!t) continue;
    const m = /^([A-Za-z][A-Za-z.\-]{0,9})\s*=\s*(\d+(?:\.\d+)?)$/.exec(t);
    if (!m || !(Number(m[2]) > 0)) { fehler.push(t.slice(0, 30)); continue; }
    preise[m[1].toUpperCase()] = Number(m[2]); quellen[m[1].toUpperCase()] = "eigener Preis";
  }
  return { preise, quellen, fehler };
}
function steuerStichtag() { const S = window.AktienSteuer, v = steuerEl("steuer-stichtag").value; return S.tag(v || new Date().toISOString().slice(0, 10)); }
function steuerDaten() {
  const S = window.AktienSteuer, ledger = (typeof SIM !== "undefined" && SIM.portfolio && SIM.portfolio.ledger) || [];
  return { S, ...S.ausLedger(ledger), ...steuerPreise(), heute: steuerStichtag(), orders: typeof AKTIEN !== "undefined" && Array.isArray(AKTIEN.orders) ? AKTIEN.orders : [] };
}
function steuerBerechnen() {
  const aus = steuerEl("steuer-ergebnis");
  try {
    const { S, portfolio, realisiert, preise, quellen, fehler, heute, orders } = steuerDaten();
    const z = [S.HINWEIS, `Stichtag ${S.iso(heute)} · Grundlage: Ledger der Simulation (Spielgeld).`];
    if (fehler.length) z.push(`Eigene Preise nicht verstanden: ${fehler.join(", ")} – Form „SYMBOL=PREIS“, z. B. AAPL=190.5.`);
    const u = S.unrealisiert(portfolio, preise, heute);
    if (!portfolio.positions.length) z.push("Keine offenen Lose im Ledger der Simulation.");
    for (const s of u.summen) z.push(`${s.ticker}: ${S.stueck(s.shares)} Stück · Kosten ${S.geld(s.cost)} · Wert ${S.geld(s.value)} (${quellen[s.ticker] || "Preis"}) · nicht realisiert ${S.geld(s.gewinn)} (${s.pct.toLocaleString("de-DE")} %; kurzfristig ${S.geld(s.kurz)}, langfristig ${S.geld(s.lang)})`);
    for (const r of u.zeilen) z.push(`  Los ${r.id}: gekauft ${r.datum}, ${S.stueck(r.shares)} Stück, Kosten ${S.geld(r.cost)}, ${r.gewinn < 0 ? "Verlust" : "Gewinn"} ${S.geld(r.gewinn)} – ${r.frist === "lang" ? "langfristig" : "kurzfristig"} (langfristig ab ${r.lang_ab})`);
    for (const t of u.fehlend) z.push(`Kein Preis für ${t}: unter „Eigene Preise“ eintragen (z. B. ${t}=100) – sonst nicht bewertet.`);
    const j = S.realisiertJahr(realisiert, new Date(heute).getUTCFullYear());
    z.push(`Realisiert ${new Date(heute).getUTCFullYear()} (Verkäufe im Ledger, ${j.anzahl}): kurzfristig ${S.geld(j.kurz)}, langfristig ${S.geld(j.lang)}.`);
    const minVerlust = Math.max(0, Number(steuerEl("steuer-minverlust").value) || 0), kand = S.harvest(portfolio, preise, heute, { minVerlust, orders });
    if (!kand.length) z.push(`Verlustverrechnung: keine Lose mit mindestens ${S.geld(minVerlust)} Verlust.`);
    for (const c of kand) z.push(`Verlustverrechnung-Kandidat ${c.ticker}: Lose ${c.lose.join(", ")}, ${S.stueck(c.shares)} Stück, Verlust ${S.geld(c.verlust)} (${c.pct.toLocaleString("de-DE")} %)${c.wash.length ? ` – Wash-Sale-Konflikt: ${c.wash.map((h) => `${h.ticker} ${h.datum} (${h.quelle})`).join("; ")}, nicht abziehbar ${S.geld(c.nicht_abziehbar)}` : ""} · Rückkauf frühestens ${c.rueckkauf_ab}`);
    for (const v of S.harvestVorschlaege(kand)) z.push(`Vorschlag (keine Order): ${v.warum}`);
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
;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("steuer");
