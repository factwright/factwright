import { JOB_LIMITS } from '@factwright/core';

/** The longest text each tracker field takes. The main process checks them, and the window's inputs stop there. */
export const LIMITS = {
  ...JOB_LIMITS,
  nextAction: 500,
  /** The one undated box of notes the app had before notes were dated. */
  notes: 20_000,
  /** One dated note, such as what was said on a call. */
  note: 10_000,
  /** What a call's about, written before it. */
  callNotes: 2000,
  /** How a call went, in the user's words. */
  debrief: 10_000,
  /** A call's link, number to call, or address. */
  place: 500,
  /** How many people one call can name, such as a panel's. */
  people: 12,
  /** A person's name, or their part in a call. */
  person: 120,
  /** One question from an application form, which can carry instructions and a word limit. */
  question: 4000,
  /** How many questions one application can have. */
  questions: 50,
  /** What the user sent for one of them, which can run long for an essay question. */
  answer: 10_000,
  /** One question for Claude about a job. */
  ask: 4000,
  /** How many questions for Claude one job can hold. */
  asks: 100,
} as const;
