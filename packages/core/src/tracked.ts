import { ASK_ID, questionKey } from './answers.ts';
import { isIsoDate } from './dates.ts';
import type { CallDoc } from './extras.ts';
import type { CollectedJob, Job, JobPay } from './jobs.ts';
import { KIND_ID } from './kinds.ts';
import type { Link } from './links.ts';
import { parsePay } from './pay.ts';
import type { JobDocKind } from './records.ts';
import {
  type Ask,
  CALL_KINDS,
  CALL_MODES,
  CALL_OUTCOMES,
  CALL_STATES,
  type Call,
  type CallPerson,
  type Note,
  PASS_REASONS,
  readStatus,
  type SentAnswer,
  STATUS_RANK,
  type StatusChange,
  type TrackerFields,
} from './tracker.ts';

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

/** A row of the tracker as SQLite keeps it, on this computer or synced from another. */
export type StoredRow = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const required = (value: unknown) => (typeof value === 'string' ? value : '');

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function linksOf(json: unknown): Link[] {
  try {
    const parsed: unknown = JSON.parse(required(json) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((link: StoredRow) =>
      typeof link?.url === 'string' && typeof link.label === 'string'
        ? [{ url: link.url, label: link.label }]
        : [],
    );
  } catch {
    return [];
  }
}

/** A JSON list, or none when it isn't one. */
function listOf(json: unknown): unknown[] {
  try {
    const parsed: unknown = JSON.parse(required(json) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** A JSON list of texts, or none when it isn't one. */
const textsOf = (json: unknown): string[] =>
  listOf(json).filter((item): item is string => typeof item === 'string');

/**
 * The answers the user recorded, leaving out any that don't read. Two devices can each record an
 * answer to the same question; the later one stands.
 */
function sentOf(json: unknown): SentAnswer[] {
  const kept = new Map<string, SentAnswer>();
  for (const item of listOf(json)) {
    const { question, text, on, at, nth } = (item ?? {}) as StoredRow;
    if (typeof question !== 'string' || typeof text !== 'string' || !isIsoDate(on)) continue;
    const answer: SentAnswer = {
      question,
      nth: Number.isInteger(nth) && (nth as number) >= 0 ? (nth as number) : 0,
      text,
      on,
      at: typeof at === 'string' ? at : on,
    };
    const key = `${questionKey(question)}#${answer.nth}`;
    const known = kept.get(key);
    if (!known || answer.at >= known.at) kept.set(key, answer);
  }
  return [...kept.values()];
}

/** The questions the user asked Claude, leaving out any that don't read. */
const asksOf = (json: unknown): Ask[] =>
  listOf(json).flatMap((item) => {
    const { id, question, on } = (item ?? {}) as StoredRow;
    return typeof id === 'string' &&
      ASK_ID.test(id) &&
      typeof question === 'string' &&
      isIsoDate(on)
      ? [{ id, question, on }]
      : [];
  });

/** A job's row, read from the tracker's jobs table. */
export function trackedRow(row: StoredRow): TrackedRow {
  return {
    id: required(row.id),
    company: required(row.company),
    companyKey: required(row.company_key),
    role: required(row.role),
    links: linksOf(row.links),
    manual: row.manual === 1,
    payText: text(row.pay_text),
    firstSeen: text(row.first_seen),
    status: readStatus(row.status),
    statusOn: text(row.status_on),
    backOn: isIsoDate(row.back_on) ? row.back_on : null,
    passReason: isOneOf(PASS_REASONS, row.pass_reason) ? row.pass_reason : null,
    appliedOn: text(row.applied_on),
    nextAction: text(row.next_action),
    nextOn: text(row.next_on),
    questions: textsOf(row.questions),
    sent: sentOf(row.sent),
    asks: asksOf(row.asks),
    earlierNotes: text(row.notes),
    archived: row.archived === 1,
    kind: typeof row.kind === 'string' && KIND_ID.test(row.kind) ? row.kind : null,
  };
}

/** The people on a call, leaving out any without a name. */
const peopleOf = (json: unknown): CallPerson[] =>
  listOf(json).flatMap((item) => {
    const { name, role } = (item ?? {}) as StoredRow;
    if (typeof name !== 'string' || !name.trim()) return [];
    return [
      { name: name.trim(), role: typeof role === 'string' && role.trim() ? role.trim() : null },
    ];
  });

/** A call's length in minutes, or null for none or one that doesn't read. */
const minutesOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

/** A call, read from the tracker's calls table, or null when it isn't one this version knows. */
export function trackedCall(row: StoredRow): Call | null {
  if (!isOneOf(CALL_KINDS, row.kind) || !isOneOf(CALL_STATES, row.state)) return null;
  return {
    id: required(row.id),
    kind: row.kind,
    onDate: required(row.on_date),
    atTime: text(row.at_time),
    minutes: minutesOf(row.minutes),
    mode: isOneOf(CALL_MODES, row.mode) ? row.mode : null,
    place: text(row.place),
    people: peopleOf(row.people),
    state: row.state,
    outcome: isOneOf(CALL_OUTCOMES, row.outcome) ? row.outcome : null,
    notes: text(row.notes),
    debrief: text(row.debrief),
  };
}

/** A change of status, read from the tracker's history. */
export function trackedChange(row: StoredRow): StatusChange | null {
  const status = readStatus(row.status);
  return status ? { id: required(row.id), status, at: required(row.at) } : null;
}

/** A note, read from the tracker's notes table, or null when it doesn't read. */
export function trackedNote(row: StoredRow): Note | null {
  const { id, on_date: on, text, created_at: at } = row;
  return typeof id === 'string' && isIsoDate(on) && typeof text === 'string' && text.trim()
    ? { id, on, text, at: required(at) }
    : null;
}

/** Each job's items, in the order given. Rows that don't read are left out. */
export function byJob<T>(rows: readonly StoredRow[], read: (row: StoredRow) => T | null) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const item = read(row);
    if (!item) continue;
    const jobId = required(row.job_id);
    grouped.set(jobId, [...(grouped.get(jobId) ?? []), item]);
  }
  return grouped;
}

/** How far along a stored change of status is. */
const rankOf = (row: StoredRow) => STATUS_RANK[readStatus(row.status) ?? 'new'] ?? 0;

/**
 * Calls in the order they happen, and changes of status oldest first, for rows that come
 * without SQLite's order, as from sync. Changes on the same day go by how far along they are.
 */
export const callOrder = (a: StoredRow, b: StoredRow) =>
  `${required(a.on_date)} ${required(a.at_time)} ${required(a.created_at)}`.localeCompare(
    `${required(b.on_date)} ${required(b.at_time)} ${required(b.created_at)}`,
  );

export const changeOrder = (a: StoredRow, b: StoredRow) =>
  required(a.at).localeCompare(required(b.at)) || rankOf(a) - rankOf(b);

/** Notes oldest first, by the day they're about, then when they were written. */
export const noteOrder = (a: StoredRow, b: StoredRow) =>
  `${required(a.on_date)} ${required(a.created_at)}`.localeCompare(
    `${required(b.on_date)} ${required(b.created_at)}`,
  );

const ADDED_BY_HAND = 'Added by hand';

/** Whether the user has tracked anything about a job, so it stays listed after its files go. */
function isTracked(row: TrackedRow, kept: number): boolean {
  const { manual, archived, status, appliedOn, nextAction, nextOn, earlierNotes, kind } = row;
  return (
    manual ||
    archived ||
    kept > 0 ||
    [row.questions, row.sent, row.asks].some((list) => list.length > 0) ||
    [status, appliedOn, nextAction, nextOn, earlierNotes, kind].some(Boolean)
  );
}

/** The pay the user typed for a job they added by hand. */
function typedPay(row: TrackedRow): JobPay | null {
  if (!row.payText) return null;
  const range = parsePay(row.payText);
  return { text: row.payText, min: range?.min ?? null, max: range?.max ?? null, source: 'listed' };
}

/**
 * A job as the app shows it: its tracker row, plus what the workspace says when it has files.
 * A question for Claude about the job, the user's own or the application's, takes it out of New
 * like Claude's other work, even before the answer comes.
 */
function assemble(row: TrackedRow, found: CollectedJob | undefined, kept: Kept): Job {
  const asked = row.asks.length > 0 || row.questions.length > 0;
  const tracking = {
    status: row.status,
    statusOn: row.statusOn,
    backOn: row.backOn,
    passReason: row.passReason,
    appliedOn: row.appliedOn,
    nextAction: row.nextAction,
    nextOn: row.nextOn,
    questions: row.questions,
    sent: row.sent,
    asks: row.asks,
    earlierNotes: row.earlierNotes,
    archived: row.archived,
    kind: row.kind,
    manual: row.manual,
    ...kept,
  };
  if (found) {
    const { docs, ...job } = found;
    return {
      ...job,
      ...tracking,
      stage: asked ? 'review' : job.stage,
      pay: job.pay ?? typedPay(row),
      source: row.manual ? ADDED_BY_HAND : job.source,
      docKinds: Object.keys(docs) as JobDocKind[],
    };
  }
  return {
    id: row.id,
    company: row.company,
    companyKey: row.companyKey,
    role: row.role,
    link: row.links[0]?.url ?? null,
    links: row.links,
    location: null,
    pay: typedPay(row),
    source: row.manual ? ADDED_BY_HAND : '',
    fit: null,
    search: null,
    searches: [],
    kindFound: null,
    folder: null,
    stage: asked ? 'review' : 'new',
    firstSeen: row.firstSeen,
    lastActivity: row.firstSeen,
    summary: null,
    events: [],
    apply: null,
    fitReport: null,
    sentiment: null,
    files: [],
    letters: [],
    outreach: [],
    docKinds: [],
    ...tracking,
  };
}

/**
 * What the tracker keeps for each job in tables of their own, by the job's ID, and Claude's
 * documents for its calls, from the workspace.
 */
export interface TrackedItems {
  calls: ReadonlyMap<string, Call[]>;
  history: ReadonlyMap<string, StatusChange[]>;
  notes: ReadonlyMap<string, Note[]>;
  callDocs?: ReadonlyMap<string, CallDoc[]>;
}

/** One job's calls, changes of status and notes, and Claude's documents for its calls. */
interface Kept {
  calls: Call[];
  statusLog: StatusChange[];
  notes: Note[];
  callDocs: CallDoc[];
}

/**
 * Every job to show: each tracker row joined with what the workspace says about it. A job whose
 * files are gone stays listed only while the user has tracked something about it.
 */
export function jobList(
  rows: readonly TrackedRow[],
  found: ReadonlyMap<string, CollectedJob>,
  items: TrackedItems,
): Job[] {
  return rows.flatMap((row) => {
    const job = found.get(row.id);
    const calls = items.calls.get(row.id) ?? [];
    const kept: Kept = {
      calls,
      statusLog: items.history.get(row.id) ?? [],
      notes: items.notes.get(row.id) ?? [],
      // Only a call the job still has keeps its documents on show.
      callDocs: (items.callDocs?.get(row.id) ?? []).filter((doc) =>
        calls.some((call) => call.id === doc.callId),
      ),
    };
    if (!job && !isTracked(row, kept.calls.length + kept.notes.length)) return [];
    return [assemble(row, job, kept)];
  });
}
