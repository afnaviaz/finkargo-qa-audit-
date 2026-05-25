/**
 * Runner — Escenarios de Tarjetas Rechazadas (Stripe Test Mode)
 * Basado en: https://docs.stripe.com/testing#declined-payments
 *
 * Ejecuta stripe_declined_checkout.js por cada escenario definido en SCENARIOS
 * y opcionalmente valida el resultado en el Stripe Dashboard.
 *
 * Uso básico (misma URL para todos los escenarios):
 *   CHECKOUT_URL=https://checkout.stripe.com/c/pay/cs_test_...
 *   node run_stripe_declined_scenarios.js
 *
 * Uso con Newman env file (un URL diferente por escenario):
 *   NEWMAN_ENV_FILE=./environment_export.json
 *   node run_stripe_declined_scenarios.js
 *
 * Con validación en dashboard:
 *   CHECKOUT_URL=...
 *   CUSTOMER_EMAIL=cliente@ejemplo.com
 *   RUN_DASHBOARD_VALIDATION=true
 *   STRIPE_ACCOUNT_ID=acct_xxx
 *   node run_stripe_declined_scenarios.js
 *
 * Ejecutar solo algunos escenarios:
 *   SCENARIOS=generic_decline,insufficient_funds
 *   CHECKOUT_URL=... node run_stripe_declined_scenarios.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

// ── Escenarios según https://docs.stripe.com/testing#declined-payments ────────
// urlIdx = índice en el environment de Newman (stripe_checkout_url_<urlIdx>)
// Los índices 0-12 son para EP/VL/NEG del flujo existente.
// Los DEC occupan indices 13-20.
const ALL_SCENARIOS = [
  {
    code:        'generic_decline',
    description: 'DEC-01 | Rechazo genérico',
    card:        '4000000000000002',
    expiry:      '1226',
    cvc:         '123',
    urlIdx:      13,
  },
  {
    code:        'insufficient_funds',
    description: 'DEC-02 | Fondos insuficientes',
    card:        '4000000000009995',
    expiry:      '1226',
    cvc:         '123',
    urlIdx:      14,
  },
  {
    code:        'lost_card',
    description: 'DEC-03 | Tarjeta reportada como perdida',
    card:        '4000000000009987',
    expiry:      '1226',
    cvc:         '123',
    urlIdx:      15,
  },
  {
    code:        'stolen_card',
    description: 'DEC-04 | Tarjeta reportada como robada',
    card:        '4000000000009979',
    expiry:      '1226',
    cvc:         '123',
    urlIdx:      16,
  },
  {
    code:        'expired_card',
    description: 'DEC-05 | Tarjeta expirada',
    card:        '4000000000000069',
    expiry:      '1226',
    cvc:         '123',
    urlIdx:      17,
  },
  {
    code:        'incorrect_cvc',
    description: 'DEC-06 | Código de seguridad (CVC) incorrecto',
    card:        '4000000000000127',
    expiry:      '1226',
    cvc:         '123',
    urlIdx:      18,
  },
  {
    code:        'processing_error',
    description: 'DEC-07 | Error de procesamiento',
    card:        '4000000000000119',
    expiry:      '1226',
    cvc:         '123',
    urlIdx:      19,
  },
  {
    code:        'fraudulent',
    description: 'DEC-08 | Sospecha de fraude (fraudulent)',
    card:        '4000000000009235',
    expiry:      '1226',
    cvc:         '123',
    urlIdx:      20,
  },
];

// ── Configuración via env vars ────────────────────────────────────────────────
const ENV_FILE       = process.env.NEWMAN_ENV_FILE;
const BASE_URL       = process.env.CHECKOUT_URL;
const CUSTOMER_EMAIL = process.env.CUSTOMER_EMAIL || '';
const RUN_DASHBOARD  = process.env.RUN_DASHBOARD_VALIDATION === 'true';
const ACCOUNT_ID     = process.env.STRIPE_ACCOUNT_ID || '';
const isCI           = process.env.CI === 'true';
const outputDir      = process.env.SCRIPTS_DIR || '.';

// Filtro opcional: SCENARIOS=generic_decline,insufficient_funds
const SCENARIOS_FILTER = process.env.SCENARIOS
  ? process.env.SCENARIOS.split(',').map(s => s.trim())
  : null;
const SCENARIOS = SCENARIOS_FILTER
  ? ALL_SCENARIOS.filter(s => SCENARIOS_FILTER.includes(s.code))
  : ALL_SCENARIOS;

// ── Helpers ───────────────────────────────────────────────────────────────────
function getVar(values, name) {
  const found = (values || []).find(v => v.key === name);
  return found ? (found.value || '') : '';
}

function getCheckoutUrl(idx) {
  if (BASE_URL) return BASE_URL;
  if (ENV_FILE && fs.existsSync(ENV_FILE)) {
    const envData = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
    const values  = envData.values || envData.environment?.values || [];
    return getVar(values, `stripe_checkout_url_${idx}`)
        || getVar(values, 'stripe_checkout_url')
        || '';
  }
  return '';
}

// ── Validación de entrada ─────────────────────────────────────────────────────
if (!BASE_URL && !ENV_FILE) {
  console.error('❌ Debes pasar CHECKOUT_URL o NEWMAN_ENV_FILE.');
  console.error('   Ejemplos:');
  console.error('     CHECKOUT_URL=https://checkout.stripe.com/c/pay/cs_test_... node run_stripe_declined_scenarios.js');
  console.error('     NEWMAN_ENV_FILE=./env_export.json node run_stripe_declined_scenarios.js');
  process.exit(1);
}

const scriptCheckout  = path.join(__dirname, 'stripe_declined_checkout.js');
const scriptDashboard = path.join(__dirname, 'stripe_declined_dashboard_validate.js');
const SESSION_PATH    = path.join(__dirname, '.stripe-session.json');

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('\n🚫 Stripe Declined Payment Scenarios — Finkargo QA');
console.log(`   ${SCENARIOS.length} escenario(s) a ejecutar`);
if (SCENARIOS_FILTER) console.log(`   Filtro: ${SCENARIOS_FILTER.join(', ')}`);
console.log(`   Dashboard: ${RUN_DASHBOARD ? 'SÍ' : 'NO (usa RUN_DASHBOARD_VALIDATION=true para activar)'}`);
if (RUN_DASHBOARD && !CUSTOMER_EMAIL) console.log('   ⚠️  RUN_DASHBOARD_VALIDATION=true pero CUSTOMER_EMAIL no definido');
console.log(`   Ambiente : ${isCI ? 'CI/headless' : 'local/headed'}\n`);

const consolidatedResults = [];
let globalPassed = 0, globalFailed = 0;

for (let i = 0; i < SCENARIOS.length; i++) {
  const scenario    = SCENARIOS[i];
  // urlIdx apunta al índice DEC en el environment de Newman (13-20)
  const checkoutUrl = getCheckoutUrl(scenario.urlIdx);

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`▶ [${i + 1}/${SCENARIOS.length}] ${scenario.description}`);
  console.log(`  Código  : ${scenario.code}`);
  console.log(`  Tarjeta : ${scenario.card.slice(0, 4)} **** **** ${scenario.card.slice(-4)}`);

  if (!checkoutUrl) {
    console.error(`  ❌ Sin CHECKOUT_URL para este escenario. Saltando.`);
    globalFailed++;
    consolidatedResults.push({ ...scenario, checkout_status: 'SKIP', dashboard_status: 'SKIP' });
    continue;
  }
  console.log(`  URL     : ${checkoutUrl.slice(0, 70)}...`);

  // ── Ejecutar checkout con la tarjeta rechazada ────────────────────────────
  let checkoutStatus = 'PASS';
  try {
    execSync(`node "${scriptCheckout}"`, {
      env: {
        ...process.env,
        CHECKOUT_URL:        checkoutUrl,
        CARD_NUMBER:         scenario.card,
        CARD_EXPIRY:         scenario.expiry,
        CARD_CVC:            scenario.cvc,
        CARDHOLDER_NAME:     'Usuario QA Automatizacion',
        DECLINE_CODE:        scenario.code,
        DECLINE_DESCRIPTION: scenario.description,
        SCREENSHOT_PREFIX:   `stripe_declined_${scenario.code}`,
        SCRIPTS_DIR:         outputDir,
      },
      stdio: 'inherit',
    });
    console.log(`  ✅ Checkout [${scenario.code}] — PASS`);
    globalPassed++;
  } catch (e) {
    console.error(`  ❌ Checkout [${scenario.code}] — FAIL (exit ${e.status})`);
    checkoutStatus = 'FAIL';
    globalFailed++;
  }

  // ── Validación en Stripe Dashboard (opcional) ─────────────────────────────
  let dashboardStatus = 'SKIP';
  if (RUN_DASHBOARD && CUSTOMER_EMAIL && fs.existsSync(SESSION_PATH)) {
    console.log(`\n  🔍 Validando en Stripe Dashboard...`);
    try {
      execSync(`node "${scriptDashboard}"`, {
        env: {
          ...process.env,
          CUSTOMER_EMAIL:    CUSTOMER_EMAIL,
          DECLINE_CODE:      scenario.code,
          CHECKOUT_IDX:      String(i),
          STRIPE_ACCOUNT_ID: ACCOUNT_ID,
          SCRIPTS_DIR:       outputDir,
        },
        stdio: 'inherit',
      });
      console.log(`  ✅ Dashboard [${scenario.code}] — PASS`);
      dashboardStatus = 'PASS';
    } catch (e) {
      console.error(`  ⚠️  Dashboard [${scenario.code}] — FAIL (exit ${e.status})`);
      dashboardStatus = 'FAIL';
    }
  } else if (RUN_DASHBOARD && !fs.existsSync(SESSION_PATH)) {
    console.log(`  ℹ️  Sin sesión Stripe (.stripe-session.json) — saltando dashboard`);
  }

  consolidatedResults.push({
    code:             scenario.code,
    description:      scenario.description,
    card_last4:       scenario.card.slice(-4),
    checkout_status:  checkoutStatus,
    dashboard_status: dashboardStatus,
  });
}

// ── Reporte consolidado ───────────────────────────────────────────────────────
const report = {
  total_scenarios: SCENARIOS.length,
  global_passed:   globalPassed,
  global_failed:   globalFailed,
  dashboard_run:   RUN_DASHBOARD,
  timestamp:       new Date().toISOString(),
  scenarios:       consolidatedResults,
};
const reportPath = path.join(outputDir, 'stripe_declined_consolidated_report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`\n${'═'.repeat(55)}`);
console.log(`📊 TOTAL: ${globalPassed} ✅ pasaron  |  ${globalFailed} ❌ fallaron`);
console.log(`📄 Reporte consolidado: ${reportPath}`);
console.log('═'.repeat(55));

if (globalFailed > 0) process.exit(1);