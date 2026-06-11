export interface Environment {
  name: string;
  url: string;
  country: string;
}

export const environments: { [key: string]: Environment } = {
  'staging-co': {
    name: 'Staging Colombia',
    url: 'https://app-staging.finkargo.com.co/auth/login',
    country: 'CO'
  },
  'staging-mx': {
    name: 'Staging México',
    url: 'https://app-staging.finkargo.com.mx/auth/login',
    country: 'MX'
  },
  'testing-co': {
    name: 'Testing Colombia',
    url: 'https://app-testing.finkargo.com.co/auth/login',
    country: 'CO'
  },
  'testing-mx': {
    name: 'Testing México',
    url: 'https://app-testing.finkargo.com.mx/auth/login',
    country: 'MX'
  }
};

export class EnvironmentConfig {
  private static currentEnvironment: string = process.env.ENV || 'testing-co';

  static setEnvironment(env: string): void {
    if (!environments[env]) {
      throw new Error(`Ambiente '${env}' no existe. Disponibles: ${Object.keys(environments).join(', ')}`);
    }
    this.currentEnvironment = env;
  }

  static getEnvironment(): Environment {
    return environments[this.currentEnvironment];
  }

  static getUrl(): string {
    return this.getEnvironment().url;
  }

  static getCountry(): string {
    return this.getEnvironment().country;
  }

  static getEnvironmentName(): string {
    return this.getEnvironment().name;
  }
}