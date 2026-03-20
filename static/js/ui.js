
// ═══════════════════════════════════════
// UI RENDERERS
// ═══════════════════════════════════════

// ── Safe Chart factory (prevents memory leaks) ──
const _chartInstances = {};
function safeChart(canvasId, config) {
  if (_chartInstances[canvasId]) {
    _chartInstances[canvasId].destroy();
    delete _chartInstances[canvasId];
  }
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  _chartInstances[canvasId] = new Chart(ctx, config);
  return _chartInstances[canvasId];
}

// ── Common chart options builder ──
function chartOpts(scalesCfg) {
  const scales = {};
  Object.entries(scalesCfg).forEach(([axis, cfg]) => {
    scales[axis] = {
      min: cfg.min, max: cfg.max,
      grid: { color: 'rgba(17,30,53,.5)' },
      ticks: { font: { size: 9 }, color: '#4A6080' },
      ...(cfg.title ? { title: { display: true, text: cfg.title, color: '#4A6080', font: { size: 9 } } } : {})
    };
  });
  return {
    responsive: true,
    plugins: {
      legend: { labels: { color: '#4A6080', font: { size: 9 }, boxWidth: 8, padding: 8 } }
    },
    scales
  };
}

// ── Section Navigation ──
function showSection(name, navEl) {
  SECTIONS.forEach(s => {
    const el = document.getElementById('sec-' + s);
    if (el) el.style.display = s === name ? '' : 'none';
  });
  if (navEl) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    navEl.classList.add('active');
  }
  if (name === 'dashboard') { renderTopAlpha(); AlertSystem.renderAll(); }
  if (name === 'calibration') PredictionLog.renderAll();
  if (name === 'positions') PositionTracker.render();
  if (name === 'settings') updateSettingsSizes();
}

// ── Modal helpers ──
function closeModal(e, id) {
  if (e.target === document.getElementById(id)) closeModalId(id);
}
function closeModalId(id) {
  document.getElementById(id).classList.remove('open');
}
function openAddPosition() {
  document.getElementById('addPosOverlay').classList.add('open');
}
function openAlertPanel() { showSection('alerts', null); }

// ── Live Games ──
function renderLiveGames() {
  // Render ke dashboard (maks 3 game live)
  const elDash = document.getElementById('liveGamesRow');
  // Render ke halaman Live Games (semua game hari ini)
  const elLive = document.getElementById('liveGamesRow2');

  // Game live = status 'live' ATAU _live=true ATAU state 'in' dari ESPN
  const liveGames = gameData.filter(g =>
    g.status === 'live' || g._live === true || g.status === 'in'
  );
  // Semua game hari ini (termasuk upcoming dan final)
  const allGames = gameData;

  // Helper render satu game card
  function makeGameCard(g, showScore) {
    const { finalProb } = computeModelProb(g);
    const prob     = Math.round(finalProb * 100);
    const hs       = (g._homeScore !== null && g._homeScore !== undefined) ? g._homeScore : '—';
    const as       = (g._awayScore !== null && g._awayScore !== undefined) ? g._awayScore : '—';
    const isLive   = g.status === 'live' || g._live === true;
    const isFinal  = g.status === 'final' || g.status === 'post';
    const clock    = g._clock || '';
    const period   = g._period || 0;

    // Nama lengkap tim
    const homeFull  = (typeof teamName === 'function') ? teamName(g.home) : g.home;
    const awayFull  = (typeof teamName === 'function') ? teamName(g.away) : g.away;
    const homeShort = (typeof teamShort === 'function') ? teamShort(g.home) : g.home;
    const awayShort = (typeof teamShort === 'function') ? teamShort(g.away) : g.away;

    let statusBadge = '';
    if (isLive) {
      statusBadge = '<span style="color:var(--red);font-weight:700;font-size:9px;' +
        'display:flex;align-items:center;gap:3px">' +
        '<div class="dot-pulse" style="width:5px;height:5px"></div>' +
        'LIVE Q' + period + (clock ? ' ' + clock : '') + '</span>';
    } else if (isFinal) {
      statusBadge = '<span style="font-size:9px;color:var(--t2)">Final</span>';
    } else {
      statusBadge = '<span style="font-size:10px;color:var(--t2)">' + sanitize(g.time) + '</span>';
    }

    const borderClass = isLive ? 'live-border' : '';
    const probColor   = prob >= 60 ? 'var(--green)' : prob <= 40 ? 'var(--red)' : 'var(--amber)';

    return '<div class="game-card ' + borderClass + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        statusBadge +
        '<span style="font-size:9px;color:var(--t2);font-weight:500">' +
          sanitize(awayFull) + ' vs ' + sanitize(homeFull) +
        '</span>' +
      '</div>' +
      '<div class="score-row">' +
        '<div>' +
          '<div class="t-abbr" style="color:var(--t1)">' + sanitize(g.away) + '</div>' +
          '<div style="font-size:9px;color:var(--t2);margin-top:1px">' + sanitize(awayFull) + '</div>' +
        '</div>' +
        '<span class="t-score" style="color:var(--t1)">' + as + '</span>' +
      '</div>' +
      '<div class="score-row">' +
        '<div>' +
          '<div class="t-abbr" style="color:var(--green)">' + sanitize(g.home) + '</div>' +
          '<div style="font-size:9px;color:var(--t2);margin-top:1px">' + sanitize(homeFull) + '</div>' +
        '</div>' +
        '<span class="t-score">' + hs + '</span>' +
      '</div>' +
      '<div class="prob-bar" style="margin-top:10px">' +
        '<div class="pb-lbl">' +
          '<span style="color:' + probColor + '">' + sanitize(homeShort) + ' ' + prob + '%</span>' +
          '<span>' + sanitize(awayShort) + ' ' + (100-prob) + '%</span>' +
        '</div>' +
        '<div class="pb-track"><div class="pb-fill" style="width:' + prob +
          '%;background:linear-gradient(90deg,var(--green),var(--blue))"></div></div>' +
      '</div>' +
    '</div>';
  }

  // ── Dashboard: tampilkan max 3 game live ──
  if (elDash) {
    const dashGames = liveGames.length > 0 ? liveGames.slice(0, 3) : allGames.slice(0, 3);
    if (!dashGames.length) {
      elDash.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;' +
        'font-size:11px;color:var(--t2);padding:20px">Tidak ada game hari ini</div>';
    } else {
      elDash.innerHTML = dashGames.map(g => makeGameCard(g, true)).join('');
    }
  }

  // ── Live Games page: tampilkan semua game ──
  if (elLive) {
    if (!allGames.length) {
      elLive.innerHTML = '<div style="text-align:center;font-size:11px;' +
        'color:var(--t2);padding:30px;grid-column:1/-1">Tidak ada game hari ini</div>';
    } else {
      elLive.innerHTML = allGames.map(g => makeGameCard(g, true)).join('');
    }
  }

  // Update live count di topbar
  const lcEl = document.getElementById('liveCount');
  if (lcEl) lcEl.textContent = liveGames.length;
}

