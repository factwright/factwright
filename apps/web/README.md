# Web view

Your job hunt on your phone, or in any browser. It downloads your synced data and opens it right in the browser, with keys that stay there, so the server only ever sees it locked. The sync server serves it, at the same address as sign-in and the API.

- **Signing in** with GitHub or Google.
- **Linking this browser:** scan the QR code a computer shows, type its code, or use your recovery key. The keys are kept in this browser as Web Crypto keys that can't be read back out.
- **Your jobs:** the numbers that matter, the views, search, and each job's next step. A job shows where it stands, your notes, calls, history and links, and opens its documents and resumes.
- **Letting the desktop app sign in:** the app opens `/device` in your browser, where you check its code and allow it.
- **Your account:** your signed-in devices, how much you store, a copy of everything to download, signing out, and deleting the account.

It builds the job list with the same code as the desktop app, from [`@factwright/core`](../../packages/core), so both show the same jobs.

| Part | What it does |
|---|---|
| `src/App.tsx` | Which page to show: signing in, linking, letting the desktop app sign in, the jobs, a job, or the account |
| `src/vault.ts` | Downloads every record, opens each with the account's keys, and builds the job list |
| `src/keys.ts` | Keeps the account's keys in this browser, in IndexedDB |
| `src/server.ts` | Sign-in, and the client for the sync server |
| `src/jobs.ts` | The phone's job list: most pressing first, the views, and search |
| `public/_headers` | The pages' security headers: nothing but the app's own scripts may run |
| `scripts/icons.ts` | Draws the home-screen icons from Factwright's mark (`pnpm --filter @factwright/web icons`) |

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
