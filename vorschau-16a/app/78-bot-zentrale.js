// JARVIS Dashboard – Modul „bot-zentrale“ (ab 15h, Nutzerwunsch 15.11.: ein automatischer Bot an einer Stelle, Dashboard übersichtlicher).
// 1) Bot-Zentrale oben im Paper-Trading: Status, Kennzahlen, Start/Pause/Sofort-Stopp, letzte Aktionen, Stand der 11 Trader-Skills.
//    Sie hat KEINE eigene Handelslogik: Start, Pause und Stopp lösen genau die Knöpfe der Simulationskarte aus (dieselben Prüfungen:
//    Startbestätigung, Datenprüfung, Not-Aus, Grenzen, Paper-Kern). Gebucht wird nur im lokalen Spielgeld-Ledger – nie eine Order.
// 2) Übersichtsmodus (Standard an): Büro-, Krypto- und Nebenkarten werden ausgeblendet (CSS body.fokus .fokus-aus), nichts gelöscht;
//    „Alles zeigen“ holt sie zurück. Die Wahl merkt sich nur dieses Gerät.
const BOT = { uhr: null, fokusSchluessel: "jarvis-fokus" };
// Stand des Abgleichs 15g (docs/ABNAHME_TRADER_SKILL_15G.md) – wird mit jedem Kandidaten aktualisiert, nicht automatisch ermittelt
const BOT_SKILLS = [
  ["analyst", "blockiert", "Aktien analysieren: läuft mit lokalen Test- und Dateidaten; echte Kurse und SEC-Zahlen erst mit dem Aktien-Worker", () => botSpringen("ablauf-titel")],
  ["alerts", "teilweise", "Preisalarme: anlegen, bearbeiten, löschen; Auswertung nur mit Worker-Kursen und offener Seite", () => botWerkzeug("alarme")],
  ["broker", "teilweise", "Paper-Buchungen über den Paper-Kern; Alpaca-Paper nur mit Worker und deiner Freigabe je Order", () => botSpringen("simkern-titel")],
  ["budget", "teilweise", "Budget aufteilen mit Begründung je Position", () => botSpringen("aktien-titel")],
  ["copycat", "teilweise", "13F-Investoren nachbilden; lokaler Datei-Import, SEC-Abruf nur mit Worker", () => botWerkzeug("copycat")],
  ["news", "blockiert", "Nachrichten nur über den Aktien-Worker (Alpaca-News)", () => botWerkzeug("nachrichten")],
  ["pelosi", "blockiert", "Kongress-Meldungen nur über den Aktien-Worker (House Clerk)", () => botWerkzeug("kongress")],
  ["rebalance", "blockiert", "Rebalancing braucht das Paper-Konto über den Aktien-Worker", () => botWerkzeug("rebalance")],
  ["risk", "teilweise", "Risiko-Grenzen und Not-Aus sperren jede Buchung; Worker-Prüfung nur mit Worker", () => botSpringen("notaus")],
  ["screener", "teilweise", "Aktien nach Regeln filtern und ranken; echte Kerzen nur über den Worker", () => botWerkzeug("screener")],
  ["tax", "bestanden", "Steuer-Information (US-Regeln) aus dem Paper-Ledger – keine deutsche Steuerberatung", () => botSpringen("steuer-titel")],
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
  botEl("zb-skills").replaceChildren(...BOT_SKILLS.map(([name, status, text, ziel]) => {
    const li = document.createElement("li"), b = document.createElement("button");
    li.dataset.status = status; b.type = "button"; b.className = "knopf-link"; b.textContent = `${name}: ${status}`; b.addEventListener("click", ziel);
    li.append(b, document.createTextNode(" – " + text)); return li;
  }));
  // Beim Laden kann die Simulation noch nicht fertig sein (Datensatz wird asynchron gelesen) – Anzeige nie abbrechen, sondern nachholen
  const sicher = () => { try { botZeigen(); } catch (e) { botEl("zb-status").textContent = "Bot-Anzeige wartet auf die Simulation …"; } };
  sicher();
  const reiter = botEl("reiter-trading"); if (reiter) reiter.addEventListener("click", () => setTimeout(sicher, 0));
  BOT.uhr = setInterval(() => { if (botAktiv()) sicher(); }, 1000);
})();
;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("bot-zentrale");
