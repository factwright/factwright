<div align="center">

<img src="apps/desktop/build/icon.png" width="112" height="112" alt="Factwright">

# Factwright

**Tailored to the job. True to the facts.**

An open-source job hunt app for Mac and Windows, run by your own Claude, and free during the beta.<br>
Every resume line and application answer traces back to a fact you've confirmed.

[Download for Mac](https://factwright.com/download/mac) · [Download for Windows](https://factwright.com/download/windows) · [Website](https://factwright.com) · [How your data is protected](docs/security.md)

[![Release](https://img.shields.io/github/v/tag/factwright/factwright?sort=semver&label=release&color=2f4bd0)](CHANGELOG.md)
[![CI](https://github.com/factwright/factwright/actions/workflows/ci.yml/badge.svg)](https://github.com/factwright/factwright/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-2f4bd0)](LICENSE)
[![macOS and Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-5e5d56)](https://factwright.com/download)

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/jobs-dark.webp">
  <img src="docs/images/jobs-light.webp" alt="Factwright on a Mac: the job hunt's numbers and jobs, one job open with a Run button for each task, and Claude's panel underneath, where your own Claude Code is writing an interview prep sheet and has stopped to ask which round the interview is.">
</picture>

Factwright is a desktop app that runs your job hunt on top of Claude Code, using your own Claude account. At its center is a **fact bank**: everything you've done, written as claims you can check. Every resume, answer and prep sheet is built from it, so what you send is tailored to the job and still true.

> [!NOTE]
> Factwright is in beta. The [changelog](CHANGELOG.md) says what's new, and the [roadmap](docs/roadmap.md) where it's headed.

## What it does
- **Getting started.** Share your old resumes, your LinkedIn, screenshots and everything you'd say about yourself, then say what you're looking for. Your Claude drafts your fact bank from it, interviews you to confirm it, and builds your first resumes.
- **Fact bank.** Your experience as checkable claims: what you did, how far it got, and how to say it. It grows each time an application asks about something new, and you can read, search and fix every fact in the app.
- **Find jobs.** Searches Hacker News's monthly "Who is hiring?" thread, companies' job boards, a company you have in mind, and LinkedIn's and Indeed's listings, which it finds through web search and reads on the employer's own site. Factwright never signs in to LinkedIn.
- **Fit check.** Scores a job against your fact bank before you spend time on it, along with what people say about the company.
- **Tailored resumes.** A resume for each job, in a template you pick, then a second pass that fact-checks every line. PDF or Word. Bring a resume whose look you like, and your Claude makes a template of your own in that look.
- **Answers and interview prep.** Application answers and prep sheets drafted from the same facts, in your voice. Keep what you actually sent beside each question, so it's there when the job moves on.
- **Ask about a job.** Ask anything, such as what to expect from a call, with screenshots if you have them. Claude answers from everything on file for the job and the web, and the answer stays with the job.
- **Tracking.** Every job's progress, calls, interviews and dated notes in one place, on your computer and your phone, and your whole journey drawn as a flow chart.

<table>
  <tr>
    <td width="50%">
      <a href="docs/images/fact-bank-light.webp"><picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/fact-bank-dark.webp">
        <img src="docs/images/fact-bank-light.webp" alt="The fact bank: a company's facts, each with its status, ownership and confidence, the numbers behind it, and what to say and never say. One is waiting to be confirmed.">
      </picture></a>
    </td>
    <td width="50%">
      <a href="docs/images/journey-light.webp"><picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/journey-dark.webp">
        <img src="docs/images/journey-light.webp" alt="Your journey: a flow chart of twelve jobs, from found and checked through applied, screens and interviews, to an offer, and how the rest ended.">
      </picture></a>
    </td>
  </tr>
  <tr>
    <td align="center"><b>The fact bank:</b> what's true, and how to say it</td>
    <td align="center"><b>Your journey:</b> how far your jobs got, and how they ended</td>
  </tr>
</table>

## How it's built
- **Your Claude, untouched.** Factwright launches the Claude Code you've already installed and signed in to, in a panel you can watch. It never sees, stores or passes your login, and runs use your own plan or API key.
- **Your files, on your computer.** Claude works on plain files in a folder on your machine, using tools Factwright provides instead of a shell.
- **Your data, encrypted.** Sync is optional. It encrypts your job hunt on your computer before it's uploaded, with a key our servers never see, so they store it only in a form they can't read. The web view on your phone runs code the server sends, which [docs/security.md](docs/security.md) explains.
- **Out in the open.** All of its code is here, under the AGPL-3.0, so you can read what it does, or build the app yourself.

More in [architecture](docs/architecture.md) and [security](docs/security.md).

## Install
- **Mac:** [download Factwright](https://factwright.com/download/mac) for Apple silicon and Intel, on macOS 12 or later.
- **Windows:** [download Factwright](https://factwright.com/download/windows) for 64-bit Windows 10 and 11.

You also need [Claude Code](https://code.claude.com/docs/en/setup), signed in with a Claude plan or an API key. Factwright checks your setup when it opens, walks you through anything that's missing, and keeps itself up to date.

## Support Factwright
Factwright is open source, and free during the beta. It's built by [Steve Hillyer](https://github.com/steve1two). If it helps your job hunt, you can support it:

<a href="https://github.com/sponsors/steve1two"><img src="https://img.shields.io/badge/Sponsor_on_GitHub-db61a2?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub"></a>
<a href="https://buymeacoffee.com/stevehillyer"><img src="https://img.shields.io/badge/Buy_Steve_a_coffee-ffdd00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy Steve a coffee"></a>

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
| [`docs`](docs) | Architecture, security, releasing and the roadmap |

## Development
You need Node.js 24 or newer and pnpm.

```bash
pnpm install
pnpm dev     # run the app
pnpm check   # format, lint, typecheck and test
pnpm fix     # apply formatting and safe lint fixes
```

Each folder's README says how its part works and how to run it. Releases are built, signed and published by GitHub when a version is tagged: see [docs/releasing.md](docs/releasing.md).

## Contributing
Pull requests aren't open yet, but bug reports and ideas are welcome as issues. See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security problems privately, as [SECURITY.md](SECURITY.md) explains.

## License
[AGPL-3.0](LICENSE). Copyright © 2026 Neatifai LLC.

The resume fonts in [`packages/engine/fonts`](packages/engine/fonts) are under the SIL Open Font License 1.1, by their own authors.

Factwright isn't affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.
