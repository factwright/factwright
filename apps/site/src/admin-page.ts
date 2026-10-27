import type { AdminIdea, Move, Status } from '../worker/ideas.ts';

/**
 * The ideas board's admin page, roadmap/admin.html, for Steve alone. It lists new suggestions,
 * oldest first, to approve with their words edited, merge into another idea or decline, and the
 * ideas on the page, to move along the roadmap. Each change comes back with every idea, which the
 * page shows afresh. Before an idea's closed, which forgets its suggester's email, it offers to
 * write to them, in Steve's own mail app.
 */

/** The admin API, under the page, which Cloudflare Access covers too (worker/board.ts). */
export const ADMIN_API = '/roadmap/admin/api/ideas';

/** Where the admin page declines every new suggestion it shows at once. */
export const DECLINE_NEW = '/roadmap/admin/api/decline-new';

/** What the page says once Access's sign-in has run out, which a reload starts again. */
export const SIGNED_OUT =
  'Your Cloudflare Access sign-in has run out. Reload the page to sign in again.';

/**
 * What it says when Access let a request through but the Worker turned its sign-in away, as when
 * the sign-in ran out on its way, or wrangler.jsonc names another Access application.
 */
export const NOT_SIGNED_IN =
  'Factwright couldn’t check your Cloudflare Access sign-in. Reload the page, and if this shows again, check ACCESS_TEAM_DOMAIN and ACCESS_AUD in wrangler.jsonc.';

/** How each status reads on the page. */
const STATUS_WORDS: Readonly<Record<Status, string>> = {
  new: 'New',
  considering: 'To vote on',
  planned: 'Planned',
  'in-progress': 'In progress',
  shipped: 'Shipped',
  'not-planned': 'Not planned',
  merged: 'Merged',
};

/** The statuses that close an idea, and forget its suggester's email, in the words for it. */
const CLOSING: Partial<Readonly<Record<Status, string>>> = {
  shipped: 'once it’s shipped',
  'not-planned': 'once it’s not planned',
};

/** How long a button that forgets an email waits for its second click. */
export const CONFIRM_MS = 4000;

/** How long a note that a change was saved stays. */
const SAVED_MS = 3000;

/** What the page needs from the browser, which the tests stand in for. */
export interface AdminBrowser {
  /** Asks the admin API for every idea. */
  load: () => Promise<Response>;
  /** Sends a change to the admin API, and gives its answer. */
  send: (path: string, body: unknown) => Promise<Response>;
}

/**
 * The browser's own requests. Neither follows a redirect: Access answers one whose sign-in has
 * run out by sending it to its sign-in page, on another site, which the page can't read.
 */
export function adminBrowser(): AdminBrowser {
  return {
    load: () => fetch(ADMIN_API, { headers: { Accept: 'application/json' }, redirect: 'manual' }),
    send: (path, body) =>
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'manual',
      }),
  };
}

/**
 * What an answer says about the sign-in: Access's redirect to sign in again, the Worker's refusal,
 * or nothing, in words to show.
 */
function signInProblem(response: Response): string | null {
  if (response.type === 'opaqueredirect') return SIGNED_OUT;
  if (response.status === 401 || response.status === 403) return NOT_SIGNED_IN;
  return null;
}

/** What the admin API answers with: who's signed in, and every idea. */
interface Everything {
  you: string;
  ideas: AdminIdea[];
}

