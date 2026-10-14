# Desktop app

The Factwright app for Mac and Windows, built with Electron and TypeScript.

It:
- runs your own installed Claude Code in a built-in terminal you can watch, without touching your login
- gives Claude the tools it needs over MCP, from saving postings to rendering resumes
- keeps your workspace and tracker on your computer, and syncs them, locked, to your other computers and your phone

## How it's put together
| Folder | What's there |
|---|---|
| [`src/main`](src/main) | The main process: the window, the app's security rules, running Claude Code ([`src/main/claude`](src/main/claude)), Claude's tools ([`src/main/tools`](src/main/tools)), your jobs ([`src/main/jobs`](src/main/jobs)), and sync ([`src/main/sync`](src/main/sync)) |
| [`src/preload`](src/preload) | The bridge: the short list of requests the window may make |
| [`src/renderer`](src/renderer) | The window's screens, built from the [design system](../../packages/ui) |
| [`src/shared`](src/shared) | The types both sides of the bridge agree on |
| [`scripts`](scripts) | The development runner, the app icons' drawing, the README's screenshots, a fix node-pty needs after every install, and a release's check and publishing, with a test that runs the publishing against stand-ins for R2 |
| [`build`](build) | The app icons, drawn from Factwright's mark (`pnpm --filter @factwright/desktop icon`), and what the Mac's hardened runtime allows. The installers build them in, and the app shows the icon in the Dock while you develop |
| [`release-notes`](release-notes) | What's new in each version, which installed copies show as they update |

The window is locked down:
- It runs sandboxed, with no Node and no access to files.
- It loads only the app's own files, from an `app://` address, under a strict content security policy.
- It can't navigate away or open other windows. Links to https sites open in your browser.
- The main process checks that every request comes from the app's own page.

## Installers and updates
[`electron-builder.config.mjs`](electron-builder.config.mjs) makes the installers: a Mac disk image
for Apple silicon and Intel, and a Windows installer that needs no administrator. A release signs
them, notarizes the Mac app and puts them on downloads.factwright.com
([docs/releasing.md](../../docs/releasing.md)). An installed copy looks there every few hours,
downloads a new version in the background, and shows **Update ready** at the bottom of the
sidebar ([`src/main/updates.ts`](src/main/updates.ts)). It installs on restart, or the next time
the user quits. A copy being developed, or built on this computer, never updates itself.

## Claude's panel
Claude's panel runs your own Claude Code in a real terminal (node-pty and xterm.js), in the workspace folder inside the app's data folder. Each run is locked down too:
- **No shell:** Claude Code starts in restricted mode, so it can't run commands.
- **Only Factwright's extras:** it loads only Factwright's plugin, tools and settings.
- **No outside reach:** your claude.ai connectors are off, and there's no browser automation.
- **Signals to the app:** hooks report when Claude is working, needs your answer, or is done. While a permission prompt or question is open, it keeps reading "Needs your answer", even as tools running alongside finish. They go over HTTP to a server on this computer that only accepts that run's token. The token reaches Claude Code through its environment, never a file. The same server answers Claude's calls to Factwright's tools.
- **Matching colors:** Claude Code uses its ANSI theme, so the panel's colors come from the design system.

You can tuck the panel away while Claude works, and it comes back whenever Claude needs you. If you're in another app, a notification tells you.

**Pictures:** a picture pasted into the panel, such as a screenshot, is checked like any picture you share, saved in the workspace with the run's job (`screenshots/<job>/pasted-…`, or `screenshots/` without one), and pasted as where it is. Claude Code attaches a pasted picture's path as the picture itself. Screenshots added with the application's questions or a question for Claude are kept in the same folder, named for what they came with, and `job_details` lists each one.

The first run asks a question of its own: Claude Code wants to know whether to trust the workspace, and says it will be able to "execute files". When the app sees that question on screen:
- The run reads "Needs your answer", and the panel comes back.
- A note above the terminal says how to answer: use the arrow keys to pick "Yes, I trust this folder", then press Enter.
- The note also explains that the warning doesn't apply: Claude Code has no shell here, so it can't run programs.
- The panel grows to fit the note rather than shrinking the terminal, because Claude Code can drop a line of its screen when it redraws for a resize.

