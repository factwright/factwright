# Changelog

Notable changes to Factwright, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions will follow [Semantic Versioning](https://semver.org/) once releases begin.

## Unreleased

### Added
- Project skeleton: workspace layout, tooling, CI and project docs.
- `@factwright/core`: job tracker statuses, matching keys for company and role names, date checks and pay parsing.
- Secret scanning in CI: TruffleHog checks every push and pull request for leaked keys, and can scan the whole history on demand.
