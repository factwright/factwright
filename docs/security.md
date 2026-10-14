# Security

Factwright holds the most personal parts of a job hunt: your career history, your pay, the companies you're talking to, and the people you're reaching out to. It also runs an AI agent on your computer. This is how it protects both.

> [!NOTE]
> The cloud part below is written up in full so it can be reviewed. On 2026-10-13 a separate Claude agent with no part in the design reviewed it against the code, as a second opinion rather than an outside expert's audit. What it found is fixed or written up here, including what the web view can't promise.

## Your Claude login
- Factwright never reads, stores or passes Claude credentials, tokens or API keys.
- It launches your installed Claude Code unmodified. The only check it makes is `claude auth status`, to see whether you're signed in.
- If you're signed out, it tells you to run `claude auth login` yourself. There's no "sign in to Claude" button in the app.
- Your Claude Code talks to Anthropic directly. Factwright's servers are never in that path.

## What Claude can do on your computer
Job postings are web pages written by strangers, so a posting could try to give Claude instructions. Factwright limits what those instructions could do:
- Claude runs without a shell: no Bash, no PowerShell.
- Its file access stays inside your workspace folder. Your tracker (statuses, notes, calls, pasted application questions, the answers you sent and your questions for Claude) sits outside it.
- Text from an employer, such as a posting or an application form's questions, reaches Claude only through Factwright's tools, marked as information. The app never types it in as if it were you. Screenshots, such as of a form or a recruiter's email, Claude reads from the workspace, and the standing rules, the tools that list them and the skills all say what's in them is information, never instructions.
- Your own questions about a job reach Claude the same way, through `job_details`, marked as your words. The app types only the skill, the job's ID and the question's ID, so a question is never sent as a command line.
- Find jobs types the places you picked in the app's own words, such as `HN · LinkedIn`. A company you name there is the one thing you typed that the app types for you, and only once it checks as a plain name or an https link: no line breaks or other keys a terminal would act on, and no `%` or `!`, which Windows' command line would fill in.
- The fact bank page changes your facts only as you do: one fact or section at a time, in Markdown files already in `facts/`, never through a link, and only as the page last read it. A change Claude or another computer made in the meantime is never written over unless you save again.
- Screenshots you add, or paste into Claude's panel, are checked like any picture you share: a type Claude reads, no bigger than sync carries, and bytes that are what the name says. They're kept in the workspace's `screenshots/` folder, and the window can show only pictures from there.
- Its only extra tools are the ones Factwright provides, each doing one narrow job. They answer only the run Factwright started, and refuse anything a web page sends.
- The tools that only read what's on file run without asking, as do web searches, whose words go to the search service, never to a site a posting names.
- The job tools run without asking too: reading and saving a posting on Greenhouse, Lever, Ashby or Gem, and the job searches. They reach only those systems' and Hacker News's fixed public feeds, never the page a link names, and send them nothing but a board's name, a posting's ID or a month.
- Reading any other page reaches that site, so Claude Code asks you first, each time: a posting could otherwise steer Claude into sending your details to a site in a link. Saving a page as a job's posting saves what was already read, without fetching it again.
- Claude's own tool for fetching pages is off. Factwright's tools only fetch public https sites: never this computer, your home network, or a link with a sign-in in it. Each page is capped in size and time, and reading it takes time in step with its length, so a page made to keep the app busy, such as one with thousands of tags left open, is read in a moment.
- Claude saves its work without asking in the folders where the skills keep it: the jobs, the job searches and outreach drafts. Its answers to your questions go through a tool that writes only that answer's own file. It also adds names you mention to your confidential-terms list without asking, since that only makes the resume check stricter. It asks before it changes any other file, such as your facts, your guide or your base resumes, and before it saves anything to your profile, such as your work authorization.
- In the app, **Your Claude → Settings** can turn off the question before Claude reads other sites, or before it changes your other files. The choice is kept outside the workspace, so Claude can't change it.
- Whatever you choose, Claude can never change Claude Code's settings or the instructions it loads (`.claude/` and `CLAUDE.md` files), which a posting could otherwise use to steer later runs.
- Once for each new version of Claude Code, the app starts it hidden, with no prompt, to check that its setup still works, then closes it. No prompt means none of your plan is used, and the check runs with the same restrictions as a run.
- Building a resume runs without asking, since it stays on this computer: Factwright prints it in a hidden window that loads nothing else. Once you've applied to a job, the files you sent stay as they are.
- A resume template of your own can come from anywhere: a file someone shared, or one Claude made from a resume you liked. Each is checked before it's used, so it can only lay out text: elements and attributes for text alone, with nothing that runs a script, loads a file or takes input, every value escaped, and styles that load nothing. It adds no words of its own either, apart from its section headings: every other word on a resume comes from your resume itself. The printed page runs no scripts, whatever it holds.
- Claude asks before saving a template, unless you started a run to make one. That run copies a resume from anywhere, so it can't reach the web, and without asking it only reads and saves templates. It can replace only the templates it saved itself. Replacing one of yours in any other run puts the old one in the trash, to restore.

