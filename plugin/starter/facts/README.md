# Facts: what's true about the user

The single source of truth for every resume, answer and message. If a claim isn't here, it doesn't go out. It grows over time: each gap a job turns up, and each answer the user gives, is filed here.

## Files
| File | What's in it |
|---|---|
| `profile.md` | Name and contact details, education, certifications and licenses, languages, the roles they want, and their story in a few lines |
| one file per job, such as `acme-health.md` | An **Overview** (titles exactly as held, dates, place, what the company does, scope), then that job's claims |
| `projects.md` | Work outside a job: side projects, volunteering, school projects |
| `skills.md` | Each skill and tool, how deep it goes, and which file proves it |
| `gaps.md` | **Doesn't have** (settled: don't claim it, don't ask again), **Needs confirmation** and **Open questions** |

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

**Unconfirmed:** `unconfirmed`, first among the tags, marks a claim drafted from the user's files or notes that they haven't checked yet. Never use it in anything that goes out until they confirm it. Once they do, drop the tag and set its Source to their first name and the date.

## Sources
- `<first name> <YYYY-MM-DD>`: the user said so.
- `resume <file> <YYYY-MM-DD>`, `notes <YYYY-MM-DD>`, `LinkedIn <YYYY-MM-DD>`, `screenshot <file> <YYYY-MM-DD>`: drafted from what they shared, and `unconfirmed` until they confirm it.

## Adding facts
- File each fact where it belongs, in the claim format.
- "No, I haven't" answers go in `gaps.md` under **Doesn't have**, so nobody asks again.
- When the user corrects a fact, edit it in place and update its Source. Never keep two versions.
- Plain, active wording. No "I", no fluff.

## Confidentiality
These never appear in `facts/`: names of customers, clients, patients, prospects or colleagues; contractor firms; internal names, codenames, tools and hostnames; IDs, ticket numbers and commit hashes; security findings and incidents; pricing and spend. Names like these go in `guide/confidential-terms.txt` instead, so no resume ever carries them.
