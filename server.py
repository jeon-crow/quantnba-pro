
import os
import json
import time
import requests
from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS
from functools import lru_cache
from datetime import datetime

app = Flask(__name__, static_folder='static')
CORS(app)

# ── Config ──
BDL_KEY = os.environ.get("BDL_KEY", "")
ODDS_KEY = os.environ.get("ODDS_KEY", "")
BDL_BASE = "https://api.balldontlie.io"
ODDS_BASE = "https://api.the-odds-api.com/v4"
PM_GAMMA = "https://gamma-api.polymarket.com"
PM_CLOB = "https://clob.polymarket.com"
NBA_INJURIES = "https://data.nba.com/data/10s/v2015/json/mobile_teams/nba/2025/league/00_injuries.json"

# ── Rate Limiter ──
class RateLimiter:
    def __init__(self, max_per_minute):
        self.max = max_per_minute
        self.calls = []

    def can_call(self):
        now = time.time()
        self.calls = [t for t in self.calls if now - t < 60]
        if len(self.calls) >= self.max:
            return False
        self.calls.append(now)
        return True

bdl_limiter = RateLimiter(28)
odds_limiter = RateLimiter(10)
pm_limiter = RateLimiter(50)

# ── Cache ──
cache = {}
CACHE_TTL = 60  # seconds

def cached_get(key, url, headers=None, ttl=CACHE_TTL):
    now = time.time()
    if key in cache and now - cache[key]["ts"] < ttl:
        return cache[key]["data"]
    try:
        r = requests.get(url, headers=headers or {}, timeout=10)
        r.raise_for_status()
        data = r.json()
        cache[key] = {"data": data, "ts": now}
        return data
    except Exception as e:
        if key in cache:
            return cache[key]["data"]
        raise e

# ══════════════════════════════════════════
# ROUTES — Static Files
# ══════════════════════════════════════════

@app.route("/")
def index():
    return send_from_directory("static", "index.html")

@app.route("/static/<path:path>")
def serve_static(path):
    return send_from_directory("static", path)

# ══════════════════════════════════════════
# ROUTES — API Proxy (keys never exposed to browser)
# ══════════════════════════════════════════

@app.route("/api/status")
def api_status():
    return jsonify({
        "bdl": "ready" if BDL_KEY else "no_key",
        "odds": "ready" if ODDS_KEY else "no_key",
        "polymarket": "available",
        "injuries": "available",
        "server_time": datetime.now().isoformat()
    })

# ── BallDontLie Proxy ──
@app.route("/api/bdl/<path:endpoint>")
def bdl_proxy(endpoint):
    if not BDL_KEY:
        return jsonify({"error": "BDL key not configured"}), 503
    if not bdl_limiter.can_call():
        return jsonify({"error": "Rate limit exceeded"}), 429
    try:
        params = request.args.to_dict()
        url = f"{BDL_BASE}/v1/{endpoint}"
        data = cached_get(
            f"bdl:{endpoint}:{json.dumps(params, sort_keys=True)}",
            url + "?" + "&".join(f"{k}={v}" for k, v in params.items()),
            headers={"Authorization": BDL_KEY},
            ttl=30
        )
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Polymarket Proxy ──
@app.route("/api/pm/markets")
def pm_markets():
    if not pm_limiter.can_call():
        return jsonify({"error": "Rate limit"}), 429
    try:
        params = request.args.to_dict()
        params.setdefault("active", "true")
        params.setdefault("limit", "50")
        params.setdefault("closed", "false")
        url = f"{PM_GAMMA}/markets?" + "&".join(f"{k}={v}" for k, v in params.items())
        data = cached_get("pm:markets", url, ttl=45)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/pm/midpoint/<token_id>")
def pm_midpoint(token_id):
    try:
        data = cached_get(
            f"pm:mid:{token_id}",
            f"{PM_CLOB}/midpoint?token_id={token_id}",
            ttl=20
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
            ttl=15
        )
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── NBA Injuries Proxy ──
@app.route("/api/injuries")
def nba_injuries():
    try:
        data = cached_get("nba:injuries", NBA_INJURIES, ttl=120)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── The Odds API Proxy ──
@app.route("/api/odds")
def odds_proxy():
    if not ODDS_KEY:
        return jsonify({"error": "Odds API key not configured"}), 503
    if not odds_limiter.can_call():
        return jsonify({"error": "Rate limit"}), 429
    try:
        url = (f"{ODDS_BASE}/sports/basketball_nba/odds"
               f"?apiKey={ODDS_KEY}"
               f"&regions=us&markets=h2h"
               f"&oddsFormat=american"
               f"&bookmakers=draftkings,fanduel,pinnacle,betmgm")
        data = cached_get("odds:nba", url, ttl=60)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Referees (NBA Stats) ──
@app.route("/api/referees")
def referees_proxy():
    try:
        today = datetime.now().strftime("%m/%d/%Y")
        url = (f"https://stats.nba.com/stats/scoreboardv2"
               f"?DayOffset=0&LeagueID=00&gameDate={today}")
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://www.nba.com",
            "Accept": "application/json"
        }
        data = cached_get("nba:refs:" + today, url, headers=headers, ttl=300)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Health Check ──
@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "cache_size": len(cache),
        "uptime": "running"
    })



# ══════════════════════════════════════════
# ML MODEL ENDPOINTS
# ══════════════════════════════════════════
import joblib
import numpy as np

# Load trained model
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'ml', 'nba_model.joblib')
MODEL_META_PATH = os.path.join(os.path.dirname(__file__), 'ml', 'model_meta.json')
ml_model = None
ml_meta = None

try:
    ml_model = joblib.load(MODEL_PATH)
    with open(MODEL_META_PATH) as f:
        ml_meta = json.load(f)
    print(f"[ML] Model loaded: {ml_meta['model_type']} (Brier: {ml_meta['brier_score']:.4f})")
