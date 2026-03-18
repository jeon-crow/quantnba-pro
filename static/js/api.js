
// ═══════════════════════════════════════
// API LAYER — All calls go through Flask backend
// No CORS issues, no API key exposure
// ═══════════════════════════════════════

// ── Status helpers ──
function setStatus(id, state, txt = '') {
  const el = document.getElementById('s' + id);
  const tel = document.getElementById('s' + id + 'T');
  if (el) el.className = 'anode ' + state;
  if (tel && txt) tel.textContent = txt;
}

function setBadge(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'db ' + (state === 'live' ? 'db-live' : state === 'error' ? 'db-err' : 'db-demo');
  el.textContent = state === 'live' ? '● LIVE' : state === 'error' ? '! ERR' : 'DEMO';
}

// ── Check backend health ──
async function checkBackendStatus() {
  try {
    const data = await apiFetch(API.status(), {}, 5000);
    console.log('Backend status:', data);
    return data;
  } catch (e) {
    console.error('Backend unreachable:', e);
    return null;
  }
}

// ── BallDontLie ──
async function fetchBDLGames() {
  setStatus('BDL', 'conn', 'BallDontLie · Fetching…');
  try {
    const today = new Date().toISOString().slice(0, 10);
    const data = await apiFetch(
      API.bdl(`games?dates[]=${today}&per_page=15`), {}, 10000
    );
    if (data.error) throw new Error(data.error);
    const games = data.data || [];
    const live = games.filter(g => g.status !== 'Final' && g.status !== '1').length;
    document.getElementById('liveCount').textContent = live;

    games.forEach(g => {
      const ha = g.home_team?.abbreviation;
      const aa = g.visitor_team?.abbreviation;
      const match = gameData.find(gd => gd.home === ha || gd.away === aa);
      if (!match) return;
      match._homeScore = g.home_team_score;
      match._awayScore = g.visitor_team_score;
      match._period = g.period;
      match._live = g.status !== 'Final' && g.period > 0;
    });

    renderLiveGames();
    setBadge('liveGamesDb', 'live');
    
    // Fetch advanced stats
    await fetchBDLAdvancedStats();
    await fetchBDLRecency();
    
    setStatus('BDL', 'live', 'BallDontLie · Live');
  } catch (e) {
    console.warn('[BDL]', e.message);
    setStatus('BDL', 'err', 'BallDontLie · ' + e.message.slice(0, 25));
  }
}

async function fetchBDLAdvancedStats() {
  try {
    const data = await apiFetch(
      API.bdl('advanced_stats?seasons[]=2024&per_page=30'), {}, 10000
    );
    if (!data.data?.length) return;
    data.data.forEach(stat => {
      const abbr = stat.team?.abbreviation;
      if (!abbr) return;
      const t = teams.find(t => t.abbr === abbr);
      if (!t) return;
      if (stat.offensive_rating) t.ortg = parseFloat(stat.offensive_rating);
      if (stat.defensive_rating) t.drtg = parseFloat(stat.defensive_rating);
      if (stat.pace) t.pace = parseFloat(stat.pace);
      t._live = true;
    });
    renderEfficiency();
    setBadge('effDb', 'live');
    setBadge('recDb', 'live');

    gameData.forEach(g => {
      const ht = teams.find(t => t.abbr === g.home);
      const at = teams.find(t => t.abbr === g.away);
      if (ht?._live && at?._live) {
        g.netRating.home = +(ht.ortg - ht.drtg).toFixed(1);
        g.netRating.away = +(at.ortg - at.drtg).toFixed(1);
      }
    });
  } catch (e) {
    console.warn('[BDL advanced_stats]', e.message);
  }
}