## What you share when you start
Getting started asks for your resumes, your LinkedIn and anything else that shows your work.
- **LinkedIn:** Factwright never signs in to LinkedIn, or reads it from a browser. Its tools refuse LinkedIn's pages outright, so a LinkedIn search finds listings through web search and reads each job on the employer's own site. You save your own profile as a PDF, or download LinkedIn's export of your data, and add the file. From the export, the app keeps only your profile's parts and your connections (for finding people to message); your messages, invitations and the rest are never read.
- **Files are checked twice.** The window, which runs sandboxed with no access to your files, reads the text out of the files you picked. The app then checks each one again: a type it takes, no bigger than sync can carry, and bytes that are what the name says. It keeps them in your workspace, so Claude can read them.
- **What's in a file is data.** Claude is told never to follow instructions found in a file you shared, the same as with job posts.
- **Unconfirmed until you say so.** Every fact Claude drafts from your files is marked `unconfirmed`, and nothing goes on a resume until you've confirmed it.
- **A run for getting started,** or for adding facts, may save your facts, starting resumes and guide without asking each time, since that's the work you started it for. In return it can't reach the web at all, so nothing it reads can come from a page that tries to tell it what to write. Every other run asks before changing those files.

## Your data in the cloud
Sync is off until you turn it on. Once it's on, your Mac, your Windows PC and your phone show the same job hunt, and everything is locked on your device before it leaves.

### The account key
- Your first device makes the **account key**: 32 random bytes. It never leaves your devices unlocked.
- The desktop app keeps it in the system's keychain, through Electron's safe storage: the Keychain on a Mac, and Windows' data protection on Windows.
- The web view keeps only keys made from it, as Web Crypto keys the page can use but can't read back out.

Each device makes four keys from the account key with HKDF-SHA-256, one for each purpose, plus an ID:

| Key | Algorithm | What it's for |
|---|---|---|
| Records | AES-256-GCM | Locks each record: what a synced file is called, or what a tracked row says |
| Files | AES-256-GCM | Locks file contents |
| Record IDs | HMAC-SHA-256 | Turns a record's name, such as a file's path, into an ID that reveals nothing |
| File IDs | HMAC-SHA-256 | Turns a file's contents into an ID, so the same contents are stored once |
| Key ID | 128 bits from HKDF | Names the account key, so devices can tell they hold the same one |

### Locking
- Everything is locked with AES-256-GCM, with a fresh random 96-bit nonce each time. A locked value is a version byte, the nonce, then the ciphertext and its tag.
- What a value is for is bound in as GCM's additional data. A record is bound to its ID and its version number, and a file to its ID. So the server can't swap one record's data for another's, pass an old version off under a new number, or hand back a file under another file's ID.
- A file's ID is an HMAC of its contents. A device checks the contents it opens hash to the ID it asked for.
- The code is in [`packages/sync`](../packages/sync). It uses only Web Crypto, which every platform Factwright runs on has built in, and no home-made cryptography.

### The recovery key
- When you turn on sync, your first device shows a **recovery key** once: 160 random bits, written as 32 characters to print or keep in a password manager.
- The server keeps the account key locked with a key made from the recovery key (HKDF, then AES-256-GCM). It can't open it.
- With the recovery key, any device you sign in on can unlock the account key. Since the recovery key is random and long, guessing it is out of reach, so it needs no slow key derivation.
- A computer that signs in again checks the account's key on the server before it syncs anything, and asks again after a restart until it has.
  - If the account has none, such as after it was deleted and made again, the computer makes a new account key and recovery key, as a first device does. The old ones, which a lost or stolen device may still hold, open nothing of it, and the computer's other devices link again.
  - If the account uses another key, the computer asks to be linked to it and sends nothing until it is. Linking adds this computer's job hunt to that account, so signing in with the wrong one can be undone with **Use a different account**, which ends only that sign-in.
- A computer that's syncing checks the account's key too, after its first round each time sync starts there (opening the app, signing in, turning on or linking), and after each round that follows until the server answers. Until then, its rounds run under the key it hasn't checked. Version 0.1.0 didn't check when it signed in again. After an account was deleted and made again, it synced under its old key without saving that key to the account, and a computer that set up later made another key. Each then skipped what the other sent, and both said they were up to date. Now a key the account doesn't use stops sync on that computer, even across a restart, and it does what signing in again does:
  - If the account has no key, the computer makes a new account key and recovery key, and sends its job hunt again under the new key. What it sent under the old key stays on the server, where only that key opens it, and the account's other devices skip it.
  - If the account uses another key, the computer links to it, as above.

