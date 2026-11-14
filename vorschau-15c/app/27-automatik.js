// JARVIS Dashboard – Modul „automatik“ (ab 11-07f). Lokaler, regelbasierter Planer für PERSÖNLICHE Automatisierungen.
// Strikt getrennt vom Handel: erlaubte Aktionen sind nur „Hinweis im Chat“, „Tagesübersicht“ und „Routine starten“ – Routinen
// bestehen ihrerseits nur aus Abfragen und leicht rückgängig zu machenden Schritten (routinenSchrittPruefen; keine Paper-Orders,
// nichts Bestätigungspflichtiges, nichts Gesperrtes). Dieses Modul ruft weder den Worker noch Order-, Paper- oder Not-Aus-Funktionen.
// Läuft nur, solange diese Seite geöffnet ist (Zeitgeber im Browser, kein Hintergrunddienst; Browser drosseln Hintergrund-Tabs).
// Sicherheitsregeln:
//   - Modus je Regel: „simulation“ (nur protokollieren), „freigabe“ (Rückfrage im Chat, erst „Ja“ führt aus), „automatisch“.
//   - Globaler Stopp hält alle Regeln an; Pause je Regel.
//   - Jede Ausführung hat eine eindeutige Kennung „Regel@Zeitfenster“ und läuft je Fenster höchstens einmal – auch über mehrere Tabs
//     (vor der Ausführung frisch gelesen und als „läuft“ beansprucht; Web Locks, wenn der Browser sie hat).
//   - Fehler: höchstens 3 Versuche je Fenster. Schleifenschutz: je Regel höchstens 6, insgesamt höchstens 20 Ausführungen pro Stunde.
//   - Nach dem Neuladen: ein als „läuft“ markierter Lauf gilt als unterbrochen und wird nicht wiederholt; Zeitpunkte, zu denen die Seite
//     zu war, werden als „verpasst“ protokolliert und nicht nachgeholt.
// Speicher: localStorage „jarvis-automatik“ { art, version, stopp, regeln, protokoll }; beschädigt → gemeldet, nie überschrieben, nichts läuft.
const AUTO = { schluessel: "jarvis-automatik", maxRegeln: 20, maxProtokoll: 100, maxVersuche: 3, proRegelStunde: 6, gesamtStunde: 20, fensterMs: 10 * 60000, taktMs: 20000 };
const AUTO_AKTIONEN = { hinweis: "Hinweis im Chat", tagesuebersicht: "Tagesübersicht aktualisieren", routine: "Routine starten" };
const AUTO_MODI = { simulation: "Simulation (nur protokollieren)", freigabe: "mit Freigabe (Rückfrage)", automatisch: "automatisch" };
const AUTO_TAGE = { taeglich: "täglich", werktags: "werktags", wochenende: "am Wochenende" };
const AUTO_EREIGNISSE = { start: "beim Öffnen der Seite (einmal am Tag)", ueberfaellig: "wenn Aufgaben überfällig sind (einmal am Tag)" };
const AUTO_SEITE = { start: Date.now() };
let autoStand = { art: "jarvis-automatik", version: 1, stopp: false, regeln: [], protokoll: [] };

function autoLesen() {
  const d = speicherJsonLesen(AUTO.schluessel, (x) => istObjekt(x) && x.art === "jarvis-automatik" && Array.isArray(x.regeln) && Array.isArray(x.protokoll));
  autoStand = d ? { art: "jarvis-automatik", version: 1, stopp: Boolean(d.stopp), regeln: d.regeln.filter((r) => r && typeof r.id === "string"), protokoll: d.protokoll.filter((p) => p && typeof p.id === "string").slice(-AUTO.maxProtokoll) }
    : { art: "jarvis-automatik", version: 1, stopp: false, regeln: [], protokoll: [] };
  return autoStand;
}
function autoSpeichern() {
  if (speicherBeschaedigt(AUTO.schluessel)) return false;
  try { localStorage.setItem(AUTO.schluessel, JSON.stringify(autoStand)); return true; } catch (e) { return false; }
}
const autoTag = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

