import { firstDate } from './dates.ts';
import type { FitTier } from './fit.ts';
import { SCORE_PARTS, type ScorePartKey } from './fit-report.ts';
import { FOCUS_ID, focusFile, focusName, focusOf } from './focus.ts';
import { companyKey, roleKey } from './keys.ts';
import { isCoverLetterFile, isProjectsPageFile } from './letter.ts';
import { type Link, linksFrom } from './links.ts';
import { markdownTable } from './markdown.ts';

/** One entry in a workspace folder. */
export interface WorkspaceEntry {
  name: string;
  folder: boolean;
  /** For a file, its size in bytes. */
  size: number;
  /** For a file, when it last changed, as an ISO time. */
  modified: string;
}

/**
 * Read-only access to the user's workspace. Paths are relative to the workspace and use "/".
 * The desktop app reads the folder on disk, and tests use a few files in memory.
 */
export interface WorkspaceReader {
  /** A text file's contents, or null when there's no such file. */
  readText(path: string): string | null;
  /** What's in a folder, or nothing when there's no such folder. */
  list(path: string): WorkspaceEntry[];
}

/** Where the skills save their work, relative to the workspace. */
export const WORKSPACE_PATHS = {
  /** One folder per job, from its first fit check on. */
  jobs: 'applications',
  /** One folder per job search, holding its jobs.json. */
  searches: 'searches',
  fitChecks: 'searches/fit-checks.md',
  salaryChecks: 'searches/salary-checks.md',
  unmaskChecks: 'searches/unmask-checks.md',
  /** Messages drafted for people at a company, one file each. Only their names are read. */
  outreach: 'outreach',
} as const;

/** The text files a job's folder can hold, by kind: its Markdown, and the cover letter's data. */
export const JOB_DOCS = {
  posting: 'posting.md',
  job: 'job.md',
  fit: 'fit-check.md',
  unmask: 'unmask.md',
  notes: 'notes.md',
  answers: 'answers.md',
  prep: 'prep.md',
  apply: 'apply.md',
  letter: 'cover-letter.json',
  projects: 'projects-page.json',
} as const;

export type JobDocKind = keyof typeof JOB_DOCS;

export type JobDocs = Partial<Record<JobDocKind, string>>;

/** A resume or a cover letter in a job's folder. */
export interface JobFile {
  /** Where it is in the workspace, such as "applications/acme-staff-engineer/resume.pdf". */
  path: string;
  name: string;
  format: 'pdf' | 'docx';
  size: number;
  modified: string;
}

/** What a job search noted about a job. */
export interface SearchDetail {
  why: string[];
  gaps: string[];
  flags: string[];
  pick: string | null;
  what: string | null;
  stage: string | null;
  apply: string | null;
  note: string | null;
  parts: Partial<Record<ScorePartKey, number>>;
  partsWhy: Partial<Record<ScorePartKey, string>>;
  tags: string[];
  report: string | null;
}

interface RecordBase {
  /** Unique among one tool's records. */
  key: string;
  date: string | null;
  company: string;
  role: string;
  links: Link[];
}

export interface FitCheckRecord extends RecordBase {
  tool: 'fit-check';
  verdict: string | null;
  score: number | null;
  pay: string | null;
  note: string | null;
}

/** A job's folder, and what its job.md says. */
export interface FolderRecord extends RecordBase {
  tool: 'folder';
  folder: string;
  pay: string | null;
  location: string | null;
  /** The fit check's verdict as job.md gives it, such as "Strong, 82". */
  fit: string | null;
  foundVia: string | null;
  format: string | null;
  style: string | null;
  /** The kind of job its fit check judged it as, by id or name, such as "project-manager". */
  kind: string | null;
  /** Its resumes. */
  files: JobFile[];
  /** Its cover letters' files. */
  letters: JobFile[];
  /** Its Projects pages' files. */
  projectPages: JobFile[];
  docs: JobDocs;
}

export interface PrepRecord extends RecordBase {
  tool: 'prep';
}

export interface SearchRecord extends RecordBase {
  tool: 'search';
  /** Where the search looked, such as "HN October 2026". */
  source: string;
  folder: string;
  /**
   * Which run of the search found it, in its folder: 1 for jobs.json, and 2 for jobs-2.json, the
   * next run of the same place on the same day, or in HN's same month.
   */
  run: number;
  /** The job it is, by the ID find_job gave for it, when the user had seen it before. */
  job: string | null;
  pay: string | null;
  location: string | null;
  tier: FitTier | null;
  score: number | null;
  /** The kind of job it was scored as: its own, or the whole search's. */
  kind: string | null;
  detail: SearchDetail;
}

export interface SalaryRecord extends RecordBase {
  tool: 'salary';
  estimate: string | null;
  confidence: string | null;
}

