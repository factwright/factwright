# @factwright/core

Shared logic for the desktop app, the web view and the sync server. It runs anywhere JavaScript runs, with no Node or browser APIs.

| Module | What it does |
|---|---|
| `records` | Reads what the skills saved in the workspace: the fit check log, each job's folder, job searches, salary and employer checks, and drafted messages |
| `jobs` | Folds those records into one job each, matching them by the job's own link or by role, and keeps known jobs' IDs |
| `fit-report` | Reads a fit check's write-up: the score's parts with their evidence, and what people say about the company |
| `tracker` | Job statuses, calls, the status a job shows, and how far along each status is |
| `keys` | Matching keys, so "Acme, Inc." and "The Acme Company" count as one company |
| `links` | Tidies links for matching, and tells a job's own link from a careers page |
| `markdown` | Reads the tables, sections and lists the skills write |
| `pay` | Reads an annual pay range from posting text such as "$150-200k" or "$70-$85 an hour" |
| `dates` | Checks `YYYY-MM-DD` calendar dates, and gives the user's own date |

It reads the workspace through a small interface, so the desktop app reads files on disk and tests use a few files in memory. The sync protocol and the encryption will live here too.

```ts
import { collectJobs, companyKey, parsePay, readRecords } from '@factwright/core';

companyKey('The Acme Company (US)'); // 'acme'
parsePay('$70-$85 an hour'); // { min: 145600, max: 176800 }
const jobs = collectJobs(readRecords(workspace), knownJobs);
```

Run `pnpm test` in this folder, or `pnpm check` from the repo root.
