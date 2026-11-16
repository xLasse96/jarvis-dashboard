// JARVIS Dashboard – Modul „routinen“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Routinen: mehrere vorhandene Skills unter einem Namen (nur auf diesem Gerät) ----------
// Ein Schritt ist ein Befehlstext, der zu einem vorhandenen Skill passen muss. Erlaubt sind nur Abfragen und leicht
// rückgängig zu machende Aktionen; folgenreiche (Bestätigung nötig) und gesperrte Skills sind in Routinen verboten.
// Schritte laufen direkt über den Skill – nie über die KI, damit keine Fähigkeit vorgetäuscht wird.
// Ablauf: Vorschau → Start → Fortschritt je Schritt (Zeitlimit, abbrechbar). Nach einem Fehler: „ab dem fehlgeschlagenen
// Schritt fortsetzen“ (erledigte Schritte werden nicht wiederholt) oder ausdrücklich „von vorn“.
const ROUTINEN = { schluessel: "jarvis-routinen", beispieleSchluessel: "jarvis-routinen-beispiele", zeitlimitMs: 20000, maxSchritte: 12 };
const ROUTINE_BEISPIELE = [
  { name: "Morgenübersicht", schritte: ["Briefing", "Paper Kontostand", "Zeige die Analyse"] },
  { name: "Projektstart", schritte: ["Briefing", "Systeminfo", "Öffne den Editor"] },
];
let routinen = [];
let routineBearbeitet = null;
let routineLauf = null; // { routine, status[], gruende[], aktuell, abbrechen, laeuft }
let routineSpeicherOk = true;

function routinenLaden() {
  try {
    const daten = speicherJsonLesen(ROUTINEN.schluessel, Array.isArray);
    routinen = Array.isArray(daten) ? daten.filter((r) => r && typeof r.id === "string" && typeof r.name === "string" && Array.isArray(r.schritte)) : [];
    if (!daten && !speicherBeschaedigt(ROUTINEN.schluessel) && localStorage.getItem(ROUTINEN.beispieleSchluessel) !== "ja") {
      routinen = ROUTINE_BEISPIELE.map((b, i) => routineNeu(b.name, b.schritte, "beispiel-" + i));
      localStorage.setItem(ROUTINEN.beispieleSchluessel, "ja");
      routinenSpeichern();
    }
  } catch (e) {
    routineSpeicherOk = false;
    routinen = ROUTINE_BEISPIELE.map((b, i) => routineNeu(b.name, b.schritte, "beispiel-" + i));
  }
}

function routinenSpeichern() {
  if (speicherBeschaedigt(ROUTINEN.schluessel)) { routineSpeicherOk = false; return; }
  try { localStorage.setItem(ROUTINEN.schluessel, JSON.stringify(routinen)); routineSpeicherOk = true; } catch (e) { routineSpeicherOk = false; }
}

