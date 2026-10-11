import type { CallKind, CallOutcome, CallState, Job, JobDocs, JobStatus } from '@factwright/core';
import type { RunTask } from './runs.ts';

/** Where the user's Claude Code stands. The sidebar shows it, and runs start only when it's ready. */
export type ClaudeStatus =
  | { state: 'ready'; version: string; plan?: string | undefined }
  | { state: 'signed-out'; version: string }
  | { state: 'too-old'; version: string; minimum: string }
  | { state: 'missing' }
  | { state: 'unknown' };

/**
 * Whether Factwright's setup works with the user's Claude Code, from a check that starts it
 * hidden with no prompt, so it uses none of their plan. "untrusted" means Claude Code is still
 * waiting for the user to trust the workspace, which they do in their first run.
 */
export interface SetupCheck {
  /** The Claude Code version checked. */
  version: string;
  result: 'passed' | 'failed' | 'untrusted';
  /** For a failure, what went wrong, in plain words. */
  problem?: string;
  /** When, as an ISO time. */
  at: string;
}

/** Where a run in Claude's panel stands. Claude Code's hooks report it, and so does its exit. */
export type RunSignal = 'working' | 'needs-answer' | 'done' | 'stopped' | 'failed';

/** The size of Claude's panel, in characters. */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/** Whether a run started, or took a task, and if not, why. */
export type StartResult =
  | { ok: true }
  | { ok: false; reason: 'not-ready' | 'busy' | 'failed' | 'not-running'; message?: string };

/** Every job, as the app last read them from the workspace and the tracker. */
export interface JobList {
  jobs: Job[];
  /** When the app last read the workspace, as an ISO time. */
  readAt: string | null;
}

/** Changes to what the user tracks about a job. Only the fields given change. */
export interface JobChanges {
  status?: JobStatus | null;
  /** With a status, when it happened. On its own, when the current status started. */
  statusOn?: string;
  appliedOn?: string | null;
  nextAction?: string | null;
  nextOn?: string | null;
  notes?: string | null;
  /** All of the application's questions, in order, replacing those saved before. */
  questions?: string[];
  archived?: boolean;
}

/** A job the user adds by hand. */
export interface NewJob {
  company: string;
  role?: string | null;
  link?: string | null;
  pay?: string | null;
  status?: JobStatus | null;
  notes?: string | null;
}

/** A call or interview the user logs. */
export interface NewCall {
  kind: CallKind;
  onDate: string;
  atTime?: string | null;
  notes?: string | null;
}

/** Changes to a logged call. Only the fields given change. */
export interface CallChanges {
  kind?: CallKind;
  onDate?: string;
  atTime?: string | null;
  state?: CallState;
  outcome?: CallOutcome | null;
  notes?: string | null;
}

/** Whether an edit was saved, and if not, why, in words the user can act on. */
export type EditResult = { ok: true } | { ok: false; message: string };

/** Whether a file was saved, or the user canceled, or why it couldn't be. */
export type SaveFileResult = { ok: true; saved: boolean } | { ok: false; message: string };

/** Whether a job was added, and its ID if so. */
export type AddJobResult = { ok: true; jobId: string } | { ok: false; message: string };

/** What the app's window may ask of the main process. Nothing else crosses over. */
export interface FactwrightApi {
  /** The operating system, so the window can make room for its title bar buttons. */
  platform: string;
  claudeStatus(): Promise<ClaudeStatus>;
  /** The latest check of Factwright's setup with the user's Claude Code, or null before one. */
  setupCheck(): Promise<SetupCheck | null>;
  /** Checks the setup again now, and answers with what it found. */
  checkSetup(): Promise<SetupCheck | null>;
  /** Listens for new setup checks. Returns a function that stops listening. */
  onSetupCheck(listener: (check: SetupCheck) => void): () => void;
  /** Starts the user's Claude Code in the panel. Only one run happens at a time. */
  startClaude(size: TerminalSize, task?: RunTask): Promise<StartResult>;
  /** Gives the run that's open a skill to run on a job, as if the user typed it. */
  runTask(task: RunTask): Promise<StartResult>;
  stopClaude(): void;
  /** Sends what the user types in the panel to Claude Code. */
  writeToClaude(data: string): void;
  resizeClaude(size: TerminalSize): void;
  /** Listens for Claude Code's output. Returns a function that stops listening. */
  onClaudeOutput(listener: (data: string) => void): () => void;
  /** Listens for changes in where the run stands. Returns a function that stops listening. */
  onClaudeSignal(listener: (signal: RunSignal) => void): () => void;
  listJobs(): Promise<JobList>;
  /** The text of a job's documents, such as its posting and fit check. */
  jobDocs(jobId: string): Promise<JobDocs | null>;
  updateJob(jobId: string, changes: JobChanges): Promise<EditResult>;
  addJob(job: NewJob): Promise<AddJobResult>;
  addCall(jobId: string, call: NewCall): Promise<EditResult>;
  updateCall(callId: string, changes: CallChanges): Promise<EditResult>;
  deleteCall(callId: string): Promise<EditResult>;
  /** Corrects when a change of status happened. */
  redateStatusChange(changeId: string, at: string): Promise<EditResult>;
  /** Removes a change of status, to undo a mis-click. */
  undoStatusChange(changeId: string): Promise<EditResult>;
  /** Listens for any change to the jobs. Returns a function that stops listening. */
  onJobsChanged(listener: (list: JobList) => void): () => void;
  /** Opens a resume from the workspace in the user's own app for it. */
  openFile(path: string): Promise<EditResult>;
  /** Copies text to the clipboard, such as the journey as a flow chart. */
  copyText(text: string): Promise<EditResult>;
  /** Saves text to a file where the user picks, such as the journey as a spreadsheet. */
  saveFile(name: string, text: string): Promise<SaveFileResult>;
}
