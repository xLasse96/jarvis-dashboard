// JARVIS Dashboard – Modul „uebersichten-freigaben“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Übersichten: KI & Integrationen, KI-Nutzung, Fähigkeiten & Freigaben (Stand …30i) ----------
const zahlDe = (n) => Number(n || 0).toLocaleString("de-DE");
const kurzZeit = (z) => new Date(z).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });

// KI-Nutzung: nur Mengen je Anfrage (Anbieter, Modell, Zeit, Token, Websuchen, Zeichen der Sprachausgabe) – keine Inhalte.
const KI_NUTZUNG = { schluessel: "jarvis-ki-nutzung", max: 500, zeichenJeToken: 4 };
function kiNutzungLesen() {
  try { const d = JSON.parse(localStorage.getItem(KI_NUTZUNG.schluessel) || "[]"); return Array.isArray(d) ? d.filter((e) => e && !isNaN(Date.parse(e.zeit))) : []; } catch (e) { return []; }
}
function kiNutzungErfassen(e) {
  const n = e.nutzung && typeof e.nutzung === "object" ? e.nutzung : null;
  const echt = Boolean(n && n.anfragen > 0);
  const schaetzen = (zeichen) => Math.ceil((Number(zeichen) || 0) / KI_NUTZUNG.zeichenJeToken);
  const eintrag = e.art === "sprechen"
    ? { zeit: new Date().toISOString(), art: "sprechen", anbieter: "Google Text-to-Speech (über Worker)", modell: "", eingabe: 0, ausgabe: 0, websuchen: 0, zeichen: Number(e.vorleseZeichen) || 0, geschaetzt: false }
    : { zeit: new Date().toISOString(), art: "chat", anbieter: "Anthropic Claude (über Worker)", modell: String(e.modell || "unbekannt").slice(0, 60),
      eingabe: echt ? n.eingabe_tokens || 0 : schaetzen(e.eingabeZeichen), ausgabe: echt ? n.ausgabe_tokens || 0 : schaetzen(e.ausgabeZeichen),
      websuchen: echt ? n.websuchen || 0 : null,
      zeichen: e.audio ? (echt && Number.isInteger(n.sprachausgabe_zeichen) ? n.sprachausgabe_zeichen : Number(e.vorleseZeichen) || 0) : 0,
      geschaetzt: !echt };
  const liste = [...kiNutzungLesen(), eintrag].slice(-KI_NUTZUNG.max);
  try { localStorage.setItem(KI_NUTZUNG.schluessel, JSON.stringify(liste)); } catch (err) { /* privater Modus */ }
  kiNutzungAnzeigen();
  return eintrag;
}
function kiNutzungFiltern(zeitraum = "alle", art = "") {
  const jetzt = new Date();
  const heute = jetzt.toDateString();
  return kiNutzungLesen().filter((e) => {
    if (art && e.art !== art) return false;
    if (zeitraum === "heute") return new Date(e.zeit).toDateString() === heute;
    if (zeitraum === "7" || zeitraum === "30") return jetzt - new Date(e.zeit) <= Number(zeitraum) * 86400000;
    return true;
  });
}
function kiNutzungSumme(liste) {
  return liste.reduce((s, e) => ({ anfragen: s.anfragen + 1, eingabe: s.eingabe + (e.eingabe || 0), ausgabe: s.ausgabe + (e.ausgabe || 0),
    websuchen: s.websuchen + (e.websuchen || 0), zeichen: s.zeichen + (e.zeichen || 0), geschaetzt: s.geschaetzt + (e.geschaetzt ? 1 : 0) }),
  { anfragen: 0, eingabe: 0, ausgabe: 0, websuchen: 0, zeichen: 0, geschaetzt: 0 });
}
function kiNutzungAnzeigen() {
  const summeEl = document.getElementById("nutzung-summe");
  if (!summeEl) return;
  const liste = kiNutzungFiltern(document.getElementById("nutzung-zeitraum").value, document.getElementById("nutzung-art").value);
  const s = kiNutzungSumme(liste);
  const ca = s.geschaetzt ? "≈ " : "";
  summeEl.textContent = s.anfragen
    ? s.anfragen + " Anfragen · Eingabe " + ca + zahlDe(s.eingabe) + " Token · Ausgabe " + ca + zahlDe(s.ausgabe) + " Token · Websuchen " + zahlDe(s.websuchen)
      + " · Sprachausgabe " + zahlDe(s.zeichen) + " Zeichen" + (s.geschaetzt ? " (davon " + s.geschaetzt + " geschätzt)" : "")
    : "Keine KI-Nutzung in diesem Zeitraum erfasst.";
  document.getElementById("nutzung-liste").replaceChildren(...liste.slice(-50).reverse().map((e) => Object.assign(document.createElement("li"), {
    textContent: kurzZeit(e.zeit) + " · " + e.anbieter + (e.modell ? " · " + e.modell : "")
      + (e.art === "chat" ? " · ein " + (e.geschaetzt ? "≈" : "") + zahlDe(e.eingabe) + " / aus " + (e.geschaetzt ? "≈" : "") + zahlDe(e.ausgabe) + " Token"
        + (e.websuchen === null ? "" : " · " + e.websuchen + " Websuchen") : "")
      + (e.zeichen ? " · Stimme " + zahlDe(e.zeichen) + " Zeichen" : ""),
  })));
}
function kiNutzungLoeschen() {
  if (!kiNutzungLesen().length || !confirm("KI-Nutzungsübersicht löschen? (Nur die Zählung auf diesem Gerät – die Abrechnung des Anbieters bleibt unberührt.)")) return false;
  try { localStorage.removeItem(KI_NUTZUNG.schluessel); } catch (e) { /* nichts gespeichert */ }
  kiNutzungAnzeigen();
  return true;
}

// Integrationen: ehrlicher Stand je Dienst. Prüfen fragt nur Statusseiten ab (keine KI, keine Stimme, keine Order).
const integrationsStand = { worker: null, paper: null, helfer: null, geprueft: null };
let integrationsPruefungLaeuft = false;
async function integrationenPruefen() {
  if (integrationsPruefungLaeuft) return integrationsStand;
  integrationsPruefungLaeuft = true;
  const knopf = document.getElementById("integrationen-pruefen");
  knopf.disabled = true;
  const versuch = async (f) => { try { return { ok: true, daten: await f() }; } catch (e) { return { ok: false, fehler: e.message }; } };
  try {
    integrationsStand.worker = verbunden() ? await versuch(() => workerAnfrage("/status", { method: "GET" })) : null;
    integrationsStand.paper = verbunden() ? await versuch(() => workerAnfrage("/paper/status", { method: "GET" })) : null;
    integrationsStand.helfer = helferEingerichtet() ? await versuch(() => helferAnfrage("/status", { method: "GET" })) : null;
    integrationsStand.geprueft = new Date().toISOString();
  } finally {
    integrationsPruefungLaeuft = false;
    knopf.disabled = false;
    integrationenAnzeigen();
  }
  return integrationsStand;
}
function integrationenZeilen() {
  const w = integrationsStand.worker;
  const s = w && w.ok ? w.daten : null;
  const offen = ["aus", "noch nicht geprüft"];
  const zeilen = [];
  zeilen.push(["Worker (Cloudflare)", !verbunden() ? ["aus", "nicht eingerichtet"] : !w ? offen : w.ok ? ["ok", "erreichbar"] : ["fehler", "Fehler: " + w.fehler]]);
  zeilen.push(["KI: Anthropic Claude", !s ? ["aus", "unbekannt – erst Worker prüfen"] : s.ki_konfiguriert
    ? ["ok", "Schlüssel im Worker hinterlegt · Modell " + (s.modell || "?") + " (nur Status geprüft, keine Testfrage)"] : ["warn", "kein API-Schlüssel im Worker"]]);
  zeilen.push(["Websuche (über Claude)", s && s.ki_konfiguriert ? ["ok", "angeboten, höchstens 3 Suchen je Antwort (laut Worker-Code)"] : ["aus", "nur mit KI-Schlüssel"]]);
  const quelle = typeof sprache !== "undefined" ? sprache.quelle : "google";
  zeilen.push(["Sprachausgabe: Google Text-to-Speech", quelle === "browser" ? ["aus", "nicht gewählt – es spricht die Browserstimme"]
    : typeof sprechenVerfuegbar !== "undefined" && !sprechenVerfuegbar ? ["warn", "Worker ohne /sprechen – lokale Antworten mit Browserstimme"]
      : ["warn", "gewählt · nicht geprüft (ein Test wäre kostenpflichtig)"]]);
  const erkennung = (document.getElementById("spracheingabe-status") || {}).textContent || "";
  zeilen.push(["Spracherkennung (Dienst des Browseranbieters)", erkennung.includes("unterstützt") && !erkennung.includes("nicht") ? ["ok", "vom Browser unterstützt · Mikrofon am Gerät nicht geprüft"] : ["aus", erkennung || "unbekannt"]]);
  const p = integrationsStand.paper;
  zeilen.push(["Paper-Trading (Simulation)", !verbunden() ? ["aus", "nicht eingerichtet"] : !p ? offen : p.ok ? ["ok", "bereit (Spielgeld)"] : ["fehler", "Fehler: " + p.fehler]]);
  zeilen.push(["Binance-Testnet (Spielgeld)", !s ? ["aus", "unbekannt"] : s.trading_konfiguriert ? ["ok", "Schlüssel hinterlegt · Automatik AUS"] : ["aus", "nicht eingerichtet"]]);
  zeilen.push(["Datenspeicher (KV)", !s ? ["aus", "unbekannt"] : s.kv_verbunden ? ["ok", "verbunden"] : ["warn", "nicht verbunden"]]);
  const h = integrationsStand.helfer;
  zeilen.push(["PC-Helfer (nur dieser PC)", !helferEingerichtet() ? ["aus", "nicht eingerichtet"] : !h ? offen : !h.ok ? ["fehler", "Fehler: " + h.fehler]
    : h.daten.attrappe ? ["warn", "Attrappe (Testmodus) – nichts wird wirklich gestartet"] : ["ok", "verbunden"]]);
  zeilen.push(["Home Assistant", hausZeile()]);
  return zeilen;
}
function integrationenAnzeigen() {
  const tabelle = document.getElementById("integrationen-tabelle");
  if (!tabelle) return;
  const zeilen = integrationenZeilen().map(([name, [zustand, text]]) => {
    const tr = document.createElement("tr");
    tr.append(Object.assign(document.createElement("td"), { textContent: name }), Object.assign(document.createElement("td"), { className: zustand, textContent: text }));
    return tr;
  });
  const stand = document.createElement("tr");
  stand.append(Object.assign(document.createElement("td"), { textContent: "Stand" }),
    Object.assign(document.createElement("td"), { textContent: integrationsStand.geprueft ? "geprüft " + kurzZeit(integrationsStand.geprueft) : "noch nicht geprüft" }));
  tabelle.replaceChildren(...zeilen, stand);
}

