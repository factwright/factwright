/**
 * Text longer than this, in characters, reaches Claude in a file of its own rather than typed into
 * Claude Code: a reply from a run's bar, or what's pasted into its terminal. On Windows, Claude
 * Code can lose part of long text that comes in at once, such as a posting's first half, without a
 * word to the user or to Claude.
 */
export const LONG_TEXT = 400;
