// JARVIS Dashboard – Modul „vorschlaege“ (ab 11-10g). Proaktiver Assistent – lokal, nur solange die Seite offen ist:
//   - Vorschläge aus vorhandenen Daten: überfällige und bald fällige Aufgaben, blockierte Projekte, Tagesplanung am Morgen,
//     Wochenprioritäten am Montag, offene tägliche Routinen am Abend, offene Entscheidungen (Aufträge/Workflows warten auf Freigabe)
//   - Priorität, Vorschau, Bestätigen (führt nur eine lokale, leichte Aktion aus oder öffnet die Stelle), Ablehnen, Ausblenden (4 h),
//     Historie, kein doppelter Vorschlag (Schlüssel je Sache und Tag), Häufigkeitsgrenze, Ruhezeiten, Arten ein-/ausschaltbar
//   - nie externe Aktionen, keine Benachrichtigung außerhalb der Seite (Browsergrenze ohne neue Berechtigung)
// Speicher „jarvis-vorschlaege“ { art, version, einstellungen, zustand, historie }.
const VORS = { schluessel: "jarvis-vorschlaege", maxHistorie: 50, ausblendenMs: 4 * 3600000, bevorstehendMs: 2 * 3600000 };
const VORS_ARTEN = { ueberfaellig: "Überfällige Aufgaben", bevorstehend: "Bald fällige Aufgaben", projekt: "Blockierte Projekte", tagesplan: "Tagesplanung am Morgen", woche: "Wochenprioritäten (montags)", routine: "Offene tägliche Routinen (abends)", entscheidung: "Offene Entscheidungen" };
const VORS_PRIO = { hoch: 0, mittel: 1, niedrig: 2 };
function vorsLesen() {
  const d = speicherJsonLesen(VORS.schluessel, (x) => istObjekt(x) && x.art === "jarvis-vorschlaege" && istObjekt(x.zustand) && Array.isArray(x.historie));
  const e = d && istObjekt(d.einstellungen) ? d.einstellungen : {};
  return { einstellungen: { aus: Array.isArray(e.aus) ? e.aus.filter((a) => VORS_ARTEN[a]) : [], ruheVon: typeof e.ruheVon === "string" ? e.ruheVon : "22:00", ruheBis: typeof e.ruheBis === "string" ? e.ruheBis : "07:00", maxStunde: Number.isInteger(e.maxStunde) && e.maxStunde > 0 && e.maxStunde <= 50 ? e.maxStunde : 5 },
    zustand: d ? d.zustand : {}, historie: d ? d.historie.slice(-VORS.maxHistorie) : [] };
}
function vorsSchreiben(s) {
  if (speicherBeschaedigt(VORS.schluessel)) return false;
  try { localStorage.setItem(VORS.schluessel, JSON.stringify({ art: "jarvis-vorschlaege", version: 1, ...s, historie: s.historie.slice(-VORS.maxHistorie) })); return true; } catch (e) { return false; }
}
const vorsTag = (j) => { const d = new Date(j); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
const vorsMin = (s) => { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function vorsRuhezeit(jetzt, e) {
  const v = vorsMin(e.ruheVon), b = vorsMin(e.ruheBis); if (v === null || b === null || v === b) return false;
  const d = new Date(jetzt), m = d.getHours() * 60 + d.getMinutes();
  return v < b ? m >= v && m < b : m >= v || m < b;
}
// Kandidaten aus den vorhandenen Daten (ohne Zustand)
function vorsKandidaten(jetzt = Date.now()) {
  const k = [], d = new Date(jetzt), tag = vorsTag(jetzt), aufg = window.aufgabenIntern ? window.aufgabenIntern.liste().filter((a) => !a.erledigt) : [];
  for (const a of aufg.filter((x) => x.faellig && new Date(x.faellig).getTime() < jetzt)) k.push({ key: `ueberfaellig:${a.id}:${tag}`, art: "ueberfaellig", prio: "hoch", text: `„${a.titel}“ ist überfällig (seit ${new Date(a.faellig).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}).`, aktion: { label: "Auf morgen 9:00 verschieben", los: () => { const m = new Date(jetzt); m.setDate(m.getDate() + 1); m.setHours(9, 0, 0, 0); return typeof tplanVerschieben === "function" ? !tplanVerschieben(a.id, m).fehler : false; } } });
  for (const a of aufg.filter((x) => x.faellig && new Date(x.faellig).getTime() >= jetzt && new Date(x.faellig).getTime() - jetzt <= VORS.bevorstehendMs)) k.push({ key: `bevorstehend:${a.id}:${a.faellig}`, art: "bevorstehend", prio: "mittel", text: `„${a.titel}“ ist um ${new Date(a.faellig).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} fällig.`, aktion: { label: "Zur Aufgabe", los: () => vorsSpringen("aufgaben-titel") } });
  // ab 10s: auch Aufgaben, die auf eine offene Aufgabe warten (Abhängigkeit 10f, Übersicht 10h), nicht nur Meilensteine
  const wartendeAufgaben = typeof projekteBlockiert === "function" ? projekteBlockiert().filter((x) => x.art === "Aufgabe") : [];
  for (const p of typeof projektStand !== "undefined" ? projektStand.projekte.filter((x) => x.status === "aktiv") : []) {
    const u = projektUebersicht(p, d), wa = wartendeAufgaben.filter((x) => x.projekt === p.name).length;
    const teile = [u.blockiert.length ? u.blockiert.length + " Meilenstein(e) blockiert" : "", wa ? wa + " Aufgabe(n) warten auf andere" : ""].filter(Boolean);
    if (teile.length || (u.risiken.length && !u.naechster)) k.push({ key: `projekt:${p.id}:${tag}`, art: "projekt", prio: "mittel", text: `Projekt „${p.name}“: ${teile.length ? teile.join(", ") : u.risiken.join(", ")}.`, aktion: { label: "Projekt öffnen", los: () => { const det = document.getElementById("projekt-details"), s = document.getElementById("projekt-suche"); if (det) det.open = true; if (s) { s.value = p.name; projekteAnzeigen(); } return vorsSpringen("projekt-details"); } } });
  }
  if (d.getHours() >= 6 && d.getHours() < 11 && aufg.some((a) => a.faellig && vorsTag(new Date(a.faellig).getTime()) === tag)) k.push({ key: `tagesplan:${tag}`, art: "tagesplan", prio: "niedrig", text: "Heute stehen Aufgaben an – Reihenfolge und Zeitblöcke vorschlagen lassen?", aktion: { label: "Tagesplanung öffnen", los: () => { const t = document.getElementById("tplan-details"); if (t) t.open = true; return vorsSpringen("tplan-details"); } } });
  if (d.getDay() === 1 && aufg.length) { const top = aufg.filter((a) => a.prio === "hoch").slice(0, 3); k.push({ key: `woche:${tag}`, art: "woche", prio: "niedrig", text: top.length ? `Wochenprioritäten: ${top.map((a) => a.titel).join(", ")}.` : `Neue Woche: ${aufg.length} offene Aufgabe(n), keine mit hoher Priorität.` }); }
  if (d.getHours() >= 18 && typeof routinen !== "undefined") for (const r of routinen.filter((x) => x.taeglich && !x.pausiert && !routineHeuteErledigt(x, jetzt))) k.push({ key: `routine:${r.id}:${tag}`, art: "routine", prio: "niedrig", text: `Die tägliche Routine „${r.name}“ ist heute noch offen.`, aktion: { label: "Vorschau öffnen", los: () => Boolean(routineVorschau(r.id)) } });
  const warten = (typeof auftragStand !== "undefined" ? auftragStand.liste : []).filter((a) => a.status === "wartet");
  if (warten.length) k.push({ key: `entscheidung:auftraege:${warten.map((a) => a.id).join(",")}`, art: "entscheidung", prio: "hoch", text: `${warten.length} Auftrag/Aufträge warten auf deine Freigabe.`, aktion: { label: "Aufträge öffnen", los: () => { const a = document.getElementById("auftrag-details"); if (a) a.open = true; return vorsSpringen("auftrag-details"); } } });
  if (typeof routineLauf !== "undefined" && routineLauf && Number.isInteger(routineLauf.wartetFreigabe)) k.push({ key: `entscheidung:workflow:${routineLauf.routine.id}`, art: "entscheidung", prio: "hoch", text: `Workflow „${routineLauf.routine.name}“ wartet auf deine Freigabe.` });
  return k;
}
function vorsSpringen(id) { const z = document.getElementById(id); if (!z || typeof zuElementSpringen !== "function") return false; if (typeof ansichtSicherstellen === "function") ansichtSicherstellen("cockpit"); zuElementSpringen(z); return true; }
// Sichtbare Vorschläge: Arten-Einstellung, Zustand (abgelehnt/bestätigt/ausgeblendet), Ruhezeit, Häufigkeitsgrenze für neue
function vorschlaegeErmitteln(jetzt = Date.now()) {
  const s = vorsLesen(), aus = new Set(s.einstellungen.aus), ruhe = vorsRuhezeit(jetzt, s.einstellungen);
  const neuInStunde = s.historie.filter((h) => h.ereignis === "gezeigt" && jetzt - Date.parse(h.zeit) < 3600000).length;
  let neuErlaubt = Math.max(0, s.einstellungen.maxStunde - neuInStunde), geaendert = false;
  const sichtbar = [], unterdrueckt = { ruhe: 0, grenze: 0 };
  for (const v of vorsKandidaten(jetzt).sort((a, b) => VORS_PRIO[a.prio] - VORS_PRIO[b.prio])) {
    if (aus.has(v.art)) continue;
    const z = s.zustand[v.key];
    if (z && (z.zustand === "abgelehnt" || z.zustand === "bestaetigt")) continue;
    if (z && z.zustand === "ausgeblendet" && jetzt < z.bis) continue;
    if (ruhe && v.prio !== "hoch") { unterdrueckt.ruhe++; continue; } // in der Ruhezeit nur Dringendes
    if (!z || z.zustand === "ausgeblendet") {
      if (neuErlaubt <= 0) { unterdrueckt.grenze++; continue; }
      neuErlaubt--; s.zustand[v.key] = { zustand: "gezeigt", zeit: new Date(jetzt).toISOString() }; s.historie.push({ zeit: new Date(jetzt).toISOString(), key: v.key, art: v.art, text: v.text, ereignis: "gezeigt" }); geaendert = true;
    }
    sichtbar.push(v);
  }
  // veraltete Zustände (Sache existiert nicht mehr) entfernen, damit der Speicher nicht wächst
  const aktuell = new Set(vorsKandidaten(jetzt).map((v) => v.key));
  for (const k of Object.keys(s.zustand)) if (!aktuell.has(k) && jetzt - Date.parse(s.zustand[k].zeit || 0) > 7 * 86400000) { delete s.zustand[k]; geaendert = true; }
  if (geaendert) vorsSchreiben(s);
  return { sichtbar, unterdrueckt, ruhe };
}
function vorschlagEntscheiden(key, entscheidung, jetzt = Date.now()) {
  const s = vorsLesen(), v = vorsKandidaten(jetzt).find((x) => x.key === key);
  if (!v || speicherBeschaedigt(VORS.schluessel)) return { fehler: "Vorschlag nicht mehr aktuell." };
  let ergebnis = "";
  if (entscheidung === "bestaetigt" && v.aktion) { try { ergebnis = v.aktion.los() ? "ausgeführt: " + v.aktion.label : "nicht ausgeführt"; } catch (e) { ergebnis = "Fehler: " + e.message; } }
  s.zustand[key] = { zustand: entscheidung, zeit: new Date(jetzt).toISOString(), bis: entscheidung === "ausgeblendet" ? jetzt + VORS.ausblendenMs : undefined };
  s.historie.push({ zeit: new Date(jetzt).toISOString(), key, art: v.art, text: v.text, ereignis: entscheidung + (ergebnis ? " – " + ergebnis : "") });
  vorsSchreiben(s); vorschlaegeAnzeigen();
  return { ergebnis };
}
function vorsEinstellen(aenderung, jetzt = Date.now()) {
  const s = vorsLesen(), e = { ...s.einstellungen, ...aenderung };
  if (vorsMin(e.ruheVon) === null || vorsMin(e.ruheBis) === null || !(Number.isInteger(e.maxStunde) && e.maxStunde > 0 && e.maxStunde <= 50)) return false;
  s.einstellungen = { ...e, aus: e.aus.filter((a) => VORS_ARTEN[a]) };
  const ok = vorsSchreiben(s); vorschlaegeAnzeigen(jetzt); return ok;
}
function vorschlaegeAnzeigen(jetzt = Date.now()) {
  const el = (id) => document.getElementById(id);
  if (!el("vors-liste")) return;
  vorsLesen(); // liest neu und setzt dabei die Beschädigt-Markierung
  if (speicherBeschaedigt(VORS.schluessel)) { el("vors-liste").replaceChildren(Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: "Vorschläge beschädigt – " + SPEICHER_SCHADEN_TEXT })); return; }
  const r = vorschlaegeErmitteln(jetzt), s = vorsLesen();
  el("vors-zahl").textContent = r.sichtbar.length ? `(${r.sichtbar.length})` : "";
  const knopf = (t, label, f) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: t }); b.setAttribute("aria-label", label); b.addEventListener("click", f); return b; };
  el("vors-liste").replaceChildren(...(r.sichtbar.length ? r.sichtbar.map((v) => {
    const li = document.createElement("li"); li.dataset.key = v.key;
    li.append(Object.assign(document.createElement("span"), { className: "aufgabe-text" + (v.prio === "hoch" ? " wz-wichtig" : ""), textContent: `${v.prio === "hoch" ? "❗ " : ""}${v.text}` }), Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: VORS_ARTEN[v.art] + (v.aktion ? " · Bestätigen: " + v.aktion.label : "") }));
    li.append(knopf(v.aktion ? v.aktion.label : "Erledigt", "Bestätigen: " + v.text, () => { const x = vorschlagEntscheiden(v.key, "bestaetigt"); el("vors-meldung").textContent = x.fehler || "Bestätigt" + (x.ergebnis ? " – " + x.ergebnis : "") + "."; }),
      knopf("Ablehnen", "Ablehnen: " + v.text, () => vorschlagEntscheiden(v.key, "abgelehnt")), knopf("Später", "Für 4 Stunden ausblenden: " + v.text, () => vorschlagEntscheiden(v.key, "ausgeblendet")));
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "Keine Vorschläge." + (r.unterdrueckt.ruhe ? ` ${r.unterdrueckt.ruhe} wegen Ruhezeit zurückgestellt.` : "") + (r.unterdrueckt.grenze ? ` ${r.unterdrueckt.grenze} wegen der Häufigkeitsgrenze zurückgestellt.` : "") })]));
  el("vors-historie").replaceChildren(...s.historie.slice(-10).reverse().map((h) => Object.assign(document.createElement("li"), { textContent: `${new Date(h.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} · ${h.ereignis}: ${h.text}` })));
  el("vors-arten").replaceChildren(...Object.entries(VORS_ARTEN).map(([k, t]) => { const l = Object.assign(document.createElement("label"), { className: "verlauf-schalter" }), c = Object.assign(document.createElement("input"), { type: "checkbox", checked: !s.einstellungen.aus.includes(k) }); c.addEventListener("change", () => vorsEinstellen({ aus: c.checked ? s.einstellungen.aus.filter((x) => x !== k) : [...s.einstellungen.aus, k] })); l.append(c, " " + t); return l; }));
  el("vors-ruhe-von").value = s.einstellungen.ruheVon; el("vors-ruhe-bis").value = s.einstellungen.ruheBis;
}
(function vorsEinrichten() {
  const el = (id) => document.getElementById(id);
  if (!el("vors-liste")) return;
  el("vors-ruhe-speichern").addEventListener("click", () => { el("vors-meldung").textContent = vorsEinstellen({ ruheVon: el("vors-ruhe-von").value.trim(), ruheBis: el("vors-ruhe-bis").value.trim() }) ? "Ruhezeit gespeichert." : "Ruhezeit ungültig (HH:MM)."; });
  setInterval(() => { if (!document.hidden) { try { vorschlaegeAnzeigen(); } catch (e) { /* ab 11-12e: Hintergrundanzeige – Fehler bleibt hier */ } } }, 60000); // ab 10q: ruht in verborgenen Tabs
  setTimeout(() => { try { vorschlaegeAnzeigen(); } catch (e) { /* ab 11-12e: Hintergrundanzeige */ } }, 2000);
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("vorschlaege");
