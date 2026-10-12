import { describe, expect, it } from 'vitest';
import { askedFile, readJobExtras, shotsFolder } from './extras.ts';
import type { WorkspaceEntry, WorkspaceReader } from './records.ts';

const MODIFIED = '2026-10-12T15:00:00.000Z';

/** A workspace held in memory: file paths and their text. Folders come from the paths. */
function memoryWorkspace(files: Record<string, string>): WorkspaceReader {
  return {
    readText: (path) => (Object.hasOwn(files, path) ? (files[path] ?? null) : null),
    list(path) {
      const entries = new Map<string, WorkspaceEntry>();
      for (const [file, content] of Object.entries(files)) {
        if (!file.startsWith(`${path}/`)) continue;
        const [name = '', ...rest] = file.slice(path.length + 1).split('/');
        const folder = rest.length > 0;
        entries.set(name, { name, folder, size: folder ? 0 : content.length, modified: MODIFIED });
      }
      return [...entries.values()].reverse();
    },
  };
}

const JOB = 'acme-robotics--staff-engineer';
const ASK = '2026-10-12-what-should-i-expect';

describe('readJobExtras', () => {
  it('reads Claude’s answers to the user’s questions about a job, by the question’s ID', () => {
    const workspace = memoryWorkspace({
      [askedFile(JOB, ASK)]: '# What should I expect?\n\nA short screen.',
      [`asked/${JOB}/notes.md`]: 'Not one of the user’s questions.',
      [`asked/${JOB}/${ASK}.md.bak`]: 'Not an answer.',
      [`asked/other--job/${ASK}.md`]: 'Another job’s answer.',
    });
    expect(readJobExtras(workspace, JOB).asked).toEqual({
      [ASK]: '# What should I expect?\n\nA short screen.',
    });
  });

  it('reads the job’s screenshots, saying what each was added with', () => {
    const shot = (name: string) => `${shotsFolder(JOB)}/${name}`;
    const workspace = memoryWorkspace({
      [shot('form-2026-10-12-1.png')]: 'png',
      [shot(`ask-${ASK}-1.jpg`)]: 'jpg',
      [shot('pasted-2026-10-12-093000.png')]: 'png',
      [shot('whiteboard.webp')]: 'webp',
      [shot('readme.txt')]: 'not a screenshot',
      [shot('old/form-2026-10-01-1.png')]: 'in a folder',
    });
    expect(readJobExtras(workspace, JOB).shots).toEqual([
      {
        path: shot(`ask-${ASK}-1.jpg`),
        name: `ask-${ASK}-1.jpg`,
        kind: 'ask',
        ask: ASK,
        size: 3,
        modified: MODIFIED,
      },
      {
        path: shot('form-2026-10-12-1.png'),
        name: 'form-2026-10-12-1.png',
        kind: 'form',
        ask: null,
        size: 3,
        modified: MODIFIED,
      },
      {
        path: shot('pasted-2026-10-12-093000.png'),
        name: 'pasted-2026-10-12-093000.png',
        kind: 'pasted',
        ask: null,
        size: 3,
        modified: MODIFIED,
      },
      {
        path: shot('whiteboard.webp'),
        name: 'whiteboard.webp',
        kind: 'other',
        ask: null,
        size: 4,
        modified: MODIFIED,
      },
    ]);
  });

  it('reads nothing for a job with nothing added', () => {
    expect(readJobExtras(memoryWorkspace({}), JOB)).toEqual({ asked: {}, shots: [] });
  });
});
