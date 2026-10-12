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
- The first seven skills, ported from the original repo: fit check, add facts, answer application questions, interview prep, salary check, unmask a job, and who to message. They use Factwright's tools instead of scripts and git, and save their work where the app reads it.
- `read_page`: Claude reads a public web page through Factwright, which asks you first. `find_job` works from a posting's link alone. Web searches and Factwright's skills run without asking.
- Run with your Claude: each job's panel starts a tailored resume, a fit check, a salary check, who to message, interview prep or the application's questions on that job, in Claude's panel, and shows where each stands. The app types the command itself, naming the job only by its ID.
- Tailored resumes: the `/factwright:focused-resume` skill, ported from the original repo, and a `build_resume` tool that builds a job's resume as a PDF or Word file. It checks the resume against your rules and confidential terms, says how it fits the pages, and keeps the files that went out with an application.
- `@factwright/engine`: the resume engine, ported from the original repo. It lays out a resume as a PDF-ready page in three layouts and as a Word file, checks it against your rules and confidential terms, and measures how its lines fit. A resume can name the heading over its systems cards.
- Job searches: the `/factwright:job-search` skill, ported from the original repo, and a Find jobs button that starts it. Two tools feed it: `hn_jobs` saves every post in Hacker News's "Who is hiring?" thread, and `job_board` saves every open job on a company's Greenhouse, Lever, Ashby or Gem board and says whether a posting is still open. Both save word for word in the search's folder, and run without asking, since they send only a board's name or a month to fixed public APIs. The jobs that fit show up under To review.
- `@factwright/core`: reading whole job boards and Hacker News's hiring thread.
- Resumes look the same on a Mac as on Windows: each one carries open fonts drawn to the widths of the Windows fonts the layouts use (Carlito, renamed Factwright Sans, for Calibri; Caladea for Cambria; Selawik for Segoe UI; and Barlow in place of Bahnschrift). Printed on a Mac, a resume made on Windows breaks every line in the same place.
- Application questions: the job panel's Application questions asks for the form's questions first, one box each, the way the original dashboard did. They're kept with the job in your tracker, and Claude reads them through `job_details`, never as typed commands. The button reads Ran once answers are on file.
- The setup check: once for each version of Claude Code, which updates itself, the app starts it hidden with no prompt, so it uses none of your plan. It checks that Claude Code reaches Factwright's tools and that its hooks arrive. A failure shows in the sidebar's Your Claude card, with Check again.
- The first run's trust question, explained: when Claude Code asks whether to trust the workspace, the run reads "Needs your answer", and a note says how to answer. It also explains that the warning about running files doesn't apply, since Claude Code has no shell here.
- Resume previews: each resume PDF in a job's panel has Preview, which shows its pages in the app, drawn by pdf.js, with a way to open it in your PDF app.
- End-to-end tests: Playwright drives the built app through its main flows on a made-up job hunt. A stand-in for Claude Code answers the app's checks and runs, through the same hooks and tools, and never reaches Anthropic. They run in CI on every change.
- Windows checks: a weekly workflow runs the unit and end-to-end tests on Windows, ahead of the first run on a Windows PC.
- `@factwright/sync`: end-to-end encryption and the sync protocol. An account key made on your first device, with keys for each purpose made from it; a recovery key; link codes for adding a device; locking with AES-256-GCM, bound to what each value is; and merging two devices' changes to the same row. It uses only Web Crypto. The key design is written up in the security doc.
- The sync server (`apps/server`), a Cloudflare Worker. Sign-in with GitHub or Google through Better Auth, and a device code you approve in your browser for the desktop app. Each account gets its own store, a Durable Object with its own database, plus a folder of encrypted files in R2. It keeps each record's history for 90 days, stores each file's contents once, holds link codes for adding a device, tells listening devices about changes as they happen, backs every store up daily, and cleans up after itself. It sees only locked data, and tests try to reach across accounts through every route.
