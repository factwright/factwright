import { readForApplications } from '@factwright/core';
import {
  type AboutYou,
  ANSWER_LIMITS,
  type AnswerChanges,
  applyChanges,
  COMPANY_KINDS,
  type Contact,
  EMPLOYMENT,
  FIELDS,
  LEVELS,
  labelOf,
  mergeChanges,
  OVER_18,
  parseAnswerChanges,
  RELOCATE,
  RESUME_FILES,
  SPONSORSHIP,
  WORKPLACES,
} from '../../shared/about.ts';
import {
  BEYOND_LIMITS,
  INTERESTS_ON_RESUMES,
  newProject,
  PAGE_SHAPE_CHOICES,
  PROJECT_DETAIL,
  PROJECT_KINDS,
  PROJECT_SHOWING,
  PROJECT_STATUSES,
  type ProjectPrefs,
  projectIdFor,
  RESUME_PLACES,
  readProjectPrefs,
} from '../../shared/beyond.ts';
import {
  addKind,
  changeKind,
  hasKinds,
  kindsOf,
  removeKind,
  renameKind,
} from '../../shared/kinds.ts';
import { CHANGES_QUESTION, PART_NAMES, type ProfilePart } from '../../shared/profile-parts.ts';
import type { BoundProfileChanges } from '../about/profile-requests.ts';
import type { AboutStore } from '../about/store.ts';
import type { TemplateLibrary } from '../resume/templates.ts';
import type { ToolCall } from './mcp.ts';

/**
 * What a run started with Update with Claude reads and saves: one part of Profile, with a tool for
 * each part that had none. Each tool goes by the checks the window's own changes go by, saves
 * through the same store, so each file is kept for Undo and the task's card lists it, and refuses
 * what isn't its part's. They're for runs that started from the user's own words, so no run that
 * reads the web has them.
 */

/** What these tools need of the user's Profile. */
export type PartAbout = Pick<
  AboutStore,
  | 'answers'
  | 'saveAnswers'
  | 'notes'
  | 'addToNotes'
  | 'confidential'
  | 'changeConfidential'
  | 'criteriaIsOwn'
  | 'history'
>;

/** A list's values, a blank one included, which says it's not told. */
const values = (options: readonly (readonly [string, ...string[]])[]) =>
  options.map(([value]) => value);

/** A list's values in words for Claude, leaving out a blank, which a sentence says on its own. */
const list = (options: readonly (readonly [string, ...string[]])[]) =>
  values(options).filter(Boolean);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Throws unless the input gives something, and only the fields it may. */
function givenOnly(input: Record<string, unknown>, allowed: readonly string[], what: string) {
  const keys = Object.keys(input);
  if (keys.length === 0) throw new Error(`Give what to change in ${what}: ${allowed.join(', ')}.`);
  const other = keys.find((key) => !allowed.includes(key));
  if (other) {
    throw new Error(
      `${other} isn’t part of ${what}, so it isn’t saved. Give ${allowed.join(', ')}.`,
    );
  }
}

/** The fields of an object that are among some keys, as they were given. */
const pickFrom = (input: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(input).filter(([key]) => keys.includes(key)));

/** A change as words for Claude's reply: a list joined, a yes or no said, and blank said. */
function saidAs(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ') || 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value ?? '').trim() || 'blank';
}

/** The reply a save gives, naming what it saved, by each field's label. */
function saved(items: readonly [string, unknown][]): string {
  if (items.length === 0) return 'Nothing to save: nothing changed.';
  return `Saved to the user’s Profile: ${items.map(([label, value]) => `${label}: ${saidAs(value)}`).join('; ')}.`;
}

/** Answers checked as the window's own, or an error that says what to fix. */
function checked(raw: Record<string, unknown>, what: string): AnswerChanges {
  const changes = parseAnswerChanges(raw);
  if (!changes) {
    throw new Error(
      `Not saved: something in ${what} doesn’t hold up. Give lists as lists of short text, keep to the values this tool lists, and keep each answer short. Nothing was changed.`,
    );
  }
  return changes;
}

