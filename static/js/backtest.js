
// ═══════════════════════════════════════
// BACKTEST ENGINE
// FIX: Proper unique ID tracking for setOutcome
// ═══════════════════════════════════════

async function runBacktest() {
  const btn = document.getElementById('btRunBtn');
  btn.disabled = true;
  btn.textContent = '\u23F3 Running\u2026';

  const prog = document.getElementById('btProg');
  const pf = document.getElementById('btProgFill');
  const log = document.getElementById('btLog');
  const stEl = document.getElementById('btStatusTxt');

  prog.style.display = 'block';
  pf.style.width = '0';
  setStatus('Backtest', 'conn', 'Backtest \u00B7 Running\u2026');

  const season = document.getElementById('btSeason').value;
  const n = parseInt(document.getElementById('btGames').value) || 50;
  const thr = parseInt(document.getElementById('btThreshold').value) || 5;

  log.innerHTML = '<span style="color:var(--blue)">Initialising\u2026</span>';

  try {
    stEl.textContent = 'Fetching historical games\u2026';
    pf.style.width = '10%';

    let hist = [];
    try {
      hist = await fetchBDLHistorical(season, n);
    } catch (e) {
      console.warn('[BT fetch]', e.message);
    }

    if (!hist.length) {
      hist = genSimGames(n);
      stEl.textContent = 'Simulated data (add BDL key for real data)';
      setBadge('btDb', 'demo');
    } else {
      setBadge('btDb', 'live');
    }

    pf.style.width = '40%';
    stEl.textContent = 'Running model on ' + hist.length + ' games\u2026';

    const results = [];
    const logLines = [];
    // ← FIX: Track prediction IDs for proper setOutcome
    const predIds = [];

    for (let i = 0; i < hist.length; i++) {
      const hg = hist[i];
      const synthGame = hg.synth || buildSynth(hg);
      const { finalProb } = computeModelProb(synthGame);
      const edge = finalProb * 100 - hg.impliedOdds;
      const bet = Math.abs(edge) >= thr;
      const win = finalProb >= .5 ? hg.homeWon : !hg.homeWon;

      results.push({
        game: hg.label, prob: finalProb, edge, bet, win, homeWon: hg.homeWon
      });

      if (bet) {
        logLines.push({
          txt: hg.label + ' \u00B7 Model:' + (finalProb * 100).toFixed(0) + '% Edge:' +
               (edge > 0 ? '+' : '') + edge.toFixed(1) + '% \u2192 ' + (win ? 'WIN' : 'LOSS'),
          win
        });
      }

      // ← FIX: Save prediction with proper unique ID
      const predId = 'bt_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 6);
      predIds.push({ id: predId, homeWon: hg.homeWon });

      PredictionLog.add(
        { id: predId, label: hg.label, pmYesPrice: finalProb * 0.9 },
        finalProb,
        finalProb * 0.9
      );

      pf.style.width = (40 + i / hist.length * 50) + '%';
    }

    pf.style.width = '95%';
    stEl.textContent = 'Computing metrics\u2026';

    // ← FIX: Set outcomes with correct IDs after small delay
    predIds.forEach((p, idx) => {
      setTimeout(() => {
        PredictionLog.setOutcome(p.id, p.homeWon ? 1 : 0);
      }, 20 * idx);
    });

    // Calibration buckets
    const buckets = Array.from({length: 10}, (_, i) => ({bin: (i + .5) / 10 * 100, n: 0, wins: 0}));
    results.forEach(r => {
      const idx = Math.min(9, Math.floor(r.prob * 10));
      buckets[idx].n++;
      if (r.homeWon) buckets[idx].wins++;
    });

    // ROI curve
    const trades = results.filter(r => r.bet);
    let bk = 100, roiCurve = [100];
    trades.forEach(r => {
      const bs = bk * .05;
      bk += r.win ? bs : -bs;
      roiCurve.push(+bk.toFixed(2));
    });

    // Metrics
    const wins = trades.filter(r => r.win).length;
    const wr = trades.length ? (wins / trades.length * 100).toFixed(1) : '\u2014';
    const roi = trades.length ? (bk - 100).toFixed(1) : '\u2014';
    const brier = results.length
      ? (results.reduce((s, r) => s + (r.prob - (r.homeWon ? 1 : 0)) ** 2, 0) / results.length).toFixed(3)
      : '\u2014';

    document.getElementById('btWR').textContent = wr + (wr !== '\u2014' ? '%' : '');
    document.getElementById('btWR').style.color =
      parseFloat(wr) >= 55 ? 'var(--green)' : parseFloat(wr) >= 50 ? 'var(--amber)' : 'var(--red)';

    document.getElementById('btROI').textContent =
      roi !== '\u2014' ? (parseFloat(roi) > 0 ? '+' : '') + roi + '%' : '\u2014';
    document.getElementById('btROI').style.color = parseFloat(roi) > 0 ? 'var(--blue)' : 'var(--red)';

    document.getElementById('btBrier').textContent = brier;
    document.getElementById('btBrier').style.color =
      parseFloat(brier) < .22 ? 'var(--green)' : parseFloat(brier) < .25 ? 'var(--amber)' : 'var(--red)';

    document.getElementById('btN').textContent = results.length;
    document.getElementById('btEdgeN').textContent = trades.length;

    // Charts
    renderBTCalib(buckets.filter(b => b.n > 0));
    renderBTROI(roiCurve);

    // Log
    log.innerHTML = logLines.slice(-40).reverse().map(l =>
      '<div class="' + (l.win ? 'bt-w' : 'bt-l') + '">' +
        (l.win ? '\u2713' : '\u2717') + ' ' + l.txt + '</div>'
    ).join('') || '<span style="color:var(--t2)">No trades met threshold</span>';

    pf.style.width = '100%';
    setTimeout(() => prog.style.display = 'none', 600);

    setStatus('Backtest', 'live', 'Backtest \u00B7 ' + results.length + ' games \u00B7 WR ' + wr + '%');
    stEl.textContent = 'Done \u00B7 ' + results.length + ' games \u00B7 ' + trades.length + ' trades \u00B7 WR ' + wr + '%';

    // Update KPI
    const kb = document.getElementById('kpiBrier');
    const ks = document.getElementById('kpiBrierSub');
    if (kb) {
      kb.textContent = brier;
      kb.style.color = parseFloat(brier) < .22 ? 'var(--green)' : parseFloat(brier) < .25 ? 'var(--amber)' : 'var(--red)';
    }
    if (ks) ks.textContent = 'From ' + results.length + '-game backtest';

  } catch (e) {
    console.warn('[BT]', e.message);
    stEl.textContent = 'Error: ' + e.message;
    setStatus('Backtest', 'err', 'Backtest \u00B7 ' + e.message.slice(0, 25));
  }

  btn.disabled = false;
  btn.textContent = '\u25B6 Run Backtest';
}

