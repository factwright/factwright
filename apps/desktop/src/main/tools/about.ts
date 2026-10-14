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
import { changeKind, hasKinds, kindsOf } from '../../shared/kinds.ts';

/** Indents a text's later lines under its first, to keep a list item whole. */
const indented = (text: string) => text.trim().split(/\r?\n/).join('\n    ');

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

/** The answers save_about_you takes: the ones application forms ask for. */
export const SAVABLE_ANSWERS = [
  'authorization',
  'start',
  'relocate',
  'targetPay',
  'minPay',
  ...CONTACT_FIELDS,
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
    const value = (given[key] as string).trim();
    if (key === 'relocate') {
      return `${label}: ${labelOf(RELOCATE, value as AboutYou['relocate'])}`;
    }
    return `${label}${isPay(key) ? named : ''}: ${value}`;
  });
  return { changes: { ...shared, ...changeKind(current, kind.id, pay) }, saved };
}
