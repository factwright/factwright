import type { FactwrightApi } from '../shared/api.ts';
import {
  type ChangedFile,
  lineCounts,
  linesOf,
  type RunChanges,
  type UndoResult,
} from '../shared/run-changes.ts';
import { type RunTask, taskJob } from '../shared/runs.ts';

/** A made-up file a task changed: its text before and after, or no text for a PDF. */
interface SampleFile {
  path: string;
  /** Null for a file the task made. */
  before: string | null;
  after: string;
  text: boolean;
}

/** A job's company and role, in words, from its ID, such as quarry-labs--senior-software-engineer. */
function namesOf(jobId: string): { company: string; role: string } {
  const [company = jobId, role = ''] = jobId.split('--');
  const words = (slug: string) =>
    slug
      .split('-')
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(' ');
  return { company: words(company), role: words(role) };
}

/** The job's notes before the task, as a fit check left them, and after it. */
function jobText(jobId: string): { before: string; after: string } {
  const { company, role } = namesOf(jobId);
  const before = [
    `# ${company}: ${role}`,
    '- **Date:** 2026-10-24',
    `- **Company:** ${company}`,
    `- **Role:** ${role}`,
    `- **Links:** https://jobs.ashbyhq.com/${jobId.split('--')[0]}/4f1c`,
    '',
    '## Job description',
    'Saved word for word in posting.md.',
    '',
    "## The user's notes",
    'The recruiter said the team cares most about deploy safety.',
  ].join('\n');
  const after = [
    before.replace(
      '- **Links:**',
      '- **Format:** pdf\n- **Style / track:** startup / builder\n- **Links:**',
    ),
    '',
    '## Company notes',
    `${company} makes scheduling software for clinics: Series B, about 120 people, on AWS and Go.`,
    'They call themselves “boringly reliable”.',
    '',
    '## Requirements',
    '- Must: 5+ years building platform tooling; Kubernetes; on-call',
    '- Nice: Go, Terraform, healthcare',
    '- Likely worries: no healthcare work on file',
  ].join('\n');
  return { before, after };
}

const RESUME = JSON.stringify(
  {
    layout: 'classic',
    format: 'pdf',
    output_name: 'AlexRiveraResume10252026_Company',
    name: 'Alex Rivera',
    headline: 'Senior Platform Engineer',
    summary: 'Platform engineer who builds the deploy tools other engineers rely on.',
    experience: [
      {
        title: 'Platform Engineering Lead',
        company: 'Tidewater Analytics',
        start: '03/2021',
        end: 'Present',
        bullet_groups: [
          {
            bullets: [
              { text: 'Cut deploy time by **~40%** by moving 12 services onto one pipeline.' },
              { text: 'Ran on-call for the platform team, with a runbook for each alert.' },
            ],
          },
        ],
      },
    ],
  },
  null,
  2,
);

const NOTES = [
  '# Notes',
  '',
  '- **Style / track / template:** startup / builder / Classic: a Series B team that ships.',
  '- **Leads with:** deploy safety, which the recruiter said matters most.',
  '',
  '| Requirement | Best evidence | |',
  '|---|---|---|',
  '| Kubernetes | tidewater.md#deploy-pipeline | strong |',
  '| On-call | tidewater.md#on-call-rotation | strong |',
  '| Healthcare | none | none |',
].join('\n');

const PREFERENCES_BEFORE = ['# Nudges', '', '## Keep doing', '- Numbers first in a bullet.'].join(
  '\n',
);
const PREFERENCES_AFTER = `${PREFERENCES_BEFORE}\n- Lead with what the recruiter said matters most. (2026-10-25)`;

/** The company's name in a job's ID, in letters and digits, for its files' names. */
const companyOf = (jobId: string) =>
  (jobId.split('--')[0] ?? jobId).replace(/(?:^|-)(\w)/g, (_, letter: string) =>
    letter.toUpperCase(),
  );

