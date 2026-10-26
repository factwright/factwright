---
name: analyze-job
description: Analyze a job, or several at once: fill in its posting if it's missing, put its title, company, pay and place right from the posting, merge it with a job found twice, check the fit (strong, good, worth a look, long shot, or skip) against the user's fact bank with what people say about the company, and suggest the pay to ask for. Use when the user shares a listing or link and asks "is this a fit?", "worth applying?", "check this job", "analyze this job", or wants company sentiment before applying.
argument-hint: "[posting link or text, job <id>, or jobs <id> <id> …]"
---

# Analyze job

Fast and short. The user should get the verdict at a glance. Don't ask questions unless the listing is missing: note what's worth asking instead, for the resume run to ask.

Input, one of:
- the listing, a link or pasted text, plus anything the user adds (company site, recruiter, notes);
- `job <id>`, from the app's Analyze job button: a job on file. Call `job_details` with that id;
- `jobs <id> <id> …`, from the app: several jobs, each on file, in one run. Read **Several jobs** at the end first. With `on its own` at the end, the app started it while Claude was free, for jobs the user saved since.

If there's no listing, ask for it in one line and stop. Several jobs never ask: see **Several jobs**.

Before starting, read:
- `searches/criteria.md`: the user's filters, preferences, scoring and tiers. Job searches use the same bar. If it's missing but `about_you` has what they want, judge the filters from that. If neither is there, use the rubric below with no filters, and say so in one line.
  - **More than one kind of job:** `about_you` lists them, such as Developer and Project manager, and criteria.md's **Kinds of job** section has a section for each. A section for a kind `about_you` doesn't list is left over from before: skip it.
  - Judge the job as its kind: the one `job_details` gives for a job on file, as the user or an earlier check set it. When it says the kind isn't set yet, or the job isn't on file, judge it as the kind the posting fits best, and say which in one line. Its kind's Level, Kind of work and Pay lines count as filters too, and its role is scored against them.
  - If the file has no section for the job's kind, as when the user edited it by hand before adding that kind: its filters and scoring are the first kind's. For another kind, use its own roles, levels and pay from `about_you` in place of the file's, and the rest of the file as written.
- `about_you`: what the user wants, with the pay they're hoping for and the lowest they'd take, for the pay to ask for (step 5).
- all of `facts/`. It's cheap. In `facts/gaps.md`, **Doesn't have** is settled. If there's no fact bank yet, say so, suggest `/factwright:add-facts` ("interview me" starts one), and stop.

One run does five things, in this order: the posting, the details, duplicates, the fit check, and the pay to ask for. Then it logs the job.

## 1. The posting
Get the posting word for word, if the job has none yet. `job_details` lists what's on file.
- **Already in the folder:** `posting.md` (or `job.md` in older folders). Read it from there, plus `unmask.md` and `notes.md` if they're there: an employer check may already have found the real employer behind a board listing. `job_details` lists everything else on file, such as the user's notes and calls, which can change the verdict.
- **Saved from the user's browser:** when `job_details` names a posting saved from their browser, that's it, as they saw it, LinkedIn's included, which Factwright's tools never read. `save_posting` with the job's link and its id copies it into the folder.
- **On the board's own API:** a posting on Greenhouse, Lever, Ashby or Gem comes from `read_posting`. A link to a company's whole board, as a Hacker News search saves it, isn't one job's: `job_board` with that link, and `boards` as its folder, lists every open job there, with its own link. Find this role among them, and use its own link from then on.
- **Anywhere else:** `read_page`. Never LinkedIn's pages: a job whose only link is LinkedIn's, with nothing saved from the browser, has no posting to read.
- Save what you read with `save_posting`, the job's link and its id. If it needs a sign-in, won't load, or there's nothing to read, ask the user to paste the text, or to save the page with Factwright's browser extension.
- If the employer is hidden (a recruiter or board listing), score it anyway, skip sentiment, and suggest `/factwright:unmask-job`.

