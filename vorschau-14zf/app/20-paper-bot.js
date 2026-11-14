// JARVIS Dashboard – Modul „paper-bot“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Paper-Bot (nur Simulation, virtuelles Guthaben) ----------
// Rechenkern: bot/paper-bot.js (= module/paper-bot, kein Netzwerk). Diese Karte holt nur öffentliche Kerzen über
// GET /kerzen und reicht ausschließlich ABGESCHLOSSENE Kerzen weiter (Eröffnung + Intervall ≤ jetzt). Der Bot führt ein
// Signal frühestens zur Eröffnung der nächsten Kerze aus. Dieser Block ruft keine Order-, Paper-Konto- oder Not-Aus-
// Endpunkte auf (per Test geprüft).
const PAPERBOT = {
  schluessel: "jarvis-paper-bot",
  intervallMs: { "15m": 900000, "1h": 3600000, "4h": 14400000 },
  symbole: ["BTCUSDT", "ETHUSDT"],
  stopWerte: ["", "0.03", "0.05", "0.1"],
  anzahl: 300,         // Kerzen je Abruf (Worker: 50–500)
  mindestVorlauf: 30,   // so viele abgeschlossene Kerzen braucht die EMA 21 mindestens
  abrufMs: 60000,       // Abfrage im laufenden Betrieb
  parameter: { kurz: 9, lang: 21 },
  maxOrders: 200,
};
let paperBot = null;      // Bot aus bot/paper-bot.js
let paperBotMeta = null;  // { symbol, intervall, letzteT, luecken }
let paperBotUhr = null;
let paperBotAbruf = null; // laufender Abruf (kein zweiter gleichzeitig)
let paperBotHinweis = { text: "", art: "" };

function paperBotStatus(text, art = "") {
  paperBotHinweis = { text, art };
  const el = document.getElementById("bot-status");
  el.textContent = text;
  el.dataset.art = art;
}

function paperBotSpeichern() {
  if (!paperBot) return;
  // ab 11-06d: Stand eines anderen Tabs, der inzwischen beschädigt wurde, nicht still überschreiben
  if (paperBotGespeichert().fehler) { paperBotStatus("Gespeicherter Bot-Stand ist beschädigt – nicht überschrieben; dieser Stand gilt nur für diese Sitzung. „Neu beginnen“ löscht den beschädigten Stand.", "fehler"); return; }
  try {
    localStorage.setItem(PAPERBOT.schluessel, JSON.stringify({ version: 1, ...paperBotMeta, zustand: paperBot.alsJson() }));
  } catch (e) {
    paperBotStatus("Stand konnte nicht im Browser gespeichert werden (Speicher voll oder gesperrt) – er gilt nur für diese Sitzung.", "warn");
  }
}

// Gespeicherten Stand lesen: { leer } | { bot, d } | { fehler }. Ab 11-06d auch vor „Bot starten“ gelesen (siehe paperBotStarten).
function paperBotGespeichert() {
  let roh = null;
  try { roh = localStorage.getItem(PAPERBOT.schluessel); } catch (e) { roh = null; }
  if (!roh) return { leer: true };
  let d = null;
  try { d = JSON.parse(roh); } catch (e) { d = null; }
  const bot = d && d.version === 1 && PAPERBOT.symbole.includes(d.symbol) && PAPERBOT.intervallMs[d.intervall] && typeof d.zustand === "string"
    ? window.PaperBot.ausJson(d.zustand) : { fehler: "unbekanntes Format" };
  return bot.fehler ? { fehler: bot.fehler } : { bot, d };
}

function paperBotLaden() {
  const g = paperBotGespeichert();
  if (g.leer) return;
  const { bot, d } = g.fehler ? { bot: g, d: null } : g;
  if (bot.fehler) {
    // Nicht still löschen: der Nutzer entscheidet mit „Neu beginnen“
    paperBotStatus("Gespeicherter Bot-Stand ist ungültig (" + bot.fehler + ") und wurde nicht geladen. „Neu beginnen“ löscht ihn.", "fehler");
    return;
  }
  paperBot = bot;
  paperBotMeta = { symbol: d.symbol, intervall: d.intervall, stop: PAPERBOT.stopWerte.includes(d.stop) ? d.stop : "",
    letzteT: Number(d.letzteT) || 0, luecken: Number(d.luecken) || 0 };
}

