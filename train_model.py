#!/usr/bin/env python3
"""
train_model.py — Training ML QuantNBA Pro dengan data NBA nyata
Cara pakai:
  python train_model.py           # data nyata
  python train_model.py --demo    # data sintetis (fallback)
  python train_model.py --multi   # gabung 3 musim
"""

import os, sys, json, time, logging, argparse
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.linear_model import LogisticRegression
from sklearn.calibration import CalibratedClassifierCV
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import cross_val_score
from sklearn.metrics import brier_score_loss
import joblib

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)
os.makedirs("ml", exist_ok=True)

NBA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
}

FEATURES = [
    "net_rating_diff", "recency_diff", "injury_adj",
    "home_flag", "rest_diff", "ref_pace_fast", "market_momentum",
]


def fetch_real_training_data(season="2025-26", n_games=400):
    from nba_api.stats.endpoints import leaguegamefinder, leaguedashteamstats
    logger.info(f"Mengambil team stats musim {season}...")
    ts = leaguedashteamstats.LeagueDashTeamStats(
        season=season,
        measure_type_detailed_defense="Advanced",
        per_mode_detailed="PerGame",
        headers=NBA_HEADERS,
    )
    team_df = ts.get_data_frames()[0]
    team_map = {
        row["TEAM_ABBREVIATION"]: {
            "net": float(row.get("NET_RATING", 0)),
            "ortg": float(row.get("OFF_RATING", 110)),
            "drtg": float(row.get("DEF_RATING", 110)),
            "pace": float(row.get("PACE", 100)),
        }
        for _, row in team_df.iterrows()
    }
    logger.info(f"  {len(team_map)} tim ditemukan.")
    time.sleep(1)

    logger.info(f"Mengambil {n_games} game historis musim {season}...")
    gf = leaguegamefinder.LeagueGameFinder(
        season_nullable=season,
        league_id_nullable="00",
        season_type_nullable="Regular Season",
        headers=NBA_HEADERS,
    )
    game_df = gf.get_data_frames()[0]
    home_games = game_df[game_df["MATCHUP"].str.contains(r"vs\.", na=False)].copy()
    home_games = home_games.dropna(subset=["WL"]).head(n_games)
    logger.info(f"  {len(home_games)} home games tersedia.")

    rows = []
    for _, row in home_games.iterrows():
        home_abbr = row["TEAM_ABBREVIATION"]
        matchup = str(row.get("MATCHUP", ""))
        parts = matchup.split("vs.")
        away_abbr = parts[1].strip() if len(parts) > 1 else ""
        ht = team_map.get(home_abbr, {})
        at = team_map.get(away_abbr, {})
        net_diff = ht.get("net", 0) - at.get("net", 0)
        pace_avg = (ht.get("pace", 100) + at.get("pace", 100)) / 2
        home_won = 1 if row.get("WL", "") == "W" else 0
        pm = float(row.get("PLUS_MINUS", 0))
        rows.append({
            "net_rating_diff": round(net_diff, 3),
            "recency_diff": round(pm * 0.3, 3),
            "injury_adj": 0.0,
            "home_flag": 1,
            "rest_diff": 0,
            "ref_pace_fast": 1 if pace_avg > 100.5 else 0,
            "market_momentum": 0.0,
            "home_win": home_won,
        })
    df = pd.DataFrame(rows)
    logger.info(f"Dataset siap: {len(df)} baris, win rate {df['home_win'].mean():.1%}")
    return df


def fetch_multi_season_data(seasons, n_per_season=300):
    all_dfs = []
    for season in seasons:
        logger.info(f"--- Musim {season} ---")
        try:
            df = fetch_real_training_data(season, n_per_season)
            df["season"] = season
            all_dfs.append(df)
            time.sleep(2)
        except Exception as e:
            logger.warning(f"Gagal ambil data {season}: {e}")
    if not all_dfs:
        raise RuntimeError("Tidak ada data berhasil diambil")
    combined = pd.concat(all_dfs, ignore_index=True)
    logger.info(f"Total dataset: {len(combined)} baris dari {len(all_dfs)} musim")
    return combined


