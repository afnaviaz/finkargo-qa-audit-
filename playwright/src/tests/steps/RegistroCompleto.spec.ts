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
  // Intercepta la respuesta de autenticación para capturar user_id
  let capturedUserId: string | null = null;

  const responseHandler = async (response: any) => {
    if (response.status() !== 200) return;
    try {
      const url: string = response.url();
      if (!url.includes('/auth/') && !url.includes('/users/') && !url.includes('/login')) return;
      const body = await response.json().catch(() => null);
      if (!body) return;
      const uid = body?.user?.id ?? body?.userId ?? body?.user_id ?? body?.data?.id ?? body?.id ?? null;
      if (uid && !capturedUserId) {
        capturedUserId = String(uid);
        console.log(`✓ user_id capturado vía red: ${capturedUserId}`);
      }
    } catch {}
  };

  this.page.on('response', responseHandler);

  await RegistroCompletoTask.esperarYValidarRegistroExitoso(this.page);

  this.page.off('response', responseHandler);

  // Fallback: intentar extraer user_id de la URL final
  if (!capturedUserId) {
    const finalUrl = this.page.url();
    const match = finalUrl.match(/\/users\/([a-zA-Z0-9_-]+)/);
    if (match) {
      capturedUserId = match[1];
      console.log(`✓ user_id extraído de URL: ${capturedUserId}`);
    }
  }

  const currentUrl = this.page.url();
  console.log(`✓ Registro exitoso. URL final: ${currentUrl}`);
  if (capturedUserId) console.log(`  user_id: ${capturedUserId}`);
  else console.log('  user_id: no capturado — Newman lo obtendrá vía Login');

  // Guardar usuario para que Newman lo consuma
  if (this.datosRegistro) {
    UserDataStore.saveUser({
      email:    this.datosRegistro.correo,
      password: this.datosRegistro.contrasena,
      nombre:   this.datosRegistro.nombre,
      apellido: this.datosRegistro.apellido,
      empresa:  this.datosRegistro.nombreEmpresa,
      nit:      this.datosRegistro.nit,
      user_id:  capturedUserId ?? undefined,
      timestamp: Date.now(),
      scenario: 'registro_ob2'
    });
    console.log('✓ Datos guardados para Newman → OB2 Flow');
  }
});