# @factwright/sync

End-to-end encryption and the sync protocol, shared by the desktop app, the web view and the sync server. Everything to do with keys is here, in one place to review. The design is in [docs/security.md](../../docs/security.md).

It uses only Web Crypto, so the same code runs in Node, browsers and Workers.

| Module | What it does |
|---|---|
| `keys` | The account key and the four keys made from it, the recovery key, link codes for adding a device, and locking with AES-256-GCM |
| `approve` | Approving a new device from one that's set up: one-time keys, the commitment, the emoji check, and sealing the account key for the new device |
| `emoji` | The 64 emoji a check code is shown as, with their names |
| `seal` | Record and file IDs, and locking each version of a record and each file's contents |
| `record` | What a record says once opened: a file in the workspace, or a row in the tracker, with checks before anything acts on one |
| `merge` | Merges two devices' changes to the same row: lists and notes keep both, and the later change wins a clash |
| `protocol` | What devices and the server send each other, the IDs' formats, and the limits |
| `client` | Talks to the sync server, and says why a request failed |
| `code` | Writes keys and codes as characters people can type, without letters they'd misread |
| `bytes` | URL-safe base64, UTF-8 and random bytes |

```ts
import { accountKeys, newAccountKey, recordId, sealRecord, utf8 } from '@factwright/sync';

const keys = await accountKeys(newAccountKey());
const id = await recordId(keys, 'row:jobs:acme--staff-engineer');
const data = await sealRecord(keys, id, 1, utf8('{"status":"applied"}'));
```
