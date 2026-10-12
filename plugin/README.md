# Claude Code plugin

What Factwright loads into each Claude Code run, through Claude Code's own `--plugin-dir` flag: its skills, step-by-step instructions Claude follows for one job-hunt task, and its standing rules.

**Standing rules:** [`standing-rules.md`](standing-rules.md) is added to Claude's instructions in every run (`--append-system-prompt-file`), whichever skill is working, and for plain questions too. Facts come first, a fact drafted from your files isn't used until you confirm it, everything on file for a job is read before anything's fetched, what you've already told Factwright is checked before you're asked again, feedback becomes a nudge, confidential details stay out of what you send (Claude keeps your confidential-terms list as you mention names), what went out stays as it went, and the How to apply format.

**Starter files:** [`starter/`](starter) holds what a new workspace starts with: the binding rules, a writing guide, resume styles for startups, established companies and public employers, empty preferences and confidential terms, and the fact bank's format. The app copies in the ones a workspace lacks when you start getting to know your Claude, and never replaces one that's there.

| Skill | What it does | What it saves |
|---|---|---|
| `/factwright:fit-check` | A quick verdict on one job, scored against your fact bank, plus what people say about the company | The job's folder: `posting.md`, `job.md`, `fit-check.md`, and `apply.md` for special steps. A row in `searches/fit-checks.md` |
| `/factwright:focused-resume` | A resume tailored to one job: maps the job to your facts, asks about what's missing, then builds and fact-checks the PDF or Word file | The job's `resume.json`, `notes.md` and the resume files. New facts in `facts/` |
| `/factwright:get-started` | Gets to know you from what you shared in the app: drafts your fact bank with every fact marked unconfirmed, interviews you to confirm it and fill the gaps, then builds and fact-checks a starting resume in each template you picked | `facts/`, `guide/rules.md`, and `base/` with its resume files |
| `/factwright:add-facts` | Adds or corrects facts about your experience. "Interview me" confirms drafted facts and fills gaps, or starts a fact bank, and it reads files and notes you've shared since | `facts/` |
| `/factwright:answer-questions` | Answers an application form's questions, typed or in screenshots, in your voice, backed by your facts, what you told Factwright and what you sent on other applications | The job's `answers.md`. What forms ask again, such as your work authorization, in your profile |
| `/factwright:ask` | Answers your own question about one job, such as what to expect from a call, from everything on file for it and the web | `asked/<job>/<question>.md`, which the app shows under the question |
| `/factwright:interview-prep` | Gets you ready for a call or interview, or talks a job through, with a mock interview on request | The job's `prep.md` |
| `/factwright:job-search` | Searches one source (HN's "Who is hiring?" thread, a company's job board, or a careers page) and ranks what passes your criteria by how well your facts fit | `searches/<month>-<source>/`: the source word for word, `jobs.json` (which the app lists under To review) and `report.md` |
| `/factwright:salary-check` | Estimates the pay for a job that doesn't list it, with sources and a confidence level | A row in `searches/salary-checks.md` |
| `/factwright:unmask-job` | Finds the real employer behind a recruiter or job-board listing, and whether to apply direct | The job's folder, with `unmask.md`. A row in `searches/unmask-checks.md` |
| `/factwright:who-to-message` | Finds 3–5 people worth messaging at a company, with drafts you send yourself | `outreach/<date>-<company>.md` |

The skills work on plain files in your workspace, in the formats the app reads, so their work shows up in the app on its own. Every claim they make about you traces to your fact bank in `facts/`.

The app passes the rest with each run:
- **Tools:** the ones Claude uses instead of a shell. The app serves them over MCP on this computer ([`apps/desktop/src/main/tools`](../apps/desktop/src/main/tools)), and the skills call them by name:
  - `find_job` and `job_details`: what's on file for a job, with a line on what each file holds, your notes and calls, the application's questions with what you actually sent, and your questions about it
  - `about_you`: what you told Factwright about yourself, such as your work authorization and when you can start
  - `past_answers`: what you sent on your applications, in your own words, to reuse and to sound like you
  - `save_answer`: Claude's answer to your question about a job, kept with the job
  - `save_about_you`: something you told Claude that applications ask for, saved to your profile, which Claude Code asks you about first
  - `read_posting`: a posting on Greenhouse, Lever, Ashby or Gem, read from the applicant system's public feed
  - `read_page`: any other web page as plain text
  - `save_posting`: a posting saved word for word in the job's folder, from what was read
  - `build_resume`: a job's resume, or a starting resume, built as a PDF or Word file, with how it fits the pages
  - `job_board`: every open job on a company's Greenhouse, Lever, Ashby or Gem board, saved word for word, and whether a posting is still open
  - `hn_jobs`: every post in Hacker News's "Who is hiring?" thread, saved word for word
- **Hooks:** they tell the app when Claude finishes or needs you.
- **Settings:** they keep the run locked down. Without asking, Claude searches the web, runs these skills, uses the tools that stay on this computer or reach only the job systems' public feeds, and saves its work in `applications/`, `searches/` and `outreach/`. A run started for getting started or for more facts saves your facts, starting resumes and guide without asking too, and can't reach the web. Claude Code asks you before Claude reads any other page or changes any other file, unless you choose otherwise in the app (Your Claude → Settings). It never changes Claude Code's settings or the instructions Claude Code loads.

All of it applies to that run only. Your own Claude Code settings are never changed.

**Status:** in progress, in phase 5 of the [roadmap](../docs/roadmap.md). All nine skills from the original repo are here, made to work for anyone, plus getting started and your own questions about a job.
