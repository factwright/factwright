import { describe, expect, it } from 'vitest';
import { dateRanges, formOf, readable, singleDates } from './dates.ts';

describe('formOf', () => {
  it('knows the forms parsers read', () => {
    expect(
      ['04/2021', '4/2021', '2021-04', 'Apr 2021', 'April, 2021', 'Sept. 2019'].map(formOf),
    ).toEqual(Array(6).fill('month-year'));
    expect(formOf('2016')).toBe('year');
    expect(['Present', 'current', 'Now', 'to date'].map(formOf)).toEqual(Array(4).fill('now'));
  });

  it('knows the forms they miss', () => {
    expect(formOf('Summer 2019')).toBe('season');
    expect(formOf('Q3 2020')).toBe('quarter');
    expect(['’19', "'19", 'Jun ’19', '06/19'].map(formOf)).toEqual(Array(4).fill('short-year'));
  });
});

describe('dateRanges', () => {
  it('finds spans with any dash, or a word', () => {
    expect(dateRanges('Staff Engineer 03/2022 – Present').map((range) => range.text)).toEqual([
      '03/2022 – Present',
    ]);
    expect(dateRanges('Jan 2019 to Mar 2021')[0]).toMatchObject({
      start: 'Jan 2019',
      end: 'Mar 2021',
    });
    expect(dateRanges('2019-2021')[0]).toMatchObject({ start: '2019', end: '2021' });
    expect(dateRanges('2019 — current')[0]?.end).toBe('current');
  });

  it('isn’t fooled by numbers that aren’t dates', () => {
    expect(dateRanges('Cut the time from 9 days to 3, for 200+ stores')).toEqual([]);
    expect(dateRanges('(555) 014-2387')).toEqual([]);
  });

  it('says whether a span reads', () => {
    const [good, bad] = [
      dateRanges('06/2018 – 03/2021')[0],
      dateRanges('Summer 2019 – Fall 2020')[0],
    ];
    expect(good && readable(good)).toBe(true);
    expect(bad && readable(bad)).toBe(false);
  });
});

describe('singleDates', () => {
  it('finds dates on their own, outside any span', () => {
    expect(singleDates('B.S., Economics 2016')).toEqual(['2016']);
    expect(singleDates('MBA 2018 – 2020')).toEqual([]);
  });
});
