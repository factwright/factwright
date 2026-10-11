# Desktop app

The Factwright app for Mac and Windows, built with Electron and TypeScript.

It will:
- run your own installed Claude Code in a built-in terminal you can watch, without touching your login
- give Claude the tools it needs over MCP, from saving postings to rendering resumes
- keep your workspace and tracker on your computer, and sync them encrypted

## How it's put together
| Folder | What's there |
|---|---|
| [`src/main`](src/main) | The main process: the window, the app's security rules, running Claude Code ([`src/main/claude`](src/main/claude)), and your jobs ([`src/main/jobs`](src/main/jobs)) |
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
- **Only Factwright's extras:** it loads only Factwright's plugin, MCP servers and settings.
- **No outside reach:** your claude.ai connectors are off, and there's no browser automation.
- **Signals to the app:** hooks report when Claude is working, needs your answer, or is done. They go over HTTP to a server on this computer that only accepts that run's token. The token reaches Claude Code through its environment, never a file.
- **Matching colors:** Claude Code uses its ANSI theme, so the panel's colors come from the design system.

You can tuck the panel away while Claude works, and it comes back whenever Claude needs you. If you're in another app, a notification tells you.

## Your jobs
Your jobs come from two places, joined into one list:
- **The workspace:** what the skills save there, such as fit checks, job searches, and each job's folder with its posting and resumes. The app reads it with [`@factwright/core`](../../packages/core), and reads it again whenever something changes, so new work shows up on its own.
- **The tracker:** what you set by hand, such as statuses with their dates, applied dates, next steps, notes, and calls. It's a small SQLite database (Node's built-in `node:sqlite`) in the app's data folder, beside the workspace rather than in it, so Claude's file tools can't reach it.

Each job keeps its ID in the tracker, so your notes stay with it as new work comes in. A job you've tracked stays listed even if its files go away.

## Run it
- **The app:** `pnpm dev` from the repo root opens it. The screens reload as you edit them, and the app restarts when the main process changes. Extra arguments go to Electron, such as `--remote-debugging-port=9223`.
- **The screens alone:** `pnpm --filter @factwright/desktop screens` shows them in a browser with sample data, for checking the design.
  - `?claude=signed-out` picks Claude's state (also `missing`, `too-old`, `unknown` and `checking`).
  - `?platform=win32` shows the Windows title bar layout.
  - Start Claude plays a short made-up run, including a question.
- **The built app:** `pnpm --filter @factwright/desktop build`, then `start`.

**Status:** in progress, in phase 3 of the [roadmap](../../docs/roadmap.md). The window checks your Claude Code and runs it in Claude's panel, and the app reads your jobs and keeps your tracker. The job list screens and Factwright's tools come next.
