// JARVIS Aktien – historische Simulation (Stufe 2). Reine Rechnung mit vergangenen Tageskerzen, ohne Netzwerk, ohne Order.
// Spielt die Regeln von Entry-Timer und Exit-Planer auf der Vergangenheit durch und vergleicht mit „Kaufen und halten“.
// JARVIS-eigen (nicht im Trader-Skill). Ergebnisse beschreiben nur die Vergangenheit – keine Prognose, kein Renditeversprechen.
//
// Ablauf (bewusst einfach, ohne Blick in die Zukunft):
//   - Signal am Schluss von Kerze i nur aus Daten bis i: Aufwärtstrend (Kurs > EMA50 > EMA200), RSI < rsiMax,
//     Kurs höchstens maxAbstandEma20Pct über der EMA20 → Kauf zur Eröffnung von Kerze i+1 (+ Slippage)
//   - Stop wie Exit-Planer (näherer von stopPct und atrFaktor × ATR an Kerze i), ein Ziel bei zielR × Risiko (ganze Position)
//   - je Kerze nach dem Einstieg: Eröffnung unter Stop → Verkauf zur Eröffnung (Kurslücke); sonst Tief ≤ Stop → zum Stop;
//     sonst Hoch ≥ Ziel → zum Ziel. Berührt eine Kerze beides, zählt vorsichtshalber der Stop.
//   - Nachzieh-Stop ab Erreichen von 1 R: Höchstkurs − trailingPct %, wirksam ab der folgenden Kerze
//   - Zeit-Stop: nach maxHaltetage Kerzen Verkauf zur nächsten Eröffnung; offene Position am Ende zum letzten Schluss bewertet
//   - kein neuer Kauf an einer Kerze, an der verkauft wurde
//   - Gebühr je Ausführung in % des Volumens; Slippage verschlechtert jeden Preis
(function (global) {
  "use strict";

  const STANDARD = {
    startkapital: 10000, gebuehrPct: 0, slippagePct: 0.05,
    einstieg: { rsiMax: 70, maxAbstandEma20Pct: 3 },
    ausstieg: { stopPct: 8, atrFaktor: 2, zielR: 2, trailingPct: 10, maxHaltetage: 60 },
  };
  const HINWEIS = "Historische Simulation mit vergangenen Kursen (Alpaca IEX) – keine Prognose, kein Renditeversprechen, keine Order. Dividenden sind nur über die bereinigten Kurse enthalten.";
  const r2 = (x) => Math.round(x * 100) / 100;

  function simulieren(kerzen, optionenRoh = {}) {
    const T = global.AktienTechnik;
    if (!T) return { fehler: "AktienTechnik fehlt (technik.js nicht geladen)." };
    const o = { ...STANDARD, ...optionenRoh, einstieg: { ...STANDARD.einstieg, ...(optionenRoh.einstieg || {}) }, ausstieg: { ...STANDARD.ausstieg, ...(optionenRoh.ausstieg || {}) } };
    const fehler = T.pruefen(kerzen);
    if (fehler) return { fehler };
    if (!(o.startkapital > 0) || !(o.gebuehrPct >= 0 && o.gebuehrPct <= 5) || !(o.slippagePct >= 0 && o.slippagePct <= 5)) return { fehler: "Ungültige Einstellungen (Startkapital > 0, Gebühr und Slippage 0–5 %)." };
    const ind = T.indikatoren(kerzen);
    const start = ind.ema200.findIndex((x) => x !== null);
    if (start < 0 || kerzen.length - start < 20) return { fehler: `Zu wenige Kerzen: für EMA200 und mindestens 20 Handelstage sind ${200 + 20} nötig (vorhanden ${kerzen.length}).` };

    const gebuehr = o.gebuehrPct / 100, slip = o.slippagePct / 100;
    let kasse = o.startkapital;
    let pos = null;
    const trades = [];
    const verlauf = [];
    let spitze = o.startkapital, maxRueckgang = 0;
    let gebuehrenSumme = 0;

    const verkaufen = (i, roh, grund) => {
      const preis = roh * (1 - slip);
      const volumen = pos.menge * preis;
      const g = volumen * gebuehr;
      kasse += volumen - g;
      gebuehrenSumme += g;
      const ergebnis = volumen - g - pos.einsatz;
      trades.push({
        einstieg: new Date(kerzen[pos.i].t).toISOString().slice(0, 10), ausstieg: new Date(kerzen[i].t).toISOString().slice(0, 10),
        kauf: r2(pos.preis), verkauf: r2(preis), grund, tage: i - pos.i, ergebnis_usd: r2(ergebnis), ergebnis_pct: r2((ergebnis / pos.einsatz) * 100),
        r_vielfaches: r2((preis - pos.preis) / pos.risiko),
      });
      pos = null;
    };

    for (let i = start; i < kerzen.length; i++) {
      const k = kerzen[i];
      // Wer an Kerze i aussteigt, kauft nicht zur Eröffnung derselben Kerze neu (die Eröffnung liegt zeitlich davor)
      const hatteVorher = Boolean(pos);
      if (pos && i > pos.i) {
        const wirksam = Math.max(pos.stop, pos.nachzieh || 0);
        if (k.o <= wirksam) verkaufen(i, k.o, "Kurslücke unter Stop (Eröffnung)");
        else if (k.l <= wirksam) verkaufen(i, wirksam, pos.nachzieh && pos.nachzieh >= pos.stop ? "Nachzieh-Stop" : "Stop");
        else if (k.h >= pos.ziel) verkaufen(i, Math.max(pos.ziel, k.o), "Ziel");
        else if (i - pos.i >= o.ausstieg.maxHaltetage) verkaufen(i, k.o, "Zeit-Stop");
        if (pos) {
          pos.hoechst = Math.max(pos.hoechst, k.h);
          if (pos.hoechst >= pos.preis + pos.risiko) pos.nachzieh = Math.max(pos.nachzieh || 0, pos.hoechst * (1 - o.ausstieg.trailingPct / 100), pos.preis);
        }
      }
      // Kauf zur Eröffnung dieser Kerze, wenn das Signal an der vorigen Kerze stand
      if (!pos && !hatteVorher && i > start && signal(i - 1)) {
        const preis = k.o * (1 + slip);
        const a = ind.atr14[i - 1];
        const stopP = preis * (1 - o.ausstieg.stopPct / 100);
        const stopA = a !== null ? preis - o.ausstieg.atrFaktor * a : -Infinity;
        const stop = Math.max(stopP, stopA);
        const risiko = preis - stop;
        const einsatz = kasse;
        const menge = (einsatz / (1 + gebuehr)) / preis;
        const g = menge * preis * gebuehr;
        gebuehrenSumme += g;
        kasse -= menge * preis + g;
        pos = { i, preis, menge, einsatz, stop, risiko, ziel: preis + o.ausstieg.zielR * risiko, hoechst: k.h, nachzieh: null };
        // Dieselbe Kerze kann den Stop schon reißen (Kauf zur Eröffnung, danach Tief unter Stop) – vorsichtig: Stop zuerst
        if (k.l <= stop) verkaufen(i, stop, "Stop (Einstiegstag)");
        else if (k.h >= pos.ziel) verkaufen(i, pos.ziel, "Ziel (Einstiegstag)");
      }
      const wert = kasse + (pos ? pos.menge * k.c : 0);
      spitze = Math.max(spitze, wert);
      maxRueckgang = Math.max(maxRueckgang, (spitze - wert) / spitze);
      verlauf.push({ t: k.t, wert: r2(wert) });
    }

    function signal(i) {
      const c = kerzen[i].c, e20 = ind.ema20[i], e50 = ind.ema50[i], e200 = ind.ema200[i], rs = ind.rsi14[i];
      if ([e20, e50, e200, rs].some((x) => x === null)) return false;
      return c > e50 && e50 > e200 && rs < o.einstieg.rsiMax && (c / e20 - 1) * 100 <= o.einstieg.maxAbstandEma20Pct;
    }

    const letzte = kerzen[kerzen.length - 1];
    const offen = pos ? { seit: new Date(kerzen[pos.i].t).toISOString().slice(0, 10), kauf: r2(pos.preis), bewertet_zu: letzte.c } : null;
    const endwert = kasse + (pos ? pos.menge * letzte.c : 0);
    const haltenStart = kerzen[start + 1] ? kerzen[start + 1].o : kerzen[start].c;
    const gewinner = trades.filter((t) => t.ergebnis_usd > 0).length;
    return {
      zeitraum: { von: new Date(kerzen[start].t).toISOString().slice(0, 10), bis: new Date(letzte.t).toISOString().slice(0, 10), handelstage: kerzen.length - start },
      startkapital: o.startkapital,
      endwert: r2(endwert),
      rendite_pct: r2((endwert / o.startkapital - 1) * 100),
      kaufen_und_halten_pct: r2((letzte.c / haltenStart - 1) * 100),
      max_rueckgang_pct: r2(maxRueckgang * 100),
      trades,
      anzahl_trades: trades.length,
      trefferquote_pct: trades.length ? r2((gewinner / trades.length) * 100) : null,
      durchschnitt_r: trades.length ? r2(trades.reduce((s, t) => s + t.r_vielfaches, 0) / trades.length) : null,
      gebuehren_usd: r2(gebuehrenSumme),
      offene_position: offen,
      verlauf,
      einstellungen: o,
      hinweis: HINWEIS,
    };
  }

  global.AktienSimulation = { simulieren, STANDARD, HINWEIS };
})(typeof window !== "undefined" ? window : globalThis);
