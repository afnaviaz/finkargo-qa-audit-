import { Page } from 'playwright-core';

export class LoginInteractions {
  static async fillEmail(page: Page, email: string) {
    await page.waitForLoadState('domcontentloaded');
    const emailInput = page.locator('input[name="username"]');
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.fill(email);
  }

  static async fillPassword(page: Page, password: string) {
    const passwordInput = page.locator('input[name="password"]');
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
    await passwordInput.fill(password);
  }

  static async clickLoginButton(page: Page) {
    const loginButton = page.locator('button:has-text("Ingresar")');
    await loginButton.waitFor({ state: 'visible', timeout: 10000 });
    await loginButton.click();
  }

  static async waitForPageLoad(page: Page) {
    try {
      await page.waitForURL(url => !url.href.includes('/auth/login'), { timeout: 30000 });
    } catch {
      // URL no cambió
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  }
}