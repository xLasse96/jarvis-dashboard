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
// ab 17b: „eingerichtet“ = laut Worker vorhanden, aber nicht live benutzt (z. B. KI-Schlüssel); „aus“ = bewusst abgeschaltet
const ZUSTAND_TEXT = { funktioniert: "funktioniert", eingerichtet: "eingerichtet (nicht live geprüft)", aus: "bewusst abgeschaltet", attrappe: "Attrappe (keine echte Verbindung)", einzurichten: "noch einzurichten", ausstehend: "Prüfung ausstehend", fehler: "Fehler", uebersprungen: "übersprungen" };
let einrichtung = { schritt: 0, ergebnisse: {}, abgeschlossen: false };
let einrichtungLaeuft = false; // ab 17b: Doppelklick-Schutz für Weiter/Zurück/Überspringen

// ab 17b (Befund ER1): vollständige Prüfung der Worker-Adresse statt Regex – Platzhalter (NAME, example), nacktes workers.dev, http,
// Port, Benutzerangaben, Pfad, Abfrage und Anker werden mit konkretem Hinweis abgelehnt; Ergebnis ist die normalisierte Herkunft.
function workerAdressePruefen(roh) {
  const text = String(roh || "").trim();
  if (!text) return { fehler: "Bitte die Worker-Adresse eingeben, z. B. https://jarvis.KONTO.workers.dev." };
  let u;
  try { u = new URL(text); } catch (e) { return { fehler: "Das ist keine gültige Adresse. Beispiel: https://jarvis.KONTO.workers.dev" }; }
  if (u.protocol !== "https:") return { fehler: "Nur HTTPS-Adressen sind erlaubt (https://…) – der Zugangscode ginge sonst unverschlüsselt hinaus." };
  if (u.username || u.password) return { fehler: "Bitte die Adresse ohne Benutzername oder Passwort eingeben." };
  if (u.port) return { fehler: "Bitte die Adresse ohne Port (z. B. „:8443“) eingeben." };
  if ((u.pathname && u.pathname !== "/") || u.search || u.hash) return { fehler: "Bitte nur die Adresse ohne Pfad eingeben (kein „/status“, „?“ oder „#“) – z. B. https://jarvis.KONTO.workers.dev" };
  const host = u.hostname.toLowerCase(), teile = host.split(".");
  if (teile.some((t) => t === "name" || t === "example") || /(^|\.)example\.(com|org|net)$/.test(host)) return { fehler: "Das ist noch ein Platzhalter – bitte die echte Adresse deines Workers eintragen (steht im Cloudflare-Dashboard)." };
  if (teile.length < 2 || !/^[a-z]{2,}$/.test(teile[teile.length - 1]) || teile.some((t) => !/^[a-z0-9-]+$/.test(t))) return { fehler: "Die Adresse ist unvollständig oder enthält ungültige Zeichen." };
  if (host.endsWith("workers.dev") && teile.length < 4) return { fehler: "Unvollständige workers.dev-Adresse – sie braucht Worker- und Kontonamen, z. B. https://jarvis.KONTO.workers.dev" };
  return { url: u.origin };
}
function workerHerkunftVon(url) { try { return new URL(url).origin; } catch (e) { return ""; } }

function einrichtungLaden() {
  // Ohne gespeicherten Stand immer frisch beginnen (keine alten Ergebnisse aus dem Speicher anzeigen)
  einrichtung = { schritt: 0, ergebnisse: {}, abgeschlossen: false };
  try { const d = JSON.parse(localStorage.getItem(EINRICHTUNG.schluessel) || "null"); if (d && typeof d.schritt === "number") einrichtung = { schritt: Number.isInteger(d.schritt) ? Math.max(0, Math.min(EINRICHTUNG_SCHRITTE.length - 1, d.schritt)) : 0, ergebnisse: d.ergebnisse && typeof d.ergebnisse === "object" && !Array.isArray(d.ergebnisse) ? d.ergebnisse : {}, abgeschlossen: Boolean(d.abgeschlossen) }; } catch (e) { /* frischer Start */ }
}
function einrichtungSpeichern() {
  try { localStorage.setItem(EINRICHTUNG.schluessel, JSON.stringify(einrichtung)); } catch (e) { /* Speicher gesperrt: nur diese Sitzung */ }
}
// Ergebnis eines Prüfpunkts: { zustand, text } – text enthält nie Geheimnisse
function ergebnisSetzen(schluessel, zustand, text) { einrichtung.ergebnisse[schluessel] = { zustand, text, zeit: new Date().toISOString() }; einrichtungSpeichern(); }

