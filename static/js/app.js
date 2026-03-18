
// ═══════════════════════════════════════
// APP INIT & ORCHESTRATION
// ═══════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  console.log('\u{1F680} QuantNBA Pro v2.1 initializing...');

  Chart.defaults.color = '#4A6080';
  Chart.defaults.font.family = 'Inter';

  // Render static content
  renderLiveGames();
  renderEfficiency();
  renderPlayers();
  renderInjuries();
  renderFormTrends();
  renderTips();
  renderWeightSliders();

  // Model & scanner
  renderPMTable();
  renderGameSelector();
  renderEngineDetail();

  // Persistent systems
  PredictionLog.renderAll();
  PredictionLog.updateCalib();
  PositionTracker.render();
  PositionTracker.updateKPIs();
  AlertSystem.renderAll();
  AlertSystem.updateDot();

  // Static views
  renderOddsTable([]);
  applyRefDemoData();

  // Charts
  initFormChart();
  initInjChart();
  calcKelly();

  // Settings
  updateSettingsSizes();

  // Status bar defaults
  setStatus('Referees', 'idle', 'Referees \u00B7 Demo');
  setStatus('Backtest', 'idle', 'Backtest \u00B7 Ready');
  setStatus('Calib', 'idle', 'Calibration \u00B7 ' + PredictionLog.get().length + ' pred');

  // Check backend & fire API calls
  checkBackendStatus().then(status => {
    if (!status) {
      console.warn('Backend unreachable, running in demo mode');
      setStatus('BDL', 'err', 'Backend offline');
      setStatus('Polymarket', 'err', 'Backend offline');
      return;
    }

    console.log('Backend status:', status);

    const fetches = [fetchPolymarket(), fetchNBAInjuries()];

    if (status.bdl === 'ready') {
      fetches.push(fetchBDLGames());
      setStatus('BDL', 'idle', 'BallDontLie \u00B7 Key ready');
    } else {
      setStatus('BDL', 'idle', 'BallDontLie \u00B7 No key');
    }

    if (status.odds === 'ready') {
      fetches.push(fetchOddsAPI());
      setStatus('Odds', 'idle', 'Odds API \u00B7 Key ready');
    } else {
      setStatus('Odds', 'idle', 'Odds API \u00B7 No key');
    }

    Promise.allSettled(fetches).then(() => {
      const ts = new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      const el = document.getElementById('syncTs');
      if (el) el.textContent = 'Last sync: ' + ts;

      // Auto-refresh every 90s
      clearTimeout(_refreshTimer);
      _refreshTimer = setTimeout(refreshAll, 90000);
    });
  });

  // Mobile sidebar toggle
  document.querySelectorAll('.menu-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('.sidebar').classList.toggle('open');
    });
  });

  
  // Init WebSocket for real-time scores
  if (typeof initWebSocket === 'function') {
    initWebSocket();
  }

  console.log('\u2705 QuantNBA Pro v2.1 initialized (WS + ML)');
});
