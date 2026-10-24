# The browser extension

Factwright's extension for Chrome and Firefox, called Factwright in both stores. It was Save to Factwright at first, as its Firefox ID (`save@factwright.com`) and its listings' addresses still say. On a job's page, click its button, check the title and company, and save it: the job lands in your Factwright job hunt as New, with its link and its posting as you saw it. It saves straight to Factwright on the same computer, with no account, or through sync, from any computer: Factwright's sync, or a sync server of your own. It reads pages that need a sign-in too, since it reads what's on your screen, LinkedIn included, unless you turn that off.

On the same computer, it also fills in a job's application form, for you to check and submit yourself: click Fill this application in the popup, in the right-click menu, or with Alt+Shift+F, and a panel opens beside the page. It reads the form, asks Factwright for an answer to each field, from Profile, the job's own resume and what you sent before, uploads the job's resume and cover letter, and lists every field with where its answer came from. What's left for you, and needed, is outlined in orange on the page. Mark as applied keeps what you sent with the job. It never submits anything, and on LinkedIn and Indeed, whose terms forbid filling their forms, it only gives answers to copy.

On the job application sites you allow, and only there, it also shows its answers in a form's fields as you fill it in: turn them on in setup, or from the panel when you fill a form. One optional permission covers the sites where the applicant systems most companies use show their forms, and any other careers site can be added on its own. There, a small Fill button on a page with an application form fills it as Fill this application does, and a field you click into, where Factwright has an answer, shows a menu beside it with each answer on file, in the extension's own frame, which the page can't read. Nothing goes in a field until you pick an answer, and a menu never covers the page's own controls. Leaving a field with a new answer Profile can keep, such as a new phone number, offers to save it.

Setup asks where saved jobs go. **Factwright on this computer** needs nothing but Factwright: the browser hands each job to a small helper Factwright installs and registers with each browser it finds, through the browser's native messaging, and Factwright adds it when it's open ([apps/desktop/helper](../desktop/helper)). **Through sync**, it's a device on your sync account, as a linked browser is: it signs in through the browser's own window for extensions, where you allow it on your sync server's page, and Factwright on your computer approves linking it, after you check both show the same emoji. A server that doesn't know this copy signs it in with a code you approve in your browser instead. Everything it saves through sync is locked with your job hunt's key before it leaves the browser. [docs/security.md](../../docs/security.md#the-browser-extension) has the design.

