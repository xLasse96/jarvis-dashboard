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

  // ab 15c: SEC-Kennzahlen (companyfacts) im Replay ohne Blick nach vorn. faktenBis liefert eine Kopie, die je Wert nur Einträge enthält,
  // die bis einschließlich „bis“ (JJJJ-MM-TT) bei der SEC eingereicht waren (Feld „filed“); Einträge ohne gültiges filed-Datum zählen nie
  // (Zeitpunkt unbekannt). Spätere Korrekturen (10-K/A) erscheinen damit erst ab ihrem eigenen Einreichungstag.
  const FILED = /^\d{4}-\d{2}-\d{2}$/;
  function faktenBis(cf, bis) {
    const facts = {};
    for (const [ns, konzepte] of Object.entries((cf && cf.facts) || {})) {
      facts[ns] = {};
      for (const [k, knoten] of Object.entries(konzepte || {})) {
        const units = {};
        for (const [u, liste] of Object.entries((knoten && knoten.units) || {})) units[u] = (Array.isArray(liste) ? liste : []).filter((f) => f && FILED.test(f.filed || "") && f.filed <= bis);
        facts[ns][k] = { ...knoten, units };
      }
    }
    return { ...cf, facts };
  }
  // Prüfung einer companyfacts-Datei vor der Übernahme: facts mit us-gaap, CIK, mindestens ein Wert mit filed-Datum, kein filed nach heute
  function secDateiPruefen(cf, { heute = new Date().toISOString().slice(0, 10) } = {}) {
    if (!cf || typeof cf !== "object" || !cf.facts || typeof cf.facts !== "object") return { ok: false, fehler: "Feld „facts“ fehlt – keine companyfacts-Datei der SEC." };
    if (!cf.facts["us-gaap"]) return { ok: false, fehler: "keine us-gaap-Werte in der Datei." };
    const cik = Number(cf.cik);
    if (!Number.isInteger(cik) || cik <= 0) return { ok: false, fehler: "CIK fehlt oder ist ungültig." };
    let n = 0, ohne = 0, von = null, bis = null;
    for (const konzepte of Object.values(cf.facts)) for (const knoten of Object.values(konzepte || {})) for (const liste of Object.values((knoten && knoten.units) || {})) {
      for (const f of Array.isArray(liste) ? liste : []) {
        if (!f || !FILED.test(f.filed || "")) { ohne++; continue; }
        n++;
        if (!von || f.filed < von) von = f.filed;
        if (!bis || f.filed > bis) bis = f.filed;
      }
    }
    if (!n) return { ok: false, fehler: "keine Werte mit Einreichungsdatum (filed)." };
    if (bis > heute) return { ok: false, fehler: `Einreichungsdatum nach heute (${bis}) – die Datei ist fehlerhaft.` };
    return { ok: true, cik, firma: String(cf.entityName || "unbekannt").slice(0, 80), fakten: n, ohneFiled: ohne, filedVon: von, filedBis: bis };
  }

  // Replay-Provider für AktienWorkflow.analysieren: zum Schritt i nur die Kerzen 0..i und ein simulierter Kurs/Börsenstand des Folgetags
  function provider(ds, i) {
    const naechste = ds && ds.kerzen && ds.kerzen[i + 1];
    if (!naechste) return null;
    const tag = naechste.t - (naechste.t % TAG), jetzt = tag + 15 * 60 * MIN;
    // ab 15c: SEC-Werte nur zu echten Kursen (Kursdatei) und nur, was bis zum Tag der letzten abgeschlossenen Kerze i eingereicht war –
    // vorsichtig: eine Meldung vom Entscheidungstag selbst zählt erst am nächsten Schritt
    const secBis = new Date(ds.kerzen[i].t).toISOString().slice(0, 10), sec = ds.synthetisch === false && ds.secFakten && ds.secFakten.daten ? ds.secFakten : null;
    return {
      name: `Replay ${ds.name} (${ds.synthetisch === false ? (ds.herkunft === "worker" ? "historische Tageskurse über deinen Worker (Alpaca, Feed IEX)" : "historische Kurse aus Datei") : "synthetische Testkurse"})`,
      beschreibung: `${ds.quelle || "Testdatensatz"} – Replay bis ${secBis}; ${ZEITHINWEIS}` + (sec ? `; SEC-Kennzahlen aus „${sec.name}“ (CIK ${sec.cik}), nur bis ${secBis} eingereicht` : ""),
      // ab 14a: synthetisch nur, wenn der Datensatz synthetisch ist (Kursdatei = echte historische Kurse laut Datei); Börsenzeit und Kurs bleiben simuliert
      synthetisch: ds.synthetisch !== false, replay: true, arten: ["kerzen", "kurs"], jetzt, secBis: sec ? secBis : null,
      async kerzen() { return ds.kerzen.slice(0, i + 1).map((k) => ({ ...k })); },
      async kurs() { return { symbol: ds.symbol, preis: naechste.o, waehrung: "USD", zeit: new Date(jetzt - 5 * MIN).toISOString() }; },
      async uhr() { return { offen: true, naechste_schliessung: new Date(tag).toISOString().slice(0, 10) + "T16:00:00-05:00", simuliert: true }; },
      ...(sec ? { async secFakten() { return faktenBis(sec.daten, secBis); } } : {}),
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
    // ab 15c: SEC-Stand dieses Schritts (nur mit SEC-Datei): Stichtag der Einreichungen, letztes Quartal, Status des SEC-Schritts
    const s6 = (r.schritte || []).find((x) => x.id === "sec");
    const sec = pv.secBis ? { bis: pv.secBis, status: s6 ? s6.status : null, quartal: s6 && s6.details && s6.details.period_end ? s6.details.period_end : null, text: s6 ? s6.text : null } : null;
    return { r, einschaetzung, einstieg, plan, jetzt: pv.jetzt, quelle: pv.name, kurs: ds.kerzen[i + 1].o, sec };
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

  global.AktienSignalBot = { provider, bewerten, entscheiden, buchen, faktenBis, secDateiPruefen, ZEITHINWEIS, MIN_KERZEN };
})(typeof window !== "undefined" ? window : globalThis);
