import { BrowserContext } from 'playwright-core';

// Maildrop.cc — API REST pública, sin tokens, sin sesión, sin CAPTCHA.
// Docs: https://maildrop.cc  (mailbox: {username}@maildrop.cc)

const MAILDROP_BASE = 'https://maildrop.cc/api/v2/mailbox';

const FALSOS_POSITIVOS = new Set([
  'false', 'true', 'null', 'undefined', 'error', 'email', 'click',
  'inbox', 'spam', 'login', 'token', 'value', 'finkargo',
]);

interface MaildropMessage {
  id:      string;
  from:    string;
  subject: string;
  date:    string;
}

interface MaildropMessageDetail {
  html?: { body: string };
  text?: { body: string };
}

async function apiGet<T>(url: string): Promise<T> {
  const resp = await fetch(url, {
    headers: {
      'Accept':     'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; finkargo-qa/1.0)',
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json() as Promise<T>;
}

async function listarMensajes(username: string): Promise<MaildropMessage[]> {
  const msgs = await apiGet<MaildropMessage[]>(`${MAILDROP_BASE}/${encodeURIComponent(username)}`);
  return Array.isArray(msgs) ? msgs : [];
}

async function obtenerContenido(username: string, id: string): Promise<string> {
  const msg = await apiGet<MaildropMessageDetail>(
    `${MAILDROP_BASE}/${encodeURIComponent(username)}/${encodeURIComponent(id)}`
  );
  return msg?.html?.body ?? msg?.text?.body ?? '';
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

export class YopmailInteractions {
  /**
   * Obtiene el OTP via Maildrop.cc API.
   * _context se mantiene por compatibilidad pero no se usa.
   */
  static async obtenerCodigoVerificacion(
    _context: BrowserContext | null,
    email: string,
    maxWaitMs = 90_000
  ): Promise<string> {
    const username = email.split('@')[0];
    const POLL_MS  = 7_000;
    const start    = Date.now();

    console.log(`Esperando OTP en Maildrop para: ${email}`);

    while (Date.now() - start < maxWaitMs) {
      try {
        const mensajes = await listarMensajes(username);
        const elapsed  = Math.round((Date.now() - start) / 1000);

        if (mensajes.length > 0) {
          // Leer el más reciente (último en el array)
          const ultimo = mensajes[mensajes.length - 1];
          console.log(`  Email recibido — de: ${ultimo.from} | asunto: ${ultimo.subject}`);

          const cuerpo = await obtenerContenido(username, ultimo.id);
          const otp    = extraerOtp(cuerpo);

          if (otp) {
            console.log(`✓ OTP encontrado: ${otp}`);
            return otp;
          }
          console.log('  Email sin OTP reconocible — esperando más correos...');
        } else {
          console.log(`  Inbox vacío (${elapsed}s) — reintentando en ${POLL_MS / 1000}s...`);
        }
      } catch (err) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(`  Error Maildrop (${elapsed}s): ${err} — reintentando...`);
      }

      await new Promise(r => setTimeout(r, POLL_MS));
    }

    throw new Error(`OTP no llegó en ${maxWaitMs / 1000}s para ${email}`);
  }
}
