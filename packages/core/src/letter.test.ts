import { describe, expect, it } from 'vitest';
import {
  asksForCoverLetter,
  isCoverLetterFile,
  letterPlainText,
  letterWordCount,
  readLetterText,
} from './letter.ts';

const LETTER = JSON.stringify({
  layout: 'classic',
  name: 'Alex Rivera',
  date: 'October 14, 2026',
  recipient: ['Sam Lee', 'Engineering Manager', 'Acme Robotics'],
  greeting: 'Dear Sam Lee,',
  paragraphs: ['I cut deploy time by **~40%** at Tidewater.', 'I would bring the same to Acme.'],
  closing: 'Best regards,',
});

describe('isCoverLetterFile', () => {
  it('knows a cover letter’s files by their name, however it’s written', () => {
    for (const name of [
      'AlexRiveraCoverLetter10142026_Acme.pdf',
      'Acme cover letter.docx',
      'cover-letter.pdf',
      'Cover_Letter_Final.pdf',
    ]) {
      expect(isCoverLetterFile(name)).toBe(true);
    }
    for (const name of ['AlexRiveraResume10142026_Acme.pdf', 'resume.docx', 'letters.pdf']) {
      expect(isCoverLetterFile(name)).toBe(false);
    }
  });
});

describe('readLetterText', () => {
  it('reads what a letter shows, signed with the name at the top', () => {
    expect(readLetterText(LETTER)).toEqual({
      date: 'October 14, 2026',
      recipient: ['Sam Lee', 'Engineering Manager', 'Acme Robotics'],
      greeting: 'Dear Sam Lee,',
      paragraphs: [
        'I cut deploy time by **~40%** at Tidewater.',
        'I would bring the same to Acme.',
      ],
      closing: 'Best regards,',
      signature: 'Alex Rivera',
    });
    expect(
      readLetterText(JSON.stringify({ ...JSON.parse(LETTER), signature: 'Alex' }))?.signature,
    ).toBe('Alex');
  });

  it('shows what a letter half written has, and nothing for one that won’t read', () => {
    expect(readLetterText('{"paragraphs":["Hello.", 4]}')).toEqual({
      date: null,
      recipient: [],
      greeting: '',
      paragraphs: ['Hello.'],
      closing: '',
      signature: '',
    });
    for (const text of [null, '', '{', '[]', '{"paragraphs":[]}', '{"greeting":"Dear Sam,"}']) {
      expect(readLetterText(text)).toBeNull();
    }
  });
});

describe('letterPlainText', () => {
  it('gives the letter as a form’s box takes it, with no bold marks, date or address', () => {
    const letter = readLetterText(LETTER);
    expect(letter && letterPlainText(letter)).toBe(
      [
        'Dear Sam Lee,',
        'I cut deploy time by ~40% at Tidewater.',
        'I would bring the same to Acme.',
        'Best regards,\nAlex Rivera',
      ].join('\n\n'),
    );
    expect(letter && letterWordCount(letter)).toBe(15);
  });
});

describe('asksForCoverLetter', () => {
  it('reads how to apply for a cover letter', () => {
    for (const apply of [
      '- **Alert:** Send a resume and a cover letter.',
      'Email your resume and cover letter to jobs@acme.example.',
      'Cover letter required.',
      'Applications without a cover letter won’t be considered.',
      'Attach a resume. Mention Rust in your cover letter!',
    ]) {
      expect(asksForCoverLetter({ apply })).toBe(true);
    }
  });

  it('leaves out one that says a letter isn’t needed, or doesn’t mention one', () => {
    for (const apply of [
      null,
      'Apply on the site. No phone calls.',
      'No cover letter needed.',
      'Cover letter optional.',
      'A cover letter is not required.',
      'Please don’t send a cover letter, just your resume.',
      'We do not need cover letters.',
    ]) {
      expect(asksForCoverLetter({ apply })).toBe(false);
    }
  });
});
