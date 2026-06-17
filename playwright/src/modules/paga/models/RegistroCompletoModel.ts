import { UserDataStore } from '../../../utils/UserDataStore';

export class RegistroCompletoModel {
  nombre: string;
  apellido: string;
  correo: string;
  codigoPais: string;
  numeroCelular: string;
  contrasena: string;
  confirmacionContrasena: string;
  paisRegistro: string;
  nit: string;
  nombreEmpresa: string;
  cargo: string;

  constructor(
    nombre: string,
    apellido: string,
    correo: string,
    codigoPais: string,
    numeroCelular: string,
    contrasena: string,
    paisRegistro: string,
    nit: string,
    nombreEmpresa: string,
    cargo: string
  ) {
    this.nombre = nombre;
    this.apellido = apellido;
    this.correo = correo;
    this.codigoPais = codigoPais;
    this.numeroCelular = numeroCelular;
    this.contrasena = contrasena;
    this.confirmacionContrasena = contrasena;
    this.paisRegistro = paisRegistro;
    this.nit = nit;
    this.nombreEmpresa = nombreEmpresa;
    this.cargo = cargo;
  }

  static generarDatosAleatorios(): RegistroCompletoModel {
    const PREFIX = 'user-qa-aut-co';
    // En CI usa GITHUB_RUN_NUMBER (único por ejecución); localmente usa el contador persistente
    const runN = process.env.GITHUB_RUN_NUMBER;
    const n = runN ? parseInt(runN, 10) : UserDataStore.getNextUserNumber(PREFIX);
    const correo = `${PREFIX}-${String(n).padStart(3, '0')}@maildrop.cc`;
    const nombreEmpresa = `AutoQA-CO-${String(n).padStart(3, '0')}`;
    const nit = `${Math.floor(10000000 + Math.random() * 90000000)}`;

    return new RegistroCompletoModel(
      'Auto',
      'QA',
      correo,
      '57',
      '3178696749',
      'Finkargo2026#',
      'COLOMBIA',
      nit,
      nombreEmpresa,
      'FINANCIERO'
    );
  }

  static generarDatosAleatoriosMx(): RegistroCompletoModel {
    const PREFIX = 'user-qa-aut-mx';
    const runN = process.env.GITHUB_RUN_NUMBER;
    const n = runN ? parseInt(runN, 10) : UserDataStore.getNextUserNumber(PREFIX);
    const correo = `${PREFIX}-${String(n).padStart(3, '0')}@maildrop.cc`;
    const nombreEmpresa = `AutoQA-MX-${String(n).padStart(3, '0')}`;
    const rfcSufijos = ['HV0', 'AB1', 'CD2', 'EF3', 'GH4'];
    const rfc = `AUTO${String(n).padStart(4, '0')}${rfcSufijos[n % rfcSufijos.length]}`;

    return new RegistroCompletoModel(
      'Auto',
      'QAMX',
      correo,
      '52',
      '5566987413',
      'Finkargo26$',
      'MEXICO',
      rfc,
      nombreEmpresa,
      'FINANCIERO'
    );
  }
}
