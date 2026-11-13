// JARVIS Aktien – Kongress-Tracker („Pelosi-Tracker“, Stufe 2). Ohne eigenes Netz: liest den vom Worker durchgereichten
// Jahresindex des House Clerk (<JAHR>FD.zip) und vom Nutzer eingefügten Text eines Berichts (PTR). Keine Order.
// Öffentliche Meldungen nach dem STOCK Act: bis zu 45 Tage nach dem Geschäft eingereicht – schnell gelesen, aber nie früh,
// kein Insiderwissen. Beträge sind Spannen. Senat: nur von Hand (efdsearch.senate.gov, Nutzungsbedingungen selbst bestätigen).
// Index- und Berichtsleser nach dem Vorbild von trader-pelosi (ptr.py) aus github.com/Jakeschincariol/trader-skill
// (MIT, Copyright (c) 2026 Jake Schincariol), in JavaScript übertragen. Den PDF-Bericht selbst liest JARVIS nicht aus
// (kein pdftotext im Browser/Worker): Text aus dem PDF kopieren und einfügen.
(function (global) {
  "use strict";

  const PTR_URL = (jahr, doc) => `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${jahr}/${doc}.pdf`;
  const FD_URL = (jahr, doc) => `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${jahr}/${doc}.pdf`;
  const ARTEN = { P: "Transaktionsbericht (PTR)", O: "Jahresbericht", A: "Änderung", C: "Kandidatenbericht", X: "Fristverlängerung", T: "Abschlussbericht", W: "Befreiung", D: "Offenlegung (neu)", H: "Erstbericht" };
  const GESCHAEFTE = { P: "Kauf", S: "Verkauf", "S (partial)": "Teilverkauf", E: "Tausch" };
  const EIGNER = { SP: "Ehepartner", JT: "gemeinsam", DC: "abhängiges Kind", "": "Abgeordnete(r) selbst" };
  const SPAET_TAGE = 45;

  function isoAusMdy(mdy) {
    const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/.exec(mdy || "");
    if (!m) return null;
    let [monat, tag, jahr] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (jahr < 100) jahr += 2000;
    const d = new Date(Date.UTC(jahr, monat - 1, tag));
    return d.getUTCMonth() === monat - 1 && d.getUTCDate() === tag ? d.toISOString().slice(0, 10) : null;
  }

  // Erste XML-Datei aus einem ZIP (über das zentrale Verzeichnis; „deflate“ oder unkomprimiert)
  async function zipXml(puffer) {
    const b = new Uint8Array(puffer);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 22 || dv.getUint32(0, true) !== 0x04034b50) {
      return new TextDecoder("utf-8").decode(b); // schon XML
    }
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("ZIP ohne Inhaltsverzeichnis.");
    let p = dv.getUint32(eocd + 16, true);
    const anzahl = dv.getUint16(eocd + 10, true);
    const namen = [];
    for (let n = 0; n < anzahl; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP-Verzeichnis beschädigt.");
      const methode = dv.getUint16(p + 10, true), groesse = dv.getUint32(p + 20, true);
      const nameLaenge = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), kommentar = dv.getUint16(p + 32, true);
      const kopf = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLaenge));
      namen.push(name);
      if (name.toLowerCase().endsWith(".xml")) {
        const start = kopf + 30 + dv.getUint16(kopf + 26, true) + dv.getUint16(kopf + 28, true);
        const daten = b.subarray(start, start + groesse);
        if (methode === 0) return new TextDecoder("utf-8").decode(daten);
        if (methode !== 8) throw new Error("ZIP-Kompression " + methode + " wird nicht unterstützt.");
        const strom = new Blob([daten]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new TextDecoder("utf-8").decode(await new Response(strom).arrayBuffer());
      }
      p += 46 + nameLaenge + extra + kommentar;
    }
    throw new Error("Keine XML-Datei im ZIP (Dateien: " + namen.join(", ") + ").");
  }

  function indexLesen(xmlText, jahr) {
    const doc = new DOMParser().parseFromString(String(xmlText).replace(/^﻿/, ""), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Index ist kein gültiges XML.");
    const aus = [];
    for (const m of doc.getElementsByTagName("Member")) {
      const f = {};
      for (const c of m.children) f[c.tagName] = (c.textContent || "").trim();
      const art = f.FilingType || "";
      const j = Number(f.Year) || jahr;
      aus.push({
        doc_id: f.DocID || "", art, art_name: ARTEN[art] || art, nachname: f.Last || "", vorname: f.First || "",
        name: [f.Prefix, f.First, f.Last, f.Suffix].filter(Boolean).join(" "), bezirk: f.StateDst || "", jahr: j,
        eingereicht: isoAusMdy(f.FilingDate || ""), link: (art === "P" ? PTR_URL : FD_URL)(j, f.DocID || ""),
      });
    }
    return aus.sort((a, b) => ((b.eingereicht || "") + b.doc_id).localeCompare((a.eingereicht || "") + a.doc_id));
  }

  // „pelosi“, „Nancy Pelosi“ oder „Pelosi, Nancy“
  function mitgliedPasst(zeile, mitglied) {
    const m = String(mitglied || "").trim().toLowerCase();
    if (!m) return true;
    let nach, vor;
    if (m.includes(",")) [nach, vor] = m.split(",", 2).map((x) => x.trim());
    else { const t = m.split(/\s+/); nach = t[t.length - 1]; vor = t.slice(0, -1).join(" "); }
    return zeile.nachname.toLowerCase() === nach && (!vor || zeile.vorname.toLowerCase().startsWith(vor));
  }

  function auswaehlen(zeilen, { mitglieder = [], art = "P", seit = null } = {}) {
    return zeilen.filter((z) => (!art || z.art === art) && (!mitglieder.length || mitglieder.some((m) => mitgliedPasst(z, m))) && (!seit || (z.eingereicht || "") >= seit));
  }

  // Nur noch nicht gezeigte Berichte; beim ersten Mal nur die letzten 45 Tage
  function neueSeit(zeilen, zustand, heute) {
    const gesehen = new Set((zustand && zustand.gesehen) || []);
    if (!zustand || !zustand.letztePruefung) {
      const grenze = new Date(Date.parse(heute + "T00:00:00Z") - SPAET_TAGE * 86400000).toISOString().slice(0, 10);
      return zeilen.filter((z) => (z.eingereicht || "") >= grenze);
    }
    return zeilen.filter((z) => !gesehen.has(z.doc_id));
  }

  // ab AJ5: Anzeige-Auswahl wie ptr.py:533-559 – alle neuen Meldungen werden gezeigt (vorher schnitt app/19 vor der Neu-Prüfung auf 60
  // ab, neuere jenseits davon gingen verloren); ältere füllen bis „max“ auf. Als gesehen gilt die ganze Auswahl (wie das Original).
  // Doppelte Kennungen (z. B. Jahres- und Vorjahresindex im Januar) nur einmal; Meldungen ohne Kennung bleiben sichtbar, werden aber
  // nicht als gesehen gespeichert (sie wären sonst nie wieder erkennbar).
  function anzeigeWaehlen(auswahl, zustand, heute, max = 60) {
    const doppelt = new Set(), einmal = [];
    for (const z of auswahl) { const id = z && z.doc_id ? String(z.doc_id) : ""; if (id && doppelt.has(id)) continue; if (id) doppelt.add(id); einmal.push(z); }
    const neu = neueSeit(einmal, zustand, heute), neuSet = new Set(neu);
    let platz = Math.max(0, max - neu.length);
    const zeigen = einmal.filter((z) => neuSet.has(z) || (platz-- > 0));
    return { zeigen, neu, gesehen: einmal.filter((z) => z.doc_id).map((z) => String(z.doc_id)), ausgeblendet: einmal.length - zeigen.length };
  }

  // ---------- Bericht (Text aus dem PDF, Layout wie „pdftotext -layout“) ----------
  const ZEILE = /^\s*(?:(SP|JT|DC)\s+)?(.*?)\s+(S \(partial\)|P|S|E)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\S.*?)\s*$/;
  const LABEL = [
    ["status", /^\s*F(?:ILING)?\s+S(?:TATUS)?\s*:\s*(.*)$/i],
    ["beschreibung", /^\s*D(?:ESCRIPTION)?\s*:\s*(.*)$/i],
    ["konto", /^\s*S(?:UBHOLDING)?\s+O(?:F)?\s*:\s*(.*)$/i],
    ["ort", /^\s*L(?:OCATION)?\s*:\s*(.*)$/i],
  ];
  const SEITENKOPF = /^\s*(ID\s+Owner\s+Asset|Type\s+Date\b|Type$|Date$|Gains >$|\$200\?$)/i;
  const ENDE = /^\s*(\* For the complete|I CERTIFY|Digitally Signed|Filing ID #)/i;
  const OPTION = /([\d,]+)\s+(call|put)\s+options?\b[\s\S]*?strike price of \$([\d,.]+)[\s\S]*?expiration date of (\d{1,2}\/\d{1,2}\/\d{2,4})/i;
  const AKTIEN = /(?:purchased|sold|bought)\s+([\d,]+)\s+shares/i;

  function abschliessen(z, eingereicht) {
    const wert = z._wert.split(/\s+/).join(" ");
    delete z._wert;
    const ticker = [...wert.matchAll(/\(([A-Z][A-Z0-9.\-/]{0,9})\)/g)].map((m) => m[1]);
    const code = [...wert.matchAll(/\[([A-Z]{2})\]/g)].map((m) => m[1]);
    z.ticker = ticker.length ? ticker[ticker.length - 1] : null;
    z.wertart = code.length ? code[code.length - 1] : null;
    let name = wert.replace(/\s*\[[A-Z]{2}\]/g, "");
    if (z.ticker) name = name.replace(new RegExp("\\s*\\(" + z.ticker.replace(/[.\-/]/g, "\\$&") + "\\)"), "");
    z.wert = name.replace(/^[\s-]+|[\s-]+$/g, "");
    z.betrag = z.betrag.split(/\s+/).join(" ");
    const zahlen = [...z.betrag.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
    z.betrag_von = zahlen.length ? zahlen[0] : null;
    z.betrag_bis = zahlen.length > 1 ? zahlen[1] : null;
    z.beschreibung = (z.beschreibung || "").split(/\s+/).join(" ").trim() || null;
    const opt = OPTION.exec(z.beschreibung || "");
    if (opt) z.option = { kontrakte: Number(opt[1].replace(/,/g, "")), art: opt[2].toLowerCase(), basispreis: Number(opt[3].replace(/,/g, "")), verfall: isoAusMdy(opt[4]), ausgeuebt: /^\s*exercised\b/i.test(z.beschreibung) };
    const st = AKTIEN.exec(z.beschreibung || "");
    if (st) z.stueck = Number(st[1].replace(/,/g, ""));
    if (eingereicht && z.datum) {
      z.tage_bis_meldung = Math.round((Date.parse(eingereicht) - Date.parse(z.datum)) / 86400000);
      z.verspaetet = z.tage_bis_meldung > SPAET_TAGE;
    }
    z.fehlend = fehlendeAngaben(z, eingereicht);
    return z;
  }

  // Was in einer Zeile fehlt oder nicht lesbar ist (wird angezeigt, nie ergänzt oder geschätzt)
  function fehlendeAngaben(z, eingereicht) {
    const f = [];
    if (!z.datum) f.push("Handelsdatum nicht lesbar");
    if (!z.ticker) f.push("kein Ticker (z. B. Fonds, Anleihe, Immobilie oder nicht angegeben)");
    if (z.betrag_von === null || z.betrag_von === undefined) f.push("Betrag nicht lesbar");
    if (!eingereicht) f.push("Meldedatum fehlt – Verzögerung nicht berechenbar");
    return f;
  }

  // ---------- Manuelle Eingabe (z. B. Senat: efdsearch.senate.gov von Hand gelesen) ----------
  // Je Zeile: Datum; Eigner; Geschäft; Wert (TICKER); Betrag – Trenner „;“ oder Tabulator. Optional erste Zeile „Eingereicht: Datum“.
  // Datum als JJJJ-MM-TT, TT.MM.JJJJ oder MM/TT/JJJJ. Alles bleibt als „manuell eingegeben, nicht geprüft“ gekennzeichnet.
  const EIGNER_TEXT = { self: "", selbst: "", "": "", spouse: "SP", ehepartner: "SP", sp: "SP", joint: "JT", gemeinsam: "JT", jt: "JT", child: "DC", dependent: "DC", kind: "DC", dc: "DC" };
  const GESCHAEFT_TEXT = { purchase: "P", kauf: "P", p: "P", sale: "S", verkauf: "S", s: "S", "sale (partial)": "S (partial)", teilverkauf: "S (partial)", "s (partial)": "S (partial)", exchange: "E", tausch: "E", e: "E" };
  function datumLesen(s) {
    s = String(s || "").trim();
    let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return isoAusMdy(`${m[2]}/${m[3]}/${m[1]}`);
    if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s))) return isoAusMdy(`${m[2]}/${m[1]}/${m[3]}`);
    return isoAusMdy(s);
  }
  function manuellLesen(text, { kammer = "Senat" } = {}) {
    const zeilen = [], fehler = [];
    let eingereicht = null;
    const liste = String(text || "").split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
    if (liste.length > 200) return { zeilen, fehler: ["Höchstens 200 Zeilen."], kammer, eingereicht };
    liste.forEach((zeile, i) => {
      const e = /^(?:eingereicht|filed)\s*:\s*(.+)$/i.exec(zeile);
      if (e) { eingereicht = datumLesen(e[1]); if (!eingereicht) fehler.push(`Zeile ${i + 1}: Meldedatum nicht lesbar`); return; }
      const teile = zeile.split(/\t|;/).map((t) => t.trim());
      if (teile.length < 5) { fehler.push(`Zeile ${i + 1}: zu wenige Angaben (Form: Datum; Eigner; Geschäft; Wert (TICKER); Betrag)`); return; }
      const [datumText, eignerText, geschaeftText, wertText, ...betragTeile] = teile;
      const eigner = EIGNER_TEXT[eignerText.toLowerCase()];
      const geschaeft = GESCHAEFT_TEXT[geschaeftText.toLowerCase()];
      const tickerTreffer = /\(([A-Z][A-Z0-9.\-]{0,9})\)/.exec(wertText);
      const betrag = betragTeile.join(" ").replace(/\s+/g, " ").slice(0, 80);
      const zahlen = [...betrag.matchAll(/\$\s?([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
      const z = {
        quelle: "manuell", kammer, datum: datumLesen(datumText), eigner: eigner === undefined ? null : eigner,
        eigner_name: eigner === undefined ? `„${eignerText.slice(0, 30)}“ nicht erkannt` : EIGNER[eigner],
        geschaeft: geschaeft || null, geschaeft_name: geschaeft ? GESCHAEFTE[geschaeft] : `„${geschaeftText.slice(0, 30)}“ nicht erkannt`,
        wert: wertText.replace(/\s*\([^)]*\)\s*/g, " ").trim().slice(0, 120), ticker: tickerTreffer ? tickerTreffer[1] : null,
        betrag, betrag_von: zahlen.length ? zahlen[0] : null, betrag_bis: zahlen.length > 1 ? zahlen[1] : null,
      };
      if (eingereicht && z.datum) {
        z.tage_bis_meldung = Math.round((Date.parse(eingereicht) - Date.parse(z.datum)) / 86400000);
        z.verspaetet = z.tage_bis_meldung > SPAET_TAGE;
      }
      z.fehlend = fehlendeAngaben(z, eingereicht);
      if (eigner === undefined) z.fehlend.push("Eigner nicht erkannt");
      if (!geschaeft) z.fehlend.push("Geschäftsart nicht erkannt");
      zeilen.push(z);
    });
    // Meldedatum kann nach den Zeilen stehen: Verzögerung dann nachtragen
    if (eingereicht) for (const z of zeilen) if (z.datum && z.tage_bis_meldung === undefined) {
      z.tage_bis_meldung = Math.round((Date.parse(eingereicht) - Date.parse(z.datum)) / 86400000);
      z.verspaetet = z.tage_bis_meldung > SPAET_TAGE;
      z.fehlend = z.fehlend.filter((f) => !f.startsWith("Meldedatum"));
    }
    const doppelte = duplikateMarkieren(zeilen);
    return { zeilen, fehler, kammer, eingereicht, doppelte };
  }

  // ---------- PDF, Duplikate, Senat (ab 2026-11-01c) ----------
  // Automatisches Auslesen der PTR-PDFs: NICHT verfügbar – es gibt keine PDF-Prüfdateien (nur den daraus gewonnenen Text), das Original
  // nutzte „pdftotext“ (im Browser nicht vorhanden, eine PDF-Bibliothek wäre eine neue Abhängigkeit), und viele Meldungen sind gescannte
  // Papierformulare ohne Text. Weg bleibt: Text aus dem PDF kopieren und hier einfügen.
  const PDF_AUSWERTUNG = { verfuegbar: false, grund: "Automatisches PDF-Auslesen nicht verfügbar: keine PDF-Prüfdateien, keine PDF-Bibliothek im Dashboard, gescannte Formulare enthalten keinen Text. Text aus dem PDF kopieren und einfügen." };
  // Senat (efdsearch.senate.gov): Zugang erst nach eigener Bestätigung der Nutzungsbedingungen; keine Prüfdaten – automatischer Abruf
  // NICHT verfügbar. Vorgesehen ist die manuelle Eingabe (manuellLesen), immer als „manuell, nicht geprüft“ gekennzeichnet.
  const SENAT_AUTOMATISCH = { verfuegbar: false, grund: "Senatsdaten nur manuell: efdsearch.senate.gov verlangt die eigene Bestätigung der Nutzungsbedingungen; ohne Prüfdaten kein automatischer Abruf." };

  // Eingefügten Text prüfen, bevor er gelesen wird: PDF-Rohdaten, Binärreste oder leer → klare Meldung statt stiller Fehllesung
  function textPruefen(text) {
    const s = String(text || "");
    if (!s.trim()) return "Kein Text eingefügt.";
    if (/^\s*%PDF-/.test(s)) return "Das sind PDF-Rohdaten, kein Text. " + PDF_AUSWERTUNG.grund;
    const steuer = (s.match(/[\u0000-\u0008\u000E-\u001F�]/g) || []).length;
    if (steuer > 20 && steuer / s.length > 0.02) return "Der Text enthält unlesbare Zeichen (vermutlich Binärdaten aus einem PDF) – bitte den Text im PDF markieren und als Text kopieren.";
    return null;
  }

  // Mögliche Duplikate: gleiches Datum, Eigner, Geschäft, Wert/Ticker, Wertart/Option und Betrag. Nichts wird gelöscht; markiert wird jede
  // weitere gleiche Zeile (doppelt: true, doppelt_von: Index der ersten). Zwei gleich große Geschäfte am selben Tag sind möglich – daher
  // nur „mögliches Duplikat“.
  function duplikateMarkieren(zeilen) {
    const erste = new Map();
    let anzahl = 0;
    zeilen.forEach((z, i) => {
      // Wertart ([ST] Aktie, [OP] Option) und Optionsdaten gehören zum Schlüssel: Aktie und Option am selben Tag sind kein Duplikat
      const k = [z.datum, z.eigner || "", z.geschaeft || "", z.ticker || String(z.wert || "").toLowerCase(), z.wertart || "", z.option ? JSON.stringify(z.option) : "", String(z.betrag || "").replace(/\s+/g, "")].join("|");
      if (erste.has(k)) { z.doppelt = true; z.doppelt_von = erste.get(k); anzahl++; } else erste.set(k, i);
    });
    return anzahl;
  }

  // Mehrere Berichte zusammenführen: dieselbe Dokument-ID nur einmal; gleiche Zeilen aus verschiedenen Berichten als mögliche Duplikate
  function berichteZusammenfuehren(berichte) {
    const ids = new Set();
    const doppelteBerichte = [];
    const zeilen = [];
    for (const b of berichte || []) {
      if (!b || b.fehler) continue;
      if (b.doc_id) { if (ids.has(b.doc_id)) { doppelteBerichte.push(b.doc_id); continue; } ids.add(b.doc_id); }
      for (const z of b.zeilen || []) zeilen.push({ ...z, doc_id: b.doc_id || null, eingereicht: b.eingereicht || null, name: b.name || null, quelle: z.quelle || "PTR-Text" });
    }
    const doppelt = duplikateMarkieren(zeilen);
    return { zeilen, doppelte_berichte: doppelteBerichte, doppelte_zeilen: doppelt };
  }

  function berichtLesen(text, eingereicht = null) {
    const pruef = textPruefen(text);
    if (pruef) return { name: null, status: null, bezirk: null, doc_id: null, eingereicht, zeilen: [], fehler: pruef };
    const kopf = { name: null, status: null, bezirk: null, doc_id: null, eingereicht };
    const zeilen = [];
    let akt = null, modus = null, betragOffen = false;
    for (const roh of String(text || "").split(/\r?\n/)) {
      const zeile = roh.replace(/\s+$/, "");
      const s = zeile.trim();
      let m;
      if (!kopf.name && (m = /^Name:\s+(.*)$/.exec(s))) { kopf.name = m[1].trim(); continue; }
      if (!kopf.status && (m = /^Status:\s+(.*)$/.exec(s))) { kopf.status = m[1].trim(); continue; }
      if ((m = /^State\/District:\s*(\S+)/.exec(s))) { kopf.bezirk = m[1]; continue; }
      if ((m = /Filing ID #(\d+)/.exec(s))) { kopf.doc_id = m[1]; continue; }
      if ((m = /^Digitally Signed:.*?,\s*(\d{2}\/\d{2}\/\d{4})/.exec(s))) { kopf.eingereicht = kopf.eingereicht || isoAusMdy(m[1]); continue; }
      const t = ZEILE.exec(zeile);
      if (t && isoAusMdy(t[4])) {
        if (akt) zeilen.push(akt);
        const eigner = t[1] || "";
        akt = { eigner, eigner_name: EIGNER[eigner] || eigner, _wert: t[2], geschaeft: t[3], geschaeft_name: GESCHAEFTE[t[3]] || t[3], datum: isoAusMdy(t[4]), benachrichtigt: isoAusMdy(t[5]), betrag: t[6], status: null, konto: null };
        betragOffen = akt.betrag.endsWith("-");
        modus = "wert";
        continue;
      }
      if (!akt) continue;
      if (!s) {
        if (modus === "beschreibung" || modus === "wert") modus = modus === "beschreibung" || akt._wert.includes("[") ? "labels" : modus;
        continue;
      }
      if (SEITENKOPF.test(s)) continue;
      if (ENDE.test(s)) { modus = "labels"; continue; }
      const label = LABEL.map(([k, rx]) => [k, rx.exec(zeile)]).find(([, x]) => x);
      if (label) {
        const [k, x] = label;
        if (k === "beschreibung") { akt.beschreibung = x[1].trim(); modus = "beschreibung"; }
        else { if (k === "status" || k === "konto") akt[k] = x[1].trim(); modus = "labels"; }
        continue;
      }
      if (modus === "wert") {
        const teile = s.split(/\s{2,}/);
        if (betragOffen && /^\$[\d,]+$/.test(teile[teile.length - 1])) { akt.betrag += " " + teile.pop(); betragOffen = false; }
        if (teile.length && teile[0]) akt._wert += " " + teile.join(" ");
      } else if (modus === "beschreibung") {
        akt.beschreibung = (akt.beschreibung || "") + " " + s;
      }
    }
    if (akt) zeilen.push(akt);
    kopf.zeilen = zeilen.map((z) => abschliessen(z, kopf.eingereicht));
    kopf.doppelte = duplikateMarkieren(kopf.zeilen);
    if (!kopf.zeilen.length) kopf.hinweis = "Keine Geschäftszeilen erkannt – bei gescannten (handschriftlichen) Meldungen enthält das PDF keinen Text.";
    return kopf;
  }

  global.AktienKongress = { zipXml, indexLesen, auswaehlen, mitgliedPasst, neueSeit, anzeigeWaehlen,berichtLesen, manuellLesen, datumLesen, isoAusMdy, SPAET_TAGE, textPruefen, duplikateMarkieren, berichteZusammenfuehren, PDF_AUSWERTUNG, SENAT_AUTOMATISCH };
})(typeof window !== "undefined" ? window : globalThis);
