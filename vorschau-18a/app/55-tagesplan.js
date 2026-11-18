// JARVIS Dashboard – Modul „tagesplan“ (ab 11-10f). Intelligente Tagesplanung über den vorhandenen Aufgaben (11-aufgaben.js):
//   - je Aufgabe: geschätzte Dauer, Abhängigkeit („wartet auf …“), Zeitblock (geplanter Beginn) – zusätzliche Felder in „jarvis-aufgaben“
//   - Reihenfolgevorschlag (überfällig → Priorität → Uhrzeit → kürzer zuerst; wartende Aufgaben am Ende, mit Grund)
//   - Zeitblöcke für einen Tag (Arbeitszeit von–bis, feste Uhrzeiten bleiben fest, was nicht passt, wird genannt) – nur Vorschlag,
//     Übernehmen setzt nur den Zeitblock, nie die Fälligkeit
//   - Tagesfortschritt, offene Verpflichtungen (überfällig, nächste 7 Tage, Projekt-Meilensteine), Wochenzusammenfassung,
//     Monatsübersicht, Tagesabschluss mit „Offenes auf morgen verschieben“ (nur nach zweitem Klick)
//   - Sprache: „Verschiebe Aufgabe X auf morgen um 10“, „Aufgabe X dauert 45 Minuten“, „Aufgabe X wartet auf Y“, „Tagesplan“
// Alle Zeiten werden als ISO (UTC) gespeichert und lokal angezeigt; Rechnungen über lokale Kalendertage (Sommerzeit-fest).
const TPLAN = { dauerStandard: 30, minDauer: 5, maxDauer: 600, verschiebenOffen: 0 };
const tplanTag = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const tplanPlus = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); // Kalendertage, nicht 24-h-Schritte (Sommerzeit)
const tplanHHMM = (s) => { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s || "").trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const tplanUhr = (d) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const tplanListe = () => (window.aufgabenIntern ? window.aufgabenIntern.liste() : []);
// Ändern: frisch lesen, ändern, schreiben, neu laden (Aufgaben-Modul speichert sonst aus seinem Arbeitsspeicher)
function tplanAendern(id, f) {
  if (speicherBeschaedigt("jarvis-aufgaben")) return { fehler: "Aufgaben beschädigt – " + SPEICHER_SCHADEN_TEXT };
  const d = speicherJsonLesen("jarvis-aufgaben", Array.isArray);
  const a = d && d.find((x) => x && x.id === id);
  if (!a) return { fehler: "Aufgabe nicht gefunden." };
  const r = f(a, d);
  if (r && r.fehler) return r;
  try { localStorage.setItem("jarvis-aufgaben", JSON.stringify(d)); } catch (e) { return { fehler: "Nicht gespeichert (Browserspeicher voll oder gesperrt)." }; }
  window.aufgabenIntern.laden(); window.aufgabenIntern.anzeigen(); tplanAnzeigen();
  return { aufgabe: a };
}
function tplanDauer(id, minuten) {
  const n = Math.round(Number(minuten));
  if (!(n >= TPLAN.minDauer && n <= TPLAN.maxDauer)) return { fehler: `Dauer zwischen ${TPLAN.minDauer} und ${TPLAN.maxDauer} Minuten.` };
  return tplanAendern(id, (a) => { a.dauerMin = n; });
}
// Abhängigkeit: keine auf sich selbst, keine Kreise
function tplanAbhaengig(id, vonId) {
  return tplanAendern(id, (a, alle) => {
    if (!vonId) { delete a.abhaengigVon; return null; }
    if (vonId === id) return { fehler: "Eine Aufgabe kann nicht auf sich selbst warten." };
    if (!alle.some((x) => x.id === vonId)) return { fehler: "Vorausgesetzte Aufgabe nicht gefunden." };
    for (let x = alle.find((y) => y.id === vonId), n = 0; x && n < 50; x = alle.find((y) => y.id === x.abhaengigVon), n++) if (x.abhaengigVon === id) return { fehler: "Das ergäbe einen Kreis von Abhängigkeiten." };
    a.abhaengigVon = vonId;
    return null;
  });
}
function tplanVerschieben(id, datum) {
  if (!(datum instanceof Date) || isNaN(datum)) return { fehler: "Kein gültiger Zeitpunkt." };
  return tplanAendern(id, (a) => { a.faellig = datum.toISOString(); a.erinnertFuer = ""; a.schlummernBis = ""; delete a.block; });
}
const tplanWartet = (a, alle) => { const v = a.abhaengigVon && alle.find((x) => x.id === a.abhaengigVon); return v && !v.erledigt ? v : null; };
// Offene Aufgaben eines Tages (fällig an diesem Tag oder überfällig); ohne Fälligkeit nur, wenn mitOhne
function tplanTagesaufgaben(tag = new Date(), mitOhne = false) {
  const von = tplanTag(tag), bis = tplanPlus(von, 1), heute = tplanTag(new Date());
  return tplanListe().filter((a) => !a.erledigt && ((a.faellig && new Date(a.faellig) < bis && (new Date(a.faellig) >= von || von.getTime() === heute.getTime())) || (mitOhne && !a.faellig)));
}
function tplanReihenfolge(tag = new Date(), jetzt = new Date()) {
  const alle = tplanListe(), rang = { hoch: 0, normal: 1, niedrig: 2 };
  return tplanTagesaufgaben(tag, true).map((a) => {
    const w = tplanWartet(a, alle), ueber = a.faellig && new Date(a.faellig) < jetzt;
    const gruende = [w && `wartet auf „${w.titel}“`, ueber && "überfällig", a.prio === "hoch" && "Priorität hoch", a.faellig && "fällig " + tplanUhr(new Date(a.faellig)), `${a.dauerMin || TPLAN.dauerStandard} min${a.dauerMin ? "" : " (geschätzt)"}`].filter(Boolean);
    return { a, w, ueber, gruende };
  }).sort((x, y) => (Boolean(x.w) - Boolean(y.w)) || (Boolean(y.ueber) - Boolean(x.ueber)) || ((rang[x.a.prio] ?? 1) - (rang[y.a.prio] ?? 1)) || String(x.a.faellig || "9").localeCompare(String(y.a.faellig || "9")) || ((x.a.dauerMin || TPLAN.dauerStandard) - (y.a.dauerMin || TPLAN.dauerStandard)));
}
// Zeitblöcke: feste Termine (Uhrzeit ≠ 09:00 Standard) bleiben; übrige der Reihe nach in die Lücken
function tplanZeitbloecke(tag = new Date(), von = "09:00", bis = "18:00", jetzt = new Date()) {
  const vm = tplanHHMM(von), bm = tplanHHMM(bis);
  if (vm === null || bm === null || vm >= bm) return { fehler: "Arbeitszeit ungültig (HH:MM, Beginn vor Ende)." };
  const t0 = tplanTag(tag), zeit = (min) => new Date(t0.getFullYear(), t0.getMonth(), t0.getDate(), Math.floor(min / 60), min % 60);
  const minVon = (d) => d.getHours() * 60 + d.getMinutes();
  const liste = tplanReihenfolge(tag, jetzt), fest = [], frei = [];
  for (const x of liste) {
    const f = x.a.faellig ? new Date(x.a.faellig) : null;
    if (f && tplanTag(f).getTime() === t0.getTime() && minVon(f) !== 9 * 60) fest.push({ a: x.a, beginn: minVon(f), dauer: x.a.dauerMin || TPLAN.dauerStandard, fest: true });
    else if (!x.w) frei.push(x);
  }
  const belegt = fest.map((f) => [f.beginn, f.beginn + f.dauer]).sort((a, b) => a[0] - b[0]);
  const bloecke = [...fest], passtNicht = [];
  let pos = Math.max(vm, t0.getTime() === tplanTag(jetzt).getTime() ? Math.ceil(minVon(jetzt) / 5) * 5 : vm);
  for (const x of frei) {
    const dauer = x.a.dauerMin || TPLAN.dauerStandard;
    for (const [s, e] of belegt) if (pos < e && pos + dauer > s) pos = e;
    if (pos + dauer > bm) { passtNicht.push(x.a); continue; }
    bloecke.push({ a: x.a, beginn: pos, dauer, fest: false });
    belegt.push([pos, pos + dauer]); belegt.sort((a, b) => a[0] - b[0]);
    pos += dauer;
  }
  bloecke.sort((a, b) => a.beginn - b.beginn);
  return { bloecke: bloecke.map((b) => ({ ...b, start: zeit(b.beginn), ende: zeit(b.beginn + b.dauer) })), passtNicht, wartend: liste.filter((x) => x.w).map((x) => x.a) };
}
function tplanBloeckeUebernehmen(plan) {
  if (!plan || !plan.bloecke) return 0;
  const d = speicherJsonLesen("jarvis-aufgaben", Array.isArray);
  if (!d || speicherBeschaedigt("jarvis-aufgaben")) return 0;
  let n = 0;
  for (const b of plan.bloecke.filter((x) => !x.fest)) { const a = d.find((x) => x.id === b.a.id); if (a) { a.block = b.start.toISOString(); n++; } }
  try { localStorage.setItem("jarvis-aufgaben", JSON.stringify(d)); } catch (e) { return 0; }
  window.aufgabenIntern.laden(); window.aufgabenIntern.anzeigen(); tplanAnzeigen();
  return n;
}
function tplanFortschritt(tag = new Date()) {
  const von = tplanTag(tag), bis = tplanPlus(von, 1), im = (x) => x && new Date(x) >= von && new Date(x) < bis;
  const alle = tplanListe(), erledigt = alle.filter((a) => a.erledigt && im(a.erledigtAm)).length + alle.filter((a) => a.wiederholung && im(a.zuletztErledigt)).length;
  const offen = tplanTagesaufgaben(tag).length;
  return { erledigt, offen, gesamt: erledigt + offen, prozent: erledigt + offen ? Math.round((erledigt / (erledigt + offen)) * 100) : 0 };
}
function tplanVerpflichtungen(jetzt = new Date()) {
  const bis = tplanPlus(tplanTag(jetzt), 8), offen = tplanListe().filter((a) => !a.erledigt && a.faellig);
  const ms = typeof projektStand !== "undefined" ? projektStand.projekte.filter((p) => p.status === "aktiv").flatMap((p) => (p.meilensteine || []).filter((m) => !m.erledigt && m.faellig && new Date(m.faellig) < bis).map((m) => ({ titel: m.titel, faellig: m.faellig, projekt: p.name }))) : [];
  return { ueberfaellig: offen.filter((a) => new Date(a.faellig) < jetzt), woche: offen.filter((a) => new Date(a.faellig) >= jetzt && new Date(a.faellig) < bis), meilensteine: ms };
}
function tplanWoche(jetzt = new Date()) {
  const mo = tplanPlus(tplanTag(jetzt), -((jetzt.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const t = tplanPlus(mo, i), f = tplanFortschritt(t); return { tag: t, ...f }; });
}
function tplanMonat(jetzt = new Date()) {
  const erster = new Date(jetzt.getFullYear(), jetzt.getMonth(), 1), tage = new Date(jetzt.getFullYear(), jetzt.getMonth() + 1, 0).getDate();
  const je = Array.from({ length: tage }, (_, i) => ({ tag: i + 1, anzahl: 0 }));
  for (const a of tplanListe()) { if (a.erledigt || !a.faellig) continue; const f = new Date(a.faellig); if (f.getFullYear() === erster.getFullYear() && f.getMonth() === erster.getMonth()) je[f.getDate() - 1].anzahl++; }
  return { monat: erster.toLocaleDateString("de-DE", { month: "long", year: "numeric" }), tage: je };
}
// Tagesabschluss: Zusammenfassung; „Verschieben“ erst nach zweitem Aufruf innerhalb von 10 s
function tplanAbschluss(jetzt = new Date()) {
  const f = tplanFortschritt(jetzt), offen = tplanTagesaufgaben(jetzt), morgen = tplanTagesaufgaben(tplanPlus(jetzt, 1)).filter((a) => !offen.includes(a));
  return { text: `Heute erledigt: ${f.erledigt}, offen: ${f.offen}${f.gesamt ? ` (${f.prozent} %)` : ""}. Morgen fällig: ${morgen.length}${morgen.length ? " – " + morgen.slice(0, 5).map((a) => a.titel).join(", ") : ""}.`, offen };
}
function tplanOffenVerschieben(jetzt = Date.now()) {
  if (jetzt - TPLAN.verschiebenOffen > 10000) { TPLAN.verschiebenOffen = jetzt; return { vorgemerkt: true }; }
  TPLAN.verschiebenOffen = 0;
  const morgen9 = new Date(tplanPlus(new Date(jetzt), 1).setHours(9, 0, 0, 0));
  let n = 0;
  for (const a of tplanAbschluss(new Date(jetzt)).offen) if (!a.wiederholung && !tplanVerschieben(a.id, morgen9).fehler) n++;
  return { verschoben: n, ziel: morgen9 };
}
// ---------- Anzeige ----------
function tplanAnzeigen(jetzt = new Date()) {
  const el = (id) => document.getElementById(id);
  if (!el("tplan-reihenfolge") || !el("tplan-details").open) return;
  const li = (t, k) => Object.assign(document.createElement("li"), { textContent: t, className: k || "" });
  const f = tplanFortschritt(jetzt);
  el("tplan-fortschritt").value = f.erledigt; el("tplan-fortschritt").max = Math.max(1, f.gesamt);
  el("tplan-fortschritt-text").textContent = `Heute: ${f.erledigt} von ${f.gesamt} erledigt (${f.prozent} %)`;
  el("tplan-reihenfolge").replaceChildren(...(tplanReihenfolge(jetzt, jetzt).map((x, i) => li(`${i + 1}. ${x.a.titel} – ${x.gruende.join(", ")}`, x.w ? "aus" : x.ueber ? "wz-wichtig" : ""))));
  if (!el("tplan-reihenfolge").children.length) el("tplan-reihenfolge").append(li("Heute nichts offen."));
  const v = tplanVerpflichtungen(jetzt);
  el("tplan-verpflichtungen").replaceChildren(li(`Überfällig: ${v.ueberfaellig.length ? v.ueberfaellig.map((a) => a.titel).join(", ") : "nichts"}`, v.ueberfaellig.length ? "wz-wichtig" : ""), li(`Nächste 7 Tage: ${v.woche.length} Aufgabe(n)`), li(`Projekt-Meilensteine bis in 7 Tagen: ${v.meilensteine.length ? v.meilensteine.map((m) => `${m.titel} (${m.projekt})`).join(", ") : "keine"}`));
  el("tplan-woche").replaceChildren(...tplanWoche(jetzt).map((t) => li(`${t.tag.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}: ${t.erledigt} erledigt, ${t.offen} offen`)));
  const m = tplanMonat(jetzt), wochen = [];
  for (let i = 0; i < m.tage.length; i += 7) wochen.push(m.tage.slice(i, i + 7).map((t) => `${t.tag}.${t.anzahl ? "·" + t.anzahl : ""}`).join("  "));
  el("tplan-monat").replaceChildren(li(m.monat + " – fällige offene Aufgaben je Tag:"), ...wochen.map((w) => li(w)));
}
function tplanBloeckeAnzeigen() {
  const el = (id) => document.getElementById(id), p = tplanZeitbloecke(new Date(), el("tplan-von").value || "09:00", el("tplan-bis").value || "18:00");
  TPLAN.letzterPlan = p.fehler ? null : p;
  el("tplan-bloecke").replaceChildren(...(p.fehler ? [Object.assign(document.createElement("li"), { textContent: p.fehler })] : [
    ...p.bloecke.map((b) => Object.assign(document.createElement("li"), { textContent: `${tplanUhr(b.start)}–${tplanUhr(b.ende)} ${b.a.titel}${b.fest ? " (fester Termin)" : ""}` })),
    ...p.passtNicht.map((a) => Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: `passt heute nicht mehr: ${a.titel}` })),
    ...p.wartend.map((a) => Object.assign(document.createElement("li"), { className: "aus", textContent: `wartet: ${a.titel}` }))]));
  el("tplan-uebernehmen").disabled = !TPLAN.letzterPlan || !TPLAN.letzterPlan.bloecke.some((b) => !b.fest);
}
// ---------- Sprache ----------
const tplanFinde = (name) => { const n = befehlNormalisieren(name), l = tplanListe().filter((a) => !a.erledigt); return l.find((a) => befehlNormalisieren(a.titel) === n) || (l.filter((a) => befehlNormalisieren(a.titel).includes(n)).length === 1 ? l.find((a) => befehlNormalisieren(a.titel).includes(n)) : null); };
skillRegistrieren({
  name: "tagesplan",
  risiko: "leicht",
  hilfeKurz: "Tagesplan",
  beschreibung: "Tagesplan: Reihenfolge, Dauer, Abhängigkeit, Verschieben (rückgängig in der Aufgabenliste)",
  beispiele: ["Tagesplan", "Verschiebe Aufgabe Arzt anrufen auf morgen um 10", "Aufgabe Steuer dauert 45 Minuten"],
  passt: (text) => /^(tagesplan|plane meinen tag|wie soll ich meinen tag planen|verschiebe (die )?aufgabe .+ auf .+|aufgabe .+ dauert \d+ minuten?|aufgabe .+ wartet auf .+|tagesabschluss)$/.test(befehlNormalisieren(text)),
  aktion: async (text) => {
    const t = befehlNormalisieren(text), roh = String(text).replace(/^\s*(hey\s+)?jarvis[\s,]+/i, "").replace(/[.!?]+\s*$/, "").trim();
    let m;
    if ((m = /^verschiebe (?:die )?aufgabe (.+?) auf (.+)$/i.exec(roh))) {
      const a = tplanFinde(m[1]), z = zeitangabeErkennen(m[2]);
      if (!a) { lokalAntworten(`Keine eindeutige offene Aufgabe „${m[1]}“ gefunden – nichts verschoben.`); return true; }
      if (!z.datum) { lokalAntworten("Zeitpunkt nicht eindeutig: " + (z.rueckfrage || "bitte z. B. „morgen um 10“.")); return true; }
      const r = tplanVerschieben(a.id, z.datum);
      lokalAntworten(r.fehler || `„${a.titel}“ verschoben auf ${z.datum.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}.`);
      return true;
    }
    if ((m = /^aufgabe (.+?) dauert (\d+) minuten?$/i.exec(roh))) { const a = tplanFinde(m[1]); const r = a ? tplanDauer(a.id, m[2]) : { fehler: `Keine eindeutige offene Aufgabe „${m[1]}“.` }; lokalAntworten(r.fehler || `Dauer von „${a.titel}“: ${m[2]} Minuten.`); return true; }
    if ((m = /^aufgabe (.+?) wartet auf (.+)$/i.exec(roh))) { const a = tplanFinde(m[1]), b = tplanFinde(m[2]); const r = a && b ? tplanAbhaengig(a.id, b.id) : { fehler: "Beide Aufgaben müssen eindeutig und offen sein." }; lokalAntworten(r.fehler || `„${a.titel}“ wartet jetzt auf „${b.titel}“.`); return true; }
    if (/^tagesabschluss$/.test(t)) { lokalAntworten("Tagesabschluss: " + tplanAbschluss().text + " Offenes verschieben: in „Aufgaben“ → „Tagesplanung“."); return true; }
    const r = tplanReihenfolge();
    lokalAntworten(r.length ? "Vorschlag für heute:\n" + r.slice(0, 8).map((x, i) => `${i + 1}. ${x.a.titel} (${x.gruende.join(", ")})`).join("\n") + "\nZeitblöcke: „Aufgaben“ → „Tagesplanung“." : "Heute ist nichts offen.");
    return true;
  },
});
(function tplanEinordnen() { const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation"); SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s); })();
if (window.aufgabenIntern) { const original = window.aufgabenIntern.anzeigen; window.aufgabenIntern.anzeigen = function (...x) { const r = original.apply(this, x); try { tplanAnzeigen(); } catch (e) { /* Anzeige */ } return r; }; }
(function tplanEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("tplan-details")) return;
  el("tplan-details").addEventListener("toggle", () => { if (el("tplan-details").open) { tplanAnzeigen(); tplanBloeckeAnzeigen(); } });
  el("tplan-planen").addEventListener("click", tplanBloeckeAnzeigen);
  el("tplan-uebernehmen").addEventListener("click", () => { const n = tplanBloeckeUebernehmen(TPLAN.letzterPlan); el("tplan-meldung").textContent = n ? `${n} Zeitblock/Zeitblöcke übernommen (Fälligkeiten unverändert).` : "Nichts übernommen."; });
  el("tplan-abschluss").addEventListener("click", () => { el("tplan-meldung").textContent = tplanAbschluss().text; });
  el("tplan-verschieben").addEventListener("click", () => { const r = tplanOffenVerschieben(); el("tplan-meldung").textContent = r.vorgemerkt ? "Zum Verschieben aller offenen Aufgaben von heute auf morgen 9:00 innerhalb von 10 s erneut klicken (wiederkehrende bleiben)." : `${r.verschoben} Aufgabe(n) auf morgen 9:00 verschoben.`; });
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("tagesplan");