// Fähigkeiten & Freigaben: Übersicht mit Suche/Filter; Freigabe je Fähigkeit nur strenger einstellbar, Änderungsverlauf
const FREIGABE_NAMEN = { abfrage: "direkt (Abfrage)", leicht: "direkt, rückgängig machbar", bestaetigen: "nur nach Bestätigung", gesperrt: "ausgeschaltet" };
function faehigkeitenAnzeigen() {
  const liste = document.getElementById("faehigkeiten-liste");
  if (!liste) return;
  if (speicherBeschaedigt(FREIGABEN.schluessel)) freigabenMeldung();
  const begriffe = suchNormal(document.getElementById("faehigkeiten-suche").value).split(/\s+/).filter(Boolean);
  const filter = document.getElementById("faehigkeiten-filter").value;
  const passend = SKILLS.filter((skill) => {
    const wirksam = skillRisiko(skill);
    if (filter === "geaendert" && wirksam === skill.risiko) return false;
    if (filter && filter !== "geaendert" && wirksam !== filter) return false;
    const text = suchNormal([skill.name, skill.beschreibung, ...(skill.beispiele || [])].join(" "));
    return begriffe.every((b) => text.includes(b));
  });
  liste.replaceChildren(...(passend.length ? passend.map((skill) => {
    const li = document.createElement("li");
    li.dataset.skill = skill.name;
    const wirksam = skillRisiko(skill);
    const braucht = skill.braucht === "verbindung" ? " · braucht die Worker-Verbindung" : skill.braucht === "helfer" ? " · braucht den PC-Helfer" : "";
    li.append(Object.assign(document.createElement("span"), { className: "faehigkeit-text",
      textContent: skill.beschreibung + (skill.beispiele && skill.beispiele.length ? " – z. B. „" + skill.beispiele.join("“, „") + "“" : "") + braucht
        + " · Standard: " + (skill.risiko === "gesperrt" ? "gesperrt (fest)" : FREIGABE_NAMEN[skill.risiko]) + (wirksam !== skill.risiko ? " · geändert" : "") }));
    if (freigabeEinstellbar(skill)) {
      const wahl = document.createElement("select");
      wahl.className = "feld";
      wahl.setAttribute("aria-label", "Freigabe: " + skill.beschreibung);
      for (const stufe of Object.keys(RISIKO_STUFE)) if (RISIKO_STUFE[stufe] >= RISIKO_STUFE[skill.risiko]) wahl.append(new Option(FREIGABE_NAMEN[stufe], stufe));
      wahl.value = wirksam;
      wahl.addEventListener("change", () => { const r = freigabeSetzen(skill.name, wahl.value); faehigkeitenAnzeigen(); freigabenMeldung(r.gespeichert); });
      li.append(wahl);
    } else {
      li.append(Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: "fest" }));
    }
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "Keine Fähigkeit passt zur Suche." })]));
  const geaendert = SKILLS.filter((s) => skillRisiko(s) !== s.risiko).length;
  document.getElementById("faehigkeiten-anzahl").textContent = SKILLS.length + " Fähigkeiten" + (geaendert ? " · " + geaendert + " geändert" : "");
  const namen = Object.fromEntries(SKILLS.map((s) => [s.name, s.beschreibung]));
  document.getElementById("freigaben-verlauf").replaceChildren(...(freigaben.verlauf.length ? freigaben.verlauf.slice().reverse().map((v) => Object.assign(document.createElement("li"), {
    textContent: kurzZeit(v.zeit) + " · " + (namen[v.skill] || v.skill) + ": " + FREIGABE_NAMEN[v.von] + " → " + FREIGABE_NAMEN[v.nach],
  })) : [Object.assign(document.createElement("li"), { textContent: "Noch keine Änderungen – alle Fähigkeiten im Standard." })]));
}
function freigabenAlleStandard() {
  const geaendert = SKILLS.filter((s) => skillRisiko(s) !== s.risiko);
  if (!geaendert.length || !confirm("Alle " + geaendert.length + " geänderten Freigaben auf den Standard zurücksetzen?")) return 0;
  let gespeichert = true;
  for (const s of geaendert) if (freigabeSetzen(s.name, s.risiko).gespeichert === false) gespeichert = false;
  faehigkeitenAnzeigen();
  freigabenMeldung(gespeichert);
  return geaendert.length;
}

document.getElementById("integrationen-pruefen").addEventListener("click", integrationenPruefen);
document.getElementById("integrationen-karte").addEventListener("toggle", (e) => { if (e.target.open) { integrationenAnzeigen(); kiNutzungAnzeigen(); } });
document.getElementById("nutzung-zeitraum").addEventListener("change", kiNutzungAnzeigen);
document.getElementById("nutzung-art").addEventListener("change", kiNutzungAnzeigen);
document.getElementById("nutzung-loeschen").addEventListener("click", kiNutzungLoeschen);
document.getElementById("faehigkeiten-suche").addEventListener("input", faehigkeitenAnzeigen);
document.getElementById("faehigkeiten-filter").addEventListener("change", faehigkeitenAnzeigen);
document.getElementById("freigaben-standard").addEventListener("click", freigabenAlleStandard);
document.getElementById("faehigkeiten-karte").addEventListener("toggle", (e) => { if (e.target.open) faehigkeitenAnzeigen(); });
kiNutzungAnzeigen();
faehigkeitenAnzeigen();
window.kiNutzungErfassen = kiNutzungErfassen;

