import {
  CALL_KINDS,
  CALL_MODES,
  CALL_OUTCOMES,
  CALL_STATES,
  type CallPerson,
  isIsoDate,
  JOB_STATUSES,
  KIND_ID,
  PASS_REASONS,
} from '@factwright/core';
import type {
  CallChanges,
  JobChanges,
  NewCall,
  NewJob,
  NewNote,
  NoteChanges,
} from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';

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

/** A list of trimmed texts, each up to a length, with the empty ones left out. */
const textsUpTo =
  (max: number, count: number): Reader<string[]> =>
  (value) => {
    if (!Array.isArray(value) || value.length > count) return BAD;
    const texts: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string' || item.length > max) return BAD;
      if (item.trim()) texts.push(item.trim());
    }
    return texts;
  };

const date: Reader<string> = (value) => (isIsoDate(value) ? value : BAD);
const time: Reader<string> = (value) =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : BAD;
const flag: Reader<boolean> = (value) => (typeof value === 'boolean' ? value : BAD);
/** A call's length in minutes: a whole number, up to a day. */
const minutes: Reader<number> = (value) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 24 * 60
    ? value
    : BAD;

/**
 * How far past the window's limits a call's people and texts may run: two devices' changes to the
 * same call keep both, so a call can come back from a sync longer than one device lets it get, and
 * changing it then should still save.
 */
const MERGED = 4;

/** The people on a call, trimmed. A row the user left without a name is left out. */
const people: Reader<CallPerson[]> = (value) => {
  if (!Array.isArray(value) || value.length > LIMITS.people * MERGED) return BAD;
  const named: CallPerson[] = [];
  for (const item of value) {
    if (!isRecord(item)) return BAD;
    const { name, role, ...rest } = item;
    if (Object.keys(rest).length > 0) return BAD;
    if (typeof name !== 'string' || name.length > LIMITS.person) return BAD;
    if (role !== null && (typeof role !== 'string' || role.length > LIMITS.person)) return BAD;
    if (name.trim()) named.push({ name: name.trim(), role: role?.trim() || null });
  }
  return named;
};
const kindId: Reader<string> = (value) =>
  typeof value === 'string' && KIND_ID.test(value) ? value : BAD;

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
    backOn: orNull(date),
    passReason: orNull(oneOf(PASS_REASONS)),
    appliedOn: orNull(date),
    nextAction: textUpTo(LIMITS.nextAction),
    nextOn: orNull(date),
    earlierNotes: textUpTo(LIMITS.notes),
    questions: textsUpTo(LIMITS.question, LIMITS.questions),
    archived: flag,
    kind: orNull(kindId),
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
    kind: orNull(kindId),
  });
  return fields ? { ...fields, company: fields.company ?? '' } : null;
}

export function parseNewCall(value: unknown): NewCall | null {
  const fields = readFields<Required<NewCall>>(value, {
    kind: oneOf(CALL_KINDS),
    onDate: date,
    atTime: orNull(time),
    minutes: orNull(minutes),
    mode: orNull(oneOf(CALL_MODES)),
    place: textUpTo(LIMITS.place),
    people,
    notes: textUpTo(LIMITS.callNotes * MERGED),
  });
  if (!fields?.kind || !fields.onDate) return null;
  return { ...fields, kind: fields.kind, onDate: fields.onDate };
}

export function parseCallChanges(value: unknown): CallChanges | null {
  return readFields<Required<CallChanges>>(value, {
    kind: oneOf(CALL_KINDS),
    onDate: date,
    atTime: orNull(time),
    minutes: orNull(minutes),
    mode: orNull(oneOf(CALL_MODES)),
    place: textUpTo(LIMITS.place),
    people,
    state: oneOf(CALL_STATES),
    outcome: orNull(oneOf(CALL_OUTCOMES)),
    notes: textUpTo(LIMITS.callNotes * MERGED),
    debrief: textUpTo(LIMITS.debrief * MERGED),
  });
}

export function parseNewNote(value: unknown): NewNote | null {
  const fields = readFields<Required<NewNote>>(value, {
    text: anyTextUpTo(LIMITS.note),
    on: date,
  });
  return fields?.text ? { ...fields, text: fields.text } : null;
}

export function parseNoteChanges(value: unknown): NoteChanges | null {
  return readFields<Required<NoteChanges>>(value, { text: anyTextUpTo(LIMITS.note), on: date });
}

/** A date sent on its own, such as when a change of status happened. */
export function parseDate(value: unknown): string | null {
  return isIsoDate(value) ? value : null;
}
