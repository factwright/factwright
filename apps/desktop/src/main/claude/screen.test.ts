import { describe, expect, it } from 'vitest';
import { plainText, TrustWatch } from './screen.ts';

describe('plainText', () => {
  it('drops colors, cursor moves, titles and links', () => {
    expect(plainText('\x1b]0;claude\x07\x1b[1;34mHello\x1b[0m\x1b[2K world')).toBe(
      ' Hello   world',
    );
  });
});

describe('TrustWatch', () => {
  it('sees the question about trust once, even when it arrives in pieces with colors', () => {
    const watch = new TrustWatch();
    expect(
      watch.saw('\x1b[1mQuick safety check:\x1b[22m Is this a project you created or one '),
    ).toBe(false);
    expect(watch.saw('you \x1b[2mtrust?\x1b[0m')).toBe(true);
    expect(watch.saw('Yes, I trust this folder')).toBe(false);
  });

  it('sees it at the start of one big piece of output, with a long redraw after it', () => {
    const watch = new TrustWatch();
    expect(watch.saw(`Do you trust the files in this folder?${'\x1b[2K'.repeat(5000)}`)).toBe(true);
  });

  it('stops watching once the run sends a hook', () => {
    const watch = new TrustWatch();
    watch.pastIt();
    expect(watch.saw('Do you trust the files in this folder?')).toBe(false);
  });
});
