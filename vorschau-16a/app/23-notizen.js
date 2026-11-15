// JARVIS Dashboard – Modul „notizen“ (ab 11-06h). Lokale Notizen: erstellen, bearbeiten, löschen (mit Rückfrage), suchen, Kategorien.
// Nur dieser Browser (localStorage „jarvis-notizen“), keine Anfrage. Beschädigter Speicher wird gemeldet und nie überschrieben
// (gleiche Regel wie Aufgaben und Routinen, SPEICHER_SCHADEN); Löschen in „Daten auf diesem Gerät“ gibt ihn frei.
// Format: { art: "jarvis-notizen", version: 1, notizen: [{ id, titel, text, kategorie, erstellt, geaendert }] }
const NOTIZEN = { schluessel: "jarvis-notizen", max: 500, maxTitel: 120, maxText: 5000, maxKategorie: 40, kategorien: ["Allgemein", "Privat", "Arbeit", "Ideen", "Finanzen"] };
let notizen = [];
let notizSpeicherOk = true;
let notizBearbeitet = null;
const notizEl = (id) => document.getElementById(id);
const notizGueltig = (n) => n && typeof n.id === "string" && typeof n.titel === "string" && typeof n.text === "string";

function notizenLaden() {
  let d = null;
  try { d = speicherJsonLesen(NOTIZEN.schluessel, (x) => istObjekt(x) && x.art === "jarvis-notizen" && Array.isArray(x.notizen)); } catch (e) { d = null; notizSpeicherOk = false; }
  notizen = d ? d.notizen.filter(notizGueltig).map((n) => ({ ...n, kategorie: String(n.kategorie || "Allgemein").slice(0, NOTIZEN.maxKategorie) })) : [];
  return notizen;
}
function notizenSpeichern() {
  if (speicherBeschaedigt(NOTIZEN.schluessel)) { notizSpeicherOk = false; return false; }
  try { localStorage.setItem(NOTIZEN.schluessel, JSON.stringify({ art: "jarvis-notizen", version: 1, notizen })); notizSpeicherOk = true; return true; }
  catch (e) { notizSpeicherOk = false; return false; }
}
function notizMelden(text) { notizEl("notiz-meldung").textContent = text; }

