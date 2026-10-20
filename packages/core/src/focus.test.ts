import { describe, expect, it } from 'vitest';
import { focusName, isFocused, NO_FOCUS, payAmount, readFocus, type SearchFocus } from './focus.ts';

const FOCUS: SearchFocus = {
  stages: ['early', 'growing'],
  payMin: 150_000,
  payMax: 200_000,
  workplaces: ['remote'],
  industries: ['Healthcare'],
  avoid: ['Crypto', 'Gambling'],
  posted: 14,
  notes: 'Founding engineer roles.',
};

describe('readFocus', () => {
  it('takes a focus as the dialog sends it, in the lists’ own order', () => {
    expect(readFocus({ ...FOCUS, stages: ['growing', 'early'] })).toEqual(FOCUS);
    expect(readFocus(NO_FOCUS)).toEqual(NO_FOCUS);
    // Notes are trimmed, an industry given twice is kept once, and a newer field is passed over.
    expect(
      readFocus({
        ...FOCUS,
        notes: '  Founding engineer roles.\n',
        avoid: ['Crypto', 'crypto', 'Gambling'],
        later: true,
      }),
    ).toEqual(FOCUS);
  });

  it('refuses anything else', () => {
    for (const bad of [
      null,
      [],
      'early startups',
      { ...FOCUS, stages: ['seed'] },
      { ...FOCUS, stages: ['early', 'early'] },
      { ...FOCUS, workplaces: 'remote' },
      { ...FOCUS, payMin: 250_000 },
      { ...FOCUS, payMax: 150_000.5 },
      { ...FOCUS, payMin: -1 },
      { ...FOCUS, payMax: 20_000_000 },
      { ...FOCUS, posted: 5 },
      { ...FOCUS, industries: ['Health\ncare'] },
      { ...FOCUS, industries: ['x'.repeat(61)] },
      { ...FOCUS, avoid: Array.from({ length: 11 }, (_, i) => `Industry ${i}`) },
      { ...FOCUS, notes: 'x'.repeat(501) },
      { ...FOCUS, notes: undefined },
    ]) {
      expect(readFocus(bad)).toBeNull();
    }
  });
});

describe('focusName', () => {
  it('names a focus in a few words, for Found by', () => {
    expect(focusName(FOCUS)).toBe(
      'early startups, growing startups, $150k–$200k, remote, past 2 weeks',
    );
    expect(focusName({ ...NO_FOCUS, stages: ['big'], payMin: 1_250_000 })).toBe(
      'big companies, $1.3m and up',
    );
    expect(focusName({ ...NO_FOCUS, payMax: 90_000, workplaces: ['hybrid', 'onsite'] })).toBe(
      'up to $90k, hybrid, on-site',
    );
    // What the user wrote stays out of it.
    expect(focusName({ ...NO_FOCUS, industries: ['Climate'], notes: 'Small teams.' })).toBe('');
  });
});

describe('isFocused and payAmount', () => {
  it('tell a focus from none, and read pay as the user types it', () => {
    expect(isFocused(NO_FOCUS)).toBe(false);
    expect(isFocused({ ...NO_FOCUS, notes: ' ' })).toBe(false);
    expect(isFocused({ ...NO_FOCUS, posted: 7 })).toBe(true);
    expect(['150k', '$150,000', '150000', '150K'].map(payAmount)).toEqual(Array(4).fill(150_000));
    expect(['', 'lots', '$150k–$200k'].map(payAmount)).toEqual([null, null, null]);
  });
});
