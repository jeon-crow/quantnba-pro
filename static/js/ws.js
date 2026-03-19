// ws.js v3.0 — WebSocket + ML hybrid

let _socket = null;
let _wsConnected = false;
let _mlAvailable = false;
let mlMode = localStorage.getItem('mlMode') || 'hybrid';
const _mlProbCache = {};

function setMLMode(mode) {
  mlMode = mode;
  localStorage.setItem('mlMode', mode);
  renderEngineDetail();
  renderPMTable();
}

function initWebSocket() {
  const script = document.createElement('script');
  script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
  script.onload = connectWebSocket;
  document.head.appendChild(script);
  apiFetch(API.mlInfo(), {}, 3000).then(info => {
    _mlAvailable = info?.loaded === true;
    if (_mlAvailable) {
      console.log(`[ML] Loaded | Brier: ${info.brier_score} | Source: ${info.data_source}`);
      const el = document.getElementById('kpiBrier');
      const sub = document.getElementById('kpiBrierSub');
      if (el) { el.textContent = info.brier_score?.toFixed(4) || '—'; }
      if (sub) { sub.textContent = `${info.n_training} sampel · ${info.data_source === 'real' ? 'data NBA nyata' : 'data demo'}`; }
    }
  }).catch(() => { _mlAvailable = false; });
}

function connectWebSocket() {
  if (typeof io === 'undefined') return;
  _socket = io(window.location.origin, { transports: ['websocket', 'polling'], reconnectionAttempts: 5 });
  _socket.on('connect', () => { _wsConnected = true; updateWSIndicator(true); _socket.emit('request_scores'); });
  _socket.on('disconnect', () => { _wsConnected = false; updateWSIndicator(false); });
  _socket.on('live_scores', handleLiveScoreUpdate);
  _socket.on('server_status', (data) => { _mlAvailable = data.ml_loaded; });
}

function handleLiveScoreUpdate(data) {
  const games = data.games || [];
  const live = data.live_count || games.filter(g => g.is_live).length;
  const lcEl = document.getElementById('liveCount');
  if (lcEl) lcEl.textContent = live;
  games.forEach(g => {
    const match = gameData.find(gd => gd.home === g.home_team || gd.away === g.away_team);
    if (match) {
      match._homeScore = g.home_score; match._awayScore = g.away_score;
      match._period = g.period; match._live = g.is_live;
      if (g.is_live) match.status = 'live';
    }
  });
  renderLiveGames();
  const syncTs = document.getElementById('syncTs');
  if (syncTs) {
    syncTs.textContent = 'ESPN · ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    syncTs.style.color = 'var(--green)';
    setTimeout(() => { syncTs.style.color = ''; }, 2000);
  }
}

function updateWSIndicator(connected) {
  const badge = document.getElementById('liveCount');
  if (badge) badge.parentElement.style.borderColor = connected ? 'rgba(0,229,160,.25)' : 'rgba(255,69,96,.25)';
  if (!connected) {
    setTimeout(() => {
      if (!_wsConnected) {
        const el = document.getElementById('syncTs');
        if (el) { el.textContent = 'Server offline'; el.style.color = 'var(--red)'; }
      }
    }, 30000);
  }
}

async function computeHybridProb(g) {
  const jsResult = computeModelProb(g);
  if (mlMode === 'js-only' || !_mlAvailable) return { ...jsResult, method: 'js-only', mlProb: null };
  const injAdj = (g.injuries || []).reduce((sum, inj) => {
    const mult = inj.status === 'OUT' ? 1.0 : 0.4;
    const dir = inj.team === g.away ? 1 : -1;
    return sum + dir * (inj.epm || 3) * 0.012 * mult;
  }, 0);
  const payload = {
    net_rating_diff: g.netRating.home - g.netRating.away,
    recency_diff: ewma(g.recency.home) - ewma(g.recency.away),
    injury_adj: injAdj,
    home_flag: g.homeFlag ?? 1,
    rest_diff: (g.rest?.home ?? 1) - (g.rest?.away ?? 1),
    ref_pace_fast: g.refPaceFast ?? 0,
    market_momentum: g.pmPriceMove ?? 0,
  };
  try {
    const mlResult = await apiFetch(API.mlPredict(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }, 5000);
    if (mlResult?.home_win_prob === undefined) throw new Error('No prob');
    const mlProb = mlResult.home_win_prob;
    const finalProb = clamp(mlMode === 'ml-only' ? mlProb : 0.60 * mlProb + 0.40 * jsResult.finalProb, 0.08, 0.92);
    return { finalProb, F: jsResult.F, confidence: Math.round((mlResult.confidence + jsResult.confidence) / 2), mlProb, jsProb: jsResult.finalProb, method: mlMode };
  } catch (e) {
    return { ...jsResult, method: 'js-only', mlProb: null };
  }
}

function getGameProb(g) {
  const jsResult = computeModelProb(g);
  const mlProb = _mlProbCache[g.id];
  if (mlProb !== undefined && mlMode !== 'js-only') {
    const finalProb = clamp(mlMode === 'ml-only' ? mlProb : 0.60 * mlProb + 0.40 * jsResult.finalProb, 0.08, 0.92);
    return { ...jsResult, finalProb, mlProb, method: mlMode };
  }
  return { ...jsResult, method: 'js-only', mlProb: null };
}

async function prefetchMLPredictions() {
  if (!_mlAvailable || mlMode === 'js-only') return;
  try {
    const payload = gameData.map(g => {
      const injAdj = (g.injuries || []).reduce((sum, inj) => {
        return sum + (inj.team === g.away ? 1 : -1) * (inj.epm || 3) * 0.012 * (inj.status === 'OUT' ? 1.0 : 0.4);
      }, 0);
      return {
        game_id: g.id,
        net_rating_diff: g.netRating.home - g.netRating.away,
        recency_diff: ewma(g.recency.home) - ewma(g.recency.away),
        injury_adj: injAdj,
        home_flag: g.homeFlag ?? 1,
        rest_diff: (g.rest?.home ?? 1) - (g.rest?.away ?? 1),
        ref_pace_fast: g.refPaceFast ?? 0,
        market_momentum: g.pmPriceMove ?? 0,
      };
    });
    const result = await apiFetch(API.mlBatch(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }, 8000);
    (result?.predictions || []).forEach(p => {
      if (p.game_id && p.home_win_prob !== undefined) _mlProbCache[p.game_id] = p.home_win_prob;
    });
    console.log(`[ML] Pre-fetched ${Object.keys(_mlProbCache).length} predictions`);
    renderGameSelector();
    renderPMTable();
  } catch (e) { console.warn('[ML prefetch]', e.message); }
}

console.log('✅ ws.js v3.0 loaded');
