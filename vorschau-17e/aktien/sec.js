// JARVIS Aktien – Quartalszahlen aus SEC EDGAR (Stufe 2). Reine Rechnung ohne Netzwerk: wertet die vom Worker
// unverändert durchgereichten Dateien aus (companyfacts, submissions, company_tickers). Keine Order, keine Bewertung
// „billig/teuer/kaufen“ – nur, was das Unternehmen gemeldet hat.
// Rechenweg nach dem Vorbild von trader-analyst (facts.py) aus github.com/Jakeschincariol/trader-skill
// (MIT, Copyright (c) 2026 Jake Schincariol), in JavaScript übertragen:
//   - Werte aus 10-Q/10-K/20-F/40-F (Dauerwerte); spätere Meldung gewinnt (Korrekturen), Bezeichnung (fy/fp) aus der ersten
//   - Quartal = Zeitraum 80–100 Tage; Q4 = Jahreswert (350–380 Tage) minus die drei Quartale darin → „abgeleitet“
//   - Vorjahresvergleich mit dem Quartal ±10 Tage ein Jahr früher; letzte 4 Quartale nur, wenn sie zusammen < 300 Tage umspannen
//   - Hinweis, wenn die XBRL-Daten einer schon eingereichten 10-Q/10-K hinterherlaufen
// Nächster Zahlentermin: Die SEC kennt keine künftigen Termine – JARVIS schätzt ihn aus der letzten 8-K mit Punkt 2.02 (+91 Tage)
// und kennzeichnet ihn immer als Schätzung.
(function (global) {
  "use strict";

  const KONZEPTE = {
    umsatz: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenuesNetOfInterestExpense",
      "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "SalesRevenueServicesNet"],
    umsatzkosten: ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold"],
    bruttogewinn: ["GrossProfit"],
    betriebsergebnis: ["OperatingIncomeLoss"],
    nettogewinn: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
    eps: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"],
  };
  const BERICHTE = ["10-Q", "10-K", "20-F", "40-F"];
  const TAG = 86400000;
  const datum = (s) => Date.parse(s + "T00:00:00Z");
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

  function fakten(companyfacts, konzept, einheit) {
    const knoten = companyfacts && companyfacts.facts && companyfacts.facts["us-gaap"] && companyfacts.facts["us-gaap"][konzept];
    if (!knoten || !knoten.units) return [];
    const e = einheit in knoten.units ? einheit : Object.keys(knoten.units)[0];
    return e ? knoten.units[e] || [] : [];
  }

  function zeitraeume(liste) {
    const neueste = new Map(), erste = new Map();
    for (const f of liste) {
      if (!f.start || !BERICHTE.includes(String(f.form || "").split("/")[0])) continue;
      const k = f.start + "|" + f.end;
      const stempel = (f.filed || "") + "|" + (f.accn || "");
      const n = neueste.get(k), e = erste.get(k);
      if (!n || stempel > (n.filed || "") + "|" + (n.accn || "")) neueste.set(k, f);
      if (!e || stempel < (e.filed || "") + "|" + (e.accn || "")) erste.set(k, f);
    }
    return [...neueste.entries()].map(([k, f]) => ({ ...f, fy: erste.get(k).fy, fp: erste.get(k).fp }));
  }

  function quartale(liste, q4Ableiten = true) {
    const q = {};
    const jahre = [];
    for (const f of zeitraeume(liste)) {
      const tage = (datum(f.end) - datum(f.start)) / TAG;
      if (tage >= 80 && tage <= 100) q[f.end] = { wert: f.val, start: f.start, ende: f.end, abgeleitet: false, fy: f.fy, fp: f.fp, form: f.form, eingereicht: f.filed };
      else if (tage >= 350 && tage <= 380) jahre.push(f);
    }
    if (q4Ableiten) {
      for (const f of jahre) {
        if (q[f.end]) continue;
        // ab 16j (ANA-S04, wie facts.py:183): auch schon abgeleitete Quartale zählen mit (vorher ausgeschlossen – Abweichung bei Geschäftsjahreswechseln)
        const darin = Object.values(q).filter((v) => v.start >= f.start && v.ende < f.end).sort((a, b) => a.ende.localeCompare(b.ende));
        if (darin.length !== 3) continue;
        q[f.end] = {
          wert: f.val - darin.reduce((s, v) => s + v.wert, 0), start: iso(datum(darin[2].ende) + TAG), ende: f.end,
          abgeleitet: true, fy: f.fy, fp: "Q4", form: f.form, eingereicht: f.filed,
        };
      }
    }
    return q;
  }

  function reihe(companyfacts, schluessel) {
    const einheit = schluessel === "eps" ? "USD/shares" : "USD";
    const zusammen = {};
    const genutzt = [];
    for (const konzept of KONZEPTE[schluessel]) {
      const q = quartale(fakten(companyfacts, konzept, einheit));
      let neu = false;
      for (const [ende, v] of Object.entries(q)) if (!zusammen[ende]) { zusammen[ende] = { ...v, konzept }; neu = true; }
      if (neu) genutzt.push(konzept);
    }
    return { werte: zusammen, genutzt };
  }

  function vorjahr(werte, ende) {
    const ziel = datum(ende) - 365 * TAG;
    let bester = null;
    for (const e of Object.keys(werte)) {
      const abstand = Math.abs((datum(e) - ziel) / TAG);
      if (abstand <= 10 && (!bester || abstand < bester[0])) bester = [abstand, e];
    }
    return bester ? werte[bester[1]] : null;
  }

  // Python round(x, stellen) wie im Original (5189e79): korrekt gerundeter Dezimalwert des exakten Binärwerts, nur echte Gleichstände
  // (exakt …5) zur geraden Ziffer. ab AJ4: vorher wurde erst auf 1e-6 geglättet – 9,9499… (Binärwert von 9,95) ergab 10,0 statt 9,9,
  // 35,0500…04 ergab 35,0 statt 35,1 (Screener-Schwellen). toFixed rechnet mit dem exakten Wert; nur den echten Gleichstand selbst entscheiden.
  function runden(x, stellen) {
    if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return x;
    const genau = Math.abs(x).toFixed(100), punkt = genau.indexOf(".");
    if (!/^50*$/.test(genau.slice(punkt + 1 + stellen))) return Number(x.toFixed(stellen));
    let z = BigInt(genau.slice(0, punkt) + genau.slice(punkt + 1, punkt + 1 + stellen));
    if (z % 2n === 1n) z += 1n;
    const t = z.toString().padStart(stellen + 1, "0");
    return (x < 0 ? -1 : 1) * Number(stellen ? t.slice(0, t.length - stellen) + "." + t.slice(-stellen) : t);
  }
  const prozent = (a, b) => (a === null || a === undefined || !b ? null : runden((100 * (a - b)) / Math.abs(b), 1));
  const marge = (teil, ganz) => (teil === null || teil === undefined || !ganz ? null : runden((100 * teil) / ganz, 1));

  function analysieren(companyfacts, quartaleAnzahl = 6) {
    const s = {}, konzepte = {};
    for (const k of Object.keys(KONZEPTE)) { const r = reihe(companyfacts, k); s[k] = r.werte; konzepte[k] = r.genutzt; }
    if (!Object.keys(s.umsatz).length && !Object.keys(s.nettogewinn).length) return { fehler: "Keine Quartalswerte für Umsatz oder Nettogewinn in den XBRL-Daten." };
    const enden = [...new Set([...Object.keys(s.umsatz), ...Object.keys(s.nettogewinn)])].sort().reverse().slice(0, quartaleAnzahl);
    const wert = (k, e) => (s[k][e] ? s[k][e].wert : null);
    const zeilen = enden.map((e) => {
      const u = wert("umsatz", e);
      let bg = wert("bruttogewinn", e);
      if (bg === null && u !== null && s.umsatzkosten[e]) bg = u - s.umsatzkosten[e].wert;
      const be = wert("betriebsergebnis", e), ng = wert("nettogewinn", e), eps = wert("eps", e);
      const basis = s.umsatz[e] || s.nettogewinn[e] || {};
      const vj = (k) => { const v = vorjahr(s[k], e); return v ? v.wert : null; };
      return {
        ende: e, start: basis.start || null, geschaeftsjahr: `${basis.fp || ""} ${basis.fy || ""}`.trim(),
        abgeleitet: Boolean((s.umsatz[e] && s.umsatz[e].abgeleitet) || (s.nettogewinn[e] && s.nettogewinn[e].abgeleitet)),
        umsatz: u, bruttogewinn: bg, betriebsergebnis: be, nettogewinn: ng, eps: eps === null ? null : runden(eps, 2),
        bruttomarge: marge(bg, u), betriebsmarge: marge(be, u), nettomarge: marge(ng, u),
        umsatz_vj: prozent(u, vj("umsatz")), nettogewinn_vj: prozent(ng, vj("nettogewinn")), eps_vj: prozent(eps, vj("eps")),
        eingereicht: basis.eingereicht || null, form: basis.form || null,
      };
    });
    const ttm = {};
    for (const k of ["umsatz", "nettogewinn", "eps"]) {
      const letzte4 = Object.keys(s[k]).sort().slice(-4);
      if (letzte4.length === 4 && (datum(letzte4[3]) - datum(letzte4[0])) / TAG < 300) ttm[k] = letzte4.reduce((x, e) => x + s[k][e].wert, 0);
    }
    if ("eps" in ttm) ttm.eps = runden(ttm.eps, 2);
    return { firma: companyfacts.entityName || null, cik: String(companyfacts.cik || "").padStart(10, "0"), zeilen, ttm, konzepte, bilanz: bilanz(companyfacts) };
  }

  // ---------- Bilanz-Stichtagswerte (ab 11-06i) ----------
  // Eigenkapital (us-gaap StockholdersEquity, sonst …IncludingPortionAttributableToNoncontrollingInterest) und gemeldete Aktienzahl
  // (dei EntityCommonStockSharesOutstanding). Stichtagswerte haben kein „start“. Nur aus 10-Q/10-K/20-F/40-F; jüngster Stichtag,
  // bei gleichem Stichtag die spätere Meldung (Korrektur). Fehlt ein Wert → null (nie geschätzt). Ergebnis je Wert:
  // { wert, stichtag, form, eingereicht, konzept }.
  const BILANZ = {
    eigenkapital: { ns: "us-gaap", konzepte: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], einheit: "USD" },
    aktien: { ns: "dei", konzepte: ["EntityCommonStockSharesOutstanding"], einheit: "shares" },
  };
  function stichtagWert(companyfacts, { ns, konzepte, einheit }) {
    for (const konzept of konzepte) {
      const knoten = companyfacts && companyfacts.facts && companyfacts.facts[ns] && companyfacts.facts[ns][konzept];
      const liste = knoten && knoten.units ? knoten.units[einheit] || [] : [];
      let best = null;
      for (const f of liste) {
        if (f.start || !f.end || !Number.isFinite(f.val) || !BERICHTE.includes(String(f.form || "").split("/")[0])) continue;
        if (!best || f.end > best.end || (f.end === best.end && (f.filed || "") > (best.filed || ""))) best = f;
      }
      if (best) return { wert: best.val, stichtag: best.end, form: best.form, eingereicht: best.filed || null, konzept: ns + ":" + konzept };
    }
    return null;
  }
  function bilanz(companyfacts) {
    return { eigenkapital: stichtagWert(companyfacts, BILANZ.eigenkapital), aktien: stichtagWert(companyfacts, BILANZ.aktien) };
  }

  // Neueste 10-Q/10-K und neueste 8-K mit Punkt 2.02 (Quartalszahlen) aus den submissions
  function meldungen(submissions) {
    const r = submissions && submissions.filings && submissions.filings.recent;
    const aus = { bericht: null, zahlen8k: null };
    if (!r || !Array.isArray(r.form)) return aus;
    const cik = String(Number(submissions.cik || 0));
    const link = (i) => `https://www.sec.gov/Archives/edgar/data/${cik}/${String(r.accessionNumber[i]).replace(/-/g, "")}/${r.primaryDocument[i]}`;
    for (let i = 0; i < r.form.length; i++) {
      if (!aus.bericht && BERICHTE.includes(r.form[i])) aus.bericht = { form: r.form[i], eingereicht: r.filingDate[i], zeitraum: (r.reportDate && r.reportDate[i]) || null, link: link(i) };
      // ab 16j (ANA-S19): Akzessionsnummer, Hauptdokument und Index-Seite (facts.py: Rückfall ist die -index.htm, nicht das 8-K-Hauptdokument)
      if (!aus.zahlen8k && r.form[i] === "8-K" && String((r.items && r.items[i]) || "").includes("2.02")) {
        const ordner = `https://www.sec.gov/Archives/edgar/data/${cik}/${String(r.accessionNumber[i]).replace(/-/g, "")}/`;
        aus.zahlen8k = { form: "8-K", eingereicht: r.filingDate[i], link: link(i), akz: String(r.accessionNumber[i]), hauptdokument: r.primaryDocument[i], ordner, index: ordner + `${r.accessionNumber[i]}-index.htm`, pressemitteilung: null };
      }
      if (aus.bericht && aus.zahlen8k) break;
    }
    return aus;
  }

  // ab 16j (ANA-S19, facts.py:337-350): Pressemitteilung unter den Dateien eines Meldungsordners – EX-99.1 vor EX-99.x vor
  // earnings/release/press vor ex-N; nur .htm/.html/.txt/.pdf, ohne Hauptdokument, R-Dateien und Akzessionsdateien; je Stufe alphabetisch erste
  const EXHIBIT_RANG = [/ex(?:hibit)?[-_]?99[-_.]?0?1(?!\d)/i, /ex(?:hibit)?[-_]?99/i, /earnings|release|press/i, /ex(?:hibit)?[-_]?\d/i];
  function exhibitName(namen, haupt = null) {
    const docs = (namen || []).map(String).filter((n) => /\.(htm|html|txt|pdf)$/i.test(n) && n !== haupt && !/^(R\d+\.htm|\d{10}-\d{2}-\d{6})/.test(n));
    for (const rx of EXHIBIT_RANG) { const t = docs.filter((n) => rx.test(n)).sort(); if (t.length) return t[0]; }
    return null;
  }
  function nachlaufHinweis(ergebnis, m) {
    const b = m && m.bericht;
    if (!b || !b.zeitraum || !ergebnis.zeilen || !ergebnis.zeilen.length) return null;
    const letzte = ergebnis.zeilen[0].ende;
    if (b.zeitraum > letzte && (datum(b.zeitraum) - datum(letzte)) / TAG > 20) {
      return `Die XBRL-Daten der SEC enden am ${letzte}, aber eine ${b.form} für den Zeitraum bis ${b.zeitraum} wurde am ${b.eingereicht} eingereicht – bitte direkt lesen: ${b.link}`;
    }
    return null;
  }

  function naechsteZahlenSchaetzung(m, jetzt = Date.now()) {
    const e = m && m.zahlen8k;
    if (!e) return null;
    let t = datum(e.eingereicht) + 91 * TAG;
    while (t < jetzt - 7 * TAG) t += 91 * TAG; // lange keine Zahlen: in Quartalsschritten weiterzählen
    return { datum: iso(t), geschaetzt: true, grundlage: `letzte Zahlen-8-K vom ${e.eingereicht} + ca. 3 Monate`, unsicherheit_tage: 14 };
  }

  // ab 16j (ANA-S25): Runden wie Python „%.nf“ – exakter Gleichstand des Binärwerts zur geraden Ziffer (1,125 → 1,12; toFixed gäbe 1,13),
  // deutsches Komma. toFixed(stellen + 25) liefert die exakte Dezimalentwicklung weit genug, um einen echten Gleichstand zu erkennen.
  function festKomma(x, stellen) {
    const lang = Math.abs(x).toFixed(stellen + 25), [ganz, bruch] = lang.split(".");
    const kopf = ganz + bruch.slice(0, stellen), rest = bruch.slice(stellen);
    let n = BigInt(kopf);
    if (rest[0] > "5" || (rest[0] === "5" && /[1-9]/.test(rest.slice(1))) || (rest === "5" + "0".repeat(rest.length - 1) && n % 2n === 1n)) n += 1n;
    const s = n.toString().padStart(stellen + 1, "0"), text = stellen ? s.slice(0, -stellen) + "," + s.slice(-stellen) : s;
    return (x < 0 && n !== 0n ? "-" : "") + text;
  }
  // ab 16i/16j (ANA-S25, facts.py:303-304): ab 1 Mrd. 2 Nachkommastellen in Mrd., darunter 1 in Mio.; deutsches Komma
  const mrd = (v) => (v === null ? "–" : Math.abs(v) >= 1e9 ? festKomma(v / 1e9, 2) + " Mrd. USD" : festKomma(v / 1e6, 1) + " Mio. USD");
  const pz = (v) => (v === null ? "" : ` (${v > 0 ? "+" : ""}${v.toFixed(1)} % ggü. Vorjahr)`);

  // Klare Sätze: was sich im letzten Quartal geändert hat
  function aenderungen(ergebnis) {
    const z = ergebnis.zeilen || [];
    if (!z.length) return [];
    const a = z[0], v = z[1];
    const aus = [`Quartal bis ${a.ende}${a.abgeleitet ? " (aus dem 10-K abgeleitet)" : ""}: Umsatz ${mrd(a.umsatz)}${pz(a.umsatz_vj)}, Nettogewinn ${mrd(a.nettogewinn)}${pz(a.nettogewinn_vj)}${a.eps === null ? "" : `, verwässertes EPS ${a.eps.toFixed(2)} USD${pz(a.eps_vj)}`}.`];
    // ab AJ5: alle drei Margen wie facts.py:318-325 (vorher nur die Bruttomarge); fehlende Marge → keine Zeile, nie 0 %
    for (const [feld, name] of [["bruttomarge", "Bruttomarge"], ["betriebsmarge", "Betriebsmarge"], ["nettomarge", "Nettomarge"]]) {
      if (a[feld] === null || a[feld] === undefined) continue;
      const d = v && v[feld] !== null && v[feld] !== undefined ? runden(a[feld] - v[feld], 1) : null;
      aus.push(`${name} ${a[feld].toFixed(1)} %${d === null ? "" : ` (${d >= 0 ? "+" : ""}${d.toFixed(1)} Punkte zum Vorquartal)`}.`);
    }
    if (a.nettogewinn !== null && a.betriebsergebnis !== null && a.nettogewinn > a.betriebsergebnis) aus.push("Nettogewinn liegt über dem Betriebsergebnis – Sondereffekte außerhalb des Geschäfts (z. B. Beteiligungen, Steuern) sind enthalten.");
    if (v && a.umsatz !== null && v.umsatz) aus.push(`Umsatz ${prozent(a.umsatz, v.umsatz) > 0 ? "+" : ""}${prozent(a.umsatz, v.umsatz).toFixed(1)} % zum Vorquartal (viele Geschäfte sind saisonal – zuerst mit dem Vorjahr vergleichen).`);
    if (z.some((x) => x.abgeleitet)) aus.push("Abgeleitete Quartale = Geschäftsjahr minus drei 10-Q; abgeleitetes EPS ist nur ungefähr.");
    return aus;
  }

  // company_tickers.json → CIK (zehnstellig) zum Ticker
  // Zuordnung Ticker → CIK über die SEC-Liste company_tickers.json. Exakter Treffer zuerst (Verhalten wie bisher).
  // SEC-Alias (ab 11-03a): JARVIS schreibt Aktienklassen mit Punkt (BRK.B, wie AktienWorkflow.US_TICKER und die Aktienklassen-Tabelle
  // in copycat.js), die SEC-Liste mit Bindestrich (BRK-B). Nur für die SEC-Zuordnung wird „.“ → „-“ versucht – Kursabrufe und
  // Cache-Schlüssel bleiben unberührt. Mehrere verschiedene CIKs für den Alias → null (nicht eindeutig, also „nicht verfügbar“).
  function secAlias(ticker) {
    const m = /^([A-Z]{1,5})\.([A-Z]{1,2})$/.exec(ticker);
    return m ? m[1] + "-" + m[2] : null;
  }
  // ab 16i (ANA-S18): angehängtes Staatskürzel der SEC-Liste entfernen („APPLE INC /CA/“ → „APPLE INC“, „... /DE/“ → „...“)
  function firmenName(titel) {
    const t = String(titel == null ? "" : titel).replace(/\s*\/[A-Z]{2,3}\/?\s*$/, "").trim();
    return t || null;
  }
  function cikFuer(tickerListe, ticker) {
    const t = String(ticker || "").trim().toUpperCase();
    if (!t) return null;
    const eintraege = Object.values(tickerListe || {}).filter((v) => v && v.ticker !== undefined && v.cik_str !== undefined);
    const treffer = (s) => eintraege.filter((v) => String(v.ticker).toUpperCase() === s);
    const exakt = treffer(t);
    if (exakt.length) return { cik: String(exakt[0].cik_str).padStart(10, "0"), name: firmenName(exakt[0].title) };
    const alias = secAlias(t);
    if (!alias) return null;
    const ciks = [...new Set(treffer(alias).map((v) => String(v.cik_str).padStart(10, "0")))];
    if (ciks.length !== 1) return null;
    return { cik: ciks[0], name: firmenName(treffer(alias)[0].title), sec_ticker: alias };
  }

  // Sektor aus dem SIC-Code der SEC-Stammdaten (submissions: sic) – ab 11-06e. Grobe Einteilung nach den Divisionen der Standard
  // Industrial Classification (Wertebereiche der ersten zwei Ziffern), mit eigenem Bereich für Software/Datenverarbeitung (737x)
  // und Halbleiter/Elektronik (36xx). Ohne gültigen Code → null (Sektor unbekannt, nie geraten).
  function sektorAusSic(sic) {
    const s = String(sic === undefined || sic === null ? "" : sic).trim();
    if (!/^\d{3,4}$/.test(s)) return null;
    const n = Number(s.padStart(4, "0")), d = Math.floor(n / 100);
    if (n >= 7370 && n <= 7379) return "Technologie (Software/IT-Dienste)";
    if (d === 35 && n >= 3570 && n <= 3579) return "Technologie (Computer/Hardware)";
    if (d === 36) return "Technologie (Elektronik/Halbleiter)";
    if (d === 28 && n >= 2830 && n <= 2836) return "Gesundheit (Pharma/Biotech)";
    if (d === 38 && n >= 3840 && n <= 3851) return "Gesundheit (Medizintechnik)";
    if (d === 80) return "Gesundheit (Dienste)";
    if (d === 13 || d === 29) return "Energie (Öl/Gas)";
    if (d === 49) return "Versorger";
    if (d === 48) return "Kommunikation";
    if (d >= 60 && d <= 64) return "Finanzen";
    if (d >= 65 && d <= 67) return "Immobilien/Beteiligungen";
    if (d >= 52 && d <= 59) return "Einzelhandel";
    if (d >= 50 && d <= 51) return "Großhandel";
    if (d >= 40 && d <= 47) return "Transport";
    if (d >= 20 && d <= 39) return "Industrie/Herstellung";
    if (d >= 10 && d <= 14) return "Rohstoffe/Bergbau";
    if (d >= 15 && d <= 17) return "Bau";
    if (d >= 1 && d <= 9) return "Landwirtschaft";
    if (d >= 70 && d <= 89) return "Dienstleistungen";
    if (d >= 91 && d <= 99) return "Öffentlich/sonstiges";
    return null;
  }

  global.AktienSec = { sektorAusSic, bilanz, analysieren, meldungen, nachlaufHinweis, naechsteZahlenSchaetzung, aenderungen, cikFuer, firmenName, secAlias, exhibitName, festKomma, quartale, KONZEPTE, runden };
})(typeof window !== "undefined" ? window : globalThis);
