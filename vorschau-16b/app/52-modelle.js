// JARVIS Dashboard – Modul „modelle“ (ab 11-10c). KI-Modellanbindung über einen Adapter, ohne den Worker zu ändern:
//   - Anbieterübersicht mit Status, Fähigkeiten und Kosten; nicht verbundene Anbieter klar gekennzeichnet (kein Schlüssel im Dashboard)
//   - lokaler Mock-Anbieter (Testmodus, kostenlos, kein Netz) inkl. simulierter Fehler (Zeitlimit, Serverfehler, leere/zu lange Antwort)
//   - Antwortvalidierung (Zeichenkette, Länge, keine Steuerzeichen)
//   - strukturierte Aktionsvorschläge: Zeilen „AKTION: <Befehl>“ in einer Antwort werden nie ausgeführt, sondern mit Vorschau
//     (Trockenlauf) angezeigt; „Übernehmen“ nur für Abfragen und leichte Aktionen, und auch dann über den normalen Dispatcher
//   - Übertragungsvorschau und Datenschutzprüfung: Vor dem Senden sieht man auf Wunsch genau, was an die KI geht; enthält die Anfrage
//     E-Mail, Telefonnummer, IBAN oder Kartennummer bzw. sensible Profilangaben, wird immer gefragt (Ablehnen → nichts gesendet)
//   - Kostenhinweis: grobe Größe der Anfrage (Zeichen / ≈ Tokens)
// Speicher „jarvis-modell“ { art, version, anbieter, mockFehler, vorschau, aktionen }.
const MODELL = { schluessel: "jarvis-modell", maxAntwort: 20000, grossZeichen: 20000, vorschlaege: [] };
const MODELL_ANBIETER = {
  worker: { name: "Claude über deinen eigenen Worker", art: "verbunden über Worker", faehigkeiten: ["Chat", "Recherche mit Websuche", "Bildanalyse", "Vorlesen (Google-Stimme)"], kosten: "über dein Anthropic-Konto beim Worker" },
  mock: { name: "Lokaler Test-Anbieter (Mock)", art: "lokal, ohne Netz", faehigkeiten: ["Chat (feste Testantworten)", "simulierte Fehler"], kosten: "kostenlos" },
};
const MODELL_NICHT_VERBUNDEN = ["OpenAI", "Google Gemini", "lokales Modell (Ollama)"];
const MODELL_MOCK_FEHLER = { "": "keiner", zeitlimit: "Zeitlimit", server: "Serverfehler", leer: "leere Antwort", lang: "zu lange Antwort", steuer: "Steuerzeichen" };
function modellLesen() {
  const d = speicherJsonLesen(MODELL.schluessel, (x) => istObjekt(x) && x.art === "jarvis-modell");
  return { anbieter: d && MODELL_ANBIETER[d.anbieter] ? d.anbieter : "worker", mockFehler: d && MODELL_MOCK_FEHLER[d.mockFehler] !== undefined ? d.mockFehler : "", vorschau: Boolean(d && d.vorschau), aktionen: Boolean(d && d.aktionen) };
}
function modellSetzen(aenderung) {
  if (speicherBeschaedigt(MODELL.schluessel)) return false;
  const s = { ...modellLesen(), ...aenderung };
  if (!MODELL_ANBIETER[s.anbieter] || MODELL_MOCK_FEHLER[s.mockFehler] === undefined) return false;
  try { localStorage.setItem(MODELL.schluessel, JSON.stringify({ art: "jarvis-modell", version: 1, ...s })); } catch (e) { return false; }
  modellAnzeigen();
  return true;
}
function modellStatus() {
  const s = modellLesen();
  if (s.anbieter === "mock") return "Testmodus: Antworten kommen vom lokalen Mock-Anbieter (keine KI, kein Netz, kostenlos)" + (s.mockFehler ? ` · simulierter Fehler: ${MODELL_MOCK_FEHLER[s.mockFehler]}` : "");
  return typeof verbunden === "function" && verbunden() ? "Worker eingerichtet – Antworten von Claude über deinen Worker (kostenpflichtig über dein Konto)" : "kein Worker eingerichtet – nur lokale Befehle und Offline-Antworten";
}
// ---------- Mock-Anbieter ----------
function modellMockAntwort(messages) {
  const s = modellLesen(), letzte = (messages[messages.length - 1] || {}).content || "";
  if (s.mockFehler === "zeitlimit") { throw new Error("Zeitüberschreitung (simuliert)"); } // ohne Netzwerk-Kennung: die Statuszeile des echten Workers bleibt unberührt
  if (s.mockFehler === "server") throw new Error("Serverfehler 500 (simuliert)");
  if (s.mockFehler === "leer") return { antwort: "", modell: "mock" };
  if (s.mockFehler === "lang") return { antwort: "x".repeat(MODELL.maxAntwort + 1), modell: "mock" };
  if (s.mockFehler === "steuer") return { antwort: "Antwort mit Steuerzeichen\u0007", modell: "mock" };
  const frage = letzte.split("\n").pop().slice(0, 120);
  return { antwort: `[Mock-Antwort, keine KI] Du hast gefragt: „${frage}“. ${messages.length > 1 ? `Kontext: ${messages.length - 1} frühere Nachricht(en).` : "Kein früherer Kontext."}`, modell: "mock" };
}
// Antwortvalidierung: Fehlertext oder ""
function modellAntwortPruefen(antwort) {
  if (typeof antwort !== "string") return "keine Textantwort";
  if (!antwort.trim()) return "leere Antwort";
  if (antwort.length > MODELL.maxAntwort) return `Antwort zu lang (${antwort.length.toLocaleString("de-DE")} Zeichen, höchstens ${MODELL.maxAntwort.toLocaleString("de-DE")})`;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(antwort)) return "Antwort enthält Steuerzeichen";
  return "";
}
if (typeof workerAnfrage === "function") {
  const original = workerAnfrage;
  workerAnfrage = async function (pfad, optionen = {}, versuch) {
    if (pfad === "/chat") {
      let daten;
      if (modellLesen().anbieter === "mock") daten = modellMockAntwort(JSON.parse(optionen.body || "{}").messages || []);
      else daten = await original(pfad, optionen, versuch);
      if (daten && "antwort" in daten) { const f = modellAntwortPruefen(daten.antwort); if (f) throw new Error("Ungültige Antwort des Modells: " + f + " – nicht angezeigt."); }
      return daten;
    }
    return original(pfad, optionen, versuch);
  };
}
// ---------- Datenschutzprüfung und Übertragungsvorschau ----------
const MODELL_PERSOENLICH = [["E-Mail-Adresse", /[\w.+-]+@[\w-]+\.[\w.]{2,}/], ["IBAN", /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/], ["Telefonnummer", /(?:\+49|\b0)\d{2,5}[ /-]?\d{3,}[ -]?\d{0,6}\b/], ["Kartennummer", /\b(?:\d{4}[ -]?){3}\d{4}\b/]];
function modellDatenschutz(messages) {
  const text = messages.map((m) => m.content).join("\n"), funde = MODELL_PERSOENLICH.filter(([, re]) => re.test(text)).map(([n]) => n);
  const sensibel = typeof profil !== "undefined" && typeof profilAuswahl !== "undefined" ? profil.filter((e) => profilAuswahl.has(e.id) && e.sensibel).map((e) => "Profil „" + e.titel + "“ (sensibel)") : [];
  return [...funde, ...sensibel];
}
function modellVorschauText(messages, funde) {
  const zeichen = messages.reduce((n, m) => n + m.content.length, 0);
  return `An die KI gehen ${messages.length} Nachricht(en), ${zeichen.toLocaleString("de-DE")} Zeichen (≈ ${Math.ceil(zeichen / 4).toLocaleString("de-DE")} Tokens)` + (zeichen > MODELL.grossZeichen ? " – große Anfrage, entsprechend höhere Kosten" : "") + ".\n"
    + (funde.length ? "⚠ Enthält persönliche Daten: " + funde.join(", ") + ".\n" : "")
    + "Letzte Nachricht:\n" + (messages[messages.length - 1] || {}).content.slice(0, 600) + "\n\nSenden?";
}
if (typeof kiKontextFuerVersand === "function") {
  const original = kiKontextFuerVersand;
  kiKontextFuerVersand = function (nachrichten) {
    const r = original(nachrichten), s = modellLesen();
    if (s.anbieter === "mock") return r; // bleibt lokal
    const funde = modellDatenschutz(r);
    if (funde.length || s.vorschau) {
      MODELL.letzteVorschau = modellVorschauText(r, funde);
      if (!window.confirm(MODELL.letzteVorschau)) { const e = new Error("Nicht gesendet – Übertragung abgelehnt."); e.abgebrochen = true; throw e; }
    }
    return r;
  };
}
// Hinweis für die KI (nur wenn „Aktionsvorschläge“ eingeschaltet): Vorschläge als Zeile „AKTION: …“
if (typeof chatAuszug === "function") {
  const original = chatAuszug;
  chatAuszug = function (liste) {
    const a = original(liste), i = a.length - 1;
    if (!modellLesen().aktionen || i < 0 || a[i].role !== "user") return a;
    const neu = "[Wenn eine JARVIS-Aktion hilft, schlage sie zusätzlich als eigene Zeile „AKTION: <Befehl>“ vor (z. B. „AKTION: Neue Aufgabe Arzt anrufen“). Sie wird nicht automatisch ausgeführt.]\n" + a[i].content;
    return neu.length > CHAT_GRENZEN.nachricht ? a : a.map((m, j) => (j === i ? { role: m.role, content: neu } : m));
  };
}
// ---------- Aktionsvorschläge (nie automatisch) ----------
function modellVorschlaege(antwort) {
  return [...String(antwort || "").matchAll(/^\s*AKTION:\s*(.{2,200})$/gim)].slice(0, 5).map((m) => {
    const befehl = m[1].trim(), v = typeof werkzeugTrockenlauf === "function" ? werkzeugTrockenlauf(befehl) : { code: "UNBEKANNT", text: "" };
    const order = typeof haertungOrderWort === "function" && haertungOrderWort(befehl); // wie B-09q-1: Kaufbefehle nie übernehmen
    const erlaubt = v.code === "OK" && !v.auftrag && !order && ["lesen", "ändern"].includes(v.art);
    return { befehl, vorschau: v.text, art: v.art || "unbekannt", erlaubt, grund: erlaubt ? "" : order ? "Orders nie – auch nicht als Vorschlag" : v.code !== "OK" ? "kein bekannter lokaler Befehl" : v.auftrag ? "mehrteilig – bitte selbst als Auftrag eingeben" : "braucht eine eigene Bestätigung oder ist gesperrt – bitte selbst sagen" };
  });
}
async function modellVorschlagUebernehmen(i) {
  const v = MODELL.vorschlaege[i];
  if (!v || !v.erlaubt || v.erledigt) return false;
  v.erledigt = true;
  lokalAntworten("Übernehme den KI-Vorschlag auf deinen Klick: „" + v.befehl + "“");
  await skillAusfuehren(v.befehl);
  modellAnzeigen();
  return true;
}
if (typeof dialogKennzeichnen === "function") {
  const original = dialogKennzeichnen;
  dialogKennzeichnen = function (element, antwort, recherche) {
    const m = original(element, antwort, recherche), v = modellVorschlaege(antwort);
    if (v.length) { MODELL.vorschlaege = v; element.dataset.vorschlaege = String(v.length); modellAnzeigen(); }
    return m;
  };
}
// ---------- Anzeige ----------
function modellAnzeigen() {
  const el = (id) => document.getElementById(id);
  if (!el("modell-status")) return;
  const s = modellLesen();
  el("modell-anbieter").value = s.anbieter; el("modell-mockfehler").value = s.mockFehler; el("modell-vorschau").checked = s.vorschau; el("modell-aktionen").checked = s.aktionen;
  el("modell-mockfehler").disabled = s.anbieter !== "mock";
  el("modell-status").textContent = modellStatus();
  el("modell-liste").replaceChildren(...Object.entries(MODELL_ANBIETER).map(([k, a]) => Object.assign(document.createElement("li"), { textContent: `${a.name} (${a.art}${k === s.anbieter ? ", aktiv" : ""}): ${a.faehigkeiten.join(", ")} · Kosten: ${a.kosten}` })),
    ...MODELL_NICHT_VERBUNDEN.map((n) => Object.assign(document.createElement("li"), { className: "aus", textContent: `${n}: nicht verbunden (nur Entwurf, siehe docs/MODELLANBIETER_10.md – Schlüssel gehören nie ins Dashboard)` })));
  el("modell-vorschlaege").replaceChildren(...(MODELL.vorschlaege.length ? MODELL.vorschlaege.map((v, i) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: `Vorschlag: „${v.befehl}“ → ${v.vorschau || "–"}${v.grund ? " · " + v.grund : ""}` }));
    if (v.erlaubt) { const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: v.erledigt ? "übernommen" : "Übernehmen", disabled: Boolean(v.erledigt) }); b.setAttribute("aria-label", "KI-Vorschlag übernehmen: " + v.befehl); b.addEventListener("click", () => modellVorschlagUebernehmen(i)); li.append(b); }
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "Keine Aktionsvorschläge in der letzten Antwort." })]));
}
(function modellEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("modell-anbieter")) return;
  el("modell-anbieter").replaceChildren(...Object.entries(MODELL_ANBIETER).map(([k, a]) => Object.assign(document.createElement("option"), { value: k, textContent: a.name })));
  el("modell-mockfehler").replaceChildren(...Object.entries(MODELL_MOCK_FEHLER).map(([k, t]) => Object.assign(document.createElement("option"), { value: k, textContent: "Simulierter Fehler: " + t })));
  const speichern = (x) => { el("modell-meldung").textContent = modellSetzen(x) ? "Gespeichert." : "Nicht gespeichert: " + SPEICHER_SCHADEN_TEXT; };
  el("modell-anbieter").addEventListener("change", () => speichern({ anbieter: el("modell-anbieter").value }));
  el("modell-mockfehler").addEventListener("change", () => speichern({ mockFehler: el("modell-mockfehler").value }));
  el("modell-vorschau").addEventListener("change", () => speichern({ vorschau: el("modell-vorschau").checked }));
  el("modell-aktionen").addEventListener("change", () => speichern({ aktionen: el("modell-aktionen").checked }));
  modellAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("modelle");
