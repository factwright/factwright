---
name: fit-check
description: Quick verdict on one job (strong, good, worth a look, long shot, or skip), scored against the user's fact bank, plus what people say about the company. Use when the user shares a listing or link and asks "is this a fit?", "worth applying?", "check this job", or wants company sentiment before applying.
argument-hint: "[posting link or text]"
---

# Fit check

Fast and short. The user should get the verdict at a glance. Don't ask questions unless the listing is missing.

Input: the listing (a link or pasted text), plus anything the user adds (company site, recruiter, notes). The app's Run buttons name a job instead, as `job <id>`: call `job_details` with that id, and work from its folder's posting or its link. If there's no listing, ask for it in one line and stop.

Before starting, read:
- `searches/criteria.md`: the user's filters, preferences, scoring and tiers. Job searches use the same bar. If it's missing, use the rubric below with no filters, and say so in one line.
- all of `facts/`. It's cheap. In `facts/gaps.md`, **Doesn't have** is settled. If there's no fact bank yet, say so, suggest `/factwright:add-facts` ("interview me" starts one), and stop.

## 1. Read the job
- Call `find_job` with what you have. The link alone is fine; call it again once you know the company and role. If the user has seen this job before, open the reply with that line (e.g. "Seen: Good 67 on Oct 6, applied Oct 8"), and reuse its folder.
- If the job's folder already has `posting.md` (or `job.md` in older folders), read the posting from there.
- Otherwise read the link: `read_posting` for a posting on Greenhouse, Lever, Ashby or Gem, which never asks the user, and `read_page` for anywhere else. If it needs a sign-in or won't load, ask the user to paste the text.
- Pull out: company, role, level, remote policy and location limits, pay, must-haves, nice-to-haves, stack, domain.
- If the employer is hidden (a recruiter or board listing), score it anyway, skip sentiment, and suggest `/factwright:unmask-job`.

## 2. Score
- Check the criteria.md **Filters** first. A failed filter makes the verdict **Skip**, stated first with the reason (e.g. "Skip: hybrid in Austin"). Still give the score, since the user may want it anyway.
- Score 0–100 against facts/ only, with the criteria.md rubric. Without one, use: work 40 (how much of the job's core work the facts prove, domain included) · role 25 (how well the level and shape fit what the user wants) · stack 20 (overlap with proven tech) · reqs 15 (full marks unless a hard requirement isn't met: years, degree, certification).
- Respect status and ownership tags: built ≠ live, led-team ≠ solo.
- Tiers: **Strong** ≥ 75 · **Good** 62–74 · **Worth a look** 50–61 · **Long shot** < 50.
- Pay never changes the score.

## 3. Sentiment (5 searches at most)
- Reviews: Glassdoor, Indeed, Blind, Comparably. Search snippets are enough, so never sign in. Note the rating, the review count, and how recent the reviews are.
- Talk: Reddit and Hacker News.
- News from the last ~12 months: layoffs, funding or runway, acquisitions, lawsuits, leadership churn, return-to-office.
- Small startups often have no reviews. Say "thin data", then lean on funding, the founders' track record, and HN/Reddit.
- Report themes, not single angry reviews. Every point gets a source link.
- Sum it up as one mood: **Loved**, **Liked**, **Mixed**, **Disliked**, **Hated**, or **Thin data**. Ratings are a guide (4.3+ loved, 3.9–4.2 liked, 3.3–3.8 mixed, 2.7–3.2 disliked, lower hated); themes and recent news can move it a notch.

## 4. Reply (10 lines or fewer)
```
**Good fit, 68/100**: work 30/40 · role 18/25 · stack 12/20 · reqs 8/15
- Why: <2–3 strongest matches, each tied to a fact>
- Gaps: <1–2 real gaps, or "none that matter">
- Sentiment: <mood>: <rating (n reviews, how recent); 1–2 themes; notable news>
- Flags: <scam signs, equity-only, location fine print, no pay listed, hidden employer>
- Next: <one move: "/factwright:focused-resume", "/factwright:salary-check" (no pay listed), "/factwright:unmask-job" first, "/factwright:who-to-message", or skip>
```
Never stretch a fact to make the fit look better. Gaps are gaps.

## 5. Save it
Every job checked gets a folder, so its posting and this write-up survive dead links. The app shows them in the job's panel.
- Folder: `applications/<YYYY-MM-DD>-<company>-<role>/`, lowercase with hyphens. If `find_job` found a folder for this job, reuse it.
- `posting.md`, the posting word for word:
  - From a link: call `save_posting` with the link and the folder's name. It saves what you read, word for word, without asking.
  - Pasted text, or save_posting couldn't read it: save the user's text as `posting.md` with a `- **Source:** pasted by the user <YYYY-MM-DD>` line on top.
- `job.md`: `# <Company>: <Role>`, then `- **Date:**`, `- **Company:**`, `- **Role:**`, `- **Links:**`, `- **Pay:**`, `- **Work arrangement:**`, `- **Fit check:** <Verdict>, <score>/100 (fit-check.md)`, then `## Job description` with one line: "Saved word for word in posting.md."
- `fit-check.md`: the full write-up, in the shape below. The app reads the parts, the work list and the mood out of it.
- `apply.md`, only when the posting has special application steps (apply by email, an exact subject line or phrase, specific attachments, "mention X", warnings like "no AI-written answers"). Skip it for a plain apply button. The app shows it as a How to apply alert. Format: `# How to apply: <Company>, <Role>`, then `- **Alert:** <one line>`, `- **Email:**` and `- **Subject:**` when they apply, then numbered steps with exact words in backticks.

```
# Fit check: <Company>, <Role>

- **Date:** <YYYY-MM-DD>
- **Verdict:** <Verdict>, <score>/100 (work N/40 · role N/25 · stack N/20 · reqs N/15)
- **Filters:** <pass, or fail: why>

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
## Company sentiment (<YYYY-MM-DD>)
- **Overall:** <mood>. <one line: what people love and what they complain about>
- **Reviews:** <ratings, review counts, how recent; themes; links>
- **Talk:** <HN and Reddit; links>
- **News:** <last ~12 months; links>
## Flags
## Next step
```
List the job's 3–6 core work items under Work, so the user can see where those points came from.

## 6. Log it
Append one row to `searches/fit-checks.md` (create it with this header if it's missing): `| Date | Company | Role | Verdict | Score | Link | Pay | Note |`.
- **Pay:** the listed pay as written, or blank.
- **Note:** the deciding reason in 60 characters or fewer (e.g. "Skip: hybrid in Austin", "Java/Spring + AWS are hard reqs").

The app picks up the folder and the row on its own. There's nothing to commit or sync.