## The setup check
Claude Code updates itself, so a new version could change something Factwright relies on. Once for each version, the app checks its setup ([`src/main/claude/self-test.ts`](src/main/claude/self-test.ts)). It starts your Claude Code hidden, with exactly what a run gets but no prompt, so it uses none of your plan. Then:
1. It waits for Claude Code to reach Factwright's tools.
2. It closes it the way you would, with Ctrl-C twice.
3. It waits for the session-end hook to arrive.

That covers the launch flags, the tools and their token, the settings, and the hooks. The result is kept in the app's data folder:
- **Passed:** nothing shows.
- **Failed:** the sidebar's Your Claude card says what went wrong, in Claude Code's own words where it can, with Check again.
- **Waiting at the trust question:** a workspace Claude Code doesn't trust yet stops at that question. The check waits for your first run, and tries again at the next launch.

## Claude's tools
Each run gets Factwright's own tools over MCP ([`src/main/tools`](src/main/tools)), in place of a shell. The server that hears the run's hooks answers them, only for that run's token, and refuses anything a web page sends.
- **find_job:** whether you've seen a job before: its fit check, job search, folder and status. It matches the company loosely, or the posting's link alone. The skills call it before starting on a job.
- **job_details:** everything on file for a job: where it stands, your notes, calls and history, and a line for each file saved for it, saying what that file holds, so Claude knows it's there and reads what bears on the task. It also gives the application's questions with what you actually sent, and your questions about the job, with which are answered. This is how Claude reads your tracker, without reaching its database.
- **about_you:** what you told Factwright about yourself when you started, and in Profile since, in words: your contact details, what you're looking for, pay, work authorization and when you can start. Skills check it before asking you anything an application asks.
- **past_answers:** what you sent on your applications, in your own words, newest first, narrowed to questions like one when asked. Claude reuses what you said, and matches how you sound.
- **save_answer:** saves Claude's answer to one of your questions about a job in `asked/<job>/<question>.md`, which the job's panel shows under the question.
- **save_about_you:** saves something you told Claude that applications ask for again, such as your work authorization or notice period, to your profile. It changes your profile, so Claude Code asks you first, unless you let Claude change any file, or the run is for getting to know you.
- **read_posting:** a posting on Greenhouse, Lever, Ashby or Gem, read from the applicant system's public feed and never the page the link names.
- **read_page:** any public web page as plain text, such as a posting on another site, a careers page or a team page. It answers with at most 40,000 characters, since Claude Code moves longer answers somewhere Claude can't read.
- **save_posting:** saves a posting word for word in the job's folder: what read_posting or read_page read from that link in the run, or a posting read from its applicant system's feed. It reaches no other site. A posting already saved there is kept.
- **build_resume:** builds a job's resume from its `resume.json`, or a starting resume from `base/<name>.json`, with the [resume engine](../../packages/engine), as a PDF, a Word file or both. It checks the resume against your rules and confidential terms, and says how many pages it runs to, how full the last one is, and which lines run short. Once you've applied to a job, it keeps the files you sent.
- **list_templates**, **read_template** and **save_template:** the resume templates the user can pick, built in and their own; a template's file, to start another from; and saving one Claude made, once it passes the engine's checks, with a printed preview for Claude to read. Saving asks first, unless the run was started to make a template. It replaces one of the user's templates only when asked to. A run started to make a template can replace only the ones it saved itself, and any other run's replacement puts the one before in the trash.
- **job_board:** every open job on a company's board on Greenhouse, Lever, Ashby or Gem, saved word for word as one file in a job search's folder, with a list for Claude: where each job is, its pay, when it was posted, and its link. Given a link to one posting, it says whether that posting is still open. Only the board's name goes to the applicant system's API.
- **hn_jobs:** every job post in Hacker News's monthly "Who is hiring?" thread, saved word for word as `hn-thread.md` in a job search's folder, with each post's first line for Claude. A long thread comes with where each run of 50 posts sits in the file, so Claude can split the reading between helpers.

