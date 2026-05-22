const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PAYMENT_INTENT_ID  = process.env.PAYMENT_INTENT_ID || process.argv[2];
const STRIPE_ACCOUNT_ID  = process.env.STRIPE_ACCOUNT_ID || '';
const SESSION_PATH       = path.join(__dirname, '.stripe-session.json');
const REPORT_SUFFIX      = process.env.STRIPE_REPORT_SUFFIX || '';

const EXPECTED = {
  amount:         process.env.EXPECTED_AMOUNT   ? parseInt(process.env.EXPECTED_AMOUNT) : null,
  currency:       (process.env.EXPECTED_CURRENCY  || 'mxn').toUpperCase(),
  oxxo_number:    process.env.EXPECTED_OXXO_NUMBER || null,
};

const isCI    = process.env.CI === 'true';
const outputDir = process.env.SCRIPTS_DIR || '.';

// ─── helpers ─────────────────────────────────────────────────────────────────

const results = [];
let passed = 0, failed = 0;

function check(name, condition, actual = '', expected = '') {
  if (condition) {
    console.log(`  ✅ ${name}`);
    results.push({ name, status: 'PASS', actual: String(actual), expected: String(expected) });
    passed++;
  } else {
    console.error(`  ❌ ${name} | esperado: "${expected}" | actual: "${actual}"`);
    results.push({ name, status: 'FAIL', actual: String(actual), expected: String(expected) });
    failed++;
  }
}

