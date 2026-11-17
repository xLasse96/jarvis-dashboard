// JARVIS Dashboard – Modul „paper-live“ (ab 16g, Nutzerentscheidung 16.11.: automatische Ausführung NUR auf dem Alpaca-PAPER-Konto mit
// Not-Aus, Duplikatschutz und den bestehenden JARVIS-Grenzen; Echtgeld bleibt im Worker-Code ausgeschlossen).
// Ablauf je Zyklus (alle 5 Minuten, nur solange diese Seite offen ist und „Autonom“ läuft):
//   1. Freigabe-Tor: /aktien/status muss eindeutig bestätigen – Paper-Konto, Betriebsart „paper“, Alpaca eingerichtet, Grenzen ohne
//      Konfigurationsfehler, Allowlist gültig, Freigabecode im Worker eingerichtet, Handelswache erreichbar und Not-Aus AUSDRÜCKLICH aus,
//      Schutzschalter zu, Börse offen. Fehlt eine Bestätigung → keine Order (Grund im Protokoll). Ein bekannter Not-Aus im Dashboard sperrt auch.
//   2. Signal je Symbol aus echten Tageskerzen (/aktien/kerzen, Alpaca IEX) mit der bestehenden JARVIS-Regel der Paper-Automatik:
//      EMA kurz/lang (SIM.strategie) – Kauf bei Aufwärtskreuzung an der letzten ABGESCHLOSSENEN Kerze ohne Position, Verkauf der ganzen
//      Position bei Abwärtskreuzung. Kein erzwungenes Signal.
//   3. Order (Betrag = bestehender Kaufbetrag SIM.orderWert, höchstens die Worker-Grenze) → /aktien/pruefen (Risiko-Prüfung im Worker mit
//      seinen Grenzen) → nur bei PASS /aktien/order mit dem auf diesem Tablet gespeicherten Freigabecode. Trockenlauf: dieselben Prüfungen,
//      aber trockenlauf:true – der Worker sendet nichts.
//   4. Duplikatschutz: je Symbol, Seite und Signal-Kerze höchstens ein Sendeversuch (lokal gemerkt); dazu Doppel-Order-Sperre und
//      Tagesregeln des Workers. Jede externe Paper-Order steht ausdrücklich im Protokoll.
const LIVE = { uhr: null, laeuft: false, zyklus: false, schluessel: { code: "jarvis-freigabe-tablet", erledigt: "jarvis-paper-live-erledigt", protokoll: "jarvis-paper-live-protokoll", symbole: "jarvis-paper-live-symbole" }, intervallMs: 5 * 60000 };
const liveEl = (id) => document.getElementById(id);
function liveLesen(k, ersatz) { try { const v = localStorage.getItem(k); return v === null ? ersatz : v; } catch (e) { return ersatz; } }
function liveSchreiben(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function liveProtokoll(text, art = "info") {
  let p = []; try { p = JSON.parse(liveLesen(LIVE.schluessel.protokoll, "[]")); if (!Array.isArray(p)) p = []; } catch (e) { p = []; }
  p.unshift({ zeit: new Date().toISOString(), art, text: geheimnisMuster(String(text)).slice(0, 400) });
  liveSchreiben(LIVE.schluessel.protokoll, JSON.stringify(p.slice(0, 100)));
  liveProtokollZeigen();
}
function liveProtokollZeigen() {
  let p = []; try { p = JSON.parse(liveLesen(LIVE.schluessel.protokoll, "[]")); } catch (e) { p = []; }
  const ol = liveEl("lp-protokoll"); if (!ol) return;
  ol.replaceChildren(...(Array.isArray(p) && p.length ? p.slice(0, 15).map((x) => Object.assign(document.createElement("li"), { className: x.art === "order" ? "wz-wichtig" : "", textContent: `${new Date(x.zeit).toLocaleString("de-DE")} · ${x.text}` }))
    : [Object.assign(document.createElement("li"), { textContent: "Noch kein Lauf." })]));
}
function liveStatus(text) { const s = liveEl("lp-status"); if (s) s.textContent = text; }
// Freigabe-Tor: null = alles ausdrücklich bestätigt; sonst Liste der Gründe (dann keine Order)
function liveTor(st) {
  const g = [];
  if (!st || typeof st !== "object") return ["Worker-Status unbekannt"];
  if (st.paper !== true) g.push("Worker meldet kein Paper-Konto");
  if (!(st.betriebsart === "paper" && st.betriebsart_gueltig === true)) g.push(`Betriebsart nicht „paper“ (${st.betriebsart || "fehlt"})`);
  if (st.eingerichtet !== true) g.push("Alpaca-Paper-Schlüssel im Worker nicht eingerichtet");
  const gr = st.grenzen || {};
  if (!Array.isArray(gr.konfigFehler) || gr.konfigFehler.length) g.push("Grenzen unvollständig: " + (Array.isArray(gr.konfigFehler) ? gr.konfigFehler.join(", ") : "unbekannt"));
  if (!gr.erlaubteSymbole || gr.erlaubteSymbole.fehler) g.push("Allowlist: " + ((gr.erlaubteSymbole && gr.erlaubteSymbole.fehler) || "unbekannt"));
  if (st.freigabe_eingerichtet !== true) g.push("Freigabecode im Worker nicht eingerichtet (Secret JARVIS_FREIGABECODE)");
  const w = st.wache || {};
  if (!(w.erreichbar === true && w.notaus && w.notaus.aktiv === false && w.notaus.bekannt !== false)) g.push("Not-Aus nicht ausdrücklich aus (Handelswache: " + (w.notaus ? (w.notaus.aktiv ? "aktiv" : "unbekannt") : w.erreichbar === false ? "nicht erreichbar" : "unbekannt") + ")");
  // ab 16i: Order-Zähler der Handelswache (rollierendes Fenster, z. B. 10 in 30 Tagen) – unklar oder voll → keine Order (wie im Worker)
  const zo = w.zaehler && w.zaehler.order;
  if (!zo || zo.fehler || !Number.isFinite(zo.im_fenster) || !Number.isFinite(zo.max)) g.push("Order-Zähler der Handelswache unklar" + (zo && zo.fehler ? " (" + zo.fehler + ")" : ""));
  else if (zo.im_fenster >= zo.max) g.push(`Order-Grenze erreicht: ${zo.im_fenster} von ${zo.max} in ${typeof aktienFensterText === "function" ? aktienFensterText(zo.fenster_s) : zo.fenster_s + " s"}`);
  if (!(st.schutzschalter && st.schutzschalter.ok === true && st.schutzschalter.offen !== true)) g.push("Schutzschalter offen oder unbekannt");
  // ab 17c (Paket G): Broker-Adresse laut Worker muss ausdrücklich die Alpaca-Paper-API sein
  if (st.adresse !== "https://paper-api.alpaca.markets") g.push("Broker-Adresse nicht eindeutig Alpaca-Paper (" + String(st.adresse || "unbekannt").slice(0, 60) + ")");
  if (typeof tradingZustand !== "undefined" && tradingZustand && tradingZustand.notaus === true) g.push("Not-Aus im Dashboard aktiv");
  return g.length ? g : null;
}
// EMA-Kreuzung an der letzten abgeschlossenen Kerze (gleiche EMA wie die Paper-Automatik)
function liveSignal(kerzen, uhr) {
  const T = window.AktienTechnik, s = SIM.strategie;
  const fertig = (typeof wzLaufend === "function" && wzLaufend(kerzen, uhr)) ? kerzen.slice(0, -1) : kerzen.slice();
  if (fertig.length < s.lang + 2) return { aktion: "keine", grund: `zu wenige Tageskerzen (${fertig.length})` };
  const c = fertig.map((k) => k.c), k = T.ema(c, s.kurz), l = T.ema(c, s.lang), n = c.length - 1;
  const tag = new Date(fertig[n].t).toISOString().slice(0, 10), werte = `EMA ${s.kurz} ${k[n].toFixed(2)} / EMA ${s.lang} ${l[n].toFixed(2)}, Schluss ${c[n]} am ${tag}`;
  if (k[n - 1] <= l[n - 1] && k[n] > l[n]) return { aktion: "kauf", tag, grund: "EMA-Aufwärtskreuzung – " + werte };
  if (k[n - 1] >= l[n - 1] && k[n] < l[n]) return { aktion: "verkauf", tag, grund: "EMA-Abwärtskreuzung – " + werte };
  return { aktion: "keine", tag, grund: "keine Kreuzung – " + werte };
}
// ab 17c: ausdrückliche Bot-Zustände (gestoppt, bereit, läuft im Paper-Modus, pausiert, Not-Aus, Fehler); nur Anzeige und Steuerung im Browser –
// der Bot läuft ausschließlich in diesem Fenster (Schließen/Neuladen = gestoppt, es gibt keinen Hintergrundprozess im Worker).
const LIVE_ZUSTAENDE = { gestoppt: "Gestoppt", bereit: "Bereit – nicht gestartet", laeuft: "Läuft im Paper-Modus", pausiert: "Pausiert", notaus: "Not-Aus – gesperrt", fehler: "Fehler – gestoppt" };
function liveZustandSetzen(z, text) {
  LIVE.zustand = z;
  const el = liveEl("lp-zustand");
  if (el) { el.dataset.zustand = z; el.textContent = "Bot: " + LIVE_ZUSTAENDE[z] + (text ? " – " + text : ""); }
  liveKnoepfe(); // Knöpfe immer nach dem Zustand (vorher zeigte „Pause“ weiter „Autonom starten“ statt „Fortsetzen“)
}
// ab 17c (Paket G/H): Broker-Zustände getrennt benennen; Unbekanntes nie als Erfolg
function liveOrderStatusText(s) {
  const t = { new: "angenommen (offen)", accepted: "angenommen (offen)", pending_new: "angenommen (offen)", partially_filled: "teilweise ausgeführt", filled: "ausgeführt", canceled: "storniert", expired: "abgelaufen", rejected: "abgelehnt" }[String(s || "").toLowerCase()];
  return t || "Status unbekannt – im Alpaca-Paper-Konto prüfen, NICHT neu senden";
}
// Vorprüfung vor Start/Fortsetzen (ab 17c): Verbindung, Freigabecode, dann serverseitig über /aktien/status: Paper-Konto, Paper-Adresse,
// Betriebsart, Grenzen, Allowlist, Freigabecode im Worker, Not-Aus der Handelswache, Schutzschalter, Order-Zähler. Unbekannt → nicht starten.
// Die Prüfung von Verbindung und Code läuft ohne await, damit die Antwort auf den Klick sofort sichtbar ist.
function liveVorpruefung() {
  if (!verbunden()) { liveZustandSetzen("gestoppt", "keine Worker-Verbindung (im Cockpit verbinden)"); return Promise.resolve({ ok: false }); }
  if (liveLesen(LIVE.schluessel.code, "").length < 12) { liveStatus("Erst den Freigabecode auf diesem Tablet speichern."); liveZustandSetzen("gestoppt", "kein Freigabecode gespeichert"); return Promise.resolve({ ok: false }); }
  return (async () => {
    let st;
    try { st = await wzStatus(); } catch (e) { liveZustandSetzen("fehler", "Worker-Status nicht lesbar: " + wzFehlerText(e)); return { ok: false }; }
    const tor = liveTor(st);
    if (tor) { liveZustandSetzen(tor.some((g) => /Not-Aus/.test(g)) ? "notaus" : "gestoppt", tor.join(" · ")); return { ok: false, gruende: tor }; }
    liveZustandSetzen("bereit", "alle Voraussetzungen vom Worker bestätigt");
    return { ok: true, st };
  })();
}
async function liveZyklus({ trocken }) {
  if (LIVE.zyklus) return;
  LIVE.zyklus = true;
  try {
    if (!verbunden()) { liveProtokoll("Keine Worker-Verbindung – keine Order. Im Cockpit verbinden."); return; }
    const code = liveLesen(LIVE.schluessel.code, "");
    if (!trocken && code.length < 12) { liveProtokoll("Kein Freigabecode auf diesem Tablet gespeichert – keine Order."); return; }
    const st = await wzStatus();
    const tor = liveTor(st);
    if (tor) {
      liveProtokoll("Orders gesperrt: " + tor.join(" · ")); liveStatus("Gesperrt: " + tor[0]);
      // ab 17c: im Lauf gesperrt (z. B. Not-Aus) → Bot stoppt; er holt später nichts nach (Signale gelten nur für die letzte Tageskerze)
      if (LIVE.laeuft) { liveStoppen("Voraussetzung entfallen: " + tor[0]); liveZustandSetzen(tor.some((g) => /Not-Aus/.test(g)) ? "notaus" : "gestoppt", tor[0]); }
      return;
    }
    if (!(st.uhr && st.uhr.offen === true)) { liveProtokoll("Börse geschlossen – kein Signal geprüft."); liveStatus("Wartet: Börse geschlossen."); return; }
    const konto = await workerAnfrage("/aktien/konto", { method: "GET" });
    const symbole = wzListe(liveLesen(LIVE.schluessel.symbole, "AAPL, MSFT, KO, JPM, XOM, NVDA"), 20).filter((s) => WZ_TICKER.test(s));
    let erledigt = {}; try { erledigt = JSON.parse(liveLesen(LIVE.schluessel.erledigt, "{}")) || {}; } catch (e) { erledigt = {}; }
    for (const s of symbole) {
      // geprüfte Kerzen (gleiche Prüfung wie Analyse und Exit-Planer); älter als 5 Tage → kein Signal
      let kz; try { kz = (await wzKerzenGeprueft(s, 60, { maxAlterTage: 5 })).kerzen; } catch (e) { liveProtokoll(`${s}: Kerzen nicht verfügbar – ${wzFehlerText(e)}`); continue; }
      const sig = liveSignal(kz, st.uhr), pos = (konto.positionen || []).find((p) => p.symbol === s);
      if (sig.aktion === "keine" || (sig.aktion === "kauf" && pos) || (sig.aktion === "verkauf" && !pos)) { liveProtokoll(`${s}: kein Auftrag – ${sig.grund}${sig.aktion === "kauf" && pos ? " (Position schon vorhanden)" : sig.aktion === "verkauf" && !pos ? " (keine Position)" : ""}`); continue; }
      const schluessel = `${s}|${sig.aktion}|${sig.tag}`;
      if (!trocken && erledigt[schluessel]) { liveProtokoll(`${s}: ${sig.aktion} zu diesem Signal schon gesendet – kein zweiter Versuch (Duplikatschutz).`); continue; }
      const betrag = sig.aktion === "kauf" ? Math.min(Number(SIM.orderWert), Number(st.grenzen.maxOrderUsd)) : Math.floor(Number(pos.wert_usd) * 100) / 100;
      if (!(betrag >= 1)) { liveProtokoll(`${s}: Betrag ungültig – keine Order.`); continue; }
      const order = { symbol: s, side: sig.aktion === "kauf" ? "buy" : "sell", notional: betrag.toFixed(2), type: "market", time_in_force: "day" };
      const pr = await workerAnfrage("/aktien/pruefen", { method: "POST", body: JSON.stringify({ orders: [order] }) });
      const r = aktienErgebnisseAbgleichen([order], pr)[0];
      if (r.urteil !== "PASS") { liveProtokoll(`${s}: Risiko-Prüfung BLOCK – ${r.gruende.join("; ")} – keine Order.`); continue; }
      if (!trocken) { erledigt[schluessel] = new Date().toISOString(); liveSchreiben(LIVE.schluessel.erledigt, JSON.stringify(erledigt)); } // vor dem Senden: nie ein zweiter Versuch
      try {
        const d = await workerAnfrage("/aktien/order", { method: "POST", headers: trocken ? {} : { "x-jarvis-freigabe": code }, body: JSON.stringify({ order: r.order, fingerabdruck: r.fingerabdruck, pruefung_id: r.pruefung_id, bestaetigt: true, ...(trocken ? { trockenlauf: true } : {}) }) });
        if (trocken) liveProtokoll(`Trockenlauf ${s}: ${aktienText(order)} – alle Prüfungen ${d.ok ? "bestanden" : "NICHT bestanden"}, NICHTS gesendet (${sig.grund}).`);
        else liveProtokoll(`EXTERNE PAPER-ORDER an Alpaca gesendet: ${aktienText(order)} · Alpaca-Status ${(d.order && d.order.status) || "unbekannt"} (${liveOrderStatusText(d.order && d.order.status)}) · Kennung ${(d.order && d.order.client_order_id) || r.kennung || "?"} · Grund: ${sig.grund}`, "order");
      } catch (e) {
        liveProtokoll(`${s}: ${trocken ? "Trockenlauf" : "Order"} nicht ausgeführt – ${wzFehlerText(e)}${!trocken && e && e.netzwerk ? " – Ergebnis unklar: im Alpaca-Paper-Konto prüfen, NICHT neu senden" : ""}`, trocken ? "info" : "order");
      }
    }
    liveStatus(`${trocken ? "Trockenlauf fertig" : "Läuft (Alpaca-Paper)"} – letzter Zyklus ${new Date().toLocaleTimeString("de-DE")}.`);
  } catch (e) {
    liveProtokoll("Zyklus abgebrochen: " + wzFehlerText(e) + " – keine Order.");
    // ab 17c: Fehler im Lauf → Bot stoppt (kein Weiterlaufen mit ungeklärtem Zustand)
    if (LIVE.laeuft && !trocken) { liveStoppen("Fehler im Zyklus"); liveZustandSetzen("fehler", wzFehlerText(e)); }
  }
  finally { LIVE.zyklus = false; }
}
// Start bzw. Fortsetzen (ab 17c): erst die serverseitige Vorprüfung; nur bei ausdrücklicher Bestätigung aller Voraussetzungen läuft der Bot
function liveStarten() {
  if (LIVE.laeuft || LIVE.startet) return Promise.resolve(false);
  LIVE.startet = true;
  const fortsetzen = LIVE.zustand === "pausiert";
  return liveVorpruefung().then((v) => {
    if (!v.ok) { liveProtokoll((fortsetzen ? "Fortsetzen" : "Start") + " abgelehnt – Voraussetzungen nicht bestätigt."); return false; }
    LIVE.laeuft = true; liveKnoepfe(); liveStatus("Autonom (Alpaca-Paper) " + (fortsetzen ? "fortgesetzt" : "gestartet") + " – prüft alle 5 Minuten, solange diese Seite offen ist.");
    liveZustandSetzen("laeuft", "nur solange dieses Fenster offen ist");
    liveProtokoll("Autonome Paper-Ausführung " + (fortsetzen ? "fortgesetzt" : "gestartet") + ".");
    liveZyklus({ trocken: false });
    LIVE.uhr = setInterval(() => liveZyklus({ trocken: false }), LIVE.intervallMs);
    return true;
  }).finally(() => { LIVE.startet = false; liveKnoepfe(); });
}
function liveStoppen(grund = "von dir gestoppt") {
  clearInterval(LIVE.uhr); LIVE.uhr = null;
  if (LIVE.laeuft || LIVE.zustand === "pausiert") liveProtokoll("Autonome Paper-Ausführung gestoppt – " + grund + ".");
  LIVE.laeuft = false; liveKnoepfe(); liveStatus("Aus – " + grund + "."); liveZustandSetzen("gestoppt", grund);
}
// ab 17c: Pause hält den Zeitgeber an (keine neuen Zyklen); Fortsetzen geht über „Autonom starten“ samt neuer Vorprüfung
function livePausieren() {
  if (!LIVE.laeuft) return;
  clearInterval(LIVE.uhr); LIVE.uhr = null; LIVE.laeuft = false;
  liveProtokoll("Autonome Paper-Ausführung pausiert."); liveStatus("Pausiert – keine neuen Zyklen. Fortsetzen prüft alle Voraussetzungen erneut.");
  liveKnoepfe(); liveZustandSetzen("pausiert", "keine neuen Zyklen");
}
function liveKnoepfe() {
  if (liveEl("lp-start")) { liveEl("lp-start").disabled = LIVE.laeuft || Boolean(LIVE.startet); liveEl("lp-start").textContent = LIVE.zustand === "pausiert" ? "Fortsetzen" : "Autonom starten"; }
  if (liveEl("lp-stopp")) liveEl("lp-stopp").disabled = !LIVE.laeuft && LIVE.zustand !== "pausiert";
  if (liveEl("lp-pause")) liveEl("lp-pause").disabled = !LIVE.laeuft;
}
(function liveStart() {
  if (!liveEl("lp-start")) return;
  liveEl("lp-symbole").value = liveLesen(LIVE.schluessel.symbole, "AAPL, MSFT, KO, JPM, XOM, NVDA");
  liveEl("lp-symbole").addEventListener("change", () => liveSchreiben(LIVE.schluessel.symbole, liveEl("lp-symbole").value));
  liveEl("lp-code-speichern").addEventListener("click", () => {
    const c = String(liveEl("lp-code").value || ""); liveEl("lp-code").value = "";
    if (c.length < 12) { liveStatus("Freigabecode: mindestens 12 Zeichen – nicht gespeichert."); return; }
    liveStatus(liveSchreiben(LIVE.schluessel.code, c) ? "Freigabecode auf diesem Tablet gespeichert (nicht angezeigt)." : "Nicht gespeichert (Browserspeicher gesperrt).");
  });
  liveEl("lp-code-loeschen").addEventListener("click", () => { liveSchreiben(LIVE.schluessel.code, null); liveStoppen("Freigabecode gelöscht"); });
  liveEl("lp-trocken").addEventListener("click", () => { liveStatus("Trockenlauf läuft …"); liveZyklus({ trocken: true }); });
  liveEl("lp-start").addEventListener("click", liveStarten);
  liveEl("lp-stopp").addEventListener("click", () => liveStoppen());
  liveEl("lp-pause").addEventListener("click", livePausieren); // ab 17c
  liveEl("lp-pruefen").addEventListener("click", () => liveVorpruefung()); // ab 17c: „bereit“ nur nach Bestätigung durch den Worker
  liveZustandSetzen("gestoppt", "nach dem Laden nie automatisch gestartet");
  liveKnoepfe(); liveProtokollZeigen();
  liveStatus("Aus – nach dem Neuladen startet die autonome Ausführung nie von selbst.");
})();
;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("paper-live");
