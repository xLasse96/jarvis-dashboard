// JARVIS Dashboard – Modul „aktien-stufe1“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Aktien, Stufe 1 (Alpaca-Paper) ----------
// Aufteilen rechnet nur im Browser (aktien/budget.js, keine Order). Prüfen und Senden entscheidet der Worker:
// gesendet wird nur eine Order, die heute mit genau diesem Fingerabdruck PASS bekam, nach ausdrücklicher Freigabe je Order,
// bei ausgeschaltetem Not-Aus und offener Börse. Diese Karte ruft ausschließlich /aktien/* auf.
const AKTIEN = { grenzen: null, orders: [], eingerichtet: false };
const usdBetrag = (x) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD";
const aktienEl = (id) => document.getElementById(id);
const aktienText = (o) => (o.side === "buy" ? "KAUF " : "VERKAUF ") + usdBetrag(o.notional) + " von " + o.symbol + " · Markt-Order · gültig heute";

function aktienUhrText(uhr) {
  if (!uhr) return "Börsenuhr: unbekannt";
  const zeit = (iso) => (iso ? new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "?");
  return uhr.offen ? "US-Börse geöffnet (schließt " + zeit(uhr.naechste_schliessung) + " Ortszeit)" : "US-Börse geschlossen – nächste Öffnung " + zeit(uhr.naechste_oeffnung) + " Ortszeit";
}

// Zustand der Doppel-Order-Sperre laut Worker (/aktien/status). „erreichbar“ heißt nur: lesende Probe beantwortet –
// keine Abnahme. Der Hinweis „ein Gerät, ein Tab“ bleibt, bis die Sperre live geprüft ist (docs/DEPLOY_CHECKLISTE.md).
function aktienSperreText(s) {
  if (s.sperre === "durable-object" && s.sperre_erreichbar === true) return "Doppel-Order-Sperre: Durable Object antwortet (nur lesend geprüft). Weiterhin nur ein Gerät, ein Tab.";
  if (s.sperre === "durable-object") return "⚠ Doppel-Order-Sperre: eingerichtet, aber nicht erreichbar – der Worker sendet keine Aktien-Order.";
  if (s.sperre === "fehlt") return "⚠ Doppel-Order-Sperre fehlt im Worker (Durable Object nicht eingerichtet) – der Worker sendet keine Aktien-Order.";
  return "⚠ Der Worker meldet keine Doppel-Order-Sperre (älterer Stand) – nur ein Gerät, ein Tab.";
}

// Abgelehnte Order: Ursache getrennt benennen und den nächsten sicheren Schritt sagen (nach fehlercode des Workers, ab 2026-11-01a)
function blockadeHinweis(d) {
  const c = d && d.fehlercode;
  if (!c) return "";
  const bis = d.wieder_frei_ab ? " (frühestens ab " + new Date(d.wieder_frei_ab).toLocaleTimeString("de-DE") + ")" : "";
  const schritt = {
    notaus: "Not-Aus: Es wird nichts gesendet. Nächster sicherer Schritt: nichts tun; der Zustand steht in der Not-Aus-Karte.",
    frequenz: "Häufigkeitsgrenze (Orders): Nächster sicherer Schritt: warten" + bis + ", dann neu prüfen.",
    frequenz_ablehnungen: "Häufigkeitsgrenze (abgelehnte Versuche): Nächster sicherer Schritt: warten" + bis + " und die Ablehnungsgründe ansehen.",
    frequenz_signale: "Häufigkeitsgrenze (Prüfungen): Nächster sicherer Schritt: warten" + bis + ".",
    risiko: "Risikogrund: Nächster sicherer Schritt: Order anpassen und neu prüfen.",
    daten_veraltet: "Veraltete oder widersprüchliche Daten: Nächster sicherer Schritt: später neu prüfen.",
    konfiguration: "Fehlende Konfiguration im Worker: Nächster sicherer Schritt: Werte einrichten (Aktien-Karte, Deploy-Checkliste) – bis dahin keine Order.",
    betriebsart: "Fehlende Konfiguration (Betriebsart): bis zur Einrichtung keine Order.",
    wache_fehlt: "Handelswache fehlt im Worker: bis zur Einrichtung keine Order.",
    wache: "Handelswache nicht erreichbar: nicht erneut senden; später „Status prüfen“.",
    wache_nicht_erreichbar: "Handelswache nicht erreichbar: nichts gesendet; später neu prüfen.",
    schutzschalter: "Schutzschalter offen: keine Order, bis er ausdrücklich zurückgesetzt wird.",
    freigabecode: "Freigabecode abgelehnt: nichts gesendet.",
  }[c];
  return schritt ? "\n" + schritt : "";
}

