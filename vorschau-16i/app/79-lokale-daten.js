// JARVIS Dashboard – Modul „lokale-daten“ (ab 16c, Abschlussauftrag 16.11.: alle elf Trader-Skills im lokalen Spielgeld-Modus).
// Lokale Wege ohne Worker für die Skills, deren bisheriger Weg nur über den Worker ging: Alarme mit eigenen Kursen (alerts), Nachrichten-Datei
// (news), Kongress-Datei (pelosi), Kennzahlen-Datei (screener), Rebalancing mit dem Spielgeld-Portfolio (rebalance), Budget aus dem
// Spielgeld-Bargeld (budget). Grundsätze: nichts erfinden (fehlt etwas, steht der nächste Schritt da), Herkunft jeder Auswertung sichtbar
// (eigene Eingabe, lokale Datei mit SHA-256, Ledger), Dateien geprüft (Typ, Größe, leer, beschädigt, Zeitstempel), nie eine Order.
const LOKAL = { maxBytes: 2 * 1024 * 1024, rebPlan: null, analyseR: null };
const lokalEl = (id) => document.getElementById(id);
async function lokalSha(datei) {
  try { const h = await crypto.subtle.digest("SHA-256", await datei.arrayBuffer()); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase(); } catch (e) { return null; }
}
// Datei lesen und prüfen: vorhanden, nicht leer, nicht zu groß, erlaubte Endung; Rückgabe { text, sha, name } oder { fehler }
async function lokalDateiLesen(datei, endungen, { binaer = false, max = LOKAL.maxBytes } = {}) {
  if (!datei) return { fehler: "Keine Datei gewählt." };
  const name = String(datei.name || "").slice(0, 80), endung = (name.match(/\.([a-z0-9]+)$/i) || [])[1];
  if (!endung || !endungen.includes(endung.toLowerCase())) return { fehler: `„${name}“: Dateityp nicht unterstützt (erlaubt: ${endungen.map((e) => "." + e).join(", ")}).` };
  if (!(datei.size > 0)) return { fehler: `„${name}“ ist leer.` };
  if (datei.size > max) return { fehler: `„${name}“ ist größer als ${Math.round(max / 1048576)} MB – nicht gelesen.` };
  const sha = await lokalSha(datei);
  if (binaer) return { bytes: new Uint8Array(await datei.arrayBuffer()), sha, name, endung: endung.toLowerCase() };
  return { text: (await datei.text()).replace(/^﻿/, ""), sha, name, endung: endung.toLowerCase() };
}
const lokalHerkunft = (d) => `lokale Datei „${d.name}“ (SHA-256 ${d.sha ? d.sha.slice(0, 16) + "…" : "nicht berechnet"}) – Herkunft nicht gegen die Quelle geprüft`;
// Einfache CSV mit Kopfzeile (Komma oder Semikolon, Anführungszeichen erlaubt)
function lokalCsv(text) {
  const zeilen = String(text).split(/\r?\n/).filter((z) => z.trim());
  if (zeilen.length < 2) return { fehler: "CSV braucht eine Kopfzeile und mindestens eine Datenzeile." };
  const trenner = (zeilen[0].match(/;/g) || []).length > (zeilen[0].match(/,/g) || []).length ? ";" : ",";
  const teilen = (z) => { const aus = []; let akt = "", q = false; for (const c of z) { if (c === '"') q = !q; else if (c === trenner && !q) { aus.push(akt.trim()); akt = ""; } else akt += c; } aus.push(akt.trim()); return aus; };
  const kopf = teilen(zeilen[0]).map((k) => k.toLowerCase());
  return { kopf, zeilen: zeilen.slice(1).map((z) => { const w = teilen(z); return Object.fromEntries(kopf.map((k, i) => [k, w[i] === undefined ? "" : w[i]])); }) };
}
// „SYMBOL=Kurs“ je Zeile (eigene Kurse); ungültige Zeilen werden gemeldet, nie geraten
function lokalKurseLesen(text) {
  const kurse = {}, fehler = [];
  for (const z of String(text || "").split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z.\-]{1,8})\s*=\s*([\d.]+)$/.exec(z);
    const s = m ? m[1].toUpperCase() : null, k = m ? Number(m[2]) : NaN;
    if (!m || !window.PaperKern.US_TICKER.test(s) || !(k > 0)) fehler.push(`„${z.slice(0, 20)}“ ist kein SYMBOL=Kurs`); else kurse[s] = k;
  }
  return { kurse, fehler };
}

