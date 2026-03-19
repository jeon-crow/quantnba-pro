"""
data_layer.py — Lapisan data terpusat QuantNBA Pro
Sumber:
  - nba_api  → statistik historis, advanced metrics, training ML
  - ESPN API → live score, injury real-time, standings
"""

import time
import logging
import requests
from datetime import datetime

logger = logging.getLogger(__name__)

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"

NBA_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Host": "stats.nba.com",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "Connection": "keep-alive",
}

_cache: dict = {}
CACHE_TTL = 60


def _cached_get(key: str, fn, ttl: int = CACHE_TTL):
    now = time.time()
    if key in _cache and now - _cache[key]["ts"] < ttl:
        return _cache[key]["data"]
    try:
        data = fn()
        _cache[key] = {"data": data, "ts": now}
        return data
    except Exception as e:
        logger.warning(f"[cache miss] {key}: {e}")
        if key in _cache:
            return _cache[key]["data"]
        raise


def espn_scoreboard(date=None):
    def fetch():
        params = {}
        if date:
            params["dates"] = date.replace("-", "")
        r = requests.get(f"{ESPN_BASE}/scoreboard", params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    key = f"espn:scoreboard:{date or 'today'}"
    return _cached_get(key, fetch, ttl=20)


def espn_injuries():
    def fetch():
        r = requests.get(f"{ESPN_BASE}/teams", timeout=10)
        r.raise_for_status()
        teams_data = r.json()
        injuries = []
        for team in (teams_data.get("sports", [{}])[0]
                     .get("leagues", [{}])[0]
                     .get("teams", [])):
            ti = team.get("team", {})
            tid = ti.get("id")
            abbr = ti.get("abbreviation", "?")
            if not tid:
                continue
            try:
                tr = requests.get(f"{ESPN_BASE}/teams/{tid}", timeout=8)
                tr.raise_for_status()
                td = tr.json()
                for inj in td.get("team", {}).get("injuries", []):
                    athlete = inj.get("athlete", {})
                    injuries.append({
                        "name": athlete.get("displayName", ""),
                        "team": abbr,
                        "status": inj.get("status", ""),
                        "detail": inj.get("shortComment", ""),
                        "impact": _estimate_impact(inj.get("status", "")),
                    })
                time.sleep(0.15)
            except Exception as e:
                logger.warning(f"[ESPN injury] team {abbr}: {e}")
        return injuries
    return _cached_get("espn:injuries", fetch, ttl=300)


def espn_standings():
    def fetch():
        r = requests.get(f"{ESPN_BASE}/standings", timeout=10)
        r.raise_for_status()
        return r.json()
    return _cached_get("espn:standings", fetch, ttl=600)


def _estimate_impact(status):
    s = status.lower()
    if "out" in s or "doubtful" in s:
        return -6.5
    if "questionable" in s:
        return -3.5
    return -1.5


def nba_scoreboard(game_date=None):
    from nba_api.stats.endpoints import scoreboardv2
    if not game_date:
        game_date = datetime.now().strftime("%m/%d/%Y")
    def fetch():
        sb = scoreboardv2.ScoreboardV2(
            game_date=game_date,
            league_id="00",
            day_offset=0,
            headers=NBA_HEADERS,
        )
        return sb.get_dict()
    return _cached_get(f"nba:scoreboard:{game_date}", fetch, ttl=30)


def nba_team_stats(season="2024-25"):
    from nba_api.stats.endpoints import leaguedashteamstats
    def fetch():
        ts = leaguedashteamstats.LeagueDashTeamStats(
            season=season,
            measure_type_detailed_defense="Advanced",
            per_mode_detailed="PerGame",
            headers=NBA_HEADERS,
        )
        df = ts.get_data_frames()[0]
        results = []
        for _, row in df.iterrows():
            results.append({
                "team_id": row.get("TEAM_ID"),
                "abbr": row.get("TEAM_ABBREVIATION", ""),
                "name": row.get("TEAM_NAME", ""),
                "ortg": float(row.get("OFF_RATING", 110)),
                "drtg": float(row.get("DEF_RATING", 110)),
                "net": float(row.get("NET_RATING", 0)),
                "pace": float(row.get("PACE", 100)),
                "wins": int(row.get("W", 0)),
                "losses": int(row.get("L", 0)),
            })
        return results
    return _cached_get(f"nba:teamstats:{season}", fetch, ttl=3600)


def nba_team_last_n_games(team_id, n=5, season="2024-25"):
    from nba_api.stats.endpoints import teamgamelog
    def fetch():
        gl = teamgamelog.TeamGameLog(
            team_id=team_id,
            season=season,
            season_type_all_star="Regular Season",
            headers=NBA_HEADERS,
        )
        df = gl.get_data_frames()[0].head(n)
        games = []
        for _, row in df.iterrows():
            games.append({
                "game_id": row.get("Game_ID", ""),
                "date": row.get("GAME_DATE", ""),
                "matchup": row.get("MATCHUP", ""),
                "wl": row.get("WL", ""),
                "pts": int(row.get("PTS", 0)),
                "plus_minus": float(row.get("PLUS_MINUS", 0)),
            })
        return games
    return _cached_get(f"nba:gamelog:{team_id}:{n}:{season}", fetch, ttl=1800)


def nba_historical_games(season="2024-25", n=200):
    from nba_api.stats.endpoints import leaguegamefinder
    def fetch():
        gf = leaguegamefinder.LeagueGameFinder(
            season_nullable=season,
            league_id_nullable="00",
            season_type_nullable="Regular Season",
            headers=NBA_HEADERS,
        )
        df = gf.get_data_frames()[0]
        df = df[df["MATCHUP"].str.contains("vs\\.")].head(n)
        games = []
        for _, row in df.iterrows():
            games.append({
                "game_id": row.get("GAME_ID", ""),
                "date": row.get("GAME_DATE", ""),
                "team": row.get("TEAM_ABBREVIATION", ""),
                "matchup": row.get("MATCHUP", ""),
                "wl": row.get("WL", ""),
                "pts": int(row.get("PTS", 0)),
                "plus_minus": float(row.get("PLUS_MINUS", 0)),
            })
        return games
    return _cached_get(f"nba:historical:{season}:{n}", fetch, ttl=86400)


def build_game_features(home_abbr, away_abbr, season="2024-25"):
    try:
        all_teams = nba_team_stats(season)
        team_map = {t["abbr"]: t for t in all_teams}
        ht = team_map.get(home_abbr, {})
        at = team_map.get(away_abbr, {})
        net_diff = ht.get("net", 0) - at.get("net", 0)
        pace_fast = 1 if (ht.get("pace", 100) + at.get("pace", 100)) / 2 > 100.5 else 0
        home_rec, away_rec = 0.0, 0.0
        if ht.get("team_id"):
            hlogs = nba_team_last_n_games(ht["team_id"], 5, season)
            if hlogs:
                home_rec = sum(g["plus_minus"] for g in hlogs) / len(hlogs)
        if at.get("team_id"):
            alogs = nba_team_last_n_games(at["team_id"], 5, season)
            if alogs:
                away_rec = sum(g["plus_minus"] for g in alogs) / len(alogs)
        return {
            "net_rating_diff": round(net_diff, 2),
            "recency_diff": round(home_rec - away_rec, 2),
            "injury_adj": 0.0,
            "home_flag": 1,
            "rest_diff": 0,
            "ref_pace_fast": pace_fast,
            "market_momentum": 0.0,
            "home_abbr": home_abbr,
            "away_abbr": away_abbr,
        }
    except Exception as e:
        logger.error(f"[build_features] {home_abbr} vs {away_abbr}: {e}")
        return {
            "net_rating_diff": 0.0,
            "recency_diff": 0.0,
            "injury_adj": 0.0,
            "home_flag": 1,
            "rest_diff": 0,
            "ref_pace_fast": 0,
            "market_momentum": 0.0,
            "home_abbr": home_abbr,
            "away_abbr": away_abbr,
        }
