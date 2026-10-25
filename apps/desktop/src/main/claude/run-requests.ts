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

/** Where one job's drafts stand. */
interface Drafting {
  since: number;
  worked: boolean;
  over: boolean;
  needsYou: boolean;
}

/**
 * The runs drafting jobs' forms' questions, as the browser extension follows them, each job's on
 * its own, as runs go side by side: whether it's still at them, and whether it's waiting on the
 * user in the window. Its turn is over once Claude stops, or the run does, after it got to work.
 */
export class FormDrafts {
  private readonly now: () => number;
  private readonly jobs = new Map<string, Drafting>();

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** The window started a run to draft a job's form's questions. */
  started(jobId: string): void {
    this.jobs.set(jobId, { since: this.now(), worked: false, over: false, needsYou: false });
  }

  /** What a run drafting a job's form's questions signalled. */
  heard(signal: RunSignal, jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (signal === 'working') {
      job.worked = true;
      job.needsYou = false;
    } else if (signal === 'needs-answer') {
      job.needsYou = true;
    } else if (signal === 'failed' || ((signal === 'done' || signal === 'stopped') && job.worked)) {
      job.over = true;
      job.needsYou = false;
    }
  }

  /**
   * Claude Code waits on the user before the run drafting a job's form gets to work: to trust the
   * workspace, or on one of its first-run screens.
   */
  waitsOnYou(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && !job.over) job.needsYou = true;
  }

  /**
   * Whether a job's form is being drafted, and whether that's waiting on the user, as for a
   * question in the window (`asking`).
   */
  state(jobId: string, asking: boolean): { drafting: boolean; waiting: boolean } {
    const job = this.jobs.get(jobId);
    if (!job) return { drafting: false, waiting: false };
    if (!job.worked && !job.needsYou && this.now() - job.since > WORK_WITHIN_MS) job.over = true;
    // One that's over is let go, so the jobs it follows are only ones being drafted.
    if (job.over) {
      this.jobs.delete(jobId);
      return { drafting: false, waiting: false };
    }
    return { drafting: true, waiting: job.needsYou || asking };
  }
}
