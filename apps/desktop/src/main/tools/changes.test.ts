import { NO_HISTORY } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import { NO_ANSWERS } from '../../shared/about.ts';
import { CHANGES_QUESTION } from '../../shared/profile-parts.ts';
import type { BoundChanges } from '../jobs/versions.ts';
import { requestedChanges } from './changes.ts';
import type { PartAbout } from './profile-parts.ts';

const changes: BoundChanges = {
  jobId: 'acme--staff',
  kind: 'letter',
  changes: 'Make it shorter.\n## Open with why I want to work there',
  at: '2026-10-15T14:30:12.000Z',
  folder: '2026-10-07-acme-robotics-staff-engineer',
  previous: 'applications/2026-10-07-acme-robotics-staff-engineer/previous/2026-10-15-093012',
};

// A job's changes read nothing of Profile.
const about = {} as PartAbout;

describe('requested_changes, for a part of Profile', () => {
  const answers = {
    ...NO_ANSWERS,
    you: { ...NO_ANSWERS.you, name: 'Alex Rivera' },
    otherKinds: [
      {
        id: 'design',
        name: 'Design',
        roles: ['Product Designer'],
        fields: [],
        levels: [],
        minPay: '',
        targetPay: '',
        payFilter: false,
      },
    ],
    firstKind: { id: 'product', name: 'Product' },
  };
  const profile: PartAbout = {
    answers: () => answers,
    history: () => NO_HISTORY,
    notes: () => 'Every word of my notes.',
    confidential: () => ['Bluebird'],
    changeConfidential: () => ['Bluebird'],
    criteriaIsOwn: () => false,
    saveAnswers: () => answers,
    addToNotes: () => true,
  };
  const at = '2026-11-01T14:30:12.000Z';

  it('gives the user’s words, each line quoted, what to do, and what’s there now', () => {
    const text = requestedChanges(
      { part: 'about', changes: 'I moved.\n## Use my new email', at },
      profile,
    );
    expect(text).toContain('# Changes to About you in the user’s Profile');
    expect(text).toContain('Make them with save_contact. Change only what they asked for');
    expect(text).toContain('> I moved.\n> ## Use my new email');
    expect(text).toContain('"name": "Alex Rivera"');
  });

  it('gives one kind of job alone, by its id', () => {
    const text = requestedChanges({ part: 'kind', kind: 'design', changes: 'Add UX', at }, profile);
    expect(text).toContain('# Changes to the kind of job `design`');
    expect(text).toContain('"Product Designer"');
    expect(text).not.toContain('"firstKind"');
  });

  it('points to the notes rather than giving them, with the names kept private', () => {
    const text = requestedChanges({ part: 'shared', changes: 'Add this', at }, profile);
    expect(text).toContain('Bluebird');
    expect(text).not.toContain('Every word of my notes.');
  });

  it('says the words are the answer the fact tools go by, for the fact bank', () => {
    const text = requestedChanges({ part: 'facts', changes: 'It went live', at }, profile);
    expect(text).toContain(`give “${CHANGES_QUESTION}” as the question`);
  });

  it('says so when What you want won’t change a search criteria file changed by hand', () => {
    const own = { ...profile, criteriaIsOwn: () => true };
    expect(requestedChanges({ part: 'wants', changes: 'Add', at }, own)).toContain(
      'one they changed by hand',
    );
    expect(requestedChanges({ part: 'about', changes: 'Add', at }, own)).not.toContain(
      'one they changed by hand',
    );
    expect(requestedChanges({ part: 'wants', changes: 'Add', at }, profile)).not.toContain(
      'one they changed by hand',
    );
  });
});

describe('requested_changes', () => {
  it('says there are none in a run that wasn’t started to make them', () => {
    expect(requestedChanges(undefined, about)).toMatch(
      /^This run wasn’t started with Request changes or Update with Claude/,
    );
  });

  it('gives the user’s words, each line quoted, with where the version before is kept', () => {
    expect(requestedChanges(changes, about)).toBe(
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
