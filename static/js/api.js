// ══════════════════════════════════════════════════════════════════
// api.js v3.2 — ESPN + nba_api + Polymarket (FIXED)
// Fix: _applyTeamStats fatal syntax, ID mismatch, refreshAll,
//      shadow variables, duplicate fetch, missing renders
// ══════════════════════════════════════════════════════════════════

const NBA_SEASON = "2025-26";

// ──────────────────────────────────────────────
// STATUS HELPERS
// ──────────────────────────────────────────────

function setStatus(id, state, txt) {
  const el  = document.getElementById('s' + id);
  const tel = document.getElementById('s' + id + 'T');
  if (el)  el.className = 'anode ' + state;
  if (tel && txt) tel.textContent = txt;
}

function setBadge(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'db ' + (state === 'live' ? 'db-live' : state === 'error' ? 'db-err' : 'db-demo');
  el.textContent = state === 'live' ? '● LIVE' : state === 'error' ? '! ERR' : 'DEMO';
}

// ──────────────────────────────────────────────
// BACKEND HEALTH CHECK
// ──────────────────────────────────────────────

async function checkBackendStatus() {
  try {
    return await apiFetch(API.status(), {}, 5000);
  } catch (e) {
    console.error('Backend unreachable:', e);
    return null;
  }
}

// ──────────────────────────────────────────────
// ESPN SCOREBOARD → BUILD gameData
// ──────────────────────────────────────────────

async function buildGameDataFromESPN() {
  try {
    const data = await apiFetch(API.espnScoreboard(), {}, 10000);
    if (data.error || !data.events?.length) {
      console.warn('[ESPN] Tidak ada game hari ini, pakai data fallback');
      return false;
    }

    const newGameData = [];

    for (const event of data.events) {
      const comp        = event.competitions?.[0] || {};
      const competitors = comp.competitors || [];
      const home        = competitors.find(c => c.homeAway === 'home') || {};
      const away        = competitors.find(c => c.homeAway === 'away') || {};
      const status      = event.status || {};
      const state       = status.type?.state || 'pre';

      const homeAbbr = home.team?.abbreviation || '';
      const awayAbbr = away.team?.abbreviation || '';
      const homeName = home.team?.displayName  || homeAbbr;
      const awayName = away.team?.displayName  || awayAbbr;

      if (!homeAbbr || !awayAbbr) continue;

      let hoursToClose = 4;
      try {
        const gameTime = new Date(event.date);
        const now      = new Date();
        hoursToClose   = Math.max(0, (gameTime - now) / 3600000);
      } catch (_) {}

      const ht      = teams.find(tm => tm.abbr === homeAbbr) || {};
      const at      = teams.find(tm => tm.abbr === awayAbbr) || {};
      const homeNet = parseFloat(((ht.ortg || 112) - (ht.drtg || 112)).toFixed(1));
      const awayNet = parseFloat(((at.ortg || 112) - (at.drtg || 112)).toFixed(1));

      let timeLabel = '';
      if (state === 'in') {
        timeLabel = ('LIVE - Q' + (status.period || '?') + ' ' + (status.displayClock || '')).trim();
      } else if (state === 'post') {
        timeLabel = 'Final';
      } else {
        try {
          timeLabel = new Date(event.date).toLocaleTimeString('id-ID', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
          }) + ' WIB';
        } catch (_) {
          timeLabel = 'Today';
        }
      }

      newGameData.push({
        id:           event.id || (homeAbbr + '-' + awayAbbr),
        home:         homeAbbr,
        away:         awayAbbr,
        label:        homeName + ' vs ' + awayName,
        time:         timeLabel,
        status:       state === 'in' ? 'live' : state === 'post' ? 'final' : 'upcoming',
        hoursToClose: parseFloat(hoursToClose.toFixed(1)),
        netRating:    { home: homeNet, away: awayNet },
        recency: {
          home: (gameData.find(g => g.home === homeAbbr) || {}).recency?.home || [0,0,0,0,0],
          away: (gameData.find(g => g.away === awayAbbr) || {}).recency?.away || [0,0,0,0,0],
        },
        injuries:    [],
        homeFlag:    1,
        rest:        { home: 1, away: 1 },
        pmPriceMove: 0,
        pmYesPrice:  0.5,
        pmVolume:    0,
        refPaceFast: 0,
        refFoulHigh: 0,
        _homeScore:  state !== 'pre' ? parseInt(home.score || 0) : null,
        _awayScore:  state !== 'pre' ? parseInt(away.score || 0) : null,
        _period:     status.period || 0,
        _clock:      status.displayClock || '',
        _live:       state === 'in',
        _espnId:     event.id,
      });
    }

    if (newGameData.length === 0) {
      console.warn('[ESPN] 0 game valid ditemukan');
      return false;
    }

    gameData.length = 0;
    newGameData.forEach(g => gameData.push(g));
    console.log('[ESPN] gameData dibangun: ' + gameData.length + ' game hari ini');
    return true;

  } catch (e) {
    console.warn('[buildGameDataFromESPN]', e.message);
    return false;
  }
}

