import { After } from '@cucumber/cucumber';
import { CustomWorld } from './world';

After({ timeout: 30000 }, async function (this: CustomWorld) {
  if (this.page && !this.page.isClosed()) {
    await this.page.close();
  }
  if (this.context) {
    await this.context.close();
  }
  if (this.browser) {
    await this.browser.close();
  }
});