// Blockadeursachen laut Worker (ab 2026-10-31n): Betriebsart, Freigabecode, Allowlist, Pflichtgrenzen, Schutzschalter – mit nächster Aktion.
function aktienBlockadeText(s) {
  const zeilen = [];
  if (s.betriebsart_gueltig === false) zeilen.push("⚠ Betriebsart fehlt oder ist ungültig – keine Order. Nächster Schritt: Variable BETRIEBSART (paper oder simulation) im Worker setzen.");
  else if (s.betriebsart === "simulation") zeilen.push("Betriebsart „simulation“ – keine Alpaca-Order, nur Prüfung und Trockenlauf.");
  if (s.freigabe_eingerichtet === false) zeilen.push("⚠ Freigabecode im Worker nicht eingerichtet – Senden und Aufheben des Not-Aus gesperrt. Nächster Schritt: Secret JARVIS_FREIGABECODE setzen.");
  const g = s.grenzen || {};
  if (g.erlaubteSymbole && g.erlaubteSymbole.fehler) zeilen.push("⚠ Allowlist: " + g.erlaubteSymbole.fehler + ". Nächster Schritt: Variable AKTIEN_ERLAUBTE_SYMBOLE setzen.");
  else if (g.erlaubteSymbole && Array.isArray(g.erlaubteSymbole.liste)) zeilen.push("Erlaubte Aktien: " + g.erlaubteSymbole.liste.join(", "));
  if (Array.isArray(g.konfigFehler) && g.konfigFehler.length) zeilen.push("⚠ Grenzen nicht eingerichtet: " + g.konfigFehler.join(", ") + " – jede Order wird blockiert.");
  // Handelswache und Häufigkeitsgrenzen (ab Worker 2026-11-01a)
  const w = s.wache;
  if (w && w.eingerichtet === false) zeilen.push("⚠ Handelswache nicht eingerichtet – keine Aktien-Order. Nächster Schritt: Durable Object HANDELS_WACHE im Worker einrichten (Deploy-Checkliste).");
  else if (w && w.erreichbar === false) zeilen.push("⚠ Handelswache nicht erreichbar – Not-Aus gilt als aktiv, keine Order. Nächster Schritt: später erneut laden.");
  else if (w && w.zaehler) {
    const namen = { order: "Orders", signal: "Prüfungen", ablehnung: "abgelehnte Versuche" };
    for (const [art, z] of Object.entries(w.zaehler)) {
      if (z && z.fehler) zeilen.push("⚠ Häufigkeitszähler „" + namen[art] + "“ unklar (" + z.fehler + ") – keine Order.");
      else if (z && z.im_fenster >= z.max) zeilen.push("⚠ Häufigkeitsgrenze " + namen[art] + " erreicht (" + z.im_fenster + " von " + z.max + " in " + z.fenster_s + " s) – bitte warten.");
    }
  }
  if (s.schutzschalter && s.schutzschalter.ok === false) zeilen.push("⚠ Schutzschalter nicht lesbar – keine Order.");
  else if (s.schutzschalter && s.schutzschalter.offen) zeilen.push("⚠ Schutzschalter offen (" + s.schutzschalter.fehler + " unklare Sendeversuche) – keine Order, bis er mit Freigabecode zurückgesetzt wird.");
  return zeilen.length ? "\n" + zeilen.join("\n") : "";
}

