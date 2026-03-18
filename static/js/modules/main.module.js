
// ═══════════════════════════════════════
// MAIN ES MODULE ENTRY POINT
// ═══════════════════════════════════════
// Usage: <script type="module" src="/static/js/modules/main.module.js"></script>

import { API, apiFetch, sanitize, SECTIONS, MW, saveWeights, resetWeights, setStatus, setBadge } from './config.module.js';
import { computeModelProb, ewma, clamp, logistic, americanToImpl } from './model.module.js';

// Re-export to window for HTML onclick handlers (bridge)
window.API = API;
window.apiFetch = apiFetch;
window.sanitize = sanitize;
window.SECTIONS = SECTIONS;
window.MW = MW;
window.saveWeights = saveWeights;
window.resetWeights = resetWeights;
window.setStatus = setStatus;
window.setBadge = setBadge;
window.computeModelProb = computeModelProb;
window.ewma = ewma;
window.clamp = clamp;
window.logistic = logistic;
window.americanToImpl = americanToImpl;

console.log('\u2705 ES Modules loaded via main.module.js');
console.log('   To use: <script type="module" src="/static/js/modules/main.module.js">');
console.log('   Current app uses global scope scripts (backwards compatible)');
