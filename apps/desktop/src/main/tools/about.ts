import {
  type AboutYou,
  type AnswerChanges,
  COMPANY_KINDS,
  type Contact,
  EMPLOYMENT,
  FIELDS,
  LEVELS,
  labelOf,
  parseAnswerChanges,
  RELOCATE,
  WORKPLACES,
} from '../../shared/about.ts';

/** Indents a text's later lines under its first, to keep a list item whole. */
const indented = (text: string) => text.trim().split(/\r?\n/).join('\n    ');

/**
 * What the user told Factwright about themselves, when they started and in Profile since, in
 * words: who they are, what they're looking for, pay, and the answers application forms ask for.
 */
export function aboutYouText(answers: AboutYou): string {
  const lines: string[] = [];
  const item = (label: string, value: string | null | undefined) => {
    if (value?.trim()) lines.push(`- ${label}: ${indented(value)}`);
  };
  const list = <T extends string>(
    options: readonly (readonly [T, string, ...string[]])[],
    values: readonly T[],
  ) => values.map((value) => labelOf(options, value)).join(', ');

  const { you } = answers;
  item('Name', you.name);
  item('Email', you.email);
  item('Phone', you.phone);
  item('Location', you.location);
  item('LinkedIn', you.linkedin);
  item('Website', you.website);
  item('Roles they want', answers.roles.join('; '));
  item('Kinds of work', list(FIELDS, answers.fields));
  item('Levels', list(LEVELS, answers.levels));
  item('Where they’ll work', list(WORKPLACES, answers.workplaces));
  item('Remote from', answers.remoteFrom);
  item('Cities for hybrid or on-site work', answers.places.join('; '));
  item('Relocating', answers.relocate && labelOf(RELOCATE, answers.relocate));
  item('Kinds of company', list(COMPANY_KINDS, answers.companies));
  item('Industries they’d love', answers.industries.join('; '));
  item('Industries they won’t work in', answers.avoid.join('; '));
  item('Employment', list(EMPLOYMENT, answers.employment));
  item('Target base pay', answers.targetPay);
  item(
    'Lowest base pay they’d take',
    answers.minPay &&
      `${answers.minPay}${answers.payFilter ? ' (jobs paying less are left out)' : ''}`,
  );
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

/**
 * The changes save_about_you was asked to make, checked like the window's own, with contact
 * details joining the ones on file. Null when any doesn't hold up, so nothing is half saved.
 */
export function aboutYouChanges(
  input: Record<string, unknown>,
  current: AboutYou,
): { changes: AnswerChanges; saved: string[] } | null {
  const keys = Object.keys(input);
  if (keys.length === 0) return null;
  if (keys.some((key) => !(SAVABLE_ANSWERS as readonly string[]).includes(key))) return null;
  const raw: Record<string, unknown> = {};
  const contact: Partial<Contact> = {};
  for (const key of keys) {
    const value = input[key];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if ((CONTACT_FIELDS as readonly string[]).includes(key)) {
      contact[key as (typeof CONTACT_FIELDS)[number]] = trimmed;
    } else raw[key] = trimmed;
  }
  if (Object.keys(contact).length > 0) raw.you = { ...current.you, ...contact };
  const changes = parseAnswerChanges(raw);
  if (!changes) return null;
  const saved = keys.map(
    (key) =>
      `${LABELS[key as (typeof SAVABLE_ANSWERS)[number]]}: ${
        key === 'relocate'
          ? labelOf(RELOCATE, (input[key] as string).trim() as AboutYou['relocate'])
          : (input[key] as string).trim()
      }`,
  );
  return { changes, saved };
}