// ──────────────────────────────────────────────
// ESPN LIVE SCORE UPDATE
// ──────────────────────────────────────────────

async function fetchESPNScoreboard() {
  setStatus('BDL', 'conn', 'ESPN · Fetching scores...');
  try {
    const data = await apiFetch(API.espnScoreboard(), {}, 8000);
    if (data.error) throw new Error(data.error);

    const events = data.events || [];
    let liveCount = 0;

    events.forEach(event => {
      const comp        = event.competitions?.[0] || {};
      const competitors = comp.competitors || [];
      const home        = competitors.find(c => c.homeAway === 'home') || {};
      const away        = competitors.find(c => c.homeAway === 'away') || {};
      const status      = event.status || {};
      const state       = status.type?.state || 'pre';
      const isLive      = state === 'in';
      if (isLive) liveCount++;

      const homeAbbr = home.team?.abbreviation;
      const awayAbbr = away.team?.abbreviation;

      const match = gameData.find(g =>
        g.home === homeAbbr || g.away === awayAbbr || g._espnId === event.id
      );
      if (match) {
        match._homeScore = parseInt(home.score || 0);
        match._awayScore = parseInt(away.score || 0);
        match._period    = status.period || 0;
        match._clock     = status.displayClock || '';
        match._live      = isLive;
        match._espnId    = event.id;
        if (isLive)          match.status = 'live';
        if (state === 'post') match.status = 'final';
        if (isLive) {
          match.time = ('LIVE - Q' + (status.period || '?') + ' ' + (status.displayClock || '')).trim();
        }
      }
    });

    const lcEl = document.getElementById('liveCount');
    if (lcEl) lcEl.textContent = liveCount;

    renderLiveGames();
    setBadge('liveGamesDb', liveCount > 0 ? 'live' : 'live');
    setStatus('BDL', 'live', 'ESPN · ' + liveCount + ' live · ' + events.length + ' games');
    return events;

  } catch (e) {
    console.warn('[ESPN scoreboard]', e.message);
    setStatus('BDL', 'err', 'ESPN · ' + e.message.slice(0, 28));
    return [];
  }
}

// ──────────────────────────────────────────────
// TEAM STATS (nba_api → ESPN fallback)
// ──────────────────────────────────────────────

/**
 * FIX: _applyTeamStats sekarang pure function (tanpa async/await/fetch)
 * Hanya memproses data yang sudah diterima dari caller.
 */
function _applyTeamStats(apiTeams, season) {
  try {
    if (!apiTeams || !apiTeams.length) {
      console.warn('[_applyTeamStats] No teams data received');
      return;
    }

    apiTeams.forEach(at => {
      const found = teams.find(tm => tm.abbr === at.abbr);
      if (found) {
        found.ortg    = at.ortg;
        found.drtg    = at.drtg;
        found.pace    = at.pace;
        found._live   = true;
        found._teamId = at.team_id;
        found._wins   = at.wins;
        found._losses = at.losses;
      } else {
        teams.push({
          abbr: at.abbr,
          name: at.name,
          ortg: at.ortg,
          drtg: at.drtg,
          pace: at.pace,
          conf: 'unknown',
          color: '#888888',
          _live: true,
          _teamId: at.team_id,
          _wins: at.wins,
          _losses: at.losses,
        });
      }
    });

    // Update netRating di setiap game
    gameData.forEach(g => {
      const ht = teams.find(tm => tm.abbr === g.home);
      const at = teams.find(tm => tm.abbr === g.away);
      if (ht?._live && at?._live) {
        g.netRating.home = parseFloat((ht.ortg - ht.drtg).toFixed(1));
        g.netRating.away = parseFloat((at.ortg - at.drtg).toFixed(1));
      }
    });

    // Re-render semua komponen terkait
    renderEfficiency();
    renderGameSelector();
    renderEngineDetail();
    setBadge('effDb', 'live');

    console.log('[_applyTeamStats] Applied ' + apiTeams.length + ' teams · ' + (season || NBA_SEASON));

  } catch (e) {
    console.warn('[_applyTeamStats]', e.message);
  }
}

