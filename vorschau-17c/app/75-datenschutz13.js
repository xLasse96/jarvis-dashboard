// JARVIS Dashboard – Modul „datenschutz13“ (ab 11-13i). Verständliche Datenschutzübersicht per Satz (docs/AUFTRAG_13.md, Block 9).
// Befund: „Ist das verschlüsselt?“, „Welche Daten speicherst du?“, „Was geht an die KI?“ wurden nicht erkannt – mit Verbindung gingen
// sie an die KI, die über Verschlüsselung und Speicherorte nur raten kann. Jetzt antwortet JARVIS lokal und nur mit Belegtem:
//   - Speicherorte (localStorage-Bereiche mit Umfang aus apDatenschutz/39, IndexedDB der Paper-Simulation), was wann an den Worker geht
//   - ausdrücklich: NICHT verschlüsselt, wer die Daten lesen kann, was das Dashboard nicht schützt; Sicherungsdateien ebenso
//   - Verweise: „Daten auf diesem Gerät“ (Löschen, Sicherung), Konzept für eine optionale Verschlüsselung (nicht umgesetzt)
// Keine Anfrage, kein Speicher.
const DS13_UNVERSCHLUESSELT = "Nicht verschlüsselt: Alle Daten liegen im Klartext im Speicher dieses Browsers (localStorage, für die Paper-Simulation IndexedDB). Lesen kann sie, wer dieses Browserprofil öffnen kann – auch Browser-Erweiterungen mit Zugriff auf die Seite und Schadsoftware auf dem Gerät. Exportierte Sicherungsdateien sind ebenfalls unverschlüsselt.";
function ds13Uebersicht() {
  const d = typeof apDatenschutz === "function" ? apDatenschutz() : { bereiche: [], verbindung: false, ki: [] };
  const zeichen = d.bereiche.reduce((n, b) => n + b.zeichen, 0);
  return [
    `Datenschutzübersicht – ${d.bereiche.length} Datenbereiche mit Inhalt (zusammen ${zeichen.toLocaleString("de-DE")} Zeichen), alle nur in diesem Browser auf diesem Gerät.`,
    DS13_UNVERSCHLUESSELT,
    d.verbindung ? "An deinen eigenen Worker gehen nur: " + d.ki.join("; ") + "." : "Die Worker-Verbindung ist nicht eingerichtet – es verlässt nichts das Gerät.",
    "Nie automatisch an die KI: Dateien, Dokumente, Projekte, Aufgaben, Notizen. Geheime Schlüssel werden vor dem Versand entfernt und nicht gespeichert. Zugangscodes gehen nur als Anmeldung an den eigenen Worker bzw. an den PC-Helfer auf diesem PC.",
    "Verwalten: Karte „Daten auf diesem Gerät“ (einzelne Bereiche löschen, Sicherung exportieren). Eine optionale Verschlüsselung mit Passwort ist beschrieben (docs/VERSCHLUESSELUNGSKONZEPT_13.md), aber nicht eingebaut.",
  ].join("\n");
}
skillRegistrieren({
  name: "datenschutz-uebersicht", risiko: "abfrage", hilfeKurz: "Datenschutz",
  beschreibung: "Datenschutzübersicht: Speicherorte, was an den Worker geht, keine Verschlüsselung (nur lokale Angaben)", beispiele: ["Datenschutzübersicht", "Sind meine Daten verschlüsselt?"],
  passt: (text) => /^(datenschutz(übersicht|uebersicht)?|zeige? (mir )?(den |die )?datenschutz(übersicht|uebersicht)?|(ist das|sind (meine |die )?daten|ist (jarvis|das dashboard)) (verschlüsselt|verschluesselt|sicher gespeichert)|welche daten (speicherst|sammelst|hast) du( über mich)?|wo (sind|liegen|werden) (meine |die )?daten( gespeichert)?|wer kann (meine |die )?daten (lesen|sehen)|was (geht|sendest du|schickst du) an (die ki|den worker|claude))$/.test(befehlNormalisieren(text)),
  aktion: async () => { lokalAntworten(ds13Uebersicht()); return true; },
});
(function ds13Einordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();
// Kachel „Datenschutz“ (39): der Hinweis auf die fehlende Verschlüsselung gehört sichtbar dazu
if (typeof apKachelInhalt === "function") {
  const original = apKachelInhalt;
  apKachelInhalt = function (k) { const z = original.apply(this, arguments); if (k === "datenschutz") z.push("⚠ " + DS13_UNVERSCHLUESSELT.split(":")[0] + " – " + "wer dieses Browserprofil öffnen kann, kann die Daten lesen."); return z; };
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("datenschutz13");
