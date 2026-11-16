// JARVIS Dashboard – Modul „sprache3“ (ab 11-10d). Sprachassistent 3.0 über der vorhandenen Zeiterkennung (25) und Normalisierung (40):
//   - weitere gesprochene Zeitangaben: Monatsnamen („am 3. Dezember“), „Viertel nach/vor“, „halb“ mit Zahlwort, „Ende der Woche“,
//     „am Wochenende“, „nächste Woche“, „in einer (halben) Stunde“, „in zwei Wochen“ – werden in die bekannten Formen übersetzt;
//     was dann nicht eindeutig ist, bleibt eine Rückfrage (nie raten)
//   - typische Spracherkennungsfehler: Mehrzahl statt Einzahl („neue Aufgaben …“), verhörtes „Jarvis“ am Satzanfang
//   - Sprachbefehle für Workflows: „Zeige meine Workflows“, „Teste Workflow …“ (Trockenlauf, führt nichts aus)
// Keine Anfrage, kein Speicher.
const MONATE = { januar: 1, jänner: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
const ZAHLWORT_STUNDE = { eins: 1, ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12 };
const stundeZahl = (w) => (/^\d{1,2}$/.test(w) ? Number(w) : ZAHLWORT_STUNDE[String(w).toLowerCase()] ?? null);
// Übersetzt gesprochene Formen in die Formen, die zeitangabeErkennen kennt
function zeitVorbereiten(text) {
  let t = String(text || "");
  t = t.replace(/\bam\s+(\d{1,2})\.?\s+(januar|jänner|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(\s+(\d{4}))?\b/gi, (_, d, m, __, j) => `am ${d}.${MONATE[m.toLowerCase()]}.${j || ""}`);
  t = t.replace(/\b(?:um\s+)?viertel\s+nach\s+(\d{1,2}|[a-zäöü]+)\b/gi, (g, h) => { const s = stundeZahl(h); return s === null ? g : `um ${s}:15`; });
  t = t.replace(/\b(?:um\s+)?viertel\s+vor\s+(\d{1,2}|[a-zäöü]+)\b/gi, (g, h) => { const s = stundeZahl(h); return s === null ? g : `um ${(s + 11) % 12 || 12}:45`; });
  t = t.replace(/\b(?:um\s+)?dreiviertel\s+(\d{1,2}|[a-zäöü]+)\b/gi, (g, h) => { const s = stundeZahl(h); return s === null ? g : `um ${(s + 11) % 12 || 12}:45`; });
  t = t.replace(/\b(?:bis\s+)?(?:zum\s+|am\s+)?ende\s+der\s+woche\b/gi, "am freitag");
  t = t.replace(/\bam\s+wochenende\b/gi, "am samstag");
  t = t.replace(/\b(?:in\s+der\s+)?nächsten\s+woche\b|\bnächste\s+woche\b|\bnaechste\s+woche\b/gi, "am nächsten montag");
  t = t.replace(/\bin\s+einer\s+halben\s+stunde\b/gi, "in 30 minuten");
  t = t.replace(/\bin\s+einer\s+(stunde|minute|woche)\b/gi, (_, e) => `in 1 ${e}`);
  t = t.replace(/\bin\s+eineinhalb\s+stunden\b/gi, "in 90 minuten");
  // Befund 10d: „morgen Nachmittag“ ergab 9 Uhr und „Nachmittag“ blieb im Titel – die Tageszeit braucht die Form „nachmittags“
  t = t.replace(/\b(morgen|übermorgen|uebermorgen)\s+(vormittag|mittag|nachmittag|abend|nacht)\b/gi, (_, tag, zeit) => `${tag} ${zeit.toLowerCase()}s`);
  return t;
}
if (typeof zeitangabeErkennen === "function") {
  const original = zeitangabeErkennen;
  zeitangabeErkennen = function (text, jetzt) {
    const vorbereitet = zeitVorbereiten(text);
    return original(vorbereitet, jetzt);
  };
}
// Spracherkennungsfehler vor der Normalisierung glätten
const SPRACH_FEHLER = [[/^(?:hey |hallo |ok )?(?:davis|jarwis|tschavis|jervis|service|travis)[,!.]?\s+/i, ""], [/^neue aufgaben\b/i, "neue aufgabe"], [/^neue notizen\b/i, "neue notiz"], [/^neuer aufgabe\b/i, "neue aufgabe"], [/^lösch\b(?!e)/i, "lösche"]];
function spracheFehlerGlaetten(text) { let t = String(text || "").trim(); for (const [re, z] of SPRACH_FEHLER) t = t.replace(re, z); return t; }
if (typeof sprachNormalisieren === "function") {
  const original = sprachNormalisieren;
  sprachNormalisieren = function (text) {
    const g = spracheFehlerGlaetten(text), r = original(g);
    return { text: r.text, geaendert: r.geaendert || (g !== String(text || "").trim() && r.text.length > 0) };
  };
}
// ---------- Workflows per Sprache ----------
skillRegistrieren({
  name: "workflows-zeigen",
  risiko: "abfrage",
  hilfeKurz: "Workflows",
  beschreibung: "Workflows (Routinen) nennen oder im Testmodus prüfen – führt nichts aus",
  beispiele: ["Zeige meine Workflows", "Teste Workflow Morgenübersicht"],
  passt: (text) => /^(zeige?( mir)?( meine| die)? (workflows|routinen)|meine (workflows|routinen)|(teste|prüfe|pruefe) (den |die )?(workflow|routine) .+)$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const t = befehlNormalisieren(text), m = /^(?:teste|prüfe|pruefe) (?:den |die )?(?:workflow|routine) (.+)$/.exec(t);
    if (!m) { lokalAntworten(routinen.length ? "Deine Workflows:\n" + routinen.map((r) => `• ${r.name} (${r.schritte.length} Schritte${r.pausiert ? ", pausiert" : ""})`).join("\n") + "\nStarten: „Starte Routine …“ (mit Rückfrage), testen: „Teste Workflow …“." : "Noch keine Workflows."); return true; }
    const r = routinen.find((x) => befehlNormalisieren(x.name) === m[1]) || routinen.find((x) => befehlNormalisieren(x.name).includes(m[1]));
    if (!r) { lokalAntworten(`Einen Workflow „${m[1]}“ gibt es nicht.`); return true; }
    const tl = typeof wfTrockenlauf === "function" ? wfTrockenlauf(r.id) : [];
    lokalAntworten(`Testmodus „${r.name}“ – es wird nichts ausgeführt:\n` + tl.map((x) => `${x.nr}. ${x.text} → ${x.ergebnis}`).join("\n"));
    return true;
  },
});
(function sprache3Einordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("sprache3");
