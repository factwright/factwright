---
name: thank-you
description: Draft short thank-you notes after a call or an interview, one for each person the user met, from their notes on how it went and everything on file for the job, for the user to send themselves. Use when the app asks for thank-you notes for a call (`job <id> call <id>`), or when the user wants to thank people after an interview.
argument-hint: "[job <id> call <id>, or the company and who they met]"
---

# Thank-you notes

The user just had a call or an interview. Draft a short note for each person they met, which they send themselves, the same day if they can. A good note is specific: it picks up something from the conversation, and it can add the one thing the user wished they'd said.

Input: `job <id> call <call id>` from the app. When the user asks in the chat instead, call `find_job`, then find the call in `job_details`, and ask which one if it isn't clear.

## Hard rules
- **The user sends everything.** Write drafts only. Never message, connect or post anywhere.
- Anything about the user traces to `facts/`, as on a resume, and matches what they sent: `job_details` marks the resume that went out.
- Never invent what was said on the call. When the user's notes don't say, ask.
- Nothing confidential goes in, as the standing rules say: `guide/confidential-terms.txt` lists words that never appear.

## 1. Load
- `job_details` with the job's id: the call (when, who with and their roles, what it was about, how it went in the user's words, and its prep sheet), the earlier calls, and everything on file.
- The call's prep sheet, when it has one: what the user planned to land, and the questions they meant to ask.
- The posting, and `guide/preferences.md` for the user's outreach nudges, which win over these defaults.
- `past_answers`, to sound like the user.

## 2. Ask (when the notes are thin)
For each person, a note needs one specific thing from the conversation: a topic you went deep on, a question that led somewhere, or something they said about the team or the work. When the user's notes on how it went don't give one, ask up to 4 questions in one AskUserQuestion round, offering likely answers from the prep sheet: "What stood out with Dana: the migration plan, the on-call rotation, or something else?" Ask too whether there's anything they wish they'd said, once, for the whole call.

## 3. Write
For each person the user met, in the order of the call:
- A subject line for email: short and plain, such as "Thank you: today's platform interview".
- 60 to 120 words. Thank them for something specific from the conversation. Tie it to one proof point from `facts/` that answers what they cared about, or add the thing the user wished they'd said, briefly and honestly. Then the interest in the role, in a line, and a forward-looking close. No flattery, no "I am writing to".
- A recruiter's note is shorter: thanks, interest, and the user's availability for next steps when their notes say.
- A promise the user made on the call, such as sending a work sample, gets a line saying when it's coming.
- When the user has no address for someone, say to send it through the recruiter, or as a message they send themselves.

## 4. Save and reply
Call `save_thank_you` with the job's id, the call's id and the notes as Markdown: a `## <Name>` heading for each person, then `**Subject:** <subject>`, then the note. The app shows them on the call.

Reply in 6 lines or fewer: who the notes are for, the first note in full, and "Send them today if you can."
