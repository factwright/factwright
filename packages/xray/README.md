# ATS X-ray

Reads a resume file the way an applicant tracking system does, and says what it would get wrong. It works from the real file, a PDF or a Word file, the same way every time, with no Claude and nothing sent anywhere. The desktop app shows it from a resume's X-ray button.

It answers four questions:
- **What does a parser get?** The text in the order a parser reads it, line by line.
- **What does it fill in?** The name, email, phone, city and links; each job's title, company and dates; schools; skills; and the sections it recognizes by their headings.
- **What would trip it up?** Text read out of order, columns, headers and footers, junk characters and icons, letters joined into one or spaced apart, tables and text boxes, missing contact details, dates it can't read, unusual fonts, and length.
- **Does it have the job's words?** With the job's posting, each must-have and nice-to-have term, found or missing. A missing term the fact bank backs is one to add. One it doesn't back is a real gap, and stays off the resume.

| Module | What it does |
|---|---|
| `pdf` | Reads a PDF with pdf.js: its text in the order the file draws it, which is the order Apache Tika, pypdf and pdf.js give, and most systems work from, with where each piece sits and its font |
| `docx` | Reads a Word file's XML: the body's paragraphs and tables in order, its headers and footers, and its text boxes, each marked, since many systems skip them |
| `sections` | The headings parsers know, such as "Work History" or "Clinical Skills", and headings set the same way that they don't |
| `fields` | What a parser fills in: contact details by their patterns, each job from a span of dates in the experience section, schools and skills |
| `dates` | Dates as parsers read them: a month and year, a year or "Present" read; seasons, quarters and two-digit years don't |
| `layout` | A PDF's layout: text read back up the page, columns side by side, dates read apart from their job, and text repeated at the top or bottom of each page |
| `checks` | Each check, passed, worth knowing ("note"), or worth fixing ("fix"), with what it means and what to do, in plain words |
| `posting` | A posting's requirements: must-haves from its requirements, nice-to-haves from its preferred parts and the work it describes |
| `vocabulary` and `terms` | Skills, tools, methods and credentials across fields, each with its other names, and how to find them as whole words |
| `facts` | What the fact bank says: skills.md, the degrees and certifications in profile.md, each claim's Keywords line, and what gaps.md says the user doesn't have |
| `keywords` | The posting's key terms against the resume, and for each one missing, what the fact bank says: add it, confirm it first, or leave it off |
| `xray` | All of it together, with a summary such as "Reads cleanly · 14 of 18 key terms · 2 things to fix" |
| `findings` | What a revision could fix, each with an ID that stays the same from one X-ray to the next and how it gets fixed: in the resume's words, by asking the user first, or in the template. Then, after a revision, what became of each one picked |

```ts
import { getDocument } from 'pdfjs-dist';
import { readDocx, readPdf, xray } from '@factwright/xray';

const file = name.endsWith('.pdf') ? await readPdf(bytes, getDocument) : readDocx(bytes);
const result = xray(file, { posting, facts }); // both optional: facts are { path, text } files
console.log(result.summary.text);
```

In a browser, set pdf.js's worker before reading a PDF, as the desktop app does.

## Its tests
They read real files, in [`test/fixtures`](test/fixtures): a made-up resume printed in Classic and Minimal, as PDFs and Word files, the way the app makes them, and files with each problem it looks for. Classic and Minimal read cleanly, with nothing flagged, which shows the checks don't cry wolf. [`scripts/fixtures.ts`](scripts/fixtures.ts) makes them all, in Electron, which prints with the same Chromium as the app:

```sh
pnpm --filter @factwright/xray fixtures
```

Make them again after a change to the templates or the engine. Run `pnpm test` in this folder, or `pnpm check` from the repo root.
