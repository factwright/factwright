# The browser extension on this computer

The app's side of the browser extension ([`apps/extension`](../../../../extension)), when it saves straight to Factwright on the same computer, with no account and no sync. [The desktop README](../../../README.md#the-browser-extension-on-this-computer) has the whole of it, and [docs/security.md](../../../../../docs/security.md#the-browser-extension) the design.

| File | What it does |
|---|---|
| `browsers.ts` | Where each browser looks for the helper it may start, on a Mac and on Windows, and how it's found: Chrome, Chromium, Edge, Brave, Arc, Vivaldi and Firefox |
| `register.ts` | Tells each browser where the helper is, and that only the extension may start it: on Windows, each one found as the app starts; on a Mac, each one the user sets up, as macOS asks them first, with nothing touched until then. Also where each browser stands, for the window |
| `save-helper.ts` | The Browser extension window's side of it: where each browser stands, setting browsers up, and opening Files & Folders in macOS's System Settings |
| `inbox.ts` | Adds the jobs the helper drops in the open profile's inbox, as they come and as the app starts, and answers the helper while the app is open |
| `helper.test.ts` | Builds the helper ([`apps/desktop/helper`](../../../helper)) for testing, and checks it takes only jobs, drops them where the app looks, and hands back the app's answer |

The tests run against temporary folders, never the computer's own browsers or data folder.
