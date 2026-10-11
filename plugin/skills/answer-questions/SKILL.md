---
name: answer-questions
description: Answer the questions on a job application form so the user can paste them in before they submit. Short, laid back, in their own voice, and backed by the fact bank. Use when the user pastes application questions, says "help me answer these", or shares screenshots of an application form.
argument-hint: "[the job, then the form's questions]"
---

# Answer application questions

The user is about to submit an application and the form asks questions. Draft answers they can paste straight in.

Input: the job (company and role, maybe a link, or `job <id>` from the app), then the questions, numbered. If there are no questions, ask for them in one line and stop.

Before starting, read:
- `guide/rules.md`, if there is one. Every claim traces to `facts/`, with the same status, ownership and confidentiality limits as a resume.
- `guide/preferences.md`, if there is one. Its application-answer nudges set the voice.
- all of `facts/`.

## 1. Load everything on file
- Call `job_details` with the job's id, or its company and role: status, the user's notes, calls, history and the folder. Use the notes for context only.
- Read the job's folder: `posting.md` (older folders keep the posting in `job.md`), `job.md`, `fit-check.md`, `unmask.md`, `notes.md`, `apply.md`, and `answers.md` if it exists. Keep new answers consistent with old ones.
- `resume.json`: the resume they're sending. Answers must match it.
- Other jobs' `applications/*/answers.md` may already cover the same question ("why healthcare?"). Reuse the substance, never another company's specifics.
- No folder yet? Make one the way `/factwright:fit-check` does (the folder, `posting.md` through `read_page` and `save_posting`, and `job.md`), so the answers have a home.

## 2. Draft
- **Sound like the user typed it.** Laid back and plain: first person, contractions, everyday words. "Yep" is fine. Never over the top. Their voice nudges win over this.
- **Not AI.** No "passionate", "thrilled", "excited to", "leverage", "spearheaded", "robust", "seamless", "deeply", "at the intersection of". No em dashes, no "not just X but Y", no lists of three for rhythm, no closing line that sums up. Don't restate the question.
- **Short:** about 4 sentences unless the question asks for more. Respect word and character limits, and count.
- **Why us / why this job:** why they want it, tied to their real day-to-day work and specifics in the posting. Never a pitch about the company's market.
- **Choice questions** (checkboxes, dropdowns, yes/no): give the pick plus a one-line why. Never pick something `facts/gaps.md` says they don't have.
- **Only the user knows:** hobbies, salary number, start date, notice period, work authorization, relocation, references. Ask; never invent.
- Numbers only where they come up naturally, worded the way `facts/` approves.

## 3. Ask (only if needed)
One AskUserQuestion round, up to 4 questions, for whatever facts/ can't answer. Give easy options. New experience they mention goes into facts/ the way `/factwright:add-facts` does.

## 4. Save
Write `applications/<folder>/answers.md`, or append to it if it exists:
- `# Application questions: <Company>, <Role>`
- `Drafted <YYYY-MM-DD>. Q1 traces to facts/<file>#<claim>, …; Q3 is from the user <YYYY-MM-DD>.`
- `## <question, word for word>` then the answer. A table works for a batch of choice questions: `| Question | Pick | Why |`.

The app shows the answers in the job's panel. There's nothing to commit or sync.

## 5. Reply
Each question in bold, its answer right under it, ready to paste. Then one line for anything they have to fill in themselves. Nothing else.

If they say an answer sounds off, fix it, then save their words as a nudge in `guide/preferences.md`. Create the file if it's missing, with a `## Application answers` section. A nudge is one line: `- **<nudge>**: Seen N · last YYYY-MM-DD · from: "<their words>" (<folder>)`. If the same nudge is there already, bump Seen and the date instead.
