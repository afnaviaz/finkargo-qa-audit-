import { Page, BrowserContext } from 'playwright-core';

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
    await newPage.waitForTimeout(5000);

    console.log('Buscando email de activación...');
    const primerEmail = newPage.locator('button.lm, div.m, button[class*="lm"]').first();
    const emailVisible = await primerEmail.isVisible().catch(() => false);

    if (emailVisible) {
      console.log('Haciendo clic en el email de activación...');
      await primerEmail.click();
      await newPage.waitForTimeout(3000);
    } else {
      console.log('Email ya está abierto o no requiere clic');
    }

    return newPage;
  }

  static async obtenerCodigoVerificacion(page: Page): Promise<string> {
    try {
      console.log('Esperando a que cargue el contenido del email...');
      await page.waitForTimeout(3000);

      const iframeElement = page.frameLocator('#ifmail, iframe[name="ifmail"]');

      try {
        await iframeElement.locator('body').waitFor({ state: 'visible', timeout: 10000 });
      } catch (error) {
        console.log('⚠ No se encontró el iframe del email, intentando cuerpo principal...');
      }

      let bodyText = '';
      try {
        const text = await iframeElement.locator('body').textContent();
        bodyText = text || '';
      } catch (error) {
        console.log('⚠ No se pudo obtener texto del iframe, intentando alternativa...');
        const text = await page.locator('body').textContent();
        bodyText = text || '';
      }

      console.log('Contenido del email obtenido, buscando código...');
      if (bodyText.length > 0) {
        console.log(`Texto capturado: ${bodyText.substring(0, 500)}...`);
      }

      if (bodyText) {
        const codigo5Match = bodyText.match(/\b\d{5}\b/);
        if (codigo5Match) {
          console.log(`✓ Código de 5 dígitos encontrado: ${codigo5Match[0]}`);
          return codigo5Match[0];
        }

        const codigo4Match = bodyText.match(/\b\d{4}\b/);
        if (codigo4Match) {
          console.log(`✓ Código de 4 dígitos encontrado: ${codigo4Match[0]}`);
          return codigo4Match[0];
        }

        const alfaMatch = bodyText.match(/\b[A-Z0-9]{5}\b/i);
        if (alfaMatch) {
          console.log(`✓ Código alfanumérico encontrado: ${alfaMatch[0]}`);
          return alfaMatch[0];
        }
      }

      throw new Error('No se pudo encontrar el código de verificación en el email');
    } catch (error) {
      console.error('Error al obtener código de Yopmail:', error);
      throw error;
    }
  }

  static async cerrarYopmail(page: Page) {
    await page.close();
  }
}