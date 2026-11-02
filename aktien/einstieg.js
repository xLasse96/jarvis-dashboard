// JARVIS Aktien – Entry-Timer (Stufe 2). Reine Rechnung ohne Netzwerk: sagt nur, ob ein Kauf nach festen Regeln gerade
// „im Rahmen“ liegt, worauf zu warten ist und ab wann frühestens. Er sendet nie etwas; ein Vorschlag geht den Weg der
// Stufe 1 (Risiko-Prüfung im Worker → Freigabe genau dieser Order durch den Nutzer). JARVIS-eigen (nicht im Trader-Skill).
//
// Regeln (einstellbar):
//   Börse         nur bei offener US-Börse; nicht in den ersten 15 und letzten 15 Minuten (Eröffnungs-/Schlussschwankung)
//   Trend         Kurs über EMA50 und EMA50 über EMA200 (abschaltbar)
//   RSI           unter 70 (sonst Rücksetzer abwarten)
//   Abstand       Kurs höchstens 3 % über der EMA20 (sonst „überdehnt“, Zielzone bis EMA20 + 3 %)
//   Zahlen        nicht in den 3 Tagen vor voraussichtlichen Quartalszahlen (Termin ist oft nur geschätzt)
//   Daten         jüngste Tageskerze höchstens 5 Kalendertage alt (sonst „Kursdaten veraltet“)
// Sitzungsbeginn: aus Alpacas nächster Schließung (16:00 New York → Beginn 6,5 h früher; 13:00 bei verkürztem Handel → 3,5 h).
(function (global) {
  "use strict";

  const STANDARD = { minNachOeffnungMin: 15, minVorSchlussMin: 15, trendPflicht: true, rsiMax: 70, maxAbstandEma20Pct: 3, vorZahlenTage: 3, maxKerzenAlterTage: 5 };
  const HINWEIS = "Regelbasierte Einordnung, keine Empfehlung. Ein Kauf braucht weiter Risiko-Prüfung und deine Freigabe genau dieser Order.";
  const MIN = 60000;

  function sitzungsBeginn(naechsteSchliessung) {
    const ende = Date.parse(naechsteSchliessung || "");
    if (!Number.isFinite(ende)) return null;
    const ortszeit = /T(\d{2}):(\d{2})/.exec(naechsteSchliessung);
    const verkuerzt = ortszeit && Number(ortszeit[1]) === 13;
    return ende - (verkuerzt ? 210 : 390) * MIN;
  }

  // eingabe: { kerzen (Tageskerzen, aufsteigend), uhr: {offen, naechste_oeffnung, naechste_schliessung}, jetzt (ms),
  //            regeln, zahlenTermin: {datum: "JJJJ-MM-TT", geschaetzt: bool} | null, letzteLaufend }
  function bewerten(eingabe) {
    const regeln = { ...STANDARD, ...(eingabe.regeln || {}) };
    const T = global.AktienTechnik;
    if (!T) return { fehler: "AktienTechnik fehlt (technik.js nicht geladen)." };
    const fehler = T.pruefen(eingabe.kerzen);
    if (fehler) return { fehler };
    const kerzen = eingabe.kerzen;
    const jetzt = Number.isFinite(eingabe.jetzt) ? eingabe.jetzt : Date.now();
    const ind = T.indikatoren(kerzen);
    // Während der Sitzung ist die heutige Tageskerze unfertig: Trend/RSI aus der letzten abgeschlossenen, Kurs aus der laufenden
    const i = eingabe.letzteLaufend && kerzen.length > 1 ? kerzen.length - 2 : kerzen.length - 1;
    const kurs = kerzen[kerzen.length - 1].c;
    const e20 = ind.ema20[i], e50 = ind.ema50[i], e200 = ind.ema200[i], rs = ind.rsi14[i];
    const warten = [];
    const nicht = [];
    const ok = [];
    let fruehestens = null;

    // Veraltete Daten (z. B. Datenausfall): jüngste Tageskerze älter als maxKerzenAlterTage Kalendertage → nicht auf alten Kurs handeln
    const alterTage = (jetzt - kerzen[kerzen.length - 1].t) / 86400000;
    if (alterTage > regeln.maxKerzenAlterTage) warten.push(`Kursdaten veraltet: jüngste Tageskerze ist ${Math.floor(alterTage)} Tage alt – erst mit aktuellen Daten prüfen.`);

    const uhr = eingabe.uhr;
    if (!uhr || typeof uhr.offen !== "boolean") {
      warten.push("Börsenuhr unbekannt – ohne sie keine Zeitprüfung.");
    } else if (!uhr.offen) {
      const auf = Date.parse(uhr.naechste_oeffnung || "");
      fruehestens = Number.isFinite(auf) ? auf + regeln.minNachOeffnungMin * MIN : null;
      warten.push("US-Börse geschlossen" + (fruehestens ? "" : " (nächste Öffnung unbekannt)") + ".");
    } else {
      const beginn = sitzungsBeginn(uhr.naechste_schliessung);
      const ende = Date.parse(uhr.naechste_schliessung || "");
      if (beginn !== null && jetzt < beginn + regeln.minNachOeffnungMin * MIN) {
        fruehestens = beginn + regeln.minNachOeffnungMin * MIN;
        warten.push(`Erste ${regeln.minNachOeffnungMin} Minuten nach Börsenbeginn – Eröffnungsschwankung abwarten.`);
      } else if (Number.isFinite(ende) && jetzt > ende - regeln.minVorSchlussMin * MIN) {
        const auf = Date.parse(uhr.naechste_oeffnung || "");
        fruehestens = Number.isFinite(auf) ? auf + regeln.minNachOeffnungMin * MIN : null;
        warten.push(`Letzte ${regeln.minVorSchlussMin} Minuten vor Börsenschluss – bis zur nächsten Sitzung warten.`);
      } else {
        ok.push("Börse offen, außerhalb der ersten und letzten Minuten.");
      }
    }

    if (regeln.trendPflicht) {
      if (e50 === null || e200 === null) nicht.push("Trend nicht prüfbar (zu wenige Kerzen für EMA200).");
      else if (!(kurs > e50 && e50 > e200)) nicht.push("Kein Aufwärtstrend (Kurs über EMA50 über EMA200 nicht erfüllt).");
      else ok.push("Aufwärtstrend.");
    }
    if (rs === null) warten.push("RSI nicht berechenbar.");
    else if (rs >= regeln.rsiMax) warten.push(`RSI ${rs.toFixed(1)} ≥ ${regeln.rsiMax}: überkauft – Rücksetzer abwarten.`);
    else ok.push(`RSI ${rs.toFixed(1)} unter ${regeln.rsiMax}.`);

    let zielzone = null;
    if (e20 !== null) {
      const abstand = (kurs / e20 - 1) * 100;
      zielzone = { ema20: Math.round(e20 * 100) / 100, bis: Math.round(e20 * (1 + regeln.maxAbstandEma20Pct / 100) * 100) / 100 };
      if (abstand > regeln.maxAbstandEma20Pct) warten.push(`Überdehnt: Kurs ${abstand.toFixed(1)} % über der EMA20 – Rücksetzer in die Zone bis ${zielzone.bis} abwarten.`);
      else ok.push(`Kurs ${abstand.toFixed(1)} % zur EMA20 (Grenze ${regeln.maxAbstandEma20Pct} %).`);
    }

    const termin = eingabe.zahlenTermin;
    if (termin && /^\d{4}-\d{2}-\d{2}$/.test(termin.datum)) {
      const tage = (Date.parse(termin.datum + "T00:00:00Z") - jetzt) / 86400000;
      if (tage >= -1 && tage <= regeln.vorZahlenTage) {
        warten.push(`Quartalszahlen ${termin.geschaetzt ? "voraussichtlich (Schätzung) " : ""}am ${termin.datum} – kurz davor schwankt der Kurs oft stark.`);
      }
    }

    const urteil = nicht.length ? "nicht" : warten.length ? "warten" : "jetzt";
    return {
      urteil,
      text: { jetzt: "Einstieg liegt im Rahmen der Regeln.", warten: "Warten.", nicht: "Regeln nicht erfüllt – kein Einstieg nach diesem Plan." }[urteil],
      gruende: [...nicht, ...warten],
      erfuellt: ok,
      fruehestens: fruehestens ? new Date(fruehestens).toISOString() : null,
      kurs,
      zielzone,
      hinweis: HINWEIS,
    };
  }

  // Nur ein Vorschlag im Format der Stufe 1 – wird vom Dashboard an /aktien/pruefen gegeben, nie direkt gesendet
  function orderVorschlag(symbol, betragUsd) {
    const b = Math.floor(Number(betragUsd) * 100) / 100;
    if (!(b > 0)) return null;
    return { symbol: String(symbol).toUpperCase(), side: "buy", notional: String(b), type: "market", time_in_force: "day" };
  }

  global.AktienEinstieg = { bewerten, orderVorschlag, sitzungsBeginn, STANDARD, HINWEIS };
})(typeof window !== "undefined" ? window : globalThis);
