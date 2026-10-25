import { statSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { ASK_ID, localDate } from '@factwright/core';
import { isRequestId } from '@factwright/sync';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
} from 'electron';
import type {
  ClaudeStatus,
  EditResult,
  PasteResult,
  PdfResult,
  SaveFileResult,
  SaveFocusResult,
  ShotFor,
  StartResult,
} from '../shared/api.ts';
import { effortFor, needsMore, parseEffort } from '../shared/effort.ts';
import { LIMITS } from '../shared/limits.ts';
import { modelFor, parseModels } from '../shared/models.ts';
import type { PermissionAnswer, PermissionAsk } from '../shared/permission-asks.ts';
import { parseRevisionRequest, REVISE_SKILL } from '../shared/revision.ts';
import type { QuestionRound, RoundReply } from '../shared/rounds.ts';
import { isWorkspacePath, RUN_CHANGES_ID } from '../shared/run-changes.ts';
import { scopeOf } from '../shared/runs.ts';
import type { UpdateStatus } from '../shared/updates.ts';
import { DOC_KINDS, type DocKind, parseChangesRequest } from '../shared/versions.ts';
import { registerAboutIpc } from './about/ipc.ts';
import type { TemplatePreviews } from './about/previews.ts';
import type { PrivateAnswers } from './about/private.ts';
import type { AboutStore } from './about/store.ts';
import type { Desk } from './claude/desk.ts';
import { loadEffort, saveEffort } from './claude/effort.ts';
import { claudeConfigFolder } from './claude/launch.ts';
import { loadModels, saveModels } from './claude/models.ts';
import { parsePermissionAnswer } from './claude/permission-asks.ts';
import { parseReply } from './claude/rounds.ts';
import type { RunChanges } from './claude/run-changes.ts';
import type { RunRequests } from './claude/run-requests.ts';
import type { SetupChecker } from './claude/self-test.ts';
import type { ClaudeSession } from './claude/session.ts';
import { claudeStatus, nodeStatusDeps } from './claude/status.ts';
import { BROWSERS } from './extension/browsers.ts';
import type { SaveHelper } from './extension/save-helper.ts';
import { hasFocus, parseFocus, saveFocus } from './jobs/focus.ts';
import { getFormQuestions } from './jobs/form-feed.ts';
import {
  parseCallChanges,
  parseDate,
  parseJobChanges,
  parseNewCall,
  parseNewJob,
  parseNewNote,
  parseNoteChanges,
} from './jobs/input.ts';
import type { Revisions } from './jobs/revisions.ts';
import type { JobsService } from './jobs/service.ts';
import type { Versions } from './jobs/versions.ts';
import type { JobOpener } from './open-job.ts';
import {
  copyProblem,
  JOB_ID,
  listedFile,
  MAX_PREVIEW_BYTES,
  openableFile,
  parseRunTask,
  parseTerminalSize,
  previewablePdf,
  readableWord,
  runPrompt,
  saveableFileName,
} from './policy.ts';
import { markFirstRunDone, type Profiles } from './profiles.ts';
import type { CallReminders } from './reminders.ts';
import type { TemplateLibrary } from './resume/templates.ts';
import type { SyncAccount } from './sync/account.ts';
import type { FetchDeps } from './tools/posting.ts';
import type { UpdateWatcher } from './updates.ts';

/** The most the window may send to Claude Code at once: a long paste, but not a flood. */
const MAX_INPUT_LENGTH = 100_000;

/** The most text the window may copy or save at once, such as a long journey spreadsheet. */
const MAX_TEXT_LENGTH = 5_000_000;

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;

/** The answer to an edit the window sent in a shape the app doesn't take. */
const REFUSED = { ok: false, message: 'That change couldn’t be saved.' } as const;

/** Why an answer to a permission prompt didn't reach Claude Code: it stopped waiting for it. */
const PERMISSION_GONE = {
  ok: false,
  message:
    'Claude Code isn’t waiting for this anymore. If you answered in the terminal, that answer stands.',
} as const;

