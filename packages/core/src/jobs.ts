import { localDate } from './dates.ts';
import type { CallDoc } from './extras.ts';
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
import {
  type CompanyName,
  companyMatch,
  isTitled,
  otherPostings,
  postingKey,
  readTitle,
  type TitleWords,
  titleFit,
  titlesFit,
} from './matching.ts';
import { idPart, JOB_LIMITS, shortCode } from './new-job.ts';
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
export type EventTool = Exclude<Tool, 'folder'> | 'resume' | 'letter' | 'projects';

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
  /**
   * For a job the user merged into another, that job's ID: what it was known by now names the
   * other, so work that would have joined it joins that one.
   */
  mergedInto?: string | null;
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
  /** The newest job search that found it, with what it said. */
  search: {
    source: string;
    date: string | null;
    tier: FitTier | null;
    score: number | null;
    detail: SearchDetail;
    /**
     * Whether the job was on file before this search found it: found by an earlier search, or
     * known from other work, such as a fit check, or added by hand.
     */
    again: boolean;
  } | null;
  /** Every job search that found it, oldest first. */
  searches: SearchRun[];
  /**
   * The kind of job its newest fit check judged it as, or else the one the job search that rated
   * it highest gave it, or else the newest search that gave one, by id or name. Null when none
   * said, as with only one kind of job.
   */
  kindFound: string | null;
  /**
   * The pay to ask for there, as your Claude suggested it in the job's job.md, such as "$185,000".
   * The user's own ask, which the tracker keeps, wins over it.
   */
  suggestedAsk: string | null;
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
  /** Its Projects pages' files. */
  projectPages: JobFile[];
}