function routineNeu(name, schritte, id) {
  const jetzt = new Date().toISOString();
  return { id: id || "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, schritte: schritte.slice(), erstellt: jetzt, geaendert: jetzt };
}

// Prüft einen Schritt gegen die vorhandenen Skills: { skill } oder { fehler }
function routinenSchrittPruefen(befehl) {
  const text = String(befehl || "").trim();
  if (!text) return { fehler: "leerer Schritt" };
  if (text.length > 120) return { fehler: "zu lang" };
  const skill = SKILLS.find((s) => s.name !== "routine" && s.passt(text));
  if (!skill) return { fehler: "keine passende JARVIS-Funktion (Routinen nutzen nur vorhandene lokale Befehle)" };
  if (skillRisiko(skill) === "gesperrt") return { fehler: skill.risiko === "gesperrt" ? "gesperrt – nie automatisch" : "in Ihren Freigaben ausgeschaltet" };
  if (skill.name === "recherche") return { fehler: "Recherche (kostenpflichtige KI-Anfrage) nur auf ausdrücklichen Einzelbefehl, nicht in Routinen" };
  if (skill.name === "paper") {
    const p = paperBefehlErkennen(text);
    if (!p || !["stand", "positionen", "beides"].includes(p.art)) return { fehler: "Paper-Orders brauchen eine Bestätigung und sind in Routinen nicht erlaubt" };
    return { skill };
  }
  if (skillRisiko(skill) === "bestaetigen") return { fehler: "braucht eine Bestätigung und ist in Routinen nicht erlaubt" };
  return { skill };
}

function routinePruefen(name, schritte) {
  const fehler = [];
  if (!String(name || "").trim()) fehler.push("Name fehlt.");
  if (!schritte.length) fehler.push("Mindestens ein Schritt.");
  if (schritte.length > ROUTINEN.maxSchritte) fehler.push("Höchstens " + ROUTINEN.maxSchritte + " Schritte.");
  schritte.forEach((s, i) => { const r = routinenSchrittPruefen(s); if (r.fehler) fehler.push("Schritt " + (i + 1) + " „" + s + "“: " + r.fehler + "."); });
  const doppelt = routinen.find((r) => r.name.toLowerCase() === String(name).trim().toLowerCase() && r.id !== routineBearbeitet);
  if (doppelt) fehler.push("Eine Routine „" + doppelt.name + "“ gibt es schon.");
  return fehler;
}

function schritteAusText(text) { return String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean); }

