// JARVIS Dashboard – Modul „kern-kugel“. Ab 11-06g aus index.html ausgelagert, Inhalt unverändert.
// Klassisches Skript im gemeinsamen globalen Bereich; Ladereihenfolge wie in index.html (siehe docs/ARCHITEKTUR_06G.md).

// ---------- Kern: Drahtgitterkugel mit Partikelhülle (Canvas) ----------
// Reine Darstellung echter Zustände: Farbe = KI-Verbindung, unruhiger = JARVIS denkt, pulsierend = JARVIS liest vor.
(function () {
  const huelle = document.getElementById("kern");
  const leinwand = document.getElementById("kern-leinwand");
  const ctx = leinwand.getContext("2d");
  const wenigBewegung = window.matchMedia("(prefers-reduced-motion: reduce)");
  const FARBEN = {
    offline: [80, 170, 195],
    pruefe: [255, 204, 102],
    warnung: [255, 204, 102],
    verbunden: [0, 234, 255],
    fehler: [255, 107, 107],
  };

  // Gleichmäßig verteilte Kugelpunkte (Fibonacci-Kugel), jeweils mit den drei nächsten Nachbarn verbunden
  const KUGEL = [];
  const ANZAHL = 110;
  for (let i = 0; i < ANZAHL; i++) {
    const y = 1 - (2 * (i + 0.5)) / ANZAHL;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    KUGEL.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
  }
  const KANTEN = [];
  const bekannt = new Set();
  KUGEL.forEach((p, i) => {
    KUGEL.map((q, j) => [j, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2])
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .forEach(([j]) => {
        const schluessel = Math.min(i, j) + "-" + Math.max(i, j);
        if (!bekannt.has(schluessel)) { bekannt.add(schluessel); KANTEN.push([i, j]); }
      });
  });
  // Partikelhülle um die Kugel
  const PARTIKEL = Array.from({ length: 320 }, () => {
    const u = Math.random() * 2 - 1;
    const w = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const radius = 1.18 + Math.random() * 0.42;
    return { p: [Math.cos(w) * s * radius, u * radius, Math.sin(w) * s * radius], groesse: 0.6 + Math.random() * 1.2, phase: Math.random() * Math.PI * 2 };
  });
  const STRAHLEN = Array.from({ length: 16 }, (_, i) => ({
    winkel: (i / 16) * Math.PI * 2 + Math.random() * 0.3,
    laenge: 0.6 + Math.random() * 0.5,
    phase: Math.random() * Math.PI * 2,
  }));

  const aktuell = { farbe: FARBEN.offline.slice(), tempo: 0.12, glanz: 0.55, strahlen: 0, unruhe: 0 };
  let winkel = 0;
  let zeit = 0;
  let zuletzt = 0;
  let breite = 0;

  function ziel() {
    const zustand = huelle.dataset.zustand || "offline";
    const aus = zustand === "offline";
    const t = { farbe: FARBEN[zustand] || FARBEN.offline, tempo: aus ? 0.12 : 0.35, glanz: aus ? 0.55 : 1, strahlen: aus ? 0 : 0.18, unruhe: 0 };
    // Zuhören: nur solange die Spracherkennung wirklich läuft (Klasse setzt die Spracheingabe)
    if (huelle.classList.contains("hoert")) Object.assign(t, { tempo: 0.5, strahlen: 0.35, unruhe: 0.45, glanz: 0.95 + 0.15 * Math.sin(zeit * 4) });
    if (huelle.classList.contains("denkt")) Object.assign(t, { tempo: 1.3, strahlen: 0.85, unruhe: 1, glanz: 1.15 });
    if (huelle.classList.contains("spricht")) Object.assign(t, { tempo: 0.6, strahlen: 0.65, glanz: 1.05 + 0.3 * Math.sin(zeit * 9) });
    return t;
  }
  const naeher = (a, b, f) => a + (b - a) * f;

  function groesseAnpassen() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    breite = huelle.clientWidth;
    leinwand.width = Math.round(breite * dpr);
    leinwand.height = Math.round(breite * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function zeichnen() {
    const S = breite;
    if (!S) return;
    const m = S / 2;
    const R = S * 0.3;
    const [r, g, b] = aktuell.farbe.map(Math.round);
    const farbe = (a) => `rgba(${r},${g},${b},${a})`;
    ctx.clearRect(0, 0, S, S);
    ctx.globalCompositeOperation = "lighter";

    // Drehung um die senkrechte Achse, leicht nach vorn gekippt
    const cos = Math.cos(winkel), sin = Math.sin(winkel), ck = Math.cos(0.38), sk = Math.sin(0.38);
    const projektion = (p, f = 1) => {
      const x = p[0] * cos - p[2] * sin;
      const z = p[0] * sin + p[2] * cos;
      return [m + x * R * f, m + (p[1] * ck - z * sk) * R * f, p[1] * sk + z * ck];
    };

    // Leuchten im Zentrum
    const glanz = aktuell.glanz;
    const verlauf = ctx.createRadialGradient(m, m, 0, m, m, R * 1.25);
    verlauf.addColorStop(0, farbe(Math.min(1, 1 * glanz)));
    verlauf.addColorStop(0.22, farbe(0.75 * glanz));
    verlauf.addColorStop(0.6, farbe(0.22 * glanz));
    verlauf.addColorStop(1, farbe(0));
    ctx.fillStyle = verlauf;
    ctx.beginPath();
    ctx.arc(m, m, R * 1.25, 0, Math.PI * 2);
    ctx.fill();

    // Strahlen (nur wenn JARVIS denkt oder spricht deutlich sichtbar)
    if (aktuell.strahlen > 0.01) {
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = farbe(0.5 * aktuell.strahlen);
      for (const s of STRAHLEN) {
        const laenge = R * (0.4 + s.laenge * (0.8 + 0.4 * Math.sin(zeit * 2 + s.phase))) * (0.6 + aktuell.strahlen) * 1.9;
        const a = s.winkel + winkel * 0.3;
        ctx.beginPath();
        ctx.moveTo(m + Math.cos(a) * R * 0.15, m + Math.sin(a) * R * 0.15);
        ctx.lineTo(m + Math.cos(a) * laenge, m + Math.sin(a) * laenge);
        ctx.stroke();
      }
    }

    // Drahtgitterkugel, vordere Linien heller als hintere
    const punkte = KUGEL.map((p) => projektion(p));
    ctx.lineWidth = 1.1;
    for (const [i, j] of KANTEN) {
      const tiefe = (punkte[i][2] + punkte[j][2] + 2) / 4;
      ctx.strokeStyle = farbe(0.2 + 0.65 * tiefe);
      ctx.beginPath();
      ctx.moveTo(punkte[i][0], punkte[i][1]);
      ctx.lineTo(punkte[j][0], punkte[j][1]);
      ctx.stroke();
    }

    // Zwei schräge Umlaufbahnen
    ctx.lineWidth = 2;
    ctx.strokeStyle = farbe(0.55);
    for (const [neigung, drehung, rx] of [[1.15, winkel * 0.6, 1.55], [-0.9, -winkel * 0.45 + 1.2, 1.4]]) {
      ctx.save();
      ctx.translate(m, m);
      ctx.rotate(drehung * 0.25 + neigung);
      ctx.beginPath();
      ctx.ellipse(0, 0, R * rx, R * rx * 0.32, 0, 0.2, Math.PI * 1.6);
      ctx.stroke();
      ctx.restore();
    }

    // Partikelhülle
    for (const t of PARTIKEL) {
      const wackeln = 1 + 0.06 * aktuell.unruhe * Math.sin(zeit * 6 + t.phase);
      const [x, y, z] = projektion(t.p, wackeln);
      ctx.fillStyle = farbe(0.4 + 0.6 * ((z + 1.6) / 3.2));
      ctx.fillRect(x, y, t.groesse * 1.3, t.groesse * 1.3);
    }

    // Äußerer Ring mit drei Segmenten und Knotenpunkten
    const ring = S * 0.47;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = farbe(0.4);
    ctx.beginPath();
    ctx.arc(m, m, ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = farbe(0.95);
    ctx.fillStyle = farbe(1);
    for (let i = 0; i < 3; i++) {
      const start = -winkel * 0.5 + i * (Math.PI * 2 / 3);
      ctx.beginPath();
      ctx.arc(m, m, ring - 5, start, start + 0.9);
      ctx.stroke();
      ctx.fillRect(m + Math.cos(start + 0.9) * (ring - 5) - 3, m + Math.sin(start + 0.9) * (ring - 5) - 3, 6, 6);
    }

    // Heller Mittelpunkt mit Lichthof
    ctx.shadowColor = farbe(0.9);
    ctx.shadowBlur = R * 0.5 * glanz;
    ctx.fillStyle = `rgba(235,255,255,${Math.min(1, 0.7 + 0.3 * glanz)})`;
    ctx.beginPath();
    ctx.arc(m, m, R * (0.09 + 0.05 * glanz), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
  }

  function schritt(jetzt) {
    requestAnimationFrame(schritt);
    // Nichts rechnen, wenn der Kern nicht zu sehen ist oder Bewegung reduziert werden soll
    if (wenigBewegung.matches || document.hidden || huelle.offsetParent === null) { zuletzt = jetzt; return; }
    const dt = Math.min(0.05, (jetzt - zuletzt) / 1000 || 0);
    zuletzt = jetzt;
    zeit += dt;
    const t = ziel();
    const f = Math.min(1, dt * 3);
    aktuell.farbe = aktuell.farbe.map((v, i) => naeher(v, t.farbe[i], f));
    for (const k of ["tempo", "glanz", "strahlen", "unruhe"]) aktuell[k] = naeher(aktuell[k], t[k], f);
    winkel += dt * aktuell.tempo;
    zeichnen();
  }

  // Bei reduzierter Bewegung nur ein ruhendes Bild, neu gezeichnet bei jedem Zustandswechsel
  function standbild() {
    if (!wenigBewegung.matches) return;
    const t = ziel();
    Object.assign(aktuell, t, { farbe: t.farbe.slice() });
    zeichnen();
  }
  new ResizeObserver(() => { groesseAnpassen(); standbild(); zeichnen(); }).observe(huelle);
  new MutationObserver(standbild).observe(huelle, { attributes: true, attributeFilter: ["data-zustand", "class"] });
  wenigBewegung.addEventListener("change", standbild);
  groesseAnpassen();
  standbild();
  requestAnimationFrame(schritt);
})();

// ---------- Umlaufbahn: Module gleichmäßig um den Kern verteilen und per Leitung mit dem Ring verbinden ----------
// Erweiterbar: Jeder <button class="aktion"> in .kern-aktionen wird automatisch eingeplant – abwechselnd rechts
// und links, von oben nach unten, im Bogen entlang des Rings. Reicht der Platz nicht, Raster unter dem Kern.
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const orbit = document.getElementById("orbit");
  const behaelter = orbit.querySelector(".kern-aktionen");
  const svg = document.getElementById("kern-verbindungen");
  const kern = document.getElementById("kern");
  const wenigBewegung = window.matchMedia("(prefers-reduced-motion: reduce)");
  const MODUL_BREITE = 204; // wie .kern-aktionen .aktion { width }
  const ABSTAND_MIN = 22;   // kleinster Abstand Ring → Modul (Platz für die Leitung)
  const ABSTAND_MAX = 72;
  const module = () => [...behaelter.querySelectorAll(".aktion")];

  function element(name, merkmale) {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(merkmale)) e.setAttribute(k, v);
    return e;
  }

  // Vom Element ein Stück waagerecht weg (Knick), dann auf direktem Weg zum Ring des Kerns
  function leitung(id, x, y, richtung, kreis, art) {
    const kx = x + richtung * 26;
    const winkel = Math.atan2(y - kreis.y, kx - kreis.x);
    const rx = kreis.x + Math.cos(winkel) * kreis.r;
    const ry = kreis.y + Math.sin(winkel) * kreis.r;
    const d = `M${x.toFixed(1)},${y.toFixed(1)} L${kx.toFixed(1)},${y.toFixed(1)} L${rx.toFixed(1)},${ry.toFixed(1)}`;
    svg.append(element("path", { d, class: "leitung-schein" }));
    svg.append(element("path", { d, id, class: "leitung " + art }));
    svg.append(element("circle", { cx: rx, cy: ry, r: 3.5, class: "anschluss" }));
    return d;
  }

  // Lichtpunkt, der entlang der Leitung zum Kern wandert
  function signal(id, klasse, dauer, beginn, wiederholen) {
    const punkt = element("circle", { r: klasse === "impuls" ? 4 : 2.6, class: klasse });
    const bewegung = element("animateMotion", { dur: dauer, begin: beginn, repeatCount: wiederholen, fill: "freeze" });
    bewegung.append(element("mpath", { href: "#" + id }));
    punkt.append(bewegung);
    svg.append(punkt);
    return punkt;
  }

  // Plätze berechnen. Ergebnis null = nicht genug Platz (dann Raster unter dem Kern).
  function plaetze(liste, breite, kreis, hoehe) {
    const ergebnis = [];
    const seiten = [liste.filter((_, i) => i % 2 === 0), liste.filter((_, i) => i % 2 === 1)];
    for (const [s, seite] of seiten.entries()) {
      const n = seite.length;
      // Senkrecht über rund zwei Drittel des Rings verteilt, mindestens Modulhöhe + 12 px auseinander
      const schritt = n > 1 ? Math.max(hoehe + 12, (kreis.r * 2 * 0.66) / (n - 1)) : 0;
      if (schritt * (n - 1) + hoehe > kreis.r * 2.2) return { grund: "zu viele Module für die Höhe" };
      for (const [j, modul] of seite.entries()) {
        const y = kreis.y + (j - (n - 1) / 2) * schritt;
        // Waagerechter Abstand folgt der Rundung des Rings: oben und unten näher, in der Mitte weiter außen
        const ringX = Math.sqrt(Math.max(0, kreis.r ** 2 - (y - kreis.y) ** 2));
        const frei = (s === 0 ? breite - kreis.x : kreis.x) - ringX - MODUL_BREITE;
        if (frei < ABSTAND_MIN) return { grund: `zu wenig Breite (frei ${Math.round(frei)} px)` };
        const abstand = Math.min(ABSTAND_MAX, frei);
        const x = s === 0 ? kreis.x + ringX + abstand : kreis.x - ringX - abstand - MODUL_BREITE;
        ergebnis.push({ modul, x, y, links: s === 1 });
      }
    }
    return { plaetze: ergebnis };
  }

  // Ergebnis: "umlaufbahn" oder der Grund für das Raster (hilft bei der Fehlersuche und in den Tests)
  function anordnen() {
    const liste = module();
    // Große Browser-Schrift (ab 11-02o): Kern-Karte umordnen (CSS .schrift-gross), die Schriftgröße selbst bleibt
    document.documentElement.classList.toggle("schrift-gross", parseFloat(getComputedStyle(document.documentElement).fontSize) >= 18);
    svg.replaceChildren();
    if (kern.offsetParent === null || !liste.length) return "nicht sichtbar";
    const o = orbit.getBoundingClientRect();
    const k = kern.getBoundingClientRect();
    const kreis = { x: k.left - o.left + k.width / 2, y: k.top - o.top + k.height / 2, r: k.width * 0.47 };
    const hoehe = Math.max(58, ...liste.map((m) => m.offsetHeight));
    const { plaetze: verteilung, grund } = plaetze(liste, o.width, kreis, hoehe);

    orbit.classList.toggle("kompakt", !verteilung);
    if (!verteilung) {
      for (const m of liste) {
        m.style.removeProperty("--x");
        m.style.removeProperty("--y");
        m.classList.remove("links");
        delete m.dataset.leitung;
      }
      return grund;
    }

    verteilung.forEach((p, i) => {
      const id = "leitung-modul-" + i;
      p.modul.style.setProperty("--x", p.x.toFixed(1) + "px");
      p.modul.style.setProperty("--y", (p.y - hoehe / 2).toFixed(1) + "px");
      p.modul.classList.toggle("links", p.links);
      p.modul.dataset.leitung = id;
      // Leitung beginnt an der dem Kern zugewandten Kante des Moduls
      const x = p.links ? p.x + MODUL_BREITE : p.x;
      leitung(id, x, p.y, p.links ? 1 : -1, kreis, "aktion-leitung");
      svg.append(element("rect", { x: x - 4, y: p.y - 4, width: 8, height: 8, class: "anschluss" }));
      // Negativer Start: alle Signale laufen sofort, nur zeitversetzt (kein wartender Punkt in der Ecke)
      if (!wenigBewegung.matches) signal(id, "puls", "3.2s", "-" + (i * 0.8).toFixed(1) + "s", "indefinite");
    });
    return "umlaufbahn";
  }

  // Hervorheben und Impuls per Ereignisdelegation – gilt automatisch auch für später ergänzte Module
  const pfadZu = (ziel) => {
    const modul = ziel instanceof Element ? ziel.closest(".aktion") : null;
    return modul && modul.dataset.leitung ? document.getElementById(modul.dataset.leitung) : null;
  };
  const hervorheben = (an) => (e) => {
    const modul = e.target.closest(".aktion");
    if (!modul || (e.relatedTarget instanceof Node && modul.contains(e.relatedTarget))) return;
    const pfad = pfadZu(modul);
    if (pfad) pfad.classList.toggle("hell", an);
  };
  behaelter.addEventListener("pointerover", hervorheben(true));
  behaelter.addEventListener("pointerout", hervorheben(false));
  behaelter.addEventListener("focusin", hervorheben(true));
  behaelter.addEventListener("focusout", hervorheben(false));
  // Klick: ein heller Impuls läuft zum Kern
  behaelter.addEventListener("click", (e) => {
    const pfad = pfadZu(e.target);
    if (wenigBewegung.matches || !pfad) return;
    const impuls = signal(pfad.id, "impuls", "0.6s", "indefinite", "1");
    impuls.setAttribute("visibility", "hidden");
    impuls.querySelector("animateMotion").beginElement();
    requestAnimationFrame(() => impuls.removeAttribute("visibility"));
    setTimeout(() => impuls.remove(), 650);
  });

  const beobachter = new ResizeObserver(anordnen);
  beobachter.observe(orbit);
  beobachter.observe(kern);
  // Wächst nur die Browser-Schrift, ändert sich die Umlaufbahn nicht immer – die Statusleiste (in rem) aber schon
  beobachter.observe(document.querySelector(".kern-knoten"));
  window.addEventListener("load", anordnen);
  window.addEventListener("resize", () => requestAnimationFrame(anordnen));
  wenigBewegung.addEventListener("change", anordnen);
  window.moduleAnordnen = anordnen;
  anordnen();
})();

