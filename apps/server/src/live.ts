import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from '@factwright/sync';

/** How long a ticket to listen works. It's used at once, to open the connection. */
const TICKET_MS = 60_000;

const signingKey = (secret: string) =>
  crypto.subtle.importKey(
    'raw',
    utf8(`factwright/v1/live\n${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

/**
 * A short-lived ticket to listen for an account's changes. A WebSocket can't carry a session
 * header from every client, so a device asks for a ticket with its session, then opens the
 * connection with the ticket. It says which account, until when, signed with the server's secret.
 */
export async function makeTicket(
  secret: string,
  account: string,
  now = Date.now(),
): Promise<string> {
  const payload = utf8(JSON.stringify({ account, expires: now + TICKET_MS }));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), payload);
  return `${toBase64Url(payload)}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The account a ticket is for, or null when it's forged, changed or out of date. */
export async function checkTicket(
  secret: string,
  ticket: string,
  now = Date.now(),
): Promise<string | null> {
  const [payloadText, signatureText, extra] = ticket.split('.');
  if (!payloadText || !signatureText || extra !== undefined) return null;
  const payload = fromBase64Url(payloadText);
  const signature = fromBase64Url(signatureText);
  if (!payload || !signature) return null;
  if (!(await crypto.subtle.verify('HMAC', await signingKey(secret), signature, payload)))
    return null;
  try {
    const { account, expires } = JSON.parse(fromUtf8(payload) ?? '') as {
      account?: unknown;
      expires?: unknown;
    };
    return typeof account === 'string' && typeof expires === 'number' && expires > now
      ? account
      : null;
  } catch {
    return null;
  }
}
