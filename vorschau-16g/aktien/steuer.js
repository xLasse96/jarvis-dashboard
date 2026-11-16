// JARVIS Aktien – Steuer-Information nach trader-tax (ab 14ze). Reine Rechnung ohne Netzwerk, nach dem Vorbild von trader-tax/lots.py aus
// github.com/Jakeschincariol/trader-skill (MIT, Copyright (c) 2026 Jake Schincariol, Commit 5189e79), in JavaScript übertragen.
// KEINE Steuerberatung, insbesondere KEINE deutsche: Es sind die Rechenregeln des US-Bundessteuerrechts (Haltedauer kurz/lang, Wash-Sale),
// angewandt auf die Kauflose, die man übergibt. Deutsche Regeln (Abgeltungsteuer, Verlustverrechnungstöpfe, Freistellungsauftrag,
// Teilfreistellung) bildet das Modul NICHT ab. Ob etwas für dich gilt, entscheidet eine Steuerberaterin oder ein Steuerberater.
// Orders entstehen hier nie: Harvest-Vorschläge sind nur Text; Verkäufe bucht allein der Paper-Kern.
(function (global) {
  "use strict";

  // lots.py:43-44 – Familien „substanziell gleicher“ Aktien für die Wash-Sale-Prüfung
  const FAMILIEN = [["GOOGL", "GOOG"], ["BRK.A", "BRK.B", "BRK-A", "BRK-B"], ["FOXA", "FOX"], ["NWSA", "NWS"], ["LLYVA", "LLYVK"], ["LEN", "LEN.B"], ["UA", "UAA"]];
  const EPS = 1e-9, TAG = 86400000;
  const HINWEIS = "Keine Steuerberatung – insbesondere keine deutsche: JARVIS rechnet hier nur nach den US-Regeln des Trader-Skills (Haltedauer kurz/lang, Wash-Sale) auf deinen Kauflosen. "
    + "Deutsche Regeln (Abgeltungsteuer, Verlusttöpfe, Freistellungsauftrag) sind nicht enthalten. Wash-Sale zählt auch Käufe in anderen Konten (IRA, Ehepartner, andere Broker), die JARVIS nicht sieht. "
    + "Vor jeder Entscheidung eine Steuerberaterin oder einen Steuerberater fragen.";

  class SteuerFehler extends Error {}

  // Python round(x, n) – wie aktien/sec.js runden (exakter Binärwert, nur echte Gleichstände zur geraden Ziffer)
  function runden(x, stellen = 2) {
    if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return x;
    const genau = Math.abs(x).toFixed(100), punkt = genau.indexOf(".");
    if (!/^50*$/.test(genau.slice(punkt + 1 + stellen))) return Number(x.toFixed(stellen));
    let z = BigInt(genau.slice(0, punkt) + genau.slice(punkt + 1, punkt + 1 + stellen));
    if (z % 2n === 1n) z += 1n;
    const t = z.toString().padStart(stellen + 1, "0");
    return (x < 0 ? -1 : 1) * Number(stellen ? t.slice(0, t.length - stellen) + "." + t.slice(-stellen) : t);
  }
  // lots.py:65-70 – Datum JJJJ-MM-TT, sonst Fehler
  function tag(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
    if (!m || new Date(t).getUTCDate() !== +m[3] || new Date(t).getUTCMonth() !== +m[2] - 1) throw new SteuerFehler(`kein Datum (JJJJ-MM-TT): „${String(s).slice(0, 20)}“`);
    return t;
  }
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  // lots.py:73-81 – Geld mit 2 Stellen, Minus erst unter −0,004; Stückzahl bis 6 Stellen ohne Endnullen
  function geld(x) { x = Number(x); return (x < -0.004 ? "-" : "") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD"; }
  function stueck(x) { return Number(x).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0"; }
  function familie(ticker) { const t = String(ticker).toUpperCase(); const f = FAMILIEN.find((x) => x.includes(t)); return f ? [...f] : [t]; }

  // lots.py:98-120 – Lose je Ticker: id (TICKER-N nach Listenplatz), Datum, Stück, Gesamtbasis, je Stück; Lose ≤ 1e-9 Stück übersprungen
  function lose(portfolio) {
    const aus = {};
    for (const p of (portfolio && portfolio.positions) || []) {
      const t = String(p.ticker || p.symbol || "").toUpperCase();
      if (!t) continue;
      const liste = [];
      (p.lots || []).forEach((l, i) => {
        const sh = Number(l.shares || 0), cost = Number(l.cost || 0);
        if (!(sh > EPS)) return;
        liste.push({ id: l.id || `${t}-${i + 1}`, datum: tag(l.date), shares: sh, cost, per_share: cost / sh });
      });
      if (!liste.length && Number(p.shares || 0) > 0) throw new SteuerFehler(`${t} hat Stücke, aber keine Lose (Datum, Stück, Kosten).`);
      liste.sort((a, b) => a.datum - b.datum || String(a.id).localeCompare(String(b.id)));
      aus[t] = liste;
    }
    return aus;
  }
  // lots.py:123-132 – langfristig nur bei Verkauf NACH dem ersten Jahrestag; 29.02. → 28.02.
  function jahrestag(t) { const d = new Date(t), y = d.getUTCFullYear() + 1, m = d.getUTCMonth(), dd = d.getUTCDate(); const j = Date.UTC(y, m, dd); return new Date(j).getUTCMonth() === m ? j : Date.UTC(y, m, 28); }
  function frist(gekauft, verkauft) { return verkauft > jahrestag(gekauft) ? "lang" : "kurz"; }

  // lots.py:135-162 – Unrealisiert je Los und Position; fehlende Preise gelistet statt Abbruch
  function unrealisiert(portfolio, preise, heute) {
    const zeilen = [], summen = [], fehlend = [];
    for (const [t, ls] of Object.entries(lose(portfolio)).sort(([a], [b]) => a.localeCompare(b))) {
      const p = preise[t];
      if (!p) { fehlend.push(t); continue; }
      const s = { ticker: t, shares: 0, cost: 0, value: 0, kurz: 0, lang: 0 };
      for (const l of ls) {
        const wert = l.shares * p, g = wert - l.cost, f = frist(l.datum, heute);
        zeilen.push({ ticker: t, id: l.id, datum: iso(l.datum), shares: l.shares, cost: runden(l.cost), preis: p, wert: runden(wert), gewinn: runden(g), frist: f, lang_ab: iso(jahrestag(l.datum) + TAG) });
        s.shares += l.shares; s.cost += l.cost; s.value += wert; s[f] += g;
      }
      s.gewinn = runden(s.value - s.cost);
      s.pct = s.cost ? runden(100 * s.gewinn / s.cost) : 0;
      if (Math.abs(s.pct) < 0.005) s.pct = 0;
      for (const k of ["cost", "value", "kurz", "lang"]) s[k] = runden(s[k]);
      summen.push(s);
    }
    return { zeilen, summen, fehlend };
  }
  // lots.py:165-193 – Losauswahl fifo/hifo/specific mit Prüfungen
  function losAuswahl(ls, shares, methode = "fifo", ids = null) {
    const gehalten = ls.reduce((s, l) => s + l.shares, 0);
    if (shares > gehalten + EPS) throw new SteuerFehler(`Verkauf von ${stueck(shares)} Stück, gehalten werden nur ${stueck(gehalten)}.`);
    let ordnung;
    if (methode === "fifo") ordnung = ls.slice();
    else if (methode === "hifo") ordnung = ls.slice().sort((a, b) => b.per_share - a.per_share);
    else if (methode === "specific") {
      if (!ids || !ids.length) throw new SteuerFehler("Methode „specific“ braucht Los-Kennungen (z. B. KO-2).");
      const nachId = Object.fromEntries(ls.map((l) => [l.id, l])), unbekannt = ids.filter((i) => !nachId[i]);
      if (unbekannt.length) throw new SteuerFehler(`Kein solches Los: ${unbekannt.join(", ")} (Lose: ${Object.keys(nachId).join(", ")}).`);
      ordnung = ids.map((i) => nachId[i]);
      if (shares > ordnung.reduce((s, l) => s + l.shares, 0) + EPS) throw new SteuerFehler(`Die genannten Lose halten weniger als ${stueck(shares)} Stück.`);
    } else throw new SteuerFehler(`Unbekannte Methode „${methode}“ (fifo, hifo, specific).`);
    const aus = []; let rest = shares;
    for (const l of ordnung) { if (rest <= EPS) break; const nimm = Math.min(rest, l.shares); aus.push([l, nimm]); rest -= nimm; }
    return aus;
  }
  // lots.py:196-211 – Verkaufssimulation je Los, kurz/lang getrennt
  function verkaufSimulieren(ls, shares, preis, verkauft, methode = "fifo", ids = null) {
    const genutzt = [], r = { erloes: 0, basis: 0, kurz: 0, lang: 0 };
    for (const [l, nimm] of losAuswahl(ls, shares, methode, ids)) {
      const basis = l.per_share * nimm, erloes = preis * nimm, f = frist(l.datum, verkauft);
      genutzt.push({ id: l.id, gekauft: iso(l.datum), shares: runden(nimm, 6), basis: runden(basis), erloes: runden(erloes), gewinn: runden(erloes - basis), frist: f });
      r.erloes += erloes; r.basis += basis; r[f] += erloes - basis;
    }
    for (const k of Object.keys(r)) r[k] = runden(r[k]);
    r.gewinn = runden(r.erloes - r.basis); r.lose = genutzt;
    return r;
  }
  // lots.py:216-253 – Wash-Prüfung: weiter gehaltene Stücke der Familie mit Kauf ±30 Tage, geplante Käufe (qty, sonst notional ÷ Preis)
  function geplanteKaeufe(orders, preise) {
    return (orders || []).filter((o) => String(o.side || "").toLowerCase() === "buy").map((o) => {
      const t = String(o.symbol || "").toUpperCase();
      const sh = o.qty !== undefined && o.qty !== null ? Number(o.qty) : o.notional !== undefined && o.notional !== null && preise[t] ? Number(o.notional) / preise[t] : null;
      return { ticker: t, shares: sh };
    });
  }
  function washPruefen(ticker, verkauft, genutzt, portfolio, orders, preise) {
    const fam = familie(ticker), ausLos = Object.fromEntries(genutzt.map((u) => [u.id, u.shares])), treffer = [];
    const lo = verkauft - 30 * TAG, hi = verkauft + 30 * TAG;
    for (const [t, ls] of Object.entries(lose(portfolio))) {
      if (!fam.includes(t)) continue;
      for (const l of ls) { const bleibt = l.shares - (ausLos[l.id] || 0); if (bleibt > EPS && lo <= l.datum && l.datum <= hi) treffer.push({ ticker: t, datum: iso(l.datum), shares: runden(bleibt, 6), quelle: `Los ${l.id}, das du weiter hältst` }); }
    }
    for (const b of geplanteKaeufe(orders, preise)) if (fam.includes(b.ticker)) treffer.push({ ticker: b.ticker, datum: "geplant", shares: b.shares, quelle: "geplanter Kauf (Aufteilung/Vorschlag)" });
    return treffer;
  }
  // lots.py:256-265 – nicht abziehbarer Verlust anteilig nach Ersatzstücken (höchstens 100 %), unbekannte Ersatzmenge → voller Verlust
  function nichtAbziehbar(verlust, verkauftStueck, treffer) {
    if (verlust >= 0 || !treffer.length) return 0;
    let ersatz = 0;
    for (const h of treffer) { if (h.shares === null || h.shares === undefined) return runden(-verlust); ersatz += h.shares; }
    return verkauftStueck ? runden(-verlust * Math.min(1, ersatz / verkauftStueck)) : 0;
  }
  // lots.py:268-281 – Wash-Abfrage vor einem Kauf: Verlustverkäufe der Familie mit Verkauf ≤ Kaufdatum ≤ Verkauf + 30; Rückkauf frühestens +31
  function verlustVerkaeufe(ticker, wann, realisiert) {
    const fam = familie(ticker);
    return (realisiert || []).filter((r) => fam.includes(String(r.symbol || "").toUpperCase()) && Number(r.gewinn || 0) < 0 && tag(r.datum) <= wann && wann <= tag(r.datum) + 30 * TAG);
  }
  function rueckkaufAb(verkauft) { return iso(verkauft + 31 * TAG); }
  // lots.py:286-312 – Harvest-Kandidaten: nur Verlust-Lose (Wert < Kosten − 0,005), Mindestverlust und optional Prozent, nach Verlust sortiert
  function harvest(portfolio, preise, heute, { minVerlust = 100, minPct = 0, orders = null } = {}) {
    const k = [];
    for (const [t, ls] of Object.entries(lose(portfolio)).sort(([a], [b]) => a.localeCompare(b))) {
      const p = preise[t]; if (!p) continue;
      const verlierer = ls.filter((l) => l.shares * p < l.cost - 0.005); if (!verlierer.length) continue;
      const sh = verlierer.reduce((s, l) => s + l.shares, 0), cost = verlierer.reduce((s, l) => s + l.cost, 0), verlust = sh * p - cost, pct = cost ? 100 * verlust / cost : 0;
      if (-verlust < minVerlust || -pct < minPct) continue;
      const v = verkaufSimulieren(ls, sh, p, heute, "specific", verlierer.map((l) => l.id)), treffer = washPruefen(t, heute, v.lose, portfolio, orders, preise);
      k.push({ ticker: t, preis: p, shares: runden(sh, 6), lose: verlierer.map((l) => l.id), alle_lose: verlierer.length === ls.length, fifo_gleich: ls.slice(0, verlierer.length).map((l) => l.id).join() === verlierer.map((l) => l.id).join(),
        verlust: runden(verlust), pct: runden(pct), kurz: v.kurz, lang: v.lang, wash: treffer, nicht_abziehbar: nichtAbziehbar(verlust, sh, treffer), rueckkauf_ab: rueckkaufAb(heute) });
    }
    return k.sort((a, b) => a.verlust - b.verlust);
  }
  // lots.py:315-329 – Harvest-VORSCHLÄGE (nur Text, keine Order); mit Wash-Konflikt nur auf ausdrücklichen Wunsch
  function harvestVorschlaege(kandidaten, { mitWash = false } = {}) {
    return kandidaten.filter((c) => mitWash || !c.wash.length).map((c) => ({ symbol: c.ticker, seite: "verkauf", stueck: stueck(c.shares), nur_vorschlag: true,
      warum: `Vorschlag Verlustverrechnung (US): Lose ${c.lose.join(", ")} für einen geschätzten Verlust von ${geld(c.verlust)} (${geld(c.kurz)} kurzfristig, ${geld(c.lang)} langfristig). ${familie(c.ticker).sort().join("/")} nicht vor dem ${c.rueckkauf_ab} wieder kaufen (Wash-Sale). Keine Steuerberatung.`
        + (c.fifo_gleich ? "" : " Das sind nicht deine ältesten Lose: Ein Broker verkauft sonst nach FIFO und das Ergebnis weicht ab.") }));
  }

  // JARVIS-Anschluss: Lose aus dem Ledger des Paper-Kerns (nur gefüllte Buchungen). Kauf = neues Los (Kosten = Volumen + Gebühr),
  // Verkauf = Abgang nach FIFO; der realisierte Verkauf wird mit Fristen je Los festgehalten (lots.py:334-371 sinngemäß – gebucht hat der Paper-Kern).
  function ausLedger(ledger) {
    const pos = {}, realisiert = [], zaehler = {};
    const gef = (ledger || []).filter((e) => e && e.zustand === "gefuellt" && Number.isFinite(e.zeit)).slice().sort((a, b) => a.zeit - b.zeit);
    for (const e of gef) {
      const t = String(e.symbol || "").toUpperCase(), datum = iso(e.zeit);
      pos[t] = pos[t] || [];
      if (e.seite === "kauf") { zaehler[t] = (zaehler[t] || 0) + 1; pos[t].push({ id: `${t}-${zaehler[t]}`, date: datum, shares: Number(e.menge), cost: runden(Number(e.volumen) + Number(e.gebuehr || 0)) }); }
      else if (e.seite === "verkauf") {
        const ls = lose({ positions: [{ ticker: t, lots: pos[t] }] })[t] || [];
        const menge = Math.min(Number(e.menge), ls.reduce((s, l) => s + l.shares, 0));
        if (!(menge > EPS)) continue;
        const erloesNetto = Number(e.volumen) - Number(e.gebuehr || 0), preisNetto = erloesNetto / Number(e.menge);
        const v = verkaufSimulieren(ls, menge, preisNetto, tag(datum), "fifo");
        realisiert.push({ datum, symbol: t, shares: runden(menge, 6), erloes: v.erloes, basis: v.basis, gewinn: v.gewinn, kurz: v.kurz, lang: v.lang, lose: v.lose, ledger: e.trade_id });
        const genommen = Object.fromEntries(v.lose.map((u) => [u.id, u.shares]));
        pos[t] = pos[t].map((l) => genommen[l.id] ? { ...l, cost: runden(l.cost * (1 - genommen[l.id] / l.shares)), shares: runden(l.shares - genommen[l.id], 6) } : l).filter((l) => l.shares > EPS);
      }
    }
    return { portfolio: { positions: Object.entries(pos).filter(([, ls]) => ls.length).map(([t, ls]) => ({ ticker: t, shares: runden(ls.reduce((s, l) => s + l.shares, 0), 6), lots: ls })) }, realisiert };
  }
  // lots.py:374-381 – realisierte Summen eines Jahres
  function realisiertJahr(realisiert, jahr) {
    const r = { kurz: 0, lang: 0, anzahl: 0 };
    for (const x of realisiert || []) if (String(x.datum).startsWith(String(jahr))) { r.kurz += Number(x.kurz || 0); r.lang += Number(x.lang || 0); r.anzahl++; }
    return { kurz: runden(r.kurz), lang: runden(r.lang), anzahl: r.anzahl };
  }

  global.AktienSteuer = { HINWEIS, FAMILIEN, SteuerFehler, runden, tag, iso, geld, stueck, familie, lose, jahrestag, frist, unrealisiert, losAuswahl, verkaufSimulieren,
    geplanteKaeufe, washPruefen, nichtAbziehbar, verlustVerkaeufe, rueckkaufAb, harvest, harvestVorschlaege, ausLedger, realisiertJahr };
})(typeof window !== "undefined" ? window : globalThis);
