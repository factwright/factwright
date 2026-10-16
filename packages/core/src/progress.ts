import { daysBetween } from './dates.ts';
import { FIT_TIERS, type FitTier } from './fit.ts';
import type { Job } from './jobs.ts';
import { asksForCoverLetter } from './letter.ts';
import {
  CALL_STAGE,
  type Call,
  type CallKind,
  type CallMode,
  type CallOutcome,
  type CallPerson,
  type CallState,
  effectiveStatus,
  type JobStatus,
  STATUS_RANK,
} from './tracker.ts';

/** Statuses of jobs the user hasn't applied to yet. */
export const BEFORE_APPLYING: readonly JobStatus[] = ['new', 'review', 'apply', 'later'];

/** Statuses of jobs the user applied to and is still in the running for. */
export const LIVE_STATUSES: readonly JobStatus[] = ['applied', 'screen', 'interview', 'offer'];

/** Statuses that end a job's story. */
export const CLOSED_STATUSES: readonly JobStatus[] = [
  'accepted',
  'declined',
  'rejected',
  'ghosted',
  'withdrawn',
  'passed',
  'role-closed',
];

/** How the status menu groups every status, in order. */
export const STATUS_GROUPS: readonly { label: string; statuses: readonly JobStatus[] }[] = [
  { label: 'Before applying', statuses: BEFORE_APPLYING },
  { label: 'After applying', statuses: LIVE_STATUSES },
  { label: 'Closed', statuses: CLOSED_STATUSES },
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

/** How each way a call happens reads on screen. */
export const CALL_MODE_LABELS: Readonly<Record<CallMode, string>> = {
  phone: 'Phone',
  video: 'Video',
  onsite: 'In person',
};

/** The lengths the call form offers, in minutes. Whole days are an onsite's. */
export const CALL_LENGTHS: readonly number[] = [15, 20, 30, 45, 60, 90, 120, 180, 240, 360];

/** How long a call is, in a few words: "30 min", "1 hour", "1½ hours". */
export function callLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 30) return `${hours}½ hours`;
  if (rest === 0) return hours === 1 ? '1 hour' : `${hours} hours`;
  return `${hours} h ${rest} min`;
}

/** A call's meeting link, as the app shows it: where it goes, in a few words, and the link. */
export interface CallLink {
  href: string;
  /** Its site and path, such as "zoom.us/j/8812345678", without anything it asks for after. */
  shown: string;
  /** Whether the place is the link alone, so there's nothing else in it to show. */
  alone: boolean;
}

/**
 * The meeting link in a call's place, when there's one the app can open: the first https link in
 * it, without the punctuation around it. Pasted from an invite, a place can say more, such as
 * "https://zoom.us/j/8812345678 passcode 4321", which stays to read. Any other kind of link, or
 * one with a name and password in it, is none.
 */
