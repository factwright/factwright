import { describe, expect, it } from 'vitest';
import { type CheckId, inWords, runChecks, textMarks } from './checks.ts';
import { readFields } from './fields.ts';
import type { Line, ReadFile } from './read.ts';
import { findSections } from './sections.ts';
import { fileOf, wordLine } from './testing.ts';

const heading = (text: string) => wordLine(text, { look: 'heading', size: 12 });

/** A plain resume, in Word's lines, with lines added or swapped in. */
function resume(changes: { top?: Line[]; body?: Line[] } = {}): Line[] {
  return [
    ...(changes.top ?? [
      wordLine('Jordan Avery'),
      wordLine('jordan@example.com | (555) 014-2387 | Denver, CO'),
    ]),
    heading('Summary'),
    wordLine(
      'Product manager with eight years in marketplaces, and a long enough summary to read.',
    ),
    heading('Experience'),
    wordLine('Senior Product Manager\t04/2021 – Present'),
    wordLine('Northwind Stays'),
    ...(changes.body ?? []),
    heading('Education'),
    wordLine('B.S., Economics\t2016'),
    heading('Skills'),
    wordLine('SQL · Amplitude · Figma'),
  ];
}

function check(file: ReadFile, id: CheckId) {
  const sections = findSections(file.lines);
  return runChecks(file, sections, readFields(file.lines, sections)).find((each) => each.id === id);
}

describe('runChecks', () => {
  it('passes a plain resume on every check', () => {
    const file = fileOf(resume());
    const sections = findSections(file.lines);
    const checks = runChecks(file, sections, readFields(file.lines, sections));
    expect(checks.filter((each) => each.status !== 'pass')).toEqual([]);
    expect(checks.map((each) => each.id)).toEqual([
      'order',
      'margins',
      'characters',
      'joined',
      'spaced',
      'layout',
      'contact',
      'dates',
      'headings',
      'fonts',
      'length',
    ]);
  });

  it('finds a file with almost no text', () => {
    expect(check(fileOf([wordLine('Page 1')]), 'text')?.status).toBe('fix');
  });

  it('finds junk characters, and marks their lines', () => {
    const lines = resume({ body: [wordLine('Led \u{E001} the team')] });
    const found = check(fileOf(lines), 'characters');
    expect(found).toMatchObject({ status: 'fix', lines: [7] });
  });

  it('notes symbols, but not bullets, arrows or checks', () => {
    expect(
      check(fileOf(resume({ body: [wordLine('• Cut time → 3 days ✓')] })), 'characters')?.status,
    ).toBe('pass');
    expect(check(fileOf(resume({ body: [wordLine('☎ Call me ★★★')] })), 'characters')?.status).toBe(
      'note',
    );
  });

  it('finds letters spaced apart, but not initials with dots', () => {
    expect(
      check(fileOf(resume({ body: [wordLine('J. R. R. Tolkien fan')] })), 'spaced')?.status,
    ).toBe('pass');
    expect(
      check(fileOf(resume({ body: [wordLine('L E A D E R S H I P')] })), 'spaced'),
    ).toMatchObject({
      status: 'fix',
      examples: ['L E A D E R S H I P'],
    });
  });

  it('wants a name and an email, and notes a missing phone or city', () => {
    expect(check(fileOf(resume({ top: [wordLine('Jordan Avery')] })), 'contact')).toMatchObject({
      status: 'fix',
      summary: 'No email address and phone number found',
    });
    const noPhone = resume({
      top: [wordLine('Jordan Avery'), wordLine('jordan@example.com · Denver, CO')],
    });
    expect(check(fileOf(noPhone), 'contact')).toMatchObject({
      status: 'note',
      summary: 'No phone number found',
    });
  });

  it('notes a name that isn’t the first line', () => {
    const top = [
      wordLine('CURRICULUM VITAE'),
      wordLine('Jordan Avery'),
      wordLine('jordan@example.com | (555) 014-2387 | Denver, CO'),
    ];
    expect(check(fileOf(resume({ top })), 'contact')?.summary).toBe(
      'Your name isn’t the first line',
    );
  });

  it('finds jobs with dates systems can’t read', () => {
    const body = [wordLine('Product Manager\tSummer 2018 – Fall 2020'), wordLine('Bramble Market')];
    expect(check(fileOf(resume({ body })), 'dates')).toMatchObject({
      status: 'fix',
      examples: ['Summer 2018 – Fall 2020'],
    });
  });

  it('finds work history with no heading systems know', () => {
    const lines = resume().map((line) =>
      line.text === 'Experience' ? heading('Where I’ve Been') : line,
    );
    expect(check(fileOf(lines), 'headings')?.status).toBe('fix');
  });

  it('finds headings read one after another, apart from what’s under them', () => {
    const lines = [
      wordLine('Jordan Avery'),
      heading('Summary'),
      heading('Experience'),
      heading('Skills'),
      wordLine('SQL'),
    ];
    expect(check(fileOf(lines), 'order')?.status).toBe('fix');
  });

  it('finds an icon font, and notes a Word file’s font that isn’t on most computers', () => {
    expect(check(fileOf(resume(), { fonts: ['FontAwesome'] }), 'fonts')?.status).toBe('fix');
    expect(check(fileOf(resume(), { fonts: ['Calibri', 'Lato'] }), 'fonts')).toMatchObject({
      status: 'note',
      summary: 'Not on most computers: Lato',
    });
  });

  it('notes more than two pages', () => {
    expect(check(fileOf(resume(), { pageCount: 3 }), 'length')?.status).toBe('note');
    expect(check(fileOf(resume(), { pageCount: 2 }), 'length')?.status).toBe('pass');
  });

  it('lets a Word file’s small table be, but finds one holding its jobs', () => {
    const lines = resume();
    const small = fileOf(lines, {
      tables: [{ rows: [['~31%', 'Higher bookings']], first: 3, end: 4 }],
    });
    expect(check(small, 'layout')?.status).toBe('pass');
    const jobs = fileOf(lines, {
      tables: [{ rows: [['Senior Product Manager', 'Northwind']], first: 4, end: 6 }],
    });
    expect(check(jobs, 'layout')?.status).toBe('fix');
  });
});

describe('inWords', () => {
  it('lists words as a sentence does', () => {
    expect([inWords([]), inWords(['A']), inWords(['A', 'B']), inWords(['A', 'B', 'C'])]).toEqual([
      '',
      'A',
      'A and B',
      'A, B and C',
    ]);
  });
});

describe('textMarks', () => {
  it('marks junk, joined letters and spaced ones, in order', () => {
    expect(textMarks('\u{E001} eﬃcient S U M M A R Y')).toEqual([
      { kind: 'junk', start: 0, end: 1 },
      { kind: 'joined', start: 3, end: 4 },
      { kind: 'spaced', start: 10, end: 23 },
    ]);
    expect(textMarks('Plain text')).toEqual([]);
  });
});
