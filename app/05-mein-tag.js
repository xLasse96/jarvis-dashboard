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
    `Modus: ${simModus() === "jarvis" ? "JARVIS-Signale im Replay (Analyse + Entry-Timer + Exit-Planer) – kauft mit synthetischen Testkursen nach den bestehenden Regeln nicht" : "automatische Paper-Demo mit EMA 5/20 (kein vollständig integrierter Trader-Skill)"} · Daten: ${SIM.datenStatus ? SIM.datenStatus.text : "werden geprüft …"}`,
    (simModus() === "jarvis" ? `Regel: JARVIS-Signale – Kauf nur bei Systemeinschätzung „Kaufkandidat“ UND Entry-Timer „jetzt“ (Kauf ${SIM.orderWert} USD); Verkauf der ganzen Position nur bei Stop, Zeit-Stop oder Ziel 2 des Exit-Planers (Teilverkäufe nicht implementiert) · Datenquelle: ${ds ? "Replay " + ds.name + " – synthetische Testkurse, simulierte Börsenzeit" : "–"}`
      : `Regel: Strategie EMA ${SIM.strategie.kurz}/${SIM.strategie.lang}-Kreuzung (Regelquelle: Simulationseinstellungen, Kauf ${SIM.orderWert} USD, Verkauf immer der ganzen Position – Teilverkäufe nicht implementiert) · Datenquelle: ${ds ? ds.name + " – synthetische Testkurse" : "–"}`)
      + `${ds && z !== "aus" ? ` · Kerze ${SIM.pos} von ${ende} (${simDatum(ds.kerzen[Math.max(0, Math.min(SIM.pos, ds.kerzen.length) - 1)].t)})` : ""}`,
    (n === "aktiv" ? "Not-Aus (Worker): AKTIV – die Automatik startet nicht bzw. stoppt vor dem nächsten Schritt."
      : n === "sim-aktiv" ? "Simulations-Not-Aus: AKTIV – die Automatik startet nicht bzw. stoppt vor dem nächsten Schritt (nach jedem Laden aktiv; ausschalten per Knopf)."
      : "Simulations-Not-Aus: aus (von dir ausgeschaltet, gilt nur für diese Spielgeld-Simulation).")
      + " Worker-Not-Aus: " + ({ aktiv: "aktiv", aus: "aus (bestätigt)", unbekannt: "unbekannt (kein Worker verbunden) – schützt diese lokale Simulation nicht" })[simAutoWorkerNotaus()] + ".",
  ].join("\n");
  simEl("sim-abbruch").disabled = z !== "laeuft" && z !== "pausiert";
  const k = simEl("sim-notaus");
  if (k) { k.textContent = SIMAUTO.simNotaus ? "Simulations-Not-Aus ausschalten" : "Simulations-Not-Aus aktivieren"; k.setAttribute("aria-pressed", String(!SIMAUTO.simNotaus)); }
  simStandZeigen();
}
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
    return `${sym} ${x.menge.toLocaleString("de-DE")} Stück, Einstand ${x.einstand.toLocaleString("de-DE", { maximumFractionDigits: 4 })}, letzter synthetischer Kurs ${kurs.toLocaleString("de-DE")}, nicht realisiert ${simUsd(nr)}`;
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
  const emaText = Number.isFinite(p.ema_kurz) && Number.isFinite(p.ema_lang) ? ` · Kurs am Signal: Schluss ${z2(p.schluss)} (Testkerze ${p.signal_kerze}, Testdatum ${p.signal_datum}), EMA ${SIM.strategie.kurz} ${z2(p.ema_kurz)} ${p.seite === "kauf" ? ">" : "<"} EMA ${SIM.strategie.lang} ${z2(p.ema_lang)}` : "";
  if (p.art === "ausgefuehrt") return `${zeit} · ausgeführt (${sig}): ${p.seite === "kauf" ? "KAUF" : "VERKAUF"} ${p.symbol} ${p.menge.toLocaleString("de-DE")} Stück zu ${p.preis.toLocaleString("de-DE", { maximumFractionDigits: 4 })} (Eröffnung Testkerze ${p.kerze})${emaText} · Betrag ${z2(p.volumen)} USD + Gebühr ${z2(p.gebuehr)} USD${p.seite === "verkauf" && Number.isFinite(p.ergebnis) ? " · Ergebnis " + z2(p.ergebnis) + " USD (nach Gebühren)" : ""} · Ledger ${p.trade_id} · SIMULATION, synthetische Testkurse`;
  if (p.art === "abgelehnt") return `${zeit} · abgelehnt (${sig}): ${p.seite === "kauf" ? "KAUF" : "VERKAUF"} ${p.symbol} (Kerze ${p.kerze}) – ${p.grund} · Ledger ${p.trade_id} · nichts gebucht`;
  if (p.art === "unklar") return `${zeit} · unklar: ${p.seite === "kauf" ? "KAUF" : "VERKAUF"} ${p.symbol} (Kerze ${p.kerze}) – Ausführung nicht bestätigt · Ledger ${p.trade_id}`;
  if (p.art === "kein-signal") return `${zeit} · kein Signal: Testkerzen ${p.von} bis ${p.bis} (synthetische Testkurse) verarbeitet, keine EMA-Kreuzung mit ausführbarer Order`;
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
    if (e.zustand === "gefuellt") simAutoProtokoll({ art: "ausgefuehrt", seite: e.seite, symbol: e.symbol, menge: e.menge, preis: e.preis, volumen: e.volumen, gebuehr: e.gebuehr, ergebnis: e.ergebnis, trade_id: e.trade_id, kerze: kerzeNr(e.zeit), ...simAutoEmaAm(ds, e.signal_zeit) });
    else if (e.zustand === "unklar") simAutoProtokoll({ art: "unklar", seite: e.seite, symbol: e.symbol, trade_id: e.trade_id, kerze: kerzeNr(e.zeit) });
    else simAutoProtokoll({ art: "abgelehnt", seite: e.seite, symbol: e.symbol, trade_id: e.trade_id, kerze: kerzeNr(e.zeit), grund: e.grund || (e.risiko && e.risiko.gruende && e.risiko.gruende.join("; ")) || "vom Paper-Kern abgelehnt (" + e.zustand + ")" });
  }
  if (!neu.length) simAutoProtokoll({ art: "kein-signal", von: posAlt + 1, bis: posNeu });
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
    if (SIM.pos >= ende) simStoppen(ende < ds.kerzen.length ? `Fertig – Zeitraum bis ${simDatum(ds.kerzen[ende - 1].t)} abgespielt.` : "Fertig – Testdatensatz vollständig abgespielt.", "aus");
  }).finally(() => { SIM.arbeit = null; });
  return SIM.arbeit;
}
function simStarten() {
  if (SIM.uhr || !simVorschau()) return;
  const sperre = simSperrgrund();
  if (sperre) { simEl("sim-ergebnis").textContent = "✖ Simulation nicht gestartet: " + sperre; simAutoZustand("fehler", sperre); return; }
  if (SIM.beschaedigt) { simEl("sim-ergebnis").textContent = "✖ Simulation nicht gestartet: " + SIM_BESCHAEDIGT; simAutoZustand("fehler", "gespeicherter Stand beschädigt"); return; }
  if (simAutoNotaus() !== "aus") { simEl("sim-ergebnis").textContent = "✖ Paper-Automatik nicht gestartet: " + simAutoNotausGrund() + "."; simAutoZustand("gestoppt", (simAutoNotaus() === "aktiv" ? "Not-Aus (Worker) aktiv" : "Simulations-Not-Aus aktiv") + " – nicht gestartet"); simEl("sim-notaus").focus(); return; }
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
  simAutoProtokoll({ art: "start", text: `Start: ${ds.name} (synthetisch), EMA ${SIM.strategie.kurz}/${SIM.strategie.lang}, ab Kerze ${SIM.pos + 1}${vorlauf ? " (Beginn " + simEl("sim-von").value + ")" : ""} bis ${ende}, Not-Aus ${simAutoNotaus()}` });
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
      simAutoProtokoll({ art: "entscheidung", text: `Testkerze ${i + 2} (Testdatum ${datum}, ${b.quelle}, Kurs ${Number(b.kurs).toLocaleString("de-DE")}): Analyse: ${b.einschaetzung ? b.einschaetzung.kategorie : "nicht verfügbar"} · Entry-Timer: ${einText} · Exit-Planer: ${plan} → Entscheidung: ${e.grund}` });
      const kerzeNr = (t) => ds.kerzen.findIndex((k) => k.t === t) + 1;
      for (const x of SIM.portfolio.ledger.slice(vorher)) {
        if (x.zustand === "gefuellt") simAutoProtokoll({ art: "ausgefuehrt", signal: e.grund, seite: x.seite, symbol: x.symbol, menge: x.menge, preis: x.preis, volumen: x.volumen, gebuehr: x.gebuehr, ergebnis: x.ergebnis, trade_id: x.trade_id, kerze: kerzeNr(x.zeit) });
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
    k.textContent = (/^(Synthetisch |JARVIS-Signale )/.test(String(e.datensatz || "")) ? "Testdatum " : "") + simDatum(e.zeit) + " · " + (e.seite === "kauf" ? "KAUF " : "VERKAUF ") + e.symbol + " · " + (text[e.zustand] || e.zustand)
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
