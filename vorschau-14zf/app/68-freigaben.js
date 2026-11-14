// JARVIS Dashboard – Modul „freigaben“ (ab 11-11c). Auftragsplaner – ergänzt 34-auftraege.js (Zerlegung, Vorschau mit Baum,
// Abhängigkeiten, Warteschlange, Kennungen, Lesen/Schreiben, veraltete Pläne, parallele Leseschritte, Pause, Abbruch, Wiederaufnahme,
// Fehler je Schritt, Chronik):
//   - eine Freigabeübersicht über alle Bereiche: wartende Aufträge, Workflow-Freigabeschritte, offene Rückfragen (Ja/Nein) –
//     mit Knöpfen; Freigeben bleibt immer ein ausdrücklicher Klick
//   - verständliche Ergebniszusammenfassung im Chat: welche Schritte nicht erledigt wurden und warum
//   - Sprache: „Was wartet auf meine Freigabe?“ / „Offene Freigaben“
// Kein eigener Speicher.
function freigabenOffen() {
  const l = [];
  for (const a of (typeof auftragStand !== "undefined" ? auftragStand.liste : []).filter((x) => x.status === "wartet")) {
    const aendert = a.schritte.filter((s) => s.art === "schreiben").map((s) => `„${s.text}“`);
    l.push({ art: "Auftrag", id: a.id, text: `${a.id}: ${a.schritte.length} Schritt(e)${aendert.length ? ", ändert " + aendert.join(", ") : ""}${a.widersprueche.length ? " – Widerspruch, nicht freigebbar" : ""}`, freigebbar: !a.widersprueche.length, los: () => auftragFreigeben(a.id) });
  }
  const r = typeof routineLauf !== "undefined" ? routineLauf : null;
  if (r && Number.isInteger(r.wartetFreigabe) && !r.laeuft) l.push({ art: "Workflow", id: r.routine.id, text: `„${r.routine.name}“, Schritt ${r.wartetFreigabe + 1}: ${r.routine.schritte[r.wartetFreigabe]}`, freigebbar: true, los: () => wfFreigeben() });
  if (typeof offeneAktion !== "undefined" && offeneAktion) l.push({ art: "Rückfrage", id: offeneAktion.skill, text: offeneAktion.beschreibung || offeneAktion.skill, freigebbar: true, los: () => jarvisAntwort("Ja"), nein: () => jarvisAntwort("Nein") });
  return l;
}
function freigabenAnzeigen() {
  const ul = document.getElementById("frg-liste");
  if (!ul) return;
  const l = freigabenOffen(), zahl = document.getElementById("frg-zahl");
  if (zahl) zahl.textContent = l.length ? `(${l.length})` : "";
  const knopf = (t, f, label) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: t }); b.setAttribute("aria-label", label); b.addEventListener("click", () => { f(); setTimeout(freigabenAnzeigen, 50); }); return b; };
  ul.replaceChildren(...(l.length ? l.map((x) => {
    const li = Object.assign(document.createElement("li"), { textContent: `${x.art}: ${x.text} ` });
    if (x.freigebbar) li.append(knopf(x.art === "Rückfrage" ? "Ja" : "Freigeben", x.los, `${x.art === "Rückfrage" ? "Ja" : "Freigeben"}: ${x.art} ${x.id}`));
    if (x.nein) li.append(knopf("Nein", x.nein, "Nein: Rückfrage " + x.id));
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "Nichts wartet auf deine Freigabe." })]));
}
// Ergebniszusammenfassung: nach jedem Auftrag die nicht erledigten Schritte mit Grund
if (typeof auftragAusfuehren === "function") {
  const original = auftragAusfuehren;
  auftragAusfuehren = async function (id) {
    const r = await original.apply(this, arguments);
    try {
      const a = auftragStand.liste.find((x) => x.id === id);
      if (r && a && a.status === "fehler") {
        const offen = a.schritte.filter((s) => s.status !== "erledigt");
        lokalAntworten(`Nicht erledigt in ${a.id}: ` + offen.map((s) => `Schritt ${s.nr} „${s.text.slice(0, 50)}“ – ${{ blockiert: "blockiert", fehler: "Fehler", uebersprungen: "übersprungen" }[s.status] || s.status}${s.ergebnis && s.ergebnis !== s.status ? ": " + String(s.ergebnis).slice(0, 80) : ""}`).join("; ") + ". Die übrigen Schritte sind erledigt.");
      }
      freigabenAnzeigen();
    } catch (e) { /* Zusammenfassung ist Zusatz */ }
    return r;
  };
}
// ab 11-12e: „Fortsetzen“ direkt nach „Pausieren“ ging verloren, solange der laufende Schritt noch arbeitete (auftragAusfuehren kehrte
// sofort zurück, der alte Durchlauf brach danach wegen der Pause ab – der Auftrag blieb „pausiert“). Jetzt wird die Fortsetzung
// vorgemerkt und nach Ende des laufenden Durchlaufs ausgeführt; eine erneute Pause hebt die Vormerkung auf.
const FRG = { fortsetzen: new Set() };
if (typeof auftragFortsetzen === "function") {
  const original = auftragFortsetzen;
  auftragFortsetzen = function (id) { const r = original.apply(this, arguments); if (r && typeof auftragLaeuft !== "undefined" && auftragLaeuft) FRG.fortsetzen.add(id); return r; };
}
if (typeof auftragPausieren === "function") {
  const original = auftragPausieren;
  auftragPausieren = function (id) { FRG.fortsetzen.delete(id); return original.apply(this, arguments); };
}
if (typeof auftragAusfuehren === "function") {
  const original = auftragAusfuehren;
  auftragAusfuehren = async function (id) {
    // ab 11-12e: läuft schon ein Durchlauf, NICHT neu laden – das Original lädt den Stand vor seiner eigenen „läuft schon“-Prüfung neu,
    // wodurch der laufende Durchlauf an abgekoppelten Objekten weiterarbeitete und sein Ergebnis verloren ging (reproduziert: Schritt blieb „läuft“)
    if (typeof auftragLaeuft !== "undefined" && auftragLaeuft) return false;
    const r = await original.apply(this, arguments);
    for (const v of [...FRG.fortsetzen]) {
      const a = auftragStand.liste.find((x) => x.id === v);
      if (!a || a.status !== "pausiert") { FRG.fortsetzen.delete(v); continue; }
      if (typeof auftragLaeuft !== "undefined" && auftragLaeuft) break;
      FRG.fortsetzen.delete(v);
      auftragAusfuehren(v);
      break;
    }
    return r;
  };
}
if (typeof auftraegeAnzeigen === "function") {
  const original = auftraegeAnzeigen;
  auftraegeAnzeigen = function (...a) { const r = original.apply(this, a); try { freigabenAnzeigen(); } catch (e) { /* Zusatz */ } return r; };
}
// ---------- ab 11-13a: mehrere Tabs – Zusammenführen statt Überschreiben, kein Neuladen während eines Laufs, ein Lauf tabübergreifend ----------
// Reproduziert (Test „Zwei Tabs 13a“): Speicherte ein anderer Tab, während hier ein Auftrag lief, lud das storage-Ereignis den Stand neu;
// der laufende Durchlauf arbeitete an abgekoppelten Objekten weiter und sein Ergebnis ging verloren, und das nächste Speichern
// überschrieb den Auftrag des anderen Tabs. Regeln jetzt:
//   - während eines Laufs wird nicht neu geladen, sondern Fremdes zusammengeführt (neue Aufträge übernommen, neuere Stände anderer
//     Aufträge übernommen; beim laufenden Auftrag nur ein Abbruch/eine Pause von außen – mit Meldung)
//   - vor jedem Speichern dasselbe Zusammenführen: ein neuerer Stand eines anderen Tabs wird nie überschrieben (Vergleich über „geaendert“)
//   - Ausführung über eine Web-Lock-Sperre „jarvis-auftrag-lauf“: läuft in einem Tab ein Auftrag, wartet ein anderer und liest danach frisch
//     (ein dort schon erledigter oder abgebrochener Auftrag läuft nicht noch einmal)
const ASYNC = { laufendId: null, ausstehend: false, bekannt: null, meldungen: [] };
function auftragFremd() {
  let roh = null; try { roh = localStorage.getItem(AUFTRAG.schluessel); } catch (e) { return null; }
  if (!roh || roh === ASYNC.bekannt) return null;
  try { const d = JSON.parse(roh); return istObjekt(d) && d.art === "jarvis-auftraege" && Array.isArray(d.liste) && Array.isArray(d.protokoll) ? d : null; } catch (e) { return null; }
}
// Lauf-Sperre zusätzlich im gemeinsamen Speicher: Web Locks werden zwischen file://-Dokumenten nicht geteilt (im Test reproduziert),
// der localStorage schon. Kurzlebig: alle 5 s erneuert, nach 15 s verfallen (abgestürzter Tab blockiert nicht dauerhaft).
const ASPERRE = { schluessel: "jarvis-auftrag-lauf", tab: "T" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), dauerMs: 15000, erneuernMs: 5000, wartenMs: 250, gemeldet: false };
function auftragSperreLesen() { try { const d = JSON.parse(localStorage.getItem(ASPERRE.schluessel) || "null"); return istObjekt(d) && typeof d.tab === "string" && Number.isFinite(d.bis) ? d : null; } catch (e) { return null; } }
function auftragSperreSchreiben() { try { localStorage.setItem(ASPERRE.schluessel, JSON.stringify({ tab: ASPERRE.tab, bis: Date.now() + ASPERRE.dauerMs })); } catch (e) { /* gesperrt */ } }
function auftragSperreFreigeben() { const d = auftragSperreLesen(); if (d && d.tab === ASPERRE.tab) try { localStorage.removeItem(ASPERRE.schluessel); } catch (e) { /* gesperrt */ } }
async function auftragSperreHolen(id) {
  for (;;) {
    const d = auftragSperreLesen();
    if (!d || d.bis < Date.now() || d.tab === ASPERRE.tab) {
      auftragSperreSchreiben();
      await new Promise((ok) => setTimeout(ok, 30));
      const pruef = auftragSperreLesen();
      if (pruef && pruef.tab === ASPERRE.tab) { ASPERRE.gemeldet = false; return; }
    } else if (!ASPERRE.gemeldet && typeof lokalAntworten === "function") { ASPERRE.gemeldet = true; lokalAntworten(`Auftrag ${id} wartet: In einem anderen Tab läuft gerade ein Auftrag. Er startet hier danach (frisch gelesen, ohne doppelte Schritte).`); }
    await new Promise((ok) => setTimeout(ok, ASPERRE.wartenMs));
  }
}const azeit = (a) => Date.parse((a && a.geaendert) || 0) || 0;
function auftragZusammenfuehren(fremd) {
  if (!fremd) return 0;
  let n = 0;
  for (const f of fremd.liste) {
    if (!istObjekt(f) || typeof f.id !== "string" || !Array.isArray(f.schritte)) continue;
    const i = auftragStand.liste.findIndex((x) => x.id === f.id), e = i >= 0 ? auftragStand.liste[i] : null;
    if (!e) { auftragStand.liste.push(f); n++; continue; }
    if (azeit(f) <= azeit(e)) continue;
    if (f.id === ASYNC.laufendId) {
      if (e.status === "laeuft" && ["abgebrochen", "pausiert"].includes(f.status)) {
        e.status = f.status; e.geaendert = f.geaendert;
        if (f.status === "abgebrochen") for (const s of e.schritte) if (s.status === "offen") { s.status = "abgebrochen"; s.ergebnis = "in einem anderen Tab abgebrochen"; }
        ASYNC.meldungen.push(`Auftrag ${e.id} wurde in einem anderen Tab ${f.status === "abgebrochen" ? "abgebrochen" : "pausiert"} – hier nach dem laufenden Schritt angehalten.`);
        n++;
      }
      continue;
    }
    auftragStand.liste[i] = f; n++;
  }
  const schl = (p) => `${p.zeit}|${p.auftrag}|${p.text}`, da = new Set(auftragStand.protokoll.map(schl));
  for (const p of fremd.protokoll) if (istObjekt(p) && !da.has(schl(p))) { auftragStand.protokoll.push(p); da.add(schl(p)); }
  auftragStand.protokoll.sort((x, y) => String(x.zeit).localeCompare(String(y.zeit)));
  return n;
}
if (typeof auftraegeLesen === "function") {
  const original = auftraegeLesen;
  auftraegeLesen = function () {
    if (typeof auftragLaeuft !== "undefined" && auftragLaeuft) { auftragZusammenfuehren(auftragFremd()); ASYNC.ausstehend = true; return auftragStand; }
    const r = original.apply(this, arguments);
    try { ASYNC.bekannt = localStorage.getItem(AUFTRAG.schluessel); } catch (e) { /* gesperrt */ }
    return r;
  };
}
if (typeof auftraegeSpeichern === "function") {
  const original = auftraegeSpeichern;
  auftraegeSpeichern = function () {
    if (!speicherBeschaedigt(AUFTRAG.schluessel)) auftragZusammenfuehren(auftragFremd());
    const r = original.apply(this, arguments);
    try { ASYNC.bekannt = localStorage.getItem(AUFTRAG.schluessel); } catch (e) { /* gesperrt */ }
    return r;
  };
}
// Kennungen tabübergreifend eindeutig: der Zähler war je Tab und begann bei 1 – zwei Tabs vergaben in derselben Sekunde „A…-1“
// (reproduziert). Vor dem Anlegen Fremdes zusammenführen und den Zähler über alle bekannten Aufträge hinaus setzen; Format unverändert.
if (typeof auftragAnlegen === "function") {
  const original = auftragAnlegen;
  auftragAnlegen = function () {
    if (!speicherBeschaedigt(AUFTRAG.schluessel)) auftragZusammenfuehren(auftragFremd());
    const hoechste = auftragStand.liste.reduce((m, a) => { const z = /-(\d+)$/.exec(a.id || ""); return z ? Math.max(m, Number(z[1])) : m; }, 0);
    if (AUFTRAG.nummer < hoechste) AUFTRAG.nummer = hoechste;
    return original.apply(this, arguments);
  };
}if (typeof auftragAusfuehren === "function") {
  const original = auftragAusfuehren;
  auftragAusfuehren = async function (id) {
    if (typeof auftragLaeuft !== "undefined" && auftragLaeuft) return false; // nie auf die eigene Sperre warten
    const lauf = async () => {
      await auftragSperreHolen(id);
      const erneuern = setInterval(() => auftragSperreSchreiben(), ASPERRE.erneuernMs);
      ASYNC.laufendId = id;
      try { auftraegeLesen(); return await original.call(this, id); } finally { ASYNC.laufendId = null; clearInterval(erneuern); auftragSperreFreigeben(); }
    };
    const r = navigator.locks && typeof navigator.locks.request === "function" ? await navigator.locks.request("jarvis-auftrag-lauf", lauf) : await lauf();
    if (ASYNC.ausstehend) { ASYNC.ausstehend = false; auftraegeLesen(); auftraegeAnzeigen(); }
    for (const m of ASYNC.meldungen.splice(0)) if (typeof lokalAntworten === "function") lokalAntworten(m);
    return r;
  };
}
skillRegistrieren({
  name: "freigaben-offen", risiko: "abfrage", hilfeKurz: "Offene Freigaben",
  beschreibung: "Zeigt, was auf deine Freigabe wartet (Aufträge, Workflows, Rückfragen)", beispiele: ["Was wartet auf meine Freigabe?"],
  passt: (text) => /^(was wartet auf (meine |eine )?freigabe|offene freigaben|zeige?( mir)? (die |meine )?offenen freigaben|was muss ich (noch )?freigeben)$/.test(befehlNormalisieren(text)),
  aktion: async () => { const l = freigabenOffen(); lokalAntworten(l.length ? "Wartet auf dich: " + l.map((x) => `${x.art} ${x.text}`).join("; ") + ". Freigeben nur per Knopf in „Aufträge“ bzw. mit „Ja“." : "Nichts wartet auf deine Freigabe."); return true; },
});
(function frgEinordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();
(function frgEinrichten() {
  const d = document.getElementById("auftrag-details");
  if (d) d.addEventListener("toggle", () => freigabenAnzeigen());
  setInterval(() => { if (!document.hidden) { try { freigabenAnzeigen(); } catch (e) { /* ab 11-12e: Hintergrundanzeige */ } } }, 30000);
  freigabenAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("freigaben");
