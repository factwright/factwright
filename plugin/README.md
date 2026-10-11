# Claude Code plugin

What Factwright loads into each Claude Code run, through Claude Code's own `--plugin-dir` flag:
- **Skills:** fit check, tailored resume, application answers, interview prep and more.
- **MCP server:** the tools Claude uses instead of a shell, from saving a posting to rendering a resume.

The app passes the rest with each run: hooks that tell it when Claude finishes or needs you, and settings that keep the run locked down. All of it applies to that run only. Your own Claude Code settings are never changed.

**Status:** in progress, in phase 3 of the [roadmap](../docs/roadmap.md). The manifest is here, so Claude Code loads the plugin. The skills and the MCP server come next.
