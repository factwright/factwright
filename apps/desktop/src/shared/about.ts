import { LAYOUTS, type Layout } from '@factwright/engine/templates';

/**
 * What the user tells Factwright about themselves when they start, and can change later in
 * Profile: who they are, what they're looking for, how their resumes should look, and the files
 * they shared. It's kept in the workspace as about-me/answers.json, so Claude reads it, and so
 * it syncs to the user's other computers.
 */
export interface AboutYou {
  /** Who they are, as their resumes should show it. */
  you: Contact;
  /** Job titles they want, such as "Product Designer". */
  roles: string[];
  fields: Field[];
  levels: Level[];
  workplaces: Workplace[];
  /** Where they can work remotely from, such as "anywhere in the US". */
  remoteFrom: string;
  /** Cities for hybrid or on-site work. */
  places: string[];
  relocate: Relocate;
  companies: CompanyKind[];
  /** Industries they'd love to work in. */
  industries: string[];
  /** Industries they won't work in. */
  avoid: string[];
  employment: Employment[];
  /** The least base pay they'd take, as they say it, such as "$120,000". */
  minPay: string;
  targetPay: string;
  /** Whether jobs paying less than minPay are left out of searches. */
  payFilter: boolean;
  /** Whether they can work where the jobs are, such as "US citizen, no sponsorship needed". */
  authorization: string;
  /** When they can start, such as "two weeks' notice". */
  start: string;
  mustHaves: string;
  dealBreakers: string;
  /** They're employed, and their employer shouldn't find out they're looking. */
  quiet: boolean;
  /** The templates they picked, each for one kind of company or any job. */
  looks: Look[];
  /** At most how many pages, or null to go by their level. */
  pages: 1 | 2 | null;
  format: ResumeFiles;
  /** The files they shared, kept in about-me/files. */
  files: SharedFile[];
  /** The getting-started step they're on, to come back to. */
  step: number;
  /** The furthest getting-started step they've reached. */
  reached: number;
  /** When they handed their answers to Claude, as an ISO date, or null before then. */
  startedOn: string | null;
  /** They skipped getting started, for now. */
  skipped: boolean;
}

export interface Contact {
  name: string;
  email: string;
  phone: string;
  /** Such as "Denver, CO". */
  location: string;
  linkedin: string;
  website: string;
}

export interface Look {
  layout: Layout;
  /** The kind of company it's for, or "any". */
  for: CompanyKind | 'any';
}

/** What a shared file is, which says how Claude reads it. */
export const FILE_KINDS = [
  'resume',
  'linkedin-profile',
  'linkedin-data',
  'screenshot',
  'document',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export interface SharedFile {
  /** Where it is in the workspace, such as "about-me/files/resume-2024.pdf". */
  path: string;
  /** Its name when the user chose it. */
  name: string;
  kind: FileKind;
  /** When it was added, as an ISO date. */
  added: string;
  /** The file beside it holding its text, read out of it for Claude, or null if it has none. */
  textFile: string | null;
}

/** The kinds of work, broad enough for anyone. */
export const FIELDS = [
  ['software', 'Software engineering'],
  ['data', 'Data and AI'],
  ['it', 'IT and security'],
  ['product', 'Product management'],
  ['design', 'Design and UX'],
  ['marketing', 'Marketing and communications'],
  ['sales', 'Sales and business development'],
  ['customer', 'Customer success and support'],
  ['operations', 'Operations and logistics'],
  ['finance', 'Finance and accounting'],
  ['people', 'HR and recruiting'],
  ['legal', 'Legal'],
  ['healthcare', 'Healthcare'],
  ['education', 'Teaching and education'],
  ['science', 'Science and research'],
  ['creative', 'Writing, media and the arts'],
  ['trades', 'Skilled trades and manufacturing'],
  ['other', 'Something else'],
] as const;
export type Field = (typeof FIELDS)[number][0];

export const LEVELS = [
  ['entry', 'Entry level'],
  ['mid', 'Mid level'],
  ['senior', 'Senior'],
  ['lead', 'Lead or principal'],
  ['manager', 'Manager'],
  ['director', 'Director'],
  ['executive', 'Executive'],
] as const;
export type Level = (typeof LEVELS)[number][0];

export const WORKPLACES = [
  ['remote', 'Remote'],
  ['hybrid', 'Hybrid'],
  ['onsite', 'On-site'],
] as const;
export type Workplace = (typeof WORKPLACES)[number][0];

export const RELOCATE = [
  ['', 'Not sure yet'],
  ['no', 'No'],
  ['maybe', 'For the right job'],
  ['yes', 'Yes'],
] as const;
export type Relocate = (typeof RELOCATE)[number][0];

/**
 * The kinds of company, each with its own resume style: who reads the resume there, and what
 * they reward.
 */
export const COMPANY_KINDS = [
  ['startup', 'Startups', 'Early and growing companies, up to a few hundred people'],
  ['established', 'Established companies', 'Mid-size and large companies, and public companies'],
  ['public', 'Government, nonprofits and schools', 'Public service, charities and education'],
] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number][0];

