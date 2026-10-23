import { oneLine } from '../../shared/revision.ts';
import type { BoundChanges } from '../jobs/versions.ts';

const WHAT = { resume: 'resume', letter: 'cover letter' } as const;

const DATA = { resume: 'resume.json', letter: 'cover-letter.json' } as const;

/**
 * The changes the user asked for in a job's resume or cover letter, for the run started to make
 * them, or why there are none. The user typed them in the app, and they reach the run here, never
 * as words typed into it.
 */
export function requestedChanges(changes: BoundChanges | undefined): string {
  if (!changes) {
    return 'This run wasn’t started with Request changes, so there are no changes to make. Use job_details for the job’s files.';
  }
  const what = WHAT[changes.kind];
  return [
    `# Changes to the ${what} in applications/${oneLine(changes.folder)}/`,
    `The user typed these in the app for this run, in their own words. Make them in ${DATA[changes.kind]}, keeping to the rules and to what the fact bank backs, then build it again under the same name.`,
    changes.previous
      ? `- **The version before** is kept in ${oneLine(changes.previous)}/.`
      : '- **The version before** wasn’t kept.',
    '',
    '## What the user asked for',
    // Each line quoted, so nothing in it can start a part of its own.
    ...changes.changes.split(/\r?\n/).map((line) => `> ${line}`),
  ].join('\n');
}
