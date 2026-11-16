// JARVIS Dashboard – Modul „chat-ki“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// Chatverlauf für die KI: abwechselnd user/assistant
const verlauf = [];
const MAX_VERLAUF = 20;
// ab 11-04k: zählt jede Nutzereingabe im Chat – eine verspätete Recherche-Antwort darf Untertitel und Vorlesen einer neueren nicht überschreiben
let eingabeNr = 0;
// Grenzen des Workers für /chat (MAX_ZEICHEN_PRO_NACHRICHT / MAX_ZEICHEN_GESAMT im Worker) – nur gemeinsam ändern
const CHAT_GRENZEN = { nachricht: 4000, gesamt: 40000 };

// Auszug für /chat: die letzten Nachrichten, Beginn mit „user“. Ältere lange KI-Antworten (z. B. mit Quellenliste) werden für
// den Versand auf die Worker-Grenze gekürzt, und bei zu viel Gesamttext fallen die ältesten Frage-Antwort-Paare weg –
// sonst lehnte der Worker ab diesem Punkt jede weitere Frage ab. Der gespeicherte Verlauf bleibt unverändert.
function chatAuszug(liste) {
  let auszug = liste.slice(-MAX_VERLAUF).map((m) => (m.content.length > CHAT_GRENZEN.nachricht
    ? { role: m.role, content: m.content.slice(0, CHAT_GRENZEN.nachricht - 2) + " …" } : m));
  if (auszug[0].role !== "user") auszug = auszug.slice(1);
  while (auszug.length > 1 && auszug.reduce((s, m) => s + m.content.length, 0) > CHAT_GRENZEN.gesamt) auszug = auszug.slice(2);
  return auszug;
}

// KI-Kontext nur für den ausgehenden Request bereinigen (ab 11-03e): alte Verlaufsreste (gespeichert nur mit dem älteren
// verlaufBereinigen), die aktuelle Eingabe und der Profilteil gehen ohne Schlüssel/Tokens an /chat. Erzeugt neue Objekte –
// `verlauf` und der gespeicherte Verlauf bleiben unverändert. Unerwartete Form → Fehler, es wird dann nichts gesendet.
function kiKontextFuerVersand(nachrichten) {
  if (!Array.isArray(nachrichten) || !nachrichten.length) throw new Error("Gesprächskontext ungültig – nichts gesendet.");
  return nachrichten.map((m) => {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") throw new Error("Gesprächskontext ungültig – nichts gesendet.");
    return { role: m.role, content: geheimnisMuster(m.content, { zuweisungen: true }) };
  });
}

function einstellungLesen(name) {
  try { return localStorage.getItem(name) || ""; } catch (e) { return ""; }
}

// false: Browserspeicher gesperrt/voll (z. B. privater Modus) – der Wert gilt nur für diese Sitzung (ab 11-04b auswertbar)
function einstellungSchreiben(name, wert) {
  try { localStorage.setItem(name, wert); return true; } catch (e) { return false; }
}

// ab 11-06b (Prüfung 06.11.2026): eigene Daten mit beschädigtem Speicherstand (kaputtes JSON oder falsche Grundform) – Aufgaben,
// Routinen, Profil, Verlauf, Angeheftetes, Freigaben, Krypto-Watchlist, CUSIP-Zuordnungen – galten als leer; die nächste normale
// Änderung überschrieb den alten Stand still. Jetzt wie Watchlist, Labor, Alarme und Simulation: gemeldet, nie überschrieben; nur
// „Löschen“ unter „Daten auf diesem Gerät“ oder ein Import ersetzt ihn. Gesperrter Speicher: getItem wirft wie bisher an den Aufrufer.
const SPEICHER_SCHADEN = new Set();
function speicherJsonLesen(schluessel, form) {
  const text = localStorage.getItem(schluessel);
  SPEICHER_SCHADEN.delete(schluessel);
  if (text === null) return null;
  let wert;
  try { wert = JSON.parse(text); } catch (e) { wert = undefined; }
  if (wert === undefined || wert === null || !form(wert)) { SPEICHER_SCHADEN.add(schluessel); return null; }
  return wert;
}
const speicherBeschaedigt = (schluessel) => SPEICHER_SCHADEN.has(schluessel);
const istObjekt = (d) => typeof d === "object" && !Array.isArray(d);
const SPEICHER_SCHADEN_TEXT = "Gespeicherter Stand beschädigt – nichts wird überschrieben, Änderungen gelten nur bis zum Neuladen. Unter „Daten auf diesem Gerät“ den Bereich löschen (vorher bei Bedarf „Sicherung exportieren“).";

const verbindung = {
  url: einstellungLesen("jarvis-worker-url"),
  code: einstellungLesen("jarvis-zugangscode"),
};

// Statuspunkt neben dem Kern. zustand: aus | ok | warn | fehler
function knotenSetzen(id, zustand, wert) {
  const knoten = document.getElementById(id);
  knoten.dataset.zustand = zustand;
  knoten.querySelector(".wert").textContent = wert;
}

// zustand: offline | pruefe | verbunden | warnung | fehler (steuert die Farbe des Kerns)
function kiStatusSetzen(text, farbe, zustand) {
  const status = document.getElementById("ki-status");
  status.textContent = "● KI-Verbindung: " + text;
  status.style.color = farbe || "";
  document.getElementById("kern").dataset.zustand = zustand || "offline";
  document.getElementById("kern-text").textContent = zustand === "verbunden" ? "Bereit für Befehle" : "KI: " + text;
  const knoten = {
    offline: ["aus", "nicht eingerichtet"],
    pruefe: ["warn", "wird geprüft"],
    verbunden: ["ok", "bereit"],
    warnung: ["warn", "ohne API-Schlüssel"],
    fehler: ["fehler", "Fehler"],
  }[zustand || "offline"];
  knotenSetzen("knoten-ki", knoten[0], knoten[1]);
  if (typeof lageAktualisieren === "function") lageAktualisieren();
}

