import * as fs from 'fs';
import * as path from 'path';

export interface StoredUserData {
  email: string;
  password: string;
  nombre?: string;
  apellido?: string;
  empresa?: string;
  nit?: string;
  auth_token?: string;
  timestamp: number;
  scenario?: string;
}

export class UserDataStore {
  // Ruta relativa a la carpeta playwright/ dentro del repo qa-audit
private static readonly DATA_FILE = path.join(__dirname, '../../data/registered-users.json');

  static saveUser(userData: StoredUserData): void {
    try {
      const dataDir = path.dirname(this.DATA_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      let users: StoredUserData[] = [];
      if (fs.existsSync(this.DATA_FILE)) {
        const fileContent = fs.readFileSync(this.DATA_FILE, 'utf-8');
        users = JSON.parse(fileContent);
      }

      if (!userData.timestamp) userData.timestamp = Date.now();
      users.push(userData);

      fs.writeFileSync(this.DATA_FILE, JSON.stringify(users, null, 2), 'utf-8');
      console.log(`✓ Usuario guardado: ${userData.email}`);
    } catch (error) {
      console.error('Error al guardar usuario:', error);
      throw error;
    }
  }

  static getLastRegisteredUser(): StoredUserData | null {
    try {
      if (!fs.existsSync(this.DATA_FILE)) return null;
      const users: StoredUserData[] = JSON.parse(fs.readFileSync(this.DATA_FILE, 'utf-8'));
      return users.length > 0 ? users[users.length - 1] : null;
    } catch {
      return null;
    }
  }

  static getNextUserNumber(prefix: string): number {
    try {
      if (!fs.existsSync(this.DATA_FILE)) return 1;
      const users: StoredUserData[] = JSON.parse(fs.readFileSync(this.DATA_FILE, 'utf-8'));
      const regex = new RegExp(`^${prefix}-(\\d+)@maildrop\\.cc$`);
      const numbers = users
        .map(u => regex.exec(u.email))
        .filter(Boolean)
        .map(m => parseInt(m![1], 10));
      return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    } catch {
      return 1;
    }
  }

  static clearAll(): void {
    if (fs.existsSync(this.DATA_FILE)) {
      fs.unlinkSync(this.DATA_FILE);
      console.log('✓ Archivo de usuarios eliminado');
    }
  }
}