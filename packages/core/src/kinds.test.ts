import { describe, expect, it } from 'vitest';
import {
  KIND_ID,
  KIND_LIMITS,
  kindIdFor,
  kindNamed,
  kindNamesIn,
  kindOfJob,
  unnamedFirstKind,
} from './kinds.ts';

const KINDS = [
  { id: 'developer', name: 'Developer' },
  { id: 'project-manager', name: 'Project manager' },
];

describe('kindNamed', () => {
  it('finds a kind by its id or its name, however it’s written', () => {
    expect(kindNamed('project-manager', KINDS)).toBe('project-manager');
    expect(kindNamed('Project manager', KINDS)).toBe('project-manager');
    expect(kindNamed('PROJECT MANAGER', KINDS)).toBe('project-manager');
    expect(kindNamed(' `developer` ', KINDS)).toBe('developer');
    // As the tools show a kind, its name and its id.
    expect(kindNamed('Project manager (`project-manager`)', KINDS)).toBe('project-manager');
    // A name in backticks, or beside an id that isn't one, still finds its kind.
    expect(kindNamed('`Project manager`', KINDS)).toBe('project-manager');
    expect(kindNamed('Project manager (`pm`)', KINDS)).toBe('project-manager');
  });

  it('finds nothing for a kind the user doesn’t have, or for nothing said', () => {
    expect(kindNamed('designer', KINDS)).toBeNull();
    expect(kindNamed('', KINDS)).toBeNull();
    expect(kindNamed(null, KINDS)).toBeNull();
    expect(kindNamed('Designer (`designer`)', KINDS)).toBeNull();
    // Words slug can't keep match nothing, not a kind whose name it can't keep either.
    const nurse = [...KINDS, { id: 'kind', name: '看護師' }];
    expect(kindNamed('—', nurse)).toBeNull();
    expect(kindNamed('?', nurse)).toBeNull();
    expect(kindNamed('看護師', nurse)).toBe('kind');
  });
});

describe('kindOfJob', () => {
  it('goes by the user’s choice, then what the search or fit check found', () => {
    expect(kindOfJob({ kind: 'developer', kindFound: 'project-manager' }, KINDS)).toBe('developer');
    expect(kindOfJob({ kind: null, kindFound: 'Project manager' }, KINDS)).toBe('project-manager');
  });

  it('puts a job under the first kind when nothing names one the user has', () => {
    expect(kindOfJob({ kind: null, kindFound: null }, KINDS)).toBe('developer');
    expect(kindOfJob({ kind: 'removed-kind', kindFound: 'designer' }, KINDS)).toBe('developer');
    expect(kindOfJob({ kind: null, kindFound: null }, [])).toBeNull();
  });
});

describe('kindNamesIn', () => {
  it('reads the first kind and each other one, as the app keeps them', () => {
    expect(
      kindNamesIn({
        first: { id: 'developer', name: 'Developer' },
        others: [
          { id: 'project-manager', name: ' Project\n manager ', roles: ['TPM'] },
          { id: 'Bad Id', name: 'Broken' },
          { id: 'pm-2', name: 'project manager' },
          { id: 'developer', name: 'Another developer' },
        ],
      }),
    ).toEqual([
      { id: 'developer', name: 'Developer' },
      { id: 'project-manager', name: 'Project manager' },
    ]);
  });

  it('is none with one kind, and names a first kind the file leaves out for what it is', () => {
    expect(kindNamesIn({ first: { id: 'developer', name: 'Developer' }, others: [] })).toEqual([]);
    expect(kindNamesIn(null)).toEqual([]);
    const pm = { id: 'project-manager', name: 'Project manager' };
    expect(kindNamesIn({ first: { id: 'Bad Id', name: 'Developer' }, others: [pm] })).toEqual([
      { id: 'your-first-kind-of-job', name: 'Your first kind of job' },
      pm,
    ]);
    expect(unnamedFirstKind(['your-first-kind-of-job']).id).toBe('your-first-kind-of-job-2');
  });

  it('keeps as many as the app keeps, counting one that repeats the first, as the app does', () => {
    const others = Array.from({ length: 9 }, (_, n) => ({ id: `kind-${n}`, name: `Kind ${n}` }));
    const first = { id: 'a', name: 'A' };
    expect(kindNamesIn({ first, others })).toHaveLength(KIND_LIMITS.kinds);
    // The first over again takes a place in the count, then is left out.
    expect(kindNamesIn({ first, others: [{ id: 'b', name: 'a' }, ...others] })).toHaveLength(
      KIND_LIMITS.kinds - 1,
    );
  });
});

describe('kindIdFor', () => {
  it('makes an id from a name, unlike the ones taken, that Windows can hold as a folder', () => {
    expect(kindIdFor('Project manager', [])).toBe('project-manager');
    expect(kindIdFor('Project manager', ['project-manager'])).toBe('project-manager-2');
    expect(kindIdFor('PRN', [])).toBe('prn-jobs');
    expect(kindIdFor('看護師', [])).toBe('kind');
  });
});

describe('KIND_ID', () => {
  it('takes a few lowercase words with hyphens, and nothing that could leave a folder', () => {
    for (const id of ['developer', 'project-manager', 'kind-2'])
      expect(KIND_ID.test(id)).toBe(true);
    for (const id of ['', '-lead', 'Developer', '../base', 'a/b', 'x'.repeat(41), 'prn', 'aux']) {
      expect(KIND_ID.test(id)).toBe(false);
    }
  });
});

describe('kindNamed on long text', () => {
  /** How long a call takes, in milliseconds. */
  function timed(run: () => unknown): number {
    const start = Date.now();
    run();
    return Date.now() - start;
  }

  it('reads text of any length at once', () => {
    const tabs = `${'\t'.repeat(100_000)}x`;
    expect(timed(() => expect(kindNamed(tabs, KINDS)).toBeNull())).toBeLessThan(1000);
    const parentheses = `Project manager ${'('.repeat(50_000)}`;
    expect(timed(() => kindNamed(parentheses, KINDS))).toBeLessThan(1000);
    expect(kindNamed(parentheses, KINDS)).toBe('project-manager');
  });
});
