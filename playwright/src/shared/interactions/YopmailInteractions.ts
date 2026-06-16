import { BrowserContext } from 'playwright-core';

// Yopmail vía HTTP — sin Playwright, sin CAPTCHA.
// Flujo: init session → cargar wm?login=X (obtiene yp/yj) → GET /es/inbox → leer mensaje

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FALSOS_POSITIVOS = new Set([
  'false', 'true', 'null', 'undefined', 'error', 'email', 'click',
  'inbox', 'spam', 'yopmail', 'login', 'token', 'value', 'finkargo',
]);

// ── Cookie helpers ────────────────────────────────────────────────────────────

function parseCookieHeader(raw: string | null): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!raw) return jar;
  // Set-Cookie puede venir como múltiples entradas separadas por coma en algunos casos
  for (const part of raw.split(/,(?=[^ ])/)) {
    const [kv] = part.trim().split(';');
    const eq = kv.indexOf('=');
    if (eq > 0) jar[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
  }
  return jar;
}

function cookieString(jar: Record<string, string>): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function httpGet(
  url: string,
  cookieJar: Record<string, string>,
  referer?: string
): Promise<{ body: string; newCookies: Record<string, string> }> {
  const headers: Record<string, string> = {
    'User-Agent':      UA,
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Cache-Control':   'no-cache',
  };
  if (referer) headers['Referer'] = referer;
  if (Object.keys(cookieJar).length) headers['Cookie'] = cookieString(cookieJar);

  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);

  // Acumular cookies de la respuesta
  const setCookie = resp.headers.get('set-cookie');
  const newCookies = parseCookieHeader(setCookie);

  return { body: await resp.text(), newCookies };
}

// ── Yopmail session ───────────────────────────────────────────────────────────

interface YopmailSession {
  jar: Record<string, string>;
  yp:  string;
  yj:  string;
}

async function crearSesion(username: string): Promise<YopmailSession> {
  let jar: Record<string, string> = {};

  // Paso 1: página principal → cookies iniciales (yc, etc.)
  const step1 = await httpGet('https://yopmail.com/es/', jar);
  jar = { ...jar, ...step1.newCookies };

  // Paso 2: webmail del usuario → cookies de sesión (ywm, yses) + tokens yp/yj
  jar['ywm'] = username;  // anticipamos la cookie del usuario
  const step2 = await httpGet(
    `https://yopmail.com/es/wm?login=${encodeURIComponent(username)}`,
    jar,
    'https://yopmail.com/es/'
  );
  jar = { ...jar, ...step2.newCookies };
  jar['ywm'] = username;  // asegurar que persiste

  // Extraer tokens yp y yj del HTML de la página wm
  const ypMatch = step2.body.match(/[?&]yp=([A-Za-z0-9+/=_-]+)/);
  const yjMatch = step2.body.match(/[?&]yj=([A-Za-z0-9+/=_-]+)/);
  const yp = ypMatch?.[1] ?? '';
  const yj = yjMatch?.[1] ?? '';

  console.log(`  Sesión Yopmail iniciada — yp: ${yp ? yp.substring(0, 8) + '...' : '(vacío)'}, yj: ${yj ? yj.substring(0, 8) + '...' : '(vacío)'}`);

  return { jar, yp, yj };
}

async function listarMensajes(username: string, session: YopmailSession): Promise<string[]> {
  const params = new URLSearchParams({
    login: username, p: '1', d: '', ctrl: '',
    yp: session.yp, yj: session.yj,
    v: '9.3', r_c: '', id: '', ad: '0',
  });
  const url = `https://yopmail.com/es/inbox?${params}`;
  const { body } = await httpGet(url, session.jar, 'https://yopmail.com/es/wm');

  if (body.toLowerCase().includes('recaptcha')) {
    console.warn('  ⚠ CAPTCHA detectado incluso en HTTP');
    return [];
  }

  // Mensaje IDs: aparecen como <div id="mXXXX" ...> o similares
  const ids = Array.from(body.matchAll(/\bid="(m[a-zA-Z0-9]+)"/g))
    .map(m => m[1])
    .filter(id => id !== 'mails' && id !== 'msgundo');

  console.log(`  HTML inbox (300): ${body.substring(0, 300).replace(/\s+/g, ' ')}`);
  return ids;
}

async function obtenerContenido(username: string, msgId: string, session: YopmailSession): Promise<string> {
  const params = new URLSearchParams({
    login: username, yp: session.yp, yj: session.yj,
    id: msgId, v: '9.3',
  });
  const url = `https://yopmail.com/es/mail?${params}`;
  const { body } = await httpGet(url, session.jar, 'https://yopmail.com/es/wm');
  return body;
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

    // Crear sesión una vez y reutilizarla en el polling
    let session: YopmailSession | null = null;
    try {
      session = await crearSesion(username);
    } catch (err) {
      console.warn(`  ⚠ No se pudo crear sesión inicial: ${err} — reintentando en cada poll`);
    }

    while (Date.now() - start < maxWaitMs) {
      try {
        if (!session) session = await crearSesion(username);

        const msgIds  = await listarMensajes(username, session);
        const elapsed = Math.round((Date.now() - start) / 1000);

        if (msgIds.length > 0) {
          console.log(`  ${msgIds.length} mensaje(s) — leyendo: ${msgIds[0]}`);
          const contenido = await obtenerContenido(username, msgIds[0], session);
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
        console.log(`  Error (${elapsed}s): ${err} — reseteando sesión y reintentando...`);
        session = null;  // forzar re-sesión en el próximo intento
      }

      await new Promise(r => setTimeout(r, POLL_MS));
    }

    throw new Error(`OTP de Yopmail no llegó en ${maxWaitMs / 1000}s para ${email}`);
  }
}