async function fetchBDLRecency() {
  try {
    const td = await apiFetch(API.bdl('teams?per_page=30'), {}, 6000);
    const teamIds = {};
    (td.data || []).forEach(t => { teamIds[t.abbreviation] = t.id; });

    const toFetch = [...new Set(gameData.flatMap(g => [g.home, g.away]))];
    await Promise.allSettled(toFetch.map(async abbr => {
      const id = teamIds[abbr];
      if (!id) return;
      try {
        const data = await apiFetch(
          API.bdl(`games?seasons[]=2024&team_ids[]=${id}&per_page=5&page=1`), {}, 8000
        );
        const games = (data.data || [])
          .filter(g => g.status === 'Final' && g.home_team_score && g.visitor_team_score);
        if (games.length < 3) return;
        const diffs = games.slice(0, 5).map(g => {
          const isHome = g.home_team?.abbreviation === abbr;
          return isHome
            ? g.home_team_score - g.visitor_team_score
            : g.visitor_team_score - g.home_team_score;
        });
        while (diffs.length < 5) diffs.unshift(0);
        gameData.forEach(gd => {
          if (gd.home === abbr) gd.recency.home = diffs.slice(-5);
          if (gd.away === abbr) gd.recency.away = diffs.slice(-5);
        });
      } catch {}
    }));
    renderGameSelector();
    renderEngineDetail();
  } catch (e) {
    console.warn('[BDL recency]', e.message);
  }
}

// ── Polymarket ──
const NBA_KW = [
  'celtics','lakers','warriors','nuggets','suns','heat','bucks','knicks',
  'nets','sixers','mavericks','pelicans','clippers','thunder','grizzlies',
  'raptors','bulls','pistons','cavaliers','nba','championship','mvp','playoff'
];
function isNBA(t) {
  const l = t.toLowerCase();
  return NBA_KW.some(k => l.includes(k));
}

