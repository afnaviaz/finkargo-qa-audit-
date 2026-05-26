/**
 * Puente Newman → Playwright — Stripe Balance One Time
 * Lee el environment exportado por Newman, extrae stripe_customer_id_* y stripe_amount_*
 * y lanza stripe_balance_dashboard_validate.js por cada escenario para añadir
 * fondos al saldo del customer vía el dashboard de Stripe (/test/customers).
 *
 * Uso:
 *   node run_stripe_onetime_validate.js ./environment_export.json [idx]
 *   Si no se pasa idx, ejecuta todos los escenarios guardados.
 *
 * Requiere en el environment exportado por Newman:
 *   stripe_customer_id_N — customer ID de Stripe (guardado por el test script de Postman)
 *   stripe_email_N       — email del customer (guardado por el test script de Postman)
 *   stripe_amount_N      — monto en centavos (guardado por el test script de Postman)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ENV_FILE     = process.env.NEWMAN_ENV_FILE || process.argv[2];
const SCENARIO_IDX = process.argv[3];

if (!ENV_FILE || !fs.existsSync(ENV_FILE)) {
  console.error('❌ Debes pasar la ruta al environment exportado por Newman.');
  console.error('   Uso: node run_stripe_onetime_validate.js ./environment_export.json [idx]');
  process.exit(1);
}

const envData = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
const values  = envData.values || envData.environment?.values || [];

function getVar(name) {
  const found = values.find(v => v.key === name);
  return found ? (found.value || '') : '';
}

// Recopilar escenarios exitosos: anchor = stripe_customer_id_* (guardado en positivos)
const customerEntries = [];

if (SCENARIO_IDX !== undefined) {
  const customerId = getVar(`stripe_customer_id_${SCENARIO_IDX}`);
  const email      = getVar(`stripe_email_${SCENARIO_IDX}`);
  const amount     = getVar(`stripe_amount_${SCENARIO_IDX}`);
  if (customerId) customerEntries.push({ idx: SCENARIO_IDX, email, amount });
} else {
  for (let i = 0; i < 20; i++) {
    const customerId = getVar(`stripe_customer_id_${i}`);
    const email      = getVar(`stripe_email_${i}`);
    const amount     = getVar(`stripe_amount_${i}`);
    if (customerId) customerEntries.push({ idx: String(i), email, amount });
  }
}

if (customerEntries.length === 0) {
  console.error('❌ No se encontraron stripe_customer_id_* en el environment exportado.');
  console.error('   Verifica que el test script de Postman guarde customer_id, email y amount en pm.environment.');
  process.exit(1);
}

console.log(`\n🏦 Newman → Playwright Balance One Time`);
console.log(`   ${customerEntries.length} escenario(s) a procesar\n`);

const dashboardScript = path.join(__dirname, 'stripe_balance_dashboard_validate.js');
const SESSION_PATH    = path.join(__dirname, '.stripe-session.json');
const stripeAccountId = process.env.STRIPE_ACCOUNT_ID || '';
const scriptsDir      = process.env.SCRIPTS_DIR || path.dirname(__dirname);

if (!fs.existsSync(SESSION_PATH)) {
  console.log('ℹ️  Sin sesión Stripe (.stripe-session.json) — saltando validación dashboard.');
  process.exit(0);
}

let globalFailed = 0;

const MAX_RETRIES  = 2;
const RETRY_DELAY  = 5000; // ms entre reintentos

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

for (const { idx, email, amount } of customerEntries) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`▶ Escenario idx=${idx}`);
  console.log(`  Email      : ${email  || '(no guardado)'}`);
  console.log(`  Amount     : ${amount ? `${amount} centavos` : '(no guardado)'}`);

  const env = {
    ...process.env,
    CHECKOUT_IDX:      idx,
    CUSTOMER_EMAIL:    email,
    PAYMENT_AMOUNT:    amount,
    STRIPE_ACCOUNT_ID: stripeAccountId,
    SCRIPTS_DIR:       scriptsDir,
    CI:                'true',
  };

  let success = false;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    if (attempt > 1) {
      console.log(`  🔄 Reintento ${attempt - 1}/${MAX_RETRIES} para idx=${idx} (esperando ${RETRY_DELAY / 1000}s)...`);
      sleep(RETRY_DELAY);
    }
    try {
      execSync(`node "${dashboardScript}"`, { env, stdio: 'inherit' });
      console.log(`✅ idx=${idx} balance dashboard OK`);
      success = true;
      break;
    } catch (e) {
      const reason = e.message?.includes('canceled') ? 'operación cancelada (red/CI)'
                   : e.message?.includes('TIMEOUT')  ? 'timeout'
                   : `exit ${e.status}`;
      if (attempt <= MAX_RETRIES) {
        console.warn(`  ⚠️  idx=${idx} falló (${reason}) — se reintentará`);
      } else {
        console.error(`❌ idx=${idx} balance dashboard falló tras ${MAX_RETRIES + 1} intentos (${reason})`);
      }
    }
  }
  if (!success) globalFailed++;
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`📊 Balance Dashboard One Time: ${customerEntries.length - globalFailed} ✅  |  ${globalFailed} ❌`);

if (globalFailed > 0) process.exit(1);