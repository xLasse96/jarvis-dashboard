// JARVIS Dashboard – Modul „einrichtung“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Einrichtungsassistent ----------
// Führt durch Worker-Adresse, Verbindungstest, Stimme, Spracheingabe und optionale Dienste. Jeder Schritt zeigt ehrlich,
// was funktioniert („funktioniert“), was eine Attrappe ist, was noch einzurichten ist und was nicht geprüft wurde.
// Gespeichert wird nur der Fortschritt (Schritt, Status, übersprungen) – nie Zugangscode, Tokens oder Schlüssel.
// Öffnet sich von selbst nur beim allerersten Start ohne Worker-Adresse; sonst über „Einrichtungsassistent“ in „Verbindung“.
const EINRICHTUNG = { schluessel: "jarvis-einrichtung" };
const EINRICHTUNG_SCHRITTE = [
  { id: "adresse", titel: "Worker-Adresse und Zugangscode" },
  { id: "verbindung", titel: "Verbindungstest" },
  { id: "stimme", titel: "Stimme (Vorlesen)" },
  { id: "sprache", titel: "Spracheingabe" },
  { id: "optional", titel: "Optionale Dienste" },
  { id: "zusammenfassung", titel: "Zusammenfassung" },
];
const ZUSTAND_TEXT = { funktioniert: "funktioniert", attrappe: "Attrappe (keine echte Verbindung)", einzurichten: "noch einzurichten", ausstehend: "Prüfung ausstehend", fehler: "Fehler", uebersprungen: "übersprungen" };
let einrichtung = { schritt: 0, ergebnisse: {}, abgeschlossen: false };

function einrichtungLaden() {
  // Ohne gespeicherten Stand immer frisch beginnen (keine alten Ergebnisse aus dem Speicher anzeigen)
  einrichtung = { schritt: 0, ergebnisse: {}, abgeschlossen: false };
  try { const d = JSON.parse(localStorage.getItem(EINRICHTUNG.schluessel) || "null"); if (d && typeof d.schritt === "number") einrichtung = { schritt: Math.max(0, Math.min(EINRICHTUNG_SCHRITTE.length - 1, d.schritt)), ergebnisse: d.ergebnisse || {}, abgeschlossen: Boolean(d.abgeschlossen) }; } catch (e) { /* frischer Start */ }
}
function einrichtungSpeichern() {
  try { localStorage.setItem(EINRICHTUNG.schluessel, JSON.stringify(einrichtung)); } catch (e) { /* Speicher gesperrt: nur diese Sitzung */ }
}
// Ergebnis eines Prüfpunkts: { zustand, text } – text enthält nie Geheimnisse
function ergebnisSetzen(schluessel, zustand, text) { einrichtung.ergebnisse[schluessel] = { zustand, text, zeit: new Date().toISOString() }; einrichtungSpeichern(); }

function einrichtungZeile(name, ergebnis) {
  const li = document.createElement("li");
  li.className = "einrichtung-" + ergebnis.zustand;
  li.textContent = name + ": " + ZUSTAND_TEXT[ergebnis.zustand] + (ergebnis.text ? " – " + ergebnis.text : "");
  return li;
}

async function adressePruefen() {
  const url = document.getElementById("einrichtung-url").value.trim();
  const code = document.getElementById("einrichtung-code").value;
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(url)) return "Bitte eine HTTPS-Adresse eingeben, z. B. https://jarvis.NAME.workers.dev";
  if (!code && !verbindung.code) return "Bitte den Zugangscode eingeben.";
  verbindung.url = url;
  if (code) verbindung.code = code;
  // ab 11-04b: beide Schreibvorgänge werden versucht und ausgewertet (vorher „gespeichert“, auch wenn der Speicher gesperrt war)
  const gespeichert = [einstellungSchreiben("jarvis-worker-url", verbindung.url), einstellungSchreiben("jarvis-zugangscode", verbindung.code)].every(Boolean);
  document.getElementById("worker-url").value = verbindung.url;
  document.getElementById("zugangscode").value = verbindung.code;
  document.getElementById("einrichtung-code").value = ""; // nicht im Feld stehen lassen
  if (gespeichert) ergebnisSetzen("adresse", "funktioniert", "Adresse gespeichert; Zugangscode gespeichert (nicht angezeigt)");
  else ergebnisSetzen("adresse", "fehler", "Adresse und Zugangscode nur für diese Sitzung übernommen – Browserspeicher gesperrt oder voll; nach dem Neuladen gilt wieder der vorherige Stand");
  return null;
}