## 2. The details
From the posting only, never guessed:
- **Company:** the employer's own name, as the posting gives it: never a job board's, a recruiter's, an applicant system's or a career site's, such as "Acme" rather than "Acme careers blog", "Workable" or "icims".
- **Role:** the title, as the posting gives it.
- **Pay:** as listed, word for word, such as "$161,000–$245,000 a year" or "$85–$95 an hour". None when the posting gives none: never an estimate here.
- **Place:** how and where it's worked, such as "Remote (US)", "Hybrid, Austin, TX" or "Onsite, Berlin".

They go in `job.md` (step 4): its heading, `- **Pay:**` and `- **Work arrangement:**`. The app shows the job by them, in place of what was saved with it.

**The user's own details stay theirs.** `job_details` lists "The user's own details": the company, role, pay or place the user set in the app. The app keeps them apart from job.md and shows them in its place, so job.md still has what the posting says, as above: when the user empties a box, the posting's shows again. Never change theirs. When the posting says something else that matters, such as hybrid for a job they set as remote, say so in one line of the reply.

## 3. Duplicates
Once the details are right, call `find_job` with the company, the role and the posting's link. Each job it lists as **the same posting** or **the same role**, other than this one, may be this job found twice:
- Call `merge_job` with this job's id as `job`, the other's as `other`, and why you think they're one, in a line. It merges into a job the app started this run on: in any other run, say in a line which job it might be. The app merges them when it's sure: the same posting, or the same role at the same company where one of the two has no posting of its own, as a Hacker News search saves a company's board. Anything less sure gets a note on the job, "Might be the same as …", for the user to merge with a click or not. Never merge them any other way.
- After a merge, go on with the job the tool names. A fit check the job kept already has from the last 30 days stands: reuse its folder and write-up, update job.md with the details and the pay to ask for, and log it.
- The tool says when the user said two jobs aren't the same: leave them apart.

## 4. The fit check
### Score
- Check the criteria.md **Filters** first, and the job's kind's lines when there's more than one kind. A failed filter makes the verdict **Skip**, stated first with the reason (e.g. "Skip: hybrid in Austin"). Still give the score, since the user may want it anyway.
- Score 0–100 against facts/ only, with the criteria.md rubric. Without one, use: work 40 (how much of the job's core work the facts prove, domain included) · role 25 (how well the level and shape fit what the user wants) · stack 20 (overlap with proven tech) · reqs 15 (full marks unless a hard requirement isn't met: years, degree, certification).
- Respect status and ownership tags: built ≠ live, led-team ≠ solo. A claim tagged `unconfirmed` counts for half until the user verifies it; say so in the gaps.
- Tiers: **Strong** ≥ 75 · **Good** 62–74 · **Worth a look** 50–61 · **Long shot** < 50.
- **Worth asking you:** up to 4 of the posting's must-haves and nice-to-haves that the facts don't show, but that the user plausibly has, judged from what's near them in the facts, must-haves first. Each is a question, in your own words, that a tailored resume asks them before it's written. Leave out anything `facts/gaps.md` settles under Doesn't have. Score them as gaps: Analyze job never asks.
- Pay never changes the score.

### Sentiment (5 searches at most)
- Reviews: Glassdoor, Indeed, Blind, Comparably. Search snippets are enough, so never sign in. Note the rating, the review count, and how recent the reviews are.
- Talk: Reddit and Hacker News. A web search with `site:news.ycombinator.com` finds HN threads.
- News from the last ~12 months: layoffs, funding or runway, acquisitions, lawsuits, leadership churn, return-to-office.
- Small startups often have no reviews. Say "thin data", then lean on funding, the founders' track record, and HN/Reddit.
- Report themes, not single angry reviews. Every point gets a source link.
- Sum it up as one mood: **Loved**, **Liked**, **Mixed**, **Disliked**, **Hated**, or **Thin data**. Ratings are a guide (4.3+ loved, 3.9–4.2 liked, 3.3–3.8 mixed, 2.7–3.2 disliked, lower hated); themes and recent news can move it a notch.

