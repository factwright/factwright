---
name: who-to-message
description: Find 3–5 people worth messaging at a company to get the user noticed (hiring manager, founders, in-house recruiter, people with shared background), with why each one, any warm path, and a short draft the user sends themselves. Use when the user asks who to reach out to, who to message on LinkedIn, or how to get attention at a company or startup.
argument-hint: "[company, plus the job if there is one]"
---

# Who to message

Input: the company (name or link), plus the job posting or `job <id>` if there is one, and the user's goal if they give one (a referral, the hiring manager's attention, inside info).

## Hard rules
- **The user sends everything.** Never message, connect, follow, like, comment, endorse, apply, or change anything anywhere. Write drafts only.
- **Public sources only.** Search results and public pages. Never sign in anywhere, LinkedIn included.
- **Work info only:** name, title, team, public profile link, public posts and talks. No personal emails, phone numbers, addresses, or family details, and never guess email addresses.
- Drafts that describe the user's experience follow `guide/rules.md` (if there is one) and trace to `facts/`, the same as a resume. With no fact bank yet, say so in one line, suggest `/factwright:add-facts`, and write the drafts without proof points.

## 1. Map who decides
- Read the job's posting if there is one (`job_details` finds its folder), and research the company briefly: size, stage, team structure.
- Work out who owns this hire:
  - **Startup (up to ~50 people):** the founders and the CTO. Message them directly.
  - **Mid-size:** the VP or Director of Engineering, or the manager of the team.
  - **Big company:** the hiring manager, a senior person on the team, and the in-house recruiter.
- Don't target agency recruiters here. `/factwright:unmask-job` handles those.

## 2. Research
Search first. `read_page` reads a team or about page, but the user may have to OK each page, so read only the best ones.
- Search snippets for LinkedIn profiles: `site:linkedin.com/in "<Company>" "<title>"`. They give name, title, and location, but they go stale, so mark those titles "per search, verify".
- The company's own team, about, and leadership pages; blog authors; conference talks and podcasts; GitHub org members; press releases; founders' posts on Hacker News.
- Job posts that name a poster or a hiring team.

## 3. Warm paths (best first)
1. **1st-degree connections at the company**, from the user's own LinkedIn export at `linkedin/Connections.csv` in the workspace. They get it from LinkedIn → Settings → Data privacy → Get a copy of your data → Connections. If the file is missing or more than ~2 months old, tell them how to get a fresh one, in one line.
2. **Shared background:** past employers and schools in `facts/`, shared domains, shared communities.
3. **Signs they'll answer:** they posted "we're hiring" or "DM me", they write publicly, or they recently joined and are building a team.

## 4. Pick 3–5 people
Rank them by closeness to the hiring decision, then warmth (1st-degree > shared background > cold), then signs they'll answer. For each person, give:
- name, title, and why them (one line)
- the warm path or hook
- their public profile link
- the best channel: a LinkedIn connection note, InMail, email to a published work address, or a public channel such as the company's community
- a draft: a connection note of 200 characters or less (fits any account) and a 60–120 word follow-up. Make it specific to them and the role, with one concrete proof point from facts/ and one clear ask. No flattery. Their outreach nudges in `guide/preferences.md` win.

Also give the order. For startups, message the founders now. For bigger companies, apply first, then message the hiring manager and mention the application.

## 5. Save and reply
- Save everything to `outreach/<YYYY-MM-DD>-<company>.md`, with the company lowercase and hyphenated. It stays in the user's workspace, and the app adds it to the history of the company's jobs.
- Reply in 10 lines or fewer: the people (name, title, why, warm path) and where the drafts are saved. Show the top draft inline.
