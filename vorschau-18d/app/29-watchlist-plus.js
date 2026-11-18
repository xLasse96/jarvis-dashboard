// JARVIS Dashboard – Modul „watchlist-plus“ (ab 11-07k). Ergänzungen zur Aktien-Watchlist (app/08-watchlist.js) und zum Screener:
//   - Kategorie, Tags und Favorit je Symbol – in einem EIGENEN Schlüssel „jarvis-aktien-wl-meta“, damit das Format der Watchlist
//     unverändert bleibt (ältere Dashboard-Versionen würden zusätzliche Felder sonst als beschädigt werten).
//   - Screener: Regeln unter einem Namen speichern und wieder laden, Verlauf der letzten Läufe (Zeit, Regeln, Ergebnis, Datenstand).
// Nur dieses Gerät, keine Anfrage. Beschädigt → gemeldet, nie überschrieben. Kein Feld darf Schlüssel oder Codes enthalten.
const WLM = { schluessel: "jarvis-aktien-wl-meta", maxTags: 8, maxKategorie: 30, maxTag: 20 };
const SCR = { schluessel: "jarvis-screener", maxFilter: 20, maxVerlauf: 20, maxName: 40 };
const WLM_TEXT = /^[\p{L}\p{N} ._&+-]*$/u;
const wlmLeer = () => ({ art: "jarvis-aktien-wl-meta", version: 1, je: {} });
function wlMetaLesen() {
  const d = speicherJsonLesen(WLM.schluessel, (x) => istObjekt(x) && x.art === "jarvis-aktien-wl-meta" && istObjekt(x.je));
  return d || wlmLeer();
}
// Prüft und normalisiert { kategorie, tags, favorit } → { meta } | { fehler }
function wlMetaPruefen(m) {
  const kategorie = String((m && m.kategorie) || "").trim();
  const tags = [...new Set((Array.isArray(m && m.tags) ? m.tags : String((m && m.tags) || "").split(/[,;]/)).map((t) => String(t).trim().replace(/^#/, "").toLowerCase()).filter(Boolean))];
  if (kategorie.length > WLM.maxKategorie || !WLM_TEXT.test(kategorie)) return { fehler: `Kategorie ungültig (höchstens ${WLM.maxKategorie} Zeichen, Buchstaben, Ziffern, Leerzeichen, . _ & + -).` };
  if (tags.length > WLM.maxTags) return { fehler: `Höchstens ${WLM.maxTags} Tags.` };
  const falsch = tags.find((t) => t.length > WLM.maxTag || !WLM_TEXT.test(t));
  if (falsch) return { fehler: `Tag „${falsch.slice(0, 25)}“ ungültig (höchstens ${WLM.maxTag} Zeichen).` };
  if ([kategorie, ...tags].some((t) => typeof enthaeltGeheimnis === "function" && enthaeltGeheimnis(t))) return { fehler: "Kategorie oder Tag sieht wie ein Schlüssel oder Code aus – nicht gespeichert." };
  return { meta: { ...(kategorie ? { kategorie } : {}), ...(tags.length ? { tags } : {}), ...(m && m.favorit ? { favorit: true } : {}) } };
}
function wlMetaSetzen(symbol, m) {
  const d = wlMetaLesen();
  if (speicherBeschaedigt(WLM.schluessel)) return { fehler: "Zusatzangaben beschädigt – " + SPEICHER_SCHADEN_TEXT };
  const p = wlMetaPruefen(m);
  if (p.fehler) return p;
  const s = String(symbol || "").toUpperCase();
  if (Object.keys(p.meta).length) d.je[s] = p.meta; else delete d.je[s];
  try { localStorage.setItem(WLM.schluessel, JSON.stringify(d)); } catch (e) { return { fehler: "Nicht gespeichert (Browserspeicher gesperrt oder voll)." }; }
  return { meta: p.meta };
}
function wlMeta(symbol) { const m = wlMetaLesen().je[String(symbol || "").toUpperCase()]; return m && typeof m === "object" ? m : {}; }
// Nur Einträge zu Symbolen, die noch auf der Watchlist stehen, mit gültiger Form – für Export/Import
function wlMetaFuer(symbole) {
  const je = wlMetaLesen().je, aus = {};
  for (const s of symbole) { const p = wlMetaPruefen(je[s] || {}); if (!p.fehler && Object.keys(p.meta).length) aus[s] = p.meta; }
  return aus;
}
// Varianten eines Symbols („brk-b“, „BRK/B“, „$aapl“) in die Schreibweise der Watchlist bringen
function wlSymbolNormal(text) {
  const s = String(text || "").trim().toUpperCase().replace(/^\$/, "").replace(/\s+/g, " ");
  const m = s.match(/^([A-Z]{1,5})[-/ .]([A-Z]{1,2})$/);
  return m ? m[1] + "." + m[2] : s.replace(/\s/g, "");
}
// Zusatzangaben im Detail eines Eintrags bearbeiten
function wlMetaFormular(symbol) {
  const box = document.getElementById("wl-detail");
  if (!box || box.hidden || box.dataset.symbol !== symbol) return;
  const m = wlMeta(symbol);
  const f = Object.assign(document.createElement("form"), { className: "order-zeile wl-meta-form" });
  f.setAttribute("aria-label", "Zusatzangaben zu " + symbol);
  const feld = (id, label, wert, extra = {}) => { const l = Object.assign(document.createElement("label"), { className: "klein" }); const i = Object.assign(document.createElement("input"), { className: "feld", id, value: wert, ...extra }); l.append(label + " ", i); return l; };
  const fav = Object.assign(document.createElement("input"), { type: "checkbox", id: "wl-meta-favorit", checked: Boolean(m.favorit) });
  const favL = Object.assign(document.createElement("label"), { className: "klein" }); favL.append(fav, " Favorit");
  const knopf = Object.assign(document.createElement("button"), { type: "submit", className: "knopf zweit", textContent: "Zusatzangaben speichern" });
  f.append(feld("wl-meta-kategorie", "Kategorie", m.kategorie || "", { maxLength: WLM.maxKategorie }), feld("wl-meta-tags", "Tags (mit Komma)", (m.tags || []).join(", "), { maxLength: 200 }), favL, knopf);
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = wlMetaSetzen(symbol, { kategorie: document.getElementById("wl-meta-kategorie").value, tags: document.getElementById("wl-meta-tags").value, favorit: fav.checked });
    wlStatus(r.fehler ? "Zusatzangaben nicht gespeichert: " + r.fehler : `Zusatzangaben zu ${symbol} gespeichert.`);
    if (!r.fehler) { wlZeigen(); wlDetailZeigen(symbol); }
  });
  box.append(Object.assign(document.createElement("h4"), { textContent: "Kategorie, Tags, Favorit (nur dieses Gerät)" }), f);
}
{
  const original = wlDetailZeigen;
  wlDetailZeigen = function (symbol) { const r = original(symbol); wlMetaFormular(symbol); return r; };
}
// Filterauswahl aus den vorhandenen Zusatzangaben
function wlMetaFilterAuffrischen() {
  const d = wlMetaLesen(), kat = document.getElementById("wl-kategorie-filter"), tag = document.getElementById("wl-tag-filter");
  if (!kat || !tag) return;
  const alleKat = [...new Set(Object.values(d.je).map((m) => m && m.kategorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  const alleTags = [...new Set(Object.values(d.je).flatMap((m) => (m && Array.isArray(m.tags) ? m.tags : [])))].sort((a, b) => a.localeCompare(b, "de"));
  for (const [el, werte, leer, vor] of [[kat, alleKat, "alle Kategorien", ""], [tag, alleTags, "alle Tags", "#"]]) {
    const gew = el.value;
    el.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: leer }), ...werte.map((w) => Object.assign(document.createElement("option"), { value: w, textContent: vor + w })));
    el.value = werte.includes(gew) ? gew : "";
  }
}

// ---------- Screener: gespeicherte Regeln und Verlauf ----------
const scrLeer = () => ({ art: "jarvis-screener", version: 1, filter: {}, verlauf: [] });
function scrLesen() { return speicherJsonLesen(SCR.schluessel, (x) => istObjekt(x) && x.art === "jarvis-screener" && istObjekt(x.filter) && Array.isArray(x.verlauf)) || scrLeer(); }
function scrSchreiben(d) {
  if (speicherBeschaedigt(SCR.schluessel)) return "Screener-Speicher beschädigt – " + SPEICHER_SCHADEN_TEXT;
  try { localStorage.setItem(SCR.schluessel, JSON.stringify(d)); return null; } catch (e) { return "Nicht gespeichert (Browserspeicher gesperrt oder voll)."; }
}
// Speichert gültige Regeln unter einem Namen; Rückgabe null (ok) oder Fehlertext
function scrFilterSpeichern(name, spec) {
  const n = String(name || "").trim();
  if (!n || n.length > SCR.maxName || !WLM_TEXT.test(n)) return `Name fehlt oder ist ungültig (höchstens ${SCR.maxName} Zeichen).`;
  const f = window.AktienScreener.regelnPruefen(spec);
  if (f) return "Regeln ungültig: " + f;
  const d = scrLesen();
  if (speicherBeschaedigt(SCR.schluessel)) return "Screener-Speicher beschädigt – " + SPEICHER_SCHADEN_TEXT;
  if (!d.filter[n] && Object.keys(d.filter).length >= SCR.maxFilter) return `Höchstens ${SCR.maxFilter} gespeicherte Regeln.`;
  d.filter[n] = spec;
  return scrSchreiben(d);
}
function scrFilterLoeschen(name) { const d = scrLesen(); if (speicherBeschaedigt(SCR.schluessel) || !d.filter[name]) return "Nicht vorhanden."; delete d.filter[name]; return scrSchreiben(d); }
// Ein Lauf im Verlauf: nur Ergebnis und Datenstand, keine Kennzahlenwerte
function scrVerlaufMerken(r, symbole, sec, jetzt = Date.now()) {
  const d = scrLesen();
  if (speicherBeschaedigt(SCR.schluessel)) return null;
  const e = { zeit: new Date(jetzt).toISOString(), regeln: String(r.name || "eigene").slice(0, 80), symbole: symbole.slice(0, 10),
    // ab 14zc (trader-screener screen.py:282, 289): mit Regel „top“ nur die besten top Bestandenen speichern, Rest als Anzahl
    bestanden: r.ergebnisse.filter((x) => x.bestanden_alle).map((x) => x.ticker).slice(0, r.top || undefined), ...(r.mehr_bestanden ? { mehr_bestanden: r.mehr_bestanden } : {}), anzahl: r.ergebnisse.length,
    kurs_stand: [...new Set(r.ergebnisse.map((x) => x.kennzahlen && x.kennzahlen.kurs_stand).filter(Boolean))].sort().slice(-1)[0] || null,
    sec_stand: sec ? [...new Set(r.ergebnisse.map((x) => x.kennzahlen && x.kennzahlen.period_end).filter(Boolean))].sort().slice(-1)[0] || null : null };
  d.verlauf = [e, ...d.verlauf].slice(0, SCR.maxVerlauf);
  scrSchreiben(d);
  scrAnzeigen();
  return e;
}
function scrAnzeigen() {
  const el = (id) => document.getElementById(id);
  if (!el("wz-scr-gespeichert")) return;
  const d = scrLesen(), kaputt = speicherBeschaedigt(SCR.schluessel);
  const sel = el("wz-scr-gespeichert"), gew = sel.value, namen = Object.keys(d.filter).sort((a, b) => a.localeCompare(b, "de"));
  sel.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: namen.length ? "gespeicherte Regeln …" : "keine gespeicherten Regeln" }), ...namen.map((n) => Object.assign(document.createElement("option"), { value: n, textContent: n })));
  sel.value = namen.includes(gew) ? gew : "";
  el("wz-scr-verlauf").replaceChildren(...(kaputt ? [Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: "Screener-Speicher beschädigt – " + SPEICHER_SCHADEN_TEXT })]
    : d.verlauf.length ? d.verlauf.map((v) => Object.assign(document.createElement("li"), { textContent: `${new Date(v.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} · ${v.regeln} · ${v.bestanden.length} von ${v.anzahl} bestanden${v.bestanden.length ? " (" + v.bestanden.join(", ") + ")" : ""} · Kursstand ${v.kurs_stand || "nicht verfügbar"}${v.sec_stand !== null ? " · SEC bis " + v.sec_stand : ""}` }))
      : [Object.assign(document.createElement("li"), { textContent: "Noch keine Läufe." })]));
}
(function scrEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("wz-scr-gespeichert")) return;
  el("wz-scr-speichern").addEventListener("click", () => {
    let spec;
    try { spec = el("wz-scr-vorlage").value === "eigene" ? JSON.parse(el("wz-scr-regeln").value) : window.AktienScreener.VORLAGEN[el("wz-scr-vorlage").value]; } catch (e) { el("wz-scr-status").textContent = "Eigene Regeln: kein gültiges JSON – nicht gespeichert."; return; }
    const f = scrFilterSpeichern(el("wz-scr-name").value, spec);
    el("wz-scr-status").textContent = f ? "Nicht gespeichert: " + f : `Regeln „${el("wz-scr-name").value.trim()}“ gespeichert.`;
    scrAnzeigen();
  });
  el("wz-scr-gespeichert").addEventListener("change", () => {
    const n = el("wz-scr-gespeichert").value, spec = scrLesen().filter[n];
    if (!n || !spec) return;
    el("wz-scr-vorlage").value = "eigene"; el("wz-scr-regeln").hidden = false;
    el("wz-scr-regeln").value = JSON.stringify(spec, null, 1); el("wz-scr-name").value = n;
    el("wz-scr-status").textContent = `Regeln „${n}“ geladen – „Screenen“ startet den Lauf.`;
  });
  el("wz-scr-loeschen").addEventListener("click", () => {
    const n = el("wz-scr-gespeichert").value;
    if (!n) { el("wz-scr-status").textContent = "Erst gespeicherte Regeln auswählen."; return; }
    const f = scrFilterLoeschen(n);
    el("wz-scr-status").textContent = f ? "Nicht gelöscht: " + f : `Regeln „${n}“ gelöscht.`;
    scrAnzeigen();
  });
  scrAnzeigen();
  wlMetaFilterAuffrischen();
  for (const id of ["wl-kategorie-filter", "wl-tag-filter", "wl-nur-favoriten"]) { const x = el(id); if (x) x.addEventListener("change", wlZeigen); }
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("watchlist-plus");