### Save it
Every job analyzed gets a folder, so its posting and this write-up survive dead links. The app shows them in the job's panel.
- Folder: `applications/<YYYY-MM-DD>-<company>-<role>/`, lowercase with hyphens. If `find_job` or `job_details` found a folder for this job, reuse it. If they found none and one by that name is there already, it's another job's, as a job with the same company and title can have: add `-2` to the name, or the next number that's free. `save_posting` says so too, when the folder is another job's.
- `posting.md`, the posting word for word:
  - From a link: call `save_posting` with the link, the folder's name and the job's id. It saves what you read, or the posting the user saved from their browser, word for word, without asking.
  - Pasted text, or save_posting couldn't read it: save the user's text as `posting.md` with a `- **Source:** pasted by the user <YYYY-MM-DD>` line on top.
- `job.md`: `# <Company>: <Role>`, then `- **Job ID:** <the job's id>`, which keeps the folder with this job whatever other job has the same company and title, `- **Date:**`, `- **Company:**`, `- **Role:**`, `- **Links:**`, `- **Pay:**` (as listed, or leave the line out), `- **Work arrangement:**`, `- **Fit check:** <Verdict>, <score>/100 (fit-check.md)`, `- **Pay to ask for:**` (step 5), and with more than one kind of job, `- **Kind of job:** <its id>`, which the app files the job under. Then `## Job description` with one line: "Saved word for word in posting.md." Leave out the Job ID line only for a job that isn't on file.
- `fit-check.md`: the full write-up, in the shape below. The app reads the parts, the work list and the mood out of it.
- `apply.md`, only when the posting has special application steps (apply by email, an exact subject line or phrase, specific attachments, "mention X", warnings like "no AI-written answers"). Skip it for a plain apply button. The app shows it as a How to apply alert. Format: `# How to apply: <Company>, <Role>`, then `- **Alert:** <one line>`, `- **Email:**` and `- **Subject:**` when they apply, then numbered steps with exact words in backticks.

```
# Fit check: <Company>, <Role>

- **Date:** <YYYY-MM-DD>
- **Verdict:** <Verdict>, <score>/100 (work N/40 · role N/25 · stack N/20 · reqs N/15)
- **Filters:** <pass, or fail: why>
- **Pay to ask for:** <amount>: <why, in a few words>

## Score
- **Work N/40:** <one line: how much of the job's core work facts/ proves>
  - ✓ <core work item>: <the fact that proves it> (<facts/ file>)
  - ~ <core work item>: <only partly: built not live, team-delivered, side project>
  - ✗ <core work item>: nothing on file
- **Role N/25:** <one line>
- **Stack N/20:** <one line>
- **Reqs N/15:** <one line: which hard requirements cost points, or "all met">

## Why it fits
## Gaps
## Worth asking you
- <requirement> (<must-have or nice-to-have>): <what's near it in the facts>. <the question, such as "Have you used GraphQL?">
## Company sentiment (<YYYY-MM-DD>)
- **Overall:** <mood>. <one line: what people love and what they complain about>
- **Reviews:** <ratings, review counts, how recent; themes; links>
- **Talk:** <HN and Reddit; links>
- **News:** <last ~12 months; links>
## Flags
## Next step
```
List the job's 3–6 core work items under Work, so the user can see where those points came from. Leave out **Worth asking you** when there's nothing worth asking, and **Pay to ask for** when step 5 has none.

