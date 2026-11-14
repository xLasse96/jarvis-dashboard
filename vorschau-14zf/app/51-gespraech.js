// JARVIS Dashboard – Modul „gespraech“ (ab 11-10b). Intelligentere Gespräche über dem Dialog aus 09i:
//   - eindeutige Bezugnahmen: „Wie steht es damit?“, „Lösche sie“, „Hake sie ab“, „Analysiere sie“ beziehen sich auf das zuletzt
//     genannte Projekt / die zuletzt angelegte Aufgabe / die zuletzt genannte Aktie – nur wenn eindeutig, sonst Rückfrage;
//     der aufgelöste Satz läuft durch den normalen Dispatcher (Freigaben und Rückfragen unverändert)
//   - verständliche Rückfragen bei unvollständigen Befehlen („Neue Aufgabe“, „Lösche“, „Suche Datei“ ohne Inhalt) statt KI-Anfrage
//   - Themenübersicht des Gesprächs (Abschnitte nach Themenwechsel), „Anders formulieren“ (eigene, sichtbare Nachricht an die KI)
//   - mehrteilige Fragen: auf Wunsch die Bitte um nummerierte Antworten (Einstellung, Standard aus – die Frage bleibt sonst unverändert)
// Speicher: nur die Einstellung „teilfragen“ in „jarvis-dialog“ (09i). Bezugnahmen nur im Arbeitsspeicher dieser Sitzung.
const GESPRAECH = { bezug: { projekt: null, aufgabe: null, aktie: null, notiz: null, zeit: 0 }, gueltigMs: 10 * 60000 };
function gesprBezugMerken(text) {
  const t = String(text || "").replace(/^\s*(hey\s+)?jarvis[\s,]+/i, "").trim();
  let m;
  const jetzt = Date.now(), b = GESPRAECH.bezug;
  if ((m = /projekt(?:status)?\s+([^?!.]+?)\s*[?!.]*$/i.exec(t)) && !/^(zeige?|meine)\b/i.test(t)) { b.projekt = m[1].replace(/\s+an$/i, "").trim(); b.zeit = jetzt; }
  if ((m = /^(?:neue aufgabe|aufgabe anlegen)\s*[:,]?\s+(.+?)(?:\s+(?:für das|für|fürs|im|zum)\s+projekt\s+(.+))?\s*[.!]?$/i.exec(t))) {
    const z = typeof zeitangabeErkennen === "function" ? zeitangabeErkennen(m[1]) : null;
    b.aufgabe = (z && z.datum ? z.rest : m[1]).trim(); if (m[2]) b.projekt = m[2].trim(); b.zeit = jetzt;
  }
  if ((m = /^(?:neue notiz|notiz)\s*[:,]?\s+(.+)$/i.exec(t))) { b.notiz = m[1].trim(); b.zeit = jetzt; }
  if ((m = /\b(?:analysiere|analyse|aktie|kennzahlen von|wie steht)\s+([A-Z]{1,5})\b/.exec(t))) { b.aktie = m[1]; b.zeit = jetzt; }
}
// Bezug auflösen: { text } (aufgelöster Befehl) | { frage } (nicht eindeutig) | null (kein Bezugssatz)
function gesprBezugAufloesen(text) {
  const t = befehlNormalisieren(String(text || "")), b = GESPRAECH.bezug, frisch = Date.now() - b.zeit < GESPRAECH.gueltigMs;
  const muster = [
    [/^(und )?(wie steht es (damit|darum|mit dem projekt)|wie ist der stand( dazu)?|und der stand( dazu)?|was ist der nächste schritt( dort| da)?)$/, "projekt", (x) => `Wie steht Projekt ${x}?`],
    [/^(lösche|loesche|entferne) (sie|es|die|diese aufgabe|die aufgabe)( wieder)?$/, "aufgabe", (x) => `Lösche Aufgabe ${x}`],
    [/^(hake (sie|es|die) ab|erledige (sie|es)|(sie|die) ist erledigt|das ist erledigt|erledigt)$/, "aufgabe", (x) => `Aufgabe ${x} erledigt`],
    [/^(analysiere (sie|die aktie|die)( nochmal)?|und die kennzahlen( dazu)?)$/, "aktie", (x) => `Analysiere ${x}`],
  ];
  for (const [re, art, bau] of muster) {
    if (!re.test(t)) continue;
    if (!frisch || !b[art]) return { frage: { projekt: "Welches Projekt meinst du? Sag z. B. „Wie steht Projekt Umzug?“", aufgabe: "Welche Aufgabe meinst du? Bitte mit Namen, z. B. „Lösche Aufgabe Arzt anrufen“.", aktie: "Welche Aktie meinst du? Bitte mit Symbol, z. B. „Analysiere AAPL“." }[art] + " Es wurde nichts ausgeführt." };
    return { text: bau(b[art]), art };
  }
  return null;
}
// Unvollständige Befehle: verständliche Rückfrage, nichts geht an die KI
const GESPR_UNVOLLSTAENDIG = [
  [/^(neue aufgabe|aufgabe anlegen|erinnere mich( daran)?)$/, "Welche Aufgabe soll ich anlegen? Zum Beispiel „Neue Aufgabe Arzt anrufen morgen um 9“."],
  [/^(neue notiz|notiz|notiere( dir)?)$/, "Was soll in die Notiz? Zum Beispiel „Neue Notiz Einkaufsliste Milch und Brot“."],
  [/^(neues projekt|lege (ein )?projekt an)$/, "Wie soll das Projekt heißen? Zum Beispiel „Neues Projekt Umzug“."],
  [/^(lösche|loesche|entferne)( die)?( aufgabe| notiz)?$/, "Was soll ich löschen? Bitte mit Namen, z. B. „Lösche Aufgabe Arzt anrufen“ – gelöscht wird erst nach deiner Bestätigung."],
  [/^(suche|finde)( die| eine)? datei$/, "Wonach soll ich in deinen Dateien suchen? Zum Beispiel „Suche Datei Steuer“."],
  [/^(rechne|berechne)$/, "Was soll ich rechnen? Zum Beispiel „Rechne 12 * (3 + 4)“."],
  [/^(analysiere|analyse)( die aktie)?$/, "Welche Aktie? Bitte mit Symbol, z. B. „Analysiere AAPL“."],
  [/^(merke? dir|merk dir)( was| etwas)?$/, "Was soll ich mir merken? Zum Beispiel „Merke dir, dass ich kurze Antworten mag“ (gespeichert erst nach deiner Bestätigung)."],
  [/^(starte|start)( die)? routine$/, "Welche Routine? Zum Beispiel „Starte Routine Morgenübersicht“."],
];
function gesprUnvollstaendig(text) { const t = befehlNormalisieren(String(text || "")); for (const [re, frage] of GESPR_UNVOLLSTAENDIG) if (re.test(t)) return frage; return null; }
if (typeof skillAusfuehren === "function") {
  const original = skillAusfuehren;
  skillAusfuehren = async function (text) {
    const offen = (typeof offeneAktion !== "undefined" && offeneAktion) || (typeof paperOffen !== "undefined" && paperOffen) || (typeof slDialogPasst === "function" && slDialogPasst(text));
    if (!offen) {
      const u = gesprUnvollstaendig(text);
      if (u) { lokalAntworten(u); return "rueckfrage"; }
      const b = gesprBezugAufloesen(text);
      if (b && b.frage) { lokalAntworten(b.frage); return "rueckfrage"; }
      if (b && b.text) { lokalAntworten("Bezogen auf: „" + b.text + "“"); const r = await original(b.text); gesprBezugMerken(b.text); return r; }
    }
    const r = await original(text);
    if (r) gesprBezugMerken(text);
    return r;
  };
}
// ---------- Themen und „Anders formulieren“ ----------
function gespraechThemen() {
  const fragen = verlauf.filter((m) => m.role === "user").map((m) => m.content.replace(/^\[Hinweis zum Antwortstil:[^\]]*\]\n/, ""));
  const themen = [];
  fragen.forEach((f, i) => {
    const vorige = fragen.slice(Math.max(0, i - 2), i);
    if (!themen.length || (typeof dialogThemenwechsel === "function" && dialogThemenwechsel(f, vorige))) themen.push({ titel: f.slice(0, 80), fragen: 1 });
    else themen[themen.length - 1].fragen++;
  });
  return themen;
}
function gespraechAnders() {
  if (!verlauf.some((m) => m.role === "assistant")) return false;
  jarvisAntwort("Bitte formuliere deine letzte Antwort anders: einfacher, mit anderen Worten, gleiche Aussage.");
  return true;
}
// mehrteilige Fragen: nur auf Wunsch (Einstellung) die Bitte um nummerierte Antworten
function gesprTeilfragen(text) { return (String(text).match(/\?/g) || []).length; }
function gesprTeilfragenAn() { const d = speicherJsonLesen("jarvis-dialog", (x) => istObjekt(x) && x.art === "jarvis-dialog"); return Boolean(d && d.teilfragen); }
if (typeof chatAuszug === "function") {
  const original = chatAuszug;
  chatAuszug = function (liste) {
    const a = original(liste), i = a.length - 1;
    if (!gesprTeilfragenAn() || i < 0 || a[i].role !== "user") return a;
    const n = gesprTeilfragen(a[i].content);
    if (n < 2) return a;
    const neu = `[Die Nachricht enthält ${n} Fragen – bitte nummeriert und vollständig beantworten.]\n` + a[i].content;
    return neu.length > CHAT_GRENZEN.nachricht ? a : a.map((m, j) => (j === i ? { role: m.role, content: neu } : m));
  };
}
if (typeof dialogSetzen === "function") {
  // „teilfragen“ zusätzlich speichern, ohne die Felder aus 09i zu verlieren
  const original = dialogSetzen;
  dialogSetzen = function (aenderung) {
    const teil = "teilfragen" in aenderung ? Boolean(aenderung.teilfragen) : gesprTeilfragenAn();
    const { teilfragen: _x, ...rest } = aenderung;
    const ok = original(rest);
    if (!ok) return false;
    try { const d = JSON.parse(localStorage.getItem("jarvis-dialog")); d.teilfragen = teil; localStorage.setItem("jarvis-dialog", JSON.stringify(d)); } catch (e) { return false; }
    return true;
  };
}
function gespraechAnzeigen() {
  const el = (id) => document.getElementById(id);
  if (!el("gespr-themen")) return;
  const t = gespraechThemen();
  el("gespr-themen").replaceChildren(...(t.length ? t.map((x, i) => Object.assign(document.createElement("li"), { textContent: `Thema ${i + 1}: ${x.titel}${x.fragen > 1 ? ` (+${x.fragen - 1} Folgefrage(n))` : ""}` })) : [Object.assign(document.createElement("li"), { textContent: "Noch kein Gespräch mit der KI." })]));
  el("gespr-teilfragen").checked = gesprTeilfragenAn();
  const b = GESPRAECH.bezug;
  el("gespr-bezug").textContent = "Worauf sich „sie“, „es“, „damit“ gerade beziehen: " + ([b.projekt && `Projekt „${b.projekt}“`, b.aufgabe && `Aufgabe „${b.aufgabe}“`, b.aktie && `Aktie ${b.aktie}`].filter(Boolean).join(", ") || "nichts") + " (nur diese Sitzung, 10 Minuten).";
}
if (typeof dialogAnzeigen === "function") { const original = dialogAnzeigen; dialogAnzeigen = function () { original(); gespraechAnzeigen(); }; }
(function gespraechEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("gespr-themen")) return;
  el("gespr-anders").addEventListener("click", () => { el("dialog-meldung").textContent = gespraechAnders() ? "Bitte um andere Formulierung gesendet (als sichtbare Nachricht)." : "Noch keine Antwort zum Umformulieren."; });
  el("gespr-teilfragen").addEventListener("change", () => { el("dialog-meldung").textContent = dialogSetzen({ teilfragen: el("gespr-teilfragen").checked }) ? "Gespeichert." : "Nicht gespeichert: " + SPEICHER_SCHADEN_TEXT; });
  gespraechAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("gespraech");
