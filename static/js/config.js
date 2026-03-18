
// ═══════════════════════════════════════
// CONFIG — API routes point to OUR backend proxy
// ═══════════════════════════════════════
const API = {
  // All requests go through our Flask backend — no CORS issues, no key exposure
  bdl:       (endpoint) => `/api/bdl/${endpoint}`,
  pmMarkets: () => '/api/pm/markets',
  pmMidpoint:(tid) => `/api/pm/midpoint/${tid}`,
  pmBook:    (tid) => `/api/pm/book/${tid}`,
  injuries:  () => '/api/injuries',
  odds:      () => '/api/odds',
  referees:  () => '/api/referees',
  status:    () => '/api/status',
  health:    () => '/api/health',
};

// Model weights (user-configurable, persisted in localStorage)
let MW = JSON.parse(localStorage.getItem('modelWeights') || 'null') || {
  netRating: 0.35,
  recency:   0.20,
  injury:    0.15,
  referee:   0.05,
  home:      0.10,
  rest:      0.10,
  timing:    0.05
};

function saveWeights() {
  localStorage.setItem('modelWeights', JSON.stringify(MW));
}
function resetWeights() {
  MW = {netRating:0.35, recency:0.20, injury:0.15, referee:0.05,
        home:0.10, rest:0.10, timing:0.05};
  saveWeights();
  if (typeof renderWeightSliders === 'function') renderWeightSliders();
}

// ── Utility: Safe fetch with timeout ──
async function apiFetch(url, opts = {}, timeout = 9000) {
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

// ── Utility: Sanitize HTML (prevent XSS) ──
function sanitize(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Sections ──
const SECTIONS = [
  'dashboard','live','scanner','positions','alerts','calibration',
  'model','efficiency','players','injuries','referees','odds',
  'kelly','backtest','settings'
];


// ML Model endpoints
API.mlPredict = () => '/api/ml/predict';
API.mlBatch   = () => '/api/ml/batch';
API.mlInfo    = () => '/api/ml/info';

console.log('✅ config.js loaded (+ ML endpoints)');
