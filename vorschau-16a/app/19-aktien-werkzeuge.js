// JARVIS Dashboard – Modul „aktien-werkzeuge“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Aktien-Werkzeuge, Stufe 2 ----------
// Nur lesen und rechnen: Diese Karte ruft ausschließlich lesende Worker-Routen auf (/aktien/status, /konto, /kurse, /kerzen,
// /nachrichten, /quelle). Eine Order entsteht nur über „In die Risiko-Prüfung übernehmen“ → Karte der Stufe 1 → Freigabe je Order.
const WZ = { kerzen: new Map(), tickerListe: null, konto: null, status: null };
const WZ_TICKER = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;
const WZ_KERZEN_MAX = 50;
const WZ_ALARME = "jarvis-aktien-alarme";
const WZ_KONGRESS = "jarvis-kongress-gesehen";
const wzEl = (id) => document.getElementById(id);
const wzListe = (text, max) => [...new Set(String(text || "").toUpperCase().split(/[\s,;]+/).filter(Boolean))].slice(0, max);
const wzZahl = (x, s = 2) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? "–" : Number(x).toLocaleString("de-DE", { minimumFractionDigits: s, maximumFractionDigits: s }));
const wzTag = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "unbekannt");
const wzUhr = (ms = Date.now()) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const wzZeit = (iso) => new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function wzKnoten(tag, eigenschaften = {}, ...kinder) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(eigenschaften)) {
    if (k === "text") e.textContent = v;
    else if (k === "klasse") e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...kinder.filter((x) => x !== null && x !== undefined && x !== false));
  return e;
}
function wzLink(url, text) {
  return /^https:\/\//.test(String(url || "")) ? wzKnoten("a", { href: url, target: "_blank", rel: "noopener noreferrer", text }) : null;
}
// ab 11-03b: Fehlertexte ohne Schlüssel/Tokens (geheimnisseEntfernen), nur erste Zeile
function wzFehlerText(e) {
  // ab 15f: Zustand („nicht eingerichtet“, „nicht erreichbar“, „abgelehnt“, „keine Daten“) hinten angefügt, wenn eindeutig
  const zustand = typeof workerZustand === "function" ? workerZustand(e) : null;
  const text = e && e.message === "Unbekannter Endpunkt." ? "Der verbundene Worker kennt Stufe 2 noch nicht (älterer Stand)." : geheimnisseEntfernen(String((e && e.message) || e).split("\n")[0], { fehlertext: true }).slice(0, 300);
  return zustand ? `${text} – Zustand: ${zustand}.` : text;
}

// optionen.abbruch (ab 11-02x): AbortController des Analyselaufs
async function wzStatus({ abbruch = null } = {}) {
  WZ.status = await workerAnfrage("/aktien/status", { method: "GET", zeitlimitMs: 15000, abbruch });
  return WZ.status;
}
async function wzKerzen(symbol, anzahl = 300, { abbruch = null } = {}) {
  const schluessel = symbol + "|" + anzahl;
  const c = WZ.kerzen.get(schluessel);
  if (c && Date.now() - c.zeit < 5 * 60000) return c.daten;
  const d = await workerAnfrage(`/aktien/kerzen?symbol=${encodeURIComponent(symbol)}&intervall=1d&anzahl=${anzahl}`, { method: "GET", abbruch });
  // Abgebrochener Lauf (ab 11-02x): eine dennoch eingetroffene Antwort kommt weder in den Cache noch zum Aufrufer
  if (abbruch && abbruch.signal.aborted) throw Object.assign(new Error("Anfrage abgebrochen."), { netzwerk: true, abgebrochen: true });
  // Begrenzung (ab 11-02x): abgelaufene Einträge entfernen, höchstens WZ_KERZEN_MAX Einträge (ältester zuerst raus)
  for (const [k, e] of WZ.kerzen) if (Date.now() - e.zeit >= 5 * 60000) WZ.kerzen.delete(k);
  WZ.kerzen.delete(schluessel);
  while (WZ.kerzen.size >= WZ_KERZEN_MAX) WZ.kerzen.delete(WZ.kerzen.keys().next().value);
  WZ.kerzen.set(schluessel, { zeit: Date.now(), daten: d });
  return d;
}
// Werkzeuge im Trading-Reiter (ab 11-02x): dieselbe Kerzenprüfung wie im Analyseablauf (JarvisDaten.kerzenPruefen: ungültige Werte,
// Doppelte, Reihenfolge, Lücke über 4 Kalendertage; Kerze aus der Zukunft). Vorher rechneten die Werkzeuge direkt mit wzKerzen.
// maxAlterTage (nur Exit-Planer, dessen Vorschlag zur Risiko-Prüfung führt): ältere Kerzen → nichts berechnen. Die Antwort bleibt
// unverändert (gleiche Kerzen wie bisher), nur ungeprüfte Daten werden abgewiesen.
async function wzKerzenGeprueft(symbol, anzahl = 300, { maxAlterTage = null } = {}) {
  const d = await wzKerzen(symbol, anzahl);
  const D = window.JarvisDaten;
  const p = D.kerzenPruefen(d && d.kerzen, { intervall: "1d", kalender: "boerse" });
  if (!p.ok) throw new Error(`Kursdaten von ${symbol} ${p.fehler.code === "nicht_verfuegbar" ? "nicht verfügbar" : "ungültig"} – nichts berechnet: ${p.fehler.text}`);
  const jetzt = Date.now();
  const datenzeit = D.kerzenDatenzeit("kerzen", { daten: p.kerzen, datenzeit: p.kerzen[p.kerzen.length - 1].t + D.INTERVALLE["1d"] }, jetzt);
  const f = D.frischePruefen(datenzeit, "kerzen", jetzt, maxAlterTage > 0 ? maxAlterTage * 86400000 : null);
  if (f.fehler && f.fehler.code === "veraltet") throw new Error(`Kursdaten von ${symbol} veraltet – nichts berechnet: jüngste Tageskerze vom ${wzTag(p.kerzen[p.kerzen.length - 1].t)} (erlaubt höchstens ${maxAlterTage} Tage).`);
  if (f.fehler) throw new Error(`Kursdaten von ${symbol} widersprüchlich – nichts berechnet: ${f.fehler.text}`);
  return d;
}
// Heutige Tageskerze während der Sitzung ist unfertig (Alpaca-Tageskerzen beginnen um Mitternacht New York)
function wzLaufend(kerzen, uhr) {
  if (!uhr || !uhr.offen || !kerzen || !kerzen.length) return false;
  const beginn = window.AktienEinstieg.sitzungsBeginn(uhr.naechste_schliessung);
  return beginn !== null && kerzen[kerzen.length - 1].t >= beginn - 10 * 3600000;
}
// Binärantwort (ZIP des House Clerk); Fehler wie bei workerAnfrage
// ab 14t: optional mit Kopfzeilen (Abrufzeit/Cache des Workers) – { puffer, abgerufen, cache }
async function wzRohMitKopf(pfad) {
  if (!verbunden()) throw new Error("Bitte zuerst im Cockpit die Verbindung einrichten.");
  // ab 14zd: derselbe Schutz wie workerAnfrage – nicht sendbare Zeichen im Zugangscode benennen statt „nicht erreichbar“
  if (typeof zugangscodeProblem === "function" && zugangscodeProblem(verbindung.code)) throw Object.assign(new Error(zugangscodeProblem(verbindung.code)), { zugangscode: true });
  let a;
  try {
    a = await fetch(verbindung.url.replace(/\/+$/, "") + pfad, { headers: { "x-jarvis-zugang": verbindung.code }, signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(WORKER_ZEITLIMIT.ms) : undefined });
  } catch (e) { throw Object.assign(new Error("Worker nicht erreichbar – bitte Internetverbindung und Worker-Adresse prüfen."), { netzwerk: true }); }
  if (!a.ok) { let d = null; try { d = JSON.parse(await a.text()); } catch (e) { /* kein JSON */ } throw Object.assign(new Error(geheimnisMuster((d && d.fehler) || "Fehler " + a.status).slice(0, 500)), { status: a.status }); }
  const zeit = a.headers.get("x-jarvis-abgerufen");
  return { puffer: await a.arrayBuffer(), abgerufen: zeit && Number.isFinite(Date.parse(zeit)) ? new Date(Date.parse(zeit)).toISOString() : null, cache: a.headers.get("x-jarvis-cache") === "ja" };
}
async function wzRoh(pfad) {
  if (!verbunden()) throw new Error("Bitte zuerst im Cockpit die Verbindung einrichten.");
  if (typeof zugangscodeProblem === "function" && zugangscodeProblem(verbindung.code)) throw Object.assign(new Error(zugangscodeProblem(verbindung.code)), { zugangscode: true });
  let a;
  try {
    a = await fetch(verbindung.url.replace(/\/+$/, "") + pfad, {
      headers: { "x-jarvis-zugang": verbindung.code },
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(WORKER_ZEITLIMIT.ms) : undefined,
    });
  } catch (e) {
    throw Object.assign(new Error("Worker nicht erreichbar – bitte Internetverbindung und Worker-Adresse prüfen."), { netzwerk: true });
  }
  if (!a.ok) {
    let d = null;
    try { d = JSON.parse(await a.text()); } catch (e) { /* kein JSON */ }
    throw Object.assign(new Error(geheimnisMuster((d && d.fehler) || "Fehler " + a.status).slice(0, 500)), { status: a.status });
  }
  return a.arrayBuffer();
}
// optionen.abbruch (ab 11-02y): AbortController des Analyselaufs; nach einem Abbruch wird die Tickerliste nicht gespeichert
async function wzSecCik(symbol, { abbruch = null } = {}) {
  if (!WZ.tickerListe) {
    const liste = await workerAnfrage("/aktien/quelle?art=sec-ticker", { method: "GET", abbruch });
    if (abbruch && abbruch.signal.aborted) throw Object.assign(new Error("Anfrage abgebrochen."), { netzwerk: true, abgebrochen: true });
    WZ.tickerListe = liste;
  }
  const c = window.AktienSec.cikFuer(WZ.tickerListe, symbol);
  if (!c) throw new Error(symbol + " steht nicht in der SEC-Tickerliste.");
  return c;
}
async function wzSecMeldungenRoh(symbol) {
  const c = await wzSecCik(symbol);
  const sub = await workerAnfrage(`/aktien/quelle?art=sec-meldungen&cik=${c.cik}`, { method: "GET" });
  // ab 11-06e: Sektor aus dem SIC-Code der SEC-Stammdaten für die Risikoübersicht merken (nur diese Sitzung)
  const sektor = sub && window.AktienSec.sektorAusSic(sub.sic);
  if (sektor) { APROFIL.sektoren = APROFIL.sektoren || {}; APROFIL.sektoren[String(symbol).toUpperCase()] = sektor; }
  return { c, sub };
}

// Vorschlag in die Karte der Stufe 1: dort Risiko-Prüfung im Worker und Freigabe jeder einzelnen Order
function wzInPruefung(orders, herkunft) {
  AKTIEN.orders = orders;
  aktienEl("aktien-tickets").replaceChildren();
  aktienEl("aktien-aufteilung").textContent = "Vorschlag aus „" + herkunft + "“ (noch keine Order): " + orders.map(aktienText).join("; ");
  aktienEl("aktien-pruefen").disabled = false;
  const karte = document.querySelector(".aktien-karte");
  if (karte && karte.scrollIntoView) karte.scrollIntoView({ block: "start" });
  return aktienPruefen();
}
function wzPruefKnopf(order, herkunft) {
  const k = wzKnoten("button", { type: "button", klasse: "knopf", text: "In die Risiko-Prüfung übernehmen: " + aktienText(order) });
  k.addEventListener("click", () => wzInPruefung([order], herkunft));
  return k;
}

function wzZeigen(name) {
  for (const p of document.querySelectorAll(".wz-panel")) p.hidden = p.dataset.wz !== name;
  wzEl("wz-wahl").value = name;
  if (name === "ausstieg" && verbunden()) wzPositionenLaden();
  if (name === "alarme") wzAlarmeZeigen();
}

// ---------- Chart-Scanner ----------
async function wzScannen(ev) {
  if (ev) ev.preventDefault();
  const knopf = wzEl("wz-scan-start"), status = wzEl("wz-scan-status"), liste = wzEl("wz-scan-liste");
  if (knopf.disabled) return;
  const symbole = wzListe(wzEl("wz-scan-symbole").value, 10);
  const falsch = symbole.filter((s) => !WZ_TICKER.test(s));
  if (!symbole.length || falsch.length) { status.textContent = "Bitte 1 bis 10 US-Aktien-Ticker angeben" + (falsch.length ? " (ungültig: " + falsch.join(", ") + ")" : "") + "."; return; }
  if (!verbunden()) { status.textContent = "Bitte zuerst im Cockpit die Verbindung einrichten."; return; }
  knopf.disabled = true;
  status.textContent = "Lade Tageskerzen …";
  liste.replaceChildren();
  try {
    let uhr = null;
    try { uhr = (await wzStatus()).uhr; } catch (e) { /* ohne Uhr: letzte Kerze gilt als abgeschlossen */ }
    const fehler = [];
    const ergebnisse = [];
    for (const s of symbole) {
      try {
        const d = await wzKerzenGeprueft(s);
        // ab 11-07j: chartAnalyse = scannen + Zeitraumvergleich, Schwankung, Widersprüche und neutrale Lage (gleiche Punkte)
        const T = window.AktienTechnik, opt = { letzteLaufend: wzLaufend(d.kerzen, uhr), jetzt: Date.now() };
        ergebnisse.push({ symbol: s, ...(T.chartAnalyse ? T.chartAnalyse(d.kerzen, opt) : T.scannen(d.kerzen, opt)) });
      } catch (e) { fehler.push(s + ": " + wzFehlerText(e)); }
    }
    ergebnisse.sort((a, b) => (a.fehler ? 1 : 0) - (b.fehler ? 1 : 0) || (b.punkte || 0) - (a.punkte || 0));
    liste.replaceChildren(...ergebnisse.map((r) => {
      if (r.fehler) return wzKnoten("li", { text: r.symbol + ": " + r.fehler });
      const knopf = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "Entry-Timer für " + r.symbol });
      knopf.addEventListener("click", () => { wzEl("wz-ein-symbol").value = r.symbol; wzZeigen("einstieg"); wzEinstieg(); });
      return wzKnoten("li", { "data-symbol": r.symbol },
        wzKnoten("div", { text: `${r.symbol} · Punkte ${r.punkte > 0 ? "+" : ""}${r.punkte} · Kurs ${wzZahl(r.stand.kurs)} · RSI ${wzZahl(r.stand.rsi14, 1)} · ATR ${wzZahl(r.stand.atr14)}` }),
        r.signale.length ? wzKnoten("ul", { klasse: "gruende" }, ...r.signale.map((s) => wzKnoten("li", { text: `${s.punkte > 0 ? "+" : ""}${s.punkte} ${s.text}` }))) : wzKnoten("div", { klasse: "klein", text: "Keine Signale." }),
        // ab 11-06e: MACD und Bollinger als Einordnung ohne Punkte
        r.zusatz ? wzKnoten("div", { klasse: "klein", "data-zusatz": "1", text: `Ohne Punkte: MACD ${wzZahl(r.zusatz.macd, 3)} / Signal ${wzZahl(r.zusatz.macd_signal, 3)} · Bollinger ${wzZahl(r.zusatz.bb_unten)}–${wzZahl(r.zusatz.bb_oben)} (Breite ${wzZahl(r.zusatz.bb_breite_pct, 1)} %)` + (r.einordnung && r.einordnung.length ? " · " + r.einordnung.join(" · ") : "") }) : null,
        wzKnoten("div", { klasse: "klein", text: `Datenstand: Tageskerze vom ${wzTag(r.zeit)}${r.kerze_laufend_ausgelassen ? " (laufende Kerze ausgelassen)" : ""} · Quelle Alpaca IEX` }),
        r.lage ? wzKnoten("div", { klasse: "klein", "data-lage": "1", text: "Lage: " + r.lage + (r.zeitraeume ? " · " + r.zeitraeume.filter((t) => t.verfuegbar).map((t) => `${t.name} ${t.veraenderung_pct > 0 ? "+" : ""}${wzZahl(t.veraenderung_pct)} %`).join(", ") : "") }) : null,
        ...r.hinweise.map((h) => wzKnoten("div", { klasse: "klein", text: h })),
        knopf);
    }));
    status.textContent = `${ergebnisse.length} Werte gescannt (Tageskerzen, Alpaca IEX). ${window.AktienTechnik.HINWEIS}` + (fehler.length ? "\nNicht geladen: " + fehler.join(" · ") : "");
  } finally {
    knopf.disabled = false;
  }
}

