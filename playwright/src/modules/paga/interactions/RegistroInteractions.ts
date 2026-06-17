import { Page } from 'playwright-core';

export class RegistroInteractions {
  // ── Paso 1: Datos personales ──────────────────────────────────────────────
  static async fillNombre(page: Page, nombre: string) {
    const input = page.locator('input[name="name"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(nombre);
  }

  static async fillApellido(page: Page, apellido: string) {
    const input = page.locator('input[name="surname"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(apellido);
  }

  static async fillCorreoCorporativo(page: Page, correo: string) {
    const input = page.locator('input[name="email"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(correo);
  }

  static async fillNumeroCelular(page: Page, numero: string) {
    const input = page.locator('input[name="phone"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(numero);
  }

  static async fillContrasena(page: Page, contrasena: string) {
    const input = page.locator('input[name="passsword"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(contrasena);
  }

  static async fillConfirmacionContrasena(page: Page, contrasena: string) {
    const input = page.locator('input[name="newpasssword"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(contrasena);
  }

  static async clickSiguiente(page: Page) {
    const buttons = page.locator('button:has-text("Siguiente")');
    const count = await buttons.count();
    let clicked = false;

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      const isVisible = await button.isVisible().catch(() => false);
      if (isVisible) {
        console.log(`Encontrado botón "Siguiente" visible (índice ${i})`);
        await button.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(500);
        await button.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) throw new Error('No se encontró ningún botón "Siguiente" visible');

    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  // ── Paso 2: Datos de empresa ──────────────────────────────────────────────
  static async selectPaisRegistro(page: Page, pais: string) {
    const selectTrigger = page.locator('#custom-select-countryCompany, div[id*="select-countryCompany"]').first();
    await selectTrigger.waitFor({ state: 'visible', timeout: 10000 });

    const normalize = (s: string) =>
      s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    const currentValue = await selectTrigger.textContent();
    if (currentValue && normalize(currentValue).includes(normalize(pais))) {
      console.log(`País "${pais}" ya está seleccionado`);
      return;
    }

    await selectTrigger.click();
    await page.waitForTimeout(2000);

    const paisNorm = normalize(pais);
    const options = page.locator('[role="option"], li[class*="option"], li[data-value]');
    const count = await options.count();
    let found = false;

    for (let i = 0; i < count; i++) {
      const opt = options.nth(i);
      const text = await opt.textContent();
      if (text && normalize(text).includes(paisNorm)) {
        await opt.scrollIntoViewIfNeeded();
        await opt.click();
        found = true;
        console.log(`✓ País seleccionado: "${text.trim()}"`);
        break;
      }
    }

    if (!found) throw new Error(`No se encontró la opción de país "${pais}"`);
    await page.waitForTimeout(1000);
  }

  static async fillNIT(page: Page, nit: string) {
    const input = page.locator('input[name="identity_number_company"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(nit);
  }

  static async fillNombreEmpresa(page: Page, nombre: string) {
    const input = page.locator('input[name="company_name"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(nombre);
  }

  static async selectCargo(page: Page, cargo: string) {
    const selectTrigger = page.locator('#post-select, div[id="post-select"]');
    await selectTrigger.waitFor({ state: 'visible', timeout: 10000 });
    await selectTrigger.click();
    await page.waitForTimeout(2000);

    const option = page.locator(`[role="option"]:has-text("${cargo}"), li:has-text("${cargo}")`).first();
    await option.waitFor({ state: 'visible', timeout: 10000 });
    await option.click();
    await page.waitForTimeout(1000);
  }

  static async selectAsesor(page: Page) {
    const selectTrigger = page.locator('#select-label-kam, div[id="select-label-kam"]');
    const isVisible = await selectTrigger.isVisible().catch(() => false);

    if (!isVisible) {
      console.log('Campo asesor no visible (opcional). Saltando...');
      return;
    }

    await selectTrigger.click();
    await page.waitForTimeout(2000);
    const firstOption = page.locator('[role="option"]').first();
    await firstOption.waitFor({ state: 'visible', timeout: 10000 });
    await firstOption.click();
    await page.waitForTimeout(1000);
  }

  static async aceptarTerminos(page: Page) {
    const termsCheckbox = page.locator('input[name="terms_of_service"]');
    await termsCheckbox.check({ force: true });

    const conditionsCheckbox = page.locator('input[name="other_conditions"]');
    await conditionsCheckbox.check({ force: true });
  }

  // ── Paso 3: Verificación OTP ──────────────────────────────────────────────
  static async clickEnviarCodigo(page: Page) {
    const button = page.locator('button:has-text("Enviar código")');
    await button.waitFor({ state: 'visible', timeout: 10000 });
    await button.click();
    await page.waitForTimeout(5000);
  }

  static async fillCodigoVerificacion(page: Page, codigo: string) {
    console.log(`Ingresando código de verificación: ${codigo}`);

    // Espera activa: aguarda hasta que aparezca al menos 1 input de OTP
    const otpSelector = 'input[type="text"], input[type="number"], input[type="tel"], input[maxlength="1"]';
    try {
      await page.waitForSelector(otpSelector, { state: 'visible', timeout: 15000 });
    } catch {
      console.log('⚠ Timeout esperando inputs OTP — tomando screenshot para diagnóstico');
      await page.screenshot({ path: 'otp-debug.png' }).catch(() => {});
      console.log(`  URL actual: ${page.url()}`);
    }

    const inputs = await page.locator(otpSelector).all();
    const visibleInputs = [];
    for (const input of inputs) {
      const isVisible = await input.isVisible().catch(() => false);
      if (isVisible) visibleInputs.push(input);
    }

    console.log(`Encontrados ${visibleInputs.length} inputs visibles`);

    if (visibleInputs.length >= 5) {
      for (let i = 0; i < Math.min(5, codigo.length); i++) {
        await visibleInputs[i].click();
        await page.waitForTimeout(100);
        await visibleInputs[i].clear();
        await visibleInputs[i].fill(codigo[i]);
        await visibleInputs[i].evaluate((el: any) => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForTimeout(300);
      }
    } else if (visibleInputs.length > 0) {
      await visibleInputs[0].click();
      await visibleInputs[0].clear();
      await visibleInputs[0].fill(codigo);
      await visibleInputs[0].evaluate((el: any) => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    } else {
      throw new Error(`No se encontraron inputs OTP en la página. URL: ${page.url()}`);
    }

    console.log('✓ Código ingresado');
  }
}