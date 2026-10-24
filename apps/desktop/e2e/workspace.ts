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

/** A made-up company's job on Greenhouse, whose form lists its questions before it's open. */
export const HARBOR_POSTING = 'https://job-boards.greenhouse.io/harborpine/jobs/4012345';

/** A field of a question, as Greenhouse's job API names it. */
const field = (name: string, type: string, values: { label: string; value: number }[] = []) => ({
  name,
  type,
  values,
});

/**
 * What Greenhouse's job API answers with questions=true for that job, which the tests' copy of
 * the app reads in its place (FACTWRIGHT_FORM_FEED): fields every form has, a question Profile
 * answers, two questions of the form's own, and its compliance questions.
 */
export const HARBOR_FORM = {
  id: 4012345,
  title: 'Account Executive',
  company_name: 'Harbor & Pine Outfitters',
  questions: [
    { label: 'First Name', required: true, fields: [field('first_name', 'input_text')] },
    { label: 'Email', required: true, fields: [field('email', 'input_text')] },
    { label: 'Resume/CV', required: true, fields: [field('resume', 'input_file')] },
    { label: 'LinkedIn Profile', required: false, fields: [field('question_1101', 'input_text')] },
    {
      label: 'Why do you want to join Harbor & Pine?',
      required: true,
      description: '<p>Up to 1,000 characters.</p>',
      fields: [field('question_1102', 'textarea')],
    },
    {
      label: 'Have you sold outdoor gear before?',
      required: false,
      fields: [
        field('question_1104', 'multi_value_single_select', [
          { label: 'Yes', value: 1 },
          { label: 'No', value: 0 },
        ]),
      ],
    },
  ],
  compliance: [
    {
      type: 'eeoc',
      questions: [
        {
          label: 'Gender',
          required: false,
          fields: [field('gender', 'multi_value_single_select')],
        },
      ],
    },
  ],
};

/**
 * The Claude Code folder the first profile runs with, standing in for the user's own, which no
 * test reaches: one in its data folder, signed in, as `claude auth login` would sign it in.
 */
export function usersClaude(dataDir: string, name = 'users-claude'): string {
  const folder = join(dataDir, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'signed-in'), '');
  return folder;
}

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
