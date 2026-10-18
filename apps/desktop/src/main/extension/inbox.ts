import { randomBytes } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { INBOX_JOB, type InboxAnswer, readSavedJob, type SavedJob } from '@factwright/core';

/**
 * The inbox Save to Factwright drops jobs in on this computer. The browser hands each job the
 * extension saves to the helper the app registers with it (apps/desktop/helper), which writes it
 * whole, as a file of its own, into the inbox of the profile open last, and does nothing else. The
 * app adds each job from there while it's open, and the ones that came while it was closed as it
 * starts, then deletes the file.
 *
 * While it's open, the inbox holds a marker with the app's process ID, so the helper knows to wait
 * a moment for the app's answer, which it hands back to the extension: the job's ID, whether the
 * job hunt had it already, and what became of its posting. With the app closed, the helper says
 * the job waits for it, at once.
 */

/** The marker that says the app is open on this profile, with its process ID. */
export const LISTENING = '.listening';

/** How old a job may be, by its name, for its answer to be written: the helper waits 3 seconds. */
const ANSWER_MS = 30_000;

/** How old a half-written job or an answer nobody took must be before it's cleaned away. */
const LEFTOVER_MS = 60_000;

/** How often it looks in the inbox anyway, as watching a folder can miss a change. */
const LOOK_MS = 30_000;

/** How long it waits after a change for the rest, so a burst of changes is one look. */
const SETTLE_MS = 25;

/** The biggest job file it reads: the helper takes messages up to 1 MiB. */
const MAX_BYTES = 1_048_576;

/** A half-written job, or an answer: what's cleaned away once it's left over. */
const LEFTOVER = /^\..+\.tmp$|^\d{13}-[0-9a-f]{16}\.done$/;

/** Something watching a folder, which stops when it's closed. */
export interface Watcher {
  close(): void;
}

/**
 * Watches a folder for changes, as the system tells of them. Should watching fail, it stops, and
 * looking every half minute still finds each job.
 */
function watchFolder(folder: string, onChange: () => void): Watcher {
  const watcher = watch(folder, onChange);
  watcher.on('error', () => watcher.close());
  return watcher;
}

export interface InboxDeps {
  /** The inbox, in the open profile's data folder. */
  folder: string;
  /** Adds a job to the job hunt, and says how it went. */
  add: (job: SavedJob) => InboxAnswer;
  /** Once a look has added one or more jobs: to show the new list, once for them all. */
  added?: () => void;
  /** Watches the inbox for changes: the system's own watching, unless a test stands in. */
  watch?: (folder: string, onChange: () => void) => Watcher;
  /** The clock, in milliseconds. Tests set it. */
  now?: () => number;
  /** This copy of the app's process ID, for the marker. Tests set it. */
  pid?: number;
}

