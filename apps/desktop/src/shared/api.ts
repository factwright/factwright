import type {
  CallDocKind,
  CallKind,
  CallMode,
  CallOutcome,
  CallPerson,
  CallState,
  Job,
  JobDocs,
  JobShot,
  JobStatus,
  KeptPrivate,
  OutreachDraft,
  PassReason,
  SavedForm,
  SavedPosting,
  SearchFocus,
  WorkHistory,
} from '@factwright/core';
import type { AboutYou, AnswerChanges, Contact } from './about.ts';
import type { RunStep, TurnEnd } from './activity.ts';
import type { EffortChoices } from './effort.ts';
import type {
  FactBank,
  FactChange,
  FactResult,
  FactTarget,
  FiledFacts,
  GapTarget,
  NewFact,
} from './facts.ts';
import type { ModelChoices } from './models.ts';
import type { PermissionAnswer, PermissionAsk } from './permission-asks.ts';
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
import type { RevisionRequest, RevisionState } from './revision.ts';
import type { QuestionRound, RoundReply } from './rounds.ts';
import type { ChangeView, RunChanges, UndoResult } from './run-changes.ts';
import type { RunRequest, RunRequestAnswer, RunTask } from './runs.ts';
import type { SaveHelperView, SetUpResult } from './save-helper.ts';
import type {
  AccountResult,
  ApprovalsView,
  ConnectResult,
  LinkCodeResult,
  RecoveryKeyResult,
  ServerTerms,
  SyncStatus,
} from './sync.ts';
import type { UpdateStatus } from './updates.ts';
import type { ChangesRequest, DocKind, DocVersion } from './versions.ts';

/**
 * Where the user's Claude Code stands. The sidebar shows it, and runs start only when it's ready.
 * Until then, the window shows commands for the user to run in their terminal, and `claude` is
 * what they type to start Claude Code there, when that isn't just `claude`: its whole path, such
 * as `~/.local/bin/claude`. Its installer doesn't add its folder to PATH on Windows, nor always
 * on a Mac. While it's missing, it's where its own installer puts it.
 */
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
  | { state: 'signed-out'; version: string; claude?: string }
  | { state: 'too-old'; version: string; minimum: string; claude?: string }
  | { state: 'missing'; claude?: string }
  | { state: 'unknown'; claude?: string };

/**
 * Whether Factwright's setup works with the user's Claude Code, from a check that starts it
 * hidden with no prompt, so it uses none of their plan. "untrusted" means Claude Code is still
 * waiting for the user to trust the workspace, which they do in their first run. "first-run"
 * means it's showing the screens it shows until someone presses Enter through them once, which
 * the user does in Claude's panel.
 */
export interface SetupCheck {
  /** The Claude Code version checked. */
  version: string;
  result: 'passed' | 'failed' | 'untrusted' | 'first-run';
  /** For a failure, what went wrong, in plain words. */
  problem?: string;
  /** When, as an ISO time. */
  at: string;
}

/** A PDF's bytes, for showing its pages in the window, or why there are none. */
export type PdfResult = { ok: true; data: Uint8Array } | { ok: false; message: string };

/**
 * Where a run in Claude's panel stands. Claude Code's hooks report it, and so does its exit.
 * "ready" is a run started with nothing to do yet, open and waiting for what the user types.
 */
export type RunSignal = 'ready' | 'working' | 'needs-answer' | 'done' | 'stopped' | 'failed';

/** The size of Claude's panel, in characters. */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/**
 * Why a run didn't start. "revision": the app has no revision prepared for it, such as after a
 * restart, so it needs sending again. "changes": the same, for the changes the user asked for.
 */
export type StartProblem = 'not-ready' | 'failed' | 'revision' | 'changes';

/**
 * What a task in line waits for: its turn, while as many run as may at once; Claude's other task
 * on the same job, or the same part of the job hunt; or Claude Code getting past its first
 * screens in another run, which one run answers for all of them.
 */
export type LineWait = 'turn' | 'job' | 'setup';

/**
 * Where one of Claude's runs stands, as its tab shows it: waiting in line, starting, or as its
 * signals say.
 */
export type RunPhase = 'in-line' | 'starting' | RunSignal;

