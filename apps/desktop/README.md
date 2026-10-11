# Desktop app

The Factwright app for Mac and Windows, built with Electron and TypeScript.

It will:
- run your own installed Claude Code in a built-in terminal you can watch, without touching your login
- give Claude the tools it needs over MCP, from saving postings to rendering resumes
- keep your workspace and tracker on your computer, and sync them encrypted

## How it's put together
| Folder | What's there |
|---|---|
| [`src/main`](src/main) | The main process: the window, the app's security rules, running Claude Code ([`src/main/claude`](src/main/claude)), Claude's tools ([`src/main/tools`](src/main/tools)), and your jobs ([`src/main/jobs`](src/main/jobs)) |
| [`src/preload`](src/preload) | The bridge: the short list of requests the window may make |
| [`src/renderer`](src/renderer) | The window's screens, built from the [design system](../../packages/ui) |
| [`src/shared`](src/shared) | The types both sides of the bridge agree on |
| [`scripts`](scripts) | The development runner, and a fix node-pty needs after every install |

The window is locked down:
- It runs sandboxed, with no Node and no access to files.
- It loads only the app's own files, from an `app://` address, under a strict content security policy.
- It can't navigate away or open other windows. Links to https sites open in your browser.
- The main process checks that every request comes from the app's own page.

## Claude's panel
Claude's panel runs your own Claude Code in a real terminal (node-pty and xterm.js), in the workspace folder inside the app's data folder. Each run is locked down too:
- **No shell:** Claude Code starts in restricted mode, so it can't run commands.
- **Only Factwright's extras:** it loads only Factwright's plugin, tools and settings.
- **No outside reach:** your claude.ai connectors are off, and there's no browser automation.
- **Signals to the app:** hooks report when Claude is working, needs your answer, or is done. While a permission prompt or question is open, it keeps reading "Needs your answer", even as tools running alongside finish. They go over HTTP to a server on this computer that only accepts that run's token. The token reaches Claude Code through its environment, never a file. The same server answers Claude's calls to Factwright's tools.
- **Matching colors:** Claude Code uses its ANSI theme, so the panel's colors come from the design system.

You can tuck the panel away while Claude works, and it comes back whenever Claude needs you. If you're in another app, a notification tells you.

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
- **job_details:** everything on file for a job, including your notes, calls and history. This is how Claude reads your tracker, without reaching its database.
- **read_page:** a public web page as plain text, such as a posting, a careers page or a team page. Postings on Greenhouse, Lever, Ashby and Gem are read from the applicant system's API. It answers with at most 40,000 characters, since Claude Code moves longer answers somewhere Claude can't read.
- **save_posting:** saves a posting word for word in the job's folder, the same way. A posting already saved there is kept.
- **build_resume:** builds a job's resume from its `resume.json` with the [resume engine](../../packages/engine), as a PDF, a Word file or both. It checks the resume against your rules and confidential terms, and says how many pages it runs to, how full the last one is, and which lines run short. Once you've applied to a job, it keeps the files you sent.
- **job_board:** every open job on a company's board on Greenhouse, Lever, Ashby or Gem, saved word for word as one file in a job search's folder, with a list for Claude: where each job is, its pay, when it was posted, and its link. Given a link to one posting, it says whether that posting is still open. Only the board's name goes to the applicant system's API.
- **hn_jobs:** every job post in Hacker News's monthly "Who is hiring?" thread, saved word for word as `hn-thread.md` in a job search's folder, with each post's first line for Claude. A long thread comes with where each run of 50 posts sits in the file, so Claude can split the reading between helpers.

Reading and saving only fetch public https sites, never this computer or your home network, and give up on pages that are too big or too slow. A whole board can run to 25 MB, since big companies' boards carry every posting in full; a page stops at 5 MB.

The tools that stay on this computer run without asking, as do web searches and Factwright's skills. So do job_board and hn_jobs: they reach only the applicant systems' and Hacker News's public APIs, and send them nothing but a board's name or a month. Claude Code asks you before each page read_page or save_posting fetches, since they reach any site: a job post could otherwise steer Claude into sending your details to a site in a link.