/** A job as the app shows it: what the workspace says about it, plus what the user tracks. */
export interface Job extends Omit<CollectedJob, 'docs'>, TrackerFields {
  /** Added by hand, rather than found by a skill. */
  manual: boolean;
  calls: Call[];
  /** Claude's prep sheets and thank-you notes for its calls. Their text loads when it's opened. */
  callDocs: CallDoc[];
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

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byDate = (a: { date: string | null }, b: { date: string | null }) =>
  compare(a.date ?? '', b.date ?? '');
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One job as its records come in: every way it goes by, and the records it has so far. */
interface Draft {
  id: string;
  company: string;
  companyKey: string;
  /** Every company it goes by: the tracker's, each of its records', and each job merged into it. */
  names: CompanyName[];
  /** Every title it goes by, read for matching. */
  titles: TitleWords[];
  links: Link[];
  /** Each of its links, written one way, to keep each once and to match by. */
  urls: Set<string>;
  /** The postings its links are to, by their keys, such as "greenhouse:4567890". */
  postings: Set<string>;
  records: ToolRecord[];
}

/** What a record says about the job it's from, to tell which job that is. */
interface Clues {
  name: CompanyName;
  title: TitleWords;
  /** Its links that name one job, written one way. */
  urls: string[];
  /** The postings its links are to, by their keys. */
  postings: string[];
}

function cluesOf(record: ToolRecord): Clues {
  return {
    name: { company: record.company, companyKey: companyKey(record.company) },
    title: readTitle(record.role),
    urls: record.links
      .map((link) => link.url)
      .filter(isJobLink)
      .map(normalizeUrl),
    postings: record.links.flatMap((link) => postingKey(link.url) ?? []),
  };
}

function draftOf(job: { id: string; company: string; companyKey: string }): Draft {
  return {
    id: job.id,
    company: job.company,
    companyKey: job.companyKey,
    names: [],
    titles: [],
    links: [],
    urls: new Set(),
    postings: new Set(),
    records: [],
  };
}

const same = (a: CompanyName, b: CompanyName) => companyMatch(a, b) === 'same';

/** Adds a company, a title and links to what a job goes by, each once. */
function learn(draft: Draft, name: CompanyName, role: string, links: readonly Link[]): void {
  if ((name.company || name.companyKey) && !draft.names.some((each) => same(each, name))) {
    draft.names.push(name);
  }
  const title = readTitle(role);
  if (isTitled(title) && !draft.titles.some((each) => titleFit(each, title) === 'same')) {
    draft.titles.push(title);
  }
  for (const link of links) {
    const posting = postingKey(link.url);
    if (posting) draft.postings.add(posting);
    const url = normalizeUrl(link.url);
    if (draft.urls.has(url)) continue;
    draft.urls.add(url);
    draft.links.push(link);
  }
}

/** How a company compares with every company a job goes by: the same, related or different. */
function companyOf(draft: Draft, name: CompanyName): 'same' | 'related' | 'different' {
  const matches = draft.names.map((each) => companyMatch(each, name));
  return matches.includes('same') ? 'same' : matches.includes('related') ? 'related' : 'different';
}

/**
 * Finds the job a record belongs to:
 * 1. the job a job search said it is, by its ID from find_job, when that job is at the same
 *    company, or one whose name holds the other's, or shares a link with it;
 * 2. the job with the same link, or a link to the same posting, at any company, since "Acme" and
 *    "Acme Robotics" can both list it;
 * 3. the job with the same role at the same company, however it's written ("Sr." is "Senior"),
 *    or else the one job there whose title says more or less about the same work ("Staff
 *    Engineer" and "Staff Software Engineer"), or else the one job with the same role at a
 *    company whose name holds the other's.
 *
 * A job never takes a record by its role alone when they have different postings on the same
 * site, or a different level ("Software Engineer" and "Senior Software Engineer"), or different
 * specialties ("(Backend)" and "(Frontend)").
 */
function findDraft(
  drafts: readonly Draft[],
  byId: ReadonlyMap<string, Draft>,
  record: ToolRecord,
  clues: Clues,
): Draft | null {
  const shares = (draft: Draft) =>
    clues.urls.some((url) => draft.urls.has(url)) ||
    clues.postings.some((key) => draft.postings.has(key));
  const named = record.tool === 'search' && record.job ? byId.get(record.job) : undefined;
  if (named && (shares(named) || companyOf(named, clues.name) !== 'different')) return named;
  const byLink = drafts.find(shares);
  if (byLink) return byLink;
  const there = drafts.filter((draft) => companyOf(draft, clues.name) === 'same');
  if (!isTitled(clues.title)) return there.length === 1 ? (there[0] ?? null) : null;
  const fits = (draft: Draft) => !otherPostings(draft.postings, clues.postings);
  const usable = there.filter(fits);
  const exact = usable.find((draft) => titlesFit(draft.titles, clues.title) === 'same');
  if (exact) return exact;
  const more = usable.filter((draft) => titlesFit(draft.titles, clues.title) === 'more');
  if (more.length === 1) return more[0] ?? null;
  const related = drafts.filter(
    (draft) =>
      companyOf(draft, clues.name) === 'related' &&
      fits(draft) &&
      titlesFit(draft.titles, clues.title) === 'same',
  );
  return related.length === 1 ? (related[0] ?? null) : null;
}

/**
 * Where each job the user merged into another went: that job's ID, following merges of merges,
 * or null when that job is gone, so the merged one stands on its own again.
 */
export function mergedTargets(
  jobs: readonly { id: string; mergedInto?: string | null }[],
): Map<string, string | null> {
  const into = new Map(jobs.flatMap((job) => (job.mergedInto ? [[job.id, job.mergedInto]] : [])));
  const ids = new Set(jobs.map((job) => job.id));
  const targets = new Map<string, string | null>();
  for (const id of into.keys()) {
    let at = id;
    const seen = new Set<string>();
    while (into.has(at) && !seen.has(at)) {
      seen.add(at);
      at = into.get(at) as string;
    }
    targets.set(id, into.has(at) || !ids.has(at) ? null : at);
  }
  return targets;
}

/**
 * Whether a job was on file before a search found it: from an earlier run of a search, or from
 * earlier work on it, such as a fit check. Drafted messages join every job at a company, so they
 * don't count.
 */
function foundBefore(records: readonly ToolRecord[], search: SearchRecord): boolean {
  return records.some(
    (other) =>
      other !== search &&
      other.tool !== 'outreach' &&
      (byDate(other, search) < 0 ||
        (other.tool === 'search' && byDate(other, search) === 0 && byRun(other, search) < 0)),
  );
}

/** Job searches' records oldest first: by date, then by folder, then by run within a folder. */
const byRun = (a: SearchRecord, b: SearchRecord) =>
  byDate(a, b) || compare(a.folder, b.folder) || a.run - b.run;

/** A record's steps in a job's history. A search that found a job on file says it found it again. */
function eventsOf(record: ToolRecord, jobId: string, again: boolean): JobEvent[] {
  if (record.tool !== 'folder') {
    const event = eventOf(record, jobId, again);
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
  // A Projects page is dated by its own file too, as a letter is.
  if (record.projectPages.length > 0) {
    const dates = [firstModified(record.projectPages), record.date].filter((each) => each !== null);
    events.push({
      id: `projects:${record.key}`,
      tool: 'projects',
      date: dates.sort(compare).at(-1) ?? null,
      title: 'Projects page made',
    });
  }
  return events;
}

/** The day the first of some files was made, on the user's own calendar. */
function firstModified(files: readonly JobFile[]): string | null {
  return [...files].map((file) => localDate(new Date(file.modified))).sort(compare)[0] ?? null;
}

function eventOf(record: ToolRecord, jobId: string, again: boolean): JobEvent | null {
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
      const found = again ? 'Found again in' : 'Found in';
      return { id, tool: 'search', date, title: `${found} ${record.source}${tier}${score}` };
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
  const searches = records
    .filter((record): record is SearchRecord => record.tool === 'search')
    .sort(byRun);
  const salaries = records.filter((record) => record.tool === 'salary');
  const outreach = records.filter((record) => record.tool === 'outreach');
  const folder = folders.at(-1);
  const fit = fits.at(-1);
  // The newest search says what's true of the job now: its pay, whether it's still open, how
  // well it fits the facts as they are.
  const latest = searches.at(-1);
  const newestFirst = [...searches].reverse();

  const byPriority = [...records].sort(
    (a, b) => PRIORITY[a.tool] - PRIORITY[b.tool] || compare(b.date ?? '', a.date ?? ''),
  );
  const named = byPriority.find((record) => record.role) ?? byPriority[0];

  const fallbackFit = !fit && folder ? parseVerdict(folder.fit) : null;
  // The folder's pay first, then the newest fit check's, then the newest job search's.
  const listedPay = [
    folder?.pay,
    ...fits.map((record) => record.pay).reverse(),
    ...newestFirst.map((record) => record.pay),
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
  const projectPages = folders.flatMap((record) => record.projectPages);
  const onlyOutreach = outreach.length === records.length;
  // Claude's work takes a job out of New: anything but finding it, or messages drafted for its
  // company, which join every job there, even one found long after.
  const worked = records.some((record) => record.tool !== 'search' && record.tool !== 'outreach');
  const stage: JobStage = worked || onlyOutreach ? 'review' : 'new';
  const first = [...records].sort(
    (a, b) => byDate(a, b) || ORIGIN.indexOf(a.tool) - ORIGIN.indexOf(b.tool),
  )[0];
  const source = !first ? '' : first.tool === 'search' ? first.source : SOURCES[first.tool];

  // The newest folder's job.md that suggests one, as long as a pay the user types can be.
  const suggestion = [...folders].reverse().find((record) => record.ask)?.ask ?? null;
  const suggestedAsk = suggestion && suggestion.length <= JOB_LIMITS.pay ? suggestion : null;
  // A fit check judges the one job, so its kind wins over a search's.
  const kindFound =
    [...folders].reverse().find((record) => record.kind)?.kind ??
    newestFirst.find((record) => record.kind)?.kind ??
    null;

  const docs = folder?.docs ?? {};
  const fitReport = parseFitReport(docs.fit);
  const sentiment = fitReport?.sentiment ?? jobNotesSentiment(docs.job);
  if (sentiment && !sentiment.date) sentiment.date = folder?.date ?? null;

  const company = named?.company ?? draft.company;
  return {
    id: draft.id,
    company,
    // Its key follows the name it goes by, as the tracker keeps it.
    companyKey: companyKey(company) || draft.companyKey,
    role: named?.role ?? '',
    link: primary?.url ?? null,
    links,
    location: folder?.location ?? latest?.location ?? null,
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
    search: latest
      ? {
          source: latest.source,
          date: latest.date,
          tier: latest.tier,
          score: latest.score,
          detail: latest.detail,
          again: foundBefore(records, latest),
        }
      : null,
    searches: searchRuns(searches),
    kindFound,
    suggestedAsk,
    folder: folder?.folder ?? null,
    stage,
    firstSeen: dates[0] ?? null,
    lastActivity: dates.at(-1) ?? null,
    summary: fit?.note ?? latest?.detail.pick ?? latest?.detail.note ?? null,
    events: records.flatMap((record) =>
      eventsOf(record, draft.id, record.tool === 'search' && foundBefore(records, record)),
    ),
    docs,
    outreach: outreach.map((record) => `${WORKSPACE_PATHS.outreach}/${record.key}`),
    apply: docs.apply ?? searchApplySteps(searches),
    fitReport,
    sentiment,
    files,
    letters,
    projectPages,
  };
}

/**
 * Folds the skills' records into one job each. A record joins the job a job search said it is,
 * or the job with the same posting, at any company, or the job with the same role at the same
 * company, as findDraft tells. Jobs the app already knows keep their IDs, and new ones get an ID
 * from the company and role, such as "acme--staff-engineer". A job the user merged into another
 * passes what it went by on to that one. Returns only jobs that have records.
 */
export function collectJobs(
  records: readonly ToolRecord[],
  known: readonly KnownJob[] = [],
): CollectedJob[] {
  const drafts: Draft[] = [];
  const byId = new Map<string, Draft>();
  const ids = new Set(known.map((job) => job.id));
  const targets = mergedTargets(known);
  const start = (job: KnownJob) => {
    const draft = draftOf({ ...job, companyKey: job.companyKey || companyKey(job.company) });
    drafts.push(draft);
    return draft;
  };
  for (const job of known) {
    if (targets.get(job.id)) continue;
    byId.set(job.id, start(job));
  }
  for (const job of known) {
    const name = { company: job.company, companyKey: job.companyKey || companyKey(job.company) };
    const draft = byId.get(targets.get(job.id) ?? job.id) ?? start(job);
    byId.set(job.id, draft);
    learn(draft, name, job.role, job.links);
  }

  const add = (draft: Draft, record: ToolRecord, clues: Clues) => {
    learn(draft, clues.name, record.role, record.links);
    draft.records.push(record);
  };
  const create = (record: ToolRecord, key: string, link?: string) => {
    // Made as Add job and the extension make them, so the ID fits a folder's name and both
    // find the job: a company with no Latin letters by the job's link.
    const named = idPart(key || slug(record.company), 'company');
    const code = link ? `job-${shortCode(normalizeUrl(link))}` : 'unknown';
    const base = `${named || code}--${idPart(roleKey(record.role), 'role') || 'general'}`;
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    const draft = draftOf({ id, company: record.company, companyKey: key });
    drafts.push(draft);
    byId.set(id, draft);
    return draft;
  };

  const ordered = [...records].sort((a, b) => byDate(a, b) || PRIORITY[a.tool] - PRIORITY[b.tool]);
  for (const record of ordered) {
    if (record.tool === 'outreach') continue;
    const clues = cluesOf(record);
    const link = record.links.map((each) => each.url).find(isJobLink);
    const draft =
      findDraft(drafts, byId, record, clues) ?? create(record, clues.name.companyKey, link);
    add(draft, record, clues);
  }
  // Messages are about a company, so they join every job there.
  for (const record of ordered) {
    if (record.tool !== 'outreach') continue;
    const name = { company: record.company, companyKey: companyKey(record.companySlug) };
    const clues = { ...cluesOf(record), name };
    const there = drafts.filter((draft) => draft.names.some((each) => same(each, name)));
    for (const draft of there.length > 0 ? there : [create(record, name.companyKey)]) {
      add(draft, record, clues);
    }
  }
  return drafts.filter((draft) => draft.records.length > 0).map(build);
}
