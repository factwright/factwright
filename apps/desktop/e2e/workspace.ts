import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ACME_FOLDER = 'applications/2026-10-07-acme-robotics-staff-engineer';
export const ACME_RESUME = 'AlexRiveraResume10072026_Acme.pdf';
export const ACME_WORD = 'AlexRiveraResume10072026_Acme.docx';

/** A made-up resume the engine printed, as the app prints them, from the ATS X-ray's tests. */
const resume = (name: string) =>
  readFileSync(createRequire(import.meta.url).resolve(`@factwright/xray/fixtures/${name}`));

/** Files of a made-up job hunt, as the skills write them. */
const FILES: Readonly<Record<string, string | Uint8Array>> = {
  'searches/fit-checks.md': [
    '| Date | Company | Role | Verdict | Score | Link | Pay | Note |',
    '|---|---|---|---|---|---|---|---|',
    '| 2026-10-07 | Acme Robotics | Staff Engineer | Strong | 82 | https://jobs.ashbyhq.com/acme/7f3a | $185k–$215k | Build tooling at scale |',
  ].join('\n'),
  [`${ACME_FOLDER}/job.md`]: [
    '# Acme Robotics: Staff Engineer',
    '',
    '- **Date:** 2026-10-07',
    '- **Pay:** $185k–$215k',
    '- **Apply:** Ashby https://jobs.ashbyhq.com/acme/7f3a',
    '- **Work arrangement:** Remote, US',
    '- **Fit check:** Strong, 82',
  ].join('\n'),
  [`${ACME_FOLDER}/posting.md`]:
    '# Staff Engineer\n\n- **Source:** https://jobs.ashbyhq.com/acme/7f3a\n\nBuild the tools our engineers use.',
  [`${ACME_FOLDER}/${ACME_RESUME}`]: resume('engineer.pdf'),
  [`${ACME_FOLDER}/${ACME_WORD}`]: resume('engineer.docx'),
  'searches/2026-10-hn-whos-hiring/jobs.json': JSON.stringify({
    meta: { source: 'HN October 2026', checked: '2026-10-05' },
    jobs: [
      {
        company: 'Tidewater Analytics',
        role: 'Senior Backend Engineer',
        posting: 'https://jobs.lever.co/tidewater/1',
        tier: 'good',
        score: 68,
        remote: 'Remote (US)',
        why: ['Backend work on data pipelines'],
      },
    ],
  }),
};

/** A new app data folder, with the made-up job hunt in its workspace, or empty. */
export function newDataFolder({ empty = false } = {}): string {
  const dataDir = mkdtempSync(join(tmpdir(), 'factwright-e2e-'));
  mkdirSync(join(dataDir, 'workspace'));
  if (empty) return dataDir;
  for (const [path, contents] of Object.entries(FILES)) {
    const file = join(dataDir, 'workspace', path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, contents);
  }
  return dataDir;
}
