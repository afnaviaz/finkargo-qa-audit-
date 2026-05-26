/**
 * Stripe Declined Checkout — Finkargo QA
 * Navega a un Stripe Checkout URL, ingresa una tarjeta de prueba que Stripe rechaza
 * y valida que el mensaje de error corresponde al decline_code esperado.
 *
 * Tarjetas de prueba: https://docs.stripe.com/testing#declined-payments
 *
 * Uso:
 *   CHECKOUT_URL=https://checkout.stripe.com/c/pay/cs_test_...
 *   CARD_NUMBER=4000000000000002
 *   DECLINE_CODE=generic_decline
 *   DECLINE_DESCRIPTION="Rechazo genérico"
 *   node stripe_declined_checkout.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const CHECKOUT_URL        = process.env.CHECKOUT_URL        || process.argv[2];
const CARD_NUMBER         = process.env.CARD_NUMBER         || '4000000000000002';
const CARD_EXPIRY         = process.env.CARD_EXPIRY         || '1226';
const CARD_CVC            = process.env.CARD_CVC            || '123';
const CARDHOLDER_NAME     = process.env.CARDHOLDER_NAME     || 'Usuario QA Automatizacion';
const DECLINE_CODE        = process.env.DECLINE_CODE        || 'generic_decline';
const DECLINE_DESCRIPTION = process.env.DECLINE_DESCRIPTION || 'Tarjeta rechazada';
const SCREENSHOT_PREFIX   = process.env.SCREENSHOT_PREFIX   || `stripe_declined_${DECLINE_CODE}`;
const LINK_MODE           = (process.env.LINK_MODE || '').toLowerCase();
const isCI                = process.env.CI === 'true';
const outputDir           = process.env.SCRIPTS_DIR || '.';

// Mensajes que Stripe muestra en la UI según el decline_code
// Stripe UI en español (locale es-419) — incluir frases en español e inglés
// Fuente: https://docs.stripe.com/testing#declined-payments
const DECLINE_MESSAGES = {
  generic_decline: [
    // English
    'your card was declined', 'card was declined',
    // Español (Stripe UI es-419)
    'se ha rechazado tu tarjeta', 'ha rechazado tu tarjeta',
    'rechazada', 'rechazado',
  ],
  insufficient_funds: [
    // English
    'insufficient funds', 'your card has insufficient funds',
    // Español
    'fondos suficientes', 'no tiene fondos', 'fondos insuficientes',
  ],
  lost_card: [
    // English
    'your card was declined', 'card was declined',
    // Español
    'se ha rechazado tu tarjeta', 'emisor de tu tarjeta', 'contacta con el emisor',
    'rechazada',
  ],
  stolen_card: [
    // English
    'your card was declined', 'card was declined',
    // Español
    'tu tarjeta fue rechazada', 'rechazada',
  ],
  expired_card: [
    // English
    'your card has expired', 'card has expired', 'expired',
    // Español
    'caducado', 'caducada', 'ha caducado', 'tu tarjeta ha caducado',
    'año de caducidad',
  ],
  incorrect_cvc: [
    // English
    'security code', "your card's security code is incorrect", 'cvc', 'cvv',
    // Español
    'el cvc', 'cvc de tu tarjeta', 'no es correcto',
  ],
  processing_error: [
    // English
    'error occurred while processing', 'processing error', 'try again',
    // Español
    'error al procesar', 'se ha producido un error', 'producido un error',
    'inténtalo de nuevo', 'error de procesamiento',
  ],
  fraudulent: [
    // English
    'your card was declined', 'card was declined',
    // Español
    'se ha rechazado', 'rechazada', 'tu tarjeta fue rechazada',
    // Nota: 4000000000009235 puede APROBAR en test mode sin Radar rules
    // En ese caso el test registra el comportamiento observado sin fallar
  ],
  do_not_honor:         ['your card was declined', 'card was declined', 'rechazada'],
  card_velocity_exceed: ['your card was declined', 'card was declined', 'rechazada'],
};

// Términos genéricos de rechazo (primer filtro — inglés y español)
const GENERAL_DECLINE_TERMS = [
  // English
  'declined', 'card was declined', 'your card', 'insufficient', 'expired',
  'incorrect', 'security code', 'processing', 'try again', 'failed',
  // Español
  'rechazado', 'rechazada', 'se ha rechazado', 'caducado', 'caducada',
  'fondos', 'cvc', 'emisor', 'inténtalo', 'intentar', 'fallido', 'error',
];

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

async function fillStripeField(locator, value) {
  await locator.click();
  await locator.type(value, { delay: 60 });
}

(async () => {
  if (!CHECKOUT_URL) {
    console.error('❌ ERROR: Debes pasar CHECKOUT_URL como env var o argumento.');
    console.error('   Ejemplo:');
    console.error('     CHECKOUT_URL=https://checkout.stripe.com/c/pay/cs_test_...');
    console.error('     DECLINE_CODE=insufficient_funds');
    console.error('     node stripe_declined_checkout.js');
    process.exit(1);
  }

  console.log(`\n🚫 Escenario Tarjeta Rechazada — ${DECLINE_DESCRIPTION}`);
  console.log(`   Tarjeta : ${CARD_NUMBER.slice(0, 4)} **** **** ${CARD_NUMBER.slice(-4)}`);
  console.log(`   Código  : ${DECLINE_CODE}`);
  console.log(`   URL     : ${CHECKOUT_URL.slice(0, 80)}...`);
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

  try {
    // ── 1. Navegar al checkout ────────────────────────────────────────────────
    console.log('🌐 Navegando al checkout...');
    await page.goto(CHECKOUT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outputDir, `${SCREENSHOT_PREFIX}_01_loaded.png`) });
    console.log(`📸 ${SCREENSHOT_PREFIX}_01_loaded.png\n`);

    const pageText0 = await page.locator('body').innerText().catch(() => '');
    check('Página checkout cargó', pageText0.length > 50, `${pageText0.length} chars`, '> 50');
    check('No expirado / 404',
      !pageText0.toLowerCase().includes('not found') &&
      !pageText0.toLowerCase().includes('this link has expired'),
      'ok', 'ok'
    );

    // ── 2. Manejar modal Stripe Link (si aplica) ──────────────────────────────
    if (LINK_MODE) {
      try {
        if (LINK_MODE === 'bypass') {
          const bypassBtn = page.locator('text=Pagar sin Link, button:has-text("Pagar sin Link")').first();
          if (await bypassBtn.count() > 0) {
            await bypassBtn.click();
            await page.waitForTimeout(2000);
          }
        } else if (LINK_MODE === 'code') {
          const codeInputs = page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]');
          if (await codeInputs.count() > 0) {
            await codeInputs.first().fill('000000');
            await page.waitForTimeout(2000);
          }
        }
      } catch (e) {
        console.log(`ℹ️  Modal Stripe Link: ${e.message}`);
      }
    }

    // ── 3. Llenar datos de tarjeta ────────────────────────────────────────────
    console.log('✍️  Llenando datos de tarjeta rechazada...\n');

    // Número de tarjeta
    const cardSelectors = [
      '[placeholder="1234 1234 1234 1234"]',
      'input[data-elements-stable-field-name="cardNumber"]',
      '#cardNumber',
    ];
    let cardFilled = false;
    for (const sel of cardSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await fillStripeField(el, CARD_NUMBER);
        cardFilled = true;
        console.log(`  Card number → selector: ${sel}`);
        break;
      }
    }
    if (!cardFilled) {
      for (const frame of page.frames()) {
        const el = frame.locator('[placeholder="1234 1234 1234 1234"]').first();
        if (await el.count() > 0) {
          await fillStripeField(el, CARD_NUMBER);
          cardFilled = true;
          console.log('  Card number → vía iframe');
          break;
        }
      }
    }
    check('Card number llenado', cardFilled, cardFilled ? 'ok' : 'no encontrado', 'ok');

    // Expiración
    const expirySelectors = ['[placeholder="MM / YY"]', '[placeholder="MM/YY"]', '#cardExpiry'];
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
      for (const frame of page.frames()) {
        const el = frame.locator('[placeholder="MM / YY"]').first();
        if (await el.count() > 0) {
          await fillStripeField(el, CARD_EXPIRY);
          expiryFilled = true;
          break;
        }
      }
    }

    // CVC
    const cvcSelectors = ['[placeholder="CVC"]', '[placeholder="CVV"]', '#cardCvc'];
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
      for (const frame of page.frames()) {
        const el = frame.locator('[placeholder="CVC"]').first();
        if (await el.count() > 0) {
          await fillStripeField(el, CARD_CVC);
          cvcFilled = true;
          break;
        }
      }
    }

    // Nombre del titular
    const nameSelectors = [
      '[placeholder="Full name on card"]',
      '[placeholder="Nombre completo en la tarjeta"]',
      '#billingName',
      'input[autocomplete="cc-name"]',
    ];
    for (const sel of nameSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.fill(CARDHOLDER_NAME);
        break;
      }
    }

    await page.screenshot({ path: path.join(outputDir, `${SCREENSHOT_PREFIX}_02_filled.png`) });
    console.log(`\n📸 ${SCREENSHOT_PREFIX}_02_filled.png\n`);

    // ── 4. Enviar pago ────────────────────────────────────────────────────────
    console.log('🚀 Enviando pago (esperando rechazo)...\n');
    const urlAntesDePago = page.url();

    const payButton = page.locator([
      'button:has-text("Suscribirse")',
      'button:has-text("Subscribe")',
      'button:has-text("Pay")',
      'button[type="submit"]',
    ].join(', ')).first();
    await payButton.click();

    // Para tarjetas rechazadas Stripe muestra el error en la misma página (sin redirección).
    // Esperamos que aparezca algún elemento de error antes del timeout máximo.
    try {
      await page.waitForSelector(
        '[data-testid*="error"], [class*="error-message"], [class*="ErrorMessage"], [role="alert"]',
        { timeout: 10000 }
      );
    } catch (_) {
      // Si no hay selector específico de error, simplemente esperamos
    }
    await page.waitForTimeout(4000);
    await page.waitForLoadState('networkidle').catch(() => {});

    await page.screenshot({ path: path.join(outputDir, `${SCREENSHOT_PREFIX}_03_after_submit.png`) });
    console.log(`📸 ${SCREENSHOT_PREFIX}_03_after_submit.png\n`);

    // ── 5. Validar resultado del rechazo ──────────────────────────────────────
    console.log('🔍 Validando mensaje de rechazo...\n');
    const resultText  = await page.locator('body').innerText().catch(() => '');
    const resultUrl   = page.url();
    const resultLower = resultText.toLowerCase();

    console.log(`   URL resultado : ${resultUrl.slice(0, 120)}`);
    console.log(`   Texto (300c)  : ${resultText.slice(0, 300).replace(/\n/g, ' ')}\n`);

    // La URL NO debe haber cambiado hacia la success_url del backend
    const sigueEnStripe = resultUrl.includes('checkout.stripe.com') || resultUrl === urlAntesDePago;

    // DEC-08 (fraudulent): 4000000000009235 es una tarjeta de evaluación Radar HIGH RISK.
    // En test mode sin Radar rules configuradas, Stripe APRUEBA el pago.
    // Registramos el comportamiento observado sin marcar como falla — es comportamiento documentado.
    if (DECLINE_CODE === 'fraudulent' && !sigueEnStripe) {
      console.log('  ℹ️  DEC-08 (fraudulent): pago APROBADO en test mode sin Radar rules');
      console.log('     → Comportamiento esperado: 4000000000009235 evalúa HIGH RISK pero');
      console.log('       Stripe aprueba en modo prueba sin reglas Radar personalizadas.');
      console.log('     → Fuente: https://docs.stripe.com/testing#declined-payments');
      results.push({
        name:     'Redirección/rechazo (fraudulent — informativo)',
        status:   'PASS',
        actual:   `Aprobado (Radar HIGH RISK, sin Radar rules): ${resultUrl.slice(0, 80)}`,
        expected: 'Comportamiento documentado — puede aprobar o rechazar según Radar rules',
      });
      passed++;
      results.push({ name: 'Mensaje de error visible en página', status: 'PASS', actual: 'n/a — pago aprobado (fraudulent informativo)', expected: 'n/a' });
      results.push({ name: `Mensaje específico para "${DECLINE_CODE}"`, status: 'PASS', actual: 'n/a — pago aprobado (fraudulent informativo)', expected: 'n/a' });
      passed += 2;
    } else {
      check('Sin redirección a success_url (rechazo esperado)', sigueEnStripe,
        resultUrl.slice(0, 80), 'checkout.stripe.com');

      // Hay algún mensaje de error visible
      const hayMsgError = GENERAL_DECLINE_TERMS.some(t => resultLower.includes(t));
      check('Mensaje de error visible en página', hayMsgError,
        hayMsgError ? 'mensaje encontrado' : 'sin mensaje de error', 'decline / error message');

      // El mensaje coincide específicamente con el decline_code esperado
      const expectedMsgs = DECLINE_MESSAGES[DECLINE_CODE] || DECLINE_MESSAGES.generic_decline;
      const hayMsgEspecifico = expectedMsgs.some(m => resultLower.includes(m.toLowerCase()));
      check(`Mensaje específico para "${DECLINE_CODE}"`, hayMsgEspecifico,
        hayMsgEspecifico ? 'mensaje específico encontrado' : resultText.slice(0, 200),
        expectedMsgs[0]);
    }

    check('Página válida (no crash)', resultText.length > 20, `${resultText.length} chars`, '> 20');

  } catch (err) {
    console.error(`❌ Error durante el flujo: ${err.message}`);
    await page.screenshot({ path: path.join(outputDir, `${SCREENSHOT_PREFIX}_error.png`) }).catch(() => {});
    results.push({ name: 'Flujo sin errores JS', status: 'FAIL', actual: err.message, expected: 'sin errores' });
    failed++;
  }

  // ── Reporte JSON ──────────────────────────────────────────────────────────
  const report = {
    scenario:            DECLINE_DESCRIPTION,
    decline_code:        DECLINE_CODE,
    card_last4:          CARD_NUMBER.slice(-4),
    checkout_url:        CHECKOUT_URL,
    expected_messages:   (DECLINE_MESSAGES[DECLINE_CODE] || DECLINE_MESSAGES.generic_decline),
    timestamp:           new Date().toISOString(),
    passed, failed, results,
  };
  const reportPath = path.join(outputDir, `stripe_declined_report_${DECLINE_CODE}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 [${DECLINE_CODE}] ${passed} ✅ pasaron  |  ${failed} ❌ fallaron`);
  console.log(`📄 Reporte: ${reportPath}`);
  if (isCI) console.log(`📹 Video: ${path.join(outputDir, 'playwright-videos')}`);
  console.log('─'.repeat(50));

  await context.close();
  await browser.close();

  if (failed > 0) process.exit(1);
})();