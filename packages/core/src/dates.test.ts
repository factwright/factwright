import { describe, expect, it } from 'vitest';
import { isIsoDate } from './dates.ts';

describe('isIsoDate', () => {
  it.each(['2026-10-10', '2024-02-29'])('accepts %s', (value) => {
    expect(isIsoDate(value)).toBe(true);
  });

  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '10/10/2026', '2026-1-1', '', 20261010, null])(
    'rejects %j',
    (value) => {
      expect(isIsoDate(value)).toBe(false);
    },
  );
});