// ab 11-06h: Tagesfortschritt – „täglich“ markierte, aktive Routinen, heute vollständig gelaufen
const routineHeuteErledigt = (r, jetzt = Date.now()) => Boolean(r.zuletztAbgeschlossen && new Date(r.zuletztAbgeschlossen).toDateString() === new Date(jetzt).toDateString());
function routinenFortschritt(jetzt = Date.now()) {
  const taeglich = routinen.filter((r) => r.taeglich && !r.pausiert);
  return { gesamt: taeglich.length, erledigt: taeglich.filter((r) => routineHeuteErledigt(r, jetzt)).length, offen: taeglich.filter((r) => !routineHeuteErledigt(r, jetzt)).map((r) => r.name), pausiert: routinen.filter((r) => r.pausiert).length };
}
// ---------- Serien und verpasste Tage (ab 11-07e) ----------
// abschluesse: Kalendertage (Ortszeit, „JJJJ-MM-TT“) mit vollständigem Lauf, höchstens 90. Gezählt wird erst ab dem ersten
// gemerkten Abschluss – frühere Tage sind unbekannt (vor 11-07e gab es nur „zuletztAbgeschlossen“) und gelten nie als verpasst.
const ROUTINE_TAGE = { max: 90, fenster: 7 };
const routineTag = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
function routineAbschlussMerken(r, jetzt = Date.now()) {
  const tage = Array.isArray(r.abschluesse) ? r.abschluesse.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t)) : [];
  if (!tage.includes(routineTag(jetzt))) tage.push(routineTag(jetzt));
  r.abschluesse = tage.sort().slice(-ROUTINE_TAGE.max);
}
// { serie, letzte7, verpasst: [Tag] } – Serie zählt bis heute bzw. bis gestern, solange heute noch offen ist
function routineStatistik(r, jetzt = Date.now()) {
  const tage = new Set(Array.isArray(r.abschluesse) ? r.abschluesse : []);
  const tagVor = (n) => { const d = new Date(jetzt); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return routineTag(d.getTime()); };
  let serie = 0;
  for (let n = tage.has(tagVor(0)) ? 0 : 1; tage.has(tagVor(n)); n++) serie++;
  const letzte7 = Array.from({ length: ROUTINE_TAGE.fenster }, (_, n) => tagVor(n)).filter((t) => tage.has(t)).length;
  const erster = [...tage].sort()[0];
  const verpasst = r.taeglich && !r.pausiert && erster ? Array.from({ length: ROUTINE_TAGE.fenster }, (_, n) => tagVor(n + 1)).filter((t) => t > erster && !tage.has(t)).reverse() : [];
  return { serie, letzte7, verpasst };
}
function routinenVerpasst(jetzt = Date.now()) { return routinen.map((r) => ({ name: r.name, tage: routineStatistik(r, jetzt).verpasst })).filter((x) => x.tage.length); }
function routineUmschalten(id, feld) {
  const r = routinen.find((x) => x.id === id);
  if (!r || (routineLauf && routineLauf.laeuft && routineLauf.routine.id === id)) return null;
  r[feld] = !r[feld];
  r.geaendert = new Date().toISOString();
  routinenSpeichern();
  routinenAnzeigen();
  document.getElementById("routine-meldung").textContent = feld === "pausiert" ? `„${r.name}“ ${r.pausiert ? "pausiert" : "aktiviert"}.` : `„${r.name}“ ${r.taeglich ? "zählt jetzt als tägliche Routine" : "ist keine tägliche Routine mehr"}.`;
  return r[feld];
}
function routinenAnzeigen() {
  const liste = document.getElementById("routinen-liste");
  const f = routinenFortschritt();
  const fortschritt = document.getElementById("routinen-fortschritt");
  const verpasst = routinenVerpasst();
  if (fortschritt) fortschritt.textContent = (f.gesamt ? `Tägliche Routinen heute: ${f.erledigt} von ${f.gesamt} erledigt` + (f.offen.length ? ` – offen: ${f.offen.join(", ")}` : " ✓") + (f.pausiert ? ` · ${f.pausiert} pausiert` : "") : "Keine tägliche Routine markiert (in der Liste „Täglich“ wählen)." + (f.pausiert ? ` · ${f.pausiert} pausiert` : ""))
    + (verpasst.length ? " · verpasst (7 Tage): " + verpasst.map((v) => `${v.name} (${v.tage.length})`).join(", ") : "");
  liste.replaceChildren(...(routinen.length ? routinen.map((r) => {
    const li = document.createElement("li");
    li.dataset.id = r.id;
    li.classList.toggle("erledigt", Boolean(r.pausiert));
    const text = Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: r.name + " (" + r.schritte.length + " Schritte)" + (r.pausiert ? " · pausiert" : "") + (r.taeglich ? (routineHeuteErledigt(r) ? " · täglich, heute erledigt ✓" : " · täglich, heute offen") : "") });
    const st = routineStatistik(r);
    const stand = Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: "geändert " + new Date(r.geaendert).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })
      + (Array.isArray(r.abschluesse) && r.abschluesse.length ? ` · Serie ${st.serie} Tag(e) · in 7 Tagen ${st.letzte7}× abgeschlossen` : "") });
    const knopf = (beschriftung, aktion) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: beschriftung });
      b.setAttribute("aria-label", beschriftung + ": " + r.name);
      b.addEventListener("click", aktion);
      return b;
    };
    const starten = knopf("Starten", () => routineVorschau(r.id));
    starten.disabled = Boolean(r.pausiert);
    li.append(text, stand, starten, knopf(r.pausiert ? "Aktivieren" : "Pausieren", () => routineUmschalten(r.id, "pausiert")), knopf(r.taeglich ? "Nicht täglich" : "Täglich", () => routineUmschalten(r.id, "taeglich")),
      knopf("Bearbeiten", () => routineBearbeiten(r.id)), knopf("Kopieren", () => routineKopieren(r.id)), knopf("Löschen", () => routineLoeschen(r.id)));
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: speicherBeschaedigt(ROUTINEN.schluessel) ? "Keine Routinen geladen – " + SPEICHER_SCHADEN_TEXT : routineSpeicherOk ? "Keine Routinen." : "Browserspeicher gesperrt – Routinen gehen beim Neuladen verloren." })]));
}

