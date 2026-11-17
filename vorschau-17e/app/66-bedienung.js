// JARVIS Dashboard – Modul „bedienung“ (ab 11-11a). JARVIS im Alltag benutzbarer machen – ergänzt den Chat-Ablauf (02/03) ohne
// die Skill-Reihenfolge oder Freigaben zu ändern:
//   - erkannter Befehl sichtbar: unter der eigenen Nachricht „erkannt: <Funktion>“ bzw. „nicht lokal erkannt“
//   - klare Rückmeldung bei unbekannten Befehlen ohne Verbindung (statt „Befehl empfangen“) – nichts wird ausgeführt
//   - keine stillen Erfolge: meldet ein erkannter Befehl nichts, sagt JARVIS das ausdrücklich („… hat nichts gemeldet – bitte prüfen“)
//   - zuletzt ausgeführte Aktionen (Zeit, Befehl, Funktion, Ergebnis) in der Aktivitätskarte
//   - kontextbezogene Schnellaktionen unter dem Chat: passende nächste Befehle, nur wenn sie zu einer lokalen Funktion passen
// Speicher „jarvis-aktionen“ { art, version, eintraege } (höchstens 30) – beschädigt → gemeldet, nie überschrieben.
const BEDIEN = { schluessel: "jarvis-aktionen", max: 30 };
const BEDIEN_FOLGE = {
  "aufgabe-anlegen": ["Zeige meine Aufgaben", "Tagesplan"], "projekt-aufgabe": ["Zeige meine Projekte", "Tagesplan"], "projekt-anlegen": ["Zeige meine Projekte"],
  "projekt-status": ["Was ist blockiert?", "Vergleiche meine Projekte"], "projekt-auswertung": ["Zeige meine Projekte", "Tagesplan"], tagesplan: ["Was ist blockiert?", "Zeige meine Aufgaben"],
  "ueberblick-aktien": ["Datenquellen", "Simulationsverlauf"], "kennzahlen-erklaerung": ["Aktienüberblick"], wissen: ["Zeige meine Projekte"], prozesse: ["Alles anhalten"],
  unbekannt: ["Hilfe", "Was steht heute an"],
};
function bedienLesen() {
  const d = speicherJsonLesen(BEDIEN.schluessel, (x) => istObjekt(x) && x.art === "jarvis-aktionen" && Array.isArray(x.eintraege));
  return d ? d.eintraege.filter(istObjekt).slice(0, BEDIEN.max) : [];
}
function bedienMerken(e) {
  const l = bedienLesen();
  if (speicherBeschaedigt(BEDIEN.schluessel)) return false;
  // ab 11-13h: ohne Schlüssel/Codes – vorher stand z. B. „Neue Notiz Zugang sk-ant-…“ im Klartext im Browserspeicher
  const befehl = typeof geheimnisMuster === "function" ? geheimnisMuster(String(e.befehl || "")) : String(e.befehl || "");
  l.unshift({ zeit: new Date().toISOString(), befehl: befehl.slice(0, 80), funktion: String(e.funktion || ""), ergebnis: e.ergebnis });
  try { localStorage.setItem(BEDIEN.schluessel, JSON.stringify({ art: "jarvis-aktionen", version: 1, eintraege: l.slice(0, BEDIEN.max) })); return true; } catch (x) { return false; }
}
function bedienPasst(befehl) { return SKILLS.some((s) => s.name !== "routine" && s.passt(befehl)); }
function bedienSchnellaktionen(name) { return (BEDIEN_FOLGE[name] || []).filter(bedienPasst).slice(0, 3); }
// Ergebnis aus den Nachrichten seit dem Befehl ablesen (ehrlich: „nicht ausgeführt“, wenn JARVIS das selbst sagt)
function bedienErgebnis(neu, fehlerVorher) {
  const text = neu.map((n) => n.textContent).join(" ");
  if (typeof lokaleFehler !== "undefined" && lokaleFehler.zaehler > fehlerVorher) return "Fehler";
  if (!neu.length) return "keine Rückmeldung";
  if (/nichts (wurde )?(ausgeführt|gespeichert|angelegt|verschoben|geändert)|nicht ausgeführt|wurde nichts/i.test(text)) return "nicht ausgeführt";
  if (/bestätig|„ja“|\bja\b.*\bnein\b/i.test(text) && typeof offeneAktion !== "undefined" && offeneAktion) return "wartet auf Bestätigung";
  return "erledigt";
}
// als Merkmal (sichtbar per CSS ::after) – der Nachrichtentext selbst bleibt unverändert
function bedienHinweis(nachricht, text) { if (nachricht) nachricht.dataset.erkannt = text; }
function bedienSchnellZeigen(name) {
  const box = document.getElementById("bedien-schnell");
  if (!box) return;
  const liste = bedienSchnellaktionen(name);
  box.hidden = !liste.length;
  box.replaceChildren(...liste.map((b) => { const k = Object.assign(document.createElement("button"), { type: "button", className: "schalter bedien-chip", textContent: b }); k.addEventListener("click", () => jarvisAntwort(b)); return k; }));
}
if (typeof skillAusfuehren === "function") {
  const original = skillAusfuehren;
  skillAusfuehren = async function (text) {
    const verlauf = document.getElementById("chatverlauf"), vorher = verlauf ? verlauf.children.length : 0;
    const eigene = verlauf ? [...verlauf.querySelectorAll(".nachricht.nutzer")].pop() : null;
    const fehlerVorher = typeof lokaleFehler !== "undefined" ? lokaleFehler.zaehler : 0;
    const r = await original.apply(this, arguments);
    try {
      if (!r) { bedienHinweis(eigene, verbunden() ? "nicht lokal erkannt – geht an die KI" : "nicht lokal erkannt"); bedienSchnellZeigen("unbekannt"); return r; }
      const skill = SKILLS.find((s) => s.name === r), neu = verlauf ? [...verlauf.children].slice(vorher).filter((n) => n.classList.contains("jarvis")) : [];
      const ergebnis = bedienErgebnis(neu, fehlerVorher); // vor der eigenen Warnung (die zählt sonst als Fehler)
      if (!neu.length && r !== "bestaetigung") lokalAntworten(`„${String(text).trim().slice(0, 60)}“ wurde als „${skill ? skill.beschreibung : r}“ erkannt, hat aber nichts gemeldet – bitte das Ergebnis prüfen.`, "fehler");
      bedienHinweis(eigene, "erkannt: " + (skill ? skill.beschreibung : r) + (ergebnis !== "erledigt" ? " · " + ergebnis : ""));
      bedienMerken({ befehl: text, funktion: skill ? skill.beschreibung : r, ergebnis });
      bedienSchnellZeigen(r); bedienAnzeigen();
    } catch (e) { /* Anzeige ist Zusatz */ }
    return r;
  };
}
if (typeof offlineAntwort === "function") {
  const original = offlineAntwort;
  offlineAntwort = function (befehl) {
    const t = original(befehl);
    if (!/^Befehl empfangen – /.test(t)) return t;
    const kern = t.replace(/^Befehl empfangen – .*?\. \(Offline-Modus: KI-Verbindung noch nicht eingerichtet\.\)/, "").trim();
    return `Dafür kenne ich keinen lokalen Befehl, und die KI-Verbindung ist nicht eingerichtet – „${String(befehl).slice(0, 80)}“ wurde nicht ausgeführt.` + (kern ? " " + kern : " „Hilfe“ zeigt, was ich ohne Verbindung kann.");
  };
}
function bedienAnzeigen() {
  const ul = document.getElementById("bedien-zuletzt");
  if (!ul) return;
  if (speicherBeschaedigt(BEDIEN.schluessel)) { ul.replaceChildren(Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: "Aktionsliste beschädigt – " + SPEICHER_SCHADEN_TEXT })); return; }
  const l = bedienLesen();
  ul.replaceChildren(...(l.length ? l.slice(0, 10).map((e) => Object.assign(document.createElement("li"), { className: e.ergebnis === "Fehler" || e.ergebnis === "keine Rückmeldung" ? "wz-wichtig" : "", textContent: `${new Date(e.zeit).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} · ${e.befehl} → ${e.funktion} · ${e.ergebnis}` })) : [Object.assign(document.createElement("li"), { textContent: "Noch keine lokale Aktion." })]));
}
(function bedienEinrichten() {
  const d = document.getElementById("akt-details");
  if (d) d.addEventListener("toggle", () => bedienAnzeigen());
  bedienAnzeigen();
})();

