// JARVIS Dashboard – Modul „datenquellen“ (ab 11-10n). Datenquellen und Qualität – ergänzt daten/datenquellen.js (Normalisierung,
// Schema-/Kerzenprüfung, Ausreißer, Frische, Widerspruchsprüfung quellenAbgleich, Cache-Baustein, Mock) und die Analyse-Anzeigen:
//   - zentrale Quellenübersicht (registriert, mit Art: live über den Worker / historisch / synthetisch, Verfügbarkeit, Grenzen)
//   - Abrufhistorie: jeder Abruf über JarvisDaten.abrufen wird beobachtet (Zeit, Quelle, Art, Symbol, ok/Fehlercode, Frische,
//     Datenzeit) – nur Protokoll, die Daten selbst werden weder verändert noch zwischengespeichert
//   - Fehlerübersicht und Qualitätsbewertung je Quelle (Anteil gültiger Abrufe), Verfügbarkeit (letzter erfolgreicher Abruf)
//   - verständliche Datenwarnung zu einem Abrufergebnis (veraltet, Frische unbekannt, Ersatzdaten, fehlende Werte, Widerspruch)
//   - Cache-Übersicht: zeigt, ob ein lokaler Datencache existiert, mit Alter; leeren erst nach zweitem Klick
// Kein neuer externer Zugriff: das Modul ruft nichts ab, es beobachtet nur. Speicher „jarvis-datenquellen“ { art, version, abrufe }.
const DQ = { schluessel: "jarvis-datenquellen", max: 60, cacheSchluessel: "jarvis-daten-cache", leerenOffen: 0 };
const DQ_QUELLEN = [
  { id: "worker", name: "Worker (Alpaca-Marktdaten, SEC, Nachrichten)", art: "live über den Worker", pruefe: () => (typeof verbunden === "function" && verbunden() ? "verbunden" : "nicht verbunden"), grenze: "nur lesend; Schlüssel liegen ausschließlich im Worker" },
  { id: "test", name: "Lokale Testdaten", art: "synthetisch", pruefe: () => "immer verfügbar", grenze: "erfunden – nie Entscheidungsgrundlage, nie ein Signal" },
  { id: "csv", name: "CSV-Import (eigene Kerzendatei)", art: "historisch", pruefe: () => "auf Auswahl", grenze: "nur diese Sitzung, nicht gesendet, Frische = Datei-Stand" },
  { id: "paper", name: "Paper-Simulation (Spielgeld)", art: "simuliert", pruefe: () => (typeof SIM !== "undefined" && SIM.bereit ? (SIM.beschaedigt || SIM.dbFehler ? "beschädigt" : "geladen") : "nicht geladen"), grenze: "kein echtes Geld, keine Börse" },
  { id: "andere", name: "OpenAI, Google, weitere Kursanbieter", art: "nicht angebunden", pruefe: () => "nicht verfügbar", grenze: "keine Verbindung ohne neue Freigabe (siehe docs/MODELLANBIETER_10.md)" },
];
const DQ_CODES = { timeout: "Zeitüberschreitung", fehler: "Abruf fehlgeschlagen", ungueltig: "ungültige Daten", veraltet: "veraltet", widerspruch: "widersprüchlich", regel_fehlt: "Regel fehlt", nicht_verfuegbar: "nicht verfügbar" };
function dqLesen() {
  const d = speicherJsonLesen(DQ.schluessel, (x) => istObjekt(x) && x.art === "jarvis-datenquellen" && Array.isArray(x.abrufe));
  return { abrufe: d ? d.abrufe.filter((a) => istObjekt(a) && typeof a.quelle === "string").slice(0, DQ.max) : [] };
}
function dqMerken(e, anfrage) {
  const s = dqLesen(); // erst lesen: setzt die Beschädigt-Markierung
  if (speicherBeschaedigt(DQ.schluessel)) return false;
  s.abrufe.unshift({ zeit: new Date().toISOString(), quelle: String(e.quelle || "?").slice(0, 60), art: String(e.art || "?"), symbol: anfrage && typeof anfrage.symbol === "string" ? anfrage.symbol.slice(0, 12) : "", ok: Boolean(e.ok), code: e.fehler ? e.fehler.code : "", text: e.fehler ? String(e.fehler.text || "").slice(0, 120) : "", frisch: e.frisch === true ? "ja" : e.frisch === false ? "nein" : "unbekannt", datenzeit: Number.isFinite(e.datenzeit) ? new Date(e.datenzeit).toISOString() : null, ersatz: Boolean(e.ersatz) });
  try { localStorage.setItem(DQ.schluessel, JSON.stringify({ art: "jarvis-datenquellen", version: 1, abrufe: s.abrufe.slice(0, DQ.max) })); return true; } catch (x) { return false; }
}
// Beobachtung: Ergebnis unverändert zurückgeben
if (window.JarvisDaten && typeof window.JarvisDaten.abrufen === "function" && !window.JarvisDaten.abrufen.beobachtet) {
  const original = window.JarvisDaten.abrufen;
  const huelle = async function (provider, art, anfrage, optionen) { const e = await original(provider, art, anfrage, optionen); try { dqMerken(e || {}, anfrage); dqAnzeigen(); } catch (x) { /* nur Protokoll */ } return e; };
  huelle.beobachtet = true;
  window.JarvisDaten.abrufen = huelle;
}
function dqAuswertung() {
  const je = new Map();
  for (const a of dqLesen().abrufe) {
    const q = je.get(a.quelle) || { quelle: a.quelle, abrufe: 0, ok: 0, fehler: {}, letzterOk: null, letzter: null };
    q.abrufe++; if (a.ok) { q.ok++; if (!q.letzterOk) q.letzterOk = a.zeit; } else q.fehler[a.code || "fehler"] = (q.fehler[a.code || "fehler"] || 0) + 1;
    if (!q.letzter) q.letzter = a.zeit;
    je.set(a.quelle, q);
  }
  return [...je.values()].map((q) => ({ ...q, qualitaetPct: Math.round((q.ok / q.abrufe) * 100), bewertung: q.ok === q.abrufe ? "gut" : q.ok / q.abrufe >= 0.7 ? "mittel" : "schlecht" }));
}
// Verständliche Warnung zu einem Ergebnis von JarvisDaten.abrufen (leer = keine Warnung)
function datenWarnung(e, jetzt = Date.now()) {
  if (!e) return "Keine Daten.";
  const w = [];
  if (!e.ok && e.fehler) w.push(`${DQ_CODES[e.fehler.code] || "Fehler"}: ${e.fehler.text}`);
  if (e.ok && e.frisch === null) w.push("Aktualität unbekannt – nicht als aktuell behandeln.");
  if (e.frisch === false || (e.fehler && e.fehler.code === "veraltet")) w.push(`Veraltet${Number.isFinite(e.datenzeit) ? ` (Stand ${new Date(e.datenzeit).toLocaleString("de-DE")}, vor ${Math.round((jetzt - e.datenzeit) / 3600000)} h)` : ""} – nicht als aktuell anzeigen.`);
  if (e.ersatz) w.push("Ersatzquelle verwendet.");
  if (e.aus_cache) w.push(`aus dem Zwischenspeicher (${Math.round((e.cache_alter_ms || 0) / 60000)} min alt).`);
  if (Array.isArray(e.daten) && e.daten.some((k) => k && [k.o, k.h, k.l, k.c].some((v) => v === null || v === undefined))) w.push("Einzelne Werte fehlen.");
  return w.join(" ");
}
function dqCache(jetzt = Date.now()) {
  let roh = null;
  try { roh = JSON.parse(localStorage.getItem(DQ.cacheSchluessel) || "null"); } catch (x) { return { vorhanden: true, beschaedigt: true, eintraege: [] }; }
  if (!Array.isArray(roh)) return { vorhanden: false, eintraege: [] };
  return { vorhanden: true, eintraege: roh.filter((x) => Array.isArray(x) && x[1] && Number.isFinite(x[1].gespeichert)).map(([k, v]) => ({ schluessel: String(k).slice(0, 60), alterMin: Math.round((jetzt - v.gespeichert) / 60000) })) };
}
function dqCacheLeeren(jetzt = Date.now()) {
  if (jetzt - DQ.leerenOffen > 10000) { DQ.leerenOffen = jetzt; return { rueckfrage: true }; }
  DQ.leerenOffen = 0;
  try { localStorage.removeItem(DQ.cacheSchluessel); } catch (x) { return { fehler: "Nicht gelöscht." }; }
  return { ok: true };
}
function dqAnzeigen(jetzt = Date.now()) {
  const el = (id) => document.getElementById(id), det = el("dq-details");
  if (!det || !det.open) return;
  const li = (t, k = "") => Object.assign(document.createElement("li"), { textContent: t, className: k }), aus = dqAuswertung(), zeit = (x) => (x ? new Date(x).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–");
  el("dq-quellen").replaceChildren(...DQ_QUELLEN.map((q) => { const a = aus.find((x) => q.id === "worker" ? /worker|alpaca/i.test(x.quelle) : q.id === "test" ? /test|mock/i.test(x.quelle) : q.id === "csv" ? /csv/i.test(x.quelle) : false); return li(`${q.name} · ${q.art} · ${q.pruefe()}${a ? ` · zuletzt erfolgreich ${zeit(a.letzterOk)}` : ""} · ${q.grenze}`, q.art === "nicht angebunden" ? "" : ""); }));
  el("dq-qualitaet").replaceChildren(...(aus.length ? aus.map((q) => li(`${q.quelle}: ${q.ok} von ${q.abrufe} Abrufen gültig (${q.qualitaetPct} %, ${q.bewertung})${Object.keys(q.fehler).length ? " · Fehler: " + Object.entries(q.fehler).map(([c, n]) => `${DQ_CODES[c] || c} ${n}×`).join(", ") : ""}`, q.bewertung === "schlecht" ? "wz-wichtig" : "")) : [li("Noch keine Abrufe in dieser Historie.")]));
  if (speicherBeschaedigt(DQ.schluessel)) el("dq-historie").replaceChildren(li("Historie beschädigt – " + SPEICHER_SCHADEN_TEXT, "wz-wichtig"));
  else el("dq-historie").replaceChildren(...dqLesen().abrufe.slice(0, 15).map((a) => li(`${zeit(a.zeit)} · ${a.quelle} · ${a.art}${a.symbol ? " " + a.symbol : ""} · ${a.ok ? "ok" : "✖ " + (DQ_CODES[a.code] || a.code)} · Frische ${a.frisch}${a.datenzeit ? " · Stand " + zeit(a.datenzeit) : ""}`)));
  const c = dqCache(jetzt);
  el("dq-cache").textContent = !c.vorhanden ? "Kein lokaler Datencache – Analysen holen ihre Daten bei jedem Abruf neu (nichts Veraltetes wird als aktuell gezeigt)." : c.beschaedigt ? "Lokaler Datencache beschädigt." : `Lokaler Datencache: ${c.eintraege.length} Eintrag/Einträge${c.eintraege.length ? ", ältester " + Math.max(...c.eintraege.map((x) => x.alterMin)) + " min" : ""}.`;
  el("dq-cache-leeren").hidden = !c.vorhanden;
}
skillRegistrieren({
  name: "datenquellen",
  risiko: "abfrage",
  hilfeKurz: "Datenquellen",
  beschreibung: "Datenquellen, Abrufqualität und Fehler anzeigen (nur lesend, kein Abruf)",
  beispiele: ["Datenquellen", "Wie gut sind meine Daten?"],
  passt: (text) => /^(datenquellen|zeige?( mir)? (die )?datenquellen|wie gut sind (meine |die )?daten|datenqualität)$/.test(befehlNormalisieren(text)),
  aktion: async () => {
    const a = dqAuswertung();
    lokalAntworten(`Quellen: ${DQ_QUELLEN.map((q) => `${q.name.split(" (")[0]} (${q.art}, ${q.pruefe()})`).join("; ")}. ` + (a.length ? "Abrufe: " + a.map((q) => `${q.quelle} ${q.qualitaetPct} % gültig`).join(", ") + "." : "Noch keine Abrufe protokolliert."));
    return true;
  },
});
(function dqEinordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();
(function dqEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("dq-details")) return;
  el("dq-details").addEventListener("toggle", () => dqAnzeigen());
  el("dq-cache-leeren").addEventListener("click", () => { const r = dqCacheLeeren(); el("dq-meldung").textContent = r.rueckfrage ? "Wirklich leeren? Zum Bestätigen innerhalb von 10 Sekunden erneut klicken." : r.fehler || "Datencache geleert."; dqAnzeigen(); });
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("datenquellen");
