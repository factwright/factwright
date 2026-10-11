# Claude Code plugin

What Factwright loads into each Claude Code run, through Claude Code's own `--plugin-dir` flag. Today that's its skills: step-by-step instructions Claude follows for one job-hunt task.

| Skill | What it does | What it saves |
|---|---|---|
| `/factwright:fit-check` | A quick verdict on one job, scored against your fact bank, plus what people say about the company | The job's folder: `posting.md`, `job.md`, `fit-check.md`, and `apply.md` for special steps. A row in `searches/fit-checks.md` |
| `/factwright:focused-resume` | A resume tailored to one job: maps the job to your facts, asks about what's missing, then builds and fact-checks the PDF or Word file | The job's `resume.json`, `notes.md` and the resume files. New facts in `facts/` |
| `/factwright:add-facts` | Adds or corrects facts about your experience. "Interview me" fills gaps, or starts a fact bank | `facts/` |
| `/factwright:answer-questions` | Answers an application form's questions in your voice, backed by your facts | The job's `answers.md` |
| `/factwright:interview-prep` | Gets you ready for a call or interview, or talks a job through, with a mock interview on request | The job's `prep.md` |
| `/factwright:salary-check` | Estimates the pay for a job that doesn't list it, with sources and a confidence level | A row in `searches/salary-checks.md` |
| `/factwright:unmask-job` | Finds the real employer behind a recruiter or job-board listing, and whether to apply direct | The job's folder, with `unmask.md`. A row in `searches/unmask-checks.md` |
| `/factwright:who-to-message` | Finds 3–5 people worth messaging at a company, with drafts you send yourself | `outreach/<date>-<company>.md` |

The skills work on plain files in your workspace, in the formats the app reads, so their work shows up in the app on its own. Every claim they make about you traces to your fact bank in `facts/`.

The app passes the rest with each run:
- **Tools:** the ones Claude uses instead of a shell. The app serves them over MCP on this computer ([`apps/desktop/src/main/tools`](../apps/desktop/src/main/tools)), and the skills call them by name:
  - `find_job` and `job_details`: what's on file for a job, including your notes and calls
  - `read_page`: a web page as plain text
  - `save_posting`: a posting saved word for word in the job's folder
  - `build_resume`: a job's resume built as a PDF or Word file, with how it fits the pages
- **Hooks:** they tell the app when Claude finishes or needs you.
- **Settings:** they keep the run locked down. Web searches, these skills, and the tools that stay on this computer run without asking. Claude Code asks you before each page it reads and each file it writes.

All of it applies to that run only. Your own Claude Code settings are never changed.

**Status:** in progress, in phase 3 of the [roadmap](../docs/roadmap.md). Eight skills are here. Still to come: job searches, which need tools that read whole job boards.
