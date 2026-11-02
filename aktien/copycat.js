// JARVIS Aktien – 13F-Tracker („Copycat“, Stufe 3). Ohne eigenes Netz: wertet die vom Worker unverändert durchgereichten
// SEC-Dateien aus (submissions, Ordner-index.json, Infotabelle, Deckblatt primary_doc.xml, company_tickers.json).
// Erzeugt nur Beobachtung und Zielgewichte als VORSCHLAG – nie eine Order. Gewichte gehen höchstens in die Budget- bzw.
// Rebalancing-Eingabe; von dort führt nur der Weg der Stufe 1 (Risiko-Prüfung → Freigabe genau einer Order).
// Rechenweg nach dem Vorbild von trader-copycat (edgar13f.py) aus github.com/Jakeschincariol/trader-skill
// (MIT, Copyright (c) 2026 Jake Schincariol), in JavaScript übertragen; Filer-Liste und Aktienklassen-Tabelle daraus übernommen
// (Stand der Prüfung im Original: 2026-10-13).
// Ein 13F ist eine Momentaufnahme zum Quartalsende, bis zu 45 Tage später eingereicht; nur US-gelistete Long-Positionen.
(function (global) {
  "use strict";

  const TAG = 86400000;
  const DOLLAR_AB = "2023-01-03"; // ab hier Werte in Dollar, davor in Tausend Dollar
  const FORMEN = ["13F-HR", "13F-HR/A"];

  const FILER = [
    ["0001067983", "Berkshire Hathaway Inc", "Warren Buffett (Chairman Emeritus seit 2026-09-18) und Greg Abel (CEO seit 2026-01-01)", "berkshire,buffett,warren buffett,greg abel"],
    ["0001336528", "Pershing Square Capital Management, L.P.", "Bill Ackman", "pershing,ackman,bill ackman"],
    ["0001649339", "Scion Asset Management, LLC", "Michael Burry – laut Original kein 13F-HR seit 2025-11-03", "scion,burry,michael burry"],
    ["0001350694", "Bridgewater Associates, LP", "gegründet von Ray Dalio", "bridgewater,dalio,ray dalio"],
    ["0001697748", "ARK Investment Management LLC", "Cathie Wood", "ark,ark invest,cathie wood,wood"],
    ["0001536411", "Duquesne Family Office LLC", "Stanley Druckenmiller", "duquesne,druckenmiller,stanley druckenmiller"],
    ["0001656456", "Appaloosa LP", "David Tepper", "appaloosa,tepper,david tepper"],
    ["0001061768", "Baupost Group LLC/MA", "Seth Klarman", "baupost,klarman,seth klarman"],
    ["0001040273", "Third Point LLC", "Dan Loeb", "third point,loeb,dan loeb"],
    ["0001709323", "Himalaya Capital Management LLC", "Li Lu", "himalaya,li lu"],
    ["0000921669", "Icahn Carl C", "Carl Icahn", "icahn,carl icahn"],
    ["0001029160", "Soros Fund Management LLC", "George Soros (Family Office)", "soros,george soros"],
    ["0001037389", "Renaissance Technologies LLC", "gegründet von Jim Simons", "renaissance,rentec,jim simons"],
    ["0001167483", "Tiger Global Management LLC", "Chase Coleman", "tiger global,chase coleman"],
    ["0001135730", "Coatue Management LLC", "Philippe Laffont", "coatue,laffont"],
    ["0001061165", "Lone Pine Capital LLC", "gegründet von Stephen Mandel", "lone pine"],
    ["0001791786", "Elliott Investment Management L.P.", "gegründet von Paul Singer", "elliott,paul singer"],
    ["0001569205", "Fundsmith LLP", "Terry Smith", "fundsmith,terry smith"],
    ["0001096343", "Markel Group Inc.", "Tom Gayner", "markel,gayner,tom gayner"],
    ["0001166559", "Gates Foundation Trust", "Bill & Melinda Gates Foundation Trust", "gates,gates foundation,bill gates"],
    ["0001549575", "Dalal Street, LLC", "Mohnish Pabrai", "pabrai,mohnish pabrai,dalal street"],
    ["0001112520", "Akre Capital Management LLC", "gegründet von Chuck Akre", "akre"],
    ["0000949509", "Oaktree Capital Management LP", "Howard Marks", "oaktree,howard marks"],
  ].map(([cik, name, person, aliase]) => ({ cik, name, person, aliase: aliase.split(",") }));

  // CUSIP → Ticker für Firmen mit mehreren Aktienklassen (Namensabgleich kann sie nicht trennen); im Original gegen OpenFIGI geprüft
  const AKTIENKLASSEN = {
    "02079K305": "GOOGL", "02079K107": "GOOG", "084670108": "BRK.A", "084670702": "BRK.B", "526057104": "LEN", "526057302": "LEN.B",
    "530909100": "LLYVA", "530909308": "LLYVK", "531229755": "FWONK", "35137L105": "FOXA", "35137L204": "FOX", "65249B109": "NWSA",
    "65249B208": "NWS", "904311107": "UAA", "904311206": "UA", "422806109": "HEI", "422806208": "HEI.A", "98954M101": "ZG",
    "98954M200": "Z", "115637100": "BF.A", "115637209": "BF.B",
  };

  const HINWEISE = [
    "Ein 13F ist eine Momentaufnahme zum letzten Tag des Quartals, bis zu 45 Tage später eingereicht. Seitdem kann gekauft oder verkauft worden sein.",
    "Er zeigt nur Long-Positionen in US-gelisteten Aktien: keine Leerverkäufe, kein Bargeld, keine Anleihen, keine ausländischen Aktien, keine Käufe und Verkäufe innerhalb des Quartals, keine Kaufpreise.",
    "Eingereicht wird er von der Firma, nicht von der Person, für die sie bekannt ist.",
    "Keine Anlageberatung. Hier entsteht keine Order – nur Zielgewichte als Vorschlag.",
  ];

  const cik10 = (x) => String(x || "").replace(/\D/g, "").padStart(10, "0").slice(-10);
  const tage = (von, bis) => Math.round((Date.parse(bis + "T00:00:00Z") - Date.parse(von + "T00:00:00Z")) / TAG);
  // Python round(): halbe Werte zur geraden Ziffer (für gleiche Ergebnisse wie das Vorbild)
  function runden(x, stellen) {
    const f = 10 ** stellen;
    const y = Math.round(x * f * 1e6) / 1e6;
    const unten = Math.floor(y);
    return (Math.abs(y - unten - 0.5) < 1e-9 ? (unten % 2 === 0 ? unten : unten + 1) : Math.round(y)) / f;
  }

  // ---------- Meldungen ----------
  function meldungenListe(submissions) {
    const r = (submissions && submissions.filings && submissions.filings.recent) || {};
    const aus = [];
    const gesehen = new Set(); // dieselbe Akzessionsnummer nur einmal (doppelte Einträge meldet meldungenPruefen)
    (r.form || []).forEach((form, i) => {
      if (!FORMEN.includes(form) || gesehen.has(r.accessionNumber[i])) return;
      gesehen.add(r.accessionNumber[i]);
      aus.push({ form, akz: r.accessionNumber[i], eingereicht: r.filingDate[i], quartal: (r.reportDate || [])[i] || "", hauptdokument: (r.primaryDocument || [])[i] || "" });
    });
    return aus.sort((a, b) => (b.eingereicht + b.akz).localeCompare(a.eingereicht + a.akz));
  }

  // Original-13F-HR eines Quartals (Standard: das neueste) und dazu eingereichte Änderungen
  function meldungWaehlen(liste, { quartal = null, vor = null } = {}) {
    let original = liste.filter((m) => m.form === "13F-HR");
    if (quartal) original = original.filter((m) => m.quartal === quartal);
    if (vor) original = original.filter((m) => m.quartal < vor);
    if (!original.length) return { fehler: "Kein 13F-HR gefunden" + (quartal ? " für das Quartal " + quartal : "") + "." };
    original.sort((a, b) => (b.quartal + b.eingereicht).localeCompare(a.quartal + a.eingereicht));
    const gewaehlt = original[0];
    return { meldung: gewaehlt, aenderungen: liste.filter((m) => m.form === "13F-HR/A" && m.quartal === gewaehlt.quartal) };
  }

  function archivPfad(cik, akz) {
    return `https://www.sec.gov/Archives/edgar/data/${Number(cik10(cik))}/${String(akz).replace(/-/g, "")}/`;
  }

  function infotabelleName(index) {
    const namen = ((index && index.directory && index.directory.item) || []).map((x) => x.name);
    const xml = namen.filter((n) => /\.xml$/i.test(n) && !["primary_doc.xml", "filingsummary.xml"].includes(n.toLowerCase()));
    if (!xml.length) return { fehler: "Keine Infotabelle (XML) in dieser Meldung – Meldungen vor Mitte 2013 sind reiner Text und werden nicht unterstützt." };
    return { name: xml.find((n) => /info|table|13f/i.test(n)) || xml[0] };
  }

  const wertFaktor = (eingereicht) => (String(eingereicht || "").slice(0, 10) >= DOLLAR_AB ? 1 : 1000);

  function xmlDokument(text) {
    const doc = new DOMParser().parseFromString(String(text || "").replace(/^﻿/, ""), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Kein gültiges XML.");
    return doc;
  }

  function infotabelleLesen(xmlText, faktor = 1) {
    const doc = xmlDokument(xmlText);
    const zeilen = [];
    for (const el of doc.getElementsByTagName("*")) {
      if (el.localName !== "infoTable") continue;
      const f = {};
      for (const k of el.getElementsByTagName("*")) {
        const t = (k.childElementCount === 0 ? k.textContent : "").trim();
        if (!(k.localName in f) && t) f[k.localName] = t;
      }
      const wert = Number(String(f.value || "0").replace(/,/g, "")) * faktor;
      const stueck = Number(String(f.sshPrnamt || "0").replace(/,/g, ""));
      if (!Number.isFinite(wert) || !Number.isFinite(stueck)) throw new Error("Ungültige Zahl in der Zeile für " + (f.nameOfIssuer || "?"));
      zeilen.push({
        emittent: f.nameOfIssuer || "", klasse: f.titleOfClass || "", cusip: String(f.cusip || "").toUpperCase(), wert, stueck,
        art: String(f.sshPrnamtType || "SH").toUpperCase(), putCall: String(f.putCall || "").toUpperCase(),
      });
    }
    if (!zeilen.length) throw new Error("Keine infoTable-Zeilen – ist das eine 13F-Infotabelle?");
    return zeilen;
  }

  function deckblattLesen(xmlText) {
    let doc;
    try { doc = xmlDokument(xmlText); } catch (e) { return {}; }
    const aus = {};
    for (const el of doc.getElementsByTagName("*")) {
      const t = el.childElementCount === 0 ? el.textContent.trim() : "";
      if (["tableValueTotal", "tableEntryTotal", "periodOfReport", "isAmendment", "reportType", "amendmentNo", "amendmentType"].includes(el.localName) && !(el.localName in aus) && t) aus[el.localName] = t;
    }
    return aus;
  }

  // ---------- Änderungsmeldungen 13F-HR/A (ab 2026-11-01c) ----------
  // Art der Änderung aus dem Deckblatt: isAmendment und amendmentInfo/amendmentType. Die Feldnamen und die beiden Arten folgen der
  // technischen Spezifikation der SEC für Form 13F:
  //   RESTATEMENT  – Neufassung: ersetzt die Angaben der früheren Meldung für dieses Quartal vollständig
  //   NEW HOLDINGS – Ergänzung: fügt Positionen hinzu (z. B. nach Ablauf einer vertraulichen Behandlung)
  // NICHT aus dem Trader-Skill übernommen (Skill-Quelle liegt nicht vor) und nicht gegen ein echtes Korrektur-Deckblatt geprüft: In den
  // Prüfdaten gibt es nur Original-Deckblätter (isAmendment=false). Fehlt die Art oder ist sie unbekannt, wird NICHTS eingerechnet.
  function korrekturArt(deck) {
    if (!deck || !deck.isAmendment) return { art: "unbekannt", grund: "Deckblatt nicht lesbar – Art der Änderung unbekannt." };
    if (String(deck.isAmendment).toLowerCase() !== "true") return { art: "keine", grund: "Deckblatt meldet keine Änderung (isAmendment=false)." };
    const typ = String(deck.amendmentType || "").trim().toUpperCase();
    const nr = /^\d{1,3}$/.test(String(deck.amendmentNo || "").trim()) ? Number(deck.amendmentNo) : null;
    if (typ === "RESTATEMENT") return { art: "neufassung", nr, grund: "Neufassung (RESTATEMENT): ersetzt die Angaben des Quartals." };
    if (typ === "NEW HOLDINGS") return { art: "ergaenzung", nr, grund: "Ergänzung (NEW HOLDINGS): fügt Positionen hinzu." };
    return { art: "unbekannt", nr, grund: typ ? `Unbekannte Änderungsart „${typ.slice(0, 30)}“ – nicht eingerechnet.` : "Änderungsart im Deckblatt fehlt – nicht eingerechnet." };
  }

  // Änderungen auf die Zeilen des Originals anwenden. korrekturen: [{ akz, eingereicht, art: korrekturArt(...), zeilen }].
  // Reihenfolge: Änderungsnummer, sonst Einreichungsdatum. Doppelt gelistete Akzessionsnummern zählen einmal. Unbekannte Art → übersprungen.
  function korrekturAnwenden(originalZeilen, korrekturen) {
    const gesehen = new Set();
    const angewendet = [], nicht = [];
    let zeilen = originalZeilen.slice();
    const sortiert = (korrekturen || []).slice().sort((a, b) => ((a.art && a.art.nr) ?? 1e9) - ((b.art && b.art.nr) ?? 1e9) || String(a.eingereicht).localeCompare(String(b.eingereicht)));
    for (const k of sortiert) {
      if (gesehen.has(k.akz)) { nicht.push({ akz: k.akz, grund: "doppelt gelistet – nur einmal berücksichtigt" }); continue; }
      gesehen.add(k.akz);
      const art = k.art || { art: "unbekannt" };
      if (!Array.isArray(k.zeilen) || !k.zeilen.length) { nicht.push({ akz: k.akz, grund: "Infotabelle der Änderung fehlt oder ist leer – nicht eingerechnet" }); continue; }
      if (art.art === "neufassung") { zeilen = k.zeilen.slice(); angewendet.push({ akz: k.akz, art: "Neufassung", eingereicht: k.eingereicht }); }
      else if (art.art === "ergaenzung") { zeilen = zeilen.concat(k.zeilen); angewendet.push({ akz: k.akz, art: "Ergänzung", eingereicht: k.eingereicht }); }
      else nicht.push({ akz: k.akz, grund: art.grund || "Art der Änderung unbekannt – nicht eingerechnet" });
    }
    return { zeilen, angewendet, nicht_angewendet: nicht };
  }

  // Alle Änderungsmeldungen der Liste mit Quartal, Einreichung, Verzögerung zum Stichtag und ob ein Original vorliegt
  function korrekturenListe(liste) {
    const original = new Set(liste.filter((m) => m.form === "13F-HR").map((m) => m.quartal));
    return liste.filter((m) => m.form === "13F-HR/A").map((m) => ({
      ...m, verzoegerung_tage: m.quartal ? Math.round((Date.parse(m.eingereicht) - Date.parse(m.quartal)) / TAG) : null,
      original_vorhanden: original.has(m.quartal),
      hinweis: "Änderungsmeldung – Art (Neufassung oder Ergänzung) steht nur im Deckblatt; ohne Deckblatt wird nichts eingerechnet.",
    }));
  }

  // Doppelt gelistete Meldungen (gleiche Akzessionsnummer) erkennen – die Liste selbst (meldungenListe) enthält jede nur einmal
  function meldungenPruefen(submissions) {
    const r = (submissions && submissions.filings && submissions.filings.recent) || {};
    const zaehler = new Map();
    (r.accessionNumber || []).forEach((a, i) => { if ([...FORMEN, ...FORM4].includes((r.form || [])[i])) zaehler.set(a, (zaehler.get(a) || 0) + 1); });
    return { doppelte: [...zaehler].filter(([, n]) => n > 1).map(([a, n]) => ({ akz: a, anzahl: n })) };
  }

  // ---------- Form 4 (Insider-Meldungen nach Section 16) – nur die Liste aus „submissions“ ----------
  // Aus der Liste: Formular, Akzessionsnummer, Einreichung, Transaktionsdatum (reportDate). Frist laut SEC: 2 Geschäftstage nach der
  // Transaktion; gezählt werden hier nur Wochentage (US-Feiertage NICHT berücksichtigt → „möglicherweise verspätet“).
  // Inhalt (wer, Kauf/Verkauf, Stückzahl, Preis) steht nur im Form-4-XML – davon gibt es keine Prüfdaten: NICHT ausgewertet.
  // Ob die CIK die Meldung als Emittent oder als meldende Person führt, geht aus der Liste nicht hervor.
  const FORM4 = ["4", "4/A"];
  function geschaeftstage(von, bis) {
    const a = Date.parse(von + "T00:00:00Z"), b = Date.parse(bis + "T00:00:00Z");
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
    let n = 0;
    for (let t = a + TAG; t <= b; t += TAG) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
    return n;
  }
  function form4Liste(submissions, { cik = null, heute = Date.now(), tage = 90 } = {}) {
    const r = (submissions && submissions.filings && submissions.filings.recent) || {};
    const gesehen = new Set();
    const aus = [];
    (r.form || []).forEach((form, i) => {
      if (!FORM4.includes(form)) return;
      const akz = r.accessionNumber[i];
      if (gesehen.has(akz)) return;
      gesehen.add(akz);
      const eingereicht = r.filingDate[i], transaktion = (r.reportDate || [])[i] || null;
      if (heute - Date.parse(eingereicht + "T00:00:00Z") > tage * TAG) return;
      const gt = transaktion ? geschaeftstage(transaktion, eingereicht) : null;
      aus.push({
        form, akz, eingereicht, transaktion, geschaeftstage: gt,
        moeglicherweise_verspaetet: gt !== null && gt > 2,
        alter_tage: Math.floor((heute - Date.parse(eingereicht + "T00:00:00Z")) / TAG),
        link: cik ? archivPfad(cik, akz) : null,
        unsicher: ["Rolle (Emittent oder meldende Person) aus der Liste nicht bestimmbar", "Inhalt (Kauf/Verkauf, Stückzahl, Preis) nicht ausgewertet"],
      });
    });
    return aus.sort((a, b) => (b.eingereicht + b.akz).localeCompare(a.eingereicht + a.akz));
  }

  // OpenFIGI-Zuordnung CUSIP → Ticker: bewusst NICHT eingebaut (siehe docs/TRADER_SKILL_ABGLEICH.md §8)
  const OPENFIGI = {
    verfuegbar: false,
    grund: "OpenFIGI-Zuordnung nicht verfügbar: keine aufgezeichnete echte OpenFIGI-Antwort als Prüfbasis, Regeln des Originals nicht lokal "
      + "vorhanden, Nutzungsbedingungen und Datenschutz (CUSIPs gehen an einen externen Dienst) vom Nutzer nicht entschieden. "
      + "Stattdessen: Aktienklassen-Tabelle, Namensabgleich und eigene CUSIP-Zuordnungen; unsichere Ticker werden nicht kopiert.",
  };

  const istAktie = (p) => p.art === "SH" && !p.putCall;

  function zusammenfassen(zeilen) {
    const summe = zeilen.reduce((s, z) => s + z.wert, 0);
    const gruppen = new Map();
    for (const z of zeilen) {
      const k = z.cusip + "|" + z.putCall + "|" + z.art;
      if (!gruppen.has(k)) gruppen.set(k, { emittent: z.emittent, klasse: z.klasse, cusip: z.cusip, putCall: z.putCall, art: z.art, wert: 0, stueck: 0, zeilen: 0 });
      const g = gruppen.get(k);
      g.wert += z.wert; g.stueck += z.stueck; g.zeilen += 1;
    }
    const positionen = [...gruppen.values()].map((p) => ({ ...p, anteil: summe ? runden((100 * p.wert) / summe, 2) : 0, cusips: [p.cusip] }));
    positionen.sort((a, b) => b.wert - a.wert || a.cusip.localeCompare(b.cusip));
    return { positionen, summe };
  }

  // Aktienklassen eines Emittenten (gleiche ersten 6 CUSIP-Zeichen) addieren; nur Aktienzeilen
  function klassenZusammenfassen(positionen, summe) {
    const aus = [], jeEmittent = new Map();
    for (const p of positionen) {
      if (!istAktie(p)) { aus.push({ ...p }); continue; }
      const k = p.cusip.slice(0, 6);
      if (!jeEmittent.has(k)) {
        const q = { ...p, cusips: [p.cusip], ticker_liste: p.ticker ? [p.ticker] : [], klassen: [p.klasse] };
        jeEmittent.set(k, q); aus.push(q); continue;
      }
      const q = jeEmittent.get(k);
      q.wert += p.wert; q.stueck += p.stueck; q.zeilen += p.zeilen;
      q.cusips.push(p.cusip); q.klassen.push(p.klasse);
      if (p.ticker) q.ticker_liste.push(p.ticker);
    }
    for (const q of aus) q.anteil = summe ? runden((100 * q.wert) / summe, 2) : 0;
    return aus.sort((a, b) => b.wert - a.wert || a.cusip.localeCompare(b.cusip));
  }

  // ---------- Ticker ----------
  const ZUSATZ_STAAT = /\s*\/\s*[A-Z]{2,5}\s*\/?\s*$/;
  const ABKUERZUNG = {
    AMER: "AMERICA", AMERN: "AMERICAN", FINL: "FINANCIAL", FIN: "FINANCIAL", PETE: "PETROLEUM", HLDGS: "HOLDINGS", HLDG: "HOLDING", HOLDG: "HOLDING",
    INTL: "INTERNATIONAL", GRP: "GROUP", SVCS: "SERVICES", SVC: "SERVICE", SYS: "SYSTEMS", MGMT: "MANAGEMENT", INDS: "INDUSTRIES", NATL: "NATIONAL",
    ENTMT: "ENTERTAINMENT", PAC: "PACIFIC", LABS: "LABORATORIES", PPTYS: "PROPERTIES", RLTY: "REALTY", TECHS: "TECHNOLOGIES", TECH: "TECHNOLOGY",
    COMMNS: "COMMUNICATIONS", COMMUNICATN: "COMMUNICATIONS", MFG: "MANUFACTURING", ELEC: "ELECTRIC", PHARMACEUTICALS: "PHARMACEUTICALS",
    PHARMS: "PHARMACEUTICALS", BANCORPORATION: "BANCORP", RES: "RESOURCES", SOLUTIONS: "SOLUTIONS", WTR: "WATER", MTRS: "MOTORS", AIRLS: "AIRLINES", CHEM: "CHEMICAL",
  };
  const WEGLASSEN = new Set(["INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "PLC", "LLC", "LP", "SA", "NV", "AG", "SE", "THE", "AND", "OF"]);
  const NICHT_STAMM = /-P[A-Z]*$|-WT[A-Z]*$|-WS$|-U$|-UN$|-R$|-RT$/;

  function nameWoerter(name) {
    let s = String(name || "").toUpperCase().replace(/&/g, " AND ");
    for (let i = 0; i < 2; i++) s = s.replace(ZUSATZ_STAAT, "");
    s = s.replace(/['’]/g, "").replace(/[^A-Z0-9 ]+/g, " ");
    return s.split(/\s+/).filter(Boolean).map((w) => ABKUERZUNG[w] || w).filter((w) => !WEGLASSEN.has(w));
  }
  function nameSchluessel(name) {
    const w = nameWoerter(name);
    return [w.join(""), [...w].sort().join(" ")];
  }
  function tickerNorm(t) {
    t = String(t || "").trim().toUpperCase();
    return NICHT_STAMM.test(t) ? t : t.replace(/[-/ ]([A-Z]{1,2})$/, ".$1");
  }
  function klassenBuchstabe(titel) {
    const m = /\b(?:CL|CLASS|SER|SERIES)\s*([A-Z])\b/.exec(String(titel || "").toUpperCase());
    return m ? m[1] : null;
  }

  function tickerIndex(companyTickers) {
    const proCik = new Map(), titel = new Map(), ohneLeer = new Map(), sortiert = new Map();
    for (const v of Object.values(companyTickers || {})) {
      const cik = cik10(v.cik_str);
      if (!proCik.has(cik)) proCik.set(cik, []);
      proCik.get(cik).push(v.ticker);
      if (titel.has(cik)) continue;
      titel.set(cik, v.title);
      const [a, b] = nameSchluessel(v.title);
      if (a) {
        if (!ohneLeer.has(a)) ohneLeer.set(a, new Set());
        ohneLeer.get(a).add(cik);
        if (!sortiert.has(b)) sortiert.set(b, new Set());
        sortiert.get(b).add(cik);
      }
    }
    function cikFuer(emittent) {
      const [a, b] = nameSchluessel(emittent);
      if (!a) return [null, null];
      for (const treffer of [ohneLeer.get(a), sortiert.get(b)]) if (treffer && treffer.size === 1) return [[...treffer][0], "name"];
      // 13F kürzt oder verziert Namen („JEFFERIES FINANCIAL GROUP IN“)
      const beste = [];
      for (const [k, ciks] of ohneLeer) if (k.length >= 8 && ciks.size === 1 && (a.startsWith(k) || k.startsWith(a))) beste.push([k.length, [...ciks][0]]);
      if (beste.length) {
        beste.sort((x, y) => y[0] - x[0] || y[1].localeCompare(x[1]));
        if (beste.length === 1 || beste[0][0] > beste[1][0]) return [beste[0][1], "name-praefix"];
      }
      return [null, null];
    }
    function tickerFuer(cik, klasse) {
      const alle = proCik.get(cik) || [];
      let kand = alle.filter((t) => !NICHT_STAMM.test(t));
      if (!kand.length) kand = alle;
      if (!kand.length) return [null, true];
      if (kand.length === 1) return [tickerNorm(kand[0]), false];
      if (kand.slice(1).every((t) => t.startsWith(kand[0]))) return [tickerNorm(kand[0]), false];
      const b = klassenBuchstabe(klasse);
      if (b) {
        for (const t of kand) if (["-", ".", "/"].some((x) => t.toUpperCase().endsWith(x + b))) return [tickerNorm(t), false];
        for (const t of kand) if (t.length >= 4 && t.toUpperCase().endsWith(b)) return [tickerNorm(t), true];
      }
      return [tickerNorm(kand[0]), true];
    }
    return { cikFuer, tickerFuer, titel };
  }

  function schoenerName(emittent, secTitel) {
    let n = secTitel && /[a-z]/.test(secTitel) ? secTitel : (secTitel || emittent);
    n = String(n || "").replace(ZUSATZ_STAAT, "");
    n = n.trim().replace(/,?\s+(Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Company|Ltd\.?|Limited|plc|PLC|LLC|L\.P\.|N\.V\.|S\.A\.)$/i, "");
    n = n.trim().replace(/,?\s+(INC|CORP|CO|LTD|PLC)$/, "");
    if (/[A-Z]/.test(n) && !/[a-z]/.test(n)) {
      const klein = new Set(["OF", "AND", "THE", "FOR", "IN"]);
      n = n.toLowerCase().split(/\s+/).map((w, i) => (klein.has(w.toUpperCase()) && i ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
    }
    return n.trim();
  }

  // ---------- Eigene CUSIP-Zuordnungen (vom Nutzer, nur auf diesem Gerät) ----------
  // CUSIP: 9 Zeichen, 8 Ziffern/Großbuchstaben + Prüfziffer (Verfahren der CUSIP Global Services: Werte A=10 … Z=35, * = 36,
  // @ = 37, # = 38; jede zweite Stelle verdoppeln, Quersummen addieren, Prüfziffer = (10 − Summe mod 10) mod 10).
  function cusipPruefziffer(acht) {
    let summe = 0;
    for (let i = 0; i < 8; i++) {
      const z = acht[i];
      let v = /[0-9]/.test(z) ? Number(z) : /[A-Z]/.test(z) ? z.charCodeAt(0) - 55 : { "*": 36, "@": 37, "#": 38 }[z];
      if (v === undefined) return null;
      if (i % 2 === 1) v *= 2;
      summe += Math.floor(v / 10) + (v % 10);
    }
    return (10 - (summe % 10)) % 10;
  }
  const cusipGueltig = (c) => /^[0-9A-Z*@#]{8}[0-9]$/.test(c) && cusipPruefziffer(c.slice(0, 8)) === Number(c[8]);
  const TICKER = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;

  // „CUSIP=TICKER“ je Zeile (auch „:“ oder Leerzeichen) → { zuordnungen, fehler[] }; nichts Ungültiges wird übernommen
  function zuordnungenLesen(text) {
    const zuordnungen = {};
    const fehler = [];
    String(text || "").split(/\r?\n/).map((z) => z.trim()).filter(Boolean).forEach((zeile, i) => {
      const m = /^([^\s=:]+)\s*[=: ]\s*(\S+)$/.exec(zeile);
      if (!m) { fehler.push(`Zeile ${i + 1}: nicht lesbar (Form: CUSIP=TICKER)`); return; }
      const cusip = m[1].toUpperCase(), ticker = tickerNorm(m[2]);
      if (!cusipGueltig(cusip)) { fehler.push(`Zeile ${i + 1}: „${cusip.slice(0, 20)}“ ist keine gültige CUSIP (9 Zeichen mit Prüfziffer)`); return; }
      if (!TICKER.test(ticker)) { fehler.push(`Zeile ${i + 1}: „${ticker.slice(0, 20)}“ ist kein US-Aktien-Ticker`); return; }
      if (cusip in zuordnungen) { fehler.push(`Zeile ${i + 1}: ${cusip} doppelt`); return; }
      zuordnungen[cusip] = ticker;
    });
    return { zuordnungen, fehler };
  }

  // Jede Position bekommt Ticker, Herkunft und „prüfen“: eigene (manuelle) Zuordnung → Aktienklassen-Tabelle → Name in company_tickers
  function tickerZuordnen(positionen, index, eigene = {}) {
    const manuell = Object.fromEntries(Object.entries(eigene || {}).map(([k, v]) => [String(k).toUpperCase(), tickerNorm(v)]).filter(([k, v]) => cusipGueltig(k) && TICKER.test(v)));
    for (const p of positionen) {
      let cik = null, wie = null, secTitel = null;
      if (index) { [cik, wie] = index.cikFuer(p.emittent); if (cik) secTitel = index.titel.get(cik); }
      if (manuell[p.cusip]) Object.assign(p, { ticker: manuell[p.cusip], ticker_quelle: "manuell", ticker_manuell: true, ticker_pruefen: false });
      else if (AKTIENKLASSEN[p.cusip]) Object.assign(p, { ticker: AKTIENKLASSEN[p.cusip], ticker_quelle: "Aktienklassen-Tabelle", ticker_pruefen: false });
      else if (cik) { const [t, pruefen] = index.tickerFuer(cik, p.klasse); Object.assign(p, { ticker: t, ticker_quelle: wie, ticker_pruefen: Boolean(pruefen || wie === "name-praefix") }); }
      else Object.assign(p, { ticker: null, ticker_quelle: "keine", ticker_pruefen: true });
      p.name = schoenerName(p.emittent, secTitel);
    }
    return positionen;
  }

  // ---------- Auswertung ----------
  function quartalAufbauen(meta, zeilen, index, { eigene = {}, zusammen = true } = {}) {
    const { positionen, summe } = zusammenfassen(zeilen);
    tickerZuordnen(positionen, index, eigene);
    if (meta.deckblatt_summe) {
      const abstand = Math.abs(meta.deckblatt_summe - summe);
      meta.summen_pruefung = abstand < 1000 ? "Stimmt mit der Summe auf dem Deckblatt überein." : `Deckblatt nennt ${meta.deckblatt_summe.toLocaleString("de-DE")} USD, die Zeilen ergeben ${summe.toLocaleString("de-DE")} USD.`;
    }
    return { positionen: zusammen ? klassenZusammenfassen(positionen, summe) : positionen, einzeln: positionen, summe };
  }

  // Vergleich zweier Quartale nach CUSIP: NEU, VERKAUFT, AUFGESTOCKT, REDUZIERT, UNVERÄNDERT (Stückzahlen zu zwei Stichtagen, keine Trades)
  function vergleich(aktuell, vorher) {
    const davor = new Map(vorher.map((p) => [p.cusip + "|" + p.putCall, p]));
    const jetzt = new Map(aktuell.map((p) => [p.cusip + "|" + p.putCall, p]));
    const aus = [];
    for (const [k, p] of jetzt) {
      const q = davor.get(k);
      const [status, aenderung] = !q ? ["NEU", p.stueck] : p.stueck > q.stueck ? ["AUFGESTOCKT", p.stueck - q.stueck] : p.stueck < q.stueck ? ["REDUZIERT", p.stueck - q.stueck] : ["UNVERÄNDERT", 0];
      aus.push({ status, emittent: p.emittent, cusip: p.cusip, ticker: p.ticker || null, putCall: p.putCall, stueck_vorher: q ? q.stueck : 0, stueck_nachher: p.stueck, aenderung,
        aenderung_pct: q && q.stueck ? runden((100 * aenderung) / q.stueck, 1) : null, wert_nachher: p.wert, wert_vorher: q ? q.wert : 0 });
    }
    for (const [k, q] of davor) {
      if (jetzt.has(k)) continue;
      aus.push({ status: "VERKAUFT", emittent: q.emittent, cusip: q.cusip, ticker: q.ticker || null, putCall: q.putCall, stueck_vorher: q.stueck, stueck_nachher: 0, aenderung: -q.stueck, aenderung_pct: -100, wert_nachher: 0, wert_vorher: q.wert });
    }
    const rang = { NEU: 0, VERKAUFT: 1, AUFGESTOCKT: 2, REDUZIERT: 3, "UNVERÄNDERT": 4 };
    return aus.sort((a, b) => rang[a.status] - rang[b.status] || Math.max(b.wert_nachher, b.wert_vorher) - Math.max(a.wert_nachher, a.wert_vorher));
  }

  // Zielgewichte zum Nachbilden (Vorschlag): Aktienpositionen, Anteil am 13F auf 100 % skaliert; unsichere Ticker werden ausgelassen
  function kopierGewichte(positionen, { top = null, minProzent = 0, ausschliessen = [], unsichereAuslassen = true } = {}) {
    const raus = new Set(ausschliessen.map((x) => String(x).toUpperCase()));
    let gewaehlt = [];
    const ausgelassen = [];
    for (const p of positionen) {
      let grund = null;
      if (!istAktie(p)) grund = `${p.putCall || p.art}-Zeile, keine kopierbare Aktie`;
      else if (!p.ticker) grund = "kein Ticker gefunden";
      else if (unsichereAuslassen && p.ticker_pruefen) grund = "Ticker nur geschätzt (Namensabgleich) – erst prüfen";
      else if (raus.has(p.ticker.toUpperCase())) grund = "von dir ausgeschlossen";
      else if (p.anteil < minProzent) grund = `unter ${minProzent} % des 13F`;
      if (grund) { ausgelassen.push({ emittent: p.emittent, ticker: p.ticker || null, grund }); continue; }
      gewaehlt.push(p);
    }
    if (top) {
      for (const p of gewaehlt.slice(top)) ausgelassen.push({ emittent: p.emittent, ticker: p.ticker, grund: `außerhalb der Top ${top}` });
      gewaehlt = gewaehlt.slice(0, top);
    }
    const basis = gewaehlt.reduce((s, p) => s + p.anteil, 0);
    if (!gewaehlt.length || basis <= 0) return { fehler: "Nichts zum Nachbilden übrig.", ausgelassen };
    return {
      gewichte: gewaehlt.map((p) => ({ ticker: p.ticker, name: p.name || p.emittent, gewicht: runden((100 * p.anteil) / basis, 2), anteil_13f: p.anteil, wert: p.wert, stueck: p.stueck,
        ...(p.ticker_manuell ? { manuell: true } : {}),
        ...(p.ticker_liste && p.ticker_liste.length > 1 ? { klassen: p.ticker_liste } : {}) })),
      ausgelassen,
    };
  }

  // Berichtsquartal aus dem Stichtag (13F: Kalenderquartal, Stichtag = letzter Tag des Quartals)
  function quartalsName(stichtag) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(stichtag || ""));
    return m ? `Q${Math.ceil(Number(m[2]) / 3)} ${m[1]}` : "unbekannt";
  }

  // Aktualität: Berichtsquartal, Stichtag und Einreichung getrennt; Verzögerung und Alter – nie als Echtzeit darstellen
  function aktualitaet(meta, heute) {
    const h = heute || new Date().toISOString().slice(0, 10);
    const verzoegerung = tage(meta.quartal, meta.eingereicht);
    const alter = tage(meta.quartal, h);
    return {
      berichtsquartal: quartalsName(meta.quartal), stichtag: meta.quartal, eingereicht: meta.eingereicht,
      verzoegerung_tage: verzoegerung, alter_tage: alter, seit_einreichung_tage: tage(meta.eingereicht, h),
      verspaetet: verzoegerung > 45,
      text: `Bestände per ${meta.quartal}, eingereicht ${meta.eingereicht} (${verzoegerung} Tage nach Quartalsende${verzoegerung > 45 ? ", später als die 45-Tage-Frist" : ""}); heute ${alter} Tage alt.`,
      echtzeit_hinweis: `Keine Echtzeitdaten: Stand ${meta.quartal} (Ende ${quartalsName(meta.quartal)}), veröffentlicht ${meta.eingereicht}. Was seitdem gekauft oder verkauft wurde, zeigt ein 13F nicht.`,
    };
  }

  // Vergleich nach Art gegliedert: neue Position, aufgestockt, reduziert, vollständig verkauft (unverändert nur gezählt)
  function vergleichGliedern(unterschiede) {
    const art = { NEU: "Neue Position", AUFGESTOCKT: "Aufgestockt", REDUZIERT: "Reduziert", VERKAUFT: "Vollständig verkauft" };
    const gruppen = Object.keys(art).map((s) => ({ status: s, titel: art[s], eintraege: (unterschiede || []).filter((u) => u.status === s) }));
    return { gruppen, unveraendert: (unterschiede || []).filter((u) => u.status === "UNVERÄNDERT").length };
  }

  // Filer-Suche ohne Netz: eingebaute Liste (Name, Person, Aliasse) und – nur wenn übergeben – SEC company_tickers.json.
  // Die SEC-Tickerliste enthält nur Firmen mit Börsenticker; viele Fonds fehlen dort (dann CIK direkt eingeben).
  function filerSuchen(text, tickerListe = null) {
    const woerter = String(text || "").toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
    if (!woerter.length) return { treffer: [], fehler: "Bitte mindestens 2 Zeichen eingeben." };
    const passt = (heu) => woerter.every((w) => heu.includes(w));
    const treffer = FILER.filter((f) => passt([f.name, f.person, ...f.aliase].join(" ").toLowerCase())).map((f) => ({ cik: f.cik, name: f.name, person: f.person, quelle: "eingebaute Liste" }));
    if (tickerListe) {
      for (const v of Object.values(tickerListe)) {
        if (treffer.length >= 20) break;
        const cik = cik10(v && v.cik_str);
        if (!v || treffer.some((t) => t.cik === cik)) continue;
        if (passt(`${v.title} ${v.ticker}`.toLowerCase())) treffer.push({ cik, name: String(v.title).slice(0, 120), ticker: v.ticker, quelle: "SEC-Tickerliste" });
      }
    }
    return { treffer: treffer.slice(0, 20) };
  }

  global.AktienCopycat = {
    FILER, AKTIENKLASSEN, HINWEISE, cik10, meldungenListe, meldungWaehlen, archivPfad, infotabelleName, wertFaktor, infotabelleLesen, deckblattLesen,
    zusammenfassen, klassenZusammenfassen, nameSchluessel, tickerNorm, klassenBuchstabe, tickerIndex, tickerZuordnen, schoenerName,
    quartalAufbauen, vergleich, kopierGewichte, aktualitaet, istAktie,
    cusipPruefziffer, cusipGueltig, zuordnungenLesen, quartalsName, vergleichGliedern, filerSuchen,
    korrekturArt, korrekturAnwenden, korrekturenListe, meldungenPruefen, geschaeftstage, form4Liste, OPENFIGI,
  };
})(typeof window !== "undefined" ? window : globalThis);
