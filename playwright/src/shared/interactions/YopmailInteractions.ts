import { BrowserContext } from 'playwright-core';

// Yopmail vía HTTP — sin Playwright, sin CAPTCHA.
// Flujo: init session → cargar wm?login=X (obtiene yp/yj) → GET /es/inbox → leer mensaje

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FALSOS_POSITIVOS = new Set([
  'false', 'true', 'null', 'undefined', 'error', 'email', 'click',
  'inbox', 'spam', 'yopmail', 'login', 'token', 'value', 'finkargo',
]);

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function httpGet(url: string, cookie: string, referer?: string): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent':      UA,
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Cache-Control':   'no-cache',
    'Referer':         referer ?? 'https://yopmail.com/es/',
  };
  if (cookie) headers['Cookie'] = cookie;

  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.text();
}

// ── Yopmail inbox ─────────────────────────────────────────────────────────────
// Yopmail es público: cualquiera puede leer cualquier inbox conociendo el username.
// Solo necesitamos ywm=USERNAME como cookie — no acumulamos cookies de tracking
// (que causan 414 por headers demasiado grandes).

async function listarMensajes(username: string): Promise<string[]> {
  // yp y yj son tokens de analytics — probar sin ellos primero
  const url = `https://yopmail.com/es/inbox?login=${encodeURIComponent(username)}&p=1&d=&ctrl=&yp=&yj=&v=9.3&r_c=&id=&ad=0`;
  const body = await httpGet(url, `ywm=${username}`, 'https://yopmail.com/es/wm');

  if (body.toLowerCase().includes('recaptcha')) {
    console.warn('  ⚠ CAPTCHA en respuesta HTTP');
    return [];
  }

  console.log(`  HTML inbox (300): ${body.substring(0, 300).replace(/\s+/g, ' ')}`);

  return Array.from(body.matchAll(/\bid="(m[a-zA-Z0-9]+)"/g))
    .map(m => m[1])
    .filter(id => id !== 'mails' && id !== 'msgundo');
}

async function obtenerContenido(username: string, msgId: string): Promise<string> {
  const url = `https://yopmail.com/es/mail?login=${encodeURIComponent(username)}&id=${msgId}&yp=&yj=&v=9.3`;
  return httpGet(url, `ywm=${username}`, 'https://yopmail.com/es/wm');
}

// ── OTP extractor ─────────────────────────────────────────────────────────────

function extraerOtp(html: string): string | null {
  const texto = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const num = texto.match(/\b(\d{4,6})\b/);
  if (num) return num[1];
  for (const m of texto.matchAll(/\b([A-Z0-9]{6,8})\b/gi)) {
    if (!FALSOS_POSITIVOS.has(m[1].toLowerCase())) return m[1];
  }
  return null;
}

// ── Clase pública ─────────────────────────────────────────────────────────────

export class YopmailInteractions {
  /**
   * Obtiene el OTP desde Yopmail vía HTTP directo.
   * _context se mantiene por compatibilidad pero no se usa.
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
          console.log(`  ${msgIds.length} mensaje(s) — leyendo: ${msgIds[0]}`);
          const contenido = await obtenerContenido(username, msgIds[0]);
          const otp = extraerOtp(contenido);
          if (otp) {
            console.log(`✓ OTP encontrado: ${otp}`);
            return otp;
          }
          console.log('  Mensaje sin OTP reconocible — esperando siguiente...');
        } else {
          console.log(`  Inbox vacío (${elapsed}s) — reintentando en ${POLL_MS / 1000}s...`);
        }
      } catch (err) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(`  Error (${elapsed}s): ${err} — reintentando...`);
      }

      await new Promise(r => setTimeout(r, POLL_MS));
    }

    throw new Error(`OTP de Yopmail no llegó en ${maxWaitMs / 1000}s para ${email}`);
  }
}
