// JARVIS Dashboard – Modul „sprachbefehle“ (ab 11-09h). Natürlichere Sprachbedienung über dem vorhandenen Dispatcher:
//   - Umgangssprache: Höflichkeits- und Füllwörter („Kannst du mir bitte mal …“, „… danke“) und typische Formulierungen
//     („Zeig mir …“, „Mach mir eine Aufgabe …“, „Trag einen Termin … ein“) werden auf die bekannten Befehle abgebildet – nur wenn der
//     Originalsatz selbst keinen lokalen Befehl trifft. Die Antwort sagt „Verstanden als: …“. Freigaben und Rückfragen gelten unverändert
//     (der umgeformte Satz läuft durch denselben Dispatcher; Gesperrtes bleibt gesperrt).
//   - Abbruch: „Stopp“, „Abbrechen“, „Vergiss es“ … beendet das Vorlesen und verwirft eine offene Rückfrage – führt nie etwas aus.
//   - Korrektur: „Nein, ich meinte …“ führt die Korrektur als neuen Befehl aus und nennt, was vorher angelegt wurde (Entfernen nur
//     über den normalen Löschbefehl mit Rückfrage).
//   - Planung: „Was steht morgen an?“, „Was habe ich diese Woche?“, „Was ist am Freitag?“ (lokal aus den Aufgaben).
//   - Dokumentensuche: „Suche im Dokument X nach Y“ (nur geladene Dokumente, 09e).
//   - Vorschau: Unter dem erkannten Sprachtext steht vor dem Senden, was der Satz auslösen würde (Trockenlauf, 09b).
// Keine Anfrage, kein Speicher.
const SPRACH_FUELL = /^(?:(?:hey|hallo|hi|ok|okay|also|äh|ähm|ja)\s+)*(?:jarvis\s+)?(?:(?:kannst du|könntest du|koenntest du|würdest du|wuerdest du|kannste|magst du|würdest du mal)\s+(?:mir\s+)?)?(?:(?:bitte|mal|jetzt|doch|eben|kurz|schnell|gerade)\s+)*/;
const SPRACH_ENDE = /\s+(?:bitte|danke|mal|für mich|fuer mich|machen|tun|danke schön|danke schoen|bitte schön)$/;
const SPRACH_REGELN = [
  [/^zeig(?:e)? mir\s+/, "zeige "],
  [/^zeig\s+/, "zeige "],
  [/^(?:meine|die) (aufgaben|notizen|projekte|dateien) (?:zeigen|anzeigen|auflisten)$/, "zeige meine $1"],
  [/^(?:mach|mache|leg|lege|erstell|erstelle)(?: mir)?(?: eine| ne| 'ne)?(?: neue)? aufgabe(?: an)?\s*[:,]?\s+(.+?)(?: an)?$/, "neue aufgabe $1"],
  [/^(?:trag|trage)(?: mir)?(?: einen| nen)? termin(?: ein)?\s*[:,]?\s+(.+?)(?: ein)?$/, "neue aufgabe $1"],
  [/^(?:neuer )?termin\s*[:,]?\s+(.+)$/, "neue aufgabe $1"],
  [/^(?:eine|ne|'ne)(?: neue)? aufgabe\s*[:,]?\s+(.+)$/, "neue aufgabe $1"], // ab 11-10a: „ne Aufgabe … (machen)“
  [/^(?:mach|mache|leg|lege|schreib|schreibe)(?: mir)?(?: eine| ne)?(?: neue)? notiz(?: an)?\s*[:,]?\s+(.+?)(?: an)?$/, "neue notiz $1"],
  [/^(?:mach|mache|leg|lege)(?: mir)?(?: ein)?(?: neues)? projekt(?: an)?\s*[:,]?\s+(.+?)(?: an)?$/, "neues projekt $1"],
  [/^(?:geh|gehe|spring|springe|wechsel|wechsle) (?:mal )?(?:zu|zur|zum|in die|in den|nach)\s+(.+)$/, "gehe zu $1"],
  [/^(?:was gibt'?s|was gibt es) (?:neues )?(?:heute|für heute)$/, "was steht heute an"],
];
// Groß-/Kleinschreibung bleibt erhalten (Titel wie „Zahnarzt anrufen“); verglichen wird klein (die Skills normalisieren selbst)
// Füllwörter innerhalb der ersten vier Wörter (nach dem ersten): „mach mir bitte ne Aufgabe …“ – Titel dahinter bleiben unberührt
const SPRACH_FUELLWORT = /^(?:bitte|mal|doch|eben|kurz|schnell)$/i;
function sprachMitte(t) { const w = t.split(" "); return w.filter((x, i) => i === 0 || i > 4 || !SPRACH_FUELLWORT.test(x)).join(" "); }
function sprachNormalisieren(text) {
  let t = String(text || "").replace(/[„“”"!?.,;:]+/g, " ").replace(/\s+/g, " ").trim();
  const vorher = befehlNormalisieren(t);
  const fuell = new RegExp(SPRACH_FUELL.source, "i"), ende = new RegExp(SPRACH_ENDE.source, "i");
  for (let i = 0; i < 3; i++) { const n = sprachMitte(t.replace(fuell, "").replace(ende, "").trim()); if (n === t) break; t = n; }
  for (const [re, ziel] of SPRACH_REGELN) { const ri = new RegExp(re.source, "i"); if (ri.test(t)) { t = t.replace(ri, ziel).trim(); break; } }
  return { text: t, geaendert: befehlNormalisieren(t) !== vorher && t.length > 0 };
}
const sprachSkillFuer = (t) => SKILLS.find((s) => s.passt(t)) || null;
// Wrapper: Originalsatz zuerst; nur wenn kein lokaler Befehl passt und die Umformung einen trifft → umgeformt ausführen
if (typeof skillAusfuehren === "function") {
  const original = skillAusfuehren;
  skillAusfuehren = async function (text) {
    const offen = (typeof offeneAktion !== "undefined" && offeneAktion) || (typeof paperOffen !== "undefined" && paperOffen) || (typeof slDialogPasst === "function" && slDialogPasst(text));
    // Abbruchwörter vor dem Paper-Skill (der „abbrechen“ sonst ohne offene Order mit „keine offene Paper-Order“ beantwortet)
    const abbruch = SKILLS.find((s) => s.name === "abbruch");
    if (!offen && abbruch && skillRisiko(abbruch) === "abfrage" && abbruch.passt(text)) { await abbruch.aktion(text); return "abbruch"; }
    if (offen || sprachSkillFuer(text) || (typeof auftragErkennen === "function" && auftragErkennen(String(text).replace(AUFTRAG_PLAN, ""), 2))) return original(text);
    const n = sprachNormalisieren(text);
    if (!n.geaendert || !sprachSkillFuer(n.text)) return original(text);
    lokalAntworten("Verstanden als: „" + n.text + "“");
    return original(n.text);
  };
}
// ---------- Abbruch ----------
skillRegistrieren({
  name: "abbruch",
  risiko: "abfrage",
  hilfeKurz: "Stopp", // in der Hilfe als Sammelzeile (Länge für die Sprachausgabe)
  beschreibung: "Abbrechen: Vorlesen stoppen, offene Rückfrage verwerfen",
  beispiele: ["Stopp"],
  passt: (text) => /^(stopp?|halt|abbrechen|abbruch|vergiss es|vergiss das|lass es|lass gut sein|schluss|ruhe|sei still|still|egal|nichts)$/.test(befehlNormalisieren(sprachNormalisieren(text).text)),
  aktion: async () => {
    const was = [];
    if (typeof vorlesenStoppen === "function") { vorlesenStoppen(); was.push("Vorlesen gestoppt"); }
    if (typeof offeneAktion !== "undefined" && offeneAktion && typeof offeneAktionAbbrechen === "function") { offeneAktionAbbrechen(); was.push("offene Rückfrage verworfen"); }
    lokalAntworten("In Ordnung – " + (was.length ? was.join(", ") : "nichts lief") + ". Es wurde nichts ausgeführt.");
    return true;
  },
});
// ---------- Korrektur ----------
skillRegistrieren({
  name: "korrektur",
  risiko: "abfrage",
  hilfeKurz: "Korrektur",
  beschreibung: "Korrektur: „Nein, ich meinte …“",
  beispiele: ["Nein, ich meinte Gehe zu Notizen"],
  passt: (text) => /^(?:nein|ne|nö|noe|falsch)?\s*(?:ich meinte|ich meine|gemeint war|korrektur|korrigiere)\s+\S/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const neu = String(text).replace(/^\s*(?:hey\s+)?(?:jarvis[\s,]+)?(?:nein|ne|nö|noe|falsch)?[\s,.!]*(?:ich meinte|ich meine|gemeint war|korrektur|korrigiere)\s*[:,]?\s*/i, "").trim();
    if (!neu || /^(?:nein|ne|nö)?\s*(?:ich meinte|korrektur)/i.test(neu)) { lokalAntworten("Was meintest du stattdessen? Es wurde nichts ausgeführt."); return true; }
    // Was hat der vorige Befehl angelegt? (nur benennen, nie selbst löschen)
    const vorige = typeof AKTIONEN !== "undefined" ? AKTIONEN.liste.find((a) => Date.now() - a.zeit < 120000) : null;
    let hinweis = "";
    if (vorige && ["aufgabe-anlegen", "notiz-anlegen", "projekt-anlegen"].includes(vorige.skill)) {
      const art = { "aufgabe-anlegen": "Aufgabe", "notiz-anlegen": "Notiz", "projekt-anlegen": "Projekt" }[vorige.skill];
      hinweis = ` Der vorige Befehl („${vorige.text}“) hat eine ${art} angelegt – sie bleibt bestehen; zum Entfernen den Löschbefehl nutzen (mit Rückfrage).`;
    }
    lokalAntworten("Korrektur verstanden: „" + neu + "“." + hinweis);
    const r = await skillAusfuehren(neu);
    if (!r && typeof jarvisAntwort === "function") lokalAntworten("Für „" + neu + "“ gibt es keinen lokalen Befehl – bitte als neue Nachricht senden.");
    return true;
  },
});
// ---------- Planung: Was steht an? ----------
function sprachZeitraum(wort, jetzt = new Date()) {
  const tag = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const heute = tag(jetzt), plus = (n) => new Date(heute.getTime() + n * 86400000);
  if (!wort || wort === "heute") return { von: heute, bis: plus(1), name: "heute" };
  if (wort === "morgen") return { von: plus(1), bis: plus(2), name: "morgen" };
  if (wort === "übermorgen" || wort === "uebermorgen") return { von: plus(2), bis: plus(3), name: "übermorgen" };
  if (wort === "diese woche" || wort === "in dieser woche") return { von: heute, bis: plus(7 - ((heute.getDay() + 6) % 7)), name: "diese Woche" };
  if (wort === "nächste woche" || wort === "naechste woche") { const mo = plus(7 - ((heute.getDay() + 6) % 7)); return { von: mo, bis: new Date(mo.getTime() + 7 * 86400000), name: "nächste Woche" }; }
  const z = typeof zeitangabeErkennen === "function" ? zeitangabeErkennen(wort, jetzt) : null;
  if (z && z.datum) { const v = tag(z.datum); return { von: v, bis: new Date(v.getTime() + 86400000), name: wort }; }
  if (z && z.rueckfrage) return { rueckfrage: z.rueckfrage };
  return null;
}
skillRegistrieren({
  name: "planung",
  risiko: "abfrage",
  hilfeKurz: "Planung",
  beschreibung: "Was steht an? (Tag oder Woche, aus deinen Aufgaben)",
  beispiele: ["Was steht morgen an?", "Was habe ich diese Woche?"],
  passt: (text) => /^(?:was steht|was habe ich|was hab ich|was ist|welche termine habe ich|welche termine hab ich|was liegt)\s+(?:morgen|übermorgen|uebermorgen|diese woche|in dieser woche|nächste woche|naechste woche|am \S+|am \d{1,2}\.\d{1,2}\.?(?:\d{4})?)(?:\s+(?:an|vor|fällig|faellig|geplant|so an))?$/.test(befehlNormalisieren(sprachNormalisieren(text).text)),
  aktion: async (text, jetzt = new Date()) => {
    const t = befehlNormalisieren(sprachNormalisieren(text).text), m = /^(?:was steht|was habe ich|was hab ich|was ist|welche termine habe ich|welche termine hab ich|was liegt)\s+(.+?)(?:\s+(?:an|vor|fällig|faellig|geplant|so an))?$/.exec(t);
    const z = sprachZeitraum(m ? m[1] : "", jetzt);
    if (!z) { lokalAntworten("Diesen Zeitraum verstehe ich nicht – z. B. „morgen“, „diese Woche“ oder „am Freitag“."); return true; }
    if (z.rueckfrage) { lokalAntworten(z.rueckfrage.replace(" Es wurde nichts angelegt.", "")); return true; }
    const auf = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => !a.erledigt && a.faellig && new Date(a.faellig) >= z.von && new Date(a.faellig) < z.bis).sort((a, b) => a.faellig.localeCompare(b.faellig)) : [];
    const lang = z.bis - z.von > 86400000;
    lokalAntworten(auf.length ? `${z.name.replace(/^./, (c) => c.toUpperCase())}: ${auf.length} Aufgabe(n):\n` + auf.slice(0, 12).map((a) => "• " + new Date(a.faellig).toLocaleString("de-DE", lang ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" }) + " " + a.titel).join("\n") + (auf.length > 12 ? `\n… und ${auf.length - 12} weitere.` : "")
      : `Für ${z.name} steht nichts in deinen Aufgaben.`);
    return true;
  },
});
// ---------- Dokumentensuche ----------
skillRegistrieren({
  name: "dokument-suche",
  risiko: "abfrage",
  hilfeKurz: "Dokumentsuche",
  beschreibung: "Im geladenen Dokument suchen",
  beispiele: ["Suche im Dokument notiz nach Steuer"],
  passt: (text) => /^(?:suche|finde|such) (?:im|in dem|in der) (?:dokument|datei) .+ nach .+$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const m = /^(?:suche|finde|such) (?:im|in dem|in der) (?:dokument|datei) (.+?) nach (.+)$/.exec(befehlNormalisieren(text));
    const docs = typeof dokListe === "function" ? dokListe() : [], nam = (e) => befehlNormalisieren(e.name);
    const genau = docs.filter((e) => nam(e) === m[1]), treffer = genau.length ? genau : docs.filter((e) => nam(e).includes(m[1]));
    if (treffer.length !== 1) { lokalAntworten(!docs.length ? "Es ist kein Textdokument geladen – bitte in der Karte „Dateien“ auswählen." : treffer.length ? "Mehrere Dokumente passen: " + treffer.slice(0, 5).map((e) => "„" + e.name + "“").join(", ") + ". Bitte genauer." : `Kein geladenes Dokument passt zu „${m[1]}“.`); return true; }
    const st = dokStellen(dokText(treffer[0].id), m[2]);
    lokalAntworten(st.length ? `„${m[2]}“ in „${treffer[0].name}“: ${st.length}${st.length >= DOK.maxStellen ? "+" : ""} Fundstelle(n):\n` + st.slice(0, 5).map((s) => `• Zeile ${s.zeile}: ${s.text}`).join("\n") : `„${m[2]}“ kommt in „${treffer[0].name}“ nicht vor.`);
    return true;
  },
});
// Einordnen: Abbruch früh (nach Hilfe, Paper, Gesperrt und den Aktien-Skills); die übrigen vor der Navigation
(function sprachSkillsEinordnen() {
  const neu = SKILLS.splice(SKILLS.length - 4, 4);
  const abbruch = neu.shift();
  // hinter die Aktien-Skills: „gesperrt“ → „aktien-strategie-dialog“ ist eine feste Reihenfolge (ab 11-02e)
  const nachAktien = SKILLS.findIndex((x) => x.name === "aktien-alarm");
  SKILLS.splice(nachAktien >= 0 ? nachAktien + 1 : SKILLS.findIndex((x) => x.name === "gesperrt") + 1, 0, abbruch);
  const nav = SKILLS.findIndex((x) => x.name === "navigation");
  SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, ...neu);
})();
// ---------- Sprachbefehlsvorschau ----------
function sprachDeutung(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  if (typeof werkzeugTrockenlauf !== "function") return "";
  let r = werkzeugTrockenlauf(t), vorsatz = "";
  if (r.code === "UNBEKANNT") { const n = sprachNormalisieren(t); if (n.geaendert && sprachSkillFuer(n.text)) { r = werkzeugTrockenlauf(n.text); vorsatz = "Verstanden als „" + n.text + "“: "; } }
  return "Vorschau: " + vorsatz + r.text;
}
(function sprachVorschauEinrichten() {
  const feld = document.getElementById("sprach-text"), box = document.getElementById("sprach-vorschau");
  if (!feld || !box) return;
  let p = document.getElementById("sprach-deutung");
  if (!p) { p = Object.assign(document.createElement("p"), { id: "sprach-deutung", className: "klein" }); p.setAttribute("aria-live", "polite"); feld.insertAdjacentElement("afterend", p); }
  const zeigen = () => { p.textContent = box.hidden ? "" : sprachDeutung(feld.value); };
  feld.addEventListener("input", zeigen);
  new MutationObserver(zeigen).observe(box, { attributes: true, attributeFilter: ["hidden"] });
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("sprachbefehle");
