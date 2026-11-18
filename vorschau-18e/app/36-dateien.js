// JARVIS Dashboard – Modul „dateien“ (ab 11-09d). Sichere lokale Dateiverwaltung im Browser.
// Grenzen des Browsers (bewusst genutzt): Dateien kommen nur über die Dateiauswahl herein; JARVIS sieht keine Pfade, keine Ordner und
// kann Dateien weder ändern noch löschen. Inhalte liegen nur im Arbeitsspeicher dieser Sitzung (nach dem Neuladen erneut auswählen);
// gespeichert werden nur Metadaten (Name, Größe, Typ, Änderungsdatum, SHA-256, Kategorie, Favorit, zuletzt angesehen).
// „Aus der Liste nehmen“ löscht nie eine Datei. Ein gleichnamiger Eintrag mit anderem Inhalt wird erst nach Bestätigung ersetzt.
// Speicher: localStorage „jarvis-dateien“ { art, version, eintraege } – beschädigt → gemeldet, nie überschrieben.
const DATEIEN = { schluessel: "jarvis-dateien", max: 200, maxVorschauBytes: 5 * 1024 * 1024, maxHashBytes: 50 * 1024 * 1024, maxText: 20000, inhalt: new Map(), offen: null };
const DATEI_KATEGORIEN = { dokument: "Dokument", tabelle: "Tabelle", daten: "Daten", bild: "Bild", archiv: "Archiv", sonstiges: "Sonstiges" };
const DATEI_ENDUNGEN = { txt: "dokument", md: "dokument", rtf: "dokument", pdf: "dokument", doc: "dokument", docx: "dokument", odt: "dokument",
  csv: "tabelle", tsv: "tabelle", xls: "tabelle", xlsx: "tabelle", ods: "tabelle", json: "daten", xml: "daten", yaml: "daten", yml: "daten",
  png: "bild", jpg: "bild", jpeg: "bild", gif: "bild", webp: "bild", bmp: "bild", zip: "archiv", "7z": "archiv", rar: "archiv", gz: "archiv" };
