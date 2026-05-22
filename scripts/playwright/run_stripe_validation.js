/**
 * Puente Newman → Playwright
 * Lee el environment exportado por Newman y lanza stripe_oxxo_validation.js
 * con el payment_intent_id y amount que generó Postman en tiempo real.
 *
 * Uso:
 *   node run_stripe_validation.js ./exported-env.json
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ENV_FILE = process.env.NEWMAN_ENV_FILE || process.argv[2];

if (!ENV_FILE || !fs.existsSync(ENV_FILE)) {
  console.error('❌ ERROR: Debes pasar la ruta al environment exportado por Newman.');
  console.error('   Ejemplo: node run_stripe_validation.js ./exported-env.json');
  process.exit(1);
}

// Leer el archivo de environment exportado por Newman
const envData  = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
const values   = envData.values || envData.environment?.values || [];

function getVar(name) {
  const found = values.find(v => v.key === name);
  return found ? found.value : '';
}

const paymentIntentId = getVar('stripe_payment_intent_id');
const expectedAmount  = getVar('stripe_expected_amount');
const accountId       = process.env.STRIPE_ACCOUNT_ID || 'acct_1TWfcTKyHOFqxcvG';

if (!paymentIntentId) {
  console.error('❌ No se encontró stripe_payment_intent_id en el environment exportado.');
  console.error('   Verifica que el test script de Postman guarde esa variable.');
  process.exit(1);
}

console.log('');
console.log('🔗 Newman → Playwright');
console.log(`   payment_intent_id : ${paymentIntentId}`);
console.log(`   expected_amount   : ${expectedAmount || '(sin validar)'}`);
console.log(`   stripe_account_id : ${accountId}`);
console.log('');

// Construir comando
const scriptPath = path.join(__dirname, 'stripe_oxxo_validation.js');
const env = {
  ...process.env,
  PAYMENT_INTENT_ID:  paymentIntentId,
  STRIPE_ACCOUNT_ID:  accountId,
  ...(expectedAmount ? { EXPECTED_AMOUNT: expectedAmount } : {}),
};

try {
  execSync(`node "${scriptPath}"`, { env, stdio: 'inherit' });
} catch (e) {
  process.exit(e.status || 1);
}