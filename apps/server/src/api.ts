import {
  type AccountInfo,
  API,
  type Device,
  type ErrorBody,
  isCommitment,
  isFileId,
  isKeyId,
  isLinkId,
  isOneTimeKey,
  isRecordId,
  isRequestId,
  isSealedKey,
  LIMITS,
  type PushChange,
} from '@factwright/sync';
import type { Auth } from './auth.ts';
import { deviceName } from './auth-options.ts';
import type { Env } from './env.ts';
import { checkTicket, makeTicket } from './live.ts';
import { type Asker, DELETED, SLOW_DOWN, type UserStore } from './store.ts';

/** What the store throws before it writes anything, after which an upload's copy can go. */
const REFUSED_BEFORE_WRITING = new Set([DELETED, SLOW_DOWN]);

import { filesPrefix } from './store-tables.ts';

const BASE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/** What locking adds to a file: a version byte, the nonce and the tag. */
const LOCK_OVERHEAD = 1 + 12 + 16;

/** The most a request with a small JSON body may send. */
const SMALL_BODY = 64 * 1024;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json', ...headers },
  });
}

const empty = (status = 204) => new Response(null, { status, headers: BASE_HEADERS });

export const failure = (
  status: number,
  error: string,
  message: string,
  headers: Record<string, string> = {},
) => json({ error, message } satisfies ErrorBody, status, headers);

const NOT_FOUND = () => failure(404, 'not-found', 'There’s nothing here.');

/** A request the server won't take as sent. */
class Refused extends Error {}

/** A request bigger than the server takes. */
class TooBig extends Error {}

async function readJson(request: Request, maxChars: number): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') ?? 0) > maxChars) throw new TooBig();
  const text = await request.text();
  if (text.length > maxChars) throw new TooBig();
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Not JSON.
  }
  throw new Refused('That wasn’t the JSON the server takes.');
}

function parsePush(body: Record<string, unknown>): PushChange[] {
  const { changes } = body;
  if (!Array.isArray(changes) || changes.length > LIMITS.changesPerPush) {
    throw new Refused(`Push at most ${LIMITS.changesPerPush} changes at once.`);
  }
  return changes.map((change: unknown) => {
    const { record, base, data, file, deleted } = (change ?? {}) as Record<string, unknown>;
    if (
      !isRecordId(record) ||
      typeof base !== 'number' ||
      !Number.isSafeInteger(base) ||
      base < 0 ||
      typeof data !== 'string' ||
      data.length === 0 ||
      data.length > LIMITS.recordChars ||
      !(file === null || isFileId(file)) ||
      typeof deleted !== 'boolean'
    ) {
      throw new Refused('A change wasn’t in the shape the server takes.');
    }
    return { record, base, data, file, deleted };
  });
}

/** Who's asking, from their verified session, and their account's store. */
interface Caller {
  request: Request;
  url: URL;
  env: Env;
  auth: Auth;
  account: string;
  user: { id: string; email: string; name: string; createdAt: Date };
  session: { id: string; userAgent?: string | null | undefined; createdAt: Date | string };
  store: DurableObjectStub<UserStore>;
}

type Handler = (caller: Caller, params: string[]) => Promise<Response> | Response;

const getKeys: Handler = async ({ store, account }) => json({ keys: await store.keys(account) });

const putKeys: Handler = async ({ request, store, account }) => {
  const { keyId, recovery } = await readJson(request, SMALL_BODY);
  if (!isKeyId(keyId) || typeof recovery !== 'string' || recovery.length > 200) {
    throw new Refused('The keys weren’t in the shape the server takes.');
  }
  const saved = await store.saveKeys(account, keyId, recovery);
  return saved === 'saved'
    ? empty()
    : failure(409, 'taken', 'Another device already set up sync for this account.');
};

const getChanges: Handler = async ({ url, store, account }) => {
  const since = Number(url.searchParams.get('since') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? LIMITS.changesPerPage);
  if (!Number.isSafeInteger(since) || !Number.isSafeInteger(limit)) {
    throw new Refused('Ask for changes since a number.');
  }
  return json(await store.changes(account, since, limit));
};

