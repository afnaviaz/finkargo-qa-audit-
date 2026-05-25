/**
 * Puente Newman → Playwright — Stripe Card Checkout
 * Lee el environment exportado por Newman, extrae todos los stripe_checkout_url_*
 * y lanza stripe_card_checkout.js por cada uno.
 *
 * Uso:
 *   node run_stripe_card_checkout.js ./environment_export.json [idx]
 *   Si no se pasa idx, ejecuta todos los URLs guardados.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ENV_FILE     = process.env.NEWMAN_ENV_FILE || process.argv[2];
const SCENARIO_IDX = process.argv[3];           // opcional: ejecutar solo uno

if (!ENV_FILE || !fs.existsSync(ENV_FILE)) {
  console.error('❌ Debes pasar la ruta al environment exportado por Newman.');
  console.error('   Uso: node run_stripe_card_checkout.js ./environment_export.json [idx]');
  process.exit(1);
}

const envData = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
const values  = envData.values || envData.environment?.values || [];

function getVar(name) {
  const found = values.find(v => v.key === name);
  return found ? (found.value || '') : '';
}

// Recopilar todos los checkout URLs guardados por el test script
const checkoutUrls = [];

if (SCENARIO_IDX !== undefined) {
  // Modo single: ejecutar solo el índice pedido
  const url = getVar(`stripe_checkout_url_${SCENARIO_IDX}`) || getVar('stripe_checkout_url');
  if (url) checkoutUrls.push({ idx: SCENARIO_IDX, url });
} else {
  // Modo full: buscar stripe_checkout_url_0, _1, _2, ...
  for (let i = 0; i < 20; i++) {
    const url = getVar(`stripe_checkout_url_${i}`);
    if (url) checkoutUrls.push({ idx: String(i), url });
  }
  // Fallback: variable genérica
  if (checkoutUrls.length === 0) {
    const url = getVar('stripe_checkout_url');
    if (url) checkoutUrls.push({ idx: '0', url });
  }
}

if (checkoutUrls.length === 0) {
  console.error('❌ No se encontraron stripe_checkout_url en el environment exportado.');
  console.error('   Verifica que el test script de Postman guarde body.checkout_url en pm.environment.');
  process.exit(1);
}

console.log(`\n🔗 Newman → Playwright Card Checkout`);
console.log(`   ${checkoutUrls.length} checkout(s) a ejecutar\n`);

const scriptPath     = path.join(__dirname, 'stripe_card_checkout.js');
const dashboardScript = path.join(__dirname, 'stripe_card_dashboard_validate.js');
const SESSION_PATH   = path.join(__dirname, '.stripe-session.json');
const stripeAccountId = process.env.STRIPE_ACCOUNT_ID || '';

let globalFailed = 0;

for (const { idx, url } of checkoutUrls) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`▶ Escenario idx=${idx}`);
  console.log(`  URL: ${url.slice(0, 80)}...`);

  // Email del cliente guardado por el test script de Postman (stripe_email_<idx>)
  const customerEmail = getVar(`stripe_email_${idx}`) || '';

  // LINK_MODE según el índice: EP-04 (idx=11) → bypass, EP-05 (idx=12) → code
  const numIdx = parseInt(idx, 10);
  let linkMode = '';
  if (numIdx === 11) linkMode = 'bypass';
  if (numIdx === 12) linkMode = 'code';

  let checkoutOk = false;
  try {
    execSync(`node "${scriptPath}"`, {
      env: {
        ...process.env,
        CHECKOUT_URL:    url,
        CARD_NUMBER:     process.env.CARD_NUMBER     || '4242424242424242',
        CARD_EXPIRY:     process.env.CARD_EXPIRY     || '1226',
        CARD_CVC:        process.env.CARD_CVC        || '123',
        CARDHOLDER_NAME: process.env.CARDHOLDER_NAME || 'Usuario QA Automatizacion',
        EXPECTED_RESULT: process.env.EXPECTED_RESULT || 'success',
        LINK_MODE:       linkMode,
      },
      stdio: 'inherit',
    });
    console.log(`✅ idx=${idx} checkout completado`);
    checkoutOk = true;
  } catch (e) {
    console.error(`❌ idx=${idx} checkout falló (exit ${e.status})`);
    globalFailed++;
  }

  // ── Validación en Stripe Dashboard ────────────────────────────────────────
  if (checkoutOk && fs.existsSync(SESSION_PATH)) {
    console.log(`\n🔍 Validando pago idx=${idx} en Stripe Dashboard...`);
    try {
      execSync(`node "${dashboardScript}"`, {
        env: {
          ...process.env,
          CHECKOUT_IDX:      idx,
          CUSTOMER_EMAIL:    customerEmail,
          STRIPE_ACCOUNT_ID: stripeAccountId,
        },
        stdio: 'inherit',
      });
      console.log(`✅ idx=${idx} dashboard OK`);
    } catch (e) {
      console.error(`⚠️  idx=${idx} dashboard falló (exit ${e.status}) — no bloquea el pipeline`);
    }
  } else if (checkoutOk && !fs.existsSync(SESSION_PATH)) {
    console.log(`ℹ️  Sin sesión Stripe — saltando validación dashboard para idx=${idx}`);
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`📊 Checkouts: ${checkoutUrls.length - globalFailed} ✅  |  ${globalFailed} ❌`);

if (globalFailed > 0) process.exit(1);