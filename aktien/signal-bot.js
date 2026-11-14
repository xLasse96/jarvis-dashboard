// JARVIS Aktien – Signal-Bot im Replay (ab 15b). Liefert je Replay-Schritt die VORHANDENEN Signale von Analyse (Systemeinschätzung,
// app/31 einschaetzungBerechnen), Entry-Timer (aktien/einstieg.js) und Exit-Planer (aktien/ausstieg.js) an die Paper-Automatik.
// Keine eigenen Schwellen und keine neuen Regeln – nur Verbindung und Entscheidungstabelle:
//   ohne Position: Kauf nur, wenn die Systemeinschätzung „Kaufkandidat“ ist UND der Entry-Timer „jetzt“ sagt (Kaufkandidat allein reicht nicht);
//   mit Position:  Verkauf nur aus einer Exit-Planer-Aktion über die ganze Position (Stop, Zeit-Stop, Ziel 2). Ein Teilverkauf (Ziel 1) kann
//                  der Paper-Kern nicht buchen (er verkauft nur ganze Positionen) – er wird angezeigt, aber nicht ausgeführt.
// Gebucht wird hier nie: buchen() übergibt eine Entscheidung an PaperKern.orderAusfuehren (Risikoprüfung, Grenzen, Gebühren, Ledger);
// Speichern, Not-Aus und Zustände regelt die Paper-Automatik (app/05).
// Replay-Daten sind immer simuliert: Kerzen bis zum Schritt i (abgeschlossen), Entscheidung am Folgetag zu simulierter Börsenzeit,
// Kurs = Eröffnung des Folgetags. Kein Blick auf spätere Kerzen.
(function (global) {
  "use strict";

  const TAG = 86400000, MIN = 60000;
  const ZEITHINWEIS = "simulierte Börsenzeit: Entscheidung am Folgetag 15:00 UTC (Sitzung bis 16:00 New York, ohne Sommerzeit), Kurs = Eröffnung des Folgetags";
  const MIN_KERZEN = 201; // EMA200 des Entry-Timers braucht 200 Kerzen; ab hier gibt es einen Trend-Befund

  // Replay-Provider für AktienWorkflow.analysieren: zum Schritt i nur die Kerzen 0..i und ein simulierter Kurs/Börsenstand des Folgetags
  function provider(ds, i) {
    const naechste = ds && ds.kerzen && ds.kerzen[i + 1];
    if (!naechste) return null;
    const tag = naechste.t - (naechste.t % TAG), jetzt = tag + 15 * 60 * MIN;
    return {
      name: `Replay ${ds.name} (${ds.synthetisch === false ? "historische Kurse aus Datei" : "synthetische Testkurse"})`,
      beschreibung: `${ds.quelle || "Testdatensatz"} – Replay bis ${new Date(ds.kerzen[i].t).toISOString().slice(0, 10)}; ${ZEITHINWEIS}`,
      // ab 14a: synthetisch nur, wenn der Datensatz synthetisch ist (Kursdatei = echte historische Kurse laut Datei); Börsenzeit und Kurs bleiben simuliert
      synthetisch: ds.synthetisch !== false, replay: true, arten: ["kerzen", "kurs"], jetzt,
      async kerzen() { return ds.kerzen.slice(0, i + 1).map((k) => ({ ...k })); },
      async kurs() { return { symbol: ds.symbol, preis: naechste.o, waehrung: "USD", zeit: new Date(jetzt - 5 * MIN).toISOString() }; },
      async uhr() { return { offen: true, naechste_schliessung: new Date(tag).toISOString().slice(0, 10) + "T16:00:00-05:00", simuliert: true }; },
    };
  }

  // Alle drei Signale zum Schritt i. position: { menge, einstand, seit (Zeit des Kaufs), erledigteZiele } oder null.
  // einschaetzen: Funktion der Analysekarte (einschaetzungBerechnen) – hier übergeben, damit die Regel nur an einer Stelle steht.
  async function bewerten({ ds, i, position = null, einschaetzen, optionen = {} }) {
    const W = global.AktienWorkflow, A = global.AktienAusstieg, T = global.AktienTechnik;
    if (!W || !A || !T) return { fehler: "Module für Analyse, Exit-Planer oder Technik nicht geladen." };
    const pv = provider(ds, i);
    if (!pv) return { fehler: "Kein Folgetag im Datensatz – Replay zu Ende." };
    const r = await W.analysieren({ symbol: ds.symbol }, pv, { jetzt: pv.jetzt, zeitlimitMs: optionen.zeitlimitMs || 3000, ausreisser: optionen.ausreisser || null, simulation: null });
    let einschaetzung = null;
    try { einschaetzung = typeof einschaetzen === "function" ? einschaetzen(r) : null; } catch (e) { einschaetzung = null; }
    const s = (r.schritte || []).find((x) => x.id === "einstieg");
    const einstieg = s ? { status: s.status, urteil: s.details && s.details.urteil ? s.details.urteil : null, text: s.text } : null;
    let plan = null;
    if (position) {
      const kerzen = ds.kerzen.slice(0, i + 1), seit = kerzen.filter((k) => k.t > position.seit), atr = T.atr(kerzen, 14);
      plan = A.planen({ symbol: ds.symbol, einstand: position.einstand, menge: position.menge, kurs: ds.kerzen[i + 1].o, atr: atr[atr.length - 1],
        hoechstkurs: Math.max(position.einstand, ...seit.map((k) => k.h)), tageGehalten: seit.length, erledigteZiele: position.erledigteZiele || [] });
    }
    return { r, einschaetzung, einstieg, plan, jetzt: pv.jetzt, quelle: pv.name, kurs: ds.kerzen[i + 1].o };
  }

  // Entscheidungstabelle (keine neuen Schwellen): { aktion: "kauf" | "verkauf" | "keine", quelle, grund, teilziel? }
  function entscheiden({ einschaetzung, einstieg, plan, position }) {
    if (position) {
      if (!plan || plan.fehler) return { aktion: "keine", quelle: "Exit-Planer", grund: "Exit-Planer: " + ((plan && plan.fehler) || "kein Plan") + " – nichts verkauft" };
      const a = (plan.aktionen || [])[0];
      if (!a) return { aktion: "keine", quelle: "Exit-Planer", grund: `Exit-Planer: halten – wirksamer Stop ${plan.wirksamerStop} (${plan.stopGrund}), Kurs ${plan.kurs}` };
      if (a.anteil >= 100) return { aktion: "verkauf", quelle: "Exit-Planer", grund: `Exit-Planer (${a.art}): ${a.text}` };
      return { aktion: "keine", quelle: "Exit-Planer", teilziel: (plan.ziele.find((z) => !z.erledigt && a.text.includes(`Ziel ${z.r} R`)) || {}).r || null,
        grund: `Exit-Planer (${a.art}): ${a.text} – Teilverkauf kann der Paper-Kern nicht buchen (nur ganze Position), nicht ausgeführt` };
    }
    if (!einschaetzung) return { aktion: "keine", quelle: "Analyse", grund: "Analyse: Systemeinschätzung nicht verfügbar – kein Kauf" };
    if (einschaetzung.kategorie !== "Kaufkandidat") return { aktion: "keine", quelle: "Analyse", grund: `Analyse: ${einschaetzung.kategorie}${einschaetzung.ausgeloest && einschaetzung.ausgeloest[0] ? " – " + einschaetzung.ausgeloest[0] : ""} – kein Kauf` };
    if (!einstieg || einstieg.urteil !== "jetzt") return { aktion: "keine", quelle: "Entry-Timer", grund: `Analyse: Kaufkandidat, aber Entry-Timer ${einstieg ? "„" + (einstieg.urteil || einstieg.status) + "“ – " + String(einstieg.text || "").slice(0, 160) : "ohne Ergebnis"} – Kaufkandidat allein reicht nicht, kein Kauf` };
    return { aktion: "kauf", quelle: "Analyse + Entry-Timer", grund: "Analyse: Kaufkandidat und Entry-Timer „jetzt“ – Kauf" };
  }

  // Übergabe an den gemeinsamen Paper-Pfad: PaperKern.orderAusfuehren (Risikoprüfung mit den übergebenen Grenzen, Gebühren, Ledger).
  // Ausführung zur Eröffnung der Kerze i+1 wie bei jedem Replay; Kennung aus Datensatz, Symbol, Zeit und Seite (gegen Doppelbuchung).
  function buchen(p, { ds, i, seite, wertKauf, annahmen, limits }) {
    const P = global.PaperKern, n = ds.kerzen[i + 1];
    return P.orderAusfuehren(p, { datensatz: "JARVIS-Signale " + ds.name, symbol: ds.symbol, seite, wertKauf: seite === "kauf" ? wertKauf : null,
      signalZeit: ds.kerzen[i].t + TAG, kerze: n, annahmen: P.annahmenNormal(annahmen), limits, kurse: { [ds.symbol]: n.o } });
  }

  global.AktienSignalBot = { provider, bewerten, entscheiden, buchen, ZEITHINWEIS, MIN_KERZEN };
})(typeof window !== "undefined" ? window : globalThis);