// ---------- Kursverlauf-Kachel (echte Kerzen aus der Marktanalyse, keine eigene Anfrage) ----------
window.addEventListener("jarvis-kerzen", (e) => {
  const feld = document.getElementById("mini-chart");
  const d = e.detail;
  if (!d || !Array.isArray(d.kerzen) || d.kerzen.length < 2) {
    feld.hidden = true;
    return;
  }
  const k = d.kerzen.slice(-48);
  const werte = k.map((x) => x.c);
  const min = Math.min(...werte);
  const spanne = Math.max(...werte) - min || 1;
  const punkte = werte.map((w, i) => (i / (werte.length - 1) * 300).toFixed(1) + "," + (64 - (w - min) / spanne * 58).toFixed(1));
  document.getElementById("mini-linie").setAttribute("points", punkte.join(" "));
  document.getElementById("mini-flaeche").setAttribute("points", "0,70 " + punkte.join(" ") + " 300,70");
  const aenderung = (werte[werte.length - 1] - werte[0]) / werte[0] * 100;
  document.getElementById("mini-text").textContent = d.symbol + " · " + d.intervall + " · letzte " + k.length + " Kerzen · "
    + (aenderung >= 0 ? "+" : "") + aenderung.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " % · echte Marktdaten ("
    + (d.quelle_name || d.quelle) + ")";
  feld.hidden = false;
});