// ---------- Entry-Timer ----------
async function wzEinstieg(ev) {
  if (ev) ev.preventDefault();
  const knopf = wzEl("wz-ein-pruefen"), aus = wzEl("wz-ein-ergebnis");
  if (knopf.disabled) return;
  const symbol = String(wzEl("wz-ein-symbol").value || "").trim().toUpperCase();
  const betrag = Number(wzEl("wz-ein-betrag").value);
  if (!WZ_TICKER.test(symbol) || !(betrag >= 5)) { aus.textContent = "Bitte einen US-Aktien-Ticker und einen Betrag ab 5 USD angeben."; return; }
  if (!verbunden()) { aus.textContent = "Bitte zuerst im Cockpit die Verbindung einrichten."; return; }
  knopf.disabled = true;
  aus.textContent = "Prüfe " + symbol + " …";
  try {
    // ab 11-06d: aktueller Einzelkurs für „jetzt“ (höchstens 20 min alt, prüft AktienEinstieg); Fehler → ohne Kurs, also nie „jetzt“
    const [st, d, ka] = await Promise.all([wzStatus(), wzKerzenGeprueft(symbol),
      workerAnfrage("/aktien/kurse?symbole=" + encodeURIComponent(symbol), { method: "GET" }).then((x) => (x && x.kurse && x.kurse[symbol]) || null, () => null)]);
    const jetzt = Date.now();
    const kursAktuell = ka && ka.preis > 0 && Number.isFinite(ka.alter_min) ? { preis: ka.preis, zeit: jetzt - ka.alter_min * 60000 } : null;
    let termin = null, terminHinweis = "Zahlentermin unbekannt (SEC nicht eingerichtet).";
    if (st.sec_konfiguriert) {
      try {
        termin = window.AktienSec.naechsteZahlenSchaetzung(window.AktienSec.meldungen((await wzSecMeldungenRoh(symbol)).sub));
        terminHinweis = termin ? `Nächste Quartalszahlen (Schätzung): um den ${termin.datum} ±${termin.unsicherheit_tage} Tage (${termin.grundlage}).` : "Kein Zahlen-8-K gefunden – Termin unbekannt.";
      } catch (e) { terminHinweis = "Zahlentermin nicht abrufbar: " + wzFehlerText(e); }
    }
    const r = window.AktienEinstieg.bewerten({ kerzen: d.kerzen, uhr: st.uhr, jetzt, zahlenTermin: termin, letzteLaufend: wzLaufend(d.kerzen, st.uhr), kursAktuell });
    if (r.fehler) { aus.textContent = r.fehler; return; }
    const kopf = { jetzt: "✔ JETZT IM RAHMEN", warten: "⏸ WARTEN", nicht: "✖ NICHT NACH PLAN" }[r.urteil];
    aus.replaceChildren(
      wzKnoten("div", { "data-urteil": r.urteil, text: `${kopf} – ${symbol} bei ${wzZahl(r.kurs)} USD (${r.kurs_quelle === "aktuell" ? `aktueller Kurs, ${r.kurs_alter_min} min alt` : "Tagesschluss – historisch, kein aktueller Kurs"}): ${r.text}` }),
      r.gruende.length ? wzKnoten("ul", { klasse: "gruende" }, ...r.gruende.map((g) => wzKnoten("li", { text: g }))) : null,
      r.erfuellt.length ? wzKnoten("div", { klasse: "klein", text: "Erfüllt: " + r.erfuellt.join(" · ") }) : null,
      r.fruehestens ? wzKnoten("div", { text: "Frühestens: " + wzZeit(r.fruehestens) + " (Ortszeit)" }) : null,
      r.zielzone ? wzKnoten("div", { klasse: "klein", text: `EMA20 ${wzZahl(r.zielzone.ema20)} · Kaufzone bis ${wzZahl(r.zielzone.bis)}` }) : null,
      // ab 11-06e: Kosten nach Gebührenannahme (nur wenn angegeben; Schätzung, keine Broker-Abrechnung)
      (() => {
        if (wzEl("wz-ein-gebuehr").value === "") return null;
        const k = window.AktienAusstieg.kostenRechnen({ einstand: r.kurs, menge: betrag / r.kurs, gebuehrPct: Number(wzEl("wz-ein-gebuehr").value), stop: NaN });
        return k && !k.fehler ? wzKnoten("div", { "data-kosten": "1", text: `Mit ${k.gebuehrPct.toLocaleString("de-DE")} % Gebühr je Seite: Kaufgebühr ca. ${wzZahl(k.kaufGebuehr)} USD für ${wzZahl(betrag)} USD · Gewinnschwelle ${wzZahl(k.gewinnschwelle)} USD (Kauf- und Verkaufsgebühr gedeckt). ${k.hinweis}` }) : wzKnoten("div", { klasse: "klein", text: (k && k.fehler) || "" });
      })(),
      wzKnoten("div", { klasse: "klein", text: terminHinweis }),
      wzKnoten("div", { klasse: "klein", text: `Datenstand: letzte Tageskerze vom ${wzTag(d.kerzen[d.kerzen.length - 1].t)} (Alpaca IEX), Börsenuhr von Alpaca, abgerufen ${wzUhr()}.` }),
      wzKnoten("div", { klasse: "klein", text: r.hinweis }),
      r.urteil === "jetzt" ? wzPruefKnopf(window.AktienEinstieg.orderVorschlag(symbol, betrag), "Entry-Timer") : null,
    );
  } catch (e) {
    aus.textContent = "Nicht möglich: " + wzFehlerText(e);
  } finally {
    knopf.disabled = false;
  }
}

// ---------- Exit-Planer ----------
async function wzPositionenLaden() {
  const sel = wzEl("wz-aus-position");
  try {
    const k = await workerAnfrage("/aktien/konto", { method: "GET" });
    WZ.konto = k;
    WZ.kontoZeit = Date.now();
    const lang = k.positionen.filter((p) => p.seite !== "short" && p.menge > 0);
    sel.replaceChildren(wzKnoten("option", { value: "", text: lang.length ? "– Position wählen –" : "keine Positionen im Paper-Konto" }),
      ...lang.map((p) => wzKnoten("option", { value: p.symbol, text: `${p.symbol} · ${p.menge} Stück · ${usdBetrag(p.wert_usd)}` })));
  } catch (e) {
    sel.replaceChildren(wzKnoten("option", { value: "", text: "Konto nicht abrufbar: " + wzFehlerText(e) }));
  }
}
function wzPositionGewaehlt() {
  const p = WZ.konto && WZ.konto.positionen.find((x) => x.symbol === wzEl("wz-aus-position").value);
  if (p && p.einstand_usd && p.menge) wzEl("wz-aus-einstand").value = (p.einstand_usd / p.menge).toFixed(2);
}
async function wzAusstieg(ev) {
  if (ev) ev.preventDefault();
  const knopf = wzEl("wz-aus-planen"), aus = wzEl("wz-aus-ergebnis");
  if (knopf.disabled) return;
  const p = WZ.konto && WZ.konto.positionen.find((x) => x.symbol === wzEl("wz-aus-position").value);
  if (!p) { aus.textContent = "Bitte eine Position aus dem Paper-Konto wählen."; return; }
  // ab 11-05f: laufenden Vorgang auch für Hilfstechnik melden (wie „Analysieren“); im finally immer entfernt
  knopf.disabled = true;
  knopf.setAttribute("aria-busy", "true");
  aus.textContent = "Berechne Plan für " + p.symbol + " …";
  try {
    // ATR nur aus geprüften, höchstens 5 Tage alten Kerzen (Grenze wie Entry-Timer) – der Plan kann zur Risiko-Prüfung führen
    // ab 11-05d: die heutige, noch laufende Tageskerze nicht bewerten (wie Scanner, Entry-Timer, Screener und Analyseablauf) – vorher
    // ging ihre unfertige Spanne in den ATR ein.
    const [d, st] = await Promise.all([wzKerzenGeprueft(p.symbol, 300, { maxAlterTage: window.AktienEinstieg.STANDARD.maxKerzenAlterTage }), wzStatus().catch(() => null)]);
    // ab 11-05e (Nutzerentscheidung zu docs/ENTSCHEIDUNGEN_OFFEN.md, Nachtrag 29 b): ohne zuverlässigen Börsenstatus kein Plan und kein
    // Vorschlag – vorher rechnete der Planer mit der womöglich unfertigen jüngsten Kerze. Zuverlässig = „offen“ als Wahrheitswert und bei
    // offener Börse eine lesbare Schlusszeit (sonst kann wzLaufend die laufende Kerze nicht erkennen).
    const uhr = st && st.uhr;
    if (!uhr || typeof uhr.offen !== "boolean" || (uhr.offen && window.AktienEinstieg.sitzungsBeginn(uhr.naechste_schliessung) === null)) {
      aus.textContent = "Börsenstatus nicht verfügbar – Exit-Plan nicht berechnet";
      return;
    }
    const laufend = wzLaufend(d.kerzen, uhr);
    const ind = window.AktienTechnik.indikatoren(d.kerzen);
    const atr = ind.atr14.slice(0, laufend ? -1 : undefined).filter((x) => x !== null).pop() || null;
    const kerzenHinweis = laufend ? "ATR aus der letzten abgeschlossenen Tageskerze – die laufende Tageskerze der heutigen Sitzung wird nicht bewertet." : "";
    const plan = window.AktienAusstieg.planen({
      symbol: p.symbol, einstand: Number(wzEl("wz-aus-einstand").value) || (p.einstand_usd / p.menge), menge: p.menge, kurs: p.kurs, atr,
      hoechstkurs: Number(wzEl("wz-aus-hoch").value) || null, tageGehalten: Number(wzEl("wz-aus-tage").value) || 0,
      erledigteZiele: wzEl("wz-aus-ziel1").checked ? [1] : [],
    }, wzEl("wz-aus-gebuehr").value === "" ? {} : { gebuehrPct: Number(wzEl("wz-aus-gebuehr").value) });
    if (plan.fehler) { aus.textContent = plan.fehler; return; }
    const alarmKnopf = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "Stop und Ziele als Alarme anlegen" });
    alarmKnopf.addEventListener("click", () => {
      const neu = [{ symbol: p.symbol, art: "stop", preis: plan.wirksamerStop, notiz: "Exit-Planer" }, ...plan.ziele.filter((z) => !z.erledigt).map((z) => ({ symbol: p.symbol, art: "ueber", preis: z.preis, notiz: `Ziel ${z.r} R` }))];
      const n = neu.filter((r) => wzAlarmAnlegenRegel(r)).length;
      alarmKnopf.textContent = n + " Alarm(e) angelegt";
      alarmKnopf.disabled = true;
    });
    aus.replaceChildren(
      wzKnoten("div", { text: `${plan.symbol}: Einstand ${wzZahl(plan.einstand)} · Kurs ${wzZahl(plan.kurs)} · Stop ${wzZahl(plan.stop)} (${plan.stopArt}) · Risiko je Aktie ${wzZahl(plan.risikoJeAktie)}` }),
      wzKnoten("div", { text: `Wirksamer Stop ${wzZahl(plan.wirksamerStop)} – ${plan.stopGrund} (Abstand ${wzZahl(plan.abstandStopPct, 1)} %)` }),
      wzKnoten("div", { text: "Ziele: " + plan.ziele.map((z) => `${z.r} R = ${wzZahl(z.preis)} (${z.anteil >= 100 ? "Rest" : z.anteil + " %"}${z.erledigt ? ", erledigt" : ""})`).join(" · ") + ` · Zeit-Stop nach ${plan.zeitStopTage} Handelstagen ohne Ziel 1` }),
      // ab 11-06e: Kosten nach Gebührenannahme (nur wenn angegeben)
      ...(plan.kosten ? [wzKnoten("div", { "data-kosten": "1", text: `Mit ${plan.kosten.gebuehrPct.toLocaleString("de-DE")} % Gebühr je Seite: Gewinnschwelle ${wzZahl(plan.kosten.gewinnschwelle)} · am wirksamen Stop netto ${wzZahl(plan.kosten.stopNettoJeAktie)} je Aktie (${wzZahl(plan.kosten.stopNettoGesamt)} gesamt) · ` + plan.kosten.ziele.map((z) => `Ziel ${z.r} R netto ${wzZahl(z.nettoJeAktie)} je Aktie`).join(" · ") }),
        wzKnoten("div", { klasse: "klein", text: plan.kosten.hinweis })] : []),
      ...plan.hinweise.map((h) => wzKnoten("div", { klasse: "klein", text: h })),
      ...(kerzenHinweis ? [wzKnoten("div", { klasse: "klein", text: kerzenHinweis })] : []),
      plan.aktionen.length
        ? wzKnoten("ul", { klasse: "wz-liste" }, ...plan.aktionen.map((a) => wzKnoten("li", { "data-art": a.art }, wzKnoten("div", { text: a.text }), a.order ? wzPruefKnopf(a.order, "Exit-Planer") : wzKnoten("div", { klasse: "klein", text: a.hinweis || "" }))))
        : wzKnoten("div", { text: "Keine Regel greift gerade – nichts zu tun." }),
      alarmKnopf,
      wzKnoten("div", { klasse: "klein", text: `Datenstand: Kurs und Bestand aus dem Alpaca-Paper-Konto, abgerufen ${WZ.kontoZeit ? wzUhr(WZ.kontoZeit) : "unbekannt"} · ATR aus Tageskerzen bis ${wzTag(d.kerzen[d.kerzen.length - (laufend ? 2 : 1)].t)} (Alpaca IEX).` }),
      wzKnoten("div", { klasse: "klein", text: plan.hinweis + " Komplettverkauf mit 0,5 % Puffer (ein kleiner Rest kann bleiben)." }),
    );
  } catch (e) {
    aus.textContent = "Nicht möglich: " + wzFehlerText(e);
  } finally {
    knopf.disabled = false;
    knopf.removeAttribute("aria-busy");
  }
}

// ---------- Historische Simulation ----------
async function wzSimulieren(ev) {
  if (ev) ev.preventDefault();
  const knopf = wzEl("wz-sim-start"), aus = wzEl("wz-sim-ergebnis");
  if (knopf.disabled) return;
  const symbol = String(wzEl("wz-sim-symbol").value || "").trim().toUpperCase();
  const slip = Number(wzEl("wz-sim-slippage").value);
  // ab 11-06i: Gebührenannahme je Seite (die Rechnung kannte sie schon, die Oberfläche nicht); leer = 0
  const gebFeld = wzEl("wz-sim-gebuehr"), geb = gebFeld && gebFeld.value !== "" ? Number(gebFeld.value) : 0;
  if (!WZ_TICKER.test(symbol) || !(slip >= 0 && slip <= 5) || !(geb >= 0 && geb <= 5)) { aus.textContent = "Bitte Ticker, Slippage (0–5 %) und Gebühr (0–5 %) angeben."; return; }
  if (!verbunden()) { aus.textContent = "Bitte zuerst im Cockpit die Verbindung einrichten."; return; }
  knopf.disabled = true;
  aus.textContent = "Lade Kursverlauf und simuliere …";
  try {
    const d = await wzKerzenGeprueft(symbol, Number(wzEl("wz-sim-anzahl").value));
    const r = window.AktienSimulation.simulieren(d.kerzen, { slippagePct: slip, gebuehrPct: geb });
    if (r.fehler) { aus.textContent = r.fehler; return; }
    aus.replaceChildren(
      wzKnoten("div", { klasse: "klein", "data-annahmen": "1", text: `Annahmen: Slippage ${wzZahl(slip)} %, Gebühr ${wzZahl(geb)} % je Seite · Gebühren gesamt ${wzZahl(r.gebuehren_usd)} USD (Spielrechnung) · historische Tageskerzen, keine Prognose` }),
      wzKnoten("div", { text: `${symbol} ${r.zeitraum.von} bis ${r.zeitraum.bis} (${r.zeitraum.handelstage} Handelstage): Regeln ${r.rendite_pct > 0 ? "+" : ""}${wzZahl(r.rendite_pct)} % · Kaufen und halten ${r.kaufen_und_halten_pct > 0 ? "+" : ""}${wzZahl(r.kaufen_und_halten_pct)} %` }),
      wzKnoten("div", { text: `${r.anzahl_trades} Trades · Trefferquote ${r.trefferquote_pct === null ? "–" : wzZahl(r.trefferquote_pct, 0) + " %"} · Ø ${wzZahl(r.durchschnitt_r)} R · größter Rückgang ${wzZahl(r.max_rueckgang_pct)} %${r.offene_position ? " · Position am Ende offen" : ""}` }),
      r.trades.length ? wzKnoten("table", { klasse: "wz-tabelle" },
        wzKnoten("tr", {}, ...["Einstieg", "Ausstieg", "Kauf", "Verkauf", "Ergebnis %", "R", "Grund"].map((x) => wzKnoten("th", { text: x }))),
        ...r.trades.slice(-12).map((t) => wzKnoten("tr", {}, ...[t.einstieg, t.ausstieg, wzZahl(t.kauf), wzZahl(t.verkauf), wzZahl(t.ergebnis_pct), wzZahl(t.r_vielfaches), t.grund].map((x) => wzKnoten("td", { text: String(x) }))))) : null,
      wzKnoten("div", { klasse: "klein", text: r.hinweis + (d.hinweise && d.hinweise.length ? " " + d.hinweise.join(" ") : "") }),
    );
  } catch (e) {
    aus.textContent = "Nicht möglich: " + wzFehlerText(e);
  } finally {
    knopf.disabled = false;
  }
}

