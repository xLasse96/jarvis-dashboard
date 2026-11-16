// JARVIS Dashboard – Modul „bot-zentrale“ (ab 15h, Nutzerwunsch 15.11.: ein automatischer Bot an einer Stelle, Dashboard übersichtlicher).
// 1) Bot-Zentrale oben im Paper-Trading: Status, Kennzahlen, Start/Pause/Sofort-Stopp, letzte Aktionen, Stand der 11 Trader-Skills.
//    Sie hat KEINE eigene Handelslogik: Start, Pause und Stopp lösen genau die Knöpfe der Simulationskarte aus (dieselben Prüfungen:
//    Startbestätigung, Datenprüfung, Not-Aus, Grenzen, Paper-Kern). Gebucht wird nur im lokalen Spielgeld-Ledger – nie eine Order.
// 2) Übersichtsmodus (Standard an): Büro-, Krypto- und Nebenkarten werden ausgeblendet (CSS body.fokus .fokus-aus), nichts gelöscht;
//    „Alles zeigen“ holt sie zurück. Die Wahl merkt sich nur dieses Gerät.
const BOT = { uhr: null, fokusSchluessel: "jarvis-fokus" };
// Stand des Abgleichs 15g (docs/ABNAHME_TRADER_SKILL_15G.md) – wird mit jedem Kandidaten aktualisiert, nicht automatisch ermittelt
// ab 16c: je Skill getrennt – lokaler Weg (ohne Worker), Art des Belegs, Live-Teil (Abnahme siehe docs/ABNAHME_TRADER_SKILL_16C.md)
const BOT_SKILLS = [
  // [name, lokaler Weg, Beleg, Live-Teil, Live-Status (verfuegbar | teilweise | offen | nein), Sprungziel] – Live-Stand nach den Worker-Deploys 16.11.
  // (02f973ac, ab 16g 4623f9e4 mit Paper-Grenzen): verfügbar heißt laut Worker-Code und -Konfiguration, sobald im Cockpit mit Zugangscode verbunden – nicht mit deinem Code getestet.
  ["analyst", "Analyse mit Testdaten, eigener Kursdatei + SEC-Datei oder Worker", "Fixture; echte AAPL-10-K-Datei über die Oberfläche geprüft", "Kurse über den Worker (Alpaca IEX); SEC offen (SEC_USER_AGENT fehlt)", "teilweise", () => botSpringen("an-titel")],
  ["alerts", "Alarme anlegen, ändern, löschen; mit eigenen Kursen prüfen", "eigene Eingabe", "Kurse über den Worker (Alpaca IEX), geprüft nur bei geöffneter Seite", "verfuegbar", () => botWerkzeug("alarme")],
  ["broker", "Paper-Kern bucht im Spielgeld (Bot, Vorschlag bestätigen oder verwerfen)", "lokales Ledger", "Alpaca-PAPER-Orders autonom (Bot-Zentrale › Alpaca-Paper live) – gesperrt, bis Freigabecode im Worker und Not-Aus ausdrücklich aus; Echtgeld ausgeschlossen", "teilweise", () => botSpringen("simkern-titel")],
  ["budget", "Budget aufteilen, auch aus dem Spielgeld-Bargeld; Vorschlag als Datei", "Original-Fixture und Ledger", "nicht nötig", "nein", () => botSpringen("aktien-titel")],
  ["copycat", "13F-Dateien von sec.gov einlesen, Klassen, Stück, Wert, Quelle", "echte Berkshire-Dateien", "offen – EDGAR-Abruf braucht SEC_USER_AGENT", "offen", () => botWerkzeug("copycat")],
  ["news", "Nachrichten-Datei einlesen: Zeitfenster, Dubletten, Quelle, Zeit", "Testdatei (Fixture)", "Alpaca-News über den Worker; 8-K-Meldungen offen (SEC_USER_AGENT)", "teilweise", () => botWerkzeug("nachrichten")],
  ["pelosi", "PTR-Text oder Jahresindex des House Clerk einlesen", "Original-Prüftexte (Fixture)", "Abruf beim House Clerk über den Worker", "verfuegbar", () => botWerkzeug("kongress")],
  ["rebalance", "Spielgeld-Portfolio gegen Zielgewichte, Vorschlag über den Paper-Kern", "lokales Ledger und eigene Kurse", "Paper-Konto lesen und Risiko-Prüfung über den Worker; Übernahme als Order nur einzeln bestätigt", "teilweise", () => botWerkzeug("rebalance")],
  ["risk", "Prüfung vor jeder Paper-Buchung: Not-Aus, Bargeld, Grenzen; unbekannt sperrt", "lokales Ledger", "Risiko-Prüfung im Worker mit den JARVIS-Grenzen (1000 USD je Order, 3 Positionen, 500 USD Tagesverlust, 10 Orders/Tag)", "verfuegbar", () => botSpringen("notaus")],
  ["screener", "Kennzahlen-Datei filtern und ranken, „top“, fehlende Werte erklärt", "Original-Fixture", "Kerzen über den Worker; SEC-Kennzahlen offen", "teilweise", () => botWerkzeug("screener")],
  ["tax", "Steuer-Information (US-Regeln) aus dem Paper-Ledger – keine deutsche Steuerberatung", "lokales Ledger", "nicht nötig", "nein", () => botSpringen("steuer-titel")],
];
function botEl(id) { return document.getElementById(id); }
function botSpringen(id) { const e = botEl(id); if (!e) return; if (typeof fokusSetzen === "function" && e.closest(".fokus-aus")) fokusSetzen(false, true); if (typeof zuElementSpringen === "function") zuElementSpringen(e); else e.scrollIntoView({ block: "start" }); }
function botWerkzeug(name) { if (typeof wzZeigen === "function") wzZeigen(name); botSpringen("wz-titel"); }
const botGeld = (x) => (Number.isFinite(x) ? x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD" : "–");

function botZeigen() {
  if (typeof SIM === "undefined" || typeof SIMAUTO === "undefined") return;
  const p = SIM.portfolio, ds = SIM.datensatz, z = SIMAUTO.zustand;
  const kursart = ds && typeof simKursart === "function" ? SIM_KURSART_TEXT[simKursart(ds)] : "keine Daten gewählt";
  const zText = { aus: "Aus", laeuft: "Läuft", pausiert: "Pausiert", gestoppt: "Gestoppt", fehler: "Fehler" }[z] || z;
  botEl("zb-status").textContent = `Bot: ${zText}${SIMAUTO.grund ? " – " + String(SIMAUTO.grund).split("\n")[0] : ""} · Daten: ${ds ? ds.name : "keine"} (${kursart}) · Signale: ${simEl("sim-signalquelle") && simEl("sim-signalquelle").value === "jarvis" ? "JARVIS-Analyse (Analyse + Entry-Timer + Exit-Planer)" : "EMA-Kreuzung"}`;
  botEl("zb-status").dataset.zustand = z;
  // Kennzahlen aus dem Ledger des Paper-Kerns; offene Positionen zum letzten verarbeiteten Schlusskurs (sonst zum Einstand, so benannt)
  const L = (p && p.ledger) || [], gef = L.filter((e) => e.zustand === "gefuellt");
  const realisiert = gef.filter((e) => e.seite === "verkauf" && Number.isFinite(e.ergebnis)).reduce((s, e) => s + e.ergebnis, 0);
  const letzte = ds && ds.kerzen && SIM.pos > 0 ? ds.kerzen[Math.min(SIM.pos, ds.kerzen.length) - 1] : null;
  const pos = p ? Object.entries(p.positionen || {}) : [];
  let bewertet = true;
  const posWert = pos.reduce((s, [sym, x]) => { const kurs = letzte && ds.symbol === sym ? letzte.c : (bewertet = false, x.einstand); return s + x.menge * kurs; }, 0);
  const bar = p ? p.bargeld : SIM.startkapital;
  const zahlen = [
    ["Startkapital", botGeld(SIM.startkapital)], ["Bargeld", botGeld(bar)],
    ["Positionen", pos.length ? pos.map(([s, x]) => `${s} ${x.menge.toLocaleString("de-DE", { maximumFractionDigits: 4 })} Stk.`).join(", ") : "keine"],
    ["Gesamtwert", botGeld(bar + posWert) + (pos.length && !bewertet ? " (Positionen zum Einstand)" : "")],
    ["Ergebnis realisiert", botGeld(realisiert)], ["Buchungen", `${gef.filter((e) => e.seite === "kauf").length} Käufe, ${gef.filter((e) => e.seite === "verkauf").length} Verkäufe, ${L.filter((e) => e.zustand === "abgelehnt").length} abgelehnt`],
  ];
  botEl("zb-zahlen").replaceChildren(...zahlen.map(([k, v]) => { const d = document.createElement("div"); const a = document.createElement("span"), b = document.createElement("strong"); a.textContent = k; b.textContent = v; d.append(a, b); return d; }));
  const aktionen = SIMAUTO.protokoll.filter((x) => x.art !== "kein-signal").slice(-5).reverse();
  botEl("zb-aktionen").replaceChildren(...(aktionen.length ? aktionen.map((x) => { const li = document.createElement("li"); let t; try { t = simAutoProtokollText(x); } catch (e) { t = "Eintrag unlesbar"; } li.textContent = t.length > 220 ? t.slice(0, 217) + " …" : t; return li; }) : [Object.assign(document.createElement("li"), { textContent: "Noch keine Aktion." })]));
  // Knöpfe spiegeln die Simulationskarte (gesperrt/frei) – die Entscheidung trifft immer deren Logik
  const start = simEl("sim-start"), pause = simEl("sim-stopp"), stopp = simEl("sim-abbruch"), cb = simEl("sim-bestaetigung");
  botEl("zb-start").disabled = !start || start.disabled;
  botEl("zb-start").textContent = z === "pausiert" ? "Bot fortsetzen" : "Bot starten";
  botEl("zb-pause").disabled = !pause || pause.disabled;
  botEl("zb-stopp").disabled = !stopp || stopp.disabled;
  if (cb && botEl("zb-bestaetigung").checked !== cb.checked) botEl("zb-bestaetigung").checked = cb.checked;
}
function botAktiv() { const t = botEl("ansicht-trading"); return t && !t.hidden && document.visibilityState !== "hidden"; }

// ---------- Bot-Regeln (ab 16b): eigene Sperrliste (BRK-S15) und Duplikatregel als Option (RISK-S11) – wirken im Paper-Kern über SIM.limits ----------
const BOT_REGELN = "jarvis-bot-regeln";
function botRegelnAnwenden(r, { merken = false } = {}) {
  const gesperrt = [...new Set(String(r.gesperrt || "").toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  const falsch = gesperrt.filter((s) => !window.PaperKern.US_TICKER.test(s));
  if (falsch.length) { botEl("zb-regeln-status").textContent = `Nicht übernommen: ${falsch.join(", ")} ist kein US-Aktien-Ticker.`; return false; }
  SIM.limits = { ...SIM.limits, gesperrt, einOrderJeTag: Boolean(r.einOrderJeTag) };
  botEl("zb-sperrliste").value = gesperrt.join(", "); botEl("zb-einmal").checked = Boolean(r.einOrderJeTag);
  botEl("zb-regeln-status").textContent = `Aktiv: ${gesperrt.length ? "gesperrt " + gesperrt.join(", ") : "keine Sperrliste"} · ${r.einOrderJeTag ? "eine Order je Symbol und Seite pro Tag" : "Duplikatregel aus (Standard: derselbe Vorschlag nur einmal)"}.` + (merken ? " Gespeichert auf diesem Gerät – Startbestätigung neu setzen." : "");
  if (merken) { try { localStorage.setItem(BOT_REGELN, JSON.stringify({ gesperrt, einOrderJeTag: Boolean(r.einOrderJeTag) })); } catch (e) { botEl("zb-regeln-status").textContent += " Nicht gespeichert (Browserspeicher gesperrt) – gilt nur für diese Sitzung."; } }
  if (typeof simVorschau === "function") simVorschau();
  return true;
}
function botRegelnLaden() {
  let r = {};
  try { r = JSON.parse(localStorage.getItem(BOT_REGELN) || "{}") || {}; } catch (e) { r = {}; botEl("zb-regeln-status").textContent = "Gespeicherte Bot-Regeln beschädigt – ohne Regeln gestartet."; }
  botRegelnAnwenden({ gesperrt: Array.isArray(r.gesperrt) ? r.gesperrt.join(",") : "", einOrderJeTag: r.einOrderJeTag === true });
}

// ---------- Aktienauswahl durch den Bot (ab 16d) ----------
// Universum: die Symbole der lokalen Testdaten (synthetisch – ohne Worker gibt es keine echten Kurse für viele Aktien).
// Regel: bestehende Screener-Vorlage „Aufwärtstrend ohne Übertreibung (JARVIS)“ mit ihrer Rangfolge – keine neue Kaufregel.
// Erfüllt keine Aktie die Regeln, wählt der Bot nichts und kauft nichts (kein erzwungenes Signal). Ein- und Ausstieg bestimmt danach die
// JARVIS-Signalquelle der Paper-Automatik (Analyse + Entry-Timer + Exit-Planer) – gebucht wird nur im Spielgeld über den Paper-Kern.
async function botAuswahl() {
  const aus = botEl("zb-auswahl-ergebnis"), S = window.AktienScreener, W = window.AktienWorkflow;
  if (SIM.uhr) { aus.textContent = "Der Bot läuft – erst pausieren oder stoppen, dann neu auswählen."; return null; }
  const prov = W.testProvider({ jetzt: Date.now() }), spec = S.VORLAGEN.technisch, saetze = [], kerzenJe = {};
  for (const s of prov.symbole) {
    const kz = await prov.kerzen({ symbol: s });
    kerzenJe[s] = kz;
    saetze.push(S.datensatz(s, S.kennzahlenAusKerzen(kz, { jetzt: Date.now(), letzteLaufend: false }), {}));
  }
  const r = S.screenen(saetze, spec), bestanden = r.ergebnisse.filter((e) => e.bestanden_alle);
  const zeilen = r.ergebnisse.map((e) => `${e.bestanden_alle ? "✔" : "✖"} ${e.ticker}${e.punkte !== undefined && e.punkte !== null ? " (Punkte " + e.punkte.toLocaleString("de-DE", { maximumFractionDigits: 3 }) + ")" : ""}${e.bestanden_alle ? "" : " – " + e.durchgefallen.slice(0, 2).join("; ")}`);
  if (!bestanden.length) {
    SIM.auswahlDatensatz = null;
    aus.textContent = `Keine Aktie erfüllt „${spec.name}“ – der Bot wählt nichts und kauft nichts.\n` + zeilen.join("\n");
    return null;
  }
  const wahl = bestanden[0], kz = kerzenJe[wahl.ticker];
  SIM.auswahlDatensatz = { name: `Bot-Auswahl ${wahl.ticker}`, symbol: wahl.ticker, intervall: "1d", kalender: "boerse", synthetisch: true, quelle: "synthetische Testkurse (lokale Testdaten, kein Marktbezug)", kerzen: kz.map((k) => ({ ...k })) };
  simEl("sim-datensatz").value = "auswahl"; simEl("sim-datensatz").dispatchEvent(new Event("change"));
  // Synthetische Kurse: die JARVIS-Analyse kauft dort grundsätzlich nicht (Kriterium G1 verlangt echte Kurse) – deshalb bestimmt die
  // bestehende EMA-5/20-Regel Ein- und Ausstieg; mit echter Kursdatei bleibt die JARVIS-Signalquelle wählbar
  if (simEl("sim-signalquelle")) { simEl("sim-signalquelle").value = "ema"; simEl("sim-signalquelle").dispatchEvent(new Event("change")); }
  aus.textContent = `Bot hat ${wahl.ticker} gewählt: bester Rang unter ${bestanden.length} von ${r.ergebnisse.length} Aktien, die „${spec.name}“ erfüllen (${wahl.bestanden.join("; ")}). `
    + `Ein- und Ausstieg bestimmt der Bot selbst nach der EMA-5/20-Regel (Kauf bei Aufwärtskreuzung, Verkauf bei Abwärtskreuzung), geprüft vor jeder Buchung durch Not-Aus und Grenzen. Die JARVIS-Analyse als Signalquelle kauft nur mit echten Kursen (Kursdatei). Synthetische Testkurse – kein Marktbezug, keine Prognose. Jetzt „Einstellungen geprüft“ setzen und „Bot starten“.\n` + zeilen.join("\n");
  botZeigen();
  return wahl.ticker;
}

// ---------- Übersichtsmodus ----------
// Ausgeblendet werden nur Karten, die für den Handel nicht nötig sind (Büro, Krypto-Testnet, Musterrechnungen, Nebenansichten).
const FOKUS_KARTEN = ["heute-karte", "arbeitsplatz-karte", "aufgaben-karte", "notizen-karte", "routinen-karte", "automatik-karte", "profil-karte", "watchlist-karte", "paperbot-karte", "protokoll-karte", "aueb-karte", "modus-karte"];
const FOKUS_TITEL = ["System", "Funktionen", "Markt", "KI & Integrationen", "Fähigkeiten & Freigaben", "Smart Home", "Daten auf diesem Gerät"];
function fokusMarkieren() {
  for (const k of FOKUS_KARTEN) for (const e of document.querySelectorAll(".karte." + k)) e.classList.add("fokus-aus");
  for (const e of document.querySelectorAll("#ansicht-cockpit .karte")) {
    const t = e.querySelector(":scope > .karte-titel, :scope > summary.karte-titel");
    const name = t ? (t.firstChild && t.firstChild.textContent || "").trim() : "";
    if (FOKUS_TITEL.includes(name)) e.classList.add("fokus-aus");
  }
  for (const id of ["datei-titel"]) { const h = botEl(id), k = h && h.closest(".karte"); if (k) k.classList.add("fokus-aus"); }
  for (const e of document.querySelectorAll("#ansicht-trading .karte.krypto-teil, #pl-bereich")) e.classList.add("fokus-aus");
  // ab 16c: Krypto-Marktanalyse (BTC/ETH, nur mit Worker) im Reiter Analyse nachrangig – dort steht jetzt die Aktienanalyse
  for (const e of document.querySelectorAll("#ansicht-analyse .karte")) { const t = e.querySelector(":scope > .karte-titel"); if (t && /^Marktanalyse/.test(t.textContent.trim())) e.classList.add("fokus-aus"); }
}
function fokusSetzen(an, merken = false) {
  document.body.classList.toggle("fokus", an);
  const n = document.querySelectorAll(".fokus-aus").length;
  for (const id of ["fokus-schalter", "fokus-schalter-kopf"]) { const k = botEl(id); if (k) { k.textContent = an ? "Alles zeigen" : "Übersicht"; k.setAttribute("aria-pressed", String(an)); k.title = an ? `${n} Nebenbereiche einblenden (Büro, Krypto-Testnet, Musterrechnungen)` : "Nur die Bereiche für Analyse und Paper-Trading zeigen"; } }
  if (botEl("fokus-hinweis")) botEl("fokus-hinweis").textContent = an ? `Übersicht: ${n} Nebenbereiche ausgeblendet – nichts gelöscht.` : "Alle Bereiche sichtbar.";
  if (merken) { try { localStorage.setItem(BOT.fokusSchluessel, an ? "an" : "aus"); } catch (e) { /* nur Bequemlichkeit */ } }
}
function fokusAnwenden() {
  fokusMarkieren();
  let gemerkt = null;
  try { gemerkt = localStorage.getItem(BOT.fokusSchluessel); } catch (e) { gemerkt = null; }
  fokusSetzen(gemerkt !== "aus");
}
(function botStarten() {
  const kopf = document.querySelector("#ansicht-cockpit .weitere-leiste"); // in der Cockpit-Leiste, nicht im Kopf (der Kopf würde auf Tablets höher und verdeckte die Sprungleiste)
  if (kopf && !botEl("fokus-schalter-kopf")) { const k = document.createElement("button"); k.type = "button"; k.className = "knopf zweit fokus-kopf"; k.id = "fokus-schalter-kopf"; kopf.prepend(k, " "); }
  for (const id of ["fokus-schalter", "fokus-schalter-kopf"]) { const k = botEl(id); if (k) k.addEventListener("click", () => fokusSetzen(!document.body.classList.contains("fokus"), true)); }
  fokusAnwenden();
  botEl("zb-bestaetigung").addEventListener("change", (e) => { const cb = simEl("sim-bestaetigung"); if (!cb) return; cb.checked = e.target.checked; cb.dispatchEvent(new Event("change")); botZeigen(); });
  botEl("zb-start").addEventListener("click", () => { const k = simEl("sim-start"); if (k && !k.disabled) k.click(); botZeigen(); if (SIMAUTO.zustand !== "laeuft") botEl("zb-status").textContent += " · " + String(simEl("sim-ergebnis").textContent || "").split("\n")[0]; });
  botEl("zb-pause").addEventListener("click", () => { const k = simEl("sim-stopp"); if (k && !k.disabled) k.click(); botZeigen(); });
  botEl("zb-stopp").addEventListener("click", () => { const k = simEl("sim-abbruch"); if (k && !k.disabled) k.click(); botZeigen(); botEl("zb-start").focus(); });
  botEl("zb-einstellungen").addEventListener("click", () => botSpringen("simkern-titel"));
  botEl("zb-auswahl").addEventListener("click", () => { botAuswahl().catch((e) => { botEl("zb-auswahl-ergebnis").textContent = "Auswahl nicht möglich: " + ((e && e.message) || e); }); });
  const regelnAendern = () => botRegelnAnwenden({ gesperrt: botEl("zb-sperrliste").value, einOrderJeTag: botEl("zb-einmal").checked }, { merken: true });
  botEl("zb-sperrliste").addEventListener("change", regelnAendern); botEl("zb-einmal").addEventListener("change", regelnAendern);
  botRegelnLaden();
  botEl("zb-skills").replaceChildren(...BOT_SKILLS.map(([name, lokal, beleg, live, liveStatus, ziel]) => {
    const li = document.createElement("li"), b = document.createElement("button");
    li.dataset.status = "lokal"; li.dataset.live = liveStatus; b.type = "button"; b.className = "knopf-link"; b.textContent = `${name}: lokal nutzbar`; b.addEventListener("click", ziel);
    li.append(b, document.createTextNode(` – ${lokal} · Beleg: ${beleg} · Live: ${live}`)); return li;
  }));
  // Beim Laden kann die Simulation noch nicht fertig sein (Datensatz wird asynchron gelesen) – Anzeige nie abbrechen, sondern nachholen
  const sicher = () => { try { botZeigen(); } catch (e) { botEl("zb-status").textContent = "Bot-Anzeige wartet auf die Simulation …"; } };
  sicher();
  const reiter = botEl("reiter-trading"); if (reiter) reiter.addEventListener("click", () => setTimeout(sicher, 0));
  BOT.uhr = setInterval(() => { if (botAktiv()) sicher(); }, 1000);
})();
;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("bot-zentrale");
