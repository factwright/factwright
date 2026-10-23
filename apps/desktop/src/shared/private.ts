import {
  type EqualOpportunity,
  type KeptPrivate,
  NO_EQUAL_OPPORTUNITY,
  NO_PRIVATE,
} from '@factwright/core';

/**
 * What Profile keeps for applications on this computer alone: your street, your postal code and
 * your equal-opportunity answers. They're in the profile's data folder, beside the job tracker, not
 * in the workspace, so they never sync, and Claude's tools never reach them. The extension fills
 * forms with them, and only as you set them.
 */

/** The file, in the profile's data folder. */
export const PRIVATE_FILE = 'private-answers.json';

/** The longest a street or postal code may be. */
const LINE = 200;

/** Each equal-opportunity question, with its answers as Profile offers them. */
export const EQUAL_OPPORTUNITY_QUESTIONS = [
  {
    key: 'gender',
    label: 'Gender',
    answers: [
      ['', 'Leave it for me'],
      ['woman', 'Woman'],
      ['man', 'Man'],
      ['non-binary', 'Non-binary'],
      ['decline', 'I’d rather not say'],
    ],
  },
  {
    key: 'hispanic',
    label: 'Hispanic or Latino',
    answers: [
      ['', 'Leave it for me'],
      ['yes', 'Yes'],
      ['no', 'No'],
      ['decline', 'I’d rather not say'],
    ],
  },
  {
    key: 'race',
    label: 'Race',
    answers: [
      ['', 'Leave it for me'],
      ['american-indian', 'American Indian or Alaska Native'],
      ['asian', 'Asian'],
      ['black', 'Black or African American'],
      ['hispanic', 'Hispanic or Latino'],
      ['pacific-islander', 'Native Hawaiian or Other Pacific Islander'],
      ['white', 'White'],
      ['two-or-more', 'Two or more races'],
      ['decline', 'I’d rather not say'],
    ],
  },
  {
    key: 'veteran',
    label: 'Protected veteran',
    answers: [
      ['', 'Leave it for me'],
      ['no', 'No'],
      ['yes', 'Yes'],
      ['decline', 'I’d rather not say'],
    ],
  },
  {
    key: 'disability',
    label: 'Disability',
    answers: [
      ['', 'Leave it for me'],
      ['no', 'No'],
      ['yes', 'Yes'],
      ['decline', 'I’d rather not say'],
    ],
  },
] as const satisfies readonly {
  key: keyof EqualOpportunity;
  label: string;
  answers: readonly (readonly [string, string])[];
}[];

/** An equal-opportunity answer, or undefined when it isn't one Profile offers. */
function equalOpportunity(value: unknown): EqualOpportunity | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  const read: Record<string, string> = {};
  for (const { key, answers } of EQUAL_OPPORTUNITY_QUESTIONS) {
    const answer = fields[key] ?? '';
    if (!answers.some(([each]) => each === answer)) return undefined;
    read[key] = answer as string;
  }
  return read as unknown as EqualOpportunity;
}

const line = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length <= LINE ? value : undefined;

/**
 * What's kept, as read from its file: each part that doesn't hold up falls back to nothing told,
 * so one bad part never loses the rest.
 */
export function readPrivate(value: unknown): KeptPrivate {
  const fields =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    street: line(fields.street) ?? NO_PRIVATE.street,
    postalCode: line(fields.postalCode) ?? NO_PRIVATE.postalCode,
    equalOpportunity: equalOpportunity(fields.equalOpportunity) ?? NO_EQUAL_OPPORTUNITY,
  };
}

/** Changes from the window, checked, or null if any doesn't hold up, so nothing is half saved. */
export function parsePrivateChanges(value: unknown): Partial<KeptPrivate> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const changes: Partial<KeptPrivate> = {};
  for (const [key, change] of Object.entries(value)) {
    if (key === 'street' || key === 'postalCode') {
      const read = line(change);
      if (read === undefined) return null;
      changes[key] = read;
    } else if (key === 'equalOpportunity') {
      const read = equalOpportunity(change);
      if (read === undefined) return null;
      changes.equalOpportunity = read;
    } else {
      return null;
    }
  }
  return changes;
}
