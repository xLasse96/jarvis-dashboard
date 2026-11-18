// JARVIS Dashboard – Modul „trading-skills“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Trading (Binance-Spot-Testnet, Spielgeld) ----------
// Alle Binance-Anfragen laufen über den Worker; der Browser kennt keine Binance-Schlüssel.
let tradingZustand = { notaus: null, limits: null, positionen: {} };
let tradingStandZeit = null; // Zeitpunkt des letzten gültigen Trading-Status (wird bei Fehlern nur als „veraltet“ genannt)
let letzteKurse = {};

function zahl(wert, stellen) {
  return Number(wert).toLocaleString("de-DE", { maximumFractionDigits: stellen });
}

function statusZeileSetzen(id, text, farbe) {
  const zeile = document.getElementById(id);
  zeile.textContent = text;
  zeile.style.color = farbe || "";
}

// Anzeige oben rechts: gesperrt | frei | unbekannt | getrennt
function kopfHandelSetzen(zustand) {
  const texte = {
    gesperrt: "HANDEL GESPERRT",
    frei: "HANDEL FREI · NUR MANUELL",
    unbekannt: "HANDEL: STATUS UNBEKANNT",
    getrennt: "HANDEL: NICHT VERBUNDEN",
  };
  const pille = document.getElementById("kopf-handel");
  pille.textContent = texte[zustand];
  pille.className = "pille " + zustand;
}

function zelle(text, klasse) {
  const td = document.createElement("td");
  td.textContent = text;
  if (klasse) td.className = klasse;
  return td;
}

function tabelleFuellen(id, zeilen) {
  const tabelle = document.getElementById(id);
  tabelle.replaceChildren(...zeilen.map((zellen) => {
    const tr = document.createElement("tr");
    tr.append(...zellen);
    return tr;
  }));
}

function verbunden() {
  return Boolean(verbindung.url && verbindung.code);
}

async function tradingLaden() {
  if (!verbunden()) {
    document.getElementById("trading-zustand").textContent = "Bitte zuerst im Cockpit die Verbindung einrichten.";
    kopfHandelSetzen("getrennt");
    knotenSetzen("knoten-markt", "aus", "nicht verbunden");
    knotenSetzen("knoten-handel", "aus", "nicht verbunden");
    paperFunktion("noch nicht verbunden", "aus");
    handelsmodusSetzen("paper", null);
    handelsmodusSetzen("testnet", null);
    return;
  }
  if (document.body.classList.contains("krypto-aus")) {
    // Aktien-Stand: keine Krypto-Abfragen (der Worker antwortet dort mit 410); Not-Aus und Protokoll gelten weiter
    await Promise.allSettled([tradingStatusLaden(), protokollLaden(), window.aktienLaden ? window.aktienLaden() : null]);
    return;
  }
  await kurseLaden(); // zuerst, damit Positionswerte berechnet werden können
  await Promise.allSettled([tradingStatusLaden(), kontoLaden(), protokollLaden(), paperLaden(), window.aktienLaden ? window.aktienLaden() : null]);
}

// ---------- Paper-Sprachbefehle (Spielgeld-Simulation, nie Börse/Testnet) ----------
// Erkannt werden nur Sätze mit „Paper“ (bzw. Papier, Simulation, Spielgeld), z. B.
//   „Paper kaufe Bitcoin für 100 Dollar“ · „Paper verkaufe alles Ethereum“ · „Paper Kontostand“ · „Paper Positionen“.
// Vor jeder Order liest JARVIS Markt, Richtung und Betrag vor und wartet auf „Ja“ (oder den Knopf „Ausführen“).
// Unklare Befehle lösen nie eine Order aus; Fragen ohne Kauf/Verkauf/Kontostand gehen wie bisher an die KI.
const PAPER_SPRACHE = { gueltigMs: 60000, nachfrageMs: 300000 };
let paperOffen = null;           // { id, symbol, seite, betrag, alles, text, element, uhr }
let paperLetzteFrage = 0;        // Zeitpunkt der letzten Rückfrage (für „Ja“ ohne offene Order)
let paperSprachLaeuft = false;   // eine bestätigte Order wird gerade simuliert
let paperFrageNummer = 0;

const PAPER_MAERKTE = [
  { symbol: "BTCUSDT", name: "Bitcoin", muster: /\b(bitcoins?|btc|xbt)\b/ },
  { symbol: "ETHUSDT", name: "Ethereum", muster: /\b(ethereum|etherium|ether|eth)\b/ },
];
const PAPER_ZAHLWOERTER = {
  zehn: 10, zwanzig: 20, "dreißig": 30, dreissig: 30, vierzig: 40, "fünfzig": 50, fuenfzig: 50, sechzig: 60,
  siebzig: 70, achtzig: 80, neunzig: 90, hundert: 100, einhundert: 100, zweihundert: 200, dreihundert: 300,
  vierhundert: 400, "fünfhundert": 500, tausend: 1000, eintausend: 1000,
};

