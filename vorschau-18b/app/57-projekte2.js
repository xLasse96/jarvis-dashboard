// JARVIS Dashboard – Modul „projekte2“ (ab 11-10h). Projektmanager 2.0 – ergänzt 38-projekte.js (Vorlagen, Meilensteine,
// Abhängigkeiten, Prioritäten, Risiken, Dateien, Woche, Filter, Suche, Import/Export, Bericht, doppelte Aufgaben gibt es dort schon):
//   - Projektvergleich: alle offenen Projekte nebeneinander (als Liste, damit es auch auf schmalen Bildschirmen passt)
//   - blockierte Posten über alle aktiven Projekte: Aufgaben, die auf eine offene Aufgabe warten (10f), und blockierte Meilensteine
//   - Projektchronik: Verlauf, erledigte Aufgaben und Projektnotizen zeitlich sortiert
//   - Projektnotiz: legt eine normale Notiz mit der Projektkategorie an (erscheint so auch in der Projektübersicht)
//   - Sprache: „Vergleiche meine Projekte“, „Was ist blockiert?“, „Chronik Projekt …“, „Notiz zu Projekt …: …“, „Statusbericht Projekt …“
// Eigener Speicher: keiner (liest jarvis-projekte, jarvis-aufgaben, jarvis-notizen).
const PROJ2 = { maxChronik: 40 };
const proj2Offen = () => projekteLesen().projekte.filter((p) => p.status === "aktiv" || p.status === "pausiert");
function projektVergleich(jetzt = new Date()) {
  const rang = { hoch: 0, normal: 1, niedrig: 2 };
  return proj2Offen().map((p) => {
    const u = projektUebersicht(p, jetzt);
    return { id: p.id, name: p.name, status: p.status, prio: p.prio || "normal", faellig: p.faellig || "", fortschritt: u.fortschritt, offen: u.aufgaben - u.erledigt, meilensteine: `${u.meilensteineErledigt}/${u.meilensteine}`, blockiert: u.blockiert.length, risiken: u.risiken, naechster: u.naechster ? u.naechster.titel : "" };
  }).sort((a, b) => (a.status === b.status ? 0 : a.status === "aktiv" ? -1 : 1) || rang[a.prio] - rang[b.prio] || (a.faellig || "9999").localeCompare(b.faellig || "9999"));
}
function projekteBlockiert() {
  const alle = window.aufgabenIntern ? window.aufgabenIntern.liste() : [], r = [];
  for (const p of projekteLesen().projekte.filter((x) => x.status === "aktiv")) {
    const n = projektNorm(p.name), u = projektUebersicht(p);
    for (const a of alle.filter((x) => !x.erledigt && projektNorm(x.kategorie) === n)) {
      const v = typeof tplanWartet === "function" ? tplanWartet(a, alle) : null;
      if (v) r.push({ projekt: p.name, art: "Aufgabe", titel: a.titel, wartetAuf: v.titel });
    }
    for (const b of u.blockiert) r.push({ projekt: p.name, art: "Meilenstein", titel: b.titel, wartetAuf: b.wartetAuf });
  }
  return r;
}
function projektChronik(p) {
  const n = projektNorm(p.name), e = [];
  for (const v of projekteLesen().verlauf.filter((x) => projektNorm(x.projekt) === n)) e.push({ zeit: v.zeit, text: v.was });
  for (const a of (window.aufgabenIntern ? window.aufgabenIntern.liste() : []).filter((x) => x.erledigt && x.erledigtAm && projektNorm(x.kategorie) === n)) e.push({ zeit: a.erledigtAm, text: `Aufgabe „${a.titel}“ erledigt` });
  for (const x of (typeof notizenSuchen === "function" ? notizenSuchen("", "", "") : []).filter((y) => projektNorm(y.kategorie) === n)) e.push({ zeit: x.erstellt || x.geaendert, text: `Notiz „${x.titel}“` });
  return e.filter((x) => x.zeit && !isNaN(Date.parse(x.zeit))).sort((a, b) => b.zeit.localeCompare(a.zeit)).slice(0, PROJ2.maxChronik);
}
function projektNotiz(id, text) {
  const p = projekteLesen().projekte.find((x) => x.id === id), t = String(text || "").trim();
  if (!p) return { fehler: "Projekt nicht gefunden." };
  if (!t) return { fehler: "Kein Notiztext." };
  if (typeof notizSichern !== "function") return { fehler: "Notizen sind nicht verfügbar." };
  const r = notizSichern({ titel: `${p.name}: ${t.slice(0, 50)}`, text: t, kategorie: p.name });
  if (r.fehler) return r;
  projektMerken(p, `Notiz „${t.slice(0, 50)}“`); projekteSpeichern();
  return r;
}
const proj2Suchen = (name) => { const n = projektNorm(name).replace(/^(das |dem |den )/, ""); return projektFinden(n) || projekteLesen().projekte.find((x) => projektNorm(x.name).includes(n)) || null; };
function proj2Anzeigen(jetzt = new Date()) {
  const el = (id) => document.getElementById(id), det = el("proj2-details");
  if (!det || !det.open) return;
  if (speicherBeschaedigt(PROJEKT.schluessel)) { el("proj2-vergleich").replaceChildren(Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: "Projektdaten beschädigt – " + SPEICHER_SCHADEN_TEXT })); return; }
  const li = (t, k = "") => Object.assign(document.createElement("li"), { textContent: t, className: k });
  const v = projektVergleich(jetzt);
  el("proj2-vergleich").replaceChildren(...(v.length ? v.map((x) => li(`${x.name} · ${x.status} · Priorität ${x.prio} · ${x.fortschritt} % · ${x.offen} offen · Meilensteine ${x.meilensteine}${x.faellig ? " · bis " + new Date(x.faellig).toLocaleDateString("de-DE") : ""}${x.blockiert ? ` · ${x.blockiert} blockiert` : ""}${x.risiken.length ? " · ⚠ " + x.risiken.join(", ") : ""}`, x.risiken.length ? "wz-wichtig" : "")) : [li("Keine offenen Projekte.")]));
  const b = projekteBlockiert();
  el("proj2-blockiert").replaceChildren(...(b.length ? b.map((x) => li(`${x.projekt}: ${x.art} „${x.titel}“ wartet auf „${x.wartetAuf}“`)) : [li("Nichts blockiert.")]));
  const sel = el("proj2-projekt"), alt = sel.value, alle = projekteLesen().projekte;
  sel.replaceChildren(...(alle.length ? alle.map((p) => Object.assign(document.createElement("option"), { value: p.id, textContent: p.name, selected: p.id === alt })) : [Object.assign(document.createElement("option"), { value: "", textContent: "– kein Projekt –" })]));
  const p = alle.find((x) => x.id === sel.value);
  el("proj2-chronik").replaceChildren(...(p ? projektChronik(p) : []).map((x) => li(`${new Date(x.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} · ${x.text}`)));
  el("proj2-notiz-los").disabled = !p;
}
skillRegistrieren({
  name: "projekt-auswertung",
  risiko: "leicht",
  hilfeKurz: "Projektvergleich",
  beschreibung: "Projekte vergleichen, Blockiertes, Chronik, Projektnotiz, Statusbericht",
  beispiele: ["Vergleiche meine Projekte", "Was ist blockiert?", "Notiz zu Projekt Umzug: Kartons bestellen"],
  passt: (text) => /^(vergleiche?( meine| die)? projekte|projektvergleich|was ist blockiert|blockierte (aufgaben|projekte|posten)|(projekt)?chronik (von |des |zum )?(projekt(s)? )?\S.*|notiz zu(m)? projekt \S.*|statusbericht (für |zum |von )?(projekt )?\S.*)$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const t = befehlNormalisieren(text), roh = String(text).trim().replace(/^\s*(hey\s+)?jarvis[\s,]+/i, "");
    if (/^(vergleiche?|projektvergleich)/.test(t)) {
      const v = projektVergleich();
      lokalAntworten(v.length ? "Projektvergleich:\n" + v.map((x) => `• ${x.name} (${x.status}, ${x.prio}): ${x.fortschritt} %, ${x.offen} offen${x.blockiert ? `, ${x.blockiert} blockiert` : ""}${x.risiken.length ? " ⚠ " + x.risiken.join(", ") : ""}`).join("\n") : "Keine offenen Projekte zum Vergleichen.");
      return true;
    }
    if (/blockiert/.test(t)) { const b = projekteBlockiert(); lokalAntworten(b.length ? "Blockiert:\n" + b.map((x) => `• ${x.projekt}: „${x.titel}“ wartet auf „${x.wartetAuf}“`).join("\n") : "In deinen aktiven Projekten ist nichts blockiert."); return true; }
    const notiz = /^notiz zu(?:m)? projekt\s+(.+?)\s*:\s*(.+)$/i.exec(roh);
    if (/^notiz/.test(t)) {
      if (!notiz) { lokalAntworten("Bitte so: „Notiz zu Projekt Umzug: Kartons bestellen“. Es wurde nichts gespeichert."); return true; }
      const p = proj2Suchen(notiz[1]);
      if (!p) { lokalAntworten(`Ein Projekt „${notiz[1]}“ kenne ich nicht. Es wurde nichts gespeichert.`); return true; }
      const r = projektNotiz(p.id, notiz[2]);
      lokalAntworten(r.fehler ? r.fehler + " Es wurde nichts gespeichert." : `Notiz zum Projekt „${p.name}“ gespeichert.`);
      return true;
    }
    const m = /^(?:projekt)?(chronik|statusbericht) (?:von |des |zum |für )?(?:projekt(?:s)? )?(.+)$/.exec(t), p = m ? proj2Suchen(m[2]) : null;
    if (!p) { lokalAntworten(`Ein Projekt „${m ? m[2] : ""}“ kenne ich nicht.`); return true; }
    if (m[1] === "chronik") { const c = projektChronik(p).slice(0, 8); lokalAntworten(c.length ? `Chronik ${p.name}:\n` + c.map((x) => `• ${new Date(x.zeit).toLocaleDateString("de-DE")}: ${x.text}`).join("\n") : `Für „${p.name}“ gibt es noch keine Einträge.`); return true; }
    lokalAntworten(projektBericht(p).replace(/^#+ /gm, "").trim());
    return true;
  },
});
(function proj2Einordnen() {
  const neu = SKILLS.pop(), vor = SKILLS.findIndex((x) => x.name === "notiz-anlegen" || x.name === "projekt-status" || x.name === "navigation");
  SKILLS.splice(vor < 0 ? SKILLS.length : vor, 0, neu);
})();
(function proj2Einrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("proj2-details")) return;
  el("proj2-details").addEventListener("toggle", () => proj2Anzeigen());
  el("proj2-projekt").addEventListener("change", () => proj2Anzeigen());
  el("proj2-notiz-los").addEventListener("click", () => {
    const r = projektNotiz(el("proj2-projekt").value, el("proj2-notiz").value);
    el("proj2-meldung").textContent = r.fehler || "Notiz gespeichert.";
    if (!r.fehler) { el("proj2-notiz").value = ""; proj2Anzeigen(); }
  });
  // aktuell halten: nach Änderungen in der Projektliste (auch aus anderen Tabs über die Datenprüfung)
  const original = projekteAnzeigen;
  projekteAnzeigen = function (...a) { const r = original.apply(this, a); try { proj2Anzeigen(); } catch (e) { /* Anzeige */ } return r; };
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("projekte2");
