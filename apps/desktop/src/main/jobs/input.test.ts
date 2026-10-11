import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../shared/limits.ts';
import {
  parseCallChanges,
  parseDate,
  parseJobChanges,
  parseNewCall,
  parseNewJob,
} from './input.ts';

describe('parseJobChanges', () => {
  it('keeps only the fields given, trimming text and clearing empty text', () => {
    expect(
      parseJobChanges({
        status: 'applied',
        statusOn: '2026-10-08',
        nextAction: '  Follow up  ',
        notes: '   ',
        nextOn: null,
        archived: false,
      }),
    ).toEqual({
      status: 'applied',
      statusOn: '2026-10-08',
      nextAction: 'Follow up',
      notes: null,
      nextOn: null,
      archived: false,
    });
    expect(parseJobChanges({ status: null })).toEqual({ status: null });
    expect(parseJobChanges({})).toEqual({});
  });

  it('takes the application’s questions as a list, trimmed, without empty ones', () => {
    expect(parseJobChanges({ questions: ['  Why us?  ', '', '   ', 'Notice period?'] })).toEqual({
      questions: ['Why us?', 'Notice period?'],
    });
    expect(parseJobChanges({ questions: [] })).toEqual({ questions: [] });
  });

  it.each([
    { status: 'hired' },
    { statusOn: null },
    { statusOn: '2026-02-30' },
    { appliedOn: 'yesterday' },
    { notes: 'x'.repeat(LIMITS.notes + 1) },
    { questions: 'Why us?' },
    { questions: [42] },
    { questions: ['x'.repeat(LIMITS.question + 1)] },
    { questions: Array.from({ length: LIMITS.questions + 1 }, () => 'Why?') },
    { nextAction: 42 },
    { archived: 'yes' },
    'not an object',
    null,
    [],
  ])('refuses %j', (value) => {
    expect(parseJobChanges(value)).toBeNull();
  });
});

describe('parseNewJob', () => {
  it('reads a job added by hand', () => {
    expect(parseNewJob({ company: ' Acme ', role: '', link: null, status: 'applied' })).toEqual({
      company: 'Acme',
      role: null,
      link: null,
      status: 'applied',
    });
    expect(parseNewJob({})).toEqual({ company: '' });
  });

  it.each([{ company: 42 }, { company: 'Acme', pay: 'x'.repeat(LIMITS.pay + 1) }])(
    'refuses %j',
    (value) => {
      expect(parseNewJob(value)).toBeNull();
    },
  );
});

describe('parseNewCall', () => {
  it('reads a call with a kind and a date', () => {
    expect(parseNewCall({ kind: 'screen', onDate: '2026-10-13', atTime: '09:30' })).toEqual({
      kind: 'screen',
      onDate: '2026-10-13',
      atTime: '09:30',
    });
  });

  it.each([
    { onDate: '2026-10-13' },
    { kind: 'screen' },
    { kind: 'chat', onDate: '2026-10-13' },
    { kind: 'screen', onDate: '2026-10-13', atTime: '9:30' },
    { kind: 'screen', onDate: '2026-10-13', atTime: '24:00' },
  ])('refuses %j', (value) => {
    expect(parseNewCall(value)).toBeNull();
  });
});

describe('parseCallChanges', () => {
  it('reads changes to a call', () => {
    expect(parseCallChanges({ state: 'done', outcome: 'advanced', atTime: null })).toEqual({
      state: 'done',
      outcome: 'advanced',
      atTime: null,
    });
  });

  it.each([{ state: 'later' }, { outcome: 'great' }, { onDate: null }])('refuses %j', (value) => {
    expect(parseCallChanges(value)).toBeNull();
  });
});

describe('parseDate', () => {
  it('reads a calendar date and nothing else', () => {
    expect(parseDate('2026-10-02')).toBe('2026-10-02');
    expect(parseDate('2026-10-32')).toBeNull();
    expect(parseDate(20261002)).toBeNull();
  });
});
