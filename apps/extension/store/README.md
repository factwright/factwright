# Publishing Save to Factwright

What the Chrome Web Store and Firefox Add-ons ask for, ready to paste, and the steps. Build first: `pnpm --filter @factwright/extension build` makes `dist/factwright-chrome-<version>.zip` and `dist/factwright-firefox-<version>.zip`. The screenshots are in `screenshots/`, drawn by `pnpm --filter @factwright/extension e2e -- --screenshots`.

Before the first upload, the sync server and factwright.com must be deployed with this version: the server takes the extension's sign-in, and the privacy policy describes it. The same goes for the first upload that lets you choose a server of your own: factwright.com's privacy policy says it may reach one. And for the first upload that saves to Factwright on the same computer, the Factwright release that carries its helper comes out first, and factwright.com's privacy policy describes it: without that release, setup finds no Factwright to save to.

Version 0.2.0 signs in through the browser's own window wherever the server knows the stores' copies. With Factwright's sync it signs in with a code where the server doesn't, so it can go out before or after the sync server that knows them: until that server is deployed, it signs in with a code, as 0.1.x does. A server of your own signs it in through the window alone, never with a code, so a server of your own needs a version with the window. sync-server has published one with each release since Factwright 0.9.0, so every one deployed from there has it.

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
> • Saved to Factwright on the same computer, a job goes straight to the app, never to a server. Through sync, what it saves is locked on your computer with your job hunt's own key before it's sent, so the sync server stores it in a form it can't read.
> • It reaches no site but your sync server, Factwright's or one you run yourself, and has no analytics or tracking.
> • A setting lets it save LinkedIn jobs by their link alone, without reading their postings.
>
> Save to Factwright costs nothing to add. It needs Factwright, the free desktop app for Mac and Windows: factwright.com. It saves straight to Factwright on the same computer, with no account, or through sync from any computer, with Factwright's sync or a server of your own. Factwright's sync is $5 a month or $50 a year, and a server of your own is free: factwright.com/sync. Factwright is open source: github.com/factwright/factwright

