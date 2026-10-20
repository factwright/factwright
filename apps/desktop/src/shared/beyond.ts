import { slug } from '@factwright/core';

/**
 * Work outside a job, and the user outside work, as they tell Factwright in Profile's Beyond
 * work. A project is anything they made, led or kept going outside a job, in any field: an app,
 * an open-source library, a club they run, research, art, a small business, volunteering, a
 * course project. Each is an overview in their own words, which Claude turns into facts in
 * facts/projects.md with them, so nothing from it goes out until they verify it.
 *
 * It's kept in about-me/beyond-work.json, apart from answers.json, which versions from before it
 * rewrite with only the answers they know.
 */
export const BEYOND_FILE = 'about-me/beyond-work.json';

/** What kind of work a project is, broad enough for anyone. */
export const PROJECT_KINDS = [
  ['product', 'App or product'],
  ['side', 'Side project'],
  ['open-source', 'Open source'],
  ['research', 'Research'],
  ['creative', 'Creative work'],
  ['volunteering', 'Volunteering'],
  ['community', 'Community'],
  ['business', 'Small business'],
  ['course', 'Course or school project'],
  ['other', 'Something else'],
] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number][0];

/** Where a project stands, as the user says it. Its facts' status tags follow from it. */
export const PROJECT_STATUSES = [
  ['', 'Not said'],
  ['live', 'Live or ongoing'],
  ['building', 'In progress'],
  ['done', 'Finished'],
  ['paused', 'Paused or stopped'],
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number][0];

/** How much a project is put forward in what the user sends out, wherever it goes. */
export const PROJECT_SHOWING = [
  ['feature', 'Feature it', 'Put it forward on every application with room for it.'],
  ['fit', 'When it fits', 'Use it when it helps with the job.'],
  ['private', 'Keep it private', 'Your Claude knows it, but it never goes on anything you send.'],
] as const;
export type ProjectShowing = (typeof PROJECT_SHOWING)[number][0];

/** Whether resumes get a line of the user's interests. */
export const INTERESTS_ON_RESUMES = [
  ['never', 'Leave it off'],
  ['fit', 'When it fits the job'],
  ['always', 'On every resume'],
] as const;
export type InterestsOnResumes = (typeof INTERESTS_ON_RESUMES)[number][0];

/** Where projects go on resumes. */
export const RESUME_PLACES = [
  ['off', 'Leave them off', 'Your resumes don’t list them.'],
  ['section', 'In a section', 'A section of their own, under the heading you choose.'],
  [
    'experience',
    'As experience',
    'Listed like jobs, for work at that scale, such as products under a company you run.',
  ],
] as const;
export type ResumePlace = (typeof RESUME_PLACES)[number][0];

/** How much each project gets on a resume. */
export const PROJECT_DETAIL = [
  ['line', 'One line'],
  ['lines', 'Two lines'],
  ['paragraph', 'A short paragraph'],
] as const;
export type ProjectDetail = (typeof PROJECT_DETAIL)[number][0];

/**
 * How the user wants their projects to look on resumes. It's what every job starts from, and
 * one job can differ when they ask Claude, which notes it in that job's job.md.
 */
export interface ProjectPrefs {
  resumes: ResumePlace;
  /** The section's heading in their words, such as "Selected Work". Blank lets Claude name it. */
  heading: string;
  detail: ProjectDetail;
  /** Whether each project shows its link, its numbers and its tools. */
  links: boolean;
  numbers: boolean;
  tools: boolean;
}

/** As resumes have always shown projects: a section, a line each, with links and numbers. */
export const DEFAULT_PROJECT_PREFS: ProjectPrefs = {
  resumes: 'section',
  heading: '',
  detail: 'line',
  links: true,
  numbers: true,
  tools: false,
};

/** One project, as the user tells it. */
export interface Project {
  /** Made when it's added, and kept when it's renamed. */
  id: string;
  name: string;
  kind: ProjectKind;
  /** What it is, in a line or two. */
  what: string;
  /** What the user did, such as "Built it alone" or "Founded it and lead 12 volunteers". */
  role: string;
  /**
   * A company or group it's part of, such as one the user runs. Projects under one name can show
   * as one job on a resume.
   */
  under: string;
  status: ProjectStatus;
  /** When, as they say it, such as "2023 to now". */
  when: string;
  /** Its website, store page, repository or portfolio page. */
  links: string[];
  /** What they can count: users, downloads, money raised, people helped, awards. */
  results: string;
  /** The skills and tools it took. */
  skills: string[];
  showing: ProjectShowing;
}

export const BEYOND_LIMITS = {
  projects: 30,
  name: 120,
  what: 1000,
  role: 300,
  under: 120,
  when: 120,
  links: 10,
  link: 300,
  results: 2000,
  skills: 30,
  skill: 120,
  heading: 60,
} as const;