/** Why answers to Claude's questions didn't reach it: it stopped waiting for them. */
const QUESTIONS_GONE = {
  ok: false,
  message:
    'Claude isn’t waiting for these answers anymore. If it still needs them, it asks in its panel.',
} as const;

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 300;

/** The most jobs the window may change at once: every job in a long list, but not a flood. */
const MAX_JOBS_AT_ONCE = 5000;

/** Browsers to set up, by the names the app knows them by, such as "chrome". */
const isBrowsers = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= BROWSERS.length &&
  value.every((each) => BROWSERS.some((browser) => browser.id === each));

const isIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.length <= MAX_JOBS_AT_ONCE && value.every(isId);

const isTextUpTo = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

/** What a screenshot from a job's panel is for: the application form, or a question for Claude. */
function shotFor(value: unknown): ShotFor | null {
  if (typeof value !== 'object' || value === null) return null;
  const { kind, ask } = value as Record<string, unknown>;
  if (kind === 'form' && ask === undefined) return { kind };
  if (kind === 'ask' && typeof ask === 'string' && ASK_ID.test(ask)) return { kind, ask };
  return null;
}

export interface IpcDeps {
  /** Whether a page is the app's own, the only page whose requests are answered. */
  isAppPage: (url: string) => boolean;
  /** What the user tells Factwright about themselves, their templates, and the previews. */
  about: AboutStore;
  /** What Profile keeps for applications on this computer alone. */
  kept: PrivateAnswers;
  templates: TemplateLibrary;
  previews: TemplatePreviews;
  claude: ClaudeSession;
  /** Claude's questions waiting on the user, which the window's dialog answers. */
  questions: Desk<QuestionRound, RoundReply>;
  /** Claude Code's permission prompts waiting on the user, which the window's dialog answers. */
  permissionAsks: Desk<PermissionAsk, PermissionAnswer>;
  /** Checks that Factwright's setup still works with each version of Claude Code. */
  setup: SetupChecker;
  jobs: JobsService;
  /** The revisions of jobs' resumes the user sent from their X-rays. */
  revisions: Revisions;
  /** The versions of jobs' resumes, cover letters and Projects pages. */
  versions: Versions;
  workspace: string;
  sync: SyncAccount;
  /** The app's own data folder, which holds Claude's settings. */
  dataDir: string;
  /** What each of Claude's tasks changed, with a copy of each file from before, for Undo. */
  runChanges: RunChanges;
  /** Keeps an installed copy up to date, or null for one that doesn't update itself. */
  updates: UpdateWatcher | null;
  /** The profiles on this computer: each person's own job hunt, one open at a time. */
  profiles: Profiles;
  /** Reminders before calls, which the user can turn off. */
  reminders: CallReminders;
  /** Opens a job in the window, such as from a reminder's click. */
  opener: JobOpener;
  /** The extension saving to this computer: where each browser stands, and setting it up. */
  saveHelper: SaveHelper;
  /** Tells the user a task is done, in the window's words, if they're looking elsewhere. */
  tellRunDone: (note: unknown) => void;
  /** The app's requests to the window to start a run, which the window answers. */
  runRequests: RunRequests;
  /** Stands in for Greenhouse's job API, as the tests' copy has it, or undefined to ask it. */
  formFeed?: FetchDeps['fetch'] | undefined;
}