// ---------- Preisalarme ----------
// Gespeicherte Alarme werden beim Lesen erneut geprüft; Beschädigtes wird nie verwendet, sondern gemeldet
function wzAlarmeLesen() {
  let roh = null;
  try { roh = localStorage.getItem(WZ_ALARME); } catch (e) { return { regeln: [], zustand: {}, protokoll: [], hinweis: "Alarme nicht lesbar (Browserspeicher gesperrt)." }; }
  if (!roh) return { regeln: [], zustand: {}, protokoll: [] };
  let d = null;
  try { d = JSON.parse(roh); } catch (e) { d = null; }
  // Beschädigt: nicht verwenden, NICHT überschreiben, nichts prüfen – erst nach ausdrücklichem Zurücksetzen (ab 11-01d)
  if (!d || typeof d !== "object" || !Array.isArray(d.regeln)) return { regeln: [], zustand: {}, protokoll: [], beschaedigt: true, hinweis: "Gespeicherte Alarme sind beschädigt – Alarme unbekannt, nichts wird geprüft oder überschrieben. „Alarmspeicher zurücksetzen“ löscht sie ausdrücklich." };
  const regeln = [];
  let verworfen = 0;
  for (const r of d.regeln) {
    const n = window.AktienAlarme.regelNeu(r && typeof r === "object" ? r : {});
    if (n.regel && r.id === n.regel.id && !regeln.some((x) => x.id === n.regel.id)) regeln.push(n.regel); else verworfen++;
  }
  const zp = window.AktienAlarme.zustandPruefen(d.zustand === undefined ? {} : d.zustand);
  if (!zp.ok) return { regeln, zustand: {}, protokoll: [], beschaedigt: true, hinweis: "Alarmzustand beschädigt (" + zp.grund + ") – Alarme unbekannt, nichts wird geprüft oder überschrieben. „Alarmspeicher zurücksetzen“ löscht ihn ausdrücklich." };
  const zustand = d.zustand || {};
  const protokoll = (Array.isArray(d.protokoll) ? d.protokoll : []).filter((p) => p && typeof p.text === "string" && Number.isFinite(Date.parse(p.zeit))).slice(0, 30);
  return { regeln, zustand, protokoll, ...(verworfen ? { hinweis: `${verworfen} ungültige gespeicherte Alarmregel(n) verworfen.` } : {}) };
}
function wzAlarmeSchreiben(d) {
  if (d && d.beschaedigt) { wzEl("wz-al-status").textContent = "Alarmspeicher beschädigt – nichts geändert. Erst ausdrücklich zurücksetzen."; return false; }
  try { localStorage.setItem(WZ_ALARME, JSON.stringify(d)); } catch (e) { wzEl("wz-al-status").textContent = "Alarme konnten auf diesem Gerät nicht gespeichert werden."; return false; }
  return true;
}
function wzAlarmAnlegenRegel(eingabe) {
  const r = window.AktienAlarme.regelNeu(eingabe);
  if (r.fehler) { wzEl("wz-al-status").textContent = r.fehler; return false; }
  const d = wzAlarmeLesen();
  if (d.beschaedigt) { wzEl("wz-al-status").textContent = d.hinweis; return false; }
  // Bearbeiten: die alte Regel (samt Zustand) wird ersetzt; ab 15f an derselben Listenstelle
  let stelle = -1;
  if (WZ.alarmBearbeiten) {
    stelle = d.regeln.findIndex((x) => x.id === WZ.alarmBearbeiten);
    if (stelle < 0) { wzEl("wz-al-status").textContent = "Der bearbeitete Alarm existiert nicht mehr (z. B. in einem anderen Tab gelöscht) – nichts gespeichert. „Alarm anlegen“ legt ihn neu an."; WZ.alarmBearbeiten = null; wzEl("wz-al-anlegen").textContent = "Alarm anlegen"; return false; }
    d.regeln.splice(stelle, 1); delete d.zustand[WZ.alarmBearbeiten];
  }
  if (d.regeln.some((x) => x.id === r.regel.id)) { wzEl("wz-al-status").textContent = "Diesen Alarm gibt es schon."; return false; }
  if (d.regeln.length >= 50) { wzEl("wz-al-status").textContent = "Höchstens 50 Alarme."; return false; }
  if (stelle >= 0) d.regeln.splice(stelle, 0, r.regel); else d.regeln.push(r.regel);
  if (wzAlarmeSchreiben(d) === false) return false;
  wzAlarmeZeigen();
  return true;
}
function wzAlarmAnlegen(ev) {
  if (ev) ev.preventDefault();
  const art = wzEl("wz-al-art").value, wert = Number(wzEl("wz-al-wert").value);
  const auswahl = String(wzEl("wz-al-auswahl").value || "").split(",").map((x) => x.trim()).filter(Boolean);
  const bearbeitet = Boolean(WZ.alarmBearbeiten);
  // ab AJ5 (wie alerts.py --direction up|down): Prozentalarm nur mit ausdrücklich gewählter Richtung – vorher immer still „beide“
  const richtung = wzEl("wz-al-richtung") ? wzEl("wz-al-richtung").value : "";
  if (art === "prozent" && !["auf", "ab", "beide"].includes(richtung)) { wzEl("wz-al-status").textContent = "Bei „Bewegung %“ bitte die Richtung wählen: steigt, fällt oder beides."; return; }
  if (wzAlarmAnlegenRegel({ art, symbol: wzEl("wz-al-symbol").value, preis: wert, prozent: wert, richtung: art === "prozent" ? richtung : undefined, wiederScharf: wzEl("wz-al-wieder").checked, ablauf: wzEl("wz-al-ablauf").value || undefined, auswahl, angelegt: new Date().toISOString() })) {
    wzEl("wz-al-status").textContent = bearbeitet ? "Alarm geändert." : "Alarm angelegt.";
    WZ.alarmBearbeiten = null;
    wzEl("wz-al-anlegen").textContent = "Alarm anlegen";
  }
}
function wzAlarmeZeigen() {
  const d = wzAlarmeLesen();
  const liste = wzEl("wz-al-liste");
  if (d.hinweis) wzEl("wz-al-status").textContent = d.hinweis;
  wzEl("wz-al-reset").hidden = !d.beschaedigt;
  if (d.beschaedigt) { liste.replaceChildren(wzKnoten("li", { klasse: "wz-wichtig", text: "Alarme unbekannt (Speicher beschädigt) – nichts wird geprüft." })); return; }
  liste.replaceChildren(...(d.regeln.length ? d.regeln.map((r) => {
    const z = d.zustand[r.id];
    const zurueck = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "Zurücksetzen" });
    // ab 15f (ALR-S10, alerts.py:524-530): nur eine ausgelöste Regel lässt sich zurücksetzen – sonst klare Meldung statt stiller Wirkungslosigkeit
    zurueck.addEventListener("click", () => {
      const x = wzAlarmeLesen();
      if (x.beschaedigt) { wzEl("wz-al-status").textContent = x.hinweis; return; }
      if (!x.regeln.some((y) => y.id === r.id)) { wzEl("wz-al-status").textContent = "Diesen Alarm gibt es nicht mehr (z. B. in einem anderen Tab gelöscht)."; wzAlarmeZeigen(); return; }
      if (!(x.zustand[r.id] && x.zustand[r.id].ausgeloest)) { wzEl("wz-al-status").textContent = `${window.AktienAlarme.text(r)}: hat nicht ausgelöst – nichts zurückzusetzen.`; return; }
      x.zustand = window.AktienAlarme.zuruecksetzen(x.zustand, r.id); wzAlarmeSchreiben(x); wzAlarmeZeigen();
      wzEl("wz-al-status").textContent = `${window.AktienAlarme.text(r)}: zurückgesetzt – wieder scharf.`;
    });
    const weg = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "Löschen" });
    weg.addEventListener("click", () => {
      const x = wzAlarmeLesen();
      if (x.beschaedigt) { wzEl("wz-al-status").textContent = x.hinweis; return; }
      x.regeln = x.regeln.filter((y) => y.id !== r.id); delete x.zustand[r.id];
      if (wzAlarmeSchreiben(x) === false) return;
      // ab 15f: wird gerade diese Regel bearbeitet, endet der Bearbeiten-Modus (sonst legte „Änderung speichern“ sie neu an)
      if (WZ.alarmBearbeiten === r.id) { WZ.alarmBearbeiten = null; wzEl("wz-al-anlegen").textContent = "Alarm anlegen"; }
      wzAlarmeZeigen();
      wzEl("wz-al-status").textContent = `${window.AktienAlarme.text(r)}: gelöscht.`;
    });
    const schalter = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: r.aktiv === false ? "Aktivieren" : "Deaktivieren" });
    schalter.addEventListener("click", () => { const x = wzAlarmeLesen(); const y = x.regeln.find((q) => q.id === r.id); if (y) y.aktiv = !(y.aktiv !== false); wzAlarmeSchreiben(x); wzAlarmeZeigen(); });
    const bearbeiten = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "Bearbeiten" });
    bearbeiten.addEventListener("click", () => {
      WZ.alarmBearbeiten = r.id;
      wzEl("wz-al-art").value = r.art; wzEl("wz-al-symbol").value = r.symbol || ""; wzEl("wz-al-wert").value = r.preis || r.prozent || "";
      wzEl("wz-al-wieder").checked = Boolean(r.wiederScharf); wzEl("wz-al-ablauf").value = r.ablauf || ""; wzEl("wz-al-auswahl").value = (r.auswahl || []).join(", ");
      if (wzEl("wz-al-richtung")) wzEl("wz-al-richtung").value = r.art === "prozent" ? r.richtung || "beide" : "";
      wzEl("wz-al-anlegen").textContent = "Änderung speichern";
      wzEl("wz-al-status").textContent = "Bearbeiten: Werte ändern und „Änderung speichern“.";
    });
    const status = r.aktiv === false ? "deaktiviert" : r.ablauf && Date.now() > Date.parse(r.ablauf + "T23:59:59Z") ? "abgelaufen" : z ? "ausgelöst " + wzZeit(z.ausgeloest) : "scharf" + (verbunden() ? "" : " – gespeichert, aber ohne Worker-Verbindung nicht überwacht (keine Kurse)");
    return wzKnoten("li", { "data-id": r.id, "data-status": status.split(" ")[0] }, wzKnoten("div", { text: window.AktienAlarme.text(r) + (r.wiederScharf ? " · wird wieder scharf" : "") + (r.ablauf ? " · gültig bis " + r.ablauf : "") + " · " + status }), schalter, bearbeiten, zurueck, weg);
  }) : [wzKnoten("li", { text: "Keine Alarme." })]),
  ...d.protokoll.slice(0, 10).map((p) => wzKnoten("li", { klasse: "wz-wichtig", text: "🔔 " + wzZeit(p.zeit) + " · " + p.text })));
}
// Vortagesschluss: letzte abgeschlossene Tageskerze vor dem heutigen Handelstag (New York)
function wzVortag(kerzen, uhr) {
  const heute = uhr && typeof uhr.zeit === "string" ? uhr.zeit.slice(0, 10) : new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const tag = (k) => new Date(k.t + 3 * 3600000).toISOString().slice(0, 10);
  const vorher = kerzen.filter((k) => tag(k) < heute);
  return vorher.length ? vorher[vorher.length - 1].c : null;
}
async function wzAlarmePruefen(automatisch = false) {
  const status = wzEl("wz-al-status");
  const d = wzAlarmeLesen();
  if (d.beschaedigt) { if (!automatisch) status.textContent = d.hinweis; return; }
  if (!d.regeln.length) { if (!automatisch) status.textContent = d.hinweis || "Keine Alarme angelegt."; return; }
  if (!verbunden()) { if (!automatisch) status.textContent = "Bitte zuerst im Cockpit die Verbindung einrichten."; return; }
  try {
    const st = await wzStatus();
    const symbole = [...new Set(d.regeln.filter((r) => r.symbol).map((r) => r.symbol))].slice(0, 20);
    const kurse = symbole.length ? (await workerAnfrage("/aktien/kurse?symbole=" + symbole.join(","), { method: "GET" })).kurse : {};
    const vortag = {};
    for (const s of [...new Set(d.regeln.filter((r) => r.art === "prozent").map((r) => r.symbol))]) {
      try { vortag[s] = wzVortag((await wzKerzen(s, 30)).kerzen, st.uhr); } catch (e) { /* Hinweis kommt aus pruefen */ }
    }
    // ab 14zg (ALR-S13): gemeinsamer Kursspeicher „jarvis-aktien-kursspeicher“ (alte Einträge bleiben) – liest u. a. die Steuer-Information
    try { let alt = null; try { alt = JSON.parse(localStorage.getItem("jarvis-aktien-kursspeicher") || "null"); } catch (e) { alt = null; } localStorage.setItem("jarvis-aktien-kursspeicher", JSON.stringify(window.AktienAlarme.kursspeicher(alt, kurse, { jetzt: Date.now(), quelle: "Alpaca IEX über deinen Worker", vortag }))); } catch (e) { /* Speicher gesperrt: Alarme gehen trotzdem */ }
    const x = wzAlarmeLesen();
    if (x.beschaedigt) { status.textContent = x.hinweis; return; }
    const r = window.AktienAlarme.pruefen(x.regeln, { kurse, vortag, uhr: st.uhr, jetzt: Date.now() }, x.zustand);
    x.zustand = r.zustand;
    x.protokoll = [...r.ausgeloest.map((a) => ({ zeit: new Date().toISOString(), text: a.text })), ...x.protokoll].slice(0, 30);
    wzAlarmeSchreiben(x);
    wzAlarmeZeigen();
    // ab 14zg (trader-alerts ALR-S15): eine Auslösung ist Information, keine Order
    status.textContent = (r.ausgeloest.length ? "Ausgelöst: " + r.ausgeloest.map((a) => a.text).join(" · ") + " – Ein Alarm ist eine Information, keine Order: handeln nur über Budget aufteilen → Risiko-Prüfung → einzelne Freigabe." : "Nichts ausgelöst.") + " Stand " + new Date().toLocaleTimeString("de-DE") + " (Alpaca IEX)." + (r.hinweise.length ? "\n" + r.hinweise.join(" · ") : "");
  } catch (e) {
    status.textContent = "Alarme nicht prüfbar: " + wzFehlerText(e);
  }
}

