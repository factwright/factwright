# Save to Factwright

The browser extension, for Chrome and Firefox. On a job's page, click its button, check the title and company, and save it: the job lands in your Factwright job hunt as New, with its link and its posting as you saw it. It saves straight to Factwright on the same computer, with no account, or through sync, from any computer: Factwright's sync, or a sync server of your own. It reads pages that need a sign-in too, since it reads what's on your screen, LinkedIn included, unless you turn that off.

Setup asks where saved jobs go. **Factwright on this computer** needs nothing but Factwright: the browser hands each job to a small helper Factwright installs and registers with each browser it finds, through the browser's native messaging, and Factwright adds it when it's open ([apps/desktop/helper](../desktop/helper)). **Through sync**, it's a device on your sync account, as a linked browser is: it signs in through the browser's own window for extensions, where you allow it on your sync server's page, and Factwright on your computer approves linking it, after you check both show the same emoji. A server that doesn't know this copy signs it in with a code you approve in your browser instead. Everything it saves through sync is locked with your job hunt's key before it leaves the browser. [docs/security.md](../../docs/security.md#the-browser-extension) has the design.

| Part | What it does |
|---|---|
| `src/page/read-job.ts` | Reads the job on a page: the job data sites publish for search engines first, then each big job site's own layout (LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby, Glassdoor, ZipRecruiter, SmartRecruiters, and Hacker News's "Who is hiring?" posts), then the page's main text, except on LinkedIn. Text you selected stands in for the posting, and on Hacker News, says which post is the job. `test/fixtures` has pages from these sites as real browsers showed them. It reads the page as it is, without copying or changing it. The browser sends this one function into the page, so it holds everything it needs |
| `src/tab-job.ts` | A job's own address, and a job from a tab's address and title alone, for a page it doesn't read. The company from an address when the page names none, never a job board's. What a save without the popup checks first |
| `src/read-tab.ts` | Reads the tab you're on, as you've asked: the page, or its link alone |
| `src/computer.ts` | Saves a job to Factwright on this computer: asks the browser for native messaging when you choose it, looks for Factwright's helper, and sends it each job's own fields, and nothing else. Where the extension saves, by what setup set up |
| `src/save.ts` | Saves a job through sync, as Add job in the app would: its row as New, its history's first line, and the posting in `saved/<job ID>/posting.md`. The same job, by its link, is saved once, and saving it again adds a posting it doesn't have yet. While sync is paused, as an account's subscription ended, it saves nothing and says so |
| `src/server.ts` | Which sync server it uses: Factwright's, or a server of your own. Your own server's address is https, the address alone, with no path or login, and setup checks it answers as a Factwright sync server before signing in to it |
| `src/settings.ts` | Your settings, kept in the browser: where saved jobs go, the sync server setup offers, and how it treats LinkedIn |
| `src/account.ts` | The extension's own sign-in, through the browser's window or with a code, the server it's for and the account's keys, in its IndexedDB; the browser's permission to reach that server; and its requests to sync, which go only to that server and never carry the browser's cookies |
| `src/popup.ts` | The popup under the toolbar button: the job it read and its posting, to check and save |
| `src/setup.ts` | The setup page: where saved jobs go, finding Factwright on this computer or choosing which sync, signing in, linking, the LinkedIn setting and the account. Where sync is sold, as on Factwright's server, an account without it gets "Sync needs a subscription" instead of linking: subscribe in Factwright on your computer, run a server of your own, or use this computer instead, with Check again |
| `src/background.ts` | Saves for the right-click menu and the keyboard shortcut, and through sync for the popup, and opens setup on install. A save without the popup takes only a page that looks like one job, and leaves anything else for the popup: Chrome opens it, and Firefox, which lets only a click open it, marks the button with “!” |
| `src/manifest.ts` | Each browser's manifest, asking for as little as it can |
| `scripts/build.ts` | Builds both browsers' folders and zips, and checks the built page reader works on its own |
| `scripts/e2e.ts` | Runs the built extension in Chromium, from setting up to saving: against local sync servers, the one it's built for, one chosen in setup as your own, and one that sells sync, as Factwright's will, and straight to Factwright on this computer, through the desktop app's helper and its inbox |
| `scripts/icons.ts` | Draws its icons from Factwright's app icon |
| `store/` | What the Chrome Web Store and Firefox Add-ons ask for: the listing, the permissions and the data, and screenshots |

