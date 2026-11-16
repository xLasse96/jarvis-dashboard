// JARVIS Dashboard – Modul „gedaechtnis3“ (ab 11-10e). Gedächtnis 3.0 über Profil (15) und Gedächtnis 2.0 (42):
//   - Präferenzübersicht: Vorlieben aus dem Profil und die Einstellungen, die JARVIS sich merkt (Antwortstil, Teilfragen, Vorlesen,
//     Startseite, KI-Anbieter) an einer Stelle
//   - Verknüpfung mit dem Gesprächskontext: zur gerade getippten Frage passende Profileinträge werden vorgeschlagen – nie automatisch
//     ausgewählt; ein Klick wählt sie für genau diese Anfrage aus
//   - keine automatische Verwendung sensibler Angaben: sensible Einträge lassen sich nicht vorauswählen; „Merke dir …“ mit sensiblem
//     Inhalt nennt das in der Rückfrage
// Keine Anfrage, kein eigener Speicher.
const GED3 = { vorschlagMs: 250, uhr: null, maxVorschlaege: 3 };
const ged3Woerter = (t) => new Set((String(t || "").toLowerCase().match(/[a-zäöüß0-9]{4,}/g) || []).filter((w) => typeof DOK_STOPP === "undefined" || !DOK_STOPP.has(w)));
// Passende Einträge: gemeinsames Wort oder gemeinsamer Wortanfang (5 Zeichen); nicht schon ausgewählte
function ged3Passende(frage) {
  const a = ged3Woerter(frage);
  if (!a.size || typeof profil === "undefined") return [];
  return profil.filter((e) => !profilAuswahl.has(e.id)).map((e) => {
    const b = ged3Woerter([e.titel, e.text, e.projekt].join(" "));
    const treffer = [...a].filter((w) => b.has(w) || [...b].some((x) => x.length >= 5 && w.length >= 5 && x.slice(0, 5) === w.slice(0, 5)));
    return { e, n: treffer.length };
  }).filter((x) => x.n > 0).sort((x, y) => y.n - x.n).slice(0, GED3.maxVorschlaege).map((x) => x.e);
}
function ged3VorschlaegeAnzeigen() {
  const box = document.getElementById("ged3-vorschlaege"), feld = document.getElementById("befehl");
  if (!box || !feld) return;
  const p = feld.value.trim().length >= 8 ? ged3Passende(feld.value) : [];
  box.hidden = !p.length;
  box.replaceChildren(...(p.length ? [document.createTextNode("Passend aus deinem Profil (nur auf Klick für diese Anfrage): ")] : []), ...p.map((e) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: profilBezeichnung(e) + (e.sensibel ? " 🔒" : "") });
    b.setAttribute("aria-label", "Für diese Anfrage auswählen: " + profilBezeichnung(e) + (e.sensibel ? " (sensibel)" : ""));
    b.addEventListener("click", () => { profilAuswahl.add(e.id); profilLeisteAnzeigen(); ged3VorschlaegeAnzeigen(); });
    return b;
  }));
}
// Sensible Einträge nie vorauswählen (sie würden sonst bei jeder Anfrage mitgehen)
if (typeof profilEintragSpeichern === "function") {
  const original = profilEintragSpeichern;
  profilEintragSpeichern = function (daten, id) {
    const probe = profilEintragPruefen({ ...daten });
    const sensibel = daten.sensibel === true || (probe.eintrag && probe.eintrag.sensibel);
    const r = original(sensibel && daten.vorauswahl ? { ...daten, vorauswahl: false } : daten, id);
    if (r.eintrag && sensibel && daten.vorauswahl) { r.hinweis = "Sensible Einträge werden nie vorausgewählt – bei Bedarf je Anfrage auswählen."; const m = document.getElementById("profil-meldung"); if (m) m.textContent = r.hinweis; }
    return r;
  };
  if (window.profilIntern) window.profilIntern.speichern = profilEintragSpeichern;
}
// „Merke dir …“: Rückfrage nennt sensible Inhalte
(function ged3Merken() {
  const s = typeof SKILLS !== "undefined" && SKILLS.find((x) => x.name === "profil-merken");
  if (!s) return;
  const planen = s.planen;
  s.planen = async (text) => {
    const p = await planen(text);
    if (!p || !p.beschreibung || typeof GED_SENSIBEL === "undefined" || !GED_SENSIBEL.test(text)) return p;
    return { ...p, beschreibung: p.beschreibung + " ⚠ Das wirkt wie eine sensible Angabe (z. B. Gesundheit, Finanzen, Kontakt) – sie wird als „sensibel“ markiert und nie automatisch mitgesendet." };
  };
})();
// Präferenzübersicht
function ged3Praeferenzen() {
  const z = [];
  for (const e of typeof profil !== "undefined" ? profil.filter((x) => x.kategorie === "vorlieben") : []) z.push({ art: "Vorliebe (Profil)", text: `${e.titel}: ${e.text}`, quelle: typeof GED_HERKUNFT !== "undefined" ? GED_HERKUNFT[e.herkunft] || "" : "" });
  if (typeof dialogLesen === "function") { const d = dialogLesen(); z.push({ art: "Antwortstil", text: DIALOG_STILE[d.stil].name + (d.ehrlich ? " · mit Ehrlichkeitshinweis" : ""), quelle: "Gespräch" }); }
  if (typeof gesprTeilfragenAn === "function") z.push({ art: "Teilfragen nummerieren", text: gesprTeilfragenAn() ? "an" : "aus", quelle: "Gespräch" });
  if (typeof modellLesen === "function") { const m = modellLesen(); z.push({ art: "KI-Anbieter", text: MODELL_ANBIETER[m.anbieter].name + (m.vorschau ? " · Vorschau vor dem Senden" : ""), quelle: "KI-Modell" }); }
  if (typeof appStartLesen === "function") z.push({ art: "Startseite", text: appStartLesen(), quelle: "App" });
  const umfang = document.getElementById("vorlesen-umfang"), vl = document.getElementById("vorlesen-schalter");
  if (vl) z.push({ art: "Vorlesen", text: vl.textContent.replace(/^Vorlesen:\s*/, "") + (umfang && umfang.value ? " · Umfang " + (umfang.selectedOptions[0] || {}).textContent : ""), quelle: "Stimme & Sprache" });
  return z;
}
function ged3Anzeigen() {
  const ul = document.getElementById("ged3-praeferenzen");
  if (!ul) return;
  ul.replaceChildren(...ged3Praeferenzen().map((p) => Object.assign(document.createElement("li"), { textContent: `${p.art}: ${p.text}${p.quelle ? " (" + p.quelle + ")" : ""}` })));
}
if (typeof gedAnzeigen === "function") { const original = gedAnzeigen; gedAnzeigen = function () { original(); ged3Anzeigen(); }; }
(function ged3Einrichten() {
  const feld = document.getElementById("befehl");
  if (feld) feld.addEventListener("input", () => { clearTimeout(GED3.uhr); GED3.uhr = setTimeout(ged3VorschlaegeAnzeigen, GED3.vorschlagMs); });
  if (typeof profilLeisteAnzeigen === "function") { const original = profilLeisteAnzeigen; profilLeisteAnzeigen = function () { original(); if (feld && !feld.value) { const b = document.getElementById("ged3-vorschlaege"); if (b) b.hidden = true; } }; }
  ged3Anzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("gedaechtnis3");
