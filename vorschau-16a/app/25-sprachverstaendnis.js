// JARVIS Dashboard – Modul „sprachverstaendnis“ (ab 11-07c). Ergänzt den vorhandenen Skill-Dispatcher (app/03-trading-skills.js),
// ändert aber keine Freigabe und keine Rückfrage:
//   - Zeitangaben für Aufgaben: „morgen um 9“, „übermorgen“, „in drei Tagen“, „in 20 Minuten“, „am Freitag“, „am 24.12.“, „um halb zehn“.
//     Nie raten: vergangene, ungültige oder doppelte Angaben → Rückfrage, es wird nichts angelegt. Nur Tag genannt → 9:00 Uhr, sichtbar gesagt.
//   - Navigation per Sprache („Gehe zu Notizen“, „Öffne Daten auf diesem Gerät“) über das Zielverzeichnis aus 11-07b (navZiele).
//     Mehrere passende Ziele → Rückfrage mit Auswahl, nichts wird geöffnet. Befehle (z. B. Not-Aus) sind nie Sprachziele.
//   - Befehlsverlauf: ↑/↓ im Eingabefeld holt frühere Eingaben dieser Sitzung zurück (nur im Arbeitsspeicher, nie gespeichert;
//     „Verlauf löschen“ leert ihn mit).
//   - Unbekannter Befehl ohne KI-Verbindung: „Meinten Sie …?“ aus den Beispielen der Skills – wird nur vorgeschlagen, nie ausgeführt.
// Keine Anfrage, kein Speicher.

// ---------- Zeitangaben ----------
const ZEIT = { standardStunde: 9, tageszeit: { frueh: 8, morgens: 8, vormittags: 10, mittags: 12, nachmittags: 15, abends: 18, nachts: 22 } };
const ZAHL_KLEIN = { null: 0, ein: 1, eins: 1, eine: 1, einer: 1, einem: 1, einen: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, "fünf": 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, "zwölf": 12,
  dreizehn: 13, vierzehn: 14, "fünfzehn": 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, "dreißig": 30, vierzig: 40, "fünfzig": 50 };
