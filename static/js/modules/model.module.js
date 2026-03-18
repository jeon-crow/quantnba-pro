
import { MW, sanitize } from './config.module.js';

export function logistic(x) { return 1 / (1 + Math.exp(-x)); }

export function ewma(arr) {
  const w = [.05, .10, .15, .25, .45];
  return arr.reduce((s, v, i) => s + v * (w[i] || 0), 0);
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function computeModelProb(g) {
  const F = {};

  const netDiff = g.netRating.home - g.netRating.away;
  F.netRating = {
    raw: netDiff, prob: logistic(netDiff * .18), w: MW.netRating,
    label: 'Net Rating \u0394', color: 'var(--green)',
    rawStr: (netDiff > 0 ? '+' : '') + netDiff.toFixed(1) + ' pts/100',
    desc: 'Season ORTG\u2212DRTG'
  };

  const hr = ewma(g.recency.home), ar = ewma(g.recency.away), recDiff = hr - ar;
  F.recency = {
    raw: recDiff, prob: logistic(recDiff * .15), w: MW.recency,
    label: 'Recency (5g EWMA)', color: 'var(--blue)',
    rawStr: (recDiff > 0 ? '+' : '') + recDiff.toFixed(1) + ' net rtg',
    desc: 'EWMA last-5-game form'
  };

  let injAdj = 0;
  (g.injuries || []).forEach(inj => {
    const mult = inj.status === 'OUT' ? 1.0 : .4;
    const dir = inj.team === g.away ? 1 : -1;
    injAdj += dir * inj.epm * .012 * mult;
  });
  F.injury = {
    raw: injAdj, prob: clamp(.5 + injAdj, .05, .95), w: MW.injury,
    label: 'Injury Adjustment', color: 'var(--red)',
    rawStr: (g.injuries || []).length
      ? (g.injuries || []).map(i => sanitize(i.name) + ' ' + i.status).join(', ')
      : 'Healthy',
    desc: 'EPM-weighted player absence impact'
  };

  const refAdj = (g.refPaceFast || 0) * .015 + (g.refFoulHigh || 0) * .01;
  F.referee = {
    raw: g.refPaceFast || 0, prob: clamp(.5 - refAdj * .3, .4, .6), w: MW.referee,
    label: 'Referee Tendencies', color: 'var(--cyan)',
    rawStr: g.refPaceFast ? 'Fast crew' : 'Normal crew',
    desc: 'Crew pace/foul tendency'
  };

  const homeAdj = (g.homeFlag || 0) * .025;
  F.home = {
    raw: homeAdj, prob: clamp(.5 + homeAdj, .3, .7), w: MW.home,
    label: 'Home Court', color: 'var(--amber)',
    rawStr: g.homeFlag === 1 ? 'Home +2.5%' : 'Away/Neutral',
    desc: 'Post-COVID home court premium'
  };

  const restDiff = Math.min(g.rest.home, 2) - Math.min(g.rest.away, 2);
  F.rest = {
    raw: restDiff, prob: clamp(.5 + restDiff * .022, .35, .65), w: MW.rest,
    label: 'Rest / B2B', color: 'var(--purple)',
    rawStr: `Home ${g.rest.home}d \u00B7 Away ${g.rest.away}d`,
    desc: 'Rest-day delta'
  };

  const timingAdj = (g.pmPriceMove || 0) * .4;
  const hrs = g.hoursToClose || 4;
  F.timing = {
    raw: g.pmPriceMove || 0, prob: clamp(.5 + timingAdj, .35, .65), w: MW.timing,
    label: 'Market Timing', color: '#9B6DFF',
    rawStr: (g.pmPriceMove >= 0 ? '+' : '') + Math.round((g.pmPriceMove || 0) * 100) +
            '\u00A2 \u00B7 ' + (hrs < 1 ? 'Live' : hrs < 3 ? 'Closing' : 'Open'),
    desc: 'PM price drift signal'
  };

  let raw = 0;
  Object.values(F).forEach(f => { raw += f.prob * f.w; });
  const finalProb = clamp(raw, .08, .92);

  const probs = Object.values(F).map(f => f.prob);
  const mean = probs.reduce((a, b) => a + b, 0) / probs.length;
  const variance = probs.reduce((s, p) => s + (p - mean) ** 2, 0) / probs.length;
  const confidence = Math.round(clamp(1 - variance * 8, 0, 1) * 100);

  return { finalProb, F, confidence };
}

export function americanToImpl(ml) {
  ml = parseFloat(ml);
  if (isNaN(ml)) return null;
  return ml > 0 ? 100 / (ml + 100) : Math.abs(ml) / (Math.abs(ml) + 100);
}
