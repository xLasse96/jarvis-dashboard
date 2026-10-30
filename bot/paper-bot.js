// JARVIS Paper-Bot – regelbasierter Handel mit virtuellem Guthaben, Kerze für Kerze (laufende Simulation).
// Reine Rechnung ohne Netzwerk: Dieses Modul kennt weder Worker noch Börse und sendet nie eine Order –
// weder Testnet noch Echtgeld. Jede „Order“ ist ein Journaleintrag mit simuliert: true.
// Braucht module/strategie-lab/backtest.js (Strategien und Indikatoren, global StrategieLab).
//
// Regeln (gleich wie im Strategy-Lab, damit Backtest und Bot dieselben Ergebnisse liefern):
// - nur Long, höchstens eine Position; Signal am Schluss einer Kerze, Ausführung zur Eröffnung der NÄCHSTEN Kerze
// - Kaufpreis = Eröffnung × (1 + Slippage), Verkaufspreis = Eröffnung × (1 − Slippage), Gebühr 0,1 % je Ausführung
// Zusätzlich (nur im Bot): Einsatzanteil je Kauf, Stop-Verlust (Prüfung zum Schluss, Verkauf zur nächsten Eröffnung),
// Höchstzahl simulierter Orders (danach hält der Bot von selbst an), Start/Anhalten von Hand.
(function (global) {
  "use strict";

  const HINWEIS = "Paper-Bot: Simulation mit virtuellem Guthaben – keine echte Order, weder Testnet noch Echtgeld; keine Prognose.";
  const MAX_KERZEN = 5000; // Verlauf für die Indikatoren (älteres wird verworfen)

  function runden(x, stellen = 6) { const f = 10 ** stellen; return Math.round(x * f) / f; }

  function kerzeFehler(k, vorher) {
    if (!k || ![k.t, k.o, k.h, k.l, k.c].every(Number.isFinite) || k.o <= 0 || k.c <= 0 || k.h < k.l) return "Ungültige Kerze.";
    if (vorher && k.t <= vorher.t) return "Zeit nicht aufsteigend – Kerze ignoriert.";
    return null;
  }

  function einstellungenPruefen(e) {
    if (!(e.startkapital > 0)) return "Startkapital muss größer als 0 sein.";
    if (!(e.gebuehr >= 0 && e.gebuehr < 0.1) || !(e.slippage >= 0 && e.slippage < 0.1)) return "Gebühr und Slippage müssen zwischen 0 und 10 % liegen.";
    if (!(e.einsatzAnteil > 0 && e.einsatzAnteil <= 1)) return "Einsatzanteil muss zwischen 0 und 100 % liegen.";
    if (e.stopVerlust !== null && !(e.stopVerlust > 0 && e.stopVerlust < 1)) return "Stop-Verlust muss zwischen 0 und 100 % liegen (oder aus).";
    if (!(Number.isInteger(e.maxOrders) && e.maxOrders > 0 && e.maxOrders <= 1000)) return "Höchstzahl der Orders muss zwischen 1 und 1000 liegen.";
    if (!global.StrategieLab || !global.StrategieLab.STRATEGIEN[e.strategie]) return "Unbekannte Strategie: " + e.strategie;
    return null;
  }

  // zustand: vollständiger, als JSON speicherbarer Stand (für späteres Speichern im Browser)
  function bot(zustand) {
    const z = zustand;
    const strategie = () => global.StrategieLab.STRATEGIEN[z.einstellungen.strategie];

    function wert(kurs) { return z.bargeld + (z.position ? z.position.menge * kurs : 0); }

    function ausfuehren(k) {
      const e = z.einstellungen;
      const plan = z.geplant;
      z.geplant = null;
      if (!plan) return null;
      if (plan.seite === "kauf" && !z.position) {
        const preis = k.o * (1 + e.slippage);
        const einsatz = e.einsatzAnteil >= 1 ? z.bargeld : z.bargeld * e.einsatzAnteil;
        const gebuehr = einsatz * e.gebuehr;
        const menge = (einsatz - gebuehr) / preis;
        z.bargeld -= einsatz;
        z.gebuehren += gebuehr;
        z.position = { menge, einstieg_preis: preis, einstieg_zeit: k.t, kosten: einsatz };
        return eintragen({ zeit: k.t, seite: "kauf", preis, menge, betrag_usdt: einsatz, gebuehr_usdt: gebuehr, grund: plan.grund });
      }
      if (plan.seite === "verkauf" && z.position) {
        const preis = k.o * (1 - e.slippage);
        const erloes = z.position.menge * preis;
        const gebuehr = erloes * e.gebuehr;
        const p = z.position;
        z.bargeld += erloes - gebuehr;
        z.gebuehren += gebuehr;
        z.position = null;
        const ergebnis = erloes - gebuehr - p.kosten;
        z.trades.push({ einstieg_zeit: p.einstieg_zeit, einstieg_preis: runden(p.einstieg_preis), ausstieg_zeit: k.t, ausstieg_preis: runden(preis),
          menge: runden(p.menge, 8), ergebnis_usdt: runden(ergebnis), ergebnis_prozent: runden((ergebnis / p.kosten) * 100, 4), grund: plan.grund });
        return eintragen({ zeit: k.t, seite: "verkauf", preis, menge: p.menge, betrag_usdt: erloes, gebuehr_usdt: gebuehr, grund: plan.grund });
      }
      return null;
    }

    function eintragen(o) {
      const eintrag = { nr: z.journal.length + 1, simuliert: true, art: "paper", zeit: o.zeit, seite: o.seite, preis: runden(o.preis),
        menge: runden(o.menge, 8), betrag_usdt: runden(o.betrag_usdt), gebuehr_usdt: runden(o.gebuehr_usdt), grund: o.grund };
      z.journal.push(eintrag);
      if (z.journal.length >= z.einstellungen.maxOrders) {
        z.laeuft = false;
        z.meldung = "Höchstzahl von " + z.einstellungen.maxOrders + " simulierten Orders erreicht – Bot angehalten.";
      }
      return eintrag;
    }

    function planen(i) {
      const e = z.einstellungen;
      const k = z.kerzen[i];
      // Stop-Verlust geht vor dem Strategiesignal
      if (z.position && e.stopVerlust !== null && k.c <= z.position.einstieg_preis * (1 - e.stopVerlust)) {
        z.geplant = { seite: "verkauf", grund: "Stop-Verlust " + runden(e.stopVerlust * 100, 2) + " %" };
        return;
      }
      const s = strategie();
      const signal = s.signal(i, z.kerzen, s.vorbereiten(z.kerzen, e.parameter), { start: z.start });
      if (signal === "kaufen" && !z.position) z.geplant = { seite: "kauf", grund: "Signal " + e.strategie };
      else if (signal === "verkaufen" && z.position) z.geplant = { seite: "verkauf", grund: "Signal " + e.strategie };
    }

    function anhaengen(k) {
      z.kerzen.push({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c });
      if (z.kerzen.length > MAX_KERZEN) {
        const weg = z.kerzen.length - MAX_KERZEN;
        z.kerzen.splice(0, weg);
        z.start = Math.max(0, z.start - weg);
      }
    }

    return {
      // Vergangene Kerzen nur als Vorlauf für die Indikatoren – hier wird nie gehandelt
      vorlaufLaden(kerzen) {
        if (z.journal.length || z.verarbeitet) return { fehler: "Vorlauf nur vor der ersten verarbeiteten Kerze." };
        for (const k of kerzen || []) {
          const f = kerzeFehler(k, z.kerzen[z.kerzen.length - 1]);
          if (f) return { fehler: f };
          anhaengen(k);
        }
        z.start = z.kerzen.length;
        return { ok: true, kerzen: z.kerzen.length };
      },
      // Handelsbeginn = nächste Kerze (für „Kaufen und halten“ zählt der Start, nicht der Vorlauf)
      starten() {
        if (!z.laeuft) z.start = z.kerzen.length;
        z.laeuft = true;
        z.meldung = null;
        return this.stand();
      },
      // Anhalten verwirft eine noch nicht ausgeführte Order; eine offene Position bleibt bestehen
      anhalten() {
        z.laeuft = false;
        z.geplant = null;
        z.meldung = "Von Hand angehalten.";
        return this.stand();
      },
      // Neue (abgeschlossene) Kerze: 1. geplante Order zur Eröffnung ausführen, 2. zum Schluss bewerten, 3. neu planen
      kerzeVerarbeiten(k) {
        const f = kerzeFehler(k, z.kerzen[z.kerzen.length - 1]);
        if (f) return { fehler: f, orders: [] };
        anhaengen(k);
        const i = z.kerzen.length - 1;
        z.verarbeitet++;
        const orders = [];
        if (z.laeuft) { const o = ausfuehren(k); if (o) orders.push(o); }
        const w = wert(k.c);
        if (w > z.hoch) z.hoch = w;
        z.maxRueckgang = Math.max(z.maxRueckgang, (z.hoch - w) / z.hoch);
        z.letzterKurs = k.c;
        if (z.laeuft) planen(i);
        return { orders, stand: this.stand() };
      },
      stand() {
        const kurs = z.letzterKurs;
        const w = kurs === null ? z.bargeld : wert(kurs);
        return {
          art: "Paper-Bot (Simulation)", hinweis: HINWEIS, laeuft: z.laeuft, meldung: z.meldung,
          strategie: z.einstellungen.strategie, parameter: z.einstellungen.parameter,
          startkapital: z.einstellungen.startkapital, bargeld_usdt: runden(z.bargeld),
          position: z.position ? { menge: runden(z.position.menge, 8), einstieg_preis: runden(z.position.einstieg_preis), einstieg_zeit: z.position.einstieg_zeit,
            wert_usdt: kurs === null ? null : runden(z.position.menge * kurs), ergebnis_usdt: kurs === null ? null : runden(z.position.menge * kurs - z.position.kosten) } : null,
          geplant: z.geplant ? { ...z.geplant } : null,
          gesamtwert_usdt: runden(w), gewinn_usdt: runden(w - z.einstellungen.startkapital),
          gewinn_prozent: runden(((w - z.einstellungen.startkapital) / z.einstellungen.startkapital) * 100, 4),
          gebuehren_usdt: runden(z.gebuehren), max_rueckgang_prozent: runden(z.maxRueckgang * 100, 4),
          kerzen_verarbeitet: z.verarbeitet, orders: z.journal.length, trades: z.trades.map((t) => ({ ...t })),
        };
      },
      journal() { return z.journal.map((o) => ({ ...o })); },
      // Vollständiger Zustand als JSON (Fortsetzen nach Neuladen liefert dieselben Ergebnisse)
      alsJson() { return JSON.stringify(z); },
    };
  }

  function erstellen(optionen = {}) {
    const einstellungen = {
      startkapital: optionen.startkapital ?? 10000,
      gebuehr: optionen.gebuehr ?? 0.001,
      slippage: optionen.slippage ?? 0,
      strategie: optionen.strategie || "ema-kreuzung",
      parameter: optionen.parameter || {},
      einsatzAnteil: optionen.einsatzAnteil ?? 1,
      stopVerlust: optionen.stopVerlust ?? null,
      maxOrders: optionen.maxOrders ?? 50,
    };
    const fehler = einstellungenPruefen(einstellungen);
    if (fehler) return { fehler, hinweis: HINWEIS };
    return bot({ version: 1, einstellungen, bargeld: einstellungen.startkapital, position: null, geplant: null, kerzen: [], start: 0,
      journal: [], trades: [], gebuehren: 0, hoch: einstellungen.startkapital, maxRueckgang: 0, letzterKurs: null, verarbeitet: 0,
      laeuft: false, meldung: null });
  }

  function ausJson(text) {
    let z;
    try { z = JSON.parse(text); } catch (e) { return { fehler: "Kein gültiger Paper-Bot-Stand (JSON)." }; }
    if (!z || z.version !== 1 || !z.einstellungen || !Array.isArray(z.kerzen) || !Array.isArray(z.journal)) return { fehler: "Kein gültiger Paper-Bot-Stand (Version 1)." };
    const fehler = einstellungenPruefen(z.einstellungen);
    if (fehler) return { fehler };
    return bot(z);
  }

  global.PaperBot = { erstellen, ausJson, HINWEIS };
})(typeof window !== "undefined" ? window : globalThis);
