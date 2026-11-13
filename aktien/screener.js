// JARVIS Aktien – Screener (Stufe 3). Reine Rechnung ohne Netzwerk: prüft Werte gegen Regeln und ordnet die bestandenen.
// Regel-Engine (Operatoren, „missing“ fail/skip, gewichtete Rangfolge 0–1, KGV nur bei positivem EPS) nach dem Vorbild von
// trader-screener (screen.py) aus github.com/Jakeschincariol/trader-skill (MIT, Copyright (c) 2026 Jake Schincariol),
// in JavaScript übertragen. Kennzahlen kommen NUR aus vorhandenen Daten: technische aus Alpaca-Tageskerzen, fundamentale aus der
// SEC-Auswertung (sec.js). Fehlt etwas oder ist es veraltet/widersprüchlich, ist die Kennzahl „nicht verfügbar“ – nie geschätzt.
// Ergebnis ist eine Liste zum Weiterprüfen, keine Empfehlung und keine Order.
(function (global) {
  "use strict";

  const OPS = [">", ">=", "<", "<=", "==", "!=", "between", "in", "not in"];
  const TAG = 86400000;
  const MAX_KERZEN_ALTER_TAGE = 5;
  const SEC_ALT_TAGE = 200; // Quartalsende älter → Hinweis (Zahlen können einer Meldung hinterherlaufen)

  const NAMEN = {
    kurs: "Kurs", perf_1m: "Kursänderung 1 Monat %", perf_3m: "Kursänderung 3 Monate %", perf_6m: "Kursänderung 6 Monate %", perf_12m: "Kursänderung 12 Monate %",
    abstand_52w_hoch_pct: "Abstand zum 52-Wochen-Hoch %", volatilitaet_20t: "Schwankung 20 Tage % p. a.", rsi14: "RSI 14", ueber_ema200: "über EMA200 (1/0)",
    revenue_growth_yoy: "Umsatzwachstum ggü. Vorjahr %", eps_growth_yoy: "EPS-Wachstum %", net_income_growth_yoy: "Gewinnwachstum %", gross_margin: "Bruttomarge %",
    operating_margin: "Betriebsmarge %", net_margin: "Nettomarge %", eps_ttm: "EPS letzte 4 Quartale", pe: "KGV", earnings_yield: "Gewinnrendite %",
    peg: "PEG (KGV ÷ EPS-Wachstum)", kuv: "KUV (Kurs-Umsatz)", marktwert: "Börsenwert USD (abgeleitet)",
    kbv: "KBV (Kurs-Buchwert)", roe: "Eigenkapitalrendite %",
    eigenkapital: "Eigenkapital USD", verschuldung: "Verschuldung",
  };
  // ab 11-07i: kurze Erklärung je Kennzahl (Formel und Bedeutung, ohne Bewertung)
  const ERKLAERUNG = {
    kurs: "Schlusskurs der letzten vollständigen Tageskerze der Analyse.",
    eps_ttm: "Gewinn je Aktie (verwässert) der letzten vier Quartale laut SEC-Meldungen.",
    pe: "Kurs-Gewinn-Verhältnis: Kurs ÷ Gewinn je Aktie. Wie viele Jahresgewinne der Kurs kostet; nur bei positivem Gewinn berechnet.",
    peg: "KGV ÷ EPS-Wachstum ggü. Vorjahr. Setzt das KGV ins Verhältnis zum Wachstum eines einzelnen Jahres – entsprechend schwankend.",
    marktwert: "Börsenwert = Kurs × Aktienzahl (gemeldet oder aus Nettogewinn ÷ EPS abgeleitet).",
    kuv: "Kurs-Umsatz-Verhältnis: Börsenwert ÷ Umsatz der letzten vier Quartale; sinnvoll auch bei Verlusten, stark branchenabhängig.",
    kbv: "Kurs-Buchwert-Verhältnis: Börsenwert ÷ bilanzielles Eigenkapital zum Stichtag.",
    roe: "Eigenkapitalrendite: Nettogewinn der letzten vier Quartale ÷ Eigenkapital. Hohe Werte können auch aus wenig Eigenkapital (z. B. Rückkäufe) entstehen.",
    revenue_growth_yoy: "Umsatz des letzten Quartals im Vergleich zum Vorjahresquartal.",
    eps_growth_yoy: "Gewinn je Aktie des letzten Quartals im Vergleich zum Vorjahresquartal (beeinflusst auch durch Aktienrückkäufe).",
    net_income_growth_yoy: "Nettogewinn des letzten Quartals im Vergleich zum Vorjahresquartal.",
    gross_margin: "Bruttomarge: (Umsatz − Herstellungskosten) ÷ Umsatz, letztes Quartal.",
    operating_margin: "Betriebsmarge: Betriebsergebnis ÷ Umsatz, letztes Quartal.",
    net_margin: "Nettomarge: Nettogewinn ÷ Umsatz, letztes Quartal.",
    eigenkapital: "Bilanzielles Eigenkapital zum Stichtag der letzten Meldung (SEC).",
    verschuldung: "Schulden sind in der vorhandenen SEC-Auswertung nicht enthalten – daher nicht verfügbar statt geschätzt.",
  };

  const VORLAGEN = {
    fundamental: {
      name: "Wachsend, profitabel, nicht überteuert (Beispiel aus trader-screener)",
      rules: [{ metric: "revenue_growth_yoy", op: ">=", value: 10 }, { metric: "operating_margin", op: ">=", value: 25 }, { metric: "eps_ttm", op: ">", value: 0 }, { metric: "pe", op: "<=", value: 35 }],
      rank: [{ metric: "revenue_growth_yoy", order: "desc", weight: 2 }, { metric: "pe", order: "asc", weight: 1 }, { metric: "operating_margin", order: "desc", weight: 1 }],
      missing: "fail",
    },
    technisch: {
      name: "Aufwärtstrend ohne Übertreibung (JARVIS)",
      rules: [{ metric: "ueber_ema200", op: "==", value: 1 }, { metric: "perf_3m", op: ">", value: 0 }, { metric: "rsi14", op: "between", value: [30, 70] }, { metric: "abstand_52w_hoch_pct", op: ">=", value: -15 }],
      rank: [{ metric: "perf_6m", order: "desc", weight: 2 }, { metric: "perf_3m", order: "desc", weight: 1 }, { metric: "volatilitaet_20t", order: "asc", weight: 1 }],
      missing: "fail",
    },
    kombiniert: {
      name: "Wachstum und Trend (JARVIS)",
      rules: [{ metric: "revenue_growth_yoy", op: ">=", value: 5 }, { metric: "operating_margin", op: ">=", value: 15 }, { metric: "ueber_ema200", op: "==", value: 1 }],
      rank: [{ metric: "revenue_growth_yoy", order: "desc", weight: 1 }, { metric: "perf_6m", order: "desc", weight: 1 }],
      missing: "fail",
    },
  };

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
  function zahl(v) {
    if (typeof v === "boolean" || v === null || v === undefined) return v === undefined ? null : v;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v).trim();
    if (s === "" || ["na", "n/a", "none", "null", "-"].includes(s.toLowerCase())) return null;
    const t = s.replace(/[,$%]/g, "");
    return t !== "" && Number.isFinite(Number(t)) ? Number(t) : s;
  }
  const istZahl = (v) => typeof v === "number" && Number.isFinite(v);
  const fmt = (v) => (Array.isArray(v) ? "[" + v.map(fmt).join(", ") + "]" : istZahl(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")) : String(v));

  // Kurs → KGV und Gewinnrendite (nur mit positivem EPS ein KGV; nie bei widersprüchlichen Daten)
  function preiseHinzufuegen(werte, preise) {
    const p = Object.fromEntries(Object.entries((preise && (preise.prices || preise)) || {}).map(([k, v]) => [k.toUpperCase(), v]));
    for (const w of werte) {
      // ab AJ5: widersprüchliche SEC-Daten → abgeleitete Werte als „widersprüchlich“ markieren (nicht nur leer = „fehlt“)
      if (w._widerspruch) w._ungueltig = { ...(w._ungueltig || {}), pe: "widersprüchlich", earnings_yield: "widersprüchlich", roe: "widersprüchlich" };
      // ab AJ5: Eigenkapitalrendite braucht keinen Kurs (Nettogewinn ÷ Eigenkapital) – vorher fehlte sie ohne Kurs
      const ek = zahl(w.eigenkapital), gewinn = zahl(w.net_income_ttm);
      if (istZahl(ek) && !w._widerspruch) {
        if (ek <= 0) { if (Array.isArray(w._hinweise) && !w._hinweise.some((h) => h.startsWith("Eigenkapital nicht positiv"))) w._hinweise.push("Eigenkapital nicht positiv – KBV und Eigenkapitalrendite nicht aussagekräftig."); }
        else if (istZahl(gewinn)) w.roe = runden((100 * gewinn) / ek, 1);
      }
      const kurs = zahl(p[w.ticker] !== undefined ? p[w.ticker] : w.kurs);
      if (!istZahl(kurs) || kurs <= 0) continue;
      w.price = kurs;
      if (w._widerspruch) continue;
      const eps = zahl(w.eps_ttm);
      if (istZahl(eps)) {
        w.earnings_yield = runden((100 * eps) / kurs, 2);
        if (eps > 0) w.pe = runden(kurs / eps, 1);
      }
      // ab 11-06e: abgeleitete Bewertung nur aus vorhandenen SEC-Zahlen (keine Bilanzdaten, keine Schätzung):
      //   PEG = KGV ÷ EPS-Wachstum ggü. Vorjahr (nur bei positivem KGV und Wachstum)
      //   Aktienzahl (verwässert) = Nettogewinn ÷ EPS der letzten 4 Quartale → Börsenwert = Kurs × Aktienzahl → KUV = Börsenwert ÷ Umsatz
      const wachstum = zahl(w.eps_growth_yoy), umsatz = zahl(w.revenue_ttm);
      if (istZahl(w.pe) && istZahl(wachstum) && wachstum > 0) w.peg = runden(w.pe / wachstum, 2);
      // ab 11-06i: gemeldete Aktienzahl (SEC dei, Stichtag) hat Vorrang vor der Ableitung
      const gemeldet = zahl(w.aktien_gemeldet);
      const aktien = istZahl(gemeldet) && gemeldet > 0 ? gemeldet : istZahl(eps) && eps > 0 && istZahl(gewinn) && gewinn > 0 ? gewinn / eps : null;
      if (aktien) {
        w.marktwert = Math.round(kurs * aktien);
        w.marktwert_basis = istZahl(gemeldet) && gemeldet > 0 ? "gemeldet" : "abgeleitet";
        if (istZahl(umsatz) && umsatz > 0) w.kuv = runden((kurs * aktien) / umsatz, 2);
        if (w.marktwert_basis === "abgeleitet" && Array.isArray(w._hinweise) && !w._hinweise.some((h) => h.startsWith("Börsenwert und KUV abgeleitet"))) w._hinweise.push("Börsenwert und KUV abgeleitet: Aktienzahl = Nettogewinn ÷ verwässertes EPS (letzte 4 Quartale), keine gemeldete Aktienzahl.");
      }
      // ab 11-06i: KBV = Börsenwert ÷ Eigenkapital (nur bei positivem Eigenkapital, nie geschätzt). Eigenkapitalrendite (Nettogewinn
      // der letzten 4 Quartale ÷ Eigenkapital zum Stichtag) steht seit AJ5 oben, vor der Kursprüfung.
      if (istZahl(ek) && ek > 0 && w.marktwert) w.kbv = runden(w.marktwert / ek, 2);
    }
    return werte;
  }

  function regelnPruefen(spec) {
    if (!spec || typeof spec !== "object" || !Array.isArray(spec.rules || [])) return 'Regeln müssen die Form {"rules": [...]} haben.';
    for (const [i, r] of (spec.rules || []).entries()) {
      if (!r || !("metric" in r) || !("op" in r) || !("value" in r)) return `Regel ${i + 1} braucht metric, op und value.`;
      if (!OPS.includes(r.op)) return `Regel ${i + 1}: unbekannter Operator „${r.op}“ (erlaubt: ${OPS.join(", ")}).`;
      if (r.op === "between" && !(Array.isArray(r.value) && r.value.length === 2)) return `Regel ${i + 1}: between braucht [von, bis].`;
      if ((r.op === "in" || r.op === "not in") && !Array.isArray(r.value)) return `Regel ${i + 1}: ${r.op} braucht eine Liste.`;
    }
    for (const [i, k] of (spec.rank || []).entries()) if (!k || !k.metric || !["asc", "desc", undefined].includes(k.order)) return `Rangfolge ${i + 1} braucht metric und order asc/desc.`;
    if (!["fail", "skip", undefined].includes(spec.missing)) return 'missing muss "fail" oder "skip" sein.';
    return null;
  }

  function pruefe(firma, regel) {
    const { metric: m, op, value: soll } = regel;
    const ist = firma[m];
    if (ist === null || ist === undefined || ist === "") return [null, `${m} nicht verfügbar`];
    if (op === "in" || op === "not in") {
      const drin = soll.map((x) => String(x).toUpperCase()).includes(String(ist).toUpperCase());
      return [op === "in" ? drin : !drin, `${m} ${fmt(ist)} ${drin ? "ist in" : "ist nicht in"} ${fmt(soll)}`];
    }
    if ((op === "==" || op === "!=") && !istZahl(ist)) {
      const gleich = String(ist).toUpperCase() === String(soll).toUpperCase();
      return [gleich === (op === "=="), `${m} ${fmt(ist)} ${op} ${fmt(soll)}`];
    }
    if (!istZahl(ist)) return [false, `${m} ist „${ist}“, keine Zahl`];
    if (op === "between") {
      const [von, bis] = soll;
      const ok = von <= ist && ist <= bis;
      return [ok, `${m} ${fmt(ist)} ${ok ? "liegt in" : "liegt außerhalb"} ${fmt(von)} bis ${fmt(bis)}`];
    }
    const ok = { ">": ist > soll, ">=": ist >= soll, "<": ist < soll, "<=": ist <= soll, "==": ist === soll, "!=": ist !== soll }[op];
    return ok ? [true, `${m} ${fmt(ist)} ${op} ${fmt(soll)}`] : [false, `${m} ${fmt(ist)}, verlangt ${op} ${fmt(soll)}`];
  }

  function screenen(firmen, spec) {
    const fehler = regelnPruefen(spec);
    if (fehler) return { fehler };
    const fehlend = spec.missing || "fail";
    const ergebnisse = firmen.map((f) => {
      const durchgefallen = [], bestanden = [], uebersprungen = [];
      for (const r of spec.rules || []) {
        const [ok, warum] = pruefe(f, r);
        if (ok === null) (fehlend === "fail" ? durchgefallen : uebersprungen).push(warum);
        else (ok ? bestanden : durchgefallen).push(warum);
      }
      return { ticker: f.ticker, name: f.name || null, bestanden_alle: !durchgefallen.length, durchgefallen, bestanden, uebersprungen, kennzahlen: f, hinweise: f._hinweise || [] };
    });
    rangfolge(ergebnisse, spec.rank || []);
    ergebnisse.sort((a, b) => (a.bestanden_alle ? 0 : 1) - (b.bestanden_alle ? 0 : 1) || (b.punkte || 0) - (a.punkte || 0) || a.durchgefallen.length - b.durchgefallen.length || a.ticker.localeCompare(b.ticker));
    return { ergebnisse, name: spec.name || "eigene Regeln" };
  }

  function rangfolge(ergebnisse, schluessel) {
    const sieger = ergebnisse.filter((r) => r.bestanden_alle);
    for (const r of sieger) { r.punkte = 0; r.teile = {}; }
    if (!schluessel.length || !sieger.length) { for (const r of sieger) r.punkte = null; return; }
    for (const k of schluessel) {
      const ab = (k.order || "desc") === "desc";
      const werte = sieger.map((r) => [r, r.kennzahlen[k.metric]]).filter(([, v]) => istZahl(v));
      if (!werte.length) continue;
      const sortiert = werte.map(([, v]) => v).sort((a, b) => a - b);
      const n = sortiert.length;
      for (const [r, v] of werte) {
        const darunter = sortiert.filter((x) => x < v).length, gleich = sortiert.filter((x) => x === v).length;
        const pos = n > 1 ? (darunter + (gleich - 1) / 2) / (n - 1) : 1;
        r.teile[k.metric] = runden(ab ? pos : 1 - pos, 3);
      }
    }
    const gewicht = Object.fromEntries(schluessel.map((k) => [k.metric, Number(k.weight === undefined ? 1 : k.weight)]));
    for (const r of sieger) {
      const gesamt = Object.keys(r.teile).reduce((s, m) => s + gewicht[m], 0);
      r.punkte = gesamt ? runden(Object.entries(r.teile).reduce((s, [m, v]) => s + v * gewicht[m], 0) / gesamt, 3) : null;
      r.rang_luecken = schluessel.map((k) => k.metric).filter((m) => !(m in r.teile));
    }
  }

  // ---------- Kennzahlen aus vorhandenen Daten ----------
  // Tageskerzen → technische Kennzahlen; veraltet/ungültig/zu kurz → null (= nicht verfügbar) mit Hinweis
  function kennzahlenAusKerzen(kerzen, { jetzt = Date.now(), letzteLaufend = false } = {}) {
    const leer = { kurs: null, perf_1m: null, perf_3m: null, perf_6m: null, perf_12m: null, abstand_52w_hoch_pct: null, volatilitaet_20t: null, rsi14: null, ueber_ema200: null, kurs_stand: null };
    const T = global.AktienTechnik;
    if (!T) return { ...leer, _hinweise: ["technik.js fehlt"] };
    const fehler = T.pruefen(kerzen);
    if (fehler) return { ...leer, _hinweise: ["Kursdaten nicht verfügbar: " + fehler] };
    const alter = (jetzt - kerzen[kerzen.length - 1].t) / TAG;
    if (alter > MAX_KERZEN_ALTER_TAGE) return { ...leer, kurs_stand: new Date(kerzen[kerzen.length - 1].t).toISOString().slice(0, 10), _hinweise: [`Kursdaten veraltet (${Math.floor(alter)} Tage) – technische Kennzahlen nicht verfügbar.`] };
    const i = letzteLaufend && kerzen.length > 1 ? kerzen.length - 2 : kerzen.length - 1;
    const c = kerzen[i].c;
    const ind = T.indikatoren(kerzen);
    const perf = (n) => (i - n >= 0 ? runden((c / kerzen[i - n].c - 1) * 100, 2) : null);
    let vola = null;
    if (i >= 20) {
      const r = [];
      for (let j = i - 19; j <= i; j++) r.push(Math.log(kerzen[j].c / kerzen[j - 1].c));
      const m = r.reduce((s, x) => s + x, 0) / r.length;
      vola = runden(Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100, 2);
    }
    const hoch = i >= 251 ? Math.max(...kerzen.slice(i - 251, i + 1).map((k) => k.h)) : null;
    const hinweise = [];
    if (hoch === null) hinweise.push("Weniger als 252 Kerzen – 12-Monats-Werte nicht verfügbar.");
    return {
      kurs: c, perf_1m: perf(21), perf_3m: perf(63), perf_6m: perf(126), perf_12m: perf(252),
      abstand_52w_hoch_pct: hoch === null ? null : runden((c / hoch - 1) * 100, 2), volatilitaet_20t: vola,
      rsi14: ind.rsi14[i] === null ? null : runden(ind.rsi14[i], 1), ueber_ema200: ind.ema200[i] === null ? null : (c > ind.ema200[i] ? 1 : 0),
      kurs_stand: new Date(kerzen[i].t).toISOString().slice(0, 10), _hinweise: hinweise,
    };
  }

  // SEC-Auswertung (AktienSec.analysieren) → fundamentale Kennzahlen im Format von metrics.json; Widersprüche → nicht verfügbar
  function kennzahlenAusSec(analyse, { jetzt = Date.now() } = {}) {
    const leer = { revenue_growth_yoy: null, eps_growth_yoy: null, net_income_growth_yoy: null, gross_margin: null, operating_margin: null, net_margin: null, eps_ttm: null, revenue_ttm: null, net_income_ttm: null, period_end: null };
    if (!analyse || analyse.fehler || !analyse.zeilen || !analyse.zeilen.length) return { ...leer, _hinweise: ["SEC-Kennzahlen nicht verfügbar" + (analyse && analyse.fehler ? ": " + analyse.fehler : ".")] };
    const z = analyse.zeilen[0], t = analyse.ttm || {};
    const k = {
      revenue_growth_yoy: z.umsatz_vj, eps_growth_yoy: z.eps_vj, net_income_growth_yoy: z.nettogewinn_vj, gross_margin: z.bruttomarge, operating_margin: z.betriebsmarge,
      net_margin: z.nettomarge, eps_ttm: t.eps ?? null, revenue_ttm: t.umsatz ?? null, net_income_ttm: t.nettogewinn ?? null, period_end: z.ende, name: analyse.firma || null, _hinweise: [],
    };
    for (const f of Object.keys(k)) if (k[f] === undefined) k[f] = null;
    if (istZahl(k.eps_ttm) && istZahl(k.net_income_ttm) && k.eps_ttm !== 0 && k.net_income_ttm !== 0 && Math.sign(k.eps_ttm) !== Math.sign(k.net_income_ttm)) {
      k._hinweise.push("Widerspruch in den SEC-Daten: EPS und Nettogewinn mit unterschiedlichem Vorzeichen – EPS, KGV und Gewinnrendite nicht verfügbar.");
      k.eps_ttm = null;
      k._widerspruch = true;
      k._ungueltig = { eps_ttm: "widersprüchlich" };
    }
    if (k.period_end && (jetzt - Date.parse(k.period_end + "T00:00:00Z")) / TAG > SEC_ALT_TAGE) k._hinweise.push(`SEC-Zahlen enden am ${k.period_end} (älter als ${SEC_ALT_TAGE} Tage) – neuere Meldung direkt prüfen.`);
    if (z.abgeleitet) k._hinweise.push("Letztes Quartal aus dem 10-K abgeleitet.");
    // ab 11-07i: Verlauf der letzten bis zu 4 Quartale (nur vorhandene Werte, neueste zuerst)
    k._verlauf = analyse.zeilen.slice(0, 4).map((q) => ({ ende: q.ende || null, umsatz_vj: istZahl(q.umsatz_vj) ? q.umsatz_vj : null, betriebsmarge: istZahl(q.betriebsmarge) ? q.betriebsmarge : null, nettomarge: istZahl(q.nettomarge) ? q.nettomarge : null }));
    // ab 11-06i: Bilanz-Stichtagswerte mit Herkunft; älter als SEC_ALT_TAGE → Hinweis „veraltet“
    const b = analyse.bilanz || {};
    if (b.eigenkapital) { k.eigenkapital = b.eigenkapital.wert; k.eigenkapital_stichtag = b.eigenkapital.stichtag; k.eigenkapital_quelle = `SEC ${b.eigenkapital.form}, eingereicht ${b.eigenkapital.eingereicht || "?"} (${b.eigenkapital.konzept})`; }
    if (b.aktien) { k.aktien_gemeldet = b.aktien.wert; k.aktien_stichtag = b.aktien.stichtag; }
    for (const [feld, name] of [["eigenkapital_stichtag", "Eigenkapital"], ["aktien_stichtag", "Aktienzahl"]]) {
      if (k[feld] && (jetzt - Date.parse(k[feld] + "T00:00:00Z")) / TAG > SEC_ALT_TAGE) k._hinweise.push(`${name} zum ${k[feld]} (älter als ${SEC_ALT_TAGE} Tage) – veraltet.`);
    }
    return k;
  }

  // ---------- Kennzahlenübersicht (ab 11-06i) ----------
  // Je Kennzahl: Wert, Herkunft, Stichtag, Status (ok | fehlt | veraltet | abgeleitet) und eine neutrale Einordnung. Die Einordnung
  // beschreibt nur die Größenordnung (keine Bewertung „günstig/teuer“, keine Empfehlung); Schwellen sind allgemeine Faustwerte und
  // branchenabhängig.
  const DEUTUNG = {
    pe: (v) => (v < 15 ? "unter 15 – im Verhältnis zum Gewinn niedrig" : v <= 25 ? "15–25 – mittlerer Bereich" : "über 25 – hoher Preis je Gewinn-Dollar"),
    peg: (v) => (v < 1 ? "unter 1 – KGV niedrig im Verhältnis zum EPS-Wachstum des letzten Jahres" : v <= 2 ? "1–2 – KGV etwa im Verhältnis zum Wachstum" : "über 2 – KGV hoch im Verhältnis zum Wachstum; Wachstum eines Jahres ist schwankend"),
    kuv: (v) => (v < 1 ? "unter 1 – niedrig je Umsatz-Dollar" : v <= 5 ? "1–5 – mittlerer Bereich (stark branchenabhängig)" : "über 5 – hoch je Umsatz-Dollar (üblich bei hohen Margen oder Wachstum)"),
    kbv: (v) => (v < 1 ? "unter 1 – Börsenwert unter dem Buchwert" : v <= 3 ? "1–3 – mittlerer Bereich" : "über 3 – Börsenwert deutlich über dem Buchwert"),
    roe: (v) => (v < 0 ? "negativ – Verlust im Verhältnis zum Eigenkapital" : v < 10 ? "unter 10 % – niedrige Verzinsung des Eigenkapitals" : v <= 20 ? "10–20 % – mittlerer Bereich" : "über 20 % – hohe Verzinsung (auch durch wenig Eigenkapital möglich)"),
  };
  function kennzahlenUebersicht(d) {
    const x = d || {}, hinweise = x._hinweise || [];
    const secStand = x.period_end ? `Quartal bis ${x.period_end}` : null;
    const veraltet = (name) => hinweise.some((h) => h.startsWith(name) && h.includes("veraltet")) || (name === "SEC" && hinweise.some((h) => h.startsWith("SEC-Zahlen enden")));
    const zeile = (metric, quelle, stichtag, status) => ({ metric, name: NAMEN[metric] || metric, wert: istZahl(x[metric]) ? x[metric] : null, quelle, stichtag,
      status: istZahl(x[metric]) ? status : x._ungueltig && x._ungueltig[metric] ? x._ungueltig[metric] : "fehlt", deutung: istZahl(x[metric]) && DEUTUNG[metric] ? DEUTUNG[metric](x[metric]) : null, erklaerung: ERKLAERUNG[metric] || null });
    const secStatus = veraltet("SEC") ? "veraltet" : "ok";
    const mwStatus = x.marktwert_basis === "abgeleitet" ? "abgeleitet" : veraltet("Aktienzahl") ? "veraltet" : "ok";
    return [
      zeile("kurs", "Tageskerze (Kursdaten der Analyse)", x.kurs_stand || null, "ok"),
      zeile("eps_ttm", "SEC companyfacts (verwässertes EPS, 4 Quartale)", secStand, secStatus),
      zeile("pe", "Kurs ÷ EPS", secStand, secStatus),
      zeile("peg", "KGV ÷ EPS-Wachstum ggü. Vorjahr", secStand, secStatus),
      zeile("marktwert", x.marktwert_basis === "gemeldet" ? `Kurs × gemeldete Aktienzahl (Stichtag ${x.aktien_stichtag})` : "Kurs × (Nettogewinn ÷ EPS)", x.aktien_stichtag || secStand, mwStatus),
      zeile("kuv", "Börsenwert ÷ Umsatz (4 Quartale)", secStand, mwStatus === "ok" ? secStatus : mwStatus),
      zeile("kbv", "Börsenwert ÷ Eigenkapital" + (x.eigenkapital_quelle ? " – " + x.eigenkapital_quelle : ""), x.eigenkapital_stichtag || null, veraltet("Eigenkapital") ? "veraltet" : mwStatus === "abgeleitet" ? "abgeleitet" : "ok"),
      zeile("roe", "Nettogewinn (4 Quartale) ÷ Eigenkapital zum Stichtag", x.eigenkapital_stichtag || null, veraltet("Eigenkapital") ? "veraltet" : "ok"),
      zeile("revenue_growth_yoy", "SEC companyfacts", secStand, secStatus),
      zeile("operating_margin", "SEC companyfacts", secStand, secStatus),
      // ab 11-07i: Gewinnentwicklung, Margen und Bilanz, soweit belegt; Verschuldung ist in der SEC-Auswertung nicht enthalten
      zeile("eps_growth_yoy", "SEC companyfacts", secStand, secStatus),
      zeile("net_income_growth_yoy", "SEC companyfacts", secStand, secStatus),
      zeile("gross_margin", "SEC companyfacts", secStand, secStatus),
      zeile("net_margin", "SEC companyfacts", secStand, secStatus),
      zeile("eigenkapital", x.eigenkapital_quelle || "SEC companyfacts (Bilanz)", x.eigenkapital_stichtag || null, veraltet("Eigenkapital") ? "veraltet" : "ok"),
      zeile("verschuldung", "nicht in der SEC-Auswertung enthalten", null, "fehlt"),
    ];
  }

  // ---------- Stärken und Schwächen (ab 11-07i) ----------
  // Nur aus belegten Kennzahlen, je Punkt mit Wert, Schwelle und Quelle. Allgemeine, branchenabhängige Faustwerte – keine Gesamtnote,
  // keine Punktzahl, keine Empfehlung; Bewertungskennzahlen (KGV, KUV, KBV) gelten weder als Stärke noch als Schwäche.
  const SS_REGELN = [
    { metric: "revenue_growth_yoy", art: "staerke", test: (v) => v >= 10, text: (v) => `Umsatz wächst ggü. Vorjahr (${v} % ≥ 10 %)` },
    { metric: "revenue_growth_yoy", art: "schwaeche", test: (v) => v < 0, text: (v) => `Umsatz schrumpft ggü. Vorjahr (${v} %)` },
    { metric: "eps_growth_yoy", art: "staerke", test: (v) => v >= 10, text: (v) => `Gewinn je Aktie wächst (${v} % ≥ 10 %)` },
    { metric: "eps_growth_yoy", art: "schwaeche", test: (v) => v < 0, text: (v) => `Gewinn je Aktie sinkt (${v} %)` },
    { metric: "net_income_growth_yoy", art: "schwaeche", test: (v) => v < 0, text: (v) => `Nettogewinn sinkt (${v} %)` },
    { metric: "operating_margin", art: "staerke", test: (v) => v >= 20, text: (v) => `Hohe Betriebsmarge (${v} % ≥ 20 %)` },
    { metric: "operating_margin", art: "schwaeche", test: (v) => v < 0, text: (v) => `Operativer Verlust (Betriebsmarge ${v} %)` },
    { metric: "net_margin", art: "staerke", test: (v) => v >= 15, text: (v) => `Hohe Nettomarge (${v} % ≥ 15 %)` },
    { metric: "net_margin", art: "schwaeche", test: (v) => v < 0, text: (v) => `Nettoverlust (Nettomarge ${v} %)` },
    { metric: "roe", art: "staerke", test: (v) => v >= 15, text: (v) => `Hohe Eigenkapitalrendite (${v} % ≥ 15 %; auch durch wenig Eigenkapital möglich)` },
    { metric: "roe", art: "schwaeche", test: (v) => v < 0, text: (v) => `Negative Eigenkapitalrendite (${v} %)` },
  ];
  function staerkenSchwaechen(d) {
    const x = d || {}, hinweise = x._hinweise || [];
    const quelle = x.period_end ? `SEC companyfacts, Quartal bis ${x.period_end}` : "SEC companyfacts";
    const staerken = [], schwaechen = [], widersprueche = [];
    for (const r of SS_REGELN) {
      const v = x[r.metric];
      if (istZahl(v) && r.test(v)) (r.art === "staerke" ? staerken : schwaechen).push({ metric: r.metric, wert: v, text: r.text(v), quelle: r.metric === "roe" ? (x.eigenkapital_quelle || quelle) : quelle });
    }
    const v = (m) => (istZahl(x[m]) ? x[m] : null);
    if (v("revenue_growth_yoy") !== null && v("net_income_growth_yoy") !== null && v("revenue_growth_yoy") >= 10 && v("net_income_growth_yoy") < 0) widersprueche.push(`Umsatz wächst (${v("revenue_growth_yoy")} %), Nettogewinn sinkt (${v("net_income_growth_yoy")} %) – Kosten oder Sondereffekte prüfen.`);
    if (v("eps_growth_yoy") !== null && v("net_income_growth_yoy") !== null && Math.abs(v("eps_growth_yoy")) >= 5 && Math.abs(v("net_income_growth_yoy")) >= 5 && Math.sign(v("eps_growth_yoy")) !== Math.sign(v("net_income_growth_yoy"))) widersprueche.push(`EPS (${v("eps_growth_yoy")} %) und Nettogewinn (${v("net_income_growth_yoy")} %) entwickeln sich gegenläufig – z. B. durch eine veränderte Aktienzahl.`);
    if (v("operating_margin") !== null && v("net_margin") !== null && v("operating_margin") > 0 && v("net_margin") < 0) widersprueche.push(`Operativ positiv (Betriebsmarge ${v("operating_margin")} %), netto Verlust (${v("net_margin")} %) – Zinsen, Steuern oder Sondereffekte.`);
    if (x._widerspruch) widersprueche.push("EPS und Nettogewinn mit unterschiedlichem Vorzeichen – EPS-basierte Kennzahlen nicht verfügbar.");
    const fehlend = SS_REGELN.map((r) => r.metric).filter((m, i, a) => a.indexOf(m) === i && !istZahl(x[m])).map((m) => NAMEN[m] || m);
    const veraltet = hinweise.some((h) => h.startsWith("SEC-Zahlen enden"));
    return { staerken, schwaechen, widersprueche, fehlend, veraltet, hinweis: "Faustwerte, branchenabhängig; vergangene Zahlen – keine Gesamtnote, keine Prognose, keine Empfehlung." };
  }

  // Zusammenführen: ein Datensatz je Ticker; Hinweise beider Quellen bleiben
  function datensatz(ticker, technisch = {}, fundamental = {}) {
    const d = { ticker, ...technisch, ...fundamental, name: fundamental.name || technisch.name || null };
    d._hinweise = [...(technisch._hinweise || []), ...(fundamental._hinweise || [])];
    d._widerspruch = Boolean(fundamental._widerspruch);
    if (istZahl(d.kurs)) preiseHinzufuegen([d], { [ticker]: d.kurs });
    return d;
  }

  const brauchtSec = (spec) => [...(spec.rules || []), ...(spec.rank || [])].some((r) => ["revenue_growth_yoy", "eps_growth_yoy", "net_income_growth_yoy", "gross_margin", "operating_margin", "net_margin", "eps_ttm", "pe", "earnings_yield", "revenue_ttm", "net_income_ttm", "peg", "kuv", "marktwert", "kbv", "roe"].includes(r.metric));

  // ---------- Vergleich mehrerer Aktien (ab 11-06e) ----------
  // datensaetze: Ergebnisse von datensatz() (ein Objekt je Ticker). Je Kennzahl der Wert oder null (nicht verfügbar) und – nur wenn
  // mindestens zwei Werte vorliegen – welcher Ticker nach DIESER Kennzahl vorne liegt. Keine Gesamtwertung, keine Empfehlung.
  const VERGLEICH = ["kurs", "perf_3m", "perf_12m", "abstand_52w_hoch_pct", "volatilitaet_20t", "rsi14", "pe", "peg", "kuv", "kbv", "roe", "earnings_yield", "revenue_growth_yoy", "operating_margin", "net_margin"];
  const RICHTUNG = { perf_3m: "hoch", perf_12m: "hoch", abstand_52w_hoch_pct: "hoch", volatilitaet_20t: "niedrig", pe: "niedrig", peg: "niedrig", kuv: "niedrig", kbv: "niedrig", roe: "hoch", earnings_yield: "hoch", revenue_growth_yoy: "hoch", operating_margin: "hoch", net_margin: "hoch" };
  function vergleichen(datensaetze, kennzahlen = VERGLEICH) {
    const liste = (datensaetze || []).filter((d) => d && d.ticker);
    if (liste.length < 2) return { fehler: "Für einen Vergleich mindestens zwei analysierte Werte nötig." };
    const spalten = kennzahlen.map((m) => ({ metric: m, name: NAMEN[m] || m, richtung: RICHTUNG[m] || null }));
    const zeilen = liste.map((d) => ({ ticker: d.ticker, name: d.name || null, werte: Object.fromEntries(kennzahlen.map((m) => [m, istZahl(d[m]) ? d[m] : null])), hinweise: d._hinweise || [] }));
    const vorne = {};
    for (const s of spalten) {
      if (!s.richtung) continue;
      const mit = zeilen.filter((z) => z.werte[s.metric] !== null);
      if (mit.length < 2) continue;
      const bester = s.richtung === "hoch" ? Math.max(...mit.map((z) => z.werte[s.metric])) : Math.min(...mit.map((z) => z.werte[s.metric]));
      vorne[s.metric] = mit.filter((z) => z.werte[s.metric] === bester).map((z) => z.ticker);
    }
    const fehlend = spalten.filter((s) => zeilen.every((z) => z.werte[s.metric] === null)).map((s) => s.name);
    return { spalten, zeilen, vorne, fehlend, hinweis: "Gegenüberstellung je Kennzahl („vorne“ nur nach dieser einen Kennzahl) – keine Gesamtwertung, keine Empfehlung." };
  }

  global.AktienScreener = { kennzahlenUebersicht, DEUTUNG, ERKLAERUNG, staerkenSchwaechen, vergleichen, VERGLEICH, screenen, regelnPruefen, pruefe, preiseHinzufuegen, zahl, kennzahlenAusKerzen, kennzahlenAusSec, datensatz, brauchtSec, VORLAGEN, NAMEN, OPS, runden };
})(typeof window !== "undefined" ? window : globalThis);