// Kleinschreibung, Satzzeichen und Bindestriche entfernen und zusammengezogene Formen trennen, wie sie die
// Spracherkennung liefert: „Paperpositionen“ → „paper positionen“, „Paper-Trading-Positionen“ → „paper trading positionen“,
// „Papertradingkontostand“ → „paper trading kontostand“. Getrennt wird nur am Wortanfang – „Wertpapierpositionen“ bleibt
// ein Wort und ist kein Paper-Befehl.
function paperNormalisieren(text) {
  return text.toLowerCase()
    .replace(/[„“”"'!.;:]+/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(/(^|\s)(paper|pepper)(trading)?(?=\S)/g, (m, vor, wort, trading) => vor + wort + " " + (trading ? "trading " : ""))
    .replace(/\s+/g, " ")
    .trim();
}

// Liefert { art: "kauf"|"verkauf"|"stand"|"positionen"|"beides"|"unklar"|"nachfrage"|"zuruecksetzen", … }
// oder null (kein Paper-Befehl → normaler Chat)
function paperBefehlErkennen(original) {
  const text = paperNormalisieren(original);
  // Eindeutig: „Paper“, Simulation, Spielgeld. Ähnlich klingend (Erkennungsfehler): Papier, Pepper, „pay per“ → nur nachfragen
  const eindeutig = /\b(paper|simulation|simuliert|simulierte|spielgeld)\b/.test(text);
  const aehnlich = !eindeutig && /\b(papier|pepper|pay per|payper|peiper)\b/.test(text);
  if (!eindeutig && !aehnlich) return null;
  const verkauf = /\b(verkauf\w*|sell)\b/.test(text);
  const kauf = /\b(kauf|kaufe|kaufen|kauft|buy)\b/.test(text);
  const stand = /\b(kontostand|konto stand|konto|guthaben|stand|uebersicht|wie viel)\b|übersicht/.test(text);
  const positionen = /\b(positionen?|bestand|bestände|depot)\b/.test(text);
  const frage = /^(soll|sollte|sollten|würde|wuerde|würdest|ist|was|wie|warum|wann|lohnt|kann|könnte|meinst|erklär|erkläre)\b/.test(text);
  if (aehnlich) {
    // Nur nachfragen, wenn es nach einer Paper-Abfrage oder -Order klingt; sonst normaler Chat
    if (kauf || verkauf || stand || positionen) {
      return { art: "nachfrage", grund: "Meinten Sie Paper-Trading, also die Spielgeld-Simulation? Dann sagen Sie bitte zum Beispiel „Paper Positionen“, „Paper Kontostand“ oder „Paper kaufe Bitcoin für 100 Dollar“." };
    }
    return null;
  }
  if (!kauf && !verkauf) {
    if (stand || positionen) return { art: stand && positionen ? "beides" : stand ? "stand" : "positionen" };
    if (/\b(zurücksetzen|zuruecksetzen|reset)\b/.test(text)) return { art: "zuruecksetzen" };
    if (frage || original.trim().endsWith("?")) return null; // z. B. „Was ist Paper-Trading?“ → normale Frage an die KI
    // ab 17c: Fragen zu Risiko-Grenzen (z. B. „Risiko-Grenzen für Paper-Orders“) gehören zum Risk-Skill (aktien-werkzeuge), nicht zur Krypto-Nachfrage
    if (/\b(risiko\w*|grenze\w*|limits?)\b/.test(text)) return null;
    return { art: "nachfrage", grund: "Was möchten Sie im Paper-Trading wissen oder tun? Möglich sind „Paper Kontostand“, „Paper Positionen“, „Paper kaufe …“ und „Paper verkaufe …“." };
  }
  // Fragen wie „Soll ich Paper Bitcoin kaufen?“ sind keine Befehle
  if (frage) return null;
  if (kauf && verkauf) return { art: "unklar", grund: "Kauf und Verkauf zugleich genannt" };
  const maerkte = PAPER_MAERKTE.filter((m) => m.muster.test(text));
  if (maerkte.length !== 1) return { art: "unklar", grund: maerkte.length ? "mehrere Märkte genannt" : "Markt fehlt (Bitcoin oder Ethereum)" };
  const markt = maerkte[0];
  const seite = verkauf ? "SELL" : "BUY";
  if (/\b(euro|eur)\b|€/.test(text)) return { art: "unklar", grund: "Beträge bitte in USDT oder Dollar, nicht in Euro" };
  const alles = verkauf && /\b(alles|alle|komplett|gesamte|ganze|vollständig)\b/.test(text);
  const zahlen = [];
  for (const m of text.matchAll(/(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d+))?/g)) {
    zahlen.push(Number(m[1].replace(/[.\s]/g, "") + (m[2] ? "." + m[2] : "")));
  }
  for (const wort of text.split(" ")) if (PAPER_ZAHLWOERTER[wort]) zahlen.push(PAPER_ZAHLWOERTER[wort]);
  if (alles) {
    if (zahlen.length) return { art: "unklar", grund: "„alles“ und ein Betrag zugleich genannt" };
    return { art: "verkauf", symbol: markt.symbol, name: markt.name, seite, alles: true };
  }
  if (zahlen.length !== 1) return { art: "unklar", grund: zahlen.length ? "mehrere Beträge genannt" : "Betrag fehlt" };
  if (!/\b(usdt|usd|dollar|tether)\b|\$/.test(text)) return { art: "unklar", grund: "Einheit fehlt – bitte Betrag in USDT oder Dollar nennen" };
  const betrag = zahlen[0];
  if (!(betrag >= 10)) return { art: "unklar", grund: "Mindestbetrag ist 10 USDT" };
  return { art: seite === "BUY" ? "kauf" : "verkauf", symbol: markt.symbol, name: markt.name, seite, betrag, alles: false };
}

function paperBestaetigungsArt(text) {
  const t = paperNormalisieren(text).replace(/,/g, "");
  if (/^(ja|jawohl|ja bitte|bestätigen|bestätige|bestätigt|ja bestätigen|ja bestätigt|ausführen|ja ausführen|ja bitte ausführen|order ausführen|ja order ausführen)$/.test(t)) return "ja";
  if (/^(nein|nein danke|abbrechen|abbruch|stopp|stop|nicht ausführen|verwerfen|nein abbrechen)$/.test(t)) return "nein";
  return null;
}

// JARVIS antwortet lokal (Verlauf, Untertitel, Vorlesen). erzwingen: auch bei „Vorlesen: aus“ (Order-Rückfrage)
function paperAntworten(text, art, erzwingen) {
  const element = nachrichtAnzeigen("JARVIS: " + text, "jarvis" + (art ? " " + art : ""));
  untertitelSetzen(null, text);
  lokalVorlesen(text, erzwingen);
  return element;
}

function paperBetragText(o) {
  return o.alles ? "die gesamte simulierte " + o.name + "-Position" : zahl(o.betrag, 2) + " USDT Spielgeld";
}

function paperOffenBeenden() {
  if (!paperOffen) return null;
  const offen = paperOffen;
  paperOffen = null;
  clearTimeout(offen.uhr);
  for (const k of offen.element.querySelectorAll("button")) k.disabled = true;
  return offen;
}

function paperRueckfrage(o) {
  paperOffenBeenden();
  const id = ++paperFrageNummer;
  const richtung = o.seite === "BUY" ? "Kauf" : "Verkauf";
  const text = "Paper-Order zur Bestätigung: " + richtung + " " + o.name + " (" + o.symbol + "), "
    + (o.alles ? "Verkauf der gesamten simulierten Position" : "Betrag " + zahl(o.betrag, 2) + " USDT")
    + ", zum aktuellen Kraken-Kurs. Nur Simulation mit Spielgeld, keine Börse. "
    + "Sagen oder tippen Sie „Ja“ zum Ausführen oder „Nein“ zum Abbrechen.";
  const element = paperAntworten(text, "paper-frage", true);
  const knoepfe = document.createElement("div");
  knoepfe.className = "paper-frage-knoepfe";
  const ja = Object.assign(document.createElement("button"), { type: "button", className: "knopf", textContent: "Ausführen (Simulation)" });
  const nein = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", textContent: "Abbrechen" });
  ja.dataset.paperFrage = String(id);
  ja.addEventListener("click", () => paperBestaetigen(id));
  nein.addEventListener("click", () => paperAbbrechen(id));
  knoepfe.append(ja, nein);
  element.appendChild(knoepfe);
  paperOffen = { ...o, id, element, bis: Date.now() + PAPER_SPRACHE.gueltigMs };
  paperOffen.uhr = setTimeout(() => {
    if (!paperOffen || paperOffen.id !== id) return;
    paperOffenBeenden();
    paperAntworten("Die Paper-Order ist verfallen, weil innerhalb von " + Math.round(PAPER_SPRACHE.gueltigMs / 1000)
      + " Sekunden keine Bestätigung kam. Es wurde nichts ausgeführt.");
  }, PAPER_SPRACHE.gueltigMs);
  paperLetzteFrage = Date.now();
}

function paperAbbrechen(id) {
  if (!paperOffen || (id !== undefined && paperOffen.id !== id)) return;
  paperOffenBeenden();
  paperAntworten("Paper-Order abgebrochen. Es wurde nichts ausgeführt.");
}

async function paperBestaetigen(id) {
  if (paperSprachLaeuft || !paperOffen || (id !== undefined && paperOffen.id !== id)) return;
  const o = paperOffenBeenden(); // zuerst schließen: ein zweites „Ja“ findet keine offene Order mehr
  paperSprachLaeuft = true;
  const platzhalter = nachrichtAnzeigen("JARVIS simuliert die Paper-Order …", "jarvis denkt");
  try {
    const d = await workerAnfrage("/paper/order", {
      method: "POST",
      body: JSON.stringify(o.alles ? { symbol: o.symbol, seite: "SELL", alles: true } : { symbol: o.symbol, seite: o.seite, betrag_usdt: o.betrag }),
    });
    platzhalter.remove();
    const a = d.ausfuehrung;
    paperAntworten("Simuliert: " + (a.seite === "BUY" ? "Kauf von " : "Verkauf von ") + zahl(a.menge, 8) + " "
      + a.symbol.replace(/USDT$/, "") + " für " + zahl(a.betrag_usdt, 2) + " USDT zum Kurs " + zahl(a.preis, 2)
      + " (" + a.quelle + "), Gebühr " + zahl(a.gebuehr_usdt, 2) + " USDT. Verfügbares Spielgeld: " + zahl(d.stand.usdt, 2) + " USDT.");
    paperAnzeigen(d.stand);
  } catch (e) {
    platzhalter.remove();
    // netzwerk = keine Antwort vom Worker (auch Zeitlimit); sonst hat der Worker die Order abgelehnt (nichts gespeichert)
    paperAntworten(e.status === 410 ? KRYPTO_PAPER_AUS : e.nichtGesendet ? "Paper-Order nicht ausgeführt: " + e.message
      : e.netzwerk || e instanceof TypeError
        ? "Keine Antwort vom Worker – ob die Simulation gespeichert wurde, ist unklar. Bitte den Paper-Stand prüfen."
        : "Paper-Order nicht ausgeführt: " + e.message, "fehler");
  } finally {
    paperSprachLaeuft = false;
  }
}

async function paperStandSagen(art) {
  try {
    const s = await workerAnfrage("/paper/status", { method: "GET" });
    paperAnzeigen(s);
    const teile = [];
    if (art !== "positionen") {
      teile.push("Paper-Kontostand: " + zahl(s.usdt, 2) + " USDT Spielgeld frei"
        + (s.gesamtwert_usdt === null ? "" : ", Gesamtwert " + zahl(s.gesamtwert_usdt, 2) + " USDT, "
          + (s.gewinn_usdt >= 0 ? "Gewinn " : "Verlust ") + zahl(Math.abs(s.gewinn_usdt), 2) + " USDT seit Start") + ".");
    }
    if (art !== "stand") {
      teile.push(s.positionen.length
        ? "Simulierte Positionen: " + s.positionen.map((p) => zahl(p.menge, 8) + " " + p.symbol.replace(/USDT$/, "")
          + (p.wert_usdt === null ? "" : " im Wert von " + zahl(p.wert_usdt, 2) + " USDT")).join(", ") + "."
        : "Keine simulierten Positionen.");
    }
    if (s.hinweis) teile.push(s.hinweis);
    paperAntworten(teile.join(" "));
  } catch (e) {
    paperAntworten(e.status === 410 ? KRYPTO_PAPER_AUS : "Paper-Stand nicht abrufbar: " + e.message, e.status === 410 ? undefined : "fehler");
  }
}
// Krypto-Paper im Aktien-Stand: Worker meldet krypto_aktiv false (Klasse „krypto-aus“) bzw. antwortet auf /paper/* mit 410
function kryptoAbgeschaltet() { return document.body.classList.contains("krypto-aus"); }
const KRYPTO_PAPER_AUS = "Krypto-Paper-Trading (Spielgeld-Simulation im Worker) ist im Aktien-Stand abgeschaltet – derzeit nicht verfügbar. Es wurde nichts ausgeführt. "
  + "Für US-Aktien: „analysiere AAPL“; ein Aktien-Paper-Vorschlag (lokale Simulation im Paper-Kern) entsteht nur im Dashboard mit Bestätigung.";

// true = lokal behandelt (nichts an die KI); false = normaler Chat
async function paperSprachbefehl(text) {
  const antwort = paperBestaetigungsArt(text);
  if (paperOffen) {
    if (antwort === "ja") { await paperBestaetigen(); return true; }
    if (antwort === "nein") { paperAbbrechen(); return true; }
    // Alles andere ist keine Bestätigung: offene Order verwerfen, dann den Text normal behandeln
    paperOffenBeenden();
    nachrichtAnzeigen("JARVIS: Offene Paper-Order verworfen – keine eindeutige Bestätigung. Es wurde nichts ausgeführt.", "jarvis");
  } else if (antwort && Date.now() - paperLetzteFrage < PAPER_SPRACHE.nachfrageMs) {
    paperAntworten(antwort === "ja"
      ? "Es gibt keine offene Paper-Order zu bestätigen. Es wird nichts ausgeführt."
      : "Es gibt keine offene Paper-Order.");
    return true;
  }
  const befehl = paperBefehlErkennen(text);
  if (!befehl) return false;
  // Aktien-Stand: Krypto-Paper ist im Worker abgeschaltet – keine Rückfrage und keine Anfrage, sondern eine klare Absage (ab 11-02g)
  if (kryptoAbgeschaltet() && befehl.art !== "nachfrage") { paperAntworten(KRYPTO_PAPER_AUS); return true; }
  if (!verbunden()) {
    paperAntworten("Paper-Trading braucht die Verbindung zum Worker. Es wurde nichts ausgeführt.");
    return true;
  }
  if (befehl.art === "nachfrage") {
    paperAntworten(befehl.grund + " Es wurde nichts ausgeführt.");
    return true;
  }
  if (befehl.art === "zuruecksetzen") {
    paperAntworten("Das Zurücksetzen der Paper-Simulation ist bewusst nicht per Sprache möglich. Bitte im Reiter Trading den Knopf „Simulation auf 10.000 USDT zurücksetzen“ verwenden. Es wurde nichts ausgeführt.");
    return true;
  }
  if (befehl.art === "unklar") {
    paperAntworten("Diesen Paper-Befehl habe ich nicht eindeutig verstanden (" + befehl.grund + "). Es wurde nichts ausgeführt. "
      + "Beispiele: „Paper kaufe Bitcoin für 100 Dollar“, „Paper verkaufe alles Ethereum“, „Paper Kontostand“, „Paper Positionen“.");
    return true;
  }
  if (befehl.art === "kauf" || befehl.art === "verkauf") {
    paperRueckfrage(befehl);
    return true;
  }
  await paperStandSagen(befehl.art);
  return true;
}

// ---------- Skills: lokale Befehle vor dem KI-Chat ----------
// Ein Skill hat Name, Beschreibung, Beispiele, eine Prüfung passt(text) und eine Freigabe-Kategorie (risiko):
//   "abfrage"     – liest nur (Status, Kontostand, Hilfe): läuft sofort
//   "leicht"      – leicht rückgängig zu machen (Ansicht wechseln, Programm öffnen, Aufgabe anlegen): läuft sofort mit Rückmeldung
//   "bestaetigen" – folgenreich (Paper-Order, Aufgabe löschen): JARVIS zeigt konkret, was passiert, und wartet auf „Ja“
//   "gesperrt"    – nie per Sprache (echte Orders, Automatik, Not-Aus, beliebige PC-Befehle, Dateien löschen): klare Absage
// Abfragen/leichte Skills haben aktion(text) → true, wenn erledigt. Bestätigungspflichtige haben planen(text) →
// { beschreibung, ausfuehren } oder { fehler }; ausgeführt wird nur nach exakt „Ja“ (oder Knopf). Ausnahme: der Paper-Skill
// hat seine eigene, unveränderte Rückfrage (eigeneBestaetigung). Passt keiner, geht der Text wie bisher an die KI.
const SKILLS = [];
const RISIKO_TEXT = { abfrage: "direkt", leicht: "direkt, rückgängig machbar", bestaetigen: "nur nach Bestätigung", gesperrt: "nicht per Sprache" };
const AKTION_GUELTIG_MS = { wert: 60000 };
let offeneAktion = null; // { id, skill, beschreibung, ausfuehren, element, uhr }
let aktionNummer = 0;

function skillRegistrieren(skill) {
  if (!RISIKO_TEXT[skill.risiko]) throw new Error("Skill " + skill.name + " ohne gültige Freigabe-Kategorie");
  SKILLS.push(skill);
}

// Konfigurierbare Freigaben: Der Nutzer darf eine Fähigkeit nur strenger stellen (bis „ausgeschaltet“), nie lockerer als
// ihr Standard. Jede Änderung landet im Änderungsverlauf. Hilfe und die Absage für Gesperrtes sind nicht einstellbar.
const RISIKO_STUFE = { abfrage: 0, leicht: 1, bestaetigen: 2, gesperrt: 3 };
const FREIGABEN = { schluessel: "jarvis-freigaben", maxVerlauf: 100, fest: ["hilfe", "gesperrt"] };
let freigaben = { abweichungen: {}, verlauf: [] };
function freigabenLaden() {
  let roh = null;
  try { roh = speicherJsonLesen(FREIGABEN.schluessel, (d) => istObjekt(d) && istObjekt(d.abweichungen)); } catch (e) { roh = null; }
  freigaben = { abweichungen: {}, verlauf: [] };
  if (roh && roh.abweichungen && typeof roh.abweichungen === "object") {
    for (const [name, risiko] of Object.entries(roh.abweichungen)) if (RISIKO_STUFE[risiko] !== undefined && !FREIGABEN.fest.includes(name)) freigaben.abweichungen[name] = risiko;
  }
  if (roh && Array.isArray(roh.verlauf)) {
    freigaben.verlauf = roh.verlauf.filter((v) => v && typeof v.skill === "string" && RISIKO_STUFE[v.von] !== undefined && RISIKO_STUFE[v.nach] !== undefined && !isNaN(Date.parse(v.zeit))).slice(-FREIGABEN.maxVerlauf);
  }
}
// Liefert false, wenn der Browserspeicher gesperrt oder voll ist: dann gilt die Änderung nur für diese Sitzung (ab 11-04a gemeldet)
function freigabenSpeichern() { if (speicherBeschaedigt(FREIGABEN.schluessel)) return false; try { localStorage.setItem(FREIGABEN.schluessel, JSON.stringify(freigaben)); return true; } catch (e) { return false; } }
// Wirksame Freigabe: eine gespeicherte Abweichung gilt nur, wenn sie strenger ist als der Standard
function skillRisiko(skill) {
  const a = freigaben.abweichungen[skill.name];
  return a && RISIKO_STUFE[a] > RISIKO_STUFE[skill.risiko] ? a : skill.risiko;
}
function freigabeEinstellbar(skill) { return Boolean(skill) && !FREIGABEN.fest.includes(skill.name) && skill.risiko !== "gesperrt"; }
function freigabeSetzen(name, risiko) {
  const skill = SKILLS.find((s) => s.name === name);
  if (!freigabeEinstellbar(skill)) return { fehler: "Diese Fähigkeit ist nicht einstellbar." };
  if (RISIKO_STUFE[risiko] === undefined) return { fehler: "Unbekannte Freigabe." };
  if (RISIKO_STUFE[risiko] < RISIKO_STUFE[skill.risiko]) return { fehler: "Lockerer als der Standard („" + RISIKO_TEXT[skill.risiko] + "“) ist nicht möglich." };
  const von = skillRisiko(skill);
  if (von === risiko) return { ok: true, unveraendert: true };
  if (risiko === skill.risiko) delete freigaben.abweichungen[name]; else freigaben.abweichungen[name] = risiko;
  freigaben.verlauf = [...freigaben.verlauf, { zeit: new Date().toISOString(), skill: name, von, nach: risiko }].slice(-FREIGABEN.maxVerlauf);
  return { ok: true, gespeichert: freigabenSpeichern() };
}
// ab 11-04a: scheitert das Speichern, sagt die Karte das (vorher stiller Erfolg; nach dem Neuladen galt wieder der gespeicherte Stand)
function freigabenMeldung(gespeichert) {
  const m = document.getElementById("freigaben-meldung");
  // ab 11-06b: beschädigter Stand – die gespeicherten (strengeren) Freigaben sind unbekannt, es gilt der Standard
  if (m) m.textContent = speicherBeschaedigt(FREIGABEN.schluessel) ? "⚠ Gespeicherte Freigaben beschädigt – es gilt der Standard; deine strengeren Einstellungen sind unbekannt. " + SPEICHER_SCHADEN_TEXT
    : gespeichert === false ? "Nicht gespeichert: Browserspeicher gesperrt oder voll – die Änderung gilt nur bis zum Neuladen, danach wieder der gespeicherte Stand." : "";
}
freigabenLaden();

// Lokale Antworten (Hilfe, Briefing, Skills, Rückfragen …) werden wie Paper-Antworten vorgelesen: Google über /sprechen,
// sonst Browserstimme mit sichtbarem Hinweis – nur bei „Vorlesen: an“. Platzhalter („denkt nach …“) nicht, und nie während
// einer laufenden Aufnahme (sonst würde die Ansage die Spracheingabe beenden). Paper-Rückfragen laufen unverändert über
// paperAntworten (dort auch bei „Vorlesen: aus“).
function lokalAntworten(text, art) {
  const element = nachrichtAnzeigen("JARVIS: " + text, "jarvis" + (art ? " " + art : ""));
  untertitelSetzen(null, text);
  const platzhalter = Boolean(art && String(art).includes("denkt"));
  const aufnahme = Boolean(window.spracheingabeLaeuft && window.spracheingabeLaeuft());
  if (!platzhalter && !aufnahme && typeof lokalVorlesen === "function") lokalVorlesen(text);
  return element;
}

function offeneAktionBeenden() {
  if (!offeneAktion) return null;
  const a = offeneAktion;
  offeneAktion = null;
  clearTimeout(a.uhr);
  for (const k of a.element.querySelectorAll("button")) k.disabled = true;
  return a;
}

async function offeneAktionAusfuehren(id) {
  if (!offeneAktion || (id !== undefined && offeneAktion.id !== id)) return false;
  const a = offeneAktionBeenden(); // zuerst schließen: ein zweites „Ja“ findet nichts mehr
  try {
    const ergebnis = await a.ausfuehren();
    if (typeof ergebnis === "string") lokalAntworten(ergebnis); // Skills mit eigener Antwort liefern nichts zurück
  } catch (e) {
    lokalAntworten("Nicht ausgeführt: " + e.message, "fehler");
  }
  return true;
}

function offeneAktionAbbrechen(id) {
  if (!offeneAktion || (id !== undefined && offeneAktion.id !== id)) return;
  offeneAktionBeenden();
  lokalAntworten("Abgebrochen. Es wurde nichts ausgeführt.");
}

function bestaetigungAnfordern(skill, plan) {
  if (typeof paperOffenBeenden === "function") paperOffenBeenden(); // nie zwei offene Rückfragen
  const id = ++aktionNummer;
  const element = lokalAntworten("Bitte bestätigen: " + plan.beschreibung + " Sagen oder tippen Sie „Ja“ zum Ausführen oder „Nein“ zum Abbrechen.", "paper-frage");
  const knoepfe = document.createElement("div");
  knoepfe.className = "paper-frage-knoepfe";
  const ja = Object.assign(document.createElement("button"), { type: "button", className: "knopf", textContent: "Ausführen" });
  const nein = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", textContent: "Abbrechen" });
  ja.addEventListener("click", () => offeneAktionAusfuehren(id));
  nein.addEventListener("click", () => offeneAktionAbbrechen(id));
  knoepfe.append(ja, nein);
  element.appendChild(knoepfe);
  offeneAktion = { id, skill: skill.name, beschreibung: plan.beschreibung, ausfuehren: plan.ausfuehren, element, bis: Date.now() + AKTION_GUELTIG_MS.wert };
  offeneAktion.uhr = setTimeout(() => {
    if (!offeneAktion || offeneAktion.id !== id) return;
    offeneAktionBeenden();
    lokalAntworten("Die Rückfrage ist verfallen. Es wurde nichts ausgeführt.");
  }, AKTION_GUELTIG_MS.wert);
}

async function skillAusfuehren(text) {
  // Offene Bestätigung zuerst: nur exakt „Ja“/„Nein“ zählt, alles andere verwirft sie (nichts wird ausgeführt)
  if (offeneAktion) {
    const art = paperBestaetigungsArt(text);
    if (art === "ja") { const name = offeneAktion.skill; await offeneAktionAusfuehren(); return name; }
    if (art === "nein") { offeneAktionAbbrechen(); return "bestaetigung"; }
    offeneAktionBeenden();
    lokalAntworten("Offene Aktion verworfen – keine eindeutige Bestätigung. Es wurde nichts ausgeführt.");
  }
  // Offener Strategie-Dialog (ab 11-02e), wie offeneAktion vor allen Skills: Werte/„abbrechen“ beantworten ihn (sonst finge z. B. der
  // Paper-Skill „abbrechen“ ab); jede andere Eingabe verwirft ihn sichtbar, danach normale Verarbeitung
  if (typeof slDialogPasst === "function" && slDialogPasst(text)) { await slDialogAntwort(text); return "aktien-strategie-dialog"; }
  if (typeof slDialogVerwerfenWennFremd === "function") slDialogVerwerfenWennFremd(text);
  for (const skill of SKILLS) {
    if (!skill.passt(text)) continue;
    // Vom Nutzer strenger gestellt: ausgeschaltet → lokale Absage; Bestätigung → allgemeine Rückfrage vor der Aktion
    const risiko = skillRisiko(skill);
    if (risiko === "gesperrt" && skill.risiko !== "gesperrt") {
      lokalAntworten("„" + skill.beschreibung + "“ ist in Ihren Freigaben ausgeschaltet (Cockpit → Fähigkeiten & Freigaben). Es wurde nichts ausgeführt.");
      return skill.name;
    }
    if (risiko === "bestaetigen" && skill.risiko !== "bestaetigen") {
      bestaetigungAnfordern(skill, { beschreibung: "„" + text.trim() + "“ – " + skill.beschreibung + " (laut Ihren Freigaben nur nach Bestätigung).",
        ausfuehren: async () => { await skill.aktion(text); return null; } });
      return skill.name;
    }
    if (skill.risiko === "bestaetigen" && !skill.eigeneBestaetigung) {
      const plan = await skill.planen(text);
      if (!plan) continue;
      if (plan.fehler) lokalAntworten(plan.fehler + " Es wurde nichts ausgeführt.");
      else bestaetigungAnfordern(skill, plan);
      return skill.name;
    }
    if (await skill.aktion(text)) return skill.name;
  }
  return null;
}

// Kurze Normalisierung nur für die einfachen Skill-Befehle; Paper nutzt seine eigene Erkennung.
function befehlNormalisieren(text) {
  return text.toLowerCase().replace(/[„“”"'!?.,;:]+/g, " ").replace(/^\s*(hey\s+)?jarvis\s+/, "").replace(/\s+/g, " ").trim();
}
const IST_FRAGE = /^(was|wie|warum|wieso|weshalb|wann|kann|könnte|darf|soll|sollte|ist|gibt es|erklär|erkläre)\b/;

skillRegistrieren({
  name: "hilfe",
  risiko: "abfrage",
  beschreibung: "Zeigt, was ich lokal kann",
  beispiele: ["Was kannst du?", "Hilfe"],
  passt: (text) => /^(hilfe|help|was kannst du( alles| eigentlich)?|welche befehle (gibt es|kennst du)|befehle)$/.test(befehlNormalisieren(text)),
  aktion: async () => {
    const zeilen = ["Das kann ich, Sir:"];
    for (const skill of SKILLS) {
      if (skill.name === "hilfe" || skill.hilfeKurz || skillRisiko(skill) === "gesperrt") continue; // hilfeKurz ab 11-09h: Sammelzeile unten
      const nv = typeof skill.nichtVerfuegbar === "function" ? skill.nichtVerfuegbar() : null;
      const hinweis = nv ? " (" + nv + ")" : skill.braucht === "verbindung" && !verbunden() ? " (braucht die Worker-Verbindung)"
        : skill.braucht === "helfer" && !helferEingerichtet() ? " (braucht den PC-Helfer)" : "";
      zeilen.push("• " + skill.beschreibung + hinweis + " [" + RISIKO_TEXT[skillRisiko(skill)] + "] – z. B. „" + skill.beispiele.join("“, „") + "“");
    }
    // ab 11-09h: neuere Fähigkeiten als eine Zeile (die Hilfe wird sonst zu lang für die Sprachausgabe); Freigaben je Fähigkeit in der Karte
    const kurz = SKILLS.filter((s) => s.hilfeKurz && skillRisiko(s) !== "gesperrt").map((s) => s.hilfeKurz);
    if (kurz.length) zeilen.push("• Außerdem: " + kurz.join(", ") + " (Beispiele unter „Fähigkeiten & Freigaben“).");
    zeilen.push(verbunden()
      ? "• Alles andere beantworte ich über die KI, auf Wunsch mit Websuche."
      : "• Freie Fragen an die KI gehen erst, wenn im Cockpit die Verbindung eingerichtet ist.");
    zeilen.push("• Nicht per Sprache: echte Orders/Echtgeld, Testnet-Orders, Automatik, Not-Aus, beliebige PC-Befehle, Dateien löschen.");
    zeilen.push("• Marktanalyse mit Charts im Reiter „Analyse“, Krypto-Paper-Trading und Testnet im Reiter „Trading“" + (kryptoAbgeschaltet() ? " (beides im Aktien-Stand abgeschaltet)" : "") + ". US-Aktien: Paper-Kern-Simulation und Aktien-Paper-Vorschlag in der Karte „US-Aktie analysieren“ – getrennt vom Krypto-Paper.");
    // Kurz: nicht Verfügbares bei US-Aktien (ausführlich: „Was kannst du mit Aktien?“)
    if (window.AktienAssistent) zeilen.push("• US-Aktien – nicht per Sprache: Orders und Paper-Buchungen; nicht verfügbar: OpenFIGI, automatisches PDF-Auslesen, automatische Senatsdaten, Form-4-Inhalt. Details: „Was kannst du mit Aktien?“");
    lokalAntworten(zeilen.join("\n"));
    return true;
  },
});

// Paper-Befehle: unveränderte Erkennung (paperBefehlErkennen/paperSprachbefehl); Orders mit eigener Rückfrage.
skillRegistrieren({
  name: "paper",
  risiko: "bestaetigen",
  eigeneBestaetigung: true,
  beschreibung: "Krypto-Paper-Trading per Sprache oder Chat (Spielgeld-Simulation im Worker in USDT, nicht US-Aktien; Abfragen direkt, Orders nur nach „Ja“)",
  beispiele: ["Paper Kontostand", "Paper Positionen", "Paper kaufe Bitcoin für 100 Dollar"],
  braucht: "verbindung",
  // Aktien-Stand (Worker meldet krypto_aktiv false, /paper/* antwortet 410): in der Hilfe als nicht verfügbar kennzeichnen
  nichtVerfuegbar: () => (kryptoAbgeschaltet() ? "derzeit nicht verfügbar – Krypto ist im Aktien-Stand abgeschaltet" : null),
  passt: (text) => Boolean(paperOffen) || paperBestaetigungsArt(text) !== null || paperBefehlErkennen(text) !== null,
  aktion: (text) => paperSprachbefehl(text),
});

// Gesperrt: folgenreiche oder gefährliche Dinge, die es per Sprache bewusst nicht gibt. Fragen dazu gehen an die KI.
const GESPERRT = [
  [/\b(echtgeld|echtem geld|echten handel|echte order|live handel|live trading)\b/, "Echtgeld-Handel ist in JARVIS technisch ausgeschlossen."],
  [/\b(testnet|binance)\b.*\b(kauf\w*|verkauf\w*|order)\b|\b(kauf\w*|verkauf\w*|order)\b.*\b(testnet|binance)\b/, "Testnet-Orders gibt es nur im Reiter „Trading“ per Knopf – nicht per Sprache."],
  [/\b(automatik|bot|automatischen handel)\b.*\b(an|ein|einschalten|starten|aktivieren)\b|\b(starte|aktiviere)\b.*\b(automatik|bot)\b/, "Automatischer Handel ist im Worker fest ausgeschaltet."],
  [/\bnot[- ]?aus\b.*\b(aus|aufheben|deaktivieren|ausschalten|abschalten)\b/, "Den Not-Aus ändert JARVIS nicht per Sprache – nur über den Knopf im Reiter „Trading“."],
  [/\b(führe|fuehre)\b.*\bbefehl\b|\b(cmd|powershell|terminal|shell|eingabeaufforderung)\b|\bformatier\w*/, "Beliebige PC-Befehle führt JARVIS nicht aus – nur Programme aus der festen Liste des PC-Helfers."],
  [/\b(lösch\w*|loesch\w*|entfern\w*)\b.*\b(datei\w*|ordner\w*)\b|\b(datei\w*|ordner\w*)\b.*\b(lösch\w*|loesch\w*)\b/, "Dateien oder Ordner löschen kann JARVIS bewusst nicht."],
];
skillRegistrieren({
  name: "gesperrt",
  risiko: "gesperrt",
  beschreibung: "Klare Absage für Gesperrtes",
  beispiele: [],
  passt: (text) => { const t = befehlNormalisieren(text); return !IST_FRAGE.test(t) && GESPERRT.some(([m]) => m.test(t)); },
  aktion: async (text) => {
    const t = befehlNormalisieren(text);
    lokalAntworten(GESPERRT.find(([m]) => m.test(t))[1] + " Es wurde nichts ausgeführt.");
    return true;
  },
});

// Ansicht wechseln (leicht: jederzeit zurück)
const SKILL_ANSICHTEN = { analyse: "analyse", marktanalyse: "analyse", trading: "trading", handel: "trading", cockpit: "cockpit", übersicht: "cockpit", uebersicht: "cockpit" };
skillRegistrieren({
  name: "ansicht",
  risiko: "leicht",
  beschreibung: "Bereich wechseln",
  beispiele: ["Zeige die Analyse", "Öffne Trading"],
  passt: (text) => /^(zeige?|zeig mir|öffne|oeffne|geh(e)? zu(r|m)?|wechsle zu(r|m)?)( die| den| das)? (analyse|marktanalyse|trading|handel|cockpit|übersicht|uebersicht)$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const wort = befehlNormalisieren(text).split(" ").pop();
    ansichtZeigen(SKILL_ANSICHTEN[wort]);
    lokalAntworten("Bereich „" + ({ analyse: "Analyse", trading: "Trading", cockpit: "Cockpit" })[SKILL_ANSICHTEN[wort]] + "“ geöffnet.");
    return true;
  },
});

// ---------- PC-Helfer (lokaler Begleitprozess auf 127.0.0.1) ----------
const HELFER_ADRESSE = "http://127.0.0.1:47811";
const PC_PROGRAMME = { rechner: "rechner", taschenrechner: "rechner", editor: "editor", notepad: "editor", explorer: "explorer", dateiexplorer: "explorer", "datei explorer": "explorer", edge: "edge", browser: "edge" };
function helferEingerichtet() { return Boolean(einstellungLesen("jarvis-helfer-code")); }

async function helferAnfrage(pfad, optionen = {}) {
  let antwort;
  try {
    antwort = await fetch(HELFER_ADRESSE + pfad, {
      ...optionen,
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
      headers: { "content-type": "application/json", "x-jarvis-helfer": einstellungLesen("jarvis-helfer-code") },
    });
  } catch (e) {
    // Das sekündliche Abfragen des Aktivierungsworts (/ereignisse) nicht protokollieren – es würde das Protokoll fluten
    if (!pfad.startsWith("/ereignisse")) diagnoseErfassen({ quelle: "helfer", methode: optionen.method, pfad, art: "netzwerk", meldung: "PC-Helfer nicht erreichbar" });
    throw new Error("PC-Helfer nicht erreichbar – läuft jarvis-helfer.ps1 auf diesem PC?");
  }
  let daten = null;
  try { daten = JSON.parse(await antwort.text()); } catch (e) { /* keine JSON-Antwort */ }
  if (!antwort.ok && !pfad.startsWith("/ereignisse")) diagnoseErfassen({ quelle: "helfer", methode: optionen.method, pfad, art: "http", status: antwort.status, meldung: (daten && daten.fehler) || "" });
  if (!antwort.ok) throw new Error(geheimnisMuster((daten && daten.fehler) || "PC-Helfer: Fehler " + antwort.status).slice(0, 500));
  if (!daten) throw new Error("PC-Helfer: ungültige Antwort.");
  return daten;
}

skillRegistrieren({
  name: "pc-oeffnen",
  risiko: "leicht",
  braucht: "helfer",
  beschreibung: "Programm aus der festen Liste öffnen (Rechner, Editor, Explorer, Edge)",
  beispiele: ["Öffne den Rechner", "Starte den Editor"],
  // ab 11-07c: „Öffne <Karte/Einstellung>“ ist Navigation (Skill „navigation“), sofern es kein Programm der Liste ist
  passt: (text) => {
    const t = befehlNormalisieren(text);
    if (!/^(öffne|oeffne|starte)( den| die| das)? .+$/.test(t) || /^(öffne|oeffne|starte)( den| die| das)? routine\b/.test(t)) return false;
    const wunsch = t.replace(/^(öffne|oeffne|starte)( den| die| das)? /, "");
    if (!PC_PROGRAMME[wunsch] && /^(öffne|oeffne)/.test(t) && typeof navSprachZiel === "function") { const r = navSprachZiel(wunsch); if (r.ziel || r.einstellungen || r.treffer.length) return false; }
    return true;
  },
  aktion: async (text) => {
    const wunsch = befehlNormalisieren(text).replace(/^(öffne|oeffne|starte)( den| die| das)? /, "");
    const programm = PC_PROGRAMME[wunsch];
    if (!programm) { lokalAntworten("„" + wunsch + "“ steht nicht in der erlaubten Liste. Erlaubt: Rechner, Editor, Explorer, Edge. Es wurde nichts ausgeführt."); return true; }
    if (!helferEingerichtet()) { lokalAntworten("Der PC-Helfer ist nicht eingerichtet (Cockpit → Verbindung → PC-Helfer). Es wurde nichts ausgeführt."); return true; }
    try {
      const d = await helferAnfrage("/oeffnen", { method: "POST", body: JSON.stringify({ programm }) });
      lokalAntworten(d.programm + " wurde geöffnet" + (d.attrappe ? " (Attrappe – nichts wirklich gestartet)" : "") + ".");
    } catch (e) {
      lokalAntworten(e.message + " Es wurde nichts ausgeführt.", "fehler");
    }
    return true;
  },
});

skillRegistrieren({
  name: "pc-info",
  risiko: "abfrage",
  braucht: "helfer",
  beschreibung: "Systeminformationen dieses PCs",
  beispiele: ["Systeminfo", "Wie geht es dem PC?"],
  passt: (text) => /^(systeminfo|systeminformationen|pc status|wie geht es (dem|meinem) (pc|rechner|computer))$/.test(befehlNormalisieren(text)),
  aktion: async () => {
    if (!helferEingerichtet()) { lokalAntworten("Der PC-Helfer ist nicht eingerichtet (Cockpit → Verbindung → PC-Helfer)."); return true; }
    try {
      const s = await helferAnfrage("/system", { method: "GET" });
      lokalAntworten([s.betriebssystem + " auf " + s.rechner + (s.attrappe ? " (Attrappe)" : ""),
        "läuft seit " + zahl(s.laufzeit_stunden, 1) + " h", s.prozessor + ", " + s.kerne + " Kerne",
        "Arbeitsspeicher " + zahl(s.arbeitsspeicher_frei_gb, 1) + " von " + zahl(s.arbeitsspeicher_gb, 1) + " GB frei",
        s.laufwerk_c_frei_gb === null ? "Laufwerk C: nicht verfügbar" : "Laufwerk C: " + zahl(s.laufwerk_c_frei_gb, 1) + " GB frei"].join(" · ") + ". Quelle: PC-Helfer, Stand " + new Date().toLocaleTimeString("de-DE") + ".");
    } catch (e) {
      lokalAntworten("Systeminfo nicht verfügbar: " + e.message, "fehler");
    }
    return true;
  },
});

// ---------- Aufgaben per Sprache ----------
skillRegistrieren({
  name: "aufgabe-anlegen",
  risiko: "leicht",
  beschreibung: "Aufgabe anlegen (rückgängig: Aufgabe löschen)",
  beispiele: ["Neue Aufgabe Arzt anrufen", "Erinnere mich an Medikamente"],
  passt: (text) => /^(neue aufgabe|aufgabe anlegen|notiere( dir)?|erinnere mich( daran)?( an)?) .+/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const titel = text.replace(/^\s*(hey\s+)?jarvis[\s,]+/i, "").replace(/^\s*(neue aufgabe|aufgabe anlegen|notiere( dir)?|erinnere mich( daran)?( an)?)\s*[:,]?\s*/i, "").replace(/[.!]+\s*$/, "").trim();
    if (!titel || !window.aufgabenIntern) return false;
    // ab 11-07c: Zeitangabe („morgen um 9“, „in drei Tagen“) als Fälligkeit; unklar oder vergangen → Rückfrage, nichts angelegt
    const zeit = typeof zeitangabeErkennen === "function" ? zeitangabeErkennen(titel) : null;
    if (zeit && zeit.rueckfrage) { lokalAntworten("Zeitangabe nicht eindeutig: " + zeit.rueckfrage); return true; }
    const name = zeit && zeit.datum ? zeit.rest : titel;
    if (!name) { lokalAntworten("Die Aufgabe braucht einen Titel, z. B. „Neue Aufgabe Arzt anrufen morgen um 9“. Es wurde nichts angelegt."); return true; }
    window.aufgabenIntern.hinzufuegen(name, zeit && zeit.datum ? zeit.datum.toISOString() : "", "normal", "", true);
    lokalAntworten("Aufgabe angelegt: „" + name + "“" + (zeit && zeit.datum ? ", fällig " + zeit.beschreibung + (zeit.annahme ? " (" + zeit.annahme + ")" : "") : "") + ". Rückgängig: „Lösche Aufgabe " + name + "“ oder in der Aufgabenliste.");
    return true;
  },
});

skillRegistrieren({
  name: "aufgabe-loeschen",
  risiko: "bestaetigen",
  beschreibung: "Aufgabe löschen",
  beispiele: ["Lösche Aufgabe Arzt anrufen"],
  passt: (text) => /^(lösche|loesche|entferne)( die)? aufgabe .+|^aufgabe .+ (löschen|loeschen|entfernen)$/.test(befehlNormalisieren(text)),
  planen: async (text) => {
    const t = befehlNormalisieren(text);
    const suche = t.replace(/^(lösche|loesche|entferne)( die)? aufgabe /, "").replace(/^aufgabe /, "").replace(/ (löschen|loeschen|entfernen)$/, "").trim();
    const alle = window.aufgabenIntern ? window.aufgabenIntern.liste() : [];
    const genau = alle.filter((a) => a.titel.toLowerCase() === suche);
    const treffer = genau.length ? genau : alle.filter((a) => a.titel.toLowerCase().includes(suche));
    if (!treffer.length) return { fehler: "Keine Aufgabe „" + suche + "“ gefunden." };
    if (treffer.length > 1) return { fehler: "Mehrere Aufgaben passen (" + treffer.slice(0, 4).map((a) => "„" + a.titel + "“").join(", ") + ") – bitte genauer sagen." };
    const a = treffer[0];
    return {
      beschreibung: "Aufgabe „" + a.titel + "“" + (a.faellig ? " (fällig " + new Date(a.faellig).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + ")" : "") + " wird gelöscht.",
      ausfuehren: async () => { window.aufgabenIntern.loeschenDirekt(a.id); return "Aufgabe „" + a.titel + "“ gelöscht."; },
    };
  },
});

// ---------- Aktivierungswort über den PC-Helfer ----------
// Der Helfer erkennt „Jarvis“ lokal (Windows-Spracherkennung); das Dashboard fragt nur „gab es eine Aktivierung?“.
// Erst danach startet die normale Spracheingabe (Browser-Erkennungsdienst) – vorher verlässt kein Audio den PC.
const helferWort = { an: false, letzte: null, uhr: null };
// Abfrage jede Sekunde + Nachhall im Raum: so lange nach dem Vorlesen gilt ein „Jarvis“ noch als mögliche eigene Stimme
const HELFER_NACHHALL_MS = 2500;
function helferStatus(text) { document.getElementById("helfer-status").textContent = "PC-Helfer: " + text; }

async function helferPruefen() {
  if (!helferEingerichtet()) { helferStatus("nicht eingerichtet"); return null; }
  try {
    const s = await helferAnfrage("/status", { method: "GET" });
    helferStatus("verbunden (Version " + s.version + ")" + (s.attrappe ? " – Attrappe" : "") + " · Aktivierungswort: " + s.aktivierungswort);
    return s;
  } catch (e) {
    helferStatus(e.message);
    return null;
  }
}

async function aktivierungAbfragen() {
  if (!helferWort.an) return;
  try {
    const seit = helferWort.letzte ?? 0;
    const d = await helferAnfrage("/ereignisse?seit=" + seit, { method: "GET" });
    const erstesMal = helferWort.letzte === null;
    helferWort.letzte = Math.max(seit, Number(d.letzte) || 0);
    // Nur wirklich neue Aktivierungen; beim Einschalten keine alten nachholen
    const neu = (Array.isArray(d.ereignisse) ? d.ereignisse : []).filter((e) => e && e.nr > seit);
    // Während JARVIS vorliest (und kurz danach) kann der Helfer die eigene Stimme gehört haben („… JARVIS …“):
    // dann keine Aufnahme starten – sonst bricht die Antwort ab und die Ausgabe würde zur Eingabe.
    const eigeneStimme = document.getElementById("kern").classList.contains("spricht")
      || Date.now() - vorlesenHoerbarBis < HELFER_NACHHALL_MS;
    if (!erstesMal && neu.length && eigeneStimme) {
      helferStatus("Aktivierungswort während des Vorlesens ignoriert (könnte JARVIS’ eigene Stimme sein) – zum Unterbrechen „Vorlesen stoppen“ oder das Mikrofon tippen");
    } else if (!erstesMal && neu.length && window.spracheingabeStarten) {
      helferStatus("Aktivierungswort erkannt (" + new Date(neu[neu.length - 1].zeit).toLocaleTimeString("de-DE") + ") – ich höre zu");
      window.spracheingabeStarten();
    }
  } catch (e) {
    helferStatus(e.message);
  }
}

function aktivierungUmschalten(an) {
  helferWort.an = Boolean(an) && helferEingerichtet();
  einstellungSchreiben("jarvis-helfer-aktivierung", helferWort.an ? "an" : "aus");
  clearInterval(helferWort.uhr);
  helferWort.letzte = null;
  document.getElementById("helfer-aktivierung").checked = helferWort.an;
  if (helferWort.an) {
    aktivierungAbfragen();
    helferWort.uhr = setInterval(aktivierungAbfragen, 1000);
  }
}

document.getElementById("helfer-code").value = einstellungLesen("jarvis-helfer-code");
document.getElementById("helfer-code").addEventListener("change", (e) => {
  einstellungSchreiben("jarvis-helfer-code", e.target.value.trim());
  if (!e.target.value.trim()) aktivierungUmschalten(false);
  helferPruefen();
});
document.getElementById("helfer-pruefen").addEventListener("click", helferPruefen);
document.getElementById("helfer-aktivierung").addEventListener("change", (e) => aktivierungUmschalten(e.target.checked));
if (einstellungLesen("jarvis-helfer-aktivierung") === "an") aktivierungUmschalten(true);
else if (helferEingerichtet()) helferStatus("Kopplungscode gespeichert – „Helfer prüfen“ zum Verbinden");

// ---------- Handelsmodus: zeigt, ob Paper-Trading, Binance-Testnet oder kein Handel aktiv ist ----------
// paper: "bereit" | "fehlt" | "fehler" | null · testnet: "gesperrt" | "frei" | "fehler" | null (null = nicht verbunden)
const handelsmodus = { paper: null, testnet: null };

function handelsmodusSetzen(teil, wert) {
  handelsmodus[teil] = wert;
  const paper = handelsmodus.paper === "bereit";
  const testnet = handelsmodus.testnet === "frei";
  const kopf = paper && testnet ? "Aktiv: Paper-Trading (Simulation) und manuelles Binance-Testnet."
    : paper ? "Aktiv: Paper-Trading (Spielgeld-Simulation). Testnet-Orders sind gesperrt."
    : testnet ? "Aktiv: nur manuelles Binance-Testnet (Spielgeld im Testnet)."
    : "Kein Handel aktiv.";
  document.getElementById("handelsmodus-kopf").textContent = kopf;
  document.getElementById("modus-paper").textContent = "Paper-Trading (Simulation): " + ({
    bereit: "aktiv – simulierte Orders nur mit Spielgeld, keine Börse",
    fehlt: "im verbundenen Worker nicht enthalten",
    fehler: "derzeit nicht abrufbar",
  }[handelsmodus.paper] || "nicht verbunden");
  document.getElementById("modus-testnet").textContent = "Binance-Testnet: " + ({
    gesperrt: "gesperrt durch Not-Aus – möglich ist nur „Nur prüfen“",
    frei: "manuelle Orders möglich (Testnet-Spielgeld, Limits gelten)",
    fehler: "Status unbekannt",
  }[handelsmodus.testnet] || "nicht verbunden");
  statusZeileSetzen("handelsmodus-status",
    "● Handelsmodus: " + (paper && testnet ? "PAPER + TESTNET" : paper ? "PAPER-TRADING (SIMULATION)" : testnet ? "NUR TESTNET" : "KEIN HANDEL AKTIV"),
    paper || testnet ? "#7affc4" : "");
}

// ---------- Paper-Trading (reine Simulation im Worker, 10.000 USDT Spielgeld) ----------
function paperAnzeigen(s) {
  const usd = (w) => (w === null || w === undefined ? "–" : zahl(w, 2) + " USDT");
  const vorzeichen = (w) => (w > 0 ? "+" : "");
  document.getElementById("paper-uebersicht").textContent = [
    "Gesamtwert: " + usd(s.gesamtwert_usdt) + (s.gewinn_usdt === null ? "" : "  (" + vorzeichen(s.gewinn_usdt) + zahl(s.gewinn_usdt, 2)
      + " USDT · " + vorzeichen(s.gewinn_prozent) + zahl(s.gewinn_prozent, 2) + " % seit Start)"),
    "Verfügbares Spielgeld: " + usd(s.usdt) + " · Startkapital: " + usd(s.startkapital) + " · Gebühr: " + zahl(s.gebuehr_prozent, 2) + " %",
    s.hinweis || "",
  ].filter(Boolean).join("\n");
  tabelleFuellen("paper-positionen", s.positionen.length
    ? s.positionen.map((p) => [
      zelle(p.symbol),
      zelle(zahl(p.menge, 8), "zahl"),
      zelle(usd(p.wert_usdt), "zahl"),
      zelle(p.gewinn_usdt === null ? "–" : vorzeichen(p.gewinn_usdt) + zahl(p.gewinn_usdt, 2) + " USDT", "zahl " + (p.gewinn_usdt >= 0 ? "plus" : "minus")),
    ])
    : [[zelle("Keine simulierten Positionen.", "leer")]]);
  paperLetzterStand = s;
  journalAnzeigen();
}

// ---------- Paper-Journal: Filter, Summen, CSV (nur Simulationsdaten) ----------
// Der Worker liefert die letzten 20 simulierten Orders. Ergebnisse: offen = Summe (Wert − Einstand) der Positionen,
// realisiert = Gesamtergebnis seit Start − offen (enthält alle Gebühren) – beides direkt aus den Worker-Zahlen.
let paperLetzterStand = null;

function journalEintraege(jetzt = Date.now()) {
  if (!paperLetzterStand) return [];
  const symbol = document.getElementById("journal-symbol").value;
  const tage = Number(document.getElementById("journal-zeitraum").value);
  return paperLetzterStand.historie.filter((h) => (!symbol || h.symbol === symbol)
    && (!tage || jetzt - new Date(h.zeit).getTime() <= tage * 86400000));
}

function journalAnzeigen() {
  const s = paperLetzterStand;
  const liste = document.getElementById("paper-historie");
  const eintraege = journalEintraege();
  liste.replaceChildren(...(eintraege.length ? eintraege : [null]).map((h) => {
    const li = document.createElement("li");
    li.textContent = h
      ? new Date(h.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + " · " + (h.seite === "BUY" ? "Kauf " : "Verkauf ")
        + h.symbol + " · " + zahl(h.betrag_usdt, 2) + " USDT zu " + zahl(h.preis, 2) + " (Gebühr " + zahl(h.gebuehr_usdt, 2) + ", Kurs: " + h.quelle + ")"
      : s && s.historie.length ? "Keine simulierten Orders für diesen Filter." : "Noch keine simulierten Orders.";
    return li;
  }));
  const summe = document.getElementById("journal-summe");
  if (!s) { summe.textContent = ""; return; }
  const gebuehren = eintraege.reduce((x, h) => x + (Number(h.gebuehr_usdt) || 0), 0);
  const offenBekannt = s.positionen.every((p) => p.gewinn_usdt !== null);
  const offen = s.positionen.reduce((x, p) => x + (p.gewinn_usdt || 0), 0);
  const vz = (w) => (w > 0 ? "+" : "") + zahl(w, 2) + " USDT";
  summe.textContent = eintraege.length + " von " + s.historie.length + " angezeigten Orders · Gebühren (Filter): " + zahl(gebuehren, 2) + " USDT\n"
    + "Ergebnis seit Start: " + (s.gewinn_usdt === null || !offenBekannt ? "nicht verfügbar (Kurse fehlen)"
      : "realisiert " + vz(s.gewinn_usdt - offen) + " · offen " + vz(offen) + " · gesamt " + vz(s.gewinn_usdt))
    + (s.historie.length >= 20 ? "\nHinweis: Der Worker liefert nur die letzten 20 simulierten Orders." : "");
}

// CSV nur mit Paper-Daten (Semikolon, Dezimalkomma für deutsche Tabellenprogramme, BOM für Umlaute in Excel)
function journalCsv() {
  const zelle = (w) => { let s = String(w ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const dezimal = (x, st) => (Number.isFinite(Number(x)) ? Number(x).toFixed(st).replace(".", ",") : "");
  const zeilen = [["Zeit (ISO)", "Symbol", "Seite", "Menge", "Preis (USDT)", "Betrag (USDT)", "Gebühr (USDT)", "Kursquelle"].join(";")];
  for (const h of journalEintraege()) {
    zeilen.push([h.zeit, h.symbol, h.seite === "BUY" ? "Kauf" : "Verkauf", dezimal(h.menge, 8), dezimal(h.preis, 2), dezimal(h.betrag_usdt, 2), dezimal(h.gebuehr_usdt, 4), h.quelle].map(zelle).join(";"));
  }
  return String.fromCharCode(0xfeff) + zeilen.join("\r\n") + "\r\n";
}

function journalExportieren() {
  if (!paperLetzterStand) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([journalCsv()], { type: "text/csv;charset=utf-8" }));
  link.download = "jarvis-paper-journal-" + new Date().toISOString().slice(0, 10) + ".csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

document.getElementById("journal-symbol").addEventListener("change", journalAnzeigen);
document.getElementById("journal-zeitraum").addEventListener("change", journalAnzeigen);
document.getElementById("journal-csv").addEventListener("click", journalExportieren);


function paperFunktion(text, klasse) {
  const feld = document.getElementById("paper-funktion");
  feld.textContent = text;
  feld.className = klasse;
}

async function paperLaden() {
  if (!verbunden()) {
    paperFunktion("noch nicht verbunden", "aus");
    return;
  }
  try {
    const s = await workerAnfrage("/paper/status", { method: "GET" });
    paperAnzeigen(s);
    paperFunktion("Simulation bereit", "ok");
    paperKnoepfeSperren(false);
    handelsmodusSetzen("paper", "bereit");
  } catch (e) {
    // Ein älterer Worker ohne /paper-Routen antwortet mit 404
    const fehlt = e.message === "Unbekannter Endpunkt.";
    document.getElementById("paper-uebersicht").textContent = fehlt
      ? "Paper-Trading ist im verbundenen Worker noch nicht enthalten (keine /paper-Routen). "
        + "Die Simulation funktioniert erst mit einem Worker-Stand, der /paper enthält."
      : "Paper-Trading nicht abrufbar: " + e.message;
    paperFunktion(fehlt ? "nicht im Worker" : "nicht verfügbar", "aus");
    paperKnoepfeSperren(fehlt);
    handelsmodusSetzen("paper", fehlt ? "fehlt" : "fehler");
  }
}

function paperKnoepfeSperren(gesperrt) {
  for (const id of ["paper-senden", "paper-alles", "paper-reset"]) {
    document.getElementById(id).disabled = gesperrt;
  }
}

async function paperOrderSenden(alles) {
  if (!verbunden()) return;
  const ergebnis = document.getElementById("paper-ergebnis");
  const symbol = document.getElementById("paper-symbol").value;
  const seite = alles ? "SELL" : document.getElementById("paper-seite").value;
  const betrag = Number(document.getElementById("paper-betrag").value);
  // Beide Order-Knöpfe sperren, damit ein Doppelklick keine zweite Simulation auslöst
  const knoepfe = ["paper-senden", "paper-alles"].map((id) => document.getElementById(id));
  if (knoepfe.some((k) => k.disabled)) return;
  knoepfe.forEach((k) => { k.disabled = true; });
  ergebnis.style.color = "";
  ergebnis.textContent = "Simuliere …";
  try {
    const d = await workerAnfrage("/paper/order", {
      method: "POST",
      body: JSON.stringify(alles ? { symbol, seite, alles: true } : { symbol, seite, betrag_usdt: betrag }),
    });
    const a = d.ausfuehrung;
    ergebnis.style.color = "#7affc4";
    ergebnis.textContent = "✔ Simuliert: " + (a.seite === "BUY" ? "Kauf " : "Verkauf ") + zahl(a.menge, 8) + " " + a.symbol.replace(/USDT$/, "")
      + " für " + zahl(a.betrag_usdt, 2) + " USDT zu " + zahl(a.preis, 2) + " (Gebühr " + zahl(a.gebuehr_usdt, 2) + " USDT).";
    paperAnzeigen(d.stand);
  } catch (e) {
    ergebnis.style.color = "#ff9b9b";
    // Wie beim Sprachbefehl: ohne Antwort ist offen, ob die Simulation gespeichert wurde
    ergebnis.textContent = e.netzwerk && !e.nichtGesendet
      ? "✖ Keine Antwort vom Worker – ob die Simulation gespeichert wurde, ist unklar. Bitte den Paper-Stand prüfen (Aktualisieren) und nicht erneut senden."
      : "✖ " + e.message;
  } finally {
    knoepfe.forEach((k) => { k.disabled = false; });
  }
}

async function paperZuruecksetzen() {
  if (!verbunden()) return;
  if (!confirm("Simulation wirklich auf 10.000 USDT Spielgeld zurücksetzen?\nPositionen und Verlauf der Simulation gehen verloren.")) return;
  const ergebnis = document.getElementById("paper-ergebnis");
  try {
    const d = await workerAnfrage("/paper/zuruecksetzen", { method: "POST", body: JSON.stringify({ bestaetigt: true }) });
    ergebnis.style.color = "#7affc4";
    ergebnis.textContent = "✔ Simulation zurückgesetzt.";
    paperAnzeigen(d.stand);
  } catch (e) {
    ergebnis.style.color = "#ff9b9b";
    ergebnis.textContent = "✖ " + e.message;
  }
}

document.getElementById("paper-senden").addEventListener("click", () => paperOrderSenden(false));
document.getElementById("paper-alles").addEventListener("click", () => paperOrderSenden(true));


;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("trading-skills");
