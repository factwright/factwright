import { localDate } from './dates.ts';
import type { FitTier } from './fit.ts';
import {
  type FitReport,
  jobNotesSentiment,
  parseFitReport,
  parseVerdict,
  type Sentiment,
} from './fit-report.ts';
import { companyKey, roleKey, slug } from './keys.ts';
import { isJobLink, type Link, normalizeUrl } from './links.ts';
import { parsePay } from './pay.ts';
import {
  type FolderRecord,
  type JobDocKind,
  type JobDocs,
  type JobFile,
  type SearchDetail,
  type SearchRecord,
  type Tool,
  type ToolRecord,
  WORKSPACE_PATHS,
} from './records.ts';
import type { Call, JobStage, Note, StatusChange, TrackerFields } from './tracker.ts';

/** A job's pay, and whether the posting listed it or a salary check estimated it. */
export interface JobPay {
  text: string;
  min: number | null;
  max: number | null;
  source: 'listed' | 'estimate';
}

/**
 * What a step in a job's history came from. A job's folder counts once it has a resume, and
 * again once it has a cover letter.
 */
export type EventTool = Exclude<Tool, 'folder'> | 'resume' | 'letter';

/** A dated step in a job's history, such as "Fit check: Strong 82". */
export interface JobEvent {
  id: string;
  tool: EventTool;
  date: string | null;
  title: string;
}

/**
 * One run of a job search, which can find many jobs: its folder under searches/, which names it,
 * where it looked, such as "HN October 2026", and when.
 */
export interface SearchRun {
  folder: string;
  source: string;
  date: string | null;
}

/** A job the app has seen before, so it keeps its ID as new work comes in. */
export interface KnownJob {
  id: string;
  company: string;
  companyKey: string;
  role: string;
  links: Link[];
}

/** Everything the workspace says about one job. */
export interface CollectedJob {
  id: string;
  company: string;
  companyKey: string;
  role: string;
  /** The link that best points at this one job, usually its posting. */
  link: string | null;
  links: Link[];
  location: string | null;
  pay: JobPay | null;
  /** Where the job turned up first, such as "HN October 2026" or "Fit check". */
  source: string;
  fit: { verdict: string | null; score: number | null; date: string | null } | null;
  /** The job search that rated it highest. */
  search: {
    source: string;
    date: string | null;
    tier: FitTier | null;
    score: number | null;
    detail: SearchDetail;
  } | null;
  /** Every job search that found it, oldest first. */
  searches: SearchRun[];
  /**
   * The kind of job its newest fit check judged it as, or else the one the job search that rated
   * it highest gave it, or else the newest search that gave one, by id or name. Null when none
   * said, as with only one kind of job.
   */
  kindFound: string | null;
  /** Its folder under applications/, once a fit check has made one. */
  folder: string | null;
  stage: JobStage;
  firstSeen: string | null;
  lastActivity: string | null;
  /** A line about the job, from the fit check or the job search. */
  summary: string | null;
  events: JobEvent[];
  /** The Markdown files in its folder. */
  docs: JobDocs;
  /** Messages drafted for people at the company, such as "outreach/2026-10-08-acme.md". */
  outreach: string[];
  /** Special steps for applying, from apply.md or the job search's notes. */
  apply: string | null;
  fitReport: FitReport | null;
  sentiment: Sentiment | null;
  /** Its resumes. */
  files: JobFile[];
  /** Its cover letters' files. */
  letters: JobFile[];
}

/** A job as the app shows it: what the workspace says about it, plus what the user tracks. */
export interface Job extends Omit<CollectedJob, 'docs'>, TrackerFields {
  /** Added by hand, rather than found by a skill. */
  manual: boolean;
  calls: Call[];
  statusLog: StatusChange[];
  /** The user's dated notes, oldest first. */
  notes: Note[];
  /** Which Markdown files its folder holds. Their text loads when the job is opened. */
  docKinds: JobDocKind[];
}

/** Which record names a job best, from most to least reliable. */
const PRIORITY: Readonly<Record<Tool, number>> = {
  folder: 0,
  'fit-check': 1,
  unmask: 2,
  salary: 3,
  search: 4,
  outreach: 5,
  prep: 6,
};

/** On the same day, the order the tools usually run in, to tell where a job came from. */
const ORIGIN: readonly Tool[] = [
  'search',
  'unmask',
  'fit-check',
  'salary',
  'folder',
  'outreach',
  'prep',
];

