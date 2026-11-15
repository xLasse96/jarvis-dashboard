// JARVIS Dashboard – Modul „verlauf“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Verlauf: Suche, Datumsfilter, Anheften (Stand …30f) ----------
// Nur lokal: durchsucht die angezeigten Nachrichten und die angehefteten. Angeheftetes liegt bereinigt (ohne Codes/Schlüssel)
// unter „jarvis-verlauf-angeheftet“ und bleibt, bis es gelöst wird – unabhängig von „Auf diesem Gerät speichern“.
const ANGEHEFTET = { schluessel: "jarvis-verlauf-angeheftet", max: 50, maxText: 4000 };
const VERLAUF_ART_TEXT = { nutzer: "Sie", jarvis: "JARVIS", fehler: "Fehler" };
let angeheftet = [];
// ab 11-04a: false, wenn das letzte Speichern des Angehefteten scheiterte – die Trefferliste sagt das dann (vorher stiller Erfolg,
// obwohl die Karte „bleiben auf diesem Gerät gespeichert“ verspricht)
let angeheftetSpeicherOk = true;

function kurzPruefsumme(text) { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0; return h.toString(36); }
function verlaufEintragSchluessel(n) { return n.zeit + "|" + n.art + "|" + kurzPruefsumme(n.text); }

function angeheftetLaden() {
  let roh = [];
  try { roh = speicherJsonLesen(ANGEHEFTET.schluessel, Array.isArray) || []; } catch (e) { roh = []; }
  angeheftet = (Array.isArray(roh) ? roh : []).filter((n) => n && typeof n.text === "string" && VERLAUF_ART_TEXT[n.art] && !isNaN(Date.parse(n.zeit)))
    .slice(0, ANGEHEFTET.max).map((n) => ({ art: n.art, text: verlaufBereinigen(n.text).slice(0, ANGEHEFTET.maxText), zeit: n.zeit }));
  angeheftetSpeicherOk = !speicherBeschaedigt(ANGEHEFTET.schluessel); // frisch geladen = gespeicherter Stand (ab 11-06b: außer beschädigt)
}
function angeheftetSpeichern() {
  if (speicherBeschaedigt(ANGEHEFTET.schluessel)) return false;
  try {
    if (angeheftet.length) localStorage.setItem(ANGEHEFTET.schluessel, JSON.stringify(angeheftet));
    else localStorage.removeItem(ANGEHEFTET.schluessel);
    return true;
  } catch (e) { return false; }
}
const istAngeheftet = (n) => angeheftet.some((a) => verlaufEintragSchluessel(a) === verlaufEintragSchluessel(n));

// Alle durchsuchbaren Nachrichten: angezeigte + angeheftete (ohne Doppelte), älteste zuerst
function verlaufQuellen() {
  const sichtbar = verlaufNachrichten().filter((n) => n.zeit);
  const alle = [...sichtbar];
  for (const a of angeheftet) if (!alle.some((n) => verlaufEintragSchluessel(n) === verlaufEintragSchluessel(a))) alle.push(a);
  return alle.map((n) => ({ ...n, schluessel: verlaufEintragSchluessel(n), angeheftet: istAngeheftet(n), angezeigt: sichtbar.includes(n) }))
    .sort((a, b) => a.zeit.localeCompare(b.zeit));
}

