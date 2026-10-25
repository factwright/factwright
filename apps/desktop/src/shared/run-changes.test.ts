import { describe, expect, it } from 'vitest';
import { isWorkspacePath, lineCounts, lineDiff, linesOf } from './run-changes.ts';

describe('lineDiff', () => {
  it('keeps the lines both texts have, and marks what was taken out and put in', () => {
    expect(lineDiff('a\nb\nc\nd\n', 'a\nc\nx\nd\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'd' },
    ]);
  });

  it('reads a new file as all put in, and a gone one as all taken out', () => {
    expect(lineDiff('', 'one\ntwo')).toEqual([
      { kind: 'added', text: 'one' },
      { kind: 'added', text: 'two' },
    ]);
    expect(lineCounts('one\ntwo\n', '')).toEqual({ added: 0, removed: 2 });
  });

  it('reads Windows’s line endings as any other, and a last line ending as no line', () => {
    expect(linesOf('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(lineCounts('a\r\nb\r\n', 'a\nb\n')).toEqual({ added: 0, removed: 0 });
    expect(linesOf('')).toEqual([]);
  });

  it('counts a long file with one change quickly, and a huge rewrite as replaced', () => {
    const long = Array.from({ length: 50_000 }, (_, i) => `Line ${i}`);
    const changed = [...long];
    changed[25_000] = 'Changed';
    expect(lineCounts(long.join('\n'), changed.join('\n'))).toEqual({ added: 1, removed: 1 });
    const other = long.map((line) => `${line}!`);
    expect(lineCounts(long.join('\n'), other.join('\n'))).toEqual({
      added: 50_000,
      removed: 50_000,
    });
  });
});

describe('isWorkspacePath', () => {
  it('takes a plain path in the workspace, and nothing that could lead out of it', () => {
    expect(isWorkspacePath('applications/acme/job.md')).toBe(true);
    for (const path of ['', '/etc/passwd', '../x', 'a/../b', 'a//b', 'C:/x', 'a\\b', 'a\nb', 3]) {
      expect(isWorkspacePath(path)).toBe(false);
    }
  });
});
