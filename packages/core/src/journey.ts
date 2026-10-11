import type { Job } from './jobs.ts';
import type { JobProgress } from './progress.ts';
import { type CallKind, type JobStatus, STATUS_RANK } from './tracker.ts';

/** The steps a job can go through, in order. */
export const JOURNEY_STAGES = [
  'found',
  'checked',
  'resume',
  'applied',
  'screen',
  'interview',
  'final',
  'offer',
] as const;

export type JourneyStage = (typeof JOURNEY_STAGES)[number];

/** How each step reads in the flow chart and the spreadsheet. */
export const JOURNEY_STAGE_LABELS: Readonly<Record<JourneyStage, string>> = {
  found: 'Jobs found',
  checked: 'Checked',
  resume: 'Resume built',
  applied: 'Applied',
  screen: 'Recruiter screen',
  interview: 'Interviews',
  final: 'Final round',
  offer: 'Offer',
};

/** How a job's story ended, or where it stands now. */
export type JourneyOutcome =
  | 'Accepted offer'
  | 'Declined offer'
  | 'Rejected'
  | 'No response'
  | 'Withdrew'
  | 'Passed'
  | 'In progress'
  | 'Not applied';

const OUTCOMES: Readonly<Partial<Record<JobStatus, JourneyOutcome>>> = {
  accepted: 'Accepted offer',
  declined: 'Declined offer',
  rejected: 'Rejected',
  ghosted: 'No response',
  withdrawn: 'Withdrew',
  passed: 'Passed',
};

/** Colors for the flow chart's outcomes, so they read at a glance. */
const FLOW_COLORS: Readonly<Record<string, string>> = {
  'Accepted offer': '#1f7a45',
  Offer: '#23824a',
  'Declined offer': '#6248cc',
  Rejected: '#bb2d2d',
  'No response': '#85806f',
  Withdrew: '#9a5b00',
  Passed: '#a8a69d',
  'Not applied': '#c4c2b9',
  'In progress': '#2a66d0',
};

const INTERVIEW_CALLS: readonly CallKind[] = ['manager', 'technical', 'takehome', 'panel', 'final'];

/** One job's path: when it reached each step, and how it ended. */
export interface Journey {
  job: Job;
  /** The steps it reached, each with its date, or "" when the date isn't known. */
  dates: Partial<Record<JourneyStage, string>>;
  stages: JourneyStage[];
  outcome: JourneyOutcome;
  outcomeOn: string | null;
}

const rank = (status: JobStatus) => STATUS_RANK[status] ?? 0;

function earliest(...dates: (string | null | undefined)[]): string | null {
  return dates.filter((date): date is string => Boolean(date)).sort()[0] ?? null;
}

/** The steps one job went through, from what the skills did, its history and its calls. */
export function journeyOf(job: Job, progress: JobProgress): Journey {
  const calls = job.calls.filter((call) => call.state !== 'canceled');
  const callOn = (kinds: readonly CallKind[]) =>
    earliest(...calls.filter((call) => kinds.includes(call.kind)).map((call) => call.onDate));
  const changedOn = (statuses: readonly JobStatus[]) =>
    earliest(
      ...job.statusLog
        .filter((change) => statuses.includes(change.status))
        .map((change) => change.at),
    );
  const had = (statuses: readonly JobStatus[]) =>
    statuses.includes(progress.status) ||
    job.statusLog.some((change) => statuses.includes(change.status));

  const found = job.firstSeen ?? progress.lastActivity ?? '';
  const dates: Partial<Record<JourneyStage, string>> = { found };
  if (job.fit || job.folder || progress.reached >= rank('checked')) {
    const work = job.events.filter((event) => event.tool !== 'search').map((event) => event.date);
    dates.checked = earliest(job.fit?.date, ...work) ?? found;
  }
  if (job.files.length > 0) {
    const built = job.events.filter((event) => event.tool === 'resume').map((event) => event.date);
    dates.resume = earliest(...built) ?? dates.checked ?? found;
  }
  if (progress.reached >= rank('applied')) {
    dates.applied = earliest(job.appliedOn, changedOn(['applied'])) ?? '';
  }
  if (had(['screen']) || callOn(['screen'])) {
    dates.screen = earliest(callOn(['screen']), changedOn(['screen'])) ?? '';
  }
  if (had(['interview']) || callOn(INTERVIEW_CALLS)) {
    dates.interview = earliest(callOn(INTERVIEW_CALLS), changedOn(['interview'])) ?? '';
  }
  const finalRound = callOn(['final']);
  if (finalRound) dates.final = finalRound;
  if (had(['offer', 'accepted', 'declined']) || callOn(['offer'])) {
    dates.offer = earliest(callOn(['offer']), changedOn(['offer', 'accepted', 'declined'])) ?? '';
  }

  const ended = OUTCOMES[progress.status];
  return {
    job,
    dates,
    stages: JOURNEY_STAGES.filter((stage) => dates[stage] !== undefined),
    outcome: ended ?? (dates.applied !== undefined ? 'In progress' : 'Not applied'),
    outcomeOn: ended ? job.statusOn : null,
  };
}

