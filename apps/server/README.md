# Sync server

A Cloudflare Worker that handles sign-in and keeps each account's encrypted data. It only ever sees locked data and opaque IDs. The design is in [docs/security.md](../../docs/security.md).

- **One private store per account:** a Durable Object with its own database, plus a folder of encrypted files in R2.
- **Identity from the session:** the account always comes from the verified session, never from the request.
- **Sign-in:** [Better Auth](https://www.better-auth.com), with GitHub or Google. The desktop app and the browser extension, Save to Factwright, each sign in with a device code you approve in your browser, under a client ID of their own. Accounts and sessions live in D1. A session keeps the name of its device and no IP address, and GitHub's and Google's tokens aren't kept. A server of your own can let in only the GitHub accounts it lists (`ALLOWED_GITHUB_USERS`).
- **The web view too:** it serves [the web view](../web), so the phone, sign-in and the API share one address.

| Part | What it does |
|---|---|
| `src/index.ts` | Routes each request: sign-in, the API, Stripe's webhook, the web view, the operator's restore, delete and free sync, and the daily job: the backup, the cleanup, the totals and the check of subscriptions |
| `src/auth-options.ts`, `src/auth.ts` | Sign-in's settings, who a server of your own lets sign in, and device names for the account page |
| `src/api.ts` | The sync API, for the signed-in account only |
| `src/store.ts` | One account's store: records with their history, files, the locked account key, link codes and requests to link |
| `src/store-tables.ts` | The store's tables |
| `src/store-upkeep.ts` | Daily backups, restoring one, and the daily cleanup |
| `src/accounts-upkeep.ts` | The daily cleanup of sign-in's own records: sessions that ended, sign-in steps that ran out, and the limits' counts by IP address |
| `src/daily-job.ts` | Runs the daily job's parts side by side, and waits for all of them, so one that fails can't cut another, such as the backup, short |
| `src/sync-totals.ts` | How much sync is used, in totals only: once a day, its accounts and sign-ins, kept in Workers Analytics Engine for the stats command in [`apps/site`](../site) |
| `src/live.ts` | Tickets for listening to changes as they happen |
| `src/billing.ts` | Selling sync, on Factwright's own server only: who may sync, each account's Stripe customer, checkout and the customer portal, Stripe's webhook, and the daily check of subscriptions |
| `migrations/` | The accounts database, as Better Auth's own tool writes it (`pnpm schema`), and who has sync where it's sold (`0003_sync_access.sql`) |
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
| `GET /api/account`, `DELETE /api/account/devices/:id` | Who you are, your signed-in devices, how much you store and, where sync is sold, how you have it |
| `GET /api/account/export` | Everything the server keeps for your account: what you sync, still locked, and where sync is sold, your billing record |
| `POST /api/billing/checkout`, `POST /api/billing/portal` | Paying for sync, where it's sold, from a browser's own sign-in: Stripe's checkout for a month or a year, and its customer portal (see [Selling sync](#selling-sync)) |
| `POST /api/billing/stripe` | Stripe's webhook, signed with its secret. It needs no session |
| `GET /api/sign-in-options` | The ways to sign in this server has set up, what more it can do, such as approving devices, and the terms and privacy policy signing in agrees to, when it has them (`TERMS_URL` and `PRIVACY_URL`). Anyone can ask |
| `POST /api/auth/delete-user` | Deletes the account and everything in it. It needs a session from a browser's sign-in with GitHub or Google in the last 15 minutes: one from a device code can't. Trying again finishes a deletion that failed partway |
| `POST /api/auth/device/approve` | Approves a device's code. Only a browser's session can, never one from a device code |

Better Auth's routes that list sessions (with their tokens), sign other sessions out, or hand out a provider's token are off.

## Limits
- 1 GB per account (`STORAGE_LIMIT_MB`) and 25 MB per file.
- Bursts of 600 requests per account, refilling at 10 a second.
- Requests to link: one per device at a time, five waiting per account, ten an hour from each device, and only within 30 minutes of signing in.
- Sign-in requests are limited per IP address, more tightly for signing in. The counts are deleted each day.

## Selling sync
Only Factwright's own server sells sync ([`src/billing.ts`](src/billing.ts)). Two steps turn it on, each with secrets.

- **Stripe connected:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. From then on the webhook keeps subscriptions up to date, the portal works, and deleting an account deletes its Stripe customer.
- **Selling:** add `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`. Only then does anyone get asked to pay.

Until then, and always on a server of your own:
- sync is free
- `/api/sign-in-options` doesn't list `subscription`
- the billing routes answer 404

**Who may sync:**
- **Early accounts,** made before `EARLY_BEFORE`, keep sync for good. It's a rule, not a list, so there's no order to get wrong at launch.
- **A gift of free sync,** for anyone who asked.
- **A subscription** that's active, trialing, or past due while Stripe retries a payment.

**Without sync**, an account gets 402 `subscription-needed` for what each route in `src/api.ts` marks as needing sync: sending changes and files, saving the account key, and adding devices. Everything else stays open:
- reading all it has
- listening for changes, so a device left open keeps a quiet socket rather than asking for a ticket every minute
- calling a link or a request off
- signing devices out
- paying

**Paying** happens in a browser's own sign-in with GitHub or Google. A device code's session gets 403, so one got by tricking someone can't reach their billing.
- **Checkout:** `POST /api/billing/checkout`, with `{"period": "month"}` or `"year"`.
  - It uses the account's own Stripe customer, made once with an idempotency key, so all its subscriptions sit together and Stripe can refuse a second.
  - It closes after 35 minutes.
  - It comes back to `/subscribe/done`, or to `/subscribe` if they leave.
  - An account can start one every 10 seconds.
  - A customer deleted in Stripe is made again.
- **Portal:** `POST /api/billing/portal` opens Stripe's customer portal, which comes back to `/account`.

**Stripe's word:** the webhook at `/api/billing/stripe` takes `checkout.session.completed` and every `customer.subscription.*` event.
- **Checked:** each must be signed with `STRIPE_WEBHOOK_SECRET` in the last five minutes, and be at most 512 KB.
- **Read back:** each time, the server reads the subscription back from Stripe. An older read never replaces a newer one, and a subscription that isn't syncing never replaces a different one that is.
- **Accounts that are gone:** a subscription whose account isn't here is canceled.
- **A second subscription:** if an account already has one live, the second is canceled and logged, to be refunded in Stripe.
- **A cancellation** shows as "ending" whether Stripe records it as `cancel_at_period_end` or as `cancel_at`.
- **The daily check:** the daily job reads back any subscription that should have had word by now, in case a webhook was missed.

**What's kept:** never card details.
- **The `syncAccess` table:** each account's gift, Stripe customer and subscription IDs, the subscription's status, when the time paid for ends, and whether it's canceling. The account's export includes it.
- **The `freeSyncEmail` table:** emails given free sync before they had an account. Each is forgotten once an account signs up with it.

**Deleting an account** deletes its Stripe customer first, which cancels all its subscriptions and takes its billing details out of Stripe.
- If Stripe can't, the deletion stops, and trying again finishes it.
- With Stripe not connected, an account that may still be paying can't be deleted until it is.

### Giving sync away
With `ADMIN_TOKEN` set, to give free sync to someone who asked, by email:

```bash
curl -X POST https://app.factwright.com/api/admin/free-sync \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"email":"<their email>"}'
```

- **The answer** says whether it went to an account now (`"to": "account"`) or waits for one to sign up with that email (`"to": "email"`).
- **A verified account only:** the gift goes only to an account whose email GitHub or Google says is verified.
- **An account that was paying** (`"wasPaying": true`) has its subscription set to end with the time already paid for.
- **Taking it back:** `"off": true` takes free sync back. It never takes an early account's.

### Turning it on
1. **Before selling:**
   - The apps can pay. The web view has `/subscribe` and `/subscribe/done`, and the app sends people there.
   - factwright.com's terms and privacy policy cover the subscription, and name Stripe.
2. **In Factwright's own Stripe account, set up:**
   - **The product:** a monthly price of $5 and a yearly price of $50, in US dollars. The app shows those amounts.
   - **Checkout:** limit customers to one subscription.
   - **Failed payments:** cancel the subscription once all retries fail, so past due never lasts.
   - **The customer portal.**
   - **A webhook endpoint** at `https://app.factwright.com/api/billing/stripe`, for `checkout.session.completed` and the `customer.subscription.*` events.
   - **A restricted key** that can write Checkout Sessions, customer portal sessions, Customers and Subscriptions.
3. **Try it on your computer:** use Stripe's test keys with `pnpm dev`, never on Factwright's server, so no test customer is ever kept there.
4. **Deploy:** apply the migrations, then deploy. Sync stays free.
5. **Turn it on:** with `wrangler secret put`, set:
   - `EARLY_BEFORE`: the moment selling starts, as an ISO time
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`, the two price IDs

   Selling starts with the last one.

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
- Set who can sign in: `ALLOWED_GITHUB_USERS`, your GitHub user name, as a secret (`wrangler secret put ALLOWED_GITHUB_USERS`). To let in someone else too, add their user name after a comma. Only those accounts can make an account or sign in again, and anyone else is turned away with a note that the server is private. Unset, anyone with GitHub can, as on Factwright's own server. The Deploy button asks for it. Taking someone off the list stops them signing in again, but their devices stay signed in until they sign out.
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
