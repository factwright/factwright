# @factwright/core

Shared logic for the desktop app, the web view and the sync server. It runs anywhere JavaScript runs, with no Node or browser APIs.

| Module | What it does |
|---|---|
| `tracker` | Job statuses, call types, and how far along each status is |
| `keys` | Matching keys, so "Acme, Inc." and "The Acme Company" count as one company |
| `pay` | Reads an annual pay range from posting text such as "$150-200k" or "$70-$85 an hour" |
| `dates` | Checks `YYYY-MM-DD` calendar dates |

The sync protocol and the encryption will live here too.

```ts
import { companyKey, parsePay } from '@factwright/core';

companyKey('The Acme Company (US)'); // 'acme'
parsePay('$70-$85 an hour'); // { min: 145600, max: 176800 }
```

Run `pnpm test` in this folder, or `pnpm check` from the repo root.