async function verbindungTesten() {
  if (!verbunden()) { ergebnisSetzen("worker", "einzurichten", "keine Worker-Adresse"); return; }
  try {
    const s = await workerAnfrage("/status", { method: "GET" });
    ergebnisSetzen("worker", "funktioniert", "Worker erreichbar");
    ergebnisSetzen("ki", s.ki_konfiguriert ? "funktioniert" : "einzurichten", s.ki_konfiguriert ? "KI-Schlüssel im Worker hinterlegt" : "kein KI-Schlüssel im Worker");
    ergebnisSetzen("speicher", s.kv_verbunden ? "funktioniert" : "einzurichten", s.kv_verbunden ? "KV-Speicher verbunden" : "KV-Speicher fehlt (Paper-Trading und Not-Aus brauchen ihn)");
    ergebnisSetzen("testnet", s.trading_konfiguriert ? "funktioniert" : "einzurichten", s.trading_konfiguriert ? "Testnet-Schlüssel hinterlegt (Spielgeld)" : "keine Testnet-Schlüssel");
    verbindungPruefen();
  } catch (e) {
    // ab 16l (Befund Tablet-Einrichtung): statt pauschal „nicht erreichbar“ die gesendete Anfrage nennen und nach einem Netzfehler dieselbe
    // Diagnose wie im Cockpit (Erreichbarkeit, Herkunft/CORS); 401/403 mit Antwort des Workers eigens benennen. Codewert wird nie gezeigt.
    const gesendet = " · Gesendet: GET /status mit den Kopfzeilen content-type und x-jarvis-zugang (Wert nicht angezeigt).";
    const diagnose = e && e.netzwerk && !e.nichtGesendet && !e.abgebrochen && !e.zeitlimit && typeof workerErreichbarkeit === "function" ? await workerErreichbarkeit() : "";
    const status = e && e.status === 401 ? " · Der Worker hat geantwortet: Zugangscode abgelehnt (401) – Code im Feld neu eintippen (Autokorrektur aus)."
      : e && e.status === 403 ? " · Der Worker hat geantwortet: Zugriff verweigert (403)." : e && e.status ? ` · Der Worker hat mit ${e.status} geantwortet.` : "";
    ergebnisSetzen("worker", "fehler", e.message + status + (e && (e.netzwerk || e.status) ? gesendet : "") + diagnose);
    for (const k of ["ki", "speicher", "testnet"]) ergebnisSetzen(k, "ausstehend", "erst nach erfolgreicher Verbindung prüfbar");
  }
}

function stimmePruefen() {
  const browser = "speechSynthesis" in window ? deutscheStimmen() : [];
  ergebnisSetzen("browserstimme", browser.length ? "funktioniert" : "einzurichten", browser.length ? browser.length + " deutsche Browserstimme(n), z. B. " + browser[0].name : "keine deutsche Browserstimme gefunden");
  ergebnisSetzen("googlestimme", "ausstehend", sprache.quelle === "google"
    ? "wird bei der ersten Antwort genutzt, falls im Worker eingerichtet – hier nicht geprüft (wäre ein kostenpflichtiger Aufruf)"
    : "Quelle „Browser“ gewählt");
}