Reading and saving only fetch public https sites, never this computer or your home network, and give up on pages that are too big or too slow. A whole board can run to 25 MB, since big companies' boards carry every posting in full; a page stops at 5 MB.

The tools that stay on this computer run without asking, apart from save_about_you, as do web searches and Factwright's skills. So do read_posting, save_posting, job_board and hn_jobs: they reach only the applicant systems' and Hacker News's public feeds, and send them nothing but a board's name, a posting's ID or a month. Claude also saves its work in `applications/`, `searches/` and `outreach/` without asking, and adds to `guide/confidential-terms.txt`, which only makes the resume check stricter.

Claude runs on Opus unless you choose otherwise: **Your Claude → Settings** picks the model for everything, and for each task the app starts (each Run button, and Find jobs). The app passes it with `--model`. When Claude is open on another model than a task needs, the app starts a new run on that model instead of switching the open one, since `/model` would also change your own Claude Code default.

Each task also has an effort: how long Claude thinks before it acts. Restricted mode ignores your own Claude Code settings, so the app sets it with `--effort`, by your plan, which `claude auth status` reports when the run starts. On Max, Team and Enterprise it's extra high, except job searches at high, since they read hundreds of postings and weigh each one lightly. On Pro, whose limits are tightest, it's high, and medium for salary checks and job searches. Max is yours to pick, since it can take many minutes a run. The same settings change it for everything or for one task. A task that needs more effort than the open run starts a new run the same way, since `/effort` would change your own default too; one that needs less runs in the open run, at its effort, so a salary check after a fit check doesn't start Claude over. Claude Code lowers a level a model can't reach on its own.

Claude Code asks you before each page read_page fetches, since it reaches any site: a job post could otherwise steer Claude into sending your details to a site in a link. It also asks before Claude changes any other file, such as your facts. **Your Claude → Settings** lets you turn either question off, from Claude's next start; the choice is kept in the app's data folder, outside the workspace, so Claude can't change it. Whatever you choose, Claude never changes Claude Code's settings or the instructions Claude Code loads (`.claude/` and `CLAUDE.md`).

