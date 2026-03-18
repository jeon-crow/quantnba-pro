
// ═══════════════════════════════════════
// PREDICTION LOG — Persistent calibration tracking
// ═══════════════════════════════════════

const PredictionLog = {
  key: 'predLog_v2',

  get() {
    return JSON.parse(localStorage.getItem(this.key) || '[]');
  },

  save(arr) {
    localStorage.setItem(this.key, JSON.stringify(arr));
  },

  add(g, finalProb, pmPrice) {
    const arr = this.get();
    // ← FIX: Generate unique stable ID
    const id = g.id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    arr.push({
      id: id,
      game: g.label,
      ts: Date.now(),
      modelProb: +finalProb.toFixed(3),
      pmPrice: +pmPrice.toFixed(3),
      outcome: null
    });
    if (arr.length > 500) arr.splice(0, arr.length - 500); // cap storage
    this.save(arr);
    this.renderAll();
  },

  setOutcome(id, outcome) {
    const arr = this.get();
    const rec = arr.find(r => r.id === id);
    if (rec) {
      rec.outcome = outcome;
      this.save(arr);
      this.renderAll();
      this.updateCalib();
    }
  },

  clearAll() {
    this.save([]);
    this.renderAll();
    this.updateCalib();
    if (typeof updateSettingsSizes === 'function') updateSettingsSizes();
  },

  updateCalib() {
    const arr = this.get().filter(r => r.outcome !== null);
    const el_wr = document.getElementById('calibWR');
    const el_b = document.getElementById('calibBrier');
    const el_n = document.getElementById('calibN');

    if (!arr.length) {
      if (el_wr) el_wr.textContent = '\u2014';
      if (el_b) el_b.textContent = '\u2014';
      if (el_n) el_n.textContent = 0;
      setBadge('calibDb', 'demo');
      return;
    }

    const wins = arr.filter(r =>
      (r.modelProb >= 0.5 && r.outcome === 1) ||
      (r.modelProb < 0.5 && r.outcome === 0)
    ).length;
    const wr = (wins / arr.length * 100).toFixed(1) + '%';
    const brier = (arr.reduce((s, r) => s + (r.modelProb - r.outcome) ** 2, 0) / arr.length).toFixed(3);

    if (el_wr) {
      el_wr.textContent = wr;
      el_wr.style.color = parseFloat(wr) >= 55 ? 'var(--green)' :
                          parseFloat(wr) >= 50 ? 'var(--amber)' : 'var(--red)';
    }
    if (el_b) {
      el_b.textContent = brier;
      el_b.style.color = parseFloat(brier) < 0.22 ? 'var(--green)' :
                         parseFloat(brier) < 0.25 ? 'var(--amber)' : 'var(--red)';
    }
    if (el_n) el_n.textContent = arr.length;

    setBadge('calibDb', 'live');

    // Update KPI
    const kb = document.getElementById('kpiBrier');
    const ks = document.getElementById('kpiBrierSub');
    if (kb) {
      kb.textContent = brier;
      kb.style.color = parseFloat(brier) < 0.22 ? 'var(--green)' :
                       parseFloat(brier) < 0.25 ? 'var(--amber)' : 'var(--red)';
    }
    if (ks) ks.textContent = arr.length + ' predictions logged';

    this.renderCalibChart(arr);
    setStatus('Calib', 'live', 'Calibration \u00B7 ' + arr.length + ' pred');
  },

  renderCalibChart(arr) {
    const ctx = document.getElementById('calibChart');
    if (!ctx) return;
    const buckets = Array.from({length: 10}, (_, i) => ({x: (i + .5) * 10, n: 0, wins: 0}));
    arr.forEach(r => {
      const i = Math.min(9, Math.floor(r.modelProb * 10));
      buckets[i].n++;
      if (r.outcome === 1) buckets[i].wins++;
    });
    const filtered = buckets.filter(b => b.n > 0);
    safeChart('calibChart', {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'Model',
            data: filtered.map(b => ({x: b.x, y: b.n ? b.wins / b.n * 100 : 0})),
            backgroundColor: 'rgba(0,229,160,.7)',
            pointRadius: 6
          },
          {
            label: 'Perfect',
            data: [{x: 0, y: 0}, {x: 100, y: 100}],
            type: 'line',
            borderColor: 'rgba(74,96,128,.3)',
            borderDash: [4, 4],
            pointRadius: 0,
            borderWidth: 1
          }
        ]
      },
      options: chartOpts({
        x: {min: 0, max: 100, title: 'Predicted %'},
        y: {min: 0, max: 100, title: 'Actual Win%'}
      })
    });
  },

  renderAll() {
    const arr = this.get();
    const el = document.getElementById('predLogList');
    if (!el) return;

    if (!arr.length) {
      el.innerHTML = '<div style="font-size:11px;color:var(--t2);text-align:center;padding:16px">' +
        'No predictions logged yet.<br>Predictions saved automatically when model runs.</div>';
      if (typeof updateSettingsSizes === 'function') updateSettingsSizes();
      return;
    }

    el.innerHTML = [...arr].reverse().slice(0, 50).map(r => {
      const pend = r.outcome === null;
      const win = r.outcome === 1;
      const cls = pend ? 'pred-pend' : win ? 'pred-win' : 'pred-loss';
      const sym = pend ? '?' : win ? '\u2713' : '\u2717';
      const dt = new Date(r.ts).toLocaleString('id-ID', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const safeGame = sanitize(r.game);
      const safeId = sanitize(r.id);

      return '<div class="pred-row">' +
        '<div class="pred-outcome ' + cls + '">' + sym + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;font-size:11px">' + safeGame + '</div>' +
          '<div style="font-size:9px;color:var(--t2)">' + dt +
            ' \u00B7 Model:' + (r.modelProb * 100).toFixed(0) + '% \u00B7 PM:$' + r.pmPrice +
          '</div>' +
        '</div>' +
        (pend ? '<div style="display:flex;gap:3px">' +
          '<button onclick="PredictionLog.setOutcome(\'' + safeId + '\',1)" ' +
            'class="trade-btn tb-yes" style="padding:2px 7px;font-size:9px">WIN</button>' +
          '<button onclick="PredictionLog.setOutcome(\'' + safeId + '\',0)" ' +
            'class="trade-btn tb-no" style="padding:2px 7px;font-size:9px">LOSS</button>' +
        '</div>' : '') +
      '</div>';
    }).join('');

    if (typeof updateSettingsSizes === 'function') updateSettingsSizes();
  },

  exportCSV() {
    const arr = this.get();
    if (!arr.length) { alert('No predictions to export'); return; }
    const csv = [
      'id,game,timestamp,model_prob,pm_price,outcome',
      ...arr.map(r =>
        r.id + ',"' + r.game + '",' + new Date(r.ts).toISOString() + ',' +
        r.modelProb + ',' + r.pmPrice + ',' + (r.outcome ?? 'pending')
      )
    ].join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'predictions.csv';
    a.click();
  }
};


