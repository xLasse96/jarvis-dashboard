// JARVIS Dashboard – Modul „aktien-befehle“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).
// ---------- Strategie-Vergleich (ab 11-02a, vorhandenes Strategy Lab) ----------
function slZuruecksetzen() { APROFIL.strategie = null; ablaufEl("sl-paper").disabled = true; }
// ---------- Eigene Kursdaten aus CSV (ab 11-02l) ----------
// Datei bleibt im Browser (kein Senden, kein Speichern). Erst „Datei prüfen“ (JarvisDaten.csvKerzenLesen), dann ausdrücklich „Für den
// Vergleich verwenden“. Eine fehlerhafte Prüfung ändert weder aktive CSV-Daten noch das letzte Ergebnis. Die CSV gilt nur für diesen
// Vergleich im Dashboard – nicht für die Analyse, nicht für den geführten Vergleich per Sprache.
const SL_CSV = { datei: null, geprueft: null, aktiv: null };
function slCsvStatus(zeilen, fehler = false) {
  const box = ablaufEl("sl-csv-status");
  box.replaceChildren(...[].concat(zeilen).map((z, i) => Object.assign(document.createElement(i ? "div" : "p"), { textContent: z, style: "margin:0" })));
  box.classList.toggle("wz-wichtig", fehler);
}
function slCsvKnoepfe() {
  ablaufEl("sl-csv-pruefen").disabled = !SL_CSV.datei;
  ablaufEl("sl-csv-verwenden").disabled = !SL_CSV.geprueft;
  ablaufEl("sl-csv-entfernen").disabled = !SL_CSV.aktiv;
}
async function slCsvDateiGewaehlt(datei) {
  SL_CSV.geprueft = null;
  if (!datei) { slCsvKnoepfe(); return; }
  if (datei.size > window.JarvisDaten.CSV_GRENZEN.maxZeichen) { SL_CSV.datei = null; slCsvStatus(`„${datei.name}“ ist zu groß (höchstens ${(window.JarvisDaten.CSV_GRENZEN.maxZeichen / 1e6).toLocaleString("de-DE")} MB) – nicht gelesen.`, true); slCsvKnoepfe(); return; }
  slCsvStatus(`„${datei.name}“ wird gelesen …`);
  let text;
  try { text = await datei.text(); } catch (e) { SL_CSV.datei = null; slCsvStatus("Datei konnte nicht gelesen werden – nichts übernommen.", true); slCsvKnoepfe(); return; }
  const zeilen = text.split(/\r\n|\n|\r/).filter((z) => z.trim()).length;
  SL_CSV.datei = { name: datei.name, text };
  slCsvStatus(`Datei „${datei.name}“: ${Math.max(0, zeilen - 1)} Datenzeile(n) erkannt (ohne Kopfzeile). Symbol angeben und „Datei prüfen“ wählen.` + (SL_CSV.aktiv ? ` Aktiv bleibt bis dahin „${SL_CSV.aktiv.name}“.` : ""));
  slCsvKnoepfe();
}
function slCsvPruefen() {
  if (!SL_CSV.datei) return null;
  const r = window.JarvisDaten.csvKerzenLesen(SL_CSV.datei.text, { symbol: ablaufEl("sl-csv-symbol").value, trenner: ablaufEl("sl-csv-trenner").value, zahlenformat: ablaufEl("sl-csv-zahlen").value });
  feldUngueltig("sl-csv-symbol", !r.ok && /Symbol/.test(r.fehler[0] || ""));
  if (!r.ok) {
    SL_CSV.geprueft = null;
    const wahl = r.rueckfrage === "trenner" ? " Bitte das Trennzeichen auswählen und erneut prüfen." : r.rueckfrage === "zahlenformat" ? " Bitte das Dezimalzeichen auswählen und erneut prüfen." : "";
    slCsvStatus([`„${SL_CSV.datei.name}“ nicht übernommen.${wahl}` + (SL_CSV.aktiv ? ` Aktiv bleibt „${SL_CSV.aktiv.name}“.` : ""), ...r.fehler], true);
    if (r.rueckfrage) ablaufEl(r.rueckfrage === "trenner" ? "sl-csv-trenner" : "sl-csv-zahlen").focus();
    slCsvKnoepfe();
    return r;
  }
  SL_CSV.geprueft = { name: SL_CSV.datei.name, kerzen: r.kerzen, info: r.info };
  const i = r.info, tag = (t) => new Date(t).toISOString().slice(0, 10);
  slCsvStatus([`Geprüft: „${SL_CSV.datei.name}“ · ${i.symbol} · ${tag(i.von)} bis ${tag(i.bis)} · ${i.zeilen} Tageskerzen.`,
    `Format: Trennzeichen ${i.trenner === ";" ? "Semikolon" : "Komma"}, Dezimalzeichen ${i.zahlenformat === "komma" ? "Komma" : "Punkt"}, Datum ${i.datumsformat}, Sortierung ${i.sortierung}, Volumen ${i.volumen}${i.ignoriert.length ? ", ignorierte Spalten: " + i.ignoriert.join(", ") : ""}.`,
    "Quelle: lokale CSV-Datei, vom Nutzer bereitgestellt – JARVIS prüft Form und Plausibilität, nicht Vollständigkeit oder Richtigkeit der Quelle.",
    "Noch nicht verwendet: erst „Für den Vergleich verwenden“ wählen."]);
  slCsvKnoepfe();
  return r;
}
function slCsvVerwenden() {
  if (!SL_CSV.geprueft) return false;
  SL_CSV.aktiv = SL_CSV.geprueft;
  SL_CSV.geprueft = null;
  slZuruecksetzen();
  ablaufEl("sl-ergebnis").textContent = "Datengrundlage gewechselt – bitte neu rechnen.";
  slCsvStatus(`Für den Vergleich verwendet: „${SL_CSV.aktiv.name}“ (${SL_CSV.aktiv.info.symbol}, ${SL_CSV.aktiv.info.zeilen} Tageskerzen, lokale CSV-Datei, vom Nutzer bereitgestellt). Nur für diesen Strategie-Vergleich – Analyse und Sprachbefehle nutzen weiterhin ihre eigenen Daten.`);
  slVorschau();
  slCsvKnoepfe();
  return true;
}
function slCsvEntfernen() {
  if (!SL_CSV.aktiv) return false;
  const name = SL_CSV.aktiv.name;
  SL_CSV.aktiv = null;
  slZuruecksetzen();
  ablaufEl("sl-ergebnis").textContent = "Datengrundlage gewechselt – bitte neu rechnen.";
  slCsvStatus(`CSV-Daten „${name}“ aus dem Vergleich entfernt. Der Vergleich nutzt wieder die Kursdaten der Analyse (falls vorhanden).`);
  slVorschau();
  slCsvKnoepfe();
  return true;
}
// nurAnalyse: der geführte Vergleich per Sprache rechnet immer mit den Analysedaten (Zusammenfassung und Fingerabdruck beziehen sich darauf)
function slEingaben({ nurAnalyse = false } = {}) {
  const L = APROFIL.letztes;
  const zahlOder = (id) => { const v = ablaufEl(id).value; return v === "" ? NaN : Number(v); };
  const werte = { startkapital: zahlOder("sl-kapital"), gebuehrPct: zahlOder("sl-gebuehr"), slippagePct: zahlOder("sl-slippage"),
    strategien: [{ name: "ema-kreuzung", parameter: { kurz: zahlOder("sl-kurz"), lang: zahlOder("sl-lang") } }, { name: "kaufen-und-halten", parameter: {} }] };
  // frisch: CSV-Daten sind historische Nutzerdaten – Aktualität wird nicht geprüft (ausdrücklich „nicht geprüft“, nie true)
  if (SL_CSV.aktiv && !nurAnalyse) return { symbol: SL_CSV.aktiv.info.symbol, kerzen: SL_CSV.aktiv.kerzen, quelle: `Lokale CSV-Datei „${SL_CSV.aktiv.name}“ (vom Nutzer bereitgestellt)`, synthetisch: false, frisch: "nicht geprüft", zeitraumVorgabe: null, csv: true, ...werte };
  return {
    symbol: L ? L.kontext.symbol : undefined, kerzen: L && L.kerzen ? L.kerzen.kerzen : undefined, quelle: L && L.kerzen ? L.kerzen.quelle : undefined,
    synthetisch: L && L.kerzen ? L.kerzen.synthetisch : undefined, frisch: L && L.kerzen ? L.kerzen.frisch : undefined, zeitraumVorgabe: L && L.kerzen ? L.kerzen.zeitraum || null : null,
    startkapital: zahlOder("sl-kapital"), gebuehrPct: zahlOder("sl-gebuehr"), slippagePct: zahlOder("sl-slippage"),
    strategien: [{ name: "ema-kreuzung", parameter: { kurz: zahlOder("sl-kurz"), lang: zahlOder("sl-lang") } }, { name: "kaufen-und-halten", parameter: {} }],
  };
}
// Vor dem Rechnen: verwendete Regeln, Eingabewerte, Zeitraum und Datenherkunft; fehlende Werte als „fehlt“, nicht belegte Eigenschaften als „unbekannt“
function slVorschau() {
  const A = window.AktienAssistent, e = slEingaben(), k = e.kerzen;
  const w = (v, einheit) => Number.isFinite(v) ? v + einheit : "fehlt";
  const p = e.strategien[0].parameter;
  ablaufEl("sl-vorschau").textContent = [
    "Vorschau (noch nicht gerechnet):",
    "Daten: " + (k && k.length ? `${e.symbol} · ${new Date(k[0].t).toISOString().slice(0, 10)} bis ${new Date(k[k.length - 1].t).toISOString().slice(0, 10)} (${k.length} Kerzen) · Quelle: ${e.quelle}${e.synthetisch ? " – synthetische Testdaten" : ""}${e.csv ? " – Vollständigkeit und Richtigkeit nicht geprüft" : ""}${e.frisch === false ? " – VERALTET" : ""}` : "keine – erst eine US-Aktie analysieren oder eine geprüfte CSV-Datei verwenden"),
    k && k.length ? (e.zeitraumVorgabe ? `Zeitraum-Vorgabe: ${e.zeitraumVorgabe.von} bis ${e.zeitraumVorgabe.bis}` : "Zeitraum-Vorgabe: keine – alle verfügbaren Tageskerzen") : "",
    `Eingaben: Startkapital ${w(e.startkapital, " USD")}, Gebühr ${w(e.gebuehrPct, " %")}, Slippage ${w(e.slippagePct, " %")} (Annahmen, keine Vorgaben), EMA kurz ${w(p.kurz, "")} / lang ${w(p.lang, "")}`,
    ...e.strategien.map((s) => `Regel ${A.REGELN[s.name] ? s.name + ": " + A.REGELN[s.name].regel + " Unbekannt: " + A.REGELN[s.name].unbekannt.join(", ") : s.name + ": unbekannt"}`),
  ].join("\n");
}
function slRechnen({ nurAnalyse = false } = {}) {
  const aus = ablaufEl("sl-ergebnis");
  const e = slEingaben({ nurAnalyse });
  if (!e.kerzen) { aus.textContent = "Erst eine US-Aktie analysieren oder eine geprüfte CSV-Datei verwenden – der Vergleich nutzt genau diese Kursdaten."; return null; }
  const r = window.AktienAssistent.strategieVergleich(e);
  // Fehlerstatus am betroffenen Feld (ab 11-02k): Zuordnung über die Feldnamen in der Meldung von strategieVergleich
  for (const [id, rx] of [["sl-kapital", /Startkapital/], ["sl-gebuehr", /Gebühr/], ["sl-slippage", /Slippage/], ["sl-kurz", /EMA/], ["sl-lang", /EMA/]]) feldUngueltig(id, Boolean(r.fehler) && rx.test(r.fehler));
  if (r.fehler) { aus.textContent = "Kein Vergleich: " + r.fehler; slZuruecksetzen(); return r; }
  // Vorheriger Lauf nur als „vergleichbar“ nennen, wenn Symbol, Zeitraum, Datengrundlage und Methode übereinstimmen
  const vorher = APROFIL.strategieVorher;
  const k = vorher ? window.AktienAssistent.vergleichKompatibel(vorher, r) : null;
  APROFIL.strategie = r;
  APROFIL.strategieVorher = r;
  aus.textContent = window.AktienAssistent.vergleichText(r).replace(/ (?=Datenbasis:|Annahmen \(|Einschränkungen:)/g, "\n")
    + (k ? "\nVorheriger Lauf: " + (k.kompatibel ? "vergleichbar (gleiche Daten, gleicher Zeitraum, gleiche Methode)." : "EINGESCHRÄNKT vergleichbar – " + k.gruende.join(", ") + ".") : "");
  ablaufEl("sl-paper").disabled = false;
  return r;
}
// Nur vorbereiten: Richtung „Kauf“ setzen, Betrag leer lassen – Vorschlag erstellen und bestätigen muss der Nutzer selbst
function slPaperVorbereiten() {
  if (!APROFIL.strategie) return;
  ablaufEl("profil-richtung").value = "kauf";
  ablaufEl("profil-betrag").value = "";
  APROFIL.vorschlag = null;
  profilVorschlagZeigen("Vorbereitet aus dem Strategie-Vergleich (unverbindlich): Betrag selbst eintragen, „Paper-Vorschlag erstellen“ und genau diesen Vorschlag bestätigen. Nichts wurde gebucht.");
  ablaufEl("profil-betrag").focus();
}

// ---------- Geführter Strategie-Vergleich per Sprache (ab 11-02e) ----------
// Zustand nur im Speicher. Fehlende Werte werden erfragt (keine Vorgaben); vollständig → Zusammenfassung und Bestätigung über die
// vorhandene offeneAktion (nur exakt „Ja“, 60 s, einmalig). Abbruch, unklare Antwort, neue Anfrage oder geänderte Kursdaten → nichts gerechnet.
const SL_DIALOG = { aktiv: false, symbol: null, zeitraum: null, werte: {}, bis: 0, fp: null };
const SL_DIALOG_GUELTIG_MS = { wert: 180000 };
function slDatenFingerabdruck() {
  const L = APROFIL.letztes, k = L && L.kerzen;
  return k && k.kerzen.length ? [L.kontext.symbol, k.zeitraum ? k.zeitraum.von + "_" + k.zeitraum.bis : "alle", k.kerzen.length, k.kerzen[0].t, k.kerzen[k.kerzen.length - 1].t, k.quelle].join("|") : null;
}
function slDialogBeenden() { SL_DIALOG.aktiv = false; SL_DIALOG.werte = {}; SL_DIALOG.fp = null; }
// erkennung: Ergebnis von strategieWerteErkennen ({ werte, unklar })
function slDialogStarten(symbol, zeitraum, erkennung, vorspann = "") {
  Object.assign(SL_DIALOG, { aktiv: true, symbol, zeitraum: zeitraum || null, werte: { ...erkennung.werte }, bis: Date.now() + SL_DIALOG_GUELTIG_MS.wert, fp: slDatenFingerabdruck() });
  slDialogWeiter(vorspann, erkennung.unklar || []);
}
function slDialogWeiter(vorspann = "", unklar = []) {
  const A = window.AktienAssistent;
  const p = A.strategieWertePruefen(SL_DIALOG.werte);
  // Ungültige Werte werden verworfen und neu erfragt – nie korrigiert oder ersetzt
  for (const id of p.ungueltigeIds) delete SL_DIALOG.werte[id];
  const neu = A.strategieWertePruefen(SL_DIALOG.werte);
  const ungueltig = p.ungueltig.length ? "Ungültig: " + p.ungueltig.join("; ") + ". " : "";
  // Feld genannt, Zahl aber nicht eindeutig (z. B. „ein paar tausend“, „null komma fünfzehn“, „EMA fünf und zwanzig“) → Ziffern erbitten, nie raten
  const titel = (id) => (A.STRATEGIE_EINGABEN.find((e) => e.id === id) || {}).titel || id;
  const nichtEindeutig = unklar.filter((id) => SL_DIALOG.werte[id] === undefined);
  const unklarText = nichtEindeutig.length ? `Nicht eindeutig verstanden: ${nichtEindeutig.map(titel).join(", ")} – bitte als Ziffern nennen. ` : "";
  if (neu.fehlt.length) {
    SL_DIALOG.bis = Date.now() + SL_DIALOG_GUELTIG_MS.wert;
    const beispiele = [...new Set(A.STRATEGIE_EINGABEN.filter((e) => neu.fehlt.includes(e.titel)).map((e) => e.beispiel))].join(" ");
    const wo = `${SL_DIALOG.symbol}, ${SL_DIALOG.zeitraum ? `Zeitraum ${SL_DIALOG.zeitraum.von} bis ${SL_DIALOG.zeitraum.bis}` : "kein Zeitraum – alle verfügbaren Tageskerzen"}`;
    lokalAntworten(`${vorspann}${ungueltig}${unklarText}Für den Strategie-Vergleich (${wo}) fehlen noch: ${neu.fehlt.join(", ")}. Bitte nennen, z. B. „${beispiele}“ – oder „abbrechen“. Es gibt keine Vorgabewerte; gerechnet wird erst nach deiner Bestätigung.`);
    return;
  }
  // Kerzenzahl reicht nicht für die EMA lang (mindestens lang + 2) → nicht erst nach „Ja“ scheitern, sondern EMA neu erfragen
  const n = APROFIL.letztes.kerzen.kerzen.length;
  if (n < SL_DIALOG.werte.emaLang + 2) {
    const zuLang = SL_DIALOG.werte.emaLang;
    delete SL_DIALOG.werte.emaKurz; delete SL_DIALOG.werte.emaLang;
    SL_DIALOG.bis = Date.now() + SL_DIALOG_GUELTIG_MS.wert;
    lokalAntworten(`${vorspann}${ungueltig}Zu wenige Tageskerzen (${n}) für EMA lang ${zuLang} – nötig sind mindestens ${zuLang + 2}. Bitte kürzere EMA nennen (EMA lang höchstens ${n - 2}${n - 2 >= 3 ? "" : ", hier nicht möglich – dann „abbrechen“"}), z. B. „EMA 2 und ${Math.max(3, n - 2)}“. Es wurde nichts gerechnet.`);
    return;
  }
  // vollständig: Zusammenfassung und ausdrückliche Bestätigung (vorhandener Mechanismus)
  const L = APROFIL.letztes, k = L.kerzen, w = { ...SL_DIALOG.werte }, fp = SL_DIALOG.fp, symbol = SL_DIALOG.symbol, zeitraum = SL_DIALOG.zeitraum;
  slDialogBeenden();
  const text = A.strategieZusammenfassung({ symbol, zeitraum, kerzen: k.kerzen.length, quelle: k.quelle, synthetisch: k.synthetisch, werte: w });
  if (vorspann || ungueltig) lokalAntworten(vorspann + ungueltig);
  bestaetigungAnfordern({ name: "aktien-strategie" }, { beschreibung: text + " Jetzt rechnen?", ausfuehren: async () => {
    if (slDatenFingerabdruck() !== fp) return "Nicht gerechnet: Die Kursdaten haben sich seit der Zusammenfassung geändert (neuer Lauf oder anderes Symbol). Bitte den Vergleich neu anfordern.";
    for (const [id, v] of [["sl-kapital", w.startkapital], ["sl-gebuehr", w.gebuehrPct], ["sl-slippage", w.slippagePct], ["sl-kurz", w.emaKurz], ["sl-lang", w.emaLang]]) ablaufEl(id).value = String(v);
    slVorschau();
    const r = slRechnen({ nurAnalyse: true });
    return r && !r.fehler ? "HISTORISCHE SIMULATION, keine Renditezusage: " + window.AktienAssistent.vergleichText(r) : "Kein Vergleich: " + ((r && r.fehler) || "keine Kursdaten") + " Es wurde nichts berechnet.";
  } });
}
// Antwort im laufenden Dialog? (Werte oder „abbrechen“; abgelaufen zählt nicht)
function slDialogPasst(text) {
  if (!SL_DIALOG.aktiv || Date.now() > SL_DIALOG.bis) return false;
  const e = window.AktienAssistent.strategieWerteErkennen(text);
  return e.erkannt || e.abbrechen || e.unklar.length > 0;
}
// Hook im vorhandenen Dispatcher (wie bei offeneAktion): Jede andere Eingabe verwirft den offenen Dialog sichtbar – der Text wird danach normal verarbeitet
function slDialogVerwerfenWennFremd(text) {
  if (!SL_DIALOG.aktiv || slDialogPasst(text)) return;
  const abgelaufen = Date.now() > SL_DIALOG.bis;
  slDialogBeenden();
  lokalAntworten(abgelaufen ? "Der Strategie-Vergleich ist verfallen (keine Antwort in 3 Minuten). Es wurde nichts gerechnet." : "Strategie-Vergleich verworfen – die Eingabe enthielt keine erkennbaren Werte. Es wurde nichts gerechnet.");
}
async function slDialogAntwort(text) {
  const e = window.AktienAssistent.strategieWerteErkennen(text);
  if (e.abbrechen && !e.erkannt) { slDialogBeenden(); lokalAntworten("Strategie-Vergleich abgebrochen. Es wurde nichts gerechnet."); return true; }
  if (slDatenFingerabdruck() !== SL_DIALOG.fp) { slDialogBeenden(); lokalAntworten("Strategie-Vergleich verworfen: Die Kursdaten haben sich inzwischen geändert. Es wurde nichts gerechnet."); return true; }
  // Nicht eindeutig genannter Wert löscht einen früher genannten nicht still, sondern wird zurückgefragt (ersetzt wird nur durch eindeutige Werte)
  Object.assign(SL_DIALOG.werte, e.werte);
  for (const id of e.unklar) delete SL_DIALOG.werte[id];
  slDialogWeiter("", e.unklar);
  return true;
}

// ---------- Aktien-Befehle im vorhandenen Skill-Dispatcher (ab 11-02a) ----------
// Analyse/Abfragen direkt (nur lesend), Watchlist leicht, Alarm nur nach Bestätigung. Orders und Paper-Buchungen gibt es per Sprache nie.
async function aktienBefehl(text) {
  const A = window.AktienAssistent;
  const i = A.intentErkennen(text, { watchlist: wlLaden().eintraege });
  if (i.rueckfrage || i.fehler) { lokalAntworten(i.rueckfrage || i.fehler + " Es wurde nichts ausgeführt."); return true; }
  // Wiederholte Spracheingabe während einer Analyse: nichts doppelt starten und kein altes Ergebnis als Antwort ausgeben
  if (ABLAUF.laeuft && i.intent !== "hilfe" && i.intent !== "order_abgelehnt") { lokalAntworten("Eine Analyse läuft bereits – bitte das Ergebnis abwarten. Es wurde nichts zusätzlich gestartet."); return true; }
  if (i.intent === "order_abgelehnt") { lokalAntworten("Orders gibt es per Sprache oder Chat nicht – auch keine Aktien-Paper-Buchung. Möglich: „analysiere " + (i.symbol || "AAPL") + "“, danach im Dashboard einen Paper-Vorschlag erstellen und genau diesen bestätigen. Es wurde nichts ausgeführt."); return true; }
  if (i.intent === "hilfe") { lokalAntworten(A.hilfeText()); return true; }
  // Folgefrage ohne Symbol: nur das in DIESER Sitzung zuletzt analysierte Symbol (APROFIL lebt nur im Speicher) – und das wird genannt
  const symbol = i.symbol || (APROFIL.letztes && APROFIL.letztes.kontext.symbol);
  if (!symbol) { lokalAntworten("Für welches US-Aktiensymbol? Bitte z. B. „Budget für AAPL“ sagen. Es wurde nichts ausgeführt."); return true; }
  const bezug = i.symbol ? "" : `Bezogen auf ${symbol} (zuletzt in dieser Sitzung analysiert). `;
  // Zeitraum aus dem Befehl auflösen und anwenden; ohne Zeitraum Felder leeren (kein stiller Rest eines früheren Befehls)
  const zr = A.zeitraumAufloesen(i.zeitraum, Date.now());
  if (zr && zr.fehler) { lokalAntworten(zr.fehler + " Es wurde nichts ausgeführt."); return true; }
  ablaufEl("ablauf-von").value = zr ? zr.von : "";
  ablaufEl("ablauf-bis").value = zr ? zr.bis : "";
  ablaufEl("ablauf-symbol").value = symbol;
  const vorher = APROFIL.letzteDispatch;
  await ablaufStarten();
  // Nur ein Ergebnis genau dieses Laufs und Symbols melden; sonst ehrlich „nicht verfügbar“ (nie das Ergebnis eines früheren Laufs)
  const d = APROFIL.letzteDispatch;
  if (!d || d === vorher || d.kontext.symbol !== symbol) { lokalAntworten(`Analyse für ${symbol} nicht abgeschlossen – ${ablaufEl("ablauf-kopf").textContent} Kein Ergebnis verfügbar, es wurde nichts ausgeführt.`); return true; }
  // ab 11-02r: „alle verfügbaren Tageskerzen“ nur, wenn Kerzen verwendet wurden – mit ihrer Zahl, wie im Kopf der Anzeige
  const nK = APROFIL.letztes && APROFIL.letztes.analyse && APROFIL.letztes.analyse.kerzen_anzahl > 0 ? APROFIL.letztes.analyse.kerzen_anzahl : 0;
  const ohneZr = zr ? "" : nK ? ` (ohne Zeitraum: alle verfügbaren Tageskerzen, ${nK} Stück)` : " (keine Tageskerzen geladen – kein Analyseergebnis aus Kursdaten)";
  // Aktien-Briefing (ab 11-02d): aus genau diesem Lauf (mit oder ohne Zeitraum), gleicher Text wie die sichtbare Anzeige
  if (i.intent === "briefing_aktie") { const b = abBriefing("kurz", symbol); lokalAntworten(bezug + b.text); return true; }
  // Strategie-Vergleich (ab 11-02e geführt): Kursdaten im Zeitraum sind geladen; fehlende Werte werden erfragt, gerechnet wird erst nach „Ja“
  if (i.intent === "strategie") {
    const k = APROFIL.letztes && APROFIL.letztes.kerzen;
    slVorschau();
    if (!k) {
      lokalAntworten(bezug + `Für ${symbol} liegen ${zr ? `im Zeitraum ${zr.von} bis ${zr.bis} ` : ""}keine verwendbaren Tageskerzen vor – ein Strategie-Vergleich ist so nicht möglich. ${ablaufEl("ablauf-kopf").textContent.split("\n")[0]}`);
      return true;
    }
    slDialogStarten(symbol, zr, A.strategieWerteErkennen(text), bezug);
    return true;
  }
  lokalAntworten(bezug + A.antwortAusProfil(d, i.intent, { lang: false }) + (i.intent === "analysieren" ? ohneZr : ""));
  return true;
}
function aktienSkillsRegistrieren() {
  const neu = [
    { name: "aktien-strategie-dialog", risiko: "abfrage", beschreibung: "Fehlende Werte für den Strategie-Vergleich nennen (gerechnet wird erst nach „Ja“)", beispiele: ["Startkapital 10000", "Gebühr 0,1 Slippage 0,05", "EMA 5 und 20", "abbrechen"],
      passt: (text) => slDialogPasst(text), aktion: (text) => slDialogAntwort(text) },
    { name: "aktien", risiko: "abfrage", beschreibung: "US-Aktie analysieren, Nachrichten, Meldungen, Budget, Rebalancing (nur lesend, keine Order)", beispiele: ["Analysiere AAPL", "Nachrichten zu MSFT", "Meldungen zu KO", "Budget für AAPL", "Rebalancing AAPL"],
      passt: (text) => ["analysieren", "nachrichten", "meldungen", "budget", "rebalancing", "strategie", "briefing_aktie", "hilfe", "order_abgelehnt"].includes(window.AktienAssistent.intentErkennen(text).intent),
      aktion: (text) => aktienBefehl(text) },
    { name: "aktien-watchlist", risiko: "leicht", beschreibung: "Aktien-Watchlist ergänzen oder entfernen (nur Allowlist-Symbole)", beispiele: ["Setze AAPL auf die Watchlist", "Entferne AAPL von der Watchlist"],
      passt: (text) => ["watchlist_hinzu", "watchlist_weg"].includes(window.AktienAssistent.intentErkennen(text).intent),
      aktion: async (text) => {
        const i = window.AktienAssistent.intentErkennen(text);
        if (i.rueckfrage || i.fehler) { lokalAntworten(i.rueckfrage || i.fehler); return true; }
        const ok = i.intent === "watchlist_hinzu" ? wlHinzufuegen(i.symbol) : wlEntfernen(i.symbol);
        lokalAntworten(ablaufEl("wl-status").textContent + (ok ? "" : " Es wurde nichts geändert."));
        return true;
      } },
    { name: "aktien-alarm", risiko: "bestaetigen", beschreibung: "Preisalarm für eine US-Aktie anlegen (nur mit eigenem Wert, nie eine Order)", beispiele: ["Alarm AAPL über 210", "Alarm MSFT unter 300"],
      passt: (text) => window.AktienAssistent.intentErkennen(text).intent === "alarm",
      planen: async (text) => {
        const i = window.AktienAssistent.intentErkennen(text);
        if (i.rueckfrage || i.fehler) return { fehler: i.rueckfrage || i.fehler };
        const probe = window.AktienAlarme.regelNeu({ art: i.art, symbol: i.symbol, preis: i.wert });
        if (probe.fehler) return { fehler: probe.fehler };
        return { beschreibung: `Alarm „${window.AktienAlarme.text(probe.regel)}“ anlegen – nur eine Information, es wird nie gekauft oder verkauft.`,
          ausfuehren: async () => (wzAlarmAnlegenRegel({ art: i.art, symbol: i.symbol, preis: i.wert }) ? "Alarm angelegt: " + window.AktienAlarme.text(probe.regel) + "." : "Nicht angelegt: " + wzEl("wz-al-status").textContent) };
      } },
  ];
  for (const s of neu) skillRegistrieren(s);
  // Vor die allgemeinen Skills (z. B. Ansicht wechseln) einreihen, direkt hinter „gesperrt“
  const namen = neu.map((s) => s.name);
  const eigene = SKILLS.filter((s) => namen.includes(s.name));
  for (const s of eigene) SKILLS.splice(SKILLS.indexOf(s), 1);
  SKILLS.splice(SKILLS.findIndex((s) => s.name === "gesperrt") + 1, 0, ...eigene);
}
aktienSkillsRegistrieren();

function ablaufZeigen(r) {
  const zeichen = { ok: "✔", warnung: "⚠", blockiert: "✖", nicht_verfuegbar: "–" };
  const q = r.quelle;
  const n = Number.isInteger(r.kerzen_anzahl) ? r.kerzen_anzahl : 0;
  // ab 11-02r: synthetisches Datum nie „aktuell genug“ nennen; Grundlage (Kerzenzahl) immer im Kopf – ohne Kerzen kein scheinbares Ergebnis
  const frische = r.frisch === false ? " – VERALTET" : q && q.synthetisch ? " (künstliches Datum der synthetischen Testdaten, keine Marktzeit)" : r.frisch === true ? " (aktuell genug)" : "";
  ablaufEl("ablauf-kopf").textContent = [
    (r.symbol || "Kein gültiges Symbol") + " · " + (q ? "Quelle: " + q.name + (q.beschreibung ? " – " + q.beschreibung : "") : "keine Daten geladen"),
    r.datenzeit ? "Datenzeit: " + new Date(r.datenzeit).toISOString().slice(0, 16).replace("T", " ") + " UTC" + frische : "Datenzeit: –",
    ...(q ? [n > 0 ? `Grundlage: ${n} ${n === 1 ? "Tageskerze" : "Tageskerzen"}${r.letzte_laufend ? " (die letzte läuft noch und wird nicht bewertet)" : ""}` : "Grundlage: keine Tageskerzen geladen – kein Analyseergebnis aus Kursdaten"] : []),
    "Analyse um " + new Date().toLocaleTimeString("de-DE") + " · " + r.hinweis,
  ].join("\n");
  ablaufEl("ablauf-schritte").replaceChildren(...r.schritte.map((s) => {
    const li = document.createElement("li");
    li.dataset.status = s.status;
    li.dataset.schritt = s.id;
    li.textContent = (zeichen[s.status] || "") + " " + s.titel + ": " + s.text;
    return li;
  }));
  ablaufEl("ablauf-blockaden").replaceChildren(...(r.blockaden.length ? r.blockaden : [null]).map((b) => {
    const li = document.createElement("li");
    if (!b) { li.textContent = "Keine."; return li; }
    li.dataset.bereich = b.bereich;
    li.textContent = b.bereich + ": " + b.grund + " → Nächster sicherer Schritt: " + b.naechster_schritt;
    return li;
  }));
  // ab 11-06e: Widersprüche (nur Einordnung) und Wechsel zu anderen Analysen dieser Sitzung
  const ws = Array.isArray(r.widersprueche) ? r.widersprueche : null;
  ablaufEl("ablauf-widersprueche").replaceChildren(...(ws && ws.length ? ws : [null]).map((x) => {
    const li = document.createElement("li");
    if (!x) { li.textContent = ws ? "Keine – die ausgewerteten Bausteine widersprechen sich nicht." : "Nicht bewertet (Analyse unvollständig)."; return li; }
    li.dataset.art = x.art;
    li.className = "wz-wichtig"; // ab 11-06i: deutlich hervorgehoben
    li.textContent = "⚠ " + x.text + " (" + x.quellen.join(" ↔ ") + ") – Einordnung, keine Empfehlung.";
    return li;
  }));
  ablaufEl("ablauf-widersprueche-titel").textContent = "Widersprüchliche Signale" + (ws && ws.length ? ` (${ws.length})` : "");
  ablaufKennzahlenZeigen(r);
  ablaufZuletztZeigen(r.symbol);
}
// ab 11-06i: Kennzahlenübersicht (Herkunft, Stichtag, Status, neutrale Einordnung) und Chancen/Risiken dieses Laufs
function ablaufKennzahlenZeigen(r) {
  const sch = r.schritte || [];
  const s = sch.find((x) => x.id === "screener-fundamental") || sch.find((x) => x.id === "screener-technisch");
  const box = ablaufEl("ablauf-kennzahlen");
  const synth = Boolean(r.quelle && r.quelle.synthetisch);
  if (!s || !s.details || !s.details.kennzahlen) box.textContent = "Keine Kennzahlen in diesem Lauf.";
  else {
    const zeilen = window.AktienScreener.kennzahlenUebersicht(s.details.kennzahlen);
    const status = { ok: "✔ belegt", fehlt: "– fehlt", veraltet: "⚠ veraltet", abgeleitet: "≈ abgeleitet" };
    const zahl = (z) => (z.wert === null ? "nicht verfügbar" : z.metric === "marktwert" || z.metric === "eigenkapital" ? usdBetrag(z.wert) : z.wert.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + (/(_pct|roe|growth|margin)/.test(z.metric) ? " %" : ""));
    // Liste statt Tabelle: sechs Spalten passten auf 320 px nicht (Bildschirm-Abnahme)
    // ab 11-07i: Erklärung je Kennzahl aufklappbar
    const tab = wzKnoten("ul", { klasse: "kennzahlen-liste" }, ...zeilen.map((z) => wzKnoten("li", { "data-metric": z.metric, "data-status": z.status },
      wzKnoten("b", { text: z.name + ": " + zahl(z) }), wzKnoten("span", { text: " · " + status[z.status] }),
      wzKnoten("div", { klasse: "klein", text: "Herkunft: " + z.quelle + " · Stichtag: " + (z.stichtag || "–") + (z.deutung ? " · Einordnung: " + z.deutung : "") }),
      ...(z.erklaerung ? [wzKnoten("details", { klasse: "kennzahl-erklaerung" }, wzKnoten("summary", { text: "Was bedeutet " + z.name.replace(/ %$| USD$/, "") + "?" }), wzKnoten("p", { klasse: "klein", text: z.erklaerung }))] : []))));
    const k = s.details.kennzahlen, teile = [tab];
    // ab 11-07i: Quartalsverlauf (soweit vorhanden) und Stärken/Schwächen aus belegten Kennzahlen
    const verlauf = (k._verlauf || []).filter((q) => q.ende && (q.umsatz_vj !== null || q.betriebsmarge !== null));
    const pz = (v) => (v === null ? "–" : (v > 0 ? "+" : "") + v.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " %");
    if (verlauf.length >= 2) teile.push(wzKnoten("div", { klasse: "klein kennzahl-verlauf", text: "Verlauf (Quartale, neueste zuerst): " + verlauf.map((q) => `${q.ende}: Umsatz ggü. Vorjahr ${pz(q.umsatz_vj)}, Betriebsmarge ${q.betriebsmarge === null ? "–" : q.betriebsmarge.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " %"}`).join(" · ") }));
    const ss = window.AktienScreener.staerkenSchwaechen(k);
    const ssListe = (titel, xs, art) => [wzKnoten("h4", { text: titel + ` (${xs.length})` }), wzKnoten("ul", { "data-art": art }, ...(xs.length ? xs : [{ text: "keine" }]).map((x) => wzKnoten("li", { text: typeof x === "string" ? x : x.text + (x.quelle ? " – " + x.quelle : "") })))];
    teile.push(wzKnoten("section", { klasse: "staerken-schwaechen" }, ...ssListe("Stärken (belegte Kennzahlen)", ss.staerken, "staerken"), ...ssListe("Schwächen (belegte Kennzahlen)", ss.schwaechen, "schwaechen"),
      ...ssListe("Widersprüchliche Kennzahlen", ss.widersprueche, "widersprueche"),
      wzKnoten("div", { klasse: "klein", text: (ss.fehlend.length ? "Nicht bewertet (fehlt): " + ss.fehlend.join(", ") + ". " : "") + (ss.veraltet ? "⚠ SEC-Zahlen veraltet. " : "") + ss.hinweis })));
    teile.push(wzKnoten("div", { klasse: "klein", text: "Einordnung beschreibt nur die Größenordnung (allgemeine, branchenabhängige Faustwerte) – keine Bewertung, keine Empfehlung." + (synth ? " Kurs aus synthetischen Testdaten – kein Börsenkurs." : "") }));
    box.replaceChildren(...teile);
  }
  const c = r.chancen_risiken;
  const cbox = ablaufEl("ablauf-chancen");
  if (!c) { cbox.textContent = "Nicht bewertet (Analyse unvollständig)."; return; }
  const liste = (titel, xs, art) => [wzKnoten("h4", { text: titel + ` (${xs.length})` }), wzKnoten("ul", { "data-art": art }, ...(xs.length ? xs : [{ text: "keine", quelle: "" }]).map((x) => wzKnoten("li", { text: x.text + (x.quelle ? " – " + x.quelle : "") })))];
  cbox.replaceChildren(...liste("Was in den Daten dafür spricht", c.dafuer, "dafuer"), ...liste("Was dagegen spricht", c.dagegen, "dagegen"), ...liste("Offen bzw. nicht bewertet", c.offen, "offen"), wzKnoten("div", { klasse: "klein", text: c.hinweis }));
}
function ablaufZuletztZeigen(aktuell) {
  const box = ablaufEl("ablauf-zuletzt");
  const andere = Object.keys(APROFIL.analysen).filter((s) => s !== aktuell).slice(-6);
  box.hidden = !andere.length;
  box.replaceChildren(...(andere.length ? [Object.assign(document.createElement("span"), { className: "klein", textContent: "Zuletzt analysiert:" })] : []), ...andere.map((s) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", textContent: s });
    b.setAttribute("aria-label", s + " ins Eingabefeld übernehmen");
    b.addEventListener("click", () => { ablaufEl("ablauf-symbol").value = s; ablaufEl("ablauf-symbol").dispatchEvent(new Event("input")); ablaufEl("ablauf-symbol").focus(); });
    return b;
  }));
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("aktien-befehle");
