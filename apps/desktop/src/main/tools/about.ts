import {
  type AboutYou,
  type AnswerChanges,
  COMPANY_KINDS,
  type Contact,
  EMPLOYMENT,
  FIELDS,
  type KindAnswers,
  LEVELS,
  labelOf,
  parseAnswerChanges,
  RELOCATE,
  WORKPLACES,
} from '../../shared/about.ts';
import {
  INTERESTS_ON_RESUMES,
  labelIn,
  PAGE_SHAPE_CHOICES,
  PROJECT_DETAIL,
  PROJECT_KINDS,
  PROJECT_SHOWING,
  PROJECT_STATUSES,
  type ProjectPrefs,
} from '../../shared/beyond.ts';
import { changeKind, hasKinds, kindsOf } from '../../shared/kinds.ts';

/** Indents a text's later lines under its first, to keep a list item whole. */
const indented = (text: string) => text.trim().split(/\r?\n/).join('\n    ');

/** How projects show on resumes, in words, as the skills read it. */
function placementText(prefs: ProjectPrefs): string {
  if (prefs.resumes === 'off') return 'left off';
  const where =
    prefs.resumes === 'experience'
      ? 'listed as experience, like jobs (projects with one “part of” name show as one job under it)'
      : `in a section of their own${prefs.heading.trim() ? `, headed “${prefs.heading.trim()}”` : ', headed as fits the field'}`;
  const shown = [
    prefs.links && 'its link',
    prefs.numbers && 'its numbers',
    prefs.tools && 'its tools',
  ].filter((each): each is string => Boolean(each));
  return `${where}; each gets ${labelIn(PROJECT_DETAIL, prefs.detail).toLowerCase()}${shown.length > 0 ? ` and shows ${shown.join(', ')}` : ''}`;
}

/**
 * Beyond work in words: each project in a line, how projects show on resumes, and the user
 * outside work. A project's own overview, with its numbers and tools, is in its file.
 */
function beyondText(answers: AboutYou): string[] {
  const lines: string[] = [];
  if (answers.projects.length > 0) {
    lines.push(
      '- Projects and other work outside a job, from Beyond work in their Profile. Their own overview of each, with its numbers and tools, is in about-me/beyond-work.json; what goes out comes only from facts/projects.md:',
    );
    for (const project of answers.projects) {
      const about = [
        labelIn(PROJECT_KINDS, project.kind),
        project.under.trim() && `part of ${project.under.trim()}`,
        project.status && labelIn(PROJECT_STATUSES, project.status).toLowerCase(),
        project.when.trim(),
      ].filter(Boolean);
      const show =
        project.showing === 'private'
          ? 'private: never in anything that goes out'
          : `${labelIn(PROJECT_SHOWING, project.showing).toLowerCase()}`;
      const extra = [
        project.role.trim() && `Their part: ${project.role.trim()}`,
        project.links.length > 0 && `Links: ${project.links.join(', ')}`,
      ].filter(Boolean);
      lines.push(
        `    - ${project.name.trim() || 'A project with no name yet'} (\`${project.id}\`): ${about.join(', ')}. Show it: ${show}.${extra.length > 0 ? ` ${extra.join('. ')}.` : ''}`,
      );
    }
    lines.push(
      `- How projects show on their resumes: ${placementText(answers.projectPrefs)}. A job’s own choice, in its job.md, wins.`,
      `- A Projects page, when they make one for a job: ${labelIn(PAGE_SHAPE_CHOICES, answers.projectPrefs.page).toLowerCase()} (\`${answers.projectPrefs.page}\`).`,
    );
  }
  const item = (label: string, value: string) => {
    if (value.trim()) lines.push(`- ${label}: ${indented(value)}`);
  };
  item('Interests and hobbies', answers.interests.join('; '));
  item('What they’re learning', answers.learning.join('; '));
  item('Communities they’re part of', answers.communities.join('; '));
  item('What they care about', answers.cares);
  if (answers.interests.length > 0) {
    item(
      'A line of their interests on resumes',
      labelIn(INTERESTS_ON_RESUMES, answers.interestsOnResumes).toLowerCase(),
    );
  }
  return lines;
}