/** A listing whose real employer was found behind a recruiter or job board. */
export interface UnmaskRecord extends RecordBase {
  tool: 'unmask';
  listing: string | null;
  apply: string | null;
}

export interface OutreachRecord extends RecordBase {
  tool: 'outreach';
  companySlug: string;
}

/** One thing a skill did, read from the workspace. Jobs are built from these. */
export type ToolRecord =
  | FitCheckRecord
  | FolderRecord
  | PrepRecord
  | SearchRecord
  | SalaryRecord
  | UnmaskRecord
  | OutreachRecord;

export type Tool = ToolRecord['tool'];

/**
 * A run's jobs in a search's folder: jobs.json for its first run, and jobs-2.json, jobs-3.json
 * and on for the runs after, so a run never writes over an earlier one's jobs.
 */
const RUN_FILE = /^jobs(?:-([1-9]\d{0,2}))?\.json$/;

/** A job's ID, as the app makes them. */
const JOB_ID = /^[a-z0-9][a-z0-9-]{0,199}$/;

/** Job search tiers as jobs.json writes them. A Map, because the names come from a file. */
const SEARCH_TIERS: ReadonlyMap<string, FitTier> = new Map([
  ['strong', 'strong'],
  ['good', 'good'],
  ['look', 'worth'],
  ['worth', 'worth'],
  ['long-shot', 'long'],
]);

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A table cell's text, or null when it's empty or a dash. */
const cell = (value: string | undefined) =>
  value?.trim() && !/^[-—–]$/.test(value.trim()) ? value.trim() : null;

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function texts(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function partsOf<T>(value: unknown, read: (item: unknown) => T | null) {
  const parts: Partial<Record<ScorePartKey, T>> = {};
  if (!value || typeof value !== 'object') return parts;
  for (const key of SCORE_PARTS) {
    const part = read((value as Record<string, unknown>)[key]);
    if (part !== null) parts[key] = part;
  }
  return parts;
}

/** The objects in a JSON list, skipping anything else. */
function objects(list: unknown): Record<string, unknown>[] {
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> =>
    Boolean(item && typeof item === 'object'),
  );
}

/** Folder names sorted the same way everywhere, so every computer builds the same jobs. */
const byName = (a: WorkspaceEntry, b: WorkspaceEntry) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** A company name from a file name: "acme-robotics" is "Acme Robotics", and "ibm" is "IBM". */
const companyFromSlug = (slug: string) =>
  /^[a-z0-9]{2,4}$/.test(slug) ? slug.toUpperCase() : slug.split('-').map(capitalize).join(' ');

