/** The longest text each tracker field takes. The main process checks them, and the window's inputs stop there. */
export const LIMITS = {
  company: 200,
  role: 300,
  link: 2000,
  pay: 200,
  nextAction: 500,
  /** The one undated box of notes the app had before notes were dated. */
  notes: 20_000,
  /** One dated note, such as what was said on a call. */
  note: 10_000,
  callNotes: 2000,
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