// ---------- alerts: lokal mit eigenen Kursen ----------
function lokalAlarmePruefen() {
  const st = lokalEl("wz-al-lokal-status"), A = window.AktienAlarme;
  const { kurse, fehler } = lokalKurseLesen(lokalEl("wz-al-lokalkurse").value);
  if (fehler.length) { st.textContent = "Nicht geprüft: " + fehler.join(" · ") + ". Format: AAPL=191.20 je Zeile."; return; }
  if (!Object.keys(kurse).length) { st.textContent = "Keine eigenen Kurse eingetragen – nichts geprüft. Format: AAPL=191.20 je Zeile."; return; }
  const d = wzAlarmeLesen();
  if (d.beschaedigt) { st.textContent = d.hinweis; return; }
  if (!d.regeln.length) { st.textContent = "Keine Alarme angelegt – oben einen Alarm anlegen."; return; }
  const jetzt = Date.now(), daten = { kurse: Object.fromEntries(Object.entries(kurse).map(([s, k]) => [s, { preis: k, alter_min: 0, zeit: new Date(jetzt).toISOString(), quelle: "eigene Eingabe" }])), vortag: {}, eroeffnung: {}, uhr: null, jetzt };
  const r = A.pruefen(d.regeln, daten, d.zustand);
  d.zustand = r.zustand;
  d.protokoll = [...r.ausgeloest.map((a) => ({ zeit: new Date(jetzt).toISOString(), text: a.text + " (eigener Kurs, keine Marktdaten)" })), ...d.protokoll].slice(0, 30);
  if (wzAlarmeSchreiben(d) === false) return;
  wzAlarmeZeigen();
  st.textContent = (r.ausgeloest.length ? "Ausgelöst: " + r.ausgeloest.map((a) => a.text).join(" · ") : "Nichts ausgelöst.")
    + " Grundlage: von dir eingegebene Kurse (" + Object.entries(kurse).map(([s, k]) => `${s} ${k}`).join(", ") + "), keine Marktdaten. Ein Alarm ist eine Information, keine Order. Automatisch geprüft wird nur mit Worker-Kursen und nur bei geöffneter Seite."
    + (r.hinweise.length ? "\n" + r.hinweise.join(" · ") : "");
}