const CONTACT_LABELS: Readonly<Record<keyof Contact, string>> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  location: 'Where they live',
  linkedin: 'LinkedIn',
  website: 'Website',
};

/**
 * A number and a word, as a street starts, or a postal code. Where they live is kept to a city and
 * state, and these are kept on this computer alone, so a run never saves one where it would sync.
 */
const STREET_OR_POSTAL =
  /(?:^|[\s,])\d{1,6}\s+\p{L}|\b\d{5}(?:-\d{4})?\b|\b\p{Lu}\d\p{Lu}\s?\d\p{Lu}\d\b|\b\p{Lu}{1,2}\d[\p{Lu}\d]?\s\d\p{Lu}{2}\b/u;

/** Throws when an answer about where the user lives looks like a street or a postal code. */
function noStreet(input: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && STREET_OR_POSTAL.test(value)) {
      throw new Error(
        `Not saved: ${key} looks like it has a street or a postal code, which stay on this computer, and Claude never saves them. Give the city and state alone, and tell the user they change those themselves, in For applications’ Change.`,
      );
    }
  }
}

/** About you: the user's name and contact details, a field at a time. Blank clears one. */
export function saveContact(
  input: Record<string, unknown>,
  about: Pick<PartAbout, 'answers' | 'saveAnswers'>,
  call: ToolCall | undefined,
): string {
  givenOnly(input, Object.keys(CONTACT_LABELS), 'About you');
  if (Object.values(input).some((value) => typeof value !== 'string')) {
    throw new Error('Not saved: give each detail as text.');
  }
  const given = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, (value as string).trim()]),
  );
  if (given.name === '') throw new Error('Not saved: their name can’t be blank.');
  noStreet(given, ['location']);
  const { you } = about.answers();
  about.saveAnswers(checked({ you: { ...you, ...given } }, 'About you'), call?.keep);
  return saved(
    Object.entries(given).map(([key, value]) => [CONTACT_LABELS[key as keyof Contact], value]),
  );
}

/** The labels of What you want's answers, for a save's reply. */
const WANT_LABELS: Readonly<Record<string, string>> = {
  roles: 'Titles',
  fields: 'Kinds of work',
  levels: 'Levels',
  minPay: 'Lowest base pay',
  targetPay: 'Target base pay',
  payFilter: 'Leave out jobs that list less',
  workplaces: 'How they’d work',
  remoteFrom: 'Remote from',
  places: 'Cities',
  relocate: 'Relocating',
  companies: 'Kinds of company',
  industries: 'Industries they’d love',
  avoid: 'Industries they won’t work in',
  employment: 'Kinds of employment',
  authorization: 'Work authorization',
  start: 'When they can start',
  mustHaves: 'Must-haves',
  dealBreakers: 'Deal-breakers',
  quiet: 'Keep their search quiet',
};

/** What each kind of job has of its own. */
const KIND_FIELDS = ['roles', 'fields', 'levels', 'minPay', 'targetPay', 'payFilter'];

/** What holds for every kind of job. */
const SHARED_WANTS = Object.keys(WANT_LABELS).filter((key) => !KIND_FIELDS.includes(key));

/**
 * What you want, or one kind of job: answers each replaced whole, a kind's own going to the kind
 * named, and the kinds themselves added, renamed and removed, as the window changes them, so
 * nothing changes that this doesn't name. A run on one kind of job changes only that kind's own.
 */
