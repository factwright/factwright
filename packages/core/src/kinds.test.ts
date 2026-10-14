import { describe, expect, it } from 'vitest';
import { KIND_ID, kindNamed, kindOfJob } from './kinds.ts';

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
  });

  it('finds nothing for a kind the user doesn’t have, or for nothing said', () => {
    expect(kindNamed('designer', KINDS)).toBeNull();
    expect(kindNamed('', KINDS)).toBeNull();
    expect(kindNamed(null, KINDS)).toBeNull();
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

describe('KIND_ID', () => {
  it('takes a few lowercase words with hyphens, and nothing that could leave a folder', () => {
    for (const id of ['developer', 'project-manager', 'kind-2'])
      expect(KIND_ID.test(id)).toBe(true);
    for (const id of ['', '-lead', 'Developer', '../base', 'a/b', 'x'.repeat(41)]) {
      expect(KIND_ID.test(id)).toBe(false);
    }
  });
});
