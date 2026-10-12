// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FactBankPage } from './FactBankPage.tsx';
import { factsInMemory } from './sample-facts.ts';
import type { FactBankApi } from './useFactBank.ts';

const TODAY = '2026-10-12';

const ACME = [
  '# Acme Health',
  '',
  '## Overview',
  'Staff engineer, 2021–2026.',
  '',
  '### Scheduling platform',
  '`live` `led-and-built` `high`',
  '> Built a scheduling platform used by 40 clinics.',
  '- **Numbers:** 40 clinics',
  '- **Source:** Alex 2026-10-01',
  '',
  '### Reminder texts',
  '`unconfirmed` `shipped` `solo` `medium`',
  '> Shipped appointment reminder texts.',
  '- **Source:** resume alex.pdf 2026-10-10',
  '',
  '### Waitlist',
  '`unconfirmed` `built` `solo` `high`',
  '> Built a waitlist that fills cancelled visits.',
  '- **Source:** notes 2026-10-10',
  '',
].join('\n');

const BETA = [
  '# Beta Labs',
  '',
  '### Field app',
  '`shipped` `took-over` `high`',
  '> Took over the field app.',
  '',
].join('\n');

let files: Map<string, string>;
let listeners: Set<() => void>;

/** The page's calls over files in memory, each a spy, with a way to change a file as Claude would. */
function factApi(firstName: string | null = 'Alex') {
  const memory = factsInMemory(files, { firstName, today: TODAY });
  const api = {
    factBank: vi.fn(memory.factBank),
    changeFact: vi.fn(memory.changeFact),
    addFact: vi.fn(memory.addFact),
    removeFact: vi.fn(memory.removeFact),
    confirmFact: vi.fn(memory.confirmFact),
    onProfileChanged: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  return api;
}

/** Changes a file the way Claude or another computer would, and tells the page. */
function changeOnDisk(path: string, text: string) {
  files.set(path, text);
  for (const listener of listeners) listener();
}

function open(api = factApi(), onGetStarted = () => {}) {
  return render(
    <FactBankPage api={api as unknown as FactBankApi} today={TODAY} onGetStarted={onGetStarted} />,
  );
}

const fact = (title: string) => screen.getByRole('article', { name: title });

beforeEach(() => {
  localStorage.clear();
  files = new Map([
    ['facts/acme.md', ACME],
    ['facts/beta.md', BETA],
    ['facts/gaps.md', '# Gaps\n\n## Open questions\n- How many clinics?\n'],
  ]);
  listeners = new Set();
});

afterEach(cleanup);

describe('FactBankPage', () => {
  it('lists the files, opens the first with facts, and shows each fact with its tags', async () => {
    const { container } = open();
    expect(await screen.findByRole('heading', { name: 'Acme Health', level: 2 })).toBeTruthy();
    expect(screen.getByText('4 facts in 2 files · 2 to confirm with you')).toBeTruthy();
    const files = screen.getByRole('navigation', { name: 'Your fact files' });
    expect(
      within(files)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Acme Health 3', 'Beta Labs 1', 'Gaps ']);
    const platform = fact('Scheduling platform');
    expect(within(platform).getByRole('list', { name: 'Tags' }).textContent).toBe(
      'LiveLed and builtHigh confidence',
    );
    expect(platform.textContent).toContain('Built a scheduling platform used by 40 clinics.');
    expect(
      within(fact('Reminder texts')).getByRole('button', { name: 'Confirm “Reminder texts”' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Overview', level: 3 })).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('changes a fact’s words and status, then gives the focus back to it', async () => {
    const user = userEvent.setup();
    const api = factApi();
    const { container } = open(api);
    await user.click(await screen.findByRole('button', { name: 'Change “Scheduling platform”' }));
    const form = screen.getByRole('form', { name: 'Change “Scheduling platform”' });
    const wording = within(form).getByRole('textbox', { name: 'What resumes say' });
    expect(document.activeElement).toBe(wording);
    expect((await axe.run(container)).violations).toEqual([]);
    await user.clear(wording);
    await user.type(wording, 'Built scheduling for 41 clinics.');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Status' }), 'shipped');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fact('Scheduling platform').textContent).toContain('41 clinics'));
    expect(api.changeFact).toHaveBeenCalledWith({
      path: 'facts/acme.md',
      index: 2,
      text: expect.stringMatching(/^### Scheduling platform\n/),
      next: [
        '### Scheduling platform',
        '`shipped` `led-and-built` `high`',
        '> Built scheduling for 41 clinics.',
        '- **Numbers:** 40 clinics',
        '- **Source:** Alex 2026-10-01',
      ].join('\n'),
    });
    expect(files.get('facts/acme.md')).toContain(
      '`shipped` `led-and-built` `high`\n> Built scheduling for 41 clinics.\n',
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Change “Scheduling platform”' }),
      ),
    );
    expect(screen.getByText('Saved “Scheduling platform”.')).toBeTruthy();
  });

  it('cancels with Escape, and changes a section with its heading', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Change “Scheduling platform”' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('form')).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Change “Scheduling platform”' }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Change “Overview”' }));
    const form = screen.getByRole('form', { name: 'Change “Overview”' });
    const text = within(form).getByRole('textbox', { name: 'Text' });
    await user.clear(text);
    await user.type(text, 'Staff engineer, 2020–2026.');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(files.get('facts/acme.md')).toContain(
        '## Overview\nStaff engineer, 2020–2026.\n\n###',
      ),
    );
  });

  it('keeps the user’s words when the fact changed while it was open, and saves them on a second try', async () => {
    const user = userEvent.setup();
    const api = factApi();
    open(api);
    await user.click(await screen.findByRole('button', { name: 'Change “Scheduling platform”' }));
    const form = screen.getByRole('form', { name: 'Change “Scheduling platform”' });
    const wording = within(form).getByRole('textbox', { name: 'What resumes say' });
    await user.clear(wording);
    await user.type(wording, 'Mine.');
    // Claude changes the same fact meanwhile.
    changeOnDisk('facts/acme.md', ACME.replace('40 clinics.', '42 clinics.'));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This changed while you had it open')).toBeTruthy();
    expect(within(form).getByRole('textbox', { name: 'What resumes say' })).toHaveProperty(
      'value',
      'Mine.',
    );
    expect(files.get('facts/acme.md')).toContain('42 clinics.');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    expect(files.get('facts/acme.md')).toContain('> Mine.\n');
    expect(api.changeFact).toHaveBeenCalledTimes(2);
  });

  it('confirms the facts still to confirm, one after another', async () => {
    const user = userEvent.setup();
    const { container } = open();
    await user.click(await screen.findByRole('button', { name: 'To confirm · 2' }));
    expect(
      screen.getByRole('button', { name: 'To confirm · 2' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.queryByRole('article', { name: 'Scheduling platform' })).toBeNull();
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Confirm “Reminder texts”' }));
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Reminder texts' })).toBeNull(),
    );
    expect(files.get('facts/acme.md')).toContain(
      '### Reminder texts\n`shipped` `solo` `medium`\n> Shipped appointment reminder texts.\n- **Source:** Alex 2026-10-12\n',
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Confirm “Waitlist”' }),
      ),
    );
    expect(screen.getByText('Confirmed “Reminder texts”.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm “Waitlist”' }));
    // Nothing's left to confirm, so the file shows again.
    await waitFor(() =>
      expect(screen.getByText('4 facts in 2 files · all confirmed with you')).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: /^To confirm/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Acme Health', level: 2 })).toBeTruthy();
  });

  it('asks before deleting a fact, and keeps it if asked', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Delete “Waitlist”' }));
    expect(fact('Waitlist').textContent).toContain('Delete this fact?');
    expect(document.activeElement?.textContent).toBe('Delete');
    await user.click(within(fact('Waitlist')).getByRole('button', { name: 'Keep it' }));
    expect(fact('Waitlist').textContent).not.toContain('Delete this fact?');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Delete “Waitlist”' }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Delete “Waitlist”' }));
    await user.click(within(fact('Waitlist')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Waitlist' })).toBeNull());
    expect(files.get('facts/acme.md')).not.toContain('Waitlist');
    // The focus goes to the fact before it.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Change “Reminder texts”' }),
      ),
    );
  });

  it('adds a fact to the file picked, once it has a title and a status', async () => {
    const user = userEvent.setup();
    const { container } = open();
    await user.click(await screen.findByRole('button', { name: 'Add a fact' }));
    const form = screen.getByRole('form', { name: 'New fact' });
    expect(document.activeElement).toBe(within(form).getByRole('textbox', { name: 'Title' }));
    expect(within(form).getByRole('textbox', { name: 'Details' })).toHaveProperty(
      'value',
      '- **Source:** Alex 2026-10-12',
    );
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByRole('alert').textContent).toBe('Give it a title.');
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'On-call rotation');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByRole('alert').textContent).toMatch(/status/);
    await user.selectOptions(within(form).getByRole('combobox', { name: 'File' }), 'facts/beta.md');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Status' }), 'live');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Ownership' }), 'led-team');
    await user.type(
      within(form).getByRole('textbox', { name: 'What resumes say' }),
      'Led on-call.',
    );
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Beta Labs', level: 2 })).toBeTruthy(),
    );
    expect(files.get('facts/beta.md')).toBe(
      `${BETA}\n### On-call rotation\n\`live\` \`led-team\`\n> Led on-call.\n- **Source:** Alex 2026-10-12\n`,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Change “On-call rotation”' }),
      ),
    );
    // Facts right under a file's title still take the next heading level.
    expect(screen.getByRole('heading', { name: 'Field app', level: 3 })).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('searches every file, and says when nothing has the words', async () => {
    const user = userEvent.setup();
    open();
    const search = await screen.findByRole('searchbox', { name: 'Search your facts' });
    await user.type(search, 'took over');
    expect(screen.getByRole('heading', { name: 'Beta Labs', level: 2 })).toBeTruthy();
    expect(fact('Field app')).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Scheduling platform' })).toBeNull();
    await user.clear(search);
    await user.type(search, 'kubernetes');
    expect(screen.getByText('Nothing in your fact bank has “kubernetes”.')).toBeTruthy();
    // Opening a file from the list leaves the search.
    await user.click(
      within(screen.getByRole('navigation', { name: 'Your fact files' })).getByRole('button', {
        name: /^Beta Labs/,
      }),
    );
    expect(search).toHaveProperty('value', '');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Beta Labs', level: 2 }),
      ),
    );
  });

  it('keeps up as Claude or another computer changes the files', async () => {
    open();
    expect(await screen.findByRole('article', { name: 'Scheduling platform' })).toBeTruthy();
    changeOnDisk(
      'facts/acme.md',
      `${ACME}\n### Lab results inbox\n\`live\` \`solo\` \`high\`\n> Built a lab results inbox.\n`,
    );
    expect(await screen.findByRole('article', { name: 'Lab results inbox' })).toBeTruthy();
  });

  it('keeps what was typed when going to another file and back', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Change “Scheduling platform”' }));
    const wording = screen.getByRole('textbox', { name: 'What resumes say' });
    await user.clear(wording);
    await user.type(wording, 'Half-written');
    const list = screen.getByRole('navigation', { name: 'Your fact files' });
    await user.click(within(list).getByRole('button', { name: /^Beta Labs/ }));
    expect(screen.queryByRole('form')).toBeNull();
    await user.click(within(list).getByRole('button', { name: /^Acme Health/ }));
    expect(screen.getByRole('textbox', { name: 'What resumes say' })).toHaveProperty(
      'value',
      'Half-written',
    );
  });

  it('says when there’s no fact bank yet, and goes to getting started', async () => {
    const user = userEvent.setup();
    files.clear();
    const onGetStarted = vi.fn();
    open(factApi(), onGetStarted);
    expect(await screen.findByText('No fact bank yet')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Get started' }));
    expect(onGetStarted).toHaveBeenCalled();
  });
});
