/**
 * Stripe Dashboard Validator — Customer Balance Recurring
 * Flujo siempre por la lista de pagos:
 *   1. Navega a /test/payments (con account ID)
 *   2. Busca por email del cliente → clic en pago Incompleto
 *   3. En detalle del pago → clic en link de Factura (Objetos relacionados)
 *   4. En la factura → clic "+" (Aplica el pago)
 *   5. Modal: selecciona "Añadir un pago externo" + ingresa "Transferencia" → Siguiente
 *   6. Clic Confirmar
 *   7. Verifica que el pago aparece como Exitoso/Pagada
 *
 * Uso:
 *   node stripe_balance_dashboard_validate.js
 * Env vars:
 *   STRIPE_ACCOUNT_ID  — ID de cuenta Stripe (ej: acct_1TWfcTKyHOFqxcvG)
 *   CUSTOMER_EMAIL     — Email del cliente a buscar en la lista de pagos
 *   CHECKOUT_IDX       — Índice de iteración (para nombres de archivo)
 *   PAYMENT_AMOUNT     — Monto en centavos (opcional, mejora el match en la lista)
 *   SCRIPTS_DIR        — Directorio de salida para screenshots y reporte
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const STRIPE_ACCOUNT_ID = process.env.STRIPE_ACCOUNT_ID || '';
const CUSTOMER_EMAIL    = process.env.CUSTOMER_EMAIL    || '';
const CHECKOUT_IDX      = process.env.CHECKOUT_IDX      || '0';
const PAYMENT_AMOUNT    = process.env.PAYMENT_AMOUNT    || '';
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

function saveReport(invoiceUrl) {
  const report = {
    checkout_idx:   CHECKOUT_IDX,
    payment_type:   'customer_balance_recurring',
    customer_email: CUSTOMER_EMAIL,
    payment_amount: PAYMENT_AMOUNT,
    invoice_url:    invoiceUrl,
    timestamp:      new Date().toISOString(),
    passed, failed, results,
  };
  const reportPath = path.join(outputDir, `stripe_balance_dashboard_report_idx${CHECKOUT_IDX}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Reporte: ${reportPath}`);
}

// Centavos → parte entera para matching en la lista (150000 → "1.500" o "1500")
function amountIntegerPart(centavos) {
  const num = parseInt(centavos, 10);
  if (isNaN(num)) return '';
  return Math.floor(num / 100).toLocaleString('es-MX');
}

async function dismissCookieBanner(page) {
  try {
    const banner = page.locator('[data-testid="cookie-banner"]');
    if (await banner.count() > 0) {
      const acceptBtn = banner.locator('button').filter({ hasText: /acepta|accept|ok|agree|entendido|got it/i }).first();
      if (await acceptBtn.count() > 0) {
        await acceptBtn.click();
        await page.waitForTimeout(600);
        console.log('  🍪 Cookie banner cerrado');
      }
    }
  } catch { /* ignorar si no aparece */ }
}

