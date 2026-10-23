import 'virtual:theme.css';
import './ui.css';
import { JOB_LIMITS } from '@factwright/core';
import { canReachSync } from './account.ts';
import { canReachComputer, type Destination, destination, saveOnComputer } from './computer.ts';
import { type Child, h, heading, show } from './dom.ts';
import { ext, type Tab } from './ext.ts';
import { looksLikeApplication, readForm } from './fill.ts';
import { askToSave } from './messages.ts';
import type { PageJob } from './page/read-job.ts';
import { openPanel } from './panel-open.ts';
import { isWebPage, readTab, type Unread } from './read-tab.ts';
import type { JobToSave, SaveResult } from './save.ts';
import { serverName } from './server.ts';
import { isJobAddress, toSave } from './tab-job.ts';

/**
 * The popup under the toolbar button: it reads the job on the page you're on, lets you check its
 * title, company, pay and posting, and saves it to your job hunt, through sync or straight to
 * Factwright on this computer. Nothing is sent until you save.
 */

const app = document.getElementById('app') as HTMLElement;

/** Where the extension saves, once the popup has looked: an account to manage only through sync. */
let savingTo: Destination = null;

/** The tab's application form, to fill, when the page has one. */
let fillable: Tab | null = null;

/**
 * Opens the panel beside the page, which fills the form there. It's opened straight from the
 * click, as each browser asks, and the popup closes once it's open.
 */
function fillIn(tab: Tab): void {
  void openPanel(tab).then(
    () => window.close(),
    () => window.close(),
  );
}

/** Where the posting's text came from, as the popup says it. */
const SOURCES: Record<PageJob['source'], string> = {
  structured: 'from the job’s own data',
  selection: 'from what you selected',
  page: 'from the page',
  main: 'from the page’s main text',
};

/** Why the posting wasn't read, as the popup says it. */
const UNREAD: Record<Exclude<Unread, null>, string> = {
  'linkedin-link-only':
    'You chose to save LinkedIn jobs by their link alone, so the posting isn’t read. Change it in Settings.',
  unreadable: 'This page can’t be read, so only its link and title are saved.',
};

/** The most of the posting the popup shows, to check it's the posting. */
const PREVIEW = 1500;

const openSetup = () => {
  void ext.tabs.create({ url: ext.runtime.getURL('setup.html') });
  window.close();
};

const settingsLink = () =>
  h(
    'p',
    { class: 'small muted' },
    h(
      'a',
      { href: 'setup.html', target: '_blank', rel: 'noopener' },
      savingTo?.to === 'computer' ? 'Settings' : 'Settings and account',
    ),
  );

const button = (text: string, click: () => void, primary = false) =>
  h('button', { type: 'button', class: primary ? 'primary' : '', on: { click } }, text);

function notSetUp(): void {
  show(
    app,
    heading(),
    h(
      'p',
      {},
      'Save jobs to your Factwright job hunt from any page you’re on, with the posting as you see it.',
    ),
    h('div', { class: 'actions' }, button('Set up', openSetup, true)),
  );
}

function message(text: string, ...more: Child[]): void {
  show(app, heading(), h('p', {}, text), ...more, settingsLink());
}

/**
 * What to say when the browser has taken away where the extension saves: its one site, its sync
 * server, or native messaging, which reaches Factwright on this computer.
 */
