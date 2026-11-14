// JARVIS Dashboard – Modul „sprache“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Sprachbedienung ----------
// Sprache dient ausschließlich der Texteingabe für den Chat: Erkannter Text wird nach normalem Ende der Aufnahme
// als Chat-Nachricht gesendet; nach Abbruch bleibt er zur Prüfung in der Vorschau. Einzige Sprachbefehle sind die Paper-Befehle
// (Spielgeld-Simulation, nur nach ausdrücklichem „Ja“, siehe paperSprachbefehl) – kein Not-Aus, keine Testnet-Orders,
// keine Einstellungen per Sprache. Das Mikrofon startet nur per Klick, Druck oder gehaltener Leertaste.

// quelle: "google" = Google-Stimme über den Worker (Standard), Browserstimme nur als Ersatz; "browser" = immer Browserstimme.
// stimme: gewählte Browserstimme (voiceURI) oder "" = automatisch beste deutsche Stimme (auch Ersatz bei „google“).
// Einheitliche Spracheinstellung: Erkennung (Mikrofon) und Ausgabe (Vorlesen) an einer Stelle. JARVIS antwortet deutsch,
// deshalb gibt es als Ausgabe nur deutsche Varianten; englische Erkennung ist für englische Fragen an die KI gedacht.
const SPRACHEN = {
  erkennung: { "de-DE": "Deutsch (Deutschland)", "de-AT": "Deutsch (Österreich)", "de-CH": "Deutsch (Schweiz)", "en-GB": "Englisch (UK)", "en-US": "Englisch (USA)" },
  ausgabe: { "de-DE": "Deutsch (Deutschland)", "de-AT": "Deutsch (Österreich)", "de-CH": "Deutsch (Schweiz)" },
};
const sprache = {
  vorlesen: einstellungLesen("jarvis-vorlesen") !== "aus",
  stimme: einstellungLesen("jarvis-stimme"),
  quelle: einstellungLesen("jarvis-stimme-quelle") === "browser" ? "browser" : "google",
  erkennung: SPRACHEN.erkennung[einstellungLesen("jarvis-sprache-erkennung")] ? einstellungLesen("jarvis-sprache-erkennung") : "de-DE",
  ausgabe: SPRACHEN.ausgabe[einstellungLesen("jarvis-sprache-ausgabe")] ? einstellungLesen("jarvis-sprache-ausgabe") : "de-DE",
};
// Gespeicherte Spracheinstellungen prüfen (ab 11-02b): ein ungültiger Wert (z. B. von Hand geändert oder beschädigt) wird nicht still
// umgedeutet, sondern gemeldet; wirksam ist bis zur Korrektur der genannte Standard. Zurücksetzen löscht nur genau diesen Wert.
const EINSTELLUNG_REGELN = [
  { name: "jarvis-vorlesen", titel: "Vorlesen", erlaubt: ["an", "aus"], standard: "an" },
  { name: "jarvis-stimme-quelle", titel: "Stimmenquelle", erlaubt: ["google", "browser"], standard: "Google-Stimme (Browserstimme als Ersatz)" },
  { name: "jarvis-sprache-erkennung", titel: "Erkennung", erlaubt: Object.keys(SPRACHEN.erkennung), standard: "Deutsch (Deutschland)" },
  { name: "jarvis-sprache-ausgabe", titel: "Ausgabe", erlaubt: Object.keys(SPRACHEN.ausgabe), standard: "Deutsch (Deutschland)" },
];
function einstellungenPruefen() {
  return EINSTELLUNG_REGELN.filter((r) => { const w = einstellungLesen(r.name); return w !== "" && !r.erlaubt.includes(w); });
}
function einstellungFehlerZeigen() {
  const box = document.getElementById("einstellung-fehler");
  if (!box) return;
  const falsch = einstellungenPruefen();
  box.hidden = !falsch.length;
  box.replaceChildren(...falsch.map((r) => {
    const zeile = document.createElement("p");
    zeile.textContent = `Gespeicherte Einstellung „${r.titel}“ ist ungültig – es gilt der Standard: ${r.standard}. `;
    const knopf = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", textContent: "Auf Standard zurücksetzen" });
    knopf.setAttribute("aria-label", `Einstellung ${r.titel} auf Standard zurücksetzen`);
    knopf.addEventListener("click", () => {
      try { localStorage.removeItem(r.name); } catch (e) { /* gesperrt: bleibt gemeldet */ }
      einstellungFehlerZeigen();
      const s = document.getElementById("sprach-hinweis");
      if (s) s.textContent = `Einstellung „${r.titel}“ auf Standard zurückgesetzt.`;
    });
    zeile.append(knopf);
    return zeile;
  }));
}
// Jede neue Ansage und jeder Stopp erhöht die Nummer: Teile einer älteren Ansage verstummen dann sofort
let ansageNummer = 0;
let ansageTimer = null;
let laufendeTeile = []; // Verweise halten: manche Browser verlieren sonst das Ende-Ereignis langer Ansagen
const VORLESE_TEIL_MAX = 180;

