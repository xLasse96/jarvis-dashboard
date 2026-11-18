// JARVIS Dashboard – Modul „sprache4“ (ab 11-11b). Sprachsteuerung – ergänzt 22/25/26/40/53 (Transkriptvorschau, Unsicherheitsschwelle,
// Korrektur „Nein, ich meinte …“, Umgangssprache, Eigenstimmenschutz, Unterbrechung, Zeitangaben):
//   - Zahlwörter in Zeitangaben: „in zwei Stunden“, „um drei Uhr“, „in zehn Minuten“, „um halb vier“, „in dreiundzwanzig Tagen“
//   - weitere Alltagssätze: „Schreib mir auf …“, „Notier …“ (Notiz), „Wie sieht es morgen aus?“, „Was liegt heute an?“
//   - Watchlist-Vergleich: „Vergleiche meine Watchlist“ – vorher als „zur Watchlist hinzufügen“ fehlgedeutet; wird jetzt vor dem
//     Aktien-Dispatcher erkannt (nur dieser Satz, nur ohne offene Rückfrage und nie, wenn der Sperr-Skill greift)
//   - doppelte Befehle: derselbe Befehl wird nicht erneut ausgeführt, solange er noch läuft (z. B. doppeltes Senden per Sprache)
// Kein Speicher, keine Anfrage.
const SPR4_ZAHLWORT = { ein: 1, eins: 1, eine: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12,
  dreizehn: 13, vierzehn: 14, fünfzehn: 15, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, dreißig: 30, dreissig: 30, vierzig: 40, fünfzig: 50, fuenfzig: 50 };
