// JARVIS Dashboard – Modul „aktienanalyse“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).
// ---------- US-Aktie analysieren (Ablauf nach Trader Skill, ab 2026-11-01b) ----------
// Verbindet vorhandene Werkzeuge über AktienWorkflow. Datenquelle „lokal“: synthetische Testdaten ohne Netz; „worker“: die vorhandenen
// Lese-Routen (/aktien/kerzen, /aktien/status, SEC nur mit SEC_USER_AGENT). Nie eine Order, kein Freigabecode.
// lauf: Nummer des aktuellen Laufs – ein abgebrochener oder überholter Lauf darf sein spätes Ergebnis nicht mehr anzeigen
// abbruch (ab 11-02x): AbortController des laufenden Laufs – „Abbrechen“ beendet auch die Worker-Anfragen dieses Laufs
const ABLAUF = { laeuft: false, zeitlimitMs: 15000, lauf: 0, abbruch: null };
// Laufende Analyse abbrechen (ab 11-02b): Oberfläche sofort frei; Worker-Anfragen des Laufs werden abgebrochen (ab 11-02x), ein
// dennoch spät eintreffendes Ergebnis wird verworfen und nicht in den Kerzen-Cache geschrieben
function ablaufAbbrechen() {
  if (!ABLAUF.laeuft) return false;
  ABLAUF.lauf++;
  ABLAUF.laeuft = false;
  // ab 14d (Nr. 11, Nachtrag): auch nach Abbruch der Analyse den Sperrgrund neu zeichnen
  if (!APROFIL.vorschlag && !APROFIL.laeuft && /^Bestätigen gesperrt: Analyse läuft/.test(ablaufEl("profil-vorschlag-text").textContent)) profilVorschlagZeigen();
  if (ABLAUF.abbruch) { ABLAUF.abbruch.abort(); ABLAUF.abbruch = null; }
  const knopf = ablaufEl("ablauf-start");
  knopf.disabled = false;
  knopf.removeAttribute("aria-busy");
  ablaufEl("ablauf-abbrechen").hidden = true;
  ablaufEl("ablauf-kopf").textContent = "Analyse abgebrochen – ein später eintreffendes Ergebnis wird verworfen. Nichts wurde gesendet; die bisherigen Ergebnisse bleiben unverändert.";
  if (typeof einschaetzungStatus === "function") einschaetzungStatus("Analyse abgebrochen – keine aktuelle Einschätzung. Für eine Einschätzung erneut „Analysieren“.");
  knopf.focus();
  return true;
}
const ablaufEl = (id) => document.getElementById(id);
// Meldungen für den Ablauf: nur Ergebnisse, die in dieser Sitzung in 13F-Tracker bzw. Kongress-Leser schon geprüft wurden (keine Anfrage)
function ablaufSitzungsMeldungen() {
  return { f13: WZ.letzte13F ? [WZ.letzte13F] : [], kongress: WZ.letzteKongress || [], form4: null };
}
// Fehlertexte des Workers ohne Schlüssel/Tokens weitergeben (ab 11-03b): Sie erscheinen sonst ungefiltert als Schrittmeldung des
// Ablaufs (über JarvisDaten.abrufen), nicht nur im catch von ablaufStarten. Fehlermerkmale (abgebrochen, netzwerk …) bleiben erhalten.
async function ohneGeheimnis(f) {
  try { return await f(); } catch (e) {
    const text = geheimnisseEntfernen(String((e && e.message) || e).split("\n")[0], { fehlertext: true }).slice(0, 300);
    throw Object.assign(new Error(text), e && typeof e === "object" ? { abgebrochen: e.abgebrochen, netzwerk: e.netzwerk, zeitlimit: e.zeitlimit, status: e.status } : {});
  }
}
// abbruch (ab 11-02x): AbortController des Laufs; die Worker-Anfragen dieses Providers enden mit „Analyse abbrechen“
function ablaufProvider(art, abbruch = null) {
  if (art !== "worker") return { ...window.AktienWorkflow.testProvider({ jetzt: Date.now() }), async meldungen() { return ablaufSitzungsMeldungen(); } };
  const secFakten = async (symbol) => {
    const st = await wzStatus({ abbruch });
    if (!st.sec_konfiguriert) throw new Error("SEC nicht eingerichtet (Worker-Variable SEC_USER_AGENT fehlt)");
    const c = await wzSecCik(symbol, { abbruch });
    return workerAnfrage(`/aktien/quelle?art=sec-fakten&cik=${c.cik}`, { method: "GET", abbruch });
  };
  // Form 4 nur als Liste aus SEC „submissions“ des Emittenten (vorhandene Route, nur mit SEC_USER_AGENT); dazu Sitzungsergebnisse
  const meldungen = async (symbol) => {
    const basis = ablaufSitzungsMeldungen();
    const st = await wzStatus({ abbruch });
    if (!st.sec_konfiguriert) return basis;
    const c = await wzSecCik(symbol, { abbruch });
    return { ...basis, form4: { submissions: await workerAnfrage(`/aktien/quelle?art=sec-meldungen&cik=${c.cik}`, { method: "GET", abbruch }), cik: String(Number(c.cik)) } };
  };
  return {
    name: "Worker (Alpaca IEX)", beschreibung: "Tageskerzen über /aktien/kerzen, Börsenuhr über /aktien/status, SEC companyfacts nur mit SEC_USER_AGENT", synthetisch: false, arten: ["kerzen"],
    kerzen: ({ symbol }) => ohneGeheimnis(async () => (await wzKerzen(symbol, 300, { abbruch })).kerzen),
    uhr: () => ohneGeheimnis(async () => (await wzStatus({ abbruch })).uhr || null),
    secFakten: (symbol) => ohneGeheimnis(() => secFakten(symbol)),
    meldungen: (symbol) => ohneGeheimnis(() => meldungen(symbol)),
    // ab Folgeauftrag nach 14q: Hauptdokument des gewählten 10-K/20-F über die feste Worker-Route sec-archiv-htm (nur SEC-Archiv,
    // nur .htm/.html, Größen- und Zeitgrenze im Worker); Text wird nur gelesen, nicht gespeichert
    // ab 14t mit Abrufzeit und Cache-Angabe des Workers
    secDokument: (b) => ohneGeheimnis(async () => { const r = await wzRohMitKopf(`/aktien/quelle?art=sec-archiv-htm&cik=${b.cik}&akz=${b.akz}&datei=${encodeURIComponent(b.dokument)}`); return { html: new TextDecoder("utf-8").decode(r.puffer), abgerufen: r.abgerufen, cache: r.cache }; }),
  };
}
// Ein Analyselauf lädt jede Kerzenreihe genau einmal (ab 11-02x): Chart, Einordnung und Strategie-Vergleich (profilEingaben) sowie
// Scanner, Entry-Timer, Exit-Planer und Simulation (AktienWorkflow über den Dispatcher) erhalten dieselbe Antwort. Vorher fragten
// beide Wege getrennt – lief der 5-Minuten-Cache dazwischen ab, rechneten sie mit zwei verschiedenen Datenständen.
// Nur für diesen Lauf gemerkt (kein zusätzlicher Cache); ein Fehler gilt für beide Wege gleich.
function ablaufEinmalKerzen(provider) {
  const geladen = new Map();
  return { ...provider, kerzen(anfrage) {
    const schluessel = String(anfrage && anfrage.symbol) + "|" + String(anfrage && anfrage.intervall);
    if (!geladen.has(schluessel)) geladen.set(schluessel, Promise.resolve().then(() => provider.kerzen(anfrage)));
    return geladen.get(schluessel);
  } };
}
// Fehlerstatus für Hilfstechnik (ab 11-02k): aria-invalid nur bei einem gemeldeten Fehler; neue Eingabe setzt ihn zurück (siehe Listener)
function feldUngueltig(id, ungueltig) {
  const f = document.getElementById(id);
  if (!f) return;
  if (ungueltig) f.setAttribute("aria-invalid", "true"); else f.removeAttribute("aria-invalid");
}
function ablaufAllowlist() {
  const g = AKTIEN && AKTIEN.grenzen && AKTIEN.grenzen.erlaubteSymbole;
  return g && Array.isArray(g.liste) && !g.fehler ? g.liste : null;
}
async function ablaufStarten(ev) {
  if (ev) ev.preventDefault();
  if (ABLAUF.laeuft) return;
  const art = ablaufEl("ablauf-quelle").value;
  if (art === "worker" && !verbunden()) { ablaufEl("ablauf-kopf").textContent = "Für die Datenquelle „Worker“ zuerst im Cockpit die Verbindung einrichten – oder lokale Testdaten wählen."; return; }
  const sprung = Number(ablaufEl("ablauf-sprung").value), spanne = Number(ablaufEl("ablauf-spanne").value);
  const ausreisser = sprung > 0 && spanne > 0 ? { maxSprungPct: sprung, maxSpannePct: spanne } : null;
  ABLAUF.laeuft = true;
  const meinLauf = ++ABLAUF.lauf;
  const ueberholt = () => meinLauf !== ABLAUF.lauf;
  const abbruch = typeof AbortController === "function" ? new AbortController() : null;
  ABLAUF.abbruch = abbruch;
  const knopf = ablaufEl("ablauf-start");
  knopf.disabled = true;
  knopf.setAttribute("aria-busy", "true");
  ablaufEl("ablauf-abbrechen").hidden = false;
  ablaufEl("ablauf-kopf").textContent = "Analysiere … (Abbrechen jederzeit möglich)";
  // ab Analyseauftrag 1311: während des Laufs keine Einschätzung des vorigen Laufs als aktuell zeigen
  if (typeof einschaetzungStatus === "function") einschaetzungStatus("Analyse läuft – die Einschätzung folgt, sobald alle Daten dieses Laufs da sind.");
  try {
    if (art === "worker") { try { const st = await wzStatus({ abbruch }); if (st && st.grenzen) AKTIEN.grenzen = st.grenzen; } catch (e) { /* Allowlist bleibt unbekannt */ } }
    if (ueberholt()) return;
    const provider = ablaufEinmalKerzen(ablaufProvider(art, abbruch));
    const optionen = { jetzt: Date.now(), zeitlimitMs: ABLAUF.zeitlimitMs, allowlist: ablaufAllowlist(), ausreisser,
      simulation: { strategie: SIM.strategie, orderWert: SIM.orderWert, annahmen: SIM.annahmen, limits: SIM.limits, startkapital: SIM.startkapital, ausreisser: SIM.ausreisser } };
    // Aktienprofil (ab 11-01d): Kontext zuerst prüfen; gültig → alle Werkzeuge über den Dispatcher, sonst nur die Eingabe-Blockade
    // Zeitraum (optional): nur „bis“ → Fehler; nur „von“ → bis heute; ungültig/Zukunft → kein Werkzeug startet
    const zvon = ablaufEl("ablauf-von").value, zbis = ablaufEl("ablauf-bis").value;
    const zr = zvon || zbis ? (zvon ? window.AktienAssistent.zeitraumAufloesen({ von: zvon, bis: zbis || null }, optionen.jetzt) : { fehler: "Zeitraum ungültig: „von“ fehlt." }) : null;
    feldUngueltig("ablauf-von", Boolean(zr && zr.fehler));
    feldUngueltig("ablauf-bis", Boolean(zr && zr.fehler));
    if (zr && zr.fehler) {
      // ab 11-02t: Schritte und Blockaden des vorigen Laufs nicht unter dem Fehler stehen lassen
      ablaufErgebnisLeeren("Zeitraum ungültig – nichts analysiert.");
      ablaufEl("ablauf-kopf").textContent = "✖ " + zr.fehler + " Nichts wurde analysiert.";
      ablaufEl("profil-zusammenfassung").textContent = "Aktienprofil nicht erstellt: " + zr.fehler + " Kein Werkzeug wurde gestartet.";
      ablaufEl("profil-sektionen").replaceChildren();
      ablaufChartLeeren(zr.fehler + " Nichts wurde analysiert.");
      APROFIL.letztes = null;
      APROFIL.letzteDispatch = null;
      ablaufEingabeHinweis();
      return;
    }
    const kx = window.AktienProfil.kontextNeu({ symbol: ablaufEl("ablauf-symbol").value, quelle: art, sitzung: { id: APROFIL.sitzung }, jetzt: optionen.jetzt, zeitraum: zr });
    APROFIL.vorschlag = null;
    profilVorschlagZeigen();
    feldUngueltig("ablauf-symbol", !kx.ok && kx.fehler.some((f) => /Symbol/.test(f)));
    if (!kx.ok) {
      const nurBlockade = await window.AktienWorkflow.analysieren({ symbol: ablaufEl("ablauf-symbol").value }, provider, optionen);
      if (ueberholt()) return;
      ablaufZeigen(nurBlockade);
      ablaufChartLeeren(kx.fehler.join(" ") + " Keine Kursdaten geladen.");
      ablaufEl("profil-zusammenfassung").textContent = "Aktienprofil nicht erstellt: " + kx.fehler.join(" ") + " Kein Werkzeug wurde gestartet.";
      ablaufEl("profil-sektionen").replaceChildren();
      APROFIL.letztes = null;
      ablaufEingabeHinweis();
      return;
    }
    const eingaben = await profilEingaben(kx.kontext, provider, optionen);
    if (ueberholt()) return;
    const d = await window.AktienProfil.dispatch(kx, eingaben);
    if (ueberholt()) return; // abgebrochen: spätes Ergebnis nicht als aktuell anzeigen
    const analyse = d.ergebnisse.find((x) => x.modul === "analyse");
    if (analyse && analyse.daten) {
      ablaufZeigen(analyse.daten);
      const einordnung = ablaufEinordnung(analyse.daten, eingaben._kerzen);
      ablaufEinordnungZeigen(einordnung, analyse.daten.quelle);
      ablaufChartZeigen(analyse.daten, eingaben._kerzen, einordnung);
    } else {
      // ab 11-02r: ohne Analysedaten keine Reste des vorigen Laufs stehen lassen
      ablaufEl("ablauf-kopf").textContent = `${kx.kontext.symbol} · kein Analyseergebnis – ${analyse ? analyse.zeilen.join(" ") || "Status " + analyse.status : "Analysebereich fehlt"}`;
      ablaufErgebnisLeeren("Kein Analyseergebnis in diesem Lauf.");
    }
    // Zeitraum-Zeile (ab 11-02r): „alle verfügbaren Tageskerzen“ nur, wenn auch wirklich Kerzen verwendet wurden
    const nK = analyse && analyse.daten && analyse.daten.kerzen_anzahl > 0 ? analyse.daten.kerzen_anzahl : 0;
    ablaufEl("ablauf-kopf").textContent += kx.kontext.zeitraum
      ? `\nZeitraum: ${kx.kontext.zeitraum.von} bis ${kx.kontext.zeitraum.bis} (deine Vorgabe; Kursdaten und daraus berechnete Schritte)` + (nK ? "" : " – darin keine Tageskerzen")
      : nK ? "\nZeitraum: keiner angegeben – alle verfügbaren Tageskerzen verwendet" : "\nZeitraum: keiner angegeben";
    // ab 11-02t: nur teilweise abgedeckter Zeitraum. Toleranz 4 Kalendertage (Wochenende plus ein Feiertag – an diesen Tagen gibt es
    // keine Tageskerzen); was darüber hinaus fehlt, wird genannt statt still einen kürzeren Zeitraum zu zeigen
    const hk = eingaben._kerzen && Array.isArray(eingaben._kerzen.kerzen) ? eingaben._kerzen.kerzen : null;
    // ab Trader-Auftrag (B-03): erste und letzte verwendete Tageskerze immer im Kopf – vorher nur im Chart-Titel und in der Einordnung
    // (ohne Chart, z. B. unter 5 Kerzen, fehlte das erste Datum)
    if (nK && hk && hk.length === nK && Number.isFinite(hk[0].t) && Number.isFinite(hk[hk.length - 1].t)) ablaufEl("ablauf-kopf").textContent += `\nDatenzeitraum der Kerzen: ${new Date(hk[0].t).toISOString().slice(0, 10)} bis ${new Date(hk[hk.length - 1].t).toISOString().slice(0, 10)}`;
    if (kx.kontext.zeitraum && nK && hk && hk.length === nK) {
      const tagIso = (t) => new Date(t).toISOString().slice(0, 10);
      const tageAbstand = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
      const erste = tagIso(hk[0].t), letzte = tagIso(hk[hk.length - 1].t), z = kx.kontext.zeitraum;
      const luecken = [tageAbstand(z.von, erste) > 4 ? `Kerzen erst ab ${erste}` : "", tageAbstand(letzte, z.bis) > 4 ? `Kerzen nur bis ${letzte}` : ""].filter(Boolean);
      if (luecken.length) ablaufEl("ablauf-kopf").textContent += `\nZeitraum nur teilweise abgedeckt: ${luecken.join(", ")} (gewünscht ${z.von} bis ${z.bis}) – alle Kennzahlen und der Chart beziehen sich nur auf ${erste} bis ${letzte}.`;
    }
    APROFIL.letztes ={ kontext: kx.kontext, analyse: analyse && analyse.daten, kurse: eingaben.kurse, kerzen: eingaben._kerzen };
    APROFIL.letzteDispatch = d;
    // Für die Watchlist (nur diese Sitzung): letzter Analysestand je Symbol
    if (analyse && analyse.daten) APROFIL.analysen[kx.kontext.symbol] = { quelle: analyse.daten.quelle ? analyse.daten.quelle.name + (analyse.daten.quelle.synthetisch ? " (synthetisch)" : "") : "?", synthetisch: Boolean(analyse.daten.quelle && analyse.daten.quelle.synthetisch), datenzeit: analyse.daten.datenzeit, frisch: analyse.daten.frisch, status: analyse.status, kurs: Number.isFinite(analyse.daten.kurs) ? analyse.daten.kurs : null, dispatch: d,
      // ab 11-06e: Kennzahlen des Screener-Schritts (für Vergleich und Watchlist-Sortierung) und Widersprüche dieses Laufs
      kennzahlen: (() => { const sch = analyse.daten.schritte || [], s = sch.find((x) => x.id === "screener-fundamental") || sch.find((x) => x.id === "screener-technisch"); return s && s.details ? s.details.kennzahlen || null : null; })(),
      widersprueche: analyse.daten.widersprueche || [] };
    ablaufZuletztZeigen(kx.kontext.symbol);
    // Neuer Lauf: altes Briefing und alter Strategie-Vergleich gelten nicht mehr als aktuell
    APROFIL.aktiv = kx.kontext.symbol;
    abUngueltig("neuer Analyselauf");
    wlZeigen();
    slZuruecksetzen();
    slVorschau();
    profilZeigen(d);
    ablaufEingabeHinweis();
    // Portfolio-Labor (ab 11-02u): Spalte „Analysedaten“ zeigt den neuen Stand dieser Sitzung
    if (typeof plZeigen === "function") plZeigen();
    // ab Trader produktiv (D-5): Simulationsübersicht mit dem Kurs dieser Analyse neu bewerten (vorher erst beim nächsten Neuzeichnen)
    if (typeof simLedgerZeigen === "function") simLedgerZeigen();
  } catch (e) {
    // Fehlertext ohne Schlüssel/Tokens und ohne Stacktrace (nur die erste Zeile, gekürzt)
    if (!ueberholt()) {
      ablaufEl("ablauf-kopf").textContent = "✖ Analyse abgebrochen: " + (e && e.message ? geheimnisseEntfernen(String(e.message).split("\n")[0], { fehlertext: true }).slice(0, 200) : "unbekannter Fehler") + " – nichts wurde gesendet.";
      // ab 11-02r: Ergebnisse des vorigen Laufs nicht als aktuell stehen lassen
      ablaufErgebnisLeeren("Kein Ergebnis – die Analyse wurde mit einem Fehler abgebrochen.");
      APROFIL.letztes = null;
      APROFIL.letzteDispatch = null;
      ablaufEingabeHinweis();
    }
  } finally {
    if (!ueberholt()) {
      ABLAUF.laeuft = false;
      // ab 14d (Nr. 11, Nachtrag aus der Gegenprobe V12): nach dem Ende der Analyse den Sperrgrund neu zeichnen – sonst bliebe „Analyse läuft“ stehen
      if (!APROFIL.vorschlag && !APROFIL.laeuft && /^Bestätigen gesperrt: Analyse läuft/.test(ablaufEl("profil-vorschlag-text").textContent)) profilVorschlagZeigen();
      ABLAUF.abbruch = null;
      knopf.disabled = false;
      knopf.removeAttribute("aria-busy");
      ablaufEl("ablauf-abbrechen").hidden = true;
    }
  }
}
// ---------- Aktienprofil im Dashboard (ab 11-01d) ----------
const APROFIL = { sitzung: "s-" + Date.now().toString(36), vorschlag: null, letztes: null, laeuft: false, letzteDispatch: null, analysen: {}, vorlesen: false,
  aktiv: null, briefing: null, briefingText: null, strategie: null, strategieVorher: null, vorlese: { aktiv: false, gesehen: false, pausiert: false, abgebrochen: false, statusVorher: "" } };
