---
name: focused-resume
description: Build a resume focused on one job. Use when the user shares a job posting (plus maybe a company link, notes, "pdf"/"word", "startup"/"big company") and wants a tailored resume. Maps the job to their fact bank, asks them about experience the bank lacks, files their answers into facts/, then builds and fact-checks the PDF or Word file. Also use whenever the user gives feedback on a resume, now or in a later session: it fixes the resume and saves the feedback as a nudge.
argument-hint: "[posting link or text, plus pdf/word and startup/big-company]"
---

# Focused resume

The user's input is whatever came with the command or in their next message:
- **job posting:** a link or text, or a job from the app (`job <id>`). This is the only required input.
- **company link, notes:** anything else they add
- **format:** `pdf` (default) | `word`/`docx` | `both`
- **style:** a style in `guide/styles/README.md`, such as `startup`, `big-company` or `public-sector` (inferred if missing)
- **track:** `leader` | `builder` | `ic`, as `guide/styles/README.md` defines them (inferred if missing)

If there's no posting, ask for it in one line and stop. Don't ask about anything that has a default. State your inferred picks in one line and keep going.

Before starting, read:
- `guide/rules.md`: binding rules for every resume.
- `guide/preferences.md`: the user's soft nudges, learned from their feedback. Defaults, not rules.
- `guide/templates.md`, if there is one: the templates the user picked, and which kind of company each is for, plus their resume length and files.
- `facts/README.md`, if there is one: which file holds what.

If there's no fact bank yet, say so, suggest `/factwright:add-facts` ("interview me" starts one), and stop.

## 1. Set up the application folder
- For a job from the app (`job <id>`), call `job_details` with the id: it gives everything on file, with what each file holds. Otherwise call `find_job` with what you have (the link alone is fine), then `job_details` if it's on file. If the job's folder already has a resume (a PDF or Word file), tell the user in one line and ask whether to build a new one before going on.
- Read what's on file that bears on tailoring, before anything else: the fit check (what fits, and what's missing that the resume should cover honestly or leave alone), `unmask.md`, the user's notes and calls (what a recruiter said the team cares about), what they sent on the application, and your answers to their questions about the job. A requirement the user's notes say matters most leads the resume.
- If a fit check (or unmask) already made a folder for this job, reuse it: keep its `posting.md`, `job.md` and `fit-check.md`, and add to them. Otherwise use `applications/<YYYY-MM-DD>-<company>-<role>/`, lowercase with hyphens.
- Save the posting word for word as `posting.md`, if the folder doesn't have one yet:
  - From a link: read it with `read_posting` (on Greenhouse, Lever, Ashby or Gem) or `read_page` (anywhere else), then `save_posting` with the link and the folder's name.
  - Pasted text, or the link needs a sign-in: save the user's text as `posting.md` with a `- **Source:** pasted by the user <YYYY-MM-DD>` line on top.
- If the posting has special application steps (apply by email, an exact subject line or phrase, specific attachments, "mention X", warnings like "no AI-written answers"), write `apply.md`, which the app shows as a How to apply alert. Skip it for a plain apply button. Its format: `# How to apply: <Company>, <Role>`, then `- **Alert:** <one line>`, `- **Email:**` and `- **Subject:**` when they apply, then numbered steps with exact words in backticks.
- Write (or update) `job.md`: `# <Company>: <Role>`, then `- **Date:**`, `- **Company:**`, `- **Role:**`, `- **Links:**`, `- **Format:** <pdf, word or both>` and `- **Style / track:** <style> / <track>`, then:
  - `## Job description`: "Saved word for word in posting.md."
  - `## The user's notes`, verbatim

## 2. Research the company (brief)
- Read the company's site with `read_page`: the link the user gave, plus its about or careers page if it's useful (the user may have to OK each page). Run 1–2 web searches at most, for stage and funding, size, product, customers, and tech stack.
- Append `## Company notes` to job.md: what they do, stage and size, domain, stack, and the words they use about themselves.
- Pick the **style** with `guide/styles/README.md`, then read that style's file.
- Pick the **track** from the role title and scope.

## 3. Extract requirements
Append `## Requirements` to job.md:
- Must-haves and nice-to-haves, in the posting's own phrasing (applicant systems match exact terms).
- Keywords: tech, domain, practices.
- Scope and seniority signals.
- **Likely worries** a reader will have, such as being overqualified for the level, a missing must-have, or on-site required.