/**
 * What the user told Factwright about themselves, when they started and in Profile since, in
 * words: who they are, what they're looking for, pay, and the answers application forms ask for.
 */
export function aboutYouText(answers: AboutYou): string {
  const lines: string[] = [];
  const item = (label: string, value: string | null | undefined, under = '') => {
    if (value?.trim()) lines.push(`${under}- ${label}: ${indented(value)}`);
  };
  const list = <T extends string>(
    options: readonly (readonly [T, string, ...string[]])[],
    values: readonly T[],
  ) => values.map((value) => labelOf(options, value)).join(', ');
  const pay = (kind: KindAnswers, under = '') => {
    item('Target base pay', kind.targetPay, under);
    item(
      'Lowest base pay they’d take',
      kind.minPay && `${kind.minPay}${kind.payFilter ? ' (jobs paying less are left out)' : ''}`,
      under,
    );
  };
  const kinds = hasKinds(answers) ? kindsOf(answers) : null;

  const { you } = answers;
  item('Name', you.name);
  item('Email', you.email);
  item('Phone', you.phone);
  item('Location', you.location);
  item('LinkedIn', you.linkedin);
  item('Website', you.website);
  if (kinds) {
    lines.push(
      `- Kinds of job they want: ${kinds.map((kind) => `${kind.name} (\`${kind.id}\`)`).join(', ')}. Each has its own roles, kinds of work, levels and pay; the rest holds for every kind.`,
    );
    for (const kind of kinds) {
      lines.push(`- ${kind.name} (\`${kind.id}\`):`);
      const before = lines.length;
      item('Roles they want', kind.roles.join('; '), '    ');
      item('Kinds of work', list(FIELDS, kind.fields), '    ');
      item('Levels', list(LEVELS, kind.levels), '    ');
      pay(kind, '    ');
      if (lines.length === before) lines.push('    - Nothing told yet.');
    }
  } else {
    item('Roles they want', answers.roles.join('; '));
    item('Kinds of work', list(FIELDS, answers.fields));
    item('Levels', list(LEVELS, answers.levels));
  }
  item('Where they’ll work', list(WORKPLACES, answers.workplaces));
  item('Remote from', answers.remoteFrom);
  item('Cities for hybrid or on-site work', answers.places.join('; '));
  item('Relocating', answers.relocate && labelOf(RELOCATE, answers.relocate));
  item('Kinds of company', list(COMPANY_KINDS, answers.companies));
  item('Industries they’d love', answers.industries.join('; '));
  item('Industries they won’t work in', answers.avoid.join('; '));
  item('Employment', list(EMPLOYMENT, answers.employment));
  if (!kinds) pay(answers);
  item('Work authorization', answers.authorization);
  item('When they can start', answers.start);
  item('Must-haves', answers.mustHaves);
  item('Deal-breakers', answers.dealBreakers);
  if (answers.quiet) {
    lines.push(
      '- Their search is quiet: they’re employed, and their employer mustn’t find out they’re looking.',
    );
  }
  lines.push(...beyondText(answers));
  if (lines.length === 0) {
    return [
      'The user hasn’t told Factwright about themselves yet.',
      'Look in facts/profile.md and searches/criteria.md, and ask them for anything else. When they tell you something an application asks for again, such as their work authorization or when they can start, save it with save_about_you.',
    ].join('\n');
  }
  return [
    '## What the user told Factwright about themselves',
    'From getting started and their Profile. Use it before asking them, and save anything new they tell you that applications ask for with save_about_you.',
    ...lines,
  ].join('\n');
}

/** The contact details save_about_you takes, beside the answers below. */
const CONTACT_FIELDS = ['email', 'phone', 'location', 'linkedin', 'website'] as const;

/** The parts of the user outside work save_about_you adds to, a list each. */
const LIST_ANSWERS = ['interests', 'learning', 'communities'] as const;

