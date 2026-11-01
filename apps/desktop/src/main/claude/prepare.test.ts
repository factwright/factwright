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

const TASK = { skill: 'update-profile', part: 'leaving' } as const;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factwright-prepare-'));
  held = new ProfileRequests();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('a task on a part of Profile, as it starts', () => {
  it('claims the words held for it, for its own tool calls, with its part’s scope', async () => {
    held.hold({ part: 'leaving', changes: 'Make it warmer' });
    const prepared = await prepare()(TASK);
    if (!prepared.ok) throw new Error(prepared.problem);
    expect(prepared.options.scope).toBe('part:leaving');
    expect(prepared.options.prompt).toBe('/factwright:update-profile leaving');
    expect(prepared.options.changes).toMatchObject({ part: 'leaving', changes: 'Make it warmer' });
    // Its words reach it through requested_changes alone.
    expect(prepared.options.prompt).not.toContain('warmer');
  });

  it('says so when no words are held, as after a restart', async () => {
    expect(await prepare()(TASK)).toEqual({ ok: false, problem: 'profile-changes' });
  });

  it('lets go of the words when its run didn’t start, so starting it again finds them', async () => {
    held.hold({ part: 'leaving', changes: 'Make it warmer' });
    const prepared = await prepare()(TASK);
    if (!prepared.ok) throw new Error(prepared.problem);
    await prepared.started(false);
    expect(held.claim('leaving', undefined)?.changes).toBe('Make it warmer');
  });

  it('holds on to them once its run started', async () => {
    held.hold({ part: 'leaving', changes: 'Make it warmer' });
    const prepared = await prepare()(TASK);
    if (!prepared.ok) throw new Error(prepared.problem);
    await prepared.started(true);
    expect(held.claim('leaving', undefined)).toBeNull();
  });
});