// Prüfung einer Regel: Liste von Fehlern (leer = gültig). Nur Aktionen aus AUTO_AKTIONEN – alles andere (z. B. Orders) wird abgelehnt.
function autoRegelPruefen(r) {
  const f = [];
  if (!r || typeof r !== "object") return ["keine Regel"];
  if (!String(r.name || "").trim() || String(r.name).length > 60) f.push("Name fehlt oder ist zu lang (höchstens 60 Zeichen).");
  const a = r.ausloeser || {};
  if (a.art === "zeit") {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(a.uhrzeit || ""))) f.push("Uhrzeit ungültig (HH:MM).");
    if (!AUTO_TAGE[a.tage]) f.push("Tage ungültig.");
  } else if (a.art === "ereignis") { if (!AUTO_EREIGNISSE[a.ereignis]) f.push("Ereignis unbekannt."); }
  else f.push("Auslöser fehlt.");
  const x = r.aktion || {};
  if (!AUTO_AKTIONEN[x.art]) f.push("Aktion nicht erlaubt – möglich sind nur: " + Object.values(AUTO_AKTIONEN).join(", ") + ".");
  if (x.art === "hinweis" && (!String(x.text || "").trim() || String(x.text).length > 200)) f.push("Hinweistext fehlt oder ist zu lang (höchstens 200 Zeichen).");
  if (x.art === "routine" && typeof x.routineId !== "string") f.push("Routine fehlt.");
  if (!AUTO_MODI[r.modus]) f.push("Modus ungültig.");
  return f;
}
// Routine zur Ausführungszeit erneut prüfen (sie kann inzwischen geändert, gelöscht oder unzulässig sein)
function autoRoutinePruefen(id) {
  const routine = typeof routinen !== "undefined" ? routinen.find((r) => r.id === id) : null;
  if (!routine) return { fehler: "Routine nicht (mehr) vorhanden" };
  if (routine.pausiert) return { fehler: "Routine ist pausiert" };
  const p = routine.schritte.map(routinenSchrittPruefen).findIndex((x) => x.fehler);
  if (p >= 0) return { fehler: "Schritt " + (p + 1) + " ist nicht erlaubt" };
  return { routine };
}

// Fälliges Zeitfenster einer Regel oder null. { slot, verpasst } – verpasst: Zeitpunkt lag vor dem Öffnen der Seite bzw. ist zu alt.
function autoFaellig(r, jetzt, seitenStart = AUTO_SEITE.start) {
  const a = r.ausloeser, tag = autoTag(jetzt);
  if (a.art === "ereignis") {
    if (a.ereignis === "start") return { slot: tag + " start" };
    if (a.ereignis === "ueberfaellig") {
      const ueber = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((x) => !x.erledigt && x.faellig && new Date(x.faellig).getTime() <= jetzt) : [];
      return ueber.length ? { slot: tag + " ueberfaellig", anzahl: ueber.length } : null;
    }
    return null;
  }
  const wt = new Date(jetzt).getDay();
  if ((a.tage === "werktags" && (wt === 0 || wt === 6)) || (a.tage === "wochenende" && wt !== 0 && wt !== 6)) return null;
  const [h, m] = a.uhrzeit.split(":").map(Number);
  const zeit = new Date(jetzt); zeit.setHours(h, m, 0, 0);
  if (zeit.getTime() > jetzt) return null;
  return { slot: tag + " " + a.uhrzeit, verpasst: zeit.getTime() < seitenStart || jetzt - zeit.getTime() > AUTO.fensterMs };
}
// Nächste geplante Zeitpunkte (Vorschau), höchstens n
function autoVorschau(jetzt = Date.now(), n = 5) {
  const liste = [];
  for (const r of autoStand.regeln) {
    if (r.pausiert || autoRegelPruefen(r).length || r.ausloeser.art !== "zeit") continue;
    for (let i = 0; i < 8; i++) {
      const d = new Date(jetzt); d.setDate(d.getDate() + i);
      const [h, m] = r.ausloeser.uhrzeit.split(":").map(Number); d.setHours(h, m, 0, 0);
      const wt = d.getDay();
      if (d.getTime() <= jetzt || (r.ausloeser.tage === "werktags" && (wt === 0 || wt === 6)) || (r.ausloeser.tage === "wochenende" && wt !== 0 && wt !== 6)) continue;
      liste.push({ zeit: d.getTime(), regel: r.name, aktion: AUTO_AKTIONEN[r.aktion.art], modus: r.modus });
      break;
    }
  }
  return liste.sort((a, b) => a.zeit - b.zeit).slice(0, n);
}
function autoProtokoll(eintrag) {
  autoStand.protokoll.push({ zeit: new Date().toISOString(), ...eintrag });
  autoStand.protokoll = autoStand.protokoll.slice(-AUTO.maxProtokoll);
}
const autoBeschreibung = (r) => r.aktion.art === "hinweis" ? "Hinweis „" + r.aktion.text + "“" : r.aktion.art === "routine" ? "Routine „" + ((typeof routinen !== "undefined" && (routinen.find((x) => x.id === r.aktion.routineId) || {}).name) || "?") + "“ starten" : "Tagesübersicht aktualisieren";

