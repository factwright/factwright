# Claude Code plugin

What Factwright loads into each Claude Code run, through Claude Code's own `--plugin-dir` flag:
- **Skills:** fit check, tailored resume, application answers, interview prep and more.

The app passes the rest with each run:
- **Tools:** the ones Claude uses instead of a shell, such as saving a posting. The app serves them over MCP on this computer ([`apps/desktop/src/main/tools`](../apps/desktop/src/main/tools)), so the skills call them by name, such as `find_job`.
- **Hooks:** they tell the app when Claude finishes or needs you.
- **Settings:** they keep the run locked down.

All of it applies to that run only. Your own Claude Code settings are never changed.

**Status:** in progress, in phase 3 of the [roadmap](../docs/roadmap.md). The manifest is here, so Claude Code loads the plugin, and the app's tools are ready. The skills come next.
