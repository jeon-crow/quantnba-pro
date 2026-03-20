// ══════════════════════════════════════════════════════════════════
// api.js v3.3 — ESPN + nba_api + Polymarket FULL INTEGRATION
// ══════════════════════════════════════════════════════════════════

const NBA_SEASON = "2025-26";

// ──────────────────────────────────────────────
// TEAM NAME MAP — Kunci utama untuk matching PM
// ──────────────────────────────────────────────

const TEAM_NAME_MAP = {
  ATL: ['hawks','atlanta','atlanta hawks'],
  BOS: ['celtics','boston','boston celtics'],
  BKN: ['nets','brooklyn','brooklyn nets'],
  CHA: ['hornets','charlotte','charlotte hornets'],
  CHI: ['bulls','chicago','chicago bulls'],
  CLE: ['cavaliers','cavs','cleveland','cleveland cavaliers'],
  DAL: ['mavericks','mavs','dallas','dallas mavericks'],
  DEN: ['nuggets','denver','denver nuggets'],
  DET: ['pistons','detroit','detroit pistons'],
  GSW: ['warriors','golden state','golden state warriors'],
  HOU: ['rockets','houston','houston rockets'],
  IND: ['pacers','indiana','indiana pacers'],
  LAC: ['clippers','la clippers','los angeles clippers'],
  LAL: ['lakers','la lakers','los angeles lakers'],
  MEM: ['grizzlies','memphis','memphis grizzlies'],
  MIA: ['heat','miami','miami heat'],
  MIL: ['bucks','milwaukee','milwaukee bucks'],
  MIN: ['timberwolves','wolves','minnesota','minnesota timberwolves'],
  NOP: ['pelicans','new orleans','new orleans pelicans'],
  NYK: ['knicks','new york knicks','ny knicks','new york'],
  OKC: ['thunder','oklahoma city','oklahoma city thunder','okc thunder'],
  ORL: ['magic','orlando','orlando magic'],
  PHI: ['76ers','sixers','philadelphia','philadelphia 76ers'],
  PHX: ['suns','phoenix','phoenix suns'],
  POR: ['blazers','trail blazers','portland','portland trail blazers'],
  SAC: ['kings','sacramento','sacramento kings'],
  SAS: ['spurs','san antonio','san antonio spurs'],
  TOR: ['raptors','toronto','toronto raptors'],
  UTA: ['jazz','utah','utah jazz'],
  WAS: ['wizards','washington','washington wizards'],
};

const _KEYWORD_TO_ABBR = {};
Object.entries(TEAM_NAME_MAP).forEach(([abbr, names]) => {
  names.forEach(n => { _KEYWORD_TO_ABBR[n] = abbr; });
  _KEYWORD_TO_ABBR[abbr.toLowerCase()] = abbr;
});

function matchMarketToGame(question) {
  const q = (question || '').toLowerCase();
  for (const game of gameData) {
    const homeNames = TEAM_NAME_MAP[game.home] || [game.home.toLowerCase()];
    const awayNames = TEAM_NAME_MAP[game.away] || [game.away.toLowerCase()];
    const homeMatch = homeNames.some(name => q.includes(name));
    const awayMatch = awayNames.some(name => q.includes(name));
    if (homeMatch && awayMatch) return { game, homeMatch: true, awayMatch: true };
    if (homeMatch) return { game, homeMatch: true, awayMatch: false };
    if (awayMatch) return { game, homeMatch: false, awayMatch: true };
  }
  return null;
}

