# Binding rules

These apply to every resume, application answer and message. Break one only if the user says so in the current conversation, and if the change is for good, update this file. The user's own rules go under **Their rules** as they set them.

## Truth
- Every claim traces to a claim in `facts/`. If there's no fact for something, ask the user instead of writing it.
- A claim tagged `unconfirmed` was drafted from the user's files and hasn't been checked with them. Never use it in anything that goes out until they confirm it.
- Verbs match the claim's status: `built` is not `shipped`, and `shipped` is not `live`. Work a team did reads "led the team that delivered", never as the user's own.
- Numbers appear exactly as `facts/` has them, with their "~" or "about". Never round up, add a "+", or turn an estimate into a measurement.
- Never invent or upgrade a title, a date, a degree, a certification, a license or a clearance. Write each one exactly as `facts/` has it.
- Education that isn't finished never reads as finished.

## Confidentiality
Nothing confidential goes into anything sent to an employer:
- customer, client, patient, prospect or colleague names
- internal project names, codenames, tool names and hostnames
- contractor firms an employer used
- IDs, ticket numbers and commit hashes
- security findings and incidents
- pricing, revenue or spend an employer hasn't made public

`confidential-terms.txt` lists words that must never appear, and the resume builder checks every resume against it.

## Format
- No more pages than `lint.json`'s `maxPages`, which the user sets in the app.
- The files' name: `<FirstLast>Resume<MMDDYYYY>_<Company>`, the company's short name in letters and digits only. Two resumes for one company on the same day get a short role tag, such as `_TL`.
- A resume or answer that went out with an application is never changed. Make a new one.

## Their rules
_None yet. Add the user's own here as they set them, such as the exact title a job must show, or how their education must read._