/** Every job's journey. Jobs without a role, such as messages to a company, aren't jobs here. */
export function journeys(entries: readonly { job: Job; progress: JobProgress }[]): Journey[] {
  return entries.filter(({ job }) => job.role).map(({ job, progress }) => journeyOf(job, progress));
}

/** How many jobs got how far, and how the ones that ended, ended. */
export interface JourneySummary {
  found: number;
  checked: number;
  resume: number;
  applied: number;
  /** Applied, then got a call or an answer. */
  heardBack: number;
  interviewed: number;
  offers: number;
  outcomes: Partial<Record<JourneyOutcome, number>>;
}

export function journeySummary(list: readonly Journey[]): JourneySummary {
  const reached = (stage: JourneyStage) => list.filter((each) => stage in each.dates).length;
  const outcomes: Partial<Record<JourneyOutcome, number>> = {};
  for (const { outcome } of list) outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  return {
    found: list.length,
    checked: reached('checked'),
    resume: reached('resume'),
    applied: reached('applied'),
    heardBack: list.filter(
      (each) =>
        'applied' in each.dates &&
        (['screen', 'interview', 'offer'].some((stage) => stage in each.dates) ||
          each.outcome === 'Rejected'),
    ).length,
    interviewed: reached('interview'),
    offers: reached('offer'),
    outcomes,
  };
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Every path the jobs took, as text for SankeyMATIC (sankeymatic.com), which draws it as a
 * flow chart: one line per step, such as "Applied [7] Recruiter screen".
 */
export function journeyFlowChart(list: readonly Journey[], today: string): string {
  const flows = new Map<string, { from: string; to: string; count: number }>();
  const add = (from: string, to: string) => {
    const key = `${from}\u0000${to}`;
    const flow = flows.get(key) ?? { from, to, count: 0 };
    flow.count++;
    flows.set(key, flow);
  };
  for (const { stages, outcome } of list) {
    const labels = stages.map((stage) => JOURNEY_STAGE_LABELS[stage]);
    labels.forEach((label, i) => {
      const previous = labels[i - 1];
      if (previous) add(previous, label);
    });
    const last = labels.at(-1);
    if (last) add(last, outcome);
  }
  const used = new Set([...flows.values()].flatMap(({ from, to }) => [from, to]));
  const colors = Object.entries(FLOW_COLORS)
    .filter(([name]) => used.has(name))
    .map(([name, color]) => `:${name} ${color}`);
  const month = MONTH.format(new Date(`${today}T00:00:00Z`));
  return [
    `// Job-search journey, ${month}`,
    ...[...flows.values()].map(({ from, to, count }) => `${from} [${count}] ${to}`),
    '',
    ...colors,
  ].join('\n');
}

/** A spreadsheet cell. Text that a spreadsheet would run as a formula starts with "'" instead. */
function csvCell(value: string): string {
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Every job's journey as a spreadsheet (CSV): a row per job, with each step's date. */
export function journeyCsv(list: readonly Journey[]): string {
  const head = [
    'Company',
    'Role',
    'Source',
    ...JOURNEY_STAGES.map((stage) => JOURNEY_STAGE_LABELS[stage]),
    'Outcome',
    'Outcome date',
    'Link',
  ];
  // A step reached on an unknown date still shows as reached.
  const rows = list.map(({ job, dates, outcome, outcomeOn }) => [
    job.company,
    job.role,
    job.source,
    ...JOURNEY_STAGES.map((stage) => {
      const date = dates[stage];
      return date === undefined ? '' : date || 'yes';
    }),
    outcome,
    outcomeOn ?? '',
    job.link ?? '',
  ]);
  // The byte-order mark tells spreadsheet apps the file is UTF-8.
  return `﻿${[head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}
