# Save to Factwright

The browser extension, for Chrome and Firefox. On a job's page, click its button, check the title and company, and save it: the job lands in your Factwright job hunt as New, with its link and its posting as you saw it, through sync, from any computer. It reads pages that need a sign-in too, since it reads what's on your screen, LinkedIn included, unless you turn that off.

It's a device on your sync account, as a linked browser is: it signs in with a code you approve in your browser, and Factwright on your computer approves linking it, after you check both show the same emoji. Everything it saves is locked with your job hunt's key before it leaves the browser. [docs/security.md](../../docs/security.md#the-browser-extension) has the design.

| Part | What it does |
|---|---|
| `src/page/read-job.ts` | Reads the job on a page: the job data sites publish for search engines first, then each big job site's own layout (LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby, Glassdoor, ZipRecruiter, SmartRecruiters), then the page's main text. Text you selected stands in for the posting. The browser sends this one function into the page, so it holds everything it needs |
| `src/tab-job.ts` | A job from a tab's address and title alone, for a page it doesn't read |
| `src/read-tab.ts` | Reads the tab you're on, as you've asked: the page, or its link alone |
| `src/save.ts` | Saves a job through sync, as Add job in the app would: its row as New, its history's first line, and the posting in `saved/<job ID>/posting.md`. The same job, by its link, is saved once |
| `src/account.ts` | The extension's own sign-in and the account's keys, in its IndexedDB, and its requests to sync, which never carry the browser's cookies |
| `src/popup.ts` | The popup under the toolbar button: the job it read, to check and save |
| `src/setup.ts` | The setup page: signing in, linking, the LinkedIn setting and the account |
| `src/background.ts` | Saves for the popup, the right-click menu and the keyboard shortcut, and opens setup on install |
| `src/manifest.ts` | Each browser's manifest, asking for as little as it can |
| `scripts/build.ts` | Builds both browsers' folders and zips, and checks the built page reader works on its own |
| `scripts/e2e.ts` | Runs the built extension in Chromium against a local sync server, from setting up to saving |
| `scripts/icons.ts` | Draws its icons from Factwright's app icon |
| `store/` | What the Chrome Web Store and Firefox Add-ons ask for: the listing, the permissions and the data, and screenshots |

## What it may do
- **activeTab and scripting:** read the tab you're on, once, when you click its button, its menu item or its shortcut. Nothing else, and nothing as you browse.
- **storage:** keep its settings.
- **contextMenus:** its Save job to Factwright item in the page's right-click menu.
- **app.factwright.com:** the one site it reaches, Factwright's sync. Firefox asks for it when you sign in.

It has no content scripts, nothing pages can load, and no way for a site to message it.

## Trying it
```bash
pnpm --filter @factwright/extension build
```

It makes `dist/chrome` and `dist/firefox`, and a zip of each.
- **Chrome:** open `chrome://extensions`, turn on Developer mode, then Load unpacked and pick `dist/chrome`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, then Load Temporary Add-on and pick `dist/firefox/manifest.json`. It stays until Firefox restarts.

Setup opens on its own. To try it against a sync server of your own, or one running locally, build it with that server's address:

```bash
VITE_FACTWRIGHT_SYNC_SERVER=http://localhost:8787 pnpm --filter @factwright/extension build
```

The tests run with the rest (`pnpm test`); `test/save.test.ts` saves jobs to the real sync server, run locally. The end-to-end run needs Playwright's Chromium, once (`pnpm --filter @factwright/site exec playwright install chromium`):

```bash
pnpm --filter @factwright/extension e2e
```

## Publishing it
Both stores take the zip that `build` makes. [store/README.md](store/README.md) has what each asks for, in words to paste, and the steps.
- **Chrome Web Store:** a developer account (a one-time $5), then upload `dist/factwright-chrome-<version>.zip`.
- **Firefox Add-ons:** a free account, then upload `dist/factwright-firefox-<version>.zip`. Mozilla asks for the source too, since the code is bundled: a zip of this repository at the release's commit, with these steps to build it.

Raise `version` in `package.json` for each new upload: both stores take each version once.
