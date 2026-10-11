import { daysBetween } from './dates.ts';
import { FIT_TIERS, type FitTier } from './fit.ts';
import type { Job } from './jobs.ts';
import {
  CALL_STAGE,
  type Call,
  type CallKind,
  type CallOutcome,
  type CallState,
  effectiveStatus,
  type JobStatus,
  STATUS_RANK,
} from './tracker.ts';

/** Statuses of jobs the user applied to and is still in the running for. */
export const LIVE_STATUSES: readonly JobStatus[] = ['applied', 'screen', 'interview', 'offer'];

/** Statuses that end a job's story. */
export const CLOSED_STATUSES: readonly JobStatus[] = [
  'accepted',
  'declined',
  'rejected',
  'ghosted',
  'passed',
  'withdrawn',
];

/** How each kind of call reads on screen. */
export const CALL_KIND_LABELS: Readonly<Record<CallKind, string>> = {
  screen: 'Recruiter screen',
  manager: 'Hiring manager call',
  technical: 'Technical interview',
  takehome: 'Take-home',
  panel: 'Panel interview',
  final: 'Final round',
  offer: 'Offer call',
  other: 'Call',
};

/** How each state of a logged call reads on screen. */
export const CALL_STATE_LABELS: Readonly<Record<CallState, string>> = {
  scheduled: 'Scheduled',
  done: 'Done',
  canceled: 'Canceled',
};

/** How each outcome of a call reads on screen. */
export const CALL_OUTCOME_LABELS: Readonly<Record<CallOutcome, string>> = {
  advanced: 'Moved forward',
  waiting: 'Waiting to hear',
  rejected: 'Rejected',
};

/** How pressing something is: late, waiting on the user now, or good to know. */
export type AttentionLevel = 'urgent' | 'action' | 'info';

export interface Attention {
  level: AttentionLevel;
  text: string;
}

/** Where a job stands today, worked out from what the skills did and what the user tracked. */
export interface JobProgress {
  /** The status the job shows. */
  status: JobStatus;
  /** The furthest step it reached, as a status rank. A rejection counts as having applied. */
  reached: number;
  /** The fit check's score, or else the job search's. */
  score: number | null;
  tier: FitTier | null;
  /** When something last happened with it. */
  lastActivity: string | null;
  /** The next call booked for today or later. */
  nextCall: Call | null;
  /** What needs the user, if anything. */
  attention: Attention | null;
}

/** The lists of jobs the jobs page can show. */
export const JOB_VIEWS = ['active', 'review', 'applied', 'closed', 'all'] as const;

export type JobView = (typeof JOB_VIEWS)[number];

/** Signs that a posting hides the real employer behind a recruiter or a job board. */
const HIDDEN_EMPLOYER =
  /staffing|recruit|talent|confidential|unnamed|undisclosed|stealth|\bclient\b|executive search|search partners/i;
const JOB_BOARD =
  /ladders|ziprecruiter|dice\.com|indeed\.|builtin|glassdoor|monster\.|careerbuilder|simplyhired|jobot|lensa|talent\.com|jooble|hired\.com/i;

/** Statuses that count as having applied, even though the job didn't get further. */
const ENDED_AFTER_APPLYING: readonly JobStatus[] = ['rejected', 'ghosted', 'withdrawn'];

const rank = (status: JobStatus) => STATUS_RANK[status] ?? 0;
const callRank = (kind: CallKind) => (kind === 'other' ? 0 : rank(CALL_STAGE[kind]));

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });
const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const asDate = (date: string) => new Date(`${date}T00:00:00Z`);