## 4. Map evidence
- Read **all** of `facts/`. It's the source of truth and it's cheap to read.
- Write `notes.md` in the folder with an evidence table: `| Requirement | Best evidence (facts file#claim) | strong/partial/none |`.
- Use `facts/skills.md` for tech.
- Respect status and ownership tags.
- Check `facts/gaps.md` before treating anything as unknown. "Doesn't have" means it's settled: don't ask again.
- A claim tagged `unconfirmed` counts as `none` until the user confirms it: if the job needs it, ask about it in step 5.

## 5. Ask the user about gaps (this is how the fact bank grows)
Ask about the requirements that are `partial` or `none`, that matter for this job, and that aren't already settled in gaps.md.
- Use **one round** of AskUserQuestion, up to 4 questions. Add a second round only if something critical is still open.
- Be concrete and give easy answers. For example:
  - Question: "Have you run Kafka (or another event-streaming platform) in production?"
  - Options: "Yes, in production" / "Some (side project, POC, or an earlier role)" / "No"
- If a claim you want to use for this job is in gaps.md **Needs confirmation**, or tagged `unconfirmed`, ask about it here too. Once confirmed, drop the tag and set its Source.
- Follow up once, briefly, if a "yes" is missing what, where, when, or scale. Don't nag.
- Skip this step if coverage is strong. Never ask about trivia.

**File every answer before drafting**:
- **Yes or partial:** add a new claim, or extend one, in the right facts file, in that file's format: a `### Short claim title` heading, then its tags in backticks (status such as `live`, `shipped` or `built`; ownership such as `solo`, `led-and-built`, `took-over` or `led-team`; confidence `high`, `medium` or `low`), the resume-ready wording as a `>` quote of about 190 characters at most, and `- **Source:** <first name> <YYYY-MM-DD>` (their name is in `facts/profile.md`). Tag it exactly as they described it. Record what they said, never upgrade it, and leave out anything confidential.
- **No:** add a row to gaps.md under **Doesn't have**.
- **Confirmed or corrected:** update the claim in place and remove the item from gaps.md.
- **New tech:** add a row to `facts/skills.md`.

## 6. Draft `resume.json` in the folder
- Copy the closest starting point: the style and track's starting resume (`base/<style>-<track>.json`, or the base the style file names), or a past `applications/*/resume.json` for a more similar role.
- Set `layout`, `format` and `output_name`:
  - `layout`: if the user names a template, use it: `list_templates` gives each one's ID, built in or their own. Otherwise, the one `guide/templates.md` gives the job's kind of company (startups, established companies, or government, nonprofits and schools), or, with none for that kind, the one for any job. Without `guide/templates.md`, the starting point's. When it gives more than one for the job's kind, or none for its kind and more than one for any job, pick the one of those that suits the role, by what the user's guide says each is for (such as a layouts table in `guide/writing.md`, or a layout a style file names for the track). With nothing said, use the one the starting point uses if it's among them, otherwise the first listed.
  - `format`: what the user asked for, or what `guide/templates.md` says.
  - `output_name` is `<FirstLast>Resume<MMDDYYYY>_<Company>`: the user's name from `facts/profile.md` without spaces, the folder's date, and the company's short name in letters and digits only (e.g. `AlexRiveraResume10072026_Acme`).
  - Leave the role out unless one company gets two resumes on the same date; then add a short role tag (e.g. `_Acme_TL`).
