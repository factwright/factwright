// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FactwrightApi, RunsView, RunView } from '../shared/api.ts';
import type { ProfileList } from '../shared/profiles.ts';
import { App } from './App.tsx';
import { sampleApi } from './sample-api.ts';

// The terminal itself needs a real browser, and these tests are about what's around it.
vi.mock('./TerminalView.tsx', () => ({ TerminalView: () => null }));

beforeAll(() => {
  // jsdom doesn't open dialogs on its own.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The window, on the screens preview's sample answers as an address asks for them. */
function open(search: string, changes: Partial<FactwrightApi> = {}) {
  window.history.replaceState(null, '', `/${search}`);
  const whatsNewSeen = vi.fn(async () => {});
  render(<App api={{ ...sampleApi(), whatsNewSeen, ...changes }} />);
  return { whatsNewSeen };
}

const whatsNew = () => screen.queryByRole('dialog', { name: 'What’s new in 0.19.0' });

/** Gives what the app answered time to come in. */
const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 100));
  });

const JUST_UPDATED = '?profile=done&whats-new=0.19.0';

/** A run the app says is going, with what's new due only once the window has heard of it. */
function withRun(run: Pick<RunView, 'task' | 'phase'>): Partial<FactwrightApi> {
  const view: RunsView = {
    runs: [
      {
        id: 'run-1',
        waits: null,
        screen: null,
        startedAt: Date.now(),
        problem: null,
        analyzed: [],
        ...run,
      },
    ],
    atOnce: 3,
    setUp: true,
  };
  const claudeRuns = vi.fn(async () => view);
  return {
    claudeRuns,
    whatsNewDue: async () => {
      await claudeRuns();
      await new Promise((done) => setTimeout(done, 50));
      return '0.19.0';
    },
  };
}

describe('what’s new, as the window opens', () => {
  it('shows it over the jobs, and keeps that it has', async () => {
    const { whatsNewSeen } = open(JUST_UPDATED);
    await waitFor(() => expect(whatsNew()).not.toBeNull());
    expect(whatsNewSeen).toHaveBeenCalledTimes(1);
  });

  it('says nothing with nothing due', async () => {
    const { whatsNewSeen } = open('?profile=done');
    await screen.findByRole('heading', { name: 'Jobs' });
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(whatsNewSeen).not.toHaveBeenCalled();
  });

  it('never shows over Get started, and passes that version by', async () => {
    const { whatsNewSeen } = open('?profile=new&jobs=none&whats-new=0.19.0');
    await screen.findByRole('heading', { name: 'Let’s get you set up' });
    await waitFor(() => expect(whatsNewSeen).toHaveBeenCalledTimes(1));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows it for someone not through Get started, once they’re on the jobs', async () => {
    const { whatsNewSeen } = open('?profile=new&whats-new=0.19.0');
    await waitFor(() => expect(whatsNew()).not.toBeNull());
    expect(whatsNewSeen).toHaveBeenCalledTimes(1);
  });

  it('waits for the profiles, one of which may have its own dialog to show', async () => {
    let answer: (list: ProfileList) => void = () => {};
    const { whatsNewSeen } = open(JUST_UPDATED, {
      profiles: () => new Promise((resolve) => (answer = resolve)),
    });
    await screen.findByRole('heading', { name: 'Jobs' });
    await settle();
    expect(whatsNew()).toBeNull();
    expect(whatsNewSeen).not.toHaveBeenCalled();
    const list = await sampleApi().profiles();
    await act(async () => answer(list));
    await waitFor(() => expect(whatsNew()).not.toBeNull());
  });

  it('leaves it for the next open with the profile that didn’t open to tell of', async () => {
    const { whatsNewSeen } = open(`${JUST_UPDATED}&profiles=stopped`);
    await screen.findByRole('dialog', { name: 'Sam didn’t open' });
    await settle();
    expect(whatsNew()).toBeNull();
    expect(whatsNewSeen).not.toHaveBeenCalled();
  });

  it('leaves it for the next open with a run of the user’s waiting on them', async () => {
    const { whatsNewSeen } = open(
      '?profile=done',
      withRun({ task: { skill: 'focused-resume', jobId: 'acme--staff' }, phase: 'needs-answer' }),
    );
    await screen.findByRole('heading', { name: 'Jobs' });
    await settle();
    expect(whatsNew()).toBeNull();
    expect(whatsNewSeen).not.toHaveBeenCalled();
  });

  it('isn’t held up by a run Claude started on its own, which asks nothing', async () => {
    const { whatsNewSeen } = open(
      '?profile=done',
      withRun({
        task: { skill: 'analyze-job', jobIds: ['acme--staff'], auto: true },
        phase: 'working',
      }),
    );
    await waitFor(() => expect(whatsNew()).not.toBeNull());
    expect(whatsNewSeen).toHaveBeenCalledTimes(1);
  });
});
