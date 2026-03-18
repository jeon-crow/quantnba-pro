
// ═══════════════════════════════════════
// CONFIG MODULE (ES Module version)
// ═══════════════════════════════════════

export const API = {
  bdl:        (endpoint) => `/api/bdl/${endpoint}`,
  pmMarkets:  () => '/api/pm/markets',
  pmMidpoint: (tid) => `/api/pm/midpoint/${tid}`,
  pmBook:     (tid) => `/api/pm/book/${tid}`,
  injuries:   () => '/api/injuries',
  odds:       () => '/api/odds',
  referees:   () => '/api/referees',
  status:     () => '/api/status',
  health:     () => '/api/health',
  mlPredict:  () => '/api/ml/predict',
  mlBatch:    () => '/api/ml/batch',
  mlInfo:     () => '/api/ml/info',
};

export const SECTIONS = [
  'dashboard','live','scanner','positions','alerts','calibration',
  'model','efficiency','players','injuries','referees','odds',
  'kelly','backtest','settings'
];

export let MW = JSON.parse(localStorage.getItem('modelWeights') || 'null') || {
  netRating: 0.35, recency: 0.20, injury: 0.15, referee: 0.05,
  home: 0.10, rest: 0.10, timing: 0.05
};

export function saveWeights() {
  localStorage.setItem('modelWeights', JSON.stringify(MW));
}

export function resetWeights() {
  Object.assign(MW, {
    netRating:0.35, recency:0.20, injury:0.15, referee:0.05,
    home:0.10, rest:0.10, timing:0.05
  });
  saveWeights();
}

export async function apiFetch(url, opts = {}, timeout = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

export function sanitize(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function setStatus(id, state, txt = '') {
  const el = document.getElementById('s' + id);
  const tel = document.getElementById('s' + id + 'T');
  if (el) el.className = 'anode ' + state;
  if (tel && txt) tel.textContent = txt;
}

export function setBadge(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'db ' + (state === 'live' ? 'db-live' : state === 'error' ? 'db-err' : 'db-demo');
  el.textContent = state === 'live' ? '\u25CF LIVE' : state === 'error' ? '! ERR' : 'DEMO';
}
