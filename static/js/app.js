// app.js v3.2 — Init & Orchestration | Season 2025-26
// FIXED: removed duplicate buildLiveMarkets (now only in api.js)

document.addEventListener('DOMContentLoaded', async () => {
  console.log('\uD83D\uDE80 QuantNBA Pro v3.2 initializing... Season: 2025-26');

  Chart.defaults.color = '#4A6080';
  Chart.defaults.font.family = 'Inter';

  renderLiveGames(); renderEfficiency(); renderPlayers();
  renderInjuries(); renderFormTrends(); renderTips();
  renderWeightSliders(); renderPMTable();
  renderGameSelector(); renderEngineDetail();

  PredictionLog.renderAll(); PredictionLog.updateCalib();
  PositionTracker.render(); PositionTracker.updateKPIs();
  AlertSystem.renderAll(); AlertSystem.updateDot();

  renderOddsTable([]); applyRefDemoData();
  initFormChart(); initInjChart(); calcKelly();
  updateSettingsSizes();

  setStatus('ESPN',     'idle', 'ESPN \u00B7 Ready');
  setStatus('NBAApi',   'idle', 'nba_api \u00B7 Ready');
  setStatus('Referees', 'idle', 'Referees \u00B7 Demo');
  setStatus('Backtest', 'idle', 'Backtest \u00B7 Ready');
  setStatus('Calib',    'idle', 'Calibration \u00B7 ' + PredictionLog.get().length + ' pred');

  const status = await checkBackendStatus();
  if (!status) {
    console.warn('Backend unreachable - demo mode');
    setStatus('ESPN',   'err', 'Backend offline');
    setStatus('NBAApi', 'err', 'Backend offline');
    return;
  }

  if (typeof initWebSocket === 'function') initWebSocket();

  // Tahap 1: team stats
  try { await fetchNBATeamStats(); }
  catch(e) { console.warn('Team stats gagal:', e.message); }

  // Tahap 2: bangun gameData dari ESPN
  const built = await buildGameDataFromESPN();
  if (built) {
    console.log('\u2705 gameData: ' + gameData.length + ' game hari ini dari ESPN');
    renderLiveGames();
    renderGameSelector();
    renderEngineDetail();
  } else {
    console.warn('\u26A0\uFE0F Pakai gameData fallback dari data.js');
  }

  // Tahap 3: recency, injury, PM paralel
  await Promise.allSettled([
    fetchNBARecency(),
    fetchESPNInjuries(),
    fetchPolymarket(),
  ]);

  // Tahap 4: ML predictions
  if (typeof prefetchMLPredictions === 'function') {
    await prefetchMLPredictions();
  }

  const ts = new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const el = document.getElementById('syncTs');
  if (el) el.textContent = 'Init: ' + ts;

  clearTimeout(_refreshTimer);
  if (!document.hidden) _refreshTimer = setTimeout(refreshAll, 60000);

  document.querySelectorAll('.menu-toggle').forEach(btn => {
    btn.addEventListener('click', () =>
      document.querySelector('.sidebar')?.classList.toggle('open')
    );
  });

  console.log('\u2705 QuantNBA Pro v3.2 initialized | ' + gameData.length + ' games | PM integrated');
});
