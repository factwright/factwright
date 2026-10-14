import {
  type AboutYou,
  COMPANY_KINDS,
  EMPLOYMENT,
  FIELDS,
  type JobKind,
  LEVELS,
  labelOf,
  RELOCATE,
} from './about.ts';
import { hasKinds, kindsOf } from './kinds.ts';
import { stamped } from './stamp.ts';

/** "a, b or c", for a few words. */
function either(words: readonly string[], joiner = 'or'): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} ${joiner} ${words.at(-1)}`;
}

const lower = (words: readonly string[]) => words.map((word) => word.toLowerCase());

/** Where the user can work, in one sentence. */
function where(answers: AboutYou): string | null {
  const parts: string[] = [];
  if (answers.workplaces.includes('remote')) {
    parts.push(answers.remoteFrom ? `Remote from ${answers.remoteFrom}` : 'Remote');
  }
  const local = answers.workplaces.filter((place) => place !== 'remote');
  if (local.length > 0) {
    const kinds = either(local.map((place) => (place === 'onsite' ? 'on-site' : place)));
    parts.push(answers.places.length > 0 ? `${kinds} in ${either(answers.places)}` : kinds);
  }
  if (parts.length === 0 && answers.places.length > 0) parts.push(`In ${either(answers.places)}`);
  if (parts.length === 0) return null;
  const sentence = `${parts.join('; ')}.`;
  const moving = answers.relocate
    ? {
        no: ' Not relocating.',
        maybe: ' Open to relocating for the right job.',
        yes: ' Open to relocating.',
      }[answers.relocate]
    : '';
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + moving;
}

const item = (label: string, value: string | null) => (value ? [`- **${label}:** ${value}`] : []);

/** Text the user typed, kept to one bullet's worth of lines. */
const typed = (value: string) => value.trim().replace(/\s*\n\s*/g, ' / ');

/** A kind of job's levels and kinds of work, as criteria.md's filters give them. */
function kindFilters(kind: JobKind): string[] {
  const levels = kind.levels.map((level) => labelOf(LEVELS, level));
  const fields = kind.fields
    .filter((field) => field !== 'other')
    .map((field) => labelOf(FIELDS, field));
  const work = [
    fields.length > 0 ? `${either(fields)}.` : '',
    kind.roles.length > 0 ? `Roles such as ${either(kind.roles)}, and close matches.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return [
    ...item('Level', levels.length > 0 ? `${either(levels)}.` : null),
    ...item('Kind of work', work || null),
  ];
}

/** A kind of job's lowest pay, as a filter, when the user asked to leave out jobs paying less. */
const payFilter = (kind: JobKind) =>
  item(
    'Pay',
    kind.payFilter && kind.minPay ? `At least ${kind.minPay} base, when the posting says.` : null,
  );

/** A kind of job's pay, as criteria.md's pay section gives it. */
const kindPay = (kind: JobKind) => [
  ...(kind.targetPay ? [`- **Target:** ${kind.targetPay} base.`] : []),
  ...(kind.minPay && !kind.payFilter ? [`- **Lowest they'd take:** ${kind.minPay} base.`] : []),
];

/** The level and shape a kind of job's roles take, such as "Senior roles: Staff Engineer". */
function shapeOf(kind: JobKind): string {
  const levels = kind.levels.map((level) => labelOf(LEVELS, level));
  return [levels.length > 0 ? either(levels) : '', kind.roles.length > 0 ? either(kind.roles) : '']
    .filter(Boolean)
    .join(' roles: ');
}

/**
 * Each kind of job, with its own filters and pay, when the user wants more than one: what a
 * job search or fit check scores a job of that kind against.
 */
function kindSections(kinds: readonly JobKind[]): string[] {
  return [
    '## Kinds of job',
    'They want more than one kind of job, each with its own titles, levels, work and pay below. A job of a kind must pass its section’s Level, Kind of work and Pay lines as well as the filters above, and its role is scored against them. The preferences above hold for every kind. Each kind’s id is in backticks after its name.',
    '',
    ...kinds.flatMap((kind) => {
      const own = [...kindFilters(kind), ...payFilter(kind), ...kindPay(kind)];
      return [
        `### ${kind.name} (\`${kind.id}\`)`,
        ...(own.length > 0 ? own : ['- Nothing given yet beyond the shared filters.']),
        '',
      ];
    }),
  ];
}