function detectMarketSide(question) {
  const q = (question || '').toLowerCase();
  const winPatterns = [/will (?:the )?(.+?) (?:beat|defeat|win)/i, /(.+?) to win/i, /(.+?) (?:vs|@)/i];
  for (const pattern of winPatterns) {
    const m = q.match(pattern);
    if (m) {
      const teamText = m[1].toLowerCase().trim();
      for (const [abbr, names] of Object.entries(TEAM_NAME_MAP)) {
        if (names.some(n => teamText.includes(n))) return abbr;
      }
    }
  }
  return null;
}

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
  el.textContent = state === 'live' ? '\u25CF LIVE' : state === 'error' ? '! ERR' : 'DEMO';
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
    // Fetch schedule (hari ini + besok) dari backend
    const schedData  = await apiFetch(API.espnSchedule(), {}, 15000);
    if (schedData.error) throw new Error(schedData.error);

    const todayStr  = schedData.today  || '';
    const nextStr   = schedData.next   || '';
    // Konversi YYYYMMDD ke YYYY-MM-DD
    const toISO     = s => s ? s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8) : '';
    const todayISO  = toISO(todayStr);
    const nextISO   = toISO(nextStr);

    // Gunakan _witaDate dari server (sudah dalam WITA)
    const nowWITA     = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Makassar'}));
    const todayWITA   = nowWITA.getFullYear() + '-' +
                        String(nowWITA.getMonth()+1).padStart(2,'0') + '-' +
                        String(nowWITA.getDate()).padStart(2,'0');
    const tomorrowD   = new Date(nowWITA); tomorrowD.setDate(nowWITA.getDate()+1);
    const tomorrowWITA = tomorrowD.getFullYear() + '-' +
                         String(tomorrowD.getMonth()+1).padStart(2,'0') + '-' +
                         String(tomorrowD.getDate()).padStart(2,'0');

    const rawEvents = Array.isArray(schedData?.events) ? schedData.events : [];
    const allEvents = rawEvents.map(ev => {
      const wDate   = ev._witaDate || todayWITA;
      const isToday = wDate === todayWITA;
      const isTmr   = wDate === tomorrowWITA;
      const label   = isToday ? 'HARI INI'
                    : isTmr   ? 'BESOK'
                    : 'LUSA (' + wDate.slice(5) + ')';
      return {...ev, _dateLabel: wDate, _isToday: isToday, _dayLabel: label};
    });

    if (!allEvents.length) {
      console.warn('[ESPN] Tidak ada game');
      return false;
    }

    const newGameData = [];

    for (const event of allEvents) {
      const comp     = event.competitions?.[0];
      if (!comp) continue;
      const competitors = comp.competitors || [];
      const homeTeam = competitors.find(c => c.homeAway === 'home') || {};
      const awayTeam = competitors.find(c => c.homeAway === 'away') || {};
      const homeAbbr = homeTeam.team?.abbreviation?.toUpperCase() || '?';
      const awayAbbr = awayTeam.team?.abbreviation?.toUpperCase() || '?';
      const homeName = homeTeam.team?.displayName || homeAbbr;
      const awayName = awayTeam.team?.displayName || awayAbbr;
      const state    = comp.status?.type?.state || 'pre';
      const status   = comp.status?.type?.shortDetail || '';
      const period   = comp.status?.period || 0;
      const clock    = comp.status?.displayClock || '';

      // Label waktu WITA
      const gameTimeUTC = event.date ? new Date(event.date) : null;
      let timeLabel = '';
      if (gameTimeUTC) {
        const witaOpts = {timeZone:'Asia/Makassar', weekday:'short',
                          hour:'2-digit', minute:'2-digit'};
        const witaStr  = gameTimeUTC.toLocaleString('id-ID', witaOpts);
        timeLabel = witaStr + ' WITA';
      }

      const hoursToClose = gameTimeUTC
        ? Math.max(0, (gameTimeUTC - Date.now()) / 3600000)
        : 0;

      newGameData.push({
        id:           event.id || (homeAbbr + '-' + awayAbbr),
        home:         homeAbbr,
        away:         awayAbbr,
        label:        homeName + ' vs ' + awayName,
        time:         timeLabel,
        date:         event._dateLabel || todayWITA,
        status:       state === 'in' ? 'live' : state === 'post' ? 'final' : 'upcoming',
        hoursToClose: parseFloat(hoursToClose.toFixed(1)),
        netRating:    { home: 0, away: 0 },
        recency:      { home: { wins: 0, losses: 0, netRtg: 0 },
                        away: { wins: 0, losses: 0, netRtg: 0 } },
        injuryImpact: { home: 1, away: 1 },
        pmPriceMove:  0,
        pmYesPrice:   0.5,
        pmVolume:     0,
        period:       period,
        clock:        clock,
        statusDetail: status,
      });
    }

    gameData = newGameData;
    setStatus('ESPN', 'live', 'ESPN · ' + gameData.length + ' games');
    console.log('[ESPN] gameData dibangun: ' + gameData.length + ' game (' +
      gameData.filter(g=>g.date===_todayISO).length + ' hari ini, ' +
      gameData.filter(g=>g.date!==_todayISO && g.date).length + ' besok)');
    return true;

  } catch(e) {
    console.warn('[buildGameDataFromESPN]', e.message, e.stack?.split('\n')[1]);
    return false;
  }
}


