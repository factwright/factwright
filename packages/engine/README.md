# Resume engine

Turns resume data into finished files, and checks them before they're sent. It runs anywhere JavaScript runs, like [`@factwright/core`](../core): the desktop app prints the PDF and saves the files.

| Module | What it does |
|---|---|
| `schema` | The resume data a job's `resume.json` holds, and `readResume`, which names each problem in plain words |
| `html` and [`layouts`](src/layouts) | The resume as a Letter-size page in one of eight layouts, ready to print to PDF. It loads nothing from anywhere else |
| `templates` | The layouts as the app offers them, as templates: each one's name and what it looks like |
| `fonts` | The [fonts](fonts) a resume carries: open fonts drawn to the widths of the Windows fonts the layouts were designed with, so a resume looks the same and breaks its lines in the same places on a Mac as on Windows |
| `docx` | The resume as a single-column Word file that applicant systems read well, in its layout's fonts and colors, through the [`docx`](https://github.com/dolanmiu/docx) library, and its bytes, ready to save |
| `lint` | The user's rules from `guide/lint.json` (banned wording, exact titles, counts, card length), placeholders left in, and confidential terms that must never reach an employer |
| `fit` | A script that measures each piece of text on the page, and a report that marks runts: text that wraps with only a word or two on its last line |
| `files` | The files' name, and a PDF's page count |

The layouts:

| Layout | Look |
|---|---|
| `classic` | Traditional and all serif, in black and white |
| `timeline` | A bold name and a date rail down the side, with one warm accent (the default) |
| `executive` | A centered header, serif headings and a strengths block, in navy and gold |
| `modern` | Two columns under a dark header, with the numbers and skills at the side |
| `compact` | Section names in the margin and tight spacing, to fit a lot on one page |
| `minimal` | Lots of white space, gray headings and no color |
| `elegant` | Serif type with a deep red accent |
| `banner` | A blue banner across the top, with a bar over each section |

Every layout shows the same parts of a resume, so a resume can change its look without changing its text. Any text can hold `**bold**`, and `[[placeholders]]`, which lint refuses so none ship by accident. A resume can name its own headings: `systems_heading` over the highlight cards (otherwise "Key Systems"), `projects_heading` (otherwise "Independent Projects") and `skills_heading` (otherwise the layout's own). Education comes after the experience, or first with `education_first`, as early in a career it says the most.

```ts
import { lintResume, readResume, renderHtml, resumeDocument } from '@factwright/engine';

const read = readResume(JSON.parse(text));
if (read.ok) {
  const html = renderHtml(read.resume, 'timeline', fonts); // print to PDF; fonts are data: URLs
  const doc = resumeDocument(read.resume, 'timeline'); // pack with docx's Packer
  const problems = lintResume(read.resume, rules, confidentialTerms);
}
```

It was ported from the original repo's engine, and gave the same HTML and Word files for every resume in it, in its three layouts. Since then, the HTML names the bundled fonts first. A resume printed on a Mac with them breaks every line where the original engine's Windows PDF did.

Run `pnpm test` in this folder, or `pnpm check` from the repo root.
