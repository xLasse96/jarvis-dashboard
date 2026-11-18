// JARVIS Dashboard – Modul „dokumente“ (ab 11-09e). Dokumentenassistent für die in der Karte „Dateien“ geladenen Textdateien.
// Alles lokal und nachvollziehbar, keine KI und keine Übermittlung: Kennzahlen, Gliederung, Schlüsselwörter, einfache
// Zusammenfassung (Auswahl vorhandener Sätze, kein erzeugter Text), Fundstellen, erkannte Termine und Aufgaben, Vergleich zweier
// Fassungen (zeilenweise). Aufgaben werden nur per Knopf übernommen; das Dokument selbst wird nie verändert.
const DOK = { maxZeichen: 200000, maxVergleichZeilen: 2000, maxStellen: 20, letzte: null };
const DOK_STOPP = new Set(("aber alle allem allen aller alles also auch auf aus bei beim bin bis bitte dann darf darum dass das dem den denn der des die dies diese diesem diesen dieser dieses doch dort durch eine einem einen einer eines etwa für gegen hat hatte haben hier ihr ihre ihren immer ist jede jeder jetzt kann kein keine können man mehr mein meine mit muss nach nicht noch nur oder ohne sehr sein seine sich sie sind soll sowie über uns und unter vom von vor war waren was weil wenn werden wie wieder wir wird wurde zum zur zwischen "
  + "the and for that with this from").split(" "));
