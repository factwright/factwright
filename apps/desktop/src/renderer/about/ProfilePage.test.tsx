// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readAnswers } from '../../shared/about.ts';
import type { FactwrightApi } from '../../shared/api.ts';
import type { Profile, ProfileStatus } from '../../shared/profile.ts';
import type { RunPhase } from '../useClaudeRun.ts';
import { ProfilePage } from './ProfilePage.tsx';
import { useProfile } from './useProfile.ts';

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

afterEach(cleanup);

const ANSWERS = readAnswers({
  you: { name: 'Jordan Avery', email: 'jordan@example.com' },
  roles: ['Product Manager'],
  levels: ['senior'],
  workplaces: ['remote'],
  companies: ['startup'],
  looks: [{ layout: 'modern', for: 'startup' }],
  files: [
    {
      path: 'about-me/files/2026-10-12-resume.pdf',
      name: 'Resume.pdf',
      kind: 'resume',
      added: '2026-10-12',
      textFile: null,
    },
  ],
  startedOn: '2026-10-12',
});

const STATUS: ProfileStatus = {
  facts: { claims: 24, unconfirmed: 6, files: 4 },
  starting: [],
  unread: [],
  notesChanged: false,
  criteria: 'app',
  connections: null,
};

function profileApi(status: Partial<ProfileStatus> = {}) {
  const profile: Profile = {
    answers: ANSWERS,
    notes: 'I run the guest team.',
    confidential: [],
    status: { ...STATUS, ...status },
  };
  return {
    profile: vi.fn(async () => profile),
    saveAnswers: vi.fn(async (changes: object) => ({ ...ANSWERS, ...changes })),
    saveNotes: vi.fn(async () => ({ ok: true as const })),
    saveConfidential: vi.fn(async (names: string[]) => names),
    onProfileChanged: vi.fn(() => () => {}),
    useAnswersForCriteria: vi.fn(async () => {}),
    openFile: vi.fn(async () => ({ ok: true as const })),
    readPdf: vi.fn(async () => ({ ok: false as const, message: 'No preview here' })),
    templatePreview: vi.fn(async () => ({ ok: false as const, message: 'No preview here' })),
  };
}

function Harness({
  api,
  phase = 'idle',
  onRun = () => {},
}: {
  api: ReturnType<typeof profileApi>;
  phase?: RunPhase;
  onRun?: (task: unknown) => void;
}) {
  const state = useProfile(api as unknown as FactwrightApi);
  if (!state.profile) return null;
  return (
    <ProfilePage
      state={{ ...state, profile: state.profile }}
      api={api as unknown as FactwrightApi}
      phase={phase}
      ready
      onRun={onRun}
    />
  );
}

describe('ProfilePage', () => {
  it('shows how far Claude has come, and carries on from there', async () => {
    const onRun = vi.fn();
    const { container } = render(<Harness api={profileApi()} onRun={onRun} />);
    const progress = await screen.findByRole('region', { name: 'Getting to know you' });
    expect(within(progress).getByText(/Read what you shared and drafted 24 facts/)).toBeTruthy();
    expect(within(progress).getByText('Confirming with you: 6 facts still to check')).toBeTruthy();
    expect(within(progress).getByText('Building your starting resumes')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Carry on with your Claude' }));
    expect(onRun).toHaveBeenLastCalledWith({ skill: 'get-started' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm your facts' }));
    expect(onRun).toHaveBeenLastCalledWith({ skill: 'add-facts', mode: 'interview' });
  });

  it('waits while Claude is busy', async () => {
    render(<Harness api={profileApi()} phase="working" />);
    expect(
      await screen.findByText('Your Claude is working on it in the panel below.'),
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Confirm your facts' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('lists the starting resumes once they’re built, ready to preview and open', async () => {
    const api = profileApi({
      facts: { claims: 30, unconfirmed: 0, files: 4 },
      starting: [
        {
          path: 'base/startup-ic.json',
          title: 'Senior Product Manager',
          layout: 'modern',
          pdf: 'base/JordanAveryResume_Startups.pdf',
          docx: null,
        },
      ],
    });
    render(<Harness api={api} />);
    const card = await screen.findByRole('region', { name: 'Starting resumes' });
    expect(within(card).getByText('Senior Product Manager')).toBeTruthy();
    expect(within(card).getByText('Modern')).toBeTruthy();
    // Everything's done, so there's nothing left to carry on with.
    expect(screen.queryByRole('region', { name: 'Getting to know you' })).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'Open' }));
    expect(api.openFile).toHaveBeenCalledWith('base/JordanAveryResume_Startups.pdf');
    await userEvent.click(within(card).getByRole('button', { name: 'Preview' }));
    expect(
      await screen.findByRole('dialog', { name: 'JordanAveryResume_Startups.pdf' }),
    ).toBeTruthy();
  });

  it('offers to read what’s new since Claude last read', async () => {
    const onRun = vi.fn();
    render(
      <Harness
        api={profileApi({ unread: ['about-me/files/2026-10-12-resume.pdf'], notesChanged: true })}
        onRun={onRun}
      />,
    );
    expect(
      await screen.findByText(
        /1 file not read yet\. Your notes changed since Claude last read them\./,
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add what’s new' }));
    expect(onRun).toHaveBeenLastCalledWith({ skill: 'add-facts', mode: 'new' });
  });

  it('opens each part to change it, saving as the user goes', async () => {
    const api = profileApi();
    render(<Harness api={api} />);
    const wants = await screen.findByRole('region', { name: 'What you want' });
    expect(
      within(wants).getByText('Product Manager roles (senior), remote, at startups'),
    ).toBeTruthy();
    await userEvent.click(within(wants).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'What you want' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Director' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(api.saveAnswers).toHaveBeenCalledWith(
        expect.objectContaining({ levels: ['senior', 'director'] }),
      ),
    );
  });

  it('says when the criteria were changed by hand, and can use the answers instead', async () => {
    const api = profileApi({ criteria: 'own' });
    render(<Harness api={api} />);
    expect(await screen.findByText(/changed by hand, so it’s kept as it is/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Use these answers instead' }));
    expect(api.useAnswersForCriteria).toHaveBeenCalledOnce();
  });
});