## Printing resumes
The main process prints resumes in one hidden window ([`src/main/resume`](src/main/resume)), with Chromium's own layout, so the PDF matches what was measured:
- **Locked down:** the window has its own session, kept in memory. It loads only the page it's given, and every other request is refused, so a resume can't reach the network or your files.
- **The last page:** after printing, it finds how full the last page is by printing again with a growing spacer at the end, until the spacer would start a new page.
- **Fonts:** every resume carries the [engine's fonts](../../packages/engine/fonts), built into the app, which stand in for the Windows fonts the layouts were designed with. So a resume prints the same on a Mac as on Windows, down to where each line breaks. The window loads each one before it prints or measures.

## Getting started and Profile
A new user, with no jobs and no fact bank yet, opens on **Get started**: seven short steps, saved as they go (in the workspace's `about-me/` folder), so they can stop and pick up later.
- **Welcome:** what Factwright does, that it runs their own Claude Code and never sees its login, and their Claude's state. When Claude Code is missing, signed out or too old, the steps to fix it, with the exact command to copy and a button that opens Terminal (PowerShell on Windows). The user runs it themselves; the app checks again when they come back. Someone who already uses Factwright on another computer can turn on sync instead.
- **About you:** their name and contact details, as resumes should show them.
- **Your files:** resumes (PDF, Word or text), their LinkedIn profile saved as a PDF, LinkedIn's own export of their data as a ZIP, and screenshots and other documents. The window reads the text out of PDFs (with pdf.js) and Word files, and out of the LinkedIn export it keeps only the profile's spreadsheets and the connections. The app checks each file again before keeping it ([`src/main/about`](src/main/about)).
- **In your words:** a big box for everything about them, with prompts to start from, and the names to keep off every resume.
- **What you want:** job titles, kinds of work, levels, where, kinds of company, industries, pay, terms, must-haves and deal-breakers, and a quiet search.
- **Templates:** the resume templates, the app's two and any of their own, each a real print of a sample resume with their own name on it, and the ones that suit them picked for each kind of company they're aiming at. They can bring a resume whose look they like, as a PDF or a picture, for their Claude to make a template from, or a template file someone shared. Plus the length and the files.
- **Ready:** a summary, what happens next, and Start with your Claude, which copies in the starter files the workspace lacks, writes the files built from the answers, and starts `/factwright:get-started`.

**Profile** follows Claude as it drafts the fact bank, confirms it with the user and builds their starting resumes, then keeps every answer changeable: the fact bank (with how many facts are left to confirm, and anything shared since Claude last read), the starting resumes (to preview, open, or build again), what they want, their templates, what they've shared and their contact details. The files built from the answers (`searches/criteria.md`, `guide/templates.md` and the page count in `guide/lint.json`) follow each change, unless someone has changed them by hand since.

**Fact bank** ([`src/renderer/facts`](src/renderer/facts)) shows `facts/` file by file:
- **Each claim** is a card: its tags in words (Live, Led and built, High confidence), the words resumes use, and its details. Each file's other sections, such as its overview, show around them.
- **Search** reaches every file, and **To confirm** gathers the facts drafted from your files that you haven't checked.
- **Changing a fact** happens in a form, so its tags stay ones the skills know. A section changes as Markdown. Confirming a fact does what the skills do: it drops `unconfirmed` and makes you its source, with the date.
- **Each change** goes to the main process as one block, the way the window read it ([`src/main/about/facts.ts`](src/main/about/facts.ts)). A block that changed since, such as by Claude or another computer, is refused rather than overwritten, and the rest of the file stays byte for byte. Only Markdown files already in `facts/` change, each saved whole or not at all, never through a link.

A run started for getting started or for more facts may save the facts, starting resumes and guide without asking each time, which every other run asks before doing, and it can't reach the web at all. A run started to make a template may read and save templates without asking, and nothing else: it can't reach the web either, and asks before building a resume, saving an answer or changing any file, since the resume it copies came from anywhere. Each tool call knows which run it's from, so that run can replace only the templates it saved. The app keeps that resume in `templates/sources/`, under a name of its own, and names it to Claude by that. A task that needs other permissions, or another model, starts a run of its own.

## Your jobs
Your jobs come from two places, joined into one list:
- **The workspace:** what the skills save there, such as fit checks, job searches, and each job's folder with its posting and resumes. The app reads it with [`@factwright/core`](../../packages/core), and reads it again whenever something changes, so new work shows up on its own.
- **The tracker:** what you set by hand, such as statuses with their dates, applied dates, next steps, dated notes, calls, and an application's questions. It's a small SQLite database (Node's built-in `node:sqlite`) in the app's data folder, beside the workspace rather than in it, so Claude's file tools can't reach it.

Each job keeps its ID in the tracker, so your notes stay with it as new work comes in. A job you've tracked stays listed even if its files go away.

The jobs screen ([`src/renderer/jobs`](src/renderer/jobs)) follows the approved mockup:
- **The list:** the numbers that matter (in play, applied, heard back, needs you), the views in the order a job moves through them (to review, to apply, applied, interviewing, closed, and all), search across companies, roles and notes, and each job's next step. Jobs in interviews show their calls so far, and jobs to review say which search found them. Rows reflow to fit the window instead of scrolling sideways. It opens on the view you last picked, or the first time, the one furthest along with jobs in it.
- **Find jobs:** asks where to look: Hacker News's "Who is hiring?" thread (the newest, or a month), LinkedIn, Indeed, companies' job boards on Greenhouse, Lever, Ashby and Gem, or a company you name. Claude finds LinkedIn's and Indeed's listings through web search and reads each job on the employer's own site; Factwright's tools never read LinkedIn's pages. Then it starts the search in Claude's panel, the same safe way as the Run buttons: the app types `/factwright:job-search` and the places itself (`HN · LinkedIn`), and a company you typed only once it checks as a name or an https link. Each place is a search of its own, and **Found by** narrows the list to one, such as the month's HN thread. The jobs that fit land under To review.
- **The job panel:** everything on file for the picked job, under a header that stays in view, with its status, which you can change. **Expand** gives the job the whole window, in two columns, with the previous and next jobs in the list a click away; Escape puts it back. The next step, with a date that puts it in "Needs you" when it's due, and how to apply, when there are special steps, come first. The rest is in sections that open and close, and stay as you left them:
  - **Progress:** each step the job has taken, from found to where it is now, with its date, and the step ahead. The dates of the steps you marked, and the applied date, can be fixed in place, and Undo takes back the latest change. Under it, the calls and interviews: log one, and it moves the job forward.
  - **Notes:** jot down what was said on a call, names, anything to remember. Each note is dated today, or the day you pick, newest first, and you can change or delete it. Notes from before notes had dates stay at the end.
  - **Your Claude:** what Claude can do for the job.
    - **Run with your Claude:** a tailored resume, a fit check, a salary check, who to message, interview prep, or the application's questions, started on this job in Claude's panel. Each says where it stands (Run, Running, Done, or Ran and Ready for work already on file), and the next step for the job is highlighted. The window sends the app only the skill's name and the job's ID, and the app types the command (`/factwright:fit-check job <id>`), so text from a posting never reaches Claude as if you'd typed it. Claude that's open and done takes the next one; otherwise Claude starts with it.
    - **Application questions** asks for the form's questions first, one box each, or screenshots of the form, and keeps them with the job however the dialog closes. Answer with Claude starts the run, and Claude reads the questions through `job_details` as questions to answer, never as commands.
    - **Ask Claude:** your own questions about the job, such as what to expect from a call, each with Claude's answer once it's in, kept to come back to. A question can come with screenshots, such as an email from the recruiter. Asking keeps the question in your tracker and starts `/factwright:ask job <id>`, and Claude reads the question through `job_details`, the same way as the application's questions.
  - **Fit:** why it scored what it did, part by part, with the evidence, what people say about the company, and what the job search noted
  - **Application answers:** each of the application's questions with Claude's suggestion, and a box for what you actually sent, which saves as you type. It's there to look back on when the job moves on, and Claude reads it before your interviews.
  - **Files:** its resumes and documents. Preview shows a resume PDF's pages right there, exactly as an employer will see them, drawn by [pdf.js](https://github.com/mozilla/pdf.js). pdf.js loads only when a preview opens, and draws pages the way it prints, so a preview finishes even with the window in the background. The window can read only PDFs in your workspace, up to 20 MB.
  - **Activity:** everything that happened with the job, newest first
  - archiving, which takes it out of your lists without losing anything

  Beside the list when there's room, and over it when the window is narrow.
- **Adding a job:** the top bar's Add job button, for jobs you found yourself.
- **Filters:** fit, minimum pay, has a resume, and archived jobs.
- **Your journey:** how far your jobs got and how they ended, as a summary or a flow chart of every path they took, drawn in the app. It also copies the paths as text for sankeymatic.com, or saves a spreadsheet with each step's date.
- **Opening files:** documents open formatted, in the app. Resumes open in your own PDF or Word app, and only PDF and Word files inside the workspace can open that way.
- **Copying and saving:** the window asks the main process. Saving a file always goes through the system's save dialog, so you pick where it goes.

## Sync
Sync keeps your workspace and tracker the same on each of your computers, and your phone, locked before they leave ([`src/main/sync`](src/main/sync)). It's off until you turn it on, from the sidebar's Sync card. The design is in [docs/security.md](../../docs/security.md).
- **Signing in:** your browser opens Factwright's sign-in page, where you sign in with GitHub or Google, check it shows the code the app shows, and allow it. The app gets its own session, and opens only the sync server's own pages.
- **The first computer** makes the account key, and shows your recovery key once, to copy or save as a file before sync turns on.
- **Every other computer** links with a code from one that's set up, or with the recovery key. Link a phone or computer shows the code, with a QR code for a phone's camera.
- **Secrets:** the session token and the account key are locked with the system's keychain (Electron's safe storage) before they're written to the data folder. The keychain isn't touched until you turn sync on.
- **What syncs:** every file in the workspace, and every row of the tracker: jobs, their history, calls and notes. Hidden files, other apps' temporary files, files over 25 MB and names Windows can't hold stay put, and the dialog says how many.
- **When:** a moment after each change here, right away when another device changes something (the server tells each listening device), and every ten minutes anyway. Offline, it waits and tries again, and your changes stay safe here.
- **When both changed something,** nothing is lost. A file keeps both: the other device's version in its place, and this computer's beside it, named with the computer and the day, like `notes (Sam’s Mac, Oct 12).md`. A tracked job merges: its links, questions, the answers you sent, your questions for Claude, and its notes keep both sides, and the later change wins a clash. A note changed elsewhere shows up in the job panel unless you're typing in it.
- **Managing it:** the Sync dialog lists your signed-in devices, signs any of them out, makes link codes, turns sync off on this computer (its job hunt stays), and opens your account on the web, to download everything or delete the account.
- **Only Factwright's own releases** are built with its sync server, app.factwright.com, and its download site. A copy built anywhere else, such as from a fork or on your own computer, has neither: its Sync card says sync isn't in that copy, and it never looks for updates. To sync a copy you build, run a [sync server](../server) of your own, and build with `FACTWRIGHT_SYNC_SERVER` set to its address; `FACTWRIGHT_DOWNLOADS_URL` does the same for updates.

## Run it
- **The app:** `pnpm dev` from the repo root opens it. The screens reload as you edit them, and the app restarts when the main process changes. Extra arguments go to Electron, such as `--remote-debugging-port=9223`.
- **The screens alone:** `pnpm --filter @factwright/desktop screens` shows them in a browser with sample data, for checking the design.
  - `?claude=signed-out` picks Claude's state (also `missing`, `too-old`, `unknown` and `checking`).
  - `?jobs=none` shows the screen before there are jobs (also `failed` and `loading`). Otherwise made-up jobs show every state. Edits, such as logging a call or adding a job, stick until a reload.
  - `?platform=win32` shows the Windows title bar layout.
  - `?sync=on` picks sync's state (also `off`, `first`, `link`, `signing-in`, `syncing`, `offline`, `problem`, `signed-out`, `unavailable` and `no-server`). Turning it on plays through each step.
  - `?profile=done` shows a finished profile (also `new` and `started`).
  - Start Claude plays a short made-up run, including a question. With `?run=asks`, interview prep stops to ask one too.
- **The README's screenshots:** `pnpm --filter @factwright/desktop screenshots` takes them again from the same sample data, each framed as a Mac window, in light and dark, into [`docs/images`](../../docs/images). Take them on a Mac, after a change they show. It needs Playwright's Chromium, once: `pnpm --filter @factwright/desktop exec playwright install chromium`.
- **The built app:** `pnpm --filter @factwright/desktop build`, then `start`.
- **Sync against a server on this computer:** set `FACTWRIGHT_SERVER_URL`, such as `http://localhost:8787` for the [sync server](../server) run with `pnpm --filter @factwright/server dev`. Without it, a copy you run from the code has no sync server, as no copy built outside Factwright's releases does.
- **End-to-end tests:** after a build, `e2e` drives the built app with [Playwright](https://playwright.dev) through its main flows ([`e2e`](e2e)):
  - It runs on a made-up job hunt in a fresh data folder.
  - A stand-in for Claude Code ([`e2e/fake-claude`](e2e/fake-claude)) comes first on PATH. It answers the version and sign-in checks, and in a run reaches Factwright's tools and sends its hooks as Claude Code does. It never reaches Anthropic, so the tests use no plan.
  - `FACTWRIGHT_SETUP_WAIT_MS` shortens the setup check's wait, so the tests see it finish.
  - Sync's tests run two copies of the app against the [sync server](../server), run locally in workerd, with a stand-in keychain: one turns sync on, the other links with a code, and a change on one shows up on the other.
  - CI runs the tests on every change, on Linux, with a virtual display.
  - A [Windows workflow](../../.github/workflows/windows.yml) runs the unit and end-to-end tests on Windows: weekly, by hand, and when its file changes. It doesn't run on every change, because Windows minutes cost twice as much on GitHub's free plan. Its stand-in is `claude.cmd`.

**Status:** Phase 3's code is done, and phase 4 of the [roadmap](../../docs/roadmap.md) is in progress. Sync works end to end against the sync server running locally, and goes live once the server is deployed.
