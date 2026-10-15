# Starter files

The files a new workspace starts with. When a user hands their answers to Claude for the first time, the app copies each one that's missing into their workspace, at the same path. It never replaces one that's there, so nothing the user or Claude has changed is lost. Claude can't read this folder itself (it only reads the workspace), which is why the app copies them.

| File | What it is |
|---|---|
| [`guide/rules.md`](guide/rules.md) | The binding rules every resume, cover letter, answer and message follows, with room for the user's own |
| [`guide/writing.md`](guide/writing.md) | How to write and tailor a strong resume, and how each template fits |
| [`guide/styles/`](guide/styles) | Who reads a resume at a startup, an established company or a public employer, and what they reward |
| [`guide/preferences.md`](guide/preferences.md) | Where the user's feedback becomes nudges, empty at first |
| [`guide/lint.json`](guide/lint.json) | The checks the resume builder runs, such as words that never belong on a resume. The app adds the page count from the user's choice |
| [`guide/confidential-terms.txt`](guide/confidential-terms.txt) | The names that must never reach an employer, empty at first |
| [`facts/README.md`](facts/README.md) | The fact bank's files, its claim format and tags, and its rules |

Nothing here is about any one person. What's about the user comes from them, through the app and their Claude.