/**
 * FIX: fetchNBATeamStats sekarang clean — fetch sekali, apply sekali.
 * Fallback ke ESPN jika nba_api gagal.
 */
async function fetchNBATeamStats() {
  setStatus('Odds', 'conn', 'nba_api · Fetching...');

  // Coba nba_api dulu
  try {
    const data = await apiFetch(API.nbaTeamStats(NBA_SEASON), {}, 20000);
    if (data.error) throw new Error(data.error);
    if (!data.teams?.length) throw new Error('Empty response');

    _applyTeamStats(data.teams, data.season);
    setStatus('Odds', 'live', 'nba_api · ' + data.teams.length + ' teams · ' + NBA_SEASON);
    console.log('[nba_api] ' + data.teams.length + ' teams loaded');
    return;
  } catch (e) {
    console.warn('[nba_api] gagal, coba ESPN fallback:', e.message);
  }

  // Fallback ke ESPN estimated stats
  try {
    const data = await apiFetch('/api/espn/teamstats', {}, 10000);
    if (data.error) throw new Error(data.error);
    if (!data.teams?.length) throw new Error('No data');

    _applyTeamStats(data.teams, data.season || NBA_SEASON);
    setStatus('Odds', 'live', 'ESPN est. · ' + data.teams.length + ' teams');
    console.log('[ESPN fallback] ' + data.teams.length + ' teams loaded');
    return;
  } catch (e) {
    console.warn('[ESPN teamstats fallback] gagal:', e.message);
    setStatus('Odds', 'err', 'Team stats · offline');
  }
}

// ──────────────────────────────────────────────
// RECENCY (nba_api gamelog per team)
// ──────────────────────────────────────────────

async function fetchNBARecency() {
  setStatus('Odds', 'conn', 'Recency · Fetching...');
  try {
    const abbrs = [...new Set(gameData.flatMap(g => [g.home, g.away]))];
    if (!abbrs.length) {
      console.warn('[recency] Tidak ada tim dalam gameData');
      return;
    }

    let updated = 0;

    // Batch 4 tim sekaligus untuk efisiensi
    const chunks = [];
    for (let i = 0; i < abbrs.length; i += 4) {
      chunks.push(abbrs.slice(i, i + 4));
    }

    for (const chunk of chunks) {
      await Promise.allSettled(chunk.map(async abbr => {
        const teamObj = teams.find(tm => tm.abbr === abbr);
        const teamId  = teamObj?._teamId;
        if (!teamId) {
          console.warn('[recency] Tidak ada team_id untuk:', abbr);
          return;
        }

        try {
          const data  = await apiFetch(API.nbaGamelog(teamId, 5), {}, 10000);
          const games = data.games || [];
          if (!games.length) return;

          const plusMinus = games.slice(0, 5).map(g => parseFloat(g.plus_minus || 0));
          while (plusMinus.length < 5) plusMinus.unshift(0);

          gameData.forEach(g => {
            if (g.home === abbr) { g.recency.home = plusMinus.slice(-5); updated++; }
            if (g.away === abbr) { g.recency.away = plusMinus.slice(-5); updated++; }
          });
        } catch (e) {
          console.warn('[recency] ' + abbr + ':', e.message);
        }
      }));

      // Rate limit: tunggu 700ms antar batch
      await new Promise(r => setTimeout(r, 700));
    }

    console.log('[Recency] Updated ' + updated + ' entries');
    renderEngineDetail();
    renderGameSelector();
    if (typeof renderFormTrends === 'function') renderFormTrends();
    setStatus('Odds', 'live', 'nba_api · Recency OK · ' + NBA_SEASON);

  } catch (e) {
    console.warn('[fetchNBARecency]', e.message);
  }
}

// ──────────────────────────────────────────────
// INJURIES (ESPN)
// ──────────────────────────────────────────────

