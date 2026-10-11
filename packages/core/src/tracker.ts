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

/** How far the skills' work alone has taken a job: found, checked, or with a resume built. */
export type JobStage = Extract<JobStatus, 'new' | 'checked' | 'resume'>;

/** Outcomes a call can't undo. Logging a call can revive a job marked ghosted or passed, but not these. */
export const SETTLED_STATUSES: readonly JobStatus[] = [
  'rejected',
  'withdrawn',
  'accepted',
  'declined',
];

/** Where a logged call stands. */
export const CALL_STATES = ['scheduled', 'done', 'canceled'] as const;

export type CallState = (typeof CALL_STATES)[number];

/** How a call went. */
export const CALL_OUTCOMES = ['advanced', 'waiting', 'rejected'] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** What the user tracks about a job by hand. */
export interface TrackerFields {
  status: JobStatus | null;
  /** When the current status started. */
  statusOn: string | null;
  appliedOn: string | null;
  nextAction: string | null;
  nextOn: string | null;
  notes: string | null;
  /** Questions from the job's application form, which the user pasted for Claude to answer. */
  questions: string[];
  archived: boolean;
}

/** A call or interview the user logged for a job. */
export interface Call {
  id: string;
  kind: CallKind;
  onDate: string;
  /** "HH:MM", when the user gave a time. */
  atTime: string | null;
  state: CallState;
  outcome: CallOutcome | null;
  notes: string | null;
}

/** One change of status, for a job's history and for undoing a mis-click. */
export interface StatusChange {
  id: string;
  status: JobStatus;
  at: string;
}

/**
 * The status a job shows: the user's own, unless the skills have since taken the job further.
 * A job the user marked "checked" shows "resume" once a resume is built.
 */
export function effectiveStatus(status: JobStatus | null, stage: JobStage): JobStatus {
  if (!status) return stage;
  const ahead = (STATUS_RANK[stage] ?? 0) > (STATUS_RANK[status] ?? 0);
  return AUTO_STATUSES.includes(status) && ahead ? stage : status;
}