/** One of Claude's runs, or a task waiting in line for one: a tab in Claude's panel. */
export interface RunView {
  /** Its ID, such as "run-3", which everything about it carries. */
  id: string;
  /** What it's for, or null for Claude with nothing to do yet, waiting for what the user types. */
  task: RunTask | null;
  phase: RunPhase;
  /** What a task in line waits for, or null once it's started. */
  waits: LineWait | null;
  /**
   * A screen of Claude Code's own that only its terminal answers, which it shows now: its
   * first-run screens, or its question about trusting the workspace.
   */
  screen: 'first-run' | 'trust' | null;
  /** When it started, in milliseconds, or null while it waits in line. */
  startedAt: number | null;
  /** Why it didn't start, if it didn't. */
  problem: StartProblem | null;
}

/** Claude's runs, in the order they were asked for, and how many may run at once. */
export interface RunsView {
  runs: RunView[];
  atOnce: number;
  /**
   * Whether a run got past Claude Code's first-run screens and its question about trust. Until
   * one does, runs start one at a time.
   */
  setUp: boolean;
}

/**
 * Something one of Claude's runs waits on the user to answer in the app, such as a round of
 * questions: which run asked, and its place in the order they came in, to take them in turn.
 */
export interface FromRun {
  runId: string;
  since: number;
}

/** A round of Claude's questions waiting on the user, from one of the runs. */
export type WaitingRound = QuestionRound & FromRun;

/** One of Claude Code's permission prompts waiting on the user, from one of the runs. */
export type WaitingAsk = PermissionAsk & FromRun;

/** What one of Claude's runs printed, for its own terminal. */
export interface RunOutput {
  runId: string;
  data: string;
}

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
  /**
   * The pay to ask for there, in the user's words, such as "$185,000", or null to go by their
   * Claude's suggestion, or else their target pay.
   */
  payAsk?: string | null;
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

/** A call or interview the user logs, with as much as they know about it. */
export interface NewCall {
  kind: CallKind;
  onDate: string;
  atTime?: string | null;
  minutes?: number | null;
  mode?: CallMode | null;
  place?: string | null;
  people?: CallPerson[];
  notes?: string | null;
}

/** Changes to a logged call. Only the fields given change. */
export interface CallChanges {
  kind?: CallKind;
  onDate?: string;
  atTime?: string | null;
  minutes?: number | null;
  mode?: CallMode | null;
  place?: string | null;
  people?: CallPerson[];
  state?: CallState;
  outcome?: CallOutcome | null;
  notes?: string | null;
  debrief?: string | null;
}

/** Whether an edit was saved, and if not, why, in words the user can act on. */
export type EditResult = { ok: true } | { ok: false; message: string };

/** Whether answers sent for a job's questions were kept, and how many, or why they weren't. */
export type RecordedAnswers = { ok: true; recorded: number } | { ok: false; message: string };

/** Whether a file was saved, or the user canceled, or why it couldn't be. */
export type SaveFileResult = { ok: true; saved: boolean } | { ok: false; message: string };

/** Whether a job was added, and its ID if so. */
export type AddJobResult = { ok: true; jobId: string } | { ok: false; message: string };

/**
 * Whether the questions of a job's application form were got from Greenhouse and kept with the
 * job, and how many of them are for its Claude to draft, or why not.
 */
export type FormQuestionsResult = { ok: true; questions: number } | { ok: false; message: string };

/** Whether a search's focus was kept, and the ID the search reads it by if so. */
export type SaveFocusResult = { ok: true; id: string } | { ok: false; message: string };

/** A question for Claude about a job, kept under the ID its answer is saved by. */
export type AskResult = { ok: true; askId: string } | { ok: false; message: string };

/** What a screenshot is added with: the application form, a question for Claude, or Claude's panel. */
export type ShotFor = { kind: 'form' } | { kind: 'ask'; ask: string } | { kind: 'pasted' };

/** A screenshot saved in the workspace, by its path there, or why it wasn't. */
export type ShotResult = { ok: true; path: string } | { ok: false; message: string };

/**
 * Claude's answers to the user's questions about a job, by the question's ID, its screenshots,
 * the posting the user saved from their browser, its application form's questions, and Claude's
 * prep sheets and thank-you notes for its calls, by the call's ID.
 */
