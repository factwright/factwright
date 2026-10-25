import 'virtual:theme.css';
import './ui.css';
import { type AskedJob, JOB_LIMITS, JOB_STATUS_LABELS, readStatus } from '@factwright/core';
import { canReachSync } from './account.ts';
import { framedSystem } from './application-sites.ts';
import {
  canReachComputer,
  canSendNow,
  type Destination,
  destination,
  saveOnComputer,
} from './computer.ts';
import { type Child, h, heading, show } from './dom.ts';
import { ext, type Tab } from './ext.ts';
import { findForm, looksLikeApplication } from './fill.ts';
import { askForJob, askToSave } from './messages.ts';
import type { PageJob } from './page/read-job.ts';
import { openPanel } from './panel-open.ts';
import { isWebPage, readTab, type Unread } from './read-tab.ts';
import type { JobToSave, SaveResult } from './save.ts';
import { type PageAsked, type SavedFor, savedOnComputer } from './saved.ts';
import { serverName } from './server.ts';
import { isJobAddress, looksLikeJob, toSave } from './tab-job.ts';

/**
 * The popup under the toolbar button: it reads the job on the page you're on and looks it up in
 * your job hunt. A job you saved shows as it's on file, with Fill for the page's application form.
 * Any other shows what was read, its title, company, pay, place and posting, to save in one click,
 * or to check and change first, in Edit details. On an application form's page, that click saves
 * the job and fills the form. It saves through sync, or straight to Factwright on this computer.
 * Nothing is saved until you click, and the look-up tells Factwright on this computer only the
 * page's address, the company and the job's title.
 */

const app = document.getElementById('app') as HTMLElement;

/** Where the extension saves, once the popup has looked: an account to manage only through sync. */
let savingTo: Destination = null;

/** The tab's application form, to fill, when the page has one. */
let fillable: Tab | null = null;

/**
 * Whether Factwright on this computer answered the look-up, which the form's fill then asks too,
 * as it does wherever the browser lets the extension reach it: Save and fill saves the job there
 * then, as the panel saves one, so the fill finds it at once, before sync brings it.
 */
let fillsOnComputer = false;

/**
 * Whether the page doesn't look like a job's, so the popup fills in no title or company and saves
 * it only if you say to anyway.
 */
let notAJob = false;

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
    { class: 'small muted settings' },
    h(
      'a',
      { href: 'setup.html', target: '_blank', rel: 'noopener' },
      savingTo?.to === 'computer' ? 'Settings' : 'Settings and account',
    ),
  );

const button = (text: string, click: () => void, primary = false) =>
  h('button', { type: 'button', class: primary ? 'primary' : '', on: { click } }, text);

/** A button that reads as a link, for what's beside the main one. */
const linkButton = (text: string, click: () => void) =>
  h('button', { type: 'button', class: 'link', on: { click } }, text);

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

/**
 * The notes the popup shows about what it read: anything to check before saving. An application
 * form's page with no posting saves its link alone, as the posting's line says.
 */
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
      !fillable &&
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

/**
 * The job as the popup saves it: what it read, with the company from its address where the page
 * names none, and the pay from the posting's words where it says none, but not from a page that
 * doesn't look like a job's. An application form's page that shows no posting of its own, whose
 * main text is the form's, saves the job's link alone.
 */
function readJob(page: PageJob): JobToSave {
  const job = toSave(page);
  return {
    ...job,
    pay: notAJob ? page.pay : job.pay,
    posting: fillable && page.source === 'main' ? '' : job.posting,
  };
}

/** The words on the button that saves: it fills the form too, on an application form's page. */
const saveWords = () =>
  fillable ? 'Save and fill' : notAJob ? 'Save it anyway' : 'Save to Factwright';

/**
 * Saves a job where it goes: where the extension saves, or for an application form's page, where
 * the form's fill looks for it first (fillsOnComputer).
 */
const saveHere = (to: Exclude<Destination, null>, job: JobToSave) =>
  fillable && fillsOnComputer ? saveOnComputer(job) : saveTo(to, job);