function routineFormZeigen(r) {
  routineBearbeitet = r ? r.id : null;
  document.getElementById("routine-form").hidden = false;
  document.getElementById("routine-name").value = r ? r.name : "";
  document.getElementById("routine-schritte").value = r ? r.schritte.join("\n") : "";
  routineFormPruefen();
  document.getElementById("routine-name").focus();
}

function routineFormPruefen() {
  const fehler = routinePruefen(document.getElementById("routine-name").value, schritteAusText(document.getElementById("routine-schritte").value));
  document.getElementById("routine-pruefung").textContent = fehler.length ? fehler.join(" ") : "Alle Schritte gehören zu vorhandenen JARVIS-Funktionen.";
  document.getElementById("routine-speichern").disabled = fehler.length > 0;
  return fehler;
}

function routineSpeichernAusForm() {
  const name = document.getElementById("routine-name").value.trim().slice(0, 60);
  const schritte = schritteAusText(document.getElementById("routine-schritte").value);
  if (routineFormPruefen().length) return false;
  if (routineBearbeitet) {
    const r = routinen.find((x) => x.id === routineBearbeitet);
    Object.assign(r, { name, schritte, geaendert: new Date().toISOString() });
  } else {
    routinen.push(routineNeu(name, schritte));
  }
  routineBearbeitet = null;
  document.getElementById("routine-form").hidden = true;
  routinenSpeichern();
  routinenAnzeigen();
  return true;
}

function routineBearbeiten(id) { routineFormZeigen(routinen.find((r) => r.id === id)); }

function routineKopieren(id) {
  const r = routinen.find((x) => x.id === id);
  if (!r) return;
  let name = r.name + " (Kopie)";
  for (let n = 2; routinen.some((x) => x.name === name); n++) name = r.name + " (Kopie " + n + ")";
  routinen.push(routineNeu(name.slice(0, 60), r.schritte));
  routinenSpeichern();
  routinenAnzeigen();
}

function routineLoeschen(id) {
  const r = routinen.find((x) => x.id === id);
  if (!r || (routineLauf && routineLauf.laeuft && routineLauf.routine.id === id)) return;
  if (!confirm("Routine löschen?\n\n" + r.name)) return;
  routinen = routinen.filter((x) => x.id !== id);
  routinenSpeichern();
  routinenAnzeigen();
}

// ---------- Ablauf ----------
const ROUTINE_STATUS_TEXT = { offen: "wartet", laeuft: "läuft …", erledigt: "erledigt", fehlgeschlagen: "fehlgeschlagen", uebersprungen: "übersprungen (bereits erledigt)", abgebrochen: "nicht ausgeführt (abgebrochen)" };

function routineAblaufAnzeigen() {
  const lauf = routineLauf;
  document.getElementById("routine-ablauf").hidden = false;
  document.getElementById("routine-ablauf-titel").textContent = "Ablauf: " + lauf.routine.name;
  document.getElementById("routine-schrittliste").replaceChildren(...lauf.routine.schritte.map((s, i) => {
    const li = document.createElement("li");
    li.className = lauf.status[i];
    const p = routinenSchrittPruefen(s);
    li.textContent = s + " – " + (p.skill ? p.skill.beschreibung + " [" + RISIKO_TEXT[p.skill.risiko] + "]" : "nicht mehr verfügbar") + " · " + ROUTINE_STATUS_TEXT[lauf.status[i]] + (lauf.gruende[i] ? ": " + lauf.gruende[i] : "");
    return li;
  }));
  const fehler = lauf.status.indexOf("fehlgeschlagen");
  document.getElementById("routine-start").hidden = lauf.laeuft || lauf.gestartet;
  document.getElementById("routine-stopp").hidden = !lauf.laeuft;
  document.getElementById("routine-fortsetzen").hidden = lauf.laeuft || fehler < 0;
  document.getElementById("routine-von-vorn").hidden = lauf.laeuft || !lauf.gestartet;
  document.getElementById("routine-schliessen").disabled = lauf.laeuft;
}

