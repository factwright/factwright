# Facts: what's true about the user

The single source of truth for every resume, answer and message. If a claim isn't here, it doesn't go out. It grows over time: when a job asks for something that isn't here, Claude asks the user about it, and files each answer here.

## Files
| File | What's in it |
|---|---|
| `profile.md` | Name and contact details, education, certifications and licenses, languages, the roles they want, and their story in a few lines |
| one file per job, such as `acme-health.md` | An **Overview** (titles exactly as held, dates, place, what the company does, scope), then that job's claims |
| `projects.md` | Work outside a job: side projects, volunteering, school projects |
| `skills.md` | Each skill and tool, how deep it goes, and which file proves it |
| `gaps.md` | **Doesn't have** (settled: don't claim it, don't ask again), a table with the columns Topic, Their answer and Date, then **Needs confirmation** and **Open questions** |

## Claim format
Each claim gets its own `###` heading, so it can be cited as `file.md#claim-title`:
```markdown
### Short claim title
`shipped` `led-and-built` `high`
> Resume-ready wording, about 190 characters at most.
- **Short:** a version of about 110 characters or less, for tight fits (optional)
- **Numbers:** 12 clinics; wait times down ~30% (as of 2026-05)
- **Say / don't say:** "led the rollout" / never "built the system"
- **Keywords:** the posting terms this claim honestly proves
- **Source:** Jordan 2026-10-12
```

## Tags
**Status** decides the verbs:
- `live`: in use now. "Runs", "built", "in production".
- `shipped`: released or delivered, maybe to some people only.
- `beta`: in a trial. Say exactly what the claim says.
- `built`: finished, not released. "Built", never "launched".
- `in-progress`: "building", "leading". Use sparingly.
- `pre-launch`: a side project not public yet.
- `plan-only`: never claim it.

**Ownership:**
- `solo`: they did it alone (help from tools still counts as alone).
- `led-and-built`: they did the core of it and led others.
- `took-over`: they inherited it, then rebuilt or finished it. Never "from scratch".
- `led-team`: their team did it. "Led the team that delivered".

**Confidence:**
- `high`: use as written.
- `medium`: hedge it ("about", "~"), and keep it out of the headline numbers.
- `low`: ask before using it.

**Unconfirmed:** `unconfirmed`, first among the tags, marks a claim the user hasn't verified yet: drafted from their files or notes, or saved from an answer they gave Claude while it worked on a job. The app lists these at the top of the Fact bank, as Unverified. An answer is used in the run the user gave it in; otherwise, Claude asks before using an unverified claim in anything that goes out. Once the user verifies it, the tag goes and its Source becomes their first name and the date.

## Sources
- `<first name> <YYYY-MM-DD>`: the user said so, or verified it.
- `resume <file> <YYYY-MM-DD>`, `notes <YYYY-MM-DD>`, `LinkedIn <YYYY-MM-DD>`, `screenshot <file> <YYYY-MM-DD>`: drafted from what they shared, and `unconfirmed` until they verify it.
- `answer <YYYY-MM-DD>, <what Claude was doing>`, such as `answer 2026-10-14, tailoring a resume for Acme Health`: the user's answer to Claude's question, `unconfirmed` until they verify it. Under it, a `- **Question:**` and `- **Answer:**` line for each question it rests on, word for word, written by the app from its own record of what the user answered.

## Adding facts
- File each fact where it belongs, in the claim format.
- While Claude works on a job, it saves the user's answers with Factwright's tools: a yes as a claim tagged `unconfirmed`, with its source and the questions it rests on, and a "No, I haven't" as a row under **Doesn't have** in `gaps.md`, so nobody asks again. The tools never change a verified claim.
- When the user corrects a fact, edit it in place and update its Source. Never keep two versions.
- Plain, active wording. No "I", no fluff.

## Confidentiality
These never appear in `facts/`: names of customers, clients, patients, prospects or colleagues; contractor firms; internal names, codenames, tools and hostnames; IDs, ticket numbers and commit hashes; security findings and incidents; pricing and spend. Names like these go in `guide/confidential-terms.txt` instead, so no resume ever carries them.
