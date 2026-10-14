# Contributing to Factwright

Thanks for your interest. Factwright is in beta, so here's what's open right now.

## What's open
- **Issues: yes.** Bug reports and ideas are welcome. Use the templates when you open one.
- **Pull requests: not yet.** They'll open once the contribution terms are settled, and this page will say so.
- **Security problems:** please don't open an issue. Follow [SECURITY.md](SECURITY.md).

Keep your personal details (resume, fact bank, job hunt) out of issues. Made-up examples work just as well.

## Working on the code
You need Node.js 24 or newer and pnpm.

```bash
pnpm install
pnpm check   # format, lint, typecheck and test
pnpm fix     # apply formatting and safe lint fixes
```

End-to-end tests drive the built desktop app with Playwright, on a made-up job hunt, with a stand-in for Claude Code:

```bash
pnpm --filter @factwright/desktop build
pnpm --filter @factwright/desktop e2e
```

## Standards
Two rules hold for everything in this repo:

1. **The UI is elegant, polished and easy to understand.**
   - Plain words on screen, and every state designed: empty, loading, error and success.
   - Light and dark mode, and it works with a keyboard and a screen reader.
   - UI changes come with screenshots in both modes, at small and large window sizes.
2. **The repo stays clean and well organized.**
   - Small, focused files and consistent names.
   - Strict TypeScript, with tests for logic.
   - No dead code or stray files, and a README in every folder.

Also:
- Changes land through pull requests with clear titles.
- No secrets or personal data, ever.
- Factwright never reads, stores or passes Claude credentials. Changes that would are out of scope.
