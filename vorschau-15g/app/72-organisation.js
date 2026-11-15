// JARVIS Dashboard – Modul „organisation“ (ab 11-13f). Persönliche Organisation per Satz – gefunden mit 25 Sätzen ohne KI-Verbindung
// (docs/AUFTRAG_13.md, Block 6). Nutzt nur vorhandene Funktionen und Daten, legt keinen eigenen Speicher an:
//   - Wochenplan: überfällig und die nächsten 7 Tage (Wochenübersicht aus 11), mit „wartet auf …“
//   - Prioritäten: „Was ist am wichtigsten?“ – Reihenfolge des Tagesplans (55) mit Gründen (vorher als Zeitraum „am …“ fehlgedeutet)
//   - Blockiertes: Projekte (57) plus einzelne Aufgaben ohne Projekt, die auf eine offene Aufgabe warten (fehlten bisher)
//   - globale Suche im Chat (39), verpasste Routinen (13), zuletzt ausgeführte Aktionen (33, nur diese Sitzung)
//   - Aufgabe einem Projekt zuordnen (Kategorie = Projektname) und Notiz mit Aufgabe verknüpfen (23) – beides nur nach „Ja“
//   - „Aufgabe Fenster putzen morgen“ (ohne „Neue“) → Rückfrage, ob die Aufgabe angelegt werden soll
//   - Umformungen auf vorhandene Befehle: Meilensteine, Projektstand, offene Entscheidungen, Tag zusammenfassen, Morgenbriefing
//   - Aktionsverlauf: auch vorab beantwortete Sätze (71/72) erscheinen jetzt in „Zuletzt ausgeführte Aktionen“
// Keine Anfrage.
const ORG = { maxTreffer: 8, maxAktionen: 5 };
const orgAufgaben = () => (window.aufgabenIntern ? window.aufgabenIntern.liste() : []);
const orgTag = (d) => new Date(d).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const orgUhr = (d) => new Date(d).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
function orgWartet(a, alle = orgAufgaben()) { const v = a.abhaengigVon && alle.find((x) => x.id === a.abhaengigVon); return v && !v.erledigt ? v : null; }
function orgAufgabeFinden(titel) {
  const n = befehlNormalisieren(titel), offen = orgAufgaben().filter((a) => !a.erledigt);
  return offen.find((a) => befehlNormalisieren(a.titel) === n) || offen.filter((a) => befehlNormalisieren(a.titel).startsWith(n)).sort((x, y) => x.titel.length - y.titel.length)[0] || null;
}
function orgWochenplan(jetzt = Date.now()) {
  if (!window.aufgabenIntern || typeof window.aufgabenIntern.wochenUebersicht !== "function") return "Die Aufgaben sind nicht verfügbar.";
  const w = window.aufgabenIntern.wochenUebersicht(jetzt), alle = orgAufgaben();
  const z = (a) => { const v = orgWartet(a, alle); return `${orgUhr(a.faellig)} ${a.titel}${a.prio === "hoch" ? " (hoch)" : ""}${v ? ` – wartet auf „${v.titel}“` : ""}`; };
  const zeilen = w.tage.filter((t) => t.aufgaben.length).map((t) => `• ${orgTag(t.datum)}: ${t.aufgaben.map(z).join(" · ")}`);
  const ohne = alle.filter((a) => !a.erledigt && !a.faellig).length;
  if (!zeilen.length && !w.ueberfaellig.length) return "Wochenplan (nächste 7 Tage): Es ist nichts fällig." + (ohne ? ` ${ohne} offene Aufgabe(n) ohne Termin.` : "");
  return "Wochenplan (nächste 7 Tage):\n" + (w.ueberfaellig.length ? `⚠ Überfällig: ${w.ueberfaellig.map((a) => a.titel).join(", ")}\n` : "") + (zeilen.join("\n") || "• keine Termine") + (ohne ? `\n${ohne} offene Aufgabe(n) ohne Termin.` : "");
}
function orgPrioritaeten(jetzt = new Date()) {
  if (typeof tplanReihenfolge !== "function") return "Der Tagesplan ist nicht verfügbar.";
  const r = tplanReihenfolge(jetzt, jetzt).filter((x) => !x.w).slice(0, 3);
  if (r.length) return "Am wichtigsten (Reihenfolge des Tagesplans):\n" + r.map((x, i) => `${i + 1}. ${x.a.titel} – ${x.gruende.filter((g) => !/ min/.test(g)).join(", ") || "ohne Termin"}`).join("\n") + "\nBegründung: überfällig zuerst, dann Priorität, dann Fälligkeit; Aufgaben, die auf etwas warten, kommen nicht nach vorn.";
  const n = orgAufgaben().filter((a) => !a.erledigt && a.faellig && !orgWartet(a)).sort((a, b) => a.faellig.localeCompare(b.faellig)).slice(0, 3);
  return n.length ? "Für heute ist nichts offen. Als Nächstes fällig: " + n.map((a) => `„${a.titel}“ (${orgTag(a.faellig)})`).join(", ") + "." : "Es ist keine Aufgabe offen.";
}
// Projekte (57) und zusätzlich Aufgaben ohne aktives Projekt
function orgBlockiert() {
  const alle = orgAufgaben(), r = typeof projekteBlockiert === "function" ? projekteBlockiert() : [];
  const schon = new Set(r.filter((x) => x.art === "Aufgabe").map((x) => x.titel));
  for (const a of alle.filter((x) => !x.erledigt && !schon.has(x.titel))) { const v = orgWartet(a, alle); if (v) r.push({ projekt: a.kategorie || "ohne Projekt", art: "Aufgabe", titel: a.titel, wartetAuf: v.titel }); }
  return r;
}
function orgSuche(frage) {
  if (typeof arbeitsplatzSuchen !== "function") return "Die Suche ist nicht verfügbar.";
  const t = arbeitsplatzSuchen(frage);
  if (!t.length) return `Zu „${frage}“ finde ich nichts in Aufgaben, Notizen, Projekten, Dateien, Profil und Navigation.`;
  return `${t.length} Treffer zu „${frage}“:\n` + t.slice(0, ORG.maxTreffer).map((x) => `• ${x.art}: ${x.titel}${x.vorschau && x.vorschau !== x.art ? " – " + x.vorschau : ""}`).join("\n") + (t.length > ORG.maxTreffer ? `\n… und ${t.length - ORG.maxTreffer} weitere – alle in der Suche des Arbeitsplatzes.` : "");
}
function orgVerpasst() {
  if (typeof routinenVerpasst !== "function") return "Die Routinen sind nicht verfügbar.";
  const v = routinenVerpasst();
  return v.length ? "Ausgelassene tägliche Routinen (letzte 7 Tage):\n" + v.map((x) => `• ${x.name}: ${x.tage.length}× (${x.tage.map((t) => orgTag(t + "T12:00:00")).join(", ")})`).join("\n") + "\nGezählt werden nur Tage nach dem ersten gemerkten Abschluss; pausierte Routinen zählen nicht."
    : "Keine tägliche Routine ausgelassen (letzte 7 Tage; gezählt ab dem ersten gemerkten Abschluss).";
}
function orgAktionen() {
  if (typeof AKTIONEN === "undefined") return "Der Aktionsverlauf ist nicht verfügbar.";
  const l = AKTIONEN.liste.slice(0, ORG.maxAktionen);
  return l.length ? "Zuletzt ausgeführt (nur diese Sitzung):\n" + l.map((a) => `• ${orgUhr(a.zeit)} „${a.text}“ → ${(typeof AKTION_NAMEN !== "undefined" && AKTION_NAMEN[a.skill]) || a.skill || "an die KI/nicht erkannt"}`).join("\n")
    : "In dieser Sitzung wurde noch nichts ausgeführt (der Verlauf liegt nur im Arbeitsspeicher).";
}
const ORG_FRAGEN = [
  [/^(zeige? (mir )?(meine |die )?(wochenplanung|wochenplan|wochenübersicht)|wochenplan(ung)?|was steht (in )?den nächsten (7|sieben) tagen an|meine woche)$/, () => orgWochenplan()],
  [/^(was ist (heute )?am wichtigsten|was (soll|sollte) ich (heute )?zuerst (machen|erledigen|tun)|was hat (gerade |heute )?(priorität|vorrang)|womit fange ich an|meine prioritäten)$/, () => orgPrioritaeten()],
  [/^(was ist (gerade )?blockiert|welche aufgaben sind blockiert|welche aufgaben warten( noch)?|blockierte aufgaben|was blockiert (mich|uns)( gerade| noch)?)$/, () => { const b = orgBlockiert(); return b.length ? "Blockiert:\n" + b.map((x) => `• ${x.projekt}: „${x.titel}“ wartet auf „${x.wartetAuf}“`).join("\n") : "Es ist nichts blockiert – weder in Projekten noch bei einzelnen Aufgaben."; }],
  [/^(welche|was für) routinen (habe ich|wurden|sind) (ausgelassen|verpasst|vergessen)( worden)?$|^(ausgelassene|verpasste) routinen$/, () => orgVerpasst()],
  [/^(was habe ich (zuletzt|eben|gerade) (gemacht|ausgeführt)|zeige? (mir )?die letzten aktionen|letzte aktionen|was hast du (zuletzt|eben) (gemacht|ausgeführt))$/, () => orgAktionen()],
];
const ORG_SUCHE = /^(?:suche|such|finde|durchsuche alles nach)(?: mir)?(?: überall| ueberall| alles)?(?: nach)? (?!(?:notiz|notizen|datei|dateien|im |in |nach im )\b)(.{2,60})$/;
skillRegistrieren({
  name: "organisation", risiko: "abfrage", hilfeKurz: "Organisation",
  beschreibung: "Wochenplan, Prioritäten, Blockiertes, globale Suche, ausgelassene Routinen, letzte Aktionen (nur lokale Daten)", beispiele: ["Zeig meine Wochenplanung", "Was ist am wichtigsten?", "Suche überall nach Steuer"],
  passt: (text) => { const t = befehlNormalisieren(text); return ORG_FRAGEN.some(([re]) => re.test(t)) || ORG_SUCHE.test(t); },
  aktion: async (text) => { const t = befehlNormalisieren(text), f = ORG_FRAGEN.find(([re]) => re.test(t)); lokalAntworten(f ? f[1]() : orgSuche(ORG_SUCHE.exec(t)[1])); return true; },
});
(function orgEinordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();
if (typeof SPRACH_REGELN !== "undefined") SPRACH_REGELN.push(
  [/^meilensteine (von|für|fuer|im) (projekt )?(.+)$/, "wie steht projekt $3"],
  [/^wie stehen (meine|die) projekte$|^(projektübersicht|projektfortschritt|fortschritt meiner projekte)$/, "vergleiche meine projekte"],
  [/^welche entscheidungen (sind|stehen) (noch )?offen$|^was muss ich (noch )?entscheiden$|^offene entscheidungen$/, "was wartet auf meine freigabe"],
  [/^fasse (mir )?meinen tag zusammen$|^(tageszusammenfassung|mein tag)$/, "abendzusammenfassung"],
  [/^(morgenbriefing|morgen briefing|gib mir (das|mein) (morgen)?briefing)$/, "briefing"],
);
// vor dem Dispatcher: Prioritäten/Blockiertes (sonst „am …“-Zeitraum bzw. nur Projekte), Zuordnen und Verknüpfen (nur mit Rückfrage),
// „Aufgabe X morgen“ ohne „Neue“ – nie am Sperr-Skill vorbei und nicht bei offener Rückfrage
if (typeof skillAusfuehren === "function") {
  const original = skillAusfuehren;
  skillAusfuehren = async function (text) {
    const roh = String(text || ""), t = befehlNormalisieren(roh), sperre = SKILLS.find((s) => s.name === "gesperrt");
    const frei = !(typeof offeneAktion !== "undefined" && offeneAktion) && !(typeof slDialogPasst === "function" && slDialogPasst(roh)) && !(sperre && sperre.passt(roh));
    if (frei && typeof bestaetigungAnfordern === "function") {
      const f = ORG_FRAGEN.find(([re]) => re.test(t));
      if (f) { lokalAntworten(f[1]()); return "organisation"; }
      // „Zeig die Meilensteine von X“ – als Sprachregel wirkungslos, weil „zeig …“ vorher zu „zeige …“ umgeschrieben wird (40)
      const ms = /^(?:zeige? (?:mir )?(?:die )?|welche )meilensteine (?:hat |von |für |fuer |im |vom |des )?(?:projekt(?:s)? )?(.+?)( noch)?$/.exec(t);
      if (ms) return original.call(this, "Wie steht Projekt " + ms[1]);
      // „Ordne Aufgabe X dem Projekt Y zu“ / „Aufgabe X gehört zu Projekt Y“ → Kategorie = Projektname
      const zu = /^(?:ordne )?(?:die )?aufgabe (.+?) (?:dem|zum|in das|ins|zu dem) projekt (.+?) zu$|^(?:die )?aufgabe (.+?) (?:gehört|gehoert) zu(?:m)? projekt (.+)$/.exec(t);
      if (zu && typeof projekteLesen === "function") {
        const a = orgAufgabeFinden(zu[1] || zu[3]), pn = befehlNormalisieren(zu[2] || zu[4]), p = projekteLesen().projekte.find((x) => befehlNormalisieren(x.name) === pn);
        if (!a || !p) { lokalAntworten(!a ? `Eine offene Aufgabe „${zu[1] || zu[3]}“ finde ich nicht. Es wurde nichts geändert.` : `Ein Projekt „${zu[2] || zu[4]}“ finde ich nicht. Es wurde nichts geändert.`); return "organisation"; }
        bestaetigungAnfordern({ name: "tagesplan" }, { beschreibung: `Aufgabe „${a.titel}“ dem Projekt „${p.name}“ zuordnen?${a.kategorie && a.kategorie !== p.name ? ` (bisherige Kategorie „${a.kategorie}“ wird ersetzt)` : ""}`, ausfuehren: async () => { const r = tplanAendern(a.id, (x) => { x.kategorie = p.name; }); if (typeof projekteAnzeigen === "function") projekteAnzeigen(); return r && r.fehler ? r.fehler : `„${a.titel}“ gehört jetzt zum Projekt „${p.name}“.`; } });
        return "organisation";
      }
      // „Verknüpfe Notiz X mit Aufgabe Y“ – eine Aufgabe je Notiz (wie „Als Aufgabe“ in 23)
      const vk = /^(?:verknüpfe|verknuepfe|verbinde) (?:die )?notiz (.+?) mit (?:der )?aufgabe (.+)$/.exec(t);
      if (vk && typeof notizen !== "undefined") {
        const nn = befehlNormalisieren(vk[1]), n = notizen.find((x) => befehlNormalisieren(x.titel) === nn) || notizen.find((x) => befehlNormalisieren(x.titel).startsWith(nn)), a = orgAufgabeFinden(vk[2]);
        if (!n || !a) { lokalAntworten(!n ? `Eine Notiz „${vk[1]}“ finde ich nicht. Es wurde nichts geändert.` : `Eine offene Aufgabe „${vk[2]}“ finde ich nicht. Es wurde nichts geändert.`); return "organisation"; }
        const alt = n.aufgabeId && n.aufgabeId !== a.id ? orgAufgaben().find((x) => x.id === n.aufgabeId) : null;
        bestaetigungAnfordern({ name: "tagesplan" }, { beschreibung: `Notiz „${n.titel}“ mit Aufgabe „${a.titel}“ verknüpfen?${alt ? ` (bisher verknüpft mit „${alt.titel}“)` : ""}`, ausfuehren: async () => {
          const r = tplanAendern(a.id, (x) => { x.notizId = n.id; });
          if (r && r.fehler) return r.fehler;
          n.aufgabeId = a.id; notizenSpeichern(); notizenAnzeigen();
          return `Notiz „${n.titel}“ und Aufgabe „${a.titel}“ sind verknüpft („Zur Aufgabe“ in der Notiz, „Zur Notiz“ in der Aufgabe).`;
        } });
        return "organisation";
      }
      // „Aufgabe Fenster putzen morgen“ – nur mit erkannter Zeitangabe und wenn kein anderer Befehl passt
      const nur = /^aufgabe (.{3,120})$/i.exec(roh.trim().replace(/^\s*(hey\s+)?jarvis[\s,]+/i, "").replace(/[.!]+$/, ""));
      if (nur && typeof zeitangabeErkennen === "function" && !SKILLS.some((s) => s.name !== "navigation" && s.passt(roh))) {
        const z = zeitangabeErkennen(nur[1]);
        if (z && z.datum && z.rest && !z.rueckfrage) {
          bestaetigungAnfordern({ name: "aufgabe-anlegen" }, { beschreibung: `Neue Aufgabe „${z.rest}“ für ${z.datum.toLocaleString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} anlegen?`, ausfuehren: async () => { const ok = window.aufgabenIntern && window.aufgabenIntern.hinzufuegen(z.rest.slice(0, 200), z.datum.toISOString(), "normal", "", true); return ok ? `Aufgabe „${z.rest}“ angelegt.` : "Aufgabe nicht angelegt."; } });
          return "organisation";
        }
      }
    }
    return original.apply(this, arguments);
  };
}
// Der Aktionsverlauf (33) liegt innen – was 71/72 vorab beantworteten, fehlte dort. Außen nachtragen, wenn innen nichts gemerkt wurde.
if (typeof skillAusfuehren === "function" && typeof aktionMerken === "function") {
  if (typeof AKTION_NAMEN !== "undefined") Object.assign(AKTION_NAMEN, { alltag: "Alltag", organisation: "Organisation" });
  const original = skillAusfuehren;
  skillAusfuehren = async function (text) {
    const t0 = performance.now(), vorher = AKTIONEN.liste[0];
    let r = null;
    try { r = await original.apply(this, arguments); return r; } finally { if (AKTIONEN.liste[0] === vorher) aktionMerken(text, r, performance.now() - t0); }
  };
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("organisation");
