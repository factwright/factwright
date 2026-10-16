import { describe, expect, it } from 'vitest';
import {
  askAnswer,
  askedFile,
  callDocFile,
  readAllCallDocs,
  readCallDocs,
  readJobExtras,
  savedPostingFile,
  savedPostingMarkdown,
  shotsFolder,
} from './extras.ts';
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

describe('askAnswer', () => {
  it('shows an answer without the question and dates on top, and when it was answered', () => {
    expect(
      askAnswer(
        '# What should I expect?\n\nAsked 2026-10-11. Answered 2026-10-12.\n\nA short screen.\n\n## Sources\n- Their blog\n',
      ),
    ).toEqual({ body: 'A short screen.\n\n## Sources\n- Their blog', answeredOn: '2026-10-12' });
  });

  it('shows an answer saved some other way as it is', () => {
    expect(askAnswer('A short screen.')).toEqual({ body: 'A short screen.', answeredOn: null });
    expect(askAnswer('# Notes\n\nA short screen.')).toEqual({
      body: 'A short screen.',
      answeredOn: null,
    });
  });
});

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
    expect(readJobExtras(memoryWorkspace({}), JOB)).toEqual({
      asked: {},
      shots: [],
      posting: null,
      calls: {},
    });
  });

  it('reads Claude’s prep sheets and thank-you notes for each of the job’s calls', () => {
    const workspace = memoryWorkspace({
      [callDocFile(JOB, 'call-1', 'prep')]: '# Prep: Acme',
      [callDocFile(JOB, 'call-1', 'thanks')]: '## Dana Lee\n\nThanks!',
      [callDocFile(JOB, 'call-2', 'prep')]: '# Prep: Acme, the panel',
      // Not a call's document: a note of the user's own, and a folder no call could have.
      [`calls/${JOB}/call-2/notes.md`]: 'Mine',
      [`calls/${JOB}/../prep.md`]: 'Out of place',
      [`calls/${JOB}/Call 3/prep.md`]: 'Not an ID',
    });
    expect(readJobExtras(workspace, JOB).calls).toEqual({
      'call-1': { prep: '# Prep: Acme', thanks: '## Dana Lee\n\nThanks!' },
      'call-2': { prep: '# Prep: Acme, the panel' },
    });
    expect(readCallDocs(workspace, JOB)).toEqual([
      {
        callId: 'call-1',
        kind: 'prep',
        path: `calls/${JOB}/call-1/prep.md`,
        modified: MODIFIED,
      },
      {
        callId: 'call-1',
        kind: 'thanks',
        path: `calls/${JOB}/call-1/thank-you.md`,
        modified: MODIFIED,
      },
      {
        callId: 'call-2',
        kind: 'prep',
        path: `calls/${JOB}/call-2/prep.md`,
        modified: MODIFIED,
      },
    ]);
    expect(readAllCallDocs(workspace)).toEqual(new Map([[JOB, readCallDocs(workspace, JOB)]]));
    expect(readAllCallDocs(memoryWorkspace({}))).toEqual(new Map());
  });
});

describe('a posting saved from the browser', () => {
  it('is read back with its link and date, without the lines on top', () => {
    const markdown = savedPostingMarkdown({
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
      site: 'linkedin.com',
      savedOn: '2026-10-15',
      text: 'About the job\n\nBuild payments at scale.',
    });
    expect(markdown).toContain('- **Source:** https://www.linkedin.com/jobs/view/4012345678/');
    const { posting } = readJobExtras(memoryWorkspace({ [savedPostingFile(JOB)]: markdown }), JOB);
    expect(posting).toEqual({
      path: `saved/${JOB}/posting.md`,
      source: 'https://www.linkedin.com/jobs/view/4012345678/',
      saved: '2026-10-15',
      text: 'About the job\n\nBuild payments at scale.',
    });
  });

  it('is nothing when there isn’t one, or it’s empty', () => {
    expect(readJobExtras(memoryWorkspace({}), JOB).posting).toBeNull();
    const empty = savedPostingMarkdown({
      url: 'https://a.example/1',
      site: 'a.example',
      savedOn: '2026-10-15',
      text: ' ',
    });
    expect(
      readJobExtras(memoryWorkspace({ [savedPostingFile(JOB)]: empty }), JOB).posting,
    ).toBeNull();
  });
});
