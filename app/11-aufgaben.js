// JARVIS Dashboard – Modul „aufgaben“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Aufgaben (nur auf diesem Gerät, Browserspeicher) ----------
// Aufgabe: { id, titel, faellig (ISO oder ""), prio: "hoch"|"normal"|"niedrig", erledigt, erstellt,
//   wiederholung: ""|"taeglich"|"werktags"|"woechentlich"|"monatlich", ankerTag (Monatstag für „monatlich“),
//   erinnertFuer (Zeitpunkt, für den schon erinnert wurde), schlummernBis (ISO oder "") }
// ab 11-07e optional: kategorie (Text), unterpunkte [{ id, text, erledigt }], notizId (verknüpfte Notiz) – fehlen, wenn leer
// Erinnerungen im Chat (solange geöffnet) und – nach ausdrücklicher Browserfreigabe – als Benachrichtigung. Kein Hintergrunddienst.
(function () {
  const SCHLUESSEL = "jarvis-aufgaben";
  const PRIO_RANG = { hoch: 0, normal: 1, niedrig: 2 };
  const WIEDERHOLUNG = { "": "einmalig", taeglich: "täglich", werktags: "werktags", woechentlich: "wöchentlich", monatlich: "monatlich" };
  const wiederholungFeld = document.getElementById("aufgabe-wiederholung");
  const meldung = document.getElementById("aufgabe-meldung");
  const form = document.getElementById("aufgabe-form");
  const titelFeld = document.getElementById("aufgabe-titel");
  const faelligFeld = document.getElementById("aufgabe-faellig");
  const prioFeld = document.getElementById("aufgabe-prio");
  const speichernKnopf = document.getElementById("aufgabe-speichern");
  const abbrechenKnopf = document.getElementById("aufgabe-abbrechen");
  const liste = document.getElementById("aufgaben-liste");
  const erinnerungKnopf = document.getElementById("erinnerung-erlauben");
  const erinnerungStatus = document.getElementById("erinnerung-status");
  let aufgaben = [];
  let bearbeitet = null; // id der Aufgabe, die gerade bearbeitet wird
  let speicherOk = true;

  function laden() {
    try {
      const daten = speicherJsonLesen(SCHLUESSEL, Array.isArray) || [];
      aufgaben = Array.isArray(daten) ? daten.filter((a) => a && typeof a.id === "string" && typeof a.titel === "string") : [];
      for (const a of aufgaben) {
        // Ältere Einträge (Feld „erinnert“) übernehmen, ohne erneut zu erinnern
        if (a.erinnertFuer === undefined) a.erinnertFuer = a.erinnert && a.faellig ? a.faellig : "";
        if (!WIEDERHOLUNG[a.wiederholung]) a.wiederholung = "";
        if (typeof a.schlummernBis !== "string") a.schlummernBis = "";
        delete a.erinnert;
        // ab 11-07e: ungültige Zusatzfelder nur in der Anzeige auslassen (gespeichert wird erst bei der nächsten Änderung)
        if (a.kategorie !== undefined && typeof a.kategorie !== "string") delete a.kategorie;
        if (a.unterpunkte !== undefined) a.unterpunkte = Array.isArray(a.unterpunkte) ? a.unterpunkte.filter((u) => u && typeof u.id === "string" && typeof u.text === "string") : [];
      }
    } catch (e) {
      aufgaben = [];
      speicherOk = false;
    }
  }

  // ab 11-04a: Speichern gescheitert → Hinweis in der Meldungszeile (vorher nur bei leerer Liste sichtbar, sonst stiller Erfolg)
  function speichern() {
    try { if (speicherBeschaedigt(SCHLUESSEL)) throw new Error("beschädigt"); localStorage.setItem(SCHLUESSEL, JSON.stringify(aufgaben)); speicherOk = true; } catch (e) {
      speicherOk = false;
      const hinweis = speicherBeschaedigt(SCHLUESSEL) ? "Nicht gespeichert: " + SPEICHER_SCHADEN_TEXT : "Nicht gespeichert: Browserspeicher gesperrt oder voll – die Änderung gilt nur bis zum Neuladen.";
      if (!meldung.textContent.includes(hinweis)) meldung.textContent = (meldung.textContent ? meldung.textContent + " " : "") + hinweis;
    }
  }

  function faelligDatum(a) { return a.faellig ? new Date(a.faellig) : null; }
  function istUeberfaellig(a, jetzt = Date.now()) { const f = faelligDatum(a); return Boolean(f && !a.erledigt && f.getTime() <= jetzt); }

  // Offene zuerst; darin überfällige/fällige nach Datum, dann nach Priorität; erledigte zuletzt
  // ab 11-06h: Sortierung und Filter der Anzeige (gespeicherte Daten unverändert)
  const sortFeld = document.getElementById("aufgaben-sortierung"), filterFeld = document.getElementById("aufgaben-filter"), zaehler = document.getElementById("aufgaben-zaehler");
  // Kategorie als einfaches Textfeld: eine leere Combobox (datalist) nannte keinen Wert (Barrierefreiheits-Abnahme)
  const katFilter = document.getElementById("aufgaben-kategorie-filter");
  const katFeld = document.getElementById("aufgabe-kategorie"), unterpunkteFeld = document.getElementById("aufgabe-unterpunkte");
  const SORTIERUNG = {
    prio: (a, b) => (PRIO_RANG[a.prio] ?? 1) - (PRIO_RANG[b.prio] ?? 1),
    titel: (a, b) => a.titel.localeCompare(b.titel, "de"),
    neu: (a, b) => String(b.erstellt || "").localeCompare(String(a.erstellt || "")),
  };
  function sortiert() {
    const art = sortFeld ? sortFeld.value : "";
    return aufgaben.slice().sort((a, b) => {
      if (a.erledigt !== b.erledigt) return a.erledigt ? 1 : -1;
      if (SORTIERUNG[art]) { const r = SORTIERUNG[art](a, b); if (r) return r; }
      const fa = faelligDatum(a), fb = faelligDatum(b);
      if (fa && fb && fa.getTime() !== fb.getTime()) return fa - fb;
      if (fa && !fb) return -1;
      if (!fa && fb) return 1;
      return (PRIO_RANG[a.prio] ?? 1) - (PRIO_RANG[b.prio] ?? 1) || a.erstellt.localeCompare(b.erstellt);
    });
  }

  function anzeigen() {
    anzeigenListe();
    // ab 11-07q: verknüpfte Notizen zeigen „Zur Aufgabe“ nur für noch vorhandene Aufgaben – nach jeder Änderung mit auffrischen
    if (typeof notizen !== "undefined" && typeof notizenAnzeigen === "function" && notizen.some((n) => n.aufgabeId)) notizenAnzeigen();
  }
  function anzeigenListe() {
    const jetzt = Date.now();
    const filter = filterFeld ? filterFeld.value : "";
    const alle = sortiert();
    // ab 11-07e: Kategorien (Filter und Vorschläge im Formular)
    const kategorien = [...new Set(aufgaben.map((a) => a.kategorie).filter(Boolean))].sort((x, y) => x.localeCompare(y, "de"));
    if (katFilter) {
      const gewaehlt = katFilter.value;
      katFilter.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "alle" }), ...kategorien.map((k) => Object.assign(document.createElement("option"), { value: k, textContent: k })));
      katFilter.value = kategorien.includes(gewaehlt) ? gewaehlt : "";
    }
    const kat = katFilter ? katFilter.value : "";
    const eintraege = alle.filter((a) => (filter === "offen" ? !a.erledigt : filter === "erledigt" ? a.erledigt : filter === "ueberfaellig" ? istUeberfaellig(a, jetzt) : true) && (!kat || a.kategorie === kat));
    if (zaehler) {
      const offen = aufgaben.filter((a) => !a.erledigt).length, ueber = aufgaben.filter((a) => istUeberfaellig(a, jetzt)).length;
      zaehler.textContent = `${offen} offen · ${aufgaben.length - offen} erledigt · ${ueber} überfällig` + (eintraege.length !== alle.length ? ` · angezeigt ${eintraege.length} von ${alle.length}` : "");
    }
    if (alle.length && !eintraege.length) { liste.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Keine Aufgabe passt zum Filter." })); return; }
    liste.replaceChildren(...(eintraege.length ? eintraege.map((a) => {
      const li = document.createElement("li");
      li.dataset.id = a.id;
      li.classList.toggle("erledigt", a.erledigt);
      li.classList.toggle("ueberfaellig", istUeberfaellig(a, jetzt));
      const kasten = Object.assign(document.createElement("input"), { type: "checkbox", checked: a.erledigt });
      kasten.setAttribute("aria-label", "Erledigt: " + a.titel);
      kasten.addEventListener("change", () => abhaken(a.id, kasten.checked));
      const text = Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: a.titel });
      const prio = Object.assign(document.createElement("span"), { className: "aufgabe-prio " + a.prio, textContent: a.prio === "normal" ? "" : a.prio === "hoch" ? "Priorität hoch" : "niedrig" });
      const faellig = Object.assign(document.createElement("span"), { className: "aufgabe-faellig",
        textContent: (a.faellig ? (istUeberfaellig(a, jetzt) ? "fällig seit " : "fällig ") + faelligDatum(a).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "")
          + (a.wiederholung ? " · ↻ " + WIEDERHOLUNG[a.wiederholung] : "")
          + (a.schlummernBis && !a.erledigt ? " · erinnert erneut " + new Date(a.schlummernBis).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "") });
      const bearbeiten = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: "Bearbeiten" });
      bearbeiten.setAttribute("aria-label", "Bearbeiten: " + a.titel);
      bearbeiten.addEventListener("click", () => bearbeitenStarten(a.id));
      const loeschen = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: "Löschen" });
      loeschen.setAttribute("aria-label", "Löschen: " + a.titel);
      loeschen.addEventListener("click", () => entfernen(a.id));
      li.append(kasten, text, prio, faellig, bearbeiten, loeschen);
      // ab 11-07e: Kategorie, verknüpfte Notiz und Unterpunkte
      if (a.kategorie) text.after(Object.assign(document.createElement("span"), { className: "aufgabe-kategorie", textContent: a.kategorie }));
      const notiz = a.notizId && typeof notizen !== "undefined" ? notizen.find((n) => n.id === a.notizId) : null;
      if (notiz) {
        const zur = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: "Notiz" });
        zur.setAttribute("aria-label", "Zur verknüpften Notiz: " + notiz.titel);
        zur.addEventListener("click", () => { if (typeof notizAnspringen === "function") notizAnspringen(notiz.id); });
        li.append(zur);
      }
      const up = a.unterpunkte || [];
      if (up.length) {
        faellig.textContent += (faellig.textContent ? " · " : "") + up.filter((u) => u.erledigt).length + "/" + up.length + " Unterpunkte";
        const ul = Object.assign(document.createElement("ul"), { className: "aufgabe-unterpunkte" });
        ul.setAttribute("aria-label", "Unterpunkte: " + a.titel);
        ul.append(...up.map((u) => {
          const p = document.createElement("li");
          const k = Object.assign(document.createElement("input"), { type: "checkbox", checked: Boolean(u.erledigt), disabled: a.erledigt });
          k.setAttribute("aria-label", "Unterpunkt erledigt: " + u.text);
          k.addEventListener("change", () => unterpunktUmschalten(a.id, u.id, k.checked));
          const l = Object.assign(document.createElement("span"), { textContent: u.text });
          p.classList.toggle("erledigt", Boolean(u.erledigt));
          p.append(k, l);
          return p;
        }));
        li.append(ul);
      }
      return li;
    }) : [Object.assign(document.createElement("li"), { textContent: speicherBeschaedigt(SCHLUESSEL) ? "Keine Aufgaben geladen – " + SPEICHER_SCHADEN_TEXT : speicherOk ? "Keine Aufgaben." : "Keine Aufgaben – Browserspeicher gesperrt, Aufgaben gehen beim Neuladen verloren." })]));
  }

  // nurNeu (ab 11-07c, Sprachbefehl): immer neu anlegen – vorher änderte „Neue Aufgabe …“ die gerade bearbeitete Aufgabe
  // extra (ab 11-07e, Formular): { kategorie, unterpunkte: [Text] } – fehlt extra, bleiben Kategorie und Unterpunkte unverändert
  function zusatzSetzen(a, extra) {
    if (!extra) return;
    if (extra.kategorie !== undefined) { const k = String(extra.kategorie || "").trim().slice(0, 40); if (k) a.kategorie = k; else delete a.kategorie; }
    if (Array.isArray(extra.unterpunkte)) {
      const alt = a.unterpunkte || [];
      const neu = [...new Set(extra.unterpunkte.map((t) => String(t || "").trim().slice(0, 200)).filter(Boolean))].slice(0, 30)
        .map((t, i) => { const v = alt.find((u) => u.text === t); return { id: v ? v.id : "u" + Date.now().toString(36) + i, text: t, erledigt: Boolean(v && v.erledigt) }; });
      if (neu.length) a.unterpunkte = neu; else delete a.unterpunkte;
    }
  }
  function hinzufuegenOderAendern(titel, faellig, prio, wiederholung = "", nurNeu = false, extra = null) {
    titel = String(titel || "").trim().slice(0, 200);
    if (!titel) return null;
    const datum = faellig ? new Date(faellig) : null;
    const faelligIso = datum && !isNaN(datum) ? datum.toISOString() : "";
    prio = PRIO_RANG[prio] !== undefined ? prio : "normal";
    wiederholung = WIEDERHOLUNG[wiederholung] ? wiederholung : "";
    meldung.textContent = "";
    if (wiederholung && !faelligIso) { wiederholung = ""; meldung.textContent = "Wiederholung braucht ein Fälligkeitsdatum – als einmalige Aufgabe gespeichert."; }
    const ankerTag = datum && !isNaN(datum) ? datum.getDate() : null;
    if (bearbeitet && !nurNeu) {
      const a = aufgaben.find((x) => x.id === bearbeitet);
      if (a) {
        // Neues Datum oder neue Wiederholung → neue Erinnerung, Schlummern aufgehoben
        if (a.faellig !== faelligIso || a.wiederholung !== wiederholung) { a.erinnertFuer = ""; a.schlummernBis = ""; }
        Object.assign(a, { titel, faellig: faelligIso, prio, wiederholung, ankerTag });
        zusatzSetzen(a, extra);
      }
      bearbeitenBeenden();
    } else {
      const a = { id: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), titel, faellig: faelligIso, prio, erledigt: false,
        wiederholung, ankerTag, erinnertFuer: "", schlummernBis: "", erstellt: new Date().toISOString() };
      zusatzSetzen(a, extra);
      if (extra && typeof extra.notizId === "string") a.notizId = extra.notizId;
      aufgaben.push(a);
      zuletztNeu = a.id;
    }
    speichern();
    anzeigen();
    return true;
  }
  let zuletztNeu = null;
  // Aus einer Notiz (ab 11-07e): neue Aufgabe mit Verweis auf die Notiz; Rückgabe: id
  function ausNotiz(titel, notizId) {
    zuletztNeu = null;
    if (!hinzufuegenOderAendern(titel, "", "normal", "", true, { notizId })) return null;
    return zuletztNeu;
  }
  function unterpunktUmschalten(id, uid, erledigt) {
    const a = aufgaben.find((x) => x.id === id), u = a && (a.unterpunkte || []).find((x) => x.id === uid);
    if (!u || a.erledigt) return false;
    u.erledigt = Boolean(erledigt);
    const offen = a.unterpunkte.filter((x) => !x.erledigt).length;
    meldung.textContent = offen ? "" : "Alle Unterpunkte von „" + a.titel + "“ erledigt – die Aufgabe selbst bitte abhaken.";
    speichern();
    anzeigen();
    return true;
  }
  // Wochenübersicht (ab 11-07e): überfällige und die nächsten 7 Kalendertage (heute eingeschlossen), nur offene Aufgaben mit Fälligkeit
  function wochenUebersicht(jetzt = Date.now()) {
    const offen = aufgaben.filter((a) => !a.erledigt && a.faellig);
    const start = new Date(jetzt); start.setHours(0, 0, 0, 0);
    const tage = [];
    for (let i = 0; i < 7; i++) {
      const von = new Date(start); von.setDate(start.getDate() + i);
      const bis = new Date(von); bis.setDate(von.getDate() + 1);
      tage.push({ datum: von, aufgaben: offen.filter((a) => { const t = new Date(a.faellig).getTime(); return t >= von.getTime() && t < bis.getTime() && t > jetzt; }).sort((x, y) => new Date(x.faellig) - new Date(y.faellig)) });
    }
    return { ueberfaellig: offen.filter((a) => istUeberfaellig(a, jetzt)), tage };
  }
  function wocheAnzeigen() {
    const box = document.getElementById("aufgaben-wochenliste"), knopf = document.getElementById("aufgaben-woche");
    const w = wochenUebersicht();
    const uhr = (a) => new Date(a.faellig).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const zeilen = [];
    if (w.ueberfaellig.length) zeilen.push("⚠ Überfällig: " + w.ueberfaellig.map((a) => a.titel).join(", "));
    for (const t of w.tage) zeilen.push(t.datum.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) + ": " + (t.aufgaben.length ? t.aufgaben.map((a) => uhr(a) + " " + a.titel).join(" · ") : "–"));
    box.replaceChildren(...zeilen.map((z) => Object.assign(document.createElement("li"), { textContent: z })));
    box.hidden = false;
    knopf.setAttribute("aria-expanded", "true");
    return w;
  }

  // Nächster Termin nach Ortszeit (lokale Datumsrechnung: 8:00 bleibt 8:00, auch über die Zeitumstellung).
  // Monatlich: Tag 31 wird in kürzeren Monaten zum letzten Tag, danach wieder 31. Immer nach „jetzt“.
  function naechsterTermin(iso, regel, ankerTag, jetzt = Date.now()) {
    if (!iso || !WIEDERHOLUNG[regel] || !regel) return null;
    const d = new Date(iso);
    const tag = ankerTag || d.getDate();
    let schritte = 0;
    do {
      if (regel === "taeglich") d.setDate(d.getDate() + 1);
      else if (regel === "werktags") { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
      else if (regel === "woechentlich") d.setDate(d.getDate() + 7);
      else { d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(Math.min(tag, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
    } while (d.getTime() <= jetzt && ++schritte < 5000);
    return d.toISOString();
  }

  // Wiederkehrende Aufgabe abhaken → bleibt offen mit dem nächsten Termin. Rückgabe: nächster Termin oder null.
  // ab 11-13j: { ohneAnzeige: true } – der Aufrufer zeichnet selbst über window.aufgabenIntern.anzeigen (mit Projekten und Tagesplan);
  // vorher zeichnete „Aufgabe … erledigt“ die Liste zweimal (bei 2.000 Aufgaben rund 64 ms zusätzlich)
  function abhaken(id, erledigt, jetzt = Date.now(), { ohneAnzeige = false } = {}) {
    const a = aufgaben.find((x) => x.id === id);
    if (!a) return null;
    let naechster = null;
    if (erledigt && a.wiederholung && a.faellig) {
      naechster = naechsterTermin(a.faellig, a.wiederholung, a.ankerTag, jetzt);
      Object.assign(a, { faellig: naechster, erledigt: false, schlummernBis: "", zuletztErledigt: new Date(jetzt).toISOString() });
      for (const u of a.unterpunkte || []) u.erledigt = false; // ab 11-07e: nächster Termin beginnt mit offenen Unterpunkten
      meldung.textContent = "„" + a.titel + "“ erledigt – nächster Termin " + new Date(naechster).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + ".";
    } else {
      a.erledigt = Boolean(erledigt);
      if (a.erledigt) a.schlummernBis = "";
      // ab 11-06h: Zeitpunkt des Erledigens (Abendzusammenfassung); beim Zurücknehmen entfernt
      if (a.erledigt) a.erledigtAm = new Date(jetzt).toISOString(); else delete a.erledigtAm;
    }
    speichern();
    if (!ohneAnzeige) anzeigen();
    return naechster;
  }

  // Schlummern: minuten (Zahl) oder "morgen" (nächster Tag 9:00 Ortszeit). Erinnert dann genau einmal erneut.
  function schlummern(id, dauer, jetzt = Date.now()) {
    const a = aufgaben.find((x) => x.id === id);
    if (!a || a.erledigt) return null;
    let bis;
    if (dauer === "morgen") { const d = new Date(jetzt); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); bis = d; }
    else bis = new Date(jetzt + Math.max(1, Math.min(1440, Number(dauer) || 10)) * 60000);
    a.schlummernBis = bis.toISOString();
    speichern();
    anzeigen();
    return a.schlummernBis;
  }

  function entfernen(id) {
    const a = aufgaben.find((x) => x.id === id);
    if (!a || !confirm("Aufgabe löschen?\n\n" + a.titel)) return;
    loeschenDirekt(id);
  }

  // Ohne Rückfrage – nur nach einer bereits erteilten Bestätigung (Dialog oder „Ja“ im Chat) aufrufen
  function loeschenDirekt(id) {
    aufgaben = aufgaben.filter((x) => x.id !== id);
    if (bearbeitet === id) bearbeitenBeenden();
    speichern();
    anzeigen();
  }

  function lokalesDatum(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const z = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes());
  }

  function bearbeitenStarten(id) {
    const a = aufgaben.find((x) => x.id === id);
    if (!a) return;
    bearbeitet = id;
    titelFeld.value = a.titel;
    faelligFeld.value = lokalesDatum(a.faellig);
    prioFeld.value = a.prio;
    wiederholungFeld.value = a.wiederholung || "";
    katFeld.value = a.kategorie || "";
    unterpunkteFeld.value = (a.unterpunkte || []).map((u) => u.text).join("\n");
    speichernKnopf.textContent = "Speichern";
    abbrechenKnopf.hidden = false;
    titelFeld.focus();
  }

  function bearbeitenBeenden() {
    bearbeitet = null;
    form.reset();
    speichernKnopf.textContent = "Hinzufügen";
    abbrechenKnopf.hidden = true;
  }

  // ---------- Erinnerungen ----------
  function erinnerungAnzeigen() {
    const da = "Notification" in window;
    const recht = da ? Notification.permission : "nicht unterstützt";
    erinnerungKnopf.hidden = !da || recht === "granted";
    erinnerungStatus.textContent = !da
      ? "Erinnerungen: von diesem Browser nicht unterstützt – fällige Aufgaben werden rot markiert."
      : recht === "granted"
        ? "Erinnerungen: an – erscheinen nur, solange diese Seite geöffnet ist."
        : recht === "denied"
          ? "Erinnerungen: im Browser blockiert – fällige Aufgaben werden rot markiert und im Chat gemeldet, solange diese Seite geöffnet ist."
          : "Erinnerungen: aus – fällige Aufgaben werden rot markiert und im Chat gemeldet, solange diese Seite geöffnet ist.";
  }

  async function erinnerungErlauben() {
    if (!("Notification" in window)) return;
    try { await Notification.requestPermission(); } catch (e) { /* ältere Browser */ }
    erinnerungAnzeigen();
  }

  // Erinnerungszeitpunkt: geschlummert bis … oder fällig
  function erinnerungsZeit(a) { return a.schlummernBis || a.faellig || ""; }

  // Hat ein anderer Tab diesen Zeitpunkt schon erinnert? (gleicher Browserspeicher – verhindert doppelte Meldungen)
  function schonErinnert(id, zeit) {
    try {
      const gespeichert = JSON.parse(localStorage.getItem(SCHLUESSEL) || "[]").find((x) => x && x.id === id);
      return Boolean(gespeichert && gespeichert.erinnertFuer === zeit);
    } catch (e) { return false; }
  }

  // Meldung im Chat mit Schlummern-Knöpfen (die Knöpfe wirken einmal; danach gesperrt)
  function erinnerungImChat(a, zeit) {
    if (typeof lokalAntworten !== "function") return;
    const element = lokalAntworten("Erinnerung: Aufgabe „" + a.titel + "“ ist fällig (" + new Date(zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + ")"
      + (a.wiederholung ? " · ↻ " + WIEDERHOLUNG[a.wiederholung] : "") + ".");
    const knoepfe = document.createElement("div");
    knoepfe.className = "paper-frage-knoepfe";
    const knopf = (text, aktion) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "knopf zweit", textContent: text });
      b.addEventListener("click", () => { for (const k of knoepfe.querySelectorAll("button")) k.disabled = true; aktion(); });
      return b;
    };
    knoepfe.append(knopf("In 10 Min.", () => schlummern(a.id, 10)), knopf("In 1 Std.", () => schlummern(a.id, 60)),
      knopf("Morgen 9 Uhr", () => schlummern(a.id, "morgen")), knopf("Erledigt", () => abhaken(a.id, true)));
    element.appendChild(knoepfe);
  }

  // Prüft offene Aufgaben; jeder Zeitpunkt (fällig bzw. geschlummert bis) wird höchstens einmal erinnert – auch nach dem
  // Neuladen und über mehrere Tabs. Verpasste Termine (Seite war zu) melden sich einmal beim nächsten Öffnen.
  function erinnerungenPruefen(jetzt = Date.now()) {
    let neu = 0;
    for (const a of aufgaben) {
      const zeit = erinnerungsZeit(a);
      if (a.erledigt || !zeit || new Date(zeit).getTime() > jetzt || a.erinnertFuer === zeit) continue;
      if (schonErinnert(a.id, zeit)) { a.erinnertFuer = zeit; continue; }
      a.erinnertFuer = zeit;
      neu++;
      speichern(); // sofort, damit ein zweiter Tab denselben Zeitpunkt nicht noch einmal meldet
      if ("Notification" in window && Notification.permission === "granted") {
        try { new Notification("JARVIS – Aufgabe fällig", { body: a.titel, tag: "jarvis-aufgabe-" + a.id }); } catch (e) { /* z. B. mobil ohne Service Worker */ }
      }
      erinnerungImChat(a, zeit);
    }
    anzeigen();
    return neu;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    hinzufuegenOderAendern(titelFeld.value, faelligFeld.value, prioFeld.value, wiederholungFeld.value, false,
      { kategorie: katFeld.value, unterpunkte: unterpunkteFeld.value.split(/\r?\n/) });
    if (!bearbeitet) form.reset();
    titelFeld.focus();
  });
  abbrechenKnopf.addEventListener("click", bearbeitenBeenden);
  form.addEventListener("keydown", (e) => { if (e.key === "Escape" && bearbeitet) { e.preventDefault(); bearbeitenBeenden(); } });
  erinnerungKnopf.addEventListener("click", erinnerungErlauben);
  if (sortFeld) sortFeld.addEventListener("change", anzeigen);
  if (filterFeld) filterFeld.addEventListener("change", anzeigen);
  if (katFilter) katFilter.addEventListener("change", anzeigen);
  document.getElementById("aufgaben-woche").addEventListener("click", () => {
    const box = document.getElementById("aufgaben-wochenliste");
    if (!box.hidden) { box.hidden = true; document.getElementById("aufgaben-woche").setAttribute("aria-expanded", "false"); } else wocheAnzeigen();
  });

  laden();
  anzeigen();
  erinnerungAnzeigen();
  // Auch im Hintergrund-Tab (Browser drosseln Zeitgeber dort, deshalb nur „solange geöffnet“ zugesagt)
  setInterval(() => erinnerungenPruefen(), 30000);
  // Änderungen aus einem anderen Tab übernehmen (das Ereignis kommt nur in den jeweils anderen Tabs an)
  window.addEventListener("storage", (e) => { if (e.key === SCHLUESSEL) { laden(); anzeigen(); } });
  // Für die lokalen Tests
  window.aufgabenIntern = { laden, anzeigen, liste: () => aufgaben, hinzufuegen: hinzufuegenOderAendern, abhaken, bearbeitenStarten, loeschenDirekt, erinnerungenPruefen, erinnerungAnzeigen,
    schlummern, naechsterTermin, WIEDERHOLUNG, ausNotiz, unterpunktUmschalten, wochenUebersicht, wocheAnzeigen };
})();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("aufgaben");
