---
name: add-facts
description: Add or correct facts about the user's experience in their fact bank (facts/), outside of a job application. Use when the user says they built, shipped, led, or learned something new; when a status changed (e.g. something went live); when they correct a fact; or when they say "interview me" to fill gaps or start a fact bank.
argument-hint: "[what's new, or interview me]"
---

# Add facts

The fact bank in `facts/` is the source of truth for every resume and answer: if a claim isn't there, it doesn't get used.

There are two modes.
- **Tell.** The user describes new experience, a status change, or a correction.
- **Interview.** The user gave no details, or said "interview me". Pick the 4 most resume-valuable unknowns from `facts/gaps.md` (**Needs confirmation** first, then **Open questions**) and ask them in one AskUserQuestion round. With no fact bank yet, start with the basics instead: their roles (employer, title, dates), what they're proudest of in each, and their main tech.

## Steps
1. Read `facts/README.md` if there is one: it says which file holds what. Then read the facts file(s) the change touches, plus `facts/gaps.md`.
2. Pin down only what a resume-grade claim still needs. Take one follow-up round at most. A claim needs:
   - what they did
   - ownership: solo / led-and-built / took-over / led-team
   - status: live / shipped / beta / built
   - when
   - numbers they're confident in
   - the tech used
3. Write the change:
   - **New claim:** put it in the right file, in the claim format below, with `Source: <first name> <YYYY-MM-DD>` (their name is in `facts/profile.md`). Write resume-ready wording, about 190 characters at most.
   - **Correction or status change:** edit the claim in place, update its Source line, and fix every other file that repeats it. Never keep two versions.
   - **"No, I haven't":** add a row under **Doesn't have** in gaps.md, so nobody asks again.
   - **Resolved confirmation:** delete it from gaps.md.
   - **New tech:** add a row to `facts/skills.md`.
4. If a status changed (for example, built → live), update wording that's now stale in `base/*.json`, if there are any. Never edit a past application's files.
5. Reply in 4 lines or fewer: what changed, and where.

Record what the user said, and never upgrade it. Never write confidential details: names of customers or colleagues, hostnames, IDs, incidents, or spend.

## Claim format
Each claim gets its own `###` heading, so it can be cited as `file.md#claim-title`:
```markdown
### Short claim title
`live` `solo` `high`
> Resume-ready wording, about 190 characters max.
- **Short:** a version of about 110 characters or less, for tight fits (optional)
- **Numbers:** 98 tools; ~390 AI tests (as of 2026-09)
- **Say / don't say:** "built realtime, re-architected to batch" / never "live realtime"
- **Keywords:** the job-post terms this claim honestly proves
- **Source:** <first name> <YYYY-MM-DD>
```
- **Status** decides the verbs: `live` (in production: "built", "runs") · `shipped` (in a release, maybe gated) · `beta` (say exactly what the claim says) · `built` (merged, not deployed: "built", never "in production") · `in-progress` ("building") · `pre-launch` (a side project not yet public) · `plan-only` (never claim it).
- **Ownership:** `solo` (alone; AI-assisted still counts) · `led-and-built` (built the core and led it) · `took-over` (inherited, then rebuilt or completed; never "built from scratch") · `led-team` (their team built it: "led the team that delivered").
- **Confidence:** `high` (use as written) · `medium` (hedge with "about" or "~", and keep it out of headline stats) · `low` (ask before using it).

## Starting a fact bank
If `facts/` doesn't exist yet, make it as you go:
- `facts/profile.md`: name, contact details, education and certifications, target roles.
- one file per job they've held, such as `facts/acme.md`, with an **Overview** at the top, then claims.
- `facts/projects.md` and `facts/skills.md` (each technology, how deep, and which file proves it).
- `facts/gaps.md` with three sections: **Doesn't have** (a table: `| Topic | Their answer | Date |`), **Needs confirmation**, and **Open questions**.
- `facts/README.md`: a short table of these files and what each holds.

Everything you save here stays in the user's workspace. The app picks it up on its own, so there's nothing to commit or sync.
