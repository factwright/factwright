# Factwright

Your job hunt, run by your own Claude. Tailored resumes where every line is backed by a fact.

[![CI](https://github.com/factwright/factwright/actions/workflows/ci.yml/badge.svg)](https://github.com/factwright/factwright/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

> [!NOTE]
> Factwright is in early development and isn't usable yet. The [roadmap](docs/roadmap.md) shows where it's headed.

Factwright is a desktop app for Mac and Windows that runs your job hunt on top of Claude Code, using your own Claude account. At its center is a **fact bank**: everything you've done, written as claims you can check. Every resume line, application answer and interview story traces back to it, so what you send is tailored to the job and still true.

## What it does
- **Getting started.** Share your old resumes, your LinkedIn, screenshots and everything you'd say about yourself, then say what you're looking for. Your Claude drafts your fact bank from it, interviews you to confirm it, and builds your first resumes.
- **Fact bank.** Your experience as checkable claims: what you did, how far it got, and how to say it. It grows each time an application asks about something new, and you can read, search and fix every fact in the app.
- **Fit check.** Scores a job against your fact bank before you spend time on it, along with what people say about the company.
- **Tailored resumes.** A resume for each job, in a template you pick, then a second pass that fact-checks every line. PDF or Word. Bring a resume whose look you like, and your Claude makes a template of your own in that look.
- **Answers and interview prep.** Application answers and prep sheets drafted from the same facts, in your voice. Keep what you actually sent beside each question, so it's there when the job moves on.
- **Ask about a job.** Ask anything, such as what to expect from a call, with screenshots if you have them. Claude answers from everything on file for the job and the web, and the answer stays with the job.
- **Tracker.** Every job, status, call and interview in one place, on your computer and your phone.

## How it's built
- **Your Claude, untouched.** Factwright launches the Claude Code you've already installed and signed in to. It never sees, stores or passes your login, and runs use your own plan or API key.
- **Your files, on your computer.** Claude works on plain files in a folder on your machine, using tools Factwright provides instead of a shell.
- **Your data, encrypted.** Sync between your devices is end-to-end encrypted. The server stores data it can't read.

More in [architecture](docs/architecture.md) and [security](docs/security.md).

## Repository layout
| Path | What's there |
|---|---|
| [`apps/desktop`](apps/desktop) | The app for Mac and Windows |
| [`apps/web`](apps/web) | The web view of your job hunt, for your phone or any browser |
| [`apps/server`](apps/server) | The sync server |
| [`apps/site`](apps/site) | The website, factwright.com |
| [`packages/core`](packages/core) | Shared logic: reading the workspace, jobs, tracker rules and pay parsing |
| [`packages/sync`](packages/sync) | End-to-end encryption and the sync protocol |
| [`packages/ui`](packages/ui) | The design system and shared screens |
| [`packages/engine`](packages/engine) | Turns resume data into PDF and Word files |
| [`plugin`](plugin) | The skills Factwright gives Claude Code, such as the fit check and interview prep |
| [`docs`](docs) | Architecture, security and the roadmap |

## Development
You need Node.js 24 or newer and pnpm.

```bash
pnpm install
pnpm check   # format, lint, typecheck and test
pnpm fix     # apply formatting and safe lint fixes
```

## Contributing
Pull requests aren't open yet, but bug reports and ideas are welcome as issues. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License
[AGPL-3.0](LICENSE). Copyright © 2026 Neatifai LLC.

The resume fonts in [`packages/engine/fonts`](packages/engine/fonts) are under the SIL Open Font License 1.1, by their own authors.

Factwright isn't affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.