async function sprachePruefen() {
  const da = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!da) { ergebnisSetzen("spracheingabe", "einzurichten", "vom Browser nicht unterstützt (Chrome oder Edge verwenden)"); return; }
  let recht = "unbekannt";
  try { if (navigator.permissions && navigator.permissions.query) recht = (await navigator.permissions.query({ name: "microphone" })).state; } catch (e) { recht = "unbekannt"; }
  if (recht === "granted") ergebnisSetzen("spracheingabe", "funktioniert", "unterstützt, Mikrofon freigegeben (Erkennung über den Dienst des Browseranbieters)");
  else if (recht === "denied") ergebnisSetzen("spracheingabe", "fehler", "Mikrofon für diese Seite blockiert – im Browser (Symbol neben der Adresse) erlauben");
  else ergebnisSetzen("spracheingabe", "ausstehend", "unterstützt; die Mikrofonfreigabe fragt der Browser beim ersten Klick auf „Sprechen“");
}

async function optionalPruefen() {
  if (helferEingerichtet()) {
    const s = await helferPruefen();
    ergebnisSetzen("helfer", s ? (s.attrappe ? "attrappe" : "funktioniert") : "fehler", s ? "PC-Helfer Version " + s.version : "PC-Helfer nicht erreichbar");
  } else ergebnisSetzen("helfer", "einzurichten", "optional: pc-helfer\\jarvis-helfer.ps1 starten und Kopplungscode in „Verbindung“ eintragen");
  ergebnisSetzen("homeassistant", "einzurichten", "nicht angeschlossen – es gibt nur eine Demo-Attrappe (siehe docs/HOME_ASSISTANT_ANSCHLUSS.md)");
  if (verbunden()) {
    try {
      const p = await workerAnfrage("/paper/status", { method: "GET" });
      ergebnisSetzen("paper", p.simulation ? "funktioniert" : "fehler", p.simulation ? "Simulation bereit (Spielgeld)" : "unerwartete Antwort");
    } catch (e) { ergebnisSetzen("paper", "fehler", e.message); }
  } else ergebnisSetzen("paper", "ausstehend", "erst nach der Verbindung prüfbar");
  const ki = einrichtung.ergebnisse.ki;
  ergebnisSetzen("recherche", ki && ki.zustand === "funktioniert" ? "funktioniert" : "ausstehend", "Websuche läuft über die KI im Worker, nur bei ausdrücklichen Fragen im Chat");
}

const PRUEFPUNKTE = [
  ["adresse", "Worker-Adresse"], ["worker", "Worker-Verbindung"], ["ki", "KI"], ["speicher", "Speicher (KV)"], ["testnet", "Binance-Testnet"],
  ["browserstimme", "Browserstimme"], ["googlestimme", "Google-Stimme"], ["spracheingabe", "Spracheingabe"],
  ["paper", "Paper-Trading"], ["recherche", "Recherche"], ["helfer", "PC-Helfer"], ["homeassistant", "Home Assistant"],
];
const SCHRITT_PUNKTE = { adresse: ["adresse"], verbindung: ["worker", "ki", "speicher", "testnet"], stimme: ["browserstimme", "googlestimme"], sprache: ["spracheingabe"], optional: ["paper", "recherche", "helfer", "homeassistant"] };

function einrichtungAnzeigen() {
  const s = EINRICHTUNG_SCHRITTE[einrichtung.schritt];
  document.getElementById("einrichtung-titel").textContent = "Einrichtung · Schritt " + (einrichtung.schritt + 1) + " von " + EINRICHTUNG_SCHRITTE.length + ": " + s.titel;
  for (const b of document.querySelectorAll("[data-einrichtung-bereich]")) b.hidden = b.dataset.einrichtungBereich !== s.id;
  const punkte = s.id === "zusammenfassung" ? PRUEFPUNKTE.map((p) => p[0]) : SCHRITT_PUNKTE[s.id] || [];
  const liste = document.getElementById("einrichtung-liste");
  liste.replaceChildren(...punkte.map((k) => einrichtungZeile(PRUEFPUNKTE.find((p) => p[0] === k)[1], einrichtung.ergebnisse[k] || { zustand: "ausstehend", text: "noch nicht geprüft" })));
  document.getElementById("einrichtung-meldung").textContent = "";
  document.getElementById("einrichtung-zurueck").disabled = einrichtung.schritt === 0;
  document.getElementById("einrichtung-weiter").hidden = s.id === "zusammenfassung";
  document.getElementById("einrichtung-ueberspringen").hidden = s.id === "zusammenfassung";
  document.getElementById("einrichtung-fertig").hidden = s.id !== "zusammenfassung";
}

