import { describe, expect, it, vi } from 'vitest';
import { JobOpener, type JobPage } from './open-job.ts';

const page = (destroyed = false) => {
  const send = vi.fn();
  return { send, isDestroyed: () => destroyed } satisfies JobPage;
};

describe('opening a job in the window', () => {
  it('sends the job to a page that’s listening', () => {
    const opener = new JobOpener();
    const window = page();
    opener.listen(window);
    opener.open('acme--staff', window);
    expect(window.send).toHaveBeenCalledWith('jobs:open', 'acme--staff');
  });

  it('keeps the job for a page that isn’t listening yet, such as a window just opened', () => {
    const opener = new JobOpener();
    const opened = page();
    opener.open('acme--staff', opened);
    expect(opened.send).not.toHaveBeenCalled();
    opener.listen(opened);
    expect(opened.send).toHaveBeenCalledWith('jobs:open', 'acme--staff');
    // Once only.
    opener.listen(opened);
    expect(opened.send).toHaveBeenCalledTimes(1);
  });

  it('waits again while the page loads, and for a new window once the old one closed', () => {
    const opener = new JobOpener();
    const old = page();
    opener.listen(old);
    opener.forget(old);
    opener.open('acme--staff', old);
    expect(old.send).not.toHaveBeenCalled();
    const fresh = page();
    opener.open('northwind--panel', fresh);
    opener.listen(fresh);
    expect(fresh.send).toHaveBeenCalledWith('jobs:open', 'northwind--panel');
    expect(fresh.send).toHaveBeenCalledTimes(1);
    const closed = page(true);
    opener.listen(closed);
    opener.open('acme--staff', closed);
    expect(closed.send).not.toHaveBeenCalled();
  });
});
