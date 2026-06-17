import { After } from '@cucumber/cucumber';
import { CustomWorld } from './world';

After({ timeout: 30000 }, async function (this: CustomWorld) {
  try { if (this.page && !this.page.isClosed()) await this.page.close(); } catch {}
  try { if (this.context) await this.context.close(); } catch {}
  try { if (this.browser) await this.browser.close(); } catch {}
});