// ---------- Daten auf diesem Gerät: Bestand, gezieltes Löschen, Sicherung/Wiederherstellung, Einstellungen übertragen ----------
// Jeder Schlüssel gehört zu genau einem Bereich. Geheimes (Zugangs-/Kopplungscode) verlässt das Gerät nie.
const DATEN_BEREICHE = [
  { id: "verbindung", name: "Verbindung (Worker-Adresse)", schluessel: ["jarvis-worker-url"], einstellung: true },
  { id: "zugang", name: "Zugangscode & Helfer-Kopplungscode", schluessel: ["jarvis-zugangscode", "jarvis-helfer-code"], geheim: true },
  // ab 18c: der für den Paper-Bot auf diesem Tablet gespeicherte Freigabecode (app/81) – eigener geheimer Bereich: einzeln löschbar, nie in Sicherungen
  { id: "freigabecode", name: "Freigabecode (nur dieses Tablet, Paper-Bot)", schluessel: ["jarvis-freigabe-tablet"], geheim: true },
  { id: "stimme", name: "Stimme & Sprache", schluessel: ["jarvis-vorlesen", "jarvis-stimme", "jarvis-stimme-quelle", "jarvis-sprache-erkennung", "jarvis-sprache-ausgabe", "jarvis-vorlesen-umfang"], einstellung: true },
  { id: "freigaben", name: "Freigaben (mit Änderungsverlauf)", schluessel: ["jarvis-freigaben"], einstellung: true, json: true },
  { id: "helfer", name: "PC-Helfer: Aktivierungswort-Schalter", schluessel: ["jarvis-helfer-aktivierung"], einstellung: true },
  { id: "haus", name: "Smart Home: Modus (Demo/getrennt)", schluessel: ["jarvis-haus"], einstellung: true },
  { id: "profil", name: "Profil & Projekte", schluessel: ["jarvis-profil"], json: true },
  { id: "aufgaben", name: "Aufgaben", schluessel: ["jarvis-aufgaben"], json: true },
  { id: "notizen", name: "Notizen", schluessel: ["jarvis-notizen"], json: true }, // ab 11-06h
  { id: "risiko", name: "Risiko-Warnschwellen der Simulation", schluessel: ["jarvis-risiko-schwellen"], einstellung: true, json: true }, // ab 11-06i
  { id: "routinen", name: "Routinen", schluessel: ["jarvis-routinen", "jarvis-routinen-beispiele"] },
  { id: "watchlist", name: "Krypto-Kursliste (Watchlist) & Kursalarme", schluessel: ["jarvis-watchlist"], json: true },
  { id: "paperbot", name: "Paper-Bot (Simulation)", schluessel: ["jarvis-paper-bot"], json: true },
  // US-Aktien (ab 11-02b in der Datenübersicht): vorher gespeichert, aber hier weder sichtbar noch gezielt löschbar oder gesichert.
  // Nicht aufgenommen: „jarvis-aktien-gesendet“ (kurzlebige Sperre gegen doppeltes Senden zwischen Tabs, keine Nutzerdaten).
  { id: "aktien", name: "US-Aktien: Watchlist, Alarme & Merkdaten", schluessel: ["jarvis-aktien-watchlist", "jarvis-aktien-alarme", "jarvis-aktien-news-gesehen", "jarvis-kongress-gesehen", "jarvis-13f-cusip", "jarvis-aktien-wl-meta"] }, // wl-meta ab 11-07k
  { id: "screener", name: "Screener: gespeicherte Regeln & Verlauf", schluessel: ["jarvis-screener"], json: true }, // ab 11-07k
  { id: "aktiensim", name: "US-Aktien-Simulation (Paper-Kern, Spielgeld)", schluessel: ["jarvis-paper-kern-sim"], json: true },
  { id: "verlauf", name: "Gesprächsverlauf & Angeheftetes", schluessel: ["jarvis-verlauf", "jarvis-verlauf-speichern", "jarvis-verlauf-angeheftet"] },
  { id: "protokolle", name: "Diagnose & KI-Nutzung", schluessel: ["jarvis-diagnose", "jarvis-ki-nutzung"] },
  { id: "einrichtung", name: "Einrichtungsfortschritt", schluessel: ["jarvis-einrichtung"] },
  { id: "hinweise", name: "Hinweiszentrale & Übersicht-Einstellungen", schluessel: ["jarvis-hinweise", "jarvis-briefing"], json: true }, // ab 11-07g
  { id: "auftraege", name: "Aufträge (mehrteilige Anfragen) und Protokoll", schluessel: ["jarvis-auftraege"], json: true }, // ab 11-09a
  { id: "dateien", name: "Dateiliste (nur Metadaten, keine Inhalte)", schluessel: ["jarvis-dateien"], json: true }, // ab 11-09d
  { id: "projekte", name: "Projektplanung (Ziele, Status, Meilensteine, Verlauf)", schluessel: ["jarvis-projekte"], json: true }, // ab 11-09f
  { id: "arbeitsplatz", name: "Arbeitsplatz: Kacheln, Kompaktmodus, letzte Sicherung", schluessel: ["jarvis-arbeitsplatz"], json: true }, // ab 11-09g
  { id: "gedaechtnis", name: "Gedächtnis: Löschliste (verhindert Wiederauftauchen), Antwortstil", schluessel: ["jarvis-gedaechtnis", "jarvis-dialog"], json: true }, // ab 11-09j
  { id: "modell", name: "KI-Modell: Anbieter, Testmodus, Datenschutz-Einstellungen", schluessel: ["jarvis-modell"], json: true }, // ab 11-10c
  { id: "vorschlaege", name: "Proaktive Vorschläge: Einstellungen, Entscheidungen, Historie", schluessel: ["jarvis-vorschlaege"], json: true }, // ab 11-10g
  { id: "datenquellen", name: "Datenquellen: Abrufhistorie (Quelle, Ergebnis, Frische)", schluessel: ["jarvis-datenquellen"], json: true }, // ab 11-10n
  { id: "seitenleiste", name: "Seitenleiste: ein/aus (nur Oberfläche)", schluessel: ["jarvis-seitenleiste"], json: true }, // ab 11-10o
  { id: "aktionen", name: "Zuletzt ausgeführte Aktionen (Befehl, Funktion, Ergebnis)", schluessel: ["jarvis-aktionen"], json: true }, // ab 11-11a
  { id: "workflow-lauf", name: "Unterbrochener Workflow-Lauf (für das Fortsetzen)", schluessel: ["jarvis-workflow-lauf"], json: true }, // ab 11-09l
  { id: "aktien-historie", name: "Aktien-Überblick: Analyse- und Simulationshistorie", schluessel: ["jarvis-aktien-historie"], json: true }, // ab 11-09m
  { id: "start", name: "Startseite der App", schluessel: ["jarvis-start"], json: true }, // ab 11-09p (Schlüssel aus 09o, vorher keinem Bereich zugeordnet)
  { id: "automatik", name: "Automatisierungen (Regeln und Protokoll)", schluessel: ["jarvis-automatik"], json: true }, // ab 11-07f
  // ab 11-07b: Oberflächenzustand (07a eingeklappte Karten, 07b Favoriten und zuletzt genutzte Ziele) – sichtbar, löschbar, gesichert
  { id: "oberflaeche", name: "Oberfläche: eingeklappte Karten, Favoriten, zuletzt genutzt", schluessel: ["jarvis-karten-zu", "jarvis-nav-favoriten", "jarvis-nav-zuletzt"], json: true },
];
const DATEN = { maxWert: 2000000, maxDatei: 5000000 };
// ab 11-07h: Grundform je Schlüssel – dieselbe, mit der die Module ihren Stand laden (speicherJsonLesen). Ein Import mit anderer Form
// wird übersprungen (vorher ersetzte er den guten Stand, der danach als beschädigt galt). Schlüssel ohne Eintrag: nur JSON-Prüfung.
const strListe = (x) => Array.isArray(x) && x.every((y) => typeof y === "string");
const SPEICHER_FORMEN = {
  "jarvis-aufgaben": Array.isArray,
  "jarvis-routinen": Array.isArray,
  "jarvis-notizen": (x) => istObjekt(x) && x.art === "jarvis-notizen" && Array.isArray(x.notizen),
  "jarvis-freigaben": (x) => istObjekt(x) && istObjekt(x.abweichungen),
  "jarvis-karten-zu": strListe, "jarvis-nav-favoriten": strListe, "jarvis-nav-zuletzt": strListe,
  "jarvis-automatik": (x) => istObjekt(x) && x.art === "jarvis-automatik" && Array.isArray(x.regeln) && Array.isArray(x.protokoll),
  "jarvis-hinweise": (x) => istObjekt(x) && x.art === "jarvis-hinweise" && Array.isArray(x.eintraege),
  "jarvis-briefing": (x) => istObjekt(x) && Array.isArray(x.ausgeblendet) && Array.isArray(x.hinweiseAus),
  "jarvis-risiko-schwellen": istObjekt,
  "jarvis-aktien-wl-meta": (x) => istObjekt(x) && x.art === "jarvis-aktien-wl-meta" && istObjekt(x.je), // ab 11-07k
  "jarvis-auftraege": (x) => istObjekt(x) && x.art === "jarvis-auftraege" && Array.isArray(x.liste) && Array.isArray(x.protokoll), // ab 11-09a
  "jarvis-dateien": (x) => istObjekt(x) && x.art === "jarvis-dateien" && Array.isArray(x.eintraege), // ab 11-09d
  "jarvis-projekte": (x) => istObjekt(x) && x.art === "jarvis-projekte" && Array.isArray(x.projekte) && Array.isArray(x.verlauf), // ab 11-09f
  "jarvis-arbeitsplatz": (x) => istObjekt(x) && x.art === "jarvis-arbeitsplatz" && Array.isArray(x.reihenfolge) && Array.isArray(x.aus), // ab 11-09g
  "jarvis-gedaechtnis": (x) => istObjekt(x) && x.art === "jarvis-gedaechtnis" && Array.isArray(x.geloescht), // ab 11-09j
  "jarvis-dialog": (x) => istObjekt(x) && x.art === "jarvis-dialog", // ab 11-09j
  // ab 11-09p: Grundformen der übrigen neuen Bereiche (vorher nur JSON-Prüfung beim Wiederherstellen)
  "jarvis-workflow-lauf": (x) => istObjekt(x) && x.art === "jarvis-workflow-lauf" && Array.isArray(x.status),
  "jarvis-aktien-historie": (x) => istObjekt(x) && x.art === "jarvis-aktien-historie" && Array.isArray(x.analysen) && Array.isArray(x.staende),
  "jarvis-start": (x) => istObjekt(x) && x.art === "jarvis-start" && ["cockpit", "analyse", "trading"].includes(x.ansicht),
  "jarvis-profil": (x) => istObjekt(x) && Array.isArray(x.eintraege),
  "jarvis-screener": (x) => istObjekt(x) && x.art === "jarvis-screener" && istObjekt(x.filter) && Array.isArray(x.verlauf),
};
// Liefert einen Grund oder "" (gültig). Einstellungen mit fester Werteliste (EINSTELLUNG_REGELN aus app/22-sprache.js) prüfen den Wert.
function speicherWertPruefen(schluessel, wert) {
  const regel = typeof EINSTELLUNG_REGELN !== "undefined" ? EINSTELLUNG_REGELN.find((r) => r.name === schluessel) : null;
  if (regel && !regel.erlaubt.includes(wert)) return "ungültiger Wert für „" + regel.titel + "“";
  const form = SPEICHER_FORMEN[schluessel];
  if (!form) return "";
  let d;
  try { d = JSON.parse(wert); } catch (e) { return "beschädigte Daten"; }
  return d !== null && form(d) ? "" : "Form passt nicht (" + schluessel + ")";
}
const speicherLesen = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