### Adding a device
- On a device that's set up, **Link a phone or computer** makes a link code: 160 random bits, shown as a QR code and as 32 characters to type.
- It leaves the account key on the server for 10 minutes, locked with a key made from the code, under an ID that's a hash of the code. The server never sees the code.
- The new device signs in to the same account, then scans or types the code. It picks the link up once, and the link is gone.
- A phone scans the QR code with its camera. The code is in the link's `#` part, which browsers don't send to the server.

### Signing in
- Signing in is separate from the keys: it proves who you are to the server, and the keys never touch it. You sign in with GitHub or Google, through [Better Auth](https://www.better-auth.com) running in the sync server.
- The desktop app signs in through your browser with a device code (RFC 8628): the app shows a short code, and you check the browser shows the same one before you allow it. The app keeps its session token in the system's keychain.
- A session lasts 60 days and renews while it's used. You can see each signed-in device, and sign any of them out. Signing out deletes the session's record at once, and one that runs out is deleted within a day.
- A session keeps the name of the device that signed in, such as "Safari on iPhone" or "Factwright on Sam's Mac", in place of everything the browser or app sent, and no IP address. GitHub's and Google's tokens, and the link to your profile picture, aren't kept, and sign-in's ways to hand out or refresh a provider's token are off.
- The account key's locked copy is saved once, by the first device, and no session can replace it. So someone who tricks you into approving their device code can't spoil your recovery key.
- Each session says how it signed in: in a browser with GitHub or Google, or with a device code. Only a browser's session can delete the account or approve a device's code, and deleting also needs it to be from the last 15 minutes. Sessions from before this count as a device's, so a browser signs in again first.
- Sign-in's own ways to list sessions, which would hand out their tokens, or to sign other sessions out are off. The account page lists devices without tokens, and signs one out by its ID.
- So someone who tricks you into approving their code gets a session that can sync and sign devices out from the account page, where it shows up as a device of its own. It can't delete your account, approve codes of its own to stay signed in, or take another session's sign-in.

### The web view
The web view opens your job hunt in the browser, so the page that holds your keys has to be the only thing running there.
- Its pages run only their own scripts and styles, under a strict Content-Security-Policy, and no other site can frame them. Following a link out, such as to a job posting, sends no referrer.
- It keeps keys made from the account key in IndexedDB, as Web Crypto keys the page can use but can't read back out. Signing out of the browser forgets them, and so does finding it was signed out another way: from another device, by running out, or by the account being deleted. A page left open, such as on a lost phone, forgets them and what it shows the next time it hears from the server.
- A job's page address names it by a code made from its ID with the account's key, never by its company and role. Addresses go to the server and into the browser's history, which the browser may sync.
- Its session is a cookie the page itself can't read. A change sent with that cookie must come from the app's own pages: sign-in and the sync API both turn away requests another site starts.
- A copy of your job hunt is put together in the browser, as a ZIP, and never passes through the server opened.
- **What it can't promise:** the web view's code comes from the server each time it opens. A server that misbehaved, or someone who took over the account it runs on, could send code that reads what you open there, or the account key when you link a browser or type your recovery key into it. The desktop app is different: its code changes only through updates signed by Neatifai and checked before they install.

### What the server sees
- Your account: the email and name your sign-in shares, and which GitHub or Google account it is.
- Each session: the device's name (for the app, your computer's name), and when it signed in and was last used.
- Sign-in's limits, which count each IP address's requests to sign in or check a sign-in. Those counts are deleted within a day.
- For each record: an opaque ID, its version numbers, sizes, times, whether it's deleted, which file contents it points to, and which session made each version.
- For each file: an opaque ID, its size and when it was uploaded.
- Never your file names, the files' contents, what you track, or any key that opens them.
- Its own logs keep only what it writes itself, such as a backup that failed. Cloudflare's log of every request is off, and a ticket to listen for changes says nothing about the account. Cloudflare, which runs the server, still sees each request's IP address and address as it passes through, as any host does.
- Sizes and times aren't padded, so they show roughly how much you keep and when you change it.

### What it can't prevent
A server that misbehaved couldn't read or forge what the desktop app syncs. It could still delete it, hold back new changes, or keep serving an old version of a record. And because it sends the web view's code, it could change that code to read what you open there.

