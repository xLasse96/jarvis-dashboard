// JARVIS Dashboard – Modul „wissen“ (ab 11-10j). Datei- und Wissensverwaltung – ergänzt 36-dateien.js (Metadaten, Typerkennung,
// Suche, Sortierung, Filter, Kategorien, Favoriten, SHA-256, Duplikate, Import-Prüfung, Export, sichere Namen, nie löschen),
// 37/58 (Dokumente) und 38 (Projekt-Dateiverknüpfung):
//   - Aufgabenverknüpfung: eine Aufgabe merkt sich Datei-IDs (Feld „dateien“, nur Metadaten-Bezug, die Datei bleibt unberührt)
//   - Verknüpfungen einer Datei: Projekte und Aufgaben; „zuletzt verwendet“ (aus „angesehen“)
//   - lokale Wissensübersicht: Profil nach Kategorien, Notizen, Dateien, geladene Dokumente, Projekte, Verknüpfungen, Duplikate
//   - Wissenssuche: die globale Suche (39) plus Fundstellen mit Abschnitt in geladenen Dokumenten (58)
// Kein eigener Speicher.
const WISSEN = { maxZuletzt: 5, maxDateienJeAufgabe: 10 };
function dateiAufgabeVerknuepfen(dateiId, aufgabeId, verknuepfen = true) {
  if (!dateienLesen().some((e) => e.id === dateiId)) return { fehler: "Datei nicht in der Liste." };
  if (speicherBeschaedigt("jarvis-aufgaben")) return { fehler: SPEICHER_SCHADEN_TEXT };
  let liste;
  try { liste = JSON.parse(localStorage.getItem("jarvis-aufgaben") || "[]"); } catch (e) { return { fehler: "Aufgaben beschädigt – nichts geändert." }; }
  const a = Array.isArray(liste) ? liste.find((x) => x && x.id === aufgabeId) : null;
  if (!a) return { fehler: "Aufgabe nicht gefunden." };
  const d = new Set(Array.isArray(a.dateien) ? a.dateien : []);
  if (verknuepfen) { if (d.size >= WISSEN.maxDateienJeAufgabe && !d.has(dateiId)) return { fehler: `Höchstens ${WISSEN.maxDateienJeAufgabe} Dateien je Aufgabe.` }; d.add(dateiId); } else d.delete(dateiId);
  if (d.size) a.dateien = [...d]; else delete a.dateien;
  try { localStorage.setItem("jarvis-aufgaben", JSON.stringify(liste)); } catch (e) { return { fehler: "Nicht gespeichert (Browserspeicher)." }; }
  window.aufgabenIntern.laden(); window.aufgabenIntern.anzeigen();
  return { ok: true, anzahl: d.size };
}
function dateiVerknuepfungen(dateiId) {
  const projekte = typeof projekteLesen === "function" ? projekteLesen().projekte.filter((p) => (p.dateien || []).includes(dateiId)).map((p) => p.name) : [];
  const aufgaben = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => Array.isArray(a.dateien) && a.dateien.includes(dateiId)).map((a) => a.titel) : [];
  return { projekte, aufgaben };
}
function aufgabeDateien(aufgabe) {
  const alle = dateienLesen();
  return (Array.isArray(aufgabe.dateien) ? aufgabe.dateien : []).map((id) => { const e = alle.find((x) => x.id === id); return e ? { id, name: e.name } : { id, name: "(nicht mehr in der Dateiliste)", fehlt: true }; });
}
function dateienZuletzt() { return dateienLesen().filter((e) => e.angesehen).sort((a, b) => b.angesehen.localeCompare(a.angesehen)).slice(0, WISSEN.maxZuletzt); }
function wissenUebersicht() {
  const dat = dateienLesen(), aufg = window.aufgabenIntern ? window.aufgabenIntern.liste() : [];
  const profilKat = {};
  for (const e of typeof profil !== "undefined" ? profil : []) profilKat[e.kategorie] = (profilKat[e.kategorie] || 0) + 1;
  return {
    profil: Object.entries(profilKat).map(([k, n]) => ({ kategorie: (typeof PROFIL_KATEGORIEN !== "undefined" && PROFIL_KATEGORIEN[k]) || k, anzahl: n })),
    sensibel: typeof profil !== "undefined" ? profil.filter((e) => e.sensibel).length : 0,
    notizen: typeof notizenSuchen === "function" ? notizenSuchen("", "", "").length : 0,
    dateien: dat.length, favoriten: dat.filter((e) => e.favorit).length, geladen: typeof dokListe === "function" ? dokListe().length : 0,
    mitNotiz: dat.filter((e) => e.notiz || (e.tags && e.tags.length)).length, duplikate: typeof dateiDuplikate === "function" ? dateiDuplikate(dat).length : 0,
    projekte: typeof projekteLesen === "function" ? projekteLesen().projekte.length : 0,
    verknuepft: { projekte: typeof projektStand !== "undefined" ? projektStand.projekte.reduce((n, p) => n + (p.dateien || []).length, 0) : 0, aufgaben: aufg.reduce((n, a) => n + (Array.isArray(a.dateien) ? a.dateien.length : 0), 0) },
  };
}
function wissenSuchen(frage) {
  const allgemein = typeof arbeitsplatzSuchen === "function" ? arbeitsplatzSuchen(frage).filter((x) => x.art !== "Navigation").map((x) => ({ art: x.art, titel: x.titel, vorschau: x.vorschau || "" })) : [];
  const stellen = typeof dokSuchenAlle === "function" && String(frage || "").trim().length >= 2 ? dokSuchenAlle(frage).slice(0, 10).map((s) => ({ art: "Dokumentstelle", titel: `${s.datei} · ${s.abschnitt} · Zeile ${s.zeile}`, vorschau: s.text })) : [];
  return [...allgemein, ...stellen];
}
function wissenAnzeigen() {
  const el = (id) => document.getElementById(id), det = el("wissen-details");
  if (!det || !det.open) return;
  const u = wissenUebersicht(), li = (t, k = "") => Object.assign(document.createElement("li"), { textContent: t, className: k });
  el("wissen-uebersicht").replaceChildren(
    li(`Profil: ${u.profil.map((p) => `${p.kategorie} ${p.anzahl}`).join(", ") || "leer"}${u.sensibel ? ` (davon ${u.sensibel} sensibel – gehen nie automatisch an die KI)` : ""}`),
    li(`Notizen: ${u.notizen}`), li(`Dateien: ${u.dateien} (Favoriten ${u.favoriten}, mit Notiz/Tags ${u.mitNotiz}, Inhalt geladen ${u.geladen})${u.duplikate ? ` · ${u.duplikate} Duplikatgruppe(n)` : ""}`, u.duplikate ? "wz-wichtig" : ""),
    li(`Projekte: ${u.projekte} · Verknüpfungen: ${u.verknuepft.projekte} mit Projekten, ${u.verknuepft.aufgaben} mit Aufgaben`));
  const z = dateienZuletzt();
  el("wissen-zuletzt").replaceChildren(...(z.length ? z.map((e) => li(`${e.name} · ${new Date(e.angesehen).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`)) : [li("Noch keine Datei angesehen.")]));
  const dSel = el("wissen-datei"), aSel = el("wissen-aufgabe"), dAlt = dSel.value, aAlt = aSel.value;
  const leer = (t) => Object.assign(document.createElement("option"), { value: "", textContent: t }), dl = dateienLesen(), al = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => !a.erledigt) : [];
  dSel.replaceChildren(...(dl.length ? dl.map((e) => Object.assign(document.createElement("option"), { value: e.id, textContent: e.name, selected: e.id === dAlt })) : [leer("– keine Datei –")]));
  aSel.replaceChildren(...(al.length ? al.map((a) => Object.assign(document.createElement("option"), { value: a.id, textContent: a.titel, selected: a.id === aAlt })) : [leer("– keine offene Aufgabe –")]));
  const v = dSel.value ? dateiVerknuepfungen(dSel.value) : { projekte: [], aufgaben: [] };
  el("wissen-verknuepfungen").textContent = dSel.value ? `Verknüpft mit Projekten: ${v.projekte.join(", ") || "–"} · Aufgaben: ${v.aufgaben.join(", ") || "–"}` : "Keine Datei in der Liste.";
  el("wissen-verknuepfen").disabled = el("wissen-loesen").disabled = !dSel.value || !aSel.value;
}
skillRegistrieren({
  name: "wissen",
  risiko: "abfrage",
  hilfeKurz: "Wissen",
  beschreibung: "Wissensübersicht und Suche im eigenen Wissen (Profil, Notizen, Dateien, Dokumente, Projekte)",
  beispiele: ["Wissensübersicht", "Suche im Wissen nach Steuer"],
  passt: (text) => /^(wissensübersicht|zeige? (mein )?wissen|was weißt du alles|suche? im wissen (nach )?\S.*)$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const t = befehlNormalisieren(text), m = /^suche? im wissen (?:nach )?(.+)$/.exec(t);
    if (m) {
      const r = wissenSuchen(m[1]);
      lokalAntworten(r.length ? `Im Wissen zu „${m[1]}“:\n` + r.slice(0, 10).map((x) => `• ${x.art}: ${x.titel}${x.vorschau ? " – " + String(x.vorschau).slice(0, 80) : ""}`).join("\n") : `Zu „${m[1]}“ habe ich lokal nichts gefunden.`);
      return true;
    }
    const u = wissenUebersicht();
    lokalAntworten(`Lokales Wissen: Profil ${u.profil.reduce((n, p) => n + p.anzahl, 0)} Einträge (${u.sensibel} sensibel), ${u.notizen} Notizen, ${u.dateien} Dateien (${u.geladen} mit geladenem Inhalt), ${u.projekte} Projekte. Alles bleibt auf diesem Gerät.`);
    return true;
  },
});
(function wissenEinordnen() {
  const neu = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation");
  SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, neu);
})();
(function wissenEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("wissen-details")) return;
  el("wissen-details").addEventListener("toggle", () => wissenAnzeigen());
  el("wissen-datei").addEventListener("change", () => wissenAnzeigen());
  const knopf = (verbinden) => () => { const r = dateiAufgabeVerknuepfen(el("wissen-datei").value, el("wissen-aufgabe").value, verbinden); el("wissen-meldung").textContent = r.fehler || (verbinden ? "Verknüpft (die Datei selbst bleibt unverändert)." : "Verknüpfung gelöst."); wissenAnzeigen(); };
  el("wissen-verknuepfen").addEventListener("click", knopf(true));
  el("wissen-loesen").addEventListener("click", knopf(false));
  el("wissen-suche").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const r = wissenSuchen(el("wissen-begriff").value);
    el("wissen-treffer").replaceChildren(...(r.length ? r.map((x) => Object.assign(document.createElement("li"), { textContent: `${x.art}: ${x.titel}${x.vorschau ? " – " + x.vorschau : ""}` })) : [Object.assign(document.createElement("li"), { textContent: "Nichts gefunden." })]));
  });
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("wissen");
