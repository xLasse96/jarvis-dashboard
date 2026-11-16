// JARVIS Dashboard – Modul „auftraege“ (ab 11-09a). Zentrale Auftragsverarbeitung für mehrteilige Anfragen.
// „Neue Aufgabe Steuer morgen um 9 und dann gehe zu Notizen“ wird zu einem Auftrag mit nummerierten Schritten. Jeder Schritt ist
// genau ein vorhandener lokaler Skill (Dispatcher app/03-trading-skills.js) – es entstehen keine neuen Fähigkeiten.
// Regeln:
//   - Zerlegt wird nur, wenn JEDER Teil zu einem lokalen Skill passt („Milch und Brot kaufen“ bleibt ein Text).
//   - Lesen (Freigabe „abfrage“) läuft ohne Rückfrage; Schreiben („leicht“) erst nach Freigabe des ganzen Plans.
//     Bestätigungspflichtige (Löschen, Paper-Orders) und gesperrte Skills laufen NIE innerhalb eines Auftrags – Schritt „blockiert“.
//   - Abhängigkeit: Nach „dann/danach/anschließend“ hängt ein Schritt vom vorherigen ab und wird bei dessen Fehler übersprungen.
//   - Widersprüche (dieselbe Aufgabe anlegen und löschen, doppelte Schritte) und Unverstandenes werden vor der Freigabe gemeldet.
//   - Höchstens 8 Schritte je Auftrag, höchstens 5 Aufträge in der Warteschlange; ein Schritt startet nie selbst einen Auftrag.
//   - Gleicher Auftrag erneut, solange er offen ist oder vor weniger als 10 s endete → abgelehnt (keine Doppelausführung).
//   - Pause, Abbruch, Fortsetzen; nach dem Neuladen gilt ein laufender Schritt als unterbrochen und wird nicht wiederholt.
// Speicher: localStorage „jarvis-auftraege“ { art, version, liste, protokoll } – beschädigt → gemeldet, nie überschrieben.
const AUFTRAG = { schluessel: "jarvis-auftraege", maxSchritte: 8, maxWarteschlange: 5, maxProtokoll: 100, maxListe: 20, sperrMs: 10000, zeitlimitMs: 20000, nummer: 0 };
const AUFTRAG_TRENNER = /\s*(?:;|,?\s+und dann\s+|,?\s+danach\s+|,?\s+anschließend\s+|,?\s+anschliessend\s+|,\s*dann\s+|\s+und\s+)\s*/i;
const AUFTRAG_FOLGE = /^(?:;|,?\s+und dann|,?\s+danach|,?\s+anschließend|,?\s+anschliessend|,\s*dann)/i;
let auftragStand = { art: "jarvis-auftraege", version: 1, liste: [], protokoll: [] };
let auftragLaeuft = false;

function auftraegeLesen() {
  const d = speicherJsonLesen(AUFTRAG.schluessel, (x) => istObjekt(x) && x.art === "jarvis-auftraege" && Array.isArray(x.liste) && Array.isArray(x.protokoll));
  auftragStand = d ? { art: "jarvis-auftraege", version: 1, liste: d.liste.filter((a) => a && typeof a.id === "string" && Array.isArray(a.schritte)), protokoll: d.protokoll.slice(-AUFTRAG.maxProtokoll) } : { art: "jarvis-auftraege", version: 1, liste: [], protokoll: [] };
  return auftragStand;
}
function auftraegeSpeichern() {
  if (speicherBeschaedigt(AUFTRAG.schluessel)) return false;
  auftragStand.liste = auftragStand.liste.slice(-AUFTRAG.maxListe);
  auftragStand.protokoll = auftragStand.protokoll.slice(-AUFTRAG.maxProtokoll);
  try { localStorage.setItem(AUFTRAG.schluessel, JSON.stringify(auftragStand)); return true; } catch (e) { return false; }
}
function auftragProtokoll(a, text) { auftragStand.protokoll.push({ zeit: new Date().toISOString(), auftrag: a.id, text: String(text).slice(0, 200) }); }
const auftragNormal = (t) => (typeof befehlNormalisieren === "function" ? befehlNormalisieren(t) : String(t).toLowerCase().trim());