function requireSession() {
  if (!fs.existsSync(SESSION_PATH)) {
    console.error('❌ No hay sesión guardada.');
    console.error('   Corre primero: node scripts/playwright/stripe_save_session.js');
    console.error('   Ese script abre el browser para que hagas login con Google manualmente.');
    process.exit(1);
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

(async () => {
  if (!PAYMENT_INTENT_ID) {
    console.error('❌ ERROR: Debes pasar PAYMENT_INTENT_ID como env var o argumento.');
    console.error('   Ejemplo: PAYMENT_INTENT_ID=pi_xxxxx node stripe_oxxo_validation.js');
    process.exit(1);
  }
  console.log(`\n🧪 Validando pago OXXO en Stripe: ${PAYMENT_INTENT_ID}`);
  console.log(`   Ambiente: ${isCI ? 'CI/headless' : 'local/headed'}\n`);

  // Verificar sesión guardada — se genera con stripe_save_session.js
  requireSession();

  const browser = await chromium.launch({
    headless: isCI,
    args: isCI ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : [],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: SESSION_PATH,
    ...(isCI ? { recordVideo: { dir: path.join(outputDir, 'playwright-videos'), size: { width: 1440, height: 900 } } } : {}),
  });

  const page = await context.newPage();

  // ── Navegar al Payment Intent (modo test) ──────────────────────────────────
  const accountPath = STRIPE_ACCOUNT_ID ? `/${STRIPE_ACCOUNT_ID}` : '';
  const paymentUrl = `https://dashboard.stripe.com${accountPath}/test/payments/${PAYMENT_INTENT_ID}`;
  console.log(`🌐 Navegando a: ${paymentUrl}`);
  await page.goto(paymentUrl, { waitUntil: 'domcontentloaded' });

  // Si la sesión expiró, mostrar la URL actual para debug
  const currentUrl = page.url();
  console.log(`   URL actual: ${currentUrl}`);
  if (currentUrl.includes('/login')) {
    console.error('❌ Sesión expirada. Vuelve a correr: node scripts/playwright/stripe_save_session.js');
    fs.unlinkSync(SESSION_PATH);
    await browser.close();
    process.exit(1);
  }

  // Esperar que el dashboard SPA termine de renderizar
  console.log('⏳ Esperando carga completa del dashboard...');
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(outputDir, `stripe_oxxo_01_loaded${REPORT_SUFFIX}.png`) });
  console.log(`📸 stripe_oxxo_01_loaded${REPORT_SUFFIX}.png\n`);

  // ── Validaciones ───────────────────────────────────────────────────────────
  console.log('🔍 Ejecutando validaciones...\n');

  let pageText = await page.locator('body').innerText().catch(() => '');

  // 1. Payment Intent ID presente en la página
  check(
    'Payment Intent ID correcto',
    pageText.includes(PAYMENT_INTENT_ID),
    PAYMENT_INTENT_ID, PAYMENT_INTENT_ID
  );

  // 2. Esperar transición Incompleto → Exitoso (máx 3 minutos, refresh cada 15s)
  const POLL_INTERVAL_MS = 15000;
  const MAX_WAIT_MS      = 3 * 60 * 1000;
  const startWait        = Date.now();

  const isExitoso  = (t) => t.toLowerCase().includes('exitoso')   || t.toLowerCase().includes('succeeded');
  const isIncomplete = (t) => t.toLowerCase().includes('incompleto') || t.toLowerCase().includes('incomplete');

  if (!isExitoso(pageText) && isIncomplete(pageText)) {
    console.log('⏳ Estado Incompleto — esperando transición a Exitoso (máx 3 min)...');
    while (!isExitoso(pageText) && (Date.now() - startWait) < MAX_WAIT_MS) {
      const elapsed = Math.round((Date.now() - startWait) / 1000);
      console.log(`   ${elapsed}s — aún Incompleto, recargando en ${POLL_INTERVAL_MS / 1000}s...`);
      await page.waitForTimeout(POLL_INTERVAL_MS);
      await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      pageText = await page.locator('body').innerText().catch(() => '');
    }
    const elapsed = Math.round((Date.now() - startWait) / 1000);
    console.log(`   Tiempo total de espera: ${elapsed}s`);
  }

  const finalStatus = isExitoso(pageText) ? 'exitoso'
    : isIncomplete(pageText)              ? 'incompleto'
    : 'desconocido';

  check(
    'Estado final = Exitoso',
    isExitoso(pageText),
    finalStatus, 'exitoso'
  );

  // 3. Método de pago = OXXO
  check(
    'Método de pago = OXXO',
    pageText.toLowerCase().includes('oxxo'),
    'OXXO encontrado en página', 'OXXO'
  );

  // 4. Moneda = MXN
  check(
    `Moneda = ${EXPECTED.currency}`,
    pageText.toUpperCase().includes(EXPECTED.currency),
    EXPECTED.currency, EXPECTED.currency
  );

  // 5. Monto (si fue pasado como env var)
  // 5. Monto — extrae lo que Stripe muestra y compara contra lo que Postman envió
  // Soporta formato europeo (4.485,66) y americano (4,485.66)
  const amountMatch = pageText.match(/[\d]+\.[\d]{3},[\d]{2}|[\d]+,[\d]{3}\.[\d]{2}|[\d]+,[\d]{2}/);
  const amountFoundRaw = amountMatch ? amountMatch[0] : '';
  const amountFoundCents = amountFoundRaw
    ? parseInt(amountFoundRaw.replace(/\./g, '').replace(',', ''))
    : 0;

  if (EXPECTED.amount) {
    const expectedDisplay = (EXPECTED.amount / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 });
    check(
      `Monto enviado (${expectedDisplay} MXN) = Monto en Stripe`,
      amountFoundCents === EXPECTED.amount,
      `Stripe muestra: ${amountFoundRaw} MXN (${amountFoundCents} centavos)`,
      `${expectedDisplay} MXN (${EXPECTED.amount} centavos)`
    );
  } else {
    // Sin expected amount — solo reportar lo que hay en Stripe
    console.log(`  ℹ️  Monto en Stripe: ${amountFoundRaw} MXN (${amountFoundCents} centavos) — sin validación`);
  }

  // 6. Número OXXO (si fue pasado como env var)
  if (EXPECTED.oxxo_number) {
    check(
      'Número OXXO presente',
      pageText.includes(EXPECTED.oxxo_number),
      EXPECTED.oxxo_number, EXPECTED.oxxo_number
    );
  }

  await page.screenshot({ path: path.join(outputDir, `stripe_oxxo_02_validation${REPORT_SUFFIX}.png`) });
  console.log(`\n📸 stripe_oxxo_02_validation${REPORT_SUFFIX}.png`);

  // ── Reporte JSON ───────────────────────────────────────────────────────────
  const report = {
    payment_intent_id: PAYMENT_INTENT_ID,
    timestamp: new Date().toISOString(),
    passed, failed,
    results,
  };
  const reportPath = path.join(outputDir, `stripe_oxxo_validation_report${REPORT_SUFFIX}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 Resultado: ${passed} ✅ pasaron  |  ${failed} ❌ fallaron`);
  console.log(`📄 Reporte: ${reportPath}`);
  if (isCI) console.log(`📹 Video: ${path.join(outputDir, 'playwright-videos')}`);
  console.log('─'.repeat(50));

  await context.close();
  await browser.close();

  if (failed > 0) process.exit(1);
})();