// JARVIS Aktien – Preisalarme (Stufe 2). Reine Rechnung ohne Netzwerk. Ein Alarm ist eine Information, nie eine Order:
// Auch wenn ein Stop auslöst, wird nichts verkauft.
// Regelarten nach dem Vorbild von trader-alerts aus github.com/Jakeschincariol/trader-skill (MIT, Copyright (c) 2026 Jake
// Schincariol), in JavaScript neu geschrieben:
//   ueber            Kurs ≥ Preis                      → einmal; erneut nach „Zurücksetzen“ oder (wiederScharf) wenn der Kurs zurückfiel
//   unter / stop     Kurs ≤ Preis                      → ebenso
//   prozent          Bewegung ≥ prozent % zum Vortagesschluss (Richtung auf/ab/beide) → höchstens einmal je Handelstag
//   boersenoeffnung  US-Börse offen                    → einmal je Handelstag
// Kurse älter als maxAlterMin werden nicht bewertet (Alpaca IEX ist nicht die ganze Börse; kostenlose Kurse können verzögert sein).
(function (global) {
  "use strict";

  const ARTEN = ["ueber", "unter", "stop", "prozent", "boersenoeffnung", "meldung", "nachricht"];
  // Filing- und Quellen-Ereignisse (ab 2026-11-01d, JARVIS-eigen, nicht aus trader-alerts): nur mit ausdrücklich gewählten Formularen bzw.
  // Kennzeichen und erst für Ereignisse ab dem Anlegen der Regel (sonst würden alte Meldungen beim ersten Prüfen alle auslösen)
  const FORMULARE = ["8-K", "10-Q", "10-K", "4", "13F-HR", "13F-HR/A"];
  // Kennzeichen genau wie die Schlagwort-Regeln in nachrichten.js (SCHLAGWORTE), dazu „alle“
  const KENNZEICHEN = ["Zahlen", "Analysten", "Recht", "Übernahme", "Kapital", "Personal", "Risiko", "alle"];
  const TICKER = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;
  const MAX_ALTER_MIN = 20;

  function regelNeu(e) {
    const art = String(e && e.art || "");
    if (!ARTEN.includes(art)) return { fehler: "Unbekannte Alarmart." };
    const regel = { art, notiz: String(e.notiz || "").slice(0, 120), wiederScharf: Boolean(e.wiederScharf), aktiv: e.aktiv !== false };
    // Optional gültig bis einschließlich dieses Tages (UTC); danach löst die Regel nicht mehr aus
    if (e.ablauf !== undefined && e.ablauf !== null && e.ablauf !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.ablauf)) || !Number.isFinite(Date.parse(e.ablauf + "T00:00:00Z"))) return { fehler: "Ablaufdatum als JJJJ-MM-TT angeben." };
      regel.ablauf = String(e.ablauf);
    }
    if (art !== "boersenoeffnung") {
      regel.symbol = String(e.symbol || "").trim().toUpperCase();
      if (!TICKER.test(regel.symbol)) return { fehler: "Kein gültiger US-Aktien-Ticker." };
    }
    if (art === "ueber" || art === "unter" || art === "stop") {
      regel.preis = Number(e.preis);
      if (!(regel.preis > 0)) return { fehler: "Preis muss größer als 0 sein." };
    }
    if (art === "prozent") {
      regel.prozent = Number(e.prozent);
      regel.richtung = ["auf", "ab"].includes(e.richtung) ? e.richtung : "beide";
      if (!(regel.prozent > 0 && regel.prozent <= 50)) return { fehler: "Prozent zwischen 0 und 50." };
    }
    if (art === "meldung" || art === "nachricht") {
      const erlaubt = art === "meldung" ? FORMULARE : KENNZEICHEN;
      const liste = Array.isArray(e.auswahl) ? [...new Set(e.auswahl.map(String))] : [];
      if (!liste.length || liste.some((x) => !erlaubt.includes(x))) return { fehler: art === "meldung" ? "Formulare ausdrücklich wählen (" + FORMULARE.join(", ") + ")." : "Kennzeichen ausdrücklich wählen (" + KENNZEICHEN.join(", ") + ")." };
      if (!e.angelegt || !Number.isFinite(Date.parse(e.angelegt))) return { fehler: "Anlegezeitpunkt fehlt – ohne ihn würden alte Ereignisse auslösen." };
      regel.auswahl = liste.sort();
      regel.angelegt = new Date(Date.parse(e.angelegt)).toISOString();
    }
    regel.id = [regel.symbol || "boerse", art, regel.preis || regel.prozent || "", regel.richtung || "", (regel.auswahl || []).join("+")].filter(Boolean).join("-").toLowerCase();
    return { regel };
  }

  function text(regel) {
    const n = regel.notiz ? ` („${regel.notiz}“)` : "";
    switch (regel.art) {
      case "ueber": return `${regel.symbol} über ${regel.preis} USD${n}`;
      case "unter": return `${regel.symbol} unter ${regel.preis} USD${n}`;
      case "stop": return `Stop ${regel.symbol} bei ${regel.preis} USD${n}`;
      case "prozent": return `${regel.symbol} bewegt sich ${regel.prozent} %${regel.richtung === "beide" ? "" : regel.richtung === "auf" ? " nach oben" : " nach unten"}${n}`;
      case "meldung": return `${regel.symbol}: neue SEC-Meldung (${regel.auswahl.join(", ")}) ab ${regel.angelegt.slice(0, 10)}${n}`;
      case "nachricht": return `${regel.symbol}: neue Nachricht (${regel.auswahl.join(", ")}) ab ${regel.angelegt.slice(0, 10)}${n}`;
      default: return `US-Börse öffnet${n}`;
    }
  }

  // Handelstag als Datum in New York (aus der Börsenuhr, sonst aus jetzt in UTC −5 h genähert)
  function handelstag(uhr, jetzt) {
    const m = uhr && typeof uhr.zeit === "string" ? /^(\d{4}-\d{2}-\d{2})/.exec(uhr.zeit) : null;
    return m ? m[1] : new Date(jetzt - 5 * 3600000).toISOString().slice(0, 10);
  }

  // daten: { kurse: {SYM: {preis, alter_min} | null}, vortag: {SYM: schluss}, uhr: {offen, zeit}, jetzt }
  // zustand: { [id]: { ausgeloest: ISO, tag: "JJJJ-MM-TT" } } – wird nicht verändert, die Rückgabe enthält den neuen Zustand
  function pruefen(regeln, daten, zustandAlt = {}) {
    const zustand = JSON.parse(JSON.stringify(zustandAlt || {}));
    const jetzt = Number.isFinite(daten && daten.jetzt) ? daten.jetzt : Date.now();
    const tag = handelstag(daten && daten.uhr, jetzt);
    const ausgeloest = [];
    const hinweise = [];
    for (const regel of regeln || []) {
      const z = zustand[regel.id];
      if (regel.aktiv === false) { hinweise.push(`${text(regel)}: deaktiviert – nicht geprüft.`); continue; }
      if (regel.ablauf && jetzt > Date.parse(regel.ablauf + "T23:59:59Z")) { hinweise.push(`${text(regel)}: abgelaufen am ${regel.ablauf} – nicht geprüft.`); continue; }
      if (regel.art === "meldung" || regel.art === "nachricht") {
        // Stabile Kennung je Ereignis (Akzessionsnummer bzw. Nachrichten-ID): dasselbe Ereignis löst nie zweimal aus, auch nach Neuladen
        const liste = regel.art === "meldung" ? ((daten.meldungen || {})[regel.symbol]) : ((daten.nachrichten || {})[regel.symbol]);
        if (!Array.isArray(liste)) { hinweise.push(`${regel.symbol}: keine ${regel.art === "meldung" ? "Meldungsliste" : "Nachrichten"} geladen.`); continue; }
        const gesehen = new Set(z && Array.isArray(z.ereignisse) ? z.ereignisse : []);
        const ab = Date.parse(regel.angelegt);
        for (const ev of liste) {
          const kennung = regel.art === "meldung" ? ev.akz : ev.id;
          const zeit = Date.parse(regel.art === "meldung" ? ev.eingereicht + "T00:00:00Z" : ev.zeit);
          if (!kennung || gesehen.has(kennung) || !Number.isFinite(zeit) || zeit < ab - 86400000) continue;
          const passt = regel.art === "meldung" ? regel.auswahl.includes(ev.form) : regel.auswahl.includes("alle") || (ev.kennzeichen || []).some((k) => regel.auswahl.includes(k));
          if (!passt) continue;
          gesehen.add(kennung);
          ausgeloest.push({ id: regel.id + ":" + kennung, regel: regel.id, text: regel.art === "meldung" ? `${regel.symbol}: ${ev.form} eingereicht ${ev.eingereicht} (Akz. ${ev.akz})` : `${regel.symbol}: Nachricht „${String(ev.titel || "").slice(0, 80)}“ (${ev.zeit})`, ereignis: kennung });
        }
        if (gesehen.size) zustand[regel.id] = { ausgeloest: z && z.ausgeloest ? z.ausgeloest : new Date(jetzt).toISOString(), ereignisse: [...gesehen].slice(-200) };
        continue;
      }
      if (regel.art === "boersenoeffnung") {
        if (daten.uhr && daten.uhr.offen === true && !(z && z.tag === tag)) {
          zustand[regel.id] = { ausgeloest: new Date(jetzt).toISOString(), tag };
          ausgeloest.push({ id: regel.id, text: text(regel) });
        }
        continue;
      }
      const k = daten.kurse && daten.kurse[regel.symbol];
      if (!k || !(k.preis > 0)) { hinweise.push(`${regel.symbol}: kein Kurs.`); continue; }
      if (Number(k.alter_min) > MAX_ALTER_MIN) { hinweise.push(`${regel.symbol}: Kurs ${k.alter_min} min alt – nicht bewertet.`); continue; }
      const preis = k.preis;
      if (regel.art === "prozent") {
        const ref = daten.vortag && daten.vortag[regel.symbol];
        if (!(ref > 0)) { hinweise.push(`${regel.symbol}: Vortagesschluss fehlt.`); continue; }
        const bewegung = (preis / ref - 1) * 100;
        const trifft = regel.richtung === "auf" ? bewegung >= regel.prozent : regel.richtung === "ab" ? -bewegung >= regel.prozent : Math.abs(bewegung) >= regel.prozent;
        if (trifft && !(z && z.tag === tag)) {
          zustand[regel.id] = { ausgeloest: new Date(jetzt).toISOString(), tag };
          ausgeloest.push({ id: regel.id, text: `${text(regel)}: ${bewegung >= 0 ? "+" : ""}${bewegung.toFixed(2)} % (Kurs ${preis})`, kurs: preis });
        }
        continue;
      }
      const trifft = regel.art === "ueber" ? preis >= regel.preis : preis <= regel.preis;
      if (z && z.ausgeloest) {
        // Wieder scharf, sobald der Kurs auf die andere Seite zurückgefallen ist
        if (regel.wiederScharf && !trifft) delete zustand[regel.id];
        continue;
      }
      if (trifft) {
        zustand[regel.id] = { ausgeloest: new Date(jetzt).toISOString(), tag };
        ausgeloest.push({ id: regel.id, text: `${text(regel)} – Kurs ${preis}`, kurs: preis });
      }
    }
    return { ausgeloest, zustand, hinweise };
  }

  function zuruecksetzen(zustand, id) {
    const neu = { ...(zustand || {}) };
    delete neu[id];
    return neu;
  }

  // Gespeicherten Zustand prüfen: beschädigt → nicht verwenden, nichts verändern, nichts erneut auslösen
  function zustandPruefen(zustand) {
    if (!zustand || typeof zustand !== "object" || Array.isArray(zustand)) return { ok: false, grund: "Alarmzustand ist kein Objekt." };
    for (const [id, z] of Object.entries(zustand)) {
      if (!z || typeof z !== "object" || Array.isArray(z)) return { ok: false, grund: `Zustand von ${id} beschädigt.` };
      if (z.ausgeloest !== undefined && !Number.isFinite(Date.parse(z.ausgeloest))) return { ok: false, grund: `Auslösezeit von ${id} unlesbar.` };
      if (z.ereignisse !== undefined && !(Array.isArray(z.ereignisse) && z.ereignisse.every((x) => typeof x === "string"))) return { ok: false, grund: `Ereignisliste von ${id} beschädigt.` };
    }
    return { ok: true };
  }

  global.AktienAlarme = { regelNeu, pruefen, zuruecksetzen, zustandPruefen, text, ARTEN, FORMULARE, KENNZEICHEN, MAX_ALTER_MIN };
})(typeof window !== "undefined" ? window : globalThis);
