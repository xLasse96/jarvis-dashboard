// JARVIS Dashboard – Modul „uhr“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

function uhrAktualisieren() {
  document.getElementById("uhr").textContent = new Date().toLocaleTimeString("de-DE");
}
uhrAktualisieren();
setInterval(uhrAktualisieren, 1000);

// Sprachausgabe ist eine Browserfunktion: nur anzeigen, was dieser Browser wirklich kann
(function () {
  const feld = document.getElementById("vorlesen-status");
  const vorhanden = "speechSynthesis" in window;
  feld.textContent = vorhanden ? "vom Browser unterstützt" : "nicht unterstützt";
  feld.className = vorhanden ? "ok" : "aus";
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("uhr");
