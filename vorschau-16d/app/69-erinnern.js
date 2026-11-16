// JARVIS Dashboard – Modul „erinnern“ (ab 11-11d). Gedächtnis und persönliche Organisation – ergänzt 15/42/54 (Profil, Präferenzen,
// Herkunft, Zeitstempel, Konflikte, Löschschutz gegen alte Tabs, Export/Import) und 23/55 (Notiz ↔ Aufgabe, Tages-/Wochenplanung):
//   - Gedächtnisfragen lokal beantworten statt an die KI: „Was weißt du über meinen Zahnarzt?“, „Erinnerst du dich an …?“,
//     „Habe ich dir etwas über … gesagt?“ – mit Herkunft (Profil/Notiz/Projekt) und Datum; nichts gespeichert → ehrlich „nichts
//     gespeichert“ (JARVIS erfindet keine Erinnerungen); sensible Einträge werden genannt, ihr Inhalt aber nicht vorgelesen
//   - „Was ist überfällig?“ – überfällige Aufgaben mit Fälligkeit, ältestes zuerst
// Kein Speicher, keine Anfrage.
const ERINNERN_FRAGE = /^(?:was (?:weißt|weisst) du (?:über|ueber|von) (?!mich$|mir$)(.+)|erinnerst du dich (?:an|daran,? dass) (.+)|(?:weißt|weisst) du noch,? (.+)|hab(?:e)? ich dir (?:etwas |was )?(?:über|ueber|zu|von) (.+?) (?:gesagt|erzählt|erzaehlt))$/;
const ERINNERN_STOPP = new Set(["mein", "meine", "meinen", "meinem", "meiner", "der", "die", "das", "den", "dem", "ein", "eine", "einen", "über", "von", "zu", "mit", "und", "ich", "dir", "was", "wie", "wann", "wo"]);
// nur der Gegenstand der Frage („meinen Zahnarzt“ → „zahnarzt“), nicht die Fragewörter
function erinnernBegriffe(frage) { const n = befehlNormalisieren(frage), m = ERINNERN_FRAGE.exec(n), g = m ? m.slice(1).find(Boolean) : n; return g.split(" ").filter((w) => w.length >= 3 && !ERINNERN_STOPP.has(w)); }
function erinnernSuchen(frage) {
  const w = erinnernBegriffe(frage), passt = (...t) => { const v = befehlNormalisieren(t.filter(Boolean).join(" ")); return w.length && w.some((x) => v.includes(x.replace(/(en|n|s)$/, ""))); }, aus = [];
  for (const e of typeof profil !== "undefined" ? profil : []) if (passt(e.titel, e.text, e.projekt)) aus.push({ herkunft: "Profil", titel: typeof profilBezeichnung === "function" ? profilBezeichnung(e) : e.titel, text: e.sensibel ? null : e.text, sensibel: Boolean(e.sensibel), zeit: e.geaendert || e.erstellt });
  for (const n of typeof notizenSuchen === "function" ? notizenSuchen("", "", "") : []) if (passt(n.titel, n.text)) aus.push({ herkunft: "Notiz", titel: n.titel, text: String(n.text || "").slice(0, 120), zeit: n.geaendert || n.erstellt });
  for (const p of typeof projekteLesen === "function" ? projekteLesen().projekte : []) if (passt(p.name, p.ziel)) aus.push({ herkunft: "Projekt", titel: p.name, text: p.ziel || p.status, zeit: p.geaendert || p.erstellt });
  return { begriffe: w, treffer: aus.slice(0, 8) };
}
function erinnernAntwort(frage) {
  const r = erinnernSuchen(frage), datum = (z) => (z && !isNaN(Date.parse(z)) ? new Date(z).toLocaleDateString("de-DE") : "ohne Datum");
  if (!r.begriffe.length) return "Worüber genau? Nenne bitte einen Begriff, z. B. „Was weißt du über meinen Zahnarzt?“.";
  if (!r.treffer.length) return `Zu „${r.begriffe.join(" ")}“ habe ich auf diesem Gerät nichts gespeichert – ich erfinde dazu nichts. Mit „Merke dir …“ kannst du es speichern.`;
  return `Gespeichert zu „${r.begriffe.join(" ")}“:\n` + r.treffer.map((t) => `• ${t.herkunft} „${t.titel}“ (${datum(t.zeit)}): ${t.sensibel ? "sensibel – Inhalt nur im Profil sichtbar" : t.text}`).join("\n") + "\nMehr weiß ich dazu nicht.";
}
function ueberfaelligListe(jetzt = Date.now()) {
  return (window.aufgabenIntern ? window.aufgabenIntern.liste() : []).filter((a) => !a.erledigt && a.faellig && Date.parse(a.faellig) < jetzt).sort((a, b) => a.faellig.localeCompare(b.faellig));
}
skillRegistrieren({
  name: "gedaechtnis-frage", risiko: "abfrage", hilfeKurz: "Erinnerungen",
  beschreibung: "Gedächtnisfrage lokal beantworten – nur Gespeichertes, nichts erfunden", beispiele: ["Was weißt du über meinen Zahnarzt?", "Was ist überfällig?"],
  passt: (text) => { const t = befehlNormalisieren(text); return ERINNERN_FRAGE.test(t) || /^(was ist überfällig|was ist ueberfaellig|überfällige aufgaben|zeige?( mir)? (die |meine )?überfälligen aufgaben)$/.test(t); },
  aktion: async (text) => {
    const t = befehlNormalisieren(text);
    if (/überfällig|ueberfaellig/.test(t) && !ERINNERN_FRAGE.test(t)) {
      const l = ueberfaelligListe();
      lokalAntworten(l.length ? `${l.length} überfällige Aufgabe(n):\n` + l.slice(0, 10).map((a) => `• ${a.titel} (seit ${new Date(a.faellig).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })})`).join("\n") + "\n„Tagesabschluss“ in der Tagesplanung verschiebt Offenes auf morgen." : "Nichts ist überfällig.");
      return true;
    }
    lokalAntworten(erinnernAntwort(text));
    return true;
  },
});
(function erinnernEinordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("erinnern");
