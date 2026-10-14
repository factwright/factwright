# Security policy

Factwright holds career history, pay and personal contacts, and it runs an AI agent on your computer. Security reports get priority.

## Reporting a problem
Please report security problems privately, not as public issues:
- **Preferred:** [report a vulnerability](https://github.com/factwright/factwright/security/advisories/new) through GitHub.
- **Or email** hello@neatifai.com with "Factwright security" in the subject.

You'll hear back within a week, with updates until it's resolved.

## Supported versions
Fixes go into the newest release, and installed copies update to it on their own. Reports should be about the newest release, or the `main` branch.

## Scope
In scope:
- the desktop app, including how it launches and limits Claude Code
- the sync server and the separation between accounts
- the end-to-end encryption design and its implementation

Out of scope:
- Claude Code itself. Report those to [Anthropic](https://www.anthropic.com/responsible-disclosure-policy).
- problems that need an already compromised computer

The design is described in [docs/security.md](docs/security.md).
