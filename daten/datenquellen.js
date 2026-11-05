// JARVIS Datenquellen – gemeinsame Schnittstelle für Kerzen, Kurs, Konto und Positionen (ab Dashboard 2026-11-01a).
// Reine Rechnung ohne eigenes Netz: Ein Provider liefert Rohdaten (z. B. der Worker, eine Testdatei oder ein Mock); dieses Modul
// normalisiert sie (UTC-Millisekunden, Symbol, Währung, Intervall), prüft Qualität und Frische und verpackt alles einheitlich.
// Es verändert keine Werte stillschweigend und erfindet keine Ersatzwerte: Unplausibles wird als ungültig markiert.
//
// Einheitliches Ergebnis jedes Abrufs (abrufen):
//   { ok, art, quelle, abgerufen (UTC ms), datenzeit (UTC ms der jüngsten Angabe | null), daten, ersatz, frisch (true|false|null),
//     fehler: null | { code, text } }   code ∈ timeout | fehler | ungueltig | veraltet | widerspruch | regel_fehlt | nicht_verfuegbar
// Datentypen nach der Normalisierung:
//   Kerze    { t, o, h, l, c, v }                         t = Beginn der Kerze, UTC ms
//   Kurs     { symbol, preis, waehrung, zeit }
//   Konto    { bargeld, gesamtwert, vortag, waehrung, zeit, simuliert }
//   Position { symbol, menge, wert, waehrung, zeit }
// Provider-Vertrag: { name, arten: [...], kerzen?(anfrage), kurs?(anfrage), konto?(), positionen?() } – jede Methode async.
(function (global) {
  "use strict";

  const ARTEN = ["kerzen", "kurs", "konto", "positionen"];
  // Frische-Vorgaben aus vorhandenen Projektregeln. Kurs: 2 Minuten wie die Watchlist des Dashboards (WATCH.veraltetMs).
  // Für Kerzen, Konto und Positionen gibt es keine sichere Projektvorgabe → null: ohne ausdrückliche Angabe ist die Frische
  // „unbekannt“, und eine Freigabe (fuerFreigabe) scheitert.
  const FRISCHE_VORGABE = { kurs: 120000, kerzen: null, konto: null, positionen: null };
  const INTERVALLE = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };
  const INTERVALL_NAMEN = {
    "1m": "1m", "1min": "1m", "1minute": "1m", "5m": "5m", "5min": "5m", "15m": "15m", "15min": "15m",
    "1h": "1h", "60m": "1h", "60min": "1h", "1hour": "1h", "4h": "4h", "4hour": "4h", "1d": "1d", "1day": "1d", "d": "1d", "day": "1d", "1t": "1d",
  };
  const TAG = 86400000;

  const fehler = (code, text) => ({ code, text });
  const ergebnis = (art, quelle, abgerufen, felder) => ({ ok: false, art, quelle, abgerufen, datenzeit: null, daten: null, ersatz: false, frisch: null, fehler: null, ...felder });

  // ---------- Normalisierung ----------
  function symbolNormal(roh) {
    const s = String(roh == null ? "" : roh).trim().toUpperCase().replace(/[/\-_ ]/g, "");
    return /^[A-Z][A-Z0-9.]{0,11}$/.test(s) ? s : null;
  }
  function waehrungNormal(roh) {
    const w = String(roh == null ? "" : roh).trim().toUpperCase();
    return /^[A-Z]{3,4}$/.test(w) ? w : null;
  }
  function intervallNormal(roh) {
    const k = String(roh == null ? "" : roh).trim().toLowerCase().replace(/\s+/g, "");
    return Object.hasOwn(INTERVALL_NAMEN, k) ? INTERVALL_NAMEN[k] : null;
  }
  // Zeit → UTC ms. Erlaubt: ms-Zahl, Sekunden-Zahl (< 1e11), ISO-Text MIT Zeitzone (Z oder ±hh:mm), reines Datum JJJJ-MM-TT (= 00:00 UTC).
  // Text ohne Zeitzone ist mehrdeutig (Sommerzeit!) → null.
  function zeitNormal(roh) {
    if (typeof roh === "number") {
      if (!Number.isFinite(roh) || roh <= 0) return null;
      const ms = roh < 1e11 ? roh * 1000 : roh;
      return Number.isSafeInteger(Math.round(ms)) ? Math.round(ms) : null;
    }
    if (typeof roh !== "string") return null;
    const s = roh.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const t = Date.parse(s + "T00:00:00Z"); return Number.isFinite(t) ? t : null; }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
    const t = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"));
    return Number.isFinite(t) ? t : null;
  }
  const zahl = (x) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN);

  function kerzeNormal(k) {
    if (!k || typeof k !== "object") return null;
    const t = zeitNormal(k.t !== undefined ? k.t : k.zeit);
    const [o, h, l, c] = [k.o, k.h, k.l, k.c].map(zahl);
    const v = k.v === undefined ? 0 : zahl(k.v);
    if (t === null || ![o, h, l, c, v].every(Number.isFinite)) return null;
    return { t, o, h, l, c, v };
  }

  // ---------- Kerzen-Prüfung ----------
  // kalender "24/7": jeder Abstand ≠ Intervall ist eine Lücke. kalender "boerse" (nur 1d): Abstand bis maxLueckeTage Kalendertage
  // gilt als Wochenende/Feiertag (Regel: Wochenende + ein Feiertag = höchstens 4 Tage), mehr ist eine Lücke.
  function kerzenPruefen(roh, { intervall, kalender = "24/7", maxLueckeTage = 4 } = {}) {
    const iv = intervallNormal(intervall);
    if (!iv) return { ok: false, fehler: fehler("ungueltig", "Intervall fehlt oder unbekannt.") };
    if (!Array.isArray(roh) || roh.length === 0) return { ok: false, fehler: fehler("nicht_verfuegbar", "Keine Kerzen geliefert.") };
    const ms = INTERVALLE[iv];
    const kerzen = [];
    const probleme = [];
    for (let i = 0; i < roh.length; i++) {
      const k = kerzeNormal(roh[i]);
      if (!k) { probleme.push(`Kerze ${i + 1}: unvollständig oder ungültige Zeit/Zahlen`); continue; }
      if (k.o <= 0 || k.c <= 0 || k.l <= 0 || k.v < 0 || k.h < Math.max(k.o, k.c) || k.l > Math.min(k.o, k.c)) { probleme.push(`Kerze ${i + 1}: widersprüchlich (Hoch/Tief/Kurs)`); continue; }
      kerzen.push(k);
    }
    for (let i = 1; i < kerzen.length; i++) {
      const d = kerzen[i].t - kerzen[i - 1].t;
      if (d === 0) probleme.push(`doppelte Kerze ${new Date(kerzen[i].t).toISOString()}`);
      else if (d < 0) probleme.push(`zeitlich unsortiert bei ${new Date(kerzen[i].t).toISOString()}`);
      else if (kalender === "boerse" && iv === "1d" ? d > maxLueckeTage * TAG : d !== ms) probleme.push(`Lücke von ${Math.round(d / 60000)} min vor ${new Date(kerzen[i].t).toISOString()}`);
    }
    if (probleme.length) return { ok: false, fehler: fehler("ungueltig", probleme.slice(0, 5).join("; ") + (probleme.length > 5 ? ` (+${probleme.length - 5} weitere)` : "")), probleme };
    return { ok: true, kerzen, intervall: iv };
  }

  // ---------- Ausreißer ----------
  // regeln: { maxSprungPct (Schluss zu Schluss), maxSpannePct (Hoch zu Tief, bezogen auf Tief) }. Fehlt eine Regel → regel_fehlt
  // (die Analyse wird blockiert, nichts wird verändert). Treffer → ungueltig mit Fundstellen.
  function ausreisserPruefen(kerzen, regeln) {
    const r = regeln || {};
    if (!(r.maxSprungPct > 0) || !(r.maxSpannePct > 0)) return { ok: false, fehler: fehler("regel_fehlt", "Ausreißer-Regeln (maxSprungPct, maxSpannePct) nicht festgelegt – Analyse blockiert.") };
    const funde = [];
    for (let i = 0; i < kerzen.length; i++) {
      const k = kerzen[i];
      if ((k.h - k.l) / k.l * 100 > r.maxSpannePct) funde.push(`Spanne ${new Date(k.t).toISOString().slice(0, 16)}`);
      if (i > 0 && Math.abs(k.c - kerzen[i - 1].c) / kerzen[i - 1].c * 100 > r.maxSprungPct) funde.push(`Sprung ${new Date(k.t).toISOString().slice(0, 16)}`);
    }
    return funde.length ? { ok: false, fehler: fehler("ungueltig", "Ausreißer: " + funde.slice(0, 5).join(", ")), funde } : { ok: true };
  }

  // ---------- Frische ----------
  // maxAlterMs: ausdrücklich angegeben oder Projektvorgabe der Art; null → Frische unbekannt (frisch: null). Zeit aus der Zukunft
  // (mehr als 60 s) ist widersprüchlich.
  function frischePruefen(datenzeit, art, jetzt, maxAlterMs) {
    const grenze = maxAlterMs !== undefined ? maxAlterMs : FRISCHE_VORGABE[art];
    if (!Number.isFinite(datenzeit)) return { frisch: false, fehler: fehler("veraltet", "Datenzeitpunkt fehlt.") };
    if (datenzeit - jetzt > 60000) return { frisch: false, fehler: fehler("widerspruch", "Datenzeitpunkt liegt in der Zukunft.") };
    if (!(grenze > 0)) return { frisch: null, fehler: null };
    return jetzt - datenzeit <= grenze ? { frisch: true, fehler: null } : { frisch: false, fehler: fehler("veraltet", `Daten ${Math.round((jetzt - datenzeit) / 1000)} s alt (erlaubt ${Math.round(grenze / 1000)} s).`) };
  }

  // ---------- Normalisierung je Art ----------
  function normalisieren(art, roh, anfrage) {
    if (art === "kerzen") {
      const p = kerzenPruefen(roh, { intervall: anfrage.intervall, kalender: anfrage.kalender, maxLueckeTage: anfrage.maxLueckeTage });
      if (!p.ok) return p;
      let geprueft = p;
      if (anfrage.ausreisser !== undefined) { const a = ausreisserPruefen(p.kerzen, anfrage.ausreisser); if (!a.ok) return a; }
      return { ok: true, daten: geprueft.kerzen, datenzeit: geprueft.kerzen[geprueft.kerzen.length - 1].t + INTERVALLE[geprueft.intervall] };
    }
    if (art === "kurs") {
      const symbol = symbolNormal(roh && roh.symbol), preis = zahl(roh && roh.preis), zeit = zeitNormal(roh && roh.zeit), waehrung = waehrungNormal(roh && roh.waehrung);
      if (!symbol || !(preis > 0) || zeit === null || !waehrung) return { ok: false, fehler: fehler("ungueltig", "Kurs unvollständig (Symbol, Preis > 0, Zeit mit Zeitzone, Währung).") };
      if (anfrage.symbol && symbolNormal(anfrage.symbol) !== symbol) return { ok: false, fehler: fehler("widerspruch", `Kurs für ${symbol} statt ${symbolNormal(anfrage.symbol)} geliefert.`) };
      return { ok: true, daten: { symbol, preis, waehrung, zeit }, datenzeit: zeit };
    }
    if (art === "konto") {
      const k = roh || {};
      const d = { bargeld: zahl(k.bargeld), gesamtwert: zahl(k.gesamtwert), vortag: k.vortag === undefined || k.vortag === null ? null : zahl(k.vortag), waehrung: waehrungNormal(k.waehrung), zeit: zeitNormal(k.zeit), simuliert: k.simuliert === true };
      if (!Number.isFinite(d.bargeld) || !Number.isFinite(d.gesamtwert) || d.gesamtwert < 0 || (d.vortag !== null && !Number.isFinite(d.vortag)) || !d.waehrung || d.zeit === null) return { ok: false, fehler: fehler("ungueltig", "Konto unvollständig (Bargeld, Gesamtwert, Währung, Zeit).") };
      return { ok: true, daten: d, datenzeit: d.zeit };
    }
    if (art === "positionen") {
      if (!Array.isArray(roh)) return { ok: false, fehler: fehler("ungueltig", "Positionsliste fehlt.") };
      const liste = [];
      const gesehen = new Set();
      for (const p of roh) {
        const d = { symbol: symbolNormal(p && p.symbol), menge: zahl(p && p.menge), wert: zahl(p && p.wert), waehrung: waehrungNormal(p && p.waehrung), zeit: zeitNormal(p && p.zeit) };
        if (!d.symbol || !Number.isFinite(d.menge) || !Number.isFinite(d.wert) || !d.waehrung || d.zeit === null) return { ok: false, fehler: fehler("ungueltig", "Position unvollständig.") };
        if (gesehen.has(d.symbol)) return { ok: false, fehler: fehler("widerspruch", `Position ${d.symbol} doppelt.`) };
        gesehen.add(d.symbol);
        liste.push(d);
      }
      return { ok: true, daten: liste, datenzeit: liste.length ? Math.min(...liste.map((p) => p.zeit)) : zeitNormal(anfrage.stand) };
    }
    return { ok: false, fehler: fehler("ungueltig", "Unbekannte Datenart.") };
  }

  function providerPruefen(p) {
    if (!p || typeof p !== "object" || typeof p.name !== "string" || !p.name || !Array.isArray(p.arten)) return "Provider braucht name und arten.";
    for (const a of p.arten) { if (!ARTEN.includes(a)) return "Unbekannte Art: " + a; if (typeof p[a] !== "function") return `Provider ${p.name}: Methode ${a}() fehlt.`; }
    return null;
  }

  // Laufende Kerze (begonnen, Ende noch in der Zukunft – z. B. die heutige Tageskerze während der Börsensitzung): Datenstand ist
  // „jetzt“, nicht das Kerzenende. Sonst gälte jede laufende Kerze als „aus der Zukunft“. Beginnt die Kerze selbst in der Zukunft,
  // bleibt es beim Kerzenende → widerspruch (ab 11-02x).
  function kerzenDatenzeit(art, n, jetzt) {
    if (art !== "kerzen" || !(n.datenzeit > jetzt)) return n.datenzeit;
    return n.daten[n.daten.length - 1].t <= jetzt ? jetzt : n.datenzeit;
  }

  // ---------- Abruf ----------
  // optionen: { zeitlimitMs (Pflicht, > 0), jetzt (UTC ms, für Tests), maxAlterMs }
  async function abrufen(provider, art, anfrage = {}, optionen = {}) {
    const jetzt = Number.isFinite(optionen.jetzt) ? optionen.jetzt : Date.now();
    const name = provider && provider.name ? provider.name : "?";
    const vf = providerPruefen(provider);
    if (vf) return ergebnis(art, name, jetzt, { fehler: fehler("ungueltig", vf) });
    if (!provider.arten.includes(art)) return ergebnis(art, name, jetzt, { fehler: fehler("nicht_verfuegbar", `${name} liefert keine ${art}.`) });
    if (!(optionen.zeitlimitMs > 0)) return ergebnis(art, name, jetzt, { fehler: fehler("regel_fehlt", "Zeitlimit für den Abruf fehlt.") });
    let uhr;
    let roh;
    try {
      roh = await Promise.race([
        Promise.resolve().then(() => provider[art](anfrage)),
        new Promise((_, nein) => { uhr = setTimeout(() => nein(Object.assign(new Error("Zeitüberschreitung"), { zeitlimit: true })), optionen.zeitlimitMs); }),
      ]);
    } catch (e) {
      return ergebnis(art, name, jetzt, { fehler: fehler(e && e.zeitlimit ? "timeout" : "fehler", (e && e.message) || "Abruf fehlgeschlagen") });
    } finally {
      clearTimeout(uhr);
    }
    const n = normalisieren(art, roh, anfrage);
    if (!n.ok) return ergebnis(art, name, jetzt, { fehler: n.fehler });
    const datenzeit = kerzenDatenzeit(art, n, jetzt);
    const f = frischePruefen(datenzeit, art, jetzt, optionen.maxAlterMs);
    return ergebnis(art, name, jetzt, { ok: !f.fehler, daten: n.daten, datenzeit, frisch: f.frisch, fehler: f.fehler });
  }

  // Für eine Orderfreigabe zählen nur gültige UND nachweislich frische Daten (frisch === true); unbekannte Frische blockiert.
  function fuerFreigabe(e) {
    if (!e || !e.ok) return { erlaubt: false, grund: e && e.fehler ? e.fehler.text : "keine Daten" };
    if (e.frisch !== true) return { erlaubt: false, grund: "Frische unbekannt (keine sichere Vorgabe) – keine Freigabe." };
    return { erlaubt: true, grund: null };
  }

  // ---------- Ersatzquelle ----------
  // Nur wenn die Hauptquelle scheitert. Ersatz zählt nur, wenn Art/Symbol/Intervall gleich sind, die Daten gültig und frisch sind
  // und – falls die Hauptquelle zuletzt einen Zeitpunkt kannte (regeln.letzteHauptzeit) – der Ersatz nicht älter ist.
  async function mitErsatz(haupt, ersatz, art, anfrage, optionen = {}) {
    const h = await abrufen(haupt, art, anfrage, optionen);
    if (h.ok) return h;
    const e = await abrufen(ersatz, art, anfrage, optionen);
    if (!e.ok) return { ...e, ok: false, fehler: fehler(e.fehler.code, `${haupt.name}: ${h.fehler.text} | Ersatz ${ersatz && ersatz.name}: ${e.fehler.text}`) };
    if (art === "kurs" && anfrage.symbol && e.daten.symbol !== symbolNormal(anfrage.symbol)) return { ...e, ok: false, fehler: fehler("widerspruch", "Ersatzquelle liefert ein anderes Symbol.") };
    if (Number.isFinite(optionen.letzteHauptzeit) && e.datenzeit < optionen.letzteHauptzeit) return { ...e, ok: false, fehler: fehler("veraltet", "Ersatzquelle ist älter als der letzte Stand der Hauptquelle.") };
    if (e.frisch !== true) return { ...e, ok: false, fehler: fehler("veraltet", "Ersatzquelle ohne nachgewiesene Frische – nicht verwendet.") };
    return { ...e, ersatz: true, hinweis: `Ersatzquelle ${e.quelle} statt ${haupt.name} (${h.fehler.text}).` };
  }

  // ---------- Quellenabgleich ----------
  // regeln: { maxAbweichungPct, maxZeitAbstandMs } – Pflicht. Ergebnis: { ok, abweichungPct, fehler }
  function quellenAbgleich(a, b, regeln) {
    const r = regeln || {};
    if (!(r.maxAbweichungPct > 0) || !(r.maxZeitAbstandMs > 0)) return { ok: false, fehler: fehler("regel_fehlt", "Regeln für den Quellenabgleich fehlen – keine Freigabe.") };
    if (!a || !b || !a.ok || !b.ok || a.art !== "kurs" || b.art !== "kurs") return { ok: false, fehler: fehler("nicht_verfuegbar", "Zwei gültige Kurse nötig.") };
    if (a.daten.symbol !== b.daten.symbol || a.daten.waehrung !== b.daten.waehrung) return { ok: false, fehler: fehler("widerspruch", "Symbol oder Währung verschieden.") };
    if (Math.abs(a.daten.zeit - b.daten.zeit) > r.maxZeitAbstandMs) return { ok: false, fehler: fehler("widerspruch", "Zeitpunkte nicht vergleichbar.") };
    const abweichungPct = Math.abs(a.daten.preis - b.daten.preis) / Math.min(a.daten.preis, b.daten.preis) * 100;
    if (abweichungPct > r.maxAbweichungPct) return { ok: false, abweichungPct, fehler: fehler("widerspruch", `Kurse weichen ${abweichungPct.toFixed(3)} % ab (erlaubt ${r.maxAbweichungPct} %).`) };
    return { ok: true, abweichungPct, fehler: null };
  }

  // ---------- Cache ----------
  // { maxEintraege, maxAlterMs } Pflicht. speicher (optional, getItem/setItem wie localStorage) überlebt einen Neustart; beim Laden
  // werden abgelaufene Einträge verworfen. Speicherfehler → Cache aus (immer Fehlschlag), nie ein alter Wert.
  function cacheNeu({ maxEintraege, maxAlterMs, speicher = null, schluessel = "jarvis-daten-cache" } = {}) {
    if (!(Number.isInteger(maxEintraege) && maxEintraege > 0) || !(maxAlterMs > 0)) throw new Error("Cache braucht maxEintraege und maxAlterMs.");
    let eintraege = new Map();
    let aus = false;
    if (speicher) {
      try { const roh = JSON.parse(speicher.getItem(schluessel) || "[]"); if (Array.isArray(roh)) eintraege = new Map(roh.filter((x) => Array.isArray(x) && x.length === 2 && x[1] && Number.isFinite(x[1].gespeichert))); } catch { aus = true; }
    }
    const sichern = () => { if (!speicher || aus) return; try { speicher.setItem(schluessel, JSON.stringify([...eintraege])); } catch { aus = true; eintraege.clear(); } };
    return {
      get(k, jetzt = Date.now()) {
        if (aus) return null;
        const e = eintraege.get(k);
        if (!e) return null;
        if (jetzt - e.gespeichert > maxAlterMs || e.gespeichert - jetzt > 60000) { eintraege.delete(k); sichern(); return null; }
        return { ...e.wert, aus_cache: true, cache_alter_ms: jetzt - e.gespeichert };
      },
      set(k, wert, jetzt = Date.now()) {
        if (aus || !wert || !wert.ok) return false;
        eintraege.delete(k);
        eintraege.set(k, { gespeichert: jetzt, wert });
        while (eintraege.size > maxEintraege) eintraege.delete(eintraege.keys().next().value);
        sichern();
        return !aus;
      },
      get aktiv() { return !aus; },
      get groesse() { return eintraege.size; },
    };
  }

  // ---------- Mock-Provider (Tests, Simulation) ----------
  // daten: { kerzen, kurs, konto, positionen } (Rohformat); verhalten[art]: "ok" | "timeout" | "fehler" | "veraltet"
  // verzoegerungMs: Antwortzeit. "veraltet" verschiebt alle Zeitangaben um veraltetUmMs in die Vergangenheit.
  function mockProvider({ name = "Mock", daten = {}, verhalten = {}, verzoegerungMs = 0, veraltetUmMs = 3600000 } = {}) {
    const p = { name, arten: ARTEN.filter((a) => daten[a] !== undefined), aufrufe: [] };
    const alt = (x) => {
      if (Array.isArray(x)) return x.map(alt);
      if (!x || typeof x !== "object") return x;
      const k = { ...x };
      for (const f of ["t", "zeit"]) if (k[f] !== undefined) { const z = zeitNormal(k[f]); if (z !== null) k[f] = z - veraltetUmMs; }
      return k;
    };
    for (const a of p.arten) {
      p[a] = async (anfrage) => {
        p.aufrufe.push({ art: a, anfrage });
        const v = verhalten[a] || "ok";
        if (v === "timeout") return new Promise(() => {});
        if (verzoegerungMs) await new Promise((ok) => setTimeout(ok, verzoegerungMs));
        if (v === "fehler") throw new Error(`${name}: simulierter Fehler`);
        const d = typeof daten[a] === "function" ? daten[a](anfrage) : JSON.parse(JSON.stringify(daten[a]));
        return v === "veraltet" ? alt(d) : d;
      };
    }
    return p;
  }

  // ---------- CSV-Import historischer Tageskerzen (ab Dashboard 11-02l) ----------
  // Nur lokale Verarbeitung (Text der vom Nutzer gewählten Datei), kein Netz. Format:
  //   Kopfzeile mit Spalten Datum, Open, High, Low, Close, optional Volume – Aliase (ohne Groß-/Kleinschreibung): date|datum,
  //   open|eröffnung|eroeffnung, high|hoch, low|tief, close|schluss|schlusskurs, volume|volumen. Weitere Spalten werden ignoriert und genannt.
  //   Trenner Komma oder Semikolon; Zahlen mit Punkt (bei Komma-Trenner Pflicht) oder Komma als Dezimalzeichen (nur bei Semikolon).
  //   Datum JJJJ-MM-TT oder TT.MM.JJJJ (eine Form je Datei); Uhrzeiten → nicht unterstützt (keine Tageskerzen). t = 00:00 UTC des Handelstags.
  //   Mehrdeutig (Trenner oder Zahlenformat nicht eindeutig) → rueckfrage, kein Import. Jeder Fehler → kein Import (nie teilweise).
  const CSV_GRENZEN = { maxZeichen: 2000000, maxZeilen: 5000 };
  const CSV_SPALTEN = { datum: ["date", "datum"], o: ["open", "eröffnung", "eroeffnung"], h: ["high", "hoch"], l: ["low", "tief"], c: ["close", "schluss", "schlusskurs"], v: ["volume", "volumen"] };
  function csvKerzenLesen(text, { symbol, trenner = "auto", zahlenformat = "auto" } = {}) {
    const fehler = [];
    const sym = symbolNormal(symbol || "");
    if (!sym || !/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(sym)) return { ok: false, fehler: ["Symbol fehlt oder ist kein US-Aktiensymbol – bitte ausdrücklich angeben (wird nie aus Dateiname oder Inhalt geraten)."] };
    if (typeof text !== "string" || !text.trim()) return { ok: false, fehler: ["Datei ist leer."] };
    if (text.length > CSV_GRENZEN.maxZeichen) return { ok: false, fehler: [`Datei zu groß (höchstens ${CSV_GRENZEN.maxZeichen.toLocaleString("de-DE")} Zeichen).`] };
    const zeilen = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
    const kopfIndex = zeilen.findIndex((z) => z.trim());
    const kopf = zeilen[kopfIndex];
    if (/"/.test(text)) return { ok: false, fehler: ["Anführungszeichen in der Datei werden nicht unterstützt – bitte eine einfache CSV ohne Anführungszeichen verwenden."] };
    const spaltenNach = (t) => kopf.split(t).map((s) => s.trim().toLowerCase());
    const passt = (t) => { const s = spaltenNach(t); return ["datum", "o", "h", "l", "c"].every((k) => s.some((x) => CSV_SPALTEN[k].includes(x))); };
    let tr = trenner;
    if (tr === "auto") {
      const kandidaten = [";", ","].filter(passt);
      if (kandidaten.length !== 1) return { ok: false, rueckfrage: "trenner", fehler: [kandidaten.length ? "Trennzeichen nicht eindeutig (Komma und Semikolon möglich) – bitte auswählen." : "Kopfzeile nicht erkannt: benötigt Spalten Datum/Date, Open, High, Low, Close (optional Volume), getrennt durch Komma oder Semikolon."] };
      tr = kandidaten[0];
    } else if (![";", ","].includes(tr) || !passt(tr)) return { ok: false, fehler: ["Mit dem gewählten Trennzeichen fehlen Pflichtspalten (Datum, Open, High, Low, Close)."] };
    const namen = spaltenNach(tr);
    const idx = {}; const doppelteSpalte = [];
    for (const [k, aliase] of Object.entries(CSV_SPALTEN)) { const treffer = namen.map((n, i) => (aliase.includes(n) ? i : -1)).filter((i) => i >= 0); if (treffer.length > 1) doppelteSpalte.push(k); if (treffer.length) idx[k] = treffer[0]; }
    if (doppelteSpalte.length) return { ok: false, fehler: ["Spalte mehrfach vorhanden: " + doppelteSpalte.join(", ") + " – nicht eindeutig."] };
    const ignoriert = namen.filter((n, i) => !Object.values(idx).includes(i));
    const daten = zeilen.map((z, i) => ({ nr: i + 1, z })).filter((x, i) => i > kopfIndex && x.z.trim());
    if (!daten.length) return { ok: false, fehler: ["Keine Datenzeilen nach der Kopfzeile."] };
    if (daten.length > CSV_GRENZEN.maxZeilen) return { ok: false, fehler: [`Zu viele Datenzeilen (${daten.length}, höchstens ${CSV_GRENZEN.maxZeilen}).`] };
    // Zahlenformat
    const zahlZellen = daten.flatMap((x) => { const f = x.z.split(tr); return ["o", "h", "l", "c", "v"].filter((k) => idx[k] !== undefined).map((k) => (f[idx[k]] || "").trim()); }).filter(Boolean);
    let zf = zahlenformat;
    if (zf === "auto") {
      if (tr === ",") zf = "punkt";
      else if (zahlZellen.some((s) => s.includes(","))) zf = "komma";
      else if (zahlZellen.some((s) => /^\d{1,3}(\.\d{3})+$/.test(s))) return { ok: false, rueckfrage: "zahlenformat", fehler: ["Zahlenformat nicht eindeutig (z. B. „1.234“ = 1234 oder 1,234?) – bitte Punkt oder Komma als Dezimalzeichen auswählen."] };
      else zf = "punkt";
    }
    if (tr === "," && zf === "komma") return { ok: false, fehler: ["Komma als Dezimalzeichen ist mit Komma als Trennzeichen nicht möglich."] };
    const zahlLesen = (s) => { const t = s.trim(); if (!t) return NaN; if (zf === "komma") { if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(t)) return NaN; return Number(t.replace(/\./g, "").replace(",", ".")); } if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return NaN; return Number(t); };
    // Datumsformat (eine Form je Datei)
    const roheDaten = daten.map((x) => (x.z.split(tr)[idx.datum] || "").trim());
    const iso = roheDaten.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), de = roheDaten.every((d) => /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(d));
    if (roheDaten.some((d) => /\d{1,2}:\d{2}/.test(d))) return { ok: false, fehler: ["Uhrzeiten gefunden – nur Tageskerzen werden unterstützt (kein Intraday-Intervall)."] };
    if (!iso && !de) {
      const falsch = daten.filter((x, i) => !/^\d{4}-\d{2}-\d{2}$/.test(roheDaten[i]) && !/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(roheDaten[i])).slice(0, 10).map((x) => `Zeile ${x.nr}: Datum „${(x.z.split(tr)[idx.datum] || "").trim().slice(0, 20)}“`);
      return { ok: false, fehler: falsch.length ? ["Datum nicht im Format JJJJ-MM-TT oder TT.MM.JJJJ:", ...falsch] : ["Datumsformate gemischt (JJJJ-MM-TT und TT.MM.JJJJ) – bitte eine Form je Datei."] };
    }
    const kerzen = [];
    daten.forEach((x, i) => {
      const f = x.z.split(tr);
      const d = roheDaten[i];
      const [y, m, t] = iso ? d.split("-").map(Number) : d.split(".").reverse().map(Number);
      const zeit = Date.UTC(y, m - 1, t);
      const datumOk = Number.isFinite(zeit) && new Date(zeit).getUTCFullYear() === y && new Date(zeit).getUTCMonth() === m - 1 && new Date(zeit).getUTCDate() === t;
      const w = {}; const leer = [];
      for (const k of ["o", "h", "l", "c"]) { const s = (f[idx[k]] || "").trim(); if (!s) leer.push(k.toUpperCase()); w[k] = zahlLesen(s); }
      w.v = idx.v !== undefined ? zahlLesen(f[idx.v] || "") : undefined;
      const probleme = [];
      if (!datumOk) probleme.push(`ungültiges Datum „${d}“`);
      if (leer.length) probleme.push("leer: " + leer.join(", "));
      if (["o", "h", "l", "c"].some((k) => !Number.isFinite(w[k])) && !leer.length) probleme.push("keine gültige Zahl");
      else if (["o", "h", "l", "c"].every((k) => Number.isFinite(w[k]))) {
        if (["o", "h", "l", "c"].some((k) => w[k] <= 0)) probleme.push("Preis ≤ 0");
        if (w.l > Math.min(w.o, w.c, w.h)) probleme.push("Low größer als Open/Close/High");
        if (w.h < Math.max(w.o, w.c, w.l)) probleme.push("High kleiner als Open/Close/Low");
      }
      if (idx.v !== undefined && (!Number.isFinite(w.v) || w.v < 0)) probleme.push("Volume ungültig");
      if (probleme.length) fehler.push(`Zeile ${x.nr}: ${probleme.join("; ")}`);
      else kerzen.push({ t: zeit, o: w.o, h: w.h, l: w.l, c: w.c, ...(idx.v !== undefined ? { v: w.v } : {}), _zeile: x.nr });
    });
    if (fehler.length) return { ok: false, fehler: [`${fehler.length} fehlerhafte Zeile(n) – nichts übernommen:`, ...fehler.slice(0, 10), ...(fehler.length > 10 ? [`… und ${fehler.length - 10} weitere`] : [])] };
    // Doppelte Tage: nie still löschen
    const gesehen = new Map(); const doppelt = [];
    for (const k of kerzen) { if (gesehen.has(k.t)) doppelt.push(`Zeilen ${gesehen.get(k.t)} und ${k._zeile}: ${new Date(k.t).toISOString().slice(0, 10)}`); else gesehen.set(k.t, k._zeile); }
    if (doppelt.length) return { ok: false, fehler: [`Doppelte Handelstage – nichts übernommen (es wird keine Zeile still gelöscht):`, ...doppelt.slice(0, 10)] };
    const absteigend = kerzen.length > 1 && kerzen[0].t > kerzen[kerzen.length - 1].t;
    const unsortiert = !absteigend && kerzen.some((k, i) => i && k.t < kerzen[i - 1].t);
    const sortiert = kerzen.slice().sort((a, b) => a.t - b.t).map(({ _zeile, ...k }) => k);
    // Tagesintervall mit der vorhandenen Prüfung (Börsenkalender, Lücken bis 4 Tage): Wochen-/Monatsdaten werden so abgelehnt
    const q = kerzenPruefen(sortiert, { intervall: "1d", kalender: "boerse" });
    if (!q.ok) return { ok: false, fehler: ["Keine lückenlosen Tageskerzen (Börsenkalender, höchstens 4 Tage Abstand) – nichts übernommen:", q.fehler.text] };
    return { ok: true, kerzen: q.kerzen, info: { symbol: sym, zeilen: sortiert.length, von: sortiert[0].t, bis: sortiert[sortiert.length - 1].t, trenner: tr, zahlenformat: zf, datumsformat: iso ? "JJJJ-MM-TT" : "TT.MM.JJJJ",
      volumen: idx.v !== undefined ? "aus der Datei" : "nicht in der Datei (0 eingesetzt, für den Strategie-Vergleich ohne Bedeutung)", ignoriert, sortierung: absteigend ? "absteigend – aufsteigend übernommen" : unsortiert ? "unsortiert – nach Datum aufsteigend übernommen" : "aufsteigend" } };
  }

  global.JarvisDaten = {
    CSV_GRENZEN, CSV_SPALTEN, csvKerzenLesen,
    ARTEN, FRISCHE_VORGABE, INTERVALLE,
    symbolNormal, waehrungNormal, intervallNormal, zeitNormal, kerzeNormal,
    kerzenPruefen, ausreisserPruefen, frischePruefen, kerzenDatenzeit, normalisieren, providerPruefen,
    abrufen, fuerFreigabe, mitErsatz, quellenAbgleich, cacheNeu, mockProvider,
    HINWEIS: "Datenqualität: geprüft, nicht verändert. Ungültige oder veraltete Daten sperren Signale und Freigaben.",
  };
})(typeof window !== "undefined" ? window : globalThis);
