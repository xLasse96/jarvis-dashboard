// JARVIS – Marktanalyse im Dashboard: Kerzenchart mit EMA 20/50/200, Volumen, RSI 14 und MACD 12/26/9.
// Alle Werte berechnet der Worker (GET /kerzen); hier wird nur gezeichnet. Kein Handel, keine Schlüssel.
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
  };

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

    // Bei neuem Paar oder Intervall die letzten Kerzen zeigen, sonst Zoom und Position des Nutzers behalten
    if (neueAuswahl) {
      zustand.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, k.length - SICHTBARE_KERZEN), to: k.length + 2 });
    }
  }

  function seriendatenLeeren() {
    if (!zustand.serien) return;
    for (const serie of Object.values(zustand.serien)) {
      serie.setData([]);
    }
  }

  function zusammenfassungText(daten) {
    const z = daten.zusammenfassung;
    if (!z) return "";
    const lage = (wert, name) => (wert === null ? `${name}: nicht berechenbar` : `${wert ? "über" : "unter"} ${name}`);
    const zeilen = [
      `Letzte abgeschlossene Kerze: ${zeitpunkt(z.zeit / 1000)} · Schluss ${zahl(z.schlusskurs, 2)} USDT`,
      `Kurs ${lage(z.kurs_ueber_ema.ema20, "EMA 20")} · ${lage(z.kurs_ueber_ema.ema50, "EMA 50")} · ${lage(z.kurs_ueber_ema.ema200, "EMA 200")}`,
      z.rsi14 === null ? "RSI 14: nicht berechenbar" : `RSI 14: ${zahl(z.rsi14, 1)} (${z.rsi_zone})`,
      z.macd.lage === null ? "MACD: nicht berechenbar" : `MACD: ${zahl(z.macd.linie, 2)} · Signal ${zahl(z.macd.signal, 2)} (${z.macd.lage})`,
      z.volumen.verhaeltnis === null ? "Volumen: nicht berechenbar" : `Volumen: ${zahl(z.volumen.verhaeltnis, 2)}× Durchschnitt der letzten 20 Kerzen (${z.volumen.einordnung})`,
    ];
    return zeilen.join("\n");
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
      statusSetzen("Bitte zuerst unten die Verbindung einrichten.");
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
      chartFuellen(daten, neueAuswahl);
      zustand.schluessel = schluessel;
      zustand.geladenAm = Date.now();
      const ersatz = daten.quelle_name && daten.quelle_name !== "Binance" ? " (Ersatzquelle)" : "";
      statusSetzen(`${daten.symbol} · ${daten.intervall} · Quelle: ${daten.quelle_name || daten.quelle}${ersatz} · `
        + `${daten.kerzen.length} Kerzen · Stand ${new Date(daten.abgerufen).toLocaleTimeString("de-DE")}`, "#7affc4");
      element("analyse-zusammenfassung").textContent = zusammenfassungText(daten);
      hinweiseAnzeigen(daten.hinweise);
    } catch (e) {
      const zusatz = e.message === "Unbekannter Endpunkt."
        ? " Der veröffentlichte Worker kennt /kerzen noch nicht – bitte den neuen Worker-Code in Cloudflare übernehmen."
        : "";
      statusSetzen("Marktdaten nicht abrufbar: " + e.message + zusatz, "#ff9b9b");
      if (neueAuswahl) {
        // Nie Daten eines anderen Paares oder Intervalls unter der neuen Auswahl stehen lassen
        seriendatenLeeren();
        zustand.schluessel = "";
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

  element("analyse-symbol").addEventListener("change", () => analyseLaden());
  element("analyse-intervall").addEventListener("change", () => analyseLaden());
  element("analyse-aktualisieren").addEventListener("click", () => analyseLaden({ erzwingen: true }));

  window.analyseLaden = analyseLaden;
  // Nur für die lokalen Tests: lesender Zugriff auf das Chart-Objekt
  window.analyseIntern = { chart: () => zustand.chart };

  analyseLaden();
  setInterval(function () {
    if (verbunden() && document.visibilityState === "visible") analyseLaden();
  }, AKTUALISIEREN_MS);
})();