const DATEI_TEXT = new Set(["txt", "md", "csv", "tsv", "json", "xml", "yaml", "yml", "log"]);
// Dateinamen nie als Pfad behandeln: Pfadanteile, Steuerzeichen und reservierte Zeichen entfernen
function dateiNameSicher(name) {
  const roh = String(name || "").split(/[\\/]/).pop().trim();
  if (!roh || /^\.+$/.test(roh)) return "unbenannt";
  return roh.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").replace(/^\.+/, "_").slice(0, 180);
}
const dateiEndung = (name) => { const m = /\.([a-z0-9]{1,5})$/i.exec(name); return m ? m[1].toLowerCase() : ""; };
// Signatur der ersten Bytes (Inhalt geht vor Endung, damit umbenannte Dateien erkannt werden)
function dateiSignatur(bytes) {
  const b = (i) => bytes[i];
  if (bytes.length >= 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "png";
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "jpg";
  if (bytes.length >= 4 && b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return "pdf";
  if (bytes.length >= 4 && b(0) === 0x50 && b(1) === 0x4b && b(2) === 0x03 && b(3) === 0x04) return "zip";
  if (bytes.length >= 4 && b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return "gif";
  return null;
}
function dateiTyp(name, bytes) {
  const end = dateiEndung(name), sig = dateiSignatur(bytes);
  const zipArt = sig === "zip" && ["docx", "xlsx", "odt", "ods"].includes(end) ? end : sig;
  const echt = zipArt || end;
  const textArtig = !sig && bytes.length && !bytes.slice(0, 4096).some((x) => x === 0);
  return { endung: end, erkannt: echt || (textArtig ? "txt" : "unbekannt"), kategorie: DATEI_ENDUNGEN[echt] || (textArtig ? "dokument" : "sonstiges"),
    abweichung: Boolean(sig && end && sig !== end && !(sig === "jpg" && end === "jpeg") && !(sig === "zip" && ["docx", "xlsx", "odt", "ods"].includes(end))), text: !sig && (DATEI_TEXT.has(end) || textArtig) };
}
async function dateiHash(buffer) {
  if (!(window.crypto && crypto.subtle)) return null;
  const h = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function dateienLesen() {
  const d = speicherJsonLesen(DATEIEN.schluessel, (x) => istObjekt(x) && x.art === "jarvis-dateien" && Array.isArray(x.eintraege));
  return d ? d.eintraege.filter((e) => e && typeof e.id === "string" && typeof e.name === "string") : [];
}
function dateienSchreiben(liste) {
  if (speicherBeschaedigt(DATEIEN.schluessel)) return false;
  try { localStorage.setItem(DATEIEN.schluessel, JSON.stringify({ art: "jarvis-dateien", version: 1, eintraege: liste.slice(0, DATEIEN.max) })); return true; } catch (e) { return false; }
}
// Liest eine ausgewählte Datei ein → Eintrag (ohne Speichern). Fehler und Grenzen werden gemeldet, nie still übergangen.
async function dateiEinlesen(datei) {
  const name = dateiNameSicher(datei.name);
  const e = { id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, groesse: datei.size, geaendert: Number.isFinite(datei.lastModified) ? new Date(datei.lastModified).toISOString() : null, hinzugefuegt: new Date().toISOString(), hinweise: [] };
  if (datei.size > DATEIEN.maxHashBytes) { e.hinweise.push(`größer als ${DATEIEN.maxHashBytes / 1048576} MB – keine Prüfsumme und keine Vorschau`); Object.assign(e, { typ: dateiEndung(name) || "unbekannt", kategorie: DATEI_ENDUNGEN[dateiEndung(name)] || "sonstiges", sha256: null }); return { eintrag: e }; }
  let buffer;
  try { buffer = await datei.arrayBuffer(); } catch (x) { return { fehler: `${name}: nicht lesbar (${x.message || x})` }; }
  const bytes = new Uint8Array(buffer);
  const t = dateiTyp(name, bytes);
  Object.assign(e, { typ: t.erkannt, kategorie: t.kategorie, sha256: await dateiHash(buffer) });
  if (!datei.size) e.hinweise.push("leere Datei");
  if (t.abweichung) e.hinweise.push(`Inhalt passt nicht zur Endung (.${t.endung}, erkannt ${t.erkannt})`);
  const inhalt = { buffer: datei.size <= DATEIEN.maxVorschauBytes ? buffer : null, text: null, fehler: null, mime: datei.type || "" };
  if (t.text && inhalt.buffer) {
    try { inhalt.text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (x) { inhalt.text = new TextDecoder("windows-1252").decode(bytes); e.hinweise.push("kein gültiges UTF-8 – als Windows-1252 gelesen"); }
    if (t.erkannt === "json") { try { JSON.parse(inhalt.text); } catch (x) { inhalt.fehler = "kein gültiges JSON: " + String(x.message).slice(0, 80); e.hinweise.push("beschädigt: kein gültiges JSON"); } }
  }
  return { eintrag: e, inhalt };
}
// Fügt Dateien hinzu. Gleicher Name + anderer Inhalt → nicht ersetzen, sondern zur Bestätigung vormerken.
async function dateienHinzufuegen(dateien) {
  const liste = dateienLesen();
  if (speicherBeschaedigt(DATEIEN.schluessel)) return { fehler: "Dateiliste beschädigt – " + SPEICHER_SCHADEN_TEXT };
  const erg = { neu: [], gleich: [], ersetzen: [], fehler: [] };
  for (const f of [...dateien].slice(0, 50)) {
    const r = await dateiEinlesen(f);
    if (r.fehler) { erg.fehler.push(r.fehler); continue; }
    const da = liste.find((x) => x.name === r.eintrag.name);
    if (da && da.sha256 && da.sha256 === r.eintrag.sha256) { if (r.inhalt) DATEIEN.inhalt.set(da.id, r.inhalt); erg.gleich.push(da.name); continue; }
    if (da) { erg.ersetzen.push({ alt: da, neu: r.eintrag, inhalt: r.inhalt }); continue; }
    if (liste.length >= DATEIEN.max) { erg.fehler.push(`${r.eintrag.name}: höchstens ${DATEIEN.max} Einträge`); continue; }
    liste.push(r.eintrag);
    if (r.inhalt) DATEIEN.inhalt.set(r.eintrag.id, r.inhalt);
    erg.neu.push(r.eintrag.name);
  }
  if (!dateienSchreiben(liste) && erg.neu.length) erg.fehler.push("Metadaten nicht gespeichert (Browserspeicher) – gelten bis zum Neuladen");
  DATEIEN.offen = erg.ersetzen.length ? erg.ersetzen : null;
  dateienAnzeigen();
  return erg;
}
// Bestätigte Ersetzung (gleicher Name, anderer Inhalt): Kategorie und Favorit bleiben erhalten
function dateienErsetzenBestaetigen(ja) {
  const offen = DATEIEN.offen;
  DATEIEN.offen = null;
  if (!offen) return 0;
  if (!ja) { dateienAnzeigen(); return 0; }
  const liste = dateienLesen();
  for (const x of offen) {
    const i = liste.findIndex((e) => e.id === x.alt.id);
    if (i < 0) continue;
    liste[i] = { ...x.neu, id: x.alt.id, kategorie: x.alt.kategorieEigene ? x.alt.kategorie : x.neu.kategorie, kategorieEigene: x.alt.kategorieEigene, favorit: x.alt.favorit };
    if (x.inhalt) DATEIEN.inhalt.set(x.alt.id, x.inhalt); else DATEIEN.inhalt.delete(x.alt.id);
  }
  dateienSchreiben(liste); dateienAnzeigen();
  return offen.length;
}
function dateiAendern(id, aenderung) {
  const liste = dateienLesen(), e = liste.find((x) => x.id === id);
  if (!e || speicherBeschaedigt(DATEIEN.schluessel)) return false;
  if ("favorit" in aenderung) e.favorit = Boolean(aenderung.favorit) || undefined;
  if ("kategorie" in aenderung && DATEI_KATEGORIEN[aenderung.kategorie]) { e.kategorie = aenderung.kategorie; e.kategorieEigene = true; }
  if (aenderung.angesehen) e.angesehen = new Date().toISOString();
  const ok = dateienSchreiben(liste); dateienAnzeigen(); return ok;
}
// Nimmt nur den Eintrag aus JARVIS – die Datei selbst bleibt unberührt (der Browser kann sie gar nicht löschen)
function dateiAusListe(id) {
  const liste = dateienLesen();
  if (speicherBeschaedigt(DATEIEN.schluessel) || !liste.some((x) => x.id === id)) return false;
  DATEIEN.inhalt.delete(id);
  const ok = dateienSchreiben(liste.filter((x) => x.id !== id)); dateienAnzeigen(); return ok;
}
// Duplikate: gleiche Prüfsumme unter verschiedenen Namen
function dateiDuplikate(liste = dateienLesen()) {
  const je = new Map();
  for (const e of liste) if (e.sha256) je.set(e.sha256, [...(je.get(e.sha256) || []), e.name]);
  return [...je.values()].filter((n) => n.length > 1);
}
// Suche in Namen und – soweit in dieser Sitzung geladen – im Textinhalt; Filter und Sortierung nur Anzeige
function dateienSuchen({ suche = "", kategorie = "", nurFavoriten = false, sortierung = "name" } = {}) {
  const w = String(suche).toLowerCase().split(/\s+/).filter(Boolean);
  const liste = dateienLesen().filter((e) => (!kategorie || e.kategorie === kategorie) && (!nurFavoriten || e.favorit)).map((e) => {
    const inh = DATEIEN.inhalt.get(e.id), text = inh && inh.text ? inh.text.toLowerCase() : "";
    const meta = (e.name + " " + (e.notiz || "") + " " + (e.tags || []).map((x) => "#" + x).join(" ")).toLowerCase(); // ab 11-09g: Notiz und Tags
    const imNamen = w.every((x) => meta.includes(x)), imText = !imNamen && w.length && text && w.every((x) => text.includes(x));
    return { e, treffer: !w.length || imNamen || imText, imText };
  }).filter((x) => x.treffer);
  const sort = { name: (a, b) => a.e.name.localeCompare(b.e.name, "de"), groesse: (a, b) => b.e.groesse - a.e.groesse, datum: (a, b) => String(b.e.geaendert || "").localeCompare(String(a.e.geaendert || "")), angesehen: (a, b) => String(b.e.angesehen || "").localeCompare(String(a.e.angesehen || "")) }[sortierung];
  if (sort) liste.sort(sort);
  return liste;
}
const groesseText = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " KB" : (n / 1048576).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " MB");
function dateiVorschau(id) {
  const e = dateienLesen().find((x) => x.id === id), box = document.getElementById("datei-vorschau");
  if (!e || !box) return null;
  dateiAendern(id, { angesehen: true });
  const inh = DATEIEN.inhalt.get(id);
  const kopf = Object.assign(document.createElement("h4"), { textContent: e.name });
  const meta = Object.assign(document.createElement("p"), { className: "klein", textContent: `${groesseText(e.groesse)} · Typ ${e.typ} · ${DATEI_KATEGORIEN[e.kategorie] || e.kategorie} · geändert ${e.geaendert ? new Date(e.geaendert).toLocaleString("de-DE") : "unbekannt"} · SHA-256 ${e.sha256 || "nicht berechnet"}` });
  const teile = [kopf, meta, ...(e.hinweise || []).map((h) => Object.assign(document.createElement("p"), { className: "klein wz-wichtig", textContent: "⚠ " + h }))];
  if (!inh) teile.push(Object.assign(document.createElement("p"), { className: "klein", textContent: "Inhalt nicht geladen – die Datei bitte in dieser Sitzung erneut auswählen (Inhalte werden nie gespeichert)." }));
  else if (inh.fehler) teile.push(Object.assign(document.createElement("p"), { className: "wz-wichtig", textContent: inh.fehler }));
  if (inh && inh.text !== null) teile.push(Object.assign(document.createElement("pre"), { className: "datei-text", textContent: inh.text.slice(0, DATEIEN.maxText) + (inh.text.length > DATEIEN.maxText ? "\n… (gekürzt)" : "") }));
  else if (inh && inh.buffer && e.kategorie === "bild" && ["png", "jpg", "gif"].includes(e.typ)) {
    const img = Object.assign(document.createElement("img"), { alt: "Vorschau " + e.name, className: "datei-bild", src: URL.createObjectURL(new Blob([inh.buffer], { type: { png: "image/png", jpg: "image/jpeg", gif: "image/gif" }[e.typ] })) });
    img.addEventListener("load", () => URL.revokeObjectURL(img.src), { once: true });
    teile.push(img);
  } else if (inh) teile.push(Object.assign(document.createElement("p"), { className: "klein", textContent: "Für diesen Typ gibt es keine Vorschau." }));
  box.replaceChildren(...teile);
  box.hidden = false;
  return e;
}
// Export nur der Metadaten (keine Inhalte); Import prüft jede Zeile und übernimmt nur bekannte Felder
function dateienExport() { return JSON.stringify({ art: "jarvis-dateien", version: 1, exportiert: new Date().toISOString(), eintraege: dateienLesen().map(({ id, name, groesse, typ, kategorie, kategorieEigene, geaendert, sha256, favorit, notiz, tags }) => ({ id, name, groesse, typ, kategorie, kategorieEigene, geaendert, sha256, favorit, notiz, tags })) }, null, 1); }
function dateienImportPruefen(text) {
  let d;
  try { d = JSON.parse(String(text || "")); } catch (e) { return { fehler: "kein gültiges JSON" }; }
  if (!istObjekt(d) || d.art !== "jarvis-dateien" || d.version !== 1 || !Array.isArray(d.eintraege)) return { fehler: "keine JARVIS-Dateiliste (Version 1)" };
  if (d.eintraege.length > DATEIEN.max) return { fehler: `mehr als ${DATEIEN.max} Einträge` };
  const ok = [];
  for (const e of d.eintraege) {
    if (!istObjekt(e) || typeof e.name !== "string" || !Number.isFinite(e.groesse) || e.groesse < 0 || (e.sha256 !== undefined && e.sha256 !== null && !/^[0-9A-F]{64}$/.test(e.sha256))) return { fehler: "Eintrag ungültig: " + JSON.stringify(e).slice(0, 60) };
    ok.push({ id: "f" + Math.random().toString(36).slice(2, 10), name: dateiNameSicher(e.name), groesse: e.groesse, typ: String(e.typ || "unbekannt").slice(0, 10), kategorie: DATEI_KATEGORIEN[e.kategorie] ? e.kategorie : "sonstiges",
      kategorieEigene: Boolean(e.kategorieEigene) || undefined, geaendert: e.geaendert && !isNaN(Date.parse(e.geaendert)) ? e.geaendert : null, sha256: e.sha256 || null, favorit: Boolean(e.favorit) || undefined, hinzugefuegt: new Date().toISOString(), hinweise: ["aus Import – Inhalt nicht geladen"],
      notiz: typeof e.notiz === "string" && e.notiz.trim() ? e.notiz.trim().slice(0, 1000) : undefined, tags: Array.isArray(e.tags) && typeof dokTagsNormalisieren === "function" && dokTagsNormalisieren(e.tags.join(" ")).length ? dokTagsNormalisieren(e.tags.join(" ")) : undefined }); // ab 11-09g
  }
  return { eintraege: ok };
}
// Testmodus: synthetische Beispieldateien (nur im Speicher erzeugt)
function dateiBeispiele() {
  return [new File(["# Projektnotiz\n\nTermin am Freitag, Steuer abgeben.\n"], "beispiel-notiz.md", { type: "text/markdown", lastModified: Date.UTC(2026, 10, 1) }),
    new File(["Symbol;Menge\nAAPL;10\nKO;5\n"], "beispiel-tabelle.csv", { type: "text/csv", lastModified: Date.UTC(2026, 10, 2) }),
    new File(['{"kaputt": '], "beispiel-defekt.json", { type: "application/json", lastModified: Date.UTC(2026, 10, 3) })];
}
function dateienAnzeigen() {
  const el = (id) => document.getElementById(id);
  if (!el("datei-liste")) return;
  if (speicherBeschaedigt(DATEIEN.schluessel)) { el("datei-liste").replaceChildren(Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: "Dateiliste beschädigt – " + SPEICHER_SCHADEN_TEXT })); return; }
  const treffer = dateienSuchen({ suche: el("datei-suche").value, kategorie: el("datei-filter").value, nurFavoriten: el("datei-favoriten").checked, sortierung: el("datei-sortierung").value });
  const dup = dateiDuplikate();
  el("datei-status").textContent = `${treffer.length} von ${dateienLesen().length} Dateien` + (dup.length ? ` · Duplikate (gleiche Prüfsumme): ${dup.map((n) => n.join(" = ")).join("; ")}` : "") + ` · Inhalte geladen: ${DATEIEN.inhalt.size}`;
  el("datei-liste").replaceChildren(...(treffer.length ? treffer.map(({ e, imText }) => {
    const li = document.createElement("li"); li.dataset.id = e.id;
    li.append(Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: `${e.favorit ? "★ " : ""}${e.name}${e.tags && e.tags.length ? " " + e.tags.map((x) => "#" + x).join(" ") : ""}` }),
      Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: `${groesseText(e.groesse)} · ${DATEI_KATEGORIEN[e.kategorie] || e.kategorie} · ${e.typ}${imText ? " · Treffer im Inhalt" : ""}${DATEIEN.inhalt.has(e.id) ? "" : " · Inhalt nicht geladen"}${(e.hinweise || []).length ? " · ⚠ " + e.hinweise[0] : ""}` }));
    const knopf = (t, f) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: t }); b.setAttribute("aria-label", t + ": " + e.name); b.addEventListener("click", f); return b; };
    li.append(knopf("Vorschau", () => dateiVorschau(e.id)), knopf(e.favorit ? "Kein Favorit" : "Favorit", () => dateiAendern(e.id, { favorit: !e.favorit })), knopf("Aus Liste nehmen", () => dateiAusListe(e.id)));
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: dateienLesen().length ? "Keine Datei passt." : "Noch keine Dateien. „Dateien auswählen“ oder „Beispieldateien (Testmodus)“." })]));
  const ers = el("datei-ersetzen");
  ers.hidden = !DATEIEN.offen;
  if (DATEIEN.offen) el("datei-ersetzen-text").textContent = `Gleichnamige Datei mit anderem Inhalt: ${DATEIEN.offen.map((x) => x.neu.name).join(", ")}. Eintrag ersetzen? (Die Dateien selbst bleiben unverändert.)`;
}
// Per Chat/Sprache nur lesen: Liste zeigen oder suchen. Löschen bleibt gesperrt (Skill „gesperrt“ greift vorher).
skillRegistrieren({
  name: "dateien",
  risiko: "abfrage",
  hilfeKurz: "Dateien", // ab 11-09h: in der Hilfe als Sammelzeile
  beschreibung: "Ausgewählte Dateien zeigen oder durchsuchen",
  beispiele: ["Suche Datei Notiz"],
  passt: (text) => /^(zeige?( mir)?( meine| die)? dateien|dateiliste|(suche?|finde) (in )?(den |meinen )?datei(?:en)? .+)$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const m = /^(?:suche?|finde) (?:in )?(?:den |meinen )?datei(?:en)? (.+)$/.exec(befehlNormalisieren(text));
    const treffer = dateienSuchen({ suche: m ? m[1] : "" });
    const alle = dateienLesen().length;
    const det = document.getElementById("datei-details");
    if (det) det.open = true;
    lokalAntworten(!alle ? "Noch keine Dateien in der Liste, Sir. Wähle sie in der Karte „Dateien“ aus – ich sehe nur, was du dort auswählst."
      : !treffer.length ? `Keine Datei passt zu „${m ? m[1] : ""}“ (${alle} in der Liste; Inhalte nur durchsuchbar, wenn in dieser Sitzung geladen).`
      : `${m ? "Gefunden" : "Deine Dateien"} (${treffer.length} von ${alle}):\n` + treffer.slice(0, 10).map(({ e, imText }) => `• ${e.name} – ${groesseText(e.groesse)}${imText ? " (Treffer im Inhalt)" : ""}`).join("\n") + (treffer.length > 10 ? `\n… und ${treffer.length - 10} weitere in der Karte „Dateien“.` : ""));
    return true;
  },
});
// vor die Navigation stellen: „Zeige meine Dateien“ listet; „Gehe zu Dateien“ springt weiter zur Karte
(function dateienSkillEinordnen() {
  const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation");
  SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s);
})();
(function dateienEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("datei-auswahl")) return;
  el("datei-auswahl").addEventListener("change", async (e) => {
    const r = await dateienHinzufuegen(e.target.files || []);
    e.target.value = "";
    el("datei-meldung").textContent = r.fehler ? r.fehler : `Hinzugefügt: ${r.neu.length}` + (r.gleich.length ? ` · unverändert: ${r.gleich.length}` : "") + (r.ersetzen.length ? ` · zu bestätigen: ${r.ersetzen.length}` : "") + (r.fehler.length ? " · Fehler: " + r.fehler.join("; ") : "");
  });
  el("datei-beispiele").addEventListener("click", async () => { const r = await dateienHinzufuegen(dateiBeispiele()); el("datei-meldung").textContent = `Testmodus: ${r.neu.length} Beispieldateien (synthetisch) hinzugefügt.`; });
  el("datei-ersetzen-ja").addEventListener("click", () => { el("datei-meldung").textContent = `${dateienErsetzenBestaetigen(true)} Eintrag ersetzt.`; });
  el("datei-ersetzen-nein").addEventListener("click", () => { dateienErsetzenBestaetigen(false); el("datei-meldung").textContent = "Nicht ersetzt."; });
  for (const id of ["datei-suche", "datei-filter", "datei-favoriten", "datei-sortierung"]) el(id).addEventListener(id === "datei-suche" ? "input" : "change", dateienAnzeigen);
  el("datei-export").addEventListener("click", () => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([dateienExport()], { type: "application/json" })), download: "jarvis-dateiliste-" + new Date().toISOString().slice(0, 10) + ".json" }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); el("datei-meldung").textContent = "Dateiliste (nur Metadaten, keine Inhalte) exportiert."; });
  el("datei-filter").replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "alle Arten" }), ...Object.entries(DATEI_KATEGORIEN).map(([k, t]) => Object.assign(document.createElement("option"), { value: k, textContent: t })));
  dateienAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("dateien");
