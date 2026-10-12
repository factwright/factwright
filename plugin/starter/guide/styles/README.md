# Styles

A style says who reads the resume, and what they reward. Each style has tracks for the kind of role.

| Track | Roles |
|---|---|
| `leader` | Manages people or a function: manager, head of, director, VP, C-level |
| `builder` | A senior hands-on owner of big pieces of work: lead, principal, staff, founding, architect, senior specialist |
| `ic` | Does the core work of the role, from early career to senior |

| Style | File | When |
|---|---|---|
| `startup` | [startup.md](startup.md) | Early and growing companies, up to a few hundred people, or a posting that reads scrappy or 0→1 |
| `big-company` | [big-company.md](big-company.md) | Established companies: mid-size and large, public companies and enterprises, or a posting that reads process, scale or governance |
| `public-sector` | [public-sector.md](public-sector.md) | Government at any level, nonprofits, schools and universities, public hospitals and health systems |

If the user doesn't name a style, infer it from the company and say which you picked. In between, use judgment: a 600-person company that still says "move fast" is `startup`.

## Starting resumes
`base/<style>-<track>.json` is the starting resume for that style and track, in the template `templates.md` gives that kind of company. Tailored resumes start from the closest one.

## Adding a style
Copy a style file to `<name>.md`, fill in its sections (Reader, Tracks, Emphasize, Avoid, Tone, Sections), and add it to the table above.