export function saveWhatYouWant(
  input: Record<string, unknown>,
  about: Pick<PartAbout, 'answers' | 'saveAnswers'>,
  call: ToolCall | undefined,
): string {
  const bound = call?.scope === 'part:kind' ? boundKind(call) : null;
  const allowed = bound
    ? [...KIND_FIELDS, 'kind', 'name']
    : [...KIND_FIELDS, ...SHARED_WANTS, 'kind', 'name', 'addKinds', 'firstKindName', 'removeKinds'];
  givenOnly(input, allowed, bound ? 'this kind of job' : 'What you want');
  const current = about.answers();
  const named = typeof input.kind === 'string' ? input.kind : (bound ?? null);
  if (bound && named !== bound) {
    throw new Error(`Not saved: this run is on the kind of job \`${bound}\`, and nothing else.`);
  }
  const own = pickFrom(input, KIND_FIELDS);
  const renames = input.name !== undefined;
  if ((Object.keys(own).length > 0 || renames) && hasKinds(current) && named === null) {
    const ids = kindsOf(current).map((kind) => kind.id);
    throw new Error(
      `Not saved: they want more than one kind of job, so give kind, the one this is for: ${ids.join(', ')}.`,
    );
  }
  const kinds = kindsOf(current);
  const kind = named === null ? kinds[0] : kinds.find((each) => each.id === named);
  if (!kind) throw new Error(`Not saved: they have no kind of job \`${String(named)}\`.`);

  const lines: [string, unknown][] = [];
  let working = current;
  let changes: AnswerChanges = {};
  const add = (more: AnswerChanges) => {
    changes = mergeChanges(changes, more);
    working = applyChanges(working, more);
  };
  const shared = pickFrom(input, SHARED_WANTS);
  add(checked(shared, 'What you want'));
  for (const [key, value] of Object.entries(shared)) lines.push([WANT_LABELS[key] ?? key, value]);
  if (Object.keys(own).length > 0) {
    add(changeKind(working, kind.id, checked(own, 'this kind of job')));
    const of = hasKinds(current) ? ` for ${kind.name}` : '';
    for (const [key, value] of Object.entries(own)) {
      lines.push([`${WANT_LABELS[key] ?? key}${of}`, value]);
    }
  }
  if (renames) {
    if (typeof input.name !== 'string') throw new Error('Not saved: give the kind’s name as text.');
    if (!hasKinds(current)) {
      throw new Error(
        'Not saved: with one kind of job, it has no name. A name comes with a second.',
      );
    }
    const edit = renameKind(working, kind.id, input.name);
    if (!edit.ok) throw new Error(`Not saved: ${edit.message}`);
    add(edit.changes);
    lines.push([`${kind.name}, now called`, input.name]);
  }
  for (const each of asList(input.addKinds, 'addKinds')) {
    if (!isRecord(each) || typeof each.name !== 'string') {
      throw new Error('Not saved: give each kind in addKinds a name.');
    }
    const edit = addKind(
      working,
      each.name,
      typeof input.firstKindName === 'string' ? input.firstKindName : '',
    );
    if (!edit.ok) throw new Error(`Not saved: ${edit.message}`);
    add(edit.changes);
    const id = edit.changes.addedKinds?.[0]?.id ?? '';
    const { name: _, ...fields } = each;
    givenOnly({ name: each.name, ...fields }, ['name', ...KIND_FIELDS], 'a new kind of job');
    if (Object.keys(fields).length > 0) add(changeKind(working, id, checked(fields, 'a new kind')));
    lines.push(['New kind of job', `${each.name} (\`${id}\`)`]);
  }
  for (const id of asList(input.removeKinds, 'removeKinds')) {
    const edit = typeof id === 'string' ? removeKind(working, id) : {};
    if (Object.keys(edit).length === 0) {
      throw new Error(
        `Not saved: \`${String(id)}\` isn’t a kind of job that can go. The first stays.`,
      );
    }
    add(edit);
    lines.push(['Removed kind of job', id]);
  }
  about.saveAnswers(changes, call?.keep);
  return saved(lines);
}

/** The kind of job a run on one kind was started for. */
function boundKind(call: ToolCall): string {
  const held = call.changes;
  if (!held || !('part' in held) || !held.kind) {
    throw new Error('Not saved: this run wasn’t started for a kind of job.');
  }
  return held.kind;
}