// Anlegen oder ändern; Ergebnis { notiz } | { fehler }
function notizSichern({ id = null, titel, text, kategorie }) {
  if (speicherBeschaedigt(NOTIZEN.schluessel)) return { fehler: SPEICHER_SCHADEN_TEXT };
  const t = String(titel || "").trim().slice(0, NOTIZEN.maxTitel), x = String(text || "").trim().slice(0, NOTIZEN.maxText);
  const k = String(kategorie || "").trim().slice(0, NOTIZEN.maxKategorie) || "Allgemein";
  if (!t && !x) return { fehler: "Titel oder Text fehlt." };
  const jetzt = new Date().toISOString();
  let n = id ? notizen.find((y) => y.id === id) : null;
  if (id && !n) return { fehler: "Notiz nicht mehr vorhanden (in einem anderen Tab gelöscht?)." };
  if (n) Object.assign(n, { titel: t || x.slice(0, 60), text: x, kategorie: k, geaendert: jetzt });
  else {
    if (notizen.length >= NOTIZEN.max) return { fehler: `Höchstens ${NOTIZEN.max} Notizen – bitte alte löschen.` };
    n = { id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), titel: t || x.slice(0, 60), text: x, kategorie: k, erstellt: jetzt, geaendert: jetzt };
    notizen.push(n);
  }
  const ok = notizenSpeichern();
  notizenAnzeigen();
  return ok ? { notiz: n } : { notiz: n, warnung: "Nicht dauerhaft gespeichert (Browserspeicher voll oder gesperrt) – gilt nur bis zum Neuladen." };
}
function notizLoeschen(id, { ohneRueckfrage = false } = {}) {
  const n = notizen.find((y) => y.id === id);
  if (!n) return false;
  if (!ohneRueckfrage && !confirm("Notiz löschen?\n\n" + n.titel)) return false;
  if (speicherBeschaedigt(NOTIZEN.schluessel)) { notizMelden(SPEICHER_SCHADEN_TEXT); return false; }
  notizen = notizen.filter((y) => y.id !== id);
  notizenSpeichern();
  if (notizBearbeitet === id) notizFormLeeren();
  notizenAnzeigen();
  // ab 11-07q: Aufgaben mit Verweis auf diese Notiz neu zeichnen (sonst stünde dort weiter „Notiz“)
  if (window.aufgabenIntern && window.aufgabenIntern.liste().some((a) => a.notizId === id)) window.aufgabenIntern.anzeigen();
  notizMelden("Notiz „" + n.titel + "“ gelöscht.");
  return true;
}
// ab 11-07e: Tags = „#wort“ in Titel oder Text (2–30 Buchstaben, Ziffern, _ oder -), klein geschrieben, ohne Doppel
function notizTags(n) { return [...new Set([...String(n.titel + " " + n.text).matchAll(/(?<![\p{L}\p{N}_&])#([\p{L}\p{N}_-]{2,30})/gu)].map((m) => m[1].toLowerCase()))]; }
// Suche in Titel, Text und Kategorie (alle Wörter müssen vorkommen), optional nach Kategorie und Tag; neueste Änderung zuerst
function notizenSuchen(suche = "", kategorie = "", tag = "") {
  const woerter = String(suche || "").toLowerCase().split(/\s+/).filter(Boolean);
  return notizen.filter((n) => (!kategorie || n.kategorie === kategorie) && (!tag || notizTags(n).includes(tag)) && woerter.every((w) => (n.titel + " " + n.text + " " + n.kategorie).toLowerCase().includes(w)))
    .sort((a, b) => String(b.geaendert).localeCompare(String(a.geaendert)));
}
function notizFormLeeren() {
  notizBearbeitet = null;
  notizEl("notiz-titel").value = ""; notizEl("notiz-text").value = ""; notizEl("notiz-kategorie").value = "Allgemein";
  notizEl("notiz-speichern").textContent = "Notiz speichern"; notizEl("notiz-abbrechen").hidden = true;
}
function notizBearbeiten(id) {
  const n = notizen.find((y) => y.id === id);
  if (!n) return;
  notizBearbeitet = id;
  notizEl("notiz-titel").value = n.titel; notizEl("notiz-text").value = n.text; notizEl("notiz-kategorie").value = n.kategorie;
  notizEl("notiz-speichern").textContent = "Änderung speichern"; notizEl("notiz-abbrechen").hidden = false;
  notizEl("notiz-titel").focus();
}
function notizenAnzeigen() {
  const alleKat = [...new Set([...NOTIZEN.kategorien, ...notizen.map((n) => n.kategorie)])];
  const filter = notizEl("notiz-filter-kategorie"), gewaehlt = filter.value;
  filter.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "alle Kategorien" }), ...alleKat.map((k) => Object.assign(document.createElement("option"), { value: k, textContent: k })));
  filter.value = alleKat.includes(gewaehlt) ? gewaehlt : "";
  notizEl("notiz-kategorien").replaceChildren(...alleKat.map((k) => Object.assign(document.createElement("option"), { value: k })));
  const tagFilter = notizEl("notiz-filter-tag"), tagGewaehlt = tagFilter.value;
  const alleTags = [...new Set(notizen.flatMap(notizTags))].sort((a, b) => a.localeCompare(b, "de"));
  tagFilter.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "alle Tags" }), ...alleTags.map((t) => Object.assign(document.createElement("option"), { value: t, textContent: "#" + t })));
  tagFilter.value = alleTags.includes(tagGewaehlt) ? tagGewaehlt : "";
  const treffer = notizenSuchen(notizEl("notiz-suche").value, filter.value, tagFilter.value);
  const liste = notizEl("notiz-liste");
  notizEl("notiz-zaehler").textContent = notizen.length ? `${treffer.length} von ${notizen.length} Notizen` : "";
  if (speicherBeschaedigt(NOTIZEN.schluessel)) { liste.replaceChildren(Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: "Keine Notizen geladen – " + SPEICHER_SCHADEN_TEXT })); return; }
  if (!treffer.length) { liste.replaceChildren(Object.assign(document.createElement("li"), { textContent: notizen.length ? "Keine Notiz passt zur Suche." : notizSpeicherOk ? "Noch keine Notizen. Oben Titel oder Text eingeben und „Notiz speichern“ wählen – oder sagen: „Neue Notiz Einkaufsliste Milch“." : "Browserspeicher gesperrt – Notizen gehen beim Neuladen verloren." })); return; }
  liste.replaceChildren(...treffer.map((n) => {
    const li = document.createElement("li");
    li.dataset.id = n.id;
    const kopf = Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: n.titel });
    const tags = notizTags(n);
    const meta = Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: n.kategorie + " · geändert " + new Date(n.geaendert).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + (tags.length ? " · " + tags.map((t) => "#" + t).join(" ") : "") });
    const text = Object.assign(document.createElement("p"), { className: "notiz-inhalt klein", textContent: n.text });
    const knopf = (t, f) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: t }); b.setAttribute("aria-label", t + ": " + n.titel); b.addEventListener("click", f); return b; };
    // ab 11-07e: Verknüpfung mit einer Aufgabe (eine je Notiz)
    const aufgabe = n.aufgabeId && window.aufgabenIntern ? window.aufgabenIntern.liste().find((a) => a.id === n.aufgabeId) : null;
    const verknuepfung = aufgabe ? knopf("Zur Aufgabe", () => aufgabeAnspringen(aufgabe.id)) : knopf("Als Aufgabe", () => notizAlsAufgabe(n.id));
    li.append(kopf, meta, knopf("Bearbeiten", () => notizBearbeiten(n.id)), knopf("Löschen", () => notizLoeschen(n.id)), verknuepfung, text);
    return li;
  }));
}
notizEl("notiz-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const r = notizSichern({ id: notizBearbeitet, titel: notizEl("notiz-titel").value, text: notizEl("notiz-text").value, kategorie: notizEl("notiz-kategorie").value });
  if (r.fehler) { notizMelden(r.fehler); return; }
  notizMelden((notizBearbeitet ? "Geändert: " : "Gespeichert: ") + "„" + r.notiz.titel + "“" + (r.warnung ? " – " + r.warnung : "."));
  notizFormLeeren();
  notizenAnzeigen();
});
notizEl("notiz-abbrechen").addEventListener("click", () => { notizFormLeeren(); notizMelden(""); });
notizEl("notiz-suche").addEventListener("input", notizenAnzeigen);
notizEl("notiz-filter-kategorie").addEventListener("change", notizenAnzeigen);
notizEl("notiz-filter-tag").addEventListener("change", notizenAnzeigen);
// ---------- Vorlagen und Verknüpfung mit Aufgaben (ab 11-07e) ----------
const NOTIZ_VORLAGEN = {
  besprechung: { name: "Besprechung", kategorie: "Arbeit", text: "Teilnehmer:\nThemen:\nBeschlüsse:\nNächste Schritte:" },
  einkauf: { name: "Einkaufsliste", kategorie: "Privat", text: "- \n- \n- " },
  idee: { name: "Idee", kategorie: "Ideen", text: "Idee:\nWarum:\nErster Schritt:" },
  tagebuch: { name: "Tagesnotiz", kategorie: "Privat", text: "Heute:\nGut lief:\nMorgen:" },
};
notizEl("notiz-vorlage").replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "Vorlage …" }),
  ...Object.entries(NOTIZ_VORLAGEN).map(([k, v]) => Object.assign(document.createElement("option"), { value: k, textContent: v.name })));
