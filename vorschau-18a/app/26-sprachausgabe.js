// JARVIS Dashboard – Modul „sprachausgabe“ (ab 11-07d). Ergänzt die vorhandene Vorlese-Verwaltung (app/22-sprache.js: Ansagenummer gegen
// Überlappung, Stopp, Teilung langer Texte, Google-Stimme mit Browser-Ersatz) um:
//   - Aussprache: Geldbeträge („10.000,00 USD“ → „10.000 US-Dollar“), Prozent, Vorzeichen, Abkürzungen und Kennzahlen (KGV, RSI, EMA 20),
//     Pausen statt Zeilenumbrüchen und Aufzählungszeichen. Nur der vorgelesene Text ändert sich, nie die Anzeige.
//   - Vorlese-Umfang „vollständig“ (Standard) oder „kurz“ (erste Sätze, Rest steht im Chat). Rückfragen mit Bestätigung werden immer
//     vollständig vorgelesen.
//   - Dialogzustand: sichtbare Anzeige einer offenen Rückfrage (Bestätigung, Paper-Order, Strategie-Dialog) mit Restzeit und
//     „Rückfrage verwerfen“ – verwerfen führt nie etwas aus.
// Keine Anfrage. Speicher nur „jarvis-vorlesen-umfang“ (Bereich „Stimme & Sprache“).

