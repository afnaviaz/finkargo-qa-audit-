const { chromium } = require('playwright');
const path = require('path');

const PAYMENT_LINK = process.env.PAYMENT_LINK || process.argv[2];

if (!PAYMENT_LINK) {
    console.error('❌ ERROR: No se proporcionó PAYMENT_LINK.');
    process.exit(1);
}

const isCI = process.env.CI === 'true';
const outputDir = process.env.SCRIPTS_DIR || '.';

(async () => {
    const browser = await chromium.launch({
        headless: isCI,
        args: isCI ? [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,720'
        ] : []
    });

    const contextOptions = {
        viewport: { width: 1280, height: 720 },
        ...(isCI ? {
            recordVideo: {
                dir: path.join(outputDir, 'playwright-videos'),
                size: { width: 1280, height: 720 }
            }
        } : {})
    };

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    console.log(`🌐 Navegando a: ${PAYMENT_LINK}`);
    await page.goto(PAYMENT_LINK, { waitUntil: 'networkidle' });
    await page.waitForLoadState('domcontentloaded');

    // Screenshot del link abierto
    await page.screenshot({ path: path.join(outputDir, 'rejected_open.png') });
    console.log('📸 Screenshot tomado. Cerrando sin llenar formulario...');

    // Cerrar sin hacer nada — simula abandono del pago
    await context.close();
    await browser.close();
    console.log('✅ Playwright REJECTED: link abierto y cerrado sin completar.');
    if (isCI) console.log(`📹 Video guardado en: ${path.join(outputDir, 'playwright-videos')}`);
})();
