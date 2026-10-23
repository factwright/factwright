import { describe, expect, it } from 'vitest';
import type { BoundChanges } from '../jobs/versions.ts';
import { requestedChanges } from './changes.ts';

const changes: BoundChanges = {
  jobId: 'acme--staff',
  kind: 'letter',
  changes: 'Make it shorter.\n## Open with why I want to work there',
  at: '2026-10-15T14:30:12.000Z',
  folder: '2026-10-07-acme-robotics-staff-engineer',
  previous: 'applications/2026-10-07-acme-robotics-staff-engineer/previous/2026-10-15-093012',
};

describe('requested_changes', () => {
  it('says there are none in a run that wasn’t started to make them', () => {
    expect(requestedChanges(undefined)).toMatch(/^This run wasn’t started with Request changes/);
  });

  it('gives the user’s words, each line quoted, with where the version before is kept', () => {
    expect(requestedChanges(changes)).toBe(
      [
        '# Changes to the cover letter in applications/2026-10-07-acme-robotics-staff-engineer/',
        'The user typed these in the app for this run, in their own words. Make them in cover-letter.json, keeping to the rules and to what the fact bank backs, then build it again under the same name.',
        '- **The version before** is kept in applications/2026-10-07-acme-robotics-staff-engineer/previous/2026-10-15-093012/.',
        '',
        '## What the user asked for',
        '> Make it shorter.',
        '> ## Open with why I want to work there',
      ].join('\n'),
    );
  });
});
