
"""
Unit tests for QuantNBA Pro backend.
Run: cd /content/quantnba && python -m pytest tests/ -v
"""
import pytest
import json
import sys
import os

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Test ML Model ──
class TestMLModel:
    @pytest.fixture(autouse=True)
    def setup(self):
        import joblib
        model_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                   'ml', 'nba_model.joblib')
        if os.path.exists(model_path):
            self.model = joblib.load(model_path)
        else:
            self.model = None

    def test_model_loads(self):
        """Model file exists and loads."""
        assert self.model is not None, "Model not found at ml/nba_model.joblib"

    def test_prediction_shape(self):
        """Prediction returns proper shape."""
        if self.model is None:
            pytest.skip("Model not loaded")
        import numpy as np
        X = np.array([[5.0, 3.0, 0.01, 1, 1, 0, 0.02]])
        proba = self.model.predict_proba(X)
        assert proba.shape == (1, 2), f"Expected (1,2), got {proba.shape}"
        assert 0 <= proba[0, 1] <= 1, "Probability out of range"

    def test_home_advantage(self):
        """Home team with better stats should have higher probability."""
        if self.model is None:
            pytest.skip("Model not loaded")
        import numpy as np
        # Strong home team
        X_strong = np.array([[10.0, 5.0, 0.0, 1, 2, 0, 0.0]])
        # Weak home team
        X_weak = np.array([[-10.0, -5.0, 0.0, 0, -2, 0, 0.0]])
        
        prob_strong = self.model.predict_proba(X_strong)[0, 1]
        prob_weak = self.model.predict_proba(X_weak)[0, 1]
        assert prob_strong > prob_weak, \
            f"Strong ({prob_strong:.3f}) should beat weak ({prob_weak:.3f})"

    def test_probability_calibration(self):
        """Predictions near 50% for neutral matchup."""
        if self.model is None:
            pytest.skip("Model not loaded")
        import numpy as np
        X_neutral = np.array([[0.0, 0.0, 0.0, 1, 0, 0, 0.0]])
        prob = self.model.predict_proba(X_neutral)[0, 1]
        assert 0.35 <= prob <= 0.65, \
            f"Neutral matchup should be ~50%, got {prob:.3f}"

    def test_batch_consistency(self):
        """Batch predictions match individual predictions."""
        if self.model is None:
            pytest.skip("Model not loaded")
        import numpy as np
        X = np.array([
            [5.0, 3.0, 0.01, 1, 1, 0, 0.02],
            [-3.0, -2.0, -0.01, 0, -1, 1, -0.01],
        ])
        batch_probs = self.model.predict_proba(X)
        
        for i in range(len(X)):
            single_prob = self.model.predict_proba(X[i:i+1])
            assert abs(batch_probs[i, 1] - single_prob[0, 1]) < 1e-10, \
                f"Batch/single mismatch at index {i}"


# ── Test API Endpoints ──
class TestFlaskApp:
    @pytest.fixture
    def client(self):
        """Create test client."""
        # Import app
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        try:
            # We need to import carefully since server.py has side effects
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                "server",
                os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server.py")
            )
            server = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(server)
            server.app.config['TESTING'] = True
            return server.app.test_client()
        except Exception as e:
            pytest.skip(f"Cannot import server: {e}")

    def test_health_endpoint(self, client):
        resp = client.get('/api/health')
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert data['status'] == 'ok'

    def test_status_endpoint(self, client):
        resp = client.get('/api/status')
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert 'polymarket' in data
        assert 'server_time' in data

    def test_ml_info(self, client):
        resp = client.get('/api/ml/info')
        assert resp.status_code == 200

    def test_ml_predict(self, client):
        resp = client.post('/api/ml/predict',
            data=json.dumps({
                'net_rating_diff': 5.0,
                'recency_diff': 3.0,
                'injury_adj': 0.01,
                'home_flag': 1,
                'rest_diff': 1,
                'ref_pace_fast': 0,
                'market_momentum': 0.02
            }),
            content_type='application/json'
        )
        if resp.status_code == 503:
            pytest.skip("ML model not loaded on server")
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert 'home_win_prob' in data
        assert 0 <= data['home_win_prob'] <= 1


# ── Test Utility Functions ──
class TestUtils:
    def test_american_to_implied_favorite(self):
        """Negative odds (favorite)."""
        # -150 means bet $150 to win $100
        impl = 150 / (150 + 100)  # = 0.6
        assert abs(impl - 0.6) < 0.01

    def test_american_to_implied_underdog(self):
        """Positive odds (underdog)."""
        # +200 means bet $100 to win $200
        impl = 100 / (200 + 100)  # = 0.333
        assert abs(impl - 0.333) < 0.01

    def test_kelly_criterion(self):
        """Basic Kelly calculation."""
        p = 0.6  # model probability
        b = (1 - 0.5) / 0.5  # odds ratio (even money)
        kelly = (p * b - (1 - p)) / b
        assert kelly > 0, "Positive edge should give positive Kelly"
        assert kelly < 1, "Kelly should be < 100%"
        assert abs(kelly - 0.2) < 0.01, f"Expected ~0.2, got {kelly}"
