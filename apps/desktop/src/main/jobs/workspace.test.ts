import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diskWorkspace, watchWorkspace, workspaceDir } from './workspace.ts';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-workspace-'));
  outside = mkdtempSync(join(tmpdir(), 'factwright-outside-'));
  mkdirSync(join(root, 'applications', 'acme'), { recursive: true });
  writeFileSync(join(root, 'applications', 'acme', 'job.md'), '# Acme: Staff Engineer');
  writeFileSync(join(outside, 'secret.md'), 'Not for the app');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('workspaceDir', () => {
  it('is the workspace folder inside the app’s data folder', () => {
    expect(workspaceDir(join('data', 'Factwright'))).toBe(join('data', 'Factwright', 'workspace'));
  });
});

describe('diskWorkspace', () => {
  it('reads files and lists folders', () => {
    const workspace = diskWorkspace(root);
    expect(workspace.readText('applications/acme/job.md')).toBe('# Acme: Staff Engineer');
    expect(workspace.readText('applications/acme/missing.md')).toBeNull();
    expect(workspace.list('applications')).toEqual([
      { name: 'acme', folder: true, size: expect.any(Number), modified: expect.any(String) },
    ]);
    expect(workspace.list('applications/acme')).toEqual([
      { name: 'job.md', folder: false, size: 22, modified: expect.stringMatching(/Z$/) },
    ]);
    expect(workspace.list('searches')).toEqual([]);
  });

  it('stays inside the workspace', () => {
    const workspace = diskWorkspace(root);
    expect(workspace.readText(`../${outside.split(/[\\/]/).at(-1)}/secret.md`)).toBeNull();
    expect(workspace.list('..')).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('skips links to elsewhere', () => {
    symlinkSync(outside, join(root, 'applications', 'linked'));
    expect(
      diskWorkspace(root)
        .list('applications')
        .map((entry) => entry.name),
    ).toEqual(['acme']);
  });
});

describe('watchWorkspace', () => {
  it('calls back once things go quiet after a change', async () => {
    const changed = vi.fn();
    const stop = watchWorkspace(root, changed, 50);
    // macOS starts watching a moment after watch() returns, so touch a file until it's listening.
    await vi.waitFor(
      () => {
        writeFileSync(join(root, 'warm-up.md'), 'Warming up');
        expect(changed).toHaveBeenCalled();
      },
      { timeout: 3000, interval: 200 },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    changed.mockClear();
    writeFileSync(join(root, 'applications', 'acme', 'posting.md'), 'The posting');
    writeFileSync(join(root, 'applications', 'acme', 'fit-check.md'), 'The fit check');
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1), { timeout: 2000 });
    stop();
  });

  it('does nothing for a folder that isn’t there', () => {
    const stop = watchWorkspace(join(root, 'missing'), vi.fn());
    expect(stop).not.toThrow();
  });
});