// Führt die Aktion aus; Rückgabe { ok, text }
async function autoAktion(r) {
  if (r.aktion.art === "hinweis") { lokalAntworten("Automatisierung „" + r.name + "“: " + r.aktion.text); return { ok: true, text: "Hinweis gezeigt" }; }
  if (r.aktion.art === "tagesuebersicht") { if (typeof heuteZeigen !== "function") return { ok: false, text: "Tagesübersicht nicht verfügbar" }; heuteZeigen(); return { ok: true, text: "Tagesübersicht aktualisiert" }; }
  const p = autoRoutinePruefen(r.aktion.routineId);
  if (p.fehler) return { ok: false, text: p.fehler };
  if (typeof routineLauf !== "undefined" && routineLauf && routineLauf.laeuft) return { ok: false, text: "eine andere Routine läuft gerade" };
  if (!routineVorschau(p.routine.id)) return { ok: false, text: "Routine konnte nicht vorbereitet werden" };
  const e = await routineAusfuehren(0);
  return e && e.ok ? { ok: true, text: "Routine „" + p.routine.name + "“ abgeschlossen" } : { ok: false, text: "Routine „" + p.routine.name + "“ nicht vollständig gelaufen" };
}
// Ein Prüfdurchlauf. Liefert die Kennungen der in diesem Durchlauf behandelten Ausführungen.
async function autoPruefenOhneSperre(jetzt = Date.now()) {
  autoLesen(); // frisch: ein anderer Tab kann inzwischen beansprucht oder gestoppt haben
  if (speicherBeschaedigt(AUTO.schluessel) || autoStand.stopp) return [];
  const behandelt = [];
  const stunde = jetzt - 3600000, ausgefuehrt = autoStand.protokoll.filter((p) => p.ausgefuehrt && Date.parse(p.zeit) > stunde);
  for (const r of autoStand.regeln) {
    // ungültige Regel (z. B. von Hand geändert): bleibt gespeichert, läuft aber nie
    if (r.pausiert || autoRegelPruefen(r).length) continue;
    const f = autoFaellig(r, jetzt);
    if (!f) continue;
    const id = r.id + "@" + f.slot, z = r.zustand || {};
    if (z.slot === f.slot && (z.status !== "fehler" || (z.versuche || 0) >= AUTO.maxVersuche)) continue;
    // ab 11-13p: zusätzlich das Protokoll – nach dem Zurückstellen der Uhr zeigte zustand.slot auf ein späteres Fenster, und dasselbe
    // Fenster lief mit derselben Kennung erneut (reproduziert, Test „Automatik 13p“). Fehlversuche zählen bis maxVersuche weiter.
    // Grenze: das Protokoll hält die letzten maxProtokoll Einträge.
    if (z.slot !== f.slot) { const frueher = autoStand.protokoll.filter((p) => p.id === id); if (frueher.some((p) => p.ergebnis !== "fehler") || frueher.length >= AUTO.maxVersuche) continue; }
    if (f.verpasst) {
      r.zustand = { slot: f.slot, status: "verpasst", versuche: 0 };
      autoProtokoll({ id, regel: r.name, modus: r.modus, ergebnis: "verpasst", text: "Zeitpunkt lag, während die Seite geschlossen war – nicht nachgeholt" });
      behandelt.push(id);
      continue;
    }
    if (ausgefuehrt.filter((p) => p.regelId === r.id).length >= AUTO.proRegelStunde || ausgefuehrt.length >= AUTO.gesamtStunde) {
      r.zustand = { slot: f.slot, status: "fehler", versuche: AUTO.maxVersuche };
      autoProtokoll({ id, regel: r.name, modus: r.modus, ergebnis: "gesperrt", text: "Schleifenschutz: zu viele Ausführungen in der letzten Stunde" });
      behandelt.push(id);
      continue;
    }
    if (r.modus === "simulation") {
      r.zustand = { slot: f.slot, status: "simuliert", versuche: 0 };
      autoProtokoll({ id, regelId: r.id, regel: r.name, modus: r.modus, ergebnis: "simuliert", text: "würde ausführen: " + autoBeschreibung(r) });
      behandelt.push(id);
      continue;
    }
    if (r.modus === "freigabe") {
      // Nie eine offene Rückfrage des Nutzers verdrängen – dann im nächsten Durchlauf erneut
      if ((typeof offeneAktion !== "undefined" && offeneAktion) || (typeof paperOffen !== "undefined" && paperOffen)) continue;
      r.zustand = { slot: f.slot, status: "wartet", versuche: z.slot === f.slot ? z.versuche || 0 : 0 };
      autoProtokoll({ id, regelId: r.id, regel: r.name, modus: r.modus, ergebnis: "wartet auf Freigabe", text: autoBeschreibung(r) });
      autoSpeichern();
      const regelId = r.id, slot = f.slot;
      bestaetigungAnfordern({ name: "automatik" }, { beschreibung: "Automatisierung „" + r.name + "“: " + autoBeschreibung(r) + ".", ausfuehren: async () => autoNachFreigabe(regelId, slot) });
      behandelt.push(id);
      continue;
    }
    // automatisch: erst beanspruchen und speichern, dann ausführen
    const versuche = (z.slot === f.slot ? z.versuche || 0 : 0) + 1;
    r.zustand = { slot: f.slot, status: "laeuft", versuche };
    if (!autoSpeichern()) { autoProtokoll({ id, regel: r.name, modus: r.modus, ergebnis: "fehler", text: "nicht gespeichert – ohne gesicherte Kennung wird nichts ausgeführt" }); continue; }
    let e;
    try { e = await autoAktion(r); } catch (err) { e = { ok: false, text: err.message }; }
    const regel = autoStand.regeln.find((x) => x.id === r.id) || r;
    regel.zustand = { slot: f.slot, status: e.ok ? "ok" : "fehler", versuche };
    autoProtokoll({ id, regelId: r.id, regel: r.name, modus: r.modus, ergebnis: e.ok ? "ausgeführt" : "fehler", ausgefuehrt: true, text: e.text + (e.ok ? "" : " (Versuch " + versuche + " von " + AUTO.maxVersuche + ")") });
    behandelt.push(id);
  }
  autoSpeichern();
  autoAnzeigen();
  return behandelt;
}
async function autoNachFreigabe(regelId, slot) {
  autoLesen();
  const r = autoStand.regeln.find((x) => x.id === regelId);
  if (!r || autoStand.stopp || r.pausiert || !r.zustand || r.zustand.slot !== slot || r.zustand.status !== "wartet") return "Automatisierung nicht ausgeführt – inzwischen gestoppt, pausiert, geändert oder schon erledigt.";
  r.zustand.status = "laeuft"; autoSpeichern();
  let e;
  try { e = await autoAktion(r); } catch (err) { e = { ok: false, text: err.message }; }
  r.zustand = { slot, status: e.ok ? "ok" : "fehler", versuche: (r.zustand.versuche || 0) + 1 };
  autoProtokoll({ id: r.id + "@" + slot, regelId: r.id, regel: r.name, modus: r.modus, ergebnis: e.ok ? "ausgeführt" : "fehler", ausgefuehrt: true, text: e.text + " (nach Freigabe)" });
  autoSpeichern(); autoAnzeigen();
  return e.ok ? null : "Automatisierung „" + r.name + "“: " + e.text + ".";
}
let autoLaeuft = false, autoLaufZusage = null;
// Ein Durchlauf zur Zeit (auch über Tabs, wenn Web Locks verfügbar sind).
// ab 11-12a: Ein ausdrücklicher Aufruf wartet auf einen laufenden Durchlauf und läuft danach (vorher wurde er still mit [] verworfen –
// reproduziert, wenn der Minutentakt gerade prüfte). Nur der periodische Takt überspringt weiterhin ({ ueberspringen: true }).
// Doppelte Ausführung bleibt ausgeschlossen: jeder Durchlauf liest frisch, Kennung „Regel@Zeitfenster“ läuft höchstens einmal.
async function autoPruefen(jetzt = Date.now(), { ueberspringen = false } = {}) {
  if (autoLaufZusage && ueberspringen) return [];
  while (autoLaufZusage) { try { await autoLaufZusage; } catch (e) { /* Fehler des anderen Durchlaufs betreffen diesen nicht */ } }
  autoLaeuft = true;
  const eigene = (async () => {
    if (navigator.locks && typeof navigator.locks.request === "function") return navigator.locks.request("jarvis-automatik", () => autoPruefenOhneSperre(jetzt));
    return autoPruefenOhneSperre(jetzt);
  })();
  autoLaufZusage = eigene;
  try { return await eigene; } finally { if (autoLaufZusage === eigene) { autoLaufZusage = null; autoLaeuft = false; } }
}
// Nach dem Neuladen: „läuft“ ist ein unterbrochener Lauf – protokollieren, nicht wiederholen
function autoNachNeustart() {
  autoLesen();
  if (speicherBeschaedigt(AUTO.schluessel)) return 0;
  let n = 0;
  for (const r of autoStand.regeln) {
    if (r.zustand && (r.zustand.status === "laeuft" || r.zustand.status === "wartet")) {
      autoProtokoll({ id: r.id + "@" + r.zustand.slot, regel: r.name, modus: r.modus, ergebnis: "unterbrochen", text: r.zustand.status === "laeuft" ? "Seite wurde während der Ausführung geschlossen – nicht wiederholt" : "Freigabe kam nicht mehr – nicht ausgeführt" });
      r.zustand = { ...r.zustand, status: "unterbrochen", versuche: AUTO.maxVersuche };
      n++;
    }
  }
  if (n) autoSpeichern();
  return n;
}

