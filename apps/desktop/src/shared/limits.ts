/** The longest text each tracker field takes. The main process checks them, and the window's inputs stop there. */
export const LIMITS = {
  company: 200,
  role: 300,
  link: 2000,
  pay: 200,
  nextAction: 500,
  notes: 20_000,
  callNotes: 2000,
  /** One question from an application form, which can carry instructions and a word limit. */
  question: 4000,
  /** How many questions one application can have. */
  questions: 50,
} as const;
