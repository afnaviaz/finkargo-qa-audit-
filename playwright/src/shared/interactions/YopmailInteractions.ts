import { Page, BrowserContext } from 'playwright-core';

// Palabras comunes que podrían matchear accidentalmente el regex alfanumérico
const FALSOS_POSITIVOS = new Set([
  'false', 'true', 'null', 'undefined', 'error', 'email', 'click',
  'inbox', 'spam', 'yopmail', 'login', 'token', 'value',
]);

export class YopmailInteractions {
  static async abrirYopmail(context: BrowserContext, email: string): Promise<Page> {
    const newPage = await context.newPage();
    await newPage.goto('https://yopmail.com/es/');
    await newPage.waitForLoadState('domcontentloaded');

    const emailInput = newPage.locator('input[name="login"], input#login');
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.fill(email);

    const consultarButton = newPage.locator('button[title*="Revisa el correo"], button.md[onclick*="go()"]').first();
    await consultarButton.waitFor({ state: 'visible', timeout: 10000 });
    await consultarButton.click();

    // Espera activa: refresca el inbox hasta que llegue el email (máx 90s)
    // Selectores múltiples para el botón de refresh de Yopmail
    const REFRESH_SELECTORS = [
      'button[onclick*="refresh"]',
      'button[onclick*="Refresh"]',
      '#refresh',
      'button.md[id*="refresh"]',
      'button[aria-label*="efresh"]',
    ];
    const emailItem = newPage.locator('button.lm, div.lm, button[class*="lm"]').first();

    const MAX_WAIT_MS = 90_000;
    const POLL_MS     = 7_000;
    const start       = Date.now();
    let   emailFound  = false;

    while (Date.now() - start < MAX_WAIT_MS) {
      const visible = await emailItem.isVisible().catch(() => false);
      if (visible) {
        emailFound = true;
        break;
      }

      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`  Inbox vacío — refrescando (${elapsed}s / ${MAX_WAIT_MS / 1000}s max)...`);

      // Intentar cada selector de refresh sin llamar page.reload() (evita cerrar el contexto)
      let refreshed = false;
      for (const sel of REFRESH_SELECTORS) {
        try {
          const btn = newPage.locator(sel).first();
          const visible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
          if (visible) {
            await btn.click({ timeout: 3000 });
            refreshed = true;
            break;
          }
        } catch { /* siguiente selector */ }
      }

      if (!refreshed) {
        // Si ningún botón funcionó, navegar de vuelta al inbox vía URL (más seguro que reload)
        const username = email.split('@')[0];
        await newPage.goto(`https://yopmail.com/es/?login=${username}`, { timeout: 15000 })
          .catch(() => console.log('  ⚠ Navegación fallback también falló — esperando...'));
      }

      await newPage.waitForTimeout(POLL_MS);
    }

    if (!emailFound) {
      throw new Error(`Email de Finkargo no llegó a ${email} en ${MAX_WAIT_MS / 1000}s`);
    }

    console.log('Email de activación encontrado — abriendo...');
    await emailItem.click();
    await newPage.waitForTimeout(3000);

    return newPage;
  }

  static async obtenerCodigoVerificacion(page: Page): Promise<string> {
    console.log('Leyendo contenido del email...');

    const iframe = page.frameLocator('#ifmail, iframe[name="ifmail"]');

    // Espera a que el iframe tenga contenido real (no la página de ayuda de Yopmail)
    let bodyText = '';
    const MAX_RETRIES = 5;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        await iframe.locator('body').waitFor({ state: 'visible', timeout: 8000 });
        const text = await iframe.locator('body').textContent() ?? '';
        // Descarta el contenido si solo tiene el texto de ayuda de Yopmail
        if (text.length > 50 && !text.includes('w.showmail') && !text.includes('¿Cómo utilizar')) {
          bodyText = text;
          break;
        }
      } catch {
        // iframe no disponible aún
      }
      console.log(`  Contenido del iframe no válido (intento ${i + 1}/${MAX_RETRIES}) — esperando...`);
      await page.waitForTimeout(4000);
    }

    if (!bodyText) {
      // Fallback: leer el body principal
      console.log('⚠ Usando body principal como fallback...');
      bodyText = await page.locator('body').textContent() ?? '';
    }

    console.log(`Texto del email (primeros 300 chars): ${bodyText.substring(0, 300)}`);

    // 1. Preferencia: código numérico de 4-6 dígitos (OTP estándar)
    const numMatch = bodyText.match(/\b(\d{4,6})\b/);
    if (numMatch) {
      console.log(`✓ Código numérico encontrado: ${numMatch[1]}`);
      return numMatch[1];
    }

    // 2. Fallback: alfanumérico de 6-8 chars, excluyendo palabras comunes
    const alfaMatches = bodyText.matchAll(/\b([A-Z0-9]{6,8})\b/gi);
    for (const m of alfaMatches) {
      const candidate = m[1].toLowerCase();
      if (!FALSOS_POSITIVOS.has(candidate)) {
        console.log(`✓ Código alfanumérico encontrado: ${m[1]}`);
        return m[1];
      }
    }

    throw new Error(`No se encontró código de verificación en el email. Texto leído: "${bodyText.substring(0, 200)}"`);
  }

  static async obtenerLinkActivacion(page: Page): Promise<string | null> {
    const iframe = page.frameLocator('#ifmail, iframe[name="ifmail"]');
    try {
      // Busca links que contengan rutas de activación típicas
      const links = iframe.locator('a[href*="activ"], a[href*="verif"], a[href*="confirm"]');
      const count = await links.count().catch(() => 0);
      if (count > 0) {
        const href = await links.first().getAttribute('href');
        if (href) {
          console.log(`✓ Link de activación encontrado: ${href.substring(0, 80)}...`);
          return href;
        }
      }
    } catch {}
    return null;
  }

  static async cerrarYopmail(page: Page) {
    await page.close();
  }
}
