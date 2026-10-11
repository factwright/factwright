import { FONT_FILES } from '@factwright/engine';
import { expect, it } from 'vitest';
import { RESUME_FONTS } from './fonts.ts';

it('builds every resume font into the app as a WOFF2 data: URL', () => {
  expect(Object.keys(RESUME_FONTS).sort()).toEqual([...FONT_FILES].sort());
  for (const file of FONT_FILES) {
    const url = RESUME_FONTS[file] ?? '';
    expect(url).toMatch(/^data:font\/woff2;base64,/);
    const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(bytes.length).toBeGreaterThan(10_000);
  }
});
