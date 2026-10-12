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

/** What the user actually sent for one of an application's questions, in their own words. */
export interface SentAnswer {
  /** The question, as the form asked it. */
  question: string;
  /** For a question the form asks more than once, such as "If yes, please explain", which time. */
  nth: number;
  text: string;
  /** When they recorded it, as an ISO date. */
  on: string;
  /** When they recorded it, to the moment, so the latest of two devices' changes wins. */
  at: string;
}

/** A question the user asked Claude about a job. Claude saves its answer in the job's folder. */
export interface Ask {
  /** Unique among the job's questions. Its answer is asked/<id>.md in the job's folder. */
  id: string;
  question: string;
  /** When they asked, as an ISO date. */
  on: string;
}

/** What the user tracks about a job by hand. */
export interface TrackerFields {
  status: JobStatus | null;
  /** When the current status started. */
  statusOn: string | null;
  appliedOn: string | null;
  nextAction: string | null;
  nextOn: string | null;
  /** Questions from the job's application form, which the user pasted for Claude to answer. */
  questions: string[];
  /** What the user actually sent for the form's questions, recorded after applying. */
  sent: SentAnswer[];
  /** Questions the user asked Claude about the job. */
  asks: Ask[];
  /**
   * What the user kept in the one free-text notes box the app had before notes were dated. New
   * notes are dated, one each.
   */
  earlierNotes: string | null;
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

/** A note the user jotted about a job along the way, such as what was said on a call. */
export interface Note {
  id: string;
  /** The day it's about, as an ISO date: the day it was written, unless the user changed it. */
  on: string;
  text: string;
  /** When it was written, to the moment, so notes from the same day keep their order. */
  at: string;
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
