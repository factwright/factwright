/** How the terminal marks what the user pastes. */
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/**
 * What starts a terminal's code. A paste is only text, so these come out of it, and nothing in it
 * can end it early or drop out from ahead of a "!".
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are what it's there to find
const CODE_START = /[\x1b\x80-\x9f]/g;

/** How the terminal says the window lost or got the keyboard, which changes nothing in the box. */
const FOCUS = new Set(['\x1b[I', '\x1b[O']);

/**
 * A terminal's code at the start of some text: a key such as an arrow or Delete, a reply such as
 * its title, or ESC on its own, with the letter of an Alt key if there's one.
 */
const CODE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal's codes start with ESC
  /^\x1b(?:\[[0-9;:<=>?]*[ -/]*[@-~]|O[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|P[^\x1b]*(?:\x1b\\)?|[a-zA-Z0-9\x7f]?)/;

/**
 * Keeps Claude Code's shell mode from starting in a run's terminal. A "!" first in its input box
 * starts it, so the app drops a "!" that would be first, and what follows reaches Claude as words.
 *
 * The app can't see the box, only the keys, so it goes by whether a character has just gone in
 * ahead of the cursor. Any key it can't follow, such as an arrow, Home, Esc, Backspace or Ctrl-W,
 * counts as none, so a "!" after one is dropped wherever it lands. A "!" dropped by mistake costs
 * the user one character.
 *
 * It can't see what Claude Code itself does with a key, its own questions, or its history, so this
 * is there for slips, not someone set on a shell.
 */
export class ShellGuard {
  /** Whether a character has just gone in ahead of the cursor. If not, a "!" could be first. */
  private afterText = false;

  /** What Claude Code gets of what the user typed or pasted. */
  pass(data: string): string {
    let kept = '';
    let rest = data;
    while (rest) {
      // The terminal hands over a paste in one piece, so the last mark is the one that ends it.
      if (rest.startsWith(PASTE_START)) {
        const end = rest.lastIndexOf(PASTE_END);
        const stop = end < 0 ? rest.length : end;
        kept += `${PASTE_START}${this.pasted(rest.slice(PASTE_START.length, stop))}${PASTE_END}`;
        rest = rest.slice(stop + PASTE_END.length);
        continue;
      }
      const code = CODE.exec(rest)?.[0];
      if (code) {
        kept += code;
        rest = rest.slice(code.length);
        if (!FOCUS.has(code)) this.afterText = false;
        continue;
      }
      const char = String.fromCodePoint(rest.codePointAt(0) as number);
      rest = rest.slice(char.length);
      // Enter sends what's in the box, Ctrl-C and Ctrl-U clear it, Ctrl-A moves to its start, and
      // Tab and Backspace may change more of it than one character.
      if (char < ' ' || char === '\x7f') {
        this.afterText = false;
        kept += char;
        continue;
      }
      if (char === '!' && !this.afterText) continue;
      // First in the box, a "?" opens Claude Code's list of shortcuts rather than going in.
      if (char !== '?') this.afterText = true;
      kept += char;
    }
    return kept;
  }

  /** What Claude Code gets of a paste: its text, with no "!" that would be first. */
  private pasted(paste: string): string {
    const text = paste.replace(CODE_START, '');
    const words = this.afterText ? text : text.replace(/^!+/, '');
    if (words) this.afterText = true;
    return words;
  }
}
