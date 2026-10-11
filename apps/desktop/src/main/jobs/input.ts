import { CALL_KINDS, CALL_OUTCOMES, CALL_STATES, isIsoDate, JOB_STATUSES } from '@factwright/core';
import type { CallChanges, JobChanges, NewCall, NewJob } from '../../shared/api.ts';

/** The longest text each field takes. The window's inputs stop at these too. */
export const LIMITS = {
  company: 200,
  role: 300,
  link: 2000,
  pay: 200,
  nextAction: 500,
  notes: 20_000,
  callNotes: 2000,
} as const;

/** A value the window sent that doesn't fit the field. */
const BAD = Symbol('bad');

type Reader<T> = (value: unknown) => T | typeof BAD;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Trimmed text up to a length. Empty text, or null, clears the field. */
const textUpTo =
  (max: number): Reader<string | null> =>
  (value) => {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > max) return BAD;
    return value.trim() || null;
  };

/** Trimmed text up to a length, which may be empty. */
const anyTextUpTo =
  (max: number): Reader<string> =>
  (value) =>
    typeof value === 'string' && value.length <= max ? value.trim() : BAD;

const date: Reader<string> = (value) => (isIsoDate(value) ? value : BAD);
const time: Reader<string> = (value) =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : BAD;
const flag: Reader<boolean> = (value) => (typeof value === 'boolean' ? value : BAD);

function oneOf<T extends string>(list: readonly T[]): Reader<T> {
  return (value) =>
    typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : BAD;
}

function orNull<T>(read: Reader<T>): Reader<T | null> {
  return (value) => (value === null ? null : read(value));
}

/**
 * Reads the fields a message from the window gives, checking each against its reader. Fields
 * left out stay undefined, so they don't change. Returns null if any field doesn't fit.
 */
function readFields<T extends Record<string, unknown>>(
  value: unknown,
  readers: { [K in keyof T]-?: Reader<T[K]> },
): Partial<T> | null {
  if (!isRecord(value)) return null;
  const fields: Partial<T> = {};
  for (const key of Object.keys(readers) as (keyof T & string)[]) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) continue;
    const read = readers[key](value[key]);
    if (read === BAD) return null;
    fields[key] = read;
  }
  return fields;
}

export function parseJobChanges(value: unknown): JobChanges | null {
  return readFields<Required<JobChanges>>(value, {
    status: orNull(oneOf(JOB_STATUSES)),
    statusOn: date,
    appliedOn: orNull(date),
    nextAction: textUpTo(LIMITS.nextAction),
    nextOn: orNull(date),
    notes: textUpTo(LIMITS.notes),
    archived: flag,
  });
}

export function parseNewJob(value: unknown): NewJob | null {
  const fields = readFields<Required<NewJob>>(value, {
    company: anyTextUpTo(LIMITS.company),
    role: textUpTo(LIMITS.role),
    link: textUpTo(LIMITS.link),
    pay: textUpTo(LIMITS.pay),
    status: orNull(oneOf(JOB_STATUSES)),
    notes: textUpTo(LIMITS.notes),
  });
  return fields ? { ...fields, company: fields.company ?? '' } : null;
}

export function parseNewCall(value: unknown): NewCall | null {
  const fields = readFields<Required<NewCall>>(value, {
    kind: oneOf(CALL_KINDS),
    onDate: date,
    atTime: orNull(time),
    notes: textUpTo(LIMITS.callNotes),
  });
  if (!fields?.kind || !fields.onDate) return null;
  return { ...fields, kind: fields.kind, onDate: fields.onDate };
}

export function parseCallChanges(value: unknown): CallChanges | null {
  return readFields<Required<CallChanges>>(value, {
    kind: oneOf(CALL_KINDS),
    onDate: date,
    atTime: orNull(time),
    state: oneOf(CALL_STATES),
    outcome: orNull(oneOf(CALL_OUTCOMES)),
    notes: textUpTo(LIMITS.callNotes),
  });
}

/** A date sent on its own, such as when a change of status happened. */
export function parseDate(value: unknown): string | null {
  return isIsoDate(value) ? value : null;
}