// ---------- Cockpit-Lage und Schnellzugriff (ab 11-02m) ----------
// Lage: nur aus vorhandenem Zustand (Verbindung, Kern-Zustand nach /status, Krypto-Abschaltung, Speicher, tradingZustand) –
// keine eigene Anfrage, keine Kurse. Unbekanntes wird als unbekannt genannt, nie als „verbunden“ oder „frei“.
function lageAktualisieren() {
  const setze = (id, text) => { const e = document.getElementById(id); if (e && e.textContent !== "● " + text) e.textContent = "● " + text; };
  const zustand = document.getElementById("kern").dataset.zustand;
  // ab 11-02x: Beim Seitenstart läuft dies schon (über verbindungPruefen → kiStatusSetzen), bevor der Skriptblock mit verbunden()
  // geladen ist – vorher brach das mit „verbunden is not defined“ ab, und die Statusprüfung beim Start fand nie statt.
  const verbunden = () => Boolean(verbindung.url && verbindung.code);
  setze("lage-kurse", !verbunden() ? "Kursdaten US-Aktien: keine Live-Quelle verbunden – Analyse nur mit lokalen Testdaten (synthetisch)"
    : zustand === "fehler" ? "Kursdaten US-Aktien: Worker nicht erreichbar – keine Kursdaten"
    : zustand === "verbunden" || zustand === "warnung" ? "Kursdaten US-Aktien: über den Worker nur auf Abruf in der Analyse – hier werden keine Kurse angezeigt"
    : "Kursdaten US-Aktien: Worker eingerichtet, Verbindung noch nicht bestätigt");
  setze("lage-aktien-paper", window.PaperKern ? "Aktien-Paper: lokale Simulation (Paper-Kern, Spielgeld) verfügbar – nie eine Order" : "Aktien-Paper: nicht verfügbar (Modul nicht geladen)");
  setze("lage-krypto-paper", typeof kryptoAbgeschaltet === "function" && kryptoAbgeschaltet() ? "Krypto-Paper: derzeit nicht verfügbar (im Aktien-Stand abgeschaltet)"
    : !verbunden() ? "Krypto-Paper: nicht verbunden (Worker fehlt)" : "Krypto-Paper: Simulation im Worker (USDT) – getrennt von US-Aktien");
  let aktien = "unbekannt", krypto = "unbekannt";
  try { const s = typeof wlLaden === "function" ? wlLaden() : null; aktien = !s ? "unbekannt" : s.beschaedigt ? "Speicher beschädigt" : s.eintraege.length + " Symbol(e)"; } catch (e) { /* bleibt unbekannt */ }
  try { if (window.watchIntern) krypto = window.watchIntern.liste().werte.length + " Markt/Märkte"; } catch (e) { /* bleibt unbekannt */ }
  setze("lage-watchlists", `Aktien-Watchlist: ${aktien} · Krypto-Kursliste: ${krypto} (getrennt)`);
  const n = typeof tradingZustand !== "undefined" ? tradingZustand.notaus : null;
  setze("lage-notaus", n === true ? "Not-Aus: AKTIV – alle Orders gesperrt" : n === false ? "Not-Aus: aufgehoben – jede Order braucht eine eigene Freigabe" : "Not-Aus: Status unbekannt (Worker nicht verbunden) – Orders gesperrt");
}
// Schnellzugriff: zur Trading-Ansicht, Bereich aufklappen, Ziel sichtbar machen und fokussieren
function schnellzugriff(zielId) {
  ansichtZeigen("trading");
  const ziel = document.getElementById(zielId);
  if (!ziel) return false;
  const details = ziel.closest("details");
  if (details && !details.open) details.open = true;
  ziel.scrollIntoView({ block: "center" });
  ziel.focus();
  return document.activeElement === ziel;
}
document.addEventListener("DOMContentLoaded", () => {
  for (const b of document.querySelectorAll(".schnellzugriff [data-ziel]")) b.addEventListener("click", () => schnellzugriff(b.dataset.ziel));
  lageAktualisieren();
  setInterval(lageAktualisieren, 3000);
});

// Untertitel unter dem Kern: letzte echte Frage und Antwort
function untertitelSetzen(frage, antwort) {
  if (frage !== null) document.getElementById("untertitel-frage").textContent = frage ? "Sie: " + frage : "";
  document.getElementById("untertitel-antwort").textContent = antwort;
}

function nachrichtAnzeigen(text, art) {
  const element = document.createElement("div");
  element.className = "nachricht " + art;
  element.textContent = text;
  element.dataset.zeit = new Date().toISOString(); // für Verlaufssuche und Datumsfilter
  const chat = document.getElementById("chatverlauf");
  chat.appendChild(element);
  chat.scrollTop = chat.scrollHeight;
  return element;
}

function begruessung() {
  const stunde = new Date().getHours();
  if (stunde < 11) return "Guten Morgen";
  if (stunde < 18) return "Guten Tag";
  return "Guten Abend";
}

// Antwort ohne KI, solange keine Verbindung eingerichtet ist
function offlineAntwort(befehl) {
  if (befehl.toLowerCase() === "hallo jarvis") {
    return begruessung() + ", Sir. Ich bin bereit. Für echte Antworten richten Sie bitte links die Verbindung ein.";
  }
  // ab 11-07c: ähnliche lokale Befehle nur vorschlagen, nie ausführen
  const vorschlaege = typeof befehlVorschlaege === "function" ? befehlVorschlaege(befehl) : [];
  return "Befehl empfangen – " + befehl + ". (Offline-Modus: KI-Verbindung noch nicht eingerichtet.)"
    + (vorschlaege.length ? " Meinten Sie " + vorschlaege.map((v) => "„" + v + "“").join(" oder ") + "? Es wurde nichts ausgeführt." : "");
}

// Zeitlimit für Worker-Anfragen: großzügig, weil Chat-Antworten mit Websuche länger dauern können
const WORKER_ZEITLIMIT = { ms: 120000 };

// Lesende Anfragen (GET) werden bei einem Netzwerkfehler genau einmal sichtbar wiederholt; schreibende (POST) nie
// automatisch – ein zweiter Versand könnte doppelt wirken (Paper-Order) oder doppelt kosten (KI).
const WORKER_WIEDERHOLUNG = { ms: 1500 };