// ---------- Nachrichten & 8-K ----------
async function wzNachrichten(ev) {
  if (ev) ev.preventDefault();
  const knopf = wzEl("wz-news-laden"), status = wzEl("wz-news-status"), liste = wzEl("wz-news-liste");
  if (knopf.disabled) return;
  const symbole = wzListe(wzEl("wz-news-symbole").value, 10);
  if (!symbole.length || symbole.some((s) => !WZ_TICKER.test(s))) { status.textContent = "Bitte 1 bis 10 gültige US-Aktien-Ticker angeben."; return; }
  if (!verbunden()) { status.textContent = "Bitte zuerst im Cockpit die Verbindung einrichten."; return; }
  knopf.disabled = true;
  status.textContent = "Lade Nachrichten …";
  try {
    const hinweise = [];
    let meldungen = [];
    try {
      meldungen = (await workerAnfrage(`/aktien/nachrichten?symbole=${symbole.join(",")}&anzahl=30`, { method: "GET" })).meldungen.map((m) => ({ ...m, art: "schlagzeile" }));
    } catch (e) { hinweise.push("Schlagzeilen nicht abrufbar: " + wzFehlerText(e)); }
    // Für das Aktienprofil (nur diese Sitzung): Rohliste mit allen Einzelquellen und Abrufzeit; bei Fehler der Fehler selbst
    WZ.letzteNews = { quelle: "Alpaca-News über den Worker", abgerufen: new Date().toISOString(), symbole, ...(hinweise.length && !meldungen.length ? { fehler: hinweise[0] } : { meldungen: meldungen.slice() }) };
    let st = null;
    try { st = await wzStatus(); } catch (e) { /* ohne Status keine SEC */ }
    if (st && st.sec_konfiguriert) {
      for (const s of symbole) {
        try { meldungen.push(...window.AktienNachrichten.secMeldungen((await wzSecMeldungenRoh(s)).sub, { ticker: s, anzahl: 5 })); }
        catch (e) { hinweise.push(s + " (SEC): " + wzFehlerText(e)); }
      }
    } else hinweise.push("8-K-Meldungen erst mit SEC-Einrichtung (Worker-Variable SEC_USER_AGENT).");
    const N = window.AktienNachrichten;
    const eingeordnet = N.zusammenfassen(N.einordnen(meldungen, Object.fromEntries(symbole.map((s) => [s, ""])))).slice(0, 40);
    // „Schon gesehen“ nur in diesem Browser; ein beschädigter oder gesperrter Speicher führt nie zu einem Fehler
    let gelesen = { zustand: { ids: {} }, beschaedigt: false };
    try { gelesen = N.gesehenLesen(localStorage.getItem(WZ_NEWS_GESEHEN)); } catch (e) { hinweise.push("Gesehen-Status nicht lesbar (Browserspeicher gesperrt) – alle Einträge gelten als neu."); }
    if (gelesen.beschaedigt) hinweise.push("Der lokale Gesehen-Status war beschädigt und wurde neu angelegt.");
    const g = N.gesehenAnwenden(eingeordnet, gelesen.zustand);
    try { localStorage.setItem(WZ_NEWS_GESEHEN, JSON.stringify(g.zustand)); } catch (e) { hinweise.push("Gesehen-Status konnte nicht gespeichert werden – beim nächsten Mal gelten alle wieder als neu."); }
    // ab 14t: Skill-Profil trader-news (nur auf ausdrückliche Wahl): 48-Stunden-Fenster und nur neue; Standard bleibt JARVIS (alle Zeiten,
    // „nur neue“ nach Kästchen). Ausgeblendetes wird mit Anzahl genannt, nie still entfernt.
    const skill = wzEl("wz-news-profil") && wzEl("wz-news-profil").value === "skill";
    const fenster = skill ? window.AktienNachrichten.fensterAnwenden(g.meldungen, { jetzt: Date.now() }) : { zeigen: g.meldungen.map((m) => {
      const t = m.zeit ? Date.parse(m.zeit) : NaN; return Number.isFinite(t) && t > Date.now() + 5 * 60000 ? { ...m, zeit_ungueltig: "Zeit in der Zukunft – ungültig" } : m; }), ausgeblendet: 0 };
    const nurNeu = skill || wzEl("wz-news-neu").checked;
    const zeigen = nurNeu ? fenster.zeigen.filter((m) => m.neu) : fenster.zeigen;
    const gesehenWeg = fenster.zeigen.length - zeigen.length;
    liste.replaceChildren(...(zeigen.length ? zeigen.map((m) => wzKnoten("li", { klasse: m.wichtig ? "wz-wichtig" : "", "data-neu": m.neu ? "ja" : "nein" },
      wzKnoten("div", { text: `${m.neu ? "NEU · " : ""}${m.wichtig ? "! " : ""}${m.zeit_ungueltig ? m.zeit_ungueltig + " (" + String(m.zeit).slice(0, 16) + ")" : m.zeit ? m.zeit.slice(0, 10) + (m.nur_datum ? " (nur Datum)" : "") : skill ? "Zeit unbekannt" : "Datum unbekannt"} · ${m.quelle || ""} · ${m.titel}` }),
      m.zusammenfassung ? wzKnoten("div", { klasse: "klein", text: m.zusammenfassung }) : null,
      wzKnoten("div", { klasse: "klein", text: [m.betrifft.length ? "betrifft " + m.betrifft.join(", ") : "", m.kennzeichen.length ? "Kennzeichen: " + m.kennzeichen.join(", ") : ""].filter(Boolean).join(" · ") }),
      wzLink(m.link, "Quelle öffnen"))) : [wzKnoten("li", { text: nurNeu ? "Nichts Neues seit dem letzten Abruf." : "Keine Einträge." })]));
    status.textContent = `${eingeordnet.length} Einträge, davon ${g.neu} neu (Gesehen-Status nur auf diesem Gerät, 30 Tage), neueste zuerst. Unbestätigte externe Daten.`
      + (skill ? ` Skill-Profil trader-news: nur die letzten ${fenster.stunden} Stunden und nur neue – ${fenster.ausgeblendet} älter als das Fenster und ${gesehenWeg} schon gesehene ausgeblendet (nichts gelöscht; im JARVIS-Standard wieder sichtbar).` : "")
      + (hinweise.length ? "\n" + hinweise.join(" · ") : "");
  } finally {
    knopf.disabled = false;
  }
}

// ---------- Quartalszahlen (SEC) ----------
async function wzSec(ev) {
  if (ev) ev.preventDefault();
  const knopf = wzEl("wz-sec-laden"), aus = wzEl("wz-sec-ergebnis");
  if (knopf.disabled) return;
  const symbol = String(wzEl("wz-sec-symbol").value || "").trim().toUpperCase();
  if (!WZ_TICKER.test(symbol)) { aus.textContent = "Bitte einen US-Aktien-Ticker angeben."; return; }
  if (!verbunden()) { aus.textContent = "Bitte zuerst im Cockpit die Verbindung einrichten."; return; }
  knopf.disabled = true;
  aus.textContent = "Lade SEC-Daten für " + symbol + " …";
  try {
    const st = await wzStatus();
    if (!st.sec_konfiguriert) { aus.textContent = "SEC-Daten nicht eingerichtet: Die SEC verlangt einen User-Agent mit Name und E-Mail (Worker-Variable SEC_USER_AGENT, vom Nutzer selbst zu setzen)."; return; }
    const { c, sub } = await wzSecMeldungenRoh(symbol);
    const fakten = await workerAnfrage(`/aktien/quelle?art=sec-fakten&cik=${c.cik}`, { method: "GET" });
    const S = window.AktienSec;
    const r = S.analysieren(fakten, 6);
    if (r.fehler) { aus.textContent = r.fehler; return; }
    const m = S.meldungen(sub);
    const nachlauf = S.nachlaufHinweis(r, m);
    const termin = S.naechsteZahlenSchaetzung(m);
    const mio = (v) => (v === null ? "–" : wzZahl(v / 1e6, 0));
    const pct = (v) => (v === null ? "–" : (v > 0 ? "+" : "") + wzZahl(v, 1));
    aus.replaceChildren(
      wzKnoten("div", { text: `${r.firma || c.name} (CIK ${r.cik})` }),
      ...S.aenderungen(r).map((s) => wzKnoten("div", { text: s })),
      nachlauf ? wzKnoten("div", { klasse: "wz-wichtig", text: nachlauf }) : null,
      wzKnoten("table", { klasse: "wz-tabelle" },
        wzKnoten("tr", {}, ...["Quartal bis", "GJ", "Umsatz Mio.", "ggü. VJ %", "Brutto %", "Betrieb %", "Netto %", "EPS", ""].map((x) => wzKnoten("th", { text: x }))),
        ...r.zeilen.map((z) => wzKnoten("tr", {}, ...[z.ende, z.geschaeftsjahr, mio(z.umsatz), pct(z.umsatz_vj), wzZahl(z.bruttomarge, 1), wzZahl(z.betriebsmarge, 1), wzZahl(z.nettomarge, 1), wzZahl(z.eps), z.abgeleitet ? "abgeleitet" : ""].map((x) => wzKnoten("td", { text: String(x) }))))),
      wzKnoten("div", { text: `Letzte 4 Quartale: Umsatz ${mio(r.ttm.umsatz ?? null)} Mio. USD · Nettogewinn ${mio(r.ttm.nettogewinn ?? null)} Mio. USD · EPS ${wzZahl(r.ttm.eps ?? null)}` }),
      termin ? wzKnoten("div", { text: `Nächste Zahlen (Schätzung, kein offizieller Termin): um den ${termin.datum} ±${termin.unsicherheit_tage} Tage – ${termin.grundlage}.` }) : null,
      m.bericht ? wzKnoten("div", {}, `Neuester Bericht: ${m.bericht.form} (Zeitraum ${m.bericht.zeitraum || "?"}, eingereicht ${m.bericht.eingereicht}) `, wzLink(m.bericht.link, "öffnen")) : null,
      m.zahlen8k ? wzKnoten("div", {}, `Zahlen-8-K vom ${m.zahlen8k.eingereicht} `, wzLink(m.zahlen8k.link, "öffnen")) : null,
      wzKnoten("div", { klasse: "klein", text: "Nur gemeldete Zahlen (SEC XBRL), keine Bewertung „billig/teuer“, keine Empfehlung. Die Daten der SEC können einer Meldung hinterherlaufen." }),
    );
  } catch (e) {
    aus.textContent = "Nicht möglich: " + wzFehlerText(e);
  } finally {
    knopf.disabled = false;
  }
}

// ---------- Kongress-Tracker ----------
async function wzKongress(ev) {
  if (ev) ev.preventDefault();
  const knopf = wzEl("wz-ko-laden"), status = wzEl("wz-ko-status"), liste = wzEl("wz-ko-liste");
  if (knopf.disabled) return;
  const jahr = Number(wzEl("wz-ko-jahr").value) || new Date().getFullYear();
  const mitglied = String(wzEl("wz-ko-mitglied").value || "").trim();
  if (!verbunden()) { status.textContent = "Bitte zuerst im Cockpit die Verbindung einrichten."; return; }
  knopf.disabled = true;
  status.textContent = "Lade Jahresindex " + jahr + " des House Clerk …";
  try {
    const K = window.AktienKongress;
    let zeilen = K.indexLesen(await K.zipXml(await wzRoh(`/aktien/quelle?art=kongress-index&jahr=${jahr}`)), jahr);
    // ab AJ5 (wie ptr.py:511-517): im Januar zusätzlich den Vorjahresindex – Meldungen vom Dezember sonst nicht sichtbar; Fehler → ohne
    const jetztDatum = new Date();
    if (jetztDatum.getUTCMonth() === 0 && jahr === jetztDatum.getUTCFullYear()) {
      try { zeilen = zeilen.concat(K.indexLesen(await K.zipXml(await wzRoh(`/aktien/quelle?art=kongress-index&jahr=${jahr - 1}`)), jahr - 1)); } catch (e) { /* Vorjahr nicht ladbar: nur das laufende Jahr */ }
    }
    const alle = K.auswaehlen(zeilen, { mitglieder: mitglied ? mitglied.split(";").map((x) => x.trim()).filter(Boolean) : [] });
    let zustand = null;
    try { zustand = JSON.parse(localStorage.getItem(WZ_KONGRESS) || "null"); } catch (e) { zustand = null; }
    const heute = new Date().toISOString().slice(0, 10);
    // ab AJ5: erst neu prüfen, dann begrenzen – alle neuen Meldungen sichtbar (vorher .slice(0, 60) vor der Prüfung)
    const wahl = K.anzeigeWaehlen(alle, zustand, heute, 60), auswahl = wahl.zeigen;
    const neu = new Set(wahl.neu.map((z) => z.doc_id));
    liste.replaceChildren(...(auswahl.length ? auswahl.map((z) => wzKnoten("li", { klasse: neu.has(z.doc_id) ? "wz-wichtig" : "" },
      wzKnoten("div", { text: `${neu.has(z.doc_id) ? "NEU · " : ""}${z.eingereicht || "?"} · ${z.name} (${z.bezirk}) · ${z.art_name} · Dok. ${z.doc_id}` }),
      wzLink(z.link, "PDF beim House Clerk öffnen"))) : [wzKnoten("li", { text: "Keine Transaktionsberichte gefunden." })]));
    try {
      const gesehen = new Set([...((zustand && zustand.gesehen) || []), ...wahl.gesehen]);
      localStorage.setItem(WZ_KONGRESS, JSON.stringify({ gesehen: [...gesehen].slice(-2000), letztePruefung: new Date().toISOString() }));
    } catch (e) { /* ohne Speicher gilt beim nächsten Mal wieder alles der letzten 45 Tage als neu */ }
    status.textContent = `${auswahl.length} Transaktionsberichte${mitglied ? " für „" + mitglied + "“" : ""} ${jahr}, davon ${neu.size} neu${wahl.ausgeblendet ? ` (${wahl.ausgeblendet} ältere, schon bekannte nicht angezeigt)` : ""}. Quelle: Jahresindex des House Clerk, Datum = Einreichung; Meldungen kommen bis zu 45 Tage nach dem Geschäft – kein aktuelles Marktsignal. Inhalt: PDF öffnen, Text kopieren und unten einfügen.`;
  } catch (e) {
    status.textContent = "Nicht möglich: " + wzFehlerText(e);
  } finally {
    knopf.disabled = false;
  }
}
// Eingegebener Text wird nur gelesen und als Text angezeigt; nichts wird abgefragt, gespeichert oder gesendet
const WZ_KO_FORMAT = {
  house: "PDF beim House Clerk selbst öffnen, Text markieren, kopieren und hier einfügen. JARVIS liest nur diesen Text – nichts wird abgefragt oder gesendet.",
  manuell: "Je Zeile: Datum; Eigner; Geschäft; Wert (TICKER); Betrag – z. B. „2026-07-24; Spouse; Purchase; Apple Inc. (AAPL); $1,001 - $15,000“. Optional eine Zeile „Eingereicht: 2026-08-21“. Senat: efdsearch.senate.gov selbst öffnen und die Nutzungsbedingungen selbst bestätigen; JARVIS fragt dort nichts ab.",
};
function wzKoFormat() { wzEl("wz-ko-format").textContent = WZ_KO_FORMAT[wzEl("wz-ko-art").value] || ""; }
function wzBerichtLesen() {
  const aus = wzEl("wz-ko-bericht");
  const K = window.AktienKongress;
  const manuell = wzEl("wz-ko-art").value === "manuell";
  const text = String(wzEl("wz-ko-text").value || "");
  if (text.length > 200000) { aus.textContent = "Text zu lang (höchstens 200.000 Zeichen)."; return; }
  const b = manuell ? K.manuellLesen(text, { kammer: "Senat/sonstige" }) : K.berichtLesen(text);
  if (!b.zeilen.length) {
    aus.textContent = manuell
      ? "Keine Zeile lesbar." + (b.fehler && b.fehler.length ? " " + b.fehler.join(" · ") : "")
      : typeof b.fehler === "string" ? "✖ " + b.fehler
        : "Keine Transaktionszeilen erkannt. Der Text muss die Tabellenzeilen des Berichts enthalten. Geprüft ist das Auslesen nur mit Text im Layout von „pdftotext -layout“; aus dem Browser kopierter Text kann anders aussehen. " + (b.hinweis || "") + " " + K.PDF_AUSWERTUNG.grund;
    return;
  }
  // Für den US-Aktien-Ablauf (nur diese Sitzung): gelesene Berichte merken; dieselbe Dokument-ID ersetzt den alten Stand
  WZ.letzteKongress = [...(WZ.letzteKongress || []).filter((x) => !(b.doc_id && x.doc_id === b.doc_id)), b].slice(-10);
  const depot = new Set(((WZ.konto && WZ.konto.positionen) || []).map((p) => p.symbol));
  const art = (z) => (z.option ? `Option: ${z.option.kontrakte} ${z.option.art === "call" ? "Call" : "Put"}, Basis ${z.option.basispreis}, Verfall ${z.option.verfall}${z.option.ausgeuebt ? ", ausgeübt" : ""}` : z.stueck ? `${wzZahl(z.stueck, 0)} Aktien` : z.wertart || "–");
  const unvollstaendig = b.zeilen.filter((z) => z.fehlend && z.fehlend.length).length;
  aus.replaceChildren(
    wzKnoten("div", { klasse: "wz-wichtig", text: manuell
      ? `Quelle: von dir manuell eingegeben (${b.kammer}) – nicht automatisch geprüft, keine amtliche Bestätigung.`
      : "Quelle: von dir eingefügter Text eines House-PTR – nicht automatisch gegen das PDF geprüft. Zeilenzahl bitte mit dem PDF vergleichen." }),
    wzKnoten("div", { text: manuell
      ? `${b.zeilen.length} Zeilen · eingereicht ${b.eingereicht || "nicht angegeben"}`
      : `${b.name || "Name fehlt"} (${b.bezirk || "Bezirk fehlt"}) · Dok. ${b.doc_id || "fehlt"} · eingereicht ${b.eingereicht || "nicht lesbar"} · ${b.zeilen.length} Geschäfte` }),
    wzKnoten("table", { klasse: "wz-tabelle" },
      wzKnoten("tr", {}, ...["Datum", "Eigner", "Geschäft", "Wert", "Art", "Betrag (Spanne)", "Tage bis Meldung", "Fehlt / nicht lesbar"].map((x) => wzKnoten("th", { text: x }))),
      ...b.zeilen.map((z) => wzKnoten("tr", { klasse: z.ticker && depot.has(z.ticker) ? "wz-wichtig" : "" }, ...[z.datum || "nicht lesbar", z.eigner_name, z.geschaeft_name,
        (z.wert || "–") + (z.ticker ? ` (${z.ticker})` : "") + (z.ticker && depot.has(z.ticker) ? " – in deinem Depot" : ""), manuell ? "manuell" : art(z), z.betrag || "nicht lesbar",
        z.tage_bis_meldung === undefined ? "–" : z.tage_bis_meldung + (z.verspaetet ? " (verspätet)" : ""), [...(z.fehlend || []), ...(z.doppelt ? [`mögliches Duplikat von Zeile ${z.doppelt_von + 1}`] : [])].join("; ") || "–"].map((x) => wzKnoten("td", { text: String(x) }))))),
    b.doppelte ? wzKnoten("div", { klasse: "wz-wichtig", text: `${b.doppelte} mögliche Duplikate (gleiches Datum, Eigner, Geschäft, Wert und Betrag) – markiert, nicht gelöscht; zwei gleich große Geschäfte am selben Tag sind möglich.` }) : null,
    manuell ? wzKnoten("div", { klasse: "klein", text: K.SENAT_AUTOMATISCH.grund }) : wzKnoten("div", { klasse: "klein", text: K.PDF_AUSWERTUNG.grund }),
    unvollstaendig ? wzKnoten("div", { klasse: "wz-wichtig", text: `${unvollstaendig} von ${b.zeilen.length} Zeilen sind unvollständig – fehlende Angaben werden nicht ergänzt oder geschätzt.` }) : null,
    b.fehler && b.fehler.length ? wzKnoten("div", { klasse: "wz-wichtig", text: "Nicht übernommen: " + b.fehler.join(" · ") }) : null,
    wzKnoten("div", { klasse: "klein", text: "Öffentliche Meldung, nicht früh: Sie zeigt vergangene Geschäfte, nicht was jemand als Nächstes kauft. Optionen werden nie kopiert. Keine Empfehlung, kein Ordervorschlag." }),
  );
}