// ---------- Verwaltung ----------
function autoRegelAnlegen(daten) {
  autoLesen();
  if (speicherBeschaedigt(AUTO.schluessel)) return { fehler: SPEICHER_SCHADEN_TEXT };
  const r = { id: "auto" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: String(daten.name || "").trim(), ausloeser: daten.ausloeser, aktion: daten.aktion, modus: daten.modus || "simulation", pausiert: false, erstellt: new Date().toISOString() };
  const f = autoRegelPruefen(r);
  if (r.aktion && r.aktion.art === "routine" && !f.length) { const p = autoRoutinePruefen(r.aktion.routineId); if (p.fehler) f.push(p.fehler + "."); }
  if (autoStand.regeln.length >= AUTO.maxRegeln) f.push("Höchstens " + AUTO.maxRegeln + " Regeln.");
  if (f.length) return { fehler: f.join(" ") };
  // Ein Zeitpunkt, der heute schon vorbei ist, gilt nicht als verpasst: die Regel beginnt beim nächsten Termin
  const heute = r.ausloeser.art === "zeit" ? autoFaellig(r, Date.now()) : null;
  if (heute) r.zustand = { slot: heute.slot, status: "vor-anlage", versuche: 0 };
  autoStand.regeln.push(r);
  return autoSpeichern() ? { regel: r } : { regel: r, warnung: "Nicht gespeichert – gilt nur bis zum Neuladen." };
}
function autoRegelAendern(id, aenderung) {
  autoLesen();
  const r = autoStand.regeln.find((x) => x.id === id);
  if (!r || speicherBeschaedigt(AUTO.schluessel)) return false;
  if ("pausiert" in aenderung) r.pausiert = Boolean(aenderung.pausiert);
  if ("modus" in aenderung && AUTO_MODI[aenderung.modus]) r.modus = aenderung.modus;
  autoSpeichern(); autoAnzeigen();
  return true;
}
function autoRegelLoeschen(id) {
  autoLesen();
  if (speicherBeschaedigt(AUTO.schluessel)) return false;
  const vorher = autoStand.regeln.length;
  autoStand.regeln = autoStand.regeln.filter((x) => x.id !== id);
  autoSpeichern(); autoAnzeigen();
  return autoStand.regeln.length < vorher;
}
// Globaler Stopp: hält alles an und verwirft eine offene Freigabe-Rückfrage einer Automatisierung
function autoStoppSetzen(stopp) {
  autoLesen();
  if (speicherBeschaedigt(AUTO.schluessel)) return false;
  autoStand.stopp = Boolean(stopp);
  if (autoStand.stopp && typeof offeneAktion !== "undefined" && offeneAktion && offeneAktion.skill === "automatik") offeneAktionAbbrechen();
  autoProtokoll({ id: "stopp@" + Date.now(), regel: "–", modus: "–", ergebnis: autoStand.stopp ? "gestoppt" : "fortgesetzt", text: autoStand.stopp ? "Alle Automatisierungen angehalten" : "Automatisierungen laufen wieder" });
  autoSpeichern(); autoAnzeigen();
  return true;
}

