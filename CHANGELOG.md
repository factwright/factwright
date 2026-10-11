# Changelog

Notable changes to Factwright, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions will follow [Semantic Versioning](https://semver.org/) once releases begin.

## Unreleased

### Added
- Project skeleton: workspace layout, tooling, CI and project docs.
- `@factwright/core`: job tracker statuses, matching keys for company and role names, date checks and pay parsing.
- Secret scanning in CI: TruffleHog checks every push and pull request for leaked keys, and can scan the whole history on demand.
- Desktop app groundwork: finding the user's Claude Code, checking its version and sign-in, and building its locked-down launch command.
- `@factwright/ui`: the design system. Colors for light and dark are checked against WCAG AA. The first components are buttons, status pills, fit badges, Claude's run status, the views switcher, search, sidebar items, stats and notices, with a gallery page to see them all.
- `@factwright/core`: fit tiers, from strong to skip.