function einrichtungZeile(name, ergebnis) {
  const li = document.createElement("li");
  // ab 17b: unbekannter/beschädigter gespeicherter Zustand → „unbekannt“, nie „undefined“ oder ein fremder Klassenname
  const zustand = Object.hasOwn(ZUSTAND_TEXT, ergebnis && ergebnis.zustand) ? ergebnis.zustand : "ausstehend";
  li.className = "einrichtung-" + zustand;
  li.textContent = name + ": " + (zustand === (ergebnis && ergebnis.zustand) ? ZUSTAND_TEXT[zustand] : "unbekannt (gespeicherter Stand unlesbar)") + (ergebnis && typeof ergebnis.text === "string" && ergebnis.text ? " – " + ergebnis.text.slice(0, 600) : "");
  return li;
}

async function adressePruefen() {
  const pruef = workerAdressePruefen(document.getElementById("einrichtung-url").value);
  if (pruef.fehler) return pruef.fehler;
  const url = pruef.url;
  const code = document.getElementById("einrichtung-code").value;
  if (!code && !verbindung.code) return "Bitte den Zugangscode eingeben.";
  // ab 17b (Befund ER3): „leer lassen = bisherigen behalten“ nur für dieselbe Worker-Adresse – nie den alten Code an einen anderen Worker senden
  if (!code && workerHerkunftVon(verbindung.url) !== url) return "Neue Worker-Adresse: bitte den Zugangscode eingeben – der bisherige Code wird nicht an eine andere Adresse gesendet.";
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
  // ab 17b (Befund ER5): Ergebnis nur eintragen, wenn Adresse und Code seit dem Start der Prüfung unverändert sind (Stand nur im Speicher)
  const stand = verbindung.url + "\n" + verbindung.code;
  const veraltet = () => verbindung.url + "\n" + verbindung.code !== stand;
  const verwerfen = () => ergebnisSetzen("worker", "ausstehend", "Ergebnis verworfen (veraltet) – Adresse oder Zugangscode wurden während der Prüfung geändert. Bitte erneut prüfen.");
  try {
    const s = await workerAnfrage("/status", { method: "GET" });
    if (veraltet()) { verwerfen(); return; }
    ergebnisSetzen("worker", "funktioniert", "Worker erreichbar");
    // ab 17b (Befund ER6): Vorhandensein laut Worker ist „eingerichtet“, nicht „funktioniert“ – live benutzt wird hier nichts
    ergebnisSetzen("ki", s.ki_konfiguriert ? "eingerichtet" : "einzurichten", s.ki_konfiguriert ? "KI-Schlüssel im Worker hinterlegt; eine KI-Antwort wurde hier nicht abgefragt (kostet)" : "kein KI-Schlüssel im Worker");
    ergebnisSetzen("speicher", s.kv_verbunden ? "eingerichtet" : "einzurichten", s.kv_verbunden ? "KV-Speicher im Worker verbunden" : "KV-Speicher fehlt (Paper-Trading und Not-Aus brauchen ihn)");
    ergebnisSetzen("testnet", s.trading_konfiguriert ? "eingerichtet" : "einzurichten", s.trading_konfiguriert ? "Testnet-Schlüssel hinterlegt (Spielgeld)" : "keine Testnet-Schlüssel");
    verbindungPruefen();
  } catch (e) {
    if (veraltet()) { verwerfen(); return; }
    // ab 16l (Befund Tablet-Einrichtung): statt pauschal „nicht erreichbar“ die gesendete Anfrage nennen und nach einem Netzfehler dieselbe
    // Diagnose wie im Cockpit (Erreichbarkeit, Herkunft/CORS); 401/403 mit Antwort des Workers eigens benennen. Codewert wird nie gezeigt.
    const gesendet = " · Gesendet: GET /status mit den Kopfzeilen content-type und x-jarvis-zugang (Wert nicht angezeigt).";
    const diagnose = e && e.netzwerk && !e.nichtGesendet && !e.abgebrochen && !e.zeitlimit && typeof workerErreichbarkeit === "function" ? await workerErreichbarkeit(e) : "";
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
    } catch (e) {
      // ab 17b (Befund ER6): 410 = Krypto-Paper im Aktien-Stand bewusst abgeschaltet – kein Fehler
      if (e && e.status === 410) ergebnisSetzen("paper", "aus", "Krypto-Paper im Worker bewusst abgeschaltet (Aktien-Stand). Aktien-Paper läuft lokal mit Spielgeld bzw. über Alpaca-Paper – hier nicht geprüft.");
      else ergebnisSetzen("paper", "fehler", e.message);
    }
  } else ergebnisSetzen("paper", "ausstehend", "erst nach der Verbindung prüfbar");
  // ab 17b (Befund ER6): Recherche wird hier nie live geprüft (wäre eine KI-Anfrage) – nicht als „funktioniert“ ausgeben
  const ki = einrichtung.ergebnisse.ki;
  ergebnisSetzen("recherche", "ausstehend", "nicht geprüft – Websuche läuft über die KI im Worker" + (ki && ki.zustand === "eingerichtet" ? " (KI-Schlüssel hinterlegt)" : "") + ", nur bei ausdrücklichen Fragen im Chat");
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
  einrichtungKnoepfe();
}
// ab 17b: Knopfzustände getrennt (ohne die Meldung zu leeren) – auch nach einem gesperrten Doppelklick-Schritt
function einrichtungKnoepfe() {
  const s = EINRICHTUNG_SCHRITTE[einrichtung.schritt];
  document.getElementById("einrichtung-zurueck").disabled = einrichtungLaeuft || einrichtung.schritt === 0;
  document.getElementById("einrichtung-weiter").disabled = einrichtungLaeuft;
  document.getElementById("einrichtung-ueberspringen").disabled = einrichtungLaeuft;
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

// ab 17b (Befund ER4): während ein Schritt läuft, sind Weiter/Zurück/Überspringen gesperrt – ein Doppelklick startet keine zweite Prüfung
async function einrichtungExklusiv(arbeit) {
  if (einrichtungLaeuft) return false;
  einrichtungLaeuft = true;
  einrichtungKnoepfe();
  try { return await arbeit(); }
  finally { einrichtungLaeuft = false; einrichtungKnoepfe(); }
}
async function einrichtungGehe(schritt) {
  einrichtung.schritt = Math.max(0, Math.min(EINRICHTUNG_SCHRITTE.length - 1, schritt));
  einrichtungSpeichern();
  einrichtungAnzeigen();
  await einrichtungSchrittPruefen();
  einrichtungAnzeigen();
}

function einrichtungWeiter() {
  return einrichtungExklusiv(async () => {
    const id = EINRICHTUNG_SCHRITTE[einrichtung.schritt].id;
    if (id === "adresse") {
      const fehler = await adressePruefen();
      if (fehler) { document.getElementById("einrichtung-meldung").textContent = fehler; return false; }
    }
    await einrichtungGehe(einrichtung.schritt + 1);
    return true;
  });
}

function einrichtungUeberspringen() {
  return einrichtungExklusiv(async () => {
    const id = EINRICHTUNG_SCHRITTE[einrichtung.schritt].id;
    for (const k of SCHRITT_PUNKTE[id] || []) {
      const vorher = einrichtung.ergebnisse[k];
      if (!vorher || vorher.zustand !== "funktioniert") ergebnisSetzen(k, "uebersprungen", "später in „Verbindung“ → „Einrichtungsassistent“ fortsetzen");
    }
    await einrichtungGehe(einrichtung.schritt + 1);
  });
}

function einrichtungOeffnen() {
  einrichtungLaden();
  const dialog = document.getElementById("einrichtung");
  if (typeof dialog.show === "function") { if (!dialog.open) dialog.show(); } else dialog.setAttribute("open", "");
  document.getElementById("einrichtung-url").value = verbindung.url || "";
  document.getElementById("einrichtung-code").value = "";
  // ab 17b (Befund ER9): Platzhalter passend zum Zustand – ohne gespeicherten Code gibt es nichts „zu behalten“
  document.getElementById("einrichtung-code").placeholder = verbindung.code ? "leer lassen = bisherigen behalten (nur gleiche Adresse)" : "Zugangscode eingeben";
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
document.getElementById("einrichtung-zurueck").addEventListener("click", () => einrichtungExklusiv(() => einrichtungGehe(einrichtung.schritt - 1)));
document.getElementById("einrichtung-ueberspringen").addEventListener("click", () => einrichtungUeberspringen());
document.getElementById("einrichtung-spaeter").addEventListener("click", () => einrichtungSchliessen(false));
document.getElementById("einrichtung-fertig").addEventListener("click", () => einrichtungSchliessen(true));
document.getElementById("einrichtung-stimmprobe").addEventListener("click", () => jarvisSprechen("Guten Tag, Sir. So klinge ich mit der Browserstimme.", {}));
document.getElementById("einrichtung-oeffnen").addEventListener("click", einrichtungOeffnen);
document.getElementById("einrichtung").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); einrichtungSchliessen(false); } });
einrichtungAutomatisch();
window.einrichtungIntern = { laden: einrichtungLaden, zustand: () => einrichtung, oeffnen: einrichtungOeffnen, weiter: einrichtungWeiter, ueberspringen: einrichtungUeberspringen, gehe: einrichtungGehe, schliessen: einrichtungSchliessen, automatisch: einrichtungAutomatisch, SCHRITTE: EINRICHTUNG_SCHRITTE };

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("einrichtung");