// Entfernt Schlüssel/Tokens und die eigenen Codes aus einem gespeicherten Wert (Ersatz ohne Anführungszeichen: JSON bleibt gültig)
// ab 11-03c: gleiche Muster wie geheimnisMuster (auch Großschrift und allgemeine sk-Schlüssel); Zuweisungen (api_key=…) nur bei
// Fehlertexten – bei gespeicherten JSON-Werten bleibt die Regel aus, damit das JSON gültig bleibt
function geheimnisseEntfernen(text, { fehlertext = false } = {}) {
  let s = String(text);
  // ab 11-04j: auch die JSON-maskierte Form (Code mit " oder \ steht in gespeicherten JSON-Werten als \" bzw. \\) – vorher blieb er dort stehen
  // ab 18c auch der auf dem Tablet gespeicherte Freigabecode
  for (const k of ["jarvis-zugangscode", "jarvis-helfer-code", "jarvis-freigabe-tablet"]) { const c = speicherLesen(k); if (c && c.length >= 4) { s = s.split(c).join("[entfernt]"); const m = JSON.stringify(c).slice(1, -1); if (m !== c) s = s.split(m).join("[entfernt]"); } }
  return geheimnisMuster(s, { zuweisungen: fehlertext });
}
const enthaeltGeheimnis = (text) => geheimnisseEntfernen(text) !== String(text);

function datenUmfang(bereich) {
  let bytes = 0;
  let eintraege = null;
  let gesetzt = 0;
  for (const k of bereich.schluessel) {
    const w = speicherLesen(k);
    if (w === null) continue;
    gesetzt++;
    bytes += (k.length + w.length) * 2;
    try {
      const d = JSON.parse(w);
      const n = Array.isArray(d) ? d.length : d && Array.isArray(d.eintraege) ? d.eintraege.length : d && Array.isArray(d.nachrichten) ? d.nachrichten.length
        : d && d.abweichungen ? Object.keys(d.abweichungen).length : null;
      if (n !== null) eintraege = (eintraege || 0) + n;
    } catch (e) { /* einfacher Wert */ }
  }
  return { bytes, eintraege, gesetzt };
}
function datenInventar() { return DATEN_BEREICHE.map((b) => ({ ...b, ...datenUmfang(b) })); }
const kb = (bytes) => (bytes / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " KB";

function datenAnzeigen() {
  const tabelle = document.getElementById("daten-tabelle");
  if (!tabelle) return;
  const inventar = datenInventar();
  tabelle.replaceChildren(...inventar.map((b) => {
    const tr = document.createElement("tr");
    tr.dataset.bereich = b.id;
    const umfang = !b.gesetzt ? "leer" : b.geheim ? "vorhanden – geheim, nie in Sicherungen"
      : (b.eintraege !== null ? b.eintraege + " Einträge · " : "") + kb(b.bytes);
    const zelle = Object.assign(document.createElement("td"), { className: b.gesetzt ? (b.geheim ? "warn" : "ok") : "aus", textContent: umfang + " " });
    if (b.gesetzt) {
      const knopf = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: "Löschen" });
      knopf.setAttribute("aria-label", "Löschen: " + b.name);
      knopf.addEventListener("click", () => datenLoeschen(b.id));
      zelle.append(knopf);
    }
    tr.append(Object.assign(document.createElement("td"), { textContent: b.name }), zelle);
    return tr;
  }));
  document.getElementById("daten-gesamt").textContent = kb(inventar.reduce((s, b) => s + b.bytes, 0));
}

function datenLoeschen(id) {
  const b = DATEN_BEREICHE.find((x) => x.id === id);
  if (!b || !confirm("„" + b.name + "“ von diesem Gerät löschen?" + (b.id === "freigabecode" ? "\nDanach muss der Freigabecode unter „Alpaca-Paper live“ neu gespeichert werden." : b.geheim ? "\nDanach müssen Zugangscode bzw. Kopplungscode neu eingetragen werden." : "")
    + "\nVorher ggf. „Sicherung exportieren“. Nicht rückgängig zu machen.")) return false;
  for (const k of b.schluessel) { try { localStorage.removeItem(k); SPEICHER_SCHADEN.delete(k); } catch (e) { /* nichts gespeichert */ } }
  if (id === "zugang") verbindung.code = "";
  if (id === "freigabecode" && typeof liveCodeStatus === "function") liveCodeStatus(); // ab 18d: Anzeige in „Alpaca-Paper live“ sofort aktualisieren
  // ab 11-06h: Bereiche mit Daten im Speicher der Seite sofort neu laden – vorher schrieb die nächste Änderung (z. B. eine neue
  // Aufgabe) die gelöschten Einträge aus dem Speicher der Seite wieder zurück
  try {
    if (id === "aufgaben" && window.aufgabenIntern) { window.aufgabenIntern.laden(); window.aufgabenIntern.anzeigen(); }
    if (id === "routinen" && typeof routinenLaden === "function") { routinenLaden(); routinenAnzeigen(); }
    if (id === "notizen" && typeof notizenLaden === "function") { notizenLaden(); notizenAnzeigen(); }
    if (id === "oberflaeche" && typeof oberflaecheNeuLaden === "function") oberflaecheNeuLaden(); // ab 11-07b
    if (id === "automatik" && typeof autoLesen === "function") { autoLesen(); autoAnzeigen(); } // ab 11-07f
    if (id === "auftraege" && typeof auftraegeLesen === "function") { auftraegeLesen(); auftraegeAnzeigen(); } // ab 11-09a
    if (id === "dateien" && typeof dateienAnzeigen === "function") { DATEIEN.inhalt.clear(); dateienAnzeigen(); } // ab 11-09d
    if (id === "projekte" && typeof projekteLesen === "function") { projekteLesen(); projekteAnzeigen(); } // ab 11-09f
    if (id === "arbeitsplatz" && typeof arbeitsplatzAnzeigen === "function") arbeitsplatzAnzeigen(); // ab 11-09g
    if (id === "gedaechtnis" && typeof gedAnzeigen === "function") { gedAnzeigen(); dialogAnzeigen(); } // ab 11-09j
    if (id === "hinweise" && typeof hinweiseLesen === "function") { hinweiseLesen(); hinweiseAnzeigen(); briefingEinstellungenAnzeigen(); } // ab 11-07g
  } catch (e) { /* Anzeige; Neuladen-Hinweis bleibt */ }
  datenAnzeigen();
  document.getElementById("daten-meldung").textContent = "„" + b.name + "“ gelöscht. Für eine vollständige Übernahme die Seite neu laden.";
  // ab 11-06c: die Simulation liegt maßgeblich in IndexedDB – dort als gelöscht markieren (rev + 1, Sicherungseintrag bleibt)
  if (id === "aktiensim") {
    SIM.arbeit = simErsetzen(null).then((s) => {
      if (s.fehler) document.getElementById("daten-meldung").textContent = "„" + b.name + "“ NICHT vollständig gelöscht: " + s.fehler + " – nach dem Neuladen gilt der bisherige Simulationsstand.";
    }).finally(() => { SIM.arbeit = null; });
  }
  document.getElementById("daten-neu-laden").hidden = false;
  return true;
}

// Wert für die Sicherung (ab 11-03d): Verlauf, Angeheftetes und Diagnose enthalten Freitext und Fehlermeldungen – dort auch
// Zuweisungen wie api_key=… entfernen, aber nur, wenn das gespeicherte JSON dabei gültig bleibt; sonst wie bisher.
function sicherungsWert(schluessel, wert) {
  const einfach = geheimnisseEntfernen(wert);
  if (!/^jarvis-(verlauf|verlauf-angeheftet|diagnose)$/.test(schluessel)) return einfach;
  const streng = geheimnisseEntfernen(wert, { fehlertext: true });
  try { JSON.parse(wert); JSON.parse(streng); return streng; } catch (e) { return einfach; }
}
// umfang: "alles" (ohne Geheimes) oder "einstellungen" (nur harmlose Einstellungen für ein anderes Gerät)
function datenSicherung(umfang = "alles") {
  const bereiche = {};
  for (const b of DATEN_BEREICHE) {
    if (b.geheim || (umfang === "einstellungen" && !b.einstellung)) continue;
    const werte = {};
    for (const k of b.schluessel) { const w = speicherLesen(k); if (w !== null) werte[k] = sicherungsWert(k, w); }
    if (Object.keys(werte).length) bereiche[b.id] = werte;
  }
  return { art: "jarvis-sicherung", version: 1, umfang, erstellt: new Date().toISOString(),
    stand: ((document.getElementById("stand-kennung") || {}).textContent || "").trim(), bereiche };
}

