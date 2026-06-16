#!/usr/bin/env node
/**
 * scripts/playwright_to_newman_bridge.js
 *
 * Lee el último usuario registrado por Playwright
 * y genera un environment.json compatible con Newman/Postman.
 *
 * Uso:
 *   node scripts/playwright_to_newman_bridge.js \
 *     --input  ./playwright/data/registered-users.json \
 *     --output ./scripts/playwright_env_export.json \
 *     --base-url https://app-testing.finkargo.com.co \
 *     --pais CO
 */

const fs   = require('fs');
const path = require('path');

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get  = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const INPUT_FILE  = get('--input',    './playwright/data/registered-users.json');
const OUTPUT_FILE = get('--output',   './scripts/playwright_env_export.json');
const BASE_URL    = get('--base-url', 'https://app-testing.finkargo.com.co');
const PAIS        = get('--pais',     'CO');

// ── Leer datos de Playwright ─────────────────────────────────────────────────
if (!fs.existsSync(INPUT_FILE)) {
  console.error(`❌ Archivo no encontrado: ${INPUT_FILE}`);
  console.error('   Asegúrate de que Playwright haya corrido correctamente.');
  process.exit(1);
}

let users;
try {
  users = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
} catch (err) {
  console.error(`❌ Error leyendo ${INPUT_FILE}:`, err.message);
  process.exit(1);
}

if (!users || users.length === 0) {
  console.error('❌ No hay usuarios registrados en el archivo.');
  process.exit(1);
}

const user = users[users.length - 1];
console.log(`\n✓ Usuario encontrado: ${user.email}`);
console.log(`  Empresa:   ${user.empresa || 'N/A'}`);
console.log(`  NIT:       ${user.nit || 'N/A'}`);
console.log(`  Timestamp: ${new Date(user.timestamp).toISOString()}`);

// ── Construir environment Newman ─────────────────────────────────────────────
const v = (key, value) => ({
  key,
  value: value || '',
  type: 'default',
  enabled: true
});

const environment = {
  id:   `playwright-ob2-${Date.now()}`,
  name: `OB2 — ${user.email}`,
  values: [
    // Usuario recién registrado
    v('user_email',    user.email),
    v('user_password', user.password),
    v('user_nombre',   user.nombre   || ''),
    v('user_apellido', user.apellido || ''),
    v('user_empresa',  user.empresa  || ''),
    v('user_nit',      user.nit      || ''),

    // Ambiente
    v('base_url', BASE_URL),
    v('pais',     PAIS),

    // Variables que Newman pobla durante la ejecución
    // (el request de login las setea con pm.environment.set)
    v('auth_token',    ''),
    v('refresh_token', ''),
    // user_id capturado por Playwright durante el registro; si es '', Newman lo obtiene vía Login
    v('user_id',       user.user_id  || ''),
    v('company_id',    ''),
  ],
  _postman_variable_scope: 'environment',
  _postman_exported_at:    new Date().toISOString(),
  _postman_exported_using: 'finkargo-qa-bridge/1.0'
};

// ── Guardar ──────────────────────────────────────────────────────────────────
const outputDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(environment, null, 2), 'utf-8');

console.log(`\n✓ Environment generado: ${OUTPUT_FILE}`);
console.log(`  Variables: ${environment.values.length}`);
console.log('\n  Newman command:');
console.log(`  newman run <coleccion.json> --environment ${OUTPUT_FILE}\n`);