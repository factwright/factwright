# Publishing Save to Factwright

What the Chrome Web Store and Firefox Add-ons ask for, ready to paste, and the steps. Build first: `pnpm --filter @factwright/extension build` makes `dist/factwright-chrome-<version>.zip` and `dist/factwright-firefox-<version>.zip`. The screenshots are in `screenshots/`, drawn by `pnpm --filter @factwright/extension e2e -- --screenshots`.

Before the first upload, the sync server and factwright.com must be deployed with this version: the server takes the extension's sign-in, and the privacy policy describes it.

## The listing

**Name:** Save to Factwright

**Summary** (both stores, under 132 characters):
> Save the job you're looking at, with its posting, to your Factwright job hunt. End-to-end encrypted.

**Description:**
> Save to Factwright adds the job you're looking at to your Factwright job hunt, with its link and its posting as you saw it.
>
> On a job's page, click the Factwright button, check the title, company and posting, and save it. Or press Alt+Shift+S, or right-click the page, to save it without opening anything. It reads the job details a page publishes, the layout of the job boards and applicant tracking systems people use most, or the text you selected, so it also saves postings you can only see when signed in. The job shows in Factwright on your computer as New, ready for a fit check, a tailored resume or a cover letter, with the posting kept even after the listing comes down.
>
> Private by design:
> • It reads a page only when you click its button, its menu item or its shortcut, and nothing as you browse. The popup sends nothing until you save.
> • What it saves is locked on your computer with your job hunt's own key before it's sent, so Factwright's sync server stores it in a form it can't read.
> • It reaches no site but Factwright's sync, and has no analytics or tracking.
> • A setting lets it save LinkedIn jobs by their link alone, without reading their postings.
>
> Save to Factwright is free. It saves through Factwright's sync, so it needs Factwright, the free desktop app for Mac and Windows, with sync turned on. Sync is $5 a month or $50 a year: factwright.com/sync. Factwright is open source: github.com/factwright/factwright

The price goes into both listings when Factwright starts selling sync, with the factwright.com deploy that adds /sync, and not before: until then, leave out "Sync is $5 a month or $50 a year: factwright.com/sync." Both stores ask a listing to say when an extension needs something paid to work, so it stays while the extension can save only through Factwright's sync.

Don't list other companies' names in it. The Chrome Web Store rejected the first submission for keyword spam (violation Yellow Argon) over "LinkedIn, Indeed, Greenhouse, Lever, Workday and other job sites". One mention of LinkedIn, for its setting, is the most it should carry.

**Category:** Chrome: Productivity (Workflow & Planning). Firefox: Productivity.

**Homepage:** https://factwright.com. **Support:** https://github.com/factwright/factwright/issues. **Privacy policy:** https://factwright.com/privacy#extension.

**Screenshots** (1280×800, in this order):
1. `screenshots/1-save.png`: Check it, save it.
2. `screenshots/2-saved.png`: Saved as New, with the posting as you saw it.
3. `screenshots/3-link.png`: Linked by Factwright on your computer, once the emoji match.
4. `screenshots/4-settings.png`: Save it your way, and choose how it treats LinkedIn.

