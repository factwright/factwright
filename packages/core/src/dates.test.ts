import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, firstDate, isIsoDate, localDate } from './dates.ts';

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

describe('firstDate', () => {
  it('finds the first date in the text', () => {
    expect(firstDate('Checked Oct 7 (2026-10-07), again 2026-10-09')).toBe('2026-10-07');
  });

  it.each(['Oct 7', '', null, undefined])('returns null for %j', (value) => {
    expect(firstDate(value)).toBeNull();
  });
});

describe('localDate', () => {
  it('writes the local calendar date', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('addDays', () => {
  it('moves a date by whole days, across months, years and clock changes', () => {
    expect(addDays('2026-10-10', 7)).toBe('2026-10-17');
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-10-10', -10)).toBe('2026-09-30');
  });
});

describe('daysBetween', () => {
  it('counts whole days, across months and clock changes', () => {
    expect(daysBetween('2026-10-09', '2026-10-10')).toBe(1);
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(daysBetween('2026-10-10', '2026-10-03')).toBe(-7);
  });
});