## What it may do
- **activeTab and scripting:** read the tab you're on, once, when you click its button, its menu item or its shortcut. Nothing else, and nothing as you browse. The popup sends nothing until you save.
- **storage:** keep its settings.
- **contextMenus:** its Save job to Factwright item in the page's right-click menu.
- **identity:** the browser's own window to sign in to sync through, which hands the answer to this extension alone, so there's no code to compare. Neither browser shows a warning for it, at install or on an update. It never reads your Google account or email.
- **nativeMessaging** (optional): asked for only when you choose Factwright on this computer in setup, to hand each job you save to Factwright's helper, `com.factwright.save`, and to nothing else. Each browser lets only this extension reach that helper. It's given back once you set the extension up to save through sync instead. An update that brings it asks nothing of anyone, as it's optional.
- **app.factwright.com:** Factwright's sync, the one site it reaches unless you choose a server of your own. Both browsers grant it at install, and let you take it away later: setup then asks for it back.
- **A server of your own** (optional, `https://*/*`): asked for only when you choose Your own server in setup, and then for the address you type alone, so the browser asks you once, for that one site. It keeps that permission only while it's signed in there, or signing in: it's given back when you sign out, when signing in there fails or you cancel it, and when it signs in somewhere else. A wider permission you allow yourself in the browser's settings, such as all https sites, is yours, and it never takes that back. Its sign-in and everything it saves go only to the server it signed in to, and with your own, it reaches nothing of Factwright's.

It has no content scripts, nothing pages can load, and no way for a site to message it. Through sync, it holds your job hunt's keys, which open all of it, as each linked device does: [docs/security.md](../../docs/security.md#the-browser-extension) says what that means.

A build for another sync server (`VITE_FACTWRIGHT_SYNC_SERVER`) must name an `https://` address, or this computer's, and gets no zips, so only a build for Factwright's own sync can go to the stores. Setup offers that server as Factwright's sync, and in such a build a server of your own can also be this computer's over http, for testing. The stores' build takes only https.

## Trying it
```bash
pnpm --filter @factwright/extension build
```

It makes `dist/chrome` and `dist/firefox`, and a zip of each.
- **Chrome:** open `chrome://extensions`, turn on Developer mode, then Load unpacked and pick `dist/chrome`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, then Load Temporary Add-on and pick `dist/firefox/manifest.json`. It stays until Firefox restarts.

Setup opens on its own. A copy loaded this way signs in to Factwright's sync with a code, since its server knows only the stores' copies by their IDs, and Chrome gives a copy loaded from a folder an ID of its own. Firefox gives it the stores' ID, so it signs in through the window. A server's `EXTENSION_IDS` can add a copy's ID ([apps/server](../server/README.md#save-to-factwrights-window)).

To try saving to Factwright on this computer, build the desktop app's helper (`pnpm --filter @factwright/desktop helper`), then run the desktop app from the code with the unpacked extension's ID, from `chrome://extensions`, so it registers the helper for it as well as the stores' ID:

```bash
FACTWRIGHT_EXTENSION_ID=<the unpacked extension's ID> pnpm dev
```

To try it with a sync server of your own, choose Your own server in setup and type its address. A server of your own signs it in through the window alone, never with a code, since it could pass along a code Factwright's sync gave it, so a Chrome copy loaded this way needs its ID in that server's `EXTENSION_IDS`, which setup names. One running locally is reached over http, which only a build for another server takes, so build it with that server's address, or any on this computer:

```bash
VITE_FACTWRIGHT_SYNC_SERVER=http://localhost:8787 pnpm --filter @factwright/extension build
```

The tests run with the rest (`pnpm test`); `test/save.test.ts` saves jobs to the real sync server, run locally. The end-to-end run needs Playwright's Chromium, once (`pnpm --filter @factwright/site exec playwright install chromium`), and a C compiler, to build the desktop app's helper for testing (on a Mac, Xcode's command line tools):

```bash
pnpm --filter @factwright/extension e2e
```

With `-- --shots <folder>`, it also saves each setup page it checks, in light and dark, to look over a change.

## Publishing it
Both stores take the zip that `build` makes. [store/README.md](store/README.md) has what each asks for, in words to paste, and the steps.
- **Chrome Web Store:** a developer account (a one-time $5), then upload `dist/factwright-chrome-<version>.zip`.
- **Firefox Add-ons:** a free account, then upload `dist/factwright-firefox-<version>.zip`. Mozilla asks for the source too, since the code is bundled: a zip of this repository at the release's commit, with these steps to build it.

Raise `version` in `package.json` for each new upload: both stores take each version once.