const postChanges: Handler = async ({ request, store, account, session }) => {
  const changes = parsePush(await readJson(request, LIMITS.pushChars));
  return json({ results: await store.push(account, session.id, changes) });
};

const getVersions: Handler = async ({ store, account }, [record]) => {
  if (!isRecordId(record)) return NOT_FOUND();
  return json({ versions: await store.versions(account, record) });
};

const getVersion: Handler = async ({ store, account }, [record, number]) => {
  const version = Number(number);
  if (!isRecordId(record) || !Number.isSafeInteger(version)) return NOT_FOUND();
  const change = await store.version(account, record, version);
  return change ? json(change) : NOT_FOUND();
};

const postMissingFiles: Handler = async ({ request, store, account }) => {
  const { ids } = await readJson(request, LIMITS.filesPerCheck * 50);
  if (!Array.isArray(ids) || ids.length > LIMITS.filesPerCheck || !ids.every(isFileId)) {
    throw new Refused(`Check at most ${LIMITS.filesPerCheck} file IDs at once.`);
  }
  return json({ missing: await store.missingFiles(account, ids) });
};

const putFile: Handler = async ({ request, env, store, account }, [id]) => {
  if (!isFileId(id)) return NOT_FOUND();
  const size = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size <= 0) {
    return failure(411, 'length-required', 'Send the file’s length.');
  }
  if (size > LIMITS.fileBytes + LOCK_OVERHEAD) {
    return failure(413, 'too-big', 'Files over 25 MB don’t sync.');
  }
  // A key of its own for each upload, so the daily cleanup can never remove a new copy.
  const key = `${filesPrefix(account)}${id}.${crypto.randomUUID()}`;
  const object = await env.FILES.put(key, request.body, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });
  if (!object || object.size !== size) {
    await env.FILES.delete(key);
    throw new Refused('The upload was cut short.');
  }
  // A copy the store didn't take is deleted at once: refused, or a duplicate. After any other
  // error the store may have kept it, so it stays.
  const result = await store.fileStored(account, id, key, size).catch(async (error: unknown) => {
    if (error instanceof Error && REFUSED_BEFORE_WRITING.has(error.message)) {
      await env.FILES.delete(key);
    }
    throw error;
  });
  if (result !== 'stored') await env.FILES.delete(key);
  if (result === 'full') return failure(507, 'full', 'Your account is out of space.');
  return empty(result === 'stored' ? 201 : 200);
};