const WOCHENTAGE = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
// Ziffern (bis 3 Stellen) oder Zahlwort bis 59 („einundzwanzig“); sonst null
function zahlAusWort(w) {
  const s = String(w || "").toLowerCase().replace(/ue/g, "ü").replace(/oe/g, "ö").replace(/dreissig/g, "dreißig");
  if (/^\d{1,3}$/.test(s)) return Number(s);
  if (Object.prototype.hasOwnProperty.call(ZAHL_KLEIN, s)) return ZAHL_KLEIN[s];
  const m = s.match(/^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(zwanzig|dreißig|vierzig|fünfzig)$/);
  return m ? ZAHL_KLEIN[m[1]] + ZAHL_KLEIN[m[2]] : null;
}
const ZG = "(?<![a-zäöüß0-9])", ZE = "(?![a-zäöüß0-9])", ZW = "(\\d{1,3}|[a-zäöüß]+)";
// Minuten nach „Uhr“ nur als Zahl(wort) – sonst würde aus „um 9 Uhr Arzt anrufen“ die Minute „Arzt“
const ZW_MINUTE = "(\\d{1,2}|(?:ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun)und(?:zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig)|zehn|elf|zwölf|zwoelf|dreizehn|vierzehn|fünfzehn|fuenfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig|fünf|fuenf|zwei|drei|vier|sechs|sieben|acht|neun)";
const ZEIT_MUSTER = {
  // „heute Morgen“ ist eine Tageszeit, kein zweiter Tag
  tageszeit: new RegExp(`${ZG}(?:(?:am|in der)\\s+(morgen|vormittag|mittag|nachmittag|abend|nacht)|(früh|frueh|morgens|vormittags|mittags|nachmittags|abends|nachts))${ZE}|(?<=heute\\s+)(morgen|abend|nacht)${ZE}`, "g"),
  tag: new RegExp(`${ZG}(?:(?:bis|für|fuer|ab)\\s+)?(heute|übermorgen|uebermorgen|morgen)${ZE}`, "g"),
  inSpanne: new RegExp(`${ZG}in\\s+${ZW}\\s+(minute|minuten|stunde|stunden|tag|tagen|woche|wochen)${ZE}`, "g"),
  wochentag: new RegExp(`${ZG}(?:(?:bis|am|für|fuer|ab)\\s+)?(?:(nächsten|naechsten|kommenden)\\s+)?(${WOCHENTAGE.join("|")})${ZE}`, "g"),
  datum: new RegExp(`${ZG}(?:(?:bis|am|für|fuer|zum|ab)\\s+)?(?:dem\\s+)?(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})?(?![0-9])`, "g"),
  uhr: new RegExp(`${ZG}(?:um|gegen|ab)\\s+(?:(halb)\\s+)?${ZW}(?:[:.](\\d{2}))?(?:\\s+uhr(?:\\s+${ZW_MINUTE}(?![a-zäöüß0-9]))?)?${ZE}`, "g"),
};
const TAGESZEIT_WORT = { morgen: "morgens", vormittag: "vormittags", mittag: "mittags", nachmittag: "nachmittags", abend: "abends", nacht: "nachts", "früh": "frueh", frueh: "frueh" };
const zweistellig = (n) => String(n).padStart(2, "0");
function zeitText(d) { return WOCHENTAGE[d.getDay()].replace(/^./, (c) => c.toUpperCase()) + ", " + zweistellig(d.getDate()) + "." + zweistellig(d.getMonth() + 1) + "." + d.getFullYear() + " " + zweistellig(d.getHours()) + ":" + zweistellig(d.getMinutes()) + " Uhr"; }
// Ergebnis: { datum: Date|null, rest, beschreibung, annahme, rueckfrage }. rest = Text ohne die erkannte Zeitangabe.
function zeitangabeErkennen(text, jetzt = new Date()) {
  const original = String(text || ""), t = original.toLowerCase();
  const spannen = [], funde = { tageszeit: [], tag: [], inSpanne: [], wochentag: [], datum: [], uhr: [] };
  for (const art of Object.keys(ZEIT_MUSTER)) {
    for (const m of t.matchAll(ZEIT_MUSTER[art])) {
      // bereits von einer anderen Angabe belegt (z. B. „am Morgen“ ist Tageszeit, nicht „morgen“)
      if (spannen.some(([a, b]) => m.index < b && m.index + m[0].length > a)) continue;
      // „in drei Tagen“ nur mit gültiger Zahl, „um …“ nur mit Zahl – sonst kein Fund (z. B. „um Rat fragen“)
      if (art === "inSpanne" && zahlAusWort(m[1]) === null) continue;
      if (art === "uhr" && zahlAusWort(m[2]) === null) continue;
      funde[art].push(m);
      spannen.push([m.index, m.index + m[0].length]);
    }
  }
  const leer = { datum: null, rest: original.trim(), beschreibung: "", annahme: "", rueckfrage: null };
  const tagQuellen = funde.tag.length + funde.wochentag.length + funde.datum.length + funde.inSpanne.filter((m) => /^(tag|woche)/.test(m[2])).length;
  const relKurz = funde.inSpanne.filter((m) => /^(minute|stunde)/.test(m[2]));
  if (!tagQuellen && !relKurz.length && !funde.uhr.length && !funde.tageszeit.length) return leer;
  const frage = (grund) => ({ ...leer, rueckfrage: grund + " Es wurde nichts angelegt." });
  if (tagQuellen > 1 || funde.uhr.length > 1 || funde.tageszeit.length > 1 || relKurz.length > 1) return frage("Mehrere Zeitangaben erkannt – bitte nur eine nennen (z. B. „morgen um 9“).");
  if (relKurz.length && (tagQuellen || funde.uhr.length)) return frage("„in … Minuten/Stunden“ zusammen mit einem Tag oder einer Uhrzeit ist nicht eindeutig.");
  let datum = null, annahme = "";
  if (relKurz.length) {
    const n = zahlAusWort(relKurz[0][1]);
    if (!(n > 0) || n > 72) return frage("Die Zeitspanne „" + relKurz[0][0] + "“ ist nicht plausibel (1 bis 72).");
    datum = new Date(jetzt.getTime() + n * (/^minute/.test(relKurz[0][2]) ? 60000 : 3600000));
    datum.setSeconds(0, 0);
  } else {
    // Tag bestimmen
    const tag = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
    if (funde.tag.length) {
      const w = funde.tag[0][1];
      tag.setDate(tag.getDate() + (w === "heute" ? 0 : w === "morgen" ? 1 : 2));
    } else if (funde.wochentag.length) {
      const ziel = WOCHENTAGE.indexOf(funde.wochentag[0][2]);
      let diff = (ziel - jetzt.getDay() + 7) % 7;
      if (diff === 0 && !funde.wochentag[0][1]) return frage("Heute ist " + funde.wochentag[0][2].replace(/^./, (c) => c.toUpperCase()) + " – meinen Sie heute oder in einer Woche? Bitte „heute“ oder „nächsten " + funde.wochentag[0][2].replace(/^./, (c) => c.toUpperCase()) + "“ sagen.");
      if (diff === 0) diff = 7;
      tag.setDate(tag.getDate() + diff);
    } else if (funde.datum.length) {
      const [, d, m, j] = funde.datum[0];
      const jahr = j ? Number(j) : jetzt.getFullYear();
      const probe = new Date(jahr, Number(m) - 1, Number(d));
      if (probe.getDate() !== Number(d) || probe.getMonth() !== Number(m) - 1) return frage("„" + funde.datum[0][0].trim() + "“ ist kein gültiges Datum.");
      tag.setTime(probe.getTime());
    } else if (funde.inSpanne.length) {
      const n = zahlAusWort(funde.inSpanne[0][1]);
      if (!(n > 0) || n > 366) return frage("Die Zeitspanne „" + funde.inSpanne[0][0] + "“ ist nicht plausibel.");
      tag.setDate(tag.getDate() + n * (/^woche/.test(funde.inSpanne[0][2]) ? 7 : 1));
    }
    // Uhrzeit bestimmen
    const tzWort = funde.tageszeit.length ? funde.tageszeit[0][1] || funde.tageszeit[0][3] || funde.tageszeit[0][2] : null;
    const tz = tzWort ? TAGESZEIT_WORT[tzWort] || tzWort : null;
    let stunde = null, minute = 0;
    if (funde.uhr.length) {
      const [ganz, halb, h, mZiffer, mWort] = funde.uhr[0];
      stunde = zahlAusWort(h);
      minute = mZiffer !== undefined ? Number(mZiffer) : mWort !== undefined ? zahlAusWort(mWort) : 0;
      if (halb) { if (minute) return frage("„" + ganz.trim() + "“ ist keine gültige Uhrzeit."); stunde -= 1; minute = 30; }
      if (stunde === null || minute === null || stunde < 0 || stunde > 23 || minute < 0 || minute > 59) return frage("„" + ganz.trim() + "“ ist keine gültige Uhrzeit (0 bis 23 Uhr).");
      if (tz && ["nachmittags", "abends", "nachts"].includes(tz) && stunde >= 1 && stunde <= 11) stunde += 12;
    } else if (tz) {
      stunde = ZEIT.tageszeit[tz];
      annahme = "„" + funde.tageszeit[0][0].trim() + "“ als " + zweistellig(stunde) + ":00 Uhr verstanden";
    }
    const tagGenannt = tagQuellen > 0;
    if (stunde === null) { stunde = ZEIT.standardStunde; annahme = "keine Uhrzeit genannt – " + zweistellig(stunde) + ":00 Uhr angenommen"; }
    if (!tagGenannt && !funde.uhr.length && !funde.tageszeit.length) return leer;
    datum = new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), stunde, minute);
    if (datum.getTime() <= jetzt.getTime()) {
      return frage(zeitText(datum) + " liegt in der Vergangenheit" + (tagGenannt ? "" : " (ohne Tag gilt heute)") + " – bitte den Tag nennen, z. B. „morgen um " + stunde + "“.");
    }
  }
  // Text ohne Zeitangabe; übrig gebliebene Bindewörter an den Rändern entfernen
  let rest = original;
  for (const [a, b] of spannen.sort((x, y) => y[0] - x[0])) rest = rest.slice(0, a) + " " + rest.slice(b);
  rest = rest.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  const rand = /^(?:(?:an|am|um|bis|für|fuer|zum|zur|daran|dass|,)\s+|,\s*)+|(?:\s+(?:an|am|um|bis|für|fuer|zum)|\s*,)+$/i;
  for (let i = 0; i < 3; i++) rest = rest.replace(rand, "").trim();
  return { datum, rest, beschreibung: zeitText(datum), annahme, rueckfrage: null };
}

