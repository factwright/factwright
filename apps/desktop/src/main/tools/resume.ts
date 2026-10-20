import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JOB_DOCS, type Job, resumeSent, WORKSPACE_PATHS } from '@factwright/core';
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
  type Resume,
  type ResumeFormat,
  readConfidentialTerms,
  readLetter,
  readResume,
  renderHtml,
  resumeLeavesOut,
} from '@factwright/engine';
import { RESUME_FONTS } from '../resume/fonts.ts';
import type { ResumePrinter } from '../resume/printer.ts';
import type { TemplateLibrary } from '../resume/templates.ts';
import { FOLDER_NAME } from './posting.ts';
import { privateProblems, privateProjects } from './private.ts';
import { headerDifferences, listed } from './set.ts';

export interface BuildResumeDeps {
  workspace: string;
  printer: ResumePrinter;
  /** The templates the user can pick, built in and their own. */
  templates: Pick<TemplateLibrary, 'find'>;
  /** The jobs on file, to keep a resume that was sent. */
  jobs: () => readonly Job[];
  now?: () => Date;
}

export async function readText(path: string): Promise<string | null> {
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
export async function rulesIn(
  workspace: string,
): Promise<{ rules: LintConfig; problem: string | null }> {
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
 * Which of a job's files would be built over ones that went out with the application: any that
 * are there once the user has applied. Those stay as sent.
 */
export async function keptAsSent(
  job: Job | undefined,
  dir: string,
  files: readonly string[],
): Promise<string[]> {
  if (!job || !resumeSent(job)) return [];
  const sent = [];
  for (const file of files) if (await exists(join(dir, file))) sent.push(file);
  return sent;
}

/**
 * A note when the job's cover letter no longer has this resume's header, such as after the
 * headline changed, so the two stay a set. Nothing when there's no letter, or it won't read.
 */
async function letterOutOfStep(dir: string, resume: Resume): Promise<string | null> {
  const text = await readText(join(dir, JOB_DOCS.letter));
  if (text === null) return null;
  let read: ReturnType<typeof readLetter>;
  try {
    read = readLetter(JSON.parse(text));
  } catch {
    return null;
  }
  const differs = read.ok ? headerDifferences(read.letter, resume) : [];
  if (differs.length === 0) return null;
  return `The job’s cover letter no longer matches this resume: its ${listed(differs)} differ${differs.length === 1 ? 's' : ''}. Copy the header from resume.json into ${JOB_DOCS.letter}, then build the letter again with build_cover_letter, so the two look like a set.`;
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
  const sent = await keptAsSent(job, dir, files);
  if (sent.length > 0) {
    return `Not built: ${sent.join(' and ')} went out with the application, so it stays as sent. Give ${at.data} a new output_name to build another.`;
  }

  const { rules, problem: rulesProblem } = await rulesIn(deps.workspace);
  const confidential = readConfidentialTerms(
    await readText(join(deps.workspace, 'guide', 'confidential-terms.txt')),
  );
  const problems = [
    ...(rulesProblem ? [rulesProblem] : []),
    ...lintResume(resume, rules, confidential),
    ...privateProblems(resume, await privateProjects(deps.workspace), 'resume'),
  ];
  const maxPages = rules.maxPages ?? DEFAULT_MAX_PAGES;
  const report: string[] = [];

  const html = renderHtml(resume, template, RESUME_FONTS);
  if (files.some((file) => file.endsWith('.pdf'))) {
    // A template of the user's own can drop a part of the resume without anyone seeing. The
    // Word file shows every part, whatever the template.
    const dropped = resumeLeavesOut(template, resume);
    if (dropped.length > 0) {
      problems.push(
        `The ${template.name} template leaves out ${listed(dropped)}, so the PDF wouldn’t show all of ${at.data}. Use a template that shows everything in it, or take out what this one drops, and tell the user their template drops it.`,
      );
    }
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

  const out = at.isJob ? await letterOutOfStep(dir, resume) : null;
  if (out) report.push(out);

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