const getFile: Handler = async ({ env, store, account }, [id]) => {
  if (!isFileId(id)) return NOT_FOUND();
  const key = await store.fileKey(account, id);
  const object = key ? await env.FILES.get(key) : null;
  if (!object) return NOT_FOUND();
  return new Response(object.body, {
    headers: {
      ...BASE_HEADERS,
      'content-type': 'application/octet-stream',
      'content-length': String(object.size),
      // An ID names its contents, so they never change.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
};

const postLink: Handler = async ({ request, store, account }) => {
  const { id, data } = await readJson(request, SMALL_BODY);
  if (!isLinkId(id) || typeof data !== 'string' || data.length > 200) {
    throw new Refused('The link wasn’t in the shape the server takes.');
  }
  const saved = await store.saveLink(account, id, data);
  return saved === 'saved'
    ? empty(201)
    : failure(429, 'too-many', 'Too many link codes are waiting. Try again in a few minutes.');
};

const takeLink: Handler = async ({ store, account }, [id]) => {
  if (!isLinkId(id)) return NOT_FOUND();
  const data = await store.takeLink(account, id);
  return data ? json({ data }) : NOT_FOUND();
};

const deleteLink: Handler = async ({ store, account }, [id]) => {
  if (!isLinkId(id)) return NOT_FOUND();
  await store.cancelLink(account, id);
  return empty();
};

/** Who's taking part in linking a device: this session, by the name the account page gives it. */
const askerOf = ({ session }: Caller): Asker => ({
  session: session.id,
  device: deviceName(session.userAgent),
  signedIn: new Date(session.createdAt).getTime(),
});

/** Why a step of linking a device didn't happen, for each way it can't. */
const GONE = () =>
  failure(
    404,
    'not-found',
    'That request to link is gone. It may have run out or been called off.',
  );

const postRequest: Handler = async (caller) => {
  const { request, store, account } = caller;
  const { id, commitment } = await readJson(request, SMALL_BODY);
  if (!isRequestId(id) || !isCommitment(commitment)) {
    throw new Refused('The request to link wasn’t in the shape the server takes.');
  }
  const asker = askerOf(caller);
  // Only soon after signing in, so a sign-in someone was tricked into long ago can't ask.
  if (!(Date.now() - asker.signedIn <= LIMITS.askWithinMinutes * 60_000)) {
    return failure(
      403,
      'stale',
      'This device signed in a while ago, so it can’t ask to be approved. Sign in again, or type a code.',
    );
  }
  const made = await store.askToLink(account, asker, id, commitment);
  switch (made) {
    case 'made':
      return empty(201);
    case 'taken':
      return failure(409, 'taken', 'A request to link with that ID is already waiting.');
    case 'too-many':
      return failure(
        429,
        'too-many',
        'Too many devices are asking to link right now. Try again in a few minutes.',
      );
    case 'too-often':
      return failure(
        429,
        'too-often',
        'That’s a lot of requests to link in an hour. Try again later, or use a code.',
      );
  }
};

const getRequests: Handler = async ({ store, account, session }) =>
  json({ requests: await store.linkRequests(account, session.id) });

const getRequest: Handler = async ({ store, account, session }, [id]) => {
  if (!isRequestId(id)) return GONE();
  const found = await store.linkRequest(account, session.id, id);
  return found ? json(found) : GONE();
};

const postApprover: Handler = async (caller, [id]) => {
  const { request, store, account } = caller;
  if (!isRequestId(id)) return GONE();
  const { key } = await readJson(request, SMALL_BODY);
  if (!isOneTimeKey(key)) throw new Refused('That key wasn’t in the shape the server takes.');
  const offered = await store.offerToApprove(account, askerOf(caller), id, key);
  if (offered === 'offered') return empty();
  if (offered === 'not-found') return GONE();
  return offered === 'own'
    ? failure(403, 'refused', 'A device can’t approve its own request to link.')
    : failure(409, 'taken', 'Another device is approving it.');
};

const postKey: Handler = async ({ request, store, account, session }, [id]) => {
  if (!isRequestId(id)) return GONE();
  const { key } = await readJson(request, SMALL_BODY);
  if (!isOneTimeKey(key)) throw new Refused('That key wasn’t in the shape the server takes.');
  const shown = await store.showKey(account, session.id, id, key);
  if (shown === 'shown') return empty();
  return shown === 'not-found'
    ? GONE()
    : failure(
        403,
        'refused',
        'Only the device that asked shows its key, once a device offers to approve.',
      );
};

const postApprove: Handler = async ({ request, store, account, session }, [id]) => {
  if (!isRequestId(id)) return GONE();
  const { sealed } = await readJson(request, SMALL_BODY);
  if (!isSealedKey(sealed)) throw new Refused('That wasn’t in the shape the server takes.');
  const approved = await store.approveRequest(account, session.id, id, sealed);
  if (approved === 'approved') return empty();
  return approved === 'not-found'
    ? GONE()
    : failure(
        403,
        'refused',
        'Only the device approving it can, once the new device shows its key.',
      );
};

const postDeny: Handler = async ({ request, env, store, account, session }, [id]) => {
  if (!isRequestId(id)) return GONE();
  // Older devices turn a request down with nothing more to say.
  if (Number(request.headers.get('content-length') ?? 0) > SMALL_BODY) throw new TooBig();
  const text = await request.text();
  if (text.length > SMALL_BODY) throw new TooBig();
  let signOut = false;
  try {
    signOut = text !== '' && (JSON.parse(text) as { signOut?: unknown }).signOut === true;
  } catch {
    throw new Refused('That wasn’t the JSON the server takes.');
  }
  const denied = await store.denyRequest(account, session.id, id);
  if (denied === 'not-found') return GONE();
  if (denied === 'own')
    return failure(403, 'refused', 'A device calls its own request off instead.');
  // Not the person's device: it's signed out of the account too.
  if (signOut) {
    await env.DB.prepare('DELETE FROM "session" WHERE id = ? AND userId = ?')
      .bind(denied.denied, account)
      .run();
  }
  return empty();
};

const postTake: Handler = async ({ store, account, session }, [id]) => {
  if (!isRequestId(id)) return GONE();
  const sealed = await store.takeApproval(account, session.id, id);
  return sealed ? json({ sealed }) : GONE();
};

const deleteRequest: Handler = async ({ store, account, session }, [id]) => {
  if (!isRequestId(id)) return GONE();
  await store.cancelRequest(account, session.id, id);
  return empty();
};

const postLiveTicket: Handler = async ({ env, account }) =>
  json({ ticket: await makeTicket(env.BETTER_AUTH_SECRET, account) });

/** A session row's time, which the accounts database keeps as ISO text. */
const isoOf = (value: unknown) => new Date(value as string | number).toISOString();

/**
 * The account's signed-in devices: each session that hasn't run out, most recently used first.
 * Read straight from the sessions table, since Better Auth's own list needs a fresh sign-in.
 */
async function devicesOf({ env, account, session }: Caller): Promise<Device[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, userAgent, createdAt, updatedAt, expiresAt FROM "session" WHERE userId = ?',
  )
    .bind(account)
    .all<{
      id: string;
      userAgent: string | null;
      createdAt: string;
      updatedAt: string;
      expiresAt: string;
    }>();
  const now = Date.now();
  return results
    .filter((row) => new Date(row.expiresAt).getTime() > now)
    .map((row) => ({
      id: row.id,
      name: deviceName(row.userAgent),
      current: row.id === session.id,
      lastActive: isoOf(row.updatedAt),
      since: isoOf(row.createdAt),
    }))
    .sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}

const getAccount: Handler = async (caller) => {
  const { user, store, account } = caller;
  const devices = await devicesOf(caller);
  const info: AccountInfo = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      since: new Date(user.createdAt).toISOString(),
    },
    devices,
    usage: await store.usage(account),
  };
  return json(info);
};