// ---------- Navigation per Sprache ----------
const NAV_SPRACH = /^(?:zeige?(?: mir)?|zeig mir|öffne|oeffne|geh(?:e)? zu(?:r|m)?|geh(?:e)? (?:in|auf) (?:die|den|das)|spring(?:e)? zu(?:r|m)?|wechsle zu(?:r|m)?|navigiere zu(?:r|m)?|bring(?:e)? mich zu(?:r|m)?)\s+(.+)$/;
const NAV_FUELL = new Set(["die", "den", "das", "der", "dem", "meine", "meinen", "mein", "karte", "bereich", "bitte", "mal", "an", "auf", "jetzt"]);
const navWorte = (s) => navFalten(s).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
// Ergebnis: { ziel } bei genau einem passenden Ziel, sonst { treffer: [...] } (leer = nicht zuständig) oder { einstellungen: true }
function navSprachZiel(wunsch) {
  const woerter = navWorte(wunsch).filter((w) => !NAV_FUELL.has(w));
  if (!woerter.length) return { treffer: [] };
  if (woerter.length === 1 && /^einstellung(en)?$/.test(woerter[0])) return { treffer: [], einstellungen: true };
  if (woerter.some((w) => w.length < 3)) return { treffer: [] };
  // Gleicher Name in derselben Ansicht (Karte und gleichnamige Einstellung, z. B. „Daten auf diesem Gerät“) ist ein Ziel – die Karte zuerst
  const gesehen = new Set();
  const kand = navZiele().filter((z) => z.art !== "Befehl").filter((z) => { const tw = navWorte(z.text); return woerter.every((w) => tw.some((x) => x.startsWith(w))); })
    .filter((z) => { const k = navWorte(z.text).join(" ") + "|" + z.ansicht; if (gesehen.has(k)) return false; gesehen.add(k); return true; });
  const genau = kand.filter((z) => navWorte(z.text).join(" ") === woerter.join(" "));
  if (genau.length === 1) return { ziel: genau[0], treffer: genau };
  if (kand.length === 1) return { ziel: kand[0], treffer: kand };
  return { treffer: genau.length > 1 ? genau : kand };
}
function navSprachWunsch(text) { const m = NAV_SPRACH.exec(befehlNormalisieren(text)); return m ? m[1] : null; }
skillRegistrieren({
  name: "navigation",
  risiko: "leicht",
  beschreibung: "Zu einer Karte oder Einstellung springen (rückgängig: zurück in den Bereich wechseln)",
  beispiele: ["Gehe zu Notizen", "Öffne Daten auf diesem Gerät", "Zeige die Einstellungen"],
  passt: (text) => { const w = navSprachWunsch(text); if (w === null) return false; const r = navSprachZiel(w); return Boolean(r.ziel || r.einstellungen || r.treffer.length); },
  aktion: async (text) => {
    const r = navSprachZiel(navSprachWunsch(text));
    if (r.einstellungen) {
      const namen = EINSTELLUNGEN_ZIELE.map((z) => z.text);
      lokalAntworten("Einstellungen: " + namen.map((n) => "„" + n + "“").join(", ") + ". Sagen Sie z. B. „Gehe zu " + namen[0] + "“. Die Liste steht auch unter „☰ NAVIGATION“.");
      return true;
    }
    if (!r.ziel) {
      const liste = r.treffer.slice(0, 5).map((z) => "„" + z.text + "“ (" + (z.art === "Bereich" ? "Bereich" : ANSICHT_NAMEN[z.ansicht] || z.art) + ")");
      lokalAntworten("Mehrere Ziele passen: " + liste.join(", ") + (r.treffer.length > 5 ? " …" : "") + ". Bitte genauer sagen, z. B. „Gehe zu " + r.treffer[0].text + "“. Es wurde nichts geöffnet.");
      return true;
    }
    const z = r.ziel;
    navAnspringen(z.id);
    lokalAntworten("„" + z.text + "“ geöffnet" + (z.art === "Bereich" ? "." : " (" + (z.art === "Einstellung" ? "Einstellung, " : "") + "Bereich " + ANSICHT_NAMEN[z.ansicht] + ")."));
    return true;
  },
});