// ---------- 13F-Tracker (Copycat) ----------
// Nur mit SEC-Einrichtung; ohne sie keine einzige SEC-Anfrage. Ergebnis: Beobachtung + Zielgewichte als Vorschlag.
const wzText = async (pfad) => new TextDecoder("utf-8").decode(await wzRoh(pfad));
async function wz13f(ev) {
  if (ev) ev.preventDefault();
  const knopf = wzEl("wz-13f-laden"), aus = wzEl("wz-13f-ergebnis");
  if (knopf.disabled) return;
  const C = window.AktienCopycat;
  const roh = String(wzEl("wz-13f-cik").value || "").trim() || wzEl("wz-13f-filer").value;
  const top = Number(wzEl("wz-13f-top").value);
  if (!/^\d{1,10}$/.test(roh) || !(Number.isInteger(top) && top >= 1 && top <= 30)) { aus.textContent = "Bitte einen Filer wählen oder eine CIK (nur Ziffern) und Top 1–30 angeben."; return; }
  const quartalsWahl = C.quartalsWahlLesen(wzEl("wz-13f-quartal") ? wzEl("wz-13f-quartal").value : ""); // ab 15f (COP-S04)
  if (quartalsWahl.fehler) { aus.textContent = quartalsWahl.fehler; return; }
  if (!verbunden()) { aus.textContent = "Bitte zuerst im Cockpit die Verbindung einrichten."; return; }
  const cik = C.cik10(roh);
  knopf.disabled = true;
  aus.textContent = "Lade 13F-Meldungen …";
  try {
    const st = await wzStatus();
    if (!st.sec_konfiguriert) { aus.textContent = "SEC-Daten nicht eingerichtet: Die SEC verlangt einen User-Agent mit Name und E-Mail (Worker-Variable SEC_USER_AGENT, vom Nutzer selbst zu setzen). Es wurde nichts bei der SEC angefragt."; return; }
    const sub = await workerAnfrage(`/aktien/quelle?art=sec-meldungen&cik=${cik}`, { method: "GET" });
    const liste = C.meldungenListe(sub);
    // ab 15g (COP-S27, edgar13f.py:765-767): auch hier der Hinweis auf die Namenssuche – vorher endete die Oberfläche ohne ihn
    if (!liste.length) { aus.textContent = `${sub.name || "CIK " + cik} hat keine 13F-HR-Meldungen in der Liste der SEC – vermutlich kein 13F-Melder. Nächster Schritt: Filer über die Namenssuche bzw. die CIK prüfen – nicht jeder Investor reicht 13F-HR ein.`; return; }
    if (!WZ.tickerListe) WZ.tickerListe = await workerAnfrage("/aktien/quelle?art=sec-ticker", { method: "GET" });
    const index = C.tickerIndex(WZ.tickerListe);
    const laden = async (wahl) => {
      const m = wahl.meldung;
      const name = C.infotabelleName(await workerAnfrage(`/aktien/quelle?art=sec-archiv-index&cik=${cik}&akz=${m.akz}`, { method: "GET" }));
      if (name.fehler) throw new Error(name.fehler);
      // ab AJ5: ohne gültiges Einreichungsdatum ist die Einheit (Dollar/Tausend) unklar – Werte wie gemeldet, sichtbar gekennzeichnet
      const f0 = C.wertFaktor(m.eingereicht), faktor = f0 === null ? 1 : f0;
      const zeilen = C.infotabelleLesen(await wzText(`/aktien/quelle?art=sec-archiv-xml&cik=${cik}&akz=${m.akz}&datei=${encodeURIComponent(name.name)}`), faktor);
      const meta = { quartal: m.quartal, eingereicht: m.eingereicht, akz: m.akz, tabelle: name.name, link: C.archivPfad(cik, m.akz) + name.name, einheit_unklar: f0 === null };
      let deck = {};
      try {
        deck = C.deckblattLesen(await wzText(`/aktien/quelle?art=sec-archiv-xml&cik=${cik}&akz=${m.akz}&datei=primary_doc.xml`));
        if (deck.tableValueTotal) meta.deckblatt_summe = Number(deck.tableValueTotal) * faktor;
      } catch (e) { meta.deckblatt_fehlt = true; }
      return { meta, zeilen, deck };
    };
    const quartale = C.quartaleListe(liste);
    const quartaleText = "Verfügbare Quartale: " + quartale.slice(0, 12).map((x) => `${x.name} (Stichtag ${x.quartal}, Akz. ${x.akz})`).join(" · ") + (quartale.length > 12 ? ` · … ${quartale.length - 12} ältere` : "");
    const wahl = C.meldungWaehlen(liste, quartalsWahl);
    if (wahl.fehler) { aus.replaceChildren(wzKnoten("div", { text: wahl.fehler }), wzKnoten("div", { klasse: "klein", "data-teil": "13f-quartale", text: quartaleText })); return; }
    const jetzt = await laden(wahl);
    // Änderungsmeldungen 13F-HR/A dieses Quartals (ab 11-01c): Art aus dem Deckblatt; eingerechnet werden nur Neufassung und Ergänzung
    const korrekturen = [];
    for (const a of wahl.aenderungen) {
      try { const k = await laden({ meldung: a }); korrekturen.push({ akz: a.akz, eingereicht: a.eingereicht, art: C.korrekturArt(k.deck), zeilen: k.zeilen }); }
      catch (e) { korrekturen.push({ akz: a.akz, eingereicht: a.eingereicht, art: { art: "unbekannt", grund: "nicht ladbar: " + wzFehlerText(e) }, zeilen: [] }); }
    }
    const korr = korrekturen.length ? C.korrekturAnwenden(jetzt.zeilen, korrekturen) : null;
    if (korr && korr.angewendet.length) { delete jetzt.meta.deckblatt_summe; jetzt.meta.summen_hinweis = "Summe enthält Änderungsmeldungen – mit der Deckblatt-Summe des Originals nicht vergleichbar."; }
    jetzt.zeilen = korr ? korr.zeilen : jetzt.zeilen;
    const eigene = wzCusipGespeichert();
    const q = C.quartalAufbauen(jetzt.meta, jetzt.zeilen, index, { eigene });
    let unterschiede = null, vorQuartal = null;
    const vorWahl = C.meldungWaehlen(liste, { vor: wahl.meldung.quartal });
    if (!vorWahl.fehler) {
      try {
        const v = await laden(vorWahl);
        vorQuartal = v.meta.quartal;
        unterschiede = C.vergleich(C.quartalAufbauen(jetzt.meta, jetzt.zeilen, index, { zusammen: false, eigene }).einzeln, C.quartalAufbauen(v.meta, v.zeilen, index, { zusammen: false, eigene }).einzeln);
      } catch (e) { vorQuartal = "nicht ladbar: " + wzFehlerText(e); }
    }
    // ab 14t (Nutzerentscheidung): geschätzte Ticker wie im Original mitkopiert und als „Ticker geschätzt“ markiert; ins Budget und
    // Rebalancing werden nur sichere Ticker übernommen (eine Schätzung wird nie als bestätigte Position weitergegeben)
    const kopie = C.kopierGewichte(q.positionen, { top, unsichereAuslassen: false });
    const geschaetzt = kopie.gewichte ? kopie.gewichte.filter((g) => g.geschaetzt).map((g) => g.ticker) : [];
    const akt = C.aktualitaet(jetzt.meta);
    // Für den US-Aktien-Ablauf (nur in dieser Sitzung, keine neue Anfrage): letzte geprüfte 13F-Auswertung
    WZ.letzte13F = { filer: sub.name || (C.FILER.find((f) => f.cik === cik) || {}).name || "CIK " + cik, cik, quartal: q, meta: jetzt.meta, korrekturen: wahl.aenderungen, korrektur_ergebnis: korr, neuere_vorhanden: false };
    const filer = C.FILER.find((f) => f.cik === cik);
    const zt = C.zieleText(kopie.gewichte), ziele = zt.text || ""; // ab 15d (COP-S16): leer → „Nichts mehr zu kopieren“
    const geschaetztHinweis = geschaetzt.length ? " Geschätzte Ticker nicht übernommen: " + geschaetzt.join(", ") + " – erst prüfen (z. B. CUSIP manuell zuordnen)." : "";
    const manuelle = kopie.gewichte ? kopie.gewichte.filter((g) => g.manuell).map((g) => g.ticker) : [];
    const gegliedert = unterschiede ? C.vergleichAnzeige(unterschiede) : null; // ab 15f (COP-S25): mit Unveränderten
    const stueck = (x) => wzZahl(x, 0);
    const budgetKnopf = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "Als Zielgewichte ins Budget übernehmen (Vorschlag)" });
    budgetKnopf.addEventListener("click", () => { if (zt.fehler) { aktienEl("aktien-aufteilung").textContent = zt.fehler; return; } aktienEl("aktien-ziele").value = ziele; aktienEl("aktien-ziele").dataset.zieleText = ziele; aktienEl("aktien-ziele").dataset.quelle = `${WZ.letzte13F.filer} 13F-HR ${WZ.letzte13F.quartal}, Akz. ${wahl.meldung.akz}`; /* ab 15e (COP-S20): Quelle läuft bis in die Begründung */ aktienEl("aktien-aufteilung").textContent = "Zielgewichte aus dem 13F übernommen – noch keine Order. „Budget aufteilen“, dann prüfen und jede Order einzeln freigeben." + (manuelle.length ? " Manuell zugeordnete Ticker: " + manuelle.join(", ") + " – bitte selbst prüfen." : "") + geschaetztHinweis; });
    const rebKnopf = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "Als Rebalancing-Ziele übernehmen" });
    rebKnopf.addEventListener("click", () => { if (zt.fehler) { if (wzEl("wz-reb-status")) wzEl("wz-reb-status").textContent = zt.fehler; return; } wzEl("wz-reb-ziele").value = ziele; wzZeigen("rebalance"); if (geschaetztHinweis && wzEl("wz-reb-status")) wzEl("wz-reb-status").textContent = geschaetztHinweis.trim(); });
    aus.replaceChildren(
      wzKnoten("div", { text: `Quelle: SEC EDGAR · ${sub.name || (filer && filer.name) || "CIK " + cik} (CIK ${cik})${filer ? " – bekannt für " + filer.person : ""} · Formular ${wahl.meldung.form} · Akz. ${wahl.meldung.akz}` }),
      wzKnoten("div", { text: `Berichtsquartal: ${akt.berichtsquartal} · Stichtag: ${akt.stichtag} · Eingereicht: ${akt.eingereicht} · ${akt.verzoegerung_tage} Tage nach dem Stichtag` }),
      wzKnoten("div", { klasse: "klein", "data-teil": "13f-wahl", text: quartalsWahl.akz ? `Gewählt per Akzession ${quartalsWahl.akz}.` : quartalsWahl.quartal ? `Gewählt: Quartal mit Stichtag ${quartalsWahl.quartal}.` : "Gewählt: neuestes Original-13F-HR (anderes Quartal über „Quartal oder Akzession“)." }),
      wzKnoten("div", { klasse: "klein", "data-teil": "13f-quartale", text: quartaleText }),
      akt.verspaetet ? wzKnoten("div", { klasse: "wz-wichtig", text: `Verspätet eingereicht: mehr als 45 Tage nach dem Stichtag (${akt.verzoegerung_tage} Tage).` }) : null,
      wzKnoten("div", { klasse: "wz-wichtig", text: akt.echtzeit_hinweis + ` Heute ${akt.alter_tage} Tage alt.` }),
      korr && korr.angewendet.length ? wzKnoten("div", { klasse: "wz-wichtig", text: "Eingerechnete Änderungsmeldungen (13F-HR/A): " + korr.angewendet.map((a) => `${a.art} ${a.akz} vom ${a.eingereicht}`).join(", ") + " (Art laut Deckblatt der Änderung; Regel nach SEC-Formular 13F, nicht aus dem Trader-Skill)." }) : null,
      korr && korr.nicht_angewendet.length ? wzKnoten("div", { klasse: "wz-wichtig", text: "Nicht eingerechnete Änderungsmeldungen: " + korr.nicht_angewendet.map((a) => `${a.akz}: ${a.grund}`).join(" · ") + " – die Werte können abweichen." }) : null,
      wzKnoten("div", { klasse: "klein", text: jetzt.meta.summen_hinweis || jetzt.meta.summen_pruefung || "Deckblatt-Summe nicht verfügbar – Summe nicht gegengeprüft." }),
      (() => { const andere = C.korrekturenListe(liste).filter((k) => k.quartal !== wahl.meldung.quartal); return andere.length ? wzKnoten("div", { klasse: "klein", text: "Weitere Änderungsmeldungen dieses Filers: " + andere.map((k) => `${C.quartalsName(k.quartal)} (Stichtag ${k.quartal}) eingereicht ${k.eingereicht}, ${k.verzoegerung_tage} Tage nach dem Stichtag`).join(" · ") }) : null; })(),
      C.meldungenPruefen(sub).doppelte.length ? wzKnoten("div", { klasse: "klein", text: "Doppelt gelistete Meldungen (nur einmal berücksichtigt): " + C.meldungenPruefen(sub).doppelte.map((x) => x.akz).join(", ") }) : null,
      q.positionen.some((p) => p.ticker_pruefen) ? wzKnoten("div", { klasse: "klein", text: C.OPENFIGI.grund }) : null,
      jetzt.meta.einheit_unklar ? wzKnoten("div", { klasse: "wz-wichtig", text: "Einheit unklar: Das Einreichungsdatum fehlt oder ist ungültig, daher ist nicht belegt, ob die Werte in Dollar oder in Tausend Dollar gemeldet sind. Beträge und Summe wie gemeldet, ohne Umrechnung – nicht belastbar. Anteile und Kopiergewichte hängen davon nicht ab." }) : null,
      wzKnoten("div", {}, `Summe ${wzZahl(q.summe / 1e6, 0)} Mio. ${jetzt.meta.einheit_unklar ? "(Einheit unklar)" : "USD"} in ${q.positionen.length} Positionen · `, wzLink(jetzt.meta.link, "Infotabelle bei der SEC öffnen")),
      // ab 15f (COP-S24, edgar13f.py:697-730): Stückzahl-Spalte, Klassen als „GOOGL+GOOG“, Hinweis auf weitere Positionen
      wzKnoten("table", { klasse: "wz-tabelle wz-umbruch", "data-teil": "13f-bestand" },
        wzKnoten("tr", {}, ...["#", "Name", "Ticker", "% des 13F", "Kopiergewicht %", "Wert Mio. USD", "Stück"].map((x) => wzKnoten("th", { text: x }))),
        ...q.positionen.slice(0, Math.max(top, 10)).map((p, i) => {
          const g = kopie.gewichte && kopie.gewichte.find((x) => x.ticker === p.ticker && C.istAktie(p));
          return wzKnoten("tr", {}, ...[String(i + 1), p.name + (p.putCall ? ` (${p.putCall})` : ""), (p.ticker ? C.tickerAnzeige(p) : "kein Ticker") + (p.ticker_manuell ? " (manuell)" : "") + (p.ticker_pruefen ? " *prüfen (Ticker geschätzt)" : ""), wzZahl(p.anteil), g ? wzZahl(g.gewicht) : "–", wzZahl(p.wert / 1e6, 0), stueck(p.stueck)].map((x) => wzKnoten("td", { text: x })));
        })),
      q.positionen.length > Math.max(top, 10) ? wzKnoten("div", { klasse: "klein", "data-teil": "13f-weitere", text: `… ${q.positionen.length - Math.max(top, 10)} weitere Positionen (nicht angezeigt; vollständig in der Infotabelle bei der SEC).` }) : null,
      // ab 15f (COP-S25, edgar13f.py:733-756): alle Einträge je Art, Unveränderte mit Stückzahl, Verkaufte mit Wert am Vorquartalsende
      gegliedert ? wzKnoten("div", { text: `Veränderung zum Vorquartal (Stichtag ${vorQuartal}, ${C.quartalsName(vorQuartal)}) – Stückzahlen an zwei Stichtagen, keine einzelnen Trades und keine Kaufdaten:` }) : null,
      gegliedert ? wzKnoten("table", { klasse: "wz-tabelle wz-umbruch", "data-teil": "13f-vergleich" },
        wzKnoten("tr", {}, ...["Art", "Ticker / Name", "Stück vorher", "Stück nachher", "Änderung %"].map((x) => wzKnoten("th", { text: x }))),
        ...gegliedert.gruppen.flatMap((gr) => (gr.eintraege.length ? gr.eintraege : [null]).map((u, i) => wzKnoten("tr", { "data-status": gr.status }, ...(u
          ? [`${gr.titel}${i === 0 ? ` (${gr.eintraege.length})` : ""}`, (u.ticker || "kein Ticker") + " · " + u.emittent, stueck(u.stueck_vorher), stueck(u.stueck_nachher),
            u.status === "NEU" ? "neu" : u.status === "VERKAUFT" ? `−100 (Wert am Vorquartalsende ${wzZahl(u.wert_vorher / 1e6, 1)} Mio. USD)` : u.status === "UNVERÄNDERT" ? "0" : wzZahl(u.aenderung_pct, 1)]
          : [gr.titel + " (0)", "keine", "–", "–", "–"]).map((x) => wzKnoten("td", { text: String(x) })))))) : null,
      gegliedert ? wzKnoten("div", { klasse: "klein", text: `${gegliedert.unveraendert} Positionen unverändert (oben mit Stückzahl). Stückzahlen an zwei Stichtagen – Trades innerhalb des Quartals und ihre Preise stehen nicht im 13F.` })
        : wzKnoten("div", { klasse: "klein", text: "Vorquartal: " + (vorQuartal || "nicht vorhanden") }),
      kopie.fehler ? wzKnoten("div", { text: kopie.fehler }) : null,
      geschaetzt.length ? wzKnoten("div", { klasse: "wz-wichtig", text: `Ticker geschätzt (nur Namensabgleich, nicht bestätigt): ${geschaetzt.join(", ")} – im Kopiergewicht enthalten und markiert, aber nicht ins Budget oder Rebalancing übernommen. Erst prüfen, z. B. per manueller CUSIP-Zuordnung.` }) : null,
      kopie.ausgelassen && kopie.ausgelassen.some((x) => x.grund !== `außerhalb der Top ${top}`)
        ? wzKnoten("div", { klasse: "klein", text: "Nicht kopiert: " + kopie.ausgelassen.filter((x) => x.grund !== `außerhalb der Top ${top}`).map((x) => `${x.ticker || x.emittent} (${x.grund})`).join("; ") }) : null,
      ...C.HINWEISE.map((h) => wzKnoten("div", { klasse: "klein", text: h })),
      kopie.gewichte ? budgetKnopf : null, kopie.gewichte ? rebKnopf : null,
    );
  } catch (e) {
    aus.textContent = "Nicht möglich: " + wzFehlerText(e);
  } finally {
    knopf.disabled = false;
  }
}