/**
 * Saves a job, then, on an application form's page, fills the form: the panel opens beside the
 * page, as Chrome lets it straight after the click that saved the job, and fills the form with the
 * job on file. Firefox opens its sidebar only straight from a click, so there, as once the click is
 * a while ago, the popup says the job's saved, with Fill to click.
 */
async function saveIt(
  to: Exclude<Destination, null>,
  page: PageJob,
  unread: Unread,
  job: JobToSave,
  keepPosting: boolean,
): Promise<void> {
  const filling = fillable;
  saving();
  const result = await saveHere(to, job);
  if (result.ok && filling) {
    try {
      await openPanel(filling);
      window.close();
      return;
    } catch {
      // The browser opens it only from a click of its own.
    }
  }
  done(to, page, job, unread, result, keepPosting);
}

/**
 * What the popup read, to save in one click: the job's title, company, pay, place and posting,
 * with anything to check, and Edit details, which shows each to change. A job with no title or
 * company, as a page that doesn't look like a job's, shows them at once, to fill in.
 */
function summary(
  to: Exclude<Destination, null>,
  page: PageJob,
  unread: Unread,
  problem?: string,
): void {
  const job = readJob(page);
  if (notAJob || !job.company || !job.role) {
    form(to, page, unread, problem);
    return;
  }
  const keep = Boolean(job.posting.trim());
  // What it saves, as the boxes show it once you've tried to.
  const shown = { ...page, title: job.role, company: job.company, pay: job.pay };
  const save = button(saveWords(), () => void saveIt(to, shown, unread, job, keep), true);
  show(
    app,
    heading(),
    h(
      'div',
      { class: 'card job' },
      h('p', { class: 'job-title' }, job.role),
      h('p', {}, job.company),
      job.pay && h('p', { class: 'small' }, job.pay),
      page.location && h('p', { class: 'small' }, page.location),
      h(
        'p',
        { class: 'small muted' },
        keep
          ? `Posting: ${postingLine({ ...page, posting: job.posting })}`
          : 'No posting: only its link is saved',
      ),
    ),
    ...notes({ ...page, posting: job.posting }, unread),
    problem && h('p', { class: 'bad', role: 'alert' }, problem),
    h(
      'div',
      { class: 'actions' },
      save,
      linkButton('Edit details', () => form(to, page, unread, undefined, keep)),
    ),
    settingsLink(),
  );
  save.focus();
}

