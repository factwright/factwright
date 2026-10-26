import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askForJob, isLookUp } from '../src/messages.ts';
import { readSavedFor, savedOnComputer } from '../src/saved.ts';

/**
 * The browser as the popup sees it: native messaging allowed, and Factwright's answers, through
 * its helper, to what the popup asks.
 */
const browser = vi.hoisted(() => {
  const state = {
    sent: [] as Record<string, unknown>[],
    answer: (_message: Record<string, unknown>): unknown => null,
  };
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendNativeMessage: async (_application: string, message: Record<string, unknown>) => {
        state.sent.push(message);
        return state.answer(message);
      },
    },
    permissions: { contains: async () => true },
  };
  return state;
});

const PAGE = {
  url: 'https://jobs.lever.co/harborpine/4f1c2b7e/apply',
  company: 'Harbor & Pine',
  role: 'Senior Product Manager, Data',
};

const FOUND = {
  job: {
    id: 'harbor-and-pine--senior-pm-data',
    company: 'Harbor & Pine',
    role: 'Senior PM, Data',
    status: 'applied',
    appliedOn: '2026-10-20',
  },
  how: 'same',
};

beforeEach(() => {
  browser.sent = [];
});

describe('looking a page’s job up in Factwright on this computer', () => {
  it('asks with the page’s address, company and title alone, and takes the job it names', async () => {
    browser.answer = () => ({ ok: true, did: 'job', found: FOUND });
    expect(await savedOnComputer(PAGE)).toEqual({ found: FOUND });
    expect(browser.sent).toEqual([
      { type: 'ask', request: JSON.stringify({ ask: 'job', ...PAGE }) },
    ]);
    browser.answer = () => ({ ok: true, did: 'job', found: null });
    expect(await savedOnComputer(PAGE)).toEqual({ found: null });
  });

  it('hears no answer from Factwright closed, or from before it knew how to look', async () => {
    browser.answer = () => ({ ok: false, reason: 'closed' });
    expect(await savedOnComputer(PAGE)).toBeNull();
    browser.answer = () => ({
      ok: false,
      reason: 'bad-message',
      message: 'That wasn’t something Factwright answers.',
    });
    expect(await savedOnComputer(PAGE)).toBeNull();
    browser.answer = () => {
      throw new Error('Specified native messaging host not found.');
    };
    expect(await savedOnComputer(PAGE)).toBeNull();
  });

  it('takes only a job as Factwright names one', () => {
    expect(readSavedFor(FOUND)).toEqual(FOUND);
    expect(readSavedFor({ ...FOUND, how: 'maybe' })).toBeNull();
    expect(readSavedFor({ ...FOUND, job: { ...FOUND.job, role: 42 } })).toBeNull();
    expect(readSavedFor({ ...FOUND, job: { ...FOUND.job, appliedOn: undefined } })).toBeNull();
    expect(readSavedFor(null)).toBeNull();
    expect(readSavedFor({ ...FOUND, job: { ...FOUND.job, company: 'x'.repeat(500) } })).toEqual({
      ...FOUND,
      job: { ...FOUND.job, company: 'x'.repeat(200) },
    });
  });
});

describe('asking the background to look a page’s job up through sync', () => {
  it('takes only a look-up with the page’s address, company and title', () => {
    expect(isLookUp({ type: 'job', page: PAGE })).toBe(true);
    expect(isLookUp({ type: 'job', page: { ...PAGE, role: null } })).toBe(false);
    expect(isLookUp({ type: 'save', page: PAGE })).toBe(false);
    expect(isLookUp(null)).toBe(false);
  });

  it('takes the job it names, or none when the background doesn’t answer', async () => {
    const asked: unknown[] = [];
    expect(
      await askForJob(async (message) => {
        asked.push(message);
        return FOUND;
      }, PAGE),
    ).toEqual(FOUND);
    expect(asked).toEqual([{ type: 'job', page: PAGE }]);
    expect(await askForJob(async () => undefined, PAGE)).toBeNull();
    expect(
      await askForJob(async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }, PAGE),
    ).toBeNull();
  });
});
