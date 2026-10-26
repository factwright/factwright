/**
 * Every status a job can have, from first look to outcome, in the order the status menu lists
 * them: before applying, after applying, and closed.
 */
export const JOB_STATUSES = [
  'new',
  'review',
  'apply',
  'later',
  'applied',
  'screen',
  'interview',
  'offer',
  'accepted',
  'declined',
  'rejected',
  'ghosted',
  'withdrawn',
  'passed',
  'role-closed',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/** How each status reads on screen: in the same words as the views of the jobs page. */
export const JOB_STATUS_LABELS: Readonly<Record<JobStatus, string>> = {
  new: 'New',
  review: 'To review',
  apply: 'To apply',
  later: 'Later',
  applied: 'Applied',
  screen: 'Screen',
  interview: 'Interview',
  offer: 'Offer',
  accepted: 'Accepted',
  declined: 'Declined',
  rejected: 'Rejected',
  ghosted: 'No reply',
  withdrawn: 'Withdrawn',
  passed: 'Passed',
  'role-closed': 'Role closed',
};

/**
 * Statuses Claude's work alone can give a job: found, or worked on, such as with a fit check.
 * Anything else is the user's own decision.
 */
export const AUTO_STATUSES: readonly JobStatus[] = ['new', 'review'];

/** How far along each forward step is. Later and outcomes like "rejected" have no rank. */
export const STATUS_RANK: Readonly<Partial<Record<JobStatus, number>>> = {
  new: 0,
  review: 1,
  apply: 2,
  applied: 3,
  screen: 4,
  interview: 5,
  offer: 6,
  accepted: 6,
  declined: 6,
};

/**
 * Statuses earlier versions had, and how they read now. What Claude did for a job shows in its
 * fit score and next step instead, so a job "checked" or with its "resume" ready is to review.
 */
const EARLIER_STATUSES = new Map<string, JobStatus>([
  ['checked', 'review'],
  ['resume', 'review'],
]);

/**
 * A status as the tracker keeps it, read for this version. One an earlier version set reads as
 * its status now. Null for none, or for one only a newer version knows.
 */
export function readStatus(value: unknown): JobStatus | null {
  if (typeof value !== 'string') return null;
  if ((JOB_STATUSES as readonly string[]).includes(value)) return value as JobStatus;
  return EARLIER_STATUSES.get(value) ?? null;
}

/** Why the user passed on a job, when they say. The job search reads it. */
export const PASS_REASONS = ['pay', 'level', 'location', 'work', 'company', 'other'] as const;

export type PassReason = (typeof PASS_REASONS)[number];

/** How each reason for passing reads on screen. */
export const PASS_REASON_LABELS: Readonly<Record<PassReason, string>> = {
  pay: 'Pay',
  level: 'Level',
  location: 'Location',
  work: 'Not my kind of work',
  company: 'The company',
  other: 'Something else',
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

/**
 * How far Claude's work alone has taken a job: found, or worked on, such as with a fit check, a
 * salary check, a resume or an answer to the user's question.
 */
export type JobStage = Extract<JobStatus, 'new' | 'review'>;

/**
 * Outcomes a call can't undo. Logging a call can revive a job marked ghosted or passed, but not
 * these: a call logged afterward is most often one that happened before.
 */
export const SETTLED_STATUSES: readonly JobStatus[] = [
  'rejected',
  'withdrawn',
  'accepted',
  'declined',
  'role-closed',
];

/**
 * Statuses a job only reaches once the user has applied, and sent its resume. Passed and Role
 * closed can come before applying, so they go by the applied date alone.
 */
export const SENT_STATUSES: readonly JobStatus[] = [
  'applied',
  'screen',
  'interview',
  'offer',
  'accepted',
  'declined',
  'rejected',
  'ghosted',
  'withdrawn',
];

/** Whether the user has applied to the job, so the resume they sent stays as it went out. */
export const resumeSent = (job: Pick<TrackerFields, 'appliedOn' | 'status'>): boolean =>
  Boolean(job.appliedOn || (job.status && SENT_STATUSES.includes(job.status)));

/** Where a logged call stands. */
export const CALL_STATES = ['scheduled', 'done', 'canceled'] as const;

export type CallState = (typeof CALL_STATES)[number];

/** How a call went. */
export const CALL_OUTCOMES = ['advanced', 'waiting', 'rejected'] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** How a call happens: by phone, on a video call, or in person. */
export const CALL_MODES = ['phone', 'video', 'onsite'] as const;

export type CallMode = (typeof CALL_MODES)[number];

/** Someone the user meets on a call. */
export interface CallPerson {
  name: string;
  /** Their part in it, such as "Recruiter" or "Hiring manager", when the user gave it. */
  role: string | null;
}

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

/**
 * A job's details as the user set them in its panel: its company, role, pay and place, such as
 * "Remote (US)". Each one wins over what the posting or Claude's work says, and Claude's work
 * never changes it. Null for one the user left to them.
 */
export interface OwnDetails {
  company: string | null;
  role: string | null;
  pay: string | null;
  location: string | null;
}

/** No details of the user's own. */
export const NO_OWN_DETAILS: OwnDetails = { company: null, role: null, pay: null, location: null };

/**
 * Another job your Claude found might be this one, without being sure enough to merge them: the
 * user merges them, or says they aren't the same, and then it shows no more.
 */
export interface MaybeSame {
  /** The other job, by its ID. */
  id: string;
  /** Why it might be, in a line, as your Claude put it. */
  why: string | null;
  /** When your Claude noted it, as an ISO date. */
  on: string;
  /** The user said the two aren't the same. */
  notSame: boolean;
}

/** What the user tracks about a job by hand. */
export interface TrackerFields {
  status: JobStatus | null;
  /** When the current status started. */
  statusOn: string | null;
  /** For a job set aside for later, the day it comes back to review, when the user gave one. */
  backOn: string | null;
  /** Why the user passed on the job, when they said. */
  passReason: PassReason | null;
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
  /**
   * The kind of job the user put it under, by its id, such as "project-manager". Null goes by
   * what the job search or fit check found it as.
   */
  kind: string | null;
  /**
   * The pay the user asks for there, in their own words, such as "$185,000". Null goes by their
   * Claude's suggestion, or else their target pay.
   */
  payAsk: string | null;
  /** The details the user set in the job's panel, which win over what Claude found. */
  own: OwnDetails;
  /** Other jobs your Claude found might be this one, for the user to merge or not. */
  maybeSame: MaybeSame[];
}

/** A call or interview the user logged for a job: one step in the company's hiring process. */
export interface Call {
  id: string;
  kind: CallKind;
  onDate: string;
  /** "HH:MM", when the user gave a time. */
  atTime: string | null;
  /** How long it's booked for, in minutes, when the user gave it. */
  minutes: number | null;
  /** By phone, video or in person, when the user gave it. */
  mode: CallMode | null;
  /** Where it happens: the meeting's link, a number to call, or an address. */
  place: string | null;
  /** Who it's with, in the order the user gave them. */
  people: CallPerson[];
  state: CallState;
  outcome: CallOutcome | null;
  /** What it's about, written before it: who asked for it, what to bring. */
  notes: string | null;
  /** How it went, in the user's own words, written after it. */
  debrief: string | null;
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
 * The status a job shows: the user's own, unless Claude's work has since taken the job further.
 * A job the user left at "new" shows "review" once Claude does something for it.
 */
export function effectiveStatus(status: JobStatus | null, stage: JobStage): JobStatus {
  if (!status) return stage;
  const ahead = (STATUS_RANK[stage] ?? 0) > (STATUS_RANK[status] ?? 0);
  return AUTO_STATUSES.includes(status) && ahead ? stage : status;
}
