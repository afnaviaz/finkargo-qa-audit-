/**
 * Puente Newman → Playwright
 * Lee el environment exportado por Newman y lanza stripe_oxxo_validation.js
 * para cada happy path (stripe_pi_0, stripe_pi_1, stripe_pi_2).
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

const envData = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
const values  = envData.values || envData.environment?.values || [];

function getVar(name) {
  const found = values.find(v => v.key === name);
  return found ? (found.value || '') : '';
}

const accountId  = process.env.STRIPE_ACCOUNT_ID || 'acct_1TWfcTKyHOFqxcvG';
const scriptPath = path.join(__dirname, 'stripe_oxxo_validation.js');

// Recopilar los 3 happy paths guardados por el test script
const happyPaths = [];
for (let i = 0; i < 3; i++) {
  const pi     = getVar(`stripe_pi_${i}`);
  const amount = getVar(`stripe_amount_${i}`);
  if (pi) happyPaths.push({ idx: i, pi, amount });
}

if (happyPaths.length === 0) {
  console.error('❌ No se encontraron stripe_pi_0/1/2 en el environment exportado.');
  console.error('   Verifica que el test script de Postman guarde esas variables.');
  process.exit(1);
}

console.log(`\n🔗 Newman → Playwright  (${happyPaths.length} happy paths)`);
happyPaths.forEach(({ idx, pi, amount }) =>
  console.log(`   EP-0${idx + 1}: ${pi} | amount: ${amount}`)
);
console.log('');

let globalFailed = 0;

for (const { idx, pi, amount } of happyPaths) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`▶ Validando EP-0${idx + 1}: ${pi}`);

  const env = {
    ...process.env,
    PAYMENT_INTENT_ID: pi,
    STRIPE_ACCOUNT_ID: accountId,
    STRIPE_REPORT_SUFFIX: `_ep0${idx + 1}`,
    ...(amount ? { EXPECTED_AMOUNT: amount } : {}),
  };

  try {
    execSync(`node "${scriptPath}"`, { env, stdio: 'inherit' });
    console.log(`✅ EP-0${idx + 1} validado`);
  } catch (e) {
    console.error(`❌ EP-0${idx + 1} falló (exit ${e.status})`);
    globalFailed++;
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`📊 Happy paths: ${happyPaths.length - globalFailed} ✅  |  ${globalFailed} ❌`);

if (globalFailed > 0) process.exit(1);