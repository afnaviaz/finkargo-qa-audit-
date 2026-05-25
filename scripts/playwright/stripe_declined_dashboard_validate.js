/**
 * Stripe Dashboard Validator — Pagos Rechazados
 * Navega al dashboard de Stripe con sesión guardada y verifica que el pago
 * aparece como FALLIDO con el decline_code esperado.
 *
 * Uso:
 *   CUSTOMER_EMAIL=test@example.com
 *   DECLINE_CODE=insufficient_funds
 *   node stripe_declined_dashboard_validate.js
 *
 * Env vars:
 *   CUSTOMER_EMAIL     — email del cliente para buscar en el dashboard
 *   DECLINE_CODE       — código de rechazo esperado (ej: insufficient_funds)
 *   CHECKOUT_IDX       — índice para nombrar archivos de reporte
 *   STRIPE_ACCOUNT_ID  — ID de cuenta Stripe (opcional)
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const STRIPE_ACCOUNT_ID = process.env.STRIPE_ACCOUNT_ID || '';
const CUSTOMER_EMAIL    = process.env.CUSTOMER_EMAIL    || '';
const DECLINE_CODE      = process.env.DECLINE_CODE      || 'generic_decline';
const CHECKOUT_IDX      = process.env.CHECKOUT_IDX      || '0';
const SESSION_PATH      = path.join(__dirname, '.stripe-session.json');
const isCI              = process.env.CI === 'true';
const outputDir         = process.env.SCRIPTS_DIR || '.';

const FAILED_TERMS = ['failed', 'fallido', 'rechazado', 'declined', 'failure'];

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

  console.log(`\n🔍 Validando pago RECHAZADO en Stripe Dashboard`);
  console.log(`   Email        : ${CUSTOMER_EMAIL}`);
  console.log(`   Decline code : ${DECLINE_CODE}`);
  console.log(`   Idx          : ${CHECKOUT_IDX}`);
  console.log(`   Ambiente     : ${isCI ? 'CI/headless' : 'local/headed'}\n`);

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

  if (page.url().includes('/login')) {
    console.error('❌ Sesión expirada. Renueva: node scripts/playwright/stripe_save_session.js');
    fs.unlinkSync(SESSION_PATH);
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outputDir, `stripe_declined_dash_01_loaded_${DECLINE_CODE}.png`) });
  console.log(`📸 stripe_declined_dash_01_loaded_${DECLINE_CODE}.png\n`);

  check('Dashboard accesible (no login)', !page.url().includes('/login'), page.url(), 'dashboard');

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

  await page.screenshot({ path: path.join(outputDir, `stripe_declined_dash_02_search_${DECLINE_CODE}.png`) });
  console.log(`📸 stripe_declined_dash_02_search_${DECLINE_CODE}.png\n`);

  const pageText = await page.locator('body').innerText().catch(() => '');
  const pageTextLower = pageText.toLowerCase();

  // Verificar que hay al menos un pago con estado Failed/Fallido
  const hasFailed = FAILED_TERMS.some(t => pageTextLower.includes(t));
  check('Al menos 1 pago con estado Failed/Fallido visible', hasFailed,
    hasFailed ? 'failed encontrado' : 'no encontrado', 'failed/fallido');

  // Verificar que NO solo hay pagos exitosos (el rechazo debe ser visible)
  const soloExitosos = (pageTextLower.includes('exitoso') || pageTextLower.includes('succeeded'))
                    && !hasFailed;
  check('Sin resultados solo-exitosos (rechazo debe aparecer)', !soloExitosos,
    soloExitosos ? 'solo exitosos, sin failed' : 'ok', 'ok');

  // ── Abrir detalle del primer PI para verificar decline_code ──────────────
  const piMatches = pageText.match(/pi_[A-Za-z0-9]+/g) || [];
  const uniquePis = [...new Set(piMatches)];
  console.log(`   PIs encontrados: ${uniquePis.length > 0 ? uniquePis.join(', ') : 'ninguno'}`);

  let piDeclineConfirmed = '';

  if (uniquePis.length > 0) {
    const firstPi = uniquePis[0];
    const piUrl   = `https://dashboard.stripe.com${accountSuffix}/test/payments/${firstPi}`;
    console.log(`\n🔗 Verificando detalle PI: ${firstPi}`);
    await page.goto(piUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(outputDir, `stripe_declined_dash_03_pi_${DECLINE_CODE}.png`) });
    console.log(`📸 stripe_declined_dash_03_pi_${DECLINE_CODE}.png\n`);

    const piText      = await page.locator('body').innerText().catch(() => '');
    const piTextLower = piText.toLowerCase();

    // Estado: Failed (no Succeeded)
    const piHasFailed  = FAILED_TERMS.some(t => piTextLower.includes(t));
    const piHasSuccess = piTextLower.includes('exitoso') || piTextLower.includes('succeeded');
    check(`PI ${firstPi} — Estado Failed`, piHasFailed,
      piHasFailed ? 'failed' : 'no encontrado', 'failed/fallido');
    check(`PI ${firstPi} — Sin estado Exitoso/Succeeded`, !piHasSuccess,
      piHasSuccess ? 'exitoso encontrado (error!)' : 'ok', 'sin exitoso');

    // Decline code en los detalles del pago
    const declineCodeNorm = DECLINE_CODE.replace(/_/g, ' ').toLowerCase();
    const hasDeclineCode  = piTextLower.includes(DECLINE_CODE.toLowerCase())
                         || piTextLower.includes(declineCodeNorm);
    check(`PI ${firstPi} — Decline code "${DECLINE_CODE}" visible`, hasDeclineCode,
      hasDeclineCode ? DECLINE_CODE : `no encontrado (texto: ${piText.slice(0, 200)})`,
      DECLINE_CODE);

    piDeclineConfirmed = firstPi;
  } else {
    check('Al menos 1 PI encontrado para verificar', false, 'ninguno', 'pi_...');
  }

  // ── Reporte JSON ───────────────────────────────────────────────────────────
  const report = {
    checkout_idx:    CHECKOUT_IDX,
    decline_code:    DECLINE_CODE,
    customer_email:  CUSTOMER_EMAIL,
    pi_confirmed:    piDeclineConfirmed,
    timestamp:       new Date().toISOString(),
    passed, failed, results,
  };
  const reportPath = path.join(outputDir, `stripe_declined_dashboard_report_${DECLINE_CODE}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 Dashboard [${DECLINE_CODE}]: ${passed} ✅  |  ${failed} ❌`);
  console.log(`📄 Reporte: ${reportPath}`);
  if (isCI) console.log(`📹 Video: ${path.join(outputDir, 'playwright-videos')}`);
  console.log('─'.repeat(50));

  await context.close();
  await browser.close();

  if (failed > 0) process.exit(1);
})();