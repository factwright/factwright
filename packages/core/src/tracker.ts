/** Every status a job can have, from first look to outcome. */
export const JOB_STATUSES = [
  'new',
  'checked',
  'resume',
  'applied',
  'screen',
  'interview',
  'offer',
  'accepted',
  'declined',
  'rejected',
  'ghosted',
  'passed',
  'withdrawn',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/** Statuses the tools set on their own. Anything later is set by the user. */
export const AUTO_STATUSES: readonly JobStatus[] = ['new', 'checked', 'resume'];

/** How far along each forward step is. Outcomes like "rejected" have no rank. */
export const STATUS_RANK: Readonly<Partial<Record<JobStatus, number>>> = {
  new: 0,
  checked: 1,
  resume: 2,
  applied: 3,
  screen: 4,
  interview: 5,
  offer: 6,
  accepted: 6,
  declined: 6,
};

/** Kinds of calls and interviews a user can log against a job. */
export const CALL_KINDS = [
  'screen',
  'manager',
  'technical',
  'takehome',
  'panel',
  'final',
  'offer',
  'other',
] as const;

export type CallKind = (typeof CALL_KINDS)[number];

/** The status a call implies once it's booked. "other" implies none. */
export const CALL_STAGE = {
  screen: 'screen',
  manager: 'interview',
  technical: 'interview',
  takehome: 'interview',
  panel: 'interview',
  final: 'interview',
  offer: 'offer',
} as const satisfies Partial<Record<CallKind, JobStatus>>;
