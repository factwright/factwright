import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  askId,
  byJob,
  CALL_STAGE,
  type Call,
  type CallOutcome,
  type CollectedJob,
  companyKey,
  type JobStatus,
  jobIdFor,
  type KnownJob,
  type Note,
  newJobRows,
  normalizeUrl,
  questionKey,
  readStatus,
  SETTLED_STATUSES,
  type SentAnswer,
  STATUS_RANK,
  type StatusChange,
  type StoredRow,
  shortCode,
  type TrackedRow,
  trackedCall,
  trackedChange,
  trackedNote,
  trackedRow,
  wholeJobId,
} from '@factwright/core';
import type { RowValues } from '@factwright/sync';
import type {
  AddJobResult,
  AskResult,
  CallChanges,
  EditResult,
  JobChanges,
  NewCall,
  NewJob,
  NewNote,
  NoteChanges,
} from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';

/** When an edit happens: the user's date, and the exact time. */
export interface EditContext {
  today: string;
  now: string;
}

/**
 * The tables that sync, in the order a new device fills them: jobs before their history, calls
 * and notes.
 */
export const SYNC_TABLES = ['jobs', 'status_log', 'calls', 'notes'] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

/** A row as sync carries it between devices: its table, its ID and its columns as stored. */
export interface SyncRow {
  table: SyncTable;
  id: string;
  row: RowValues;
}

