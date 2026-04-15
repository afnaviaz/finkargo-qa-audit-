const { chromium } = require('playwright');
const path = require('path');

const PAYMENT_LINK = process.env.PAYMENT_LINK || process.argv[2];

if (!PAYMENT_LINK) {
    console.error('❌ ERROR: No se proporcionó PAYMENT_LINK. Uso: node payment_flow.js <url>');
    process.exit(1);
}

const TEST_DATA = {
    nombre: "PRUEBA AUTOMATIZADA",
    correo: "prueba@gmail.com",
    tipoDocumento: "NIT",
    idDocumento: "123456789",
    telefono: "+573044603462"
};

const isCI = process.env.CI === 'true';
const outputDir = process.env.SCRIPTS_DIR || '.';

(async () => {
    const browser = await chromium.launch({
        headless: isCI
    });

    // En CI graba video; localmente no hace falta
    const context = await browser.newContext(isCI ? {
        recordVideo: {
            dir: path.join(outputDir, 'playwright-videos'),
            size: { width: 1280, height: 720 }
        }
    } : {});

    const page = await context.newPage();

    console.log(`🌐 Navegando a: ${PAYMENT_LINK}`);
    await page.goto(PAYMENT_LINK, { waitUntil: 'networkidle' });
    
    // --- ESPERA INICIAL ---
    await page.waitForLoadState('domcontentloaded');
    
    //await page.waitForTimeout(2000); // debug temporal
    //await page.fill('#mat-input-0', TEST_DATA.nombre);
    
    // --- Llenar Nombre del Pagador ---
    await page.locator('input[formcontrolname="payerName"]').fill(TEST_DATA.nombre);


    // --- Llenar Correo Electrónico ---
    await page.locator('input[formcontrolname="payerEmail"]').fill(TEST_DATA.correo);
    //await page.fill('input[type="email"], input[placeholder*="correo"], input[placeholder*="email"]', TEST_DATA.correo);

    // --- Seleccionar Tipo de Documento ---
    await page.locator('.mat-mdc-select-trigger').click();
    // Esperar a que el panel del dropdown esté visible antes de hacer click
    await page.waitForSelector('mat-option', { state: 'visible' });
    await page.locator('mat-option').filter({ hasText: /^NIT$/ }).click({ force: true });
    
    /*await page.selectOption('select', TEST_DATA.tipoDocumento)
        .catch(async () => {
            await page.click('[class*="select"], [class*="dropdown"]');
            await page.click(`text=${TEST_DATA.tipoDocumento}`);
        });*/

    // --- Llenar ID del Documento ---
    await page.locator('input[formcontrolname="payerDocumentId"]').fill(TEST_DATA.idDocumento);
    //await page.fill('input[placeholder*="identificaci"], input[placeholder*="documento"]', TEST_DATA.idDocumento);

    // --- Llenar Teléfono ---
    await page.locator('input[formcontrolname="payerCellphone"]').fill(TEST_DATA.telefono);
    //await page.fill('input[placeholder*="tel"], input[type="tel"], input[placeholder*="Cel"]', TEST_DATA.telefono);

    // --- Screenshot antes de enviar ---
    await page.screenshot({ path: path.join(outputDir, 'before_submit.png') });
    //await page.screenshot({ path: path.join(outputDir, 'before_submit.png') });

    // =====================
    // 💳 FLUJO DE PAGO
    // =====================

    // Botón: Selecciona método de pago
    await page.getByRole('button', { name: /selecciona un método de pago/i }).click();
    //await page.click('button:has-text("Selecciona un método de pago")');

    // Click en PSE (por alt de imagen)
    await page.locator('img[alt="PSE"]').click();

    // Botón continuar
    await page.getByRole('button', { name: /continuar/i }).click();

    console.log('⏳ Formulario enviado. Esperando siguiente paso...');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(outputDir, 'after_submit.png') });


    // Seleccionar banco
    await page.getByText('BANCO DE BOGOTA', { exact: false }).first().click();
    // Botón final
    await page.getByRole('button', { name: /ir a banco de bogota/i }).click();
    await page.waitForTimeout(1000);
    await context.close(); // cierra contexto para que el video se guarde
    await browser.close();
    console.log('✅ Playwright: flujo de pago completado exitosamente');
    if (isCI) console.log(`📹 Video guardado en: ${path.join(outputDir, 'playwright-videos')}`);
})();