async function fetchBDLHistorical(season, n) {
  const pages = Math.ceil(n / 25);
  const games = [];
  for (let p = 1; p <= pages && games.length < n; p++) {
    const data = await apiFetch(
      API.bdl('games?seasons[]=' + season + '&per_page=25&page=' + p), {}, 8000
    );
    const rows = (data.data || []).filter(g =>
      g.status === 'Final' && g.home_team_score && g.visitor_team_score
    );
    rows.forEach(g => {
      if (games.length >= n) return;
      const ha = g.home_team?.abbreviation || 'HOM';
      const aa = g.visitor_team?.abbreviation || 'AWY';
      games.push({
        label: aa + ' @ ' + ha,
        homeWon: g.home_team_score > g.visitor_team_score,
        impliedOdds: 50,
        synth: buildSynth({ home: ha, away: aa })
      });
    });
    if (!data.meta?.next_page) break;
  }
  return games;
}

function buildSynth(g) {
  const ht = teams.find(t => t.abbr === g.home) || {ortg: 115, drtg: 112};
  const at = teams.find(t => t.abbr === g.away) || {ortg: 113, drtg: 114};
  return {
    id: 'bt', home: g.home || 'H', away: g.away || 'A',
    netRating: {
      home: +(ht.ortg - ht.drtg).toFixed(1),
      away: +(at.ortg - at.drtg).toFixed(1)
    },
    recency: {home: [5,6,7,5,8], away: [4,5,3,6,4]},
    injuries: [], homeFlag: 1,
    rest: {home: 2, away: 2},
    pmPriceMove: 0, pmYesPrice: .5, pmVolume: 1000,
    hoursToClose: 4, refPaceFast: 0, refFoulHigh: 0
  };
}

