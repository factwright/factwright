import { accountKeys, newAccountKey, sameBytes, sealFile } from '@factwright/sync';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { JobView } from './JobView.tsx';
import { fakeServer, job, vaultOf } from './testing.ts';

const TODAY = '2026-10-10';
const RESUME_PATH = 'applications/2026-10-07-acme-staff/resume.pdf';
const RESUME = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

const ACME = job({
  id: 'acme--staff',
  company: 'Acme Robotics',
  role: 'Staff Engineer, Developer Tools',
  location: 'Remote, US',
  status: 'screen',
  statusOn: '2026-10-09',
  appliedOn: '2026-10-08',
  nextAction: 'Send references',
  nextOn: '2026-10-12',
  earlierNotes: 'Recruiter: Sam Lee',
  notes: [{ id: 'n1', on: '2026-10-09', text: 'Screen went well', at: '2026-10-09T17:00Z' }],
  links: [{ url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' }],
  calls: [
    {
      id: 'c1',
      kind: 'screen',
      onDate: '2026-10-14',
      atTime: '10:30',
      state: 'scheduled',
      outcome: null,
      notes: 'With Sam, on Zoom',
    },
  ],
  statusLog: [
    { id: 's1', status: 'applied', at: '2026-10-08' },
    { id: 's2', status: 'screen', at: '2026-10-09' },
  ],
  files: [
    {
      path: RESUME_PATH,
      name: 'resume.pdf',
      format: 'pdf',
      size: 52_400,
      modified: '2026-10-07T15:00:00.000Z',
    },
  ],
  docKinds: ['posting'],
});

/** The job, its synced resume locked with the account's keys, and its posting. */
async function setUp() {
  const keys = await accountKeys(newAccountKey());
  const locked = await sealFile(keys, RESUME);
  const vault = vaultOf([ACME], {
    files: new Map([
      [RESUME_PATH, { path: RESUME_PATH, id: locked.id, size: RESUME.length, modified: TODAY }],
    ]),
    docs: new Map([
      [ACME.id, { posting: '# Staff Engineer\n\nBuild the tools our engineers use.' }],
    ]),
  });
  return { keys, locked, vault };
}

/** A tab as the page opens it, to show a PDF in once it's ready. */
function newTab() {
  const tab = { opener: window as unknown, location: { href: '' }, close: vi.fn() };
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  return { tab, open };
}

const section = (name: string) =>
  screen.getByRole('heading', { name }).parentElement as HTMLElement;

describe('a job on the phone', () => {
  it('shows everything on file for it', async () => {
    const { keys, vault } = await setUp();
    const { container } = render(<JobView job={ACME} vault={vault} keys={keys} today={TODAY} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Staff Engineer, Developer Tools',
    );
    expect(screen.getByText('Acme Robotics')).toBeTruthy();
    expect(screen.getByText('Remote, US')).toBeTruthy();
    const notes = within(section('Your notes'));
    expect(notes.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Oct 9Screen went well',
      'Earlier notesRecruiter: Sam Lee',
    ]);
    expect(within(section('Calls and interviews')).getByText('With Sam, on Zoom')).toBeTruthy();
    expect(within(section('History')).getAllByRole('listitem')).toHaveLength(2);
    const posting = within(section('Links')).getByRole('link', { name: 'Posting' });
    expect(posting.getAttribute('href')).toBe('https://jobs.ashbyhq.com/acme/7f3a');
    expect(posting.getAttribute('rel')).toBe('noopener noreferrer');
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('says which kind of job it is, for a user who wants more than one', async () => {
    const { keys, vault } = await setUp();
    const kinds = [
      { id: 'developer', name: 'Developer' },
      { id: 'project-manager', name: 'Project manager' },
    ];
    render(
      <JobView
        job={{ ...ACME, kind: 'project-manager' }}
        vault={{ ...vault, kinds }}
        keys={keys}
        today={TODAY}
      />,
    );
    expect(
      within(section('Where it stands')).getByText('Kind of job').nextSibling?.textContent,
    ).toBe('Project manager');
    cleanup();
    // One nothing has put under a kind is under the first, until a fit check says.
    render(<JobView job={ACME} vault={{ ...vault, kinds }} keys={keys} today={TODAY} />);
    expect(
      within(section('Where it stands')).getByText('Kind of job').nextSibling?.textContent,
    ).toBe('Developer, until a fit check');
    cleanup();
    render(<JobView job={ACME} vault={vault} keys={keys} today={TODAY} />);
    expect(screen.queryByText('Kind of job')).toBeNull();
  });

  it('shows what the user sent on the application, and their questions with Claude’s answers', async () => {
    const { keys } = await setUp();
    const asked = {
      ...ACME,
      questions: ['Why Acme?', 'Anything else?'],
      sent: [
        {
          question: 'Why Acme?',
          nth: 0,
          text: 'Deploys, mostly.',
          on: '2026-10-08',
          at: '2026-10-08T18:00:00.000Z',
        },
      ],
      asks: [
        {
          id: '2026-10-09-what-should-i-expect',
          question: 'What should I expect?',
          on: '2026-10-09',
        },
      ],
      docKinds: ['answers' as const],
    };
    const vault = vaultOf([asked], {
      docs: new Map([[asked.id, { answers: '## Anything else?\n\nNope, the resume covers it.' }]]),
      asked: new Map([
        [
          asked.id,
          {
            '2026-10-09-what-should-i-expect':
              '# What should I expect?\n\nAsked 2026-10-09. Answered 2026-10-09.\n\nA short screen with Sam.',
          },
        ],
      ]),
    });
    const { container } = render(<JobView job={asked} vault={vault} keys={keys} today={TODAY} />);
    const answers = section('Application answers');
    expect(within(answers).getByText('Deploys, mostly.')).toBeTruthy();
    expect(within(answers).getByText('What you sent isn’t recorded.')).toBeTruthy();
    expect(within(answers).getByText('Nope, the resume covers it.')).toBeTruthy();
    const questions = section('Your questions');
    expect(within(questions).getByText('A short screen with Sam.')).toBeTruthy();
    expect(within(questions).queryByText(/Answered 2026/)).toBeNull();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('shows its cover letter, copies its text, and opens its files', async () => {
    const { keys, locked, vault } = await setUp();
    const LETTER_PATH = 'applications/2026-10-07-acme-staff/AlexRiveraCoverLetter_Acme.pdf';
    const written = {
      ...ACME,
      letters: [
        {
          path: LETTER_PATH,
          name: 'AlexRiveraCoverLetter_Acme.pdf',
          format: 'pdf' as const,
          size: 9,
          modified: TODAY,
        },
      ],
      docKinds: ['posting' as const, 'letter' as const],
    };
    const letter = JSON.stringify({
      name: 'Alex Rivera',
      recipient: ['Sam Lee', 'Engineering Manager'],
      greeting: 'Dear Sam Lee,',
      paragraphs: ['I cut deploy time by **~40%**.', 'Talk soon?'],
      closing: 'Best regards,',
    });
    const withLetter = {
      ...vault,
      files: new Map([
        ...vault.files,
        [LETTER_PATH, { path: LETTER_PATH, id: locked.id, size: 9, modified: TODAY }],
      ]),
      docs: new Map([[ACME.id, { ...vault.docs.get(ACME.id), letter }]]),
    };
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = render(
      <JobView job={written} vault={withLetter} keys={keys} today={TODAY} />,
    );
    const shown = within(section('Cover letter'));
    expect(shown.getByText('To Sam Lee, Engineering Manager')).toBeTruthy();
    expect(shown.getByText('~40%').tagName).toBe('STRONG');
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(shown.getByRole('button', { name: 'Copy text' }));
    expect(writeText).toHaveBeenCalledWith(
      'Dear Sam Lee,\n\nI cut deploy time by ~40%.\n\nTalk soon?\n\nBest regards,\nAlex Rivera',
    );
    expect(shown.getByRole('button', { name: 'Copied' })).toBeTruthy();
    // The letter's file is with the resume too, as the computer lists them.
    expect(
      within(section('Resumes and documents')).getByText('AlexRiveraCoverLetter_Acme.pdf'),
    ).toBeTruthy();
    fakeServer({ [`GET /api/sync/files/${locked.id}`]: () => new Response(locked.data) });
    const { tab } = newTab();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:letter');
    await userEvent.click(
      shown.getByRole('button', { name: 'Open AlexRiveraCoverLetter_Acme.pdf' }),
    );
    await waitFor(() => expect(tab.location.href).toBe('blob:letter'));
  });

  it('says when the browser won’t copy the letter', async () => {
    const { keys, vault } = await setUp();
    const letter = JSON.stringify({ greeting: 'Dear Sam,', paragraphs: ['Hello.'] });
    const written = { ...ACME, docKinds: ['letter' as const] };
    const withLetter = { ...vault, docs: new Map([[ACME.id, { letter }]]) };
    const writeText = vi.fn(async () => {
      throw new Error('Not allowed');
    });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<JobView job={written} vault={withLetter} keys={keys} today={TODAY} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy text' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This browser wouldn’t copy it. Select the letter’s text and copy that instead.',
    );
  });

  it('reads a document right on the page', async () => {
    const { keys, vault } = await setUp();
    render(<JobView job={ACME} vault={vault} keys={keys} today={TODAY} />);
    await userEvent.click(screen.getByRole('button', { name: 'Read' }));
    const dialog = screen.getByRole('dialog', { name: 'Posting' });
    expect(within(dialog).getByText('Build the tools our engineers use.')).toBeTruthy();
  });

  it('opens a resume in a new tab, opened during the tap', async () => {
    const { keys, locked, vault } = await setUp();
    fakeServer({ [`GET /api/sync/files/${locked.id}`]: () => new Response(locked.data) });
    const { tab, open } = newTab();
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:resume';
    });
    render(<JobView job={ACME} vault={vault} keys={keys} today={TODAY} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    await waitFor(() => expect(tab.location.href).toBe('blob:resume'));
    expect(blobs[0]?.type).toBe('application/pdf');
    expect(sameBytes(new Uint8Array(await (blobs[0] as Blob).arrayBuffer()), RESUME)).toBe(true);
  });

  it('says when a resume won’t open, and closes the tab it opened', async () => {
    const { keys, vault } = await setUp();
    fakeServer({});
    const { tab } = newTab();
    render(<JobView job={ACME} vault={vault} keys={keys} today={TODAY} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That file couldn’t be opened. Try again once your computer has synced.',
    );
    expect(tab.close).toHaveBeenCalledOnce();
  });
});