// Prüft eine Sicherungsdatei, ohne etwas zu ändern: { umfang, bereiche: [{ id, name, werte, aenderungen }], uebersprungen } oder { fehler }
function datenImportPruefen(text) {
  if (typeof text !== "string" || text.length > DATEN.maxDatei) return { fehler: "Datei fehlt oder ist zu groß." };
  let d;
  try { d = JSON.parse(text); } catch (e) { return { fehler: "Die Datei ist kein gültiges JSON." }; }
  if (!d || d.art !== "jarvis-sicherung" || d.version !== 1 || !d.bereiche || typeof d.bereiche !== "object") return { fehler: "Keine JARVIS-Sicherung (Version 1)." };
  const bereiche = [];
  const uebersprungen = [];
  for (const [id, werte] of Object.entries(d.bereiche)) {
    const b = DATEN_BEREICHE.find((x) => x.id === id);
    if (!b) { uebersprungen.push(String(id).slice(0, 30) + ": unbekannter Bereich"); continue; }
    if (b.geheim) { uebersprungen.push(b.name + ": Geheimes wird nie übernommen"); continue; }
    if (!werte || typeof werte !== "object") { uebersprungen.push(b.name + ": ungültig"); continue; }
    const gueltig = {};
    let grund = "";
    for (const [k, w] of Object.entries(werte)) {
      if (!b.schluessel.includes(k)) continue; // fremde Schlüssel (z. B. ein eingeschmuggelter Code) werden ignoriert
      if (typeof w !== "string" || w.length > DATEN.maxWert) { grund = "ungültiger Wert"; break; }
      if (b.json || /^[\[{]/.test(w)) { try { JSON.parse(w); } catch (e) { grund = "beschädigte Daten"; break; } }
      const formFehler = speicherWertPruefen(k, w); // ab 11-07h
      if (formFehler) { grund = formFehler; break; }
      if (enthaeltGeheimnis(w)) { grund = "enthält einen Code oder Schlüssel"; break; }
      gueltig[k] = w;
    }
    if (grund) { uebersprungen.push(b.name + ": " + grund); continue; }
    if (!Object.keys(gueltig).length) { uebersprungen.push(b.name + ": keine gültigen Werte"); continue; }
    const kurz = (v) => (v === null ? "leer" : v.length > 40 ? "Daten (" + kb(v.length * 2) + ")" : v);
    const aenderungen = Object.entries(gueltig).map(([k, w]) => {
      const alt = speicherLesen(k);
      return k + ": " + (alt === w ? "unverändert" : kurz(alt) + " → " + kurz(w));
    });
    // ab 11-04g: Übernahme ersetzt den Bereich vollständig – hier gesetzte Schlüssel, die in der Datei fehlen, werden entfernt
    for (const k of b.schluessel) { const alt = speicherLesen(k); if (!(k in gueltig) && alt !== null) aenderungen.push(k + ": " + kurz(alt) + " → wird entfernt"); }
    bereiche.push({ id, name: b.name, werte: gueltig, aenderungen });
  }
  return { umfang: d.umfang === "einstellungen" ? "einstellungen" : "alles", erstellt: d.erstellt, bereiche, uebersprungen };
}

// Übernimmt die geprüften Bereiche (ersetzt deren Werte vollständig); danach Seite neu laden
// ab 11-03h: alles oder nichts – scheitert ein Schreibvorgang (Speicher voll/gesperrt), werden alle schon geänderten Werte
// auf den vorherigen Stand zurückgesetzt (vorher blieb ein Teilstand aus alten und neuen Werten stehen)
function datenImportieren(text) {
  const p = datenImportPruefen(text);
  if (p.fehler) return p;
  const alt = [];
  try {
    for (const b of p.bereiche) {
      const bereich = DATEN_BEREICHE.find((x) => x.id === b.id);
      for (const k of bereich.schluessel) {
        const vorher = localStorage.getItem(k);
        if (k in b.werte) localStorage.setItem(k, b.werte[k]); else localStorage.removeItem(k);
        alt.push([k, vorher]); // nur erfolgreich geschriebene Schlüssel zurücksetzen (ein gescheitertes setItem ändert nichts)
      }
    }
  } catch (e) {
    let zurueck = true;
    for (const [k, v] of alt.reverse()) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { zurueck = false; } }
    return { fehler: zurueck ? "Browserspeicher gesperrt oder voll – nichts geändert." : "Browserspeicher gesperrt oder voll – vorheriger Stand nicht vollständig wiederherstellbar." };
  }
  for (const [k] of alt) SPEICHER_SCHADEN.delete(k); // ab 11-06b: der Import hat einen beschädigten Stand ausdrücklich ersetzt
  // ab 11-06h: übernommene Aufgaben, Routinen und Notizen sofort in die Seite laden (sonst überschrieb die nächste Änderung den Import)
  try {
    const ids = p.bereiche.map((b) => b.id);
    if (ids.includes("aufgaben") && window.aufgabenIntern) { window.aufgabenIntern.laden(); window.aufgabenIntern.anzeigen(); }
    if (ids.includes("routinen") && typeof routinenLaden === "function") { routinenLaden(); routinenAnzeigen(); }
    if (ids.includes("notizen") && typeof notizenLaden === "function") { notizenLaden(); notizenAnzeigen(); }
    if (ids.includes("oberflaeche") && typeof oberflaecheNeuLaden === "function") oberflaecheNeuLaden(); // ab 11-07b
    if (ids.includes("automatik") && typeof autoLesen === "function") { autoLesen(); autoAnzeigen(); } // ab 11-07f
    if (ids.includes("auftraege") && typeof auftraegeLesen === "function") { auftraegeLesen(); auftraegeAnzeigen(); } // ab 11-09a
    if (ids.includes("dateien") && typeof dateienAnzeigen === "function") { DATEIEN.inhalt.clear(); dateienAnzeigen(); } // ab 11-09d
    if (ids.includes("projekte") && typeof projekteLesen === "function") { projekteLesen(); projekteAnzeigen(); } // ab 11-09f
    if (ids.includes("arbeitsplatz") && typeof arbeitsplatzAnzeigen === "function") arbeitsplatzAnzeigen(); // ab 11-09g
    if (ids.includes("gedaechtnis") && typeof gedAnzeigen === "function") { gedAnzeigen(); dialogAnzeigen(); } // ab 11-09j
    if (ids.includes("hinweise") && typeof hinweiseLesen === "function") { hinweiseLesen(); hinweiseAnzeigen(); briefingEinstellungenAnzeigen(); } // ab 11-07g
  } catch (e) { /* Anzeige; Neuladen-Hinweis bleibt */ }
  datenAnzeigen();
  // ab 11-06c: maßgeblich für die Simulation ist IndexedDB – der übernommene Stand wird dort ausdrücklich ersetzt (rev + 1);
  // sim: Promise mit { ok } oder { fehler } (scheitert es, gilt nach dem Neuladen wieder der vorherige Simulationsstand)
  const sim = p.bereiche.some((b) => b.id === "aktiensim") ? (SIM.arbeit = simErsetzen(speicherLesen(SIM.schluessel)).finally(() => { SIM.arbeit = null; })) : null;
  return { uebernommen: p.bereiche.map((b) => b.name), uebersprungen: p.uebersprungen, sim };
}

function datenDateiSpeichern(daten, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(daten, null, 2)], { type: "application/json" }));
  link.download = name + "-" + new Date().toISOString().slice(0, 10) + ".json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
