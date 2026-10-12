import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CollectedJob } from '@factwright/core';
import { type Account, startServer, type TestServer } from '@factwright/server/testing';
import { accountKeys, type Bytes, newAccountKey } from '@factwright/sync';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type EditContext, Tracker } from '../jobs/tracker.ts';
import { SyncEngine } from './engine.ts';
import { SyncState } from './state.ts';

const AT: EditContext = { today: '2026-10-12', now: '2026-10-12T09:00:00.000Z' };
const OCT_12 = () => new Date('2026-10-12T09:30:00');

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

const job = (id: string): CollectedJob => ({
  id,
  company: 'Acme Robotics',
  companyKey: 'acme-robotics',
  role: 'Staff Engineer',
  link: null,
  links: [{ url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' }],
  location: null,
  pay: null,
  source: 'Fit check',
  fit: null,
  search: null,
  folder: null,
  stage: 'checked',
  firstSeen: '2026-10-07',
  lastActivity: '2026-10-07',
  summary: null,
  events: [],
  docs: {},
  apply: null,
  fitReport: null,
  sentiment: null,
  files: [],
});

/** A computer with its own workspace, tracker and sync notes, signed in to the account. */
async function computer(name: string, account: Account, accountKey: Bytes) {
  const folder = mkdtempSync(join(tmpdir(), 'factwright-sync-'));
  const workspace = join(folder, 'workspace');
  mkdirSync(workspace);
  const tracker = new Tracker(join(folder, 'tracker.db'));
  const state = new SyncState(join(folder, 'sync.db'));
  const session = await server.newSession(account.id);
  const engine = new SyncEngine({
    client: session.client,
    keys: await accountKeys(accountKey),
    state,
    tracker,
    workspace,
    device: name,
    now: OCT_12,
  });
  const at = (path: string) => join(workspace, ...path.split('/'));
  return {
    workspace,
    tracker,
    sync: () => engine.syncOnce(),
    write(path: string, text: string | Uint8Array) {
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), text);
    },
    read: (path: string) => (existsSync(at(path)) ? readFileSync(at(path), 'utf8') : null),
    remove: (path: string) => rmSync(at(path)),
    has: (path: string) => existsSync(at(path)),
    close() {
      tracker.close();
      state.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

type Computer = Awaited<ReturnType<typeof computer>>;

let mac: Computer;
let pc: Computer;

beforeEach(async () => {
  const account = await server.signUp();
  const accountKey = newAccountKey();
  mac = await computer('Sam’s Mac', account, accountKey);
  pc = await computer('Sam’s PC', account, accountKey);
});

afterEach(() => {
  mac?.close();
  pc?.close();
});

describe('two computers on one account', () => {
  it('show the same job hunt: every file, and everything tracked', async () => {
    mac.write('facts/skills.md', '# Skills\n- TypeScript');
    mac.write('applications/acme--staff/posting.md', '# Staff Engineer at Acme');
    mac.write('applications/acme--staff/resume.pdf', new Uint8Array([37, 80, 68, 70, 0, 255]));
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    mac.tracker.updateJob('acme--staff', { status: 'applied', notes: 'Recruiter: Sam' }, AT);
    mac.tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-14' }, AT);

    expect(await mac.sync()).toMatchObject({ pushed: 7, pulled: 0, conflicts: 0 });
    expect(await pc.sync()).toMatchObject({ pulled: 7, pushed: 0 });

    expect(pc.read('facts/skills.md')).toBe('# Skills\n- TypeScript');
    expect(pc.read('applications/acme--staff/posting.md')).toBe('# Staff Engineer at Acme');
    expect(
      new Uint8Array(readFileSync(join(pc.workspace, 'applications/acme--staff/resume.pdf'))),
    ).toEqual(new Uint8Array([37, 80, 68, 70, 0, 255]));
    expect(pc.tracker.rows()).toEqual(mac.tracker.rows());
    expect(pc.tracker.calls()).toEqual(mac.tracker.calls());
    expect(pc.tracker.history()).toEqual(mac.tracker.history());
  });

  it('send changes both ways, and nothing that didn’t change', async () => {
    mac.write('facts/skills.md', 'v1');
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    await mac.sync();
    await pc.sync();
    expect(await pc.sync()).toMatchObject({ pushed: 0, pulled: 0 });

    pc.write('facts/skills.md', 'v2 from the PC');
    pc.tracker.updateJob('acme--staff', { nextAction: 'Follow up', nextOn: '2026-10-20' }, AT);
    expect(await pc.sync()).toMatchObject({ pushed: 2 });
    expect(await mac.sync()).toMatchObject({ pulled: 2, pushed: 0 });
    expect(mac.read('facts/skills.md')).toBe('v2 from the PC');
    expect(mac.tracker.rows()[0]).toMatchObject({ nextAction: 'Follow up', nextOn: '2026-10-20' });
  });

  it('delete everywhere what’s deleted on one, with folders it leaves empty', async () => {
    mac.write('applications/globex/posting.md', 'Globex');
    mac.write('facts/skills.md', 'Skills');
    await mac.sync();
    await pc.sync();
    mac.remove('applications/globex/posting.md');
    await mac.sync();
    expect(await pc.sync()).toMatchObject({ pulled: 1 });
    expect(pc.has('applications/globex/posting.md')).toBe(false);
    expect(pc.has('applications/globex')).toBe(false);
    expect(pc.read('facts/skills.md')).toBe('Skills');
  });

  it('keep both copies of a file both changed', async () => {
    mac.write('facts/skills.md', 'first');
    await mac.sync();
    await pc.sync();
    mac.write('facts/skills.md', 'the Mac’s change');
    pc.write('facts/skills.md', 'the PC’s change');
    await mac.sync();
    expect(await pc.sync()).toMatchObject({ conflicts: 1 });
    expect(pc.read('facts/skills.md')).toBe('the Mac’s change');
    expect(pc.read('facts/skills (Sam’s PC, Oct 12).md')).toBe('the PC’s change');
    await mac.sync();
    expect(mac.read('facts/skills (Sam’s PC, Oct 12).md')).toBe('the PC’s change');
    expect(mac.read('facts/skills.md')).toBe('the Mac’s change');
  });

  it('merge a job both changed, keeping both notes', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    mac.tracker.updateJob('acme--staff', { notes: 'Recruiter: Sam' }, AT);
    await mac.sync();
    await pc.sync();
    const later: EditContext = { today: '2026-10-13', now: '2026-10-13T09:00:00.000Z' };
    mac.tracker.updateJob('acme--staff', { notes: 'Recruiter: Sam. Salary band shared.' }, later);
    pc.tracker.updateJob('acme--staff', { status: 'interview', notes: 'Referred by Priya' }, later);
    await mac.sync();
    expect(await pc.sync()).toMatchObject({ conflicts: 1 });
    await mac.sync();
    for (const each of [mac, pc]) {
      expect(each.tracker.rows()[0]).toMatchObject({
        status: 'interview',
        notes: 'Referred by Priya\n\nFrom Sam’s Mac:\nRecruiter: Sam. Salary band shared.',
      });
    }
    expect(mac.tracker.history()).toEqual(pc.tracker.history());
  });

  it('bring back a file deleted on one computer while the other changed it', async () => {
    mac.write('facts/skills.md', 'first');
    await mac.sync();
    await pc.sync();
    mac.remove('facts/skills.md');
    pc.write('facts/skills.md', 'changed on the PC');
    await mac.sync();
    await pc.sync();
    await mac.sync();
    expect(mac.read('facts/skills.md')).toBe('changed on the PC');
    expect(pc.read('facts/skills.md')).toBe('changed on the PC');
  });

  it('leave files another computer can’t hold where they are, and don’t delete them elsewhere', async () => {
    mac.write('facts/what?.md', 'A name Windows can’t hold');
    mac.write('.hidden/state.json', '{}');
    const report = await mac.sync();
    expect(report.skipped).toEqual([{ path: 'facts/what?.md', reason: 'name' }]);
    expect(report.pushed).toBe(0);
    await pc.sync();
    expect(pc.has('facts/what?.md')).toBe(false);
    expect(pc.has('.hidden/state.json')).toBe(false);
  });

  it('send the same contents once, however many files hold them', async () => {
    mac.write('applications/a/resume.pdf', 'same');
    mac.write('applications/b/resume.pdf', 'same');
    await mac.sync();
    expect((await mac.tracker.rows()).length).toBe(0);
    await pc.sync();
    expect(pc.read('applications/b/resume.pdf')).toBe('same');
  });
});
