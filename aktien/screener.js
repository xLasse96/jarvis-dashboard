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

  function runden(x, stellen) {
    const f = 10 ** stellen;
    const y = Math.round(x * f * 1e6) / 1e6;
    const unten = Math.floor(y);
    return (Math.abs(y - unten - 0.5) < 1e-9 ? (unten % 2 === 0 ? unten : unten + 1) : Math.round(y)) / f;
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
      const kurs = zahl(p[w.ticker] !== undefined ? p[w.ticker] : w.kurs);
      if (!istZahl(kurs) || kurs <= 0) continue;
      w.price = kurs;
      if (w._widerspruch) continue;
      const eps = zahl(w.eps_ttm);
      if (istZahl(eps)) {
        w.earnings_yield = runden((100 * eps) / kurs, 2);
        if (eps > 0) w.pe = runden(kurs / eps, 1);
      }
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
    }
    if (k.period_end && (jetzt - Date.parse(k.period_end + "T00:00:00Z")) / TAG > SEC_ALT_TAGE) k._hinweise.push(`SEC-Zahlen enden am ${k.period_end} (älter als ${SEC_ALT_TAGE} Tage) – neuere Meldung direkt prüfen.`);
    if (z.abgeleitet) k._hinweise.push("Letztes Quartal aus dem 10-K abgeleitet.");
    return k;
  }

  // Zusammenführen: ein Datensatz je Ticker; Hinweise beider Quellen bleiben
  function datensatz(ticker, technisch = {}, fundamental = {}) {
    const d = { ticker, ...technisch, ...fundamental, name: fundamental.name || technisch.name || null };
    d._hinweise = [...(technisch._hinweise || []), ...(fundamental._hinweise || [])];
    d._widerspruch = Boolean(fundamental._widerspruch);
    if (istZahl(d.kurs)) preiseHinzufuegen([d], { [ticker]: d.kurs });
    return d;
  }

  const brauchtSec = (spec) => [...(spec.rules || []), ...(spec.rank || [])].some((r) => ["revenue_growth_yoy", "eps_growth_yoy", "net_income_growth_yoy", "gross_margin", "operating_margin", "net_margin", "eps_ttm", "pe", "earnings_yield", "revenue_ttm", "net_income_ttm"].includes(r.metric));

  global.AktienScreener = { screenen, regelnPruefen, pruefe, preiseHinzufuegen, zahl, kennzahlenAusKerzen, kennzahlenAusSec, datensatz, brauchtSec, VORLAGEN, NAMEN, OPS };
})(typeof window !== "undefined" ? window : globalThis);
