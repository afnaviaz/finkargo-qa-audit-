const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSION_PATH      = path.join(__dirname, '.stripe-session.json');
const PROFILE_DIR       = path.join(__dirname, '.chrome-profile');
const STRIPE_ACCOUNT_ID = process.env.STRIPE_ACCOUNT_ID || '';
const GOOGLE_EMAIL      = process.env.STRIPE_EMAIL    || '';
const GOOGLE_PASSWORD   = process.env.STRIPE_PASSWORD || '';

const redirectPath = STRIPE_ACCOUNT_ID
  ? `%2F${STRIPE_ACCOUNT_ID}%2Ftest%2Fpayments`
  : '%2Ftest%2Fpayments';

const stripeLoginUrl = `https://dashboard.stripe.com/login?redirect=${redirectPath}`;

(async () => {
  const firstTime = !fs.existsSync(PROFILE_DIR);

  console.log('');
  console.log('🔐 Abriendo Stripe login...');
  if (firstTime) {
    console.log('   → Primera vez: haz login con Google manualmente en el browser');
  } else {
    console.log('   → Perfil Google detectado: seleccionando cuenta automáticamente');
  }
  console.log('');

  // Perfil persistente: guarda la sesión de Google entre ejecuciones
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ['--window-size=1280,800'],
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  await page.goto(stripeLoginUrl, { waitUntil: 'domcontentloaded' });

  // Click en "Continuar con Google"
  console.log('🖱️  Haciendo click en "Continuar con Google"...');
  await page.locator('#continue_with_google').waitFor({ timeout: 15000 });
  await page.locator('#continue_with_google').click();

  // Esperar a que Google cargue su página (account chooser o sign-in)
  await page.waitForTimeout(2000);

  // Caso A: aparece selector de cuenta (sesión Google ya guardada) → click automático
  const accountChooser = page.locator('li.aZvCDf:nth-child(1) > div:nth-child(1)');
  const hasChooser = await accountChooser.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);

  if (hasChooser) {
    console.log('🖱️  Seleccionando cuenta Google (automático)...');
    await accountChooser.click();

  } else {
    // Caso B: Google pide email → insertar automáticamente y click Siguiente
    const emailInput = page.locator('input[type="email"], #identifierId');
    const hasEmailForm = await emailInput.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);

    if (hasEmailForm && GOOGLE_EMAIL) {
      console.log(`📧 Insertando email: ${GOOGLE_EMAIL}`);
      await emailInput.fill(GOOGLE_EMAIL);
      await page.waitForTimeout(500);

      // Click en "Siguiente" / "Next"
      const nextBtn = page.locator('#identifierNext').first();
      await nextBtn.waitFor({ timeout: 5000 });
      await nextBtn.click();
      console.log('🖱️  Click en Siguiente');

      // Esperar que Google navegue a la página de contraseña
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Esperar campo de contraseña y llenarlo automáticamente
      const passwordInput = page.locator('input[type="password"], [name="Passwd"]');
      const hasPassword = await passwordInput.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);

      if (hasPassword && GOOGLE_PASSWORD) {
        console.log('🔑 Ingresando contraseña...');
        await passwordInput.fill(GOOGLE_PASSWORD);
        await page.waitForTimeout(500);
        const passwordNext = page.locator('#passwordNext').first();
        await passwordNext.waitFor({ timeout: 5000 });
        await passwordNext.click();
        console.log('🖱️  Click en Siguiente (contraseña)');
      } else {
        console.log('   → Ingresa tu contraseña manualmente en el browser');
      }
    } else {
      console.log('⚠️  Completa el login de Google manualmente en el browser (tienes 2 minutos)');
    }
  }

  // Esperar redirección al dashboard de Stripe
  console.log('⏳ Esperando redirección al dashboard...');
  const maxWait = 120;
  let elapsed = 0;
  let loggedIn = false;

  while (elapsed < maxWait) {
    try {
      const currentUrl = page.url();
      const parsedUrl = new URL(currentUrl);
      const onDashboard = parsedUrl.hostname === 'dashboard.stripe.com' &&
                          !parsedUrl.pathname.includes('/login');
      if (onDashboard) {
        loggedIn = true;
        console.log(`✅ Login exitoso en ${elapsed}s — URL: ${currentUrl}`);
        break;
      }
      await page.waitForTimeout(1000);
    } catch (e) {
      if (e.message.includes('closed')) {
        console.error('\n❌ El browser fue cerrado antes de completar el login.');
        console.error('   → Vuelve a correr el script y NO cierres el browser hasta ver "✅ Listo"');
        process.exit(1);
      }
    }
    elapsed++;
  }

  if (!loggedIn) {
    console.error(`❌ No redirigió al dashboard en ${maxWait}s. URL actual: ${page.url()}`);
    await context.close();
    process.exit(1);
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Guardar sesión de Stripe para stripe_oxxo_validation.js
  await context.storageState({ path: SESSION_PATH });
  console.log(`💾 Sesión Stripe guardada: ${SESSION_PATH}`);
  console.log('✅ Listo. Ahora puedes correr stripe_oxxo_validation.js');

  await context.close();
})();