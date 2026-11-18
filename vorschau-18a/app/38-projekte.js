// JARVIS Dashboard – Modul „projekte“ (ab 11-09f). Projektplanung in der vorhandenen Karte „Profil & Projekte“ – kein zweites
// Aufgabensystem: Ein Projekt bündelt, was es schon gibt. Aufgaben gehören dazu, wenn ihre Kategorie dem Projektnamen entspricht;
// Notizen über Kategorie oder #Tag; Wissen über die Profil-Einträge „Projekt …“ (09f liest diese nur).
// Eigenes: Ziel, Status, Fälligkeit, Meilensteine, Verlauf. Fortschritt, nächster Schritt und Risiken werden aus diesen Daten
// berechnet (keine Schätzung, keine KI). Löschen eines Projekts nur mit zweitem Klick; Aufgaben und Notizen bleiben dabei erhalten.
// Speicher: localStorage „jarvis-projekte“ { art, version, projekte, verlauf } – beschädigt → gemeldet, nie überschrieben.
const PROJEKT = { schluessel: "jarvis-projekte", max: 30, maxMeilensteine: 20, maxVerlauf: 100, maxName: 40, maxZiel: 300, ruheTage: 14, knappTage: 7, loeschenOffen: null };
const PROJEKT_STATUS = { aktiv: "aktiv", pausiert: "pausiert", abgeschlossen: "abgeschlossen", archiviert: "archiviert" };
// ab 11-09g: Priorität, Vorlagen (Meilensteine mit Abhängigkeit „nach dem vorigen“)
const PROJEKT_PRIO = { hoch: "hoch", normal: "normal", niedrig: "niedrig" };
const PROJEKT_VORLAGEN = {
  leer: { name: "ohne Vorlage", meilensteine: [] },
  umzug: { name: "Umzug", meilensteine: ["Wohnung gefunden", "Vertrag unterschrieben", "Umzug durchgeführt", "Ummeldungen erledigt"] },
  reise: { name: "Reise", meilensteine: ["Ziel und Termin festgelegt", "Unterkunft gebucht", "Packliste fertig"] },
  lernen: { name: "Lernziel", meilensteine: ["Material gesammelt", "Grundlagen durchgearbeitet", "Prüfung/Abschluss"] },
};
let projektStand = { projekte: [], verlauf: [] };
function projekteLesen() {
  const d = speicherJsonLesen(PROJEKT.schluessel, (x) => istObjekt(x) && x.art === "jarvis-projekte" && Array.isArray(x.projekte) && Array.isArray(x.verlauf));
  projektStand = d ? { projekte: d.projekte.filter((p) => p && typeof p.id === "string" && typeof p.name === "string"), verlauf: d.verlauf.slice(-PROJEKT.maxVerlauf) } : { projekte: [], verlauf: [] };
  return projektStand;
}
function projekteSpeichern() {
  if (speicherBeschaedigt(PROJEKT.schluessel)) return false;
  try { localStorage.setItem(PROJEKT.schluessel, JSON.stringify({ art: "jarvis-projekte", version: 1, projekte: projektStand.projekte, verlauf: projektStand.verlauf.slice(-PROJEKT.maxVerlauf) })); return true; } catch (e) { return false; }
}
function projektMerken(p, was) { projektStand.verlauf.push({ zeit: new Date().toISOString(), projekt: p.name, was: String(was).slice(0, 160) }); p.geaendert = new Date().toISOString(); }
const projektNorm = (s) => String(s || "").trim().toLowerCase();
function projektFinden(name) { const n = projektNorm(name); return projektStand.projekte.find((p) => projektNorm(p.name) === n) || null; }
function projektDatum(wert) { if (!wert) return ""; const d = new Date(wert); return isNaN(d) ? null : d.toISOString(); }
// Anlegen: eindeutiger Name, Grenzen geprüft. Rückgabe { projekt } oder { fehler }.
function projektAnlegen({ name, ziel = "", faellig = "", beschreibung = "", prio = "normal", vorlage = "leer" }) {
  projekteLesen();
  if (speicherBeschaedigt(PROJEKT.schluessel)) return { fehler: "Projektdaten beschädigt – " + SPEICHER_SCHADEN_TEXT };
  const n = String(name || "").replace(/\s+/g, " ").trim();
  if (!n || n.length > PROJEKT.maxName) return { fehler: `Projektname fehlt oder ist länger als ${PROJEKT.maxName} Zeichen.` };
  if (projektFinden(n)) return { fehler: `Projekt „${n}“ gibt es schon.` };
  if (projektStand.projekte.length >= PROJEKT.max) return { fehler: `Höchstens ${PROJEKT.max} Projekte.` };
  const f = projektDatum(faellig);
  if (f === null) return { fehler: "Fälligkeit ist kein gültiges Datum." };
  const jetzt = new Date().toISOString();
  if (!PROJEKT_VORLAGEN[vorlage]) return { fehler: "Unbekannte Vorlage." };
  const p = { id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n, ziel: String(ziel || "").trim().slice(0, PROJEKT.maxZiel), beschreibung: String(beschreibung || "").trim().slice(0, 1000), prio: PROJEKT_PRIO[prio] ? prio : "normal", status: "aktiv", faellig: f, meilensteine: [], dateien: [], erstellt: jetzt, geaendert: jetzt };
  let vorige = null;
  for (const titel of PROJEKT_VORLAGEN[vorlage].meilensteine) { const m = { id: "m" + Math.random().toString(36).slice(2, 9), titel, faellig: "", erledigt: false, nach: vorige }; p.meilensteine.push(m); vorige = m.id; }
  projektStand.projekte.push(p);
  projektMerken(p, "angelegt" + (vorlage !== "leer" ? " (Vorlage " + PROJEKT_VORLAGEN[vorlage].name + ")" : ""));
  if (!projekteSpeichern()) return { fehler: "Nicht gespeichert (Browserspeicher)." };
  projekteAnzeigen();
  return { projekt: p };
}
function projektAendern(id, aenderung) {
  projekteLesen();
  const p = projektStand.projekte.find((x) => x.id === id);
  if (!p || speicherBeschaedigt(PROJEKT.schluessel)) return false;
  if (aenderung.status && PROJEKT_STATUS[aenderung.status] && aenderung.status !== p.status) { projektMerken(p, `Status ${p.status} → ${aenderung.status}`); p.status = aenderung.status; }
  if (aenderung.prio && PROJEKT_PRIO[aenderung.prio] && aenderung.prio !== p.prio) { projektMerken(p, `Priorität ${p.prio || "normal"} → ${aenderung.prio}`); p.prio = aenderung.prio; }
  if ("beschreibung" in aenderung) { p.beschreibung = String(aenderung.beschreibung || "").trim().slice(0, 1000); projektMerken(p, "Beschreibung geändert"); }
  if ("ziel" in aenderung) { p.ziel = String(aenderung.ziel || "").trim().slice(0, PROJEKT.maxZiel); projektMerken(p, "Ziel geändert"); }
  if ("faellig" in aenderung) { const f = projektDatum(aenderung.faellig); if (f === null) return false; p.faellig = f; projektMerken(p, "Fälligkeit " + (f ? new Date(f).toLocaleDateString("de-DE") : "entfernt")); }
  const ok = projekteSpeichern(); projekteAnzeigen(); return ok;
}
function meilensteinHinzufuegen(id, titel, faellig = "", nach = null) {
  projekteLesen();
  const p = projektStand.projekte.find((x) => x.id === id), t = String(titel || "").trim().slice(0, 120), f = projektDatum(faellig);
  if (!p || !t || f === null || p.meilensteine.length >= PROJEKT.maxMeilensteine || speicherBeschaedigt(PROJEKT.schluessel)) return null;
  if (nach && !p.meilensteine.some((x) => x.id === nach)) return null;
  const m = { id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), titel: t, faellig: f, erledigt: false, nach: nach || null };
  p.meilensteine.push(m);
  projektMerken(p, "Meilenstein „" + t + "“");
  projekteSpeichern(); projekteAnzeigen();
  return m;
}
function meilensteinUmschalten(id, mid) {
  projekteLesen();
  const p = projektStand.projekte.find((x) => x.id === id), m = p && p.meilensteine.find((x) => x.id === mid);
  if (!m || speicherBeschaedigt(PROJEKT.schluessel)) return false;
  // ab 11-09g: blockiert, solange der vorausgesetzte Meilenstein offen ist; Zurücksetzen geht nur, wenn kein späterer erreicht ist
  const vor = m.nach && p.meilensteine.find((x) => x.id === m.nach);
  if (!m.erledigt && vor && !vor.erledigt) { PROJEKT.letzterFehler = `„${m.titel}“ ist blockiert – erst „${vor.titel}“ erreichen.`; projekteAnzeigen(); return false; }
  const spaeter = p.meilensteine.find((x) => x.nach === m.id && x.erledigt);
  if (m.erledigt && spaeter) { PROJEKT.letzterFehler = `„${spaeter.titel}“ baut darauf auf – erst diesen wieder öffnen.`; projekteAnzeigen(); return false; }
  m.erledigt = !m.erledigt;
  projektMerken(p, `Meilenstein „${m.titel}“ ${m.erledigt ? "erreicht" : "wieder offen"}`);
  const ok = projekteSpeichern(); projekteAnzeigen(); return ok;
}
// Aufgabe im Projekt anlegen = normale Aufgabe mit der Projekt-Kategorie (erscheint auch in „Aufgaben“ und „Mein Tag“)
function projektAufgabe(id, titel, faellig = "") {
  const p = projekteLesen().projekte.find((x) => x.id === id);
  if (!p || !window.aufgabenIntern || !String(titel || "").trim()) return false;
  // ab 11-09g: keine doppelte offene Projektaufgabe (gleicher Titel, gleiche Kategorie)
  const tn = projektNorm(titel);
  if (window.aufgabenIntern.liste().some((a) => !a.erledigt && projektNorm(a.kategorie) === projektNorm(p.name) && projektNorm(a.titel) === tn)) { PROJEKT.letzterFehler = `Die Aufgabe „${String(titel).trim()}“ ist im Projekt schon offen.`; return false; }
  const ok = window.aufgabenIntern.hinzufuegen(String(titel).trim().slice(0, 200), faellig || "", "normal", "", true, { kategorie: p.name });
  if (ok) { projektMerken(p, "Aufgabe „" + String(titel).trim().slice(0, 60) + "“"); projekteSpeichern(); projekteAnzeigen(); }
  return Boolean(ok);
}
// Zweistufiges Löschen: erster Aufruf merkt vor, zweiter (innerhalb 10 s) löscht. Verknüpfte Aufgaben/Notizen bleiben.
function projektLoeschen(id, jetzt = Date.now()) {
  projekteLesen();
  const p = projektStand.projekte.find((x) => x.id === id);
  if (!p || speicherBeschaedigt(PROJEKT.schluessel)) return "fehlt";
  if (!PROJEKT.loeschenOffen || PROJEKT.loeschenOffen.id !== id || jetzt - PROJEKT.loeschenOffen.zeit > 10000) { PROJEKT.loeschenOffen = { id, zeit: jetzt }; projekteAnzeigen(); return "vorgemerkt"; }
  PROJEKT.loeschenOffen = null;
  projektStand.projekte = projektStand.projekte.filter((x) => x.id !== id);
  projektStand.verlauf.push({ zeit: new Date().toISOString(), projekt: p.name, was: "gelöscht (Aufgaben und Notizen bleiben erhalten)" });
  projekteSpeichern(); projekteAnzeigen();
  return "geloescht";
}
// Übersicht aus vorhandenen Daten – alles nachvollziehbar
function projektUebersicht(p, jetzt = new Date()) {
  const n = projektNorm(p.name);
  const aufgaben = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => projektNorm(a.kategorie) === n) : [];
  const notizen = typeof notizenSuchen === "function" ? notizenSuchen("", "", "").filter((x) => projektNorm(x.kategorie) === n || (typeof notizTags === "function" && notizTags(x).map(projektNorm).includes(n.replace(/\s+/g, "")))) : [];
  const wissen = typeof profil !== "undefined" ? profil.filter((e) => e.kategorie === "projekt" && projektNorm(e.projekt) === n) : [];
  const offen = aufgaben.filter((a) => !a.erledigt), erledigt = aufgaben.length - offen.length;
  const ms = p.meilensteine || [], msErledigt = ms.filter((m) => m.erledigt).length;
  const gesamt = aufgaben.length + ms.length, fertig = erledigt + msErledigt;
  const fortschritt = gesamt ? Math.round((fertig / gesamt) * 100) : 0;
  const ueberfaellig = offen.filter((a) => a.faellig && new Date(a.faellig) < jetzt).length + ms.filter((m) => !m.erledigt && m.faellig && new Date(m.faellig) < jetzt).length;
  // ab 11-09g: blockierte Meilensteine (Voraussetzung offen) und verknüpfte Dateien
  const blockiert = ms.filter((m) => !m.erledigt && m.nach && ms.some((v) => v.id === m.nach && !v.erledigt)).map((m) => ({ titel: m.titel, wartetAuf: ms.find((v) => v.id === m.nach).titel }));
  const dateiListe = typeof dateienLesen === "function" ? dateienLesen() : [];
  const dateien = (p.dateien || []).map((id) => { const e = dateiListe.find((x) => x.id === id); return e ? { id, name: e.name } : { id, name: "(nicht mehr in der Dateiliste)", fehlt: true }; });
  const kandidaten = [...offen.map((a) => ({ art: "Aufgabe", titel: a.titel, faellig: a.faellig || "" })), ...ms.filter((m) => !m.erledigt && !blockiert.some((b) => b.titel === m.titel)).map((m) => ({ art: "Meilenstein", titel: m.titel, faellig: m.faellig || "" }))];
  kandidaten.sort((a, b) => (a.faellig || "9999").localeCompare(b.faellig || "9999"));
  const naechster = kandidaten[0] || null;
  const risiken = [];
  const laufend = p.status === "aktiv";
  if (ueberfaellig) risiken.push(`${ueberfaellig} überfällig`);
  if (laufend && !naechster) risiken.push("kein nächster Schritt geplant");
  if (laufend && p.faellig) {
    const tage = (new Date(p.faellig) - jetzt) / 86400000;
    if (tage < 0) risiken.push("Projektfälligkeit überschritten");
    else if (tage <= PROJEKT.knappTage && fortschritt < 50) risiken.push(`knapp: noch ${Math.ceil(tage)} Tag(e), Fortschritt ${fortschritt} %`);
  }
  if (laufend && (jetzt - new Date(p.geaendert)) / 86400000 > PROJEKT.ruheTage) risiken.push(`seit über ${PROJEKT.ruheTage} Tagen unverändert`);
  return { aufgaben: aufgaben.length, offen: offen.length, erledigt, meilensteine: ms.length, meilensteineErledigt: msErledigt, fortschritt, ueberfaellig, naechster, risiken, notizen: notizen.length, wissen: wissen.length, blockiert, dateien };
}
function projektBericht(p, jetzt = new Date()) {
  const u = projektUebersicht(p, jetzt), dat = (x) => (x ? new Date(x).toLocaleDateString("de-DE") : "–");
  const z = [`# Projekt ${p.name} – Statusbericht`, "", `Stand ${jetzt.toLocaleString("de-DE")} (lokal berechnet aus Aufgaben, Meilensteinen, Notizen).`, "",
    `- Status: ${p.status} · Priorität: ${p.prio || "normal"} · Fällig: ${dat(p.faellig)} · Fortschritt: ${u.fortschritt} %`, `- Ziel: ${p.ziel || "–"}`, ...(p.beschreibung ? [`- Beschreibung: ${p.beschreibung}`] : []),
    ...(u.blockiert.length ? [`- Blockiert: ${u.blockiert.map((b) => `„${b.titel}“ wartet auf „${b.wartetAuf}“`).join("; ")}`] : []), ...(u.dateien.length ? [`- Dateien: ${u.dateien.map((x) => x.name).join(", ")}`] : []),
    `- Aufgaben: ${u.erledigt} von ${u.aufgaben} erledigt · Meilensteine: ${u.meilensteineErledigt} von ${u.meilensteine} · Notizen: ${u.notizen} · Wissen: ${u.wissen}`,
    `- Nächster Schritt: ${u.naechster ? `${u.naechster.art} „${u.naechster.titel}“${u.naechster.faellig ? " bis " + dat(u.naechster.faellig) : ""}` : "–"}`,
    `- Risiken: ${u.risiken.join("; ") || "keine erkannt"}`];
  if ((p.meilensteine || []).length) z.push("", "## Meilensteine", ...p.meilensteine.map((m) => `- [${m.erledigt ? "x" : " "}] ${m.titel}${m.faellig ? " (bis " + dat(m.faellig) + ")" : ""}`));
  return z.join("\n") + "\n";
}
// ---------- ab 11-09g: Wochenplanung, Dateiverknüpfung, Suche/Filter, Export/Import ----------
// Wochenplanung: offene Aufgaben und Meilensteine aller aktiven Projekte, die in den nächsten 7 Tagen fällig sind (plus Überfälliges)
function projektWoche(jetzt = new Date()) {
  const start = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate()), ende = new Date(start.getTime() + 7 * 86400000);
  const tage = Array.from({ length: 7 }, (_, i) => ({ datum: new Date(start.getTime() + i * 86400000), eintraege: [] })), ueberfaellig = [];
  for (const p of projektStand.projekte.filter((x) => x.status === "aktiv")) {
    const n = projektNorm(p.name);
    const posten = [...(window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => !a.erledigt && a.faellig && projektNorm(a.kategorie) === n).map((a) => ({ art: "Aufgabe", titel: a.titel, faellig: a.faellig })) : []),
      ...(p.meilensteine || []).filter((m) => !m.erledigt && m.faellig).map((m) => ({ art: "Meilenstein", titel: m.titel, faellig: m.faellig }))];
    for (const x of posten) {
      const d = new Date(x.faellig), e = { ...x, projekt: p.name, prio: p.prio || "normal" };
      if (d < start) ueberfaellig.push(e);
      else if (d < ende) tage[Math.floor((d - start) / 86400000)].eintraege.push(e);
    }
  }
  const rang = { hoch: 0, normal: 1, niedrig: 2 };
  for (const t of tage) t.eintraege.sort((a, b) => rang[a.prio] - rang[b.prio] || a.faellig.localeCompare(b.faellig));
  return { tage, ueberfaellig };
}
function projektDateiVerknuepfen(id, dateiId, verknuepfen = true) {
  projekteLesen();
  const p = projektStand.projekte.find((x) => x.id === id);
  if (!p || speicherBeschaedigt(PROJEKT.schluessel) || (verknuepfen && !(typeof dateienLesen === "function" && dateienLesen().some((e) => e.id === dateiId)))) return false;
  p.dateien = (p.dateien || []).filter((x) => x !== dateiId);
  if (verknuepfen) p.dateien.push(dateiId);
  projektMerken(p, verknuepfen ? "Datei verknüpft" : "Dateiverknüpfung gelöst");
  const ok = projekteSpeichern(); projekteAnzeigen(); return ok;
}
function projekteFiltern({ suche = "", status = "", archiv = false } = {}) {
  const w = projektNorm(suche).split(/\s+/).filter(Boolean), rang = { hoch: 0, normal: 1, niedrig: 2 };
  return projektStand.projekte.filter((p) => (status ? p.status === status : archiv || p.status !== "archiviert") && w.every((x) => projektNorm([p.name, p.ziel, p.beschreibung, ...(p.meilensteine || []).map((m) => m.titel)].join(" ")).includes(x)))
    .sort((a, b) => rang[a.prio || "normal"] - rang[b.prio || "normal"] || (a.faellig || "9999").localeCompare(b.faellig || "9999") || a.name.localeCompare(b.name, "de"));
}
// Export: Projekt mit Meilensteinen und den Titeln der offenen Projektaufgaben (keine Kennungen anderer Daten)
function projektExport(id) {
  const p = projektStand.projekte.find((x) => x.id === id);
  if (!p) return null;
  const aufgaben = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => !a.erledigt && projektNorm(a.kategorie) === projektNorm(p.name)).map((a) => ({ titel: a.titel, faellig: a.faellig || "" })) : [];
  const nr = new Map(p.meilensteine.map((m, i) => [m.id, i]));
  return JSON.stringify({ art: "jarvis-projekt", version: 1, projekt: { name: p.name, ziel: p.ziel, beschreibung: p.beschreibung || "", prio: p.prio || "normal", faellig: p.faellig,
    meilensteine: p.meilensteine.map((m) => ({ titel: m.titel, faellig: m.faellig, erledigt: m.erledigt, nach: m.nach && nr.has(m.nach) ? nr.get(m.nach) : null })), aufgaben } }, null, 1);
}
// Import: vollständig geprüft; legt ein neues Projekt an (nie Überschreiben), Aufgaben nur auf Wunsch
function projektImport(text, { mitAufgaben = false } = {}) {
  let d;
  try { d = JSON.parse(String(text || "")); } catch (e) { return { fehler: "kein gültiges JSON" }; }
  const q = d && d.projekt;
  if (!istObjekt(d) || d.art !== "jarvis-projekt" || d.version !== 1 || !istObjekt(q) || typeof q.name !== "string") return { fehler: "keine JARVIS-Projektdatei (Version 1)" };
  const ms = Array.isArray(q.meilensteine) ? q.meilensteine : [], auf = Array.isArray(q.aufgaben) ? q.aufgaben : [];
  if (ms.length > PROJEKT.maxMeilensteine || auf.length > 50) return { fehler: "zu viele Meilensteine oder Aufgaben" };
  for (const [i, m] of ms.entries()) if (!istObjekt(m) || typeof m.titel !== "string" || !m.titel.trim() || (m.nach !== null && m.nach !== undefined && !(Number.isInteger(m.nach) && m.nach >= 0 && m.nach < i)) || projektDatum(m.faellig) === null) return { fehler: "Meilenstein ungültig: " + JSON.stringify(m).slice(0, 60) };
  for (const a of auf) if (!istObjekt(a) || typeof a.titel !== "string" || !a.titel.trim() || projektDatum(a.faellig) === null) return { fehler: "Aufgabe ungültig: " + JSON.stringify(a).slice(0, 60) };
  const r = projektAnlegen({ name: q.name, ziel: q.ziel, beschreibung: q.beschreibung, prio: q.prio, faellig: q.faellig || "" });
  if (r.fehler) return r;
  const p = projektStand.projekte.find((x) => x.id === r.projekt.id), ids = [];
  for (const m of ms) { const neu = { id: "m" + Math.random().toString(36).slice(2, 9), titel: m.titel.trim().slice(0, 120), faellig: projektDatum(m.faellig), erledigt: Boolean(m.erledigt), nach: Number.isInteger(m.nach) ? ids[m.nach] : null }; ids.push(neu.id); p.meilensteine.push(neu); }
  projektMerken(p, "importiert");
  projekteSpeichern();
  let angelegt = 0;
  if (mitAufgaben) for (const a of auf) if (projektAufgabe(p.id, a.titel, a.faellig || "")) angelegt++;
  projekteAnzeigen();
  return { projekt: p, aufgaben: angelegt };
}
function projekteAnzeigen(jetzt = new Date()) {
  const el = (id) => document.getElementById(id), ul = el("projekt-liste");
  if (!ul) return;
  if (speicherBeschaedigt(PROJEKT.schluessel)) { ul.replaceChildren(Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: "Projektdaten beschädigt – " + SPEICHER_SCHADEN_TEXT })); return; }
  const zeigeArchiv = el("projekt-archiv").checked;
  const liste = projekteFiltern({ suche: el("projekt-suche").value, status: el("projekt-status-filter").value, archiv: zeigeArchiv }); // ab 11-09g: Suche, Filter, Priorität
  const knopf = (t, label, f) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: t }); b.setAttribute("aria-label", label); b.addEventListener("click", f); return b; };
  ul.replaceChildren(...(liste.length ? liste.map((p) => {
    const u = projektUebersicht(p, jetzt), li = document.createElement("li");
    li.dataset.id = p.id; li.className = "projekt";
    const kopf = Object.assign(document.createElement("div"), { className: "aufgabe-text" });
    kopf.append(Object.assign(document.createElement("b"), { textContent: p.name }), document.createTextNode(` · ${p.status}${p.prio && p.prio !== "normal" ? " · Priorität " + p.prio : ""}${p.faellig ? " · fällig " + new Date(p.faellig).toLocaleDateString("de-DE") : ""}${p.ziel ? " · Ziel: " + p.ziel : ""}`));
    const balken = Object.assign(document.createElement("progress"), { max: 100, value: u.fortschritt });
    balken.setAttribute("aria-label", `Fortschritt ${p.name}: ${u.fortschritt} %`);
    const info = Object.assign(document.createElement("p"), { className: "klein", textContent: `${u.fortschritt} % · Aufgaben ${u.erledigt}/${u.aufgaben} · Meilensteine ${u.meilensteineErledigt}/${u.meilensteine} · Notizen ${u.notizen} · Wissen ${u.wissen} · Nächster Schritt: ${u.naechster ? u.naechster.titel : "–"}` });
    info.dataset.uebersicht = "1";
    const teile = [kopf, balken, info];
    if (u.risiken.length) teile.push(Object.assign(document.createElement("p"), { className: "klein wz-wichtig", textContent: "⚠ " + u.risiken.join(" · ") }));
    if (p.beschreibung) teile.push(Object.assign(document.createElement("p"), { className: "klein", textContent: p.beschreibung }));
    if (u.blockiert.length) { const b = Object.assign(document.createElement("p"), { className: "klein", textContent: "Blockiert: " + u.blockiert.map((x) => `„${x.titel}“ wartet auf „${x.wartetAuf}“`).join(" · ") }); b.dataset.blockiert = "1"; teile.push(b); }
    if (u.dateien.length) teile.push(Object.assign(document.createElement("p"), { className: "klein", textContent: "Dateien: " + u.dateien.map((x) => x.name).join(", ") }));
    const msUl = Object.assign(document.createElement("ul"), { className: "projekt-meilensteine" });
    msUl.append(...p.meilensteine.map((m) => {
      const mli = document.createElement("li"), lab = Object.assign(document.createElement("label"), { className: "verlauf-schalter" }), cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: m.erledigt });
      cb.addEventListener("change", () => meilensteinUmschalten(p.id, m.id));
      if (u.blockiert.some((b) => b.titel === m.titel)) mli.dataset.blockiert = "1";
      lab.append(cb, document.createTextNode(" " + (mli.dataset.blockiert ? "🔒 " : "") + m.titel + (m.faellig ? " (bis " + new Date(m.faellig).toLocaleDateString("de-DE") + ")" : "")));
      mli.append(lab); return mli;
    }));
    teile.push(msUl);
    const zeile = Object.assign(document.createElement("div"), { className: "order-zeile" });
    const status = Object.assign(document.createElement("select"), { className: "feld" });
    status.setAttribute("aria-label", "Status " + p.name);
    status.append(...Object.keys(PROJEKT_STATUS).map((s) => Object.assign(document.createElement("option"), { value: s, textContent: PROJEKT_STATUS[s], selected: s === p.status })));
    status.addEventListener("change", () => projektAendern(p.id, { status: status.value }));
    const eingabe = Object.assign(document.createElement("input"), { className: "feld", maxLength: 120, placeholder: "Meilenstein oder Aufgabe" });
    eingabe.setAttribute("aria-label", "Meilenstein oder Aufgabe für " + p.name);
    const vorgemerkt = PROJEKT.loeschenOffen && PROJEKT.loeschenOffen.id === p.id;
    const prio = Object.assign(document.createElement("select"), { className: "feld" });
    prio.setAttribute("aria-label", "Priorität " + p.name);
    prio.append(...Object.keys(PROJEKT_PRIO).map((s) => Object.assign(document.createElement("option"), { value: s, textContent: "Priorität " + s, selected: s === (p.prio || "normal") })));
    prio.addEventListener("change", () => projektAendern(p.id, { prio: prio.value }));
    const datei = Object.assign(document.createElement("select"), { className: "feld" });
    datei.setAttribute("aria-label", "Datei verknüpfen mit " + p.name);
    const frei = (typeof dateienLesen === "function" ? dateienLesen() : []).filter((e) => !(p.dateien || []).includes(e.id));
    datei.append(Object.assign(document.createElement("option"), { value: "", textContent: frei.length ? "Datei verknüpfen …" : "keine Datei frei" }), ...frei.map((e) => Object.assign(document.createElement("option"), { value: e.id, textContent: e.name })));
    datei.addEventListener("change", () => { if (datei.value && projektDateiVerknuepfen(p.id, datei.value)) el("projekt-meldung").textContent = "Datei verknüpft (nur der Eintrag, die Datei bleibt unverändert)."; });
    zeile.append(status, prio, datei, eingabe,
      knopf("+ Meilenstein", "Meilenstein hinzufügen: " + p.name, () => { const letzter = p.meilensteine[p.meilensteine.length - 1]; if (meilensteinHinzufuegen(p.id, eingabe.value, "", el("projekt-kette").checked && letzter ? letzter.id : null)) el("projekt-meldung").textContent = "Meilenstein hinzugefügt."; }),
      knopf("+ Aufgabe", "Aufgabe im Projekt anlegen: " + p.name, () => { el("projekt-meldung").textContent = projektAufgabe(p.id, eingabe.value) ? `Aufgabe mit Kategorie „${p.name}“ angelegt.` : (PROJEKT.letzterFehler || "Aufgabe nicht angelegt."); PROJEKT.letzterFehler = null; }),
      knopf("Exportieren", "Projekt exportieren: " + p.name, () => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([projektExport(p.id)], { type: "application/json" })), download: "projekt-" + p.name.replace(/[^\wäöüß-]+/gi, "-") + ".json" }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }),
      knopf("Bericht", "Statusbericht exportieren: " + p.name, () => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([projektBericht(p)], { type: "text/markdown" })), download: "projekt-" + p.name.replace(/[^\wäöüß-]+/gi, "-") + ".md" }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }),
      knopf(vorgemerkt ? "Wirklich löschen?" : "Löschen", "Projekt löschen: " + p.name, () => { const r = projektLoeschen(p.id); el("projekt-meldung").textContent = r === "vorgemerkt" ? "Zum Löschen innerhalb von 10 s erneut klicken – Aufgaben und Notizen bleiben erhalten." : r === "geloescht" ? "Projekt gelöscht; Aufgaben und Notizen sind erhalten." : ""; }));
    teile.push(zeile);
    li.append(...teile);
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "Noch kein Projekt. Beispiel: Name „Umzug“ – Aufgaben mit der Kategorie „Umzug“ gehören dann automatisch dazu." })]));
  if (PROJEKT.letzterFehler) { el("projekt-meldung").textContent = PROJEKT.letzterFehler; PROJEKT.letzterFehler = null; }
  projektWocheAnzeigen(jetzt);
  const vl = el("projekt-verlauf");
  vl.replaceChildren(...projektStand.verlauf.slice(-10).reverse().map((v) => Object.assign(document.createElement("li"), { textContent: `${new Date(v.zeit).toLocaleString("de-DE")} · ${v.projekt}: ${v.was}` })));
}
function projektWocheAnzeigen(jetzt = new Date()) {
  const box = document.getElementById("projekt-woche");
  if (!box) return;
  const w = projektWoche(jetzt), z = [];
  if (w.ueberfaellig.length) z.push(Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: "Überfällig: " + w.ueberfaellig.map((e) => `${e.titel} (${e.projekt})`).join(", ") }));
  for (const t of w.tage) if (t.eintraege.length) z.push(Object.assign(document.createElement("li"), { textContent: `${t.datum.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}: ` + t.eintraege.map((e) => `${e.prio === "hoch" ? "❗" : ""}${e.titel} (${e.projekt})`).join(", ") }));
  box.replaceChildren(...(z.length ? z : [Object.assign(document.createElement("li"), { textContent: "In den nächsten 7 Tagen ist in aktiven Projekten nichts fällig." })]));
}
skillRegistrieren({  name: "projekt-status",
  risiko: "abfrage",
  hilfeKurz: "Projekte", // ab 11-09h: in der Hilfe als Sammelzeile
  beschreibung: "Projektstand: Fortschritt, nächster Schritt, Risiken",
  beispiele: ["Wie steht Projekt Umzug?", "Zeige meine Projekte"],
  passt: (text) => /^(wie steht (es um )?(das )?projekt .+|projektstatus .+|status (von |des )?projekt(s)? .+|zeige?( mir)?( meine| die)? projekte|meine projekte)$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    projekteLesen();
    const t = befehlNormalisieren(text), m = /projekt(?:status|s)? (.+)$/.exec(t);
    if (!m || /^(zeige?|meine)/.test(t)) {
      const l = projektStand.projekte.filter((p) => p.status !== "archiviert");
      lokalAntworten(l.length ? "Deine Projekte:\n" + l.map((p) => { const u = projektUebersicht(p); return `• ${p.name} (${p.status}) – ${u.fortschritt} %, nächster Schritt: ${u.naechster ? u.naechster.titel : "–"}${u.risiken.length ? " ⚠ " + u.risiken.join(", ") : ""}`; }).join("\n") : "Noch keine Projekte, Sir. Sag z. B. „Neues Projekt Umzug“.");
      return true;
    }
    const p = projektFinden(m[1]) || projektStand.projekte.find((x) => projektNorm(x.name).includes(m[1].trim()));
    if (!p) { lokalAntworten(`Ein Projekt „${m[1]}“ kenne ich nicht.` + (projektStand.projekte.length ? " Vorhanden: " + projektStand.projekte.map((x) => x.name).join(", ") + "." : "")); return true; }
    const u = projektUebersicht(p);
    lokalAntworten(`Projekt ${p.name} (${p.status}): ${u.fortschritt} % – Aufgaben ${u.erledigt} von ${u.aufgaben}, Meilensteine ${u.meilensteineErledigt} von ${u.meilensteine}. Nächster Schritt: ${u.naechster ? `${u.naechster.art} „${u.naechster.titel}“` : "keiner geplant"}. ${u.risiken.length ? "⚠ " + u.risiken.join("; ") + "." : "Keine Risiken erkannt."}`);
    return true;
  },
});
skillRegistrieren({
  name: "projekt-anlegen",
  risiko: "leicht",
  hilfeKurz: "Neues Projekt", // ab 11-09h
  beschreibung: "Projekt anlegen",
  beispiele: ["Neues Projekt Umzug"],
  passt: (text) => /^(neues projekt|lege (ein )?projekt) \S.{0,60}?( an)?$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const name = String(text).trim().replace(/^\s*(hey\s+)?jarvis[\s,]+/i, "").replace(/^(neues projekt|lege (ein )?projekt)\s*[:,]?\s*/i, "").replace(/\s+an\s*[.!]?$/i, "").replace(/[.!?]+$/, "").trim();
    const r = projektAnlegen({ name });
    lokalAntworten(r.fehler ? r.fehler + " Es wurde nichts angelegt." : `Projekt „${r.projekt.name}“ angelegt. Aufgaben mit der Kategorie „${r.projekt.name}“ gehören automatisch dazu.`);
    const d = document.getElementById("projekt-details");
    if (d && !r.fehler) d.open = true;
    return true;
  },
});
// beide vor die Navigation (sonst würde „Zeige meine Projekte“ nur zur Karte springen)
(function projektSkillsEinordnen() {
  const neu = SKILLS.splice(SKILLS.length - 2, 2), nav = SKILLS.findIndex((x) => x.name === "navigation");
  SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, ...neu);
})();
// Anzeige aktuell halten, wenn sich Aufgaben ändern
if (window.aufgabenIntern && typeof window.aufgabenIntern.anzeigen === "function") {
  const original = window.aufgabenIntern.anzeigen;
  // ab 11-09r: nur neu zeichnen, wenn die Projektplanung offen ist – sonst beim Öffnen (vorher kostete jede Aufgabenanzeige
  // bei 300 Aufgaben rund 19 ms für die geschlossene Projektliste)
  window.aufgabenIntern.anzeigen = function (...a) {
    const r = original.apply(this, a), d = document.getElementById("projekt-details");
    if (d && !d.open) PROJEKT.veraltet = true; else { try { projekteAnzeigen(); } catch (e) { /* Anzeige */ } }
    return r;
  };
}
(function projekteEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("projekt-form")) return;
  el("projekt-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const r = projektAnlegen({ name: el("projekt-name").value, ziel: el("projekt-ziel").value, faellig: el("projekt-faellig").value, beschreibung: el("projekt-beschreibung").value, prio: el("projekt-prio").value, vorlage: el("projekt-vorlage").value });
    el("projekt-meldung").textContent = r.fehler || `Projekt „${r.projekt.name}“ angelegt.`;
    if (!r.fehler) { for (const id of ["projekt-name", "projekt-ziel", "projekt-faellig", "projekt-beschreibung"]) el(id).value = ""; }
  });
  el("projekt-archiv").addEventListener("change", () => projekteAnzeigen());
  el("projekt-details").addEventListener("toggle", () => { if (el("projekt-details").open && PROJEKT.veraltet) { PROJEKT.veraltet = false; projekteAnzeigen(); } });
  // ab 11-09g: Vorlagen, Priorität, Suche/Filter, Import
  el("projekt-vorlage").replaceChildren(...Object.entries(PROJEKT_VORLAGEN).map(([k, v]) => Object.assign(document.createElement("option"), { value: k, textContent: "Vorlage: " + v.name })));
  el("projekt-prio").replaceChildren(...Object.keys(PROJEKT_PRIO).map((k) => Object.assign(document.createElement("option"), { value: k, textContent: "Priorität " + k, selected: k === "normal" })));
  el("projekt-status-filter").replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "alle offenen" }), ...Object.keys(PROJEKT_STATUS).map((k) => Object.assign(document.createElement("option"), { value: k, textContent: "nur " + k })));
  el("projekt-suche").addEventListener("input", () => projekteAnzeigen());
  el("projekt-status-filter").addEventListener("change", () => projekteAnzeigen());
  el("projekt-import").addEventListener("change", async (e) => {
    const datei = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!datei) return;
    if (datei.size > 200000) { el("projekt-meldung").textContent = "Datei zu groß für einen Projektimport."; return; }
    const r = projektImport(await datei.text(), { mitAufgaben: el("projekt-import-aufgaben").checked });
    el("projekt-meldung").textContent = r.fehler ? "Import abgelehnt: " + r.fehler + " – nichts geändert." : `Projekt „${r.projekt.name}“ importiert` + (r.aufgaben ? `, ${r.aufgaben} Aufgabe(n) angelegt.` : ".");
  });
  projekteLesen(); projekteAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("projekte");