// Fehler ohne Antwort des Workers (Netzwerk, falsche Adresse, Zeitlimit) tragen netzwerk = true:
// Ob der Worker die Anfrage verarbeitet hat, ist dann unbekannt. Offline wird gar nicht erst gesendet (nichtGesendet).
// optionen.abbruch: AbortController für „Abbrechen“ durch den Nutzer (→ abgebrochen = true).
// ab 14zd (Befund 14.11.: Tablet meldete „Worker nicht erreichbar“, Worker und CORS geprüft in Ordnung, Cloudflare-Log ohne Anfrage):
// Zugangscodes mit Zeichen außerhalb ISO-8859-1 (typografische Anführungszeichen, „€“, Emoji der Tablet-Tastatur) oder Steuerzeichen kann
// der Browser nicht als Kopfzeile senden – fetch scheitert dann ohne Anfrage. Jetzt: nichts senden und die Ursache nennen.
function zugangscodeProblem(code) {
  return /[^\x20-\x7E\xA0-\xFF]/.test(String(code || "")) ? "Nicht gesendet – der Zugangscode enthält ein Zeichen, das der Browser nicht senden kann (z. B. typografisches Anführungszeichen, „€“ oder Emoji der Tablet-Tastatur). Bitte den Code im Cockpit neu eintippen (Autokorrektur aus)." : null;
}
// Gegenprobe nach einem Netzfehler: einfache Anfrage an die öffentliche Startseite des Workers – ohne Zugangscode, ohne Kopfzeilen (no-cors).
// Erreichbar → der Browser hat die eigentliche Anfrage abgewiesen; nicht erreichbar → Netz, DNS-Filter, VPN oder Werbeblocker auf dem Gerät.
// ab 16l (Befund Tablet-Einrichtung 16.11.: „Worker nicht erreichbar“): zweite Probe trennt CORS von Erweiterung/Vorabfrage. Der Worker
// (2204baa3) beantwortet Anfragen fremder Herkunft (lokale Datei = „null“, localhost, andere Adresse) mit 403 OHNE CORS-Kopf – der Browser
// meldet das wie einen Netzfehler. Eine einfache GET-Anfrage an /status ohne eigene Kopfzeilen (keine Vorabfrage, kein Zugangscode) bekommt
// bei freigegebener Herkunft eine lesbare Antwort (401), sonst scheitert sie. Kein Geheimnis wird gesendet oder angezeigt.
function workerHerkunftText() {
  const o = typeof location !== "undefined" ? location : null;
  const herkunft = !o ? "unbekannt" : o.protocol === "https:" || o.protocol === "http:" ? o.origin : `keine Webadresse (${o.protocol.replace(":", "")} – z. B. lokal geöffnete Datei oder App-Vorschau)`;
  let pfad = "";
  try { const u = new URL(verbindung.url); if (u.pathname && u.pathname !== "/") pfad = ` · Die Worker-Adresse enthält einen Pfad („${u.pathname.slice(0, 40)}“) – eingetragen werden sollte nur https://NAME.workers.dev.`; } catch (e) { /* Adresse ungültig – fetch hat das schon gemeldet */ }
  return ` · Herkunft dieser Seite: ${herkunft}${pfad}`;
}
async function workerErreichbarkeit() {
  const sig = () => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined);
  const basis = verbindung.url.replace(/\/+$/, "");
  try {
    await fetch(basis + "/", { mode: "no-cors", cache: "no-store", credentials: "omit", signal: sig() });
  } catch (e) {
    return " · Gegenprobe: Die Worker-Adresse ist von diesem Gerät nicht erreichbar (kein Internet, DNS-Filter oder „Privates DNS“, VPN oder Werbeblocker sperrt *.workers.dev)." + workerHerkunftText();
  }
  let zweite;
  try {
    const a = await fetch(basis + "/status", { method: "GET", mode: "cors", cache: "no-store", credentials: "omit", signal: sig() });
    zweite = ` · Zweite Probe: Die Herkunft dieser Seite ist im Worker freigegeben (Antwort ${a.status} ohne Zugangscode) – abgewiesen wurde nur die Anfrage mit Zugangscode: Browser-Erweiterung, Sicherheitseinstellung oder gestörte Vorabfrage (CORS); Seite neu laden und ohne Erweiterungen testen.`;
  } catch (e) {
    zweite = " · Zweite Probe: Der Worker beantwortet Anfragen von dieser Herkunft nicht (CORS, Herkunft nicht freigegeben) – Dashboard über seine veröffentlichte https-Adresse öffnen, nicht als lokale Datei, App-Vorschau oder über eine andere Adresse.";
  }
  return " · Gegenprobe: Die Worker-Adresse ist von diesem Gerät erreichbar – der Browser hat die eigentliche Anfrage abgewiesen (häufig: Zeichen im Zugangscode, Browser-Erweiterung oder Sicherheitseinstellung)." + zweite + workerHerkunftText();
}
// ab 16j (ANA-S16, wie facts.py:92-94): zwischen zwei SEC-Anfragen (/aktien/quelle?art=sec-…) mindestens 150 ms – auch wenn mehrere
// Werkzeuge gleichzeitig laden (jede Anfrage reserviert ihren Zeitpunkt). Monotone Seitenuhr, damit Testuhren/verstellte Zeit nicht stören.
const SEC_DROSSEL = { naechste: 0, abstandMs: 150 };
async function secDrosseln(pfad) {
  if (!/^\/aktien\/quelle\?art=sec-/.test(String(pfad || ""))) return;
  const jetzt = performance.now(), start = Math.max(jetzt, SEC_DROSSEL.naechste);
  SEC_DROSSEL.naechste = start + SEC_DROSSEL.abstandMs;
  if (start > jetzt) await new Promise((ok) => setTimeout(ok, start - jetzt));
}
async function workerAnfrage(pfad, optionen = {}, versuch = 1) {
  // nur SEC-Pfade warten – andere Abrufe bleiben ohne „await“ vor fetch (synchroner Aufrufstapel, z. B. für die Erkennung von Hintergrundabrufen)
  if (versuch === 1 && /^\/aktien\/quelle\?art=sec-/.test(String(pfad || ""))) await secDrosseln(pfad);
  const methode = (optionen.method || "GET").toUpperCase();
  const { abbruch, ...fetchOptionen } = optionen;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const fehler = Object.assign(new Error("Offline – keine Internetverbindung. Es wurde nichts gesendet."), { netzwerk: true, nichtGesendet: true });
    diagnoseErfassen({ quelle: "worker", methode, pfad, art: "offline", meldung: fehler.message });
    throw fehler;
  }
  const codeProblem = zugangscodeProblem(verbindung.code);
  if (codeProblem) {
    diagnoseErfassen({ quelle: "worker", methode, pfad, art: "fehler", meldung: codeProblem });
    throw Object.assign(new Error(codeProblem), { zugangscode: true });
  }
  // Eigenes, kürzeres Zeitlimit möglich (z. B. Statusabfragen); sonst das allgemeine
  const zeitMs = Number.isFinite(optionen.zeitlimitMs) && optionen.zeitlimitMs > 0 ? optionen.zeitlimitMs : WORKER_ZEITLIMIT.ms;
  const zeitSignal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(zeitMs) : undefined;
  const signal = optionen.signal
    || (abbruch && zeitSignal && typeof AbortSignal.any === "function" ? AbortSignal.any([abbruch.signal, zeitSignal]) : (abbruch ? abbruch.signal : zeitSignal));
  const { zeitlimitMs, headers: zusatzHeader, ...ohneZusatz } = fetchOptionen;
  let antwort;
  try {
    antwort = await fetch(verbindung.url.replace(/\/+$/, "") + pfad, {
      ...ohneZusatz,
      signal,
      headers: {
        // zusätzliche Kopfzeilen (z. B. x-jarvis-freigabe) dürfen Zugangscode und Inhaltstyp nicht überschreiben
        ...(zusatzHeader && typeof zusatzHeader === "object" ? zusatzHeader : {}),
        "content-type": "application/json",
        "x-jarvis-zugang": verbindung.code,
      },
    });
  } catch (e) {
    if (abbruch && abbruch.signal.aborted) throw Object.assign(new Error("Anfrage abgebrochen."), { netzwerk: true, abgebrochen: true });
    const zeitlimit = Boolean(e && (e.name === "TimeoutError" || e.name === "AbortError"));
    if (!zeitlimit && methode === "GET" && versuch === 1) {
      netzHinweis("Verbindung zum Worker unterbrochen – zweiter Versuch …");
      await new Promise((ok) => setTimeout(ok, WORKER_WIEDERHOLUNG.ms));
      const daten = await workerAnfrage(pfad, optionen, 2);
      netzHinweis("Zweiter Versuch erfolgreich.", 3000);
      return daten;
    }
    const fehler = Object.assign(new Error(zeitlimit
      ? "Zeitüberschreitung – der Worker hat nicht rechtzeitig geantwortet."
      : "Worker nicht erreichbar – bitte Internetverbindung und Worker-Adresse prüfen."), { netzwerk: true, zeitlimit });
    diagnoseErfassen({ quelle: "worker", methode, pfad, art: zeitlimit ? "zeitlimit" : "netzwerk", meldung: fehler.message, versuche: versuch });
    if (versuch === 2) netzHinweis("Auch der zweite Versuch ist fehlgeschlagen – Worker nicht erreichbar.", 6000);
    throw fehler;
  }
  let daten = null;
  try { daten = JSON.parse(await antwort.text()); } catch (e) { /* leere oder ungültige Antwort */ }
  if (!antwort.ok) {
    // ab 11-03c: Fehlertext des Workers ohne Schlüssel/Tokens (er wird an vielen Stellen direkt angezeigt)
    const fehler = Object.assign(new Error(geheimnisMuster((daten && daten.fehler) || "Fehler " + antwort.status).slice(0, 500)), { status: antwort.status, daten });
    diagnoseErfassen({ quelle: "worker", methode, pfad, art: "http", status: antwort.status, meldung: fehler.message });
    throw fehler;
  }
  if (!daten || typeof daten !== "object") {
    diagnoseErfassen({ quelle: "worker", methode, pfad, art: "antwort", status: antwort.status, meldung: "Ungültige Antwort des Workers (kein JSON)." });
    throw new Error("Ungültige Antwort des Workers (kein JSON).");
  }
  return daten;
}

