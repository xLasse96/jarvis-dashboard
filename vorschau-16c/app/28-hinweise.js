// JARVIS Dashboard – Modul „hinweise“ (ab 11-07g). Briefing-Einstellungen und Hinweiszentrale – nur lokale Daten, keine Anfrage.
//   - Morgenübersicht („Mein Tag“) personalisierbar: Bereiche ein-/ausblenden, Ansicht „ausführlich“ (Standard) oder „kompakt“
//     (nur Hinweise, Fehlendes und die Aufgabenzeile). Ausgeblendete Bereiche fehlen auch im Vorgelesenen.
//   - Hinweiszentrale: aus den Hinweisen von „Mein Tag“ (überfällig, Alarme, Speicher, Version, offene Routinen …) wird ein Verlauf mit
//     Kategorie, Priorität, erstem/letztem Auftreten und Gelesen-Markierung. Gleicher Hinweis = ein Eintrag (nur „zuletzt“ wird
//     aktualisiert); Schutz vor Fluten: höchstens 10 neue Einträge pro Stunde, der Rest wird als Sammelhinweis gezählt.
//     Hinweisarten lassen sich abschalten (wirkt auf neue Einträge und die Anzeige; Speicher-Hinweise sind nicht abschaltbar).
// Speicher: „jarvis-briefing“ (Einstellungen) und „jarvis-hinweise“ (Verlauf, höchstens 100). Beschädigt → gemeldet, nie überschrieben.
const HINWEIS = { schluessel: "jarvis-hinweise", einstellung: "jarvis-briefing", max: 100, neuProStunde: 10 };
const HINWEIS_KATEGORIEN = { aufgaben: "Aufgaben", routinen: "Routinen", alarme: "Alarme", watchlist: "Watchlist", simulation: "Simulation", notizen: "Notizen", speicher: "Speicher", system: "System & Version" };
const HINWEIS_FEST = ["speicher"]; // nie abschaltbar: beschädigte Daten müssen sichtbar bleiben
const HINWEIS_PRIO = { speicher: "hoch", system: "hoch", alarme: "mittel", aufgaben: "mittel", watchlist: "mittel", simulation: "mittel", routinen: "niedrig", notizen: "niedrig" };
const PRIO_RANG_H = { hoch: 0, mittel: 1, niedrig: 2 };
const BRIEFING_BEREICHE = ["Aufgaben", "Termine (7 Tage)", "Routinen", "Notizen", "Watchlist", "Alarme", "Simulation"];
const BEREICH_KATEGORIE = { Aufgaben: "aufgaben", "Termine (7 Tage)": "aufgaben", Routinen: "routinen", Notizen: "notizen", Watchlist: "watchlist", Alarme: "alarme", Simulation: "simulation", Speicher: "speicher", Version: "system" };

function briefingEinstellungen() {
  const d = speicherJsonLesen(HINWEIS.einstellung, (x) => istObjekt(x) && Array.isArray(x.ausgeblendet) && Array.isArray(x.hinweiseAus));
  return { ausgeblendet: d ? d.ausgeblendet.filter((b) => BRIEFING_BEREICHE.includes(b)) : [], ansicht: d && d.ansicht === "kompakt" ? "kompakt" : "voll", hinweiseAus: d ? d.hinweiseAus.filter((k) => HINWEIS_KATEGORIEN[k] && !HINWEIS_FEST.includes(k)) : [] };
}
function briefingEinstellungSetzen(aenderung) {
  const e = { ...briefingEinstellungen(), ...aenderung };
  if (speicherBeschaedigt(HINWEIS.einstellung)) return false;
  try { localStorage.setItem(HINWEIS.einstellung, JSON.stringify({ ausgeblendet: e.ausgeblendet, ansicht: e.ansicht, hinweiseAus: e.hinweiseAus })); return true; } catch (x) { return false; }
}
// Zeilen von „Mein Tag“ nach Einstellung: ausgeblendete Bereiche weg; „kompakt“ = Hinweise, Fehlendes und Aufgaben
function briefingFiltern(zeilen, e = briefingEinstellungen()) {
  const sichtbar = zeilen.filter((z) => !e.ausgeblendet.includes(z.bereich));
  return e.ansicht === "kompakt" ? sichtbar.filter((z) => z.art !== "ok" || z.bereich === "Aufgaben") : sichtbar;
}