// ---------- Screener ----------
async function wzScreenen(ev) {
  if (ev) ev.preventDefault();
  const knopf = wzEl("wz-scr-start"), status = wzEl("wz-scr-status"), liste = wzEl("wz-scr-liste");
  if (knopf.disabled) return;
  const S = window.AktienScreener;
  const symbole = wzListe(wzEl("wz-scr-symbole").value, 10);
  if (!symbole.length || symbole.some((s) => !WZ_TICKER.test(s))) { status.textContent = "Bitte 1 bis 10 gültige US-Aktien-Ticker angeben."; return; }
  let spec;
  if (wzEl("wz-scr-vorlage").value === "eigene") {
    try { spec = JSON.parse(wzEl("wz-scr-regeln").value); } catch (e) { status.textContent = "Eigene Regeln: kein gültiges JSON."; return; }
  } else spec = S.VORLAGEN[wzEl("wz-scr-vorlage").value];
  const fehler = S.regelnPruefen(spec);
  if (fehler) { status.textContent = "Regeln ungültig: " + fehler; return; }
  if (!verbunden()) { status.textContent = "Bitte zuerst im Cockpit die Verbindung einrichten."; return; }
  knopf.disabled = true;
  status.textContent = "Lade Kennzahlen …";
  liste.replaceChildren();
  try {
    const st = await wzStatus();
    const sec = S.brauchtSec(spec);
    const saetze = [];
    for (const s of symbole) {
      let technisch, fundamental = {};
      try {
        const d = await wzKerzenGeprueft(s);
        technisch = S.kennzahlenAusKerzen(d.kerzen, { jetzt: Date.now(), letzteLaufend: wzLaufend(d.kerzen, st.uhr) });
      } catch (e) { technisch = { _hinweise: ["Kursdaten nicht verfügbar: " + wzFehlerText(e)] }; }
      if (sec) {
        if (!st.sec_konfiguriert) fundamental = { _hinweise: ["SEC nicht eingerichtet – Fundamentalkennzahlen nicht verfügbar."] };
        else {
          try {
            const c = await wzSecCik(s);
            fundamental = S.kennzahlenAusSec(window.AktienSec.analysieren(await workerAnfrage(`/aktien/quelle?art=sec-fakten&cik=${c.cik}`, { method: "GET" }), 6));
          } catch (e) { fundamental = { _hinweise: ["SEC-Kennzahlen nicht verfügbar: " + wzFehlerText(e)] }; }
        }
      }
      saetze.push(S.datensatz(s, technisch, fundamental));
    }
    const r = S.screenen(saetze, spec);
    // ab 14zc: Regel „top“ (eigene Regeln) – nur die besten top Bestandenen anzeigen, Rest als Zeile „… N weitere bestanden“
    liste.replaceChildren(...(r.angezeigt || r.ergebnisse).map((e) => {
      const k = e.kennzahlen;
      const timer = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "Entry-Timer für " + e.ticker });
      timer.addEventListener("click", () => { wzEl("wz-ein-symbol").value = e.ticker; wzZeigen("einstieg"); wzEinstieg(); });
      return wzKnoten("li", { "data-symbol": e.ticker, "data-ergebnis": e.bestanden_alle ? "bestanden" : "nicht" },
        wzKnoten("div", { text: `${e.bestanden_alle ? "✔ BESTANDEN" : "✖ NICHT BESTANDEN"} · ${e.ticker}${e.name ? " · " + e.name : ""}${e.punkte !== undefined && e.punkte !== null ? " · Punkte " + wzZahl(e.punkte, 3) : ""}` }),
        wzKnoten("ul", { klasse: "gruende" }, ...[...e.durchgefallen.map((x) => "✖ " + x), ...e.uebersprungen.map((x) => "– übersprungen: " + x), ...e.bestanden.map((x) => "✔ " + x)].map((x) => wzKnoten("li", { text: x }))),
        wzKnoten("div", { klasse: "klein", text: `Stand: Kurs ${k.kurs_stand || "nicht verfügbar"}${sec ? " · SEC-Quartal bis " + (k.period_end || "nicht verfügbar") : ""}` }),
        // ab 14zg (trader-screener SCR-S08): Rangkennzahlen ohne Wert („not ranked on“)
        ...(e.rang_luecken && e.rang_luecken.length ? [wzKnoten("div", { klasse: "klein", text: "nicht gerankt nach: " + e.rang_luecken.join(", ") + " (Wert fehlt)" })] : []),
        ...e.hinweise.map((h) => wzKnoten("div", { klasse: "klein", text: h })),
        e.bestanden_alle ? timer : null);
    }), ...(r.mehr_bestanden ? [wzKnoten("li", { "data-ergebnis": "mehr", klasse: "klein", text: `… ${r.mehr_bestanden} weitere bestanden (nicht angezeigt – Regel „top“: ${r.top})` })] : []));
    status.textContent = `${r.name}: ${r.ergebnisse.filter((e) => e.bestanden_alle).length} von ${r.ergebnisse.length} bestanden. Quelle: Alpaca IEX${sec ? " und SEC XBRL (unbestätigte externe Daten)" : ""}. Keine Empfehlung.`;
    if (typeof scrVerlaufMerken === "function") scrVerlaufMerken(r, symbole, sec); // ab 11-07k
  } catch (e) {
    status.textContent = "Nicht möglich: " + wzFehlerText(e);
  } finally {
    knopf.disabled = false;
  }
}

// ---------- Rebalancing ----------
async function wzRebalance(ev) {
  if (ev) ev.preventDefault();
  const knopf = wzEl("wz-reb-planen"), aus = wzEl("wz-reb-ergebnis");
  if (knopf.disabled) return;
  const { ziele, fehler } = window.AktienBudget.zieleLesen(wzEl("wz-reb-ziele").value);
  if (fehler.length || !ziele.length) { aus.textContent = "Zielgewichte ungültig: " + (fehler.join(" · ") || "keine angegeben"); return; }
  const band = Number(wzEl("wz-reb-band").value);
  if (!(band >= 1 && band <= 50)) { aus.textContent = "Band zwischen 1 und 50 Punkten angeben."; return; }
  if (!verbunden()) { aus.textContent = "Bitte zuerst im Cockpit die Verbindung einrichten."; return; }
  knopf.disabled = true;
  aus.textContent = "Lade Konto und Kurse …";
  try {
    const [st, konto] = await Promise.all([wzStatus(), workerAnfrage("/aktien/konto", { method: "GET" })]);
    WZ.konto = konto;
    if (konto.gesperrt) { aus.textContent = "Das Paper-Konto ist bei Alpaca gesperrt – keine Vorschläge."; return; }
    const gehalten = new Set(konto.positionen.map((p) => p.symbol));
    const fehlend = ziele.map((z) => z.symbol).filter((s) => !gehalten.has(s));
    const preise = {};
    if (fehlend.length) {
      const k = (await workerAnfrage("/aktien/kurse?symbole=" + fehlend.join(","), { method: "GET" })).kurse;
      for (const s of fehlend) if (k[s] && k[s].preis > 0 && k[s].alter_min <= 20) preise[s] = k[s].preis; // älter oder fehlend → kein Kurs (nicht geschätzt)
    }
    const g = st.grenzen || {};
    const r = window.AktienRebalance.planen(konto, preise, ziele, {
      barreservePct: g.barreservePct, maxPositionPct: g.maxPositionPct, minOrderUsd: g.minOrderUsd, maxOrderUsd: g.maxOrderUsd, bandPct: band, verkaufeNichtZiele: wzEl("wz-reb-nichtziele").checked,
    });
    if (r.fehler) { aus.textContent = r.fehler; return; }
    const pruefKnopf = wzKnoten("button", { type: "button", klasse: "knopf", text: `${r.orders.length} Vorschläge in die Risiko-Prüfung übernehmen` });
    pruefKnopf.addEventListener("click", () => wzInPruefung(r.orders, "Rebalancing"));
    aus.replaceChildren(
      wzKnoten("div", { text: `Kontowert ${usdBetrag(r.kontowert)} · Bargeld ${usdBetrag(r.bargeld)} · Barreserve ${usdBetrag(r.reserve)} · Deckel je Aktie ${usdBetrag(r.deckel)} · Band ${r.band} Punkte` }),
      wzKnoten("table", { klasse: "wz-tabelle" },
        wzKnoten("tr", {}, ...["Ticker", "Wert", "Ist %", "Ziel %", "Abweichung", "Aktion"].map((x) => wzKnoten("th", { text: x }))),
        ...r.zeilen.map((z) => wzKnoten("tr", {}, ...[z.symbol, wzZahl(z.wert), wzZahl(z.ist_pct), wzZahl(z.ziel_pct), (z.abweichung > 0 ? "+" : "") + wzZahl(z.abweichung), z.aktion].map((x) => wzKnoten("td", { text: x }))))),
      r.vorschlaege.length
        ? wzKnoten("ul", { klasse: "wz-liste" }, ...r.vorschlaege.map((v) => wzKnoten("li", { text: aktienText(v.order) + " – " + v.warum })))
        : wzKnoten("div", { text: "Nichts außerhalb des Bands – keine Vorschläge." }),
      ...r.hinweise.map((h) => wzKnoten("div", { klasse: "klein", text: h })),
      wzKnoten("div", { klasse: "klein", text: `Datenstand: Konto und Positionen aus dem Alpaca-Paper-Konto, abgerufen ${wzUhr()}; Kurse ohne Position von Alpaca IEX (höchstens 20 min alt).` }),
      wzKnoten("div", { klasse: "klein", text: r.hinweis }),
      r.orders.length ? pruefKnopf : null,
    );
  } catch (e) {
    aus.textContent = "Nicht möglich: " + wzFehlerText(e);
  } finally {
    knopf.disabled = false;
  }
}

