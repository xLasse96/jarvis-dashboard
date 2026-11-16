// JARVIS Paper-Kern – vollständig lokale Handelssimulation mit getrenntem Portfolio, Orderzuständen, Fill-Simulator, Replay und Ledger
// (ab Dashboard 2026-11-01a). KEINE Brokerverbindung: dieses Modul kennt weder Worker noch Börse, ruft kein Netz auf und fragt nie
// einen Freigabecode ab. Jede Order ist eine Simulation (simuliert: true) – Kapital und Positionen sind Spielgeld, kein Konto.
// Ergebnisse gelten nur für den gewählten Testdatensatz – keine Prognose, kein Renditeversprechen.
//
// Orderzustände (deterministisch, siehe UEBERGAENGE):
//   erstellt → geprueft → gefuellt | abgelehnt | unklar;  erstellt → abgelehnt;  unklar → gefuellt | verworfen
// Ausführung (Fill): Signal am Schluss von Kerze i, Ausführung zur Eröffnung von Kerze i+1 (kein Blick in die Zukunft);
//   Kaufpreis = Eröffnung × (1 + Slippage), Verkaufspreis = Eröffnung × (1 − Slippage), Gebühr = Volumen × Gebühr.
//   Gebühr und Slippage kommen nur aus den Annahmen des Laufs; fehlen sie, sind sie 0 und als „Testannahme“ gekennzeichnet.
// Risiko je Order (alle Grenzen Pflicht, sonst wird jeder Kauf blockiert): Not-Aus, Orderwert, offene Positionen, Tagesverlust
//   (UTC-Tag, Wert zu Tagesbeginn − aktueller Wert), Häufigkeit (gleitendes Fenster über simulierte Ausführungszeiten).
// Ledger: jede Buchung mit eindeutiger, aus Datensatz/Symbol/Zeit/Seite abgeleiteter trade_id – erneutes Abspielen bucht nichts doppelt;
//   derselbe Vorschlag (Datensatz, Symbol, Seite, Signalzeit) wird auch bei späterer zweiter Bestätigung nur einmal gebucht (ab 14p).
// Braucht aktien/technik.js (AktienTechnik.ema) und daten/datenquellen.js (JarvisDaten.kerzenPruefen/ausreisserPruefen).
(function (global) {
  "use strict";

  const HINWEIS = "SIMULATION mit Testdaten – kein Konto, keine Order, keine Prognose, kein Renditeversprechen.";
  const ZUSTAENDE = ["erstellt", "geprueft", "gefuellt", "abgelehnt", "unklar", "verworfen"];
  const UEBERGAENGE = { erstellt: ["geprueft", "abgelehnt"], geprueft: ["gefuellt", "abgelehnt", "unklar"], unklar: ["gefuellt", "verworfen"], gefuellt: [], abgelehnt: [], verworfen: [] };
  const RESET_BESTAETIGUNG = "PAPER ZURÜCKSETZEN";
  // Nur US-Aktien (ab 2026-11-01b): Symbole wie AAPL oder BRK.B; Krypto-Paare (z. B. BTCUSDT) werden abgelehnt
  const MARKT = "US-Aktien (Simulation)";
  const US_TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
  const TAG = 86400000;
  const r2 = (x) => Math.round(x * 100) / 100;
  const geld = (x) => x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const r6 = (x) => Math.round(x * 1e6) / 1e6;

  function portfolioNeu({ startkapital, waehrung = "USD" } = {}) {
    if (!(startkapital > 0)) throw new Error("Startkapital muss größer als 0 sein.");
    return { art: "simulation", simuliert: true, markt: MARKT, waehrung, startkapital, bargeld: startkapital, positionen: {}, ledger: [], orders: [], ausfuehrungen: [], tagesstart: null, verlauf: [] };
  }

  function uebergang(order, nach) {
    const erlaubt = UEBERGAENGE[order.zustand] || [];
    if (!erlaubt.includes(nach)) throw new Error(`Zustandswechsel „${order.zustand}“ → „${nach}“ nicht erlaubt.`);
    return { ...order, zustand: nach, verlauf: [...(order.verlauf || []), { von: order.zustand, nach }] };
  }

  function annahmenNormal(a) {
    if (!a || (a.gebuehrPct === undefined && a.slippagePct === undefined)) return { gebuehrPct: 0, slippagePct: 0, quelle: "Testannahme (keine Werte angegeben: 0 % Gebühr, 0 % Slippage)", testannahme: true };
    const g = Number(a.gebuehrPct), s = Number(a.slippagePct);
    if (!(g >= 0 && g < 10) || !(s >= 0 && s < 10)) throw new Error("Gebühr und Slippage müssen zwischen 0 und 10 % liegen.");
    return { gebuehrPct: g, slippagePct: s, quelle: a.quelle ? String(a.quelle) : "Testannahme", testannahme: !a.quelle || /test/i.test(String(a.quelle)) };
  }

  // FNV-1a (32 bit, zweimal mit verschiedenem Startwert) – deterministisch, ohne Abhängigkeit
  function tradeId(datensatz, symbol, zeit, seite) {
    const text = [datensatz, symbol, zeit, seite].join("|");
    const fnv = (start) => { let h = start >>> 0; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, "0"); };
    return "sim-" + fnv(2166136261) + fnv(374761393);
  }

  function wert(p, kurse) {
    let w = p.bargeld;
    for (const [s, pos] of Object.entries(p.positionen)) w += pos.menge * (kurse[s] !== undefined ? kurse[s] : pos.einstand);
    return w;
  }

  function limitsFehler(l) {
    const f = [];
    if (!l || typeof l !== "object") return ["Grenzen fehlen"];
    if (typeof l.notaus !== "boolean") f.push("Not-Aus-Zustand fehlt");
    if (!(l.maxOrderWert > 0)) f.push("maxOrderWert fehlt");
    if (!(Number.isInteger(l.maxPositionen) && l.maxPositionen >= 1)) f.push("maxPositionen fehlt");
    if (!(l.maxTagesverlust > 0)) f.push("maxTagesverlust fehlt");
    if (!(l.frequenz && Number.isInteger(l.frequenz.max) && l.frequenz.max >= 1 && l.frequenz.fensterMs > 0)) f.push("Häufigkeitsgrenze fehlt");
    return f;
  }

  // Risiko einer simulierten Order. kontext: { jetzt (UTC ms der Ausführung), kurs, kurse }
  function risikoPruefen(p, order, limits, kontext) {
    const gruende = limitsFehler(limits).map((x) => "Konfiguration: " + x);
    if (gruende.length) return { bestanden: false, gruende };
    if (limits.notaus) gruende.push("NOT-AUS aktiv (Simulation)");
    const imFenster = p.ausfuehrungen.filter((t) => kontext.jetzt - t < limits.frequenz.fensterMs).length;
    if (imFenster >= limits.frequenz.max) gruende.push(`Häufigkeitsgrenze: ${limits.frequenz.max} Orders in ${limits.frequenz.fensterMs / 1000} s`);
    if (order.seite === "kauf") {
      const volumen = order.wert;
      if (!(volumen > 0)) gruende.push("Orderwert ungültig");
      if (volumen > limits.maxOrderWert) gruende.push(`Orderwert ${r2(volumen)} über Höchstwert ${limits.maxOrderWert}`);
      // ab 11-05g (Nutzerentscheidung zu docs/ENTSCHEIDUNGEN_OFFEN.md, Nachtrag 31 b): Orderwert PLUS Gebühr muss ins Spielgeld passen –
      // vorher nur der Orderwert, die Gebühr konnte das Bargeld ins Minus bringen. Gebühr aus den Annahmen des Laufs (kontext.annahmen).
      const gebuehr = kontext.annahmen && kontext.annahmen.gebuehrPct > 0 ? r2(volumen * kontext.annahmen.gebuehrPct / 100) : 0;
      if (r2(volumen + gebuehr) > p.bargeld) gruende.push(gebuehr ? `nicht genug Spielgeld: Orderwert ${geld(volumen)} + Gebühr ${geld(gebuehr)} = ${geld(r2(volumen + gebuehr))} USD, verfügbar ${geld(p.bargeld)} USD` : "nicht genug Spielgeld");
      const offen = Object.keys(p.positionen).length + (p.positionen[order.symbol] ? 0 : 1);
      if (offen > limits.maxPositionen) gruende.push(`höchstens ${limits.maxPositionen} offene Positionen`);
      const tag = new Date(kontext.jetzt).toISOString().slice(0, 10);
      const start = p.tagesstart && p.tagesstart.datum === tag ? p.tagesstart.wert : wert(p, kontext.kurse || {});
      const verlust = start - wert(p, kontext.kurse || {});
      if (verlust >= limits.maxTagesverlust) gruende.push(`Tagesverlust ${r2(verlust)} erreicht Grenze ${limits.maxTagesverlust}`);
      // ab 16b (trader-risk check.py:200-202, BRK-S15/RISK-S16): eigene Sperrliste – diese Symbole werden nie gekauft (Verkauf bleibt möglich)
      if (Array.isArray(limits.gesperrt) && limits.gesperrt.includes(order.symbol)) gruende.push(`Sperrliste: ${order.symbol} ist von dir gesperrt – kein Kauf`);
    } else if (!p.positionen[order.symbol]) gruende.push("keine simulierte Position zum Verkaufen");
    // ab 16b (trader-risk check.py:261-266, RISK-S11) nur auf ausdrückliche Wahl: höchstens eine Order je Symbol und Seite am selben UTC-Tag
    if (limits.einOrderJeTag === true) {
      const tag = new Date(kontext.jetzt).toISOString().slice(0, 10);
      if (p.ledger.some((e) => (e.zustand === "gefuellt" || e.zustand === "unklar") && e.symbol === order.symbol && e.seite === order.seite && Number.isFinite(e.zeit) && new Date(e.zeit).toISOString().slice(0, 10) === tag)) gruende.push(`Duplikat: heute schon ein ${order.seite === "kauf" ? "Kauf" : "Verkauf"} von ${order.symbol} (Skill-Regel: eine Order je Symbol und Seite pro Tag)`);
    }
    return { bestanden: gruende.length === 0, gruende };
  }

  // Fill nur aus der übergebenen Kerze (aufgezeichnete/explizite Testdaten). unklar: true → Zustand „unklar“ (z. B. Testfall)
  function fillSimulieren(order, kerze, annahmen, { unklar = false } = {}) {
    if (unklar) return { zustand: "unklar" };
    if (!kerze || !(kerze.o > 0) || !Number.isFinite(kerze.o)) return { zustand: "abgelehnt", grund: "keine Ausführungskerze in den Testdaten" };
    const preis = order.seite === "kauf" ? kerze.o * (1 + annahmen.slippagePct / 100) : kerze.o * (1 - annahmen.slippagePct / 100);
    return { zustand: "gefuellt", preis: r6(preis), zeit: kerze.t };
  }

  // Noch nicht verrechnete Kaufgebühren einer Position (ab 11-05h). Stände vor 11-05h speichern sie nicht: dann aus dem Ledger – die
  // Kaufgebühren dieses Symbols seit dessen letztem Verkauf (bis 11-05h wurde stets die ganze Position verkauft); ohne Position 0
  function kaufgebuehrenOffen(p, symbol) {
    const pos = p.positionen[symbol];
    if (!pos) return 0;
    if (Number.isFinite(pos.kaufgebuehren)) return pos.kaufgebuehren;
    let summe = 0;
    for (const e of p.ledger) if (e.symbol === symbol && e.zustand === "gefuellt") summe = e.seite === "verkauf" ? 0 : summe + (e.gebuehr || 0);
    return r2(summe);
  }

  // Bucht einen Ledger-Eintrag genau einmal (trade_id). Rückgabe: true = gebucht, false = schon vorhanden (nichts geändert)
  function buchen(p, eintrag) {
    if (p.ledger.some((e) => e.trade_id === eintrag.trade_id)) return false;
    if (eintrag.zustand === "gefuellt") {
      // ab 11-06b: nie eine Ausführung mit Menge 0 oder ungültigem Preis und nie einen Verkauf über dem Bestand buchen
      // (vorher Einstand NaN bzw. Gutschrift für nicht gehaltene Stücke)
      if (!(eintrag.menge > 0) || !(eintrag.preis > 0) || !Number.isFinite(eintrag.preis)) throw new Error("Ungültige Ausführung: Menge und Preis müssen größer als 0 sein.");
      const bestand = p.positionen[eintrag.symbol];
      if (eintrag.seite === "verkauf" && (!bestand || eintrag.menge > bestand.menge + 1e-9)) throw new Error("Verkauf über dem simulierten Bestand.");
      if (eintrag.seite === "kauf") {
        const pos = p.positionen[eintrag.symbol] || { menge: 0, einstand: 0 };
        const menge = pos.menge + eintrag.menge;
        p.positionen[eintrag.symbol] = { menge: r6(menge), einstand: r6((pos.menge * pos.einstand + eintrag.menge * eintrag.preis) / menge), kaufgebuehren: r2(kaufgebuehrenOffen(p, eintrag.symbol) + eintrag.gebuehr) };
        p.bargeld = r2(p.bargeld - eintrag.volumen - eintrag.gebuehr);
      } else {
        // ab 11-05h (Nutzerentscheidung zu docs/ENTSCHEIDUNGEN_OFFEN.md, Nachtrag 31 a): realisiertes Ergebnis nach Kauf- UND
        // Verkaufsgebühren wie die Historische Simulation (vorher nur die Verkaufsgebühr). Die Kaufgebühren werden nach Stückzahl
        // anteilig verrechnet; der Rest bleibt mit unverändertem Einstand bei der Position, der letzte Verkauf nimmt den ganzen Rest.
        const pos = p.positionen[eintrag.symbol];
        const offen = kaufgebuehrenOffen(p, eintrag.symbol);
        const alles = eintrag.menge >= pos.menge - 1e-9;
        const anteil = alles ? offen : r2(offen * eintrag.menge / pos.menge);
        eintrag.kaufgebuehr_anteil = anteil;
        eintrag.ergebnis = r2((eintrag.preis - pos.einstand) * eintrag.menge - eintrag.gebuehr - anteil);
        p.bargeld = r2(p.bargeld + eintrag.volumen - eintrag.gebuehr);
        if (alles) delete p.positionen[eintrag.symbol];
        else p.positionen[eintrag.symbol] = { menge: r6(pos.menge - eintrag.menge), einstand: pos.einstand, kaufgebuehren: r2(offen - anteil) };
      }
      p.ausfuehrungen.push(eintrag.zeit);
    }
    p.ledger.push(eintrag);
    return true;
  }

  // Eine simulierte Order vollständig: erstellt → geprueft (Risiko) → Fill → Ledger
  function orderAusfuehren(p, { datensatz, symbol, seite, wertKauf, signalZeit, kerze, annahmen, limits, kurse, unklar = false }) {
    const zeit = kerze ? kerze.t : signalZeit;
    const id = tradeId(datensatz, symbol, zeit, seite);
    if (p.ledger.some((e) => e.trade_id === id)) return { doppelt: true, trade_id: id };
    // ab 14p (Freigabe des Nutzers vom 12.11.): derselbe Vorschlag – gleiche Kennung aus Datensatz (Sitzung), Symbol, Seite und
    // Signal- bzw. Erstellzeit – wird höchstens einmal gebucht, auch wenn er später noch einmal bestätigt wird (andere Ausführungszeit,
    // damit andere trade_id). Abgelehnte und verworfene Versuche sperren nicht; ein neu erstellter Vorschlag hat eine eigene Erstellzeit.
    const schon = Number.isFinite(signalZeit) ? p.ledger.find((e) => (e.zustand === "gefuellt" || e.zustand === "unklar") && e.datensatz === datensatz && e.symbol === symbol && e.seite === seite && e.signal_zeit === signalZeit) : null;
    if (schon) return { doppelt: true, trade_id: schon.trade_id };
    let order ={ trade_id: id, symbol, seite, wert: seite === "kauf" ? wertKauf : null, zustand: "erstellt", verlauf: [] };
    if (kerze) {
      const tag = new Date(kerze.t).toISOString().slice(0, 10);
      if (!p.tagesstart || p.tagesstart.datum !== tag) p.tagesstart = { datum: tag, wert: wert(p, kurse) };
    }
    const risiko = risikoPruefen(p, order, limits, { jetzt: zeit, kurse, annahmen });
    order = uebergang(order, risiko.bestanden ? "geprueft" : "abgelehnt");
    const basis = { trade_id: id, datensatz, symbol, seite, wert: order.wert, signal_zeit: signalZeit, zeit, simuliert: true, annahmen, risiko };
    if (!risiko.bestanden) { buchen(p, { ...basis, zustand: order.zustand, verlauf: order.verlauf, menge: 0, preis: null, volumen: 0, gebuehr: 0 }); return { order, risiko }; }
    const fill = fillSimulieren(order, kerze, annahmen, { unklar });
    // ab 11-05g: mit dem tatsächlichen Ausführungspreis nachrechnen – durch die Mengenrundung kann das Volumen um einen Cent über dem
    // Orderwert liegen; auch dann keine Ausführung, die das Spielgeld ins Minus bringt
    if (fill.zustand === "gefuellt" && seite === "kauf") {
      // ab 11-06b: Menge nach Rundung 0 (winziger Orderwert, sehr hoher Kurs) → abgelehnt statt „gefuellt“ mit Einstand NaN
      if (!(r6(wertKauf / fill.preis) > 0)) {
        order = uebergang(order, "abgelehnt");
        buchen(p, { ...basis, zustand: order.zustand, verlauf: order.verlauf, menge: 0, preis: null, volumen: 0, gebuehr: 0, grund: "Stückzahl 0: Orderwert zu klein für den Ausführungspreis" });
        return { order, risiko };
      }
      const v = r2(r6(wertKauf / fill.preis) * fill.preis);
      if (r2(v + r2(v * annahmen.gebuehrPct / 100)) > p.bargeld) {
        order = uebergang(order, "abgelehnt");
        buchen(p, { ...basis, zustand: order.zustand, verlauf: order.verlauf, menge: 0, preis: null, volumen: 0, gebuehr: 0, grund: "nicht genug Spielgeld für Orderwert plus Gebühr" });
        return { order, risiko };
      }
    }
    order = uebergang(order, fill.zustand);
    if (fill.zustand !== "gefuellt") { buchen(p, { ...basis, zustand: order.zustand, verlauf: order.verlauf, menge: 0, preis: null, volumen: 0, gebuehr: 0, grund: fill.grund || "Ausführung unklar" }); return { order, risiko }; }
    const menge = seite === "kauf" ? r6(wertKauf / fill.preis) : p.positionen[symbol].menge;
    const volumen = r2(menge * fill.preis);
    buchen(p, { ...basis, zustand: "gefuellt", verlauf: order.verlauf, menge, preis: fill.preis, volumen, gebuehr: r2(volumen * annahmen.gebuehrPct / 100) });
    return { order, risiko };
  }

  // Klärung einer unklaren simulierten Order (nur ausdrücklich): gefunden → gefuellt (mit Kerze), sonst verworfen
  function unklarKlaeren(p, tradeIdWert, { gefunden, kerze } = {}) {
    const e = p.ledger.find((x) => x.trade_id === tradeIdWert);
    if (!e || e.zustand !== "unklar") throw new Error("Keine unklare Order mit dieser trade_id.");
    const o = uebergang({ zustand: "unklar", verlauf: e.verlauf }, gefunden ? "gefuellt" : "verworfen");
    if (!gefunden) { e.zustand = o.zustand; e.verlauf = o.verlauf; return e; }
    const fill = fillSimulieren({ seite: e.seite }, kerze, e.annahmen);
    if (fill.zustand !== "gefuellt") throw new Error("Für „gefunden“ ist eine Ausführungskerze nötig.");
    // ab 11-06b: alle Prüfungen vor dem Herausnehmen aus dem Ledger (vorher ging der unklare Eintrag bei einem Fehler verloren);
    // ein Kauf wird nur geklärt, wenn Orderwert plus Gebühr ins Spielgeld passen (vorher konnte das Bargeld negativ werden)
    if (e.seite === "verkauf" && !p.positionen[e.symbol]) throw new Error("Keine simulierte Position mehr für diesen Verkauf.");
    const menge = e.seite === "kauf" ? r6(e.wert / fill.preis) : p.positionen[e.symbol].menge;
    if (!(menge > 0)) throw new Error("Stückzahl 0: Orderwert zu klein für den Ausführungspreis – Order bleibt unklar.");
    const volumen = r2(menge * fill.preis), gebuehr = r2(menge * fill.preis * e.annahmen.gebuehrPct / 100);
    if (e.seite === "kauf" && r2(volumen + gebuehr) > p.bargeld) throw new Error("Nicht genug Spielgeld für Orderwert plus Gebühr – Order bleibt unklar.");
    const i = p.ledger.indexOf(e);
    p.ledger.splice(i, 1);
    try { buchen(p, { ...e, zustand: "gefuellt", verlauf: o.verlauf, preis: fill.preis, menge, volumen, gebuehr }); }
    catch (fehler) { p.ledger.splice(i, 0, e); throw fehler; }
    return p.ledger.find((x) => x.trade_id === tradeIdWert);
  }

  // Deterministischer, synthetischer Testdatensatz (kein Marktbezug): Tageskerzen ab 2026-01-05, nur Handelstage Mo–Fr.
  function testdatensatz({ name = "Synthetisch A", symbol = "TEST", tage = 260, start = 100, saat = 42 } = {}) {
    let x = saat >>> 0;
    const zufall = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
    const kerzen = [];
    let t = Date.UTC(2026, 0, 5), kurs = start;
    while (kerzen.length < tage) {
      const wt = new Date(t).getUTCDay();
      if (wt !== 0 && wt !== 6) {
        const welle = Math.sin(kerzen.length / 18) * 0.012;
        const o = kurs;
        const c = Math.max(1, o * (1 + welle + (zufall() - 0.5) * 0.02));
        const h = Math.max(o, c) * (1 + zufall() * 0.006), l = Math.min(o, c) * (1 - zufall() * 0.006);
        kerzen.push({ t, o: r2(o), h: r2(h), l: r2(l), c: r2(c), v: 1000 + Math.floor(zufall() * 500) });
        kurs = c;
      }
      t += TAG;
    }
    return { name, symbol, intervall: "1d", kalender: "boerse", quelle: "synthetisch erzeugt (Saat " + saat + ") – keine echten Marktdaten", synthetisch: true, kerzen };
  }

  // Replay: verarbeitet die Kerzen des Datensatzes streng der Reihe nach. optionen:
  //   strategie { art: "ema-kreuzung", kurz, lang }, orderWert, annahmen, limits, ausreisser (Pflicht, siehe JarvisDaten),
  //   notausAb (UTC ms: ab dann Not-Aus in der Simulation), unklarBei (Liste von Kerzenindizes, deren Fill „unklar“ ist)
  function replay(datensatz, optionen = {}, portfolio = null) {
    const D = global.JarvisDaten, T = global.AktienTechnik;
    if (!D || !T) return { fehler: "datenquellen.js oder technik.js nicht geladen." };
    const geprueft = D.kerzenPruefen(datensatz && datensatz.kerzen, { intervall: datensatz && datensatz.intervall, kalender: datensatz && datensatz.kalender });
    if (!geprueft.ok) return { fehler: "Datenqualität: " + geprueft.fehler.text, code: geprueft.fehler.code };
    const aus = D.ausreisserPruefen(geprueft.kerzen, optionen.ausreisser);
    if (!aus.ok) return { fehler: "Datenqualität: " + aus.fehler.text, code: aus.fehler.code };
    if (!US_TICKER.test(String(datensatz.symbol || ""))) return { fehler: `Nur US-Aktiensymbole (z. B. AAPL, BRK.B) – „${String(datensatz.symbol || "").slice(0, 12)}“ abgelehnt.` };
    const s = optionen.strategie || {};
    if (s.art !== "ema-kreuzung" || !(Number.isInteger(s.kurz) && Number.isInteger(s.lang) && s.kurz >= 2 && s.lang > s.kurz)) return { fehler: "Strategie: ema-kreuzung mit kurz < lang nötig." };
    if (!(optionen.orderWert > 0)) return { fehler: "Orderwert je Kauf fehlt." };
    let annahmen;
    try { annahmen = annahmenNormal(optionen.annahmen); } catch (e) { return { fehler: e.message }; }
    const kerzen = geprueft.kerzen;
    const p = portfolio || portfolioNeu({ startkapital: optionen.startkapital || 10000 });
    const schluss = kerzen.map((k) => k.c);
    const ek = T.ema(schluss, s.kurz), el = T.ema(schluss, s.lang);
    const unklarBei = new Set(optionen.unklarBei || []);
    let doppelt = 0;
    p.abgespielt = p.abgespielt || {};
    const abgespieltBis = Number.isFinite(p.abgespielt[datensatz.name]) ? p.abgespielt[datensatz.name] : -Infinity;
    const verlauf = [];
    for (let i = 0; i < kerzen.length; i++) {
      const kurse = { [datensatz.symbol]: kerzen[i].c };
      verlauf.push({ t: kerzen[i].t, wert: r2(wert(p, kurse)) });
      if (i + 1 >= kerzen.length || ek[i] === null || el[i] === null || ek[i - 1] == null || el[i - 1] == null) continue;
      const hoch = ek[i - 1] <= el[i - 1] && ek[i] > el[i], runter = ek[i - 1] >= el[i - 1] && ek[i] < el[i];
      if (!hoch && !runter) continue;
      const naechste = kerzen[i + 1];
      // Erneutes Abspielen: Kerzen bis zum schon abgespielten Stand werden nie wieder ausgeführt (der heutige Positionsstand würde
      // sonst alte Signale anders entscheiden); schon gebuchte Orders werden nur gezählt.
      if (naechste.t <= abgespieltBis) { if (p.ledger.some((e) => e.trade_id === tradeId(datensatz.name, datensatz.symbol, naechste.t, hoch ? "kauf" : "verkauf"))) doppelt++; continue; }
      if (!hoch && !p.positionen[datensatz.symbol]) continue;
      const limits = { ...optionen.limits, notaus: optionen.limits && typeof optionen.limits.notaus === "boolean" ? optionen.limits.notaus || (Number.isFinite(optionen.notausAb) && naechste.t >= optionen.notausAb) : undefined };
      const r = orderAusfuehren(p, { datensatz: datensatz.name, symbol: datensatz.symbol, seite: hoch ? "kauf" : "verkauf", wertKauf: optionen.orderWert, signalZeit: kerzen[i].t + D.INTERVALLE["1d"], kerze: naechste, annahmen, limits, kurse: { [datensatz.symbol]: naechste.o }, unklar: unklarBei.has(i + 1) });
      if (r.doppelt) doppelt++;
    }
    // Wertverlauf fortschreiben (nur Kerzen nach dem bisherigen Stand), damit der größte Rückgang auch bei schrittweisem Abspielen stimmt
    p.verlauf = (Array.isArray(p.verlauf) ? p.verlauf : []).concat(verlauf.filter((v) => v.t > abgespieltBis));
    p.abgespielt[datensatz.name] = Math.max(abgespieltBis, kerzen[kerzen.length - 1].t);
    return { portfolio: p, bericht: bericht(p, datensatz, kerzen, annahmen), doppelt, annahmen };
  }

  function bericht(p, datensatz, kerzen, annahmen) {
    const verkaeufe = p.ledger.filter((e) => e.zustand === "gefuellt" && e.seite === "verkauf");
    const letzter = kerzen && kerzen.length ? kerzen[kerzen.length - 1].c : null;
    const endwert = r2(wert(p, letzter ? { [datensatz.symbol]: letzter } : {}));
    let hoch = -Infinity, maxRueckgang = 0;
    for (const v of p.verlauf || []) { hoch = Math.max(hoch, v.wert); if (hoch > 0) maxRueckgang = Math.max(maxRueckgang, (hoch - v.wert) / hoch * 100); }
    return {
      simulation: true,
      markt: MARKT,
      symbol: datensatz.symbol,
      hinweis: HINWEIS,
      datensatz: datensatz.name, quelle: datensatz.quelle, synthetisch: datensatz.synthetisch === true,
      zeitraum: kerzen && kerzen.length ? { von: new Date(kerzen[0].t).toISOString().slice(0, 10), bis: new Date(kerzen[kerzen.length - 1].t).toISOString().slice(0, 10) } : null,
      annahmen,
      orders: p.ledger.length,
      ausgefuehrt: p.ledger.filter((e) => e.zustand === "gefuellt").length,
      blockiert: p.ledger.filter((e) => e.zustand === "abgelehnt").length,
      unklar: p.ledger.filter((e) => e.zustand === "unklar").length,
      trades: verkaeufe.length,
      gewinner: verkaeufe.filter((e) => e.ergebnis > 0).length,
      verlierer: verkaeufe.filter((e) => e.ergebnis <= 0).length,
      realisiert: r2(verkaeufe.reduce((s, e) => s + e.ergebnis, 0)),
      startkapital: p.startkapital, endwert, veraenderung: r2(endwert - p.startkapital),
      max_rueckgang_pct: Math.round(maxRueckgang * 100) / 100,
    };
  }

  // Sicherer Reset: nur mit genau dieser Bestätigung; berührt nur das übergebene Simulations-Portfolio.
  function zuruecksetzen(p, bestaetigung) {
    if (bestaetigung !== RESET_BESTAETIGUNG) throw new Error(`Reset nicht bestätigt – erwartet wird genau „${RESET_BESTAETIGUNG}“.`);
    if (!p || p.art !== "simulation") throw new Error("Nur ein Simulations-Portfolio kann zurückgesetzt werden.");
    return portfolioNeu({ startkapital: p.startkapital, waehrung: p.waehrung });
  }

  function ledgerFiltern(p, { symbol, seite, zustand } = {}) {
    return p.ledger.filter((e) => (!symbol || e.symbol === symbol) && (!seite || e.seite === seite) && (!zustand || e.zustand === zustand));
  }

  global.PaperKern = {
    HINWEIS, ZUSTAENDE, UEBERGAENGE, RESET_BESTAETIGUNG, MARKT, US_TICKER,
    portfolioNeu, uebergang, annahmenNormal, tradeId, risikoPruefen, fillSimulieren, buchen, orderAusfuehren, unklarKlaeren,
    testdatensatz, replay, bericht, zuruecksetzen, ledgerFiltern, wert,
  };
})(typeof window !== "undefined" ? window : globalThis);
