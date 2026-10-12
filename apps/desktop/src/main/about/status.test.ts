import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAnswers } from '../../shared/about.ts';
import { countFacts, profileStatus, readLog, startingResumes } from './status.ts';

let workspace: string;
const write = (path: string, text: string) => {
  const file = join(workspace, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factwright-status-'));
});

afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe('countFacts', () => {
  it('counts each claim, and the ones still to confirm, in every facts file but the guides', () => {
    write('facts/README.md', '### Short claim title\n`live` `solo` `high`\n');
    write('facts/gaps.md', '### Something to ask\n');
    write(
      'facts/acme.md',
      '# Acme\n\n### Built the pipeline\n`unconfirmed` `live` `solo` `medium`\n> Wording\n\n### Led the team\n\n`led-team` `high`\n',
    );
    write('facts/earlier/beta.md', '### Ran support\n`unconfirmed` `shipped` `solo` `low`\n');
    expect(countFacts(workspace)).toEqual({ claims: 3, unconfirmed: 2, files: 2 });
  });

  it('is empty with no fact bank', () => {
    expect(countFacts(workspace)).toEqual({ claims: 0, unconfirmed: 0, files: 0 });
  });
});

describe('startingResumes', () => {
  it('lists each starting resume with the files built from it', () => {
    write(
      'base/startup-ic.json',
      JSON.stringify({
        headline: 'Product Designer',
        layout: 'modern',
        output_name: 'JordanAveryResume_Startups',
      }),
    );
    write('base/JordanAveryResume_Startups.pdf', '%PDF');
    write('base/public-sector-ic.json', '{ not json');
    expect(startingResumes(workspace)).toEqual([
      {
        path: 'base/public-sector-ic.json',
        title: 'public-sector-ic',
        layout: 'timeline',
        pdf: null,
        docx: null,
      },
      {
        path: 'base/startup-ic.json',
        title: 'Product Designer',
        layout: 'modern',
        pdf: 'base/JordanAveryResume_Startups.pdf',
        docx: null,
      },
    ]);
  });
});

describe('readLog', () => {
  it('reads what Claude has read, and when', () => {
    const log = readLog(
      '# What Claude has read\n- about-me/notes.md · 2026-10-12\n- `about-me/files/a.pdf` · 2026-10-11\nnot a line\n',
    );
    expect([...log]).toEqual([
      ['about-me/notes.md', '2026-10-12'],
      ['about-me/files/a.pdf', '2026-10-11'],
    ]);
  });
});

describe('profileStatus', () => {
  const answers = readAnswers({
    files: [
      {
        path: 'about-me/files/a.pdf',
        name: 'a.pdf',
        kind: 'resume',
        added: '2026-10-11',
        textFile: null,
      },
      {
        path: 'about-me/files/b.png',
        name: 'b.png',
        kind: 'screenshot',
        added: '2026-10-12',
        textFile: null,
      },
    ],
  });

  it('says what Claude hasn’t read yet, and whether the notes changed since', () => {
    write(
      'about-me/read.md',
      '- about-me/files/a.pdf · 2026-10-11\n- about-me/notes.md · 2026-10-01\n',
    );
    write('about-me/notes.md', 'More about me');
    utimesSync(
      join(workspace, 'about-me/notes.md'),
      new Date('2026-10-12T12:00:00'),
      new Date('2026-10-12T12:00:00'),
    );
    const status = profileStatus(workspace, answers);
    expect(status.unread).toEqual(['about-me/files/b.png']);
    expect(status.notesChanged).toBe(true);
    expect(status.criteria).toBe('none');
    expect(status.connections).toBeNull();
  });

  it('counts the LinkedIn connections, below the export’s notes', () => {
    write(
      'linkedin/Connections.csv',
      'Notes:\n"Some emails may be missing."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nSam,Lee,,,Acme,Engineer,01 Oct 2026\nAna,Diaz,,,Beta,Designer,02 Oct 2026\n',
    );
    expect(profileStatus(workspace, answers).connections).toEqual({ count: 2, added: '' });
  });
});
