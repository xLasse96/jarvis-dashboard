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
  function zieleLesen(text) {
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
      const kleinste = zuKlein.reduce((a, b) => (betraege[b.symbol] < betraege[a.symbol] ? b : a));
      hinweise.push(`${kleinste.symbol} fiel weg: Anteil unter der Mindestorder von ${regeln.minOrderUsd} USD.`);
      liste = liste.filter((z) => z.symbol !== kleinste.symbol);
      if (!liste.length) return { fehler: "Nach der Mindestorder bleibt keine Aktie übrig.", hinweise };
    }

    // Ganze Dollar; Rundungsrest an die größte nicht gedeckelte Aktie (nur bis zum Deckel)
    const gerundet = {};
    for (const z of liste) gerundet[z.symbol] = Math.round(betraege[z.symbol]);
    for (const s of gedeckelt) gerundet[s] = Math.floor(deckel);
    const ziel = Math.round(Math.min(anlegbar, liste.reduce((s, z) => s + betraege[z.symbol], 0)));
    let differenz = ziel - Object.values(gerundet).reduce((s, x) => s + x, 0);
    const freie = liste.filter((z) => !gedeckelt.has(z.symbol)).sort((a, b) => gerundet[b.symbol] - gerundet[a.symbol]);
    if (freie.length && differenz !== 0) gerundet[freie[0].symbol] += differenz;
    differenz = 0;

    const positionen = liste.map((z) => ({ symbol: z.symbol, gewicht: z.gewicht, dollar: gerundet[z.symbol], gedeckelt: gedeckelt.has(z.symbol) }))
      .sort((a, b) => b.dollar - a.dollar);
    const angelegt = positionen.reduce((s, p) => s + p.dollar, 0);
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

  global.AktienBudget = { aufteilen, zieleLesen, STANDARD };
})(typeof window !== "undefined" ? window : globalThis);