const suchNormal = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
function lokalesDatum(zeit) { const d = new Date(zeit); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

// filter: { text, von, bis (JJJJ-MM-TT, Ortszeit, jeweils einschließlich), nurAngeheftet }
function verlaufSuchen(filter = {}) {
  const begriffe = suchNormal(filter.text).split(/\s+/).filter(Boolean);
  return verlaufQuellen().filter((n) => {
    if (filter.nurAngeheftet && !n.angeheftet) return false;
    const tag = lokalesDatum(n.zeit);
    if (filter.von && tag < filter.von) return false;
    if (filter.bis && tag > filter.bis) return false;
    const text = suchNormal(n.text);
    return begriffe.every((b) => text.includes(b));
  });
}

function verlaufAnheften(n) {
  if (istAngeheftet(n)) return true;
  if (angeheftet.length >= ANGEHEFTET.max) return false;
  angeheftet.push({ art: n.art, text: verlaufBereinigen(n.text).slice(0, ANGEHEFTET.maxText), zeit: n.zeit });
  angeheftet.sort((a, b) => a.zeit.localeCompare(b.zeit));
  angeheftetSpeicherOk = angeheftetSpeichern();
  verlaufTrefferAnzeigen();
  return true;
}
function verlaufLoesen(schluessel) {
  const vorher = angeheftet.length;
  angeheftet = angeheftet.filter((a) => verlaufEintragSchluessel(a) !== schluessel);
  angeheftetSpeicherOk = angeheftetSpeichern();
  verlaufTrefferAnzeigen();
  return angeheftet.length < vorher;
}

// Springt zur Nachricht im Gesprächsverlauf und hebt sie kurz hervor
function verlaufZeigen(schluessel) {
  const el = [...document.querySelectorAll("#chatverlauf .nachricht")].find((e) => {
    const art = e.classList.contains("nutzer") ? "nutzer" : e.classList.contains("fehler") ? "fehler" : "jarvis";
    const text = verlaufBereinigen([...e.childNodes].filter((k) => k.nodeType === 3).map((k) => k.textContent).join(""));
    return verlaufEintragSchluessel({ zeit: e.dataset.zeit || "", art, text }) === schluessel;
  });
  if (!el) return false;
  if (el.scrollIntoView) el.scrollIntoView({ block: "center" });
  el.classList.add("hervorgehoben");
  setTimeout(() => el.classList.remove("hervorgehoben"), 2500);
  return true;
}

function verlaufFilterLesen() {
  return {
    text: document.getElementById("verlauf-suchtext").value,
    von: document.getElementById("verlauf-von").value,
    bis: document.getElementById("verlauf-bis").value,
    nurAngeheftet: document.getElementById("verlauf-nur-angeheftet").checked,
  };
}

function verlaufTrefferAnzeigen() {
  if (document.getElementById("verlauf-suche").hidden) return;
  const filter = verlaufFilterLesen();
  const info = document.getElementById("verlauf-treffer-info");
  if (filter.von && filter.bis && filter.von > filter.bis) {
    info.textContent = "„von“ liegt nach „bis“ – bitte den Zeitraum prüfen.";
    document.getElementById("verlauf-treffer").replaceChildren();
    return;
  }
  const treffer = verlaufSuchen(filter);
  const gefiltert = filter.text.trim() || filter.von || filter.bis || filter.nurAngeheftet;
  info.textContent = (treffer.length ? treffer.length + (treffer.length === 1 ? " Nachricht" : " Nachrichten") : "Keine Nachricht")
    + (gefiltert ? " passt zum Filter." : " im Verlauf.") + " Angeheftet: " + angeheftet.length + "."
    + (angeheftetSpeicherOk ? "" : speicherBeschaedigt(ANGEHEFTET.schluessel) ? " Angeheftetes: " + SPEICHER_SCHADEN_TEXT : " Nicht gespeichert: Browserspeicher gesperrt oder voll – die letzte Änderung am Angehefteten gilt nur bis zum Neuladen.")
    // ab 11-04l: die Liste zeigt höchstens die neuesten 200 Treffer – das wird jetzt gesagt
    + (treffer.length > 200 ? " Angezeigt: die neuesten 200." : "");
  const zeitText = (z) => new Date(z).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  document.getElementById("verlauf-treffer").replaceChildren(...treffer.slice(-200).reverse().map((n) => {
    const li = document.createElement("li");
    li.dataset.schluessel = n.schluessel;
    if (n.angeheftet) li.className = "angeheftet";
    const voll = verlaufAnzeigeText(n.text).replace(/^JARVIS: /, "");
    const text = Object.assign(document.createElement("span"), { className: "aufgabe-text", textContent: VERLAUF_ART_TEXT[n.art] + ": " + voll.slice(0, 300) + (voll.length > 300 ? " …" : "") });
    const stand = Object.assign(document.createElement("span"), { className: "aufgabe-faellig", textContent: zeitText(n.zeit) + (n.angezeigt ? "" : " · nur angeheftet") });
    const knopf = (beschriftung, aktion) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "schalter", textContent: beschriftung });
      b.setAttribute("aria-label", beschriftung + ": " + verlaufAnzeigeText(n.text).slice(0, 60));
      b.addEventListener("click", aktion);
      return b;
    };
    li.append(text, stand);
    if (n.angezeigt) li.append(knopf("Anzeigen", () => verlaufZeigen(n.schluessel)));
    li.append(n.angeheftet ? knopf("Lösen", () => verlaufLoesen(n.schluessel)) : knopf("Anheften", () => {
      if (!verlaufAnheften(n)) info.textContent = "Höchstens " + ANGEHEFTET.max + " angeheftete Nachrichten – bitte zuerst welche lösen.";
    }));
    return li;
  }));
}

document.getElementById("verlauf-suchen").addEventListener("click", (e) => {
  const suche = document.getElementById("verlauf-suche");
  suche.hidden = !suche.hidden;
  e.target.setAttribute("aria-expanded", String(!suche.hidden));
  if (!suche.hidden) { verlaufTrefferAnzeigen(); document.getElementById("verlauf-suchtext").focus(); }
});
for (const id of ["verlauf-suchtext", "verlauf-von", "verlauf-bis", "verlauf-nur-angeheftet"]) {
  document.getElementById(id).addEventListener(id === "verlauf-nur-angeheftet" ? "change" : "input", verlaufTrefferAnzeigen);
}
document.getElementById("verlauf-von").addEventListener("change", verlaufTrefferAnzeigen);
document.getElementById("verlauf-bis").addEventListener("change", verlaufTrefferAnzeigen);
document.getElementById("verlauf-filter-zuruecksetzen").addEventListener("click", () => {
  for (const id of ["verlauf-suchtext", "verlauf-von", "verlauf-bis"]) document.getElementById(id).value = "";
  document.getElementById("verlauf-nur-angeheftet").checked = false;
  verlaufTrefferAnzeigen();
});
// Neue oder gelöschte Nachrichten: offene Trefferliste mitführen
new MutationObserver(() => verlaufTrefferAnzeigen()).observe(document.getElementById("chatverlauf"), { childList: true });
angeheftetLaden();
window.verlaufIntern = { suchen: verlaufSuchen, quellen: verlaufQuellen, anheften: verlaufAnheften, loesen: verlaufLoesen, zeigen: verlaufZeigen,
  angeheftet: () => angeheftet.slice(), laden: angeheftetLaden, anzeigen: verlaufTrefferAnzeigen, ANGEHEFTET };

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("verlauf");
