// JARVIS Aktien – Budget-Aufteilung (Stufe 1). Reine Rechnung ohne Netzwerk: schreibt nur VORSCHLÄGE, nie eine Order.
// Nach dem Vorbild von trader-budget/size.py aus github.com/Jakeschincariol/trader-skill (MIT), in JavaScript neu geschrieben.
//
// Ablauf (wie im Vorbild):
//   1. Barreserve      budget × barreservePct bleibt Bargeld
//   2. Gewichte        gesperrte Ticker raus, Rest auf 100 % normiert
//   3. Deckel          keine Aktie über maxPositionPct des Budgets; der Überschuss wird nach Gewicht auf die anderen verteilt,
//                      so lange, bis keine mehr darüber liegt
//   4. Mindestorder    Anteile unter minOrderUsd fallen weg, ihr Gewicht wird verteilt
//   5. Rundung         ganze Dollar; der Rundungsdollar geht an die größte nicht gedeckelte Aktie, damit nichts ungewollt liegen bleibt
// Geld, das nicht anzulegen ist (alles gedeckelt), wird als „untätig“ ausgewiesen, nie versteckt.
(function (global) {
  "use strict";

  const TICKER = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;
  const STANDARD = { barreservePct: 10, maxPositionPct: 25, minOrderUsd: 5, maxOrderUsd: 1000, gesperrt: [] };

  // "AAPL=40\nMSFT=35" bzw. "AAPL 40, MSFT 35" → [{ symbol, gewicht }]; Fehler je Zeile
  // ab 15e (trader-budget BUD-S10, size.py:82-124): JSON-Formen {weights: [...] | {T: w}, source}, {TICKER: Gewicht} oder Liste mit
  // ticker|symbol und weight|weight_pct|pct; dieselben Prüfungen wie die Textform; source läuft als quelle bis in die Begründung
  function zieleAusJson(roh) {
    const ziele = [], fehler = [];
    let d; try { d = JSON.parse(roh); } catch (e) { return { ziele, fehler: ["JSON nicht lesbar: " + String(e.message).slice(0, 80)], quelle: null }; }
    const quelle = d && !Array.isArray(d) && typeof d.source === "string" ? d.source.slice(0, 160) : null;
    let liste = Array.isArray(d) ? d : d && d.weights !== undefined ? d.weights : d;
    if (liste && !Array.isArray(liste) && typeof liste === "object") liste = Object.entries(liste).filter(([k]) => k !== "source").map(([ticker, weight]) => ({ ticker, weight }));
    if (!Array.isArray(liste)) return { ziele, fehler: ["JSON: keine Gewichte gefunden (weights, {TICKER: Gewicht} oder Liste)."], quelle };
    for (const e of liste) {
      const symbol = String((e && (e.ticker || e.symbol)) || "").trim().toUpperCase(), roh2 = e && (e.weight !== undefined ? e.weight : e.weight_pct !== undefined ? e.weight_pct : e.pct), gewicht = Number(roh2);
      if (!TICKER.test(symbol)) { fehler.push(`${symbol || "?"}: kein US-Aktien-Ticker`); continue; }
      if (!Number.isFinite(gewicht)) { fehler.push(`${symbol}: Gewicht ist keine Zahl`); continue; }
      if (!(gewicht > 0)) { fehler.push(`${symbol}: Gewicht muss größer als 0 sein`); continue; }
      if (ziele.some((z) => z.symbol === symbol)) { fehler.push(`${symbol}: doppelt`); continue; }
      ziele.push({ symbol, gewicht });
    }
    return { ziele, fehler, quelle };
  }
  function zieleLesen(text) {
    if (/^\s*[[{]/.test(String(text || ""))) return zieleAusJson(String(text));
    const ziele = [];
    const fehler = [];
    for (const teil of String(text || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)) {
      const m = teil.match(/^([A-Za-z.\-]+)\s*[=: ]\s*([0-9]+(?:[.,][0-9]+)?)\s*%?$/);
      if (!m) { fehler.push(`„${teil}“ nicht lesbar (Form: TICKER=Gewicht)`); continue; }
      const symbol = m[1].toUpperCase();
      const gewicht = Number(m[2].replace(",", "."));
      if (!TICKER.test(symbol)) { fehler.push(`${symbol}: kein US-Aktien-Ticker`); continue; }
      if (!(gewicht > 0)) { fehler.push(`${symbol}: Gewicht muss größer als 0 sein`); continue; }
      if (ziele.some((z) => z.symbol === symbol)) { fehler.push(`${symbol}: doppelt`); continue; }
      ziele.push({ symbol, gewicht });
    }
    return { ziele, fehler };
  }

  // ab 14zd (trader-budget BUD-S16, size.py:347-365 orders_from „why“): Begründung je Position – Anteil am Aktienteil (Gewicht nach Normierung)
  // und, falls gedeckelt, der Deckel in % des Budgets. Nur Anzeige: die Orders bleiben unverändert (kein neues Feld an den Worker).
  function warumText(anteilPct, gedeckelt, maxPositionPct, budget, quelle = null) {
    const z = (x) => Number(x).toLocaleString("de-DE", { maximumFractionDigits: 2 });
    // ab 15e (BUD-S16 „copying <source>“): Quelle der Zielgewichte, falls bekannt
    return `${Number(anteilPct).toFixed(2).replace(".", ",")} % des Aktienanteils` + (quelle ? `, nach Vorlage ${String(quelle).slice(0, 120)}` : "") + (gedeckelt ? `; gedeckelt bei ${z(maxPositionPct)} % des Budgets von ${z(budget)} USD` : "");
  }
  function aufteilen(budget, ziele, regelnRoh = {}) {
    const regeln = { ...STANDARD, ...regelnRoh };
    if (!(Number(budget) > 0)) return { fehler: "Budget muss größer als 0 sein." };
    budget = Number(budget);
    const gesperrt = new Set((regeln.gesperrt || []).map((s) => String(s).toUpperCase()));
    const hinweise = [];
    let liste = (ziele || []).filter((z) => {
      if (gesperrt.has(z.symbol)) { hinweise.push(`${z.symbol} ist gesperrt und wurde weggelassen.`); return false; }
      return z.gewicht > 0;
    }).map((z) => ({ symbol: z.symbol, gewicht: z.gewicht }));
    if (!liste.length) return { fehler: "Keine Ziele zum Aufteilen." };

    const reserve = budget * regeln.barreservePct / 100;
    const anlegbar = budget - reserve;
    const deckel = budget * regeln.maxPositionPct / 100;

    // Deckel und Mindestorder iterativ, bis sich nichts mehr ändert
    let betraege;
    let gedeckelt;
    for (;;) {
      gedeckelt = new Set();
      for (;;) {
        const frei = liste.filter((z) => !gedeckelt.has(z.symbol));
        const rest = anlegbar - gedeckelt.size * deckel;
        const summe = frei.reduce((s, z) => s + z.gewicht, 0);
        betraege = {};
        for (const z of liste) betraege[z.symbol] = gedeckelt.has(z.symbol) ? deckel : (summe > 0 ? Math.max(0, rest) * z.gewicht / summe : 0);
        const neu = frei.filter((z) => betraege[z.symbol] > deckel + 1e-9);
        if (!neu.length) break;
        neu.forEach((z) => gedeckelt.add(z.symbol));
      }
      const zuKlein = liste.filter((z) => betraege[z.symbol] < regeln.minOrderUsd - 1e-9);
      if (!zuKlein.length) break;
      // die kleinste fällt weg, danach neu rechnen (wie im Vorbild: Gewicht wird verteilt)
      // ab 15e (BUD-S03): bei gleichem Betrag fällt der alphabetisch kleinste Ticker weg (vorher das erste Vorkommen der Eingabe)
      const kleinste = zuKlein.reduce((a, b) => (betraege[b.symbol] < betraege[a.symbol] - 1e-9 || (Math.abs(betraege[b.symbol] - betraege[a.symbol]) <= 1e-9 && b.symbol < a.symbol) ? b : a));
      // ab 15d (BUD-S04): Betrag des Anteils nennen
      hinweise.push(`${kleinste.symbol} fiel weg: Anteil ${(Math.round(betraege[kleinste.symbol] * 100) / 100).toLocaleString("de-DE")} USD unter der Mindestorder von ${regeln.minOrderUsd} USD.`);
      liste = liste.filter((z) => z.symbol !== kleinste.symbol);
      if (!liste.length) return { fehler: "Nach der Mindestorder bleibt keine Aktie übrig.", hinweise };
    }

    // Ganze Dollar, abgerundet (ab 11-05c; vorher „zum nächsten Dollar“ – die Summe konnte bis zu 0,50 USD über dem anlegbaren Betrag
    // liegen und die Barreserve unterschreiten, z. B. „untätig -0,10 USD“). Die Rundungsdollar gehen einzeln an die größten nicht
    // gedeckelten Aktien, nie über den Deckel; die Summe bleibt damit höchstens beim anlegbaren Betrag.
    const gerundet = {};
    for (const z of liste) gerundet[z.symbol] = Math.floor(betraege[z.symbol] + 1e-9);
    for (const s of gedeckelt) gerundet[s] = Math.floor(deckel);
    const ziel = Math.floor(Math.min(anlegbar, liste.reduce((s, z) => s + betraege[z.symbol], 0)) + 1e-9);
    let differenz = ziel - Object.values(gerundet).reduce((s, x) => s + x, 0);
    const freie = liste.filter((z) => !gedeckelt.has(z.symbol)).sort((a, b) => gerundet[b.symbol] - gerundet[a.symbol]);
    for (let i = 0, ohne = 0; differenz > 0 && freie.length && ohne < freie.length; i++) {
      const s = freie[i % freie.length].symbol;
      if (gerundet[s] + 1 <= deckel + 1e-9) { gerundet[s] += 1; differenz--; ohne = 0; } else ohne++;
    }

    const summeG = liste.reduce((s, z) => s + z.gewicht, 0);
    const positionen = liste.map((z) => ({ symbol: z.symbol, gewicht: z.gewicht, dollar: gerundet[z.symbol], gedeckelt: gedeckelt.has(z.symbol), warum: warumText(summeG > 0 ? 100 * z.gewicht / summeG : 0, gedeckelt.has(z.symbol), regeln.maxPositionPct, budget, regeln.quelle) }))
      .sort((a, b) => b.gewicht - a.gewicht); // ab 16j (BUD-S18, wie size.py:317): nach Gewicht absteigend, stabil – bestimmt auch die Order-Reihenfolge
    const angelegt = positionen.reduce((s, p) => s + p.dollar, 0);
    // ab 15d (BUD-S15): Grund und Ausweg für untätiges Geld ab 1 USD auch im Standard-Rechenweg
    const untaetigStd = Math.round((budget - reserve - angelegt) * 100) / 100;
    if (untaetigStd >= 1) hinweise.push(`${untaetigStd.toLocaleString("de-DE")} USD bleiben untätig: jede Aktie ist am Deckel von ${regeln.maxPositionPct} % – weitere Aktien wählen oder einen höheren Deckel einstellen.`);
    for (const p of positionen) if (p.dollar > regeln.maxOrderUsd) hinweise.push(`${p.symbol}: ${p.dollar} USD liegt über dem Höchstbetrag je Order (${regeln.maxOrderUsd} USD) – die Risiko-Prüfung blockiert das.`);
    return {
      budget,
      reserve: Math.round(reserve * 100) / 100,
      untaetig: Math.round((budget - reserve - angelegt) * 100) / 100,
      positionen,
      orders: positionen.map((p) => ({ symbol: p.symbol, side: "buy", notional: String(p.dollar), type: "market", time_in_force: "day" })),
      hinweise,
    };
  }

  // ab AJ5: Skill-Profil – Rechenweg genau wie trader-budget/size.py (Commit 5189e79), nur auf ausdrückliche Wahl in der Oberfläche.
  // Unterschiede zu aufteilen() (JARVIS-Standard, bleibt voreingestellt): Rundung je Aktie zum nächsten Dollar, Zielsumme = abgerundete
  // exakte Summe, Differenz ± in der Reihenfolge des exakten Betrags (size.py:197-231); Mindestorder erst NACH der Rundung, es fällt je
  // Durchgang genau die Aktie mit dem kleinsten Ausgangsgewicht weg (size.py:290-315); Reserve/Deckel mit Python-Rundung (size.py:278-280).
  // Werte wie size.py-Standard (cash_buffer_pct 10, max_position_pct 25, min_order_usd 5: size.py:263-265) = JARVIS STANDARD; den
  // Höchstbetrag je Order kennt size.py nicht – JARVIS warnt weiter ab maxOrderUsd (E-R1, 1.000 USD).
  const EPS = 1e-9;
  function pyRunden(x, stellen) {
    if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return x;
    const genau = Math.abs(x).toFixed(100), punkt = genau.indexOf(".");
    if (!/^50*$/.test(genau.slice(punkt + 1 + stellen))) return Number(x.toFixed(stellen));
    let z = BigInt(genau.slice(0, punkt) + genau.slice(punkt + 1, punkt + 1 + stellen));
    if (z % 2n === 1n) z += 1n;
    const t = z.toString().padStart(stellen + 1, "0");
    return (x < 0 ? -1 : 1) * Number(stellen ? t.slice(0, t.length - stellen) + "." + t.slice(-stellen) : t);
  }
  function aufteilenSkill(budget, ziele, regelnRoh = {}) {
    const regeln = { ...STANDARD, ...regelnRoh };
    if (!(Number(budget) > 0)) return { fehler: "Budget muss größer als 0 sein." };
    budget = Number(budget);
    if (!(regeln.barreservePct >= 0 && regeln.barreservePct < 100)) return { fehler: "Barreserve muss zwischen 0 und 100 % liegen." };
    if (!(regeln.maxPositionPct > 0 && regeln.maxPositionPct <= 100)) return { fehler: "Positionsdeckel muss über 0 und höchstens 100 % liegen." };
    // ab 14zf: Skill-Optionen top (size.py:157-161, --top) und cents (size.py:281, --cents) – nur im Skill-Profil, Standard aus
    if (regeln.top !== undefined && regeln.top !== null && !(Number.isInteger(regeln.top) && regeln.top >= 1)) return { fehler: "Top N muss eine ganze Zahl ab 1 sein." };
    const einheit = regeln.cents ? 0.01 : 1;
    const gesperrt = new Set((regeln.gesperrt || []).map((s) => String(s).toUpperCase())), hinweise = [];
    let keep = [];
    for (const z of ziele || []) {
      if (gesperrt.has(z.symbol)) hinweise.push(`${z.symbol} ist gesperrt und wurde weggelassen.`);
      else if (z.gewicht > 0) keep.push({ symbol: z.symbol, gewicht: z.gewicht });
    }
    keep.sort((a, b) => b.gewicht - a.gewicht); // stabil wie size.py:157
    if (regeln.top) { for (const r of keep.slice(regeln.top)) hinweise.push(`${r.symbol} fiel weg: außerhalb der Top ${regeln.top} (Skill-Option top).`); keep = keep.slice(0, regeln.top); }
    if (!keep.length) return { fehler: "Keine Ziele zum Aufteilen." };
    const reserve = pyRunden(budget * regeln.barreservePct / 100, 2), anlegbar = pyRunden(budget - reserve, 2), deckel = pyRunden(budget * regeln.maxPositionPct / 100, 2);
    const minOrder = Number(regeln.minOrderUsd) || 0;
    let live, exakt, gedeckelt, dollar;
    for (;;) {
      const tot = keep.reduce((s, r) => s + r.gewicht, 0);
      live = keep.map((r) => ({ ...r, anteil: 100 * r.gewicht / tot }));
      // allocate (size.py:169-194)
      exakt = new Map(); gedeckelt = new Set();
      let aktiv = live.slice(), geld = anlegbar;
      while (aktiv.length) {
        const wsum = aktiv.reduce((s, r) => s + r.anteil, 0), versuch = new Map(aktiv.map((r) => [r.symbol, geld * r.anteil / wsum]));
        const ueber = aktiv.filter((r) => versuch.get(r.symbol) > deckel + EPS);
        if (!ueber.length) { for (const r of aktiv) exakt.set(r.symbol, versuch.get(r.symbol)); break; }
        for (const r of ueber) { exakt.set(r.symbol, deckel); gedeckelt.add(r.symbol); geld -= deckel; }
        aktiv = aktiv.filter((r) => !gedeckelt.has(r.symbol));
        if (geld <= EPS) { for (const r of aktiv) exakt.set(r.symbol, 0); break; }
      }
      const reihe = live.slice().sort((a, b) => exakt.get(b.symbol) - exakt.get(a.symbol)).map((r) => r.symbol);
      // round_to_unit mit Einheit 1 USD bzw. 0,01 USD im Cent-Modus (size.py:197-231)
      const einheiten = (x) => Math.floor(x / einheit + EPS), deckelE = einheiten(deckel);
      const ziel = einheiten([...exakt.values()].reduce((s, v) => s + v, 0));
      const aus = {};
      for (const [t, v] of exakt) aus[t] = gedeckelt.has(t) ? deckelE : Math.floor(v / einheit + 0.5 + EPS);
      let diff = ziel - Object.values(aus).reduce((s, v) => s + v, 0);
      const nehmer = reihe.filter((t) => !gedeckelt.has(t));
      for (let schutz = 0; diff !== 0 && nehmer.length && schutz < 100000; schutz++) {
        let bewegt = false;
        for (const t of nehmer) {
          if (diff === 0) break;
          if (diff > 0 && aus[t] + 1 <= deckelE) { aus[t]++; diff--; bewegt = true; }
          else if (diff < 0 && aus[t] > 0) { aus[t]--; diff++; bewegt = true; }
        }
        if (!bewegt) break;
      }
      dollar = Object.fromEntries(Object.entries(aus).map(([t, n]) => [t, pyRunden(n * einheit, 2)]));
      const klein = live.filter((r) => dollar[r.symbol] < minOrder - EPS);
      if (!klein.length) break;
      const schlecht = klein.reduce((a, b) => (b.gewicht < a.gewicht || (b.gewicht === a.gewicht && b.symbol < a.symbol) ? b : a));
      hinweise.push(`${schlecht.symbol} fiel weg: Anteil ${dollar[schlecht.symbol]} USD unter der Mindestorder von ${minOrder} USD (Skill-Regel: nach der Rundung, kleinstes Gewicht zuerst).`);
      keep = keep.filter((r) => r.symbol !== schlecht.symbol);
      if (!keep.length) return { fehler: "Jeder Anteil liegt unter der Mindestorder – Budget erhöhen oder weniger Aktien wählen.", hinweise };
    }
    const positionen = live.slice().sort((a, b) => b.anteil - a.anteil).map((r) => ({ symbol: r.symbol, gewicht: r.gewicht, dollar: dollar[r.symbol], gedeckelt: gedeckelt.has(r.symbol), warum: warumText(r.anteil, gedeckelt.has(r.symbol), regeln.maxPositionPct, budget, regeln.quelle) }));
    const angelegt = pyRunden(positionen.reduce((s, p) => s + p.dollar, 0), 2), untaetig = pyRunden(anlegbar - angelegt, 2);
    if (untaetig >= 1) hinweise.push(`${untaetig.toLocaleString("de-DE")} USD bleiben untätig: jede Aktie ist am Deckel – weitere Aktien wählen oder einen höheren Deckel (Skill: max_position_pct).`);
    for (const p of positionen) if (p.dollar > regeln.maxOrderUsd) hinweise.push(`${p.symbol}: ${p.dollar} USD liegt über dem Höchstbetrag je Order (${regeln.maxOrderUsd} USD) – die Risiko-Prüfung blockiert das.`);
    return { budget, reserve, untaetig, positionen, profil: "skill",
      orders: positionen.filter((p) => p.dollar > 0).map((p) => ({ symbol: p.symbol, side: "buy", notional: String(p.dollar), type: "market", time_in_force: "day" })), hinweise };
  }
  const SKILL_PROFIL = { name: "Skill-Profil trader-budget (Commit 5189e79)", quelle: "trader-budget/size.py", werte: [["Barreserve", "10 %", "size.py:263"], ["Deckel je Aktie", "25 % des Budgets", "size.py:264"], ["Mindestorder", "5 USD", "size.py:265"], ["Rundung", "nächster Dollar, Summe ausgeglichen", "size.py:197-231"]] };

  // ab 15e (trader-budget BUD-S17, size.py:368-385): Vorschlagsdokument – nur Vorschläge, keine Order (status „proposed“, paper true)
  function vorschlagDokument(r, { quelle = null, profil = "jarvis", jetzt = Date.now() } = {}) {
    return { created_by: "JARVIS Budget (" + (profil === "skill" ? "Skill-Profil trader-budget 5189e79" : "JARVIS-Standard") + ")", created_at: new Date(jetzt).toISOString().replace(/\.\d{3}Z$/, "Z"),
      status: "proposed", paper: true, note: "Nur Vorschläge – keine Order. Jede Order einzeln prüfen (Risiko-Prüfung) und ausdrücklich freigeben.",
      // ab 16b (BUD-S16, size.py:349-360): jede Order der Datei trägt ihre Begründung „why“ (die Order für die Risiko-Prüfung bleibt bei 5 Feldern)
      source: quelle, budget: r.budget, reserve: r.reserve, untaetig: r.untaetig, orders: (r.orders || []).map((o) => { const p = (r.positionen || []).find((x) => x.symbol === o.symbol); return { ...o, ...(p && p.warum ? { why: p.warum } : {}) }; }), positionen: (r.positionen || []).map((p) => ({ symbol: p.symbol, dollar: p.dollar, gedeckelt: p.gedeckelt, warum: p.warum })) };
  }
  global.AktienBudget = { vorschlagDokument, aufteilen, aufteilenSkill, zieleLesen, STANDARD, SKILL_PROFIL };
})(typeof window !== "undefined" ? window : globalThis);
