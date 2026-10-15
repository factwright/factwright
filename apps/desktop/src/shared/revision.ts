import type { FindingKind } from '@factwright/xray';

/**
 * Send for revision: the user picks what a resume's ATS X-ray found, and a run fixes it. The
 * app types only the skill, the job's ID and the findings' IDs, which hold none of the posting's
 * words. The resume and the findings themselves reach the run through a tool, bound to that run,
 * so nothing the X-ray read, such as a posting's words, ever reaches Claude as if the user had
 * typed it.
 */

/** The skill that revises a job's resume for what its X-ray found. */
export const REVISE_SKILL = 'revise-resume';

/**
 * How a revision deals with findings that come from the template rather than the words: fix the
 * user's own template, which changes every resume that uses it, or use one that reads cleanly for
 * this job.
 */
export const TEMPLATE_CHOICES = ['fix', 'switch'] as const;

export type TemplateChoice = (typeof TEMPLATE_CHOICES)[number];

/**
 * A finding's ID, as the X-ray gives it: "check-" and a check that can be revised, or "term-" and
 * eight hex digits, such as "term-3c5e0f21", so none of a posting's words is ever typed into a run.
 * The same as @factwright/xray's, which a test checks.
 */
export const FINDING_ID =
  /^(?:check-(?:contact|dates|headings|length|order|margins|characters|joined|spaced|layout|fonts)|term-[0-9a-f]{8}(?:-[1-9][0-9]?)?)$/;

export const FINDING_KINDS: readonly FindingKind[] = ['content', 'question', 'template'];

/**
 * A resume's file in its job's folder, by name, ending .pdf or .docx: no slashes, so it can only
 * name a file in the folder, and no control characters. It's never typed into a run.
 */
export const RESUME_FILE = /^(?!\.)[^/\\\p{C}]{1,200}\.(?:pdf|docx)$/iu;

/** The most findings one revision takes. */
export const MAX_FINDINGS = 40;

const MAX_ID = 60;
export const MAX_TITLE = 300;
const MAX_ABOUT = 2000;
export const MAX_SUMMARY = 300;

/** One finding the user picked: its ID and kind, a short name, and what the X-ray found. */
export interface RevisionFinding {
  id: string;
  kind: FindingKind;
  title: string;
  about: string;
}

/** What the window sends before a revision starts: the resume, its findings, and the choice. */
export interface RevisionRequest {
  jobId: string;
  /** The resume's file in the job's folder, such as AlexRiveraResume10072026_Acme.pdf. */
  resume: string;
  findings: RevisionFinding[];
  /** How to deal with the template's findings, when one is picked. */
  template?: TemplateChoice;
  /** The X-ray's summary before the revision, such as "Reads cleanly · 5 of 11 key terms". */
  before: string;
}

/** Where a job's resume stands for the X-ray's Revise tab. */
export interface RevisionState {
  /** Its last revision, for the before-and-after, or null. */
  last: Revision | null;
  /** Why it can't be sent for revision, such as that it went out with the application, or null. */
  locked: string | null;
}

/** A revision as the app kept it beside the previous version, for the before-and-after. */
export interface Revision {
  /** When it was sent, as an ISO time. */
  at: string;
  resume: string;
  findings: Omit<RevisionFinding, 'about'>[];
  template?: TemplateChoice;
  before: string;
  /** The folder the previous version is in, in the workspace. */
  previous: string;
  /** The previous version's resume files there, in the workspace. */
  files: string[];
}

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max;

/**
 * Text on one line: each run of spaces, line breaks and other control or format characters,
 * such as a right-to-left mark, as one space.
 */
export const oneLine = (value: string) => value.replace(/[\s\p{C}]+/gu, ' ').trim();

/** A finding from the window, if it's in the shape a revision takes. */
function parseFinding(value: unknown): RevisionFinding | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { id, kind, title, about, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (!text(id, MAX_ID) || !FINDING_ID.test(id)) return null;
  if (!(FINDING_KINDS as readonly unknown[]).includes(kind)) return null;
  if (!text(title, MAX_TITLE) || !text(about, MAX_ABOUT)) return null;
  if (!oneLine(title) || !oneLine(about)) return null;
  return { id, kind: kind as FindingKind, title: oneLine(title), about: oneLine(about) };
}

/**
 * A revision request from the window, if it's in the shape the app takes: a job's ID, a resume's
 * file, at least one finding and at most MAX_FINDINGS, each once, and a choice for the template
 * exactly when a template's finding is picked. Anything else is null.
 */
export function parseRevisionRequest(value: unknown, jobIdPattern: RegExp): RevisionRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { jobId, resume, findings, template, before, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (typeof jobId !== 'string' || !jobIdPattern.test(jobId)) return null;
  if (typeof resume !== 'string' || !RESUME_FILE.test(resume)) return null;
  if (!Array.isArray(findings) || findings.length === 0 || findings.length > MAX_FINDINGS) {
    return null;
  }
  const parsed = findings.map(parseFinding);
  if (parsed.some((finding) => finding === null)) return null;
  const picked = parsed as RevisionFinding[];
  if (new Set(picked.map((finding) => finding.id)).size !== picked.length) return null;
  const templated = picked.some((finding) => finding.kind === 'template');
  if (template !== undefined && !(TEMPLATE_CHOICES as readonly unknown[]).includes(template)) {
    return null;
  }
  if (templated !== (template !== undefined)) return null;
  if (!text(before, MAX_SUMMARY) || !oneLine(before)) return null;
  return {
    jobId,
    resume,
    findings: picked,
    ...(template !== undefined && { template: template as TemplateChoice }),
    before: oneLine(before),
  };
}
