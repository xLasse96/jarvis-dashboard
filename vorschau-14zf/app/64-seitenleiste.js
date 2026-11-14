// JARVIS Dashboard – Modul „seitenleiste“ (ab 11-10o). Kompakte Seitenleiste für Desktop und Tablet im Querformat – ergänzt die
// vorhandene Navigation (Reiter, Sprungleiste, Arbeitsplatz mit anpassbaren Kacheln, Kompaktmodus, Einstellungs- und Datenschutzzentrale):
//   - nur auf Wunsch (Standard aus) und nur ab 1100 px Breite; schmaler Bildschirm: unverändert (keine geprüfte Ansicht verschiebt sich)
//   - Sprungziele zu den Bereichen der 10er-Serie und den Zentralen (Aufträge, Projekte, Dokumente, Gedächtnis, Automatik, Workflows,
//     Einstellungen, Datenschutz); jedes Ziel öffnet seinen Bereich und springt hin
//   - Zähler: offene Vorschläge und laufende Prozesse; Versions- und Verbindungsstand unten
// Speicher „jarvis-seitenleiste“ { art, version, an } – nur Oberfläche.
const SLEISTE = { schluessel: "jarvis-seitenleiste", minBreite: 1100 };
const SLEISTE_ZIELE = [
  ["vors-details", "Vorschläge"], ["tplan-details", "Tagesplanung"], ["auftrag-details", "Aufträge"], ["projekt-details", "Projekte"], ["proj2-details", "Projektvergleich"],
  ["dok-details", "Dokumente"], ["wissen-details", "Wissen"], ["ged-details", "Gedächtnis"], ["routinen-titel", "Workflows"], ["auto-liste", "Automatik"],
  ["dq-details", "Datenquellen"], ["aueb-details", "Aktien"], ["ap-titel", "Arbeitsplatz & Einstellungen"], ["daten-karte", "Daten & Datenschutz"],
];
function sleisteLesen() { const d = speicherJsonLesen(SLEISTE.schluessel, (x) => istObjekt(x) && x.art === "jarvis-seitenleiste"); return { an: Boolean(d && d.an) }; }
function sleisteSetzen(an) {
  sleisteLesen(); // erst lesen: setzt die Beschädigt-Markierung
  if (speicherBeschaedigt(SLEISTE.schluessel)) return false;
  try { localStorage.setItem(SLEISTE.schluessel, JSON.stringify({ art: "jarvis-seitenleiste", version: 1, an: Boolean(an) })); } catch (e) { /* nur diese Sitzung */ }
  sleisteAnzeigen(); return true;
}
const sleisteMoeglich = () => window.innerWidth >= SLEISTE.minBreite;
function sleisteZiele() { return SLEISTE_ZIELE.filter(([id]) => document.getElementById(id)); }
function sleisteSpringen(id) {
  const z = document.getElementById(id);
  if (!z) return false;
  const ansicht = z.closest("[id^='ansicht-']");
  if (ansicht && typeof ansichtSicherstellen === "function") ansichtSicherstellen(ansicht.id.replace("ansicht-", ""));
  for (let p = z; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
  z.dispatchEvent(new Event("toggle"));
  if (typeof zuElementSpringen === "function") zuElementSpringen(z); else z.scrollIntoView();
  return true;
}
function sleisteAnzeigen() {
  const nav = document.getElementById("seitenleiste"), schalter = document.getElementById("seitenleiste-schalter");
  if (!nav || !schalter) return;
  const an = sleisteLesen().an, sichtbar = an && sleisteMoeglich();
  schalter.hidden = !sleisteMoeglich();
  schalter.setAttribute("aria-expanded", String(sichtbar));
  schalter.textContent = sichtbar ? "Seitenleiste ausblenden" : "Seitenleiste";
  nav.hidden = !sichtbar;
  document.body.classList.toggle("mit-seitenleiste", sichtbar);
  if (!sichtbar) return;
  const vors = typeof vorschlaegeErmitteln === "function" && document.getElementById("vors-liste") ? document.querySelectorAll("#vors-liste li[data-key]").length : 0;
  const proz = typeof jarvisProzesse === "function" ? jarvisProzesse().length : 0;
  nav.querySelector("ul").replaceChildren(...sleisteZiele().map(([id, name]) => {
    const li = document.createElement("li"), b = Object.assign(document.createElement("button"), { type: "button", className: "seitenleiste-ziel", textContent: name + (id === "vors-details" && vors ? ` (${vors})` : id === "auftrag-details" && proz ? ` (${proz})` : "") });
    b.addEventListener("click", () => sleisteSpringen(id)); li.append(b); return li;
  }));
  const stand = document.getElementById("stand-kennung");
  nav.querySelector(".seitenleiste-fuss").textContent = `${stand ? stand.textContent : ""} · ${typeof verbunden === "function" && verbunden() ? "Worker verbunden" : "nicht verbunden"}${navigator.onLine === false ? " · offline" : ""}`;
}
(function sleisteEinrichten() {
  const schalter = document.getElementById("seitenleiste-schalter");
  if (!schalter) return;
  schalter.addEventListener("click", () => sleisteSetzen(!(sleisteLesen().an && sleisteMoeglich())));
  window.addEventListener("resize", () => sleisteAnzeigen());
  window.addEventListener("online", () => sleisteAnzeigen()); window.addEventListener("offline", () => sleisteAnzeigen());
  window.addEventListener("storage", (e) => { if (e.key === SLEISTE.schluessel) sleisteAnzeigen(); });
  setInterval(() => { if (!document.hidden && !document.getElementById("seitenleiste").hidden) { try { sleisteAnzeigen(); } catch (e) { /* ab 11-12e: Hintergrundanzeige */ } } }, 60000); // ab 10q: ruht in verborgenen Tabs
  sleisteAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("seitenleiste");
