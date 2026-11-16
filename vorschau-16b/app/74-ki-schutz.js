// JARVIS Dashboard – Modul „ki-schutz“ (ab 11-13h). Lücken der Angriffsprobe (docs/AUFTRAG_13.md, Block 8) beim Umgang mit
// geheimen Schlüsseln. Bestand: Chat und Recherche entfernen Schlüssel vor dem Versand (kiKontextFuerVersand, 11-03e), das Profil
// lehnt sie ab (15), Verlauf und Diagnose speichern sie nicht. Es fehlten:
//   - Frage zur Bildanalyse: ging an /bild ohne Filter → Schlüssel werden jetzt wie im Chat entfernt, der Rest geht weiter
//   - Notizen: speicherten Schlüssel im Klartext im Browserspeicher → werden jetzt mit Begründung abgelehnt (wie das Profil)
//   - ab 11-13m: Worker-Adresse nur HTTPS (lokal http://127.0.0.1/localhost) – beim Speichern im Cockpit und vor jedem Senden
//   - ab 11-13o: Worker-Anfragen ohne Weiterleitung; Binärabruf wzRoh mit derselben HTTPS-Regel
//   - ab 11-13p: Weiterleitung wird erkannt (redirect: "manual") und eigens gemeldet statt als „Worker nicht erreichbar“
// Erkennung = das vorhandene geheimnisMuster (02): API-Schlüssel (sk-ant-, sk-, AIza, ghp_ …), Bearer, JWT, private Schlüssel,
// Zuweisungen wie „passwort: …“ / „api_key=…“ und die in diesem Browser gespeicherten Zugangscodes. Keine Anfrage, kein Speicher.
const KI_SCHUTZ_TEXT = "Das sieht nach einem geheimen Schlüssel, Passwort oder Zugangscode aus – so etwas speichere ich nicht im Browser (API-Schlüssel gehören nur als Secret in den Worker).";
function kiGeheimnisFund(text) { const t = String(text == null ? "" : text); return typeof geheimnisMuster === "function" && t.length > 3 && geheimnisMuster(t) !== t; }
if (typeof workerAnfrage === "function") {
  const original = workerAnfrage;
  workerAnfrage = async function (pfad, optionen = {}, ...rest) {
    if (pfad === "/bild" && typeof optionen.body === "string") {
      let d = null; try { d = JSON.parse(optionen.body); } catch (e) { /* kein JSON – unverändert */ }
      if (d && typeof d.frage === "string" && kiGeheimnisFund(d.frage)) return original.call(this, pfad, { ...optionen, body: JSON.stringify({ ...d, frage: geheimnisMuster(d.frage) }) }, ...rest);
    }
    return original.call(this, pfad, optionen, ...rest);
  };
}
// ab 11-13m: Worker-Adresse nur HTTPS (lokal auch http://127.0.0.1 bzw. localhost) – der Einrichtungsassistent (14) prüfte das schon,
// das Cockpit-Formular (02) nicht; mit einer http-Adresse ging der Zugangscode (x-jarvis-zugang) unverschlüsselt hinaus
const KI_ADRESSE_OK = /^(https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:\d+)?(\/[^\s]*)?|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[^\s]*)?)$/i;
if (typeof verbindungSpeichern === "function") {
  const original = verbindungSpeichern;
  verbindungSpeichern = function () {
    const feld = document.getElementById("worker-url"), u = feld ? feld.value.trim() : "";
    if (u && !KI_ADRESSE_OK.test(u)) { const m = document.getElementById("verbindung-meldung"); if (m) m.textContent = "Nicht gespeichert: Bitte eine HTTPS-Adresse eingeben, z. B. https://jarvis.NAME.workers.dev (lokal auch http://127.0.0.1:8787)."; return; }
    return original.apply(this, arguments);
  };
}
const KI_ADRESSE_FEHLER = "Nicht gesendet – die gespeicherte Worker-Adresse ist keine HTTPS-Adresse; der Zugangscode ginge unverschlüsselt hinaus. Bitte die Adresse im Cockpit neu eintragen.";
// ab 11-13p: Mit redirect: "error" kam ein TypeError wie bei einem Netzwerkfehler („Worker nicht erreichbar“, GET sogar ein zweites Mal
// gesendet – reproduziert mit tests/redirect-pruefung-13p.ps1). redirect: "manual" folgt ebenfalls nicht, liefert aber eine Antwort
// vom Typ „opaqueredirect“ (Status 0) – damit eindeutig erkennbar. Die eingetragene Adresse hat die Anfrage erhalten; ob sie dort
// etwas bewirkt hat, ist unbekannt – daher bleibt netzwerk = true (Orderpfade melden weiter „Ergebnis unklar – nicht erneut senden“).
const KI_WEITERLEITUNG_FEHLER = "Weiterleitung abgelehnt – die Worker-Adresse leitet auf eine andere Adresse weiter. An das Weiterleitungsziel wurde nichts gesendet, auch kein Zugangscode. Bitte die Worker-Adresse im Cockpit prüfen.";
function kiWeiterleitungFehler(methode, pfad) {
  if (typeof diagnoseErfassen === "function") diagnoseErfassen({ quelle: "worker", methode, pfad, art: "weiterleitung", meldung: KI_WEITERLEITUNG_FEHLER });
  return Object.assign(new Error(KI_WEITERLEITUNG_FEHLER), { netzwerk: true, weiterleitung: true, status: 0 });
}
if (typeof workerAnfrage === "function") {
  const original = workerAnfrage;
  workerAnfrage = async function (pfad, optionen, ...rest) {
    if (typeof verbindung !== "undefined" && verbindung.url && !KI_ADRESSE_OK.test(verbindung.url)) throw Object.assign(new Error(KI_ADRESSE_FEHLER), { netzwerk: true, nichtGesendet: true });
    // ab 11-13o: keiner Weiterleitung folgen – der Browser reichte den Zugangscode (eigener Header) an das Weiterleitungsziel durch
    // (nachgewiesen mit tests/redirect-pruefung-13o.ps1); der eigene Worker leitet nie weiter
    // Status 0 gibt es bei Anfragen im Modus „cors“ nur für die nicht gefolgte Weiterleitung (opaqueredirect)
    // ohne await, damit der asynchrone Aufrufstapel unverändert bleibt (die Testhilfe hintergrundAbruf erkennt Abrufe daran)
    return original.call(this, pfad, { ...(optionen || {}), redirect: "manual" }, ...rest).catch((e) => {
      if (e && e.status === 0 && !e.netzwerk) throw kiWeiterleitungFehler(((optionen && optionen.method) || "GET").toUpperCase(), pfad);
      throw e;
    });
  };
}
// ab 11-13o: Binärabruf (19, House-Clerk-ZIP) sendet den Zugangscode mit eigenem fetch – an der Sendeprüfung oben vorbei. Gleiche Logik
// wie 19 (Datei unverändert, Schutzbereich), zusätzlich HTTPS-Regel und keine Weiterleitung.
if (typeof wzRoh === "function") {
  wzRoh = async function (pfad) {
    if (!verbunden()) throw new Error("Bitte zuerst im Cockpit die Verbindung einrichten.");
    if (!KI_ADRESSE_OK.test(verbindung.url)) throw Object.assign(new Error(KI_ADRESSE_FEHLER), { netzwerk: true, nichtGesendet: true });
    let a;
    try {
      a = await fetch(verbindung.url.replace(/\/+$/, "") + pfad, {
        headers: { "x-jarvis-zugang": verbindung.code }, redirect: "manual",
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(WORKER_ZEITLIMIT.ms) : undefined,
      });
    } catch (e) {
      throw Object.assign(new Error("Worker nicht erreichbar – bitte Internetverbindung und Worker-Adresse prüfen."), { netzwerk: true });
    }
    if (a.type === "opaqueredirect") throw kiWeiterleitungFehler("GET", pfad);
    if (!a.ok) {
      let d = null;
      try { d = JSON.parse(await a.text()); } catch (e) { /* kein JSON */ }
      throw Object.assign(new Error(geheimnisMuster((d && d.fehler) || "Fehler " + a.status).slice(0, 500)), { status: a.status });
    }
    return a.arrayBuffer();
  };
}
if (typeof notizSichern === "function") {
  const original = notizSichern;
  notizSichern = function (daten) {
    if (daten && (kiGeheimnisFund(daten.titel) || kiGeheimnisFund(daten.text))) return { fehler: "Nicht gespeichert – " + KI_SCHUTZ_TEXT };
    return original.apply(this, arguments);
  };
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("ki-schutz");
