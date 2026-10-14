import type {
  CallKind,
  CallOutcome,
  CallState,
  Job,
  JobDocs,
  JobShot,
  JobStatus,
  PassReason,
} from '@factwright/core';
import type { AboutYou, AnswerChanges } from './about.ts';
import type { EffortChoices } from './effort.ts';
import type { FactBank, FactChange, FactResult, FactTarget, NewFact } from './facts.ts';
import type { ModelChoices } from './models.ts';
import type { ClaudePermissions } from './permissions.ts';
import type {
  AddFileResult,
  AddTemplateResult,
  FileUpload,
  LinkedInUpload,
  PreviewResult,
  Profile,
  TemplateUpload,
} from './profile.ts';
import type { AddProfileResult, ProfileList } from './profiles.ts';
import type { RunTask } from './runs.ts';
import type {
  AccountResult,
  ApprovalsView,
  LinkCodeResult,
  RecoveryKeyResult,
  SyncStatus,
} from './sync.ts';
import type { UpdateStatus } from './updates.ts';

/** Where the user's Claude Code stands. The sidebar shows it, and runs start only when it's ready. */
export type ClaudeStatus =
  | {
      state: 'ready';
      version: string;
      /** The user's Claude plan, such as "pro" or "max", when they sign in with one. */
      plan?: string | undefined;
      /**
       * How Claude Code signs in: "subscription" for a Claude plan, or its name for another way,
       * such as "api_key".
       */
      method?: string | undefined;
    }
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

/** A PDF's bytes, for showing its pages in the window, or why there are none. */
export type PdfResult = { ok: true; data: Uint8Array } | { ok: false; message: string };

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
  | {
      ok: false;
      /**
       * "new-run": the task needs a run of its own, since the open one is on another model, or
       * may change other files without asking.
       */
      reason: 'not-ready' | 'busy' | 'failed' | 'not-running' | 'new-run';
      message?: string;
    };

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
  /** For a job set aside for later, the day it comes back to review, or null for none. */
  backOn?: string | null;
  /** Why the user passed on the job, or null for no reason given. */
  passReason?: PassReason | null;
  appliedOn?: string | null;
  nextAction?: string | null;
  nextOn?: string | null;
  /** The one undated box of notes the app had before notes were dated. */
  earlierNotes?: string | null;
  /** All of the application's questions, in order, replacing those saved before. */
  questions?: string[];
  archived?: boolean;
  /** The kind of job it's under, by its id, or null to go by the job search or fit check. */
  kind?: string | null;
}

/** A job the user adds by hand. */
export interface NewJob {
  company: string;
  role?: string | null;
  link?: string | null;
  pay?: string | null;
  status?: JobStatus | null;
  /** A first note, dated today. */
  notes?: string | null;
  /** The kind of job it's under, by its id, when the user wants more than one kind. */
  kind?: string | null;
}

/** A note the user jots about a job: its words, and the day it's about if not today. */
export interface NewNote {
  text: string;
  on?: string;
}

