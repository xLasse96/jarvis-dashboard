// JARVIS Dashboard – Modul „automatik3“ (ab 11-10l). Automatisierungen 3.0 – ergänzt 27-automatik.js und 43-automatik-plus.js
// (Regelübersicht, Vorlagen, Ereignis- und Zeitauslöser, kombinierte Bedingungen, Priorität, Vorschau, Simulation, Freigabe,
// Historie, Kennungen, Doppelschutz, Pause, globaler Stopp, Fehlerübersicht, Versuchs-/Schleifengrenzen, Konflikte, Wiederaufnahme,
// nur erlaubte lokale Aktionen und Trennung vom Handel gibt es dort schon). Neu – verbindet die 10er-Bausteine:
//   - Ereignisse: „Vorschläge von JARVIS offen“ (10g), „in einem Projekt ist etwas blockiert“ (10h),
//     „Tagesabschluss: ab 18 Uhr sind heutige Aufgaben noch offen“ (10f) – je einmal am Tag
//   - Bedingung „nicht in der Ruhezeit“ (nutzt die Ruhezeit der Vorschläge, Standard 22–7 Uhr)
//   - Vorlagen dazu (wie alle Vorlagen im Modus „Simulation“)
// Die Aktionen bleiben die erlaubten lokalen (Hinweis, Tagesübersicht, Routine) – nichts Neues wird ausführbar.
Object.assign(AUTO_EREIGNISSE, {
  "vorschlaege-offen": "wenn Vorschläge von JARVIS offen sind (einmal am Tag)",
  "projekt-blockiert": "wenn in einem Projekt etwas blockiert ist (einmal am Tag)",
  tagesabschluss: "zum Tagesabschluss ab 18 Uhr, wenn heutige Aufgaben offen sind (einmal am Tag)",
});
AUTO_BEDINGUNGEN["nicht-ruhezeit"] = "nicht in der Ruhezeit (wie bei den Vorschlägen)";
Object.assign(AUTO_VORLAGEN, {
  vorschlaege: { name: "Offene Vorschläge melden", ausloeser: { art: "ereignis", ereignis: "vorschlaege-offen" }, aktion: { art: "hinweis", text: "Es gibt Vorschläge von JARVIS – siehe „Vorschläge von JARVIS“." }, bedingungen: [{ art: "nicht-ruhezeit" }] },
  blockiert: { name: "Blockiertes melden", ausloeser: { art: "ereignis", ereignis: "projekt-blockiert" }, aktion: { art: "hinweis", text: "In einem Projekt wartet etwas – „Was ist blockiert?“ fragen." } },
  abschluss: { name: "Tagesabschluss erinnern", ausloeser: { art: "ereignis", ereignis: "tagesabschluss" }, aktion: { art: "hinweis", text: "Heute ist noch etwas offen – Tagesabschluss in der Tagesplanung?" }, bedingungen: [{ art: "nicht-ruhezeit" }] },
});
const AUTO3_EREIGNISSE = ["vorschlaege-offen", "projekt-blockiert", "tagesabschluss"];
function auto3Ereignis(ereignis, jetzt = Date.now()) {
  const tag = autoTag(jetzt);
  if (ereignis === "vorschlaege-offen") return WF_BEDINGUNGEN && WF_BEDINGUNGEN["vorschläge offen"] && WF_BEDINGUNGEN["vorschläge offen"].pruefe() ? { slot: tag + " vorschlaege-offen" } : null;
  if (ereignis === "projekt-blockiert") { const n = typeof projekteBlockiert === "function" ? projekteBlockiert().length : 0; return n ? { slot: tag + " projekt-blockiert", anzahl: n } : null; }
  if (ereignis === "tagesabschluss") {
    if (new Date(jetzt).getHours() < 18) return null;
    const n = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => !a.erledigt && a.faellig && autoTag(new Date(a.faellig).getTime()) === tag).length : 0;
    return n ? { slot: tag + " tagesabschluss", anzahl: n } : null;
  }
  return null;
}
if (typeof autoFaellig === "function") {
  const original = autoFaellig;
  autoFaellig = function (r, jetzt, seitenStart) {
    const a = r.ausloeser || {};
    if (a.art !== "ereignis" || !AUTO3_EREIGNISSE.includes(a.ereignis)) return original(r, jetzt, seitenStart);
    const f = auto3Ereignis(a.ereignis, jetzt);
    return f && (r.bedingungen || []).length && !autoBedingungenErfuellt(r, jetzt).ok ? null : f;
  };
}
if (typeof autoBedingungenErfuellt === "function") {
  const original = autoBedingungenErfuellt;
  autoBedingungenErfuellt = function (r, jetzt = Date.now()) {
    const e = original({ ...r, bedingungen: (r.bedingungen || []).filter((b) => b.art !== "nicht-ruhezeit") }, jetzt);
    if ((r.bedingungen || []).some((b) => b.art === "nicht-ruhezeit") && typeof vorsRuhezeit === "function" && vorsRuhezeit(jetzt, vorsLesen().einstellungen)) e.gruende.push("in der Ruhezeit");
    return { ok: !e.gruende.length, gruende: e.gruende };
  };
}
// neue Ereignisse und Vorlagen auch in den Auswahlfeldern (43 hat sie beim Laden gefüllt)
(function auto3Auswahl() {
  const ev = document.getElementById("auto-ereignis");
  if (ev) for (const [k, t] of Object.entries(AUTO_EREIGNISSE)) if (![...ev.options].some((o) => o.value === k)) ev.append(Object.assign(document.createElement("option"), { value: k, textContent: t }));
  const vo = document.getElementById("auto-vorlage");
  if (vo) vo.replaceChildren(...Object.entries(AUTO_VORLAGEN).map(([k, v]) => Object.assign(document.createElement("option"), { value: k, textContent: v.name })));
})();

