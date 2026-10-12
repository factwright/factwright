---
name: interview-prep
description: Get the user ready for an interview, a recruiter screen or a call about a job they're pursuing, or just talk a job through. Loads everything on file for the job (saved posting, fit check, resume sent, notes, answers, status, calls), refreshes company news, and writes a prep sheet with likely questions answered from the fact bank, stories to tell, gaps to handle and questions to ask. Use when the user has an interview, screen or call coming up, asks about a job they applied to, or wants a mock interview.
argument-hint: "[company and role, or the job]"
---

# Interview prep

Input: the company, plus the role or link if they have more than one job there, or `job <id>` from the app. Also, if they say them: the kind of conversation (recruiter screen, hiring manager, technical, panel, casual chat), when it is, and who it's with.

Before starting, read:
- `guide/rules.md`, if there is one. Every claim in an answer still traces to `facts/`, with the same status and ownership limits as a resume.
- all of `facts/`.

## 1. Load everything on file
- Call `job_details` with the job's id, or its company and role. It gives the status, dates, the user's notes, the calls and interviews they logged, history and the job's folder.
- If it lists an upcoming call, prep for that one: its type (recruiter screen, hiring manager, technical, panel, final) and date set the focus.
- Read the job's folder in `applications/`:
  - `posting.md`: the posting as saved, word for word, so it's there even if the link is dead. Older folders keep it inside `job.md`.
  - `job.md` (company notes, requirements), `fit-check.md`, `unmask.md`, `notes.md` (evidence map, tailoring choices, pay), `answers.md`
  - `resume.json`: the resume they actually sent. Answers must match it.
- If the job came from a job search, read its entry in `searches/*/jobs.json` (why, gaps, flags).
- If `outreach/<YYYY-MM-DD>-<company>.md` exists, read it for context.
- If nothing is saved and the link still works, save the posting first: read it with `read_posting` or `read_page`, then `save_posting` with the link and the job's folder. If the link is dead and nothing is saved, say so in one line and work from what the user remembers.

## 2. Just talking?
If the user only wants to talk the job through, stop here and chat from what you loaded. Don't write a file unless they ask for one.

## 3. Refresh the company (3 searches at most)
- News from the last ~3 months: funding, launches, leadership changes, layoffs, acquisitions.
- If the user names who they're meeting, look up their public role and background: search results and public pages only, never a sign-in. Work info only: title, team, public posts and talks.

## 4. Write `applications/<folder>/prep.md`
Header: `# Prep: <Company>, <Role>`, then `- **Date:** <today>`, and `- **Conversation:** <type, date>` if known.

Sections, short and scannable:
- **The job in 5 lines:** what they need most, and what they'll probe.
- **30-second pitch:** tailored to this job, fact-checked.
- **Likely questions:** 6–10, each with a short answer outline that cites `facts/<file>#<claim>`. Respect the status tags: built ≠ live, led-team ≠ solo.
- **Stories to have ready:** 3–5 STAR outlines from the fact bank, each mapped to a requirement.
- **Gaps and how to handle them:** from the fit check and resume notes. Honest framing and adjacent proof, never a stretch.
- **What's on the resume you sent:** the claims they're most likely to ask about, so answers match it.
- **Questions to ask them:** 5–8, specific to this company and role.
- **Pay and logistics:** the listed range or salary-check estimate, flags from the fit check, recent news worth mentioning.

The app shows prep.md in the job's panel. There's nothing to commit or sync.

## 5. Reply
In 8 lines or fewer: the pitch, the top 3 likely questions, the biggest gap and how to frame it, 2 questions to ask, and an offer to run a mock interview ("say 'mock' and I'll interview you").

## Mock interview
If the user says "mock", play the interviewer for the conversation type. Ask one question at a time. After each answer, give one line of feedback: what landed, and what to tighten or back with a fact.
