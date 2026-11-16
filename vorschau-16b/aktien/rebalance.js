// JARVIS Aktien – Rebalancing (Stufe 3). Reine Rechnung ohne Netzwerk: vergleicht die Positionen des Paper-Kontos mit
// den vom Nutzer gesetzten Zielgewichten und schlägt Käufe/Verkäufe vor. Nur VORSCHLÄGE – jeder geht über die Risiko-Prüfung
// der Stufe 1 und braucht dort die Freigabe genau dieser Order. Nie automatische Ausführung.
// Rechenweg nach dem Vorbild von trader-rebalance (rebalance.py) aus github.com/Jakeschincariol/trader-skill
// (MIT, Copyright (c) 2026 Jake Schincariol), in JavaScript übertragen. Abweichung zur Vorlage: Verkäufe in Dollar statt Stück,
// weil die Stufe-1-Prüfung nur Dollar-Orders (notional) annimmt; Grenzen (Reserve, Deckel, Mindest-/Höchstorder) vom Worker.
//   Kontowert   = Bargeld + Positionen zum Kurs
//   Ziele       = Gewichte über das Aktienbudget (Kontowert − Barreserve), keine Aktie über dem Deckel (Überschuss verteilt)
//   Abweichung  = aktueller Anteil − Zielanteil (Prozentpunkte); gehandelt wird nur außerhalb des Bands (Standard 5 Punkte),
//                 dann ganz zurück aufs Ziel
//   Reihenfolge = Verkäufe vor Käufen; Käufe nur aus Bargeld über der Reserve (sonst alle gleichmäßig gekürzt)
//   Positionen außerhalb der Ziele bleiben unberührt, außer der Nutzer will sie verkaufen
(function (global) {
  "use strict";

  const STANDARD = { barreservePct: 10, maxPositionPct: 25, minOrderUsd: 5, maxOrderUsd: 1000, bandPct: 5, gesperrt: [], verkaufeNichtZiele: false };
  const EPS = 1e-9;
  const TICKER = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;
  const PUFFER_KOMPLETT = 0.995;
  const HINWEIS = "Nur Vorschläge nach deinen Zielgewichten – keine Prognose, keine automatische Ausführung. Jede Order braucht Risiko-Prüfung und deine Freigabe.";

  // Python round(x, stellen) wie im Original (5189e79): korrekt gerundeter Dezimalwert des exakten Binärwerts, nur echte Gleichstände
  // (exakt …5) zur geraden Ziffer. ab AJ4: vorher wurde erst auf 1e-6 geglättet – 9,9499… (Binärwert von 9,95) ergab 10,0 statt 9,9,
  // 35,0500…04 ergab 35,0 statt 35,1 (Screener-Schwellen). toFixed rechnet mit dem exakten Wert; nur den echten Gleichstand selbst entscheiden.
  function runden(x, stellen) {
    if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return x;
    const genau = Math.abs(x).toFixed(100), punkt = genau.indexOf(".");
    if (!/^50*$/.test(genau.slice(punkt + 1 + stellen))) return Number(x.toFixed(stellen));
    let z = BigInt(genau.slice(0, punkt) + genau.slice(punkt + 1, punkt + 1 + stellen));
    if (z % 2n === 1n) z += 1n;
    const t = z.toString().padStart(stellen + 1, "0");
    return (x < 0 ? -1 : 1) * Number(stellen ? t.slice(0, t.length - stellen) + "." + t.slice(-stellen) : t);
  }
  const geld = (x) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD";

  // [{symbol, gewicht}] oder {TICKER: gewicht} → auf 100 % normiert; Fehler bei ungültigen Angaben
  function zieleNormieren(ziele, gesperrt = []) {
    const liste = Array.isArray(ziele) ? ziele : Object.entries(ziele || {}).map(([symbol, gewicht]) => ({ symbol, gewicht }));
    const raus = new Set(gesperrt.map((x) => String(x).toUpperCase()));
    const aus = {};
    const fehler = [];
    for (const z of liste) {
      const t = String(z.symbol || z.ticker || "").trim().toUpperCase();
      const w = Number(z.gewicht ?? z.weight);
      if (!TICKER.test(t)) { fehler.push(`„${t || "?"}“ ist kein US-Aktien-Ticker`); continue; }
      if (!Number.isFinite(w) || w < 0) { fehler.push(`${t}: Gewicht ungültig`); continue; }
      if (w === 0 || raus.has(t)) continue;
      aus[t] = (aus[t] || 0) + w;
    }
    const summe = Object.values(aus).reduce((s, w) => s + w, 0);
    if (fehler.length) return { fehler: "Zielgewichte ungültig: " + fehler.join("; ") };
    if (!summe) return { fehler: "Keine Zielgewichte über 0 – nichts zum Ausrichten." };
    return { gewichte: Object.fromEntries(Object.entries(aus).map(([t, w]) => [t, (100 * w) / summe])) };
  }

  function gedeckelteZiele(gewichte, budget, deckel) {
    const ziel = {};
    const aktiv = { ...gewichte };
    let rest = budget;
    while (Object.keys(aktiv).length) {
      const summe = Object.values(aktiv).reduce((s, w) => s + w, 0);
      const versuch = Object.fromEntries(Object.entries(aktiv).map(([t, w]) => [t, (rest * w) / summe]));
      const drueber = Object.keys(versuch).filter((t) => versuch[t] > deckel + EPS);
      if (!drueber.length) { Object.assign(ziel, versuch); break; }
      for (const t of drueber) { ziel[t] = deckel; rest -= deckel; delete aktiv[t]; }
      if (rest <= EPS) { for (const t of Object.keys(aktiv)) ziel[t] = 0; break; }
    }
    return ziel;
  }

  // konto: {cash, positionen: [{symbol, menge, kurs}]}; preise: {TICKER: Kurs} für Ziele ohne Position (frisch, sonst weglassen)
  function planen(konto, preiseExtra, ziele, regelnRoh = {}) {
    const r = { ...STANDARD, ...regelnRoh };
    const z = zieleNormieren(ziele, r.gesperrt);
    if (z.fehler) return { fehler: z.fehler };
    const gewichte = z.gewichte;
    const bargeld = Number(konto && konto.cash);
    if (!Number.isFinite(bargeld) || bargeld < 0) return { fehler: "Bargeld des Kontos fehlt oder ist ungültig." };
    const bestand = {}, preise = { ...(preiseExtra || {}) };
    for (const p of (konto && konto.positionen) || []) {
      const t = String(p.symbol || "").toUpperCase();
      if (!t || !(Number(p.menge) > 0)) continue;
      if (p.seite && p.seite !== "long") return { fehler: `${t}: Leerverkaufs-Position – Rebalancing nicht möglich.` };
      bestand[t] = (bestand[t] || 0) + Number(p.menge);
      if (Number(p.kurs) > 0) preise[t] = Number(p.kurs);
    }
    if (bargeld <= 0 && !Object.keys(bestand).length) return { fehler: "Das Konto ist leer – nichts auszurichten (für einen ersten Kauf: Budget aufteilen)." };
    const alle = [...new Set([...Object.keys(bestand), ...Object.keys(gewichte)])].sort((a, b) => (gewichte[b] || 0) - (gewichte[a] || 0) || a.localeCompare(b));
    const ohneKurs = alle.filter((t) => !(Number(preise[t]) > 0));
    if (ohneKurs.length) return { fehler: `Kein (aktueller) Kurs für ${ohneKurs.join(", ")} – ohne Kurs kein Vorschlag (nicht geschätzt).`, ohne_kurs: ohneKurs };
    const wert = Object.fromEntries(alle.map((t) => [t, (bestand[t] || 0) * preise[t]]));
    const gesamt = bargeld + Object.values(wert).reduce((s, x) => s + x, 0);
    if (gesamt <= 0) return { fehler: "Das Konto ist leer – nichts auszurichten (für einen ersten Kauf: Budget aufteilen)." };
    const reserve = (gesamt * r.barreservePct) / 100;
    const deckel = (gesamt * r.maxPositionPct) / 100;
    const ziel = gedeckelteZiele(gewichte, gesamt - reserve, deckel);
    const zeilen = [], verkaeufe = [], kaeufe = [], hinweise = [];
    for (const t of alle) {
      const verfolgt = t in gewichte;
      const zu = ziel[t] || 0;
      const ist = (100 * wert[t]) / gesamt, soll = (100 * zu) / gesamt, abw = ist - soll;
      const zeile = { symbol: t, menge: runden(bestand[t] || 0, 6), kurs: preise[t], wert: runden(wert[t], 2), ist_pct: runden(ist, 2), ziel_pct: runden(soll, 2),
        abweichung: Math.abs(abw) >= 0.005 ? runden(abw, 2) : 0, ziel_usd: runden(zu, 2), im_ziel: verfolgt, aktion: "halten" };
      zeilen.push(zeile);
      if (!verfolgt) {
        if (r.verkaufeNichtZiele) {
          if ((bestand[t] || 0) > EPS) { verkaeufe.push({ symbol: t, usd: wert[t], komplett: true, warum: "nicht in deinen Zielen – ganze Position verkaufen (von dir gewählt)" }); zeile.aktion = "ganz verkaufen"; }
        } else zeile.aktion = "nicht in den Zielen, unberührt";
        continue;
      }
      if (Math.abs(abw) <= r.bandPct + EPS) continue;
      const delta = zu - wert[t];
      const warum = `${abw > 0 ? "+" : ""}${abw.toFixed(1)} Punkte vom Ziel ${soll.toFixed(1)} % (Band ${r.bandPct})`;
      if (delta < 0) { verkaeufe.push({ symbol: t, usd: -delta, komplett: false, warum }); zeile.aktion = "verkaufen"; }
      else { kaeufe.push({ symbol: t, usd: delta, warum }); zeile.aktion = "kaufen"; }
    }

    const vorschlaege = [];
    let bargeldDanach = bargeld;
    const order = (symbol, side, betrag) => ({ symbol, side, notional: String(betrag), type: "market", time_in_force: "day" });
    for (const v of verkaeufe) {
      let usd = v.usd;
      if (!v.komplett && usd > r.maxOrderUsd + EPS) { hinweise.push(`${v.symbol}: Verkauf auf den Höchstbetrag ${geld(r.maxOrderUsd)} gekürzt – nach der Ausführung erneut planen.`); usd = r.maxOrderUsd; }
      usd = Math.min(usd, wert[v.symbol]) * (v.komplett ? PUFFER_KOMPLETT : 1);
      if (v.komplett && usd > r.maxOrderUsd + EPS) { hinweise.push(`${v.symbol}: Komplettverkauf auf den Höchstbetrag ${geld(r.maxOrderUsd)} gekürzt.`); usd = r.maxOrderUsd; }
      const betrag = Math.floor(usd * 100 + EPS) / 100;
      if (betrag < r.minOrderUsd - EPS) { hinweise.push(`${v.symbol}: Verkauf von ${geld(betrag)} unter der Mindestorder ${geld(r.minOrderUsd)} – ausgelassen.`); continue; }
      bargeldDanach += betrag;
      vorschlaege.push({ order: order(v.symbol, "sell", betrag), warum: v.warum + (v.komplett ? " (0,5 % Puffer, ein kleiner Rest kann bleiben)" : "") });
    }
    const verfuegbar = Math.max(bargeldDanach - reserve, 0);
    const gewuenscht = kaeufe.reduce((s, k) => s + k.usd, 0);
    let faktor = 1;
    if (gewuenscht > verfuegbar + EPS) {
      faktor = gewuenscht ? verfuegbar / gewuenscht : 0;
      hinweise.push(`Käufe auf ${Math.round(100 * faktor)} % gekürzt: nur ${geld(verfuegbar)} frei über der Barreserve von ${geld(reserve)}.`);
    }
    for (const k of kaeufe) {
      let usd = k.usd * faktor;
      if (usd > r.maxOrderUsd + EPS) { hinweise.push(`${k.symbol}: Kauf auf den Höchstbetrag ${geld(r.maxOrderUsd)} gekürzt – nach der Ausführung erneut planen.`); usd = r.maxOrderUsd; }
      const betrag = Math.floor(usd + EPS);
      if (betrag < r.minOrderUsd - EPS || betrag < 1) { hinweise.push(`${k.symbol}: Kauf von ${geld(betrag)} unter der Mindestorder ${geld(r.minOrderUsd)} – ausgelassen.`); continue; }
      vorschlaege.push({ order: order(k.symbol, "buy", betrag), warum: k.warum });
    }
    const ausgegeben = vorschlaege.filter((v) => v.order.side === "buy").reduce((s, v) => s + Number(v.order.notional), 0);
    return {
      kontowert: runden(gesamt, 2), bargeld: runden(bargeld, 2), reserve: runden(reserve, 2), deckel: runden(deckel, 2), band: r.bandPct,
      zeilen, vorschlaege, orders: vorschlaege.map((v) => v.order), hinweise, bargeld_danach: runden(bargeldDanach - ausgegeben, 2), hinweis: HINWEIS,
    };
  }

  // ---------- Portfolio-Risikoübersicht (ab 11-06e) ----------
  // eingabe: { positionen: [{ symbol, wert (USD, ≥ 0), sektor? }], bargeld (USD), grenzen: { maxPositionPct, maxSektorPct } }
  // Ergebnis: Gewichte je Position (am Gesamtwert), größte Position, Anteil Bargeld, Konzentration (Herfindahl-Index der Aktien,
  // „effektive Anzahl“ = 1 ÷ HHI), Sektorverteilung (unbekannte Sektoren getrennt ausgewiesen, nie geraten) und Warnungen.
  // Reine Beschreibung der Verteilung – keine Prognose, kein Value-at-Risk, keine Empfehlung.
  const r2 = (x) => Math.round(x * 100) / 100;
  function risikoUebersicht(eingabe) {
    const e = eingabe || {};
    const g = { maxPositionPct: 25, maxSektorPct: 40, ...(e.grenzen || {}) };
    const liste = (Array.isArray(e.positionen) ? e.positionen : []).filter((p) => p && p.symbol && Number(p.wert) > 0).map((p) => ({ symbol: String(p.symbol).toUpperCase(), wert: Number(p.wert), sektor: p.sektor || null }));
    const bargeld = Number(e.bargeld) > 0 ? Number(e.bargeld) : 0;
    const aktien = liste.reduce((s, p) => s + p.wert, 0);
    const gesamt = aktien + bargeld;
    if (!(gesamt > 0)) return { fehler: "Kein Vermögen erfasst (weder Positionen noch Bargeld)." };
    const pct = (x) => r2((x / gesamt) * 100);
    const gewichte = liste.map((p) => ({ ...p, gewicht_pct: pct(p.wert), anteil_aktien_pct: aktien > 0 ? r2((p.wert / aktien) * 100) : 0 })).sort((a, b) => b.wert - a.wert || a.symbol.localeCompare(b.symbol));
    const hhi = aktien > 0 ? liste.reduce((s, p) => s + (p.wert / aktien) ** 2, 0) : null;
    const sektoren = new Map();
    for (const p of gewichte) { const k = p.sektor || "unbekannt"; sektoren.set(k, (sektoren.get(k) || 0) + p.wert); }
    const sektorListe = [...sektoren].map(([sektor, wert]) => ({ sektor, wert: r2(wert), gewicht_pct: pct(wert) })).sort((a, b) => b.wert - a.wert);
    const warnungen = [];
    for (const p of gewichte) if (p.gewicht_pct > g.maxPositionPct) warnungen.push(`${p.symbol} macht ${p.gewicht_pct.toLocaleString("de-DE")} % des Gesamtwerts aus (Grenze ${g.maxPositionPct} %).`);
    for (const s of sektorListe) if (s.sektor !== "unbekannt" && s.gewicht_pct > g.maxSektorPct) warnungen.push(`Sektor „${s.sektor}“ macht ${s.gewicht_pct.toLocaleString("de-DE")} % aus (Grenze ${g.maxSektorPct} %).`);
    if (liste.length > 0 && liste.length <= 2) warnungen.push(`Nur ${liste.length} Position(en) – wenig gestreut.`);
    const unbekannt = sektoren.get("unbekannt") || 0;
    return {
      gesamt: r2(gesamt), aktien: r2(aktien), bargeld: r2(bargeld), bargeld_pct: pct(bargeld), anzahl: liste.length,
      gewichte, groesste: gewichte[0] || null, hhi: hhi === null ? null : Math.round(hhi * 10000) / 10000, effektive_anzahl: hhi ? Math.round((1 / hhi) * 10) / 10 : null,
      sektoren: sektorListe, sektor_unbekannt_pct: pct(unbekannt), warnungen,
      hinweis: "Beschreibung der Verteilung, keine Prognose und keine Empfehlung." + (unbekannt > 0 ? " Sektor nur, wenn er aus SEC-Daten (SIC) bekannt ist – sonst „unbekannt“." : ""),
    };
  }

  global.AktienRebalance = { planen, zieleNormieren, gedeckelteZiele, risikoUebersicht, STANDARD, HINWEIS, runden };
})(typeof window !== "undefined" ? window : globalThis);
