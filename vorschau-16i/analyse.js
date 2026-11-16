// JARVIS – Marktanalyse im Dashboard: Kerzenchart mit EMA 20/50/200, Volumen, RSI 14 und MACD 12/26/9.
// Kerzen und Indikatoren berechnet der Worker (GET /kerzen). Die Einordnung (Trend, Unterstützungen/Widerstände, ATR 14)
// rechnet ab 11-02q das Dashboard selbst aus diesen Kerzen, weil der Produktions-Worker sie nicht liefert. Kein Handel, keine Schlüssel.
// Benötigt: vendor/lightweight-charts-5.2.1.standalone.production.js sowie verbunden() und workerAnfrage()
// aus index.html.
(function () {
  "use strict";

  const AKTUALISIEREN_MS = 60000;
  const ZWISCHENSPEICHER_MS = 55000;
  const SICHTBARE_KERZEN = 150;

  const FARBEN = {
    hintergrund: "#071a2d",
    text: "#9fc7d6",
    raster: "#0c2a44",
    steigend: "#7affc4",
    fallend: "#ff6b6b",
    ema20: "#ffcc66",
    ema50: "#00eaff",
    ema200: "#c792ea",
    rsi: "#ffcc66",
    macd: "#00eaff",
    signal: "#ffcc66",
  };

  const zustand = {
    chart: null,
    serien: null,
    schluessel: "",
    geladenAm: 0,
    laedt: false,
    stufen: [], // Preislinien für Unterstützungen/Widerstände
    einordnung: null, // lokal berechnete Einordnung der angezeigten Kerzen (nie an die KI-Analyse übergeben)
    analyseStatusGeladen: false,
    zusammenfassung: null, // Kennzahlen der angezeigten Auswahl (Quelle für die KI-Analyse)
  };
  // Älter als das darf die Grundlage einer KI-Analyse nicht sein – sonst vorher neu laden
  const KI_DATEN_MAX_ALTER_MS = 5 * 60000;

  function element(id) {
    return document.getElementById(id);
  }

  function zahl(wert, stellen) {
    return Number(wert).toLocaleString("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
  }

  function zeitpunkt(sekunden) {
    return new Date(sekunden * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  }

  // Beschriftung der Zeitachse in Ortszeit (TickMarkType: 0 Jahr, 1 Monat, 2 Tag, 3/4 Uhrzeit)
  function zeitachse(sekunden, typ) {
    const d = new Date(sekunden * 1000);
    if (typ === 0) return String(d.getFullYear());
    if (typ === 1) return d.toLocaleDateString("de-DE", { month: "short" });
    if (typ === 2) return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  function chartErstellen() {
    const LWC = window.LightweightCharts;
    if (!LWC) {
      throw new Error("Chart-Bibliothek nicht geladen (dashboard/vendor fehlt).");
    }
    const chart = LWC.createChart(element("analyse-chart"), {
      autoSize: true,
      layout: {
        background: { type: LWC.ColorType.Solid, color: FARBEN.hintergrund },
        textColor: FARBEN.text,
        fontSize: 12,
        panes: { separatorColor: FARBEN.raster, separatorHoverColor: "rgba(0, 234, 255, 0.15)" },
        // Laut Lizenz der Bibliothek muss ein Hinweis auf TradingView sichtbar bleiben
        attributionLogo: true,
      },
      grid: { vertLines: { color: FARBEN.raster }, horzLines: { color: FARBEN.raster } },
      rightPriceScale: { borderColor: FARBEN.raster },
      timeScale: { borderColor: FARBEN.raster, timeVisible: true, secondsVisible: false, tickMarkFormatter: zeitachse },
      localization: { locale: "de-DE", timeFormatter: zeitpunkt },
      crosshair: { mode: LWC.CrosshairMode.Normal },
    });

    const linie = (farbe, breite, pane) => chart.addSeries(LWC.LineSeries, {
      color: farbe,
      lineWidth: breite,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    }, pane);

    const serien = {
      kerzen: chart.addSeries(LWC.CandlestickSeries, {
        upColor: FARBEN.steigend,
        downColor: FARBEN.fallend,
        borderVisible: false,
        wickUpColor: FARBEN.steigend,
        wickDownColor: FARBEN.fallend,
      }, 0),
      ema20: linie(FARBEN.ema20, 1, 0),
      ema50: linie(FARBEN.ema50, 1, 0),
      ema200: linie(FARBEN.ema200, 2, 0),
      volumen: chart.addSeries(LWC.HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false }, 1),
      rsi: chart.addSeries(LWC.LineSeries, {
        color: FARBEN.rsi,
        lineWidth: 1,
        priceLineVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      }, 2),
      macdHistogramm: chart.addSeries(LWC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 3),
      macd: linie(FARBEN.macd, 1, 3),
      signal: linie(FARBEN.signal, 1, 3),
    };
    for (const grenze of [70, 30]) {
      serien.rsi.createPriceLine({ price: grenze, color: "#7aa6b8", lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: "" });
    }

    const panes = chart.panes();
    [3, 1, 1.2, 1.2].forEach((faktor, i) => panes[i] && panes[i].setStretchFactor(faktor));

    zustand.chart = chart;
    zustand.serien = serien;
  }

  // ---------- Einordnung lokal aus den Kurskerzen (ab 11-02q) ----------
  // Formeln und Grenzfälle wie worker/src/index.js, Etappe 3a (atrBerechnen, trendBestimmen, unterstuetzungWiderstand,
  // einordnungErstellen), dort nachzulesen. Unterschied: worker/src rechnet ATR und Hochs/Tiefs zusätzlich mit bis zu 500
  // Vorlauf-Kerzen; hier gibt es nur die angezeigten Kerzen. Deshalb startet die ATR-Glättung bei der ersten angezeigten
  // Kerze, und die ersten 3 angezeigten Kerzen können kein Hoch/Tief sein. Die EMA-Reihen für den Trend kommen unverändert
  // (auf 6 Nachkommastellen gerundet) vom Worker. Reine Rechnung: keine Anfrage, nichts geht an die KI-Analyse.
  const EINORDNUNG = { srAnzahl: 2, swingFenster: 3, trendSchwelle: 0.05, atrPeriode: 14 };
  // Kurze Begriffserklärung (ab 11-02r), auch für die Aktienanalyse im Reiter „Trading“ – beschreibt nur, empfiehlt nichts
  const ERKLAERUNG = "Bedeutung: Trend = Richtung von Kurs und gleitenden Durchschnitten (EMA 50/200); Unterstützung bzw. Widerstand = "
    + "Kursbereiche, an denen frühere Tiefs bzw. Hochs lagen (Zahl der Berührungen, Abstand zum letzten Schluss); ATR 14 = durchschnittliche "
    + "Schwankung je Kerze über 14 Kerzen. Das beschreibt nur die Vergangenheit – keine Kauf- oder Verkaufsempfehlung.";
  const runden = (wert) => (wert === null ? null : Math.round(wert * 1e6) / 1e6);

  // Gleiche Prüfregeln wie kerzenPruefen in worker/src: widersprüchliche Kerzen → keine Berechnung, kein Chart
  function kerzenFehler(kerzen) {
    if (!Array.isArray(kerzen) || !kerzen.length) return "keine Kurskerzen geladen";
    for (let i = 0; i < kerzen.length; i++) {
      const k = kerzen[i];
      const nr = `Kerze ${i + 1} von ${kerzen.length}`;
      if (!k || !Number.isSafeInteger(k.t) || ![k.o, k.h, k.l, k.c, k.v].every((x) => typeof x === "number" && Number.isFinite(x))) return nr + " enthält ungültige Werte";
      if (k.o <= 0 || k.c <= 0 || k.l <= 0 || k.v < 0 || k.h < Math.max(k.o, k.c) || k.l > Math.min(k.o, k.c)) return nr + " ist widersprüchlich (Hoch, Tief oder Kurse)";
      if (i > 0 && k.t <= kerzen[i - 1].t) return "die Kurskerzen sind nicht zeitlich aufsteigend sortiert";
    }
    return null;
  }

  // ATR nach Wilder: Durchschnitt der „wahren Spanne“ (Hoch–Tief inkl. Kurslücke zum Vortag)
  function atrBerechnen(kerzen, periode) {
    const ergebnis = new Array(kerzen.length).fill(null);
    if (kerzen.length <= periode) return ergebnis;
    const spanne = kerzen.map((k, i) => (i === 0
      ? k.h - k.l
      : Math.max(k.h - k.l, Math.abs(k.h - kerzen[i - 1].c), Math.abs(k.l - kerzen[i - 1].c))));
    let atr = 0;
    for (let i = 1; i <= periode; i++) atr += spanne[i];
    atr /= periode;
    ergebnis[periode] = atr;
    for (let i = periode + 1; i < kerzen.length; i++) {
      atr = (atr * (periode - 1) + spanne[i]) / periode;
      ergebnis[i] = atr;
    }
    return ergebnis;
  }

  function trendBestimmen(kerzen, ema50, ema200, i) {
    const kurs = kerzen[i].c;
    const e50 = ema50[i];
    const e200 = ema200[i];
    const vorher = i >= 10 ? ema50[i - 10] : null;
    if (e50 === null || vorher === null || vorher === 0) {
      return { richtung: "unklar", text: "Zu wenige Kerzen für eine Trendeinordnung.", ema50_steigung_prozent: null };
    }
    const steigung = ((e50 - vorher) / vorher) * 100;
    let richtung = "seitwärts";
    if (kurs > e50 && steigung > EINORDNUNG.trendSchwelle && (e200 === null || e50 > e200)) {
      richtung = "aufwärts";
    } else if (kurs < e50 && steigung < -EINORDNUNG.trendSchwelle && (e200 === null || e50 < e200)) {
      richtung = "abwärts";
    }
    const text = {
      "aufwärts": "Aufwärtstrend: Kurs über der steigenden EMA 50" + (e200 !== null ? ", EMA 50 über EMA 200." : "."),
      "abwärts": "Abwärtstrend: Kurs unter der fallenden EMA 50" + (e200 !== null ? ", EMA 50 unter EMA 200." : "."),
      "seitwärts": "Seitwärts oder uneinheitlich: Kurs und Durchschnittslinien ergeben kein klares Trendbild.",
    }[richtung];
    return { richtung, text, ema50_steigung_prozent: runden(steigung) };
  }

  // Unterstützungen/Widerstände aus Swing-Hochs und -Tiefs der angezeigten Kerzen; nahe Stufen werden gebündelt
  function unterstuetzungWiderstand(kerzen, atr, i) {
    const kurs = kerzen[i].c;
    const fenster = EINORDNUNG.swingFenster;
    const toleranz = (atr || kurs * 0.005) * 0.5;
    const punkte = [];
    for (let j = fenster; j <= i - fenster; j++) {
      let hoch = true;
      let tief = true;
      for (let d = 1; d <= fenster; d++) {
        if (kerzen[j].h <= kerzen[j - d].h || kerzen[j].h <= kerzen[j + d].h) hoch = false;
        if (kerzen[j].l >= kerzen[j - d].l || kerzen[j].l >= kerzen[j + d].l) tief = false;
      }
      if (hoch) punkte.push(kerzen[j].h);
      if (tief) punkte.push(kerzen[j].l);
    }
    punkte.sort((a, b) => a - b);
    const buendel = [];
    for (const p of punkte) {
      const letztes = buendel[buendel.length - 1];
      if (letztes && p - letztes.max <= toleranz) {
        letztes.summe += p;
        letztes.anzahl++;
        letztes.max = p;
      } else {
        buendel.push({ summe: p, anzahl: 1, max: p });
      }
    }
    const stufen = buendel.map((b) => ({ preis: b.summe / b.anzahl, beruehrungen: b.anzahl }));
    const ausgabe = (s) => ({ preis: runden(s.preis), beruehrungen: s.beruehrungen, abstand_prozent: runden(((s.preis - kurs) / kurs) * 100) });
    return {
      unterstuetzungen: stufen.filter((s) => s.preis < kurs).sort((a, b) => b.preis - a.preis).slice(0, EINORDNUNG.srAnzahl).map(ausgabe),
      widerstaende: stufen.filter((s) => s.preis > kurs).sort((a, b) => a.preis - b.preis).slice(0, EINORDNUNG.srAnzahl).map(ausgabe),
    };
  }

  // Ergebnis: { verfuegbar: false, grund } oder die Einordnung der letzten abgeschlossenen Kerze; Teile, für die die Kerzen
  // nicht reichen, tragen einen eigenen Grund (nie ein scheinbar gültiger Wert)
  function einordnungBerechnen(daten) {
    const kerzen = daten && daten.kerzen;
    const fehler = kerzenFehler(kerzen);
    if (fehler) return { verfuegbar: false, grund: fehler };
    // Letzte abgeschlossene Kerze: wie im Worker (zusammenfassung.zeit); eine laufende Kerze wird nicht eingeordnet
    const z = daten.zusammenfassung;
    const i = z && Number.isSafeInteger(z.zeit) ? kerzen.findIndex((k) => k.t === z.zeit) : -1;
    if (i < 0) return { verfuegbar: false, grund: "der Zeitpunkt der letzten abgeschlossenen Kerze fehlt in der Antwort" };
    const ind = daten.indikatoren || {};
    const reihe = (r) => (Array.isArray(r) && r.length === kerzen.length && r.every((x) => x === null || (typeof x === "number" && Number.isFinite(x))) ? r : null);
    const ema50 = reihe(ind.ema50);
    const ema200 = reihe(ind.ema200);
    const trend = ema50 && ema200
      ? trendBestimmen(kerzen, ema50, ema200, i)
      : { richtung: "unklar", text: "EMA 50/200 fehlen oder sind ungültig.", ema50_steigung_prozent: null };
    trend.grund = !(ema50 && ema200) ? "EMA 50/200 fehlen in der Antwort oder sind ungültig"
      : trend.richtung === "unklar" ? "zu wenige Kerzen für eine Trendeinordnung (EMA 50 und ihr Verlauf über 10 Kerzen nötig)" : null;
    const atr = atrBerechnen(kerzen, EINORDNUNG.atrPeriode)[i];
    // Ein Hoch/Tief braucht je 3 Kerzen davor und danach: unter 7 abgeschlossenen Kerzen gibt es keine Aussage
    const genugFuerStufen = i - EINORDNUNG.swingFenster >= EINORDNUNG.swingFenster;
    return {
      verfuegbar: true,
      zeit: kerzen[i].t,
      kerzen: i + 1,
      trend,
      atr14: atr === null ? null : { wert: runden(atr), prozent: runden((atr / kerzen[i].c) * 100) },
      atrGrund: atr === null ? `mindestens ${EINORDNUNG.atrPeriode + 1} abgeschlossene Kerzen nötig` : null,
      stufen: genugFuerStufen ? unterstuetzungWiderstand(kerzen, atr, i) : null,
      stufenGrund: genugFuerStufen ? null : `mindestens ${2 * EINORDNUNG.swingFenster + 1} abgeschlossene Kerzen nötig`,
    };
  }

  // Reihe aus dem Worker in Chartpunkte umwandeln; Stellen ohne Wert (null) entfallen
  function punkte(kerzen, werte) {
    const ergebnis = [];
    for (let i = 0; i < kerzen.length; i++) {
      if (werte[i] !== null && werte[i] !== undefined) {
        ergebnis.push({ time: kerzen[i].t / 1000, value: werte[i] });
      }
    }
    return ergebnis;
  }

  function chartFuellen(daten, neueAuswahl) {
    if (!zustand.chart) {
      chartErstellen();
    }
    const s = zustand.serien;
    const k = daten.kerzen;
    const ind = daten.indikatoren;
    const transparent = (farbe) => farbe + "80";

    s.kerzen.setData(k.map((x) => ({ time: x.t / 1000, open: x.o, high: x.h, low: x.l, close: x.c })));
    s.ema20.setData(punkte(k, ind.ema20));
    s.ema50.setData(punkte(k, ind.ema50));
    s.ema200.setData(punkte(k, ind.ema200));
    s.volumen.setData(k.map((x) => ({
      time: x.t / 1000,
      value: x.v,
      color: transparent(x.c >= x.o ? FARBEN.steigend : FARBEN.fallend),
    })));
    s.rsi.setData(punkte(k, ind.rsi14));
    s.macd.setData(punkte(k, ind.macd.linie));
    s.signal.setData(punkte(k, ind.macd.signal));
    s.macdHistogramm.setData(punkte(k, ind.macd.histogramm).map((p) => ({
      ...p,
      color: transparent(p.value >= 0 ? FARBEN.steigend : FARBEN.fallend),
    })));

    // Einordnung immer lokal aus den angezeigten Kerzen (eine Einordnung im Worker-Ergebnis wird nicht verwendet)
    zustand.einordnung = einordnungBerechnen(daten);
    stufenZeichnen(zustand.einordnung.verfuegbar ? zustand.einordnung.stufen : null);

    // Bei neuem Paar oder Intervall die letzten Kerzen zeigen, sonst Zoom und Position des Nutzers behalten
    if (neueAuswahl) {
      zustand.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, k.length - SICHTBARE_KERZEN), to: k.length + 2 });
    }
  }

  // Unterstützungen (grün) und Widerstände (rot) als gepunktete Linien im Kurschart
  function stufenZeichnen(einordnung) {
    const serie = zustand.serien.kerzen;
    for (const linie of zustand.stufen) serie.removePriceLine(linie);
    zustand.stufen = [];
    if (!einordnung) return;
    const LWC = window.LightweightCharts;
    const zeichnen = (liste, farbe, kuerzel) => {
      for (const s of liste || []) {
        zustand.stufen.push(serie.createPriceLine({
          price: s.preis, color: farbe, lineWidth: 1, lineStyle: LWC.LineStyle.Dotted, axisLabelVisible: true, title: kuerzel,
        }));
      }
    };
    zeichnen(einordnung.unterstuetzungen, FARBEN.steigend, "U");
    zeichnen(einordnung.widerstaende, FARBEN.fallend, "W");
  }

  function seriendatenLeeren() {
    if (!zustand.serien) return;
    for (const serie of Object.values(zustand.serien)) {
      serie.setData([]);
    }
    stufenZeichnen(null);
  }

  function zusammenfassungText(daten) {
    const z = daten.zusammenfassung;
    const lage = (wert, name) => (wert === null ? `${name}: nicht berechenbar` : `${wert ? "über" : "unter"} ${name}`);
    const zeilen = z ? [
      `Letzte abgeschlossene Kerze: ${zeitpunkt(z.zeit / 1000)} · Schluss ${zahl(z.schlusskurs, 2)} USDT`,
      `Kurs ${lage(z.kurs_ueber_ema.ema20, "EMA 20")} · ${lage(z.kurs_ueber_ema.ema50, "EMA 50")} · ${lage(z.kurs_ueber_ema.ema200, "EMA 200")}`,
      z.rsi14 === null ? "RSI 14: nicht berechenbar" : `RSI 14: ${zahl(z.rsi14, 1)} (${z.rsi_zone})`,
      z.macd.lage === null ? "MACD: nicht berechenbar" : `MACD: ${zahl(z.macd.linie, 2)} · Signal ${zahl(z.macd.signal, 2)} (${z.macd.lage})`,
      z.volumen.verhaeltnis === null ? "Volumen: nicht berechenbar" : `Volumen: ${zahl(z.volumen.verhaeltnis, 2)}× Durchschnitt der letzten 20 Kerzen (${z.volumen.einordnung})`,
    ] : [];
    return zeilen.concat(einordnungZeilen(zustand.einordnung || einordnungBerechnen(daten))).join("\n");
  }

  // Eigener, gekennzeichneter Block – getrennt von den Worker-Kennzahlen oben und von der KI-Analyse
  function einordnungZeilen(e) {
    const kopf = "Einordnung – lokal im Dashboard aus den Kurskerzen berechnet (regelbasiert, keine KI, kein Handelssignal)";
    if (!e.verfuegbar) return ["", kopf + ": nicht verfügbar – " + e.grund + "."];
    const stufen = (liste) => (liste.length
      ? liste.map((s) => `${zahl(s.preis, 2)} (${s.beruehrungen}×, ${s.abstand_prozent > 0 ? "+" : ""}${zahl(s.abstand_prozent, 1)} %)`).join(" · ")
      : "keine im angezeigten Bereich");
    return [
      "",
      `${kopf}, Grundlage: ${e.kerzen} angezeigte Kerzen bis ${zeitpunkt(e.zeit / 1000)}:`,
      "Trend: " + (e.trend.grund ? "nicht verfügbar – " + e.trend.grund : e.trend.text),
      "Unterstützungen: " + (e.stufen ? stufen(e.stufen.unterstuetzungen) : "nicht verfügbar – " + e.stufenGrund),
      "Widerstände: " + (e.stufen ? stufen(e.stufen.widerstaende) : "nicht verfügbar – " + e.stufenGrund),
      e.atr14 ? `Schwankungsbreite (ATR 14): ${zahl(e.atr14.wert, 2)} USDT ≈ ${zahl(e.atr14.prozent, 2)} % je Kerze`
        : "Schwankungsbreite (ATR 14): nicht verfügbar – " + e.atrGrund,
      "Nur die angezeigten Kerzen zählen: Werte am linken Rand und die ATR können leicht von anderen Plattformen abweichen.",
      ERKLAERUNG,
    ];
  }

  function hinweiseAnzeigen(hinweise) {
    const liste = element("analyse-hinweise");
    // Texte kommen vom Worker (teils von externen Quellen) und werden nur als Text eingefügt, nie als HTML
    liste.replaceChildren(...(hinweise || []).map((text) => {
      const li = document.createElement("li");
      li.textContent = "⚠ " + text;
      return li;
    }));
  }

  function statusSetzen(text, farbe) {
    const feld = element("analyse-status");
    feld.textContent = text;
    feld.style.color = farbe || "";
  }

  async function analyseLaden(optionen) {
    const erzwingen = Boolean(optionen && optionen.erzwingen);
    if (!verbunden()) {
      statusSetzen("Bitte zuerst im Cockpit die Verbindung einrichten.");
      return;
    }
    const symbol = element("analyse-symbol").value;
    const intervall = element("analyse-intervall").value;
    const schluessel = symbol + "|" + intervall;
    const neueAuswahl = schluessel !== zustand.schluessel;
    if (zustand.laedt || (!erzwingen && !neueAuswahl && Date.now() - zustand.geladenAm < ZWISCHENSPEICHER_MS)) {
      return;
    }

    zustand.laedt = true;
    element("analyse-aktualisieren").disabled = true;
    statusSetzen("Lade Marktdaten …");
    try {
      const daten = await workerAnfrage(
        "/kerzen?symbol=" + encodeURIComponent(symbol) + "&intervall=" + encodeURIComponent(intervall) + "&anzahl=300",
        { method: "GET" },
      );
      if (!daten || !Array.isArray(daten.kerzen) || !daten.kerzen.length || !daten.indikatoren) {
        throw new Error("Unvollständige Antwort des Workers.");
      }
      // ab 11-02q: widersprüchliche Kerzen weder zeichnen noch einordnen (gleiche Regeln wie die Prüfung im Worker)
      const ungueltig = kerzenFehler(daten.kerzen);
      if (ungueltig) throw new Error("Ungültige Kursdaten: " + ungueltig + ".");
      chartFuellen(daten, neueAuswahl);
      // Eine KI-Analyse gilt nur für Paar und Intervall, für die sie angefordert wurde
      if (neueAuswahl) element("ki-analyse-text").textContent = "";
      if (!zustand.analyseStatusGeladen) {
        zustand.analyseStatusGeladen = true;
        analyseStatusLaden();
      }
      // Für die Kursverlauf-Kachel im Cockpit (dieselben echten Daten, keine eigene Anfrage)
      window.dispatchEvent(new CustomEvent("jarvis-kerzen", { detail: daten }));
      zustand.schluessel = schluessel;
      zustand.geladenAm = Date.now();
      zustand.zusammenfassung = daten.zusammenfassung || null;
      const ersatz = daten.quelle_name && daten.quelle_name !== "Binance" ? " (Ersatzquelle)" : "";
      statusSetzen(`${daten.symbol} · ${daten.intervall} · Quelle: ${daten.quelle_name || daten.quelle}${ersatz} · `
        + `${daten.kerzen.length} Kerzen · Stand ${new Date(daten.abgerufen).toLocaleTimeString("de-DE")}`, "#7affc4");
      element("analyse-zusammenfassung").textContent = zusammenfassungText(daten);
      hinweiseAnzeigen(daten.hinweise);
    } catch (e) {
      const zusatz = e.message === "Unbekannter Endpunkt."
        ? " Der veröffentlichte Worker kennt /kerzen noch nicht – bitte den neuen Worker-Code in Cloudflare übernehmen."
        : "";
      // Bleibt der bisherige Chart stehen (gleiche Auswahl), klar sagen, von wann er stammt
      const alterStand = !neueAuswahl && zustand.geladenAm
        ? " Angezeigt bleibt der letzte Stand von " + new Date(zustand.geladenAm).toLocaleTimeString("de-DE") + "."
        : "";
      statusSetzen("Marktdaten nicht abrufbar: " + e.message + zusatz + alterStand, "#ff9b9b");
      if (neueAuswahl) {
        // Nie Daten eines anderen Paares oder Intervalls unter der neuen Auswahl stehen lassen
        seriendatenLeeren();
        window.dispatchEvent(new CustomEvent("jarvis-kerzen", { detail: null }));
        zustand.schluessel = "";
        zustand.zusammenfassung = null;
        zustand.einordnung = null;
        element("analyse-zusammenfassung").textContent = "";
        hinweiseAnzeigen([]);
      }
    } finally {
      zustand.laedt = false;
      element("analyse-aktualisieren").disabled = false;
      // Wurde die Auswahl während des Ladens geändert, die neue Auswahl nachladen
      if (element("analyse-symbol").value + "|" + element("analyse-intervall").value !== schluessel) {
        setTimeout(analyseLaden, 0);
      }
    }
  }

  // ---------- KI-Analyse nur auf ausdrückliche Anfrage (kostenpflichtig, Tageslimit im Worker) ----------
  function zaehlerZeigen(heute, limit, grund) {
    element("ki-analyse-zaehler").textContent = (heute === null || heute === undefined
      ? "Heute: unbekannt"
      : `Heute ${heute} von ${limit} KI-Analysen genutzt`) + (grund ? " · " + grund : "");
  }

  // Kennzahlen für POST /analyse – nur Zahlen der angezeigten /kerzen-Zusammenfassung (der Worker prüft sie streng)
  function kiKennzahlen(z) {
    return { zeit: z.zeit, schlusskurs: z.schlusskurs, ema20: z.ema20, ema50: z.ema50, ema200: z.ema200, rsi14: z.rsi14,
      macd_linie: z.macd ? z.macd.linie : null, macd_signal: z.macd ? z.macd.signal : null, macd_histogramm: z.macd ? z.macd.histogramm : null,
      volumen_verhaeltnis: z.volumen ? z.volumen.verhaeltnis : null };
  }

  // Worker ohne KI-Analyse (vor 2026-10-30e: /analyse antwortet mit 404): Knopf sperren statt Fehler zeigen
  function kiAnalyseFehlt() {
    element("ki-analyse-zaehler").textContent = "KI-Analyse ist im verbundenen Worker nicht enthalten.";
    element("ki-analyse-knopf").disabled = true;
  }

  async function analyseStatusLaden() {
    if (!verbunden()) return;
    try {
      const s = await workerAnfrage("/analyse/status", { method: "GET" });
      zaehlerZeigen(s.heute, s.limit, s.grund);
      element("ki-analyse-knopf").disabled = false;
    } catch (e) {
      if (e.message === "Unbekannter Endpunkt.") {
        kiAnalyseFehlt();
        return;
      }
      element("ki-analyse-zaehler").textContent = "Zähler nicht abrufbar: " + e.message;
    }
  }

  async function kiAnalyseAnfordern() {
    const knopf = element("ki-analyse-knopf");
    const feld = element("ki-analyse-text");
    if (!verbunden()) {
      feld.textContent = "Bitte zuerst die Verbindung einrichten.";
      return;
    }
    const symbol = element("analyse-symbol").value;
    const intervall = element("analyse-intervall").value;
    // Grundlage = Kennzahlen genau dieser Auswahl und höchstens 5 Minuten alt; sonst erst (kostenlos) neu laden
    const aktuell = () => zustand.zusammenfassung && zustand.schluessel === symbol + "|" + intervall && Date.now() - zustand.geladenAm <= KI_DATEN_MAX_ALTER_MS;
    if (!aktuell()) {
      feld.textContent = "Lade aktuelle Marktdaten für die KI-Analyse …";
      await analyseLaden({ erzwingen: true });
      if (!aktuell()) {
        feld.textContent = "KI-Analyse nicht angefordert: Keine aktuellen Kennzahlen für " + symbol + " · " + intervall + " (siehe Status oben).";
        return;
      }
    }
    const kennzahlen = kiKennzahlen(zustand.zusammenfassung);
    const bestaetigt = window.confirm(`KI-Analyse für ${symbol} · ${intervall} anfordern?\n\n`
      + "Das ist eine kostenpflichtige Claude-Anfrage (geschätzt ca. 0,04 Cent), höchstens 20 pro Tag.\n"
      + "Die Antwort ist eine Erklärung der Kennzahlen, kein Handelssignal.");
    if (!bestaetigt) {
      feld.textContent = "KI-Analyse nicht angefordert.";
      return;
    }
    knopf.disabled = true;
    feld.textContent = "JARVIS analysiert die Kennzahlen …";
    try {
      const d = await workerAnfrage("/analyse", { method: "POST", body: JSON.stringify({ symbol, intervall, bestaetigt: true, kennzahlen }) });
      if (!d || typeof d.analyse !== "string" || !d.analyse.trim()) throw new Error("Ungültige Antwort des Workers (keine Analyse enthalten).");
      // Ergebnis immer dem angefragten Paar/Intervall zuordnen – die Auswahl kann sich währenddessen geändert haben
      const jetzt = element("analyse-symbol").value + "|" + element("analyse-intervall").value;
      const kopf = `KI-Analyse ${symbol} · ${intervall} (Kerze ${zeitpunkt(kennzahlen.zeit / 1000)})`
        + (jetzt !== symbol + "|" + intervall ? " – gilt nicht für die aktuelle Auswahl " + jetzt.replace("|", " · ") : "");
      // Nur als Text einfügen, nie als HTML
      feld.textContent = kopf + ":\n" + d.analyse + "\n\n" + (d.hinweis || "Keine Anlageberatung und kein Handelssignal.");
      zaehlerZeigen(d.heute, d.limit);
    } catch (e) {
      feld.textContent = "KI-Analyse nicht möglich: " + e.message;
      if (e.message === "Unbekannter Endpunkt.") {
        kiAnalyseFehlt();
        return;
      }
      analyseStatusLaden();
    }
    knopf.disabled = false;
  }

  element("ki-analyse-knopf").addEventListener("click", kiAnalyseAnfordern);
  element("analyse-symbol").addEventListener("change", () => analyseLaden());
  element("analyse-intervall").addEventListener("change", () => analyseLaden());
  element("analyse-aktualisieren").addEventListener("click", () => analyseLaden({ erzwingen: true }));

  window.analyseLaden = analyseLaden;
  // Nur für die lokalen Tests: lesender Zugriff auf das Chart-Objekt
  window.analyseIntern = { chart: () => zustand.chart, stufen: () => zustand.stufen.length, einordnung: () => zustand.einordnung };
  // Reine Rechnung für die lokalen Vergleichstests mit worker/src (keine Anfrage, kein Zustand)
  window.AnalyseEinordnung = { berechnen: einordnungBerechnen, kerzenFehler, ERKLAERUNG };

  analyseLaden();
  setInterval(function () {
    if (verbunden() && document.visibilityState === "visible") analyseLaden();
  }, AKTUALISIEREN_MS);
})();