function dokSaetze(text) {
  return String(text).replace(/\r/g, "").split(/(?<=[.!?])\s+|\n{2,}|\n(?=\s*[-*#\d])/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 1);
}
function dokWoerter(text) { return (String(text).toLowerCase().match(/[a-zäöüß][a-zäöüß0-9-]{1,}/g) || []); }
// Analyse eines Textes. jetzt nur für die Terminerkennung (relativ zu heute).
function dokAnalysieren(text, jetzt = new Date()) {
  const roh = String(text || "");
  const t = roh.slice(0, DOK.maxZeichen);
  const woerter = dokWoerter(t), saetze = dokSaetze(t);
  const zaehl = new Map();
  for (const w of woerter) if (w.length >= 4 && !DOK_STOPP.has(w)) zaehl.set(w, (zaehl.get(w) || 0) + 1);
  const schluessel = [...zaehl.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).slice(0, 8).map(([w, n]) => ({ wort: w, anzahl: n }));
  const gewicht = new Map(schluessel.map((s) => [s.wort, s.anzahl]));
  const kopf = /^\s*(#{1,6}\s+.+|\d+(\.\d+)*[.)]\s+\S.{0,80}|[A-ZÄÖÜ][^.!?]{2,60}:)\s*$/;
  const zeilen = t.replace(/\r/g, "").split("\n");
  const gliederung = zeilen.filter((z) => kopf.test(z)).slice(0, 30).map((z) => { const m = /^\s*(#{1,6})\s+/.exec(z); return { ebene: m ? m[1].length : /^\s*\d+\.\d+/.test(z) ? 2 : 1, text: z.replace(/^\s*#{1,6}\s+/, "").trim() }; });
  const inhalt = saetze.filter((s) => !kopf.test(s) && dokWoerter(s).length >= 4);
  const wertung = inhalt.map((s, i) => ({ s, i, w: dokWoerter(s).reduce((a, x) => a + (gewicht.get(x) || 0), 0) / Math.sqrt(dokWoerter(s).length) + (i === 0 ? 0.5 : 0) }));
  const zusammenfassung = wertung.slice().sort((a, b) => b.w - a.w).slice(0, Math.min(3, Math.max(1, Math.ceil(inhalt.length / 5)))).sort((a, b) => a.i - b.i).map((x) => x.s);
  const termine = [], aufgaben = [];
  for (const s of saetze) {
    const z = typeof zeitangabeErkennen === "function" ? zeitangabeErkennen(s, jetzt) : null;
    if (z && z.datum) termine.push({ satz: s.slice(0, 200), datum: z.datum.toISOString(), beschreibung: z.beschreibung || "" });
  }
  for (const z of zeilen) {
    const m = /^\s*(?:[-*]\s*\[ \]\s*|todo:?\s+|aufgabe:\s*|[-*]\s+(?=(?:bitte\s+)?\S+\s+(?:erledigen|abgeben|anrufen|schicken|senden|prüfen|bezahlen)\b))(.{3,160})$/i.exec(z);
    if (m) aufgaben.push(m[1].trim());
  }
  return { zeichen: roh.length, gekuerzt: roh.length > DOK.maxZeichen, woerter: woerter.length, saetze: saetze.length, absaetze: t.split(/\n\s*\n/).filter((x) => x.trim()).length,
    lesezeitMin: Math.max(1, Math.round(woerter.length / 200)), gliederung, schluessel, zusammenfassung, termine: termine.slice(0, 10), aufgaben: aufgaben.slice(0, 20) };
}
// Fundstellen mit Umfeld (ganze Wörter nicht nötig, Groß-/Kleinschreibung egal)
function dokStellen(text, begriff, umfeld = 40) {
  const b = String(begriff || "").trim().toLowerCase();
  if (b.length < 2) return [];
  const t = String(text), klein = t.toLowerCase(), aus = [];
  for (let i = klein.indexOf(b); i >= 0 && aus.length < DOK.maxStellen; i = klein.indexOf(b, i + b.length)) {
    const zeile = t.slice(0, i).split("\n").length;
    aus.push({ zeile, text: (i > umfeld ? "…" : "") + t.slice(Math.max(0, i - umfeld), i + b.length + umfeld).replace(/\s+/g, " ") + (i + b.length + umfeld < t.length ? "…" : "") });
  }
  return aus;
}
// Zeilenvergleich (LCS). Ergebnis: Liste { art: "gleich"|"neu"|"weg", text } und Zähler; zu große Texte werden abgelehnt.
function dokVergleich(a, b) {
  const x = String(a).replace(/\r/g, "").split("\n"), y = String(b).replace(/\r/g, "").split("\n");
  if (x.length > DOK.maxVergleichZeilen || y.length > DOK.maxVergleichZeilen) return { fehler: `Zu groß für den Vergleich (höchstens ${DOK.maxVergleichZeilen} Zeilen je Fassung).` };
  const n = x.length, m = y.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const zeilen = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { zeilen.push({ art: "gleich", text: x[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) zeilen.push({ art: "weg", text: x[i++] });
    else zeilen.push({ art: "neu", text: y[j++] });
  }
  while (i < n) zeilen.push({ art: "weg", text: x[i++] });
  while (j < m) zeilen.push({ art: "neu", text: y[j++] });
  const z = (art) => zeilen.filter((l) => l.art === art).length;
  return { zeilen, gleich: z("gleich"), neu: z("neu"), weg: z("weg"), identisch: !z("neu") && !z("weg") };
}
// Geladene Textdokumente aus der Dateiliste (nur diese Sitzung)
function dokListe() {
  return dateienLesen().filter((e) => { const i = DATEIEN.inhalt.get(e.id); return i && typeof i.text === "string"; });
}
function dokText(id) { const i = DATEIEN.inhalt.get(id); return i && typeof i.text === "string" ? i.text : null; }
function dokBericht(e, a) {
  const z = [`# Dokumentbericht: ${e.name}`, "", `Erstellt lokal am ${new Date().toLocaleString("de-DE")} – Auswahl vorhandener Sätze, keine KI.`, dokQuelle(e), "",
    `- ${a.woerter} Wörter, ${a.saetze} Sätze, ${a.absaetze} Absätze, Lesezeit ca. ${a.lesezeitMin} min${a.gekuerzt ? " (nur die ersten 200.000 Zeichen ausgewertet)" : ""}`,
    `- Schlüsselwörter: ${a.schluessel.map((s) => `${s.wort} (${s.anzahl})`).join(", ") || "–"}`, "", "## Zusammenfassung (Kernsätze)", ...a.zusammenfassung.map((s) => "- " + s)];
  if (a.gliederung.length) z.push("", "## Gliederung", ...a.gliederung.map((g) => "  ".repeat(g.ebene - 1) + "- " + g.text));
  if (a.termine.length) z.push("", "## Erkannte Termine", ...a.termine.map((t) => `- ${new Date(t.datum).toLocaleString("de-DE")}: ${t.satz}`));
  if (a.aufgaben.length) z.push("", "## Erkannte Aufgaben", ...a.aufgaben.map((t) => "- [ ] " + t));
  return z.join("\n") + "\n";
}
function dokAnzeigen(id, jetzt = new Date()) {
  const box = document.getElementById("dok-ergebnis"), e = dateienLesen().find((x) => x.id === id), text = dokText(id);
  if (!box) return null;
  if (!e || text === null) { box.replaceChildren(Object.assign(document.createElement("p"), { className: "klein", textContent: "Kein geladenes Textdokument gewählt – Datei in der Karte „Dateien“ (erneut) auswählen." })); return null; }
  const a = dokAnalysieren(text, jetzt);
  DOK.letzte = { id, analyse: a };
  const el = (tag, txt, klasse) => Object.assign(document.createElement(tag), { textContent: txt, className: klasse || "" });
  const liste = (punkte) => { const ul = document.createElement("ul"); ul.append(...punkte.map((p) => (p instanceof Node ? (() => { const li = document.createElement("li"); li.append(p); return li; })() : el("li", p)))); return ul; };
  const teile = [el("h4", e.name), el("p", `${a.woerter} Wörter · ${a.saetze} Sätze · ${a.absaetze} Absätze · Lesezeit ca. ${a.lesezeitMin} min${a.gekuerzt ? " · nur die ersten 200.000 Zeichen ausgewertet" : ""}`, "klein"),
    el("p", "Schlüsselwörter: " + (a.schluessel.map((s) => `${s.wort} (${s.anzahl})`).join(", ") || "–"), "klein"),
    el("p", "Zusammenfassung – Kernsätze aus dem Text (lokal ausgewählt, keine KI):", "klein"), liste(a.zusammenfassung.length ? a.zusammenfassung : ["(zu wenig Text)"])];
  if (a.gliederung.length) teile.push(el("p", "Gliederung:", "klein"), liste(a.gliederung.map((g) => " ".repeat(g.ebene - 1) + g.text)));
  const vorschlag = (titel, faellig) => {
    const span = document.createElement("span");
    const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: "Als Aufgabe übernehmen" });
    b.setAttribute("aria-label", "Als Aufgabe übernehmen: " + titel);
    b.addEventListener("click", () => {
      const ok = window.aufgabenIntern && window.aufgabenIntern.hinzufuegen(titel.slice(0, 200), faellig || "", "normal", "", true);
      b.disabled = true; b.textContent = ok ? "übernommen" : "nicht übernommen";
      document.getElementById("dok-meldung").textContent = ok ? `Aufgabe „${titel.slice(0, 60)}“ angelegt (rückgängig: in der Aufgabenliste löschen).` : "Aufgabe nicht angelegt.";
    });
    span.append(document.createTextNode((faellig ? new Date(faellig).toLocaleString("de-DE") + ": " : "") + titel + " "), b);
    return span;
  };
  if (a.termine.length) teile.push(el("p", "Erkannte Termine (bitte prüfen):", "klein"), liste(a.termine.map((t) => vorschlag(t.satz, t.datum))));
  if (a.aufgaben.length) teile.push(el("p", "Erkannte Aufgaben:", "klein"), liste(a.aufgaben.map((t) => vorschlag(t, ""))));
  box.replaceChildren(...teile);
  return a;
}
function dokVergleichAnzeigen(idA, idB) {
  const box = document.getElementById("dok-ergebnis"), ta = dokText(idA), tb = dokText(idB);
  if (!box) return null;
  if (ta === null || tb === null || idA === idB) { box.replaceChildren(Object.assign(document.createElement("p"), { className: "klein", textContent: "Für den Vergleich zwei verschiedene geladene Textdokumente wählen." })); return null; }
  const v = dokVergleich(ta, tb);
  if (v.fehler) { box.replaceChildren(Object.assign(document.createElement("p"), { className: "wz-wichtig", textContent: v.fehler })); return v; }
  const kopf = Object.assign(document.createElement("p"), { className: "klein", textContent: v.identisch ? "Beide Fassungen sind zeilenweise gleich." : `${v.neu} Zeilen neu, ${v.weg} entfernt, ${v.gleich} gleich (nur Änderungen und je eine Zeile Umfeld gezeigt).` });
  const pre = Object.assign(document.createElement("pre"), { className: "datei-text dok-vergleich" });
  v.zeilen.forEach((l, i) => {
    const nah = l.art !== "gleich" || [v.zeilen[i - 1], v.zeilen[i + 1]].some((x) => x && x.art !== "gleich");
    if (!nah) return;
    pre.append(Object.assign(document.createElement("span"), { className: "dok-" + l.art, textContent: { gleich: "  ", neu: "+ ", weg: "− " }[l.art] + l.text + "\n" }));
  });
  box.replaceChildren(kopf, ...(v.identisch ? [] : [pre]));
  return v;
}
function dokAuswahlFuellen() {
  const docs = dokListe();
  for (const id of ["dok-wahl", "dok-wahl-b"]) {
    const s = document.getElementById(id);
    if (!s) continue;
    const alt = s.value;
    s.replaceChildren(...(docs.length ? docs.map((e) => Object.assign(document.createElement("option"), { value: e.id, textContent: e.name })) : [Object.assign(document.createElement("option"), { value: "", textContent: "– kein Textdokument geladen –" })]));
    if (docs.some((e) => e.id === alt)) s.value = alt;
    else if (id === "dok-wahl-b" && docs.length > 1) s.value = docs[1].id;
  }
}
// Chat/Sprache: „Fasse die Datei X zusammen“, „Analysiere Datei X“ – nur lesend, nur geladene Dokumente
skillRegistrieren({
  name: "dokumente",
  risiko: "abfrage",
  hilfeKurz: "Dokumente", // ab 11-09h: in der Hilfe als Sammelzeile
  beschreibung: "Geladenes Dokument lokal zusammenfassen (ohne KI)",
  beispiele: ["Fasse die Datei notiz.md zusammen"],
  passt: (text) => /^(fasse (die )?datei .+ zusammen|(analysiere|zusammenfassung( von| der)?) (die )?datei .+)$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const t = befehlNormalisieren(text), m = /datei (.+?)( zusammen)?$/.exec(t), wunsch = m ? m[1].trim() : "";
    // Namen wie der Befehl normalisieren („umzug.md“ → „umzug md“)
    const docs = dokListe(), nam = (e) => befehlNormalisieren(e.name), genau = docs.filter((e) => nam(e) === wunsch), treffer = genau.length ? genau : docs.filter((e) => nam(e).includes(wunsch));
    if (treffer.length !== 1) {
      lokalAntworten(!docs.length ? "Es ist kein Textdokument geladen, Sir. Bitte in der Karte „Dateien“ auswählen – Inhalte sehe ich nur in dieser Sitzung."
        : treffer.length ? `Mehrere Dokumente passen: ${treffer.slice(0, 5).map((e) => "„" + e.name + "“").join(", ")}. Bitte genauer.` : `Kein geladenes Textdokument passt zu „${wunsch}“.`);
      return true;
    }
    const a = dokAnalysieren(dokText(treffer[0].id));
    lokalAntworten(`„${treffer[0].name}“: ${a.woerter} Wörter, Lesezeit ca. ${a.lesezeitMin} min. Kernsätze (lokal ausgewählt, keine KI):\n` + (a.zusammenfassung.map((s) => "• " + s).join("\n") || "(zu wenig Text)")
      + (a.termine.length ? `\n${a.termine.length} Termin(e) und ${a.aufgaben.length} Aufgabe(n) erkannt – Übernahme nur per Knopf in der Karte „Dateien“.` : a.aufgaben.length ? `\n${a.aufgaben.length} Aufgabe(n) erkannt – Übernahme nur per Knopf.` : ""));
    const s = document.getElementById("dok-wahl");
    if (s) { dokAuswahlFuellen(); s.value = treffer[0].id; dokAnzeigen(treffer[0].id); document.getElementById("dok-details").open = true; }
    return true;
  },
});
(function dokSkillEinordnen() {
  const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation");
  SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s);
})();
// Auswahl aktuell halten, wenn sich die Dateiliste ändert
if (typeof dateienAnzeigen === "function") {
  const original = dateienAnzeigen;
  dateienAnzeigen = function () { original(); dokAuswahlFuellen(); dokNotizFelderFuellen(); };
}
(function dokEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("dok-wahl")) return;
  el("dok-analysieren").addEventListener("click", () => { el("dok-meldung").textContent = ""; dokAnzeigen(el("dok-wahl").value); });
  el("dok-vergleichen").addEventListener("click", () => { el("dok-meldung").textContent = ""; dokVergleichAnzeigen(el("dok-wahl").value, el("dok-wahl-b").value); });
  el("dok-suchen").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = dokText(el("dok-wahl").value), st = text === null ? [] : dokStellen(text, el("dok-begriff").value);
    const ul = document.createElement("ul");
    ul.append(...st.map((s) => Object.assign(document.createElement("li"), { textContent: `Zeile ${s.zeile}: ${s.text}` })));
    el("dok-ergebnis").replaceChildren(Object.assign(document.createElement("p"), { className: "klein", textContent: text === null ? "Kein geladenes Textdokument gewählt." : `${st.length}${st.length >= DOK.maxStellen ? "+" : ""} Fundstelle(n) für „${el("dok-begriff").value.trim()}“` }), ul);
  });
  el("dok-export").addEventListener("click", () => {
    const e = dateienLesen().find((x) => x.id === el("dok-wahl").value), text = e && dokText(e.id);
    if (!text) { el("dok-meldung").textContent = "Kein geladenes Textdokument gewählt."; return; }
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([dokBericht(e, dokAnalysieren(text))], { type: "text/markdown" })), download: "bericht-" + e.name.replace(/\.[^.]+$/, "") + ".md" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    el("dok-meldung").textContent = "Bericht als Markdown-Datei heruntergeladen (das Dokument selbst bleibt unverändert).";
  });
  dokAuswahlFuellen();
})();

