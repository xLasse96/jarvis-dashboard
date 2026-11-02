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

  function pruefen(kerzen) {
    if (!Array.isArray(kerzen) || !kerzen.length) return "Keine Kerzendaten.";
    for (let i = 0; i < kerzen.length; i++) {
      const k = kerzen[i];
      if (!k || ![k.t, k.o, k.h, k.l, k.c, k.v].every(Number.isFinite) || k.l <= 0 || k.h < k.l) return `Ungültige Kerze an Position ${i + 1}.`;
      if (i && k.t <= kerzen[i - 1].t) return "Kerzen nicht aufsteigend sortiert.";
    }
    return null;
  }

  function indikatoren(kerzen) {
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

    return {
      zeit: k.t,
      kerze_laufend_ausgelassen: Boolean(optionen.letzteLaufend && kerzen.length > 1),
      stand: { kurs: k.c, ema20: r(e20), ema50: r(e50), ema200: r(e200), rsi14: r(rs, 1), atr14: r(ind.atr14[i]), volumen_verhaeltnis: r(vv) },
      signale,
      punkte: signale.reduce((s, x) => s + x.punkte, 0),
      hinweise,
    };
  }

  // Mehrere Werte: { SYMBOL: kerzen } → nach Punkten sortierte Liste; Fehler je Wert bleiben sichtbar
  function scannenListe(jeSymbol, optionen = {}) {
    return Object.entries(jeSymbol).map(([symbol, kerzen]) => ({ symbol, ...scannen(kerzen, optionen) }))
      .sort((a, b) => (a.fehler ? 1 : 0) - (b.fehler ? 1 : 0) || (b.punkte || 0) - (a.punkte || 0) || a.symbol.localeCompare(b.symbol));
  }

  global.AktienTechnik = { ema, sma, rsi, atr, indikatoren, pruefen, scannen, scannenListe, HINWEIS };
})(typeof window !== "undefined" ? window : globalThis);
