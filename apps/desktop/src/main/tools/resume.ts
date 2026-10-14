import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Job, type JobStatus, WORKSPACE_PATHS } from '@factwright/core';
import {
  DEFAULT_MAX_PAGES,
  DEFAULT_TEMPLATE,
  docxFile,
  FORMATS,
  fitReport,
  isRunt,
  type LintConfig,
  lintResume,
  outputName,
  type ResumeFormat,
  readConfidentialTerms,
  readResume,
  renderHtml,
} from '@factwright/engine';
import { RESUME_FONTS } from '../resume/fonts.ts';
import type { ResumePrinter } from '../resume/printer.ts';
import type { TemplateLibrary } from '../resume/templates.ts';
import { FOLDER_NAME } from './posting.ts';

export interface BuildResumeDeps {
  workspace: string;
  printer: ResumePrinter;
  /** The templates the user can pick, built in and their own. */
  templates: Pick<TemplateLibrary, 'find'>;
  /** The jobs on file, to keep a resume that was sent. */
  jobs: () => readonly Job[];
  now?: () => Date;
}

/**
 * Statuses a job only reaches once the user has applied, and sent its resume. Passed and Role
 * closed can come before applying, so they go by the applied date alone.
 */
const SENT: readonly JobStatus[] = [
  'applied',
  'screen',
  'interview',
  'offer',
  'accepted',
  'declined',
  'rejected',
  'ghosted',
  'withdrawn',
];

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The user's resume rules, or why they can't be read. */
async function rulesIn(workspace: string): Promise<{ rules: LintConfig; problem: string | null }> {
  const text = await readText(join(workspace, 'guide', 'lint.json'));
  if (text === null) return { rules: {}, problem: null };
  try {
    return { rules: JSON.parse(text) as LintConfig, problem: null };
  } catch {
    return {
      rules: {},
      problem: 'guide/lint.json isn’t valid JSON, so its rules weren’t checked.',
    };
  }
}

/**
 * A starting resume's name in base/, such as "startup-ic" for base/startup-ic.json, or with a
 * kind of job's folder after the first, "project-manager/startup-ic".
 */
const BASE_NAME = /^base\/(?:([a-z0-9][a-z0-9-]{0,39})\/)?([a-z0-9][a-z0-9-]{0,80})$/;

/** Where a resume's data is and its files go: a job's folder, or a starting resume in base/. */
export function resumeAt(workspace: string, folder: string) {
  const [, kind, base] = BASE_NAME.exec(folder) ?? [];
  if (base) {
    const where = kind ? `base/${kind}` : 'base';
    return { where, dir: join(workspace, ...where.split('/')), data: `${base}.json`, isJob: false };
  }
  if (!FOLDER_NAME.test(folder)) return null;
  return {
    where: `${WORKSPACE_PATHS.jobs}/${folder}`,
    dir: join(workspace, WORKSPACE_PATHS.jobs, folder),
    data: 'resume.json',
    isJob: true,
  };
}

/**
 * Builds a resume from its data: a job's resume.json, or a starting resume in base/. It makes a
 * PDF, a Word file, or both, named after its output_name, beside the data. Checks it against the
 * user's rules and confidential terms, and says how it fits the pages: how many, how full the
 * last one is, and which lines run short. A job that was applied to keeps the files that were
 * sent.
 */
export async function buildResume(
  folder: string,
  format: string | undefined,
  deps: BuildResumeDeps,
): Promise<string> {
  const at = resumeAt(deps.workspace, folder);
  if (!at) {
    return `“${folder}” isn’t a job folder or a starting resume. Use the job folder’s own name, such as 2026-10-11-acme-staff-engineer, or base/<name> for base/<name>.json, or base/<kind>/<name> for a kind of job’s.`;
  }
  if (format !== undefined && !(FORMATS as readonly string[]).includes(format)) {
    return `The format should be ${FORMATS.join(', ')}.`;
  }
  const { where, dir } = at;
  const source = `${where}/${at.data}`;
  const text = await readText(join(dir, at.data));
  if (text === null) return `There’s no ${source} yet. Write the resume there first.`;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return `${source} isn’t valid JSON: ${error instanceof Error ? error.message : 'it doesn’t parse'}.`;
  }
  const read = readResume(data);
  if (!read.ok)
    return [`Not built. Fix ${at.data} first:`, ...read.problems.map((p) => `- ${p}`)].join('\n');
  const resume = read.resume;
  const found = deps.templates.find(resume.layout ?? DEFAULT_TEMPLATE);
  if (!found.ok) {
    return `Not built: ${found.message}${found.missing ? ` Set layout in ${at.data} to one of them.` : ''}`;
  }
  const { template } = found;
  const make = (format ?? resume.format ?? 'pdf') as ResumeFormat;
  const name = outputName(resume, deps.now?.() ?? new Date());
  const files = [
    ...(make === 'pdf' || make === 'both' ? [`${name}.pdf`] : []),
    ...(make === 'docx' || make === 'both' ? [`${name}.docx`] : []),
  ];

  const job = at.isJob ? deps.jobs().find((each) => each.folder === folder) : undefined;
  if (job && (job.appliedOn || (job.status && SENT.includes(job.status)))) {
    const sent = [];
    for (const file of files) if (await exists(join(dir, file))) sent.push(file);
    if (sent.length > 0) {
      return `Not built: ${sent.join(' and ')} went out with the application, so it stays as sent. Give ${at.data} a new output_name to build another.`;
    }
  }

  const { rules, problem: rulesProblem } = await rulesIn(deps.workspace);
  const confidential = readConfidentialTerms(
    await readText(join(deps.workspace, 'guide', 'confidential-terms.txt')),
  );
  const problems = [
    ...(rulesProblem ? [rulesProblem] : []),
    ...lintResume(resume, rules, confidential),
  ];
  const maxPages = rules.maxPages ?? DEFAULT_MAX_PAGES;
  const report: string[] = [];

  const html = renderHtml(resume, template, RESUME_FONTS);
  if (files.some((file) => file.endsWith('.pdf'))) {
    const printed = await deps.printer.print(html);
    await writeFile(join(dir, `${name}.pdf`), printed.pdf);
    const fill = printed.lastFill === null ? '' : `, the last one ${printed.lastFill}% full`;
    report.push(
      `Built ${where}/${name}.pdf in the ${template.name} template: ${printed.pages} pages${fill}.`,
    );
    if (printed.pages > maxPages)
      problems.push(`The PDF runs to ${printed.pages} pages; the most is ${maxPages}.`);
  }
  if (files.some((file) => file.endsWith('.docx'))) {
    await writeFile(join(dir, `${name}.docx`), Buffer.from(await docxFile(resume, template)));
    report.push(
      `Built ${where}/${name}.docx. Word lays it out itself, so its page count can differ from the PDF’s.`,
    );
  }

  const rows = await deps.printer.measure(html);
  const runts = rows.filter(isRunt);
  report.push(
    runts.length > 0
      ? fitReport(runts).replace(/^/, 'Lines that run short:\n')
      : `Line fit: no runt lines in ${rows.length} pieces of text.`,
  );
  report.push(
    problems.length > 0
      ? ['Problems to fix, then build again:', ...problems.map((p) => `- ${p}`)].join('\n')
      : 'Checks: clean.',
  );
  report.push(
    files.some((file) => file.endsWith('.pdf'))
      ? 'Read the PDF to check the page breaks and anything that looks off.'
      : 'To see the layout, build both: you can read the PDF, but not the Word file.',
  );
  return report.join('\n');
}