def generate_demo_data(n=2000):
    logger.warning("Menggunakan data DEMO (sintetis).")
    np.random.seed(42)
    net = np.random.normal(0, 6, n)
    rec = np.random.normal(0, 5, n)
    inj = np.random.normal(0, 0.03, n)
    home = np.ones(n)
    rest = np.random.choice([-2, -1, 0, 1, 2], n)
    pace = np.random.binomial(1, 0.3, n)
    momentum = np.random.normal(0, 0.03, n)
    logit = (0.18*net + 0.12*rec + 8.0*inj + 0.25*home +
             0.08*rest - 0.05*pace + 2.0*momentum +
             np.random.normal(0, 0.7, n))
    prob = 1 / (1 + np.exp(-logit))
    y = (np.random.random(n) < prob).astype(int)
    return pd.DataFrame({
        "net_rating_diff": net, "recency_diff": rec, "injury_adj": inj,
        "home_flag": home, "rest_diff": rest, "ref_pace_fast": pace,
        "market_momentum": momentum, "home_win": y,
    })


def train(df, save_path="ml/nba_model.joblib", season="2025-26"):
    X = df[FEATURES].values
    y = df["home_win"].values
    logger.info(f"Training model: {len(X)} samples, {X.shape[1]} features")
    model = CalibratedClassifierCV(
        Pipeline([
            ("scaler", StandardScaler()),
            ("lr", LogisticRegression(C=1.0, max_iter=1000, random_state=42)),
        ]),
        cv=5, method="sigmoid",
    )
    model.fit(X, y)
    cv_scores = cross_val_score(model, X, y, cv=5, scoring="accuracy")
    proba = model.predict_proba(X)[:, 1]
    brier = brier_score_loss(y, proba)
    baseline_brier = brier_score_loss(y, np.full_like(y, y.mean(), dtype=float))
    logger.info(f"CV Accuracy: {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")
    logger.info(f"Brier Score: {brier:.4f} (baseline {baseline_brier:.4f})")
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    versioned = save_path.replace(".joblib", f"_v{ts}.joblib")
    joblib.dump(model, save_path)
    joblib.dump(model, versioned)
    meta = {
        "features": FEATURES,
        "cv_accuracy": round(float(cv_scores.mean()), 4),
        "cv_std": round(float(cv_scores.std()), 4),
        "brier_score": round(float(brier), 6),
        "baseline_brier": round(float(baseline_brier), 6),
        "brier_improvement_pct": round((baseline_brier - brier) / baseline_brier * 100, 1),
        "n_training": len(X),
        "win_rate": round(float(y.mean()), 4),
        "model_type": "CalibratedLogisticRegression",
        "trained_at": ts,
        "versioned_path": versioned,
        "data_source": "real" if "season" in df.columns else "demo",
        "season": season,
    }
    with open("ml/model_meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    logger.info(f"Model disimpan: {save_path}")
    return meta


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--season", default="2025-26")
    parser.add_argument("--multi", action="store_true")
    parser.add_argument("--n", type=int, default=400)
    args = parser.parse_args()

    if args.demo:
        df = generate_demo_data(2000)
        source = "demo"
    elif args.multi:
        df = fetch_multi_season_data(["2022-23", "2023-24", "2025-26"], args.n)
        source = "multi-season real"
    else:
        try:
            df = fetch_real_training_data(args.season, args.n)
            source = "real"
        except Exception as e:
            logger.error(f"Gagal ambil data nyata: {e}")
            logger.warning("Fallback ke data demo...")
            df = generate_demo_data(2000)
            source = "demo (fallback)"

    meta = train(df)
    print("\n" + "="*50)
    print("TRAINING SELESAI")
    print("="*50)
    print(f"  Sumber data   : {source}")
    print(f"  Jumlah sampel : {meta['n_training']}")
    print(f"  CV Accuracy   : {meta['cv_accuracy']:.1%}")
    print(f"  Brier Score   : {meta['brier_score']:.4f}")
    print(f"  Model tersimpan: ml/nba_model.joblib")
    print("="*50)


if __name__ == "__main__":
    main()
