"""
server.py — QuantNBA Pro v3.1
Season: 2025-26
Data: ESPN (live) + nba_api (stats/recency) + Polymarket (odds)
"""

import os
import json
import time
import logging
import threading
import requests
from datetime import datetime
from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder="static")

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
CORS(app, origins=ALLOWED_ORIGINS)

PM_GAMMA  = "https://gamma-api.polymarket.com"
PM_CLOB   = "https://clob.polymarket.com"
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
SEASON    = os.environ.get("NBA_SEASON", "2025-26")


class RateLimiter:
    def __init__(self, max_per_minute):
        self.max   = max_per_minute
        self.calls = []
        self._lock = threading.Lock()

    def can_call(self):
        now = time.time()
        with self._lock:
            self.calls = [t for t in self.calls if now - t < 60]
            if len(self.calls) >= self.max:
                return False
            self.calls.append(now)
            return True


pm_limiter  = RateLimiter(50)
nba_limiter = RateLimiter(25)
ml_limiter  = RateLimiter(60)

_cache      = {}
_cache_lock = threading.Lock()


def cached_get(key, url, headers=None, ttl=60):
    now = time.time()
    with _cache_lock:
        if key in _cache and now - _cache[key]["ts"] < ttl:
            return _cache[key]["data"]
    try:
        r = requests.get(url, headers=headers or {}, timeout=10)
        r.raise_for_status()
        data = r.json()
        with _cache_lock:
            _cache[key] = {"data": data, "ts": now}
        return data
    except Exception as e:
        logger.warning(f"[cache] {key}: {e}")
        with _cache_lock:
            if key in _cache:
                return _cache[key]["data"]
        raise


# ── Static ──
@app.route("/")
def index():
    return send_from_directory("static", "index.html")

@app.route("/static/<path:path>")
def serve_static(path):
    return send_from_directory("static", path)


# ── Health & Status ──
@app.route("/api/health")
def health():
    return jsonify({
        "status":       "ok",
        "cache_size":   len(_cache),
        "ml_loaded":    ml_model is not None,
        "poller_alive": _poller_thread.is_alive() if _poller_thread else False,
        "ws_clients":   ws_clients,
        "season":       SEASON,
    })

@app.route("/api/status")
def api_status():
    return jsonify({
        "polymarket":  "available",
        "nba_api":     "available",
        "espn":        "available",
        "ml":          "loaded" if ml_model else "not_loaded",
        "season":      SEASON,
        "server_time": datetime.now().isoformat(),
    })