const asList = (value: unknown, name: string): unknown[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Not saved: give ${name} as a list.`);
  return value;
};

const APPLICATION_LABELS: Readonly<Record<string, string>> = {
  preferredName: 'Preferred first name',
  pronouns: 'Pronouns',
  city: 'City',
  region: 'State or region',
  country: 'Country',
  github: 'GitHub',
  howHeard: 'How they heard about a job',
  leaving: 'Why they’re leaving',
  countries: 'Countries they can work in without a visa',
  sponsorship: 'Visa sponsorship',
  over18: '18 or older',
};

/** What stays on this computer, by any name Claude might give it. */
const KEPT_APART =
  /^(?:street|address|postal|zip|equal|eeo|gender|hispanic|latino|race|ethnicity|veteran|disability)/i;

/**
 * For applications: what forms ask that a resume doesn't say, a field at a time, over what's there.
 * A run on why the user's leaving changes that alone. Their street, postal code and
 * equal-opportunity answers aren't here: they're kept on this computer alone, so this turns them
 * away, by name, rather than save them where they'd sync.
 */
export function saveForApplications(
  input: Record<string, unknown>,
  about: Pick<PartAbout, 'answers' | 'saveAnswers'>,
  call: ToolCall | undefined,
): string {
  const apart = Object.keys(input).find((key) => KEPT_APART.test(key));
  if (apart) {
    throw new Error(
      'Not saved: street, postal code and equal-opportunity answers stay on this computer, and Claude never sees or saves them. Tell the user they change those themselves, in For applications’ Change.',
    );
  }
  const leavingOnly = call?.scope === 'part:leaving';
  const allowed = leavingOnly ? ['leaving'] : Object.keys(APPLICATION_LABELS);
  givenOnly(input, allowed, leavingOnly ? 'why they’re leaving' : 'For applications');
  noStreet(input, ['city', 'region', 'country']);
  const { applications } = about.answers();
  const read = readForApplications({ ...applications, ...input });
  if (!read) {
    throw new Error(
      `Not saved: keep each line under ${ANSWER_LIMITS.line} characters and why they’re leaving under 1,000, give countries as a list, sponsorship as ${list(SPONSORSHIP).join(', ')} or blank, and over18 as ${list(OVER_18).join(', ')} or blank.`,
    );
  }
  about.saveAnswers(checked({ applications: read }, 'For applications'), call?.keep);
  return saved(
    Object.entries(input).map(([key, value]) => [APPLICATION_LABELS[key] ?? key, value]),
  );
}

const BEYOND_LABELS: Readonly<Record<string, string>> = {
  interests: 'Interests and hobbies',
  learning: 'What they’re learning',
  communities: 'Communities',
  cares: 'What they care about',
  interestsOnResumes: 'A line of their interests on resumes',
};

/**
 * Beyond work: who they are outside work, each answer replaced whole, so one can go, how projects
 * look, a choice at a time, and the projects themselves added, changed by their ids and removed,
 * as the window changes them. A project added gets its id here.
 */
export function saveBeyondWork(
  input: Record<string, unknown>,
  about: Pick<PartAbout, 'answers' | 'saveAnswers'>,
  call: ToolCall | undefined,
): string {
  const parts = ['addProjects', 'changeProjects', 'removeProjects', 'projectPrefs'];
  givenOnly(input, [...Object.keys(BEYOND_LABELS), ...parts], 'Beyond work');
  const current = about.answers();
  const lines: [string, unknown][] = [];
  const taken = current.projects.map((project) => project.id);
  const names = new Map(current.projects.map((project) => [project.id, project.name]));
  const known = (id: unknown): string => {
    if (typeof id === 'string' && names.has(id)) return names.get(id) || id;
    throw new Error(`Not saved: they have no project \`${String(id)}\`. about_you lists each id.`);
  };
  const added = asList(input.addProjects, 'addProjects').map((each) => {
    if (!isRecord(each) || typeof each.name !== 'string' || !each.name.trim()) {
      throw new Error('Not saved: give each project in addProjects a name.');
    }
    givenOnly(each, Object.keys(PROJECT_FIELDS), 'a project');
    const id = projectIdFor(each.name, taken);
    taken.push(id);
    lines.push(['New project', each.name.trim()]);
    return { ...newProject(id), ...each, id, name: each.name.trim() };
  });
  const left = taken.length - new Set(asList(input.removeProjects, 'removeProjects')).size;
  if (left > BEYOND_LIMITS.projects) {
    throw new Error(
      `Not saved: that’s more than the ${BEYOND_LIMITS.projects} projects Factwright keeps.`,
    );
  }
  for (const each of asList(input.changeProjects, 'changeProjects')) {
    const id = isRecord(each) ? each.id : undefined;
    lines.push(['Changed project', known(id)]);
  }
  for (const id of asList(input.removeProjects, 'removeProjects')) {
    lines.push(['Removed project', known(id)]);
  }
  const raw: Record<string, unknown> = pickFrom(input, Object.keys(BEYOND_LABELS));
  for (const [key, value] of Object.entries(raw)) lines.push([BEYOND_LABELS[key] ?? key, value]);
  if (added.length > 0) raw.addedProjects = added;
  if (input.changeProjects !== undefined) raw.projectChanges = input.changeProjects;
  if (input.removeProjects !== undefined) raw.removedProjects = input.removeProjects;
  if (input.projectPrefs !== undefined) {
    raw.projectPrefs = projectPrefsFrom(input.projectPrefs, current.projectPrefs);
    lines.push(['How projects look', JSON.stringify(input.projectPrefs)]);
  }
  about.saveAnswers(checked(raw, 'Beyond work'), call?.keep);
  return saved(lines);
}