/** Changes to a note. Only the fields given change. */
export interface NoteChanges {
  text?: string;
  on?: string;
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

/** A question for Claude about a job, kept under the ID its answer is saved by. */
export type AskResult = { ok: true; askId: string } | { ok: false; message: string };

/** What a screenshot is added with: the application form, a question for Claude, or Claude's panel. */
export type ShotFor = { kind: 'form' } | { kind: 'ask'; ask: string } | { kind: 'pasted' };

/** A screenshot saved in the workspace, by its path there, or why it wasn't. */
export type ShotResult = { ok: true; path: string } | { ok: false; message: string };

/** Claude's answers to the user's questions about a job, by the question's ID, and its screenshots. */
export interface JobExtras {
  asked: Record<string, string>;
  shots: JobShot[];
}

/** A picture pasted into Claude's panel, saved where Claude can read it, by its full path. */
export type PasteResult = { ok: true; file: string } | { ok: false; message: string };

/** A screenshot from the window: its name and bytes. */
export interface ShotUpload {
  name: string;
  bytes: Uint8Array;
}

/** How the main process passes the app's version to the window, as a command-line switch. */
export const VERSION_ARGUMENT = '--factwright-version=';

/** What the app's window may ask of the main process. Nothing else crosses over. */
export interface FactwrightApi {
  /** The operating system, so the window can make room for its title bar buttons. */
  platform: string;
  /** Factwright's own version, such as "0.1.1". */
  version: string;
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
  /**
   * Listens for Claude Code asking whether to trust the workspace, which it does once, in the
   * first run. Returns a function that stops listening.
   */
  onClaudeTrust(listener: () => void): () => void;
  listJobs(): Promise<JobList>;
  /** The text of a job's documents, such as its posting and fit check. */
  jobDocs(jobId: string): Promise<JobDocs | null>;
  updateJob(jobId: string, changes: JobChanges): Promise<EditResult>;
  /** Makes the same change to several jobs at once, such as moving them all to To review. */
  updateJobs(jobIds: string[], changes: JobChanges): Promise<EditResult>;
  addJob(job: NewJob): Promise<AddJobResult>;
  addCall(jobId: string, call: NewCall): Promise<EditResult>;
  updateCall(callId: string, changes: CallChanges): Promise<EditResult>;
  deleteCall(callId: string): Promise<EditResult>;
  /** Corrects when a change of status happened. */
  redateStatusChange(changeId: string, at: string): Promise<EditResult>;
  /** Removes a change of status, to undo a mis-click. */
  undoStatusChange(changeId: string): Promise<EditResult>;
  /** Keeps a note about a job, dated today unless it says otherwise. */
  addNote(jobId: string, note: NewNote): Promise<EditResult>;
  updateNote(noteId: string, changes: NoteChanges): Promise<EditResult>;
  deleteNote(noteId: string): Promise<EditResult>;
  /** Listens for any change to the jobs. Returns a function that stops listening. */
  onJobsChanged(listener: (list: JobList) => void): () => void;
  /** Claude's answers to the user's questions about a job, and its screenshots. */
  jobExtras(jobId: string): Promise<JobExtras | null>;
  /**
   * Keeps what the user actually sent for one of the application's questions, the nth time the
   * form asks it, counting from 0. Blank forgets it.
   */
  recordAnswer(jobId: string, question: string, nth: number, text: string): Promise<EditResult>;
  /** Keeps a question for Claude about a job, ready for a run to answer it. */
  askAboutJob(jobId: string, question: string): Promise<AskResult>;
  /** Forgets a question about a job, and puts its answer and screenshots in the trash. */
  removeAsk(jobId: string, askId: string): Promise<EditResult>;
  /** Saves a screenshot for a job: of the application form, or with a question for Claude. */
  addShot(jobId: string, shot: ShotUpload, purpose: ShotFor): Promise<ShotResult>;
  /** Puts a screenshot in the trash. */
  removeShot(path: string): Promise<EditResult>;
  /** A screenshot's bytes, to show it. */
  readShot(path: string): Promise<Uint8Array | null>;
  /** Saves a picture pasted into Claude's panel, with the run's job when there is one. */
  pasteImage(shot: ShotUpload, jobId: string | null): Promise<PasteResult>;
  /** Opens a resume from the workspace in the user's own app for it. */
  openFile(path: string): Promise<EditResult>;
  /** A resume PDF's bytes, to show its pages in the window. */
  readPdf(path: string): Promise<PdfResult>;
  /** Copies text to the clipboard, such as the journey as a flow chart. */
  copyText(text: string): Promise<EditResult>;
  /** Saves text to a file where the user picks, such as the journey as a spreadsheet. */
  saveFile(name: string, text: string): Promise<SaveFileResult>;
  /** Which model Claude runs on, for everything and for each task. */
  claudeModels(): Promise<ModelChoices>;
  /** Changes which model Claude runs on, from its next start or the next task that needs another. */
  setClaudeModels(models: ModelChoices): Promise<ModelChoices>;
  /** How hard Claude thinks, for everything and for each task. */
  claudeEffort(): Promise<EffortChoices>;
  /** Changes how hard Claude thinks, from its next start or the next task that needs another. */
  setClaudeEffort(effort: EffortChoices): Promise<EffortChoices>;
  /** What Claude may do without asking. */
  claudePermissions(): Promise<ClaudePermissions>;
  /** Changes what Claude may do without asking, from its next start. */
  setClaudePermissions(permissions: ClaudePermissions): Promise<ClaudePermissions>;
  /** Where sync stands on this computer. */
  syncStatus(): Promise<SyncStatus>;
  /** Listens for changes in where sync stands. Returns a function that stops listening. */
  onSyncStatus(listener: (status: SyncStatus) => void): () => void;
  /** Signs in to sync through the browser. Answers once the user approves, or it stops. */
  signInToSync(): Promise<EditResult>;
  cancelSyncSignIn(): void;
  /** On the account's first device: makes the recovery key to save before sync turns on. */
  makeRecoveryKey(): Promise<RecoveryKeyResult>;
  /** On the first device, once the recovery key is saved. */
  turnOnSync(): Promise<EditResult>;
  /** Links this computer with a code from a device that's set up. */
  linkWithCode(code: string): Promise<EditResult>;
  /** Links this computer with the account's recovery key. */
  useRecoveryKey(recoveryKey: string): Promise<EditResult>;
  /** A code for adding a phone or computer, good once, for 10 minutes. */
  makeLinkCode(): Promise<LinkCodeResult>;
  cancelLinkCode(id: string): void;
  /** How linking by approval stands, after a fresh look for other devices' requests. */
  linkApprovals(): Promise<ApprovalsView>;
  /** Listens for changes in linking by approval. Returns a function that stops listening. */
  onLinkApprovals(listener: (view: ApprovalsView) => void): () => void;
  /** On a computer that isn't linked yet: asks a device that's set up to approve it. */
  askToLink(): Promise<EditResult>;
  /** On the computer asking: whether its emoji match the other device's. */
  confirmLinkCheck(matched: boolean): void;
  /** With sync on: starts approving another device's request, up to showing its emoji. */
  approveLinkRequest(id: string): Promise<EditResult>;
  /** With sync on: whether the emoji match, which approves the request or turns it down. */
  answerLinkRequest(matched: boolean): Promise<EditResult>;
  /** With sync on: turns another device's request down, leaving it signed in. */
  denyLinkRequest(id: string): Promise<EditResult>;
  /** Signs out the device whose request was just turned down: it isn't the person's. */
  signOutTurnedDown(): Promise<EditResult>;
  /** Puts away what's over: an approval that ended, or a request just turned down. */
  dismissLinkApproval(): void;
  syncNow(): void;
  /** Who the account is, its signed-in devices, and how much it stores. */
  syncAccount(): Promise<AccountResult>;
  removeSyncDevice(id: string): Promise<EditResult>;
  /** Turns sync off on this computer, keeping its job hunt. */
  signOutOfSync(): Promise<EditResult>;
  /** Ends a sign-in with the wrong account, before sync sets up, keeping all this computer has. */
  useDifferentSyncAccount(): Promise<EditResult>;
  /** Opens the account's page on the web, to download everything or delete the account. */
  openAccountPage(): Promise<void>;
  /** Everything about the user: their answers, notes and confidential names, and how far it's come. */
  profile(): Promise<Profile>;
  /** Saves changes to the answers, and answers with all of them. */
  saveAnswers(changes: AnswerChanges): Promise<AboutYou>;
  /** Saves the notes the user wrote about themselves. */
  saveNotes(text: string): Promise<EditResult>;
  /**
   * Adds and removes names that must never appear on a resume, keeping any Claude added since,
   * and answers with them all as kept.
   */
  changeConfidential(changes: { add: string[]; remove: string[] }): Promise<string[]>;
  /** Keeps a file the user shared, such as a resume or a screenshot. */
  addFile(upload: FileUpload): Promise<AddFileResult>;
  /** Keeps the useful parts of a LinkedIn data export. */
  addLinkedIn(upload: LinkedInUpload): Promise<AddFileResult>;
  /** Moves a shared file to the trash, and answers with the answers as they are then. */
  removeFile(path: string): Promise<AboutYou>;
  /** Gets the workspace ready for Claude to get to know the user, and marks the answers in use. */
  startProfile(): Promise<AboutYou>;
  /** Replaces a criteria file someone changed by hand with one from the answers, keeping theirs. */
  useAnswersForCriteria(): Promise<void>;
  /** A template's look: a made-up resume printed in it, with the user's name if given. */
  templatePreview(id: string, name: string): Promise<PreviewResult>;
  /**
   * Adds a file the user picked to their templates: a template file, or a resume whose look they
   * like, kept for Claude to make a template from.
   */
  addTemplate(upload: TemplateUpload): Promise<AddTemplateResult>;
  /** Puts one of the user's own templates in the trash, and takes it out of their picks. */
  removeTemplate(id: string): Promise<EditResult>;
  /** Listens for changes to the profile, by Claude or another device. Returns a function that stops listening. */
  onProfileChanged(listener: (profile: Profile) => void): () => void;
  /** The fact bank, file by file. Each change answers with it as it is then. */
  factBank(): Promise<FactBank>;
  /** Gives a claim or a section new text, if it still reads as the window last read it. */
  changeFact(change: FactChange): Promise<FactResult>;
  /** Adds a claim to a file of facts, after its last one. */
  addFact(fact: NewFact): Promise<FactResult>;
  /** Deletes a claim, if it still reads as the window last read it. */
  removeFact(target: FactTarget): Promise<FactResult>;
  /** Confirms a claim drafted from the user's files, with them as its source and today's date. */
  confirmFact(target: FactTarget): Promise<FactResult>;
  /** Opens the system's terminal app, where the user runs Claude Code's own commands. */
  openTerminal(): Promise<EditResult>;
  /** Where an update to Factwright stands. */
  updateStatus(): Promise<UpdateStatus>;
  /** Listens for changes to where an update stands. Returns a function that stops listening. */
  onUpdateChanged(listener: (status: UpdateStatus) => void): () => void;
  /** Restarts into a downloaded update. Answers whether there was one to install. */
  installUpdate(): Promise<boolean>;
  /** The profiles on this computer, and how the open one signs in to Claude Code. */
  profiles(): Promise<ProfileList>;
  /**
   * Adds a profile, empty, for someone else or a fresh start. It opens with openProfile. The
   * first time, the first profile is named too: firstName, or its person's own name.
   */
  addProfile(name: string, firstName?: string): Promise<AddProfileResult>;
  renameProfile(id: string, name: string): Promise<EditResult>;
  /** Moves a profile that isn't open to the trash, with its whole job hunt on this computer. */
  removeProfile(id: string): Promise<EditResult>;
  /** Restarts the app on another profile. Not while Claude is working. */
  openProfile(id: string): Promise<EditResult>;
}