/** An email to the person who suggested an idea, as a draft in Steve's own mail app. */
export function writeTo(idea: Pick<AdminIdea, 'email' | 'title'>): string {
  const subject = `Your idea for Factwright: ${idea.title}`;
  const body = `Hi,\n\nThanks for suggesting “${idea.title}” for Factwright.\n\n`;
  return `mailto:${idea.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** When something happened, as the page says it: Oct 26, or Oct 26, 2025 in another year. */
function dayOf(stamp: string, now = new Date()): string {
  const at = new Date(stamp);
  return at.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}

/**
 * What an answer from the API says went wrong, if it says, or null. The roadmap page has its own,
 * so this page's script shares nothing with the one every page loads.
 */
async function problemIn(response: Response): Promise<string | null> {
  try {
    const { message } = (await response.json()) as { message?: unknown };
    return typeof message === 'string' ? message : null;
  } catch {
    return null;
  }
}

/** Says something briefly, at the foot of the window, as that a change was saved. */
function noteFor(place: HTMLElement | null): (words: string) => void {
  let timer = 0;
  return (words) => {
    if (!place) return;
    place.textContent = words;
    place.classList.add('is-shown');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      place.classList.remove('is-shown');
      place.textContent = '';
    }, SAVED_MS);
  };
}

/** An element, with its class and words. */
function made<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

/** Opens a dialog over the page, or as part of it where the browser can't. */
function openDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

/**
 * Sets the admin page up, and loads the ideas. Resolves once they've loaded, or once it's said
 * why they couldn't.
 */
export async function adminPage(
  root: HTMLElement,
  browser: AdminBrowser = adminBrowser(),
): Promise<void> {
  let ideas: AdminIdea[] = [];
  const find = <T extends HTMLElement = HTMLElement>(selector: string) =>
    root.querySelector<T>(selector);
  const summary = find('[data-admin-summary]');
  const problem = find('[data-admin-problem]');
  const problemText = find('[data-admin-problem-text]');
  const title = find('[data-admin-title]');
  const note = noteFor(find('[data-road-note]'));
  const dialogs = {
    edit: find<HTMLDialogElement>('[data-admin-dialog="edit"]'),
    merge: find<HTMLDialogElement>('[data-admin-dialog="merge"]'),
    decline: find<HTMLDialogElement>('[data-admin-dialog="decline"]'),
  };
  const declineAll = find<HTMLButtonElement>('[data-decline-all]');
  // Once the sign-in has run out, trying again means reloading the page, to sign in.
  let reloadToRetry = false;

  /** Shows every idea afresh, each in its list. */
  function show(everything: Everything): void {
    ideas = everything.ideas;
    const you = document.querySelector('[data-admin-you]');
    if (you) you.textContent = everything.you;
    if (problem) problem.hidden = true;
    for (const section of root.querySelectorAll<HTMLElement>('[data-admin-section]')) {
      section.hidden = false;
    }
    const waiting = ideas.filter((idea) => idea.status === 'new').length;
    const shown = ideas.filter((idea) => !['new', 'not-planned'].includes(idea.status)).length;
    const off = ideas.filter((idea) => idea.status === 'not-planned').length;
    if (summary) {
      summary.textContent = [
        waiting ? `${waiting} new ${waiting === 1 ? 'suggestion' : 'suggestions'}` : 'Nothing new',
        `${shown} on the page`,
        ...(off ? [`${off} not planned`] : []),
      ].join(' · ');
    }
    const notPlanned = find('[data-admin-section="not-planned"]');
    if (notPlanned) notPlanned.hidden = off === 0;
    if (declineAll) declineAll.hidden = waiting < 2;
    for (const list of root.querySelectorAll<HTMLElement>('[data-admin-list]')) {
      const status = list.dataset.adminList as Status;
      const listed = ideas.filter((idea) => idea.status === status);
      // Each idea's heading is a level below its list's.
      const level = list.closest('.admin-group') ? 'h4' : 'h3';
      list.replaceChildren(
        ...(listed.length > 0
          ? listed.map((idea) => card(idea, level))
          : [
              made(
                'li',
                'admin-empty',
                status === 'new' ? 'Nothing new. You’re all caught up.' : 'None yet.',
              ),
            ]),
      );
    }
  }

  /** An idea's card: its words, its votes and dates, and what Steve can do with it. */
  function card(idea: AdminIdea, level: 'h3' | 'h4'): HTMLLIElement {
    const item = made('li', 'admin-idea');
    item.dataset.idea = idea.id;
    const text = made('div', 'admin-idea-text');
    text.append(made(level, 'admin-idea-title', idea.title));
    if (idea.words) text.append(made('p', 'admin-idea-words', idea.words));
    const meta = made('p', 'admin-idea-meta');
    const parts: (string | Node)[] = [
      `${idea.votes} ${idea.votes === 1 ? 'vote' : 'votes'}`,
      idea.status === 'new' ? `Suggested ${dayOf(idea.created)}` : `Changed ${dayOf(idea.updated)}`,
    ];
    if (idea.merged.length > 0) {
      parts.push(`${idea.merged.length} merged in`);
    }
    if (idea.status === 'shipped' && idea.version) {
      parts.push(made('span', 'admin-shipped', `Shipped in ${idea.version}`));
    }
    if (idea.email) parts.push(emailOf(idea));
    parts.forEach((part, index) => {
      if (index > 0) meta.append(made('span', 'admin-dot', '·'));
      meta.append(typeof part === 'string' ? made('span', '', part) : part);
    });
    text.append(meta);
    const actions = made('div', 'admin-idea-actions');
    const action = (words: string, kind: string, onClick: () => void) => {
      const button = made('button', `button button-sm ${kind}`, words);
      button.type = 'button';
      button.addEventListener('click', onClick);
      actions.append(button);
    };
    if (idea.status === 'new') {
      action('Approve…', 'button-primary', () => openEdit(idea));
      action('Merge…', 'button-secondary', () => openMerge(idea));
      action('Decline…', 'button-quiet', () => openRemove('decline', idea));
    } else {
      action('Change…', 'button-secondary', () => openEdit(idea));
      action('Merge…', 'button-secondary', () => openMerge(idea));
    }
    item.append(text, actions);
    return item;
  }

  /** The suggester's email, to write to, and a button to forget it, which asks twice. */
  function emailOf(idea: AdminIdea): HTMLElement {
    const span = made('span', 'admin-email');
    const link = made('a', '', idea.email ?? '');
    link.href = writeTo(idea);
    const forget = made('button', 'admin-forget');
    forget.type = 'button';
    // What it says, and for screen readers, whose email it forgets.
    const say = (words: string) =>
      forget.replaceChildren(words, made('span', 'visually-hidden', ` ${idea.email}`));
    say('Forget');
    let timer = 0;
    forget.addEventListener('click', async () => {
      if (!forget.classList.contains('is-asking')) {
        forget.classList.add('is-asking');
        say('Click again to forget');
        note('Click Forget again to forget their email.');
        timer = window.setTimeout(() => {
          forget.classList.remove('is-asking');
          say('Forget');
        }, CONFIRM_MS);
        return;
      }
      window.clearTimeout(timer);
      forget.disabled = true;
      const done = await change(`${ADMIN_API}/${idea.id}/forget-email`, {});
      if (done === true) note('Their email is forgotten.');
      else {
        forget.disabled = false;
        note(done);
      }
    });
    span.append(link, forget);
    return span;
  }

  /** Sends a change, and shows every idea as it comes back. True once it's saved, or why not. */
  async function change(path: string, body: unknown): Promise<true | string> {
    try {
      const response = await browser.send(path, body);
      const signIn = signInProblem(response);
      if (signIn) return signIn;
      if (!response.ok) return (await problemIn(response)) ?? 'That didn’t save. Try again.';
      show((await response.json()) as Everything);
      return true;
    } catch {
      return 'That didn’t save. Check your connection, then try again.';
    }
  }

  /**
   * Runs a dialog's change: shows why it didn't save in the dialog, or once it saves, closes the
   * dialog, says so, and goes to the idea's card where it is now, or the page's heading once it's
   * gone.
   */
  async function save(
    dialog: HTMLDialogElement,
    path: string,
    body: unknown,
    done: string,
    then: string,
  ) {
    const form = dialog.querySelector('form');
    const said = dialog.querySelector('[data-admin-dialog-problem]');
    form?.setAttribute('aria-busy', 'true');
    if (said) said.textContent = '';
    const result = await change(path, body);
    form?.removeAttribute('aria-busy');
    if (result !== true) {
      if (said) said.textContent = result;
      return;
    }
    closeDialog(dialog);
    (
      root.querySelector<HTMLElement>(`[data-idea="${then}"] .admin-idea-actions .button`) ?? title
    )?.focus();
    note(done);
  }

  /** Says, in a dialog, that the idea's closing will forget its suggester's email, with a draft to them. */
  function closingNote(dialog: HTMLDialogElement, idea: AdminIdea, closing: string | undefined) {
    const place = dialog.querySelector<HTMLElement>('[data-admin-closing]');
    if (!place) return;
    place.hidden = !(idea.email && closing);
    if (place.hidden) return;
    const link = made('a', '', 'Write to them');
    link.href = writeTo(idea);
    place.replaceChildren(
      `They left their email, ${idea.email}, which is forgotten ${closing}. `,
      link,
      ' first?',
    );
  }

  /** Approving a suggestion, or changing an idea, in its dialog. */
  let editing: AdminIdea | null = null;
  function openEdit(idea: AdminIdea) {
    const dialog = dialogs.edit;
    if (!dialog) return;
    editing = idea;
    const form = dialog.querySelector<HTMLFormElement>('form');
    const field = (name: string) =>
      form?.elements.namedItem(name) as
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
        | null;
    const approving = idea.status === 'new';
    const heading = dialog.querySelector('[data-edit-heading]');
    const submit = dialog.querySelector('[data-edit-submit]');
    const remove = dialog.querySelector<HTMLElement>('[data-edit-delete]');
    if (heading) heading.textContent = approving ? 'Approve this idea' : 'Change this idea';
    if (submit) submit.textContent = approving ? 'Approve' : 'Save';
    // A new one is declined from its card instead.
    if (remove) remove.hidden = approving;
    const titleField = field('title');
    const words = field('words');
    const status = field('status');
    const version = field('version');
    if (titleField) titleField.value = idea.title;
    if (words) words.value = idea.words;
    if (status) status.value = approving ? 'considering' : idea.status;
    if (version) version.value = idea.version ?? '';
    const said = dialog.querySelector('[data-admin-dialog-problem]');
    if (said) said.textContent = '';
    showStatus();
    openDialog(dialog);
    titleField?.focus();
  }

  /** The edit dialog's version field, needed only to ship, and its note about the email. */
  function showStatus() {
    const dialog = dialogs.edit;
    if (!dialog || !editing) return;
    const status = dialog.querySelector<HTMLSelectElement>('[name="status"]');
    const version = dialog.querySelector<HTMLElement>('[data-edit-version]');
    const versionField = dialog.querySelector<HTMLInputElement>('[name="version"]');
    const shipping = status?.value === 'shipped';
    if (version) version.hidden = !shipping;
    if (versionField) versionField.required = shipping;
    closingNote(dialog, editing, CLOSING[(status?.value ?? '') as Status]);
  }

  dialogs.edit?.querySelector('[name="status"]')?.addEventListener('change', showStatus);
  dialogs.edit?.querySelector('[data-edit-delete]')?.addEventListener('click', () => {
    if (!dialogs.edit || !editing) return;
    closeDialog(dialogs.edit);
    openRemove('delete', editing);
  });
  dialogs.edit?.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const dialog = dialogs.edit;
    const idea = editing;
    const form = event.currentTarget as HTMLFormElement;
    if (!dialog || !idea) return;
    const value = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';
    const status = value('status') as Move;
    void save(
      dialog,
      `${ADMIN_API}/${idea.id}`,
      {
        title: value('title'),
        words: value('words'),
        status,
        ...(status === 'shipped' && { version: value('version') }),
      },
      idea.status === 'new' ? 'Approved. It’s on the page.' : 'Saved.',
      idea.id,
    );
  });

  /** Merging an idea into another, in its dialog. */
  let merging: AdminIdea | null = null;
  function openMerge(idea: AdminIdea) {
    const dialog = dialogs.merge;
    if (!dialog) return;
    merging = idea;
    const heading = dialog.querySelector('[data-merge-heading]');
    if (heading) heading.textContent = `Merge “${idea.title}”`;
    const into = dialog.querySelector<HTMLSelectElement>('[data-merge-into]');
    const targets = ideas.filter(
      (each) => each.id !== idea.id && each.status !== 'new' && each.status !== 'merged',
    );
    into?.replaceChildren(
      ...targets.map((each) => {
        const option = made(
          'option',
          '',
          `${each.title} · ${STATUS_WORDS[each.status]} · ${each.votes} ${each.votes === 1 ? 'vote' : 'votes'}`,
        );
        option.value = each.id;
        return option;
      }),
    );
    const said = dialog.querySelector('[data-admin-dialog-problem]');
    if (said) {
      said.textContent =
        targets.length > 0 ? '' : 'Approve another idea first, to merge this one into.';
    }
    const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = targets.length === 0;
    closingNote(dialog, idea, 'once it’s merged');
    openDialog(dialog);
    into?.focus();
  }

  dialogs.merge?.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const dialog = dialogs.merge;
    const into = dialog?.querySelector<HTMLSelectElement>('[data-merge-into]')?.value;
    if (!dialog || !merging || !into) return;
    const target = ideas.find((each) => each.id === into);
    void save(
      dialog,
      `${ADMIN_API}/${merging.id}/merge`,
      { into },
      `Merged into “${target?.title ?? 'it'}”.`,
      into,
    );
  });

  /**
   * Deleting, once Steve's sure: declining a new suggestion, deleting an idea on the page, as when
   * whoever suggested it asks, or declining every new suggestion at once, as after a flood.
   */
  let removing:
    | { mode: 'decline' | 'delete'; idea: AdminIdea }
    | { mode: 'all'; ids: string[] }
    | null = null;
  function openRemove(mode: 'decline' | 'delete' | 'all', idea?: AdminIdea) {
    const dialog = dialogs.decline;
    if (!dialog) return;
    const waiting = ideas.filter((each) => each.status === 'new').map((each) => each.id);
    removing = mode === 'all' ? { mode, ids: waiting } : idea ? { mode, idea } : null;
    if (!removing) return;
    const words = {
      decline: {
        heading: `Decline “${idea?.title}”?`,
        text: 'It’s deleted, and never shows on the page. This can’t be undone.',
        button: 'Decline',
      },
      delete: {
        heading: `Delete “${idea?.title}”?`,
        text: 'It leaves the page, and it’s deleted with its votes. This can’t be undone.',
        button: 'Delete',
      },
      all: {
        heading: `Decline all ${waiting.length} new suggestions?`,
        text: 'They’re deleted, and never show on the page. Approve or merge any you’d like to keep first. This can’t be undone.',
        button: `Decline all ${waiting.length}`,
      },
    }[mode];
    const set = (selector: string, text: string) => {
      const element = dialog.querySelector(selector);
      if (element) element.textContent = text;
    };
    set('[data-decline-heading]', words.heading);
    set('[data-decline-text]', words.text);
    set('[data-decline-submit]', words.button);
    set('[data-admin-dialog-problem]', '');
    const closing = dialog.querySelector<HTMLElement>('[data-admin-closing]');
    if (idea && mode !== 'all') {
      closingNote(dialog, idea, mode === 'decline' ? 'once it’s declined' : 'once it’s deleted');
    } else if (closing) closing.hidden = true;
    openDialog(dialog);
    dialog.querySelector<HTMLButtonElement>('[data-admin-cancel]')?.focus();
  }

  dialogs.decline?.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const dialog = dialogs.decline;
    if (!dialog || !removing) return;
    if (removing.mode === 'all') {
      const count = removing.ids.length;
      void save(
        dialog,
        DECLINE_NEW,
        { ids: removing.ids },
        `Declined ${count} ${count === 1 ? 'suggestion' : 'suggestions'}.`,
        '',
      );
      return;
    }
    // Declining takes only a suggestion that's still new, in case another tab approved it.
    void save(
      dialog,
      `${ADMIN_API}/${removing.idea.id}/${removing.mode}`,
      {},
      removing.mode === 'decline' ? 'Declined, and deleted.' : 'Deleted.',
      '',
    );
  });

  declineAll?.addEventListener('click', () => openRemove('all'));

  for (const dialog of Object.values(dialogs)) {
    dialog
      ?.querySelector('[data-admin-cancel]')
      ?.addEventListener('click', () => closeDialog(dialog));
  }

  /** Loads every idea, or says why it couldn't, with a way to try again. */
  async function load(): Promise<void> {
    if (summary) summary.textContent = 'Loading the ideas…';
    try {
      const response = await browser.load();
      const signIn = signInProblem(response);
      reloadToRetry = signIn !== null;
      if (signIn) throw new Error(signIn);
      if (!response.ok) throw new Error('The ideas couldn’t load. Try again in a minute.');
      show((await response.json()) as Everything);
    } catch (error) {
      if (summary) summary.textContent = '';
      if (problemText) {
        problemText.textContent =
          error instanceof Error && error.message && !(error instanceof TypeError)
            ? error.message
            : 'The ideas couldn’t load. Check your connection, then try again.';
      }
      if (problem) problem.hidden = false;
    }
  }

  find('[data-admin-retry]')?.addEventListener('click', () => {
    if (reloadToRetry) window.location.reload();
    else void load();
  });
  await load();
}