(async () => {
  if (!fs.existsSync(SESSION_PATH)) {
    console.error('❌ Sin sesión de Stripe guardada. Corre stripe_save_session.js primero.');
    process.exit(1);
  }
  if (!CUSTOMER_EMAIL) {
    console.error('❌ CUSTOMER_EMAIL no definido.');
    process.exit(1);
  }

  const accountSuffix = STRIPE_ACCOUNT_ID ? `/${STRIPE_ACCOUNT_ID}` : '';
  const amountInt     = amountIntegerPart(PAYMENT_AMOUNT);
  const paymentsUrl   = `https://dashboard.stripe.com${accountSuffix}/test/payments`;

  console.log(`\n🔍 Validando Customer Balance Recurring — Stripe Dashboard`);
  console.log(`   Payments URL : ${paymentsUrl}`);
  console.log(`   Email        : ${CUSTOMER_EMAIL}`);
  console.log(`   Amount       : ${PAYMENT_AMOUNT ? `${PAYMENT_AMOUNT} centavos (~${amountInt} MXN)` : '(no especificado)'}`);
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

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 1: Lista de pagos → buscar por email → clic en pago Incompleto
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`🌐 Navegando a lista de pagos: ${paymentsUrl}`);
  await page.goto(paymentsUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  if (page.url().includes('/login')) {
    console.error('❌ Sesión expirada. Renueva con stripe_save_session.js');
    fs.unlinkSync(SESSION_PATH);
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(3000);
  await dismissCookieBanner(page);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_01_loaded_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_01_loaded_idx${CHECKOUT_IDX}.png`);

  // ── Esperar que la tabla cargue ──────────────────────────────────────────
  console.log(`\n🖱️  Esperando tabla de pagos...`);
  await page.waitForSelector('table tbody tr, [role="row"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_02_list_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_02_list_idx${CHECKOUT_IDX}.png`);

  // ── Localizar fila con email + Incompleto usando filter de Playwright ─────
  console.log(`\n🔎 Buscando fila: email="${CUSTOMER_EMAIL}" + estado=Incompleto`);
  let clicked = false;

  // Intento 1: email + Incompleto
  const rowWithBoth = page.locator('tr, [role="row"]')
    .filter({ hasText: CUSTOMER_EMAIL })
    .filter({ hasText: /incompleto|incomplete/i })
    .first();

  if (await rowWithBoth.count() > 0) {
    const txt = await rowWithBoth.innerText().catch(() => '');
    console.log(`   ✅ Fila encontrada (email+Incompleto): ${txt.substring(0, 100).replace(/\n/g, ' ').trim()}`);
    await rowWithBoth.click();
    clicked = true;
  }

  // Intento 2: solo email (sin filtro Incompleto — por si el texto difiere)
  if (!clicked) {
    console.log(`  ⚠️  Sin match email+Incompleto — buscando solo por email...`);
    const rowWithEmail = page.locator('tr, [role="row"]')
      .filter({ hasText: CUSTOMER_EMAIL })
      .first();

    if (await rowWithEmail.count() > 0) {
      const txt = await rowWithEmail.innerText().catch(() => '');
      console.log(`   ✅ Fila encontrada (solo email): ${txt.substring(0, 100).replace(/\n/g, ' ').trim()}`);
      await rowWithEmail.click();
      clicked = true;
    }
  }

  // Intento 3: buscar por href que lleve a un pi_* (payment intent) con email visible
  if (!clicked) {
    console.log(`  ⚠️  Intentando buscar por celda de email en la tabla...`);
    const emailCell = page.locator(`td:has-text("${CUSTOMER_EMAIL}"), [role="cell"]:has-text("${CUSTOMER_EMAIL}")`).first();
    if (await emailCell.count() > 0) {
      const parentRow = emailCell.locator('xpath=ancestor::tr').first();
      if (await parentRow.count() > 0) {
        await parentRow.click();
        clicked = true;
        console.log(`   ✅ Fila encontrada vía celda email`);
      }
    }
  }

  check('Fila de pago Incompleto encontrada y clickeada', clicked,
    clicked ? 'ok' : 'no encontrada', `email=${CUSTOMER_EMAIL} + Incompleto`);

  if (!clicked) {
    console.error('❌ No se pudo identificar el pago en la lista. Abortando.');
    saveReport('');
    await browser.close();
    process.exit(1);
  }

  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_03_payment_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_03_payment_idx${CHECKOUT_IDX}.png`);

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 2: Detalle del pago → clic en link de Factura (Objetos relacionados)
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n📄 Buscando link de Factura (Objetos relacionados)...`);
  const invoiceLinkEl    = page.locator('[data-testid="invoice-link"]').first();
  const invoiceLinkFound = await invoiceLinkEl.count() > 0;

  check('Link de Factura encontrado en detalle de pago', invoiceLinkFound,
    invoiceLinkFound ? 'ok' : 'no encontrado', 'data-testid="invoice-link"');

  if (!invoiceLinkFound) {
    console.error('❌ Link de factura no encontrado en "Objetos relacionados".');
    saveReport('');
    await browser.close();
    process.exit(1);
  }

  const invoiceHref = await invoiceLinkEl.getAttribute('href');
  const invoiceUrl  = invoiceHref && invoiceHref.startsWith('http')
    ? invoiceHref
    : `https://dashboard.stripe.com${invoiceHref}`;

  console.log(`   Link de factura: ${invoiceUrl}`);

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 3: Navegar a la factura en el dashboard
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n📑 Navegando a la factura...`);
  await page.goto(invoiceUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await dismissCookieBanner(page);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_04_invoice_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_04_invoice_idx${CHECKOUT_IDX}.png`);

  const invoiceBodyText = await page.locator('body').innerText().catch(() => '');
  const invoiceLoaded   = /pagos|payments|factura|invoice/i.test(invoiceBodyText);
  check('Página de factura cargada', invoiceLoaded, invoiceLoaded ? 'ok' : 'contenido inesperado', 'Pagos/Factura');

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 4: Clic en "+" → Aplica el pago
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n➕ Haciendo clic en "Aplica el pago" (+)...`);

  const applySelectors = [
    '[data-db-analytics-name="invoice_payments_module_apply_payment_button"]',
    '[aria-label="Aplica el pago"]',
    '[aria-label="Apply payment"]',
  ];

  let applyClicked = false;
  for (const sel of applySelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      applyClicked = true;
      console.log(`   ✅ Botón encontrado: ${sel}`);
      break;
    }
  }

  check('Botón "Aplica el pago" (+) clickeado', applyClicked,
    applyClicked ? 'ok' : 'no encontrado', 'invoice_payments_module_apply_payment_button');

  if (!applyClicked) {
    console.error('❌ No se encontró el botón de aplicar pago.');
    saveReport(invoiceUrl);
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_05_modal_p1_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_05_modal_p1_idx${CHECKOUT_IDX}.png`);

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 5: Modal Step 1 — Seleccionar "Añadir un pago externo" → Siguiente
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n📋 [Step 1] Seleccionando "Añadir un pago externo"...`);
  await dismissCookieBanner(page);

  let radioSelected = false;
  for (const sel of ['input[type="radio"][value="out_of_band_payment"]', 'input[name="paymentAllocationType"][value="out_of_band_payment"]']) {
    const radio = page.locator(sel).first();
    if (await radio.count() > 0) {
      if (!await radio.isChecked()) await radio.click();
      radioSelected = true;
      break;
    }
  }
  check('Radio "Añadir un pago externo" seleccionado', radioSelected,
    radioSelected ? 'ok' : 'no encontrado', 'radio[value="out_of_band_payment"]');

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_06_modal_p1_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_06_modal_p1_idx${CHECKOUT_IDX}.png`);

  console.log(`\n▶️  [Step 1] Haciendo clic en "Siguiente"...`);
  await dismissCookieBanner(page);
  let nextClicked = false;
  for (const sel of [
    'button:has-text("Siguiente")', '[role="button"]:has-text("Siguiente")',
    'button:has-text("Next")',      '[role="button"]:has-text("Next")',
    'a:has-text("Siguiente")',      'a:has-text("Next")',
  ]) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) { await btn.click({ force: true }); nextClicked = true; break; }
  }
  if (!nextClicked) {
    const btn = page.locator('text=Siguiente').first();
    if (await btn.count() > 0) { await btn.click({ force: true }); nextClicked = true; }
  }
  check('Botón "Siguiente" clickeado', nextClicked, nextClicked ? 'ok' : 'no encontrado', '"Siguiente"');

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 6: Modal Step 2 — Ingresar "Transferencia" → Confirmar
  // ══════════════════════════════════════════════════════════════════════════
  await page.waitForTimeout(2000);
  await dismissCookieBanner(page);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_07_modal_p2_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_07_modal_p2_idx${CHECKOUT_IDX}.png`);

  const step2Text = await page.locator('body').innerText().catch(() => '');
  const isStep2   = /registra un pago|paso 2|record a payment|step 2/i.test(step2Text);
  check('Modal en Paso 2: "Registra un pago fuera de Stripe"', isStep2,
    isStep2 ? 'Paso 2 visible' : 'no visible', 'Paso 2');

  console.log(`\n⌨️  [Step 2] Ingresando "Transferencia" en Tipo de pago...`);
  let tipoFilled = false;
  for (const sel of ['input[name="outOfBandPaymentType"]', 'input[placeholder*="efectivo"]', 'input[placeholder*="ejemplo"]', 'input[placeholder*="cash"]']) {
    const input = page.locator(sel).first();
    if (await input.count() > 0) {
      await input.clear();
      await input.fill('Transferencia');
      tipoFilled = true;
      break;
    }
  }
  check('"Transferencia" ingresado en Tipo de pago', tipoFilled,
    tipoFilled ? 'ok' : 'campo no encontrado', 'input[name="outOfBandPaymentType"]');

  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_08_modal_filled_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_08_modal_filled_idx${CHECKOUT_IDX}.png`);

  console.log(`\n✅ [Step 2] Haciendo clic en "Confirmar"...`);
  await dismissCookieBanner(page);
  let confirmClicked = false;
  for (const sel of [
    '[data-testid="external-payment-submit-button"]',
    'button:has-text("Confirmar")', '[role="button"]:has-text("Confirmar")',
    'button:has-text("Confirm")',   '[role="button"]:has-text("Confirm")',
    'a:has-text("Confirmar")',
  ]) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) { await btn.click({ force: true }); confirmClicked = true; break; }
  }
  check('Botón "Confirmar" clickeado', confirmClicked, confirmClicked ? 'ok' : 'no encontrado', '"Confirmar"');

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 8: Verificar estado final — Exitoso / Pagada
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n⏳ Esperando actualización de estado...`);
  await page.waitForTimeout(4000);

  try {
    await page.waitForFunction(() => {
      const t = document.body.innerText.toLowerCase();
      return t.includes('exitoso') || t.includes('pagada') || t.includes('paid') || t.includes('succeeded');
    }, { timeout: 15000 });
    console.log('  ✅ Estado actualizado');
  } catch {
    console.log('  ⚠️  Timeout esperando "Exitoso/Pagada" — continuando con screenshot');
  }

  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_08_result_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_08_result_idx${CHECKOUT_IDX}.png`);

  const finalText = await page.locator('body').innerText().catch(() => '');
  const esPagada  = /pagada|paid/i.test(finalText);
  const esExitoso = /exitoso|succeeded|successful/i.test(finalText);
  const estadoOK  = esPagada || esExitoso;

  check('Factura marcada como Pagada', esPagada, esPagada ? 'Pagada' : 'no encontrado', 'Pagada');
  check('Pago aparece como Exitoso', esExitoso, esExitoso ? 'Exitoso' : 'no encontrado', 'Exitoso');
  check('Estado final correcto (Pagada o Exitoso)', estadoOK, estadoOK ? 'ok' : 'no encontrado', 'Pagada | Exitoso');

  // ══════════════════════════════════════════════════════════════════════════
  // REPORTE
  // ══════════════════════════════════════════════════════════════════════════
  saveReport(invoiceUrl);

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`📊 Balance Dashboard: ${passed} ✅  |  ${failed} ❌`);
  if (isCI) console.log(`📹 Video: ${path.join(outputDir, 'playwright-videos')}`);
  console.log('─'.repeat(52));

  await context.close();
  await browser.close();

  if (failed > 0) process.exit(1);
})();