/** Writes a small file whole: to a hidden file beside it first, then moved into place. */
function writeWhole(file: string, text: string): void {
  const draft = join(dirname(file), `.${basename(file)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(draft, text);
    renameSync(draft, file);
  } finally {
    rmSync(draft, { force: true });
  }
}

/** Whether a path is a folder itself, not a link to one somewhere else. */
function isFolder(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The inbox of the open profile: the jobs Save to Factwright saved on this computer. */
export class JobInbox {
  private readonly deps: InboxDeps;
  private watcher: Watcher | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private settling: ReturnType<typeof setTimeout> | null = null;
  /** Jobs answered already that stay for another try, so the helper gets one answer for each. */
  private readonly answered = new Set<string>();
  /**
   * Files that couldn't be deleted once they were taken, such as a folder named like a job, or a
   * file another program holds: they're left alone from then on, so they stop nothing else.
   */
  private readonly stuck = new Set<string>();

  constructor(deps: InboxDeps) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private get pid(): string {
    return String(this.deps.pid ?? process.pid);
  }

  /**
   * Opens the inbox: makes it if it isn't there, marks it open, adds the jobs waiting in it, then
   * watches for more. An inbox that's a link to somewhere else is left alone, as the helper won't
   * write into one either.
   */
  start(): void {
    const { folder } = this.deps;
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
    } catch {
      // Without its folder there's nothing to take, and the helper can't drop anything either.
    }
    if (!isFolder(folder)) return;
    try {
      writeWhole(join(folder, LISTENING), this.pid);
    } catch {
      // Without the marker the helper doesn't wait for an answer, and says the job waits.
    }
    this.take();
    try {
      this.watcher = (this.deps.watch ?? watchFolder)(folder, () => this.soon());
    } catch {
      // Looking every half minute still finds each job.
      this.watcher = null;
    }
    this.timer = setInterval(() => this.take(), LOOK_MS);
    this.timer.unref?.();
  }

  /** Stops watching, and takes the marker away, so the helper stops waiting for this copy. */
  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.settling) clearTimeout(this.settling);
    this.settling = null;
    const marker = join(this.deps.folder, LISTENING);
    try {
      if (readFileSync(marker, 'utf8') === this.pid) rmSync(marker, { force: true });
    } catch {
      // Gone already.
    }
  }

  /** Takes what's in the inbox a moment after a change, once the change has settled. */
  private soon(): void {
    if (this.settling) return;
    this.settling = setTimeout(() => {
      this.settling = null;
      this.take();
    }, SETTLE_MS);
  }

  /**
   * Adds each job waiting in the inbox, in the order they came, and cleans away what's left over:
   * a job the helper didn't finish writing, or an answer it didn't take. Nothing in the inbox can
   * stop the rest, or the app: whatever goes wrong with one file leaves it for the next look.
   */
  take(): void {
    const { folder } = this.deps;
    let names: string[];
    try {
      names = readdirSync(folder).sort();
    } catch {
      return;
    }
    const now = this.now();
    let added = false;
    for (const name of names) {
      if (this.stuck.has(name)) continue;
      const job = INBOX_JOB.exec(name);
      try {
        if (job) added = this.takeJob(name, Number(job[1]), now) || added;
        else if (LEFTOVER.test(name)) this.cleanAway(name, now);
      } catch {
        // Tried again at the next look.
      }
    }
    if (added) this.deps.added?.();
  }

  /**
   * Adds one job, answers the helper if it's still waiting, then deletes the job's file, and says
   * whether it added it. A file that isn't a job is deleted, and nothing in it is kept. A job that
   * couldn't be added, such as with the tracker's database busy, stays for the next look: saving
   * the same job twice adds it once. One that can't be deleted is left alone from then on.
   */
  private takeJob(name: string, at: number, now: number): boolean {
    const file = join(this.deps.folder, name);
    let text: string | null = null;
    try {
      const stats = lstatSync(file);
      if (stats.isFile() && stats.size <= MAX_BYTES) text = readFileSync(file, 'utf8');
    } catch {
      // Gone already, or not readable just now: the next look tries again.
      return false;
    }
    const job = text === null ? null : readSavedJob(text);
    let answer: InboxAnswer;
    let done = true;
    if (!job) {
      answer = { ok: false, reason: 'bad-message', message: 'That wasn’t a job to save.' };
    } else {
      try {
        answer = this.deps.add(job);
      } catch {
        answer = {
          ok: false,
          reason: 'failed',
          message:
            'Factwright couldn’t add it just now. It tries again in a moment, so there’s no need to save it again.',
        };
        done = false;
      }
    }
    if (now - at <= ANSWER_MS && !this.answered.has(name)) {
      try {
        writeWhole(
          join(this.deps.folder, name.replace(/\.json$/, '.done')),
          JSON.stringify(answer),
        );
      } catch {
        // The helper says the job waits, and it's added all the same.
      }
    }
    if (!done) {
      this.answered.add(name);
      return false;
    }
    try {
      rmSync(file, { force: true });
      this.answered.delete(name);
    } catch {
      this.stuck.add(name);
    }
    return answer.ok;
  }

  /** Deletes a half-written job or an answer nobody took, once it's been left long enough. */
  private cleanAway(name: string, now: number): void {
    const file = join(this.deps.folder, name);
    try {
      if (now - lstatSync(file).mtimeMs > LEFTOVER_MS) rmSync(file, { force: true });
    } catch {
      // Gone already.
    }
  }
}
