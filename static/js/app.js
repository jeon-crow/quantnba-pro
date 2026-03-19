// app.js v3.0 — Init & Orchestration

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 QuantNBA Pro v3.0 initializing...');
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

  setStatus('ESPN',     'idle', 'ESPN · Ready');
  setStatus('NBAApi',   'idle', 'nba_api · Ready');
  setStatus('Referees', 'idle', 'Referees · Demo');
  setStatus('Backtest', 'idle', 'Backtest · Ready');
  setStatus('Calib',    'idle', `Calibration · ${PredictionLog.get().length} pred`);

  const status = await checkBackendStatus();
  if (!status) {
    console.warn('Backend unreachable — demo mode');
    setStatus('ESPN', 'err', 'Backend offline');
    setStatus('NBAApi', 'err', 'Backend offline');
    return;
  }

  if (typeof initWebSocket === 'function') initWebSocket();

  await Promise.allSettled([
    fetchESPNScoreboard(),
    fetchESPNInjuries(),
    fetchPolymarket(),
    fetchNBATeamStats(),
  ]);

  if (typeof prefetchMLPredictions === 'function') await prefetchMLPredictions();

  const ts = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const el = document.getElementById('syncTs');
  if (el) el.textContent = 'Init: ' + ts;

  clearTimeout(_refreshTimer);
  if (!document.hidden) _refreshTimer = setTimeout(refreshAll, 90000);

  document.querySelectorAll('.menu-toggle').forEach(btn => {
    btn.addEventListener('click', () => document.querySelector('.sidebar')?.classList.toggle('open'));
  });

  console.log('✅ QuantNBA Pro v3.0 initialized');
});

function buildLiveMarkets() {
  const derived = gameData.map(g => {
    const { finalProb, F, confidence, method, mlProb } = getGameProb(g);
    return {
      question: g.label + ' to win', gameId: g.id, closes: g.time,
      yesPrice: g.pmYesPrice || 0.5, volume: g.pmVolume || 0,
      liquidity: (g.pmVolume || 0) > 50000 ? 'High' : (g.pmVolume || 0) > 20000 ? 'Medium' : 'Low',
      modelProb: finalProb, confidence, F, method, mlProb,
      hoursToClose: g.hoursToClose || 4, spread: g.spread || null, _live: false,
    };
  });
  if (liveMarkets.length) {
    liveMarkets.forEach(lm => {
      const idx = derived.findIndex(d => {
        const q = (lm.question || '').toLowerCase();
        return d.question.toLowerCase().split(' ').slice(0, 2).some(w => q.includes(w) && w.length > 3);
      });
      if (idx >= 0) {
        derived[idx].yesPrice = lm.yesPrice || derived[idx].yesPrice;
        derived[idx].spread   = lm.spread   || derived[idx].spread;
        derived[idx].volume   = lm.volume   || derived[idx].volume;
        derived[idx]._live    = true;
      }
    });
  }
  return derived;
}
