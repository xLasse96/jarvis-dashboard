// JARVIS Dashboard – Modul „simulation“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).
// ---------- Lokale Simulation (Paper-Kern, ab 2026-11-01a) ----------
// Nur im Browser: keine Worker-Anfrage, kein Freigabecode, keine Order. Datensatz, Annahmen und Grenzen sind TESTWERTE und werden vor
// dem Lauf angezeigt. Das Portfolio liegt getrennt unter „jarvis-paper-kern-sim“ (nie zusammen mit Konto- oder Worker-Daten).
const SIM = {
  annahmen: { gebuehrPct: 0.1, slippagePct: 0.05, quelle: "Testannahme" },
  limits: { notaus: false, maxOrderWert: 2000, maxPositionen: 3, maxTagesverlust: 500, frequenz: { max: 10, fensterMs: 30 * 86400000 } },
  ausreisser: { maxSprungPct: 20, maxSpannePct: 15 },
  strategie: { art: "ema-kreuzung", kurz: 5, lang: 20 }, orderWert: 1000, startkapital: 10000,
  schluessel: "jarvis-paper-kern-sim", schritt: 20, taktMs: 60,
  portfolio: null, datensatz: null, uhr: null, pos: 0,
  // ab 11-06c (IndexedDB): Revision des Stands, auf dem dieses Fenster rechnet (0 = noch nie gespeichert); bereit = Stand geladen;
  // dbFehler = IndexedDB nicht nutzbar (dann wird nicht gebucht); arbeit = laufender Schreibvorgang (Promise) oder null
  rev: 0, bereit: false, dbFehler: "", arbeit: null,
  // ab 11-06a: gespeicherter Stand vorhanden, aber unlesbar oder falsche Form – wird nie still überschrieben
  beschaedigt: false,
};
const simEl = (id) => document.getElementById(id);
const simDatum = (t) => new Date(t).toISOString().slice(0, 10);
const simUsd = (x) => (Number.isFinite(x) ? x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD (Spielgeld)" : "–");
function simOptionen() { return { strategie: SIM.strategie, orderWert: SIM.orderWert, annahmen: SIM.annahmen, limits: SIM.limits, ausreisser: SIM.ausreisser, startkapital: SIM.startkapital }; }
// ab 14a (14.11.): dritte Datenquelle „eigene Kursdatei“ – historische Tageskurse aus einer vom Nutzer gewählten CSV (JarvisDaten.csvKerzenLesen),
// gekennzeichnet als Kurse laut Datei (Herkunft nicht gegen den Anbieter geprüft); ohne gelesene Datei ist der Bot gesperrt
SIM.dateiDatensatz = null;
// ab 15c: Kursart echter Datensätze – Kursdatei oder eigener Worker (Alpaca-Marktdaten); synthetisch bleibt „synthetische Testkurse“
function simKursart(ds) { return !ds || ds.synthetisch !== false ? "synthetisch" : ds.herkunft === "worker" ? "worker" : "datei"; }
const SIM_KURSART_TEXT = { datei: "historische Kurse aus Datei", worker: "historische Tageskurse über deinen Worker (Alpaca, Feed IEX)", synthetisch: "synthetische Testkurse" };
// ab 15c: SEC-Kennzahlen (companyfacts) zur Kursdatei – nur angehängt, wenn das beim Lesen eingetragene Symbol zur Kursdatei passt
SIM.secDatei = null;
function simDatensatz() {
  const v = simEl("sim-datensatz").value;
  if (v === "datei") return SIM.dateiDatensatz && SIM.secDatei && SIM.secDatei.symbol === SIM.dateiDatensatz.symbol ? { ...SIM.dateiDatensatz, secFakten: SIM.secDatei } : SIM.dateiDatensatz;
  return v === "B" ? PaperKern.testdatensatz({ name: "Synthetisch B", saat: 7 }) : PaperKern.testdatensatz({ name: "Synthetisch A", saat: 42 });
}
// Datenalter in ganzen Tagen seit der letzten Kerze (UTC-Tag) und Einordnung: höchstens 5 Tage (Regel der Analyse) = „bis <Datum>, Tagesschluss“, sonst historisch
function simDatenalter(ds) {
  const tage = Math.floor((Date.now() - ds.kerzen[ds.kerzen.length - 1].t) / 86400000);
  return { tage, art: tage <= 5 ? `Tagesschluss bis ${simDatum(ds.kerzen[ds.kerzen.length - 1].t)} (${tage} Tage alt, keine Echtzeitkurse)` : `historisch – letzte Kerze ${tage} Tage alt, keine aktuellen Kurse` };
}
// ab 15c: Zeile zu den SEC-Kennzahlen der Kursdatei (Vorschau und Zustandszeile)
function simSecZeile(ds) {
  const s = SIM.secDatei;
  if (!s) return "SEC-Kennzahlen: keine Datei – JARVIS-Signale ohne Kernkennzahlen (kein Kauf möglich).";
  if (!ds || s.symbol !== ds.symbol) return `SEC-Kennzahlen: Datei gehört zu ${s.symbol}, Kursdatei zu ${ds ? ds.symbol : "–"} – nicht verwendet.`;
  return `SEC-Kennzahlen: ${s.firma} (CIK ${s.cik}) aus „${s.name}“, eingereicht ${s.filedVon} bis ${s.filedBis}; im Replay je Kerze nur, was bis zum Kerzentag eingereicht war (filed).`;
}
// Vor dem Lauf: Datenquelle, Datenzeitpunkt, Qualität, Modus, Annahmen und Grenzen anzeigen; ungültige Daten sperren den Start
function simVorschau() {
  const ds = simDatensatz();
  SIM.datensatz = ds;
  if (simEl("sim-datei-bereich")) simEl("sim-datei-bereich").hidden = simEl("sim-datensatz").value !== "datei";
  if (!ds) {
    simEl("sim-vorschau").textContent = "Modus: SIMULATION – kein Konto, keine Order.\nDatenquelle: echte Tageskurse – noch keine gültigen Kurse gelesen. Symbol eintragen und eine CSV mit Tageskursen wählen oder Kurse über deinen Worker laden; bis dahin ist der Bot gesperrt.";
    simEl("sim-start").disabled = true;
    if (typeof simDatenbericht === "function") simDatenbericht(null);
    SIM.datenStatus = { ok: false, text: "keine Kursdatei gelesen → Bot gesperrt. Nächster Schritt: Symbol eintragen und eine CSV mit Tageskursen wählen oder Kurse über deinen Worker laden." };
    if (typeof simAutoZeigen === "function") simAutoZeigen();
    return false;
  }
  const q = JarvisDaten.kerzenPruefen(ds.kerzen, { intervall: ds.intervall, kalender: ds.kalender });
  const a = q.ok ? JarvisDaten.ausreisserPruefen(q.kerzen, SIM.ausreisser) : null;
  const gueltig = Boolean(q.ok && a && a.ok);
  const f = SIM.limits.frequenz;
  simEl("sim-vorschau").textContent = [
    "Modus: SIMULATION – kein Konto, keine Order, keine Verbindung zu Worker oder Broker.",
    "Datenquelle: " + ds.name + " – " + ds.quelle + ".",
    ...(ds.synthetisch === false ? [simSecZeile(ds)] : []),
    "Datenzeitpunkt: " + ds.kerzen.length + " Tageskerzen " + simDatum(ds.kerzen[0].t) + " bis " + simDatum(ds.kerzen[ds.kerzen.length - 1].t) + (ds.synthetisch === false ? " – " + simDatenalter(ds).art + "." : " (historische Testdaten, nicht aktuell)."),
    gueltig ? "Datenqualität: gültig (Reihenfolge, Doppelte, Lücken, Ausreißer geprüft)." : "⚠ Datenqualität UNGÜLTIG: " + (q.ok ? a.fehler.text : q.fehler.text) + " – Simulation gesperrt.",
    "Annahmen (Testannahme, keine Live-Werte): Gebühr " + SIM.annahmen.gebuehrPct + " %, Slippage " + SIM.annahmen.slippagePct + " % je Ausführung.",
    "Grenzen (Testwerte der Simulation): " + SIM.orderWert + " USD je Kauf (höchstens " + SIM.limits.maxOrderWert + "), höchstens " + SIM.limits.maxPositionen + " Positionen, Tagesverlust bis "
      + SIM.limits.maxTagesverlust + " USD, höchstens " + f.max + " Orders in " + Math.round(f.fensterMs / 86400000) + " Tagen; Not-Aus der Simulation: " + (SIM.limits.notaus ? "AN" : "aus") + ".",
    "Strategie: EMA " + SIM.strategie.kurz + "/" + SIM.strategie.lang + "-Kreuzung, Ausführung zur Eröffnung der nächsten Kerze.",
  ].join("\n");
  simEl("sim-start").disabled = !gueltig || Boolean(SIM.uhr);
  // ab 13y: Datenstatus für die Zustandszeile der Paper-Automatik (ungültige Daten sperren den Start, Grund und nächster Schritt sichtbar)
  SIM.datenStatus = gueltig ? { ok: true, text: ds.synthetisch === false
      ? (simKursart(ds) === "worker"
        ? `gültig – ${ds.kerzen.length} historische Tageskurse ${ds.symbol} über deinen Worker (${simDatum(ds.kerzen[0].t)} bis ${simDatum(ds.kerzen[ds.kerzen.length - 1].t)}; ${simDatenalter(ds).art}; ${ds.quelle}); Reihenfolge, Doppelte, Lücken und Ausreißer geprüft`
        : `gültig – ${ds.kerzen.length} historische Tageskurse ${ds.symbol} aus Datei (${simDatum(ds.kerzen[0].t)} bis ${simDatum(ds.kerzen[ds.kerzen.length - 1].t)}; ${simDatenalter(ds).art}; Kurse laut Datei, Herkunft nicht gegen den Anbieter geprüft); Reihenfolge, Doppelte, Lücken und Ausreißer geprüft`)
      : `gültig – ${ds.kerzen.length} synthetische Testkurse (Tageskerzen, künstliche Kalenderdaten ${simDatum(ds.kerzen[0].t)} bis ${simDatum(ds.kerzen[ds.kerzen.length - 1].t)}, keine Marktdaten); Reihenfolge, Doppelte, Lücken und Ausreißer geprüft` }
    : { ok: false, text: "UNGÜLTIG – " + (q.ok ? a.fehler.text : q.fehler.text) + " → Bot gesperrt, nichts gebucht. Nächster Schritt: anderen Testdatensatz wählen oder die Seite neu laden." };
  // ab 14zc: Datenqualitätsbericht (nur echte Kurse; Funktion aus 05-mein-tag.js, später geladen)
  if (typeof simDatenbericht === "function") simDatenbericht(ds);
  // ab 15a: Zustandszeile der Paper-Automatik mit Datenquelle und Not-Aus aktuell halten (Funktion aus 05-mein-tag.js, später geladen)
  if (typeof simAutoZeigen === "function") simAutoZeigen();
  return gueltig;
}
// ---------- Speicher der Simulation: IndexedDB (ab 11-06c) ----------
// Nutzerfreigabe 06.11.2026 zu docs/ENTSCHEIDUNGEN_OFFEN.md, Nachtrag 41, Weg A. Vorher localStorage mit Prüfung vor dem Schreiben
// (05i): zwei Tabs in getrennten Prozessen sahen beide den alten Stand (Probe 100/100 verloren). Jetzt maßgeblich: Datenbank
// „jarvis-paper“, Speicher „stand“, Eintrag „aktien-sim“ = { id, rev, text, geaendert }. Jede Änderung liest, vergleicht (rev) und
// schreibt in EINER readwrite-Transaktion; sich überschneidende readwrite-Transaktionen laufen laut Standard nacheinander, auch über
// Tabs und Prozesse desselben Browserprofils (nicht über Profile oder Geräte). rev steigt nur (Löschen = text null).
// Migration: Fehlt „aktien-sim“, wird ein gültiger localStorage-Stand in derselben Transaktion übernommen; jeder vorhandene alte Text
// (auch ein beschädigter) bleibt unverändert in localStorage und zusätzlich als Eintrag „migration“ erhalten. Danach wird localStorage
// nur noch als Kopie geschrieben (Sicherung, Rückweg auf ältere Versionen) und nie mehr gelesen. Ohne IndexedDB wird nicht gebucht –
// kein Ausweichen auf localStorage.
const SIMDB = { name: "jarvis-paper", version: 1, speicher: "stand", id: "aktien-sim", db: null };
function simAusText(text) {
  let roh = null;
  try { roh = JSON.parse(text); } catch (e) { return null; }
  return roh && roh.art === "simulation" && roh.simuliert === true && Array.isArray(roh.ledger) ? roh : null;
}
// ab 11-06d: höchstens EIN Öffnen gleichzeitig (vorher öffneten zwei gleichzeitige Aufrufe zwei Verbindungen; die erste blieb offen,
// ihr versionchange-Handler schloss die zweite – Löschen oder Versionswechsel der Datenbank warteten dann unbegrenzt). Jede Verbindung
// schließt bei versionchange sich selbst.
function simDbOeffnen() {
  if (SIMDB.db) return Promise.resolve({ db: SIMDB.db });
  if (SIMDB.oeffnen) return SIMDB.oeffnen;
  SIMDB.oeffnen = new Promise((ok) => {
    let r;
    try { r = indexedDB.open(SIMDB.name, SIMDB.version); } catch (e) { ok({ fehler: "IndexedDB nicht verfügbar" }); return; }
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(SIMDB.speicher)) r.result.createObjectStore(SIMDB.speicher, { keyPath: "id" }); };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); if (SIMDB.db === db) SIMDB.db = null; };
      SIMDB.db = db;
      ok({ db });
    };
    r.onerror = () => ok({ fehler: "IndexedDB nicht verfügbar (" + ((r.error && r.error.name) || "Fehler") + ")" });
    r.onblocked = () => ok({ fehler: "Datenbank durch einen anderen Tab blockiert – bitte andere JARVIS-Tabs neu laden" });
  }).finally(() => { SIMDB.oeffnen = null; });
  return SIMDB.oeffnen;
}
// Eine Transaktion: aendern(alt) läuft INNERHALB der Transaktion und liefert { text } (neuer Speichertext, null = gelöscht) oder
// { abbruch }. Ergebnis erst nach oncomplete: { stand } (geschrieben), { abbruch, stand } (nichts geschrieben) oder { fehler }.
// ab Nachtauftrag 1000 (Nr. 27): pruefen() (optional) liefert einen Sperrgrund oder null. Aufgerufen unmittelbar vor dem Schreiben (im selben
// Schritt wie die Schreibentscheidung) und erneut nach dem Schreibauftrag, solange die Transaktion noch abbrechbar ist (dann tx.abort()).
// Mit Grund: { gesperrt, stand } – nichts geschrieben. Ein Grund, der erst nach diesem letzten Punkt entsteht, wirkt nicht mehr (Buchung abgeschlossen).
function simTransaktion(aendern, pruefen) {
  return simDbOeffnen().then((o) => new Promise((ok) => {
    if (!o.db) { ok({ fehler: o.fehler }); return; }
    let tx;
    try { tx = o.db.transaction(SIMDB.speicher, "readwrite"); } catch (e) { SIMDB.db = null; ok({ fehler: "Transaktion nicht möglich (" + e.name + ")" }); return; }
    const st = tx.objectStore(SIMDB.speicher);
    let ergebnis = null;
    const g = st.get(SIMDB.id);
    g.onsuccess = () => {
      const alt = g.result || null;
      const r = aendern(alt);
      if (r.abbruch) { ergebnis = { abbruch: r.abbruch, stand: alt }; return; }
      const grund = pruefen ? pruefen() : null;
      if (grund) { ergebnis = { gesperrt: grund, stand: alt }; return; }
      const neu = { id: SIMDB.id, rev: (alt ? alt.rev : 0) + 1, text: r.text, geaendert: new Date().toISOString() };
      if (!alt) {
        // erster Eintrag: vorhandenen alten localStorage-Text unverändert sichern (Migration, nie gelöscht)
        let lsText = null;
        try { lsText = localStorage.getItem(SIM.schluessel); } catch (e) { /* gesperrt */ }
        if (lsText !== null) st.put({ id: "migration", quelle: "localStorage", text: lsText, zeit: neu.geaendert });
      }
      const schreiben = st.put(neu);
      ergebnis = { stand: neu };
      if (pruefen) schreiben.onsuccess = () => { const g2 = pruefen(); if (!g2) return; try { tx.abort(); ergebnis = { gesperrt: g2, stand: alt }; } catch (e) { /* nicht mehr abbrechbar: abgeschlossen */ } };
    };
    tx.oncomplete = () => ok(ergebnis || { fehler: "keine Antwort der Datenbank" });
    tx.onabort = () => ok(ergebnis && ergebnis.gesperrt ? ergebnis : { fehler: "Schreiben abgebrochen (" + ((tx.error && tx.error.name) || "unbekannt") + ")" });
  }));
}
// Gespeicherten Stand in dieses Fenster übernehmen (stand: Eintrag oder null)
function simStandUebernehmen(stand) {
  SIM.rev = stand ? stand.rev : 0;
  const text = stand ? stand.text : null;
  SIM.portfolio = text === null ? null : simAusText(text);
  SIM.beschaedigt = text !== null && !SIM.portfolio;
}
// Kopie für Sicherung und ältere Versionen (nicht maßgeblich); false = nicht geschrieben
function simSpiegeln(text) { try { if (text === null) localStorage.removeItem(SIM.schluessel); else localStorage.setItem(SIM.schluessel, text); return true; } catch (e) { return false; } }
// Laden beim Seitenstart, einschließlich der einmaligen Migration. Mehrfachstart (zwei Tabs gleichzeitig): die zweite Transaktion
// sieht den Eintrag der ersten und übernimmt nichts doppelt.
function simLadenDb() {
  let quelle = "";
  return simTransaktion((alt) => {
    if (alt) return { abbruch: "vorhanden" };
    let text = null;
    try { text = localStorage.getItem(SIM.schluessel); } catch (e) { /* gesperrt */ }
    if (text === null) return { abbruch: "leer" };
    if (!simAusText(text)) { quelle = "beschaedigt"; return { abbruch: "beschaedigt" }; }
    quelle = "migriert";
    return { text };
  }).then((r) => {
    SIM.bereit = !r.fehler;
    SIM.dbFehler = r.fehler || "";
    if (r.fehler) { SIM.portfolio = null; SIM.beschaedigt = false; return r; }
    simStandUebernehmen(r.stand);
    // nicht übernommener, beschädigter alter Stand: gemeldet, nie still überschrieben (wie 06a); bleibt in localStorage
    if (quelle === "beschaedigt") SIM.beschaedigt = true;
    return { ...r, migriert: quelle === "migriert" };
  });
}
// Bedingtes Schreiben (Kauf, Verkauf, Zurücksetzen, Historische Simulation): nur, wenn der gespeicherte Stand noch die Revision
// hat, auf der dieses Fenster gerechnet hat. Ergebnis: { ok } | { konflikt } (aktueller Stand geladen) | { fehler } (nichts geändert)
// ab Nachtauftrag 1000 (Nr. 27): pruefen (optional, siehe simTransaktion) → { gesperrt: Grund } (nichts geschrieben, Stand dieses Fensters unverändert)
function simSchreiben(text, pruefen) {
  const basis = SIM.rev, beschaedigt = SIM.beschaedigt && SIM.rev === 0;
  return simTransaktion((alt) => ((alt ? alt.rev : 0) !== basis ? { abbruch: "konflikt" } : { text }), pruefen).then((r) => {
    if (r.fehler) return { fehler: r.fehler };
    if (r.gesperrt) return { gesperrt: r.gesperrt };
    if (r.abbruch) { simStandUebernehmen(r.stand); if (!r.stand && beschaedigt) SIM.beschaedigt = true; simLedgerZeigen(); return { konflikt: true }; }
    simStandUebernehmen(r.stand);
    simSpiegeln(text);
    simMelden();
    return { ok: true };
  });
}
// Ausdrückliches Ersetzen ohne Revisionsvergleich – nur Import und Löschen in „Daten auf diesem Gerät“ (text null = gelöscht)
function simErsetzen(text) {
  return simTransaktion(() => ({ text })).then((r) => {
    if (r.fehler) return { fehler: r.fehler };
    simStandUebernehmen(r.stand);
    simSpiegeln(text);
    simMelden();
    simLedgerZeigen();
    return { ok: true };
  });
}
// Kopie in localStorage auf den maßgeblichen Stand bringen (vor dem Export einer Sicherung)
function simSpiegelAktualisieren() {
  return simTransaktion(() => ({ abbruch: "lesen" })).then((r) => { if (!r.fehler && r.stand) simSpiegeln(r.stand.text); return r; });
}
// ---------- Wiederherstellung und Abgleich zwischen Tabs (ab 11-06d, Nachtrag 43 a/b) ----------
// Einen Eintrag nur lesen (z. B. „migration“); Ergebnis { eintrag } (null = fehlt) | { fehler }
function simEintragLesen(id) {
  return simDbOeffnen().then((o) => new Promise((ok) => {
    if (!o.db) { ok({ fehler: o.fehler }); return; }
    try {
      const g = o.db.transaction(SIMDB.speicher, "readonly").objectStore(SIMDB.speicher).get(id);
      g.onsuccess = () => ok({ eintrag: g.result || null });
      g.onerror = () => ok({ fehler: "Lesen gescheitert" });
    } catch (e) { SIMDB.db = null; ok({ fehler: "Lesen nicht möglich (" + e.name + ")" }); }
  }));
}
// Sicherung „migration“ (alter localStorage-Stand bei der Umstellung) zurückholen. Nicht zerstörend: in DERSELBEN Transaktion wird
// der bisherige Stand als „vor-wiederherstellung“ gesichert (ersetzt nur eine frühere solche Sicherung); die Sicherung „migration“
// bleibt unverändert. Eine beschädigte Sicherung wird nie übernommen. Andere Tabs rechnen danach über die Revision neu (Konflikt).
function simMigrationWiederherstellen() {
  if (SIM.uhr) simStoppen();
  const sperre = simSperrgrund() || (SIM.arbeit ? "Ein Schreibvorgang der Simulation läuft noch – bitte gleich erneut versuchen." : null);
  if (sperre) { simEl("sim-ergebnis").textContent = "Nicht wiederhergestellt: " + sperre; return Promise.resolve(); }
  if (!confirm("Stand vor der Speicherumstellung wiederherstellen?\n\nDer jetzige Simulationsstand wird nicht gelöscht, sondern als „vor Wiederherstellung“ gesichert. Betrifft nur die lokale Simulation.")) return Promise.resolve();
  SIM.arbeit = simDbOeffnen().then((o) => new Promise((ok) => {
    if (!o.db) { ok({ fehler: o.fehler }); return; }
    let tx;
    try { tx = o.db.transaction(SIMDB.speicher, "readwrite"); } catch (e) { SIMDB.db = null; ok({ fehler: "Transaktion nicht möglich (" + e.name + ")" }); return; }
    const st = tx.objectStore(SIMDB.speicher);
    let ergebnis = null;
    const gm = st.get("migration");
    gm.onsuccess = () => {
      const m = gm.result;
      if (!m || typeof m.text !== "string") { ergebnis = { abbruch: "Es gibt keine Sicherung aus der Speicherumstellung." }; return; }
      if (!simAusText(m.text)) { ergebnis = { abbruch: "Die Sicherung aus der Speicherumstellung ist beschädigt und wird nicht übernommen (sie bleibt unverändert erhalten)." }; return; }
      const ga = st.get(SIMDB.id);
      ga.onsuccess = () => {
        const alt = ga.result || null;
        if (alt && alt.text === m.text) { ergebnis = { abbruch: "Der aktuelle Stand entspricht bereits der Sicherung – nichts geändert.", stand: alt }; return; }
        const zeit = new Date().toISOString();
        if (alt) st.put({ id: "vor-wiederherstellung", rev: alt.rev, text: alt.text, zeit });
        const neu = { id: SIMDB.id, rev: (alt ? alt.rev : 0) + 1, text: m.text, geaendert: zeit };
        st.put(neu);
        ergebnis = { stand: neu, gesichert: Boolean(alt), migrationZeit: m.zeit };
      };
    };
    tx.oncomplete = () => ok(ergebnis || { fehler: "keine Antwort der Datenbank" });
    tx.onabort = () => ok({ fehler: "Schreiben abgebrochen (" + ((tx.error && tx.error.name) || "unbekannt") + ")" });
  })).then((r) => {
    if (r.stand) simStandUebernehmen(r.stand);
    if (r.stand && !r.abbruch) { simSpiegeln(r.stand.text); simMelden(); }
    simEl("sim-ergebnis").textContent = r.fehler ? "Nicht wiederhergestellt: " + r.fehler + " – der gespeicherte Stand ist unverändert."
      : r.abbruch ? "Nicht wiederhergestellt: " + r.abbruch
        : "Stand vor der Speicherumstellung (" + simDatum(r.migrationZeit) + ") wiederhergestellt" + (r.gesichert ? "; der vorherige Stand ist als „vor Wiederherstellung“ gesichert." : ".");
    simEl("sim-detail").textContent = "";
    simVorschau();
    simLedgerZeigen();
    return r;
  }).finally(() => { SIM.arbeit = null; });
  return SIM.arbeit;
}
// Knopf nur zeigen, wenn eine gültige Sicherung „migration“ existiert
function simMigrationKnopf() {
  return simEintragLesen("migration").then((r) => { simEl("sim-migration").hidden = !(r.eintrag && typeof r.eintrag.text === "string" && simAusText(r.eintrag.text)); });
}
// Abgleich zwischen Tabs: nach jedem abgeschlossenen Schreiben eine Nachricht (BroadcastChannel; ältere Browser: storage-Ereignis der
// Kopie in localStorage). Empfänger lesen den maßgeblichen Stand aus IndexedDB – die Nachricht selbst trägt keine Daten. Ein offener
// Paper-Vorschlag, der auf dem alten Stand berechnet wurde, wird verworfen (nie auf einem anderen Stand buchen).
const SIM_KANAL = typeof BroadcastChannel === "function" ? new BroadcastChannel("jarvis-paper") : null;
function simMelden() { try { if (SIM_KANAL) SIM_KANAL.postMessage({ art: "geaendert", rev: SIM.rev }); } catch (e) { /* nur Anzeige */ } }
function simFremdGeaendert() {
  // Laufende Historische Simulation: nicht übernehmen – ihr nächster Schritt erkennt den Konflikt und hält an (wie 06c)
  if (!SIM.bereit || SIM.uhr) return Promise.resolve(false);
  // Gerade schreibt dieses Fenster: danach einmal nachsehen
  if (SIM.arbeit) { if (!SIM.nachsehen) { SIM.nachsehen = true; SIM.arbeit.finally(() => setTimeout(() => { SIM.nachsehen = false; simFremdGeaendert(); }, 0)); } return Promise.resolve(false); }
  SIM.arbeit = simTransaktion(() => ({ abbruch: "lesen" })).then((r) => {
    if (r.fehler || (r.stand ? r.stand.rev : 0) === SIM.rev) return false;
    simStandUebernehmen(r.stand);
    if (APROFIL.vorschlag && APROFIL.vorschlagRev !== SIM.rev) {
      APROFIL.vorschlag = null;
      profilVorschlagZeigen("Vorschlag verworfen – die Simulation wurde in einem anderen Tab geändert (aktueller Stand geladen). Bitte einen neuen Vorschlag erstellen; nichts gebucht.");
    }
    simVorschau();
    simLedgerZeigen();
    simEl("sim-ergebnis").textContent = "Stand aus einem anderen Tab übernommen (" + new Date().toLocaleTimeString("de-DE") + ").";
    return true;
  }).finally(() => { SIM.arbeit = null; });
  return SIM.arbeit;
}
if (SIM_KANAL) SIM_KANAL.onmessage = (e) => { if (e.data && e.data.art === "geaendert") simFremdGeaendert(); };
window.addEventListener("storage", (e) => { if (e.key === SIM.schluessel) simFremdGeaendert().then(() => simAltVersionPruefen()); });
// ---------- Andere JARVIS-Version in einem anderen Tab (ab 11-06d) ----------
// Zuverlässig erkennbar sind nur zwei Fälle: (1) Tabs ab 11-06d melden ihren Stand über BroadcastChannel „jarvis-version“ – weicht er ab,
// zeigen beide einen Hinweis. (2) Versionen vor 11-06c schreiben die Simulation nur in localStorage: ändert sich dort der Text, ohne
// dass IndexedDB ihn enthält, schreibt ein älterer Tab – seine Buchungen gelten nicht. Ältere Tabs selbst können nichts anzeigen.
// ab 14za (Hotfix 14.11.2026): Kennung mit bis zu zwei Buchstaben (nach „z“ folgt „za“) – der Zeichenkettenvergleich unten bleibt sortierrichtig
const JARVIS_STAND = (((document.getElementById("stand-kennung") || {}).textContent || "").match(/v[\d.]+-\d{4}-\d{2}-\d{2}[a-z]{0,2}/) || [""])[0];
const VERSION_KANAL = typeof BroadcastChannel === "function" ? new BroadcastChannel("jarvis-version") : null;
const VERSION_HINWEISE = new Map();
function versionHinweisSetzen(art, text) {
  if (text) VERSION_HINWEISE.set(art, text); else VERSION_HINWEISE.delete(art);
  const el = document.getElementById("version-hinweis");
  el.textContent = [...VERSION_HINWEISE.values()].join(" ");
  el.hidden = !VERSION_HINWEISE.size;
}
// Versionskennungen gleichen Aufbaus sind als Text vergleichbar (v0.9-2026-11-06c < v0.9-2026-11-06d)
function versionVergleichen(fremd) {
  if (!JARVIS_STAND || typeof fremd !== "string" || !/^v[\d.]+-\d{4}-\d{2}-\d{2}[a-z]{0,2}$/.test(fremd) || fremd === JARVIS_STAND) return;
  versionHinweisSetzen("fremd", fremd > JARVIS_STAND
    ? `⚠ In einem anderen Tab ist die neuere JARVIS-Version ${fremd} geöffnet (dieser Tab: ${JARVIS_STAND}). Bitte diesen Tab neu laden, damit alle Tabs dieselben Regeln und denselben Speicher nutzen.`
    : `⚠ In einem anderen Tab läuft noch die ältere JARVIS-Version ${fremd} (dieser Tab: ${JARVIS_STAND}). Bitte den anderen Tab neu laden.`);
}
if (VERSION_KANAL) {
  VERSION_KANAL.onmessage = (e) => {
    const m = e.data || {};
    if (m.art === "hallo") { try { VERSION_KANAL.postMessage({ art: "antwort", stand: JARVIS_STAND }); } catch (x) { /* nur Hinweis */ } }
    if (m.art === "hallo" || m.art === "antwort") versionVergleichen(m.stand);
  };
  try { VERSION_KANAL.postMessage({ art: "hallo", stand: JARVIS_STAND }); } catch (x) { /* nur Hinweis */ }
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("simulation");
