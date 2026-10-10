# Sync server

A Cloudflare Worker that handles sign-in and keeps each account's encrypted data:
- one private store per account, in a Durable Object with its own database
- encrypted files in R2, in a folder per account
- the account always comes from the verified session, never from the request

It only ever sees encrypted data. See [docs/security.md](../../docs/security.md).

**Status:** not started. It comes in phase 4 of the [roadmap](../../docs/roadmap.md).
