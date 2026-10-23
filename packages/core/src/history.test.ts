import { describe, expect, it } from 'vitest';
import { monthNames, positionsOf, readHistory, typedDate, yearOf } from './history.ts';

describe('the work history Profile keeps', () => {
  it('keeps several positions at one company apart, each with its own title and dates', () => {
    const history = readHistory({
      jobs: [
        {
          company: 'Tidewater Analytics',
          location: 'Denver, CO',
          positions: [
            { title: 'Director of Product', start: '2023-04', end: 'present', summary: 'Runs it.' },
            { title: 'Senior Product Manager', start: '2021-03', end: '2023-04' },
            { title: 'Product Manager', start: '2019', end: '2021-03' },
          ],
        },
      ],
      schools: [{ school: 'CU Boulder', degree: 'B.S.', field: 'Computer Science', end: '2017' }],
    });
    expect(
      positionsOf(history).map((each) => [each.company, each.title, each.start, each.end]),
    ).toEqual([
      ['Tidewater Analytics', 'Director of Product', '2023-04', 'present'],
      ['Tidewater Analytics', 'Senior Product Manager', '2021-03', '2023-04'],
      ['Tidewater Analytics', 'Product Manager', '2019', '2021-03'],
    ]);
    expect(history.schools).toEqual([
      { school: 'CU Boulder', degree: 'B.S.', field: 'Computer Science', start: '', end: '2017' },
    ]);
  });

  it('leaves out what doesn’t hold up, and keeps the rest', () => {
    const history = readHistory({
      jobs: [
        { company: '', positions: [{ title: 'Nobody’s' }] },
        { company: 'Fernway', positions: [] },
        { company: 'Acme', positions: [{ title: 'PM', start: 'March 2021', end: '2021-13' }, 'x'] },
      ],
      schools: [{ degree: 'B.A.' }, 7],
    });
    expect(history.jobs).toEqual([
      {
        company: 'Acme',
        location: '',
        positions: [{ title: 'PM', start: '', end: '', summary: '' }],
      },
    ]);
    expect(history.schools).toEqual([]);
    expect(readHistory('not a file')).toEqual({ jobs: [], schools: [] });
  });

  it('gives a date as forms ask for it', () => {
    expect(monthNames('2021-03')).toEqual(['March', 'Mar', '03', '3']);
    expect(monthNames('2021')).toEqual([]);
    expect([yearOf('2021-03'), yearOf('present')]).toEqual(['2021', '']);
    expect([typedDate('2021-03'), typedDate('2021'), typedDate('present')]).toEqual([
      '03/2021',
      '2021',
      '',
    ]);
  });
});
