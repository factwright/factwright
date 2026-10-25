import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isProjectsPageFile,
  JOB_DOCS,
  type Job,
  localDate,
  resumeSent,
  WORKSPACE_PATHS,
} from '@factwright/core';
import {
  DEFAULT_TEMPLATE,
  FORMATS,
  fitReport,
  isRunt,
  lintProjectsPage,
  outputName,
  projectsDocxFile,
  type ResumeFormat,
  readConfidentialTerms,
  readProjectsPage,
  renderProjectsHtml,
} from '@factwright/engine';
import { RESUME_FONTS } from '../resume/fonts.ts';
import { resumeIn } from './letter.ts';
import { FOLDER_NAME } from './posting.ts';
import { privateProblems, privateProjects } from './private.ts';
import { type BuildResumeDeps, readText, rulesIn } from './resume.ts';
import { headerDifferences, listed } from './set.ts';

/** Where a job's Projects page's data is, beside its files. */
const PAGE_DATA = JOB_DOCS.projects;

/**
 * Which of a Projects page's files could have gone out with the application: those there by the
 * day the user applied, which stay as they were. One made since, such as for an interview, can
 * be built again. With a status past applying but no day on file, every one there stays, as a
 * resume does.
 */
async function pagesSent(job: Job | undefined, dir: string, files: readonly string[]) {
  if (!job || !resumeSent(job)) return [];
  const sent: string[] = [];
  for (const file of files) {
    const made = await stat(join(dir, file)).catch(() => null);
    if (made && (!job.appliedOn || localDate(made.mtime) <= job.appliedOn)) sent.push(file);
  }
  return sent;
}

/**
 * Builds a job's Projects page from its projects-page.json, as a PDF, a Word file or both, named
 * after its output_name, beside the data. It's in the job's resume's template unless the page
 * names its own, with the same header, so the two look like a set: a header that differs from
 * the resume's is a problem to fix. Checks it against the user's rules and confidential terms,
 * and says how it fits: one page, how full, and which lines end on a word or two. A job that was
 * applied to keeps the files that were sent.
 */
export async function buildProjectsPage(
  folder: string,
  format: string | undefined,
  deps: BuildResumeDeps,
): Promise<string> {
  if (!FOLDER_NAME.test(folder)) {
    return `“${folder}” isn’t a job folder. Use the job folder’s own name, such as 2026-10-11-acme-staff-engineer.`;
  }
  if (format !== undefined && !(FORMATS as readonly string[]).includes(format)) {
    return `The format should be ${FORMATS.join(', ')}.`;
  }
  const where = `${WORKSPACE_PATHS.jobs}/${folder}`;
  const dir = join(deps.workspace, WORKSPACE_PATHS.jobs, folder);
  const text = await readText(join(dir, PAGE_DATA));
  if (text === null) return `There’s no ${where}/${PAGE_DATA} yet. Write the page there first.`;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return `${where}/${PAGE_DATA} isn’t valid JSON: ${error instanceof Error ? error.message : 'it doesn’t parse'}.`;
  }
  const read = readProjectsPage(data);
  if (!read.ok) {
    return [`Not built. Fix ${PAGE_DATA} first:`, ...read.problems.map((p) => `- ${p}`)].join('\n');
  }
  const { page } = read;
  const resume = await resumeIn(dir);
  const found = deps.templates.find(page.layout ?? resume?.layout ?? DEFAULT_TEMPLATE);
  if (!found.ok) {
    return `Not built: ${found.message}${found.missing ? ` Set layout in ${PAGE_DATA} to one of them.` : ''}`;
  }
  const { template } = found;
  const name = outputName(page, deps.now?.() ?? new Date(), 'Projects');
  if (!isProjectsPageFile(name)) {
    return `Not built: the files’ name, ${name}, has to say Projects and the date, such as AlexRiveraProjects10202026_Acme, so the app keeps them apart from the resume. Change output_name in ${PAGE_DATA}.`;
  }
  const make = (format ?? page.format ?? 'pdf') as ResumeFormat;
  const files = [
    ...(make === 'pdf' || make === 'both' ? [`${name}.pdf`] : []),
    ...(make === 'docx' || make === 'both' ? [`${name}.docx`] : []),
  ];
  const job = deps.jobs().find((each) => each.folder === folder);
  const sent = await pagesSent(job, dir, files);
  if (sent.length > 0) {
    return `Not built: ${sent.join(' and ')} was made by the day the user applied, so it may have gone out with the application, and it stays as it was. Give ${PAGE_DATA} a new output_name to build another.`;
  }

  const { rules, problem: rulesProblem } = await rulesIn(deps.workspace);
  const confidential = readConfidentialTerms(
    await readText(join(deps.workspace, 'guide', 'confidential-terms.txt')),
  );
  const differs = resume ? headerDifferences(page, resume) : [];
  const problems = [
    ...(rulesProblem ? [rulesProblem] : []),
    ...lintProjectsPage(page, rules, confidential),
    ...privateProblems(page, await privateProjects(deps.workspace), 'Projects page'),
    ...(differs.length > 0
      ? [
          `The page’s ${listed(differs)} ${differs.length === 1 ? 'doesn’t' : 'don’t'} match resume.json’s. Copy ${differs.length === 1 ? 'it' : 'them'} from there, so the two look like a set.`,
        ]
      : []),
  ];
  const report: string[] = [];

  const html = renderProjectsHtml(page, template, RESUME_FONTS);
  if (files.some((file) => file.endsWith('.pdf'))) {
    const printed = await deps.printer.print(html);
    deps.keep?.(join(dir, `${name}.pdf`));
    await writeFile(join(dir, `${name}.pdf`), printed.pdf);
    const fill = printed.lastFill === null ? '' : `, ${printed.lastFill}% full`;
    const pages = printed.pages === 1 ? '1 page' : `${printed.pages} pages`;
    report.push(
      `Built ${where}/${name}.pdf in the ${template.name} template, as ${page.shape ?? 'list'}: ${pages}${fill}.`,
    );
    if (printed.pages > 1) {
      problems.push(
        `The page runs to ${pages}; a Projects page fits on one. Trim it, or show fewer projects.`,
      );
    }
  }
  if (files.some((file) => file.endsWith('.docx'))) {
    const docx = Buffer.from(await projectsDocxFile(page, template));
    deps.keep?.(join(dir, `${name}.docx`));
    await writeFile(join(dir, `${name}.docx`), docx);
    report.push(
      `Built ${where}/${name}.docx. Word lays it out itself, one column, so check it fits one page there too.`,
    );
  }
  if (!resume) {
    report.push(
      `The job has no resume.json, so the header wasn’t checked against it. It should match the resume the user sends.`,
    );
  } else if (page.layout && page.layout !== (resume.layout ?? DEFAULT_TEMPLATE)) {
    report.push(`The page names its own template, so it doesn’t match the resume’s.`);
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
      ? 'Read the PDF to check how it reads and sits on the page.'
      : 'To see the layout, build both: you can read the PDF, but not the Word file.',
  );
  return report.join('\n');
}