// Teile mit Trennerart: [{ text, folgt }] – folgt = hängt vom vorherigen Teil ab („dann …“)
function auftragTeile(text) {
  const s = String(text || "").trim().replace(/[.!]+$/, "");
  const teile = [];
  let rest = s, folgt = false;
  while (rest) {
    const m = AUFTRAG_TRENNER.exec(rest);
    if (!m) { teile.push({ text: rest.trim(), folgt }); break; }
    if (m.index > 0) teile.push({ text: rest.slice(0, m.index).trim(), folgt });
    folgt = AUFTRAG_FOLGE.test(m[0]) || /dann|danach|anschlie/i.test(m[0]);
    rest = rest.slice(m.index + m[0].length);
  }
  return teile.filter((t) => t.text);
}
// Einstufung eines Teils über den vorhandenen Dispatcher: { skill, art: lesen|schreiben|blockiert|unbekannt, grund }
function auftragSchrittEinstufen(text) {
  const skill = SKILLS.find((s) => s.passt(text));
  if (!skill) return { skill: null, art: "unbekannt", grund: "kein lokaler Befehl erkannt" };
  const risiko = skillRisiko(skill);
  if (risiko === "gesperrt" || skill.risiko === "gesperrt") return { skill: skill.name, art: "blockiert", grund: "gesperrt – nie per Auftrag" };
  if (risiko === "bestaetigen" || skill.eigeneBestaetigung) return { skill: skill.name, art: "blockiert", grund: "braucht eine Einzelbestätigung – bitte einzeln sagen" };
  if (skill.name === "routine" || skill.name === "recherche") return { skill: skill.name, art: "blockiert", grund: "in Aufträgen nicht erlaubt (Routinen und Recherchen nur einzeln)" };
  return { skill: skill.name, art: risiko === "abfrage" ? "lesen" : "schreiben", grund: "" };
}
// ab 11-09c: Planungsmodus „Plane: …“ – auch einteilig, nie automatische Ausführung (auch nicht für reine Leseschritte)
const AUFTRAG_PLAN = /^\s*(?:plane|plan|nur planen)\s*[:,]?\s+/i;
// Erkennt einen mehrteiligen Auftrag; null = normaler Einzelbefehl. min: Mindestzahl der Teile (Planungsmodus: 1)
function auftragErkennen(text, min = 2) {
  const teile = auftragTeile(text);
  if (teile.length < min) return null;
  const schritte = teile.map((t, i) => ({ nr: i + 1, text: t.text, abhaengig: i > 0 && t.folgt, ...auftragSchrittEinstufen(t.text), status: "offen", ergebnis: "" }));
  // nur zerlegen, wenn jeder Teil ein lokaler Befehl ist – sonst ist „und“ Teil eines normalen Satzes
  if (schritte.some((s) => s.art === "unbekannt")) return null;
  return schritte;
}
// Widersprüche: gleiche Schritte doppelt; dieselbe Aufgabe anlegen und löschen
function auftragWidersprueche(schritte) {
  const w = [], gesehen = new Map();
  for (const s of schritte) {
    const n = auftragNormal(s.text);
    if (gesehen.has(n)) w.push(`Schritt ${s.nr} wiederholt Schritt ${gesehen.get(n)}`);
    else gesehen.set(n, s.nr);
  }
  const titel = (s) => auftragNormal(s.text).replace(/^(neue aufgabe|aufgabe anlegen|notiere( dir)?|erinnere mich( daran)?( an)?|lösche|loesche|entferne)( die)?( aufgabe)?\s*/, "").trim();
  for (const a of schritte.filter((s) => s.skill === "aufgabe-anlegen")) for (const b of schritte.filter((s) => s.skill === "aufgabe-loeschen")) if (titel(a) && titel(a) === titel(b)) w.push(`Schritt ${a.nr} legt „${titel(a)}“ an, Schritt ${b.nr} löscht sie wieder`);
  return w;
}
function auftragAnlegen(eingabe, jetzt = Date.now(), optionen = {}) {
  auftraegeLesen();
  if (speicherBeschaedigt(AUFTRAG.schluessel)) return { fehler: "Auftragsspeicher beschädigt – " + SPEICHER_SCHADEN_TEXT };
  const planModus = optionen.plan || AUFTRAG_PLAN.test(eingabe);
  const text = String(eingabe).replace(AUFTRAG_PLAN, "");
  const schritte = auftragErkennen(text, planModus ? 1 : 2);
  if (!schritte) return { fehler: "kein mehrteiliger Auftrag" };
  if (schritte.length > AUFTRAG.maxSchritte) return { fehler: `Höchstens ${AUFTRAG.maxSchritte} Schritte je Auftrag – bitte aufteilen.` };
  const norm = auftragNormal(text);
  const doppelt = auftragStand.liste.find((a) => a.norm === norm && (!["fertig", "abgebrochen", "fehler"].includes(a.status) || jetzt - Date.parse(a.geaendert) < AUFTRAG.sperrMs));
  if (doppelt) return { fehler: `Derselbe Auftrag ist schon ${["fertig", "abgebrochen", "fehler"].includes(doppelt.status) ? "gerade ausgeführt" : "in Arbeit"} (${doppelt.id}) – nicht doppelt ausgeführt.` };
  const offen = auftragStand.liste.filter((a) => ["wartet", "laeuft", "pausiert", "warteschlange"].includes(a.status));
  if (offen.length >= AUFTRAG.maxWarteschlange) return { fehler: `Höchstens ${AUFTRAG.maxWarteschlange} offene Aufträge – erst abschließen oder abbrechen.` };
  const widersprueche = auftragWidersprueche(schritte);
  const schreibt = schritte.some((s) => s.art === "schreiben");
  const prio = /^\s*(dringend|sofort|zuerst)\b/i.test(text) ? "hoch" : "normal";
  const a = { id: "A" + new Date(jetzt).toISOString().slice(2, 19).replace(/[-:T]/g, "") + "-" + (++AUFTRAG.nummer), text: String(text).slice(0, 300), norm, erstellt: new Date(jetzt).toISOString(), geaendert: new Date(jetzt).toISOString(), prio,
    schritte, widersprueche, schreibt, modus: planModus ? "plan" : "ausfuehren", herkunft: optionen.herkunft || "eingabe",
    status: widersprueche.length ? "wartet" : offen.length ? "warteschlange" : schreibt || planModus ? "wartet" : "bereit" };
  if (prio === "hoch") auftragStand.liste.splice(auftragStand.liste.findIndex((x) => ["warteschlange"].includes(x.status)) === -1 ? auftragStand.liste.length : auftragStand.liste.findIndex((x) => x.status === "warteschlange"), 0, a);
  else auftragStand.liste.push(a);
  auftragProtokoll(a, `angelegt: ${schritte.length} Schritte (${schritte.filter((s) => s.art === "lesen").length} lesen, ${schritte.filter((s) => s.art === "schreiben").length} schreiben, ${schritte.filter((s) => s.art === "blockiert").length} blockiert)` + (widersprueche.length ? " · Widerspruch: " + widersprueche.join("; ") : ""));
  auftraegeSpeichern();
  return { auftrag: a };
}
function auftragFinden(id) { return auftragStand.liste.find((a) => a.id === id) || null; }
function auftragSetzen(a, status, text) { a.status = status; a.geaendert = new Date().toISOString(); if (text) auftragProtokoll(a, text); auftraegeSpeichern(); auftraegeAnzeigen(); }
// Führt die offenen Schritte aus (nach Freigabe bzw. sofort bei reinen Leseaufträgen)
async function auftragAusfuehren(id) {
  auftraegeLesen();
  const a = auftragFinden(id);
  if (!a || auftragLaeuft || !["bereit", "freigegeben", "pausiert"].includes(a.status)) return false;
  if (a.widersprueche.length) { auftragSetzen(a, "wartet", "nicht ausgeführt: Widerspruch muss erst aufgelöst werden"); return false; }
  auftragLaeuft = true;
  auftragSetzen(a, "laeuft", "Ausführung gestartet");
  // Ein Schritt (inkl. Vorprüfung); true = ausgeführt oder entschieden
  const schrittVorpruefen = (s) => {
    const vorher = a.schritte[s.nr - 2];
    if (s.abhaengig && vorher && vorher.status !== "erledigt") { s.status = "uebersprungen"; s.ergebnis = "vorheriger Schritt nicht erledigt"; return false; }
    if (s.art === "blockiert") { s.status = "blockiert"; s.ergebnis = s.grund; return false; }
    const neu = auftragSchrittEinstufen(s.text); // Freigaben können sich inzwischen geändert haben
    if (neu.art === "blockiert" || neu.art === "unbekannt" || neu.skill !== s.skill) { s.status = "blockiert"; s.ergebnis = neu.grund || "Befehl nicht mehr eindeutig"; return false; }
    return true;
  };
  try {
    for (let i = 0; i < a.schritte.length; i++) {
      const s = a.schritte[i];
      if (s.status !== "offen") continue;
      const aktuell = auftragFinden(id);
      if (!aktuell || aktuell.status !== "laeuft") return false; // pausiert oder abgebrochen
      // ab 11-09c: unabhängige Leseschritte hintereinander laufen gemeinsam (parallel); Schreibschritte immer einzeln
      if (s.art === "lesen" && typeof werkzeugAufrufen === "function") {
        const gruppe = [s];
        for (let j = i + 1; j < a.schritte.length && a.schritte[j].status === "offen" && a.schritte[j].art === "lesen" && !a.schritte[j].abhaengig; j++) gruppe.push(a.schritte[j]);
        if (gruppe.length > 1) {
          const bereit = gruppe.filter(schrittVorpruefen);
          bereit.forEach((x) => { x.status = "laeuft"; });
          auftraegeSpeichern(); auftraegeAnzeigen();
          const erg = await Promise.all(bereit.map((x) => werkzeugAufrufen(x.skill, x.text, { quelle: "Auftrag " + a.id + " (parallel)", zeitlimitMs: AUFTRAG.zeitlimitMs, gruppe: a.id + "@" + i })));
          bereit.forEach((x, k) => { const r = erg[k]; x.status = r.ok ? "erledigt" : ["GESPERRT", "BESTAETIGUNG", "NICHT_VERFUEGBAR"].includes(r.code) ? "blockiert" : "fehler"; x.ergebnis = r.ok ? "erledigt (parallel gelesen)" : `${r.code}: ${r.text}`; auftragProtokoll(a, `Schritt ${x.nr} (${x.skill}, parallel): ${x.status}`); });
          auftraegeSpeichern(); auftraegeAnzeigen();
          i += gruppe.length - 1;
          continue;
        }
      }
      if (!schrittVorpruefen(s)) continue;
      s.status = "laeuft"; auftraegeSpeichern(); auftraegeAnzeigen();
      // ab 11-09b: über die einheitliche Werkzeugschicht (Codes, Zeitlimit, Wiederholungs- und Rekursionsschutz)
      if (typeof werkzeugAufrufen === "function") {
        const r = await werkzeugAufrufen(s.skill, s.text, { quelle: "Auftrag " + a.id, zeitlimitMs: AUFTRAG.zeitlimitMs });
        s.status = r.ok ? "erledigt" : ["GESPERRT", "BESTAETIGUNG", "NICHT_VERFUEGBAR"].includes(r.code) ? "blockiert" : "fehler";
        s.ergebnis = r.ok ? "erledigt" : `${r.code}: ${r.text}`;
      } else {
        const skill = SKILLS.find((x) => x.name === s.skill);
        try {
          const ok = await Promise.race([Promise.resolve(skill.aktion(s.text)), new Promise((_, nein) => setTimeout(() => nein(new Error("Zeitüberschreitung nach " + AUFTRAG.zeitlimitMs / 1000 + " s")), AUFTRAG.zeitlimitMs))]);
          s.status = ok === false ? "fehler" : "erledigt"; s.ergebnis = ok === false ? "Befehl nicht ausgeführt" : "erledigt";
        } catch (e) { s.status = "fehler"; s.ergebnis = String(e.message || e).slice(0, 120); }
      }
      auftragProtokoll(a, `Schritt ${s.nr} (${s.skill}): ${s.status}${s.ergebnis && s.status !== "erledigt" ? " – " + s.ergebnis : ""}`);
      auftraegeSpeichern(); auftraegeAnzeigen();
    }
    // ab 11-12g: wurde der Auftrag während des letzten Schritts abgebrochen oder pausiert, nicht als „fertig“ überschreiben
    // (vorher: abgebrochener Auftrag mit nie ausgeführtem Schritt stand danach als „fertig – alle Schritte erledigt“ da)
    const zuletzt = auftragFinden(id);
    if (!zuletzt || zuletzt.status !== "laeuft") return false;
    const fehler = a.schritte.filter((s) => ["fehler", "blockiert", "uebersprungen"].includes(s.status)).length;
    auftragSetzen(a, fehler ? "fehler" : "fertig", fehler ? `beendet mit ${fehler} nicht erledigten Schritt(en)` : "alle Schritte erledigt");
    if (typeof lokalAntworten === "function") lokalAntworten(`Auftrag ${a.id}: ${a.schritte.filter((s) => s.status === "erledigt").length} von ${a.schritte.length} Schritten erledigt` + (fehler ? `, ${fehler} nicht (siehe Auftragsliste).` : "."));
    return true;
  } finally {
    auftragLaeuft = false;
    auftragNaechster();
  }
}
// Nächster Auftrag aus der Warteschlange (Lesen läuft sofort, Schreiben wartet auf Freigabe)
function auftragNaechster() {
  if (auftragLaeuft || auftragStand.liste.some((a) => ["laeuft", "wartet", "freigegeben", "pausiert"].includes(a.status))) return null;
  const n = auftragStand.liste.find((a) => a.status === "warteschlange");
  if (!n) return null;
  auftragSetzen(n, n.schreibt || n.widersprueche.length ? "wartet" : "bereit", "aus der Warteschlange übernommen");
  if (n.status === "bereit") auftragAusfuehren(n.id);
  return n;
}
// ab 11-09c: veralteter Plan (älter als 30 min oder Einstufung eines offenen Schritts inzwischen anders) → erst „Plan aktualisieren“
AUFTRAG.veraltetMs = 30 * 60000;
function auftragVeraltet(a, jetzt = Date.now()) {
  if (jetzt - Date.parse(a.geprueft || a.erstellt) > AUFTRAG.veraltetMs) return "Plan älter als 30 Minuten";
  const geaendert = a.schritte.filter((s) => s.status === "offen").find((s) => { const n = auftragSchrittEinstufen(s.text); return n.skill !== s.skill || n.art !== s.art; });
  return geaendert ? `Schritt ${geaendert.nr} wird inzwischen anders eingestuft` : null;
}
function auftragFreigeben(id, jetzt = Date.now()) {
  const a = auftragFinden(id);
  if (!a || a.status !== "wartet" || a.widersprueche.length) return false;
  const v = auftragVeraltet(a, jetzt);
  if (v) { a.veraltet = v; auftragSetzen(a, "wartet", `nicht freigegeben: ${v} – bitte „Plan aktualisieren“`); return false; }
  auftragSetzen(a, "freigegeben", "vom Nutzer freigegeben"); auftragAusfuehren(id); return true;
}
// Plan neu prüfen: offene Schritte neu einstufen, Widersprüche neu bestimmen; danach erneut freigeben
function auftragAktualisieren(id) {
  const a = auftragFinden(id);
  if (!a || !["wartet", "unterbrochen", "pausiert"].includes(a.status)) return false;
  for (const s of a.schritte) if (s.status === "offen") Object.assign(s, auftragSchrittEinstufen(s.text));
  a.widersprueche = auftragWidersprueche(a.schritte); a.schreibt = a.schritte.some((s) => s.art === "schreiben");
  a.geprueft = new Date().toISOString(); delete a.veraltet;
  auftragSetzen(a, "wartet", "Plan aktualisiert" + (a.widersprueche.length ? " – Widerspruch: " + a.widersprueche.join("; ") : ""));
  return true;
}
// Nur sichere (lesende) Schritte mit Fehler erneut versuchen; Schreibschritte nie automatisch wiederholen
function auftragLesenWiederholen(id) {
  const a = auftragFinden(id);
  if (!a || a.status !== "fehler") return false;
  const wieder = a.schritte.filter((s) => s.art === "lesen" && s.status === "fehler");
  if (!wieder.length) return false;
  for (const s of wieder) { s.status = "offen"; s.ergebnis = ""; }
  for (const s of a.schritte) if (s.status === "uebersprungen" && s.art === "lesen") { s.status = "offen"; s.ergebnis = ""; }
  auftragSetzen(a, "pausiert", `${wieder.length} Leseschritt(e) werden wiederholt`);
  auftragAusfuehren(id);
  return true;
}
// Export nur der Schritttexte; Import stuft alles neu ein, ist immer ein Plan (nie automatische Ausführung)
function auftragExport(id) {
  const a = auftragFinden(id);
  return a ? JSON.stringify({ art: "jarvis-auftrag", version: 1, exportiert: new Date().toISOString(), text: a.text, schritte: a.schritte.map((s) => ({ text: s.text, abhaengig: s.abhaengig })) }, null, 1) : null;
}
function auftragImport(text) {
  let d;
  try { d = JSON.parse(String(text || "")); } catch (e) { return { fehler: "Datei ist kein gültiges JSON." }; }
  if (!istObjekt(d) || d.art !== "jarvis-auftrag" || d.version !== 1 || !Array.isArray(d.schritte)) return { fehler: "Kein JARVIS-Auftrag (Version 1)." };
  if (!d.schritte.length || d.schritte.length > AUFTRAG.maxSchritte) return { fehler: `1 bis ${AUFTRAG.maxSchritte} Schritte erwartet.` };
  if (d.schritte.some((s) => !istObjekt(s) || typeof s.text !== "string" || !s.text.trim() || s.text.length > 300 || /[;\n]/.test(s.text))) return { fehler: "Schritt ungültig (Text 1–300 Zeichen, ohne Zeilenumbruch und Semikolon)." };
  // Zusammensetzen über die üblichen Trenner – Einstufung und Kennung entstehen neu, nichts aus der Datei wird übernommen
  const satz = d.schritte.map((s, i) => (i === 0 ? "" : s.abhaengig ? " und dann " : " und ") + s.text.trim()).join("");
  const r = auftragAnlegen(satz, Date.now(), { plan: true, herkunft: "import" });
  if (r.fehler) return r;
  if (r.auftrag.schritte.length !== d.schritte.length) { auftragAbbrechen(r.auftrag.id); return { fehler: "Schritte ließen sich nicht eindeutig zuordnen – Import verworfen." }; }
  return r;
}
function auftragPausieren(id) { const a = auftragFinden(id); if (!a || a.status !== "laeuft") return false; auftragSetzen(a, "pausiert", "pausiert"); return true; }
// erst speichern: auftragAusfuehren liest den Stand frisch (sonst blieb ein unterbrochener Auftrag unterbrochen)
function auftragFortsetzen(id) { const a = auftragFinden(id); if (!a || !["pausiert", "unterbrochen"].includes(a.status)) return false; auftragSetzen(a, "pausiert", "fortgesetzt"); auftragAusfuehren(id); return true; }
function auftragAbbrechen(id) {
  const a = auftragFinden(id);
  if (!a || ["fertig", "abgebrochen", "fehler"].includes(a.status)) return false;
  for (const s of a.schritte) if (s.status === "offen" || s.status === "laeuft") { s.status = "abgebrochen"; s.ergebnis = "Auftrag abgebrochen"; }
  auftragSetzen(a, "abgebrochen", "vom Nutzer abgebrochen – offene Schritte nicht ausgeführt");
  auftragNaechster();
  return true;
}
// Nach dem Neuladen: laufend → unterbrochen (laufender Schritt gilt als nicht erledigt und wird nicht wiederholt)
function auftraegeNachNeustart() {
  auftraegeLesen();
  if (speicherBeschaedigt(AUFTRAG.schluessel)) return 0;
  let n = 0;
  for (const a of auftragStand.liste) if (a.status === "laeuft" || a.status === "freigegeben") {
    for (const s of a.schritte) if (s.status === "laeuft") { s.status = "fehler"; s.ergebnis = "beim Neuladen unterbrochen – nicht wiederholt"; }
    a.status = "unterbrochen"; auftragProtokoll(a, "Seite neu geladen – unterbrochen; „Fortsetzen“ führt nur die offenen Schritte aus"); n++;
  }
  if (n) auftraegeSpeichern();
  return n;
}