const deleteDevice: Handler = async ({ env, account }, [id]) => {
  const { meta } = await env.DB.prepare('DELETE FROM "session" WHERE id = ? AND userId = ?')
    .bind(id, account)
    .run();
  return meta.changes > 0 ? empty() : NOT_FOUND();
};

const getExport: Handler = async (caller) => {
  const { user, store, account } = caller;
  const devices = await devicesOf(caller);
  const body = {
    about:
      'Your Factwright account, as the sync server keeps it. Records and files are locked with your account key; the Factwright app or web view can open them with your recovery key.',
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email, name: user.name },
    devices,
    store: await store.exportAll(account),
  };
  return json(body, 200, {
    'content-disposition': 'attachment; filename="factwright-account.json"',
  });
};

const ROUTES: [method: string, pattern: RegExp, handler: Handler][] = [
  ['GET', /^\/api\/sync\/keys$/, getKeys],
  ['PUT', /^\/api\/sync\/keys$/, putKeys],
  ['GET', /^\/api\/sync\/changes$/, getChanges],
  ['POST', /^\/api\/sync\/changes$/, postChanges],
  ['GET', /^\/api\/sync\/records\/([^/]+)\/versions$/, getVersions],
  ['GET', /^\/api\/sync\/records\/([^/]+)\/versions\/([^/]+)$/, getVersion],
  ['POST', /^\/api\/sync\/files\/missing$/, postMissingFiles],
  ['PUT', /^\/api\/sync\/files\/([^/]+)$/, putFile],
  ['GET', /^\/api\/sync\/files\/([^/]+)$/, getFile],
  ['POST', /^\/api\/sync\/links$/, postLink],
  ['POST', /^\/api\/sync\/links\/([^/]+)\/take$/, takeLink],
  ['DELETE', /^\/api\/sync\/links\/([^/]+)$/, deleteLink],
  ['POST', /^\/api\/sync\/requests$/, postRequest],
  ['GET', /^\/api\/sync\/requests$/, getRequests],
  ['GET', /^\/api\/sync\/requests\/([^/]+)$/, getRequest],
  ['DELETE', /^\/api\/sync\/requests\/([^/]+)$/, deleteRequest],
  ['POST', /^\/api\/sync\/requests\/([^/]+)\/approver$/, postApprover],
  ['POST', /^\/api\/sync\/requests\/([^/]+)\/key$/, postKey],
  ['POST', /^\/api\/sync\/requests\/([^/]+)\/approve$/, postApprove],
  ['POST', /^\/api\/sync\/requests\/([^/]+)\/deny$/, postDeny],
  ['POST', /^\/api\/sync\/requests\/([^/]+)\/take$/, postTake],
  ['POST', /^\/api\/sync\/live\/ticket$/, postLiveTicket],
  ['GET', /^\/api\/account$/, getAccount],
  ['DELETE', /^\/api\/account\/devices\/([^/]+)$/, deleteDevice],
  ['GET', /^\/api\/account\/export$/, getExport],
];