// ab 11-04j: Bereiche, deren gespeicherter JSON-Wert erst durch die Schwärzung unlesbar wird (z. B. ein kurzer Code, der in einer Zahl
// vorkommt) – eine solche Sicherung ließe sich nicht vollständig wiederherstellen. Die Schwärzung selbst bleibt unverändert.
function sicherungUnlesbar(s) {
  const json = (t) => { try { JSON.parse(t); return true; } catch (e) { return false; } };
  return DATEN_BEREICHE.filter((b) => s.bereiche[b.id] && Object.entries(s.bereiche[b.id]).some(([k, w]) => { const roh = speicherLesen(k); return roh !== null && (b.json || /^[\[{]/.test(roh)) && json(roh) && !json(w); })).map((b) => b.name);
}
const mbText = (bytes) => (bytes / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " MB";
// Kein Download und keine Erfolgsmeldung, wenn die Sicherung nicht wiederherstellbar wäre
function datenExportieren(umfang, name, erfolg) {
  const s = datenSicherung(umfang);
  const unlesbar = sicherungUnlesbar(s);
  if (unlesbar.length) {
    document.getElementById("daten-meldung").textContent = "Sicherung nicht erstellt: Beim Entfernen des gespeicherten Zugangs- oder Kopplungscodes würden diese Daten unlesbar – "
      + unlesbar.map((n) => "„" + n + "“").join(", ") + " (der Code kommt dort als gewöhnliche Zeichenfolge vor). Nichts wurde heruntergeladen.";
    return false;
  }
  // ab 11-04l: dieselben Grenzen wie beim Wiederherstellen (Datei, je Wert) – vorher Erfolg und Download einer nicht wiederherstellbaren Datei
  const zuGross = DATEN_BEREICHE.filter((b) => s.bereiche[b.id] && Object.values(s.bereiche[b.id]).some((w) => w.length > DATEN.maxWert)).map((b) => b.name);
  const bytes = new Blob([JSON.stringify(s, null, 2)]).size;
  if (zuGross.length || bytes > DATEN.maxDatei) {
    document.getElementById("daten-meldung").textContent = "Sicherung nicht erstellt: " + (zuGross.length
      ? "Zu große Daten in " + zuGross.map((n) => "„" + n + "“").join(", ") + " (je Wert höchstens " + (DATEN.maxWert / 1e6).toLocaleString("de-DE") + " Mio. Zeichen)"
      : "Die Datei wäre " + mbText(bytes) + " groß, wiederherstellen lassen sich höchstens " + mbText(DATEN.maxDatei))
      + " – so ließe sie sich nicht wiederherstellen. Nichts wurde heruntergeladen.";
    return false;
  }
  datenDateiSpeichern(s, name);
  document.getElementById("daten-meldung").textContent = erfolg(Object.keys(s.bereiche).length);
  return true;
}
// ab 11-06c: vor der Sicherung die Kopie der Simulation aus IndexedDB auffrischen (ein anderer Tab kann inzwischen gebucht haben)
document.getElementById("daten-export").addEventListener("click", () => simSpiegelAktualisieren().finally(() => datenExportieren("alles", "jarvis-sicherung", (n) => "Sicherung mit " + n + " Bereichen erstellt (ohne Zugangs- und Kopplungscode).")));
document.getElementById("daten-export-einstellungen").addEventListener("click", () => datenExportieren("einstellungen", "jarvis-einstellungen", (n) => "Einstellungen exportiert (" + n + " Bereiche, ohne Code). Auf dem anderen Gerät „Wiederherstellen …“."));
document.getElementById("daten-import").addEventListener("change", async (e) => {
  const datei = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!datei) return;
  const meldung = document.getElementById("daten-meldung");
  // ab 11-04l: übergroße Datei klar benennen (vorher wurde sie als leerer Text geprüft → „kein gültiges JSON“)
  if (datei.size > DATEN.maxDatei) { meldung.textContent = "Wiederherstellen abgelehnt: Die Datei ist zu groß (" + mbText(datei.size) + ", höchstens " + mbText(DATEN.maxDatei) + ")."; return; }
  const text = await datei.text();
  const p = datenImportPruefen(text);
  if (p.fehler) { meldung.textContent = "Wiederherstellen abgelehnt: " + p.fehler; return; }
  if (!p.bereiche.length) { meldung.textContent = "Nichts zu übernehmen. " + p.uebersprungen.join(" · "); return; }
  const vorschau = p.bereiche.map((b) => "• " + b.name + "\n   " + b.aenderungen.join("\n   ")).join("\n")
    + (p.uebersprungen.length ? "\n\nÜbersprungen:\n" + p.uebersprungen.join("\n") : "");
  if (!confirm((p.umfang === "einstellungen" ? "Einstellungen übernehmen?" : "Sicherung wiederherstellen?") + " Die genannten Bereiche werden ersetzt.\n\n" + vorschau)) { meldung.textContent = "Abgebrochen – nichts geändert."; return; }
  const r = datenImportieren(text);
  const sim = r.sim ? await r.sim : null;
  meldung.textContent = r.fehler ? "Fehler: " + r.fehler : "Übernommen: " + r.uebernommen.join(", ") + (r.uebersprungen.length ? " · übersprungen: " + r.uebersprungen.join(" · ") : "") + ". Bitte die Seite neu laden."
    + (sim && sim.fehler ? " ⚠ Die US-Aktien-Simulation wurde NICHT übernommen (" + sim.fehler + ") – nach dem Neuladen gilt der bisherige Simulationsstand." : "");
  document.getElementById("daten-neu-laden").hidden = Boolean(r.fehler);
});
document.getElementById("daten-neu-laden").addEventListener("click", () => location.reload());
document.getElementById("daten-karte").addEventListener("toggle", (e) => { if (e.target.open) datenAnzeigen(); });
datenAnzeigen();
// ---------- Smart Home: Home Assistant über den Worker, Demo-Attrappe, lokal trennen (Stand …30o) ----------
// art: "worker" (echt, über /haus/*), "attrappe" (Demo im Speicher, keine Verbindung). Der Browser kennt keinen Token.
const HAUS_DEMO = [{ id: "light.wohnzimmer", name: "Wohnzimmer (Demo)", art: "licht", zustand: "aus" }, { id: "switch.kaffee", name: "Kaffeemaschine (Demo)", art: "schalter", zustand: "an" }];
let hausModus = ["aus", "demo"].includes(einstellungLesen("jarvis-haus")) ? einstellungLesen("jarvis-haus") : "";
let hausStand = { art: null, status: null, geraete: [], meldung: "", geprueft: null };
let hausLaeuft = false;
// ab 11-04c: false, wenn „Trennen“/„Wieder verbinden“ nicht gespeichert werden konnte (Browserspeicher gesperrt/voll) –
// dann heißt es „nur für diese Sitzung getrennt“ statt „auf diesem Gerät getrennt“ (vorher nach dem Neuladen wieder verbunden)
let hausSpeicherOk = true;

function hausZeile() {
  if (hausModus === "aus") return ["aus", hausSpeicherOk ? "auf diesem Gerät getrennt" : "nur für diese Sitzung getrennt – Browserspeicher gesperrt oder voll; nach dem Neuladen wird Home Assistant wieder angefragt"];
  if (hausStand.art === "attrappe") return ["warn", "Demo (Attrappe) – keine echte Verbindung"];
  const s = hausStand.status;
  if (s && s.eingerichtet) return hausStand.meldung ? ["fehler", "eingerichtet, aber: " + hausStand.meldung] : ["ok", "verbunden über den Worker · " + hausStand.geraete.length + " Geräte (" + s.adresse + ")"];
  if (s) return ["aus", "nicht eingerichtet – im Worker fehlt: " + s.fehlt.join(", ")];
  return ["aus", "nicht eingerichtet bzw. nicht geprüft – Karte „Smart Home“ → „Prüfen“"];
}

async function hausPruefen() {
  if (hausLaeuft) return hausStand;
  hausLaeuft = true;
  const knopf = document.getElementById("haus-pruefen");
  knopf.disabled = true;
  hausStand = { art: null, status: null, geraete: [], meldung: "", geprueft: new Date().toISOString() };
  try {
    if (hausModus === "aus") { hausStand.meldung = (hausSpeicherOk ? "Auf diesem Gerät" : "Nur für diese Sitzung") + " getrennt – es wird nichts angefragt."; return hausStand; }
    if (hausModus === "demo") { hausStand.art = "attrappe"; hausStand.geraete = HAUS_DEMO.map((g) => ({ ...g })); return hausStand; }
    if (!verbunden()) { hausStand.meldung = "Worker-Verbindung fehlt (Cockpit → Verbindung)."; return hausStand; }
    hausStand.art = "worker";
    try { hausStand.status = await workerAnfrage("/haus/status", { method: "GET" }); }
    catch (e) { hausStand.meldung = e.message === "Unbekannter Endpunkt." ? "Der Worker kennt Home Assistant noch nicht (Worker-Patch vom 30.10. nicht übernommen)." : e.message; return hausStand; }
    if (!hausStand.status.eingerichtet) return hausStand;
    try { hausStand.geraete = (await workerAnfrage("/haus/geraete", { method: "GET" })).geraete || []; }
    catch (e) { hausStand.meldung = e.message; }
    return hausStand;
  } finally {
    hausLaeuft = false;
    knopf.disabled = false;
    hausAnzeigen();
  }
}

// Schaltet ein freigegebenes Gerät; der Klick bzw. das „Ja“ ist die Bestätigung (bestaetigt: true an den Worker)
async function hausSchalten(id, aktion) {
  const g = hausStand.geraete.find((x) => x.id === id);
  if (!g || !["einschalten", "ausschalten"].includes(aktion) || hausModus === "aus") throw new Error("Gerät oder Aktion nicht verfügbar.");
  if (hausStand.art === "attrappe") { g.zustand = aktion === "einschalten" ? "an" : "aus"; hausAnzeigen(); return { id, zustand: g.zustand, demo: true }; }
  const r = await workerAnfrage("/haus/aktion", { method: "POST", body: JSON.stringify({ id, aktion, bestaetigt: true }) });
  g.zustand = r.zustand || "unbekannt";
  hausAnzeigen();
  return r;
}

function hausTrennen() {
  if (hausModus === "aus") { hausModus = ""; hausSpeicherOk = einstellungSchreiben("jarvis-haus", ""); hausStand = { art: null, status: null, geraete: [], meldung: "", geprueft: null }; hausAnzeigen(); return "verbunden"; }
  if (!confirm("Smart Home auf diesem Gerät trennen?\nJARVIS fragt Home Assistant dann nicht mehr an. Vollständig trennen: Token in Home Assistant widerrufen und das Secret HA_TOKEN im Worker löschen.")) return null;
  hausModus = "aus";
  hausSpeicherOk = einstellungSchreiben("jarvis-haus", "aus");
  hausStand = { art: null, status: null, geraete: [], meldung: "", geprueft: null };
  hausAnzeigen();
  return "getrennt";
}
function hausDemo() {
  hausModus = hausModus === "demo" ? "" : "demo";
  einstellungSchreiben("jarvis-haus", hausModus);
  return hausPruefen();
}

function hausAnzeigen() {
  const [zustand, text] = hausZeile();
  document.getElementById("haus-art").textContent = hausModus === "aus" ? "getrennt" : hausStand.art === "attrappe" ? "Demo" : zustand === "ok" ? "verbunden" : "nicht eingerichtet";
  document.getElementById("haus-status").textContent = "Home Assistant: " + text + (hausStand.meldung && zustand !== "fehler" ? " – " + hausStand.meldung : "")
    + (hausStand.geprueft ? " (geprüft " + new Date(hausStand.geprueft).toLocaleTimeString("de-DE") + ")" : "");
  document.getElementById("haus-trennen").textContent = hausModus === "aus" ? "Wieder verbinden" : "Trennen (dieses Gerät)";
  document.getElementById("haus-demo").textContent = hausModus === "demo" ? "Demo beenden" : "Demo (Attrappe)";
  document.getElementById("haus-liste").replaceChildren(...hausStand.geraete.map((g) => {
    const li = document.createElement("li");
    li.dataset.id = g.id;
    li.append(Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: g.name + " (" + (g.art === "licht" ? "Licht" : "Schalter") + ")" }),
      Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: g.zustand + (g.fehler ? " – " + g.fehler : "") }));
    for (const aktion of ["einschalten", "ausschalten"]) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: aktion === "einschalten" ? "Ein" : "Aus" });
      b.setAttribute("aria-label", (aktion === "einschalten" ? "Einschalten: " : "Ausschalten: ") + g.name);
      b.addEventListener("click", async () => { b.disabled = true; try { await hausSchalten(g.id, aktion); } catch (e) { document.getElementById("haus-status").textContent = "Schalten fehlgeschlagen: " + e.message; } finally { b.disabled = false; } });
      li.append(b);
    }
    return li;
  }));
  if (typeof integrationenAnzeigen === "function") integrationenAnzeigen();
}

