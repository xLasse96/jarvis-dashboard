// JARVIS Dashboard – Modul „automatik-plus“ (ab 11-09k). Erweitert den vorhandenen Planer (27-automatik.js), ohne seine
// Sicherheitsregeln anzutasten (erlaubte Aktionen, Modi, Stopp, Kennungen, Versuchs- und Schleifengrenzen, Neustart bleiben dort):
//   - Regelvorlagen (immer im Modus „Simulation“ angelegt)
//   - weitere lokale Ereignisse: Aufgaben heute fällig, Projekt mit Risiko, ungelesene Benachrichtigungen, Sicherung älter als 7 Tage
//   - kombinierte Bedingungen (alle müssen gelten): mindestens n offene Aufgaben, nur zwischen zwei Uhrzeiten, nur werktags/Wochenende
//   - Priorität (hoch vor normal vor niedrig – Reihenfolge, wenn mehrere Regeln im selben Durchlauf fällig sind)
//   - Regelerklärung in Klartext und Trockenlauf „Jetzt prüfen“ (führt nie etwas aus)
//   - Modus je Regel umstellbar (Freigabeverwaltung), Konflikt- und Fehlerübersicht
// Gespeichert in den Regeln selbst (prio, bedingungen) in „jarvis-automatik“. Kein Netz, keine Orders, kein Not-Aus.
const AUTOPLUS = { formZusatz: null, maxBedingungen: 4 };
const AUTO_PRIO = { hoch: 0, normal: 1, niedrig: 2 };
Object.assign(AUTO_EREIGNISSE, {
  "aufgaben-heute": "wenn heute Aufgaben fällig sind (einmal am Tag)",
  "projekt-risiko": "wenn ein aktives Projekt ein Risiko hat (einmal am Tag)",
  hinweise: "wenn es ungelesene Benachrichtigungen gibt (einmal am Tag)",
  "sicherung-alt": "wenn die letzte Sicherung älter als 7 Tage ist (einmal am Tag)",
});
const AUTO_BEDINGUNGEN = { "min-offen": "mindestens n offene Aufgaben", zwischen: "nur zwischen zwei Uhrzeiten", werktag: "nur werktags", wochenende: "nur am Wochenende" };
const AUTO_VORLAGEN = {
  morgen: { name: "Morgens Tagesübersicht", ausloeser: { art: "zeit", uhrzeit: "07:30", tage: "werktags" }, aktion: { art: "tagesuebersicht" } },
  ueberfaellig: { name: "Überfällige Aufgaben melden", ausloeser: { art: "ereignis", ereignis: "ueberfaellig" }, aktion: { art: "hinweis", text: "Es gibt überfällige Aufgaben – bitte in „Aufgaben“ prüfen." } },
  wochenende: { name: "Freitags Wochenrückblick", ausloeser: { art: "zeit", uhrzeit: "16:00", tage: "werktags" }, aktion: { art: "hinweis", text: "Wochenende naht – kurzer Blick auf offene Aufgaben und Projekte?" }, bedingungen: [{ art: "min-offen", wert: 1 }] },
  sicherung: { name: "An Sicherung erinnern", ausloeser: { art: "ereignis", ereignis: "sicherung-alt" }, aktion: { art: "hinweis", text: "Die letzte Sicherung ist älter als 7 Tage – „Daten auf diesem Gerät“ → „Sicherung exportieren“." } },
  projekte: { name: "Projektrisiken melden", ausloeser: { art: "ereignis", ereignis: "projekt-risiko" }, aktion: { art: "hinweis", text: "Ein Projekt hat ein Risiko – siehe „Projektplanung“." } },
};
const autoMinuten = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
function autoBedingungPruefen(b) {
  if (!istObjekt(b) || !AUTO_BEDINGUNGEN[b.art]) return "Bedingung unbekannt.";
  if (b.art === "min-offen" && !(Number.isInteger(b.wert) && b.wert >= 1 && b.wert <= 100)) return "„mindestens n offene Aufgaben“: n zwischen 1 und 100.";
  if (b.art === "zwischen" && !(/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.von)) && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.bis)) && autoMinuten(b.von) < autoMinuten(b.bis))) return "„zwischen“: zwei Uhrzeiten, die erste vor der zweiten.";
  return "";
}
// Bedingungen zum Zeitpunkt jetzt: { ok, gruende: [nicht erfüllte] }
function autoBedingungenErfuellt(r, jetzt = Date.now()) {
  const gruende = [], d = new Date(jetzt), wt = d.getDay(), min = d.getHours() * 60 + d.getMinutes();
  for (const b of r.bedingungen || []) {
    if (b.art === "min-offen") { const n = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => !a.erledigt).length : 0; if (n < b.wert) gruende.push(`nur ${n} offene Aufgabe(n), verlangt ${b.wert}`); }
    if (b.art === "zwischen" && (min < autoMinuten(b.von) || min >= autoMinuten(b.bis))) gruende.push(`außerhalb ${b.von}–${b.bis} Uhr`);
    if (b.art === "werktag" && (wt === 0 || wt === 6)) gruende.push("kein Werktag");
    if (b.art === "wochenende" && wt !== 0 && wt !== 6) gruende.push("nicht Wochenende");
  }
  return { ok: !gruende.length, gruende };
}
// Prüfung erweitern: Priorität und Bedingungen
if (typeof autoRegelPruefen === "function") {
  const original = autoRegelPruefen;
  autoRegelPruefen = function (r) {
    const f = original(r);
    if (!r || typeof r !== "object") return f;
    if (r.prio !== undefined && AUTO_PRIO[r.prio] === undefined) f.push("Priorität ungültig.");
    if (r.bedingungen !== undefined) {
      if (!Array.isArray(r.bedingungen) || r.bedingungen.length > AUTOPLUS.maxBedingungen) f.push(`Höchstens ${AUTOPLUS.maxBedingungen} Bedingungen.`);
      else for (const b of r.bedingungen) { const g = autoBedingungPruefen(b); if (g) { f.push(g); break; } }
      const arten = (r.bedingungen || []).map((b) => b && b.art);
      if (arten.includes("werktag") && arten.includes("wochenende")) f.push("Widersprüchliche Bedingungen: „nur werktags“ und „nur am Wochenende“.");
    }
    return f;
  };
}
// Fälligkeit: neue Ereignisse, danach Bedingungen (nicht erfüllt → in diesem Durchlauf nicht fällig)
if (typeof autoFaellig === "function") {
  const original = autoFaellig;
  autoFaellig = function (r, jetzt, seitenStart) {
    let f = null;
    const a = r.ausloeser || {}, tag = autoTag(jetzt);
    if (a.art === "ereignis" && ["aufgaben-heute", "projekt-risiko", "hinweise", "sicherung-alt"].includes(a.ereignis)) {
      if (a.ereignis === "aufgaben-heute") {
        const ende = new Date(jetzt); ende.setHours(24, 0, 0, 0);
        const n = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((x) => !x.erledigt && x.faellig && new Date(x.faellig).getTime() < ende.getTime() && autoTag(new Date(x.faellig).getTime()) === tag).length : 0;
        f = n ? { slot: tag + " aufgaben-heute", anzahl: n } : null;
      } else if (a.ereignis === "projekt-risiko") {
        const n = typeof projektStand !== "undefined" ? projektStand.projekte.filter((p) => p.status === "aktiv" && projektUebersicht(p, new Date(jetzt)).risiken.length).length : 0;
        f = n ? { slot: tag + " projekt-risiko", anzahl: n } : null;
      } else if (a.ereignis === "hinweise") {
        const n = typeof hinweisStand !== "undefined" ? hinweisStand.eintraege.filter((h) => !h.gelesen).length : 0;
        f = n ? { slot: tag + " hinweise", anzahl: n } : null;
      } else {
        const s = typeof apLesen === "function" ? apLesen().letzteSicherung : null;
        f = !s || jetzt - Date.parse(s) > 7 * 86400000 ? { slot: tag + " sicherung-alt" } : null;
      }
    } else f = original(r, jetzt, seitenStart);
    if (f && !f.verpasst && (r.bedingungen || []).length && !autoBedingungenErfuellt(r, jetzt).ok) return null;
    return f;
  };
}
// Priorität: Regeln in Prioritätsreihenfolge (stabil) – gilt für jeden Durchlauf, weil dieser frisch liest
if (typeof autoLesen === "function") {
  const original = autoLesen;
  autoLesen = function () {
    const s = original();
    s.regeln = s.regeln.map((r, i) => [r, i]).sort((x, y) => (AUTO_PRIO[x[0].prio] ?? 1) - (AUTO_PRIO[y[0].prio] ?? 1) || x[1] - y[1]).map((x) => x[0]);
    return s;
  };
}
// Anlegen: Priorität und Bedingungen übernehmen (vorher geprüft; die vorhandene Prüfung läuft weiter)
if (typeof autoRegelAnlegen === "function") {
  const original = autoRegelAnlegen;
  autoRegelAnlegen = function (daten) {
    const zusatz = { prio: daten.prio !== undefined ? daten.prio : AUTOPLUS.formZusatz ? AUTOPLUS.formZusatz.prio : undefined, bedingungen: daten.bedingungen !== undefined ? daten.bedingungen : AUTOPLUS.formZusatz ? AUTOPLUS.formZusatz.bedingungen : undefined };
    AUTOPLUS.formZusatz = null;
    if (zusatz.prio === "normal") delete zusatz.prio;
    if (zusatz.bedingungen && !zusatz.bedingungen.length) delete zusatz.bedingungen;
    // nur die Fehler der Erweiterung (die übrigen meldet die vorhandene Prüfung in autoRegelAnlegen)
    const { prio: _p, bedingungen: _b, ...basis } = daten;
    const ohne = new Set(autoRegelPruefen({ ...basis, modus: daten.modus || "simulation" }));
    const probe = autoRegelPruefen({ ...daten, modus: daten.modus || "simulation", ...zusatz }).filter((x) => !ohne.has(x));
    if (probe.length) return { fehler: probe.join(" ") };
    const r = original(daten);
    if (r.regel && (zusatz.prio || zusatz.bedingungen)) {
      autoLesen();
      const gespeichert = autoStand.regeln.find((x) => x.id === r.regel.id);
      if (gespeichert) { Object.assign(gespeichert, zusatz.prio ? { prio: zusatz.prio } : {}, zusatz.bedingungen ? { bedingungen: zusatz.bedingungen } : {}); Object.assign(r.regel, gespeichert); autoSpeichern(); }
    }
    return r;
  };
}
function autoRegelErweitern(id, { prio, bedingungen } = {}) {
  autoLesen();
  const r = autoStand.regeln.find((x) => x.id === id);
  if (!r || speicherBeschaedigt(AUTO.schluessel)) return { fehler: "Regel nicht gefunden oder Speicher beschädigt." };
  const neu = { ...r, ...(prio !== undefined ? { prio } : {}), ...(bedingungen !== undefined ? { bedingungen } : {}) };
  const f = autoRegelPruefen(neu);
  if (f.length) return { fehler: f.join(" ") };
  Object.assign(r, neu);
  autoSpeichern(); autoAnzeigen();
  return { regel: r };
}
function autoVorlageAnlegen(schluessel) {
  const v = AUTO_VORLAGEN[schluessel];
  if (!v) return { fehler: "Unbekannte Vorlage." };
  return autoRegelAnlegen({ name: v.name, ausloeser: { ...v.ausloeser }, aktion: { ...v.aktion }, modus: "simulation", bedingungen: v.bedingungen ? v.bedingungen.map((b) => ({ ...b })) : [] });
}
// ---------- Klartext, Trockenlauf, Konflikte, Fehler ----------
function autoRegelErklaeren(r) {
  const a = r.ausloeser, wann = a.art === "zeit" ? `${AUTO_TAGE[a.tage]} um ${a.uhrzeit}` : AUTO_EREIGNISSE[a.ereignis].replace(/^wenn /, "");
  const bed = (r.bedingungen || []).map((b) => b.art === "min-offen" ? `mindestens ${b.wert} offene Aufgabe(n)` : b.art === "zwischen" ? `zwischen ${b.von} und ${b.bis} Uhr` : AUTO_BEDINGUNGEN[b.art]);
  return `Wenn ${wann}${bed.length ? " und " + bed.join(" und ") : ""} → ${autoBeschreibung(r)} · ${AUTO_MODI[r.modus]} · Priorität ${r.prio || "normal"}${r.pausiert ? " · pausiert" : ""}`;
}
// Trockenlauf: würde die Regel jetzt auslösen? Führt nichts aus und ändert nichts.
function autoTrockenlauf(id, jetzt = Date.now()) {
  const r = autoStand.regeln.find((x) => x.id === id);
  if (!r) return { text: "Regel nicht gefunden." };
  const f = autoRegelPruefen(r);
  if (f.length) return { ausloesen: false, text: "Ungültig – läuft nie: " + f.join(" ") };
  if (autoStand.stopp) return { ausloesen: false, text: "Alle Automatisierungen sind gestoppt." };
  if (r.pausiert) return { ausloesen: false, text: "Regel ist pausiert." };
  const ohneBed = { ...r, bedingungen: [] }, roh = autoFaellig(ohneBed, jetzt);
  if (!roh) return { ausloesen: false, text: "Auslöser derzeit nicht erfüllt." };
  const b = autoBedingungenErfuellt(r, jetzt);
  if (!b.ok) return { ausloesen: false, text: "Auslöser erfüllt, aber Bedingung nicht: " + b.gruende.join("; ") + "." };
  if (roh.verpasst) return { ausloesen: false, text: "Zeitpunkt liegt zu weit zurück – würde als „verpasst“ protokolliert, nicht nachgeholt." };
  const z = r.zustand || {};
  if (z.slot === roh.slot && (z.status !== "fehler" || (z.versuche || 0) >= AUTO.maxVersuche)) return { ausloesen: false, text: `Für dieses Zeitfenster (${roh.slot}) schon behandelt (${z.status}) – keine Doppelausführung.` };
  return { ausloesen: true, text: `Würde jetzt auslösen (${roh.slot}): ${autoBeschreibung(r)} – ${r.modus === "simulation" ? "nur protokolliert" : r.modus === "freigabe" ? "mit Rückfrage" : "automatisch"}. Im Trockenlauf wurde nichts ausgeführt.` };
}
// Konflikte: gleicher Zeitpunkt/gleiches Ereignis bei mehreren aktiven Regeln (Reihenfolge nach Priorität), zwei Routinen gleichzeitig,
// gleiche Regel doppelt
function autoKonflikte() {
  const aktiv = autoStand.regeln.filter((r) => !r.pausiert && !autoRegelPruefen(r).length), aus = [];
  const schl = (r) => (r.ausloeser.art === "zeit" ? r.ausloeser.uhrzeit + "|" + r.ausloeser.tage : "e|" + r.ausloeser.ereignis);
  const gruppen = new Map();
  for (const r of aktiv) gruppen.set(schl(r), [...(gruppen.get(schl(r)) || []), r]);
  for (const [, g] of gruppen) {
    if (g.length < 2) continue;
    const routinen = g.filter((r) => r.aktion.art === "routine");
    if (routinen.length > 1) aus.push(`Gleichzeitig mehrere Routinen (${routinen.map((r) => "„" + r.name + "“").join(", ")}) – nur die erste läuft, die übrigen melden „andere Routine läuft“.`);
    const gleich = g.filter((r, i) => g.findIndex((x) => JSON.stringify(x.aktion) === JSON.stringify(r.aktion)) !== i);
    if (gleich.length) aus.push(`Doppelte Regel: „${gleich[0].name}“ macht zur selben Zeit dasselbe wie eine andere.`);
    if (!routinen.length || routinen.length === 1) aus.push(`Gleicher Auslöser für ${g.map((r) => "„" + r.name + "“").join(", ")} – Reihenfolge nach Priorität.`);
  }
  return aus;
}
function autoFehleruebersicht() {
  const je = new Map();
  for (const p of autoStand.protokoll) if (["fehler", "gesperrt", "unterbrochen"].includes(p.ergebnis)) { const x = je.get(p.regel) || { fehler: 0, gesperrt: 0, unterbrochen: 0, letzter: "" }; x[p.ergebnis]++; x.letzter = p.text; je.set(p.regel, x); }
  return [...je.entries()].map(([regel, x]) => ({ regel, ...x }));
}
// ---------- Anzeige: Erklärung, Modus, Priorität, Trockenlauf je Regel; Übersichten ----------
if (typeof autoAnzeigen === "function") {
  const original = autoAnzeigen;
  autoAnzeigen = function () {
    original();
    const el = (id) => document.getElementById(id);
    if (!el("auto-liste")) return;
    for (const li of el("auto-liste").querySelectorAll("li[data-id]")) {
      const r = autoStand.regeln.find((x) => x.id === li.dataset.id);
      if (!r || autoRegelPruefen(r).length) continue;
      const info = Object.assign(document.createElement("span"), { className: "aufgabe-faellig auto-erklaerung", textContent: autoRegelErklaeren(r) });
      const modus = Object.assign(document.createElement("select"), { className: "feld" });
      modus.setAttribute("aria-label", "Modus: " + r.name);
      modus.append(...Object.entries(AUTO_MODI).map(([k, t]) => Object.assign(document.createElement("option"), { value: k, textContent: t, selected: k === r.modus })));
      modus.addEventListener("change", () => { autoRegelAendern(r.id, { modus: modus.value }); el("auto-meldung").textContent = `„${r.name}“: ${AUTO_MODI[modus.value]}.`; });
      const prio = Object.assign(document.createElement("select"), { className: "feld" });
      prio.setAttribute("aria-label", "Priorität: " + r.name);
      prio.append(...Object.keys(AUTO_PRIO).map((k) => Object.assign(document.createElement("option"), { value: k, textContent: "Priorität " + k, selected: k === (r.prio || "normal") })));
      prio.addEventListener("change", () => { const x = autoRegelErweitern(r.id, { prio: prio.value }); el("auto-meldung").textContent = x.fehler || `„${r.name}“: Priorität ${prio.value}.`; });
      const test = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: "Jetzt prüfen" });
      test.setAttribute("aria-label", "Jetzt prüfen (Trockenlauf): " + r.name);
      test.addEventListener("click", () => { el("auto-meldung").textContent = `„${r.name}“: ` + autoTrockenlauf(r.id).text; });
      li.append(info, modus, prio, test);
    }
    const k = autoKonflikte(), fe = autoFehleruebersicht();
    el("auto-konflikte").replaceChildren(...(k.length ? k : ["Keine Konflikte."]).map((t) => Object.assign(document.createElement("li"), { textContent: t })));
    el("auto-fehler").replaceChildren(...(fe.length ? fe.map((x) => `${x.regel}: ${x.fehler} Fehler, ${x.gesperrt} gesperrt (Schleifenschutz), ${x.unterbrochen} unterbrochen – zuletzt: ${x.letzter}`) : ["Keine Fehler im Protokoll."]).map((t) => Object.assign(document.createElement("li"), { textContent: t })));
    const modi = Object.keys(AUTO_MODI).map((m) => `${autoStand.regeln.filter((r) => r.modus === m).length} ${AUTO_MODI[m]}`);
    el("auto-freigaben").textContent = "Freigaben: " + modi.join(" · ") + ". Erlaubt sind nur Hinweis, Tagesübersicht und Routinen (nur lesende bzw. leicht rückgängige Schritte) – keine Handels-, Order- oder Netzaktionen.";
  };
}
(function autoPlusEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("auto-form")) return;
  const sel = el("auto-ereignis");
  for (const [k, t] of Object.entries(AUTO_EREIGNISSE)) if (![...sel.options].some((o) => o.value === k)) sel.append(Object.assign(document.createElement("option"), { value: k, textContent: t }));
  el("auto-vorlage").replaceChildren(...Object.entries(AUTO_VORLAGEN).map(([k, v]) => Object.assign(document.createElement("option"), { value: k, textContent: v.name })));
  el("auto-vorlage-anlegen").addEventListener("click", () => { const r = autoVorlageAnlegen(el("auto-vorlage").value); el("auto-meldung").textContent = r.fehler ? "Nicht angelegt: " + r.fehler : `Vorlage „${r.regel.name}“ im Modus Simulation angelegt – erst prüfen, dann umstellen.`; autoAnzeigen(); });
  // Zusatzfelder des Formulars vor dem vorhandenen Absenden-Handler einsammeln
  el("auto-form").addEventListener("submit", () => {
    const b = [];
    if (el("auto-bed-offen").value) b.push({ art: "min-offen", wert: Number(el("auto-bed-offen").value) });
    if (el("auto-bed-von").value || el("auto-bed-bis").value) b.push({ art: "zwischen", von: el("auto-bed-von").value, bis: el("auto-bed-bis").value });
    if (el("auto-bed-tage").value) b.push({ art: el("auto-bed-tage").value });
    AUTOPLUS.formZusatz = { prio: el("auto-prio").value, bedingungen: b };
  }, true);
  autoLesen(); autoAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("automatik-plus");
