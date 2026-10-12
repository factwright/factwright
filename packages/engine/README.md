# Resume engine

Turns resume data into finished files, and checks them before they're sent. It runs anywhere JavaScript runs, like [`@factwright/core`](../core): the desktop app prints the PDF and saves the files.

| Module | What it does |
|---|---|
| `schema` | The resume data a job's `resume.json` holds, and `readResume`, which names each problem in plain words |
| `templates` and [`built-in`](src/built-in) | What a template is, and the two the app comes with, Classic and Minimal |
| [`template`](src/template) | Templates as data: Mustache's syntax, filled in from a view of the resume; the checks a template passes before it's used; and reading and writing a template's file |
| `html` | The resume as a Letter-size page in a template, ready to print to PDF. It loads nothing from anywhere else |
| `fonts` | The [fonts](fonts) a resume carries: open fonts drawn to the widths of the Windows fonts the templates were designed with, so a resume looks the same and breaks its lines in the same places on a Mac as on Windows |
| `docx` | The resume as a single-column Word file that applicant systems read well, in its template's fonts and colors, through the [`docx`](https://github.com/dolanmiu/docx) library, and its bytes, ready to save |
| `lint` | The user's rules from `guide/lint.json` (banned wording, exact titles, counts, card length), placeholders left in, and confidential terms that must never reach an employer |
| `fit` | A script that measures each piece of text on the page, and a report that marks runts: text that wraps with only a word or two on its last line |
| `files` | The files' name, and a PDF's page count |

The templates the app comes with:

| Template | Look |
|---|---|
| `classic` | Traditional and all serif, in black and white (the default) |
| `minimal` | Lots of white space, gray headings and no color |

A user can have templates of their own too, kept as files in their workspace's `templates/` folder: one someone shared, or one Claude made in the look of a resume they like. A template is data: its look in a sentence, the font files it carries, what it calls each section, its look in Word, its styles, and its page's markup in [Mustache's syntax](https://mustache.github.io/mustache.5.html), which the engine fills in from the resume (see [`template/view.ts`](src/template/view.ts) for what it can show). Its file is JSON, with `"factwright": "resume-template"` and a version, and its name gives its ID, which a resume's `layout` names.

A template can come from anywhere, so `readTemplate` checks one before it's used, and says what's wrong in plain words:
- The markup uses only elements for text, such as div, section, h2, ul and table, with attributes such as class and style, each in double quotes. Nothing that runs a script, loads a file or takes input.
- Values go between tags or inside an attribute's quotes, and each is escaped, so no resume can add markup. A section starts and ends in the same place.
- The styles can't hold "<", so they can't end the stylesheet, nor `@import`, and `url()` holds only a data: picture or font.
- Every name the markup shows is part of a resume, so a typo is caught rather than showing nothing.

The app prints in a hidden, sandboxed window that loads nothing but the page, as well.

Every template the app comes with shows the same parts of a resume, so a resume can change its look without changing its text. Any text can hold `**bold**`, and `[[placeholders]]`, which lint refuses so none ship by accident. A resume can name its own headings: `systems_heading` over the highlight cards (otherwise "Key Systems"), `projects_heading` (otherwise "Independent Projects") and `skills_heading` (otherwise the template's own). Education comes after the experience, or first with `education_first`, as early in a career it says the most.

```ts
import { builtInTemplate, lintResume, readResume, readTemplate, renderHtml, resumeDocument } from '@factwright/engine';

const read = readResume(JSON.parse(text));
const template = builtInTemplate('classic'); // or readTemplate(JSON.parse(file), id) for the user's own
if (read.ok && template) {
  const html = renderHtml(read.resume, template, fonts); // print to PDF; fonts are data: URLs
  const doc = resumeDocument(read.resume, template); // pack with docx's Packer
  const problems = lintResume(read.resume, rules, confidentialTerms);
}
```

It was ported from the original repo's engine, and gave the same HTML and Word files for every resume in it. Since then, the HTML names the bundled fonts first. A resume printed on a Mac with them breaks every line where the original engine's Windows PDF did. When the templates became data, Classic and Minimal kept printing the same pages, checked against the code they replaced.

Run `pnpm test` in this folder, or `pnpm check` from the repo root.
