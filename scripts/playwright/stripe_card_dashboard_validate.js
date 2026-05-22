/**
 * Stripe Dashboard Validator — Card Payments
 * Navega al dashboard de Stripe con la sesión guardada y verifica
 * que el pago más reciente del email dado aparece como "Exitoso".
 *
 * Uso:
 *   node stripe_card_dashboard_validate.js
 *   env vars: STRIPE_ACCOUNT_ID, CUSTOMER_EMAIL, CHECKOUT_IDX, SCRIPTS_DIR
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const STRIPE_ACCOUNT_ID = process.env.STRIPE_ACCOUNT_ID || '';
const CUSTOMER_EMAIL    = process.env.CUSTOMER_EMAIL    || '';
const CHECKOUT_IDX      = process.env.CHECKOUT_IDX      || '0';
const SESSION_PATH      = path.join(__dirname, '.stripe-session.json');
const isCI              = process.env.CI === 'true';
const outputDir         = process.env.SCRIPTS_DIR || '.';

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

(async () => {
  if (!fs.existsSync(SESSION_PATH)) {
    console.error('❌ Sin sesión de Stripe guardada. Corre stripe_save_session.js primero.');
    process.exit(1);
  }
  if (!CUSTOMER_EMAIL) {
    console.error('❌ CUSTOMER_EMAIL no definido. No se puede buscar el pago en Stripe.');
    process.exit(1);
  }

  console.log(`\n🔍 Validando pago Card en Stripe Dashboard`);
  console.log(`   Email    : ${CUSTOMER_EMAIL}`);
  console.log(`   Idx      : ${CHECKOUT_IDX}`);
  console.log(`   Ambiente : ${isCI ? 'CI/headless' : 'local/headed'}\n`);

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

  // ── Navegar al dashboard de pagos ─────────────────────────────────────────
  const accountSuffix = STRIPE_ACCOUNT_ID ? `/${STRIPE_ACCOUNT_ID}` : '';
  const paymentsUrl   = `https://dashboard.stripe.com${accountSuffix}/test/payments`;
  console.log(`🌐 Navegando a: ${paymentsUrl}`);
  await page.goto(paymentsUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  // Sesión expirada
  if (page.url().includes('/login')) {
    console.error('❌ Sesión expirada. Renueva: node scripts/playwright/stripe_save_session.js');
    fs.unlinkSync(SESSION_PATH);
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outputDir, `stripe_card_dash_01_loaded_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_card_dash_01_loaded_idx${CHECKOUT_IDX}.png\n`);

  // ── Buscar por email del cliente ──────────────────────────────────────────
  console.log(`🔎 Buscando pagos de: ${CUSTOMER_EMAIL}`);
  const searchSelectors = [
    '[data-testid="search-input"]',
    'input[placeholder*="Search"]',
    'input[placeholder*="Buscar"]',
    'input[type="search"]',
  ];
  let searchFilled = false;
  for (const sel of searchSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.click();
      await el.fill(CUSTOMER_EMAIL);
      await page.waitForTimeout(3000);
      searchFilled = true;
      break;
    }
  }
  if (!searchFilled) {
    console.log('  ⚠️  Campo de búsqueda no encontrado — validando lista sin filtro');
  }

  await page.screenshot({ path: path.join(outputDir, `stripe_card_dash_02_search_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_card_dash_02_search_idx${CHECKOUT_IDX}.png\n`);

  // ── Leer contenido de la lista ────────────────────────────────────────────
  const pageText = await page.locator('body').innerText().catch(() => '');

  // Extraer PI IDs visibles en la página
  const piMatches = pageText.match(/pi_[A-Za-z0-9]+/g) || [];
  const uniquePis = [...new Set(piMatches)];
  console.log(`   PIs encontrados: ${uniquePis.length > 0 ? uniquePis.join(', ') : 'ninguno'}`);

  // Validaciones
  const hasExitoso = pageText.toLowerCase().includes('exitoso')
                  || pageText.toLowerCase().includes('succeeded')
                  || pageText.toLowerCase().includes('successful');
  const hasCard    = pageText.includes('4242') || pageText.toLowerCase().includes('card');
  const hasPi      = uniquePis.length > 0;

  check('Dashboard accesible (no login)', !page.url().includes('/login'), page.url(), 'dashboard');
  check('Pagos Card visibles (....4242)', hasCard,    hasCard    ? 'card/4242 encontrado'   : 'no encontrado', 'card/4242');
  check('Al menos 1 pago Exitoso',        hasExitoso, hasExitoso ? 'Exitoso encontrado'     : 'no encontrado', 'exitoso');
  check('Al menos 1 PI presente (pi_*)',  hasPi,      uniquePis.length > 0 ? uniquePis[0] : 'ninguno', 'pi_...');

  // Intentar entrar al pago más reciente
  let piIdConfirmed = '';
  if (uniquePis.length > 0) {
    const firstPi = uniquePis[0];
    const piUrl   = `https://dashboard.stripe.com${accountSuffix}/test/payments/${firstPi}`;
    console.log(`\n🔗 Verificando PI: ${firstPi}`);
    await page.goto(piUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(outputDir, `stripe_card_dash_03_pi_idx${CHECKOUT_IDX}.png`) });
    console.log(`📸 stripe_card_dash_03_pi_idx${CHECKOUT_IDX}.png\n`);

    const piPageText = await page.locator('body').innerText().catch(() => '');
    const piExitoso  = piPageText.toLowerCase().includes('exitoso') || piPageText.toLowerCase().includes('succeeded');
    const piEsMxn    = piPageText.toUpperCase().includes('MXN');

    check(`PI ${firstPi} — Estado Exitoso`, piExitoso, piExitoso ? 'exitoso' : 'no encontrado', 'exitoso');
    check(`PI ${firstPi} — Moneda MXN`,    piEsMxn,   piEsMxn   ? 'MXN'     : 'no encontrado', 'MXN');
    piIdConfirmed = firstPi;
  }

  // ── Reporte JSON ───────────────────────────────────────────────────────────
  const report = {
    checkout_idx:     CHECKOUT_IDX,
    customer_email:   CUSTOMER_EMAIL,
    pi_found:         uniquePis,
    pi_confirmed:     piIdConfirmed,
    timestamp:        new Date().toISOString(),
    passed, failed, results,
  };
  const reportPath = path.join(outputDir, `stripe_card_dashboard_report_idx${CHECKOUT_IDX}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 Dashboard: ${passed} ✅  |  ${failed} ❌`);
  console.log(`📄 Reporte: ${reportPath}`);
  if (isCI) console.log(`📹 Video: ${path.join(outputDir, 'playwright-videos')}`);
  console.log('─'.repeat(50));

  await context.close();
  await browser.close();

  if (failed > 0) process.exit(1);
})();