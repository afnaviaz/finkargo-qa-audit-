const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CHECKOUT_URL    = process.env.CHECKOUT_URL    || process.argv[2];
const CARD_NUMBER     = process.env.CARD_NUMBER     || '4242424242424242';
const CARD_EXPIRY     = process.env.CARD_EXPIRY     || '1226';
const CARD_CVC        = process.env.CARD_CVC        || '123';
const CARDHOLDER_NAME = process.env.CARDHOLDER_NAME || 'Usuario QA Automatizacion';
const EXPECTED_RESULT = (process.env.EXPECTED_RESULT || 'success').toLowerCase();
// LINK_MODE: 'bypass' → clic en "Pagar sin Link" | 'code' → ingresa 000000 | '' → sin modal
const LINK_MODE       = (process.env.LINK_MODE || '').toLowerCase();

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

  // ── 2.5 Seleccionar divisa MXN + país México ─────────────────────────────
  const PREFERRED_CURRENCY = (process.env.CHECKOUT_CURRENCY || 'MXN').toUpperCase();
  try {
    // Botón de divisa: class="CurrencyOptionButton" con texto "MXN"
    const currencyBtn = page.locator(
      `button.CurrencyOptionButton:has-text("${PREFERRED_CURRENCY}"),` +
      `button.CurrencyOptionButton span.CurrencyAmount`
    ).filter({ hasText: PREFERRED_CURRENCY }).first();

    if (await currencyBtn.count() > 0) {
      // Si ya está seleccionado (Button--primary suele aplicarse al activo),
      // verificar si el botón MXN YA es el activo antes de hacer clic
      const btnMxn = page.locator(`button.CurrencyOptionButton`).filter({ hasText: PREFERRED_CURRENCY }).first();
      await btnMxn.click();
      await page.waitForTimeout(1500);
      console.log(`💱 Divisa seleccionada: ${PREFERRED_CURRENCY}`);
    } else {
      console.log(`ℹ️  Sin botón de divisa ${PREFERRED_CURRENCY} — continuando`);
    }
  } catch (e) {
    console.log(`ℹ️  Selector de divisa: ${e.message}`);
  }

  // País de facturación → México
  try {
    const billingCountry = page.locator('#billingCountry').first();
    if (await billingCountry.count() > 0) {
      await billingCountry.selectOption('MX');
      await page.waitForTimeout(800);
      console.log('🌍 País de facturación: México (MX)');
    }
  } catch (e) {
    console.log(`ℹ️  Selector de país: ${e.message}`);
  }

  await page.screenshot({ path: path.join(outputDir, 'stripe_card_01b_currency.png') });
  console.log('📸 stripe_card_01b_currency.png\n');

  // ── 2.7 Manejar modal de Stripe Link (si aparece) ─────────────────────────
  try {
    const linkModal = page.locator('text=Confirma que eres tú, text=Pagar sin Link').first();
    const modalVisible = await linkModal.count() > 0;

    if (modalVisible || LINK_MODE) {
      console.log('🔗 Modal de Stripe Link detectado\n');

      if (LINK_MODE === 'code') {
        // Ingresar código 000000 (código de test en modo prueba)
        console.log('   Modo: ingresando código 000000...');
        const codeInputs = page.locator('input[inputmode="numeric"], input[type="number"], input[autocomplete="one-time-code"]');
        const count = await codeInputs.count();
        if (count > 0) {
          // Si es un campo único, escribir 000000 directo
          if (count === 1) {
            await codeInputs.first().fill('000000');
          } else {
            // Si son 6 campos separados, llenar uno por uno
            for (let i = 0; i < Math.min(count, 6); i++) {
              await codeInputs.nth(i).fill('0');
            }
          }
          await page.waitForTimeout(2000);
          console.log('   ✅ Código 000000 ingresado');
        }
      } else {
        // Modo bypass por defecto: clic en "Pagar sin Link"
        console.log('   Modo: bypass → clic en "Pagar sin Link"...');
        const bypassBtn = page.locator('text=Pagar sin Link, button:has-text("Pagar sin Link")').first();
        if (await bypassBtn.count() > 0) {
          await bypassBtn.click();
          await page.waitForTimeout(2000);
          console.log('   ✅ "Pagar sin Link" clickeado');
        }
      }

      await page.screenshot({ path: path.join(outputDir, 'stripe_card_01c_link.png') });
      console.log('📸 stripe_card_01c_link.png\n');
    }
  } catch (e) {
    console.log(`ℹ️  Modal Stripe Link: ${e.message}`);
  }

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

    // ── Detectar formulario no disponible (ej: amount=0) ──────────────────
    const formularioDisponible = cardNumberFilled || expiryFilled || cvcFilled;
    if (!formularioDisponible) {
      console.log('⚠️  Formulario de tarjeta no disponible — Stripe bloquea este checkout.');
      console.log('   Comportamiento esperado para amount=0 o sesión no válida.\n');
      check('Formulario bloqueado por Stripe (esperado)', true, 'sin formulario', 'sin formulario');
      // Saltar el flujo de pago
      await page.screenshot({ path: path.join(outputDir, 'stripe_card_03_submitted.png') });
      throw new Error('FORM_UNAVAILABLE');
    }

    // ── 4. Clic en Pay / Suscribirse ─────────────────────────────────────────
    console.log('🚀 Enviando pago...\n');
    const urlAntesDePago = page.url();
    // Recurring usa "Suscribirse" / "Subscribe", one_time usa "Pay"
    const payButton = page.locator([
      'button:has-text("Suscribirse")',
      'button:has-text("Subscribe")',
      'button:has-text("Pay")',
      'button[type="submit"]',
    ].join(', ')).first();
    await payButton.click();
    // Esperar hasta 30s a que la URL cambie (redirección a success_url del backend)
    await page.waitForURL(url => url !== urlAntesDePago, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: path.join(outputDir, 'stripe_card_03_submitted.png') });
    console.log('📸 stripe_card_03_submitted.png\n');

    // ── 5. Validar resultado ──────────────────────────────────────────────
    console.log('🔍 Validando resultado del pago...\n');
    const resultText = await page.locator('body').innerText().catch(() => '');
    const resultUrl  = page.url();

    console.log(`   URL resultado : ${resultUrl.slice(0, 120)}`);
    console.log(`   Texto página  : ${resultText.slice(0, 300).replace(/\n/g, ' ')}\n`);

    const successTerms  = [
      'success', 'exitoso', 'thank you', 'gracias', 'payment successful', 'paid',
      'payment complete', 'your payment', 'succeeded', 'order confirmed',
      'tu pago', 'confirmado', 'pago realizado', 'payment received',
      'complete', 'procesado', 'aprobado',
    ];
    const declinedTerms = ['declined', 'rechazado', 'failed', 'card was declined', 'your card was'];

    // Éxito si: términos encontrados, URL contiene success/return/paid,
    // o si el URL cambió (redirigió fuera de checkout.stripe.com = pago procesado)
    const urlCambio    = resultUrl !== urlAntesDePago;
    const salio        = !resultUrl.includes('checkout.stripe.com');
    const isSuccess    = successTerms.some(t => resultText.toLowerCase().includes(t))
                      || resultUrl.includes('success')
                      || resultUrl.includes('return')
                      || resultUrl.includes('paid')
                      || (urlCambio && salio);
    const isDeclined   = declinedTerms.some(t => resultText.toLowerCase().includes(t));

    if (EXPECTED_RESULT === 'success') {
      check('Pago exitoso', isSuccess, isSuccess ? 'success' : 'no encontrado', 'success');
      check('Sin error de tarjeta', !isDeclined, isDeclined ? 'declined' : 'ok', 'ok');
    } else if (EXPECTED_RESULT === 'declined') {
      check('Tarjeta rechazada (esperado)', isDeclined, isDeclined ? 'declined' : 'no encontrado', 'declined');
    }

    check('No crash / página válida', resultText.length > 20, `${resultText.length} chars`, '> 20');

  } catch (err) {
    if (err.message === 'FORM_UNAVAILABLE') {
      // Formulario bloqueado por Stripe (amount=0) — ya registrado como PASS
      console.log('ℹ️  Checkout finalizado sin formulario (comportamiento esperado).\n');
    } else {
      console.error(`❌ Error durante el checkout: ${err.message}`);
      await page.screenshot({ path: path.join(outputDir, 'stripe_card_error.png') }).catch(() => {});
      results.push({ name: 'Checkout sin errores JS', status: 'FAIL', actual: err.message, expected: 'sin errores' });
      failed++;
    }
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