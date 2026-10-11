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
- **Signals to the app:** hooks report when Claude is working, needs your answer, or is done. They go over HTTP to a server on this computer that only accepts that run's token. The token reaches Claude Code through its environment, never a file. The same server answers Claude's calls to Factwright's tools.
- **Matching colors:** Claude Code uses its ANSI theme, so the panel's colors come from the design system.

You can tuck the panel away while Claude works, and it comes back whenever Claude needs you. If you're in another app, a notification tells you.

## Claude's tools
Each run gets Factwright's own tools over MCP ([`src/main/tools`](src/main/tools)), in place of a shell. The server that hears the run's hooks answers them, only for that run's token, and refuses anything a web page sends.
- **find_job:** whether you've seen a job before: its fit check, job search, folder and status. The skills call it before starting on a job.
- **job_details:** everything on file for a job, including your notes, calls and history. This is how Claude reads your tracker, without reaching its database.
- **save_posting:** saves a posting word for word in the job's folder, from the applicant system's API (Greenhouse, Lever, Ashby or Gem) or the page itself. A posting already saved there is kept. It only fetches public https sites, never this computer or your home network, and gives up on pages that are too big or too slow.

The two that only read run without asking. Claude Code asks you before each save_posting, since it reaches the internet: a job post could otherwise steer Claude into sending your details to a site in a link.

## Your jobs
Your jobs come from two places, joined into one list:
- **The workspace:** what the skills save there, such as fit checks, job searches, and each job's folder with its posting and resumes. The app reads it with [`@factwright/core`](../../packages/core), and reads it again whenever something changes, so new work shows up on its own.
- **The tracker:** what you set by hand, such as statuses with their dates, applied dates, next steps, notes, and calls. It's a small SQLite database (Node's built-in `node:sqlite`) in the app's data folder, beside the workspace rather than in it, so Claude's file tools can't reach it.

Each job keeps its ID in the tracker, so your notes stay with it as new work comes in. A job you've tracked stays listed even if its files go away.

The jobs screen ([`src/renderer/jobs`](src/renderer/jobs)) follows the approved mockup:
- **The list:** the numbers that matter (in play, applied, heard back, needs you), the views (active, to review, applied, closed), search across companies, roles and notes, and each job's next step. Rows reflow to fit the window instead of scrolling sideways.
- **The job panel:** everything on file for the picked job:
  - its status, which you can change
  - the next step, with a date that puts it in "Needs you" when it's due
  - how to apply, when there are special steps
  - why it scored what it did, part by part, with the evidence
  - what people say about the company
  - calls and interviews: log one, and it moves the job forward
  - your notes, which save as you type
  - its resumes and documents
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

**Status:** in progress, in phase 3 of the [roadmap](../../docs/roadmap.md). The window checks your Claude Code and runs it in Claude's panel with Factwright's tools, shows your jobs, and keeps your tracker. The skills and the Run buttons come next.