// ---------- Schnellzugriff ----------
function verbindungOeffnen() {
  ansichtZeigen("cockpit");
  const karte = document.getElementById("verbindung-karte");
  karte.open = true;
  karte.scrollIntoView({ block: "nearest" });
  document.getElementById("worker-url").focus();
}

function allesAktualisieren() {
  if (!verbunden()) {
    verbindungOeffnen();
    return;
  }
  verbindungPruefen();
  tradingLaden();
  if (window.analyseLaden) analyseLaden({ erzwingen: true });
}

// ---------- Bereiche (Cockpit, Analyse, Trading) ----------
const ANSICHTEN = ["cockpit", "analyse", "trading"];

function ansichtZeigen(name) {
  if (!ANSICHTEN.includes(name)) name = "cockpit";
  // ab 11-05a: außerhalb des Cockpits ist keine Spracheingabe sichtbar – laufende Aufnahme abbrechen (siehe spracheingabeAbbrechen)
  if (name !== "cockpit" && window.spracheingabeAbbrechen) spracheingabeAbbrechen("reiter");
  for (const a of ANSICHTEN) {
    const aktiv = a === name;
    document.getElementById("ansicht-" + a).hidden = !aktiv;
    const reiter = document.getElementById("reiter-" + a);
    reiter.setAttribute("aria-selected", String(aktiv));
    reiter.tabIndex = aktiv ? 0 : -1;
  }
  try { history.replaceState(null, "", "#" + name); } catch (e) { /* z. B. eingeschränkte Umgebung */ }
  // Beim Öffnen der Analyse nachladen; analyse.js nutzt dabei seinen Zwischenspeicher
  if (name === "analyse" && window.analyseLaden) analyseLaden();
  // Beim Öffnen des Cockpits die Module neu anordnen (Fenstergröße kann sich inzwischen geändert haben)
  if (name === "cockpit" && window.moduleAnordnen) requestAnimationFrame(moduleAnordnen);
  // ab 11-06j: Sprungleiste auf die Karten der neuen Ansicht umstellen (app/24-oberflaeche.js)
  if (window.sprungleisteAktualisieren) sprungleisteAktualisieren(name);
}

document.querySelectorAll(".reiter [role=tab]").forEach((reiter, i, alle) => {
  reiter.addEventListener("click", () => ansichtZeigen(reiter.dataset.ansicht));
  // Pfeiltasten wechseln zwischen den Reitern
  reiter.addEventListener("keydown", (event) => {
    const schritt = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!schritt) return;
    const ziel = alle[(i + schritt + alle.length) % alle.length];
    ansichtZeigen(ziel.dataset.ansicht);
    ziel.focus();
  });
});
window.addEventListener("hashchange", () => ansichtZeigen(location.hash.slice(1)));
ansichtZeigen(location.hash.slice(1));

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("kern-kugel");
