# Save to Factwright

The browser extension, for Chrome and Firefox. On a job's page, click its button, check the title and company, and save it: the job lands in your Factwright job hunt as New, with its link and its posting as you saw it, through sync, from any computer: Factwright's sync, or a sync server of your own. It reads pages that need a sign-in too, since it reads what's on your screen, LinkedIn included, unless you turn that off.

It's a device on your sync account, as a linked browser is: it signs in with a code you approve in your browser, and Factwright on your computer approves linking it, after you check both show the same emoji. Everything it saves is locked with your job hunt's key before it leaves the browser. [docs/security.md](../../docs/security.md#the-browser-extension) has the design.

| Part | What it does |
|---|---|
| `src/page/read-job.ts` | Reads the job on a page: the job data sites publish for search engines first, then each big job site's own layout (LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby, Glassdoor, ZipRecruiter, SmartRecruiters, and Hacker News's "Who is hiring?" posts), then the page's main text, except on LinkedIn. Text you selected stands in for the posting, and on Hacker News, says which post is the job. `test/fixtures` has pages from these sites as real browsers showed them. It reads the page as it is, without copying or changing it. The browser sends this one function into the page, so it holds everything it needs |
| `src/tab-job.ts` | A job's own address, and a job from a tab's address and title alone, for a page it doesn't read. The company from an address when the page names none, never a job board's. What a save without the popup checks first |
| `src/read-tab.ts` | Reads the tab you're on, as you've asked: the page, or its link alone |
| `src/save.ts` | Saves a job through sync, as Add job in the app would: its row as New, its history's first line, and the posting in `saved/<job ID>/posting.md`. The same job, by its link, is saved once, and saving it again adds a posting it doesn't have yet |
| `src/server.ts` | Which sync server it uses: Factwright's, or a server of your own. Your own server's address is https, the address alone, with no path or login, and setup checks it answers as a Factwright sync server before signing in to it |
| `src/settings.ts` | Your settings, kept in the browser: the sync server setup offers, and how it treats LinkedIn |
| `src/account.ts` | The extension's own sign-in, the server it's for and the account's keys, in its IndexedDB; the browser's permission to reach that server; and its requests to sync, which go only to that server and never carry the browser's cookies |
| `src/popup.ts` | The popup under the toolbar button: the job it read and its posting, to check and save |
| `src/setup.ts` | The setup page: choosing which sync, signing in, linking, the LinkedIn setting and the account |
| `src/background.ts` | Saves for the popup, the right-click menu and the keyboard shortcut, and opens setup on install. A save without the popup takes only a page that looks like one job, and leaves anything else for the popup: Chrome opens it, and Firefox, which lets only a click open it, marks the button with “!” |
| `src/manifest.ts` | Each browser's manifest, asking for as little as it can |
| `scripts/build.ts` | Builds both browsers' folders and zips, and checks the built page reader works on its own |
| `scripts/e2e.ts` | Runs the built extension in Chromium against two local sync servers, the one it's built for and one chosen in setup as your own, from setting up to saving |
| `scripts/icons.ts` | Draws its icons from Factwright's app icon |
| `store/` | What the Chrome Web Store and Firefox Add-ons ask for: the listing, the permissions and the data, and screenshots |

## What it may do
- **activeTab and scripting:** read the tab you're on, once, when you click its button, its menu item or its shortcut. Nothing else, and nothing as you browse. The popup sends nothing until you save.
- **storage:** keep its settings.
- **contextMenus:** its Save job to Factwright item in the page's right-click menu.
- **app.factwright.com:** Factwright's sync, the one site it reaches unless you choose a server of your own. Both browsers grant it at install, and let you take it away later: setup then asks for it back.
- **A server of your own** (optional, `https://*/*`): asked for only when you choose Your own server in setup, and then for the address you type alone, so the browser asks you once, for that one site. It keeps that permission only while it's signed in there, or signing in: it's given back when you sign out, when signing in there fails or you cancel it, and when it signs in somewhere else. A wider permission you allow yourself in the browser's settings, such as all https sites, is yours, and it never takes that back. Its sign-in and everything it saves go only to the server it signed in to, and with your own, it reaches nothing of Factwright's.

It has no content scripts, nothing pages can load, and no way for a site to message it. It holds your job hunt's keys, which open all of it, as each linked device does: [docs/security.md](../../docs/security.md#the-browser-extension) says what that means.

A build for another sync server (`VITE_FACTWRIGHT_SYNC_SERVER`) must name an `https://` address, or this computer's, and gets no zips, so only a build for Factwright's own sync can go to the stores. Setup offers that server as Factwright's sync, and in such a build a server of your own can also be this computer's over http, for testing. The stores' build takes only https.

## Trying it
```bash
pnpm --filter @factwright/extension build
```

It makes `dist/chrome` and `dist/firefox`, and a zip of each.
- **Chrome:** open `chrome://extensions`, turn on Developer mode, then Load unpacked and pick `dist/chrome`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, then Load Temporary Add-on and pick `dist/firefox/manifest.json`. It stays until Firefox restarts.

Setup opens on its own. To try it with a sync server of your own, choose Your own server in setup and type its address. One running locally is reached over http, which only a build for another server takes, so build it with that server's address, or any on this computer:

```bash
VITE_FACTWRIGHT_SYNC_SERVER=http://localhost:8787 pnpm --filter @factwright/extension build
```

The tests run with the rest (`pnpm test`); `test/save.test.ts` saves jobs to the real sync server, run locally. The end-to-end run needs Playwright's Chromium, once (`pnpm --filter @factwright/site exec playwright install chromium`):

```bash
pnpm --filter @factwright/extension e2e
```

With `-- --shots <folder>`, it also saves each setup page it checks, in light and dark, to look over a change.

## Publishing it
Both stores take the zip that `build` makes. [store/README.md](store/README.md) has what each asks for, in words to paste, and the steps.
- **Chrome Web Store:** a developer account (a one-time $5), then upload `dist/factwright-chrome-<version>.zip`.
- **Firefox Add-ons:** a free account, then upload `dist/factwright-firefox-<version>.zip`. Mozilla asks for the source too, since the code is bundled: a zip of this repository at the release's commit, with these steps to build it.

Raise `version` in `package.json` for each new upload: both stores take each version once.
