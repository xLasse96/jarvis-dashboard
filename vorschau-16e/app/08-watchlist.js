// JARVIS Dashboard – Modul „watchlist“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).
// ---------- Aktien-Watchlist (ab 11-02a, nur dieses Gerät) ----------
// Eigene Liste für US-Aktien (die vorhandene WATCH-Liste ist eine Krypto-Kursliste und bleibt unverändert). Gespeichert werden nur
// Symbol, Kennung, Erstellungszeit und optional Notiz/Anzeigename; nur Symbole aus der Allowlist des Workers. Beschädigt → unbekannt,
// nicht überschrieben, Zurücksetzen nur ausdrücklich. Notizen gehen nie an den Worker.
const WL_SCHLUESSEL = "jarvis-aktien-watchlist";
function wlLaden() {
  let roh;
  try { roh = localStorage.getItem(WL_SCHLUESSEL); } catch (e) { return { eintraege: [], beschaedigt: true, grund: "Browserspeicher gesperrt" }; }
  return window.AktienAssistent.wlLesen(roh);
}
function wlSpeichern(eintraege) {
  if (wlLaden().beschaedigt) return "Watchlist-Speicher beschädigt – nichts geändert.";
  try { localStorage.setItem(WL_SCHLUESSEL, window.AktienAssistent.wlText(eintraege)); return null; } catch (e) { return "Watchlist konnte nicht gespeichert werden (Browserspeicher)."; }
}
function wlStatus(text) { ablaufEl("wl-status").textContent = text; }
let wlLaeuft = false;
function wlHinzufuegen(symbol, notiz) {
  if (wlLaeuft) return false;
  wlLaeuft = true;
  // ab 11-07k: Schreibvarianten („brk-b“, „BRK/B“, „$aapl“) wie die Watchlist schreiben – doppelte Symbole werden so erkannt
  if (typeof wlSymbolNormal === "function") symbol = wlSymbolNormal(symbol);
  try {
    const r = window.AktienAssistent.wlHinzufuegen(wlLaden(), { symbol, notiz, jetzt: Date.now(), allowlist: ablaufAllowlist() });
    feldUngueltig("wl-symbol", Boolean(r.fehler) && !r.doppelt);
    if (r.fehler) { wlStatus("Nicht hinzugefügt: " + r.fehler); return false; }
    const f = wlSpeichern(r.eintraege);
    if (f) { wlStatus(f); return false; }
    wlStatus(String(symbol).trim().toUpperCase() + " steht auf der Watchlist.");
    wlZeigen();
    return true;
  } finally { wlLaeuft = false; }
}
function wlEntfernen(symbol) {
  const r = window.AktienAssistent.wlEntfernen(wlLaden(), symbol);
  if (r.fehler) { wlStatus(r.fehler); return false; }
  const f = wlSpeichern(r.eintraege);
  if (f) { wlStatus(f); return false; }
  wlStatus(String(symbol).toUpperCase() + " entfernt.");
  wlZeigen();
  return true;
}
// ab 11-07k: Export enthält zusätzlich „meta“ (Kategorie, Tags, Favorit) – ältere Versionen ignorieren das Feld beim Import
function wlExportText() {
  const s = wlLaden();
  if (s.beschaedigt) return null;
  const text = window.AktienAssistent.wlText(s.eintraege);
  if (typeof wlMetaFuer !== "function") return text;
  const meta = wlMetaFuer(s.eintraege.map((e) => e.symbol));
  return Object.keys(meta).length ? JSON.stringify({ ...JSON.parse(text), meta }) : text;
}
function wlImportText(text) {
  const r = window.AktienAssistent.wlImportPruefen(text, ablaufAllowlist());
  if (r.fehler) { wlStatus(r.fehler); return false; }
  // Zusatzangaben nur für importierte Symbole und nur mit gültiger Form; ungültige werden genannt, nicht übernommen
  let meta = {}, metaFehler = [];
  try { const d = JSON.parse(text); if (d && d.meta && typeof d.meta === "object" && typeof wlMetaPruefen === "function") for (const [sym, m] of Object.entries(d.meta)) { if (!r.eintraege.some((e) => e.symbol === sym)) continue; const p = wlMetaPruefen(m); if (p.fehler) metaFehler.push(sym + ": " + p.fehler); else meta[sym] = p.meta; } } catch (e) { /* schon geprüft */ }
  wlBestaetigen(`Watchlist durch ${r.eintraege.length} importierte Einträge ersetzen?` + (Object.keys(meta).length ? ` Mit Zusatzangaben für ${Object.keys(meta).length} Symbol(e).` : ""), () => {
    const f = wlSpeichern(r.eintraege);
    if (f) { wlStatus(f); return; }
    let metaHinweis = "";
    for (const [sym, m] of Object.entries(meta)) { const x = wlMetaSetzen(sym, m); if (x.fehler) { metaHinweis = " Zusatzangaben nicht übernommen: " + x.fehler; break; } }
    wlStatus(`Import übernommen: ${r.eintraege.length} Einträge.` + metaHinweis + (metaFehler.length ? " Ungültige Zusatzangaben übersprungen: " + metaFehler.slice(0, 3).join(" · ") : ""));
    wlZeigen();
  });
  return true;
}
function wlVerschieben(symbol, richtung) {
  const r = window.AktienAssistent.wlVerschieben(wlLaden(), symbol, richtung);
  if (r.fehler) { wlStatus(r.fehler); return false; }
  const f = wlSpeichern(r.eintraege);
  if (f) { wlStatus(f); return false; }
  wlStatus(`${symbol} ${richtung < 0 ? "nach oben" : "nach unten"} verschoben.`);
  wlZeigen();
  const knopf = ablaufEl("wl-liste").querySelector(`li[data-symbol="${symbol}"] [data-aktion="${richtung < 0 ? "hoch" : "runter"}"]`);
  if (knopf && !knopf.disabled) knopf.focus(); // Tastaturbedienung: Fokus bleibt am verschobenen Eintrag
  return true;
}
// Bestätigung für riskante LOKALE Änderungen (Entfernen, Import, Zurücksetzen) – bewusst kein confirm() und klar keine Orderbestätigung.
// Eine offene Bestätigung wird genau einmal ausgeführt (Doppelklick auf „Ja“ führt nichts zweimal aus).
let wlOffen = null;
function wlBestaetigen(text, aktion) {
  wlOffen = aktion;
  ablaufEl("wl-bestaetigung-text").textContent = "Lokale Watchlist-Änderung (keine Order, kein Kauf oder Verkauf): " + text;
  ablaufEl("wl-bestaetigung").hidden = false;
  // Fokus auf „Abbrechen“ (ab 11-02i): ein zweites Enter bzw. Tastenwiederholung nach „Entfernen“ darf nicht sofort bestätigen
  ablaufEl("wl-bestaetigung-nein").focus();
}
function wlBestaetigungSchliessen(ausfuehren) {
  const aktion = wlOffen;
  wlOffen = null;
  ablaufEl("wl-bestaetigung").hidden = true;
  if (!aktion) return;
  if (ausfuehren) aktion(); else wlStatus("Abgebrochen – nichts geändert.");
  ablaufEl("wl-symbol").focus();
}
function wlRohSichern() {
  let roh = null;
  try { roh = localStorage.getItem(WL_SCHLUESSEL); } catch (e) { /* gesperrt */ }
  if (!roh) { wlStatus("Kein Speicherinhalt zum Sichern vorhanden."); return; }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([roh], { type: "application/json" })), download: "jarvis-aktien-watchlist-beschaedigt.json" });
  a.click();
  wlStatus("Beschädigter Inhalt als Datei gesichert – danach kann der Speicher zurückgesetzt werden.");
}
// Aktives Symbol: Wechsel verwirft Ergebnisse des vorherigen Symbols (Strategie-Vergleich, Paper-Vorschlag, Briefing)
function wlAktivSetzen(symbol) {
  const s = String(symbol || "").trim().toUpperCase();
  if (ABLAUF.laeuft) { wlStatus("Analyse läuft – Symbolwechsel erst danach."); return false; }
  if (!s || s === APROFIL.aktiv) { wlAktivZeigen(); return Boolean(s); }
  const vorher = APROFIL.aktiv;
  APROFIL.aktiv = s;
  ablaufEl("ablauf-symbol").value = s;
  // Offener Strategie-Dialog bzw. noch nicht bestätigter Vergleich gehört zum alten Symbol → verwerfen, nichts rechnen
  if ((SL_DIALOG.aktiv && SL_DIALOG.symbol !== s) || (offeneAktion && offeneAktion.skill === "aktien-strategie")) {
    slDialogBeenden();
    if (offeneAktion && offeneAktion.skill === "aktien-strategie") offeneAktionBeenden();
    lokalAntworten(`Strategie-Vergleich verworfen (Symbolwechsel zu ${s}). Es wurde nichts gerechnet.`);
  }
  if (APROFIL.letztes && APROFIL.letztes.kontext.symbol !== s) {
    if (APROFIL.strategie) ablaufEl("sl-ergebnis").textContent = `Strategie-Vergleich zu ${APROFIL.letztes.kontext.symbol} verworfen (Symbolwechsel).`;
    slZuruecksetzen();
    APROFIL.strategieVorher = null;
    if (APROFIL.vorschlag) { APROFIL.vorschlag = null; profilVorschlagZeigen(`Paper-Vorschlag zu ${APROFIL.letztes.kontext.symbol} verworfen (Symbolwechsel) – nichts gebucht.`); }
    ablaufEl("profil-bestaetigen").disabled = true;
  }
  abUngueltig("Symbolwechsel" + (vorher ? ` von ${vorher}` : ""));
  slVorschau();
  wlAktivZeigen();
  wlZeigen();
  return true;
}
function wlAktivZeigen() {
  const s = APROFIL.aktiv;
  const a = s && APROFIL.analysen[s];
  ablaufEl("wl-aktiv").textContent = s ? `Aktives Symbol: ${s} · ${a ? "Analyse " + (window.AktienAssistent.STATUS_TEXT[a.status] || a.status) + (APROFIL.letztes && APROFIL.letztes.kontext.symbol === s ? " (aktuelle Ergebnisse)" : " (frühere Analyse dieser Sitzung)") : "noch nicht analysiert – „Analysieren“ wählen"}` : "Aktives Symbol: keins gewählt.";
}
function wlZeitText(t) { const d = new Date(t); return Number.isFinite(d.getTime()) ? `${d.toLocaleString("de-DE")} (${d.toISOString().slice(0, 16).replace("T", " ")} UTC)` : "unbekannt"; }
function wlDetailZeigen(symbol) {
  const box = ablaufEl("wl-detail");
  const e = wlLaden().eintraege.find((x) => x.symbol === symbol);
  if (!e) { box.hidden = true; box.replaceChildren(); return; }
  const a = APROFIL.analysen[symbol];
  const al = ablaufAllowlist();
  const zeilen = [
    `${e.symbol}${e.anzeigename ? " – " + e.anzeigename : ""} (Watchlist-Eintrag seit ${wlZeitText(e.erstellt)})`,
    e.notiz ? "Notiz (nur auf diesem Gerät): " + e.notiz : "Keine Notiz.",
    a ? `Letzte Analyse: ${window.AktienAssistent.STATUS_TEXT[a.status] || a.status} · Quelle ${a.quelle} · Datenzeit ${a.datenzeit ? wlZeitText(a.datenzeit) : "unbekannt"} · ${a.frisch === false ? "VERALTET" : a.synthetisch ? "künstliches Datum der synthetischen Testdaten, keine Marktzeit" : a.frisch === true ? "aktuell genug" : "Aktualität unbekannt"}` : "Noch nicht analysiert – keine Quelle, kein Datenstand.",
    a && a.kurs !== null && Number.isFinite(a.kurs) ? `Letzter Schluss laut Quelle: ${a.kurs} USD` : "Kurs: nicht verfügbar (keine Kursdaten in dieser Sitzung).",
    al ? (al.includes(e.symbol) ? "In der Allowlist." : "Nicht mehr in der Allowlist – Analyse über den Worker nicht möglich.") : "Allowlist unbekannt (Worker nicht verbunden).",
  ];
  const kopf = Object.assign(document.createElement("h4"), { textContent: "Details " + e.symbol, tabIndex: -1 });
  const ul = document.createElement("ul");
  ul.append(...zeilen.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  const knopf = (text, label, f) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", textContent: text }); b.setAttribute("aria-label", label); b.addEventListener("click", f); return b; };
  const aktionen = document.createElement("div");
  aktionen.className = "order-zeile";
  aktionen.append(
    knopf("Als aktiv wählen", `${e.symbol} als aktives Symbol wählen`, () => wlAktivSetzen(e.symbol)),
    knopf("Analysieren", `${e.symbol} analysieren`, () => { if (wlAktivSetzen(e.symbol)) ablaufStarten(); }),
    knopf("Briefing zu " + e.symbol, `Briefing zu ${e.symbol} anzeigen`, () => abBriefing("kurz", e.symbol)),
    knopf("Schließen", "Details schließen", () => { box.hidden = true; const z = ablaufEl("wl-liste").querySelector(`li[data-symbol="${e.symbol}"] [data-aktion="details"]`); if (z) z.focus(); }));
  box.replaceChildren(kopf, ul, aktionen);
  box.hidden = false;
  box.dataset.symbol = e.symbol;
  kopf.focus();
}
// ab 11-06e: Anzeige sortieren und filtern (nur Anzeige). Kennzahlen nur aus Analysen dieser Sitzung – nicht analysierte Werte
// stehen bei KGV/Kursänderung hinten, nie mit einem geschätzten Wert.
function wlSicht(eintraege) {
  const art = ablaufEl("wl-sortierung").value, filter = String(ablaufEl("wl-filter").value || "").trim().toLowerCase(), nurAnalysiert = ablaufEl("wl-nur-analysiert").checked;
  const kz = (sym, m) => { const a = APROFIL.analysen[sym]; const v = a && a.kennzahlen ? a.kennzahlen[m] : null; return Number.isFinite(v) ? v : null; };
  // ab 11-07k: Zusatzangaben (Kategorie, Tags, Favorit) aus app/29-watchlist-plus.js – kombinierbar mit allen anderen Filtern
  const meta = (s) => (typeof wlMeta === "function" ? wlMeta(s) : {});
  const el = (id) => document.getElementById(id);
  const katF = el("wl-kategorie-filter") ? el("wl-kategorie-filter").value : "", tagF = el("wl-tag-filter") ? el("wl-tag-filter").value : "", nurFav = el("wl-nur-favoriten") ? el("wl-nur-favoriten").checked : false;
  let liste = eintraege.map((e, i) => ({ e, i }));
  if (filter) liste = liste.filter(({ e }) => [e.symbol, e.notiz, e.anzeigename, meta(e.symbol).kategorie, ...(meta(e.symbol).tags || [])].some((x) => x && String(x).toLowerCase().includes(filter.replace(/^#/, ""))));
  if (nurAnalysiert) liste = liste.filter(({ e }) => APROFIL.analysen[e.symbol]);
  if (katF) liste = liste.filter(({ e }) => meta(e.symbol).kategorie === katF);
  if (tagF) liste = liste.filter(({ e }) => (meta(e.symbol).tags || []).includes(tagF));
  if (nurFav) liste = liste.filter(({ e }) => meta(e.symbol).favorit);
  const nachZahl = (m, ab) => (x, y) => { const a = kz(x.e.symbol, m), b = kz(y.e.symbol, m); return (a === null) - (b === null) || (a === null ? 0 : ab ? b - a : a - b) || x.i - y.i; };
  const vergleich = { symbol: (x, y) => x.e.symbol.localeCompare(y.e.symbol), analyse: (x, y) => (!APROFIL.analysen[x.e.symbol]) - (!APROFIL.analysen[y.e.symbol]) || x.i - y.i,
    kgv: nachZahl("pe", false), perf3m: nachZahl("perf_3m", true), erstellt: (x, y) => String(y.e.erstellt || "").localeCompare(String(x.e.erstellt || "")) || x.i - y.i,
    favorit: (x, y) => (!meta(x.e.symbol).favorit) - (!meta(y.e.symbol).favorit) || x.i - y.i,
    kategorie: (x, y) => (!meta(x.e.symbol).kategorie) - (!meta(y.e.symbol).kategorie) || String(meta(x.e.symbol).kategorie || "").localeCompare(String(meta(y.e.symbol).kategorie || ""), "de") || x.i - y.i }[art];
  if (vergleich) liste.sort(vergleich);
  const namen = { symbol: "Symbol A–Z", analyse: "zuerst analysiert", kgv: "KGV aufsteigend", perf3m: "Kursänderung 3 Monate absteigend", erstellt: "zuletzt hinzugefügt", favorit: "Favoriten zuerst", kategorie: "nach Kategorie" };
  return { liste, sortierung: vergleich ? namen[art] : "", gefiltert: Boolean(filter || nurAnalysiert || katF || tagF || nurFav) };
}
// Vergleich der analysierten Watchlist-Werte (Kennzahlen aus den Analysen dieser Sitzung, AktienScreener.vergleichen)
function wlVergleichZeigen() {
  const box = ablaufEl("wl-vergleich");
  const s = wlLaden();
  const daten = (s.beschaedigt ? [] : s.eintraege).map((e) => APROFIL.analysen[e.symbol] && APROFIL.analysen[e.symbol].kennzahlen ? { ...APROFIL.analysen[e.symbol].kennzahlen, ticker: e.symbol } : null).filter(Boolean);
  const v = window.AktienScreener.vergleichen(daten);
  box.hidden = false;
  if (v.fehler) { box.textContent = v.fehler + " Nächster Schritt: mindestens zwei Watchlist-Werte analysieren."; return; }
  const zahl = (x) => (x === null ? "–" : x.toLocaleString("de-DE", { maximumFractionDigits: 2 }));
  const tab = document.createElement("table");
  tab.className = "wz-tabelle";
  tab.append(wzKnoten("tr", {}, wzKnoten("th", { text: "Kennzahl" }), ...v.zeilen.map((z) => wzKnoten("th", { text: z.ticker }))),
    ...v.spalten.filter((sp) => v.zeilen.some((z) => z.werte[sp.metric] !== null)).map((sp) => wzKnoten("tr", {}, wzKnoten("th", { text: sp.name + (sp.richtung ? (sp.richtung === "hoch" ? " (höher vorne)" : " (niedriger vorne)") : "") }),
      ...v.zeilen.map((z) => { const td = wzKnoten("td", { text: zahl(z.werte[sp.metric]) + ((v.vorne[sp.metric] || []).includes(z.ticker) ? " ◆" : "") }); if ((v.vorne[sp.metric] || []).includes(z.ticker)) td.dataset.vorne = "1"; return td; }))));
  const quelle = daten.some((d) => APROFIL.analysen[d.ticker].synthetisch) ? " Enthält synthetische Testdaten (keine Marktdaten)." : "";
  // ab 11-07k: Risikohinweise je Wert – Datenlage und Schwankung, keine Bewertung
  const risiken = v.zeilen.map((z) => {
    const a = APROFIL.analysen[z.ticker] || {}, h = [];
    if (a.synthetisch) h.push("synthetische Testdaten");
    if (a.frisch === false) h.push("Daten veraltet");
    const fehlt = Object.values(z.werte).filter((x) => x === null).length;
    if (fehlt) h.push(`${fehlt} von ${Object.keys(z.werte).length} Kennzahlen fehlen`);
    if (Number.isFinite(z.werte.volatilitaet_20t) && z.werte.volatilitaet_20t >= 40) h.push(`hohe Schwankung (${z.werte.volatilitaet_20t} % p. a.)`);
    if ((z.hinweise || []).some((x) => /Widerspruch/.test(x))) h.push("widersprüchliche SEC-Daten");
    return { ticker: z.ticker, h };
  }).filter((x) => x.h.length);
  box.replaceChildren(wzKnoten("div", { klasse: "klein", text: `Vergleich von ${v.zeilen.length} analysierten Werten · ◆ = vorne nach dieser einen Kennzahl.` }), tab,
    wzKnoten("div", { klasse: "klein", text: (v.fehlend.length ? "Nicht verfügbar: " + v.fehlend.join(", ") + ". " : "") + v.hinweis + quelle }),
    wzKnoten("ul", { "data-art": "risiken", "aria-label": "Risikohinweise zum Vergleich" }, ...(risiken.length ? risiken.map((x) => wzKnoten("li", { text: `⚠ ${x.ticker}: ${x.h.join(" · ")}` })) : [wzKnoten("li", { text: "Keine Risikohinweise zur Datenlage." })])));
}
function wlZeigen() {
  if (typeof wlMetaFilterAuffrischen === "function") wlMetaFilterAuffrischen(); // ab 11-07k
  const s = wlLaden();
  const liste = ablaufEl("wl-liste");
  ablaufEl("wl-reset").hidden = !s.beschaedigt;
  ablaufEl("wl-roh-sichern").hidden = !s.beschaedigt;
  wlAktivZeigen();
  if (s.beschaedigt) {
    liste.replaceChildren(Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: "Fehler: Watchlist unbekannt (" + (s.grund || "Speicher beschädigt") + ") – nichts verwendet oder überschrieben. Nächster Schritt: Inhalt sichern, dann „Watchlist-Speicher zurücksetzen“ oder eine gültige Datei importieren." }));
    ablaufEl("wl-detail").hidden = true;
    return;
  }
  const al = ablaufAllowlist();
  const offline = !al ? Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: (verbunden() ? "Allowlist unbekannt" : "Offline (Worker nicht verbunden)") + ": Liste bleibt lesbar; Hinzufügen und Import erst mit bekannter Allowlist – im Cockpit verbinden." }) : null;
  const n = s.eintraege.length;
  const sicht = wlSicht(s.eintraege);
  const geordnet = !sicht.sortierung && !sicht.gefiltert; // ↑/↓ nur in der eigenen, ungefilterten Reihenfolge
  ablaufEl("wl-filter-status").textContent = sicht.gefiltert || sicht.sortierung ? `${sicht.liste.length} von ${n} Einträgen angezeigt${sicht.sortierung ? " · sortiert: " + sicht.sortierung : ""} – gespeicherte Reihenfolge unverändert; ↑/↓ nur in der eigenen Reihenfolge ohne Filter.` : "";
  liste.replaceChildren(...(offline ? [offline] : []), ...(n && !sicht.liste.length ? [Object.assign(document.createElement("li"), { textContent: "Kein Eintrag passt zum Filter." })] : []), ...(n ? sicht.liste.map(({ e, i }) => {
    const li = document.createElement("li");
    li.dataset.symbol = e.symbol;
    if (e.symbol === APROFIL.aktiv) li.setAttribute("aria-current", "true");
    const a = APROFIL.analysen[e.symbol];
    const info = a ? `Analyse: ${(window.AktienAssistent.STATUS_TEXT[a.status] || a.status)} · Quelle ${a.quelle} · Datenzeit ${a.datenzeit ? new Date(a.datenzeit).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unbekannt"} · ${a.frisch === false ? "veraltet" : a.synthetisch ? "künstliches Datum (synthetische Testdaten)" : a.frisch === true ? "frisch" : "Frische unbekannt"}` : "noch nicht analysiert (kein Kurs angezeigt)";
    const m = typeof wlMeta === "function" ? wlMeta(e.symbol) : {}; // ab 11-07k
    li.append(Object.assign(document.createElement("div"), { textContent: `${e.symbol === APROFIL.aktiv ? "▶ aktiv: " : ""}${m.favorit ? "★ " : ""}${e.symbol}${e.notiz ? " – " + e.notiz : ""}${m.kategorie ? " · [" + m.kategorie + "]" : ""}${m.tags && m.tags.length ? " · " + m.tags.map((t) => "#" + t).join(" ") : ""} · ${info}${al && !al.includes(e.symbol) ? " · nicht mehr in der Allowlist" : ""}` }));
    const knopf = (text, label, aktion, f, aus) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", textContent: text, disabled: Boolean(aus) }); b.dataset.aktion = aktion; b.setAttribute("aria-label", label); b.addEventListener("click", f); return b; };
    li.append(
      knopf("Details", `Details zu ${e.symbol}`, "details", () => wlDetailZeigen(e.symbol)),
      knopf("Aktiv", `${e.symbol} als aktives Symbol wählen`, "aktiv", () => wlAktivSetzen(e.symbol), e.symbol === APROFIL.aktiv),
      knopf("Analyse vorbereiten", `${e.symbol} analysieren`, "analysieren", () => { if (wlAktivSetzen(e.symbol)) ablaufStarten(); }),
      knopf("↑", `${e.symbol} nach oben verschieben`, "hoch", () => wlVerschieben(e.symbol, -1), i === 0 || !geordnet),
      knopf("↓", `${e.symbol} nach unten verschieben`, "runter", () => wlVerschieben(e.symbol, 1), i === n - 1 || !geordnet),
      knopf("Entfernen", `${e.symbol} von der Watchlist entfernen`, "entfernen", () => wlBestaetigen(`${e.symbol} von der Watchlist entfernen?`, () => wlEntfernen(e.symbol))));
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "Keine Einträge. Nächster Schritt: Symbol eingeben und „Zur Watchlist“ wählen." })]));
  const offenesDetail = ablaufEl("wl-detail");
  if (!offenesDetail.hidden && !s.eintraege.some((x) => x.symbol === offenesDetail.dataset.symbol)) offenesDetail.hidden = true;
}