async function fetchESPNScoreboard() {
  setStatus('BDL', 'conn', 'ESPN \u00B7 Fetching scores...');
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
        if (isLive)           match.status = 'live';
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
    setStatus('BDL', 'live', 'ESPN \u00B7 ' + liveCount + ' live \u00B7 ' + events.length + ' games');
    return events;

  } catch (e) {
    console.warn('[ESPN scoreboard]', e.message);
    setStatus('BDL', 'err', 'ESPN \u00B7 ' + e.message.slice(0, 28));
    return [];
  }
}

// ──────────────────────────────────────────────
// TEAM STATS (nba_api → ESPN fallback)
// ──────────────────────────────────────────────

function _applyTeamStats(apiTeams, season) {
  try {
    if (!apiTeams || !apiTeams.length) return;

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
          abbr: at.abbr, name: at.name,
          ortg: at.ortg, drtg: at.drtg, pace: at.pace,
          conf: 'unknown', color: '#888888',
          _live: true, _teamId: at.team_id,
          _wins: at.wins, _losses: at.losses,
        });
      }
    });

    gameData.forEach(g => {
      const ht = teams.find(tm => tm.abbr === g.home);
      const at = teams.find(tm => tm.abbr === g.away);
      if (ht?._live && at?._live) {
        g.netRating.home = parseFloat((ht.ortg - ht.drtg).toFixed(1));
        g.netRating.away = parseFloat((at.ortg - at.drtg).toFixed(1));
      }
    });

    renderEfficiency();
    renderGameSelector();
    renderEngineDetail();
    setBadge('effDb', 'live');
    console.log('[_applyTeamStats] Applied ' + apiTeams.length + ' teams');

  } catch (e) {
    console.warn('[_applyTeamStats]', e.message);
  }
}

async function fetchNBATeamStats() {
  setStatus('Odds', 'conn', 'nba_api \u00B7 Fetching...');
  try {
    const data = await apiFetch(API.nbaTeamStats(NBA_SEASON), {}, 20000);
    if (data.error) throw new Error(data.error);
    if (!data.teams?.length) throw new Error('Empty response');
    _applyTeamStats(data.teams, data.season);
    setStatus('Odds', 'live', 'nba_api \u00B7 ' + data.teams.length + ' teams');
    return;
  } catch (e) {
    console.warn('[nba_api] gagal, coba ESPN fallback:', e.message);
  }
  try {
    const data = await apiFetch('/api/espn/teamstats', {}, 10000);
    if (data.error) throw new Error(data.error);
    if (!data.teams?.length) throw new Error('No data');
    _applyTeamStats(data.teams, data.season || NBA_SEASON);
    setStatus('Odds', 'live', 'ESPN est. \u00B7 ' + data.teams.length + ' teams');
    return;
  } catch (e) {
    setStatus('Odds', 'err', 'Team stats \u00B7 offline');
  }
}

// ──────────────────────────────────────────────
// RECENCY
// ──────────────────────────────────────────────

