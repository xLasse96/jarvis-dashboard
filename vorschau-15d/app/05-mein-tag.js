// JARVIS Dashboard – Modul „mein-tag“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).
// ---------- Mein Tag: lokale Startübersicht und Tagesbriefing (ab 11-06f) ----------
// Nur was auf diesem Gerät bzw. in dieser Sitzung vorliegt: Aufgaben, Routinen, Aktien-Watchlist und -Alarme, Simulation, Speicher-
// und Versionshinweise. Keine Anfrage, keine Kurse, keine Schätzung; was fehlt, steht als „nicht verfügbar“ da.
function tagesbriefingDaten(jetzt = Date.now()) {
  const zeilen = [];
  const z = (bereich, text, art = "ok") => zeilen.push({ bereich, text, art });
  const heute = new Date(jetzt).toDateString();
  const uhr = (ms) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  // Aufgaben
  try {
    const offen = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => a && !a.erledigt) : null;
    if (!offen) z("Aufgaben", "nicht verfügbar", "fehlt");
    else if (speicherBeschaedigt("jarvis-aufgaben")) z("Aufgaben", "gespeicherter Stand beschädigt – siehe Karte „Aufgaben“", "hinweis");
    else {
      const zeit = (a) => (a.faellig ? new Date(a.faellig).getTime() : NaN);
      const ueber = offen.filter((a) => zeit(a) <= jetzt);
      const heuteFaellig = offen.filter((a) => zeit(a) > jetzt && new Date(zeit(a)).toDateString() === heute);
      const hoch = offen.filter((a) => a.prio === "hoch");
      const naechste = offen.filter((a) => Number.isFinite(zeit(a))).sort((a, b) => zeit(a) - zeit(b)).slice(0, 3);
      z("Aufgaben", offen.length ? `${offen.length} offen` + (ueber.length ? ` · ${ueber.length} überfällig` : "") + (heuteFaellig.length ? ` · ${heuteFaellig.length} heute fällig` : "") + (hoch.length ? ` · ${hoch.length} mit hoher Priorität` : "")
        + (naechste.length ? ` · als Nächstes: ${naechste.map((a) => `${a.titel} (${new Date(zeit(a)).toDateString() === heute ? "heute " + uhr(zeit(a)) : new Date(zeit(a)).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })})`).join(", ")}` : "") : "keine offenen Aufgaben",
      ueber.length ? "hinweis" : "ok");
    }
  } catch (e) { z("Aufgaben", "nicht verfügbar", "fehlt"); }
  // Termine (ab 11-06h): Aufgaben mit Fälligkeit in den nächsten 7 Tagen – andere Termindaten gibt es lokal nicht
  try {
    const bis = jetzt + 7 * 86400000;
    const termine = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => a && !a.erledigt && a.faellig && new Date(a.faellig).getTime() > jetzt && new Date(a.faellig).getTime() <= bis)
      .sort((a, b) => new Date(a.faellig) - new Date(b.faellig)) : [];
    z("Termine (7 Tage)", termine.length ? termine.slice(0, 5).map((a) => `${new Date(a.faellig).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })} ${uhr(new Date(a.faellig).getTime())} ${a.titel}`).join(" · ") + (termine.length > 5 ? ` · +${termine.length - 5} weitere` : "") : "keine fälligen Aufgaben in den nächsten 7 Tagen (Termine nur aus Aufgaben mit Fälligkeit)");
  } catch (e) { z("Termine (7 Tage)", "nicht verfügbar", "fehlt"); }
  // Routinen mit Tagesfortschritt (ab 11-06h)
  try {
    if (typeof routinen === "undefined" || !Array.isArray(routinen)) z("Routinen", "nicht verfügbar", "fehlt");
    else {
      const f = typeof routinenFortschritt === "function" ? routinenFortschritt(jetzt) : null;
      z("Routinen", (routinen.length ? `${routinen.length} gespeichert` : "keine gespeichert") + (f && f.gesamt ? ` · täglich heute ${f.erledigt} von ${f.gesamt} erledigt` + (f.offen.length ? ` (offen: ${f.offen.join(", ")})` : "") : "") + (f && f.pausiert ? ` · ${f.pausiert} pausiert` : ""), f && f.offen.length ? "hinweis" : "ok");
    }
  } catch (e) { z("Routinen", "nicht verfügbar", "fehlt"); }
  // Notizen (ab 11-06h)
  try {
    if (typeof notizen === "undefined") z("Notizen", "nicht verfügbar", "fehlt");
    else if (speicherBeschaedigt("jarvis-notizen")) z("Notizen", "gespeicherter Stand beschädigt – siehe Karte „Notizen“", "hinweis");
    else { const neu = notizen.filter((n) => new Date(n.geaendert).toDateString() === heute); z("Notizen", notizen.length ? `${notizen.length} gespeichert` + (neu.length ? ` · heute geändert: ${neu.slice(0, 3).map((n) => n.titel).join(", ")}` : "") : "keine"); }
  } catch (e) { z("Notizen", "nicht verfügbar", "fehlt"); }
  // Aktien-Watchlist und Alarme (lokal)
  try {
    const wl = wlLaden();
    if (wl.beschaedigt) z("Watchlist", "gespeicherter Stand beschädigt – siehe Karte „US-Aktie analysieren“", "hinweis");
    else {
      const analysiert = wl.eintraege.filter((e) => APROFIL.analysen[e.symbol]).length;
      z("Watchlist", wl.eintraege.length ? `${wl.eintraege.length} Aktien (${wl.eintraege.slice(0, 5).map((e) => e.symbol).join(", ")}${wl.eintraege.length > 5 ? " …" : ""}) · in dieser Sitzung analysiert: ${analysiert}` : "leer");
    }
  } catch (e) { z("Watchlist", "nicht verfügbar", "fehlt"); }
  try {
    const al = wzAlarmeLesen();
    if (al.beschaedigt) z("Alarme", "gespeicherter Stand beschädigt", "hinweis");
    else {
      const heuteAus = (al.protokoll || []).filter((p) => p && p.zeit && new Date(p.zeit).toDateString() === heute);
      z("Alarme", `${(al.regeln || []).length} Regel(n)` + (heuteAus.length ? ` · heute ausgelöst: ${heuteAus.length} (zuletzt ${heuteAus[0].text})` : " · heute nichts ausgelöst (nur geprüft, wenn „Alarme prüfen“ lief)"), heuteAus.length ? "hinweis" : "ok");
    }
  } catch (e) { z("Alarme", "nicht verfügbar", "fehlt"); }
  // Simulation (Paper-Kern, Spielgeld)
  if (SIM.dbFehler) z("Simulation", "Speicher nicht verfügbar", "fehlt");
  else if (!SIM.bereit) z("Simulation", "wird geladen …", "fehlt");
  else if (SIM.beschaedigt) z("Simulation", "gespeicherter Stand beschädigt", "hinweis");
  else if (!SIM.portfolio) z("Simulation", "noch kein Simulations-Portfolio");
  else {
    const p = SIM.portfolio, pos = Object.entries(p.positionen || {}).filter(([, x]) => x && x.menge > 0);
    const letzte = (p.ledger || []).filter((e) => e && e.zustand === "gefuellt").slice(-1)[0];
    z("Simulation", `Spielgeld ${simUsd(p.bargeld)} frei · ${pos.length} Position(en)${pos.length ? " (" + pos.map(([s]) => s).join(", ") + ")" : ""}` + (letzte ? ` · letzte Buchung ${simDatum(letzte.zeit)} ${letzte.seite === "kauf" ? "Kauf" : "Verkauf"} ${letzte.symbol}` : " · noch keine Buchung") + " · SIMULATION, kein Konto");
  }
  // Hinweise
  const schaden = [...SPEICHER_SCHADEN];
  if (schaden.length) z("Speicher", `${schaden.length} Bereich(e) mit beschädigtem Stand – unter „Daten auf diesem Gerät“ prüfen`, "hinweis");
  if (VERSION_HINWEISE.size) z("Version", [...VERSION_HINWEISE.values()].join(" "), "hinweis");
  const datum = new Date(jetzt).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const kopf = `${datum}, ${uhr(jetzt)} Uhr · ${zeilen.filter((x) => x.art === "hinweis").length || "keine"} Hinweis(e)`;
  return { kopf, zeilen, datum, text: "Dein Tag, " + datum + ". " + zeilen.map((x) => x.bereich + ": " + x.text + ".").join(" ") };
}
// Abendzusammenfassung (ab 11-06h): was heute erledigt wurde und was offen bleibt – nur lokale Daten
function abendDaten(jetzt = Date.now()) {
  const heute = new Date(jetzt).toDateString(), istHeute = (iso) => Boolean(iso) && new Date(iso).toDateString() === heute;
  const teile = [];
  const alle = window.aufgabenIntern ? window.aufgabenIntern.liste() : [];
  const erledigt = alle.filter((a) => (a.erledigt && istHeute(a.erledigtAm)) || istHeute(a.zuletztErledigt));
  const offen = alle.filter((a) => !a.erledigt), ueber = offen.filter((a) => a.faellig && new Date(a.faellig).getTime() <= jetzt);
  teile.push(`Aufgaben: heute erledigt ${erledigt.length}` + (erledigt.length ? ` (${erledigt.slice(0, 4).map((a) => a.titel).join(", ")})` : "") + ` · offen ${offen.length}` + (ueber.length ? ` · überfällig ${ueber.length}` : ""));
  if (typeof routinenFortschritt === "function") { const f = routinenFortschritt(jetzt); if (f.gesamt) teile.push(`Tägliche Routinen: ${f.erledigt} von ${f.gesamt}` + (f.offen.length ? ` – noch offen: ${f.offen.join(", ")}` : " – alle erledigt")); }
  if (typeof notizen !== "undefined") { const n = notizen.filter((x) => istHeute(x.geaendert)); if (n.length) teile.push(`Notizen heute: ${n.length}`); }
  const p = SIM.bereit && SIM.portfolio ? SIM.portfolio : null;
  const buchungen = p ? (p.ledger || []).filter((e) => e && e.zustand === "gefuellt" && istHeute(new Date(e.zeit).toISOString())).length : 0;
  if (p) teile.push(`Simulation: ${buchungen} Buchung(en) heute, Spielgeld ${simUsd(p.bargeld)} (SIMULATION)`);
  const morgen = new Date(new Date(jetzt).setHours(24, 0, 0, 0)), morgenEnde = morgen.getTime() + 86400000;
  const morgenFaellig = offen.filter((a) => a.faellig && new Date(a.faellig).getTime() >= morgen.getTime() && new Date(a.faellig).getTime() < morgenEnde);
  teile.push(morgenFaellig.length ? `Morgen fällig: ${morgenFaellig.slice(0, 4).map((a) => a.titel).join(", ")}` : "Morgen ist nichts fällig");
  return { teile, text: "Abendzusammenfassung. " + teile.join(". ") + "." };
}
// Wochenrückblick (ab 11-07e): letzte 7 Tage und kommende 7 Tage – nur lokale Daten, nichts geschätzt
function wocheDaten(jetzt = Date.now()) {
  const vor = jetzt - 7 * 86400000, nach = jetzt + 7 * 86400000;
  const inWoche = (iso) => { const t = iso ? new Date(iso).getTime() : NaN; return t > vor && t <= jetzt; };
  const teile = [];
  const alle = window.aufgabenIntern ? window.aufgabenIntern.liste() : [];
  const erledigt = alle.filter((a) => (a.erledigt && inWoche(a.erledigtAm)) || inWoche(a.zuletztErledigt));
  const offen = alle.filter((a) => !a.erledigt), ueber = offen.filter((a) => a.faellig && new Date(a.faellig).getTime() <= jetzt);
  const kommend = offen.filter((a) => a.faellig && new Date(a.faellig).getTime() > jetzt && new Date(a.faellig).getTime() <= nach);
  teile.push(`Aufgaben: in 7 Tagen erledigt ${erledigt.length} · offen ${offen.length}` + (ueber.length ? ` · überfällig ${ueber.length}` : "") + ` · in den nächsten 7 Tagen fällig ${kommend.length}`
    + (kommend.length ? ` (${kommend.slice().sort((x, y) => new Date(x.faellig) - new Date(y.faellig)).slice(0, 4).map((a) => a.titel).join(", ")})` : ""));
  if (typeof routinen !== "undefined" && typeof routineStatistik === "function") {
    const mit = routinen.filter((r) => Array.isArray(r.abschluesse) && r.abschluesse.length);
    const summe = mit.reduce((s, r) => s + routineStatistik(r, jetzt).letzte7, 0), verpasst = routinenVerpasst(jetzt);
    teile.push(mit.length ? `Routinen: ${summe} Abschlüsse in 7 Tagen` + (verpasst.length ? ` · verpasst: ${verpasst.map((v) => `${v.name} (${v.tage.length})`).join(", ")}` : "") : "Routinen: noch keine gemerkten Abschlüsse");
  }
  if (typeof notizen !== "undefined") teile.push(`Notizen: ${notizen.filter((n) => inWoche(n.geaendert)).length} in 7 Tagen geändert`);
  const p = SIM.bereit && SIM.portfolio ? SIM.portfolio : null;
  if (p) teile.push(`Simulation: ${(p.ledger || []).filter((e) => e && e.zustand === "gefuellt" && inWoche(new Date(e.zeit).toISOString())).length} Buchung(en) in 7 Tagen, Spielgeld ${simUsd(p.bargeld)} (SIMULATION)`);
  return { teile, text: "Wochenrückblick. " + teile.join(". ") + "." };
}
document.getElementById("heute-woche").addEventListener("click", () => {
  const a = wocheDaten();
  const box = document.getElementById("heute-abend-text");
  box.hidden = false;
  box.setAttribute("aria-label", "Wochenrückblick");
  box.replaceChildren(...a.teile.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  if (typeof lokalVorlesen === "function") lokalVorlesen(a.text);
});
// Benachrichtigungen (ab 11-06h): alle Hinweise an einer Stelle – aus „Mein Tag“ (überfällig, Alarme, Speicher, Version, Routinen)
function benachrichtigungen(d) { return d.zeilen.filter((x) => x.art === "hinweis").map((x) => ({ bereich: x.bereich, text: x.text })); }
function heuteZeigen() {
  const roh = tagesbriefingDaten();
  // ab 11-07g: Hinweiszentrale erfassen (vollständig), dann Bereiche/Ansicht nach den Einstellungen (app/28-hinweise.js)
  if (typeof hinweiseErfassen === "function") hinweiseErfassen(roh);
  const zeilen = typeof briefingFiltern === "function" ? briefingFiltern(roh.zeilen) : roh.zeilen;
  const d = { ...roh, zeilen, text: "Dein Tag, " + roh.datum + ". " + zeilen.map((x) => x.bereich + ": " + x.text + ".").join(" ") };
  const aus = typeof briefingEinstellungen === "function" ? briefingEinstellungen().hinweiseAus : [];
  const b = benachrichtigungen(roh).filter((x) => !aus.includes((typeof BEREICH_KATEGORIE !== "undefined" && BEREICH_KATEGORIE[x.bereich]) || "system"));
  const box = document.getElementById("heute-benachrichtigungen");
  if (box) box.replaceChildren(...(b.length ? b : [null]).map((x) => { const li = document.createElement("li"); li.textContent = x ? "⚠ " + x.bereich + ": " + x.text : "Keine Benachrichtigungen."; if (x) li.dataset.bereich = x.bereich; return li; }));
  document.getElementById("heute-kopf").textContent = d.kopf;
  document.getElementById("heute-liste").replaceChildren(...d.zeilen.map((x) => {
    const li = document.createElement("li");
    li.dataset.bereich = x.bereich;
    li.dataset.art = x.art;
    li.textContent = (x.art === "hinweis" ? "⚠ " : x.art === "fehlt" ? "– " : "● ") + x.bereich + ": " + x.text;
    return li;
  }));
  return d;
}
document.getElementById("heute-aktualisieren").addEventListener("click", heuteZeigen);
document.getElementById("heute-abend").addEventListener("click", () => {
  const a = abendDaten();
  const box = document.getElementById("heute-abend-text");
  box.hidden = false;
  box.setAttribute("aria-label", "Abendzusammenfassung");
  box.replaceChildren(...a.teile.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  if (typeof lokalVorlesen === "function") lokalVorlesen(a.text);
});
document.getElementById("heute-vorlesen").addEventListener("click", () => { const d = heuteZeigen(); if (typeof lokalVorlesen === "function") lokalVorlesen(d.text, true); });
setInterval(() => { if (document.visibilityState !== "hidden") heuteZeigen(); }, 60000);
// Fall (2): Kopie in localStorage und maßgeblicher Stand weichen ab. Neue Tabs schreiben die Kopie direkt nach dem Abschluss der
// Transaktion – eine Abweichung, die nach einer Wartezeit bei gleicher Revision noch besteht, stammt daher von einem älteren Tab.
function simAltVersionPruefen(warteMs = 1500) {
  const vergleich = () => (!SIM.bereit || SIM.dbFehler ? Promise.resolve(null) : simEintragLesen(SIMDB.id).then((r) => {
    if (r.fehler || !r.eintrag) return null;
    let ls = null;
    try { ls = localStorage.getItem(SIM.schluessel); } catch (e) { return null; }
    return ls === r.eintrag.text ? null : r.eintrag.rev;
  }));
  return vergleich().then((rev1) => (rev1 === null ? false : new Promise((ok) => setTimeout(ok, warteMs)).then(vergleich).then((rev2) => {
    if (rev2 === null || rev2 !== rev1) return false;
    versionHinweisSetzen("alt-speicher", "⚠ Ein Tab mit einer älteren JARVIS-Version (vor 11-06c) hat die Simulation im alten Browserspeicher geändert – diese Änderung gilt nicht und wird nicht übernommen. Bitte alle JARVIS-Tabs neu laden.");
    return true;
  })));
}
const simKlon = (p) => JSON.parse(JSON.stringify(p));
const SIM_BESCHAEDIGT = "Der gespeicherte Simulationsstand ist beschädigt – nichts wird überschrieben. „Simulations-Portfolio zurücksetzen“ ersetzt ihn ausdrücklich (vorher bei Bedarf „Sicherung exportieren“).";
const SIM_KONFLIKT = "Die Simulation wurde inzwischen in einem anderen Tab oder Fenster geändert. Der aktuelle Stand ist geladen";
// Warum gerade nicht geschrieben werden darf (null = darf)
function simSperrgrund() {
  if (SIM.dbFehler) return "Speicher der Simulation nicht verfügbar (" + SIM.dbFehler + ") – es wird nicht ersatzweise im Browserspeicher gebucht.";
  if (!SIM.bereit) return "Simulationsstand wird noch geladen – bitte gleich erneut versuchen.";
  return null;
}
// ---------- Paper-Automatik (ab 15a): sichtbare Zustände, Not-Aus, Zeitraum und Laufprotokoll um die bestehende Historische Simulation ----------
// Es gibt KEINE neuen Handelsregeln: Signale, Ordergröße, Grenzen und Annahmen kommen unverändert aus SIM (04-simulation.js) und PaperKern.replay
// (EMA-Kreuzung: Kauf bei Kreuzung nach oben, Verkauf der ganzen Position bei Kreuzung nach unten, Ausführung zur nächsten Eröffnung).
// Zustände: aus (nach dem Laden immer), laeuft, pausiert, gestoppt, fehler. Weiter geht es nur mit einem neuen Klick auf „Paper-Automatik starten“.
// Not-Aus (Nutzervorgabe 13.11.: „unbekannter Not-Aus verhindert weitere automatische Buchungen“): nur bei bestätigtem „aus“ (Worker-Status) startet
// bzw. läuft die Automatik; aktiv ODER unbekannt (ohne Worker) → kein Start, ein laufender Lauf stoppt vor dem nächsten Schritt. Manuelle Paper-Vorschläge unverändert.
const SIMAUTO = { zustand: "aus", grund: "", seit: null, protokoll: [], schluessel: "jarvis-paper-automatik-protokoll", max: 200, bisPos: null };
const SIMAUTO_TEXT = { aus: "Aus", laeuft: "Läuft", pausiert: "Pausiert", gestoppt: "Gestoppt", fehler: "Fehler" };
// ab 15b (Nutzerentscheidung 13.11. zu Nr. 29): eigener Simulations-Not-Aus für die lokale Spielgeld-Automatik – nach jedem Laden AKTIV, nur per
// Klick ausschaltbar, gilt nur für diese Simulation. Ein aktiver Worker-Not-Aus sperrt immer; ein unbekannter Worker-Zustand wird angezeigt,
// sperrt die rein lokale Simulation aber nicht, wenn der Simulations-Not-Aus ausdrücklich ausgeschaltet ist.
SIMAUTO.simNotaus = true;
function simAutoWorkerNotaus() {
  const n = typeof tradingZustand !== "undefined" && tradingZustand ? tradingZustand.notaus : null;
  return n === true ? "aktiv" : n === false ? "aus" : "unbekannt";
}
function simAutoNotaus() {
  if (simAutoWorkerNotaus() === "aktiv") return "aktiv";
  return SIMAUTO.simNotaus ? "sim-aktiv" : "aus";
}
function simAutoNotausGrund() {
  return simAutoNotaus() === "aktiv" ? "Not-Aus (Worker) aktiv" : "Simulations-Not-Aus aktiv (Standard nach jedem Laden) – zum Starten „Simulations-Not-Aus ausschalten“ klicken";
}
function simAutoSimNotausUmschalten() {
  SIMAUTO.simNotaus = !SIMAUTO.simNotaus;
  simAutoProtokoll({ art: "zustand", text: SIMAUTO.simNotaus ? "Simulations-Not-Aus aktiviert – keine weitere automatische Buchung" : "Simulations-Not-Aus von dir ausgeschaltet (nur diese Spielgeld-Simulation)" });
  simAutoZeigen();
}
function simAutoZeigen() {
  const ds = SIM.datensatz, n = simAutoNotaus(), z = SIMAUTO.zustand;
  const ende = ds ? Math.min(ds.kerzen.length, SIMAUTO.bisPos || ds.kerzen.length) : 0;
  simEl("sim-zustand").textContent = [
    `Paper-Automatik: ${SIMAUTO_TEXT[z] || "Fehler: unbekannter Zustand"}${SIMAUTO.seit ? " (seit " + SIMAUTO.seit.toLocaleTimeString("de-DE") + ")" : ""}${SIMAUTO.grund ? " – " + SIMAUTO.grund : ""}`,
    `Modus: ${simModus() === "jarvis" ? "JARVIS-Signale im Replay (Analyse + Entry-Timer + Exit-Planer) – " + (simKursart(ds) === "synthetisch" ? "kauft mit synthetischen Testkursen nach den bestehenden Regeln nicht" : "Kauf nur bei gültigem Signal; ohne SEC-Kennzahlen keine belastbare Einschätzung") : "automatische Paper-Demo mit EMA 5/20 (kein vollständig integrierter Trader-Skill)"} · Daten: ${SIM.datenStatus ? SIM.datenStatus.text : "werden geprüft …"}`,
    (simModus() === "jarvis" ? `Regel: JARVIS-Signale – Kauf nur bei Systemeinschätzung „Kaufkandidat“ UND Entry-Timer „jetzt“ (Kauf ${SIM.orderWert} USD); Verkauf der ganzen Position nur bei Stop, Zeit-Stop oder Ziel 2 des Exit-Planers (Teilverkäufe nicht implementiert) · Datenquelle: ${ds ? "Replay " + ds.name + " – " + SIM_KURSART_TEXT[simKursart(ds)] + ", simulierte Börsenzeit" : "–"}`
      : `Regel: Strategie EMA ${SIM.strategie.kurz}/${SIM.strategie.lang}-Kreuzung (Regelquelle: Simulationseinstellungen, Kauf ${SIM.orderWert} USD, Verkauf immer der ganzen Position – Teilverkäufe nicht implementiert) · Datenquelle: ${ds ? ds.name + " – " + SIM_KURSART_TEXT[simKursart(ds)] : "–"}`)
      + `${ds && z !== "aus" ? ` · Kerze ${SIM.pos} von ${ende} (${simDatum(ds.kerzen[Math.max(0, Math.min(SIM.pos, ds.kerzen.length) - 1)].t)})` : ""}`,
    (n === "aktiv" ? "Not-Aus (Worker): AKTIV – die Automatik startet nicht bzw. stoppt vor dem nächsten Schritt."
      : n === "sim-aktiv" ? "Simulations-Not-Aus: AKTIV – die Automatik startet nicht bzw. stoppt vor dem nächsten Schritt (nach jedem Laden aktiv; ausschalten per Knopf)."
      : "Simulations-Not-Aus: aus (von dir ausgeschaltet, gilt nur für diese Spielgeld-Simulation).")
      + " Worker-Not-Aus: " + ({ aktiv: "aktiv", aus: "aus (bestätigt)", unbekannt: "unbekannt (kein Worker verbunden) – schützt diese lokale Simulation nicht" })[simAutoWorkerNotaus()] + ".",
  ].join("\n");
  simEl("sim-abbruch").disabled = z !== "laeuft" && z !== "pausiert";
  // ab 14a: Kennzeichnung nach Datenart (synthetische Testkurse oder historische Kurse aus Datei)
  const kz = simEl("sim-kennzeichnung");
  if (kz) { const b = document.createElement("b"); const echt = ds && ds.synthetisch === false; const wk = simKursart(ds) === "worker"; b.textContent = wk ? "Paper-Trading – Spielgeld – historische Tageskurse über deinen Worker (Alpaca, Feed IEX; keine Live-Kurse)." : echt ? "Paper-Trading – Spielgeld – historische Kurse aus Datei (keine Live-Kurse)." : "Paper-Trading – Spielgeld – synthetische Daten."; kz.replaceChildren(b, wk ? " Der Bot spielt die über deinen Worker geladenen Tageskurse ab: keine Broker-Order, kein Echtgeld; IEX ist nur eine Börse, Kurse können vom Gesamtmarkt abweichen. Ergebnisse sagen nichts über Gewinnchancen. Er läuft nur, solange diese Seite offen ist." : echt ? " Der Bot spielt die Tageskurse der gewählten Datei ab: kein Broker, keine Order, kein Echtgeld; Kurse laut Datei, nicht gegen den Anbieter geprüft. Ergebnisse sagen nichts über Gewinnchancen. Er läuft nur, solange diese Seite offen ist." : " Der Bot handelt nur mit simulierten Testkursen im Browser: keine echten Kurse, kein Broker, keine Order, kein Echtgeld. Ergebnisse sagen nichts über Gewinnchancen. Er läuft nur, solange diese Seite offen ist."); }
  const k = simEl("sim-notaus");
  if (k) { k.textContent = SIMAUTO.simNotaus ? "Simulations-Not-Aus ausschalten" : "Simulations-Not-Aus aktivieren"; k.setAttribute("aria-pressed", String(!SIMAUTO.simNotaus)); }
  simStandZeigen();
  simStatusMarke();
  simBestaetigungPruefen();
  simDiagnoseZeigen();
}
// ab 14zc: gut sichtbarer Laufstatus aus denselben Zuständen wie die Zustandszeile (nur Anzeige): Läuft, Pausiert, Gestoppt, Fehler;
// sonst „Aus“ mit Grund – Datenfehler (keine gültigen Kurse), Not-Aus aktiv oder bereit (startet nur per Klick)
function simStatusMarke() {
  const el = simEl("sim-status-marke"); if (!el) return;
  const z = SIMAUTO.zustand, n = simAutoNotaus();
  const [art, text] = z === "laeuft" ? ["laeuft", "Läuft – bucht Paper-Trades automatisch ohne Einzelbestätigung"]
    : z === "pausiert" ? ["pausiert", "Pausiert – keine Buchung, fortsetzen mit „Paper-Automatik starten“"]
    : z === "gestoppt" ? ["gestoppt", "Gestoppt" + (SIMAUTO.grund ? " – " + SIMAUTO.grund : "")]
    : z === "fehler" ? ["fehler", "Fehler" + (SIMAUTO.grund ? " – " + SIMAUTO.grund : "")]
    : !SIM.datensatz || !SIM.datenStatus || !SIM.datenStatus.ok ? ["datenfehler", "Aus – Datenfehler oder keine gültigen Kurse, Start gesperrt"]
    : n === "aktiv" ? ["notaus", "Aus – Not-Aus des Workers aktiv, Start gesperrt"]
    : n === "sim-aktiv" ? ["notaus", "Aus – Simulations-Not-Aus aktiv, Start gesperrt"]
    : ["bereit", "Aus – bereit, startet nur nach Klick auf „Paper-Automatik starten“"];
  el.dataset.zustand = art; el.textContent = text;
}
// ab 14zd: Startbestätigung – vor dem Start fasst JARVIS Symbol, Datenquelle, Zeitraum, Strategie, Gebühren und Grenzen zusammen; gestartet wird
// nur, wenn „Startkonfiguration geprüft“ für GENAU diese Konfiguration angehakt ist. Jede Änderung (Symbol, Zeitraum, Datenquelle, Kursdatei,
// SEC-Datei, Signalquelle, Strategie, Grenzen) setzt die Bestätigung zurück; sie wird nie gespeichert (nach dem Neuladen leer).
// Ändert keine Grenze und keine Handelsregel.
SIM.bestaetigt = null;
function simKonfigSignatur() {
  const ds = SIM.datensatz, s = SIM.secDatei;
  return JSON.stringify({ ds: ds ? [ds.name, ds.symbol, ds.kerzen.length, ds.kerzen[ds.kerzen.length - 1].t, ds.quelle || ""] : null, von: simEl("sim-von").value, bis: simEl("sim-bis").value,
    modus: simModus(), strategie: SIM.strategie, orderWert: SIM.orderWert, annahmen: SIM.annahmen, limits: SIM.limits, sec: ds && ds.synthetisch === false && s ? [s.name, s.cik, s.symbol, s.filedBis] : null });
}
function simStartZusammenfassung() {
  const ds = SIM.datensatz, f = SIM.limits.frequenz;
  if (!ds) return "Startkonfiguration: keine gültigen Kurse – nichts zu bestätigen.";
  const von = simEl("sim-von").value, bis = simEl("sim-bis").value;
  return `Startkonfiguration: Symbol ${ds.symbol} · Datenquelle ${ds.name} (${SIM_KURSART_TEXT[simKursart(ds)]}) · Zeitraum ${von || simDatum(ds.kerzen[0].t)} bis ${bis || simDatum(ds.kerzen[ds.kerzen.length - 1].t)}`
    + ` · Strategie ${simModus() === "jarvis" ? "JARVIS-Signale (Kaufkandidat + Entry-Timer „jetzt“, Exit-Planer)" : `EMA ${SIM.strategie.kurz}/${SIM.strategie.lang}`}, Kauf ${SIM.orderWert} USD`
    + ` · Gebühr ${SIM.annahmen.gebuehrPct} %, Slippage ${SIM.annahmen.slippagePct} % · Grenzen: ${SIM.limits.maxOrderWert} USD je Order, ${SIM.limits.maxPositionen} Positionen, Tagesverlust ${SIM.limits.maxTagesverlust} USD, ${f.max} Orders in ${Math.round(f.fensterMs / 86400000)} Tagen`
    + (ds.synthetisch === false ? ` · ${simSecZeile(ds)}` : "") + " · Käufe und Verkäufe werden nach dem Start automatisch ohne Einzelbestätigung gebucht (Spielgeld).";
}
function simBestaetigungPruefen() {
  const cb = simEl("sim-bestaetigung"), z = simEl("sim-start-zusammenfassung"); if (!cb || !z) return;
  z.textContent = simStartZusammenfassung();
  if (SIM.bestaetigt && SIM.bestaetigt !== simKonfigSignatur()) { SIM.bestaetigt = null; cb.checked = false; z.textContent += " · Bestätigung zurückgesetzt: Konfiguration geändert – bitte erneut prüfen."; }
  if (!SIM.bestaetigt && cb.checked) cb.checked = false;
  // während eines Laufs gesperrt (Zustand „läuft“ wird vor dem Takt gesetzt, daher nicht nur SIM.uhr)
  cb.disabled = !SIM.datensatz || Boolean(SIM.uhr) || SIMAUTO.zustand === "laeuft";
}
// ab 14zd: Diagnose – Ursache und nächster Schritt je Baustein; ohne Zugangscodes, Schlüssel, vollständige SEC-Dateien oder lokale Pfade.
// worker: Ergebnis der letzten ausdrücklichen Prüfung (Knopf), sonst nur „verbunden/nicht verbunden“ ohne Netzabfrage.
SIM.diagnoseWorker = null;
function simDiagnose() {
  const ds = SIM.datensatz, s = SIM.secDatei, n = simAutoNotaus(), wn = simAutoWorkerNotaus();
  const verb = typeof verbunden === "function" && verbunden();
  const fehler = SIMAUTO.protokoll.slice().reverse().find((p) => p.art === "abgelehnt" || p.art === "unklar" || /✖/.test(p.text || ""));
  const ergebnis = (simEl("sim-ergebnis") || {}).textContent || "";
  const ende = ds ? Math.min(ds.kerzen.length, SIMAUTO.bisPos || ds.kerzen.length) : 0;
  return [
    ["Kursdaten", SIM.datenStatus && SIM.datenStatus.ok ? `in Ordnung – ${SIM.datenStatus.text}` : `nicht startbereit – ${SIM.datenStatus ? SIM.datenStatus.text : "noch nicht geprüft"}`, SIM.datenStatus && SIM.datenStatus.ok ? null : "Datenquelle wählen bzw. Kursdatei oder Worker-Kurse laden."],
    ["SEC-Kennzahlen", !ds || ds.synthetisch !== false ? "nicht verwendet (synthetische Testkurse)" : !s ? "keine SEC-Datei – JARVIS-Signale ohne Kernkennzahlen, kein Kauf möglich" : s.symbol !== ds.symbol ? `Datei gehört zu ${s.symbol}, Kurse zu ${ds.symbol} – nicht verwendet` : `${s.firma} (CIK ${s.cik}), eingereicht ${s.filedVon} bis ${s.filedBis}, je Kerze nur bis zum Kerzentag`, !ds || ds.synthetisch !== false || (s && s.symbol === ds.symbol) ? null : "companyfacts-Datei des Unternehmens unter „SEC-Kennzahlen“ wählen."],
    ["Worker", !verb ? "nicht verbunden – die lokale Simulation braucht ihn nicht; echte Kurse nur per Kursdatei" : SIM.diagnoseWorker ? SIM.diagnoseWorker : "verbunden (noch nicht geprüft)", !verb ? "Für Worker-Kurse im Cockpit die Verbindung einrichten." : SIM.diagnoseWorker ? null : "„Diagnose aktualisieren“ prüft die Erreichbarkeit."],
    ["Not-Aus", n === "aus" ? `Simulations-Not-Aus aus; Worker-Not-Aus ${wn}` : n === "aktiv" ? "Not-Aus des Workers AKTIV – keine Buchung" : "Simulations-Not-Aus AKTIV (Standard nach jedem Laden) – keine Buchung", n === "aus" ? null : n === "aktiv" ? "Not-Aus nur nach bewusster Entscheidung im Cockpit aufheben." : "„Simulations-Not-Aus ausschalten“ klicken, wenn du starten willst."],
    ["Startbestätigung", SIM.bestaetigt && SIM.bestaetigt === simKonfigSignatur() ? "gültig für die angezeigte Konfiguration" : "fehlt oder veraltet", SIM.bestaetigt ? null : "Zusammenfassung prüfen und „Startkonfiguration geprüft“ anhaken."],
    ["Letzter Replay-Schritt", ds && SIM.pos ? `Kerze ${SIM.pos} von ${ende} (${simDatum(ds.kerzen[Math.max(0, Math.min(SIM.pos, ds.kerzen.length) - 1)].t)}) · Zustand ${SIMAUTO_TEXT[SIMAUTO.zustand] || SIMAUTO.zustand}` : `noch kein Schritt · Zustand ${SIMAUTO_TEXT[SIMAUTO.zustand] || SIMAUTO.zustand}`, null],
    ["Letzte Fehlermeldung", fehler ? simAutoProtokollText(fehler).slice(0, 240) : /^✖/.test(ergebnis) ? ergebnis.slice(0, 240) : "keine", fehler || /^✖/.test(ergebnis) ? "Grund lesen; Daten, Not-Aus oder Grenzen prüfen und neu starten." : null],
  ];
}
function simDiagnoseZeigen() {
  const el = simEl("sim-diagnose"); if (!el) return;
  el.replaceChildren(...simDiagnose().map(([was, text, schritt]) => Object.assign(document.createElement("li"), { textContent: `${was}: ${text}${schritt ? " · Nächster Schritt: " + schritt : ""}` })));
}
async function simDiagnoseWorkerPruefen() {
  if (typeof verbunden !== "function" || !verbunden()) { SIM.diagnoseWorker = null; simDiagnoseZeigen(); return; }
  const knopf = simEl("sim-diagnose-pruefen"); if (knopf.disabled) return; knopf.disabled = true;
  SIM.diagnoseWorker = "wird geprüft …"; simDiagnoseZeigen();
  try { await workerAnfrage("/status", { method: "GET" }); SIM.diagnoseWorker = `erreichbar (geprüft ${new Date().toLocaleTimeString("de-DE")})`; }
  catch (e) { SIM.diagnoseWorker = `nicht erreichbar – ${String((e && e.message) || e).replace(/https?:\/\/\S+/g, "[Adresse]").slice(0, 160)}`; }
  finally { knopf.disabled = false; simDiagnoseZeigen(); }
}
simEl("sim-diagnose-pruefen").addEventListener("click", simDiagnoseWorkerPruefen);
simEl("sim-bestaetigung").addEventListener("change", (e) => { SIM.bestaetigt = e.target.checked && SIM.datensatz ? simKonfigSignatur() : null; simAutoZeigen(); });
for (const id of ["sim-von", "sim-bis", "sim-datei-symbol", "sim-signalquelle"]) simEl(id).addEventListener("change", () => simAutoZeigen());
// Stand der Spielgeld-Simulation (ab 15b): Bargeld, Positionen mit letztem Kurs des Datensatzes, realisiert (Ledger) und nicht realisiert
function simStandZeigen() {
  const el = simEl("sim-stand"); if (!el) return;
  const p = SIM.portfolio, ds = SIM.datensatz;
  if (!p) { el.textContent = SIM.bereit ? `Stand (Spielgeld): Bargeld ${simUsd(SIM.startkapital)} · Positionen: keine · realisiert ${simUsd(0)} · nicht realisiert ${simUsd(0)} · Bot: ${SIMAUTO_TEXT[SIMAUTO.zustand] || SIMAUTO.zustand} (noch keine Buchung)` : "Stand (Spielgeld): wird geladen …"; return; }
  const kursDs = ds && ds.kerzen.length ? ds.kerzen[Math.max(0, Math.min(SIM.pos || 0, ds.kerzen.length) - 1)].c : null;
  const realisiert = p.ledger.filter((e) => e.zustand === "gefuellt" && e.seite === "verkauf" && Number.isFinite(e.ergebnis)).reduce((s, e) => s + e.ergebnis, 0);
  let offen = 0, offenBekannt = true;
  const pos = Object.entries(p.positionen || {}).map(([sym, x]) => {
    const kurs = ds && sym === ds.symbol ? kursDs : null;
    if (kurs === null) { offenBekannt = false; return `${sym} ${x.menge.toLocaleString("de-DE")} Stück, Einstand ${x.einstand.toLocaleString("de-DE", { maximumFractionDigits: 4 })} (Kurs im Datensatz unbekannt)`; }
    const nr = (kurs - x.einstand) * x.menge; offen += nr;
    return `${sym} ${x.menge.toLocaleString("de-DE")} Stück, Einstand ${x.einstand.toLocaleString("de-DE", { maximumFractionDigits: 4 })}, letzter ${simKursart(ds) === "worker" ? "Kurs laut Worker (Alpaca)" : ds.synthetisch === false ? "Kurs laut Datei" : "synthetischer Kurs"} ${kurs.toLocaleString("de-DE")}, nicht realisiert ${simUsd(nr)}`;
  });
  el.textContent = `Stand (Spielgeld): Bargeld ${simUsd(p.bargeld)} · Positionen: ${pos.length ? pos.join("; ") : "keine"} · realisiert ${simUsd(realisiert)} · nicht realisiert ${pos.length ? (offenBekannt ? simUsd(offen) : "teilweise unbekannt") : simUsd(0)} · Bot: ${SIMAUTO_TEXT[SIMAUTO.zustand] || SIMAUTO.zustand}`;
}
function simAutoZustand(z, grund) { SIMAUTO.zustand = z; SIMAUTO.grund = grund || ""; SIMAUTO.seit = new Date(); simAutoZeigen(); }
function simAutoProtokoll(eintrag) {
  SIMAUTO.protokoll.push({ zeit: new Date().toISOString(), ...eintrag });
  SIMAUTO.protokoll = SIMAUTO.protokoll.slice(-SIMAUTO.max);
  try { localStorage.setItem(SIMAUTO.schluessel, JSON.stringify(SIMAUTO.protokoll)); } catch (e) { /* nur Anzeige */ }
  simAutoProtokollZeigen();
}
function simAutoProtokollText(p) {
  const zeit = new Date(p.zeit).toLocaleTimeString("de-DE");
  const signal = p.seite === "kauf" ? `Signal: EMA ${SIM.strategie.kurz} kreuzt EMA ${SIM.strategie.lang} nach oben → Kauf ${SIM.orderWert} USD` : `Signal: EMA ${SIM.strategie.kurz} kreuzt EMA ${SIM.strategie.lang} nach unten → Verkauf der Position`;
  const sig = p.signal || signal;
  const z2 = (x) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const echt = p.kursart === "datei" || p.kursart === "worker", kWort = echt ? "Kerze" : "Testkerze", dWort = echt ? "Datum" : "Testdatum", art = SIM_KURSART_TEXT[p.kursart] || SIM_KURSART_TEXT.synthetisch;
  const emaText = Number.isFinite(p.ema_kurz) && Number.isFinite(p.ema_lang) ? ` · Kurs am Signal: Schluss ${z2(p.schluss)} (${kWort} ${p.signal_kerze}, ${dWort} ${p.signal_datum}), EMA ${SIM.strategie.kurz} ${z2(p.ema_kurz)} ${p.seite === "kauf" ? ">" : "<"} EMA ${SIM.strategie.lang} ${z2(p.ema_lang)}` : "";
  if (p.art === "ausgefuehrt") return `${zeit} · ausgeführt (${sig}): ${p.seite === "kauf" ? "KAUF" : "VERKAUF"} ${p.symbol} ${p.menge.toLocaleString("de-DE")} Stück zu ${p.preis.toLocaleString("de-DE", { maximumFractionDigits: 4 })} (Eröffnung ${kWort} ${p.kerze})${emaText} · Betrag ${z2(p.volumen)} USD + Gebühr ${z2(p.gebuehr)} USD${p.seite === "verkauf" && Number.isFinite(p.ergebnis) ? " · Ergebnis " + z2(p.ergebnis) + " USD (nach Gebühren)" : ""} · Ledger ${p.trade_id} · SIMULATION, ${art}${(() => { const ds = SIM.datensatz, k = ds && ds.kerzen && Number.isInteger(p.kerze) ? ds.kerzen[p.kerze - 1] : null; return k ? ` · Kurszeit ${simDatum(k.t)} (Eröffnung)` : ""; })()} · vor der Buchung geprüft: Not-Aus aus, Grenzen und Risikoprüfung des Paper-Kerns eingehalten`;
  if (p.art === "abgelehnt") return `${zeit} · abgelehnt (${sig}): ${p.seite === "kauf" ? "KAUF" : "VERKAUF"} ${p.symbol} (Kerze ${p.kerze}) – ${p.grund} · Ledger ${p.trade_id} · nichts gebucht`;
  if (p.art === "unklar") return `${zeit} · unklar: ${p.seite === "kauf" ? "KAUF" : "VERKAUF"} ${p.symbol} (Kerze ${p.kerze}) – Ausführung nicht bestätigt · Ledger ${p.trade_id}`;
  if (p.art === "kein-signal") return `${zeit} · kein Signal: ${kWort}n ${p.von} bis ${p.bis} (${art}) verarbeitet, keine EMA-Kreuzung mit ausführbarer Order`;
  return `${zeit} · ${p.text}`;
}
function simAutoProtokollZeigen() {
  const liste = simEl("sim-protokoll");
  liste.replaceChildren(...(SIMAUTO.protokoll.length ? SIMAUTO.protokoll.slice().reverse().slice(0, 100) : [null]).map((p) => {
    const li = document.createElement("li");
    li.textContent = p ? simAutoProtokollText(p) : "Noch kein Lauf.";
    if (p) li.dataset.art = p.art;
    if (p && p.trade_id) li.dataset.tradeId = p.trade_id;
    return li;
  }));
}
function simAutoProtokollLaden() {
  try { const d = JSON.parse(localStorage.getItem(SIMAUTO.schluessel) || "[]"); SIMAUTO.protokoll = Array.isArray(d) ? d.filter((p) => p && typeof p.zeit === "string" && typeof p.art === "string").slice(-SIMAUTO.max) : []; }
  catch (e) { SIMAUTO.protokoll = []; }
  simAutoProtokollZeigen();
}
// neue Ledger-Einträge eines Schritts ins Protokoll; ohne neuen Eintrag: „kein Signal“ für die verarbeiteten Kerzen
// ab 13y: Kurs und EMA-Werte der Signalkerze (gleiche EMA wie PaperKern.replay; die EMA an Kerze i hängt nur von den Kerzen bis i ab)
function simAutoEmaAm(ds, signalZeit) {
  const T = window.AktienTechnik, si = ds.kerzen.findIndex((k) => k.t + 86400000 === signalZeit);
  if (!T || si < 0) return {};
  if (!SIMAUTO.ema || SIMAUTO.ema.name !== ds.name || SIMAUTO.ema.n !== ds.kerzen.length) { const c = ds.kerzen.map((k) => k.c); SIMAUTO.ema = { name: ds.name, n: ds.kerzen.length, kurz: T.ema(c, SIM.strategie.kurz), lang: T.ema(c, SIM.strategie.lang) }; }
  return { signal_kerze: si + 1, signal_datum: simDatum(ds.kerzen[si].t), schluss: ds.kerzen[si].c, ema_kurz: SIMAUTO.ema.kurz[si], ema_lang: SIMAUTO.ema.lang[si] };
}
function simAutoSchrittProtokoll(vorher, ds, posAlt, posNeu) {
  const neu = (SIM.portfolio && SIM.portfolio.ledger ? SIM.portfolio.ledger.slice(vorher) : []);
  const kerzeNr = (t) => ds.kerzen.findIndex((k) => k.t === t) + 1;
  for (const e of neu) {
    if (e.zustand === "gefuellt") simAutoProtokoll({ art: "ausgefuehrt", kursart: simKursart(ds), seite: e.seite, symbol: e.symbol, menge: e.menge, preis: e.preis, volumen: e.volumen, gebuehr: e.gebuehr, ergebnis: e.ergebnis, trade_id: e.trade_id, kerze: kerzeNr(e.zeit), ...simAutoEmaAm(ds, e.signal_zeit) });
    else if (e.zustand === "unklar") simAutoProtokoll({ art: "unklar", seite: e.seite, symbol: e.symbol, trade_id: e.trade_id, kerze: kerzeNr(e.zeit) });
    else simAutoProtokoll({ art: "abgelehnt", seite: e.seite, symbol: e.symbol, trade_id: e.trade_id, kerze: kerzeNr(e.zeit), grund: e.grund || (e.risiko && e.risiko.gruende && e.risiko.gruende.join("; ")) || "vom Paper-Kern abgelehnt (" + e.zustand + ")" });
  }
  if (!neu.length) simAutoProtokoll({ art: "kein-signal", kursart: simKursart(ds), von: posAlt + 1, bis: posNeu });
}
function simStoppen(grund, zustand) {
  clearInterval(SIM.uhr);
  SIM.uhr = null;
  simEl("sim-stopp").disabled = true;
  simEl("sim-datensatz").disabled = false;
  if (simEl("sim-signalquelle")) simEl("sim-signalquelle").disabled = false;
  simVorschau();
  if (grund) simEl("sim-ergebnis").textContent = grund + "\n" + simEl("sim-ergebnis").textContent.replace(/^(Angehalten|Fertig|Gestoppt)[^\n]*\n/, "");
  // ohne ausdrücklichen Zustand (z. B. Zurücksetzen, Wiederherstellen): ein laufender oder pausierter Lauf gilt als gestoppt – nie weiter „Läuft“
  const z = zustand || (SIMAUTO.zustand === "laeuft" || SIMAUTO.zustand === "pausiert" ? "gestoppt" : null);
  const text = String(grund || (zustand ? "" : "durch einen anderen Vorgang der Simulation beendet")).split("\n")[0];
  if (z) { simAutoZustand(z, text); simAutoProtokoll({ art: "zustand", text: `${SIMAUTO_TEXT[z]}: ${text}` }); }
}
// ab 11-06c: jeder Schritt schreibt bedingt in IndexedDB; solange ein Schritt schreibt, wird der nächste Takt übersprungen
function simSchritt() {
  if (SIM.arbeit) return SIM.arbeit;
  if (SIMAUTO.zustand !== "laeuft") { if (SIM.uhr) simStoppen(); return Promise.resolve(); }
  if (simAutoNotaus() !== "aus") { simStoppen("Gestoppt: " + simAutoNotausGrund() + " – keine weitere Paper-Buchung. Neuer Lauf nur über erneuten Start.", "gestoppt"); return Promise.resolve(); }
  const ds = SIM.datensatz, ende = Math.min(ds.kerzen.length, SIMAUTO.bisPos || ds.kerzen.length);
  const posAlt = SIM.pos, pos = Math.min(ende, SIM.pos + SIM.schritt);
  const vorher = SIM.portfolio && SIM.portfolio.ledger ? SIM.portfolio.ledger.length : 0;
  const r = PaperKern.replay({ ...ds, kerzen: ds.kerzen.slice(0, pos) }, simOptionen(), SIM.portfolio ? simKlon(SIM.portfolio) : SIM.portfolio);
  if (r.fehler) { simStoppen("✖ Simulation pausiert: " + r.fehler + " – Kursdaten ungültig, nichts gebucht.", "pausiert"); simEl("sim-ergebnis").textContent = "✖ Simulation gestoppt: " + r.fehler + " – nichts gebucht. Nächster Schritt: anderen Testdatensatz wählen oder die Seite neu laden."; return Promise.resolve(); }
  SIM.arbeit = simSchreiben(JSON.stringify(r.portfolio)).then((s) => {
    if (s.konflikt) { simStoppen("✖ Simulation angehalten: " + SIM_KONFLIKT + " – bitte erneut starten.", "gestoppt"); simEl("sim-ergebnis").textContent = "✖ Simulation angehalten: " + SIM_KONFLIKT + " – bitte erneut starten."; return; }
    if (s.fehler) { simStoppen("✖ Simulation angehalten: Speichern gescheitert (" + s.fehler + ") – der gespeicherte Stand ist unverändert.", "fehler"); simEl("sim-ergebnis").textContent = "✖ Simulation angehalten: Speichern gescheitert (" + s.fehler + ") – der gespeicherte Stand ist unverändert."; return; }
    SIM.pos = pos;
    simAutoSchrittProtokoll(vorher, ds, posAlt, pos);
    simAutoZeigen();
    // inzwischen angehalten: Schritt ist gespeichert, die Meldung „Angehalten …“ bleibt stehen
    if (!SIM.uhr) { simLedgerZeigen(); return; }
    simAnzeigen(r.bericht);
    if (SIM.pos >= ende) simStoppen(ende < ds.kerzen.length ? `Fertig – Zeitraum bis ${simDatum(ds.kerzen[ende - 1].t)} abgespielt.` : (ds.synthetisch === false ? "Fertig – Kursdatei vollständig abgespielt." : "Fertig – Testdatensatz vollständig abgespielt."), "aus");
  }).finally(() => { SIM.arbeit = null; });
  return SIM.arbeit;
}
function simStarten() {
  if (SIM.uhr || !simVorschau()) return;
  const sperre = simSperrgrund();
  if (sperre) { simEl("sim-ergebnis").textContent = "✖ Simulation nicht gestartet: " + sperre; simAutoZustand("fehler", sperre); return; }
  if (SIM.beschaedigt) { simEl("sim-ergebnis").textContent = "✖ Simulation nicht gestartet: " + SIM_BESCHAEDIGT; simAutoZustand("fehler", "gespeicherter Stand beschädigt"); return; }
  if (simAutoNotaus() !== "aus") { simEl("sim-ergebnis").textContent = "✖ Paper-Automatik nicht gestartet: " + simAutoNotausGrund() + "."; simAutoZustand("gestoppt", (simAutoNotaus() === "aktiv" ? "Not-Aus (Worker) aktiv" : "Simulations-Not-Aus aktiv") + " – nicht gestartet"); simEl("sim-notaus").focus(); return; }
  // ab 14zd: Startbestätigung für genau diese Konfiguration (nach Not-Aus- und Datenprüfung – deren Gründe bleiben vorrangig)
  simBestaetigungPruefen();
  if (!SIM.bestaetigt || SIM.bestaetigt !== simKonfigSignatur()) { simEl("sim-ergebnis").textContent = "✖ Paper-Automatik nicht gestartet: Startkonfiguration nicht bestätigt – Zusammenfassung prüfen und „Startkonfiguration geprüft“ anhaken."; simAutoZustand("gestoppt", "Startkonfiguration nicht bestätigt – nicht gestartet"); simEl("sim-bestaetigung").focus(); return; }
  if (!SIM.portfolio) SIM.portfolio = PaperKern.portfolioNeu({ startkapital: SIM.startkapital });
  const ds = SIM.datensatz;
  // Zeitraum (optional): Ende begrenzt die Verarbeitung; Beginn nur vor dem ersten Lauf dieses Datensatzes – Kerzen davor dienen nur dem Vorlauf der EMA
  const vonT = Date.parse(simEl("sim-von").value + "T00:00:00Z"), bisT = Date.parse(simEl("sim-bis").value + "T23:59:59Z");
  SIMAUTO.bisPos = Number.isFinite(bisT) ? ds.kerzen.filter((k) => k.t <= bisT).length : null;
  if (SIMAUTO.bisPos === 0) { simEl("sim-ergebnis").textContent = "✖ Nicht gestartet: Das Ende liegt vor der ersten Kerze des Testdatensatzes."; return; }
  if (Number.isFinite(vonT) && Number.isFinite(bisT) && vonT > bisT) { simEl("sim-ergebnis").textContent = "✖ Nicht gestartet: Der Beginn liegt nach dem Ende."; return; }
  if (simModus() === "jarvis") {
    // ab 15b: JARVIS-Signale – eigener abgespielter Stand; Beginn frühestens ab der Kerze, ab der der Entry-Timer einen Trend prüfen kann
    const B = window.AktienSignalBot;
    if (!B) { simEl("sim-ergebnis").textContent = "✖ Nicht gestartet: Signal-Modul nicht geladen."; return; }
    const bisJ = SIM.portfolio.abgespielt && SIM.portfolio.abgespielt[simSignalSchluessel(ds)];
    let start = Number.isFinite(bisJ) ? ds.kerzen.filter((k) => k.t <= bisJ).length : B.MIN_KERZEN - 1;
    if (!Number.isFinite(bisJ) && Number.isFinite(vonT)) start = Math.max(start, ds.kerzen.filter((k) => k.t < vonT).length);
    const letzte = Math.min(ds.kerzen.length, SIMAUTO.bisPos || ds.kerzen.length) - 1;
    if (start >= letzte) { simEl("sim-ergebnis").textContent = Number.isFinite(bisJ) ? "JARVIS-Signale für diesen Datensatz bis zum gewählten Ende schon abgespielt – späteres Ende wählen oder zurücksetzen." : "Zu wenige Kerzen bis zum gewählten Ende (der Entry-Timer braucht 200 Kerzen Vorlauf)."; return; }
    SIM.pos = start;
    simEl("sim-start").disabled = true; simEl("sim-stopp").disabled = false; simEl("sim-datensatz").disabled = true; simEl("sim-signalquelle").disabled = true;
    simAutoZustand("laeuft", "gestartet durch dich");
    simAutoProtokoll({ art: "start", text: `Start JARVIS-Signale: ${ds.name} (Replay, simulierte Kurse), Analyse + Entry-Timer + Exit-Planer, Kerzen ${start + 2} bis ${letzte + 1}, Kauf ${SIM.orderWert} USD, Not-Aus ${simAutoNotaus()} · ${B.ZEITHINWEIS}` });
    simEl("sim-stopp").focus();
    SIM.uhr = setInterval(simSignalSchritt, SIM.taktMs);
    simSignalSchritt();
    return;
  }
  const bis = SIM.portfolio.abgespielt && SIM.portfolio.abgespielt[ds.name];
  let vorlauf = null;
  if (!Number.isFinite(bis) && Number.isFinite(vonT)) { const vor = ds.kerzen.filter((k) => k.t < vonT); if (vor.length) { vorlauf = vor[vor.length - 1].t; SIM.portfolio = { ...simKlon(SIM.portfolio), abgespielt: { ...(SIM.portfolio.abgespielt || {}), [ds.name]: vorlauf } }; } }
  const bisJetzt = SIM.portfolio.abgespielt && SIM.portfolio.abgespielt[ds.name];
  SIM.pos = Number.isFinite(bisJetzt) ? ds.kerzen.filter((k) => k.t <= bisJetzt).length : Math.min(ds.kerzen.length, SIM.strategie.lang);
  const ende = Math.min(ds.kerzen.length, SIMAUTO.bisPos || ds.kerzen.length);
  if (SIM.pos >= ende) { simEl("sim-ergebnis").textContent = SIM.pos >= ds.kerzen.length ? "Dieser Testdatensatz ist schon vollständig abgespielt. Für einen neuen Lauf das Simulations-Portfolio zurücksetzen." : "Bis zum gewählten Ende ist schon alles abgespielt – ein späteres Ende wählen."; return; }
  simEl("sim-start").disabled = true;
  simEl("sim-stopp").disabled = false;
  simEl("sim-datensatz").disabled = true;
  simEl("sim-signalquelle").disabled = true;
  simAutoZustand("laeuft", "gestartet durch dich");
  simAutoProtokoll({ art: "start", text: `Start: ${ds.name} (${simKursart(ds) === "synthetisch" ? "synthetisch" : SIM_KURSART_TEXT[simKursart(ds)]}), EMA ${SIM.strategie.kurz}/${SIM.strategie.lang}, ab Kerze ${SIM.pos + 1}${vorlauf ? " (Beginn " + simEl("sim-von").value + ")" : ""} bis ${ende}, Not-Aus ${simAutoNotaus()}` });
  simEl("sim-stopp").focus();
  SIM.uhr = setInterval(simSchritt, SIM.taktMs);
  simSchritt();
}
// ---------- Signalquelle „JARVIS-Signale“ (ab 15b): Analyse + Entry-Timer + Exit-Planer im Replay (aktien/signal-bot.js) ----------
// Je Takt genau EINE Kerze: Signale bewerten (async), dann – nur wenn die Automatik noch läuft und der Not-Aus „aus“ ist – über den
// gemeinsamen Paper-Pfad (PaperKern.orderAusfuehren mit SIM-Grenzen und -Annahmen) buchen und mit simSchreiben speichern.
// Verarbeitete Kerzen stehen in portfolio.abgespielt["JARVIS:<Datensatz>"] und werden nie erneut bewertet oder gebucht.
function simModus() { const s = simEl("sim-signalquelle"); return s && s.value === "jarvis" ? "jarvis" : "ema"; }
function simSignalSchluessel(ds) { return "JARVIS:" + ds.name; }
// ab 15c: SEC-Stand eines Replay-Schritts für das Protokoll (nur Kursdatei)
function simSecKurz(s) {
  if (!s) return "SEC: keine Datei (Kernkennzahlen fehlen)";
  return `SEC (eingereicht bis ${s.bis}): ${s.quartal ? "Quartal bis " + s.quartal : "noch keine verwertbaren Quartalswerte"}`;
}
SIMAUTO.ziele = {};
function simSignalSchritt() {
  if (SIM.arbeit) return SIM.arbeit;
  if (SIMAUTO.zustand !== "laeuft") { if (SIM.uhr) simStoppen(); return Promise.resolve(); }
  if (simAutoNotaus() !== "aus") { simStoppen("Gestoppt: " + simAutoNotausGrund() + " – keine weitere Paper-Buchung. Neuer Lauf nur über erneuten Start.", "gestoppt"); return Promise.resolve(); }
  const ds = SIM.datensatz, B = window.AktienSignalBot, letzte = Math.min(ds.kerzen.length, SIMAUTO.bisPos || ds.kerzen.length) - 1, i = SIM.pos;
  if (!B) { simStoppen("✖ Paper-Automatik: Signal-Modul nicht geladen – nichts gebucht.", "fehler"); return Promise.resolve(); }
  if (i >= letzte) { simStoppen("Fertig – Replay der JARVIS-Signale abgespielt.", "aus"); return Promise.resolve(); }
  const p0 = SIM.portfolio ? simKlon(SIM.portfolio) : PaperKern.portfolioNeu({ startkapital: SIM.startkapital });
  const pos = p0.positionen && p0.positionen[ds.symbol];
  const kauf = pos ? p0.ledger.slice().reverse().find((e) => e.symbol === ds.symbol && e.seite === "kauf" && e.zustand === "gefuellt") : null;
  const zielKey = ds.symbol + "@" + (kauf ? kauf.trade_id : "");
  const position = pos ? { menge: pos.menge, einstand: pos.einstand, seit: kauf ? kauf.zeit : ds.kerzen[0].t, erledigteZiele: SIMAUTO.ziele[zielKey] || [] } : null;
  const datum = simDatum(ds.kerzen[i + 1].t);
  SIM.arbeit = B.bewerten({ ds, i, position, einschaetzen: typeof einschaetzungBerechnen === "function" ? einschaetzungBerechnen : null, optionen: { ausreisser: SIM.ausreisser } }).then((b) => {
    // während der Bewertung pausiert oder gestoppt: nichts mehr buchen (auch keine schon berechnete Entscheidung)
    if (SIMAUTO.zustand !== "laeuft" || !SIM.uhr) return;
    if (b.fehler) { simStoppen("✖ Paper-Automatik pausiert: " + b.fehler, "pausiert"); return; }
    const daten = (b.r.schritte || []).find((x) => x.id === "daten");
    if (!daten || daten.status === "blockiert" || daten.status === "nicht_verfuegbar") { simStoppen("✖ Paper-Automatik pausiert: Replay-Kursdaten ungültig – " + (daten ? daten.text : "keine Daten") + " – nichts gebucht.", "pausiert"); return; }
    const e = B.entscheiden({ einschaetzung: b.einschaetzung, einstieg: b.einstieg, plan: b.plan, position });
    const vorher = p0.ledger.length;
    if (e.aktion === "kauf" || e.aktion === "verkauf") B.buchen(p0, { ds, i, seite: e.aktion, wertKauf: SIM.orderWert, annahmen: SIM.annahmen, limits: SIM.limits });
    p0.abgespielt = { ...(p0.abgespielt || {}), [simSignalSchluessel(ds)]: ds.kerzen[i].t };
    return simSchreiben(JSON.stringify(p0), () => (simAutoNotaus() !== "aus" ? simAutoNotausGrund() : null)).then((s) => {
      if (s.gesperrt) { simStoppen("Gestoppt: " + s.gesperrt + " – nichts gebucht.", "gestoppt"); return; }
      if (s.konflikt) { simStoppen("✖ Simulation angehalten: " + SIM_KONFLIKT + " – bitte erneut starten.", "gestoppt"); return; }
      if (s.fehler) { simStoppen("✖ Simulation angehalten: Speichern gescheitert (" + s.fehler + ") – der gespeicherte Stand ist unverändert.", "fehler"); return; }
      SIM.pos = i + 1;
      if (e.teilziel) SIMAUTO.ziele[zielKey] = [...(SIMAUTO.ziele[zielKey] || []), e.teilziel];
      const plan = b.plan ? ((b.plan.aktionen || [])[0] ? b.plan.aktionen[0].text : `halten – wirksamer Stop ${b.plan.wirksamerStop} (${b.plan.stopGrund})`) : "keine Position";
      const einText = !b.einstieg ? "kein Ergebnis" : b.einstieg.urteil === "jetzt" ? "„jetzt“ – " + String(b.einstieg.text || "").slice(0, 120) : `kein Einstieg (${b.einstieg.urteil || b.einstieg.status}) – ${String(b.einstieg.text || "").slice(0, 140)}`;
      simAutoProtokoll({ art: "entscheidung", text: `${ds.synthetisch === false ? "Kerze" : "Testkerze"} ${i + 2} (${ds.synthetisch === false ? "Datum" : "Testdatum"} ${datum}, ${b.quelle}, Kurs ${Number(b.kurs).toLocaleString("de-DE")}): Analyse: ${b.einschaetzung ? b.einschaetzung.kategorie : "nicht verfügbar"} · Entry-Timer: ${einText} · Exit-Planer: ${plan}${ds.synthetisch === false ? " · " + simSecKurz(b.sec) : ""} → Entscheidung: ${e.grund}` });
      const kerzeNr = (t) => ds.kerzen.findIndex((k) => k.t === t) + 1;
      for (const x of SIM.portfolio.ledger.slice(vorher)) {
        if (x.zustand === "gefuellt") simAutoProtokoll({ art: "ausgefuehrt", kursart: simKursart(ds), signal: e.grund, seite: x.seite, symbol: x.symbol, menge: x.menge, preis: x.preis, volumen: x.volumen, gebuehr: x.gebuehr, ergebnis: x.ergebnis, trade_id: x.trade_id, kerze: kerzeNr(x.zeit) });
        else if (x.zustand === "unklar") simAutoProtokoll({ art: "unklar", signal: e.grund, seite: x.seite, symbol: x.symbol, trade_id: x.trade_id, kerze: kerzeNr(x.zeit) });
        else simAutoProtokoll({ art: "abgelehnt", signal: e.grund, seite: x.seite, symbol: x.symbol, trade_id: x.trade_id, kerze: kerzeNr(x.zeit), grund: x.grund || (x.risiko && x.risiko.gruende && x.risiko.gruende.join("; ")) || "vom Paper-Kern abgelehnt (" + x.zustand + ")" });
      }
      simAutoZeigen(); simLedgerZeigen();
      if (SIM.uhr && SIM.pos >= letzte) simStoppen("Fertig – Replay der JARVIS-Signale abgespielt.", "aus");
    });
  }).finally(() => { SIM.arbeit = null; });
  return SIM.arbeit;
}
function simSofortStoppen() {
  if (SIMAUTO.zustand !== "laeuft" && SIMAUTO.zustand !== "pausiert") return;
  const offen = Boolean(SIM.arbeit);
  simStoppen("Gestoppt – Sofort-Stopp durch dich" + (offen ? "; eine bereits begonnene Speicherung wird noch abgeschlossen, danach nichts mehr" : "") + ". Neuer Lauf nur über „Paper-Automatik starten“.", "gestoppt");
  simEl("sim-start").focus();
}
function simZuruecksetzen() {
  if (SIM.uhr) simStoppen();
  if (!confirm("Simulations-Portfolio zurücksetzen?\n\nBetrifft nur die lokale Simulation (Spielkapital, Positionen, Ledger). Worker, Alpaca-Konto, Einstellungen und Codes bleiben unberührt.")) return Promise.resolve();
  const sperre = simSperrgrund() || (SIM.arbeit ? "Ein Schreibvorgang der Simulation läuft noch – bitte gleich erneut versuchen." : null);
  if (sperre) { simEl("sim-ergebnis").textContent = "Nicht zurückgesetzt: " + sperre; return Promise.resolve(); }
  const neu = PaperKern.zuruecksetzen(SIM.portfolio ? simKlon(SIM.portfolio) : PaperKern.portfolioNeu({ startkapital: SIM.startkapital }), PaperKern.RESET_BESTAETIGUNG);
  SIM.arbeit = simSchreiben(JSON.stringify(neu)).then((s) => {
    simEl("sim-ergebnis").textContent = s.konflikt ? "Nicht zurückgesetzt: " + SIM_KONFLIKT + " – bitte prüfen und bei Bedarf erneut zurücksetzen."
      : s.fehler ? "Nicht zurückgesetzt: Speichern gescheitert (" + s.fehler + ") – der gespeicherte Stand ist unverändert."
        : "Simulations-Portfolio zurückgesetzt: " + simUsd(SIM.portfolio.bargeld) + ".";
    // ab 11-13u: ein offener Paper-Vorschlag galt dem alten Stand – sofort verwerfen (wie beim Symbolwechsel, 08-watchlist.js);
    // vorher blieb er bestätigbar und die Bestätigung meldete fälschlich eine Änderung „in einem anderen Tab“
    if (!s.konflikt && !s.fehler && typeof APROFIL !== "undefined" && APROFIL.vorschlag && typeof profilVorschlagZeigen === "function") {
      APROFIL.vorschlag = null; profilVorschlagZeigen("Paper-Vorschlag verworfen (Simulation zurückgesetzt) – nichts gebucht. Bitte einen neuen Vorschlag erstellen.");
    } else if (!s.konflikt && !s.fehler && typeof profilVorschlagZeigen === "function" && /^✔/.test(document.getElementById("profil-vorschlag-text").textContent)) {
      // ab Trader produktiv (D-6): die Erfolgsmeldung einer Buchung nicht stehen lassen, die nach dem Zurücksetzen nicht mehr im Ledger ist
      profilVorschlagZeigen("Simulation zurückgesetzt – frühere Buchungen sind gelöscht. Für einen neuen Durchlauf analysieren und einen Paper-Vorschlag erstellen.");
    }
    simEl("sim-detail").textContent = "";
    simLedgerZeigen();
    // ab 15a: ein pausierter oder gestoppter Lauf ist nach dem Zurücksetzen hinfällig – Automatik „Aus“, nicht weiter „Pausiert“
    if (!s.konflikt && !s.fehler && SIMAUTO.zustand !== "aus") { simAutoZustand("aus", "Simulation zurückgesetzt – neuer Lauf nur über „Paper-Automatik starten“"); simAutoProtokoll({ art: "zustand", text: "Aus: Simulation zurückgesetzt" }); }
  }).finally(() => { SIM.arbeit = null; });
  return SIM.arbeit;
}
function simAnzeigen(b) {
  simEl("sim-ergebnis").textContent = "SIMULATION · " + b.datensatz + (b.zeitraum ? " · " + b.zeitraum.von + " bis " + b.zeitraum.bis : "")
    + "\nOrders " + b.orders + " (ausgeführt " + b.ausgefuehrt + ", blockiert " + b.blockiert + ", unklar " + b.unklar + ") · abgeschlossene Trades " + b.trades + " (Gewinner " + b.gewinner + ", Verlierer " + b.verlierer + ")"
    + "\nRealisiert " + simUsd(b.realisiert) + " · Endwert " + simUsd(b.endwert) + " (Start " + simUsd(b.startkapital) + ") · größter Rückgang " + b.max_rueckgang_pct.toLocaleString("de-DE") + " %"
    + "\nAnnahmen: " + b.annahmen.quelle + " (Gebühr " + b.annahmen.gebuehrPct + " %, Slippage " + b.annahmen.slippagePct + " %)\n" + b.hinweis;
  simLedgerZeigen();
}
function simLedgerZeigen() {
  const liste = simEl("sim-ledger");
  const symbolFeld = document.getElementById("sim-filter-symbol"); // ab 11-07l
  const eintraege = SIM.portfolio ? PaperKern.ledgerFiltern(SIM.portfolio, { seite: simEl("sim-filter-seite").value || undefined, zustand: simEl("sim-filter-zustand").value || undefined, symbol: (symbolFeld && symbolFeld.value) || undefined }) : [];
  const text = { gefuellt: "ausgeführt (simuliert)", abgelehnt: "blockiert", unklar: "unklar", verworfen: "verworfen" };
  liste.replaceChildren(...(eintraege.length ? eintraege.slice().reverse().slice(0, 100) : [null]).map((e) => {
    const li = document.createElement("li");
    if (!e) { li.textContent = SIM.dbFehler ? "⚠ " + simSperrgrund() : !SIM.bereit ? "Simulationsstand wird geladen …" : SIM.beschaedigt ? "⚠ " + SIM_BESCHAEDIGT : "Noch keine simulierten Orders."; return li; }
    li.dataset.tradeId = e.trade_id;
    const k = Object.assign(document.createElement("button"), { type: "button" });
    k.textContent = (/^(JARVIS-Signale )?Synthetisch /.test(String(e.datensatz || "")) ? "Testdatum " : "") + simDatum(e.zeit) + " · " + (e.seite === "kauf" ? "KAUF " : "VERKAUF ") + e.symbol + " · " + (text[e.zustand] || e.zustand)
      + (e.zustand === "gefuellt" ? " · " + e.menge.toLocaleString("de-DE") + " Stück zu " + e.preis.toLocaleString("de-DE", { maximumFractionDigits: 4 }) : "") + " · SIMULATION";
    k.addEventListener("click", () => simDetail(e));
    li.append(k);
    return li;
  }));
  try { simRisikoZeigen(); } catch (e) { simEl("sim-risiko").textContent = "Risikoübersicht nicht verfügbar: " + e.message; }
  simStandZeigen(); // ab 15b: Standzeile nach jeder Ledger-Änderung (auch Zurücksetzen, manuelle Buchung, anderer Tab)
}
// ab 11-06e: Risikoübersicht. Bewertung je Position zum Kurs der letzten Analyse dieser Sitzung, sonst zum Einstand (gekennzeichnet –
// nie ein geschätzter Kurs). Sektor nur aus SEC-Stammdaten dieser Sitzung (APROFIL.sektoren), sonst „unbekannt“.
// ab 11-06i: Ledger der Simulation als CSV (Nachvollziehbarkeit: Zeitpunkte, Datensatz, Preise, Gebühren, Annahmen, Risikoprüfung)
// ab 11-13v: Nutzerentscheidung CSV-Option B (docs/ENTSCHEIDUNGEN_13U.md §C) – Semikolon bleibt Trenner, Zahlenfelder mit Dezimalkomma
// (deutsches Tabellenformat). Nur die Darstellung im Export: volle gespeicherte Stellenzahl, kein Tausenderpunkt, Text bleibt Text.
// Felder mit CR werden wie solche mit LF in Anführungszeichen gesetzt (RFC 4180; vorher blieb ein CR ungeschützt).
function simLedgerCsv(p = SIM.portfolio) {
  const feld = (x) => { const s = x === undefined || x === null ? "" : typeof x === "number" && Number.isFinite(x) ? String(x).replace(".", ",") : String(x); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const kopf = ["trade_id", "zeit_utc", "signal_zeit_utc", "datensatz", "symbol", "seite", "zustand", "menge", "preis", "volumen_usd", "gebuehr_usd", "ergebnis_usd", "gebuehr_pct", "slippage_pct", "annahmen_quelle", "risiko_bestanden", "risiko_gruende", "grund"];
  const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : "");
  const zeilen = ((p && p.ledger) || []).map((e) => [e.trade_id, iso(e.zeit), iso(e.signal_zeit), e.datensatz, e.symbol, e.seite, e.zustand, e.menge, e.preis, e.volumen, e.gebuehr, e.ergebnis,
    e.annahmen && e.annahmen.gebuehrPct, e.annahmen && e.annahmen.slippagePct, e.annahmen && e.annahmen.quelle, e.risiko ? e.risiko.bestanden : "", e.risiko ? (e.risiko.gruende || []).join(" | ") : "", e.grund].map(feld).join(";"));
  return "# SIMULATION – Spielgeld, keine Order, kein Konto\n" + kopf.join(";") + "\n" + zeilen.join("\n") + (zeilen.length ? "\n" : "");
}
// ab 14zc: Datenqualitätsbericht zu echten Tageskursen (Datei oder Worker) – nur Anzeige, ändert keine Werte. Größter Schluss-zu-Schluss-Sprung
// mit Datum als Hinweis auf mögliche Splits/Sondereffekte (ab 10 % markiert); Lücken über 4 Kalendertage lehnt die Kerzenprüfung ohnehin ab.
function simDatenbericht(ds) {
  const el = simEl("sim-datenbericht"); if (!el) return;
  if (!ds || ds.synthetisch !== false || !ds.kerzen || ds.kerzen.length < 2) { el.hidden = true; el.replaceChildren(); return; }
  const k = ds.kerzen, n = k.length, z2 = (x) => x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let sprung = { pct: -1 }, vierTage = 0, ohneVolumen = 0;
  for (let i = 1; i < n; i++) {
    const pct = Math.abs(k[i].c / k[i - 1].c - 1) * 100;
    if (pct > sprung.pct) sprung = { pct, datum: simDatum(k[i].t), von: k[i - 1].c, bis: k[i].c };
    if (Math.round((k[i].t - k[i - 1].t) / 86400000) === 4) vierTage++;
  }
  for (const x of k) if (!(x.v > 0)) ohneVolumen++;
  const zeilen = [
    `Herkunft: ${ds.quelle}`,
    `${ds.symbol} · ${n.toLocaleString("de-DE")} Tageskerzen · ${simDatum(k[0].t)} bis ${simDatum(k[n - 1].t)} (Handelstage laut Quelle) · ${simDatenalter(ds).art} · historisch, keine Live-Kurse`,
    `Geprüft: Reihenfolge, Doppelte, Lücken über 4 Kalendertage, OHLC-Plausibilität, Preise über 0, keine Kerze nach heute; Tagessprünge über ${SIM.ausreisser.maxSprungPct} % oder Spannen über ${SIM.ausreisser.maxSpannePct} % sperren den Lauf`,
    `Größter Schluss-zu-Schluss-Sprung: ${sprung.pct.toFixed(1).replace(".", ",")} % am ${sprung.datum} (${z2(sprung.von)} → ${z2(sprung.bis)})` + (sprung.pct >= 10 ? " – ungewöhnlich groß: möglicher Split oder Sondereffekt; JARVIS ändert historische Werte nicht" : " – unauffällig"),
    `Lücken von 4 Kalendertagen (Feiertag + Wochenende): ${vierTage} · Kerzen ohne Volumen: ${ohneVolumen}`,
    ...(ds.kodierung ? [`Kodierung der Datei: ${ds.kodierung}`] : []),
    ...(ds.gekuerzt ? [`Gekürzt: Datei hatte ${ds.gekuerzt.gesamt.toLocaleString("de-DE")} Datenzeilen, verwendet ab ${ds.gekuerzt.ab} (${ds.gekuerzt.weg.toLocaleString("de-DE")} ältere Zeilen nicht verwendet)`] : []),
  ];
  el.replaceChildren(...zeilen.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  el.hidden = false;
}
// ab 14zc: Replay-Bericht (Markdown) – Datenquelle, Zeitraum, Kursart, SEC-Stand, Regel, Annahmen, Grenzen, Ergebnis, Ledger und Laufprotokoll.
// Exportiert nur vorhandene Daten; rückblickende Auswertung, keine Prognose, keine Anlageberatung.
function simReplayBerichtText() {
  const ds = SIM.datensatz, p = SIM.portfolio, L = (p && p.ledger) || [], f = SIM.limits.frequenz;
  const z2 = (x) => (Number.isFinite(x) ? x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "–");
  const gef = L.filter((e) => e.zustand === "gefuellt"), echt = ds && ds.synthetisch === false;
  const realisiert = gef.filter((e) => e.seite === "verkauf" && Number.isFinite(e.ergebnis)).reduce((s, e) => s + e.ergebnis, 0);
  const gebuehren = gef.reduce((s, e) => s + (Number.isFinite(e.gebuehr) ? e.gebuehr : 0), 0);
  const zelle = (x) => String(x === undefined || x === null ? "" : x).replace(/\|/g, "/").replace(/\s+/g, " ");
  return [
    "# JARVIS Replay-Bericht – Paper-Trading mit Spielgeld", "",
    `Erstellt ${new Date().toLocaleString("de-DE")} (Ortszeit) · ${JARVIS_STAND || "Stand unbekannt"}`, "",
    "> Simulation mit Spielgeld: keine Order, kein Konto, kein Echtgeld. Rückblickende Auswertung historischer bzw. synthetischer Kurse – keine Prognose, kein Gewinnversprechen, keine Anlageberatung.", "",
    "## Datenquelle",
    `- Kursart: ${SIM_KURSART_TEXT[simKursart(ds)]}`,
    `- Datensatz: ${ds ? ds.name : "keiner"}`,
    ...(ds ? [`- Quelle: ${ds.quelle}`, `- Zeitraum: ${ds.kerzen.length} Tageskerzen ${simDatum(ds.kerzen[0].t)} bis ${simDatum(ds.kerzen[ds.kerzen.length - 1].t)}`] : []),
    ...(echt ? [`- Datenalter: ${simDatenalter(ds).art}`, `- ${simSecZeile(ds)}`] : []),
    `- Datenprüfung: ${SIM.datenStatus ? SIM.datenStatus.text : "nicht geprüft"}`, "",
    "## Regel",
    simModus() === "jarvis" ? `- JARVIS-Signale im Replay: Kauf ${SIM.orderWert} USD nur bei Systemeinschätzung „Kaufkandidat“ UND Entry-Timer „jetzt“; Verkauf der ganzen Position nur bei Stop, Zeit-Stop oder Ziel 2 des Exit-Planers (Teilverkäufe nicht implementiert)`
      : `- EMA ${SIM.strategie.kurz}/${SIM.strategie.lang}-Kreuzung: Kauf ${SIM.orderWert} USD, Verkauf der ganzen Position; Ausführung zur Eröffnung der nächsten Kerze`, "",
    "## Annahmen und Grenzen (Testwerte der Simulation)",
    `- Gebühr ${SIM.annahmen.gebuehrPct} %, Slippage ${SIM.annahmen.slippagePct} % je Ausführung`,
    `- höchstens ${SIM.limits.maxOrderWert} USD je Order, ${SIM.limits.maxPositionen} Positionen, Tagesverlust bis ${SIM.limits.maxTagesverlust} USD, ${f.max} Orders in ${Math.round(f.fensterMs / 86400000)} Tagen`, "",
    "## Ergebnis (Spielgeld, rückblickend)",
    `- Startkapital ${z2(SIM.startkapital)} USD · Bargeld ${z2(p ? p.bargeld : SIM.startkapital)} USD · realisiert ${z2(realisiert)} USD · Gebühren gesamt ${z2(gebuehren)} USD`,
    `- Orders: ${gef.length} ausgeführt (${gef.filter((e) => e.seite === "kauf").length} Käufe, ${gef.filter((e) => e.seite === "verkauf").length} Verkäufe), ${L.filter((e) => e.zustand !== "gefuellt" && e.zustand !== "unklar").length} abgelehnt, ${L.filter((e) => e.zustand === "unklar").length} unklar`,
    `- ${(simEl("sim-stand") || {}).textContent || ""}`, "",
    "## Ledger",
    "| Datum | Seite | Symbol | Zustand | Stück | Preis | Volumen USD | Gebühr USD | Ergebnis USD | Ledger-ID |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...(L.length ? L.map((e) => "| " + [Number.isFinite(e.zeit) ? simDatum(e.zeit) : "", e.seite, e.symbol, e.zustand, e.menge, e.preis, z2(e.volumen), z2(e.gebuehr), Number.isFinite(e.ergebnis) ? z2(e.ergebnis) : "", e.trade_id].map(zelle).join(" | ") + " |") : ["| – | keine Buchung | | | | | | | | |"]), "",
    "## Laufprotokoll (älteste zuerst)",
    ...(SIMAUTO.protokoll.length ? SIMAUTO.protokoll.map((x) => "- " + zelle(simAutoProtokollText(x))) : ["- Noch kein Lauf."]), "",
  ].join("\n");
}
document.getElementById("sim-bericht").addEventListener("click", () => {
  if (!SIM.datensatz) { simEl("sim-detail").textContent = "Kein gültiger Datensatz – kein Replay-Bericht exportiert. Nächster Schritt: Datenquelle wählen bzw. Kurse laden."; return; }
  try {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([simReplayBerichtText()], { type: "text/markdown;charset=utf-8" })), download: "jarvis-replay-bericht-" + new Date().toISOString().slice(0, 10) + ".md" });
    document.body.append(a); a.click(); a.remove();
  } catch (e) { simEl("sim-detail").textContent = "Bericht-Export fehlgeschlagen: " + ((e && e.message) || e) + " – keine Datei erstellt."; return; }
  simEl("sim-detail").textContent = `Replay-Bericht exportiert (${(SIM.portfolio && SIM.portfolio.ledger || []).length} Ledger-Einträge, ${SIMAUTO.protokoll.length} Protokollzeilen).`;
});
document.getElementById("sim-ledger-csv").addEventListener("click", () => {
  if (!SIM.portfolio || !(SIM.portfolio.ledger || []).length) { simEl("sim-detail").textContent = "Kein Ledger vorhanden – nichts exportiert."; return; }
  // ab 11-13w: scheitert das Erzeugen der Datei, Fehler melden – vorher blieb eine frühere Erfolgsmeldung stehen (unbehandelter Fehler)
  try {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([simLedgerCsv()], { type: "text/csv;charset=utf-8" })), download: "jarvis-simulation-ledger-" + new Date().toISOString().slice(0, 10) + ".csv" });
    document.body.append(a); a.click(); a.remove();
  } catch (e) { simEl("sim-detail").textContent = "CSV-Export fehlgeschlagen: " + ((e && e.message) || e) + " – keine Datei erstellt, Ledger unverändert."; return; }
  const n = SIM.portfolio.ledger.length;
  simEl("sim-detail").textContent = "Ledger als CSV exportiert (" + n + (n === 1 ? " Eintrag" : " Einträge") + ").";
});
// ab 11-06i: Warnschwellen einstellbar (nur Anzeige-Warnungen, keine Handelsregel). Standard 25 % je Position, 40 % je Sektor.
// Speicher „jarvis-risiko-schwellen“ = { position, sektor } (je 1–100); ungültig oder beschädigt → Standard mit Hinweis, nie überschrieben.
const RISIKO_SCHWELLEN = { schluessel: "jarvis-risiko-schwellen", standard: { position: 25, sektor: 40 } };
const schwelleGueltig = (v) => Number.isFinite(v) && v >= 1 && v <= 100;
function risikoSchwellenLesen() {
  const d = speicherJsonLesen(RISIKO_SCHWELLEN.schluessel, (x) => istObjekt(x) && schwelleGueltig(x.position) && schwelleGueltig(x.sektor));
  return d ? { position: d.position, sektor: d.sektor, eigene: true } : { ...RISIKO_SCHWELLEN.standard, eigene: false, beschaedigt: speicherBeschaedigt(RISIKO_SCHWELLEN.schluessel) };
}
function risikoSchwellenSetzen(position, sektor) {
  const p = Number(position), s = Number(sektor);
  if (!schwelleGueltig(p) || !schwelleGueltig(s)) return { fehler: "Warnschwellen bitte zwischen 1 und 100 % angeben." };
  if (speicherBeschaedigt(RISIKO_SCHWELLEN.schluessel)) return { fehler: SPEICHER_SCHADEN_TEXT };
  try { localStorage.setItem(RISIKO_SCHWELLEN.schluessel, JSON.stringify({ position: p, sektor: s })); } catch (e) { return { fehler: "Nicht gespeichert (Browserspeicher gesperrt oder voll)." }; }
  simRisikoZeigen();
  return { ok: true };
}
document.getElementById("sim-schwellen-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const r = risikoSchwellenSetzen(document.getElementById("sim-schwelle-position").value, document.getElementById("sim-schwelle-sektor").value);
  document.getElementById("sim-schwellen-meldung").textContent = r.fehler || "Gespeichert – Warnungen neu berechnet.";
});
function simRisikoZeigen() {
  const box = simEl("sim-risiko");
  const schwellen = risikoSchwellenLesen();
  const pf = document.getElementById("sim-schwelle-position"), sf = document.getElementById("sim-schwelle-sektor");
  if (pf && document.activeElement !== pf) pf.value = schwellen.position;
  if (sf && document.activeElement !== sf) sf.value = schwellen.sektor;
  const p = SIM.portfolio;
  const pos = p ? Object.entries(p.positionen || {}).filter(([, x]) => x && x.menge > 0) : [];
  if (!p || !pos.length) { box.textContent = "Noch keine Positionen in der Simulation."; return; }
  const zumEinstand = [];
  const positionen = pos.map(([symbol, x]) => {
    const a = APROFIL.analysen[symbol];
    const kurs = a && Number.isFinite(a.kurs) ? a.kurs : null;
    if (kurs === null) zumEinstand.push(symbol);
    return { symbol, wert: Math.round(x.menge * (kurs === null ? x.einstand : kurs) * 100) / 100, sektor: (APROFIL.sektoren && APROFIL.sektoren[symbol]) || null };
  });
  const r = window.AktienRebalance.risikoUebersicht({ positionen, bargeld: p.bargeld, grenzen: { maxPositionPct: schwellen.position, maxSektorPct: schwellen.sektor } });
  if (r.fehler) { box.textContent = r.fehler; return; }
  const pct = (x) => x.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " %";
  box.replaceChildren(
    wzKnoten("div", { text: `SIMULATION · Gesamtwert ${simUsd(r.gesamt)} · Bargeld ${pct(r.bargeld_pct)} · ${r.anzahl} Position(en) · Konzentration: effektiv ${r.effektive_anzahl === null ? "–" : r.effektive_anzahl.toLocaleString("de-DE")} gleich große Positionen (Herfindahl ${r.hhi === null ? "–" : r.hhi.toLocaleString("de-DE")})` }),
    wzKnoten("table", { klasse: "wz-tabelle" }, wzKnoten("tr", {}, ...["Symbol", "Wert", "Anteil gesamt", "Anteil Aktien", "Sektor"].map((t) => wzKnoten("th", { text: t }))),
      ...r.gewichte.map((g) => wzKnoten("tr", {}, ...[g.symbol, simUsd(g.wert), pct(g.gewicht_pct), pct(g.anteil_aktien_pct), g.sektor || "unbekannt"].map((t) => wzKnoten("td", { text: t }))))),
    wzKnoten("div", { klasse: "klein", text: "Sektoren: " + r.sektoren.map((s) => `${s.sektor} ${pct(s.gewicht_pct)}`).join(" · ") }),
    r.warnungen.length ? wzKnoten("ul", { klasse: "gruende" }, ...r.warnungen.map((w) => wzKnoten("li", { text: "⚠ " + w }))) : wzKnoten("div", { klasse: "klein", text: "Keine Warnschwelle überschritten." }),
    wzKnoten("div", { klasse: "klein", "data-schwellen": "1", text: `Warnschwellen: Position ${schwellen.position} %, Sektor ${schwellen.sektor} %${schwellen.eigene ? ", eigene Einstellung" : ", Standard"} – nur Anzeige, keine Handelsregel.` }),
    schwellen.beschaedigt ? wzKnoten("div", { klasse: "klein wz-wichtig", text: "Gespeicherte Warnschwellen beschädigt – Standard 25 %/40 % verwendet. " + SPEICHER_SCHADEN_TEXT }) : null,
    wzKnoten("div", { klasse: "klein", text: (zumEinstand.length ? `Zum Einstand bewertet (kein Kurs aus einer Analyse dieser Sitzung): ${zumEinstand.join(", ")}. ` : "Bewertet zum Kurs der letzten Analyse dieser Sitzung. ") + r.hinweis }),
  );
}
function simDetail(e) {
  simEl("sim-detail").textContent = [
    "SIMULATION – kein Konto, keine Order · trade_id " + e.trade_id,
    // ab Trader-Auftrag: Buchungen aus „US-Aktie analysieren“ (datensatz „Profil <Sitzung>“) nicht als lokaler Testdatensatz ausgeben –
    // die Datenquelle der Analyse (Testdaten oder Worker) steht nicht im Ledger
    "Ursprung: " + e.datensatz + " (" + (SIM.datensatz && SIM.datensatz.name === e.datensatz ? SIM.datensatz.quelle : /^Profil /.test(String(e.datensatz)) ? "bestätigter Paper-Vorschlag aus „US-Aktie analysieren“; Datenquelle der Analyse im Ledger nicht gespeichert" : "lokaler Testdatensatz") + ")",
    "Zeit (UTC): Signal " + new Date(e.signal_zeit).toISOString().slice(0, 16).replace("T", " ") + ", Ausführung " + new Date(e.zeit).toISOString().slice(0, 16).replace("T", " "),
    e.zustand === "gefuellt" ? "Ausführung: " + e.menge + " Stück zu " + e.preis + " · Volumen " + simUsd(e.volumen) + " · Gebühr " + simUsd(e.gebuehr) + (e.ergebnis !== undefined ? " · Ergebnis " + simUsd(e.ergebnis) + (Number.isFinite(e.kaufgebuehr_anteil) ? " (nach Kauf- und Verkaufsgebühren; Anteil Kaufgebühr " + simUsd(e.kaufgebuehr_anteil) + ")" : " (Buchung vor 11-05h: nur nach Verkaufsgebühr)") : "") : "Zustand: " + e.zustand + (e.grund ? " (" + e.grund + ")" : ""),
    "Annahmen: " + e.annahmen.quelle + " (Gebühr " + e.annahmen.gebuehrPct + " %, Slippage " + e.annahmen.slippagePct + " %)",
    "Risikoprüfung: " + (e.risiko.bestanden ? "bestanden" : "blockiert – " + e.risiko.gruende.join("; ")),
  ].join("\n");
}
simEl("sim-start").addEventListener("click", simStarten);
simEl("sim-stopp").addEventListener("click", () => { if (SIMAUTO.zustand !== "laeuft") return; simStoppen("Angehalten – fortsetzen mit „Paper-Automatik starten“ (bereits verarbeitete Kerzen werden nicht erneut gebucht).", "pausiert"); simEl("sim-start").focus(); });
// ab 14a: eigene Kursdatei (CSV, Tageskurse) – nur lokal gelesen; strenge Prüfung (JarvisDaten.csvKerzenLesen): Symbol Pflicht, jede fehlerhafte
// Zeile, doppelte Tage oder Lücken → nichts übernommen; danach dieselbe Daten- und Ausreißerprüfung wie die Testdatensätze (simVorschau)
async function simDateiGewaehlt() {
  const inp = simEl("sim-datei"), st = simEl("sim-datei-status"), f = inp.files && inp.files[0];
  if (!f) return;
  if (SIM.uhr) { st.textContent = "Nicht gelesen: Während eines Laufs wird keine neue Kursdatei übernommen – erst pausieren oder stoppen."; return; }
  const sym = String(simEl("sim-datei-symbol").value || "").trim().toUpperCase(), name = String(f.name).slice(0, 60);
  SIM.dateiDatensatz = null;
  if (f.size > JarvisDaten.CSV_GRENZEN.maxZeichen) { st.textContent = `Nicht übernommen: „${name}“ ist zu groß. Nächster Schritt: kürzeren Zeitraum speichern.`; simVorschau(); return; }
  let text;
  // ab 14zc: Kodierung – gültiges UTF-8 (auch mit BOM), sonst Windows-1252 (z. B. aus Excel gespeichert); nie geraten, beides wird angezeigt
  let kodierung = "UTF-8";
  try { const roh = await f.arrayBuffer(); try { text = new TextDecoder("utf-8", { fatal: true }).decode(roh); } catch (x) { text = new TextDecoder("windows-1252").decode(roh); kodierung = "Windows-1252"; } }
  catch (e) { st.textContent = `Nicht übernommen: „${name}“ nicht lesbar. Nächster Schritt: Datei erneut speichern und wählen.`; simVorschau(); return; }
  // ab 14zc: lange Dateien (z. B. vollständige Stooq-Historie) – nur bei eindeutig aufsteigender ISO-Datumsspalte am Zeilenanfang die jüngsten
  // CSV_GRENZEN.maxZeilen Zeilen übernehmen und das sichtbar melden; sonst lehnt die strenge Prüfung die Datei ab (nie still gekürzt)
  let gekuerzt = null;
  const MAXZ = JarvisDaten.CSV_GRENZEN.maxZeilen, zl = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/), kopfI = zl.findIndex((z) => z.trim());
  const datenZ = kopfI < 0 ? [] : zl.slice(kopfI + 1).filter((z) => z.trim()), isoAm = (z) => (z.match(/^\s*(\d{4}-\d{2}-\d{2})\s*[,;]/) || [])[1];
  if (datenZ.length > MAXZ && isoAm(datenZ[0]) && isoAm(datenZ[datenZ.length - 1]) && isoAm(datenZ[0]) < isoAm(datenZ[datenZ.length - 1])) {
    gekuerzt = { gesamt: datenZ.length, weg: datenZ.length - MAXZ, ab: isoAm(datenZ[datenZ.length - MAXZ]) };
    text = [zl[kopfI], ...datenZ.slice(-MAXZ)].join("\n");
  }
  const r = JarvisDaten.csvKerzenLesen(text, { symbol: sym });
  if (!r.ok) { st.textContent = `Nicht übernommen („${name}“): ${r.fehler.join(" ")} Nächster Schritt: ${r.rueckfrage ? "Datei mit Komma als Trennzeichen und Punkt als Dezimalzeichen speichern" : "Symbol eintragen bzw. Datei prüfen"} und erneut wählen – nichts gebucht.`; simVorschau(); return; }
  // ab 13z: Kerzen nach dem heutigen Tag gibt es nicht (Datumsfehler oder falsche Datei) → ungültig, nichts übernommen, Bot bleibt gesperrt
  const heute = new Date().toISOString().slice(0, 10);
  if (simDatum(r.info.bis) > heute) { st.textContent = `Nicht übernommen („${name}“): Die Datei enthält Kerzen nach heute (letzte ${simDatum(r.info.bis)}, heute ${heute} UTC) – Kurse aus der Zukunft gibt es nicht. Nächster Schritt: Datumsangaben prüfen oder die Datei erneut beim Anbieter speichern und wählen – nichts gebucht.`; simVorschau(); return; }
  const von = simDatum(r.info.von), bis = simDatum(r.info.bis), gespeichert = new Date(f.lastModified).toISOString().slice(0, 16).replace("T", " ");
  SIM.dateiDatensatz = { name: `Datei ${r.info.symbol} ${von}–${bis}`, symbol: r.info.symbol, intervall: "1d", kalender: "boerse", synthetisch: false,
    quelle: `Kursdatei „${name}“ (gespeichert ${gespeichert} UTC, gelesen ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC) – Kurse laut Datei, Herkunft nicht gegen den Anbieter geprüft`,
    kodierung, gekuerzt, kerzen: r.kerzen.map((k) => ({ ...k, v: Number.isFinite(k.v) ? k.v : 0 })) };
  st.textContent = `Gelesen: ${r.info.symbol} · ${r.info.zeilen} Tageskerzen ${von} bis ${bis} · Datei „${name}“, gespeichert ${gespeichert} UTC (Ortszeit ${new Date(f.lastModified).toLocaleString("de-DE")}) · Kodierung ${kodierung} · Datenalter: ${simDatenalter(SIM.dateiDatensatz).art} · ${r.info.sortierung}${gekuerzt ? ` · Datei hat ${gekuerzt.gesamt.toLocaleString("de-DE")} Datenzeilen – übernommen die jüngsten ${MAXZ.toLocaleString("de-DE")} ab ${gekuerzt.ab}, ${gekuerzt.weg.toLocaleString("de-DE")} ältere Zeilen nicht verwendet` : ""}. Kurse laut Datei – JARVIS prüft die Herkunft nicht gegen den Anbieter.`;
  simVorschau();
}
simEl("sim-datei").addEventListener("change", simDateiGewaehlt);
// ab 15c: SEC-Kennzahlen (companyfacts-JSON der SEC) zur Kursdatei – nur lokal gelesen. Strenge Prüfung (AktienSignalBot.secDateiPruefen),
// Symbol Pflicht. Die Offline-Tickerliste (Stand unbekannt) bestätigt nie eine Zuordnung, sie kann nur einen Widerspruch zeigen: steht das
// Symbol dort mit anderer CIK → nicht übernommen. Im Replay filtert der Signal-Bot je Kerze nach dem Einreichungsdatum (filed).
async function simSecDateiGewaehlt() {
  const inp = simEl("sim-sec-datei"), st = simEl("sim-sec-status"), f = inp.files && inp.files[0];
  if (!f) return;
  if (SIM.uhr) { st.textContent = "Nicht gelesen: Während eines Laufs wird keine neue SEC-Datei übernommen – erst pausieren oder stoppen."; return; }
  const sym = String(simEl("sim-datei-symbol").value || "").trim().toUpperCase(), name = String(f.name).slice(0, 60);
  SIM.secDatei = null;
  const nein = (grund, schritt) => { st.textContent = `Nicht übernommen („${name}“): ${grund} Nächster Schritt: ${schritt} – nichts gebucht.`; simVorschau(); };
  if (!sym) return nein("Symbol fehlt.", "Symbol der Kursdatei eintragen und die SEC-Datei erneut wählen");
  if (f.size > 60e6) return nein("Datei größer als 60 MB.", "die companyfacts-Datei des Unternehmens unverändert speichern");
  let cf;
  try { cf = JSON.parse(await f.text()); } catch (e) { return nein("kein gültiges JSON.", "die companyfacts-Datei unverändert (Rohdaten, nicht als Webseite) speichern und erneut wählen"); }
  const r = AktienSignalBot.secDateiPruefen(cf);
  if (!r.ok) return nein(r.fehler, "die companyfacts-Datei der SEC (data.sec.gov/api/xbrl/companyfacts/CIK….json) wählen");
  const T = window.AktienTickerOffline, eintrag = T ? Object.values(T.daten).find((x) => String(x.ticker).toUpperCase() === sym) : null;
  if (eintrag && Number(eintrag.cik_str) !== r.cik) return nein(`Symbol ${sym} steht in der Offline-Tickerliste mit CIK ${eintrag.cik_str} (${eintrag.title}), die Datei gehört zu CIK ${r.cik} (${r.firma}).`, "die Datei des richtigen Unternehmens wählen oder das Symbol prüfen");
  const zuordnung = eintrag ? "passt zur Offline-Tickerliste (Stand unbekannt, kein Beleg)" : "Symbol ↔ CIK nicht geprüft (nicht in der Offline-Tickerliste)";
  SIM.secDatei = { symbol: sym, daten: cf, name, cik: r.cik, firma: r.firma, fakten: r.fakten, filedVon: r.filedVon, filedBis: r.filedBis, zuordnung };
  st.textContent = `Gelesen: ${r.firma} (CIK ${r.cik}) für ${sym} · ${r.fakten} Werte, eingereicht ${r.filedVon} bis ${r.filedBis}${r.ohneFiled ? ` (${r.ohneFiled} ohne Einreichungsdatum, nie verwendet)` : ""} · Datei „${name}“ · Zuordnung: ${zuordnung}. Im Replay zählt je Kerze nur, was bis zum Kerzentag eingereicht war (filed).`;
  simVorschau();
}
simEl("sim-sec-datei").addEventListener("change", simSecDateiGewaehlt);
// ab 15c: echte Tageskurse über den eigenen Worker (GET /aktien/kerzen: Alpaca-Marktdaten, Feed IEX) – derselbe geprüfte Weg wie die Werkzeuge
// (wzKerzenGeprueft: ungültige Werte, Reihenfolge, Doppelte, Lücken, Kerzen aus der Zukunft, Frische). Ohne Verbindung oder bei Fehlern wird
// nichts übernommen (Grund und nächster Schritt). Eine noch laufende Kerze (Ende = Beginn + 1 Tag liegt nach jetzt, wie JarvisDaten.kerzenDatenzeit)
// wird nie verwendet: ihr Schluss ist unfertig.
async function simWorkerLaden() {
  const st = simEl("sim-datei-status"), sym = String(simEl("sim-datei-symbol").value || "").trim().toUpperCase();
  if (SIM.uhr) { st.textContent = "Nicht geladen: Während eines Laufs werden keine neuen Kurse übernommen – erst pausieren oder stoppen."; return; }
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) { st.textContent = "Nicht geladen: Symbol fehlt oder ist ungültig. Nächster Schritt: US-Ticker eintragen (z. B. AAPL) – nichts gebucht."; return; }
  if (typeof verbunden !== "function" || !verbunden()) { st.textContent = "Nicht geladen: kein Worker verbunden – echte Kurse kommen hier nur über deinen Worker (Alpaca-Marktdaten). Nächster Schritt: im Cockpit die Verbindung mit deinem Zugangscode einrichten oder eine Kursdatei wählen – nichts gebucht."; return; }
  SIM.dateiDatensatz = null; st.textContent = `Lade Tageskurse ${sym} über deinen Worker …`; simVorschau();
  let d;
  try { d = await wzKerzenGeprueft(sym, 500); } catch (e) { st.textContent = `Nicht geladen: ${String((e && e.message) || e).slice(0, 220)} Nächster Schritt: Worker-Verbindung und Symbol prüfen oder eine Kursdatei wählen – nichts gebucht.`; simVorschau(); return; }
  if (SIM.uhr) return;
  const jetzt = Date.now(), abgerufen = new Date(jetzt).toISOString().slice(0, 16).replace("T", " ");
  const kerzen = d.kerzen.filter((k) => k.t + 86400000 <= jetzt).map((k) => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: Number.isFinite(k.v) ? k.v : 0 }));
  const ohneHeute = d.kerzen.length - kerzen.length;
  if (kerzen.length < 30) { st.textContent = `Nicht übernommen: nur ${kerzen.length} abgeschlossene Tageskerzen für ${sym} geliefert. Nächster Schritt: Symbol prüfen oder eine Kursdatei wählen – nichts gebucht.`; simVorschau(); return; }
  const von = simDatum(kerzen[0].t), bis = simDatum(kerzen[kerzen.length - 1].t), quelle = String(d.quelle || "Alpaca-Marktdaten").slice(0, 120);
  SIM.dateiDatensatz = { name: `Worker ${sym} ${von}–${bis}`, symbol: sym, intervall: "1d", kalender: "boerse", synthetisch: false, herkunft: "worker",
    quelle: `${quelle}, abgerufen ${abgerufen} UTC über deinen Worker${Array.isArray(d.hinweise) && d.hinweise.length ? " – " + d.hinweise.join(" ").slice(0, 240) : ""}`, kerzen };
  st.textContent = `Geladen: ${sym} · ${kerzen.length} Tageskerzen ${von} bis ${bis} · Quelle: ${quelle} · abgerufen ${abgerufen} UTC über deinen Worker · Datenalter: ${simDatenalter(SIM.dateiDatensatz).art}${ohneHeute ? " · noch laufende Tageskerze nicht verwendet" : ""}.`;
  simVorschau();
}
simEl("sim-worker-laden").addEventListener("click", simWorkerLaden);
simEl("sim-abbruch").addEventListener("click", simSofortStoppen);
simEl("sim-notaus").addEventListener("click", simAutoSimNotausUmschalten);
simEl("sim-signalquelle").addEventListener("change", () => simAutoZeigen());
simEl("sim-protokoll-kopieren").addEventListener("click", async () => {
  const text = ["JARVIS Paper-Automatik – Laufprotokoll (SIMULATION, Spielgeld, synthetische Testdaten; keine Order, keine Prognose)", ...SIMAUTO.protokoll.map(simAutoProtokollText)].join("\n");
  try { await navigator.clipboard.writeText(text); simEl("sim-ergebnis").textContent = `Laufprotokoll kopiert (${SIMAUTO.protokoll.length} Einträge) – nur Text, nichts gebucht.`; }
  catch (e) { simEl("sim-ergebnis").textContent = "Kopieren nicht möglich (Zwischenablage gesperrt) – nichts gebucht."; }
});
simAutoProtokollLaden();
simAutoZeigen();
simEl("sim-reset").addEventListener("click", simZuruecksetzen);
simEl("sim-migration").addEventListener("click", () => simMigrationWiederherstellen().then(simMigrationKnopf));
simEl("sim-datensatz").addEventListener("change", () => { simVorschau(); simEl("sim-detail").textContent = ""; });
simEl("sim-filter-seite").addEventListener("change", simLedgerZeigen);
simEl("sim-filter-zustand").addEventListener("change", simLedgerZeigen);

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("mein-tag");
