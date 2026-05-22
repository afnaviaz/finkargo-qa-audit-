/**
 * Renueva la sesión de Stripe y muestra el base64 listo para GitHub Secret.
 *
 * Uso:
 *   node scripts/playwright/stripe_renew_session.js
 *
 * Pasos automáticos:
 *   1. Abre el browser para hacer login con Google en Stripe
 *   2. Guarda la sesión en .stripe-session.json
 *   3. Encodea el archivo en base64 e imprime el valor para copiar en GitHub
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const SESSION_PATH  = path.join(__dirname, '.stripe-session.json');
const SAVE_SCRIPT   = path.join(__dirname, 'stripe_save_session.js');

console.log('');
console.log('🔄 Paso 1 — Renovando sesión de Stripe (abre el browser)...');
console.log('');

try {
  execSync(`node "${SAVE_SCRIPT}"`, { stdio: 'inherit' });
} catch (e) {
  console.error('\n❌ Falló stripe_save_session.js');
  process.exit(e.status || 1);
}

if (!fs.existsSync(SESSION_PATH)) {
  console.error('\n❌ No se encontró .stripe-session.json después del login.');
  process.exit(1);
}

console.log('\n🔐 Paso 2 — Encodeando sesión en base64...\n');

const bytes  = fs.readFileSync(SESSION_PATH);
const b64    = bytes.toString('base64');
const outPath = path.join(__dirname, 'stripe_session_b64.txt');

fs.writeFileSync(outPath, b64, 'ascii');

console.log('═'.repeat(60));
console.log('✅ Sesión renovada y encodeada.');
console.log('');
console.log('📋 PRÓXIMOS PASOS:');
console.log('   1. Abre el archivo:');
console.log(`      ${outPath}`);
console.log('   2. Copia TODO el contenido (Ctrl+A → Ctrl+C)');
console.log('   3. Ve a GitHub → Settings → Secrets → STRIPE_SESSION → Update');
console.log('   4. Pega el valor y guarda');
console.log('');
console.log('⚠️  NO subas stripe_session_b64.txt a git.');
console.log('═'.repeat(60));