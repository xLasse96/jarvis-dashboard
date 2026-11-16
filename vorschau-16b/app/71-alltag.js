// JARVIS Dashboard – Modul „alltag“ (ab 11-13d). Alltagsfragen aus lokalen Daten beantworten und Fehlleitungen korrigieren – gefunden
// mit 30 natürlichen Sätzen ohne KI-Verbindung (docs/AUFTRAG_13.md, Block 4). Lokal beantwortet wird nur, was in den eigenen Daten
// steht (keine erfundenen Angaben); unklare oder ändernde Absichten gehen über eine Rückfrage („Ja“/„Nein“), nie direkt.
//   - Fragen: Datum, nächster Termin, wie viele Aufgaben offen, gestern erledigt, Wochenrückschau, wer bist du, danke
//   - Umformungen: „Was muss ich heute noch machen?“, „Habe ich morgen Termine?“, „Welche Aufgaben sind überfällig?“,
//     „Zeig mir meine letzten Notizen“, „Kannst du mir helfen?“ / „Hilfe zu …“
//   - unklare Absicht „Ich muss noch …“ → Rückfrage, ob eine Aufgabe angelegt werden soll
//   - „Lösche die letzte Aufgabe“, „Mach das rückgängig“, „Nein, morgen“ → beziehen sich auf die zuletzt angelegte Aufgabe (≤ 10 min) und
//     laufen über die vorhandene Bestätigung bzw. eine Rückfrage
//   - Fehlleitungen: „Erinnere mich … an den Arzt“ ergab den Titel „den Arzt“; „Starte meine Morgenroutine“ ging an den Programmstarter;
//     „Wie viel Geld habe ich in der Simulation?“ / „Wie steht mein Depot?“ gingen an den Krypto-Paper-Skill des Workers
//   - Anlagefragen („Soll ich Tesla kaufen?“, „Lohnt sich Apple?“) bekommen lokal eine klare Absage ohne Empfehlung – auch mit Verbindung
// Kein Speicher, keine Anfrage.
const ALLTAG = { bezugMs: 10 * 60000, namen: /^(apple|tesla|microsoft|amazon|nvidia|google|alphabet|meta|netflix|coca-cola|cocacola|intel|amd|sap|siemens|allianz|bmw|mercedes|volkswagen|vw)$/ };
const AT_FRAGEN = [
  // „Wie spät ist es?“ bewusst nicht lokal: die Uhrzeit steht im Kopf des Dashboards, und vorhandene Tests nutzen den Satz als Beispiel einer KI-Frage
  [/^(welcher tag ist heute|welches datum (haben wir|ist heute)|der wievielte ist heute)$/, () => `Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`],
  [/^(wer bist du|was bist du)$/, () => "Ich bin JARVIS, dein persönlicher Assistent in diesem Browser. Aufgaben, Notizen, Projekte, Gedächtnis und Simulation bleiben auf diesem Gerät; an eine KI geht nur, was du ausdrücklich fragst. „Was kannst du?“ zeigt alles."],
  [/^(danke|danke schön|dankeschön|vielen dank|super danke)$/, () => "Gern geschehen."],
  [/^(was ist mein nächster termin|wann ist mein nächster termin|was kommt als nächstes)$/, () => {
    const n = atAufgaben().filter((a) => !a.erledigt && a.faellig && Date.parse(a.faellig) >= Date.now()).sort((a, b) => a.faellig.localeCompare(b.faellig))[0];
    return n ? `Als Nächstes: „${n.titel}“ am ${new Date(n.faellig).toLocaleString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.` : "In deinen Aufgaben steht kein kommender Termin.";
  }],
  [/^(wie viele aufgaben (habe ich|sind) (noch )?(offen|übrig)|wie viele offene aufgaben habe ich)$/, () => {
    const o = atAufgaben().filter((a) => !a.erledigt), u = o.filter((a) => a.faellig && Date.parse(a.faellig) < Date.now()).length, h = o.filter((a) => a.faellig && new Date(a.faellig).toDateString() === new Date().toDateString()).length;
    return `${o.length} offene Aufgabe(n), davon ${h} heute fällig und ${u} überfällig.`;
  }],
  [/^(was habe ich gestern (erledigt|geschafft|gemacht))$/, () => {
    const g = new Date(); g.setDate(g.getDate() - 1); const l = atAufgaben().filter((a) => a.erledigt && a.erledigtAm && new Date(a.erledigtAm).toDateString() === g.toDateString());
    return l.length ? `Gestern erledigt: ${l.map((a) => a.titel).join(", ")}.` : "Für gestern ist keine erledigte Aufgabe gespeichert.";
  }],
  [/^(wie war (die|meine) woche|wochenrückschau|wochenrueckschau|was habe ich diese woche (erledigt|geschafft))$/, () => {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const alle = atAufgaben(), erl = alle.filter((a) => a.erledigt && a.erledigtAm && Date.parse(a.erledigtAm) >= start.getTime()), offen = alle.filter((a) => !a.erledigt), ueber = offen.filter((a) => a.faellig && Date.parse(a.faellig) < Date.now());
    return `Wochenrückschau seit Montag: ${erl.length} erledigt${erl.length ? " (" + erl.slice(0, 6).map((a) => a.titel).join(", ") + (erl.length > 6 ? " …" : "") + ")" : ""}, ${offen.length} offen, davon ${ueber.length} überfällig.`;
  }],
];
const atAufgaben = () => (window.aufgabenIntern ? window.aufgabenIntern.liste() : []);
const AT_ANLAGE = /^(soll|sollte) ich (die )?(aktie |aktien )?(von )?(\S+)( aktie| aktien)? (kaufen|verkaufen|halten|nachkaufen)$|^(lohnt sich|lohnt es sich,?) (die aktie |eine investition in |ein kauf von )?(\S+)$/;
function atAnlage(t, roh = "") {
  const m = AT_ANLAGE.exec(t); if (!m) return null;
  const w = (m[5] || m[10] || "").replace(/[^a-zäöüß0-9.-]/g, ""), gross = new RegExp("\\b" + w.toUpperCase().replace(/[.]/g, "\\.") + "\\b").test(roh);
  const ticker = /^[a-z]{1,5}$/.test(w) && gross ? w.toUpperCase() : "";
  // nur mit erkennbarem Aktienbezug – „Soll ich Milch kaufen?“ oder „Lohnt sich joggen?“ bleiben unberührt
  const bezug = ALLTAG.namen.test(w) || ticker || /aktie/.test(t) || (window.wlLaden && (wlLaden().eintraege || []).some((e) => e.symbol.toLowerCase() === w));
  if (!bezug) return null;
  return `Kauf- oder Verkaufsempfehlungen gebe ich nicht – auch keine Prognose. Ich kann dir aber Daten einordnen: „Analysiere <Börsensymbol>“${ticker ? ` (z. B. „Analysiere ${ticker}“, falls ${ticker} gemeint ist)` : ""} zeigt Quelle, Stichtag, Kennzahlen, Chancen/Risiken und die Aussagekraft. Entscheidungen triffst du selbst.`;
}
// zuletzt angelegte, noch offene Aufgabe (≤ 10 min) – Bezug für „letzte“, „rückgängig“, „Nein, morgen“
function atLetzteAufgabe(jetzt = Date.now()) {
  return atAufgaben().filter((a) => !a.erledigt && a.erstellt && jetzt - Date.parse(a.erstellt) <= ALLTAG.bezugMs).sort((a, b) => String(b.erstellt).localeCompare(String(a.erstellt)))[0] || null;
}
skillRegistrieren({
  name: "alltag", risiko: "abfrage", hilfeKurz: "Alltag",
  beschreibung: "Alltagsfragen aus deinen Daten (Uhrzeit, nächster Termin, offene Aufgaben, Wochenrückschau …)", beispiele: ["Was ist mein nächster Termin?", "Wie war die Woche?"],
  passt: (text) => AT_FRAGEN.some(([re]) => re.test(befehlNormalisieren(text))),
  aktion: async (text) => { const t = befehlNormalisieren(text); lokalAntworten(AT_FRAGEN.find(([re]) => re.test(t))[1]()); return true; },
});
(function atEinordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();
if (typeof SPRACH_REGELN !== "undefined") SPRACH_REGELN.push(
  [/^was (muss|soll) ich heute (noch )?(machen|erledigen|tun)$/, "was steht heute an"],
  [/^(habe|hab) ich morgen (termine|was vor|etwas vor|was)$/, "was steht morgen an"],
  [/^welche aufgaben sind (überfällig|ueberfaellig)$/, "was ist überfällig"],
  [/^zeige? (mir )?(meine )?(letzten |neuesten )?notizen$/, "zeige meine notizen"],
  [/^(kannst du mir helfen|hilf mir|hilfe zu .+)$/, "was kannst du"],
  // ab 11-13e: gesprochene Varianten (Erkundung mit 26 Sätzen, docs/AUFTRAG_13.md Block 5)
  [/^(gib|zeig|zeige|sag|nenn) (mir )?(den |einen )?statusbericht (für|zum|von|zu) (dem )?(projekt )?(.+)$/, "statusbericht projekt $7"],
  [/^wie weit ist (das )?projekt (.+)$/, "wie steht projekt $2"],
  [/^(die )?aufgabe (.+?) (hängt|haengt) von (.+?) ab$/, "aufgabe $2 wartet auf $4"],
  [/^was blockiert (mich|uns)( gerade| noch)?$/, "was ist blockiert"],
  [/^was (habe|hab) ich (mir|dir) gemerkt$|^was hast du dir gemerkt$/, "was weißt du über mich"],
  [/^(welche|was für) workflows (habe|hab) ich$|^meine workflows$/, "zeige meine workflows"],
  [/^(hör|hoer) auf$|^hör auf (zu reden|zu sprechen)$/, "stopp"],
);
// vor dem Dispatcher: Fehlleitungen, Anlagefragen, Bezüge – nie am Sperr-Skill vorbei und nicht bei offener Rückfrage
if (typeof skillAusfuehren === "function") {
  const original = skillAusfuehren;
  skillAusfuehren = async function (text) {
    const roh = String(text || ""), t = befehlNormalisieren(roh), sperre = SKILLS.find((s) => s.name === "gesperrt");
    const frei = !(typeof offeneAktion !== "undefined" && offeneAktion) && !(typeof slDialogPasst === "function" && slDialogPasst(roh)) && !(sperre && sperre.passt(roh));
    if (frei) {
      const anlage = atAnlage(t, roh);
      if (anlage) { lokalAntworten(anlage); return "alltag"; }
      // „Wie viel Geld habe ich in der Simulation?“ / „Wie steht mein Depot?“ → Simulationsbericht (vorher Krypto-Paper-Skill)
      if (/^(wie viel geld habe ich in der simulation|wie steht mein depot|wie steht mein portfolio|mein depot)$/.test(t)) { const s = SKILLS.find((x) => x.name === "simulation-bericht"); if (s) { if (/depot/.test(t)) lokalAntworten("Ein echtes Depot ist nicht verbunden – hier die Paper-Simulation:"); await s.aktion(roh); return s.name; } }
      // ab 11-13e: „Starte den Workflow …“ ging ebenfalls an den Programmstarter – Workflows sind Routinen
      const wf = /^(starte|start|führe|fuehre) (den |die )?workflow (.+?)( aus)?$/.exec(t);
      if (wf && typeof routinen !== "undefined") { const r = routinen.find((x) => befehlNormalisieren(x.name) === wf[3] || befehlNormalisieren(x.name).startsWith(wf[3])); if (r) return original.call(this, "Starte Routine " + r.name); lokalAntworten(`Einen Workflow „${wf[3]}“ finde ich nicht.` + (routinen.length ? " Vorhanden: " + routinen.map((x) => x.name).join(", ") + "." : "") + " Es wurde nichts gestartet."); return "alltag"; }
      // Projektnotiz per Satz: „Schreib eine Notiz zum Projekt Umzug Kartons zählen“ (vorher allgemeine Notiz „zum Projekt Umzug …“)
      const pn = /^(?:schreib|schreibe|mach|mache|neue|leg|lege)(?: mir)?(?: eine| ne)?(?: neue)? notiz (?:zum|zu|für|fuer) (?:dem )?projekt (.+)$/i.exec(roh.trim().replace(/[.!]+$/, ""));
      if (pn && typeof projekteLesen === "function") {
        const rest = pn[1], p = projekteLesen().projekte.slice().sort((x, y) => y.name.length - x.name.length).find((x) => rest.toLowerCase().startsWith(x.name.toLowerCase() + " ") || rest.toLowerCase().startsWith(x.name.toLowerCase() + ":"));
        if (p) return original.call(this, `Notiz zu Projekt ${p.name}: ${rest.slice(p.name.length).replace(/^[\s:,-]+/, "")}`);
      }
      // „Lies meine letzte Notiz vor“
      if (/^(lies|lese) (mir )?(meine |die )?letzte notiz( vor)?$/.test(t) && typeof notizenSuchen === "function") { const n = notizenSuchen("", "", "").slice().sort((x, y) => String(y.geaendert || y.erstellt).localeCompare(String(x.geaendert || x.erstellt)))[0]; lokalAntworten(n ? `Letzte Notiz „${n.titel}“: ${n.text || "(ohne Text)"}` : "Es gibt noch keine Notiz."); return "alltag"; }
      // Portfolio/Positionen der US-Aktien-Simulation
      if (/^(wie läuft|wie steht) mein portfolio$|^zeige? (mir )?meine positionen$/.test(t)) { const s = SKILLS.find((x) => x.name === "simulation-bericht"); if (s) { await s.aktion(roh); return s.name; } }
      // persönliche Automatisierungen: Stopp sofort (sichere Richtung), Wiederaufnahme nur mit Rückfrage
      if (/^(stoppe|stopp|halte|pausiere) (alle |die )?(automatisierungen|regeln)( an)?$/.test(t) && typeof autoStoppSetzen === "function") { autoStoppSetzen(true); lokalAntworten("Alle persönlichen Automatisierungen sind gestoppt (globaler Stopp). Not-Aus und Handel sind davon nicht betroffen. Wieder einschalten: „Automatisierungen wieder einschalten“."); return "alltag"; }
      if (/^(automatisierungen|regeln) wieder (einschalten|starten|aktivieren)$|^(schalte|starte) (die )?automatisierungen wieder (ein|an)$/.test(t) && typeof autoStoppSetzen === "function" && typeof bestaetigungAnfordern === "function") { bestaetigungAnfordern({ name: "automatik" }, { beschreibung: "Den globalen Stopp der persönlichen Automatisierungen aufheben? Regeln laufen danach wieder in ihrem Modus (Simulation, Freigabe oder automatisch).", ausfuehren: async () => { autoStoppSetzen(false); return "Automatisierungen laufen wieder."; } }); return "alltag"; }
      // „Starte meine Morgenroutine“ → Routine, wenn es eine passende gibt (vorher Programmstarter)
      const st = /^(starte|start|beginne) (meine |die |mein )?(.+?)( routine)?$/.exec(t);
      if (st && !/^routine /.test(st[3]) && typeof routinen !== "undefined") {
        const ziel = st[3].replace(/routine$/, "").trim(), r = routinen.find((x) => befehlNormalisieren(x.name) === st[3] || befehlNormalisieren(x.name).replace(/\s*[\d.]+$/, "") === st[3] || (ziel.length >= 4 && befehlNormalisieren(x.name).startsWith(ziel)));
        if (r) return original.call(this, "Starte Routine " + r.name);
        if (/routine$/.test(st[3])) { lokalAntworten(`Eine Routine „${st[3]}“ finde ich nicht.` + (routinen.length ? " Vorhanden: " + routinen.map((x) => x.name).join(", ") + "." : "") + " Es wurde nichts gestartet."); return "alltag"; }
      }
      // „Erinnere mich morgen um 9 an den Arzt“ → Titel „Arzt“ (vorher „den Arzt“)
      const er = /^\s*(?:(?:hey\s+)?jarvis[\s,]+)?erinnere mich\s+(?:daran,?\s+)?(.+)$/i.exec(roh);
      if (er) { const rest = er[1].replace(/^an\s+/i, "").replace(/\s+an\s+(den|die|das|der|dem|meinen|meine|mein)\s+/i, " ").replace(/^(den|die|das|der|dem)\s+/i, ""); return original.call(this, "Neue Aufgabe " + rest); }
      // unklare Absicht: „Ich muss noch Milch kaufen“ → Rückfrage
      const muss = /^(?:ich muss (?:noch |unbedingt |heute |morgen )?|ich sollte (?:noch )?|nicht vergessen:?\s*)(.{3,80})$/i.exec(roh.trim().replace(/[.!]+$/, ""));
      if (muss && typeof bestaetigungAnfordern === "function") {
        const titel = muss[1].trim();
        bestaetigungAnfordern({ name: "aufgabe-anlegen" }, { beschreibung: `Soll ich daraus eine Aufgabe machen: „${titel}“?`, ausfuehren: async () => { const ok = window.aufgabenIntern && window.aufgabenIntern.hinzufuegen(titel.slice(0, 200), "", "normal", "", true); return ok ? `Aufgabe „${titel}“ angelegt.` : "Aufgabe nicht angelegt."; } });
        return "alltag";
      }
      // Bezüge auf die zuletzt angelegte Aufgabe
      if (/^(lösche|loesche|entferne) (die )?(letzte|eben angelegte|gerade angelegte) aufgabe$/.test(t) || /^(mach|mache) (das|es) rückgängig$|^rückgängig( machen)?$/.test(t)) {
        const a = atLetzteAufgabe();
        if (!a) { lokalAntworten("Ich finde keine in den letzten 10 Minuten angelegte Aufgabe, auf die sich das bezieht. Es wurde nichts geändert. Rückgängig geht gezielt, z. B. „Lösche Aufgabe …“."); return "alltag"; }
        return original.call(this, "Lösche Aufgabe " + a.titel);
      }
      const korr = /^nein,?\s+(morgen|übermorgen|heute|am .+|um .+|nächste woche|in .+)$/.exec(t);
      if (korr && typeof bestaetigungAnfordern === "function") {
        const a = atLetzteAufgabe();
        if (!a) { lokalAntworten("Worauf bezieht sich das? Sag z. B. „Verschiebe Aufgabe … auf morgen“. Es wurde nichts geändert."); return "alltag"; }
        const z = typeof zeitangabeErkennen === "function" ? zeitangabeErkennen(korr[1]) : null;
        if (!z || !z.datum) { lokalAntworten(`„${korr[1]}“ verstehe ich nicht als Zeitpunkt. Es wurde nichts geändert.`); return "alltag"; }
        bestaetigungAnfordern({ name: "tagesplan" }, { beschreibung: `Aufgabe „${a.titel}“ auf ${z.datum.toLocaleString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} verschieben?`, ausfuehren: async () => { const r = tplanVerschieben(a.id, z.datum); return r && r.fehler ? r.fehler : `„${a.titel}“ verschoben.`; } });
        return "alltag";
      }
    }
    return original.apply(this, arguments);
  };
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("alltag");
