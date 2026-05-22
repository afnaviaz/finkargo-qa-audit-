const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const VOUCHER_URL       = process.env.VOUCHER_URL || process.argv[2];
const EXPECTED_AMOUNT   = process.env.EXPECTED_AMOUNT ? parseInt(process.env.EXPECTED_AMOUNT) : null;
const EXPECTED_CURRENCY = (process.env.EXPECTED_CURRENCY || 'MXN').toUpperCase();

const isCI      = process.env.CI === 'true';
const outputDir = process.env.SCRIPTS_DIR || '.';

// ─── helpers ──────────────────────────────────────────────────────────────────

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

// ─── main ─────────────────────────────────────────────────────────────────────

(async () => {
  if (!VOUCHER_URL) {
    console.error('❌ ERROR: Debes pasar VOUCHER_URL como env var o argumento.');
    console.error('   Ejemplo: VOUCHER_URL=https://payments.stripe.com/oxxo/voucher/... node stripe_oxxo_voucher.js');
    process.exit(1);
  }

  console.log(`\n🧾 Validando voucher OXXO`);
  console.log(`   URL: ${VOUCHER_URL.slice(0, 80)}...`);
  console.log(`   Ambiente: ${isCI ? 'CI/headless' : 'local/headed'}\n`);

  const browser = await chromium.launch({
    headless: isCI,
    args: isCI ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : [],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(isCI ? { recordVideo: { dir: path.join(outputDir, 'playwright-videos'), size: { width: 1280, height: 800 } } } : {}),
  });

  const page = await context.newPage();

  console.log('🌐 Navegando al voucher...');
  await page.goto(VOUCHER_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(outputDir, 'stripe_voucher_01_loaded.png') });
  console.log('📸 stripe_voucher_01_loaded.png\n');

  // ── Validaciones ───────────────────────────────────────────────────────────
  console.log('🔍 Ejecutando validaciones...\n');

  const pageText = await page.locator('body').innerText().catch(() => '');

  // 1. La página cargó con contenido OXXO
  check(
    'Página voucher cargó correctamente',
    pageText.length > 50,
    `${pageText.length} caracteres`, '> 50'
  );

  // 2. Logo / marca OXXO presente
  const hasOxxoLogo = await page.locator('img[alt*="OXXO" i], img[src*="oxxo" i]').count() > 0;
  const hasOxxoText = pageText.toLowerCase().includes('oxxo');
  check(
    'Marca OXXO presente',
    hasOxxoLogo || hasOxxoText,
    hasOxxoLogo ? 'logo encontrado' : 'texto encontrado', 'OXXO'
  );

  // 3. Moneda correcta
  check(
    `Moneda = ${EXPECTED_CURRENCY}`,
    pageText.toUpperCase().includes(EXPECTED_CURRENCY),
    EXPECTED_CURRENCY, EXPECTED_CURRENCY
  );

  // 4. Monto correcto (si se pasó como env var)
  // Stripe muestra el monto en formato humano: 120000 centavos → "1.200,00" o "1,200.00"
  if (EXPECTED_AMOUNT) {
    const pesos = EXPECTED_AMOUNT / 100;
    // Buscar el número base sin separadores de miles
    const amountInPage = pageText.replace(/[,.\s]/g, '').includes(String(pesos).replace('.', ''));
    check(
      `Monto = ${pesos} ${EXPECTED_CURRENCY}`,
      amountInPage,
      `Buscado: ${pesos}`, String(pesos)
    );
  }

  // 5. Entorno de prueba visible (test mode)
  const isTestMode = pageText.toLowerCase().includes('prueba') || pageText.toLowerCase().includes('test');
  check(
    'Entorno de prueba identificado',
    isTestMode,
    isTestMode ? 'sí' : 'no', 'sí'
  );

  // 6. No hay error 404 ni página en blanco
  const hasError = pageText.toLowerCase().includes('not found') ||
                   pageText.toLowerCase().includes('404') ||
                   pageText.toLowerCase().includes('expired');
  check(
    'Voucher no expirado ni inválido',
    !hasError,
    hasError ? 'error encontrado' : 'ok', 'ok'
  );

  await page.screenshot({ path: path.join(outputDir, 'stripe_voucher_02_validation.png') });
  console.log('\n📸 stripe_voucher_02_validation.png');

  // ── Reporte JSON ───────────────────────────────────────────────────────────
  const report = {
    voucher_url: VOUCHER_URL,
    timestamp: new Date().toISOString(),
    passed, failed,
    results,
  };
  const reportPath = path.join(outputDir, 'stripe_voucher_validation_report.json');
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