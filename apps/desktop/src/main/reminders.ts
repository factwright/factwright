import { readFile } from 'node:fs/promises';
import {
  type Call,
  callTitle,
  clockTime,
  isClockTime,
  isIsoDate,
  type Job,
  localDate,
} from '@factwright/core';
import { REMINDER_LEAD } from '../shared/reminders.ts';
import { saveJson, settled } from './claude/save.ts';

/** The longest the reminders wait before they look again, as a computer's clock can jump. */
const MAX_WAIT_MS = 60 * 60_000;

/** The most calls the file keeps as reminded of. A few weeks of calls is far fewer. */
const MAX_KEPT = 1000;

/** A reminder of a call: what it says, and the job to open when it's clicked. */
export interface CallReminder {
  jobId: string;
  callId: string;
  title: string;
  body: string;
}

/** When a call starts, by this computer's clock, or null for one with no time that reads. */
export function callStart(call: Pick<Call, 'onDate' | 'atTime'>): Date | null {
  if (!isIsoDate(call.onDate) || !isClockTime(call.atTime)) return null;
  const [year, month, day] = call.onDate.split('-').map(Number);
  const [hours, minutes] = call.atTime.split(':').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0);
}

/**
 * What a call's reminder says: "Panel interview with Northwind Labs at 2:00 PM", and whether
 * its prep sheet is ready.
 */
export function reminderFor(job: Job, call: Call): CallReminder {
  const at = `${call.kind === 'takehome' ? 'due at' : 'at'} ${clockTime(call.atTime ?? '00:00')}`;
  const prepped = job.callDocs.some((doc) => doc.callId === call.id && doc.kind === 'prep');
  return {
    jobId: job.id,
    callId: call.id,
    title: `${callTitle(job.company, call.kind)} ${at}`,
    body: prepped
      ? 'Your prep sheet is ready. Open Factwright to read it.'
      : 'No prep sheet yet. Open Factwright for Call prep.',
  };
}

/** A call at its day and time, so a call moved to another time gets a reminder of its own. */
const keyOf = (call: Call) => `${call.onDate} ${call.atTime} ${call.id}`;

/** What the file keeps: whether reminders are on, and the calls already reminded of. */
interface Kept {
  on: boolean;
  reminded: string[];
}

function parseKept(value: unknown): Kept | null {
  if (typeof value !== 'object' || value === null) return null;
  const { on, reminded } = value as Record<string, unknown>;
  if (typeof on !== 'boolean' || !Array.isArray(reminded)) return null;
  const keys = reminded.filter(
    (key): key is string => typeof key === 'string' && key.length <= 200,
  );
  return { on, reminded: keys.slice(-MAX_KEPT) };
}

export interface RemindersDeps {
  /** The file that keeps whether reminders are on, and the calls already reminded of. */
  file: string;
  /** The jobs as they are now. */
  jobs: () => readonly Job[];
  /** Shows a reminder. */
  notify: (reminder: CallReminder) => void;
  /** The clock. Tests set it. */
  now?: () => Date;
}

/**
 * Reminds the user of each booked call that has a time, an hour before it, once, as a calendar
 * would. While the app is closed nothing comes, so a call whose hour began meanwhile, such as
 * while the computer slept, gets its reminder as soon as the app looks again, until the call
 * starts. A call added or moved inside its last hour gets none: the user has just seen it. The
 * user can turn reminders off, on this computer.
 */
export class CallReminders {
  private readonly deps: RemindersDeps;
  private on = true;
  private reminded = new Set<string>();
  /** When the app first saw each call at its time. Those there when it started count as early. */
  private seen = new Map<string, number>();
  private looked = false;
  private started = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: RemindersDeps) {
    this.deps = deps;
  }

  private now(): number {
    return (this.deps.now?.() ?? new Date()).getTime();
  }

  /** Reads whether reminders are on, and which calls had theirs, then starts looking. */
  async start(): Promise<void> {
    try {
      await settled(this.deps.file);
      const kept = parseKept(JSON.parse(await readFile(this.deps.file, 'utf8')));
      if (kept) {
        this.on = kept.on;
        this.reminded = new Set(kept.reminded);
      }
    } catch {
      // No file yet, or one that doesn't read: reminders are on, and none came yet.
    }
    this.started = true;
    this.check();
  }

  /** Whether reminders come on this computer. */
  isOn(): boolean {
    return this.on;
  }

  /** Turns reminders on or off, and answers with where they stand. */
  async turn(on: boolean): Promise<boolean> {
    if (on && !this.on) {
      // Calls already in their last hour as reminders come back on have just been seen.
      const now = this.now();
      for (const call of this.booked()) this.seen.set(keyOf(call.call), now);
    }
    this.on = on;
    await this.save();
    this.check();
    return this.on;
  }

  /** Stops looking, as the app quits. */
  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** The calls with a time still booked, on jobs that aren't archived, with when each starts. */
  private booked(): { job: Job; call: Call; start: number }[] {
    return this.deps.jobs().flatMap((job) =>
      job.archived
        ? []
        : job.calls.flatMap((call) => {
            const start = call.state === 'scheduled' ? callStart(call) : null;
            return start ? [{ job, call, start: start.getTime() }] : [];
          }),
    );
  }

  /**
   * Shows the reminders that are due, and waits for the next. Called as the app starts, as the
   * jobs change, and as the computer wakes.
   */
  check(): void {
    if (!this.started || this.stopped) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const now = this.now();
    const booked = this.booked();
    const present = new Set<string>();
    for (const { call } of booked) {
      const key = keyOf(call);
      present.add(key);
      // The calls there as the app starts count as seen early, so their reminders come.
      if (!this.seen.has(key)) this.seen.set(key, this.looked ? now : Number.NEGATIVE_INFINITY);
    }
    this.looked = true;
    for (const key of this.seen.keys()) if (!present.has(key)) this.seen.delete(key);
    if (!this.on) return;

    const lead = REMINDER_LEAD * 60_000;
    let next = Number.POSITIVE_INFINITY;
    let changed = this.forgetPast(now);
    for (const { job, call, start } of booked) {
      const key = keyOf(call);
      const at = start - lead;
      const early = (this.seen.get(key) ?? now) <= at;
      if (this.reminded.has(key) || !early || start <= now) continue;
      if (at > now) {
        next = Math.min(next, at);
        continue;
      }
      this.reminded.add(key);
      changed = true;
      try {
        this.deps.notify(reminderFor(job, call));
      } catch {
        // One reminder that can't show doesn't keep the others from showing.
      }
    }
    if (changed) void this.save();
    const wait = Math.min(Math.max(next - now, 1000), MAX_WAIT_MS);
    this.timer = setTimeout(() => this.check(), wait);
  }

  /** Forgets the calls reminded of before yesterday, so the file stays small. */
  private forgetPast(now: number): boolean {
    const yesterday = localDate(new Date(now - 24 * 60 * 60_000));
    let changed = false;
    for (const key of this.reminded) {
      const day = key.slice(0, 10);
      if (!isIsoDate(day) || day < yesterday) {
        this.reminded.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  private async save(): Promise<void> {
    const kept: Kept = { on: this.on, reminded: [...this.reminded].slice(-MAX_KEPT) };
    try {
      await saveJson(this.deps.file, kept);
    } catch {
      // Unsaved, the choice and the reminders already shown hold until the app quits.
    }
  }
}