// ---------- ab 11-13b: ausstehende Ereignisauslöser und Diagnose ----------
// Die Vorschau (autoVorschau) kannte nur zeitgesteuerte Regeln; Ereignisregeln waren nirgends mit ihrem Zustand sichtbar.
// autoVorschau bleibt unverändert; ergänzt wird die Anzeige.
function autoEreignisStand(jetzt = Date.now()) {
  return autoStand.regeln.filter((r) => r.ausloeser && r.ausloeser.art === "ereignis" && !r.pausiert && !autoRegelPruefen(r).length).map((r) => {
    let f = null; try { f = autoFaellig(r, jetzt); } catch (e) { return { regel: r.name, zustand: "Fehler bei der Prüfung: " + e.message }; }
    const z = r.zustand || {}, b = typeof autoBedingungenErfuellt === "function" && (r.bedingungen || []).length ? autoBedingungenErfuellt(r, jetzt) : { ok: true, gruende: [] };
    const zustand = f && z.slot === f.slot && z.status !== "fehler" ? "heute schon behandelt" : f ? "jetzt fällig" : !b.ok ? "Bedingung fehlt: " + b.gruende.join(", ") : "wartet auf: " + String(AUTO_EREIGNISSE[r.ausloeser.ereignis] || r.ausloeser.ereignis).replace(/^wenn /, "");
    return { regel: r.name, modus: r.modus, zustand };
  });
}
function autoDiagnose(jetzt = Date.now()) {
  const tag = autoStand.protokoll.filter((p) => jetzt - Date.parse(p.zeit) < 86400000), je = {};
  for (const p of tag) je[p.ergebnis || "?"] = (je[p.ergebnis || "?"] || 0) + 1;
  const ids = tag.filter((p) => p.ausgefuehrt).map((p) => p.id), letzterFehler = [...tag].reverse().find((p) => p.ergebnis === "fehler");
  return { je, ausgefuehrt: ids.length, eindeutig: new Set(ids).size === ids.length, stopp: Boolean(autoStand.stopp), letzterFehler: letzterFehler ? `${letzterFehler.regel}: ${letzterFehler.text}` : "" };
}
if (typeof autoAnzeigen === "function") {
  const original = autoAnzeigen;
  autoAnzeigen = function (...a) {
    const r = original.apply(this, a);
    try {
      const v = document.getElementById("auto-vorschau");
      if (v) v.append(...autoEreignisStand().map((x) => Object.assign(document.createElement("li"), { className: "auto-ereignis-stand" + (x.zustand === "jetzt fällig" ? " wz-wichtig" : ""), textContent: `Ereignis – ${x.regel}${x.modus ? " (" + x.modus + ")" : ""}: ${x.zustand}` })));
      let d = document.getElementById("auto-diagnose");
      const fehler = document.getElementById("auto-fehler");
      if (!d && fehler) { d = Object.assign(document.createElement("p"), { id: "auto-diagnose", className: "klein" }); d.setAttribute("aria-live", "polite"); fehler.insertAdjacentElement("afterend", d); }
      if (d) { const g = autoDiagnose(); d.textContent = `Diagnose (24 h): ${Object.entries(g.je).map(([k, n]) => `${k} ${n}`).join(", ") || "keine Läufe"} · Ausführungskennungen ${g.eindeutig ? "eindeutig" : "⚠ doppelt"}${g.stopp ? " · globaler Stopp aktiv" : ""}${g.letzterFehler ? " · letzter Fehler: " + g.letzterFehler : ""}`; }
    } catch (e) { /* Anzeige ist Zusatz */ }
    return r;
  };
}
;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("automatik3");