# ── ESPN ──
@app.route("/api/espn/scoreboard")
def espn_scoreboard():
    date_param = request.args.get("date", "")
    params = f"?dates={date_param.replace('-', '')}" if date_param else ""
    try:
        data = cached_get(
            f"espn:scoreboard:{date_param or 'today'}",
            f"{ESPN_BASE}/scoreboard{params}",
            ttl=20,
        )
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/espn/summary/<event_id>")
def espn_summary(event_id):
    try:
        data = cached_get(
            f"espn:summary:{event_id}",
            f"{ESPN_BASE}/summary?event={event_id}",
            ttl=30,
        )
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/espn/injuries")
def espn_injuries():
    try:
        teams_data = cached_get("espn:teams", f"{ESPN_BASE}/teams", ttl=3600)
        injuries   = []
        for team in (teams_data.get("sports", [{}])[0]
                     .get("leagues", [{}])[0]
                     .get("teams", [])):
            ti   = team.get("team", {})
            tid  = ti.get("id")
            abbr = ti.get("abbreviation", "?")
            if not tid:
                continue
            try:
                td = cached_get(
                    f"espn:team:{tid}",
                    f"{ESPN_BASE}/teams/{tid}",
                    ttl=300,
                )
                for inj in td.get("team", {}).get("injuries", []):
                    athlete = inj.get("athlete", {})
                    injuries.append({
                        "name":   athlete.get("displayName", ""),
                        "team":   abbr,
                        "status": inj.get("status", ""),
                        "detail": inj.get("shortComment", ""),
                    })
            except Exception:
                pass
        return jsonify({"injuries": injuries, "source": "espn_live"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/espn/standings")
def espn_standings():
    try:
        data = cached_get("espn:standings", f"{ESPN_BASE}/standings", ttl=600)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── nba_api ──
@app.route("/api/nba/teamstats")
def nba_team_stats():
    if not nba_limiter.can_call():
        return jsonify({"error": "Rate limit"}), 429
    season = request.args.get("season", SEASON)
    try:
        from nba_api.stats.endpoints import leaguedashteamstats
        from nba_api.stats.static import teams as nba_teams_static

        static_map = {
            t["abbreviation"]: t["id"]
            for t in nba_teams_static.get_teams()
        }

        cache_key = f"nba:teamstats:{season}"
        now       = time.time()
        with _cache_lock:
            if cache_key in _cache and now - _cache[cache_key]["ts"] < 3600:
                return jsonify({"teams": _cache[cache_key]["data"], "season": season})

        ts = leaguedashteamstats.LeagueDashTeamStats(
            season=season,
            measure_type_detailed_defense="Advanced",
            per_mode_detailed="PerGame",
            timeout=30,
        )
        df      = ts.get_data_frames()[0]
        results = []
        for _, row in df.iterrows():
            abbr = row.get("TEAM_ABBREVIATION", "")
            results.append({
                "team_id": static_map.get(abbr, row.get("TEAM_ID")),
                "abbr":    abbr,
                "name":    row.get("TEAM_NAME", ""),
                "ortg":    float(row.get("OFF_RATING", 110)),
                "drtg":    float(row.get("DEF_RATING", 110)),
                "net":     float(row.get("NET_RATING", 0)),
                "pace":    float(row.get("PACE", 100)),
                "wins":    int(row.get("W", 0)),
                "losses":  int(row.get("L", 0)),
            })

        with _cache_lock:
            _cache[cache_key] = {"data": results, "ts": now}

        return jsonify({"teams": results, "season": season})
    except ImportError:
        return jsonify({"error": "nba_api not installed"}), 503
    except Exception as e:
        logger.error(f"[nba/teamstats] {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/nba/gamelog/<int:team_id>")
def nba_gamelog(team_id):
    if not nba_limiter.can_call():
        return jsonify({"error": "Rate limit"}), 429
    n      = int(request.args.get("n", 5))
    season = request.args.get("season", SEASON)

    cache_key = f"nba:gamelog:{team_id}:{n}:{season}"
    now       = time.time()
    with _cache_lock:
        if cache_key in _cache and now - _cache[cache_key]["ts"] < 1800:
            return jsonify({"games": _cache[cache_key]["data"]})
    try:
        from nba_api.stats.endpoints import teamgamelog
        gl    = teamgamelog.TeamGameLog(
            team_id=team_id,
            season=season,
            season_type_all_star="Regular Season",
        )
        df    = gl.get_data_frames()[0].head(n)
        games = []
        for _, row in df.iterrows():
            games.append({
                "game_id":    row.get("Game_ID", ""),
                "date":       row.get("GAME_DATE", ""),
                "matchup":    row.get("MATCHUP", ""),
                "wl":         row.get("WL", ""),
                "pts":        int(row.get("PTS", 0)),
                "plus_minus": float(row.get("PLUS_MINUS", 0)),
            })
        with _cache_lock:
            _cache[cache_key] = {"data": games, "ts": now}
        return jsonify({"games": games})
    except ImportError:
        return jsonify({"error": "nba_api not installed"}), 503
    except Exception as e:
        logger.error(f"[nba/gamelog] team {team_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/nba/scoreboard")
def nba_scoreboard():
    if not nba_limiter.can_call():
        return jsonify({"error": "Rate limit"}), 429
    game_date = request.args.get("date")
    try:
        from nba_api.stats.endpoints import scoreboardv2
        if not game_date:
            game_date = datetime.now().strftime("%m/%d/%Y")
        sb   = scoreboardv2.ScoreboardV2(game_date=game_date, league_id="00")
        data = sb.get_dict()
        return jsonify(data)
    except ImportError:
        return jsonify({"error": "nba_api not installed"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/nba/features")
def nba_features():
    home = request.args.get("home", "")
    away = request.args.get("away", "")
    if not home or not away:
        return jsonify({"error": "home dan away wajib diisi"}), 400
    try:
        from data_layer import build_game_features
        features = build_game_features(home, away, SEASON)
        return jsonify(features)
    except ImportError:
        return jsonify({"error": "nba_api not installed"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Polymarket ──
@app.route("/api/pm/markets")
def pm_markets():
    if not pm_limiter.can_call():
        return jsonify({"error": "Rate limit"}), 429
    try:
        p = request.args.to_dict()
        p.setdefault("active", "true")
        p.setdefault("closed", "false")
        # Naikkan limit jika ada tag
        if "tag" in p:
            p.setdefault("limit", "100")
        else:
            p.setdefault("limit", "50")
        url      = f"{PM_GAMMA}/markets?" + "&".join(f"{k}={v}" for k, v in p.items())
        cache_key = "pm:markets:" + p.get("tag", "all")
        data     = cached_get(cache_key, url, ttl=45)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/pm/midpoint/<token_id>")
def pm_midpoint(token_id):
    try:
        data = cached_get(
            f"pm:mid:{token_id}",
            f"{PM_CLOB}/midpoint?token_id={token_id}",
            ttl=20,
        )
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/pm/book/<token_id>")
def pm_book(token_id):
    try:
        data = cached_get(
            f"pm:book:{token_id}",
            f"{PM_CLOB}/book?token_id={token_id}",
            ttl=15,
        )
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500






# ── Polymarket NBA-specific (ADDED by fix) ──
NBA_KEYWORDS = [
    'nba','celtics','lakers','warriors','nuggets','suns','heat','bucks',
    'knicks','nets','sixers','76ers','mavericks','mavs','pelicans',
    'clippers','thunder','grizzlies','raptors','bulls','pistons',
    'cavaliers','cavs','magic','kings','spurs','jazz','blazers',
    'timberwolves','wolves','hawks','hornets','rockets','pacers',
    'wizards','basketball','playoff','championship','mvp','finals',
    'boston','brooklyn','new york','philadelphia','toronto',
    'chicago','cleveland','detroit','indiana','milwaukee',
    'atlanta','charlotte','miami','orlando','washington',
    'denver','minnesota','oklahoma','portland','utah',
    'golden state','los angeles','phoenix','sacramento','san antonio',
    'dallas','houston','memphis','new orleans',
]

def _is_nba_market(m):
    text = (
        (m.get("question") or "") + " " +
        (m.get("title") or "") + " " +
        (m.get("description") or "")
    ).lower()
    return any(kw in text for kw in NBA_KEYWORDS)


@app.route("/api/pm/nba")
def pm_nba_markets():
    if not pm_limiter.can_call():
        return jsonify({"error": "Rate limit"}), 429

    cache_key = "pm:nba:combined"
    now = time.time()
    with _cache_lock:
        if cache_key in _cache and now - _cache[cache_key]["ts"] < 60:
            return jsonify(_cache[cache_key]["data"])

    all_markets = []

    for offset in [0, 100]:
        try:
            url = (f"{PM_GAMMA}/markets?active=true&closed=false"
                   f"&limit=100&offset={offset}")
            data = cached_get(f"pm:bulk:{offset}", url, ttl=60)
            batch = data if isinstance(data, list) else data.get("markets", data.get("data", []))
            if isinstance(batch, list):
                all_markets.extend(batch)
        except Exception as e:
            logger.debug(f"[pm/nba] bulk offset={offset}: {e}")

    for slug in ["nba", "nba-basketball", "basketball"]:
        try:
            url = f"{PM_GAMMA}/events?slug={slug}&active=true&limit=50"
            data = cached_get(f"pm:event:{slug}", url, ttl=120)
            events = data if isinstance(data, list) else [data] if isinstance(data, dict) else []
            for ev in events:
                for mkt in ev.get("markets", []):
                    all_markets.append(mkt)
        except Exception:
            pass

    for query in ["NBA", "basketball winner"]:
        try:
            url = f"{PM_GAMMA}/markets?active=true&closed=false&limit=50&_q={query}"
            data = cached_get(f"pm:search:{query}", url, ttl=120)
            batch = data if isinstance(data, list) else data.get("markets", [])
            if isinstance(batch, list):
                all_markets.extend(batch)
        except Exception:
            pass

    nba_markets = [m for m in all_markets if _is_nba_market(m)]

    seen = set()
    unique = []
    for m in nba_markets:
        mid = m.get("condition_id") or m.get("id") or m.get("question", "")[:50]
        if mid not in seen:
            seen.add(mid)
            unique.append(m)

    result = {
        "markets":       unique,
        "count":         len(unique),
        "total_scanned": len(all_markets),
        "source":        "gamma_multi_strategy",
        "ts":            datetime.now().isoformat(),
    }

    with _cache_lock:
        _cache[cache_key] = {"data": result, "ts": now}

    logger.info(f"[pm/nba] Found {len(unique)} NBA markets from {len(all_markets)} total")
    return jsonify(result)



@app.route("/api/espn/teamstats")
def espn_team_stats():
    """
    Ambil statistik tim dari ESPN — W/L record dari scoreboard.
    """
    try:
        # Ambil standings untuk dapat W-L record
        standings_url  = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings"
        standings_data = cached_get("espn:standings:v2", standings_url, ttl=1800)

        # Buat mapping abbr -> wins/losses dari standings
        wl_map = {}
        for group in standings_data.get("children", []):
            for entry in group.get("standings", {}).get("entries", []):
                team  = entry.get("team", {})
                abbr  = team.get("abbreviation", "")
                wins, losses = 0, 0
                for stat in entry.get("stats", []):
                    if stat.get("name") == "wins":
                        wins = int(stat.get("value", 0))
                    if stat.get("name") == "losses":
                        losses = int(stat.get("value", 0))
                if abbr:
                    wl_map[abbr] = {"wins": wins, "losses": losses}

        # Ambil daftar tim
        teams_data = cached_get("espn:teams:full", f"{ESPN_BASE}/teams", ttl=3600)
        results    = []

        for team in (teams_data.get("sports", [{}])[0]
                     .get("leagues", [{}])[0]
                     .get("teams", [])):
            ti   = team.get("team", {})
            abbr = ti.get("abbreviation", "")
            if not abbr:
                continue

            wl     = wl_map.get(abbr, {"wins": 0, "losses": 0})
            wins   = wl["wins"]
            losses = wl["losses"]
            total  = wins + losses

            # Estimasi net rating dari win rate
            # NBA rata-rata: setiap 2.5 net rating = ~1 win lebih dari .500
            win_pct = wins / total if total > 0 else 0.5
            net_est = round((win_pct - 0.5) * 25, 1)
            ortg    = round(113.5 + net_est * 0.55, 1)
            drtg    = round(113.5 - net_est * 0.45, 1)

            results.append({
                "team_id": ti.get("id", ""),
                "abbr":    abbr,
                "name":    ti.get("displayName", ""),
                "ortg":    ortg,
                "drtg":    drtg,
                "net":     net_est,
                "pace":    100.5,
                "wins":    wins,
                "losses":  losses,
                "source":  "espn_estimated",
            })

        # Urutkan berdasarkan net rating
        results.sort(key=lambda x: x["net"], reverse=True)

        return jsonify({
            "teams":  results,
            "season": SEASON,
            "source": "espn_estimated",
            "note":   "Net rating diestimasi dari W-L record ESPN standings",
        })
    except Exception as e:
        logger.error(f"[espn/teamstats] {e}")
        return jsonify({"error": str(e)}), 500

# ── ML Model ──
import joblib
import numpy as np

MODEL_PATH      = os.path.join(os.path.dirname(__file__), "ml", "nba_model.joblib")
MODEL_META_PATH = os.path.join(os.path.dirname(__file__), "ml", "model_meta.json")
ml_model = None
ml_meta  = None

try:
    ml_model = joblib.load(MODEL_PATH)
    with open(MODEL_META_PATH) as f:
        ml_meta = json.load(f)
    logger.info(f"[ML] Loaded | Brier: {ml_meta['brier_score']:.4f} | Source: {ml_meta.get('data_source', '?')}")
except Exception as e:
    logger.warning(f"[ML] Not loaded: {e}")

FEATURE_KEYS = [
    "net_rating_diff", "recency_diff", "injury_adj",
    "home_flag", "rest_diff", "ref_pace_fast", "market_momentum",
]

@app.route("/api/ml/predict", methods=["POST"])
def ml_predict():
    if not ml_limiter.can_call():
        return jsonify({"error": "Rate limit: max 60/min"}), 429
    if ml_model is None:
        return jsonify({"error": "Model not loaded"}), 503
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400
    try:
        X    = np.array([[float(body.get(k, 0)) for k in FEATURE_KEYS]])
        prob = float(ml_model.predict_proba(X)[0, 1])
        return jsonify({
            "home_win_prob": round(prob, 4),
            "away_win_prob": round(1 - prob, 4),
            "confidence":   round(abs(prob - 0.5) * 200, 1),
            "model":        ml_meta["model_type"],
            "brier":        ml_meta["brier_score"],
            "data_source":  ml_meta.get("data_source", "unknown"),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/ml/batch", methods=["POST"])
def ml_batch():
    if not ml_limiter.can_call():
        return jsonify({"error": "Rate limit"}), 429
    if ml_model is None:
        return jsonify({"error": "Model not loaded"}), 503
    games = request.get_json()
    if not isinstance(games, list):
        return jsonify({"error": "Expected JSON array"}), 400
    results = []
    for g in games:
        try:
            X    = np.array([[float(g.get(k, 0)) for k in FEATURE_KEYS]])
            prob = float(ml_model.predict_proba(X)[0, 1])
            results.append({
                "game_id":       g.get("game_id", "?"),
                "home_win_prob": round(prob, 4),
                "confidence":    round(abs(prob - 0.5) * 200, 1),
            })
        except Exception as e:
            results.append({"game_id": g.get("game_id", "?"), "error": str(e)})
    return jsonify({"predictions": results, "model": ml_meta["model_type"]})

@app.route("/api/ml/info")
def ml_info():
    if ml_meta is None:
        return jsonify({"loaded": False})
    return jsonify({"loaded": True, **ml_meta})


# ── WebSocket ──
from flask_socketio import SocketIO, emit

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

live_score_cache = {}
_score_cache_lock = threading.Lock()
ws_clients        = 0
_ws_lock          = threading.Lock()
_poller_thread    = None


@socketio.on("connect")
def ws_connect():
    global ws_clients
    with _ws_lock:
        ws_clients += 1
    emit("server_status", {
        "connected":   True,
        "clients":     ws_clients,
        "ml_loaded":   ml_model is not None,
        "season":      SEASON,
        "data_source": "espn_live + nba_api",
    })

@socketio.on("disconnect")
def ws_disconnect():
    global ws_clients
    with _ws_lock:
        ws_clients = max(0, ws_clients - 1)

@socketio.on("request_scores")
def ws_request_scores():
    with _score_cache_lock:
        games = list(live_score_cache.values())
    emit("live_scores", {"games": games, "ts": time.time()})


def background_score_poller():
    global live_score_cache
    logger.info("[Poller] ESPN score poller started (20s interval)")
    while True:
        try:
            r = requests.get(f"{ESPN_BASE}/scoreboard", timeout=10)
            if r.status_code == 200:
                events  = r.json().get("events", [])
                updated = False
                with _score_cache_lock:
                    for event in events:
                        comp        = event.get("competitions", [{}])[0]
                        competitors = comp.get("competitors", [])
                        home   = next((c for c in competitors if c.get("homeAway") == "home"), {})
                        away   = next((c for c in competitors if c.get("homeAway") == "away"), {})
                        status = event.get("status", {})
                        state  = status.get("type", {}).get("state", "pre")
                        gid    = event.get("id", "")
                        new_entry = {
                            "id":         gid,
                            "home_team":  home.get("team", {}).get("abbreviation", "?"),
                            "away_team":  away.get("team", {}).get("abbreviation", "?"),
                            "home_score": int(home.get("score", 0) or 0),
                            "away_score": int(away.get("score", 0) or 0),
                            "period":     status.get("period", 0),
                            "clock":      status.get("displayClock", ""),
                            "status":     status.get("type", {}).get("shortDetail", ""),
                            "is_live":    state == "in",
                            "is_final":   state == "post",
                        }
                        old = live_score_cache.get(gid, {})
                        if (old.get("home_score") != new_entry["home_score"] or
                            old.get("away_score") != new_entry["away_score"] or
                            old.get("period")     != new_entry["period"]):
                            updated = True
                        live_score_cache[gid] = new_entry

                with _ws_lock:
                    clients = ws_clients

                if updated and clients > 0:
                    with _score_cache_lock:
                        games = list(live_score_cache.values())
                    live_count = sum(1 for g in games if g["is_live"])
                    socketio.emit("live_scores", {
                        "games":      games,
                        "ts":         time.time(),
                        "live_count": live_count,
                        "source":     "espn",
                        "season":     SEASON,
                    })
        except Exception as e:
            logger.error(f"[Poller] {e}")
        time.sleep(20)



# ── Polymarket NBA Games (ESPN slug matching) ─────────────────────────────────
ESPN_TO_PM_ABBR = {
    'wsh':'was','sa':'sas','utah':'uta','no':'nop',
    'lal':'lal','lac':'lac','cle':'cle','chi':'chi',
    'phx':'phx','mil':'mil','phi':'phi','sac':'sac',
    'orl':'orl','cha':'cha','det':'det','mia':'mia',
    'bos':'bos','bkn':'bkn','nyk':'nyk','ind':'ind',
    'atl':'atl','tor':'tor','okc':'okc','den':'den',
    'min':'min','por':'por','gsw':'gs','dal':'dal',
    'mem':'mem','hou':'hou','nop':'nop',
}

def _espn_to_pm(abbr):
    return ESPN_TO_PM_ABBR.get(abbr.lower(), abbr.lower())

@app.route('/api/pm/nba-games')
def pm_nba_games():
    try:
        from datetime import datetime, timezone, timedelta
        ET       = timezone(timedelta(hours=-4))
        today_et = datetime.now(ET).strftime('%Y-%m-%d')
        yest_et  = (datetime.now(ET) - timedelta(days=1)).strftime('%Y-%m-%d')

        espn_data = cached_get('espn:scoreboard:today', f'{ESPN_BASE}/scoreboard', ttl=20)
        events    = espn_data.get('events', [])

        results = []
        for ev in events:
            comps     = ev.get('competitions', [{}])[0]
            teams     = comps.get('competitors', [])
            home_t    = next((t for t in teams if t.get('homeAway')=='home'), {})
            away_t    = next((t for t in teams if t.get('homeAway')=='away'), {})
            home_abbr = _espn_to_pm(home_t.get('team',{}).get('abbreviation',''))
            away_abbr = _espn_to_pm(away_t.get('team',{}).get('abbreviation',''))
            home_name = home_t.get('team',{}).get('displayName','')
            away_name = away_t.get('team',{}).get('displayName','')
            status    = comps.get('status',{}).get('type',{}).get('name','')
            period    = comps.get('status',{}).get('period', 0)
            clock     = comps.get('status',{}).get('displayClock','')

            pm_data = None
            for date in [today_et, yest_et]:
                slug = f"nba-{away_abbr}-{home_abbr}-{date}"
                try:
                    data  = cached_get(f"pm:game:{slug}",
                                f"https://gamma-api.polymarket.com/events?slug={slug}",
                                ttl=45)
                    items = data if isinstance(data, list) else []
                    if items:
                        pm_data = items[0]
                        break
                except:
                    pass

            if not pm_data:
                results.append({'away':away_name,'home':home_name,
                    'away_abbr':away_abbr,'home_abbr':home_abbr,
                    'status':status,'period':period,'clock':clock,
                    'pm_found':False})
                continue

            # Cari market moneyline pakai sportsMarketType='winner'
            ml_mkt = None
            for mk in pm_data.get('markets', []):
                smt = mk.get('sportsMarketType', '')
                git = mk.get('groupItemTitle', '')
                
                # Prioritas 1: sportsMarketType == 'winner'
                if smt == 'moneyline':
                    oc = mk.get('outcomes','[]')
                    if isinstance(oc, str):
                        try: oc = json.loads(oc)
                        except: oc = []
                    ml_mkt = (oc, mk)
                    break
                    
            # Fallback: cari yang groupItemTitle kosong dan bukan spread/total
            if not ml_mkt:
                for mk in pm_data.get('markets', []):
                    git = (mk.get('groupItemTitle') or '').lower()
                    oc  = mk.get('outcomes','[]')
                    if isinstance(oc, str):
                        try: oc = json.loads(oc)
                        except: oc = []
                    if (len(oc)==2 and
                        'spread' not in git and
                        'total'  not in git and
                        'over'   not in git and
                        'point'  not in git and
                        'over'   not in str(oc).lower() and
                        'under'  not in str(oc).lower() and
                        'yes'    not in str(oc).lower()):
                        ml_mkt = (oc, mk)
                        break

            if not ml_mkt:
                results.append({'away':away_name,'home':home_name,
                    'status':status,'period':period,'clock':clock,
                    'pm_found':False})
                continue

            outcomes, mk = ml_mkt
            prices = mk.get('outcomePrices','[]')
            if isinstance(prices, str):
                try: prices = json.loads(prices)
                except: prices = ['0.5','0.5']

            # Map outcomes ke away/home price
            # Polymarket slug: nba-{away}-{home} → outcomes[0]=away tim, outcomes[1]=home tim
            # Tapi perlu verify dengan nama tim
            away_words = away_name.lower().split()
            home_words = home_name.lower().split()

            away_idx, home_idx = None, None
            for i, oc in enumerate(outcomes):
                oc_l = oc.lower()
                # Cek semua kata nama tim (hindari false positive kata pendek)
                if any(w in oc_l for w in away_words if len(w) > 3):
                    away_idx = i
                elif any(w in oc_l for w in home_words if len(w) > 3):
                    home_idx = i

            # Fallback jika tidak match: pakai posisi
            if away_idx is None and home_idx is None:
                away_idx, home_idx = 0, 1
            elif away_idx is None:
                away_idx = 1 - home_idx
            elif home_idx is None:
                home_idx = 1 - away_idx

            away_price = float(prices[away_idx]) if len(prices) > away_idx else 0.5
            home_price = float(prices[home_idx]) if len(prices) > home_idx else 0.5

            results.append({
                'away': away_name, 'home': home_name,
                'away_abbr': away_abbr, 'home_abbr': home_abbr,
                'status': status, 'period': period, 'clock': clock,
                'pm_found':   True,
                'away_price': away_price,
                'home_price': home_price,
                'outcomes':   outcomes,
                'volume':     float(mk.get('volume', 0) or 0),
                'liquidity':  float(pm_data.get('liquidity', 0) or 0),
                'slug':       f"nba-{away_abbr}-{home_abbr}-{today_et}",
            })

        return jsonify({'games': results, 'count': len(results)})
    except Exception as e:
        logger.error(f"[PM Games] {e}")
        return jsonify({'error': str(e)}), 500


_poller_thread = threading.Thread(target=background_score_poller, daemon=True)
_poller_thread.start()


if __name__ == "__main__":
    socketio.run(app, port=5000, debug=False, allow_unsafe_werkzeug=True)