/**
 * What the user is looking for, as searches/criteria.md: the filters a job must pass, what
 * ranks it higher, pay, and how fit is scored. With more than one kind of job, each kind's own
 * titles, levels, work and pay get a section of their own. Job searches and fit checks read it,
 * and the app writes it again whenever the answers change.
 */
export function criteriaMarkdown(answers: AboutYou): string {
  const place = where(answers);
  const kinds = hasKinds(answers) ? kindsOf(answers) : null;
  // With one kind of job, its own lines stay where they always were.
  const only = kinds ? null : (kindsOf(answers)[0] as JobKind);
  const filters = [
    ...item('Where', place),
    ...(only ? kindFilters(only) : []),
    ...item(
      'Employment',
      answers.employment.length > 0
        ? `${either(answers.employment.map((each) => labelOf(EMPLOYMENT, each)))}.`
        : null,
    ),
    ...(only ? payFilter(only) : []),
    ...item('Not in', answers.avoid.length > 0 ? `${either(lower(answers.avoid))}.` : null),
    ...item('Work authorization', answers.authorization ? typed(answers.authorization) : null),
    ...item('Deal-breakers', answers.dealBreakers ? typed(answers.dealBreakers) : null),
    '- **Real:** posts with scam signs are dropped. Unpaid or equity-only roles stay in when the fit is strong, with that flagged first.',
  ];
  const companies = answers.companies.map((kind) => labelOf(COMPANY_KINDS, kind));
  const preferences = [
    ...item('Companies', companies.length > 0 ? `${either(companies)}.` : null),
    ...item('Industries', answers.industries.length > 0 ? `${either(answers.industries)}.` : null),
    ...item('Must-haves', answers.mustHaves ? typed(answers.mustHaves) : null),
  ];
  const situation = [
    ...item('Start', answers.start ? typed(answers.start) : null),
    ...item('Relocating', answers.relocate && !place ? labelOf(RELOCATE, answers.relocate) : null),
    ...(answers.quiet
      ? [
          '- **Quiet search:** they’re employed, so keep it discreet. Never suggest public posts about the search, and draft outreach only for people they choose.',
        ]
      : []),
  ];
  const shape = only ? shapeOf(only) : '';
  const body = [
    '# Job search criteria',
    '',
    'What the user is looking for, from their answers. Job searches and fit checks use it. Edit it here when the user asks: from then on the app leaves it as it is, until the user replaces it with their answers in the app.',
    '',
    '## Filters (must pass)',
    ...filters,
    '',
    '## Preferences (rank higher)',
    ...(preferences.length > 0 ? preferences : ['- None given yet.']),
    '',
    '## Pay',
    ...(only ? kindPay(only) : []),
    `- Show pay when the posting lists it.${kinds ? ' Each kind’s pay is in its section.' : ''} Pay never changes a fit score.`,
    '',
    ...(situation.length > 0 ? ['## Their situation', ...situation, ''] : []),
    ...(kinds ? kindSections(kinds) : []),
    '## Scoring (0–100)',
    'Fit is judged against `facts/` only, the same bar as resumes.',
    '',
    '| Part | Points | What earns it |',
    '|---|---|---|',
    '| Work | 40 | The job’s core work is work the fact bank proves, domain included |',
    kinds
      ? '| Role | 25 | The level and shape fit what the user wants for the job’s kind |'
      : `| Role | 25 | The level and shape fit what the user wants${shape ? `: ${shape}` : ''} |`,
    '| Stack | 20 | Overlap with the tools, methods and skills the fact bank proves |',
    '| Reqs | 15 | Full marks unless a hard requirement isn’t met: years, degree, license or certification |',
    '',
    '**Tiers:** Strong ≥ 75 · Good 62–74 · Worth a look 50–61. Below 50 goes to long shots.',
    '',
  ].join('\n');
  return stamped(body, 'From the user’s answers. Change them in the app: Profile → What you want.');
}
