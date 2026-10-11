/** The longest text each tracker field takes. The main process checks them, and the window's inputs stop there. */
export const LIMITS = {
  company: 200,
  role: 300,
  link: 2000,
  pay: 200,
  nextAction: 500,
  notes: 20_000,
  callNotes: 2000,
} as const;
