// JARVIS Aktien – Aktienprofil (ab Dashboard 2026-11-01d). Ein gemeinsamer Kontext je US-Aktie und ein Dispatcher, der die
// VORHANDENEN Werkzeuge aufruft (keine Ersatzmodule): Ablauf (AktienWorkflow), Nachrichten (AktienNachrichten), Meldungen (Copycat/
// Kongress über AktienWorkflow.meldungenAuswerten), Alarme (AktienAlarme), Budget (AktienBudget), Rebalancing (AktienRebalance),
// Paper-Vorschlag (PaperKern). Reine Rechnung ohne eigenes Netz: Daten kommen als „eingaben“ (vom Dashboard, Mock oder Testdatei).
// Grundsätze:
//   - Der Kontext wird geprüft, BEVOR irgendein Werkzeug läuft. Ungültig → kein Werkzeug startet.
//   - Fehlt einem Werkzeug eine Eingabe oder ein Grenzwert, läuft es NICHT mit Standardwerten, sondern meldet „nicht verfügbar“ bzw.
//     „blockiert“ mit Grund und nächstem sicherem Schritt.
//   - Jede Sektion behält eigenen Status, eigene Quellen und eigenes Datenalter; ein Teilausfall verdeckt die übrigen Ergebnisse nicht.
//   - Kein Werkzeug sendet eine Order. Ein Paper-Vorschlag führt höchstens nach Bestätigung GENAU dieses Vorschlags in den Paper-Kern.
(function (global) {
  "use strict";

  const US_TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
  const TAG = 86400000;
  const STATUS = ["ok", "warnung", "blockiert", "nicht_verfuegbar", "fehler", "veraltet", "unbekannt"];
  // Paper-Bestätigung gilt wie eine Risiko-Prüfung im Projekt 15 Minuten (AKTIEN_PRUEFUNG_GUELTIG_MS im Worker/Dashboard)
  const VORSCHLAG_GUELTIG_MS = 15 * 60000;
  const ANWEISUNG = /ignore (all |any )?(previous|prior) instructions|disregard .*instructions|system prompt|du bist (jetzt|nun)|vergiss (alle|deine)|freigabecode|x-jarvis|not-?aus (aufheben|deaktivieren)|order (senden|ausführen|freigeben)|place (an |the )?order|\b(buy|sell) now\b|kaufe? (jetzt|sofort)|<\s*script/i;

  // Einordnung je Werkzeug laut docs/TRADER_SKILL_ABGLEICH.md (§1, §2, §8a, §8b). „trader-skill“ nur, wo der Abgleich das belegt.
  const SKILL = {
    analyse: { skill: null, einordnung: "JARVIS-eigen", hinweis: "Chart-Scanner, Entry-Timer, Exit-Planer – nicht im Trader-Skill" },
    sec: { skill: "trader-analyst", einordnung: "Trader-Skill (umgesetzt)", hinweis: "Sollwerte des Originals geprüft; Pressemitteilung nicht gesucht" },
    screener: { skill: "trader-screener", einordnung: "Trader-Skill (umgesetzt)", hinweis: "plus JARVIS-eigene technische Kennzahlen" },
    nachrichten: { skill: "trader-news", einordnung: "Trader-Skill (umgesetzt, andere Quelle)", hinweis: "Quelle Alpaca-News statt Yahoo-RSS; Zuordnung im Profil nur über strukturierte Symbole oder Ticker-Nennung (JARVIS-Regel)" },
    meldungen: { skill: "trader-copycat, trader-pelosi", einordnung: "Trader-Skill (teilweise)", hinweis: "OpenFIGI, PDF-Auslesen, Senat automatisch und Form-4-Inhalt nicht verfügbar" },
    alarme: { skill: "trader-alerts", einordnung: "Trader-Skill (umgesetzt, andere Quelle)", hinweis: "Kurse Alpaca IEX statt Yahoo/Stooq; Alarmarten Meldung/Nachricht, Ablauf und Deaktivieren sind JARVIS-eigen" },
    budget: { skill: "trader-budget", einordnung: "Trader-Skill (umgesetzt)", hinweis: "Dollar-Beträge statt ganzer Stück" },
    rebalance: { skill: "trader-rebalance", einordnung: "Trader-Skill (umgesetzt)", hinweis: "Verkäufe in Dollar statt Stück, kein Steuer-Schritt" },
    paper: { skill: null, einordnung: "JARVIS-eigen", hinweis: "lokale Simulation; trader-broker/trader-risk laufen nur im Worker und werden hier nie ausgelöst" },
  };

  // ---------- Kontext ----------
  // e: { symbol, quelle: "lokal"|"worker", zeitraum: {von, bis} (optional, JJJJ-MM-TT), sitzung: {id}, jetzt }
  function kontextNeu(e = {}) {
    const fehler = [];
    const symbol = String(e.symbol == null ? "" : e.symbol).trim().toUpperCase();
    if (!US_TICKER.test(symbol)) fehler.push(symbol ? `„${symbol.slice(0, 12)}“ ist kein gültiges US-Aktiensymbol.` : "Kein Symbol angegeben.");
    if (!["lokal", "worker"].includes(e.quelle)) fehler.push("Datenquelle fehlt oder ist unbekannt (lokal oder worker).");
    let zeitraum = null;
    if (e.zeitraum) {
      const von = Date.parse((e.zeitraum.von || "") + "T00:00:00Z"), bis = Date.parse((e.zeitraum.bis || "") + "T00:00:00Z");
      if (!Number.isFinite(von) || !Number.isFinite(bis) || von > bis) fehler.push("Zeitraum ungültig (von ≤ bis, JJJJ-MM-TT).");
      else zeitraum = { von: e.zeitraum.von, bis: e.zeitraum.bis };
    }
    const jetzt = Number.isFinite(e.jetzt) ? e.jetzt : NaN;
    if (!Number.isFinite(jetzt)) fehler.push("Bezugszeit (jetzt) fehlt.");
    const sitzung = e.sitzung && typeof e.sitzung.id === "string" && e.sitzung.id ? { id: e.sitzung.id.slice(0, 40) } : null;
    if (!sitzung) fehler.push("Sitzungskennung fehlt.");
    if (fehler.length) return { ok: false, fehler };
    return { ok: true, kontext: Object.freeze({ symbol, quelle: e.quelle, zeitraum, jetzt, sitzung, datenzeitpunkte: {} }) };
  }

  // ---------- Zeitraum (ab Dashboard 11-02b) ----------
  // Tageskerzen auf [von, bis] (UTC-Tage, beide einschließlich) beschränken. Kerzen ohne erkennbare Zeit bleiben drin – die Datenprüfung
  // (JarvisDaten.kerzenPruefen) meldet sie als ungültig, statt sie still zu verwerfen.
  function kerzeZeit(x) { return x && Number.isFinite(x.t) ? x.t : x ? Date.parse(x.t || x.zeit || x.time || "") : NaN; }
  function kerzenImZeitraum(kerzen, zeitraum) {
    if (!zeitraum || !Array.isArray(kerzen)) return kerzen;
    const von = Date.parse(zeitraum.von + "T00:00:00Z"), bisEnde = Date.parse(zeitraum.bis + "T00:00:00Z") + 86400000;
    return kerzen.filter((x) => { const t = kerzeZeit(x); return !Number.isFinite(t) || (t >= von && t < bisEnde); });
  }
  // Provider, dessen Kerzen auf den Zeitraum beschränkt sind (alle anderen Arten unverändert); Beschreibung nennt den Zeitraum
  function providerImZeitraum(provider, zeitraum) {
    if (!zeitraum || !provider || typeof provider.kerzen !== "function") return provider;
    return { ...provider, beschreibung: `${provider.beschreibung ? provider.beschreibung + " · " : ""}Zeitraum ${zeitraum.von} bis ${zeitraum.bis}`,
      kerzen: async (anfrage) => kerzenImZeitraum(await provider.kerzen(anfrage), zeitraum) };
  }

  // ---------- Ergebnisstruktur ----------
  function ergebnisNeu(modul, titel, f = {}) {
    const s = SKILL[modul] || { skill: null, einordnung: "JARVIS-eigen", hinweis: "" };
    const status = STATUS.includes(f.status) ? f.status : "fehler";
    return {
      modul, titel, skill: s.skill, einordnung: s.einordnung, skill_hinweis: s.hinweis, status,
      daten: f.daten === undefined ? null : f.daten, zeilen: f.zeilen || [], quellen: f.quellen || [], datenalter_ms: Number.isFinite(f.datenalter_ms) ? f.datenalter_ms : null,
      datenzeit: Number.isFinite(f.datenzeit) ? f.datenzeit : null, unsicherheiten: f.unsicherheiten || [], blockaden: f.blockaden || [],
      naechster_schritt: f.naechster_schritt || null,
    };
  }
  const blockade = (grund, naechster) => ({ grund, naechster_schritt: naechster });

  // ---------- Werkzeuge ----------
  async function wAnalyse(k, e) {
    const W = global.AktienWorkflow;
    if (!W) return ergebnisNeu("analyse", "Analyse (Kursdaten, Technik, SEC, Screener, Simulation)", { status: "nicht_verfuegbar", blockaden: [blockade("workflow.js nicht geladen", "Dashboard neu laden")] });
    if (!e.provider) return ergebnisNeu("analyse", "Analyse (Kursdaten, Technik, SEC, Screener, Simulation)", { status: "nicht_verfuegbar", blockaden: [blockade("Keine Datenquelle übergeben", "Datenquelle wählen")] });
    // Genannter Zeitraum gilt für die Kursdaten und alle daraus berechneten Schritte (Technik, Entry, Exit, Simulation)
    const r = await W.analysieren({ symbol: k.symbol }, providerImZeitraum(e.provider, k.zeitraum), { jetzt: k.jetzt, zeitlimitMs: e.zeitlimitMs, allowlist: e.allowlist || null, ausreisser: e.ausreisser || null, simulation: e.simulation || null });
    const daten = r.schritte.find((s) => s.id === "daten");
    const status = !daten || daten.status === "blockiert" || daten.status === "nicht_verfuegbar" ? "blockiert" : r.frisch === false ? "veraltet" : r.blockaden.some((b) => b.bereich !== "Order") ? "warnung" : "ok";
    const zr = k.zeitraum ? [`Zeitraum ${k.zeitraum.von} bis ${k.zeitraum.bis} angewendet (nur Kursdaten und daraus berechnete Schritte; Nachrichten, Meldungen, Alarme ungefiltert).`] : [];
    return ergebnisNeu("analyse", "Analyse (Kursdaten, Technik, SEC, Screener, Simulation)", {
      status, daten: r, unsicherheiten: zr, zeilen: r.schritte.map((s) => `${s.titel}: ${s.text}`), quellen: r.quelle ? [r.quelle.name + (r.quelle.synthetisch ? " (synthetisch)" : "")] : [],
      datenzeit: r.datenzeit, datenalter_ms: Number.isFinite(r.datenzeit) ? k.jetzt - r.datenzeit : null,
      blockaden: r.blockaden.map((b) => blockade(`${b.bereich}: ${b.grund}`, b.naechster_schritt)),
    });
  }

  // Nachrichten: vorhandene Einordnung (einordnen, Schlagwort-Kennzeichen); Zuordnung NUR über strukturierte Symbole oder Ticker-Nennung
  // (beobachtet mit leerem Namen → keine Namensregel); Duplikate wie zusammenfassen (Kennung, Link, gleicher Titel am selben Tag), aber
  // mit allen einzelnen Quellen. eingabe: { meldungen: [{id, titel, zusammenfassung, zeit, quelle, link, symbole}], abgerufen, quelle,
  // fehler, maxAlterMs (optional), firmenname (optional, nur zum Anzeigen reiner Namenstreffer) }
  function wNachrichten(k, e) {
    const N = global.AktienNachrichten, D = global.JarvisDaten;
    const titel = "Nachrichten";
    const n = e.nachrichten;
    if (!N || !D) return ergebnisNeu("nachrichten", titel, { status: "nicht_verfuegbar", blockaden: [blockade("nachrichten.js/datenquellen.js nicht geladen", "Dashboard neu laden")] });
    if (!n) return ergebnisNeu("nachrichten", titel, { status: "nicht_verfuegbar", blockaden: [blockade("Keine Nachrichtenquelle geladen", "Nachrichten im Werkzeug „Nachrichten & 8-K“ laden (Worker)")] });
    if (n.fehler) return ergebnisNeu("nachrichten", titel, { status: "fehler", quellen: [n.quelle || "?"], blockaden: [blockade("Nachrichtenquelle fehlerhaft: " + String(n.fehler).slice(0, 160), "Später erneut laden – bis dahin keine Aussage über Nachrichten")] });
    const abgerufen = D.zeitNormal(n.abgerufen);
    if (!Array.isArray(n.meldungen) || abgerufen === null) return ergebnisNeu("nachrichten", titel, { status: "fehler", quellen: [n.quelle || "?"], blockaden: [blockade("Nachrichtendaten unvollständig (Liste oder Abrufzeit fehlt)", "Neu laden")] });
    const eingeordnet = N.einordnen(n.meldungen.map((m) => ({ ...m, titel: String(m.titel || ""), zusammenfassung: String(m.zusammenfassung || ""), symbole: Array.isArray(m.symbole) ? m.symbole : [] })), { [k.symbol]: "" });
    const zugeordnet = eingeordnet.filter((m) => m.betrifft.includes(k.symbol));
    const nurName = n.firmenname && n.firmenname.length >= 4 ? eingeordnet.filter((m) => !m.betrifft.includes(k.symbol) && new RegExp("\\b" + n.firmenname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(m.titel + " " + m.zusammenfassung)) : [];
    // Gruppieren: gleiche Kennung, gleicher Link oder gleicher normalisierter Titel am selben Tag – Quellen bleiben einzeln erhalten
    const gruppen = [];
    const schluesselZuGruppe = new Map();
    for (const m of zugeordnet) {
      const t = String(m.titel).toLowerCase().replace(/\W+/g, " ").trim();
      const keys = [m.id ? "id:" + m.id : null, m.link ? "l:" + m.link : null, t ? "t:" + t + "|" + String(m.zeit || "").slice(0, 10) : null].filter(Boolean);
      let g = keys.map((x) => schluesselZuGruppe.get(x)).find(Boolean);
      if (!g) { g = { titel: m.titel, eintraege: [] }; gruppen.push(g); }
      g.eintraege.push(m);
      for (const x of keys) schluesselZuGruppe.set(x, g);
    }
    const unsicher = [], zeilen = [];
    let neueste = null;
    for (const g of gruppen) {
      const details = g.eintraege.map((m) => {
        const zeit = D.zeitNormal(m.zeit);
        const zt = zeit === null ? "Veröffentlichung unbekannt" : zeit > abgerufen + 60000 ? `Zeitstempel widersprüchlich (nach dem Abruf: ${new Date(zeit).toISOString()})` : `veröffentlicht ${new Date(zeit).toISOString().slice(0, 16).replace("T", " ")} UTC, ${Math.round((k.jetzt - zeit) / 3600000)} h alt`;
        if (zeit !== null && zeit <= abgerufen + 60000) neueste = Math.max(neueste ?? 0, zeit);
        const anweisung = ANWEISUNG.test(`${m.titel} ${m.zusammenfassung}`);
        if (anweisung) unsicher.push(`„${String(m.titel).slice(0, 60)}“ enthält anweisungsartigen Text – nur als Zitat angezeigt, nicht befolgt`);
        const zuordnung = (m.symbole || []).includes(k.symbol) ? "strukturiert (Symbolliste der Quelle)" : "Ticker-Nennung im Text";
        return { quelle: m.quelle || n.quelle || "?", link: /^https:\/\//.test(m.link || "") ? m.link : null, zeit_text: zt, zuordnung, kennzeichen: m.kennzeichen, anweisung, text: String(m.zusammenfassung || "").slice(0, 600), titel: m.titel };
      });
      zeilen.push(`${g.titel} – ${details.length > 1 ? `${details.length} Quellen: ` : ""}${details.map((x) => `${x.quelle} (${x.zeit_text}, Zuordnung: ${x.zuordnung})`).join(" · ")}${g.eintraege[0].kennzeichen.length ? ` · Kennzeichen (technische Einordnung, keine Kurswirkung): ${g.eintraege[0].kennzeichen.join(", ")}` : ""}`);
      g.details = details;
    }
    for (const m of nurName) unsicher.push(`„${String(m.titel).slice(0, 60)}“ nennt nur den Firmennamen – nicht zugeordnet (Namensähnlichkeit reicht nicht)`);
    const alter = k.jetzt - abgerufen;
    const veraltet = Number.isFinite(n.maxAlterMs) && n.maxAlterMs > 0 && alter > n.maxAlterMs;
    if (!Number.isFinite(n.maxAlterMs)) unsicher.push("keine Frischegrenze für Nachrichten festgelegt – Alter nur angezeigt");
    return ergebnisNeu("nachrichten", titel, {
      status: veraltet ? "veraltet" : unsicher.some((u) => u.includes("anweisungsartig")) ? "warnung" : "ok",
      daten: { gruppen, abgerufen, anzahl: zugeordnet.length }, zeilen: zeilen.length ? zeilen : [`Keine Nachricht mit gesicherter Zuordnung zu ${k.symbol} in der geladenen Quelle.`],
      quellen: [n.quelle || "?"], datenzeit: abgerufen, datenalter_ms: alter, unsicherheiten: unsicher,
      blockaden: veraltet ? [blockade(`Nachrichten ${Math.round(alter / 60000)} min alt (Grenze ${Math.round(n.maxAlterMs / 60000)} min)`, "Nachrichten neu laden")] : [],
    });
  }

  // Meldungen: vorhandene Auswertung (AktienWorkflow.meldungenAuswerten); unsichere Ticker und nicht verfügbare Teile bleiben blockiert
  function wMeldungen(k, e) {
    const W = global.AktienWorkflow;
    const titel = "Meldungen (SEC 8-K, Form 4, 13F, Kongress)";
    if (!W || !W.meldungenAuswerten) return ergebnisNeu("meldungen", titel, { status: "nicht_verfuegbar", blockaden: [blockade("workflow.js nicht geladen", "Dashboard neu laden")] });
    if (!e.meldungen) return ergebnisNeu("meldungen", titel, { status: "nicht_verfuegbar", blockaden: [blockade("Keine Meldungen geladen", "13F-Tracker bzw. Kongress-Leser nutzen; Form 4 nur über den Worker mit SEC")] });
    const m = W.meldungenAuswerten(k.symbol, e.meldungen, k.jetzt);
    const zeilen = m.eintraege.map((x) => x.text);
    const N = global.AktienNachrichten;
    if (N && e.meldungen.form4 && e.meldungen.form4.submissions) {
      const acht = N.secMeldungen(e.meldungen.form4.submissions, { formen: ["8-K"], anzahl: 5, ticker: k.symbol });
      for (const x of Array.isArray(acht) ? acht : []) zeilen.push(`8-K: eingereicht ${x.zeit || x.eingereicht || "?"} – ${x.titel || ""} (Quelle SEC EDGAR)`);
    }
    const blockaden = [];
    for (const x of m.eintraege) for (const u of x.unsicherheit) if (/unsicher|nicht eingerechnet|überholt/.test(u)) blockaden.push(blockade(`${x.art}: ${u}`, "Nur als Beobachtung verwenden; Zuordnung bzw. Meldung selbst prüfen"));
    for (const nv of m.nicht_verfuegbar.filter((x) => /OpenFIGI|PDF|Senat|Form-4/.test(x))) blockaden.push(blockade(`nicht verfügbar: ${nv}`, "Keine automatische Auswertung – siehe docs/TRADER_SKILL_ABGLEICH.md §8b"));
    return ergebnisNeu("meldungen", titel, {
      status: m.eintraege.length ? (blockaden.some((b) => !b.grund.startsWith("nicht verfügbar")) ? "warnung" : "ok") : "nicht_verfuegbar", daten: m,
      zeilen: zeilen.length ? zeilen : [`Keine Meldungen zu ${k.symbol} in den geladenen Daten.`], quellen: [...new Set(m.eintraege.map((x) => x.quelle))],
      unsicherheiten: [...new Set(m.eintraege.flatMap((x) => x.unsicherheit))], blockaden,
    });
  }

  // Alarme: vorhandene Regeln und pruefen (rein, der neue Zustand wird NICHT gespeichert); beschädigter Zustand → unbekannt, nichts geprüft
  function wAlarme(k, e) {
    const A = global.AktienAlarme;
    const titel = "Alarme";
    const a = e.alarme;
    if (!A) return ergebnisNeu("alarme", titel, { status: "nicht_verfuegbar", blockaden: [blockade("alarme.js nicht geladen", "Dashboard neu laden")] });
    if (!a) return ergebnisNeu("alarme", titel, { status: "nicht_verfuegbar", blockaden: [blockade("Keine Alarme geladen", "Alarme im Werkzeug „Preisalarme“ anlegen (Nutzerwert nötig)")] });
    if (a.beschaedigt) return ergebnisNeu("alarme", titel, { status: "unbekannt", blockaden: [blockade("Alarmspeicher beschädigt – Alarme unbekannt, nichts geprüft oder verändert", "Im Werkzeug „Preisalarme“ den Speicher ausdrücklich zurücksetzen")] });
    const zp = A.zustandPruefen(a.zustand || {});
    if (!zp.ok) return ergebnisNeu("alarme", titel, { status: "unbekannt", blockaden: [blockade("Alarmzustand beschädigt (" + zp.grund + ") – nichts geprüft, nichts erneut ausgelöst", "Im Werkzeug „Preisalarme“ ausdrücklich zurücksetzen")] });
    const eigene = (a.regeln || []).filter((r) => r.symbol === k.symbol);
    if (!eigene.length) return ergebnisNeu("alarme", titel, { status: "nicht_verfuegbar", zeilen: [`Für ${k.symbol} ist kein Alarm angelegt (keine automatischen Schwellen).`], blockaden: [blockade("Keine Alarmregel mit Nutzerwert für dieses Symbol", "Alarm mit eigenem Preis, Prozentwert, Formularen oder Kennzeichen anlegen")] });
    const d = a.daten || {};
    const r = A.pruefen(eigene, { ...d, jetzt: k.jetzt }, a.zustand || {});
    const zeilen = eigene.map((x) => {
      const z = (a.zustand || {})[x.id];
      const st = x.aktiv === false ? "deaktiviert" : x.ablauf && k.jetzt > Date.parse(x.ablauf + "T23:59:59Z") ? `abgelaufen (${x.ablauf})` : z && z.ausgeloest ? "bereits ausgelöst " + z.ausgeloest.slice(0, 16).replace("T", " ") : "scharf";
      return `${A.text(x)} · Bedingung: ${x.art} · Status: ${st}${x.ablauf ? ` · gültig bis ${x.ablauf}` : ""}`;
    });
    for (const x of r.ausgeloest) zeilen.push(`ERKANNT: ${x.text} – Alarm erkannt ≠ Paper-Vorschlag ≠ Order (nichts ausgeführt)`);
    const k0 = d.kurse && d.kurse[k.symbol];
    return ergebnisNeu("alarme", titel, {
      status: r.ausgeloest.length ? "warnung" : "ok", daten: { ausgeloest: r.ausgeloest, hinweise: r.hinweise }, zeilen,
      quellen: [d.quelle || "Kurse/Meldungen aus der Datenquelle des Profils"], datenalter_ms: k0 && Number.isFinite(k0.alter_min) ? k0.alter_min * 60000 : null,
      unsicherheiten: [...r.hinweise, "Kurse können verzögert sein (Prüfung nur bei geöffneter Seite)"],
    });
  }

  // Budget: vorhandene Aufteilung mit den Grenzen des Workers (keine eigenen, keine Standardwerte); Simulationskapital getrennt angezeigt
  function wBudget(k, e) {
    const B = global.AktienBudget, P = global.PaperKern;
    const titel = "Budget (Simulation)";
    const b = e.budget;
    if (!B || !P) return ergebnisNeu("budget", titel, { status: "nicht_verfuegbar", blockaden: [blockade("budget.js/paper-kern.js nicht geladen", "Dashboard neu laden")] });
    const g = grenzenPruefen(e.grenzen);
    const port = e.portfolio;
    const kap = port && port.art === "simulation" ? kapital(port, e.kurse || {}) : null;
    const zeilen = kap ? [`SIMULATION – Spielkapital, kein Konto: Start ${geld(kap.start)}, gebunden in Positionen ${kap.gebunden === null ? "nicht bewertbar (Kurs fehlt)" : geld(kap.gebunden)}, verfügbar (Bargeld) ${geld(kap.bargeld)}`] : ["Kein Simulations-Portfolio geladen."];
    if (!b || !(Number(b.betrag) > 0) || !b.ziele || !b.ziele.length) return ergebnisNeu("budget", titel, { status: "nicht_verfuegbar", zeilen, blockaden: [blockade("Konfiguration fehlt: Budgetbetrag und Zielgewichte selbst eingeben", "Betrag und Ziele eintragen – es gibt keine Vorgabe")] });
    if (g.blockaden.length) return ergebnisNeu("budget", titel, { status: "blockiert", zeilen, blockaden: g.blockaden });
    if (kap && Number(b.betrag) > kap.bargeld + 1e-9) return ergebnisNeu("budget", titel, { status: "blockiert", zeilen, blockaden: [blockade(`Budget ${geld(Number(b.betrag))} größer als verfügbares Spielkapital ${geld(kap.bargeld)}`, "Kleineren Betrag wählen")] });
    const r = B.aufteilen(Number(b.betrag), b.ziele, { maxOrderUsd: g.grenzen.maxOrderUsd, barreservePct: g.grenzen.barreservePct, maxPositionPct: g.grenzen.maxPositionPct, minOrderUsd: g.grenzen.minOrderUsd });
    if (r.fehler) return ergebnisNeu("budget", titel, { status: "blockiert", zeilen, blockaden: [blockade(r.fehler, "Eingaben korrigieren")] });
    const blockaden = [];
    const offen = port ? Object.keys(port.positionen).length : 0;
    const neu = r.positionen.filter((p) => !(port && port.positionen[p.symbol])).length;
    if (offen + neu > g.grenzen.maxPositionen) blockaden.push(blockade(`Positionslimit: ${offen} offen + ${neu} neu > ${g.grenzen.maxPositionen}`, "Weniger Ziele wählen"));
    for (const p of r.positionen) if (!g.allowlist.includes(p.symbol)) blockaden.push(blockade(`${p.symbol} nicht in der Allowlist`, "Ziel entfernen – eine Order wäre gesperrt"));
    if (kap && g.grenzen.maxTagesverlustUsd !== null && e.tagesverlust !== undefined && !(Number.isFinite(e.tagesverlust))) blockaden.push(blockade("Tagesverlust unbekannt", "Ohne Tagesverlust keine Kaufvorschläge"));
    if (Number.isFinite(e.tagesverlust) && e.tagesverlust >= g.grenzen.maxTagesverlustUsd) blockaden.push(blockade(`Tagesverlust ${geld(e.tagesverlust)} erreicht die Grenze ${geld(g.grenzen.maxTagesverlustUsd)}`, "Heute keine Käufe"));
    zeilen.push(...r.positionen.map((p) => `${p.symbol}: ${geld(p.dollar)}${p.gedeckelt ? " (Deckel)" : ""}`), `Reserve ${geld(r.reserve)}, untätig ${geld(r.untaetig)}`, ...(r.hinweise || []));
    return ergebnisNeu("budget", titel, { status: blockaden.length ? "blockiert" : "ok", daten: r, zeilen, quellen: ["Grenzen: Worker (/aktien/status)", "Kapital: lokales Simulations-Portfolio"], blockaden, unsicherheiten: ["Vorschlag, keine Order; jede Order braucht Risiko-Prüfung und Freigabe"] });
  }

  // Rebalancing: vorhandene Planung auf Paper-Positionen; Kurse nur frisch (Frische laut Datenquelle), Währung USD, Ziele vom Nutzer
  function wRebalance(k, e) {
    const R = global.AktienRebalance;
    const titel = "Rebalancing (Vorschlag, Simulation)";
    const rb = e.rebalance;
    if (!R) return ergebnisNeu("rebalance", titel, { status: "nicht_verfuegbar", blockaden: [blockade("rebalance.js nicht geladen", "Dashboard neu laden")] });
    if (!rb || !rb.ziele || !rb.ziele.length) return ergebnisNeu("rebalance", titel, { status: "nicht_verfuegbar", blockaden: [blockade("Zielgewichte fehlen", "Zielgewichte selbst eingeben")] });
    const g = grenzenPruefen(e.grenzen);
    if (g.blockaden.length) return ergebnisNeu("rebalance", titel, { status: "blockiert", blockaden: g.blockaden });
    const port = e.portfolio;
    if (!port || port.art !== "simulation") return ergebnisNeu("rebalance", titel, { status: "blockiert", blockaden: [blockade("Kein Simulations-Portfolio – Kontostand unbekannt", "Simulation starten oder Portfolio laden")] });
    if (port.waehrung !== "USD") return ergebnisNeu("rebalance", titel, { status: "blockiert", blockaden: [blockade(`Währung ${port.waehrung} – nur USD`, "Kein Vorschlag")] });
    if (!Number.isFinite(port.bargeld)) return ergebnisNeu("rebalance", titel, { status: "blockiert", blockaden: [blockade("Bargeld unbekannt", "Kein Vorschlag")] });
    const kurse = e.kurse || {};
    const noetig = [...new Set([...Object.keys(port.positionen), ...rb.ziele.map((z) => String(z.symbol || "").toUpperCase())])];
    const fehlt = noetig.filter((s) => !(kurse[s] && kurse[s].preis > 0));
    const alt = noetig.filter((s) => kurse[s] && kurse[s].frisch !== true);
    if (fehlt.length) return ergebnisNeu("rebalance", titel, { status: "blockiert", blockaden: [blockade(`Kein Kurs für ${fehlt.join(", ")}`, "Kurse laden – nichts wird geschätzt")] });
    if (alt.length) return ergebnisNeu("rebalance", titel, { status: "veraltet", blockaden: [blockade(`Kurse veraltet oder Frische unbekannt: ${alt.join(", ")}`, "Mit aktuellen Daten neu rechnen")] });
    const konto = { cash: port.bargeld, positionen: Object.entries(port.positionen).map(([symbol, p]) => ({ symbol, menge: p.menge, kurs: kurse[symbol].preis })) };
    const preise = Object.fromEntries(noetig.map((s) => [s, kurse[s].preis]));
    const r = R.planen(konto, preise, rb.ziele, { barreservePct: g.grenzen.barreservePct, maxPositionPct: g.grenzen.maxPositionPct, minOrderUsd: g.grenzen.minOrderUsd, maxOrderUsd: g.grenzen.maxOrderUsd, bandPct: rb.bandPct > 0 ? rb.bandPct : R.STANDARD.bandPct, gesperrt: noetig.filter((s) => !g.allowlist.includes(s)) });
    if (r.fehler) return ergebnisNeu("rebalance", titel, { status: "blockiert", blockaden: [blockade(r.fehler, "Eingaben prüfen")] });
    const datenzeit = Math.min(...noetig.map((s) => kurse[s].zeit).filter(Number.isFinite));
    const zeilen = r.zeilen.map((z) => `${z.symbol}: Ist ${z.ist_pct} %, Ziel ${z.ziel_pct} %, Differenz ${z.abweichung} Punkte, Kurs ${z.kurs} → ${z.aktion}`);
    zeilen.push(...r.vorschlaege.map((v) => `UNVERBINDLICHER VORSCHLAG (Simulation): ${v.order.side === "buy" ? "Kauf" : "Verkauf"} ${v.order.symbol} für ${geld(Number(v.order.notional))} – ${v.warum}`), ...r.hinweise);
    const gesperrt = noetig.filter((s) => !g.allowlist.includes(s));
    return ergebnisNeu("rebalance", titel, {
      status: "ok", daten: r, zeilen, quellen: ["Positionen: lokales Simulations-Portfolio", "Kurse: Datenquelle des Profils"], datenzeit, datenalter_ms: Number.isFinite(datenzeit) ? k.jetzt - datenzeit : null,
      unsicherheiten: ["Nur Vorschlag – keine Order; Übernahme höchstens als Paper-Vorschlag mit eigener Bestätigung", ...(gesperrt.length ? [`nicht in der Allowlist (gesperrt): ${gesperrt.join(", ")}`] : [])],
    });
  }

  // ---------- Grenzen des Workers (keine eigenen Werte) ----------
  function grenzenPruefen(g) {
    const blockaden = [];
    if (!g) return { blockaden: [blockade("Risikogrenzen unbekannt (Worker nicht verbunden oder älterer Stand)", "Im Cockpit verbinden – ohne Grenzen keine Vorschläge")] };
    for (const [feld, name] of [["maxOrderUsd", "AKTIEN_MAX_ORDER_USD"], ["maxPositionen", "AKTIEN_MAX_POSITIONEN"], ["maxTagesverlustUsd", "AKTIEN_MAX_TAGESVERLUST_USD"]]) if (!Number.isFinite(g[feld])) blockaden.push(blockade(`${name} fehlt`, "Im Worker einrichten – es wird kein Wert angenommen"));
    for (const [feld, name] of [["barreservePct", "Barreserve"], ["maxPositionPct", "Positionsdeckel"], ["minOrderUsd", "Mindestorder"]]) if (!Number.isFinite(g[feld])) blockaden.push(blockade(`${name} fehlt in den Grenzen des Workers`, "Worker-Stand prüfen"));
    if (g.betriebsart_gueltig === false) blockaden.push(blockade("Betriebsart fehlt oder ist ungültig", "BETRIEBSART im Worker setzen"));
    const al = g.erlaubteSymbole;
    if (!al || !Array.isArray(al.liste) || al.fehler) blockaden.push(blockade("Allowlist fehlt" + (al && al.fehler ? ": " + al.fehler : ""), "AKTIEN_ERLAUBTE_SYMBOLE im Worker setzen"));
    if (Array.isArray(g.konfigFehler)) for (const f of g.konfigFehler) if (!blockaden.some((b) => b.grund.startsWith(f.split(" ")[0]))) blockaden.push(blockade("Konfiguration: " + f, "Im Worker einrichten"));
    return { blockaden, grenzen: g, allowlist: al && Array.isArray(al.liste) ? al.liste : [] };
  }

  function kapital(port, kurse) {
    let gebunden = 0, bewertbar = true;
    for (const [s, p] of Object.entries(port.positionen)) { const k = kurse[s]; if (k && k.preis > 0) gebunden += p.menge * k.preis; else bewertbar = false; }
    return { start: port.startkapital, bargeld: port.bargeld, gebunden: bewertbar ? Math.round(gebunden * 100) / 100 : null };
  }
  const geld = (x) => (Number.isFinite(x) ? x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD" : "–");

  // ---------- Paper-Vorschlag und Bestätigung ----------
  function fnv(text) { let h = 2166136261 >>> 0; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, "0"); }
  // v: { richtung: "kauf"|"verkauf", betrag (USD, Pflicht bei Kauf), preisannahme, datenzeit, risiko: {bestanden, gruende} }
  function vorschlagErstellen(k, v) {
    const P = global.PaperKern;
    if (!["kauf", "verkauf"].includes(v && v.richtung)) return { fehler: "Richtung fehlt." };
    if (!(Number(v.preisannahme) > 0)) return { fehler: "Preisannahme fehlt – kein Vorschlag." };
    if (!Number.isFinite(v.datenzeit)) return { fehler: "Datenzeit fehlt – kein Vorschlag." };
    if (v.richtung === "kauf" && !(Number(v.betrag) > 0)) return { fehler: "Betrag fehlt – es gibt keinen Standardbetrag." };
    if (!v.risiko || typeof v.risiko.bestanden !== "boolean") return { fehler: "Risikoprüfung fehlt." };
    const betrag = v.richtung === "kauf" ? Math.round(Number(v.betrag) * 100) / 100 : null;
    const stueck = v.richtung === "kauf" ? Math.round((betrag / Number(v.preisannahme)) * 1e6) / 1e6 : Number(v.stueck);
    if (!(stueck > 0)) return { fehler: "Stückzahl ungültig." };
    const vorschlag = {
      simulation: true, markt: P ? P.MARKT : "US-Aktien (Simulation)", symbol: k.symbol, richtung: v.richtung, stueck, betrag_geschaetzt: Math.round(stueck * Number(v.preisannahme) * 100) / 100,
      preisannahme: Number(v.preisannahme), datenzeit: v.datenzeit, datenalter_ms: k.jetzt - v.datenzeit, risiko: { bestanden: v.risiko.bestanden, gruende: [...(v.risiko.gruende || [])] },
      erstellt: k.jetzt, gueltig_bis: k.jetzt + VORSCHLAG_GUELTIG_MS, sitzung: k.sitzung.id,
    };
    vorschlag.fingerabdruck = fnv(JSON.stringify([vorschlag.symbol, vorschlag.richtung, vorschlag.stueck, vorschlag.preisannahme, vorschlag.risiko.bestanden, vorschlag.risiko.gruende, vorschlag.erstellt, vorschlag.sitzung]));
    return { vorschlag: Object.freeze(vorschlag) };
  }
  // Parameter der Paper-Buchung eines Vorschlags (ab 11-05b an einer Stelle: Bestätigung und Vorschau-Schätzung nutzen dieselben)
  function buchungsParameter(vorschlag, b) {
    const P = global.PaperKern;
    return { datensatz: "Profil " + vorschlag.sitzung, symbol: vorschlag.symbol, seite: vorschlag.richtung, wertKauf: vorschlag.betrag_geschaetzt, signalZeit: vorschlag.erstellt, kerze: { t: b.jetzt, o: vorschlag.preisannahme }, annahmen: P.annahmenNormal(b.annahmen), limits: b.limits, kurse: { [vorschlag.symbol]: vorschlag.preisannahme } };
  }
  // Schätzung vor der Bestätigung (ab 11-05b): derselbe Paper-Kern-Aufruf auf einer Kopie des Portfolios – Ausführungspreis mit
  // Slippage, Stückzahl, Volumen, Gebühr und Belastung (Kauf) bzw. Gutschrift (Verkauf); das Portfolio selbst bleibt unverändert
  function vorschlagSchaetzen(vorschlag, b) {
    const P = global.PaperKern;
    if (!vorschlag || !vorschlag.simulation || !vorschlag.risiko.bestanden || !b || !b.portfolio) return null;
    const kopie = JSON.parse(JSON.stringify(b.portfolio));
    const r = P.orderAusfuehren(kopie, buchungsParameter(vorschlag, b));
    const e = r.order && kopie.ledger.find((x) => x.trade_id === r.order.trade_id);
    if (!e || e.zustand !== "gefuellt") return null;
    const betrag = Math.round((vorschlag.richtung === "kauf" ? e.volumen + e.gebuehr : e.volumen - e.gebuehr) * 100) / 100;
    return { preis: e.preis, menge: e.menge, volumen: e.volumen, gebuehr: e.gebuehr, betrag, annahmen: e.annahmen };
  }
  // Bestätigung GENAU dieses Vorschlags: Fingerabdruck stimmt, nicht abgelaufen, Risiko unverändert, kein Not-Aus → Paper-Kern bucht.
  // b: { fingerabdruck, jetzt, portfolio, limits, notaus, kurse }
  function vorschlagBestaetigen(vorschlag, b) {
    const P = global.PaperKern;
    if (!vorschlag || !vorschlag.simulation) return { fehler: "Kein Paper-Vorschlag." };
    const neu = fnv(JSON.stringify([vorschlag.symbol, vorschlag.richtung, vorschlag.stueck, vorschlag.preisannahme, vorschlag.risiko.bestanden, vorschlag.risiko.gruende, vorschlag.erstellt, vorschlag.sitzung]));
    if (neu !== vorschlag.fingerabdruck || b.fingerabdruck !== vorschlag.fingerabdruck) return { fehler: "Vorschlag verändert oder Bestätigung gehört zu einem anderen Vorschlag – neue Bestätigung nötig." };
    if (!(b.jetzt <= vorschlag.gueltig_bis)) return { fehler: "Bestätigung abgelaufen (15 Minuten) – Vorschlag neu erstellen." };
    if (b.notaus !== false) return { fehler: b.notaus === true ? "NOT-AUS aktiv – auch keine Paper-Buchung." : "Not-Aus-Zustand unbekannt – keine Paper-Buchung." };
    if (!b.portfolio || b.portfolio.art !== "simulation") return { fehler: "Kein Simulations-Portfolio." };
    const risiko = P.risikoPruefen(b.portfolio, { seite: vorschlag.richtung, symbol: vorschlag.symbol, wert: vorschlag.betrag_geschaetzt }, b.limits, { jetzt: b.jetzt, kurse: b.kurse || { [vorschlag.symbol]: vorschlag.preisannahme } });
    if (risiko.bestanden !== vorschlag.risiko.bestanden || JSON.stringify(risiko.gruende) !== JSON.stringify(vorschlag.risiko.gruende)) return { fehler: "Risikostatus hat sich geändert – neuer Vorschlag und neue Bestätigung nötig.", risiko };
    if (!risiko.bestanden) return { fehler: "Risikoprüfung nicht bestanden: " + risiko.gruende.join("; ") };
    const r = P.orderAusfuehren(b.portfolio, buchungsParameter(vorschlag, b));
    if (r.doppelt) return { fehler: "Dieser Vorschlag wurde schon gebucht." };
    return { ok: true, trade_id: r.order.trade_id, zustand: r.order.zustand, hinweis: "SIMULATION – im lokalen Paper-Kern gebucht, keine Order an einen Broker." };
  }

  // ---------- Dispatcher ----------
  const WERKZEUGE = [
    ["analyse", wAnalyse], ["nachrichten", wNachrichten], ["meldungen", wMeldungen], ["alarme", wAlarme], ["budget", wBudget], ["rebalance", wRebalance],
  ];
  // eingaben: { provider, zeitlimitMs, allowlist, ausreisser, simulation, nachrichten, meldungen, alarme, budget, rebalance, grenzen, portfolio, kurse, tagesverlust }
  async function dispatch(kontextRoh, eingaben = {}, { nur = null } = {}) {
    const kx = kontextRoh && kontextRoh.ok !== undefined ? kontextRoh : kontextNeu(kontextRoh);
    if (!kx.ok) return { ok: false, fehler: kx.fehler, ergebnisse: [], zusammenfassung: { verfuegbar: [], fehlend: [], vollstaendig: false } };
    const ergebnisse = [];
    for (const [id, f] of WERKZEUGE) {
      if (nur && !nur.includes(id)) continue;
      try { ergebnisse.push(await f(kx.kontext, eingaben)); }
      catch (e) { ergebnisse.push(ergebnisNeu(id, id, { status: "fehler", blockaden: [blockade("Werkzeug abgebrochen: " + (e && e.message ? e.message : "unbekannt"), "Später erneut versuchen")] })); }
    }
    const verfuegbar = ergebnisse.filter((r) => ["ok", "warnung"].includes(r.status)).map((r) => r.titel);
    const fehlend = ergebnisse.filter((r) => !["ok", "warnung"].includes(r.status)).map((r) => `${r.titel} (${r.status})`);
    return { ok: true, kontext: kx.kontext, ergebnisse, zusammenfassung: { verfuegbar, fehlend, vollstaendig: fehlend.length === 0, text: fehlend.length ? `Teilanalyse: ${verfuegbar.length} von ${ergebnisse.length} Bereichen verfügbar – fehlend: ${fehlend.join(", ")}.` : `Alle ${ergebnisse.length} Bereiche verfügbar.` } };
  }

  global.AktienProfil = { kontextNeu, kerzenImZeitraum, providerImZeitraum, ergebnisNeu, dispatch, grenzenPruefen, vorschlagErstellen, vorschlagSchaetzen, vorschlagBestaetigen, SKILL, STATUS, VORSCHLAG_GUELTIG_MS, ANWEISUNG, WERKZEUGE: WERKZEUGE.map(([id]) => id) };
})(typeof window !== "undefined" ? window : globalThis);
