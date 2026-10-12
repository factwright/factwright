import { firstDate } from './dates.ts';
import type { FitTier } from './fit.ts';
import { SCORE_PARTS, type ScorePartKey } from './fit-report.ts';
import { companyKey, roleKey } from './keys.ts';
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

/** The Markdown files a job's folder can hold, by kind. */
export const JOB_DOCS = {
  posting: 'posting.md',
  job: 'job.md',
  fit: 'fit-check.md',
  unmask: 'unmask.md',
  notes: 'notes.md',
  answers: 'answers.md',
  prep: 'prep.md',
  apply: 'apply.md',
} as const;

export type JobDocKind = keyof typeof JOB_DOCS;

export type JobDocs = Partial<Record<JobDocKind, string>>;

/** A resume in a job's folder. */
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
  files: JobFile[];
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
  pay: string | null;
  location: string | null;
  tier: FitTier | null;
  score: number | null;
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
    const files: JobFile[] = workspace
      .list(path)
      .sort(byName)
      .flatMap((file) => {
        const format = file.name.match(/\.(pdf|docx)$/i)?.[1]?.toLowerCase();
        if (file.folder || (format !== 'pdf' && format !== 'docx')) return [];
        const { name, size, modified } = file;
        return [{ path: `${path}/${name}`, name, format, size, modified }];
      });
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
      files,
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

function searchRecords(workspace: WorkspaceReader): ToolRecord[] {
  const records: ToolRecord[] = [];
  for (const entry of workspace.list(WORKSPACE_PATHS.searches).sort(byName)) {
    if (!entry.folder) continue;
    const folder = entry.name;
    const raw = workspace.readText(`${WORKSPACE_PATHS.searches}/${folder}/jobs.json`);
    if (!raw) continue;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!data || typeof data !== 'object') continue;
    const { meta, jobs, longShots } = data as Record<string, unknown>;
    const about = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
    const date = firstDate(text(about.checked)) ?? firstDate(`${folder.slice(0, 7)}-01`);
    const source = searchSource(text(about.source) ?? text(about.title) ?? folder);
    const report = text(about.artifactUrl);

    const found = (item: Record<string, unknown>, longShot: boolean): SearchRecord => {
      const company = text(item.company) ?? '';
      const role = text(item.role) ?? '';
      const posting = text(item.posting);
      const site = text(item.site);
      const hnId = number(item.hnId);
      return {
        tool: 'search',
        key: `${folder}:${companyKey(company)}:${roleKey(role)}`,
        date,
        source,
        folder,
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
    for (const item of objects(jobs)) records.push(found(item, false));
    for (const item of objects(longShots)) records.push(found(item, true));
  }
  return records;
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
