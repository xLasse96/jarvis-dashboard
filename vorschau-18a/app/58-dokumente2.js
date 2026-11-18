// JARVIS Dashboard – Modul „dokumente2“ (ab 11-10i). Dokumentenassistent 2.0 – ergänzt 37-dokumente.js (Kennzahlen, Gliederung,
// Schlüsselwörter, Kernsätze, Fundstellen, Termine/Aufgaben als Vorschlag, Vergleich, Markdown, Notiz/Tags, Entwurf, Export, Kopieren):
//   - Abschnitte (Überschrift → Zeilenbereich, Wörter) und strukturierte Suche über alle geladenen Dokumente mit Abschnitt und Zeile
//   - Änderungsübersicht zweier Fassungen nach Abschnitten (neu, entfernt, geändert)
//   - Stichwort- und Tag-Übersicht über alle Dokumente
//   - klare Meldung für Formate, die der Browser lokal nicht lesen kann (PDF, Word, Excel …)
//   - Frage zum Dokument an die KI: nur nach Vorschau des genauen Auszugs UND angehakter Zustimmung (gilt für genau eine Frage);
//     zusätzlich greift die Datenschutzprüfung aus 10c. Ohne Zustimmung wird nichts übertragen.
// Das Original wird nie verändert (Inhalte liegen nur im Arbeitsspeicher). Kein eigener Speicher.
const DOK2 = { maxAuszug: 3000, maxTreffer: 50 };
const DOK2_NICHT_LESBAR = { pdf: "PDF", doc: "Word", docx: "Word", odt: "OpenDocument-Text", rtf: "RTF", xls: "Excel", xlsx: "Excel", ods: "OpenDocument-Tabelle" };
const DOK2_KOPF = /^\s*(#{1,6}\s+.+|\d+(\.\d+)*[.)]\s+\S.{0,80}|[A-ZÄÖÜ][^.!?]{2,60}:)\s*$/; // wie in dokAnalysieren
function dokAbschnitte(text) {
  const zeilen = String(text || "").slice(0, DOK.maxZeichen).replace(/\r/g, "").split("\n"), aus = [];
  let akt = { titel: "(Anfang)", ebene: 0, von: 1, inhalt: [] };
  zeilen.forEach((z, i) => {
    if (DOK2_KOPF.test(z)) {
      if (akt.inhalt.some((x) => x.trim()) || akt.ebene) aus.push(akt);
      const m = /^\s*(#{1,6})\s+/.exec(z);
      akt = { titel: z.replace(/^\s*#{1,6}\s+/, "").trim(), ebene: m ? m[1].length : /^\s*\d+\.\d+/.test(z) ? 2 : 1, von: i + 1, inhalt: [] };
    } else akt.inhalt.push(z);
  });
  aus.push(akt);
  return aus.map((a) => ({ titel: a.titel, ebene: a.ebene, von: a.von, bis: a.von + a.inhalt.length - (a.ebene ? 0 : 1), woerter: dokWoerter(a.inhalt.join(" ")).length, text: a.inhalt.join("\n").trim() }));
}
const dok2AbschnittBei = (abschnitte, zeile) => { let t = abschnitte[0]; for (const a of abschnitte) if (a.von <= zeile) t = a; return t ? t.titel : ""; };
function dokSuchenAlle(begriff) {
  const aus = [];
  for (const e of dokListe()) {
    const text = dokText(e.id), ab = dokAbschnitte(text);
    for (const s of dokStellen(text, begriff)) { aus.push({ id: e.id, datei: e.name, abschnitt: dok2AbschnittBei(ab, s.zeile), zeile: s.zeile, text: s.text }); if (aus.length >= DOK2.maxTreffer) return aus; }
  }
  return aus;
}
function dokAenderungen(textA, textB) {
  const v = dokVergleich(textA, textB);
  if (v.fehler) return v;
  const a = new Map(dokAbschnitte(textA).map((x) => [x.titel, x.text])), b = new Map(dokAbschnitte(textB).map((x) => [x.titel, x.text]));
  return { neuZeilen: v.neu, wegZeilen: v.weg, identisch: v.identisch, neu: [...b.keys()].filter((t) => !a.has(t)), entfernt: [...a.keys()].filter((t) => !b.has(t)), geaendert: [...b.keys()].filter((t) => a.has(t) && a.get(t) !== b.get(t)) };
}
function dokStichworte() {
  const tags = new Map(), worte = new Map();
  for (const e of dateienLesen()) for (const t of e.tags || []) tags.set(t, [...(tags.get(t) || []), e.name]);
  for (const e of dokListe()) for (const s of dokAnalysieren(dokText(e.id)).schluessel.slice(0, 5)) worte.set(s.wort, [...(worte.get(s.wort) || []), e.name]);
  const sortiert = (m) => [...m.entries()].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0], "de")).map(([k, v]) => ({ wort: k, dateien: v }));
  return { tags: sortiert(tags), stichworte: sortiert(worte) };
}
function dokFormatHinweis(e) {
  const art = DOK2_NICHT_LESBAR[dateiEndung(e.name)];
  return art ? `„${e.name}“ ist ein ${art}-Dokument. Der Browser kann es hier nicht lokal auslesen – bitte als .txt oder .md speichern und diese Fassung laden. Die Datei selbst bleibt unverändert.` : "";
}
// genau der Text, der bei Zustimmung an die KI ginge
function dokKiNachricht(id, frage) {
  const e = dateienLesen().find((x) => x.id === id), text = dokText(id), f = String(frage || "").trim();
  if (!e || text === null) return { fehler: "Kein geladenes Textdokument gewählt." };
  if (f.length < 3) return { fehler: "Bitte eine Frage zum Dokument eingeben." };
  const kopf = `Frage zum Dokument „${e.name}“: ${f.slice(0, 300)}\n\nAuszug (${Math.min(text.length, DOK2.maxAuszug).toLocaleString("de-DE")} von ${text.length.toLocaleString("de-DE")} Zeichen):\n`;
  const platz = Math.min(DOK2.maxAuszug, CHAT_GRENZEN.nachricht - kopf.length - 10), auszug = text.slice(0, platz);
  const nachricht = kopf + auszug, funde = typeof modellDatenschutz === "function" ? modellDatenschutz([{ content: auszug }]) : [];
  return { nachricht, zeichen: nachricht.length, gekuerzt: text.length > auszug.length, funde, datei: e.name };
}
async function dokKiFragen(id, frage, zustimmung) {
  const n = dokKiNachricht(id, frage);
  if (n.fehler) return n;
  if (zustimmung !== true) return { fehler: "Nicht gesendet – bitte erst die Vorschau prüfen und die Übertragung ausdrücklich erlauben." };
  if (typeof ansichtSicherstellen === "function") ansichtSicherstellen("cockpit");
  await jarvisAntwort(n.nachricht);
  return { gesendet: true, zeichen: n.zeichen };
}
function dok2Anzeigen() {
  const el = (id) => document.getElementById(id);
  if (!el("dok2-stichworte")) return;
  const s = dokStichworte(), li = (t) => Object.assign(document.createElement("li"), { textContent: t });
  el("dok2-stichworte").replaceChildren(...(s.tags.length || s.stichworte.length ? [...s.tags.slice(0, 15).map((x) => li(`#${x.wort}: ${x.dateien.join(", ")}`)), ...s.stichworte.slice(0, 15).map((x) => li(`${x.wort}: ${x.dateien.join(", ")}`))] : [li("Noch keine Tags oder geladenen Textdokumente.")]));
}
(function dok2Einrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("dok2-details")) return;
  const box = () => el("dok-ergebnis"), p = (t, k = "klein") => Object.assign(document.createElement("p"), { className: k, textContent: t });
  el("dok2-details").addEventListener("toggle", () => { if (el("dok2-details").open) dok2Anzeigen(); });
  el("dok2-suche").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = dokSuchenAlle(el("dok2-begriff").value), ul = document.createElement("ul");
    ul.append(...t.map((x) => Object.assign(document.createElement("li"), { textContent: `${x.datei} · ${x.abschnitt} · Zeile ${x.zeile}: ${x.text}` })));
    box().replaceChildren(p(t.length ? `${t.length} Fundstelle(n) in geladenen Dokumenten${t.length >= DOK2.maxTreffer ? " (gekürzt)" : ""}:` : "Keine Fundstelle in den geladenen Textdokumenten."), ul);
  });
  el("dok2-abschnitte").addEventListener("click", () => {
    const e = dokGewaehlt(), text = e && dokText(e.id);
    if (!e || text === null) { box().replaceChildren(p(e && dokFormatHinweis(e) ? dokFormatHinweis(e) : "Kein geladenes Textdokument gewählt.", "wz-wichtig")); return; }
    const ul = document.createElement("ul");
    ul.append(...dokAbschnitte(text).map((a) => Object.assign(document.createElement("li"), { textContent: `${"  ".repeat(Math.max(0, a.ebene - 1))}${a.titel} · Zeilen ${a.von}–${Math.max(a.von, a.bis)} · ${a.woerter} Wörter` })));
    box().replaceChildren(p("Abschnitte von „" + e.name + "“:"), ul);
  });
  el("dok2-aenderungen").addEventListener("click", () => {
    const ta = dokText(el("dok-wahl").value), tb = dokText(el("dok-wahl-b").value);
    if (ta === null || tb === null || el("dok-wahl").value === el("dok-wahl-b").value) { box().replaceChildren(p("Für die Änderungsübersicht zwei verschiedene geladene Textdokumente wählen.")); return; }
    const a = dokAenderungen(ta, tb);
    box().replaceChildren(...(a.fehler ? [p(a.fehler, "wz-wichtig")] : [p(a.identisch ? "Keine Änderungen." : `${a.neuZeilen} Zeile(n) neu, ${a.wegZeilen} entfernt.`), p("Neue Abschnitte: " + (a.neu.join(", ") || "–")), p("Entfernte Abschnitte: " + (a.entfernt.join(", ") || "–")), p("Geänderte Abschnitte: " + (a.geaendert.join(", ") || "–"))]));
  });
  el("dok2-vorschau").addEventListener("click", () => {
    const e = dokGewaehlt(), n = e ? dokKiNachricht(e.id, el("dok2-frage").value) : { fehler: "Kein Dokument gewählt." };
    el("dok2-zustimmung").checked = false;
    if (n.fehler) { el("dok2-uebertragung").hidden = true; el("dok-meldung").textContent = e && dokFormatHinweis(e) ? dokFormatHinweis(e) : n.fehler; return; }
    el("dok2-uebertragung").hidden = false;
    el("dok2-text").textContent = n.nachricht;
    el("dok2-info").textContent = `Genau dieser Text (${n.zeichen.toLocaleString("de-DE")} Zeichen${n.gekuerzt ? ", Dokument gekürzt" : ""}) ginge an den eingestellten KI-Anbieter.` + (n.funde.length ? " ⚠ Enthält vermutlich persönliche Daten: " + n.funde.join(", ") + "." : "");
  });
  el("dok2-senden").addEventListener("click", async () => {
    const e = dokGewaehlt(), r = e ? await dokKiFragen(e.id, el("dok2-frage").value, el("dok2-zustimmung").checked) : { fehler: "Kein Dokument gewählt." };
    el("dok2-zustimmung").checked = false; // Zustimmung gilt nur für genau eine Übertragung
    el("dok-meldung").textContent = r.fehler || "Frage mit Auszug gesendet – Antwort im Chat.";
    if (!r.fehler) el("dok2-uebertragung").hidden = true;
  });
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("dokumente2");