async function fetchPolymarket() {
  setStatus('Polymarket', 'conn', 'Polymarket · Connecting…');
  try {
    const data = await apiFetch(API.pmMarkets(), {}, 9000);
    if (data.error) throw new Error(data.error);
    const raw = data.markets || data || [];
    const nba = raw.filter(m => isNBA(m.question || m.title || ''));
    if (!nba.length) throw new Error('No NBA markets');

    const enriched = await Promise.allSettled(
      nba.slice(0, 14).map(async m => {
        const tid = m.clob_token_ids?.[0] || m.condition_id;
        if (!tid) return m;
        try {
          const [mid, book] = await Promise.all([
            apiFetch(API.pmMidpoint(tid), {}, 4000),
            apiFetch(API.pmBook(tid), {}, 4000)
          ]);
          const ask = book.asks?.[0]?.price ?? null;
          const bid = book.bids?.[0]?.price ?? null;
          return {
            ...m,
            liveMid: mid.mid || null,
            spread: ask && bid ? ask - bid : null,
            bestAsk: ask,
            bestBid: bid
          };
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
          question: m.question || m.title || '',
          yesPrice: yp || 0.5,
          volume: parseInt(m.volumeNum || m.volume || 0),
          spread: m.spread || null,
          liquidity: parseInt(m.volumeNum || 0) > 50000 ? 'High'
                   : parseInt(m.volumeNum || 0) > 20000 ? 'Medium' : 'Low',
          _live: true
        };
      })
      .filter(m => m.yesPrice > 0 && m.yesPrice < 1);

    AlertSystem.checkPrice(liveMarkets);
    renderPMTable();
    setStatus('Polymarket', 'live', `Polymarket · ${liveMarkets.length} markets`);
  } catch (e) {
    console.warn('[PM]', e.message);
    setStatus('Polymarket', 'err', 'Polymarket · ' + e.message.slice(0, 25));
    renderPMTable();
  }
}

// ── NBA Injuries ──
async function fetchNBAInjuries() {
  setStatus('Injuries', 'conn', 'NBA Injuries · Fetching…');
  try {
    const data = await apiFetch(API.injuries(), {}, 8000);
    if (data.error) throw new Error(data.error);
    const pl = data?.lscd?.[0]?.mscd?.plyr || data?.PlayerList || [];
    if (!pl.length) throw new Error('Empty');

    const live = pl
      .filter(p => (p.stt || '').toLowerCase() !== 'active')
      .map(p => ({
        name: `${p.fn || ''} ${p.ln || ''}`.trim(),
        team: p.ta || '?',
        status: mapInj(p.stt || ''),
        desc: (p.desc || p.stt || '').slice(0, 40),
        impact: estImpact(p),
        _prev: injuries.find(i => i.name.includes(p.ln || ''))?.status || null
      }))
      .slice(0, 8);

    if (live.length) {
      AlertSystem.checkInjury(live);
      injuries.length = 0;
      live.forEach(i => injuries.push(i));
      gameData.forEach(g => {
        g.injuries = injuries
          .filter(i => i.team === g.home || i.team === g.away)
          .map(i => ({
            name: i.name, team: i.team,
            status: i.status, epm: Math.abs(i.impact) * 1.2
          }));
      });
      renderInjuries();
      setBadge('injDb', 'live');
      renderPMTable();
      renderGameSelector();
      renderEngineDetail();
    }
    setStatus('Injuries', 'live', `NBA Injuries · ${live.length} players`);
  } catch (e) {
    console.warn('[Inj]', e.message);
    setStatus('Injuries', 'err', 'NBA Injuries · ' + e.message.slice(0, 25));
  }
}

function mapInj(s) {
  s = s.toLowerCase();
  if (s.includes('out') || s.includes('doubtful')) return 'OUT';
  return 'GTD';
}
function estImpact(p) {
  const s = (p.stt || '').toLowerCase();
  if (s.includes('out') || s.includes('doubtful')) return -6.5;
  if (s.includes('questionable')) return -3.5;
  return -2.0;
}

// ── The Odds API ──
async function fetchOddsAPI() {
  setStatus('Odds', 'conn', 'The Odds API · Fetching…');
  try {
    const data = await apiFetch(API.odds(), {}, 10000);
    if (data.error) throw new Error(data.error);
    if (!Array.isArray(data)) throw new Error(data.message || 'Bad response');
    setStatus('Odds', 'live', `The Odds API · ${data.length} games`);
    renderOddsTable(data);
  } catch (e) {
    console.warn('[Odds]', e.message);
    setStatus('Odds', 'err', 'The Odds API · ' + e.message.slice(0, 25));
    renderOddsTable([]);
  }
}

// ── Referees ──
async function fetchReferees() {
  setStatus('Referees', 'conn', 'Referees · Fetching…');
  try {
    const data = await apiFetch(API.referees(), {}, 8000);
    if (data.error) throw new Error(data.error);
    const sets = data?.resultSets;
    const gameSumm = sets?.find(s => s.name === 'GameHeader');
    const officials = sets?.find(s => s.name === 'Officials');
    if (!officials?.rowSet?.length) throw new Error('No officials');
    applyRefereeData(gameSumm, officials);
    setStatus('Referees', 'live', 'Referees · Live');
    setBadge('refDb', 'live');
  } catch (e) {
    console.warn('[Referees]', e.message);
    applyRefDemoData();
    setStatus('Referees', 'err', 'Referees · Demo');
  }
}

// ── Master Refresh ──
let _refreshTimer = null;
async function refreshAll() {
  const btn = document.getElementById('syncBtn');
  if (btn) btn.classList.add('spin');
  const ri = document.getElementById('refreshIcon');
  if (ri) ri.style.animation = 'spin .8s linear infinite';

  await Promise.allSettled([
    fetchPolymarket(),
    fetchNBAInjuries(),
    fetchOddsAPI(),
    fetchBDLGames()
  ]);

  if (btn) btn.classList.remove('spin');
  if (ri) ri.style.animation = '';

  const ts = new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const el = document.getElementById('syncTs');
  if (el) el.textContent = 'Last sync: ' + ts;

  renderPMTable();
  renderGameSelector();
  renderEngineDetail();
  AlertSystem.renderAll();

  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(refreshAll, 90000);
}

console.log('✅ api.js loaded');
