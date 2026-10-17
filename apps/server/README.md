# Sync server

A Cloudflare Worker that handles sign-in and keeps each account's encrypted data. It only ever sees locked data and opaque IDs. The design is in [docs/security.md](../../docs/security.md).

- **One private store per account:** a Durable Object with its own database, plus a folder of encrypted files in R2.
- **Identity from the session:** the account always comes from the verified session, never from the request.
- **Sign-in:** [Better Auth](https://www.better-auth.com), with GitHub or Google. The desktop app and the browser extension, Save to Factwright, each sign in with a device code you approve in your browser, under a client ID of their own. Accounts and sessions live in D1. A session keeps the name of its device and no IP address, and GitHub's and Google's tokens aren't kept. A server of your own can let in only the GitHub accounts it lists (`ALLOWED_GITHUB_USERS`). A sign-in that doesn't work goes back to the web view, never to Better Auth's own error page: to the page that started it, such as the code the app showed, with why in the address (`error` and `error_description`), for the web view to say in its own words. One that can't say where it started, such as one that ran out, goes to the web view's first page.
- **The web view too:** it serves [the web view](../web), so the phone, sign-in and the API share one address.

| Part | What it does |
|---|---|
| `src/index.ts` | Routes each request: sign-in, the API, the web view, the operator's restore and delete, and the daily job: the backup, the cleanup and the totals |
| `src/auth-options.ts`, `src/auth.ts` | Sign-in's settings, who a server of your own lets sign in, and device names for the account page |
| `src/api.ts` | The sync API, for the signed-in account only |
| `src/store.ts` | One account's store: records with their history, files, the locked account key, link codes and requests to link |
| `src/store-tables.ts` | The store's tables |
| `src/store-upkeep.ts` | Daily backups, restoring one, and the daily cleanup |
| `src/accounts-upkeep.ts` | The daily cleanup of sign-in's own records: sessions that ended, sign-in steps that ran out, and the limits' counts by IP address |
| `src/daily-job.ts` | Runs the daily job's parts side by side, and waits for all of them, so one that fails can't cut another, such as the backup, short |
| `src/sync-totals.ts` | How much sync is used, in totals only: once a day, its accounts and sign-ins, kept in Workers Analytics Engine for the stats command in [`apps/site`](../site) |
| `src/live.ts` | Tickets for listening to changes as they happen |
| `migrations/` | The accounts database, as Better Auth's own tool writes it (`pnpm schema`) |
| `scripts/sync-server-copy.ts` | The server ready to deploy, as [github.com/factwright/sync-server](https://github.com/factwright/sync-server) holds it for people who run their own (`pnpm copy`) |

## The API
Every route answers only the account of the session that calls it. The desktop app sends its session as a bearer token, and the web view as a cookie. A change sent with the cookie must come from the app's own pages, so another site can't make a signed-in browser act.

| Route | What it does |
|---|---|
| `GET`, `PUT /api/sync/keys` | The account key, locked with the recovery key. The first device saves it, once |
| `GET /api/sync/changes?since=` | Each record's newest version after a point in the account's history, a page at a time |
| `POST /api/sync/changes` | New versions of records, each made from the version its device saw. A stale one comes back as a conflict |
| `GET /api/sync/records/:id/versions[/:n]` | A record's earlier versions, kept for 90 days |
| `POST /api/sync/files/missing`, `PUT`, `GET /api/sync/files/:id` | Locked file contents, stored once each |
| `POST /api/sync/links`, `POST /api/sync/links/:id/take` | Link codes, for adding a device. Each works once, for 10 minutes |
| `POST`, `GET /api/sync/requests`, `GET`, `DELETE /api/sync/requests/:id` | Requests to link, for approving a new device from one that's set up: asking, the account's waiting requests, one request, and calling it off. Each runs out after 10 minutes |
| `POST /api/sync/requests/:id/approver`, `/key`, `/approve`, `/deny`, `/take` | The steps of approving one: a device offers to approve it, the new device shows its key, the approving device leaves the sealed account key or turns it down, and the new device picks it up, once |
| `POST /api/sync/live/ticket`, `GET /api/sync/live` | Listening for changes, over a WebSocket |
| `GET /api/account`, `DELETE /api/account/devices/:id` | Who you are, your signed-in devices, and how much you store |
| `GET /api/account/export` | Everything the server keeps for your account, still locked |
| `GET /api/sign-in-options` | The ways to sign in this server has set up, what more it can do, such as approving devices, and the terms and privacy policy signing in agrees to, when it has them (`TERMS_URL` and `PRIVACY_URL`). Anyone can ask |
| `POST /api/auth/delete-user` | Deletes the account and everything in it. It needs a session from a browser's sign-in with GitHub or Google in the last 15 minutes: one from a device code can't. Trying again finishes a deletion that failed partway |
| `POST /api/auth/device/approve` | Approves a device's code. Only a browser's session can, never one from a device code |

Better Auth's routes that list sessions (with their tokens), sign other sessions out, or hand out a provider's token are off.

## Limits
- 1 GB per account (`STORAGE_LIMIT_MB`) and 25 MB per file.
- Bursts of 600 requests per account, refilling at 10 a second.
- Requests to link: one per device at a time, five waiting per account, ten an hour from each device, and only within 30 minutes of signing in.
- Sign-in requests are limited per IP address, more tightly for signing in. The counts are deleted each day.

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

Signing in with GitHub from start to finish, as when it turns someone away or they cancel at GitHub, runs sign-in on its own, with GitHub faked and the accounts kept in memory ([`test/github.ts`](test/github.ts)).

## Deploying
It runs on Cloudflare's free plan. The first deploy creates the database, the file bucket and the `app.factwright.com` address on its own, and Analytics Engine makes the dataset for the daily totals on the first count.

1. Sign in to the Cloudflare account that has factwright.com: `pnpm --filter @factwright/server exec wrangler login`.
2. Deploy: `pnpm --filter @factwright/server run deploy`. It builds the web view first.
3. Set up the accounts database: `pnpm --filter @factwright/server exec wrangler d1 migrations apply factwright --remote`. Run it again after an update that adds a migration, before deploying it.
4. Set the secret that signs sessions: `openssl rand -base64 32 | pnpm --filter @factwright/server exec wrangler secret put BETTER_AUTH_SECRET`. Changing it later signs every device out, and each linked browser forgets its keys, so it needs linking again.
5. Make a GitHub OAuth app (in the factwright org's settings, under Developer settings) with the callback `https://app.factwright.com/api/auth/callback/github`, then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` with `wrangler secret put`.
6. Optional: a Google OAuth client, with the callback `https://app.factwright.com/api/auth/callback/google`, as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
7. An `ADMIN_TOKEN` secret, to restore an account's store from a backup, or delete an account for someone who asked. Without it, neither works.

### Running your own
Only Factwright's own releases sync through app.factwright.com. Any copy of the app, one from factwright.com or one built anywhere else, can sync through a server of your own instead.

**Ready to deploy.** Within hours of each release, [github.com/factwright/sync-server](https://github.com/factwright/sync-server) has its server, with Cloudflare's Deploy button and the steps around it: a free workers.dev address, a GitHub OAuth app, three secrets, and who may sign in. Its own workflow makes it from that release's source with `pnpm --filter @factwright/server copy`, which you can run too, into `dist/sync-server` ([`scripts/sync-server-copy.ts`](scripts/sync-server-copy.ts)).

**Or from here.** In `wrangler.jsonc`, delete `routes`, and delete `APP_URL`, `TERMS_URL` and `PRIVACY_URL` from `vars`. The server then runs at its free workers.dev address, such as `https://factwright.yourname.workers.dev`, and goes by the address each request came to, so it needs no domain. For a domain of your own, put it in `routes` and set `APP_URL` to it. Then follow the steps above in your account, with your address in place of app.factwright.com, the OAuth callbacks' included.

**Then, either way:**
- Set who can sign in: `ALLOWED_GITHUB_USERS`, your GitHub user name, as a secret (`wrangler secret put ALLOWED_GITHUB_USERS`). To let in someone else too, add their user name after a comma. Only those accounts can make an account or sign in again, and anyone else is turned away, back in the web view, with a note that the server is private. Unset, anyone with GitHub can, as on Factwright's own server. The Deploy button asks for it. Taking someone off the list stops them signing in again, but their devices stay signed in until they sign out.
- In Factwright, choose **Turn on…** under Sync, then **Connect your server…**, and type your server's address, such as `https://factwright-sync.yourname.workers.dev`. The app checks it answers as a sync server, then signs in to it through your browser ([apps/desktop](../desktop#sync)).
- With no `TERMS_URL` and `PRIVACY_URL`, neither the web view nor the app names any terms or privacy policy for your server. Factwright's cover Neatifai's services, not yours.

### Restoring an account
Each store is backed up to R2 every day, and kept for 14 days. To put one back as it was on a day, with `ADMIN_TOKEN` set:

```bash
curl -X POST https://app.factwright.com/api/admin/restore \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"account":"<account ID>","day":"2026-10-12"}'
```

Devices then pull the restored records, and push back any of their own changes the backup didn't have. Cloudflare also keeps 30 days of point-in-time recovery for each Durable Object.

### Deleting an account for someone who asked
The privacy policy promises to delete an account on request, such as for someone who can't sign in any more. With `ADMIN_TOKEN` set, name the account by its email (or its ID, as `account`):

```bash
curl -X POST https://app.factwright.com/api/admin/delete \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"email":"<their email>"}'
```

It removes everything the account has, as deleting it from the web view does, then the account itself.
