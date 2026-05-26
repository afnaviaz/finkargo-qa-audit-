/**
 * Bridge: SUPRA INTEGRATION happy path → payment_flow.js
 *
 * Lee supra_payment_link_0..N del environment export de Newman
 * y ejecuta payment_flow.js para cada uno en secuencia.
 */

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ENV_FILE   = process.argv[2];
const SCRIPTS_DIR = process.argv[3] || path.resolve(__dirname, '..');

if (!ENV_FILE || !fs.existsSync(ENV_FILE)) {
    console.error('[SUPRA-PW] ERROR: ENV_FILE no encontrado:', ENV_FILE);
    process.exit(0);
}

let envValues = [];
try {
    const raw = JSON.parse(fs.readFileSync(ENV_FILE, 'utf-8'));
    envValues = raw.values || [];
} catch (e) {
    console.error('[SUPRA-PW] ERROR leyendo environment export:', e.message);
    process.exit(0);
}

// Recoger supra_payment_link_0, supra_payment_link_1, ... ordenados
const links = envValues
    .filter(v => /^supra_payment_link_\d+$/.test(v.key) && v.value)
    .sort((a, b) => {
        const na = parseInt(a.key.replace('supra_payment_link_', ''), 10);
        const nb = parseInt(b.key.replace('supra_payment_link_', ''), 10);
        return na - nb;
    });

if (links.length === 0) {
    // Fallback: intentar con la key genérica payment_link
    const generic = envValues.find(v => v.key === 'payment_link' && v.value);
    if (generic) {
        console.log('[SUPRA-PW] No se encontraron supra_payment_link_N. Usando payment_link genérico.');
        links.push({ key: 'payment_link_fallback', value: generic.value });
    } else {
        console.log('[SUPRA-PW] No se encontraron payment links. Saltando Playwright.');
        process.exit(0);
    }
}

console.log(`[SUPRA-PW] ${links.length} happy path link(s) encontrados. Iniciando flujo de pago...`);

const flowScript = path.join(SCRIPTS_DIR, 'playwright', 'payment_flow.js');
let passed = 0;
let failed = 0;

for (const { key, value: paymentLink } of links) {
    const idx = key.replace('supra_payment_link_', '').replace('payment_link_fallback', 'FB');
    console.log(`\n[SUPRA-PW] [${idx}] → ${paymentLink.slice(0, 70)}...`);

    const result = spawnSync('node', [flowScript, paymentLink], {
        env: {
            ...process.env,
            PAYMENT_LINK: paymentLink,
            SCRIPTS_DIR,
            CI: 'true'
        },
        stdio: 'inherit'
    });

    if (result.status === 0) {
        console.log(`[SUPRA-PW] [${idx}] ✅ Completado`);
        passed++;
    } else {
        console.warn(`[SUPRA-PW] [${idx}] ⚠️ Terminó con errores (no bloquea el pipeline)`);
        failed++;
    }
}

console.log(`\n[SUPRA-PW] Resumen: ${passed} exitosos / ${failed} con errores de ${links.length} total`);