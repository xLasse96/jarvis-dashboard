// JARVIS Dashboard – Modul „rechner“ (ab 11-09n). Analyse- und Rechenwerkzeuge im Reiter „Analyse“, alles lokal:
//   - Rechner mit eigenem Formelparser (kein eval/Function): + − × ÷ ^ %, Klammern, sqrt/abs/round/min/max, deutsches Komma
//   - Prozent (p % von G, Anteil, Veränderung), Verhältnis (gekürzt), Statistik (Anzahl, Summe, Mittel, Median, Min, Max, Std.-Abw.)
//   - CSV: Import (≤ 2 MB, ≤ 5.000 Zeilen, ≤ 50 Spalten) mit Vorschau, Trennzeichen- und Zahlenformaterkennung, Prüfung (Spaltenzahl,
//     fehlende Werte, ungültige Zahlen), Tabelle mit Sortieren/Filtern/Gruppieren, Statistik je Spalte, Zeitreihenvergleich,
//     Diagramm (SVG), Export (gegen Formel-Einschleusung in Tabellenprogrammen geschützt), Ergebniszusammenfassung
// Keine Anfrage, kein Speicher (die CSV liegt nur im Arbeitsspeicher dieser Sitzung).
const RECHNER = { maxDatei: 2 * 1024 * 1024, maxZeilen: 5000, maxSpalten: 50, maxAnzeige: 200, maxAusdruck: 300, daten: null, sicht: null };
// ---------- Formelparser ----------
function rechnerTokens(text) {
  const t = String(text || "").replace(/×|·/g, "*").replace(/÷|:/g, "/").replace(/−/g, "-").replace(/\s+/g, "");
  if (!t || t.length > RECHNER.maxAusdruck) throw new Error(t ? "Ausdruck zu lang" : "leerer Ausdruck");
  const tokens = [];
  for (let i = 0; i < t.length;) {
    const rest = t.slice(i);
    let m;
    if ((m = /^(\d+(?:[.,]\d+)?|[.,]\d+)/.exec(rest))) { tokens.push({ art: "zahl", wert: Number(m[1].replace(",", ".")) }); i += m[1].length; continue; }
    if ((m = /^(sqrt|wurzel|abs|round|runde|min|max)/i.exec(rest))) { tokens.push({ art: "fn", wert: { wurzel: "sqrt", runde: "round" }[m[1].toLowerCase()] || m[1].toLowerCase() }); i += m[1].length; continue; }
    if ("+-*/^%(),;".includes(t[i])) { tokens.push({ art: t[i] === ";" ? "," : t[i] }); i++; continue; }
    throw new Error(`unerlaubtes Zeichen „${t[i]}“ (erlaubt: Zahlen, + − × ÷ ^ %, Klammern, sqrt, abs, round, min, max)`);
  }
  return tokens;
}
// Grammatik: summe := produkt (('+'|'-') produkt)* ; produkt := einheit (('*'|'/') einheit)* ; einheit := ('-'|'+') einheit | potenz ;
// potenz := primaer '%'? ('^' einheit)? ; primaer := zahl | '(' summe ')' | fn '(' summe (';' summe)* ')'
function rechnerAuswerten(text) {
  const tk = rechnerTokens(text);
  let i = 0;
  const sieh = () => tk[i], nimm = (art) => { if (!tk[i] || tk[i].art !== art) throw new Error(`erwartet „${art}“`); return tk[i++]; };
  const summe = () => { let w = produkt(); while (sieh() && (sieh().art === "+" || sieh().art === "-")) { const op = tk[i++].art, r = produkt(); w = op === "+" ? w + r : w - r; } return w; };
  // Vorzeichen bindet schwächer als ^ (−2^2 = −4), Prozent direkt an der Zahl
  const produkt = () => { let w = einheit(); while (sieh() && (sieh().art === "*" || sieh().art === "/")) { const op = tk[i++].art, r = einheit(); if (op === "/" && r === 0) throw new Error("Division durch null"); w = op === "*" ? w * r : w / r; } return w; };
  const einheit = () => { if (sieh() && (sieh().art === "-" || sieh().art === "+")) { const op = tk[i++].art, w = einheit(); return op === "-" ? -w : w; } return potenz(); };
  const potenz = () => { let b = primaer(); if (sieh() && sieh().art === "%") { i++; b /= 100; } if (sieh() && sieh().art === "^") { i++; const e = einheit(); if (Math.abs(e) > 1000) throw new Error("Exponent zu groß"); return b ** e; } return b; };
  const primaer = () => {
    const x = sieh();
    if (!x) throw new Error("Ausdruck endet zu früh");
    if (x.art === "zahl") { i++; return x.wert; }
    if (x.art === "(") { i++; const w = summe(); nimm(")"); return w; }
    if (x.art === "fn") {
      i++; nimm("(");
      const args = [summe()];
      while (sieh() && sieh().art === ",") { i++; args.push(summe()); }
      nimm(")");
      if (x.wert === "sqrt") { if (args[0] < 0) throw new Error("Wurzel aus negativer Zahl"); return Math.sqrt(args[0]); }
      if (x.wert === "abs") return Math.abs(args[0]);
      if (x.wert === "round") { const s = args[1] !== undefined ? Math.max(0, Math.min(10, Math.round(args[1]))) : 0; return Math.round(args[0] * 10 ** s) / 10 ** s; }
      return x.wert === "min" ? Math.min(...args) : Math.max(...args);
    }
    throw new Error("unerwartetes Zeichen");
  };
  const w = summe();
  if (i < tk.length) throw new Error("unerwartetes Zeichen am Ende");
  if (!Number.isFinite(w)) throw new Error("Ergebnis ist keine endliche Zahl");
  return w;
}
const rechnerZahl = (x, stellen = 10) => (Number.isFinite(x) ? Number(x.toPrecision(12)).toLocaleString("de-DE", { maximumFractionDigits: stellen }) : "–");
// ---------- Prozent, Verhältnis, Statistik ----------
const prozentVon = (p, g) => (p * g) / 100;
const prozentAnteil = (teil, ganzes) => { if (ganzes === 0) throw new Error("Grundwert ist null"); return (teil / ganzes) * 100; };
const prozentAenderung = (alt, neu) => { if (alt === 0) throw new Error("Ausgangswert ist null"); return ((neu - alt) / Math.abs(alt)) * 100; };
function verhaeltnis(a, b) {
  if (!(a > 0 && b > 0)) throw new Error("Verhältnis nur für positive Werte");
  const ggt = (x, y) => (y < 1e-9 ? x : ggt(y, x % y));
  const f = 10 ** Math.min(6, Math.max(...[a, b].map((x) => (String(x).split(".")[1] || "").length)));
  const g = ggt(Math.round(a * f), Math.round(b * f));
  return { text: `${rechnerZahl(Math.round(a * f) / g)} : ${rechnerZahl(Math.round(b * f) / g)}`, faktor: a / b };
}
function statistik(werte) {
  const z = werte.filter((x) => Number.isFinite(x));
  if (!z.length) return { anzahl: 0 };
  const s = z.slice().sort((a, b) => a - b), summe = z.reduce((a, b) => a + b, 0), mittel = summe / z.length;
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const std = z.length > 1 ? Math.sqrt(z.reduce((a, x) => a + (x - mittel) ** 2, 0) / (z.length - 1)) : 0;
  return { anzahl: z.length, summe, mittel, median, min: s[0], max: s[s.length - 1], std };
}
// ---------- CSV ----------
function csvParsen(text) {
  let t = String(text || "");
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  if (!t.trim()) return { fehler: "Die Datei ist leer." };
  if (/\u0000/.test(t.slice(0, 2000))) return { fehler: "Keine Textdatei (Binärdaten)." };
  const ersteZeile = t.split(/\r?\n/)[0];
  const trenner = [";", "\t", ","].map((c) => [c, (ersteZeile.match(new RegExp(c === "\t" ? "\t" : "\\" + c, "g")) || []).length]).sort((a, b) => b[1] - a[1])[0];
  const tz = trenner[1] ? trenner[0] : ";";
  // ab 14a: zu jedem Datensatz die Dateizeile merken, in der er beginnt (Zeilenumbrüche in Quotes und Leerzeilen mitgezählt)
  const zeilen = [], dateizeile = [];
  let feld = "", zeile = [], inQ = false, i = 0, nr = 1, start = 1;
  for (; i < t.length; i++) {
    const c = t[i];
    if (inQ) { if (c === '"') { if (t[i + 1] === '"') { feld += '"'; i++; } else inQ = false; } else { if (c === "\n" || (c === "\r" && t[i + 1] !== "\n")) nr++; feld += c; } continue; }
    if (c === '"' && feld === "") { inQ = true; continue; }
    if (c === tz) { zeile.push(feld); feld = ""; continue; }
    if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; zeile.push(feld); feld = ""; if (zeile.some((x) => x.trim() !== "")) { zeilen.push(zeile); dateizeile.push(start); } zeile = []; nr++; start = nr; if (zeilen.length > RECHNER.maxZeilen + 1) break; continue; }
    feld += c;
  }
  if (inQ) return { fehler: "Beschädigte CSV: ein Anführungszeichen wird nicht geschlossen." };
  if (feld !== "" || zeile.length) { zeile.push(feld); if (zeile.some((x) => x.trim() !== "")) { zeilen.push(zeile); dateizeile.push(start); } }
  if (zeilen.length < 2) return { fehler: "Zu wenig Zeilen (Kopfzeile und mindestens eine Datenzeile nötig)." };
  // ab 14b: nur das BOM am Dateianfang (auch hinter ungültigen Bytes) ist eine Kodierungsmarke und wird still entfernt;
  // andere unsichtbare Zeichen in Spaltennamen, doppelte und gekürzte Namen werden gemeldet statt still geändert
  const UNSICHTBAR = /[﻿​-‍⁠]/, kopfHinweise = [];
  const kopf = zeilen[0].map((k, j) => {
    const s = j === 0 ? String(k).replace(/^(�*)﻿/, "$1") : String(k), n = s.trim();
    if (n.length > 60) kopfHinweise.push(`Spaltenname ${j + 1} auf 60 Zeichen gekürzt.`);
    const name = n.slice(0, 60) || `Spalte ${j + 1}`;
    if (UNSICHTBAR.test(s)) kopfHinweise.push(`Spaltenname ${j + 1} („${name.replace(/[﻿​-‍⁠]/g, "")}“) enthält ein unsichtbares Zeichen (BOM/Nullbreite) – bitte in der Quelldatei prüfen.`);
    return name;
  });
  const doppelt = [...new Set(kopf.filter((k, j) => kopf.indexOf(k) !== j))];
  if (doppelt.length) kopfHinweise.push(`Doppelte Spaltennamen (${doppelt.map((x) => "„" + x + "“").join(", ")}) – Spalten werden nur nach Position unterschieden.`);
  if (kopf.length > RECHNER.maxSpalten) return { fehler: `Zu viele Spalten (${kopf.length}, höchstens ${RECHNER.maxSpalten}).` };
  const warnungen = [];
  // ab 13x: ungültiges UTF-8 ersetzt der Browser beim Lesen still durch „�“ (z. B. ANSI-Export von Excel) – nicht stillschweigend übernehmen
  if (t.includes("�")) warnungen.push("Die Datei enthält Zeichen, die nicht als UTF-8 lesbar sind (als „�“ angezeigt) – vermutlich ANSI/Windows-1252. Umlaute und € können falsch sein; bitte als „CSV UTF-8“ speichern und neu laden.");
  warnungen.push(...kopfHinweise);
  let daten = zeilen.slice(1);
  if (daten.length > RECHNER.maxZeilen) { warnungen.push(`Nur die ersten ${RECHNER.maxZeilen} Datenzeilen übernommen.`); daten = daten.slice(0, RECHNER.maxZeilen); }
  // ab 14a: zu wenige und zu viele Felder getrennt melden (vorher hieß es auch bei überzähligen Feldern „fehlende Felder gelten als leer“)
  const falsch = daten.map((z, n) => [dateizeile[n + 1], z.length]).filter(([, l]) => l !== kopf.length);
  const zuWenig = falsch.filter(([, l]) => l < kopf.length), zuViel = falsch.filter(([, l]) => l > kopf.length);
  if (zuWenig.length) warnungen.push(`${zuWenig.length} Zeile(n) mit abweichender Spaltenzahl – zu wenige Felder (z. B. Zeile ${zuWenig[0][0]}: ${zuWenig[0][1]} statt ${kopf.length}); fehlende Felder gelten als leer.`);
  if (zuViel.length) warnungen.push(`${zuViel.length} Zeile(n) mit abweichender Spaltenzahl – zu viele Felder (z. B. Zeile ${zuViel[0][0]}: ${zuViel[0][1]} statt ${kopf.length}); überzählige Felder werden nicht übernommen.`);
  daten = daten.map((z) => kopf.map((_, j) => String(z[j] === undefined ? "" : z[j]).trim()));
  // Zahlenformat je Spalte: deutsch („1.234,5“) oder englisch („1,234.5“ / „1234.5“)
  const spalten = kopf.map((name, j) => {
    const werte = daten.map((z) => z[j]), belegt = werte.filter((x) => x !== "");
    const de = belegt.filter((x) => /^[-+]?\d{1,3}(\.\d{3})*(,\d+)?$|^[-+]?\d+(,\d+)?$/.test(x)).length, en = belegt.filter((x) => /^[-+]?\d{1,3}(,\d{3})*(\.\d+)?$|^[-+]?\d+(\.\d+)?$/.test(x)).length;
    // Gleichstand (z. B. „2.400“ oder ganze Zahlen) → deutsches Format; Zahlenspalte, wenn mindestens 60 % (und 2) Werte Zahlen sind
    const format = de >= en ? "de" : "en", zahlig = Math.max(de, en);
    const numerisch = zahlig >= Math.min(2, belegt.length) && belegt.length > 0 && zahlig / belegt.length >= 0.6;
    const zahl = (x) => { if (x === "") return null; const s = format === "de" ? x.replace(/\./g, "").replace(",", ".") : x.replace(/,/g, ""); const n = Number(s); return /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s) && Number.isFinite(n) ? n : NaN; };
    const zahlen = numerisch ? werte.map(zahl) : null;
    const leer = werte.filter((x) => x === "").length, ungueltig = zahlen ? zahlen.filter((x) => Number.isNaN(x)).length : 0;
    if (leer) warnungen.push(`„${name}“: ${leer} fehlende(r) Wert(e).`);
    if (ungueltig) warnungen.push(`„${name}“: ${ungueltig} ungültige Zahl(en) – werden nicht mitgerechnet.`);
    return { name, numerisch, format, zahlen, leer, ungueltig };
  });
  return { kopf, daten, spalten, trenner: { ";": "Semikolon", "\t": "Tabulator", ",": "Komma" }[tz], warnungen };
}
// Sicht: Filter (Text in irgendeiner Spalte), Sortierung (Spalte, auf/ab) – liefert Zeilenindizes
function csvSicht(d, { filter = "", sortSpalte = -1, absteigend = false } = {}) {
  const f = String(filter).toLowerCase().trim();
  let idx = d.daten.map((_, i) => i).filter((i) => !f || d.daten[i].some((x) => x.toLowerCase().includes(f)));
  if (sortSpalte >= 0 && sortSpalte < d.kopf.length) {
    const s = d.spalten[sortSpalte];
    idx.sort((a, b) => {
      const x = s.numerisch ? s.zahlen[a] : d.daten[a][sortSpalte], y = s.numerisch ? s.zahlen[b] : d.daten[b][sortSpalte];
      const leerX = x === null || Number.isNaN(x) || x === "", leerY = y === null || Number.isNaN(y) || y === "";
      if (leerX !== leerY) return leerX ? 1 : -1; // leere/ungültige immer ans Ende
      const v = s.numerisch ? x - y : String(x).localeCompare(String(y), "de");
      return absteigend ? -v : v;
    });
  }
  return idx;
}
function csvGruppieren(d, idx, gruppeSpalte, wertSpalte, art = "summe") {
  const s = d.spalten[wertSpalte], g = new Map();
  if (!s || !s.numerisch) return { fehler: "Die Wertspalte enthält keine Zahlen." };
  for (const i of idx) { const k = d.daten[i][gruppeSpalte] || "(leer)", v = s.zahlen[i]; if (!g.has(k)) g.set(k, []); if (Number.isFinite(v)) g.get(k).push(v); }
  return { gruppen: [...g.entries()].map(([k, w]) => { const st = statistik(w); return { gruppe: k, anzahl: w.length, wert: art === "anzahl" ? w.length : st.anzahl ? st[art === "mittel" ? "mittel" : art === "min" ? "min" : art === "max" ? "max" : "summe"] : null }; }).sort((a, b) => (b.wert ?? -Infinity) - (a.wert ?? -Infinity)) };
}
// Zeitreihenvergleich: erste und letzte gültige Werte je Spalte, Veränderung in %, Abstand am Ende
function zeitreihenVergleich(d, idx, spaltenNr) {
  return spaltenNr.map((j) => {
    const s = d.spalten[j], w = idx.map((i) => s.zahlen[i]).filter((x) => Number.isFinite(x));
    if (w.length < 2) return { name: s.name, fehler: "zu wenige gültige Werte" };
    let aend = null;
    try { aend = prozentAenderung(w[0], w[w.length - 1]); } catch (e) { /* Ausgangswert 0 */ }
    return { name: s.name, start: w[0], ende: w[w.length - 1], aenderung: aend, punkte: w.length };
  });
}
// Export: Text, der mit = + − @ beginnt, bekommt ein ' vorangestellt (Tabellenprogramme würden ihn sonst als Formel ausführen)
function csvZelle(x, zahl) {
  let s = String(x === null || x === undefined ? "" : x);
  if (!zahl && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvExport(d, idx) {
  const zeilen = [d.kopf.map((k) => csvZelle(k, false)).join(";"), ...idx.map((i) => d.daten[i].map((x, j) => csvZelle(x, d.spalten[j].numerisch && Number.isFinite(d.spalten[j].zahlen[i]))).join(";"))];
  return "﻿" + zeilen.join("\r\n") + "\r\n";
}
function csvZusammenfassung(d, idx) {
  const num = d.spalten.map((s, j) => [s, j]).filter(([s]) => s.numerisch);
  const teile = [`${idx.length} von ${d.daten.length} Zeilen, ${d.kopf.length} Spalten (${num.length} mit Zahlen), Trennzeichen ${d.trenner}.`];
  for (const [s, j] of num.slice(0, 6)) { const st = statistik(idx.map((i) => s.zahlen[i])); if (st.anzahl) teile.push(`„${s.name}“: Mittel ${rechnerZahl(st.mittel, 2)}, Median ${rechnerZahl(st.median, 2)}, Spanne ${rechnerZahl(st.min, 2)} bis ${rechnerZahl(st.max, 2)} (${st.anzahl} Werte).`); }
  if (d.warnungen.length) teile.push(`${d.warnungen.length} Hinweis(e) zur Datenqualität – siehe oben.`);
  teile.push("Beschreibende Statistik, keine Prognose.");
  return teile.join(" ");
}
// Diagramm: Linie je Zahlenspalte (bis 2, höchstens 500 Punkte); reines SVG ohne Bibliothek
function csvDiagramm(d, idx, spaltenNr) {
  const ns = "http://www.w3.org/2000/svg", B = 600, H = 220, R = 30;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${B} ${H}`); svg.setAttribute("role", "img"); svg.classList.add("rechner-diagramm");
  const reihen = spaltenNr.slice(0, 2).map((j) => ({ name: d.spalten[j].name, w: idx.slice(0, 500).map((i) => d.spalten[j].zahlen[i]) }));
  const alle = reihen.flatMap((r) => r.w.filter(Number.isFinite));
  svg.setAttribute("aria-label", "Diagramm: " + reihen.map((r) => r.name).join(" und ") + (alle.length ? ` (${rechnerZahl(Math.min(...alle), 2)} bis ${rechnerZahl(Math.max(...alle), 2)})` : " – keine Werte"));
  if (!alle.length) return svg;
  const lo = Math.min(...alle), hi = Math.max(...alle), sp = hi - lo || 1;
  reihen.forEach((r, k) => {
    const n = r.w.length, pkt = r.w.map((v, i) => (Number.isFinite(v) ? `${(R + (i / Math.max(1, n - 1)) * (B - 2 * R)).toFixed(1)},${(H - R - ((v - lo) / sp) * (H - 2 * R)).toFixed(1)}` : null)).filter(Boolean);
    const l = document.createElementNS(ns, "polyline");
    l.setAttribute("points", pkt.join(" ")); l.setAttribute("fill", "none"); l.setAttribute("stroke-width", "2"); l.classList.add("rechner-linie-" + k);
    svg.append(l);
  });
  for (const [y, v] of [[R, hi], [H - R, lo]]) { const t = document.createElementNS(ns, "text"); t.setAttribute("x", "2"); t.setAttribute("y", String(y)); t.textContent = rechnerZahl(v, 2); t.classList.add("rechner-achse"); svg.append(t); }
  return svg;
}
// ---------- Chat: Rechnen und Prozent (lokal, ohne KI) ----------
function rechnerSatz(text) {
  const t = befehlNormalisieren(text).replace(/\?$/, "");
  let m;
  if ((m = /^(?:was (?:ist|sind|ergibt)|wie viel (?:ist|sind)|wieviel (?:ist|sind)) ([\d.,]+) ?(?:%|prozent) von ([\d.,]+)$/.exec(t))) { const p = Number(m[1].replace(",", ".")), g = Number(m[2].replace(",", ".")); return `${rechnerZahl(p)} % von ${rechnerZahl(g)} = ${rechnerZahl(prozentVon(p, g))}`; }
  if ((m = /^wie ?viel prozent (?:sind|ist|macht|machen) ([\d.,]+) von ([\d.,]+)$/.exec(t))) { const a = Number(m[1].replace(",", ".")), g = Number(m[2].replace(",", ".")); return `${rechnerZahl(a)} von ${rechnerZahl(g)} = ${rechnerZahl(prozentAnteil(a, g), 2)} %`; }
  if ((m = /^(?:rechne|berechne|was ist|was ergibt)\s+(.+)$/.exec(String(text).toLowerCase().replace(/^\s*(hey\s+)?jarvis[\s,]+/, "").replace(/[?!]+\s*$/, "").trim())) && /^[\d\s.,+\-*/×÷^%()·−:a-z;]+$/.test(m[1]) && /\d/.test(m[1]) && !/[a-z]{2,}/.test(m[1].replace(/sqrt|wurzel|abs|round|runde|min|max/g, ""))) return `${m[1].trim()} = ${rechnerZahl(rechnerAuswerten(m[1]))}`;
  return null;
}
skillRegistrieren({
  name: "rechner",
  risiko: "abfrage",
  hilfeKurz: "Rechnen",
  beschreibung: "Lokal rechnen: Formeln und Prozent (ohne KI)",
  beispiele: ["Rechne 12*(3+4)", "Was sind 19% von 250?"],
  passt: (text) => { try { return rechnerSatz(text) !== null; } catch (e) { return /^(rechne|berechne)\s/.test(befehlNormalisieren(text)); } },
  aktion: async (text) => {
    try { lokalAntworten(rechnerSatz(text) + " (lokal gerechnet)"); } catch (e) { lokalAntworten("Nicht berechnet: " + e.message + "."); }
    return true;
  },
});
(function rechnerEinordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();
// ---------- Oberfläche ----------
function rechnerTabelleAnzeigen() {
  const el = (id) => document.getElementById(id), d = RECHNER.daten;
  if (!d) return;
  const sortSpalte = Number(el("csv-sort").value), idx = csvSicht(d, { filter: el("csv-filter").value, sortSpalte, absteigend: el("csv-richtung").value === "ab" });
  RECHNER.sicht = idx;
  const tab = document.createElement("table");
  tab.className = "rechner-tabelle";
  const kopf = tab.createTHead().insertRow();
  for (const k of d.kopf) kopf.append(Object.assign(document.createElement("th"), { scope: "col", textContent: k }));
  const body = tab.createTBody();
  for (const i of idx.slice(0, RECHNER.maxAnzeige)) { const tr = body.insertRow(); d.daten[i].forEach((x, j) => { const td = tr.insertCell(); td.textContent = x; if (d.spalten[j].numerisch && Number.isNaN(d.spalten[j].zahlen[i])) td.className = "wz-wichtig"; }); }
  el("csv-tabelle").replaceChildren(tab);
  el("csv-status").textContent = `${idx.length} von ${d.daten.length} Zeilen` + (idx.length > RECHNER.maxAnzeige ? ` (angezeigt: erste ${RECHNER.maxAnzeige})` : "");
  const st = d.spalten.map((s, j) => [s, j]).filter(([s]) => s.numerisch).map(([s, j]) => { const x = statistik(idx.map((i) => s.zahlen[i])); return x.anzahl ? `${s.name}: n=${x.anzahl}, Summe ${rechnerZahl(x.summe, 2)}, Mittel ${rechnerZahl(x.mittel, 2)}, Median ${rechnerZahl(x.median, 2)}, Min ${rechnerZahl(x.min, 2)}, Max ${rechnerZahl(x.max, 2)}, Std.-Abw. ${rechnerZahl(x.std, 2)}` : `${s.name}: keine gültigen Werte`; });
  el("csv-statistik").replaceChildren(...st.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  el("csv-zusammenfassung").textContent = csvZusammenfassung(d, idx);
}
function rechnerDatenSetzen(d, name) {
  const el = (id) => document.getElementById(id);
  RECHNER.daten = d;
  const opt = (v, t) => Object.assign(document.createElement("option"), { value: String(v), textContent: t });
  el("csv-sort").replaceChildren(opt(-1, "unsortiert"), ...d.kopf.map((k, j) => opt(j, "nach " + k)));
  el("csv-gruppe").replaceChildren(...d.kopf.map((k, j) => opt(j, "gruppieren nach " + k)));
  const num = d.spalten.map((s, j) => [s, j]).filter(([s]) => s.numerisch);
  el("csv-wert").replaceChildren(...(num.length ? num.map(([s, j]) => opt(j, "Wert: " + s.name)) : [opt(-1, "keine Zahlenspalte")]));
  el("csv-reihen").replaceChildren(...num.map(([s, j]) => opt(j, s.name)));
  [...el("csv-reihen").options].slice(0, 2).forEach((o) => { o.selected = true; });
  el("csv-bereich").hidden = false;
  el("csv-meldung").textContent = `„${name}“ geladen: ${d.daten.length} Zeilen, ${d.kopf.length} Spalten, Trennzeichen ${d.trenner}.`;
  el("csv-warnungen").replaceChildren(...(d.warnungen.length ? d.warnungen : ["Keine Auffälligkeiten."]).map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  rechnerTabelleAnzeigen();
}
(function rechnerEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("rechner-form")) return;
  el("rechner-form").addEventListener("submit", (e) => {
    e.preventDefault();
    try { el("rechner-ergebnis").textContent = "= " + rechnerZahl(rechnerAuswerten(el("rechner-ausdruck").value)); }
    catch (x) { el("rechner-ergebnis").textContent = "Nicht berechnet: " + x.message + "."; }
  });
  el("prozent-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const a = Number(String(el("prozent-a").value).replace(",", ".")), b = Number(String(el("prozent-b").value).replace(",", "."));
    try {
      if (!Number.isFinite(a) || !Number.isFinite(b) || el("prozent-a").value === "" || el("prozent-b").value === "") throw new Error("bitte zwei Zahlen eingeben");
      const art = el("prozent-art").value;
      el("prozent-ergebnis").textContent = art === "von" ? `${rechnerZahl(a)} % von ${rechnerZahl(b)} = ${rechnerZahl(prozentVon(a, b))}` : art === "anteil" ? `${rechnerZahl(a)} von ${rechnerZahl(b)} = ${rechnerZahl(prozentAnteil(a, b), 2)} %`
        : art === "aenderung" ? `von ${rechnerZahl(a)} auf ${rechnerZahl(b)}: ${prozentAenderung(a, b) >= 0 ? "+" : ""}${rechnerZahl(prozentAenderung(a, b), 2)} %` : `Verhältnis ${verhaeltnis(a, b).text} (Faktor ${rechnerZahl(verhaeltnis(a, b).faktor, 4)})`;
    } catch (x) { el("prozent-ergebnis").textContent = "Nicht berechnet: " + x.message + "."; }
  });
  el("statistik-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const teile = el("statistik-werte").value.split(/[;\s]+|,(?=\s)/).filter(Boolean), werte = teile.map((x) => Number(x.replace(",", ".")));
    const falsch = teile.filter((_, i) => !Number.isFinite(werte[i]));
    const st = statistik(werte);
    el("statistik-ergebnis").textContent = !st.anzahl ? "Keine gültigen Zahlen." : `n=${st.anzahl} · Summe ${rechnerZahl(st.summe)} · Mittel ${rechnerZahl(st.mittel, 4)} · Median ${rechnerZahl(st.median, 4)} · Min ${rechnerZahl(st.min)} · Max ${rechnerZahl(st.max)} · Std.-Abw. ${rechnerZahl(st.std, 4)}` + (falsch.length ? ` · nicht mitgerechnet: ${falsch.slice(0, 5).join(", ")}` : "");
  });
  // ab 14a: „CSV öffnen …“ als echter Knopf (vorher ein Label um ein verstecktes Dateifeld – per Tastatur nicht erreichbar)
  el("csv-waehlen").addEventListener("click", () => el("csv-datei").click());
  el("csv-datei").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > RECHNER.maxDatei) { el("csv-meldung").textContent = `Datei zu groß (${(f.size / 1048576).toFixed(1)} MB, höchstens 2 MB) – nicht gelesen.`; return; }
    const d = csvParsen(await f.text());
    if (d.fehler) { el("csv-meldung").textContent = "Nicht geladen: " + d.fehler; return; }
    rechnerDatenSetzen(d, typeof dateiNameSicher === "function" ? dateiNameSicher(f.name) : f.name);
  });
  el("csv-beispiel").addEventListener("click", () => rechnerDatenSetzen(csvParsen("Monat;Kategorie;Ausgaben;Einnahmen\nJan;Haushalt;850,50;2.400\nFeb;Haushalt;910;2.400\nMär;Freizeit;320,75;2.450\nApr;Haushalt;;2.450\nMai;Freizeit;410,20;2.500\nJun;Haushalt;880;abc\n"), "Beispiel (synthetisch)"));
  for (const id of ["csv-filter", "csv-sort", "csv-richtung"]) el(id).addEventListener(id === "csv-filter" ? "input" : "change", rechnerTabelleAnzeigen);
  el("csv-gruppieren").addEventListener("click", () => {
    const d = RECHNER.daten; if (!d) return;
    const g = csvGruppieren(d, RECHNER.sicht, Number(el("csv-gruppe").value), Number(el("csv-wert").value), el("csv-art").value);
    el("csv-gruppen").replaceChildren(...(g.fehler ? [g.fehler] : g.gruppen.map((x) => `${x.gruppe}: ${x.wert === null ? "–" : rechnerZahl(x.wert, 2)} (${x.anzahl} Werte)`)).map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  });
  el("csv-vergleichen").addEventListener("click", () => {
    const d = RECHNER.daten; if (!d) return;
    const nr = [...el("csv-reihen").selectedOptions].map((o) => Number(o.value)).slice(0, 2);
    const v = zeitreihenVergleich(d, RECHNER.sicht, nr);
    el("csv-vergleich").replaceChildren(...v.map((x) => Object.assign(document.createElement("li"), { textContent: x.fehler ? `${x.name}: ${x.fehler}` : `${x.name}: ${rechnerZahl(x.start, 2)} → ${rechnerZahl(x.ende, 2)} (${x.aenderung === null ? "Änderung nicht berechenbar (Start 0)" : (x.aenderung >= 0 ? "+" : "") + rechnerZahl(x.aenderung, 2) + " %"}, ${x.punkte} Werte)` })));
    el("csv-diagramm").replaceChildren(csvDiagramm(d, RECHNER.sicht, nr));
  });
  el("csv-export").addEventListener("click", () => {
    const d = RECHNER.daten; if (!d) return;
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csvExport(d, RECHNER.sicht)], { type: "text/csv" })), download: "jarvis-tabelle-" + new Date().toISOString().slice(0, 10) + ".csv" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    el("csv-meldung").textContent = `${RECHNER.sicht.length} Zeilen exportiert (Semikolon, UTF-8, gegen Formel-Einschleusung geschützt).`;
  });
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("rechner");
