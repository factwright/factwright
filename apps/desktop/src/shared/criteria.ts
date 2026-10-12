import {
  type AboutYou,
  COMPANY_KINDS,
  EMPLOYMENT,
  FIELDS,
  LEVELS,
  labelOf,
  RELOCATE,
} from './about.ts';
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

/**
 * What the user is looking for, as searches/criteria.md: the filters a job must pass, what
 * ranks it higher, pay, and how fit is scored. Job searches and fit checks read it, and the app
 * writes it again whenever the answers change.
 */
export function criteriaMarkdown(answers: AboutYou): string {
  const place = where(answers);
  const levels = answers.levels.map((level) => labelOf(LEVELS, level));
  const fields = answers.fields
    .filter((field) => field !== 'other')
    .map((field) => labelOf(FIELDS, field));
  const work = [
    fields.length > 0 ? `${either(fields)}.` : '',
    answers.roles.length > 0 ? `Roles such as ${either(answers.roles)}, and close matches.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const filters = [
    ...item('Where', place),
    ...item('Level', levels.length > 0 ? `${either(levels)}.` : null),
    ...item('Kind of work', work || null),
    ...item(
      'Employment',
      answers.employment.length > 0
        ? `${either(answers.employment.map((each) => labelOf(EMPLOYMENT, each)))}.`
        : null,
    ),
    ...item(
      'Pay',
      answers.payFilter && answers.minPay
        ? `At least ${answers.minPay} base, when the posting says.`
        : null,
    ),
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
  const shape = [
    levels.length > 0 ? either(levels) : '',
    answers.roles.length > 0 ? either(answers.roles) : '',
  ]
    .filter(Boolean)
    .join(' roles: ');
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
    ...(answers.targetPay ? [`- **Target:** ${answers.targetPay} base.`] : []),
    ...(answers.minPay && !answers.payFilter
      ? [`- **Lowest they'd take:** ${answers.minPay} base.`]
      : []),
    '- Show pay when the posting lists it. Pay never changes a fit score.',
    '',
    ...(situation.length > 0 ? ['## Their situation', ...situation, ''] : []),
    '## Scoring (0–100)',
    'Fit is judged against `facts/` only, the same bar as resumes.',
    '',
    '| Part | Points | What earns it |',
    '|---|---|---|',
    '| Work | 40 | The job’s core work is work the fact bank proves, domain included |',
    `| Role | 25 | The level and shape fit what the user wants${shape ? `: ${shape}` : ''} |`,
    '| Stack | 20 | Overlap with the tools, methods and skills the fact bank proves |',
    '| Reqs | 15 | Full marks unless a hard requirement isn’t met: years, degree, license or certification |',
    '',
    '**Tiers:** Strong ≥ 75 · Good 62–74 · Worth a look 50–61. Below 50 goes to long shots.',
    '',
  ].join('\n');
  return stamped(body, 'From the user’s answers. Change them in the app: Profile → What you want.');
}