// ab 15f: Fehler einer Worker-Anfrage in einen von vier verständlichen Zuständen einordnen (der fünfte, „veraltet“, ergibt sich
// nicht aus einem Fehler, sondern aus dem Alter der gelieferten Daten und wird dort gemeldet). null = nicht eindeutig einzuordnen.
function workerZustand(e) {
  if (!e || typeof e !== "object") return null;
  const d = e.daten && typeof e.daten === "object" ? e.daten : {};
  if (e.zugangscode || e.message === "Unbekannter Endpunkt." || d.eingerichtet === false || d.fehlercode === "konfiguration" || d.sperre_fehlt || d.fehlercode === "wache_fehlt") return "nicht eingerichtet";
  if (e.netzwerk || e.zeitlimit || e.nichtGesendet) return "nicht erreichbar";
  if ([401, 403, 409, 429].includes(e.status)) return "abgelehnt";
  if (e.status === 404 || /kein JSON/.test(String(e.message || ""))) return "keine Daten";
  if ([502, 503, 504].includes(e.status)) return "nicht erreichbar";
  return null;
}

// ---------- Netzstatus und technische Fehlerdiagnose ----------
// Hinweisleiste unten: offline/online, Wiederholungen. dauerMs = automatisch ausblenden.
let netzUhr = null;
function netzHinweis(text, dauerMs) {
  const el = document.getElementById("netz-status");
  if (!el) return;
  clearTimeout(netzUhr);
  el.textContent = text;
  el.hidden = !text;
  if (dauerMs) netzUhr = setTimeout(() => { el.hidden = true; }, dauerMs);
}
window.addEventListener("offline", () => netzHinweis("Offline – keine Internetverbindung. Lokale Funktionen (Aufgaben, Profil, Verlauf) gehen weiter; an den Worker wird nichts gesendet."));
window.addEventListener("online", () => netzHinweis("Wieder online.", 4000));

