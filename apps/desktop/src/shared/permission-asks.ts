/**
 * What Claude wants to do that Claude Code asks the user's permission for, as the app's dialog
 * shows it, and the user's answer there. The app describes only what it can show in full, in
 * plain words. Claude Code asks anything else in the terminal, as before.
 */

/** One thing Claude would save to the user's profile, such as their notice period. */
export interface ProfileChange {
  /** What it is, in words, such as "When you can start". */
  label: string;
  /** What it saves, or null when it clears what's there. */
  value: string | null;
}

/** Where a file is: in the user's job hunt, by its path there, or anywhere else, in full. */
export interface FilePlace {
  /** The file's path in the workspace, such as "facts/acme.md", or its full path outside it. */
  file: string;
  /** Whether the file is outside the workspace, the user's job hunt folder. */
  outside: boolean;
}

export type PermissionAsk = { id: string } & (
  | (FilePlace & {
      kind: 'edit';
      /** The text it replaces, and what with. */
      before: string;
      after: string;
      /** Whether it replaces every place the text appears, not just the one. */
      everywhere: boolean;
    })
  | (FilePlace & {
      kind: 'write';
      content: string;
      /** Whether a file is there already, which this replaces whole. */
      replaces: boolean;
    })
  | (FilePlace & { kind: 'read' })
  | {
      kind: 'page';
      url: string;
      /** The site the page's address goes to, such as "example.com". */
      host: string;
    }
  | { kind: 'profile'; changes: ProfileChange[] }
  | {
      kind: 'template';
      /** The template's ID, which a template it replaces has too, and its name. */
      template: string;
      name: string;
      /** What Claude says its look is. */
      look: string | null;
      /** Whether it may replace a template of the user's with the same ID. */
      replace: boolean;
      /** The name of the user's template with that ID, which it replaces, if there is one. */
      replacing: string | null;
      /** The whole template file it saves, as text. */
      code: string;
    }
);

/** The user's answer: allow it, or don't, with anything they want Claude to know. */
export type PermissionAnswer = { allow: true } | { allow: false; note: string };

/** As long as a note to Claude, with a no, can be. */
export const MAX_PERMISSION_NOTE = 2_000;