// ---------- Anzeige ----------
function autoAnzeigen() {
  const el = (id) => document.getElementById(id);
  if (!el("auto-liste")) return;
  const kaputt = speicherBeschaedigt(AUTO.schluessel);
  el("auto-status").textContent = kaputt ? "⚠ Gespeicherte Automatisierungen beschädigt – es läuft nichts. " + SPEICHER_SCHADEN_TEXT
    : autoStand.stopp ? "⛔ GESTOPPT – keine Automatisierung läuft." : `● aktiv · ${autoStand.regeln.filter((r) => !r.pausiert && !autoRegelPruefen(r).length).length} von ${autoStand.regeln.length} Regel(n) aktiv · nur solange diese Seite geöffnet ist (kein Hintergrunddienst)`;
  el("auto-stopp").textContent = autoStand.stopp ? "Automatisierungen fortsetzen" : "Alle Automatisierungen stoppen";
  el("auto-stopp").setAttribute("aria-pressed", String(autoStand.stopp));
  el("auto-stopp").disabled = kaputt;
  const routSel = el("auto-routine"), gew = routSel.value;
  const rl = typeof routinen !== "undefined" ? routinen : [];
  routSel.replaceChildren(...(rl.length ? rl.map((r) => Object.assign(document.createElement("option"), { value: r.id, textContent: r.name })) : [Object.assign(document.createElement("option"), { value: "", textContent: "keine Routine vorhanden" })]));
  if ([...routSel.options].some((o) => o.value === gew)) routSel.value = gew;
  el("auto-liste").replaceChildren(...(autoStand.regeln.length ? autoStand.regeln.map((r) => {
    const li = document.createElement("li");
    li.dataset.id = r.id;
    li.classList.toggle("erledigt", Boolean(r.pausiert));
    const fehler = autoRegelPruefen(r);
    if (fehler.length) { li.append(Object.assign(document.createElement("span"), { className: "aufgabe-text wz-wichtig", textContent: "⚠ Ungültige Regel „" + String(r.name || r.id) + "“ – läuft nicht: " + fehler.join(" ") })); return li; }
    const a = r.ausloeser;
    const wann = a.art === "zeit" ? `${AUTO_TAGE[a.tage]} um ${a.uhrzeit}` : AUTO_EREIGNISSE[a.ereignis];
    li.append(Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: `${r.name}: ${wann} → ${autoBeschreibung(r)}` }),
      Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: AUTO_MODI[r.modus] + (r.pausiert ? " · pausiert" : "") + (r.zustand && r.zustand.status && r.zustand.status !== "vor-anlage" ? ` · zuletzt: ${r.zustand.status} (${r.zustand.slot})` : "") }));
    const knopf = (t, f) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: t }); b.setAttribute("aria-label", t + ": " + r.name); b.addEventListener("click", f); return b; };
    li.append(knopf(r.pausiert ? "Fortsetzen" : "Pausieren", () => autoRegelAendern(r.id, { pausiert: !r.pausiert })),
      knopf("Löschen", () => { if (confirm("Automatisierung löschen?\n\n" + r.name)) autoRegelLoeschen(r.id); }));
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "Keine Automatisierungen. Neue Regeln starten im Modus „Simulation“." })]));
  const v = autoVorschau();
  el("auto-vorschau").replaceChildren(...(v.length ? v : [null]).map((x) => Object.assign(document.createElement("li"), { textContent: x ? new Date(x.zeit).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " – " + x.regel + ": " + x.aktion + " (" + AUTO_MODI[x.modus] + ")" : "Keine geplanten Zeitpunkte." })));
  el("auto-protokoll").replaceChildren(...(autoStand.protokoll.length ? autoStand.protokoll.slice(-10).reverse() : [null]).map((p) => Object.assign(document.createElement("li"), { textContent: p ? new Date(p.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + " · " + p.regel + " · " + p.ergebnis + " – " + p.text + " [" + p.id + "]" : "Noch keine Einträge." })));
}
(function autoEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("auto-form")) return;
  const art = () => el("auto-ausloeser").value, aktion = () => el("auto-aktion").value;
  const sichtbar = () => {
    el("auto-zeit-felder").hidden = art() !== "zeit"; el("auto-ereignis-feld").hidden = art() !== "ereignis";
    el("auto-text-feld").hidden = aktion() !== "hinweis"; el("auto-routine-feld").hidden = aktion() !== "routine";
  };
  el("auto-ausloeser").addEventListener("change", sichtbar);
  el("auto-aktion").addEventListener("change", sichtbar);
  el("auto-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const r = autoRegelAnlegen({
      name: el("auto-name").value,
      ausloeser: art() === "zeit" ? { art: "zeit", uhrzeit: el("auto-uhrzeit").value, tage: el("auto-tage").value } : { art: "ereignis", ereignis: el("auto-ereignis").value },
      aktion: aktion() === "hinweis" ? { art: "hinweis", text: el("auto-text").value.trim() } : aktion() === "routine" ? { art: "routine", routineId: el("auto-routine").value } : { art: aktion() },
      modus: el("auto-modus").value,
    });
    el("auto-meldung").textContent = r.fehler ? "Nicht angelegt: " + r.fehler : "Angelegt: „" + r.regel.name + "“ (" + AUTO_MODI[r.regel.modus] + ")." + (r.warnung ? " " + r.warnung : "");
    if (!r.fehler) { el("auto-form").reset(); sichtbar(); }
    autoAnzeigen();
  });
  el("auto-stopp").addEventListener("click", () => autoStoppSetzen(!autoStand.stopp));
  sichtbar();
  autoNachNeustart();
  autoAnzeigen();
  setInterval(() => { autoPruefen(Date.now(), { ueberspringen: true }); }, AUTO.taktMs);
  setTimeout(() => { autoPruefen(); }, 1500);
  window.addEventListener("storage", (e) => { if (e.key === AUTO.schluessel) { autoLesen(); autoAnzeigen(); } });
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("automatik");
