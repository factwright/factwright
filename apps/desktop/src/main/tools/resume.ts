import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Job, type JobStatus, WORKSPACE_PATHS } from '@factwright/core';
import {
  DEFAULT_MAX_PAGES,
  docxFile,
  FORMATS,
  fitReport,
  isRunt,
  type Layout,
  type LintConfig,
  lintResume,
  outputName,
  type ResumeFormat,
  readConfidentialTerms,
  readResume,
  renderHtml,
} from '@factwright/engine';
import type { ResumePrinter } from '../resume/printer.ts';
import { FOLDER_NAME } from './posting.ts';

export interface BuildResumeDeps {
  workspace: string;
  printer: ResumePrinter;
  /** The jobs on file, to keep a resume that was sent. */
  jobs: () => readonly Job[];
  now?: () => Date;
}

/** Statuses a job only reaches once the user has applied, and sent its resume. */
const SENT: readonly JobStatus[] = [
  'applied',
  'screen',
  'interview',
  'offer',
  'accepted',
  'declined',
  'rejected',
  'ghosted',
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
 * Builds the resume in a job's folder from its resume.json: a PDF, a Word file, or both, named
 * after its output_name. Checks it against the user's rules and confidential terms, and says how
 * it fits the pages: how many, how full the last one is, and which lines run short. A job that
 * was applied to keeps the files that were sent.
 */
export async function buildResume(
  folder: string,
  format: string | undefined,
  deps: BuildResumeDeps,
): Promise<string> {
  if (!FOLDER_NAME.test(folder)) {
    return `“${folder}” isn’t a job folder name. Use the folder’s own name, such as 2026-10-11-acme-staff-engineer.`;
  }
  if (format !== undefined && !(FORMATS as readonly string[]).includes(format)) {
    return `The format should be ${FORMATS.join(', ')}.`;
  }
  const where = `${WORKSPACE_PATHS.jobs}/${folder}`;
  const dir = join(deps.workspace, WORKSPACE_PATHS.jobs, folder);
  const text = await readText(join(dir, 'resume.json'));
  if (text === null) return `There’s no ${where}/resume.json yet. Write the resume there first.`;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return `${where}/resume.json isn’t valid JSON: ${error instanceof Error ? error.message : 'it doesn’t parse'}.`;
  }
  const read = readResume(data);
  if (!read.ok)
    return [`Not built. Fix resume.json first:`, ...read.problems.map((p) => `- ${p}`)].join('\n');
  const resume = read.resume;
  const layout = (resume.layout ?? 'timeline') as Layout;
  const make = (format ?? resume.format ?? 'pdf') as ResumeFormat;
  const name = outputName(resume, deps.now?.() ?? new Date());
  const files = [
    ...(make === 'pdf' || make === 'both' ? [`${name}.pdf`] : []),
    ...(make === 'docx' || make === 'both' ? [`${name}.docx`] : []),
  ];

  const job = deps.jobs().find((each) => each.folder === folder);
  if (job && (job.appliedOn || (job.status && SENT.includes(job.status)))) {
    const sent = [];
    for (const file of files) if (await exists(join(dir, file))) sent.push(file);
    if (sent.length > 0) {
      return `Not built: ${sent.join(' and ')} went out with the application, so it stays as sent. Give resume.json a new output_name to build another.`;
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

  const html = renderHtml(resume, layout);
  if (files.some((file) => file.endsWith('.pdf'))) {
    const printed = await deps.printer.print(html);
    await writeFile(join(dir, `${name}.pdf`), printed.pdf);
    const fill = printed.lastFill === null ? '' : `, the last one ${printed.lastFill}% full`;
    report.push(
      `Built ${where}/${name}.pdf in the ${layout} layout: ${printed.pages} pages${fill}.`,
    );
    if (printed.pages > maxPages)
      problems.push(`The PDF runs to ${printed.pages} pages; the most is ${maxPages}.`);
  }
  if (files.some((file) => file.endsWith('.docx'))) {
    await writeFile(join(dir, `${name}.docx`), Buffer.from(await docxFile(resume, layout)));
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
