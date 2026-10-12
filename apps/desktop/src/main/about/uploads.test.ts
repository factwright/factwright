import { describe, expect, it } from 'vitest';
import { checkLinkedIn, checkUpload, keptName } from './uploads.ts';

const pdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj');
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe('checkUpload', () => {
  it('takes a file that is what its name says, for a kind that takes it', () => {
    expect(
      checkUpload({ name: 'Resume 2024.pdf', kind: 'resume', bytes: pdf, text: 'Jordan' }),
    ).toEqual({
      name: 'Resume 2024.pdf',
      kind: 'resume',
      extension: 'pdf',
      bytes: pdf,
      text: 'Jordan',
    });
    expect(
      checkUpload({ name: 'linkedin.PNG', kind: 'screenshot', bytes: png, text: null }),
    ).toMatchObject({
      extension: 'png',
    });
  });

  it('says why it won’t take a file, in words the user can act on', () => {
    const problem = (upload: object) => (checkUpload(upload) as { problem: string }).problem;
    expect(problem({ name: 'cv.doc', kind: 'resume', bytes: pdf, text: null })).toBe(
      'That’s an older Word file. Save it as a .docx or a PDF, then add that.',
    );
    expect(problem({ name: 'photo.heic', kind: 'screenshot', bytes: png, text: null })).toMatch(
      /JPEG or PNG/,
    );
    expect(problem({ name: 'shot.png', kind: 'resume', bytes: png, text: null })).toBe(
      'shot.png isn’t a type this takes. It takes .pdf, .docx, .txt, .md.',
    );
    expect(problem({ name: 'fake.pdf', kind: 'resume', bytes: png, text: null })).toBe(
      'fake.pdf doesn’t look like a .pdf file inside. Try saving it again.',
    );
    expect(
      problem({ name: 'empty.pdf', kind: 'resume', bytes: new Uint8Array(), text: null }),
    ).toBe('empty.pdf is empty.');
    expect(
      problem({
        name: 'big.pdf',
        kind: 'resume',
        bytes: new Uint8Array(26 * 1024 * 1024),
        text: null,
      }),
    ).toMatch(/bigger than 25 MB/);
  });

  it('refuses anything not shaped like an upload', () => {
    for (const value of [
      null,
      { name: 'a.pdf', kind: 'linkedin-data', bytes: pdf, text: null },
      { name: 'a.pdf', kind: 'resume', bytes: 'text', text: null },
      { name: '', kind: 'resume', bytes: pdf, text: null },
      { name: 'a.pdf', kind: 'resume', bytes: pdf, text: 42 },
    ]) {
      expect(checkUpload(value)).toEqual({ problem: 'That file couldn’t be added.' });
    }
  });

  it('takes text files that are text, and nothing else under their name', () => {
    const text = new TextEncoder().encode('Notes about my work');
    expect(
      checkUpload({ name: 'notes.md', kind: 'document', bytes: text, text: null }),
    ).toMatchObject({ extension: 'md' });
    expect(
      checkUpload({
        name: 'notes.txt',
        kind: 'document',
        bytes: new Uint8Array([0xff, 0xfe, 0xfd]),
        text: null,
      }),
    ).toEqual({
      problem: 'notes.txt doesn’t look like a .txt file inside. Try saving it again.',
    });
  });
});

describe('checkLinkedIn', () => {
  it('takes only the export’s known spreadsheets', () => {
    const upload = {
      tables: [{ name: 'Positions.csv', text: 'Title' }],
      summary: '# LinkedIn data',
    };
    expect(checkLinkedIn(upload)).toEqual(upload);
    expect(
      checkLinkedIn({ tables: [{ name: 'messages.csv', text: 'hi' }], summary: '' }),
    ).toBeNull();
    expect(
      checkLinkedIn({ tables: [{ name: '../facts/x.csv', text: '' }], summary: '' }),
    ).toBeNull();
    expect(checkLinkedIn({ tables: 'all', summary: '' })).toBeNull();
  });
});

describe('keptName', () => {
  it('names a file by the day it was added and its own name, plainly spelled', () => {
    expect(keptName('Résumé (final) v2.PDF', 'pdf', '2026-10-12')).toBe(
      '2026-10-12-resume-final-v2.pdf',
    );
    expect(keptName('….pdf', 'pdf', '2026-10-12')).toBe('2026-10-12-file.pdf');
  });
});
