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
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    const correo = `autopw${timestamp}${random}@yopmail.com`;
    const nombreEmpresa = `AutoQA${timestamp}`;
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
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    const correo = `autopwmx${timestamp}${random}@yopmail.com`;
    const nombreEmpresa = `AutoQAMX${timestamp}`;
    const rfcSufijos = ['HV0', 'AB1', 'CD2', 'EF3', 'GH4'];
    const rfc = `AUTO${String(timestamp).slice(-6)}${rfcSufijos[random % rfcSufijos.length]}`;

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