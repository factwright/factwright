import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markdownTable } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addLogRow, logRow, withRow } from './logs.ts';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factwright-logs-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const FIT = {
  date: '2026-10-25',
  company: 'Acme Robotics',
  role: 'Staff Engineer',
  verdict: 'Strong',
  score: '84',
  link: 'https://jobs.lever.co/acme/1',
  pay: '$180k–$210k',
  note: 'Platform work | remote',
};

describe('the job hunt’s logs', () => {
  it('starts a log with its heading, then adds each row at the end of its table', () => {
    const first = withRow(null, 'fit-checks', FIT);
    expect(first).toBe(
      [
        '| Date | Company | Role | Verdict | Score | Link | Pay | Note | Job |',
        '|---|---|---|---|---|---|---|---|---|',
        '| 2026-10-25 | Acme Robotics | Staff Engineer | Strong | 84 | https://jobs.lever.co/acme/1 | $180k–$210k | Platform work \\| remote |  |',
        '',
      ].join('\n'),
    );
    const second = withRow(`${first}\nNotes the user wrote under it.\n`, 'fit-checks', {
      ...FIT,
      company: 'Globex',
      note: '',
    });
    const rows = markdownTable(second);
    expect(rows.map((row) => row.company)).toEqual(['Acme Robotics', 'Globex']);
    // A "|" in a cell stays in it.
    expect(rows[0]?.note).toBe('Platform work | remote');
    expect(second).toContain('Notes the user wrote under it.');
  });

  it('writes a row in the columns the log’s table has, in its order', () => {
    const older =
      '| Date | Company | Role | Estimate |\n|---|---|---|---|\n| 2026-10-01 | Initech | PM | $150k |\n';
    const text = withRow(older, 'salary-checks', {
      date: '2026-10-25',
      company: 'Acme',
      role: 'Staff',
      estimate: '$200k',
      confidence: 'medium',
    });
    expect(text.split('\n')[3]).toBe('| 2026-10-25 | Acme | Staff | $200k |');
  });

  it('gives a fit check log from before it named jobs a Job column, once a row names one', () => {
    const older = [
      '| Date | Company | Role | Verdict | Score | Link | Pay | Note |',
      '|---|---|---|---|---|---|---|---|',
      '| 2026-10-01 | Initech | PM | Good | 70 | | | |',
      '',
    ].join('\n');
    // A row with no job leaves the table as it is.
    expect(withRow(older, 'fit-checks', FIT).split('\n')[0]).toBe(
      '| Date | Company | Role | Verdict | Score | Link | Pay | Note |',
    );
    const text = withRow(older, 'fit-checks', { ...FIT, job: 'acme-robotics--staff-engineer' });
    expect(text.split('\n').slice(0, 2)).toEqual([
      '| Date | Company | Role | Verdict | Score | Link | Pay | Note | Job |',
      '|---|---|---|---|---|---|---|---|---|',
    ]);
    expect(markdownTable(text).map((row) => [row.company, row.job])).toEqual([
      ['Initech', ''],
      ['Acme Robotics', 'acme-robotics--staff-engineer'],
    ]);
  });

  it('takes a fit check’s job by its id, and nothing else', () => {
    expect(logRow('fit-checks', { ...FIT, job: '`Acme--Staff`' }, '2026-10-25').job).toBe(
      'acme--staff',
    );
    expect(() => logRow('fit-checks', { ...FIT, job: 'acme; rm -rf' }, '2026-10-25')).toThrow(
      /by its id/,
    );
  });

  it('adds a table to a log that has none, keeping what’s there, and its line endings', () => {
    const text = withRow('# Unmasked listings\r\n', 'unmask-checks', {
      date: '2026-10-25',
      listing: 'Bluewave Staffing',
      employer: 'Meridian Freight',
      role: 'Staff Engineer',
      apply: 'direct',
    });
    expect(text.startsWith('# Unmasked listings\r\n\r\n| Date | Listing | Employer |')).toBe(true);
    expect(markdownTable(text)[0]?.employer).toBe('Meridian Freight');
  });

  it('checks each row for its log: its columns, the ones it needs, a date and a score', () => {
    expect(
      logRow('fit-checks', { company: 'Acme', role: 'Staff', verdict: 'Good' }, '2026-10-25'),
    ).toEqual({ company: 'Acme', role: 'Staff', verdict: 'Good', date: '2026-10-25' });
    expect(logRow('fit-checks', { ...FIT, score: 84 }, '2026-10-26').score).toBe('84');
    expect(() => logRow('fit-checks', { ...FIT, estimate: '$1' }, '2026-10-25')).toThrow(
      /fit-checks has no estimate column/,
    );
    expect(() => logRow('fit-checks', { company: 'Acme' }, '2026-10-25')).toThrow(
      'Give the role, verdict for fit-checks.',
    );
    expect(() => logRow('fit-checks', { ...FIT, date: 'today' }, '2026-10-25')).toThrow(
      'YYYY-MM-DD',
    );
    expect(() => logRow('fit-checks', { ...FIT, score: '101' }, '2026-10-25')).toThrow(/0 to 100/);
    expect(() => logRow('salary-checks', 'Acme', '2026-10-25')).toThrow(/object/);
  });

  it('writes the log whole, one row at a time, telling the task’s record first', () => {
    const kept: string[] = [];
    for (const company of ['Acme', 'Globex', 'Initech']) {
      addLogRow(workspace, 'fit-checks', { ...FIT, company }, (path) => kept.push(path));
    }
    const file = join(workspace, 'searches', 'fit-checks.md');
    expect(markdownTable(readFileSync(file, 'utf8')).map((row) => row.company)).toEqual([
      'Acme',
      'Globex',
      'Initech',
    ]);
    expect(kept).toEqual([file, file, file]);
    // No draft is left beside it.
    expect(readdirSync(join(workspace, 'searches'))).toEqual(['fit-checks.md']);
  });

  it('adds to a log that’s there already', () => {
    mkdirSync(join(workspace, 'searches'));
    writeFileSync(
      join(workspace, 'searches', 'salary-checks.md'),
      '| Date | Company | Role | Estimate | Confidence | Link |\n|---|---|---|---|---|---|\n| 2026-10-01 | Initech | PM | $150k | low | |\n',
    );
    expect(
      addLogRow(workspace, 'salary-checks', {
        date: '2026-10-25',
        company: 'Acme',
        role: 'Staff',
        estimate: '$200k',
      }),
    ).toBe('Added the row to searches/salary-checks.md.');
    const rows = markdownTable(
      readFileSync(join(workspace, 'searches', 'salary-checks.md'), 'utf8'),
    );
    expect(rows.map((row) => row.company)).toEqual(['Initech', 'Acme']);
  });
});
