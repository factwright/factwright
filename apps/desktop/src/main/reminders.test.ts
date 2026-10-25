import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Call, type CallDoc, callStart, type Job } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settled } from './claude/save.ts';
import { type CallReminder, CallReminders, reminderFor } from './reminders.ts';

let dataDir: string;
let file: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factwright-reminders-'));
  file = join(dataDir, 'call-reminders.json');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  // Tuesday, October 20, 2026, at noon on this computer's clock.
  vi.setSystemTime(new Date(2026, 9, 20, 12, 0));
});

afterEach(async () => {
  vi.useRealTimers();
  // A save still under way would write into the folder as it's removed.
  await settled(file);
  rmSync(dataDir, { recursive: true, force: true });
});

const TODAY = '2026-10-20';

function call(extra: Partial<Call> = {}): Call {
  return {
    id: 'northwind-panel',
    kind: 'panel',
    onDate: TODAY,
    atTime: '14:00',
    minutes: 60,
    mode: 'video',
    place: 'https://meet.example.com/northwind-panel',
    people: [{ name: 'Dana Lee', role: 'Hiring manager' }],
    state: 'scheduled',
    outcome: null,
    notes: null,
    debrief: null,
    ...extra,
  };
}

const prep = (callId: string): CallDoc => ({
  callId,
  kind: 'prep',
  path: `calls/northwind/${callId}/prep.md`,
  modified: '2026-10-19T18:00:00.000Z',
});

function job(extra: Partial<Job> = {}): Job {
  return {
    id: 'northwind-labs--senior-software-engineer-platform',
    company: 'Northwind Labs',
    companyKey: 'northwind-labs',
    role: 'Senior Software Engineer, Platform',
    link: null,
    links: [],
    location: null,
    pay: null,
    source: 'Fit check',
    fit: null,
    search: null,
    searches: [],
    kindFound: null,
    suggestedAsk: null,
    folder: null,
    stage: 'review',
    firstSeen: '2026-10-01',
    lastActivity: '2026-10-01',
    summary: null,
    events: [],
    apply: null,
    fitReport: null,
    sentiment: null,
    files: [],
    letters: [],
    projectPages: [],
    outreach: [],
    status: 'interview',
    statusOn: '2026-10-10',
    backOn: null,
    passReason: null,
    appliedOn: '2026-10-01',
    nextAction: null,
    nextOn: null,
    questions: [],
    sent: [],
    asks: [],
    earlierNotes: null,
    archived: false,
    kind: null,
    payAsk: null,
    manual: false,
    calls: [call()],
    callDocs: [],
    statusLog: [],
    notes: [],
    docKinds: [],
    ...extra,
  };
}

/** Reminders over some jobs, which a test can change, with every reminder shown kept. */
function reminders(jobs: Job[] = [job()], notify = vi.fn<(reminder: CallReminder) => void>()) {
  const list = { jobs };
  const watcher = new CallReminders({ file, jobs: () => list.jobs, notify });
  return { watcher, notify, list };
}

/** Moves the clock on to a time today, running what was waiting for it. */
const at = (hours: number, minutes = 0) =>
  vi.advanceTimersByTime(new Date(2026, 9, 20, hours, minutes).getTime() - Date.now());

