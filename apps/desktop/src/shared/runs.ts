/** The skills a job's panel can run on it, by their names in Factwright's plugin. */
export const RUN_SKILLS = [
  'focused-resume',
  'fit-check',
  'salary-check',
  'who-to-message',
  'interview-prep',
  'answer-questions',
] as const;

export type RunSkill = (typeof RUN_SKILLS)[number];

/** One skill to run on one job, as the window asks the app for it. */
export interface RunTask {
  skill: RunSkill;
  jobId: string;
}