const SOURCES: Readonly<Record<Exclude<Tool, 'search'>, string>> = {
  'fit-check': 'Fit check',
  folder: 'Resume',
  salary: 'Salary check',
  unmask: 'Employer check',
  outreach: 'Outreach',
  prep: 'Interview prep',
};

const TIER_LABELS: Readonly<Record<FitTier, string>> = {
  strong: 'Strong',
  good: 'Good',
  worth: 'Worth a look',
  long: 'Long shot',
  skip: 'Skip',
};

/** Job search notes about applying that are worth an alert: an email, required wording, a warning. */
const SPECIAL_APPLY =
  /@|\bsubject\b|\bphrase\b|\bmention\b|\binclude\b|\basks for\b|cover letter|AI-generated|\bonly\b|\bnot the\b/i;

const FILLER_WORDS = new Set(['and', 'the', 'of', 'for', 'also', 'a']);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byDate = (a: { date: string | null }, b: { date: string | null }) =>
  compare(a.date ?? '', b.date ?? '');
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function roleWords(key: string): Set<string> {
  return new Set(key.split('-').filter((word) => word && !FILLER_WORDS.has(word)));
}

/** How alike two role keys are, from 0 to 1, by the words they share. */
function similarity(a: string, b: string): number {
  const first = roleWords(a);
  const second = roleWords(b);
  const shared = [...first].filter((word) => second.has(word)).length;
  return shared / (new Set([...first, ...second]).size || 1);
}

/** Whether one role key contains the other, word for word. */
const contains = (a: string, b: string) =>
  `-${a}-`.includes(`-${b}-`) || `-${b}-`.includes(`-${a}-`);

interface Draft {
  id: string;
  company: string;
  companyKey: string;
  roleKey: string;
  links: Link[];
  urls: Set<string>;
  records: ToolRecord[];
}

/** Finds the job a record belongs to: by its own link, then by role, within the same company. */
function findDraft(drafts: Draft[], record: ToolRecord, company: string, role: string) {
  const same = drafts.filter((draft) => draft.companyKey === company);
  if (same.length === 0) return null;
  const links = record.links
    .map((link) => link.url)
    .filter(isJobLink)
    .map(normalizeUrl);
  const byLink = same.find((draft) => links.some((url) => draft.urls.has(url)));
  if (byLink) return byLink;
  if (!role) return same.length === 1 ? (same[0] ?? null) : null;
  const exact = same.find((draft) => draft.roleKey === role);
  if (exact) return exact;
  const containing = same.filter((draft) => draft.roleKey && contains(draft.roleKey, role));
  if (containing.length === 1) return containing[0] ?? null;
  const [best, next] = same
    .filter((draft) => draft.roleKey)
    .map((draft) => ({ draft, score: similarity(draft.roleKey, role) }))
    .sort((a, b) => b.score - a.score);
  return best && best.score >= 0.75 && next?.score !== best.score ? best.draft : null;
}

function eventsOf(record: ToolRecord, jobId: string): JobEvent[] {
  if (record.tool !== 'folder') {
    const event = eventOf(record, jobId);
    return event ? [event] : [];
  }
  const events: JobEvent[] = [];
  if (record.files.length > 0) {
    const id = `resume:${record.key}`;
    events.push({ id, tool: 'resume', date: record.date, title: 'Resume built' });
  }
  // A letter usually comes after the resume, so it's dated by its own file, though never before
  // the job's folder was made, as a file the user copied in from elsewhere could be.
  if (record.letters.length > 0) {
    const dates = [firstModified(record.letters), record.date].filter((each) => each !== null);
    const date = dates.sort(compare).at(-1) ?? null;
    events.push({
      id: `letter:${record.key}`,
      tool: 'letter',
      date,
      title: 'Cover letter written',
    });
  }
  return events;
}

/** The day the first of some files was made, on the user's own calendar. */
function firstModified(files: readonly JobFile[]): string | null {
  return [...files].map((file) => localDate(new Date(file.modified))).sort(compare)[0] ?? null;
}