// ---------- Aussprache ----------
const AG = "(?<![A-Za-zÄÖÜäöüß0-9])", AE = "(?![A-Za-zÄÖÜäöüß0-9])";
const AUSSPRACHE = [
  // Pausen: Zeilenumbruch ohne Satzzeichen → Punkt; Aufzählungszeichen und Mittelpunkte
  [/([^.!?:;,\s])[ \t]*\n+/g, "$1. "],
  [/\n+/g, " "],
  [/(^|\s)[•▪◦]\s*/g, "$1"],
  [/\s*·\s*/g, ", "],
  [/\s*→\s*/g, ", dann "],
  [/≥\s*/g, "mindestens "], [/≤\s*/g, "höchstens "], [/≈\s*/g, "etwa "], [/Ø\s*/g, "Durchschnitt "],
  // Abkürzungen
  [/(?<![A-Za-zÄÖÜäöüß])z\.\s?B\./g, "zum Beispiel"], [/(?<![A-Za-zÄÖÜäöüß])d\.\s?h\./g, "das heißt"], [/(?<![A-Za-zÄÖÜäöüß])u\.\s?a\./g, "unter anderem"],
  [new RegExp(AG + "bzw\\.", "g"), "beziehungsweise"], [new RegExp(AG + "ca\\.", "g"), "circa"], [new RegExp(AG + "ggf\\.", "g"), "gegebenenfalls"],
  [new RegExp(AG + "inkl\\.", "g"), "inklusive"], [new RegExp(AG + "ggü\\.", "g"), "gegenüber"], [new RegExp(AG + "Nr\\.(?=\\s?\\d)", "g"), "Nummer"],
  [new RegExp(AG + "Mio\\.", "g"), "Millionen"], [new RegExp(AG + "Mrd\\.", "g"), "Milliarden"], [new RegExp(AG + "Tsd\\.", "g"), "Tausend"],
  // Kennzahlen
  [new RegExp(AG + "KGV" + AE, "g"), "Kurs-Gewinn-Verhältnis"], [new RegExp(AG + "KUV" + AE, "g"), "Kurs-Umsatz-Verhältnis"],
  [new RegExp(AG + "KBV" + AE, "g"), "Kurs-Buchwert-Verhältnis"], [new RegExp(AG + "EPS" + AE, "g"), "Gewinn je Aktie"],
  [new RegExp(AG + "(RSI|EMA|SMA|ATR|MACD|ETF)(\\d*)" + AE, "g"), (m, k, n) => k.split("").join(" ") + (n ? " " + n : "")],
  // Geld: „,00“ vor der Währung weglassen; Währungen ausschreiben
  [/(\d),00(?=\s?(?:USDT|USD|EUR|€|\$)(?![A-Za-z]))/g, "$1"],
  [new RegExp(AG + "USDT" + AE, "g"), "U S D T"], [new RegExp(AG + "USD" + AE, "g"), "US-Dollar"], [new RegExp(AG + "EUR" + AE, "g"), "Euro"],
  [/(\d)\s?€/g, "$1 Euro"], [/\$\s?(\d[\d.,]*)/g, "$1 US-Dollar"], [/(\d)\s?\$/g, "$1 US-Dollar"],
  // Vorzeichen nur direkt vor einer Zahl und nach Leerzeichen/Klammer (Bereiche wie „2-3“ und Datumsangaben bleiben)
  [/(^|[\s(])\+(?=\d)/g, "$1plus "], [/(^|[\s(])[−-](?=\d)/g, "$1minus "],
  [/(\d)\s?%/g, "$1 Prozent"],
];
function vorleseAussprache(text) {
  let t = String(text);
  for (const [muster, ersatz] of AUSSPRACHE) t = t.replace(muster, ersatz);
  return t;
}

// ---------- Vorlese-Umfang ----------
const VORLESE_UMFANG = { schluessel: "jarvis-vorlesen-umfang", kurzMax: 220, werte: { voll: "vollständig", kurz: "kurz" }, sitzung: null, rest: "Den Rest finden Sie im Chat." };
// Ungültiger gespeicherter Wert: gemeldet wie die übrigen Spracheinstellungen, wirksam ist der Standard „vollständig“
EINSTELLUNG_REGELN.push({ name: VORLESE_UMFANG.schluessel, titel: "Vorlese-Umfang", erlaubt: Object.keys(VORLESE_UMFANG.werte), standard: "vollständig" });
einstellungFehlerZeigen();
function vorleseUmfang() {
  if (VORLESE_UMFANG.sitzung) return VORLESE_UMFANG.sitzung; // nicht speicherbar: gilt bis zum Neuladen
  return einstellungLesen(VORLESE_UMFANG.schluessel) === "kurz" ? "kurz" : "voll";
}
// Rückfragen und Bestätigungen nie kürzen: dort steht, was genau passieren würde
const VORLESE_NIE_KUERZEN = /Bitte bestätigen|„Ja“|Paper-Order zur Bestätigung|nichts ausgeführt|Not-Aus/;
function vorleseKurzfassung(text) {
  const t = String(text || "").trim();
  if (vorleseUmfang() !== "kurz" || t.length <= VORLESE_UMFANG.kurzMax || VORLESE_NIE_KUERZEN.test(t) || t.endsWith(VORLESE_UMFANG.rest)) return t;
  const saetze = t.split(/(?<=[.!?])\s+/);
  let kurz = "";
  for (const s of saetze) { if (kurz && (kurz + " " + s).length > VORLESE_UMFANG.kurzMax) break; kurz = kurz ? kurz + " " + s : s; }
  if (kurz.length > VORLESE_UMFANG.kurzMax) kurz = kurz.slice(0, kurz.lastIndexOf(" ", VORLESE_UMFANG.kurzMax)).replace(/[,;:]$/, "") + " …";
  return kurz + " " + VORLESE_UMFANG.rest;
}
(function umfangEinrichten() {
  const feld = document.getElementById("vorlesen-umfang");
  if (!feld) return;
  feld.replaceChildren(...Object.entries(VORLESE_UMFANG.werte).map(([wert, text]) => Object.assign(document.createElement("option"), { value: wert, textContent: text })));
  feld.value = vorleseUmfang();
  feld.addEventListener("change", () => {
    const ok = einstellungSchreiben(VORLESE_UMFANG.schluessel, feld.value);
    VORLESE_UMFANG.sitzung = ok ? null : feld.value;
    einstellungFehlerZeigen();
    const h = document.getElementById("sprach-hinweis");
    if (h) h.textContent = "Vorlese-Umfang: " + VORLESE_UMFANG.werte[feld.value] + (ok === false ? " (nicht gespeichert – gilt bis zum Neuladen)" : "") + ".";
  });
})();

// ---------- Dialogzustand ----------
// Liefert die offene Rückfrage oder null: { art, text, bis }
function dialogZustand() {
  if (typeof offeneAktion !== "undefined" && offeneAktion) return { art: "bestaetigung", text: "Bestätigung offen: " + offeneAktion.beschreibung, bis: offeneAktion.bis || null };
  if (typeof paperOffen !== "undefined" && paperOffen) return { art: "paper", text: "Paper-Order wartet auf „Ja“ oder „Nein“ (nur Simulation).", bis: paperOffen.bis || null };
  if (typeof SL_DIALOG !== "undefined" && SL_DIALOG.aktiv && Date.now() <= SL_DIALOG.bis) return { art: "strategie", text: "Strategie-Vergleich wartet auf Werte.", bis: SL_DIALOG.bis };
  return null;
}
function dialogZustandAktualisieren() {
  const box = document.getElementById("dialog-zustand");
  if (!box) return null;
  const z = dialogZustand();
  box.hidden = !z;
  if (z) {
    const rest = z.bis ? Math.max(0, Math.round((z.bis - Date.now()) / 1000)) : null;
    const text = z.text + (rest !== null ? " Verfällt in " + rest + " s." : "") + " Antwort: „Ja“/„Nein“ oder Knopf in der Nachricht.";
    const el = document.getElementById("dialog-zustand-text");
    if (el.textContent !== text) el.textContent = text;
    box.dataset.art = z.art;
  }
  return z;
}
// Verwerfen führt nie etwas aus – es nutzt die vorhandenen Abbruchwege
function dialogVerwerfen() {
  const z = dialogZustand();
  if (!z) return false;
  if (z.art === "bestaetigung") offeneAktionAbbrechen();
  else if (z.art === "paper") paperAbbrechen();
  else { slDialogBeenden(); lokalAntworten("Strategie-Vergleich abgebrochen. Es wurde nichts gerechnet."); }
  dialogZustandAktualisieren();
  return true;
}
document.getElementById("dialog-verwerfen").addEventListener("click", () => { dialogVerwerfen(); document.getElementById("befehl").focus(); });
// ab 11-07o: im verborgenen Tab nicht aktualisieren (beim Zurückkehren sofort)
setInterval(() => { if (document.visibilityState !== "hidden") dialogZustandAktualisieren(); }, 500);
document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "hidden") dialogZustandAktualisieren(); });

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("sprachausgabe");