/** A file's size in bytes, or null when it isn't a file. */
const fileSize = (path: string) => {
  try {
    const found = statSync(path);
    return found.isFile() ? found.size : null;
  } catch {
    return null;
  }
};

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Whether two paths are one file, as when the user picks a file to save a copy over itself. */
const sameFile = (a: string, b: string) => {
  try {
    const [x, y] = [statSync(a), statSync(b)];
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
};

/** Answers the window's requests, after checking each one came from the app's own page. */
export function registerIpc({
  isAppPage,
  about,
  kept,
  templates,
  previews,
  claude: session,
  questions,
  permissionAsks,
  setup,
  jobs,
  revisions,
  versions,
  workspace,
  sync,
  dataDir,
  runChanges,
  updates,
  profiles,
  reminders,
  opener,
  saveHelper,
  tellRunDone,
  runRequests,
  formFeed,
}: IpcDeps): void {
  const fromApp = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    isAppPage(event.senderFrame?.url ?? '');

  /** A request that expects an answer. Ones from outside the app are refused. */
  const answer = (channel: string, reply: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!fromApp(event)) throw new Error('Refused a request from a page outside the app.');
      return reply(...args);
    });
  };

  // Claude Code's first-run screens, which signing in with `claude auth login` leaves showing, are
  // marked done as pressing Enter through them would. Only for a Claude account: one signed in
  // with a key in the environment is asked on those screens whether to use it. And only while
  // none of the app's own Claude Code is going. Once they're done, they stay done.
  let firstRunDone = false;
  const markFirstRun = (status: ClaudeStatus) => {
    if (firstRunDone || status.state !== 'ready' || status.method !== 'subscription') return;
    if (session.busy() || setup.busy()) return;
    firstRunDone = markFirstRunDone(claudeConfigFolder(process.env), homedir()) !== 'left';
  };

  // Each status check also notices a new version of Claude Code, which gets its setup checked.
  answer('claude:status', async () => {
    const status = await claudeStatus(nodeStatusDeps());
    if (status.state === 'ready') {
      markFirstRun(status);
      setup.checkIfNeeded(status.version);
    }
    return status;
  });

  answer('setup:latest', () => setup.current());

  // Where an update stands, and restarting into one that's downloaded.
  answer('updates:status', (): UpdateStatus => updates?.current() ?? { state: 'none' });
  answer('updates:install', () => updates?.install() ?? false);

  // Which model Claude runs on, for everything and for each task. A change applies from the next
  // start, or the next task that needs another model.
  answer('claude:models', () => loadModels(dataDir));
  answer('claude:set-models', async (value) => {
    const models = parseModels(value);
    if (!models) throw new Error('Refused models Claude Code doesn’t know.');
    await saveModels(dataDir, models);
    return models;
  });
  answer('claude:effort', () => loadEffort(dataDir));
  answer('claude:set-effort', async (value) => {
    const effort = parseEffort(value);
    if (!effort) throw new Error('Refused effort levels Claude Code doesn’t know.');
    await saveEffort(dataDir, effort);
    return effort;
  });

  answer('setup:check', async () => {
    const status = await claudeStatus(nodeStatusDeps());
    if (status.state !== 'ready') return setup.current();
    markFirstRun(status);
    return setup.check(status.version);
  });

  /**
   * A task the window asked for, if it's a job search, names a skill and a job the app knows, with
   * one of its calls when it's for one, or a resume to copy that the app kept.
   */
  const knownTask = (value: unknown) => {
    const task = parseRunTask(value);
    if (task && 'source' in task) return templates.hasSource(task.source) ? task : null;
    // A focus for a search, by the ID the app kept it under.
    const focus = task && 'sources' in task ? task.sources?.focus : undefined;
    if (focus !== undefined) return hasFocus(workspace, focus) ? task : null;
    if (!task || !('jobId' in task)) return task;
    const job = jobs.list().jobs.find((each) => each.id === task.jobId);
    if (!job) return null;
    if ('callId' in task) return job.calls.some((call) => call.id === task.callId) ? task : null;
    return task;
  };

  answer('claude:start', (size, task) => {
    // The user's run comes first: a setup check that's going steps aside for it.
    setup.yieldToRun();
    const valid = parseTerminalSize(size);
    const run = task === undefined ? undefined : knownTask(task);
    if (!valid || run === null) throw new Error('Refused a request to start Claude.');
    // A revision runs only as the window prepared it, in one run, whose tool calls read it, and
    // so do the changes the user asked for.
    const revision = run && 'findings' in run ? revisions.claim(run) : undefined;
    if (revision === null) return Promise.resolve<StartResult>({ ok: false, reason: 'revision' });
    const changes =
      run && 'changes' in run
        ? versions.claimChanges(run.jobId, run.skill === REVISE_SKILL ? 'resume' : 'letter')
        : undefined;
    if (changes === null) return Promise.resolve<StartResult>({ ok: false, reason: 'changes' });
    return Promise.all([loadModels(dataDir), loadEffort(dataDir)]).then(
      async ([models, effort]) => {
        let started: StartResult;
        try {
          started = await session.start(valid, {
            prompt: run ? runPrompt(run) : undefined,
            choose: (levels) => ({
              model: modelFor(models, run, levels),
              effort: effortFor(effort, run, levels),
            }),
            scope: scopeOf(run),
            ...(revision && { revision }),
            ...(changes && { changes }),
          });
        } catch (error) {
          // It didn't start, so starting it again finds it.
          if (revision) revisions.release(revision);
          if (changes) versions.releaseChanges(changes);
          throw error;
        }
        // Once its run starts, the revision is kept for the before-and-after. If it didn't
        // start, starting it again finds it.
        if (revision && started.ok) await revisions.record(revision).catch(() => {});
        else if (revision) revisions.release(revision);
        if (changes && !started.ok) versions.releaseChanges(changes);
        return started;
      },
    );
  });

  // The resume's previous version is kept, and the revision held for the run the window starts.
  answer('xray:revise', (value) => {
    const request = parseRevisionRequest(value, JOB_ID);
    if (!request) throw new Error('Refused a revision that isn’t in the shape the app takes.');
    return revisions.prepare(request);
  });

  answer('xray:revision', (jobId, resume) =>
    typeof jobId === 'string' && typeof resume === 'string' ? revisions.state(jobId, resume) : null,
  );

  // Versions of what a job's folder holds to send. An earlier version is named by its folder,
  // which the app finds among the job's own before it touches anything.
  const isKind = (value: unknown): value is DocKind =>
    (DOC_KINDS as readonly unknown[]).includes(value);
  const isFolder = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 500;
  answer('versions:keep', async (jobId, kind) => {
    if (!isId(jobId) || !isKind(kind)) throw new Error('Refused a version that isn’t on file.');
    const kept = await versions.keep(jobId, kind, 'new');
    return kept.ok ? { ok: true } : kept;
  });
  answer('versions:use', (jobId, folder) => {
    if (!isId(jobId) || !isFolder(folder)) throw new Error('Refused a version that isn’t on file.');
    return versions.use(jobId, folder);
  });
  answer('versions:remove', (jobId, folder) => {
    if (!isId(jobId) || !isFolder(folder)) throw new Error('Refused a version that isn’t on file.');
    return versions.remove(jobId, folder);
  });
  answer('versions:changes', (value) => {
    const request = parseChangesRequest(value, JOB_ID);
    if (!request) throw new Error('Refused changes that aren’t in the shape the app takes.');
    return versions.prepareChanges(request);
  });

  // A task for the run that's open. One that needs another model or more effort, or may change
  // other files without asking, starts a new run instead. One that needs less effort runs at the
  // open run's. A lighter model still gets a run of its own, as that's what saves the most of a
  // plan, such as Sonnet for a job search on Pro.
  answer('claude:task', async (task): Promise<StartResult> => {
    const run = knownTask(task);
    if (!run) throw new Error('Refused a task for Claude.');
    // A revision's findings belong to its own run, so it always starts one, and so do changes.
    if ('findings' in run || 'changes' in run) return { ok: false, reason: 'new-run' };
    const [models, effort] = await Promise.all([loadModels(dataDir), loadEffort(dataDir)]);
    const differs = <T>(open: T | undefined, wanted: T) => open !== undefined && open !== wanted;
    const thinking = session.effort();
    const levels = session.levels();
    if (
      differs(session.model(), modelFor(models, run, levels)) ||
      (thinking !== undefined && needsMore(thinking, effortFor(effort, run, levels))) ||
      differs(session.scope(), scopeOf(run))
    ) {
      return { ok: false, reason: 'new-run' };
    }
    return session.task(runPrompt(run));
  });

  // What a task of Claude's changed, each file before and after it, and putting one back as it
  // was. Only a file in that task's own record, which the app keeps outside the workspace.
  const isRun = (value: unknown): value is string =>
    typeof value === 'string' && RUN_CHANGES_ID.test(value);
  answer('claude:change', (id, path) => {
    if (!isRun(id) || !isWorkspacePath(path))
      throw new Error('Refused a change Claude didn’t make.');
    return runChanges.see(id, path);
  });
  answer('claude:undo', (id, path, anyway) => {
    if (!isRun(id) || !isWorkspacePath(path) || typeof anyway !== 'boolean') {
      throw new Error('Refused a change Claude didn’t make.');
    }
    return runChanges.undo(id, path, anyway);
  });

  // A reply from Claude's panel, on one line, as a message of the user's own: nothing in it can
  // reach the terminal as a key that isn't text.
  ipcMain.on('claude:reply', (event, text: unknown) => {
    if (!fromApp(event) || typeof text !== 'string' || text.length > MAX_INPUT_LENGTH) return;
    const line = [...text.replace(/\s+/g, ' ')]
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code >= 0x20 && (code < 0x7f || code > 0x9f);
      })
      .join('')
      .trim();
    if (line) session.send(line);
  });

  ipcMain.on('claude:input', (event, data: unknown) => {
    if (fromApp(event) && typeof data === 'string' && data.length <= MAX_INPUT_LENGTH) {
      session.write(data);
    }
  });

  ipcMain.on('claude:resize', (event, size: unknown) => {
    const valid = parseTerminalSize(size);
    if (fromApp(event) && valid) session.resize(valid);
  });

  ipcMain.on('claude:stop', (event) => {
    if (fromApp(event)) session.stop();
  });

  // Whether the window started a run the app asked it to, as for a form's drafts.
  ipcMain.on('claude:run-request-answer', (event, id: unknown, answer: unknown) => {
    if (fromApp(event)) runRequests.answered(id, answer);
  });

  ipcMain.on('claude:done', (event, note: unknown) => {
    if (fromApp(event)) tellRunDone(note);
  });

  // Claude's questions, answered in the window's dialog, or sent to the terminal to answer there.
  answer('claude:question', () => questions.current());
  answer('claude:answer', (id, reply): EditResult => {
    const round = typeof id === 'string' ? questions.find(id) : null;
    if (!round) return QUESTIONS_GONE;
    if (reply === 'terminal') {
      questions.answer(round.id, null);
      return { ok: true };
    }
    const answers = parseReply(round, reply);
    if (!answers) throw new Error('Refused answers that don’t fit Claude’s questions.');
    return questions.answer(round.id, answers) ? { ok: true } : QUESTIONS_GONE;
  });

  // Claude Code's permission prompts, answered in the window's dialog, or in the terminal.
  answer('claude:permission', () => permissionAsks.current());
  answer('claude:permit', (id, value): EditResult => {
    const ask = typeof id === 'string' ? permissionAsks.find(id) : null;
    if (!ask) return PERMISSION_GONE;
    if (value === 'terminal') {
      permissionAsks.answer(ask.id, null);
      return { ok: true };
    }
    const answer = parsePermissionAnswer(value);
    if (!answer) throw new Error('Refused an answer that isn’t allow, or don’t allow with a note.');
    return permissionAsks.answer(ask.id, answer) ? { ok: true } : PERMISSION_GONE;
  });

  // A focus for one search, kept in the workspace for the search to read, by an ID it types.
  answer('search:focus', (value): SaveFocusResult => {
    const focus = parseFocus(value);
    if (!focus) return REFUSED;
    return { ok: true, id: saveFocus(workspace, focus, localDate()) };
  });

  answer('jobs:list', () => jobs.list());

  answer('jobs:docs', (jobId) => (isId(jobId) ? jobs.docs(jobId) : null));

  answer('jobs:extras', async (jobId) =>
    isId(jobId) && jobs.has(jobId)
      ? { ...jobs.extras(jobId), versions: await versions.list(jobId) }
      : null,
  );

  answer('jobs:record-answer', (jobId, question, nth, text) =>
    isId(jobId) &&
    isTextUpTo(question, LIMITS.question) &&
    Number.isInteger(nth) &&
    (nth as number) >= 0 &&
    (nth as number) < LIMITS.questions &&
    isTextUpTo(text, LIMITS.answer)
      ? jobs.recordAnswer(jobId, question, nth as number, text)
      : REFUSED,
  );

  // The questions of a job's application form, from Greenhouse before the form is open, kept
  // with the job for its Claude to draft.
  answer('jobs:form-questions', (jobId) =>
    isId(jobId) ? getFormQuestions(jobId, { jobs, ...(formFeed && { fetch: formFeed }) }) : REFUSED,
  );

  answer('jobs:ask', (jobId, question) =>
    isId(jobId) && isTextUpTo(question, LIMITS.ask) ? jobs.addAsk(jobId, question) : REFUSED,
  );

  answer('jobs:remove-ask', (jobId, askId) =>
    isId(jobId) && typeof askId === 'string' ? jobs.removeAsk(jobId, askId) : REFUSED,
  );

  answer('jobs:add-shot', (jobId, upload, purpose) => {
    const valid = shotFor(purpose);
    return isId(jobId) && valid ? jobs.addShot(jobId, upload, valid) : REFUSED;
  });

  answer('jobs:remove-shot', (path) => jobs.removeShot(path));

  answer('jobs:shot', (path) => jobs.shot(path));

  // A picture pasted into Claude's panel: saved with the run's job, or on its own, and handed
  // back by where it is on this computer, which Claude Code attaches when it's pasted.
  answer('claude:paste-image', async (upload, jobId): Promise<PasteResult> => {
    if (jobId !== null && !(isId(jobId) && jobs.has(jobId))) return REFUSED;
    const saved = await jobs.addShot(jobId, upload, { kind: 'pasted' });
    if (!saved.ok) return saved;
    const file = jobs.shotOnDisk(saved.path);
    if (!file) return REFUSED;
    // Claude Code reads a backslash in a pasted path as an escape, and takes forward slashes on Windows too.
    return { ok: true, file: process.platform === 'win32' ? file.replaceAll('\\', '/') : file };
  });

  answer('jobs:update', (jobId, changes) => {
    const valid = parseJobChanges(changes);
    return isId(jobId) && valid ? jobs.updateJob(jobId, valid) : REFUSED;
  });

  // Several jobs at once take a new status, not a new date for the one they have.
  answer('jobs:update-many', (jobIds, changes) => {
    const valid = parseJobChanges(changes);
    const redates = valid?.statusOn !== undefined && valid.status === undefined;
    return isIds(jobIds) && valid && !redates ? jobs.updateJobs(jobIds, valid) : REFUSED;
  });

  answer('jobs:merge', (keepId, otherId) =>
    isId(keepId) && isId(otherId) && keepId !== otherId ? jobs.mergeJobs(keepId, otherId) : REFUSED,
  );

  answer('jobs:add', (job) => {
    const valid = parseNewJob(job);
    return valid ? jobs.addJob(valid) : REFUSED;
  });

  answer('calls:add', (jobId, call) => {
    const valid = parseNewCall(call);
    return isId(jobId) && valid ? jobs.addCall(jobId, valid) : REFUSED;
  });

  answer('calls:update', (callId, changes) => {
    const valid = parseCallChanges(changes);
    return isId(callId) && valid ? jobs.updateCall(callId, valid) : REFUSED;
  });

  answer('calls:delete', (callId) => (isId(callId) ? jobs.deleteCall(callId) : REFUSED));

  answer('history:redate', (changeId, at) => {
    const date = parseDate(at);
    return isId(changeId) && date ? jobs.redateStatusChange(changeId, date) : REFUSED;
  });

  answer('history:undo', (changeId) =>
    isId(changeId) ? jobs.undoStatusChange(changeId) : REFUSED,
  );

  answer('notes:add', (jobId, note) => {
    const valid = parseNewNote(note);
    return isId(jobId) && valid ? jobs.addNote(jobId, valid) : REFUSED;
  });

  answer('notes:update', (noteId, changes) => {
    const valid = parseNoteChanges(changes);
    return isId(noteId) && valid ? jobs.updateNote(noteId, valid) : REFUSED;
  });

  answer('notes:delete', (noteId) => (isId(noteId) ? jobs.deleteNote(noteId) : REFUSED));

  answer('files:open', async (path): Promise<EditResult> => {
    const file = typeof path === 'string' ? openableFile(workspace, path) : null;
    if (!file || !isFile(file)) {
      return { ok: false, message: 'That file isn’t in your workspace anymore.' };
    }
    const failed = await shell.openPath(file);
    return failed ? { ok: false, message: 'Your computer couldn’t open that file.' } : { ok: true };
  });

  // One of a job's own files, as its panel lists them: a copy saved where the user picks, under its
  // own name, or the file shown where it's kept.
  const jobFile = (jobId: unknown, path: unknown) => {
    const file = listedFile(workspace, isId(jobId) ? jobs.job(jobId) : null, path);
    return file && isFile(file) ? file : null;
  };
  const GONE = { ok: false, message: 'That file isn’t in your workspace anymore.' } as const;
  ipcMain.handle(
    'files:download',
    async (event, jobId: unknown, path: unknown): Promise<SaveFileResult> => {
      if (!fromApp(event)) throw new Error('Refused a request from a page outside the app.');
      const file = jobFile(jobId, path);
      if (!file) return GONE;
      const kind = extname(file).slice(1).toLowerCase();
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = {
        defaultPath: join(app.getPath('downloads'), basename(file)),
        filters: [{ name: kind === 'pdf' ? 'PDF' : 'Word document', extensions: [kind] }],
      };
      const choice = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return { ok: true, saved: false };
      if (sameFile(file, choice.filePath)) return { ok: true, saved: true };
      try {
        await copyFile(file, choice.filePath);
        return { ok: true, saved: true };
      } catch (error) {
        // A new version may have replaced it while the dialog was open.
        if (!isFile(file)) return GONE;
        return { ok: false, message: copyProblem((error as NodeJS.ErrnoException).code) };
      }
    },
  );
  answer('files:show', (jobId, path): EditResult => {
    const file = jobFile(jobId, path);
    if (!file) return GONE;
    shell.showItemInFolder(file);
    return { ok: true };
  });

  answer('files:pdf', async (path): Promise<PdfResult> => {
    const file = typeof path === 'string' ? previewablePdf(workspace, path) : null;
    const size = file ? fileSize(file) : null;
    if (!file || size === null) {
      return { ok: false, message: 'That file isn’t in your workspace anymore.' };
    }
    if (size > MAX_PREVIEW_BYTES) {
      return { ok: false, message: 'That PDF is too big to preview here. Open it instead.' };
    }
    return { ok: true, data: new Uint8Array(await readFile(file)) };
  });

  answer('files:docx', async (path): Promise<PdfResult> => {
    const file = typeof path === 'string' ? readableWord(workspace, path) : null;
    const size = file ? fileSize(file) : null;
    if (!file || size === null) {
      return { ok: false, message: 'That file isn’t in your workspace anymore.' };
    }
    if (size > MAX_PREVIEW_BYTES) {
      return { ok: false, message: 'That Word file is too big to read here. Open it instead.' };
    }
    return { ok: true, data: new Uint8Array(await readFile(file)) };
  });

  // Reminders an hour before each call, on this computer, until the user turns them off.
  answer('reminders:get', () => reminders.isOn());
  answer('reminders:set', (on) => {
    if (typeof on !== 'boolean')
      throw new Error('Refused a change to reminders that isn’t on or off.');
    return reminders.turn(on);
  });
  // The window's page listens for jobs to open, and gets one waiting, if any.
  ipcMain.on('jobs:listening', (event) => {
    if (fromApp(event)) opener.listen(event.sender);
  });

  // The clipboard takes the text in its own time, so it's copied once that's done.
  answer('clipboard:write', async (text): Promise<EditResult> => {
    if (!isText(text)) return REFUSED;
    await clipboard.writeText(text);
    return { ok: true };
  });

  // The user picks where the file goes, in the system's own save dialog.
  ipcMain.handle(
    'files:save',
    async (event, name: unknown, text: unknown): Promise<SaveFileResult> => {
      if (!fromApp(event)) throw new Error('Refused a request from a page outside the app.');
      const fileName = saveableFileName(name);
      if (!fileName || !isText(text)) return { ok: false, message: 'That file couldn’t be saved.' };
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = { defaultPath: join(app.getPath('downloads'), fileName) };
      const choice = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return { ok: true, saved: false };
      try {
        await writeFile(choice.filePath, text);
        return { ok: true, saved: true };
      } catch {
        return { ok: false, message: 'That folder can’t be written to. Pick another one.' };
      }
    },
  );

  /** Codes and keys people type: 32 letters and numbers, with spaces or dashes. */
  const isTyped = (value: unknown): value is string =>
    typeof value === 'string' && value.length <= 100;

  answer('sync:status', () => sync.status());
  answer('sync:sign-in', () => sync.signInWithBrowser());
  answer('sync:connect', (address) =>
    typeof address === 'string' && address.length <= 2000 ? sync.connect(address) : REFUSED,
  );
  answer('sync:server-terms', () => sync.serverTerms());
  ipcMain.on('sync:cancel-sign-in', (event) => {
    if (fromApp(event)) sync.cancelSignIn();
  });
  answer('sync:recovery-key', () => sync.newRecoveryKey());
  answer('sync:turn-on', () => sync.turnOn());
  answer('sync:link', (code) => (isTyped(code) ? sync.linkWithCode(code) : REFUSED));
  answer('sync:recover', (key) => (isTyped(key) ? sync.useRecoveryKey(key) : REFUSED));
  answer('sync:link-code', () => sync.makeLinkCode());
  ipcMain.on('sync:cancel-link-code', (event, id: unknown) => {
    if (fromApp(event) && isId(id)) void sync.cancelLinkCode(id);
  });
  answer('sync:approvals', () => sync.approvalsView());
  answer('sync:ask', () => sync.askToLink());
  ipcMain.on('sync:confirm-check', (event, matched: unknown) => {
    if (fromApp(event) && typeof matched === 'boolean') sync.confirmLinkCheck(matched);
  });
  answer('sync:approve', (id) => (isRequestId(id) ? sync.approveRequest(id) : REFUSED));
  answer('sync:answer', (matched) =>
    typeof matched === 'boolean' ? sync.answerApproval(matched) : REFUSED,
  );
  answer('sync:deny', (id) => (isRequestId(id) ? sync.denyRequest(id) : REFUSED));
  answer('sync:sign-out-turned-down', () => sync.signOutTurnedDown());
  ipcMain.on('sync:dismiss-approval', (event) => {
    if (fromApp(event)) sync.dismissApproval();
  });
  ipcMain.on('sync:now', (event) => {
    if (fromApp(event)) sync.requestSync();
  });
  answer('sync:account', () => sync.account());
  answer('sync:remove-device', (id) => (isId(id) ? sync.removeDevice(id) : REFUSED));
  answer('sync:sign-out', () => sync.signOut());
  answer('sync:different-account', () => sync.useDifferentAccount());
  answer('sync:subscribe', () => sync.subscribe());
  answer('sync:account-page', () => sync.openAccountPage());

  // Profiles, each checked by Profiles itself. Opening another restarts the app on it.
  answer('profiles:list', () => profiles.list());
  answer('profiles:add', (name, firstName) => profiles.add(name, firstName));
  answer('profiles:rename', (id, name) => profiles.rename(id, name));
  answer('profiles:remove', (id) => profiles.remove(id));
  answer('profiles:open', (id) => profiles.open(id));

  // The extension saving to this computer, from its window: where each browser stands,
  // setting browsers up, which macOS may ask the user about, and macOS's Files & Folders settings.
  answer('helper:status', () => saveHelper.status());
  answer('helper:set-up', (only) => {
    // Refused with an error, which the window shows, as it expects where browsers stand.
    if (only !== undefined && !isBrowsers(only))
      throw new Error('Those aren’t browsers to set up.');
    return saveHelper.setUp(only);
  });
  answer('helper:files-and-folders', () => saveHelper.openFilesAndFolders());

  registerAboutIpc(answer, { about, previews, templates, kept, workspace });
}
