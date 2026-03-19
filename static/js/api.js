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
        pmNoPrice:   0.5,
        pmVolume:    0,
        pmSpread:    null,
        pmQuestion:  '',
        pmTokenId:   null,
        pmLive:      false,
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
  setStatus('Polymarket', 'conn', 'Polymarket \u00B7 Connecting...');
  try {
    // Tahap 1: Fetch NBA markets
    let raw = [];
    try {
      const nbaData = await apiFetch(API.pmNBA(), {}, 12000);
      raw = nbaData.markets || nbaData || [];
      console.log('[PM] NBA endpoint: ' + raw.length + ' markets (scanned ' + (nbaData.total_scanned || '?') + ')');
    } catch (e) {
      console.warn('[PM] NBA endpoint gagal, fallback generic:', e.message);
      const fallback = await apiFetch(API.pmMarkets(), {}, 9000);
      const allRaw   = fallback.markets || fallback || [];
      raw = allRaw.filter(m => {
        const text = ((m.question || '') + ' ' + (m.title || '')).toLowerCase();
        return Object.values(TEAM_NAME_MAP).flat().some(kw => text.includes(kw));
      });
    }

    if (!raw.length) {
      console.warn('[PM] 0 NBA markets');
      setStatus('Polymarket', 'err', 'Polymarket \u00B7 0 NBA markets');
      renderPMTable();
      return;
    }

    // Tahap 2: Enrich midpoint + order book
    const enrichResults = await Promise.allSettled(
      raw.slice(0, 20).map(async m => {
        const tokenIds = m.clob_token_ids || [];
        const tid = tokenIds[0] || m.tokens?.[0]?.token_id || m.condition_id || null;
        if (!tid) return { ...m, _tid: null };
        try {
          const [midRes, bookRes] = await Promise.all([
            apiFetch(API.pmMidpoint(tid), {}, 4000).catch(() => ({})),
            apiFetch(API.pmBook(tid),     {}, 4000).catch(() => ({})),
          ]);
          const bestAsk = bookRes.asks?.[0]?.price ?? null;
          const bestBid = bookRes.bids?.[0]?.price ?? null;
          return {
            ...m, _tid: tid,
            _mid:     midRes.mid ? parseFloat(midRes.mid) : null,
            _spread:  (bestAsk && bestBid) ? parseFloat(bestAsk) - parseFloat(bestBid) : null,
            _bestBid: bestBid ? parseFloat(bestBid) : null,
            _bestAsk: bestAsk ? parseFloat(bestAsk) : null,
          };
        } catch { return { ...m, _tid: tid }; }
      })
    );

    // Tahap 3: Build liveMarkets + match ke gameData
    const enriched = enrichResults.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
    let matched = 0, unmatched = 0;
    liveMarkets.length = 0;

    enriched.forEach(m => {
      const question = m.question || m.title || '';
      const outYes   = m.outcomes?.find?.(o => (o.name || '').toLowerCase() === 'yes');
      const outNo    = m.outcomes?.find?.(o => (o.name || '').toLowerCase() === 'no');
      const yesPrice = parseFloat(m._mid || outYes?.price || m.outcomePrices?.[0] || 0);
      const noPrice  = parseFloat(outNo?.price || m.outcomePrices?.[1] || (1 - yesPrice));

      if (yesPrice <= 0 || yesPrice >= 1) return;

      const marketObj = {
        question, yesPrice,
        noPrice:    parseFloat(noPrice.toFixed(4)),
        volume:     parseInt(m.volumeNum || m.volume || 0),
        spread:     m._spread || null,
        bestBid:    m._bestBid || null,
        bestAsk:    m._bestAsk || null,
        liquidity:  parseInt(m.volumeNum || 0) > 50000 ? 'High'
                  : parseInt(m.volumeNum || 0) > 20000 ? 'Medium' : 'Low',
        tokenId:    m._tid || null,
        conditionId: m.condition_id || m.id || null,
        _live:      true,
      };

      liveMarkets.push(marketObj);

      // Match ke gameData
      const result = matchMarketToGame(question);
      if (result) {
        const g = result.game;
        const marketSide = detectMarketSide(question);
        const isHomeYes  = marketSide === g.home || (result.homeMatch && !result.awayMatch);

        if (isHomeYes) {
          g.pmYesPrice = yesPrice;
          g.pmNoPrice  = noPrice;
        } else {
          g.pmYesPrice = noPrice;
          g.pmNoPrice  = yesPrice;
        }
        g.pmVolume   = marketObj.volume;
        g.pmSpread   = marketObj.spread;
        g.pmQuestion = question;
        g.pmTokenId  = marketObj.tokenId;
        g.pmLive     = true;
        g.spread     = marketObj.spread;
        matched++;
        console.log('[PM] \u2713 ' + question.slice(0, 50) + ' \u2192 ' + g.home + ' vs ' + g.away +
                     ' YES=' + yesPrice.toFixed(2) + ' side=' + (isHomeYes ? 'home' : 'away'));
      } else {
        unmatched++;
      }
    });

    // Tahap 4: Render semua
    AlertSystem.checkPrice(liveMarkets);
    renderPMTable();
    renderLiveGames();
    renderOddsFromPM();
    renderGameSelector();
    renderEngineDetail();
    updateDashboardKPIs();

    setBadge('scannerDb', 'live');
    setBadge('scannerDb2', 'live');

    const statusMsg = 'PM \u00B7 ' + liveMarkets.length + ' mkts \u00B7 ' + matched + ' matched';
    setStatus('Polymarket', 'live', statusMsg);
    console.log('[PM] ' + statusMsg);

  } catch (e) {
    console.warn('[PM]', e.message);
    setStatus('Polymarket', 'err', 'PM \u00B7 ' + e.message.slice(0, 28));
    renderPMTable();
  }
}