// ---------- US-Aktien-Briefing (ab 11-02a): nur Daten dieser Sitzung, keine Anfrage ----------
// symbol: Briefing zu einem Watchlist-Symbol aus dessen letzter Analyse dieser Sitzung; ohne Analyse → „nicht verfügbar“, nichts geraten.
// Ohne symbol: aktives Symbol, sonst letzter Lauf. Anzeige und Vorlesetext entstehen aus demselben Ergebnis (gleiche Gruppen, gleiche Reihenfolge).
function abBriefing(variante, symbol) {
  const sym = symbol || APROFIL.aktiv || (APROFIL.letztes && APROFIL.letztes.kontext.symbol) || null;
  const eintrag = sym && APROFIL.analysen[sym];
  const d = eintrag ? eintrag.dispatch : symbol ? null : APROFIL.letzteDispatch;
  const jetzt = Date.now();
  const b = window.AktienAssistent.briefingErstellen(d, SIM.portfolio, { variante, jetzt });
  if (!d && sym) { b.zeilen[0].inhalt = `Briefing für ${sym} nicht verfügbar – ${sym} wurde in dieser Sitzung noch nicht analysiert.`; b.text = b.text.replace("Kein Aktienprofil in dieser Sitzung – erst eine US-Aktie analysieren.", b.zeilen[0].inhalt); }
  const art = { beobachtet: "Beobachtet", einordnung: "Einordnung", annahme: "Annahme", simulation: "Simulation", fehlt: "Fehlt" };
  const alter = (m) => m === null ? "" : m < 120 ? `, ${m} min alt` : m < 2880 ? `, ${Math.round(m / 60)} h alt` : `, ${Math.round(m / 1440)} Tage alt`;
  ablaufEl("ab-briefing").replaceChildren(...b.gruppen.flatMap((g) => {
    const h = Object.assign(document.createElement("h4"), { textContent: g.titel });
    const ul = document.createElement("ul");
    ul.dataset.gruppe = g.id;
    ul.setAttribute("aria-label", g.titel);
    ul.append(...g.zeilen.map((z) => {
      const li = document.createElement("li");
      li.dataset.art = z.art;
      if (g.id === "warnung" || g.id === "nicht_verfuegbar") li.className = "wz-wichtig";
      // textContent: Nachrichtentitel und Meldungstexte bleiben Daten (kein HTML, keine Befehle)
      li.textContent = `${z.bereich} – ${art[z.art]}: ${z.inhalt}` + (z.belegt ? ` (Quelle: ${z.quelle}, Stand ${new Date(z.stand).toISOString().slice(0, 16).replace("T", " ")} UTC${z.kuenstlich ? ", künstliches Datum (synthetische Testdaten) – kein echtes Datenalter" : alter(z.alter_min)})` : z.art === "fehlt" ? "" : " (ohne Beleg – nicht als Tatsache)");
      return li;
    }));
    return [h, ul];
  }));
  const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "lokale Zeit"; } catch (e) { return "lokale Zeit"; } })();
  ablaufEl("ab-meta").textContent = `Briefing ${variante === "lang" ? "ausführlich" : "kurz"}${sym ? " · " + sym : ""} · erstellt ${new Date(jetzt).toLocaleString("de-DE")} (${zone}) = ${b.erstellt.slice(0, 16).replace("T", " ")} UTC · nur Daten dieser Sitzung, keine neue Anfrage.`;
  APROFIL.briefing = { symbol: sym, erstellt: b.erstellt, variante };
  APROFIL.briefingText = b.text;
  return b;
}
// Briefing gehört zu einem Lauf/Symbol: nach Symbolwechsel oder neuem Lauf sichtbar verwerfen (nie als aktuell weiterzeigen oder vorlesen)
function abUngueltig(grund) {
  if (!APROFIL.briefingText) return;
  APROFIL.briefingText = null;
  APROFIL.briefing = null;
  ablaufEl("ab-briefing").replaceChildren();
  ablaufEl("ab-meta").textContent = `Briefing verworfen (${grund}) – bei Bedarf neu erzeugen.`;
}
function abVorleseKnoepfe() {
  const v = APROFIL.vorlese;
  ablaufEl("ab-vorlesen-pause").disabled = !(v.aktiv && !v.pausiert);
  ablaufEl("ab-vorlesen-weiter").disabled = !(v.aktiv && v.pausiert);
  ablaufEl("ab-vorlesen-abbruch").disabled = !v.aktiv;
  ablaufEl("ab-briefing-vorlesen").disabled = v.aktiv;
}
// Rückmeldung aus vorlesenAnzeigen (vorhandene Sprachausgabe): Status folgt der tatsächlichen Wiedergabe, „beendet“ erst nach echtem Start
function abVorleseAnzeigen(laeuft) {
  const v = APROFIL.vorlese;
  if (!v.aktiv) return;
  const status = ablaufEl("ab-vorlese-status");
  if (laeuft) { v.gesehen = true; status.textContent = v.pausiert ? "Vorlesen pausiert." : "Vorlesen läuft …"; return; }
  if (!v.gesehen || v.pausiert) return;
  const sp = document.getElementById("sprach-status");
  const fehler = sp && sp.dataset.art === "fehler" && sp.textContent !== v.statusVorher ? sp.textContent : "";
  // Ausweichen auf die Browserstimme: die Wiedergabe geht weiter, also noch nicht „beendet“
  if (fehler && /Browserstimme/.test(fehler)) { status.textContent = "Hinweis: " + fehler; v.statusVorher = sp.textContent; return; }
  v.aktiv = false;
  status.textContent = v.abgebrochen ? "Vorlesen abgebrochen." : fehler ? "Vorlesen mit Fehler beendet: " + fehler : "Vorlesen beendet.";
  APROFIL.vorlesen = false;
  abVorleseKnoepfe();
}
async function abBriefingVorlesen() {
  if (APROFIL.vorlesen) return; // läuft schon: kein zweiter Start (Doppelklick, wiederholter Befehl)
  const text = APROFIL.briefingText || abBriefing("kurz").text;
  const status = ablaufEl("ab-vorlese-status");
  const googleMoeglich = sprache.quelle !== "browser" && verbunden() && sprechenVerfuegbar;
  if (!("speechSynthesis" in window) && !googleMoeglich) { status.textContent = "Vorlesen nicht möglich: keine Sprachausgabe verfügbar (Browser ohne Sprachsynthese, Google-Stimme nicht erreichbar) – der Text bleibt sichtbar."; return; }
  const sp = document.getElementById("sprach-status");
  APROFIL.vorlesen = true;
  APROFIL.vorlese = { aktiv: true, gesehen: false, pausiert: false, abgebrochen: false, statusVorher: sp ? sp.textContent : "" };
  status.textContent = "Vorlesen wird vorbereitet (" + (googleMoeglich ? "Google-Stimme" : "Browserstimme") + ") …";
  abVorleseKnoepfe();
  try { await lokalVorlesen(text, true, { kurzerAnfang: true }); } // vorhandener Weg: Teile, Stimme und Tempo aus den Einstellungen
  catch (e) {
    APROFIL.vorlese.aktiv = false;
    APROFIL.vorlesen = false;
    status.textContent = "Vorlesen nicht möglich: " + (e && e.message ? e.message : "unbekannt") + " – Text bleibt oben sichtbar.";
    abVorleseKnoepfe();
  }
}
// Pause/Fortsetzen über die vorhandene Wiedergabe: Google-Audio (aktuellesAudio) oder Browserstimme (speechSynthesis)
function abVorlesenPause() {
  const v = APROFIL.vorlese;
  if (!v.aktiv || v.pausiert) return;
  try {
    if (aktuellesAudio) aktuellesAudio.pause();
    else if ("speechSynthesis" in window) window.speechSynthesis.pause();
  } catch (e) { ablaufEl("ab-vorlese-status").textContent = "Pause wird von dieser Sprachausgabe nicht unterstützt – „Vorlesen abbrechen“ ist möglich."; return; }
  v.pausiert = true;
  ablaufEl("ab-vorlese-status").textContent = "Vorlesen pausiert.";
  abVorleseKnoepfe();
  ablaufEl("ab-vorlesen-weiter").focus();
}
function abVorlesenWeiter() {
  const v = APROFIL.vorlese;
  if (!v.aktiv || !v.pausiert) return;
  v.pausiert = false;
  if (aktuellesAudio) { const p = aktuellesAudio.play(); if (p && typeof p.catch === "function") p.catch(() => { ablaufEl("ab-vorlese-status").textContent = "Fortsetzen blockiert (Browser) – bitte erneut „Briefing vorlesen“."; }); }
  else if ("speechSynthesis" in window) { try { window.speechSynthesis.resume(); } catch (e) { /* ohne resume(): Abbrechen bleibt möglich */ } }
  ablaufEl("ab-vorlese-status").textContent = "Vorlesen läuft …";
  abVorleseKnoepfe();
  ablaufEl("ab-vorlesen-pause").focus();
}
function abVorlesenAbbrechen() {
  const v = APROFIL.vorlese;
  if (!v.aktiv) return;
  v.abgebrochen = true;
  v.pausiert = false;
  v.gesehen = true;
  if ("speechSynthesis" in window) { try { window.speechSynthesis.resume(); } catch (e) { /* pausierte Browserstimme sonst nicht abbrechbar */ } }
  vorlesenStoppen();
  if (v.aktiv) abVorleseAnzeigen(false);
  ablaufEl("ab-briefing-vorlesen").focus();
}


;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("watchlist");