/** A project's id: lowercase letters, digits and hyphens. */
export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** A project just added, with nothing told yet but its id. */
export const newProject = (id: string): Project => ({
  id,
  name: '',
  kind: 'side',
  what: '',
  role: '',
  under: '',
  status: '',
  when: '',
  links: [],
  results: '',
  skills: [],
  showing: 'fit',
});

/** An id for a new project, from its name, that none of the others has. */
export function projectIdFor(name: string, taken: readonly string[]): string {
  const base = slug(name).slice(0, 40).replace(/-+$/, '') || 'project';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * An id for a project just added in the window, made up afresh, so it's never one a project
 * removed a moment ago had, whose fields another version kept could otherwise come back with it.
 */
export function freshProjectId(taken: readonly string[], random: () => number = Math.random) {
  let id: string;
  do id = `project-${random().toString(36).slice(2, 10) || '0'}`;
  while (taken.includes(id));
  return id;
}

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

const textOf = (max: number) => (value: unknown) => (isText(value, max) ? value : undefined);

/** A list of short entries, trimmed, without blanks or repeats, or nothing when it won't do. */
function shortList(value: unknown, most: number, longest: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > most) return undefined;
  const kept: string[] = [];
  for (const each of value) {
    if (!isText(each, longest)) return undefined;
    const entry = each.trim();
    if (entry && !kept.some((known) => known.toLowerCase() === entry.toLowerCase())) {
      kept.push(entry);
    }
  }
  return kept;
}

function pick<T extends string>(value: unknown, options: readonly (readonly [T, ...string[]])[]) {
  return options.some(([each]) => each === value) ? (value as T) : undefined;
}

const yesOrNo = (value: unknown) => (typeof value === 'boolean' ? value : undefined);

const fieldsOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** How each of a project's fields is read: what's there, or nothing when it won't do. */
const PROJECT_READERS: {
  [K in keyof Omit<Project, 'id'>]: (value: unknown) => Project[K] | undefined;
} = {
  name: textOf(BEYOND_LIMITS.name),
  kind: (value) => pick(value, PROJECT_KINDS),
  what: textOf(BEYOND_LIMITS.what),
  role: textOf(BEYOND_LIMITS.role),
  under: textOf(BEYOND_LIMITS.under),
  status: (value) => pick(value, PROJECT_STATUSES),
  when: textOf(BEYOND_LIMITS.when),
  links: (value) => shortList(value, BEYOND_LIMITS.links, BEYOND_LIMITS.link),
  results: textOf(BEYOND_LIMITS.results),
  skills: (value) => shortList(value, BEYOND_LIMITS.skills, BEYOND_LIMITS.skill),
  showing: (value) => pick(value, PROJECT_SHOWING),
};

/**
 * A project as a file or the window holds it. Without an id it isn't one. Each other field that
 * doesn't hold up falls back to nothing told, or when it's strict, the project doesn't hold up.
 * How much to show it is the exception: one that doesn't read, such as a later version's, keeps
 * the project private, so a project the user hid never goes out by mistake.
 */
export function readProject(value: unknown, strict: boolean): Project | undefined {
  const fields = fieldsOf(value);
  if (!fields || typeof fields.id !== 'string' || !PROJECT_ID.test(fields.id)) return undefined;
  const project = newProject(fields.id) as unknown as Record<string, unknown>;
  for (const [key, read] of Object.entries(PROJECT_READERS)) {
    if (!(key in fields)) continue;
    const valid = (read as (value: unknown) => unknown)(fields[key]);
    if (valid === undefined && strict) return undefined;
    if (valid !== undefined) project[key] = valid;
    else if (key === 'showing') project[key] = 'private';
  }
  return project as unknown as Project;
}

/**
 * The projects as a file holds them: one that doesn't read is left out, and so is a second one
 * by the same id, or one past as many as the app keeps, but the rest stay.
 */
export function readProjects(value: unknown): Project[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept: Project[] = [];
  for (const each of value) {
    if (kept.length === BEYOND_LIMITS.projects) break;
    const project = readProject(each, false);
    if (project && !kept.some((other) => other.id === project.id)) kept.push(project);
  }
  return kept;
}

const PREFS_READERS: {
  [K in keyof ProjectPrefs]: (value: unknown) => ProjectPrefs[K] | undefined;
} = {
  resumes: (value) => pick(value, RESUME_PLACES),
  heading: textOf(BEYOND_LIMITS.heading),
  detail: (value) => pick(value, PROJECT_DETAIL),
  links: yesOrNo,
  numbers: yesOrNo,
  tools: yesOrNo,
};

