import { TEMPLATES } from '@factwright/engine/templates';
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

/** Who a template suits best: the kinds of company, the fields and the levels. */
interface Suits {
  companies: readonly CompanyKind[];
  fields: readonly Field[];
  levels: readonly Level[];
}

/** Who each template the app comes with suits best. */
const SUITS: Readonly<Record<string, Suits>> = {
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
      'sales',
      'customer',
    ],
    levels: ['entry', 'mid', 'senior', 'manager', 'director', 'executive'],
  },
  minimal: {
    companies: ['startup'],
    fields: ['software', 'data', 'it', 'product', 'design', 'creative', 'marketing'],
    levels: ['entry', 'mid', 'senior', 'lead', 'manager'],
  },
};

/** The user's own templates are theirs to pick, so none is suggested. */
const NO_SUITS: Suits = { companies: [], fields: [], levels: [] };

/** A template picked out for the user, with why, in a few words. */
export interface Suggestion extends Look {
  why: string;
}

/** How well a template suits the user for one kind of company. */
function score(
  layout: string,
  kind: CompanyKind | 'any',
  fields: readonly Field[],
  levels: readonly Level[],
) {
  const suits = SUITS[layout] ?? NO_SUITS;
  return (
    (kind !== 'any' && suits.companies.includes(kind) ? 3 : 0) +
    (fields.some((field) => suits.fields.includes(field)) ? 2 : 0) +
    (levels.some((level) => suits.levels.includes(level)) ? 1 : 0)
  );
}

/** The few words on why a template suits the user. */
function reason(layout: string, kind: CompanyKind | 'any', fields: readonly Field[]): string {
  const suits = SUITS[layout] ?? NO_SUITS;
  const parts = [
    kind !== 'any' && suits.companies.includes(kind)
      ? labelOf(COMPANY_KINDS, kind).toLowerCase()
      : null,
    fields.some((field) => suits.fields.includes(field)) ? 'your field' : null,
  ].filter(Boolean);
  return parts.length > 0 ? `Suits ${parts.join(' and ')}` : 'A safe choice for any job';
}

/**
 * The template the app comes with that suits each kind of company the user is aiming at, from
 * what they're looking for: one for startups, say, and another for established companies, each
 * its own, since a look goes with one kind. With no kind chosen, one template for any job. Once
 * each template has a kind, the kinds left get none, and the user picks for them.
 */
export function suggestLooks(
  answers: Pick<AboutYou, 'companies' | 'fields' | 'levels'>,
): Suggestion[] {
  const kinds: (CompanyKind | 'any')[] = answers.companies.length > 0 ? answers.companies : ['any'];
  const ids = TEMPLATES.map(({ id }) => id);
  const fit = (layout: string, kind: CompanyKind | 'any') =>
    score(layout, kind, answers.fields, answers.levels);
  // Every way to give the kinds a template each, while there are templates left: the one that
  // covers the most kinds wins, then the one that suits them best. Templates come safest first,
  // and earlier kinds first, so of equals the first found wins.
  const best = { covered: -1, total: 0, picks: [] as (string | null)[] };
  const walk = (picks: (string | null)[], total: number) => {
    const kind = kinds[picks.length];
    if (kind === undefined) {
      const covered = picks.filter(Boolean).length;
      if (covered > best.covered || (covered === best.covered && total > best.total)) {
        Object.assign(best, { covered, total, picks });
      }
      return;
    }
    for (const id of ids) if (!picks.includes(id)) walk([...picks, id], total + fit(id, kind));
    walk([...picks, null], total);
  };
  walk([], 0);
  return kinds.flatMap((kind, i) => {
    const layout = best.picks[i];
    return layout ? [{ layout, for: kind, why: reason(layout, kind, answers.fields) }] : [];
  });
}

/** Which kinds of company a template is suggested for, for its badge in the gallery. */
export function suggestedFor(
  layout: string,
  suggestions: readonly Suggestion[],
): (CompanyKind | 'any')[] {
  return suggestions.filter((each) => each.layout === layout).map((each) => each.for);
}

/** A template's name, from the templates the user has, or its ID when it's gone. */
export const templateName = (
  layout: string,
  templates: readonly { id: string; name: string }[],
): string => templates.find((each) => each.id === layout)?.name ?? layout;

const lookLine = (look: Look, templates: readonly { id: string; name: string }[]) => {
  const name = templateName(look.layout, templates);
  const style =
    look.for === 'any'
      ? 'any job'
      : `${labelOf(COMPANY_KINDS, look.for)} (the ${STYLE_OF[look.for]} style)`;
  return `| ${name} | \`${look.layout}\` | ${style} |`;
};

/** The user's picks whose templates they still have: a pick of one that's gone is left out. */
export const livePicks = (looks: readonly Look[], templates: readonly { id: string }[]): Look[] =>
  looks.filter((look) => templates.some((each) => each.id === look.layout));

/**
 * The user's templates as guide/templates.md, which the resume skills read: which look goes with
 * which kind of company, how long resumes run, and which files to make. A pick of a template
 * that's gone is left out, so Claude never builds in it.
 */
export function templatesMarkdown(
  answers: AboutYou,
  templates: readonly { id: string; name: string }[],
): string {
  const pages = pagesFor(answers);
  const looks = livePicks(answers.looks, templates);
  const body = [
    '# Your resume templates',
    '',
    'The looks the user picked. Use the one for the kind of company a job is at, set as `layout` in its resume.json.',
    '',
    ...(looks.length > 0
      ? [
          '| Template | `layout` | Use it for |',
          '|---|---|---|',
          ...looks.map((look) => lookLine(look, templates)),
        ]
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