async function fetchESPNInjuries() {
  setStatus('Injuries', 'conn', 'Injuries · ESPN fetching...');
  try {
    const data = await apiFetch(API.espnInjuries(), {}, 12000);
    if (data.error) throw new Error(data.error);
    const raw = data.injuries || [];
    if (!raw.length) throw new Error('No injury data');

    const live = raw.map(p => ({
      name:   p.name   || '',
      team:   p.team   || '?',
      status: mapInjStatus(p.status),
      desc:   (p.detail || p.status || '').slice(0, 45),
      impact: estimateImpact(p.status),
      _prev:  injuries.find(i =>
        i.name.includes((p.name || '').split(' ').pop())
      )?.status || null,
    })).slice(0, 15);

    // Alert: cek perubahan status injury
    AlertSystem.checkInjury(live);

    injuries.length = 0;
    live.forEach(i => injuries.push(i));

    // Assign injuries ke masing-masing game
    gameData.forEach(g => {
      g.injuries = injuries
        .filter(i => i.team === g.home || i.team === g.away)
        .map(i => ({
          name: i.name,
          team: i.team,
          status: i.status,
          epm: Math.abs(i.impact) * 1.2,
        }));
    });

    renderInjuries();
    setBadge('injDb', 'live');
    renderPMTable();
    renderEngineDetail();
    setStatus('Injuries', 'live', 'Injuries · ' + live.length + ' players · ESPN');

  } catch (e) {
    console.warn('[ESPN injuries]', e.message);
    setStatus('Injuries', 'err', 'Injuries · ' + e.message.slice(0, 28));
  }
}

function mapInjStatus(s) {
  s = (s || '').toLowerCase();
  if (s.includes('out') || s.includes('doubtful')) return 'OUT';
  return 'GTD';
}

function estimateImpact(s) {
  s = (s || '').toLowerCase();
  if (s.includes('out') || s.includes('doubtful')) return -6.5;
  if (s.includes('questionable'))                  return -3.5;
  return -2.0;
}

// ──────────────────────────────────────────────
// POLYMARKET
// ──────────────────────────────────────────────

const NBA_KW = [
  'celtics','lakers','warriors','nuggets','suns','heat','bucks','knicks',
  'nets','sixers','mavericks','pelicans','clippers','thunder','grizzlies',
  'raptors','bulls','pistons','cavaliers','nba','championship','mvp','playoff',
  'magic','kings','spurs','jazz','blazers','timberwolves','hawks','hornets',
];

function isNBA(t) {
  return NBA_KW.some(k => (t || '').toLowerCase().includes(k));
}

async function fetchPolymarket() {
  setStatus('Polymarket', 'conn', 'Polymarket · Connecting...');
  try {
    const data = await apiFetch(API.pmMarkets(), {}, 9000);
    if (data.error) throw new Error(data.error);

    const raw = data.markets || data || [];
    const nba = raw.filter(m => isNBA(m.question || m.title || ''));
    if (!nba.length) throw new Error('No NBA markets found');

    // Enrich dengan midpoint & order book
    const enriched = await Promise.allSettled(
      nba.slice(0, 16).map(async m => {
        const tid = m.clob_token_ids?.[0] || m.tokens?.[0]?.token_id || m.condition_id;
        if (!tid) return m;
        try {
          const [mid, book] = await Promise.all([
            apiFetch(API.pmMidpoint(tid), {}, 4000),
            apiFetch(API.pmBook(tid),     {}, 4000),
          ]);
          const ask = book.asks?.[0]?.price ?? null;
          const bid = book.bids?.[0]?.price ?? null;
          return {
            ...m,
            liveMid: mid.mid || null,
            spread: ask && bid ? ask - bid : null,
          };
        } catch {
          return m;
        }
      })
    );

    liveMarkets = enriched
      .map(r => r.value || r.reason)
      .filter(Boolean)
      .map(m => {
        const outYes = m.outcomes?.find?.(o => o.name?.toLowerCase() === 'yes');
        const yp = parseFloat(m.liveMid || outYes?.price || m.outcomePrices?.[0] || 0);
        return {
          question:  m.question || m.title || '',
          yesPrice:  yp || 0.5,
          volume:    parseInt(m.volumeNum || m.volume || 0),
          spread:    m.spread || null,
          liquidity: parseInt(m.volumeNum || 0) > 50000 ? 'High'
                   : parseInt(m.volumeNum || 0) > 20000 ? 'Medium' : 'Low',
          _live: true,
        };
      })
      .filter(m => m.yesPrice > 0 && m.yesPrice < 1);

    // Match markets ke gameData
    liveMarkets.forEach(lm => {
      const q = (lm.question || '').toLowerCase();
      const match = gameData.find(g =>
        [g.home, g.away, g.label.split(' ')[0], g.label.split(' ').pop()]
          .some(w => (w || '').toLowerCase().length > 2 && q.includes((w || '').toLowerCase()))
      );
      if (match) {
        match.pmYesPrice = lm.yesPrice;
        match.pmVolume   = lm.volume;
        match.spread     = lm.spread;
      }
    });

    AlertSystem.checkPrice(liveMarkets);
    renderPMTable();
    setBadge('scannerDb', 'live');
    setBadge('scannerDb2', 'live');
    setStatus('Polymarket', 'live', 'Polymarket · ' + liveMarkets.length + ' markets');

  } catch (e) {
    console.warn('[PM]', e.message);
    setStatus('Polymarket', 'err', 'Polymarket · ' + e.message.slice(0, 28));
    renderPMTable();
  }
}