except Exception as e:
    print(f"[ML] Model not loaded: {e}")

@app.route("/api/ml/predict", methods=["POST"])
def ml_predict():
    """
    ML model prediction endpoint.
    Expects JSON with game features.
    Returns calibrated probability.
    """
    if ml_model is None:
        return jsonify({"error": "Model not loaded"}), 503

    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    try:
        features = ml_meta['features']
        X = np.array([[
            float(data.get('net_rating_diff', 0)),
            float(data.get('recency_diff', 0)),
            float(data.get('injury_adj', 0)),
            float(data.get('home_flag', 1)),
            float(data.get('rest_diff', 0)),
            float(data.get('ref_pace_fast', 0)),
            float(data.get('market_momentum', 0)),
        ]])

        prob = float(ml_model.predict_proba(X)[0, 1])
        confidence = abs(prob - 0.5) * 200  # 0-100 scale

        return jsonify({
            "home_win_prob": round(prob, 4),
            "away_win_prob": round(1 - prob, 4),
            "confidence": round(confidence, 1),
            "model": ml_meta['model_type'],
            "brier": ml_meta['brier_score'],
            "features_used": features,
            "input": data
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/ml/batch", methods=["POST"])
def ml_batch_predict():
    """Batch prediction for multiple games at once."""
    if ml_model is None:
        return jsonify({"error": "Model not loaded"}), 503

    games = request.get_json()
    if not isinstance(games, list):
        return jsonify({"error": "Expected JSON array"}), 400

    results = []
    for g in games:
        try:
            X = np.array([[
                float(g.get('net_rating_diff', 0)),
                float(g.get('recency_diff', 0)),
                float(g.get('injury_adj', 0)),
                float(g.get('home_flag', 1)),
                float(g.get('rest_diff', 0)),
                float(g.get('ref_pace_fast', 0)),
                float(g.get('market_momentum', 0)),
            ]])
            prob = float(ml_model.predict_proba(X)[0, 1])
            results.append({
                "game_id": g.get("game_id", "?"),
                "home_win_prob": round(prob, 4),
                "confidence": round(abs(prob - 0.5) * 200, 1)
            })
        except Exception as e:
            results.append({"game_id": g.get("game_id", "?"), "error": str(e)})

    return jsonify({"predictions": results, "model": ml_meta['model_type']})

@app.route("/api/ml/info")
def ml_info():
    """Model metadata and health."""
    if ml_meta is None:
        return jsonify({"loaded": False})
    return jsonify({
        "loaded": True,
        **ml_meta
    })



# ══════════════════════════════════════════
# WEBSOCKET — Real-time live score updates
# ══════════════════════════════════════════
from flask_socketio import SocketIO, emit
import threading
import time as time_mod

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Background thread for polling live scores
live_score_cache = {}
ws_clients = 0

@socketio.on('connect')
def ws_connect():
    global ws_clients
    ws_clients += 1
    print(f'[WS] Client connected ({ws_clients} total)')
    emit('server_status', {
        'connected': True,
        'clients': ws_clients,
        'ml_loaded': ml_model is not None if 'ml_model' in dir() else False
    })

@socketio.on('disconnect')
def ws_disconnect():
    global ws_clients
    ws_clients = max(0, ws_clients - 1)
    print(f'[WS] Client disconnected ({ws_clients} remaining)')

@socketio.on('request_scores')
def ws_request_scores():
    """Client explicitly requests current scores."""
    emit('live_scores', {
        'games': list(live_score_cache.values()),
        'ts': time_mod.time()
    })

def background_score_poller():
    """Polls BDL API every 30s and pushes updates via WebSocket."""
    global live_score_cache
    while True:
        try:
            if not BDL_KEY:
                time_mod.sleep(60)
                continue

            today = datetime.now().strftime('%Y-%m-%d')
            url = f"{BDL_BASE}/v1/games?dates[]={today}&per_page=15"
            resp = requests.get(url, headers={"Authorization": BDL_KEY}, timeout=10)
            
            if resp.status_code == 200:
                data = resp.json()
                games = data.get('data', [])
                updated = False
                
                for g in games:
                    gid = str(g.get('id', ''))
                    new_entry = {
                        'id': gid,
                        'home_team': g.get('home_team', {}).get('abbreviation', '?'),
                        'away_team': g.get('visitor_team', {}).get('abbreviation', '?'),
                        'home_score': g.get('home_team_score', 0),
                        'away_score': g.get('visitor_team_score', 0),
                        'period': g.get('period', 0),
                        'status': g.get('status', ''),
                        'time': g.get('time', ''),
                        'is_live': g.get('status', '') not in ('Final', '', '1')
                    }
                    
                    old = live_score_cache.get(gid, {})
                    if (old.get('home_score') != new_entry['home_score'] or
                        old.get('away_score') != new_entry['away_score'] or
                        old.get('period') != new_entry['period']):
                        updated = True
                    
                    live_score_cache[gid] = new_entry
                
                if updated and ws_clients > 0:
                    socketio.emit('live_scores', {
                        'games': list(live_score_cache.values()),
                        'ts': time_mod.time(),
                        'live_count': sum(1 for g in live_score_cache.values() if g['is_live'])
                    })
                    
        except Exception as e:
            print(f'[WS Poller] Error: {e}')
        
        time_mod.sleep(30)  # Poll every 30 seconds

# Start background poller
poller_thread = threading.Thread(target=background_score_poller, daemon=True)
poller_thread.start()
print("[WS] Background score poller started (30s interval)")

if __name__ == "__main__":
    socketio.run(app, port=5000, debug=False, allow_unsafe_werkzeug=True)