/**
 * How projects look on resumes, as a file or the window holds it, a choice at a time: one it
 * leaves out, or one that doesn't hold up, such as a later version's, is as it's always been, and
 * the rest stand.
 */
export function readProjectPrefs(value: unknown): ProjectPrefs | undefined {
  const fields = fieldsOf(value);
  if (!fields) return undefined;
  const prefs: Record<string, unknown> = { ...DEFAULT_PROJECT_PREFS };
  for (const [key, read] of Object.entries(PREFS_READERS)) {
    if (!(key in fields)) continue;
    const valid = (read as (value: unknown) => unknown)(fields[key]);
    if (valid !== undefined) prefs[key] = valid;
  }
  return prefs as unknown as ProjectPrefs;
}

/** A change to one project, by its id: some of its fields. */
export type ProjectChange = { id: string } & Partial<Omit<Project, 'id'>>;

/** Projects the window adds, each whole, or none when any doesn't hold up. */
export function addedProjects(value: unknown): Project[] | undefined {
  if (!Array.isArray(value) || value.length > BEYOND_LIMITS.projects) return undefined;
  const kept: Project[] = [];
  for (const each of value) {
    const project = readProject(each, true);
    if (!project) return undefined;
    kept.push(project);
  }
  return kept;
}

/** Projects the window removes, by id, or none when any isn't one. */
export function removedProjects(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > BEYOND_LIMITS.projects) return undefined;
  return value.every((id) => typeof id === 'string' && PROJECT_ID.test(id))
    ? [...new Set(value as string[])]
    : undefined;
}

/** Changes to projects as the window sends them, each that holds up, or none. */
export function projectChanges(value: unknown): ProjectChange[] | undefined {
  if (!Array.isArray(value) || value.length > BEYOND_LIMITS.projects) return undefined;
  const kept: ProjectChange[] = [];
  for (const each of value) {
    const fields = fieldsOf(each);
    if (!fields) return undefined;
    const { id, ...rest } = fields;
    if (typeof id !== 'string' || !PROJECT_ID.test(id) || kept.some((other) => other.id === id)) {
      return undefined;
    }
    const change: Record<string, unknown> = { id };
    for (const [key, field] of Object.entries(rest)) {
      const read = Object.hasOwn(PROJECT_READERS, key)
        ? (PROJECT_READERS[key as keyof typeof PROJECT_READERS] as (value: unknown) => unknown)(
            field,
          )
        : undefined;
      if (read === undefined) return undefined;
      change[key] = read;
    }
    kept.push(change as ProjectChange);
  }
  return kept;
}

/** What the window may send about the projects. */
export interface ProjectEdits {
  addedProjects?: Project[];
  removedProjects?: string[];
  projectChanges?: ProjectChange[];
}

/** The keys of those edits, and how each is read. */
export const PROJECT_EDITS: Readonly<Record<keyof ProjectEdits, (value: unknown) => unknown>> = {
  addedProjects,
  removedProjects,
  projectChanges,
};

/**
 * The projects with edits made: those removed go, each change lands on its project by id, and
 * those added join at the end, past none already there by their id or as many as the app keeps.
 * A change to a project that's gone does nothing.
 */
export function applyProjectEdits(projects: readonly Project[], edits: ProjectEdits): Project[] {
  const removed = edits.removedProjects ?? [];
  const kept = projects.filter((project) => !removed.includes(project.id));
  for (const { id, ...fields } of edits.projectChanges ?? []) {
    const at = kept.findIndex((project) => project.id === id);
    if (at >= 0) kept[at] = { ...(kept[at] as Project), ...fields };
  }
  for (const project of edits.addedProjects ?? []) {
    if (kept.length < BEYOND_LIMITS.projects && !kept.some((each) => each.id === project.id)) {
      kept.push(project);
    }
  }
  return kept;
}

/**
 * Edits made one after another, as one: a project removed takes its earlier changes with it, and
 * its add, when it was added since the last save; a project added since then carries its own
 * changes; and changes to one project join, the later winning.
 */
export function mergeProjectEdits(earlier: ProjectEdits, later: ProjectEdits): ProjectEdits {
  const removed = later.removedProjects ?? [];
  const added = [
    ...(earlier.addedProjects ?? []).filter((project) => !removed.includes(project.id)),
    ...(later.addedProjects ?? []),
  ];
  const gone = [...new Set([...(earlier.removedProjects ?? []), ...removed])];
  const changed = (earlier.projectChanges ?? []).filter((change) => !removed.includes(change.id));
  for (const change of later.projectChanges ?? []) {
    const fresh = added.findIndex((project) => project.id === change.id);
    const at = changed.findIndex((each) => each.id === change.id);
    if (fresh >= 0) added[fresh] = { ...(added[fresh] as Project), ...change };
    else if (at < 0) changed.push(change);
    else changed[at] = { ...changed[at], ...change };
  }
  return {
    ...(added.length > 0 && { addedProjects: added }),
    ...(gone.length > 0 && { removedProjects: gone }),
    ...(changed.length > 0 && { projectChanges: changed }),
  };
}

