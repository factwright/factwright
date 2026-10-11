# Desktop app

The Factwright app for Mac and Windows, built with Electron and TypeScript.

It will:
- run your own installed Claude Code in a built-in terminal you can watch, without touching your login
- give Claude the tools it needs over MCP, from saving postings to rendering resumes
- keep your workspace and tracker on your computer, and sync them encrypted

## How it's put together
| Folder | What's there |
|---|---|
| [`src/main`](src/main) | The main process: the window, the app's security rules, and talking to Claude Code ([`src/main/claude`](src/main/claude)) |
| [`src/preload`](src/preload) | The bridge: the short list of requests the window may make |
| [`src/renderer`](src/renderer) | The window's screens, built from the [design system](../../packages/ui) |
| [`src/shared`](src/shared) | The types both sides of the bridge agree on |
| [`scripts`](scripts) | The development runner |

The window is locked down:
- It runs sandboxed, with no Node and no access to files.
- It loads only the app's own files, from an `app://` address, under a strict content security policy.
- It can't navigate away or open other windows. Links to https sites open in your browser.
- The main process checks that every request comes from the app's own page.

## Run it
- `pnpm dev` from the repo root opens the app. The screens reload as you edit them, and the app restarts when the main process changes. Extra arguments go to Electron, such as `--remote-debugging-port=9223`.
- `pnpm --filter @factwright/desktop screens` shows the screens in a browser with sample data, for checking the design. `?claude=signed-out` picks Claude's state (also `missing`, `too-old`, `unknown` and `checking`), and `?platform=win32` shows the Windows title bar layout.
- `pnpm --filter @factwright/desktop build`, then `start`, runs the built app.

**Status:** in progress, in phase 3 of the [roadmap](../../docs/roadmap.md). The window opens and checks that your Claude Code is installed, up to date and signed in. Claude's panel comes next.