async function fetchNBARecency() {
  try {
    const abbrs = [...new Set(gameData.flatMap(g => [g.home, g.away]))];
    if (!abbrs.length) return;

    let updated = 0;
    const chunks = [];
    for (let i = 0; i < abbrs.length; i += 4) chunks.push(abbrs.slice(i, i + 4));

    for (const chunk of chunks) {
      await Promise.allSettled(chunk.map(async abbr => {
        const teamObj = teams.find(tm => tm.abbr === abbr);
        const teamId  = teamObj?._teamId;
        if (!teamId) return;
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
        } catch (e) { console.warn('[recency] ' + abbr + ':', e.message); }
      }));
      await new Promise(r => setTimeout(r, 700));
    }

    console.log('[Recency] Updated ' + updated + ' entries');
    renderEngineDetail();
    renderGameSelector();
    if (typeof renderFormTrends === 'function') renderFormTrends();
  } catch (e) {
    console.warn('[fetchNBARecency]', e.message);
  }
}

// ──────────────────────────────────────────────
// INJURIES
// ──────────────────────────────────────────────

async function fetchESPNInjuries() {
  setStatus('Injuries', 'conn', 'Injuries \u00B7 Fetching...');
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
    setStatus('Injuries', 'live', 'Injuries \u00B7 ' + live.length + ' players');
  } catch (e) {
    console.warn('[ESPN injuries]', e.message);
    setStatus('Injuries', 'err', 'Injuries \u00B7 ' + e.message.slice(0, 28));
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

// ══════════════════════════════════════════════════════════════════
// POLYMARKET — FULL INTEGRATION
// ══════════════════════════════════════════════════════════════════

async function fetchPolymarket() {
  setStatus('Polymarket', 'conn', 'Polymarket · Connecting...');
  try {
    const res  = await fetch('/api/pm/nba-games');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || data.error) throw new Error(String(data?.error || 'no data'));

    const games   = Array.isArray(data?.games) ? data.games : [];
    const matched = games.filter(g => g?.pm_found && g?.away && g?.home);

    // Cocokkan ke gameData
    if (Array.isArray(gameData)) {
      matched.forEach(g => {
        const awayLast = (g.away || '').split(' ').pop().toLowerCase();
        const homeLast = (g.home || '').split(' ').pop().toLowerCase();
        const found = gameData.find(gd => {
          if (!gd) return false;
          // Coba via label dulu (paling reliable)
          const lbl = String(gd.label || '').toLowerCase();
          if (awayLast && lbl.includes(awayLast)) return true;
          if (homeLast && lbl.includes(homeLast)) return true;
          // Fallback via abbrev + teamName
          try {
            const ha = String(typeof teamName === 'function' && gd.home
              ? teamName(gd.home) || gd.home : gd.home || '').toLowerCase();
            const aa = String(typeof teamName === 'function' && gd.away
              ? teamName(gd.away) || gd.away : gd.away || '').toLowerCase();
            return (homeLast && ha.includes(homeLast)) || (awayLast && aa.includes(awayLast));
          } catch(_) { return false; }
        });
        if (found) {
          found.pmAwayPrice = g.away_price  || 0.5;
          found.pmHomePrice = g.home_price  || 0.5;
          found.pmVolume    = g.volume      || 0;
          found.pmLiquidity = (g.liquidity||0) > 50000 ? 'High'
                            : (g.liquidity||0) > 10000 ? 'Medium' : 'Low';
        }
      });
    }

    // Build liveMarkets
    liveMarkets = matched.map(g => ({
      question:       String(g.away) + ' vs ' + String(g.home) + ' to win',
      away:           g.away,
      home:           g.home,
      yesPrice:       Number(g.away_price)  || 0.5,
      noPrice:        Number(g.home_price)  || 0.5,
      awayPrice:      Number(g.away_price)  || 0.5,
      homePrice:      Number(g.home_price)  || 0.5,
      volume:         Number(g.volume)      || 0,
      liquidity:      Number(g.liquidity)   || 0,
      liquidityLabel: (Number(g.liquidity)||0) > 50000 ? 'High'
                    : (Number(g.liquidity)||0) > 10000 ? 'Medium' : 'Low',
      status:         String(g.status  || ''),
      period:         Number(g.period  || 0),
      clock:          String(g.clock   || ''),
      is_final:       Boolean(g.is_final),
      is_closed:      Boolean(g.is_closed),
      pm_found:       true,
      _live:          true,
    }));

    try { if (typeof AlertSystem !== 'undefined') AlertSystem.checkPrice(liveMarkets); } catch(_) {}
    renderPMTable();
    setBadge('scannerDb',  'live');
    setBadge('scannerDb2', 'live');
    setStatus('Polymarket', 'live', 'Polymarket · ' + matched.length + ' NBA games');
    console.log('[PM] ' + matched.length + '/' + games.length + ' matched');

  } catch(e) {
    console.warn('[PM error]', e.message, e.stack?.split('\n')[1]);
    setStatus('Polymarket', 'err', 'PM · ' + String(e.message).slice(0, 35));
    if (!Array.isArray(liveMarkets)) liveMarkets = [];
    try { renderPMTable(); } catch(_) {}
  }
}