// Aus einer /kerzen-Antwort die neuen, abgeschlossenen Kerzen (aufsteigend, ohne Doppelte) – mit Lückenzählung
function paperBotNeueKerzen(liste, letzteT, intervall, jetzt) {
  const dauer = PAPERBOT.intervallMs[intervall];
  const gesehen = new Set();
  const neu = (Array.isArray(liste) ? liste : [])
    .filter((k) => k && [k.t, k.o, k.h, k.l, k.c].every(Number.isFinite) && k.t + dauer <= jetzt && k.t > letzteT)
    .sort((a, b) => a.t - b.t)
    .filter((k) => (gesehen.has(k.t) ? false : gesehen.add(k.t)));
  let luecken = 0;
  let vorher = letzteT;
  for (const k of neu) {
    if (vorher && k.t - vorher > dauer) luecken += Math.round((k.t - vorher) / dauer) - 1;
    vorher = k.t;
  }
  return { neu, luecken };
}

async function paperBotKerzenHolen(symbol, intervall) {
  const d = await workerAnfrage("/kerzen?symbol=" + encodeURIComponent(symbol) + "&intervall=" + encodeURIComponent(intervall) + "&anzahl=" + PAPERBOT.anzahl, { method: "GET" });
  if (!d || !Array.isArray(d.kerzen) || (d.symbol && d.symbol !== symbol) || (d.intervall && d.intervall !== intervall)) {
    throw new Error("Unvollständige Antwort von /kerzen.");
  }
  return d.kerzen;
}

// Neue abgeschlossene Kerzen abholen und dem Bot geben. Angehalten: Kerzen nur mitschreiben (Indikatoren), nie handeln.
// Ergebnis: true = Antwort verarbeitet, false = nichts abrufbar
function paperBotAbrufen() {
  if (!paperBot || !paperBotMeta) return Promise.resolve(false);
  if (paperBotAbruf) return paperBotAbruf;
  paperBotAbruf = (async () => {
    if (!verbunden()) { paperBotStatus("Keine Verbindung eingerichtet – der Bot wartet, es wird nichts ausgeführt.", "warn"); return false; }
    try {
      const kerzen = await paperBotKerzenHolen(paperBotMeta.symbol, paperBotMeta.intervall);
      const { neu, luecken } = paperBotNeueKerzen(kerzen, paperBotMeta.letzteT, paperBotMeta.intervall, Date.now());
      let orders = 0;
      for (const k of neu) {
        const r = paperBot.kerzeVerarbeiten(k);
        if (!r.fehler) { orders += r.orders.length; paperBotMeta.letzteT = k.t; }
      }
      paperBotMeta.luecken += luecken;
      paperBotSpeichern();
      const dauer = PAPERBOT.intervallMs[paperBotMeta.intervall];
      const spaet = Date.now() - (paperBotMeta.letzteT + dauer) > dauer; // die nächste Kerze wäre schon abgeschlossen
      if (luecken) paperBotStatus("Lücke in den Kerzen: " + luecken + " fehlende Kerze(n) übersprungen – der Bot rechnet mit der nächsten vorhandenen Kerze weiter.", "warn");
      else if (spaet) paperBotStatus("Kerzen verspätet: seit " + paperBotZeit(paperBotMeta.letzteT + dauer) + " keine neue abgeschlossene Kerze – der Bot wartet, nichts wird geschätzt.", "warn");
      else paperBotStatus((neu.length ? neu.length + " neue abgeschlossene Kerze(n) verarbeitet" + (orders ? ", " + orders + " simulierte Order(s)" : "") : "Keine neue abgeschlossene Kerze")
        + " · Abruf " + new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + ".");
      return true;
    } catch (e) {
      paperBotStatus("Kerzen nicht abrufbar: " + e.message + " – der Bot wartet, es wird nichts ausgeführt.", "fehler");
      return false;
    } finally {
      paperBotAnzeigen(true);
    }
  })().finally(() => { paperBotAbruf = null; });
  return paperBotAbruf;
}

function paperBotUhrSetzen() {
  clearInterval(paperBotUhr);
  paperBotUhr = paperBot && paperBot.stand().laeuft ? setInterval(paperBotAbrufen, PAPERBOT.abrufMs) : null;
}

