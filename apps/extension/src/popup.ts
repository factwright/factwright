import 'virtual:theme.css';
import './ui.css';
import { loadAccount } from './account.ts';
import { type Child, h, heading, show } from './dom.ts';
import { ext } from './ext.ts';
import { askToSave } from './messages.ts';
import type { PageJob } from './page/read-job.ts';
import { isWebPage, readTab, type Unread } from './read-tab.ts';
import type { JobToSave, SaveResult } from './save.ts';
import { toSave } from './tab-job.ts';

/**
 * The popup under the toolbar button: it reads the job on the page you're on, lets you check its
 * title, company and pay, and saves it, with its posting, to your job hunt.
 */

const app = document.getElementById('app') as HTMLElement;

/** Where the posting's text came from, as the popup says it. */
const SOURCES: Record<PageJob['source'], string> = {
  structured: 'from the job’s own data',
  selection: 'from what you selected',
  page: 'from the page',
};

/** Why the posting wasn't read, as the popup says it. */
const UNREAD: Record<Exclude<Unread, null>, string> = {
  'linkedin-link-only':
    'You chose to save LinkedIn jobs by their link alone, so the posting isn’t read. Change it in Settings.',
  unreadable: 'This page can’t be read, so only its link and title are saved.',
};

const openSetup = () => {
  void ext.tabs.create({ url: ext.runtime.getURL('setup.html') });
  window.close();
};

const settingsLink = () =>
  h(
    'p',
    { class: 'small muted' },
    h('a', { href: 'setup.html', target: '_blank', rel: 'noopener' }, 'Settings and account'),
  );

function notSetUp(): void {
  show(
    app,
    heading(),
    h(
      'p',
      {},
      'Save jobs to your Factwright job hunt from any page you’re on, with the posting as you see it.',
    ),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'primary', type: 'button', on: { click: openSetup } }, 'Set up'),
    ),
  );
}

function message(text: string, ...more: Child[]): void {
  show(app, heading(), h('p', {}, text), ...more, settingsLink());
}

/** A posting's length and where it came from, such as "812 words, from the job’s own data". */
function postingLine(page: PageJob): string {
  const words = page.posting.split(/\s+/).filter(Boolean).length;
  if (words === 0) return 'None: only the link is saved';
  return `${words.toLocaleString('en-US')} word${words === 1 ? '' : 's'}, ${SOURCES[page.source]}`;
}

/** A link in a few words: its site and the start of its path. */
const shortLink = (url: string) => {
  try {
    const { hostname, pathname } = new URL(url);
    const path = pathname.length > 28 ? `${pathname.slice(0, 27)}…` : pathname;
    return `${hostname.replace(/^www\./, '')}${path === '/' ? '' : path}`;
  } catch {
    return url;
  }
};

function field(id: string, label: string, value: string, placeholder = '') {
  return [
    h('label', { for: id }, label),
    h('input', { id, type: 'text', value, placeholder, autocomplete: 'off', spellcheck: false }),
  ];
}

const inputValue = (id: string) =>
  (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

function form(page: PageJob, unread: Unread, problem?: string): void {
  const start = toSave(page);
  const save = async (event: Event) => {
    event.preventDefault();
    const job: JobToSave = {
      ...start,
      company: inputValue('company'),
      role: inputValue('role'),
      pay: inputValue('pay'),
    };
    if (!job.company) {
      form({ ...page, title: job.role, pay: job.pay }, unread, 'Add the company’s name.');
      return;
    }
    saving();
    done(page, job, unread, await askToSave((sent) => ext.runtime.sendMessage(sent), job));
  };
  const facts = h(
    'dl',
    { class: 'facts' },
    h('dt', {}, 'Link'),
    h('dd', { title: page.url }, shortLink(page.url)),
    page.location && h('dt', {}, 'Where'),
    page.location && h('dd', {}, page.location),
    h('dt', {}, 'Posting'),
    h('dd', {}, postingLine(page)),
  );
  show(
    app,
    heading(),
    h(
      'form',
      { on: { submit: (event) => void save(event) } },
      ...field('role', 'Job title', start.role),
      ...field('company', 'Company', start.company),
      ...field('pay', 'Pay', start.pay, 'If the posting says'),
      facts,
      unread && h('p', { class: 'note' }, UNREAD[unread]),
      problem && h('p', { class: 'bad', role: 'alert' }, problem),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'primary', type: 'submit', id: 'save' }, 'Save to Factwright'),
      ),
    ),
    settingsLink(),
  );
  (document.getElementById('save') as HTMLButtonElement | null)?.focus();
}

function saving(): void {
  show(app, heading(), h('p', { class: 'muted' }, 'Saving to your job hunt…'));
}

function done(page: PageJob, job: JobToSave, unread: Unread, result: SaveResult): void {
  if (result.ok) {
    const name = [job.role, job.company].filter(Boolean).join(' at ');
    message(
      result.already ? 'Already in your job hunt.' : 'Saved to your job hunt, as New.',
      h('p', { class: 'small' }, name),
      !result.already &&
        h(
          'p',
          { class: 'small muted' },
          job.posting
            ? 'With the posting as you saw it. Factwright on your computer shows it once it syncs.'
            : 'With its link. Factwright on your computer shows it once it syncs.',
        ),
    );
    return;
  }
  if (result.reason === 'signed-out') {
    message(
      'Save to Factwright isn’t signed in anymore.',
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          { class: 'primary', type: 'button', on: { click: openSetup } },
          'Set it up again',
        ),
      ),
    );
    return;
  }
  form({ ...page, title: job.role, company: job.company, pay: job.pay }, unread, result.message);
}

async function start(): Promise<void> {
  const account = await loadAccount();
  if (!account?.keys) {
    notSetUp();
    return;
  }
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isWebPage(tab.url)) {
    message('Open a job’s page, then click the Factwright button to save it.');
    return;
  }
  const { page, unread } = await readTab(tab);
  form(page, unread);
}

void start();
