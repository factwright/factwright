import { randomUUID } from 'node:crypto';
import type { RunSignal } from '../../shared/api.ts';
import type { RunRequest, RunRequestAnswer, RunTask } from '../../shared/runs.ts';

/** How long the window has to say whether it started a run: it says at once, when it's there. */
const ANSWER_WITHIN_MS = 5000;

const ANSWERS: readonly RunRequestAnswer[] = ['started', 'busy', 'not-ready'];

/**
 * The app's requests to the window to start a run, as when the browser extension asks for drafts
 * of a form's questions: only the window has Claude's panel, so it starts the run, as its own Run
 * buttons do, and says whether it could. It never comes to the front for it.
 */
export class RunRequests {
  private readonly waiting = new Map<string, (answer: RunRequestAnswer | 'closed') => void>();
  private readonly send: (request: RunRequest) => boolean;
  private readonly withinMs: number;

  /** `send` asks the window, and says whether there was one to ask. */
  constructor(send: (request: RunRequest) => boolean, withinMs = ANSWER_WITHIN_MS) {
    this.send = send;
    this.withinMs = withinMs;
  }

  /** Asks the window to start a run, and says whether it did: "closed" when no window answered. */
  start(task: RunTask): Promise<RunRequestAnswer | 'closed'> {
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle('closed'), this.withinMs);
      const settle = (answer: RunRequestAnswer | 'closed') => {
        clearTimeout(timer);
        this.waiting.delete(id);
        resolve(answer);
      };
      this.waiting.set(id, settle);
      if (!this.send({ id, task })) settle('closed');
    });
  }

  /** The window's answer to a request, by its ID. Anything else is ignored. */
  answered(id: unknown, answer: unknown): void {
    if (typeof id !== 'string' || !ANSWERS.includes(answer as RunRequestAnswer)) return;
    this.waiting.get(id)?.(answer as RunRequestAnswer);
  }
}

/**
 * How long a run the window started has to get to work, unless it's waiting on the user: one
 * that hasn't by then didn't start.
 */
const WORK_WITHIN_MS = 2 * 60 * 1000;

/**
 * The run drafting a job's form's questions, as the browser extension follows it: which job's,
 * whether it's still at them, and whether it's waiting on the user in the window. Its turn is over
 * once Claude stops, or the run does, after it got to work: a run that makes way for the new one
 * stops first.
 */
export class FormDrafts {
  private readonly now: () => number;
  private jobId: string | null = null;
  private since = 0;
  private worked = false;
  private over = true;
  private needsYou = false;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** The window started a run to draft a job's form's questions. */
  started(jobId: string): void {
    this.jobId = jobId;
    this.since = this.now();
    this.worked = false;
    this.over = false;
    this.needsYou = false;
  }

  /** What the run signalled. */
  heard(signal: RunSignal): void {
    if (signal === 'working') {
      this.worked = true;
      this.needsYou = false;
    } else if (signal === 'needs-answer') {
      this.needsYou = true;
    } else if (
      signal === 'failed' ||
      ((signal === 'done' || signal === 'stopped') && this.worked)
    ) {
      this.over = true;
      this.needsYou = false;
    }
  }

  /**
   * Claude Code waits on the user before the run gets to work: to trust the workspace, or on one
   * of its first-run screens.
   */
  waitsOnYou(): void {
    if (!this.over) this.needsYou = true;
  }

  /**
   * Whether a job's form is being drafted, and whether that's waiting on the user, as for a
   * question in the window (`asking`).
   */
  state(jobId: string, asking: boolean): { drafting: boolean; waiting: boolean } {
    if (!this.worked && !this.needsYou && this.now() - this.since > WORK_WITHIN_MS) {
      this.over = true;
    }
    const drafting = !this.over && this.jobId === jobId;
    return { drafting, waiting: drafting && (this.needsYou || asking) };
  }
}
