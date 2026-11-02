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
        const darin = Object.values(q).filter((v) => !v.abgeleitet && v.start >= f.start && v.ende < f.end).sort((a, b) => a.ende.localeCompare(b.ende));
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

  // Python round(): halbe Werte zur geraden Ziffer – für gleiche Ergebnisse wie das Vorbild; vorher gegen Fließkomma-Rauschen glätten
  function runden(x, stellen) {
    const f = 10 ** stellen;
    const y = Math.round(x * f * 1e6) / 1e6;
    const unten = Math.floor(y);
    const rest = y - unten;
    const gerundet = Math.abs(rest - 0.5) < 1e-9 ? (unten % 2 === 0 ? unten : unten + 1) : Math.round(y);
    return gerundet / f;
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
    return { firma: companyfacts.entityName || null, cik: String(companyfacts.cik || "").padStart(10, "0"), zeilen, ttm, konzepte };
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
      if (!aus.zahlen8k && r.form[i] === "8-K" && String((r.items && r.items[i]) || "").includes("2.02")) aus.zahlen8k = { form: "8-K", eingereicht: r.filingDate[i], link: link(i) };
      if (aus.bericht && aus.zahlen8k) break;
    }
    return aus;
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

  const mrd = (v) => (v === null ? "–" : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + " Mrd. USD" : (v / 1e6).toFixed(0) + " Mio. USD");
  const pz = (v) => (v === null ? "" : ` (${v > 0 ? "+" : ""}${v.toFixed(1)} % ggü. Vorjahr)`);

  // Klare Sätze: was sich im letzten Quartal geändert hat
  function aenderungen(ergebnis) {
    const z = ergebnis.zeilen || [];
    if (!z.length) return [];
    const a = z[0], v = z[1];
    const aus = [`Quartal bis ${a.ende}${a.abgeleitet ? " (aus dem 10-K abgeleitet)" : ""}: Umsatz ${mrd(a.umsatz)}${pz(a.umsatz_vj)}, Nettogewinn ${mrd(a.nettogewinn)}${pz(a.nettogewinn_vj)}${a.eps === null ? "" : `, verwässertes EPS ${a.eps.toFixed(2)} USD${pz(a.eps_vj)}`}.`];
    if (a.bruttomarge !== null) aus.push(`Bruttomarge ${a.bruttomarge.toFixed(1)} %${v && v.bruttomarge !== null ? ` (${a.bruttomarge - v.bruttomarge >= 0 ? "+" : ""}${(a.bruttomarge - v.bruttomarge).toFixed(1)} Punkte zum Vorquartal)` : ""}.`);
    if (a.nettogewinn !== null && a.betriebsergebnis !== null && a.nettogewinn > a.betriebsergebnis) aus.push("Nettogewinn liegt über dem Betriebsergebnis – Sondereffekte außerhalb des Geschäfts (z. B. Beteiligungen, Steuern) sind enthalten.");
    if (v && a.umsatz !== null && v.umsatz) aus.push(`Umsatz ${prozent(a.umsatz, v.umsatz) > 0 ? "+" : ""}${prozent(a.umsatz, v.umsatz).toFixed(1)} % zum Vorquartal (viele Geschäfte sind saisonal – zuerst mit dem Vorjahr vergleichen).`);
    if (z.some((x) => x.abgeleitet)) aus.push("Abgeleitete Quartale = Geschäftsjahr minus drei 10-Q; abgeleitetes EPS ist nur ungefähr.");
    return aus;
  }

  // company_tickers.json → CIK (zehnstellig) zum Ticker
  function cikFuer(tickerListe, ticker) {
    const t = String(ticker || "").toUpperCase();
    for (const v of Object.values(tickerListe || {})) if (v && String(v.ticker).toUpperCase() === t) return { cik: String(v.cik_str).padStart(10, "0"), name: v.title };
    return null;
  }

  global.AktienSec = { analysieren, meldungen, nachlaufHinweis, naechsteZahlenSchaetzung, aenderungen, cikFuer, quartale, KONZEPTE };
})(typeof window !== "undefined" ? window : globalThis);
