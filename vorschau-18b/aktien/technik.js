// JARVIS Aktien – Technik: Indikatoren und Chart-Scanner (Stufe 2). Reine Rechnung ohne Netzwerk, erzeugt nie eine Order.
// JARVIS-eigen (im Trader-Skill gibt es keinen Chart-Scanner). Die Indikatoren rechnen wie der Worker (/kerzen):
// EMA mit einfachem Durchschnitt als Startwert, RSI und ATR nach Wilder. Werte an Kerze i hängen nur von Kerzen ≤ i ab.
//
// Scanner-Signale (letzte abgeschlossene Kerze):
//   Trend          Kurs > EMA50 > EMA200 = Aufwärtstrend (+2), Kurs < EMA50 < EMA200 = Abwärtstrend (−2)
//   Kreuzung       EMA50 kreuzt EMA200 in den letzten 5 Kerzen: nach oben +1, nach unten −1
//   Ausbruch       Schluss über dem Hoch der 20 Kerzen davor: mit Volumen ≥ 1,5 × Durchschnitt +2, ohne +1
//   Rücksetzer     im Aufwärtstrend berührt das Tief die EMA20, Schluss darüber (+1)
//   RSI            ≥ 70 überkauft (−1), ≤ 30 überverkauft (0, allein kein Kaufgrund)
//   unter EMA200   (−1, wenn nicht schon Abwärtstrend)
// Punkte ordnen nur die Liste. Treffer sind eine technische Einordnung der Vergangenheit, keine Empfehlung.
(function (global) {
  "use strict";

  const HINWEIS = "Technische Einordnung vergangener Kurse – keine Empfehlung, keine Prognose, keine Order.";

  function ema(werte, periode) {
    const aus = new Array(werte.length).fill(null);
    const start = werte.findIndex((w) => w !== null && Number.isFinite(w));
    if (start < 0 || werte.length - start < periode) return aus;
    let e = 0;
    for (let i = start; i < start + periode; i++) e += werte[i];
    e /= periode;
    aus[start + periode - 1] = e;
    const alpha = 2 / (periode + 1);
    for (let i = start + periode; i < werte.length; i++) {
      e += alpha * (werte[i] - e);
      aus[i] = e;
    }
    return aus;
  }

  function sma(werte, periode) {
    const aus = new Array(werte.length).fill(null);
    let summe = 0;
    for (let i = 0; i < werte.length; i++) {
      summe += werte[i];
      if (i >= periode) summe -= werte[i - periode];
      if (i >= periode - 1) aus[i] = summe / periode;
    }
    return aus;
  }

  function rsi(schluss, periode = 14) {
    const aus = new Array(schluss.length).fill(null);
    if (schluss.length <= periode) return aus;
    const wert = (g, v) => (v === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / v));
    let g = 0, v = 0;
    for (let i = 1; i <= periode; i++) {
      const d = schluss[i] - schluss[i - 1];
      if (d > 0) g += d; else v -= d;
    }
    g /= periode; v /= periode;
    aus[periode] = wert(g, v);
    for (let i = periode + 1; i < schluss.length; i++) {
      const d = schluss[i] - schluss[i - 1];
      g = (g * (periode - 1) + Math.max(d, 0)) / periode;
      v = (v * (periode - 1) + Math.max(-d, 0)) / periode;
      aus[i] = wert(g, v);
    }
    return aus;
  }

  // Average True Range nach Wilder; erster Wert = Durchschnitt der ersten `periode` True Ranges (ab Kerze 1)
  function atr(kerzen, periode = 14) {
    const aus = new Array(kerzen.length).fill(null);
    if (kerzen.length <= periode) return aus;
    const tr = (i) => Math.max(kerzen[i].h - kerzen[i].l, Math.abs(kerzen[i].h - kerzen[i - 1].c), Math.abs(kerzen[i].l - kerzen[i - 1].c));
    let a = 0;
    for (let i = 1; i <= periode; i++) a += tr(i);
    a /= periode;
    aus[periode] = a;
    for (let i = periode + 1; i < kerzen.length; i++) {
      a = (a * (periode - 1) + tr(i)) / periode;
      aus[i] = a;
    }
    return aus;
  }

  // Höchstes Hoch bzw. tiefstes Tief der `n` Kerzen VOR Kerze i (ohne i selbst)
  function vorherHoch(kerzen, n) {
    return kerzen.map((_, i) => (i < n ? null : Math.max(...kerzen.slice(i - n, i).map((k) => k.h))));
  }
  function vorherTief(kerzen, n) {
    return kerzen.map((_, i) => (i < n ? null : Math.min(...kerzen.slice(i - n, i).map((k) => k.l))));
  }

  // ab 11-06e: MACD (12/26/9 auf Schlusskursen, EMA wie oben) und Bollinger-Bänder (SMA20 ± 2 Standardabweichungen der
  // Grundgesamtheit). Beide fließen NICHT in die Punkte ein – nur zusätzliche Einordnung.
  function macd(schluss, kurz = 12, lang = 26, signal = 9) {
    const a = ema(schluss, kurz), b = ema(schluss, lang);
    const linie = schluss.map((_, i) => (a[i] === null || b[i] === null ? null : a[i] - b[i]));
    const sig = ema(linie, signal);
    return { linie, signal: sig, histogramm: linie.map((x, i) => (x === null || sig[i] === null ? null : x - sig[i])) };
  }
  function bollinger(schluss, periode = 20, faktor = 2) {
    const mitte = sma(schluss, periode);
    const oben = new Array(schluss.length).fill(null), unten = new Array(schluss.length).fill(null);
    for (let i = periode - 1; i < schluss.length; i++) {
      const m = mitte[i];
      let q = 0;
      for (let j = i - periode + 1; j <= i; j++) q += (schluss[j] - m) ** 2;
      const s = Math.sqrt(q / periode);
      oben[i] = m + faktor * s;
      unten[i] = m - faktor * s;
    }
    return { mitte, oben, unten };
  }

  function pruefen(kerzen) {
    if (!Array.isArray(kerzen) || !kerzen.length) return "Keine Kerzendaten.";
    for (let i = 0; i < kerzen.length; i++) {
      const k = kerzen[i];
      if (!k || ![k.t, k.o, k.h, k.l, k.c, k.v].every(Number.isFinite) || k.l <= 0 || k.h < k.l) return `Ungültige Kerze an Position ${i + 1}.`;
      if (i && k.t <= kerzen[i - 1].t) return "Kerzen nicht aufsteigend sortiert.";
    }
    return null;
  }

  // ab 11-07j: dieselben Kerzen (gleiches Feld, gleiche Länge, gleiche letzte Kerze) werden nur einmal berechnet
  const INDIKATOR_SPEICHER = typeof WeakMap === "function" ? new WeakMap() : null;
  const RECHNUNGEN = { anzahl: 0 };
  function indikatoren(kerzen) {
    const letzte = kerzen[kerzen.length - 1] || {};
    const stempel = kerzen.length + ":" + letzte.t + ":" + letzte.c + ":" + letzte.h + ":" + letzte.l + ":" + letzte.v;
    const alt = INDIKATOR_SPEICHER && INDIKATOR_SPEICHER.get(kerzen);
    if (alt && alt.stempel === stempel) return alt.werte;
    const werte = indikatorenRechnen(kerzen);
    if (INDIKATOR_SPEICHER) INDIKATOR_SPEICHER.set(kerzen, { stempel, werte });
    return werte;
  }
  function indikatorenRechnen(kerzen) {
    RECHNUNGEN.anzahl++;
    const schluss = kerzen.map((k) => k.c);
    const vol20 = sma(kerzen.map((k) => k.v), 20);
    return {
      ema20: ema(schluss, 20),
      ema50: ema(schluss, 50),
      ema200: ema(schluss, 200),
      rsi14: rsi(schluss, 14),
      atr14: atr(kerzen, 14),
      vol20,
      volVerhaeltnis: kerzen.map((k, i) => (vol20[i] > 0 ? k.v / vol20[i] : null)),
      hoch20: vorherHoch(kerzen, 20),
      tief20: vorherTief(kerzen, 20),
    };
  }

  const r = (x, s = 2) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** s) / 10 ** s);

  // optionen.letzteLaufend: die letzte Kerze ist noch nicht abgeschlossen (Börse offen, heutige Tageskerze) → nicht bewerten
