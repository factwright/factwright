// @vitest-environment jsdom

import { TEMPLATES } from '@factwright/engine/templates';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type AboutYou, readAnswers } from '../../shared/about.ts';
import type { ClaudeStatus, FactwrightApi } from '../../shared/api.ts';
import type { Profile } from '../../shared/profile.ts';
import type { ClaudeStatusView } from '../useClaudeStatus.ts';
import { GetStarted } from './GetStarted.tsx';
import { useProfile } from './useProfile.ts';

beforeAll(() => {
  // jsdom doesn't scroll, or open dialogs, on its own.
  Element.prototype.scrollTo ??= () => {};
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(cleanup);

const READY: ClaudeStatus = { state: 'ready', version: '2.1.300', plan: 'pro' };

/** The window's API for the user's profile, keeping what's saved, like the app would. */
function profileApi(start: Partial<AboutYou> = {}) {
  let answers = readAnswers(start);
  let notes = '';
  let confidential: string[] = [];
  const profile = (): Profile => ({
    answers,
    notes,
    confidential,
    status: {
      facts: { claims: 0, unconfirmed: 0, files: 0 },
      starting: [],
      unread: [],
      notesChanged: false,
      criteria: 'none',
      connections: null,
    },
    templates: TEMPLATES.map(({ id, name, look }) => ({ id, name, look, own: false, stamp: '' })),
  });
  return {
    platform: 'darwin',
    profile: vi.fn(async () => profile()),
    saveAnswers: vi.fn(async (changes: Partial<AboutYou>) => {
      answers = { ...answers, ...changes };
      return answers;
    }),
    saveNotes: vi.fn(async (text: string) => {
      notes = text;
      return { ok: true as const };
    }),
    changeConfidential: vi.fn(async ({ add, remove }: { add: string[]; remove: string[] }) => {
      confidential = [...confidential.filter((name) => !remove.includes(name)), ...add];
      return confidential;
    }),
    onProfileChanged: vi.fn(() => () => {}),
    addFile: vi.fn(async (upload: { name: string; kind: AboutYou['files'][number]['kind'] }) => {
      const file = {
        path: `about-me/files/2026-10-12-${upload.name.toLowerCase()}`,
        name: upload.name,
        kind: upload.kind,
        added: '2026-10-12',
        textFile: null,
      };
      answers = { ...answers, files: [...answers.files, file] };
      return { ok: true as const, file };
    }),
    addLinkedIn: vi.fn(),
    removeFile: vi.fn(async (path: string) => {
      answers = { ...answers, files: answers.files.filter((file) => file.path !== path) };
      return answers;
    }),
    startProfile: vi.fn(async () => {
      answers = { ...answers, startedOn: '2026-10-12' };
      return answers;
    }),
    // jsdom can't draw PDFs, so the gallery shows each template without its picture.
    templatePreview: vi.fn(async () => ({ ok: false as const, message: 'No preview here' })),
    addTemplate: vi.fn(async () => ({
      ok: true as const,
      kind: 'copy' as const,
      source: '2026-10-12-1.png',
    })),
    removeTemplate: vi.fn(async () => ({ ok: true as const })),
    copyText: vi.fn(async () => ({ ok: true as const })),
    openTerminal: vi.fn(async () => ({ ok: true as const })),
  };
}

type Api = ReturnType<typeof profileApi>;

function Harness({
  api,
  claude = READY,
  onStart = () => {},
  onMakeTemplate = () => {},
  onSkip = () => {},
}: {
  api: Api;
  claude?: ClaudeStatusView;
  onStart?: () => void;
  onMakeTemplate?: (source: string) => void;
  onSkip?: () => void;
}) {
  const state = useProfile(api as unknown as FactwrightApi);
  if (!state.profile) return null;
  return (
    <GetStarted
      state={{ ...state, profile: state.profile }}
      api={api as unknown as FactwrightApi}
      claude={claude}
      onRecheckClaude={() => {}}
      canStartClaude
      onStart={onStart}
      onMakeTemplate={onMakeTemplate}
      onSkip={onSkip}
      onOpenSync={() => {}}
    />
  );
}

/** Answers and notes save half a second after typing stops. */
const SAVED = { timeout: 4000 };

const next = () =>
  userEvent.click(screen.getByRole('button', { name: /^(Continue|Get started)$/ }));

describe('GetStarted', () => {
  it('welcomes the user, says whose Claude does the work, and can be skipped', async () => {
    const onSkip = vi.fn();
    const { container } = render(<Harness api={profileApi()} onSkip={onSkip} />);
    expect(await screen.findByRole('heading', { name: 'Let’s get you set up' })).toBeTruthy();
    expect(screen.getByText(/It never sees your Claude login/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Your Claude is ready · Pro plan.');
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('shows how to install Claude Code when it’s missing, with the command to copy', async () => {
    const api = profileApi();
    render(<Harness api={api} claude={{ state: 'missing' }} />);
    expect(await screen.findByRole('heading', { name: 'Install Claude Code' })).toBeTruthy();
    expect(screen.getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy curl -fsSL https://claude.ai/install.sh | bash' }),
    );
    expect(api.copyText).toHaveBeenCalledWith('curl -fsSL https://claude.ai/install.sh | bash');
    await userEvent.click(screen.getByRole('button', { name: 'Open Terminal' }));
    expect(api.openTerminal).toHaveBeenCalledOnce();
  });

  it('saves the user’s answers as they type, and comes back to the step they were on', async () => {
    const api = profileApi();
    const { unmount } = render(<Harness api={api} />);
    await screen.findByRole('heading', { name: 'Let’s get you set up' });
    await next();
    await userEvent.type(screen.getByRole('textbox', { name: 'Your name' }), 'Jordan Avery');
    await waitFor(
      () =>
        expect(api.saveAnswers).toHaveBeenLastCalledWith(
          expect.objectContaining({ you: expect.objectContaining({ name: 'Jordan Avery' }) }),
        ),
      SAVED,
    );
    unmount();
    render(<Harness api={api} />);
    expect(await screen.findByRole('heading', { name: 'About you' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Your name' }) as HTMLInputElement).value).toBe(
      'Jordan Avery',
    );
  });

  it('adds the user’s files, with the text read out of them', async () => {
    const api = profileApi({ step: 2, reached: 2 });
    const { container } = render(<Harness api={api} />);
    await screen.findByRole('heading', { name: 'Your resumes and profile' });
    const picker = container.querySelector(
      'input[accept=".pdf,.docx,.txt,.md"]',
    ) as HTMLInputElement;
    await userEvent.upload(
      picker,
      new File(['Jordan Avery, product manager'], 'Resume.txt', { type: 'text/plain' }),
    );
    await waitFor(() => expect(api.addFile).toHaveBeenCalledOnce());
    expect(api.addFile.mock.calls[0]?.[0]).toMatchObject({ name: 'Resume.txt', kind: 'resume' });
    expect(await screen.findByText('Resume.txt')).toBeTruthy();
    expect(screen.getByText(/never signs in to LinkedIn for you/)).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Resume.txt' }));
    expect(api.removeFile).toHaveBeenCalledWith('about-me/files/2026-10-12-resume.txt');
    await waitFor(() => expect(screen.queryByText('Resume.txt')).toBeNull());
  });

  it('starts the user writing, and keeps the names to keep private', async () => {
    const api = profileApi({ step: 3, reached: 3 });
    const { container } = render(<Harness api={api} />);
    await screen.findByRole('heading', { name: 'Tell us everything' });
    await userEvent.click(screen.getByRole('button', { name: 'A project I’m proud of' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'About you, in your own words' }),
      'the loyalty program',
    );
    await waitFor(
      () =>
        expect(api.saveNotes).toHaveBeenLastCalledWith(
          'A project I’m proud of: the loyalty program',
        ),
      SAVED,
    );
    expect(screen.getByText(/8 words/)).toBeTruthy();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Names to keep private' }),
      'Bluebird{Enter}',
    );
    expect(api.changeConfidential).toHaveBeenLastCalledWith({ add: ['Bluebird'], remove: [] });
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('asks what the user wants, thoroughly', async () => {
    const api = profileApi({ step: 4, reached: 4 });
    const { container } = render(<Harness api={api} />);
    await screen.findByRole('heading', { name: 'What you want' });
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Job titles you want' }),
      'Product Manager{Enter}',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Senior' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remote' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Remote from' }), 'the US');
    await userEvent.click(screen.getByRole('button', { name: 'Startups' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Keep my search quiet/ }));
    await waitFor(
      () =>
        expect(api.saveAnswers).toHaveBeenLastCalledWith(
          expect.objectContaining({ quiet: true, remoteFrom: 'the US' }),
        ),
      SAVED,
    );
    const saved = await api.profile();
    expect(saved.answers).toMatchObject({
      roles: ['Product Manager'],
      levels: ['senior'],
      workplaces: ['remote'],
      companies: ['startup'],
    });
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('starts with the suggested templates picked, and lets the user pick for each kind of company', async () => {
    const api = profileApi({
      step: 5,
      reached: 5,
      companies: ['startup', 'established'],
      fields: ['software'],
      levels: ['senior'],
    });
    const { container } = render(<Harness api={api} />);
    await screen.findByRole('heading', { name: 'Pick your resume templates' });
    await waitFor(
      () =>
        expect(api.saveAnswers).toHaveBeenLastCalledWith(
          expect.objectContaining({
            looks: [
              { layout: 'minimal', for: 'startup' },
              { layout: 'classic', for: 'established' },
            ],
          }),
        ),
      SAVED,
    );
    const classic = screen.getByRole('heading', { name: 'Classic' }).closest('li') as HTMLElement;
    await userEvent.selectOptions(
      within(classic).getByRole('combobox', { name: 'Use it for' }),
      'any',
    );
    const minimal = screen.getByRole('heading', { name: 'Minimal' }).closest('li') as HTMLElement;
    await userEvent.click(within(minimal).getByRole('checkbox', { name: 'Use this template' }));
    await userEvent.click(screen.getByRole('radio', { name: 'One page' }));
    await waitFor(
      () => expect(api.saveAnswers).toHaveBeenLastCalledWith(expect.objectContaining({ pages: 1 })),
      SAVED,
    );
    expect((await api.profile()).answers.looks).toEqual([{ layout: 'classic', for: 'any' }]);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('has Claude make a template from a resume the user likes, while they carry on', async () => {
    const api = profileApi({ step: 5, reached: 5 });
    const onMakeTemplate = vi.fn();
    render(<Harness api={api} onMakeTemplate={onMakeTemplate} />);
    await screen.findByRole('heading', { name: 'Pick your resume templates' });
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(picker, new File(['png'], 'Liked.png', { type: 'image/png' }));
    await waitFor(() => expect(onMakeTemplate).toHaveBeenCalledWith('2026-10-12-1.png'));
    expect(
      await screen.findByText(
        'Your Claude is making a template in its look. It shows up here once it’s saved.',
      ),
    ).toBeTruthy();
  });

  it('hands everything to Claude once there’s something to start from', async () => {
    const api = profileApi({ step: 6, reached: 6 });
    const onStart = vi.fn();
    const { container } = render(<Harness api={api} onStart={onStart} />);
    await screen.findByRole('heading', { name: 'Ready for your Claude' });
    const start = screen.getByRole('button', {
      name: 'Start with your Claude',
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByText('Add a resume, or tell us about yourself, first.')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Change in your words' }));
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'About you, in your own words' }),
      'I have run the support team at a regional bank for six years, and I trained every new hire on the systems we use there.',
    );
    await next();
    await next();
    await next();
    await userEvent.click(screen.getByRole('button', { name: 'Start with your Claude' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledOnce(), SAVED);
    expect(api.startProfile).toHaveBeenCalledOnce();
    // Everything typed was saved before Claude started.
    expect(api.saveNotes).toHaveBeenCalled();
  });

  it('waits for Claude to be ready before starting', async () => {
    const api = profileApi({ step: 6, reached: 6, files: [] });
    await act(async () => {
      render(<Harness api={api} claude={{ state: 'signed-out', version: '2.1.300' }} />);
    });
    expect(await screen.findByRole('heading', { name: 'Sign in to Claude Code' })).toBeTruthy();
    expect(screen.getByText('claude auth login')).toBeTruthy();
  });
});
