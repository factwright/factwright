/**
 * The question Claude Code asks once, the first time it opens a folder: whether to trust it.
 * Screen codes can fall between its words, so any spacing counts.
 */
export const TRUST_QUESTION = /trust\s+this\s+folder|one\s+you\s+trust|trust\s+the\s+files/i;

/**
 * The screens Claude Code shows each time it opens, until someone presses Enter through them
 * once: how its text should look, whether to use an API key it found in the environment, its
 * security notes, and its terminal setup. Signing in with `claude auth login` doesn't mark them
 * done. They come before the question about trust.
 */
export const FIRST_RUN_SCREENS =
  /choose\s+the\s+text\s+style|detected\s+a\s+custom\s+api\s+key|security\s+notes\s*:|claude\s+code.s\s+terminal\s+setup/i;

// biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal's title and link codes start with ESC
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal's color and cursor codes start with ESC
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Terminal output as plain text, without its colors and cursor moves. */
export const plainText = (text: string) => text.replace(OSC, '').replace(CSI, ' ');

/**
 * Watches a run's output for a screen that waits on the user, such as the question about trust,
 * until the run sends its first hook, which means Claude Code is past it. Says so once, or once
 * more after each answer, for screens that come one after another.
 */
export class ScreenWatch {
  private readonly pattern: RegExp;
  private screen = '';
  /** Whether it's said so, and the user hasn't answered since. */
  private shown = false;
  private past = false;

  constructor(pattern: RegExp) {
    this.pattern = pattern;
  }

  /** Takes more output. True the moment the screen shows. */
  saw(data: string): boolean {
    if (this.shown || this.past) return false;
    // Checked before trimming, so a big chunk can't push the screen out unseen.
    const seen = this.screen + data;
    this.screen = seen.slice(-8000);
    if (!this.pattern.test(plainText(seen))) return false;
    this.shown = true;
    return true;
  }

  /** The user answered the screen, so it watches the output after it for another. */
  answered(): void {
    if (!this.shown) return;
    this.shown = false;
    this.screen = '';
  }

  /** The run sent a hook, so it's past the screens. */
  pastIt(): void {
    this.past = true;
  }
}