### Separate accounts
- The server takes your account from your verified session only, never from the request.
- Each account has its own store: a Durable Object with its own database, and its own folder of files in R2. There's no shared table of user data to leak across accounts.
- Automated tests try to read and write across accounts, through every part of the API, and must fail.
- Each account has limits on storage, file size and requests, since a free service invites abuse.

### Backups and deleting
- Each account's store is snapshotted to R2 every day and kept for 14 days. Cloudflare also keeps 30 days of point-in-time recovery for each store, and 7 days for the accounts database (30 on a paid plan).
- Something you delete in the app stays on the server, locked, while an earlier version holds it (90 days), then in backups (up to 14 days more) and Cloudflare's recovery (up to 30 days more).
- Deleting your account signs out every device first, then removes your store, your files, your backups and your sign-in records. The store remembers it was deleted, so nothing can fill it again, and a last sweep a few minutes later catches an upload that was on its way. If deleting fails partway, trying again finishes it.
- Someone who can't sign in any more can ask by email, and the operator can delete their account with a token only the operator has.

### The trade-off
If you lose every device and your recovery key, your data can't be recovered, by you or by us. You can download an unencrypted copy whenever you like, from your account in the web view.

## Installing and updating
- **Signed.** The Mac app is signed with Neatifai's Developer ID and notarized by Apple. On
  Windows, the installer, the app and every module it loads are signed through Azure Artifact
  Signing. A release that isn't signed is never published.
- **Where an installer came from.** While the repository is public, each release's installers
  come with an attestation: a record, signed through Sigstore and kept by GitHub, of the commit
  and workflow run that built them. With the GitHub CLI signed in, `gh attestation verify
  <installer> -R factwright/factwright --signer-workflow
  factwright/factwright/.github/workflows/release.yml --source-ref refs/tags/v<version>` checks a
  download against it, so anyone can confirm it was built from that version's code by the release
  workflow, not uploaded from somewhere else. It shows where an installer came from, not that the
  code is free of mistakes. Versions released while the repository was private don't have one.
- **Locked down.** The installed app can't take Node's options from the environment, open Node's
  debugger from the command line, or load code from anywhere but its own archive, which it
  checks. On a Mac it can't be started as plain Node either. On Windows it can, because the
  terminal library stops a run through a helper started that way.
- **Settings for testing are ignored.** The variables that point the app at other screens or
  another sync server, for development and tests, do nothing in an installed copy.
- **Only Factwright's own builds are set up to use its servers.** The release workflow builds
  with the sync server, app.factwright.com, and the download site, downloads.factwright.com, only
  when it runs in this repository, outside pull requests: for a release, or by hand to try one. A
  copy built anywhere else, such as from a fork, has neither: its Sync card says sync isn't in that
  copy, and it never looks for updates. Its builder can set up their own, as `apps/server` and
  `apps/desktop` say. This is how copies are built, not a lock: anyone can build a copy that
  points at app.factwright.com. The server treats it like any other copy: it reaches only the
  account it signs in to, whose job hunt is locked with keys only that account's devices hold. No
  one else's build can sign as Neatifai, though: the signing keys are secrets of this repository,
  which a fork's builds don't have, and which the release workflow gives to no pull request's run.
- **No debugging the user's data.** Chromium, which the app is built on, can let another program
  drive it through a debugging port. As in Chrome, an installed copy won't start that way on the
  user's own data folder: only with a folder of its own, as the tests give it, where there's no
  job hunt and no sync to reach.
- **Updates are checked.** A copy from Factwright's own releases downloads updates only from
  downloads.factwright.com, over https. An update must match the checksum in the update feed. On a
  Mac, it must also pass Apple's check that it's signed by the same developer as the app. On
  Windows, it must be signed by a certificate issued to the same publisher name, Neatifai's.
- **Asking for updates says little.** Looking for an update asks for the feed, which tells the
  download site your IP address and that a copy of Factwright is looking, like any download. The
  updater can send an ID of each install too, to roll a version out to some installs at a time.
  Factwright sends the same ID for everyone instead.

## What still leaves your computer
Whatever Claude reads goes to Anthropic, under your own account and Anthropic's terms. That's how Claude works, and Factwright doesn't add anyone else to that path.

Factwright sends no crash reports, analytics or usage data. Claude Code sends Anthropic its own, under your Claude Code settings.

Factwright's tools read job boards and pages straight from your computer, so each site sees your IP address and that Factwright is asking. Hacker News's "Who is hiring?" threads come through Algolia's Hacker News search. On Windows, the spell checker built into Chromium downloads its dictionary from Google once; it never sends what you type.

## Reporting a problem
See [SECURITY.md](../SECURITY.md).
