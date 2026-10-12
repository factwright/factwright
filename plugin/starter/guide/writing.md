# Writing guide

The craft of a strong resume. If anything here conflicts, `rules.md` wins first, then the user's nudges in `preferences.md`, then this guide.

## The first six seconds
A reader skims the top third of the first page before deciding to read on.
- **Headline:** the role they're hiring for, said back to them, as far as the facts allow, such as "Senior Product Designer".
- **Tagline:** three to six "·"-separated focus areas, in the posting's own words where they're true.
- **Highlights** (`impact_stats`): the three or four numbers from `facts/` that matter most for this job.
- **Summary:** two to four sentences. Who they are, aimed at this role; two or three proofs that mirror the job's top needs; how they work. No buzzwords.

## Tailoring, in order of impact
1. **Start from the closest resume:** the starting resume for the style and track in `base/`, or a past `applications/*/resume.json` for a similar job.
2. **Aim the headline, tagline and summary at the job.** Job titles in the experience stay exactly as `facts/` has them; only the headline flexes.
3. **Choose and order the highlight cards** (`systems`) by what the job needs most. Name the section for the field with `systems_heading`: "Key Projects", "Selected Work", "Highlights".
4. **Group and order the bullets** under headings that echo the job's themes, strongest matches first.
5. **Mirror the posting's exact words** where they're true, such as "patient education" rather than "teaching patients". Applicant systems match words.
6. **Skills:** the job's must-haves first, and only what `facts/skills.md` proves. Name the section for the field with `skills_heading`, such as "Clinical Skills" or "Tools".
7. **Projects, education and certifications:** keep what the job values, and drop the rest when space is tight. Early in a career, education goes first (`education_first`).

## Bullets
- Open with a strong verb: built, led, cut, grew, launched, designed, resolved, trained, negotiated.
- Then what, how, and the result, with a number when `facts/` has one.
- At most one **bold** number per bullet.
- No "I", and no filler: "responsible for", "worked on", "helped with", "various".
- Past tense for finished work, present tense for what they still do.
- Spell out an abbreviation the first time, unless every reader in the field knows it.
- Stay inside each claim's **Say / don't say** limits, and reuse its approved wording before writing new wording.
- Bullets don't repeat the highlight cards.

## Show, don't claim
"Results-driven", "detail-oriented", "team player", "passionate", "self-starter", "proven track record": every resume says these, so readers skip them. A fact shows it instead. `lint.json` flags the worst of them.

## Fit
`build_resume` reports the pages, how full the last one is, and runts: text whose last line holds only a word or two.
- Fix every runt: trim a few words, or add a detail so the line fills.
- The last page should be 70–98% full. Emptier looks thin; fuller risks spilling over in Word.
- Look at the PDF for headings stranded at the bottom of a page.
- About how many characters fit on a line, before you build: a bullet runs about 100 in classic and minimal, and a highlight card about 190. In a template of the user's own, build once and go by the fit report.

## Applicant systems
- Section names stay standard: Summary, Experience, Education, Skills. The templates use them.
- The Word file is always one column, which every applicant system reads. Send it when a company's site asks for Word; otherwise send the PDF.
- Mirror the posting's terms, but only where they're true.

## Templates
`templates.md` has the user's picks: use the one for the kind of company the job is at, as `layout` in resume.json. When two fit, the one that suits the role. Changing the look never changes the words.

| `layout` | Look | Shows the strengths list (`competencies`) |
|---|---|---|
| `classic` | Traditional, all serif, black and white | Yes, three columns |
| `minimal` | White space, gray headings, no color | Yes, three columns |

The user can have templates of their own too, made from a resume whose look they like, or from a file someone shared. `list_templates` lists them all, and says which show the strengths list.
