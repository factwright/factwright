# Resume engine

Turns resume data into finished files, and checks them before they're sent. It runs anywhere JavaScript runs, like [`@factwright/core`](../core): the desktop app prints the PDF and saves the files.

| Module | What it does |
|---|---|
| `schema` | The resume data a job's `resume.json` holds, and `readResume`, which names each problem in plain words |
| `html` | The resume as a Letter-size page in one of three layouts (timeline, executive, modern), ready to print to PDF. It loads nothing from anywhere else |
| `docx` | The resume as a single-column Word file that applicant systems read well, through the [`docx`](https://github.com/dolanmiu/docx) library, and its bytes, ready to save |
| `lint` | The user's rules from `guide/lint.json` (banned wording, exact titles, counts, card length), placeholders left in, and confidential terms that must never reach an employer |
| `fit` | A script that measures each piece of text on the page, and a report that marks runts: text that wraps with only a word or two on its last line |
| `files` | The files' name, and a PDF's page count |

Any text can hold `**bold**`, and `[[placeholders]]`, which lint refuses so none ship by accident. A resume can name the heading over its systems cards with `systems_heading`; otherwise it's "Key Systems".

```ts
import { lintResume, readResume, renderHtml, resumeDocument } from '@factwright/engine';

const read = readResume(JSON.parse(text));
if (read.ok) {
  const html = renderHtml(read.resume, 'timeline'); // print to PDF
  const doc = resumeDocument(read.resume, 'timeline'); // pack with docx's Packer
  const problems = lintResume(read.resume, rules, confidentialTerms);
}
```

It was ported from the original repo's engine, and gives the same HTML and Word files for every resume in it, in every layout.

Run `pnpm test` in this folder, or `pnpm check` from the repo root.
