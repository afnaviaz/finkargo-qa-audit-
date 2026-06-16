import { Page, BrowserContext } from 'playwright-core';
import { RegistroInteractions } from '../interactions/RegistroInteractions';
import { YopmailInteractions } from '../../../shared/interactions/YopmailInteractions';
import { RegistroCompletoModel } from '../models/RegistroCompletoModel';
import { LoginInteractions } from '../../../shared/interactions/LoginInteractions';

export class RegistroCompletoTask {
  static async completarPaso1DatosPersonales(page: Page, datos: RegistroCompletoModel) {
    console.log('Completando paso 1: Datos personales');
    await RegistroInteractions.fillNombre(page, datos.nombre);
    await RegistroInteractions.fillApellido(page, datos.apellido);
    await RegistroInteractions.fillCorreoCorporativo(page, datos.correo);
    await RegistroInteractions.fillNumeroCelular(page, datos.numeroCelular);
    await RegistroInteractions.fillContrasena(page, datos.contrasena);
    await RegistroInteractions.fillConfirmacionContrasena(page, datos.confirmacionContrasena);
    await RegistroInteractions.clickSiguiente(page);
    console.log('✓ Paso 1 completado');
  }

  static async completarPaso2DatosEmpresa(page: Page, datos: RegistroCompletoModel) {
    console.log('Completando paso 2: Datos de empresa');
    await RegistroInteractions.selectPaisRegistro(page, datos.paisRegistro);
    await RegistroInteractions.fillNIT(page, datos.nit);
    await RegistroInteractions.fillNombreEmpresa(page, datos.nombreEmpresa);
    await RegistroInteractions.selectCargo(page, datos.cargo);
    await RegistroInteractions.selectAsesor(page);
    await RegistroInteractions.aceptarTerminos(page);
    await RegistroInteractions.clickSiguiente(page);
    console.log('✓ Paso 2 completado');
  }

  static async solicitarCodigoVerificacion(page: Page) {
    console.log('Solicitando código de verificación');
    await RegistroInteractions.clickEnviarCodigo(page);
    console.log('✓ Código solicitado');
  }

  static async obtenerCodigoDeYopmail(context: BrowserContext, email: string): Promise<string> {
    console.log(`Obteniendo código desde Yopmail para: ${email}`);
    let yopmailPage: any = null;
    try {
      yopmailPage = await YopmailInteractions.abrirYopmail(context, email);
      await yopmailPage.waitForTimeout(5000);
      const codigo = await YopmailInteractions.obtenerCodigoVerificacion(yopmailPage);
      if (!codigo) throw new Error('El código obtenido es nulo o vacío');
      console.log(`✓ Código obtenido: ${codigo}`);
      return codigo;
    } catch (error) {
      console.error(`✗ Error al obtener código de Yopmail: ${error}`);
      throw new Error(`No se pudo obtener el código: ${error}`);
    } finally {
      if (yopmailPage) {
        await YopmailInteractions.cerrarYopmail(yopmailPage).catch(() => {});
      }
    }
  }

  static async verificarCodigo(page: Page, codigo: string) {
    console.log(`Ingresando código: ${codigo}`);
    await RegistroInteractions.fillCodigoVerificacion(page, codigo);
    await page.waitForTimeout(1000);
    console.log('✓ Código ingresado — esperando autenticación automática');
  }

  static async esperarYValidarRegistroExitoso(page: Page) {
    console.log('Esperando autenticación post-registro...');
    await page.waitForTimeout(2000);

    try {
      await page.waitForURL((url) => {
        const fuera = !url.pathname.includes('/auth/register/verify');
        console.log(`  Evaluando URL: ${url.pathname} — fuera de verify: ${fuera}`);
        return fuera;
      }, { timeout: 30000 });

      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
      const finalUrl = page.url();
      console.log(`✓ Usuario autenticado. URL final: ${finalUrl}`);

      if (finalUrl.includes('/auth/register')) {
        throw new Error(`Aún en flujo de registro: ${finalUrl}`);
      }
    } catch (error) {
      console.error(`✗ Error esperando autenticación: ${error}`);
      console.log(`  URL actual: ${page.url()}`);
      throw error;
    }
  }

  static async registroCompleto(
    page: Page,
    context: BrowserContext,
    datos: RegistroCompletoModel
  ): Promise<void> {
    await this.completarPaso1DatosPersonales(page, datos);
    await this.completarPaso2DatosEmpresa(page, datos);
    await this.solicitarCodigoVerificacion(page);
    const codigo = await this.obtenerCodigoDeYopmail(context, datos.correo);
    await this.verificarCodigo(page, codigo);
    await this.esperarYValidarRegistroExitoso(page);
  }
}