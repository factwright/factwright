import type { AboutYou, FileKind, SharedFile } from './about.ts';

/** A file the user shared, as the window sends it: its bytes, and any text read out of it. */
export interface FileUpload {
  /** Its name on the user's computer. */
  name: string;
  kind: FileKind;
  bytes: Uint8Array;
  /** Its text, read in the window from a PDF or Word file, or null for a picture. */
  text: string | null;
}

/**
 * The spreadsheets of a LinkedIn data export the app keeps, by their names in the export: the
 * profile and its parts, and the connections, which find warm paths to people at a company.
 * Messages, invitations and the rest stay out.
 */
export const LINKEDIN_TABLES = [
  'Profile.csv',
  'Profile Summary.csv',
  'Positions.csv',
  'Education.csv',
  'Skills.csv',
  'Certifications.csv',
  'Courses.csv',
  'Honors.csv',
  'Languages.csv',
  'Projects.csv',
  'Publications.csv',
  'Patents.csv',
  'Volunteering.csv',
  'Organizations.csv',
  'Test Scores.csv',
  'Recommendations_Received.csv',
  'Connections.csv',
] as const;

/** The parts of a LinkedIn data export worth keeping, read out of its ZIP in the window. */
export interface LinkedInUpload {
  /** Each kept spreadsheet, by its name in the export, such as "Positions.csv". */
  tables: { name: string; text: string }[];
  /** The profile, positions, education and skills in it, as Markdown for Claude. */
  summary: string;
}

/** Whether a file was added, and the file as kept, or why not in words the user can act on. */
export type AddFileResult = { ok: true; file: SharedFile } | { ok: false; message: string };

/** A starting resume in base/, and the files built from it. */
export interface StartingResume {
  /** Its file in the workspace, such as "base/startup-ic.json". */
  path: string;
  /** Its headline, or its file's name. */
  title: string;
  layout: string;
  pdf: string | null;
  docx: string | null;
}

/** How far the user's profile has come: their fact bank, starting resumes and shared files. */
export interface ProfileStatus {
  /** Claims in facts/, and how many still wait for the user to confirm them. */
  facts: { claims: number; unconfirmed: number; files: number };
  starting: StartingResume[];
  /** Shared files Claude hasn't read yet. */
  unread: string[];
  /** The notes changed since Claude last read them. */
  notesChanged: boolean;
  /** Who wrote searches/criteria.md as it is now: the app, from the answers, or someone by hand. */
  criteria: 'app' | 'own' | 'none';
  /** The LinkedIn connections on file, and when the export was added. */
  connections: { count: number; added: string } | null;
}

/** Everything the profile shows, read together. */
export interface Profile {
  answers: AboutYou;
  notes: string;
  /** The names in guide/confidential-terms.txt, as the user would type them. */
  confidential: string[];
  status: ProfileStatus;
}

/** A template's preview: a made-up resume printed in it, or why it couldn't be. */
export type PreviewResult = { ok: true; data: Uint8Array } | { ok: false; message: string };