function eventOf(record: ToolRecord, jobId: string): JobEvent | null {
  const id = `${record.tool}:${record.key}`;
  const date = record.date;
  switch (record.tool) {
    case 'fit-check': {
      const result = [record.verdict, record.score].filter((part) => part !== null).join(' ');
      return { id, tool: 'fit-check', date, title: result ? `Fit check: ${result}` : 'Fit check' };
    }
    case 'folder':
      return null;
    case 'prep':
      return { id, tool: 'prep', date, title: 'Interview prep written' };
    case 'search': {
      const tier = record.tier ? `: ${TIER_LABELS[record.tier]}` : '';
      const score = record.score !== null ? ` ${record.score}` : '';
      return { id, tool: 'search', date, title: `Found in ${record.source}${tier}${score}` };
    }
    case 'salary': {
      const confidence = record.confidence ? ` (${record.confidence} confidence)` : '';
      const title = `Salary check: ${record.estimate ?? 'no estimate'}${confidence}`;
      return { id, tool: 'salary', date, title };
    }
    case 'unmask': {
      const listing = record.listing ? ` behind the ${record.listing} listing` : '';
      return { id, tool: 'unmask', date, title: `Found the real employer${listing}` };
    }
    case 'outreach':
      // One file of messages can cover several jobs at the same company.
      return {
        id: `${id}:${jobId}`,
        tool: 'outreach',
        date,
        title: 'Drafted messages to people there',
      };
  }
}

/** Each run of a job search that found a job, once, oldest first. */
function searchRuns(searches: readonly SearchRecord[]): SearchRun[] {
  const runs = new Map<string, SearchRun>();
  for (const { folder, source, date } of searches) {
    if (!runs.has(folder)) runs.set(folder, { folder, source, date });
  }
  return [...runs.values()].sort(
    (a, b) => compare(a.date ?? '', b.date ?? '') || compare(a.folder, b.folder),
  );
}

/** The job search's note about applying, in the same shape as an apply.md, when it's unusual. */
function searchApplySteps(searches: readonly SearchRecord[]): string | null {
  const search = [...searches]
    .reverse()
    .find((record) => SPECIAL_APPLY.test(record.detail.apply ?? ''));
  const note = search?.detail.apply?.trim();
  if (!search || !note) return null;
  const email = note.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0];
  const subject = note.match(/subject\s*[:,]?\s*["“]([^"”]+)["”]/i)?.[1];
  return [
    `- **Alert:** ${capitalize(note)}`,
    ...(email ? [`- **Email:** ${email}`] : []),
    ...(subject ? [`- **Subject:** ${subject}`] : []),
    '',
    `From the job search (${search.source}).`,
  ].join('\n');
}

function build(draft: Draft): CollectedJob {
  const { records } = draft;
  const fits = records.filter((record) => record.tool === 'fit-check');
  const folders = records.filter((record): record is FolderRecord => record.tool === 'folder');
  const searches = records.filter((record): record is SearchRecord => record.tool === 'search');
  const salaries = records.filter((record) => record.tool === 'salary');
  const outreach = records.filter((record) => record.tool === 'outreach');
  const folder = folders.at(-1);
  const fit = fits.at(-1);
  const bestSearch = [...searches].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];

  const byPriority = [...records].sort(
    (a, b) => PRIORITY[a.tool] - PRIORITY[b.tool] || compare(b.date ?? '', a.date ?? ''),
  );
  const named = byPriority.find((record) => record.role) ?? byPriority[0];

  const fallbackFit = !fit && folder ? parseVerdict(folder.fit) : null;
  // The folder's pay first, then the newest fit check's, then the job searches'.
  const listedPay = [
    folder?.pay,
    ...fits.map((record) => record.pay).reverse(),
    ...searches.map((record) => record.pay),
  ].filter((pay): pay is string => Boolean(pay));
  const listed = listedPay.find((pay) => parsePay(pay)) ?? listedPay[0] ?? null;
  const estimate = salaries.at(-1)?.estimate ?? null;
  const payText = listed ?? estimate;
  const payRange = parsePay(payText);

  const links = [...draft.links].sort(
    (a, b) => Number(isJobLink(b.url)) - Number(isJobLink(a.url)),
  );
  const primary =
    links.find(
      (link) =>
        /posting|apply|linkedin|ashby|greenhouse|lever/i.test(link.label) && isJobLink(link.url),
    ) ??
    links.find((link) => isJobLink(link.url)) ??
    links.find((link) => link.label === 'Posting') ??
    links[0];

  const dates = records.flatMap((record) => (record.date ? [record.date] : [])).sort(compare);
  const files = folders.flatMap((record) => record.files);
  const letters = folders.flatMap((record) => record.letters);
  const onlyOutreach = outreach.length === records.length;
  // Claude's work takes a job out of New: anything but finding it, or messages drafted for its
  // company, which join every job there, even one found long after.
  const worked = records.some((record) => record.tool !== 'search' && record.tool !== 'outreach');
  const stage: JobStage = worked || onlyOutreach ? 'review' : 'new';
  const first = [...records].sort(
    (a, b) => byDate(a, b) || ORIGIN.indexOf(a.tool) - ORIGIN.indexOf(b.tool),
  )[0];
  const source = !first ? '' : first.tool === 'search' ? first.source : SOURCES[first.tool];

  // A fit check judges the one job, so its kind wins over a search's.
  const kindFound =
    [...folders].reverse().find((record) => record.kind)?.kind ??
    [bestSearch, ...[...searches].reverse()].find((record) => record?.kind)?.kind ??
    null;

  const docs = folder?.docs ?? {};
  const fitReport = parseFitReport(docs.fit);
  const sentiment = fitReport?.sentiment ?? jobNotesSentiment(docs.job);
  if (sentiment && !sentiment.date) sentiment.date = folder?.date ?? null;

  return {
    id: draft.id,
    company: named?.company ?? draft.company,
    companyKey: draft.companyKey,
    role: named?.role ?? '',
    link: primary?.url ?? null,
    links,
    location: folder?.location ?? bestSearch?.location ?? null,
    pay: payText
      ? {
          text: payText,
          min: payRange?.min ?? null,
          max: payRange?.max ?? null,
          source: listed ? 'listed' : 'estimate',
        }
      : null,
    source,
    fit: fit
      ? { verdict: fit.verdict, score: fit.score, date: fit.date }
      : fallbackFit
        ? { verdict: fallbackFit.verdict, score: fallbackFit.score, date: folder?.date ?? null }
        : null,
    search: bestSearch
      ? {
          source: bestSearch.source,
          date: bestSearch.date,
          tier: bestSearch.tier,
          score: bestSearch.score,
          detail: bestSearch.detail,
        }
      : null,
    searches: searchRuns(searches),
    kindFound,
    folder: folder?.folder ?? null,
    stage,
    firstSeen: dates[0] ?? null,
    lastActivity: dates.at(-1) ?? null,
    summary: fit?.note ?? bestSearch?.detail.pick ?? bestSearch?.detail.note ?? null,
    events: records.flatMap((record) => eventsOf(record, draft.id)),
    docs,
    outreach: outreach.map((record) => `${WORKSPACE_PATHS.outreach}/${record.key}`),
    apply: docs.apply ?? searchApplySteps(searches),
    fitReport,
    sentiment,
    files,
    letters,
  };
}

