# Save to Factwright on this computer

The app's side of Save to Factwright, the browser extension ([`apps/extension`](../../../../extension)), when it saves straight to Factwright on the same computer, with no account and no sync. [The desktop README](../../../README.md#save-to-factwright-on-this-computer) has the whole of it, and [docs/security.md](../../../../../docs/security.md#the-browser-extension) the design.

| File | What it does |
|---|---|
| `browsers.ts` | Where each browser looks for the helper it may start, on a Mac and on Windows: Chrome, Chromium, Edge, Brave, Arc, Vivaldi and Firefox |
| `register.ts` | Tells each browser it finds where the helper is, and that only Save to Factwright may start it, on the first start and after each update |
| `inbox.ts` | Adds the jobs the helper drops in the open profile's inbox, as they come and as the app starts, and answers the helper while the app is open |
| `helper.test.ts` | Builds the helper ([`apps/desktop/helper`](../../../helper)) for testing, and checks it takes only jobs, drops them where the app looks, and hands back the app's answer |

The tests run against temporary folders, never the computer's own browsers or data folder.
