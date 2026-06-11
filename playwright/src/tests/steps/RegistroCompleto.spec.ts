import { Given, When, Then } from '@cucumber/cucumber';
import { chromium } from 'playwright-core';
import { CustomWorld } from '../world';
import { RegistroCompletoModel } from '../../modules/paga/models/RegistroCompletoModel';
import { RegistroCompletoTask } from '../../modules/paga/tasks/RegistroCompletoTask';
import { UserDataStore } from '../../utils/UserDataStore';
import { EnvironmentConfig } from '../../config/environments';

Given('que estoy en la página de registro de Finkargo', { timeout: 20000 }, async function (this: CustomWorld) {
  this.browser = await chromium.launch({ headless: true }); // headless en CI
  this.context = await this.browser.newContext();
  this.page = await this.context.newPage();

  const baseUrl = EnvironmentConfig.getUrl().replace('/auth/login', '/auth/signup');
  console.log(`Navegando a registro: ${baseUrl}`);

  await this.page.goto(baseUrl);
  await this.page.waitForLoadState('domcontentloaded');
});

When('completo el formulario de datos personales con datos aleatorios', { timeout: 60000 }, async function (this: CustomWorld) {
  const esMexico = EnvironmentConfig.getCountry() === 'MX';
  this.datosRegistro = esMexico
    ? RegistroCompletoModel.generarDatosAleatoriosMx()
    : RegistroCompletoModel.generarDatosAleatorios();

  console.log(`Datos generados (${EnvironmentConfig.getEnvironmentName()}):`);
  console.log(`  Email:   ${this.datosRegistro.correo}`);
  console.log(`  Empresa: ${this.datosRegistro.nombreEmpresa}`);

  await RegistroCompletoTask.completarPaso1DatosPersonales(this.page, this.datosRegistro);
});

When('completo el formulario de datos de empresa', { timeout: 60000 }, async function (this: CustomWorld) {
  if (!this.datosRegistro) throw new Error('No se han generado datos de registro');
  await RegistroCompletoTask.completarPaso2DatosEmpresa(this.page, this.datosRegistro);
});

When('solicito el código de verificación', { timeout: 30000 }, async function (this: CustomWorld) {
  await RegistroCompletoTask.solicitarCodigoVerificacion(this.page);
  console.log('✓ En página de activación');
});

When('obtengo el código desde Yopmail', { timeout: 60000 }, async function (this: CustomWorld) {
  if (!this.datosRegistro) throw new Error('No se han generado datos de registro');
  console.log(`Esperando email en: ${this.datosRegistro.correo}`);
  const codigo = await RegistroCompletoTask.obtenerCodigoDeYopmail(this.context, this.datosRegistro.correo);
  (this as any).codigoVerificacion = codigo;
  console.log(`✓ Código obtenido: ${codigo}`);
});

When('verifico mi cuenta con el código recibido', { timeout: 30000 }, async function (this: CustomWorld) {
  const codigo = (this as any).codigoVerificacion;
  if (!codigo) throw new Error('No se ha obtenido el código de verificación');
  await RegistroCompletoTask.verificarCodigo(this.page, codigo);
});

Then('debería ver que el registro fue exitoso', { timeout: 90000 }, async function (this: CustomWorld) {
  await RegistroCompletoTask.esperarYValidarRegistroExitoso(this.page);

  const currentUrl = this.page.url();
  console.log(`✓ Registro exitoso. URL final: ${currentUrl}`);

  // Guardar usuario para que Newman lo consuma
  if (this.datosRegistro) {
    UserDataStore.saveUser({
      email:    this.datosRegistro.correo,
      password: this.datosRegistro.contrasena,
      nombre:   this.datosRegistro.nombre,
      apellido: this.datosRegistro.apellido,
      empresa:  this.datosRegistro.nombreEmpresa,
      nit:      this.datosRegistro.nit,
      timestamp: Date.now(),
      scenario: 'registro_ob2'
    });
    console.log('✓ Datos guardados para Newman → OB2');
  }
});