## 5. The pay to ask for
Work out what the user asks for at this job, from the posted pay and their target and lowest pay in `about_you` (the pay they're hoping for and the lowest they'd take, the job's kind's when there's more than one kind).
- **No pay posted:** none. Leave the line out: filling the application uses their target.
- **A range:** start about three quarters of the way up it, rounded to a round number ($5,000 for yearly pay, $5 for hourly). Then:
  - the target, when it's inside the range and above that;
  - the top of the range, when the target is above the range;
  - never below the lowest they'd take: when the whole range is under it, the top of the range, and Flags says the job pays below their lowest.
- **One figure:** that figure.
- In the posting's own unit and currency, such as "$185,000" for a yearly salary or "$90/hr".
- Write it in job.md as `- **Pay to ask for:** <amount>`, such as `- **Pay to ask for:** $185,000`, and in fit-check.md with why. The app shows it in the job's Fit area, and filling the application uses it. An ask the user set themselves, which `job_details` calls the user's own, wins in the app: write yours anyway.

## 6. Log it
Last of all, call `log_check` with log `fit-checks` and the row: `company`, `role`, `verdict`, `score`, `link`, `pay`, `note` and `job`, the job's id. The app writes it into `searches/fit-checks.md`, one row at a time, as other runs may be logging theirs at once, so never edit that file yourself. The row tells the app the job is done.
- **Pay:** the listed pay as written, or leave it out.
- **Note:** the deciding reason in 60 characters or fewer (e.g. "Skip: hybrid in Austin", "Java/Spring + AWS are hard reqs").
- **Job:** the job's id. Leave it out only for a job that isn't on file.

The app picks up the folder and the row on its own. There's nothing to commit or sync.

## 7. Reply (10 lines or fewer)
With more than one kind of job, name the job's kind in the first line, such as **Good fit as Project manager, 68/100**.
```
**Good fit, 68/100**: work 30/40 · role 18/25 · stack 12/20 · reqs 8/15
- Why: <2–3 strongest matches, each tied to a fact>
- Gaps: <1–2 real gaps, or "none that matter">
- Worth asking: <1–2 things the user may well have, which a tailored resume asks about; leave the line out when there are none>
- Sentiment: <mood>: <rating (n reviews, how recent); 1–2 themes; notable news>
- Pay to ask for: <amount, and why in a few words; leave the line out when there's none>
- Details: <what Analyze job put right, such as "company HealthEquity, not HealthEquity blog", or a duplicate merged or noted; leave the line out when there's nothing>
- Flags: <scam signs, equity-only, location fine print, no pay listed, hidden employer>
- Next: <one move: "/factwright:focused-resume", "/factwright:salary-check" (no pay listed), "/factwright:unmask-job" first, "/factwright:who-to-message", or skip>
```
Never stretch a fact to make the fit look better. Gaps are gaps.

## Several jobs
`jobs <id> <id> …` names several jobs on file, in one run. The app's tab says how many are done as each one's row reaches the log.
- **Ask nothing.** The user went on to other things once they started it, or the app started it while Claude was free (`on its own`). A question you ask is turned away, and so is any call that needs the user's OK: use Factwright's tools, which never ask. When something's missing, such as a posting that won't load, or a job whose only link is LinkedIn's with nothing saved from the browser, say so in that job's line of the reply, and go on with the rest.
- **Read once:** criteria.md, `about_you` and facts/, before the jobs.
- **Duplicates among them first:** call `find_job` for each. When two of the jobs given are one, merge them with `merge_job` before going further, and analyze the one kept once. Two that stay apart with the same company and title each get a folder of their own: give the second one's subagent its folder's name, ending in `-2`, so the two never make the same one at once.
- **A subagent for each job:** give each job to a subagent of its own, up to 4 in one message, each with `run_in_background: false`, so they work side by side and your turn waits for them all; then the next 4. Never send one to the background: the app reads your run as done once your turn ends. Give each one: the job's id; the steps above for one job, 1 to 6; that it asks nothing; and, in a few lines, the user's filters, tiers and kinds of job, their target and lowest pay, and where their facts are, so it reads only what its job needs. Each one ends with its `log_check` row, once its job is analyzed, and replies with its job's line. A job it couldn't analyze gets no row, and stays not checked yet.
- **Reply** with one line per job, best fit first: "Acme Robotics, Staff Engineer: Good 71 · ask $185,000 · merged with the HN find", or what stopped it, such as "Coastline Credit Union: the posting wouldn't load". Then one line on what's next.