// ---------- Befehlsverlauf (nur diese Sitzung) ----------
const BEFEHLSVERLAUF = { liste: [], max: 50, pos: null, entwurf: "" };
function befehlMerken(text) {
  const l = BEFEHLSVERLAUF.liste;
  if (text && l[l.length - 1] !== text) l.push(text);
  if (l.length > BEFEHLSVERLAUF.max) l.splice(0, l.length - BEFEHLSVERLAUF.max);
  BEFEHLSVERLAUF.pos = null;
}
function befehlsverlaufLoeschen() { BEFEHLSVERLAUF.liste.length = 0; BEFEHLSVERLAUF.pos = null; BEFEHLSVERLAUF.entwurf = ""; }
document.getElementById("befehl").addEventListener("keydown", (e) => {
  if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const v = BEFEHLSVERLAUF, feld = e.currentTarget;
  if (!v.liste.length) return;
  e.preventDefault();
  if (e.key === "ArrowUp") {
    if (v.pos === null) { v.entwurf = feld.value; v.pos = v.liste.length; }
    if (v.pos > 0) v.pos--;
    feld.value = v.liste[v.pos];
  } else {
    if (v.pos === null) return;
    v.pos++;
    if (v.pos >= v.liste.length) { feld.value = v.entwurf; v.pos = null; } else feld.value = v.liste[v.pos];
  }
});

