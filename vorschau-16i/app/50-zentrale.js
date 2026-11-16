// JARVIS Dashboard – Modul „zentrale“ (ab 11-10a). Gesamtintegration der vorhandenen Assistentenfunktionen:
//   - Aufträge ↔ Sprache: Umgangssprache wird je Auftragsteil verstanden („Kannst du bitte … und dann …“)
//   - Aufträge ↔ Projekte/Aufgaben: „Neue Aufgabe … für Projekt …“ legt eine Projektaufgabe an (auch als Auftragsschritt)
//   - Aufträge ↔ Workflows: „Als Workflow speichern“ macht aus einem Auftrag eine geprüfte Routine
//   - zentrale Übersicht laufender Prozesse (KI-Anfrage, Vorlesen, Spracheingabe, Rückfrage, Aufträge, Workflow, Analyse,
//     Automatik) mit Fortschritt, Fortsetzen und einem gemeinsamen „Alles Lokale anhalten“ (Not-Aus und Automatik-Stopp bleiben getrennt)
//   - zentrale Fähigkeitenübersicht nach Bereichen; einheitliche Statusmeldung (✓ / ⚠ / ✖ / ℹ)
// Keine Anfrage, kein Speicher.
const ZENTRALE = { bereiche: {
  Aufgaben: ["aufgabe-anlegen", "aufgabe-loeschen", "aufgaben-zeigen", "aufgabe-erledigen", "planung", "projekt-aufgabe"],
  Projekte: ["projekt-status", "projekt-anlegen"], Notizen: ["notiz-anlegen", "notizen-suchen", "notiz-loeschen"], Dateien: ["dateien", "dokumente", "dokument-suche"],
  Gedächtnis: ["profil-merken", "profil-anzeigen", "profil-vergessen"], Abläufe: ["routine", "briefing"], Aktien: ["aktien", "aktien-watchlist", "aktien-alarm", "aktien-strategie-dialog", "ueberblick-aktien"],
  "Paper (Krypto)": ["paper"], Rechnen: ["rechner"], Navigation: ["ansicht", "navigation"], "PC und Haus": ["pc-oeffnen", "pc-info", "haus-schalten"], Gespräch: ["hilfe", "abbruch", "korrektur", "recherche", "prozesse", "anhalten"],
} };
// einheitliche Statusmeldung
const ZENTRALE_ZEICHEN = { ok: "✓", warn: "⚠", fehler: "✖", info: "ℹ" };
function jarvisStatus(el, art, text) { if (!el) return ""; el.textContent = `${ZENTRALE_ZEICHEN[art] || ""} ${text}`.trim(); el.dataset.art = art; return el.textContent; }
// ---------- Aufträge ↔ Sprache ----------
if (typeof auftragTeile === "function") {
  const original = auftragTeile;
  auftragTeile = function (text) {
    return original(text).map((t) => {
      if (typeof sprachNormalisieren !== "function" || SKILLS.some((s) => s.passt(t.text))) return t;
      const n = sprachNormalisieren(t.text);
      return n.geaendert && SKILLS.some((s) => s.passt(n.text)) ? { ...t, text: n.text, original: t.text } : t;
    });
  };
}
// ---------- Aufgaben im Projekt ----------
skillRegistrieren({
  name: "projekt-aufgabe",
  risiko: "leicht",
  hilfeKurz: "Projektaufgabe",
  beschreibung: "Aufgabe in einem Projekt erstellen (rückgängig: Aufgabe löschen)",
  beispiele: ["Neue Aufgabe Kartons kaufen für Projekt Umzug"],
  passt: (text) => /^(neue aufgabe|aufgabe anlegen) .+ (für das|für|fürs|im|zum) projekt \S.*$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const roh = String(text).replace(/^\s*(hey\s+)?jarvis[\s,]+/i, "").replace(/^\s*(neue aufgabe|aufgabe anlegen)\s*[:,]?\s*/i, "").replace(/[.!]+\s*$/, "");
    const m = /^(.+?)\s+(?:für das|für|fürs|im|zum)\s+projekt\s+(.+)$/i.exec(roh);
    if (!m || typeof projektFinden !== "function") return false;
    projekteLesen();
    const p = projektFinden(m[2].trim()) || projektStand.projekte.find((x) => projektNorm(x.name).includes(projektNorm(m[2])));
    if (!p) { lokalAntworten(`Ein Projekt „${m[2].trim()}“ gibt es nicht – es wurde nichts angelegt. Vorhanden: ${projektStand.projekte.map((x) => x.name).join(", ") || "keine"}.`); return true; }
    const z = typeof zeitangabeErkennen === "function" ? zeitangabeErkennen(m[1]) : null;
    if (z && z.rueckfrage) { lokalAntworten("Zeitangabe nicht eindeutig: " + z.rueckfrage); return true; }
    const titel = (z && z.datum ? z.rest : m[1]).trim();
    const ok = projektAufgabe(p.id, titel, z && z.datum ? z.datum.toISOString() : "");
    lokalAntworten(ok ? `Aufgabe „${titel}“ im Projekt „${p.name}“ angelegt${z && z.datum ? " (fällig " + z.beschreibung + ")" : ""}.` : (PROJEKT.letzterFehler || "Aufgabe nicht angelegt.") + " Es wurde nichts angelegt.");
    PROJEKT.letzterFehler = null;
    return true;
  },
});
// ---------- Prozesse ----------
function jarvisProzesse() {
  const p = [], el = (id) => document.getElementById(id);
  if (el("abbrechen") && !el("abbrechen").hidden) p.push({ art: "KI-Anfrage", text: "wartet auf die Antwort des Workers", anhalten: () => el("abbrechen").click() });
  if (el("vorlesen-stopp") && !el("vorlesen-stopp").disabled) p.push({ art: "Vorlesen", text: "liest vor", anhalten: () => vorlesenStoppen() });
  if (typeof window.spracheingabeLaeuft === "function" && window.spracheingabeLaeuft()) p.push({ art: "Spracheingabe", text: "Mikrofon aktiv", anhalten: () => window.spracheingabeAbbrechen("abbruch") });
  if (typeof offeneAktion !== "undefined" && offeneAktion) p.push({ art: "Rückfrage", text: offeneAktion.beschreibung ? String(offeneAktion.beschreibung).slice(0, 120) : "wartet auf Ja/Nein", anhalten: () => offeneAktionAbbrechen() });
  if (typeof paperOffen !== "undefined" && paperOffen) p.push({ art: "Paper-Rückfrage", text: "wartet auf „Ja“ oder „Nein“ (läuft nach Ablauf selbst ab)" });
  for (const a of typeof auftragStand !== "undefined" ? auftragStand.liste : []) {
    if (!["laeuft", "wartet", "pausiert", "warteschlange"].includes(a.status)) continue;
    const fertig = a.schritte.filter((s) => ["erledigt", "uebersprungen", "blockiert", "fehler"].includes(s.status)).length;
    p.push({ art: "Auftrag " + a.id, text: `${a.status} – ${a.text.slice(0, 60)}`, fortschritt: [fertig, a.schritte.length], anhalten: a.status === "laeuft" ? () => auftragPausieren(a.id) : null,
      fortsetzen: a.status === "pausiert" ? () => auftragFortsetzen(a.id) : null });
  }
  const l = typeof routineLauf !== "undefined" ? routineLauf : null;
  if (l && (l.laeuft || Number.isInteger(l.wartetFreigabe) || l.pausiert)) {
    const fertig = l.status.filter((s) => s === "erledigt" || s === "uebersprungen").length;
    p.push({ art: "Workflow „" + l.routine.name + "“", text: l.laeuft ? "läuft" : Number.isInteger(l.wartetFreigabe) ? "wartet auf Freigabe" : "angehalten", fortschritt: [fertig, l.status.length],
      anhalten: l.laeuft ? () => { if (typeof wfPausieren === "function") wfPausieren(); else l.abbrechen = true; } : null, fortsetzen: !l.laeuft && l.pausiert && typeof wfFortsetzen === "function" ? () => wfFortsetzen() : null });
  }
  const u = typeof wfUnterbrochen === "function" ? wfUnterbrochen() : null;
  if (u && !u.ungueltig && !(l && l.laeuft)) p.push({ art: "Workflow „" + u.name + "“", text: "beim Neuladen unterbrochen", fortsetzen: () => wfWiederaufnehmen() });
  if (typeof ABLAUF !== "undefined" && ABLAUF.laeuft) p.push({ art: "Aktienanalyse", text: "läuft (Zeitlimit " + Math.round(ABLAUF.zeitlimitMs / 1000) + " s)" });
  if (typeof autoStand !== "undefined" && autoStand.stopp) p.push({ art: "Automatisierungen", text: "global gestoppt (Schalter in „Automatisierungen“)" });
  return p;
}
// Hält alles Lokale an: KI-Anfrage, Vorlesen, Spracheingabe, Rückfrage, laufende Aufträge und Workflows. Not-Aus, Automatik-Stopp
// und Paper-Rückfragen bleiben bei ihren eigenen Schaltern.
function jarvisAllesAnhalten() {
  const angehalten = [];
  for (const x of jarvisProzesse()) { if (!x.anhalten) continue; try { x.anhalten(); angehalten.push(x.art); } catch (e) { /* weiter */ } }
  aktivitaetAnzeigen();
  return angehalten;
}
// ---------- Aufträge → Workflow ----------
function auftragAlsWorkflow(id) {
  const a = typeof auftragFinden === "function" ? auftragFinden(id) : null;
  if (!a) return { fehler: "Auftrag nicht gefunden." };
  const schritte = a.schritte.map((s) => s.text);
  let name = ("Aus Auftrag: " + a.text).slice(0, 60);
  for (let n = 2; routinen.some((r) => r.name.toLowerCase() === name.toLowerCase()); n++) name = ("Aus Auftrag " + n + ": " + a.text).slice(0, 60);
  routineBearbeitet = null;
  const f = routinePruefen(name, schritte);
  if (f.length) return { fehler: "Nicht als Workflow möglich: " + f[0] };
  routinen.push(routineNeu(name, schritte));
  routinenSpeichern(); routinenAnzeigen();
  return { name };
}
if (typeof auftraegeAnzeigen === "function") {
  const original = auftraegeAnzeigen;
  auftraegeAnzeigen = function (...x) {
    const r = original.apply(this, x);
    for (const li of document.querySelectorAll("#auftrag-liste > li[data-id]")) {
      if (li.querySelector(".zentrale-workflow")) continue;
      const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter zentrale-workflow", textContent: "Als Workflow speichern" });
      b.setAttribute("aria-label", "Als Workflow speichern: Auftrag " + li.dataset.id);
      b.addEventListener("click", () => { const e = auftragAlsWorkflow(li.dataset.id), m = document.getElementById("auftrag-meldung"); jarvisStatus(m, e.fehler ? "fehler" : "ok", e.fehler || `Als Workflow „${e.name}“ gespeichert (unter „Routinen“, geprüft wie jede Routine).`); });
      li.append(b);
    }
    aktivitaetAnzeigen();
    return r;
  };
}
for (const name of ["routineAblaufAnzeigen", "autoAnzeigen"]) {
  if (typeof window[name] !== "function") continue;
  const original = window[name];
  window[name] = function (...x) { const r = original.apply(this, x); try { aktivitaetAnzeigen(); } catch (e) { /* Anzeige */ } return r; };
}
// ---------- Anzeige ----------
function aktivitaetAnzeigen() {
  const ul = document.getElementById("akt-liste");
  if (!ul) return;
  const p = jarvisProzesse();
  const knopf = (t, label, f) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: t }); b.setAttribute("aria-label", label); b.addEventListener("click", () => { f(); aktivitaetAnzeigen(); }); return b; };
  ul.replaceChildren(...(p.length ? p.map((x) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: `${x.art}: ${x.text}` }));
    if (x.fortschritt) { const pr = Object.assign(document.createElement("progress"), { max: x.fortschritt[1], value: x.fortschritt[0] }); pr.setAttribute("aria-label", `Fortschritt ${x.art}: ${x.fortschritt[0]} von ${x.fortschritt[1]}`); li.append(pr); }
    if (x.anhalten) li.append(knopf("Anhalten", "Anhalten: " + x.art, x.anhalten));
    if (x.fortsetzen) li.append(knopf("Fortsetzen", "Fortsetzen: " + x.art, x.fortsetzen));
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "Nichts läuft gerade." })]));
  document.getElementById("akt-anhalten").disabled = !p.some((x) => x.anhalten);
}
function faehigkeitenNachBereich() {
  const zugeordnet = new Set(Object.values(ZENTRALE.bereiche).flat()), g = {};
  for (const [b, namen] of Object.entries(ZENTRALE.bereiche)) g[b] = SKILLS.filter((s) => namen.includes(s.name) && s.name !== "gesperrt");
  const rest = SKILLS.filter((s) => !zugeordnet.has(s.name) && s.name !== "gesperrt");
  if (rest.length) g.Weitere = rest;
  return g;
}
function faehigkeitenAnzeigen10() {
  const box = document.getElementById("akt-faehigkeiten");
  if (!box) return;
  const g = faehigkeitenNachBereich();
  box.replaceChildren(...Object.entries(g).filter(([, l]) => l.length).map(([b, l]) => {
    const d = document.createElement("li");
    d.append(Object.assign(document.createElement("b"), { textContent: b + ": " }), document.createTextNode(l.map((s) => {
      const nv = typeof werkzeugVerfuegbarkeit === "function" ? werkzeugVerfuegbarkeit(s) : null;
      return `${s.beschreibung} [${RISIKO_TEXT[skillRisiko(s)]}]${nv ? " (" + nv + ")" : ""}${s.beispiele && s.beispiele[0] ? " – „" + s.beispiele[0] + "“" : ""}`;
    }).join(" · ")));
    return d;
  }));
}
skillRegistrieren({
  name: "prozesse",
  risiko: "abfrage",
  hilfeKurz: "„Was läuft gerade?“",
  beschreibung: "Laufende Prozesse nennen (Aufträge, Workflows, Vorlesen, Rückfragen …)",
  beispiele: ["Was läuft gerade?"],
  passt: (text) => /^(was läuft( gerade| grad| im moment)?|was laeuft( gerade)?|laufende (prozesse|aufträge|auftraege)|was machst du gerade)$/.test(befehlNormalisieren(text)),
  aktion: async () => { const p = jarvisProzesse(); lokalAntworten(p.length ? "Gerade aktiv:\n" + p.map((x) => `• ${x.art}: ${x.text}${x.fortschritt ? ` (${x.fortschritt[0]} von ${x.fortschritt[1]})` : ""}`).join("\n") : "Gerade läuft nichts, Sir."); return true; },
});
skillRegistrieren({
  name: "anhalten",
  risiko: "leicht",
  hilfeKurz: "„Alles anhalten“",
  beschreibung: "Alles Lokale anhalten (Aufträge, Workflows, Vorlesen, Rückfragen; nicht Not-Aus)",
  beispiele: ["Alles anhalten"],
  passt: (text) => /^(alles (anhalten|stoppen|abbrechen|pausieren)|halte alles an|stoppe alles lokale|alle aufträge anhalten)$/.test(befehlNormalisieren(text)),
  aktion: async () => { const a = jarvisAllesAnhalten(); lokalAntworten(a.length ? "Angehalten: " + a.join(", ") + ". Not-Aus und Automatik-Schalter sind davon unberührt." : "Es lief nichts, das ich anhalten könnte."); return true; },
});
// „projekt-aufgabe“ vor „aufgabe-anlegen“ (sonst würde der ganze Satz zum Aufgabentitel), die übrigen vor die Navigation
(function zentraleEinordnen() {
  const neu = SKILLS.splice(SKILLS.length - 3, 3), pa = neu.shift();
  SKILLS.splice(SKILLS.findIndex((x) => x.name === "aufgabe-anlegen"), 0, pa);
  const nav = SKILLS.findIndex((x) => x.name === "navigation");
  SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, ...neu);
})();
(function zentraleEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("akt-liste")) return;
  el("akt-anhalten").addEventListener("click", () => { const a = jarvisAllesAnhalten(); jarvisStatus(el("akt-meldung"), a.length ? "ok" : "info", a.length ? "Angehalten: " + a.join(", ") + "." : "Es lief nichts."); });
  el("akt-details").addEventListener("toggle", () => { if (el("akt-details").open) { aktivitaetAnzeigen(); faehigkeitenAnzeigen10(); } });
  setInterval(() => { if (el("akt-details").open) { try { aktivitaetAnzeigen(); } catch (e) { /* ab 11-12e: Hintergrundanzeige */ } } }, 2000);
  aktivitaetAnzeigen(); faehigkeitenAnzeigen10();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("zentrale");
