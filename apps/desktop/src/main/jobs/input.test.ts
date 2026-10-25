import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../shared/limits.ts';
import {
  parseCallChanges,
  parseDate,
  parseJobChanges,
  parseNewCall,
  parseNewJob,
  parseNewNote,
  parseNoteChanges,
} from './input.ts';

describe('parseJobChanges', () => {
  it('keeps only the fields given, trimming text and clearing empty text', () => {
    expect(
      parseJobChanges({
        status: 'applied',
        statusOn: '2026-10-08',
        nextAction: '  Follow up  ',
        earlierNotes: '   ',
        nextOn: null,
        archived: false,
      }),
    ).toEqual({
      status: 'applied',
      statusOn: '2026-10-08',
      nextAction: 'Follow up',
      earlierNotes: null,
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

  it('takes a kind of job by its id, or null to go by the search or fit check', () => {
    expect(parseJobChanges({ kind: 'project-manager' })).toEqual({ kind: 'project-manager' });
    expect(parseJobChanges({ kind: null })).toEqual({ kind: null });
  });

  it('takes the pay to ask for in the user’s words, trimmed, or null to go back to none', () => {
    expect(parseJobChanges({ payAsk: '  $185,000 ' })).toEqual({ payAsk: '$185,000' });
    expect(parseJobChanges({ payAsk: '  ' })).toEqual({ payAsk: null });
    expect(parseJobChanges({ payAsk: null })).toEqual({ payAsk: null });
    expect(parseJobChanges({ payAsk: 185000 })).toBeNull();
    expect(parseJobChanges({ payAsk: 'x'.repeat(201) })).toBeNull();
  });

  it('takes the day a job set aside comes back, and why the user passed', () => {
    expect(parseJobChanges({ status: 'later', backOn: '2026-11-02' })).toEqual({
      status: 'later',
      backOn: '2026-11-02',
    });
    expect(parseJobChanges({ status: 'passed', passReason: 'work' })).toEqual({
      status: 'passed',
      passReason: 'work',
    });
    expect(parseJobChanges({ backOn: null, passReason: null })).toEqual({
      backOn: null,
      passReason: null,
    });
  });

  it.each([
    { status: 'hired' },
    { status: 'checked' },
    { backOn: 'next week' },
    { passReason: 'vibes' },
    { statusOn: null },
    { statusOn: '2026-02-30' },
    { appliedOn: 'yesterday' },
    { earlierNotes: 'x'.repeat(LIMITS.notes + 1) },
    { questions: 'Why us?' },
    { questions: [42] },
    { questions: ['x'.repeat(LIMITS.question + 1)] },
    { questions: Array.from({ length: LIMITS.questions + 1 }, () => 'Why?') },
    { nextAction: 42 },
    { archived: 'yes' },
    { kind: 'Project manager' },
    { kind: '../base' },
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
    expect(parseNewJob({ company: 'Acme', kind: 'developer' })).toEqual({
      company: 'Acme',
      kind: 'developer',
    });
  });

  it.each([
    { company: 42 },
    { company: 'Acme', pay: 'x'.repeat(LIMITS.pay + 1) },
    { company: 'Acme', kind: 'Developer' },
  ])('refuses %j', (value) => {
    expect(parseNewJob(value)).toBeNull();
  });
});

describe('parseNewCall', () => {
  it('reads a call with a kind and a date', () => {
    expect(parseNewCall({ kind: 'screen', onDate: '2026-10-13', atTime: '09:30' })).toEqual({
      kind: 'screen',
      onDate: '2026-10-13',
      atTime: '09:30',
    });
  });

  it('reads who a call is with, how long it is, how and where, trimmed', () => {
    expect(
      parseNewCall({
        kind: 'panel',
        onDate: '2026-10-20',
        minutes: 60,
        mode: 'video',
        place: ' https://meet.example.com/x ',
        people: [
          { name: ' Dana Lee ', role: ' Hiring manager ' },
          { name: 'Sam Ortiz', role: null },
          // A row left empty, or with only a role, is left out.
          { name: ' ', role: '' },
        ],
      }),
    ).toEqual({
      kind: 'panel',
      onDate: '2026-10-20',
      minutes: 60,
      mode: 'video',
      place: 'https://meet.example.com/x',
      people: [
        { name: 'Dana Lee', role: 'Hiring manager' },
        { name: 'Sam Ortiz', role: null },
      ],
    });
  });

  it.each([
    { onDate: '2026-10-13' },
    { kind: 'screen' },
    { kind: 'chat', onDate: '2026-10-13' },
    { kind: 'screen', onDate: '2026-10-13', atTime: '9:30' },
    { kind: 'screen', onDate: '2026-10-13', atTime: '24:00' },
    { kind: 'screen', onDate: '2026-10-13', minutes: 0 },
    { kind: 'screen', onDate: '2026-10-13', minutes: 30.5 },
    { kind: 'screen', onDate: '2026-10-13', minutes: 24 * 60 + 1 },
    { kind: 'screen', onDate: '2026-10-13', mode: 'carrier pigeon' },
    { kind: 'screen', onDate: '2026-10-13', people: [{ name: 'Dana', email: 'd@x.com' }] },
    { kind: 'screen', onDate: '2026-10-13', people: [{ name: 42 }] },
    { kind: 'screen', onDate: '2026-10-13', people: 'Dana Lee' },
    { kind: 'screen', onDate: '2026-10-13', place: 'x'.repeat(LIMITS.place + 1) },
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

  it('takes a call that two devices’ changes made longer than one lets it get', () => {
    const many = Array.from({ length: LIMITS.people + 3 }, (_, i) => ({
      name: `Person ${i}`,
      role: null,
    }));
    expect(parseCallChanges({ people: many })?.people).toHaveLength(LIMITS.people + 3);
    const merged = 'x'.repeat(LIMITS.debrief + 100);
    expect(parseCallChanges({ debrief: merged })?.debrief).toBe(merged);
    expect(parseCallChanges({ debrief: 'x'.repeat(LIMITS.debrief * 4 + 1) })).toBeNull();
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

describe('notes', () => {
  it('take a note’s words, trimmed, and the day it’s about if given', () => {
    expect(parseNewNote({ text: '  They want Go.  ' })).toEqual({ text: 'They want Go.' });
    expect(parseNewNote({ text: 'Call went well', on: '2026-10-11' })).toEqual({
      text: 'Call went well',
      on: '2026-10-11',
    });
    expect(parseNoteChanges({ on: '2026-10-09' })).toEqual({ on: '2026-10-09' });
    expect(parseNoteChanges({ text: ' Fixed ' })).toEqual({ text: 'Fixed' });
  });

  it.each([
    { text: '   ' },
    { text: 'x'.repeat(LIMITS.note + 1) },
    { text: 'Fine', on: 'yesterday' },
    { on: '2026-10-11' },
    { text: 42 },
    null,
  ])('refuses a new note of %j', (value) => {
    expect(parseNewNote(value)).toBeNull();
  });

  it('refuses changes that don’t fit', () => {
    expect(parseNoteChanges({ on: '2026-02-30' })).toBeNull();
    expect(parseNoteChanges({ text: 'x'.repeat(LIMITS.note + 1) })).toBeNull();
    expect(parseNoteChanges('not an object')).toBeNull();
  });
});