/** A day, as "Oct 20". */
const day = (on: string) =>
  new Date(`${on}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** A job's status, in the jobs page's words, with the day you applied. */
function statusWords(job: AskedJob): string {
  const status = readStatus(job.status) ?? 'new';
  const words = JOB_STATUS_LABELS[status];
  return status === 'applied' && job.appliedOn ? `${words} ${day(job.appliedOn)}` : words;
}

/**
 * A job you saved, as it's on file: its title, company and status, with Fill for the page's
 * application form, and nothing to save. One found by its role, at the company, says so: one you
 * saved by its company's board, a Hacker News post or its site gets this page's link and posting
 * when you save this one, and one with another posting of its own can be saved as a job of its own.
 */
function saved(
  to: Exclude<Destination, null>,
  page: PageJob,
  unread: Unread,
  found: SavedFor,
): void {
  const { job, how } = found;
  const filling = fillable;
  const read = readJob(page);
  const shown = { ...page, title: read.role, company: read.company, pay: read.pay };
  const main =
    how === 'joins'
      ? button(saveWords(), () => void saveIt(to, shown, unread, read, true), true)
      : filling && button('Fill this application', () => fillIn(filling), true);
  const another =
    how === 'role' && linkButton('It’s another job: save it', () => summary(to, page, unread));
  show(
    app,
    heading(),
    h('p', { class: 'small muted' }, 'In your job hunt'),
    h(
      'div',
      { class: 'card job' },
      h('p', { class: 'job-title' }, job.role || page.title),
      h('p', {}, [job.company, statusWords(job)].filter(Boolean).join(' · ')),
    ),
    how === 'joins' &&
      h(
        'p',
        { class: 'note' },
        'You saved it from another page. Save this one to add its link and posting to it.',
      ),
    how === 'role' &&
      h('p', { class: 'small muted' }, 'You saved it from another posting with this title.'),
    (main || another) && h('div', { class: 'actions' }, main, another),
    settingsLink(),
  );
  if (main) main.focus();
}

function form(
  to: Exclude<Destination, null>,
  page: PageJob,
  unread: Unread,
  problem?: string,
  keepPosting = true,
): void {
  const read = readJob(page);
  // The company its address names, and the pay the posting's words say, are only a first guess:
  // never on a page that doesn't look like a job's, nor once you've tried to save, when the form
  // shows what you typed.
  const start =
    notAJob || problem ? { ...read, company: page.company.trim(), pay: page.pay } : read;
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
    await saveIt(to, edited, unread, job, keep.checked);
  };
  const facts = h(
    'dl',
    { class: 'facts' },
    h('dt', {}, 'Link'),
    h('dd', { title: page.url }, shortLink(page.url)),
    page.location && h('dt', {}, 'Where'),
    page.location && h('dd', {}, page.location),
    h('dt', {}, 'Posting'),
    h('dd', {}, postingLine({ ...page, posting: start.posting })),
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
  show(
    app,
    heading(),
    notAJob &&
      h(
        'p',
        { class: 'note' },
        'This doesn’t look like a job posting, so it didn’t fill in a title or company. If it is one, add them, then save it anyway.',
      ),
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
        h('button', { class: notAJob ? '' : 'primary', type: 'submit', id: 'save' }, saveWords()),
      ),
    ),
    settingsLink(),
  );
  // On a page that doesn't look like a job's, the title comes first, as you fill both in.
  const first =
    notAJob && !start.role ? 'role' : !start.company ? 'company' : !start.role ? 'role' : 'save';
  (document.getElementById(first) as HTMLElement | null)?.focus();
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
  if (result.joined) {
    return {
      title: 'Already in your job hunt, from another page.',
      more:
        result.posting === 'saved'
          ? 'This page’s link and posting were added to it.'
          : 'This page’s link was added to it.',
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
      done(to, page, job, unread, await saveHere(to, job), keepPosting);
    };
    const filling = fillable;
    message(
      says.title,
      h('p', { class: 'small' }, [job.role, job.company].filter(Boolean).join(' at ')),
      says.more && h('p', { class: 'small muted' }, says.more),
      (says.retry || filling) &&
        h(
          'div',
          { class: 'actions' },
          filling && button('Fill this application', () => fillIn(filling), true),
          says.retry && button('Save its posting', () => void again(), !filling),
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

/** How long the popup waits to hear whether the job's saved, before it offers to save it. */
const LOOK_FOR_MS = 4000;

/**
 * Looks the page's job up in your job hunt: in Factwright on this computer, where the extension
 * saves, or where the browser lets the extension reach it and it answers, as a form's fill asks it
 * first, or else through sync. None for a job not on file, or one it can't tell in time.
 */
async function lookUp(to: Exclude<Destination, null>, page: PageJob): Promise<SavedFor | null> {
  const job = readJob(page);
  const asked: PageAsked = { url: job.url, company: job.company, role: job.role };
  const looking = (async () => {
    if (to.to === 'computer' || (canSendNow() && (await canReachComputer()))) {
      const answered = await savedOnComputer(asked);
      fillsOnComputer = answered !== null;
      if (answered || to.to === 'computer') return answered?.found ?? null;
    }
    return askForJob((message) => ext.runtime.sendMessage(message), asked);
  })().catch(() => null);
  const waited = new Promise<null>((done) => setTimeout(() => done(null), LOOK_FOR_MS));
  return Promise.race([looking, waited]);
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
    // The form may be in a frame, as a company's careers page shows an applicant system's form,
    // which the panel fills, or offers to reach, as one on a job site you haven't turned on.
    const found = await findForm(tab.id);
    const framed = found && looksLikeApplication(found.form) ? null : await framedSystem(tab.id);
    fillable = (found && looksLikeApplication(found.form)) || framed ? tab : null;
  }
  // A page with an application form is a job's, whatever else it shows.
  notAJob = !fillable && !looksLikeJob(page, unread);
  const read = notAJob ? { ...page, title: '', company: '', pay: '' } : page;
  const found = notAJob ? null : await lookUp(to, read);
  if (found) saved(to, read, unread, found);
  else summary(to, read, unread);
}

void start();