/** Choices about how projects look, over what's there, with none left out for not holding up. */
function projectPrefsFrom(given: unknown, current: ProjectPrefs): ProjectPrefs {
  if (!isRecord(given)) throw new Error('Not saved: give projectPrefs as an object.');
  const read = readProjectPrefs({ ...current, ...given });
  const fits =
    read !== undefined &&
    Object.entries(given).every(
      ([key, value]) => (read as unknown as Record<string, unknown>)[key] === value,
    );
  if (!read || !fits) {
    throw new Error(
      `Not saved: projectPrefs takes resumes (${list(RESUME_PLACES).join(', ')}), heading (up to ${BEYOND_LIMITS.heading} characters), detail (${list(PROJECT_DETAIL).join(', ')}), links, numbers and tools (yes or no), and page (${list(PAGE_SHAPE_CHOICES).join(', ')}).`,
    );
  }
  return read;
}

/**
 * Resume templates: which the user picked and for what, how long resumes run, and which files
 * they come as. A template's own look goes through save_template. Only one the app has can be
 * picked.
 */
export function saveResumeChoices(
  input: Record<string, unknown>,
  about: Pick<PartAbout, 'answers' | 'saveAnswers'>,
  templates: Pick<TemplateLibrary, 'list'>,
  call: ToolCall | undefined,
): string {
  givenOnly(input, ['looks', 'pages', 'format'], 'Resume templates');
  const changes = checked(input, 'Resume templates');
  const known = templates.list().map((template) => template.id);
  const unknown = changes.looks?.find((look) => !known.includes(look.layout));
  if (unknown) {
    throw new Error(
      `Not saved: there’s no template \`${unknown.layout}\`. They have: ${known.join(', ')}.`,
    );
  }
  about.saveAnswers(changes, call?.keep);
  const lines: [string, unknown][] = [];
  if (changes.looks) {
    lines.push(['Templates', changes.looks.map((look) => `${look.layout} for ${look.for}`)]);
  }
  if (changes.pages !== undefined) {
    const length = { 1: 'one page', 2: 'up to two pages' } as const;
    lines.push(['Length', changes.pages === null ? 'by their level' : length[changes.pages]]);
  }
  if (changes.format) lines.push(['Files', labelOf(RESUME_FILES, changes.format)]);
  return saved(lines);
}

/**
 * Adds to the user's notes, which later runs read as their own words, so what goes in is words they
 * typed for this run, or answered in it, and nothing Claude wrote or read. It adds and never
 * changes what's there.
 */
export function addToNotes(
  input: Record<string, unknown>,
  about: Pick<PartAbout, 'addToNotes'>,
  call: ToolCall | undefined,
): string {
  const { text } = input;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Give the text to add.');
  if (!call?.questions.said(text)) {
    throw new Error(
      'Not saved: notes hold the user’s own words, so give the words as they typed them for this run, or answered you in it, without rewording them.',
    );
  }
  const added = about.addToNotes(text.trim(), call.keep);
  if (!added) throw new Error('Not saved: their notes are as long as Factwright keeps.');
  return `Added to the user’s notes: “${text.trim()}”.`;
}