describe('reminders before calls', () => {
  it('reminds of a call an hour before it, once, saying its prep sheet is ready', async () => {
    const { watcher, notify } = reminders([job({ callDocs: [prep('northwind-panel')] })]);
    await watcher.start();
    at(12, 59);
    expect(notify).not.toHaveBeenCalled();
    at(13, 0);
    expect(notify).toHaveBeenCalledWith({
      jobId: 'northwind-labs--senior-software-engineer-platform',
      callId: 'northwind-panel',
      title: 'Panel interview with Northwind Labs at 2:00 PM',
      body: 'Your prep sheet is ready. Open Factwright to read it.',
    });
    at(13, 45);
    watcher.check();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('says when there’s no prep sheet yet, and names a take-home’s time as when it’s due', () => {
    expect(reminderFor(job(), call()).body).toBe(
      'No prep sheet yet. Open Factwright for Call prep.',
    );
    expect(reminderFor(job(), call({ kind: 'takehome', atTime: '09:00' })).title).toBe(
      'Take-home for Northwind Labs due at 9:00 AM',
    );
    expect(reminderFor(job(), call({ kind: 'other' })).title).toBe(
      'Call with Northwind Labs at 2:00 PM',
    );
  });

  it('names the company on one line, without what hides or flips text, cut short if long', () => {
    const odd = job({ company: 'Acme\u202e\u000aMoved to 4:00 PM, rejoin at evil.example' });
    expect(reminderFor(odd, call()).title).toBe(
      'Panel interview with Acme Moved to 4:00 PM, rejoin at evil.example at 2:00 PM',
    );
    expect(reminderFor(job({ company: 'A'.repeat(300) }), call()).title).toBe(
      `Panel interview with ${'A'.repeat(80)} at 2:00 PM`,
    );
  });

  it('reminds straight away when the app starts in a call’s last hour, but not once it starts', async () => {
    vi.setSystemTime(new Date(2026, 9, 20, 13, 30));
    const first = reminders();
    await first.watcher.start();
    expect(first.notify).toHaveBeenCalledTimes(1);
    first.watcher.stop();
    rmSync(file, { force: true });
    vi.setSystemTime(new Date(2026, 9, 20, 14, 0));
    const late = reminders();
    await late.watcher.start();
    expect(late.notify).not.toHaveBeenCalled();
  });

  it('gives no reminder for a call added or moved in its last hour, as the user just saw it', async () => {
    const { watcher, notify, list } = reminders([job({ calls: [] })]);
    await watcher.start();
    at(13, 30);
    list.jobs = [job()];
    watcher.check();
    list.jobs = [job({ calls: [call({ id: 'moved', atTime: '16:00' })] })];
    watcher.check();
    at(14, 40);
    list.jobs = [job({ calls: [call({ id: 'moved', atTime: '15:00' })] })];
    watcher.check();
    at(15, 0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('reminds of a call added before its last hour, and again once it moves to another time', async () => {
    const { watcher, notify, list } = reminders([job({ calls: [] })]);
    await watcher.start();
    at(12, 30);
    list.jobs = [job()];
    watcher.check();
    at(13, 0);
    expect(notify).toHaveBeenCalledTimes(1);
    at(13, 10);
    list.jobs = [job({ calls: [call({ onDate: '2026-10-21', atTime: '10:00' })] })];
    watcher.check();
    vi.advanceTimersByTime(new Date(2026, 9, 21, 9, 0).getTime() - Date.now());
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('gives a call added in its last hour no reminder after a restart either', async () => {
    const first = reminders([job({ calls: [] })]);
    await first.watcher.start();
    at(13, 30);
    first.list.jobs = [job()];
    first.watcher.check();
    first.watcher.stop();
    at(13, 35);
    const second = reminders();
    await second.watcher.start();
    expect(first.notify).not.toHaveBeenCalled();
    expect(second.notify).not.toHaveBeenCalled();
  });

  it('reminds of a call that comes by sync in its last hour, as it was made before', async () => {
    const { watcher, notify, list } = reminders([job({ calls: [] })]);
    await watcher.start();
    // Asleep until 1:25, when another computer's call for 2:00 comes by sync.
    vi.setSystemTime(new Date(2026, 9, 20, 13, 25));
    list.jobs = [job()];
    watcher.check({ synced: true });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('catches up once the computer wakes in a call’s last hour', async () => {
    const { watcher, notify } = reminders();
    await watcher.start();
    // Asleep from noon to 1:40, so nothing ran at 1:00.
    vi.setSystemTime(new Date(2026, 9, 20, 13, 40));
    watcher.check();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('leaves out calls with no time, ones canceled or done, and archived jobs', async () => {
    const { watcher, notify } = reminders([
      job({
        calls: [
          call({ id: 'a', atTime: null }),
          call({ id: 'b', state: 'canceled' }),
          call({ id: 'c', state: 'done' }),
          call({ id: 'd', atTime: '25:00' }),
          call({ id: 'e', onDate: 'soon' }),
        ],
      }),
      job({ id: 'archived', archived: true }),
    ]);
    await watcher.start();
    at(13, 30);
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps reminding of the others when one can’t show', async () => {
    const notify = vi.fn((reminder: CallReminder) => {
      if (reminder.callId === 'first') throw new Error('No notifications here');
    });
    const { watcher } = reminders(
      [job({ calls: [call({ id: 'first' }), call({ id: 'second' })] })],
      notify,
    );
    await watcher.start();
    at(13, 0);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('can be turned off, and back on, which the next start remembers', async () => {
    const first = reminders([job({ calls: [call(), call({ id: 'later', atTime: '16:00' })] })]);
    await first.watcher.start();
    expect(first.watcher.isOn()).toBe(true);
    expect(await first.watcher.turn(false)).toBe(false);
    at(13, 0);
    expect(first.notify).not.toHaveBeenCalled();
    first.watcher.stop();

    const second = reminders([job({ calls: [call(), call({ id: 'later', atTime: '16:00' })] })]);
    await second.watcher.start();
    expect(second.watcher.isOn()).toBe(false);
    at(13, 30);
    expect(await second.watcher.turn(true)).toBe(true);
    // Back on inside the 2:00 call's last hour: none for it, but one for the 4:00 call.
    expect(second.notify).not.toHaveBeenCalled();
    at(15, 0);
    expect(second.notify).toHaveBeenCalledTimes(1);
    expect(second.notify.mock.calls[0]?.[0].callId).toBe('later');
  });

  it('gives a call one reminder, across a restart too', async () => {
    const first = reminders();
    await first.watcher.start();
    at(13, 0);
    expect(first.notify).toHaveBeenCalledTimes(1);
    first.watcher.stop();
    at(13, 5);
    const second = reminders();
    await second.watcher.start();
    expect(second.notify).not.toHaveBeenCalled();
  });

  it('forgets reminders of days gone, so its file stays small', async () => {
    const { watcher } = reminders([job({ calls: [call({ id: 'today' })] })]);
    await watcher.start();
    at(13, 0);
    await watcher.turn(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).reminded).toEqual(['2026-10-20 14:00 today']);
    vi.setSystemTime(new Date(2026, 9, 23, 9, 0));
    await watcher.turn(true);
    watcher.check();
    await watcher.turn(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ on: true, reminded: [] });
  });

  it('reads a file that doesn’t read as reminders on, with none shown yet', async () => {
    writeFileSync(file, '{"on": "maybe", "reminded": 7}');
    const { watcher, notify } = reminders();
    await watcher.start();
    expect(watcher.isOn()).toBe(true);
    at(13, 0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('stops looking as the app quits', async () => {
    const { watcher, notify } = reminders();
    await watcher.start();
    watcher.stop();
    at(13, 30);
    watcher.check();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('callStart', () => {
  it('is the call’s day and time on this computer’s clock, or null without a time that reads', () => {
    expect(callStart(call())?.getTime()).toBe(new Date(2026, 9, 20, 14, 0).getTime());
    expect(callStart(call({ atTime: null }))).toBeNull();
    expect(callStart(call({ atTime: '7:00' }))).toBeNull();
    expect(callStart(call({ onDate: '2026-02-30' }))).toBeNull();
  });
});