async function paperBotStarten() {
  const knopf = document.getElementById("bot-start");
  if (knopf.disabled) return;
  if (!verbunden()) { paperBotStatus("Bitte zuerst im Cockpit die Verbindung einrichten – der Bot braucht Kerzen von /kerzen.", "fehler"); return; }
  // ab 11-06d: ein beschädigter gespeicherter Stand wird nie durch einen neuen Bot überschrieben – nur „Neu beginnen“ oder
  // „Daten auf diesem Gerät“ löschen ihn (vorher bei Bedarf „Sicherung exportieren“). Der Knopf bleibt bedienbar und erklärt das.
  if (!paperBot) {
    const g = paperBotGespeichert();
    if (g.fehler) { paperBotStatus("Gespeicherter Bot-Stand ist beschädigt (" + g.fehler + ") – nichts wird überschrieben, der Bot startet nicht. „Neu beginnen“ löscht ihn (vorher bei Bedarf „Sicherung exportieren“).", "fehler"); return; }
  }
  // Per Tastatur gedrückt: der Knopf sperrt sich gleich selbst – Fokus danach auf den jetzt bedienbaren Knopf
  const hatteFokus = document.activeElement === knopf;
  knopf.disabled = true;
  try {
    if (!paperBot) {
      const symbol = document.getElementById("bot-symbol").value;
      const intervall = document.getElementById("bot-intervall").value;
      const stop = document.getElementById("bot-stop").value;
      if (!PAPERBOT.symbole.includes(symbol) || !PAPERBOT.intervallMs[intervall] || !PAPERBOT.stopWerte.includes(stop)) throw new Error("Ungültige Auswahl.");
      const bot = window.PaperBot.erstellen({ strategie: "ema-kreuzung", parameter: PAPERBOT.parameter, stopVerlust: stop ? Number(stop) : null, maxOrders: PAPERBOT.maxOrders });
      if (bot.fehler) throw new Error(bot.fehler);
      paperBotStatus("Lade abgeschlossene Kerzen als Vorlauf …");
      const { neu } = paperBotNeueKerzen(await paperBotKerzenHolen(symbol, intervall), 0, intervall, Date.now());
      if (neu.length < PAPERBOT.mindestVorlauf) throw new Error("Zu wenige abgeschlossene Kerzen (" + neu.length + ", nötig " + PAPERBOT.mindestVorlauf + ").");
      const v = bot.vorlaufLaden(neu);
      if (v.fehler) throw new Error(v.fehler);
      paperBot = bot;
      paperBotMeta = { symbol, intervall, stop, letzteT: neu[neu.length - 1].t, luecken: 0 };
    } else {
      // Fortsetzen: Kerzen aus der Pause zuerst nur mitschreiben (kein nachträglicher Handel in der Pause).
      // Scheitert das, bleibt der Bot angehalten – sonst würde er die Pause später nachträglich handeln.
      if (!(await paperBotAbrufen())) throw new Error("Kerzen nicht abrufbar – der Bot bleibt angehalten.");
    }
    paperBot.starten();
    paperBotSpeichern();
    paperBotUhrSetzen();
    paperBotStatus("Bot läuft – handelt ab der nächsten abgeschlossenen Kerze (" + paperBotMeta.symbol + ", " + paperBotMeta.intervall + ").");
  } catch (e) {
    paperBotStatus("Bot nicht gestartet: " + e.message, "fehler");
  } finally {
    paperBotAnzeigen(true);
    if (hatteFokus) document.getElementById(knopf.disabled ? "bot-anhalten" : "bot-start").focus();
  }
}

function paperBotAnhalten() {
  if (!paperBot) return;
  const hatteFokus = document.activeElement === document.getElementById("bot-anhalten");
  paperBot.anhalten();
  paperBotSpeichern();
  paperBotUhrSetzen();
  paperBotStatus("Bot angehalten. Eine noch geplante Order wurde verworfen; eine offene Position bleibt bestehen.");
  paperBotAnzeigen(true);
  if (hatteFokus) document.getElementById("bot-start").focus(); // „Anhalten“ ist jetzt gesperrt
}

function paperBotNeu() {
  if (!paperBot && !paperBotHinweis.art) return;
  if (!confirm("Paper-Bot neu beginnen? Virtuelles Guthaben, Position und Order-Journal dieses Geräts werden gelöscht.")) return;
  clearInterval(paperBotUhr);
  paperBotUhr = null;
  paperBot = null;
  paperBotMeta = null;
  try { localStorage.removeItem(PAPERBOT.schluessel); } catch (e) { /* nur diese Sitzung */ }
  paperBotStatus("Zurückgesetzt. Markt, Kerzen und Stop-Verlust wählen, dann „Bot starten“.");
  paperBotAnzeigen(true);
}

function paperBotZeit(t) {
  return new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const botZahl = (x, stellen = 2) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen });

function paperBotAnzeigen(statusBehalten) {
  const s = paperBot ? paperBot.stand() : null;
  const laeuft = Boolean(s && s.laeuft);
  document.getElementById("bot-start").disabled = laeuft;
  document.getElementById("bot-start").textContent = s ? (laeuft ? "Bot läuft" : "Fortsetzen") : "Bot starten";
  document.getElementById("bot-anhalten").disabled = !laeuft;
  // Markt, Kerzen und Stop gelten für eine ganze Simulation – ändern nur nach „Neu beginnen“
  for (const id of ["bot-symbol", "bot-intervall", "bot-stop"]) document.getElementById(id).disabled = Boolean(s);
  if (s && paperBotMeta) {
    document.getElementById("bot-symbol").value = paperBotMeta.symbol;
    document.getElementById("bot-intervall").value = paperBotMeta.intervall;
    document.getElementById("bot-stop").value = paperBotMeta.stop;
  }
  const konto = document.getElementById("bot-konto");
  konto.replaceChildren();
  const zeile = (name, wert) => { const dt = document.createElement("dt"); dt.textContent = name; const dd = document.createElement("dd"); dd.textContent = wert; konto.append(dt, dd); };
  if (s) {
    const basis = paperBotMeta.symbol.replace(/USDT$/, "");
    zeile("Zustand", (laeuft ? "läuft" : "angehalten") + (s.meldung && !laeuft ? " – " + s.meldung : ""));
    zeile("Markt", paperBotMeta.symbol + " · " + paperBotMeta.intervall + "-Kerzen · EMA " + s.parameter.kurz + "/" + s.parameter.lang);
    zeile("Virtuelle Kasse", botZahl(s.bargeld_usdt) + " USDT");
    zeile("Position", s.position ? botZahl(s.position.menge, 6) + " " + basis + " zu " + botZahl(s.position.einstieg_preis) + " USDT · Wert "
      + botZahl(s.position.wert_usdt) + " USDT (" + (s.position.ergebnis_usdt >= 0 ? "+" : "") + botZahl(s.position.ergebnis_usdt) + ")" : "keine");
    zeile("Gesamtwert", botZahl(s.gesamtwert_usdt) + " USDT (" + (s.gewinn_prozent >= 0 ? "+" : "") + botZahl(s.gewinn_prozent) + " % seit Start mit " + botZahl(s.startkapital, 0) + " USDT)");
    zeile("Gebühren / max. Rückgang", botZahl(s.gebuehren_usdt) + " USDT / " + botZahl(s.max_rueckgang_prozent) + " %");
    zeile("Nächste Order", s.geplant ? (s.geplant.seite === "kauf" ? "Kauf" : "Verkauf") + " zur Eröffnung der nächsten Kerze (" + s.geplant.grund + ")" : "keine geplant");
    zeile("Letzte Kerze", paperBotMeta.letzteT ? paperBotZeit(paperBotMeta.letzteT) + " (abgeschlossen) · " + s.kerzen_verarbeitet + " seit Start" + (paperBotMeta.luecken ? " · " + paperBotMeta.luecken + " fehlende übersprungen" : "") : "–");
  }
  const liste = document.getElementById("bot-journal");
  liste.replaceChildren();
  const journal = paperBot ? paperBot.journal().slice(-50).reverse() : [];
  if (!journal.length) { const li = document.createElement("li"); li.textContent = "Noch keine simulierte Order."; liste.append(li); }
  for (const o of journal) {
    const li = document.createElement("li");
    li.textContent = "#" + o.nr + " · " + paperBotZeit(o.zeit) + " · " + (o.seite === "kauf" ? "KAUF " : "VERKAUF ") + botZahl(o.menge, 6) + " "
      + paperBotMeta.symbol.replace(/USDT$/, "") + " zu " + botZahl(o.preis) + " USDT · Betrag " + botZahl(o.betrag_usdt) + " · Gebühr " + botZahl(o.gebuehr_usdt)
      + " · " + o.grund + " · simuliert";
    liste.append(li);
  }
  if (!statusBehalten && s) paperBotStatus(laeuft ? "Bot läuft (gespeicherter Stand) – hole verpasste abgeschlossene Kerzen nach …" : "Bot angehalten (gespeicherter Stand). „Fortsetzen“ startet ihn wieder.");
}

document.getElementById("bot-start").addEventListener("click", paperBotStarten);
document.getElementById("bot-anhalten").addEventListener("click", paperBotAnhalten);
document.getElementById("bot-neu").addEventListener("click", paperBotNeu);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && paperBot && paperBot.stand().laeuft) paperBotAbrufen(); });
paperBotLaden();
paperBotAnzeigen(Boolean(paperBotHinweis.art));
if (paperBot && paperBot.stand().laeuft) { paperBotUhrSetzen(); paperBotAbrufen(); }

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("paper-bot");