export interface JobExtras {
  asked: Record<string, string>;
  shots: JobShot[];
  posting: SavedPosting | null;
  /**
   * The questions of its application form for its Claude to draft, as the extension read them or
   * Greenhouse gave them.
   */
  form: SavedForm | null;
  calls: Record<string, Partial<Record<CallDocKind, string>>>;
  /** Messages Claude drafted for people at the company, newest first. */
  outreach: OutreachDraft[];
  /** Earlier versions of its resume, cover letter and Projects page, newest first. */
  versions: DocVersion[];
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

/** How the main process tells the window this copy has Factwright's own sync, as a switch. */
export const SYNC_ARGUMENT = '--factwright-sync';

/** What the app's window may ask of the main process. Nothing else crosses over. */
export interface FactwrightApi {
  /** The operating system, so the window can make room for its title bar buttons. */
  platform: string;
  /** Factwright's own version, such as "0.1.1". */
  version: string;
  /**
   * Whether this copy has Factwright's own sync, as Factwright's releases do. A copy built
   * anywhere else syncs only through a server of your own.
   */
  factwrightSync: boolean;
  claudeStatus(): Promise<ClaudeStatus>;
  /** The latest check of Factwright's setup with the user's Claude Code, or null before one. */
  setupCheck(): Promise<SetupCheck | null>;
  /** Checks the setup again now, and answers with what it found. */
  checkSetup(): Promise<SetupCheck | null>;
  /** Listens for new setup checks. Returns a function that stops listening. */
  onSetupCheck(listener: (check: SetupCheck) => void): () => void;
  /**
   * Starts the user's Claude Code in a run of its own, maybe with a task, and answers with the
   * run's ID. A task waits in line while as many run as may at once, or while Claude has another
   * on the same job, and starts by itself.
   */
  startClaude(task?: RunTask): Promise<string>;
  /** Claude's runs, and the tasks waiting in line, as they stand. */
  claudeRuns(): Promise<RunsView>;
  /** Listens for changes to Claude's runs. Returns a function that stops listening. */
  onClaudeRuns(listener: (view: RunsView) => void): () => void;
  /** How many of Claude's runs may go at once, and changing it, from 1 to 5. */
  runsAtOnce(): Promise<number>;
  setRunsAtOnce(count: number): Promise<number>;
  /**
   * Keeps what one job search looks for, on top of what the user wants in Profile, for that
   * search alone, and answers with the ID its task names it by.
   */
  saveSearchFocus(focus: SearchFocus): Promise<SaveFocusResult>;
  stopClaude(runId: string): void;
  /**
   * Closes a run's tab: Claude Code quits, if it's still open, and a task waiting in line leaves
   * the line.
   */
  closeRun(runId: string): void;
  /** Sends what the user types in a run's terminal to its Claude Code. */
  writeToClaude(runId: string, data: string): void;
  resizeClaude(runId: string, size: TerminalSize): void;
  /** Listens for each run's output. Returns a function that stops listening. */
  onClaudeOutput(listener: (output: RunOutput) => void): () => void;
  /**
   * Listens for what Claude does in each run, a tool call at a time, as it starts and once it's
   * done, to say so in Claude's panel. Returns a function that stops listening.
   */
  onClaudeStep(listener: (step: { runId: string; step: RunStep }) => void): () => void;
  /**
   * Listens for how each of Claude's turns ends, in each run: what it said last, or the error
   * that ended it. Returns a function that stops listening.
   */
  onClaudeTurnEnd(listener: (end: { runId: string; end: TurnEnd }) => void): () => void;
  /**
   * Listens for what each run's task changed in the job hunt, and the pages it read: nothing as
   * the task starts, then all of it once each of its turns ends. Returns a function that stops
   * listening.
   */
  onRunChanges(listener: (changes: { runId: string; changes: RunChanges }) => void): () => void;
  /**
   * A file of text a task changed, before and after it, by the task's ID and the file's path in
   * the workspace. Null for one that isn't text, or is too long to show.
   */
  viewChange(runId: string, path: string): Promise<ChangeView | null>;
  /**
   * Puts a file a task changed back as it was before the task, or moves one it made to the
   * trash. One that changed again since the task is left as it is, unless `anyway`.
   */
  undoChange(runId: string, path: string, anyway: boolean): Promise<UndoResult>;
  /** Sends a run's Claude a reply, such as to a question it stopped to ask, as if typed and sent. */
  replyToClaude(runId: string, text: string): void;
  /**
   * Tells the user a task is done, and what it made, in a notification, if they're looking
   * somewhere else.
   */
  tellRunDone(note: { title: string; body: string }): void;
  /**
   * Listens for the user clicking that notification, to open what the task made. Returns a
   * function that stops listening.
   */
  onOpenRunResult(listener: () => void): () => void;
  /**
   * Listens for the app asking the window to start a run on a task, as when the browser
   * extension asks for drafts of a form's questions. Returns a function that stops listening.
   */
  onRunRequest(listener: (request: RunRequest) => void): () => void;
  /** Says whether the window started a run the app asked for, and if not, why. */
  answerRunRequest(id: string, answer: RunRequestAnswer): void;
  /** The rounds of Claude's questions waiting on the user to answer in the window, oldest first. */
  claudeQuestions(): Promise<WaitingRound[]>;
  /**
   * Listens for Claude's questions: every round waiting on the user, from every run, oldest
   * first. Returns a function that stops listening.
   */
  onClaudeQuestions(listener: (rounds: WaitingRound[]) => void): () => void;
  /** Answers a round of Claude's questions, or sends it to the terminal to answer there. */
  answerClaude(id: string, reply: RoundReply | 'terminal'): Promise<EditResult>;
  /** The permission prompts Claude Code is waiting on the user to answer in the window. */
  claudePermissions(): Promise<WaitingAsk[]>;
  /**
   * Listens for Claude Code's permission prompts: every one waiting on the user, from every run,
   * oldest first. Returns a function that stops listening.
   */
  onClaudePermissions(listener: (asks: WaitingAsk[]) => void): () => void;
  /** Answers a permission prompt, or sends it to the terminal to answer there. */
  answerPermission(id: string, answer: PermissionAnswer | 'terminal'): Promise<EditResult>;
  listJobs(): Promise<JobList>;
  /** The text of a job's documents, such as its posting and fit check. */
  jobDocs(jobId: string): Promise<JobDocs | null>;
  updateJob(jobId: string, changes: JobChanges): Promise<EditResult>;
  /** Makes the same change to several jobs at once, such as moving them all to To review. */
  updateJobs(jobIds: string[], changes: JobChanges): Promise<EditResult>;
  /**
   * Merges another job into one, for a job the skills' work found twice: its status, notes, calls
   * and links move to the job kept, and it leaves the list.
   */
  mergeJobs(keepId: string, otherId: string): Promise<EditResult>;
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
  /**
   * Listens for the app asking the window to open a job, such as when the user clicks a call's
   * reminder. Returns a function that stops listening.
   */
  onOpenJob(listener: (jobId: string) => void): () => void;
  /** Whether Factwright reminds the user of each call an hour before it, on this computer. */
  callReminders(): Promise<boolean>;
  /** Turns reminders before calls on or off, on this computer. Answers with where they stand. */
  setCallReminders(on: boolean): Promise<boolean>;
  /** Claude's answers to the user's questions about a job, and its screenshots. */
  jobExtras(jobId: string): Promise<JobExtras | null>;
  /**
   * Keeps what the user actually sent for one of the application's questions, the nth time the
   * form asks it, counting from 0. Blank forgets it.
   */
  recordAnswer(jobId: string, question: string, nth: number, text: string): Promise<EditResult>;
  /**
   * Gets the questions of a job's application form from Greenhouse, for a job saved from a
   * posting there, before the form is open, and keeps the ones for its Claude to draft with the
   * job, among its application questions. The extension fills in their drafts once it's open.
   */
  getFormQuestions(jobId: string): Promise<FormQuestionsResult>;
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
  /**
   * Saves a copy of one of a job's resumes, cover letters or Projects pages where the user picks,
   * under its own name, in the system's own save dialog. Only a file the job lists.
   */
  downloadFile(jobId: string, path: string): Promise<SaveFileResult>;
  /** Shows one of a job's resumes, cover letters or Projects pages in Finder, or in its folder. */
  showFile(jobId: string, path: string): Promise<EditResult>;
  /** A resume PDF's bytes, to show its pages in the window. */
  readPdf(path: string): Promise<PdfResult>;
  /** A resume Word file's bytes, for its ATS X-ray. Answers as readPdf does. */
  readWord(path: string): Promise<PdfResult>;
  /**
   * Keeps a job's resume's previous version and holds what the user picked in its X-ray for the
   * revision run the window starts next. Says why not when it can't.
   */
  prepareRevision(request: RevisionRequest): Promise<{ ok: true } | { ok: false; message: string }>;
  /**
   * Where a job's resume stands for its X-ray's Revise tab: its newest revision, for the
   * before-and-after, and why it can't be revised, if it can't.
   */
  revisionOf(jobId: string, resume: string): Promise<RevisionState | null>;
  /**
   * Keeps the current version of a job's resume, cover letter or Projects page as an earlier one,
   * before the run the window starts makes a new one. Says why not when it can't, such as for one
   * the user applied with.
   */
  keepVersion(jobId: string, kind: DocKind): Promise<EditResult>;
  /** Makes an earlier version the job's again, putting the current one aside. */
  useVersion(jobId: string, folder: string): Promise<EditResult>;
  /** Moves an earlier version to the Trash. */
  removeVersion(jobId: string, folder: string): Promise<EditResult>;
  /**
   * Keeps the current version and holds what the user asked to change for the run the window
   * starts next, which reads it through a tool, never typed into it.
   */
  requestChanges(request: ChangesRequest): Promise<EditResult>;
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
  /** Where sync stands on this computer. */
  syncStatus(): Promise<SyncStatus>;
  /** Listens for changes in where sync stands. Returns a function that stops listening. */
  onSyncStatus(listener: (status: SyncStatus) => void): () => void;
  /**
   * Signs in to sync through the browser: to Factwright's own, or again to the server sync is
   * with, which may need an update first. Answers once the user approves, or it stops.
   */
  signInToSync(): Promise<ConnectResult>;
  /**
   * Connects a server of your own, by its address: checks it, then signs in to it through the
   * browser. Answers once the user approves, or it stops.
   */
  connectSyncServer(address: string): Promise<ConnectResult>;
  /**
   * The terms and price of the server sync is with, or of Factwright's own for turning sync on.
   * Null when there's no server, or it didn't answer.
   */
  syncServerTerms(): Promise<ServerTerms | null>;
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
  /**
   * Where sync is sold, for an account without it: opens the sync server's page for subscribing
   * in the browser, then checks every few seconds until the account has sync, and carries on by
   * itself, to setting up or to syncing again.
   */
  subscribeToSync(): Promise<EditResult>;
  /** Opens the account's page on the web, to download everything or delete the account. */
  openAccountPage(): Promise<void>;
  /** Everything about the user: their answers, notes and confidential names, and how far it's come. */
  profile(): Promise<Profile>;
  /** Saves changes to the answers, and answers with all of them. */
  saveAnswers(changes: AnswerChanges): Promise<AboutYou>;
  /**
   * What Profile keeps for applications on this computer alone: the street, the postal code and
   * the equal-opportunity answers, which never sync and which Claude's tools never reach.
   */
  privateAnswers(): Promise<KeptPrivate>;
  /** Saves changes to what's kept on this computer alone, and answers with all of it. */
  savePrivateAnswers(changes: Partial<KeptPrivate>): Promise<KeptPrivate>;
  /**
   * The contact details the newest resume Factwright made shows, to fill Profile's blanks with,
   * or null before it's made one.
   */
  contactFromResume(): Promise<Contact | null>;
  /** Saves the work history and education whole, and answers with them as kept. */
  saveHistory(history: WorkHistory): Promise<WorkHistory>;
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
  /** Verifies a claim that waits for it, with the user as its source and today's date. */
  confirmFact(target: FactTarget): Promise<FactResult>;
  /**
   * Takes back something the user said they don't have, so Claude may ask about it again, if it
   * still reads as the window last read it.
   */
  removeGap(target: GapTarget): Promise<FactResult>;
  /**
   * Listens for facts Claude files from the user's answers in a run, with all it has filed so far
   * in that run. Returns a function that stops listening.
   */
  onFactsFiled(listener: (filed: { runId: string; filed: FiledFacts }) => void): () => void;
  /** Opens the system's terminal app, where the user runs Claude Code's own commands. */
  openTerminal(): Promise<EditResult>;
  /** Where an update to Factwright stands. */
  updateStatus(): Promise<UpdateStatus>;
  /** Listens for changes to where an update stands. Returns a function that stops listening. */
  onUpdateChanged(listener: (status: UpdateStatus) => void): () => void;
  /** Restarts into a downloaded update. Answers whether there was one to install. */
  installUpdate(): Promise<boolean>;
  /**
   * Where saving from each browser to Factwright on this computer stands, for the Browser
   * extension window. Looking never touches a browser's folders.
   */
  saveHelperStatus(): Promise<SaveHelperView>;
  /**
   * Sets browsers up so the extension can save to Factwright on this computer: the ones
   * given, or every one found. On a Mac, macOS may ask the user first, once for each browser.
   */
  setUpSaveHelper(only?: string[]): Promise<SetUpResult>;
  /** Opens Files & Folders in macOS's System Settings. Answers whether it opened. */
  openFilesAndFolders(): Promise<boolean>;
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
