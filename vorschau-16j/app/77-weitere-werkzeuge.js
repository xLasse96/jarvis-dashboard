// JARVIS Dashboard – Modul „weitere-werkzeuge“ (ab 14ze). Aufgeräumtes Cockpit für das Tablet: Hauptwege bleiben sichtbar (Mein Tag, System,
// Funktionen, Kern/KI, Verlauf, Markt, Paper-Bot, Protokoll), seltener genutzte Karten bilden den klappbaren Bereich „Weitere Werkzeuge“.
// Die Karten bleiben unverändert im Dokument (Reihenfolge, Fokus, Sprungziele); eingeklappt heißt nur ausgeblendet (CSS body.weitere-zu).
// Standard: auf Touch-Geräten (pointer: coarse, z. B. Tablet) eingeklappt, sonst offen; die eigene Wahl merkt sich nur dieses Gerät.
const WEITERE_KARTEN = ["ap-titel", "aufgaben-titel", "notizen-titel", "routinen-titel", "automatik-titel", "profil-titel", "watchlist-titel", "datei-titel"];
const WEITERE_SCHLUESSEL = "jarvis-weitere-werkzeuge";
function weitereSetzen(zu, merken = false) {
  document.body.classList.toggle("weitere-zu", zu);
  const h = document.getElementById("weitere-hinweis"), n = document.querySelectorAll(".karte.weitere").length;
  for (const k of [document.getElementById("weitere-schalter"), document.getElementById("weitere-schalter-trading")]) if (k) { k.textContent = zu ? `Weitere Werkzeuge anzeigen (${n})` : "Weitere Werkzeuge ausblenden"; k.setAttribute("aria-expanded", String(!zu)); }
  if (h) h.textContent = zu ? "Arbeitsplatz, Aufgaben, Notizen, Routinen, Automatisierungen, Profil & Projekte, Krypto-Kursliste, Dateien und die Krypto-Testnet-Karten sind eingeklappt – nichts gelöscht." : "";
  if (merken) { try { localStorage.setItem(WEITERE_SCHLUESSEL, zu ? "zu" : "offen"); } catch (e) { /* nur Bequemlichkeit */ } }
}
function weitereAnwenden() {
  for (const id of WEITERE_KARTEN) { const h = document.getElementById(id), k = h && h.closest("article.karte"); if (k) k.classList.add("weitere"); }
  // ab 14zf: im Paper-Trading die Krypto-Testnet-Karten (Kontostand, Manuelle Order, Krypto-Paper) ebenfalls nachrangig
  for (const k of document.querySelectorAll("#ansicht-trading article.karte.krypto-teil")) k.classList.add("weitere");
  let gemerkt = null;
  try { gemerkt = localStorage.getItem(WEITERE_SCHLUESSEL); } catch (e) { gemerkt = null; }
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  weitereSetzen(gemerkt === "zu" || gemerkt === "offen" ? gemerkt === "zu" : touch);
}
for (const id of ["weitere-schalter", "weitere-schalter-trading"]) { const k = document.getElementById(id); if (k) k.addEventListener("click", () => weitereSetzen(!document.body.classList.contains("weitere-zu"), true)); }
weitereAnwenden();
;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("weitere-werkzeuge");