// ---------- Anzeige ----------
const AUFTRAG_STATUS = { bereit: "bereit", wartet: "wartet auf Freigabe", freigegeben: "freigegeben", laeuft: "läuft", pausiert: "pausiert", warteschlange: "in der Warteschlange", unterbrochen: "unterbrochen", fertig: "fertig", fehler: "beendet mit Fehlern", abgebrochen: "abgebrochen" };
const SCHRITT_ZEICHEN = { offen: "○", laeuft: "◐", erledigt: "✔", fehler: "✖", blockiert: "⛔", uebersprungen: "↷", abgebrochen: "–" };
function auftraegeAnzeigen() {
  const box = document.getElementById("auftrag-liste");
  if (!box) return;
  if (speicherBeschaedigt(AUFTRAG.schluessel)) { box.replaceChildren(Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: "Auftragsspeicher beschädigt – " + SPEICHER_SCHADEN_TEXT })); return; }
  const liste = auftragStand.liste.slice().reverse().slice(0, 8);
  box.replaceChildren(...(liste.length ? liste.map((a) => {
    const li = document.createElement("li");
    li.dataset.id = a.id; li.dataset.status = a.status;
    li.append(Object.assign(document.createElement("div"), { textContent: `${a.id} · ${a.modus === "plan" ? "Plan · " : ""}${AUFTRAG_STATUS[a.status] || a.status}${a.prio === "hoch" ? " · Priorität hoch" : ""}${a.herkunft === "import" ? " · importiert" : ""} · „${a.text.slice(0, 80)}“` }));
    // ab 11-09c: Fortschritt, Baum (abhängige Schritte eingerückt unter ihrem Vorgänger), Ergebnis- und Fehlerbericht
    const fertig = a.schritte.filter((s) => !["offen", "laeuft"].includes(s.status)).length;
    const fort = Object.assign(document.createElement("progress"), { max: a.schritte.length, value: fertig });
    fort.setAttribute("aria-label", `Fortschritt ${fertig} von ${a.schritte.length} Schritten`);
    li.append(fort);
    const baum = document.createElement("ul"); baum.className = "auftrag-baum";
    let ebene = baum;
    for (const s of a.schritte) {
      const knoten = Object.assign(document.createElement("li"), { textContent: `${SCHRITT_ZEICHEN[s.status] || "○"} ${s.nr}. ${s.text} – ${s.art === "lesen" ? "liest" : s.art === "schreiben" ? "ändert" : "blockiert"}${s.ergebnis ? " · " + s.ergebnis : s.grund ? " · " + s.grund : ""}` });
      knoten.dataset.nr = String(s.nr); knoten.dataset.status = s.status;
      if (s.abhaengig && ebene.lastElementChild) { const unter = document.createElement("ul"); ebene.lastElementChild.append(unter); ebene = unter; } else ebene = baum;
      ebene.append(knoten);
    }
    li.append(baum);
    if (["fertig", "fehler", "abgebrochen"].includes(a.status)) {
      const z = (st) => a.schritte.filter((s) => s.status === st).length;
      const bericht = li.appendChild(Object.assign(document.createElement("div"), { className: "klein" }));
      bericht.dataset.bericht = "1";
      Object.assign(bericht, { textContent: `Ergebnis: ${z("erledigt")} erledigt, ${z("blockiert")} blockiert, ${z("fehler")} Fehler, ${z("uebersprungen")} übersprungen, ${z("abgebrochen")} abgebrochen` + (z("fehler") + z("blockiert") ? " · Fehlerbericht: " + a.schritte.filter((s) => ["fehler", "blockiert"].includes(s.status)).map((s) => `Schritt ${s.nr}: ${s.ergebnis}`).join("; ") : "") });
    }
    if (a.veraltet) li.append(Object.assign(document.createElement("div"), { className: "wz-wichtig", textContent: "⚠ Plan veraltet: " + a.veraltet + " – erst aktualisieren." }));
    if (a.widersprueche.length) li.append(Object.assign(document.createElement("div"), { className: "wz-wichtig", textContent: "⚠ Widerspruch: " + a.widersprueche.join("; ") + " – nicht freigebbar, bitte neu formulieren." }));
    const knopf = (t, f) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: t }); b.setAttribute("aria-label", t + ": Auftrag " + a.id); b.addEventListener("click", f); return b; };
    const zeile = Object.assign(document.createElement("div"), { className: "order-zeile" });
    if (a.status === "wartet" && !a.widersprueche.length) zeile.append(knopf("Freigeben und ausführen", () => auftragFreigeben(a.id)));
    if (["wartet", "unterbrochen", "pausiert"].includes(a.status)) zeile.append(knopf("Plan aktualisieren", () => auftragAktualisieren(a.id)));
    if (a.status === "fehler" && a.schritte.some((s) => s.art === "lesen" && s.status === "fehler")) zeile.append(knopf("Leseschritte wiederholen", () => auftragLesenWiederholen(a.id)));
    zeile.append(knopf("Exportieren", () => { const t = auftragExport(a.id); const l = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([t], { type: "application/json" })), download: "jarvis-auftrag-" + a.id + ".json" }); document.body.append(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(l.href), 1000); }));
    if (a.status === "laeuft") zeile.append(knopf("Pausieren", () => auftragPausieren(a.id)));
    if (["pausiert", "unterbrochen"].includes(a.status)) zeile.append(knopf("Fortsetzen", () => auftragFortsetzen(a.id)));
    if (!["fertig", "abgebrochen", "fehler"].includes(a.status)) zeile.append(knopf("Abbrechen", () => auftragAbbrechen(a.id)));
    if (zeile.children.length) li.append(zeile);
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "Noch kein Auftrag. Beispiel: „Neue Aufgabe Steuer morgen um 9 und dann gehe zu Notizen“." })]));
  const p = document.getElementById("auftrag-protokoll");
  if (p) p.replaceChildren(...auftragStand.protokoll.slice(-8).reverse().map((e) => Object.assign(document.createElement("li"), { textContent: `${new Date(e.zeit).toLocaleTimeString("de-DE")} · ${e.auftrag} · ${e.text}` })));
}
// Einstieg vor dem Dispatcher: mehrteilige Anfrage → Auftrag (statt nur den ersten Teil auszuführen)
{
  const original = skillAusfuehren;
  skillAusfuehren = async function (text) {
    const offen = (typeof offeneAktion !== "undefined" && offeneAktion) || (typeof paperOffen !== "undefined" && paperOffen) || (typeof slDialogPasst === "function" && slDialogPasst(text));
    const plan = AUFTRAG_PLAN.test(text);
    if (offen || !auftragErkennen(String(text).replace(AUFTRAG_PLAN, ""), plan ? 1 : 2)) return original(text);
    const r = auftragAnlegen(text);
    if (r.fehler) { lokalAntworten("Auftrag nicht angelegt: " + r.fehler + " Es wurde nichts ausgeführt."); auftraegeAnzeigen(); return "auftrag"; }
    const a = r.auftrag, d = document.getElementById("auftrag-details");
    if (d) d.open = true;
    auftraegeAnzeigen();
    const schrittText = a.schritte.map((s) => `${s.nr}. ${s.text} (${s.art === "lesen" ? "liest" : s.art === "schreiben" ? "ändert" : "blockiert: " + s.grund})`).join(" · ");
    if (a.status === "bereit") { lokalAntworten(`Auftrag ${a.id} (nur Lesen) wird ausgeführt: ${schrittText}`); auftragAusfuehren(a.id); }
    else lokalAntworten(`${a.modus === "plan" ? "Plan" : "Auftrag"} ${a.id} vorbereitet: ${schrittText}. ` + (a.widersprueche.length ? "⚠ Widerspruch: " + a.widersprueche.join("; ") + " – nicht freigebbar." : a.status === "warteschlange" ? "In der Warteschlange." : a.modus === "plan" ? "Planungsmodus – es wurde nichts ausgeführt; zum Ausführen unter „Aufträge“ freigeben." : "Ändert Daten – bitte unter „Aufträge“ freigeben. Es wurde noch nichts ausgeführt."));
    return "auftrag";
  };
}
document.getElementById("auftrag-import").addEventListener("change", async (e) => {
  const datei = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!datei) return;
  const m = document.getElementById("auftrag-meldung");
  if (datei.size > 50000) { m.textContent = "Datei zu groß (höchstens 50 KB)."; return; }
  const r = auftragImport(await datei.text());
  m.textContent = r.fehler ? "Import abgelehnt: " + r.fehler : `Plan ${r.auftrag.id} importiert – neu eingestuft, nichts ausgeführt.`;
  auftraegeAnzeigen();
});
auftraegeNachNeustart();
auftraegeAnzeigen();
window.addEventListener("storage", (e) => { if (e.key === AUFTRAG.schluessel) { auftraegeLesen(); auftraegeAnzeigen(); } });

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("auftraege");