function routineVorschau(id) {
  if (routineLauf && routineLauf.laeuft) return null;
  const routine = routinen.find((r) => r.id === id);
  if (!routine) return null;
  // ab 11-06h: pausierte Routinen starten nicht (erst „Aktivieren“)
  if (routine.pausiert) { document.getElementById("routine-meldung").textContent = "„" + routine.name + "“ ist pausiert – erst „Aktivieren“ wählen. Es wurde nichts ausgeführt."; return null; }
  routineLauf = { routine, status: routine.schritte.map(() => "offen"), gruende: [], laeuft: false, gestartet: false, abbrechen: false };
  const ungueltig = routine.schritte.map(routinenSchrittPruefen).findIndex((p) => p.fehler);
  document.getElementById("routine-meldung").textContent = ungueltig >= 0
    ? "Schritt " + (ungueltig + 1) + " ist nicht (mehr) erlaubt – bitte die Routine bearbeiten."
    : "Vorschau: " + routine.schritte.length + " Schritte laufen nacheinander. Abbrechen ist jederzeit möglich.";
  routineAblaufAnzeigen();
  document.getElementById("routine-start").disabled = ungueltig >= 0;
  return routineLauf;
}

function mitZeitlimit(versprechen, ms) {
  return Promise.race([versprechen, new Promise((_, nein) => setTimeout(() => nein(new Error("Zeitüberschreitung nach " + Math.round(ms / 1000) + " s")), ms))]);
}

// ab = Index des ersten auszuführenden Schritts; frühere Schritte gelten als bereits erledigt (Fortsetzen)
async function routineAusfuehren(ab = 0) {
  const lauf = routineLauf;
  if (!lauf || lauf.laeuft) return null;
  lauf.laeuft = true;
  lauf.gestartet = true;
  lauf.abbrechen = false;
  for (let i = 0; i < lauf.routine.schritte.length; i++) {
    if (i < ab) { if (lauf.status[i] === "erledigt" || lauf.status[i] === "uebersprungen") lauf.status[i] = "uebersprungen"; continue; }
    lauf.status[i] = "offen";
    lauf.gruende[i] = "";
  }
  routineAblaufAnzeigen();
  const meldung = document.getElementById("routine-meldung");
  for (let i = ab; i < lauf.routine.schritte.length; i++) {
    if (lauf.abbrechen) { for (let j = i; j < lauf.routine.schritte.length; j++) lauf.status[j] = "abgebrochen"; break; }
    const befehl = lauf.routine.schritte[i];
    const p = routinenSchrittPruefen(befehl);
    lauf.status[i] = "laeuft";
    meldung.textContent = "Schritt " + (i + 1) + " von " + lauf.routine.schritte.length + ": " + befehl;
    routineAblaufAnzeigen();
    let grund = null;
    if (p.fehler) grund = p.fehler;
    else if (p.skill.braucht === "verbindung" && !verbunden()) grund = "braucht die Worker-Verbindung";
    else if (p.skill.braucht === "helfer" && !helferEingerichtet()) grund = "braucht den PC-Helfer";
    else {
      const fehlerVorher = lokaleFehler.zaehler;
      try {
        const erledigt = await mitZeitlimit(Promise.resolve(p.skill.aktion(befehl)), ROUTINEN.zeitlimitMs);
        if (!erledigt) grund = "Funktion hat den Schritt nicht ausgeführt";
        else if (lokaleFehler.zaehler > fehlerVorher) grund = lokaleFehler.letzter || "Fehler gemeldet";
      } catch (e) {
        grund = e.message;
      }
    }
    if (grund) {
      lauf.status[i] = "fehlgeschlagen";
      lauf.gruende[i] = grund;
      for (let j = i + 1; j < lauf.routine.schritte.length; j++) lauf.status[j] = "offen";
      meldung.textContent = "Schritt " + (i + 1) + " „" + befehl + "“ ist fehlgeschlagen: " + grund + ". Die folgenden Schritte wurden nicht ausgeführt.";
      lauf.laeuft = false;
      routineAblaufAnzeigen();
      return { ok: false, schritt: i };
    }
    lauf.status[i] = "erledigt";
    routineAblaufAnzeigen();
  }
  lauf.laeuft = false;
  // ab 11-06h: vollständiger Lauf zählt für den Tagesfortschritt (nicht bei Abbruch)
  if (!lauf.status.includes("abgebrochen")) { lauf.routine.zuletztAbgeschlossen = new Date().toISOString(); routineAbschlussMerken(lauf.routine); routinenSpeichern(); routinenAnzeigen(); }
  meldung.textContent = lauf.status.includes("abgebrochen")
    ? "Abgebrochen – erledigte Schritte bleiben erledigt, die übrigen wurden nicht ausgeführt."
    : "Routine „" + lauf.routine.name + "“ abgeschlossen.";
  routineAblaufAnzeigen();
  return { ok: !lauf.status.includes("abgebrochen"), abgebrochen: lauf.status.includes("abgebrochen") };
}