/** Everything Beyond work holds, by the names its file and the answers give each. */
export interface BeyondWork {
  projects: Project[];
  projectPrefs: ProjectPrefs;
  /** What they do outside work, such as "Trail running". */
  interests: string[];
  /** What they're learning or working on in themselves, such as "Spanish". */
  learning: string[];
  /** Communities they're part of, such as a meetup they run or a sports league. */
  communities: string[];
  /** What they care about: causes, values, the kind of work that matters to them. */
  cares: string;
  interestsOnResumes: InterestsOnResumes;
}

/** Beyond work's parts, as its file names them. */
export const BEYOND_KEYS = [
  'projects',
  'projectPrefs',
  'interests',
  'learning',
  'communities',
  'cares',
  'interestsOnResumes',
] as const satisfies readonly (keyof BeyondWork)[];

/** Nothing told yet. */
export const NO_BEYOND: BeyondWork = {
  projects: [],
  projectPrefs: DEFAULT_PROJECT_PREFS,
  interests: [],
  learning: [],
  communities: [],
  cares: '',
  interestsOnResumes: 'never',
};

/** Beyond work's parts of the answers. */
export const beyondOf = (answers: BeyondWork): BeyondWork =>
  Object.fromEntries(BEYOND_KEYS.map((key) => [key, answers[key]])) as unknown as BeyondWork;

/** When the projects last changed, which the file keeps so the app knows when Claude last read them. */
export const PROJECTS_CHANGED = 'projectsChanged';

/**
 * A time as the file keeps it: on the user's own calendar, with its offset from UTC, such as
 * "2026-10-21T08:00:00+09:00", so its date is the one Claude writes in read.md that day.
 */
export function localTime(date: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

/** Whether two values say the same, as JSON. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Beyond work's file with a change made, or null when nothing changed. Only what changed goes
 * over the file, so what this version doesn't know stays: parts a later version added, values it
 * reads differently, a project's fields it doesn't know, and projects it can't read, such as one
 * past as many as it keeps. When the projects change, the file notes when.
 */
export function beyondFileWith(
  raw: Record<string, unknown>,
  before: BeyondWork,
  after: BeyondWork,
  now: string,
): Record<string, unknown> | null {
  if (same(before, after)) return null;
  const file: Record<string, unknown> = { ...raw };
  for (const key of BEYOND_KEYS) {
    if (key === 'projects' || key === 'projectPrefs' || same(before[key], after[key])) continue;
    file[key] = after[key];
  }
  // A choice at a time, so the choices this version doesn't know, or reads differently, stay.
  if (!same(before.projectPrefs, after.projectPrefs)) {
    const was = before.projectPrefs as unknown as Record<string, unknown>;
    file.projectPrefs = {
      ...fieldsOf(raw.projectPrefs),
      ...Object.fromEntries(
        Object.entries(after.projectPrefs).filter(([key, value]) => !same(value, was[key])),
      ),
    };
  }
  if (!same(before.projects, after.projects)) {
    const rawProjects = Array.isArray(raw.projects) ? (raw.projects as unknown[]) : [];
    const rawById = (id: string) => fieldsOf(rawProjects.find((each) => fieldsOf(each)?.id === id));
    const read = new Set(before.projects.map((project) => project.id));
    const ours = new Set(after.projects.map((project) => project.id));
    // What changed of a project since it was read, all of it for one that's new.
    const changes = (project: Project) => {
      const was = before.projects.find((each) => each.id === project.id);
      return Object.fromEntries(
        Object.entries(project).filter(
          ([key, value]) => !was || !same(value, (was as unknown as Record<string, unknown>)[key]),
        ),
      );
    };
    file.projects = [
      ...after.projects.map((project) => ({
        ...rawById(project.id),
        ...changes(project),
        id: project.id,
      })),
      ...rawProjects.filter((each) => {
        const id = fieldsOf(each)?.id;
        return !(typeof id === 'string' && (read.has(id) || ours.has(id)));
      }),
    ];
    file[PROJECTS_CHANGED] = now;
  }
  return file;
}

/** A list's label by value, such as "Open source" for "open-source". */
export const labelIn = <T extends string>(
  list: readonly (readonly [T, string, ...string[]])[],
  value: T,
) => list.find(([each]) => each === value)?.[1] ?? value;