function profilZiele() {
  const t = String(ablaufEl("profil-ziele").value || "").trim();
  if (!t) return [];
  const r = window.AktienBudget.zieleLesen(t.replace(/,\s*/g, "\n"));
  return r.fehler && r.fehler.length ? null : r.ziele;
}
// Eingaben nur aus dem, was in dieser Sitzung vorliegt – nichts wird erfunden. Kurse über dieselbe Datenquelle (Frische laut Entry-Timer-Regel).
async function profilEingaben(k, provider, optionen) {
  const port = SIM.portfolio || window.PaperKern.portfolioNeu({ startkapital: SIM.startkapital });
  const ziele = profilZiele();
  const symbole = [...new Set([k.symbol, ...Object.keys(port.positionen), ...((ziele || []).map((z) => z.symbol))])].slice(0, 10);
  const kurse = {};
  let hauptKerzen = null;
  for (const s of symbole) {
    const e = await window.JarvisDaten.abrufen(provider, "kerzen", { symbol: s, intervall: "1d", kalender: "boerse" }, { zeitlimitMs: ABLAUF.zeitlimitMs, jetzt: k.jetzt, maxAlterMs: window.AktienEinstieg.STANDARD.maxKerzenAlterTage * 86400000 });
    if (e.daten && e.daten.length) kurse[s] = { preis: e.daten[e.daten.length - 1].c, zeit: e.datenzeit, frisch: e.frisch === true };
    // Hauptsymbol: Kerzen für den Strategie-Vergleich im genannten Zeitraum; Kurse (Budget, Alarme) bleiben die aktuellen
    const imZeitraum = e.daten ? window.AktienProfil.kerzenImZeitraum(e.daten, k.zeitraum) : null;
    if (s === k.symbol) hauptKerzen = imZeitraum && imZeitraum.length ? { kerzen: imZeitraum, frisch: e.frisch, quelle: provider.name + (k.zeitraum ? ` (Zeitraum ${k.zeitraum.von} bis ${k.zeitraum.bis})` : ""), synthetisch: Boolean(provider.synthetisch), zeitraum: k.zeitraum } : null;
  }
  const al = wzAlarmeLesen();
  const kursSym = kurse[k.symbol];
  const news = WZ.letzteNews && (WZ.letzteNews.symbole || []).includes(k.symbol) ? WZ.letzteNews : null;
  let meldungen = null;
  try { meldungen = typeof provider.meldungen === "function" ? await provider.meldungen(k.symbol) : null; } catch (e) { meldungen = null; }
  const grenzen = AKTIEN.grenzen ? { ...AKTIEN.grenzen, betriebsart_gueltig: WZ.status && typeof WZ.status.betriebsart_gueltig === "boolean" ? WZ.status.betriebsart_gueltig : undefined } : null;
  return {
    provider, zeitlimitMs: optionen.zeitlimitMs, allowlist: optionen.allowlist, ausreisser: optionen.ausreisser, simulation: optionen.simulation,
    nachrichten: news, meldungen,
    // kuenstlich (ab 11-04i): Kurszeit lokaler Testdaten ist ein künstliches Datum – alarme.js nennt dann kein scheinbares Alter
    alarme: { regeln: al.regeln, zustand: al.zustand, beschaedigt: Boolean(al.beschaedigt), daten: { kurse: kursSym ? { [k.symbol]: { preis: kursSym.preis, alter_min: Math.round((k.jetzt - kursSym.zeit) / 60000), kuenstlich: Boolean(provider.synthetisch) } } : {}, quelle: provider.name } },
    budget: Number(ablaufEl("profil-budget").value) > 0 || (ziele && ziele.length) ? { betrag: Number(ablaufEl("profil-budget").value), ziele: ziele || [] } : null,
    rebalance: ziele && ziele.length ? { ziele } : null,
    grenzen, portfolio: port, kurse, _kerzen: hauptKerzen,
  };
}
function profilZeigen(d) {
  const zeichen = { ok: "✔", warnung: "⚠", blockiert: "✖", nicht_verfuegbar: "–", fehler: "✖", veraltet: "⏱", unbekannt: "?" };
  // ab 11-03f: Bei lokalen (synthetischen) Testdaten ist das Datum künstlich – kein scheinbares Datenalter wie „17 h alt“ zeigen
  const synthetisch = Boolean(d.kontext && d.kontext.quelle === "lokal");
  const alter = (ms) => (ms === null ? "Datenalter unbekannt" : synthetisch ? "künstliches Datum (synthetische Testdaten) – kein echtes Datenalter"
    : ms < 3600000 ? `${Math.round(ms / 60000)} min alt` : ms < 2 * 86400000 ? `${Math.round(ms / 3600000)} h alt` : `${Math.round(ms / 86400000)} Tage alt`);
  // Einheitliche Statusbegriffe (ab 11-02a): bereit, teilweise verfügbar, veraltet, blockiert, nicht verfügbar
  const S = window.AktienAssistent ? window.AktienAssistent.STATUS_TEXT : {};
  ablaufEl("profil-zusammenfassung").textContent = "Profil: " + (d.zusammenfassung.vollstaendig ? "bereit" : "teilweise verfügbar") + " – " + d.zusammenfassung.text + " Keine Empfehlung, keine Prognose, keine Order.";
  ablaufEl("profil-sektionen").replaceChildren(...d.ergebnisse.map((e) => {
    const li = document.createElement("li");
    li.dataset.status = e.status === "fehler" || e.status === "unbekannt" ? "blockiert" : e.status === "veraltet" ? "warnung" : e.status;
    li.dataset.modul = e.modul;
    li.dataset.profilStatus = e.status;
    const kopf = document.createElement("div");
    kopf.textContent = `${zeichen[e.status] || ""} ${e.titel} · Status: ${S[e.status] || e.status} · Einordnung: ${e.einordnung}${e.skill ? " (" + e.skill + ")" : ""} · Quelle: ${e.quellen.join(", ") || "–"} · ${alter(e.datenalter_ms)}`;
    li.append(kopf);
    for (const z of e.modul === "analyse" ? [] : e.zeilen) li.append(Object.assign(document.createElement("div"), { className: "klein", textContent: z }));
    if (e.modul === "nachrichten" && e.daten && e.daten.gruppen) {
      for (const g of e.daten.gruppen) {
        const det = document.createElement("details");
        det.append(Object.assign(document.createElement("summary"), { textContent: "Detail: " + g.titel }));
        for (const x of g.details) {
          det.append(Object.assign(document.createElement("div"), { className: "klein", textContent: `${x.quelle} · ${x.zeit_text} · Zuordnung: ${x.zuordnung}${x.anweisung ? " · enthält anweisungsartigen Text (nicht befolgt)" : ""}` }));
          if (x.text) det.append(Object.assign(document.createElement("blockquote"), { className: "klein", textContent: x.text }));
          if (x.link) det.append(wzLink(x.link, "Quelle öffnen"));
        }
        li.append(det);
      }
    }
    if (e.unsicherheiten.length) li.append(Object.assign(document.createElement("div"), { className: "klein", textContent: "Unsicher: " + e.unsicherheiten.join(" · ") }));
    for (const b of e.blockaden) li.append(Object.assign(document.createElement("div"), { className: "klein wz-wichtig", textContent: "Blockiert: " + b.grund + " → " + b.naechster_schritt }));
    return li;
  }));
}
// ab 14a: der gesperrte Bestätigen-Knopf nennt immer seinen Grund (vorher leeres Statusfeld während Laden und nach Fehlern);
// derselbe Text steht beim Seitenstart in index.html (#profil-vorschlag-text)
const PROFIL_OHNE_VORSCHLAG = "Bestätigen gesperrt: noch kein Paper-Vorschlag. Erst analysieren, dann „Paper-Vorschlag erstellen“ – gebucht wird nur Spielgeld.";
function profilVorschlagZeigen(text) {
  const v = APROFIL.vorschlag;
  // ab 11-13r: bei nicht bestandener Risikoprüfung gesperrt (vorher klickbar; die Bestätigung lehnte dann nur ab – bleibt als zweite Schutzschicht)
  // ab 14d (Nr. 11): auch abgelaufen, Not-Aus und laufende Analyse sperren den Knopf und nennen den Grund (der Kern lehnt dort ohnehin ab)
  const abgelaufen = Boolean(v && Date.now() > v.gueltig_bis);
  const notausJetzt = typeof tradingZustand !== "undefined" && tradingZustand && tradingZustand.notaus === true ? true : SIM.limits.notaus;
  const analyseLaeuft = Boolean(typeof ABLAUF !== "undefined" && ABLAUF.laeuft);
  const speicher = typeof simSperrgrund === "function" ? simSperrgrund() : null; // ab Nachtauftrag nach 1580 (V12): Speicher nicht verfügbar
  const sperrgrund = v && (abgelaufen ? "Vorschlag abgelaufen – bitte neu erstellen" : notausJetzt !== false ? (notausJetzt === true ? "NOT-AUS aktiv" : "Not-Aus-Zustand unbekannt") : analyseLaeuft ? "Analyse läuft" : speicher ? speicher.replace(/\.$/, "") : null);
  ablaufEl("profil-bestaetigen").disabled = !v || !v.risiko.bestanden || Boolean(sperrgrund);
  // ab 14d (Paper-Auftrag bis 13.11.): zum Ablaufzeitpunkt selbst neu zeichnen – sonst wirkte der Knopf bis zum nächsten Neuzeichnen frei (der Kern lehnte dann ab)
  clearTimeout(APROFIL.ablaufUhr);
  if (v && !abgelaufen) APROFIL.ablaufUhr = setTimeout(() => { if (APROFIL.vorschlag === v) profilVorschlagZeigen(); }, Math.max(0, v.gueltig_bis - Date.now()) + 50);
  // ab 11-04h: wie profilZeigen (ab 11-03f) – bei lokalen (synthetischen) Testdaten kein scheinbares Datenalter
  const synthetisch = Boolean(APROFIL.letztes && APROFIL.letztes.kontext && APROFIL.letztes.kontext.quelle === "lokal");
  // ab 11-05b: Kostenannahmen vor der Bestätigung (Werte aus AktienProfil.vorschlagSchaetzen = späterer Paper-Kern-Aufruf)
  const s = v && APROFIL.vorschlagSchaetzung, usd = (x) => x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // ab Nachtauftrag 1000 (Nr. 28, G-04): sichtbarer Mindesthistorien-Status beim Vorschlag (nur Anzeige)
  const la = APROFIL.letztes && APROFIL.letztes.analyse, mh = v && la && Number.isFinite(la.kerzen_anzahl) && typeof profilMindestHistorie === "function" ? profilMindestHistorie() : null;
  const historie = mh ? ` · Kurshistorie ${(la.kerzen_anzahl - (la.letzte_laufend ? 1 : 0)).toLocaleString("de-DE")} gültige Tageskerzen (nötig mindestens ${mh.anzahl})` : "";
  // ab Trader-Auftrag (B-07, B-13): Hinweise derselben Analyse und beim Verkauf die gehaltene Position (nur Anzeige)
  const hinweise = v ? profilAnalyseHinweis(v) + profilPositionHinweis(v, s, usd) : "";
  // ab Analyseauftrag 1311 (V1/V2, nur Anzeige): Spielgeld vor und nach dieser Buchung (dieselbe Schätzung wie die Belastung) sowie
  // Datenquelle und Datenzeitraum der Analyse, aus der der Vorschlag stammt – bei nicht bestandener Prüfung kein „danach“
  const barVorher = SIM.portfolio ? SIM.portfolio.bargeld : SIM.startkapital;
  // ohne Tausenderpunkt (wie die übrigen Beträge dieses Texts unter 1.000; „10.000“ wäre mit einer Zahl mit Dezimalpunkt verwechselbar)
  const usdOhne = (x) => x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  const bargeld = v && s && v.risiko.bestanden && Number.isFinite(barVorher) && Number.isFinite(s.betrag) ? ` · Bargeld vorher ${usdOhne(barVorher)} USD, danach ca. ${usdOhne(Math.round((v.richtung === "kauf" ? barVorher - s.betrag : barVorher + s.betrag) * 100) / 100)} USD (Spielgeld)` : "";
  const L = APROFIL.letztes, lk = v && L && L.kontext && L.kontext.symbol === v.symbol && L.kerzen && Array.isArray(L.kerzen.kerzen) && L.kerzen.kerzen.length ? L.kerzen.kerzen : null;
  const tagIso = (t) => new Date(t).toISOString().slice(0, 10), lq = L && L.analyse && L.analyse.quelle;
  const va = v && APROFIL.vorschlagAnalyse && APROFIL.vorschlagAnalyse.symbol === v.symbol ? APROFIL.vorschlagAnalyse : null;
  const bezug = va ? ` · Grundlage: Analyse #${va.nr} von ${va.symbol} (${new Date(va.zeit).toLocaleTimeString("de-DE")})` : "";
  const herkunft = bezug + (lk && Number.isFinite(lk[0].t) && Number.isFinite(lk[lk.length - 1].t) ? ` · Datenquelle ${lq ? lq.name + (lq.synthetisch ? " (synthetisch)" : "") : "?"} · Datenzeitraum ${tagIso(lk[0].t)} bis ${tagIso(lk[lk.length - 1].t)}` : "");
  const kosten = s ? ` · Schätzung der lokalen Simulation (Testannahmen: Slippage ${s.annahmen.slippagePct.toLocaleString("de-DE")} %, Gebühr ${s.annahmen.gebuehrPct.toLocaleString("de-DE")} %): Ausführung zu ca. ${s.preis.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USD, ${s.menge.toLocaleString("de-DE", { maximumFractionDigits: 6 })} Stück (wird gebucht), Volumen ${usd(s.volumen)} USD ${v.richtung === "kauf" ? "+" : "−"} Gebühr ${usd(s.gebuehr)} USD = ${v.richtung === "kauf" ? "Belastung" : "Gutschrift"} ${usd(s.betrag)} USD (Spielgeld)` : "";
  ablaufEl("profil-vorschlag-text").textContent = text !== undefined ? text : !v && analyseLaeuft ? "Bestätigen gesperrt: Analyse läuft – danach einen neuen Paper-Vorschlag erstellen." : v
    ? `${sperrgrund ? `Bestätigen gesperrt: ${sperrgrund}. ` : ""}SIMULATION · ${v.richtung === "kauf" ? "KAUF" : "VERKAUF"} ${v.symbol} · ${v.stueck.toLocaleString("de-DE", { maximumFractionDigits: 6 })} Stück ${v.richtung === "kauf" ? "zum letzten Schluss, vor Slippage" : "(ganze Position)"} · geschätzt ${v.betrag_geschaetzt.toLocaleString("de-DE", { minimumFractionDigits: 2 })} USD zur Preisannahme ${v.preisannahme.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USD (letzter Schluss) · ${synthetisch ? "künstliches Datum (synthetische Testdaten) – kein echtes Datenalter" : `Datenalter ${Math.round(v.datenalter_ms / 3600000)} h`} · Risikoprüfung (Paper-Kern): ${v.risiko.bestanden ? "bestanden" : "nicht bestanden – " + v.risiko.gruende.join("; ")}${kosten}${bargeld}${historie}${herkunft}${hinweise} ·${v.risiko.bestanden ? "Status: OFFEN, noch nicht bestätigt – gebucht wird erst nach „Genau diesen Vorschlag bestätigen“" : "Status: Bestätigen gesperrt, weil die Risikoprüfung nicht bestanden ist – Betrag ändern und neu vorschlagen" + profilAusweg(v.risiko.gruende)} · gültig bis ${new Date(v.gueltig_bis).toLocaleTimeString("de-DE")} (danach neu erstellen) · Kennung ${v.fingerabdruck}. Keine Order an einen Broker.`
    : PROFIL_OHNE_VORSCHLAG;
}
// ab 14j (RISK-14): je Ablehnungsgrund des Paper-Kerns (Wortlaut bot/paper-kern.js:76–93) ein passender Ausweg – nur aus den dort
// genannten Grenzen, keine neue Regel; unbekannter Grund → kein Ausweg (bisheriger Text bleibt)
// ab 14n (AJ2-101/102): was tatsächlich gebucht wurde – ausschließlich aus dem neuen Ledger-Eintrag dieser Kennung und dem übernommenen
// Stand (nie aus dem Vorschlag); ohne Eintrag kein Text
function profilBuchungText(id) {
  const e = SIM.portfolio && Array.isArray(SIM.portfolio.ledger) ? SIM.portfolio.ledger.find((x) => x && x.trade_id === id && x.zustand === "gefuellt") : null;
  if (!e) return "";
  const geld = (x) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  return ` · Gebucht: ${e.seite === "verkauf" ? "VERKAUF" : "KAUF"} ${e.symbol} · ${Number(e.menge).toLocaleString("de-DE", { maximumFractionDigits: 6 })} Stück zu ${Number(e.preis).toLocaleString("de-DE", { maximumFractionDigits: 4 })} USD · Volumen ${geld(e.volumen)} USD + Gebühr ${geld(e.gebuehr)} USD · Bargeld jetzt ${geld(SIM.portfolio.bargeld)} USD`;
}
function profilAusweg(gruende) {
  const aus = [];
  for (const g of gruende || []) {
    const m = String(g);
    let x = "";
    if (/^Orderwert [\d.]+ über Höchstwert/.test(m)) x = `Betrag auf höchstens ${m.match(/Höchstwert ([\d.]+)/)[1]} USD senken`;
    else if (/^nicht genug Spielgeld/.test(m)) x = `kleineren Betrag wählen, sodass Betrag plus Gebühr das verfügbare Spielgeld${/verfügbar ([\d.,]+) USD/.test(m) ? " (" + m.match(/verfügbar ([\d.,]+) USD/)[1] + " USD)" : ""} nicht übersteigt, oder erst eine Position verkaufen`;
    else if (/^höchstens \d+ offene Positionen/.test(m)) x = "erst eine bestehende Position ganz verkaufen (Symbol der Position analysieren, Richtung „Verkauf“), dann neu vorschlagen";
    else if (/^Tagesverlust/.test(m)) x = "heute keine weitere Kauforder; morgen erneut versuchen oder die Simulation zurücksetzen";
    else if (/^Häufigkeitsgrenze/.test(m)) x = "warten, bis ältere Orders aus dem Zeitfenster fallen, oder die Simulation zurücksetzen";
    else if (/^NOT-AUS/.test(m)) x = "erst den Not-Aus aufheben – bis dahin keine Buchung";
    else if (/^Orderwert ungültig/.test(m)) x = "einen positiven Betrag eintragen";
    else if (/^keine simulierte Position/.test(m)) x = "Richtung „Kauf“ wählen oder ein Symbol analysieren, das im Simulations-Portfolio liegt";
    if (x && !aus.includes(x)) aus.push(x);
  }
  return aus.length ? " · So geht es weiter: " + aus.join("; ") : "";
}
// ab Trader-Auftrag (B-07): Entry-Timer und Exit-Planer der Analyse, aus der der Vorschlag stammt (gleiches Symbol) – nur zur Einordnung;
// sie sind keine Bedingung der Buchung, und es wird kein Stop gesetzt (der Paper-Kern kennt keine Stop-Orders)
function profilAnalyseHinweis(v) {
  const L = APROFIL.letztes;
  if (v.richtung !== "kauf" || !L || !L.kontext || L.kontext.symbol !== v.symbol || !L.analyse || !Array.isArray(L.analyse.schritte)) return "";
  const s = (id) => L.analyse.schritte.find((x) => x && x.id === id);
  const ein = s("einstieg"), aus = s("ausstieg"), teile = [];
  if (ein) teile.push(`Entry-Timer (${ein.status === "ok" ? "jetzt" : ein.status === "warnung" ? "warten" : "kein Einstieg/blockiert"}): ${ein.text}`);
  if (aus) teile.push(aus.status === "ok" ? `Exit-Planer: ${aus.text}` : `Exit-Planer nicht verfügbar: ${aus.text}`);
  return teile.length ? ` · Hinweise aus der Analyse von ${v.symbol} (nur zur Einordnung – keine Bedingung der Buchung, es wird kein Stop gesetzt): ${teile.join(" ")}` : "";
}
// ab Trader-Auftrag (B-13): Verkauf – gehaltene Position und erwartetes Ergebnis wie im Paper-Kern (Verkauf der ganzen Position verrechnet
// alle offenen Kaufgebühren); ohne bekannte Kaufgebühren keine Schätzung
function profilPositionHinweis(v, s, usd) {
  const pos = v.richtung === "verkauf" && SIM.portfolio && SIM.portfolio.positionen ? SIM.portfolio.positionen[v.symbol] : null;
  if (!pos) return "";
  const ergebnis = s && Number.isFinite(pos.kaufgebuehren) ? Math.round(((s.preis - pos.einstand) * s.menge - s.gebuehr - pos.kaufgebuehren) * 100) / 100 : null;
  return ` · Position im Simulations-Portfolio: ${pos.menge.toLocaleString("de-DE", { maximumFractionDigits: 6 })} Stück, Einstand ${pos.einstand.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USD`
    + (ergebnis !== null ? ` · erwartetes Ergebnis ca. ${ergebnis < 0 ? "−" : "+"}${usd(Math.abs(ergebnis))} USD nach Kauf- und Verkaufsgebühren (Schätzung, Spielgeld)` : " · erwartetes Ergebnis nicht schätzbar (Kaufgebühren unbekannt)");
}
// ab Nachtauftrag 1000 (Nr. 28): Mindesthistorie für Paper-Vorschläge – keine feste Zahl, sondern abgeleitet aus den Kennzahlen, die die Analyse
// tatsächlich nutzt: kleinste Zahl gültiger Tageskerzen, ab der jede Regel der technischen Screener-Vorlage, die Scanner-Signale (Trend, Kreuzung
// EMA50/EMA200 in den letzten 5 Kerzen, Ausbruch, Rücksetzer, RSI) und MACD/Bollinger an der bewerteten Kerze einen Wert haben. Ermittelt einmal
// mit einer synthetischen Hilfsreihe über dieselben Funktionen (AktienTechnik/AktienScreener, nur aufgerufen); die Hilfsrechnung zählt nicht als
// Indikatorberechnung der Analyse (Zähler wird zurückgestellt).
let PROFIL_MINDEST = null;
function profilMindestHistorie() {
  if (PROFIL_MINDEST) return PROFIL_MINDEST;
  const T = window.AktienTechnik, SC = window.AktienScreener;
  if (!T || !SC || !SC.VORLAGEN || !SC.VORLAGEN.technisch || typeof SC.kennzahlenAusKerzen !== "function") return null;
  const zaehler = T.RECHNUNGEN ? T.RECHNUNGEN.anzahl : null;
  const reihe = (n) => Array.from({ length: n }, (_, i) => { const c = 100 + 5 * Math.sin(i / 7); return { t: Date.UTC(2020, 0, 1) + i * 86400000, o: c, h: c + 1, l: c - 1, c, v: 1e6 + i }; });
  const wert = (x) => x !== null && x !== undefined && !Number.isNaN(x);
  const namen = SC.NAMEN || {};
  const teile = SC.VORLAGEN.technisch.rules.map((r) => ({ name: "Screener: " + (namen[r.metric] || r.metric).replace(/ %$| \(1\/0\)$/, ""), ok: (k) => wert(SC.kennzahlenAusKerzen(k, { jetzt: k[k.length - 1].t })[r.metric]) }));
  const ind = (k) => T.indikatoren(k), letzte = (k) => k.length - 1;
  teile.push({ name: "Trend (Kurs/EMA50/EMA200)", ok: (k) => wert(ind(k).ema200[letzte(k)]) && wert(ind(k).ema50[letzte(k)]) });
  teile.push({ name: "Kreuzung EMA50/EMA200 in den letzten 5 Kerzen", ok: (k) => letzte(k) >= 5 && wert(ind(k).ema200[letzte(k) - 5]) && wert(ind(k).ema50[letzte(k) - 5]) });
  teile.push({ name: "Ausbruch über/unter das 20-Kerzen-Hoch/-Tief", ok: (k) => wert(ind(k).hoch20[letzte(k)]) && wert(ind(k).tief20[letzte(k)]) && wert(ind(k).volVerhaeltnis[letzte(k)]) });
  teile.push({ name: "Rücksetzer an die EMA20", ok: (k) => wert(ind(k).ema20[letzte(k)]) });
  teile.push({ name: "RSI 14 / ATR 14", ok: (k) => wert(ind(k).rsi14[letzte(k)]) && wert(ind(k).atr14[letzte(k)]) });
  teile.push({ name: "MACD (12/26/9) mit Vortag", ok: (k) => { const m = T.macd(k.map((x) => x.c)); return letzte(k) >= 1 && wert(m.histogramm[letzte(k)]) && wert(m.histogramm[letzte(k) - 1]); } });
  teile.push({ name: "Bollinger 20", ok: (k) => wert(T.bollinger(k.map((x) => x.c)).oben[letzte(k)]) });
  const ergebnis = { anzahl: 1, grund: "letzter Schluss", teile: [] };
  try {
    for (const t of teile) {
      // kleinste Anzahl mit Wert (monoton: mehr Kerzen = nie weniger Werte); obere Schranke wie die Kerzenanforderung (300) mit Reserve
      let lo = 1, hi = 1000;
      if (!t.ok(reihe(hi))) return null;
      while (lo < hi) { const mitte = Math.floor((lo + hi) / 2); if (t.ok(reihe(mitte))) hi = mitte; else lo = mitte + 1; }
      ergebnis.teile.push({ name: t.name, anzahl: lo });
      if (lo > ergebnis.anzahl) { ergebnis.anzahl = lo; ergebnis.grund = t.name; }
    }
  } finally { if (zaehler !== null) T.RECHNUNGEN.anzahl = zaehler; }
  return (PROFIL_MINDEST = ergebnis);
}
function profilVorschlagErstellen() {
  const L = APROFIL.letztes;
  if (!L || !L.analyse || !Number.isFinite(L.analyse.kurs)) { profilVorschlagZeigen("Erst eine Analyse mit gültigen Kursdaten – ohne Preis kein Vorschlag."); return; }
  // ab 11-02t: kein Vorschlag für das zuletzt analysierte Symbol, wenn im Feld inzwischen ein anderes steht
  const feld = String(ablaufEl("ablauf-symbol").value || "").trim().toUpperCase();
  if (feld && feld !== L.kontext.symbol) { profilVorschlagZeigen(`Kein Vorschlag: Im Eingabefeld steht ${feld.slice(0, 12)}, die letzte Analyse gilt für ${L.kontext.symbol}. Erst ${feld.slice(0, 12)} analysieren.`); return; }
  // ab Nachtauftrag 1000 (Nr. 28): zu wenig gültige Tageskerzen → kein Vorschlag (läuft die letzte Kerze noch, wird sie nicht bewertet)
  const mindest = profilMindestHistorie();
  const gueltig = Number.isFinite(L.analyse.kerzen_anzahl) ? L.analyse.kerzen_anzahl - (L.analyse.letzte_laufend ? 1 : 0) : null;
  if (!mindest || gueltig === null) { APROFIL.vorschlag = null; profilVorschlagZeigen("Kein Paper-Vorschlag: Die nötige Kurshistorie ist nicht bestimmbar – nichts gebucht."); return; }
  if (gueltig < mindest.anzahl) {
    APROFIL.vorschlag = null;
    profilVorschlagZeigen(`Kein Paper-Vorschlag: zu wenig Kursdaten – ${gueltig} gültige Tageskerze${gueltig === 1 ? "" : "n"} vorhanden, nötig sind mindestens ${mindest.anzahl} (längster Rückblick der Analyse: ${mindest.grund}). Erst mit längerer Kurshistorie neu analysieren – nichts gebucht.`);
    return;
  }
  if (L.analyse.frisch === false) { profilVorschlagZeigen("Kursdaten veraltet – kein Paper-Vorschlag."); return; }
  const al = ablaufAllowlist();
  if (al && !al.includes(L.kontext.symbol)) { profilVorschlagZeigen(`${L.kontext.symbol} steht nicht in der Allowlist – kein Vorschlag.`); return; }
  const port = SIM.portfolio || window.PaperKern.portfolioNeu({ startkapital: SIM.startkapital });
  const richtung = ablaufEl("profil-richtung").value, betrag = Number(ablaufEl("profil-betrag").value);
  const pos = port.positionen[L.kontext.symbol];
  // ab Trader-Auftrag (B-13): Verkauf ohne Position mit klarem Grund (vorher „Stückzahl ungültig.“ aus dem Profil-Modul; gebucht wurde ohnehin nichts)
  if (richtung === "verkauf" && !(pos && pos.menge > 0)) { APROFIL.vorschlag = null; profilVorschlagZeigen(`Kein Vorschlag: Keine Position in ${L.kontext.symbol} im Simulations-Portfolio – ein Verkauf ist nicht möglich (keine Leerverkäufe). Nichts gebucht.`); return; }
  // ab 11-04h: Kauf mit dem Wert prüfen, der gebucht und bei der Bestätigung erneut geprüft wird (betrag_geschaetzt, gleiche Rundung
  // wie AktienProfil.vorschlagErstellen) – vorher wurde der eingegebene Betrag geprüft (bei hohem Kurs „bestanden“ über dem Höchstwert)
  const stueckKauf = Math.round((Math.round(betrag * 100) / 100 / L.analyse.kurs) * 1e6) / 1e6;
  const wert = richtung === "kauf" ? Math.round(stueckKauf * L.analyse.kurs * 100) / 100 : pos ? Math.round(pos.menge * L.analyse.kurs * 100) / 100 : 0;
  // ab 11-05g: mit den Annahmen der Simulation – der Kauf braucht Orderwert plus Gebühr im Spielgeld (wie bei der Bestätigung)
  const risiko = window.PaperKern.risikoPruefen(port, { seite: richtung, symbol: L.kontext.symbol, wert }, SIM.limits, { jetzt: Date.now(), kurse: { [L.kontext.symbol]: L.analyse.kurs }, annahmen: SIM.annahmen });
  const r = window.AktienProfil.vorschlagErstellen({ ...L.kontext, jetzt: Date.now() }, { richtung, betrag, stueck: pos ? pos.menge : 0, preisannahme: L.analyse.kurs, datenzeit: L.analyse.datenzeit, risiko });
  if (r.fehler) { APROFIL.vorschlag = null; profilVorschlagZeigen("Kein Vorschlag: " + r.fehler); return; }
  APROFIL.vorschlag = r.vorschlag;
  APROFIL.vorschlagRev = SIM.rev; // ab 11-06d: Stand, auf dem der Vorschlag geprüft wurde
  // ab 14m (C19/E11): Bezug auf die Analyse, aus der der Vorschlag stammt – Nummer wie in der Analysehistorie (app/31 ENTSCHEIDUNG.verlauf)
  const letzteAnalyse = typeof ENTSCHEIDUNG !== "undefined" && ENTSCHEIDUNG.verlauf[0];
  APROFIL.vorschlagAnalyse = letzteAnalyse && letzteAnalyse.symbol === r.vorschlag.symbol ? { nr: letzteAnalyse.nr, symbol: letzteAnalyse.symbol, zeit: letzteAnalyse.zeit } : null;
  // ab 11-05b: Schätzung der Buchung aus demselben Paper-Kern-Aufruf wie bei der Bestätigung (Kopie des Portfolios)
  APROFIL.vorschlagSchaetzung = window.AktienProfil.vorschlagSchaetzen(r.vorschlag, { jetzt: Date.now(), portfolio: port, limits: SIM.limits, annahmen: SIM.annahmen });
  profilVorschlagZeigen();
}
// ab 15d (trader-broker BRK-S06/BRK-S13): Entscheidungsprotokoll der lokalen Paper-Vorschläge – nur anhängen (höchstens 200 Einträge), je
// Bestätigung Zeit, Symbol, Seite, Betrag, Ergebnis (gebucht / nicht gebucht mit Grund) und Ledger-Kennung; Anzeige „Heute: …“.
const PAPER_ENTSCHEIDUNGEN = "jarvis-paper-entscheidungen";
function paperEntscheidungenLesen() { try { const d = JSON.parse(localStorage.getItem(PAPER_ENTSCHEIDUNGEN) || "[]"); return Array.isArray(d) ? d : []; } catch (e) { return []; } }
function paperEntscheidungMerken(v, text, antwort = "bestätigt") {
  const t = String(text || ""), gebucht = t.startsWith("✔"), kennung = (t.match(/trade_id ([^)\s]+)\)/) || [])[1] || null;
  const e = { at: new Date().toISOString(), symbol: v && v.symbol || null, seite: v && v.seite || "kauf", betrag: v && Number.isFinite(Number(v.betrag)) ? Number(v.betrag) : null, antwort, ergebnis: gebucht ? "gebucht" : "nicht gebucht", grund: gebucht ? null : t.replace(/^✖\s*/, "").slice(0, 160), trade_id: kennung };
  const liste = [...paperEntscheidungenLesen(), e].slice(-200);
  try { localStorage.setItem(PAPER_ENTSCHEIDUNGEN, JSON.stringify(liste)); } catch (x) { /* nur Anzeige */ }
  paperEntscheidungenZeigen();
}
function paperEntscheidungenZeigen() {
  const el = document.getElementById("profil-entscheidungen"); if (!el) return;
  const heute = new Date().toISOString().slice(0, 10), h = paperEntscheidungenLesen().filter((x) => String(x.at || "").startsWith(heute));
  const g = h.filter((x) => x.ergebnis === "gebucht").length, l = h[h.length - 1];
  el.textContent = h.length ? `Heute (UTC): ${h.length} Paper-Entscheidung(en), ${g} gebucht, ${h.length - g} nicht gebucht · letzte: ${l.symbol || "?"} ${l.ergebnis}${l.trade_id ? " (" + l.trade_id + ")" : l.grund ? " – " + l.grund : ""}` : "Heute (UTC): noch keine Paper-Entscheidung.";
}
function profilVorschlagBestaetigen() {
  const v = APROFIL.vorschlag;
  if (!v || APROFIL.laeuft) return;
  APROFIL.laeuft = true;
  // ab 14c: der Knopf wird gleich gesperrt – vorher fiel der Tastaturfokus dabei auf die Seite zurück. Er geht in den Ergebnistext
  // (Live-Region mit „Wird gebucht …“ / „✔“ / „✖“), nicht in die Tab-Reihenfolge (tabIndex −1)
  if (document.activeElement === ablaufEl("profil-bestaetigen")) { const t = ablaufEl("profil-vorschlag-text"); t.tabIndex = -1; t.focus(); }
  ablaufEl("profil-bestaetigen").disabled = true;
  // Der Vorschlag ist mit dieser Bestätigung verbraucht – auch bei Konflikt oder Fehler wird nie automatisch wiederholt
  APROFIL.vorschlag = null;
  const ende = (text) => { profilVorschlagZeigen(text); APROFIL.laeuft = false; paperEntscheidungMerken(v, text); };
  const sperre = simSperrgrund() || (SIM.arbeit ? "Ein anderer Schreibvorgang der Simulation läuft noch." : null);
  if (sperre) { ende("✖ Nicht gebucht: " + sperre + " Bitte einen neuen Vorschlag erstellen."); return Promise.resolve(); }
  if (SIM.beschaedigt) { ende("✖ Nicht gebucht: " + SIM_BESCHAEDIGT); return Promise.resolve(); }
  // ab 11-06d: Stand inzwischen aus einem anderen Tab übernommen → der Vorschlag gilt nicht mehr
  if (APROFIL.vorschlagRev !== SIM.rev) { ende("✖ Nicht gebucht: " + SIM_KONFLIKT + " – bitte einen neuen Vorschlag erstellen."); return Promise.resolve(); }
  // ab 11-06c: auf einer Kopie buchen; maßgeblich wird sie erst, wenn die IndexedDB-Transaktion (Revisionsvergleich + Schreiben) abgeschlossen ist
  const arbeit = SIM.portfolio ? simKlon(SIM.portfolio) : window.PaperKern.portfolioNeu({ startkapital: SIM.startkapital });
  // Bekannter aktiver Not-Aus sperrt auch die Simulation; sonst gilt der Not-Aus-Schalter der Simulation selbst
  const notaus = tradingZustand && tradingZustand.notaus === true ? true : SIM.limits.notaus;
  let r;
  try { r = window.AktienProfil.vorschlagBestaetigen(v, { fingerabdruck: v.fingerabdruck, jetzt: Date.now(), portfolio: arbeit, limits: SIM.limits, notaus, annahmen: SIM.annahmen }); }
  catch (e) { r = { fehler: e.message }; }
  if (r && typeof r === "object" && r.fehler) { ende("✖ Nicht gebucht: " + r.fehler); return Promise.resolve(); }
  // ab 14d (Nr. 13): Erfolg nur mit vollständigem Kern-Ergebnis (Objekt, ok, Kennung, Hinweis) und Eintrag dieser Kennung im gebuchten Stand –
  // vorher warf undefined/null hier einen TypeError (APROFIL.laeuft blieb hängen), {} oder ein Promise ergab „✔ undefined (trade_id undefined)“
  const gueltig = Boolean(r && typeof r === "object" && typeof r.then !== "function" && r.ok === true && typeof r.trade_id === "string" && r.trade_id
    && typeof r.hinweis === "string" && r.hinweis && Array.isArray(arbeit.ledger) && arbeit.ledger.some((e) => e && e.trade_id === r.trade_id)
    // Nachtrag aus der Gegenprobe F02 „Kennung doppelt“: die Kennung muss NEU sein (im Stand vor der Buchung noch nicht vorhanden)
    && !(SIM.portfolio && Array.isArray(SIM.portfolio.ledger) && SIM.portfolio.ledger.some((e) => e && e.trade_id === r.trade_id)));
  if (!gueltig) { ende("✖ Nicht gebucht: Paper-Kern lieferte kein gültiges Ergebnis – nichts gebucht, gespeicherter Stand unverändert. Bitte einen neuen Vorschlag erstellen."); return Promise.resolve(); }
  profilVorschlagZeigen("Wird gebucht (Simulation) …");
  // ab Nachtauftrag 1000 (Nr. 27): dieselbe Not-Aus-Regel wie oben erneut am Commit-Punkt (in der Speicher-Transaktion, app/04) –
  // ein nach der Prüfung oben aktivierter Not-Aus verhindert die Buchung, solange sie nicht abgeschlossen ist
  const notausAmCommit = () => ((tradingZustand && tradingZustand.notaus === true) || SIM.limits.notaus === true ? "NOT-AUS aktiv" : null);
  // ab 11-05i/11-06c (G4): nie auf einem veralteten Stand buchen; „✔“ erst nach abgeschlossener Transaktion
  SIM.arbeit = simSchreiben(JSON.stringify(arbeit), notausAmCommit).then((s) => {
    simLedgerZeigen();
    ende(s.gesperrt ? "✖ Nicht gebucht: " + s.gesperrt + " – der Not-Aus wurde vor dem Speicherabschluss aktiv, gespeicherter Stand unverändert. Erst nach Aufhebung einen neuen Vorschlag erstellen."
      : s.konflikt ? "✖ Nicht gebucht: " + SIM_KONFLIKT + " – bitte einen neuen Vorschlag erstellen."
      : s.fehler ? "✖ Nicht gebucht: Speichern gescheitert (" + s.fehler + ") – der gespeicherte Stand ist unverändert. Bitte einen neuen Vorschlag erstellen."
        : `✔ ${r.hinweis} (trade_id ${r.trade_id})${profilBuchungText(r.trade_id)} · Ergebnis: „Zum Ergebnis“ öffnet die Karte „Simulation (lokal)“ mit Ledger, Portfolio und Gewinn/Verlust.`);
  }, (e) => {
    // ab Anschluss 1311 (K042): wirft das Speichern statt { fehler } zu melden, nicht bei „Wird gebucht …“ stehen bleiben –
    // maßgeblich ist, ob diese Kennung im übernommenen Stand steht (simStandUebernehmen läuft erst nach abgeschlossener Transaktion)
    const drin = Boolean(SIM.portfolio && Array.isArray(SIM.portfolio.ledger) && SIM.portfolio.ledger.some((x) => x && x.trade_id === r.trade_id));
    simLedgerZeigen();
    ende(drin ? `✔ ${r.hinweis} (trade_id ${r.trade_id})${profilBuchungText(r.trade_id)} · gespeichert; danach meldete die Simulation einen Fehler (${(e && e.message) || "unbekannt"}). Ergebnis: „Zum Ergebnis“ öffnet die Karte „Simulation (lokal)“.`
      : "✖ Nicht gebucht: Speichern gescheitert (" + ((e && e.message) || "unbekannt") + ") – der gespeicherte Stand ist unverändert. Bitte einen neuen Vorschlag erstellen.");
  }).finally(() => { SIM.arbeit = null; APROFIL.laeuft = false; });
  return SIM.arbeit;
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("aktienanalyse");
