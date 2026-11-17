// JARVIS Dashboard – Modul „oberflaeche3“ (ab 11-13g). Einheitliche Ladeanzeige (docs/AUFTRAG_13.md, Block 7):
//   - Worker-Anfragen: dauert eine Anfrage länger als 700 ms, erscheint unten rechts „Anfrage an den Worker läuft …“ (mit Zahl, wenn
//     mehrere laufen). Vorher liefen Anfragen ohne eigene Anzeige (z. B. Status, Paper-Abfragen) still – nur 4 Module setzten aria-busy.
//     Der zweite Versuch nach einem Netzfehler (02) zählt nicht doppelt.
//   - aria-busy hat jetzt überall dasselbe Aussehen (Fortschritts-Zeiger, Punkte); ohne Bewegung bei „Bewegung reduzieren“ (CSS)
// Keine Anfrage, kein Speicher; Fehlermeldungen und Abbruch bleiben unverändert in 02.
const LADEN = { verzoegerungMs: 700, laufend: 0, uhr: null };
function ladeAnzeigeSetzen() {
  let el = document.getElementById("anfrage-laeuft");
  if (!el) {
    el = Object.assign(document.createElement("p"), { id: "anfrage-laeuft", className: "anfrage-laeuft", hidden: true });
    // nur sichtbar: Bildschirmleser bekommen Ergebnis und Fehler über die vorhandenen Statuszeilen, nicht jede Anfrage einzeln
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  clearTimeout(LADEN.uhr);
  if (!LADEN.laufend) { el.hidden = true; return el; }
  const zeigen = () => { el.textContent = LADEN.laufend > 1 ? `${LADEN.laufend} Anfragen an den Worker laufen …` : "Anfrage an den Worker läuft …"; el.hidden = false; };
  if (el.hidden) LADEN.uhr = setTimeout(zeigen, LADEN.verzoegerungMs); else zeigen();
  return el;
}
if (typeof workerAnfrage === "function") {
  const original = workerAnfrage;
  workerAnfrage = async function (pfad, optionen, versuch) {
    const zaehlen = versuch !== 2;
    if (zaehlen) { LADEN.laufend++; ladeAnzeigeSetzen(); }
    try { return await original.apply(this, arguments); } finally { if (zaehlen) { LADEN.laufend = Math.max(0, LADEN.laufend - 1); ladeAnzeigeSetzen(); } }
  };
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("oberflaeche3");