// ab 11-12e: Abendzusammenfassung auch per Sprache/Chat (vorher nur über den Knopf in „Mein Tag“; das Morgenbriefing hatte einen Befehl)
skillRegistrieren({
  name: "abendzusammenfassung", risiko: "abfrage", hilfeKurz: "Abend",
  beschreibung: "Abendzusammenfassung: heute erledigt und offen (nur lokale Daten)", beispiele: ["Abendzusammenfassung", "Wie war mein Tag?"],
  passt: (text) => /^(abendzusammenfassung|abendbericht|tagesrückblick|wie war mein tag|was habe ich heute (geschafft|erledigt))$/.test(befehlNormalisieren(text)),
  aktion: async () => { lokalAntworten(typeof abendDaten === "function" ? abendDaten().text : "Die Abendzusammenfassung ist nicht verfügbar."); return true; },
});
(function abendEinordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();
BEDIEN_FOLGE.abendzusammenfassung = ["Was steht morgen an", "Tagesplan"];
// ab 11-13m: „Verlauf löschen“ (nur nach Rückfrage, 02) entfernt auch die dauerhaft gespeicherten zuletzt ausgeführten Befehle – die
// Rückfrage verspricht „von diesem Gerät entfernt“, vorher blieben bis zu 30 Befehle in „jarvis-aktionen“ stehen
if (typeof befehlsverlaufLoeschen === "function") {
  const original = befehlsverlaufLoeschen;
  befehlsverlaufLoeschen = function () {
    original.apply(this, arguments);
    try { localStorage.removeItem(BEDIEN.schluessel); SPEICHER_SCHADEN.delete(BEDIEN.schluessel); } catch (e) { /* Speicher gesperrt */ }
    bedienAnzeigen();
  };
}
;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("bedienung");
