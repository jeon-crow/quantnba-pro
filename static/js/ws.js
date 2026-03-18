
// ═══════════════════════════════════════
// WEBSOCKET CLIENT — Real-time live scores
// ═══════════════════════════════════════

let _socket = null;
let _wsConnected = false;

function initWebSocket() {
  // Load socket.io client dynamically
  const script = document.createElement('script');
  script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
  script.onload = () => {
    console.log('[WS] socket.io client loaded');
    connectWebSocket();
  };
  script.onerror = () => {
    console.warn('[WS] Failed to load socket.io client, falling back to polling');
  };
  document.head.appendChild(script);
}

function connectWebSocket() {
  if (typeof io === 'undefined') {
    console.warn('[WS] io not available');
    return;
  }

  _socket = io(window.location.origin, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay: 3000
  });

  _socket.on('connect', () => {
    _wsConnected = true;
    console.log('[WS] Connected');
    updateWSIndicator(true);
    _socket.emit('request_scores');
  });

  _socket.on('disconnect', () => {
    _wsConnected = false;
    console.log('[WS] Disconnected');
    updateWSIndicator(false);
  });

  _socket.on('server_status', (data) => {
    console.log('[WS] Server status:', data);
    if (data.ml_loaded) {
      console.log('[WS] ML model is loaded on server');
    }
  });

  _socket.on('live_scores', (data) => {
    console.log('[WS] Live scores update:', data.games?.length, 'games');
    handleLiveScoreUpdate(data);
  });

  _socket.on('connect_error', (err) => {
    console.warn('[WS] Connection error:', err.message);
    _wsConnected = false;
    updateWSIndicator(false);
  });
}

function handleLiveScoreUpdate(data) {
  const games = data.games || [];
  const liveCount = data.live_count || games.filter(g => g.is_live).length;

  // Update live count badge
  const lcEl = document.getElementById('liveCount');
  if (lcEl) lcEl.textContent = liveCount;

  // Update gameData with real scores
  games.forEach(g => {
    const match = gameData.find(gd =>
      gd.home === g.home_team || gd.away === g.away_team
    );
    if (match) {
      match._homeScore = g.home_score;
      match._awayScore = g.away_score;
      match._period = g.period;
      match._live = g.is_live;
      if (g.is_live) match.status = 'live';
    }
  });

  // Re-render live games section
  renderLiveGames();

  // Flash update indicator
  const syncTs = document.getElementById('syncTs');
  if (syncTs) {
    const ts = new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    syncTs.textContent = 'WS: ' + ts;
    syncTs.style.color = 'var(--green)';
    setTimeout(() => { syncTs.style.color = ''; }, 2000);
  }
}

function updateWSIndicator(connected) {
  // Could add a small WS indicator to the topbar
  const badge = document.getElementById('liveCount');
  if (badge) {
    badge.parentElement.style.borderColor = connected
      ? 'rgba(0,229,160,.25)' : 'rgba(255,69,96,.25)';
  }
}

// ML Model integration — call Python backend
async function fetchMLPrediction(gameFeatures) {
  try {
    const resp = await fetch(API.mlPredict(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gameFeatures)
    });
    if (!resp.ok) throw new Error('ML API error');
    return await resp.json();
  } catch (e) {
    console.warn('[ML]', e.message);
    return null;
  }
}

async function fetchMLBatch(gamesArray) {
  try {
    const resp = await fetch(API.mlBatch(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gamesArray)
    });
    if (!resp.ok) throw new Error('ML batch error');
    return await resp.json();
  } catch (e) {
    console.warn('[ML batch]', e.message);
    return null;
  }
}

// Enhanced model: combine JS 7-factor + Python ML
async function computeHybridProb(g) {
  // 1. JavaScript 7-factor model (instant)
  const jsResult = computeModelProb(g);

  // 2. Python ML model (async, calibrated)
  const mlFeatures = {
    game_id: g.id,
    net_rating_diff: g.netRating.home - g.netRating.away,
    recency_diff: ewma(g.recency.home) - ewma(g.recency.away),
    injury_adj: (g.injuries || []).reduce((s, inj) => {
      const mult = inj.status === 'OUT' ? 1.0 : 0.4;
      const dir = inj.team === g.away ? 1 : -1;
      return s + dir * inj.epm * 0.012 * mult;
    }, 0),
    home_flag: g.homeFlag || 0,
    rest_diff: (g.rest?.home || 0) - (g.rest?.away || 0),
    ref_pace_fast: g.refPaceFast || 0,
    market_momentum: g.pmPriceMove || 0
  };

  const mlResult = await fetchMLPrediction(mlFeatures);

  if (mlResult && mlResult.home_win_prob) {
    // Ensemble: 60% ML (calibrated) + 40% JS (rule-based)
    const ensembleProb = 0.6 * mlResult.home_win_prob + 0.4 * jsResult.finalProb;
    const ensembleConf = Math.round((mlResult.confidence + jsResult.confidence) / 2);

    return {
      finalProb: ensembleProb,
      F: jsResult.F,
      confidence: ensembleConf,
      mlProb: mlResult.home_win_prob,
      jsProb: jsResult.finalProb,
      method: 'hybrid'
    };
  }

  // Fallback to JS-only
  return { ...jsResult, method: 'js-only' };
}

console.log('\u2705 ws.js loaded (WebSocket + ML client)');