// ---------- news: Nachrichten-Datei ----------
function lokalNewsAusDaten(roh, endung) {
  let liste = [];
  if (endung === "json") {
    let j; try { j = JSON.parse(roh); } catch (e) { return { fehler: "kein gültiges JSON." }; }
    liste = Array.isArray(j) ? j : j && Array.isArray(j.news) ? j.news : j && Array.isArray(j.meldungen) ? j.meldungen : null;
    if (!liste) return { fehler: "JSON ohne Liste (erwartet: Liste oder {\"news\": [...]})." };
  } else {
    const c = lokalCsv(roh); if (c.fehler) return { fehler: c.fehler };
    liste = c.zeilen;
  }
  const feld = (o, namen) => { for (const n of namen) if (o && o[n] !== undefined && o[n] !== null && String(o[n]).trim() !== "") return o[n]; return null; };
  return { meldungen: liste.map((o, i) => {
    const zeitRoh = feld(o, ["created_at", "zeit", "time", "published", "datum"]), zeit = zeitRoh && Number.isFinite(Date.parse(zeitRoh)) ? new Date(Date.parse(zeitRoh)).toISOString() : null;
    const link = String(feld(o, ["url", "link"]) || ""), sym = feld(o, ["symbols", "symbole"]);
    return { id: String(feld(o, ["id"]) || "datei-" + i), art: "schlagzeile", zeit, zeit_roh: zeitRoh, titel: String(feld(o, ["headline", "titel", "title"]) || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
      quelle: String(feld(o, ["source", "quelle"]) || "unbekannt").slice(0, 60), link: /^https:\/\//.test(link) ? link : null,
      symbole: Array.isArray(sym) ? sym.map(String) : String(sym || "").split(/[\s,;]+/).filter(Boolean) };
  }) };
}
async function lokalNewsLesen() {
  const st = lokalEl("wz-news-lokal-status"), liste = lokalEl("wz-news-lokal-liste"), N = window.AktienNachrichten, inp = lokalEl("wz-news-datei");
  liste.replaceChildren();
  const d = await lokalDateiLesen(inp.files && inp.files[0], ["json", "csv"]);
  if (d.fehler) { st.textContent = "Nicht eingelesen: " + d.fehler + " Ohne Datei zeigt JARVIS keine Nachrichten."; return; }
  const r = lokalNewsAusDaten(d.text, d.endung);
  if (r.fehler) { st.textContent = `Nicht eingelesen („${d.name}“): ${r.fehler}`; return; }
  const jetzt = Date.now(), ohneTitel = r.meldungen.filter((m) => !m.titel).length;
  let gueltig = r.meldungen.filter((m) => m.titel);
  const zukunft = gueltig.filter((m) => m.zeit && Date.parse(m.zeit) > jetzt + 5 * 60000), ohneZeit = gueltig.filter((m) => !m.zeit);
  gueltig = gueltig.filter((m) => !zukunft.includes(m));
  // Dubletten: gleiche Kennung oder gleicher Titel bei gleicher Quelle – nur der erste bleibt
  const gesehen = new Set(), dubletten = [];
  gueltig = gueltig.filter((m) => { const k1 = "id:" + m.id, k2 = "t:" + m.quelle.toLowerCase() + "|" + m.titel.toLowerCase(); if (gesehen.has(k1) || gesehen.has(k2)) { dubletten.push(m); return false; } gesehen.add(k1); gesehen.add(k2); return true; });
  const beobachtet = Object.fromEntries(wzListe(lokalEl("wz-news-symbole").value, 10).filter((s) => WZ_TICKER.test(s)).map((s) => [s, ""]));
  let eingeordnet = N.einordnen(gueltig, beobachtet);
  const skill = lokalEl("wz-news-profil") && lokalEl("wz-news-profil").value === "skill";
  const fenster = skill ? N.fensterAnwenden(eingeordnet, { jetzt }) : { zeigen: eingeordnet, ausgeblendet: 0, stunden: null };
  const zeigen = fenster.zeigen.slice().sort((a, b) => String(b.zeit || "").localeCompare(String(a.zeit || "")));
  liste.replaceChildren(...(zeigen.length ? zeigen.slice(0, 60).map((m) => wzKnoten("li", { "data-quelle": "datei" },
    wzKnoten("div", { text: `${m.zeit ? m.zeit.slice(0, 16).replace("T", " ") + " UTC" : "Zeit unbekannt"} · ${m.quelle} · ${m.titel}` }),
    wzKnoten("div", { klasse: "klein", text: [m.betrifft && m.betrifft.length ? "betrifft " + m.betrifft.join(", ") : "", m.symbole.length ? "Symbole laut Datei: " + m.symbole.join(", ") : "", m.kennzeichen && m.kennzeichen.length ? "Kennzeichen: " + m.kennzeichen.join(", ") : ""].filter(Boolean).join(" · ") }),
    m.link ? wzLink(m.link, "Quelle öffnen") : null)) : [wzKnoten("li", { text: "Keine Meldung im gewählten Zeitfenster." })]));
  st.textContent = `Gelesen: ${r.meldungen.length} Einträge aus ${lokalHerkunft(d)}. Angezeigt ${Math.min(zeigen.length, 60)}, neueste zuerst (Veröffentlichungszeit laut Datei).`
    + (skill ? ` Skill-Profil: nur die letzten ${fenster.stunden} Stunden – ${fenster.ausgeblendet} älter ausgeblendet.` : " Alle Zeiten (JARVIS-Standard).")
    + (dubletten.length ? ` ${dubletten.length} Dublette(n) entfernt.` : "") + (zukunft.length ? ` ${zukunft.length} mit Zeit in der Zukunft verworfen (ungültig).` : "")
    + (ohneZeit.length ? ` ${ohneZeit.length} ohne lesbare Zeit (als „Zeit unbekannt“ gezeigt).` : "") + (ohneTitel ? ` ${ohneTitel} ohne Titel übersprungen.` : "")
    + " Schlagzeilen sind Hinweise, keine Fakten und keine Order.";
}

// ---------- pelosi: Kongress-Datei ----------
async function lokalKongressLesen() {
  const st = lokalEl("wz-ko-datei-status"), inp = lokalEl("wz-ko-datei"), K = window.AktienKongress, f = inp.files && inp.files[0];
  const endung = f ? (String(f.name).match(/\.([a-z0-9]+)$/i) || [])[1] : null;
  if (endung && endung.toLowerCase() === "txt") {
    const d = await lokalDateiLesen(f, ["txt"]);
    if (d.fehler) { st.textContent = "Nicht eingelesen: " + d.fehler; return; }
    lokalEl("wz-ko-art").value = "house"; if (typeof wzKoFormat === "function") wzKoFormat();
    lokalEl("wz-ko-text").value = d.text; wzBerichtLesen();
    st.textContent = `PTR-Text aus ${lokalHerkunft(d)} gelesen (Ergebnis oben). Transaktionsdatum (Geschäft) und Meldedatum (Benachrichtigung, Einreichung) stehen getrennt; Stückzahlen nur, wenn die Beschreibung sie nennt. Keine Kaufempfehlung.`;
    return;
  }
  const d = await lokalDateiLesen(f, ["zip", "xml"], { binaer: true, max: 25 * 1024 * 1024 });
  if (d.fehler) { st.textContent = "Nicht eingelesen: " + d.fehler; return; }
  let zeilen;
  const jahr = Number((d.name.match(/(20\d\d)/) || [])[1]) || Number(lokalEl("wz-ko-jahr").value) || new Date().getUTCFullYear();
  try { zeilen = K.indexLesen(await K.zipXml(d.bytes), jahr); } catch (e) { st.textContent = `Nicht eingelesen („${d.name}“): ${e.message}`; return; }
  const mitglied = String(lokalEl("wz-ko-mitglied").value || "").trim();
  const gewaehlt = K.auswaehlen(zeilen, mitglied ? { mitglieder: [mitglied] } : {});
  lokalEl("wz-ko-liste").replaceChildren(...(gewaehlt.length ? gewaehlt.slice(0, 50).map((z) => wzKnoten("li", { "data-quelle": "datei" },
    wzKnoten("div", { text: `${z.name || z.nachname} · ${z.bezirk || ""} · Meldung eingereicht ${z.eingereicht} · Art ${z.art} · Dokument ${z.doc_id}` }),
    wzKnoten("div", { klasse: "klein", text: "Transaktionsdaten stehen im einzelnen PTR – dessen Text oben einlesen. Link laut Index: " + (z.link || "keiner") }))) : [wzKnoten("li", { text: mitglied ? `Keine Meldung von „${mitglied}“ im Index.` : "Keine Meldung im Index." })]));
  st.textContent = `Jahresindex ${jahr} aus ${lokalHerkunft(d)}: ${zeilen.length} Einträge, ${gewaehlt.length} passend${mitglied ? " zu „" + mitglied + "“" : ""} (nur PTR, neueste zuerst). Meldedatum laut Index; Transaktionsdatum erst im PTR.`;
}

// ---------- screener: Kennzahlen-Datei ----------
async function lokalScreenen() {
  const st = lokalEl("wz-scr-lokal-status"), liste = lokalEl("wz-scr-lokal-liste"), S = window.AktienScreener, inp = lokalEl("wz-scr-datei");
  liste.replaceChildren();
  const d = await lokalDateiLesen(inp.files && inp.files[0], ["csv"]);
  if (d.fehler) { st.textContent = "Nicht eingelesen: " + d.fehler; return; }
  const c = lokalCsv(d.text);
  if (c.fehler) { st.textContent = `Nicht eingelesen („${d.name}“): ${c.fehler}`; return; }
  if (!c.kopf.includes("ticker")) { st.textContent = `Nicht eingelesen („${d.name}“): Spalte „ticker“ fehlt.`; return; }
  let spec;
  if (lokalEl("wz-scr-vorlage").value === "eigene") { try { spec = JSON.parse(lokalEl("wz-scr-regeln").value); } catch (e) { st.textContent = "Eigene Regeln: kein gültiges JSON."; return; } }
  else spec = S.VORLAGEN[lokalEl("wz-scr-vorlage").value];
  const fehler = S.regelnPruefen(spec);
  if (fehler) { st.textContent = "Regeln ungültig: " + fehler; return; }
  const ungueltig = c.zeilen.filter((z) => !window.PaperKern.US_TICKER.test(String(z.ticker || "").toUpperCase()));
  const firmen = c.zeilen.filter((z) => !ungueltig.includes(z)).map((z) => {
    const f = { ticker: String(z.ticker).toUpperCase() };
    for (const [k, v] of Object.entries(z)) if (k !== "ticker") f[k === "price" ? "kurs" : k] = k === "name" ? v : S.zahl(v);
    return f;
  });
  if (firmen.some((f) => f.kurs !== undefined)) S.preiseHinzufuegen(firmen, {});
  const r = S.screenen(firmen, spec);
  if (r.fehler) { st.textContent = "Nicht gescreent: " + r.fehler; return; }
  liste.replaceChildren(...(r.angezeigt || r.ergebnisse).map((e) => wzKnoten("li", { "data-symbol": e.ticker, "data-ergebnis": e.bestanden_alle ? "bestanden" : "nicht", "data-quelle": "datei" },
    wzKnoten("div", { text: `${e.bestanden_alle ? "✔ BESTANDEN" : "✖ NICHT BESTANDEN"} · ${e.ticker}${e.name ? " · " + e.name : ""}${e.punkte !== undefined && e.punkte !== null ? " · Punkte " + wzZahl(e.punkte, 3) : ""}` }),
    wzKnoten("ul", { klasse: "gruende" }, ...[...e.durchgefallen.map((x) => "✖ " + x), ...e.uebersprungen.map((x) => "– übersprungen: " + x), ...e.bestanden.map((x) => "✔ " + x)].map((x) => wzKnoten("li", { text: x }))),
    ...(e.rang_luecken && e.rang_luecken.length ? [wzKnoten("div", { klasse: "klein", text: "nicht gerankt nach: " + e.rang_luecken.join(", ") + " (Wert fehlt)" })] : []))),
    ...(r.mehr_bestanden ? [wzKnoten("li", { klasse: "klein", text: `… ${r.mehr_bestanden} weitere bestanden (Regel „top“).` })] : []));
  const stand = c.kopf.find((k) => ["as_of", "stand", "datum", "period_end"].includes(k));
  st.textContent = `${firmen.length} Firmen aus ${lokalHerkunft(d)} gescreent (${spec.name || "eigene Regeln"}): ${r.ergebnisse.filter((e) => e.bestanden_alle).length} bestanden.`
    + ` Datenstand: ${stand ? "laut Spalte „" + stand + "“" : "unbekannt (keine Datumsspalte)"}. Fehlende Werte zählen nach der Regel „missing“ (${spec.missing || "fail"}).`
    + (ungueltig.length ? ` ${ungueltig.length} Zeile(n) ohne gültigen Ticker übersprungen.` : "") + " Kein Handelssignal.";
}

// ---------- rebalance: mit dem Spielgeld-Portfolio ----------
function lokalRebKonto(kurse) {
  const p = SIM.portfolio;
  return { cash: p ? p.bargeld : SIM.startkapital, positionen: Object.entries((p && p.positionen) || {}).map(([s, x]) => ({ symbol: s, menge: x.menge, kurs: kurse[s], seite: "long" })) };
}
function lokalRebalancePlanen() {
  const aus = lokalEl("wz-reb-lokal-ergebnis"), R = window.AktienRebalance;
  LOKAL.rebPlan = null;
  const { ziele, fehler } = window.AktienBudget.zieleLesen(lokalEl("wz-reb-ziele").value);
  if (fehler.length || !ziele.length) { aus.textContent = "Zielgewichte ungültig: " + (fehler.join(" · ") || "keine angegeben (oben im Feld Zielgewichte)"); return; }
  const band = Number(lokalEl("wz-reb-band").value);
  if (!(band >= 1 && band <= 50)) { aus.textContent = "Band zwischen 1 und 50 Punkten angeben."; return; }
  const k = lokalKurseLesen(lokalEl("wz-reb-lokalkurse").value);
  if (k.fehler.length) { aus.textContent = "Kurse ungültig: " + k.fehler.join(" · "); return; }
  if (SIM.beschaedigt) { aus.textContent = "Spielgeld-Portfolio beschädigt – kein Vorschlag."; return; }
  // vorhandene Grenze der Simulation (höchstens maxOrderWert je Order) – sonst die Standardregeln des Rebalancing (unverändert)
  const r = R.planen(lokalRebKonto(k.kurse), k.kurse, ziele, { bandPct: band, verkaufeNichtZiele: lokalEl("wz-reb-nichtziele").checked, maxOrderUsd: SIM.limits.maxOrderWert });
  if (r.fehler) { aus.textContent = r.fehler + (r.ohne_kurs ? " Nächster Schritt: Kurse als SYMBOL=Kurs eintragen." : ""); return; }
  LOKAL.rebPlan = { r, kurse: k.kurse, rev: SIM.rev, erstellt: Date.now() };
  const pruefen = wzKnoten("button", { type: "button", klasse: "knopf zweit", id: "wz-reb-lokal-pruefen", text: "Im Paper-Kern prüfen (ohne Buchung)" });
  const buchen = wzKnoten("button", { type: "button", klasse: "knopf", id: "wz-reb-lokal-buchen", text: `${r.orders.length} Vorschläge im Spielgeld buchen` });
  pruefen.addEventListener("click", () => lokalRebalanceAusfuehren(false));
  buchen.addEventListener("click", () => lokalRebalanceAusfuehren(true));
  aus.replaceChildren(
    wzKnoten("div", { text: `Spielgeld-Portfolio (Ledger der Simulation): Kontowert ${usdBetrag(r.kontowert)} · Bargeld ${usdBetrag(r.bargeld)} · Barreserve ${usdBetrag(r.reserve)} · Deckel je Aktie ${usdBetrag(r.deckel)} · Band ${r.band} Punkte` }),
    wzKnoten("table", { klasse: "wz-tabelle" }, wzKnoten("tr", {}, ...["Ticker", "Wert", "Ist %", "Ziel %", "Abweichung", "Aktion"].map((x) => wzKnoten("th", { text: x }))),
      ...r.zeilen.map((z) => wzKnoten("tr", {}, ...[z.symbol, wzZahl(z.wert), wzZahl(z.ist_pct), wzZahl(z.ziel_pct), (z.abweichung > 0 ? "+" : "") + wzZahl(z.abweichung), z.aktion].map((x) => wzKnoten("td", { text: x }))))),
    r.vorschlaege.length ? wzKnoten("ul", { klasse: "wz-liste", id: "wz-reb-lokal-vorschlaege" }, ...r.vorschlaege.map((v) => wzKnoten("li", { text: aktienText(v.order) + " – " + v.warum }))) : wzKnoten("div", { text: "Nichts außerhalb des Bands – keine Vorschläge." }),
    ...r.hinweise.map((h) => wzKnoten("div", { klasse: "klein", text: h })),
    // ab 16i (REB-S12): Bargeld danach, wenn alle Vorschläge ausgeführt würden (Original „Cash after, if all of them fill: about $x“)
    r.vorschlaege.length && Number.isFinite(r.bargeld_danach) ? wzKnoten("div", { klasse: "klein", id: "wz-reb-lokal-bargeld", text: `Bargeld danach, wenn alle Vorschläge ausgeführt werden: etwa ${usdBetrag(r.bargeld_danach)}` }) : null,
    wzKnoten("div", { klasse: "klein", text: `Kurse: von dir eingegeben (${Object.entries(k.kurse).map(([s, x]) => s + " " + x).join(", ")}) – keine Marktdaten. Höchstwert je Order aus den Grenzen der Simulation (${SIM.limits.maxOrderWert} USD). ${r.hinweis}` }),
    r.orders.length ? wzKnoten("div", {}, pruefen, " ", buchen) : null,
    wzKnoten("div", { klasse: "info", id: "wz-reb-lokal-pruefung", role: "status" }));
}
// Verkäufe zuerst (machen Bargeld frei), jede Order über PaperKern.orderAusfuehren mit den Grenzen und Annahmen der Simulation.
// Buchen nur, wenn der Bot nicht läuft, der Stand unverändert ist und weder Worker- noch Simulations-Not-Aus aktiv bzw. unbekannt sperren.
function lokalRebalanceAusfuehren(buchen) {
  const z = lokalEl("wz-reb-lokal-pruefung"), plan = LOKAL.rebPlan;
  if (!plan) { z.textContent = "Erst planen."; return Promise.resolve(); }
  if (plan.rev !== SIM.rev) { z.textContent = "Der Spielgeld-Stand hat sich seit dem Plan geändert – bitte neu planen."; return Promise.resolve(); }
  const notaus = (typeof tradingZustand !== "undefined" && tradingZustand && tradingZustand.notaus === true) || SIM.limits.notaus === true || SIMAUTO.simNotaus === true;
  if (buchen && notaus) { z.textContent = "✖ Nicht gebucht: Not-Aus aktiv bzw. Worker-Not-Aus unbekannt und Simulations-Not-Aus an – unbekannt sperrt. Nächster Schritt: in der Simulationskarte den Simulations-Not-Aus bewusst ausschalten."; return Promise.resolve(); }
  if (buchen && (SIM.uhr || SIM.arbeit)) { z.textContent = "✖ Nicht gebucht: Die Paper-Automatik läuft oder speichert gerade – erst pausieren oder stoppen."; return Promise.resolve(); }
  const arbeit = SIM.portfolio ? simKlon(SIM.portfolio) : window.PaperKern.portfolioNeu({ startkapital: SIM.startkapital });
  const t = Math.floor(plan.erstellt / 60000) * 60000, orders = plan.r.orders.slice().sort((a, b) => (a.side === "sell" ? 0 : 1) - (b.side === "sell" ? 0 : 1));
  const ergebnis = orders.map((o, i) => {
    const preis = plan.kurse[o.symbol], seite = o.side === "sell" ? "verkauf" : "kauf", betrag = Number(o.notional);
    const r = window.PaperKern.orderAusfuehren(arbeit, { datensatz: "Rebalancing lokal " + new Date(plan.erstellt).toISOString(), symbol: o.symbol, seite, wertKauf: seite === "kauf" ? betrag : null, signalZeit: plan.erstellt + i,
      kerze: { t: t + i * 1000, o: preis, h: preis, l: preis, c: preis, v: 0 }, annahmen: SIM.annahmen, limits: { ...SIM.limits, notaus: buchen ? notaus : SIM.limits.notaus }, kurse: plan.kurse, verkaufMenge: seite === "verkauf" ? betrag / preis : null });
    const e = r.order ? arbeit.ledger.find((x) => x.trade_id === r.order.trade_id) : null;
    return `${seite === "kauf" ? "Kauf" : "Verkauf"} ${o.symbol} ${usdBetrag(betrag)}: ${r.doppelt ? "schon gebucht" : e && e.zustand === "gefuellt" ? `ausführbar (${e.menge} Stück zu ${e.preis}, Gebühr ${usdBetrag(e.gebuehr)})` : "abgelehnt – " + ((r.risiko && r.risiko.gruende.join("; ")) || (e && e.grund) || "unbekannt")}`;
  });
  const zeigen = (text) => { z.replaceChildren(...[text, ...ergebnis].map((x) => wzKnoten("div", { text: x }))); };
  if (!buchen) { zeigen(`Prüfung im Paper-Kern (Kopie, nichts gebucht) – Bargeld danach ${usdBetrag(arbeit.bargeld)}:`); return Promise.resolve(); }
  zeigen("Wird gebucht (Spielgeld) …");
  const notausAmCommit = () => ((tradingZustand && tradingZustand.notaus === true) || SIM.limits.notaus === true || SIMAUTO.simNotaus === true ? "NOT-AUS aktiv" : null);
  SIM.arbeit = simSchreiben(JSON.stringify(arbeit), notausAmCommit).then((s) => {
    simLedgerZeigen();
    LOKAL.rebPlan = null;
    zeigen(s.gesperrt ? "✖ Nicht gebucht: " + s.gesperrt : s.konflikt ? "✖ Nicht gebucht: Stand in einem anderen Tab geändert – neu planen." : s.fehler ? "✖ Nicht gebucht: Speichern gescheitert (" + s.fehler + ")." : `✔ Im Spielgeld gebucht (Ledger der Simulation, keine Order) – Bargeld jetzt ${usdBetrag(SIM.portfolio.bargeld)}:`);
  }, (e) => { zeigen("✖ Speichern gescheitert: " + ((e && e.message) || e)); }).finally(() => { SIM.arbeit = null; });
  return SIM.arbeit;
}

// ---------- analyst: Jahresbericht 10-K/20-F als lokale Datei (Unternehmensbeschreibung, wörtlicher Auszug) ----------
async function lokal10kLesen() {
  const aus = lokalEl("ablauf-10k-ergebnis"), inp = lokalEl("ablauf-10k-datei");
  const d = await lokalDateiLesen(inp.files && inp.files[0], ["htm", "html"], { max: 15 * 1024 * 1024 });
  if (d.fehler) { aus.textContent = "Nicht eingelesen: " + d.fehler; return; }
  const r = window.AktienSecBeschreibung.beschreibungLesen(d.text, { form: "auto" });
  if (!r.ok) { aus.textContent = `Nicht ausgewertet („${d.name}“): ${r.grund} Keine Beschreibung erfunden.`; return; }
  const a = r.angaben || {};
  aus.replaceChildren(
    wzKnoten("div", { text: `${a.name || "Firma unbekannt"}${a.ticker && a.ticker.length ? " (" + a.ticker.join(", ") + ")" : ""} · ${r.form} · Abschnitt „${r.abschnitt}“${a.cik ? " · CIK " + a.cik : ""}` }),
    wzKnoten("div", { klasse: "klein", text: `Quelle: ${lokalHerkunft(d)}. Wörtlicher Auszug${r.gekuerzt ? " (gekürzt)" : ""} – keine Bewertung, keine Empfehlung.` }),
    wzKnoten("div", { "data-teil": "10k-auszug", text: r.auszug }));
}

// ---------- analyst: Urteil „kaufen oder nicht – und warum“ (ab 16d) ----------
// Aus der bestehenden Systemeinschätzung (app/31 einschaetzungBerechnen, Kriterien G1–G4 Grundlage und B1–B4 Bewertung) – keine neue Regel.
// „Ja“ nur bei „Kaufkandidat“ (alle Kriterien erfüllt); die Analyse vergangener Daten ist keine Prognose und keine Anlageberatung.
{
  const vorher = ablaufKennzahlenZeigen;
  ablaufKennzahlenZeigen = function (r) { LOKAL.analyseR = r; return vorher(r); };
}
function lokalUrteil(r) {
  if (!r || !r.symbol || typeof einschaetzungBerechnen !== "function") return null;
  const e = einschaetzungBerechnen(r), zeichen = { "erfüllt": "✔", "nicht erfüllt": "✖", "unbekannt": "?" };
  const offen = e.kriterien.filter((k) => k.status !== "erfüllt");
  const urteil = e.kategorie === EINSCHAETZUNG.kauf ? { wort: "Ja – Kaufkandidat", klasse: "ja", warum: "alle Kriterien erfüllt (Daten echt und aktuell, Kennzahlen vollständig, keine Widersprüche, Screener bestanden, Trend aufwärts, Entry-Timer nicht blockiert, mehr dafür als dagegen). Kaufzeitpunkt bestimmt der Entry-Timer." }
    : e.kategorie === EINSCHAETZUNG.kein ? { wort: "Nein – kein Kaufkandidat", klasse: "nein", warum: "nicht erfüllt: " + offen.filter((k) => k.id[0] === "B").map((k) => `${k.name} (${k.wert})`).join("; ") }
    : { wort: "Keine belastbare Aussage", klasse: "unklar", warum: "es fehlt eine Grundlage: " + offen.map((k) => `${k.name} (${k.wert})`).join("; ") };
  return { ...urteil, kategorie: e.kategorie, kriterien: e.kriterien.map((k) => ({ ...k, zeichen: zeichen[k.status] || "?" })) };
}

// ---------- analyst: Aktienanalyse im Reiter „Analyse“ (gleicher Ablauf wie „US-Aktie analysieren“, Zusammenfassung hier) ----------
async function lokalAnalyseStarten(ev) {
  if (ev) ev.preventDefault();
  const aus = lokalEl("an-ergebnis"), sym = String(lokalEl("an-symbol").value || "").trim().toUpperCase();
  if (!sym) { aus.textContent = "Bitte ein Symbol eingeben (z. B. AAPL)."; lokalEl("an-symbol").focus(); return; }
  if (window.ABLAUF && ABLAUF.laeuft) { aus.textContent = "Eine Analyse läuft noch – bitte kurz warten."; return; }
  lokalEl("an-start").disabled = true; aus.textContent = "Analysiere …";
  try {
    ablaufEl("ablauf-symbol").value = sym; ablaufEl("ablauf-quelle").value = lokalEl("an-quelle").value; ablaufEl("ablauf-quelle").dispatchEvent(new Event("change"));
    await ablaufStarten();
    for (let i = 0; i < 400 && ABLAUF.laeuft; i++) await new Promise((ok) => setTimeout(ok, 25));
    // Kurzfassung: Quelle, Datenzeit, Grundlage und Datenzeitraum (Herkunft und Zeitraum immer sichtbar)
    const kopfZeilen = String(ablaufEl("ablauf-kopf").textContent || "").split("\n");
    const kopf = [...kopfZeilen.slice(0, 3), ...kopfZeilen.filter((z) => /^Datenzeitraum/.test(z))].join(" · ");
    const schritte = [...document.querySelectorAll("#ablauf-schritte > li")].map((li) => ({ s: li.dataset.schritt, st: li.dataset.status, t: String(li.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140) }));
    const statusWort = { ok: "ok", warnung: "Warnung", blockiert: "blockiert", nicht_verfuegbar: "nicht verfügbar" };
    const einsch = String((document.getElementById("ablauf-einschaetzung") || {}).textContent || "").replace(/\s+/g, " ").trim();
    aus.replaceChildren(
      (() => { const u = lokalUrteil(LOKAL.analyseR && LOKAL.analyseR.symbol === sym ? LOKAL.analyseR : null); if (!u) return null;
        return wzKnoten("div", { klasse: "an-urteil", "data-urteil": u.klasse, "data-teil": "an-urteil" },
          wzKnoten("div", { klasse: "an-urteil-wort", text: `Kaufen? ${u.wort}` }), wzKnoten("div", { text: "Warum: " + u.warum }),
          wzKnoten("details", { klasse: "an-details" }, wzKnoten("summary", { text: `Alle 8 Kriterien (${u.kriterien.filter((k) => k.status === "erfüllt").length} erfüllt)` }),
            wzKnoten("ul", { klasse: "gruende", "data-teil": "an-kriterien" }, ...u.kriterien.map((k) => wzKnoten("li", { "data-status": k.status, text: `${k.zeichen} ${k.id} ${k.name}: ${k.wert}` })))),
          wzKnoten("div", { klasse: "klein", text: "Analyse vergangener Daten nach festen Regeln – keine Prognose, keine Anlageberatung. Ein „Ja“ führt nie selbst eine Order aus." })); })(),      wzKnoten("div", { "data-teil": "an-kopf", text: kopf }),
      (() => { const d = schritte.find((x) => x.s === "daten" && x.st === "blockiert"); return d ? wzKnoten("div", { klasse: "wz-wichtig", "data-teil": "an-daten-fehlt", text: "Kursdaten nicht verfügbar: " + d.t }) : null; })(),
      einsch ? wzKnoten("details", { klasse: "an-details" }, wzKnoten("summary", { text: "Bericht und Unsicherheiten" }), wzKnoten("div", { "data-teil": "an-einschaetzung", text: einsch.slice(0, 2000) + (einsch.length > 2000 ? " … (vollständig unter „Details“)" : "") })) : null,
      wzKnoten("details", { klasse: "an-details" }, wzKnoten("summary", { text: `Analyseschritte (${schritte.length}: ${schritte.filter((x) => x.st === "ok").length} ok, ${schritte.filter((x) => x.st !== "ok").length} mit Warnung, Blockade oder nicht verfügbar)` }),
        wzKnoten("ul", { klasse: "gruende", "data-teil": "an-schritte" }, ...schritte.map((x) => wzKnoten("li", { "data-status": x.st, text: `${statusWort[x.st] || x.st}: ${x.t}` })))));
  } finally { lokalEl("an-start").disabled = false; }
}

// ---------- budget: Bargeld des Spielgeld-Portfolios ----------
function lokalBudgetAusSpielgeld() {
  const bar = SIM.portfolio ? SIM.portfolio.bargeld : SIM.startkapital;
  aktienEl("aktien-budget").value = String(Math.floor(bar * 100) / 100);
  aktienEl("aktien-aufteilung").textContent = `Budget = Bargeld des Spielgeld-Portfolios: ${usdBetrag(bar)} (${SIM.portfolio ? "Ledger der Simulation" : "Startkapital, noch keine Buchung"}). Jetzt Zielgewichte eintragen und „Budget aufteilen“ – nur Vorschläge, keine Order.`;
}

(function lokalStarten() {
  lokalEl("wz-al-lokal-pruefen").addEventListener("click", lokalAlarmePruefen);
  lokalEl("wz-news-datei").addEventListener("change", lokalNewsLesen);
  lokalEl("wz-ko-datei").addEventListener("change", lokalKongressLesen);
  lokalEl("wz-scr-datei").addEventListener("change", lokalScreenen);
  lokalEl("wz-reb-lokal-planen").addEventListener("click", lokalRebalancePlanen);
  lokalEl("aktien-budget-spielgeld").addEventListener("click", lokalBudgetAusSpielgeld);
  lokalEl("ablauf-10k-datei").addEventListener("change", lokal10kLesen);
  lokalEl("an-form").addEventListener("submit", lokalAnalyseStarten);
  lokalEl("an-details").addEventListener("click", () => { if (typeof fokusSetzen === "function" && document.body.classList.contains("fokus")) { /* Analysekarte ist auch in der Übersicht sichtbar */ } ansichtZeigen("trading"); const z = document.getElementById("ablauf-titel"); if (z) { if (typeof zuElementSpringen === "function") zuElementSpringen(z); else z.scrollIntoView(); } });
})();
;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("lokale-daten");
