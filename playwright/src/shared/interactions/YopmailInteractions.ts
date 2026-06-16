import { Page, BrowserContext } from 'playwright-core';

// Palabras comunes que podrían matchear accidentalmente el regex alfanumérico
const FALSOS_POSITIVOS = new Set([
  'false', 'true', 'null', 'undefined', 'error', 'email', 'click',
  'inbox', 'spam', 'yopmail', 'login', 'token', 'value',
]);

export class YopmailInteractions {
  // Carga el inbox de Yopmail desde cero (navegación + click check)
  private static async cargarInbox(page: Page, email: string): Promise<void> {
    await page.goto('https://yopmail.com/es/', { timeout: 20000 });
    await page.waitForLoadState('domcontentloaded');
    const emailInput = page.locator('input[name="login"], input#login');
    await emailInput.waitFor({ state: 'visible', timeout: 8000 });
    await emailInput.fill(email);
    const checkBtn = page.locator('button[onclick*="go()"], button[title*="Revisa"], button.md').first();
    await checkBtn.click({ timeout: 8000 });
    await page.waitForTimeout(3000);
  }

  static async abrirYopmail(context: BrowserContext, email: string): Promise<Page> {
    const newPage = await context.newPage();
    await YopmailInteractions.cargarInbox(newPage, email);

    // Yopmail usa clases distintas según la versión.
    // EXCLUIR: #msgundo (div oculto de "deshacer") — matchea #mails > div pero no es un email.
    const EMAIL_ITEM_SELECTOR = [
      'button.lm',
      'div.lm',
      'div.m',
      '.mail .m',
      'li.m',
    ].join(', ');

    const MAX_WAIT_MS = 150_000; // Increased from 90s to 150s (2.5 minutes)
    const POLL_MS     = 8_000;
    const start       = Date.now();
    let   emailFound  = false;
    let   foundSel    = '';

    while (Date.now() - start < MAX_WAIT_MS) {
      // Buscar item visible (isVisible filtra #msgundo que es hidden)
      const items = newPage.locator(EMAIL_ITEM_SELECTOR);
      const count = await items.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const visible = await items.nth(i).isVisible().catch(() => false);
        if (visible) {
          emailFound = true;
          foundSel   = EMAIL_ITEM_SELECTOR;
          break;
        }
      }
      if (emailFound) break;

      // Diagnóstico: loguear qué tiene realmente el inbox
      const elapsed     = Math.round((Date.now() - start) / 1000);
      const mailsHtml   = await newPage.locator('#mails').innerHTML({ timeout: 2000 })
        .then(h => h.substring(0, 200).replace(/\s+/g, ' '))
        .catch(() => '(#mails no encontrado)');
      console.log(`  Inbox vacío (${elapsed}s) — #mails: "${mailsHtml}"`);

      // Refresh: primero intenta el botón nativo de Yopmail, si no re-carga el inbox
      const refreshed = await newPage
        .locator('#refresh, button#refresh, button[onclick*="refresh"]')
        .first()
        .click({ timeout: 2000 })
        .then(() => true)
        .catch(() => false);

      if (!refreshed) {
        await YopmailInteractions.cargarInbox(newPage, email)
          .catch(() => console.log('  ⚠ Re-carga del inbox falló'));
      } else {
        await newPage.waitForTimeout(2000);
      }

      await newPage.waitForTimeout(POLL_MS);
    }

    if (!emailFound) {
      throw new Error(`Email de Finkargo no llegó a ${email} en ${MAX_WAIT_MS / 1000}s`);
    }

    // Buscar el primer item visible (excluye #msgundo y elementos hidden)
    const allItems    = newPage.locator(EMAIL_ITEM_SELECTOR);
    const totalCount  = await allItems.count();
    let   clicked     = false;

    for (let i = 0; i < totalCount; i++) {
      const item    = allItems.nth(i);
      const visible = await item.isVisible().catch(() => false);
      if (visible) {
        const id = await item.getAttribute('id').catch(() => '');
        if (id === 'msgundo') continue;
        console.log(`Email encontrado (índice ${i}, id="${id ?? ''}") — abriendo...`);
        await item.click({ timeout: 10000 });
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      throw new Error('Email detectado en inbox pero ningún item era clickeable');
    }

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
