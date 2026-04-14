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

    // --- Llenar Nombre del Pagador ---
    //await page.waitForSelector('input[placeholder*="Nombre"], input[name*="name"], input[id*="name"]');
    //await page.fill('input[placeholder*="Nombre"], input[name*="name"]', TEST_DATA.nombre);
    await page.waitForSelector('#mat-input-0')
    await page.fill('#mat-input-0')


    // --- Llenar Correo Electrónico ---
    await page.fill('input[type="email"], input[placeholder*="correo"], input[placeholder*="email"]', TEST_DATA.correo);

    // --- Seleccionar Tipo de Documento ---
    await page.selectOption('select', TEST_DATA.tipoDocumento)
        .catch(async () => {
            await page.click('[class*="select"], [class*="dropdown"]');
            await page.click(`text=${TEST_DATA.tipoDocumento}`);
        });

    // --- Llenar ID del Documento ---
    await page.fill('input[placeholder*="identificaci"], input[placeholder*="documento"]', TEST_DATA.idDocumento);

    // --- Llenar Teléfono ---
    await page.fill('input[placeholder*="tel"], input[type="tel"], input[placeholder*="Cel"]', TEST_DATA.telefono);

    // --- Screenshot antes de enviar ---
    await page.screenshot({ path: path.join(outputDir, 'before_submit.png') });

    // --- Continuar al método de pago ---
    await page.click('button:has-text("Selecciona un método de pago")');

    console.log('⏳ Formulario enviado. Esperando siguiente paso...');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(outputDir, 'after_submit.png') });

    await context.close(); // cierra contexto para que el video se guarde
    await browser.close();
    console.log('✅ Playwright: flujo de pago completado exitosamente');
    if (isCI) console.log(`📹 Video guardado en: ${path.join(outputDir, 'playwright-videos')}`);
})();