async function einrichtungSchrittPruefen() {
  const id = EINRICHTUNG_SCHRITTE[einrichtung.schritt].id;
  if (id === "verbindung") await verbindungTesten();
  if (id === "stimme") stimmePruefen();
  if (id === "sprache") await sprachePruefen();
  if (id === "optional") await optionalPruefen();
}

async function einrichtungGehe(schritt) {
  einrichtung.schritt = Math.max(0, Math.min(EINRICHTUNG_SCHRITTE.length - 1, schritt));
  einrichtungSpeichern();
  einrichtungAnzeigen();
  await einrichtungSchrittPruefen();
  einrichtungAnzeigen();
}

async function einrichtungWeiter() {
  const id = EINRICHTUNG_SCHRITTE[einrichtung.schritt].id;
  if (id === "adresse") {
    const fehler = await adressePruefen();
    if (fehler) { document.getElementById("einrichtung-meldung").textContent = fehler; return false; }
  }
  await einrichtungGehe(einrichtung.schritt + 1);
  return true;
}

async function einrichtungUeberspringen() {
  const id = EINRICHTUNG_SCHRITTE[einrichtung.schritt].id;
  for (const k of SCHRITT_PUNKTE[id] || []) {
    const vorher = einrichtung.ergebnisse[k];
    if (!vorher || vorher.zustand !== "funktioniert") ergebnisSetzen(k, "uebersprungen", "später in „Verbindung“ → „Einrichtungsassistent“ fortsetzen");
  }
  await einrichtungGehe(einrichtung.schritt + 1);
}

function einrichtungOeffnen() {
  einrichtungLaden();
  const dialog = document.getElementById("einrichtung");
  if (typeof dialog.show === "function") { if (!dialog.open) dialog.show(); } else dialog.setAttribute("open", "");
  document.getElementById("einrichtung-url").value = verbindung.url || "";
  document.getElementById("einrichtung-code").value = "";
  einrichtungAnzeigen();
  document.getElementById("einrichtung-titel").focus();
}

function einrichtungSchliessen(fertig) {
  if (fertig) einrichtung.abgeschlossen = true;
  einrichtungSpeichern();
  const dialog = document.getElementById("einrichtung");
  if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open");
}

// Nur beim allerersten Start (keine Adresse, nie eingerichtet) von selbst öffnen
function einrichtungAutomatisch() {
  let gespeichert = null;
  try { gespeichert = localStorage.getItem(EINRICHTUNG.schluessel); } catch (e) { /* ohne Speicher nicht aufdrängen */ return false; }
  if (verbindung.url || gespeichert) return false;
  einrichtungOeffnen();
  return true;
}

document.getElementById("einrichtung-weiter").addEventListener("click", () => einrichtungWeiter());
document.getElementById("einrichtung-zurueck").addEventListener("click", () => einrichtungGehe(einrichtung.schritt - 1));
document.getElementById("einrichtung-ueberspringen").addEventListener("click", () => einrichtungUeberspringen());
document.getElementById("einrichtung-spaeter").addEventListener("click", () => einrichtungSchliessen(false));
document.getElementById("einrichtung-fertig").addEventListener("click", () => einrichtungSchliessen(true));
document.getElementById("einrichtung-stimmprobe").addEventListener("click", () => jarvisSprechen("Guten Tag, Sir. So klinge ich mit der Browserstimme.", {}));
document.getElementById("einrichtung-oeffnen").addEventListener("click", einrichtungOeffnen);
document.getElementById("einrichtung").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); einrichtungSchliessen(false); } });
einrichtungAutomatisch();
window.einrichtungIntern = { laden: einrichtungLaden, zustand: () => einrichtung, oeffnen: einrichtungOeffnen, weiter: einrichtungWeiter, ueberspringen: einrichtungUeberspringen, gehe: einrichtungGehe, schliessen: einrichtungSchliessen, automatisch: einrichtungAutomatisch, SCHRITTE: EINRICHTUNG_SCHRITTE };

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("einrichtung");
