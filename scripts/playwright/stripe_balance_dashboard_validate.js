/**
 * Stripe Dashboard Validator — Customer Balance Recurring
 * Flujo vía /test/customers:
 *   1. Navega a /test/customers
 *   2. Busca el email en el campo "Search by name, email, etc."
 *   3. Clic en el customer encontrado → página de detalle
 *   4. Scroll a "Métodos de pago" → clic en "+" → "Añadir fondos al saldo disponible"
 *   5. Modal: ingresa el importe en MXN → clic "Añadir fondos"
 *   6. Verifica que el modal se cerró sin errores
 *
 * Env vars:
 *   STRIPE_ACCOUNT_ID  — ID de cuenta Stripe (ej: acct_1TWfcTKyHOFqxcvG)
 *   CUSTOMER_EMAIL     — Email del cliente
 *   PAYMENT_AMOUNT     — Monto en centavos (ej: 5000 = 50 MXN)
 *   CHECKOUT_IDX       — Índice de iteración (para nombres de archivo)
 *   SCRIPTS_DIR        — Directorio de salida para screenshots y reporte
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const STRIPE_ACCOUNT_ID = process.env.STRIPE_ACCOUNT_ID || '';
const CUSTOMER_EMAIL    = process.env.CUSTOMER_EMAIL    || '';
const PAYMENT_AMOUNT    = process.env.PAYMENT_AMOUNT    || '';
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
    console.error(`  ❌ ${name} | actual: "${actual}" | esperado: "${expected}"`);
    results.push({ name, status: 'FAIL', actual: String(actual), expected: String(expected) });
    failed++;
  }
}

function saveReport(customerUrl) {
  const report = {
    checkout_idx:   CHECKOUT_IDX,
    payment_type:   'customer_balance_recurring',
    customer_email: CUSTOMER_EMAIL,
    payment_amount: PAYMENT_AMOUNT,
    customer_url:   customerUrl,
    timestamp:      new Date().toISOString(),
    passed, failed, results,
  };
  const reportPath = path.join(outputDir, `stripe_balance_dashboard_report_idx${CHECKOUT_IDX}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Reporte: ${reportPath}`);
}

// centavos → string MXN (1000 → "10", 1550 → "15.50")
function centavosToMXN(centavos) {
  const num = parseInt(centavos, 10);
  if (isNaN(num)) return '';
  const mxn = num / 100;
  return Number.isInteger(mxn) ? String(mxn) : mxn.toFixed(2);
}

async function dismissCookieBanner(page) {
  try {
    // Patrón 1: banner con data-testid (Stripe headless)
    const banner = page.locator('[data-testid="cookie-banner"]');
    if (await banner.count() > 0) {
      const btn = banner.locator('button').filter({ hasText: /acepta|accept|ok|agree|entendido|got it/i }).first();
      if (await btn.count() > 0) {
        await btn.click({ force: true });
        await page.waitForTimeout(600);
        console.log('  🍪 Cookie banner cerrado (testid)');
        return;
      }
    }
    // Patrón 2: "Accept all" / "Aceptar todo" suelto en la página (inglés)
    const acceptAll = page.locator('button:has-text("Accept all"), button:has-text("Aceptar todo"), button:has-text("Aceptar todas")').first();
    if (await acceptAll.count() > 0) {
      await acceptAll.click({ force: true });
      await page.waitForTimeout(600);
      console.log('  🍪 Cookie banner cerrado (Accept all)');
    }
  } catch { }
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
  const customersUrl  = `https://dashboard.stripe.com${accountSuffix}/test/customers`;
  const amountMXN     = centavosToMXN(PAYMENT_AMOUNT);

  console.log(`\n🔍 Validando Customer Balance Recurring — Stripe Dashboard`);
  console.log(`   Customers URL : ${customersUrl}`);
  console.log(`   Email         : ${CUSTOMER_EMAIL}`);
  console.log(`   Amount        : ${PAYMENT_AMOUNT ? `${PAYMENT_AMOUNT} centavos (${amountMXN} MXN)` : '(no especificado)'}`);
  console.log(`   Idx           : ${CHECKOUT_IDX}`);
  console.log(`   Ambiente      : ${isCI ? 'CI/headless' : 'local/headed'}\n`);

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
  let customerUrl = '';

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 1: Navegar a lista de customers
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`🌐 Navegando a: ${customersUrl}`);
  await page.goto(customersUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  if (page.url().includes('/login')) {
    console.error('❌ Sesión expirada. Renueva con stripe_save_session.js');
    fs.unlinkSync(SESSION_PATH);
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(3000);
  await dismissCookieBanner(page);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_01_customers_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_01_customers_idx${CHECKOUT_IDX}.png`);

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 2: Buscar customer por email
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n🔎 Buscando por email: ${CUSTOMER_EMAIL}`);

  let searchFilled = false;
  for (const sel of [
    'input[placeholder*="Search by name"]',
    'input[placeholder*="name, email"]',
    'input[placeholder*="Search"]',
    'input[type="search"]',
    '[data-testid="search-input"]',
  ]) {
    const input = page.locator(sel).first();
    if (await input.count() > 0) {
      await input.click();
      await input.fill(CUSTOMER_EMAIL);
      // Esperar que el debounce de búsqueda dispare (~300ms) antes del AJAX
      await page.waitForTimeout(800);
      // Ahora sí esperar networkidle para que el filtrado AJAX termine
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);
      searchFilled = true;
      console.log(`   Campo búsqueda: ${sel}`);
      break;
    }
  }

  check('Campo de búsqueda encontrado y rellenado', searchFilled,
    searchFilled ? 'ok' : 'no encontrado', 'input[placeholder*="Search by name"]');

  if (!searchFilled) {
    saveReport('');
    await browser.close();
    process.exit(1);
  }

  // Esperar a que los resultados de búsqueda aparezcan en la tabla
  await page.waitForSelector(
    `tr:has-text("${CUSTOMER_EMAIL}"), [role="row"]:has-text("${CUSTOMER_EMAIL}")`,
    { timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_02_search_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_02_search_idx${CHECKOUT_IDX}.png`);

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 3: Clic en el customer encontrado
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n🖱️  Haciendo clic en el customer...`);
  let customerClicked = false;

  const rowWithEmail = page.locator('tr, [role="row"]').filter({ hasText: CUSTOMER_EMAIL }).first();
  if (await rowWithEmail.count() > 0) {
    await rowWithEmail.click();
    customerClicked = true;
    console.log(`   ✅ Fila con email encontrada y clickeada`);
  }

  if (!customerClicked) {
    const emailCell = page.locator(`td:has-text("${CUSTOMER_EMAIL}"), [role="cell"]:has-text("${CUSTOMER_EMAIL}")`).first();
    if (await emailCell.count() > 0) {
      await emailCell.click();
      customerClicked = true;
      console.log(`   ✅ Celda email encontrada y clickeada`);
    }
  }

  check('Customer encontrado y clickeado', customerClicked,
    customerClicked ? 'ok' : 'no encontrado', `email=${CUSTOMER_EMAIL}`);

  if (!customerClicked) {
    saveReport('');
    await browser.close();
    process.exit(1);
  }

  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await dismissCookieBanner(page);

  customerUrl = page.url();
  console.log(`   URL customer: ${customerUrl}`);

  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_03_customer_detail_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_03_customer_detail_idx${CHECKOUT_IDX}.png`);

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 4: Scroll a "Métodos de pago" → clic en "+"
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n🔽 Buscando sección "Métodos de pago"...`);

  const pmSection = page.locator('text=/métodos de pago|payment methods/i').first();
  if (await pmSection.count() > 0) {
    await pmSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    console.log(`   ✅ Sección encontrada — scrolled`);
  } else {
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(1000);
    console.log(`   ⚠️  Texto no encontrado — scroll manual a 600px`);
  }

  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_04_pm_section_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_04_pm_section_idx${CHECKOUT_IDX}.png`);

  console.log(`\n➕ Haciendo clic en "+" (Añade un método de pago)...`);
  await dismissCookieBanner(page);
  let addBtnClicked = false;
  for (const sel of [
    '[aria-label="Añade un método de pago"]',
    '[aria-label="Add a payment method"]',
    '[aria-label*="método de pago"]',
    '[aria-label*="payment method"]',
  ]) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      await btn.scrollIntoViewIfNeeded();
      await dismissCookieBanner(page);
      await btn.hover();
      await page.waitForTimeout(400);
      await btn.click();
      addBtnClicked = true;
      console.log(`   ✅ Botón "+" encontrado: ${sel}`);
      break;
    }
  }

  check('Botón "+" clickeado', addBtnClicked,
    addBtnClicked ? 'ok' : 'no encontrado', '[aria-label="Añade un método de pago"]');

  if (!addBtnClicked) {
    saveReport(customerUrl);
    await browser.close();
    process.exit(1);
  }

  // Esperar a que el texto del menú aparezca (EN: "Fund cash balance" / ES: "Añadir fondos")
  const menuOpened = await page.waitForFunction(
    () => {
      const t = document.body.innerText.toLowerCase();
      return t.includes('fund cash balance') || t.includes('añadir fondos al saldo');
    },
    { timeout: 5000 }
  ).then(() => true).catch(() => false);

  // Fallback teclado: si el dropdown no abrió, intentar focus + Space
  if (!menuOpened) {
    console.log('   ⚠️  Dropdown no abrió con click — intentando teclado (focus + Space)...');
    for (const sel of [
      '[aria-label="Añade un método de pago"]',
      '[aria-label="Add a payment method"]',
      '[aria-label*="payment method"]',
    ]) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0) {
        await btn.focus();
        await page.waitForTimeout(300);
        await page.keyboard.press('Space');
        break;
      }
    }
    await page.waitForFunction(
      () => {
        const t = document.body.innerText.toLowerCase();
        return t.includes('fund cash balance') || t.includes('añadir fondos al saldo');
      },
      { timeout: 5000 }
    ).catch(() => console.log('   ⚠️  Dropdown no abrió con teclado tampoco'));
  }

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_05_menu_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_05_menu_idx${CHECKOUT_IDX}.png`);

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 5: Seleccionar "Fund cash balance (test only)"
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n📋 Seleccionando "Fund cash balance (test only)"...`);
  let optionClicked = false;

  // Intento 1: getByText con el texto exacto del menú
  for (const text of ['Fund cash balance', 'Añadir fondos al saldo disponible', 'Añadir fondos al saldo']) {
    const el = page.getByText(text, { exact: false }).first();
    if (await el.count() > 0) {
      await el.click();
      optionClicked = true;
      console.log(`   ✅ Opción encontrada via getByText: "${text}"`);
      break;
    }
  }

  // Intento 2: locator con has-text
  if (!optionClicked) {
    for (const sel of [
      'a:has-text("Fund cash balance")',
      'li:has-text("Fund cash balance")',
      'button:has-text("Fund cash balance")',
      '[role="menuitem"]:has-text("Fund cash balance")',
      'a:has-text("Añadir fondos al saldo")',
      'li:has-text("Añadir fondos al saldo")',
    ]) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.click();
        optionClicked = true;
        console.log(`   ✅ Opción encontrada: ${sel}`);
        break;
      }
    }
  }

  // Intento 3: fallback amplio — cualquier enlace/item con "fund" o "fondos"
  if (!optionClicked) {
    const fallback = page.locator('a, li, button, span')
      .filter({ hasText: /fund cash|añadir fondos/i })
      .first();
    if (await fallback.count() > 0) {
      await fallback.click();
      optionClicked = true;
      console.log(`   ✅ Opción encontrada via fallback`);
    }
  }

  check('"Fund cash balance" seleccionado', optionClicked,
    optionClicked ? 'ok' : 'no encontrado', 'Fund cash balance (test only)');

  if (!optionClicked) {
    saveReport(customerUrl);
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(1500);
  await dismissCookieBanner(page);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_06_modal_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_06_modal_idx${CHECKOUT_IDX}.png`);

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 6: Ingresar el importe en el modal
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n⌨️  Ingresando importe: ${amountMXN || '(no especificado)'} MXN...`);
  let amountFilled = false;

  if (amountMXN) {
    for (const sel of [
      'input.TextInput-element',
      'input[aria-invalid="false"]',
      'input[type="text"][class*="Input"]',
      'input[class*="TextInput"]',
    ]) {
      const input = page.locator(sel).first();
      if (await input.count() > 0) {
        await input.click({ clickCount: 3 });
        await input.fill(amountMXN);
        amountFilled = true;
        console.log(`   ✅ Importe ingresado (${amountMXN}) en: ${sel}`);
        break;
      }
    }
  } else {
    console.log(`   ⚠️  PAYMENT_AMOUNT no definido — campo de importe no rellenado`);
    amountFilled = true;
  }

  check(`Importe ingresado (${amountMXN || 'sin valor'} MXN)`, amountFilled,
    amountFilled ? 'ok' : 'campo no encontrado', 'input importe');

  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_07_modal_filled_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_07_modal_filled_idx${CHECKOUT_IDX}.png`);

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 7: Clic en "Añadir fondos"
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n✅ Haciendo clic en "Añadir fondos"...`);
  await dismissCookieBanner(page);
  let confirmClicked = false;
  for (const sel of [
    'button:has-text("Añadir fondos")',
    '[role="button"]:has-text("Añadir fondos")',
    'button:has-text("Add funds")',
    '[role="button"]:has-text("Add funds")',
    // excluir el botón "+" del menú que también dice "Add funds" en contexto diferente
    'dialog button:has-text("Add funds")',
    '[role="dialog"] button:has-text("Añadir fondos")',
  ]) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      await btn.click();
      confirmClicked = true;
      console.log(`   ✅ Botón "Añadir fondos" clickeado: ${sel}`);
      break;
    }
  }

  check('Botón "Añadir fondos" clickeado', confirmClicked,
    confirmClicked ? 'ok' : 'no encontrado', '"Añadir fondos"');

  // ══════════════════════════════════════════════════════════════════════════
  // PASO 8: Verificar que el modal se cerró (fondos añadidos)
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n⏳ Esperando confirmación...`);
  await page.waitForTimeout(3000);

  try {
    await page.waitForFunction(
      () => !document.querySelector('[role="dialog"][data-testid="modal"], [data-testid="add-funds-modal"]'),
      { timeout: 10000 }
    );
    console.log('  ✅ Modal cerrado');
  } catch {
    console.log('  ⚠️  Modal aún visible — continuando con screenshot');
  }

  await page.screenshot({ path: path.join(outputDir, `stripe_balance_dash_08_result_idx${CHECKOUT_IDX}.png`) });
  console.log(`📸 stripe_balance_dash_08_result_idx${CHECKOUT_IDX}.png`);

  const finalBody   = await page.locator('body').innerText().catch(() => '');
  const hasError    = /error|failed|falló|inválido|invalid/i.test(finalBody);
  const modalClosed = (await page.locator('[role="dialog"]').count()) === 0;

  check('Sin errores visibles en la página', !hasError, hasError ? 'error detectado' : 'ok', 'sin errores');
  check('Modal cerrado (operación completada)', modalClosed, modalClosed ? 'cerrado' : 'aún abierto', 'modal cerrado');

  saveReport(customerUrl);

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`📊 Balance Dashboard: ${passed} ✅  |  ${failed} ❌`);
  if (isCI) console.log(`📹 Video: ${path.join(outputDir, 'playwright-videos')}`);
  console.log('─'.repeat(52));

  await context.close();
  await browser.close();

  if (failed > 0) process.exit(1);
})();