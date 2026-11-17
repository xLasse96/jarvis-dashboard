// JARVIS Dashboard – Modul „workflows“ (ab 11-09l). Workflow-Editor 2.0 = die vorhandenen Routinen (13-routinen.js), erweitert:
//   - besondere Schritte (weiter als Textzeilen – Export/Import und ältere Stände bleiben gültig):
//       „Wenn <Bedingung>: <Befehl>“   bedingte Verzweigung (Bedingung nicht erfüllt → übersprungen)
//       „Freigabe: <Frage>“            manueller Freigabeschritt – der Ablauf hält an, „Freigeben und weiter“ setzt fort
//       „Warte <n> Sekunden“           Wartezustand (1–15 s, abbrechbar)
//       „Versuche <n>×: <Befehl>“      sichere Wiederholung – nur für lesende Befehle, 2–3 Versuche
//     Innere Befehle werden wie jeder Routinenschritt geprüft (nur vorhandene Abfragen/leichte Aktionen); unbekannte Schrittarten
//     und unerlaubte Werkzeuge werden abgelehnt.
//   - Schrittansicht mit Symbol und Prüfung je Zeile, Vorlagen, Testmodus (Trockenlauf ohne Ausführung), Fortschrittsbalken,
//     Pause und Fortsetzen, Ausführungshistorie, Fehlerdiagnose, Versionshistorie mit Vergleich und Wiederherstellen,
//     Wiederaufnahme nach dem Neuladen (der unterbrochene Schritt wird nicht wiederholt)
// Speicher: in den Routinen selbst (versionen, laeufe) und „jarvis-workflow-lauf“ (laufender Stand für die Wiederaufnahme).
const WF = { laufSchluessel: "jarvis-workflow-lauf", maxVersionen: 10, maxLaeufe: 10, maxWarten: 15, freigegeben: new Set(), pause: false, start: 0 };
const WF_BEDINGUNGEN = {
  "aufgaben offen": { text: "Aufgaben offen sind", pruefe: () => Boolean(window.aufgabenIntern && window.aufgabenIntern.liste().some((a) => !a.erledigt)) },
  "aufgaben überfällig": { text: "Aufgaben überfällig sind", pruefe: () => Boolean(window.aufgabenIntern && window.aufgabenIntern.liste().some((a) => !a.erledigt && a.faellig && new Date(a.faellig) < new Date())) },
  verbunden: { text: "der Worker verbunden ist", pruefe: () => typeof verbunden === "function" && verbunden() },
  werktags: { text: "Werktag ist", pruefe: () => ![0, 6].includes(new Date().getDay()) },
  wochenende: { text: "Wochenende ist", pruefe: () => [0, 6].includes(new Date().getDay()) },
  vormittags: { text: "vor 12 Uhr ist", pruefe: () => new Date().getHours() < 12 },
  nachmittags: { text: "ab 12 Uhr ist", pruefe: () => new Date().getHours() >= 12 },
};
const WF_VORLAGEN = {
  morgen: { name: "Morgenroutine 2.0", schritte: ["Briefing", "Wenn Aufgaben überfällig: Zeige meine Aufgaben", "Was steht heute an"] },
  woche: { name: "Wochenabschluss", schritte: ["Zeige meine Projekte", "Freigabe: Auch die nächste Woche ansehen?", "Was habe ich nächste Woche"] },
  feierabend: { name: "Feierabend", schritte: ["Was steht morgen an", "Warte 3 Sekunden", "Gehe zu Notizen"] },
};
// Zerlegt einen Schritt: { art: befehl|wenn|freigabe|warte|versuche, ... } oder { fehler }
function wfSchrittZerlegen(text) {
  const t = String(text || "").trim();
  let m;
  if ((m = /^wenn\s+(.+?)\s*:\s*(.+)$/i.exec(t))) { const b = m[1].toLowerCase().replace(/^(es\s+)?/, "").replace(/\s+(sind|ist)$/, "").trim(); return WF_BEDINGUNGEN[b] ? { art: "wenn", bedingung: b, befehl: m[2].trim() } : { fehler: `unbekannte Bedingung „${m[1]}“ (möglich: ${Object.keys(WF_BEDINGUNGEN).join(", ")})` }; }
  if ((m = /^freigabe\s*:\s*(.{3,100})$/i.exec(t))) return { art: "freigabe", frage: m[1].trim() };
  if ((m = /^warte\s+(\d{1,3})\s*(sekunden?|s)$/i.exec(t))) { const n = Number(m[1]); return n >= 1 && n <= WF.maxWarten ? { art: "warte", sekunden: n } : { fehler: `Warten nur 1–${WF.maxWarten} Sekunden` }; }
  if ((m = /^versuche\s+(\d)\s*(×|x|mal)\s*:\s*(.+)$/i.exec(t))) { const n = Number(m[1]); return n >= 2 && n <= 3 ? { art: "versuche", anzahl: n, befehl: m[3].trim() } : { fehler: "Wiederholen nur 2× oder 3×" }; }
  if (/^(wenn|freigabe|warte|versuche|schleife|springe|gehe zu schritt|goto)\b/i.test(t) && !/^gehe zu (?!schritt)/i.test(t)) return { fehler: "unbekannte oder unvollständige Schrittart" };
  return { art: "befehl", befehl: t };
}
const WF_SYMBOL = { befehl: "▶", wenn: "❓", freigabe: "✋", warte: "⏳", versuche: "🔁" };
// Prüfung erweitern: besondere Schritte als geprüfte Pseudo-Funktion (nicht im Dispatcher, nur in Routinen)
if (typeof routinenSchrittPruefen === "function") {
  const original = routinenSchrittPruefen;
  routinenSchrittPruefen = function (befehl) {
    const z = wfSchrittZerlegen(befehl);
    if (z.fehler) return { fehler: z.fehler };
    if (z.art === "befehl") return original(befehl);
    if (z.art === "freigabe") return { skill: { name: "workflow-freigabe", risiko: "abfrage", beschreibung: "Freigabeschritt: „" + z.frage + "“", aktion: async () => wfFreigabeSchritt(befehl) } };
    if (z.art === "warte") return { skill: { name: "workflow-warte", risiko: "abfrage", beschreibung: `${z.sekunden} Sekunden warten`, aktion: async () => wfWarten(z.sekunden) } };
    const innen = original(z.befehl);
    if (innen.fehler) return { fehler: "innerer Befehl „" + z.befehl + "“: " + innen.fehler };
    if (z.art === "versuche" && skillRisiko(innen.skill) !== "abfrage") return { fehler: "wiederholt werden nur lesende Befehle – „" + z.befehl + "“ ändert etwas" };
    if (z.art === "wenn") return { skill: { name: "workflow-wenn", risiko: innen.skill.risiko, braucht: innen.skill.braucht, beschreibung: `nur wenn ${WF_BEDINGUNGEN[z.bedingung].text}: ${innen.skill.beschreibung}`,
      aktion: async () => { if (!WF_BEDINGUNGEN[z.bedingung].pruefe()) { wfGrund(befehl, "übersprungen – Bedingung nicht erfüllt"); return true; } return innen.skill.aktion(z.befehl); } } };
    return { skill: { name: "workflow-versuche", risiko: "abfrage", braucht: innen.skill.braucht, beschreibung: `bis zu ${z.anzahl}×: ${innen.skill.beschreibung}`,
      aktion: async () => { for (let i = 1; i <= z.anzahl; i++) { try { if (await innen.skill.aktion(z.befehl)) { if (i > 1) wfGrund(befehl, `im ${i}. Versuch erledigt`); return true; } } catch (e) { if (i === z.anzahl) throw e; } } return false; } } };
  };
}
// Grund an den gerade laufenden Schritt hängen (sichtbar in der Ablaufliste)
function wfGrund(befehl, text) { if (!routineLauf) return; const i = routineLauf.status.indexOf("laeuft"); if (i >= 0 && routineLauf.routine.schritte[i] === befehl) routineLauf.gruende[i] = text; }
async function wfWarten(sekunden) {
  const ende = Date.now() + sekunden * 1000;
  while (Date.now() < ende) { if (routineLauf && routineLauf.abbrechen) return true; await new Promise((r) => setTimeout(r, Math.min(200, ende - Date.now()))); }
  return true;
}
// Freigabeschritt: beim ersten Erreichen anhalten (Grund „wartet auf Freigabe“); „Freigeben und weiter“ setzt an dieser Stelle fort
function wfFreigabeSchritt(befehl) {
  const i = routineLauf ? routineLauf.status.indexOf("laeuft") : -1, schl = routineLauf ? routineLauf.routine.id + "#" + i : "";
  if (WF.freigegeben.has(schl)) { WF.freigegeben.delete(schl); wfGrund(befehl, "freigegeben"); return true; }
  routineLauf.wartetFreigabe = i;
  throw new Error("wartet auf Freigabe – „Freigeben und weiter“ wählen (oder Schließen)");
}
function wfFreigeben() {
  const l = routineLauf;
  if (!l || l.laeuft || !Number.isInteger(l.wartetFreigabe)) return false;
  WF.freigegeben.add(l.routine.id + "#" + l.wartetFreigabe);
  const ab = l.wartetFreigabe; l.wartetFreigabe = null;
  routineAusfuehren(ab);
  return true;
}
function wfPausieren() { if (!routineLauf || !routineLauf.laeuft) return false; WF.pause = true; routineLauf.abbrechen = true; document.getElementById("routine-meldung").textContent = "Wird nach dem laufenden Schritt angehalten …"; return true; }
function wfFortsetzen() {
  const l = routineLauf;
  if (!l || l.laeuft) return false;
  const ab = l.status.findIndex((s) => s === "offen" || s === "abgebrochen");
  if (ab < 0) return false;
  for (let i = ab; i < l.status.length; i++) l.status[i] = "offen";
  routineAusfuehren(ab);
  return true;
}
// Lauf: Historie, Fortschritt merken (Wiederaufnahme nach Neuladen), Pause statt Abbruch
if (typeof routineAusfuehren === "function") {
  const original = routineAusfuehren;
  routineAusfuehren = async function (ab = 0) {
    const l = routineLauf;
    if (!l || l.laeuft) return original(ab);
    const t0 = Date.now();
    const e = await original(ab);
    const r = routinen.find((x) => x.id === l.routine.id);
    const pause = WF.pause; WF.pause = false;
    if (pause && e && e.abgebrochen) { l.status = l.status.map((s) => (s === "abgebrochen" ? "offen" : s)); l.pausiert = true; document.getElementById("routine-meldung").textContent = "Angehalten – „Fortsetzen“ macht beim nächsten offenen Schritt weiter."; }
    if (r && e) {
      const f = l.status.indexOf("fehlgeschlagen");
      const ergebnis = Number.isInteger(l.wartetFreigabe) ? "wartet auf Freigabe" : pause ? "angehalten" : e.ok ? "abgeschlossen" : e.abgebrochen ? "abgebrochen" : "fehlgeschlagen";
      r.laeufe = [{ zeit: new Date(t0).toISOString(), dauerMs: Date.now() - t0, ergebnis, schritt: f >= 0 ? f + 1 : null, grund: f >= 0 ? l.gruende[f] : "" }, ...(r.laeufe || [])].slice(0, WF.maxLaeufe);
      routinenSpeichern();
    }
    if (pause) routineAblaufAnzeigen();
    wfLaufMerken();
    wfAnzeigen();
    return e;
  };
}
function wfLaufMerken() {
  try {
    const l = routineLauf;
    if (!l || !l.gestartet || (!l.laeuft && !l.status.some((s) => s === "offen" || s === "laeuft" || s === "fehlgeschlagen"))) { localStorage.removeItem(WF.laufSchluessel); return; }
    localStorage.setItem(WF.laufSchluessel, JSON.stringify({ art: "jarvis-workflow-lauf", routineId: l.routine.id, name: l.routine.name, schritte: l.routine.schritte, status: l.status, zeit: new Date().toISOString() }));
  } catch (e) { /* nur Komfort */ }
}
if (typeof routineAblaufAnzeigen === "function") {
  const original = routineAblaufAnzeigen;
  routineAblaufAnzeigen = function () {
    original();
    const l = routineLauf, el = (id) => document.getElementById(id);
    if (!l || !el("routine-fortschritt")) return;
    const fertig = l.status.filter((s) => s === "erledigt" || s === "uebersprungen").length;
    el("routine-fortschritt").max = l.status.length; el("routine-fortschritt").value = fertig;
    el("routine-fortschritt-text").textContent = `${fertig} von ${l.status.length} Schritten`;
    const wartet = Number.isInteger(l.wartetFreigabe) && !l.laeuft;
    el("routine-freigeben").hidden = !wartet;
    el("routine-pausieren").hidden = !l.laeuft;
    el("routine-weiter").hidden = l.laeuft || !l.pausiert || !l.status.includes("offen");
    if (wartet) {
      const li = el("routine-schrittliste").children[l.wartetFreigabe];
      if (li) { li.className = "wartet"; li.textContent = li.textContent.replace("fehlgeschlagen: ", "wartet auf Freigabe: ").replace(/: wartet auf Freigabe – .*$/, ""); }
      el("routine-fortsetzen").hidden = true;
    }
    if (l.laeuft) wfLaufMerken();
  };
}
// Wiederaufnahme nach dem Neuladen: der unterbrochene Schritt gilt als unbekannt und wird nicht wiederholt
function wfUnterbrochen() {
  const d = speicherJsonLesen(WF.laufSchluessel, (x) => istObjekt(x) && x.art === "jarvis-workflow-lauf" && Array.isArray(x.status));
  if (!d) return null;
  const r = routinen.find((x) => x.id === d.routineId);
  if (!r || JSON.stringify(r.schritte) !== JSON.stringify(d.schritte)) return { ...d, ungueltig: true };
  const lief = d.status.indexOf("laeuft");
  return { ...d, lief, ab: lief >= 0 ? lief + 1 : d.status.findIndex((s) => s === "offen" || s === "fehlgeschlagen") };
}
function wfWiederaufnehmen() {
  const u = wfUnterbrochen();
  if (!u || u.ungueltig || u.ab < 0 || u.ab >= u.schritte.length) { try { localStorage.removeItem(WF.laufSchluessel); } catch (e) { /* */ } wfAnzeigen(); return false; }
  if (!routineVorschau(u.routineId)) return false;
  for (let i = 0; i < u.ab; i++) routineLauf.status[i] = i === u.lief ? "uebersprungen" : u.status[i] === "erledigt" || u.status[i] === "uebersprungen" ? "erledigt" : "offen";
  if (u.lief >= 0) routineLauf.gruende[u.lief] = "beim Neuladen unterbrochen – nicht wiederholt";
  routineLauf.gestartet = true;
  routineAusfuehren(u.ab);
  return true;
}
// ---------- Testmodus (Trockenlauf) ----------
function wfTrockenlauf(id) {
  const r = routinen.find((x) => x.id === id);
  if (!r) return [];
  return r.schritte.map((s, i) => {
    const z = wfSchrittZerlegen(s), p = routinenSchrittPruefen(s);
    if (p.fehler) return { nr: i + 1, text: s, ergebnis: "✖ " + p.fehler };
    const bed = z.art === "wenn" ? (WF_BEDINGUNGEN[z.bedingung].pruefe() ? " – Bedingung jetzt erfüllt" : " – Bedingung jetzt nicht erfüllt (würde übersprungen)") : "";
    const dazu = p.skill.braucht === "verbindung" && !verbunden() ? " – braucht die Worker-Verbindung (fehlt)" : p.skill.braucht === "helfer" && !helferEingerichtet() ? " – braucht den PC-Helfer (fehlt)" : "";
    return { nr: i + 1, text: s, ergebnis: `${WF_SYMBOL[z.art]} ${p.skill.beschreibung}${bed}${dazu}${z.art === "freigabe" ? " – hält an und wartet" : ""}` };
  });
}
// ---------- Versionen ----------
if (typeof routineSpeichernAusForm === "function") {
  const original = routineSpeichernAusForm;
  routineSpeichernAusForm = function () {
    const alt = routineBearbeitet ? routinen.find((x) => x.id === routineBearbeitet) : null;
    const vorher = alt ? { zeit: alt.geaendert, name: alt.name, schritte: alt.schritte.slice() } : null;
    const ok = original();
    if (ok && alt && vorher && (vorher.name !== alt.name || JSON.stringify(vorher.schritte) !== JSON.stringify(alt.schritte))) {
      alt.versionen = [vorher, ...(alt.versionen || [])].slice(0, WF.maxVersionen);
      routinenSpeichern(); routinenAnzeigen();
    }
    return ok;
  };
}
function wfVersionWiederherstellen(id, index) {
  const r = routinen.find((x) => x.id === id), v = r && (r.versionen || [])[index];
  if (!r || !v || (routineLauf && routineLauf.laeuft && routineLauf.routine.id === id)) return { fehler: "nicht möglich" };
  routineBearbeitet = r.id;
  const f = routinePruefen(v.name, v.schritte);
  routineBearbeitet = null;
  if (f.length) return { fehler: "Version passt nicht mehr: " + f[0] };
  r.versionen = [{ zeit: r.geaendert, name: r.name, schritte: r.schritte.slice() }, ...r.versionen.filter((_, i) => i !== index)].slice(0, WF.maxVersionen);
  Object.assign(r, { name: v.name, schritte: v.schritte.slice(), geaendert: new Date().toISOString() });
  routinenSpeichern(); routinenAnzeigen();
  return { routine: r };
}
function wfVergleich(id, index) {
  const r = routinen.find((x) => x.id === id), v = r && (r.versionen || [])[index];
  return r && v && typeof dokVergleich === "function" ? dokVergleich(v.schritte.join("\n"), r.schritte.join("\n")) : null;
}
// ---------- Anzeige ----------
function wfSchrittAnsicht() {
  const box = document.getElementById("routine-schrittansicht"), feld = document.getElementById("routine-schritte");
  if (!box || !feld) return;
  const zeilen = schritteAusText(feld.value);
  box.replaceChildren(...zeilen.map((s, i) => { const z = wfSchrittZerlegen(s), p = routinenSchrittPruefen(s); return Object.assign(document.createElement("li"), { className: p.fehler ? "wz-wichtig" : "", textContent: `${i + 1}. ${z.art ? WF_SYMBOL[z.art] : "✖"} ${s} → ${p.fehler ? "✖ " + p.fehler : p.skill.beschreibung}` }); }));
}
function wfAnzeigen() {
  const el = (id) => document.getElementById(id);
  for (const li of document.querySelectorAll("#routinen-liste li[data-id]")) {
    const r = routinen.find((x) => x.id === li.dataset.id);
    if (!r || li.querySelector(".wf-info")) continue;
    const letzter = (r.laeufe || [])[0];
    li.append(Object.assign(document.createElement("span"), { className: "aufgabe-faellig wf-info", textContent: (letzter ? `zuletzt: ${letzter.ergebnis} (${new Date(letzter.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })})` + (letzter.schritt ? ` bei Schritt ${letzter.schritt}: ${letzter.grund}` : "") : "noch nie gelaufen") + ((r.versionen || []).length ? ` · ${r.versionen.length} frühere Version(en)` : "") }));
    const k = (t, f) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: t }); b.setAttribute("aria-label", t + ": " + r.name); b.addEventListener("click", f); return b; };
    li.append(k("Testen", () => { el("wf-ergebnis").replaceChildren(Object.assign(document.createElement("p"), { className: "klein", textContent: `Testmodus „${r.name}“ – es wird nichts ausgeführt:` }), Object.assign(document.createElement("ol"), {})); el("wf-ergebnis").querySelector("ol").append(...wfTrockenlauf(r.id).map((x) => Object.assign(document.createElement("li"), { textContent: `${x.text} → ${x.ergebnis}` }))); el("wf-ergebnis").hidden = false; }),
      k("Verlauf", () => { const p = Object.assign(document.createElement("ol"), {}); p.append(...((r.laeufe || []).length ? r.laeufe : [null]).map((x) => Object.assign(document.createElement("li"), { textContent: x ? `${new Date(x.zeit).toLocaleString("de-DE")} · ${x.ergebnis} · ${(x.dauerMs / 1000).toFixed(1)} s` + (x.schritt ? ` · Schritt ${x.schritt}: ${x.grund}` : "") : "Noch keine Läufe." })));
        const v = Object.assign(document.createElement("ol"), {}); v.append(...(r.versionen || []).map((x, i) => { const li2 = Object.assign(document.createElement("li"), { textContent: `${new Date(x.zeit).toLocaleString("de-DE")}: ${x.name} (${x.schritte.length} Schritte) ` }); const cmp = wfVergleich(r.id, i); if (cmp) li2.append(Object.assign(document.createElement("span"), { className: "klein", textContent: `– ggü. jetzt: ${cmp.neu} neu, ${cmp.weg} entfernt ` })); const b = k("Wiederherstellen", () => { const x2 = wfVersionWiederherstellen(r.id, i); el("routine-meldung").textContent = x2.fehler || `Version wiederhergestellt („${x2.routine.name}“) – die bisherige ist in der Versionsliste.`; el("wf-ergebnis").hidden = true; }); b.setAttribute("aria-label", `Version ${i + 1} wiederherstellen: ${r.name}`); li2.append(b); return li2; }));
        el("wf-ergebnis").replaceChildren(Object.assign(document.createElement("p"), { className: "klein", textContent: `Ausführungen „${r.name}“:` }), p, Object.assign(document.createElement("p"), { className: "klein", textContent: (r.versionen || []).length ? "Frühere Versionen:" : "Keine früheren Versionen." }), v); el("wf-ergebnis").hidden = false; }));
  }
  const u = wfUnterbrochen(), box = el("wf-unterbrochen");
  if (box) {
    box.hidden = !u || (routineLauf && routineLauf.laeuft);
    if (u) el("wf-unterbrochen-text").textContent = u.ungueltig ? `Ein unterbrochener Lauf von „${u.name}“ passt nicht mehr zur Routine (geändert oder gelöscht) – kann nur verworfen werden.` : `Unterbrochener Lauf „${u.name}“ (${new Date(u.zeit).toLocaleString("de-DE")})` + (u.lief >= 0 ? `: Schritt ${u.lief + 1} lief beim Neuladen – er wird nicht wiederholt.` : ".") + ` Fortsetzen ab Schritt ${u.ab + 1}?`;
    el("wf-fortsetzen").hidden = Boolean(u && u.ungueltig);
  }
}
if (typeof routinenAnzeigen === "function") { const original = routinenAnzeigen; routinenAnzeigen = function () { original(); wfAnzeigen(); }; }
if (typeof routineFormPruefen === "function") { const original = routineFormPruefen; routineFormPruefen = function () { const f = original(); wfSchrittAnsicht(); return f; }; }
(function wfEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("routine-fortschritt")) return;
  el("routine-freigeben").addEventListener("click", wfFreigeben);
  el("routine-pausieren").addEventListener("click", wfPausieren);
  el("routine-weiter").addEventListener("click", wfFortsetzen);
  el("wf-fortsetzen").addEventListener("click", wfWiederaufnehmen);
  el("wf-verwerfen").addEventListener("click", () => { try { localStorage.removeItem(WF.laufSchluessel); } catch (e) { /* */ } wfAnzeigen(); });
  el("wf-vorlage").replaceChildren(...Object.entries(WF_VORLAGEN).map(([k, v]) => Object.assign(document.createElement("option"), { value: k, textContent: v.name })));
  el("wf-vorlage-uebernehmen").addEventListener("click", () => { const v = WF_VORLAGEN[el("wf-vorlage").value]; routineFormZeigen(null); el("routine-name").value = v.name; el("routine-schritte").value = v.schritte.join("\n"); routineFormPruefen(); });
  routinenAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("workflows");
