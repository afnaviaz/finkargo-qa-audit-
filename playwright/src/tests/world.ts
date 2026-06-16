import { setWorldConstructor, World } from '@cucumber/cucumber';
import { Browser, Page, BrowserContext } from 'playwright';
import { RegistroCompletoModel } from '../modules/paga/models/RegistroCompletoModel';

class CustomWorld extends World {
  browser!: Browser;
  page!: Page;
  context!: BrowserContext;
  datosRegistro?: RegistroCompletoModel;
}

setWorldConstructor(CustomWorld);

export { CustomWorld };