async function fetchReferees() {
  setStatus('Referees', 'idle', 'Referees \u00B7 Demo data');
  if (typeof applyRefDemoData === 'function') applyRefDemoData();
}

// ──────────────────────────────────────────────
// BUILD LIVE MARKETS (single source of truth)
// ──────────────────────────────────────────────

function buildLiveMarkets() {
  const derived = gameData.map(g => {
    const { finalProb, F, confidence, method, mlProb } = getGameProb(g);
    return {
      question:     g.label + ' to win',
      gameId:       g.id,
      closes:       g.time,
      yesPrice:     g.pmYesPrice || 0.5,
      noPrice:      g.pmNoPrice  || 0.5,
      volume:       g.pmVolume   || 0,
      liquidity:    (g.pmVolume || 0) > 50000 ? 'High'
                  : (g.pmVolume || 0) > 20000 ? 'Medium' : 'Low',
      modelProb:    finalProb,
      confidence, F, method, mlProb,
      hoursToClose: g.hoursToClose || 4,
      spread:       g.pmSpread || g.spread || null,
      pmLive:       g.pmLive || false,
      _live:        g.pmLive || false,
    };
  });

  liveMarkets.forEach(lm => {
    const alreadyDerived = derived.some(d => {
      const q = (lm.question || '').toLowerCase();
      return d.question.toLowerCase().split(' ')
        .slice(0, 2).some(w => q.includes(w) && w.length > 3);
    });
    if (!alreadyDerived && lm._live) {
      derived.push({
        question: lm.question || '?', gameId: null, closes: '\u2014',
        yesPrice: lm.yesPrice, noPrice: lm.noPrice || (1 - lm.yesPrice),
        volume: lm.volume || 0, liquidity: lm.liquidity || 'Low',
        modelProb: 0.5, confidence: 0, F: {}, method: 'none',
        hoursToClose: 24, spread: lm.spread, pmLive: true, _live: true,
      });
    }
  });

  return derived;
}

// ──────────────────────────────────────────────
// REFRESH ALL
// ──────────────────────────────────────────────

let _refreshTimer = null;

async function refreshAll() {
  console.log('[refreshAll] Starting full sync...');
  const ri = document.getElementById('refreshIcon');
  const sb = document.getElementById('syncBtn');
  if (ri) ri.style.animation = 'spin .8s linear infinite';
  if (sb) sb.classList.add('spin');

  const built = await buildGameDataFromESPN();
  if (built) {
    console.log('[refreshAll] gameData rebuilt: ' + gameData.length + ' games');
    renderLiveGames();
  }

  await Promise.allSettled([
    fetchESPNScoreboard(),
    fetchNBATeamStats(),
    fetchNBARecency(),
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
  renderLiveGames();
  renderGameSelector();
  renderEngineDetail();
  if (typeof renderFormTrends === 'function') renderFormTrends();
  AlertSystem.renderAll();

  console.log('[refreshAll] Sync complete at ' + ts);
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

console.log('\u2705 api.js v3.3 loaded | ' + NBA_SEASON + ' | PM Full Integration');
