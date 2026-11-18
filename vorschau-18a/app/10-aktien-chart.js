// JARVIS Dashboard – Modul „aktien-chart“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).
// ---------- Kurschart der Aktienanalyse (ab 11-02s) ----------
// Zeichnet nur die Tageskerzen genau dieser Analyse (dieselben, die auch die Einordnung prüft) und die Unterstützungen/Widerstände
// aus ablaufEinordnung – keine eigene Rechnung, keine Anfrage. Bibliothek: die lokale Lightweight Charts (wie Reiter „Analyse“).
// Der Chart im Reiter „Analyse“ ist an dessen Auswahl und Worker-Daten gebunden und wird deshalb nicht wiederverwendet.
// wasserzeichen (ab 11-02t): Text im Chart nur bei synthetischen Daten; ohlcStandard: Text ohne Kerze unter Maus/Finger
const ABLAUF_CHART = { chart: null, serie: null, linien: [], wasserzeichen: null, ohlcStandard: "Zeige mit Maus oder Finger auf eine Kerze: hier erscheinen Datum, Eröffnung, Hoch, Tief und Schluss.", minKerzen: 5, farben: { steigend: "#7affc4", fallend: "#ff6b6b", text: "#9fc7d6", raster: "#0c2a44", hintergrund: "#071a2d" } };
function ablaufChartLeeren(grund) {
  // ab 11-13q: den zuletzt gezeichneten Lauf vergessen – sonst zeichnete der Indikator-Schalter nach einem Fehler den alten Chart neu
  ABLAUF_CHART.letzte = null;
  const regler = ablaufEl("ablauf-chart-kerze"); // ab 11-13r: Tastaturwahl der Kerze sperren
  if (regler) { regler.disabled = true; regler.max = "0"; regler.value = "0"; regler.removeAttribute("aria-valuetext"); }
  if (ABLAUF_CHART.serie) {
    for (const l of ABLAUF_CHART.linien) ABLAUF_CHART.serie.removePriceLine(l);
    ABLAUF_CHART.linien = [];
    ABLAUF_CHART.serie.setData([]);
  }
  // ab 11-06i: auch die Indikatorlinien leeren – sonst blieben Linien eines vorigen Symbols stehen
  if (ABLAUF_CHART.indikatoren) for (const s of Object.values(ABLAUF_CHART.indikatoren)) s.setData([]);
  ABLAUF_CHART.indikatorPunkte = 0;
  if (ABLAUF_CHART.wasserzeichen) { ABLAUF_CHART.wasserzeichen.detach(); ABLAUF_CHART.wasserzeichen = null; }
  ablaufEl("ablauf-chart-ohlc").textContent = "";
  ablaufEl("ablauf-chart-bereich").hidden = true;
  ablaufEl("ablauf-chart-titel").textContent = "";
  ablaufEl("ablauf-chart-text").textContent = "";
  ablaufEl("ablauf-chart-hinweis").hidden = false;
  ablaufEl("ablauf-chart-hinweis").textContent = "Kein Chart – " + grund;
  ablaufEl("ablauf-chartlage").textContent = "Keine Chartlage – " + grund; // ab 11-07j: nie eine Lage aus einem früheren Lauf stehen lassen
}
// Linienbeschriftung je nach Breite: lang oder „U“/„W“ (beide Formen werden auf die jeweils passende umgestellt)
function ablaufLinienTitel(art) {
  const lang = { U: "Unterstützung", W: "Widerstand" }[art] || art;
  return ablaufEl("ablauf-chart").clientWidth > 0 && ablaufEl("ablauf-chart").clientWidth < 480 ? lang.charAt(0) : lang;
}
// Erklärung der Kurzform im Text unter dem Chart, nur wenn sie gerade verwendet wird
function ablaufChartLegende() {
  const text = ablaufEl("ablauf-chart-text");
  const basis = text.textContent.replace(/ ?Im Chart: U = Unterstützung, W = Widerstand\.$/, "");
  const kurz = ABLAUF_CHART.linien.some((l) => l.options().title.length === 1);
  text.textContent = basis + (kurz ? " Im Chart: U = Unterstützung, W = Widerstand." : "");
}
// ab 11-06i: Indikatorlinien ein-/ausblenden zeichnet den letzten Chart neu (keine Anfrage)
document.getElementById("ablauf-indikatoren").addEventListener("change", () => { if (ABLAUF_CHART.letzte) ablaufChartZeigen(...ABLAUF_CHART.letzte); });
// ab 11-13r: Kerzenwerte per Tastatur – derselbe Text wie unter Maus/Finger, nur aus den gezeichneten Kerzen, nichts berechnet
function ablaufKerzeText(k) {
  const z2 = (x) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Kerze vom ${new Date(k.t).toISOString().slice(0, 10)}: Eröffnung ${z2(k.o)} · Hoch ${z2(k.h)} · Tief ${z2(k.l)} · Schluss ${z2(k.c)}`;
}
function ablaufKerzeWaehlen(i) {
  const kerzen = ABLAUF_CHART.letzte && ABLAUF_CHART.letzte[1] && ABLAUF_CHART.letzte[1].kerzen, regler = ablaufEl("ablauf-chart-kerze");
  if (!regler || !Array.isArray(kerzen) || !kerzen[i]) return null;
  const k = kerzen[i], text = ablaufKerzeText(k);
  ablaufEl("ablauf-chart-ohlc").textContent = text;
  regler.setAttribute("aria-valuetext", text);
  try { if (ABLAUF_CHART.chart && ABLAUF_CHART.serie) ABLAUF_CHART.chart.setCrosshairPosition(k.c, Math.floor(k.t / 1000), ABLAUF_CHART.serie); } catch (e) { /* nur Hervorhebung im Chart */ }
  return text;
}
if (document.getElementById("ablauf-chart-kerze")) document.getElementById("ablauf-chart-kerze").addEventListener("input", (e) => ablaufKerzeWaehlen(Number(e.target.value)));
function ablaufChartZeigen(r, haupt, e) {
  ABLAUF_CHART.letzte = [r, haupt, e];
  const L = window.LightweightCharts, F = ABLAUF_CHART.farben;
  const n = r && r.kerzen_anzahl > 0 ? r.kerzen_anzahl : 0;
  const kerzen = haupt && Array.isArray(haupt.kerzen) ? haupt.kerzen : null;
  if (!L) return ablaufChartLeeren("die lokale Chart-Bibliothek ist nicht geladen.");
  if (!n) return ablaufChartLeeren("keine Tageskerzen geladen.");
  if (!kerzen || kerzen.length !== n) return ablaufChartLeeren("die Kerzen dieser Analyse sind nicht eindeutig zuzuordnen.");
  const fehler = window.AnalyseEinordnung ? window.AnalyseEinordnung.kerzenFehler(kerzen) : "Prüfmodul nicht geladen";
  if (fehler) return ablaufChartLeeren("ungültige Kursdaten (" + fehler + ") – nichts gezeichnet.");
  if (n < ABLAUF_CHART.minKerzen) return ablaufChartLeeren(`nur ${n} ${n === 1 ? "Tageskerze" : "Tageskerzen"} – ein lesbarer Verlauf braucht mindestens ${ABLAUF_CHART.minKerzen}.`);
  // Achsenschrift folgt der Browser-Grundschrift (die Bibliothek erwartet Pixel)
  const schrift = Math.max(12, Math.round(12 * parseFloat(getComputedStyle(document.documentElement).fontSize) / 16));
  if (!ABLAUF_CHART.chart) {
    ABLAUF_CHART.chart = L.createChart(ablaufEl("ablauf-chart"), {
      autoSize: true,
      // Hinweis auf die Bibliothek als beschrifteter Link auf die lokale NOTICE-Datei unter dem Chart (Apache 2.0 §4(d); externe
      // Verweise lässt die Upload-Prüfung nicht zu) statt als Logo-Link in der Grafik – ein fokussierbarer Link in role="img"
      // wäre für Screenreader widersprüchlich
      layout: { background: { type: L.ColorType.Solid, color: F.hintergrund }, textColor: F.text, fontSize: schrift, attributionLogo: false },
      grid: { vertLines: { color: F.raster }, horzLines: { color: F.raster } },
      rightPriceScale: { borderColor: F.raster },
      timeScale: { borderColor: F.raster, timeVisible: false },
      localization: { locale: "de-DE", timeFormatter: (s) => new Date(s * 1000).toLocaleDateString("de-DE"),
        priceFormatter: (p) => p.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
      // Nur ansehen: kein Ziehen/Zoomen per Tastatur nötig, die Seite bleibt mit der Tastatur bedienbar
      handleScroll: false, handleScale: false,
    });
    // Kein hervorgehobenes Feld „letzter Kurs“ – es sähe aus wie ein aktueller Kurs (Tagesschlusskerzen, keine Echtzeit)
    ABLAUF_CHART.serie = ABLAUF_CHART.chart.addSeries(L.CandlestickSeries, { upColor: F.steigend, downColor: F.fallend, borderVisible: false, wickUpColor: F.steigend, wickDownColor: F.fallend, priceLineVisible: false, lastValueVisible: false });
    // Datum und OHLC der Kerze unter Maus/Finger (ab 11-02t) – nur aus den gezeichneten Daten, nichts berechnet
    ABLAUF_CHART.chart.subscribeCrosshairMove((p) => {
      const d = p && p.time !== undefined && p.seriesData ? p.seriesData.get(ABLAUF_CHART.serie) : null;
      const z2 = (x) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      ablaufEl("ablauf-chart-ohlc").textContent = d && typeof p.time === "number" && [d.open, d.high, d.low, d.close].every(Number.isFinite)
        ? `Kerze vom ${new Date(p.time * 1000).toISOString().slice(0, 10)}: Eröffnung ${z2(d.open)} · Hoch ${z2(d.high)} · Tief ${z2(d.low)} · Schluss ${z2(d.close)}`
        : (ablaufEl("ablauf-chart-bereich").hidden ? "" : ABLAUF_CHART.ohlcStandard);
    });
    // Die Breite kennt die Bibliothek erst nach dem Messen (autoSize): bei jeder Größenänderung den ganzen Bereich zeigen
    // Schmal (unter 480 px) verdecken lange Linienbeschriftungen die Kerzen: dann „U“/„W“, im Text darunter erklärt
    new ResizeObserver(() => {
      if (!ABLAUF_CHART.chart) return;
      ABLAUF_CHART.chart.timeScale().fitContent();
      for (const l of ABLAUF_CHART.linien) l.applyOptions({ title: ablaufLinienTitel(l.options().title) });
      ablaufChartLegende();
    }).observe(ablaufEl("ablauf-chart"));
  } else {
    ABLAUF_CHART.chart.applyOptions({ layout: { fontSize: schrift } });
  }
  for (const l of ABLAUF_CHART.linien) ABLAUF_CHART.serie.removePriceLine(l);
  ABLAUF_CHART.linien = [];
  ABLAUF_CHART.serie.setData(kerzen.map((k) => ({ time: Math.floor(k.t / 1000), open: k.o, high: k.h, low: k.l, close: k.c })));
  // ab 11-06i: Indikatorlinien aus denselben Kerzen (AktienTechnik, keine eigene Rechnung): EMA20 und Bollinger-Bänder (20, 2σ);
  // ein-/ausblendbar, ohne letzten Wert an der Achse (kein Anschein eines aktuellen Kurses)
  const T = window.AktienTechnik, zeigen = ablaufEl("ablauf-indikatoren").checked;
  if (!ABLAUF_CHART.indikatoren && T) {
    const opt = (farbe, stil) => ({ color: farbe, lineWidth: 1, lineStyle: stil, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    ABLAUF_CHART.indikatoren = { ema20: ABLAUF_CHART.chart.addSeries(L.LineSeries, opt("#00eaff", L.LineStyle.Solid)), oben: ABLAUF_CHART.chart.addSeries(L.LineSeries, opt("#ffcc66", L.LineStyle.Dotted)), unten: ABLAUF_CHART.chart.addSeries(L.LineSeries, opt("#ffcc66", L.LineStyle.Dotted)) };
  }
  if (ABLAUF_CHART.indikatoren) {
    const sch = kerzen.map((k) => k.c), bb = T.bollinger(sch), e20 = T.ema(sch, 20);
    const reihe = (w) => kerzen.map((k, i) => (w[i] === null ? null : { time: Math.floor(k.t / 1000), value: w[i] })).filter(Boolean);
    const I = ABLAUF_CHART.indikatoren;
    I.ema20.setData(zeigen ? reihe(e20) : []); I.oben.setData(zeigen ? reihe(bb.oben) : []); I.unten.setData(zeigen ? reihe(bb.unten) : []);
    ABLAUF_CHART.indikatorPunkte = zeigen ? reihe(bb.oben).length : 0;
  }
  // Unterstützungen/Widerstände nur aus einer verfügbaren Einordnung mit endlichen Preisen; beschriftet, nicht nur farbig
  const stufen = e && e.verfuegbar && e.stufen ? e.stufen : null;
  const gezeichnet = { u: [], w: [] };
  const z = (x) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (stufen) {
    for (const [liste, art, farbe, ziel] of [[stufen.unterstuetzungen, "Unterstützung", F.steigend, gezeichnet.u], [stufen.widerstaende, "Widerstand", F.fallend, gezeichnet.w]]) {
      for (const s of liste) {
        if (!(typeof s.preis === "number" && Number.isFinite(s.preis) && s.preis > 0)) continue;
        ABLAUF_CHART.linien.push(ABLAUF_CHART.serie.createPriceLine({ price: s.preis, color: farbe, lineWidth: 1, lineStyle: L.LineStyle.Dashed, axisLabelVisible: true, title: ablaufLinienTitel(art) }));
        ziel.push(z(s.preis));
      }
    }
  }
  ABLAUF_CHART.chart.timeScale().fitContent();
  const tag = (t) => new Date(t).toISOString().slice(0, 10);
  const q = r.quelle || {};
  // ab 11-02t: synthetische Daten dauerhaft im Chartbereich selbst kennzeichnen (Wasserzeichen der lokalen Bibliothek)
  if (q.synthetisch && typeof L.createTextWatermark === "function") {
    const farbe = "rgba(255, 204, 102, 0.22)";
    const opt = { visible: true, horzAlign: "center", vertAlign: "center", lines: [{ text: "SYNTHETISCHE TESTDATEN", color: farbe, fontSize: Math.round(schrift * 1.6), fontFamily: "sans-serif", fontStyle: "bold" }, { text: "keine echten Kurse", color: farbe, fontSize: schrift, fontFamily: "sans-serif", fontStyle: "" }] };
    if (ABLAUF_CHART.wasserzeichen) ABLAUF_CHART.wasserzeichen.applyOptions(opt);
    else ABLAUF_CHART.wasserzeichen = L.createTextWatermark(ABLAUF_CHART.chart.panes()[0], opt);
  } else if (ABLAUF_CHART.wasserzeichen) { ABLAUF_CHART.wasserzeichen.detach(); ABLAUF_CHART.wasserzeichen = null; }
  ablaufEl("ablauf-chart-ohlc").textContent = ABLAUF_CHART.ohlcStandard;
  const zr = haupt.zeitraum;
  ablaufEl("ablauf-chart-titel").textContent = `${r.symbol} · ${tag(kerzen[0].t)} bis ${tag(kerzen[n - 1].t)} · ${n} Tageskerzen`
    + (zr ? ` (Zeitraum-Vorgabe ${zr.von} bis ${zr.bis})` : " (ohne Zeitraum: alle verfügbaren)")
    + ` · Quelle: ${q.name || "?"}${q.synthetisch ? " – SYNTHETISCHE TESTDATEN, keine echten Kurse" : ""}`
    + " · Tagesschlusskerzen, keine Echtzeitansicht" + (r.frisch === false ? " · VERALTET" : "") + (r.letzte_laufend ? " · die letzte Kerze läuft noch" : "");
  ablaufEl("ablauf-chart-text").textContent = "Kerzen: grün = Schluss über Eröffnung, rot = Schluss darunter. "
    + (gezeichnet.u.length || gezeichnet.w.length
      ? `Gestrichelte Linien aus der Einordnung oben (nicht neu berechnet): Unterstützung ${gezeichnet.u.join(" · ") || "keine"}; Widerstand ${gezeichnet.w.join(" · ") || "keine"}. `
      : "Keine Unterstützungs- oder Widerstandslinien: " + (!e || !e.verfuegbar ? "Einordnung nicht verfügbar" + (e && e.grund ? " (" + e.grund + ")" : "") : !e.stufen ? e.stufenGrund : "keine Stufen in diesen Kerzen") + ". ")
    + "Trend und ATR stehen als Text in der Einordnung. Kein Kauf- oder Verkaufssignal, keine Prognose.";
  ablaufChartLegende();
  ablaufEl("ablauf-chart").setAttribute("aria-label", `Kurschart ${r.symbol}: ${n} Tageskerzen vom ${tag(kerzen[0].t)} bis ${tag(kerzen[n - 1].t)}${q.synthetisch ? ", synthetische Testdaten" : ""}`);
  ablaufEl("ablauf-chart-hinweis").hidden = true;
  ablaufEl("ablauf-chart-bereich").hidden = false;
  const regler = ablaufEl("ablauf-chart-kerze");
  if (regler) { regler.max = String(n - 1); regler.value = String(n - 1); regler.disabled = false; regler.setAttribute("aria-valuetext", ablaufKerzeText(kerzen[n - 1])); }
  ablaufAusschnitt();
  ablaufChartlageZeigen(kerzen, r);
}
// ab 11-07j: Ausschnitt der Zeitachse (nur Anzeige; Indikatoren und Chartlage rechnen mit allen Kerzen)
function ablaufAusschnitt() {
  if (!ABLAUF_CHART.chart || !ABLAUF_CHART.letzte) return null;
  const haupt = ABLAUF_CHART.letzte[1], n = haupt && Array.isArray(haupt.kerzen) ? haupt.kerzen.length : 0;
  const wahl = ablaufEl("ablauf-chart-zeitraum").value, k = Number(wahl);
  const ts = ABLAUF_CHART.chart.timeScale();
  if (wahl === "alle" || !(k > 0) || k >= n) { ts.fitContent(); ABLAUF_CHART.ausschnitt = { von: 0, bis: n - 1 }; }
  else { ABLAUF_CHART.ausschnitt = { von: n - 1 - k, bis: n - 1 }; ts.setVisibleLogicalRange({ from: n - 1 - k, to: n - 1 }); }
  return ABLAUF_CHART.ausschnitt;
}
ablaufEl("ablauf-chart-zeitraum").addEventListener("change", ablaufAusschnitt);
// Neutrale Zusammenfassung, Zeitraumvergleich und Schwankung – Datenart sichtbar (synthetisch / historisch / Tageskerzen)
function ablaufChartlageZeigen(kerzen, r) {
  const box = ablaufEl("ablauf-chartlage"), T = window.AktienTechnik;
  if (!T || !T.chartAnalyse) { box.textContent = "Chartlage nicht verfügbar (Technikmodul fehlt)."; return null; }
  const q = (r && r.quelle) || {};
  const a = T.chartAnalyse(kerzen, { letzteLaufend: Boolean(r && r.letzte_laufend), jetzt: Date.now(), datenart: q.synthetisch ? "synthetisch" : r && r.frisch === false ? "historisch" : "tageskerzen" });
  if (a.fehler) { box.textContent = "Chartlage nicht verfügbar: " + a.fehler; return a; }
  const z = (x, s = 2) => (x === null || x === undefined ? "–" : Number(x).toLocaleString("de-DE", { maximumFractionDigits: s }));
  const vz = (x) => (x === null || x === undefined ? "–" : (x > 0 ? "+" : "") + z(x) + " %");
  box.replaceChildren(
    wzKnoten("p", { "data-datenart": a.datenart, text: a.lage }),
    wzKnoten("h4", { text: "Zeitraumvergleich" }),
    wzKnoten("ul", { klasse: "chart-zeitraeume" }, ...a.zeitraeume.map((t) => wzKnoten("li", { "data-kerzen": String(t.kerzen), text: t.verfuegbar ? `${t.name}: ${vz(t.veraenderung_pct)} · größter Rückgang ${vz(t.max_rueckgang_pct)} · Spanne ${z(t.tief)}–${z(t.hoch)}` : `${t.name}: nicht verfügbar (weniger als ${t.kerzen + 1} Kerzen)` }))),
    wzKnoten("div", { klasse: "klein", text: `Schwankung: ATR ${a.volatilitaet.atr_pct === null ? "–" : z(a.volatilitaet.atr_pct) + " % des Kurses"}${a.volatilitaet.einordnung ? " (" + a.volatilitaet.einordnung + ")" : ""} · Bollinger-Breite ${a.volatilitaet.bb_breite_pct === null ? "–" : z(a.volatilitaet.bb_breite_pct, 1) + " %"} · Schwankung 20 Tage ${a.volatilitaet.schwankung_20t_pa === null ? "–" : z(a.volatilitaet.schwankung_20t_pa, 1) + " % p. a."}` }),
    ...(a.widersprueche.length ? [wzKnoten("h4", { text: `Widersprüchliche Indikatoren (${a.widersprueche.length})` }), wzKnoten("ul", { "data-art": "chart-widersprueche" }, ...a.widersprueche.map((t) => wzKnoten("li", { text: t })))] : []),
    ...a.hinweise.map((h) => wzKnoten("div", { klasse: "klein", text: h })));
  return a;
}
// Was die gewählte Datenquelle ist (ab 11-02t) – direkt neben der Auswahl, damit synthetische Daten nie für echte Kurse gehalten werden
function ablaufQuelleHinweis() {
  // ab 16c: Kursdatei aus der Simulation
  if (ablaufEl("ablauf-quelle").value === "datei") { const ds = SIM.dateiDatensatz; ablaufEl("ablauf-quelle-hinweis").textContent = ds ? `Datenquelle „Lokale Kursdatei“: ${ds.symbol}, ${ds.kerzen.length} Tageskerzen bis ${new Date(ds.kerzen[ds.kerzen.length - 1].t).toISOString().slice(0, 10)} aus deiner Datei – historische Kurse laut Datei, keine Live-Kurse.${SIM.secDatei && SIM.secDatei.symbol === ds.symbol ? " SEC-Datei: " + SIM.secDatei.firma + " (nur bis zur letzten Kerze eingereicht)." : " Keine SEC-Datei zu diesem Symbol."}` : "Datenquelle „Lokale Kursdatei“: noch keine Datei eingelesen – unter Paper-Trading › Simulation › Datenquelle „Kursdatei“."; return; }
  const lokal = ablaufEl("ablauf-quelle").value !== "worker";
  const symbole = window.AktienWorkflow ? window.AktienWorkflow.testProvider().symbole.join(", ") : "–";
  ablaufEl("ablauf-quelle-hinweis").textContent = lokal
    ? `Datenquelle „Lokale Testdaten“: künstlich erzeugte (synthetische) Tageskerzen – keine echten Kurse, keine Netzverbindung, nur zum Ausprobieren. Verfügbar für: ${symbole}.`
    : "Datenquelle „Worker“: Tageskerzen von Alpaca IEX (nur eine Börse) über deine eingerichtete Worker-Verbindung; SEC-Zahlen nur mit SEC_USER_AGENT. Es wird dabei nichts gekauft oder verkauft.";
}
// Passt das Symbolfeld nicht mehr zum angezeigten Ergebnis (ab 11-02t), sichtbar sagen, wofür das Ergebnis gilt
function ablaufEingabeHinweis() {
  const L = APROFIL.letztes;
  const feld = String(ablaufEl("ablauf-symbol").value || "").trim().toUpperCase().slice(0, 12);
  const anders = Boolean(L && feld && feld !== L.kontext.symbol);
  const h = ablaufEl("ablauf-eingabe-hinweis");
  h.hidden = !anders;
  h.textContent = anders ? `Achtung: Das angezeigte Ergebnis gilt für ${L.kontext.symbol}. Für ${feld} bitte „Analysieren“ – bis dahin wird für ${feld} nichts berechnet oder vorgeschlagen.` : "";
}
// Schritte, Blockaden und Profil leeren (ab 11-02r) – mit einem sichtbaren Grund statt leerer Felder
function ablaufErgebnisLeeren(grund) {
  ablaufChartLeeren(grund);
  ablaufEl("ablauf-schritte").replaceChildren(Object.assign(document.createElement("li"), { textContent: grund }));
  ablaufEl("ablauf-blockaden").replaceChildren(Object.assign(document.createElement("li"), { textContent: grund }));
  ablaufEl("profil-zusammenfassung").textContent = "Aktienprofil nicht erstellt: " + grund;
  ablaufEl("profil-sektionen").replaceChildren();
  // ab Trader produktiv (D-1): auch Kennzahlen, Chancen/Risiken, Widersprüche und Entscheidungshilfe des vorigen Laufs nicht stehen lassen
  for (const id of ["ablauf-kennzahlen", "ablauf-chancen", "ablauf-entscheidung", "ablauf-einschaetzung"]) { const box = document.getElementById(id); if (box) box.textContent = grund; }
  ablaufEl("ablauf-widersprueche").replaceChildren(Object.assign(document.createElement("li"), { textContent: grund }));
  ablaufEl("ablauf-widersprueche-titel").textContent = "Widersprüchliche Signale";
  // ab Trader produktiv (C-12): ein offener Paper-Vorschlag galt dem verworfenen Ergebnis – nicht mehr bestätigbar
  if (APROFIL.vorschlag) { APROFIL.vorschlag = null; profilVorschlagZeigen("Paper-Vorschlag verworfen (" + grund.replace(/\.$/, "") + ") – nichts gebucht. Bitte erneut analysieren."); }
}
// Trend, Unterstützung/Widerstand, ATR 14 in der Aktienanalyse (ab 11-02r): dieselbe lokale Rechnung wie im Reiter „Analyse“
// (AnalyseEinordnung aus analyse.js), angewendet auf genau die Tageskerzen dieser Analyse; EMA 50/200 aus AktienTechnik (wie
// Chart-Scanner und Entry-Timer). Keine Anfrage. Passen Kerzen und Analyse nicht eindeutig zusammen → „nicht verfügbar“.
function ablaufEinordnung(r, haupt) {
  const E = window.AnalyseEinordnung, T = window.AktienTechnik;
  if (!E || !T) return { verfuegbar: false, grund: "Rechenmodule nicht geladen" };
  if (!(r.kerzen_anzahl > 0)) return { verfuegbar: false, grund: "keine Tageskerzen geladen" };
  const kerzen = haupt && Array.isArray(haupt.kerzen) ? haupt.kerzen : null;
  if (!kerzen || kerzen.length !== r.kerzen_anzahl) return { verfuegbar: false, grund: "die Kerzen dieser Analyse sind nicht eindeutig zuzuordnen" };
  const fehler = E.kerzenFehler(kerzen);
  if (fehler) return { verfuegbar: false, grund: fehler };
  const i = r.letzte_laufend && kerzen.length > 1 ? kerzen.length - 2 : kerzen.length - 1;
  const ind = T.indikatoren(kerzen);
  const e = E.berechnen({ kerzen, indikatoren: { ema50: ind.ema50, ema200: ind.ema200 }, zusammenfassung: { zeit: kerzen[i].t } });
  // Die Trendregel (wie worker/src) erlaubt eine Richtung ohne EMA 200 – das wird sichtbar gemacht, nicht verschwiegen
  if (e.verfuegbar) { e.ema200Fehlt = ind.ema200[i] === null; e.vonZeit = kerzen[0].t; }
  return e;
}
function ablaufEinordnungZeigen(e, quelle) {
  const li = document.createElement("li");
  li.dataset.schritt = "einordnung";
  // ab 11-02t: Herkunft der Werte ausdrücklich (synthetisch) und „keine Prognose“
  const titel = "Einordnung (lokal aus den Tageskerzen dieser Analyse berechnet, regelbasiert, keine KI)"
    + (quelle && quelle.synthetisch ? " – Berechnung aus SYNTHETISCHEN TESTDATEN, keine echten Kurse, keine Prognose" : " – Beschreibung der Vergangenheit, keine Prognose");
  const erklaerung = window.AnalyseEinordnung ? " " + window.AnalyseEinordnung.ERKLAERUNG : "";
  if (!e.verfuegbar) {
    li.dataset.status = "nicht_verfuegbar";
    li.textContent = `– ${titel}: nicht verfügbar – ${e.grund}.`;
  } else {
    const z = (x, s = 2) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: s, maximumFractionDigits: s });
    const stufen = (l) => (l.length ? l.map((s) => `${z(s.preis)} (${s.beruehrungen}×, ${s.abstand_prozent > 0 ? "+" : ""}${z(s.abstand_prozent, 1)} %)`).join(" · ") : "keine in diesen Kerzen");
    const vollstaendig = !e.trend.grund && e.stufen && e.atr14;
    li.dataset.status = vollstaendig ? "ok" : "warnung";
    // Zeitraum, aus dem alle Werte dieser Zeile stammen (ab 11-02t): erste bis letzte bewertete Kerze
    const zeitraum = Number.isFinite(e.vonZeit) ? ` vom ${new Date(e.vonZeit).toISOString().slice(0, 10)} bis ${new Date(e.zeit).toISOString().slice(0, 10)}` : "";
    li.textContent = `${vollstaendig ? "✔" : "⚠"} ${titel}, Grundlage ${e.kerzen} ${e.kerzen === 1 ? "Tageskerze" : "Tageskerzen"}${zeitraum}, letzte bewertete vom ${new Date(e.zeit).toISOString().slice(0, 10)}${vollstaendig ? "" : " – UNVOLLSTÄNDIG"}: `
      + ["Trend: " + (e.trend.grund ? "nicht verfügbar – " + e.trend.grund : e.trend.text + (e.ema200Fehlt ? " (EMA 200 mangels Kerzen nicht berechenbar – Trend nur eingeschränkt beurteilbar)" : "")),
        "Unterstützungen: " + (e.stufen ? stufen(e.stufen.unterstuetzungen) : "nicht verfügbar – " + e.stufenGrund),
        "Widerstände: " + (e.stufen ? stufen(e.stufen.widerstaende) : "nicht verfügbar – " + e.stufenGrund),
        "ATR 14: " + (e.atr14 ? `${z(e.atr14.wert)} (≈ ${z(e.atr14.prozent)} % je Tageskerze)` : "nicht verfügbar – " + e.atrGrund)].join(" · ")
      + ". Der Trend hier berücksichtigt die Steigung der EMA 50; der Chart-Scanner prüft nur die Lage von Kurs, EMA 50 und EMA 200." + erklaerung;
  }
  // Direkt hinter den Chart-Scanner (dort stehen die übrigen technischen Werte)
  const liste = ablaufEl("ablauf-schritte");
  const technik = liste.querySelector('[data-schritt="technik"]');
  if (technik) technik.after(li); else liste.append(li);
}
// Erst nach dem Laden aller Skripte: die Module (aktien/, daten/, bot/) stehen in der Seite hinter diesem Skript
document.addEventListener("DOMContentLoaded", () => {
if (window.AktienWorkflow) {
  ablaufEl("ablauf-symbole").replaceChildren(...window.AktienWorkflow.testProvider().symbole.map((s) => Object.assign(document.createElement("option"), { value: s })));
  ablaufEl("ablauf-form").addEventListener("submit", ablaufStarten);
  ablaufEl("ablauf-abbrechen").addEventListener("click", ablaufAbbrechen);
  for (const id of ["wl-symbol", "ablauf-symbol", "ablauf-von", "ablauf-bis", "sl-kapital", "sl-gebuehr", "sl-slippage", "sl-kurz", "sl-lang"]) ablaufEl(id).addEventListener("input", () => feldUngueltig(id, false));
  // ab 11-02t: Hinweise zur Datenquelle und zum Symbolfeld
  ablaufEl("ablauf-quelle").addEventListener("change", ablaufQuelleHinweis);
  ablaufEl("ablauf-symbol").addEventListener("input", ablaufEingabeHinweis);
  ablaufQuelleHinweis();
  ablaufEl("profil-vorschlag").addEventListener("click", profilVorschlagErstellen);
  ablaufEl("profil-bestaetigen").addEventListener("click", profilVorschlagBestaetigen);
  ablaufEl("profil-aktualisieren").addEventListener("click", () => ablaufStarten());
  // ab Trader-Auftrag (B-13): vom Vorschlag zur Ergebnisansicht (gleiche Ansicht, Fokus auf den Kartentitel; keine Hash-Navigation)
  ablaufEl("profil-zum-ergebnis").addEventListener("click", () => { if (typeof simLedgerZeigen === "function") simLedgerZeigen(); const t = document.getElementById("simkern-titel"); if (!t) return; t.tabIndex = -1; t.scrollIntoView({ block: "start" }); t.focus(); });
  // ab Trader produktiv (B-15): ausdrücklich verwerfen statt nur indirekt (Eingabe ändern, Symbolwechsel, Ablauf nach 15 min) – bucht nie
  ablaufEl("profil-verwerfen").addEventListener("click", () => { const offen = Boolean(APROFIL.vorschlag); if (offen && typeof paperEntscheidungMerken === "function") paperEntscheidungMerken(APROFIL.vorschlag, "Vorschlag verworfen (Nein) – nichts gebucht", "verworfen"); APROFIL.vorschlag = null; profilVorschlagZeigen(offen ? "Vorschlag verworfen – nichts gebucht." : PROFIL_OHNE_VORSCHLAG); });
  ablaufEl("wl-sortierung").addEventListener("change", wlZeigen);
  ablaufEl("wl-filter").addEventListener("input", wlZeigen);
  ablaufEl("wl-nur-analysiert").addEventListener("change", wlZeigen);
  ablaufEl("wl-vergleichen").addEventListener("click", wlVergleichZeigen);
  ablaufEl("wl-hinzu").addEventListener("click", () => { if (wlHinzufuegen(ablaufEl("wl-symbol").value, ablaufEl("wl-notiz").value)) { ablaufEl("wl-symbol").value = ""; ablaufEl("wl-notiz").value = ""; } });
  ablaufEl("wl-export").addEventListener("click", () => {
    const text = wlExportText();
    if (!text) { wlStatus("Watchlist beschädigt – kein Export."); return; }
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: "jarvis-aktien-watchlist.json" });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    wlStatus("Export erstellt (nur Symbole, Zeiten und deine Notizen – keine Konto- oder Zugangsdaten).");
  });
  ablaufEl("wl-import-knopf").addEventListener("click", () => ablaufEl("wl-import").click());
  ablaufEl("wl-import").addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    if (f.size > 100000) { wlStatus("Datei zu groß – nichts übernommen."); return; }
    wlStatus("Datei wird gelesen …");
    f.text().then(wlImportText, () => wlStatus("Datei konnte nicht gelesen werden – nichts übernommen."));
  });
  ablaufEl("wl-symbol").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); ablaufEl("wl-hinzu").click(); } });
  ablaufEl("wl-roh-sichern").addEventListener("click", wlRohSichern);
  ablaufEl("wl-reset").addEventListener("click", () => wlBestaetigen("Watchlist-Speicher zurücksetzen? Alle Einträge auf diesem Gerät werden gelöscht (vorher ggf. „Inhalt sichern“).", () => {
    try { localStorage.removeItem(WL_SCHLUESSEL); } catch (e) { wlStatus("Browserspeicher gesperrt – nicht zurückgesetzt."); return; }
    wlStatus("Watchlist zurückgesetzt.");
    wlZeigen();
  }));
  ablaufEl("wl-bestaetigung-ja").addEventListener("click", () => wlBestaetigungSchliessen(true));
  ablaufEl("wl-bestaetigung-nein").addEventListener("click", () => wlBestaetigungSchliessen(false));
  ablaufEl("wl-bestaetigung").addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); wlBestaetigungSchliessen(false); } });
  ablaufEl("ab-briefing-kurz").addEventListener("click", () => abBriefing("kurz"));
  ablaufEl("ab-briefing-lang").addEventListener("click", () => abBriefing("lang"));
  ablaufEl("ab-briefing-vorlesen").addEventListener("click", () => abBriefingVorlesen());
  ablaufEl("ab-vorlesen-pause").addEventListener("click", abVorlesenPause);
  ablaufEl("ab-vorlesen-weiter").addEventListener("click", abVorlesenWeiter);
  ablaufEl("ab-vorlesen-abbruch").addEventListener("click", abVorlesenAbbrechen);
  ablaufEl("sl-rechnen").addEventListener("click", () => slRechnen());
  ablaufEl("sl-csv-waehlen").addEventListener("click", () => ablaufEl("sl-csv-datei").click());
  ablaufEl("sl-csv-datei").addEventListener("change", (ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; slCsvDateiGewaehlt(f); });
  for (const id of ["sl-csv-symbol", "sl-csv-trenner", "sl-csv-zahlen"]) ablaufEl(id).addEventListener(id === "sl-csv-symbol" ? "input" : "change", () => { if (SL_CSV.geprueft) { SL_CSV.geprueft = null; slCsvStatus("Eingabe geändert – bitte erneut prüfen."); slCsvKnoepfe(); } feldUngueltig("sl-csv-symbol", false); });
  ablaufEl("sl-csv-pruefen").addEventListener("click", slCsvPruefen);
  ablaufEl("sl-csv-verwenden").addEventListener("click", slCsvVerwenden);
  ablaufEl("sl-csv-entfernen").addEventListener("click", slCsvEntfernen);
  ablaufEl("sl-paper").addEventListener("click", slPaperVorbereiten);
  for (const id of ["sl-kapital", "sl-gebuehr", "sl-slippage", "sl-kurz", "sl-lang"]) ablaufEl(id).addEventListener("input", () => { slZuruecksetzen(); slVorschau(); });
  wlZeigen();
  slVorschau();
  // Jede Änderung an Symbol, Richtung oder Betrag verwirft einen offenen Vorschlag (neue Bestätigung nötig)
  for (const id of ["ablauf-symbol", "profil-richtung", "profil-betrag", "ablauf-quelle", "ablauf-von", "ablauf-bis"]) ablaufEl(id).addEventListener("input", () => { if (APROFIL.vorschlag) { APROFIL.vorschlag = null; profilVorschlagZeigen("Vorschlag verworfen – Eingabe geändert. Bitte neu analysieren bzw. neu erstellen."); } });
} else {
  ablaufEl("ablauf-kopf").textContent = "⚠ Ablauf-Modul nicht geladen – Analyse nicht verfügbar.";
  ablaufEl("ablauf-start").disabled = true;
}
});

// ab Nacht 14j (BUD-01): geltende Aufteilungsregeln sichtbar – genau die Werte, mit denen AktienBudget.aufteilen ohne Worker rechnet
// (aktien/budget.js STANDARD); Abweichung vom Skill-Höchstbetrag (trader-budget/SKILL.md: 2.000 USD) offen genannt, nichts geändert
function budgetRegelnZeigen() {
  const el = document.getElementById("aktien-regeln"), S = window.AktienBudget && window.AktienBudget.STANDARD;
  if (!el) return;
  if (!S) { el.textContent = "Regeln beim Aufteilen: Budget-Planer nicht geladen – Regeln unbekannt."; return; }
  const z = (x) => Number(x).toLocaleString("de-DE");
  // ab AJ5: Skill-Profil (nur nach ausdrücklicher Wahl) mit Werten und Fundstellen aus size.py; Höchstbetrag bleibt JARVIS (E-R1)
  const weg = document.getElementById("aktien-rechenweg"), P = window.AktienBudget.SKILL_PROFIL;
  if (weg && weg.value === "skill" && P) {
    el.textContent = `Rechenweg: ${P.name} – ${P.werte.map(([n, wert, q]) => `${n} ${wert} (${q})`).join(", ")}; die Mindestorder wird erst nach der Rundung geprüft, es fällt zuerst die Aktie mit dem kleinsten Gewicht weg. Höchstbetrag je Order bleibt der JARVIS-Wert ${z(S.maxOrderUsd)} USD (deine Entscheidung E-R1; der Skill nennt 2.000 USD). Nur ein Vorschlag – keine Order, keine Anlageempfehlung. Mit eingerichtetem Worker gelten dessen Grenzen.`;
    return;
  }
  el.textContent = `Regeln beim Aufteilen ohne Worker (Standard aus aktien/budget.js): ${z(S.barreservePct)} % bleiben als Barreserve, höchstens ${z(S.maxPositionPct)} % des Budgets je Aktie, jede Order mindestens ${z(S.minOrderUsd)} und höchstens ${z(S.maxOrderUsd)} USD, Sperrliste ${S.gesperrt && S.gesperrt.length ? S.gesperrt.join(", ") : "leer"}. Mit eingerichtetem Worker gelten stattdessen dessen Grenzen.`
    + (S.maxOrderUsd !== 2000 ? ` Der Trader-Skill nennt als Höchstbetrag 2.000 USD – JARVIS verwendet ${z(S.maxOrderUsd)} USD.` : "");
}
// ab 14l (BUD-11, trader-budget/SKILL.md:70): Tabelle der Aufteilung nach „Budget aufteilen“ – dieselbe Rechnung (AktienBudget.aufteilen)
// mit denselben Eingaben und Regeln wie app/18 aktienAufteilen; nur Anzeige, keine Order. Jede Eingabeänderung entfernt die Tabelle.
function budgetTabelleZeigen() {
  const box = document.getElementById("aktien-aufteilung-tabelle"), B = window.AktienBudget;
  if (!box || !B) return;
  const { ziele, fehler, quelle: qJson } = B.zieleLesen(document.getElementById("aktien-ziele").value);
  const feldZ = document.getElementById("aktien-ziele"), quelleT = qJson || (feldZ.dataset.quelle && feldZ.dataset.zieleText === feldZ.value ? feldZ.dataset.quelle : null);
  const regeln = {};
  for (const k of ["barreservePct", "maxPositionPct", "minOrderUsd", "maxOrderUsd"]) if (typeof AKTIEN !== "undefined" && AKTIEN.grenzen && Number.isFinite(AKTIEN.grenzen[k])) regeln[k] = AKTIEN.grenzen[k];
  const weg = document.getElementById("aktien-rechenweg"), skill = weg && weg.value === "skill" && typeof B.aufteilenSkill === "function";
  if (skill && typeof budgetSkillOptionen === "function") Object.assign(regeln, budgetSkillOptionen());
  if (quelleT) regeln.quelle = quelleT;
  const r = (skill ? B.aufteilenSkill : B.aufteilen)(Number(document.getElementById("aktien-budget").value), ziele, regeln);
  if (r.fehler || fehler.length) { box.replaceChildren(); return; }
  const summeGewicht = r.positionen.reduce((s, p) => s + p.gewicht, 0), usd = (x) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD";
  const zelle = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
  const zeile = (zellen, tag = "td") => { const tr = document.createElement("tr"); tr.append(...zellen.map((t) => zelle(tag, t))); return tr; };
  // „uebersicht-tabelle“ (feste Spaltenaufteilung, Umbruch) statt „wz-tabelle“ (display:block + nowrap lief bei 320 px über – Bildschirm-Abnahme)
  const tabelle = document.createElement("table"); tabelle.className = "uebersicht-tabelle";
  tabelle.append(zelle("caption", `Aufteilung (Vorschlag, keine Order)${skill ? " nach dem Skill-Profil trader-budget (5189e79)" : ""} – Gewichte aus dem Feld „Ziele“, Regeln siehe oben`),
    Object.assign(document.createElement("thead"), {}), document.createElement("tbody"), document.createElement("tfoot"));
  // schmal genug für 320 px (Bildschirm-Abnahme): Gewicht und Anteil in einer Spalte, Dollar ganz (aufteilen rechnet in ganzen Dollar)
  tabelle.tHead.append(zeile(["Ticker", "Gewicht (Anteil)", "Dollar", "Deckel"], "th"));
  // ab 16j (BUD-S18, wie size.py:323-324): bei bekanntem Kurs (Kursspeicher der Alarme, Quelle und Stand genannt) Stückzahl auf 4 Stellen
  let kurse = null;
  try { const sp = JSON.parse(localStorage.getItem("jarvis-aktien-kursspeicher") || "null"); if (sp && sp.prices) kurse = sp; } catch (e) { kurse = null; }
  const mitKurs = [];
  for (const p of r.positionen) {
    const k = kurse && Number(kurse.prices[p.symbol]) > 0 ? Number(kurse.prices[p.symbol]) : null;
    if (k) mitKurs.push(p.symbol);
    tabelle.tBodies[0].append(zeile([p.symbol, `${p.gewicht.toLocaleString("de-DE")} (${(summeGewicht > 0 ? Math.round((p.gewicht / summeGewicht) * 10000) / 100 : 0).toLocaleString("de-DE", { maximumFractionDigits: 2 })} %)`,
      p.dollar.toLocaleString("de-DE") + " USD" + (k ? ` ≈ ${(Math.round(p.dollar / k * 10000) / 10000).toLocaleString("de-DE", { maximumFractionDigits: 4 })} Stück zu ${k.toLocaleString("de-DE")}` : ""), p.gedeckelt ? "ja" : "nein"]));
  }
  const kursZeile = mitKurs.length ? zeile([`Stückzahlen nur ungefähr: Kurse aus dem Kursspeicher (${mitKurs.join(", ")}; Stand ${String(kurse.as_of || "?").slice(0, 16).replace("T", " ")} UTC, ${kurse.source || "Quelle unbekannt"}) – Markt-Orders gehen in Dollar, nicht in Stück.`]) : null;
  tabelle.tFoot.append(zeile([`Barreserve ${usd(r.reserve)} · untätig ${usd(r.untaetig)} · Summe ${usd(r.budget)}`]));
  if (kursZeile) tabelle.tFoot.append(kursZeile);
  for (const tr of tabelle.tFoot.rows) tr.cells[0].colSpan = 4;
  // ab 14zd (BUD-S16, size.py:347-365): Begründung je Position als Liste unter der Tabelle (umbrechend, auch bei 320 px; Tabelle unverändert)
  const warum = document.createElement("ul"); warum.className = "klein"; warum.id = "aktien-aufteilung-warum"; warum.setAttribute("aria-label", "Begründung je Position");
  warum.append(...r.positionen.filter((p) => p.warum).map((p) => Object.assign(document.createElement("li"), { textContent: `${p.symbol}: ${p.warum}` })));
  box.replaceChildren(tabelle, warum);
}
document.addEventListener("DOMContentLoaded", () => {
budgetRegelnZeigen();
if (document.getElementById("aktien-plan")) {
  document.getElementById("aktien-plan").addEventListener("submit", () => setTimeout(budgetTabelleZeigen, 0));
  if (document.getElementById("aktien-rechenweg")) document.getElementById("aktien-rechenweg").addEventListener("change", () => { budgetRegelnZeigen(); const box = document.getElementById("aktien-aufteilung-tabelle"); if (box && box.firstChild) box.textContent = "Rechenweg geändert – erneut „Budget aufteilen“, die Tabelle oben gilt nicht mehr."; });
  for (const id of ["aktien-budget", "aktien-ziele"]) document.getElementById(id).addEventListener("input", () => { const box = document.getElementById("aktien-aufteilung-tabelle"); if (box && box.firstChild) box.textContent = "Eingabe geändert – erneut „Budget aufteilen“, die Tabelle oben gilt nicht mehr."; });
}
einstellungFehlerZeigen(); // ungültige gespeicherte Spracheinstellungen sichtbar melden (ab 11-02b)
if (window.PaperKern && window.JarvisDaten && window.AktienTechnik) {
  // ab 11-06c: Stand aus IndexedDB (einmalige Migration aus localStorage); bis dahin sperrt simSperrgrund das Schreiben
  SIM.arbeit = simLadenDb().then(() => { simVorschau(); simLedgerZeigen(); }).finally(() => { SIM.arbeit = null; simMigrationKnopf(); try { heuteZeigen(); } catch (e) { /* Startübersicht nur Anzeige */ } });
  simVorschau();
  simLedgerZeigen();
} else {
  simEl("sim-vorschau").textContent = "⚠ Simulationsmodule nicht geladen – Simulation nicht verfügbar.";
  simEl("sim-start").disabled = true;
}
});
document.getElementById("paper-aktualisieren").addEventListener("click", paperLaden);
document.getElementById("paper-reset").addEventListener("click", paperZuruecksetzen);

async function kurseLaden() {
  try {
    const daten = await workerAnfrage("/markt", { method: "GET" });
    letzteKurse = {};
    // Nur gültige Preise anzeigen – ein fehlender Preis würde sonst als „0 USDT“ wie ein aktueller Kurs erscheinen
    const gueltig = Array.isArray(daten.kurse) ? daten.kurse.filter((k) => k && typeof k.symbol === "string" && Number(k.preis) > 0) : [];
    if (!gueltig.length) throw new Error("Ungültige Antwort von /markt (keine gültigen Preise).");
    tabelleFuellen("kurse", gueltig.map((k) => {
      letzteKurse[k.symbol] = Number(k.preis);
      const klasse = "zahl " + (k.aenderung_prozent >= 0 ? "plus" : "minus");
      return [
        zelle(k.symbol),
        zelle(zahl(k.preis, 2) + " USDT", "zahl"),
        Number.isFinite(k.aenderung_prozent) ? zelle((k.aenderung_prozent >= 0 ? "+" : "") + zahl(k.aenderung_prozent, 2) + " %", klasse) : zelle("–", "zahl"),
      ];
    }));
    statusZeileSetzen("markt-status", "● Marktdaten: TESTNET VERBUNDEN", "#7affc4");
    knotenSetzen("knoten-markt", "ok", "Testnet verbunden");
    if (window.watchlistKurse) window.watchlistKurse(daten.kurse, Date.now());
  } catch (e) {
    letzteKurse = {}; // keine alten Kurse mehr als Grundlage für „≈ … USDT“ in der Statuszeile
    if (e.status === 410) {
      // Aktien-Stand: Krypto-Kurse sind im Worker bewusst abgeschaltet – kein Fehler, sondern ein Zustand
      if (window.watchlistKurse) window.watchlistKurse(null, Date.now(), "Krypto-Kurse abgeschaltet (Aktien-Stand)");
      tabelleFuellen("kurse", [[zelle("Krypto-Kurse sind im Aktien-Stand abgeschaltet.", "leer")]]);
      statusZeileSetzen("markt-status", "● Marktdaten: Krypto abgeschaltet", "");
      knotenSetzen("knoten-markt", "aus", "Krypto aus");
      return;
    }
    if (window.watchlistKurse) window.watchlistKurse(null, Date.now(), e.message);
    tabelleFuellen("kurse", [[zelle("Kurse nicht abrufbar: " + e.message, "minus")]]);
    statusZeileSetzen("markt-status", "● Marktdaten: FEHLER", "#ff9b9b");
    knotenSetzen("knoten-markt", "fehler", "Fehler");
  }
}

async function tradingStatusLaden() {
  const feld = document.getElementById("trading-zustand");
  const knopf = document.getElementById("notaus");
  try {
    const s = await workerAnfrage("/trading/status", { method: "GET", zeitlimitMs: 15000 });
    // Fail-closed wie im Worker: frei ist der Handel nur bei ausdrücklich notaus === false
    s.notaus = s.notaus !== false;
    tradingZustand = s;
    knopf.textContent = s.notaus ? "NOT-AUS AKTIV – TIPPEN ZUM AUFHEBEN" : "NOT-AUS";
    knopf.classList.toggle("aktiv", s.notaus);
    kopfHandelSetzen(s.notaus ? "gesperrt" : "frei");
    knotenSetzen("knoten-handel", s.notaus ? "fehler" : "warn", s.notaus ? "gesperrt (Not-Aus)" : "frei, nur manuell");
    handelsmodusSetzen("testnet", s.notaus ? "gesperrt" : "frei");

    // Aktien-Stand (Krypto aus): Testnet-Zähler und USDT-Limits wären irreführend – der Not-Aus gilt dann für Aktien-Paper-Orders
    const krypto = !document.body.classList.contains("krypto-aus");
    const zeilen = [
      s.notaus ? "Handel GESPERRT" + (s.notaus_grund ? " (" + s.notaus_grund + ")" : "") : "Handel freigegeben (nur manuell, jede Order einzeln)",
      "Automatik: AUS",
      ...(krypto ? [
        "Orders heute: " + s.orders_heute + " / " + s.limits.maxOrdersProTag,
        "Limits: " + s.limits.minOrderUsdt + "–" + s.limits.maxOrderUsdt + " USDT je Order, max. "
          + s.limits.maxPositionUsdt + " USDT je Position",
      ] : ["Gilt für Aktien-Paper-Orders (Alpaca). Grenzen je Order stehen in der Aktien-Karte."]),
    ];
    for (const [symbol, menge] of Object.entries(krypto ? s.positionen : {})) {
      if (!(menge > 0)) continue;
      const wert = letzteKurse[symbol] ? " (≈ " + zahl(menge * letzteKurse[symbol], 2) + " USDT)" : "";
      zeilen.push("JARVIS-Position " + symbol.replace(/USDT$/, "") + ": " + zahl(menge, 8) + wert);
    }
    // Handelswache (ab Worker 2026-11-01a): maßgeblich für Aktien-Orders; „aktiv bestätigt“ nur, wenn sie es selbst meldet
    const wtext = wacheText(s.wache);
    if (wtext) zeilen.push(wtext);
    tradingStandZeit = new Date();
    zeilen.push("Stand: " + tradingStandZeit.toLocaleTimeString("de-DE"));
    feld.textContent = zeilen.join("\n");
    // Wache eingerichtet, aber nicht erreichbar oder Zustand beschädigt: als Fehler behandeln – der Knopf darf dann nur sperren
    if (s.wache && s.wache.eingerichtet !== false && (s.wache.erreichbar === false || s.wache.beschaedigt === true)) {
      tradingZustand = { ...s, notaus: null };
      knopf.textContent = "NOT-AUS (Zustand unbekannt – Tippen sperrt)";
      knopf.classList.remove("aktiv");
      statusZeileSetzen("trading-status", "● Trading: FEHLER (Handelswache)", "#ff9b9b");
      knotenSetzen("knoten-handel", "warn", "Zustand unbekannt");
      return;
    }

    const betrag = document.getElementById("order-betrag");
    betrag.min = s.limits.minOrderUsdt;
    betrag.max = s.limits.maxOrderUsdt;
    const auswahl = document.getElementById("order-symbol");
    if ([...auswahl.options].map((o) => o.value).join() !== s.limits.symbole.join()) {
      auswahl.replaceChildren(...s.limits.symbole.map((sym) => new Option(sym, sym)));
    }

    statusZeileSetzen("trading-status",
      s.notaus ? "● Trading: NOT-AUS AKTIV" : document.body.classList.contains("krypto-aus") ? "● Trading: AKTIEN-PAPER (ALPACA) – MANUELL, AUTOMATIK AUS" : "● Trading: TESTNET – MANUELL, AUTOMATIK AUS",
      s.notaus ? "#ff9b9b" : "#7affc4");
  } catch (e) {
    // Zustand unbekannt: alten Stand verwerfen – der Not-Aus-Knopf darf dann nur sperren, nie aufheben
    tradingZustand = { notaus: null, limits: null, positionen: {} };
    knopf.textContent = "NOT-AUS (Status unbekannt – Tippen sperrt)";
    knopf.classList.remove("aktiv");
    // Kein veralteter Zustand als aktuell: nur der Zeitpunkt des letzten gültigen Stands wird genannt
    feld.textContent = "Status nicht abrufbar: " + e.message + "\nZustand unbekannt – Tippen auf den Knopf aktiviert den Not-Aus."
      + (tradingStandZeit ? "\nLetzter gültiger Stand: " + tradingStandZeit.toLocaleTimeString("de-DE") + " (veraltet)" : "");
    statusZeileSetzen("trading-status", "● Trading: FEHLER", "#ff9b9b");
    kopfHandelSetzen("unbekannt");
    knotenSetzen("knoten-handel", "warn", "Status unbekannt");
    handelsmodusSetzen("testnet", "fehler");
  }
}

async function kontoLaden() {
  try {
    const daten = await workerAnfrage("/konto", { method: "GET" });
    const wichtig = ["USDT", "BTC", "ETH"];
    const zeilen = daten.guthaben
      .filter((b) => wichtig.includes(b.asset))
      .map((b) => [
        zelle(b.asset),
        zelle(zahl(b.frei, 8), "zahl"),
        zelle(b.gesperrt > 0 ? "gesperrt: " + zahl(b.gesperrt, 8) : "", "zahl"),
      ]);
    const weitere = daten.guthaben.length - zeilen.length;
    if (weitere > 0) zeilen.push([zelle("+ " + weitere + " weitere Testnet-Coins")]);
    tabelleFuellen("guthaben", zeilen.length ? zeilen : [[zelle("Kein Guthaben gefunden.")]]);
  } catch (e) {
    tabelleFuellen("guthaben", [[zelle("Kontostand nicht abrufbar: " + e.message, "minus")]]);
  }
}

async function protokollLaden() {
  const liste = document.getElementById("protokoll");
  try {
    const daten = await workerAnfrage("/protokoll", { method: "GET" });
    liste.replaceChildren(...daten.eintraege.slice(0, 20).map((eintrag) => {
      const li = document.createElement("li");
      li.className = "p-" + eintrag.art;
      const zeit = document.createElement("span");
      zeit.className = "zeit";
      zeit.textContent = new Date(eintrag.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" });
      li.append(zeit, eintrag.text);
      return li;
    }));
    if (!daten.eintraege.length) liste.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Noch keine Einträge." }));
  } catch (e) {
    liste.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Protokoll nicht abrufbar: " + e.message, className: "p-fehler" }));
  }
}

async function orderSenden() {
  if (!verbunden()) return;
  const symbol = document.getElementById("order-symbol").value;
  const seite = document.getElementById("order-seite").value;
  const betrag = Number(document.getElementById("order-betrag").value);
  const nurPruefen = document.getElementById("order-nur-pruefen").checked;
  const ergebnis = document.getElementById("order-ergebnis");
  const knopf = document.getElementById("order-senden");
  const text = (seite === "BUY" ? "Kauf " : "Verkauf ") + symbol + " für " + betrag + " USDT";

  if (!nurPruefen && !confirm("Testnet-Order wirklich ausführen?\n\n" + text + "\n\n(Spielgeld im Binance-Testnet, kein echtes Geld)")) {
    return;
  }
  // Ausführen braucht ab Worker 2026-10-31n den Freigabecode (je Order einzeln, nicht gespeichert); „nur prüfen“ nicht
  let freigabeHeader;
  if (!nurPruefen) {
    const code = freigabecodeAbfragen("Testnet-Order " + text);
    if (!code) { ergebnis.textContent = "Abgebrochen – kein Freigabecode, nichts gesendet."; return; }
    freigabeHeader = { "x-jarvis-freigabe": code };
  }

  knopf.disabled = true;
  ergebnis.style.color = "";
  ergebnis.textContent = "Sende " + (nurPruefen ? "Prüf-Order" : "Order") + " …";
  try {
    const d = await workerAnfrage("/order", {
      method: "POST",
      ...(freigabeHeader ? { headers: freigabeHeader } : {}),
      body: JSON.stringify({ symbol, seite, betrag_usdt: betrag, nur_pruefen: nurPruefen }),
    });
    // Status ehrlich: nur FILLED ist „ausgeführt“; teilweise oder gar nicht ausgeführte Orders klar benennen
    const o = d.order || {};
    const menge = Number(o.menge) || 0;
    const basis = symbol.replace(/USDT$/, "");
    const umfang = zahl(menge, 8) + " " + basis + " für " + zahl(o.usdt, 2) + " USDT"
      + (Number(o.durchschnittspreis) > 0 ? ", Ø " + zahl(o.durchschnittspreis, 2) + " USDT" : "");
    ergebnis.style.color = d.nur_geprueft || (o.status === "FILLED" && menge > 0) ? "#7affc4" : "#ffcc66";
    ergebnis.textContent = (d.nur_geprueft
      ? "✔ Geprüft: Binance würde " + text + " annehmen (nicht ausgeführt)."
      : o.status === "FILLED" && menge > 0 ? "✔ Ausgeführt (FILLED): " + umfang
        : menge > 0 ? "⚠ Nur teilweise ausgeführt (" + o.status + "): " + umfang
          : "⚠ Von Binance nicht ausgeführt (" + (o.status || "Status unbekannt") + ") – nichts gekauft oder verkauft.")
      + (d.warnung ? "\n⚠ " + d.warnung : "");
  } catch (e) {
    ergebnis.style.color = "#ff9b9b";
    // Gesendet, aber keine Antwort (Netz/Zeitlimit): Ausgang unbekannt – nie als „nicht ausgeführt“ darstellen, nicht wiederholen
    ergebnis.textContent = !nurPruefen && e.netzwerk && !e.nichtGesendet && !e.abgebrochen
      ? "✖ Ergebnis unklar: keine Antwort vom Worker – die Testnet-Order kann ausgeführt worden sein. Bitte Konto und Protokoll prüfen und nicht erneut senden."
      : "✖ " + e.message;
  } finally {
    knopf.disabled = false;
    tradingLaden();
  }
}

// Freigabecode (ab Worker 2026-10-31n): für JEDE kritische Aktion einzeln abgefragt, mit Namen der Aktion – nie gespeichert,
// nie für eine andere Aktion wiederverwendet. Abbrechen oder leer → null (die Aktion unterbleibt).
function freigabecodeAbfragen(aktion) {
  const code = prompt("Freigabecode für: " + aktion + "\n\nGilt nur für genau diese eine Aktion und wird nicht gespeichert.");
  if (code === null) return null;
  const s = String(code).trim();
  return s ? s : null;
}

// Zustand der Handelswache in einem Satz (null = älterer Worker ohne Wache-Angabe)
function wacheText(w) {
  if (!w) return null;
  if (w.eingerichtet === false) return "Handelswache: nicht eingerichtet – Aktien-Orders sind gesperrt (Sendeerlaubnis nur von ihr).";
  if (w.erreichbar === false) return "⚠ Handelswache: nicht erreichbar – Not-Aus gilt als aktiv, keine Aktien-Order.";
  if (w.beschaedigt) return "⚠ Handelswache: Not-Aus-Zustand beschädigt – gilt als aktiv. Tippen auf den Knopf aktiviert ihn neu.";
  if (w.bekannt === false) return "Handelswache: Not-Aus noch nie gesetzt – gilt als aktiv (Grundeinstellung).";
  return w.aktiv ? "Handelswache: Not-Aus bestätigt aktiv" + (w.version ? " (Version " + w.version + ")" : "") + "." : "Handelswache: Not-Aus aus (bestätigt).";
}

let notausLaeuft = false; // verhindert, dass ein Doppelklick Dialog oder Anfrage doppelt auslöst
async function notausUmschalten() {
  if (!verbunden() || notausLaeuft) return;
  notausLaeuft = true;
  const knopf = document.getElementById("notaus");
  try {
    // Bei unbekanntem Zustand immer sperren; Aktivieren braucht keine Rückfrage und keinen Freigabecode
    const aktivieren = tradingZustand.notaus !== true;
    let header;
    if (!aktivieren) {
      if (!confirm(document.body.classList.contains("krypto-aus")
        ? "Not-Aus aufheben? Danach sind Aktien-Paper-Orders (Alpaca, Spielgeld) wieder möglich – jede nur nach deiner Freigabe genau dieser Order."
        : "Not-Aus aufheben und manuelle Testnet-Orders wieder erlauben?")) {
        return;
      }
      const code = freigabecodeAbfragen("Not-Aus aufheben");
      if (!code) { alert("Abgebrochen – der Not-Aus bleibt aktiv."); return; }
      header = { "x-jarvis-freigabe": code };
    }
    if (knopf) { knopf.disabled = true; knopf.setAttribute("aria-busy", "true"); }
    try {
      const d = await workerAnfrage("/trading/notaus", { method: "POST", body: JSON.stringify({ aktiv: aktivieren }), ...(header ? { headers: header } : {}) });
      // Aktivieren gilt erst als bestätigt, wenn die Handelswache es bestätigt (ältere Worker kennen das Feld nicht → keine Meldung)
      if (aktivieren && d && d.wache_bestaetigt === false) alert("⚠ Not-Aus NICHT bestätigt: " + (d.fehler || "Handelswache hat nicht geantwortet") + "\nBitte erneut tippen.");
      const uebergeben = d && Array.isArray(d.moeglicherweise_uebergeben) ? d.moeglicherweise_uebergeben : [];
      if (aktivieren && uebergeben.length) {
        alert("Not-Aus aktiv. Vor der Aktivierung schon an Alpaca übergeben (" + uebergeben.length + "): " + uebergeben.map((p) => p.kennung).join(", ")
          + "\nDer Not-Aus kann eine bereits übergebene Order nicht zurückholen – bitte im Alpaca-Paper-Konto unter Orders prüfen.");
      }
    } catch (e) {
      alert((aktivieren ? "⚠ Not-Aus NICHT bestätigt: " : "Not-Aus konnte nicht geändert werden: ") + e.message);
    }
    await Promise.allSettled([tradingStatusLaden(), protokollLaden()]);
  } finally {
    notausLaeuft = false;
    if (knopf) { knopf.disabled = false; knopf.removeAttribute("aria-busy"); }
  }
}

async function diagnoseStarten() {
  if (!verbunden()) return;
  const feld = document.getElementById("diagnose-ergebnis");
  const knopf = document.getElementById("diagnose-knopf");
  if (knopf.disabled) return; // läuft schon
  knopf.disabled = true;
  feld.style.color = "";
  feld.textContent = "Diagnose läuft …";
  try {
    const d = await workerAnfrage("/binance/diagnose", { method: "GET" });
    const jaNein = (wert) => (wert ? "ja" : "NEIN");
    const zeilen = [
      "Testnet: " + d.testnet,
      "Erreichbar: " + jaNein(d.erreichbar) + (d.standort_gesperrt ? " – Standort gesperrt (451)" : ""),
      "Zeitabweichung: " + (d.zeit_abweichung_ms === null ? "–" : d.zeit_abweichung_ms + " ms"),
      "Schlüssel im Worker: " + jaNein(d.schluessel_hinterlegt),
      "Konto lesbar: " + jaNein(d.konto_ok),
      "Speicher (KV): " + jaNein(d.kv_verbunden),
      ...d.meldungen.map((m) => "⚠ " + m),
    ];
    feld.style.color = d.meldungen.length ? "#ffcc66" : "#7affc4";
    feld.textContent = zeilen.join("\n");
  } catch (e) {
    feld.style.color = "#ff9b9b";
    feld.textContent = "Diagnose fehlgeschlagen: " + e.message;
  } finally {
    knopf.disabled = false;
  }
  protokollLaden();
}

tradingLaden();
// Kurse alle 30 Sekunden auffrischen, solange die Seite sichtbar ist
setInterval(function () {
  if (verbunden() && document.visibilityState === "visible" && !document.body.classList.contains("krypto-aus")) kurseLaden();
}, 30000);

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("aktien-chart");
