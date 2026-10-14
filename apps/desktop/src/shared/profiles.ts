/**
 * A profile on this computer, as the window lists it. Each person keeps their own job hunt in
 * one, with its own sync account and Claude login, and one is open at a time.
 */
export interface ProfileEntry {
  id: string;
  name: string;
  /** The profile that's open now. */
  open: boolean;
  /** The first profile, whose folder holds the others, so it can't be removed. */
  first: boolean;
  /** Whether it was given a name. The first profile has none until a second is added. */
  named: boolean;
}

/** The profiles on this computer, and how the open one signs in to Claude Code. */
export interface ProfileList {
  profiles: ProfileEntry[];
  /** The command that signs the open profile in to Claude Code, which the user runs themselves. */
  claudeSignIn: string;
}

export type AddProfileResult = { ok: true; id: string } | { ok: false; message: string };

/** The longest a profile's name can be: a person's name, or a word such as "Testing". */
export const PROFILE_NAME_LIMIT = 40;

/** A profile's name as typed, with its spaces tidied, or null when it can't be one. */
export function parseProfileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a name is never a control code
  if (name.length === 0 || name.length > PROFILE_NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(name)) {
    return null;
  }
  return name;
}

/** Another profile with the same name, whatever its case, as two "Sam"s would confuse. */
export const sameName = <T extends { id: string; name: string }>(
  name: string,
  profiles: T[],
  id?: string,
): T | undefined =>
  profiles.find(
    (profile) => profile.id !== id && profile.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
