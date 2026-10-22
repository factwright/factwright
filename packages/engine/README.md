# Resume engine

Turns resume and cover letter data into finished files, and checks them before they're sent. It runs anywhere JavaScript runs, like [`@factwright/core`](../core): the desktop app prints the PDF and saves the files.

| Module | What it does |
|---|---|
| `schema` | The resume data a job's `resume.json` holds, and `readResume`, which names each problem in plain words |
| `letter` | The cover letter a job's `cover-letter.json` holds: its header, the same as the resume's, then the date, who it's to and the letter. `readLetter` names each problem in plain words |
| `templates` and [`built-in`](src/built-in) | What a template is, and the two the app comes with, Classic and Minimal |
| [`template`](src/template) | Templates as data: Mustache's syntax, filled in from a view of the resume; the checks a template passes before it's used; and reading and writing a template's file |
| `html` | The resume, or its cover letter, as a Letter-size page in a template, ready to print to PDF. It loads nothing from anywhere else |
| `fonts` | The [fonts](fonts) a resume carries: open fonts drawn to the widths of the Windows fonts the templates were designed with, so a resume looks the same and breaks its lines in the same places on a Mac as on Windows |
| `docx` | The resume as a single-column Word file that applicant systems read well, in its template's fonts and colors, through the [`docx`](https://github.com/dolanmiu/docx) library, and its bytes, ready to save. The cover letter too, under the same header |
| `lint` | The user's rules from `guide/lint.json` (banned wording, exact titles, counts, card length), placeholders left in, and confidential terms that must never reach an employer. A cover letter is also checked for the clichés that mark one as one of thousands, such as "To whom it may concern" |
| `fit` | A script that measures each piece of text on the page, or each paragraph of a letter, and a report that marks runts: text that wraps with only a word or two on its last line |
| `files` | The files' name, and a PDF's page count |

The templates the app comes with:

| Template | Look |
|---|---|
| `classic` | Traditional and all serif, in black and white (the default) |
| `minimal` | Lots of white space, gray headings and no color |

A user can have templates of their own too, kept as files in their workspace's `templates/` folder: one someone shared, or one Claude made in the look of a resume they like. A template is data: its look in a sentence, the font files it carries, what it calls each section, its look in Word, its styles, and its page's markup in [Mustache's syntax](https://mustache.github.io/mustache.5.html), which the engine fills in from the resume (see [`template/view.ts`](src/template/view.ts) for what it can show). Its file is JSON, with `"factwright": "resume-template"` and a version, and its name gives its ID, which a resume's `layout` names.

A template can lay out a cover letter too, in its `letter`: styles of its own, added to the template's, and markup that can show the template's parts, so a letter's header is the resume's. Classic's and Minimal's do. A letter in a template without one prints plainly: the name, headline and contact details over the letter, in the fonts and colors its Word look names, and none of its styles, which may lay a page out in ways a letter can't follow, such as a side column. Each is the open font that stands in for it, when the template carries one, so the letter matches the resume's PDF. Otherwise it's the font itself, and on a computer without it, such as Garamond on a Mac, the template's own font of the same kind, if it carries one. A file with a letter is version 2, and one without is still written as version 1, which earlier versions of the app read.

A template can come from anywhere, so `readTemplate` checks one before it's used, and says what's wrong in plain words:
- **Markup:** only elements for text, such as div, section, h2, ul and table, with attributes such as class, style and data-*, each in double quotes. Nothing that runs a script, loads a file or takes input, no HTML comments, and no "<" inside quotes.
- **Values:** they go between tags or inside an attribute's quotes, where they show as plain text, and each one is escaped, so no resume can add markup. A section starts and ends in the same place.
- **Styles:** read with their escapes undone, they can't hold "<", so they can't end the stylesheet. They load nothing: no `@import`, `url()` only for a data: picture (PNG, JPEG, GIF or WebP) or a WOFF2 font, and no `image-set()`, `attr()` and the like.
- **No words of its own:** the markup's own text, and strings that print, such as `content`'s, hold only marks such as · or |. Every word on the page comes from the resume or the template's titles (summary, competencies, experience, education and skills, plus highlights and contact for templates that head those).
- **Names:** every name the markup shows is part of a resume, so a typo is caught rather than showing nothing.

The page itself carries a policy that runs no scripts and loads nothing from elsewhere, and the app prints it in a hidden, sandboxed window that loads nothing but the page.

Every template the app comes with shows the same parts of a resume, so a resume can change its look without changing its text. A template of the user's own can have no place for some, such as the band of numbers or the highlight cards, when the resume it copies has none: `templateHasNoPlaceFor` names them, and `partsLeftOut` names the ones a resume holds that its template wouldn't show, so the resume can leave them out and look like its template. Any text can hold `**bold**`, and `[[placeholders]]`, which lint refuses so none ship by accident. A resume can name its own headings: `systems_heading` over the highlight cards (otherwise "Key Systems"), `projects_heading` (otherwise "Independent Projects") and `skills_heading` (otherwise the template's own). Education comes after the experience, or first with `education_first`, as early in a career it says the most.

```ts
import {
  builtInTemplate,
  letterDocument,
  lintLetter,
  lintResume,
  readLetter,
  readResume,
  readTemplate,
  renderHtml,
  renderLetterHtml,
  resumeDocument,
} from '@factwright/engine';

const read = readResume(JSON.parse(text));
// One the app comes with, or the user's own, checked: readTemplate says what's wrong with one.
const own = readTemplate(JSON.parse(file), 'navy-sidebar');
const template = own.ok ? own.template : builtInTemplate('classic');
if (read.ok && template) {
  const html = renderHtml(read.resume, template, fonts); // print to PDF; fonts are data: URLs
  const doc = resumeDocument(read.resume, template); // pack with docx's Packer
  const problems = lintResume(read.resume, rules, confidentialTerms);
}

// Its cover letter, in the same template, so the two look like a set.
const letter = readLetter(JSON.parse(letterText));
if (letter.ok && template) {
  const page = renderLetterHtml(letter.letter, template, fonts); // one page
  const word = letterDocument(letter.letter, template);
  const issues = lintLetter(letter.letter, rules, confidentialTerms);
}
```

It was ported from the original repo's engine, and gave the same HTML and Word files for every resume in it. Since then, the HTML names the bundled fonts first. A resume printed on a Mac with them breaks every line where the original engine's Windows PDF did. When the templates became data, Classic and Minimal kept printing the same pages, checked against the code they replaced.

Run `pnpm test` in this folder, or `pnpm check` from the repo root.