/** Each step brings the database up to the next version, in order. Never edit a shipped step. */
const MIGRATIONS = [
  `CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    company_key TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    links TEXT NOT NULL DEFAULT '[]',
    manual INTEGER NOT NULL DEFAULT 0,
    pay_text TEXT,
    first_seen TEXT,
    status TEXT,
    status_on TEXT,
    applied_on TEXT,
    next_action TEXT,
    next_on TEXT,
    notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE status_log (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE INDEX status_log_job ON status_log(job_id);
  CREATE TABLE calls (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    on_date TEXT NOT NULL,
    at_time TEXT,
    state TEXT NOT NULL,
    outcome TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX calls_job ON calls(job_id);`,
  // The questions the user pasted from a job's application form, as a JSON list.
  `ALTER TABLE jobs ADD COLUMN questions TEXT NOT NULL DEFAULT '[]';`,
  // What the user actually sent for those questions, and the questions they asked Claude about
  // the job, each as a JSON list.
  `ALTER TABLE jobs ADD COLUMN sent TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE jobs ADD COLUMN asks TEXT NOT NULL DEFAULT '[]';`,
  // Dated notes, one a row, such as what was said on a call. The jobs table's notes column keeps
  // the one undated box of notes the app had before.
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    on_date TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notes_job ON notes(job_id);`,
  // For a job set aside for later, the day it comes back to review. For a job passed on, why.
  `ALTER TABLE jobs ADD COLUMN back_on TEXT;
  ALTER TABLE jobs ADD COLUMN pass_reason TEXT;`,
  // The kind of job the user put a job under, such as "project-manager", when they want more
  // than one kind. Empty goes by what the job search or fit check found it as.
  `ALTER TABLE jobs ADD COLUMN kind TEXT;`,
  // A call's details: how long it's booked for in minutes, phone, video or in person, its link,
  // number or address, who it's with as a JSON list, and how it went in the user's words. Each
  // can be empty, as on a call an earlier version logged: a column a merge can't fill must never
  // stop a row from landing.
  `ALTER TABLE calls ADD COLUMN minutes INTEGER;
  ALTER TABLE calls ADD COLUMN mode TEXT;
  ALTER TABLE calls ADD COLUMN place TEXT;
  ALTER TABLE calls ADD COLUMN people TEXT;
  ALTER TABLE calls ADD COLUMN debrief TEXT;`,
];

/** Latest first. Entries on the same day go by when they were added (SQLite's rowid). */
const LATEST_FIRST = 'ORDER BY at DESC, rowid DESC';

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const required = (value: unknown) => (typeof value === 'string' ? value : '');

const failed = (message: string): { ok: false; message: string } => ({ ok: false, message });
const NOT_FOUND = failed('That job isn’t in your tracker anymore. Reload and try again.');
const NO_NOTE = failed('That note isn’t in your tracker anymore. Reload and try again.');
const DONE: EditResult = { ok: true };

/** How many jobs with the same company and role a saved job tries IDs for: "-2" up to this. */
const MAX_SAME = 50;

/**
 * What adding a job saved on this computer did: the job's ID, and whether the job hunt had it
 * already, by its link. Or why it couldn't be added.
 */
export type SavedJobResult =
  | { ok: true; id: string; already: boolean }
  | { ok: false; message: string };

/** Whether a job has a link to the same address. */
const hasLink = (job: TrackedRow, url: string) =>
  job.links.some((link) => normalizeUrl(link.url) === normalizeUrl(url));

/**
 * The tracker: a small SQLite database, outside the workspace, of what the user sets by hand.
 * Statuses with their dates, applied dates, next steps, dated notes, calls, and jobs added by hand.
 * What the skills found stays in the workspace's files. Here each job keeps only its name and
 * links, so its ID holds steady as new work comes in.
 */
export class Tracker {
  private readonly db: DatabaseSync;
  /** The columns opening it added to tables that sync, when it was from an earlier version. */
  private readonly gained = new Map<SyncTable, string[]>();
  /** The tables that sync that opening it made, when it was from an earlier version. */
  private readonly made: SyncTable[] = [];

  /** Opens the tracker at a file path, or in memory for ":memory:". */
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  /**
   * The columns opening this tracker added to tables that sync, by table: none for a new tracker,
   * or one already up to date. Sync fills them from what other devices sent before.
   */
  gainedColumns(): ReadonlyMap<SyncTable, readonly string[]> {
    return this.gained;
  }

  /**
   * The tables that sync that opening this tracker made, such as notes, when it was from an
   * earlier version. Another device may have sent rows for them, which this one passed over
   * while it couldn't keep them, so sync reads every change again once.
   */
  gainedTables(): readonly SyncTable[] {
    return this.made;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    const before = new Map(SYNC_TABLES.map((table) => [table, this.columns(table)]));
    MIGRATIONS.slice(version).forEach((step, i) => {
      this.transaction(() => {
        this.db.exec(step);
        this.db.exec(`PRAGMA user_version = ${version + i + 1}`);
      });
    });
    // A new tracker gains nothing: it had no rows another device could have sent. Nor does a
    // new table: this version's the first to keep its rows.
    if (version === 0) return;
    for (const table of SYNC_TABLES) {
      const had = before.get(table) ?? [];
      const added = this.columns(table).filter((column) => !had.includes(column));
      if (had.length === 0 && added.length > 0) this.made.push(table);
      else if (added.length > 0) this.gained.set(table, added);
    }
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private row(id: string): TrackedRow | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return row ? trackedRow(row) : null;
  }

  private latestChange(jobId: string): StoredRow | undefined {
    return this.db
      .prepare(`SELECT * FROM status_log WHERE job_id = ? ${LATEST_FIRST} LIMIT 1`)
      .get(jobId);
  }

  private logStatus(jobId: string, status: JobStatus, at: string): void {
    this.db
      .prepare('INSERT INTO status_log (id, job_id, status, at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), jobId, status, at);
  }

  private setStatus(jobId: string, status: JobStatus, at: string, now: string): void {
    this.db
      .prepare('UPDATE jobs SET status = ?, status_on = ?, updated_at = ? WHERE id = ?')
      .run(status, at, now, jobId);
    this.logStatus(jobId, status, at);
  }

  /** The columns a table has in this version of the app. */
  private columns(table: SyncTable): string[] {
    return this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => required(column.name));
  }

  /** Every row of the tables that sync, as stored, for sync to compare and send. */
  syncRows(): SyncRow[] {
    return SYNC_TABLES.flatMap((table) =>
      this.db
        .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
        .all()
        .map((row) => ({ table, id: required(row.id), row: row as RowValues })),
    );
  }

  /** One row as stored, or null when there's none. */
  syncRow(table: SyncTable, id: string): RowValues | null {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    return row ? (row as RowValues) : null;
  }

  /**
   * Puts a row as another device left it, or removes it for null. Only the columns this
   * version of the app knows are written, and a column the row lacks keeps its value.
   */
  applySyncRow(table: SyncTable, id: string, row: RowValues | null): void {
    if (row === null) {
      this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      return;
    }
    const columns = this.columns(table).filter((column) => column === 'id' || column in row);
    const values = columns.map((column) => (column === 'id' ? id : (row[column] ?? null)));
    const updates = columns.filter((column) => column !== 'id');
    this.db
      .prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
         ON CONFLICT (id) DO ${
           updates.length
             ? `UPDATE SET ${updates.map((column) => `${column} = excluded.${column}`).join(', ')}`
             : 'NOTHING'
         }`,
      )
      .run(...values);
  }

  /** Every job the tracker knows, so the skills' records keep joining the same job. */
  knownJobs(): KnownJob[] {
    return this.rows().map(({ id, company, companyKey, role, links }) => ({
      id,
      company,
      companyKey,
      role,
      links,
    }));
  }

  /** Every job's row, oldest first. */
  rows(): TrackedRow[] {
    return this.db.prepare('SELECT * FROM jobs ORDER BY rowid').all().map(trackedRow);
  }

  /** Each job's calls, in the order they happen. */
  calls(): Map<string, Call[]> {
    const rows = this.db.prepare('SELECT * FROM calls ORDER BY on_date, at_time, rowid').all();
    return byJob(rows, trackedCall);
  }

  /** Each job's changes of status, oldest first. */
  history(): Map<string, StatusChange[]> {
    const rows = this.db.prepare('SELECT * FROM status_log ORDER BY at, rowid').all();
    return byJob(rows, trackedChange);
  }

  /** Each job's notes, oldest first: by the day they're about, then when they were written. */
  notes(): Map<string, Note[]> {
    const rows = this.db.prepare('SELECT * FROM notes ORDER BY on_date, created_at, rowid').all();
    return byJob(rows, trackedNote);
  }

  /**
   * Keeps each job the skills found: its name, its links and when it was first seen. A job
   * keeps its row when its files go away, so the user's statuses and notes stay with it.
   */
  saveCollected(jobs: readonly CollectedJob[], now: string): void {
    const save = this.db.prepare(
      `INSERT INTO jobs (id, company, company_key, role, links, first_seen, updated_at)
       VALUES (:id, :company, :companyKey, :role, :links, :firstSeen, :now)
       ON CONFLICT(id) DO UPDATE SET
         company = excluded.company,
         company_key = excluded.company_key,
         role = CASE WHEN excluded.role <> '' THEN excluded.role ELSE jobs.role END,
         links = excluded.links,
         first_seen = MIN(COALESCE(jobs.first_seen, excluded.first_seen), COALESCE(excluded.first_seen, jobs.first_seen))
       WHERE jobs.company IS NOT excluded.company
         OR jobs.company_key IS NOT excluded.company_key
         OR (excluded.role <> '' AND jobs.role IS NOT excluded.role)
         OR jobs.links IS NOT excluded.links
         OR excluded.first_seen < jobs.first_seen
         OR (jobs.first_seen IS NULL AND excluded.first_seen IS NOT NULL)`,
    );
    this.transaction(() => {
      for (const job of jobs) {
        save.run({
          id: job.id,
          company: job.company,
          companyKey: job.companyKey,
          role: job.role,
          links: JSON.stringify(job.links),
          firstSeen: job.firstSeen,
          now,
        });
      }
    });
  }

  /**
   * Changes what the user tracks about a job. A new status is dated today, or on statusOn if
   * given, and goes into the job's history. Moving to "applied" sets the applied date too.
   * statusOn on its own corrects when the current status started.
   */
  updateJob(id: string, changes: JobChanges, context: EditContext): EditResult {
    const job = this.row(id);
    if (!job) return NOT_FOUND;
    if (changes.status === undefined && changes.statusOn !== undefined) {
      return this.redateStatus(job, changes.statusOn, context.now);
    }
    this.transaction(() => this.change(job, changes, context));
    return DONE;
  }

  /**
   * Makes the same change to several jobs at once, such as moving them all to To review, each
   * as updateJob would. Jobs no longer in the tracker are passed over.
   */
  updateJobs(ids: readonly string[], changes: JobChanges, context: EditContext): EditResult {
    const jobs = [...new Set(ids)].flatMap((id) => this.row(id) ?? []);
    if (jobs.length === 0) return NOT_FOUND;
    this.transaction(() => {
      for (const job of jobs) this.change(job, changes, context);
    });
    return DONE;
  }

  /**
   * Changes one job, inside a transaction. Setting a job aside for later keeps the day it comes
   * back, and passing on one keeps why, each when given: a later choice of either replaces it.
   */
  private change(job: TrackedRow, changes: JobChanges, context: EditContext): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    const set = (column: string, value: string | number | null) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    if (changes.appliedOn !== undefined) set('applied_on', changes.appliedOn);
    if (changes.nextAction !== undefined) set('next_action', changes.nextAction);
    if (changes.nextOn !== undefined) set('next_on', changes.nextOn);
    if (changes.earlierNotes !== undefined) set('notes', changes.earlierNotes);
    if (changes.questions !== undefined) set('questions', JSON.stringify(changes.questions));
    if (changes.archived !== undefined) set('archived', changes.archived ? 1 : 0);
    if (changes.kind !== undefined) set('kind', changes.kind);

    const status = changes.status;
    const statusChanged = status !== undefined && status !== job.status;
    const on = changes.statusOn ?? context.today;
    if (statusChanged) {
      set('status', status);
      set('status_on', status ? on : null);
      if (status === 'applied' && !job.appliedOn && changes.appliedOn === undefined) {
        set('applied_on', on);
      }
    }
    if (changes.backOn !== undefined || (statusChanged && status === 'later')) {
      set('back_on', changes.backOn ?? null);
    }
    if (changes.passReason !== undefined || (statusChanged && status === 'passed')) {
      set('pass_reason', changes.passReason ?? null);
    }
    if (sets.length === 0) return;
    set('updated_at', context.now);
    this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values, job.id);
    if (statusChanged && status) this.logStatus(job.id, status, on);
  }

  /**
   * Keeps what the user actually sent for one of the application's questions, in place of what
   * was kept for it before. Blank text forgets it. A question the form asks more than once keeps
   * an answer for each time it's asked, by `nth`.
   */
  recordAnswer(
    jobId: string,
    question: string,
    nth: number,
    text: string,
    context: EditContext,
  ): EditResult {
    const job = this.row(jobId);
    if (!job) return NOT_FOUND;
    const key = questionKey(question);
    if (!key) return failed('That question has no words to keep it by.');
    const same = (each: SentAnswer) => questionKey(each.question) === key && each.nth === nth;
    const at = job.sent.findIndex(same);
    const others = job.sent.filter((each) => !same(each));
    const answer = { question, nth, text, on: context.today, at: context.now };
    const sent = !text.trim()
      ? others
      : at < 0
        ? [...others, answer]
        : [...others.slice(0, at), answer, ...others.slice(at)];
    if (sent.length > LIMITS.questions) return failed('That’s as many answers as a job can keep.');
    this.db
      .prepare('UPDATE jobs SET sent = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(sent), context.now, jobId);
    return DONE;
  }

  /** Keeps a question the user asked Claude about a job, under a new ID for its answer. */
  addAsk(jobId: string, question: string, context: EditContext): AskResult {
    const job = this.row(jobId);
    if (!job) return NOT_FOUND;
    const asked = question.trim();
    if (!asked) return failed('Type your question first.');
    if (job.asks.length >= LIMITS.asks) {
      return failed('That’s as many questions as a job can keep. Remove one you’re done with.');
    }
    const id = askId(
      asked,
      context.today,
      job.asks.map((ask) => ask.id),
    );
    const asks = [...job.asks, { id, question: asked, on: context.today }];
    this.db
      .prepare('UPDATE jobs SET asks = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(asks), context.now, jobId);
    return { ok: true, askId: id };
  }

  /** Forgets a question the user asked Claude about a job. */
  removeAsk(jobId: string, id: string, context: EditContext): EditResult {
    const job = this.row(jobId);
    if (!job) return NOT_FOUND;
    const asks = job.asks.filter((ask) => ask.id !== id);
    if (asks.length === job.asks.length) return DONE;
    this.db
      .prepare('UPDATE jobs SET asks = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(asks), context.now, jobId);
    return DONE;
  }

  private redateStatus(job: TrackedRow, at: string, now: string): EditResult {
    if (!job.status) {
      return failed(
        'This status comes from Claude’s work on the job, so it has no date to change.',
      );
    }
    const status = job.status;
    this.transaction(() => {
      this.db
        .prepare('UPDATE jobs SET status_on = ?, updated_at = ? WHERE id = ?')
        .run(at, now, job.id);
      const latest = this.latestChange(job.id);
      if (latest && readStatus(latest.status) === status) {
        this.db.prepare('UPDATE status_log SET at = ? WHERE id = ?').run(at, required(latest.id));
      }
      if (status === 'applied') {
        this.db.prepare('UPDATE jobs SET applied_on = ? WHERE id = ?').run(at, job.id);
      }
    });
    return DONE;
  }

  /** Adds a job by hand, with an ID made from its company and role. */
  addJob(input: NewJob, context: EditContext): AddJobResult {
    const company = input.company.trim();
    if (!company) return { ok: false, message: 'Add the company’s name.' };
    const role = input.role?.trim() ?? '';
    const link = input.link?.trim() ?? '';
    if (link && !/^https?:\/\//i.test(link)) {
      return { ok: false, message: 'Links start with https:// or http://.' };
    }
    const status = input.status ?? null;
    // A company with no Latin letters gets an ID from its link, as Save to Factwright gives it.
    const base = jobIdFor(company, role, link ? shortCode(normalizeUrl(link)) : undefined);
    const taken = this.db.prepare('SELECT 1 FROM jobs WHERE id = ?');
    let id = base;
    for (let n = 2; taken.get(id); n++) id = `${base}-${n}`;
    const { today, now } = context;
    const note = input.notes?.trim();
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO jobs (id, company, company_key, role, links, manual, pay_text, first_seen,
             status, status_on, applied_on, kind, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          company,
          companyKey(company),
          role,
          JSON.stringify(link ? [{ url: link, label: 'Posting' }] : []),
          input.pay?.trim() || null,
          today,
          status,
          status ? today : null,
          status === 'applied' ? today : null,
          input.kind ?? null,
          now,
        );
      if (status) this.logStatus(id, status, today);
      if (note) this.insertNote(id, note, today, now);
    });
    return { ok: true, jobId: id };
  }

  /**
   * Adds a job Save to Factwright saved on this computer, as it adds one through sync: the same
   * rows, as New, with its history's first line, and an ID from its company and role. The same
   * job, by its link, is added once: when the ID it would take is held by a job with the same
   * link, that's the job, and nothing is added. When another job holds it, the next ID, "-2" on, is
   * tried. A job with a long company or title that the app knows by its whole ID, from before IDs
   * were cut short, counts too.
   */
  addSavedJob(
    job: { company: string; role: string; link: string; pay: string },
    context: EditContext,
  ): SavedJobResult {
    const code = job.link ? shortCode(normalizeUrl(job.link)) : undefined;
    const base = jobIdFor(job.company, job.role, code);
    const whole = wholeJobId(job.company, job.role);
    const known = whole && whole !== base ? this.row(whole) : null;
    if (whole && known && hasLink(known, job.link)) return { ok: true, id: whole, already: true };
    for (let n = 1; n <= MAX_SAME; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      const held = this.row(id);
      if (held) {
        if (hasLink(held, job.link)) return { ok: true, id, already: true };
        continue;
      }
      const rows = newJobRows({
        id,
        ...job,
        status: 'new',
        today: context.today,
        now: context.now,
        statusId: randomUUID(),
      });
      this.transaction(() => {
        this.applySyncRow('jobs', id, rows.job);
        this.applySyncRow('status_log', String(rows.status.id), rows.status);
      });
      return { ok: true, id, already: false };
    }
    return failed('Too many jobs with that company and title.');
  }

  /**
   * Logs a call. Booking one moves the job forward: a recruiter screen to "screen", an
   * interview to "interview", an offer call to "offer". It's dated when it was booked, or on
   * the call's own date when logged afterward. A settled job (rejected, withdrawn, or an offer
   * accepted or declined) stays as it is.
   */
  addCall(jobId: string, input: NewCall, context: EditContext): EditResult {
    const job = this.row(jobId);
    if (!job) return NOT_FOUND;
    const { today, now } = context;
    const past = input.onDate < today;
    const target = input.kind === 'other' ? undefined : CALL_STAGE[input.kind];
    // Every call's status ranks above anything the skills' work alone can reach.
    const forward =
      target !== undefined &&
      !(job.status && SETTLED_STATUSES.includes(job.status)) &&
      (STATUS_RANK[target] ?? 0) > (STATUS_RANK[job.status ?? 'new'] ?? 0);
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO calls (id, job_id, kind, on_date, at_time, minutes, mode, place, people,
             state, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          jobId,
          input.kind,
          input.onDate,
          input.atTime ?? null,
          input.minutes ?? null,
          input.mode ?? null,
          input.place ?? null,
          JSON.stringify(input.people ?? []),
          past ? 'done' : 'scheduled',
          input.notes ?? null,
          now,
        );
      if (forward) this.setStatus(jobId, target, past ? input.onDate : today, now);
    });
    return DONE;
  }

  /**
   * Changes a call. Saying how a booked call went, by its outcome or in words once its day has
   * come, marks it done. Marking its outcome "rejected" closes the job, unless it's settled.
   */
  updateCall(callId: string, changes: CallChanges, context: EditContext): EditResult {
    const call = this.db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    if (!call) return failed('That call isn’t in your tracker anymore. Reload and try again.');
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    const set = (column: string, value: string | number | null) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    if (changes.kind !== undefined) set('kind', changes.kind);
    if (changes.onDate !== undefined) set('on_date', changes.onDate);
    if (changes.atTime !== undefined) set('at_time', changes.atTime);
    if (changes.minutes !== undefined) set('minutes', changes.minutes);
    if (changes.mode !== undefined) set('mode', changes.mode);
    if (changes.place !== undefined) set('place', changes.place);
    if (changes.people !== undefined) set('people', JSON.stringify(changes.people));
    const said =
      Boolean(changes.outcome) ||
      (Boolean(changes.debrief) && required(call.on_date) <= context.today);
    if (changes.state !== undefined) set('state', changes.state);
    else if (said && call.state === 'scheduled') set('state', 'done');
    if (changes.outcome !== undefined) set('outcome', changes.outcome);
    if (changes.notes !== undefined) set('notes', changes.notes);
    if (changes.debrief !== undefined) set('debrief', changes.debrief);
    if (sets.length === 0) return DONE;

    const jobId = required(call.job_id);
    const job = this.row(jobId);
    const rejected: CallOutcome = 'rejected';
    const closes =
      changes.outcome === rejected &&
      call.outcome !== rejected &&
      job !== null &&
      !(job.status && SETTLED_STATUSES.includes(job.status));
    this.transaction(() => {
      this.db.prepare(`UPDATE calls SET ${sets.join(', ')} WHERE id = ?`).run(...values, callId);
      if (closes) this.setStatus(jobId, 'rejected', context.today, context.now);
    });
    return DONE;
  }

  deleteCall(callId: string): EditResult {
    this.db.prepare('DELETE FROM calls WHERE id = ?').run(callId);
    return DONE;
  }

  private insertNote(jobId: string, text: string, on: string, now: string): void {
    this.db
      .prepare(
        `INSERT INTO notes (id, job_id, on_date, text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), jobId, on, text, now, now);
  }

  /** Keeps a note about a job, dated today unless the user gave the day it's about. */
  addNote(jobId: string, input: NewNote, context: EditContext): EditResult {
    if (!this.row(jobId)) return NOT_FOUND;
    const text = input.text.trim();
    if (!text) return failed('Type your note first.');
    this.insertNote(jobId, text, input.on ?? context.today, context.now);
    return DONE;
  }

  /** Changes a note's words, or the day it's about. */
  updateNote(noteId: string, changes: NoteChanges, context: EditContext): EditResult {
    const note = this.db.prepare('SELECT id FROM notes WHERE id = ?').get(noteId);
    if (!note) return NO_NOTE;
    const text = changes.text?.trim();
    if (changes.text !== undefined && !text) {
      return failed('A note needs some words. Delete it instead, if it’s done with.');
    }
    if (text === undefined && changes.on === undefined) return DONE;
    this.db
      .prepare(
        `UPDATE notes SET text = COALESCE(?, text), on_date = COALESCE(?, on_date), updated_at = ?
         WHERE id = ?`,
      )
      .run(text ?? null, changes.on ?? null, context.now, noteId);
    return DONE;
  }

  deleteNote(noteId: string): EditResult {
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
    return DONE;
  }

  /** Corrects when a change of status happened. */
  redateChange(entryId: string, at: string, now: string): EditResult {
    const entry = this.db.prepare('SELECT * FROM status_log WHERE id = ?').get(entryId);
    if (!entry) return failed('That change isn’t in the job’s history anymore.');
    const jobId = required(entry.job_id);
    const job = this.row(jobId);
    const latest = this.latestChange(jobId);
    this.transaction(() => {
      this.db.prepare('UPDATE status_log SET at = ? WHERE id = ?').run(at, entryId);
      if (latest?.id === entryId && job?.status === readStatus(entry.status)) {
        this.db
          .prepare('UPDATE jobs SET status_on = ?, updated_at = ? WHERE id = ?')
          .run(at, now, jobId);
      }
      if (entry.status === 'applied') {
        this.db
          .prepare('UPDATE jobs SET applied_on = ?, updated_at = ? WHERE id = ?')
          .run(at, now, jobId);
      }
    });
    return DONE;
  }

  /**
   * Removes a change of status from a job's history, to undo a mis-click. Removing the latest
   * change puts the job back where it was.
   */
  undoChange(entryId: string, now: string): EditResult {
    const entry = this.db.prepare('SELECT * FROM status_log WHERE id = ?').get(entryId);
    if (!entry) return failed('That change isn’t in the job’s history anymore.');
    const jobId = required(entry.job_id);
    const job = this.row(jobId);
    const latest = this.latestChange(jobId);
    this.transaction(() => {
      this.db.prepare('DELETE FROM status_log WHERE id = ?').run(entryId);
      if (latest?.id === entryId && job?.status === readStatus(entry.status)) {
        const previous = this.latestChange(jobId);
        this.db
          .prepare('UPDATE jobs SET status = ?, status_on = ?, updated_at = ? WHERE id = ?')
          .run(text(previous?.status), text(previous?.at), now, jobId);
      }
      if (entry.status === 'applied') {
        const stillApplied = this.db
          .prepare(
            "SELECT at FROM status_log WHERE job_id = ? AND status = 'applied' ORDER BY at LIMIT 1",
          )
          .get(jobId);
        this.db
          .prepare('UPDATE jobs SET applied_on = ?, updated_at = ? WHERE id = ?')
          .run(text(stillApplied?.at), now, jobId);
      }
    });
    return DONE;
  }
}
