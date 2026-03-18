
// ═══════════════════════════════════════
// JS UNIT TESTS — Model Engine
// Run in browser console or via Node.js
// ═══════════════════════════════════════

const TestRunner = {
  passed: 0,
  failed: 0,
  errors: [],

  assert(condition, message) {
    if (condition) {
      this.passed++;
    } else {
      this.failed++;
      this.errors.push(message);
      console.error('\u274C FAIL: ' + message);
    }
  },

  assertClose(a, b, tolerance, message) {
    this.assert(Math.abs(a - b) < tolerance,
      message + ' (got ' + a.toFixed(4) + ', expected ~' + b.toFixed(4) + ')');
  },

  run() {
    console.log('\n\u{1F9EA} Running JS Unit Tests...\n');
    this.passed = 0;
    this.failed = 0;
    this.errors = [];

    this.testLogistic();
    this.testEWMA();
    this.testClamp();
    this.testSanitize();
    this.testModelProb();
    this.testModelEdgeCases();
    this.testKellyMath();
    this.testAmericanToImpl();
    this.testPredictionLog();

    console.log('\n' + '='.repeat(50));
    console.log('\u{1F9EA} Results: ' + this.passed + ' passed, ' + this.failed + ' failed');
    if (this.errors.length) {
      console.log('\nFailed tests:');
      this.errors.forEach(e => console.log('  \u274C ' + e));
    } else {
      console.log('\u2705 All tests passed!');
    }
    console.log('='.repeat(50));
    return this.failed === 0;
  },

  // ── Individual tests ──

  testLogistic() {
    this.assertClose(logistic(0), 0.5, 0.001, 'logistic(0) = 0.5');
    this.assert(logistic(5) > 0.99, 'logistic(5) > 0.99');
    this.assert(logistic(-5) < 0.01, 'logistic(-5) < 0.01');
    this.assertClose(logistic(1) + logistic(-1), 1.0, 0.001, 'logistic symmetry');
  },

  testEWMA() {
    const arr = [10, 10, 10, 10, 10];
    this.assertClose(ewma(arr), 10, 0.001, 'ewma constant array = constant');
    const arr2 = [0, 0, 0, 0, 10];
    this.assert(ewma(arr2) > ewma([10, 0, 0, 0, 0]), 'ewma weights recent more');
  },

  testClamp() {
    this.assert(clamp(0.5, 0, 1) === 0.5, 'clamp in range');
    this.assert(clamp(-1, 0, 1) === 0, 'clamp below');
    this.assert(clamp(2, 0, 1) === 1, 'clamp above');
  },

  testSanitize() {
    this.assert(sanitize('<script>alert(1)</script>').indexOf('<script>') === -1, 'sanitize strips script');
    this.assert(sanitize('Hello') === 'Hello', 'sanitize preserves plain text');
    this.assert(sanitize('') === '', 'sanitize empty string');
    this.assert(sanitize(null) === '', 'sanitize null');
  },

  testModelProb() {
    // Strong home team should get high probability
    const strongHome = {
      netRating: {home: 12, away: -2},
      recency: {home: [10, 12, 8, 11, 9], away: [-3, -1, 2, -2, 1]},
      injuries: [{name: 'Star', team: 'AWAY', status: 'OUT', epm: 7.0}],
      homeFlag: 1, rest: {home: 2, away: 0},
      pmPriceMove: 0.03, hoursToClose: 4,
      refPaceFast: 0, refFoulHigh: 0, away: 'AWAY'
    };
    const result = computeModelProb(strongHome);
    this.assert(result.finalProb > 0.65, 'Strong home > 65% (got ' + (result.finalProb * 100).toFixed(1) + '%)');
    this.assert(result.confidence > 50, 'Strong matchup has good confidence');
    this.assert(Object.keys(result.F).length === 7, 'Model has 7 factors');

    // Even matchup should be ~50%
    const even = {
      netRating: {home: 0, away: 0},
      recency: {home: [0,0,0,0,0], away: [0,0,0,0,0]},
      injuries: [], homeFlag: 1, rest: {home: 1, away: 1},
      pmPriceMove: 0, hoursToClose: 4,
      refPaceFast: 0, refFoulHigh: 0, away: 'AWAY'
    };
    const evenResult = computeModelProb(even);
    this.assert(evenResult.finalProb > 0.45 && evenResult.finalProb < 0.60,
      'Even matchup ~50% (got ' + (evenResult.finalProb * 100).toFixed(1) + '%)');
  },

  testModelEdgeCases() {
    // Empty injuries
    const noInj = {
      netRating: {home: 5, away: 5}, recency: {home: [5,5,5,5,5], away: [5,5,5,5,5]},
      injuries: [], homeFlag: 0, rest: {home: 1, away: 1},
      pmPriceMove: 0, hoursToClose: 4, refPaceFast: 0, refFoulHigh: 0, away: 'X'
    };
    const r = computeModelProb(noInj);
    this.assert(r.finalProb >= 0.08 && r.finalProb <= 0.92, 'Clamped within bounds');

    // Extreme case
    const extreme = {
      netRating: {home: 20, away: -10}, recency: {home: [20,20,20,20,20], away: [-10,-10,-10,-10,-10]},
      injuries: [
        {name: 'A', team: 'X', status: 'OUT', epm: 10},
        {name: 'B', team: 'X', status: 'OUT', epm: 8}
      ],
      homeFlag: 1, rest: {home: 3, away: 0},
      pmPriceMove: 0.1, hoursToClose: 6, refPaceFast: 0, refFoulHigh: 0, away: 'X'
    };
    const re = computeModelProb(extreme);
    this.assert(re.finalProb <= 0.92, 'Extreme case clamped at 92%');
  },

  testKellyMath() {
    // Edge case: model = market price → kelly = 0
    const p = 0.6, y = 0.6;
    const b = (1 - y) / y;
    const k = (p * b - (1 - p)) / b;
    this.assertClose(k, 0, 0.01, 'No edge = no Kelly');

    // Positive edge
    const p2 = 0.7, y2 = 0.5;
    const b2 = (1 - y2) / y2;
    const k2 = (p2 * b2 - (1 - p2)) / b2;
    this.assert(k2 > 0, 'Positive edge = positive Kelly');
    this.assert(k2 < 1, 'Kelly < 100%');
  },

  testAmericanToImpl() {
    this.assertClose(americanToImpl(-150), 0.6, 0.01, 'americanToImpl(-150) ~60%');
    this.assertClose(americanToImpl(+200), 0.333, 0.01, 'americanToImpl(+200) ~33%');
    this.assertClose(americanToImpl(-100), 0.5, 0.01, 'americanToImpl(-100) = 50%');
    this.assert(americanToImpl('abc') === null, 'americanToImpl(invalid) = null');
  },

  testPredictionLog() {
    // Test storage cap
    const key = 'test_predlog_cap';
    const oldKey = PredictionLog.key;
    PredictionLog.key = key;

    // Clear
    PredictionLog.save([]);
    this.assert(PredictionLog.get().length === 0, 'PredictionLog starts empty');

    // Add items
    for (let i = 0; i < 10; i++) {
      const arr = PredictionLog.get();
      arr.push({ id: 'test_' + i, game: 'Test', ts: Date.now(), modelProb: 0.6, pmPrice: 0.5, outcome: null });
      PredictionLog.save(arr);
    }
    this.assert(PredictionLog.get().length === 10, 'PredictionLog stores 10 items');

    // Cleanup
    PredictionLog.save([]);
    localStorage.removeItem(key);
    PredictionLog.key = oldKey;
  }
};

// Auto-run on load
if (typeof document !== 'undefined') {
  // Browser
  window.TestRunner = TestRunner;
  console.log('\u{1F9EA} JS Tests loaded. Run: TestRunner.run()');
} else {
  // Node.js
  TestRunner.run();
}
