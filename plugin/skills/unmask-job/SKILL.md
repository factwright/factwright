---
name: unmask-job
description: Find the real employer behind a recruiter, staffing-agency, or job-board listing that hides the company (Ladders, ZipRecruiter, "confidential client" posts), get the direct apply link, and recommend applying direct or through the recruiter. Use when the user shares a listing from a recruiter, agency, or site and asks who the company is or whether to apply direct.
argument-hint: "[listing link or text, plus the recruiter or site]"
---

# Unmask job

Input: the listing (a link or pasted text), plus whatever the user has: the recruiter's name or agency (a name only helps the search, and never goes in a file), the site, and **whether they've already talked to the recruiter or sent them a resume**. If that last part isn't clear and it changes the verdict, ask in one line.

Research only. Never contact anyone, never apply, never sign in anywhere.

## 1. Fingerprint the post
If `find_job` finds the job and `job_details` names a posting saved from the user's browser, read it from there. If it's a link, read it with `read_posting` on Greenhouse, Lever, Ashby or Gem, or `read_page` anywhere else (or ask for the text if it needs a sign-in). Pull out whatever identifies the employer:
- 3–6 distinctive sentences or phrases. Odd wording survives reposting; boilerplate doesn't.
- the exact title, stack combination, pay band, location and remote rules, benefits, team size
- company descriptors: industry, stage, funding, size, founding year, HQ region, product, customers
- the posting date and any req or job ID

## 2. Classify the poster
- **Job board or aggregator** (Ladders, ZipRecruiter, Talent.com, Jooble, Lensa, Jobright): reposts the employer's own job.
- **Contingency agency** (paid only on placement): the same job often shows up at several agencies. Examples: Jobot, CyberCoders, Motion Recruitment, Robert Half.
- **Retained or exclusive search** (paid up front, usually the only firm on the role, common for Director+): Heidrick & Struggles, Korn Ferry, Spencer Stuart, Russell Reynolds, boutique executive-search firms, or "exclusive search" in the post.
- **Staffing or contract** (W2, C2C, contract-to-hire, with the agency as the employer of record): Insight Global, TEKsystems, Kforce, Randstad.
- **In-house recruiter** (works at the company): that's already applying direct.

## 3. Hunt
Search first, and stop once one candidate has strong evidence. `read_page` confirms a match. Read only the most promising.
- Exact-phrase searches, in quotes, of the distinctive sentences.
- The same phrases restricted to applicant-system sites: `job-boards.greenhouse.io`, `boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`, `myworkdayjobs.com`, `apply.workable.com`, `jobs.smartrecruiters.com`, `bamboohr.com`, `jobs.gem.com`, `ats.rippling.com`, `wellfound.com`, `ycombinator.com/companies`.
- Board listings: read the apply link. It often redirects straight to the employer's applicant system.
- Agency listings: check the agency's other posts. The same client often appears there with more detail.
- From descriptors to candidates: search for companies that match stage + domain + size + location, then check each one's careers page for the role.
- LinkedIn job posts: public search results only.

## 4. Judge the evidence
- **Confirmed:** the employer's own posting matches the distinctive text, or the apply link lands on their applicant system.
- **Likely:** several descriptors fit one company and it has a matching open role, but there's no text match.
- **Guess:** descriptors only. Say so, and don't build a plan on it.

## 5. Scam check
Flag any of these: the recruiter writes from a free email domain or a lookalike company domain; pay far above market; requests for an SSN, bank details, or ID before an offer; interviews only by chat app (Telegram, WhatsApp, Signal); being asked to buy equipment or cash checks; no real company behind the listing.

## 6. Direct or recruiter?
Recommend one, with a one-line reason:
- **The user already sent the recruiter a resume or OK'd a submission:** stay with the recruiter. Applying direct risks a duplicate submission, which can get them dropped. Recruiter ownership of a candidate usually lasts 6–12 months.
- **Retained or exclusive search:** go through the recruiter. The company routes candidates back to them anyway.
- **Contract or contract-to-hire through a staffing firm:** go through the recruiter. They're the employer.
- **Job board or aggregator:** apply direct. The board adds nothing.
- **Contingency agency, nothing sent yet:** apply direct. Without a ~20–25% fee, they're cheaper to hire. Exception: if the recruiter clearly knows the hiring manager and can get them a call fast, say that's worth weighing.
- **Employer not confirmed:** ask the recruiter who the client is before agreeing to anything. Never let anyone submit the user without naming the company.

## 7. Deliver
- Reply in 8 lines or fewer: the employer and confidence, the evidence (1–2 links), the direct apply link, the verdict and reason, any scam flags, and next steps (`/factwright:fit-check`, `/factwright:salary-check` if no pay is listed, `/factwright:focused-resume`).
- Once the employer is confirmed or likely, save the job so it survives the listing coming down:
  - Folder `applications/<YYYY-MM-DD>-<employer>-<role>/`. Reuse it if `find_job` with the employer and role finds one.
  - `posting.md`: `save_posting` with the employer's own posting link. If there's no direct posting, save the board listing instead, or save the user's pasted text with a `- **Source:** pasted by the user <YYYY-MM-DD>` line on top.
  - `job.md`: `# <Employer>: <Role>`, then `- **Date:**`, `- **Company:**`, `- **Role:**`, `- **Links:**`, `- **Pay:**`, `- **Work arrangement:**`, and `- **Found via:** <board or agency name>`.
  - `unmask.md`: employer and confidence, the evidence with links, the poster type, direct or recruiter and why, scam flags.
  - `apply.md`, only when the employer's posting has special application steps (apply by email, an exact subject line or phrase, specific attachments, "mention X", warnings like "no AI-written answers"). Skip it for a plain apply button. The app shows it as a How to apply alert. Format: `# How to apply: <Company>, <Role>`, then `- **Alert:** <one line>`, `- **Email:**` and `- **Subject:**` when they apply, then numbered steps with exact words in backticks.
  - Name the agency or board only, never the recruiter's personal name or contact details.
- Log it: call `log_check` with log `unmask-checks` and the row: `listing`, `employer`, `role`, `apply` and `link`. **Listing** is the board or agency name only. **Apply** is `direct` or `recruiter`. **Link** is the employer's own posting. The app writes it into `searches/unmask-checks.md`, one row at a time, as other runs may be logging theirs at once, so never edit that file yourself. Skip the row and the folder if the employer is still unknown.

The app picks up the folder and the row on its own. There's nothing to commit or sync.
