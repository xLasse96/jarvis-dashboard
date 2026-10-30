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
    stufen: [], // Preislinien für Unterstützungen/Widerstände
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

    stufenZeichnen(daten.einordnung);

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
    if (!z) return "";
    const lage = (wert, name) => (wert === null ? `${name}: nicht berechenbar` : `${wert ? "über" : "unter"} ${name}`);
    const zeilen = [
      `Letzte abgeschlossene Kerze: ${zeitpunkt(z.zeit / 1000)} · Schluss ${zahl(z.schlusskurs, 2)} USDT`,
      `Kurs ${lage(z.kurs_ueber_ema.ema20, "EMA 20")} · ${lage(z.kurs_ueber_ema.ema50, "EMA 50")} · ${lage(z.kurs_ueber_ema.ema200, "EMA 200")}`,
      z.rsi14 === null ? "RSI 14: nicht berechenbar" : `RSI 14: ${zahl(z.rsi14, 1)} (${z.rsi_zone})`,
      z.macd.lage === null ? "MACD: nicht berechenbar" : `MACD: ${zahl(z.macd.linie, 2)} · Signal ${zahl(z.macd.signal, 2)} (${z.macd.lage})`,
      z.volumen.verhaeltnis === null ? "Volumen: nicht berechenbar" : `Volumen: ${zahl(z.volumen.verhaeltnis, 2)}× Durchschnitt der letzten 20 Kerzen (${z.volumen.einordnung})`,
    ];
    const e = daten.einordnung;
    if (e) {
      const stufen = (liste) => (liste && liste.length
        ? liste.map((s) => `${zahl(s.preis, 2)} (${s.beruehrungen}×, ${s.abstand_prozent > 0 ? "+" : ""}${zahl(s.abstand_prozent, 1)} %)`).join(" · ")
        : "keine im angezeigten Bereich");
      zeilen.push(
        "Trend: " + e.trend.text,
        "Unterstützungen: " + stufen(e.unterstuetzungen),
        "Widerstände: " + stufen(e.widerstaende),
        e.atr14 ? `Schwankungsbreite (ATR 14): ${zahl(e.atr14.wert, 2)} USDT ≈ ${zahl(e.atr14.prozent, 2)} % je Kerze` : "Schwankungsbreite (ATR 14): nicht berechenbar",
      );
    }
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
  window.analyseIntern = { chart: () => zustand.chart, stufen: () => zustand.stufen.length };

  analyseLaden();
  setInterval(function () {
    if (verbunden() && document.visibilityState === "visible") analyseLaden();
  }, AKTUALISIEREN_MS);
})();