// Füllt nur einen leeren Text – vorhandener Text wird nie überschrieben
function notizVorlageEinfuegen(schluessel) {
  const v = NOTIZ_VORLAGEN[schluessel];
  if (!v) return false;
  if (notizEl("notiz-text").value.trim()) { notizMelden("Vorlage nicht eingefügt: Das Textfeld ist nicht leer."); return false; }
  notizEl("notiz-text").value = v.text;
  if (!notizEl("notiz-kategorie").value.trim() || notizEl("notiz-kategorie").value === "Allgemein") notizEl("notiz-kategorie").value = v.kategorie;
  if (!notizEl("notiz-titel").value.trim()) notizEl("notiz-titel").value = v.name + " " + new Date().toLocaleDateString("de-DE");
  notizMelden("Vorlage „" + v.name + "“ eingefügt.");
  return true;
}
notizEl("notiz-vorlage").addEventListener("change", (e) => { notizVorlageEinfuegen(e.target.value); e.target.value = ""; notizEl("notiz-text").focus(); });
// Legt eine Aufgabe zur Notiz an und verknüpft beide; eine schon verknüpfte, noch vorhandene Aufgabe wird nicht verdoppelt
function notizAlsAufgabe(id) {
  const n = notizen.find((y) => y.id === id);
  if (!n || !window.aufgabenIntern) return null;
  if (speicherBeschaedigt(NOTIZEN.schluessel)) { notizMelden(SPEICHER_SCHADEN_TEXT); return null; }
  if (n.aufgabeId && window.aufgabenIntern.liste().some((a) => a.id === n.aufgabeId)) { notizMelden("Zu „" + n.titel + "“ gibt es schon eine Aufgabe."); return n.aufgabeId; }
  const aid = window.aufgabenIntern.ausNotiz(n.titel, n.id);
  if (!aid) { notizMelden("Aufgabe nicht angelegt."); return null; }
  n.aufgabeId = aid;
  notizenSpeichern();
  notizenAnzeigen();
  window.aufgabenIntern.anzeigen();
  notizMelden("Aufgabe „" + n.titel + "“ angelegt und mit der Notiz verknüpft.");
  return aid;
}
function zuListenEintrag(ansicht, li) {
  if (!li) return false;
  if (typeof ansichtSicherstellen === "function") ansichtSicherstellen(ansicht);
  if (!li.hasAttribute("tabindex")) li.setAttribute("tabindex", "-1");
  return typeof zuElementSpringen === "function" ? zuElementSpringen(li) : (li.focus(), true);
}
// Springt zur Aufgabe bzw. Notiz; Filter, die sie ausblenden würden, werden dafür zurückgesetzt
function aufgabeAnspringen(id) {
  for (const f of ["aufgaben-filter", "aufgaben-kategorie-filter"]) { const el = document.getElementById(f); if (el) el.value = ""; }
  window.aufgabenIntern.anzeigen();
  return zuListenEintrag("cockpit", document.querySelector(`#aufgaben-liste li[data-id="${CSS.escape(id)}"]`));
}
function notizAnspringen(id) {
  notizEl("notiz-suche").value = ""; notizEl("notiz-filter-kategorie").value = ""; notizEl("notiz-filter-tag").value = "";
  notizenAnzeigen();
  return zuListenEintrag("cockpit", document.querySelector(`#notiz-liste li[data-id="${CSS.escape(id)}"]`));
}
window.addEventListener("storage", (e) => { if (e.key === NOTIZEN.schluessel) { notizenLaden(); notizenAnzeigen(); } });
notizenLaden();
notizFormLeeren();
notizenAnzeigen();

