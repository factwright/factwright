/**
 * A cover letter's files, by their name: the cover-letter skill names them like the resume's,
 * such as "AlexRiveraCoverLetter10142026_Acme.pdf", and one the user made themselves usually says
 * so too, such as "Acme cover letter.pdf". Every other PDF or Word file in a job's folder is a
 * resume.
 */
export const isCoverLetterFile = (name: string): boolean => /cover[\s_-]?letter/i.test(name);

/** A cover letter as the app shows it, from the job's cover-letter.json. */
export interface LetterText {
  date: string | null;
  /** Who it's to, a line each. */
  recipient: string[];
  greeting: string;
  paragraphs: string[];
  closing: string;
  /** The name under the closing. */
  signature: string;
}

const line = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const lines = (value: unknown) =>
  Array.isArray(value) ? value.map(line).filter(Boolean) : ([] as string[]);

/**
 * A job's cover letter, from its cover-letter.json, or null when there's none or it won't read.
 * The engine checks a letter properly before it's built. This only reads what there is to show,
 * so a letter half written shows what it has.
 */
export function readLetterText(json: string | null | undefined): LetterText | null {
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const letter = value as Record<string, unknown>;
  const paragraphs = lines(letter.paragraphs);
  if (paragraphs.length === 0) return null;
  return {
    date: line(letter.date) || null,
    recipient: lines(letter.recipient),
    greeting: line(letter.greeting),
    paragraphs,
    closing: line(letter.closing),
    signature: line(letter.signature) || line(letter.name),
  };
}

/** Text with its **bold** marks taken out, as it reads pasted into a form. */
const unmarked = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1');

/**
 * The letter as plain text, for an application form with a box for one: the greeting, each
 * paragraph, then the closing and the name, a blank line between each. No date or address, which
 * a form doesn't need.
 */
export function letterPlainText(letter: LetterText): string {
  const sign = [letter.closing, letter.signature].filter(Boolean).join('\n');
  return [letter.greeting, ...letter.paragraphs, sign].filter(Boolean).map(unmarked).join('\n\n');
}

/** How many words a letter's paragraphs hold. */
export const letterWordCount = (letter: LetterText): number =>
  letter.paragraphs.join(' ').split(/\s+/).filter(Boolean).length;

/** A cover letter, however it's written: "cover letter", "cover-letter" or "cover letters". */
const LETTER = String.raw`cover[\s-]?letters?`;

/**
 * Ways of saying a cover letter isn't wanted, tied to the words "cover letter" themselves, so a
 * "no" about something else in the same sentence doesn't count: "No cover letter needed", "Cover
 * letter optional", "A cover letter is not required", "Don't send a cover letter".
 */
const WAIVERS = new RegExp(
  [
    String.raw`\bno\s+${LETTER}`,
    String.raw`\bno\s+need\s+for\s+(?:a\s+)?${LETTER}`,
    String.raw`\b(?:don['’]t|doesn['’]t|do\s+not|does\s+not|no\s+need\s+to)\s+(?:need|require|send|submit|include|attach|want)\s+(?:a\s+|an\s+|any\s+)?${LETTER}`,
    String.raw`${LETTER}\s*[(:–—-]?\s*(?:is\s+|are\s+)?(?:optional|not\s+(?:required|needed|necessary))`,
  ].join('|'),
  'gi',
);

/**
 * Whether a job asks for a cover letter, by how to apply: its apply.md, or the job search's note
 * about applying. Any mention counts, unless it's one that says a letter isn't needed. When in
 * doubt it says yes: a letter that wasn't required does no harm, and one that was can't be missed.
 */
export function asksForCoverLetter(job: { apply: string | null }): boolean {
  const apply = (job.apply ?? '').replace(WAIVERS, ' ');
  return new RegExp(String.raw`\b${LETTER}\b`, 'i').test(apply);
}
