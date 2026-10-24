// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FactBankPage } from './FactBankPage.tsx';
import { factsInMemory } from './sample-facts.ts';
import type { FactBankApi } from './useFactBank.ts';

const TODAY = '2026-10-12';

// Each test draws the whole fact bank page: with every package's tests at once, the first here
// took 3.9 of vitest's usual 5 seconds.
vi.setConfig({ testTimeout: 20_000 });

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
    removeGap: vi.fn(memory.removeGap),
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

function open(
  api = factApi(),
  onGetStarted = () => {},
  show: { part: 'unverified' | 'gaps'; at: number } | null = null,
) {
  return render(
    <FactBankPage
      api={api as unknown as FactBankApi}
      today={TODAY}
      onGetStarted={onGetStarted}
      show={show}
    />,
  );
}

/** The list of facts to verify at the top of the page. */
const unverified = () => within(screen.getByRole('region', { name: 'Unverified' }));

/** What's on the page outside the list of facts to verify, where a fact to verify shows too. */
const outsideList = (elements: HTMLElement[]) => {
  const [found] = elements.filter(
    (element) => !element.closest('[aria-labelledby="facts-unverified-title"]'),
  );
  if (!found) throw new Error('Not on the page outside the list to verify');
  return found;
};

const fact = (title: string) => outsideList(screen.getAllByRole('article', { name: title }));
const button = (name: string) => outsideList(screen.getAllByRole('button', { name }));
const findButton = async (name: string) =>
  outsideList(await screen.findAllByRole('button', { name }));

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
    // The file's first page takes longest to draw: nearly 2 seconds, with every package's tests at
    // once.
    expect(
      await screen.findByRole('heading', { name: 'Acme Health', level: 2 }, { timeout: 5000 }),
    ).toBeTruthy();
    expect(screen.getByText('4 facts in 2 files · 2 to verify')).toBeTruthy();
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
      within(fact('Reminder texts')).getByRole('button', { name: 'Verify “Reminder texts”' }),
    ).toBeTruthy();
    expect(within(fact('Reminder texts')).getByRole('list', { name: 'Tags' }).textContent).toBe(
      'UnverifiedShippedSoloMedium confidence',
    );
    expect(screen.getByRole('heading', { name: 'Overview', level: 3 })).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('lists the facts to verify at the top, each with where it came from', async () => {
    files.set(
      'facts/beta.md',
      `${BETA}\n### GraphQL partner API\n\`unconfirmed\` \`live\` \`solo\` \`medium\`\n> Built the partner API in GraphQL.\n- **Keywords:** GraphQL\n- **Source:** answer 2026-10-11, tailoring a resume for Fernway\n- **Question:** Have you used GraphQL?\n- **Answer:** Yes, in production\n`,
    );
    const { container } = open();
    const list = await screen.findByRole('region', { name: 'Unverified' });
    // The user's answers come first, then what was drafted from their files.
    expect(
      within(list)
        .getAllByRole('article')
        .map(
          (each) =>
            each.getAttribute('aria-labelledby') && within(each).getByRole('heading').textContent,
        ),
    ).toEqual(['GraphQL partner API', 'Reminder texts', 'Waitlist']);
    const answered = within(list).getByRole('article', { name: 'GraphQL partner API' });
    expect(answered.textContent).toContain(
      'Your answer while tailoring a resume for Fernway, Oct 11',
    );
    expect(answered.textContent).toContain('Have you used GraphQL?“Yes, in production”');
    expect(answered.textContent).toContain('Keywords:');
    expect(answered.textContent).not.toContain('Source:');
    expect(within(answered).getByRole('list', { name: 'Tags' }).textContent).toBe(
      'LiveSoloMedium confidence',
    );
    expect(within(list).getByRole('article', { name: 'Reminder texts' }).textContent).toContain(
      'From your resume alex.pdf, Oct 10',
    );
    expect(within(list).getByRole('article', { name: 'Waitlist' }).textContent).toContain(
      'From your notes, Oct 10',
    );
    expect((await axe.run(container)).violations).toEqual([]);
    // Its file opens from it.
    await userEvent.click(
      within(answered).getByRole('button', { name: 'Beta Labs: show the whole file' }),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Beta Labs', level: 2 }),
      ),
    );
  });

  it('shows the first few facts to verify, and the rest when asked', async () => {
    const many = Array.from(
      { length: 6 },
      (_, i) =>
        `### Drafted ${i + 1}\n\`unconfirmed\` \`live\`\n> Did ${i + 1}.\n- **Source:** notes 2026-10-10\n`,
    ).join('\n');
    files.set('facts/beta.md', `${BETA}\n${many}`);
    open();
    const list = await screen.findByRole('region', { name: 'Unverified' });
    expect(within(list).getAllByRole('article')).toHaveLength(4);
    await userEvent.click(within(list).getByRole('button', { name: 'Show all 8' }));
    expect(within(list).getAllByRole('article')).toHaveLength(8);
    // The first one it brought in takes the focus, in place of the button.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(list).getByRole('button', { name: 'Verify “Drafted 3”' }),
      ),
    );
  });

  it('keeps an edit opened in the list open, whatever comes in ahead of it, or a search', async () => {
    const user = userEvent.setup();
    const many = ['A', 'B'].map(
      (letter) =>
        `### Drafted ${letter}\n\`unconfirmed\` \`live\`\n> Did ${letter}.\n- **Source:** notes 2026-10-10\n`,
    );
    files.set('facts/beta.md', `${BETA}\n${many.join('\n')}`);
    open();
    const list = await screen.findByRole('region', { name: 'Unverified' });
    // The fourth in the list.
    await user.click(
      within(list).getByRole('button', { name: 'Edit “Drafted B”, then verify it' }),
    );
    const wording = screen.getByRole('textbox', { name: 'What resumes say' });
    await user.clear(wording);
    await user.type(wording, 'Mine.');
    // Claude saves the user's answer meanwhile, which goes first.
    changeOnDisk(
      'facts/acme.md',
      `${ACME}\n### Kafka pipeline\n\`unconfirmed\` \`live\`\n> Ran Kafka.\n- **Source:** answer 2026-10-12\n`,
    );
    await unverified().findByRole('article', { name: 'Kafka pipeline' });
    expect(screen.getByRole('textbox', { name: 'What resumes say' })).toHaveProperty(
      'value',
      'Mine.',
    );
    // A search leaves it open too.
    await user.type(screen.getByRole('searchbox', { name: 'Search your facts' }), 'field');
    expect(screen.getByRole('textbox', { name: 'What resumes say' })).toHaveProperty(
      'value',
      'Mine.',
    );
    await user.click(screen.getByRole('button', { name: 'Save and verify' }));
    await waitFor(() =>
      expect(files.get('facts/beta.md')).toContain('### Drafted B\n`live`\n> Mine.\n'),
    );
  });

  it('keeps an edit opened in the list open once its fact is verified elsewhere', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('region', { name: 'Unverified' });
    await user.click(unverified().getByRole('button', { name: 'Edit “Waitlist”, then verify it' }));
    const wording = screen.getByRole('textbox', { name: 'What resumes say' });
    await user.clear(wording);
    await user.type(wording, 'Mine.');
    changeOnDisk(
      'facts/acme.md',
      ACME.replace('`unconfirmed` `built` `solo` `high`', '`built` `solo` `high`'),
    );
    await waitFor(() =>
      expect(unverified().queryByRole('article', { name: 'Waitlist' })).toBeNull(),
    );
    expect(screen.getByRole('textbox', { name: 'What resumes say' })).toHaveProperty(
      'value',
      'Mine.',
    );
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
      unique: true,
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

  it('verifies the facts to verify, one after another', async () => {
    const user = userEvent.setup();
    const { container } = open();
    await screen.findByRole('region', { name: 'Unverified' });
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(unverified().getByRole('button', { name: 'Verify “Reminder texts”' }));
    await waitFor(() =>
      expect(unverified().queryByRole('article', { name: 'Reminder texts' })).toBeNull(),
    );
    expect(files.get('facts/acme.md')).toContain(
      '### Reminder texts\n`shipped` `solo` `medium`\n> Shipped appointment reminder texts.\n- **Source:** Alex 2026-10-12\n',
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        unverified().getByRole('button', { name: 'Verify “Waitlist”' }),
      ),
    );
    expect(screen.getByText('Verified “Reminder texts”.')).toBeTruthy();
    // Verified, it's still in its file, as any other fact.
    expect(within(fact('Reminder texts')).queryByRole('button', { name: /^Verify/ })).toBeNull();
    await user.click(unverified().getByRole('button', { name: 'Verify “Waitlist”' }));
    // Nothing's left to verify, so the list goes.
    await waitFor(() => expect(screen.getByText('4 facts in 2 files · all verified')).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Unverified' })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('searchbox', { name: 'Search your facts' }),
      ),
    );
  });

  it('verifies a fact from its file too', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await findButton('Verify “Waitlist”'));
    await waitFor(() =>
      expect(files.get('facts/acme.md')).toContain('### Waitlist\n`built` `solo` `high`\n'),
    );
    await waitFor(() => expect(document.activeElement).toBe(button('Change “Waitlist”')));
  });

  it('verifies a fact to verify once it’s edited and saved', async () => {
    const user = userEvent.setup();
    const api = factApi();
    const { container } = open(api);
    await screen.findByRole('region', { name: 'Unverified' });
    await user.click(unverified().getByRole('button', { name: 'Edit “Waitlist”, then verify it' }));
    const form = screen.getByRole('form', { name: 'Change “Waitlist”' });
    expect(form.closest('[aria-labelledby="facts-unverified-title"]')).not.toBeNull();
    expect((await axe.run(container)).violations).toEqual([]);
    const wording = within(form).getByRole('textbox', { name: 'What resumes say' });
    await user.clear(wording);
    await user.type(wording, 'Built a waitlist that refills cancelled visits.');
    await user.click(within(form).getByRole('button', { name: 'Save and verify' }));
    await waitFor(() =>
      expect(files.get('facts/acme.md')).toContain(
        '### Waitlist\n`built` `solo` `high`\n> Built a waitlist that refills cancelled visits.\n- **Source:** Alex 2026-10-12',
      ),
    );
    expect(screen.getByText('Saved and verified “Waitlist”.')).toBeTruthy();
    // The one before it in the list takes the focus.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        unverified().getByRole('button', { name: 'Verify “Reminder texts”' }),
      ),
    );
  });

  it('deletes a fact to verify from the list, once asked', async () => {
    const user = userEvent.setup();
    open();
    const list = await screen.findByRole('region', { name: 'Unverified' });
    await user.click(within(list).getByRole('button', { name: 'Delete “Reminder texts”' }));
    const asked = within(list).getByRole('article', { name: 'Reminder texts' });
    expect(asked.textContent).toContain('Delete this fact?');
    // The same fact in its file isn't asked about.
    expect(fact('Reminder texts').textContent).not.toContain('Delete this fact?');
    await user.click(within(asked).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(files.get('facts/acme.md')).not.toContain('Reminder texts'));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        unverified().getByRole('button', { name: 'Verify “Waitlist”' }),
      ),
    );
  });

  it('goes to the facts to verify when asked, as after a run filed some', async () => {
    open(factApi(), () => {}, { part: 'unverified', at: 1 });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Unverified' })),
    );
  });

  it('asks before deleting a fact, and keeps it if asked', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await findButton('Delete “Waitlist”'));
    expect(fact('Waitlist').textContent).toContain('Delete this fact?');
    expect(document.activeElement?.textContent).toBe('Delete');
    await user.click(within(fact('Waitlist')).getByRole('button', { name: 'Keep it' }));
    expect(fact('Waitlist').textContent).not.toContain('Delete this fact?');
    await waitFor(() => expect(document.activeElement).toBe(button('Delete “Waitlist”')));
    await user.click(button('Delete “Waitlist”'));
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

  it('never shows what was typed for one block in another’s form', async () => {
    const user = userEvent.setup();
    open();
    // Typed into the overview, then left for a new fact, which lands where the overview's words
    // could otherwise turn up.
    await user.click(await screen.findByRole('button', { name: 'Change “Overview”' }));
    await user.type(screen.getByRole('textbox', { name: 'Text' }), ' More.');
    await user.click(screen.getByRole('button', { name: 'Add a fact' }));
    const form = screen.getByRole('form', { name: 'New fact' });
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'Kiosk');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Status' }), 'live');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Change “Kiosk”' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveProperty('value', 'Kiosk');
    await user.keyboard('{Escape}');
    // Typed into one fact, then on to another: each form has its own words.
    await user.click(screen.getByRole('button', { name: 'Change “Waitlist”' }));
    await user.type(screen.getByRole('textbox', { name: 'What resumes say' }), ' Typed.');
    await user.click(screen.getByRole('button', { name: 'Change “Reminder texts”' }));
    expect(screen.getByRole('textbox', { name: 'What resumes say' })).toHaveProperty(
      'value',
      'Shipped appointment reminder texts.',
    );
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Change “Waitlist”' }));
    expect(screen.getByRole('textbox', { name: 'What resumes say' })).toHaveProperty(
      'value',
      'Built a waitlist that fills cancelled visits.',
    );
  });

  it('keeps what was typed when the fact moved and changed while it was open, and saves it there', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Change “Waitlist”' }));
    const wording = screen.getByRole('textbox', { name: 'What resumes say' });
    await user.clear(wording);
    await user.type(wording, 'Mine.');
    // Claude adds a fact above it and changes it, before the page has read the file again.
    files.set(
      'facts/acme.md',
      ACME.replace(
        '## Overview',
        '### Lab inbox\n`live`\n> Built a lab inbox.\n\n## Overview',
      ).replace('fills cancelled visits.', 'fills cancelled visits, by Claude.'),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This changed while you had it open')).toBeTruthy();
    expect(
      screen.getByText(/It now says: “Built a waitlist that fills cancelled visits, by Claude\.”/),
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'What resumes say' })).toHaveProperty(
      'value',
      'Mine.',
    );
    // Going to another file and back keeps it too.
    const list = screen.getByRole('navigation', { name: 'Your fact files' });
    await user.click(within(list).getByRole('button', { name: /^Beta Labs/ }));
    await user.click(within(list).getByRole('button', { name: /^Acme Health/ }));
    expect(screen.getByRole('textbox', { name: 'What resumes say' })).toHaveProperty(
      'value',
      'Mine.',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    const saved = files.get('facts/acme.md') ?? '';
    expect(saved).toContain('### Waitlist\n`unconfirmed` `built` `solo` `high`\n> Mine.\n');
    expect(saved).toContain('### Lab inbox');
    expect(saved).toContain(
      '### Reminder texts\n`unconfirmed` `shipped` `solo` `medium`\n> Shipped appointment reminder texts.',
    );
  });

  it('never puts a change into the other of two facts that read the same', async () => {
    const user = userEvent.setup();
    const twice = '# Notes\n\n### Follow-up\n`live`\n> tbd\n\n### Follow-up\n`live`\n> tbd\n';
    files.set('facts/acme.md', twice);
    open();
    const [first] = await screen.findAllByRole('button', { name: 'Change “Follow-up”' });
    if (!first) throw new Error('missing button');
    await user.click(first);
    const wording = screen.getByRole('textbox', { name: 'What resumes say' });
    await user.clear(wording);
    await user.type(wording, 'Mine.');
    files.set('facts/acme.md', twice.replace('> tbd', '> Filled in by Claude.'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This changed while you had it open')).toBeTruthy();
    // The second copy is as it was.
    expect(files.get('facts/acme.md')).toBe(twice.replace('> tbd', '> Filled in by Claude.'));
  });

  it('keeps the question about deleting with its fact as the file changes', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await findButton('Delete “Waitlist”'));
    // Claude adds a fact above it while the question is open.
    changeOnDisk(
      'facts/acme.md',
      ACME.replace('## Overview', '### Lab inbox\n`live`\n> Built a lab inbox.\n\n## Overview'),
    );
    expect(await screen.findByRole('article', { name: 'Lab inbox' })).toBeTruthy();
    expect(fact('Waitlist').textContent).toContain('Delete this fact?');
    expect(fact('Reminder texts').textContent).not.toContain('Delete this fact?');
    await user.click(within(fact('Waitlist')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryAllByRole('article', { name: 'Waitlist' })).toEqual([]));
    expect(files.get('facts/acme.md')).toContain('### Reminder texts');
    expect(files.get('facts/acme.md')).not.toContain('Waitlist');
  });

  it('drops the question about deleting a fact that changed, and says so', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await findButton('Delete “Waitlist”'));
    changeOnDisk(
      'facts/acme.md',
      ACME.replace('fills cancelled visits.', 'fills cancelled visits fast.'),
    );
    expect(await screen.findByText('“Waitlist” changed, so it wasn’t deleted.')).toBeTruthy();
    expect(fact('Waitlist').textContent).not.toContain('Delete this fact?');
    expect(files.get('facts/acme.md')).toContain('fills cancelled visits fast.');
  });

  it('lists a fact to verify that Claude files while the page is open', async () => {
    open();
    expect(await screen.findByRole('region', { name: 'Unverified' })).toBeTruthy();
    changeOnDisk(
      'facts/beta.md',
      `${BETA}\n### Kafka pipeline\n\`unconfirmed\` \`live\`\n> Ran Kafka.\n- **Source:** answer 2026-10-12, tailoring a resume for Fernway\n- **Question:** Have you run Kafka?\n- **Answer:** Yes\n`,
    );
    expect(await unverified().findByRole('article', { name: 'Kafka pipeline' })).toBeTruthy();
    expect(screen.getByText('5 facts in 2 files · 3 to verify')).toBeTruthy();
  });

  it('shows what the user said they don’t have, and takes one back', async () => {
    const user = userEvent.setup();
    files.set(
      'facts/gaps.md',
      [
        '# Gaps',
        '',
        "## Doesn't have (don't claim, don't ask again)",
        '| Topic | Their answer | Date |',
        '|---|---|---|',
        '| Rust in production | No | 2026-10-08 |',
        '| Kafka | No (asked “Have you run Kafka?” while tailoring a resume for Fernway) | 2026-10-12 |',
        '',
        '## Open questions',
        '- How many clinics?',
        '',
      ].join('\n'),
    );
    const api = factApi();
    const { container } = open(api, () => {}, { part: 'gaps', at: 1 });
    const heading = await screen.findByRole('heading', {
      name: 'Things you’ve said you don’t have',
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const nav = screen.getByRole('navigation', { name: 'Your fact files' });
    expect(within(nav).getByRole('button', { name: /^Gaps/ }).textContent).toBe('Gaps 2');
    const section = heading.closest('section') as HTMLElement;
    expect(section.textContent).toContain('Rust in productionNo');
    expect(section.textContent).toContain('Oct 8');
    expect(section.textContent).toContain(
      'KafkaNo (asked “Have you run Kafka?” while tailoring a resume for Fernway)',
    );
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(within(section).getByRole('button', { name: 'Remove “Rust in production”' }));
    await waitFor(() => expect(files.get('facts/gaps.md')).not.toContain('Rust in production'));
    expect(api.removeGap).toHaveBeenCalledWith({
      index: 0,
      line: '| Rust in production | No | 2026-10-08 |',
    });
    expect(
      screen.getByText('Removed “Rust in production”. Your Claude can ask about it again.'),
    ).toBeTruthy();
    // The one after it takes the focus.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove “Kafka”' })),
    );
    expect(files.get('facts/gaps.md')).toContain('## Open questions\n- How many clinics?');
  });

  it('says what stopped taking something back, such as Claude changing it meanwhile', async () => {
    const user = userEvent.setup();
    const gaps =
      "# Gaps\n\n## Doesn't have\n| Topic | Their answer | Date |\n|---|---|---|\n| Rust | No | 2026-10-08 |\n";
    files.set('facts/gaps.md', gaps);
    open(factApi(), () => {}, { part: 'gaps', at: 1 });
    const remove = await screen.findByRole('button', { name: 'Remove “Rust”' });
    files.set('facts/gaps.md', gaps.replace('| No |', '| Not really |'));
    await user.click(remove);
    expect((await screen.findByRole('alert')).textContent).toMatch(/changed since you opened it/);
    expect(files.get('facts/gaps.md')).toContain('Not really');
  });

  it('says when nothing’s been said not to have yet', async () => {
    files.set('facts/gaps.md', "# Gaps\n\n## Doesn't have\n\n## Open questions\n- One\n");
    open(factApi(), () => {}, { part: 'gaps', at: 1 });
    expect(
      await screen.findByText(/^Nothing yet\. When you tell your Claude you don’t have/),
    ).toBeTruthy();
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