// optionen.jetzt (ms): wenn angegeben, Hinweis bei veralteten Kursdaten
  function scannen(kerzen, optionen = {}) {
    const fehler = pruefen(kerzen);
    if (fehler) return { fehler };
    const ind = optionen.indikatoren || indikatoren(kerzen);
    const i = optionen.letzteLaufend && kerzen.length > 1 ? kerzen.length - 2 : kerzen.length - 1;
    const k = kerzen[i];
    const e20 = ind.ema20[i], e50 = ind.ema50[i], e200 = ind.ema200[i];
    const signale = [];
    const hinweise = [];
    const plus = (art, text, punkte) => signale.push({ art, text, punkte });
    if (e200 === null) hinweise.push(`Nur ${kerzen.length} Kerzen – EMA200 nicht berechenbar, Trend nur eingeschränkt beurteilbar.`);
    // optionen.jetzt: Alter der jüngsten Kerze prüfen (Tageskerzen; mehr als 5 Kalendertage = veraltet, z. B. Datenausfall)
    if (Number.isFinite(optionen.jetzt) && (optionen.jetzt - kerzen[kerzen.length - 1].t) / 86400000 > 5) {
      hinweise.push(`Kursdaten veraltet: jüngste Kerze ${Math.floor((optionen.jetzt - kerzen[kerzen.length - 1].t) / 86400000)} Tage alt.`);
    }

    const aufwaerts = e50 !== null && e200 !== null && k.c > e50 && e50 > e200;
    const abwaerts = e50 !== null && e200 !== null && k.c < e50 && e50 < e200;
    if (aufwaerts) plus("trend", "Aufwärtstrend: Kurs über EMA50, EMA50 über EMA200", 2);
    if (abwaerts) plus("trend", "Abwärtstrend: Kurs unter EMA50, EMA50 unter EMA200", -2);
    if (!abwaerts && e200 !== null && k.c < e200) plus("ema200", "Kurs unter EMA200", -1);

    for (let j = Math.max(1, i - 4); j <= i; j++) {
      const a = ind.ema50[j - 1], b = ind.ema200[j - 1], c = ind.ema50[j], d = ind.ema200[j];
      if ([a, b, c, d].some((x) => x === null)) continue;
      if (a <= b && c > d) plus("kreuzung", `EMA50 kreuzt EMA200 nach oben (vor ${i - j} Kerze(n))`, 1);
      if (a >= b && c < d) plus("kreuzung", `EMA50 kreuzt EMA200 nach unten (vor ${i - j} Kerze(n))`, -1);
    }

    const vv = ind.volVerhaeltnis[i];
    if (ind.hoch20[i] !== null && k.c > ind.hoch20[i]) {
      if (vv !== null && vv >= 1.5) plus("ausbruch", `Ausbruch über das 20-Kerzen-Hoch (${r(ind.hoch20[i])}) mit ${r(vv, 1)}-fachem Volumen`, 2);
      else plus("ausbruch", `Ausbruch über das 20-Kerzen-Hoch (${r(ind.hoch20[i])}) ohne Volumenbestätigung`, 1);
    }
    if (ind.tief20[i] !== null && k.c < ind.tief20[i]) plus("ausbruch", `Schluss unter dem 20-Kerzen-Tief (${r(ind.tief20[i])})`, -1);
    if (aufwaerts && e20 !== null && k.l <= e20 && k.c >= e20) plus("ruecksetzer", `Rücksetzer an die EMA20 (${r(e20)}) im Aufwärtstrend, Schluss darüber`, 1);

    const rs = ind.rsi14[i];
    if (rs !== null && rs >= 70) plus("rsi", `RSI ${r(rs, 1)}: überkauft`, -1);
    if (rs !== null && rs <= 30) plus("rsi", `RSI ${r(rs, 1)}: überverkauft (allein kein Kaufgrund)`, 0);

    // ab 11-06e: Zusatzindikatoren ohne Punkte
    const schluss = kerzen.map((x) => x.c);
    const m = macd(schluss), bb = bollinger(schluss);
    const zusatz = { macd: r(m.linie[i], 3), macd_signal: r(m.signal[i], 3), macd_histogramm: r(m.histogramm[i], 3), bb_oben: r(bb.oben[i]), bb_mitte: r(bb.mitte[i]), bb_unten: r(bb.unten[i]),
      bb_prozent: bb.oben[i] !== null && bb.oben[i] > bb.unten[i] ? r(((k.c - bb.unten[i]) / (bb.oben[i] - bb.unten[i])) * 100, 0) : null,
      bb_breite_pct: bb.mitte[i] > 0 && bb.oben[i] !== null ? r(((bb.oben[i] - bb.unten[i]) / bb.mitte[i]) * 100, 1) : null };
    const einordnung = [];
    if (m.histogramm[i] !== null && m.histogramm[i - 1] !== null && m.histogramm[i - 1] !== undefined) {
      if (m.histogramm[i - 1] <= 0 && m.histogramm[i] > 0) einordnung.push("MACD kreuzt die Signallinie nach oben");
      else if (m.histogramm[i - 1] >= 0 && m.histogramm[i] < 0) einordnung.push("MACD kreuzt die Signallinie nach unten");
      else einordnung.push(m.histogramm[i] > 0 ? "MACD über der Signallinie" : "MACD unter der Signallinie");
    }
    if (zusatz.bb_prozent !== null) {
      if (k.c > bb.oben[i]) einordnung.push("Schluss über dem oberen Bollinger-Band");
      else if (k.c < bb.unten[i]) einordnung.push("Schluss unter dem unteren Bollinger-Band");
      else einordnung.push(`Schluss bei ${zusatz.bb_prozent} % der Bollinger-Spanne`);
    }

    return {
      zusatz,
      einordnung,
      zeit: k.t,
      kerze_laufend_ausgelassen: Boolean(optionen.letzteLaufend && kerzen.length > 1),
      stand: { kurs: k.c, ema20: r(e20), ema50: r(e50), ema200: r(e200), rsi14: r(rs, 1), atr14: r(ind.atr14[i]), volumen_verhaeltnis: r(vv) },
      signale,
      punkte: signale.reduce((s, x) => s + x.punkte, 0),
      hinweise,
    };
  }

  // ---------- Chartlage (ab 11-07j) ----------
  // Ergänzt scannen() um Zeitraumvergleich, Volatilität, Trend, widersprüchliche Indikatoren und eine neutrale Zusammenfassung.
  // optionen.datenart: "synthetisch" | "historisch" | "tageskerzen" (Standard). Bei synthetischen oder veralteten Daten sagt die
  // Zusammenfassung ausdrücklich, dass es kein aktuelles Signal ist. Keine Punkte, keine Empfehlung, keine Prognose.
  const INDIKATOREN = {
    ema: "EMA (exponentieller Durchschnitt) über 20, 50 bzw. 200 Tage: glättet den Kurs, jüngere Tage zählen stärker. Lage Kurs/EMA beschreibt den Trend der Vergangenheit.",
    rsi: "RSI 14 (Relative-Stärke-Index): Verhältnis der Auf- zu den Abwärtsbewegungen der letzten 14 Tage, 0–100. Ab 70 gilt als überkauft, bis 30 als überverkauft – allein kein Signal.",
    macd: "MACD: Abstand zwischen EMA12 und EMA26; die Signallinie ist dessen EMA9. Über bzw. unter der Signallinie beschreibt die jüngere Dynamik.",
    bollinger: "Bollinger-Bänder: 20-Tage-Durchschnitt ± 2 Standardabweichungen. Die Breite zeigt die Schwankung; ein Schluss außerhalb der Bänder ist ungewöhnlich, aber kein Signal.",
    atr: "ATR 14 (Average True Range): durchschnittliche Tagesspanne der letzten 14 Tage, hier auch in % des Kurses.",
    zeitraum: "Zeitraumvergleich: Kursänderung und größter Rückgang vom Höchststand innerhalb von 1, 3, 6 und 12 Monaten (21/63/126/252 Tageskerzen), nur wenn genug Kerzen vorliegen.",
  };
  // Schwankung: ATR in % des Kurses < 1,5 ruhig, < 3 mittel, sonst unruhig (allgemeine Faustwerte)
  function maxRueckgang(teil) {
    let hoch = -Infinity, tief = 0;
    for (const k of teil) { if (k.h > hoch) hoch = k.h; if (hoch > 0) tief = Math.min(tief, (k.l / hoch - 1) * 100); }
    return r(tief, 2);
  }
  function chartAnalyse(kerzen, optionen = {}) {
    const s = scannen(kerzen, optionen);
    if (s.fehler) return { fehler: s.fehler };
    const i = s.kerze_laufend_ausgelassen ? kerzen.length - 2 : kerzen.length - 1;
    const c = kerzen[i].c;
    const zeitraeume = [[21, "1 Monat"], [63, "3 Monate"], [126, "6 Monate"], [252, "12 Monate"]].map(([n, name]) => {
      if (i - n < 0) return { name, kerzen: n, verfuegbar: false };
      const teil = kerzen.slice(i - n, i + 1), vorher = kerzen[i - n].c;
      return { name, kerzen: n, verfuegbar: vorher > 0, veraenderung_pct: vorher > 0 ? r((c / vorher - 1) * 100) : null, max_rueckgang_pct: maxRueckgang(teil),
        hoch: r(Math.max(...teil.map((k) => k.h))), tief: r(Math.min(...teil.map((k) => k.l))) };
    });
    const atrWert = s.stand.atr14;
    const atrPct = atrWert !== null && c > 0 ? r((atrWert / c) * 100) : null;
    let schwankung = null;
    if (i >= 20) {
      const rend = [];
      for (let j = i - 19; j <= i; j++) if (kerzen[j - 1].c > 0 && kerzen[j].c > 0) rend.push(Math.log(kerzen[j].c / kerzen[j - 1].c));
      if (rend.length >= 2) { const m = rend.reduce((a, x) => a + x, 0) / rend.length; schwankung = r(Math.sqrt(rend.reduce((a, x) => a + (x - m) ** 2, 0) / (rend.length - 1)) * Math.sqrt(252) * 100); }
    }
    const volatilitaet = { atr_pct: atrPct, bb_breite_pct: s.zusatz.bb_breite_pct, schwankung_20t_pa: schwankung,
      einordnung: atrPct === null ? null : atrPct < 1.5 ? "ruhig" : atrPct < 3 ? "mittel" : "unruhig" };
    const trendSignal = s.signale.find((x) => x.art === "trend");
    const trend = trendSignal ? (trendSignal.punkte > 0 ? "aufwärts" : "abwärts") : s.stand.ema200 === null ? "nicht bestimmbar (zu wenige Kerzen)" : "uneinheitlich (kein klarer Trend)";
    const rsiWert = s.stand.rsi14, macdUeber = s.zusatz.macd_histogramm === null ? null : s.zusatz.macd_histogramm > 0;
    const widersprueche = [];
    if (trend === "aufwärts" && rsiWert !== null && rsiWert >= 70) widersprueche.push("Aufwärtstrend, aber RSI überkauft (" + rsiWert + ")");
    if (trend === "abwärts" && rsiWert !== null && rsiWert <= 30) widersprueche.push("Abwärtstrend, aber RSI überverkauft (" + rsiWert + ")");
    if (trend === "aufwärts" && macdUeber === false) widersprueche.push("Aufwärtstrend, aber MACD unter der Signallinie (nachlassende Dynamik)");
    if (trend === "abwärts" && macdUeber === true) widersprueche.push("Abwärtstrend, aber MACD über der Signallinie");
    if (s.signale.some((x) => x.art === "ausbruch" && x.punkte > 0) && rsiWert !== null && rsiWert >= 70) widersprueche.push("Ausbruch nach oben bei bereits überkauftem RSI");
    const pos = s.signale.filter((x) => x.punkte > 0).length, neg = s.signale.filter((x) => x.punkte < 0).length;
    if (pos && neg) widersprueche.push(`Gemischte Scanner-Signale (${pos} dafür, ${neg} dagegen)`);
    const datum = new Date(kerzen[i].t).toISOString().slice(0, 10);
    const veraltet = s.hinweise.some((h) => h.startsWith("Kursdaten veraltet"));
    const datenart = optionen.datenart === "synthetisch" ? "synthetisch" : optionen.datenart === "historisch" || veraltet ? "historisch" : "tageskerzen";
    const kopf = datenart === "synthetisch" ? "Synthetische Testdaten – keine echten Kurse, kein Signal." : datenart === "historisch" ? `Historische Kurse bis ${datum} – kein aktuelles Signal.` : `Tagesschlusskerzen bis ${datum} (keine Echtzeit).`;
    const lage = [kopf, `Trend: ${trend}.`, rsiWert === null ? "RSI nicht berechenbar." : `RSI ${rsiWert} (${rsiWert >= 70 ? "überkauft" : rsiWert <= 30 ? "überverkauft" : "neutral"}).`,
      macdUeber === null ? "MACD nicht berechenbar." : `MACD ${macdUeber ? "über" : "unter"} der Signallinie.`,
      volatilitaet.einordnung ? `Schwankung ${volatilitaet.einordnung} (ATR ${atrPct} % des Kurses).` : "Schwankung nicht berechenbar.",
      widersprueche.length ? "Widersprüchlich: " + widersprueche.join("; ") + "." : "Keine widersprüchlichen Indikatoren.", HINWEIS].join(" ");
    return { ...s, zeitraeume, volatilitaet, trend, widersprueche, datenart, lage };
  }

  // Mehrere Werte: { SYMBOL: kerzen } → nach Punkten sortierte Liste; Fehler je Wert bleiben sichtbar
  function scannenListe(jeSymbol, optionen = {}) {
    return Object.entries(jeSymbol).map(([symbol, kerzen]) => ({ symbol, ...scannen(kerzen, optionen) }))
      .sort((a, b) => (a.fehler ? 1 : 0) - (b.fehler ? 1 : 0) || (b.punkte || 0) - (a.punkte || 0) || a.symbol.localeCompare(b.symbol));
  }

  global.AktienTechnik = { ema, sma, rsi, atr, macd, bollinger, indikatoren, pruefen, scannen, scannenListe, HINWEIS, chartAnalyse, INDIKATOREN, RECHNUNGEN };
})(typeof window !== "undefined" ? window : globalThis);
