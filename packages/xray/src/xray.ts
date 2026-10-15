import { type Check, type CheckId, marks, runChecks } from './checks.ts';
import { type FactFile, readFacts } from './facts.ts';
import { type Fields, readFields } from './fields.ts';
import { type KeywordReport, matchKeywords } from './keywords.ts';
import type { Line, ReadFile } from './read.ts';
import { findSections, type Section, type SectionKind } from './sections.ts';

/** A line as the X-ray shows it. */
export interface XRayLine extends Pick<Line, 'text' | 'page' | 'part'> {
  /** For a heading: what systems take it for, or null for a heading they don't know. */
  heading?: SectionKind | null;
  /** The checks that mark it. */
  marks: CheckId[];
}

/** The X-ray at a glance. */
export interface Summary {
  /** Checks a system will likely trip on. */
  problems: number;
  /** The posting's key terms the resume has, of all of them, when there's a posting. */
  terms: { found: number; total: number } | null;
  /** What's worth fixing: those problems, and must-haves the fact bank backs that are missing. */
  toFix: number;
  /** In a line: "Reads cleanly · 14 of 18 key terms · 2 things to fix". */
  text: string;
}

export interface XRay {
  format: ReadFile['format'];
  /** How many pages, when the file says. */
  pageCount: number | null;
  /** False when there's almost no text to read, as in a scanned page: then only that is checked. */
  readable: boolean;
  lines: XRayLine[];
  sections: Section[];
  fields: Fields;
  checks: Check[];
  keywords: KeywordReport | null;
  summary: Summary;
}

export interface XRayInput {
  /** The job's posting, for a job's resume. */
  posting?: string | null;
  /** The fact bank's files, to tell a term the user can add from a real gap. */
  facts?: readonly FactFile[] | null;
}

/** The checks that still mean something for a file with almost no text. */
const TEXTLESS: ReadonlySet<CheckId> = new Set(['text', 'fonts', 'length']);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function summaryOf(checks: readonly Check[], keywords: KeywordReport | null): Summary {
  const problems = checks.filter((check) => check.status === 'fix').length;
  const terms = keywords
    ? {
        found: keywords.terms.filter((term) => term.found).length,
        total: keywords.terms.length,
      }
    : null;
  const toAdd =
    keywords?.terms.filter(
      (term) => !term.found && term.need === 'must' && term.backing.kind === 'facts',
    ).length ?? 0;
  const toFix = problems + toAdd;
  const parts = [
    problems === 0 ? 'Reads cleanly' : `${plural(problems, 'problem')} reading it`,
    terms && terms.total > 0 ? `${terms.found} of ${terms.total} key terms` : null,
    toFix === 0 ? 'Nothing to fix' : `${plural(toFix, 'thing')} to fix`,
  ];
  return { problems, terms, toFix, text: parts.filter(Boolean).join(' · ') };
}

/**
 * What an applicant tracking system reads in a resume file: its text in the order a parser gets
 * it, the sections and fields it pulls out, the problems it would trip on, and, with the job's
 * posting, which key terms it finds. Missing terms are checked against the fact bank, so only a
 * term the user can back is one to add. It's all worked out here, the same way every time.
 */
export function xray(file: ReadFile, input: XRayInput = {}): XRay {
  const sections = findSections(file.lines);
  const fields = readFields(file.lines, sections);
  const all = runChecks(file, sections, fields);
  // With almost no text, what else it finds is only for want of text, and it can't check terms.
  const readable = !all.some((check) => check.id === 'text');
  const checks = readable ? all : all.filter((check) => TEXTLESS.has(check.id));
  const marked = marks(checks);
  const headings = new Map(sections.map((section) => [section.line, section.kind]));
  // The terms a system surely reads: a Word file's headers, footers and text boxes it may skip.
  const read = file.lines.filter((line) => line.part === 'body' || line.part === 'table');
  const keywords =
    input.posting && readable
      ? matchKeywords(
          input.posting,
          read.map((line) => line.text).join('\n'),
          input.facts ? readFacts(input.facts) : null,
        )
      : null;
  return {
    format: file.format,
    pageCount: file.pageCount,
    readable,
    lines: file.lines.map((line, index) => ({
      text: line.text,
      page: line.page,
      part: line.part,
      ...(headings.has(index) && { heading: headings.get(index) ?? null }),
      marks: marked.get(index) ?? [],
    })),
    sections,
    fields,
    checks,
    keywords,
    summary: summaryOf(checks, keywords),
  };
}
