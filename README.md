# QuantNBA Pro v2.1

Quantitative NBA analytics dashboard for Polymarket prediction markets.

## Features
- 7-Factor probability model (JS) + Calibrated ML model (Python)
- Real-time Polymarket CLOB integration
- Live NBA scores via WebSocket
- Kelly Criterion position sizer
- Historical backtesting engine
- Injury impact analysis
- Referee tendency tracking
- Multi-book odds comparator

## Quick Start (Google Colab)
1. Open the Colab notebook
2. Set API keys in Cell 3
3. Run all cells
4. Access via ngrok URL

## Deploy to Render (Free)
1. Push to GitHub
2. Connect repo to [render.com](https://render.com)
3. Set environment variables: BDL_KEY, ODDS_KEY
4. Deploy!

## API Keys (all free)
- **BallDontLie**: [app.balldontlie.io](https://app.balldontlie.io) (30 req/min)
- **The Odds API**: [the-odds-api.com](https://the-odds-api.com) (500 req/month)
- **Polymarket**: No key needed
- **NBA Injuries**: No key needed

## Architecture

| Component | Description |
|-----------|-------------|
| server.py | Flask backend + API proxy + ML model |
| static/css/style.css | Responsive dark theme |
| static/js/config.js | API routes, utilities |
| static/js/data.js | Static fallback data |
| static/js/model.js | 7-factor probability engine |
| static/js/systems.js | Alerts, positions, predictions |
| static/js/ui.js | All renderers |
| static/js/kelly.js | Kelly calculator |
| static/js/api.js | Backend communication |
| static/js/backtest.js | Historical backtesting |
| static/js/ws.js | WebSocket + ML client |
| static/js/app.js | Init and orchestration |
| ml/nba_model.joblib | Trained scikit-learn model |

## Running Tests

Python: cd /content/quantnba && python -m pytest tests/ -v

JavaScript: Open browser console and run TestRunner.run()

## License
MIT
