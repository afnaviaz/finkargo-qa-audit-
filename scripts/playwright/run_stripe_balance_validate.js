/**
 * Puente Newman → Playwright — Stripe Balance Recurring
 * Lee el environment exportado por Newman, extrae todos los stripe_invoice_id_*
 * y lanza stripe_balance_dashboard_validate.js por cada uno para aplicar
 * el pago externo (Transferencia) y verificar que queda Exitoso/Pagada.
 *
 * Uso:
 *   node run_stripe_balance_validate.js ./environment_export.json [idx]
 *   Si no se pasa idx, ejecuta todos los invoices guardados.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ENV_FILE     = process.env.NEWMAN_ENV_FILE || process.argv[2];
const SCENARIO_IDX = process.argv[3];

if (!ENV_FILE || !fs.existsSync(ENV_FILE)) {
  console.error('❌ Debes pasar la ruta al environment exportado por Newman.');
  console.error('   Uso: node run_stripe_balance_validate.js ./environment_export.json [idx]');
  process.exit(1);
}

const envData = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
const values  = envData.values || envData.environment?.values || [];

function getVar(name) {
  const found = values.find(v => v.key === name);
  return found ? (found.value || '') : '';
}

// Recopilar todos los invoice IDs guardados por el test script de Postman
const invoiceEntries = [];

if (SCENARIO_IDX !== undefined) {
  const invoiceId = getVar(`stripe_invoice_id_${SCENARIO_IDX}`);
  const email     = getVar(`stripe_email_${SCENARIO_IDX}`);
  if (invoiceId) invoiceEntries.push({ idx: SCENARIO_IDX, invoiceId, email });
} else {
  for (let i = 0; i < 20; i++) {
    const invoiceId = getVar(`stripe_invoice_id_${i}`);
    const email     = getVar(`stripe_email_${i}`);
    if (invoiceId) invoiceEntries.push({ idx: String(i), invoiceId, email });
  }
}

if (invoiceEntries.length === 0) {
  console.error('❌ No se encontraron stripe_invoice_id_* en el environment exportado.');
  console.error('   Verifica que el test script de Postman guarde body.invoice_id en pm.environment.');
  process.exit(1);
}

console.log(`\n🏦 Newman → Playwright Balance Recurring`);
console.log(`   ${invoiceEntries.length} factura(s) a procesar\n`);

const dashboardScript = path.join(__dirname, 'stripe_balance_dashboard_validate.js');
const SESSION_PATH    = path.join(__dirname, '.stripe-session.json');
const stripeAccountId = process.env.STRIPE_ACCOUNT_ID || '';
const scriptsDir      = process.env.SCRIPTS_DIR || path.dirname(__dirname);

if (!fs.existsSync(SESSION_PATH)) {
  console.log('ℹ️  Sin sesión Stripe (.stripe-session.json) — saltando validación dashboard.');
  process.exit(0);
}

let globalFailed = 0;

for (const { idx, invoiceId, email } of invoiceEntries) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`▶ Escenario idx=${idx}`);
  console.log(`  Invoice ID : ${invoiceId}`);
  console.log(`  Email      : ${email || '(no guardado)'}`);

  try {
    execSync(`node "${dashboardScript}"`, {
      env: {
        ...process.env,
        CHECKOUT_IDX:      idx,
        CUSTOMER_EMAIL:    email,
        INVOICE_ID:        invoiceId,
        STRIPE_ACCOUNT_ID: stripeAccountId,
        SCRIPTS_DIR:       scriptsDir,
        CI:                'true',
      },
      stdio: 'inherit',
    });
    console.log(`✅ idx=${idx} balance dashboard OK`);
  } catch (e) {
    console.error(`❌ idx=${idx} balance dashboard falló (exit ${e.status})`);
    globalFailed++;
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`📊 Balance Dashboard: ${invoiceEntries.length - globalFailed} ✅  |  ${globalFailed} ❌`);

if (globalFailed > 0) process.exit(1);