/** The heading and "- **Field:** value" lines at the top of a job's job.md. */
function readJobNotes(markdown: string) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
  const split = [': ', ' — ', ' – ', ' - ']
    .map((separator) => ({ separator, at: heading.indexOf(separator) }))
    .filter(({ at }) => at > 0)
    .sort((a, b) => a.at - b.at)[0];
  const company = split ? heading.slice(0, split.at) : heading;
  const role = split ? heading.slice(split.at + split.separator.length) : '';
  const field = (name: string) =>
    markdown.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.+)$`, 'mi'))?.[1]?.trim() ?? null;
  return {
    company: company.trim(),
    role: role.replace(/\.\s.*$/, '').trim(),
    date: field('Date'),
    pay: field('Pay'),
    links: [
      ...linksFrom(field('Apply'), 'Posting'),
      ...linksFrom(field('Links')),
      ...linksFrom(field('Company site'), 'Company site'),
    ],
    location: field('Work arrangement'),
    fit: field('Fit check'),
    foundVia: field('Found via'),
    format: field('Format'),
    style: field('Style / track') ?? field('Style'),
    kind: field('Kind of job'),
  };
}

/** The rows of one of the workspace's log tables, with a date and a company each. */
function logRows(workspace: WorkspaceReader, path: string, companyColumn: string) {
  return markdownTable(workspace.readText(path)).flatMap((row) => {
    const date = firstDate(row.date);
    const company = cell(row[companyColumn]);
    if (!date || !company) return [];
    const role = row.role ?? '';
    const key = `${date}:${companyKey(company)}:${roleKey(role)}`;
    return [{ row, key, date, company, role, links: linksFrom(row.link, 'Posting') }];
  });
}

function fitCheckRecords(workspace: WorkspaceReader): FitCheckRecord[] {
  return logRows(workspace, WORKSPACE_PATHS.fitChecks, 'company').map(({ row, ...base }) => {
    const score = Number.parseInt(row.score ?? '', 10);
    return {
      tool: 'fit-check',
      ...base,
      verdict: cell(row.verdict),
      score: Number.isNaN(score) ? null : score,
      pay: cell(row.pay),
      note: cell(row.note),
    };
  });
}

function salaryRecords(workspace: WorkspaceReader): SalaryRecord[] {
  return logRows(workspace, WORKSPACE_PATHS.salaryChecks, 'company').map(({ row, ...base }) => ({
    tool: 'salary',
    ...base,
    estimate: cell(row.estimate),
    confidence: cell(row.confidence),
  }));
}

function unmaskRecords(workspace: WorkspaceReader): UnmaskRecord[] {
  return logRows(workspace, WORKSPACE_PATHS.unmaskChecks, 'employer').map(({ row, ...base }) => ({
    tool: 'unmask',
    ...base,
    listing: cell(row.listing),
    apply: cell(row.apply),
  }));
}

/**
 * A job's folder's resumes, cover letters and Projects pages, by name: each PDF and Word file in
 * it. The app lists them from the folder on disk, and the extension from what sync holds.
 */
export function folderFiles(
  workspace: WorkspaceReader,
  folder: string,
): Pick<FolderRecord, 'files' | 'letters' | 'projectPages'> {
  const path = `${WORKSPACE_PATHS.jobs}/${folder}`;
  const built: JobFile[] = workspace
    .list(path)
    .sort(byName)
    .flatMap((file) => {
      const format = file.name.match(/\.(pdf|docx)$/i)?.[1]?.toLowerCase();
      if (file.folder || (format !== 'pdf' && format !== 'docx')) return [];
      const { name, size, modified } = file;
      return [{ path: `${path}/${name}`, name, format, size, modified }];
    });
  const letters = built.filter((file) => isCoverLetterFile(file.name));
  const projectPages = built.filter((file) => isProjectsPageFile(file.name));
  const files = built.filter((file) => !letters.includes(file) && !projectPages.includes(file));
  return { files, letters, projectPages };
}

function folderRecords(workspace: WorkspaceReader): ToolRecord[] {
  const records: ToolRecord[] = [];
  for (const entry of workspace.list(WORKSPACE_PATHS.jobs).sort(byName)) {
    if (!entry.folder) continue;
    const folder = entry.name;
    const path = `${WORKSPACE_PATHS.jobs}/${folder}`;
    const jobNotes = workspace.readText(`${path}/${JOB_DOCS.job}`);
    if (!jobNotes) continue;
    const notes = readJobNotes(jobNotes);
    const docs: JobDocs = {};
    for (const [kind, file] of Object.entries(JOB_DOCS) as [JobDocKind, string][]) {
      const content = workspace.readText(`${path}/${file}`);
      if (content) docs[kind] = content;
    }
    const { files, letters, projectPages } = folderFiles(workspace, folder);
    const date = firstDate(notes.date) ?? firstDate(folder);
    records.push({
      tool: 'folder',
      key: folder,
      folder,
      date,
      company: notes.company,
      role: notes.role,
      links: notes.links,
      pay: notes.pay,
      location: notes.location,
      fit: notes.fit,
      foundVia: notes.foundVia,
      format: notes.format,
      style: notes.style,
      kind: notes.kind,
      files,
      letters,
      projectPages,
      docs,
    });
    if (docs.prep) {
      const prepDate = firstDate(docs.prep.match(/^- \*\*Date:\*\*\s*(.+)$/im)?.[1]);
      records.push({
        tool: 'prep',
        key: folder,
        date: prepDate ?? date,
        company: notes.company,
        role: notes.role,
        links: [],
      });
    }
  }
  return records;
}

/**
 * Where a search looked, in a few words: "Hacker News · Who is hiring? (October 2026)" is
 * "HN October 2026".
 */
function searchSource(source: string): string {
  const short = source.replace(/^Hacker News · /, 'HN ');
  const month = short.match(/^HN\b.*\bwho is hiring\??\s*\(([a-z]+ \d{4})\)$/i)?.[1];
  return month ? `HN ${month}` : short;
}

/**
 * A search's name with its focus, when the user gave the search one: "LinkedIn Oct 20 · early
 * startups, $150k–$200k". The app names it from the focus it kept, by its ID, unless the search
 * named it so itself.
 */
function withFocus(workspace: WorkspaceReader, source: string, id: string | null): string {
  if (!id || !FOCUS_ID.test(id)) return source;
  const focus = focusOf(workspace.readText(focusFile(id)));
  const name = focus && focusName(focus);
  return name && !source.includes(name) ? `${source} · ${name}` : source;
}

/** Each run's file of jobs in a search's folder, first run first. */
function runFiles(workspace: WorkspaceReader, folder: string): { name: string; run: number }[] {
  return workspace
    .list(`${WORKSPACE_PATHS.searches}/${folder}`)
    .flatMap((entry) => {
      const match = entry.folder ? null : entry.name.match(RUN_FILE);
      return match ? [{ name: entry.name, run: match[1] ? Number(match[1]) : 1 }] : [];
    })
    .sort((a, b) => a.run - b.run);
}

function searchRecords(workspace: WorkspaceReader): ToolRecord[] {
  const records: ToolRecord[] = [];
  for (const entry of workspace.list(WORKSPACE_PATHS.searches).sort(byName)) {
    if (!entry.folder) continue;
    const folder = entry.name;
    for (const { name, run } of runFiles(workspace, folder)) {
      records.push(...runRecords(workspace, folder, name, run));
    }
  }
  return records;
}

/** The jobs one run of a search found, from its file. */
function runRecords(
  workspace: WorkspaceReader,
  folder: string,
  file: string,
  run: number,
): SearchRecord[] {
  const raw = workspace.readText(`${WORKSPACE_PATHS.searches}/${folder}/${file}`);
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!data || typeof data !== 'object') return [];
  const { meta, jobs, longShots } = data as Record<string, unknown>;
  const about = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
  const date = firstDate(text(about.checked)) ?? firstDate(`${folder.slice(0, 7)}-01`);
  const source = withFocus(
    workspace,
    searchSource(text(about.source) ?? text(about.title) ?? folder),
    text(about.focus),
  );
  const report = text(about.artifactUrl);
  // A search for one kind of job says so once. One for every kind says it on each job.
  const searchKind = text(about.kind);
  // The first run's keys stay as they were before a folder could hold more than one.
  const runKey = run === 1 ? folder : `${folder}#${run}`;

  const found = (item: Record<string, unknown>, longShot: boolean): SearchRecord => {
    const company = text(item.company) ?? '';
    const role = text(item.role) ?? '';
    const posting = text(item.posting);
    const site = text(item.site);
    const hnId = number(item.hnId);
    const job = text(item.job)?.trim().toLowerCase() ?? null;
    return {
      tool: 'search',
      key: `${runKey}:${companyKey(company)}:${roleKey(role)}`,
      date,
      source,
      folder,
      run,
      job: job && JOB_ID.test(job) ? job : null,
      company,
      role,
      links: [
        ...(posting ? [{ url: posting, label: 'Posting' }] : []),
        ...(hnId
          ? [{ url: `https://news.ycombinator.com/item?id=${hnId}`, label: 'HN post' }]
          : []),
        ...(site ? [{ url: site, label: 'Company site' }] : []),
      ],
      pay: text(item.pay),
      location: longShot ? null : text(item.remote),
      tier: longShot ? 'long' : (SEARCH_TIERS.get(text(item.tier) ?? '') ?? null),
      score: longShot ? null : number(item.score),
      kind: text(item.kind) ?? searchKind,
      detail: {
        why: longShot ? [] : texts(item.why),
        gaps: longShot ? [] : texts(item.gaps),
        flags: longShot ? [] : texts(item.flags),
        pick: longShot ? null : text(item.pick),
        what: longShot ? null : text(item.what),
        stage: longShot ? null : text(item.stage),
        apply: longShot ? null : text(item.apply),
        note: longShot ? text(item.note) : null,
        parts: longShot ? {} : partsOf(item.parts, number),
        partsWhy: longShot ? {} : partsOf(item.partsWhy, text),
        tags: longShot
          ? []
          : objects(item.tags).flatMap((tag) => {
              const label = text(tag.label);
              return label ? [label] : [];
            }),
        report,
      },
    };
  };
  return [
    ...objects(jobs).map((item) => found(item, false)),
    ...objects(longShots).map((item) => found(item, true)),
  ];
}

function outreachRecords(workspace: WorkspaceReader): ToolRecord[] {
  return workspace
    .list(WORKSPACE_PATHS.outreach)
    .sort(byName)
    .flatMap((entry) => {
      const match = entry.name.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
      if (entry.folder || !match?.[1] || !match[2]) return [];
      const slug = match[2];
      return [
        {
          tool: 'outreach' as const,
          key: entry.name,
          date: match[1],
          company: companyFromSlug(slug),
          companySlug: slug,
          role: '',
          links: [],
        },
      ];
    });
}

/**
 * Reads everything the skills have saved in the workspace: the fit check log, each job's
 * folder, each job search, the salary and employer checks, and drafted messages.
 */
export function readRecords(workspace: WorkspaceReader): ToolRecord[] {
  return [
    ...fitCheckRecords(workspace),
    ...folderRecords(workspace),
    ...searchRecords(workspace),
    ...salaryRecords(workspace),
    ...unmaskRecords(workspace),
    ...outreachRecords(workspace),
  ];
}
