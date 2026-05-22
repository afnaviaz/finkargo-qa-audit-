const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CHECKOUT_URL    = process.env.CHECKOUT_URL    || process.argv[2];
const CARD_NUMBER     = process.env.CARD_NUMBER     || '4242424242424242';
const CARD_EXPIRY     = process.env.CARD_EXPIRY     || '1226';
const CARD_CVC        = process.env.CARD_CVC        || '123';
const CARDHOLDER_NAME = process.env.CARDHOLDER_NAME || 'Usuario QA Automatizacion';
const EXPECTED_RESULT = (process.env.EXPECTED_RESULT || 'success').toLowerCase();

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

// Llena un campo de Stripe (masked input) tecla por tecla
async function fillStripeField(locator, value) {
  await locator.click();
  await locator.type(value, { delay: 60 });
}

// ─── main ─────────────────────────────────────────────────────────────────────

(async () => {
  if (!CHECKOUT_URL) {
    console.error('❌ ERROR: Debes pasar CHECKOUT_URL como env var o argumento.');
    console.error('   Ejemplo: CHECKOUT_URL=https://checkout.stripe.com/c/pay/cs_test_... node stripe_card_checkout.js');
    process.exit(1);
  }

  console.log(`\n💳 Ejecutando pago con tarjeta en Stripe Checkout`);
  console.log(`   URL   : ${CHECKOUT_URL.slice(0, 80)}...`);
  console.log(`   Tarjeta: ${CARD_NUMBER.slice(0, 4)} **** **** ${CARD_NUMBER.slice(-4)}`);
  console.log(`   Resultado esperado: ${EXPECTED_RESULT}`);
  console.log(`   Ambiente: ${isCI ? 'CI/headless' : 'local/headed'}\n`);

  const browser = await chromium.launch({
    headless: isCI,
    args: isCI ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : [],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(isCI ? { recordVideo: { dir: path.join(outputDir, 'playwright-videos'), size: { width: 1280, height: 900 } } } : {}),
  });

  const page = await context.newPage();

  // ── 1. Navegar al checkout ────────────────────────────────────────────────
  console.log('🌐 Navegando al checkout...');
  await page.goto(CHECKOUT_URL, { waitUntil: 'domcontentloaded' });
  // Esperar a red idle o hasta 8 s, lo que ocurra primero
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outputDir, 'stripe_card_01_loaded.png') });
  console.log('📸 stripe_card_01_loaded.png\n');

  // ── 2. Validar que la página cargó ───────────────────────────────────────
  console.log('🔍 Validando carga del checkout...\n');
  const pageText = await page.locator('body').innerText().catch(() => '');
  const pageTextLower = pageText.toLowerCase();

  check('Página checkout cargó', pageText.length > 50, `${pageText.length} chars`, '> 50');
  const hasCard = pageTextLower.includes('card') || pageTextLower.includes('tarjeta');
  check('Método Card presente', hasCard, hasCard ? 'card encontrado' : 'card no encontrado', 'card');
  check('No expirado / error 404',
    !pageTextLower.includes('expired') && !pageTextLower.includes('not found'),
    'ok', 'ok'
  );

  // ── 3. Llenar datos de tarjeta ────────────────────────────────────────────
  console.log('✍️  Llenando datos de tarjeta...\n');

  try {
    // Stripe Checkout puede renderizar los campos en iframes o directamente
    // Intentamos acceso directo primero, luego por iframe

    // ── Número de tarjeta ─────────────────────────────────────────────────
    const cardNumberSelectors = [
      '[placeholder="1234 1234 1234 1234"]',
      'input[data-elements-stable-field-name="cardNumber"]',
      '#cardNumber',
    ];
    let cardNumberFilled = false;
    for (const sel of cardNumberSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await fillStripeField(el, CARD_NUMBER);
        cardNumberFilled = true;
        console.log(`  ✅ Card number → selector: ${sel}`);
        break;
      }
    }

    // Fallback: buscar en iframes de Stripe
    if (!cardNumberFilled) {
      const frames = page.frames();
      for (const frame of frames) {
        const el = frame.locator('[placeholder="1234 1234 1234 1234"]').first();
        if (await el.count() > 0) {
          await fillStripeField(el, CARD_NUMBER);
          cardNumberFilled = true;
          console.log('  ✅ Card number → vía iframe');
          break;
        }
      }
    }
    check('Card number llenado', cardNumberFilled, cardNumberFilled ? 'ok' : 'no encontrado', 'ok');

    // ── Fecha de expiración ───────────────────────────────────────────────
    const expirySelectors = [
      '[placeholder="MM / YY"]',
      '[placeholder="MM/YY"]',
      'input[data-elements-stable-field-name="cardExpiry"]',
      '#cardExpiry',
    ];
    let expiryFilled = false;
    for (const sel of expirySelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await fillStripeField(el, CARD_EXPIRY);
        expiryFilled = true;
        break;
      }
    }
    if (!expiryFilled) {
      const frames = page.frames();
      for (const frame of frames) {
        const el = frame.locator('[placeholder="MM / YY"]').first();
        if (await el.count() > 0) {
          await fillStripeField(el, CARD_EXPIRY);
          expiryFilled = true;
          break;
        }
      }
    }
    check('Expiry llenado', expiryFilled, expiryFilled ? 'ok' : 'no encontrado', 'ok');

    // ── CVC ───────────────────────────────────────────────────────────────
    const cvcSelectors = [
      '[placeholder="CVC"]',
      '[placeholder="CVV"]',
      'input[data-elements-stable-field-name="cardCvc"]',
      '#cardCvc',
    ];
    let cvcFilled = false;
    for (const sel of cvcSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await fillStripeField(el, CARD_CVC);
        cvcFilled = true;
        break;
      }
    }
    if (!cvcFilled) {
      const frames = page.frames();
      for (const frame of frames) {
        const el = frame.locator('[placeholder="CVC"]').first();
        if (await el.count() > 0) {
          await fillStripeField(el, CARD_CVC);
          cvcFilled = true;
          break;
        }
      }
    }
    check('CVC llenado', cvcFilled, cvcFilled ? 'ok' : 'no encontrado', 'ok');

    // ── Nombre del titular ────────────────────────────────────────────────
    const nameSelectors = [
      '[placeholder="Full name on card"]',
      '[placeholder="Nombre completo en la tarjeta"]',
      '#billingName',
      'input[autocomplete="cc-name"]',
    ];
    let nameFilled = false;
    for (const sel of nameSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.fill(CARDHOLDER_NAME);
        nameFilled = true;
        break;
      }
    }
    check('Cardholder name llenado', nameFilled, nameFilled ? 'ok' : 'no encontrado', 'ok');

    await page.screenshot({ path: path.join(outputDir, 'stripe_card_02_filled.png') });
    console.log('\n📸 stripe_card_02_filled.png\n');

    // ── 4. Clic en Pay ────────────────────────────────────────────────────
    console.log('🚀 Enviando pago...\n');
    const payButton = page.locator('button:has-text("Pay"), button[type="submit"]').first();
    await payButton.click();
    // Esperar navegación a página de resultado o hasta 15 s
    await Promise.race([
      page.waitForURL('**success**', { timeout: 15000 }).catch(() => {}),
      page.waitForURL('**return**',  { timeout: 15000 }).catch(() => {}),
      page.waitForURL('**confirmation**', { timeout: 15000 }).catch(() => {}),
      page.waitForTimeout(15000),
    ]);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: path.join(outputDir, 'stripe_card_03_submitted.png') });
    console.log('📸 stripe_card_03_submitted.png\n');

    // ── 5. Validar resultado ──────────────────────────────────────────────
    console.log('🔍 Validando resultado del pago...\n');
    const resultText = await page.locator('body').innerText().catch(() => '');
    const resultUrl  = page.url();

    const successTerms  = [
      'success', 'exitoso', 'thank you', 'gracias', 'payment successful', 'paid',
      'payment complete', 'your payment', 'succeeded', 'order confirmed',
      'tu pago', 'confirmado', 'pago realizado', 'payment received',
    ];
    const declinedTerms = ['declined', 'rechazado', 'failed', 'card was declined', 'your card was'];

    const isSuccess  = successTerms.some(t => resultText.toLowerCase().includes(t))  || resultUrl.includes('success');
    const isDeclined = declinedTerms.some(t => resultText.toLowerCase().includes(t));

    if (EXPECTED_RESULT === 'success') {
      check('Pago exitoso', isSuccess, isSuccess ? 'success' : 'no encontrado', 'success');
      check('Sin error de tarjeta', !isDeclined, isDeclined ? 'declined' : 'ok', 'ok');
    } else if (EXPECTED_RESULT === 'declined') {
      check('Tarjeta rechazada (esperado)', isDeclined, isDeclined ? 'declined' : 'no encontrado', 'declined');
    }

    check('No crash / página válida', resultText.length > 20, `${resultText.length} chars`, '> 20');

  } catch (err) {
    console.error(`❌ Error durante el checkout: ${err.message}`);
    await page.screenshot({ path: path.join(outputDir, 'stripe_card_error.png') }).catch(() => {});
    results.push({ name: 'Checkout sin errores JS', status: 'FAIL', actual: err.message, expected: 'sin errores' });
    failed++;
  }

  // ── Reporte JSON ──────────────────────────────────────────────────────────
  const report = {
    checkout_url: CHECKOUT_URL,
    card_last4: CARD_NUMBER.slice(-4),
    expected_result: EXPECTED_RESULT,
    timestamp: new Date().toISOString(),
    passed, failed,
    results,
  };
  const reportPath = path.join(outputDir, 'stripe_card_checkout_report.json');
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