export function callLink(place: string | null): CallLink | null {
  let token = place?.match(/https:\/\/[^\s<>"'()]+/i)?.[0] ?? '';
  // Punctuation after it, as at the end of a sentence, is the sentence's. One at a time, from the
  // end, so a long run of it never makes this slow.
  while (token && '.,;:!?]'.includes(token.at(-1) ?? '')) token = token.slice(0, -1);
  if (!place || !token) return null;
  try {
    const url = new URL(token);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const path = url.pathname.length > 1 ? url.pathname : '';
    return { href: url.href, shown: `${url.host}${path}`, alone: place.trim() === token };
  } catch {
    return null;
  }
}

/** Who a call is with, in a few words: "Priya Shah (Recruiter) and Dana Lee". */
export function callPeople(people: readonly CallPerson[]): string {
  const named = people.map((person) =>
    person.role ? `${person.name} (${person.role})` : person.name,
  );
  if (named.length <= 2) return named.join(' and ');
  return `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
}

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
  /** For a job set aside for later, whether the day it comes back has come. */
  backFromLater: boolean;
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

/**
 * The lists of jobs the jobs page can show, in the order a job moves through them: found and
 * not touched yet, started on but not decided, decided on and waiting to be applied to, applied
 * and waiting to hear, in interviews (an offer included), and closed. Then every job.
 */
export const JOB_VIEWS = [
  'new',
  'review',
  'apply',
  'applied',
  'interviewing',
  'closed',
  'all',
] as const;

export type JobView = (typeof JOB_VIEWS)[number];

/** How each view reads on screen. */
export const JOB_VIEW_LABELS: Readonly<Record<JobView, string>> = {
  new: 'New',
  review: 'To review',
  apply: 'To apply',
  applied: 'Applied',
  interviewing: 'Interviewing',
  closed: 'Closed',
  all: 'All',
};

/**
 * The statuses each view holds. Every status is in one of them, and in "all". To review holds
 * the jobs set aside for later too, folded at its bottom.
 */
export const VIEW_STATUSES: Readonly<Record<Exclude<JobView, 'all'>, readonly JobStatus[]>> = {
  new: ['new'],
  review: ['review', 'later'],
  apply: ['apply'],
  applied: ['applied'],
  interviewing: ['screen', 'interview', 'offer'],
  closed: CLOSED_STATUSES,
};

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

/** A time of day as "HH:MM", some minutes later: past midnight, "24:30" and on. */
function minutesLater(time: string, minutes: number): string {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Whether a booked call is still to come: on a later day, or today and not started yet. Without
 * the time of day, a call today is to come all day.
 */
const isAhead = (call: Call, today: string, clock?: string) =>
  call.onDate > today || (call.onDate === today && !(clock && call.atTime && call.atTime <= clock));

/**
 * Whether a booked call is over: on an earlier day, or today and past its end, an hour after it
 * starts unless its length says otherwise.
 */
const isOver = (call: Call, today: string, clock?: string) =>
  call.onDate < today ||
  (call.onDate === today &&
    Boolean(clock && call.atTime && minutesLater(call.atTime, call.minutes ?? 60) <= clock));

/**
 * When the time of day next matters to a job's calls today: the start or end of one still to
 * come, as "HH:MM", or null when nothing changes before midnight.
 */
export function nextCallMoment(
  calls: readonly Call[],
  today: string,
  clock: string,
): string | null {
  const moments = calls
    .filter((call) => call.state === 'scheduled' && call.onDate === today && call.atTime)
    .flatMap((call) => [call.atTime ?? '', minutesLater(call.atTime ?? '', call.minutes ?? 60)])
    .filter((moment) => moment > clock && moment < '24:00')
    .sort();
  return moments[0] ?? null;
}

function attentionFor(
  job: Job,
  progress: Omit<JobProgress, 'attention'>,
  calls: readonly Call[],
  today: string,
  clock?: string,
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
  const unlogged = calls.find((call) => call.state === 'scheduled' && isOver(call, today, clock));
  if (unlogged) {
    return {
      level: 'action',
      text: `How did the ${CALL_KIND_LABELS[unlogged.kind].toLowerCase()} go?`,
    };
  }
  if (nextCall && daysBetween(today, nextCall.onDate) <= 3) {
    const when = callWhen(nextCall, today);
    // Two days out, a call with no prep sheet yet needs the user: time to get ready for it.
    const prepped = job.callDocs.some((doc) => doc.callId === nextCall.id && doc.kind === 'prep');
    if (!prepped && daysBetween(today, nextCall.onDate) <= 2) {
      const kind = CALL_KIND_LABELS[nextCall.kind].toLowerCase();
      return { level: 'action', text: `Prep for the ${kind} ${when}` };
    }
    return { level: 'info', text: `${CALL_KIND_LABELS[nextCall.kind]} ${when}` };
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
  if (status === 'later' && progress.backFromLater) {
    return { level: 'action', text: 'Back from Later. Apply or pass?' };
  }
  if ((status === 'review' || status === 'apply') && job.files.length > 0) {
    const days = daysSince(progress.lastActivity);
    if (days !== null && days >= 5) {
      const ask = status === 'apply' ? 'Apply?' : 'Apply or pass?';
      return { level: 'info', text: `Resume ready for ${days} days. ${ask}` };
    }
  }
  return null;
}

/**
 * Where a job stands today. With the time of day, as "HH:MM", a call today is next only until it
 * starts, and asks how it went once it's over.
 */
export function jobProgress(job: Job, today: string, clock?: string): JobProgress {
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
  const backFromLater = status === 'later' && job.backOn !== null && job.backOn <= today;
  const dates = [
    job.lastActivity,
    job.statusOn,
    job.appliedOn,
    ...job.statusLog.map((change) => change.at),
    ...calls.filter((call) => call.onDate <= today).map((call) => call.onDate),
    ...job.notes.filter((note) => note.on <= today).map((note) => note.on),
    // A job set aside comes back up on its day, as if something had happened.
    backFromLater && job.backOn,
  ].filter((date): date is string => Boolean(date));
  const progress = {
    status,
    backFromLater,
    reached,
    score,
    tier: fitTier(job, score),
    lastActivity: dates.sort().at(-1) ?? job.firstSeen,
    nextCall:
      calls.find((call) => call.state === 'scheduled' && isAhead(call, today, clock)) ?? null,
  };
  return { ...progress, attention: attentionFor(job, progress, calls, today, clock) };
}

/** Whether a job belongs in a view of the jobs page, by the status it shows. */
export function isInView(view: JobView, status: JobStatus): boolean {
  return view === 'all' || VIEW_STATUSES[view].includes(status);
}

/**
 * Whether a job is set aside for later: folded at the bottom of To review, outside its count,
 * until the day it comes back, if the user gave one.
 */
export function isSetAside(progress: Pick<JobProgress, 'status' | 'backFromLater'>): boolean {
  return progress.status === 'later' && !progress.backFromLater;
}

/**
 * The view to open on: the furthest along that has jobs in it, where things move fastest, from
 * interviews back to the jobs not touched yet, and the closed ones when there's nothing else.
 * Leave out the jobs set aside for later, which To review folds away.
 */
export function startingView(statuses: readonly JobStatus[]): JobView {
  const views = ['interviewing', 'applied', 'apply', 'review', 'new', 'closed'] as const;
  return views.find((view) => statuses.some((status) => isInView(view, status))) ?? 'new';
}

/** The view a job with this status is in, other than "all". */
export function viewOf(status: JobStatus): Exclude<JobView, 'all'> {
  const views = Object.keys(VIEW_STATUSES) as Exclude<JobView, 'all'>[];
  return views.find((view) => VIEW_STATUSES[view].includes(status)) ?? 'new';
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
  const check = () => step(looksHidden(job) ? 'Find the real employer' : 'Run a fit check');
  switch (progress.status) {
    case 'new':
      if (!job.role || progress.tier === 'skip') return null;
      return check();
    case 'review':
      if (!job.role) return null;
      if (job.files.length > 0) return step('Resume ready. Apply or pass?');
      if (!job.fit) return check();
      return step(progress.tier === 'skip' ? 'Fit check says skip. Pass?' : 'Apply or pass?');
    case 'apply': {
      // A posting that asks for a cover letter gets one before the job's ready.
      const letter = asksForCoverLetter(job) && job.letters.length === 0;
      if (job.files.length === 0) {
        return step(letter ? 'Tailor a resume and a cover letter' : 'Tailor a resume');
      }
      return step(letter ? 'The posting asks for a cover letter' : 'Ready to apply');
    }
    case 'later':
      return job.backOn && job.backOn > today ? step(`Back ${dayFrom(job.backOn, today)}`) : null;
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
    interviewing: count(({ progress }) => isInView('interviewing', progress.status)),
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
