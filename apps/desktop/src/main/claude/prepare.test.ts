import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileRequests } from '../about/profile-requests.ts';
import { taskPreparer } from './prepare.ts';

let dataDir: string;
let held: ProfileRequests;

const prepare = () =>
  taskPreparer({
    dataDir,
    revisions: { claim: vi.fn(), release: vi.fn(), record: vi.fn() },
    versions: { claimChanges: vi.fn(), releaseChanges: vi.fn() },
    profileRequests: held,
  });

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factwright-prepare-'));
  held = new ProfileRequests();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const taskFor = (request: string) =>
  ({ skill: 'update-profile', part: 'leaving', request }) as const;

describe('a task on a part of Profile, as it starts', () => {
  it('reads the words held for it, for its own tool calls, with its part’s scope', async () => {
    const request = held.hold({ part: 'leaving', changes: 'Make it warmer' });
    const prepared = await prepare()(taskFor(request));
    if (!prepared.ok) throw new Error(prepared.problem);
    expect(prepared.options.scope).toBe('part:leaving');
    expect(prepared.options.prompt).toBe('/factwright:update-profile leaving');
    expect(prepared.options.changes).toMatchObject({ part: 'leaving', changes: 'Make it warmer' });
    // Its words reach it through requested_changes alone.
    expect(prepared.options.prompt).not.toContain('warmer');
  });

  it('says so when no words are held, as after a restart', async () => {
    expect(await prepare()(taskFor('0000000000000000'))).toEqual({
      ok: false,
      problem: 'profile-changes',
    });
  });

  it('finds the same words when it starts again, as Try again does', async () => {
    const request = held.hold({ part: 'leaving', changes: 'Make it warmer' });
    for (const started of [true, false]) {
      const prepared = await prepare()(taskFor(request));
      if (!prepared.ok) throw new Error(prepared.problem);
      await prepared.started(started);
    }
    const again = await prepare()(taskFor(request));
    if (!again.ok) throw new Error(again.problem);
    expect(again.options.changes).toMatchObject({ changes: 'Make it warmer' });
  });
});
