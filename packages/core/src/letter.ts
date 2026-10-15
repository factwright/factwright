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

/** Words that say a cover letter isn't wanted, or isn't needed. */
const WAIVED =
  /\b(?:optional|not (?:required|needed|necessary)|(?:isn|aren)[’']t (?:required|needed|necessary)|no need|no cover letters?|(?:don|doesn)[’']t (?:need|require|send|include|want)|(?:do|does) not (?:need|require|send|include|want))\b/i;

/**
 * Whether a job asks for a cover letter, by how to apply: its apply.md, or the job search's note
 * about applying. A sentence naming one counts, unless it says one isn't needed: "No cover letter
 * needed", or "Cover letter optional".
 */
export function asksForCoverLetter(job: { apply: string | null }): boolean {
  return (job.apply ?? '')
    .split(/[.!?\n]+/)
    .some((sentence) => /\bcover\s+letters?\b/i.test(sentence) && !WAIVED.test(sentence));
}