// ──────────────────────────────────────────────
// REFEREES (Demo — stats.nba.com memerlukan proxy)
// ──────────────────────────────────────────────

async function fetchReferees() {
  setStatus('Referees', 'idle', 'Referees · Demo data');
  if (typeof applyRefDemoData === 'function') {
    applyRefDemoData();
  }
}

// ──────────────────────────────────────────────
// BUILD LIVE MARKETS (untuk Scanner/Alpha table)
// ──────────────────────────────────────────────

function buildLiveMarkets() {
  const derived = gameData.map(g => {
    const { finalProb, F, confidence, method, mlProb } = getGameProb(g);
    return {
      question:     g.label + ' to win',
      gameId:       g.id,
      closes:       g.time,
      yesPrice:     g.pmYesPrice || 0.5,
      volume:       g.pmVolume   || 0,
      liquidity:    (g.pmVolume || 0) > 50000 ? 'High'
                  : (g.pmVolume || 0) > 20000 ? 'Medium' : 'Low',
      modelProb:    finalProb,
      confidence,
      F,
      method,
      mlProb,
      hoursToClose: g.hoursToClose || 4,
      spread:       g.spread || null,
      _live:        false,
    };
  });

  // Merge data dari Polymarket yang sudah di-fetch
  liveMarkets.forEach(lm => {
    const idx = derived.findIndex(d => {
      const q = (lm.question || '').toLowerCase();
      return d.question.toLowerCase().split(' ')
        .slice(0, 2).some(w => q.includes(w) && w.length > 3);
    });
    if (idx >= 0) {
      derived[idx].yesPrice = lm.yesPrice || derived[idx].yesPrice;
      derived[idx].spread   = lm.spread   || derived[idx].spread;
      derived[idx].volume   = lm.volume   || derived[idx].volume;
      derived[idx]._live    = true;
    }
  });

  return derived;
}

// ──────────────────────────────────────────────
// REFRESH ALL — Master sync function
// ──────────────────────────────────────────────

let _refreshTimer = null;

async function refreshAll() {
  console.log('[refreshAll] Starting full sync...');

  const ri = document.getElementById('refreshIcon');
  const sb = document.getElementById('syncBtn');
  if (ri) ri.style.animation = 'spin .8s linear infinite';
  if (sb) sb.classList.add('spin');

  // Tahap 1: Rebuild game schedule dari ESPN
  const built = await buildGameDataFromESPN();
  if (built) {
    console.log('[refreshAll] gameData rebuilt: ' + gameData.length + ' games');
    renderLiveGames();
  }

  // Tahap 2: Semua data sources paralel
  await Promise.allSettled([
    fetchESPNScoreboard(),
    fetchNBATeamStats(),
    fetchNBARecency(),
    fetchESPNInjuries(),
    fetchPolymarket(),
  ]);

  // Stop spinner
  if (ri) ri.style.animation = '';
  if (sb) sb.classList.remove('spin');

  // Update timestamp
  const ts = new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const el = document.getElementById('syncTs');
  if (el) el.textContent = 'Last sync: ' + ts;

  // Re-render semua komponen
  renderPMTable();
  renderLiveGames();
  renderGameSelector();
  renderEngineDetail();
  if (typeof renderFormTrends === 'function') renderFormTrends();
  AlertSystem.renderAll();

  console.log('[refreshAll] Sync complete at ' + ts);

  // Schedule next refresh (60 detik)
  clearTimeout(_refreshTimer);
  if (!document.hidden) {
    _refreshTimer = setTimeout(refreshAll, 60000);
  }
}

// ──────────────────────────────────────────────
// VISIBILITY CHANGE — pause/resume auto-refresh
// ──────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(_refreshTimer);
    console.log('[visibility] Tab hidden — auto-refresh paused');
  } else {
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(refreshAll, 5000);
    console.log('[visibility] Tab visible — refresh in 5s');
  }
});

// ──────────────────────────────────────────────
console.log('✅ api.js v3.2 loaded | Season: ' + NBA_SEASON);