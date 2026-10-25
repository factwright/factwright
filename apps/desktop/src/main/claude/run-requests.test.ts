import { describe, expect, it, vi } from 'vitest';
import type { RunRequest } from '../../shared/runs.ts';
import { FormDrafts, RunRequests } from './run-requests.ts';

const TASK = { skill: 'answer-questions', jobId: 'acme--staff', form: true } as const;

describe('asking the window to start a run', () => {
  it('sends the task, and says whether the window started it', async () => {
    const sent: RunRequest[] = [];
    const requests = new RunRequests((request) => {
      sent.push(request);
      return true;
    });
    const started = requests.start(TASK);
    expect(sent).toEqual([{ id: expect.any(String), task: TASK }]);
    // An answer that isn't one, or for another request, settles nothing.
    requests.answered(sent[0]?.id, 'maybe');
    requests.answered('another', 'busy');
    requests.answered(sent[0]?.id, 'started');
    expect(await started).toBe('started');
    const busy = requests.start(TASK);
    requests.answered(sent[1]?.id, 'busy');
    expect(await busy).toBe('busy');
  });

  it('says the window’s closed when there’s none, or it doesn’t answer in time', async () => {
    expect(await new RunRequests(() => false).start(TASK)).toBe('closed');
    vi.useFakeTimers();
    try {
      const waiting = new RunRequests(() => true, 1000).start(TASK);
      vi.advanceTimersByTime(1000);
      expect(await waiting).toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('following the run that drafts a form’s questions', () => {
  it('is drafting from its start until Claude is done, for that job alone', () => {
    const drafts = new FormDrafts(() => 0);
    expect(drafts.state('acme--staff', false)).toEqual({ drafting: false, waiting: false });
    drafts.started('acme--staff');
    // A run drafting another job's form, side by side, says nothing of this one.
    drafts.heard('working', 'globex--pm');
    drafts.heard('done', 'globex--pm');
    expect(drafts.state('acme--staff', false)).toEqual({ drafting: true, waiting: false });
    expect(drafts.state('globex--pm', false)).toEqual({ drafting: false, waiting: false });
    drafts.heard('working', 'acme--staff');
    drafts.heard('needs-answer', 'acme--staff');
    expect(drafts.state('acme--staff', false)).toEqual({ drafting: true, waiting: true });
    drafts.heard('working', 'acme--staff');
    // A question in the window waits on the user too.
    expect(drafts.state('acme--staff', true)).toEqual({ drafting: true, waiting: true });
    drafts.heard('done', 'acme--staff');
    expect(drafts.state('acme--staff', false)).toEqual({ drafting: false, waiting: false });
  });

  it('follows two jobs’ drafts side by side, each on its own', () => {
    const drafts = new FormDrafts(() => 0);
    drafts.started('acme--staff');
    drafts.heard('working', 'acme--staff');
    drafts.started('globex--pm');
    drafts.heard('needs-answer', 'globex--pm');
    expect(drafts.state('acme--staff', false)).toEqual({ drafting: true, waiting: false });
    expect(drafts.state('globex--pm', false)).toEqual({ drafting: true, waiting: true });
    drafts.heard('done', 'acme--staff');
    expect(drafts.state('acme--staff', false).drafting).toBe(false);
    expect(drafts.state('globex--pm', false).drafting).toBe(true);
  });

  it('waits on the user to trust the workspace, and ends when the run fails or never starts', () => {
    let now = 0;
    const drafts = new FormDrafts(() => now);
    drafts.started('acme--staff');
    drafts.waitsOnYou('globex--pm');
    expect(drafts.state('acme--staff', false)).toEqual({ drafting: true, waiting: false });
    drafts.waitsOnYou('acme--staff');
    now = 10 * 60 * 1000;
    expect(drafts.state('acme--staff', false)).toEqual({ drafting: true, waiting: true });
    drafts.heard('failed', 'acme--staff');
    expect(drafts.state('acme--staff', false).drafting).toBe(false);
    // One the window said it started, which never got to work.
    drafts.started('acme--staff');
    now += 2 * 60 * 1000 + 1;
    expect(drafts.state('acme--staff', false).drafting).toBe(false);
  });
});