// ---------- Hinweiszentrale ----------
let hinweisStand = { art: "jarvis-hinweise", version: 1, eintraege: [], unterdrueckt: 0 };
function hinweiseLesen() {
  const d = speicherJsonLesen(HINWEIS.schluessel, (x) => istObjekt(x) && x.art === "jarvis-hinweise" && Array.isArray(x.eintraege));
  hinweisStand = d ? { art: "jarvis-hinweise", version: 1, eintraege: d.eintraege.filter((h) => h && typeof h.schluessel === "string" && typeof h.text === "string").slice(-HINWEIS.max), unterdrueckt: Number(d.unterdrueckt) || 0 }
    : { art: "jarvis-hinweise", version: 1, eintraege: [], unterdrueckt: 0 };
  return hinweisStand;
}
function hinweiseSpeichern() {
  if (speicherBeschaedigt(HINWEIS.schluessel)) return false;
  try { localStorage.setItem(HINWEIS.schluessel, JSON.stringify(hinweisStand)); return true; } catch (e) { return false; }
}
// Übernimmt die aktuellen Hinweise von „Mein Tag“; Rückgabe: Anzahl neuer Einträge
function hinweiseErfassen(d, jetzt = Date.now()) {
  hinweiseLesen();
  if (speicherBeschaedigt(HINWEIS.schluessel)) { hinweiseAnzeigen(); return 0; } // Beschädigung sichtbar melden, nichts schreiben
  const aus = briefingEinstellungen().hinweiseAus;
  const neuInStunde = hinweisStand.eintraege.filter((h) => Date.parse(h.erstmals) > jetzt - 3600000).length;
  let neu = 0, geaendert = false;
  for (const z of d.zeilen.filter((x) => x.art === "hinweis")) {
    const kategorie = BEREICH_KATEGORIE[z.bereich] || "system";
    if (aus.includes(kategorie)) continue;
    const schluessel = kategorie + ":" + z.text;
    const da = hinweisStand.eintraege.find((h) => h.schluessel === schluessel);
    if (da) { if (jetzt - Date.parse(da.zuletzt) > 60000) { da.zuletzt = new Date(jetzt).toISOString(); da.anzahl = (da.anzahl || 1) + 1; geaendert = true; } continue; }
    if (neuInStunde + neu >= HINWEIS.neuProStunde) { hinweisStand.unterdrueckt++; geaendert = true; continue; }
    hinweisStand.eintraege.push({ id: "h" + jetzt.toString(36) + Math.random().toString(36).slice(2, 5), schluessel, kategorie, prio: HINWEIS_PRIO[kategorie] || "mittel", text: z.bereich + ": " + z.text, erstmals: new Date(jetzt).toISOString(), zuletzt: new Date(jetzt).toISOString(), anzahl: 1, gelesen: false });
    neu++; geaendert = true;
  }
  hinweisStand.eintraege = hinweisStand.eintraege.slice(-HINWEIS.max);
  if (geaendert) hinweiseSpeichern();
  hinweiseAnzeigen();
  return neu;
}
function hinweisGelesen(id, gelesen = true) {
  hinweiseLesen();
  const h = hinweisStand.eintraege.find((x) => x.id === id);
  if (!h || speicherBeschaedigt(HINWEIS.schluessel)) return false;
  h.gelesen = Boolean(gelesen);
  hinweiseSpeichern(); hinweiseAnzeigen();
  return true;
}
function hinweiseAlleGelesen() {
  hinweiseLesen();
  if (speicherBeschaedigt(HINWEIS.schluessel)) return 0;
  const n = hinweisStand.eintraege.filter((h) => !h.gelesen).length;
  for (const h of hinweisStand.eintraege) h.gelesen = true;
  hinweisStand.unterdrueckt = 0;
  hinweiseSpeichern(); hinweiseAnzeigen();
  return n;
}
// Filter: "" alle · "ungelesen" · Kategorie; sortiert: ungelesen vor gelesen, dann Priorität, dann neueste
function hinweiseGefiltert(filter = "") {
  const aus = briefingEinstellungen().hinweiseAus;
  return hinweisStand.eintraege.filter((h) => !aus.includes(h.kategorie) && (!filter || (filter === "ungelesen" ? !h.gelesen : h.kategorie === filter)))
    .sort((a, b) => (a.gelesen - b.gelesen) || (PRIO_RANG_H[a.prio] - PRIO_RANG_H[b.prio]) || String(b.zuletzt).localeCompare(String(a.zuletzt)));
}
function hinweiseAnzeigen() {
  const el = (id) => document.getElementById(id);
  if (!el("hinweis-liste")) return;
  const filterFeld = el("hinweis-filter"), gew = filterFeld.value;
  filterFeld.replaceChildren(...[["", "alle"], ["ungelesen", "ungelesene"], ...Object.entries(HINWEIS_KATEGORIEN)].map(([v, t]) => Object.assign(document.createElement("option"), { value: v, textContent: t })));
  filterFeld.value = gew;
  if (speicherBeschaedigt(HINWEIS.schluessel)) { el("hinweis-zaehler").textContent = "⚠ Hinweisverlauf beschädigt – " + SPEICHER_SCHADEN_TEXT; el("hinweis-liste").replaceChildren(); return; }
  const liste = hinweiseGefiltert(filterFeld.value), ungelesen = hinweiseGefiltert("ungelesen").length;
  el("hinweis-zaehler").textContent = `${ungelesen} ungelesen · ${hinweisStand.eintraege.length} im Verlauf` + (hinweisStand.unterdrueckt ? ` · ${hinweisStand.unterdrueckt} weitere wegen Häufung zusammengefasst (höchstens ${HINWEIS.neuProStunde} neue pro Stunde)` : "");
  el("hinweis-liste").replaceChildren(...(liste.length ? liste.map((h) => {
    const li = document.createElement("li");
    li.dataset.id = h.id; li.dataset.prio = h.prio;
    li.classList.toggle("erledigt", h.gelesen);
    li.append(Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: (h.prio === "hoch" ? "⚠ " : h.prio === "mittel" ? "● " : "· ") + h.text }),
      Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: `${HINWEIS_KATEGORIEN[h.kategorie] || h.kategorie} · Priorität ${h.prio} · ${new Date(h.zuletzt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}` + (h.anzahl > 1 ? ` · ${h.anzahl}× gesehen` : "") }));
    const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: h.gelesen ? "Ungelesen" : "Gelesen" });
    b.setAttribute("aria-label", (h.gelesen ? "Als ungelesen markieren: " : "Als gelesen markieren: ") + h.text);
    b.addEventListener("click", () => hinweisGelesen(h.id, !h.gelesen));
    li.append(b);
    // ab 11-07q: Schnellaktion – zur betroffenen Karte springen (nur Navigation, ändert nichts)
    const ziel = HINWEIS_ZIELE[h.kategorie];
    if (ziel && document.getElementById(ziel.id)) {
      const o = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: "Öffnen" });
      o.setAttribute("aria-label", "Zur Karte: " + (HINWEIS_KATEGORIEN[h.kategorie] || h.kategorie));
      o.addEventListener("click", () => hinweisOeffnen(h.kategorie));
      li.append(o);
    }
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: hinweisStand.eintraege.length ? "Kein Hinweis passt zum Filter." : "Noch keine Hinweise." })]));
}
// ab 11-07q: Ziel je Hinweiskategorie (Ansicht und Element) für „Öffnen“
const HINWEIS_ZIELE = { aufgaben: { ansicht: "cockpit", id: "aufgaben-titel" }, routinen: { ansicht: "cockpit", id: "routinen-titel" }, notizen: { ansicht: "cockpit", id: "notizen-titel" },
  speicher: { ansicht: "cockpit", id: "daten-karte" }, watchlist: { ansicht: "trading", id: "wl-liste" }, simulation: { ansicht: "trading", id: "sim-ergebnis" }, alarme: { ansicht: "trading", id: "wl-liste" } };
