import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from '@factwright/sync';

/** How long a ticket to listen works. It's used at once, to open the connection. */
const TICKET_MS = 60_000;

/** AES-GCM's nonce, in bytes, which starts each ticket. */
const NONCE_BYTES = 12;

/** The key tickets are locked with, made from the server's secret. */
async function ticketKey(secret: string) {
  const raw = await crypto.subtle.digest('SHA-256', utf8(`factwright/v2/live\n${secret}`));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * A short-lived ticket to listen for an account's changes. A WebSocket can't carry a session
 * header from every client, so a device asks for a ticket with its session, then opens the
 * connection with the ticket in its address. It says which account, until when, locked with a
 * key made from the server's secret, so the address shows nothing about the account and can't be
 * changed or made up.
 */
export async function makeTicket(
  secret: string,
  account: string,
  now = Date.now(),
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const payload = utf8(JSON.stringify({ account, expires: now + TICKET_MS }));
  const locked = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await ticketKey(secret), payload),
  );
  const ticket = new Uint8Array(NONCE_BYTES + locked.length);
  ticket.set(nonce);
  ticket.set(locked, NONCE_BYTES);
  return toBase64Url(ticket);
}

/** The account a ticket is for, or null when it's forged, changed or out of date. */
export async function checkTicket(
  secret: string,
  ticket: string,
  now = Date.now(),
): Promise<string | null> {
  const bytes = fromBase64Url(ticket);
  if (!bytes || bytes.length <= NONCE_BYTES) return null;
  try {
    const payload = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, NONCE_BYTES) },
      await ticketKey(secret),
      bytes.slice(NONCE_BYTES),
    );
    const { account, expires } = JSON.parse(fromUtf8(new Uint8Array(payload)) ?? '') as {
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
