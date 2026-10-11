import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  CALL_KINDS,
  CALL_OUTCOMES,
  CALL_STAGE,
  CALL_STATES,
  type Call,
  type CallOutcome,
  type CollectedJob,
  companyKey,
  JOB_STATUSES,
  type JobStatus,
  type KnownJob,
  type Link,
  roleKey,
  SETTLED_STATUSES,
  STATUS_RANK,
  type StatusChange,
  slug,
  type TrackerFields,
} from '@factwright/core';
import type {
  AddJobResult,
  CallChanges,
  EditResult,
  JobChanges,
  NewCall,
  NewJob,
} from '../../shared/api.ts';

/** A job's row in the tracker: what it's called, and what the user tracks about it. */
export interface TrackedRow extends TrackerFields {
  id: string;
  company: string;
  companyKey: string;
  role: string;
  /** Every link seen for the job, so later work by the skills finds it. */
  links: Link[];
  /** Added by hand, rather than found by a skill. */
  manual: boolean;
  /** For a job added by hand, the pay the user typed. */
  payText: string | null;
  firstSeen: string | null;
}

/** When an edit happens: the user's date, and the exact time. */
export interface EditContext {
  today: string;
  now: string;
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
];

/** Latest first. Entries on the same day go by when they were added (SQLite's rowid). */
const LATEST_FIRST = 'ORDER BY at DESC, rowid DESC';

type Row = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const required = (value: unknown) => (typeof value === 'string' ? value : '');

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function linksOf(json: unknown): Link[] {
  try {
    const parsed: unknown = JSON.parse(required(json) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((link: Row) =>
      typeof link?.url === 'string' && typeof link.label === 'string'
        ? [{ url: link.url, label: link.label }]
        : [],
    );
  } catch {
    return [];
  }
}

function trackedRow(row: Row): TrackedRow {
  return {
    id: required(row.id),
    company: required(row.company),
    companyKey: required(row.company_key),
    role: required(row.role),
    links: linksOf(row.links),
    manual: row.manual === 1,
    payText: text(row.pay_text),
    firstSeen: text(row.first_seen),
    status: isOneOf(JOB_STATUSES, row.status) ? row.status : null,
    statusOn: text(row.status_on),
    appliedOn: text(row.applied_on),
    nextAction: text(row.next_action),
    nextOn: text(row.next_on),
    notes: text(row.notes),
    archived: row.archived === 1,
  };
}

function callOf(row: Row): Call | null {
  if (!isOneOf(CALL_KINDS, row.kind) || !isOneOf(CALL_STATES, row.state)) return null;
  return {
    id: required(row.id),
    kind: row.kind,
    onDate: required(row.on_date),
    atTime: text(row.at_time),
    state: row.state,
    outcome: isOneOf(CALL_OUTCOMES, row.outcome) ? row.outcome : null,
    notes: text(row.notes),
  };
}

function byJob<T>(rows: Row[], read: (row: Row) => T | null): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const item = read(row);
    if (!item) continue;
    const jobId = required(row.job_id);
    grouped.set(jobId, [...(grouped.get(jobId) ?? []), item]);
  }
  return grouped;
}

const failed = (message: string): EditResult => ({ ok: false, message });
const NOT_FOUND = failed('That job isn’t in your tracker anymore. Reload and try again.');
const DONE: EditResult = { ok: true };

/**
 * The tracker: a small SQLite database, outside the workspace, of what the user sets by hand.
 * Statuses with their dates, applied dates, next steps, notes, calls, and jobs added by hand.
 * What the skills found stays in the workspace's files. Here each job keeps only its name and
 * links, so its ID holds steady as new work comes in.
 */
export class Tracker {
  private readonly db: DatabaseSync;

  /** Opens the tracker at a file path, or in memory for ":memory:". */
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    MIGRATIONS.slice(version).forEach((step, i) => {
      this.transaction(() => {
        this.db.exec(step);
        this.db.exec(`PRAGMA user_version = ${version + i + 1}`);
      });
    });
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

  private latestChange(jobId: string): Row | undefined {
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
    return byJob(rows, callOf);
  }

  /** Each job's changes of status, oldest first. */
  history(): Map<string, StatusChange[]> {
    const rows = this.db.prepare('SELECT * FROM status_log ORDER BY at, rowid').all();
    return byJob(rows, (row) =>
      isOneOf(JOB_STATUSES, row.status)
        ? { id: required(row.id), status: row.status, at: required(row.at) }
        : null,
    );
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
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    const set = (column: string, value: string | number | null) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    if (changes.appliedOn !== undefined) set('applied_on', changes.appliedOn);
    if (changes.nextAction !== undefined) set('next_action', changes.nextAction);
    if (changes.nextOn !== undefined) set('next_on', changes.nextOn);
    if (changes.notes !== undefined) set('notes', changes.notes);
    if (changes.archived !== undefined) set('archived', changes.archived ? 1 : 0);

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
    if (sets.length === 0) return DONE;
    set('updated_at', context.now);
    this.transaction(() => {
      this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      if (statusChanged && status) this.logStatus(id, status, on);
    });
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
      if (latest?.status === status) {
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
    const base = `${companyKey(company) || slug(company) || 'job'}--${roleKey(role) || 'general'}`;
    const taken = this.db.prepare('SELECT 1 FROM jobs WHERE id = ?');
    let id = base;
    for (let n = 2; taken.get(id); n++) id = `${base}-${n}`;
    const { today, now } = context;
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO jobs (id, company, company_key, role, links, manual, pay_text, first_seen,
             status, status_on, applied_on, notes, updated_at)
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
          input.notes?.trim() || null,
          now,
        );
      if (status) this.logStatus(id, status, today);
    });
    return { ok: true, jobId: id };
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
          `INSERT INTO calls (id, job_id, kind, on_date, at_time, state, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          jobId,
          input.kind,
          input.onDate,
          input.atTime ?? null,
          past ? 'done' : 'scheduled',
          input.notes ?? null,
          now,
        );
      if (forward) this.setStatus(jobId, target, past ? input.onDate : today, now);
    });
    return DONE;
  }

  /** Changes a call. Marking its outcome "rejected" closes the job, unless it's settled. */
  updateCall(callId: string, changes: CallChanges, context: EditContext): EditResult {
    const call = this.db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    if (!call) return failed('That call isn’t in your tracker anymore. Reload and try again.');
    const sets: string[] = [];
    const values: (string | null)[] = [];
    const set = (column: string, value: string | null) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    if (changes.kind !== undefined) set('kind', changes.kind);
    if (changes.onDate !== undefined) set('on_date', changes.onDate);
    if (changes.atTime !== undefined) set('at_time', changes.atTime);
    if (changes.state !== undefined) set('state', changes.state);
    if (changes.outcome !== undefined) set('outcome', changes.outcome);
    if (changes.notes !== undefined) set('notes', changes.notes);
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

  /** Corrects when a change of status happened. */
  redateChange(entryId: string, at: string, now: string): EditResult {
    const entry = this.db.prepare('SELECT * FROM status_log WHERE id = ?').get(entryId);
    if (!entry) return failed('That change isn’t in the job’s history anymore.');
    const jobId = required(entry.job_id);
    const job = this.row(jobId);
    const latest = this.latestChange(jobId);
    this.transaction(() => {
      this.db.prepare('UPDATE status_log SET at = ? WHERE id = ?').run(at, entryId);
      if (latest?.id === entryId && job?.status === entry.status) {
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
      if (latest?.id === entryId && job?.status === entry.status) {
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
