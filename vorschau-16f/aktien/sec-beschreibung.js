// JARVIS Aktien – Unternehmensbeschreibung aus dem Jahresbericht bei der SEC (10-K, ausländische Emittenten 20-F). Reine Funktionen
// ohne Netz: Bericht aus „submissions“ wählen, im HTML-Dokument den Abschnitt „Item 1. Business“ (10-K) bzw. „Item 4. Information on
// the Company“ (20-F) finden und als WÖRTLICHEN, gekürzten Auszug liefern – mit Formular, Einreichungsdatum, Geschäftsjahr und Quelle.
// Keine KI-Zusammenfassung, keine Übersetzung, nichts aus Ticker, Firmenname oder Kursen abgeleitet. Ein Bericht ist eine Selbstauskunft
// des Unternehmens, keine geprüfte Bewertung. Das HTML wird mit DOMParser gelesen (Skripte werden dabei nie ausgeführt) und nur als
// Text weitergegeben; das ganze Dokument wird nicht gespeichert.
// Vorbild für die Auswahl „neuester 10-K/20-F“: trader-analyst/facts.py:353-379 (latest_filings, Commit 5189e79).
(function (global) {
  "use strict";

  const TAG = 86400000;
  const FORMEN = ["10-K", "20-F"];                 // 40-F enthält keinen Business-Abschnitt (Beschreibung steht im Anhang AIF)
  const MAX_ZEICHEN_HTML = 30 * 1024 * 1024;        // größer: nicht lesen
  const AUSZUG_MIN = 500, AUSZUG_MAX = 900;         // Auszug: ganze Sätze, höchstens rund 900 Zeichen
  const VERALTET_TAGE = 456;                        // ein Jahresbericht älter als ca. 15 Monate gilt als veraltet
  const ABSCHNITT = {
    // ab 14t: auch „Item 1. Description of (the) Business“ und kombiniert „Items 1 and 2. Business and Properties“ (dann endet der Abschnitt
    // erst bei Item 1A oder 3); Groß-/Kleinschreibung und Trennzeichen egal
    "10-K": { name: "Item 1. Business", start: /^(part\s+i[,.]?\s*)?items?\s*1(\s*(and|&)\s*2)?\s*[.:\-–—]?\s*(description\s+of\s+(the\s+)?)?business\b/i, ende: /^items?\s*(1a|1b|1c|2|3)\b/i, endeKombiniert: /^items?\s*(1a|1b|1c|3)\b/i },
    "20-F": { name: "Item 4. Information on the Company", start: /^item\s*4\s*[.:\-–—]?\s*information\s+on\s+the\s+company\b/i, ende: /^item\s*(4a|5)\b/i },
  };
  const BLOCK = new Set(["P", "DIV", "BR", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "SECTION", "ARTICLE", "UL", "OL", "BLOCKQUOTE", "PRE", "HR", "CENTER", "FONT"]);

  const datum = (s) => Date.parse(String(s || "") + "T00:00:00Z");
  const gueltigesDatum = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && Number.isFinite(datum(s)) && new Date(datum(s)).toISOString().slice(0, 10) === s;

  // Neuester Jahresbericht aus SEC „submissions“ (filings.recent). Original vor Änderung (…/A) am selben Tag, sonst höhere Akzessionsnummer.
  // Gibt es nur Änderungen, wird die neueste Änderung genommen (Hinweis). Unerwartete Struktur → Fehler statt Raten.
  function berichtWaehlen(submissions, { jetzt = Date.now() } = {}) {
    const r = submissions && submissions.filings && submissions.filings.recent;
    const felder = ["form", "filingDate", "accessionNumber", "primaryDocument"];
    if (!r || felder.some((f) => !Array.isArray(r[f])) || felder.some((f) => r[f].length !== r.form.length)) return { fehler: "SEC-Meldungsliste hat eine unerwartete Struktur – keine Auswahl.", gefunden: false };
    const kandidaten = [];
    for (let i = 0; i < r.form.length; i++) {
      const form = String(r.form[i] || ""), basis = form.replace(/\/A$/, ""), doc = String(r.primaryDocument[i] || "");
      if (!FORMEN.includes(basis) || !gueltigesDatum(r.filingDate[i]) || !/^\d{10}-\d{2}-\d{6}$/.test(String(r.accessionNumber[i] || "")) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.html?$/i.test(doc)) continue;
      kandidaten.push({ form: basis, aenderung: form !== basis, eingereicht: r.filingDate[i], zeitraum: r.reportDate && gueltigesDatum(r.reportDate[i]) ? r.reportDate[i] : null, akz: String(r.accessionNumber[i]), dokument: doc });
    }
    const andere = [...new Set(r.form.map(String))].filter((f) => !FORMEN.includes(f.replace(/\/A$/, ""))).slice(0, 6);
    if (!kandidaten.length) return { fehler: `Keine 10-K/20-F-Einreichung in der SEC-Meldungsliste${andere.length ? " (vorhanden u. a.: " + andere.join(", ") + ")" : ""}.`, gefunden: false };
    const originale = kandidaten.filter((k) => !k.aenderung), pool = originale.length ? originale : kandidaten;
    pool.sort((a, b) => b.eingereicht.localeCompare(a.eingereicht) || b.akz.localeCompare(a.akz));
    const w = pool[0], cik = String(Number(submissions.cik || 0)).padStart(10, "0");
    const alter = Math.floor((jetzt - datum(w.eingereicht)) / TAG);
    const doppelt = pool.filter((k) => k.eingereicht === w.eingereicht).length > 1;
    return {
      ...w, cik, name: submissions.name ? String(submissions.name).slice(0, 200) : null,
      fruehere_namen: Array.isArray(submissions.formerNames) ? submissions.formerNames.map((n) => n && n.name).filter(Boolean).map((n) => String(n).slice(0, 200)).slice(0, 5) : [],
      alter_tage: alter, veraltet: alter > VERALTET_TAGE,
      hinweise: [...(w.aenderung ? ["nur eine Änderungsmeldung (/A) vorhanden"] : []), ...(doppelt ? ["mehrere Jahresberichte am selben Tag – der mit der höheren Akzessionsnummer gilt"] : [])],
      link: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${w.akz.replace(/-/g, "")}/${w.dokument}`,
    };
  }

  // HTML → Text mit Absätzen (iterativ, auch bei tief verschachteltem oder beschädigtem HTML); Tabellen, Skripte, Stile und versteckte
  // Bereiche (Inline-XBRL-Kopf) entfallen. dei-Angaben werden vorher gelesen (sie stehen meist im versteckten Kopf).
  function htmlLesen(html) {
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    const dei = (name) => [...doc.querySelectorAll(`[name="dei:${name}"]`)].map((e) => e.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).map((t) => t.slice(0, 200));
    const angaben = { name: dei("EntityRegistrantName")[0] || null, ticker: [...new Set(dei("TradingSymbol").map((t) => t.toUpperCase()))], cik: dei("EntityCentralIndexKey")[0] || null,
      form: dei("DocumentType")[0] || null, periode: dei("DocumentPeriodEndDate")[0] || null, geschaeftsjahr: dei("DocumentFiscalYearFocus")[0] || null };
    // ab 14t: kleine Überschrift-Tabellen („Item 1. | Business“, höchstens 2 Zeilen) als Textzeile behalten; Daten- und Inhaltsverzeichnis-
    // Tabellen entfallen wie bisher
    for (const t of [...doc.querySelectorAll("table")]) {
      const zeilenT = t.querySelectorAll("tr").length, inhalt = t.textContent.replace(/\s+/g, " ").trim();
      if (zeilenT <= 2 && /^items?\s*\d/i.test(inhalt) && inhalt.length < 160) { const p = doc.createElement("p"); p.textContent = inhalt; t.replaceWith(p); }
    }
    for (const e of [...doc.querySelectorAll("script, style, noscript, template, iframe, object, embed, table, head")]) e.remove();
    for (const e of [...doc.querySelectorAll("[style]")]) if (/display\s*:\s*none/i.test(e.getAttribute("style") || "")) e.remove();
    for (const e of [...doc.getElementsByTagName("*")]) if (/^ix:header$/i.test(e.tagName)) e.remove();
    const teile = [], stapel = [[doc.body || doc.documentElement, false]];
    while (stapel.length) {
      const [knoten, zu] = stapel.pop();
      if (zu) { teile.push("\n"); continue; }
      if (knoten.nodeType === 3) { teile.push(knoten.nodeValue); continue; }
      if (knoten.nodeType !== 1) continue;
      const block = BLOCK.has(knoten.tagName.toUpperCase());
      if (block) { teile.push(knoten.tagName.toUpperCase() === "LI" ? "\n• " : "\n"); stapel.push([knoten, true]); }
      for (let i = knoten.childNodes.length - 1; i >= 0; i--) stapel.push([knoten.childNodes[i], false]);
    }
    // Entities löst DOMParser auf; Unicode bleibt erhalten – entfernt werden nur geschütztes Leerzeichen (→ Leerzeichen), weiche Trennung
    // und Null-Breite-Zeichen (unsichtbar). ab 14t: Seitenfußzeilen/Navigation („Apple Inc. | 2025 Form 10-K | 3“, „Table of Contents“,
    // reine Seitenzahlen) entfallen
    const NAVI = /^(table of contents|index|back to (top|contents)|page \d+( of \d+)?|\d{1,3}|[ivxlc]{1,6}|.{0,80}\|\s*(\d{4}\s+)?form\s+(10-k|20-f)\s*\|\s*\d{1,3})$/i;
    const text = teile.join("").replace(/\u00a0/g, " ").replace(/[\u00ad\u200b\u200c\u200d\u2060\ufeff]/g, "").replace(/[ \t\r\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n")
      .split("\n").filter((z) => !NAVI.test(z.trim())).join("\n").replace(/\n• \n/g, "\n").trim();
    const format = /<ix:/i.test(String(html)) ? "Inline-XBRL (HTML)" : "HTML";
    return { text, angaben, format };
  }

  // Abschnitt finden: jede Zeile, die wie die Überschrift aussieht, ist ein Kandidat; gewählt wird der längste Abschnitt bis zur nächsten
  // Item-Überschrift (das Inhaltsverzeichnis ergibt nur kurze Stücke). Ergebnis: wörtlicher Auszug aus ganzen Sätzen.
  function beschreibungLesen(html, { form = "10-K" } = {}) {
    const diagnose = [];
    if (form !== "auto" && !ABSCHNITT[form]) return { ok: false, grund: `Für das Formular ${form} gibt es keinen Business-Abschnitt in JARVIS.`, diagnose };
    if (typeof html !== "string" || !html.trim()) return { ok: false, grund: "Das Berichtsdokument ist leer.", diagnose };
    if (html.length > MAX_ZEICHEN_HTML) return { ok: false, grund: `Das Berichtsdokument ist zu groß (über ${MAX_ZEICHEN_HTML / 1024 / 1024} MB) – nicht gelesen.`, diagnose };
    // ab 14t: Formaterkennung – ohne ein einziges HTML-Element ist es kein HTML-Jahresbericht (z. B. reiner Text oder PDF-Inhalt)
    if (!/<(html|body|p|div|span|table|font)\b/i.test(html)) return { ok: false, grund: "Die Datei ist kein HTML-Dokument (erwartet: 10-K/20-F als .htm von sec.gov).", diagnose: ["Format: kein HTML"], format: "kein HTML" };
    let gelesen;
    try { gelesen = htmlLesen(html); } catch (e) { return { ok: false, grund: "Das Berichtsdokument ist nicht lesbar (HTML beschädigt).", diagnose: [String(e && e.message || e).slice(0, 120)] }; }
    // „auto“ (eingelesene Datei): Formular aus der Angabe im Dokument (dei:DocumentType); 40-F u. a. haben keinen Business-Abschnitt
    if (form === "auto") {
      const f = String(gelesen.angaben.form || "").toUpperCase().replace(/\/A$/, "");
      if (!f) return { ok: false, grund: "Das Dokument nennt keine Formularart (dei:DocumentType fehlt) – kein Jahresbericht im erwarteten Format.", diagnose, angaben: gelesen.angaben };
      if (!ABSCHNITT[f]) return { ok: false, grund: `Das Dokument ist ein ${f}, kein 10-K/20-F – kein Business-Abschnitt.`, diagnose, angaben: gelesen.angaben };
      form = f;
    }
    const regel = ABSCHNITT[form];
    // „Item 1.“ und „Business“ stehen manchmal in zwei Zeilen
    const roh = gelesen.text.split("\n"), zeilen = [];
    for (let i = 0; i < roh.length; i++) {
      if (/^item\s*\d+[a-z]?\s*[.:\-–—]?$/i.test(roh[i]) && i + 1 < roh.length && roh[i + 1].length < 80) { zeilen.push(roh[i] + " " + roh[i + 1]); i++; } else zeilen.push(roh[i]);
    }
    diagnose.push(`Format ${gelesen.format}, Text ${gelesen.text.length} Zeichen, ${zeilen.length} Zeilen`);
    const starts = zeilen.map((z, i) => (z.length < 160 && regel.start.test(z) ? i : -1)).filter((i) => i >= 0);
    diagnose.push(`Überschrift „${regel.name}“: ${starts.length} Fundstelle(n)` + (starts.length ? ` (Zeilen ${starts.slice(0, 5).join(", ")})` : ""));
    if (!starts.length) return { ok: false, grund: `Abschnitt „${regel.name}“ im Bericht nicht gefunden.`, diagnose, angaben: gelesen.angaben };
    let best = null;
    for (const s of starts) {
      const ende = regel.endeKombiniert && /^items?\s*1\s*(and|&)\s*2/i.test(zeilen[s]) ? regel.endeKombiniert : regel.ende;
      let e = s + 1;
      while (e < zeilen.length && !(zeilen[e].length < 160 && ende.test(zeilen[e])) && !(zeilen[e].length < 160 && regel.start.test(zeilen[e]))) e++;
      // Fließtext (ab 40 Zeichen oder mit Satzende) und Listenpunkte zählen; kurze Zwischenüberschriften bleiben im Auszug, zählen aber nicht.
      // ab 14t: wörtlich doppelte Absätze nur einmal
      const gesehen = new Set(), stuecke = [];
      for (const z of zeilen.slice(s + 1, e)) {
        const art = z.startsWith("• ") && z.length > 3 ? "liste" : z.length >= 40 || /[.!?]$/.test(z) ? "text" : z.length >= 3 && z.length < 80 && !/^items?\s*\d/i.test(z) ? "titel" : null;
        if (!art || (art !== "titel" && gesehen.has(z))) continue;
        gesehen.add(z); stuecke.push({ art, z });
      }
      const absaetze = stuecke.filter((x) => x.art !== "titel").map((x) => x.z);
      const laenge = absaetze.reduce((n, z) => n + z.length, 0);
      if (!best || laenge > best.laenge) best = { s, e, absaetze, stuecke, laenge, doppelt: zeilen.slice(s + 1, e).length - stuecke.length };
    }
    diagnose.push(`gewählt: Zeile ${best.s} bis ${best.e}, ${best.laenge} Zeichen Fließtext` + (best.doppelt > 0 ? `, ${best.doppelt} Zeile(n) ausgelassen (doppelt/Navigation)` : ""));
    if (best.laenge < 200) return { ok: false, grund: `Abschnitt „${regel.name}“ ist leer oder zu kurz – keine Beschreibung.`, diagnose, angaben: gelesen.angaben };
    // Auszug: Zwischenüberschriften, Absätze und Listenpunkte in Reihenfolge, ganze Sätze, bis ca. AUSZUG_MAX Zeichen; nie mit einer
    // Überschrift enden
    let auszug = "";
    for (const st of best.stuecke) {
      if (st.art === "titel") { if ((auszug + "\n" + st.z).length < AUSZUG_MAX - 80) auszug = auszug ? auszug + "\n" + st.z : st.z; continue; }
      const a = st.z;
      const kandidat = auszug ? auszug + "\n" + a : a;
      if (kandidat.length <= AUSZUG_MAX) { auszug = kandidat; if (auszug.length >= AUSZUG_MIN) break; continue; }
      const saetze = a.match(/[^.!?]+[.!?]+(\s|$)/g) || [];
      for (const satz of saetze) { const k = (auszug ? auszug + (auszug.endsWith("\n") ? "" : " ") : "") + satz.trim(); if (k.length > AUSZUG_MAX) break; auszug = k; }
      break;
    }
    // Überschriften am Ende des Auszugs entfernen (ohne folgenden Text bedeutungslos)
    const titel = new Set(best.stuecke.filter((x) => x.art === "titel").map((x) => x.z));
    let zeilenA = auszug.split("\n");
    while (zeilenA.length && titel.has(zeilenA[zeilenA.length - 1])) zeilenA.pop();
    auszug = zeilenA.join("\n");
    if (!auszug.trim()) { const s = (best.absaetze[0].match(/[^.!?]+[.!?]+/) || [best.absaetze[0].slice(0, AUSZUG_MAX)])[0]; auszug = s.slice(0, AUSZUG_MAX); }
    const textLaenge = auszug.split("\n").filter((z) => !titel.has(z)).reduce((n, z) => n + z.length, 0);
    return { ok: true, abschnitt: regel.name, form, auszug: auszug.trim(), gekuerzt: textLaenge < best.laenge, laenge_abschnitt: best.laenge, angaben: gelesen.angaben, format: gelesen.format, diagnose };
  }

  // Ergebnis für die Analyse: Bericht (aus submissions) + Auszug; prüft, dass Dokument und Symbol zusammenpassen, wenn das Dokument
  // Ticker oder CIK nennt (Inline-XBRL dei). Passt es nicht, keine Beschreibung.
  function ergebnisBauen(bericht, gelesen, symbol, { tickerPflicht = false } = {}) {
    const a = (gelesen && gelesen.angaben) || {};
    // eingelesene Datei: ohne Ticker im Dokument keine Zuordnung (nichts raten)
    if (gelesen && gelesen.ok && tickerPflicht && !(a.ticker && a.ticker.length)) return { ok: false, grund: "Das Dokument nennt keinen Ticker (dei:TradingSymbol) – Zuordnung zu " + symbol + " nicht belegbar.", diagnose: gelesen.diagnose };
    if (gelesen && gelesen.ok && a.ticker && a.ticker.length && symbol && !a.ticker.includes(String(symbol).toUpperCase())) return { ok: false, grund: `Der Bericht nennt die Ticker ${a.ticker.join(", ")}, nicht ${symbol} – nicht zugeordnet.`, diagnose: gelesen.diagnose };
    if (gelesen && gelesen.ok && a.form && bericht && bericht.form && String(a.form).toUpperCase().replace(/\/A$/, "") !== bericht.form) return { ok: false, grund: `Das Dokument ist ein ${String(a.form).slice(0, 12)}, laut SEC-Meldungsliste sollte es ein ${bericht.form} sein – nicht zugeordnet.`, diagnose: gelesen.diagnose };
    if (gelesen && gelesen.ok && a.cik && bericht && bericht.cik && String(Number(a.cik)) !== String(Number(bericht.cik))) return { ok: false, grund: "Die CIK im Bericht passt nicht zur SEC-Meldungsliste – nicht zugeordnet.", diagnose: gelesen.diagnose };
    if (!gelesen || !gelesen.ok) return { ok: false, grund: (gelesen && gelesen.grund) || "Keine Beschreibung gelesen.", diagnose: (gelesen && gelesen.diagnose) || [] };
    const namen = bericht && bericht.name && a.name && a.name.toUpperCase() !== bericht.name.toUpperCase() ? [`im Bericht als „${a.name}“ bezeichnet`] : [];
    return { ok: true, firma: (bericht && bericht.name) || a.name || null, auszug: gelesen.auszug, gekuerzt: gelesen.gekuerzt, abschnitt: gelesen.abschnitt,
      form: (bericht && bericht.form) || gelesen.form, eingereicht: (bericht && bericht.eingereicht) || null, zeitraum: (bericht && bericht.zeitraum) || a.periode || null,
      geschaeftsjahr: a.geschaeftsjahr || null, akz: bericht ? bericht.akz : null, link: bericht ? bericht.link : null, alter_tage: bericht ? bericht.alter_tage : null,
      veraltet: Boolean(bericht && bericht.veraltet), format: gelesen.format || null, hinweise: [...((bericht && bericht.hinweise) || []), ...namen], diagnose: gelesen.diagnose,
      // ab 14v: CIK nur aus der SEC-Meldungsliste (sicher) oder – bei eingelesener Datei – als Angabe des Dokuments (getrennt gekennzeichnet)
      cik: bericht && Number(bericht.cik) > 0 ? String(Number(bericht.cik)).padStart(10, "0") : null,
      cik_dokument: !bericht && /^\d{1,10}$/.test(String(a.cik || "").trim()) && Number(a.cik) > 0 ? String(Number(a.cik)).padStart(10, "0") : null };
  }

  global.AktienSecBeschreibung = { berichtWaehlen, htmlLesen, beschreibungLesen, ergebnisBauen, FORMEN, ABSCHNITT, AUSZUG_MAX, VERALTET_TAGE };
})(typeof window !== "undefined" ? window : globalThis);