## Chrome Web Store
1. Sign in at https://chrome.google.com/webstore/devconsole with the Google account that should own the listing, pay the one-time $5 registration, and verify the contact email. Choose whether the publisher shows as a trader (Neatifai LLC) or not. Turn on 2-Step Verification for that Google account first: the extension holds its users' keys, so whoever can publish it could read their job hunts ([docs/security.md](../../../docs/security.md#the-browser-extension)).
2. **New item**, then upload `dist/factwright-chrome-<version>.zip`.
3. **Store listing:** the name, summary, description, category, screenshots, homepage and support links above. The icon comes from the zip.
4. **Privacy:**
   - **Single purpose:** Saves the job posting in the current tab to the user's own Factwright job hunt, through Factwright's end-to-end encrypted sync.
   - **activeTab:** To read the job on the tab the user is on, only when they click the extension's button, its menu item or its shortcut. The popup shows what it read and sends nothing until the user saves.
   - **scripting:** To run the one function that reads the job's title, company and posting in that tab, when the user clicks the extension's button, its menu item or its shortcut.
   - **storage:** To keep the user's settings, such as whether to read LinkedIn postings.
   - **contextMenus:** For the Save job to Factwright item in the page's right-click menu.
   - **Host permission (app.factwright.com):** To save the job to the user's job hunt through Factwright's sync server, the only site the extension reaches.
   - **Remote code:** No, I am not using remote code.
   - **Data usage,** collected only when the user saves a job, and end-to-end encrypted to their own account: **Website content** (the posting's text), **Web history** (the address of the page they saved), and **Authentication information** (the extension's own sync sign-in).
   - **Certify** all three: not sold or transferred to third parties, not used for purposes unrelated to the single purpose, and not used for creditworthiness or lending.
   - **Privacy policy URL:** https://factwright.com/privacy#extension
5. **Distribution:** public, all regions.
6. **Submit for review.** Reviews usually take a few days. A first listing that asks for host permissions can take longer.

## Firefox Add-ons
1. Sign in at https://addons.mozilla.org/developers/ with a Mozilla account, turn on its two-step authentication, and accept the developer agreement.
2. **Submit a New Add-on,** on this site (listed), then upload `dist/factwright-firefox-<version>.zip`. The manifest's ID is `save@factwright.com`, and it needs Firefox 140 or later, the first to show what an extension sends at install.
3. **Source code:** yes, the code is bundled. Upload a zip of the repository at the commit the zip was built from (`git archive --format=zip -o factwright-source.zip HEAD`), and paste these steps:
   > Node.js 24 and pnpm 12.10.1 (`corepack enable`). From the repository's root: `pnpm install --frozen-lockfile`, then `pnpm --filter @factwright/extension build`. The add-on is `apps/extension/dist/firefox`, and its zip is `apps/extension/dist/factwright-firefox-<version>.zip`. The code isn't minified.
4. **Listing:** the name, summary, description, categories, screenshots, homepage, support and privacy policy above. Under the license, AGPL-3.0-only. Once Factwright sells sync, also mark that the add-on requires payment or non-free services (`requires_payment` in Firefox Add-ons' terms), for as long as it saves only through Factwright's sync.
5. **Data collection:** the manifest declares what it sends, which Firefox shows at install: browsing activity (the address of a job the user saves), website content (its posting) and authentication information (its sync sign-in).
6. **Notes to reviewer:**
   > Save to Factwright adds the job in the current tab to the user's Factwright job hunt, end-to-end encrypted, through Factwright's own sync server (app.factwright.com, its only host permission). It reads a tab only when the user clicks its button, its context menu item or its keyboard shortcut (activeTab with scripting.executeScript of one function, readJobPage in src/page/read-job.ts, which reads the page without changing it). The popup sends nothing until the user saves. It has no content scripts, no web-accessible resources and no remote code. Setting it up needs a Factwright account with Factwright's sync, a subscription, turned on in the Factwright desktop app (factwright.com), which approves linking the extension. We can give a reviewer's account sync for free: ask in the review's thread. The source is public at https://github.com/factwright/factwright, under apps/extension.

   Reviewers who want to try it need a Factwright account with sync on and the desktop app to link it, so a test account may be asked for: answer in the review's thread. Once sync is sold, give the reviewer's account free sync, as [apps/server's README](../../server/README.md#giving-sync-away) says.

## Once it's live
Each store's listing address is in `STORES` in [apps/site/src/stores.ts](../../site/src/stores.ts), with `live: false` until the store approves it. Set the store's `live` to true, and once the site is deployed, factwright.com/extension links to its listing, where its button said coming soon. The first store to go live also takes "coming soon" off the site's other mentions of the extension.

## Each update
Raise `version` in `apps/extension/package.json`, build, and upload the new zip to each store (with a new source zip for Firefox). Note what changed in the CHANGELOG.
