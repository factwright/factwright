// @vitest-environment jsdom
import { NO_HISTORY, NO_PRIVATE, type WorkHistory } from '@factwright/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type AboutYou,
  type AnswerChanges,
  applyChanges,
  type Contact,
  readAnswers,
} from '../../shared/about.ts';
import type { FactwrightApi } from '../../shared/api.ts';
import type {
  AddTemplateResult,
  Profile,
  ProfileStatus,
  TemplateInfo,
} from '../../shared/profile.ts';
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
  looks: [{ layout: 'minimal', for: 'startup' }],
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
  beyondChanged: false,
  criteria: 'app',
  connections: null,
};

const TEMPLATES: TemplateInfo[] = [
  { id: 'classic', name: 'Classic', look: 'Traditional and all serif.', own: false, stamp: '' },
  { id: 'minimal', name: 'Minimal', look: 'Quiet and airy.', own: false, stamp: '' },
  {
    id: 'navy-sidebar',
    name: 'Navy Sidebar',
    look: 'A navy column down the left.',
    own: true,
    stamp: '1',
  },
];

/** The same user, after adding design jobs beside product ones. */
const TWO_KINDS = readAnswers({
  ...ANSWERS,
  firstKind: { id: 'product', name: 'Product' },
  otherKinds: [
    {
      id: 'design',
      name: 'Design',
      roles: ['Product Designer'],
      levels: ['lead'],
      minPay: '$140k',
    },
  ],
});

function profileApi(
  status: Partial<ProfileStatus> = {},
  answers: AboutYou = ANSWERS,
  fromResume: Contact | null = null,
  history: WorkHistory = NO_HISTORY,
) {
  const profile: Profile = {
    answers,
    notes: 'I run the guest team.',
    confidential: [],
    history,
    status: { ...STATUS, ...status },
    templates: TEMPLATES,
  };
  return {
    profile: vi.fn(async () => profile),
    saveAnswers: vi.fn(async (changes: AnswerChanges) => applyChanges(answers, changes)),
    saveNotes: vi.fn(async () => ({ ok: true as const })),
    changeConfidential: vi.fn(async ({ add }: { add: string[] }) => add),
    onProfileChanged: vi.fn(() => () => {}),
    useAnswersForCriteria: vi.fn(async () => {}),
    openFile: vi.fn(async () => ({ ok: true as const })),
    readPdf: vi.fn(async () => ({ ok: false as const, message: 'No preview here' })),
    templatePreview: vi.fn(async () => ({ ok: false as const, message: 'No preview here' })),
    addTemplate: vi.fn(
      async (): Promise<AddTemplateResult> => ({
        ok: true,
        kind: 'copy',
        source: '2026-10-12-1.pdf',
      }),
    ),
    removeTemplate: vi.fn(async () => ({ ok: true as const })),
    contactFromResume: vi.fn(async () => fromResume),
    saveHistory: vi.fn(async (saved: WorkHistory) => saved),
  };
}

function Harness({
  api,
  busy = false,
  ready = true,
  onRun = () => {},
  onOpenFacts = () => {},
}: {
  api: ReturnType<typeof profileApi>;
  /** Whether Claude has a task going, or in line, on the user's facts and Profile. */
  busy?: boolean;
  ready?: boolean;
  onRun?: (task: unknown) => void;
  onOpenFacts?: () => void;
}) {
  const state = useProfile(api as unknown as FactwrightApi);
  if (!state.profile) return null;
  return (
    <ProfilePage
      state={{ ...state, profile: state.profile }}
      api={api as unknown as FactwrightApi}
      busy={busy}
      ready={ready}
      onRun={onRun}
      onOpenFacts={onOpenFacts}
    />
  );
}

/** Answers save half a second after the last change, which a busy computer can stretch. */
const SAVED = { timeout: 4000 };

