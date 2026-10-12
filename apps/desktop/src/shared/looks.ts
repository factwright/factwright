import { type Layout, TEMPLATES, templateOf } from '@factwright/engine/templates';
import {
  type AboutYou,
  COMPANY_KINDS,
  type CompanyKind,
  type Field,
  type Level,
  type Look,
  labelOf,
  pagesFor,
  RESUME_FILES,
  STYLE_OF,
} from './about.ts';
import { stamped } from './stamp.ts';

/** Who each template suits best: the kinds of company, the fields and the levels. */
const SUITS: Readonly<
  Record<
    Layout,
    { companies: readonly CompanyKind[]; fields: readonly Field[]; levels: readonly Level[] }
  >
> = {
  classic: {
    companies: ['public', 'established'],
    fields: [
      'legal',
      'finance',
      'healthcare',
      'education',
      'science',
      'operations',
      'people',
      'trades',
    ],
    levels: ['entry', 'mid', 'senior', 'manager', 'director'],
  },
  timeline: {
    companies: ['startup'],
    fields: ['software', 'data', 'it', 'product'],
    levels: ['mid', 'senior', 'lead'],
  },
  executive: {
    companies: ['established'],
    fields: ['finance', 'operations', 'sales', 'product', 'software', 'people'],
    levels: ['manager', 'director', 'executive'],
  },
  modern: {
    companies: ['startup'],
    fields: ['design', 'product', 'marketing', 'creative', 'data'],
    levels: ['mid', 'senior', 'lead', 'manager'],
  },
  compact: {
    companies: ['startup', 'established'],
    fields: ['software', 'data', 'it', 'science', 'trades'],
    levels: ['entry', 'mid'],
  },
  minimal: {
    companies: ['startup'],
    fields: ['design', 'creative', 'product', 'science'],
    levels: ['mid', 'senior', 'lead'],
  },
  elegant: {
    companies: ['public', 'established'],
    fields: ['legal', 'education', 'healthcare', 'creative', 'people'],
    levels: ['senior', 'lead', 'manager', 'director', 'executive'],
  },
  banner: {
    companies: ['startup', 'established'],
    fields: ['sales', 'marketing', 'customer', 'operations', 'people'],
    levels: ['entry', 'mid', 'senior', 'manager'],
  },
};

/** A template picked out for the user, with why, in a few words. */
export interface Suggestion extends Look {
  why: string;
}

/** How well a template suits the user for one kind of company. */
function score(
  layout: Layout,
  kind: CompanyKind | 'any',
  fields: readonly Field[],
  levels: readonly Level[],
) {
  const suits = SUITS[layout];
  return (
    (kind !== 'any' && suits.companies.includes(kind) ? 3 : 0) +
    (fields.some((field) => suits.fields.includes(field)) ? 2 : 0) +
    (levels.some((level) => suits.levels.includes(level)) ? 1 : 0)
  );
}

/** The few words on why a template suits the user. */
function reason(layout: Layout, kind: CompanyKind | 'any', fields: readonly Field[]): string {
  const suits = SUITS[layout];
  const parts = [
    kind !== 'any' && suits.companies.includes(kind)
      ? labelOf(COMPANY_KINDS, kind).toLowerCase()
      : null,
    fields.some((field) => suits.fields.includes(field)) ? 'your field' : null,
  ].filter(Boolean);
  return parts.length > 0 ? `Suits ${parts.join(' and ')}` : 'A safe choice for any job';
}

/**
 * The template that suits each kind of company the user is aiming at, from what they're looking
 * for: one for startups, say, and another for established companies, each its own, since a look
 * goes with one kind. With no kind chosen, one template for any job.
 */
export function suggestLooks(
  answers: Pick<AboutYou, 'companies' | 'fields' | 'levels'>,
): Suggestion[] {
  const kinds: (CompanyKind | 'any')[] = answers.companies.length > 0 ? answers.companies : ['any'];
  const taken = new Set<Layout>();
  const fit = (layout: Layout, kind: CompanyKind | 'any') =>
    score(layout, kind, answers.fields, answers.levels);
  return kinds.map((kind) => {
    // TEMPLATES lists the safest first, so it wins a tie.
    const best = TEMPLATES.map((each) => each.layout)
      .filter((layout) => !taken.has(layout))
      .reduce((top, layout) => (fit(layout, kind) > fit(top, kind) ? layout : top));
    taken.add(best);
    return { layout: best, for: kind, why: reason(best, kind, answers.fields) };
  });
}

/** Which kinds of company a template is suggested for, for its badge in the gallery. */
export function suggestedFor(
  layout: Layout,
  suggestions: readonly Suggestion[],
): (CompanyKind | 'any')[] {
  return suggestions.filter((each) => each.layout === layout).map((each) => each.for);
}

const lookLine = (look: Look) => {
  const { name } = templateOf(look.layout);
  const style =
    look.for === 'any'
      ? 'any job'
      : `${labelOf(COMPANY_KINDS, look.for)} (the ${STYLE_OF[look.for]} style)`;
  return `| ${name} | \`${look.layout}\` | ${style} |`;
};

/**
 * The user's templates as guide/templates.md, which the resume skills read: which look goes with
 * which kind of company, how long resumes run, and which files to make.
 */
export function templatesMarkdown(answers: AboutYou): string {
  const pages = pagesFor(answers);
  const body = [
    '# Your resume templates',
    '',
    'The looks the user picked. Use the one for the kind of company a job is at, set as `layout` in its resume.json.',
    '',
    ...(answers.looks.length > 0
      ? ['| Template | `layout` | Use it for |', '|---|---|---|', ...answers.looks.map(lookLine)]
      : ['None picked yet. Use the style file’s layout.']),
    '',
    `- **Length:** ${pages === 1 ? 'one page' : 'up to two pages'}${answers.pages ? '' : ', for their level'}.`,
    `- **Files:** ${labelOf(RESUME_FILES, answers.format)}${answers.format === 'both' ? ' (PDF and Word)' : ''}, unless a job asks for something else.`,
    '',
  ].join('\n');
  return stamped(
    body,
    'From the user’s answers. Change them in the app: Profile → Resume templates.',
  );
}