| Part | What it does |
|---|---|
| `src/page/read-job.ts` | Reads the job on a page: the job data sites publish for search engines first, then each big job site's own layout (LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby, Glassdoor, ZipRecruiter, SmartRecruiters, and Hacker News's "Who is hiring?" posts), then the page's main text, except on LinkedIn. Text you selected stands in for the posting, and on Hacker News, says which post is the job. `test/fixtures` has pages from these sites as real browsers showed them. It reads the page as it is, without copying or changing it. The browser sends this one function into the page, so it holds everything it needs |
| `src/page/form.ts` | Reads the application form on a page, fills it, reads what's in it once you mark the job applied, and outlines what's left for you in orange. One function the browser sends into the page, as the page reader is. It reads only fields you can see, outside the page's menus, header and footer, never one that's hidden, see-through, off the page or cut away, as a page's traps for bots are, types as a person would so the page's own code keeps it, opens a page's own dropdowns with a whole press, and checks each field took. It fills only the form at the address it read it at. It never fills a password or ticks a box that agrees to something, never clicks a button that submits, and never submits: while it fills, the page can't submit the form either. `test/fixtures` has Greenhouse's, Lever's and Ashby's forms as Chromium showed them, a plain one, and one with fields you can't see |
| `src/fill.ts` | Filling a form, as the panel does it: what to ask Factwright, the job's files in parts, what to put in each field, what you sent, and the new answers to offer to keep. Where it only gives answers to copy |
| `src/panel.ts` | The panel beside the page, Chrome's side panel or Firefox's sidebar: the form's fields, each with its answer and where it came from, with Go to and Copy, Mark as applied, and the new answers to keep. It offers Factwright's menus and Fill button on the form's site, or a way to turn them off |
| `src/applicant-systems.ts` | The job application sites: the applicant systems most companies' forms are on, each by the sites only their job pages and forms are on, never their own home pages, and the sites the extension never runs a script on, LinkedIn and Indeed. A careers site, as one click adds it: an https site by its name, its address alone |
| `src/application-sites.ts` | The job application sites you allowed: asked for on a click, in setup or the panel, kept as you chose them, and counted only while the browser lets the extension reach each. It registers the extension's script on them alone, takes it away once there are none, and runs it at once on pages already open on a site you just allowed |
| `src/job-site-script.ts`, `src/content.ts` | The script on the job sites you allowed: it reads the form as the panel does, puts a Fill button on a page with an application form, opens a field's menu when you click or tab into it, puts the answer you pick in the field, and offers to keep a new answer you gave a field Profile keeps, once you leave it. It never has an answer but the one you pick |
| `src/frame.ts`, `frame.html` | The extension's own frame on those sites: the Fill button, or a field's menu, which the page can't read |
| `src/place.ts` | Where the frame goes: a menu beside its field, and the Fill button in a corner of the window, each only where it covers none of the page's own controls, nor the field |
| `src/on-job-sites.ts` | The background's side: what each field's menu offers, from Factwright's answers, a new answer to keep, and the Fill button, which opens Chrome's side panel, or fills the form in Firefox, which opens its sidebar only from a click of its own |
| `src/job-site-messages.ts` | What the script, the frame and the background say to each other, each message checked |
| `src/tab-job.ts` | A job's own address, and a job from a tab's address and title alone, for a page it doesn't read. The company from an address when the page names none, never a job board's. What a save without the popup checks first |
| `src/read-tab.ts` | Reads the tab you're on, as you've asked: the page, or its link alone |
| `src/computer.ts` | Saves a job to Factwright on this computer: asks the browser for native messaging when you choose it, looks for Factwright's helper, and sends it each job's own fields, and nothing else. Where the extension saves, by what setup set up |
| `src/save.ts` | Saves a job through sync, as Add job in the app would: its row as New, its history's first line, and the posting in `saved/<job ID>/posting.md`. The same job, by its link, is saved once, and saving it again adds a posting it doesn't have yet. While sync is paused, as an account's subscription ended, it saves nothing and says so |
| `src/server.ts` | Which sync server it uses: Factwright's, or a server of your own. Your own server's address is https, the address alone, with no path or login, and setup checks it answers as a Factwright sync server before signing in to it |
| `src/settings.ts` | Your settings, kept in the browser: where saved jobs go, the sync server setup offers, and how it treats LinkedIn |
| `src/account.ts` | The extension's own sign-in, through the browser's window or with a code, the server it's for and the account's keys, in its IndexedDB; the browser's permission to reach that server; and its requests to sync, which go only to that server and never carry the browser's cookies |
| `src/popup.ts` | The popup under the toolbar button: the job it read and its posting, to check and save |
| `src/setup.ts` | The setup page: where saved jobs go, finding Factwright on this computer or choosing which sync, signing in, linking, the LinkedIn setting and the account. Where sync is sold, as on Factwright's server, an account without it gets "Sync needs a subscription" instead of linking: subscribe in Factwright on your computer, run a server of your own, or use this computer instead, with Check again |
| `src/background.ts` | Saves for the right-click menu and the keyboard shortcut, and through sync for the popup, and opens setup on install. A save without the popup takes only a page that looks like one job, and leaves anything else for the popup: Chrome opens it, and Firefox, which lets only a click open it, marks the button with “!”. It registers the script on the job sites you allowed as it starts and as they change |
| `src/manifest.ts` | Each browser's manifest, asking for as little as it can |
| `scripts/build.ts` | Builds both browsers' folders and zips, and checks the built page reader works on its own |
| `scripts/e2e.ts` | Runs the built extension in Chromium, from setting up to saving: against local sync servers, the one it's built for, one chosen in setup as your own, and one that sells sync, as Factwright's will, and straight to Factwright on this computer, through the desktop app's helper and its inbox |
| `scripts/e2e-fill.ts` | Fills a Lever form served on this computer in Chromium, through the desktop app's helper and its inbox and fill code, over a made-up job hunt: Factwright closed, then open, the resume uploaded, Mark as applied, and a new answer kept. Then the job application sites: turned on from the panel, the Fill button, which opens the side panel, a field's menu, a new answer offered to keep, and turned off in setup |
| `scripts/e2e-firefox-fill.ts` | Fills forms served on this computer in a real Firefox, through the extension's own scripting, as its sidebar does |
| `scripts/e2e-firefox.ts` | Saves straight to Factwright on this computer in a real Firefox, the stores' build: Firefox's own grant of native messaging on setup's click, the helper reached at once from setup and from the background, what setup says when Firefox can't find the helper, and saves with Factwright closed and open. On Linux, as CI runs it, and on a Mac |
| `scripts/bidi.ts` | A small WebDriver BiDi client, to drive a real Firefox, which Playwright can't do with an extension |
| `scripts/icons.ts` | Draws its icons from Factwright's app icon |
| `store/` | What the Chrome Web Store and Firefox Add-ons ask for: the listing, the permissions and the data, and screenshots |