function zahlwortWert(w) {
  const x = String(w).toLowerCase();
  if (SPR4_ZAHLWORT[x] !== undefined) return SPR4_ZAHLWORT[x];
  const m = /^(ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun)und(zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig)$/.exec(x);
  return m ? SPR4_ZAHLWORT[m[1] === "ein" ? "ein" : m[1]] + SPR4_ZAHLWORT[m[2]] : null;
}
const SPR4_ZW = "(ein|eins|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|dreizehn|vierzehn|fünfzehn|fuenfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig|(?:ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun)und(?:zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig))";
// Nur in Zeitzusammenhang ersetzen – Titel wie „Drei Musketiere lesen“ bleiben unberührt
function zahlwoerterZeit(text) {
  const z = (w) => String(zahlwortWert(w));
  return String(text || "")
    .replace(new RegExp(`\\b(in|nach|für|fuer)\\s+${SPR4_ZW}\\s+(minuten?|stunden?|tagen?|wochen?|monaten?)\\b`, "gi"), (m, p, w, e) => `${p} ${z(w)} ${e}`)
    .replace(new RegExp(`\\b(um|gegen|ab|bis)\\s+(halb|viertel nach|viertel vor|dreiviertel)?\\s*${SPR4_ZW}(\\s+uhr)?\\b`, "gi"), (m, p, h, w, u) => (h || u || /^(um|gegen)$/i.test(p) ? `${p} ${h ? h + " " : ""}${z(w)}${u || ""}` : m))
    .replace(new RegExp(`\\b${SPR4_ZW}\\s+uhr\\b`, "gi"), (m, w) => `${z(w)} uhr`);
}
// ab 11-13e: Ordnungszahlen „am fünfzehnten“, „zum ersten“ → „am 15.“ (vorher blieb „am fünfzehnten“ im Titel stehen)
const SPR4_ORDNUNG = { ersten: 1, erste: 1, zweiten: 2, zweite: 2, dritten: 3, dritte: 3, vierten: 4, vierte: 4, fünften: 5, fünfte: 5, fuenften: 5, sechsten: 6, sechste: 6, siebten: 7, siebte: 7, achten: 8, achte: 8, neunten: 9, neunte: 9, zehnten: 10, zehnte: 10, elften: 11, elfte: 11, zwölften: 12, zwölfte: 12, zwoelften: 12 };
function ordnungszahlWert(w) {
  const x = String(w).toLowerCase(); if (SPR4_ORDNUNG[x]) return SPR4_ORDNUNG[x];
  const m = /^(.+?)(sten|ste|ten|te)$/.exec(x); if (!m) return null;
  const v = zahlwortWert(m[1]); return v && v >= 13 && v <= 31 ? v : null;
}
// Die Zeiterkennung (25) versteht nur „Tag.Monat.“ – ein Tag ohne Monat („am 15.“) wird deshalb zum nächsten passenden Datum ergänzt:
// dieser Monat, wenn der Tag noch nicht vorbei ist, sonst der nächste Monat, der diesen Tag hat. Ein gesprochener Monat („am ersten Dezember“) gilt.
const SPR4_MONATE = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
function ordnungszahlenZeit(text, jetzt = new Date()) {
  const re = new RegExp(`(^|\\s)(am|zum|bis zum|ab dem)\\s+([a-zäöüß]+|\\d{1,2}\\.)(?:\\s+(${SPR4_MONATE.join("|")}|maerz))?(?=[\\s,!?]|\\.?$|\\.\\s)(?!\\s*(?:uhr|minuten?|stunden?|mal|tag|\\d))`, "gi");
  return String(text || "").replace(re, (m, vor, p, w, mon) => {
    const v = /^\d/.test(w) ? Number(w.slice(0, -1)) : ordnungszahlWert(w);
    if (!v || v > 31) return m;
    let d = null;
    if (mon) {
      const mi = SPR4_MONATE.indexOf(mon.toLowerCase().replace("maerz", "märz"));
      for (const j of [jetzt.getFullYear(), jetzt.getFullYear() + 1]) { const x = new Date(j, mi, v); if (x.getMonth() === mi && x >= new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate())) { d = x; break; } }
    } else {
      for (let k = 0; k < 13 && !d; k++) { const x = new Date(jetzt.getFullYear(), jetzt.getMonth() + k, v); if (x.getDate() === v && (k > 0 || v >= jetzt.getDate())) d = x; }
    }
    return d ? `${vor}${p} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}` : m;
  });
}
if (typeof zeitangabeErkennen === "function") {
  const vorOrd = zeitangabeErkennen;
  zeitangabeErkennen = function (text, jetzt, ...rest) { return vorOrd(ordnungszahlenZeit(text, jetzt || new Date()), jetzt, ...rest); };
}
if (typeof zeitangabeErkennen === "function") {
  const original = zeitangabeErkennen;
  zeitangabeErkennen = function (text, ...rest) { return original(zahlwoerterZeit(text), ...rest); };
}
if (typeof SPRACH_REGELN !== "undefined") SPRACH_REGELN.push(
  [/^(?:schreib|schreibe)(?: mir| dir)? auf\s*[:,]?\s+(.+)$/, "neue notiz $1"],
  [/^(?:notier|notiere)(?: mir| dir)?\s*[:,]?\s+(.+)$/, "neue notiz $1"],
  [/^wie sieht(?: es|'s|s)? (heute|morgen) aus$/, "was steht $1 an"],
  [/^was liegt (heute|morgen) an$/, "was steht $1 an"],
);
// ---------- Watchlist-Vergleich ----------
const WL_UEBERBLICK = /^(wie steht (es um )?meine (aktien-)?watchlist|zusammenfassung (der |meiner )?watchlist)$/;
const WL_VERGLEICH = /^(vergleiche?( mir)? (meine|die) watchlist|watchlist vergleichen|wie schneiden meine (watchlist-?werte|watchlist-?aktien) ab)$/;
function watchlistVergleich(jetzt = Date.now()) {
  const u = typeof aktienUebersicht === "function" ? aktienUebersicht(jetzt).filter((x) => x.watchlist) : [];
  const an = u.filter((x) => x.analysiert), offen = u.filter((x) => !x.analysiert).map((x) => x.symbol);
  return { zeilen: an.map((x) => ({ symbol: x.symbol, kennzahlen: x.kennzahlen, stichtag: x.stichtag, aussagekraft: typeof aktienAussagekraft === "function" ? aktienAussagekraft(x).stufe : "?" })), offen };
}
function watchlistVergleichText() {
  const v = watchlistVergleich();
  if (!v.zeilen.length && !v.offen.length) return "Deine Watchlist ist leer.";
  const z = (x) => (x === null || x === undefined ? "–" : auebZahl(x));
  return (v.zeilen.length ? "Watchlist-Vergleich: " + v.zeilen.map((x) => `${x.symbol} KGV ${z(x.kennzahlen.pe)} · KUV ${z(x.kennzahlen.kuv)} · EK-Rendite ${z(x.kennzahlen.roe)} (Aussagekraft ${x.aussagekraft})`).join("; ") + "." : "Noch keine Watchlist-Aktie analysiert.")
    + (v.offen.length ? ` Noch nicht analysiert: ${v.offen.join(", ")}.` : "") + " Einordnung vorhandener Werte, keine Empfehlung und kein Handelssignal.";
}
skillRegistrieren({
  name: "watchlist-vergleich", risiko: "abfrage", hilfeKurz: "Watchlist-Vergleich",
  beschreibung: "Watchlist-Werte vergleichen (nur lesend, kein Signal)", beispiele: ["Vergleiche meine Watchlist"],
  passt: (text) => WL_VERGLEICH.test(befehlNormalisieren(text)),
  aktion: async () => { lokalAntworten(watchlistVergleichText()); return true; },
});
(function wlvEinordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();
// ---------- vor dem Dispatcher: Watchlist-Vergleich, doppelte Befehle ----------
const SPRACHE4 = { laufend: new Set() };
if (typeof skillAusfuehren === "function") {
  const original = skillAusfuehren;
  skillAusfuehren = async function (text) {
    const t = befehlNormalisieren(String(text || "")), offen = (typeof offeneAktion !== "undefined" && offeneAktion) || (typeof slDialogPasst === "function" && slDialogPasst(text));
    const sperre = SKILLS.find((s) => s.name === "gesperrt");
    if (!offen && WL_VERGLEICH.test(t) && !(sperre && sperre.passt(text))) { lokalAntworten(watchlistVergleichText()); return "watchlist-vergleich"; }
    // ab 11-12e: „Wie steht meine Watchlist?“ (Beispiel des Aktienüberblicks) fing der Aktien-Dispatcher ab („Für welches Symbol?“)
    if (!offen && WL_UEBERBLICK.test(t) && !(sperre && sperre.passt(text))) { const s = SKILLS.find((x) => x.name === "ueberblick-aktien"); if (s) { await s.aktion(text); return s.name; } }
    if (t.length > 3 && SPRACHE4.laufend.has(t)) { lokalAntworten(`„${String(text).trim().slice(0, 60)}“ läuft noch – nicht doppelt ausgeführt.`); return "doppelt"; }
    SPRACHE4.laufend.add(t);
    try { return await original.apply(this, arguments); } finally { SPRACHE4.laufend.delete(t); }
  };
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("sprache4");