/** A device listening for changes, with a ticket it got from its session. */
async function listen(request: Request, env: Env, url: URL): Promise<Response> {
  const account = await checkTicket(env.BETTER_AUTH_SECRET, url.searchParams.get('ticket') ?? '');
  if (!account)
    return failure(401, 'signed-out', 'That ticket isn’t good anymore. Ask for another.');
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return failure(426, 'upgrade', 'Listen over a WebSocket.');
  }
  const headers = new Headers(request.headers);
  headers.set('x-factwright-account', account);
  return env.STORES.get(env.STORES.idFromName(account))
    .fetch(new Request(request, { headers }))
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === DELETED) {
        return failure(401, 'signed-out', 'This account was deleted.');
      }
      throw error;
    });
}

/**
 * Whether a change a browser sends with its cookie comes from the app's own pages. Browsers
 * attach the cookie for some requests other sites start, but always say where those came from.
 */
function fromAppPages(request: Request, env: Env): boolean {
  if (request.method === 'GET' || !request.headers.has('cookie')) return true;
  return request.headers.get('origin') === new URL(env.APP_URL).origin;
}

/** Answers the API, for the account the request's session belongs to and no other. */
export async function handleApi(request: Request, env: Env, auth: Auth): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === API.live) return listen(request, env, url);
  const route = ROUTES.find(
    ([method, pattern]) => method === request.method && pattern.test(url.pathname),
  );
  const known = ROUTES.some(([, pattern]) => pattern.test(url.pathname));
  if (!route) return known ? failure(405, 'method', 'That isn’t allowed here.') : NOT_FOUND();
  if (!fromAppPages(request, env)) {
    return failure(403, 'refused', 'That came from another site, so it wasn’t done.');
  }
  const signedIn = await auth.api.getSession({ headers: request.headers });
  if (!signedIn) return failure(401, 'signed-out', 'Sign in again.');
  const [, pattern, handler] = route;
  const params = (pattern.exec(url.pathname) ?? []).slice(1).map(decodeURIComponent);
  const account = signedIn.user.id;
  const caller: Caller = {
    request,
    url,
    env,
    auth,
    account,
    user: signedIn.user,
    session: signedIn.session,
    store: env.STORES.get(env.STORES.idFromName(account)),
  };
  try {
    return await handler(caller, params);
  } catch (error) {
    if (error instanceof Refused) return failure(400, 'refused', error.message);
    if (error instanceof TooBig) return failure(413, 'too-big', 'That request is too big.');
    if (error instanceof Error && error.message === DELETED) {
      return failure(401, 'signed-out', 'This account was deleted.');
    }
    if (error instanceof Error && error.message === SLOW_DOWN) {
      return failure(429, 'slow-down', 'Too many requests. Wait a moment, then try again.', {
        'retry-after': '10',
      });
    }
    throw error;
  }
}
