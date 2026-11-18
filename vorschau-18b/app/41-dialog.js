// JARVIS Dashboard – Modul „dialog“ (ab 11-09i). Gesprächsführung rund um den vorhandenen KI-Chat (02-chat-ki.js), ohne ihn zu
// ersetzen:
//   - Antwortstil (normal / kurz / ausführlich / Stichpunkte) und ein Ehrlichkeitshinweis („Fakten und Annahmen trennen, Unsicherheit
//     sagen, nichts erfinden“) – beides geht nur in die Anfrage, wenn ausdrücklich gewählt (Standard: unveränderte Nachricht)
//   - Kontextübersicht (was mit der nächsten Frage an die KI geht) und „Kontext vergessen“ (Anzeige bleibt)
//   - Themenwechsel-Hinweis (nur Hinweis, nichts wird verworfen); Folgefragen bleiben im Kontext
//   - Gesprächsübersicht als Frage-Antwort-Paare und lokale Zusammenfassung (ohne KI), Export als Markdown
//   - Kennzeichnung in KI-Antworten: Unsicherheit, Annahmen, ungeprüfte Links (als Merkmal, der Antworttext bleibt unverändert)
//   - Letzte Antwort kopieren / vorlesen, letzte Frage bearbeiten, unterbrochene Frage erneut senden (nur auf Klick)
// Speicher „jarvis-dialog“ { art, version, stil, ehrlich } – nur Einstellungen, keine Gesprächsinhalte.
const DIALOG = { schluessel: "jarvis-dialog", unterbrochen: null, letzteFrage: null };
const DIALOG_STILE = {
  normal: { name: "normal", text: "" },
  kurz: { name: "kurz", text: "Antworte kurz: höchstens drei Sätze." },
  ausfuehrlich: { name: "ausführlich", text: "Antworte ausführlich und gegliedert, mit kurzen Zwischenüberschriften." },
  stichpunkte: { name: "Stichpunkte", text: "Antworte in knappen Stichpunkten." },
};
const DIALOG_EHRLICH = "Trenne Fakten und Annahmen (Annahmen mit „Annahme:“ beginnen), sag deutlich, wenn du unsicher bist, und erfinde keine Quellen, Links oder Erinnerungen an frühere Gespräche.";
function dialogLesen() {
  const d = speicherJsonLesen(DIALOG.schluessel, (x) => istObjekt(x) && x.art === "jarvis-dialog");
  return { stil: d && DIALOG_STILE[d.stil] ? d.stil : "normal", ehrlich: Boolean(d && d.ehrlich) };
}
function dialogSetzen(aenderung) {
  if (speicherBeschaedigt(DIALOG.schluessel)) return false;
  const s = { ...dialogLesen(), ...aenderung };
  if (!DIALOG_STILE[s.stil]) return false;
  try { localStorage.setItem(DIALOG.schluessel, JSON.stringify({ art: "jarvis-dialog", version: 1, stil: s.stil, ehrlich: Boolean(s.ehrlich) })); } catch (e) { return false; }
  dialogAnzeigen();
  return true;
}
// Zusatz für die nächste Anfrage (leer = Nachricht bleibt unverändert)
function dialogZusatz() {
  const s = dialogLesen();
  return [DIALOG_STILE[s.stil].text, s.ehrlich ? DIALOG_EHRLICH : ""].filter(Boolean).join(" ");
}
if (typeof chatAuszug === "function") {
  const original = chatAuszug;
  chatAuszug = function (liste) {
    const auszug = original(liste), zusatz = dialogZusatz();
    if (!zusatz || !auszug.length) return auszug;
    const i = auszug.length - 1;
    if (auszug[i].role !== "user") return auszug;
    const neu = "[Hinweis zum Antwortstil: " + zusatz + "]\n" + auszug[i].content;
    if (neu.length > CHAT_GRENZEN.nachricht) return auszug; // dann ohne Zusatz – die Frage selbst geht vor
    return auszug.map((m, j) => (j === i ? { role: m.role, content: neu } : m)); // neue Objekte – der Verlauf bleibt unverändert
  };
}
// ---------- Kontext ----------
function dialogKontext() {
  // Wie chatAuszug: höchstens MAX_VERLAUF Nachrichten samt der neuen Frage (Kürzungen an der Gesamtgrenze kommen ggf. hinzu)
  const frueher = verlauf.slice(-(MAX_VERLAUF - 1));
  const s = dialogLesen();
  return { nachrichten: frueher.length, zeichen: frueher.reduce((n, m) => n + m.content.length, 0), weggelassen: Math.max(0, verlauf.length - frueher.length), gesamt: verlauf.length,
    stil: DIALOG_STILE[s.stil].name, ehrlich: s.ehrlich, profil: window.profilIntern && typeof window.profilIntern.auswahl === "function" ? window.profilIntern.auswahl().length : 0 };
}
function dialogKontextVergessen() {
  const n = verlauf.length;
  verlauf.length = 0;
  if (typeof verlaufDauerhaft === "function" && verlaufDauerhaft() && typeof verlaufSichern === "function") verlaufSichern();
  nachrichtAnzeigen("JARVIS: — Gesprächskontext zurückgesetzt (" + n + " Nachrichten): Die nächste Frage geht ohne frühere Nachrichten an die KI. Die Anzeige bleibt erhalten. —", "jarvis hinweis-kontext");
  dialogHinweis("");
  dialogAnzeigen();
  return n;
}
// Themenwechsel: keine gemeinsamen Inhaltswörter mit den letzten zwei Fragen und kein Folgefragen-Merkmal → nur Hinweis
const DIALOG_FOLGE = /^(und|aber|also|warum|wieso|weshalb|was ist mit|was noch|noch|dazu|mehr|genauer|erkläre? das|das|es|dies|dieser|diese|dieses|der|die|den|dem|wie viel|wieviel|wann|ok|okay|danke|ja|nein)\b/i;
const dialogWoerter = (t) => new Set((String(t).toLowerCase().match(/[a-zäöüß0-9]{4,}/g) || []).filter((w) => typeof DOK_STOPP === "undefined" || !DOK_STOPP.has(w)));
function dialogThemenwechsel(neu, vorige) {
  const t = String(neu || "").trim();
  if (!vorige.length || DIALOG_FOLGE.test(t) || t.split(/\s+/).length < 4) return false;
  const a = dialogWoerter(t), b = new Set(vorige.flatMap((v) => [...dialogWoerter(v)]));
  return a.size > 0 && ![...a].some((w) => b.has(w) || [...b].some((x) => x.length >= 5 && w.length >= 5 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))));
}
function dialogHinweis(text) {
  const el = document.getElementById("dialog-hinweis");
  if (!el) return;
  el.replaceChildren();
  el.hidden = !text;
  if (!text) return;
  const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: "Kontext vergessen" });
  b.setAttribute("aria-label", "Neues Thema: Gesprächskontext vergessen");
  b.addEventListener("click", dialogKontextVergessen);
  el.append(document.createTextNode(text + " "), b);
}
// ---------- Kennzeichnung der KI-Antworten (nur Merkmale, Text unverändert) ----------
function dialogMerkmale(antwort) {
  const t = String(antwort || "");
  return { unsicher: /\b(vermutlich|wahrscheinlich|möglicherweise|moeglicherweise|vielleicht|schätzungsweise|unsicher|ich bin (mir )?nicht sicher|ohne gewähr|nicht genau)\b/i.test(t),
    annahmen: /(^|\n)\s*(annahme|vermutung)\s*:/i.test(t), links: /https?:\/\/\S+/i.test(t) };
}
function dialogKennzeichnen(element, antwort, recherche = false) {
  const m = dialogMerkmale(antwort);
  if (m.unsicher) element.dataset.unsicher = "1";
  if (m.annahmen) element.dataset.annahmen = "1";
  if (m.links && !recherche) element.dataset.linksUngeprueft = "1";
  const teile = [m.unsicher && "enthält Unsicherheit", m.annahmen && "enthält Annahmen", m.links && !recherche && "Links nicht geprüft (vom Modell, keine Quellenprüfung)"].filter(Boolean);
  if (teile.length) element.setAttribute("aria-description", teile.join("; "));
  return m;
}
// ---------- Gesprächsübersicht und Zusammenfassung (lokal) ----------
function dialogPaare() {
  const paare = [];
  for (let i = 0; i < verlauf.length; i++) if (verlauf[i].role === "user") paare.push({ frage: verlauf[i].content, antwort: verlauf[i + 1] && verlauf[i + 1].role === "assistant" ? verlauf[i + 1].content : null });
  return paare;
}
const dialogErsterSatz = (t, n = 140) => { const s = String(t || "").replace(/\s+/g, " ").trim(), m = /^.{20,}?[.!?](\s|$)/.exec(s); const x = m ? m[0].trim() : s; return x.length > n ? x.slice(0, n - 1) + "…" : x; };
function dialogZusammenfassung() {
  const p = dialogPaare();
  if (!p.length) return "Noch kein Gespräch mit der KI in dieser Sitzung (lokale Befehle zählen nicht).";
  return [`Gespräch mit ${p.length} Frage(n) – lokal zusammengestellt (erste Sätze, keine KI):`, ...p.map((x, i) => `${i + 1}. ${dialogErsterSatz(x.frage, 100)} → ${x.antwort ? dialogErsterSatz(x.antwort) : "(keine Antwort)"}`)].join("\n");
}
// ---------- Aktionen auf die letzte Antwort/Frage ----------
const dialogLetzte = (art) => { const n = document.querySelectorAll("#chatverlauf .nachricht." + art); for (let i = n.length - 1; i >= 0; i--) if (!n[i].classList.contains("denkt") && !n[i].classList.contains("hinweis-kontext")) return n[i]; return null; };
async function dialogKopieren() {
  const el = dialogLetzte("jarvis");
  if (!el) return "keine";
  const text = el.textContent.replace(/^JARVIS:\s*/, "");
  try { await navigator.clipboard.writeText(text); return "kopiert"; } catch (e) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return "markiert"; }
}
function dialogVorlesen() {
  const el = dialogLetzte("jarvis");
  if (!el || typeof lokalVorlesen !== "function") return false;
  lokalVorlesen(el.textContent.replace(/^JARVIS:\s*/, ""));
  return true;
}
function dialogFrageBearbeiten() {
  const el = dialogLetzte("nutzer"), feld = document.getElementById("befehl");
  if (!el || !feld) return false;
  feld.value = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
  feld.focus();
  return true;
}
// Wrapper um jarvisAntwort: Themenwechsel-Hinweis, Kennzeichnung, unterbrochene Frage merken
if (typeof jarvisAntwort === "function") {
  const original = jarvisAntwort;
  jarvisAntwort = async function (text) {
    const eingabe = document.getElementById("befehl");
    const befehl = String(typeof text === "string" ? text : eingabe ? eingabe.value : "").trim();
    const vorher = verlauf.length, vorigeFragen = verlauf.filter((m) => m.role === "user").slice(-2).map((m) => m.content);
    const r = await original(text);
    if (verlauf.length > vorher) { // ging an die KI und wurde beantwortet
      DIALOG.unterbrochen = null;
      const el = dialogLetzte("jarvis");
      if (el) dialogKennzeichnen(el, verlauf[verlauf.length - 1].content);
      dialogHinweis(dialogThemenwechsel(befehl, vorigeFragen) ? "Neues Thema? Der bisherige Gesprächskontext ging mit." : "");
    } else {
      const letzte = document.querySelector("#chatverlauf .nachricht:last-child");
      if (letzte && befehl && (letzte.classList.contains("fehler") || letzte.textContent.includes("Anfrage abgebrochen"))) DIALOG.unterbrochen = befehl;
    }
    dialogAnzeigen();
    return r;
  };
}
function dialogAnzeigen() {
  const el = (id) => document.getElementById(id);
  if (!el("dialog-kontext")) return;
  const s = dialogLesen(), k = dialogKontext();
  el("dialog-stil").value = s.stil;
  el("dialog-ehrlich").checked = s.ehrlich;
  el("dialog-kontext").textContent = `Nächste Frage an die KI mit ${k.nachrichten} früheren Nachrichten (${k.zeichen.toLocaleString("de-DE")} Zeichen)` + (k.weggelassen ? `, ${k.weggelassen} ältere fallen wegen der Grenze weg` : "")
    + ` · Stil: ${k.stil}${k.ehrlich ? " · mit Ehrlichkeitshinweis" : ""}` + (k.profil ? ` · ${k.profil} Profil-Eintrag(e) ausgewählt` : "") + (dialogZusatz() ? " · Der Stilhinweis wird der Frage vorangestellt." : " · Die Frage geht unverändert.");
  el("dialog-erneut").hidden = !DIALOG.unterbrochen;
  if (DIALOG.unterbrochen) el("dialog-erneut").textContent = "Unterbrochene Frage erneut senden: „" + DIALOG.unterbrochen.slice(0, 40) + (DIALOG.unterbrochen.length > 40 ? "…" : "") + "“";
  const ol = el("dialog-paare");
  ol.replaceChildren(...dialogPaare().map((p) => Object.assign(document.createElement("li"), { textContent: dialogErsterSatz(p.frage, 100) + " → " + (p.antwort ? dialogErsterSatz(p.antwort) : "(keine Antwort)") })));
}
(function dialogEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("dialog-details")) return;
  el("dialog-stil").replaceChildren(...Object.entries(DIALOG_STILE).map(([k, v]) => Object.assign(document.createElement("option"), { value: k, textContent: "Antwortstil: " + v.name })));
  el("dialog-stil").addEventListener("change", () => { el("dialog-meldung").textContent = dialogSetzen({ stil: el("dialog-stil").value }) ? "Antwortstil gespeichert." : "Nicht gespeichert: " + SPEICHER_SCHADEN_TEXT; });
  el("dialog-ehrlich").addEventListener("change", () => { el("dialog-meldung").textContent = dialogSetzen({ ehrlich: el("dialog-ehrlich").checked }) ? "Gespeichert." : "Nicht gespeichert: " + SPEICHER_SCHADEN_TEXT; });
  el("dialog-vergessen").addEventListener("click", () => { el("dialog-meldung").textContent = dialogKontextVergessen() + " Nachrichten aus dem KI-Kontext entfernt."; });
  el("dialog-zusammenfassen").addEventListener("click", () => { el("dialog-zusammenfassung").textContent = dialogZusammenfassung(); el("dialog-zusammenfassung").hidden = false; });
  el("dialog-export").addEventListener("click", () => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["# Gesprächszusammenfassung\n\n" + dialogZusammenfassung() + "\n"], { type: "text/markdown" })), download: "jarvis-gespraech-" + new Date().toISOString().slice(0, 10) + ".md" }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); el("dialog-meldung").textContent = "Zusammenfassung heruntergeladen."; });
  el("dialog-kopieren").addEventListener("click", async () => { const r = await dialogKopieren(); el("dialog-meldung").textContent = { kopiert: "Letzte Antwort kopiert.", markiert: "Zwischenablage nicht erlaubt – Antwort markiert, bitte Strg+C.", keine: "Noch keine Antwort." }[r]; });
  el("dialog-vorlesen").addEventListener("click", () => { el("dialog-meldung").textContent = dialogVorlesen() ? "Lese die letzte Antwort vor (Stopp: „Vorlesen stoppen“)." : "Noch keine Antwort."; });
  el("dialog-bearbeiten").addEventListener("click", () => { el("dialog-meldung").textContent = dialogFrageBearbeiten() ? "Letzte Frage ins Eingabefeld übernommen – ändern und senden." : "Noch keine Frage."; });
  el("dialog-erneut").addEventListener("click", () => { const t = DIALOG.unterbrochen; DIALOG.unterbrochen = null; dialogAnzeigen(); if (t) jarvisAntwort(t); });
  el("dialog-details").addEventListener("toggle", dialogAnzeigen);
  dialogAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("dialog");
