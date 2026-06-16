import { BrowserContext } from 'playwright-core';

// Yopmail vía HTTP puro — sin Playwright, sin CAPTCHA.
// Node fetch() no tiene fingerprint de Chromium headless, el reCAPTCHA no se activa.

const HTTP_HEADERS: Record<string, string> = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
};

const FALSOS_POSITIVOS = new Set([
  'false', 'true', 'null', 'undefined', 'error', 'email', 'click',
  'inbox', 'spam', 'yopmail', 'login', 'token', 'value', 'finkargo',
]);

async function httpGet(url: string): Promise<string> {
  const resp = await fetch(url, { headers: HTTP_HEADERS });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.text();
}

function extraerOtp(html: string): string | null {
  const texto = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

  // 1. Numérico de 4-6 dígitos (OTP estándar)
  const num = texto.match(/\b(\d{4,6})\b/);
  if (num) return num[1];

  // 2. Alfanumérico de 6-8 chars excluyendo palabras comunes
  for (const m of texto.matchAll(/\b([A-Z0-9]{6,8})\b/gi)) {
    if (!FALSOS_POSITIVOS.has(m[1].toLowerCase())) return m[1];
  }
  return null;
}

async function listarMensajes(username: string): Promise<string[]> {
  const html = await httpGet(
    `https://yopmail.com/es/mail.php?login=${encodeURIComponent(username)}&domain=yopmail.com&f=&p=1`
  );
  if (html.toLowerCase().includes('recaptcha') || html.toLowerCase().includes('captcha')) {
    console.warn('  ⚠ CAPTCHA detectado en respuesta HTTP — Yopmail puede estar bloqueando esta IP');
    return [];
  }
  return Array.from(html.matchAll(/\bid="m([a-zA-Z0-9]+)"/g)).map(m => m[1]);
}

async function obtenerContenido(username: string, msgId: string): Promise<string> {
  return httpGet(
    `https://yopmail.com/es/mail.php?login=${encodeURIComponent(username)}&domain=yopmail.com&id=m${msgId}&type=html`
  );
}

export class YopmailInteractions {
  /**
   * Obtiene el OTP desde Yopmail vía HTTP directo.
   * El parámetro _context se mantiene por compatibilidad con la firma existente pero no se usa.
   */
  static async obtenerCodigoVerificacion(
    _context: BrowserContext | null,
    email: string,
    maxWaitMs = 90_000
  ): Promise<string> {
    const username = email.split('@')[0];
    const POLL_MS  = 8_000;
    const start    = Date.now();

    console.log(`Consultando inbox Yopmail vía HTTP para: ${email}`);

    while (Date.now() - start < maxWaitMs) {
      try {
        const msgIds  = await listarMensajes(username);
        const elapsed = Math.round((Date.now() - start) / 1000);

        if (msgIds.length > 0) {
          console.log(`  ${msgIds.length} mensaje(s) — leyendo el más reciente...`);
          const contenido = await obtenerContenido(username, msgIds[0]);
          const preview   = contenido.replace(/<[^>]+>/g, ' ').substring(0, 300);
          console.log(`  Body preview: ${preview}`);

          const otp = extraerOtp(contenido);
          if (otp) {
            console.log(`✓ OTP encontrado: ${otp}`);
            return otp;
          }
          console.log('  Email encontrado pero sin OTP reconocible — esperando siguiente email...');
        } else {
          console.log(`  Inbox vacío (${elapsed}s) — reintentando en ${POLL_MS / 1000}s...`);
        }
      } catch (err) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(`  Error HTTP (${elapsed}s): ${err} — reintentando...`);
      }

      await new Promise(r => setTimeout(r, POLL_MS));
    }

    throw new Error(`OTP de Yopmail no llegó en ${maxWaitMs / 1000}s para ${email}`);
  }
}