The price goes into both listings when Factwright starts selling sync, with the factwright.com deploy that adds /sync, and not before: until then, leave out "Factwright's sync is $5 a month or $50 a year, and a server of your own is free: factwright.com/sync." Both stores ask a listing to say when any of what an extension does needs something paid.

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
   - **Single purpose:** Saves the job posting in the current tab to the user's own Factwright job hunt: to the Factwright desktop app on the same computer, or through Factwright's end-to-end encrypted sync, on Factwright's server or on one the user runs.
   - **activeTab:** To read the job on the tab the user is on, only when they click the extension's button, its menu item or its shortcut. The popup shows what it read and sends nothing until the user saves.
   - **scripting:** To run the one function that reads the job's title, company and posting in that tab, when the user clicks the extension's button, its menu item or its shortcut.
   - **storage:** To keep the user's settings, such as whether to read LinkedIn postings.
   - **contextMenus:** For the Save job to Factwright item in the page's right-click menu.
   - **identity:** To sign the user in to their Factwright sync account with chrome.identity.launchWebAuthFlow, when they click Sign in to sync in setup. Chrome's own sign-in window opens the sync server's page (app.factwright.com, or the user's own server), where they sign in and allow the extension, and Chrome hands the answer to this extension alone, so there's no code to copy or compare. It never reads the user's Google account or email (no identity.email or getAuthToken).
   - **nativeMessaging** (optional): Only for saving to the Factwright desktop app on the same computer, with no account. Nothing is asked at install: when the user chooses "Factwright on this computer" in setup, the extension asks for it with permissions.request. It then sends each job the user saves, and nothing else (its title, company, pay, link, the site it's on, and its posting text), to Factwright's own helper, com.factwright.save, which the Factwright app installs and registers for this extension's ID alone. It gives the permission back if the user sets it up to save through sync instead.
   - **Host permission** (one box covers both):
     > app.factwright.com: To save the job to the user's job hunt through Factwright's sync server, the one site the extension reaches unless the user chooses a sync server of their own.
     >
     > https://*/* (optional): Only for people who run their own Factwright sync server, which is open source. Nothing is asked at install. When the user chooses "Your own server" in setup and types its https address, the extension asks the browser for that one address alone (permissions.request with that origin), checks it answers as a Factwright sync server, and saves through it instead of app.factwright.com. It never asks for any other site, and gives the permission back when the user signs out, or when signing in there fails or is canceled.
   - **Remote code:** No, I am not using remote code.
   - **Data usage,** collected only when the user saves a job, and end-to-end encrypted to their own account: **Website content** (the posting's text), **Web history** (the address of the page they saved), and **Authentication information** (the extension's own sync sign-in).
   - **Certify** all three: not sold or transferred to third parties, not used for purposes unrelated to the single purpose, and not used for creditworthiness or lending.
   - **Privacy policy URL:** https://factwright.com/privacy#extension
5. **Distribution:** public, all regions.
6. **Submit for review.** Reviews usually take a few days. A first listing that asks for host permissions can take longer, and so can the first version with the optional `https://*/*`, for servers of your own: the console may flag it as broad host permissions and send it for an in-depth review. The first version with the optional `nativeMessaging` may take longer too.

## Firefox Add-ons
1. Sign in at https://addons.mozilla.org/developers/ with a Mozilla account, turn on its two-step authentication, and accept the developer agreement.
2. **Submit a New Add-on,** on this site (listed), then upload `dist/factwright-firefox-<version>.zip`. The manifest's ID is `save@factwright.com`, and it needs Firefox 140 or later, the first to show what an extension sends at install. Firefox has taken the optional host permission for servers of your own since 128, and native messaging as an optional permission since 87.
3. **Source code:** yes, the code is bundled. Upload a zip of the repository at the commit the zip was built from (`git archive --format=zip -o factwright-source.zip HEAD`), and paste these steps:
   > Node.js 24 and pnpm 12.10.1 (`corepack enable`). From the repository's root: `pnpm install --frozen-lockfile`, then `pnpm --filter @factwright/extension build`. The add-on is `apps/extension/dist/firefox`, and its zip is `apps/extension/dist/factwright-firefox-<version>.zip`. The code isn't minified.
4. **Listing:** the name, summary, description, categories, screenshots, homepage, support and privacy policy above. Under the license, AGPL-3.0-only. Once Factwright sells sync, a version from before servers of your own, which can save only through Factwright's sync, also needs `requires_payment` marked ("requires payment, non-free services or software"). From the version with servers of your own, it doesn't.
5. **Data collection:** the manifest declares what it sends, which Firefox shows at install: browsing activity (the address of a job the user saves), website content (its posting) and authentication information (its sync sign-in).
6. **Notes to reviewer:**
   > Save to Factwright adds the job in the current tab to the user's Factwright job hunt, end-to-end encrypted, through Factwright's own sync server (app.factwright.com, its one host permission at install), or through a Factwright sync server the user runs themselves. For that, it declares the optional host permission https://*/*: only when the user chooses "Your own server" in setup and types its https address does it request that one origin with permissions.request (src/setup.ts, src/account.ts). It then checks the server answers /api/sign-in-options as a Factwright sync server before signing in, sends nothing to any other site, and removes the permission when the user signs out, or the sign-in fails or is canceled. It signs in with identity.launchWebAuthFlow (src/account.ts): Firefox's window opens the sync server's own page, where the user allows it, and the server's answer comes back to the extension's identity.getRedirectURL() address with a one-time code the extension trades for its session, with PKCE (packages/sync/src/extension-sign-in.ts). A server that doesn't know the extension's return address gets a device code instead. It reads a tab only when the user clicks its button, its context menu item or its keyboard shortcut (activeTab with scripting.executeScript of one function, readJobPage in src/page/read-job.ts, which reads the page without changing it). The popup sends nothing until the user saves. It has no content scripts, no web-accessible resources and no remote code. It can also save to the Factwright desktop app on the same computer, with no account: for that, it declares nativeMessaging as an optional permission, and requests it with permissions.request only when the user chooses "Factwright on this computer" in setup (src/setup.ts, src/computer.ts). It then sends each saved job, as an object of six strings (url, site, company, role, pay, posting) and nothing else, to com.factwright.save, a helper the Factwright desktop app installs and registers in ~/Library/Application Support/Mozilla/NativeMessagingHosts (Mac) or HKCU\Software\Mozilla\NativeMessagingHosts (Windows), allowing save@factwright.com alone. The helper only writes the job into the app's data folder (its source is apps/desktop/helper). Saving through sync needs a Factwright account with sync turned on in the desktop app (factwright.com), which approves linking the extension. Factwright's sync is a subscription, so we can give a reviewer's account sync for free: ask in the review's thread. The source is public at https://github.com/factwright/factwright, under apps/extension.

   Reviewers can try it with no account: install Factwright from factwright.com and open it (on a Mac, then choose Browser extension in its sidebar and Set up beside Firefox), then choose Factwright on this computer in the extension's setup. To try saving through sync, they need a Factwright account with sync on and the desktop app to link it, so a test account may be asked for: answer in the review's thread. Once sync is sold, give the reviewer's account free sync, as [apps/server's README](../../server/README.md#giving-sync-away) says.

## Once it's live
Each store's listing address is in `STORES` in [apps/site/src/stores.ts](../../site/src/stores.ts), with `live: false` until the store approves it. Set the store's `live` to true, and once the site is deployed, factwright.com/extension links to its listing, where its button said coming soon. The first store to go live also takes "coming soon" off the site's other mentions of the extension.

## Each update
Raise `version` in `apps/extension/package.json`, build, and upload the new zip to each store (with a new source zip for Firefox). Note what changed in the CHANGELOG. Paste the listing and the answers above again where they changed since the last upload.

A new optional permission, such as `https://*/*` for servers of your own or `nativeMessaging` for Factwright on this computer, asks nothing of people when the update reaches them: the browser asks only when they choose to use it. A new required one with a warning would ask everyone, and Chrome turns the extension off until they accept. `identity`, new in 0.2.0, is required, since Firefox can't take it as optional, and shows no warning in either browser, so the update asks nothing. A managed Chrome whose administrator blocks the `identity` permission (`ExtensionSettings`' `blocked_permissions`) won't load the extension.
