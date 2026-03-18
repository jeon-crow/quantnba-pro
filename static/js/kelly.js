
// ═══════════════════════════════════════
// KELLY CALCULATOR
// ═══════════════════════════════════════

function loadKelly(modelProb, yesPrice, spread) {
  document.getElementById('kcModelProb').value = (modelProb * 100).toFixed(0);
  document.getElementById('kcYesPrice').value = yesPrice.toFixed(2);
  document.getElementById('kcSpread').value = Math.round((spread || 0) * 100);
  calcKelly();
}

function calcKelly() {
  const B = parseFloat(document.getElementById('kcBankroll').value) || 1000;
  const p = parseFloat(document.getElementById('kcModelProb').value) / 100 || .67;
  const y = parseFloat(document.getElementById('kcYesPrice').value) || .58;
  const spreadCts = parseFloat(document.getElementById('kcSpread').value) || 0;
  const frac = parseFloat(document.getElementById('kcFrac').value) / 100 || .25;

  document.getElementById('kcFracVal').textContent = Math.round(frac * 100) + '%';

  const effectiveYes = y + (spreadCts / 100 / 2);
  const b = (1 - effectiveYes) / effectiveYes;
  const k = (p * b - (1 - p)) / b;
  const fk = Math.max(0, k * frac);
  const bet = B * fk;
  const fullKelly = Math.max(0, B * k);
  const ev = bet * (p / effectiveYes - 1) - (bet * (1 - p));
  const roi = bet > 0 ? (ev / bet * 100) : 0;
  const netEdge = (p - effectiveYes) * 100;

  document.getElementById('kcBetSize').textContent = '$' + bet.toFixed(2);

  const evEl = document.getElementById('kcEV');
  evEl.textContent = (ev >= 0 ? '+' : '') + '$' + ev.toFixed(2);
  evEl.style.color = ev >= 0 ? 'var(--green)' : 'var(--red)';

  const roiEl = document.getElementById('kcROI');
  roiEl.textContent = (roi >= 0 ? '+' : '') + roi.toFixed(1) + '%';
  roiEl.style.color = roi >= 0 ? 'var(--blue)' : 'var(--red)';

  document.getElementById('kcFullKelly').textContent = '$' + fullKelly.toFixed(2);

  const neEl = document.getElementById('kcNetEdge');
  neEl.textContent = (netEdge >= 0 ? '+' : '') + netEdge.toFixed(1) + '%';
  neEl.style.color = netEdge >= 5 ? 'var(--green)' : netEdge >= 0 ? 'var(--amber)' : 'var(--red)';

  const ruin = fk > .15 ? 'High' : fk > .08 ? 'Med' : 'Low';
  const ruinEl = document.getElementById('kcRuin');
  ruinEl.textContent = ruin;
  ruinEl.style.color = ruin === 'High' ? 'var(--red)' : ruin === 'Med' ? 'var(--amber)' : 'var(--green)';

  const warn = document.getElementById('kcWarn');
  if (netEdge < 3) {
    warn.className = 'kc-warn show';
    warn.textContent = '\u26A0 Net edge below 3% \u2014 spread+slippage likely erases profit';
  } else if (fk > .15) {
    warn.className = 'kc-warn show';
    warn.textContent = '\u26A0 Position >15% bankroll \u2014 consider reducing Kelly fraction';
  } else {
    warn.className = 'kc-warn';
  }
}

console.log('\u2705 kelly.js loaded');
