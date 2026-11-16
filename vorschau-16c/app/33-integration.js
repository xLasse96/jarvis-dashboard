// JARVIS Dashboard – Modul „integration“ (ab 11-07q). Zusammenspiel der Module, ohne neue Fähigkeiten:
//   - Zuletzt ausgeführte Aktionen: jede Eingabe an den Dispatcher (Sprache oder Chat) mit erkanntem Skill bzw. „an die KI/offline“,
//     Dauer und Ergebnis. Nur Arbeitsspeicher dieser Sitzung (höchstens 20), Codes und schlüsselähnliche Werte entfernt;
//     „Verlauf löschen“ leert ihn mit.
// Keine Anfrage, kein Speicher, keine Änderung an Freigaben oder Bestätigungen.
const AKTIONEN = { liste: [], max: 20 };
const AKTION_NAMEN = { navigation: "Navigation", "aufgabe-anlegen": "Aufgabe angelegt", "aufgabe-loeschen": "Aufgabe löschen (Rückfrage)", paper: "Krypto-Paper", gesperrt: "abgelehnt (gesperrt)", hilfe: "Hilfe", ansicht: "Bereich gewechselt", bestaetigung: "Rückfrage beantwortet", routine: "Routine" };
function aktionMerken(text, ergebnis, dauerMs) {
  const sauber = typeof geheimnisMuster === "function" ? geheimnisMuster(String(text || "")) : String(text || "");
  AKTIONEN.liste = [{ zeit: Date.now(), text: sauber.slice(0, 80), skill: ergebnis || null, dauer_ms: Math.round(dauerMs) }, ...AKTIONEN.liste].slice(0, AKTIONEN.max);
  aktionenAnzeigen();
}
function aktionenAnzeigen() {
  const ol = document.getElementById("aktionen-liste");
  if (!ol) return;
  ol.replaceChildren(...(AKTIONEN.liste.length ? AKTIONEN.liste.map((a) => {
    const li = document.createElement("li");
    li.dataset.skill = a.skill || "";
    li.textContent = `${new Date(a.zeit).toLocaleTimeString("de-DE")} · „${a.text}“ → ${a.skill ? AKTION_NAMEN[a.skill] || a.skill : "kein lokaler Befehl (an die KI bzw. offline beantwortet)"} · ${a.dauer_ms} ms`;
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "Noch keine Aktion in dieser Sitzung." })]));
}
{
  const original = skillAusfuehren;
  skillAusfuehren = async function (text) {
    const t0 = performance.now();
    let r = null;
    try { r = await original(text); return r; } finally { aktionMerken(text, r, performance.now() - t0); }
  };
}
if (typeof befehlsverlaufLoeschen === "function") {
  const original = befehlsverlaufLoeschen;
  befehlsverlaufLoeschen = function () { original(); AKTIONEN.liste = []; aktionenAnzeigen(); };
}
aktionenAnzeigen();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("integration");
