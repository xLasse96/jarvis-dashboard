// JARVIS Dashboard – Modul „wachwort“ (ab 16d, Nutzerwunsch 16.11.: auf dem Tablet ohne Knopfdruck reden – JARVIS hört dauerhaft zu und
// antwortet, wenn man ihn mit „Jarvis“ anspricht). Läuft im Browser über die Spracherkennung des Browsers (Web Speech API), ohne PC-Helfer.
// Ablauf: Schalter „Dauerhaft zuhören“ (erste Einschaltung braucht einen Tipp – Mikrofon-Freigabe des Browsers). Eine Erkennungssitzung
// läuft dauerhaft und startet nach jedem Ende neu. Enthält ein erkannter Satz „Jarvis“, gilt der Rest des Satzes als Frage/Befehl und geht
// über den normalen Chat-Weg (jarvisAntwort) – dieselben Freigaben wie getippt (Paper-Befehle nur nach ausdrücklichem „Ja“, nie Echtgeld).
// Nur „Jarvis“ ohne Rest → die normale Aufnahme startet (wie der Mikrofon-Knopf). Während JARVIS spricht oder eine Aufnahme läuft, pausiert
// das Zuhören (eigene Stimme wird nicht als Befehl gewertet). Datenschutz: Solange „Dauerhaft zuhören“ an ist, verarbeitet die
// Spracherkennung des Browsers (bei Chrome/Edge beim Anbieter des Browsers) fortlaufend Audio – das steht sichtbar am Schalter.
const WACH = { maxSprichtMs: 60000, sprichtSeit: null, an: false, sitzung: null, neustartUhr: null, warteUhr: null, fehlerFolge: 0, schluessel: "jarvis-wachwort", wort: /\b(?:hallo |hey |hi |ok )?jarvis\b[\s,.:!?-]*/i };
const wachEl = (id) => document.getElementById(id);
function wachStatus(text) { const s = wachEl("wach-status"); if (s) s.textContent = text; }
function wachKnopf() {
  const k = wachEl("wach-schalter"); if (!k) return;
  k.textContent = WACH.an ? "Dauerhaft zuhören: an" : "Dauerhaft zuhören: aus"; k.setAttribute("aria-pressed", String(WACH.an));
}
function wachErkennung() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
// JARVIS spricht gerade bzw. eine normale Aufnahme läuft → nicht zuhören
// Eine Sprechanzeige, die länger als maxSprichtMs ununterbrochen steht, gilt als hängend (z. B. abgebrochene Wiedergabe) und blockiert nicht
function wachBesetzt() {
  if (typeof window.spracheingabeLaeuft === "function" && window.spracheingabeLaeuft()) return true;
  const spricht = Boolean(document.querySelector(".spricht")) || Boolean(window.speechSynthesis && window.speechSynthesis.speaking);
  if (!spricht) { WACH.sprichtSeit = null; return false; }
  if (!WACH.sprichtSeit) WACH.sprichtSeit = Date.now();
  return Date.now() - WACH.sprichtSeit < WACH.maxSprichtMs;
}
// Erkannter Text → Befehl nach dem Aktivierungswort; null = kein Aktivierungswort
function wachBefehl(text) {
  const t = String(text || ""), m = WACH.wort.exec(t);
  if (!m) return null;
  return t.slice(m.index + m[0].length).replace(/^[\s,.:!?-]+/, "").trim();
}
function wachAusfuehren(befehl) {
  if (befehl && befehl.length >= 2) {
    const e = wachEl("befehl"); if (e) e.value = befehl;
    wachStatus(`„Jarvis“ erkannt – „${befehl.slice(0, 80)}“ wird gesendet.`);
    if (typeof jarvisAntwort === "function") jarvisAntwort();
    return "gesendet";
  }
  // nur „Jarvis“: normale Aufnahme starten (das Dauer-Zuhören pausiert, bis sie endet)
  wachStatus("„Jarvis“ erkannt – ich höre zu …");
  wachSitzungBeenden();
  if (typeof window.spracheingabeStarten === "function") window.spracheingabeStarten();
  wachSpaeterWieder();
  return "aufnahme";
}
function wachSitzungBeenden() {
  const s = WACH.sitzung; WACH.sitzung = null;
  if (s) { s.onend = null; s.onresult = null; s.onerror = null; try { s.abort(); } catch (e) { /* schon beendet */ } }
}
// Wieder einschalten, sobald JARVIS nicht mehr spricht und keine Aufnahme läuft
function wachSpaeterWieder(ms = 600) {
  clearTimeout(WACH.warteUhr);
  WACH.warteUhr = setTimeout(() => { if (!WACH.an) return; if (wachBesetzt()) { wachSpaeterWieder(800); return; } wachSitzungStarten(); }, ms);
}
function wachSitzungStarten() {
  if (!WACH.an || WACH.sitzung) return;
  const Klasse = wachErkennung();
  if (!Klasse) { WACH.an = false; wachKnopf(); wachStatus("Dieser Browser hat keine Spracherkennung – Dauerhaft zuhören nicht möglich (Chrome/Edge verwenden)."); return; }
  if (wachBesetzt()) { wachSpaeterWieder(800); return; }
  const s = new Klasse();
  s.lang = (typeof sprache !== "undefined" && sprache.erkennung) || "de-DE"; s.continuous = true; s.interimResults = false; s.maxAlternatives = 1;
  s.onresult = (ev) => {
    if (s !== WACH.sitzung) return;
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i]; if (!r.isFinal) continue;
      if (wachBesetzt()) continue; // eigene Stimme während des Vorlesens ignorieren
      const befehl = wachBefehl(r[0] && r[0].transcript);
      if (befehl !== null) { WACH.fehlerFolge = 0; wachAusfuehren(befehl); return; }
    }
  };
  s.onerror = (ev) => {
    if (s !== WACH.sitzung) return;
    const art = ev && ev.error;
    if (art === "not-allowed" || art === "service-not-allowed") { WACH.an = false; wachSitzungBeenden(); wachKnopf(); wachStatus("Mikrofon nicht freigegeben – Dauerhaft zuhören aus. In den Browser-Einstellungen das Mikrofon für diese Seite erlauben und erneut einschalten."); wachMerken(false); return; }
    if (art !== "no-speech" && art !== "aborted") WACH.fehlerFolge++;
  };
  s.onend = () => {
    if (s !== WACH.sitzung) return;
    WACH.sitzung = null;
    if (!WACH.an) return;
    // Neustart: sofort nach Stille, sonst mit wachsender Pause (Netz-/Dienstfehler), höchstens 30 s
    const pause = WACH.fehlerFolge ? Math.min(30000, 1000 * 2 ** Math.min(WACH.fehlerFolge, 5)) : 250;
    if (WACH.fehlerFolge >= 3) wachStatus(`Spracherkennung gestört – neuer Versuch in ${Math.round(pause / 1000)} s.`);
    clearTimeout(WACH.neustartUhr); WACH.neustartUhr = setTimeout(wachSitzungStarten, pause);
  };
  WACH.sitzung = s;
  try { s.start(); wachStatus("Ich höre zu – sag „Jarvis“ und dann deine Frage. Hinweis: Die Spracherkennung des Browsers verarbeitet dabei fortlaufend Audio."); }
  catch (e) { WACH.sitzung = null; wachStatus("Zuhören konnte nicht starten – einmal auf „Dauerhaft zuhören“ tippen."); WACH.an = false; wachKnopf(); }
}
function wachMerken(an) { try { localStorage.setItem(WACH.schluessel, an ? "an" : "aus"); } catch (e) { /* nur Bequemlichkeit */ } }
function wachSetzen(an) {
  WACH.an = an; wachKnopf(); wachMerken(an);
  if (an) { WACH.fehlerFolge = 0; wachSitzungStarten(); }
  else { clearTimeout(WACH.neustartUhr); clearTimeout(WACH.warteUhr); wachSitzungBeenden(); wachStatus("Dauerhaft zuhören aus – zum Sprechen den Mikrofon-Knopf nutzen."); }
}
(function wachStart() {
  const k = wachEl("wach-schalter"); if (!k) return;
  k.addEventListener("click", () => wachSetzen(!WACH.an));
  // Wunsch „an“ vom letzten Mal: versuchen (gelingt, wenn der Browser die Mikrofon-Freigabe für diese Seite gespeichert hat)
  let gemerkt = null; try { gemerkt = localStorage.getItem(WACH.schluessel); } catch (e) { gemerkt = null; }
  if (gemerkt === "an" && wachErkennung()) { WACH.an = true; wachKnopf(); wachSitzungStarten(); }
  else wachKnopf();
  // Unsichtbarer Tab: Browser beenden die Erkennung ohnehin – beim Zurückkehren neu starten
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && WACH.an && !WACH.sitzung) wachSpaeterWieder(300); });
})();
;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("wachwort");