function genSimGames(n) {
  const out = [];
  const tl = teams.length ? teams : [{abbr:'BOS',ortg:122,drtg:110},{abbr:'DEN',ortg:118,drtg:111}];
  for (let i = 0; i < n; i++) {
    const hi = Math.floor(Math.random() * tl.length);
    let ai = Math.floor(Math.random() * tl.length);
    while (ai === hi) ai = Math.floor(Math.random() * tl.length);
    const syn = buildSynth({home: tl[hi].abbr, away: tl[ai].abbr});
    syn.recency.home = Array.from({length: 5}, () => +(Math.random() * 16 - 3).toFixed(1));
    syn.recency.away = Array.from({length: 5}, () => +(Math.random() * 16 - 3).toFixed(1));
    syn.rest = {home: Math.floor(Math.random() * 3), away: Math.floor(Math.random() * 3)};
    syn.pmPriceMove = (Math.random() - .5) * .08;
    const { finalProb } = computeModelProb(syn);
    const hw = Math.random() < (finalProb * .75 + .125);
    out.push({
      label: tl[ai].abbr + ' @ ' + tl[hi].abbr,
      homeWon: hw, impliedOdds: 50, synth: syn
    });
  }
  return out;
}

function renderBTCalib(b) {
  safeChart('btCalibChart', {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Model',
          data: b.map(b => ({x: b.bin, y: b.n ? b.wins / b.n * 100 : 0})),
          backgroundColor: 'rgba(0,229,160,.7)',
          pointRadius: 6
        },
        {
          label: 'Perfect',
          data: [{x: 0, y: 0}, {x: 100, y: 100}],
          type: 'line', borderColor: 'rgba(74,96,128,.3)',
          borderDash: [4, 4], pointRadius: 0, borderWidth: 1
        }
      ]
    },
    options: chartOpts({
      x: {min: 0, max: 100, title: 'Predicted %'},
      y: {min: 0, max: 100, title: 'Actual Win%'}
    })
  });
}

function renderBTROI(curve) {
  const col = curve[curve.length - 1] >= 100 ? '#00E5A0' : '#FF4560';
  safeChart('btROIChart', {
    type: 'line',
    data: {
      labels: curve.map((_, i) => i === 0 ? 'Start' : 'T' + i),
      datasets: [
        {
          label: 'Bankroll', data: curve,
          borderColor: col, backgroundColor: col + '15',
          tension: .4, pointRadius: 0, borderWidth: 2, fill: true
        },
        {
          label: 'Baseline', data: curve.map(() => 100),
          borderColor: 'rgba(74,96,128,.25)',
          borderDash: [4, 4], pointRadius: 0, borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#4A6080', font: { size: 9 }, boxWidth: 8, padding: 8 } } },
      scales: {
        x: { display: false },
        y: { grid: { color: 'rgba(17,30,53,.5)' },
             ticks: { font: { size: 9, family: 'JetBrains Mono' }, color: '#4A6080' } }
      }
    }
  });
}

console.log('\u2705 backtest.js loaded (setOutcome bug FIXED)');