// ── PM Table ──
let pmFilter = 'all';

function filterPM(f, el) {
  pmFilter = f;
  el.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  renderPMTable();
}

function renderPMTable() {
  // Alpha Scanner disembunyikan sementara — API game harian tidak tersedia
  const container = document.getElementById('pmTableContainer') ||
                    document.getElementById('alphaScanner');
  if (container) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 24px;color:var(--text-muted)">
        <div style="font-size:1.5rem;margin-bottom:8px">🔧</div>
        <div style="font-weight:600;margin-bottom:4px">Alpha Scanner — Coming Soon</div>
        <div style="font-size:0.85rem">Polymarket game-by-game API sedang dalam pengembangan.</div>
      </div>`;
  }
  return; // skip render tabel
  const markets = buildLiveMarkets();
  let data = [...markets].sort((a, b) => {
    const ea = Math.abs((a.modelProb - a.yesPrice) * 100);
    const eb = Math.abs((b.modelProb - b.yesPrice) * 100);
    return eb - ea;
  });

  if (pmFilter === 'buy') data = data.filter(m => (m.modelProb - m.yesPrice) * 100 >= 5);
  if (pmFilter === 'short') data = data.filter(m => (m.modelProb - m.yesPrice) * 100 <= -5);
  if (pmFilter === 'skip') data = data.filter(m => Math.abs((m.modelProb - m.yesPrice) * 100) < 5);

  const alpha = markets.filter(m => Math.abs((m.modelProb - m.yesPrice) * 100) >= 5).length;
  const el_a = document.getElementById('pmAlphaCount');
  if (el_a) el_a.textContent = alpha;
  const el_v = document.getElementById('pmTotalVol');
  if (el_v) {
    const tot = markets.reduce((s, m) => s + m.volume, 0);
    el_v.textContent = '$' + (tot / 1000).toFixed(0) + 'K';
  }

  // Update KPI edge
  const kpiEdge = document.getElementById('kpiEdge');
  const kpiEdgeSub = document.getElementById('kpiEdgeSub');
  if (alpha && kpiEdge) {
    const edges = markets.filter(m => Math.abs((m.modelProb - m.yesPrice) * 100) >= 5)
      .map(m => Math.abs((m.modelProb - m.yesPrice) * 100));
    kpiEdge.textContent = '+' + (edges.reduce((s, e) => s + e, 0) / edges.length).toFixed(1) + '%';
    if (kpiEdgeSub) kpiEdgeSub.textContent = alpha + ' alpha signals today';
  }

  const tbody = document.getElementById('pmTbody');
  tbody.innerHTML = data.map(m => {
    const gross = (m.modelProb - m.yesPrice) * 100;
    const spread = m.spread;
    const net = spread != null ? gross - spread / 2 * 100 : gross;
    const edgeSign = net > 0 ? '+' : '';
    const edgeColor = net >= 5 ? 'var(--green)' : net <= -5 ? 'var(--red)' : 'var(--t2)';
    const spreadStr = spread != null ? (spread * 100).toFixed(1) + '\u00A2' : '\u2014';
    const spreadCls = spread == null ? '' : spread <= .03 ? 'spread-g' : spread <= .07 ? 'spread-a' : 'spread-r';
    const ev = m.modelProb * (1 / m.yesPrice - 1) * 100 - (1 - m.modelProb) * 100;
    const evSign = ev > 0 ? '+' : '';
    const evColor = ev > 0 ? 'var(--green)' : 'var(--red)';
    const k = Math.max(0, (m.modelProb - m.yesPrice) / (1 - m.yesPrice) * .25);
    const kStr = k > 0 ? (k * 100).toFixed(1) + '%' : '\u2014';
    const vol = m.volume >= 1000 ? '$' + (m.volume / 1000).toFixed(0) + 'K' : '$' + m.volume;
    const liqColor = (m.liquidityLabel || m.liquidity) === 'High' ? 'var(--green)' : m.liquidity === 'Medium' ? 'var(--amber)' : 'var(--red)';
    const conf = m.confidence != null
      ? '<span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:' +
        (m.confidence >= 70 ? 'var(--green)' : m.confidence >= 50 ? 'var(--amber)' : 'var(--t2)') +
        '">' + m.confidence + '%</span>' : '';
    const abCls = net >= 5 ? 'alpha-g' : net <= -5 ? 'alpha-r' : Math.abs(net) >= 2 ? 'alpha-a' : 'alpha-n';
    const abLbl = net >= 5 ? 'BUY YES' : net <= -5 ? 'BUY NO' : Math.abs(net) >= 2 ? 'WATCH' : 'SKIP';
    const liveTag = m._live ? '<span class="db db-live" style="margin-left:3px">LIVE</span>' : '';
    const actCls = net >= 5 ? 'tb-yes' : net <= -5 ? 'tb-no' : 'tb-skip';
    const actLbl = net >= 5 ? 'BUY YES' : net <= -5 ? 'BUY NO' : 'SKIP';

    return '<tr>' +
      '<td style="padding-left:14px"><div class="pm-q">' + sanitize(m.question) + liveTag +
        '<span class="alpha ' + abCls + '">' + abLbl + '</span></div>' +
        '<div class="pm-meta"><span style="color:' + liqColor + '">\u25CF</span>' +
          '<span>' + m.liquidity + '</span><span>\u00B7</span>' +
          '<span>' + sanitize(m.closes) + '</span></div></td>' +
      '<td><span class="yp">$' + m.yesPrice.toFixed(2) + '</span></td>' +
      '<td><span class="np">$' + (1 - m.yesPrice).toFixed(2) + '</span></td>' +
      '<td><span class="' + spreadCls + '" style="font-family:\'JetBrains Mono\',monospace;' +
        'font-size:11px">' + spreadStr + '</span></td>' +
      '<td style="text-align:right"><span class="mp">' + (m.modelProb * 100).toFixed(0) + '%</span>' +
        '<br>' + conf + '</td>' +
      '<td><div style="font-family:\'JetBrains Mono\',monospace;font-size:13px;font-weight:800;' +
        'color:' + edgeColor + '">' + edgeSign + net.toFixed(1) + '%</div></td>' +
      '<td><span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;' +
        'color:' + evColor + '">' + evSign + '$' + Math.abs(ev).toFixed(1) + '</span></td>' +
      '<td><span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:var(--amber)">' +
        kStr + '</span></td>' +
      '<td><span style="font-size:11px;color:var(--t1)">' + vol + '</span></td>' +
      '<td><button class="trade-btn ' + actCls + '" onclick="loadKelly(' +
        m.modelProb + ',' + m.yesPrice + ',' + (spread || 0) + ')">' + actLbl + '</button></td>' +
    '</tr>';
  }).join('');

  renderTopAlpha();
  const pmu = document.getElementById('pmUpdated');
  if (pmu) pmu.textContent = new Date().toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'});
}

function renderTopAlpha() {
  const markets = buildLiveMarkets();
  const top = markets.filter(m => Math.abs((m.modelProb - m.yesPrice) * 100) >= 5)
    .sort((a, b) => Math.abs((b.modelProb - b.yesPrice) * 100) - Math.abs((a.modelProb - a.yesPrice) * 100))
    .slice(0, 4);
  const el = document.getElementById('topAlphaList');
  if (!el) return;
  if (!top.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--t2);text-align:center;padding:16px">' +
      'No alpha signals above threshold.</div>';
    return;
  }
  el.innerHTML = top.map(m => {
    const e = (m.modelProb - m.yesPrice) * 100;
    const cls = e > 0 ? 'alpha-g' : 'alpha-r';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;' +
      'border-bottom:1px solid rgba(17,30,53,.5)"><div style="flex:1;min-width:0">' +
      '<div style="font-weight:600;font-size:12px">' + sanitize(m.question) + '</div>' +
      '<div style="font-size:9px;color:var(--t2)">' + sanitize(m.closes) + ' \u00B7 PM $' +
        m.yesPrice.toFixed(2) + '</div></div>' +
      '<div style="text-align:right;flex-shrink:0;margin-left:8px">' +
        '<span class="alpha ' + cls + '">' + (e > 0 ? '+' : '') + e.toFixed(1) + '%</span>' +
        '<div style="font-size:8px;color:var(--t2);margin-top:2px">' +
          (e > 0 ? 'BUY YES' : 'BUY NO') + '</div></div></div>';
  }).join('');
  setBadge('scannerDb', 'live');
  setBadge('scannerDb2', 'live');
}

// ── Model Engine Render ──
let selectedGame = 0;

function renderGameSelector() {
  const el = document.getElementById('gameSelectorList');
  if (!el) return;
  el.innerHTML = gameData.map((g, i) => {
    const { finalProb, confidence } = computeModelProb(g);
    const prob = Math.round(finalProb * 100);
    const probColor = prob >= 65 ? 'var(--green)' : prob <= 40 ? 'var(--red)' : 'var(--amber)';
    const confColor = confidence >= 70 ? 'var(--green)' : confidence >= 50 ? 'var(--amber)' : 'var(--red)';
    return '<div class="gsi' + (i === selectedGame ? ' active' : '') + '" onclick="selectGame(' + i + ')">' +
      '<div style="display:flex;justify-content:space-between">' +
        '<span class="gsi-matchup">' + (typeof teamName === 'function' ? teamName(g.home) : g.home) + ' vs ' + (typeof teamName === 'function' ? teamName(g.away) : g.away) + '</span>' +
        '<span style="font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;' +
          'color:' + probColor + '">' + prob + '%</span></div>' +
      '<div class="gsi-meta">' +
        (g.status === 'live' ? '<span style="color:var(--red);font-weight:700">\u25CF LIVE</span>' : '') +
        '<span>' + sanitize(g.time) + '</span>' +
        '<span style="color:' + confColor + '">' + confidence + '% conf</span></div></div>';
  }).join('');
}

function selectGame(i) {
  selectedGame = i;
  renderGameSelector();
  renderEngineDetail();
  PredictionLog.add(gameData[i], computeModelProb(gameData[i]).finalProb, gameData[i].pmYesPrice);
}

function renderEngineDetail() {
  const g = gameData[selectedGame];
  const { finalProb, F, confidence } = computeModelProb(g);
  const prob = Math.round(finalProb * 100);
  const pmImplied = Math.round(g.pmYesPrice * 100);
  const edge = prob - pmImplied;
  const edgeColor = edge >= 5 ? 'var(--green)' : edge <= -5 ? 'var(--red)' : 'var(--t2)';
  const confColor = confidence >= 70 ? 'var(--green)' : confidence >= 50 ? 'var(--amber)' : 'var(--red)';
  const hrs = g.hoursToClose;
  const tr = hrs > 3 ? {c:'tr-g', l:'Optimal Window', col:'var(--green)'}
           : hrs > .5 ? {c:'tr-a', l:'Closing', col:'var(--amber)'}
           : {c:'tr-r', l:'Live Market', col:'var(--red)'};

  const el = document.getElementById('engineDetail');
  if (!el) return;

  // Build factor grid
  const fCards = Object.values(F).map(f => {
    const adj = f.prob - .5;
    const sign = adj >= 0 ? '+' : '';
    const barW = Math.min(Math.abs(adj) * 200 + 20, 100);
    const bColor = adj > 0 ? f.color : 'var(--red)';
    const adjCls = adj > 0.01 ? 'pos' : adj < -0.01 ? 'neg' : 'neu';
    return '<div class="f-card"><div class="f-name" style="color:' + f.color + '">' + f.label +
      ' <span style="font-weight:400;color:var(--t2)">\u00D7' + (f.w * 100).toFixed(0) + '%</span></div>' +
      '<div class="f-val" style="color:' + (adj > 0.01 ? f.color : adj < -0.01 ? 'var(--red)' : 'var(--t1)') +
        '">' + (f.prob * 100).toFixed(0) + '%</div>' +
      '<div class="f-raw">' + f.rawStr + '</div>' +
      '<div class="f-bar"><div class="f-fill" style="width:' + barW + '%;background:' + bColor + '"></div></div>' +
      '<span class="f-adj ' + adjCls + '">' + sign + (adj * 100).toFixed(1) + '%</span></div>';
  }).join('');

  // Build formula rows
  const fRows = Object.values(F).map(f => {
    const adj = f.prob - .5;
    const sign = adj >= 0 ? '+' : '';
    const c = adj > 0.01 ? 'var(--green)' : adj < -0.01 ? 'var(--red)' : 'var(--t2)';
    return '<div class="mf-row"><span class="mf-lbl" style="color:' + f.color + '">' + f.label + '</span>' +
      '<span class="mf-val" style="color:' + c + '">' + sign + (adj * 100).toFixed(1) + '%</span>' +
      '<span class="mf-arrow">\u00D7' + (f.w * 100).toFixed(0) + '% =</span>' +
      '<span class="mf-val" style="color:' + c + '">' + sign + (adj * f.w * 100).toFixed(2) + '%</span></div>';
  }).join('');

  el.innerHTML =
    '<div style="margin-bottom:10px">' +
      '<div style="font-size:9px;color:var(--t2);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">' +
        sanitize(g.time) + ' \u00B7 ' + (g.status === 'live' ? '<span style="color:var(--red)">\u25CF LIVE</span>' : 'Upcoming') + '</div>' +
      '<div style="font-family:\'Rajdhani\',sans-serif;font-size:16px;font-weight:700;margin-bottom:6px">' + sanitize(g.label) + '</div>' +
      '<div class="engine-prob">' +
        '<div class="epd"><div class="epd-v" style="color:var(--green)">' + prob + '%</div><div class="epd-l">' + g.home + ' Model</div></div>' +
        '<div style="font-size:12px;color:var(--t2)">vs</div>' +
        '<div class="epd"><div class="epd-v" style="color:var(--t1)">' + pmImplied + '%</div><div class="epd-l">Polymarket</div></div>' +
        '<div class="sep"></div>' +
        '<div class="epd"><div class="epd-v" style="color:' + edgeColor + '">' + (edge > 0 ? '+' : '') + edge + '%</div><div class="epd-l">Edge</div></div>' +
        '<div class="epd"><div class="epd-v" style="color:' + confColor + '">' + confidence + '%</div><div class="epd-l">Confidence</div></div>' +
      '</div></div>' +
    '<div class="conf-track"><div style="height:100%;width:' + prob + '%;background:linear-gradient(90deg,var(--green),var(--blue));border-radius:2px"></div></div>' +
    '<div class="f-grid">' + fCards + '</div>' +
    '<div class="formula"><div style="font-size:9px;color:var(--t2);margin-bottom:5px;letter-spacing:.5px;text-transform:uppercase">Weighted Sum \u2192 Final Probability</div>' +
      fRows +
      '<div class="mf-row" style="border-top:1px solid var(--b0);margin-top:4px;padding-top:4px">' +
        '<span class="mf-lbl" style="font-weight:700">BASE 50%</span><span class="mf-arrow">+</span>' +
        '<span class="mf-val" style="color:var(--green);font-size:12px;font-weight:700">' + prob + '% FINAL</span>' +
        '<span style="margin-left:auto;color:' + confColor + '">conf: ' + confidence + '%</span></div></div>' +
    '<div class="timing-row ' + tr.c + '"><div style="flex:1"><div style="font-weight:600;font-size:12px;color:' + tr.col + '">' + tr.l + '</div>' +
      '<div style="font-size:9px;color:var(--t2);margin-top:2px">~' + hrs.toFixed(1) + 'h to close</div></div>' +
      '<button onclick="loadKelly(' + finalProb.toFixed(3) + ',' + g.pmYesPrice + ',0);showSection(\'kelly\',null)" ' +
        'class="trade-btn tb-yes">\u2192 Kelly Sizer</button></div>';
}

// ── Team Efficiency ──
let curConf = 'all';
function filterTeams(c, el) {
  curConf = c;
  el.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  renderEfficiency();
}

function renderEfficiency() {
  const filtered = teams.filter(t => curConf === 'all' || t.conf === curConf)
    .sort((a, b) => (b.ortg - b.drtg) - (a.ortg - a.drtg));
  const tbody = document.getElementById('effTbody');
  if (!tbody) return;
  tbody.innerHTML = filtered.map((t, i) => {
    const net = (t.ortg - t.drtg).toFixed(1);
    const cls = net > 0 ? 'pill-g' : net < 0 ? 'pill-r' : 'pill-n';
    const lv = t._live ? '<span class="db db-live" style="margin-left:3px">\u25CF</span>' : '';
    return '<tr><td><span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--t2)">' +
      (i + 1) + '</span> <span class="t-dot" style="background:' + t.color + '"></span>' +
      '<strong>' + t.abbr + '</strong> <span style="color:var(--t2);font-size:10px">' + t.name + '</span>' + lv + '</td>' +
      '<td style="color:var(--green)">' + t.ortg.toFixed(1) + '</td>' +
      '<td style="color:var(--red)">' + t.drtg.toFixed(1) + '</td>' +
      '<td><span class="pill ' + cls + '">' + (net > 0 ? '+' : '') + net + '</span></td>' +
      '<td style="color:var(--t2)">' + t.pace.toFixed(1) + '</td></tr>';
  }).join('');
}

// ── Players ──
let curImpact = 'epm';
function switchImpact(tab, el) {
  curImpact = tab;
  el.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  renderPlayers();
}

function renderPlayers() {
  const sorted = [...players].sort((a, b) => b[curImpact] - a[curImpact]);
  const mx = sorted[0][curImpact];
  const el = document.getElementById('playerList');
  if (!el) return;
  el.innerHTML = sorted.map(p => {
    const v = p[curImpact];
    const c = v > 8 ? 'var(--green)' : v > 5 ? 'var(--amber)' : 'var(--t2)';
    const pct = Math.min(v / mx * 100, 100);
    return '<div class="p-row"><div class="p-av" style="background:' + p.color + '18;color:' + p.color + '">' +
      p.init + '</div><div style="flex:1"><div style="font-weight:600;font-size:12px">' + sanitize(p.name) + '</div>' +
      '<div style="font-size:10px;color:var(--t2)">' + p.team + ' \u00B7 ' + p.pos + '</div></div>' +
      '<div style="text-align:center;min-width:34px"><div style="font-size:8px;color:var(--t2);text-transform:uppercase;' +
        'letter-spacing:.5px">' + curImpact.toUpperCase() + '</div><div style="font-family:\'JetBrains Mono\',monospace;' +
        'font-size:12px;font-weight:700;color:' + c + '">+' + v + '</div></div>' +
      '<div><div class="p-bar"><div class="p-fill" style="width:' + pct + '%;background:' + c + '"></div></div></div></div>';
  }).join('');
}

// ── Injuries ──
function renderInjuries() {
  const el = document.getElementById('injuryList');
  if (!el) return;
  el.innerHTML = injuries.map(p => {
    const cls = p.status === 'GTD' ? 'gtd' : 'out';
    const sc = p.status === 'GTD' ? 'var(--amber)' : 'var(--red)';
    const sbg = p.status === 'GTD' ? 'var(--adim)' : 'var(--rdim)';
    return '<div class="inj-card ' + cls + '"><div style="flex:1"><div style="font-weight:600;font-size:12px">' +
      sanitize(p.name) + '</div><div style="font-size:10px;color:var(--t2);margin-top:1px">' +
      p.team + ' \u00B7 ' + sanitize(p.desc) + '</div></div>' +
      '<span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:3px;letter-spacing:.5px;' +
        'background:' + sbg + ';color:' + sc + ';flex-shrink:0">' + p.status + '</span>' +
      '<div style="text-align:right;flex-shrink:0;margin-left:8px"><div style="font-family:\'JetBrains Mono\',monospace;' +
        'font-size:13px;font-weight:700;color:var(--red)">' + p.impact.toFixed(1) + '</div>' +
        '<div style="font-size:8px;color:var(--t2)">Net Rtg \u0394</div></div></div>';
  }).join('');
}

// ── Referees ── ← FIXED: i % demo.length (was corrupt character)
function applyRefereeData(gameSumm, officials) {
  const gmap = {};
  gameSumm?.rowSet?.forEach(r => {
    const h = gameSumm.headers;
    gmap[r[h.indexOf('GAME_ID')]] = {
      home: r[h.indexOf('HOME_TEAM_ABBREVIATION')],
      away: r[h.indexOf('VISITOR_TEAM_ABBREVIATION')]
    };
  });
  const heads = officials.headers;
  const byGame = {};
  officials.rowSet.forEach(r => {
    const gid = r[heads.indexOf('GAME_ID')];
    if (!byGame[gid]) byGame[gid] = [];
    byGame[gid].push((r[heads.indexOf('FIRST_NAME')] + ' ' + r[heads.indexOf('LAST_NAME')]).trim());
  });
  Object.entries(byGame).forEach(([gid, names]) => {
    const gm = gmap[gid] || {};
    const match = gameData.find(g => g.home === gm.home || g.away === gm.away);
    if (!match) return;
    const crew = names.slice(0, 3).map(n => REF_TEND[n] || REF_TEND.default);
    match.refPaceFast = crew.filter(r => r.pace === 'Fast').length >= 2 ? 1 : 0;
    match.refFoulHigh = crew.reduce((s, r) => s + r.fouls, 0) / crew.length > 45 ? 1 : 0;
  });
  renderRefList(byGame, gmap);
  renderGameSelector();
  renderEngineDetail();
  renderPMTable();
}

function applyRefDemoData() {
  const demo = [
    ['Tony Brothers', 'Scott Foster', 'Marc Davis'],
    ['Ed Malloy', 'Bill Kennedy', 'Josh Tiven'],
    ['Zach Zarba', 'James Williams', 'Tony Brothers']
  ];
  const byGame = {}, gmap = {};
  gameData.slice(0, 3).forEach((g, i) => {
    const refIdx = i % demo.length;  // ← FIXED (was corrupt character)
    byGame[g.id] = demo[refIdx];
    gmap[g.id] = { home: g.home, away: g.away };
    const crew = demo[refIdx].map(n => REF_TEND[n] || REF_TEND.default);
    g.refPaceFast = crew.filter(r => r.pace === 'Fast').length >= 2 ? 1 : 0;
    g.refFoulHigh = crew.reduce((s, n) => s + (REF_TEND[n] || REF_TEND.default).fouls, 0) / 3 > 45 ? 1 : 0;
  });
  renderRefList(byGame, gmap);
  setBadge('refDb', 'demo');
  renderPMTable();
}

function renderRefList(byGame, gmap) {
  const el = document.getElementById('refList');
  if (!el) return;
  if (!Object.keys(byGame).length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--t2);text-align:center;padding:16px">No data</div>';
    return;
  }
  el.innerHTML = Object.entries(byGame).map(([gid, names]) => {
    const gm = gmap[gid] || {};
    const gameLabel = gm.home ? (gm.away || '?') + ' @ ' + gm.home : gid;
    const crew = names.slice(0, 3).map(n => REF_TEND[n] || REF_TEND.default);
    const avgFouls = (crew.reduce((s, r) => s + r.fouls, 0) / crew.length).toFixed(1);
    const crewPace = crew.filter(r => r.pace === 'Fast').length >= 2 ? 'Fast'
                   : crew.filter(r => r.pace === 'Slow').length >= 2 ? 'Slow' : 'Med';
    const pc = crewPace === 'Fast' ? 'var(--red)' : crewPace === 'Slow' ? 'var(--blue)' : 'var(--t2)';
    const roles = ['Crew Chief', 'Referee', 'Umpire'];
    const refs = names.slice(0, 3).map((n, idx) => {
      const t = REF_TEND[n] || REF_TEND.default;
      return '<span style="font-size:10px;margin-right:8px"><span style="color:var(--t2);font-size:9px">' +
        roles[idx] + ':</span> <strong>' + sanitize(n) + '</strong> ' +
        '<span style="color:' + (t.pace === 'Fast' ? 'var(--red)' : t.pace === 'Slow' ? 'var(--blue)' : 'var(--t2)') +
          ';font-size:8px;font-weight:700">' + t.pace + '</span> ' +
        '<span style="color:var(--t2);font-family:\'JetBrains Mono\',monospace;font-size:9px">' +
          t.fouls + 'F</span></span>';
    }).join('');
    const pbg = crewPace === 'Fast' ? 'rgba(255,69,96,.08)' : crewPace === 'Slow' ? 'rgba(76,142,255,.08)' : 'rgba(74,96,128,.07)';
    return '<div class="ref-card"><div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">' +
      '<span style="font-family:\'Rajdhani\',sans-serif;font-weight:700;font-size:13px">' + sanitize(gameLabel) + '</span>' +
      '<span style="font-size:9px;padding:1px 6px;border-radius:3px;font-weight:700;color:' + pc + ';background:' + pbg + '">PACE: ' + crewPace + '</span>' +
      '<span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--t2)">~' + avgFouls + ' fouls/g</span>' +
      '<span style="font-size:8px;color:var(--green);margin-left:auto">\u2192 Feeds into Model REF factor</span></div>' +
      '<div>' + refs + '</div></div>';
  }).join('');
}

// ── Odds Table ──
function toggleOddsForm() {
  const f = document.getElementById('oddsManualForm');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

function addManualOdds() {
  const g = document.getElementById('omGame').value.trim();
  const bk = document.getElementById('omBook').value.trim() || 'Manual';
  const hml = document.getElementById('omHomeML').value.trim();
  const aml = document.getElementById('omAwayML').value.trim();
  if (!g || !hml || !aml) { alert('Fill Game, Home ML, Away ML'); return; }
  manualOdds.push({ game: g, book: bk, homeML: hml, awayML: aml, ts: Date.now() });
  localStorage.setItem('manualOdds_v2', JSON.stringify(manualOdds));
  toggleOddsForm();
  renderOddsTable([]);
  if (typeof updateSettingsSizes === 'function') updateSettingsSizes();
}

function clearManualOdds() {
  manualOdds = [];
  localStorage.removeItem('manualOdds_v2');
  renderOddsTable([]);
  if (typeof updateSettingsSizes === 'function') updateSettingsSizes();
}

function renderOddsTable(apiGames) {
  const rows = [];
  apiGames.forEach(g => {
    (g.bookmakers || []).forEach(bm => {
      const h2h = bm.markets?.find(m => m.key === 'h2h');
      if (!h2h) return;
      const ho = h2h.outcomes.find(o => o.name === g.home_team);
      const ao = h2h.outcomes.find(o => o.name !== g.home_team);
      if (!ho || !ao) return;
      const pmM = gameData.find(gd => gd.label.toLowerCase().includes((g.home_team || '').split(' ').pop().toLowerCase()));
      const { finalProb } = pmM ? computeModelProb(pmM) : { finalProb: null };
      const pmPrice = pmM?.pmYesPrice ?? null;
      const vspm = pmPrice && finalProb ? (finalProb - pmPrice) * 100 : null;
      rows.push({
        game: sanitize(g.away_team + ' @ ' + g.home_team),
        book: bm.title, homeML: ho.price, awayML: ao.price,
        homeImpl: americanToImpl(ho.price), pmPrice, modelProb: finalProb, vspm, _live: true
      });
    });
  });
  manualOdds.forEach(m => {
    const impl = americanToImpl(m.homeML);
    const pmM = gameData.find(gd => {
      const gw = m.game.toLowerCase().split(/\s+/);
      return gw.some(w => w.length > 3 && (gd.home.toLowerCase().includes(w) || gd.away.toLowerCase().includes(w)));
    });
    const { finalProb } = pmM ? computeModelProb(pmM) : { finalProb: null };
    const vspm = pmM && finalProb ? (finalProb - pmM.pmYesPrice) * 100 : null;
    rows.push({
      game: sanitize(m.game), book: m.book, homeML: m.homeML, awayML: m.awayML,
      homeImpl: impl, pmPrice: pmM?.pmYesPrice ?? null, modelProb: finalProb, vspm, _live: false
    });
  });

  const tbody = document.getElementById('oddsTbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--t2);padding:18px;font-size:11px">' +
      'No games found. Use + Manual Entry or configure Odds API key.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const imp = r.homeImpl ? (r.homeImpl * 100).toFixed(1) + '%' : '\u2014';
    const pm = r.pmPrice ? '$' + r.pmPrice.toFixed(2) : '\u2014';
    const mod = r.modelProb ? (r.modelProb * 100).toFixed(0) + '%' : '\u2014';
    const vspm = r.vspm;
    const arbCls = vspm == null ? 'arb-n' : Math.abs(vspm) >= 5 ? 'arb-y' : Math.abs(vspm) >= 2 ? 'arb-w' : 'arb-n';
    const arbLbl = vspm == null ? '\u2014' : Math.abs(vspm) >= 5 ? (vspm > 0 ? '\u2191BUY' : '\u2193SHORT') : Math.abs(vspm) >= 2 ? 'WATCH' : '\u2014';
    const liveTag = r._live ? '<span class="db db-live" style="margin-left:3px">LIVE</span>' : '';
    return '<tr><td>' + r.game + liveTag + '</td>' +
      '<td style="font-size:10px;color:var(--t1)">' + sanitize(r.book) + '</td>' +
      '<td style="font-family:\'JetBrains Mono\',monospace">' + (r.homeML > 0 ? '+' : '') + r.homeML + '</td>' +
      '<td style="font-family:\'JetBrains Mono\',monospace;color:var(--t1)">' + (r.awayML > 0 ? '+' : '') + r.awayML + '</td>' +
      '<td style="color:var(--t2)">' + imp + '</td>' +
      '<td style="color:var(--blue);font-family:\'JetBrains Mono\',monospace">' + pm + '</td>' +
      '<td style="color:var(--purple);font-family:\'JetBrains Mono\',monospace">' + mod + '</td>' +
      '<td><span class="arb-badge ' + arbCls + '">' + arbLbl +
        (vspm != null && Math.abs(vspm) >= 2 ? ' ' + Math.abs(vspm).toFixed(1) + '%' : '') + '</span></td>' +
      '<td><button onclick="this.closest(\'tr\').remove()" class="trade-btn tb-skip" style="padding:2px 5px;font-size:9px">\u2715</button></td></tr>';
  }).join('');
  setBadge('oddsDb', rows.some(r => r._live) ? 'live' : 'demo');
}

// ── Form Trends ──
function renderFormTrends() {
  const el = document.getElementById('formTrends');
  if (!el) return;
  el.innerHTML = formData.teams.map((t, i) => {
    const arr = formData.scores[i];
    const avg = (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
    const trend = arr[4] > arr[0];
    const dots = arr.map(s => {
      const c = s > 10 ? '#00E5A0' : s > 5 ? '#4C8EFF' : s > 0 ? '#F5A623' : '#FF4560';
      return '<div class="g-dot" style="background:' + c + '" title="' + (s > 0 ? '+' : '') + s + '"></div>';
    }).join('');
    return '<div class="form-row"><span style="font-family:\'Rajdhani\',sans-serif;font-weight:700;font-size:13px;' +
      'min-width:32px;letter-spacing:.5px;color:' + formData.colors[i] + '">' + t + '</span>' +
      '<div style="display:flex;gap:4px;align-items:center">' + dots + '</div>' +
      '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11.5px;font-weight:700;margin-left:auto;' +
        'color:var(--green)">+' + avg + '</span>' +
      '<span style="font-size:13px;font-weight:700;color:' + (trend ? 'var(--green)' : 'var(--red)') + '">' +
        (trend ? '\u2191' : '\u2193') + '</span></div>';
  }).join('');
}

// ── Tips ──
function renderTips() {
  const tips = [
    '<strong>Min 5% net edge</strong> (after spread) before entering. Below that, slippage erases profit.',
    '<strong>Check liquidity first</strong> \u2014 low vol markets have wide spreads (3\u20137\u00A2). Stick to High liq.',
    '<strong>Best window: 2\u20136h before tip-off</strong> \u2014 before sharp money corrects price after injury news.',
    '<strong>Fractional Kelly only</strong> \u2014 20\u201325% of full Kelly. Full Kelly maximizes long-run but kills bankroll variance.',
    '<strong>Hedge live when ahead</strong> \u2014 buy the other side in-game to lock partial profit.',
    '<strong>Moneyline > spread markets</strong> \u2014 PM moneylines are less efficiently priced.',
    '<strong>Log every trade</strong> \u2014 track model prob vs entry price. After 50+ trades you can measure true calibration.'
  ];
  const el = document.getElementById('tradingTips');
  if (!el) return;
  el.innerHTML = tips.map((t, i) =>
    '<div style="display:flex;gap:7px;padding:6px 0;border-bottom:1px solid rgba(17,30,53,.5)' +
      (i === tips.length - 1 ? ';border-bottom:none' : '') + '">' +
      '<div style="width:18px;height:18px;border-radius:5px;background:var(--gdim);color:var(--green);' +
        'font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;' +
        'margin-top:1px">' + (i + 1) + '</div>' +
      '<div style="font-size:11px;color:var(--t1);line-height:1.5">' + t + '</div></div>'
  ).join('');
}

// ── Charts init ──
function initFormChart() {
  safeChart('formChart', {
    type: 'line',
    data: {
      labels: ['G-5','G-4','G-3','G-2','G-1'],
      datasets: formData.teams.map((t, i) => ({
        label: t, data: formData.scores[i],
        borderColor: formData.colors[i],
        backgroundColor: formData.colors[i] + '10',
        tension: .4, pointRadius: 3, borderWidth: 2
      }))
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top', labels: { color: '#4A6080', font: { size: 10 }, boxWidth: 10, padding: 12 } } },
      scales: {
        x: { grid: { color: 'rgba(17,30,53,.5)' }, ticks: { font: { size: 10 }, color: '#4A6080' } },
        y: { grid: { color: 'rgba(17,30,53,.5)' }, ticks: { font: { size: 10, family: 'JetBrains Mono' }, color: '#4A6080' } }
      }
    }
  });
}

function initInjChart() {
  safeChart('injChart', {
    type: 'bar',
    data: {
      labels: injuries.slice(0, 4).map(i => i.name.split(' ').pop()),
      datasets: [
        { label: 'With Player', data: [114.2, 118.9, 113.4, 112.1], backgroundColor: 'rgba(0,229,160,.55)', borderRadius: 3 },
        { label: 'Without', data: [110.0, 111.1, 107.3, 106.8], backgroundColor: 'rgba(255,69,96,.45)', borderRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#4A6080', font: { size: 9 }, boxWidth: 8, padding: 10 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#4A6080' } },
        y: { grid: { color: 'rgba(17,30,53,.5)' }, ticks: { font: { size: 9, family: 'JetBrains Mono' }, color: '#4A6080' }, min: 100 }
      }
    }
  });
}

// ── Settings ──
function renderWeightSliders() {
  const labels = {
    netRating: 'Net Rating', recency: 'Recency', injury: 'Injury',
    referee: 'Referee', home: 'Home Court', rest: 'Rest/B2B', timing: 'Market Timing'
  };
  const el = document.getElementById('weightSliders');
  if (!el) return;
  el.innerHTML = Object.entries(MW).map(([k, v]) =>
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
      '<span style="font-size:11px;color:var(--t1);min-width:110px;font-weight:500">' + labels[k] + '</span>' +
      '<input type="range" class="kc-slider" min="0" max="50" value="' + Math.round(v * 100) + '" ' +
        'oninput="MW[\'' + k + '\']=this.value/100;saveWeights();' +
        'document.getElementById(\'w_' + k + '\').textContent=this.value+\'%\'">' +
      '<span id="w_' + k + '" style="font-family:\'JetBrains Mono\',monospace;font-size:11px;' +
        'color:var(--amber);min-width:30px;text-align:right">' + Math.round(v * 100) + '%</span></div>'
  ).join('');
}

function updateSettingsSizes() {
  const pl = PredictionLog.get().length;
  const pt = PositionTracker.get().length;
  const mo = manualOdds.length;
  const pe = document.getElementById('predLogSize');
  if (pe) pe.textContent = pl + ' predictions stored';
  const pte = document.getElementById('posHistSize');
  if (pte) pte.textContent = pt + ' trades stored';
  const moe = document.getElementById('manualOddsSize');
  if (moe) moe.textContent = mo + ' entries';
}

// ── Search ──
function handleSearch(q) {
  if (!q) return;
  q = q.toLowerCase();
  const m = gameData.find(g => g.home.toLowerCase().includes(q) || g.away.toLowerCase().includes(q));
  if (m) {
    const i = gameData.indexOf(m);
    selectGame(i);
    showSection('model', null);
  }
}

console.log('\u2705 ui.js loaded (all renderers + safeChart)');
