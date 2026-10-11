/**
 * The question Claude Code asks once, the first time it opens a folder: whether to trust it.
 * Screen codes can fall between its words, so any spacing counts.
 */
export const TRUST_QUESTION = /trust\s+this\s+folder|one\s+you\s+trust|trust\s+the\s+files/i;

// biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal's title and link codes start with ESC
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal's color and cursor codes start with ESC
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Terminal output as plain text, without its colors and cursor moves. */
export const plainText = (text: string) => text.replace(OSC, '').replace(CSI, ' ');

/**
 * Watches a run's output for the trust question, until the run sends its first hook, which
 * means Claude Code is past it. Says so once.
 */
export class TrustWatch {
  private screen = '';
  private done = false;

  /** Takes more output. True the moment the trust question shows. */
  saw(data: string): boolean {
    if (this.done) return false;
    // Checked before trimming, so a big chunk can't push the question out unseen.
    const seen = this.screen + data;
    this.screen = seen.slice(-8000);
    if (!TRUST_QUESTION.test(plainText(seen))) return false;
    this.done = true;
    return true;
  }

  /** The run sent a hook, so it's past any question about trust. */
  pastIt(): void {
    this.done = true;
  }
}