async function aktienLaden() {
  const status = aktienEl("aktien-status");
  if (!verbunden()) { status.textContent = "Bitte zuerst im Cockpit die Verbindung einrichten."; return; }
  try {
    const s = await workerAnfrage("/aktien/status", { method: "GET", zeitlimitMs: 15000 });
    AKTIEN.grenzen = s.grenzen || null;
    AKTIEN.eingerichtet = s.eingerichtet === true;
    aktienEl("aktien-sperre").textContent = aktienSperreText(s);
    if (!AKTIEN.eingerichtet) {
      status.textContent = "Alpaca-Paper ist im Worker noch nicht eingerichtet (Schlüssel fehlen). Aufteilen geht schon; Prüfen und Senden erst danach.";
      aktienEl("aktien-konto").textContent = "";
      return;
    }
    const g = s.grenzen;
    const wert = (x, einheit) => (Number.isFinite(x) ? x + einheit : "nicht eingerichtet");
    status.textContent = "Alpaca PAPER verbunden · " + (s.fehler ? "Börsenuhr nicht abrufbar: " + s.fehler : aktienUhrText(s.uhr))
      + (g ? " · Grenzen: " + g.minOrderUsd + " – " + wert(g.maxOrderUsd, " USD") + " je Order, max. " + g.maxPositionPct
        + " % je Aktie, " + g.barreservePct + " % Reserve, " + g.maxOrdersProTag + " Orders am Tag, höchstens " + wert(g.maxPositionen, "") + " offene Positionen, Tagesverlust bis " + wert(g.maxTagesverlustUsd, " USD") : "")
      + " · Stand " + new Date().toLocaleTimeString("de-DE");
    // Blockadeursachen sichtbar (ab Worker 2026-10-31n): was fehlt und was zu tun ist – Senden bleibt im Worker trotzdem gesperrt
    aktienEl("aktien-sperre").textContent = aktienSperreText(s) + aktienBlockadeText(s);
    const [konto, journal, sperren] = await Promise.allSettled([workerAnfrage("/aktien/konto", { method: "GET" }), workerAnfrage("/aktien/journal", { method: "GET" }),
      s.sperre === "durable-object" ? workerAnfrage("/aktien/sperren", { method: "GET" }) : Promise.resolve(null)]);
    aktienGesperrtZeigen(sperren.status === "fulfilled" ? sperren.value : { fehler: sperren.reason && sperren.reason.message });
    aktienEl("aktien-konto").textContent = konto.status === "fulfilled"
      ? "Paper-Konto: Bargeld " + usdBetrag(konto.value.cash) + " · Gesamtwert " + usdBetrag(konto.value.equity) + (konto.value.gesperrt ? " · bei Alpaca GESPERRT" : "")
        + (konto.value.positionen.length ? " · Positionen: " + konto.value.positionen.map((p) => p.symbol + " " + usdBetrag(p.wert_usd)).join(", ") : " · keine Positionen")
      : "Paper-Konto nicht abrufbar: " + konto.reason.message;
    if (journal.status === "fulfilled") aktienJournalZeigen(journal.value.eintraege);
  } catch (e) {
    status.textContent = e.message === "Unbekannter Endpunkt." ? "Der verbundene Worker kennt den Aktien-Teil noch nicht (älterer Stand)." : "Aktien-Status nicht abrufbar: " + e.message;
  }
}

