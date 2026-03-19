// config.js v3.2 — Season 2025-26 | PM NBA endpoint added
const API = {
  espnScoreboard: (date) => date ? `/api/espn/scoreboard?date=${date}` : '/api/espn/scoreboard',
  espnSummary:    (eventId) => `/api/espn/summary/${eventId}`,
  espnInjuries:   () => '/api/espn/injuries',
  espnStandings:  () => '/api/espn/standings',
  nbaTeamStats:  (season) => season ? `/api/nba/teamstats?season=${season}` : '/api/nba/teamstats',
  nbaScoreboard: (date) => date ? `/api/nba/scoreboard?date=${date}` : '/api/nba/scoreboard',
  nbaGamelog:    (teamId, n) => `/api/nba/gamelog/${teamId}?n=${n || 5}`,
  nbaFeatures:   (home, away) => `/api/nba/features?home=${home}&away=${away}`,
  pmMarkets:  () => '/api/pm/markets',
  pmNBA:      () => '/api/pm/nba',
  pmMidpoint: (tid) => `/api/pm/midpoint/${tid}`,
  pmBook:     (tid) => `/api/pm/book/${tid}`,
  mlPredict: () => '/api/ml/predict',
  mlBatch:   () => '/api/ml/batch',
  mlInfo:    () => '/api/ml/info',
  status: () => '/api/status',
  health: () => '/api/health',
};

let MW = JSON.parse(localStorage.getItem('modelWeights') || 'null') || {
  netRating: 0.35, recency: 0.20, injury: 0.15, referee: 0.05,
  home: 0.10, rest: 0.10, timing: 0.05,
};

function saveWeights() {
  localStorage.setItem('modelWeights', JSON.stringify(MW));
}

function resetWeights() {
  MW = { netRating: 0.35, recency: 0.20, injury: 0.15, referee: 0.05,
         home: 0.10, rest: 0.10, timing: 0.05 };
  saveWeights();
  if (typeof renderWeightSliders === 'function') renderWeightSliders();
}

async function apiFetch(url, opts = {}, timeout = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) { clearTimeout(t); throw e; }
}

function sanitize(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const SECTIONS = [
  'dashboard','live','scanner','positions','alerts','calibration',
  'model','efficiency','players','injuries','referees','odds',
  'kelly','backtest','settings',
];

console.log('✅ config.js v3.2 loaded | Season: 2025-26 | pmNBA endpoint added');