- Keep the base's `systems_heading` (such as "Key Systems Built at <employer>").
- Tailor, following `guide/writing.md` and the style file:
  - **Headline and tagline:** aimed at this role.
  - **Summary:** rewritten for this job.
  - **Stats:** the most relevant approved stats (usually 4).
  - **Systems cards:** ranked by relevance, as many as `guide/lint.json` asks (6 when it doesn't say).
  - **Bullets:** choose and re-order the bullets from facts, and re-head the groups to match the job's themes. Mirror the posting's exact terms where they're true.
  - **Skills:** as many lines as `guide/lint.json` asks (4 when it doesn't say), must-haves first, only what's in `facts/skills.md`. Keep the starting point's `skills_heading`, or name it for the field.
  - **Projects and education:** keep them or drop them per the style and the posting. Keep `education` whenever the posting asks for a degree, a license or a certification.
- Apply the nudges in `guide/preferences.md` as defaults. If the job needs something else, skip the nudge and note why in notes.md.
- Every line must trace to a confirmed `facts/` claim, never one tagged `unconfirmed`. Reuse approved wording and stay inside each claim's Say / don't-say limits.
- Address the likely worries through framing (headline, summary, emphasis). Never through untrue claims.

The shape of `resume.json` (leave out what doesn't apply):
```jsonc
{
  "layout": "classic", "format": "pdf", "output_name": "AlexRiveraResume10072026_Acme",
  "name": "", "headline": "", "tagline": "",
  "contact": { "phone": "", "email": "", "linkedin": "", "location": "", "website": "" },
  "summary": "",
  "impact_stats": [{ "value": "~40%", "label": "" }],
  "competencies": [""],             // only in templates that show them: list_templates says
  "systems_heading": "", "systems": [{ "name": "", "text": "" }],
  "experience": [{ "title": "", "company": "", "company_note": "", "location": "", "start": "07/2024", "end": "Present",
    "intro": "", "bullet_groups": [{ "heading": "", "bullets": [{ "lead": "", "text": "" }] }] }],
  "projects_heading": "", "projects": [{ "name": "", "status": "", "url": "", "text": "" }],
  "education": [{ "degree": "", "school": "", "location": "", "start": "", "end": "", "note": "" }],
  "education_first": false,         // early in a career, education leads
  "skills_heading": "", "skills": [{ "category": "", "items": [""] }],
  "extra_sections": [{ "heading": "", "items": [""] }],
  "change_log": [], "notes": []     // history the resume never shows
}
```
Templates: the app's `classic` (the default) and `minimal`, and any of the user's own, each by its ID; `list_templates` names them all, and `guide/writing.md` says how they fit. Any text can hold `**bold**` (one key metric per bullet, at most) and `[[placeholders]]`, which the build refuses while one is left.

## 7. Build and fit
Call `build_resume` with the folder's name (and `format: "both"` when the user wants Word). It builds the files and reports the pages, how full the last page is, the lines that run short, and anything that breaks the rules.
- **Read the PDF** it built. Check page breaks, orphaned headings, and anything that looks off.
- Fix every runt line it lists, and every problem.
- Build again until all of these hold:
  - `Checks: clean`
  - exactly as many pages as `guide/lint.json`'s `maxPages` (2 when it doesn't say), unless the user asks for fewer
  - the last page is 70–98% full
  - no runts
  - no orphaned headings
- Word lays out the Word file itself, and its page count can't be measured here. It nearly always matches the PDF's, but when you deliver a Word file, tell the user to open it and check the page count before sending.
- Rule problems are real problems. Fix the text. If one is a false alarm, say so in notes.md. Don't loosen `guide/lint.json` unless the user agrees.

## 8. Verify (adversarial fact-check)
Start **one** subagent with this prompt (fill in the folder):

> Adversarially fact-check the resume at `applications/<folder>/resume.json`. The sources of truth are `facts/` (read all of it), `guide/rules.md`, and `applications/<folder>/posting.md` plus `job.md` (older folders keep the posting inside job.md). Check every summary sentence, stat, card, bullet, and skill:
> - Is it supported by a facts claim, and not one tagged `unconfirmed`?
> - Is the verb within that claim's status tag (built/shipped/live/beta)?
> - Is the ownership within its tag (solo/led-and-built/took-over/led-team)?
> - Is every number present in facts, with its "~"?
> - Does it break any rules.md rule, or confidentiality?
>
> Also list must-haves from the posting that facts support but the resume leaves out. Return a numbered list: location → problem → exact fix. Don't edit files.

Apply the fixes and build again. Skip this step only if the user asks for speed.

## 9. Deliver
- Finish `notes.md`:
  - the style, track and template, and why
  - the top tailoring choices
  - the evidence-map summary
  - the questions asked and where each answer was filed
  - anything the user should double-check before sending
- The app shows the resume in the job's panel, ready to open.
- Reply in 6 lines or fewer: the file, the style, track and template, the 2–3 biggest tailoring choices, the facts added, and anything to confirm.

## 10. Feedback (now or in a later session)
When the user reacts to the resume:
1. **Fix it.** Edit resume.json and build again.
2. **Learn from it.** Add or bump a nudge in `guide/preferences.md`, using its format and their words. Praise goes under **Keep doing**.
3. **Promote only with their OK.** If they say "always" or "never", ask whether it should become a rule in `guide/rules.md` (plus `guide/lint.json` when it's checkable).
4. **Confirm** in one line: "Saved as a nudge: …".

A resume that went out with an application stays as sent: give the new one its own `output_name`.
