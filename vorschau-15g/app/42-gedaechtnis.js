// JARVIS Dashboard – Modul „gedaechtnis“ (ab 11-09j). Gedächtnis 2.0 = das vorhandene Profil („jarvis-profil“, 15-profil-projekte.js),
// erweitert statt ersetzt:
//   - je Eintrag: Herkunft (Formular, Sprache „Merke dir“, Import), Nutzung (wie oft und wann an die KI gegangen), geprüft-am,
//     Datenschutzkennzeichnung „sensibel“ (Gesundheit, Finanzen, Kontakt, Weltanschauung …; erkannt oder selbst gesetzt)
//   - Suche, Duplikat- und Konflikterkennung, veraltete Einträge (> 180 Tage ungeprüft) mit „Noch aktuell“, Vorschau vor dem Speichern
//   - Löschliste: Gelöschtes taucht weder über einen Import noch über einen veralteten Stand aus einem anderen Tab wieder auf
//   - parallele Änderungen: Einträge, die ein anderer Tab inzwischen angelegt hat, gehen beim Speichern nicht verloren
//   - „Vergiss …“ per Sprache (nur nach Bestätigung), Speicherdiagnose, Übersicht aller Erinnerungsorte
// Speicher „jarvis-gedaechtnis“ { art, version, geloescht: [{ schluessel, titel, zeit }] } – beschädigt → gemeldet, nie überschrieben.
const GED = { schluessel: "jarvis-gedaechtnis", maxGeloescht: 200, veraltetTage: 180, quelle: null, geladenUm: 0, bekannt: new Set() };
const GED_HERKUNFT = { formular: "Formular", sprache: "Sprache („Merke dir“)", import: "Import", unbekannt: "vor 11-09j angelegt" };
const GED_SENSIBEL = /\b(gesundheit|krank\w*|diagnose|medikament\w*|therapie|arzt|ärztin|blutdruck|allergi\w*|religion|glaube|partei|gewerkschaft|sexuell\w*|iban|kontonummer|konto|gehalt|einkommen|schulden|kredit|adresse|wohne in|telefon\w*|handynummer|geburtsdatum|geboren am|ausweis|steuer-?id|versicherungsnummer)\b/i;
const gedSchluessel = (e) => [e.kategorie, String(e.projekt || "").toLowerCase(), String(e.titel || "").toLowerCase().trim()].join("|");
function gedLesen() {
  const d = speicherJsonLesen(GED.schluessel, (x) => istObjekt(x) && x.art === "jarvis-gedaechtnis" && Array.isArray(x.geloescht));
  return { geloescht: d ? d.geloescht.filter((g) => g && typeof g.schluessel === "string") : [] };
}
function gedSchreiben(s) {
  if (speicherBeschaedigt(GED.schluessel)) return false;
  try { localStorage.setItem(GED.schluessel, JSON.stringify({ art: "jarvis-gedaechtnis", version: 1, geloescht: s.geloescht.slice(-GED.maxGeloescht) })); return true; } catch (e) { return false; }
}
function gedGeloeschtMerken(eintraege) {
  const s = gedLesen(), jetzt = new Date().toISOString();
  for (const e of eintraege) { const k = gedSchluessel(e); s.geloescht = s.geloescht.filter((g) => g.schluessel !== k); s.geloescht.push({ schluessel: k, titel: String(e.titel).slice(0, 80), zeit: jetzt }); }
  return gedSchreiben(s);
}
function gedGeloeschtFinden(e) { return gedLesen().geloescht.find((g) => g.schluessel === gedSchluessel(e)) || null; }
function gedGeloeschtFreigeben(e) { const s = gedLesen(), k = gedSchluessel(e); if (!s.geloescht.some((g) => g.schluessel === k)) return true; s.geloescht = s.geloescht.filter((g) => g.schluessel !== k); return gedSchreiben(s); }
// ---------- Felder ergänzen (Prüfung bleibt die vorhandene; zusätzliche Felder nur geprüft übernommen) ----------
if (typeof profilEintragPruefen === "function") {
  const original = profilEintragPruefen;
  profilEintragPruefen = function (roh) {
    const r = original(roh);
    if (!r.eintrag) return r;
    const zeit = (z) => (typeof z === "string" && !isNaN(Date.parse(z)) ? new Date(z).toISOString() : null);
    Object.assign(r.eintrag, {
      herkunft: GED_HERKUNFT[roh.herkunft] ? roh.herkunft : "unbekannt",
      genutzt: Number.isInteger(roh.genutzt) && roh.genutzt >= 0 && roh.genutzt < 1e6 ? roh.genutzt : 0,
      zuletztGenutzt: zeit(roh.zuletztGenutzt),
      geprueft: zeit(roh.geprueft),
      // ausdrücklich gesetzt (true/false) gilt; sonst erkannt
      sensibel: roh.sensibel === true || (roh.sensibel !== false && GED_SENSIBEL.test(r.eintrag.titel + " " + r.eintrag.text)),
      sensibelGesetzt: typeof roh.sensibel === "boolean" && roh.sensibelGesetzt === true ? true : undefined,
    });
    return r;
  };
}
// Herkunft beim Anlegen, Erhalt der Zusatzfelder beim Bearbeiten, ausdrückliches Neuanlegen hebt den Löschvermerk auf
if (typeof profilEintragSpeichern === "function") {
  const original = profilEintragSpeichern;
  profilEintragSpeichern = function (daten, id) {
    const alt = id ? profil.find((e) => e.id === id) : null;
    const zusatz = alt ? { herkunft: alt.herkunft, genutzt: alt.genutzt, zuletztGenutzt: alt.zuletztGenutzt, geprueft: new Date().toISOString(), ...(alt.sensibelGesetzt ? { sensibel: alt.sensibel, sensibelGesetzt: true } : {}) }
      : { herkunft: daten.herkunft || GED.quelle || "formular" };
    const r = original({ ...zusatz, ...daten, herkunft: zusatz.herkunft }, id);
    if (r.eintrag) gedGeloeschtFreigeben(r.eintrag);
    return r;
  };
}
// „Merke dir …“: Herkunft Sprache
(function gedMerkenHerkunft() {
  const s = typeof SKILLS !== "undefined" && SKILLS.find((x) => x.name === "profil-merken");
  if (!s) return;
  const planen = s.planen;
  s.planen = async (text) => {
    const p = await planen(text);
    if (!p || !p.ausfuehren) return p;
    const aus = p.ausfuehren;
    return { ...p, ausfuehren: async () => { GED.quelle = "sprache"; try { return await aus(); } finally { GED.quelle = null; } } };
  };
})();
// Nutzung zählen: nur Einträge, die tatsächlich in den Kontext der Anfrage gingen
if (typeof profilFuerAnfrage === "function") {
  const original = profilFuerAnfrage;
  profilFuerAnfrage = function () {
    const gewaehlt = profil.filter((e) => profilAuswahl.has(e.id));
    const r = original();
    if (r) {
      const jetzt = new Date().toISOString();
      for (const e of gewaehlt) if (r.titel.includes(profilBezeichnung(e))) { e.genutzt = (e.genutzt || 0) + 1; e.zuletztGenutzt = jetzt; }
      profilSpeichern();
      profilAnzeigen();
    }
    return r;
  };
}
// Löschen merken (Einzel- und Gesamtlöschung)
if (typeof profilLoeschen === "function") {
  const original = profilLoeschen;
  profilLoeschen = function (id) { const e = profil.find((x) => x.id === id); const ok = original(id); if (ok && e) gedGeloeschtMerken([e]); gedAnzeigen(); return ok; };
}
if (typeof profilAllesLoeschen === "function") {
  const original = profilAllesLoeschen;
  profilAllesLoeschen = function () { const alle = profil.slice(); const ok = original(); if (ok) gedGeloeschtMerken(alle); gedAnzeigen(); return ok; };
}
// Laden: Gelöschtes aus veralteten Ständen (anderer Tab, Wiederherstellung) nicht wieder anzeigen
if (typeof profilLaden === "function") {
  const original = profilLaden;
  profilLaden = function () {
    original();
    const vorher = profil.length;
    profil = profil.filter((e) => !gedGeloeschtFinden(e));
    if (profil.length !== vorher) { GED.ausgeblendet = vorher - profil.length; profilAuswahlZuruecksetzen(); profilAnzeigen(); }
    GED.geladenUm = Date.now();
    GED.bekannt = new Set(profil.map((e) => e.id));
  };
}
// Speichern: Einträge, die ein anderer Tab seit dem Laden angelegt hat (Kennung hier nie gesehen), übernehmen statt zu überschreiben.
// Was dieser Tab kennt und nicht mehr hat, wurde hier gelöscht – das bleibt weg.
if (typeof profilSpeichern === "function") {
  const original = profilSpeichern;
  profilSpeichern = function () {
    if (!speicherBeschaedigt(PROFIL.schluessel)) {
      const d = speicherJsonLesen(PROFIL.schluessel, (x) => istObjekt(x) && Array.isArray(x.eintraege));
      for (const roh of (d ? d.eintraege : [])) {
        if (!roh || GED.bekannt.has(roh.id) || profil.some((e) => e.id === roh.id) || Date.parse(roh.erstellt) < GED.geladenUm) continue;
        const p = profilEintragPruefen(roh);
        if (p.eintrag && !gedGeloeschtFinden(p.eintrag) && !profil.some((e) => profilGleich(e, p.eintrag)) && profil.length < PROFIL.maxEintraege) profil.push(p.eintrag);
      }
    }
    for (const e of profil) GED.bekannt.add(e.id);
    return original();
  };
}
// Import: Herkunft „Import“. Ein Import ist eine ausdrückliche Entscheidung (mit Vorschau) – früher Gelöschtes wird dabei sichtbar
// genannt und nur dann wieder übernommen (Rückweg nach „Alles löschen“ bleibt); der Löschvermerk fällt erst beim tatsächlichen Import weg.
if (typeof profilImportPruefen === "function") {
  const original = profilImportPruefen;
  profilImportPruefen = function (text) {
    const r = original(text);
    if (r.fehler) return r;
    r.wiederGeloescht = [];
    for (const e of r.uebernehmen) {
      e.herkunft = "import";
      const g = gedGeloeschtFinden(e);
      if (g) r.wiederGeloescht.push(`${e.titel.slice(0, 40)} (am ${new Date(g.zeit).toLocaleDateString("de-DE")} gelöscht)`);
    }
    return r;
  };
}
if (typeof profilImportieren === "function") {
  const original = profilImportieren;
  profilImportieren = function (text) {
    const vorschau = profilImportPruefen(text);
    const r = original(text);
    GED.wieder = !r.fehler && vorschau.wiederGeloescht ? vorschau.wiederGeloescht : [];
    if (!r.fehler) for (const e of profil) gedGeloeschtFreigeben(e);
    for (const e of profil) GED.bekannt.add(e.id);
    gedAnzeigen();
    return r;
  };
}
// Gedächtnisexport: wie der Profil-Export (der unverändert bleibt), zusätzlich mit Herkunft, Nutzung, Prüfdatum, Kennzeichnung –
// über denselben Import einlesbar (Herkunft wird dabei „Import“, die übrigen Felder werden geprüft übernommen)
function gedExportText() {
  const d = JSON.parse(profilExportText());
  d.eintraege = d.eintraege.map((x) => { const e = profil.find((y) => y.id === x.id); return e ? { ...x, herkunft: e.herkunft, genutzt: e.genutzt, zuletztGenutzt: e.zuletztGenutzt, geprueft: e.geprueft, sensibel: e.sensibel, sensibelGesetzt: e.sensibelGesetzt } : x; });
  return JSON.stringify(d, null, 2);
}
// ---------- Prüfungen ----------
const gedNorm = (t) => String(t || "").toLowerCase().replace(/[^a-zäöüß0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const GED_GEGENSATZ = [["kurz", "ausführlich"], ["kurz", "lang"], ["mag ", "mag keine"], ["mag ", "mag nicht"], ["immer", "nie"], ["gerne", "ungern"], ["morgens", "abends"], ["du ", "sie "], ["ja", "nein"]];
// Konflikt: gleiches Thema (gleiches Stichwort oder ≥ 2 gemeinsame Inhaltswörter) und gegensätzliche Aussage
function gedKonflikt(a, b) {
  if (a.id === b.id || a.kategorie === "projekt" !== (b.kategorie === "projekt") || (a.kategorie === "projekt" && gedNorm(a.projekt) !== gedNorm(b.projekt))) return null;
  const ta = gedNorm(a.titel + " " + a.text), tb = gedNorm(b.titel + " " + b.text);
  const wa = new Set(ta.split(" ").filter((w) => w.length >= 5)), gemeinsam = tb.split(" ").filter((w) => w.length >= 5 && wa.has(w));
  // gleicher Bereich: ein gemeinsames Inhaltswort genügt als gleiches Thema, sonst zwei
  if (gedNorm(a.titel) !== gedNorm(b.titel) && new Set(gemeinsam).size < (a.kategorie === b.kategorie ? 1 : 2)) return null;
  for (const [x, y] of GED_GEGENSATZ) if ((ta.includes(x) && !ta.includes(y) && tb.includes(y)) || (ta.includes(y) && tb.includes(x) && !tb.includes(y))) return `„${a.titel}“ und „${b.titel}“ widersprechen sich (${x.trim()} ↔ ${y.trim()})`;
  return null;
}
function gedDuplikat(a, b) { return a.id !== b.id && gedNorm(a.text) === gedNorm(b.text) && gedNorm(a.text).length > 0; }
function gedPruefen(e, jetzt = Date.now()) {
  const hinweise = [];
  const dup = profil.find((x) => gedDuplikat(e, x));
  if (dup) hinweise.push(`gleicher Inhalt wie „${dup.titel}“`);
  for (const x of profil) { const k = gedKonflikt(e, x); if (k) { hinweise.push(k); break; } }
  if (e.sensibel) hinweise.push("sensibel – nur bewusst für eine Anfrage auswählen");
  const stand = Date.parse(e.geprueft || e.geaendert || e.erstellt);
  if (e.id && jetzt - stand > GED.veraltetTage * 86400000) hinweise.push(`seit über ${GED.veraltetTage} Tagen nicht geprüft`);
  return hinweise;
}
function gedNochAktuell(id) {
  const e = profil.find((x) => x.id === id);
  if (!e || speicherBeschaedigt(PROFIL.schluessel)) return false;
  e.geprueft = new Date().toISOString();
  const ok = profilSpeichern(); profilAnzeigen(); return ok;
}
function gedSensibelSetzen(id, an) {
  const e = profil.find((x) => x.id === id);
  if (!e || speicherBeschaedigt(PROFIL.schluessel)) return false;
  e.sensibel = Boolean(an); e.sensibelGesetzt = true;
  const ok = profilSpeichern(); profilAnzeigen(); return ok;
}
function gedSuchen(frage) {
  const w = gedNorm(frage).split(" ").filter(Boolean);
  return w.length ? profil.filter((e) => { const t = gedNorm([e.titel, e.text, e.projekt, PROFIL_KATEGORIEN[e.kategorie]].join(" ")); return w.every((x) => t.includes(x)); }) : profil.slice();
}
function gedDiagnose(jetzt = Date.now()) {
  let zeichen = 0;
  try { zeichen = (localStorage.getItem(PROFIL.schluessel) || "").length; } catch (e) { /* gesperrt */ }
  const konflikte = [];
  for (let i = 0; i < profil.length; i++) for (let j = i + 1; j < profil.length; j++) { const k = gedKonflikt(profil[i], profil[j]); if (k) konflikte.push(k); }
  return { eintraege: profil.length, max: PROFIL.maxEintraege, zeichen, beschaedigt: speicherBeschaedigt(PROFIL.schluessel), speicherOk: profilSpeicherOk, geloescht: gedLesen().geloescht.length,
    sensibel: profil.filter((e) => e.sensibel).length, veraltet: profil.filter((e) => jetzt - Date.parse(e.geprueft || e.geaendert || e.erstellt) > GED.veraltetTage * 86400000).length,
    duplikate: profil.filter((e) => profil.some((x) => gedDuplikat(e, x))).length, konflikte, genutzt: profil.reduce((n, e) => n + (e.genutzt || 0), 0) };
}
// ---------- Anzeige: Zusatzinfo je Eintrag, Suche, Diagnose ----------
function gedEintragInfo(e) {
  const datum = (z) => new Date(z).toLocaleDateString("de-DE");
  return `Herkunft: ${GED_HERKUNFT[e.herkunft] || GED_HERKUNFT.unbekannt} · an die KI: ${e.genutzt ? e.genutzt + "×, zuletzt " + datum(e.zuletztGenutzt) : "noch nie"}` + (e.geprueft ? ` · geprüft ${datum(e.geprueft)}` : "") + (e.sensibel ? " · 🔒 sensibel" : "");
}
if (typeof profilAnzeigen === "function") {
  const original = profilAnzeigen;
  profilAnzeigen = function () {
    original();
    const suche = document.getElementById("ged-suche"), treffer = suche && suche.value.trim() ? new Set(gedSuchen(suche.value).map((e) => e.id)) : null;
    for (const li of document.querySelectorAll("#profil-liste li[data-id]")) {
      const e = profil.find((x) => x.id === li.dataset.id);
      if (!e) continue;
      li.hidden = Boolean(treffer && !treffer.has(e.id));
      const info = Object.assign(document.createElement("span"), { className: "aufgabe-faellig ged-info", textContent: gedEintragInfo(e) });
      const h = gedPruefen(e);
      if (h.length) info.append(Object.assign(document.createElement("span"), { className: "wz-wichtig", textContent: " ⚠ " + h.join(" · ") }));
      li.append(info);
      if (h.some((x) => x.includes("nicht geprüft"))) { const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: "Noch aktuell" }); b.setAttribute("aria-label", "Noch aktuell: " + e.titel); b.addEventListener("click", () => gedNochAktuell(e.id)); li.append(b); }
      const s = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: e.sensibel ? "nicht sensibel" : "sensibel" });
      s.setAttribute("aria-label", (e.sensibel ? "Als nicht sensibel markieren: " : "Als sensibel markieren: ") + e.titel);
      s.addEventListener("click", () => gedSensibelSetzen(e.id, !e.sensibel));
      li.append(s);
    }
    gedAnzeigen();
  };
}
// Vorschau im Formular: so geht der Eintrag an die KI, plus Hinweise (vor dem Speichern)
function gedVorschau() {
  const el = (id) => document.getElementById(id), box = el("ged-vorschau");
  if (!box || el("profil-form").hidden) return "";
  const roh = { kategorie: el("profil-kategorie").value, projekt: el("profil-projekt").value, titel: el("profil-eintrag-titel").value, text: el("profil-text").value };
  const p = profilEintragPruefen(roh);
  if (p.fehler) { box.textContent = "Vorschau: " + p.fehler + "."; return box.textContent; }
  p.eintrag.id = profilBearbeitet || "";
  const h = gedPruefen(p.eintrag).filter((x) => !(profilBearbeitet && x.includes(`„${p.eintrag.titel}“ und „${p.eintrag.titel}“`)));
  box.textContent = "Vorschau – so geht der Eintrag an die KI, wenn du ihn für eine Anfrage auswählst: „• " + profilBezeichnung(p.eintrag) + ": " + p.eintrag.text + "“" + (h.length ? " ⚠ " + h.join(" · ") : "");
  return box.textContent;
}
function gedAnzeigen() {
  const box = document.getElementById("ged-diagnose");
  if (!box) return;
  const d = gedDiagnose();
  const zeilen = [`${d.eintraege} von ${d.max} Einträgen · ${d.zeichen.toLocaleString("de-DE")} Zeichen im Browser · zusammen ${d.genutzt}× an die KI gegangen (nur ausgewählte, je Anfrage)`,
    `${d.sensibel} sensibel · ${d.veraltet} ungeprüft seit über ${GED.veraltetTage} Tagen · ${d.duplikate} mit gleichem Inhalt · ${d.konflikte.length} Widerspruch/Widersprüche · ${d.geloescht} auf der Löschliste`];
  if (d.beschaedigt) zeilen.unshift("⚠ Profil beschädigt – " + SPEICHER_SCHADEN_TEXT);
  else if (!d.speicherOk) zeilen.unshift("⚠ Browserspeicher gesperrt – Änderungen gelten nur bis zum Neuladen.");
  if (GED.ausgeblendet) zeilen.push(`${GED.ausgeblendet} gelöschte(r) Eintrag/Einträge aus einem älteren Stand ausgeblendet.`);
  if (GED.wieder && GED.wieder.length) zeilen.push("Durch deinen Import wieder übernommen (war gelöscht): " + GED.wieder.join(", "));
  box.replaceChildren(...zeilen.map((z) => Object.assign(document.createElement("li"), { textContent: z })), ...d.konflikte.slice(0, 5).map((k) => Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: "⚠ " + k })));
  const orte = document.getElementById("ged-orte");
  if (orte) orte.textContent = "JARVIS merkt sich nur, was du ausdrücklich speicherst: Profil (hier), Antwortstil (Gespräch), Aufgaben, Notizen, Projekte, Dateiliste (nur Metadaten), Routinen, Automatisierungen. Gesprächsverlauf nur, wenn „Auf diesem Gerät speichern“ an ist. Nichts davon geht ohne Auswahl an die KI.";
}
// „Vergiss …“ – nur nach Bestätigung, über das vorhandene Löschen (mit Löschvermerk)
skillRegistrieren({
  name: "profil-vergessen",
  risiko: "bestaetigen",
  hilfeKurz: "Vergiss",
  beschreibung: "Einen Profileintrag vergessen (löschen, nur nach Bestätigung)",
  beispiele: ["Vergiss, dass ich kurze Antworten mag"],
  passt: (text) => /^(vergiss|vergesse|lösche aus dem profil|loesche aus dem profil)( bitte)?( dass| das)? \S.+/.test(befehlNormalisieren(text)) && !/^(vergiss|vergesse) (es|das)$/.test(befehlNormalisieren(text)),
  planen: async (text) => {
    const w = befehlNormalisieren(text).replace(/^(vergiss|vergesse|lösche aus dem profil|loesche aus dem profil)( bitte)?( dass| das)?\s*/, "").replace(/^alles (über|ueber|zu|von)\s+/, "").replace(/^(ich|mein|meine)\s+/, ""); // 13e: „Vergiss alles über X“
    const treffer = gedSuchen(w);
    if (!treffer.length) return { fehler: `Im Profil finde ich nichts zu „${w}“.` };
    if (treffer.length > 1) return { fehler: `Mehrere Einträge passen (${treffer.slice(0, 4).map((e) => "„" + e.titel + "“").join(", ")}) – bitte genauer.` };
    const e = treffer[0];
    return { beschreibung: `Profileintrag „${profilBezeichnung(e)}: ${e.text}“ wird gelöscht und kommt auch über einen Import nicht zurück.`,
      ausfuehren: async () => { profil = profil.filter((x) => x.id !== e.id); profilAuswahl.delete(e.id); profilSpeichern(); gedGeloeschtMerken([e]); profilAnzeigen(); return `Vergessen: „${e.titel}“.`; } };
  },
});
(function gedEinordnen() {
  const s = SKILLS.pop(), nav = SKILLS.findIndex((x) => x.name === "navigation");
  SKILLS.splice(nav < 0 ? SKILLS.length : nav, 0, s);
})();
(function gedEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("ged-details")) return;
  el("ged-suche").addEventListener("input", () => profilAnzeigen());
  for (const id of ["profil-kategorie", "profil-projekt", "profil-eintrag-titel", "profil-text"]) el(id).addEventListener("input", gedVorschau);
  el("profil-kategorie").addEventListener("change", gedVorschau);
  el("profil-neu").addEventListener("click", () => setTimeout(gedVorschau, 0));
  el("ged-loeschliste").addEventListener("click", () => {
    const n = gedLesen().geloescht.length;
    if (!n || !confirm(`Löschliste leeren (${n} Einträge)?\nDanach können gelöschte Profileinträge über einen Import oder eine ältere Sicherung wieder übernommen werden.`)) return;
    el("profil-meldung").textContent = gedSchreiben({ geloescht: [] }) ? "Löschliste geleert." : "Nicht geleert: " + SPEICHER_SCHADEN_TEXT;
    gedAnzeigen();
  });
  // window.profilIntern hält Verweise aus 15-profil-projekte.js – auf die erweiterten Fassungen umstellen
  if (window.profilIntern) Object.assign(window.profilIntern, { laden: profilLaden, speichern: profilEintragSpeichern, loeschen: profilLoeschen, allesLoeschen: profilAllesLoeschen, fuerAnfrage: profilFuerAnfrage, importPruefen: profilImportPruefen, importieren: profilImportieren });
  el("ged-export").addEventListener("click", () => {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([gedExportText()], { type: "application/json" })), download: "jarvis-gedaechtnis-" + new Date().toISOString().slice(0, 10) + ".json" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    el("profil-meldung").textContent = "Gedächtnis mit Herkunft und Nutzung exportiert (Import über „Importieren“).";
  });
  // Bestehende Einträge nach dem Laden mit den neuen Feldern anzeigen (Prüfung lief schon beim ersten Laden ohne Erweiterung)
  profilLaden();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("gedaechtnis");