/** A clock time from "HH:MM": "14:05" is "2:05 PM". */
export function clockTime(time: string): string {
  const hours = Number(time.slice(0, 2));
  const half = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 || 12}:${time.slice(3, 5)} ${half}`;
}

/** When a day is, from today: "today", "tomorrow", "Thursday", or "Thu, Oct 22" further out. */
export function dayFrom(date: string, today: string): string {
  const days = daysBetween(today, date);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1 && days < 7) return WEEKDAY.format(asDate(date));
  return SHORT_DATE.format(asDate(date));
}

/** When a call is: "tomorrow at 10:30 AM", or "Thursday". */
export function callWhen(call: Pick<Call, 'onDate' | 'atTime'>, today: string): string {
  const day = dayFrom(call.onDate, today);
  return call.atTime ? `${day} at ${clockTime(call.atTime)}` : day;
}

/**
 * How well a job fits. A fit check's verdict comes first, then a job search's tier, and then
 * the score alone: 75 and up is strong, 62 good, 50 worth a look, and below that a long shot.
 */
export function fitTier(job: Pick<Job, 'fit' | 'search'>, score: number | null): FitTier | null {
  const verdict = job.fit?.verdict?.toLowerCase() ?? '';
  const named = FIT_TIERS.find((tier) => verdict.startsWith(tier));
  if (named) return named;
  if (job.search?.tier) return job.search.tier;
  if (score === null) return null;
  if (score >= 75) return 'strong';
  if (score >= 62) return 'good';
  return score >= 50 ? 'worth' : 'long';
}

function attentionFor(
  job: Job,
  progress: Omit<JobProgress, 'attention'>,
  calls: readonly Call[],
  today: string,
): Attention | null {
  if (job.archived) return null;
  const { status, nextCall } = progress;
  if (job.nextOn && job.nextOn <= today && !CLOSED_STATUSES.includes(status)) {
    const late = job.nextOn < today;
    const step = job.nextAction ?? 'your next step';
    return {
      level: late ? 'urgent' : 'action',
      text: `${late ? 'Overdue' : 'Due today'}: ${step}`,
    };
  }
  const unlogged = calls.find((call) => call.state === 'scheduled' && call.onDate < today);
  if (unlogged) {
    return {
      level: 'action',
      text: `How did the ${CALL_KIND_LABELS[unlogged.kind].toLowerCase()} go?`,
    };
  }
  if (nextCall && daysBetween(today, nextCall.onDate) <= 3) {
    const text = `${CALL_KIND_LABELS[nextCall.kind]} ${callWhen(nextCall, today)}`;
    return { level: 'info', text };
  }
  const daysSince = (date: string | null) => (date ? daysBetween(date, today) : null);
  if (status === 'applied') {
    const days = daysSince(job.statusOn ?? job.appliedOn);
    if (days !== null && days >= 30) {
      return { level: 'urgent', text: `No reply in ${days} days. Mark it “No reply”?` };
    }
    if (days !== null && days >= 10) {
      return { level: 'action', text: `Applied ${days} days ago. Follow up?` };
    }
  }
  if (status === 'screen' || status === 'interview') {
    const days = daysSince(job.statusOn);
    if (days !== null && days >= 7) return { level: 'action', text: `No update in ${days} days` };
  }
  if (status === 'resume') {
    const days = daysSince(job.lastActivity);
    if (days !== null && days >= 5) {
      return { level: 'info', text: `Resume ready for ${days} days. Apply or pass?` };
    }
  }
  return null;
}

/** Where a job stands today. */
export function jobProgress(job: Job, today: string): JobProgress {
  const status = effectiveStatus(job.status, job.stage);
  const calls = job.calls.filter((call) => call.state !== 'canceled');
  const ended = [status, ...job.statusLog.map((change) => change.status)].some((each) =>
    ENDED_AFTER_APPLYING.includes(each),
  );
  const reached = Math.max(
    rank(job.stage),
    rank(status),
    ...job.statusLog.map((change) => rank(change.status)),
    ...calls.map((call) => callRank(call.kind)),
    ended ? rank('applied') : 0,
  );
  const score = job.fit?.score ?? job.search?.score ?? null;
  const dates = [
    job.lastActivity,
    job.statusOn,
    job.appliedOn,
    ...job.statusLog.map((change) => change.at),
    ...calls.filter((call) => call.onDate <= today).map((call) => call.onDate),
  ].filter((date): date is string => Boolean(date));
  const progress = {
    status,
    reached,
    score,
    tier: fitTier(job, score),
    lastActivity: dates.sort().at(-1) ?? job.firstSeen,
    nextCall: calls.find((call) => call.state === 'scheduled' && call.onDate >= today) ?? null,
  };
  return { ...progress, attention: attentionFor(job, progress, calls, today) };
}

/** Whether a job belongs in a view of the jobs page, by the status it shows. */
export function isInView(view: JobView, status: JobStatus): boolean {
  switch (view) {
    case 'active':
      return status !== 'new' && !CLOSED_STATUSES.includes(status);
    case 'review':
      return status === 'new';
    case 'applied':
      return LIVE_STATUSES.includes(status);
    case 'closed':
      return CLOSED_STATUSES.includes(status);
    case 'all':
      return true;
  }
}

/** Whether a posting looks like it hides the real employer. */
export function looksHidden(job: Pick<Job, 'company' | 'role' | 'link'>): boolean {
  return HIDDEN_EMPLOYER.test(`${job.company} ${job.role}`) || JOB_BOARD.test(job.link ?? '');
}

/**
 * The job's next step, in a few words: what needs the user first, then the step they set,
 * then a booked call, and otherwise what usually comes next from where the job stands.
 */
export function nextStep(job: Job, progress: JobProgress, today: string): Attention | null {
  if (progress.attention) return progress.attention;
  if (job.nextAction) {
    const by = job.nextOn ? ` · ${dayFrom(job.nextOn, today)}` : '';
    return { level: 'info', text: `${job.nextAction}${by}` };
  }
  if (progress.nextCall) {
    const call = progress.nextCall;
    return { level: 'info', text: `${CALL_KIND_LABELS[call.kind]} ${callWhen(call, today)}` };
  }
  const step = (text: string): Attention => ({ level: 'info', text });
  switch (progress.status) {
    case 'new':
      if (!job.role || progress.tier === 'skip') return null;
      return step(looksHidden(job) ? 'Find the real employer' : 'Run a fit check');
    case 'checked':
      return step('Tailor a resume');
    case 'resume':
      return step('Ready to apply');
    case 'applied': {
      if (!job.appliedOn) return step('Waiting to hear back');
      const days = daysBetween(job.appliedOn, today);
      if (days <= 0) return step('Applied today');
      return step(days === 1 ? 'Applied yesterday' : `Applied ${days} days ago`);
    }
    case 'screen':
    case 'interview':
      return step('Waiting to hear back');
    case 'offer':
      return step('Decide on the offer');
    default:
      return null;
  }
}

/** The numbers across the top of the jobs page. */
export interface JobStats {
  /** Applied and still in the running. */
  inPlay: number;
  interviewing: number;
  callsAhead: number;
  /** Applied at some point, whatever happened next. */
  applied: number;
  appliedThisWeek: number;
  /** Of those applied, how many got a call or an answer. */
  heardBack: number;
  needsYou: number;
  urgent: number;
}

export function jobStats(
  jobs: readonly { job: Job; progress: JobProgress }[],
  today: string,
): JobStats {
  const applied = jobs.filter(({ progress }) => progress.reached >= rank('applied'));
  const count = (test: (entry: { job: Job; progress: JobProgress }) => boolean) =>
    jobs.filter(test).length;
  return {
    inPlay: count(({ progress }) => LIVE_STATUSES.includes(progress.status)),
    interviewing: count(({ progress }) => ['screen', 'interview'].includes(progress.status)),
    callsAhead: jobs.reduce(
      (total, { job }) =>
        total +
        job.calls.filter((call) => call.state === 'scheduled' && call.onDate >= today).length,
      0,
    ),
    applied: applied.length,
    appliedThisWeek: applied.filter(
      ({ job }) => job.appliedOn && daysBetween(job.appliedOn, today) < 7,
    ).length,
    heardBack: applied.filter(
      ({ progress }) => progress.reached >= rank('screen') || progress.status === 'rejected',
    ).length,
    needsYou: count(({ progress }) => progress.attention !== null),
    urgent: count(({ progress }) => progress.attention?.level === 'urgent'),
  };
}