describe('ProfilePage', () => {
  it('opens the fact bank, to read and change each fact', async () => {
    const user = userEvent.setup();
    const onOpenFacts = vi.fn();
    render(<Harness api={profileApi()} onOpenFacts={onOpenFacts} />);
    // The file's first page takes longest to draw: over a second, with every package's tests at
    // once.
    await user.click(
      await screen.findByRole('button', { name: 'See and change them' }, { timeout: 5000 }),
    );
    expect(onOpenFacts).toHaveBeenCalled();
  });

  it('shows how far Claude has come, and carries on from there', async () => {
    const onRun = vi.fn();
    const { container } = render(<Harness api={profileApi()} onRun={onRun} />);
    const progress = await screen.findByRole('region', { name: 'Getting to know you' });
    expect(within(progress).getByText(/Read what you shared and drafted 24 facts/)).toBeTruthy();
    expect(within(progress).getByText('Checking with you: 6 facts to verify')).toBeTruthy();
    expect(within(progress).getByText('Building your starting resumes')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Carry on with your Claude' }));
    expect(onRun).toHaveBeenLastCalledWith({ skill: 'get-started' });
    await userEvent.click(screen.getByRole('button', { name: 'Verify your facts' }));
    expect(onRun).toHaveBeenLastCalledWith({ skill: 'add-facts', mode: 'interview' });
  });

  it('waits while Claude has another task on your profile', async () => {
    render(<Harness api={profileApi()} busy />);
    expect(
      await screen.findByText('Your Claude is working on it in the panel below.'),
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Verify your facts' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('lists the starting resumes once they’re built, ready to preview, X-ray and open', async () => {
    const api = profileApi({
      facts: { claims: 30, unconfirmed: 0, files: 4 },
      starting: [
        {
          path: 'base/startup-ic.json',
          kind: null,
          title: 'Senior Product Manager',
          layout: 'navy-sidebar',
          pdf: 'base/JordanAveryResume_Startups.pdf',
          docx: null,
        },
      ],
    });
    render(<Harness api={api} />);
    const card = await screen.findByRole('region', { name: 'Starting resumes' });
    expect(within(card).getByText('Senior Product Manager')).toBeTruthy();
    expect(within(card).getByText('Navy Sidebar')).toBeTruthy();
    // Everything's done, so there's nothing left to carry on with.
    expect(screen.queryByRole('region', { name: 'Getting to know you' })).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'Open' }));
    expect(api.openFile).toHaveBeenCalledWith('base/JordanAveryResume_Startups.pdf');
    await userEvent.click(within(card).getByRole('button', { name: 'Preview' }));
    const preview = await screen.findByRole('dialog', { name: 'JordanAveryResume_Startups.pdf' });
    await userEvent.click(within(preview).getByRole('button', { name: 'Done' }));
    await userEvent.click(
      within(card).getByRole('button', { name: 'ATS X-ray of Senior Product Manager' }),
    );
    // The X-ray's code loads the first time it opens.
    const xray = await screen.findByRole('dialog', { name: 'ATS X-ray' }, { timeout: 5000 });
    expect((await within(xray).findByRole('alert')).textContent).toBe('No preview here');
    expect(api.readPdf).toHaveBeenLastCalledWith('base/JordanAveryResume_Startups.pdf');
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

  it('shows Beyond work with featured projects first, and adds a project from its card', async () => {
    const onRun = vi.fn();
    const answers = readAnswers({
      ...ANSWERS,
      projects: [
        { id: 'club', name: 'Code Club', kind: 'volunteering', what: 'Free coding classes.' },
        {
          id: 'trailhead',
          name: 'Trailhead',
          kind: 'product',
          status: 'live',
          when: '2023 to now',
          showing: 'feature',
        },
        { id: 'woodworks', name: 'Rivera Woodworks', kind: 'business', showing: 'private' },
      ],
      interests: ['Trail running', 'Chess'],
      projectPrefs: { heading: 'Selected Work' },
    });
    const api = profileApi({ beyondChanged: true }, answers);
    const { container } = render(<Harness api={api} onRun={onRun} />);
    const card = await screen.findByRole('region', { name: 'Beyond work' });
    const rows = within(card)
      .getAllByRole('listitem')
      .map((row) => row.textContent);
    expect(rows).toEqual([
      'TrailheadApp or product · Live or ongoing · 2023 to nowFeatured',
      'Code ClubVolunteeringFree coding classes.When it fits',
      'Rivera WoodworksSmall businessPrivate',
    ]);
    expect(
      within(card).getByText(
        'On resumes: in a section called “Selected Work”, a line each, with links and numbers. Projects page: a list.',
      ),
    ).toBeTruthy();
    expect(within(card).getByText('Trail running, Chess')).toBeTruthy();
    expect(within(card).getByText('Changed since your Claude last read it.')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    // The projects changed since Claude read them: it adds them to the fact bank.
    await userEvent.click(within(card).getByRole('button', { name: 'Add to your fact bank' }));
    expect(onRun).toHaveBeenLastCalledWith({ skill: 'add-facts', mode: 'new' });

    // Adding a project opens one, ready for its name.
    await userEvent.click(within(card).getByRole('button', { name: 'Add a project' }));
    const dialog = await screen.findByRole('dialog', { name: 'Beyond work' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(document.activeElement).toBe(name));
    await userEvent.type(name, 'Denver Devs');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'As experience' }));
    // A heading is only for a section of their own.
    expect(within(dialog).queryByRole('textbox', { name: 'The section’s heading' })).toBeNull();
    // The browser's modal leaves only the dialog to reach, as jsdom doesn't, so it's what's checked.
    expect((await axe.run(dialog)).violations).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    // What the saves come to: on a busy computer, the project can save before its name is typed.
    await waitFor(() =>
      expect(
        api.saveAnswers.mock.calls.reduce(
          (saved, [changes]) => applyChanges(saved, changes),
          answers,
        ),
      ).toMatchObject({
        projects: [
          { name: 'Code Club' },
          { name: 'Trailhead' },
          { name: 'Rivera Woodworks' },
          { name: 'Denver Devs' },
        ],
        projectPrefs: { resumes: 'experience', heading: 'Selected Work' },
      }),
    );
  });

  it('fills in what Profile leaves blank from the newest resume, with one click', async () => {
    const resume: Contact = {
      name: 'Jordan Avery',
      email: 'jordan.avery@example.com',
      phone: '(555) 555-0123',
      location: 'Austin, TX',
      linkedin: 'linkedin.com/in/jordanavery',
      website: '',
    };
    const api = profileApi({}, ANSWERS, resume);
    render(<Harness api={api} />);
    const about = await screen.findByRole('region', { name: 'About you' });
    await userEvent.click(
      await within(about).findByRole('button', { name: 'Fill in from your resume' }),
    );
    // Only what's blank: the email Profile has stays as it is.
    await waitFor(
      () =>
        expect(api.saveAnswers).toHaveBeenCalledWith({
          you: {
            name: 'Jordan Avery',
            email: 'jordan@example.com',
            phone: '(555) 555-0123',
            location: 'Austin, TX',
            linkedin: 'linkedin.com/in/jordanavery',
            website: '',
          },
        }),
      SAVED,
    );
  });

  it('says what the resume would fill in, where you change your details', async () => {
    const blank = readAnswers({ ...ANSWERS, you: { name: '', email: '' } });
    const resume: Contact = {
      name: 'Jordan Avery',
      email: 'jordan.avery@example.com',
      phone: '',
      location: '',
      linkedin: '',
      website: '',
    };
    render(<Harness api={profileApi({}, blank, resume)} />);
    const about = await screen.findByRole('region', { name: 'About you' });
    await userEvent.click(within(about).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'About you' });
    expect(within(dialog).getByText('Your newest resume has your name and email.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Fill in from your resume' })).toBeTruthy();
  });

  it('offers nothing to fill in when there’s no resume yet', async () => {
    render(<Harness api={profileApi()} />);
    const about = await screen.findByRole('region', { name: 'About you' });
    expect(within(about).queryByRole('button', { name: 'Fill in from your resume' })).toBeNull();
  });

  it('has Claude fill in the work history, before there is one', async () => {
    const onRun = vi.fn();
    render(<Harness api={profileApi()} onRun={onRun} />);
    const card = await screen.findByRole('region', { name: 'Work history and education' });
    expect(within(card).getByText(/Your Claude fills them in from your fact bank/)).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Fill in with Claude' }));
    expect(onRun).toHaveBeenLastCalledWith({ skill: 'work-history' });
  });

  it('shows each position held at a company, and changes them', async () => {
    const history: WorkHistory = {
      jobs: [
        {
          company: 'Harbor & Pine',
          location: 'Oakland, CA',
          positions: [
            {
              title: 'Director of Guest Experience',
              start: '2023-02',
              end: 'present',
              summary: '',
            },
            { title: 'Store Lead', start: '2018', end: '2023-02', summary: '' },
          ],
        },
      ],
      schools: [
        {
          school: 'San Francisco State University',
          degree: 'B.A.',
          field: 'Hospitality and Tourism',
          start: '2012',
          end: '2016',
        },
      ],
    };
    const onRun = vi.fn();
    const api = profileApi({}, ANSWERS, null, history);
    render(<Harness api={api} onRun={onRun} />);
    const card = await screen.findByRole('region', { name: 'Work history and education' });
    expect(
      within(card).getByText(
        'Harbor & Pine: Director of Guest Experience (Feb 2023 – now), Store Lead (2018 – Feb 2023)',
      ),
    ).toBeTruthy();
    expect(
      within(card).getByText('San Francisco State University: B.A., Hospitality and Tourism'),
    ).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Update with Claude' }));
    expect(onRun).toHaveBeenLastCalledWith({ skill: 'work-history' });
    await userEvent.click(within(card).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Work history and education' });
    const [, lead] = within(dialog).getAllByRole('textbox', { name: 'Title' });
    await userEvent.type(lead as HTMLElement, ', Union Square');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(api.saveHistory.mock.lastCall?.[0].jobs[0]?.positions[1]?.title).toBe(
      'Store Lead, Union Square',
    );
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

  it('keeps why you’re leaving for applications, and shows it on their card', async () => {
    const api = {
      ...profileApi(),
      privateAnswers: vi.fn(async () => NO_PRIVATE),
      savePrivateAnswers: vi.fn(async () => NO_PRIVATE),
    };
    render(<Harness api={api} />);
    const card = await screen.findByRole('region', { name: 'For applications' });
    expect(within(card).getByText('Nothing yet.')).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'For applications' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Why you’re leaving' }),
      'I want to work at a bigger scale.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(
      () =>
        expect(api.saveAnswers).toHaveBeenCalledWith({
          applications: expect.objectContaining({ leaving: 'I want to work at a bigger scale.' }),
        }),
      SAVED,
    );
    expect(
      within(card).getByText('Why you’re leaving: I want to work at a bigger scale.'),
    ).toBeTruthy();
    expect(within(card).queryByText('Nothing yet.')).toBeNull();
  });

  it('adds another kind of job, with its own titles and pay, and names the first', async () => {
    const api = profileApi();
    render(<Harness api={api} />);
    const wants = await screen.findByRole('region', { name: 'What you want' });
    await userEvent.click(within(wants).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'What you want' });
    // With one kind of job, only the way to add another shows.
    expect(within(dialog).queryByRole('group', { name: 'Kinds of job' })).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'Pay and terms' })).toBeTruthy();
    const adding = within(dialog).getByRole('button', { name: 'Add another kind of job' });
    await userEvent.click(adding);
    // Cancel puts focus back where it was.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Add another kind of job' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add another kind of job' }));
    const name = within(dialog).getByLabelText('What to call the new kind');
    expect(document.activeElement).toBe(name);
    const first = within(dialog).getByLabelText('What to call the jobs above') as HTMLInputElement;
    expect(first.value).toBe('Product Manager');
    await userEvent.clear(first);
    await userEvent.type(name, 'Design{Enter}');
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'Name the jobs above too, such as Developer.',
    );
    await userEvent.clear(name);
    await userEvent.type(first, 'Product');
    await userEvent.type(name, 'product{Enter}');
    expect(within(dialog).getByRole('alert').textContent).toBe('You already have Product.');
    // The browser's modal leaves only the dialog to reach, as jsdom doesn't, so it's what's checked.
    expect((await axe.run(dialog)).violations).toEqual([]);
    await userEvent.clear(name);
    await userEvent.type(name, 'Design{Enter}');

    // The new kind is picked, with its titles the next thing to fill in.
    const kinds = within(dialog).getByRole('group', { name: 'Kinds of job' });
    expect((within(kinds).getByRole('radio', { name: 'Design' }) as HTMLInputElement).checked).toBe(
      true,
    );
    const titles = within(dialog).getByLabelText('Job titles you want');
    expect(document.activeElement).toBe(titles);
    await userEvent.type(titles, 'Product Designer{Enter}');
    await userEvent.type(within(dialog).getByLabelText('Pay you’re hoping for'), '$150k');
    // Pay is each kind's own now, so the shared section is only the terms.
    expect(within(dialog).getByRole('heading', { name: 'Terms' })).toBeTruthy();
    await userEvent.click(within(kinds).getByRole('radio', { name: 'Product' }));
    expect(within(dialog).getByText('Product Manager')).toBeTruthy();
    expect((await axe.run(dialog)).violations).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(within(wants).getByText('Product Designer roles')).toBeTruthy());
    const saved = api.saveAnswers.mock.calls.reduce(
      (answers, [changes]) => applyChanges(answers, changes),
      ANSWERS,
    );
    expect(saved).toMatchObject({
      firstKind: { id: 'product', name: 'Product' },
      otherKinds: [
        { id: 'design', name: 'Design', roles: ['Product Designer'], targetPay: '$150k' },
      ],
    });
  });

  it('shows each kind of job’s work and starting resumes, and builds a kind’s missing ones', async () => {
    const onRun = vi.fn();
    const api = profileApi(
      {
        facts: { claims: 30, unconfirmed: 0, files: 4 },
        starting: [
          {
            path: 'base/startup-ic.json',
            kind: null,
            title: 'Senior Product Manager',
            layout: 'minimal',
            pdf: 'base/JordanAveryResume_Startups.pdf',
            docx: null,
          },
        ],
      },
      TWO_KINDS,
    );
    render(<Harness api={api} onRun={onRun} />);
    expect(await screen.findByText('Jordan Avery · Product · Design')).toBeTruthy();
    const wants = screen.getByRole('region', { name: 'What you want' });
    expect(within(wants).getByText('Product Manager roles (senior)')).toBeTruthy();
    expect(within(wants).getByText('Product Designer roles (lead or principal)')).toBeTruthy();
    expect(within(wants).getByText('Remote, at startups')).toBeTruthy();
    const card = screen.getByRole('region', { name: 'Starting resumes' });
    expect(within(card).getByRole('heading', { name: 'Product' })).toBeTruthy();
    expect(within(card).getByText('Senior Product Manager')).toBeTruthy();
    expect(within(card).getByText('None yet. Build them to make a set for it.')).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Build them' }));
    expect(onRun).toHaveBeenLastCalledWith({ skill: 'get-started', mode: 'resumes' });
  });

  it('removes a kind of job after asking, back to one', async () => {
    const api = profileApi({}, TWO_KINDS);
    render(<Harness api={api} />);
    const wants = await screen.findByRole('region', { name: 'What you want' });
    await userEvent.click(within(wants).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'What you want' });
    // The first kind stays: only the others can be removed.
    expect(within(dialog).queryByRole('button', { name: 'Remove Product' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Design' }));
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Design');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Design' }));
    const confirm = within(dialog).getByRole('group', { name: 'Remove Design?' });
    expect(within(confirm).getByText(/Its jobs move to Product/)).toBeTruthy();
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Keep it' }));
    // The browser's modal leaves only the dialog to reach, as jsdom doesn't, so it's what's checked.
    expect((await axe.run(dialog)).violations).toEqual([]);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(within(dialog).queryByRole('group', { name: 'Kinds of job' })).toBeNull();
    expect(within(dialog).queryByLabelText('Name')).toBeNull();
    // Focus goes on from the button that went, to adding a kind again.
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Add another kind of job' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(api.saveAnswers).toHaveBeenLastCalledWith({ removedKinds: ['design'] }),
    );
  });

  it('renames a kind of job once the user moves on, never to a name on its way to one that’s taken', async () => {
    const api = profileApi({}, TWO_KINDS);
    render(<Harness api={api} />);
    const wants = await screen.findByRole('region', { name: 'What you want' });
    await userEvent.click(within(wants).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'What you want' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Design' }));
    const name = within(dialog).getByLabelText('Name');
    await userEvent.clear(name);
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'Give it a name, such as Project manager.',
    );
    await userEvent.type(name, 'Product');
    expect(within(dialog).getByRole('alert').textContent).toBe('You already have Product.');
    await userEvent.tab();
    // Nothing on the way there was saved, and the kind keeps its name until one will do.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(api.saveAnswers).not.toHaveBeenCalled();
    await userEvent.clear(name);
    await userEvent.type(name, 'UX design{Enter}');
    await waitFor(
      () =>
        expect(api.saveAnswers).toHaveBeenLastCalledWith({
          kindChanges: [{ id: 'design', name: 'UX design' }],
        }),
      SAVED,
    );
    const kinds = within(dialog).getByRole('group', { name: 'Kinds of job' });
    expect(within(kinds).getByRole('radio', { name: 'UX design' })).toBeTruthy();
  });

  it('says when the criteria were changed by hand, and can use the answers instead', async () => {
    const api = profileApi({ criteria: 'own' });
    render(<Harness api={api} />);
    expect(await screen.findByText(/changed by hand, so it’s kept as it is/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Use these answers instead' }));
    expect(api.useAnswersForCriteria).toHaveBeenCalledOnce();
  });

  it('has Claude make a template from a resume the user likes, in its own run', async () => {
    const api = profileApi();
    const onRun = vi.fn();
    render(<Harness api={api} onRun={onRun} />);
    const card = await screen.findByRole('region', { name: 'Resume templates' });
    expect(within(card).getByText('Minimal for startups')).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resume templates' });
    const picker = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      picker,
      new File(['%PDF-1.7'], 'Liked.pdf', { type: 'application/pdf' }),
    );
    await waitFor(() =>
      expect(onRun).toHaveBeenLastCalledWith({
        skill: 'make-template',
        source: '2026-10-12-1.pdf',
      }),
    );
    expect(api.addTemplate).toHaveBeenCalledWith({
      name: 'Liked.pdf',
      bytes: expect.any(Uint8Array),
    });
    // The dialog steps aside for Claude's panel.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Resume templates' })).toBeNull(),
    );
  });

  it('adds a template file someone shared, and removes one of the user’s own after asking', async () => {
    const api = profileApi();
    api.addTemplate.mockResolvedValueOnce({
      ok: true,
      kind: 'template',
      id: 'two-tone',
      name: 'Two Tone',
      already: false,
    });
    const onRun = vi.fn();
    const { container } = render(<Harness api={api} onRun={onRun} />);
    const card = await screen.findByRole('region', { name: 'Resume templates' });
    await userEvent.click(within(card).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resume templates' });
    expect(within(dialog).getByText('Yours')).toBeTruthy();
    const picker = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(picker, new File(['{}'], 'two-tone.json', { type: 'application/json' }));
    expect(await within(dialog).findByText('Added Two Tone. Pick it to use it.')).toBeTruthy();
    expect(onRun).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Navy Sidebar' }));
    const confirm = within(dialog).getByRole('group', { name: 'Remove Navy Sidebar?' });
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(api.removeTemplate).toHaveBeenCalledWith('navy-sidebar');
    expect(within(dialog).queryByRole('button', { name: 'Remove Classic' })).toBeNull();
  });

  it('keeps a resume to copy until Claude can start on it', async () => {
    const api = profileApi();
    render(<Harness api={api} ready={false} />);
    const card = await screen.findByRole('region', { name: 'Resume templates' });
    await userEvent.click(within(card).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resume templates' });
    const picker = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      picker,
      new File(['%PDF-1.7'], 'Liked.pdf', { type: 'application/pdf' }),
    );
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Your Claude can’t start right now.',
    );
    expect(api.addTemplate).not.toHaveBeenCalled();
  });
});