// ---------- Sprachbefehle: Notizen und Aufgaben (ab 11-06h) ----------
// „notiere …“ bleibt wie bisher eine Aufgabe. Notizen nur mit dem Wort „Notiz“.
skillRegistrieren({
  name: "notiz-anlegen",
  risiko: "leicht",
  beschreibung: "Notiz anlegen (rückgängig: Notiz löschen)",
  beispiele: ["Neue Notiz Einkaufsliste Milch und Brot", "Notiz: Idee für das Wochenende"],
  passt: (text) => /^(neue notiz|notiz anlegen|notiz)\s*[:,]?\s+\S/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const inhalt = text.replace(/^\s*(hey\s+)?jarvis[\s,]+/i, "").replace(/^\s*(neue notiz|notiz anlegen|notiz)\s*[:,]?\s*/i, "").replace(/[.!]+\s*$/, "").trim();
    if (!inhalt) return false;
    const r = notizSichern({ titel: inhalt.slice(0, 60), text: inhalt, kategorie: "Allgemein" });
    if (r.fehler) { lokalAntworten("Notiz nicht angelegt: " + r.fehler, "fehler"); return true; }
    lokalAntworten("Notiz angelegt: „" + r.notiz.titel + "“." + (r.warnung ? " " + r.warnung : "") + " Rückgängig: „Lösche Notiz " + r.notiz.titel + "“.");
    return true;
  },
});
skillRegistrieren({
  name: "notizen-suchen",
  risiko: "abfrage",
  beschreibung: "Notizen anzeigen oder durchsuchen (nur lokal)",
  beispiele: ["Zeige meine Notizen", "Suche Notiz Einkauf"],
  passt: (text) => /^(zeige?( mir)?( meine| die)? notizen|meine notizen|(suche|finde)( die)? notiz(en)?( zu| über| ueber| mit)? .+)$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const t = befehlNormalisieren(text);
    const suche = (t.match(/^(?:suche|finde)(?: die)? notiz(?:en)?(?: zu| über| ueber| mit)? (.+)$/) || [])[1] || "";
    notizEl("notiz-suche").value = suche;
    notizenAnzeigen();
    const treffer = notizenSuchen(suche);
    lokalAntworten(!notizen.length ? "Es gibt noch keine Notizen." : treffer.length ? `${treffer.length} Notiz(en)${suche ? " zu „" + suche + "“" : ""}: ` + treffer.slice(0, 5).map((n) => "„" + n.titel + "“").join(", ") + (treffer.length > 5 ? " …" : "") + " – siehe Karte „Notizen“." : `Keine Notiz zu „${suche}“ gefunden.`);
    return true;
  },
});
skillRegistrieren({
  name: "notiz-loeschen",
  risiko: "bestaetigen",
  beschreibung: "Notiz löschen",
  beispiele: ["Lösche Notiz Einkaufsliste"],
  passt: (text) => /^(lösche|loesche|entferne)( die)? notiz .+/.test(befehlNormalisieren(text)),
  planen: async (text) => {
    const suche = befehlNormalisieren(text).replace(/^(lösche|loesche|entferne)( die)? notiz /, "").trim();
    const genau = notizen.filter((n) => n.titel.toLowerCase() === suche);
    const treffer = genau.length ? genau : notizen.filter((n) => n.titel.toLowerCase().includes(suche));
    if (!treffer.length) return { fehler: "Keine Notiz „" + suche + "“ gefunden." };
    if (treffer.length > 1) return { fehler: "Mehrere Notizen passen (" + treffer.slice(0, 4).map((n) => "„" + n.titel + "“").join(", ") + ") – bitte genauer sagen." };
    const n = treffer[0];
    return { beschreibung: "Notiz „" + n.titel + "“ wird gelöscht.", ausfuehren: async () => { notizLoeschen(n.id, { ohneRueckfrage: true }); return "Notiz „" + n.titel + "“ gelöscht."; } };
  },
});
skillRegistrieren({
  name: "aufgaben-zeigen",
  risiko: "abfrage",
  beschreibung: "Offene, fällige oder heutige Aufgaben nennen (nur lokal)",
  beispiele: ["Welche Aufgaben sind offen?", "Was ist heute fällig?"],
  passt: (text) => /^(welche aufgaben (sind |habe ich )?(offen|fällig|faellig|heute)|zeige?( mir)?( meine| die)? (offenen |fälligen |faelligen )?aufgaben|meine aufgaben|was ist heute fällig|was ist heute faellig|was steht heute an)\??$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const alle = window.aufgabenIntern ? window.aufgabenIntern.liste() : null;
    if (!alle) return false;
    const jetzt = Date.now(), heute = new Date(jetzt).toDateString();
    const offen = alle.filter((a) => !a.erledigt);
    const faellig = offen.filter((a) => a.faellig && (new Date(a.faellig).getTime() <= jetzt || new Date(a.faellig).toDateString() === heute));
    const nurFaellig = /fällig|faellig|heute|steht/.test(befehlNormalisieren(text));
    const liste = nurFaellig ? faellig : offen;
    lokalAntworten(!liste.length ? (nurFaellig ? "Heute ist nichts fällig." : "Keine offenen Aufgaben.") : `${liste.length} ${nurFaellig ? "fällig" : "offen"}: ` + liste.slice(0, 6).map((a) => "„" + a.titel + "“" + (a.prio === "hoch" ? " (hoch)" : "")).join(", ") + (liste.length > 6 ? " …" : "") + ".");
    return true;
  },
});
skillRegistrieren({
  name: "aufgabe-erledigt",
  risiko: "leicht",
  beschreibung: "Aufgabe als erledigt markieren (rückgängig in der Aufgabenliste)",
  beispiele: ["Aufgabe Arzt anrufen erledigt", "Hake Arzt anrufen ab"],
  passt: (text) => /^(aufgabe .+ (ist )?erledigt|hake .+ ab|erledige( die)? aufgabe .+)$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const t = befehlNormalisieren(text);
    const suche = (t.match(/^aufgabe (.+?) (?:ist )?erledigt$/) || t.match(/^hake (?:die aufgabe )?(.+) ab$/) || t.match(/^erledige(?: die)? aufgabe (.+)$/) || [])[1];
    const offen = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => !a.erledigt) : [];
    const genau = offen.filter((a) => a.titel.toLowerCase() === suche);
    const treffer = genau.length ? genau : offen.filter((a) => suche && a.titel.toLowerCase().includes(suche));
    if (treffer.length !== 1) { lokalAntworten(treffer.length ? "Mehrere offene Aufgaben passen (" + treffer.slice(0, 4).map((a) => "„" + a.titel + "“").join(", ") + ") – bitte genauer sagen. Nichts geändert." : "Keine offene Aufgabe „" + (suche || "") + "“ gefunden. Nichts geändert.", "fehler"); return true; }
    const naechster = window.aufgabenIntern.abhaken(treffer[0].id, true, Date.now(), { ohneAnzeige: true }); // ab 11-13j: nur einmal zeichnen (nächste Zeile)
    window.aufgabenIntern.anzeigen();
    lokalAntworten("Erledigt: „" + treffer[0].titel + "“" + (naechster ? " – nächster Termin " + new Date(naechster).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "") + ".");
    return true;
  },
});

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("notizen");