// ---------- Eigene CUSIP-Zuordnungen (Browserspeicher dieses Geräts) ----------
const WZ_CUSIP = "jarvis-13f-cusip";
const WZ_NEWS_GESEHEN = "jarvis-aktien-news-gesehen";
function wzCusipGespeichert() {
  try {
    const d = speicherJsonLesen(WZ_CUSIP, istObjekt);
    if (!d) return {};
    // beim Lesen erneut prüfen: Ungültiges aus dem Speicher wird nie verwendet
    return window.AktienCopycat.zuordnungenLesen(Object.entries(d).map(([k, v]) => `${k}=${v}`).join("\n")).zuordnungen;
  } catch (e) { return {}; }
}
function wzCusipAnzeigen() {
  const z = wzCusipGespeichert();
  wzEl("wz-13f-cusip").value = Object.entries(z).map(([k, v]) => `${k}=${v}`).join("\n");
  if (speicherBeschaedigt(WZ_CUSIP)) wzEl("wz-13f-cusip-status").textContent = "CUSIP-Zuordnungen: " + SPEICHER_SCHADEN_TEXT;
}
function wzCusipSpeichern() {
  const status = wzEl("wz-13f-cusip-status");
  const text = String(wzEl("wz-13f-cusip").value || "");
  if (text.length > 20000) { status.textContent = "Zu viel Text (höchstens 20.000 Zeichen)."; return; }
  const r = window.AktienCopycat.zuordnungenLesen(text);
  if (r.fehler.length) { status.textContent = "Nicht gespeichert – bitte korrigieren: " + r.fehler.join(" · "); return; }
  if (Object.keys(r.zuordnungen).length > 200) { status.textContent = "Höchstens 200 Zuordnungen."; return; }
  if (speicherBeschaedigt(WZ_CUSIP)) { status.textContent = "Nicht gespeichert – CUSIP-Zuordnungen: " + SPEICHER_SCHADEN_TEXT; return; }
  try {
    localStorage.setItem(WZ_CUSIP, JSON.stringify(r.zuordnungen));
    status.textContent = `${Object.keys(r.zuordnungen).length} manuelle Zuordnung(en) gespeichert (nur auf diesem Gerät). Sie gelten beim nächsten „13F laden“ und sind dort als „manuell“ markiert.`;
  } catch (e) { status.textContent = "Speichern nicht möglich (Browserspeicher gesperrt)."; }
}

// ---------- Filer-Suche: eingebaute Liste; SEC-Tickerliste nur mit SEC-Einrichtung (ohne sie keine Anfrage) ----------
async function wzFilerSuchen(ev) {
  if (ev) ev.preventDefault();
  const knopf = wzEl("wz-13f-suchen"), status = wzEl("wz-13f-suche-status"), liste = wzEl("wz-13f-treffer");
  if (knopf.disabled) return;
  const C = window.AktienCopycat;
  const text = String(wzEl("wz-13f-suche").value || "").slice(0, 80);
  knopf.disabled = true;
  try {
    let tickerListe = null, hinweis = "";
    let sec = false;
    if (verbunden()) { try { sec = Boolean((await wzStatus()).sec_konfiguriert); } catch (e) { sec = false; } }
    if (sec) {
      try {
        if (!WZ.tickerListe) WZ.tickerListe = await workerAnfrage("/aktien/quelle?art=sec-ticker", { method: "GET" });
        tickerListe = WZ.tickerListe;
      } catch (e) { hinweis = "SEC-Tickerliste nicht abrufbar: " + wzFehlerText(e) + " – nur eingebaute Liste."; }
    } else hinweis = "SEC-Suche nicht verfügbar (SEC_USER_AGENT nicht eingerichtet) – nur die eingebaute Liste mit 23 bekannten 13F-Meldern; andere Filer per CIK.";
    const r = C.filerSuchen(text, tickerListe);
    if (r.fehler) { status.textContent = r.fehler; liste.replaceChildren(); return; }
    liste.replaceChildren(...(r.treffer.length ? r.treffer.map((t) => {
      const k = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "CIK übernehmen" });
      k.addEventListener("click", () => { wzEl("wz-13f-cik").value = String(Number(t.cik)); wzEl("wz-13f-suche-status").textContent = `CIK ${t.cik} übernommen – jetzt „13F laden“.`; });
      return wzKnoten("li", { "data-cik": t.cik }, wzKnoten("div", { text: `${t.name}${t.ticker ? " (" + t.ticker + ")" : ""} · CIK ${t.cik} · ${t.person ? t.person + " · " : ""}Quelle: ${t.quelle}` }), k);
    }) : [wzKnoten("li", { text: "Keine Treffer." })]));
    status.textContent = `${r.treffer.length} Treffer.` + (hinweis ? " " + hinweis : "") + (tickerListe ? " Die SEC-Tickerliste enthält nur Firmen mit Börsenticker – viele Fonds fehlen dort; dann CIK direkt eingeben." : "");
  } finally {
    knopf.disabled = false;
  }
}

