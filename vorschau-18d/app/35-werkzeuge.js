// JARVIS Dashboard – Modul „werkzeuge“ (ab 11-09b). Einheitliche Werkzeugschicht über den vorhandenen lokalen Skills (SKILLS):
//   - Registrierung = die vorhandenen Skills; je Werkzeug Beschreibung, Beispiele, Art (lesen/ändern/bestätigen/gesperrt),
//     Verfügbarkeit (Worker, PC-Helfer, Aktien-Stand) – sichtbar in der Karte „Fähigkeiten & Freigaben“
//   - werkzeugAufrufen(name, eingabe, optionen): geprüfte Eingabe, einheitliche Ausgabe { ok, code, text, dauer_ms }, Fehlercodes,
//     Zeitlimit, Abbruch, Wiederholungsgrenze, Schutz vor Rekursion; Bestätigungspflichtiges und Gesperrtes werden hier NIE
//     ausgeführt (dafür gibt es die vorhandenen Rückfragen)
//   - Trockenlauf: zeigt, welches Werkzeug ein Satz auslösen würde und mit welcher Freigabe – ohne etwas auszuführen
//   - Historie (nur Arbeitsspeicher, höchstens 30) und Diagnose (Aufrufe, Fehler je Code)
// KI-Antworten können keine Werkzeuge aufrufen: Werkzeuge laufen nur aus Eingaben der Nutzerin bzw. des Nutzers (Chat, Sprache,
// Auftrag, Routine). Keine Anfrage, kein Speicher.
const WERKZEUG_CODES = {
  OK: "ausgeführt", UNBEKANNT: "kein solches Werkzeug", EINGABE: "Eingabe ungültig", PASST_NICHT: "Eingabe passt nicht zum Werkzeug",
  GESPERRT: "gesperrt bzw. ausgeschaltet", BESTAETIGUNG: "braucht eine Einzelbestätigung", NICHT_VERFUEGBAR: "derzeit nicht verfügbar",
  ZEITLIMIT: "Zeitlimit überschritten", ABGEBROCHEN: "abgebrochen", FEHLER: "Fehler bei der Ausführung", NICHT_AUSGEFUEHRT: "Werkzeug hat nichts ausgeführt",
  WIEDERHOLUNG: "zu viele Wiederholungen", REKURSION: "Werkzeug ruft sich selbst auf",
};
const WERKZEUG = { laufend: new Map(), naechste: 0, historie: [], maxHistorie: 30, zeitlimitMs: 20000, wiederholung: new Map(), maxWiederholung: 3, fensterMs: 10000, aufrufe: 0, fehler: {} };
const WERKZEUG_ART = { abfrage: "lesen", leicht: "ändern", bestaetigen: "bestätigen", gesperrt: "gesperrt" };
function werkzeugVerfuegbarkeit(skill) {
  const nv = typeof skill.nichtVerfuegbar === "function" ? skill.nichtVerfuegbar() : null;
  if (nv) return nv;
  if (skill.braucht === "verbindung" && typeof verbunden === "function" && !verbunden()) return "braucht die Worker-Verbindung";
  if (skill.braucht === "helfer" && typeof helferEingerichtet === "function" && !helferEingerichtet()) return "braucht den PC-Helfer";
  return null;
}
function werkzeugListe() {
  return SKILLS.map((s) => ({ name: s.name, beschreibung: s.beschreibung, beispiele: (s.beispiele || []).slice(), art: WERKZEUG_ART[skillRisiko(s)] || skillRisiko(s), standard: WERKZEUG_ART[s.risiko], nicht_verfuegbar: werkzeugVerfuegbarkeit(s) }));
}
// Trockenlauf: was würde dieser Satz auslösen? Führt nichts aus.
function werkzeugTrockenlauf(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 300) return { code: "EINGABE", text: WERKZEUG_CODES.EINGABE + " (1–300 Zeichen)." };
  if (typeof auftragErkennen === "function") { const s = auftragErkennen(t); if (s) return { code: "OK", auftrag: true, schritte: s.map((x) => ({ text: x.text, werkzeug: x.skill, art: x.art, grund: x.grund })), text: `Mehrteiliger Auftrag mit ${s.length} Schritten.` }; }
  const skill = SKILLS.find((s) => s.passt(t));
  if (!skill) return { code: "UNBEKANNT", text: "Kein lokales Werkzeug passt – der Satz ginge an die KI (mit Verbindung) bzw. bekäme eine Offline-Antwort." };
  const nv = werkzeugVerfuegbarkeit(skill);
  return { code: "OK", werkzeug: skill.name, beschreibung: skill.beschreibung, art: WERKZEUG_ART[skillRisiko(skill)], nicht_verfuegbar: nv,
    text: `Würde „${skill.beschreibung}“ auslösen (${WERKZEUG_ART[skillRisiko(skill)]})` + (nv ? ` – derzeit nicht verfügbar: ${nv}` : "") + ". Im Trockenlauf wurde nichts ausgeführt." };
}
function werkzeugMerken(e) {
  WERKZEUG.aufrufe++;
  if (e.code !== "OK") WERKZEUG.fehler[e.code] = (WERKZEUG.fehler[e.code] || 0) + 1;
  WERKZEUG.historie = [e, ...WERKZEUG.historie].slice(0, WERKZEUG.maxHistorie);
  werkzeugeAnzeigen();
  return e;
}
// Einheitlicher Aufruf. optionen: { abbruch: AbortSignal, zeitlimitMs, quelle }
async function werkzeugAufrufen(name, eingabe, optionen = {}) {
  const t0 = performance.now(), jetzt = Date.now();
  const aus = (code, text, extra = {}) => werkzeugMerken({ zeit: jetzt, werkzeug: name, eingabe: (typeof geheimnisMuster === "function" ? geheimnisMuster(String(eingabe || "")) : String(eingabe || "")).slice(0, 80), quelle: optionen.quelle || "?", ok: code === "OK", code, text: text || WERKZEUG_CODES[code], dauer_ms: Math.round(performance.now() - t0), ...extra });
  const skill = SKILLS.find((s) => s.name === name);
  if (!skill) return aus("UNBEKANNT");
  const text = String(eingabe || "").trim();
  if (!text || text.length > 300) return aus("EINGABE", WERKZEUG_CODES.EINGABE + " (1–300 Zeichen)");
  if (!skill.passt(text)) return aus("PASST_NICHT");
  const risiko = skillRisiko(skill);
  if (risiko === "gesperrt" || skill.risiko === "gesperrt") return aus("GESPERRT");
  if (risiko === "bestaetigen" || skill.eigeneBestaetigung) return aus("BESTAETIGUNG");
  const nv = werkzeugVerfuegbarkeit(skill);
  if (nv) return aus("NICHT_VERFUEGBAR", WERKZEUG_CODES.NICHT_VERFUEGBAR + ": " + nv);
  // Rekursion: Während ein Werkzeug läuft, darf nur ein Mitglied derselben Parallelgruppe starten (Auftrag, 09c) – sonst würde ein
  // Werkzeug ein weiteres auslösen. Vorher zählte eine globale Tiefe, die auch parallele Leseschritte als Rekursion wertete.
  if (WERKZEUG.laufend.size && !(optionen.gruppe && [...WERKZEUG.laufend.values()].every((g) => g === optionen.gruppe))) return aus("REKURSION");
  const schluessel = name + "|" + text.toLowerCase();
  const w = (WERKZEUG.wiederholung.get(schluessel) || []).filter((z) => jetzt - z < WERKZEUG.fensterMs);
  if (w.length >= WERKZEUG.maxWiederholung) return aus("WIEDERHOLUNG", `${WERKZEUG_CODES.WIEDERHOLUNG} (höchstens ${WERKZEUG.maxWiederholung} gleiche Aufrufe in ${WERKZEUG.fensterMs / 1000} s)`);
  WERKZEUG.wiederholung.set(schluessel, [...w, jetzt]);
  if (optionen.abbruch && optionen.abbruch.aborted) return aus("ABGEBROCHEN");
  const aufrufId = ++WERKZEUG.naechste;
  WERKZEUG.laufend.set(aufrufId, optionen.gruppe || null);
  try {
    const grenze = optionen.zeitlimitMs || WERKZEUG.zeitlimitMs;
    const r = await Promise.race([
      Promise.resolve(skill.aktion(text)),
      new Promise((_, nein) => setTimeout(() => nein(Object.assign(new Error("Zeitlimit"), { code: "ZEITLIMIT" })), grenze)),
      new Promise((_, nein) => { if (optionen.abbruch) optionen.abbruch.addEventListener("abort", () => nein(Object.assign(new Error("abgebrochen"), { code: "ABGEBROCHEN" })), { once: true }); }),
    ]);
    return r === false ? aus("NICHT_AUSGEFUEHRT") : aus("OK");
  } catch (e) {
    return aus(e && e.code && WERKZEUG_CODES[e.code] ? e.code : "FEHLER", e && e.code ? undefined : WERKZEUG_CODES.FEHLER + ": " + String((e && e.message) || e).slice(0, 120));
  } finally { WERKZEUG.laufend.delete(aufrufId); }
}
function werkzeugeAnzeigen() {
  const h = document.getElementById("werkzeug-historie"), dg = document.getElementById("werkzeug-diagnose");
  if (!h) return;
  h.replaceChildren(...(WERKZEUG.historie.length ? WERKZEUG.historie.map((e) => Object.assign(document.createElement("li"), { textContent: `${new Date(e.zeit).toLocaleTimeString("de-DE")} · ${e.werkzeug} · ${e.ok ? "✔" : "✖ " + e.code} · ${e.text} · ${e.dauer_ms} ms · Quelle ${e.quelle}` }))
    : [Object.assign(document.createElement("li"), { textContent: "Noch kein Werkzeugaufruf in dieser Sitzung." })]));
  const wl = werkzeugListe();
  dg.textContent = `${wl.length} Werkzeuge registriert: ${wl.filter((x) => x.art === "lesen").length} lesen, ${wl.filter((x) => x.art === "ändern").length} ändern, ${wl.filter((x) => x.art === "bestätigen").length} mit Bestätigung, ${wl.filter((x) => x.art === "gesperrt").length} gesperrt · derzeit nicht verfügbar: ${wl.filter((x) => x.nicht_verfuegbar).map((x) => x.name).join(", ") || "keins"} · Aufrufe ${WERKZEUG.aufrufe}` + (Object.keys(WERKZEUG.fehler).length ? " · Fehler: " + Object.entries(WERKZEUG.fehler).map(([c, n]) => `${c} ${n}`).join(", ") : "");
}
(function werkzeugeEinrichten() {
  const f = document.getElementById("werkzeug-test-form");
  if (!f) return;
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = werkzeugTrockenlauf(document.getElementById("werkzeug-test-text").value);
    const aus = document.getElementById("werkzeug-test-ergebnis");
    aus.replaceChildren(Object.assign(document.createElement("p"), { textContent: r.text }), ...(r.schritte ? [Object.assign(document.createElement("ol"), {})] : []));
    if (r.schritte) aus.querySelector("ol").append(...r.schritte.map((s) => Object.assign(document.createElement("li"), { textContent: `${s.text} → ${s.werkzeug} (${s.art})${s.grund ? " – " + s.grund : ""}` })));
  });
  werkzeugeAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("werkzeuge");