// Fehlermeldungen im Gesprächsverlauf mitzählen (jede Nachricht der Art „fehler“, egal von welchem Skill)
const lokaleFehler = { zaehler: 0, letzter: "" };
{
  const original = nachrichtAnzeigen;
  nachrichtAnzeigen = function (text, art) {
    if (art && String(art).includes("fehler")) { lokaleFehler.zaehler++; lokaleFehler.letzter = String(text).replace(/^JARVIS: /, "").slice(0, 160); }
    return original(text, art);
  };
}

// ---------- Export / Import ----------
function routinenExportText() {
  return JSON.stringify({ art: "jarvis-routinen", version: 1, exportiert: new Date().toISOString(), routinen: routinen.map((r) => ({ name: r.name, schritte: r.schritte })) }, null, 2);
}

function routinenExportieren() {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([routinenExportText()], { type: "application/json" }));
  link.download = "jarvis-routinen-" + new Date().toISOString().slice(0, 10) + ".json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Gibt { neu, uebersprungen: [Gründe] } zurück; ungültige Routinen werden nicht übernommen
function routinenImportieren(text) {
  let daten;
  try { daten = JSON.parse(text); } catch (e) { return { fehler: "Die Datei ist kein gültiges JSON." }; }
  if (!daten || daten.art !== "jarvis-routinen" || !Array.isArray(daten.routinen)) return { fehler: "Keine JARVIS-Routinen-Datei." };
  const ergebnis = { neu: 0, uebersprungen: [] };
  for (const r of daten.routinen.slice(0, 50)) {
    const name = String((r && r.name) || "").trim().slice(0, 60);
    const schritte = Array.isArray(r && r.schritte) ? r.schritte.map((s) => String(s).trim()).filter(Boolean) : [];
    routineBearbeitet = null;
    const fehler = routinePruefen(name, schritte);
    if (fehler.length) { ergebnis.uebersprungen.push((name || "ohne Namen") + ": " + fehler[0]); continue; }
    routinen.push(routineNeu(name, schritte));
    ergebnis.neu++;
  }
  routinenSpeichern();
  routinenAnzeigen();
  return ergebnis;
}