/**
 * Adds to the names to keep off what the user sends, which only makes the resume check stricter, and
 * so any part's run that hears one may. Taking one off makes it less strict, so only a run on What
 * you've shared may, when the user asks.
 */
export function keepNamesPrivate(
  input: Record<string, unknown>,
  about: Pick<PartAbout, 'changeConfidential'>,
  call: ToolCall | undefined,
): string {
  givenOnly(input, ['add', 'remove'], 'the names to keep private');
  const names = (value: unknown): string[] =>
    asList(value, 'the names').map((name) => {
      if (typeof name !== 'string' || !name.trim() || name.length > ANSWER_LIMITS.entry) {
        throw new Error(
          `Not saved: give each name as text, of ${ANSWER_LIMITS.entry} characters or fewer.`,
        );
      }
      return name.trim();
    });
  const add = names(input.add);
  const remove = names(input.remove);
  if (remove.length > 0 && call?.scope !== 'part:shared') {
    throw new Error('Not saved: only a run on What you’ve shared takes a name off the list.');
  }
  about.changeConfidential({ add, remove }, call?.keep);
  return saved([
    ...(add.length > 0 ? ([['Names kept private, added', add]] as [string, unknown][]) : []),
    ...(remove.length > 0
      ? ([['Names kept private, taken off', remove]] as [string, unknown][])
      : []),
  ]);
}

/** What a part holds now, as Claude reads it to change it, with each id and value exact. */
function partNow(part: ProfilePart, kind: string | undefined, about: PartAbout): unknown {
  const answers = about.answers();
  const pick = <K extends keyof AboutYou>(keys: readonly K[]) =>
    Object.fromEntries(keys.map((key) => [key, answers[key]]));
  switch (part) {
    case 'about':
      return answers.you;
    case 'wants':
      return {
        kinds: kindsOf(answers),
        ...pick([
          'workplaces',
          'remoteFrom',
          'places',
          'relocate',
          'companies',
          'industries',
          'avoid',
          'employment',
          'authorization',
          'start',
          'mustHaves',
          'dealBreakers',
          'quiet',
        ]),
      };
    case 'kind':
      return kindsOf(answers).find((each) => each.id === kind) ?? null;
    case 'applications':
      return answers.applications;
    case 'leaving':
      return { leaving: answers.applications.leaving };
    case 'beyond':
      return pick([
        'projects',
        'projectPrefs',
        'interests',
        'learning',
        'communities',
        'cares',
        'interestsOnResumes',
      ]);
    case 'history':
      return about.history();
    case 'templates':
      return pick(['looks', 'pages', 'format', 'companies']);
    case 'shared':
      return {
        files: answers.files.map(({ name, kind: what }) => ({ name, kind: what })),
        namesKeptPrivate: about.confidential(),
        notes: 'about-me/notes.md, which you read but never edit',
      };
    default:
      return null;
  }
}

/** What each part's run makes the changes with, in a line. */
const HOW: Readonly<Record<ProfilePart, string>> = {
  about: 'Make them with save_contact.',
  wants: 'Make them with save_what_you_want.',
  kind: 'Make them with save_what_you_want, for this kind alone.',
  applications: 'Make them with save_for_applications.',
  leaving: 'Make them with save_for_applications, with leaving alone.',
  beyond: 'Make them with save_beyond_work.',
  history:
    'Make them with save_work_history, which takes everything, whole, in place of what’s there. What they typed goes in as they said it, even where the facts don’t have it.',
  resumes:
    'Make them in the starting resumes in base/, from verified facts, and build each one again.',
  templates: 'Make them with save_resume_choices, and save_template for a template’s own look.',
  facts: `File them with the fact tools. To save what they typed, give “${CHANGES_QUESTION}” as the question, word for word: their words are their answer to it.`,
  shared:
    'Add to their notes with add_to_notes, and change the names kept private with keep_names_private.',
};

