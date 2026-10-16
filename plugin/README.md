# Claude Code plugin

What Factwright loads into each Claude Code run, through Claude Code's own `--plugin-dir` flag: its skills, step-by-step instructions Claude follows for one job-hunt task, and its standing rules.

**Standing rules:** [`standing-rules.md`](standing-rules.md) is added to Claude's instructions in every run (`--append-system-prompt-file`), whichever skill is working, and for plain questions too. Facts come first; before writing for a job, Claude asks you about what the job wants that your facts don't show, and saves your answers, unverified, through the app's tools; an unverified fact is offered to you before it's used; everything on file for a job is read before anything's fetched, work on a job goes by its kind of job when you want more than one, what you've already told Factwright is checked before you're asked again, feedback becomes a nudge, confidential details stay out of what you send (Claude keeps your confidential-terms list as you mention names), what went out stays as it went, and the How to apply format.

**Starter files:** [`starter/`](starter) holds what a new workspace starts with: the binding rules, a writing guide, resume styles for startups, established companies and public employers, empty preferences and confidential terms, and the fact bank's format. The app copies in the ones a workspace lacks when you start getting to know your Claude, and never replaces one that's there.

| Skill | What it does | What it saves |
|---|---|---|
| `/factwright:fit-check` | A quick verdict on one job, scored against your fact bank, plus what people say about the company, and what's worth asking you before a resume | The job's folder: `posting.md`, `job.md`, `fit-check.md`, and `apply.md` for special steps. A row in `searches/fit-checks.md` |
| `/factwright:focused-resume` | A resume tailored to one job: maps the job to your facts, asks about what's missing and about unverified facts it would use, then builds and fact-checks the PDF or Word file | The job's `resume.json`, `notes.md` and the resume files. Your answers in `facts/`, unverified until you verify them |
| `/factwright:revise-resume` | Revises a job's resume for what you picked in its ATS X-ray: fixes what's in the words, asks you about the terms your fact bank doesn't back yet, fixes your template or uses one that reads cleanly when you chose to, then rebuilds and fact-checks it. The app starts it from the X-ray's Send for revision, keeps the previous version, and keeps the run off the web | The job's `resume.json`, `notes.md` and the resume files. Your answers in `facts/`, unverified until you verify them. Your template, only when you chose to fix it and say yes when Claude asks |
| `/factwright:cover-letter` | A cover letter for one job, in your voice, from your facts and everything on file for the job, addressed to the hiring manager when one is on file. It asks about what's missing and about unverified facts it would use, fact-checks every line, and builds it in your resume's template, so the two look like a set | The job's `cover-letter.json`, its PDF or Word file, and `notes.md`. Your answers in `facts/`, unverified until you verify them |
| `/factwright:get-started` | Gets to know you from what you shared in the app: drafts your fact bank with every fact marked unconfirmed, interviews you to confirm it and fill the gaps, then builds and fact-checks a starting resume in each template you picked, a set for each kind of job you want | `facts/`, `guide/rules.md`, and `base/` with its resume files, with a folder in it for each kind of job after the first |
| `/factwright:add-facts` | Adds or corrects facts about your experience. "Interview me" confirms drafted facts and fills gaps, or starts a fact bank, and it reads files and notes you've shared since | `facts/` |
| `/factwright:answer-questions` | Answers an application form's questions, typed or in screenshots, in your voice, backed by your facts, what you told Factwright and what you sent on other applications | The job's `answers.md`. What forms ask again, such as your work authorization, in your profile |
| `/factwright:ask` | Answers your own question about one job, such as what to expect from a call, from everything on file for it and the web | `asked/<job>/<question>.md`, which the app shows under the question |
| `/factwright:interview-prep` | Gets you ready for a call or interview, or talks a job through, with a mock interview on request | The job's `prep.md` |
| `/factwright:make-template` | Makes a resume template of your own in the look of a resume you like, from a PDF or a picture of it: its layout, fonts and colors, never its words. It compares a printed preview with the original until they match | `templates/<id>.json`, which the app adds to your templates |
| `/factwright:job-search` | Searches the places you pick in Find jobs (HN's "Who is hiring?" thread, LinkedIn's and Indeed's listings found through web search and read on each employer's own site, companies' job boards, or a company you name) and ranks what passes your criteria by how well your facts fit, for one kind of job or every kind | A folder per place, such as `searches/2026-11-hn-whos-hiring/` or `searches/2026-11-03-linkedin/`: the source word for word, `jobs.json` (which the app lists under New, as a search of its own) and `report.md` |
| `/factwright:salary-check` | Estimates the pay for a job that doesn't list it, with sources and a confidence level | A row in `searches/salary-checks.md` |
| `/factwright:unmask-job` | Finds the real employer behind a recruiter or job-board listing, and whether to apply direct | The job's folder, with `unmask.md`. A row in `searches/unmask-checks.md` |
| `/factwright:who-to-message` | Finds 3–5 people worth messaging at a company, with drafts you send yourself | `outreach/<date>-<company>.md` |

The skills work on plain files in your workspace, in the formats the app reads, so their work shows up in the app on its own. Every claim they make about you traces to your fact bank in `facts/`.

The app passes the rest with each run:
- **Tools:** the ones Claude uses instead of a shell. The app serves them over MCP on this computer ([`apps/desktop/src/main/tools`](../apps/desktop/src/main/tools)), and the skills call them by name:
  - `find_job` and `job_details`: what's on file for a job, with a line on what each file holds, your notes and calls, the application's questions with what you actually sent, and your questions about it
  - `revision_findings`: what you picked in a resume's ATS X-ray for a revision to fix, as information about the resume. Only a run started with Send for revision has them
  - `about_you`: what you told Factwright about yourself, such as your work authorization, when you can start, and each kind of job you want
  - `past_answers`: what you sent on your applications, in your own words, to reuse and to sound like you
  - `save_answer`: Claude's answer to your question about a job, kept with the job
  - `list_templates`, `read_template` and `save_template`: your resume templates, built in and your own, to pick from, to start a new one from, and to save one Claude made, checked first
  - `save_about_you`: something you told Claude that applications ask for, saved to your profile, which Claude Code asks you about first
  - `save_fact`, `save_gap` and `verify_fact`: what you answer Claude's questions while it works, saved to your fact bank: a yes as a fact to verify, with the question and your answer as the app recorded them; a no under Doesn't have; and a fact verified when you pick "Use and verify". They save only answers you gave in that run, and never change a verified fact
  - `read_posting`: a posting on Greenhouse, Lever, Ashby or Gem, read from the applicant system's public feed
  - `read_page`: any other web page as plain text
  - `save_posting`: a posting saved word for word in the job's folder, from what was read
  - `build_resume`: a job's resume, or a starting resume, built as a PDF or Word file, with how it fits the pages
  - `build_cover_letter`: a job's cover letter, built as a PDF or Word file in its resume's template, with how it fits one page
  - `job_board`: every open job on a company's Greenhouse, Lever, Ashby or Gem board, saved word for word, and whether a posting is still open
  - `hn_jobs`: every post in Hacker News's "Who is hiring?" thread, saved word for word
- **Hooks:** they tell the app when Claude finishes or needs you, and what you answered its questions, which is what lets the tools above save an answer.
- **Settings:** they keep the run locked down. Without asking, Claude searches the web, runs these skills, uses the tools that stay on this computer or reach only the job systems' public feeds, saves your answers to your fact bank through the tools above, and saves its work in `applications/`, `searches/` and `outreach/`. A run started for getting started or for more facts saves your facts, starting resumes and guide without asking too, and can't reach the web. Claude Code asks you before Claude reads any other page or changes any other file, unless you choose otherwise in the app (Your Claude → Settings). It never changes Claude Code's settings or the instructions Claude Code loads.

All of it applies to that run only. Your own Claude Code settings are never changed.

**Status:** in progress, in phase 5 of the [roadmap](../docs/roadmap.md). All nine skills from the original repo are here, made to work for anyone, plus getting started and your own questions about a job.
