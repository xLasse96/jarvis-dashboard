// JARVIS Dashboard – Modul „datenpruefung“ (ab 11-09p). Datensicherheit über alle lokalen Speicherbereiche, ergänzt
// „Daten auf diesem Gerät“ (17-uebersichten-freigaben.js), ohne dessen Sicherung/Wiederherstellung zu ersetzen:
//   - Prüfbericht je Schlüssel: vorhanden, Größe, gültiges JSON, Grundform (SPEICHER_FORMEN), Schema-Version, beschädigt;
//     nicht zugeordnete „jarvis-…“-Schlüssel werden genannt (nichts wird gelöscht)
//   - Rahmen für sichere Migrationen: nur von der erwarteten Version, Ergebnis wird vor dem Schreiben geprüft, der alte Wert bleibt
//     als Sicherung erhalten; scheitert etwas, bleibt alles unverändert (derzeit ist keine Migration nötig – alle Formen sind Version 1)
//   - Abgleich zwischen Tabs: ändert ein anderer Tab einen Bereich, lädt dieser Tab ihn neu (verhindert veraltete Schreibvorgänge
//     aus dem Speicher der Seite); ein beschädigter Stand wird dabei nie überschrieben
// Keine Anfrage.
const DATENPRUEFUNG = { migrationSicherung: "jarvis-migration-sicherung", zuletzt: null, abgleich: 0 };
// Neu laden je Datenbereich – dieselben Funktionen wie nach Löschen/Wiederherstellen
const DATEN_NEULADEN = {
  aufgaben: () => { if (window.aufgabenIntern) { window.aufgabenIntern.laden(); window.aufgabenIntern.anzeigen(); } },
  routinen: () => { if (typeof routinenLaden === "function") { routinenLaden(); routinenAnzeigen(); } },
  notizen: () => { if (typeof notizenLaden === "function") { notizenLaden(); notizenAnzeigen(); } },
  profil: () => { if (typeof profilLaden === "function") profilLaden(); },
  automatik: () => { if (typeof autoLesen === "function") { autoLesen(); autoAnzeigen(); } },
  auftraege: () => { if (typeof auftraegeLesen === "function") { auftraegeLesen(); auftraegeAnzeigen(); } },
  dateien: () => { if (typeof dateienAnzeigen === "function") dateienAnzeigen(); },
  projekte: () => { if (typeof projekteLesen === "function") { projekteLesen(); projekteAnzeigen(); } },
  arbeitsplatz: () => { if (typeof arbeitsplatzAnzeigen === "function") arbeitsplatzAnzeigen(); },
  gedaechtnis: () => { if (typeof gedAnzeigen === "function") { gedAnzeigen(); dialogAnzeigen(); } },
  hinweise: () => { if (typeof hinweiseLesen === "function") { hinweiseLesen(); hinweiseAnzeigen(); } },
  oberflaeche: () => { if (typeof oberflaecheNeuLaden === "function") oberflaecheNeuLaden(); },
  "aktien-historie": () => { if (typeof auebAnzeigen === "function") auebAnzeigen(); },
};
// ab 11-13p: Grundform = Leser des Moduls (reproduziert: „{}“ bestand Wiederherstellung/Import, das Modul sperrte den Bereich danach
// als beschädigt). Warnschwellen wie 05 risikoSchwellenLesen, Modell wie 52 modellLesen plus die Anbieterregel aus 65 (65 setzt die
// Modellform nur, wenn noch keine da ist – daher hier vollständig). Nur Prüfung/Import; Anzeige- und Handelslogik unverändert.
SPEICHER_FORMEN["jarvis-risiko-schwellen"] = (x) => istObjekt(x) && schwelleGueltig(x.position) && schwelleGueltig(x.sektor);
SPEICHER_FORMEN["jarvis-modell"] = (x) => istObjekt(x) && x.art === "jarvis-modell" && (x.anbieter === undefined || ["worker", "mock"].includes(x.anbieter));
const datenBereichFuer = (schluessel) => DATEN_BEREICHE.find((b) => b.schluessel.includes(schluessel)) || null;
function datenPruefung() {
  const zeilen = [];
  for (const b of DATEN_BEREICHE) for (const k of b.schluessel) {
    let w = null;
    try { w = localStorage.getItem(k); } catch (e) { zeilen.push({ bereich: b.name, schluessel: k, zustand: "nicht lesbar", ok: false }); continue; }
    if (w === null) { zeilen.push({ bereich: b.name, schluessel: k, zustand: "leer", ok: true, leer: true }); continue; }
    const z = { bereich: b.name, schluessel: k, zeichen: w.length, ok: true, zustand: "in Ordnung", version: null, form: SPEICHER_FORMEN[k] ? "geprüft" : b.json ? "nur JSON" : "Einzelwert" };
    if (b.geheim) { z.zustand = "geheim – Inhalt nicht geprüft"; zeilen.push(z); continue; }
    if (b.json || /^[\[{]/.test(w)) {
      let d;
      try { d = JSON.parse(w); } catch (e) { Object.assign(z, { ok: false, zustand: "beschädigt (kein gültiges JSON)" }); zeilen.push(z); continue; }
      if (istObjekt(d) && Number.isInteger(d.version)) z.version = d.version;
      const f = speicherWertPruefen(k, w);
      if (f) Object.assign(z, { ok: false, zustand: f });
    } else if (typeof speicherWertPruefen === "function") { const f = speicherWertPruefen(k, w); if (f) Object.assign(z, { ok: false, zustand: f }); }
    if (typeof speicherBeschaedigt === "function" && speicherBeschaedigt(k) && z.ok) Object.assign(z, { ok: false, zustand: "als beschädigt gemeldet (wird nicht überschrieben)" });
    zeilen.push(z);
  }
  const bekannt = new Set(DATEN_BEREICHE.flatMap((b) => b.schluessel)), fremd = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("jarvis-") && !bekannt.has(k) && k !== DATENPRUEFUNG.migrationSicherung) fremd.push(k); } } catch (e) { /* gesperrt */ }
  const r = { zeilen, fremd: fremd.sort(), fehler: zeilen.filter((z) => !z.ok).length, belegt: zeilen.filter((z) => !z.leer).length, zeit: new Date().toISOString() };
  DATENPRUEFUNG.zuletzt = r;
  return r;
}
// Sichere Migration: { schluessel, von, nach, umwandeln(d) → neues Objekt }. Rückgabe { ok, sicherung } | { fehler } | { nichtNoetig }
function datenMigrieren({ schluessel, von, nach, umwandeln }) {
  let w;
  try { w = localStorage.getItem(schluessel); } catch (e) { return { fehler: "Speicher nicht lesbar" }; }
  if (w === null) return { nichtNoetig: "leer" };
  if (typeof speicherBeschaedigt === "function" && speicherBeschaedigt(schluessel)) return { fehler: "beschädigt – keine Migration (erst Sicherung prüfen)" };
  let d;
  try { d = JSON.parse(w); } catch (e) { return { fehler: "kein gültiges JSON – keine Migration" }; }
  const ist = istObjekt(d) && Number.isInteger(d.version) ? d.version : 0;
  if (ist === nach) return { nichtNoetig: "schon Version " + nach };
  if (ist !== von) return { fehler: `Version ${ist} erwartet ${von} – keine Migration` };
  let neu;
  try { neu = umwandeln(JSON.parse(w)); } catch (e) { return { fehler: "Umwandlung gescheitert: " + e.message + " – nichts geändert" }; }
  if (!istObjekt(neu) || neu.version !== nach) return { fehler: "Ergebnis ohne Zielversion – nichts geändert" };
  const text = JSON.stringify(neu), form = speicherWertPruefen(schluessel, text);
  if (form) return { fehler: "Ergebnis passt nicht zur Grundform (" + form + ") – nichts geändert" };
  const sicherung = { schluessel, version: ist, zeit: new Date().toISOString(), wert: w };
  try { localStorage.setItem(DATENPRUEFUNG.migrationSicherung, JSON.stringify(sicherung)); } catch (e) { return { fehler: "Sicherung des alten Werts nicht möglich (Speicher voll?) – nichts geändert" }; }
  try { localStorage.setItem(schluessel, text); } catch (e) { return { fehler: "Schreiben gescheitert – alter Wert unverändert, Sicherung liegt vor" }; }
  return { ok: true, sicherung };
}
// Abgleich zwischen Tabs (storage-Ereignis kommt nur aus anderen Tabs desselben Browsers)
function datenAbgleich(schluessel) {
  const b = datenBereichFuer(schluessel);
  if (!b || !DATEN_NEULADEN[b.id]) return false;
  if (typeof SPEICHER_SCHADEN !== "undefined") SPEICHER_SCHADEN.delete(schluessel); // frisch lesen; ist der neue Stand beschädigt, meldet ihn das Lesen erneut
  try { DATEN_NEULADEN[b.id](); } catch (e) { return false; }
  DATENPRUEFUNG.abgleich++;
  const m = document.getElementById("daten-abgleich");
  if (m) m.textContent = `„${b.name}“ wurde in einem anderen Tab geändert und hier neu geladen (${new Date().toLocaleTimeString("de-DE")}).`;
  return true;
}
window.addEventListener("storage", (e) => { if (e.key && e.key.startsWith("jarvis-")) datenAbgleich(e.key); });
function datenPruefungAnzeigen() {
  const el = (id) => document.getElementById(id);
  if (!el("daten-pruefung")) return;
  const r = datenPruefung();
  el("daten-pruefung-status").textContent = `${r.belegt} belegte Schlüssel geprüft · ${r.fehler ? "⚠ " + r.fehler + " mit Befund" : "keine Befunde"}` + (r.fremd.length ? ` · ${r.fremd.length} nicht zugeordnet` : "") + " · nichts wurde geändert.";
  el("daten-pruefung").replaceChildren(...r.zeilen.filter((z) => !z.leer).map((z) => Object.assign(document.createElement("li"), { className: z.ok ? "" : "wz-wichtig", textContent: `${z.schluessel} (${z.bereich}): ${z.zustand}${z.zeichen ? ` · ${z.zeichen.toLocaleString("de-DE")} Zeichen` : ""}${z.version !== null && z.version !== undefined ? ` · Version ${z.version}` : ""} · Form: ${z.form}` })),
    ...r.fremd.map((k) => Object.assign(document.createElement("li"), { textContent: `${k}: keinem Datenbereich zugeordnet (wird nicht gesichert; nichts gelöscht)` })));
}
(function datenpruefungEinrichten() {
  const k = document.getElementById("daten-pruefen");
  if (!k) return;
  k.addEventListener("click", datenPruefungAnzeigen);
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("datenpruefung");