## What it may do
- **activeTab and scripting:** read the tab you're on, once, when you click its button, its menu item or its shortcut. Nothing else, and nothing as you browse. The popup sends nothing until you save.
- **storage:** keep its settings.
- **contextMenus:** its Save job to Factwright and Fill this application items in the page's right-click menu.
- **sidePanel** (Chrome): the panel beside the page where filling a form is checked. Firefox's sidebar needs no permission. Neither shows a warning.
- **declarativeContent** (Chrome): rules Chrome checks itself, which light its button up on pages that look like an application form, so the extension reads nothing to light it. No warning either.
- **identity:** the browser's own window to sign in to sync through, which hands the answer to this extension alone, so there's no code to compare. Neither browser shows a warning for it, at install or on an update. It never reads your Google account or email.
- **nativeMessaging** (optional): asked for only when you choose Factwright on this computer in setup, or fill a form, to hand each job you save, and each ask as it fills a form, to Factwright's helper, `com.factwright.save`, and to nothing else. Each browser lets only this extension reach that helper. It's given back once you set the extension up to save through sync instead. An update that brings it asks nothing of anyone, as it's optional.
- **app.factwright.com:** Factwright's sync, the one site it reaches unless you choose a server of your own. Both browsers grant it at install, and let you take it away later: setup then asks for it back.
- **The job application sites** (optional, each named, and any https site you add): asked for only when you turn them on in setup or the panel, or add a careers site there, and then for those sites alone, so the browser asks you once, for them. There, and only there, the extension registers its script, in each page's top frame, never on LinkedIn or Indeed. Turned off, or taken away in the browser's settings, its script is unregistered, and stops on pages that are open. Signing in or out of sync never gives them back. An update that brings them asks nothing of anyone, as they're optional.
- **Its own frame** (web-accessible resources, `frame.html` alone): the Fill button and the menus the script shows on those sites, which the page can't read. Its address is one no site can guess: Chrome's changes each time Chrome starts, and Firefox's is the one Firefox gave the extension at install. So a site where it never shows can't load it to tell the extension's there, unless a site where it shows passes the address on.
- **A server of your own** (optional, `https://*/*`): asked for only when you choose Your own server in setup, and then for the address you type alone, so the browser asks you once, for that one site. It keeps that permission only while it's signed in there, or signing in: it's given back when you sign out, when signing in there fails or you cancel it, and when it signs in somewhere else. A wider permission you allow yourself in the browser's settings, such as all https sites, is yours, and it never takes that back. Its sign-in and everything it saves go only to the server it signed in to, and with your own, it reaches nothing of Factwright's.

Its only script in pages is the one it registers on the job sites you allowed, and only there, so elsewhere it reads nothing as you browse, and no site can tell it's installed or message it. Filling a form reads only the page you clicked Fill on, and while the panel shows that form, what's in its fields every few seconds, so it has what you sent once you submit it.

On the job sites you allowed, its script sees each field you can see, with its question and options, as Fill reads them, to put a Fill button on a page with an application form. The first time you click or tab into one of the form's fields, it sends those fields, never what's in them, to Factwright on this computer, which answers them as it does Fill, and the answers stay in the extension: the page's script gets only the one you pick, to put in the field, and only then. It reads what's in a field only once you've typed in it, or picked one of its options, and left it, and only for a field whose answer Profile keeps, to offer to keep a new answer, never a password. Equal-opportunity answers are only ever picked from a question's own options, as you set them in Profile, and kept on this computer alone if you choose Save. Those sites can tell the extension is there, as its frame is on the page. Through sync, it holds your job hunt's keys, which open all of it, as each linked device does: [docs/security.md](../../docs/security.md#the-browser-extension) says what that means.