/** The resume style in guide/styles for each kind of company. */
export const STYLE_OF: Readonly<Record<CompanyKind, string>> = {
  startup: 'startup',
  established: 'big-company',
  public: 'public-sector',
};

export const EMPLOYMENT = [
  ['full-time', 'Full-time'],
  ['part-time', 'Part-time'],
  ['contract', 'Contract'],
  ['freelance', 'Freelance'],
  ['internship', 'Internship'],
] as const;
export type Employment = (typeof EMPLOYMENT)[number][0];

export const RESUME_FILES = [
  ['pdf', 'PDF'],
  ['docx', 'Word'],
  ['both', 'Both'],
] as const;
export type ResumeFiles = (typeof RESUME_FILES)[number][0];

/** A list's labels by value, such as "Mid level" for "mid". */
export const labelOf = <T extends string>(
  list: readonly (readonly [T, string, ...string[]])[],
  value: T,
) => list.find(([each]) => each === value)?.[1] ?? value;

/** Nothing told yet. */
export const NO_ANSWERS: AboutYou = {
  you: { name: '', email: '', phone: '', location: '', linkedin: '', website: '' },
  roles: [],
  fields: [],
  levels: [],
  workplaces: [],
  remoteFrom: '',
  places: [],
  relocate: '',
  companies: [],
  industries: [],
  avoid: [],
  employment: [],
  minPay: '',
  targetPay: '',
  payFilter: false,
  authorization: '',
  start: '',
  mustHaves: '',
  dealBreakers: '',
  quiet: false,
  looks: [],
  pages: null,
  format: 'pdf',
  files: [],
  step: 0,
  reached: 0,
  startedOn: null,
  skipped: false,
};

/** The longest text each answer takes, so a stray paste can't swell the file. */
export const ANSWER_LIMITS = {
  line: 200,
  entry: 120,
  entries: 30,
  text: 4000,
  files: 200,
  /** The notes, kept in about-me/notes.md, can be long: that's the point of them. */
  notes: 200_000,
} as const;

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

const text = (value: unknown, max: number = ANSWER_LIMITS.line): string | undefined =>
  isText(value, max) ? value : undefined;

/** A list of short entries, trimmed, without blanks or repeats. */
function entries(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > ANSWER_LIMITS.entries) return undefined;
  const kept: string[] = [];
  for (const each of value) {
    if (!isText(each, ANSWER_LIMITS.entry)) return undefined;
    const entry = each.trim();
    if (entry && !kept.some((known) => known.toLowerCase() === entry.toLowerCase())) {
      kept.push(entry);
    }
  }
  return kept;
}

/** The values of a list that are among its options, in the options' order. */
function choices<T extends string>(
  value: unknown,
  options: readonly (readonly [T, ...string[]])[],
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const known = options.map(([each]) => each);
  return value.every((each) => known.includes(each))
    ? known.filter((each) => value.includes(each))
    : undefined;
}

function choice<T extends string>(
  value: unknown,
  options: readonly (readonly [T, ...string[]])[],
): T | undefined {
  return options.some(([each]) => each === value) ? (value as T) : undefined;
}

function contact(value: unknown): Contact | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  const read: Partial<Contact> = {};
  for (const key of Object.keys(NO_ANSWERS.you) as (keyof Contact)[]) {
    const field = fields[key] ?? '';
    if (!isText(field, ANSWER_LIMITS.line)) return undefined;
    read[key] = field;
  }
  return read as Contact;
}

function looks(value: unknown): Look[] | undefined {
  if (!Array.isArray(value) || value.length > LAYOUTS.length) return undefined;
  const kept: Look[] = [];
  for (const each of value) {
    if (typeof each !== 'object' || each === null) return undefined;
    const { layout, for: kind } = each as Record<string, unknown>;
    if (!(LAYOUTS as readonly unknown[]).includes(layout)) return undefined;
    if (kind !== 'any' && !choice(kind, COMPANY_KINDS)) return undefined;
    if (!kept.some((look) => look.layout === layout)) {
      kept.push({ layout: layout as Layout, for: kind as Look['for'] });
    }
  }
  return kept;
}