function hinweisOeffnen(kategorie) {
  const z = HINWEIS_ZIELE[kategorie], el = z && document.getElementById(z.id);
  if (!el) return false;
  if (typeof ansichtSicherstellen === "function") ansichtSicherstellen(z.ansicht);
  if (el.tagName === "DETAILS") el.open = true;
  return typeof zuElementSpringen === "function" ? zuElementSpringen(el) : (el.scrollIntoView(), true);
}
function briefingEinstellungenAnzeigen() {
  const el = (id) => document.getElementById(id);
  if (!el("briefing-bereiche")) return;
  const e = briefingEinstellungen();
  const kasten = (gruppe, wert, text, an, fest) => {
    const l = document.createElement("label"); l.className = "briefing-wahl";
    const k = Object.assign(document.createElement("input"), { type: "checkbox", checked: an, disabled: Boolean(fest) });
    k.dataset.gruppe = gruppe; k.dataset.wert = wert;
    k.addEventListener("change", () => {
      const s = briefingEinstellungen();
      const liste = gruppe === "bereich" ? s.ausgeblendet : s.hinweiseAus;
      const neu = k.checked ? liste.filter((x) => x !== wert) : [...new Set([...liste, wert])];
      const ok = briefingEinstellungSetzen(gruppe === "bereich" ? { ausgeblendet: neu } : { hinweiseAus: neu });
      el("briefing-einstellung-meldung").textContent = ok ? "" : "Nicht gespeichert: " + (speicherBeschaedigt(HINWEIS.einstellung) ? SPEICHER_SCHADEN_TEXT : "Browserspeicher gesperrt oder voll.");
      if (typeof heuteZeigen === "function") heuteZeigen();
      hinweiseAnzeigen();
    });
    l.append(k, " " + text + (fest ? " (immer)" : ""));
    return l;
  };
  el("briefing-bereiche").replaceChildren(...BRIEFING_BEREICHE.map((b) => kasten("bereich", b, b, !e.ausgeblendet.includes(b))));
  el("hinweis-arten").replaceChildren(...Object.entries(HINWEIS_KATEGORIEN).map(([k, t]) => kasten("hinweis", k, t, !e.hinweiseAus.includes(k), HINWEIS_FEST.includes(k))));
  el("briefing-ansicht").value = e.ansicht;
}
(function hinweiseEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("hinweis-liste")) return;
  el("hinweis-filter").addEventListener("change", hinweiseAnzeigen);
  el("hinweise-alle-gelesen").addEventListener("click", hinweiseAlleGelesen);
  el("briefing-ansicht").addEventListener("change", () => {
    const ok = briefingEinstellungSetzen({ ansicht: el("briefing-ansicht").value });
    el("briefing-einstellung-meldung").textContent = ok ? "" : "Nicht gespeichert.";
    if (typeof heuteZeigen === "function") heuteZeigen();
  });
  hinweiseLesen();
  briefingEinstellungenAnzeigen();
  hinweiseAnzeigen();
  if (typeof heuteZeigen === "function") heuteZeigen(); // erste Erfassung (heuteZeigen ruft hinweiseErfassen)
  window.addEventListener("storage", (e) => { if (e.key === HINWEIS.schluessel) { hinweiseLesen(); hinweiseAnzeigen(); } });
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("hinweise");