A build for another sync server (`VITE_FACTWRIGHT_SYNC_SERVER`) must name an `https://` address, or this computer's, and gets no zips, so only a build for Factwright's own sync can go to the stores. Setup offers that server as Factwright's sync, and in such a build a server of your own can also be this computer's over http, for testing. The stores' build takes only https.

## Trying it
```bash
pnpm --filter @factwright/extension build
```

It makes `dist/chrome` and `dist/firefox`, and a zip of each.
- **Chrome:** open `chrome://extensions`, turn on Developer mode, then Load unpacked and pick `dist/chrome`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, then Load Temporary Add-on and pick `dist/firefox/manifest.json`. It stays until Firefox restarts.

Setup opens on its own. A copy loaded this way signs in to Factwright's sync with a code, since its server knows only the stores' copies by their IDs, and Chrome gives a copy loaded from a folder an ID of its own. Firefox gives it the stores' ID, so it signs in through the window. A server's `EXTENSION_IDS` can add a copy's ID ([apps/server](../server/README.md#the-extensions-window)).

To try saving to Factwright on this computer, build the desktop app's helper (`pnpm --filter @factwright/desktop helper`), then run the desktop app from the code with the unpacked extension's ID, from `chrome://extensions`, so it registers the helper for it as well as the stores' ID. On a Mac, then set the browser up in the app's Browser extension window, from its sidebar, as macOS asks first:

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

Firefox has a run of its own for saving to Factwright on this computer, as Playwright's Firefox can't load extensions: it drives a real Firefox over WebDriver BiDi, with the stores' build, the desktop app's helper built for testing, and the app's inbox code. Firefox finds the helper through a manifest in its home folder, so the run gives Firefox a temporary home of its own: through `HOME` on Linux, as CI runs it, and on a Mac through `CFFIXED_USER_HOME`, as a Mac's Firefox finds its Library folder from that rather than from `HOME`. It never writes to your own, where your Factwright registers its helper. Before it saves anything, it checks that Firefox finds no helper while the run has registered none: if Firefox ever read your folder instead, it would find your Factwright's helper, and the run stops there, having sent it only a hello, which changes nothing. On Windows, Firefox finds the helper through your own registry, so the run says so and stops. It needs Mozilla's Firefox 158 or later, not Ubuntu's snap, and a C compiler:

```bash
pnpm --filter @factwright/extension e2e:firefox
```

Filling a form has a run of its own in Chromium, as `e2e` does, with the desktop app's helper and its inbox and fill code, and the job application sites, which its build has from install (`FACTWRIGHT_JOB_SITES_AT_INSTALL`), as Chromium can't answer the prompt for them in a test, and which count this computer's site among them in a build for testing; `-- --shots <folder>` saves the panel, the filled form, the Fill button and a field's menu there:

```bash
pnpm --filter @factwright/extension e2e:fill
```

In Firefox, `e2e:firefox-fill` sends the built form function into forms served on this computer through the extension's own scripting, as its sidebar does, with the same Firefox 158 or later that `e2e:firefox` needs: it reads, fills, never a password, and uploads a file through Firefox's content-script sandbox. Then it turns the job application sites on in setup, which Firefox grants on the click with its prompt for optional permissions turned off, checks the script is registered and puts its Fill button on the form, presses it, and turns the sites off again. With no Factwright helper registered, the button says it couldn't find Factwright, and the run checks Firefox finds no helper first.

`FIREFOX=<path>` runs another Firefox than the one on PATH, or on a Mac than the one in Applications: CI runs Mozilla's 158 that way, since its runners' own is older. When Firefox can't reach the helper, it says "No such native application com.factwright.save" for one that isn't registered, or isn't for this extension, and only "An unexpected error occurred" for one that isn't where its manifest says, as when Factwright was moved to the trash. Setup reads both as Factwright not found, as it does Chrome's words.

## Publishing it
Both stores take the zip that `build` makes. [store/README.md](store/README.md) has what each asks for, in words to paste, and the steps.
- **Chrome Web Store:** a developer account (a one-time $5), then upload `dist/factwright-chrome-<version>.zip`.
- **Firefox Add-ons:** a free account, then upload `dist/factwright-firefox-<version>.zip`. Mozilla asks for the source too, since the code is bundled: a zip of this repository at the release's commit, with these steps to build it.

Raise `version` in `package.json` for each new upload: both stores take each version once.
