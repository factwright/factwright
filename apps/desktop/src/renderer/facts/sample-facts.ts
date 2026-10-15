import { answeredClaimText, GAPS_FILE, withGap, withoutGap } from '@factwright/core';
import type { FactwrightApi } from '../../shared/api.ts';
import {
  CHANGED_SINCE,
  type FactBank,
  type FactEdit,
  type FactFileKind,
  type FactResult,
  type FiledFacts,
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
    '### GraphQL for the partner API',
    '`unconfirmed` `live` `solo` `medium`',
    '> Built and ran the partner API in GraphQL, used by about 30 utility partners.',
    '- **Numbers:** about 30 partners',
    '- **Keywords:** GraphQL, API design',
    '- **Source:** answer 2026-10-12, tailoring a resume for Lumen Health',
    '- **Question:** The posting wants GraphQL. Your facts show REST APIs at Tidewater. Have you used GraphQL?',
    '- **Answer:** Yes, in production (the partner API, since 2024)',
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
    '| Rust in production | No | 2026-10-08 |',
    '| Mobile apps | No (asked “Have you built mobile apps, for iOS or Android?” while tailoring a resume for Fernway) | 2026-10-12 |',
    '',
    '## Open questions',
    '- How many customers used the cost dashboards?',
    '',
  ].join('\n'),
};

type FactApi = Pick<
  FactwrightApi,
  'factBank' | 'changeFact' | 'addFact' | 'removeFact' | 'confirmFact' | 'removeGap'
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
    removeGap: (target) =>
      edit(GAPS_FILE, (file) => withoutGap(file, target) ?? { problem: CHANGED_SINCE }),
  };
}

/** The question the made-up run asks, and the user's made-up answer. */
const STREAMING = {
  question:
    'The posting wants event streaming. Your facts show a deploy pipeline at Tidewater. Have you run Kafka, or another event-streaming platform?',
  answer: 'Yes, in production',
};

/**
 * The made-up fact bank, for checking the page in a browser, and what a made-up run files in it
 * from the user's answers, as Claude would: a fact to verify, and something they don't have.
 * ?profile=new has no fact bank yet.
 */
export function sampleFacts(state: string | null): { api: FactApi; fileAnswers: () => FiledFacts } {
  const files = new Map(state === 'new' ? [] : Object.entries(FILES));
  const path = 'facts/tidewater-analytics.md';
  const title = 'Event streaming for sensor data';
  return {
    api: factsInMemory(files, { firstName: 'Alex', today: '2026-10-12' }),
    fileAnswers: () => {
      const tidewater = files.get(path);
      const gaps = files.get(GAPS_FILE);
      if (tidewater === undefined || gaps === undefined) return { facts: [], gaps: 0 };
      const text = answeredClaimText({
        title,
        status: 'live',
        ownership: 'led-and-built',
        confidence: 'medium',
        wording: 'Ran Kafka for sensor data from 400 utilities, about 2 million events a day.',
        keywords: 'Kafka, event streaming',
        date: '2026-10-12',
        context: 'tailoring a resume for Lumen Health',
        asked: [STREAMING],
      });
      if (!tidewater.includes(`### ${title}`)) {
        const added = withClaim(tidewater, 'claims', text);
        if (typeof added === 'string') files.set(path, added);
      }
      files.set(
        GAPS_FILE,
        withGap(gaps, {
          topic: 'HIPAA compliance work',
          answer:
            'No (asked “The posting asks for HIPAA experience. Have you worked under HIPAA?” while tailoring a resume for Lumen Health)',
          date: '2026-10-12',
        }),
      );
      return { facts: [{ path, title }], gaps: 1 };
    },
  };
}
