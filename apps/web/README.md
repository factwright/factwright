# Web view

Your job hunt on your phone, or in any browser. It downloads your synced data and opens it right in the browser, with keys that stay there, so the server only ever sees it locked. The sync server serves it, at the same address as sign-in and the API.

- **Signing in** with GitHub or Google. When it doesn't work, such as when you cancel at GitHub, or a server of your own doesn't list you, it comes back to the page you started on, such as the code the desktop app showed, and says why in plain words.
- **Linking this browser:** approve it from a computer that's set up, once both show the same emoji; scan the QR code a computer shows; type its code; or use your recovery key. The keys are kept in this browser as Web Crypto keys that can't be read back out.
- **Your jobs:** the numbers that matter, the views, search, and each job's next step. A job shows where it stands, your notes, calls, history and links, and opens its documents and resumes. With more than one kind of job, a menu shows one kind's jobs, as on the computer.
- **Letting the desktop app or the browser extension sign in:** each opens `/device` in your browser, where you check its code and allow it. The page says which account it signs in to. Use another account signs you out here and in with another, then comes back to the same code.
- **Your account:** your signed-in devices, how much you store, a copy of everything to download, signing out, and deleting the account.
- **Paying for sync,** on a server that sells it, as Factwright's will. It lists `subscription` in `/api/sign-in-options`, and the account says how it has sync. A server of your own never sells it, so none of this shows there.
  - **Subscribing:** the desktop app opens `/subscribe`, with the account it's signed in as. You pick $5 a month or $50 a year, and Stripe's checkout takes the payment, by redirecting there, as sign-in does. Nothing of Stripe's runs on these pages. If this browser is signed in with another account than the app's, it says so before anyone pays for the wrong one. An account with sync already, or free sync, has nothing to pay.
  - **Coming back:** checkout comes back to `/subscribe/done`, which waits for Stripe's word to reach the server, then says to go back to Factwright, which carries on by itself. If Stripe takes longer, it says so, with Check again.
  - **Your subscription,** on the account page: when it renews, or ends once canceled, a card that didn't go through, free sync and why, or none yet. Manage subscription opens Stripe's customer portal, to change the card or the plan, cancel or get receipts. Deleting the account says it ends the subscription too.
  - **Paused:** once a subscription ends, the jobs page says sync is paused and how up to date the job hunt is, with Subscribe again. A card that didn't go through gets a note there too. No browser links while sync is paused.

It builds the job list with the same code as the desktop app, from [`@factwright/core`](../../packages/core), so both show the same jobs.

| Part | What it does |
|---|---|
| `src/App.tsx` | Which page to show: signing in, linking, letting the desktop app sign in, subscribing, the jobs, a job, or the account |
| `src/vault.ts` | Downloads every record, opens each with the account's keys, and builds the job list |
| `src/keys.ts` | Keeps the account's keys in this browser, in IndexedDB |
| `src/server.ts` | Sign-in, and the client for the sync server |
| `src/Subscribe.tsx` | Subscribing to sync, where it's sold: monthly or yearly, then Stripe's checkout (`/subscribe`), and the page it comes back to (`/subscribe/done`) |
| `src/Subscription.tsx` | How the account has sync, on the account page, the jobs page's note when sync is paused or a payment didn't go through, and going to Stripe's pages |
| `src/sign-in-errors.ts` | What the page says when signing in didn't work: our own words for the codes it knows, or else the server's description. It takes them out of the address, keeping the rest |
| `src/jobs.ts` | The phone's job list: most pressing first, the views, and search |
| `public/_headers` | The pages' security headers: nothing but the app's own scripts may run |
| `scripts/icons.ts` | Draws the browser tab's icon and the home-screen icons from Factwright's mark (`pnpm --filter @factwright/web icons`) |

## Running it
The sync server builds it and serves it, at http://localhost:8787: see [Running it locally](../server/README.md#running-it-locally). To work on it with instant reloads, run the server, then:

```bash
pnpm --filter @factwright/web dev
```

It opens at http://localhost:5173, and sends its requests to the server at http://localhost:8787.

## Tests
```bash
pnpm --filter @factwright/web test
```

The pages are tested in jsdom, with axe checking each one for accessibility problems. Opening a job hunt is tested against the real sync server, running in workerd.