// ---------- Unbekannte Befehle (ohne KI-Verbindung): Vorschläge ----------
const VORSCHLAG_STOPP = new Set(["bitte", "jarvis", "zeige", "mache", "machen", "meine", "meinen", "einen", "einer", "eine", "einmal", "jetzt", "heute", "dieser", "diese", "diesem"]);
function wortAbstand(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let vor = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const neu = [i];
    for (let j = 1; j <= b.length; j++) neu[j] = Math.min(vor[j] + 1, neu[j - 1] + 1, vor[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    vor = neu;
  }
  return vor[b.length];
}
const wortNah = (a, b) => a === b || (a.length >= 5 && wortAbstand(a, b) <= (a.length >= 8 ? 2 : 1));
// Höchstens zwei Beispielsätze von Skills, die mindestens ein inhaltliches Wort (ähnlich) teilen; Gesperrtes nie
function befehlVorschlaege(text) {
  const ein = navWorte(text).filter((w) => w.length >= 4 && !VORSCHLAG_STOPP.has(w));
  if (!ein.length) return [];
  const bewertet = [];
  for (const s of SKILLS) {
    if (s.name === "gesperrt" || skillRisiko(s) === "gesperrt") continue;
    for (const b of s.beispiele || []) {
      const bw = navWorte(b).filter((w) => w.length >= 4 && !VORSCHLAG_STOPP.has(w));
      const punkte = ein.filter((w) => bw.some((x) => wortNah(w, x))).length;
      if (punkte) bewertet.push({ b, punkte });
    }
  }
  return bewertet.sort((x, y) => y.punkte - x.punkte).map((x) => x.b).filter((b, i, a) => a.indexOf(b) === i).slice(0, 2);
}

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("sprachverstaendnis");