/**
 * The changes the user asked for in a part of Profile, for the run started to make them, with what
 * the part holds now. They typed them in the app, and they reach the run here, never as words typed
 * into it.
 */
export function profileChangesText(changes: BoundProfileChanges, about: PartAbout): string {
  const now = partNow(changes.part, changes.kind, about);
  const criteria =
    (changes.part === 'wants' || changes.part === 'kind') && about.criteriaIsOwn()
      ? 'Their search criteria file, searches/criteria.md, is one they changed by hand, so these answers don’t change it. Say so in your reply: What you want has a button to use these answers instead.'
      : '';
  return [
    `# Changes to ${changes.kind ? `the kind of job \`${changes.kind}\`` : PART_NAMES[changes.part]} in the user’s Profile`,
    `The user typed these in the app for this run, in their own words. ${HOW[changes.part]} Change only what they asked for, and nothing else.`,
    ...(criteria ? [criteria] : []),
    '',
    '## What the user asked for',
    // Each line quoted, so nothing in it can start a part of its own.
    ...changes.changes.split(/\r?\n/).map((line) => `> ${line}`),
    ...(now === null
      ? []
      : ['', '## What’s there now', '```json', JSON.stringify(now, null, 2), '```']),
  ].join('\n');
}

/** The tools' inputs, as JSON Schema. */

const text = (description: string) => ({ type: 'string', description });
const short = { type: 'string' };
const manyOf = (values: readonly string[], description: string) => ({
  type: 'array',
  items: { type: 'string', enum: values },
  description,
});
const lines = (description: string) => ({ type: 'array', items: short, description });

const KIND_PROPERTIES = {
  roles: lines('Every job title they want, whole, in place of what’s there.'),
  fields: manyOf(list(FIELDS), 'Every kind of work they want, whole.'),
  levels: manyOf(list(LEVELS), 'Every level they’d take, whole.'),
  minPay: text('The least base pay they’d take, as they say it, such as “$120,000”.'),
  targetPay: text('The base pay they’re aiming for, as they say it.'),
  payFilter: {
    type: 'boolean',
    description: 'Whether jobs listing less than minPay are left out.',
  },
};

const PROJECT_FIELDS = {
  name: short,
  kind: { type: 'string', enum: list(PROJECT_KINDS) },
  what: text('What it is, in a line or two, in their words.'),
  role: text('Their part in it, such as “Built it alone”.'),
  under: text('A company or group it’s part of.'),
  status: { type: 'string', enum: values(PROJECT_STATUSES) },
  when: text('When, as they say it, such as “2023 to now”.'),
  links: lines('Its website, store page or repository.'),
  results: text('What they can count or point to, as they said it.'),
  skills: lines('The skills and tools it took.'),
  showing: {
    type: 'string',
    enum: list(PROJECT_SHOWING),
    description: 'feature, fit or private: private never goes on anything they send.',
  },
};

export const CONTACT_SCHEMA = {
  type: 'object',
  properties: {
    name: text('Their name, as the top of their resumes should read.'),
    email: short,
    phone: short,
    location: text('Where they live, such as “Denver, CO”.'),
    linkedin: text('Their LinkedIn profile’s link.'),
    website: short,
  },
  additionalProperties: false,
};

export const WANTS_SCHEMA = {
  type: 'object',
  properties: {
    kind: text(
      'The kind of job roles, fields, levels, pay and name are for, by its id, when they want more than one.',
    ),
    ...KIND_PROPERTIES,
    name: text('A new name for the kind. Its id stays.'),
    workplaces: manyOf(list(WORKPLACES), 'How they’d work, whole.'),
    remoteFrom: text('Where they can work remotely from.'),
    places: lines('Cities for hybrid or on-site work, whole.'),
    relocate: { type: 'string', enum: values(RELOCATE), description: 'Blank for not sure yet.' },
    companies: manyOf(list(COMPANY_KINDS), 'Kinds of company, whole.'),
    industries: lines('Industries they’d love, whole.'),
    avoid: lines('Industries they won’t work in, whole.'),
    employment: manyOf(list(EMPLOYMENT), 'Kinds of employment, whole.'),
    authorization: text('Whether they can work where the jobs are.'),
    start: text('When they can start.'),
    mustHaves: text('What a job must have, in their words, in place of what’s there.'),
    dealBreakers: text('What rules a job out, in their words, in place of what’s there.'),
    quiet: { type: 'boolean', description: 'Whether their employer mustn’t find out.' },
    addKinds: {
      type: 'array',
      description: 'Kinds of job to add, each with a name, and any of its own answers.',
      items: {
        type: 'object',
        properties: { name: short, ...KIND_PROPERTIES },
        required: ['name'],
        additionalProperties: false,
      },
    },
    firstKindName: text(
      'With the first kind added, what to call the jobs they have so far, such as “Developer”.',
    ),
    removeKinds: lines('Kinds to remove, by id. Their jobs go under the first, which stays.'),
  },
  additionalProperties: false,
};

export const APPLICATIONS_SCHEMA = {
  type: 'object',
  properties: {
    preferredName: text('The first name they go by, if it isn’t the one on their resume.'),
    pronouns: text('Such as “she/her”.'),
    city: short,
    region: text('Their state or region, such as “CO”.'),
    country: short,
    github: text('Such as github.com/their-name.'),
    howHeard: text('What to say to “How did you hear about us?” when it’s not known.'),
    leaving: text('Why they’re leaving, or left, up to 1,000 characters.'),
    countries: lines('Countries they can work in without a visa, whole.'),
    sponsorship: {
      type: 'string',
      enum: values(SPONSORSHIP),
      description: 'Blank leaves it for them.',
    },
    over18: { type: 'string', enum: values(OVER_18), description: 'Blank leaves it for them.' },
  },
  additionalProperties: false,
};

export const BEYOND_SCHEMA = {
  type: 'object',
  properties: {
    addProjects: {
      type: 'array',
      description: 'Projects to add. A new one’s id is made from its name.',
      items: {
        type: 'object',
        properties: PROJECT_FIELDS,
        required: ['name'],
        additionalProperties: false,
      },
    },
    changeProjects: {
      type: 'array',
      description: 'Changes to projects, each by its id, with only what changes.',
      items: {
        type: 'object',
        properties: { id: short, ...PROJECT_FIELDS },
        required: ['id'],
        additionalProperties: false,
      },
    },
    removeProjects: lines('Projects to remove, by id.'),
    projectPrefs: {
      type: 'object',
      description: 'How projects look on resumes and a Projects page, with only what changes.',
      properties: {
        resumes: { type: 'string', enum: list(RESUME_PLACES) },
        heading: text('The section’s heading, or blank to name it for each job.'),
        detail: { type: 'string', enum: list(PROJECT_DETAIL) },
        links: { type: 'boolean' },
        numbers: { type: 'boolean' },
        tools: { type: 'boolean' },
        page: { type: 'string', enum: list(PAGE_SHAPE_CHOICES) },
      },
      additionalProperties: false,
    },
    interests: lines('Interests and hobbies, whole, in place of what’s there.'),
    learning: lines('What they’re learning, whole.'),
    communities: lines('Communities they’re part of, whole.'),
    cares: text('What they care about, in their words, in place of what’s there.'),
    interestsOnResumes: {
      type: 'string',
      enum: list(INTERESTS_ON_RESUMES),
      description: 'Whether resumes get a line of their interests.',
    },
  },
  additionalProperties: false,
};

export const CHOICES_SCHEMA = {
  type: 'object',
  properties: {
    looks: {
      type: 'array',
      description: 'Every template they pick, whole, each for a kind of company or any job.',
      items: {
        type: 'object',
        properties: {
          layout: text('The template’s ID, from list_templates.'),
          for: { type: 'string', enum: [...list(COMPANY_KINDS), 'any'] },
        },
        required: ['layout', 'for'],
        additionalProperties: false,
      },
    },
    pages: {
      type: ['number', 'null'],
      enum: [1, 2, null],
      description: 'Null goes by their level.',
    },
    format: { type: 'string', enum: list(RESUME_FILES) },
  },
  additionalProperties: false,
};
