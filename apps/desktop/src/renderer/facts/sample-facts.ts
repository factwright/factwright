import type { FactwrightApi } from '../../shared/api.ts';
import {
  type FactBank,
  type FactEdit,
  type FactFileKind,
  type FactResult,
  factFile,
  factFileKind,
  inFactOrder,
  stopped,
  withChange,
  withClaim,
  withConfirmed,
  withoutClaim,
} from '../../shared/facts.ts';

/** A made-up fact bank, as the skills write one, for checking the page in a browser. */
const FILES: Readonly<Record<string, string>> = {
  'facts/README.md': [
    '# Facts: what’s true about Alex',
    '',
    'The single source of truth for every resume, answer and message. If a claim isn’t here, it doesn’t go out.',
    '',
    '## Claim format',
    'Each claim gets its own `###` heading, then its tags, its resume wording as a `>` quote, and its details.',
    '',
  ].join('\n'),
  'facts/profile.md': [
    '# Profile',
    '',
    '## Contact',
    '- Alex Rivera · Denver, CO · alex@example.com',
    '',
    '## Education',
    '- B.S. Computer Science, Colorado State University, 2012',
    '',
  ].join('\n'),
  'facts/tidewater-analytics.md': [
    '# Tidewater Analytics',
    '',
    '## Overview',
    'Platform engineering lead, 2021 to now. Tidewater sells water-quality analytics to utilities. Team of 6.',
    '',
    '## Platform',
    '',
    '### One deploy pipeline for twelve services',
    '`live` `led-and-built` `high`',
    '> Moved 12 services onto one deploy pipeline, cutting deploy time ~40% and on-call pages by half.',
    '- **Short:** Unified 12 services on one deploy pipeline, ~40% faster deploys.',
    '- **Numbers:** 12 services; deploys ~40% faster; pages down ~50% (as of 2026-06)',
    '- **Say / don’t say:** “led the move” / never “built every service”',
    '- **Keywords:** CI/CD, platform engineering, developer experience, Kubernetes',
    '- **Source:** Alex 2026-10-12',
    '',
    '### Cost dashboards for every team',
    '`unconfirmed` `shipped` `solo` `medium`',
    '> Built cost dashboards that showed each team its cloud spend, which cut idle spend about 18%.',
    '- **Numbers:** idle spend down ~18%',
    '- **Source:** resume alex-rivera.pdf 2026-10-12',
    '',
    '## People',
    '',
    '### Hiring and mentoring',
    '`unconfirmed` `live` `led-team` `high`',
    '> Hired and mentored 4 engineers, two of whom now lead their own projects.',
    '- **Source:** notes 2026-10-12',
    '',
    "## Don't claim",
    '- Never “founded the platform team”: it existed before Alex joined.',
    '',
  ].join('\n'),
  'facts/beacon-labs.md': [
    '# Beacon Labs',
    '',
    '## Overview',
    'Software engineer, 2016 to 2021. Beacon made field-service scheduling software.',
    '',
    '### Offline sync for the field app',
    '`shipped` `took-over` `high`',
    '> Took over and finished offline sync for the field app, used by 3,000 technicians.',
    '- **Numbers:** 3,000 technicians',
    '- **Source:** Alex 2026-10-12',
    '',
  ].join('\n'),
  'facts/projects.md': [
    '# Projects',
    '',
    '### Trail conditions map',
    '`pre-launch` `solo` `high`',
    '> Building a map of trail conditions from hikers’ reports, in a private beta with 40 testers.',
    '- **Source:** Alex 2026-10-12',
    '',
  ].join('\n'),
  'facts/skills.md': [
    '# Skills',
    '',
    '| Skill | Depth | Proven in |',
    '|---|---|---|',
    '| Go | Daily, 5 years | tidewater-analytics.md |',
    '| Kubernetes | Daily, 4 years | tidewater-analytics.md |',
    '| TypeScript | Weekly | projects.md |',
    '',
  ].join('\n'),
  'facts/gaps.md': [
    '# Gaps',
    '',
    "## Doesn't have",
    '| Topic | Their answer | Date |',
    '|---|---|---|',
    '| Rust in production | No | 2026-10-12 |',
    '',
    '## Open questions',
    '- How many customers used the cost dashboards?',
    '',
  ].join('\n'),
};

type FactApi = Pick<
  FactwrightApi,
  'factBank' | 'changeFact' | 'addFact' | 'removeFact' | 'confirmFact'
>;

/**
 * The fact bank's calls over files kept in memory, which change as the page changes them, by
 * the same rules as the files on disk. `files` is shared, so a test can change a file as Claude
 * would.
 */
export function factsInMemory(
  files: Map<string, string>,
  { firstName, today }: { firstName: string | null; today: string },
): FactApi {
  const read = (): FactBank => ({
    files: inFactOrder([...files.keys()]).map((path) => factFile(path, files.get(path) ?? '')),
    skipped: [],
    firstName,
  });
  const edit = async (
    path: string,
    apply: (file: string, kind: FactFileKind) => FactEdit,
  ): Promise<FactResult> => {
    const file = files.get(path);
    if (file === undefined) return stopped('That file isn’t in your fact bank anymore.');
    const next = apply(file, factFileKind(path));
    if (typeof next !== 'string') return stopped(next.problem);
    files.set(path, next);
    return { ok: true, bank: read() };
  };
  const source = `${firstName ?? 'confirmed'} ${today}`;
  return {
    factBank: async () => read(),
    changeFact: (change) => edit(change.path, (file, kind) => withChange(file, kind, change)),
    addFact: ({ path, text }) => edit(path, (file, kind) => withClaim(file, kind, text)),
    removeFact: (target) => edit(target.path, (file, kind) => withoutClaim(file, kind, target)),
    confirmFact: (target) =>
      edit(target.path, (file, kind) => withConfirmed(file, kind, target, source)),
  };
}

/** The made-up fact bank, for checking the page in a browser. ?profile=new has none yet. */
export function sampleFacts(state: string | null): FactApi {
  const files = new Map(state === 'new' ? [] : Object.entries(FILES));
  return factsInMemory(files, { firstName: 'Alex', today: '2026-10-12' });
}
