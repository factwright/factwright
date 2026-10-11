# Changelog

Notable changes to Factwright, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions will follow [Semantic Versioning](https://semver.org/) once releases begin.

## Unreleased

### Added
- Project skeleton: workspace layout, tooling, CI and project docs.
- `@factwright/core`: job tracker statuses, matching keys for company and role names, date checks and pay parsing.
- Secret scanning in CI: TruffleHog checks every push and pull request for leaked keys, and can scan the whole history on demand.
- Desktop app groundwork: finding the user's Claude Code, checking its version and sign-in, and building its locked-down launch command.
- `@factwright/ui`: the design system. Colors for light and dark are checked against WCAG AA. The first components are buttons, status pills, fit badges, Claude's run status, the views switcher, search, sidebar items, stats and notices, with a gallery page to see them all.
- `@factwright/core`: fit tiers, from strong to skip.
- The desktop app's window, built from the design system. It runs sandboxed and loads only the app's own files over an `app://` address. The sidebar shows whether your Claude Code is installed, up to date and signed in, and what to do when it isn't. `pnpm dev` runs it.
- `@factwright/ui`: the logo and an empty-state block.
- Claude's panel: your own Claude Code runs live in the app, locked down. It runs with no shell, only Factwright's plugin and settings, and no claude.ai connectors. Its status reads Starting, Working, Needs your answer, Done or Stopped, from Claude Code's hooks. The panel tucks away and comes back when Claude needs you, with a notification if you're in another app.
- `@factwright/ui`: the terminal's colors, checked against WCAG AA in the roles Claude Code gives them, and a Starting state for Claude's status.
- The plugin folder has its manifest, so Claude Code loads it.
- `@factwright/core`: reading the workspace into jobs, ported from the original dashboard. It reads the fit check log, each job's folder, job searches, salary and employer checks, and drafted messages, and joins them into one job each. It also reads a fit check's score breakdown and what people say about the company.
- Tracking in the job panel: a next step with a date, logging calls and interviews (which move a job forward), notes that save as you type, history with dates you can fix and an Undo, and archiving.
- Adding a job by hand, filters (fit, source, minimum pay, has a resume, archived), and Your journey: how far your jobs got and how they ended, with a flow chart for sankeymatic.com and a spreadsheet to save.
- `@factwright/ui`: form fields, menus, checkboxes, filter chips and dialogs.
- `@factwright/core`: each job's journey, its flow chart and its spreadsheet. Spreadsheet cells that start like a formula are kept as text.
- The jobs screen, as the approved mockup shows it: the numbers that matter, views, search, and each job's next step, with a panel for everything on file for a job. You can change a job's status there, read its documents, and open its resumes.
- `@factwright/core`: where each job stands, what needs your attention, the stats and views, and the apply steps from `apply.md`.
- `@factwright/ui`: the status menu, score bars, the "what people say" badge, a red tint, and a safe Markdown view for documents.
- Email links, such as how to apply by email, open your mail app.
- The desktop app reads your jobs from the workspace, and reads them again when something changes. Your tracker keeps statuses with their dates, applied dates, next steps, notes and calls, in a small database beside the workspace. Logging a call moves a job forward, and you can undo a mis-click.
- Factwright's tools for Claude, over MCP: `find_job` (whether you've seen a job before), `job_details` (everything on file, including your notes and calls) and `save_posting` (a posting saved word for word from Greenhouse, Lever, Ashby, Gem or the page). Each run gets them from a server on this computer that answers only that run. The two that read run without asking; Claude Code asks you before each posting it fetches, and fetching reaches only public https sites.
- `@factwright/core`: reading a job posting as plain text, from an applicant system's API or a web page.