// Sprachbefehl: nur bekannte Geräte (nach „Prüfen“) oder mit Licht/Lampe/Schalter/Steckdose im Satz – immer mit Rückfrage
const HAUS_BEFEHL = /^(schalte|mach|mache)( das| den| die| bitte)? (.+?) (ein|an|aus)$/;
function hausBefehlZiel(text) {
  const m = befehlNormalisieren(text).match(HAUS_BEFEHL);
  if (!m) return null;
  const wunsch = m[3].replace(/^(das|den|die) /, "").trim();
  const normal = (s) => suchNormal(s).replace(/\((demo)\)/, "").trim();
  const treffer = hausStand.geraete.filter((g) => normal(g.name).includes(normal(wunsch)) || normal(wunsch).includes(normal(g.name)) || normal(wunsch).includes(g.id.split(".")[1]));
  return { wunsch, aktion: m[4] === "aus" ? "ausschalten" : "einschalten", treffer, geraetewort: /\b(licht|lampe|schalter|steckdose)\b/.test(wunsch) };
}
skillRegistrieren({
  name: "haus-schalten",
  risiko: "bestaetigen",
  beschreibung: "Licht oder Schalter über Home Assistant schalten (nur freigegebene Geräte)",
  beispiele: ["Schalte das Wohnzimmer Licht ein"],
  passt: (text) => { const z = hausBefehlZiel(text); return Boolean(z && (z.treffer.length || z.geraetewort)); },
  planen: async (text) => {
    const z = hausBefehlZiel(text);
    if (hausModus === "aus") return { fehler: "Smart Home ist auf diesem Gerät getrennt." };
    if (!hausStand.geraete.length) return { fehler: "Keine Geräte geladen – bitte unter „Smart Home“ zuerst „Prüfen & Geräte laden“." };
    if (!z.treffer.length) return { fehler: "Kein freigegebenes Gerät „" + z.wunsch + "“. Verfügbar: " + hausStand.geraete.map((g) => g.name).join(", ") + "." };
    if (z.treffer.length > 1) return { fehler: "Mehrere Geräte passen (" + z.treffer.map((g) => g.name).join(", ") + ") – bitte genauer sagen." };
    const g = z.treffer[0];
    return {
      beschreibung: "„" + g.name + "“ wird " + (z.aktion === "einschalten" ? "eingeschaltet" : "ausgeschaltet") + (hausStand.art === "attrappe" ? " (Demo – keine echte Verbindung)." : " – über Home Assistant."),
      ausfuehren: async () => { const r = await hausSchalten(g.id, z.aktion); return "„" + g.name + "“ ist jetzt " + r.zustand + (r.demo ? " (Demo)." : "."); },
    };
  },
});
// PC-Helfer auf Tablet/Smartphone: ehrlicher Hinweis statt eines Knopfes, der nie funktionieren kann
function helferGrenzeAnzeigen() {
  const mobil = Boolean((navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || ""));
  document.getElementById("helfer-grenze").hidden = !mobil;
  return mobil;
}
helferGrenzeAnzeigen();
window.helferGrenzeAnzeigen = helferGrenzeAnzeigen;
document.getElementById("haus-pruefen").addEventListener("click", hausPruefen);
document.getElementById("haus-demo").addEventListener("click", hausDemo);
document.getElementById("haus-trennen").addEventListener("click", hausTrennen);
hausAnzeigen();
window.hausIntern = { pruefen: hausPruefen, schalten: hausSchalten, trennen: hausTrennen, demo: hausDemo, stand: () => hausStand, modus: () => hausModus, zeile: hausZeile };

// ---------- Watchlist & Kursalarme (Stand …30k) ----------
// Beobachtete Märkte und einmalige Alarme (über/unter). Geprüft wird nur mit frischen Kursen; ein Alarm handelt nie.
const WATCH = { schluessel: "jarvis-watchlist", veraltetMs: 120000, maxMaerkte: 20, maxAlarme: 50, standardSymbole: ["BTCUSDT", "ETHUSDT"] };
let watch = { werte: [], alarme: [] };
let watchKurs = { kurse: {}, zeit: 0, fehler: "" };
const watchId = () => "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const preisText = (p) => Number(p).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " USDT";

function watchLaden() {
  let roh = null;
  try { roh = speicherJsonLesen(WATCH.schluessel, istObjekt); } catch (e) { roh = null; }
  watch = { werte: [], alarme: [] };
  for (const v of (roh && Array.isArray(roh.werte) ? roh.werte : []).slice(0, WATCH.maxMaerkte)) {
    if (v && /^[A-Z0-9]{5,15}$/.test(v.symbol) && !watch.werte.some((x) => x.symbol === v.symbol)) watch.werte.push({ symbol: v.symbol, notiz: String(v.notiz || "").slice(0, 80) });
  }
  for (const a of (roh && Array.isArray(roh.alarme) ? roh.alarme : []).slice(0, WATCH.maxAlarme)) {
    if (a && /^[A-Z0-9]{5,15}$/.test(a.symbol) && ["ueber", "unter"].includes(a.richtung) && Number(a.preis) > 0) {
      watch.alarme.push({ id: typeof a.id === "string" ? a.id.slice(0, 24) : watchId(), symbol: a.symbol, richtung: a.richtung, preis: Number(a.preis),
        pausiert: a.pausiert === true, ausgeloest: typeof a.ausgeloest === "string" && !isNaN(Date.parse(a.ausgeloest)) ? a.ausgeloest : null,
        ausloesekurs: Number(a.ausloesekurs) || null, erstellt: typeof a.erstellt === "string" ? a.erstellt : new Date().toISOString() });
    }
  }
  watchAnzeigen();
}
function watchSpeichern() { if (speicherBeschaedigt(WATCH.schluessel)) return; try { localStorage.setItem(WATCH.schluessel, JSON.stringify({ version: 1, ...watch })); } catch (e) { /* nur diese Sitzung */ } }
function watchSymbole() { return [...new Set([...WATCH.standardSymbole, ...Object.keys(watchKurs.kurse)])]; }
function watchFrisch() { return Boolean(watchKurs.zeit) && !watchKurs.fehler && Date.now() - watchKurs.zeit <= WATCH.veraltetMs; }

function watchHinzufuegen(symbol, notiz = "") {
  if (!watchSymbole().includes(symbol)) return { fehler: "Unbekannter Markt." };
  if (watch.werte.some((v) => v.symbol === symbol)) return { fehler: symbol + " wird schon beobachtet." };
  if (watch.werte.length >= WATCH.maxMaerkte) return { fehler: "Höchstens " + WATCH.maxMaerkte + " Märkte." };
  watch.werte.push({ symbol, notiz: String(notiz).trim().slice(0, 80) });
  watchSpeichern(); watchAnzeigen();
  return { ok: true };
}
function watchNotiz(symbol, notiz) { const v = watch.werte.find((x) => x.symbol === symbol); if (!v) return false; v.notiz = String(notiz).trim().slice(0, 80); watchSpeichern(); watchAnzeigen(); return true; }
function watchEntfernen(symbol) {
  const alarme = watch.alarme.filter((a) => a.symbol === symbol).length;
  if (!watch.werte.some((v) => v.symbol === symbol) || !confirm(symbol + " nicht mehr beobachten?" + (alarme ? "\nAuch " + alarme + " Alarm(e) dazu werden gelöscht." : ""))) return false;
  watch.werte = watch.werte.filter((v) => v.symbol !== symbol);
  watch.alarme = watch.alarme.filter((a) => a.symbol !== symbol);
  watchSpeichern(); watchAnzeigen();
  return true;
}