document.getElementById("routine-neu").addEventListener("click", () => routineFormZeigen(null));
document.getElementById("routine-abbrechen").addEventListener("click", () => { routineBearbeitet = null; document.getElementById("routine-form").hidden = true; });
document.getElementById("routine-name").addEventListener("input", routineFormPruefen);
document.getElementById("routine-schritte").addEventListener("input", routineFormPruefen);
document.getElementById("routine-form").addEventListener("submit", (e) => { e.preventDefault(); routineSpeichernAusForm(); });
document.getElementById("routine-start").addEventListener("click", () => routineAusfuehren(0));
document.getElementById("routine-von-vorn").addEventListener("click", () => routineAusfuehren(0));
document.getElementById("routine-fortsetzen").addEventListener("click", () => { if (routineLauf) routineAusfuehren(Math.max(0, routineLauf.status.indexOf("fehlgeschlagen"))); });
document.getElementById("routine-stopp").addEventListener("click", () => { if (routineLauf) routineLauf.abbrechen = true; document.getElementById("routine-meldung").textContent = "Wird nach dem laufenden Schritt abgebrochen …"; });
document.getElementById("routine-schliessen").addEventListener("click", () => { if (!routineLauf || !routineLauf.laeuft) document.getElementById("routine-ablauf").hidden = true; });
document.getElementById("routinen-export").addEventListener("click", routinenExportieren);
document.getElementById("routinen-import").addEventListener("change", async (e) => {
  const datei = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!datei) return;
  const r = datei.size > 200000 ? { fehler: "Die Datei ist zu groß." } : routinenImportieren(await datei.text());
  // ab 11-03i: Speichern gescheitert → keine Erfolgsmeldung (vorher „… importiert“, beim Neuladen fehlten die Routinen)
  if (!r.fehler && r.neu && !routineSpeicherOk) { lokalAntworten("Import nicht gespeichert: Browserspeicher gesperrt oder voll – " + r.neu + " Routine(n) nur bis zum Neuladen sichtbar, gespeicherte Routinen unverändert."); return; }
  lokalAntworten(r.fehler ? "Import nicht möglich: " + r.fehler : r.neu + " Routine(n) importiert" + (r.uebersprungen.length ? "; übersprungen: " + r.uebersprungen.join(" · ") : "") + ".", r.fehler ? "fehler" : "");
});

// Sprachbefehl: zeigt die Schritte und startet erst nach „Ja“
skillRegistrieren({
  name: "routine",
  risiko: "bestaetigen",
  beschreibung: "Routine starten (zeigt vorher die Schritte)",
  beispiele: ["Starte Routine Morgenübersicht"],
  passt: (text) => /^(starte|start)( die)? routine .+|^routine .+ starten$/.test(befehlNormalisieren(text)),
  planen: async (text) => {
    const name = befehlNormalisieren(text).replace(/^(starte|start)( die)? routine /, "").replace(/^routine /, "").replace(/ starten$/, "").trim();
    const r = routinen.find((x) => x.name.toLowerCase() === name) || null;
    if (!r) return { fehler: "Keine Routine „" + name + "“ gefunden." + (routinen.length ? " Vorhanden: " + routinen.map((x) => x.name).join(", ") + "." : "") };
    if (routineLauf && routineLauf.laeuft) return { fehler: "Es läuft bereits eine Routine." };
    return {
      beschreibung: "Routine „" + r.name + "“ mit " + r.schritte.length + " Schritten: " + r.schritte.map((s, i) => (i + 1) + ". " + s).join(", ") + ".",
      ausfuehren: async () => {
        if (!routineVorschau(r.id)) return "Routine nicht verfügbar.";
        if (document.getElementById("routine-start").disabled) return document.getElementById("routine-meldung").textContent;
        const e = await routineAusfuehren(0);
        return e.ok ? "Routine „" + r.name + "“ abgeschlossen." : "Routine „" + r.name + "“: " + document.getElementById("routine-meldung").textContent;
      },
    };
  },
});

routinenLaden();
routinenAnzeigen();
window.routinenIntern = { laden: routinenLaden, liste: () => routinen, pruefen: routinePruefen, schrittPruefen: routinenSchrittPruefen, vorschau: routineVorschau, ausfuehren: routineAusfuehren, lauf: () => routineLauf, kopieren: routineKopieren, exportText: routinenExportText, importieren: routinenImportieren, ROUTINEN };

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("routinen");