/** Where shared files are kept, and the names the app gives them there. */
export const FILES_FOLDER = 'about-me/files';
const FILE_PATH = /^about-me\/files\/[a-z0-9][a-z0-9._-]{0,150}$/;

function files(value: unknown): SharedFile[] | undefined {
  if (!Array.isArray(value) || value.length > ANSWER_LIMITS.files) return undefined;
  const kept: SharedFile[] = [];
  for (const each of value) {
    if (typeof each !== 'object' || each === null) return undefined;
    const file = each as Record<string, unknown>;
    const kind = (FILE_KINDS as readonly unknown[]).includes(file.kind)
      ? (file.kind as FileKind)
      : null;
    const path = text(file.path);
    const textFile = file.textFile === null ? null : text(file.textFile);
    if (!kind || !path || !FILE_PATH.test(path) || textFile === undefined) return undefined;
    if (textFile !== null && !FILE_PATH.test(textFile)) return undefined;
    const name = text(file.name, ANSWER_LIMITS.entry) ?? path.slice(FILES_FOLDER.length + 1);
    const added = text(file.added) ?? '';
    kept.push({
      path,
      name,
      kind,
      added: /^\d{4}-\d{2}-\d{2}$/.test(added) ? added : '',
      textFile,
    });
  }
  return kept;
}

function stepNumber(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 20
    ? (value as number)
    : undefined;
}

const READERS: { [K in keyof AboutYou]: (value: unknown) => AboutYou[K] | undefined } = {
  you: contact,
  roles: entries,
  fields: (value) => choices(value, FIELDS),
  levels: (value) => choices(value, LEVELS),
  workplaces: (value) => choices(value, WORKPLACES),
  remoteFrom: (value) => text(value),
  places: entries,
  relocate: (value) => choice(value, RELOCATE),
  companies: (value) => choices(value, COMPANY_KINDS),
  industries: entries,
  avoid: entries,
  employment: (value) => choices(value, EMPLOYMENT),
  minPay: (value) => text(value, ANSWER_LIMITS.entry),
  targetPay: (value) => text(value, ANSWER_LIMITS.entry),
  payFilter: (value) => (typeof value === 'boolean' ? value : undefined),
  authorization: (value) => text(value),
  start: (value) => text(value),
  mustHaves: (value) => text(value, ANSWER_LIMITS.text),
  dealBreakers: (value) => text(value, ANSWER_LIMITS.text),
  quiet: (value) => (typeof value === 'boolean' ? value : undefined),
  looks,
  pages: (value) => (value === 1 || value === 2 || value === null ? value : undefined),
  format: (value) => choice(value, RESUME_FILES),
  files,
  step: stepNumber,
  reached: stepNumber,
  startedOn: (value) =>
    value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
      ? value
      : undefined,
  skipped: (value) => (typeof value === 'boolean' ? value : undefined),
};

/**
 * Answers read from about-me/answers.json, which Claude may have edited too. Each answer that
 * doesn't hold up falls back to nothing told, so one bad edit never loses the rest.
 */
export function readAnswers(value: unknown): AboutYou {
  const fields =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const answers = { ...NO_ANSWERS } as Record<keyof AboutYou, unknown>;
  for (const [key, read] of Object.entries(READERS) as [
    keyof AboutYou,
    (value: unknown) => unknown,
  ][]) {
    const valid = key in fields ? read(fields[key]) : undefined;
    if (valid !== undefined) answers[key] = valid;
  }
  return answers as AboutYou;
}

/** The answers the window may change. The files list changes only as files are added or removed. */
export type AnswerChanges = Partial<Omit<AboutYou, 'files' | 'startedOn'>>;

/**
 * Changes from the window, checked one by one, or null if any doesn't hold up, so nothing is
 * half saved.
 */
export function parseAnswerChanges(value: unknown): AnswerChanges | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const changes: Record<string, unknown> = {};
  for (const [key, change] of Object.entries(value)) {
    if (key === 'files' || key === 'startedOn' || !(key in READERS)) return null;
    const valid = READERS[key as keyof AboutYou](change);
    if (valid === undefined) return null;
    changes[key] = valid;
  }
  return changes as AnswerChanges;
}

/** How long resumes should be: what the user chose, or by their level when they haven't. */
export function pagesFor(answers: Pick<AboutYou, 'pages' | 'levels'>): 1 | 2 {
  if (answers.pages) return answers.pages;
  const early =
    answers.levels.length > 0 &&
    answers.levels.every((level) => level === 'entry' || level === 'mid');
  return early ? 1 : 2;
}

/** How many words the notes hold. */
export const wordCount = (notes: string) => notes.split(/\s+/).filter(Boolean).length;
