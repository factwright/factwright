import { NO_HISTORY, positionsOf, readHistory, type WorkHistory } from '@factwright/core';

/**
 * Profile's work history and education as Claude reads and saves them: every position the user
 * held, newest first, under the company it was at, so several positions at one company stay
 * apart, and every school.
 */

/** A date as the work history keeps it, in words: "2021-03" stays, and "present" says so. */
const when = (start: string, end: string) =>
  [start || 'start not known', end === 'present' ? 'present' : end || 'end not known'].join(' to ');

/** The work history and education, as about_you shows them. */
export function historyText(history: WorkHistory): string {
  if (history.jobs.length === 0 && history.schools.length === 0) {
    return [
      '## Work history and education',
      'None in Profile yet. The work-history skill fills them in from the fact bank and resumes.',
    ].join('\n');
  }
  const lines = [
    '## Work history',
    'Each position the user held, newest first, under its company.',
  ];
  for (const job of history.jobs) {
    lines.push(`- ${job.company}${job.location ? `, ${job.location}` : ''}`);
    for (const position of job.positions) {
      lines.push(
        `  - ${position.title}, ${when(position.start, position.end)}${
          position.summary ? `: ${position.summary.replace(/\s+/g, ' ')}` : ''
        }`,
      );
    }
  }
  if (history.jobs.length === 0) lines.push('- None yet.');
  lines.push('', '## Education');
  for (const school of history.schools) {
    const studied = [school.degree, school.field].filter(Boolean).join(', ');
    lines.push(
      `- ${school.school}${studied ? `: ${studied}` : ''}, ${when(school.start, school.end)}`,
    );
  }
  if (history.schools.length === 0) lines.push('- None yet.');
  return lines.join('\n');
}

/** What a saved history was left without, as it didn't hold up: entries, and dates. */
function leftOut(input: unknown, kept: WorkHistory): string[] {
  const given =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  const notes: string[] = [];
  const jobs = count(given.jobs);
  if (jobs > kept.jobs.length) {
    notes.push(`${jobs - kept.jobs.length} company with no name or no titled position`);
  }
  const schools = count(given.schools);
  if (schools > kept.schools.length)
    notes.push(`${schools - kept.schools.length} school with no name`);
  const datesGiven = JSON.stringify(given).match(/"(start|end)":"[^"]+"/g)?.length ?? 0;
  const datesKept =
    positionsOf(kept)
      .flatMap((each) => [each.start, each.end])
      .filter(Boolean).length +
    kept.schools.flatMap((each) => [each.start, each.end]).filter(Boolean).length;
  if (datesGiven > datesKept) {
    notes.push(`${datesGiven - datesKept} date that wasn’t YYYY-MM, YYYY or present, left blank`);
  }
  return notes;
}

/**
 * Saves the work history and education whole, in place of what's there, as checked, and says
 * what was kept, and what was left out because it didn't hold up.
 */
export function saveHistory(
  input: unknown,
  about: { saveHistory(history: WorkHistory): WorkHistory },
): string {
  const kept = about.saveHistory(readHistory(input ?? NO_HISTORY));
  const positions = positionsOf(kept).length;
  const notes = leftOut(input, kept);
  return [
    `Saved the work history: ${kept.jobs.length} ${kept.jobs.length === 1 ? 'company' : 'companies'} with ${positions} ${positions === 1 ? 'position' : 'positions'}, and ${kept.schools.length} ${kept.schools.length === 1 ? 'school' : 'schools'}.`,
    notes.length > 0 ? `Left out: ${notes.join('; ')}. Give them again, whole, to keep them.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