// ──────────────────────────────────────────────
// ODDS COMPARATOR — auto dari PM data
// ──────────────────────────────────────────────

function impliedToAmerican(prob) {
  if (!prob || prob <= 0 || prob >= 1) return '\u2014';
  if (prob >= 0.5) return '-' + Math.round(prob / (1 - prob) * 100);
  return '+' + Math.round((1 - prob) / prob * 100);
}

function renderOddsFromPM() {
  const rows = [];

  gameData.forEach(g => {
    if (!g.pmLive || g.pmYesPrice <= 0.01 || g.pmYesPrice >= 0.99) return;

    const homeImplied = g.pmYesPrice;
    const awayImplied = g.pmNoPrice || (1 - homeImplied);
    const homeML = impliedToAmerican(homeImplied);
    const awayML = impliedToAmerican(awayImplied);

    let modelProb = 0.5;
    if (typeof getGameProb === 'function') {
      const result = getGameProb(g);
      modelProb = result.finalProb || 0.5;
    }
    const edgeVsPM = ((modelProb - homeImplied) * 100).toFixed(1);

    rows.push({
      game: g.home + ' vs ' + g.away, book: 'Polymarket',
      homeML, awayML,
      implied: (homeImplied * 100).toFixed(1) + '%',
      pmPrice: '$' + homeImplied.toFixed(2),
      model:   (modelProb * 100).toFixed(1) + '%',
      vsPM:    (edgeVsPM > 0 ? '+' : '') + edgeVsPM + '%',
      arb: 'No', _edge: parseFloat(edgeVsPM),
      _homeAbbr: g.home, _awayAbbr: g.away, _pmYes: homeImplied, _modelP: modelProb,
    });
  });

  rows.sort((a, b) => Math.abs(b._edge || 0) - Math.abs(a._edge || 0));

  // Render langsung ke DOM
  const tbody = document.getElementById('oddsTbody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--t2);padding:20px">'
      + 'Menunggu data Polymarket... Klik Sync.</td></tr>';
    setBadge('oddsDb', 'demo');
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const ec = (r._edge || 0) > 3 ? 'var(--green)' : (r._edge || 0) < -3 ? 'var(--red)' : 'var(--t2)';
    return '<tr>' +
      '<td style="text-align:left;font-weight:600">' + sanitize(r.game) + '</td>' +
      '<td><span class="db db-live" style="font-size:9px">PM</span></td>' +
      '<td style="font-family:\'JetBrains Mono\',monospace;font-size:11px">' + r.homeML + '</td>' +
      '<td style="font-family:\'JetBrains Mono\',monospace;font-size:11px">' + r.awayML + '</td>' +
      '<td>' + r.implied + '</td>' +
      '<td style="color:var(--amber);font-weight:600">' + r.pmPrice + '</td>' +
      '<td>' + r.model + '</td>' +
      '<td style="color:' + ec + ';font-weight:700">' + r.vsPM + '</td>' +
      '<td style="color:var(--t2)">' + r.arb + '</td></tr>';
  }).join('');

  setBadge('oddsDb', 'live');
}

// ──────────────────────────────────────────────
// DASHBOARD KPIs
// ──────────────────────────────────────────────

function updateDashboardKPIs() {
  try {
    const gamesWithPM = gameData.filter(g => g.pmLive && g.pmYesPrice > 0.01);
    if (!gamesWithPM.length) return;
    let totalEdge = 0, edgeCount = 0;
    gamesWithPM.forEach(g => {
      if (typeof getGameProb === 'function') {
        const { finalProb } = getGameProb(g);
        totalEdge += Math.abs(finalProb - g.pmYesPrice) * 100;
        edgeCount++;
      }
    });
    if (edgeCount > 0) {
      const avgEdge = totalEdge / edgeCount;
      const el  = document.getElementById('kpiEdge');
      const sub = document.getElementById('kpiEdgeSub');
      if (el) el.textContent = avgEdge.toFixed(1) + '%';
      if (sub) sub.textContent = edgeCount + ' games with PM odds';
    }
  } catch (e) { console.warn('[updateDashboardKPIs]', e.message); }
}

// ──────────────────────────────────────────────
// KELLY AUTO-FILL (dari game click)
// ──────────────────────────────────────────────

function autoFillKelly(gameId) {
  const g = gameData.find(gm => gm.id === gameId);
  if (!g) return;
  if (typeof getGameProb === 'function') {
    const { finalProb } = getGameProb(g);
    const probInput  = document.getElementById('kcModelProb');
    const priceInput = document.getElementById('kcYesPrice');
    if (probInput)  probInput.value = Math.round(finalProb * 100);
    if (priceInput) priceInput.value = (g.pmYesPrice || 0.5).toFixed(2);
    if (typeof calcKelly === 'function') calcKelly();
  }
  if (typeof showSection === 'function') showSection('kelly', null);
}

// ──────────────────────────────────────────────
// REFEREES
// ──────────────────────────────────────────────

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