/** What a task like the made-up one would change, by its skill. */
function sampleFiles(task: RunTask | null): SampleFile[] {
  const jobId = task ? taskJob(task) : null;
  if (!task || !jobId) return [];
  const folder = `applications/${jobId}`;
  const company = companyOf(jobId);
  const job = jobText(jobId);
  const pdf = (name: string): SampleFile => ({
    path: `${folder}/${name}.pdf`,
    before: null,
    after: '',
    text: false,
  });
  switch (task.skill) {
    case 'focused-resume':
      return [
        { path: `${folder}/job.md`, ...job, text: true },
        {
          path: `${folder}/resume.json`,
          before: null,
          after: RESUME.replace('_Company', `_${company}`),
          text: true,
        },
        { path: `${folder}/notes.md`, before: null, after: NOTES, text: true },
        pdf(`AlexRiveraResume10252026_${company}`),
        {
          path: 'guide/preferences.md',
          before: PREFERENCES_BEFORE,
          after: PREFERENCES_AFTER,
          text: true,
        },
      ];
    case 'cover-letter':
      return [
        { path: `${folder}/cover-letter.json`, before: null, after: '{}\n', text: true },
        pdf(`AlexRiveraCoverLetter10252026_${company}`),
      ];
    case 'fit-check':
      return [
        { path: `${folder}/job.md`, ...job, text: true },
        {
          path: `${folder}/fit-check.md`,
          before: null,
          after: '# Fit check\n\n**Score:** 82, a strong fit.\n',
          text: true,
        },
      ];
    default:
      return [];
  }
}

/** The pages a task like it would read. */
function samplePages(task: RunTask | null): string[] {
  const jobId = task ? taskJob(task) : null;
  if (!jobId || (task?.skill !== 'focused-resume' && task?.skill !== 'fit-check')) return [];
  const site = `https://www.${(jobId.split('--')[0] ?? jobId).replaceAll('-', '')}.com`;
  return [`${site}/about`, `${site}/blog/platform-team`];
}

const changedOf = (file: SampleFile, undone: boolean): ChangedFile => ({
  path: file.path,
  change: file.before === null ? 'new' : 'changed',
  lines: !file.text
    ? null
    : file.before === null
      ? { added: linesOf(file.after).length, removed: 0 }
      : lineCounts(file.before, file.after),
  canUndo: !undone,
  undone,
});

/**
 * What the made-up runs change, for the card once a task is done: the files a task like it
 * would change and the pages it would read, kept until the page reloads. ?changes=none has a
 * task change nothing, and ?changes=since has the first Undo find its file changed again since.
 */
export function sampleChanges(mode: string | null) {
  const listeners = new Set<(changes: RunChanges) => void>();
  let count = 0;
  let files: SampleFile[] = [];
  let undone = new Set<string>();
  let asked = mode !== 'since';
  let current: RunChanges = {
    id: '20261025-140311-000-a1b2c3',
    files: [],
    pages: [],
    morePages: 0,
  };
  const view = (): RunChanges => ({
    ...current,
    files: files.map((file) => changedOf(file, undone.has(file.path))),
  });
  const tell = () => {
    current = view();
    for (const listener of listeners) listener(current);
  };
  return {
    /** A task starts, with nothing changed yet. */
    begin: () => {
      count += 1;
      files = [];
      undone = new Set();
      current = {
        id: `20261025-14${String(count).padStart(4, '0')}-000-a1b2c3`,
        files: [],
        pages: [],
        morePages: 0,
      };
      tell();
    },
    /** A task's turn ends, with what it changed. */
    done: (task: RunTask | null) => {
      if (mode === 'none') return;
      files = sampleFiles(task);
      current = { ...current, pages: samplePages(task) };
      tell();
    },
    api: {
      onRunChanges: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      viewChange: async (_id, path) => {
        const file = files.find((each) => each.path === path);
        return file?.text ? { before: file.before, after: file.after } : null;
      },
      undoChange: async (_id, path, anyway): Promise<UndoResult> => {
        if (!asked && !anyway) {
          asked = true;
          return {
            ok: false,
            reason: 'since',
            message:
              'This file changed again after Claude’s task. Undo puts it back as it was before the task, and what changed since is lost.',
          };
        }
        undone.add(path);
        tell();
        return { ok: true, changes: current };
      },
    } satisfies Pick<FactwrightApi, 'onRunChanges' | 'viewChange' | 'undoChange'>,
  };
}
