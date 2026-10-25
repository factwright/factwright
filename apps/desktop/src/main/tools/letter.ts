import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isCoverLetterFile, JOB_DOCS, WORKSPACE_PATHS } from '@factwright/core';
import {
  DEFAULT_TEMPLATE,
  FORMATS,
  fitReport,
  isRunt,
  LETTER_MEASURE_SCRIPT,
  letterDocxFile,
  letterWords,
  lintLetter,
  outputName,
  type Resume,
  type ResumeFormat,
  readConfidentialTerms,
  readLetter,
  readResume,
  renderLetterHtml,
} from '@factwright/engine';
import { RESUME_FONTS } from '../resume/fonts.ts';
import { FOLDER_NAME } from './posting.ts';
import { privateProblems, privateProjects } from './private.ts';
import { type BuildResumeDeps, keptAsSent, readText, rulesIn } from './resume.ts';
import { headerDifferences, listed } from './set.ts';

/** Where a job's cover letter's data is, beside its files. */
const LETTER_DATA = JOB_DOCS.letter;

/**
 * The job's tailored resume, when its folder has one that reads, which its letter and its
 * Projects page match.
 */
export async function resumeIn(dir: string): Promise<Resume | null> {
  const text = await readText(join(dir, 'resume.json'));
  if (text === null) return null;
  try {
    const read = readResume(JSON.parse(text));
    return read.ok ? read.resume : null;
  } catch {
    return null;
  }
}

/**
 * Builds a job's cover letter from its cover-letter.json, as a PDF, a Word file or both, named
 * after its output_name, beside the data. It's in the job's resume's template unless the letter
 * names its own, with the same header, so the two look like a set: a header that differs from
 * the resume's is a problem to fix. Checks it against the user's rules and confidential terms,
 * and the clichés every letter is checked for, and says how it fits: one page, and which
 * paragraphs end on a word or two. A job that was applied to keeps the files that were sent.
 */
export async function buildCoverLetter(
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
  const text = await readText(join(dir, LETTER_DATA));
  if (text === null) return `There’s no ${where}/${LETTER_DATA} yet. Write the letter there first.`;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return `${where}/${LETTER_DATA} isn’t valid JSON: ${error instanceof Error ? error.message : 'it doesn’t parse'}.`;
  }
  const read = readLetter(data);
  if (!read.ok) {
    return [`Not built. Fix ${LETTER_DATA} first:`, ...read.problems.map((p) => `- ${p}`)].join(
      '\n',
    );
  }
  const letter = read.letter;
  const resume = await resumeIn(dir);
  const found = deps.templates.find(letter.layout ?? resume?.layout ?? DEFAULT_TEMPLATE);
  if (!found.ok) {
    return `Not built: ${found.message}${found.missing ? ` Set layout in ${LETTER_DATA} to one of them.` : ''}`;
  }
  const { template } = found;
  const name = outputName(letter, deps.now?.() ?? new Date(), 'CoverLetter');
  if (!isCoverLetterFile(name)) {
    return `Not built: the files’ name, ${name}, has to say CoverLetter, such as AlexRiveraCoverLetter10142026_Acme, so the app keeps them apart from the resume. Change output_name in ${LETTER_DATA}.`;
  }
  const make = (format ?? letter.format ?? 'pdf') as ResumeFormat;
  const files = [
    ...(make === 'pdf' || make === 'both' ? [`${name}.pdf`] : []),
    ...(make === 'docx' || make === 'both' ? [`${name}.docx`] : []),
  ];
  const job = deps.jobs().find((each) => each.folder === folder);
  const sent = await keptAsSent(job, dir, files);
  if (sent.length > 0) {
    return `Not built: ${sent.join(' and ')} went out with the application, so it stays as sent. Give ${LETTER_DATA} a new output_name to build another.`;
  }

  const { rules, problem: rulesProblem } = await rulesIn(deps.workspace);
  const confidential = readConfidentialTerms(
    await readText(join(deps.workspace, 'guide', 'confidential-terms.txt')),
  );
  const differs = resume ? headerDifferences(letter, resume) : [];
  const problems = [
    ...(rulesProblem ? [rulesProblem] : []),
    ...lintLetter(letter, rules, confidential),
    ...privateProblems(letter, await privateProjects(deps.workspace), 'letter'),
    ...(differs.length > 0
      ? [
          `The letter’s ${listed(differs)} ${differs.length === 1 ? 'doesn’t' : 'don’t'} match resume.json’s. Copy ${differs.length === 1 ? 'it' : 'them'} from there, so the two look like a set.`,
        ]
      : []),
  ];
  const look = template.letter
    ? `the ${template.name} template`
    : `the ${template.name} template’s fonts and colors (it has no letter layout of its own, so the letter is plain)`;
  const report: string[] = [];

  const html = renderLetterHtml(letter, template, RESUME_FONTS);
  if (files.some((file) => file.endsWith('.pdf'))) {
    const printed = await deps.printer.print(html);
    deps.keep?.(join(dir, `${name}.pdf`));
    await writeFile(join(dir, `${name}.pdf`), printed.pdf);
    const fill = printed.lastFill === null ? '' : `, ${printed.lastFill}% full`;
    const pages = printed.pages === 1 ? '1 page' : `${printed.pages} pages`;
    report.push(`Built ${where}/${name}.pdf in ${look}: ${pages}${fill}.`);
    if (printed.pages > 1)
      problems.push(`The letter runs to ${pages}; a cover letter fits on one.`);
  }
  if (files.some((file) => file.endsWith('.docx'))) {
    const docx = Buffer.from(await letterDocxFile(letter, template));
    deps.keep?.(join(dir, `${name}.docx`));
    await writeFile(join(dir, `${name}.docx`), docx);
    report.push(
      `Built ${where}/${name}.docx. Word lays it out itself, so check it fits one page there too.`,
    );
  }
  if (!resume) {
    report.push(
      `The job has no resume.json, so the header wasn’t checked against it. It should match the resume the user sends.`,
    );
  } else if (letter.layout && letter.layout !== (resume.layout ?? DEFAULT_TEMPLATE)) {
    report.push(`The letter names its own template, so it doesn’t match the resume’s.`);
  }
  report.push(
    `${letterWords(letter)} words in ${letter.paragraphs.length} paragraph${letter.paragraphs.length === 1 ? '' : 's'}.`,
  );

  const rows = await deps.printer.measure(html, LETTER_MEASURE_SCRIPT);
  const runts = rows.filter(isRunt);
  report.push(
    runts.length > 0
      ? fitReport(runts).replace(/^/, 'Paragraphs that end short:\n')
      : `Line fit: no paragraph ends on a word or two.`,
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
