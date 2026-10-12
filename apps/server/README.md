# Sync server

A Cloudflare Worker that handles sign-in and keeps each account's encrypted data. It only ever sees locked data and opaque IDs. The design is in [docs/security.md](../../docs/security.md).

- **One private store per account:** a Durable Object with its own database, plus a folder of encrypted files in R2.
- **Identity from the session:** the account always comes from the verified session, never from the request.
- **Sign-in:** [Better Auth](https://www.better-auth.com), with GitHub or Google. The desktop app signs in with a device code you approve in your browser. Accounts and sessions live in D1, with GitHub's and Google's tokens encrypted.
- **The web view too:** it serves [the web view](../web), so the phone, sign-in and the API share one address.

| Part | What it does |
|---|---|
| `src/index.ts` | Routes each request: sign-in, the API, the web view, the operator's restore, and the daily backup |
| `src/auth-options.ts`, `src/auth.ts` | Sign-in's settings, and device names for the account page |
| `src/api.ts` | The sync API, for the signed-in account only |
| `src/store.ts` | One account's store: records with their history, files, the locked account key and link codes |
| `src/store-tables.ts` | The store's tables |
| `src/store-upkeep.ts` | Daily backups, restoring one, and the daily cleanup |
| `src/live.ts` | Tickets for listening to changes as they happen |
| `migrations/` | The accounts database, as Better Auth's own tool writes it (`pnpm schema`) |

## The API
Every route answers only the account of the session that calls it. The desktop app sends its session as a bearer token, and the web view as a cookie. A change sent with the cookie must come from the app's own pages, so another site can't make a signed-in browser act.

| Route | What it does |
|---|---|
| `GET`, `PUT /api/sync/keys` | The account key, locked with the recovery key. The first device saves it |
| `GET /api/sync/changes?since=` | Each record's newest version after a point in the account's history, a page at a time |
| `POST /api/sync/changes` | New versions of records, each made from the version its device saw. A stale one comes back as a conflict |
| `GET /api/sync/records/:id/versions[/:n]` | A record's earlier versions, kept for 90 days |
| `POST /api/sync/files/missing`, `PUT`, `GET /api/sync/files/:id` | Locked file contents, stored once each |
| `POST /api/sync/links`, `POST /api/sync/links/:id/take` | Link codes, for adding a device. Each works once, for 10 minutes |
| `POST /api/sync/live/ticket`, `GET /api/sync/live` | Listening for changes, over a WebSocket |
| `GET /api/account`, `DELETE /api/account/devices/:id` | Who you are, your signed-in devices, and how much you store |
| `GET /api/account/export` | Everything the server keeps for your account, still locked |
| `GET /api/sign-in-options` | The ways to sign in this server has set up. Anyone can ask |
| `POST /api/auth/delete-user` | Deletes the account and everything in it. It needs a sign-in in the last 15 minutes |

## Limits
- 1 GB per account (`STORAGE_LIMIT_MB`) and 25 MB per file.
- Bursts of 600 requests per account, refilling at 10 a second.
- Sign-in requests are limited per IP address, more tightly for signing in.

## Running it locally
```bash
cp apps/server/.dev.vars.example apps/server/.dev.vars   # then fill in a secret
pnpm --filter @factwright/server exec wrangler d1 migrations apply factwright --local
pnpm --filter @factwright/server dev
```

It builds the web view, then serves everything at http://localhost:8787. Signing in needs a GitHub OAuth app of your own, with the callback in `.dev.vars.example`. To try the desktop app against it, start the app with `FACTWRIGHT_SERVER_URL=http://localhost:8787`.

`dev` keeps the local address on each request (`--local-upstream`). Without it, Wrangler rewrites requests to the production address in `wrangler.jsonc`, and sign-in turns them away as coming from somewhere else.

The tests run the real Worker in workerd, through Wrangler's test harness, and talk to it with the same client the apps use:

```bash
pnpm --filter @factwright/server test
```

## Deploying
It runs on Cloudflare's free plan. The first deploy creates the database, the file bucket and the `app.factwright.com` address on its own.

1. Sign in to the Cloudflare account that has factwright.com: `pnpm --filter @factwright/server exec wrangler login`.
2. Deploy: `pnpm --filter @factwright/server run deploy`. It builds the web view first.
3. Set up the accounts database: `pnpm --filter @factwright/server exec wrangler d1 migrations apply factwright --remote`.
4. Set the secret that signs sessions: `openssl rand -base64 32 | pnpm --filter @factwright/server exec wrangler secret put BETTER_AUTH_SECRET`.
5. Make a GitHub OAuth app (in the factwright org's settings, under Developer settings) with the callback `https://app.factwright.com/api/auth/callback/github`, then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` with `wrangler secret put`.
6. Optional: a Google OAuth client, with the callback `https://app.factwright.com/api/auth/callback/google`, as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
7. Optional: an `ADMIN_TOKEN` secret, to restore an account's store from a backup.

### Restoring an account
Each store is backed up to R2 every day, and kept for 14 days. To put one back as it was on a day, with `ADMIN_TOKEN` set:

```bash
curl -X POST https://app.factwright.com/api/admin/restore \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"account":"<account ID>","day":"2026-10-12"}'
```

Devices then pull the restored records, and push back any of their own changes the backup didn't have. Cloudflare also keeps 30 days of point-in-time recovery for each Durable Object.
