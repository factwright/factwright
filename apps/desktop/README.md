# Desktop app

The Factwright app for Mac and Windows, built with Electron and TypeScript.

It will:
- run your own installed Claude Code in a built-in terminal you can watch, without touching your login
- give Claude the tools it needs over MCP, from saving postings to rendering resumes
- keep your workspace and tracker on your computer, and sync them encrypted

**Status:** in progress, in phase 3 of the [roadmap](../../docs/roadmap.md). So far, [`src/main/claude`](src/main/claude) finds the user's Claude Code, checks its version and sign-in, and builds its locked-down launch command. The window, the terminal panel and the screens come next.