// ---------- ab 11-09g: Nachträge Dokumentenassistent ----------
// Markdown-Vorschau: sichere Darstellung über DOM-Knoten (nie innerHTML) – Überschriften, Listen, Aufgabenlisten, Zitate, Code,
// fett/kursiv/Code im Fließtext. Links werden nur als Text gezeigt (kein Klickziel aus fremden Dateien).
function dokInline(text) {
  const frag = document.createDocumentFragment(), re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  let pos = 0;
  for (const m of String(text).matchAll(re)) {
    if (m.index > pos) frag.append(document.createTextNode(text.slice(pos, m.index)));
    const t = m[0], tag = t.startsWith("**") ? "strong" : t.startsWith("`") ? "code" : "em", inner = tag === "strong" ? t.slice(2, -2) : t.slice(1, -1);
    frag.append(Object.assign(document.createElement(tag), { textContent: inner }));
    pos = m.index + t.length;
  }
  if (pos < text.length) frag.append(document.createTextNode(text.slice(pos)));
  return frag;
}
function dokMarkdown(text, maxZeilen = 2000) {
  const box = document.createElement("div");
  box.className = "dok-markdown";
  const zeilen = String(text).replace(/\r/g, "").split("\n").slice(0, maxZeilen);
  let liste = null, code = null;
  for (const z of zeilen) {
    if (/^\s*```/.test(z)) { if (code) { box.append(code); code = null; } else { liste = null; code = document.createElement("pre"); } continue; }
    if (code) { code.append(document.createTextNode(z + "\n")); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(z), li = /^\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(z), zitat = /^>\s?(.*)$/.exec(z);
    if (li) {
      if (!liste) { liste = document.createElement(/^\s*\d/.test(z) ? "ol" : "ul"); box.append(liste); }
      const el = document.createElement("li");
      if (li[1]) el.append(document.createTextNode(/x/i.test(li[1]) ? "☑ " : "☐ "));
      el.append(dokInline(li[2])); liste.append(el); continue;
    }
    liste = null;
    if (h) { const el = document.createElement("h" + Math.min(6, h[1].length + 3)); el.append(dokInline(h[2])); box.append(el); }
    else if (zitat) { const el = document.createElement("blockquote"); el.append(dokInline(zitat[1])); box.append(el); }
    else if (/^\s*(---|\*\*\*)\s*$/.test(z)) box.append(document.createElement("hr"));
    else if (z.trim()) { const el = document.createElement("p"); el.append(dokInline(z)); box.append(el); }
  }
  if (code) box.append(code);
  if (String(text).split("\n").length > maxZeilen) box.append(Object.assign(document.createElement("p"), { className: "klein", textContent: `… gekürzt (erste ${maxZeilen} Zeilen).` }));
  return box;
}
// Dokumentnotiz und Tags: gehören zum Dateieintrag (Metadaten in „jarvis-dateien“), nie in die Datei selbst
function dokTagsNormalisieren(roh) { return [...new Set(String(roh || "").split(/[,\s]+/).map((t) => t.replace(/^#/, "").toLowerCase().replace(/[^a-zäöüß0-9-]/g, "").slice(0, 30)).filter(Boolean))].slice(0, 10); }
function dokNotizSetzen(id, notiz, tags) {
  const liste = dateienLesen(), e = liste.find((x) => x.id === id);
  if (!e || speicherBeschaedigt(DATEIEN.schluessel)) return false;
  const n = String(notiz || "").trim().slice(0, 1000);
  if (n) e.notiz = n; else delete e.notiz;
  const t = dokTagsNormalisieren(tags);
  if (t.length) e.tags = t; else delete e.tags;
  const ok = dateienSchreiben(liste); dateienAnzeigen(); return ok;
}
// Quellenangabe für alles, was aus einem Dokument abgeleitet wird
function dokQuelle(e) { return `Quelle: ${e.name}${e.sha256 ? " · SHA-256 " + e.sha256.slice(0, 16) + "…" : ""}${e.geaendert ? " · Stand " + new Date(e.geaendert).toLocaleDateString("de-DE") : ""}`; }
// Textentwurf: Gerüst aus der lokalen Analyse (Kernsätze, Termine, Aufgaben) – bearbeitbar, klar als Entwurf gekennzeichnet
const DOK_ENTWURF_ARTEN = { zusammenfassung: "Zusammenfassung", email: "E-Mail-Entwurf (wird nicht gesendet)", aufgaben: "Aufgabenliste" };
function dokEntwurf(e, a, art = "zusammenfassung") {
  const kern = a.zusammenfassung.map((s) => "- " + s).join("\n") || "- (zu wenig Text)";
  const term = a.termine.map((t) => `- ${new Date(t.datum).toLocaleString("de-DE")}: ${t.satz}`).join("\n");
  const auf = a.aufgaben.map((t) => "- [ ] " + t).join("\n");
  const kopf = `ENTWURF – lokal aus „${e.name}“ zusammengestellt, bitte prüfen. ${dokQuelle(e)}\n\n`;
  if (art === "email") return kopf + `Betreff: ${a.gliederung[0] ? a.gliederung[0].text : e.name}\n\nHallo,\n\nkurz das Wichtigste:\n${kern}\n${term ? "\nTermine:\n" + term + "\n" : ""}${auf ? "\nOffen:\n" + auf + "\n" : ""}\nViele Grüße\n`;
  if (art === "aufgaben") return kopf + (auf || "- (keine Aufgaben erkannt)") + (term ? "\n\nTermine:\n" + term : "") + "\n";
  return kopf + `# ${a.gliederung[0] ? a.gliederung[0].text : e.name}\n\n${kern}\n${term ? "\n## Termine\n" + term + "\n" : ""}${auf ? "\n## Offen\n" + auf + "\n" : ""}`;
}
// Herunterladen als .md oder .txt (Text-Export entfernt Markdown-Zeichen am Zeilenanfang)
function dokAlsText(md) { return String(md).replace(/^#{1,6}\s+/gm, "").replace(/^- \[ \] /gm, "☐ ").replace(/^- /gm, "• ").replace(/\*\*([^*]+)\*\*/g, "$1"); }
function dokHerunterladen(inhalt, name, art = "md") {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([art === "txt" ? dokAlsText(inhalt) : inhalt], { type: art === "txt" ? "text/plain" : "text/markdown" })), download: name.replace(/\.[^.]+$/, "") + "." + art });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Kopieren nur auf Klick; ohne Zwischenablage-Recht: Text markieren und Hinweis (kein stiller Fehlschlag)
async function dokKopieren(text, feld) {
  try { await navigator.clipboard.writeText(String(text)); return "kopiert"; }
  catch (e) { if (feld && feld.select) { feld.focus(); feld.select(); } return "markiert"; }
}
function dokGewaehlt() { const id = (document.getElementById("dok-wahl") || {}).value; return dateienLesen().find((x) => x.id === id) || null; }
function dokNotizFelderFuellen() {
  const e = dokGewaehlt(), n = document.getElementById("dok-notiz"), t = document.getElementById("dok-tags");
  if (!n) return;
  n.value = (e && e.notiz) || ""; t.value = e && e.tags ? e.tags.map((x) => "#" + x).join(" ") : "";
}
(function dokNachtragEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("dok-markdown")) return;
  el("dok-markdown").addEventListener("click", () => {
    const e = dokGewaehlt(), text = e && dokText(e.id);
    el("dok-ergebnis").replaceChildren(...(text === null || !e ? [Object.assign(document.createElement("p"), { className: "klein", textContent: "Kein geladenes Textdokument gewählt." })]
      : [Object.assign(document.createElement("p"), { className: "klein", textContent: "Markdown-Vorschau (sicher dargestellt, Links nur als Text) · " + dokQuelle(e) }), dokMarkdown(text)]));
  });
  el("dok-wahl").addEventListener("change", dokNotizFelderFuellen);
  el("dok-notiz-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const e = dokGewaehlt();
    el("dok-meldung").textContent = e && dokNotizSetzen(e.id, el("dok-notiz").value, el("dok-tags").value) ? "Notiz und Tags gespeichert (nur Metadaten, die Datei bleibt unverändert)." : "Nicht gespeichert – kein Dokument gewählt oder Speicher beschädigt.";
    dokNotizFelderFuellen();
  });
  el("dok-entwurf-erstellen").addEventListener("click", () => {
    const e = dokGewaehlt(), text = e && dokText(e.id);
    if (!e || text === null) { el("dok-meldung").textContent = "Kein geladenes Textdokument gewählt."; return; }
    el("dok-entwurf").value = dokEntwurf(e, dokAnalysieren(text), el("dok-entwurf-art").value);
    el("dok-entwurf-bereich").hidden = false;
    el("dok-entwurf-vorschau").replaceChildren(dokMarkdown(el("dok-entwurf").value));
    el("dok-meldung").textContent = "Entwurf erstellt – bearbeitbar, wird nirgends hin gesendet.";
  });
  el("dok-entwurf").addEventListener("input", () => el("dok-entwurf-vorschau").replaceChildren(dokMarkdown(el("dok-entwurf").value)));
  const name = () => "entwurf-" + ((dokGewaehlt() || {}).name || "dokument");
  el("dok-entwurf-md").addEventListener("click", () => { dokHerunterladen(el("dok-entwurf").value, name(), "md"); el("dok-meldung").textContent = "Entwurf als Markdown heruntergeladen."; });
  el("dok-entwurf-txt").addEventListener("click", () => { dokHerunterladen(el("dok-entwurf").value, name(), "txt"); el("dok-meldung").textContent = "Entwurf als Text heruntergeladen."; });
  el("dok-entwurf-kopieren").addEventListener("click", async () => { const r = await dokKopieren(el("dok-entwurf").value, el("dok-entwurf")); el("dok-meldung").textContent = r === "kopiert" ? "In die Zwischenablage kopiert." : "Zwischenablage nicht erlaubt – Text ist markiert, bitte mit Strg+C kopieren."; });
  el("dok-entwurf-art").replaceChildren(...Object.entries(DOK_ENTWURF_ARTEN).map(([k, v]) => Object.assign(document.createElement("option"), { value: k, textContent: v })));
  dokNotizFelderFuellen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("dokumente");
