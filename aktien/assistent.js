// JARVIS Aktien – Assistent (ab Dashboard 2026-11-02a): Befehle (Intents) für US-Aktien, lokale Aktien-Watchlist, US-Aktien-Briefing
// und Strategie-Vergleich. Reine Rechnung ohne Netz und ohne eigene Befehlssteuerung: Die Erkennung wird im vorhandenen Skill-Dispatcher
// des Dashboards (skillRegistrieren) aufgerufen; Analyse läuft über das Aktienprofil (AktienProfil.dispatch), Backtests über das
// vorhandene Strategy Lab (StrategieLab.backtest), Vorlesen über die vorhandene Sprachausgabe. Kein Befehl erzeugt eine Order.
// Die vorhandene Watchlist des Dashboards (WATCH) ist eine Krypto-Kursliste und wird bewusst NICHT für Aktien erweitert.
(function (global) {
  "use strict";

  const US_TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
  const TAG = 86400000;
  // Wörter, die wie Ticker aussehen, aber keine sind (Befehlswörter in Großschrift)
  const KEIN_TICKER = new Set(["JARVIS", "AKTIE", "AKTIEN", "US", "USD", "SEC", "ETF", "ICH", "DU", "BITTE", "MIR", "UND", "DIE", "DER", "DAS", "ZU", "FÜR", "FUER", "NEWS", "OK", "JA", "NEIN", "PDF", "API", "EMA"]);

  // Großbuchstaben-Folge als möglicher Ticker. Nicht \b: In JavaScript ist „ä“ kein Wortzeichen, sonst würde aus „März“ das Symbol „M“.
  const BUCHSTABE = "A-Za-z0-9ÄÖÜäöüß";
  const TICKER_IM_TEXT = (flags = "") => new RegExp(`(?<![${BUCHSTABE}])[A-Z]{1,10}(?:\\.[A-Z]{1,2})?(?![${BUCHSTABE}])`, flags);

  // ---------- Intents ----------
  // Ergebnis: { intent, symbol, zeitraum, wert, art, rueckfrage, fehler }
  //   intent ∈ analysieren | nachrichten | meldungen | alarm | budget | rebalancing | watchlist_hinzu | watchlist_weg | strategie | briefing_aktie
  //            | hilfe | order_abgelehnt | null
  const MUSTER = [
    ["order_abgelehnt", /\b(kauf\w*|verkauf\w*|order|ordere|buy|sell|bestätige|bestaetige)\b(?!.*\bpaper\b)/],
    ["alarm", /\b(alarm|alert|benachrichtige)\b/],
    ["watchlist_weg", /\b(entfern\w*|lösch\w*|loesch\w*|streich\w*)\b.*\bwatch\s?list\b|\bwatch\s?list\b.*\b(entfern\w*|lösch\w*|loesch\w*)\b/],
    ["watchlist_hinzu", /\bwatch\s?list\b/],
    // ab 11-02d: vorher gingen diese Sätze an die KI und ein genannter Zeitraum ging verloren
    ["strategie", /\b(strategie\w*|backtest\w*)\b/],
    ["briefing_aktie", /\b(aktien-?briefing|briefing)\b/],
    ["nachrichten", /\b(nachricht\w*|news|schlagzeil\w*)\b/],
    ["meldungen", /\b(meldung\w*|filing\w*|13f|form ?4|insider|kongress|pelosi|8-k)\b/],
    ["rebalancing", /\b(rebalanc\w*|umschicht\w*|ausrichten)\b/],
    ["budget", /\bbudget\b/],
    // bewusst ohne „wie steht …“ und „profil“: zu allgemein (z. B. „Wie steht der DAX heute“ gehört an die KI)
    ["analysieren", /\b(analys\w*|analyse|prüf\w* die aktie|pruef\w* die aktie|aktienprofil)\b/],
    ["hilfe", /\b(aktien\s*hilfe|was kannst du (mit|bei) aktien|aktienfunktionen)\b/],
  ];
  // optionen.watchlist: Einträge der lokalen Aktien-Watchlist. Firmennamen werden NIE automatisch einem Ticker zugeordnet; passt ein
  // Wort zu einem selbst vergebenen Anzeigenamen, wird das Symbol nur als Auswahl angeboten (vorschlaege), nichts wird ausgeführt.
  function intentErkennen(text, { watchlist = [] } = {}) {
    const roh = String(text || "").trim();
    const t = roh.toLowerCase().replace(/^\s*(hey\s+)?jarvis[,\s]+/, "");
    const bezugAktie = /\b(aktie|aktien|symbol|ticker|watch\s?list|budget|rebalanc\w*|13f|form ?4|insider|pelosi|kongress)\b/.test(t) || TICKER_IM_TEXT().test(roh.replace(/^\s*(hey\s+)?jarvis[,\s]+/i, ""));
    let intent = null;
    for (const [name, rx] of MUSTER) if (rx.test(t)) { intent = name; break; }
    if (!intent) return { intent: null };
    // Ohne erkennbaren Aktienbezug nicht zuständig (z. B. „Nachrichten“ allgemein, Paper-Krypto-Befehle)
    if (!bezugAktie && intent !== "hilfe") return { intent: null };
    if (/\bpaper\b/.test(t) && intent === "order_abgelehnt") return { intent: null };
    // bis 10 Großbuchstaben erfassen, damit zu lange „Symbole“ als ungültig gemeldet statt übergangen werden
    const kandidaten = [...new Set((roh.match(TICKER_IM_TEXT("g")) || []).filter((x) => !KEIN_TICKER.has(x)))];
    const e = { intent, symbol: null, zeitraum: null, wert: null, art: null, rueckfrage: null, fehler: null, vorschlaege: [] };
    if (intent === "hilfe") { if (kandidaten.length === 1) e.symbol = kandidaten[0]; return e; }
    if (intent === "budget") {
      // Symbol optional (sonst Sitzungssymbol); ein genannter Zeitraum wird erkannt und in der Antwort als „gilt nicht für Budget“ erklärt
      if (kandidaten.length === 1) e.symbol = kandidaten[0];
      const zb = zeitraumErkennen(t);
      if (zb.rueckfrage) { e.rueckfrage = zb.rueckfrage; return e; }
      if (zb.zeitraum) e.zeitraum = zb.zeitraum;
      return e;
    }
    if (intent === "order_abgelehnt") { e.symbol = kandidaten[0] || null; return e; }
    if (kandidaten.length > 1) { e.rueckfrage = `Mehrere Symbole erkannt (${kandidaten.join(", ")}) – welches meinen Sie? Es wurde nichts ausgeführt.`; return e; }
    if (!kandidaten.length) {
      const wort = (t.match(/\b(?:aktie|zu|für|fuer|von)\s+([a-zäöü][\wäöü.-]{1,20})/) || [])[1];
      const woerter = t.split(/[^a-zäöüß0-9.-]+/).filter((w) => w.length >= 3);
      e.vorschlaege = (Array.isArray(watchlist) ? watchlist : []).filter((x) => x && x.anzeigename && woerter.some((w) => String(x.anzeigename).toLowerCase().split(/\s+/).includes(w))).map((x) => x.symbol).slice(0, 5);
      e.rueckfrage = e.vorschlaege.length ? `Kein Börsensymbol genannt. Laut deinen Watchlist-Namen kämen in Frage: ${e.vorschlaege.join(", ")} – bitte das Symbol ausdrücklich nennen. Es wurde nichts ausgeführt.`
        : wort ? `„${wort}“ ist kein Börsensymbol, eine Zuordnung zum Ticker ist nicht belegt. Bitte das US-Symbol nennen, z. B. „analysiere AAPL“. Es wurde nichts ausgeführt.` : "Für welches US-Aktiensymbol? Bitte z. B. „analysiere AAPL“ sagen. Es wurde nichts ausgeführt.";
      return e;
    }
    // Krypto-Paar (…USDT) bei Watchlist-Befehlen: auf die getrennte Krypto-Kursliste verweisen statt nur „ungültig“ (ab 11-02g)
    if (/USDT$/.test(kandidaten[0]) && (intent === "watchlist_hinzu" || intent === "watchlist_weg")) { e.fehler = `„${kandidaten[0]}“ ist ein Krypto-Paar. Die Aktien-Watchlist nimmt nur US-Aktien; die Krypto-Kursliste (Karte „Krypto-Kursliste (Watchlist)“) ist getrennt und wird nur dort bedient.`; return e; }
    if (!US_TICKER.test(kandidaten[0])) { e.fehler = `„${kandidaten[0]}“ ist kein gültiges US-Aktiensymbol.`; return e; }
    e.symbol = kandidaten[0];
    // Zeitraum (optional), nur eindeutige Formen: „letzte(n) N Tage(n)/Wochen“, „seit DATUM“, „vom/von/seit DATUM bis DATUM“;
    // DATUM = JJJJ-MM-TT oder TT.MM.JJJJ. Gültigkeit (Kalender, Reihenfolge, Zukunft) prüft zeitraumAufloesen.
    // Jede andere Zeitangabe (Monatsname, „letzten Monat“, „bis …“ ohne Beginn, zweistelliges Jahr, zwei Angaben) → Rückfrage statt Raten.
    // Strategie: Werteangaben („EMA 5 bis 20“, „Gebühr 0,1“) sind keine Zeitangaben – vor der Zeitraumerkennung entfernen
    const tz = intent === "strategie" ? t.replace(WERTE_IM_TEXT, " ") : t;
    const z = zeitraumErkennen(tz);
    // Alarm und Watchlist haben keinen Zeitraum: eine Zeitangabe wird nicht still übergangen, sondern zurückgefragt
    if ((z.zeitraum || z.rueckfrage) && (intent === "alarm" || intent === "watchlist_hinzu" || intent === "watchlist_weg")) {
      e.rueckfrage = `${intent === "alarm" ? "Ein Alarm" : "Die Watchlist"} hat keinen Zeitraum – die Zeitangabe würde nicht verwendet. Bitte ohne Zeitangabe sagen${intent === "alarm" ? " (ein Ablaufdatum lässt sich nur im Dashboard einstellen)" : ""}. Es wurde nichts ${intent === "alarm" ? "angelegt" : "geändert"}.`;
      return e;
    }
    if (z.rueckfrage) { e.rueckfrage = z.rueckfrage; return e; }
    if (z.zeitraum) e.zeitraum = z.zeitraum;
    if (intent === "alarm") {
      // kein \b vor „über“: „ü“ ist in JavaScript-Regex kein Wortzeichen
      const m = t.match(/(?:^|\s)(über|ueber|unter|stop)\s+(\d+(?:[.,]\d{1,2})?)(?![\d.,])/);
      if (!m) { e.rueckfrage = `Für den Alarm fehlt der Wert: z. B. „Alarm ${e.symbol} über 210“. Es gibt keinen Vorgabewert. Es wurde nichts angelegt.`; return e; }
      e.art = { "über": "ueber", ueber: "ueber", unter: "unter", stop: "stop" }[m[1]];
      e.wert = Number(m[2].replace(",", "."));
    }
    return e;
  }

  const DATUM = "(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\.\\d{1,2}\\.\\d{4})";
  const ZEIT_HINWEIS = /\b(seit|bis|vom|ab dem|letzte[nrms]?|vergangene[nrms]?|gestern|vorgestern|woche\w*|monat\w*|jahr\w*|quartal\w*|ytd|januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b|\d{1,2}\.\d{1,2}\.(\d{2}\b)?|\d{4}-\d{2}-\d{2}/;
  const ZEIT_BEISPIEL = "„letzte 30 Tage“, „seit 15.01.2026“ oder „vom 01.01.2026 bis 30.06.2026“";
  function isoDatum(s) { if (/^\d{4}-/.test(s)) return s; const [d, m, y] = s.split("."); return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; }
  // t: kleingeschriebener Befehl. Ergebnis: { zeitraum } | { rueckfrage } | {} (keine Zeitangabe)
  function zeitraumErkennen(t) {
    const vonBis = t.match(new RegExp(`\\b(?:vom|von|seit)\\s+(?:dem\\s+)?${DATUM}\\s+bis\\s+(?:zum\\s+)?${DATUM}(?!\\d|\\.\\d)`));
    const seit = !vonBis && t.match(new RegExp(`\\bseit\\s+(?:dem\\s+)?${DATUM}(?!\\d|\\.\\d)`));
    const letzte = t.match(/\b(?:letzte[nrm]?|vergangene[nrm]?)\s+(\d{1,4})\s+(tag|tage|tagen|woche|wochen)\b/);
    const treffer = [vonBis, seit, letzte].filter(Boolean);
    if (treffer.length > 1) return { rueckfrage: `Zwei verschiedene Zeitangaben erkannt – bitte nur eine nennen, z. B. ${ZEIT_BEISPIEL}. Es wurde nichts ausgeführt.` };
    if (vonBis) return { zeitraum: { von: isoDatum(vonBis[1]), bis: isoDatum(vonBis[2]) } };
    if (seit) {
      // „seit DATUM“ plus ein weiteres „bis“ ohne erkennbares Datum wäre nur halb ausgewertet
      if (/\bbis\b/.test(t.slice(seit.index + seit[0].length))) return { rueckfrage: `Ende des Zeitraums nicht eindeutig erkannt – bitte z. B. ${ZEIT_BEISPIEL} sagen. Es wurde nichts ausgeführt.` };
      return { zeitraum: { von: isoDatum(seit[1]), bis: null } };
    }
    if (letzte) return { zeitraum: { tage: Number(letzte[1]) * (/^woche/.test(letzte[2]) ? 7 : 1) } };
    const hinweis = t.match(ZEIT_HINWEIS);
    if (hinweis) return { rueckfrage: `Zeitraum nicht eindeutig erkannt („${hinweis[0]}“) – bitte so angeben: ${ZEIT_BEISPIEL}. Monate, Jahre und Monatsnamen werden nicht geschätzt. Es wurde nichts ausgeführt.` };
    return {};
  }

  // Zeitraum aus dem Befehl in feste UTC-Tage auflösen: { von, bis } (JJJJ-MM-TT) oder { fehler }. Streng: ungültiges Kalenderdatum,
  // Beginn nach Ende oder Ende in der Zukunft → Fehler statt stiller Korrektur. „letzte N Tage“: von = heute − N Tage, bis = heute.
  function zeitraumAufloesen(z, jetzt) {
    if (!z) return null;
    const tag = (ms) => new Date(ms).toISOString().slice(0, 10);
    const gueltig = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + "T00:00:00Z")) && tag(Date.parse(s + "T00:00:00Z")) === s;
    if (!Number.isFinite(jetzt)) return { fehler: "Bezugszeit fehlt – Zeitraum nicht auflösbar." };
    const heute = tag(jetzt);
    let von, bis;
    if (z.tage !== undefined) {
      if (!(Number.isInteger(z.tage) && z.tage >= 1 && z.tage <= 3650)) return { fehler: "Zeitraum ungültig: „letzte N Tage“ nur mit 1 bis 3650 Tagen." };
      von = tag(Date.parse(heute + "T00:00:00Z") - z.tage * TAG); bis = heute;
    } else { von = z.von; bis = z.bis || heute; }
    if (!gueltig(von) || !gueltig(bis)) return { fehler: `Zeitraum ungültig: kein gültiges Kalenderdatum (${!gueltig(von) ? von : bis}).` };
    if (von > bis) return { fehler: `Zeitraum ungültig: Beginn ${von} liegt nach dem Ende ${bis}.` };
    if (bis > heute) return { fehler: `Zeitraum ungültig: Ende ${bis} liegt in der Zukunft.` };
    return { von, bis };
  }

  // ---------- Antworten aus dem Profil ----------
  const STATUS_TEXT = { ok: "bereit", warnung: "teilweise verfügbar", veraltet: "veraltet", blockiert: "blockiert", fehler: "blockiert", unbekannt: "blockiert", nicht_verfuegbar: "nicht verfügbar" };
  const MODUL_FUER_INTENT = { analysieren: "analyse", nachrichten: "nachrichten", meldungen: "meldungen", budget: "budget", rebalancing: "rebalance" };
  // Kurze Antwort: Status, erste Ergebnisse, Blockade mit nächstem sicherem Schritt. lang: alle Zeilen mit Quellen und Unsicherheiten.
  function antwortAusProfil(d, intent, { lang = false } = {}) {
    if (!d || !d.ok) return "Aktienprofil nicht erstellt: " + ((d && d.fehler) || ["unbekannt"]).join(" ") + " Es wurde nichts ausgeführt.";
    const modul = MODUL_FUER_INTENT[intent] || "analyse";
    const e = d.ergebnisse.find((x) => x.modul === modul);
    if (!e) return "Dieser Bereich ist im Profil nicht vorhanden.";
    const teile = [`${d.kontext.symbol} – ${e.titel}: ${STATUS_TEXT[e.status] || e.status}.`];
    // Leerer Zeitraum ist etwas anderes als ein nicht unterstützter: Daten fehlen dort, nichts wird durch andere Zeiträume ersetzt (ab 11-02f)
    const datenSchritt = modul === "analyse" && e.daten && e.daten.schritte ? e.daten.schritte.find((s) => s.id === "daten") : null;
    const leer = d.kontext.zeitraum && datenSchritt && datenSchritt.status === "nicht_verfuegbar";
    if (leer) teile.push(`Im Zeitraum ${d.kontext.zeitraum.von} bis ${d.kontext.zeitraum.bis} liefert die Quelle keine Tageskerzen – nichts analysiert, kein Ersatz durch andere Zeiträume.`);
    else if (d.kontext.zeitraum) teile.push(modul === "analyse" ? `Zeitraum ${d.kontext.zeitraum.von} bis ${d.kontext.zeitraum.bis} angewendet${datenSchritt && /^\d+ Tageskerzen/.test(datenSchritt.text) ? " (" + datenSchritt.text.split(" von ")[0] + ")" : ""}.` : `Hinweis: Der Zeitraum ${d.kontext.zeitraum.von} bis ${d.kontext.zeitraum.bis} filtert nur Kursdaten und daraus berechnete Werte – der Bereich „${e.titel}“ bleibt außerhalb dieses Zeitfilters.`);
    if (modul === "analyse" && e.daten) {
      const a = e.daten;
      teile.push(`Quelle ${a.quelle ? a.quelle.name + (a.quelle.synthetisch ? " (synthetische Testdaten)" : "") : "unbekannt"}, Datenzeit ${a.datenzeit ? new Date(a.datenzeit).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unbekannt"}.`);
      const ein = a.schritte.find((s) => s.id === "einstieg");
      if (ein) teile.push("Entry-Timer: " + ein.text);
      if (lang) for (const s of a.schritte) if (s.id !== "einstieg") teile.push(`${s.titel}: ${s.text}`);
    } else {
      const z = lang ? e.zeilen : e.zeilen.slice(0, 2);
      if (z.length) teile.push(z.join(" "));
      if (e.quellen.length) teile.push("Quelle: " + e.quellen.join(", ") + ".");
    }
    // Satzende nur ergänzen, wenn der Text nicht schon mit einem Satzzeichen endet (vorher „geprüft.. Nächster …“)
    const satz = (t) => (/[.!?]$/.test(String(t).trim()) ? String(t).trim() : String(t).trim() + ".");
    if (e.unsicherheiten.length) teile.push(satz("Unsicher: " + (lang ? e.unsicherheiten : e.unsicherheiten.slice(0, 1)).join("; ")));
    const b = e.blockaden.filter((x) => !/Dieser Ablauf sendet nie eine Order/.test(x.grund));
    if (b.length) teile.push(`Blockiert: ${satz(b[0].grund)} Nächster sicherer Schritt: ${satz(b[0].naechster_schritt)}`);
    if (lang && d.zusammenfassung) teile.push(d.zusammenfassung.text);
    teile.push("Keine Empfehlung, keine Order.");
    return teile.join(" ");
  }

  function hilfeText() {
    const P = global.AktienProfil;
    const verfuegbar = ["Aktie analysieren („analysiere AAPL“) – Kursdaten, Chart-Scanner, Entry-Timer, Exit-Planer, Quartalszahlen, Screener, Paper-Simulation",
      "Nachrichten ansehen („Nachrichten zu AAPL“) – aus dem zuletzt geladenen News-Werkzeug", "Meldungen prüfen („Meldungen zu AAPL“) – 13F, Form-4-Liste, Kongress aus geprüften Daten",
      "Alarm setzen („Alarm AAPL über 210“) – nur mit eigenem Wert, nach Bestätigung", "Budget anzeigen („Budget für AAPL“) und Rebalancing prüfen („Rebalancing AAPL“) – nur mit eigenen Zielen und Worker-Grenzen",
      "Aktien-Watchlist („setze AAPL auf die Watchlist“) – nur Symbole aus der Allowlist; getrennt von der Krypto-Kursliste",
      "Aktien-Briefing („Briefing zu AAPL letzte 30 Tage“) – aus der Analyse dieser Sitzung",
      "Strategie-Vergleich geführt („Strategievergleich AAPL letzte 60 Tage“) – fehlende Werte (Startkapital, Gebühr, Slippage, EMA) werden erfragt, gerechnet wird erst nach Zusammenfassung und „Ja“ (historische Simulation)",
      "Zeitraum („letzte 30 Tage“, „seit 15.01.2026“, „vom … bis …“) – filtert nur Kursdaten und daraus berechnete Werte"];
    const nicht = ["Orders per Sprache oder Chat (nie)", "Vorgabewerte für Startkapital, Gebühr, Slippage oder EMA (gibt es nicht – sie werden erfragt)",
      "Zeiträume in Monaten oder Jahren (bitte Tage oder Datum)", "Paper-Buchung per Sprache (nur im Dashboard mit Bestätigung genau eines Vorschlags)",
      "OpenFIGI-Zuordnung, automatisches PDF-Auslesen, automatische Senatsdaten, Form-4-Inhalt (keine Prüfbasis)", "Steuerfunktionen (ausgeschlossen)"];
    return "US-Aktien – verfügbar: " + verfuegbar.join(" · ") + ". Nicht verfügbar: " + nicht.join(" · ") + "." + (P ? "" : " (Aktienprofil nicht geladen)");
  }

  // ---------- Watchlist (lokal) ----------
  const WL_ART = "jarvis-aktien-watchlist";
  const WL_MAX = 50;
  const GEHEIM = /(sk-[a-z0-9]{8,}|api[_-]?key|passwor[dt]|secret|token|zugangscode|freigabecode)\s*[:=]?|[A-Za-z0-9+/]{32,}/i;
  function wlEintragPruefen(e, allowlist) {
    if (!e || typeof e !== "object") return "Eintrag ist kein Objekt.";
    const s = String(e.symbol || "");
    if (!US_TICKER.test(s)) return `„${s.slice(0, 12)}“ ist kein gültiges US-Aktiensymbol.`;
    if (!Array.isArray(allowlist)) return "Allowlist unbekannt – ohne sie wird nichts gespeichert (Worker verbinden).";
    if (!allowlist.includes(s)) return `${s} steht nicht in der Allowlist.`;
    if (e.id !== "wl-" + s) return `${s}: Kennung ungültig.`;
    if (!Number.isFinite(Date.parse(e.erstellt))) return `${s}: Erstellungszeit ungültig.`;
    if (e.notiz !== undefined && (typeof e.notiz !== "string" || e.notiz.length > 200 || GEHEIM.test(e.notiz))) return `${s}: Notiz ungültig (höchstens 200 Zeichen, keine Schlüssel oder Codes).`;
    if (e.anzeigename !== undefined && (typeof e.anzeigename !== "string" || e.anzeigename.length > 60 || GEHEIM.test(e.anzeigename))) return `${s}: Anzeigename ungültig.`;
    const erlaubt = ["id", "symbol", "erstellt", "notiz", "anzeigename"];
    if (Object.keys(e).some((k) => !erlaubt.includes(k))) return `${s}: unerwartete Felder (${Object.keys(e).filter((k) => !erlaubt.includes(k)).join(", ")}).`;
    return null;
  }
  // Speicherinhalt lesen: leer → leere Liste; kaputt → beschaedigt (nicht verwenden, nicht überschreiben)
  function wlLesen(roh) {
    if (roh === null || roh === undefined || roh === "") return { eintraege: [], beschaedigt: false };
    let d;
    try { d = JSON.parse(roh); } catch { return { eintraege: [], beschaedigt: true, grund: "kein gültiges JSON" }; }
    if (!d || d.art !== WL_ART || d.version !== 1 || !Array.isArray(d.eintraege)) return { eintraege: [], beschaedigt: true, grund: "unbekanntes Format" };
    const ids = new Set();
    for (const e of d.eintraege) {
      const f = wlEintragPruefen(e, d.eintraege.map((x) => x && x.symbol)); // Format prüfen; Allowlist erst beim Anzeigen
      if (f || ids.has(e.id)) return { eintraege: [], beschaedigt: true, grund: f || "doppelter Eintrag " + e.id };
      ids.add(e.id);
    }
    return { eintraege: d.eintraege.slice(0, WL_MAX), beschaedigt: false };
  }
  function wlText(eintraege) { return JSON.stringify({ art: WL_ART, version: 1, eintraege }); }
  function wlHinzufuegen(stand, { symbol, notiz, anzeigename, jetzt, allowlist }) {
    if (!stand || stand.beschaedigt) return { fehler: "Watchlist-Speicher beschädigt – nichts geändert. Erst ausdrücklich zurücksetzen." };
    const s = String(symbol || "").trim().toUpperCase();
    const e = { id: "wl-" + s, symbol: s, erstellt: new Date(jetzt).toISOString(), ...(notiz ? { notiz: String(notiz).trim() } : {}), ...(anzeigename ? { anzeigename: String(anzeigename).trim() } : {}) };
    const f = wlEintragPruefen(e, allowlist);
    if (f) return { fehler: f };
    if (stand.eintraege.some((x) => x.id === e.id)) return { fehler: `${s} steht schon auf der Watchlist.`, doppelt: true };
    if (stand.eintraege.length >= WL_MAX) return { fehler: `Höchstens ${WL_MAX} Einträge.` };
    return { eintraege: [...stand.eintraege, e] };
  }
  function wlEntfernen(stand, symbol) {
    if (!stand || stand.beschaedigt) return { fehler: "Watchlist-Speicher beschädigt – nichts geändert." };
    const id = "wl-" + String(symbol || "").trim().toUpperCase();
    if (!stand.eintraege.some((x) => x.id === id)) return { fehler: "Symbol steht nicht auf der Watchlist." };
    return { eintraege: stand.eintraege.filter((x) => x.id !== id) };
  }
  // Umordnen: richtung -1 (nach oben) oder +1 (nach unten); am Rand → Fehler, nichts geändert
  function wlVerschieben(stand, symbol, richtung) {
    if (!stand || stand.beschaedigt) return { fehler: "Watchlist-Speicher beschädigt – nichts geändert." };
    const i = stand.eintraege.findIndex((x) => x.id === "wl-" + String(symbol || "").trim().toUpperCase());
    if (i < 0) return { fehler: "Symbol steht nicht auf der Watchlist." };
    const j = i + (richtung < 0 ? -1 : 1);
    if (j < 0 || j >= stand.eintraege.length) return { fehler: "Eintrag steht schon am " + (j < 0 ? "Anfang." : "Ende.") };
    const neu = stand.eintraege.slice();
    [neu[i], neu[j]] = [neu[j], neu[i]];
    return { eintraege: neu };
  }
  // Import: ganze Datei vorab prüfen; ein einziger Fehler → nichts übernommen
  function wlImportPruefen(text, allowlist) {
    let d;
    try { d = JSON.parse(String(text || "")); } catch { return { fehler: "Datei ist kein gültiges JSON – nichts übernommen." }; }
    if (!d || d.art !== WL_ART || d.version !== 1 || !Array.isArray(d.eintraege)) return { fehler: "Keine JARVIS-Aktien-Watchlist (Format) – nichts übernommen." };
    if (d.eintraege.length > WL_MAX) return { fehler: `Mehr als ${WL_MAX} Einträge – nichts übernommen.` };
    const ids = new Set(), fehler = [];
    for (const e of d.eintraege) {
      const f = wlEintragPruefen(e, allowlist);
      if (f) fehler.push(f);
      else if (ids.has(e.id)) fehler.push(`${e.symbol}: doppelt.`);
      else ids.add(e.id);
    }
    return fehler.length ? { fehler: "Import abgelehnt, nichts übernommen: " + fehler.slice(0, 5).join(" ") } : { eintraege: d.eintraege };
  }

  // ---------- US-Aktien-Briefing ----------
  // Nur Daten aus dem übergebenen Profil (d = AktienProfil.dispatch) und dem Simulations-Portfolio. Jede Zeile: Bereich, Art
  // (beobachtet | einordnung | annahme | simulation | fehlt), Inhalt, Quelle, Stand. Ohne Quelle oder Stand → als „unbelegt“ markiert.
  function briefingErstellen(d, portfolio, { variante = "kurz", jetzt = Date.now() } = {}) {
    const zeilen = [];
    // kuenstlich (ab 11-03g): Stand stammt aus synthetischen Testdaten – künstliches Datum, kein echtes Datenalter (Einstufung unverändert)
    const z = (bereich, art, inhalt, quelle, stand, kuenstlich = false) => zeilen.push({ bereich, art, inhalt, quelle: quelle || null, stand: Number.isFinite(stand) ? stand : null, belegt: Boolean(quelle && Number.isFinite(stand)), kuenstlich: Boolean(kuenstlich) });
    if (!d || !d.ok) {
      z("Aktienprofil", "fehlt", "Kein Aktienprofil in dieser Sitzung – erst eine US-Aktie analysieren.", null, null);
      return fertig(zeilen, variante, jetzt);
    }
    const sek = Object.fromEntries(d.ergebnisse.map((e) => [e.modul, e]));
    const a = sek.analyse;
    if (a && a.daten && ["ok", "warnung", "veraltet"].includes(a.status)) {
      const w = a.daten;
      const synth = Boolean(w.quelle && w.quelle.synthetisch);
      z("Analyse", "beobachtet", `${d.kontext.symbol}: letzter Schluss ${w.kurs} (${synth ? "synthetische Testdaten" : w.quelle ? w.quelle.name : "?"})${a.status === "veraltet" ? " – VERALTET" : ""}.`, w.quelle && w.quelle.name, w.datenzeit, synth);
      if (d.kontext.zeitraum) z("Analyse", "annahme", `Zeitraum ${d.kontext.zeitraum.von} bis ${d.kontext.zeitraum.bis} (deine Vorgabe) – filtert nur Kursdaten und daraus berechnete Werte; Nachrichten, Meldungen, Alarme, Budget- und Rebalancing-Kurse bleiben außerhalb.`, "deine Eingabe", jetzt);
      else z("Analyse", "annahme", "Kein Zeitraum vorgegeben – berechnet über alle verfügbaren Tageskerzen der Quelle.", "keine Zeitraum-Vorgabe", jetzt);
      const sc = w.schritte.find((s) => s.id === "technik"), ein = w.schritte.find((s) => s.id === "einstieg");
      if (sc) z("Analyse", "einordnung", "Technische Einordnung (keine Prognose): " + sc.text, w.quelle && w.quelle.name, w.datenzeit, synth);
      if (ein && variante === "lang") z("Analyse", "einordnung", "Entry-Timer (Regel, keine Empfehlung): " + ein.text, w.quelle && w.quelle.name, w.datenzeit, synth);
      const sim = w.schritte.find((s) => s.id === "simulation");
      if (sim && variante === "lang") z("Analyse", "simulation", sim.text, "Paper-Kern (lokal)", w.datenzeit, synth);
    } else z("Analyse", "fehlt", `Analyse ${a ? STATUS_TEXT[a.status] : "nicht vorhanden"}${a && a.blockaden[0] ? ": " + a.blockaden[0].grund : ""}.`, null, null);
    const n = sek.nachrichten;
    if (n && ["ok", "warnung", "veraltet"].includes(n.status) && n.daten) {
      const gruppen = n.daten.gruppen || [];
      z("Nachrichten", "beobachtet", gruppen.length ? `${gruppen.length} Nachricht(en) mit gesicherter Zuordnung${n.status === "veraltet" ? " (veraltet)" : ""}: ` + gruppen.slice(0, variante === "lang" ? 5 : 2).map((g) => g.titel).join(" · ") : "Keine Nachricht mit gesicherter Zuordnung in der geladenen Quelle.", n.quellen.join(", "), n.datenzeit);
      if (variante === "lang" && n.unsicherheiten.length) z("Nachrichten", "einordnung", "Unsicher: " + n.unsicherheiten.join("; "), n.quellen.join(", "), n.datenzeit);
    } else z("Nachrichten", "fehlt", "Nachrichten " + (n ? STATUS_TEXT[n.status] : "nicht vorhanden") + ".", null, null);
    const m = sek.meldungen;
    if (m && m.daten && m.daten.eintraege && m.daten.eintraege.length) {
      for (const e of m.daten.eintraege.slice(0, variante === "lang" ? 10 : 2)) {
        const verz = e.art === "13F" || e.art === "Kongress" ? "Verzögerte Offenlegung (kein aktueller Trade, keine Echtzeitposition): " : "";
        const stand = Date.parse((e.eingereicht || "") + (String(e.eingereicht || "").length === 10 ? "T00:00:00Z" : ""));
        z("Meldungen", "beobachtet", verz + e.text, e.quelle, stand);
      }
    } else z("Meldungen", "fehlt", "Meldungen " + (m ? STATUS_TEXT[m.status] : "nicht vorhanden") + ".", null, null);
    const al = sek.alarme;
    if (al && ["ok", "warnung"].includes(al.status)) {
      const erkannt = (al.daten && al.daten.ausgeloest) || [];
      // ab 11-04i: bei lokalen Testdaten stammt das Alarm-Datenalter aus dem künstlichen Datum (wie die Analysezeilen gekennzeichnet)
      z("Alarme", "beobachtet", erkannt.length ? `${erkannt.length} Alarm(e) erkannt (keine Order): ` + erkannt.map((x) => x.text).join(" · ") : `${al.zeilen.length} Alarm(e) eingerichtet, keiner erkannt.`, al.quellen.join(", "), jetzt - (al.datenalter_ms || 0), Boolean(d.kontext && d.kontext.quelle === "lokal"));
      z("Alarme", "annahme", "Alarmwerte sind deine eigenen Einstellungen.", "Alarm-Werkzeug (lokal)", jetzt);
    } else z("Alarme", "fehlt", "Alarme " + (al ? STATUS_TEXT[al.status] : "nicht vorhanden") + ".", null, null);
    if (portfolio && portfolio.art === "simulation") {
      const pos = Object.entries(portfolio.positionen);
      z("Paper-Portfolio", "simulation", `SIMULATION (Spielgeld, kein Konto): Bargeld ${portfolio.bargeld} USD, ${pos.length} Position(en)${pos.length ? ": " + pos.map(([s, p]) => `${s} ${p.menge} Stück`).join(", ") : ""}, ${portfolio.ledger.length} Buchung(en).`, "lokales Simulations-Portfolio", jetzt);
    } else z("Paper-Portfolio", "fehlt", "Kein Simulations-Portfolio in dieser Sitzung.", null, null);
    return fertig(zeilen, variante, jetzt);
  }
  // Gruppen für Anzeige und Vorlesen (gleiche Reihenfolge): Fakten, Warnungen, Unsicherheiten, Simulation, nicht verfügbar
  const GRUPPEN = [["fakt", "Fakten"], ["warnung", "Warnungen"], ["unsicher", "Unsicherheiten"], ["simulation", "Simulation"], ["nicht_verfuegbar", "Nicht verfügbar"]];
  function gruppeVon(x) {
    if (x.art === "fehlt") return "nicht_verfuegbar";
    if (x.art === "simulation") return "simulation";
    if (!x.belegt || x.art === "einordnung" || x.art === "annahme") return "unsicher";
    if (/VERALTET|\(veraltet\)|^Verzögerte Offenlegung|Alarm\(e\) erkannt/.test(x.inhalt)) return "warnung";
    return "fakt";
  }
  function fertig(zeilen, variante, jetzt) {
    for (const x of zeilen) { x.gruppe = gruppeVon(x); x.alter_min = x.stand === null || x.kuenstlich ? null : Math.max(0, Math.round((jetzt - x.stand) / 60000)); }
    const gruppen = GRUPPEN.map(([id, titel]) => ({ id, titel, zeilen: zeilen.filter((x) => x.gruppe === id) })).filter((g) => g.zeilen.length);
    return { zeilen, gruppen, erstellt: new Date(jetzt).toISOString(), zeitzone_intern: "UTC", text: textAus(gruppen, variante, jetzt) };
  }
  const KUENSTLICH_TEXT = "künstliches Datum (synthetische Testdaten) – kein echtes Datenalter";
  function alterText(min, kuenstlich = false) { return kuenstlich ? KUENSTLICH_TEXT : min === null ? "" : min < 120 ? `${min} min alt` : min < 2880 ? `${Math.round(min / 60)} h alt` : `${Math.round(min / 1440)} Tage alt`; }
  function textAus(gruppen, variante, jetzt) {
    const art = { beobachtet: "Beobachtet", einordnung: "Einordnung", annahme: "Annahme", simulation: "Simulation", fehlt: "Fehlt" };
    return "US-Aktien-Briefing (" + (variante === "lang" ? "ausführlich" : "kurz") + `), erstellt ${new Date(jetzt).toISOString().slice(0, 16).replace("T", " ")} UTC. ` + gruppen.map((g) => g.titel + ": " + g.zeilen.map((x) => `${x.bereich} – ${art[x.art]}: ${x.inhalt}${x.belegt ? ` (Quelle: ${x.quelle}, Stand ${new Date(x.stand).toISOString().slice(0, 16).replace("T", " ")} UTC, ${alterText(x.alter_min, x.kuenstlich)})` : x.art === "fehlt" ? "" : " (ohne Beleg – nicht als Tatsache)"}`).join(" ")).join(" ") + " Keine Empfehlung, keine Prognose, keine Order.";
  }

  // ---------- Strategie-Vergleich (vorhandenes Strategy Lab) ----------
  // e: { symbol, kerzen, quelle, synthetisch, frisch, startkapital, gebuehrPct, slippagePct, strategien: [{ name, parameter }] }
  // Alle Werte Pflicht – StrategieLab.backtest hätte eigene Standardwerte, die hier nie greifen dürfen.
  // Pflichtfelder (vor jeder Berechnung geprüft, nie aufgefüllt)
  const PFLICHTFELDER = ["symbol", "kerzen", "quelle", "synthetisch", "frisch", "startkapital", "gebuehrPct", "slippagePct", "strategien"];
  // Regeln je Strategie, so wie sie im Strategy Lab implementiert sind; alles darüber hinaus (z. B. Eignung für bestimmte Marktphasen,
  // Herkunft aus dem Trader-Skill) ist nicht belegt und wird als „unbekannt“ ausgewiesen.
  const REGELN = {
    "kaufen-und-halten": { regel: "Kauf zur Eröffnung nach der ersten Kerze, Halten bis zum Ende (Vergleichsbasis).", parameter: [], unbekannt: ["Eignung je Marktphase", "Bezug zum Trader-Skill"] },
    "ema-kreuzung": { regel: "Kauf, wenn die kurze EMA die lange von unten kreuzt; Verkauf bei Kreuzung nach unten. Ausführung jeweils zur nächsten Eröffnung.", parameter: ["kurz", "lang"], unbekannt: ["Eignung je Marktphase", "Bezug zum Trader-Skill"] },
  };
  const METHODE = "strategie-lab-backtest/1 (Signal am Schluss, Ausführung nächste Eröffnung, Gebühr und Slippage je Seite)";
  function strategieVergleich(e) {
    const S = global.StrategieLab, D = global.JarvisDaten;
    if (!S || !D) return { fehler: "Strategy Lab oder Datenquellen nicht geladen." };
    if (!e || typeof e !== "object") return { fehler: "Keine Eingaben – es werden keine Standardwerte angenommen." };
    const ohne = PFLICHTFELDER.filter((f) => e[f] === undefined || e[f] === null || e[f] === "");
    if (ohne.length) return { fehler: "Pflichtfelder fehlen: " + ohne.join(", ") + " – es werden keine Standardwerte angenommen.", fehlende_felder: ohne };
    if (!US_TICKER.test(String(e && e.symbol || ""))) return { fehler: "Nur US-Aktiensymbole." };
    const fehlt = [];
    if (!(Number.isFinite(Number(e.startkapital)) && Number(e.startkapital) > 0 && Number(e.startkapital) <= 1e9)) fehlt.push("Startkapital");
    if (!(Number.isFinite(e.gebuehrPct) && e.gebuehrPct >= 0 && e.gebuehrPct < 10)) fehlt.push("Gebühr %");
    if (!(Number.isFinite(e.slippagePct) && e.slippagePct >= 0 && e.slippagePct < 10)) fehlt.push("Slippage %");
    if (!Array.isArray(e.strategien) || !e.strategien.length) fehlt.push("Strategien");
    for (const s of e.strategien || []) {
      if (!S.STRATEGIEN[s.name]) return { fehler: `Unbekannte Strategie „${String(s.name).slice(0, 30)}“.` };
      if (s.name === "ema-kreuzung" && !(Number.isInteger(s.parameter && s.parameter.kurz) && Number.isInteger(s.parameter && s.parameter.lang) && s.parameter.kurz >= 2 && s.parameter.lang > s.parameter.kurz)) fehlt.push("EMA kurz/lang (ganze Zahlen, kurz < lang)");
    }
    if (fehlt.length) return { fehler: "Parameter fehlen oder ungültig: " + [...new Set(fehlt)].join(", ") + " – es werden keine Standardwerte angenommen." };
    const q = D.kerzenPruefen(e.kerzen, { intervall: "1d", kalender: "boerse" });
    if (!q.ok) return { fehler: "Testdaten ungültig: " + q.fehler.text };
    if (e.frisch === false) return { fehler: "Kursdaten veraltet – kein Vergleich." };
    const kerzen = q.kerzen;
    // Zu kurze Reihe ergäbe ein scheinbar gültiges Ergebnis ohne jede Handelsmöglichkeit (ab 11-02f blockiert):
    // „Kaufen und halten“ kauft zur Eröffnung der 2. Kerze; die EMA-Kreuzung braucht den ersten Wert der langen EMA (Kerze „lang“),
    // eine Vorkerze zum Vergleich und eine Folgekerze zur Ausführung → mindestens lang + 2 Kerzen.
    const mindest = Math.max(2, ...e.strategien.map((s) => (s.name === "ema-kreuzung" ? s.parameter.lang + 2 : 2)));
    if (kerzen.length < mindest) return { fehler: `Zu wenige Tageskerzen (${kerzen.length}) – für diesen Vergleich sind mindestens ${mindest} nötig${mindest > 2 ? ` (EMA lang ${mindest - 2} + 2)` : ""}. Bitte einen längeren Zeitraum oder kürzere EMA wählen – es wurde nichts berechnet.` };
    const ergebnisse = e.strategien.map((s) => {
      const r = S.backtest(kerzen, { startkapital: Number(e.startkapital), gebuehr: e.gebuehrPct / 100, slippage: e.slippagePct / 100, strategie: s.name, parameter: { ...(s.parameter || {}) } });
      return r.fehler ? { name: s.name, fehler: r.fehler } : {
        name: s.name, titel: S.STRATEGIEN[s.name].name, parameter: r.einstellungen.parameter, trades: r.anzahl_trades, gewinn_trades: r.gewinn_trades,
        veraenderung_prozent: r.gewinn_prozent, max_rueckgang_prozent: r.max_rueckgang_prozent, gebuehren: r.gebuehren_usdt, offene_position: Boolean(r.offene_position),
        letzter_trade: r.trades.length ? r.trades[r.trades.length - 1].ausstieg_zeit : null, roh: r,
      };
    });
    const kaputt = ergebnisse.filter((x) => x.fehler || ![x.veraenderung_prozent, x.max_rueckgang_prozent].every(Number.isFinite));
    if (kaputt.length) return { fehler: "Berechnung fehlgeschlagen (" + kaputt.map((x) => x.name + ": " + (x.fehler || "nicht endliche Kennzahl")).join("; ") + ") – kein Vergleich, keine Teilwerte." };
    return {
      simulation: true, symbol: e.symbol, zeitraum: { von: kerzen[0].t, bis: kerzen[kerzen.length - 1].t, kerzen: kerzen.length }, methode: METHODE,
      regeln: e.strategien.map((s) => ({ name: s.name, ...REGELN[s.name], werte: { ...(s.parameter || {}) } })),
      quelle: e.quelle, synthetisch: Boolean(e.synthetisch), zeitraumVorgabe: e.zeitraumVorgabe && e.zeitraumVorgabe.von ? { von: e.zeitraumVorgabe.von, bis: e.zeitraumVorgabe.bis } : null,
      annahmen: { startkapital: Number(e.startkapital), gebuehrPct: e.gebuehrPct, slippagePct: e.slippagePct, quelle: "deine Eingabe (Simulationsannahme)", ausfuehrung: "Signal am Schluss, Ausführung zur nächsten Eröffnung (Strategy Lab)" },
      ergebnisse, hinweis: "SIMULATION auf " + (e.synthetisch ? "synthetischen Testdaten (keine historischen Marktdaten)" : "den geladenen Kursdaten") + " – keine Prognose, kein Renditeversprechen, keine Aussage, welche Strategie künftig besser ist; kein echtes Konto.",
    };
  }

  // ---------- Geführter Strategie-Vergleich per Sprache (ab 11-02e) ----------
  // Verglichen werden die beiden vorhandenen Strategy-Lab-Strategien „EMA-Kreuzung“ und „Kaufen und halten“. Nötige Eingaben genau nach
  // StrategieLab.backtest: Startkapital, Gebühr, Slippage (beide in % je Seite) und für die EMA-Kreuzung kurz/lang. „Kaufen und halten“ braucht
  // keine Parameter. Es gibt keine Vorgabewerte – fehlende Werte werden erfragt.
  const STRATEGIE_EINGABEN = [
    { id: "startkapital", titel: "Startkapital in USD", beispiel: "Startkapital 10000" },
    { id: "gebuehrPct", titel: "Gebühr in % je Seite", beispiel: "Gebühr 0,1" },
    { id: "slippagePct", titel: "Slippage in % je Seite", beispiel: "Slippage 0,05" },
    { id: "emaKurz", titel: "EMA kurz (ganze Zahl)", beispiel: "EMA 5 und 20" },
    { id: "emaLang", titel: "EMA lang (ganze Zahl, größer als kurz)", beispiel: "EMA 5 und 20" },
  ];
  // Zahl in Ziffern: „10.000“ = „10 000“ = 10000, „0,1“ = 0.1, „1.5“ = 1.5, „10.000,5“ = 10000.5
  function zahlLesen(s) {
    const t = String(s).trim().replace(/ /g, ".");
    if (/,/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
    return Number(t);
  }
  // Deutsche Zahlwörter (ab 11-02f), nur eindeutig und reproduzierbar: ganze Zahlen bis 999.999.999 („zehntausend“, „zehn tausend“,
  // „zweihundertfünfzig“, „fünfundzwanzig“, „eine Million“) und Dezimalen mit „Komma“, deren Nachkommastellen einzelne Ziffernwörter sind
  // („null komma null fünf“ = 0,05). Alles andere („null komma fünfzehn“, „ein paar“, „etwa …“, Brüche) → null = bitte Ziffern.
  const EINER = { ein: 1, eins: 1, eine: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
  const ZEHNER = { zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19,
    zwanzig: 20, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
  const ZIFFERWORT = { null: "0", eins: "1", ein: "1", zwei: "2", zwo: "2", drei: "3", vier: "4", fünf: "5", sechs: "6", sieben: "7", acht: "8", neun: "9" };
  const MORPHEM = "(?:null|millionen|million|tausend|hundert|zwanzig|dreißig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig|zwölf|elf|zehn|sieben|sech|sieb|eins|eine|ein|zwei|zwo|drei|vier|fünf|sechs|acht|neun|und)";
  const ZAHLWORT_TOKEN = new RegExp(`^${MORPHEM}+$`);
  function zahlwortNormal(s) { return String(s).toLowerCase().replace(/ue/g, "ü").replace(/oe/g, "ö").replace(/dreissig/g, "dreißig"); }
  function bis99(s) {
    if (s in EINER) return EINER[s];
    if (s in ZEHNER) return ZEHNER[s];
    const m = s.match(/^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(zwanzig|dreißig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig)$/);
    return m ? EINER[m[1]] + ZEHNER[m[2]] : null;
  }
  function bis999(s) {
    if (s === "") return 0;
    const m = s.match(/^(.*?)hundert(?:und)?(.*)$/);
    if (!m) return bis99(s);
    const h = m[1] === "" ? 1 : EINER[m[1]];
    if (!h) return null;
    const rest = m[2] === "" ? 0 : bis99(m[2]);
    return rest === null ? null : h * 100 + rest;
  }
  function bis999999(s) {
    const m = s.match(/^(.*?)tausend(?:und)?(.*)$/);
    if (!m) return s === "" ? null : bis999(s);
    const t = m[1] === "" ? 1 : bis999(m[1]);
    const rest = bis999(m[2]);
    return t && rest !== null ? t * 1000 + rest : null;
  }
  function ganzLesen(s) {
    if (s === "null") return 0;
    const m = s.match(/^(.*?)million(?:en)?(?:und)?(.*)$/);
    if (!m) return bis999999(s);
    const mio = m[1] === "" || m[1] === "eine" || m[1] === "ein" ? 1 : bis999(m[1]);
    const rest = m[2] === "" ? 0 : bis999999(m[2]);
    return mio && rest !== null ? mio * 1e6 + rest : null;
  }
  // tokens: Wörter in Reihenfolge; Ergebnis Zahl oder null
  function zahlwortLesen(tokens) {
    let t = tokens.map(zahlwortNormal).filter((x) => x !== "");
    while (t.length && t[t.length - 1] === "und") t.pop(); // „zehntausend und Gebühr …“: verbindendes „und“ gehört nicht zur Zahl
    let vorzeichen = 1;
    if (t[0] === "minus") { vorzeichen = -1; t = t.slice(1); } else if (t[0] === "plus") t = t.slice(1);
    const k = t.indexOf("komma");
    const ganzTeil = (k < 0 ? t : t.slice(0, k)).join("");
    if (!ganzTeil) return null;
    const ganz = ganzLesen(ganzTeil);
    if (ganz === null) return null;
    if (k < 0) return vorzeichen * ganz;
    const nach = t.slice(k + 1);
    if (!nach.length || nach.includes("komma") || !nach.every((w) => w in ZIFFERWORT)) return null;
    return vorzeichen * Number(`${ganz}.${nach.map((w) => ZIFFERWORT[w]).join("")}`);
  }
  // Wert hinter einem Feldwort: { wert } oder { unklar: true }. Ziffern mit Vorzeichen (+/−, plus/minus), Tausenderpunkt oder -leerzeichen,
  // Dezimalkomma/-punkt; sonst Zahlwörter. Füllwörter („von“, „beträgt“, „auf“) davor sind erlaubt, Einheiten (%, Prozent, USD) danach.
  function wertLesen(segment) {
    const s = zahlwortNormal(segment).replace(/^(?:(?:von|beträgt|beträgt|ist|soll|sei|auf|mit|:|=)\s*)+/, "").trim();
    if (!s) return { unklar: true };
    // Folgt auf die Zahl Ungenauigkeit oder eine Alternative („ein paar tausend“, „10000 oder 20000“, „fünf Zehntel“), wird nicht geraten
    const UNSCHARF = /^(?:paar|etwa|ungefähr|circa|ca\.?|rund|knapp|gut|mehr|weniger|oder|bis|zehntel|hundertstel|tausendstel|halb|halbe|halben|viertel|drittel)\b/;
    const d = s.match(/^([+-]|plus\s+|minus\s+)?\s*([1-9]\d{0,2}(?:[ .]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?!\d)/);
    if (d) {
      const rest = s.slice(d[0].length).replace(/^\s*(?:%|prozent|usd|dollar)?[\s,]*/, "");
      if (UNSCHARF.test(rest)) return { unklar: true };
      const v = zahlLesen(d[2]);
      return Number.isFinite(v) ? { wert: /^(-|minus)/.test(d[1] || "") ? -v : v } : { unklar: true };
    }
    const woerter = s.split(/[\s,]+/), tokens = [];
    for (const w of woerter) { if (w === "komma" || w === "minus" || w === "plus" || ZAHLWORT_TOKEN.test(w)) tokens.push(w); else break; }
    const naechstes = woerter.slice(tokens.length).filter((w) => !/^(?:%|prozent|usd|dollar)$/.test(w))[0] || "";
    if (UNSCHARF.test(naechstes)) return { unklar: true };
    const v = tokens.length ? zahlwortLesen(tokens) : null;
    return v === null ? { unklar: true } : { wert: v };
  }
  const FELD_RX = /(?<![a-zäöüß])(start\s*kapital|kapital|geb(?:ü|ue)hr(?:en)?|slippage|ema\s*kurz|ema\s*lang|ema)(?![a-zäöüß])/g;
  const FELD_ID = (w) => /kapital/.test(w) ? "startkapital" : /geb/.test(w) ? "gebuehrPct" : w === "slippage" ? "slippagePct" : /kurz/.test(w) ? "emaKurz" : /lang/.test(w) ? "emaLang" : "ema";
  // Für die Zeitraumerkennung: Feldwort samt Wert (Ziffern oder Zahlwörter) entfernen – „EMA 5 bis 20“ ist keine Zeitangabe
  const WERTE_IM_TEXT = new RegExp(`(?:start\\s*kapital|kapital|geb(?:ü|ue)hr(?:en)?|slippage|ema\\s*(?:kurz|lang)?)\\s*(?:von|:|=)?\\s*(?:[+-]|plus\\s+|minus\\s+)?(?:[\\d.,]+(?:\\s\\d{3})*|(?:${MORPHEM}+|komma)(?:\\s+(?:${MORPHEM}+|komma))*)(?:\\s*(?:und|\\/|,|-|bis)\\s*(?:lang\\s*)?\\d+)?\\s*(?:%|prozent|usd|dollar)?`, "g");
  // Ergebnis: { werte: {…nur eindeutig erkannte}, unklar: [ids – Feld genannt, Wert nicht eindeutig], abbrechen, erkannt }
  function strategieWerteErkennen(text) {
    const t = " " + String(text || "").toLowerCase().replace(/\s+/g, " ") + " ";
    const treffer = [];
    let m;
    FELD_RX.lastIndex = 0;
    while ((m = FELD_RX.exec(t))) treffer.push({ id: FELD_ID(m[1].replace(/\s+/g, " ")), start: m.index, ende: m.index + m[0].length });
    const werte = {}, unklar = new Set();
    treffer.forEach((x, i) => {
      const segment = t.slice(x.ende, i + 1 < treffer.length ? treffer[i + 1].start : t.length).trim();
      if (x.id === "ema") {
        // Paar nur in Ziffern: „EMA fünf und zwanzig“ wäre 5/20 oder 25 – mehrdeutig, daher Ziffern erbitten
        const p = segment.replace(/^(?:von|:|=)\s*/, "").match(/^(?:kurz\s*)?(\d+)\s*(?:und|\/|,|-|bis)?\s*(?:lang\s*)?(\d+)(?!\d)/);
        if (p) { werte.emaKurz = Number(p[1]); werte.emaLang = Number(p[2]); unklar.delete("emaKurz"); unklar.delete("emaLang"); } else { unklar.add("emaKurz"); unklar.add("emaLang"); }
        return;
      }
      const r = wertLesen(segment);
      if (r.unklar) unklar.add(x.id); else { werte[x.id] = r.wert; unklar.delete(x.id); }
    });
    for (const id of Object.keys(werte)) unklar.delete(id);
    const abbrechen = /\b(abbrechen|abbruch|stopp|vergiss es|nein)\b/.test(t);
    return { werte, unklar: [...unklar], abbrechen, erkannt: Object.keys(werte).length > 0 };
  }
  // Prüft gesammelte Werte mit denselben Regeln wie strategieVergleich: { fehlt: [Titel], ungueltig: [Text], ungueltigeIds: [id] }
  function strategieWertePruefen(w = {}) {
    const fehlt = [], ungueltig = [], ids = [];
    const nein = (id, text) => { ungueltig.push(text); ids.push(id); };
    for (const e of STRATEGIE_EINGABEN) if (w[e.id] === undefined) fehlt.push(e.titel);
    if (w.startkapital !== undefined && !(Number.isFinite(w.startkapital) && w.startkapital > 0 && w.startkapital <= 1e9)) nein("startkapital", "Startkapital muss größer als 0 und höchstens 1.000.000.000 USD sein");
    if (w.gebuehrPct !== undefined && !(Number.isFinite(w.gebuehrPct) && w.gebuehrPct >= 0 && w.gebuehrPct < 10)) nein("gebuehrPct", "Gebühr muss zwischen 0 und unter 10 % liegen");
    if (w.slippagePct !== undefined && !(Number.isFinite(w.slippagePct) && w.slippagePct >= 0 && w.slippagePct < 10)) nein("slippagePct", "Slippage muss zwischen 0 und unter 10 % liegen");
    if (w.emaKurz !== undefined && !(Number.isInteger(w.emaKurz) && w.emaKurz >= 2)) nein("emaKurz", "EMA kurz muss eine ganze Zahl ab 2 sein");
    if (w.emaLang !== undefined && !(Number.isInteger(w.emaLang) && w.emaLang > (Number.isInteger(w.emaKurz) ? w.emaKurz : 1))) nein("emaLang", "EMA lang muss eine ganze Zahl größer als EMA kurz sein");
    return { fehlt, ungueltig, ungueltigeIds: ids };
  }
  function zahlText(n) { return Number(n).toLocaleString("de-DE", { maximumFractionDigits: 4 }); }
  // Zusammenfassung vor dem Rechnen (gleicher Text für Anzeige und Vorlesen)
  function strategieZusammenfassung({ symbol, zeitraum, kerzen, quelle, synthetisch, werte }) {
    return `Strategie-Vergleich (historische Simulation) für ${symbol}: ${zeitraum ? `Zeitraum ${zeitraum.von} bis ${zeitraum.bis}` : "kein Zeitraum – alle verfügbaren Tageskerzen"}, ${kerzen} Tageskerzen aus ${quelle}${synthetisch ? " (synthetische Testdaten)" : ""}. `
      + `Eingaben: Startkapital ${zahlText(werte.startkapital)} USD, Gebühr ${zahlText(werte.gebuehrPct)} %, Slippage ${zahlText(werte.slippagePct)} % je Seite, EMA kurz ${werte.emaKurz}, EMA lang ${werte.emaLang}. `
      + `Rechenweise: Gebühr = ${zahlText(werte.gebuehrPct)} % des Handelswerts bei jedem Kauf und jedem Verkauf; Slippage: Kauf zur Eröffnung × (1 + ${zahlText(werte.slippagePct)} %), Verkauf zur Eröffnung × (1 − ${zahlText(werte.slippagePct)} %). `
      + "Verglichen werden „EMA-Kreuzung“ und „Kaufen und halten“ aus dem Strategy Lab. Start: ab der ersten Kerze des Zeitraums ohne Vorlauf; „Kaufen und halten“ kauft zur Eröffnung der zweiten Kerze; "
      + `EMA-Signale entstehen am Schluss einer Kerze (frühestens ab Kerze ${werte.emaLang + 1}) und werden zur nächsten Eröffnung ausgeführt. Ein abweichender Handelsbeginn wird nicht unterstützt. `
      + "Es wird nur gerechnet – keine Order, kein Konto, keine Renditezusage.";
  }

  // Zwei Vergleichsergebnisse (z. B. vorheriger und aktueller Lauf) nur gemeinsam zeigen, wenn Symbol, Zeitraum, Datenquelle,
  // Datenart und Methode übereinstimmen; sonst Gründe für „eingeschränkt“.
  function vergleichKompatibel(a, b) {
    if (!a || !b || a.fehler || b.fehler) return { kompatibel: false, gruende: ["Ein Ergebnis fehlt oder ist fehlerhaft."] };
    const g = [];
    if (a.symbol !== b.symbol) g.push("anderes Symbol");
    if (a.zeitraum.von !== b.zeitraum.von || a.zeitraum.bis !== b.zeitraum.bis || a.zeitraum.kerzen !== b.zeitraum.kerzen) g.push("anderer Zeitraum");
    if (a.quelle !== b.quelle || a.synthetisch !== b.synthetisch) g.push("andere Datengrundlage");
    if (a.methode !== b.methode) g.push("andere Berechnungsmethode");
    return { kompatibel: !g.length, gruende: g };
  }
  // Ergebnis als Text (Anzeige und Vorlesen gleich): Datenbasis, Regeln, Annahmen, Kennzahlen, Einschränkungen
  function vergleichText(r) {
    if (!r || r.fehler) return "Kein Vergleich: " + ((r && r.fehler) || "keine Daten") + " Es wurde nichts berechnet.";
    const d = (t) => new Date(t).toISOString().slice(0, 10);
    return [
      `SIMULATION – Strategie-Vergleich ${r.symbol}.`,
      `Datenbasis: ${r.quelle}${r.synthetisch ? " (synthetische Testdaten, keine historischen Kurse)" : ""}, ${d(r.zeitraum.von)} bis ${d(r.zeitraum.bis)}, ${r.zeitraum.kerzen} Tageskerzen, für alle Strategien identisch.`,
      r.zeitraumVorgabe ? `Zeitraum-Vorgabe: ${r.zeitraumVorgabe.von} bis ${r.zeitraumVorgabe.bis} (deine Eingabe; die Kerzen oben liegen darin).` : "Keine Zeitraum-Vorgabe – gerechnet über alle verfügbaren Tageskerzen der Analyse.",
      `Annahmen (deine Eingaben): Startkapital ${r.annahmen.startkapital} USD, Gebühr ${r.annahmen.gebuehrPct} %, Slippage ${r.annahmen.slippagePct} % je Seite. Methode: ${r.methode}.`,
      ...r.ergebnisse.map((x) => {
        const rg = r.regeln.find((y) => y.name === x.name);
        return `${x.titel}${Object.keys(x.parameter || {}).length ? " (" + Object.entries(x.parameter).map(([k, v]) => k + " " + v).join(", ") + ")" : ""}: Veränderung ${x.veraenderung_prozent} %, größter Rückgang ${x.max_rueckgang_prozent} %, ${x.trades} Trade(s), davon ${x.gewinn_trades} mit Gewinn, Gebühren ${x.gebuehren} USD${x.offene_position ? ", Position am Ende offen" : ""}. Regel: ${rg ? rg.regel : "unbekannt"} Unbekannt: ${rg ? rg.unbekannt.join(", ") : "alles"}.`;
      }),
      "Einschränkungen: " + r.hinweis + " Simulationsergebnisse belegen keine zukünftige Rendite. Nicht direkt vergleichbar mit der Paper-Kern-Simulation im Analyse-Ablauf oder der Timer/Planer-Simulation (andere Regeln und Annahmen).",
    ].join(" ");
  }

  global.AktienAssistent = { intentErkennen, zeitraumErkennen, zeitraumAufloesen, antwortAusProfil, hilfeText, STATUS_TEXT, wlLesen, wlText, wlHinzufuegen, wlEntfernen, wlVerschieben, wlImportPruefen, wlEintragPruefen, WL_ART, WL_MAX, briefingErstellen, GRUPPEN, strategieVergleich, vergleichKompatibel, vergleichText, STRATEGIE_EINGABEN, strategieWerteErkennen, strategieWertePruefen, strategieZusammenfassung, zahlwortLesen, wertLesen, PFLICHTFELDER, REGELN, METHODE };
})(typeof window !== "undefined" ? window : globalThis);
