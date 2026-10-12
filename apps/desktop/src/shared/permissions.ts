/**
 * What Claude may do on the user's job hunt without asking first, beyond what it always may:
 * save its work in the job, search and outreach folders, search the web, and read postings from
 * the applicant systems' public feeds.
 */
export interface ClaudePermissions {
  /** Change any file in the job hunt, including the facts, the guide and the base resumes. */
  anyFile: boolean;
  /** Read any website, not only the applicant systems' feeds. */
  anySite: boolean;
}

/** Until the user chooses otherwise, Claude asks first. */
export const ASK_FIRST: ClaudePermissions = { anyFile: false, anySite: false };

/** Permissions from the window or a file, or null when they aren't two yes-or-no answers. */
export function parsePermissions(value: unknown): ClaudePermissions | null {
  if (typeof value !== 'object' || value === null) return null;
  const { anyFile, anySite } = value as Record<string, unknown>;
  return typeof anyFile === 'boolean' && typeof anySite === 'boolean' ? { anyFile, anySite } : null;
}