// Fehlerprotokoll: nur technische Angaben (Zeit, Quelle, Methode, Pfad ohne Parameter, Art, Status, gekürzte Meldung),
// keine Inhalte von Anfragen, keine Nutzertexte. Codes, Schlüssel und Tokens werden vor dem Speichern entfernt.
const DIAGNOSE = { schluessel: "jarvis-diagnose", max: 30 };
// Gemeinsame Geheimnis-Muster (ab 11-03c) für alle Fehlertexte von außen (workerAnfrage, helferAnfrage, wzRoh), für
// geheimnisseEntfernen und für das Diagnoseprotokoll: gespeicherte Codes dieses Browsers, API-Schlüssel (auch in Großschrift),
// Bearer, JWT, private Schlüssel und Zuweisungen wie api_key=… / ?token=… / client_secret: …. Steht hier (früher Skriptblock),
// weil workerAnfrage schon beim Seitenstart läuft. Normale Texte (Symbole, Kurse, Zeitstempel, Hashes, Fehlercodes) bleiben gleich.
// zuweisungen: false für gespeicherte JSON-Werte (Sicherung) – die Zuweisungsregel könnte dort gültiges JSON zerstören
function geheimnisMuster(text, { zuweisungen = true } = {}) {
  let s = String(text == null ? "" : text);
  // ab 16g auch der auf dem Tablet gespeicherte Freigabecode der autonomen Paper-Ausführung (app/81)
  for (const geheim of [verbindung.code, einstellungLesen("jarvis-zugangscode"), einstellungLesen("jarvis-helfer-code"), einstellungLesen("jarvis-freigabe-tablet")]) {
    if (geheim && geheim.length >= 4) s = s.split(geheim).join("[entfernt]");
  }
  s = s
    .replace(/sk-ant-[A-Za-z0-9_\-]{6,}/gi, "[entfernt]").replace(/\bsk-[A-Za-z0-9_\-]{16,}/gi, "[entfernt]")
    .replace(/\bAIza[0-9A-Za-z_\-]{20,}/g, "[entfernt]")
    .replace(/\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{10,}/gi, "[entfernt]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]{6,}/gi, "Bearer [entfernt]")
    .replace(/eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]*/g, "[entfernt]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[entfernt]");
  return zuweisungen ? s.replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|token|secret|passwor[dt]|zugangscode)["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi, "$1[entfernt]") : s;
}
function diagnoseBereinigen(text) {
  return geheimnisMuster(text)
    // zusätzlich nur im Protokoll: weitere Zuweisungen (reine Zahlen wie „Fehlercode: 429“ bleiben lesbar) und lange Zufallsfolgen
    .replace(/((?:zugang|code|token|key|schlüssel|passwort|password|secret)\w*["']?\s*[:=]\s*["']?)(?!\d+\b)[^\s"',;]+/gi, "$1[entfernt]")
    .replace(/[A-Za-z0-9+/_\-]{32,}/g, (t) => (/\d/.test(t) && /[A-Za-z]/.test(t) ? "[entfernt]" : t))
    .slice(0, 200);
}
function diagnoseLesen() {
  try { const d = JSON.parse(localStorage.getItem(DIAGNOSE.schluessel) || "[]"); return Array.isArray(d) ? d : []; } catch (e) { return []; }
}
function diagnoseErfassen(eintrag) {
  const e = {
    zeit: new Date().toISOString(),
    quelle: eintrag.quelle === "helfer" ? "helfer" : "worker",
    methode: String(eintrag.methode || "GET").slice(0, 6),
    pfad: String(eintrag.pfad || "").split("?")[0].replace(/[^\w\/\-]/g, "").slice(0, 60),
    art: String(eintrag.art || "fehler"),
    status: Number.isInteger(eintrag.status) ? eintrag.status : null,
    versuche: eintrag.versuche || 1,
    meldung: diagnoseBereinigen(eintrag.meldung),
    online: typeof navigator === "undefined" ? null : navigator.onLine !== false,
  };
  const liste = [...diagnoseLesen(), e].slice(-DIAGNOSE.max);
  try { localStorage.setItem(DIAGNOSE.schluessel, JSON.stringify(liste)); } catch (err) { /* privater Modus: nur Anzeige */ }
  diagnoseAnzeigen(liste);
}
const DIAGNOSE_ART = { netzwerk: "nicht erreichbar", zeitlimit: "Zeitüberschreitung", offline: "offline, nicht gesendet", http: "Fehlerantwort", antwort: "ungültige Antwort", fehler: "Fehler" };
function diagnoseZeile(e) {
  return new Date(e.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" }) + " · " + (e.quelle === "helfer" ? "PC-Helfer" : "Worker")
    + " " + e.methode + " " + e.pfad + " · " + (DIAGNOSE_ART[e.art] || e.art) + (e.status ? " " + e.status : "")
    + (e.versuche > 1 ? " · " + e.versuche + " Versuche" : "") + (e.online === false ? " · Gerät offline" : "") + (e.meldung ? " · " + e.meldung : "");
}
// Text zum Weitergeben (z. B. an den Support): Stand-Kennung, Browser-Kurzinfo, Einträge – ohne Adresse, Code und Inhalte
function diagnoseText() {
  const liste = diagnoseLesen();
  const kennung = (document.getElementById("stand-kennung") || {}).textContent || "";
  return ["JARVIS – technische Diagnose (" + kennung + "), erstellt " + new Date().toLocaleString("de-DE"),
    "Browser: " + String(navigator.userAgent || "").replace(/\s*\([^)]*\)/g, "").slice(0, 120) + " · online: " + (navigator.onLine !== false ? "ja" : "nein"),
    liste.length ? liste.length + " Einträge:" : "Keine Einträge.", ...liste.map(diagnoseZeile)].join("\n");
}
function diagnoseAnzeigen(liste = diagnoseLesen()) {
  const ul = document.getElementById("diagnose-liste");
  if (!ul) return;
  ul.replaceChildren(...(liste.length ? liste.slice().reverse().map((e) => Object.assign(document.createElement("li"), { textContent: diagnoseZeile(e) }))
    : [Object.assign(document.createElement("li"), { textContent: "Keine fehlgeschlagenen Anfragen protokolliert." })]));
  document.getElementById("diagnose-anzahl").textContent = liste.length ? liste.length + " Fehler" : "keine Fehler";
}
async function diagnoseKopieren() {
  const text = diagnoseText();
  const meldung = document.getElementById("diagnose-meldung");
  try {
    await navigator.clipboard.writeText(text);
    meldung.textContent = "In die Zwischenablage kopiert (" + diagnoseLesen().length + " Einträge).";
  } catch (e) {
    meldung.textContent = "Kopieren nicht möglich (Browser erlaubt keinen Zugriff auf die Zwischenablage).";
  }
  return text;
}
function diagnoseLoeschen() {
  if (!diagnoseLesen().length || !confirm("Diagnose-Protokoll löschen?")) return false;
  try { localStorage.removeItem(DIAGNOSE.schluessel); } catch (e) { /* nichts gespeichert */ }
  diagnoseAnzeigen([]);
  document.getElementById("diagnose-meldung").textContent = "Protokoll gelöscht.";
  return true;
}
document.getElementById("diagnose-kopieren").addEventListener("click", diagnoseKopieren);
document.getElementById("diagnose-loeschen").addEventListener("click", diagnoseLoeschen);
diagnoseAnzeigen();

async function verbindungPruefen() {
  if (!verbindung.url || !verbindung.code) {
    kiStatusSetzen("NICHT EINGERICHTET", "", "offline");
    return;
  }
  kiStatusSetzen("PRÜFE …", "", "pruefe");
  try {
    const daten = await workerAnfrage("/status", { method: "GET" });
    // Aktien-Stand: nur wenn der Worker ausdrücklich krypto_aktiv false meldet, Krypto-Karten ausblenden (ältere Worker: wie bisher)
    document.body.classList.toggle("krypto-aus", daten.krypto_aktiv === false);
    // ab 14zf: Worker ohne Aktien-Funktionen (z. B. 2026-10-31c: /status ohne aktien_konfiguriert, keine /aktien/*-Routen) ausdrücklich nennen
    const ohneAktien = !("aktien_konfiguriert" in daten) ? ` · Worker ${String(daten.version || "?").slice(0, 20)} ohne Aktien-Funktionen: US-Aktien-Kurse, SEC und Alpaca-Paper erst mit dem Aktien-Worker` : daten.aktien_konfiguriert === false ? " · Aktien: Alpaca-Paper-Schlüssel im Worker nicht eingerichtet" : "";
    if (daten.ki_konfiguriert) {
      kiStatusSetzen("VERBUNDEN (" + daten.modell + ")" + ohneAktien, "#7affc4", "verbunden");
    } else {
      kiStatusSetzen("WORKER OHNE API-SCHLÜSSEL" + ohneAktien, "#ffcc66", "warnung");
    }
  } catch (e) {
    // ab 14zd: bei Netzfehler Gegenprobe ohne Zugangscode – trennt Gerät/Netz von einer vom Browser abgewiesenen Anfrage
    const zusatz = e && e.netzwerk && !e.nichtGesendet && !e.abgebrochen && !e.zeitlimit && !e.weiterleitung ? await workerErreichbarkeit() : "";
    kiStatusSetzen("FEHLER – " + e.message + zusatz, "#ff9b9b", "fehler");
  }
}

function verbindungSpeichern() {
  verbindung.url = document.getElementById("worker-url").value.trim();
  verbindung.code = document.getElementById("zugangscode").value;
  // ab 11-04e: beide Schreibvorgänge versucht und ausgewertet (vorher „VERBUNDEN“ ohne Hinweis, obwohl nichts gespeichert war)
  const gespeichert = [einstellungSchreiben("jarvis-worker-url", verbindung.url), einstellungSchreiben("jarvis-zugangscode", verbindung.code)].every(Boolean);
  document.getElementById("verbindung-meldung").textContent = gespeichert ? ""
    : "Nicht gespeichert: Browserspeicher gesperrt oder voll – Adresse und Zugangscode gelten nur für diese Sitzung; nach dem Neuladen gilt wieder der vorherige Stand.";
  verbindungPruefen();
  tradingLaden();
  if (window.analyseLaden) analyseLaden({ erzwingen: true });
}

// text: optional (Spracheingabe) – sonst der Inhalt des Eingabefelds. Getippter Text bleibt dabei unberührt.
async function jarvisAntwort(text) {
  const eingabe = document.getElementById("befehl");
  const knopf = document.getElementById("senden");
  const ausFeld = typeof text !== "string";
  const befehl = (ausFeld ? eingabe.value : text).trim();
  if (!befehl || knopf.disabled) return;
  // Zu lang für den Worker: nicht senden (er würde ablehnen), Text bleibt zum Kürzen im Eingabefeld
  if (befehl.length > CHAT_GRENZEN.nachricht) {
    eingabe.value = befehl;
    nachrichtAnzeigen("JARVIS: Die Nachricht ist zu lang (" + befehl.length.toLocaleString("de-DE") + " Zeichen, höchstens "
      + CHAT_GRENZEN.nachricht.toLocaleString("de-DE") + "). Sie wurde nicht gesendet und steht noch im Eingabefeld – bitte kürzen.", "jarvis fehler");
    return;
  }

  if (ausFeld) eingabe.value = "";
  const nutzerNachricht = nachrichtAnzeigen(befehl, "nutzer");
  eingabeNr++;
  if (typeof befehlMerken === "function") befehlMerken(befehl); // ab 11-07c: ↑/↓ im Eingabefeld (nur diese Sitzung)

  // Lokale Skills (Hilfe, Paper-Befehle, …) haben Vorrang; passt keiner, geht der Text wie bisher an die KI.
  // Paper-Orders nur über /paper/order und erst nach ausdrücklichem „Ja“ – nie an eine Börse.
  if (await skillAusfuehren(befehl)) return;

  if (!verbindung.url || !verbindung.code) {
    const text = offlineAntwort(befehl);
    nachrichtAnzeigen("JARVIS: " + text, "jarvis");
    untertitelSetzen(befehl, text);
    lokalVorlesen(text);
    return;
  }

  // Profil: nur die für genau diese Anfrage ausgewählten Einträge; danach gilt wieder die Vorauswahl.
  // Der Verlauf speichert nur den Befehl – Profilangaben gehen nie unbemerkt mit späteren Anfragen mit.
  let profilTeil = window.profilIntern ? window.profilIntern.fuerAnfrage() : null;
  if (profilTeil && (profilTeil.kontext + befehl).length > CHAT_GRENZEN.nachricht) {
    nutzerNachricht.appendChild(Object.assign(document.createElement("small"), { className: "profil-hinweis", textContent: "Profil weggelassen – Nachricht samt Profil wäre länger als " + CHAT_GRENZEN.nachricht.toLocaleString("de-DE") + " Zeichen" }));
    profilTeil = null;
  }
  if (profilTeil) {
    nutzerNachricht.appendChild(Object.assign(document.createElement("small"), { className: "profil-hinweis", textContent: "mit Profil: " + profilTeil.titel.join(", ") }));
  }
  verlauf.push({ role: "user", content: befehl });
  knopf.disabled = true;
  // „Abbrechen“ beendet das Warten; eine trotzdem eintreffende Antwort wird verworfen (kein automatischer Neuversand)
  const abbruch = new AbortController();
  const abbrechenKnopf = document.getElementById("abbrechen");
  abbrechenKnopf.onclick = () => abbruch.abort();
  abbrechenKnopf.hidden = false;
  // Per Tastatur auf SENDEN: der Knopf sperrt sich jetzt – Fokus auf ABBRECHEN statt verloren (danach zurück ins Eingabefeld)
  if (document.activeElement === knopf) abbrechenKnopf.focus();
  const kern = document.getElementById("kern");
  kern.classList.add("denkt");
  untertitelSetzen(befehl, "…");
  const platzhalter = nachrichtAnzeigen("JARVIS denkt nach …", "jarvis denkt");

  try {
    // Nur die letzten Nachrichten senden; Anfang muss eine user-Nachricht sein; Worker-Grenzen einhalten (chatAuszug)
    const auszug = kiKontextFuerVersand(chatAuszug(profilTeil ? [...verlauf.slice(0, -1), { role: "user", content: profilTeil.kontext + befehl }] : verlauf));

    const daten = await workerAnfrage("/chat", {
      method: "POST",
      body: JSON.stringify({ messages: auszug }),
      abbruch,
    });
    if (typeof daten.antwort !== "string" || !daten.antwort.trim()) {
      throw new Error("Ungültige Antwort des Workers (keine Antwort enthalten).");
    }
    verlauf.push({ role: "assistant", content: daten.antwort });
    // Nutzung nur als Mengen (keine Inhalte): echte Zahlen vom Worker, sonst Schätzung aus der Textlänge (gekennzeichnet)
    if (window.kiNutzungErfassen) window.kiNutzungErfassen({ art: "chat", modell: daten.modell, nutzung: daten.nutzung, audio: Boolean(daten.audioContent),
      eingabeZeichen: auszug.reduce((s, m) => s + m.content.length, 0), ausgabeZeichen: daten.antwort.length, vorleseZeichen: vorleseText(daten.antwort).length });
    platzhalter.className = "nachricht jarvis";
    platzhalter.textContent = "JARVIS: " + daten.antwort;
    untertitelSetzen(null, daten.antwort);
    // Stand die Statuszeile wegen eines Verbindungsfehlers auf „Fehler“, ist der Worker jetzt nachweislich wieder erreichbar
    if (kern.dataset.zustand === "fehler") {
      if (daten.modell) kiStatusSetzen("VERBUNDEN (" + daten.modell + ")", "#7affc4", "verbunden");
      else verbindungPruefen();
    }
    antwortVorlesen(daten);
  } catch (e) {
    verlauf.pop(); // unbeantwortete Frage entfernen, damit der Verlauf abwechselnd bleibt
    if (e.abgebrochen) {
      platzhalter.className = "nachricht jarvis";
      platzhalter.textContent = "JARVIS: Anfrage abgebrochen – eine eventuell noch eintreffende Antwort wird verworfen.";
      untertitelSetzen(null, "Abgebrochen.");
    } else {
      platzhalter.className = "nachricht fehler";
      platzhalter.textContent = "Verbindungsproblem: " + e.message;
      untertitelSetzen(null, "Verbindungsproblem – Details im Gesprächsverlauf.");
      // Keine Antwort vom Worker (Netz, Zeitlimit, offline): die Statuszeile darf nicht weiter „VERBUNDEN“ zeigen
      if (e.netzwerk) kiStatusSetzen(e.weiterleitung ? "WEITERLEITUNG ABGELEHNT – nichts weitergesendet" : e.nichtGesendet ? "OFFLINE – nichts gesendet" : e.zeitlimit ? "ZEITÜBERSCHREITUNG – Worker antwortet nicht" : "WORKER NICHT ERREICHBAR", "#ff9b9b", "fehler");
    }
  } finally {
    abbrechenKnopf.hidden = true;
    abbrechenKnopf.onclick = null;
    knopf.disabled = false;
    kern.classList.remove("denkt");
    eingabe.focus();
  }
}

document.getElementById("befehl").addEventListener("keydown", function (event) {
  if (event.key === "Enter") jarvisAntwort();
});

// ---------- Gesprächsverlauf: optional dauerhaft auf diesem Gerät ----------
// Standard: nichts wird gespeichert (nach dem Neuladen ist die Unterhaltung weg). Erst „Auf diesem Gerät speichern“
// legt Nachrichten und KI-Kontext im Browserspeicher ab. Zugangscode und schlüsselähnliche Werte werden vorher entfernt.
const VERLAUF_SCHLUESSEL = "jarvis-verlauf";
const VERLAUF_MAX_NACHRICHTEN = 100;
let verlaufSpeicherOk = true;

function verlaufDauerhaft() { return einstellungLesen("jarvis-verlauf-speichern") === "an"; }

function verlaufBereinigen(text) {
  let s = String(text);
  if (verbindung.code && verbindung.code.length >= 4) s = s.split(verbindung.code).join("[entfernt]");
  return s
    .replace(/sk-ant-[A-Za-z0-9_\-]{10,}/g, "[entfernt]")
    .replace(/\bAIza[0-9A-Za-z_\-]{20,}/g, "[entfernt]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]{10,}/gi, "Bearer [entfernt]")
    .replace(/eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]+/g, "[entfernt]");
}

// Anzeige und Export gespeicherter Nachrichten (ab 11-03d): mit den Mustern aus geheimnisMuster (auch Zuweisungen wie api_key=…).
// Der gespeicherte Text selbst bleibt unverändert (siehe dataset.roh), damit Laden nichts still überschreibt.
const verlaufAnzeigeText = (text) => geheimnisMuster(text, { zuweisungen: true });

// Sichtbare Nachrichten ohne „denkt nach“-Platzhalter und ohne Knopfbeschriftungen (z. B. Paper-Rückfrage).
// Wiederhergestellte Nachrichten tragen ihren gespeicherten Originaltext in dataset.roh – er wird unverändert zurückgespeichert.
function verlaufNachrichten() {
  return [...document.querySelectorAll("#chatverlauf .nachricht")]
    .filter((el) => !el.classList.contains("denkt"))
    .map((el) => ({
      art: el.classList.contains("nutzer") ? "nutzer" : el.classList.contains("fehler") ? "fehler" : "jarvis",
      text: el.dataset.roh !== undefined ? el.dataset.roh : verlaufBereinigen([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("")),
      zeit: el.dataset.zeit || "",
    }))
    .filter((n) => n.text.trim());
}

function verlaufSichern() {
  if (!verlaufDauerhaft()) return;
  const daten = {
    version: 1,
    gespeichert: new Date().toISOString(),
    nachrichten: verlaufNachrichten().slice(-VERLAUF_MAX_NACHRICHTEN),
    ki: verlauf.slice(-MAX_VERLAUF).map((m) => ({ role: m.role, content: verlaufBereinigen(m.content) })),
  };
  if (speicherBeschaedigt(VERLAUF_SCHLUESSEL)) { verlaufSpeicherOk = false; verlaufModusAnzeigen(); return; }
  try { localStorage.setItem(VERLAUF_SCHLUESSEL, JSON.stringify(daten)); } catch (e) { verlaufSpeicherOk = false; verlaufModusAnzeigen(); }
}

function verlaufWiederherstellen() {
  if (!verlaufDauerhaft()) return 0;
  let daten = null;
  try { daten = speicherJsonLesen(VERLAUF_SCHLUESSEL, (d) => istObjekt(d) && Array.isArray(d.nachrichten)); } catch (e) { daten = null; }
  if (speicherBeschaedigt(VERLAUF_SCHLUESSEL)) { verlaufSpeicherOk = false; verlaufModusAnzeigen(); }
  if (!daten || !Array.isArray(daten.nachrichten)) return 0;
  for (const n of daten.nachrichten) {
    if (n && typeof n.text === "string" && ["nutzer", "jarvis", "fehler"].includes(n.art)) {
      const anzeige = verlaufAnzeigeText(n.text);
      const el = nachrichtAnzeigen(anzeige, n.art);
      if (anzeige !== n.text) el.dataset.roh = n.text;
      const zeit = typeof n.zeit === "string" && !isNaN(Date.parse(n.zeit)) ? n.zeit : daten.gespeichert;
      if (zeit) el.dataset.zeit = zeit;
    }
  }
  verlauf.length = 0;
  for (const m of daten.ki || []) {
    if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") verlauf.push({ role: m.role, content: m.content });
  }
  return daten.nachrichten.length;
}

function verlaufModusAnzeigen() {
  const kasten = document.getElementById("verlauf-dauerhaft");
  kasten.checked = verlaufDauerhaft() && verlaufSpeicherOk;
  kasten.disabled = !verlaufSpeicherOk;
  document.getElementById("verlauf-modus").textContent = !verlaufSpeicherOk
    ? (speicherBeschaedigt(VERLAUF_SCHLUESSEL) ? "Gespeicherter Verlauf beschädigt – nichts wird überschrieben, nur diese Sitzung. Unter „Daten auf diesem Gerät“ den Bereich löschen (vorher bei Bedarf „Sicherung exportieren“)."
      : "Speichern auf diesem Gerät nicht möglich (Browserspeicher gesperrt) – nur diese Sitzung")
    : verlaufDauerhaft()
      ? "Dauerhaft auf diesem Gerät gespeichert – bis „Verlauf löschen“ oder Ausschalten"
      : "Nur diese Sitzung – wird beim Neuladen gelöscht";
}

function verlaufLoeschen() {
  if (!confirm("Gesprächsverlauf löschen?\nDie Unterhaltung wird aus der Anzeige und – falls gespeichert – von diesem Gerät entfernt.\nAngeheftete Nachrichten bleiben erhalten (einzeln lösen unter „Suchen & Angeheftet“).")) return;
  document.getElementById("chatverlauf").replaceChildren();
  verlauf.length = 0;
  if (typeof befehlsverlaufLoeschen === "function") befehlsverlaufLoeschen(); // ab 11-07c
  try {
    localStorage.removeItem(VERLAUF_SCHLUESSEL);
    // ab 11-06b: ausdrücklich gelöscht – ein beschädigter Stand ist damit ersetzt
    if (speicherBeschaedigt(VERLAUF_SCHLUESSEL)) { SPEICHER_SCHADEN.delete(VERLAUF_SCHLUESSEL); verlaufSpeicherOk = true; verlaufModusAnzeigen(); }
  } catch (e) { /* nichts gespeichert */ }
  untertitelSetzen("", "");
}

function verlaufExportieren() {
  const jetzt = new Date();
  const zeilen = ["JARVIS – Gesprächsverlauf, exportiert am " + jetzt.toLocaleString("de-DE"), ""];
  for (const n of verlaufNachrichten()) zeilen.push((n.art === "nutzer" ? "[Sie] " : n.art === "fehler" ? "[Fehler] " : "") + verlaufAnzeigeText(n.text));
  const datei = new Blob([zeilen.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(datei);
  link.download = "jarvis-verlauf-" + jetzt.toISOString().slice(0, 10) + ".txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

document.getElementById("verlauf-dauerhaft").addEventListener("change", (e) => {
  if (e.target.checked) {
    einstellungSchreiben("jarvis-verlauf-speichern", "an");
    try { localStorage.setItem("jarvis-verlauf-test", "1"); localStorage.removeItem("jarvis-verlauf-test"); } catch (_) { verlaufSpeicherOk = false; }
    verlaufSichern();
  } else {
    einstellungSchreiben("jarvis-verlauf-speichern", "aus");
    try { localStorage.removeItem(VERLAUF_SCHLUESSEL); } catch (_) { /* nichts gespeichert */ }
  }
  verlaufModusAnzeigen();
});
document.getElementById("verlauf-loeschen").addEventListener("click", verlaufLoeschen);
document.getElementById("verlauf-export").addEventListener("click", verlaufExportieren);
// Jede Änderung im Gesprächsverlauf (neue Nachricht, „denkt nach“ → Antwort) sichern, falls eingeschaltet
new MutationObserver(() => verlaufSichern()).observe(document.getElementById("chatverlauf"), { childList: true, subtree: true, characterData: true });
try { localStorage.getItem("jarvis-verlauf-test"); } catch (e) { verlaufSpeicherOk = false; }
verlaufWiederherstellen();
verlaufModusAnzeigen();

document.getElementById("worker-url").value = verbindung.url;
document.getElementById("zugangscode").value = verbindung.code;
// Ohne gespeicherte Verbindung die Einstellungen gleich aufgeklappt zeigen
if (!verbindung.url || !verbindung.code) document.getElementById("verbindung-karte").open = true;
verbindungPruefen();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("chat-ki");
