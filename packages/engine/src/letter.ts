import { type Check, contactCheck, isObject, list, text } from './checks.ts';
import { type Contact, FORMATS } from './schema.ts';
import { TEMPLATE_ID } from './templates.ts';

/**
 * A cover letter, as the cover-letter skill writes it in a job's cover-letter.json: the same
 * header as the job's resume, so the two look like a set, then the letter itself. Any text can
 * hold **bold** and [[placeholders]], which lint refuses, so none ship by accident.
 */
export interface CoverLetter {
  /** Its template's ID. Without one, it takes the job's resume's. */
  layout?: string;
  format?: string;
  /** The files' name, without an extension, such as "AlexRiveraCoverLetter10142026_Acme". */
  output_name?: string;
  name: string;
  headline?: string;
  contact?: Contact;
  /** When it's dated, as it prints, such as "October 14, 2026". */
  date?: string;
  /** Who it's to, a line each: their name, their title, the company. */
  recipient?: string[];
  /** Such as "Dear Jordan Lee,". */
  greeting: string;
  paragraphs: string[];
  /** Such as "Best regards,". */
  closing: string;
  /** The name under the closing. Without one, the name at the top. */
  signature?: string;
}

const CHECKS: Record<string, Check> = {
  layout: text(false),
  format: text(false),
  output_name: text(false),
  name: text(true),
  headline: text(false),
  contact: contactCheck,
  date: text(false),
  recipient: list(text(true)),
  greeting: text(true),
  paragraphs: list(text(true), true),
  closing: text(true),
  signature: text(false),
};

/** The fields a cover letter can have at its top level, such as greeting. */
export const LETTER_FIELDS = Object.keys(CHECKS);

/**
 * Checks a cover letter before it's built, so a mistake reads as a plain problem rather than a
 * failed build: "letter.greeting is missing."
 */
export function readLetter(
  value: unknown,
): { ok: true; letter: CoverLetter } | { ok: false; problems: string[] } {
  if (!isObject(value)) return { ok: false, problems: ['The letter should be a JSON object.'] };
  const problems: string[] = [];
  for (const [key, check] of Object.entries(CHECKS)) check(value[key], `letter.${key}`, problems);
  if (Array.isArray(value.paragraphs) && value.paragraphs.length === 0) {
    problems.push('letter.paragraphs should hold the letter, a paragraph each.');
  }
  if (typeof value.layout === 'string' && !TEMPLATE_ID.test(value.layout)) {
    problems.push('letter.layout should be a template’s ID, such as classic or minimal.');
  }
  if (typeof value.format === 'string' && !(FORMATS as readonly string[]).includes(value.format)) {
    problems.push(`letter.format should be ${FORMATS.join(', ')}.`);
  }
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, letter: value as unknown as CoverLetter };
}

/** How many words the letter's paragraphs hold. */
export const letterWords = (letter: CoverLetter): number =>
  letter.paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
