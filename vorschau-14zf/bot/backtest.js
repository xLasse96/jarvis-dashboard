// JARVIS Strategy-Lab – historische Simulation (Backtest) im Paper-Modus.
// Reine Rechnung ohne Netzwerk: Es entsteht nie eine Order, weder Testnet noch Echtgeld.
// Ergebnisse beschreiben nur die Vergangenheit – keine Prognose und kein Renditeversprechen.
//
// Regeln der Simulation (bewusst einfach und nachvollziehbar):
// - nur Long (kaufen → verkaufen), höchstens eine Position gleichzeitig
// - ein Signal entsteht am Schluss einer Kerze und wird zum Eröffnungskurs der NÄCHSTEN Kerze ausgeführt
//   (kein Blick in die Zukunft); ein Signal auf der letzten Kerze wird nicht mehr ausgeführt
// - Kaufpreis = Eröffnung × (1 + Slippage), Verkaufspreis = Eröffnung × (1 − Slippage)
// - Gebühr je Ausführung = Gebühr × Ordervolumen (wie im Paper-Trading: 0,1 %)
// - Kapitalverlauf zum Schlusskurs jeder Kerze; maximaler Rückgang = größter Abstand zum bisherigen Höchststand
(function (global) {
  "use strict";

  const HINWEIS = "Historische Simulation mit festen Daten – keine Prognose, kein Renditeversprechen, keine echte Order.";

  function ema(werte, periode) {
    const k = 2 / (periode + 1);
    const aus = new Array(werte.length).fill(null);
    let summe = 0;
    for (let i = 0; i < werte.length; i++) {
      if (i < periode) {
        summe += werte[i];
        if (i === periode - 1) aus[i] = summe / periode;
      } else {
        aus[i] = werte[i] * k + aus[i - 1] * (1 - k);
      }
    }
    return aus;
  }

  // Strategien: liefern je Kerze "kaufen", "verkaufen" oder null (nur aus Daten bis einschließlich dieser Kerze)
  const STRATEGIEN = {
    "kaufen-und-halten": {
      name: "Kaufen und halten (Vergleich)",
      vorbereiten: () => null,
      signal: (i, kerzen, v, kontext) => (i === ((kontext && kontext.start) || 0) ? "kaufen" : null),
    },
    "ema-kreuzung": {
      name: "EMA-Kreuzung (kurz über/unter lang)",
      vorbereiten: (kerzen, p) => {
        const schluss = kerzen.map((k) => k.c);
        return { kurz: ema(schluss, p.kurz || 9), lang: ema(schluss, p.lang || 21) };
      },
      signal: (i, kerzen, v) => {
        if (i === 0 || v.kurz[i] === null || v.lang[i] === null || v.kurz[i - 1] === null || v.lang[i - 1] === null) return null;
        const vorher = v.kurz[i - 1] - v.lang[i - 1];
        const jetzt = v.kurz[i] - v.lang[i];
        if (vorher <= 0 && jetzt > 0) return "kaufen";
        if (vorher >= 0 && jetzt < 0) return "verkaufen";
        return null;
      },
    },
  };

  function pruefen(kerzen) {
    if (!Array.isArray(kerzen) || kerzen.length === 0) return "Keine Kerzendaten – nichts zu simulieren.";
    for (let i = 0; i < kerzen.length; i++) {
      const k = kerzen[i];
      if (!k || ![k.t, k.o, k.h, k.l, k.c].every(Number.isFinite) || k.o <= 0 || k.c <= 0 || k.h < k.l) return `Ungültige Kerze an Position ${i + 1}.`;
      if (i > 0 && k.t <= kerzen[i - 1].t) return `Zeit nicht aufsteigend an Position ${i + 1}.`;
    }
    return null;
  }

  function runden(x, stellen = 6) { const f = 10 ** stellen; return Math.round(x * f) / f; }

  function backtest(kerzen, optionen = {}) {
    const startkapital = optionen.startkapital ?? 10000;
    const gebuehr = optionen.gebuehr ?? 0.001;
    const slippage = optionen.slippage ?? 0;
    const strategieName = optionen.strategie || "ema-kreuzung";
    const strategie = STRATEGIEN[strategieName];
    const basis = { art: "historische Simulation", hinweis: HINWEIS, strategie: strategieName };
    if (!strategie) return { ...basis, fehler: "Unbekannte Strategie: " + strategieName };
    if (!(startkapital > 0) || !(gebuehr >= 0 && gebuehr < 0.1) || !(slippage >= 0 && slippage < 0.1)) {
      return { ...basis, fehler: "Ungültige Einstellungen (Startkapital > 0, Gebühr und Slippage zwischen 0 und 10 %)." };
    }
    const fehler = pruefen(kerzen);
    if (fehler) return { ...basis, fehler };
    // handelAb: gehandelt und bewertet wird erst ab dieser Kerze; frühere Kerzen dienen nur als Vorlauf für Indikatoren
    // (Vergangenheit – erlaubt). So rechnet der Prüfzeitraum mit eingeschwungenen Indikatoren, ohne vorher zu handeln.
    const start = optionen.handelAb ?? 0;
    if (!Number.isInteger(start) || start < 0 || start >= kerzen.length) return { ...basis, fehler: "Ungültiger Beginn des Handelszeitraums." };

    const vorbereitet = strategie.vorbereiten(kerzen, optionen.parameter || {});
    let bargeld = startkapital;
    let menge = 0;
    let offen = null; // { einstieg_zeit, einstieg_preis, menge, gebuehr, kosten }
    let geplant = null;
    const trades = [];
    let gebuehrenGesamt = 0;
    let hoch = startkapital;
    let maxRueckgang = 0;
    const verlauf = [];

    for (let i = start; i < kerzen.length; i++) {
      const k = kerzen[i];
      // 1. Signal der Vorkerze zur Eröffnung ausführen
      if (geplant === "kaufen" && !offen) {
        const preis = k.o * (1 + slippage);
        const g = bargeld * gebuehr;
        menge = (bargeld - g) / preis;
        offen = { einstieg_zeit: k.t, einstieg_preis: preis, menge, gebuehr: g, kosten: bargeld };
        gebuehrenGesamt += g;
        bargeld = 0;
      } else if (geplant === "verkaufen" && offen) {
        const preis = k.o * (1 - slippage);
        const erloes = menge * preis;
        const g = erloes * gebuehr;
        bargeld = erloes - g;
        gebuehrenGesamt += g;
        trades.push({
          einstieg_zeit: offen.einstieg_zeit, einstieg_preis: runden(offen.einstieg_preis), ausstieg_zeit: k.t, ausstieg_preis: runden(preis),
          menge: runden(menge, 8), gebuehren_usdt: runden(offen.gebuehr + g), ergebnis_usdt: runden(bargeld - offen.kosten),
          ergebnis_prozent: runden(((bargeld - offen.kosten) / offen.kosten) * 100, 4),
        });
        menge = 0;
        offen = null;
      }
      geplant = null;
      // 2. Kapital zum Schluss bewerten, Rückgang messen
      const wert = bargeld + menge * k.c;
      if (wert > hoch) hoch = wert;
      maxRueckgang = Math.max(maxRueckgang, (hoch - wert) / hoch);
      verlauf.push({ t: k.t, wert: runden(wert, 4) });
      // 3. Neues Signal für die nächste Kerze (nur mit Daten bis hier)
      if (i < kerzen.length - 1) {
        const s = strategie.signal(i, kerzen, vorbereitet, { start });
        if ((s === "kaufen" && !offen) || (s === "verkaufen" && offen)) geplant = s;
      }
    }

    const letzter = kerzen[kerzen.length - 1].c;
    const endwert = bargeld + menge * letzter;
    return {
      ...basis,
      zeitraum: { von: kerzen[start].t, bis: kerzen[kerzen.length - 1].t, kerzen: kerzen.length - start, vorlauf_kerzen: start },
      einstellungen: { startkapital, gebuehr_prozent: gebuehr * 100, slippage_prozent: slippage * 100, parameter: optionen.parameter || {} },
      trades,
      anzahl_trades: trades.length,
      gewinn_trades: trades.filter((t) => t.ergebnis_usdt > 0).length,
      offene_position: offen ? { einstieg_zeit: offen.einstieg_zeit, einstieg_preis: runden(offen.einstieg_preis), menge: runden(menge, 8), wert_usdt: runden(menge * letzter), ergebnis_usdt: runden(menge * letzter - offen.kosten) } : null,
      endwert_usdt: runden(endwert),
      gewinn_usdt: runden(endwert - startkapital),
      gewinn_prozent: runden(((endwert - startkapital) / startkapital) * 100, 4),
      gebuehren_usdt: runden(gebuehrenGesamt),
      max_rueckgang_prozent: runden(maxRueckgang * 100, 4),
      verlauf,
    };
  }

  // Studie mit Entwicklungs- und Prüfzeitraum:
  // - Die Kerzen werden zeitlich geteilt (anteilEntwicklung, Standard 70 %). Parameter werden – falls ein Raster
  //   angegeben ist – NUR auf dem Entwicklungszeitraum gewählt (bestes Ergebnis nach Kosten). Der Prüfzeitraum wird
  //   danach genau einmal mit diesen Parametern gerechnet: Er beeinflusst keine Entscheidung (kein Datenleck).
  // - Für den Prüfzeitraum laufen Indikatoren über die Vergangenheit ein (handelAb), gehandelt wird erst ab seiner ersten Kerze.
  // - Vergleich je Zeitraum mit „Kaufen und halten“ unter denselben Kosten.
  const MIN_PRUEF_KERZEN = 30;
  function kurz(r) {
    const { verlauf, ...rest } = r; // Verlauf nur im JSON-Export der Einzelrechnung
    return rest;
  }
  function studie(kerzen, optionen = {}) {
    const strategieName = optionen.strategie || "ema-kreuzung";
    const basis = { art: "historische Simulation (Studie)", hinweis: HINWEIS, strategie: strategieName };
    const fehler = pruefen(kerzen);
    if (fehler) return { ...basis, fehler };
    if (!STRATEGIEN[strategieName]) return { ...basis, fehler: "Unbekannte Strategie: " + strategieName };
    const anteil = optionen.anteilEntwicklung ?? 0.7;
    if (!(anteil >= 0.3 && anteil <= 0.9)) return { ...basis, fehler: "Entwicklungsanteil muss zwischen 30 und 90 % liegen." };
    const grenze = Math.floor(kerzen.length * anteil);
    if (grenze < 2 || kerzen.length - grenze < 2) return { ...basis, fehler: "Zu wenige Kerzen für zwei Zeiträume." };
    const entwicklung = kerzen.slice(0, grenze);
    const kosten = { startkapital: optionen.startkapital, gebuehr: optionen.gebuehr, slippage: optionen.slippage };

    // Parameterwahl nur mit Entwicklungsdaten
    const raster = Array.isArray(optionen.raster) && optionen.raster.length ? optionen.raster.slice(0, 200) : [optionen.parameter || {}];
    const rasterErgebnisse = raster.map((parameter) => {
      const r = backtest(entwicklung, { ...kosten, strategie: strategieName, parameter });
      return { parameter, gewinn_prozent: r.fehler ? null : r.gewinn_prozent, fehler: r.fehler || null };
    });
    const gueltig = rasterErgebnisse.filter((x) => x.gewinn_prozent !== null);
    if (!gueltig.length) return { ...basis, fehler: rasterErgebnisse[0].fehler || "Keine gültige Parameterkombination." };
    const gewaehlt = gueltig.reduce((best, x) => (x.gewinn_prozent > best.gewinn_prozent ? x : best)).parameter;

    const rechnen = (daten, start) => ({
      strategie: kurz(backtest(daten, { ...kosten, strategie: strategieName, parameter: gewaehlt, handelAb: start })),
      kaufen_und_halten: kurz(backtest(daten, { ...kosten, strategie: "kaufen-und-halten", handelAb: start })),
    });
    const ent = rechnen(entwicklung, 0);
    const pruef = rechnen(kerzen, grenze); // ganze Reihe als Vorlauf, gehandelt erst ab dem Prüfzeitraum
    const pp = (x) => Math.round((x.strategie.gewinn_prozent - x.kaufen_und_halten.gewinn_prozent) * 100) / 100;
    const warnungen = [];
    if (kerzen.length - grenze < MIN_PRUEF_KERZEN) warnungen.push("Prüfzeitraum sehr kurz (" + (kerzen.length - grenze) + " Kerzen) – geringe Aussagekraft.");
    if (raster.length > 1 && ent.strategie.gewinn_prozent - pruef.strategie.gewinn_prozent > 10) warnungen.push("Im Prüfzeitraum deutlich schwächer als in der Entwicklung – Hinweis auf Überanpassung der Parameter.");
    if (pruef.strategie.anzahl_trades === 0 && !pruef.strategie.offene_position) warnungen.push("Im Prüfzeitraum kein einziger Trade – Ergebnis sagt nichts über die Strategie aus.");
    return {
      ...basis,
      teilung: { anteil_entwicklung_prozent: Math.round(anteil * 100), entwicklung: { von: kerzen[0].t, bis: kerzen[grenze - 1].t, kerzen: grenze },
        pruefung: { von: kerzen[grenze].t, bis: kerzen[kerzen.length - 1].t, kerzen: kerzen.length - grenze } },
      parameter: gewaehlt,
      raster_ergebnisse: raster.length > 1 ? rasterErgebnisse : [],
      entwicklung: ent,
      pruefung: pruef,
      vergleich: { entwicklung_prozentpunkte: pp(ent), pruefung_prozentpunkte: pp(pruef) },
      warnungen,
    };
  }

  // Export: CSV der Trades (Semikolon, Dezimalkomma, Schutz vor Tabellenformeln) und JSON des ganzen Ergebnisses
  function csvZelle(wert) {
    let s = typeof wert === "number" ? String(wert).replace(".", ",") : String(wert ?? "");
    if (/^[=+\-@\t\r]/.test(s) && typeof wert !== "number") s = "'" + s;
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function alsCsv(ergebnis) {
    const kopf = ["Zeitraum", "Strategie", "Einstieg", "Einstiegspreis", "Ausstieg", "Ausstiegspreis", "Menge", "Gebühren USDT", "Ergebnis USDT", "Ergebnis %"];
    const zeilen = [kopf];
    const iso = (t) => new Date(t).toISOString();
    const abschnitte = ergebnis.entwicklung
      ? [["Entwicklung", ergebnis.entwicklung], ["Prüfung", ergebnis.pruefung]]
      : [["Gesamt", { strategie: ergebnis }]];
    for (const [name, teil] of abschnitte) {
      for (const [art, r] of Object.entries(teil)) {
        for (const t of r.trades || []) zeilen.push([name, art === "strategie" ? r.strategie : "kaufen-und-halten", iso(t.einstieg_zeit), t.einstieg_preis, iso(t.ausstieg_zeit), t.ausstieg_preis, t.menge, t.gebuehren_usdt, t.ergebnis_usdt, t.ergebnis_prozent]);
      }
    }
    return "﻿" + zeilen.map((z) => z.map(csvZelle).join(";")).join("\r\n") + "\r\n";
  }
  function alsJson(ergebnis) { return JSON.stringify(ergebnis, null, 2); }

  global.StrategieLab = { backtest, studie, alsCsv, alsJson, STRATEGIEN, ema, HINWEIS, MIN_PRUEF_KERZEN };
})(typeof window !== "undefined" ? window : globalThis);