/**
 * Folds the skills' records into one job each. A record joins a job at the same company when
 * it shares the job's own link, or names the same role. Jobs the app already knows keep their
 * IDs, and new ones get an ID from the company and role, such as "acme--staff-engineer".
 * Returns only jobs that have records.
 */
export function collectJobs(
  records: readonly ToolRecord[],
  known: readonly KnownJob[] = [],
): CollectedJob[] {
  const drafts: Draft[] = known.map((job) => ({
    id: job.id,
    company: job.company,
    companyKey: job.companyKey || companyKey(job.company),
    roleKey: roleKey(job.role),
    links: [...job.links],
    urls: new Set(job.links.map((link) => normalizeUrl(link.url))),
    records: [],
  }));
  const ids = new Set(drafts.map((draft) => draft.id));

  const add = (draft: Draft, record: ToolRecord) => {
    for (const link of record.links) {
      const url = normalizeUrl(link.url);
      if (draft.urls.has(url)) continue;
      draft.urls.add(url);
      draft.links.push(link);
    }
    draft.records.push(record);
  };
  const create = (company: string, key: string, role: string) => {
    const base = `${key || slug(company) || 'unknown'}--${role || 'general'}`;
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    const draft: Draft = {
      id,
      company,
      companyKey: key,
      roleKey: role,
      links: [],
      urls: new Set(),
      records: [],
    };
    drafts.push(draft);
    return draft;
  };

  const ordered = [...records].sort((a, b) => byDate(a, b) || PRIORITY[a.tool] - PRIORITY[b.tool]);
  for (const record of ordered) {
    if (record.tool === 'outreach') continue;
    const company = companyKey(record.company);
    const role = roleKey(record.role);
    add(findDraft(drafts, record, company, role) ?? create(record.company, company, role), record);
  }
  // Messages are about a company, so they join every job there.
  for (const record of ordered) {
    if (record.tool !== 'outreach') continue;
    const company = companyKey(record.companySlug);
    const targets = drafts.filter((draft) => draft.companyKey === company);
    for (const draft of targets.length > 0 ? targets : [create(record.company, company, '')]) {
      add(draft, record);
    }
  }
  return drafts.filter((draft) => draft.records.length > 0).map(build);
}
