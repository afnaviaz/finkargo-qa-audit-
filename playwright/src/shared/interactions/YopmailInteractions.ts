import { BrowserContext } from 'playwright-core';

// Maildrop.cc — GraphQL API pública, sin tokens, sin sesión, sin CAPTCHA.
// Endpoint: https://api.maildrop.cc/graphql

const MAILDROP_GQL = 'https://api.maildrop.cc/graphql';
const MAX_AGE_MS   = 5 * 60 * 1000; // solo emails de los últimos 5 minutos

const FALSOS_POSITIVOS = new Set([
  'false', 'true', 'null', 'undefined', 'error', 'email', 'click',
  'inbox', 'spam', 'login', 'token', 'value', 'finkargo',
]);

interface MaildropMessage {
  id:   string;
  date: string;
}

async function gqlQuery<T>(query: string): Promise<T> {
  const resp = await fetch(MAILDROP_GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
      'User-Agent':   'Mozilla/5.0 (compatible; finkargo-qa/1.0)',
    },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${MAILDROP_GQL}`);
  const json = await resp.json() as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

async function listarMensajes(username: string): Promise<MaildropMessage[]> {
  const data = await gqlQuery<{ inbox: MaildropMessage[] }>(
    `{ inbox(mailbox: "${username}") { id date } }`
  );
  return Array.isArray(data.inbox) ? data.inbox : [];
}

async function obtenerContenido(username: string, id: string): Promise<string> {
  const data = await gqlQuery<{ message: { html?: string } }>(
    `{ message(mailbox: "${username}", id: "${id}") { html } }`
  );
  return data.message?.html ?? '';
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
  static async obtenerCodigoVerificacion(
    _context: BrowserContext | null,
    email: string,
    maxWaitMs = 90_000
  ): Promise<string> {
    const username  = email.split('@')[0];
    const POLL_MS   = 7_000;
    const start     = Date.now();
    const freshFrom = start - MAX_AGE_MS; // ignora emails anteriores a este timestamp

    console.log(`Esperando OTP en Maildrop para: ${email}`);
    console.log(`  Solo acepta emails posteriores a: ${new Date(freshFrom).toISOString()}`);

    while (Date.now() - start < maxWaitMs) {
      try {
        const mensajes = await listarMensajes(username);
        const elapsed  = Math.round((Date.now() - start) / 1000);

        // Filtra solo emails recientes y ordena del más nuevo al más viejo
        const recientes = mensajes
          .filter(m => new Date(m.date).getTime() >= freshFrom)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        if (recientes.length > 0) {
          const ultimo = recientes[0];
          console.log(`  Email reciente — id: ${ultimo.id} | fecha: ${ultimo.date}`);

          const cuerpo = await obtenerContenido(username, ultimo.id);
          const otp    = extraerOtp(cuerpo);

          if (otp) {
            console.log(`✓ OTP encontrado: ${otp}`);
            return otp;
          }
          console.log('  Email sin OTP reconocible — esperando más correos...');
        } else {
          const total = mensajes.length;
          console.log(`  Sin emails recientes (${elapsed}s) — ${total} en inbox pero fuera de ventana — reintentando en ${POLL_MS / 1000}s...`);
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
