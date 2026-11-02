// JARVIS Aktien – Exit-Planer (Stufe 2). Reine Rechnung ohne Netzwerk: legt für eine Position Stop, Kursziele, Nachzieh-Stop
// und Zeit-Stop fest und zeigt, welche Regel gerade greift. Er verkauft nie selbst; ein Verkaufsvorschlag geht den Weg der
// Stufe 1 (Risiko-Prüfung → Freigabe genau dieser Order). JARVIS-eigen (nicht im Trader-Skill).
//
// Regeln (einstellbar):
//   Stop        der höhere (nähere) von Einstand − stopPct % und Einstand − atrFaktor × ATR14
//   Risiko R    Einstand − Stop
//   Ziele       Einstand + 1 R (Hälfte verkaufen) und + 2 R (Rest); nach Ziel 1 rückt der Stop auf den Einstand
//   Nachziehen  ab Ziel 1: Stop mindestens Höchstkurs seit Einstieg − trailingPct %
//   Zeit-Stop   nach maxHaltetage Handelstagen ohne Ziel 1 → Ausstieg
// Verkäufe in Dollar (wie Stufe 1, Markt-Order, gültig heute). Ein Komplettverkauf rechnet 0,5 % Puffer ab, damit die Order bei
// leicht gestiegenem Kurs nicht mehr verlangt als vorhanden ist – ein kleiner Rest kann bleiben (Komplett-Schließen gibt es noch nicht).
(function (global) {
  "use strict";

  const STANDARD = { stopPct: 8, atrFaktor: 2, ziele: [{ r: 1, anteil: 50 }, { r: 2, anteil: 100 }], trailingPct: 10, maxHaltetage: 60, minOrderUsd: 5 };
  const HINWEIS = "Plan nach festen Regeln, keine Empfehlung. Verkäufe nur nach Risiko-Prüfung und deiner Freigabe genau dieser Order.";
  const PUFFER_KOMPLETT = 0.995;

  const r2 = (x) => Math.round(x * 100) / 100;

  // position: { symbol, einstand (je Aktie), menge, kurs, atr, hoechstkurs (seit Einstieg), tageGehalten, erledigteZiele: [r…] }
  function planen(position, regelnRoh = {}) {
    const regeln = { ...STANDARD, ...regelnRoh };
    const p = position || {};
    const fehlt = ["einstand", "menge", "kurs"].filter((k) => !(Number(p[k]) > 0));
    if (fehlt.length) return { fehler: "Angaben fehlen oder ungültig: " + fehlt.join(", ") };
    const einstand = Number(p.einstand), menge = Number(p.menge), kurs = Number(p.kurs);
    const hoechst = Math.max(Number(p.hoechstkurs) || 0, kurs, einstand);
    const hinweise = [];

    const stopProzent = einstand * (1 - regeln.stopPct / 100);
    const atr = Number(p.atr) > 0 ? Number(p.atr) : null;
    const stopAtr = atr !== null ? einstand - regeln.atrFaktor * atr : null;
    if (atr === null) hinweise.push("ATR fehlt – Stop nur prozentual.");
    let stop = stopAtr !== null && stopAtr > stopProzent ? stopAtr : stopProzent;
    const stopArt = stopAtr !== null && stopAtr > stopProzent ? `${regeln.atrFaktor} × ATR` : `${regeln.stopPct} %`;
    if (stop <= 0) stop = stopProzent;
    const risiko = einstand - stop;

    const erledigt = new Set((p.erledigteZiele || []).map(Number));
    const ziele = regeln.ziele.map((z) => ({ r: z.r, preis: r2(einstand + z.r * risiko), anteil: z.anteil, erledigt: erledigt.has(z.r) }));
    const ziel1Erreicht = ziele.length && (erledigt.has(ziele[0].r) || hoechst >= ziele[0].preis);
    let wirksamerStop = stop, stopGrund = `Anfangs-Stop (${stopArt})`;
    let nachzieh = null;
    if (ziel1Erreicht) {
      if (einstand > wirksamerStop) { wirksamerStop = einstand; stopGrund = "Stop auf Einstand (Ziel 1 erreicht)"; }
      nachzieh = hoechst * (1 - regeln.trailingPct / 100);
      if (nachzieh > wirksamerStop) { wirksamerStop = nachzieh; stopGrund = `Nachzieh-Stop (${regeln.trailingPct} % unter Höchstkurs ${r2(hoechst)})`; }
    }

    const aktionen = [];
    const verkauf = (anteilProzent, art, text) => {
      const komplett = anteilProzent >= 100;
      const betrag = Math.floor(menge * kurs * (anteilProzent / 100) * (komplett ? PUFFER_KOMPLETT : 1) * 100) / 100;
      const order = betrag >= regeln.minOrderUsd ? { symbol: String(p.symbol || "").toUpperCase(), side: "sell", notional: String(betrag), type: "market", time_in_force: "day" } : null;
      aktionen.push({ art, text, anteil: anteilProzent, order, ...(order ? {} : { hinweis: `Betrag ${betrag} USD unter der Mindestorder ${regeln.minOrderUsd} USD.` }) });
    };
    if (kurs <= wirksamerStop) {
      verkauf(100, "stop", `${stopGrund} bei ${r2(wirksamerStop)} erreicht (Kurs ${r2(kurs)}) – Position verkaufen.`);
    } else {
      let rest = 100;
      for (const z of ziele) {
        if (z.erledigt || kurs < z.preis) continue;
        const anteil = z.anteil >= 100 ? 100 : Math.min(z.anteil, rest);
        verkauf(anteil, "ziel", `Ziel ${z.r} R bei ${z.preis} erreicht (Kurs ${r2(kurs)}) – ${anteil >= 100 ? "Rest" : anteil + " %"} verkaufen.`);
        rest -= anteil;
        break; // je Prüfung höchstens eine Zielaktion; danach als erledigt markieren und neu planen
      }
      if (!aktionen.length && Number(p.tageGehalten) >= regeln.maxHaltetage && !ziel1Erreicht) {
        verkauf(100, "zeit", `Zeit-Stop: ${p.tageGehalten} Handelstage ohne Ziel 1 – Position verkaufen.`);
      }
    }

    return {
      symbol: String(p.symbol || "").toUpperCase(),
      einstand: r2(einstand),
      kurs: r2(kurs),
      stop: r2(stop),
      stopArt,
      risikoJeAktie: r2(risiko),
      wirksamerStop: r2(wirksamerStop),
      stopGrund,
      nachziehStop: nachzieh === null ? null : r2(nachzieh),
      ziele,
      zeitStopTage: regeln.maxHaltetage,
      abstandStopPct: r2((kurs / wirksamerStop - 1) * 100),
      aktionen,
      hinweise,
      hinweis: HINWEIS,
    };
  }

  global.AktienAusstieg = { planen, STANDARD, HINWEIS };
})(typeof window !== "undefined" ? window : globalThis);
