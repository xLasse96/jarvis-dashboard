// JARVIS Dashboard – Modul „arbeitsplatz“ (ab 11-09g). Zentrale Arbeitsbereichsansicht im Cockpit (Karte „Arbeitsplatz“) aus den
// vorhandenen Bausteinen – keine zweite Datenhaltung:
//   - globale Suche über Aufgaben, Notizen, Projekte, Dateien, Profil und Navigationsziele, mit Vorschau und „Öffnen“
//   - Schnellerfassung (Aufgabe mit Zeitangabe, Notiz, Projekt) über die vorhandenen Funktionen
//   - Kacheln: Heute, Woche, Aufträge (laufend, Warteschlange), blockierte Aktionen, Hinweise, Aktivität, Projekte,
//     Schnellzugriffe (Favoriten/zuletzt aus 07b), Einstellungszentrale, Datenschutz- und Datensicherungsübersicht
//   - anpassbar: Kacheln ein-/ausblenden und umsortieren; kompakter Ansichtsmodus
// Speicher „jarvis-arbeitsplatz“ { art, version, reihenfolge, aus, kompakt, letzteSicherung } – nur Oberfläche, beschädigt → gemeldet.
const APLATZ = { schluessel: "jarvis-arbeitsplatz", maxTreffer: 5, minSuche: 2 };
const AP_KACHELN = {
  heute: "Heute", woche: "Woche", auftraege: "Aufträge & Warteschlange", blockiert: "Blockierte Aktionen", hinweise: "Benachrichtigungen",
  aktivitaet: "Aktivität", projekte: "Projekte", schnell: "Schnellzugriffe", einstellungen: "Einstellungszentrale", datenschutz: "Datenschutz", sicherung: "Datensicherung",
};
function apLesen() {
  const d = speicherJsonLesen(APLATZ.schluessel, (x) => istObjekt(x) && x.art === "jarvis-arbeitsplatz" && Array.isArray(x.reihenfolge) && Array.isArray(x.aus));
  const alle = Object.keys(AP_KACHELN);
  const reihe = d ? [...d.reihenfolge.filter((k) => AP_KACHELN[k]), ...alle.filter((k) => !d.reihenfolge.includes(k))] : alle;
  return { reihenfolge: [...new Set(reihe)], aus: d ? d.aus.filter((k) => AP_KACHELN[k]) : [], kompakt: Boolean(d && d.kompakt), letzteSicherung: d && typeof d.letzteSicherung === "string" ? d.letzteSicherung : null };
}
function apSchreiben(stand) {
  if (speicherBeschaedigt(APLATZ.schluessel)) return false;
  try { localStorage.setItem(APLATZ.schluessel, JSON.stringify({ art: "jarvis-arbeitsplatz", version: 1, ...stand })); return true; } catch (e) { return false; }
}
function apKachelUmschalten(k, sichtbar) {
  const s = apLesen();
  if (!AP_KACHELN[k] || speicherBeschaedigt(APLATZ.schluessel)) return false;
  s.aus = sichtbar ? s.aus.filter((x) => x !== k) : [...new Set([...s.aus, k])];
  const ok = apSchreiben(s); arbeitsplatzAnzeigen(); return ok;
}
function apKachelVerschieben(k, richtung) {
  const s = apLesen(), i = s.reihenfolge.indexOf(k), j = i + richtung;
  if (i < 0 || j < 0 || j >= s.reihenfolge.length || speicherBeschaedigt(APLATZ.schluessel)) return false;
  [s.reihenfolge[i], s.reihenfolge[j]] = [s.reihenfolge[j], s.reihenfolge[i]];
  const ok = apSchreiben(s); arbeitsplatzAnzeigen(); return ok;
}
function apKompakt(an) {
  const s = apLesen();
  if (speicherBeschaedigt(APLATZ.schluessel)) return false;
  s.kompakt = Boolean(an);
  const ok = apSchreiben(s);
  document.body.classList.toggle("ap-kompakt", s.kompakt);
  arbeitsplatzAnzeigen();
  return ok;
}
// ---------- globale Suche ----------
const apFalten = (s) => (typeof navFalten === "function" ? navFalten(s) : String(s).toLowerCase());
function apVorschau(text, woerter, laenge = 90) {
  const t = String(text || "").replace(/\s+/g, " ").trim(), f = apFalten(t), i = woerter.length ? Math.max(0, f.indexOf(woerter[0])) : 0;
  const start = Math.max(0, i - 30);
  return (start > 0 ? "…" : "") + t.slice(start, start + laenge) + (start + laenge < t.length ? "…" : "");
}
function apSpringen(id) { const z = document.getElementById(id); if (z && typeof zuElementSpringen === "function") { if (typeof ansichtSicherstellen === "function") ansichtSicherstellen("cockpit"); zuElementSpringen(z); return true; } return false; }
function arbeitsplatzSuchen(frage) {
  const woerter = apFalten(frage).split(/\s+/).filter(Boolean);
  if (apFalten(frage).trim().length < APLATZ.minSuche) return [];
  const passt = (...teile) => { const v = apFalten(teile.join(" ")); return woerter.every((w) => v.includes(w)); };
  const aus = [];
  const dazu = (art, liste) => { for (const x of liste.slice(0, APLATZ.maxTreffer)) aus.push({ art, ...x }); };
  if (window.aufgabenIntern) dazu("Aufgabe", window.aufgabenIntern.liste().filter((a) => passt(a.titel, a.kategorie || "")).map((a) => ({ titel: (a.erledigt ? "✓ " : "") + a.titel, vorschau: [a.kategorie, a.faellig ? "fällig " + new Date(a.faellig).toLocaleString("de-DE") : ""].filter(Boolean).join(" · ") || "Aufgabe", los: () => apSpringen("aufgaben-titel") })));
  if (typeof notizenSuchen === "function") dazu("Notiz", notizenSuchen(frage).map((n) => ({ titel: n.titel, vorschau: apVorschau(n.text, woerter), los: () => { const s = document.getElementById("notiz-suche"); if (s) { s.value = frage; s.dispatchEvent(new Event("input")); } return apSpringen("notizen-titel"); } })));
  if (typeof projekteFiltern === "function") dazu("Projekt", projekteFiltern({ suche: frage, archiv: true }).map((p) => ({ titel: p.name, vorschau: [p.status, p.ziel].filter(Boolean).join(" · "), los: () => { const d = document.getElementById("projekt-details"), s = document.getElementById("projekt-suche"); if (d) d.open = true; if (s) { s.value = p.name; projekteAnzeigen(); } return apSpringen("projekt-details"); } })));
  if (typeof dateienSuchen === "function") dazu("Datei", dateienSuchen({ suche: frage }).map(({ e, imText }) => ({ titel: e.name, vorschau: imText ? apVorschau((DATEIEN.inhalt.get(e.id) || {}).text, woerter) : `${groesseText(e.groesse)} · ${DATEI_KATEGORIEN[e.kategorie] || e.kategorie}`, los: () => { dateiVorschau(e.id); return apSpringen("datei-titel"); } })));
  if (typeof profil !== "undefined") dazu("Profil", profil.filter((e) => passt(e.titel, e.text, e.projekt || "")).map((e) => ({ titel: profilBezeichnung(e), vorschau: apVorschau(e.text, woerter), los: () => apSpringen("profil-titel") })));
  if (typeof navSuchen === "function") dazu("Navigation", navSuchen(frage).map((z) => ({ titel: z.text, vorschau: z.art + (ANSICHT_NAMEN[z.ansicht] ? " · " + ANSICHT_NAMEN[z.ansicht] : ""), los: () => navAnspringen(z.id) })));
  return aus;
}
// ---------- Schnellerfassung ----------
function arbeitsplatzErfassen(art, text, jetzt = new Date()) {
  const roh = String(text || "").trim();
  if (!roh) return { fehler: "Bitte etwas eingeben." };
  if (art === "aufgabe") {
    if (!window.aufgabenIntern) return { fehler: "Aufgaben nicht verfügbar." };
    const z = typeof zeitangabeErkennen === "function" ? zeitangabeErkennen(roh, jetzt) : { datum: null, rest: roh };
    if (z.rueckfrage) return { fehler: z.rueckfrage };
    const titel = (z.rest || roh).trim();
    if (!titel) return { fehler: "Titel fehlt." };
    const ok = window.aufgabenIntern.hinzufuegen(titel, z.datum ? z.datum.toISOString() : "", "normal", "", true);
    return ok ? { text: `Aufgabe „${titel}“ angelegt` + (z.datum ? ` für ${z.datum.toLocaleString("de-DE")}` : "") + "." } : { fehler: "Aufgabe nicht angelegt." };
  }
  if (art === "notiz") {
    if (typeof notizSichern !== "function") return { fehler: "Notizen nicht verfügbar." };
    const n = notizSichern({ titel: "", text: roh, kategorie: "Allgemein" });
    if (!n || n.fehler) return { fehler: (n && n.fehler) || "Notiz nicht gespeichert." };
    return { text: "Notiz gespeichert." + (n.warnung ? " " + n.warnung : "") };
  }
  if (art === "projekt") {
    if (typeof projektAnlegen !== "function") return { fehler: "Projekte nicht verfügbar." };
    const r = projektAnlegen({ name: roh });
    return r.fehler ? r : { text: `Projekt „${r.projekt.name}“ angelegt.` };
  }
  return { fehler: "Unbekannte Art." };
}
// ---------- Kacheln ----------
// Größen aus den vorhandenen Datenbereichen; „nur auf diesem Gerät“ gilt für alle, die KI-Übermittlung ist einzeln benannt
function apDatenschutz() {
  const bereiche = (typeof DATEN_BEREICHE !== "undefined" ? DATEN_BEREICHE : []).map((b) => {
    let zeichen = 0;
    for (const k of b.schluessel) { try { zeichen += (localStorage.getItem(k) || "").length; } catch (e) { /* nicht lesbar */ } }
    return { name: b.name, zeichen };
  }).filter((b) => b.zeichen > 0);
  const verbindung = typeof verbunden === "function" && verbunden();
  return { bereiche, verbindung, ki: ["Chat-Nachrichten an die KI und die dafür ausgewählten Profil-Einträge", "Recherche nur auf ausdrücklichen Befehl", "Bildanalyse nur nach Bildauswahl", "Vorlesetext (Google-Stimme) für Antworten"] };
}
function apKachelInhalt(k, jetzt = new Date()) {
  const zeilen = [];
  const auf = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => !a.erledigt) : [];
  const heuteEnde = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 1);
  if (k === "heute") {
    const faellig = auf.filter((a) => a.faellig && new Date(a.faellig) < heuteEnde).sort((a, b) => a.faellig.localeCompare(b.faellig));
    const ueber = faellig.filter((a) => new Date(a.faellig) < jetzt).length;
    zeilen.push(faellig.length ? `${faellig.length} Aufgabe(n) heute fällig${ueber ? `, davon ${ueber} überfällig` : ""}` : "Heute nichts fällig.", ...faellig.slice(0, 5).map((a) => "• " + new Date(a.faellig).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " " + a.titel));
  } else if (k === "woche") {
    const ende = new Date(heuteEnde.getTime() + 6 * 86400000), woche = auf.filter((a) => a.faellig && new Date(a.faellig) >= heuteEnde && new Date(a.faellig) < ende);
    const pw = typeof projektWoche === "function" ? projektWoche(jetzt) : null, ms = pw ? pw.tage.reduce((n, t) => n + t.eintraege.filter((e) => e.art === "Meilenstein").length, 0) : 0;
    zeilen.push(`${woche.length} Aufgabe(n) in den nächsten 6 Tagen` + (ms ? `, ${ms} Projekt-Meilenstein(e)` : ""), ...woche.slice(0, 5).map((a) => "• " + new Date(a.faellig).toLocaleDateString("de-DE", { weekday: "short" }) + " " + a.titel));
  } else if (k === "auftraege") {
    const l = typeof auftragStand !== "undefined" ? auftragStand.liste : [];
    const laufend = l.filter((a) => a.status === "laeuft"), warte = l.filter((a) => ["wartet", "warteschlange", "pausiert"].includes(a.status));
    zeilen.push(laufend.length ? `${laufend.length} Auftrag läuft` : "Kein Auftrag läuft.", warte.length ? `${warte.length} wartend/pausiert:` : "Warteschlange leer.", ...warte.slice(0, 5).map((a) => `• ${a.id}: ${a.status} – ${a.text.slice(0, 60)}`));
  } else if (k === "blockiert") {
    const auftr = (typeof auftragStand !== "undefined" ? auftragStand.liste : []).flatMap((a) => a.schritte.filter((s) => s.status === "blockiert" || s.art === "blockiert").map((s) => `• Auftrag ${a.id}, Schritt ${s.nr}: ${s.text.slice(0, 50)} – ${s.grund || s.ergebnis || "blockiert"}`));
    const werkz = (typeof WERKZEUG !== "undefined" ? WERKZEUG.historie : []).filter((h) => ["GESPERRT", "BESTAETIGUNG", "NICHT_VERFUEGBAR"].includes(h.code)).slice(0, 5).map((h) => `• Werkzeug ${h.werkzeug}: ${h.code} – ${h.eingabe}`);
    const ms = typeof projektStand !== "undefined" ? projektStand.projekte.flatMap((p) => projektUebersicht(p, jetzt).blockiert.map((b) => `• Projekt ${p.name}: „${b.titel}“ wartet auf „${b.wartetAuf}“`)) : [];
    const alle = [...auftr, ...werkz, ...ms];
    zeilen.push(alle.length ? `${alle.length} blockiert (nichts davon wurde ausgeführt):` : "Nichts blockiert.", ...alle.slice(0, 8));
  } else if (k === "hinweise") {
    const h = typeof hinweisStand !== "undefined" ? hinweisStand.eintraege.filter((x) => !x.gelesen) : [];
    zeilen.push(h.length ? `${h.length} ungelesene Benachrichtigung(en):` : "Keine ungelesenen Benachrichtigungen.", ...h.slice(-4).reverse().map((x) => "• " + x.text.slice(0, 80)));
  } else if (k === "aktivitaet") {
    const a = typeof AKTIONEN !== "undefined" ? AKTIONEN.liste : [];
    zeilen.push(a.length ? "Zuletzt (diese Sitzung):" : "Noch keine Aktivität in dieser Sitzung.", ...a.slice(0, 5).map((x) => "• " + [x.zeit ? new Date(x.zeit).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "", x.text || "", x.skill ? "(" + ((typeof AKTION_NAMEN !== "undefined" && AKTION_NAMEN[x.skill]) || x.skill) + ")" : "(an die KI)"].filter(Boolean).join(" ").slice(0, 80)));
  } else if (k === "projekte") {
    const l = typeof projekteFiltern === "function" ? projekteFiltern({ status: "aktiv" }) : [];
    zeilen.push(l.length ? `${l.length} aktive(s) Projekt(e):` : "Keine aktiven Projekte.", ...l.slice(0, 5).map((p) => { const u = projektUebersicht(p, jetzt); return `• ${p.name} – ${u.fortschritt} %${u.risiken.length ? " ⚠" : ""}`; }));
  } else if (k === "datenschutz") {
    const d = apDatenschutz();
    zeilen.push(`${d.bereiche.length} Datenbereiche gespeichert, alle nur in diesem Browser (zusammen ${d.bereiche.reduce((n, b) => n + b.zeichen, 0).toLocaleString("de-DE")} Zeichen).`,
      `Verbindung zum eigenen Worker: ${d.verbindung ? "eingerichtet" : "nicht eingerichtet – nichts verlässt das Gerät"}.`, "Über den Worker gehen nur:", ...d.ki.map((x) => "• " + x), "Dateiinhalte, Dokumente, Projekte und Aufgaben gehen nie automatisch an die KI.");
  } else if (k === "sicherung") {
    const s = apLesen();
    zeilen.push(s.letzteSicherung ? `Letzte Sicherung von hier: ${new Date(s.letzteSicherung).toLocaleString("de-DE")}.` : "Noch keine Sicherung über dieses Gerät erfasst (ab 11-09g gezählt).",
      s.letzteSicherung && jetzt - new Date(s.letzteSicherung) > 7 * 86400000 ? "⚠ Älter als 7 Tage – Sicherung empfohlen." : "Sicherung: Karte „Daten auf diesem Gerät“ → „Sicherung exportieren“.");
  }
  return zeilen;
}
function apKnopf(text, label, f, klasse = "schalter") { const b = Object.assign(document.createElement("button"), { type: "button", className: klasse, textContent: text }); b.setAttribute("aria-label", label); b.addEventListener("click", f); return b; }
function arbeitsplatzAnzeigen(jetzt = new Date()) {
  const box = document.getElementById("ap-kacheln");
  if (!box) return;
  const s = apLesen();
  document.body.classList.toggle("ap-kompakt", s.kompakt);
  const sch = document.getElementById("ap-kompakt");
  if (sch) { sch.setAttribute("aria-pressed", String(s.kompakt)); sch.textContent = s.kompakt ? "Kompakt: an" : "Kompakt: aus"; }
  if (speicherBeschaedigt(APLATZ.schluessel)) document.getElementById("ap-meldung").textContent = "Arbeitsplatz-Einstellungen beschädigt – " + SPEICHER_SCHADEN_TEXT;
  box.replaceChildren(...s.reihenfolge.filter((k) => !s.aus.includes(k)).map((k) => {
    const sec = Object.assign(document.createElement("section"), { className: "ap-kachel" });
    sec.dataset.kachel = k;
    sec.setAttribute("aria-label", AP_KACHELN[k]);
    sec.append(Object.assign(document.createElement("h3"), { textContent: AP_KACHELN[k] }));
    if (k === "schnell") {
      const favs = typeof navListeLesen === "function" ? navListeLesen(NAV.fav) : [], zul = typeof navListeLesen === "function" ? navListeLesen(NAV.zuletzt) : [];
      const ziele = typeof navZiele === "function" ? navZiele() : [], name = (id) => (ziele.find((z) => z.id === id) || {}).text;
      const reihe = (titel, ids) => { const p = Object.assign(document.createElement("p"), { className: "klein" }); p.append(titel + ": "); const g = ids.filter(name); if (!g.length) p.append("–"); for (const id of g.slice(0, 6)) p.append(apKnopf(name(id), titel + ": " + name(id), () => navAnspringen(id), "sprung")); return p; };
      sec.append(reihe("Favoriten", favs), reihe("Zuletzt", zul), Object.assign(document.createElement("p"), { className: "klein", textContent: "Favoriten setzt du mit ☆ unter „☰ NAVIGATION“." }));
    } else if (k === "einstellungen") {
      const p = Object.assign(document.createElement("p"), { className: "klein" });
      for (const z of typeof EINSTELLUNGEN_ZIELE !== "undefined" ? EINSTELLUNGEN_ZIELE : []) p.append(apKnopf(z.text, "Einstellungszentrale: " + z.text, () => navAnspringen("einst:" + z.text), "sprung"));
      for (const [t, id] of [["Freigaben der Fähigkeiten", "faehigkeiten-anzahl"], ["Mein Tag anpassen", "heute-titel"], ["Projektplanung", "projekt-details"], ["Dateien", "datei-titel"]]) if (document.getElementById(id)) p.append(apKnopf(t, "Einstellungszentrale: " + t, () => { const d = document.getElementById(id).closest("details"); if (d) d.open = true; apSpringen(id); }, "sprung"));
      sec.append(p);
    } else {
      const ul = document.createElement("ul");
      ul.className = "ap-zeilen";
      ul.append(...apKachelInhalt(k, jetzt).map((z) => Object.assign(document.createElement("li"), { textContent: z })));
      sec.append(ul);
    }
    return sec;
  }));
  // Anpassen-Liste
  const anp = document.getElementById("ap-anpassen-liste");
  if (anp) anp.replaceChildren(...s.reihenfolge.map((k, i) => {
    const li = document.createElement("li"), lab = Object.assign(document.createElement("label"), { className: "verlauf-schalter" }), cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: !s.aus.includes(k) });
    cb.addEventListener("change", () => apKachelUmschalten(k, cb.checked));
    lab.append(cb, " " + AP_KACHELN[k]);
    li.append(lab, apKnopf("↑", AP_KACHELN[k] + " nach oben", () => apKachelVerschieben(k, -1)), apKnopf("↓", AP_KACHELN[k] + " nach unten", () => apKachelVerschieben(k, 1)));
    li.children[1].disabled = i === 0; li.children[2].disabled = i === s.reihenfolge.length - 1;
    return li;
  }));
}
function arbeitsplatzSucheAnzeigen() {
  const feld = document.getElementById("ap-suche"), ul = document.getElementById("ap-treffer"), st = document.getElementById("ap-suche-status");
  const treffer = arbeitsplatzSuchen(feld.value);
  st.textContent = feld.value.trim().length < APLATZ.minSuche ? "" : treffer.length ? `${treffer.length} Treffer` : "Keine Treffer.";
  ul.replaceChildren(...treffer.map((t) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: `${t.art}: ${t.titel}` }), Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: t.vorschau || "" }), apKnopf("Öffnen", `Öffnen: ${t.art} ${t.titel}`, () => t.los()));
    return li;
  }));
}
// Datensicherung: Zeitpunkt der letzten erfolgreichen Sicherung merken (die Sicherung selbst bleibt unverändert)
if (typeof datenExportieren === "function") {
  const original = datenExportieren;
  datenExportieren = function (umfang, ...rest) {
    const ok = original(umfang, ...rest);
    if (ok && umfang === "alles") { const s = apLesen(); if (!speicherBeschaedigt(APLATZ.schluessel)) { s.letzteSicherung = new Date().toISOString(); apSchreiben(s); } arbeitsplatzAnzeigen(); }
    return ok;
  };
}
(function arbeitsplatzEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("ap-kacheln")) return;
  el("ap-suche").addEventListener("input", arbeitsplatzSucheAnzeigen);
  el("ap-schnell-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const r = arbeitsplatzErfassen(el("ap-schnell-art").value, el("ap-schnell-text").value);
    el("ap-meldung").textContent = r.fehler ? r.fehler + " Es wurde nichts angelegt." : r.text;
    if (!r.fehler) el("ap-schnell-text").value = "";
    arbeitsplatzAnzeigen();
  });
  el("ap-kompakt").addEventListener("click", () => apKompakt(!apLesen().kompakt));
  el("ap-aktualisieren").addEventListener("click", () => arbeitsplatzAnzeigen());
  arbeitsplatzAnzeigen();
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("arbeitsplatz");
