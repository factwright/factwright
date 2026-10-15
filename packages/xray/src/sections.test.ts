import { describe, expect, it } from 'vitest';
import { findSections, headingKind, splitHeadingKind } from './sections.ts';
import { wordLine } from './testing.ts';

describe('headingKind', () => {
  it('knows the headings parsers look for, however they’re written', () => {
    expect(headingKind('PROFESSIONAL EXPERIENCE')).toBe('experience');
    expect(headingKind('Work History')).toBe('experience');
    expect(headingKind('Skills:')).toBe('skills');
    expect(headingKind('Areas of Expertise')).toBe('skills');
    expect(headingKind('Licenses & Certifications')).toBe('certifications');
    expect(headingKind('Education and Training')).toBe('education');
  });

  it('knows a heading by how it ends', () => {
    expect(headingKind('Clinical Skills')).toBe('skills');
    expect(headingKind('Teaching Experience')).toBe('experience');
    expect(headingKind('Independent Projects')).toBe('projects');
  });

  it('takes only a whole line that’s a heading', () => {
    expect(headingKind('Skills: Python, SQL')).toBeNull();
    expect(headingKind('Experience with distributed systems at scale')).toBeNull();
    expect(headingKind('Key Systems Built at Acme')).toBeNull();
  });
});

describe('findSections', () => {
  const heading = (text: string) => wordLine(text, { look: 'heading', size: 12 });
  const body = (text: string) => wordLine(text, { look: 'body', size: 10 });

  it('finds each part from its heading to the next', () => {
    const lines = [
      body('Jordan Avery'),
      heading('SUMMARY'),
      body('Text.'),
      heading('EXPERIENCE'),
      body('A job'),
    ];
    expect(findSections(lines)).toEqual([
      { kind: 'summary', title: 'SUMMARY', line: 1, end: 3 },
      { kind: 'experience', title: 'EXPERIENCE', line: 3, end: 5 },
    ]);
  });

  it('marks a heading set like the known ones as one systems don’t know', () => {
    const lines = [
      heading('SUMMARY'),
      body('Text.'),
      heading('WHAT I BUILT'),
      body('A card'),
      heading('SKILLS'),
    ];
    expect(findSections(lines).map((section) => section.kind)).toEqual(['summary', null, 'skills']);
  });

  it('doesn’t take a known name set like the text, such as a subheading in a job, for a part', () => {
    const lines = [
      heading('EXPERIENCE'),
      body('Senior Engineer'),
      body('Projects'),
      body('Built things.'),
      heading('EDUCATION'),
    ];
    expect(findSections(lines).map((section) => section.title)).toEqual([
      'EXPERIENCE',
      'EDUCATION',
    ]);
  });

  it('takes headings in two looks, as a sidebar and its main column can have', () => {
    const side = (text: string) => wordLine(text, { look: 'side', size: 9 });
    const lines = [
      side('CONTACT'),
      side('SKILLS'),
      side('EDUCATION'),
      heading('SUMMARY'),
      heading('EXPERIENCE'),
    ];
    expect(findSections(lines).map((section) => section.kind)).toEqual([
      'contact',
      'skills',
      'education',
      'summary',
      'experience',
    ]);
  });

  it('skips text in a header or footer', () => {
    expect(findSections([wordLine('Skills', { part: 'header' })])).toEqual([]);
  });
});

describe('splitHeadingKind', () => {
  it('knows a heading whose words letter spacing split apart, as a parser reads it', () => {
    expect(
      Object.fromEntries(
        [
          'EXECUTI VE SUM M ARY',
          'PROFESSI ONAL EXPER I ENCE',
          'TECH NI CAL SKI LLS',
          'COR E COM PETENCI ES',
          'EDUCATI ON',
          'T ECHNOLOGIES',
        ].map((text) => [text, splitHeadingKind(text)]),
      ),
    ).toEqual({
      'EXECUTI VE SUM M ARY': 'summary',
      'PROFESSI ONAL EXPER I ENCE': 'experience',
      'TECH NI CAL SKI LLS': 'skills',
      'COR E COM PETENCI ES': 'skills',
      'EDUCATI ON': 'education',
      'T ECHNOLOGIES': 'skills',
    });
  });

  it('leaves a heading read whole or known by its ending, a sentence, or one it doesn’t know', () => {
    // "INDEPENDEN T PROJECTS" still ends in "projects", so parsers know it as it reads.
    expect(headingKind('INDEPENDEN T PROJECTS')).toBe('projects');
    for (const text of [
      'PROFESSIONAL EXPERIENCE',
      'No experience',
      'Built pipelines',
      'KEY SYST EMS BUILT',
    ]) {
      expect(splitHeadingKind(text), text).toBeNull();
    }
  });
});
