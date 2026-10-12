---
name: answer-questions
description: Answer the questions on a job application form so the user can paste them in before they submit. Short, laid back, in their own voice, and backed by the fact bank. Use when the user pastes application questions, says "help me answer these", or shares screenshots of an application form.
argument-hint: "[the job, then the form's questions]"
---

# Answer application questions

The user is about to submit an application and the form asks questions. Draft answers they can paste straight in.

Input: the job (company and role, maybe a link, or `job <id>` from the app), then the questions, numbered. From the app, the questions the user pasted come in `job_details`, under Application questions. If there are no questions, ask for them in one line and stop.

Before starting, read:
- `guide/rules.md`, if there is one. Every claim traces to `facts/`, with the same status, ownership and confidentiality limits as a resume.
- `guide/preferences.md`, if there is one. Its application-answer nudges set the voice.
- all of `facts/`. If there's no fact bank yet, say so, suggest `/factwright:add-facts` ("interview me" starts one), and stop. Claims tagged `unconfirmed` aren't usable until the user confirms them: ask in step 3 when an answer needs one.

## 1. Load everything on file
- Call `job_details` with the job's id, or its company and role: status, the user's notes, calls, history and the folder. Use the notes for context only.
- Read the job's folder: `posting.md` (older folders keep the posting in `job.md`), `job.md`, `fit-check.md`, `unmask.md`, `notes.md`, `apply.md`, and `answers.md` if it exists. Keep new answers consistent with old ones.
- `resume.json`: the resume they're sending. Answers must match it.
- Other jobs' `applications/*/answers.md` may already cover the same question ("why healthcare?"). Reuse the substance, never another company's specifics.
- No folder yet? Make one, so the answers have a home:
  - `applications/<YYYY-MM-DD>-<company>-<role>/`, lowercase with hyphens.
  - `posting.md`: read the link with `read_posting` (on Greenhouse, Lever, Ashby or Gem) or `read_page` (anywhere else), then `save_posting` with the link and the folder's name. For pasted text, save it as `posting.md` with a `- **Source:** pasted by the user <YYYY-MM-DD>` line on top.
  - `job.md`: `# <Company>: <Role>`, then `- **Date:**`, `- **Company:**`, `- **Role:**` and `- **Links:**`, then `## Job description` with one line: "Saved word for word in posting.md."

## 2. Draft
- **Sound like the user typed it.** Laid back and plain: first person, contractions, everyday words. "Yep" is fine. Never over the top. Their voice nudges win over this.
- **Not AI.** No "passionate", "thrilled", "excited to", "leverage", "spearheaded", "robust", "seamless", "deeply", "at the intersection of". No em dashes, no "not just X but Y", no lists of three for rhythm, no closing line that sums up. Don't restate the question.
- **Short:** about 4 sentences unless the question asks for more. Respect word and character limits, and count.
- **Why us / why this job:** why they want it, tied to their real day-to-day work and specifics in the posting. Never a pitch about the company's market.
- **No names:** never name the user's colleagues or customers, and nothing confidential: those limits are the same as a resume's.
- **Choice questions** (checkboxes, dropdowns, yes/no): give the pick plus a one-line why. Never pick something `facts/gaps.md` says they don't have.
- **Only the user knows:** hobbies, salary number, start date, notice period, work authorization, relocation, references. Ask; never invent.
- Numbers only where they come up naturally, worded the way `facts/` approves.

## 3. Ask (only if needed)
One AskUserQuestion round, up to 4 questions, for whatever facts/ can't answer. Give easy options. File what they tell you before drafting:
- **New experience:** a claim in the right facts file, in that file's format: a `### Short claim title` heading, then its tags (status, ownership, confidence) in backticks, the resume-ready wording as a `>` quote, and `- **Source:** <first name> <YYYY-MM-DD>` (their name is in `facts/profile.md`). Record what they said, and never upgrade it.
- **"No, I haven't":** a row under **Doesn't have** in `facts/gaps.md`, so nobody asks again.

## 4. Save
Write `applications/<folder>/answers.md`, or append to it if it exists:
- `# Application questions: <Company>, <Role>`
- `Drafted <YYYY-MM-DD>. Q1 traces to facts/<file>#<claim>, …; Q3 is from <first name> <YYYY-MM-DD>.`
- `## <question, word for word>` then the answer. A table works for a batch of choice questions: `| Question | Pick | Why |`.

The app shows the answers in the job's panel. There's nothing to commit or sync.

## 5. Reply
Each question in bold, its answer right under it, ready to paste. Then one line for anything they have to fill in themselves. Nothing else.

If they say an answer sounds off, fix it, then save their words as a nudge in `guide/preferences.md`, and confirm in one line: "Saved as a nudge: …". Create the file if it's missing, with a `## Application answers` section. A nudge is one line, in the file's format: `- **<nudge>**: Seen N · last YYYY-MM-DD · scope: all · from: "<their words>" (<folder>)`. If the same nudge is there already, bump Seen and the date instead.