// ═══════════════════════════════════════
// POSITION TRACKER
// ═══════════════════════════════════════

const PositionTracker = {
  key: 'positions_v2',

  get() { return JSON.parse(localStorage.getItem(this.key) || '[]'); },
  save(arr) { localStorage.setItem(this.key, JSON.stringify(arr)); },

  addPosition() {
    const game = document.getElementById('posGame').value.trim();
    const side = document.getElementById('posSide').value;
    const entry = parseFloat(document.getElementById('posEntryPrice').value);
    const size = parseFloat(document.getElementById('posSize').value);
    const model = parseFloat(document.getElementById('posModelProb').value) / 100;
    if (!game || isNaN(entry) || isNaN(size)) { alert('Fill all fields'); return; }

    const arr = this.get();
    arr.push({
      id: 'pos_' + Date.now(),
      game, side, entry, size, model,
      ts: Date.now(), closed: false, closePrice: null
    });
    this.save(arr);
    closeModalId('addPosOverlay');
    this.render();
    this.updateKPIs();
  },

  closePosition(id, price) {
    const arr = this.get();
    const pos = arr.find(p => p.id === id);
    if (!pos) return;
    pos.closed = true;
    pos.closePrice = parseFloat(price || prompt('Close price ($0.01-$0.99):', '')) || pos.entry;
    this.save(arr);
    this.render();
    this.updateKPIs();
  },

  deletePosition(id) {
    const arr = this.get().filter(p => p.id !== id);
    this.save(arr);
    this.render();
    this.updateKPIs();
  },

  calcPL(pos, currentPrice) {
    const cp = pos.closed ? pos.closePrice : (currentPrice || pos.entry);
    const shares = pos.size / pos.entry;
    return pos.side === 'yes' ? (cp - pos.entry) * shares : (pos.entry - cp) * shares;
  },

  getExposure() {
    return this.get().filter(p => !p.closed).reduce((s, p) => s + p.size, 0);
  },

  render() {
    const arr = this.get();
    const open = arr.filter(p => !p.closed);
    const closed = arr.filter(p => p.closed);
    const el = document.getElementById('positionsList');
    if (!el) return;

    if (!open.length) {
      el.innerHTML = '<div style="font-size:11px;color:var(--t2);text-align:center;padding:16px">' +
        'No open positions.</div>';
    } else {
      el.innerHTML = open.map(p => {
        const pl = this.calcPL(p, null);
        const plColor = pl >= 0 ? 'var(--green)' : 'var(--red)';
        const safeGame = sanitize(p.game);
        return '<div class="pos-row">' +
          '<span class="pos-side ' + (p.side === 'yes' ? 'pos-yes' : 'pos-no') + '">' +
            (p.side === 'yes' ? 'YES' : 'NO') + '</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;' +
              'text-overflow:ellipsis">' + safeGame + '</div>' +
            '<div style="font-size:9px;color:var(--t2)">Entry $' + p.entry.toFixed(2) +
              ' \u00B7 Size $' + p.size + ' \u00B7 Model ' + (p.model * 100).toFixed(0) + '%</div>' +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0">' +
            '<div class="pos-pnl" style="color:' + plColor + '">' +
              (pl >= 0 ? '+' : '') + '$' + pl.toFixed(2) + '</div>' +
            '<div style="display:flex;gap:4px;margin-top:3px">' +
              '<button onclick="PositionTracker.closePosition(\'' + p.id + '\')" ' +
                'class="trade-btn" style="padding:2px 6px;font-size:8px;background:var(--adim);' +
                'border:1px solid rgba(245,166,35,.2);color:var(--amber)">Close</button>' +
              '<button onclick="PositionTracker.deletePosition(\'' + p.id + '\')" ' +
                'class="trade-btn tb-skip" style="padding:2px 6px;font-size:8px">Del</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    // P&L chart
    const plData = [0, ...closed.map(p => this.calcPL(p, p.closePrice))];
    let cum = 0;
    const cumData = plData.map(v => { cum += v; return +cum.toFixed(2); });
    const col = cum >= 0 ? '#00E5A0' : '#FF4560';

    safeChart('plChart', {
      type: 'line',
      data: {
        labels: cumData.map((_, i) => i === 0 ? 'Start' : 'T' + i),
        datasets: [{
          data: cumData,
          borderColor: col,
          backgroundColor: col + '15',
          tension: .4, pointRadius: 0, borderWidth: 2, fill: true
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { display: false },
          y: { grid: { color: 'rgba(17,30,53,.5)' },
               ticks: { font: { size: 9, family: 'JetBrains Mono' }, color: '#4A6080' } }
        }
      }
    });

    document.getElementById('posCount').textContent = open.length;
    document.getElementById('posCount2').textContent = arr.length;
    if (typeof updateSettingsSizes === 'function') updateSettingsSizes();
  },

  updateKPIs() {
    const arr = this.get();
    const open = arr.filter(p => !p.closed);
    const closed = arr.filter(p => p.closed);
    const exposure = open.reduce((s, p) => s + p.size, 0);
    const totalPL = closed.reduce((s, p) => s + this.calcPL(p, p.closePrice), 0);

    const el_pl = document.getElementById('posTotalPL');
    if (el_pl) {
      el_pl.textContent = (totalPL >= 0 ? '+' : '') + '$' + Math.abs(totalPL).toFixed(2);
      el_pl.style.color = totalPL >= 0 ? 'var(--green)' : 'var(--red)';
    }

    const el_exp = document.getElementById('posExposure');
    if (el_exp) el_exp.textContent = '$' + exposure;

    const kpos = document.getElementById('kpiPos');
    const kposs = document.getElementById('kpiPosSub');
    if (kpos) kpos.textContent = open.length;
    if (kposs) kposs.textContent = '$' + exposure.toFixed(0) + ' USDC deployed';

    // WR from calibration
    const preds = PredictionLog.get().filter(r => r.outcome !== null);
    const wins = preds.filter(r =>
      (r.modelProb >= .5 && r.outcome === 1) || (r.modelProb < .5 && r.outcome === 0)
    ).length;
    if (preds.length) {
      const wr = (wins / preds.length * 100).toFixed(1);
      const kwrEl = document.getElementById('kpiWR');
      const kwrS = document.getElementById('kpiWRSub');
      if (kwrEl) {
        kwrEl.textContent = wr + '%';
        kwrEl.style.color = parseFloat(wr) >= 55 ? 'var(--green)' :
                           parseFloat(wr) >= 50 ? 'var(--amber)' : 'var(--red)';
      }
      if (kwrS) kwrS.textContent = preds.length + ' resolved predictions';
    }
  },

  clearAll() {
    this.save([]);
    this.render();
    this.updateKPIs();
    if (typeof updateSettingsSizes === 'function') updateSettingsSizes();
  }
};


// ═══════════════════════════════════════
// ALERT SYSTEM
// ═══════════════════════════════════════

const AlertSystem = {
  key: 'alerts_v2',
  prev: { prices: {}, injStatuses: {} },

  get() { return JSON.parse(localStorage.getItem(this.key) || '[]'); },
  save(arr) { localStorage.setItem(this.key, JSON.stringify(arr)); },

  fire(type, title, body) {
    const arr = this.get();
    arr.unshift({ type, title, body, ts: Date.now() });
    if (arr.length > 100) arr.length = 100;
    this.save(arr);
    this.renderAll();
    this.updateDot();

    // Browser notification
    if (document.getElementById('togPush')?.checked) {
      if (Notification.permission === 'granted') {
        new Notification('QuantNBA: ' + title, { body });
      }
    }
  },

  checkEdge(markets) {
    if (!document.getElementById('togEdge')?.checked) return;
    const thr = parseInt(document.getElementById('alertThreshold')?.value || 5);
    markets.forEach(m => {
      const e = Math.abs((m.modelProb - m.yesPrice) * 100);
      if (e >= thr) {
        this.fire('a-edge',
          'Edge Alert: ' + (m.question || '').slice(0, 40),
          'Net edge: ' + (e > 0 ? '+' : '') + e.toFixed(1) + '% \u00B7 PM: $' +
          m.yesPrice.toFixed(2) + ' \u00B7 Model: ' + (m.modelProb * 100).toFixed(0) + '%'
        );
      }
    });
  },

  checkInjury(liveInj) {
    if (!document.getElementById('togInj')?.checked) return;
    liveInj.forEach(inj => {
      const prev = this.prev.injStatuses[inj.name];
      if (prev && prev !== 'OUT' && inj.status === 'OUT') {
        this.fire('a-injury',
          'Injury Update: ' + inj.name,
          inj.name + ' upgraded from ' + prev + ' \u2192 OUT \u00B7 Impact: ' + inj.impact + ' Net Rtg'
        );
      }
      this.prev.injStatuses[inj.name] = inj.status;
    });
  },

  checkPrice(markets) {
    if (!document.getElementById('togPrice')?.checked) return;
    markets.forEach(m => {
      const prev = this.prev.prices[m.question];
      if (prev !== undefined && Math.abs(m.yesPrice - prev) >= 0.05) {
        this.fire('a-price',
          'Price Move: ' + (m.question || '').slice(0, 35),
          ((m.yesPrice - prev) > 0 ? '+' : '') +
          ((m.yesPrice - prev) * 100).toFixed(0) + '\u00A2 move \u00B7 Now $' +
          m.yesPrice.toFixed(2) + ' (was $' + prev.toFixed(2) + ')'
        );
      }
      this.prev.prices[m.question] = m.yesPrice;
    });
  },

  renderAll() {
    const arr = this.get();
    const feeds = ['alertFeed', 'alertSummary'];
    feeds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!arr.length) {
        el.innerHTML = '<div style="font-size:11px;color:var(--t2);text-align:center;padding:16px">' +
          'No alerts yet.</div>';
        return;
      }
      const limit = id === 'alertSummary' ? 4 : arr.length;
      const colors = {
        'a-edge': 'var(--green)', 'a-injury': 'var(--red)',
        'a-price': 'var(--amber)', 'a-info': 'var(--blue)'
      };
      el.innerHTML = arr.slice(0, limit).map(a => {
        const dt = new Date(a.ts).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'});
        return '<div class="alert-item-row ' + a.type + '">' +
          '<div style="flex:1">' +
            '<div style="font-weight:600;font-size:12px;color:' + (colors[a.type] || 'var(--t0)') + '">' +
              sanitize(a.title) + '</div>' +
            '<div style="font-size:10px;color:var(--t1);margin-top:1px">' + sanitize(a.body) + '</div>' +
            '<div class="alert-ts">' + dt + '</div>' +
          '</div></div>';
      }).join('');
    });

    const cnt = arr.length;
    const countEl = document.getElementById('alertCount');
    if (countEl) { countEl.textContent = cnt; countEl.style.display = cnt ? '' : 'none'; }
  },

  updateDot() {
    const arr = this.get();
    ['alertDot', 'alertDot2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = arr.length ? 'block' : 'none';
        if (arr.length) el.classList.add('active');
      }
    });
  },

  clear() {
    this.save([]);
    this.renderAll();
    this.updateDot();
  }
};

function togglePushNotifs(el) {
  if (el.checked && Notification.permission !== 'granted') {
    Notification.requestPermission().then(p => {
      if (p !== 'granted') { el.checked = false; alert('Notifications blocked by browser.'); }
    });
  }
}

console.log('\u2705 systems.js loaded (PredictionLog, PositionTracker, AlertSystem)');
