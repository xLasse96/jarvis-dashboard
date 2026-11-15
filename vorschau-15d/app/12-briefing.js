// JARVIS Dashboard – Modul „briefing“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Briefing: nur auf Knopfdruck oder Befehl, nur vorhandene Daten ----------
// Quellen: Worker /status, /trading/status, /markt (Binance-Testnet), /paper/status (Kurse Kraken), die zuletzt in der
// Analyse geladenen Kerzen (keine eigene Anfrage) und die Aufgaben dieses Geräts. Keine KI-, keine Google-Anfrage.
// Fehlt etwas, steht dort „nicht verfügbar“ mit Grund – es wird nichts geschätzt.
let briefingKerzen = null;
window.addEventListener("jarvis-kerzen", (e) => { briefingKerzen = e.detail ? { daten: e.detail, empfangen: Date.now() } : null; });

function briefingUhrzeit(ms) { return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

// Eigenes, kurzes Zeitlimit je Quelle: Das Briefing wartet auf die langsamste Quelle – mit dem allgemeinen Worker-Limit
// (120 s) blieb es bei einer hängenden Quelle bis zu zwei Minuten stumm. Zeitüberschreitung = „nicht verfügbar“, ohne
// Wiederholung, ohne zusätzliche Anfrage.
const BRIEFING = { zeitlimitMs: 8000 };
const briefingSekunden = (ms) => (ms / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " s";
// Messprotokoll des letzten Briefings (ms ab Klick bzw. je Quelle) – zur Ursachensuche, lesbar über window.briefingMessungLesen()
let briefingMessung = { quellen: {}, statusMs: null, datenMs: null, textMs: null, tonMs: null };
const BRIEFING_QUELLEN_NAMEN = { "/status": "Worker", "/trading/status": "Handel", "/markt": "Testnet-Kurse", "/paper/status": "Paper-Trading" };

async function briefingErstellen() {
  const knopf = document.getElementById("briefing-knopf");
  if (knopf.disabled) return null;
  knopf.disabled = true;
  const start = performance.now();
  briefingMessung = { quellen: {}, statusMs: null, datenMs: null, textMs: null, tonMs: null };
  // Sofort sichtbar, dass etwas passiert
  knopf.textContent = "Briefing wird erstellt …";
  const zeitFeld = document.getElementById("briefing-zeit");
  const bereichSofort = document.getElementById("briefing");
  zeitFeld.textContent = "wird erstellt …";
  bereichSofort.hidden = false;
  bereichSofort.setAttribute("aria-busy", "true");
  briefingMessung.statusMs = Math.round(performance.now() - start);
  const zeilen = [];
  const zeile = (bereich, inhalt, quelle, stand, fehlt) => zeilen.push({ bereich, inhalt, quelle, stand, fehlt: Boolean(fehlt) });
  try {
    const signal = () => (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(BRIEFING.zeitlimitMs) : undefined);
    // Die vier Quellen sind voneinander unabhängig und laufen parallel; je Quelle wird die Dauer gemessen (Messprotokoll)
    const anfragen = verbunden()
      ? await Promise.allSettled(["/status", "/trading/status", "/markt", "/paper/status"].map((pfad) => {
        const t = performance.now();
        const dauer = () => { briefingMessung.quellen[pfad] = Math.round(performance.now() - t); };
        return workerAnfrage(pfad, { method: "GET", signal: signal() })
          .then((d) => { dauer(); return { d, zeit: Date.now() }; }, (e) => { dauer(); throw e; });
      }))
      : null;
    const ergebnis = (i) => (anfragen ? anfragen[i] : { status: "rejected", reason: new Error("keine Verbindung eingerichtet") });
    const nicht = (r) => "nicht verfügbar – " + (r.reason && r.reason.message ? r.reason.message : "unbekannter Fehler");

    // Unvollständige Antworten nie als echte Werte zeigen (z. B. fehlendes Feld → „nicht eingerichtet“ oder null → „0 USDT“)
    const unvollstaendig = () => ({ status: "rejected", reason: new Error("unvollständige Antwort") });
    let r = ergebnis(0);
    if (r.status === "fulfilled" && (typeof r.value.d.ki_konfiguriert !== "boolean" || typeof r.value.d.kv_verbunden !== "boolean")) r = unvollstaendig();
    if (r.status === "fulfilled") {
      const s = r.value.d;
      zeile("Worker", "erreichbar · KI " + (s.ki_konfiguriert ? "eingerichtet" : "nicht eingerichtet") + " · Speicher " + (s.kv_verbunden ? "verbunden" : "fehlt"),
        "Worker /status", r.value.zeit);
    } else zeile("Worker", nicht(r), "Worker /status", null, true);

    r = ergebnis(1);
    // Unvollständige Antwort: Not-Aus nie als „aus“ darstellen, sondern als nicht verfügbar
    if (r.status === "fulfilled" && typeof r.value.d.notaus !== "boolean") {
      r = { status: "rejected", reason: new Error("unvollständige Antwort (Not-Aus-Zustand fehlt)") };
    }
    if (r.status === "fulfilled") {
      const s = r.value.d;
      zeile("Handel", (s.notaus ? "Not-Aus aktiv" : "Not-Aus aus (nur manuelle Testnet-Orders)") + " · Automatik AUS" + (Number.isFinite(s.orders_heute) ? " · Testnet-Orders heute " + s.orders_heute : ""),
        "Worker /trading/status", r.value.zeit);
    } else zeile("Handel", nicht(r), "Worker /trading/status", null, true);

    r = ergebnis(2);
    // Nur Kurse mit echtem Preis; eine fehlende Veränderung wird weggelassen statt als „0 %“ gezeigt
    const kurse = r.status === "fulfilled" && Array.isArray(r.value.d.kurse)
      ? r.value.d.kurse.filter((k) => k && typeof k.symbol === "string" && typeof k.preis === "number" && Number.isFinite(k.preis)) : [];
    if (kurse.length) {
      zeile("Testnet-Kurse", kurse.map((k) => k.symbol.replace(/USDT$/, "") + " " + zahl(k.preis, 2) + " USDT"
        + (typeof k.aenderung_prozent === "number" && Number.isFinite(k.aenderung_prozent) ? " (" + (k.aenderung_prozent >= 0 ? "+" : "") + zahl(k.aenderung_prozent, 2) + " %)" : "")).join(" · "),
        "Binance-Testnet über Worker /markt – kann vom echten Markt abweichen", r.value.zeit);
    } else zeile("Testnet-Kurse", r.status === "fulfilled" ? "nicht verfügbar – keine gültigen Kurse geliefert" : nicht(r), "Worker /markt", null, true);

    const kerzenOk = briefingKerzen && briefingKerzen.daten && Array.isArray(briefingKerzen.daten.kerzen) && briefingKerzen.daten.kerzen.length
      && ((briefingKerzen.daten.zusammenfassung && typeof briefingKerzen.daten.zusammenfassung.schlusskurs === "number")
        || Number.isFinite((briefingKerzen.daten.kerzen[briefingKerzen.daten.kerzen.length - 1] || {}).c));
    if (kerzenOk) {
      const k = briefingKerzen.daten;
      const z = k.zusammenfassung;
      const letzte = k.kerzen[k.kerzen.length - 1];
      zeile("Marktdaten " + k.symbol + " " + k.intervall, z && typeof z.schlusskurs === "number"
        ? "Letzte abgeschlossene Kerze " + new Date(z.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + " · Schluss " + zahl(z.schlusskurs, 2) + " USDT"
          + (z.rsi14 === null || z.rsi14 === undefined ? "" : " · RSI 14 " + zahl(z.rsi14, 1))
        : "Letzter Kurs " + zahl(letzte.c, 2) + " USDT",
        "Analyse (" + (k.quelle_name || k.quelle) + "), zuletzt geladen – keine neue Anfrage", k.abgerufen ? new Date(k.abgerufen).getTime() : briefingKerzen.empfangen);
    } else zeile("Marktdaten", "nicht verfügbar – Analyse in dieser Sitzung noch nicht geladen (Reiter „Analyse“)", "Analyse", null, true);

    r = ergebnis(3);
    if (r.status === "fulfilled" && r.value.d.simulation && !(typeof r.value.d.usdt === "number" && Number.isFinite(r.value.d.usdt) && Array.isArray(r.value.d.positionen))) r = unvollstaendig();
    if (r.status === "fulfilled" && r.value.d.simulation) {
      const s = r.value.d;
      zeile("Paper-Trading", zahl(s.usdt, 2) + " USDT Spielgeld frei · " + s.positionen.length + " Position(en)"
        + (typeof s.gesamtwert_usdt === "number" && Number.isFinite(s.gesamtwert_usdt) ? " · Gesamtwert " + zahl(s.gesamtwert_usdt, 2) + " USDT" : " · Gesamtwert nicht verfügbar (Kurse fehlen)"),
        "Worker /paper/status (Simulation, Kurse Kraken)", r.value.zeit);
    } else zeile("Paper-Trading", r.status === "fulfilled" ? "nicht verfügbar – unerwartete Antwort" : nicht(r), "Worker /paper/status", null, true);

    if (window.aufgabenIntern) {
      const alle = window.aufgabenIntern.liste();
      const offen = alle.filter((a) => !a.erledigt);
      const faellig = offen.filter((a) => a.faellig && new Date(a.faellig).getTime() <= Date.now());
      zeile("Aufgaben", offen.length + " offen" + (faellig.length ? ", davon " + faellig.length + " fällig: " + faellig.slice(0, 3).map((a) => a.titel).join(", ") : ""),
        "dieses Gerät", Date.now());
    }
    // US-Aktien (ab 11-02a): nur das Aktienprofil dieser Sitzung, keine Anfrage; ohne Profil keine Zeile
    if (typeof APROFIL !== "undefined" && APROFIL.letzteDispatch && window.AktienAssistent) {
      const b = window.AktienAssistent.briefingErstellen(APROFIL.letzteDispatch, SIM.portfolio, { variante: "kurz", jetzt: Date.now() });
      const belegt = b.zeilen.filter((x) => x.belegt).slice(0, 2).map((x) => x.inhalt).join(" ");
      const zrA = APROFIL.letzteDispatch.kontext.zeitraum;
      zeile("US-Aktien " + APROFIL.letzteDispatch.kontext.symbol + (zrA ? ` (Zeitraum ${zrA.von} bis ${zrA.bis}, nur Kursdaten)` : " (kein Zeitraum – alle Tageskerzen)"), belegt || "Profil ohne belegte Daten", "Aktienprofil dieser Sitzung (keine neue Anfrage)", APROFIL.letzteDispatch.kontext.jetzt, !belegt);
    }
  } finally {
    knopf.disabled = false;
    knopf.textContent = "Briefing starten";
    bereichSofort.removeAttribute("aria-busy");
  }
  zeilen.datenMs = performance.now() - start; // Messwert für die Anzeige (Daten nach … s)
  briefingMessung.datenMs = Math.round(zeilen.datenMs);

  const tabelle = document.getElementById("briefing-tabelle");
  tabelle.replaceChildren(...zeilen.map((z) => {
    const tr = document.createElement("tr");
    const th = Object.assign(document.createElement("th"), { scope: "row", textContent: z.bereich });
    const td = document.createElement("td");
    const inhalt = Object.assign(document.createElement("span"), { textContent: z.inhalt, className: z.fehlt ? "fehlt" : "" });
    const quelle = Object.assign(document.createElement("span"), { className: "quelle", textContent: "Quelle: " + z.quelle + (z.stand ? " · Stand " + briefingUhrzeit(z.stand) : "") });
    td.append(inhalt, quelle);
    tr.append(th, td);
    return tr;
  }));
  // Anzeige: Gesamtdauer der Datenphase, langsamste Quelle (Ursache einer langen Wartezeit) und ob etwas fehlt
  const langsamste = Object.entries(briefingMessung.quellen).sort((a, b) => b[1] - a[1])[0];
  const fehlend = zeilen.filter((z) => z.fehlt).length;
  document.getElementById("briefing-zeit").textContent = "erstellt " + briefingUhrzeit(Date.now()) + " · Daten nach " + briefingSekunden(zeilen.datenMs)
    + (langsamste ? " (langsamste Quelle: " + BRIEFING_QUELLEN_NAMEN[langsamste[0]] + " " + briefingSekunden(langsamste[1]) + ")" : "")
    + (fehlend ? " · unvollständig: " + fehlend + (fehlend === 1 ? " Bereich" : " Bereiche") + " nicht verfügbar" : "");
  const bereich = document.getElementById("briefing");
  bereich.hidden = false;
  if (typeof bereich.scrollIntoView === "function") bereich.scrollIntoView({ block: "nearest" });
  return zeilen;
}

// Liest den Briefing-Inhalt genau einmal vor – über den gemeinsamen Weg aller lokalen Antworten (Google /sprechen, bei einem
// Fehler Browserstimme mit Hinweis). lokalVorlesen beachtet „Vorlesen: aus“. Nicht während einer laufenden Aufnahme.
// start: Zeitpunkt des Klicks (performance.now) – misst, wann die Stimme wirklich beginnt, und zeigt es an.
function briefingVorlesen(zeilen, start) {
  if (!zeilen || typeof lokalVorlesen !== "function" || (window.spracheingabeLaeuft && window.spracheingabeLaeuft())) return;
  if (sprache.vorlesen && typeof start === "number") briefingStimmeMessen(start);
  const text = "Briefing. " + zeilen.map((z) => z.bereich + ": " + z.inhalt).join(". ") + ".";
  if (typeof start === "number") briefingMessung.textMs = Math.round(performance.now() - start);
  // Unmittelbar weiter an den Vorleseweg – keine Wartezeit dazwischen
  lokalVorlesen(text, false, { kurzerAnfang: true });
}

// Wartet einmalig auf den Beginn der Wiedergabe (Kern „spricht“ – Google-Audio wie Browserstimme) und ergänzt die Anzeige.
function briefingStimmeMessen(start) {
  const kern = document.getElementById("kern");
  const feld = document.getElementById("briefing-zeit");
  feld.textContent = feld.textContent.replace(/ · Stimme .*$/, "") + " · Stimme wird vorbereitet …";
  const beobachter = new MutationObserver(() => {
    if (!kern.classList.contains("spricht")) return;
    beobachter.disconnect();
    clearTimeout(uhr);
    briefingMessung.tonMs = Math.round(performance.now() - start);
    feld.textContent = feld.textContent.replace(/ · Stimme .*$/, "") + " · Stimme nach " + briefingSekunden(briefingMessung.tonMs);
  });
  beobachter.observe(kern, { attributes: true, attributeFilter: ["class"] });
  // Kommt keine Wiedergabe (z. B. Vorlesen inzwischen abgeschaltet), Hinweis nach 60 s wieder entfernen
  const uhr = setTimeout(() => { beobachter.disconnect(); feld.textContent = feld.textContent.replace(/ · Stimme wird vorbereitet …$/, ""); }, 60000);
}

// Knopf „Briefing starten“: erstellen und vorlesen (früher nur erstellt – vorgelesen wurde nur beim Sprachbefehl).
// Ein zweiter Klick während des Erstellens liefert null und liest deshalb nichts ein zweites Mal vor.
// Erstellen mit Fehlerschutz (Knopf und Sprachbefehl): Bei einem unerwarteten Fehler wird „wird erstellt …“ ersetzt und die
// Tabelle des vorigen Briefings geleert – alte Werte dürfen nicht wie aktuelle aussehen. Rückgabe: Zeilen oder null.
async function briefingErstellenSicher() {
  try {
    return await briefingErstellen();
  } catch (e) {
    const knopf = document.getElementById("briefing-knopf");
    knopf.disabled = false;
    knopf.textContent = "Briefing starten";
    document.getElementById("briefing").removeAttribute("aria-busy");
    document.getElementById("briefing-tabelle").replaceChildren();
    document.getElementById("briefing-zeit").textContent = "Briefing konnte nicht erstellt werden: " + (e && e.message ? e.message : "unbekannter Fehler");
    return null;
  }
}

async function briefingStarten() {
  const start = performance.now();
  const zeilen = await briefingErstellenSicher();
  briefingVorlesen(zeilen, start);
  return zeilen;
}
document.getElementById("briefing-knopf").addEventListener("click", () => briefingStarten());
window.briefingMessungLesen = () => JSON.parse(JSON.stringify(briefingMessung));

skillRegistrieren({
  name: "briefing",
  risiko: "abfrage",
  beschreibung: "Briefing aus vorhandenen Daten (Worker, Testnet-Kurse, Paper, Aufgaben) – ohne KI-Anfrage",
  beispiele: ["Briefing", "Lagebericht"],
  passt: (text) => /^((gib mir )?(ein |das |mein )?briefing( bitte)?|lagebericht|statusbericht)$/.test(befehlNormalisieren(text)),
  aktion: async () => {
    const start = performance.now();
    const laeuftSchon = document.getElementById("briefing-knopf").disabled;
    const zeilen = await briefingErstellenSicher();
    if (!zeilen) {
      if (!laeuftSchon) lokalAntworten(document.getElementById("briefing-zeit").textContent, "fehler");
      return true;
    }
    const fehlend = zeilen.filter((z) => z.fehlt).length;
    nachrichtAnzeigen("JARVIS: Briefing erstellt – siehe Karte „System“ links." + (fehlend ? " " + fehlend + " Bereich(e) derzeit nicht verfügbar." : ""), "jarvis");
    briefingVorlesen(zeilen, start); // gleicher Weg wie der Knopf
    return true;
  },
});

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("briefing");
