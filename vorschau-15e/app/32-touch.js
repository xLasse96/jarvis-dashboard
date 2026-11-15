// JARVIS Dashboard – Modul „touch“ (ab 11-07n). Bedienung auf Tablets und Telefonen, ohne Funktionen zu ändern:
//   - Versehentliche Doppeltipps: ein zweiter TOUCH-Tipp auf dasselbe Bedienelement innerhalb von 400 ms wird verworfen. Gilt nur für
//     echte Touch-Eingaben (pointerType „touch“) – Maus, Tastatur und Skript-Klicks bleiben unverändert. Schaltflächen mit eigener
//     Sperre (Senden, Bestätigen) behalten diese zusätzlich.
//   - Bildschirmtastatur: Wird ein Eingabefeld fokussiert und von der Tastatur verdeckt (sichtbarer Bereich laut visualViewport),
//     wird es in die Mitte des sichtbaren Bereichs gescrollt.
// Grenzen: geprüft nur per Browser-Emulation bzw. mit nachgebildeten Werten – das Verhalten echter Android-Tastaturen ist am Gerät
// zu prüfen (docs/TABLET_ABNAHME_CHECKLISTE.md).
const TOUCH = { doppelMs: 400, letzter: null, verworfen: 0 };
const TOUCH_ZIELE = "button, a[href], summary, label, input[type=checkbox], input[type=radio], [role=button], [role=tab]";
function doppeltippPruefen(e, jetzt = Date.now()) {
  if (!e || e.pointerType !== "touch") return false;
  const ziel = e.target && e.target.closest ? e.target.closest(TOUCH_ZIELE) : null;
  if (!ziel) return false;
  const l = TOUCH.letzter;
  TOUCH.letzter = { ziel, zeit: jetzt };
  return Boolean(l && l.ziel === ziel && jetzt - l.zeit < TOUCH.doppelMs);
}
document.addEventListener("click", (e) => {
  if (!doppeltippPruefen(e)) return;
  TOUCH.verworfen++;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
// Verdeckt die Tastatur das Element? rect: getBoundingClientRect(), vv: { height, offsetTop } des sichtbaren Bereichs
function tastaturVerdeckt(rect, vv) {
  if (!rect || !vv || !(vv.height > 0)) return false;
  const unten = (vv.offsetTop || 0) + vv.height;
  return rect.bottom > unten - 8 || rect.top < (vv.offsetTop || 0);
}
function eingabeSichtbarMachen(el, vv = window.visualViewport) {
  if (!el || !vv || typeof el.scrollIntoView !== "function") return false;
  if (!tastaturVerdeckt(el.getBoundingClientRect(), vv)) return false;
  el.scrollIntoView({ block: "center", behavior: "auto" });
  return true;
}
document.addEventListener("focusin", (e) => {
  const el = e.target;
  if (!el || !el.matches || !el.matches("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, select")) return;
  if (!matchMedia("(pointer: coarse)").matches) return;
  // die Tastatur fährt erst nach dem Fokus aus – einmal kurz danach und bei der nächsten Größenänderung prüfen
  setTimeout(() => eingabeSichtbarMachen(el), 350);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", () => { if (document.activeElement === el) eingabeSichtbarMachen(el); }, { once: true });
});

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("touch");