/** The answers save_about_you takes: the ones application forms and people ask about. */
export const SAVABLE_ANSWERS = [
  'authorization',
  'start',
  'relocate',
  'targetPay',
  'minPay',
  ...CONTACT_FIELDS,
  ...LIST_ANSWERS,
  'cares',
] as const;

/** The labels of the answers save_about_you saved, for its reply. */
const LABELS: Readonly<Record<(typeof SAVABLE_ANSWERS)[number], string>> = {
  authorization: 'Work authorization',
  start: 'When they can start',
  relocate: 'Relocating',
  targetPay: 'Target base pay',
  minPay: 'Lowest base pay they’d take',
  email: 'Email',
  phone: 'Phone',
  location: 'Location',
  linkedin: 'LinkedIn',
  website: 'Website',
  interests: 'Interests and hobbies, added',
  learning: 'What they’re learning, added',
  communities: 'Communities they’re part of, added',
  cares: 'What they care about',
};

/** The answers each kind of job has its own of, which save_about_you saves for one kind. */
const PAY_ANSWERS: readonly string[] = ['targetPay', 'minPay'];
const isPay = (key: string) => PAY_ANSWERS.includes(key);

/**
 * The changes save_about_you was asked to make, checked like the window's own, with contact
 * details joining the ones on file. Pay goes to the kind of job named, or the first. Null when
 * any doesn't hold up, so nothing is half saved.
 */
export function aboutYouChanges(
  input: Record<string, unknown>,
  current: AboutYou,
): { changes: AnswerChanges; saved: string[] } | null {
  const { kind: kindId, ...given } = input;
  const keys = Object.keys(given);
  if (keys.length === 0) return null;
  if (keys.some((key) => !(SAVABLE_ANSWERS as readonly string[]).includes(key))) return null;
  const kinds = kindsOf(current);
  const pays = keys.some(isPay);
  // With more than one kind of job, pay is each kind's own, so it has to say which.
  if (pays && hasKinds(current) && kindId === undefined) return null;
  const kind = kindId === undefined ? kinds[0] : kinds.find((each) => each.id === kindId);
  if (!kind || (kindId !== undefined && !pays)) return null;
  const raw: Record<string, unknown> = {};
  const contact: Partial<Contact> = {};
  for (const key of keys) {
    const value = given[key];
    if ((LIST_ANSWERS as readonly string[]).includes(key)) {
      // Added to what's there, so nothing told before is lost.
      if (!Array.isArray(value) || value.length === 0) return null;
      if (value.some((each) => typeof each !== 'string')) return null;
      raw[key] = [...current[key as (typeof LIST_ANSWERS)[number]], ...(value as string[])];
      continue;
    }
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if ((CONTACT_FIELDS as readonly string[]).includes(key)) {
      contact[key as (typeof CONTACT_FIELDS)[number]] = trimmed;
    } else raw[key] = trimmed;
  }
  if (Object.keys(contact).length > 0) raw.you = { ...current.you, ...contact };
  const changes = parseAnswerChanges(raw);
  if (!changes) return null;
  const pay = Object.fromEntries(Object.entries(changes).filter(([key]) => isPay(key)));
  const shared = Object.fromEntries(Object.entries(changes).filter(([key]) => !isPay(key)));
  // Pay is each kind of job's own, so the first kind's is the answers' own, as before.
  const named = hasKinds(current) ? ` for ${kind.name}` : '';
  const saved = keys.map((key) => {
    const label = LABELS[key as (typeof SAVABLE_ANSWERS)[number]];
    if ((LIST_ANSWERS as readonly string[]).includes(key)) {
      return `${label}: ${(given[key] as string[]).map((each) => each.trim()).join(', ')}`;
    }
    const value = (given[key] as string).trim();
    if (key === 'relocate') {
      return `${label}: ${labelOf(RELOCATE, value as AboutYou['relocate'])}`;
    }
    return `${label}${isPay(key) ? named : ''}: ${value}`;
  });
  return { changes: { ...shared, ...changeKind(current, kind.id, pay) }, saved };
}
