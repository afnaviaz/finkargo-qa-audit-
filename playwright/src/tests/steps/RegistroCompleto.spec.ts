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

When('obtengo el código desde Yopmail', { timeout: 120000 }, async function (this: CustomWorld) {
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
  let capturedToken: string | null = null;

  // Estrategia 1: interceptar respuesta de red — el JWT llega antes de la redirección
  const responseHandler = async (response: any) => {
    if (capturedToken) return;
    if (response.status() !== 200) return;
    try {
      const body = await response.json().catch(() => null);
      if (!body) return;
      const token = body?.access_token ?? body?.token ?? body?.jwt
                 ?? body?.data?.access_token ?? body?.data?.token
                 ?? body?.auth?.token ?? null;
      if (token && typeof token === 'string' && token.startsWith('ey')) {
        capturedToken = token;
        console.log(`✓ JWT capturado vía red: ${response.url()}`);
      }
    } catch {}
  };

  this.page.on('response', responseHandler);
  await RegistroCompletoTask.esperarYValidarRegistroExitoso(this.page);
  this.page.off('response', responseHandler);

  // Estrategia 2: leer localStorage / sessionStorage (SPA guarda el token aquí tras la redirección)
  if (!capturedToken) {
    capturedToken = await this.page.evaluate(() => {
      const keys = ['access_token', 'token', 'jwt', 'authToken', 'auth_token', 'id_token'];
      for (const k of keys) {
        const v = localStorage.getItem(k) ?? sessionStorage.getItem(k) ?? null;
        if (v && v.startsWith('ey')) return v;
      }
      return null;
    }).catch(() => null);
    if (capturedToken) console.log('✓ JWT capturado vía localStorage');
  }

  const currentUrl = this.page.url();
  console.log(`✓ Registro exitoso. URL final: ${currentUrl}`);
  if (capturedToken) console.log(`  auth_token: ${capturedToken.substring(0, 30)}...`);
  else              console.log('  auth_token: no capturado — ajustar key de localStorage o patrón de respuesta');

  if (this.datosRegistro) {
    UserDataStore.saveUser({
      email:      this.datosRegistro.correo,
      password:   this.datosRegistro.contrasena,
      nombre:     this.datosRegistro.nombre,
      apellido:   this.datosRegistro.apellido,
      empresa:    this.datosRegistro.nombreEmpresa,
      nit:        this.datosRegistro.nit,
      auth_token: capturedToken ?? undefined,
      timestamp:  Date.now(),
      scenario:   'registro_ob2'
    });
    console.log('✓ Datos guardados para Newman → OB2 Flow');
  }
});