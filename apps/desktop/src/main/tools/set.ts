import type { CoverLetter, Resume } from '@factwright/engine';

const CONTACT = ['phone', 'email', 'linkedin', 'location', 'website'] as const;

/**
 * Where a cover letter's header differs from its resume's, so the two wouldn't look like a set:
 * its name, headline or contact details.
 */
export function headerDifferences(
  letter: Pick<CoverLetter, 'name' | 'headline' | 'contact'>,
  resume: Resume,
): string[] {
  return [
    ...(letter.name !== resume.name ? ['name'] : []),
    ...((letter.headline ?? '') !== resume.headline ? ['headline'] : []),
    ...CONTACT.filter(
      (kind) => (letter.contact?.[kind] ?? '') !== (resume.contact?.[kind] ?? ''),
    ).map((kind) => `contact.${kind}`),
  ];
}

/** A list of things in words: "name", "name and headline", "name, headline and contact.email". */
export const listed = (things: readonly string[]): string =>
  things.length < 2 ? things.join('') : `${things.slice(0, -1).join(', ')} and ${things.at(-1)}`;
