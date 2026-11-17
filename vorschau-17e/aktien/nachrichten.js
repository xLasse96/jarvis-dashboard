// JARVIS Aktien – Nachrichten und SEC-Meldungen einordnen (Stufe 2). Reine Rechnung ohne Netzwerk, keine Order.
// Schlagzeilen sind Hinweise, keine Fakten; Meldungen an die SEC (8-K) haben Vorrang. Texte werden nur angezeigt, nie als
// Anweisung ausgeführt oder an eine KI gegeben.
// Schlagwort-Regeln, 8-K-Kennungen und „wichtige“ Kennungen nach dem Vorbild von trader-news (news.py) aus
// github.com/Jakeschincariol/trader-skill (MIT, Copyright (c) 2026 Jake Schincariol), in JavaScript übertragen.
(function (global) {
  "use strict";

  const ITEMS_8K = {
    "1.01": "wesentlicher Vertrag", "1.02": "Vertrag beendet", "1.03": "Insolvenz", "1.05": "Cyber-Vorfall",
    "2.01": "Kauf/Verkauf von Vermögen", "2.02": "Quartalszahlen", "2.03": "neue Schulden", "2.04": "Schulden fällig gestellt",
    "2.05": "Restrukturierungskosten", "2.06": "Wertminderung", "3.01": "Hinweis auf Delisting", "3.02": "nicht registrierter Aktienverkauf",
    "3.03": "Änderung der Aktionärsrechte", "4.01": "Wechsel des Prüfers", "4.02": "frühere Abschlüsse nicht mehr verlässlich",
    "5.01": "Kontrollwechsel", "5.02": "Wechsel bei Vorstand/Aufsichtsrat", "5.03": "Satzung/Geschäftsjahr geändert",
    "5.07": "Ergebnis der Hauptversammlung", "7.01": "Regulation-FD-Mitteilung", "8.01": "sonstige Ereignisse", "9.01": "Anlagen",
  };
  const WICHTIG = new Set(["1.03", "1.05", "2.02", "2.04", "2.06", "3.01", "4.02", "5.01", "5.02"]);
  // Schlagwörter (englische Quellen) → Kennzeichnung
  const SCHLAGWORTE = [
    ["Zahlen", /\bearnings\b|\bresults\b|\bEPS\b|\bguidance\b|\bforecast\b/i],
    ["Analysten", /\bupgrade[sd]?\b|\bdowngrade[sd]?\b|price target|\boutperform\b|\bunderperform\b/i],
    ["Recht", /\blawsuit\b|\bsued\b|\bprobe\b|\binvestigation\b|\bSEC charges\b|\bantitrust\b|\bjudge\b|\bcourt\b/i],
    ["Übernahme", /\bacqui(?:re|res|red|sition)\b|\bmerger\b|\bbuyout\b|\btakeover\b|\bdeal\b/i],
    ["Kapital", /\bdividend\b|\bbuyback\b|\brepurchase\b|\bstock split\b|\boffering\b/i],
    ["Personal", /\bCEO\b|\bCFO\b|\bresign|\bsteps down\b|\bappoint/i],
    ["Risiko", /\brecall\b|\bbankrupt|\bdefault\b|\bdelist|\bhack|\bbreach\b|\boutage\b/i],
  ];

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // beobachtet: { TICKER: "Firmenname" | "" }
  function einordnen(meldungen, beobachtet = {}) {
    const muster = Object.entries(beobachtet).map(([t, name]) => {
      const alt = [`\\(${escapeRegex(t)}\\)`, `\\$${escapeRegex(t)}\\b`, `\\b(?:NYSE|NASDAQ|Nasdaq)\\s*:\\s*${escapeRegex(t)}\\b`];
      if (name && name.length >= 4) alt.push(`\\b${escapeRegex(name).replace(/\\? /g, "[\\s-]")}\\b`);
      return [t, new RegExp(alt.join("|"))];
    });
    return (meldungen || []).map((m) => {
      const text = `${m.titel || ""} ${m.zusammenfassung || ""}`;
      const betrifft = new Set((m.symbole || []).filter((s) => s in beobachtet));
      for (const [t, rx] of muster) if (rx.test(text)) betrifft.add(t);
      const kennzeichen = SCHLAGWORTE.filter(([, rx]) => rx.test(text)).map(([k]) => k);
      if (m.art === "meldung" && (m.items || []).includes("2.02") && !kennzeichen.includes("Zahlen")) kennzeichen.unshift("Zahlen");
      return { ...m, betrifft: [...betrifft].sort(), kennzeichen };
    });
  }

  // Eine Meldung je Geschichte: gleiche Kennung, gleicher Link oder gleicher Titel am selben Tag
  function zusammenfassen(meldungen) {
    const gesehen = new Map();
    const aus = [];
    for (const m of meldungen || []) {
      const titel = String(m.titel || "").toLowerCase().replace(/\W+/g, " ").trim();
      const schluessel = [m.id, m.link, titel ? titel + "|" + String(m.zeit || "").slice(0, 10) : null].filter(Boolean);
      const treffer = schluessel.map((k) => gesehen.get(k)).find(Boolean);
      if (treffer) {
        for (const t of m.betrifft || []) if (!treffer.betrifft.includes(t)) treffer.betrifft.push(t);
        treffer.betrifft.sort();
        continue;
      }
      const kopie = { ...m, betrifft: [...(m.betrifft || [])] };
      for (const k of schluessel) gesehen.set(k, kopie);
      aus.push(kopie);
    }
    // ab 16i (NEWS-S09): neueste zuerst; Meldungen ohne Zeit zählen wie im Original als „jetzt“ und stehen oben (vorher unten)
    return aus.sort((a, b) => (a.zeit ? 1 : 0) - (b.zeit ? 1 : 0) || String(b.zeit || "").localeCompare(String(a.zeit || "")));
  }

  // SEC-„submissions“ (data.sec.gov) → Meldungen der gewünschten Formulare, neueste zuerst
  function secMeldungen(submissions, { formen = ["8-K"], anzahl = 10, ticker = "" } = {}) {
    const r = submissions && submissions.filings && submissions.filings.recent;
    if (!r || !Array.isArray(r.form)) return [];
    const cik = String(Number(submissions.cik || 0));
    const firma = String(submissions.name || ticker);
    const aus = [];
    for (let i = 0; i < r.form.length && aus.length < anzahl; i++) {
      if (!formen.includes(r.form[i])) continue;
      const acc = String(r.accessionNumber[i] || "");
      const items = String((r.items && r.items[i]) || "").match(/\d+\.\d+/g) || [];
      const namen = items.filter((x) => x !== "9.01").map((x) => ITEMS_8K[x] || "Punkt " + x);
      aus.push({
        id: "sec:" + acc, art: "meldung", form: r.form[i], quelle: "SEC EDGAR", symbole: ticker ? [ticker] : [],
        titel: `${firma} – ${r.form[i]}${namen.length ? ": " + namen.join(", ") : ""}`,
        items, wichtig: items.some((x) => WICHTIG.has(x)),
        // ab 16k (NEWS-S05, wie news.py mit „updated“ aus dem Atom-Feed): genauer Annahmezeitpunkt der SEC (acceptanceDateTime, UTC);
        // ohne ihn wie bisher nur das Meldedatum (…T00:00:00Z = „nur Datum“). Das Meldedatum (Datum laut SEC, US-Ostküste) bleibt in „datum“.
        zeit: r.acceptanceDateTime && Number.isFinite(Date.parse(r.acceptanceDateTime[i])) ? new Date(Date.parse(r.acceptanceDateTime[i])).toISOString() : r.filingDate[i] ? r.filingDate[i] + "T00:00:00Z" : null,
        datum: r.filingDate[i] || null,
        link: acc && r.primaryDocument && r.primaryDocument[i] ? `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}/${r.primaryDocument[i]}` : null,
      });
    }
    return aus;
  }

  // ---------- „Schon gesehen“ (nur auf diesem Gerät, im Browserspeicher; nie im Worker) ----------
  // Wie im Vorbild: gezeigte Einträge werden 30 Tage gemerkt; höchstens 1.000. Ein beschädigter Stand wird erkannt und neu angelegt.
  const GESEHEN_TAGE = 30;
  const GESEHEN_MAX = 1000;
  const schluesselVon = (m) => `${m.art || "schlagzeile"}:${m.id}`;

  // Text aus dem Speicher → { zustand: { ids: { schluessel: ISO } }, beschaedigt }
  function gesehenLesen(text) {
    if (text === null || text === undefined || text === "") return { zustand: { ids: {} }, beschaedigt: false };
    let roh;
    try { roh = JSON.parse(text); } catch (e) { return { zustand: { ids: {} }, beschaedigt: true }; }
    if (!roh || typeof roh !== "object" || !roh.ids || typeof roh.ids !== "object" || Array.isArray(roh.ids)) return { zustand: { ids: {} }, beschaedigt: true };
    const ids = {};
    let verworfen = 0;
    for (const [k, v] of Object.entries(roh.ids)) {
      if (typeof k === "string" && k.length <= 300 && typeof v === "string" && Number.isFinite(Date.parse(v))) ids[k] = v;
      else verworfen++;
    }
    return { zustand: { ids }, beschaedigt: verworfen > 0 };
  }

  // Markiert jede Meldung mit neu: true/false und gibt den neuen Zustand zurück (alle gezeigten als gesehen, alte entfernt)
  function gesehenAnwenden(meldungen, zustand, jetzt = Date.now()) {
    const ids = { ...((zustand && zustand.ids) || {}) };
    const grenze = jetzt - GESEHEN_TAGE * 86400000;
    for (const [k, v] of Object.entries(ids)) if (Date.parse(v) < grenze) delete ids[k];
    const aus = (meldungen || []).map((m) => ({ ...m, neu: !(schluesselVon(m) in ids) }));
    const stempel = new Date(jetzt).toISOString();
    for (const m of aus) if (m.neu) ids[schluesselVon(m)] = stempel;
    const behalten = Object.entries(ids).sort((a, b) => b[1].localeCompare(a[1])).slice(0, GESEHEN_MAX);
    return { meldungen: aus, zustand: { ids: Object.fromEntries(behalten) }, neu: aus.filter((m) => m.neu).length };
  }

  // ---------- Zeitfenster (ab 14t, Skill-Profil trader-news, news.py:331-344) ----------
  // Behalten wird, was nicht älter als „stunden“ ist – die Grenze zählt mit (news.py:337: verworfen nur bei Zeit < Grenze). Ohne Zeit:
  // bleibt („Zeit unbekannt“, wie im Original). SEC-Meldungen haben nur ein Datum (…T00:00:00Z): sie zählen bis zum Ende dieses Tages,
  // sonst fiele ein 8-K vom Vortag bis zu 24 h zu früh heraus. Zeit mehr als 5 Minuten in der Zukunft: bleibt sichtbar, aber als ungültig
  // markiert. Nichts wird still entfernt: die Zahl der ausgeblendeten Einträge wird zurückgegeben.
  const FENSTER_STUNDEN = 48;
  function fensterAnwenden(meldungen, { jetzt = Date.now(), stunden = FENSTER_STUNDEN } = {}) {
    const grenze = jetzt - stunden * 3600000, zeigen = [];
    let ausgeblendet = 0;
    for (const m of meldungen || []) {
      const t = m && m.zeit ? Date.parse(m.zeit) : NaN;
      if (!Number.isFinite(t)) { zeigen.push({ ...m, zeit_unbekannt: true }); continue; }
      const nurDatum = /T00:00:00(\.000)?Z$/.test(String(m.zeit)) && m.art === "meldung";
      if (t > jetzt + 5 * 60000) { zeigen.push({ ...m, zeit_ungueltig: "Zeit in der Zukunft – ungültig" }); continue; }
      const bis = nurDatum ? t + 86400000 - 1 : t;
      if (bis < grenze) { ausgeblendet++; continue; }
      zeigen.push(nurDatum ? { ...m, nur_datum: true } : m);
    }
    return { zeigen, ausgeblendet, grenze: new Date(grenze).toISOString(), stunden };
  }

  global.AktienNachrichten = { einordnen, zusammenfassen, secMeldungen, gesehenLesen, gesehenAnwenden, fensterAnwenden, FENSTER_STUNDEN, ITEMS_8K, WICHTIG: [...WICHTIG], GESEHEN_TAGE, GESEHEN_MAX };
})(typeof window !== "undefined" ? window : globalThis);