function noAccess(to: Exclude<Destination, null>): void {
  const where =
    to.to === 'computer' ? 'Factwright on this computer' : serverName(to.account.server);
  message(
    `The browser doesn’t let the extension reach ${where}, so it can’t save jobs.`,
    h('div', { class: 'actions' }, button('Allow it in setup', openSetup, true)),
  );
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

function field(id: string, label: string, value: string, max: number, placeholder = '') {
  return [
    h('label', { for: id }, label),
    h('input', {
      id,
      type: 'text',
      value,
      placeholder,
      maxlength: max,
      autocomplete: 'off',
      spellcheck: 'false',
    }),
  ];
}

const inputValue = (id: string) =>
  (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

/** The notes the popup shows about what it read: anything to check before saving. */
function notes(page: PageJob, unread: Unread): Child[] {
  const hasPosting = Boolean(page.posting.trim());
  return [
    !isJobAddress(page.url) &&
      h(
        'p',
        { class: 'note' },
        'This isn’t one job’s own page, so its link may not lead back to the job. Open the job itself, then save it.',
      ),
    unread && h('p', { class: 'note' }, UNREAD[unread]),
    !unread &&
      !hasPosting &&
      h(
        'p',
        { class: 'note' },
        'It couldn’t find the posting here. To save it too, select the posting’s text, then click the Factwright button again.',
      ),
    hasPosting &&
      page.source === 'main' &&
      h(
        'p',
        { class: 'note' },
        'It doesn’t know this site, so it read the page’s main text. Check it’s the posting, or select the posting’s text and click the Factwright button again.',
      ),
  ];
}

/**
 * Saves a job: to Factwright on this computer from the popup itself, which the browser lets talk to
 * it as soon as it's allowed, or through sync, which the background does.
 */
function saveTo(to: Exclude<Destination, null>, job: JobToSave): Promise<SaveResult> {
  if (to.to === 'computer') return saveOnComputer(job);
  return askToSave((sent) => ext.runtime.sendMessage(sent), job);
}

function form(
  to: Exclude<Destination, null>,
  page: PageJob,
  unread: Unread,
  problem?: string,
  keepPosting = true,
): void {
  const start = toSave(page);
  const hasPosting = Boolean(start.posting.trim());
  const keep = h('input', { id: 'keep', type: 'checkbox', checked: hasPosting && keepPosting });
  const save = async (event: Event) => {
    event.preventDefault();
    const job: JobToSave = {
      ...start,
      company: inputValue('company'),
      role: inputValue('role'),
      pay: inputValue('pay'),
      posting: keep.checked ? start.posting : '',
    };
    const edited = { ...page, title: job.role, company: job.company, pay: job.pay };
    if (!job.company) {
      form(to, edited, unread, 'Add the company’s name.', keep.checked);
      return;
    }
    saving();
    done(to, edited, job, unread, await saveTo(to, job), keep.checked);
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
  const preview =
    hasPosting &&
    h(
      'details',
      { class: 'preview', open: page.source === 'main' },
      h('summary', {}, 'What’s saved as the posting'),
      h(
        'div',
        { class: 'posting', tabindex: 0 },
        start.posting.length > PREVIEW ? `${start.posting.slice(0, PREVIEW)}…` : start.posting,
      ),
    );
  const filling = fillable;
  show(
    app,
    heading(),
    filling &&
      h(
        'div',
        { class: 'card' },
        h('p', { class: 'small' }, 'This page has an application form.'),
        h(
          'div',
          { class: 'actions' },
          button('Fill this application', () => fillIn(filling), true),
        ),
      ),
    filling && h('h2', {}, 'Or save this job'),
    h(
      'form',
      { on: { submit: (event) => void save(event) } },
      ...field('role', 'Job title', start.role, JOB_LIMITS.role),
      ...field('company', 'Company', start.company, JOB_LIMITS.company),
      ...field('pay', 'Pay', start.pay, JOB_LIMITS.pay, 'If the posting says'),
      facts,
      preview,
      hasPosting && h('label', { class: 'check', for: 'keep' }, keep, 'Save the posting with it'),
      ...notes(page, unread),
      problem && h('p', { class: 'bad', role: 'alert' }, problem),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          { class: filling ? '' : 'primary', type: 'submit', id: 'save' },
          'Save to Factwright',
        ),
      ),
    ),
    settingsLink(),
  );
  if (!filling) {
    (document.getElementById(start.company ? 'save' : 'company') as HTMLElement | null)?.focus();
  }
}

function saving(): void {
  show(app, heading(), h('p', { class: 'muted' }, 'Saving to your job hunt…'));
}

/**
 * What the popup says once a job is saved, by what became of its posting, and where it went: for
 * Factwright on this computer, which shows it at once, or takes it when it next opens, or through
 * sync, which Factwright shows once it syncs.
 */
function savedWords(
  result: Extract<SaveResult, { ok: true }>,
  to: Exclude<Destination, null>,
): {
  title: string;
  more?: string;
  retry?: boolean;
} {
  if ('later' in result) {
    return {
      title: 'Saved for Factwright on this computer.',
      more: result.open
        ? 'Factwright adds it to your job hunt, as New, in a moment.'
        : 'Factwright adds it to your job hunt, as New, the next time you open it.',
    };
  }
  const syncs = to.to === 'sync' ? ' Factwright on your computer shows it once it syncs.' : '';
  if (result.posting === 'failed') {
    return {
      title: result.already
        ? 'Already in your job hunt, but its posting didn’t save.'
        : 'Saved to your job hunt, as New, but not its posting.',
      retry: true,
    };
  }
  if (result.already) {
    if (result.posting === 'saved') {
      return { title: 'Already in your job hunt.', more: 'Its posting was added, as you saw it.' };
    }
    if (result.posting === 'kept') {
      return {
        title: 'Already in your job hunt.',
        more: 'With the posting as you first saved it.',
      };
    }
    return { title: 'Already in your job hunt.' };
  }
  return {
    title: 'Saved to your job hunt, as New.',
    more:
      result.posting === 'none'
        ? `With its link.${syncs}`
        : `With the posting as you saw it.${syncs}`,
  };
}

function done(
  to: Exclude<Destination, null>,
  page: PageJob,
  job: JobToSave,
  unread: Unread,
  result: SaveResult,
  keepPosting: boolean,
): void {
  if (result.ok) {
    const says = savedWords(result, to);
    const again = async () => {
      saving();
      done(to, page, job, unread, await saveTo(to, job), keepPosting);
    };
    message(
      says.title,
      h('p', { class: 'small' }, [job.role, job.company].filter(Boolean).join(' at ')),
      says.more && h('p', { class: 'small muted' }, says.more),
      says.retry &&
        h(
          'div',
          { class: 'actions' },
          button('Save its posting', () => void again(), true),
        ),
    );
    return;
  }
  if (result.reason === 'signed-out') {
    message(
      'The extension isn’t signed in anymore.',
      h('div', { class: 'actions' }, button('Set it up again', openSetup, true)),
    );
    return;
  }
  if (result.reason === 'no-access') {
    noAccess(to);
    return;
  }
  form(to, page, unread, result.message, keepPosting);
}

async function start(): Promise<void> {
  const to = await destination();
  savingTo = to;
  if (!to) {
    notSetUp();
    return;
  }
  const reachable =
    to.to === 'computer' ? await canReachComputer() : await canReachSync(to.account.server);
  if (!reachable) {
    noAccess(to);
    return;
  }
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isWebPage(tab.url)) {
    message('Open a job’s page, then click the Factwright button to save it.');
    return;
  }
  const { page, unread } = await readTab(tab);
  // Filling a form reads the page's fields too, which LinkedIn's link-only setting leaves alone.
  if (tab.id !== undefined && unread !== 'linkedin-link-only') {
    fillable = looksLikeApplication(await readForm(tab.id)) ? tab : null;
  }
  form(to, page, unread);
}

void start();