function alarmAnlegen(symbol, richtung, preis) {
  const p = Number(String(preis).replace(",", "."));
  if (!watchSymbole().includes(symbol)) return { fehler: "Unbekannter Markt." };
  if (!["ueber", "unter"].includes(richtung)) return { fehler: "Richtung fehlt." };
  if (!(p > 0) || p > 1e9) return { fehler: "Bitte einen gültigen Preis über 0 eingeben." };
  if (watch.alarme.length >= WATCH.maxAlarme) return { fehler: "Höchstens " + WATCH.maxAlarme + " Alarme." };
  const alarm = { id: watchId(), symbol, richtung, preis: p, pausiert: false, ausgeloest: null, ausloesekurs: null, erstellt: new Date().toISOString() };
  watch.alarme.push(alarm);
  if (!watch.werte.some((v) => v.symbol === symbol)) watch.werte.push({ symbol, notiz: "" });
  watchSpeichern(); watchAnzeigen();
  const aktuell = watchKurs.kurse[symbol];
  const schonErfuellt = aktuell && watchFrisch() && (richtung === "ueber" ? aktuell >= p : aktuell <= p);
  return { alarm, hinweis: schonErfuellt ? "Hinweis: Der aktuelle Kurs (" + preisText(aktuell) + ") erfüllt die Bedingung schon – der Alarm meldet sich beim nächsten Kurs." : "" };
}
function alarmPausieren(id, an) { const a = watch.alarme.find((x) => x.id === id); if (!a) return false; a.pausiert = Boolean(an); watchSpeichern(); watchAnzeigen(); return true; }
function alarmScharf(id) { const a = watch.alarme.find((x) => x.id === id); if (!a) return false; a.ausgeloest = null; a.ausloesekurs = null; watchSpeichern(); watchAnzeigen(); return true; }
function alarmLoeschen(id) { const vorher = watch.alarme.length; watch.alarme = watch.alarme.filter((x) => x.id !== id); watchSpeichern(); watchAnzeigen(); return watch.alarme.length < vorher; }

// Neue Kurse (oder Fehler) vom Worker. Prüft Alarme nur bei frischen Kursen; jeder Alarm meldet sich genau einmal.
function watchlistKurse(kurse, zeit, fehler) {
  if (kurse) {
    watchKurs = { kurse: Object.fromEntries(kurse.filter((k) => k && Number(k.preis) > 0).map((k) => [k.symbol, Number(k.preis)])), zeit: zeit || Date.now(), fehler: "" };
  } else {
    watchKurs.fehler = fehler || "Kurse nicht abrufbar";
  }
  const ausgeloest = [];
  if (watchFrisch()) {
    for (const a of watch.alarme) {
      const kurs = watchKurs.kurse[a.symbol];
      if (a.pausiert || a.ausgeloest || !(kurs > 0)) continue;
      if (a.richtung === "ueber" ? kurs >= a.preis : kurs <= a.preis) {
        a.ausgeloest = new Date().toISOString();
        a.ausloesekurs = kurs;
        ausgeloest.push(a);
      }
    }
  }
  if (ausgeloest.length) {
    watchSpeichern();
    for (const a of ausgeloest) alarmMelden(a);
  }
  watchAnzeigen();
  return ausgeloest;
}

function alarmMelden(a) {
  const text = "Kursalarm: " + a.symbol + " ist auf " + preisText(a.ausloesekurs)
    + (a.richtung === "ueber" ? " gestiegen (Schwelle ≥ " : " gefallen (Schwelle ≤ ") + preisText(a.preis) + "). Testnet-Kurs – es wurde nichts gehandelt.";
  lokalAntworten(text); // liest selbst vor (Google /sprechen bzw. Browserstimme)
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("JARVIS – Kursalarm " + a.symbol, { body: text, tag: "jarvis-alarm-" + a.id });
  } catch (e) { /* mobil ohne Service Worker nicht möglich – Meldung im Chat genügt */ }
}

function watchAnzeigen() {
  const liste = document.getElementById("watch-liste");
  if (!liste) return;
  const symbole = watchSymbole();
  for (const id of ["watch-symbol", "alarm-symbol"]) {
    const wahl = document.getElementById(id);
    const alt = wahl.value;
    wahl.replaceChildren(...symbole.map((s) => new Option(s, s)));
    if (symbole.includes(alt)) wahl.value = alt;
  }
  const frisch = watchFrisch();
  const alter = watchKurs.zeit ? Math.round((Date.now() - watchKurs.zeit) / 1000) : null;
  document.getElementById("watch-status").textContent = (speicherBeschaedigt(WATCH.schluessel) ? "Kursliste: " + SPEICHER_SCHADEN_TEXT + " " : "") + (!watchKurs.zeit
    ? (watchKurs.fehler ? "Kurse nicht abrufbar (" + watchKurs.fehler + ") – Alarme werden nicht geprüft." : "Noch keine Kurse – Alarme werden geprüft, sobald Kurse eintreffen (Verbindung nötig).")
    : watchKurs.fehler ? "Letzte Abfrage fehlgeschlagen (" + watchKurs.fehler + ") – Alarme werden nicht geprüft. Letzte Kurse von " + new Date(watchKurs.zeit).toLocaleTimeString("de-DE") + "."
      : frisch ? "Kurse von " + new Date(watchKurs.zeit).toLocaleTimeString("de-DE") + " (Testnet) – Alarme aktiv."
        : "Kurse veraltet (Stand " + new Date(watchKurs.zeit).toLocaleTimeString("de-DE") + ", vor " + alter + " s) – Alarme werden nicht geprüft.");
  const knopf = (beschriftung, label, aktion) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: beschriftung });
    b.setAttribute("aria-label", beschriftung + ": " + label);
    b.addEventListener("click", aktion);
    return b;
  };
  liste.replaceChildren(...(watch.werte.length ? watch.werte.map((v) => {
    const li = document.createElement("li");
    li.dataset.symbol = v.symbol;
    const kurs = watchKurs.kurse[v.symbol];
    li.append(Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: v.symbol + (v.notiz ? " – " + v.notiz : "") }),
      Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: kurs ? preisText(kurs) + (frisch ? "" : " (veraltet)") : "kein Kurs" }),
      knopf("Notiz", v.symbol, () => { const n = prompt("Notiz zu " + v.symbol + ":", v.notiz); if (n !== null) watchNotiz(v.symbol, n); }),
      knopf("Entfernen", v.symbol, () => watchEntfernen(v.symbol)));
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "Noch nichts auf der Watchlist." })]));
  document.getElementById("alarm-liste").replaceChildren(...watch.alarme.map((a) => {
    const li = document.createElement("li");
    li.dataset.id = a.id;
    li.className = a.ausgeloest ? "erledigt" : "";
    const zustand = a.ausgeloest ? "ausgelöst " + new Date(a.ausgeloest).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + " bei " + preisText(a.ausloesekurs)
      : a.pausiert ? "pausiert" : "aktiv";
    li.append(Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: a.symbol + (a.richtung === "ueber" ? " ≥ " : " ≤ ") + preisText(a.preis) }),
      Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: zustand }));
    if (a.ausgeloest) li.append(knopf("Wieder scharf", a.symbol, () => alarmScharf(a.id)));
    else li.append(knopf(a.pausiert ? "Fortsetzen" : "Pausieren", a.symbol, () => alarmPausieren(a.id, !a.pausiert)));
    li.append(knopf("Löschen", a.symbol + " " + preisText(a.preis), () => alarmLoeschen(a.id)));
    return li;
  }));
}

document.getElementById("watch-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const r = watchHinzufuegen(document.getElementById("watch-symbol").value, document.getElementById("watch-notiz").value);
  document.getElementById("alarm-meldung").textContent = r.fehler || "";
  if (r.ok) document.getElementById("watch-notiz").value = "";
});
document.getElementById("alarm-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const r = alarmAnlegen(document.getElementById("alarm-symbol").value, document.getElementById("alarm-richtung").value, document.getElementById("alarm-preis").value);
  document.getElementById("alarm-meldung").textContent = r.fehler || ("Alarm angelegt: " + r.alarm.symbol + (r.alarm.richtung === "ueber" ? " ≥ " : " ≤ ") + preisText(r.alarm.preis) + ". " + r.hinweis).trim();
  if (!r.fehler) document.getElementById("alarm-preis").value = "";
});
setInterval(() => watchAnzeigen(), 15000); // „veraltet“ auch ohne neue Abfrage anzeigen
watchLaden();
window.watchlistKurse = watchlistKurse;
window.watchIntern = { laden: watchLaden, liste: () => watch, hinzufuegen: watchHinzufuegen, notiz: watchNotiz, entfernen: watchEntfernen, alarm: alarmAnlegen,
  pausieren: alarmPausieren, scharf: alarmScharf, loeschen: alarmLoeschen, kurse: watchlistKurse, frisch: watchFrisch, WATCH };

window.datenIntern = { inventar: datenInventar, sicherung: datenSicherung, importPruefen: datenImportPruefen, importieren: datenImportieren, loeschen: datenLoeschen,
  anzeigen: datenAnzeigen, BEREICHE: DATEN_BEREICHE };
window.uebersichtIntern = { nutzung: kiNutzungLesen, nutzungFiltern: kiNutzungFiltern, nutzungSumme: kiNutzungSumme, nutzungLoeschen: kiNutzungLoeschen,
  pruefen: integrationenPruefen, zeilen: integrationenZeilen, faehigkeiten: faehigkeitenAnzeigen, freigabeSetzen, freigaben: () => freigaben,
  freigabenLaden, alleStandard: freigabenAlleStandard, skillRisiko };

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("uebersichten-freigaben");
