// JARVIS Dashboard – Modul „workflows3“ (ab 11-10k). Workflows 3.0 – ergänzt 44-workflows.js (Wenn, Freigabe, Warte, Versuche,
// Schrittansicht, Vorlagen, Testmodus, Fortschritt, Historie, Diagnose, Pause, Abbruch, Wiederaufnahme, Export/Import, Versionen,
// Vergleich, Ablehnung unbekannter Schrittarten und unerlaubter Werkzeuge gibt es dort schon):
//   - verneinte Bedingungen „Wenn nicht <Bedingung>: …“ und neue Bedingungen (Aufgaben heute fällig, Vorschläge offen, Projekt blockiert)
//   - Sonst-Zweig „Sonst: <Befehl>“ – läuft nur, wenn der direkt davor stehende Wenn-Schritt übersprungen wurde;
//     „Sonst“ ohne direkt vorangehendes „Wenn“ wird beim Speichern abgelehnt
//   - Widerspruchsprüfung: „Wenn X“ gefolgt von „Wenn nicht X“ mit demselben Befehl (läuft immer), doppelte Bedingungen,
//     Sonst mit demselben Befehl wie das Wenn (Bedingung wirkungslos) – als Hinweis in der Schrittansicht
// Kein eigener Speicher; die Schritte bleiben Textzeilen (Export/Import und ältere Stände gelten weiter).
const WF3_NEU = {
  "aufgaben heute fällig": { text: "heute Aufgaben fällig sind", pruefe: () => Boolean(window.aufgabenIntern && window.aufgabenIntern.liste().some((a) => !a.erledigt && a.faellig && new Date(a.faellig).toDateString() === new Date().toDateString())) },
  "vorschläge offen": { text: "Vorschläge von JARVIS offen sind", pruefe: () => { if (typeof vorsKandidaten !== "function") return false; const s = vorsLesen(), jetzt = Date.now(); return vorsKandidaten(jetzt).some((v) => { const z = s.zustand[v.key]; return !s.einstellungen.aus.includes(v.art) && !(z && (z.zustand === "abgelehnt" || z.zustand === "bestaetigt" || (z.zustand === "ausgeblendet" && jetzt < z.bis))); }); } }, // ohne Nebenwirkung (vorschlaegeErmitteln würde „gezeigt“ speichern)
  "projekt blockiert": { text: "in einem Projekt etwas blockiert ist", pruefe: () => typeof projekteBlockiert === "function" && projekteBlockiert().length > 0 },
};
Object.assign(WF_BEDINGUNGEN, WF3_NEU);
for (const [k, b] of Object.entries({ ...WF_BEDINGUNGEN })) if (!k.startsWith("nicht ")) WF_BEDINGUNGEN["nicht " + k] = { text: "nicht " + b.text.replace(/ (sind|ist)$/, "") + " (verneint)", pruefe: () => !b.pruefe() };
WF_SYMBOL.sonst = "↪";
if (typeof wfSchrittZerlegen === "function") {
  const original = wfSchrittZerlegen;
  wfSchrittZerlegen = function (text) {
    const m = /^sonst\s*:\s*(.+)$/i.exec(String(text || "").trim());
    if (m) return { art: "sonst", befehl: m[1].trim() };
    if (/^sonst\b/i.test(String(text || "").trim())) return { fehler: "unvollständiger Sonst-Schritt (so: „Sonst: <Befehl>“)" };
    return original(text);
  };
}
// läuft gerade ein Sonst-Schritt, dessen Wenn-Schritt davor übersprungen wurde?
function wf3VorigerUebersprungen() {
  const l = typeof routineLauf !== "undefined" ? routineLauf : null;
  if (!l) return false;
  const i = l.status.indexOf("laeuft");
  return i > 0 && wfSchrittZerlegen(l.routine.schritte[i - 1]).art === "wenn" && String(l.gruende[i - 1] || "").includes("Bedingung nicht erfüllt");
}
if (typeof routinenSchrittPruefen === "function") {
  const original = routinenSchrittPruefen;
  routinenSchrittPruefen = function (befehl) {
    const z = wfSchrittZerlegen(befehl);
    if (z.art !== "sonst") return original(befehl);
    const innen = original(z.befehl);
    if (innen.fehler) return { fehler: "innerer Befehl „" + z.befehl + "“: " + innen.fehler };
    if (wfSchrittZerlegen(z.befehl).art !== "befehl") return { fehler: "im Sonst-Zweig nur ein einfacher Befehl" };
    return { skill: { name: "workflow-sonst", risiko: innen.skill.risiko, braucht: innen.skill.braucht, beschreibung: `sonst (wenn der Wenn-Schritt davor übersprungen wurde): ${innen.skill.beschreibung}`,
      aktion: async () => { if (!wf3VorigerUebersprungen()) { wfGrund(befehl, "übersprungen – der Wenn-Schritt davor ist gelaufen"); return true; } return innen.skill.aktion(z.befehl); } } };
  };
}
// Strukturprüfung (Fehler) und Widerspruchsprüfung (Hinweise)
function wf3Struktur(schritte) {
  const z = schritte.map((s) => wfSchrittZerlegen(s)), fehler = [];
  z.forEach((x, i) => { if (x.art === "sonst" && (i === 0 || z[i - 1].art !== "wenn")) fehler.push(`Schritt ${i + 1} „${schritte[i]}“: „Sonst“ muss direkt auf einen Wenn-Schritt folgen.`); });
  return fehler;
}
function wf3Widersprueche(schritte) {
  const z = schritte.map((s) => wfSchrittZerlegen(s)), h = [], basis = (b) => b.replace(/^nicht /, "");
  for (let i = 1; i < z.length; i++) {
    const a = z[i - 1], b = z[i];
    if (a.art !== "wenn") continue;
    if (b.art === "wenn" && basis(a.bedingung) === basis(b.bedingung) && a.bedingung !== b.bedingung && a.befehl.toLowerCase() === b.befehl.toLowerCase()) h.push(`Schritte ${i}–${i + 1}: „${a.bedingung}“ und „${b.bedingung}“ mit demselben Befehl – läuft immer, die Bedingung ist überflüssig.`);
    else if (b.art === "wenn" && a.bedingung === b.bedingung && a.befehl.toLowerCase() === b.befehl.toLowerCase()) h.push(`Schritte ${i}–${i + 1}: derselbe bedingte Schritt doppelt.`);
    else if (b.art === "sonst" && a.befehl.toLowerCase() === b.befehl.toLowerCase()) h.push(`Schritte ${i}–${i + 1}: Wenn und Sonst führen denselben Befehl aus – die Bedingung wirkt nicht.`);
  }
  const wochen = z.filter((x) => x.art === "wenn").map((x) => x.bedingung);
  if (wochen.includes("werktags") && wochen.includes("wochenende") && z.filter((x) => x.art === "wenn").length === 2 && z.length === 2) h.push("Der Workflow besteht nur aus einem Werktags- und einem Wochenend-Schritt – an jedem Tag läuft genau einer.");
  return h;
}
if (typeof routinePruefen === "function") {
  const original = routinePruefen;
  routinePruefen = function (name, schritte) { return [...original(name, schritte), ...wf3Struktur(schritte)]; };
}
if (typeof wfSchrittAnsicht === "function") {
  const original = wfSchrittAnsicht;
  wfSchrittAnsicht = function () {
    const r = original(), box = document.getElementById("routine-schrittansicht"), feld = document.getElementById("routine-schritte");
    if (box && feld) { const s = schritteAusText(feld.value); box.append(...[...wf3Struktur(s), ...wf3Widersprueche(s).map((x) => "Hinweis: " + x)].map((t) => Object.assign(document.createElement("li"), { className: "wz-wichtig", textContent: t }))); }
    return r;
  };
}
WF_VORLAGEN.verzweigung = { name: "Tagesstart mit Verzweigung", schritte: ["Wenn aufgaben überfällig: Zeige meine Aufgaben", "Sonst: Was steht heute an", "Wenn projekt blockiert: Was ist blockiert?"] };
// Vorlagenauswahl neu füllen (44 hat sie beim Laden schon gefüllt)
(function wf3VorlagenAuswahl() { const s = document.getElementById("wf-vorlage"); if (s) s.replaceChildren(...Object.entries(WF_VORLAGEN).map(([k, v]) => Object.assign(document.createElement("option"), { value: k, textContent: v.name }))); })();

;(window.JARVIS_MODULE = window.JARVIS_MODULE || []).push("workflows3");