// Dauerhafte Sperren (ungeklärte Orders) sichtbar: welche Aktie und Richtung, warum, und dass im Alpaca-Paper-Konto manuell zu prüfen ist.
// Bewusst KEIN Entsperr-Knopf. Einziger Knopf: „Status bei Alpaca prüfen (nur lesend)“ – er sendet nie und hebt die Sperre nur auf,
// wenn Alpaca die Order findet (dann „gesendet“) oder die Freigabe nachweislich nie gesendet wurde (nur reserviert).
function aktienGesperrtZeigen(d) {
  const liste = aktienEl("aktien-gesperrt");
  if (!d) { liste.hidden = true; liste.replaceChildren(); return; }
  if (!Array.isArray(d.offen)) {
    liste.hidden = false;
    liste.replaceChildren(Object.assign(document.createElement("li"), { textContent: "⚠ Gesperrte Aktien nicht abrufbar" + (d.fehler ? ": " + d.fehler : "") + " – Senden bleibt im Worker trotzdem gesperrt, solange eine Order ungeklärt ist." }));
    return;
  }
  liste.hidden = d.offen.length === 0;
  liste.replaceChildren(...d.offen.map((x) => {
    const li = document.createElement("li");
    li.dataset.sperre = x.sperre || "";
    const kopf = document.createElement("div");
    const titel = document.createElement("b");
    titel.textContent = "⛔ " + (x.side === "buy" ? "KAUF" : x.side === "sell" ? "VERKAUF" : String(x.side || "?").toUpperCase()) + " " + (x.symbol || "?") + " gesperrt";
    kopf.append(titel, document.createTextNode(" · Zustand „" + x.zustand + "“ seit " + (x.seit ? new Date(x.seit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "?")
      + (x.notional ? " · Order über " + usdBetrag(x.notional) : "")));
    const grund = Object.assign(document.createElement("p"), { className: "klein", textContent: "Warum: " + (x.grund || "Ungeklärter Zustand.") });
    const pruefung = Object.assign(document.createElement("p"), { className: "klein", textContent: "Was tun: " + (x.pruefung || "Im Alpaca-Paper-Konto unter Orders und Positionen prüfen.") + " Bis dahin keine neue Order für diese Aktie in dieser Richtung." });
    const ergebnis = Object.assign(document.createElement("p"), { className: "aktien-ergebnis" });
    ergebnis.setAttribute("role", "status");
    const knopf = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", textContent: "Status bei Alpaca prüfen (nur lesend)" });
    knopf.addEventListener("click", async () => {
      await aktienStatusPruefen({ clientOrderId: x.kennung, fingerabdruck: x.fingerabdruck }, ergebnis, knopf);
      window.aktienLaden && aktienLaden();
    });
    li.append(kopf, grund, pruefung, knopf, ergebnis);
    return li;
  }));
}

function aktienJournalZeigen(eintraege) {
  const liste = aktienEl("aktien-journal");
  liste.replaceChildren(...(eintraege && eintraege.length ? eintraege.slice(0, 10) : [null]).map((r) => {
    const li = document.createElement("li");
    li.textContent = r ? new Date(r.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + " · " + aktienText(r) + " · " + r.status
      + (r.alpaca_status ? " (Alpaca: " + r.alpaca_status + ")" : "") + (r.fehler ? " – " + r.fehler : "") : "Noch keine.";
    return li;
  }));
}

function aktienAufteilen(event) {
  if (event) event.preventDefault();
  const ausgabe = aktienEl("aktien-aufteilung");
  const { ziele, fehler } = window.AktienBudget.zieleLesen(aktienEl("aktien-ziele").value);
  // Nur gültige Zahlen weitergeben (ab Worker 2026-10-31n kann maxOrderUsd „nicht eingerichtet“ = null sein; der Worker blockiert dann ohnehin)
  const regeln = {};
  for (const k of ["barreservePct", "maxPositionPct", "minOrderUsd", "maxOrderUsd"]) if (AKTIEN.grenzen && Number.isFinite(AKTIEN.grenzen[k])) regeln[k] = AKTIEN.grenzen[k];
  // ab AJ5: Skill-Profil nur, wenn ausdrücklich gewählt (Standard bleibt der JARVIS-Rechenweg)
  const skill = aktienEl("aktien-rechenweg") && aktienEl("aktien-rechenweg").value === "skill" && typeof window.AktienBudget.aufteilenSkill === "function";
  const r = (skill ? window.AktienBudget.aufteilenSkill : window.AktienBudget.aufteilen)(Number(aktienEl("aktien-budget").value), ziele, regeln);
  aktienEl("aktien-tickets").replaceChildren();
  if (r.fehler || fehler.length) {
    AKTIEN.orders = [];
    aktienEl("aktien-pruefen").disabled = true;
    ausgabe.textContent = [...fehler, r.fehler].filter(Boolean).join(" · ");
    return;
  }
  AKTIEN.orders = r.orders;
  ausgabe.textContent = (skill ? "Skill-Profil trader-budget (5189e79) – " : "") + "Vorschlag (noch keine Order): " + r.positionen.map((p) => p.symbol + " " + usdBetrag(p.dollar) + (p.gedeckelt ? " (Deckel)" : "")).join(", ")
    + " · Reserve " + usdBetrag(r.reserve) + " · untätig " + usdBetrag(r.untaetig) + (r.hinweise.length ? "\n" + r.hinweise.join("\n") : "");
  aktienEl("aktien-pruefen").disabled = false;
}

async function aktienPruefen() {
  const knopf = aktienEl("aktien-pruefen");
  if (knopf.disabled || !AKTIEN.orders.length) return;
  knopf.disabled = true;
  const liste = aktienEl("aktien-tickets");
  liste.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Prüfe gegen das Paper-Konto …" }));
  try {
    // Allowlist schon im Dashboard (ab Worker 2026-10-31n): bekannte Liste → nicht erlaubte Symbole gar nicht erst senden, sondern als BLOCK
    // zeigen. Maßgeblich bleibt der Worker (er blockiert unabhängig davon); ist die Liste unbekannt, entscheidet nur der Worker.
    const liste_ = AKTIEN.grenzen && AKTIEN.grenzen.erlaubteSymbole && Array.isArray(AKTIEN.grenzen.erlaubteSymbole.liste) && !AKTIEN.grenzen.erlaubteSymbole.fehler ? AKTIEN.grenzen.erlaubteSymbole.liste : null;
    const erlaubt = liste_ ? AKTIEN.orders.filter((o) => liste_.includes(String(o.symbol || "").trim().toUpperCase())) : AKTIEN.orders;
    const lokal = liste_ ? AKTIEN.orders.filter((o) => !liste_.includes(String(o.symbol || "").trim().toUpperCase())) : [];
    const d = erlaubt.length ? await workerAnfrage("/aktien/pruefen", { method: "POST", body: JSON.stringify({ orders: erlaubt }) }) : { ergebnisse: [] };
    const lokaleTickets = lokal.map((o, i) => aktienTicket({ nr: erlaubt.length + i + 1, order: { ...o, symbol: String(o.symbol || "").trim().toUpperCase() }, urteil: "BLOCK", gruende: ["Allowlist (Dashboard): " + String(o.symbol || "?").toUpperCase() + " ist nicht freigegeben – nicht gesendet"] }));
    liste.replaceChildren(...d.ergebnisse.map(aktienTicket), ...lokaleTickets);
  } catch (e) {
    liste.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Prüfung nicht möglich: " + e.message }));
  } finally {
    knopf.disabled = false;
  }
}

// Eine Prüfung gilt im Dashboard 15 Minuten; danach (oder nach Neuladen/Tab-Schlaf) wird nichts mehr gesendet – neu prüfen
const AKTIEN_PRUEFUNG_GUELTIG_MS = 15 * 60000;
const AKTIEN_TAB_SPERRE = "jarvis-aktien-gesendet";
function aktienTicket(r) {
  const li = document.createElement("li");
  li.dataset.urteil = r.urteil;
  li.dataset.geprueft = String(Date.now());
  li.dataset.geprueftMono = String(performance.now()); // monotone Seitenuhr: unabhängig von einer verstellten Systemzeit
  const kopf = document.createElement("div");
  kopf.textContent = (r.urteil === "PASS" ? "✔ PASS · " : "✖ BLOCK · ") + "#" + r.nr + " " + aktienText(r.order) + " · PAPER · geprüft "
    + new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " (15 min gültig)";
  li.append(kopf);
  if (r.gruende.length) {
    const ul = document.createElement("ul");
    ul.className = "gruende";
    ul.append(...r.gruende.map((g) => Object.assign(document.createElement("li"), { textContent: g })));
    li.append(ul);
  }
  const ergebnis = Object.assign(document.createElement("p"), { className: "aktien-ergebnis" });
  ergebnis.setAttribute("role", "status");
  if (r.urteil === "PASS") {
    const knopf = Object.assign(document.createElement("button"), { type: "button", className: "knopf", textContent: "Ja, genau diese Order senden" });
    knopf.addEventListener("click", () => aktienSenden(r, knopf, ergebnis));
    li.append(knopf);
  }
  li.append(ergebnis);
  return li;
}

// Mehrere Tabs: Merker je Tag im Browserspeicher („diese Order wurde in diesem Browser heute schon gesendet/versucht“).
// Nur Bequemlichkeit für diesen Browser – maßgeblich ist die Doppel-Order-Sperre des Workers (Durable Object, ab 2026-10-31k).
function aktienTabSperreLesen() {
  const heute = new Date().toISOString().slice(0, 10);
  try {
    const roh = localStorage.getItem(AKTIEN_TAB_SPERRE);
    if (!roh) return { stand: { datum: heute, fps: {} }, hinweis: null };
    const d = JSON.parse(roh);
    if (!d || typeof d !== "object" || typeof d.fps !== "object" || Array.isArray(d.fps)) return { stand: { datum: heute, fps: {} }, hinweis: "Tab-Sperre war beschädigt und wurde neu angelegt." };
    return { stand: d.datum === heute ? d : { datum: heute, fps: {} }, hinweis: null };
  } catch (e) { return { stand: null, hinweis: "Mehrfach-Tab-Schutz nicht verfügbar (Browserspeicher gesperrt oder beschädigt) – der Worker prüft weiterhin auf Doppel-Orders." }; }
}
function aktienTabSperreSetzen(fp, setzen) {
  const { stand } = aktienTabSperreLesen();
  if (!stand) return false;
  if (setzen) stand.fps[fp] = new Date().toISOString(); else delete stand.fps[fp];
  try { localStorage.setItem(AKTIEN_TAB_SPERRE, JSON.stringify(stand)); return true; } catch (e) { return false; }
}
// Veraltet, wenn EINE der beiden Uhren mehr als 15 min zeigt, die Systemzeit zurückgestellt wurde (Zukunft) oder ein Zeitstempel fehlt.
// Maßgeblich ist zusätzlich der Worker (eigene Uhr, 15 min) – eine manipulierte Browserzeit kann ihn nicht umgehen.
function aktienTicketVeraltet(li) {
  const alterUhr = Date.now() - Number(li && li.dataset.geprueft);
  const alterMono = performance.now() - Number(li && li.dataset.geprueftMono);
  return !(alterUhr >= -60000 && alterUhr <= AKTIEN_PRUEFUNG_GUELTIG_MS && alterMono >= 0 && alterMono <= AKTIEN_PRUEFUNG_GUELTIG_MS);
}
// Alte Tickets sichtbar als veraltet markieren (nach Tab-Schlaf, alle 60 s)
function aktienTicketsAltern() {
  for (const li of document.querySelectorAll("#aktien-tickets > li[data-urteil=\"PASS\"]")) {
    const k = li.querySelector("button");
    if (k && !k.disabled && k.textContent === "Ja, genau diese Order senden" && aktienTicketVeraltet(li)) {
      k.disabled = true;
      k.textContent = "Veraltet – neu prüfen";
      li.dataset.veraltet = "ja";
    }
  }
}
async function aktienSenden(r, knopf, ergebnis) {
  if (knopf.disabled) return;
  const li = knopf.closest("li");
  if (aktienTicketVeraltet(li)) {
    knopf.disabled = true;
    knopf.textContent = "Veraltet – neu prüfen";
    ergebnis.textContent = "✖ Diese Prüfung ist älter als 15 Minuten – nichts gesendet. Bitte neu prüfen (Konto und Kurse können sich geändert haben).";
    return;
  }
  const sperre = aktienTabSperreLesen();
  if (sperre.stand && sperre.stand.fps[r.fingerabdruck]) {
    knopf.disabled = true;
    knopf.textContent = "Nicht gesendet";
    ergebnis.textContent = "✖ Diese Order wurde heute in diesem Browser (evtl. in einem anderen Tab) schon gesendet oder versucht – nichts gesendet. Bitte Journal bzw. „Status prüfen“ ansehen.";
    return;
  }
  if (!confirm("Paper-Order an Alpaca senden?\n\n" + aktienText(r.order) + "\n\nNur das Alpaca-Paper-Konto (Spielgeld), kein echtes Geld. Diese eine Order, sonst nichts.")) return;
  // Getrennte Berechtigung (ab Worker 2026-10-31n): Freigabecode je Order, nennt genau diese Order, wird nicht gespeichert
  const freigabecode = freigabecodeAbfragen("Paper-Order " + aktienText(r.order));
  if (!freigabecode) { ergebnis.textContent = "Abgebrochen – kein Freigabecode, nichts gesendet."; return; }
  knopf.disabled = true;
  const gemerkt = aktienTabSperreSetzen(r.fingerabdruck, true);
  ergebnis.textContent = "Sende an Alpaca (Paper) …" + (gemerkt ? "" : " (" + (sperre.hinweis || "Mehrfach-Tab-Schutz nicht verfügbar – der Worker prüft weiterhin auf Doppel-Orders.") + ")");
  // Kennung (client_order_id) aus der Prüfung (ab Worker 2026-10-31k: Datum + Fingerabdruck + Freigabe-Kennung). Ältere Worker
  // liefern keine – dann wie bisher Datum + Fingerabdruck. Schon jetzt festgehalten, damit „Status prüfen“ immer dieselbe Kennung fragt.
  r.clientOrderId = r.kennung || "jarvis-" + new Date().toISOString().slice(0, 10) + "-" + r.fingerabdruck;
  const statusKnopf = () => {
    if (ergebnis.nextElementSibling && ergebnis.nextElementSibling.dataset.status === "ja") return;
    const pruefen = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", textContent: "Status prüfen" });
    pruefen.dataset.status = "ja";
    pruefen.addEventListener("click", () => aktienStatusPruefen(r, ergebnis, pruefen));
    ergebnis.after(pruefen);
  };
  try {
    const d = await workerAnfrage("/aktien/order", { method: "POST", headers: { "x-jarvis-freigabe": freigabecode }, body: JSON.stringify({ order: r.order, fingerabdruck: r.fingerabdruck, pruefung_id: r.pruefung_id, bestaetigt: true }) });
    ergebnis.textContent = "✔ Gesendet (Paper) · Alpaca-Status: " + (d.order.status || "unbekannt") + (d.order.filled_qty ? " · ausgeführt " + d.order.filled_qty + " Stück zu " + usdBetrag(d.order.filled_avg_price) : "") + (d.warnung ? " · ⚠ " + d.warnung : "");
    knopf.textContent = "Gesendet";
    if (d.warnung && d.sperre_zustand && d.sperre_zustand !== "gesendet") statusKnopf();
  } catch (e) {
    const daten = e.daten || {};
    const unklar = (e.netzwerk && !e.nichtGesendet && !e.abgebrochen) || e.status === 504;
    // Reserviert, aber nicht bestätigt gesendet (Sperre meldet „noch gesperrt“) oder Freigabe schon in Arbeit: nur „Status prüfen“
    // Eine FRÜHERE Order für dasselbe Symbol ist ungeklärt (ab Worker 2026-10-31l): diese Freigabe sendet nicht; geklärt wird die frühere
    const andereUnklar = daten.grund === "order_unklar";
    const gesperrt = !andereUnklar && (daten.noch_gesperrt === true || (e.status === 409 && daten.sperre_zustand && daten.sperre_zustand !== "gesendet"));
    ergebnis.textContent = unklar
      ? "✖ Ergebnis unklar – die Paper-Order kann angekommen sein. Bitte „Status prüfen“, nicht erneut senden."
      : daten.freigabe_ueberholt || daten.grund === "kennung_verbraucht"
        ? "✖ " + e.message + " Diese Freigabe ist verbraucht – zum Senden neu prüfen."
        : "✖ " + e.message + blockadeHinweis(daten);
    if (andereUnklar) {
      knopf.textContent = "Nicht gesendet – frühere Order ungeklärt";
    } else if (unklar || gesperrt) {
      statusKnopf();
      knopf.textContent = "Nicht erneut senden";
    } else if (e.nichtGesendet || e.status === 400 || (e.status === 503 && !daten.sperre_fehlt)) {
      // eindeutig vor dem Senden gescheitert (offline, Eingabe, Alpaca/Speicher nicht erreichbar) – derselbe Knopf darf erneut;
      // eine schon verbrauchte Freigabe lehnt die Doppel-Order-Sperre im Worker ab (409)
      aktienTabSperreSetzen(r.fingerabdruck, false);
      knopf.disabled = false;
    } else {
      // abgelehnt (Prüfung, Not-Aus, Börse zu, schon gesendet, Alpaca lehnt ab, Sperre fehlt) – kein erneuter Versuch über diesen Knopf.
      // Bei 403 darf eine NEUE Prüfung später neu senden; eine echte Doppel-Order verhindert die Sperre im Worker (409).
      // Überholte/ungültige Freigabe: vor jeder Reservierung abgewiesen – die neue Prüfung derselben Order darf senden.
      if (e.status === 403 || daten.sperre_fehlt || daten.freigabe_ueberholt || daten.freigabe_ungueltig) aktienTabSperreSetzen(r.fingerabdruck, false);
      knopf.textContent = "Nicht gesendet";
    }
  } finally {
    window.aktienLaden && aktienLaden();
  }
}

// Nur lesend: fragt Alpaca nach der Kennung. Sendet nie. „Nicht gefunden“ ist KEINE Entwarnung: eine gesendete oder unklare Order
// bleibt gesperrt (manuelle Prüfung im Alpaca-Paper-Konto). „frei“ meldet der Worker nur für eine Freigabe, die nachweislich nie
// gesendet wurde (nur reserviert) – dann hebt das den Browser-Merker auf; senden geht nur nach einer NEUEN Prüfung.
async function aktienStatusPruefen(r, ergebnis, knopf) {
  knopf.disabled = true;
  try {
    const d = await workerAnfrage("/aktien/order?client_order_id=" + encodeURIComponent(r.clientOrderId), { method: "GET" });
    if (d.gefunden) {
      ergebnis.textContent = "Status bei Alpaca (Paper): " + d.status + (d.filled_qty ? " · " + d.filled_qty + " Stück zu " + usdBetrag(d.filled_avg_price) : "") + (d.warnung ? " · ⚠ " + d.warnung : "");
    } else if (d.noch_gesperrt) {
      ergebnis.textContent = "Bleibt gesperrt (unklar, nicht neu senden): " + (d.hinweis || "Bei Alpaca (noch) nicht gefunden – das beweist nicht, dass die Order nie angenommen wurde.")
        + (d.manuelle_pruefung ? " Bitte im Alpaca-Paper-Konto unter Orders und Positionen nachsehen." : "");
    } else if (d.frei) {
      aktienTabSperreSetzen(r.fingerabdruck, false);
      ergebnis.textContent = "Diese Freigabe wurde nur reserviert und nie an Alpaca gesendet (verworfen). Zum Senden die Order neu prüfen und neu freigeben.";
    } else {
      // ältere Kennung ohne Sperre oder unbekannter Zustand: keine Entwarnung
      ergebnis.textContent = "Bei Alpaca nicht gefunden – das beweist nicht, dass die Order nie angenommen wurde. Nicht neu senden; im Alpaca-Paper-Konto unter Orders und Positionen nachsehen.";
    }
  } catch (e) {
    ergebnis.textContent = "Status nicht abrufbar: " + e.message + " – nichts geändert, weiterhin gesperrt.";
  } finally {
    knopf.disabled = false;
  }
}

aktienEl("aktien-plan").addEventListener("submit", aktienAufteilen);
aktienEl("aktien-pruefen").addEventListener("click", aktienPruefen);
window.aktienLaden = aktienLaden;
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") aktienTicketsAltern(); });
setInterval(aktienTicketsAltern, 60000);

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("aktien-stufe1");
