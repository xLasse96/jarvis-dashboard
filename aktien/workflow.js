// JARVIS Aktien – US-Aktien-Ablauf je Symbol (ab Dashboard 2026-11-01b). Verbindet vorhandene Bausteine zu EINEM nachvollziehbaren
// Ablauf, ohne Order und ohne eigene Netzanfrage – die Daten liefert ein Provider (lokale Testdaten, Mock oder der Worker):
//   1. Symbol prüfen (US-Ticker), optional gegen die Allowlist des Workers
//   2. Tageskerzen über die Datenquellen-Schnittstelle (JarvisDaten): Quelle, Datenzeit, Qualität (Börsenkalender), Frische
//   3. Chart-Scanner (AktienTechnik.scannen) – JARVIS-eigen
//   4. Entry-Timer (AktienEinstieg.bewerten) – JARVIS-eigen; braucht die Börsenuhr
//   5. Exit-Planer (AktienAusstieg.planen) für einen gedachten Einstieg zum letzten Kurs – JARVIS-eigen
//   6. Quartalszahlen aus SEC companyfacts (AktienSec.analysieren) – trader-analyst
//   7. Screener-Regeln (AktienScreener, Vorlagen aus trader-screener bzw. JARVIS) – trader-screener
//   8. Paper-Simulation dieses Symbols (PaperKern.replay) – nur lokal, getrennt von jeder Live-Ausführung
// Ergebnis: Schritte mit Status (ok | warnung | blockiert | nicht_verfuegbar), Blockadegründe je Bereich mit nächstem sicherem Schritt.
// Eine Order entsteht hier nie: der nächste Schritt wäre die Risiko-Prüfung (trader-risk) im Worker und die Freigabe genau einer Order.
// Provider: { name, beschreibung, synthetisch?, arten: ["kerzen"], kerzen({symbol}), uhr?(), secFakten?(symbol) } – alle async.
(function (global) {
  "use strict";

  const HINWEIS = "Analyse vergangener Daten nach festen Regeln – keine Empfehlung, keine Prognose, keine Order.";
  const US_TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
  const TAG = 86400000;
  const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

  function symbolPruefen(roh) {
    const s = String(roh == null ? "" : roh).trim().toUpperCase();
    if (!s) return { ok: false, grund: "Kein Symbol angegeben." };
    if (!US_TICKER.test(s)) return { ok: false, symbol: s, grund: `„${s.slice(0, 12)}“ ist kein gültiges US-Aktiensymbol (1–5 Buchstaben, optional Klasse wie BRK.B).` };
    return { ok: true, symbol: s };
  }

  async function mitZeitlimit(versprechen, ms, was) {
    let uhr;
    try {
      return await Promise.race([versprechen, new Promise((_, nein) => { uhr = setTimeout(() => nein(new Error(was + ": Zeitüberschreitung")), ms); })]);
    } finally { clearTimeout(uhr); }
  }

  // optionen: { jetzt, zeitlimitMs (Pflicht), allowlist (Array | null = unbekannt), ausreisser (Regeln | null), maxKerzenAlterTage,
  //             simulation: { annahmen, limits, strategie, orderWert, startkapital } | null }
  async function analysieren(eingabe, provider, optionen = {}) {
    const D = global.JarvisDaten, T = global.AktienTechnik, E = global.AktienEinstieg, A = global.AktienAusstieg, S = global.AktienSec, SC = global.AktienScreener, P = global.PaperKern;
    const fehlt = [["JarvisDaten", D], ["AktienTechnik", T], ["AktienEinstieg", E], ["AktienAusstieg", A], ["AktienSec", S], ["AktienScreener", SC], ["PaperKern", P]].filter(([, m]) => !m).map(([n]) => n);
    const jetzt = Number.isFinite(optionen.jetzt) ? optionen.jetzt : Date.now();
    const schritte = [];
    const blockaden = [];
    const schritt = (id, titel, status, text, details = null) => schritte.push({ id, titel, status, text, details });
    const blockade = (bereich, grund, naechster) => blockaden.push({ bereich, grund, naechster_schritt: naechster });
    const ergebnis = (felder) => ({ symbol: null, quelle: null, datenzeit: null, frisch: null, schritte, blockaden, hinweis: HINWEIS, order_moeglich: false, ...felder });
    if (fehlt.length) { blockade("Konfiguration", "Module fehlen: " + fehlt.join(", "), "Dashboard neu laden."); return ergebnis({}); }
    if (!(optionen.zeitlimitMs > 0)) { blockade("Konfiguration", "Zeitlimit für Datenabrufe fehlt.", "Ablauf mit Zeitlimit starten."); return ergebnis({}); }

    // 1. Symbol
    const sym = symbolPruefen(eingabe && eingabe.symbol);
    if (!sym.ok) { schritt("symbol", "Symbol", "blockiert", sym.grund); blockade("Eingabe", sym.grund, "Ein US-Aktiensymbol eingeben, z. B. AAPL oder BRK.B."); return ergebnis({ symbol: sym.symbol || null }); }
    const symbol = sym.symbol;
    if (Array.isArray(optionen.allowlist)) {
      if (optionen.allowlist.includes(symbol)) schritt("symbol", "Symbol", "ok", `${symbol} – steht in der Allowlist des Workers.`);
      else { schritt("symbol", "Symbol", "warnung", `${symbol} – nicht in der Allowlist des Workers (Analyse ja, Order nein).`); blockade("Freigabe", `${symbol} steht nicht in der Allowlist (AKTIEN_ERLAUBTE_SYMBOLE).`, "Nur analysieren; eine Order ist für dieses Symbol gesperrt."); }
    } else {
      schritt("symbol", "Symbol", "ok", `${symbol} – Allowlist hier nicht bekannt (maßgeblich prüft der Worker).`);
    }

    // 2. Daten
    const quelle = { name: provider && provider.name || "?", beschreibung: provider && provider.beschreibung || "", synthetisch: Boolean(provider && provider.synthetisch) };
    const maxTage = optionen.maxKerzenAlterTage > 0 ? optionen.maxKerzenAlterTage : E.STANDARD.maxKerzenAlterTage;
    const anfrage = { symbol, intervall: "1d", kalender: "boerse" };
    if (optionen.ausreisser) anfrage.ausreisser = optionen.ausreisser;
    const k = await D.abrufen(provider, "kerzen", anfrage, { zeitlimitMs: optionen.zeitlimitMs, jetzt, maxAlterMs: maxTage * TAG });
    const datenzeit = Number.isFinite(k.datenzeit) ? k.datenzeit : null;
    if (!k.ok && !(k.fehler && k.fehler.code === "veraltet" && k.daten)) {
      const code = k.fehler ? k.fehler.code : "fehler";
      schritt("daten", "Kursdaten", code === "nicht_verfuegbar" ? "nicht_verfuegbar" : "blockiert", `${quelle.name}: ${k.fehler ? k.fehler.text : "keine Daten"}`);
      blockade("Daten", `Kursdaten ${({ timeout: "nicht rechtzeitig geliefert", ungueltig: "ungültig", widerspruch: "widersprüchlich", regel_fehlt: "ohne gültige Prüfregel", nicht_verfuegbar: "nicht verfügbar" })[code] || "nicht abrufbar"}: ${k.fehler ? k.fehler.text : ""}`, "Später erneut analysieren oder eine andere Datenquelle wählen – nichts wird geschätzt.");
      return ergebnis({ symbol, quelle });
    }
    const kerzen = k.daten;
    const veraltet = k.frisch === false;
    schritt("daten", "Kursdaten", veraltet ? "warnung" : "ok",
      `${kerzen.length} Tageskerzen von ${quelle.name}${quelle.synthetisch ? " (synthetische Testdaten, keine Marktdaten)" : ""}; Datenzeit ${new Date(datenzeit).toISOString().slice(0, 16).replace("T", " ")} UTC`
        + (veraltet ? ` – VERALTET (älter als ${maxTage} Tage)` : "") + "; Qualität geprüft (Reihenfolge, Doppelte, Lücken über 4 Kalendertage" + (optionen.ausreisser ? ", Ausreißer" : "") + "); einzelne fehlende Handelstage sind ohne Börsenkalender nicht prüfbar.");
    if (veraltet) blockade("Daten", `Kursdaten veraltet (${k.fehler.text})`, "Mit aktuellen Daten neu analysieren – auf alte Kurse wird nicht gehandelt.");
    if (!optionen.ausreisser) blockade("Konfiguration", "Ausreißerregeln nicht festgelegt – die Daten wurden nicht auf Ausreißer geprüft.", "Regeln (max. Tagessprung %, max. Spanne %) eintragen; bis dahin gilt die Analyse nur als Information.");

    // Börsenuhr (optional beim Provider)
    let uhr = null;
    if (provider && typeof provider.uhr === "function") {
      try { uhr = await mitZeitlimit(Promise.resolve().then(() => provider.uhr()), optionen.zeitlimitMs, "Börsenuhr"); } catch (e) { uhr = null; }
    }
    const beginn = uhr && uhr.offen ? E.sitzungsBeginn(uhr.naechste_schliessung) : null;
    const letzteLaufend = Boolean(beginn !== null && kerzen[kerzen.length - 1].t >= beginn - 10 * 3600000);

    // 3. Chart-Scanner
    const sc = T.scannen(kerzen, { jetzt, letzteLaufend });
    if (sc.fehler) schritt("technik", "Chart-Scanner", "blockiert", sc.fehler);
    else schritt("technik", "Chart-Scanner", sc.punkte > 0 ? "ok" : "warnung", `Punkte ${sc.punkte}: ` + (sc.signale.length ? sc.signale.map((s) => s.text).join("; ") : "keine Signale") + (sc.hinweise.length ? " · " + sc.hinweise.join(" ") : ""), { stand: sc.stand, signale: sc.signale });

    // 4. Entry-Timer
    const ein = E.bewerten({ kerzen, uhr, jetzt, letzteLaufend });
    if (ein.fehler) schritt("einstieg", "Entry-Timer", "blockiert", ein.fehler);
    else {
      schritt("einstieg", "Entry-Timer", ein.urteil === "jetzt" ? "ok" : ein.urteil === "warten" ? "warnung" : "blockiert", `${ein.text} ${ein.gruende.join(" ")}`.trim() + (uhr ? "" : " (Börsenuhr nicht verfügbar)"), ein);
      if (ein.urteil !== "jetzt") blockade("Einstieg", ein.gruende.join(" ") || ein.text, ein.urteil === "warten" ? "Warten" + (ein.fruehestens ? ` (frühestens ${ein.fruehestens.slice(0, 16).replace("T", " ")} UTC)` : "") + " und neu analysieren." : "Kein Einstieg nach diesem Plan.");
    }

    // 5. Exit-Planer (gedachter Einstieg zum letzten Kurs, 1 Aktie – nur zur Einordnung von Stop und Zielen)
    const kurs = kerzen[kerzen.length - 1].c;
    const atr = sc.stand ? sc.stand.atr14 : null;
    const aus = A.planen({ symbol, einstand: kurs, menge: 1, kurs, atr, hoechstkurs: kurs, tageGehalten: 0 });
    if (aus.fehler) schritt("ausstieg", "Exit-Planer", "nicht_verfuegbar", aus.fehler);
    else schritt("ausstieg", "Exit-Planer", "ok", `Bei Einstieg zu ${r2(kurs)}: Stop ${aus.wirksamerStop} (${aus.stopGrund || aus.stopArt}, ${aus.abstandStopPct} % Abstand), Ziele ${aus.ziele.map((z) => z.preis !== undefined ? z.preis : z.kurs).filter((x) => x !== undefined).join(" / ") || "–"}, Zeit-Stop ${aus.zeitStopTage} Tage.`, aus);

    // 6. Quartalszahlen (SEC companyfacts) – trader-analyst
    let fundamental = null;
    if (provider && typeof provider.secFakten === "function") {
      try {
        const fakten = await mitZeitlimit(Promise.resolve().then(() => provider.secFakten(symbol)), optionen.zeitlimitMs, "SEC");
        const a = S.analysieren(fakten, 6);
        fundamental = SC.kennzahlenAusSec(a, { jetzt });
        if (a.fehler) schritt("sec", "Quartalszahlen (SEC)", "nicht_verfuegbar", a.fehler);
        else schritt("sec", "Quartalszahlen (SEC)", fundamental._widerspruch ? "warnung" : "ok", `${a.firma || symbol}, Quartal bis ${fundamental.period_end}: Umsatz ggü. Vorjahr ${fundamental.revenue_growth_yoy ?? "–"} %, Betriebsmarge ${fundamental.operating_margin ?? "–"} %, EPS (4 Quartale) ${fundamental.eps_ttm ?? "nicht verfügbar"}` + (fundamental._hinweise.length ? " · " + fundamental._hinweise.join(" ") : "") + " · Quelle SEC EDGAR (companyfacts).", fundamental);
      } catch (e) {
        schritt("sec", "Quartalszahlen (SEC)", "nicht_verfuegbar", "SEC-Daten nicht verfügbar: " + (e && e.message ? e.message : "unbekannt"));
      }
    } else {
      schritt("sec", "Quartalszahlen (SEC)", "nicht_verfuegbar", `Die Datenquelle „${quelle.name}“ liefert keine SEC-Zahlen.`);
    }

    // 6b. Meldungen zum Symbol (trader-copycat: 13F, Form 4; trader-pelosi: Kongress) – nur Beobachtung, nie Empfehlung oder Order
    if (provider && typeof provider.meldungen === "function") {
      try {
        const bundle = await mitZeitlimit(Promise.resolve().then(() => provider.meldungen(symbol)), optionen.zeitlimitMs, "Meldungen");
        const m = meldungenAuswerten(symbol, bundle, jetzt);
        schritt("meldungen", "Meldungen (13F, Form 4, Kongress)", m.eintraege.length ? (m.eintraege.some((e) => e.verspaetet || e.unsicherheit.length) ? "warnung" : "ok") : "nicht_verfuegbar",
          (m.eintraege.length ? m.eintraege.map((e) => e.text).join("\n") : "Keine Meldungen zu " + symbol + " in den geladenen Daten.") + (m.nicht_verfuegbar.length ? "\nNicht verfügbar: " + m.nicht_verfuegbar.join(" · ") : "") + "\n" + MELDUNGEN_HINWEIS, m);
      } catch (e) {
        schritt("meldungen", "Meldungen (13F, Form 4, Kongress)", "nicht_verfuegbar", "Meldungen nicht verfügbar: " + (e && e.message ? e.message : "unbekannt"));
      }
    } else {
      schritt("meldungen", "Meldungen (13F, Form 4, Kongress)", "nicht_verfuegbar", `Die Datenquelle „${quelle.name}“ liefert keine Meldungen. 13F-Tracker und Kongress-Tracker stehen als eigene Werkzeuge bereit.`);
    }

    // 7. Screener-Regeln – trader-screener
    const tech = SC.kennzahlenAusKerzen(kerzen, { jetzt, letzteLaufend });
    const ds = SC.datensatz(symbol, tech, fundamental || {});
    const vorlagen = fundamental && !fundamental._hinweise.some((h) => h.includes("nicht verfügbar")) ? ["technisch", "fundamental"] : ["technisch"];
    const screen = vorlagen.map((v) => ({ vorlage: v, ...SC.screenen([ds], SC.VORLAGEN[v]) }));
    for (const s of screen) {
      const e = s.ergebnisse && s.ergebnisse[0];
      if (!e) { schritt("screener-" + s.vorlage, "Screener: " + SC.VORLAGEN[s.vorlage].name, "nicht_verfuegbar", s.fehler || "keine Auswertung"); continue; }
      schritt("screener-" + s.vorlage, "Screener: " + SC.VORLAGEN[s.vorlage].name, e.bestanden_alle ? "ok" : "warnung", (e.bestanden_alle ? "Alle Regeln erfüllt: " + e.bestanden.join("; ") : "Nicht erfüllt: " + e.durchgefallen.join("; ")) + (e.hinweise.length ? " · " + e.hinweise.join(" ") : ""), e);
    }

    // 8. Paper-Simulation (lokal, getrennt von Live)
    let simulation = null;
    if (optionen.simulation) {
      const r = P.replay({ name: `${symbol} (${quelle.name})`, symbol, intervall: "1d", kalender: "boerse", quelle: quelle.name + (quelle.synthetisch ? " – synthetische Testdaten" : ""), synthetisch: quelle.synthetisch, kerzen }, { ...optionen.simulation, ausreisser: optionen.simulation.ausreisser || optionen.ausreisser });
      // Name ab 11-02g eindeutig: eine von drei getrennten Simulationen (Paper-Kern hier, Timer/Planer-Werkzeug, Strategy Lab)
      if (r.fehler) schritt("simulation", "Paper-Kern-Simulation (lokal)", "nicht_verfuegbar", r.fehler);
      else { simulation = r.bericht; schritt("simulation", "Paper-Kern-Simulation (lokal)", "ok", `SIMULATION: ${r.bericht.trades} abgeschlossene Trades, realisiert ${r.bericht.realisiert} USD Spielgeld, größter Rückgang ${r.bericht.max_rueckgang_pct} % – nur Vergangenheit dieses Datensatzes, keine Prognose; nicht direkt vergleichbar mit Strategie-Vergleich oder Timer/Planer-Simulation.`, r.bericht); }
    }

    // Abschluss: Order nur über Worker-Risiko-Prüfung und Freigabe – in diesem Ablauf nie
    blockade("Order", "Dieser Ablauf sendet nie eine Order.", "Für eine Paper-Order: Risiko-Prüfung im Worker (trader-risk) und Freigabe genau dieser Order (trader-broker) – Not-Aus und alle Grenzen gelten.");
    // ab 11-02q-r: Zahl der tatsächlich verwendeten Kerzen und ob die letzte noch läuft (für Anzeige und lokale Einordnung)
    return ergebnis({ symbol, quelle, datenzeit, frisch: k.frisch, kurs, simulation, einstieg: ein.urteil || null, kerzen_anzahl: kerzen.length, letzte_laufend: letzteLaufend });
  }

  // ---------- Meldungen zu einem Symbol (ab 2026-11-01c) ----------
  // bundle: { f13: [{ filer, cik, quartal (AktienCopycat.quartalAufbauen), meta: {quartal, eingereicht, akz}, korrekturen: [Liste 13F-HR/A],
  //                   korrektur_ergebnis: {angewendet, nicht_angewendet} | null, neuere_vorhanden }],
  //           form4: { submissions, cik } | null, kongress: [Bericht (berichtLesen) oder manuelle Eingabe (manuellLesen)] }
  // Jede Angabe nennt Quelle, Einreichung, Zeitraum, Verzögerung und Unsicherheit. Es wird nichts bewertet oder empfohlen.
  const MELDUNGEN_HINWEIS = "Meldungen zeigen Vergangenes (Stichtage, Geschäfte vor Wochen) – keine Empfehlung, kein Ordervorschlag.";
  function meldungenAuswerten(symbol, bundle, jetzt) {
    const C = global.AktienCopycat, K = global.AktienKongress;
    const eintraege = [], nicht = [];
    const b = bundle || {};
    const tageSeit = (iso) => (iso ? Math.floor((jetzt - Date.parse(iso + "T00:00:00Z")) / TAG) : null);
    if (!C) nicht.push("13F/Form 4 (copycat.js nicht geladen)");
    if (!K) nicht.push("Kongress (kongress.js nicht geladen)");
    // 13F (trader-copycat)
    for (const f of (C && b.f13) || []) {
      const akt = C.aktualitaet(f.meta, new Date(jetzt).toISOString().slice(0, 10));
      for (const p of (f.quartal && f.quartal.positionen) || []) {
        if (p.ticker !== symbol || !C.istAktie(p)) continue;
        const u = ["Momentaufnahme zum Quartalsende – seitdem kann gehandelt worden sein"];
        if (p.ticker_pruefen) u.push("Ticker nur über den Namen zugeordnet (unsicher)");
        if (p.ticker_manuell) u.push("Ticker manuell zugeordnet");
        const offen = (f.korrekturen || []).filter((k) => !(f.korrektur_ergebnis && f.korrektur_ergebnis.angewendet.some((a) => a.akz === k.akz)));
        if (offen.length) u.push(`${offen.length} Änderungsmeldung(en) 13F-HR/A für dieses Quartal nicht eingerechnet`);
        if (f.korrektur_ergebnis && f.korrektur_ergebnis.angewendet.length) u.push("enthält Änderungen: " + f.korrektur_ergebnis.angewendet.map((a) => `${a.art} ${a.akz}`).join(", "));
        if (f.neuere_vorhanden) u.push("es gibt eine neuere 13F-Meldung dieses Filers – diese Angabe ist überholt");
        eintraege.push({ art: "13F", quelle: `SEC EDGAR · ${f.filer} (CIK ${f.cik}) · Akz. ${f.meta.akz}`, eingereicht: f.meta.eingereicht, zeitraum: `Stichtag ${akt.stichtag} (${akt.berichtsquartal})`,
          verzoegerung_tage: akt.verzoegerung_tage, verspaetet: akt.verspaetet, alter_tage: akt.alter_tage, unsicherheit: u,
          text: `13F: ${f.filer} hielt ${symbol} zum ${akt.stichtag} (${akt.berichtsquartal}), ${p.anteil} % des gemeldeten Portfolios; eingereicht ${akt.eingereicht}, ${akt.verzoegerung_tage} Tage nach dem Stichtag${akt.verspaetet ? " (später als 45 Tage)" : ""}, heute ${akt.alter_tage} Tage alt. Unsicher: ${u.join("; ")}.` });
      }
    }
    // Form 4 (nur Liste; Inhalt nicht ausgewertet)
    if (C && b.form4 && b.form4.submissions) {
      const liste = C.form4Liste(b.form4.submissions, { cik: b.form4.cik, heute: jetzt });
      const dop = C.meldungenPruefen(b.form4.submissions).doppelte;
      if (liste.length) {
        const spaet = liste.filter((x) => x.moeglicherweise_verspaetet).length;
        eintraege.push({ art: "Form 4", quelle: `SEC EDGAR submissions (CIK ${b.form4.cik})`, eingereicht: liste[0].eingereicht, zeitraum: `Transaktionen ${liste[liste.length - 1].transaktion || "?"} bis ${liste[0].transaktion || "?"}`,
          verzoegerung_tage: null, verspaetet: spaet > 0, alter_tage: liste[0].alter_tage, unsicherheit: [...liste[0].unsicher, ...(dop.length ? [`${dop.length} doppelt gelistete Meldung(en) nur einmal gezählt`] : [])],
          text: `Form 4: ${liste.length} Insider-Meldung(en) in 90 Tagen, zuletzt eingereicht ${liste[0].eingereicht} (Transaktion ${liste[0].transaktion || "?"}, ${liste[0].geschaeftstage ?? "?"} Geschäftstage später)${spaet ? `; ${spaet} möglicherweise nach der 2-Tage-Frist (Feiertage nicht berücksichtigt)` : ""}. Unsicher: ${liste[0].unsicher.join("; ")}.` });
      } else nicht.push("Form 4: keine Meldung in den letzten 90 Tagen");
    } else if (C) nicht.push("Form 4: keine SEC-Meldungsliste geladen");
    nicht.push("Inhalt der Form-4-Meldungen (keine Prüfdaten)");
    // Kongress (trader-pelosi)
    if (K && Array.isArray(b.kongress) && b.kongress.length) {
      const z = K.berichteZusammenfuehren(b.kongress);
      for (const zeile of z.zeilen) {
        if (zeile.ticker !== symbol) continue;
        const u = [zeile.quelle === "manuell" ? "manuell eingegeben, nicht geprüft" : "Text aus dem PDF eingefügt, nicht automatisch gegen das PDF geprüft"];
        if (zeile.doppelt) u.push("mögliches Duplikat einer anderen Zeile – nicht doppelt gezählt");
        if (zeile.fehlend && zeile.fehlend.length) u.push("fehlt/nicht lesbar: " + zeile.fehlend.join(", "));
        if (zeile.option) u.push("Optionsgeschäft");
        eintraege.push({ art: "Kongress", quelle: zeile.quelle === "manuell" ? "manuelle Eingabe" : `House Clerk PTR${zeile.doc_id ? " Dok. " + zeile.doc_id : ""}`, eingereicht: zeile.eingereicht || null,
          zeitraum: `Geschäft am ${zeile.datum || "?"}`, verzoegerung_tage: zeile.tage_bis_meldung ?? null, verspaetet: Boolean(zeile.verspaetet), alter_tage: tageSeit(zeile.datum), unsicherheit: u, doppelt: Boolean(zeile.doppelt),
          text: `Kongress: ${zeile.name || "Mitglied"} – ${zeile.geschaeft_name || zeile.geschaeft || "?"} ${symbol} am ${zeile.datum || "?"} (${zeile.betrag || "Betrag ?"}); eingereicht ${zeile.eingereicht || "unbekannt"}${zeile.tage_bis_meldung !== undefined ? `, ${zeile.tage_bis_meldung} Tage nach dem Geschäft${zeile.verspaetet ? " (später als 45 Tage)" : ""}` : ""}. Unsicher: ${u.join("; ")}.` });
      }
      if (z.doppelte_berichte.length) nicht.push(`doppelt geladene Berichte ignoriert: ${z.doppelte_berichte.join(", ")}`);
    } else if (K) nicht.push("Kongress: keine Berichte geladen");
    if (C) nicht.push(C.OPENFIGI.grund.split(":")[0]);
    if (K) nicht.push("automatisches PDF-Auslesen", "Senatsdaten automatisch");
    return { eintraege, nicht_verfuegbar: nicht };
  }

  // Lokaler Test-Provider: synthetische Tageskerzen je Symbol (deterministisch aus dem Symbol), letzte Kerze am letzten Handelstag vor
  // „jetzt“. Keine Börsenuhr, keine SEC-Zahlen. Klar als synthetisch gekennzeichnet – keine Marktdaten.
  function testProvider({ symbole = ["AAPL", "MSFT", "KO", "JPM", "XOM", "NVDA"], jetzt = Date.now(), tage = 300 } = {}) {
    const P = global.PaperKern;
    const saat = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
    return {
      name: "Lokale Testdaten",
      beschreibung: "synthetisch erzeugte Tageskerzen (deterministisch je Symbol) – keine echten Kurse",
      synthetisch: true,
      symbole: symbole.slice(),
      arten: ["kerzen"],
      async kerzen({ symbol }) {
        if (!symbole.includes(symbol)) throw new Error(`Für ${symbol} gibt es keine lokalen Testdaten (verfügbar: ${symbole.join(", ")}).`);
        const ds = P.testdatensatz({ name: symbol, symbol, tage, saat: saat(symbol), start: 50 + (saat(symbol) % 200) });
        // Handelstage (Mo–Fr) rückwärts ab dem letzten Werktag vor „jetzt“ vergeben – die letzte Kerze ist damit höchstens 3 Tage alt
        const zeiten = [];
        let t = Math.floor(jetzt / TAG) * TAG - TAG;
        while (zeiten.length < ds.kerzen.length) { if (![0, 6].includes(new Date(t).getUTCDay())) zeiten.unshift(t); t -= TAG; }
        return ds.kerzen.map((x, i) => ({ ...x, t: zeiten[i] }));
      },
    };
  }

  global.AktienWorkflow = { analysieren, symbolPruefen, testProvider, meldungenAuswerten, US_TICKER, HINWEIS, MELDUNGEN_HINWEIS };
})(typeof window !== "undefined" ? window : globalThis);
