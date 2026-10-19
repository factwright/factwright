import { describe, expect, it } from 'vitest';
import { FIRST_RUN_SCREENS, plainText, ScreenWatch, TRUST_QUESTION } from './screen.ts';

// Claude Code 2.1.302's screens, as it draws them: it moves the cursor between words, rather than
// printing spaces.
const THEME =
  "\x1b[2GLet's\x1b[8Gget\x1b[12Gstarted.\r\r\n\r\r\n\x1b[2G\x1b[1mChoose\x1b[9Gthe\x1b[13Gtext\x1b[18Gstyle\x1b[24Gthat\x1b[29Glooks\x1b[35Gbest\x1b[40Gwith\x1b[45Gyour\x1b[50Gterminal\x1b[22m\r\r\n";
const API_KEY =
  ' \x1b[38;5;220m\x1b[1mDetected a custom API key in your environment\x1b[22m\x1b[39m\x1b[K\r\x1b[1C\x1b[1B Do\x1b[6Gyou want to\x1b[18Guse\x1b[22Gthis\x1b[27GAPI\x1b[31Gkey?';
const SECURITY =
  '\x1b[1mSecurity notes:\r\x1b[1B\x1b[22m\x1b[K\r\x1b[1C\x1b[1B\x1b[38;5;246m1.\x1b[39m Claude can make mistakes.\x1b[K\r\x1b[1C\x1b[2B\x1b[38;5;246m2.\x1b[39m Due to prompt injection risks, only use it with code you trust';
const TERMINAL_SETUP =
  "\x1b[2G\x1b[1mUse\x1b[6GClaude\x1b[13GCode's\x1b[20Gterminal\x1b[29Gsetup?\x1b[22m\r\r\n";
const TRUST =
  '\x1b[2GQuick\x1b[8Gsafety\x1b[15Gcheck:\x1b[22GIs\x1b[25Gthis\x1b[30Ga\x1b[32Gproject\x1b[40Gyou\x1b[44Gcreated\x1b[52Gor\x1b[55Gone\x1b[59Gyou\x1b[63Gtrust?';

describe('plainText', () => {
  it('drops colors, cursor moves, titles and links', () => {
    expect(plainText('\x1b]0;claude\x07\x1b[1;34mHello\x1b[0m\x1b[2K world')).toBe(
      ' Hello   world',
    );
  });
});

describe('FIRST_RUN_SCREENS', () => {
  it.each([
    ['how its text should look', THEME],
    ['an API key in the environment', API_KEY],
    ['its security notes', SECURITY],
    ['its terminal setup', TERMINAL_SETUP],
  ])('sees %s', (_, screen) => {
    expect(FIRST_RUN_SCREENS.test(plainText(screen))).toBe(true);
  });

  it('tells them from the question about trust, which comes after them', () => {
    expect(FIRST_RUN_SCREENS.test(plainText(TRUST))).toBe(false);
    expect(TRUST_QUESTION.test(plainText(TRUST))).toBe(true);
    // The security notes say to use it with code you trust, which isn't the question.
    expect(TRUST_QUESTION.test(plainText(SECURITY))).toBe(false);
  });
});

describe('ScreenWatch', () => {
  it('sees the question about trust once, even when it arrives in pieces with colors', () => {
    const watch = new ScreenWatch(TRUST_QUESTION);
    expect(
      watch.saw('\x1b[1mQuick safety check:\x1b[22m Is this a project you created or one '),
    ).toBe(false);
    expect(watch.saw('you \x1b[2mtrust?\x1b[0m')).toBe(true);
    expect(watch.saw('Yes, I trust this folder')).toBe(false);
  });

  it('sees it at the start of one big piece of output, with a long redraw after it', () => {
    const watch = new ScreenWatch(TRUST_QUESTION);
    expect(watch.saw(`Do you trust the files in this folder?${'\x1b[2K'.repeat(5000)}`)).toBe(true);
  });

  it('sees each first-run screen as it comes, once the user answers the one before', () => {
    const watch = new ScreenWatch(FIRST_RUN_SCREENS);
    expect(watch.saw(THEME.slice(0, 60))).toBe(false);
    expect(watch.saw(THEME.slice(60))).toBe(true);
    // Moving through its choices redraws it, which is the same screen.
    expect(watch.saw(THEME)).toBe(false);
    watch.answered();
    expect(watch.saw(SECURITY)).toBe(true);
    watch.answered();
    // Then the question about trust, which isn't one of them.
    expect(watch.saw(TRUST)).toBe(false);
  });

  it('stops watching once the run sends a hook, answered or not', () => {
    const watch = new ScreenWatch(TRUST_QUESTION);
    watch.pastIt();
    expect(watch.saw('Do you trust the files in this folder?')).toBe(false);
    const firstRun = new ScreenWatch(FIRST_RUN_SCREENS);
    expect(firstRun.saw(THEME)).toBe(true);
    firstRun.pastIt();
    firstRun.answered();
    expect(firstRun.saw(SECURITY)).toBe(false);
  });
});