// ---------- 13F-Dateien lokal einlesen (ab 14w, ohne Worker, ohne Netz) ----------
// Ablauf: Dateien wählen → lesen und prüfen → Vorschau (Manager, CIK, Formular, Berichtszeitraum, Zeilenzahl) → erst „Berichtsdaten anzeigen“
// zeigt die Tabelle. Nur Berichtsdaten: keine Zielgewichte, keine Übernahme in Budget, Rebalancing oder Paper-Portfolio, keine Order.
// Jede Dateiwahl bekommt eine Nummer; nur die zuletzt gewählte zählt. Abbruch der Dateiwahl verwirft eine laufende Lesung.
const WZ_13F_LOKAL = { nr: 0, laeuft: false, vorschau: null, staende: [] };
const WZ_13F_MAX_BYTES = 20 * 1024 * 1024;
async function wz13fSha256(datei) {
  try { if (!(window.crypto && crypto.subtle)) return null; const h = await crypto.subtle.digest("SHA-256", await datei.arrayBuffer()); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase(); }
  catch (e) { return null; }
}
// Status ist eine Live-Region (wird vorgelesen); Fokus nur auf echte Bedienelemente (Werkzeug-Karte: kein tabindex=-1)
function wz13fLokalStatus(text, fokusAuf = null) {
  wzEl("wz-13f-lokal-status").textContent = text;
  if (fokusAuf) fokusAuf.focus();
}
function wz13fLokalAbbrechen() {
  if (!WZ_13F_LOKAL.laeuft) return;
  WZ_13F_LOKAL.nr++; WZ_13F_LOKAL.laeuft = false; WZ_13F_LOKAL.vorschau = null;
  wzEl("wz-13f-lokal-ergebnis").replaceChildren();
  wz13fLokalStatus("Einlesen abgebrochen – nichts übernommen.", wzEl("wz-13f-dateien"));
}
async function wz13fDateienLesen() {
  const C = window.AktienCopycat, input = wzEl("wz-13f-dateien"), dateien = [...(input.files || [])];
  if (!dateien.length) { wz13fLokalAbbrechen(); return; }
  const nr = ++WZ_13F_LOKAL.nr; WZ_13F_LOKAL.laeuft = true; WZ_13F_LOKAL.vorschau = null;
  wzEl("wz-13f-lokal-ergebnis").replaceChildren();
  const kurzName = (d) => String(d.name).slice(0, 80);
  try {
    if (dateien.length > 4) throw new Error("Höchstens vier Dateien einer Einreichung wählen (Informationstabelle, primary_doc.xml, Filing-Detail-Seite, SEC-Meldungsliste).");
    for (const d of dateien) {
      if (!/\.(xml|html?|json)$/i.test(d.name)) throw new Error(`Datei „${kurzName(d)}“: nur .xml, .htm/.html oder .json. Nächster Schritt: die SEC-Dateien unverändert speichern und erneut wählen.`);
      if (d.size > WZ_13F_MAX_BYTES) throw new Error(`Datei „${kurzName(d)}“ ist größer als 20 MB – nicht gelesen. Nächster Schritt: nur die Informationstabelle einer Einreichung wählen.`);
    }
    wz13fLokalStatus("Lese 13F-Dateien …");
    const gelesen = [];
    for (const d of dateien) gelesen.push({ datei: kurzName(d), bytes: d.size, text: await d.text(), sha: await wz13fSha256(d) });
    if (nr !== WZ_13F_LOKAL.nr) return; // inzwischen neue Wahl oder Abbruch
    const roh = {}, herkunft = [];
    for (const g of gelesen) {
      const art = C.lokalArt(g.text);
      if (art === "unbekannt") throw new Error(`Datei „${g.datei}“ ist weder 13F-Informationstabelle noch Deckblatt, Filing-Detail-Seite oder SEC-Meldungsliste. Nächster Schritt: die Dateien aus „Filing Detail“ der 13F-Einreichung wählen.`);
      if (roh[art]) throw new Error(`Zwei Dateien derselben Art (${art}) gewählt – bitte genau eine Einreichung wählen.`);
      roh[art] = g.text;
      herkunft.push({ art, datei: g.datei, bytes: g.bytes, sha: g.sha });
    }
    const info = roh.infotabelle ? C.infotabelleLokalLesen(roh.infotabelle) : null, deck = roh.deckblatt ? C.deckblattLokalLesen(roh.deckblatt) : null;
    let index = roh.index ? C.filingIndexLesen(roh.index) : null, listenHinweis = null;
    if (roh.meldungsliste) { const z = C.meldungslisteZuordnen(roh.meldungsliste, deck); if (z.hinweis) listenHinweis = z.hinweis; else if (!index) index = z; }
    const stand = C.lokalAuswerten({ info, deck, index });
    stand.herkunft = herkunft;
    if (index && index.quelle) stand.meta.eingereicht_quelle = index.quelle;
    if (listenHinweis) stand.meta.pruefung.push(listenHinweis);
    WZ_13F_LOKAL.laeuft = false; WZ_13F_LOKAL.vorschau = stand;
    const m = stand.meta;
    const zeigen = wzKnoten("button", { type: "button", klasse: "knopf", text: "Berichtsdaten anzeigen" });
    const verwerfen = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "Verwerfen" });
    zeigen.addEventListener("click", () => { if (WZ_13F_LOKAL.vorschau === stand) wz13fLokalZeigen(stand); });
    verwerfen.addEventListener("click", () => { WZ_13F_LOKAL.vorschau = null; wzEl("wz-13f-lokal-ergebnis").replaceChildren(); wz13fLokalStatus("Verworfen – nichts übernommen.", wzEl("wz-13f-dateien")); });
    wzEl("wz-13f-lokal-ergebnis").replaceChildren(wzKnoten("div", { "data-teil": "13f-vorschau", text: `Vorschau: ${m.manager || "Manager unbekannt"} · CIK ${m.cik || "unbekannt"} · ${m.formular}${m.aenderung ? " (Änderungsmeldung)" : ""} · Berichtszeitraum ${m.quartal || "unbekannt"} · eingereicht ${m.eingereicht || "unbekannt (Filing-Detail-Seite oder SEC-Meldungsliste fehlt)"} · ${m.zeilen_anzahl} Zeilen. Noch nichts angezeigt oder übernommen.` }), zeigen, verwerfen);
    wz13fLokalStatus(`Gelesen: ${herkunft.map((h) => h.datei).join(", ")} – bitte Manager und Berichtszeitraum prüfen, dann „Berichtsdaten anzeigen“.`, zeigen);
  } catch (e) {
    if (nr !== WZ_13F_LOKAL.nr) return;
    WZ_13F_LOKAL.laeuft = false; WZ_13F_LOKAL.vorschau = null;
    wzEl("wz-13f-lokal-ergebnis").replaceChildren();
    wz13fLokalStatus("Nicht eingelesen: " + wzFehlerText(e), wzEl("wz-13f-dateien"));
  }
}
// ab 14x: Status je Position – „zugeordnet“ (per CUSIP belegt), „geschätzt“ (Namensabgleich; ohne Worker mit dem Offline-Auszug der
// SEC-Tickerliste), „nicht zugeordnet“. Optionszeilen tragen den Hinweis, dass sie keine Aktie sind.
function wz13fLokalTicker(zeilen) {
  const C = window.AktienCopycat, offline = window.AktienTickerOffline;
  const liste = WZ.tickerListe || (offline && offline.daten) || null;
  const index = liste ? C.tickerIndex(liste) : null;
  const kopie = zeilen.map((z) => ({ ...z }));
  C.tickerZuordnen(kopie, index, wzCusipGespeichert());
  // ab 14z: „bestätigt“ / „geschätzt“ / „nicht zugeordnet“ mit Quelle, Stand und Grund; unbekannter Status wird als Fehler gezeigt, nie als bestätigt
  return kopie.map((z) => {
    const s = C.zuordnungsStatus(z), option = z.putCall ? ` – ${z.putCall === "PUT" ? "Put" : "Call"}-Option, keine Aktie` : "";
    const bekannt = C.ZUORDNUNG_STATUS.includes(s.status), status = bekannt ? s.status : "fehler";
    const text = !bekannt ? `Fehler: unbekannter Zuordnungsstatus „${String(s.status).slice(0, 20)}“ – nicht verwendet`
      : s.status === "nicht zugeordnet" ? `nicht zugeordnet – ${s.grund}${option}`
      : `${s.status}: ${s.ticker} (${s.quelle}${s.stand ? ", " + s.stand : ""})${s.mehrdeutig ? " – mehrdeutig" : ""} – ${s.grund}${option}`;
    return { ...z, zuordnung: status, mehrdeutig: Boolean(s.mehrdeutig), ticker_sicher: status === "bestätigt" && C.istAktie(z) ? s.ticker : null, ticker_text: text };
  });
}
function wz13fLokalKopfText(m) {
  return [`Quelle: SEC EDGAR, ${m.formular}${m.aenderung ? " – Änderungsmeldung: " + m.aenderung.grund : ""} · ${m.quelle} (keine Abfrage durch JARVIS)`,
    `Manager: ${m.manager || "unbekannt"} · CIK ${m.cik || "unbekannt"}${m.akz ? " · Akz. " + m.akz : ""}`,
    `Berichtszeitraum (Stichtag): ${m.quartal || "unbekannt"} · eingereicht: ${m.eingereicht ? m.eingereicht + " (laut " + (m.eingereicht_quelle || "Filing-Detail-Seite") + ")" : "unbekannt (Filing-Detail-Seite oder SEC-Meldungsliste fehlt)"}${m.unterschrift ? " · Unterschrift laut Deckblatt: " + m.unterschrift : ""}`,
    `Werte: ${m.einheit_unklar ? "Einheit unklar (ohne Einreichungsdatum nicht belegbar, ob Dollar oder Tausend Dollar) – Zahlen wie gemeldet" : m.einheit} · ${m.zeilen_anzahl} Zeilen · Summe wie gemeldet ${m.summe_roh}`,
    `Prüfung gegen das Deckblatt: ${m.pruefung.join("; ")}`,
    `Zeitverzögert: Momentaufnahme zum Stichtag, keine Echtzeitbestände; Käufe und Verkäufe seitdem sind nicht enthalten.`];
}
function wz13fLokalZeigen(stand) {
  const m = stand.meta, aus = wzEl("wz-13f-lokal-ergebnis"), C = window.AktienCopycat;
  const zeilen = wz13fLokalTicker(stand.zeilen);
  const sortiert = zeilen.slice().sort((a, b) => b.wert_roh - a.wert_roh || a.zeile - b.zeile); // Anzeige sortiert; Originalwerte und Zeilennummern unverändert
  const zeigeMax = 100, kopf = ["Zeile", "Emittent", "Klasse", "CUSIP", "Stück/Betrag", "Put/Call", m.einheit_unklar ? "Wert (wie gemeldet, Einheit unklar)" : "Wert USD", "Zuordnung (Ticker)", "Ermessen / andere Manager", "Stimmrechte Sole/Shared/None"];
  const zahl = (x) => (x === null || x === undefined ? "–" : Number(x).toLocaleString("de-DE"));
  const tabelle = wzKnoten("table", { klasse: "wz-tabelle wz-umbruch wz-stapel", "data-teil": "13f-lokal-tabelle" },
    wzKnoten("tr", {}, ...kopf.map((x) => wzKnoten("th", { text: x }))),
    ...sortiert.slice(0, zeigeMax).map((z) => wzKnoten("tr", { "data-cusip": z.cusip, "data-zuordnung": z.zuordnung, ...(z.mehrdeutig ? { "data-mehrdeutig": "ja" } : {}) }, ...[String(z.zeile), z.emittent, z.klasse, z.cusip, `${zahl(z.stueck)} ${z.art}`, z.putCall ? (z.putCall === "PUT" ? "Put (Option)" : "Call (Option)") : "–",
      zahl(z.wert), z.ticker_text, `${z.diskretion || "–"} / ${z.andere_manager || "–"}`, `${zahl(z.stimmen.sole)} / ${zahl(z.stimmen.shared)} / ${zahl(z.stimmen.none)}`].map((x, i) => wzKnoten("td", { "data-label": kopf[i], text: String(x) })))));
  const kopieren = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "Berichtsdaten kopieren" });
  kopieren.addEventListener("click", async () => {
    const text = [...wz13fLokalKopfText(m), "Dateien: " + stand.herkunft.map((h) => `${h.datei} (${h.art}, ${h.bytes} B, SHA-256 ${h.sha || "nicht berechnet"})`).join("; "),
      "Zuordnung: „bestätigt“ = CUSIP→Ticker belegt (Quelle und Stand je Zeile); „geschätzt“ = nur Namensabgleich oder widersprüchliche Quellen, nie in Analyse oder Buchung; „nicht zugeordnet“ = keine Zuordnung oder ungültige CUSIP. Nichts davon ist eine Empfehlung.", "",
      ["Zeile", "Emittent", "Klasse", "CUSIP", "Stück/Betrag", "Art", "Put/Call", "Wert", "Zuordnung"].join("\t"),
      ...zeilen.map((z) => [z.zeile, z.emittent, z.klasse, z.cusip, z.stueck, z.art, z.putCall || "", z.wert, z.ticker_text].join("\t"))].join("\n");
    try { await navigator.clipboard.writeText(text); wz13fLokalStatus(`Berichtsdaten kopiert (${zeilen.length} Zeilen) – nur Text, nichts gebucht.`); }
    catch (e) { wz13fLokalStatus("Kopieren nicht möglich (Zwischenablage gesperrt) – nichts gebucht."); }
  });
  const teile = [
    ...wz13fLokalKopfText(m).map((t, i) => wzKnoten("div", { klasse: i >= 3 ? "klein" : "", ...(i === 0 ? { "data-teil": "13f-lokal-quelle" } : {}), text: t })),
    wzKnoten("div", { klasse: "klein", "data-teil": "13f-lokal-dateien", text: "Dateien: " + stand.herkunft.map((h) => `${h.datei} (${h.art}, ${h.bytes} B, SHA-256 ${h.sha || "nicht berechnet"})`).join("; ") }),
    m.aenderung ? wzKnoten("div", { klasse: "wz-wichtig", text: `Änderungsmeldung (13F-HR/A${m.aenderung.nr ? " Nr. " + m.aenderung.nr : ""}): ${m.aenderung.grund} Sie wird hier für sich gezeigt und nicht mit anderen Meldungen addiert.` }) : null,
    !m.vollstaendig ? wzKnoten("div", { klasse: "wz-wichtig", text: "Vollständigkeit nicht belegt (Deckblatt fehlt oder Zeilenzahl/Summe weichen ab) – keine Gesamtaussage über den Bestand." }) : null,
    m.unbekannt.length ? wzKnoten("div", { klasse: "klein", text: "Unbekannte Elemente (nicht ausgewertet): " + m.unbekannt.join(", ") }) : null,
    m.doppelte ? wzKnoten("div", { klasse: "klein", text: `${m.doppelte} Zeile(n) mit identischen Angaben kommen mehrfach vor – wie gemeldet übernommen, nicht zusammengelegt.` }) : null,
    sortiert.length > zeigeMax ? wzKnoten("div", { klasse: "klein", text: `Angezeigt: die ${zeigeMax} wertgrößten von ${sortiert.length} Zeilen; „Berichtsdaten kopieren“ enthält alle.` }) : null,
    wz13fLokalFilter(zeilen, tabelle),
    tabelle,
    wz13fLokalAnalyseWahl(zeilen),
    wzKnoten("div", { klasse: "klein", text: "Nur Berichtsdaten: keine Zielgewichte, keine Übernahme in Budget, Rebalancing oder Paper-Portfolio, keine Order. " + C.HINWEISE[0] }),
    kopieren,
  ];
  // zweiter Stand desselben Managers → Vergleich anbieten (gemeldete Bestandsänderung)
  WZ_13F_LOKAL.staende = [...WZ_13F_LOKAL.staende.filter((s) => s !== stand && !(s.meta.cik === m.cik && s.meta.quartal === m.quartal && s.meta.akz === m.akz)), stand].slice(-2);
  WZ_13F_LOKAL.vorschau = null;
  const [vorher] = WZ_13F_LOKAL.staende.length === 2 ? WZ_13F_LOKAL.staende : [];
  if (vorher) {
    const vgl = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: `Mit zuvor eingelesenem Stand vergleichen (${vorher.meta.quartal || "?"})` });
    vgl.addEventListener("click", () => wz13fLokalVergleich(vorher, stand));
    teile.push(vgl);
  }
  teile.push(wzKnoten("div", { "data-teil": "13f-lokal-vergleich" }));
  aus.replaceChildren(...teile.filter(Boolean));
  wz13fLokalStatus(`Berichtsdaten angezeigt: ${m.manager || "Manager unbekannt"}, Stichtag ${m.quartal || "unbekannt"}, ${m.zeilen_anzahl} Zeilen – nichts übernommen, nichts gebucht.`, kopieren);
}
// Übergang in die Analyse: nur Aktienzeilen mit belegtem Ticker (manuelle CUSIP-Zuordnung oder Aktienklassen-Tabelle; keine Schätzung).
// Übernimmt nur das Symbol in „US-Aktie analysieren“ – analysiert, vorgeschlagen und gebucht wird erst auf ausdrückliche Klicks dort.
// ab 14z: Filter nach Zuordnungsstatus – blendet nur Tabellenzeilen aus; Daten, Kopie und Auswahl bleiben unverändert
function wz13fLokalFilter(zeilen, tabelle) {
  const zahl = (s) => zeilen.filter((z) => z.zuordnung === s).length;
  const wahl = wzKnoten("select", { klasse: "feld", "data-teil": "13f-lokal-filter", "aria-label": "Zeilen nach Zuordnungsstatus filtern" },
    wzKnoten("option", { value: "", text: `alle (${zeilen.length})` }),
    ...["bestätigt", "geschätzt", "nicht zugeordnet", "fehler"].filter((s) => s !== "fehler" || zahl(s)).map((s) => wzKnoten("option", { value: s, text: `${s} (${zahl(s)})` })));
  wahl.addEventListener("change", () => { for (const tr of tabelle.querySelectorAll("tr[data-zuordnung]")) tr.hidden = Boolean(wahl.value) && tr.dataset.zuordnung !== wahl.value; });
  return wzKnoten("div", { klasse: "wz-zeile" }, wzKnoten("label", {}, "Zuordnung anzeigen: ", wahl),
    wzKnoten("span", { klasse: "klein", text: ` bestätigt ${zahl("bestätigt")} · geschätzt ${zahl("geschätzt")}${zeilen.some((z) => z.mehrdeutig) ? " (davon mehrdeutig " + zeilen.filter((z) => z.mehrdeutig).length + ")" : ""} · nicht zugeordnet ${zahl("nicht zugeordnet")}` }));
}
function wz13fLokalAnalyseWahl(zeilen) {
  const C = window.AktienCopycat;
  // ab 14x: nur „zugeordnet“ (per CUSIP belegt) – geschätzte Ticker stehen nicht zur Wahl
  const sicher = [...new Set(zeilen.filter((z) => z.ticker_sicher).map((z) => z.ticker_sicher))];
  const geschaetzt = zeilen.filter((z) => z.zuordnung === "geschätzt").length;
  const hinweisGeschaetzt = geschaetzt ? ` ${geschaetzt} geschätzte Zuordnung(en) sind nicht wählbar – erst per „CUSIP=TICKER“ bestätigen.` : "";
  if (!sicher.length) return wzKnoten("div", { klasse: "klein", "data-teil": "13f-lokal-analyse", text: "Kein Ticker belegt: In die Analyse übernimmt JARVIS nur per CUSIP belegte Zuordnungen (eigene Zuordnung oben, „CUSIP=TICKER“, Aktienklassen-Tabelle oder aufgezeichnete OpenFIGI-Antwort)." + hinweisGeschaetzt });
  const wahl = wzKnoten("select", { klasse: "feld", "aria-label": "Symbol aus dem 13F für die Analyse" }, ...sicher.map((t) => wzKnoten("option", { value: t, text: t })));
  const knopf = wzKnoten("button", { type: "button", klasse: "knopf zweit", text: "Symbol in „US-Aktie analysieren“ übernehmen" });
  knopf.addEventListener("click", () => {
    const sym = wahl.value, feld = document.getElementById("ablauf-symbol");
    if (!feld || !sicher.includes(sym)) return;
    if (typeof ansichtZeigen === "function") ansichtZeigen("trading");
    feld.value = sym; feld.dispatchEvent(new Event("input", { bubbles: true }));
    wz13fLokalStatus(`${sym} in „US-Aktie analysieren“ eingetragen – noch nichts analysiert, vorgeschlagen oder gebucht. Weiter mit „Analysieren“ (Kurse dort: lokale synthetische Testdaten).`);
    const start = document.getElementById("ablauf-start"); if (start) start.focus();
  });
  return wzKnoten("div", { "data-teil": "13f-lokal-analyse" }, wzKnoten("label", {}, "Belegter Ticker aus diesem 13F: ", wahl), knopf,
    hinweisGeschaetzt ? wzKnoten("div", { klasse: "klein", text: hinweisGeschaetzt.trim() }) : null);
}
function wz13fLokalVergleich(a, b) {
  const ziel = wzEl("wz-13f-lokal-ergebnis").querySelector('[data-teil="13f-lokal-vergleich"]');
  const r = window.AktienCopycat.lokalVergleichen(a, b);
  if (r.fehler) { ziel.replaceChildren(wzKnoten("div", { klasse: "wz-wichtig", text: "Kein Vergleich: " + r.fehler })); return; }
  const zahl = (x) => Number(x).toLocaleString("de-DE");
  const zaehl = r.zeilen.reduce((s, z) => ((s[z.status] = (s[z.status] || 0) + 1), s), {});
  ziel.replaceChildren(
    wzKnoten("div", { text: `Gemeldete Bestandsänderung ${r.alt.quartal} → ${r.neu.quartal} (${r.neu.manager || "CIK " + r.neu.cik}): ${Object.entries(zaehl).map(([k, n]) => `${n} ${k}`).join(", ")}. Verglichen werden Stückzahlen an zwei Stichtagen nach CUSIP, Klasse und Put/Call – keine Kauf- oder Verkaufszeitpunkte, keine Trades.` }),
    r.vollstaendig ? null : wzKnoten("div", { klasse: "wz-wichtig", text: "Mindestens ein Stand ist nicht als vollständig belegt – „nicht mehr gemeldet“ ist unsicher." }),
    wzKnoten("table", { klasse: "wz-tabelle wz-umbruch wz-stapel", "data-teil": "13f-lokal-vergleich-tabelle" },
      wzKnoten("tr", {}, ...["Status", "Emittent", "Klasse", "CUSIP", "Put/Call", "Stück vorher", "Stück nachher"].map((x) => wzKnoten("th", { text: x }))),
      ...r.zeilen.filter((z) => z.status !== "unverändert").slice(0, 60).map((z) => wzKnoten("tr", {}, ...[z.status, z.emittent, z.klasse, z.cusip, z.putCall || "–", zahl(z.vorher), zahl(z.stueck)].map((x, i) => wzKnoten("td", { "data-label": ["Status", "Emittent", "Klasse", "CUSIP", "Put/Call", "Stück vorher", "Stück nachher"][i], text: String(x) }))))));
}
wzEl("wz-13f-dateien").addEventListener("change", wz13fDateienLesen);
wzEl("wz-13f-dateien").addEventListener("cancel", wz13fLokalAbbrechen);

wzEl("wz-13f-suche-form").addEventListener("submit", wzFilerSuchen);
wzEl("wz-13f-cusip-speichern").addEventListener("click", wzCusipSpeichern);
wzEl("wz-news-reset").addEventListener("click", () => {
  try { localStorage.removeItem(WZ_NEWS_GESEHEN); wzEl("wz-news-status").textContent = "Gesehen-Status gelöscht – beim nächsten Laden gelten alle Einträge als neu."; }
  catch (e) { wzEl("wz-news-status").textContent = "Gesehen-Status nicht löschbar (Browserspeicher gesperrt)."; }
});
wzEl("wz-ko-art").addEventListener("change", wzKoFormat);
// Andere Tabs desselben Browsers: geänderte Alarme bzw. CUSIP-Zuordnungen neu anzeigen (nichts wird automatisch ausgeführt)
window.addEventListener("storage", (e) => {
  if (e.key === WZ_ALARME) wzAlarmeZeigen();
  if (e.key === WZ_CUSIP) { wzCusipAnzeigen(); wzEl("wz-13f-cusip-status").textContent = "CUSIP-Zuordnungen wurden in einem anderen Tab geändert – neu geladen."; }
});
wzCusipAnzeigen();
wzEl("wz-13f-filer").replaceChildren(...window.AktienCopycat.FILER.map((f) => wzKnoten("option", { value: f.cik, text: `${f.name} (${f.person})` })));
wzEl("wz-13f-form").addEventListener("submit", wz13f);
wzEl("wz-scr-form").addEventListener("submit", wzScreenen);
wzEl("wz-scr-vorlage").addEventListener("change", (e) => {
  const eigene = e.target.value === "eigene";
  wzEl("wz-scr-regeln").hidden = !eigene;
  if (eigene && !wzEl("wz-scr-regeln").value) wzEl("wz-scr-regeln").value = JSON.stringify(window.AktienScreener.VORLAGEN.technisch, null, 1);
});
wzEl("wz-reb-form").addEventListener("submit", wzRebalance);
wzEl("wz-wahl").addEventListener("change", (e) => wzZeigen(e.target.value));
wzEl("wz-scan-form").addEventListener("submit", wzScannen);
wzEl("wz-ein-form").addEventListener("submit", wzEinstieg);
wzEl("wz-aus-form").addEventListener("submit", wzAusstieg);
wzEl("wz-aus-position").addEventListener("change", wzPositionGewaehlt);
wzEl("wz-sim-form").addEventListener("submit", wzSimulieren);
wzEl("wz-al-form").addEventListener("submit", wzAlarmAnlegen);
wzEl("wz-al-pruefen").addEventListener("click", () => wzAlarmePruefen(false));
// Beschädigten Alarmspeicher nur ausdrücklich löschen (Regeln und Zustand); sonst bleibt er unangetastet
wzEl("wz-al-reset").addEventListener("click", () => { if (!confirm("Alarmspeicher zurücksetzen?\n\nAlle gespeicherten Alarmregeln und ihr Zustand auf diesem Gerät werden gelöscht. Es wird nichts gekauft oder verkauft.")) return; try { localStorage.removeItem(WZ_ALARME); } catch (e) { /* gesperrt */ } WZ.alarmBearbeiten = null; wzAlarmeZeigen(); wzEl("wz-al-status").textContent = "Alarmspeicher zurückgesetzt."; });
wzEl("wz-news-form").addEventListener("submit", wzNachrichten);
wzEl("wz-sec-form").addEventListener("submit", wzSec);
wzEl("wz-ko-form").addEventListener("submit", wzKongress);
wzEl("wz-ko-lesen").addEventListener("click", wzBerichtLesen);
wzEl("wz-ko-jahr").value = new Date().getFullYear();
// Alarme nur bei geöffneter, sichtbarer Seite; nur wenn es Alarme gibt; bei geschlossener Börse nur die Börsenöffnung
setInterval(() => {
  if (!verbunden() || document.visibilityState !== "visible") return;
  const d = wzAlarmeLesen();
  if (!d.regeln.length) return;
  const offen = WZ.status && WZ.status.uhr && WZ.status.uhr.offen;
  if (offen || d.regeln.some((r) => r.art === "boersenoeffnung") || !WZ.status) wzAlarmePruefen(true);
}, 60000);

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("aktien-werkzeuge");