function deutscheStimmen() {
  if (!("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices().filter((v) => (v.lang || "").toLowerCase().startsWith("de"));
}

// Browserstimme für die Live-Ausgabe: die gespeicherte Wahl, sonst automatisch die beste deutsche Stimme
// (natürliche/Online-Stimmen vor lokalen, de-DE vor de-AT/de-CH). Früher wurde ohne gespeicherte Wahl gar keine
// Stimme gesetzt – dann sprach die Standardstimme des Browsers (die „alte“ Stimme).
// Bekannte männliche deutsche Stimmen der Browser/Betriebssysteme (nur zur Kennzeichnung und Bevorzugung –
// angeboten werden ausschließlich Stimmen, die der Browser tatsächlich meldet). JARVIS spricht als Butler.
const MAENNLICHE_STIMMEN = /\b(conrad|killian|florian|bernd|christoph|kasper|klaus|ralf|stefan|jonas|jan)\b/i;
function stimmeMaennlich(v) { return MAENNLICHE_STIMMEN.test(v.name || ""); }

function browserStimmeWaehlen() {
  const stimmen = deutscheStimmen();
  const gespeichert = sprache.stimme ? stimmen.find((v) => v.voiceURI === sprache.stimme) : null;
  if (gespeichert) return { stimme: gespeichert, ersatz: false };
  const punkte = (v) => (/natural|neural|online/i.test(v.name) ? 4 : 0) + (stimmeMaennlich(v) ? 3 : 0) + (/google/i.test(v.name) ? 2 : 0)
    + (v.localService === false ? 1 : 0) + ((v.lang || "").toLowerCase() === sprache.ausgabe.toLowerCase() ? 1 : 0);
  const beste = stimmen.slice().sort((a, b) => punkte(b) - punkte(a))[0] || null;
  return { stimme: beste, ersatz: Boolean(sprache.stimme) };
}

// Welche Stimme zuletzt gesprochen hat (Anzeige unter „Funktionen“)
let stimmeZuletzt = "";
function stimmeMelden(text) {
  stimmeZuletzt = text;
  if (window.vorlesenStatusAnzeigen) window.vorlesenStatusAnzeigen();
}

// Zeitpunkt, zu dem JARVIS zuletzt hörbar vorgelesen hat (das Aktivierungswort ignoriert die eigene Stimme samt Nachhall)
let vorlesenHoerbarBis = 0;

// Kern und Stopp-Knopf folgen dem tatsächlichen Zustand der Wiedergabe
function vorlesenAnzeigen(laeuft) {
  const kern = document.getElementById("kern");
  if (laeuft || kern.classList.contains("spricht")) vorlesenHoerbarBis = Date.now();
  kern.classList.toggle("spricht", laeuft);
  const stopp = document.getElementById("vorlesen-stopp");
  // Wer per Tastatur stoppt, verliert sonst den Fokus (der Knopf sperrt sich selbst) – Fokus bleibt in der Sprachleiste
  if (!laeuft && document.activeElement === stopp) document.getElementById("vorlesen-schalter").focus();
  stopp.disabled = !laeuft;
  if (typeof abVorleseAnzeigen === "function") abVorleseAnzeigen(laeuft); // Briefing-Vorlesestatus synchron halten
}

// Während Google eine Ansage noch erzeugt: „Vorlesen stoppen“ schon bedienbar (Kern zeigt noch kein Sprechen).
// Ein Stopp erhöht die Ansagenummer – das später eintreffende Audio wird verworfen, ohne Ausweichen auf die Browserstimme.
function vorlesenWartet() { document.getElementById("vorlesen-stopp").disabled = false; }

function vorlesenStoppen() {
  ansageNummer++;
  clearTimeout(ansageTimer);
  laufendeTeile = [];
  if (aktuellesAudio) {
    aktuellesAudio.pause();
    aktuellesAudio = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  vorlesenAnzeigen(false);
}

// ---------- Google-Stimme (Audio vom Worker) ----------
let aktuellesAudio = null;

// Antwort vorlesen: bevorzugt das Audio des Workers (Google TTS), sonst die Browserstimme.
// Ein gemeldeter TTS-Fehler wird sichtbar angezeigt, statt stillschweigend auszuweichen.
function antwortVorlesen(daten) {
  if (!sprache.vorlesen || !daten) return;
  // ab 11-07d: Umfang „kurz“ und lange Antwort → die Kurzfassung vorlesen (mitgeliefertes Google-Audio enthält die ganze Antwort)
  if (typeof vorleseKurzfassung === "function" && vorleseKurzfassung(daten.antwort) !== String(daten.antwort || "").trim()) {
    if (sprache.quelle === "browser") jarvisSprechen(vorleseKurzfassung(daten.antwort)); else lokalVorlesen(daten.antwort);
    return;
  }
  // Browserstimme ausdrücklich gewählt: mitgeliefertes Google-Audio nicht abspielen
  if (sprache.quelle === "browser") { jarvisSprechen(daten.antwort); return; }
  if (daten.tts_fehler) ttsHinweis("Google-Stimme nicht verfügbar (" + daten.tts_fehler + ") – es spricht die Browserstimme.");
  if (daten.audioContent && !audioGueltig(daten.audioContent)) {
    ttsHinweis("Google-Audio vom Worker ist ungültig – es spricht die Browserstimme.");
    jarvisSprechen(daten.antwort);
  } else if (daten.audioContent) googleAudioAbspielen(daten.audioContent, daten.antwort);
  else if (daten.tts_fehler) jarvisSprechen(daten.antwort);
  else lokalVorlesen(daten.antwort); // Antwort ohne Audio und ohne Fehler (z. B. Ablehnung): Google-Stimme nachfordern
}

// Lokale Antworten (Paper-Befehle, Offline, Antworten ohne Audio) mit derselben Google-Stimme wie Chat-Antworten:
// Audio über POST /sprechen, sonst Browserstimme mit sichtbarem Hinweis. Ein Worker ohne /sprechen (404) wird
// gemerkt, damit nicht jede Antwort erneut fragt. erzwingen: auch bei „Vorlesen: aus“ (Paper-Rückfragen).
let sprechenVerfuegbar = true;
// Höchstlänge wie im Worker; Zeitlimit etwas über dem Google-Zeitlimit des Workers (20 s)
// Längere Texte (z. B. „Hilfe“, Briefing) gehen in Teilen zu je höchstens 600 Zeichen an /sprechen und werden
// nacheinander abgespielt (der nächste Teil wird schon während der Wiedergabe geholt) – früher sprach dann still die
// Browserstimme. Mehr als maxTeile Teile: Browserstimme mit sichtbarem Hinweis.
const SPRECHEN = { max: 600, maxTeile: 8, timeoutMs: 25000 };
// Worker ohne /sprechen: einmal sichtbar sagen, warum lokale Antworten mit der Browserstimme kommen (vorher still)
// Steht im Hinweisfeld der Sprachleiste – die Statuszeile bleibt für „Erkannter Text wurde gesendet: …“ frei.
function sprechenFehltMelden() {
  sprechenVerfuegbar = false;
  const text = "Der Worker kennt /sprechen noch nicht (Worker-Patch nicht übernommen) – lokale Antworten spricht die Browserstimme; KI-Antworten bleiben bei der Google-Stimme.";
  console.warn("JARVIS Sprachausgabe: " + text);
  const feld = document.getElementById("sprach-hinweis");
  if (feld && !feld.textContent.includes("/sprechen")) feld.textContent = text + " " + feld.textContent;
}
async function sprechenHolen(teil) {
  try {
    const zeitlimit = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(SPRECHEN.timeoutMs) : undefined;
    const daten = await workerAnfrage("/sprechen", { method: "POST", body: JSON.stringify({ text: teil }), signal: zeitlimit });
    if (audioGueltig(daten.audioContent) && window.kiNutzungErfassen) window.kiNutzungErfassen({ art: "sprechen", vorleseZeichen: teil.length });
    return { daten };
  } catch (e) {
    return { grund: e && (e.zeitlimit || e.name === "TimeoutError" || e.name === "AbortError") ? "Zeitüberschreitung nach " + Math.round(SPRECHEN.timeoutMs / 1000) + " s" : e.message };
  }
}
// Spielt einen Teil ab; true = zu Ende gespielt, false = Fehler oder abgebrochen
function googleTeilAbspielen(base64, nummer) {
  return new Promise((fertig) => {
    const audio = new Audio("data:" + audioTyp(base64) + ";base64," + base64);
    aktuellesAudio = audio;
    audio.onplaying = () => { if (nummer === ansageNummer) { vorlesenAnzeigen(true); stimmeMelden("Google-Stimme"); } };
    audio.onended = () => fertig(nummer === ansageNummer);
    audio.onerror = () => fertig(false);
    audio.onpause = () => { if (nummer !== ansageNummer) fertig(false); };
    const start = audio.play();
    if (start && typeof start.catch === "function") start.catch(() => fertig(false));
  });
}
async function googleTeileVorlesen(teile, text, erzwingen) {
  vorlesenStoppen();
  const nummer = ansageNummer;
  vorlesenWartet();
  let naechster = sprechenHolen(teile[0]);
  for (let i = 0; i < teile.length; i++) {
    const r = await naechster;
    if (i + 1 < teile.length) naechster = sprechenHolen(teile[i + 1]);
    if (nummer !== ansageNummer) return; // gestoppt oder von einer neueren Ansage überholt
    if (window.spracheingabeLaeuft && window.spracheingabeLaeuft()) { vorlesenAnzeigen(false); return; }
    const rest = teile.slice(i).join(" ");
    if (!(r.daten && audioGueltig(r.daten.audioContent))) {
      if (r.grund === "Unbekannter Endpunkt.") sprechenFehltMelden();
      else ttsHinweis("Google-Stimme nicht verfügbar (" + ((r.daten && r.daten.tts_fehler) || r.grund || "kein gültiges Audio") + ") – den Rest spricht die Browserstimme.");
      jarvisSprechen(rest, erzwingen ? {} : undefined);
      return;
    }
    if (window.spracheingabeLaeuft && window.spracheingabeLaeuft()) window.spracheingabeBeenden("vorlesen");
    const ok = await googleTeilAbspielen(r.daten.audioContent, nummer);
    if (nummer !== ansageNummer) return;
    if (!ok) {
      aktuellesAudio = null;
      ttsHinweis("Google-Audio konnte nicht abgespielt werden – den Rest spricht die Browserstimme.");
      jarvisSprechen(rest, erzwingen ? {} : undefined);
      return;
    }
  }
  aktuellesAudio = null;
  vorlesenAnzeigen(false);
}
// Langer Text mit kurzem erstem Teil: Google erzeugt das Audio eines Teils am Stück, ein kurzer Anfang klingt also früher.
// Nur wenn dadurch NICHT mehr Teile (= Google-Aufrufe) entstehen als bei der normalen Teilung; sonst normale Teilung.
const SPRECHEN_ANFANG = { max: 220 };
function teileMitKurzemAnfang(kurz) {
  const normal = vorleseTeile(kurz, SPRECHEN.max);
  const erster = vorleseTeile(kurz, SPRECHEN_ANFANG.max)[0];
  if (!erster || !kurz.startsWith(erster) || erster.length >= kurz.length) return normal;
  const rest = vorleseTeile(kurz.slice(erster.length).trim(), SPRECHEN.max);
  return 1 + rest.length <= normal.length ? [erster, ...rest] : normal;
}

// optionen.kurzerAnfang: bei langen Texten zuerst einen kurzen Teil (siehe teileMitKurzemAnfang)
async function lokalVorlesen(text, erzwingen, optionen = {}) {
  if (!text || (!sprache.vorlesen && !erzwingen)) return;
  // ab 11-07d: Vorlese-Umfang „kurz“ – erzwungene Ansagen (Paper-Rückfragen) bleiben vollständig
  if (!erzwingen && typeof vorleseKurzfassung === "function") text = vorleseKurzfassung(text);
  const browser = () => jarvisSprechen(text, erzwingen ? {} : undefined);
  const kurz = vorleseText(text);
  if (sprache.quelle === "browser" || !verbunden() || !sprechenVerfuegbar || !kurz) { browser(); return; }
  if (kurz.length > SPRECHEN.max) {
    let teile = optionen.kurzerAnfang ? teileMitKurzemAnfang(kurz) : vorleseTeile(kurz, SPRECHEN.max);
    // ab 11-13f: zu viele Teile → erst dichter packen, dann Browserstimme (die Hilfe kippte schon bei +14 Zeichen von 8 auf 9 Teile)
    if (teile.length > SPRECHEN.maxTeile) teile = vorleseTeileDicht(kurz, SPRECHEN.max);
    if (teile.length > SPRECHEN.maxTeile) { ttsHinweis("Text zu lang für die Google-Stimme (" + teile.length + " Teile) – es spricht die Browserstimme."); browser(); return; }
    return googleTeileVorlesen(teile, text, erzwingen);
  }
  vorlesenStoppen(); // eine ältere Ansage verstummt sofort; eine neuere lokale Antwort überholt diese hier
  const nummer = ansageNummer;
  vorlesenWartet();
  let daten = null;
  let grund = null;
  try {
    const zeitlimit = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(SPRECHEN.timeoutMs) : undefined;
    daten = await workerAnfrage("/sprechen", { method: "POST", body: JSON.stringify({ text: kurz }), signal: zeitlimit });
  } catch (e) {
    grund = e && (e.zeitlimit || e.name === "TimeoutError" || e.name === "AbortError") ? "Zeitüberschreitung nach " + Math.round(SPRECHEN.timeoutMs / 1000) + " s" : e.message;
    if (grund === "Unbekannter Endpunkt.") sprechenFehltMelden();
  }
  // Erzeugtes Audio zählt zur Nutzung, auch wenn es inzwischen überholt wurde (der Dienst hat es berechnet)
  if (daten && audioGueltig(daten.audioContent) && window.kiNutzungErfassen) window.kiNutzungErfassen({ art: "sprechen", vorleseZeichen: kurz.length });
  if (nummer !== ansageNummer) return; // inzwischen neue Ansage oder Stopp
  // Läuft inzwischen eine Aufnahme (z. B. Push-to-talk für „Ja“), nicht dazwischen sprechen
  if (window.spracheingabeLaeuft && window.spracheingabeLaeuft()) { vorlesenAnzeigen(false); return; }
  if (daten && audioGueltig(daten.audioContent)) { googleAudioAbspielen(daten.audioContent, text, erzwingen); return; }
  if (daten && daten.tts_fehler) ttsHinweis("Google-Stimme nicht verfügbar (" + daten.tts_fehler + ") – es spricht die Browserstimme.");
  else if (daten) ttsHinweis("Google-Stimme lieferte kein gültiges Audio – es spricht die Browserstimme.");
  else if (grund && sprechenVerfuegbar) ttsHinweis("Google-Stimme nicht abrufbar (" + grund + ") – es spricht die Browserstimme.");
  vorlesenAnzeigen(false); // Wartezustand beenden; die Browserstimme setzt ihn beim Start selbst wieder
  browser();
}

// Plausibles Base64-Audio vom Worker? (Typ und Zeichenvorrat am Anfang; der Rest prüft der Browser beim Abspielen)
function audioGueltig(wert) {
  return typeof wert === "string" && wert.length >= 8 && /^[A-Za-z0-9+/]+=*$/.test(wert.slice(0, 64));
}

function ttsHinweis(text) {
  console.warn("JARVIS Sprachausgabe: " + text);
  const status = document.getElementById("sprach-status");
  status.textContent = text;
  status.dataset.art = "fehler";
}

// Format am Anfang der Base64-Daten erkennen (LINEAR16 liefert WAV mit „RIFF“-Kopf)
function audioTyp(base64) {
  if (base64.startsWith("UklGR")) return "audio/wav";
  if (base64.startsWith("SUQz") || base64.startsWith("//")) return "audio/mpeg";
  if (base64.startsWith("T2dnUw")) return "audio/ogg";
  return "audio/wav";
}

function googleAudioAbspielen(base64, ersatzText, erzwingen) {
  if (window.spracheingabeLaeuft && window.spracheingabeLaeuft()) window.spracheingabeBeenden("vorlesen");
  vorlesenStoppen();
  const nummer = ansageNummer;
  const audio = new Audio("data:" + audioTyp(base64) + ";base64," + base64);
  aktuellesAudio = audio;
  const ausweichen = (grund) => {
    if (nummer !== ansageNummer) return;
    aktuellesAudio = null;
    ttsHinweis("Google-Audio konnte nicht abgespielt werden (" + grund + ") – es spricht die Browserstimme.");
    jarvisSprechen(ersatzText, erzwingen ? {} : undefined);
  };
  audio.onplaying = () => {
    if (nummer !== ansageNummer) return;
    vorlesenAnzeigen(true);
    stimmeMelden("Google-Stimme");
  };
  audio.onended = () => {
    if (nummer !== ansageNummer) return;
    aktuellesAudio = null;
    vorlesenAnzeigen(false);
  };
  audio.onerror = () => ausweichen("Audioformat");
  const start = audio.play();
  if (start && typeof start.catch === "function") start.catch((e) => ausweichen((e && e.name) || "Wiedergabe blockiert"));
}

// Text für die Sprachausgabe aufbereiten: Formatierungszeichen, Links und Symbole führen sonst zu Aussetzern
function vorleseText(text) {
  // ab 11-07d: Aussprache von Beträgen, Prozent, Kennzahlen und Pausen (app/26-sprachausgabe.js), vor dem Zusammenziehen der Leerzeichen
  return String(typeof vorleseAussprache === "function" ? vorleseAussprache(text) : text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, "Link")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/[*_`#>~|]+/g, " ")
    .replace(/\s+[–—]\s+/g, ", ")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

// In kurze Teile zerlegen: satzweise, lange Sätze an Kommas, notfalls an Wortgrenzen.
// Lange Einzelansagen stocken oder brechen bei manchen Browserstimmen ab.
function vorleseTeile(text, max = VORLESE_TEIL_MAX) {
  const teile = [];
  let aktuell = "";
  const anhaengen = (stueck) => {
    if (!stueck) return;
    if (!aktuell) aktuell = stueck;
    else if (aktuell.length + 1 + stueck.length <= max) aktuell += " " + stueck;
    else { teile.push(aktuell); aktuell = stueck; }
  };
  for (const satz of text.split(/(?<=[.!?])\s+/)) {
    if (satz.length <= max) { anhaengen(satz); continue; }
    for (const stueck of satz.split(/(?<=[,;:])\s+/)) {
      let rest = stueck;
      while (rest.length > max) {
        let schnitt = rest.lastIndexOf(" ", max);
        if (schnitt < max / 2) schnitt = max;
        anhaengen(rest.slice(0, schnitt).trim());
        rest = rest.slice(schnitt).trim();
      }
      anhaengen(rest);
    }
  }
  if (aktuell) teile.push(aktuell);
  return teile;
}
// ab 11-13f: dichtere Teilung nur für den Fall „zu viele Teile“: Sätze werden an Satzzeichen (auch Kommas) geteilt, damit ein
// langer Satz den laufenden Teil auffüllt, statt einen neuen zu beginnen. Normale Ansagen behalten die satzweise Teilung.
function vorleseTeileDicht(text, max = VORLESE_TEIL_MAX) {
  const teile = [];
  let aktuell = "";
  for (const stueck of String(text).split(/(?<=[.!?,;:])\s+/)) {
    for (const s of stueck.length > max ? vorleseTeile(stueck, max) : [stueck]) {
      if (!s) continue;
      if (!aktuell) aktuell = s;
      else if (aktuell.length + 1 + s.length <= max) aktuell += " " + s;
      else { teile.push(aktuell); aktuell = s; }
    }
  }
  if (aktuell) teile.push(aktuell);
  return teile;
}

// beobachter (nur Stimmtest): { start(i), ende(i), fertig(), fehler(e) } – misst die echte Wiedergabe;
// mit beobachter wird auch bei „Vorlesen: aus“ gesprochen, weil der Test ausdrücklich angefordert wurde.
function jarvisSprechen(text, beobachter) {
  if (!("speechSynthesis" in window) || (!sprache.vorlesen && !beobachter)) return;
  const melden = (art, wert) => { if (beobachter && beobachter[art]) beobachter[art](wert); };
  // Nur der Stimmtest darf eine eigene Teststimme/-sprache mitgeben; die Live-Ausgabe nutzt immer die Einstellung
  const testStimme = beobachter && "stimme" in beobachter;
  const teile = vorleseTeile(vorleseText(text || ""));
  if (!teile.length) return;
  // Keine Aufnahme während des Vorlesens: eine laufende Aufnahme endet, erkannter Text bleibt erhalten
  if (window.spracheingabeLaeuft && window.spracheingabeLaeuft()) window.spracheingabeBeenden("vorlesen");
  const synth = window.speechSynthesis;
  // Nie zwei Wiedergaben: laufende Ansage beenden. Direkt nach cancel() gestartete Ansagen werden in Chrome/Edge
  // teils angeschnitten – deshalb dann ein kurzer Abstand vor dem Neustart.
  const lief = Boolean(synth.speaking || synth.pending);
  vorlesenStoppen();
  const nummer = ansageNummer;
  // Live-Ausgabe: Stimme erst beim ersten Teil wählen – Stimmen werden in Chrome/Edge oft erst nachträglich geladen
  let stimme = testStimme ? beobachter.stimme : null;
  const standardSprache = (testStimme && beobachter.sprache) || sprache.ausgabe;
  let index = 0;
  const stimmeFestlegen = () => {
    if (testStimme) return;
    const wahl = browserStimmeWaehlen();
    stimme = wahl.stimme;
    if (wahl.ersatz && !stimmeErsatzGemeldet) {
      stimmeErsatzGemeldet = true;
      ttsHinweis("Die gewählte Browserstimme ist auf diesem Gerät nicht verfügbar – es spricht "
        + (stimme ? "„" + stimme.name + "“" : "die Standardstimme des Browsers") + ".");
    }
    const ersatzFuerGoogle = sprache.quelle === "google" ? "Ersatz für Google – " : "";
    stimmeMelden(ersatzFuerGoogle + (stimme ? "Browserstimme: " + stimme.name : "Browser-Standardstimme"));
  };

  // Teile nacheinander sprechen: der nächste erst, wenn der vorige wirklich fertig ist
  const naechsterTeil = () => {
    if (nummer !== ansageNummer) return;
    if (index >= teile.length) {
      laufendeTeile = [];
      vorlesenAnzeigen(false);
      melden("fertig");
      return;
    }
    if (index === 0) stimmeFestlegen();
    const nr = index;
    const ansage = new SpeechSynthesisUtterance(teile[index++]);
    ansage.lang = standardSprache;
    // Natürliche (neuronale) Stimmen klingen mit veränderter Tonhöhe/Geschwindigkeit oft holprig
    ansage.rate = 1;
    ansage.pitch = 1;
    if (stimme) {
      ansage.voice = stimme;
      ansage.lang = stimme.lang;
    }
    let erledigt = false;
    ansage.onstart = () => {
      if (nummer !== ansageNummer) return;
      vorlesenAnzeigen(true);
      melden("start", nr);
    };
    ansage.onend = () => {
      if (erledigt) return;
      erledigt = true;
      if (nummer === ansageNummer) melden("ende", nr);
      naechsterTeil();
    };
    ansage.onerror = (e) => {
      if (erledigt || nummer !== ansageNummer) return;
      erledigt = true;
      // Echter Fehler: Ansage beenden statt mit dem nächsten Teil holprig weiterzumachen
      if (!e || (e.error !== "interrupted" && e.error !== "canceled")) {
        melden("fehler", e);
        vorlesenStoppen();
      }
    };
    laufendeTeile.push(ansage);
    if (synth.paused) synth.resume();
    synth.speak(ansage);
  };
  // Noch keine Stimmen geladen: kurz auf „voiceschanged“ warten (höchstens STIMMEN_WARTEN_MS), dann trotzdem sprechen
  if (!testStimme && !synth.getVoices().length && typeof synth.addEventListener === "function") {
    let gestartet = false;
    const los = () => {
      if (gestartet) return;
      gestartet = true;
      if (typeof synth.removeEventListener === "function") synth.removeEventListener("voiceschanged", los);
      clearTimeout(ansageTimer);
      naechsterTeil();
    };
    synth.addEventListener("voiceschanged", los);
    ansageTimer = setTimeout(los, STIMMEN_WARTEN_MS);
    return;
  }
  ansageTimer = setTimeout(naechsterTeil, lief ? 120 : 0);
}
let stimmeErsatzGemeldet = false;
const STIMMEN_WARTEN_MS = 800;

// Vorlesen ein/aus, Stopp und Stimmenwahl
(function () {
  const schalter = document.getElementById("vorlesen-schalter");
  const stopp = document.getElementById("vorlesen-stopp");
  const wahl = document.getElementById("stimme-wahl");
  const status = document.getElementById("vorlesen-status");
  const vorhanden = "speechSynthesis" in window;

  function anzeigen() {
    schalter.setAttribute("aria-pressed", String(vorhanden && sprache.vorlesen));
    schalter.textContent = "Vorlesen: " + (vorhanden && sprache.vorlesen ? "an" : "aus");
    status.textContent = !vorhanden ? "nicht unterstützt" : sprache.vorlesen ? "an" + (stimmeZuletzt ? " (" + stimmeZuletzt + ")" : "") : "ausgeschaltet";
    status.className = vorhanden && sprache.vorlesen ? "ok" : "aus";
  }

  function stimmenFuellen() {
    const stimmen = deutscheStimmen();
    const optionen = [
      new Option("Google-Stimme „Sadaltager“ (über den Worker, empfohlen)", "google"),
      new Option(stimmen.length ? "Browser: automatisch (beste deutsche Stimme)" : "Browser: keine deutsche Stimme gefunden", ""),
    ];
    for (const v of stimmen) optionen.push(new Option("Browser: " + v.name + " (" + v.lang + ")" + (stimmeMaennlich(v) ? " · männlich" : ""), v.voiceURI));
    wahl.replaceChildren(...optionen);
    wahl.value = sprache.quelle === "google" ? "google" : stimmen.some((v) => v.voiceURI === sprache.stimme) ? sprache.stimme : "";
    spracheHinweisen();
  }

  schalter.addEventListener("click", () => {
    sprache.vorlesen = !sprache.vorlesen;
    einstellungSchreiben("jarvis-vorlesen", sprache.vorlesen ? "an" : "aus");
    if (!sprache.vorlesen) vorlesenStoppen();
    anzeigen();
  });
  stopp.addEventListener("click", vorlesenStoppen);
  wahl.addEventListener("change", () => {
    stimmeErsatzGemeldet = false;
    stimmeZuletzt = "";
    if (wahl.value === "google") {
      // Die gewählte Browserstimme bleibt als Ersatz gespeichert
      sprache.quelle = "google";
    } else {
      sprache.quelle = "browser";
      sprache.stimme = wahl.value;
      einstellungSchreiben("jarvis-stimme", wahl.value);
    }
    einstellungSchreiben("jarvis-stimme-quelle", sprache.quelle);
    anzeigen();
    spracheHinweisen();
  });

  // Spracheinstellung: Ein Wechsel ändert nie still die gewählte Stimme – passt sie nicht, steht es sichtbar daneben.
  const erkennungWahl = document.getElementById("sprache-erkennung");
  const ausgabeWahl = document.getElementById("sprache-ausgabe");
  erkennungWahl.replaceChildren(...Object.entries(SPRACHEN.erkennung).map(([k, t]) => new Option(t, k)));
  ausgabeWahl.replaceChildren(...Object.entries(SPRACHEN.ausgabe).map(([k, t]) => new Option(t, k)));
  erkennungWahl.value = sprache.erkennung;
  ausgabeWahl.value = sprache.ausgabe;
  function spracheHinweisen() {
    const hinweise = [];
    if (sprache.erkennung.startsWith("en")) hinweise.push("Englische Erkennung: JARVIS-Befehle sind deutsch – gedacht für englische Fragen an die KI.");
    if (sprache.quelle === "browser" && sprache.stimme) {
      const v = deutscheStimmen().find((x) => x.voiceURI === sprache.stimme);
      if (v && (v.lang || "").toLowerCase() !== sprache.ausgabe.toLowerCase()) {
        hinweise.push("Ihre gewählte Stimme „" + v.name + "“ spricht " + v.lang + ", die Ausgabesprache ist " + SPRACHEN.ausgabe[sprache.ausgabe] + ". Die Stimme bleibt eingestellt – bei Bedarf unter „Stimme“ ändern.");
      }
    }
    if (sprache.quelle === "google" && sprache.ausgabe !== "de-DE") {
      hinweise.push("Die Google-Stimme spricht Deutsch (Deutschland), die Variante legt der Worker fest – für " + SPRACHEN.ausgabe[sprache.ausgabe] + " eine Browserstimme wählen.");
    }
    document.getElementById("sprache-hinweis").textContent = hinweise.join(" ");
  }
  erkennungWahl.addEventListener("change", () => {
    if (!SPRACHEN.erkennung[erkennungWahl.value]) return;
    sprache.erkennung = erkennungWahl.value;
    einstellungSchreiben("jarvis-sprache-erkennung", sprache.erkennung);
    spracheHinweisen();
  });
  ausgabeWahl.addEventListener("change", () => {
    if (!SPRACHEN.ausgabe[ausgabeWahl.value]) return;
    sprache.ausgabe = ausgabeWahl.value;
    einstellungSchreiben("jarvis-sprache-ausgabe", sprache.ausgabe);
    spracheHinweisen();
  });

  if (vorhanden) {
    stimmenFuellen();
    // Stimmen werden in manchen Browsern erst nachträglich geladen
    if (typeof window.speechSynthesis.addEventListener === "function") window.speechSynthesis.addEventListener("voiceschanged", stimmenFuellen);
  } else {
    schalter.disabled = true;
    wahl.disabled = true;
    wahl.replaceChildren(new Option("nicht verfügbar", ""));
  }
  anzeigen();
  // Für die lokalen Tests (Nachbildung der Sprachausgabe)
  spracheHinweisen();
  window.sprachausgabeAktualisieren = () => { stimmenFuellen(); anzeigen(); spracheHinweisen(); };
  window.vorlesenStatusAnzeigen = anzeigen;
})();

// Stimmtest: fester Text ohne KI-Anfrage. Vergleicht A (kurzer Satz, ein Stück), B (langer Text, ein Stück) und
// C (langer Text, satzweise wie bei echten Antworten) und misst, was der Browser tatsächlich meldet.
(function () {
  const vorhanden = "speechSynthesis" in window;
  // Feste, selbst formulierte Testtexte je Sprache (keine Zitate)
  const TEXTE = {
    de: {
      kurz: "Guten Tag, Sir. Dies ist ein kurzer Stimmtest.",
      lang: "Guten Tag, Sir. Dies ist ein längerer Stimmtest für die Sprachausgabe von JARVIS. "
        + "Er besteht aus mehreren Sätzen, damit Pausen und Übergänge zwischen den Sätzen gut hörbar sind. "
        + "Achten Sie bitte auf Aussetzer, Wiederholungen oder abgehackte Wörter. Vielen Dank, das war der Test.",
    },
    en: {
      kurz: "Good evening, sir. This is a short voice test for your assistant.",
      lang: "Good evening, sir. This is a longer voice test for your personal assistant. "
        + "It contains several sentences, so that pauses and transitions between them are easy to hear. "
        + "Please listen for gaps, repeated words or clipped syllables. Thank you, that concludes the test.",
    },
  };
  const teststimmeWahl = document.getElementById("teststimme-wahl");
  const bereich = document.getElementById("stimmtest");
  const oeffner = document.getElementById("stimme-testen");
  const protokoll = document.getElementById("stimmtest-protokoll");
  const liste = document.getElementById("stimmen-liste");
  const ms = (x) => Math.round(x) + " ms";
  const sek = (x) => (x / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " s";

  function gewaehlteStimme() {
    return deutscheStimmen().find((v) => v.voiceURI === sprache.stimme) || null;
  }

  // Teststimme: leer = eingestellte (deutsche) Vorlesestimme; sonst eine beliebige Stimme nur für diesen Test.
  // Die Sprache des Testtextes richtet sich nach der Teststimme (Englisch oder Deutsch).
  function teststimme() {
    const uri = teststimmeWahl.value;
    if (!uri || !vorhanden) return { stimme: gewaehlteStimme(), sprache: "de", lang: "de-DE" };
    const v = window.speechSynthesis.getVoices().find((s) => s.voiceURI === uri) || null;
    const englisch = Boolean(v && (v.lang || "").toLowerCase().startsWith("en"));
    return { stimme: v, sprache: englisch ? "en" : "de", lang: v ? v.lang : "de-DE" };
  }

  function stimmName() {
    const s = teststimme().stimme;
    return s ? `${s.name} [${s.localService ? "lokal" : "online"}]` : "Standardstimme des Browsers";
  }

  // Auswahl: zuerst Englisch (Vereinigtes Königreich), dann übriges Englisch, dann Deutsch
  function teststimmenFuellen() {
    const bisher = teststimmeWahl.value;
    const stimmen = vorhanden ? window.speechSynthesis.getVoices() : [];
    const gruppe = (titel, auswahl) => {
      if (!auswahl.length) return null;
      const g = document.createElement("optgroup");
      g.label = titel;
      for (const v of auswahl.sort((a, b) => a.name.localeCompare(b.name))) {
        g.append(new Option(`${v.name} (${v.lang}, ${v.localService ? "lokal" : "online"})`, v.voiceURI));
      }
      return g;
    };
    const sprachteil = (v) => (v.lang || "").toLowerCase().replace("_", "-");
    const uk = stimmen.filter((v) => sprachteil(v) === "en-gb");
    const englisch = stimmen.filter((v) => sprachteil(v).startsWith("en") && sprachteil(v) !== "en-gb");
    const deutsch = stimmen.filter((v) => sprachteil(v).startsWith("de"));
    teststimmeWahl.replaceChildren(
      new Option("Eingestellte Vorlesestimme (Deutsch)", ""),
      ...[gruppe("Englisch – Vereinigtes Königreich", uk), gruppe("Englisch – andere", englisch), gruppe("Deutsch", deutsch)].filter(Boolean),
    );
    teststimmeWahl.value = [...teststimmeWahl.options].some((o) => o.value === bisher) ? bisher : "";
    const hinweis = document.getElementById("testsprache-hinweis");
    const t = teststimme();
    hinweis.textContent = (t.sprache === "en" ? "Testtext: Englisch. " : "Testtext: Deutsch. ")
      + (uk.length
        ? uk.length + " britische Stimme(n) verfügbar."
        : "Keine britische Stimme gefunden – in Edge erscheinen sie als „Online (Natural)“ (Internet nötig) oder lokal nach Installation von „Englisch (Vereinigtes Königreich)“ in den Windows-Spracheinstellungen.");
  }

  function eintrag(text, fehler) {
    if (protokoll.firstElementChild && protokoll.firstElementChild.textContent === "Noch kein Test.") protokoll.replaceChildren();
    const li = document.createElement("li");
    li.textContent = text;
    if (fehler) li.className = "fehler";
    protokoll.prepend(li);
    while (protokoll.children.length > 10) protokoll.lastElementChild.remove();
  }

  // Alle Stimmen mit vollständigem Namen, Sprache und Art (lokal auf dem Gerät oder online über den Anbieter)
  function stimmenZeigen() {
    if (!vorhanden) {
      liste.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Sprachausgabe wird von diesem Browser nicht unterstützt." }));
      document.getElementById("stimmen-anzahl").textContent = "0";
      return;
    }
    const stimmen = window.speechSynthesis.getVoices().slice()
      .sort((a, b) => Number((b.lang || "").startsWith("de")) - Number((a.lang || "").startsWith("de")) || a.name.localeCompare(b.name));
    document.getElementById("stimmen-anzahl").textContent = String(stimmen.length);
    liste.replaceChildren(...stimmen.map((v) => {
      const li = document.createElement("li");
      li.textContent = `${v.name} · ${v.lang} · ${v.localService ? "lokal (auf dem Gerät)" : "online (Dienst des Anbieters)"}`
        + (v.default ? " · Standard" : "") + (v.voiceURI === sprache.stimme ? " · ausgewählt" : "");
      if (v.voiceURI === sprache.stimme) li.className = "gewaehlt";
      return li;
    }));
    if (!stimmen.length) liste.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Der Browser meldet (noch) keine Stimmen." }));
  }

  // A und B: ein einziges Stück, ohne Aufteilung
  function direkt(text, name) {
    if (!vorhanden) return eintrag(name + ": Sprachausgabe nicht verfügbar.", true);
    const synth = window.speechSynthesis;
    const lief = Boolean(synth.speaking || synth.pending);
    vorlesenStoppen();
    const nummer = ansageNummer;
    const klick = performance.now();
    const { stimme, lang } = teststimme();
    let start = 0;
    let grenzen = 0;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1;
    u.pitch = 1;
    if (stimme) { u.voice = stimme; u.lang = stimme.lang; }
    u.onstart = () => { start = performance.now(); if (nummer === ansageNummer) vorlesenAnzeigen(true); };
    u.onboundary = () => { grenzen++; };
    u.onend = () => {
      if (nummer !== ansageNummer) return;
      vorlesenAnzeigen(false);
      eintrag(`${name}: Start nach ${ms(start - klick)}, Dauer ${sek(performance.now() - start)}, Wortgrenzen-Ereignisse ${grenzen} · ${stimmName()}`);
    };
    u.onerror = (e) => {
      if (nummer !== ansageNummer) return;
      vorlesenAnzeigen(false);
      eintrag(`${name}: Fehler „${(e && e.error) || "unbekannt"}“ · ${stimmName()}`, true);
    };
    laufendeTeile = [u];
    // gleicher Abstand nach einem Abbruch wie bei der normalen Wiedergabe, damit nur die Aufteilung verglichen wird
    ansageTimer = setTimeout(() => {
      if (nummer !== ansageNummer) return;
      if (synth.paused) synth.resume();
      synth.speak(u);
    }, lief ? 120 : 0);
  }

  // C: dieselbe satzweise Wiedergabe wie bei echten Antworten, mit Messung je Teil
  function satzweise() {
    if (!vorhanden) return eintrag("C: Sprachausgabe nicht verfügbar.", true);
    const klick = performance.now();
    const teile = [];
    const t = teststimme();
    jarvisSprechen(TEXTE[t.sprache].lang, {
      stimme: t.stimme,
      sprache: t.lang,
      start: (i) => { teile[i] = { start: performance.now(), ende: null }; },
      ende: (i) => { if (teile[i]) teile[i].ende = performance.now(); },
      fertig: () => {
        const gueltig = teile.filter(Boolean);
        if (!gueltig.length) return;
        const luecken = gueltig.slice(1).map((t, i) => t.start - gueltig[i].ende);
        eintrag(`C · Langer Text satzweise: ${gueltig.length} Teile, Start nach ${ms(gueltig[0].start - klick)}, `
          + `Gesamtdauer ${sek(gueltig[gueltig.length - 1].ende - gueltig[0].start)}, `
          + `Lücken zwischen den Teilen: ${luecken.length ? luecken.map(ms).join(", ") : "–"} · ${stimmName()}`);
      },
      fehler: (e) => eintrag(`C · Langer Text satzweise: Fehler „${(e && e.error) || "unbekannt"}“ · ${stimmName()}`, true),
    });
  }

  oeffner.addEventListener("click", () => {
    bereich.hidden = !bereich.hidden;
    oeffner.setAttribute("aria-expanded", String(!bereich.hidden));
    oeffner.setAttribute("aria-pressed", String(!bereich.hidden));
    if (!bereich.hidden) aktualisieren();
  });
  const aktualisieren = () => { stimmenZeigen(); teststimmenFuellen(); };
  document.getElementById("stimmtest-kurz").addEventListener("click", () => direkt(TEXTE[teststimme().sprache].kurz, "A · Kurzer Satz direkt"));
  document.getElementById("stimmtest-lang").addEventListener("click", () => direkt(TEXTE[teststimme().sprache].lang, "B · Langer Text am Stück"));
  document.getElementById("stimmtest-teile").addEventListener("click", satzweise);
  // G: die echte Vorlesestimme (Google, Gemini-TTS „Sadaltager“ über den Worker) – genau ein /sprechen-Aufruf, nur auf Klick.
  // A–C prüfen nur Browserstimmen; ohne G war die Google-Stimme hier gar nicht hörbar.
  async function googleTest() {
    const knopf = document.getElementById("stimmtest-google");
    if (knopf.disabled) return null;
    if (!verbunden()) { eintrag("G · Google-Stimme: keine Worker-Verbindung – nichts angefragt.", true); return null; }
    knopf.disabled = true;
    vorlesenStoppen();
    const nummer = ansageNummer;
    const t0 = performance.now();
    try {
      const r = await sprechenHolen(TEXTE.de.kurz);
      const dauer = performance.now() - t0;
      if (!(r.daten && audioGueltig(r.daten.audioContent))) {
        const grund = r.grund === "Unbekannter Endpunkt." ? "Worker kennt /sprechen noch nicht – Worker-Patch übernehmen"
          : (r.daten && r.daten.tts_fehler) || r.grund || "kein gültiges Audio";
        eintrag("G · Google-Stimme: Fehler „" + grund + "“ nach " + ms(dauer) + ".", true);
        return { ok: false, grund };
      }
      const gespielt = await googleTeilAbspielen(r.daten.audioContent, nummer);
      if (nummer === ansageNummer) { aktuellesAudio = null; vorlesenAnzeigen(false); }
      eintrag("G · Google-Stimme (Gemini-TTS „Sadaltager“ über den Worker): Audio nach " + ms(dauer) + (gespielt ? ", vollständig abgespielt." : ", Wiedergabe abgebrochen oder blockiert."), !gespielt);
      return { ok: gespielt };
    } finally {
      knopf.disabled = false;
    }
  }
  document.getElementById("stimmtest-google").addEventListener("click", googleTest);
  window.stimmtestGoogle = googleTest;
  document.getElementById("stimmtest-stopp").addEventListener("click", vorlesenStoppen);
  document.getElementById("stimme-wahl").addEventListener("change", aktualisieren);
  teststimmeWahl.addEventListener("change", () => { vorlesenStoppen(); teststimmenFuellen(); });
  if (vorhanden && typeof window.speechSynthesis.addEventListener === "function") window.speechSynthesis.addEventListener("voiceschanged", aktualisieren);
  aktualisieren();
  window.stimmenZeigen = aktualisieren; // für die lokalen Tests
})();

// Spracheingabe (Browser-Spracherkennung, nur Texteingabe)
// Ablauf einer Aufnahme: ein Klick startet sie ausdrücklich. Sie läuft im Modus „continuous“, damit kurze Pausen
// sie nicht beenden. Sie endet durch erneuten Klick, nach ZEITEN.stille ohne Sprache oder nach ZEITEN.maximal.
// Beendet der Erkennungsdienst die Sitzung vorher von selbst, wird sie innerhalb derselben Aufnahme höchstens
// ZEITEN.fortsetzungen-mal neu gestartet – nie nach manuellem Stopp, Esc, Fehler, Vorlesen oder Verlassen der Seite.
// Push-to-talk: Mikrofon-Knopf oder Leertaste (außerhalb von Eingabefeldern) gedrückt halten → Aufnahme läuft ohne
// Stille-Grenze, Loslassen beendet sie und sendet. Ein kurzer Druck (< ZEITEN.halten) wirkt wie ein Klick.
(function () {
  const knopf = document.getElementById("mikro");
  const knopfText = document.getElementById("mikro-text");
  const status = document.getElementById("sprach-status");
  const vorschau = document.getElementById("sprach-vorschau");
  const feld = document.getElementById("sprach-text");
  const sendenKnopf = document.getElementById("sprach-senden");
  const kern = document.getElementById("kern");
  // Bei jedem Klick neu nachsehen: Unterstützung kann sich nicht ändern, Tests ersetzen sie aber
  const Erkennung = () => window.SpeechRecognition || window.webkitSpeechRecognition;
  // ab 14d (Nr. 12): endeWarten = so lange wartet die Aufnahme nach stop()/abort() auf das Ende-Ereignis des Dienstes (Chrome/Edge melden
  // es üblich nach Bruchteilen einer Sekunde; 2 s lassen Spielraum für langsame Server-Erkennung), danach schließt sie selbst ab
  const ZEITEN = { stille: 5000, maximal: 60000, fortsetzungen: 5, halten: 350, endeWarten: 2000 };
  // Normales Ende → automatisch senden. Abbruch (Esc, Vorlesen, Seite verlassen) oder Fehler → nur Vorschau.
  const AUTOMATISCH_SENDEN = ["manuell", "losgelassen", "stille", "maximal", "dienst"];
  // Meldet der Erkennungsdienst eine geringe Sicherheit, wird nicht automatisch gesendet: der Text bleibt zur Prüfung
  // stehen (allgemein, ohne Sonderregeln für einzelne Wörter). Ohne Angabe des Dienstes (0/fehlt) gilt wie bisher.
  const ERKENNUNG = { schwelle: 0.6 };
  let erkennung = null;   // laufende Sitzung des Erkennungsdienstes
  let aufnahme = null;    // eine ausdrücklich gestartete Aufnahme (kann mehrere Sitzungen umfassen)
  let zustand = "bereit";

  // Fügt einen neu erkannten Teil an, ohne Wiederholungen: Manche Browser liefern Teile, die den bisherigen Text
  // ganz oder am Ende überlappend wiederholen (z. B. „Hallo“ → „Hallo Jarvis“). Verglichen wird wortweise.
  function zusammenfuegen(bisher, neu) {
    const a = bisher.trim();
    const b = neu.trim();
    if (!a) return b;
    if (!b) return a;
    const klein = (s) => s.toLowerCase().replace(/[.,!?;:]/g, "");
    const wa = a.split(/\s+/);
    const wb = b.split(/\s+/);
    if (klein(b).startsWith(klein(a))) return b;          // neuer Teil enthält den bisherigen Text vollständig
    if (klein(a).endsWith(klein(b))) return a;            // neuer Teil ist bereits enthalten
    for (let k = Math.min(wa.length, wb.length); k > 0; k--) {
      if (klein(wa.slice(-k).join(" ")) === klein(wb.slice(0, k).join(" "))) {
        return wa.concat(wb.slice(k)).join(" ");
      }
    }
    return a + " " + b;
  }

  // Gesamter Text: Ergebnis früherer Sitzungen + endgültige und vorläufige Teile der laufenden Sitzung
  function gesamtText() {
    if (!aufnahme) return "";
    let text = aufnahme.gesammelt;
    for (const teil of aufnahme.sitzungFertig) text = zusammenfuegen(text, teil);
    return zusammenfuegen(text, aufnahme.sitzungVorlaeufig);
  }

  const FEHLER = {
    "not-allowed": "Mikrofon-Zugriff verweigert. Bitte im Browser (Symbol neben der Adresse) das Mikrofon für diese Seite erlauben – oder den Text eintippen.",
    "service-not-allowed": "Die Spracherkennung ist in diesem Browser oder auf dieser Seite gesperrt. Bitte den Text eintippen.",
    "no-speech": "Keine Sprache erkannt. Bitte erneut versuchen oder den Text eintippen.",
    "audio-capture": "Kein Mikrofon gefunden. Bitte ein Mikrofon anschließen oder den Text eintippen.",
    "network": "Der Erkennungsdienst des Browsers ist nicht erreichbar (Internetverbindung nötig). Bitte den Text eintippen.",
    get "language-not-supported"() { return "Die Erkennungssprache „" + SPRACHEN.erkennung[sprache.erkennung] + "“ wird von der Spracherkennung dieses Browsers nicht unterstützt. Bitte unter „Sprache“ eine andere wählen oder den Text eintippen."; },
  };

  // zustand: bereit | zuhoeren | verarbeiten | fehler
  function zustandSetzen(neu, meldung, beschriftung) {
    zustand = neu;
    knopf.dataset.zustand = neu;
    knopf.setAttribute("aria-pressed", String(neu === "zuhoeren"));
    knopfText.textContent = beschriftung || { bereit: "Sprechen", zuhoeren: "Zuhören – Stopp", verarbeiten: "Verarbeite …", fehler: "Sprechen" }[neu];
    kern.classList.toggle("hoert", neu === "zuhoeren");
    status.textContent = meldung || "";
    status.dataset.art = neu === "fehler" ? "fehler" : "";
  }

  function unterstuetzungAnzeigen() {
    const da = Boolean(Erkennung());
    const feldStatus = document.getElementById("spracheingabe-status");
    feldStatus.textContent = da ? "vom Browser unterstützt" : "nicht unterstützt";
    feldStatus.className = da ? "ok" : "aus";
    knopf.setAttribute("aria-disabled", String(!da));
    knopf.title = da ? "Tippen: Aufnahme starten/stoppen · Gedrückt halten (oder Leertaste halten): Push-to-talk, Loslassen sendet" : "Spracheingabe wird von diesem Browser nicht unterstützt";
    document.getElementById("sprach-hinweis").textContent = da
      ? "Push-to-talk: Mikrofon oder Leertaste gedrückt halten, Loslassen sendet. "
        + "Hinweis: Die Spracheingabe nutzt den Erkennungsdienst Ihres Browseranbieters; dabei wird die Aufnahme dorthin übertragen."
      : "";
  }

  function vorschauZeigen(text, live) {
    vorschau.hidden = false;
    feld.value = text;
    feld.readOnly = live;
    sendenKnopf.disabled = live || !text.trim();
  }

  function vorschauSchliessen() {
    vorschau.hidden = true;
    feld.value = "";
  }

  const sekunden = (ms) => (ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " s";

  // Startet eine Sitzung des Erkennungsdienstes innerhalb der laufenden Aufnahme
  function sitzungStarten() {
    const Klasse = Erkennung();
    const sitzung = new Klasse();
    sitzung.lang = sprache.erkennung;
    sitzung.interimResults = true;
    sitzung.continuous = true; // kurze Sprechpausen beenden die Sitzung nicht
    sitzung.maxAlternatives = 1;
    aufnahme.sitzungFertig = [];
    aufnahme.sitzungVorlaeufig = "";
    aufnahme.sitzungSicherheit = [];

    sitzung.onstart = () => {
      if (sitzung !== erkennung) return;
      if (aufnahme.ptt) {
        zustandSetzen("zuhoeren", "Ich höre zu, solange Sie gedrückt halten … Loslassen sendet, Esc bricht ab.", "Zuhören – loslassen");
        return;
      }
      zustandSetzen("zuhoeren", aufnahme.fortsetzungen
        ? "Ich höre weiter zu … Zum Beenden erneut tippen, Esc bricht ab."
        : "Ich höre zu … Kurze Pausen sind möglich. Zum Beenden erneut tippen, Esc bricht ab.");
    };
    sitzung.onspeechstart = () => { if (sitzung === erkennung) aufnahme.letzteSprache = Date.now(); };
    sitzung.onresult = (e) => {
      if (sitzung !== erkennung) return;
      const fertig = [];
      const sicherheit = [];
      let vorlaeufig = "";
      for (let i = 0; i < e.results.length; i++) {
        const teil = e.results[i][0].transcript;
        const k = e.results[i][0].confidence;
        if (e.results[i].isFinal) { fertig.push(teil); if (typeof k === "number" && k > 0) sicherheit.push(k); }
        else vorlaeufig = zusammenfuegen(vorlaeufig, teil);
      }
      aufnahme.sitzungFertig = fertig;
      aufnahme.sitzungSicherheit = sicherheit;
      aufnahme.sitzungVorlaeufig = vorlaeufig;
      aufnahme.letzteSprache = Date.now();
      vorschauZeigen(gesamtText(), true);
    };
    sitzung.onerror = (e) => {
      if (sitzung !== erkennung) return;
      // ab 14d (Nr. 17): nur ein selbst angeforderter Abbruch ist harmlos; ein „aborted“ ohne eigene Anforderung ist ein Fehler
      if (e.error === "aborted" && aufnahme.grund) return; // eigener Abbruch (Esc, Vorlesen, Verlassen der Seite)
      if (e.error === "aborted") { aufnahme.fehler = "Der Erkennungsdienst hat die Aufnahme von sich aus abgebrochen. Bitte erneut versuchen oder den Text eintippen."; return; }
      // Push-to-talk: Solange gedrückt gehalten wird, ist eine Sprechpause kein Fehler (Sitzung wird fortgesetzt)
      if (e.error === "no-speech" && aufnahme.ptt) return;
      // „Keine Sprache“ nach bereits erkanntem Text ist ein normales Ende, kein Fehler
      if (e.error === "no-speech" && gesamtText()) { aufnahme.grund = "stille"; return; }
      aufnahme.fehler = FEHLER[e.error] || "Spracheingabe fehlgeschlagen (" + e.error + "). Bitte den Text eintippen.";
    };
    sitzung.onend = () => {
      if (sitzung !== erkennung) return;
      erkennung = null;
      // Ergebnis dieser Sitzung sichern – auch vorläufige Teile, damit nichts verloren geht
      aufnahme.gesammelt = gesamtText();
      aufnahme.sicherheit.push(...aufnahme.sitzungSicherheit);
      aufnahme.sitzungFertig = [];
      aufnahme.sitzungVorlaeufig = "";
      aufnahme.sitzungSicherheit = [];
      const jetzt = Date.now();
      const darfFortsetzen = !aufnahme.grund && !aufnahme.fehler
        && document.visibilityState !== "hidden"
        && aufnahme.fortsetzungen < ZEITEN.fortsetzungen
        && jetzt - aufnahme.beginn < ZEITEN.maximal
        && (aufnahme.ptt || jetzt - aufnahme.letzteSprache < ZEITEN.stille);
      if (darfFortsetzen) {
        // Der Dienst hat von selbst gestoppt: kontrolliert innerhalb derselben Aufnahme fortsetzen
        aufnahme.fortsetzungen++;
        erkennung = sitzungStarten();
        return;
      }
      if (!aufnahme.grund && !aufnahme.fehler) {
        aufnahme.grund = aufnahme.fortsetzungen >= ZEITEN.fortsetzungen ? "dienst" : jetzt - aufnahme.beginn >= ZEITEN.maximal ? "maximal" : "stille";
      }
      aufnahmeAbschliessen();
    };

    try {
      sitzung.start();
    } catch (e) {
      aufnahme.fehler = "Spracheingabe konnte nicht gestartet werden. Bitte den Text eintippen.";
      erkennung = null;
      setTimeout(aufnahmeAbschliessen, 0);
    }
    return sitzung;
  }

  // Zeitgrenzen der Aufnahme prüfen (Stille, Höchstdauer)
  function zeitPruefen() {
    // ab 14d (Nr. 12): Dienst meldet nach stop()/abort() kein Ende → nach ZEITEN.endeWarten selbst abschließen (nie automatisch senden)
    if (aufnahme && aufnahme.endeAngefordert && Date.now() - aufnahme.endeAngefordert >= ZEITEN.endeWarten) { zwangsAbschluss("zeitgrenze"); return; }
    if (!aufnahme || !erkennung || aufnahme.grund) return;
    const jetzt = Date.now();
    if (jetzt - aufnahme.beginn >= ZEITEN.maximal) beenden("maximal");
    else if (!aufnahme.ptt && jetzt - aufnahme.letzteSprache >= ZEITEN.stille) beenden("stille");
  }

  // Beendet die Aufnahme ohne Fortsetzung. stop() liefert noch die letzten Ergebnisse, abort() nicht.
  // ab 14d (Nr. 12): Abschluss ohne Dienst-Ende. Die alte Sitzung wird abgehängt (sitzung !== erkennung) – ihre späten Ereignisse wirken nicht mehr.
  function zwangsAbschluss(grund) {
    if (!aufnahme) return;
    aufnahme.grund = grund;
    erkennung = null;
    aufnahmeAbschliessen();
  }
  function beenden(grund) {
    if (!aufnahme) return;
    // ab 14d (Nr. 12): wartet die Aufnahme schon auf das Dienst-Ende, beenden Esc und Verwerfen sofort und ohne Senden
    if (aufnahme.grund) { if (aufnahme.endeAngefordert && (grund === "esc" || grund === "verworfen")) zwangsAbschluss(grund); return; }
    aufnahme.grund = grund;
    if (!erkennung) return;
    aufnahme.endeAngefordert = Date.now();
    if (grund === "manuell" || grund === "losgelassen" || grund === "stille" || grund === "maximal") {
      zustandSetzen("verarbeiten", "Verarbeite die Aufnahme …");
      erkennung.stop();
    } else {
      erkennung.abort();
    }
  }

  function aufnahmeAbschliessen() {
    if (!aufnahme) return;
    clearInterval(aufnahme.uhr);
    const text = (aufnahme.gesammelt || gesamtText()).trim();
    const { grund, fehler } = aufnahme;
    const werte = [...aufnahme.sicherheit, ...(aufnahme.sitzungSicherheit || [])];
    const sicherheit = werte.length ? Math.min(...werte) : null;
    aufnahme = null;
    erkennung = null;
    kern.classList.remove("hoert");
    if (grund === "verworfen") { vorschauSchliessen(); zustandSetzen("bereit", "Aufnahme beendet – erkannter Text verworfen."); return; } // ab 11-13k
    if (fehler) {
      if (text) vorschauZeigen(text, false); else vorschauSchliessen();
      zustandSetzen("fehler", fehler + (text ? " Der bisher erkannte Text bleibt zur Prüfung erhalten." : ""));
      return;
    }
    const ursache = {
      manuell: "Aufnahme beendet.",
      losgelassen: "Losgelassen – Aufnahme beendet.",
      unterbrochen: "Halten wurde unterbrochen – Aufnahme abgebrochen.",
      stille: "Aufnahme nach " + sekunden(ZEITEN.stille) + " ohne Sprache beendet.",
      maximal: "Maximale Aufnahmedauer (" + sekunden(ZEITEN.maximal) + ") erreicht.",
      dienst: "Der Erkennungsdienst des Browsers hat die Aufnahme beendet.",
      zeitgrenze: "Der Erkennungsdienst hat das Ende nicht gemeldet – Aufnahme nach " + sekunden(ZEITEN.endeWarten) + " selbst beendet, nichts automatisch gesendet.",
      esc: "Aufnahme abgebrochen.",
      reiter: "Aufnahme abgebrochen, weil der Bereich gewechselt wurde.",
      vorlesen: "Aufnahme beendet, weil JARVIS vorliest.",
      verlassen: "Aufnahme beendet, weil die Seite verlassen wurde.",
    }[grund] || "Aufnahme beendet.";
    if (text && AUTOMATISCH_SENDEN.includes(grund) && sicherheit !== null && sicherheit < ERKENNUNG.schwelle) {
      // Unsicher erkannt: nicht senden, sondern zeigen – auch ein unsicheres „Ja“ bestätigt so nichts
      vorschauZeigen(text, false);
      zustandSetzen("bereit", ursache + " Unsicher erkannt (Sicherheit " + Math.round(sicherheit * 100) + " %): „" + text
        + "“ – nichts gesendet. Bitte prüfen, ggf. korrigieren und mit „Senden“ abschicken.");
      feld.focus();
    } else if (text && AUTOMATISCH_SENDEN.includes(grund)) {
      // Normales Ende: direkt senden. Läuft noch eine Antwort, bleibt der Text in der Vorschau (Meldung in senden()).
      vorschauZeigen(text, false);
      // Den gesendeten Text sichtbar nennen, damit eine Fehlerkennung (z. B. „PayPal“ statt „Paper“) sofort auffällt
      senden(ursache + " Erkannter Text wurde gesendet: „" + text + "“");
    } else if (text) {
      vorschauZeigen(text, false);
      zustandSetzen("bereit", ursache + " Erkannter Text – bitte prüfen und mit „Senden“ abschicken.");
      feld.focus();
    } else {
      vorschauSchliessen();
      zustandSetzen("bereit", ursache + " Nichts erkannt. Bitte erneut versuchen oder den Text eintippen.");
    }
  }

  function starten(ptt) {
    if (!Erkennung()) {
      zustandSetzen("fehler", "Spracheingabe wird von diesem Browser nicht unterstützt (verfügbar z. B. in aktuellen Versionen von Chrome und Edge). Die Texteingabe funktioniert weiterhin.");
      return;
    }
    // Zweiter Klick während der Aufnahme beendet sie (erkannter Text bleibt erhalten)
    if (aufnahme) {
      beenden("manuell");
      return;
    }
    vorlesenStoppen(); // keine Aufnahme während des Vorlesens
    vorschauSchliessen();
    const jetzt = Date.now();
    aufnahme = { beginn: jetzt, letzteSprache: jetzt, gesammelt: "", sitzungFertig: [], sitzungVorlaeufig: "", sicherheit: [], sitzungSicherheit: [], fortsetzungen: 0, grund: null, fehler: null, uhr: null, ptt: ptt === true };
    aufnahme.uhr = setInterval(zeitPruefen, Math.max(20, Math.min(250, ZEITEN.stille / 5)));
    zustandSetzen("verarbeiten", "Mikrofon wird gestartet – der Browser fragt ggf. nach der Freigabe.", "Starte …");
    erkennung = sitzungStarten();
  }

  // Hier geht der Text als normale Chat-Nachricht hinaus (automatisch nach dem Ende oder per „Senden“).
  // Die Vorschau wird vor dem Versand geleert – ein zweiter Aufruf findet keinen Text mehr (kein Doppelversand).
  function senden(meldung) {
    const text = feld.value.trim();
    if (!text || aufnahme) return;
    if (document.getElementById("senden").disabled) {
      zustandSetzen("bereit", "Bitte warten – JARVIS antwortet noch. Der Text bleibt erhalten; danach mit „Senden“ abschicken.");
      return;
    }
    vorschauSchliessen();
    zustandSetzen("bereit", typeof meldung === "string" ? meldung : "");
    jarvisAntwort(text);
  }

  function uebernehmen() {
    const eingabe = document.getElementById("befehl");
    eingabe.value = feld.value.trim();
    vorschauSchliessen();
    zustandSetzen("bereit", "In das Eingabefeld übernommen – mit Enter oder „Senden“ abschicken.");
    eingabe.focus();
  }

  function verwerfen() {
    // ab 11-13k: während einer laufenden Aufnahme auch die Aufnahme abbrechen – vorher hörte die Erkennung weiter zu, während die
    // Anzeige „bereit“ meldete, und das nächste Ergebnis der Sitzung brachte den verworfenen Text in die Vorschau zurück
    if (aufnahme) beenden("verworfen"); // ab 14d (Nr. 12): auch während des Wartens auf das Dienst-Ende
    vorschauSchliessen();
    zustandSetzen("bereit", "Erkannter Text verworfen.");
    knopf.focus();
  }

  // ---------- Push-to-talk ----------
  let halten = null; // { quelle: "zeiger" | "taste", beginn }

  function haltenBeginnen(quelle) {
    if (halten) return;
    // Läuft bereits eine (angetippte) Aufnahme, beendet der Druck sie wie ein Klick
    if (aufnahme) { beenden("manuell"); return; }
    starten(true);
    if (aufnahme) halten = { quelle, beginn: Date.now() };
  }

  function haltenEnden(quelle, abgebrochen) {
    if (!halten || halten.quelle !== quelle) return;
    const dauer = Date.now() - halten.beginn;
    halten = null;
    if (!aufnahme || aufnahme.grund) return;
    if (abgebrochen) { beenden("unterbrochen"); return; }
    if (dauer < ZEITEN.halten) {
      // Kurzer Druck = Antippen: Aufnahme läuft wie bisher weiter (Stille-Grenze, erneutes Tippen beendet)
      aufnahme.ptt = false;
      aufnahme.letzteSprache = Date.now();
      if (zustand === "zuhoeren") zustandSetzen("zuhoeren", "Ich höre zu … Kurze Pausen sind möglich. Zum Beenden erneut tippen, Esc bricht ab.");
      return;
    }
    beenden("losgelassen");
  }

  // Leertaste nur, wenn kein Eingabefeld, Auswahlfeld oder anderer Knopf den Fokus hat
  function leertasteFrei(ziel) {
    if (!ziel || ziel === document.body || ziel === document.documentElement) return true;
    if (ziel === knopf) return true;
    return !(ziel.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(ziel.tagName) || ziel.getAttribute("role") === "tab");
  }

  knopf.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { knopf.setPointerCapture(e.pointerId); } catch (_) { /* ältere Browser */ }
    haltenBeginnen("zeiger");
  });
  knopf.addEventListener("pointerup", () => haltenEnden("zeiger", false));
  knopf.addEventListener("pointercancel", () => haltenEnden("zeiger", true));
  knopf.addEventListener("contextmenu", (e) => e.preventDefault()); // langes Drücken auf dem Tablet
  // Klick per Tastatur (Enter/Leertaste auf dem Knopf) oder Skript: wie bisher umschalten.
  // Zeiger-Klicks (detail > 0) sind schon über pointerdown/pointerup behandelt.
  knopf.addEventListener("click", (e) => { if (e.detail === 0 && !halten) starten(); });
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat || e.ctrlKey || e.altKey || e.metaKey || !leertasteFrei(e.target)) return;
    e.preventDefault();
    haltenBeginnen("taste");
  });
  document.addEventListener("keyup", (e) => {
    if (e.code !== "Space" || !halten || halten.quelle !== "taste") return;
    e.preventDefault();
    haltenEnden("taste", false);
  });
  window.addEventListener("blur", () => { if (halten) haltenEnden(halten.quelle, true); });
  sendenKnopf.addEventListener("click", () => senden());
  document.getElementById("sprach-uebernehmen").addEventListener("click", uebernehmen);
  document.getElementById("sprach-verwerfen").addEventListener("click", verwerfen);
  feld.addEventListener("input", () => { sendenKnopf.disabled = feld.readOnly || !feld.value.trim(); });
  feld.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); senden(); }
    if (e.key === "Escape") { e.preventDefault(); verwerfen(); }
  });
  // Esc bricht die Aufnahme sofort ab; bereits erkannter Text bleibt zur Prüfung erhalten
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && aufnahme) { e.preventDefault(); beenden("esc"); } });
  // Seite verlassen oder in den Hintergrund: Aufnahme beenden, keine Fortsetzung
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") beenden("verlassen"); });
  window.addEventListener("pagehide", () => beenden("verlassen"));

  unterstuetzungAnzeigen();
  zustandSetzen("bereit", "");
  // Für das Vorlesen: keine Aufnahme während der Wiedergabe
  window.spracheingabeBeenden = (grund) => beenden(grund || "vorlesen");
  window.spracheingabeLaeuft = () => Boolean(aufnahme);
  // Für das lokale Aktivierungswort: startet eine normale Aufnahme (wie ein Klick), nie eine zweite
  window.spracheingabeStarten = () => { if (!aufnahme && zustand !== "verarbeiten") starten(); };
  // Für die lokalen Tests (Nachbildung der Spracherkennung, verkürzte Zeiten)
  window.spracheingabeAktualisieren = unterstuetzungAnzeigen;
  // ab 11-05a: Reiterwechsel aus dem Cockpit bricht eine laufende Aufnahme ab wie Esc (nichts gesendet, Text bleibt zur Prüfung) –
  // Knopf, Status und Kern liegen nur im Cockpit; vorher hörte das Mikrofon dort unsichtbar weiter und sendete danach automatisch
  window.spracheingabeAbbrechen = (grund) => beenden(grund);
  window.spracheingabeZeiten = ZEITEN;
  window.spracheingabeErkennung = ERKENNUNG;
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("sprache");
