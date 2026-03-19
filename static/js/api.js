// api.js v3.1 — ESPN + nba_api + Polymarket
// Fix: buildGameDataFromESPN, fetchNBARecency, musim 2025-26

const NBA_SEASON = "2025-26";

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

async function checkBackendStatus() {
  try { return await apiFetch(API.status(), {}, 5000); }
  catch (e) { console.error('Backend unreachable:', e); return null; }
}

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

      const ht      = teams.find(t => t.abbr === homeAbbr) || {};
      const at      = teams.find(t => t.abbr === awayAbbr) || {};
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
        } catch (_) { timeLabel = 'Today'; }
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

async function fetchESPNScoreboard() {
  setStatus('ESPN', 'conn', 'ESPN · Fetching...');
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
        if (isLive)         match.status = 'live';
        if (state === 'post') match.status = 'final';
        if (isLive) {
          match.time = ('LIVE - Q' + (status.period || '?') + ' ' + (status.displayClock || '')).trim();
        }
      }
    });

    const lcEl = document.getElementById('liveCount');
    if (lcEl) lcEl.textContent = liveCount;
    renderLiveGames();
    setBadge('liveGamesDb', 'live');
    setStatus('ESPN', 'live', 'ESPN · ' + liveCount + ' live · ' + events.length + ' games');
    return events;
  } catch (e) {
    console.warn('[ESPN scoreboard]', e.message);
    setStatus('ESPN', 'err', 'ESPN · ' + e.message.slice(0, 28));
    return [];
  }
}

async function fetchNBATeamStats() {
  // Coba nba_api dulu, fallback ke ESPN jika gagal
  setStatus('NBAApi', 'conn', 'nba_api · Fetching...');
  try {
    const data = await apiFetch(API.nbaTeamStats(NBA_SEASON), {}, 20000);
    if (data.error) throw new Error(data.error);
    if (!data.teams?.length) throw new Error('Empty response');
    _applyTeamStats(data.teams, data.season);
    setStatus('NBAApi', 'live', 'nba_api · ' + data.teams.length + ' teams · ' + NBA_SEASON);
    return;
  } catch (e) {
    console.warn('[nba_api] gagal, coba ESPN fallback:', e.message);
  }

  // Fallback ke ESPN estimated stats
  try {
    const data = await apiFetch('/api/espn/teamstats', {}, 10000);
    if (data.error) throw new Error(data.error);
    _applyTeamStats(data.teams, data.season);
    setStatus('NBAApi', 'live', 'ESPN est. · ' + data.teams.length + ' teams');
    return;
  } catch (e) {
    console.warn('[ESPN teamstats fallback] gagal:', e.message);
    setStatus('NBAApi', 'err', 'Team stats · offline');
  }
}

function _applyTeamStats(apiTeams, season) {
    const data = await apiFetch(API.nbaTeamStats(NBA_SEASON), {}, 15000);
    if (data.error) throw new Error(data.error);

    const apiTeams = apiTeams_param || [];
    apiTeams.forEach(at => {
      const t = teams.find(t => t.abbr === at.abbr);
      if (t) {
        t.ortg    = at.ortg;
        t.drtg    = at.drtg;
        t.pace    = at.pace;
        t._live   = true;
        t._teamId = at.team_id;
        t._wins   = at.wins;
        t._losses = at.losses;
      } else {
        teams.push({
          abbr: at.abbr, name: at.name,
          ortg: at.ortg, drtg: at.drtg, pace: at.pace,
          conf: 'unknown', color: '#888888', _live: true,
          _teamId: at.team_id, _wins: at.wins, _losses: at.losses,
        });
      }
    });

    gameData.forEach(g => {
      const ht = teams.find(t => t.abbr === g.home);
      const at = teams.find(t => t.abbr === g.away);
      if (ht?._live && at?._live) {
        g.netRating.home = parseFloat((ht.ortg - ht.drtg).toFixed(1));
        g.netRating.away = parseFloat((at.ortg - at.drtg).toFixed(1));
      }
    });

    renderEfficiency();
    renderGameSelector();
    renderEngineDetail();
    setBadge('effDb', 'live');
    setStatus('NBAApi', 'live', 'nba_api · ' + apiTeams.length + ' teams · ' + NBA_SEASON);
  } catch (e) {
    console.warn('[nba_api teamstats]', e.message);
    setStatus('NBAApi', 'err', 'nba_api · ' + e.message.slice(0, 28));
  }
}

async function fetchNBARecency() {
  setStatus('NBAApi', 'conn', 'nba_api · Recency...');
  try {
    const abbrs = [...new Set(gameData.flatMap(g => [g.home, g.away]))];
    if (!abbrs.length) return;

    let updated = 0;

    const chunks = [];
    for (let i = 0; i < abbrs.length; i += 4) {
      chunks.push(abbrs.slice(i, i + 4));
    }

    for (const chunk of chunks) {
      await Promise.allSettled(chunk.map(async abbr => {
        const teamObj = teams.find(t => t.abbr === abbr);
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

      await new Promise(r => setTimeout(r, 700));
    }

    console.log('[Recency] Updated ' + updated + ' entries');
    renderEngineDetail();
    renderGameSelector();
    setStatus('NBAApi', 'live', 'nba_api · Recency OK · ' + NBA_SEASON);

  } catch (e) {
    console.warn('[fetchNBARecency]', e.message);
  }
}

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

    AlertSystem.checkInjury(live);
    injuries.length = 0;
    live.forEach(i => injuries.push(i));

    gameData.forEach(g => {
      g.injuries = injuries
        .filter(i => i.team === g.home || i.team === g.away)
        .map(i => ({ name: i.name, team: i.team, status: i.status, epm: Math.abs(i.impact) * 1.2 }));
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
          return { ...m, liveMid: mid.mid || null, spread: ask && bid ? ask - bid : null };
        } catch { return m; }
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
    setStatus('Polymarket', 'live', 'Polymarket · ' + liveMarkets.length + ' markets');
  } catch (e) {
    console.warn('[PM]', e.message);
    setStatus('Polymarket', 'err', 'Polymarket · ' + e.message.slice(0, 28));
    renderPMTable();
  }
}

async function fetchReferees() {
  setStatus('Referees', 'idle', 'Referees · Demo data');
  applyRefDemoData();
}

let _refreshTimer = null;

async function refreshAll() {
  const ri = document.getElementById('refreshIcon');
  const sb = document.getElementById('syncBtn');
  if (ri) ri.style.animation = 'spin .8s linear infinite';
  if (sb) sb.classList.add('spin');

  await Promise.allSettled([
    fetchESPNScoreboard(),
    fetchESPNInjuries(),
    fetchPolymarket(),
  ]);

  if (ri) ri.style.animation = '';
  if (sb) sb.classList.remove('spin');

  const ts = new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const el = document.getElementById('syncTs');
  if (el) el.textContent = 'Last sync: ' + ts;

  renderPMTable();
  renderGameSelector();
  renderEngineDetail();
  AlertSystem.renderAll();

  clearTimeout(_refreshTimer);
  if (!document.hidden) _refreshTimer = setTimeout(refreshAll, 60000);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(_refreshTimer);
  } else {
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(refreshAll, 5000);
  }
});

console.log('\u2705 api.js v3.1 loaded | Season: ' + NBA_SEASON);
