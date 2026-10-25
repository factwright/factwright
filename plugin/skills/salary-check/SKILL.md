---
name: salary-check
description: Estimate the pay range for a job listing that doesn't post one, with sources and a confidence level. Use when the user asks what a job probably pays, "is there a salary range for this?", or when a listing they're weighing has no pay.
argument-hint: "[posting link or text]"
---

# Salary check

Input: the listing (a link or pasted text), plus the company if the listing hides it. The app's buttons name a job instead, as `job <id>`: call `job_details` with that id, and work from its folder's posting or its link. Run `/factwright:unmask-job` first if the employer is unknown. The user's location and remote setup are in `searches/criteria.md` or `facts/profile.md`.

Research only, and never sign in anywhere. Pay never changes a fit score. This is information for the user.

Use web searches first: snippets often show posted ranges. `read_posting` reads a posting on Greenhouse, Lever, Ashby or Gem without asking. `read_page` reads anything else, so save it for the strongest leads.

## 1. Look for a posted range for this exact job (best evidence)
- **Other copies of the posting:** pay-transparency laws (CA, CO, NY, WA, IL and others) push many employers to post a range in at least one location. Search the exact title + company across other boards and location variants.
- **The applicant system's public data** sometimes has pay the page doesn't show:
  - Ashby: the posting's own link. `read_posting` asks Ashby for the job, with any pay the board publishes.
  - Lever and Ashby: `job_board` lists every open job on the company's board with its pay, without asking. Save it in a `searches/salary-<company>` folder. It also maps the company's bands for step 2.
  - Greenhouse: `read_page` on `https://boards-api.greenhouse.io/v1/boards/<org>/jobs/<id>?pay_transparency=true`.
- **Recruiter reposts** of the same role often state a range.

## 2. Triangulate from the same company
- Their other postings that list ranges: map the levels (Senior → Staff → Principal) to bands. The `job_board` listing from step 1 has them for Lever and Ashby boards.
- H-1B/LCA filings (h1bdata.info, the DOL disclosure data): real base salaries the company filed for similar titles. Note the year.
- Levels.fyi for the company and level.

## 3. Market baseline (weakest evidence)
- The same title, level, and stage at peer companies: Levels.fyi, Built In, Glassdoor (search snippets), plus Wellfound and YC Work at a Startup, which show ranges for startups.
- Adjust for stage (early startups trade cash for equity), remote pay policy (some companies pay by location tier), and the level signals in the post (years, scope, reports).

## 4. Reply (8 lines or fewer)
```
**Likely $175k–$210k base** (confidence: medium)
- Best evidence: <the strongest source, with link>
- Also: <1–2 supporting points>
- Extras: <bonus and equity norms for this company or stage, if known>
- Ask: <one line the user can send to get the real range>
```
- **High:** a posted range for this job. **Medium:** the company's own bands or filings. **Low:** market data only.
- Show base and total comp separately when you can. Never present an estimate as a posted number.
- If a pay-transparency law where the user lives, or where the job is, seems to apply, mention it as leverage for asking, not as legal advice. Several US states, such as California, Colorado, Illinois, New York and Washington, require pay ranges in many postings.
- If `about_you` has the user's target or lowest pay, say in one line how the estimate compares. With more than one kind of job, compare with the pay of the job's kind, which `job_details` gives.
- If the job has a folder (`find_job` says so), append the result to its `notes.md` under `## Pay`.

## 5. Log it
Append one row to `searches/salary-checks.md` (create it with this header if it's missing): `| Date | Company | Role | Estimate | Confidence | Link |`.

The app picks up the row on its own. There's nothing to commit or sync.