## Printing resumes
The main process prints resumes in one hidden window ([`src/main/resume`](src/main/resume)), with Chromium's own layout, so the PDF matches what was measured:
- **Locked down:** the window has its own session, kept in memory. It loads only the page it's given, and every other request is refused, so a resume can't reach the network or your files.
- **The last page:** after printing, it finds how full the last page is by printing again with a growing spacer at the end, until the spacer would start a new page.
- **Fonts:** every resume carries the [engine's fonts](../../packages/engine/fonts), built into the app, which stand in for the Windows fonts the layouts were designed with. So a resume prints the same on a Mac as on Windows, down to where each line breaks. The window loads each one before it prints or measures.

## Your jobs
Your jobs come from two places, joined into one list:
- **The workspace:** what the skills save there, such as fit checks, job searches, and each job's folder with its posting and resumes. The app reads it with [`@factwright/core`](../../packages/core), and reads it again whenever something changes, so new work shows up on its own.
- **The tracker:** what you set by hand, such as statuses with their dates, applied dates, next steps, notes, calls, and an application's questions. It's a small SQLite database (Node's built-in `node:sqlite`) in the app's data folder, beside the workspace rather than in it, so Claude's file tools can't reach it.

Each job keeps its ID in the tracker, so your notes stay with it as new work comes in. A job you've tracked stays listed even if its files go away.

The jobs screen ([`src/renderer/jobs`](src/renderer/jobs)) follows the approved mockup:
- **The list:** the numbers that matter (in play, applied, heard back, needs you), the views (active, to review, applied, closed), search across companies, roles and notes, and each job's next step. Rows reflow to fit the window instead of scrolling sideways.
- **Find jobs:** starts a job search in Claude's panel, the same safe way as the Run buttons: the app types `/factwright:job-search` itself, and Claude asks you where to look, with the newest HN "Who is hiring?" thread first. The jobs that fit land under To review.
- **The job panel:** everything on file for the picked job:
  - its status, which you can change
  - the next step, with a date that puts it in "Needs you" when it's due
  - how to apply, when there are special steps
  - **Run with your Claude:** a tailored resume, a fit check, a salary check, who to message, interview prep, or the application's questions, started on this job in Claude's panel. Each says where it stands (Run, Running, Done, or Ran and Ready for work already on file), and the next step for the job is highlighted. The window sends the app only the skill's name and the job's ID, and the app types the command (`/factwright:fit-check job <id>`), so text from a posting never reaches Claude as if you'd typed it. Claude that's open and done takes the next one; otherwise Claude starts with it.
  - **Application questions** asks for the form's questions first, one box each, and keeps them with the job however the dialog closes. Answer with Claude starts the run, and Claude reads the questions through `job_details` as questions to answer, never as commands.
  - why it scored what it did, part by part, with the evidence
  - what people say about the company
  - calls and interviews: log one, and it moves the job forward
  - your notes, which save as you type
  - its resumes and documents. Preview shows a resume PDF's pages right there, exactly as an employer will see them, drawn by [pdf.js](https://github.com/mozilla/pdf.js). pdf.js loads only when a preview opens, and draws pages the way it prints, so a preview finishes even with the window in the background. The window can read only PDFs in your workspace, up to 20 MB.
  - its history, where you can fix a date or undo the latest change
  - archiving, which takes it out of your lists without losing anything

  Beside the list when there's room, and over it when the window is narrow.
- **Adding a job:** the top bar's Add job button, for jobs you found yourself.
- **Filters:** fit, where the job turned up, minimum pay, has a resume, and archived jobs.
- **Your journey:** how far your jobs got and how they ended. It copies the paths as text for sankeymatic.com, which draws them as a flow chart, or saves a spreadsheet with each step's date.
- **Opening files:** documents open formatted, in the app. Resumes open in your own PDF or Word app, and only PDF and Word files inside the workspace can open that way.
- **Copying and saving:** the window asks the main process. Saving a file always goes through the system's save dialog, so you pick where it goes.

## Run it
- **The app:** `pnpm dev` from the repo root opens it. The screens reload as you edit them, and the app restarts when the main process changes. Extra arguments go to Electron, such as `--remote-debugging-port=9223`.
- **The screens alone:** `pnpm --filter @factwright/desktop screens` shows them in a browser with sample data, for checking the design.
  - `?claude=signed-out` picks Claude's state (also `missing`, `too-old`, `unknown` and `checking`).
  - `?jobs=none` shows the screen before there are jobs (also `failed` and `loading`). Otherwise made-up jobs show every state. Edits, such as logging a call or adding a job, stick until a reload.
  - `?platform=win32` shows the Windows title bar layout.
  - Start Claude plays a short made-up run, including a question.
- **The built app:** `pnpm --filter @factwright/desktop build`, then `start`.
- **End-to-end tests:** after a build, `e2e` drives the built app with [Playwright](https://playwright.dev) through its main flows ([`e2e`](e2e)):
  - It runs on a made-up job hunt in a fresh data folder.
  - A stand-in for Claude Code ([`e2e/fake-claude`](e2e/fake-claude)) comes first on PATH. It answers the version and sign-in checks, and in a run reaches Factwright's tools and sends its hooks as Claude Code does. It never reaches Anthropic, so the tests use no plan.
  - `FACTWRIGHT_SETUP_WAIT_MS` shortens the setup check's wait, so the tests see it finish.
  - CI runs the tests on every change, on Linux, with a virtual display.

**Status:** in progress, in phase 3 of the [roadmap](../../docs/roadmap.md). The window checks your Claude Code and runs it in Claude's panel with Factwright's tools and skills, shows your jobs with their Run buttons, runs job searches, and keeps your tracker. Pasting an application's questions before a run comes next.
