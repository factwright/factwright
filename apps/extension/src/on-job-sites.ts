import {
  type FieldReply,
  isEqualOpportunity,
  isRemembered,
  type RememberedKind,
} from '@factwright/core';
import { isAllowedPage } from './application-sites.ts';
import { askComputer, canReachComputer, canSendNow } from './computer.ts';
import { ext, type Sender, type Tab } from './ext.ts';
import {
  answerSource,
  type FillPlan,
  filledSummary,
  fillInPasses,
  newAnswers,
  planFill,
  readForm,
} from './fill.ts';
import { MENU_ROWS } from './frame-size.ts';
import {
  type FieldMenu,
  type FilledHere,
  type FromFrame,
  type FromScript,
  isFromFrame,
  isFromScript,
  type MenuAnswer,
  type SaveOffer,
  type ToPanel,
  type ToScript,
  type Written,
} from './job-site-messages.ts';
import type { FieldAnswer, FieldFilled, PageField, PageForm } from './page/form.ts';
import { openPanel } from './panel-open.ts';
import { readTab } from './read-tab.ts';

/**
 * The background's side of the job sites you allowed: what each field's menu offers, from
 * Factwright's answers for the form, which it asks Factwright on this computer for the first time
 * you're in one of its fields; the new answers you gave, which it offers to keep; and the Fill
 * button. The answers stay here, and in the extension's own frame, which shows them: the script in
 * the page gets only the one you pick, to put in its field. Each message is checked, and answered
 * only for a site you allowed.
 */

/** One of a menu's answers: what it shows, and what goes in the field if you pick it. */
export interface Offered {
  shown: MenuAnswer;
  answer: Omit<FieldAnswer, 'ref' | 'key'>;
}

/** An option's words, as compared: lowercase, with only its letters and digits. */
const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The option of a field's that picking an answer would choose, as the page's form function picks
 * one: the first pick an option says exactly, then one an option starts with, as a word.
 */
export function optionFor(options: readonly string[], picks: readonly string[], exact = false) {
  const each = options.map((option) => ({ option, said: plain(option) }));
  const wanted = picks.map(plain).filter(Boolean);
  for (const pick of wanted) {
    const same = each.find(({ said }) => said === pick);
    if (same) return same.option;
  }
  if (exact) return undefined;
  for (const pick of wanted) {
    const starts = each.find(({ said }) => said.startsWith(`${pick} `));
    if (starts) return starts.option;
  }
  return undefined;
}

/** Whether a field takes its answer as one of its own options. */
const choosing = (field: PageField) => field.control === 'choice' || field.control === 'choices';

/**
 * The answers a field's menu offers: Factwright's answer for it, and any others on file it gave
 * with it, as the panel would fill them. None for a field that's left for you, a file, a box to
 * tick, or a password. An equal-opportunity answer is offered only as one of the question's own
 * options to pick, never as words to type, and only as you set it in Profile, which leaves it for
 * you unless you chose one.
 */
export function menuAnswers(field: PageField, reply: FieldReply | undefined): Offered[] {
  if (!reply || reply.source === 'you' || reply.file) return [];
  if (field.control === 'check' || field.control === 'file' || field.type === 'password') return [];
  const sensitive = isEqualOpportunity(reply.kind);
  if (sensitive && !choosing(field)) return [];
  const asked: FieldReply[] = [
    reply,
    ...(reply.others ?? []).map((other) => ({ kind: reply.kind, ...other })),
  ];
  const offered = asked.flatMap((each): Offered[] => {
    const from = answerSource(each);
    if (each.pick?.length) {
      // The form's own words for the option, where the form shows its options.
      const option =
        field.options.length > 0 ? optionFor(field.options, each.pick, each.exact) : each.pick[0];
      if (!option) return [];
      return [
        {
          shown: { text: option, from },
          answer: { pick: each.pick, ...(each.exact && { exact: true }) },
        },
      ];
    }
    // An equal-opportunity answer is never typed, and a choice takes only its own options.
    if (sensitive || choosing(field) || !each.text?.trim()) return [];
    return [{ shown: { text: each.text, from }, answer: { text: each.text } }];
  });
  // The same words twice are one answer.
  const seen = new Set<string>();
  return offered
    .filter((each) => {
      const said = plain(each.shown.text);
      if (seen.has(said)) return false;
      seen.add(said);
      return true;
    })
    .slice(0, MENU_ROWS);
}

/**
 * Whether what you give a field is one Profile can keep, so leaving it may offer to save it: a
 * kind Profile keeps, never a file or a password, and an equal-opportunity answer only as you
 * picked it among the question's options.
 */
export function keepsAnswer(field: PageField, reply: FieldReply | undefined): boolean {
  if (!reply || !isRemembered(reply.kind)) return false;
  if (field.control === 'file' || field.control === 'check' || field.type === 'password') {
    return false;
  }
  return isEqualOpportunity(reply.kind) ? choosing(field) : true;
}

/** A new answer you gave a field, which the menu offers to keep, once. */
interface Saving extends SaveOffer {
  at: number;
  key: string;
  kind: RememberedKind;
}

/**
 * The new answer you left a field with, to offer to keep: one Factwright didn't have, as the panel
 * offers at Mark as applied, for a field whose answer Profile keeps. Null for anything else.
 */
export function newAnswerFor(
  form: PageForm,
  at: number,
  reply: FieldReply | undefined,
  value: string,
): Saving | null {
  const field = form.fields[at];
  if (!field || !reply || !keepsAnswer(field, reply)) return null;
  const [found] = newAnswers(
    { ...form, fields: [field] },
    [reply],
    [{ ref: field.ref, key: field.key, value }],
  );
  if (!found) return null;
  return {
    at,
    key: field.key,
    kind: found.kind,
    question: field.question || 'This field',
    text: found.text,
    private: found.private,
  };
}

/** A menu on the page, by the token its frame names, for one field. */
interface Menu {
  token: string;
  at: number;
  answers: Offered[];
  save: Saving | null;
}

/** A page on a site you allowed whose form the background answered, in one tab's top frame. */
interface OnPage {
  /** The page's address, but for what's after its #. */
  url: string;
  form: PageForm;
  plan: FillPlan;
  menu: Menu | null;
  /** The new answer you last gave, to offer in the next menu. */
  saving: Saving | null;
  /** The fields whose new answers it's offered to keep, so it offers each once. */
  offered: Set<string>;
}

const pages = new Map<number, OnPage>();

/** The tabs the script said hello from, to tell it to stop once its site isn't allowed. */
const scripts = new Map<number, string>();

const pageOf = (url: string) => url.split('#')[0] ?? url;

/** A field by its place and key, or the one field with its key, as a form's fields can move. */
function fieldAt(form: PageForm, ref: number, key: string): number {
  if (form.fields[ref]?.key === key) return ref;
  const same = form.fields.flatMap((field, at) => (field.key === key ? [at] : []));
  return same.length === 1 ? (same[0] ?? -1) : -1;
}

/** The menu for each field, as the script asks before it shows one. */
const menusOf = (page: OnPage): FieldMenu[] =>
  page.form.fields.map((field, at) => ({
    ref: field.ref,
    key: field.key,
    answers: menuAnswers(field, page.plan.replies[at]).length,
    keeps: keepsAnswer(field, page.plan.replies[at]),
  }));

/** Sends the script in a tab's top frame a message, and its answer, or null. */
const tellScript = (tabId: number, message: ToScript) =>
  ext.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => null);

/** The script's own tab and page, when the message is the script's, from a tab's top frame. */
function scriptSender(sender: Sender): { tabId: number; url: string } | null {
  if (sender.id !== ext.runtime.id || sender.tab?.id === undefined || sender.frameId !== 0) {
    return null;
  }
  const url = sender.url ?? '';
  return /^https?:\/\//i.test(url) ? { tabId: sender.tab.id, url } : null;
}

/**
 * The frame's tab, and the page it's on, when the message is the extension's own frame's. Chrome
 * names the frame by an address of the session's own as a page loads it, but by the extension's
 * own as it runs, which `getURL('frame.html')` doesn't give, as it gives the session's.
 */
function frameSender(sender: Sender): { tab: Tab & { id: number }; url: string } | null {
  const tab = sender.tab;
  if (sender.id !== ext.runtime.id || tab?.id === undefined || !tab.url) return null;
  if (!(sender.url ?? '').startsWith(`${ext.runtime.getURL('')}frame.html#`)) return null;
  return { tab: { ...tab, id: tab.id }, url: tab.url };
}

/** Asks Factwright on this computer for the form's answers, keeping those it has, by field. */
async function answer(
  tabId: number,
  form: PageForm,
  job: { company: string; role: string },
): Promise<OnPage | string> {
  const url = pageOf(form.url);
  const before = pages.get(tabId);
  if (before && before.url === url) {
    const replies = new Map(
      before.form.fields.map((field, at) => [field.key, before.plan.replies[at]]),
    );
    if (form.fields.every((field) => replies.has(field.key))) {
      const plan = {
        ...before.plan,
        replies: form.fields.map((field) => replies.get(field.key) as FieldReply),
      };
      const page = { ...before, form, plan, menu: null };
      pages.set(tabId, page);
      return page;
    }
  }
  if (!(await canReachComputer()) || !canSendNow()) {
    return 'Click Factwright’s button, then Fill this application, to have Factwright answer here.';
  }
  const planned = await planFill(form, job);
  if (!planned.ok || planned.did !== 'fill') {
    return planned.ok ? 'Factwright didn’t answer.' : planned.message;
  }
  const page: OnPage = {
    url,
    form,
    plan: planned,
    menu: null,
    saving: null,
    offered: before?.url === url ? before.offered : new Set(),
  };
  pages.set(tabId, page);
  return page;
}

/** What the script asks, answered: or undefined when it isn't on a site you allowed. */
export async function answerScript(
  message: FromScript,
  from: { tabId: number; url: string },
): Promise<unknown> {
  const { tabId, url } = from;
  if (!(await isAllowedPage(url))) {
    pages.delete(tabId);
    scripts.delete(tabId);
    return message.do === 'hello' ? { allowed: false } : { stop: true };
  }
  if (message.do === 'hello') {
    scripts.set(tabId, url);
    return { allowed: true };
  }
  if (message.do === 'form') {
    // Only the form on the page the script is on.
    if (pageOf(message.form.url) !== pageOf(url)) return { menus: null };
    const page = await answer(tabId, message.form, message.job);
    return typeof page === 'string' ? { menus: null, problem: page } : { menus: menusOf(page) };
  }
  const page = pages.get(tabId);
  // The background started again since, and forgot the form: the script asks for it again.
  if (!page || page.url !== pageOf(url)) return { again: true };
  if (message.do === 'closed') {
    if (page.menu?.token === message.token) page.menu = null;
    return {};
  }
  const at = fieldAt(page.form, message.ref, message.key);
  const field = page.form.fields[at];
  if (!field) return { answers: 0, save: false, offer: false };
  const reply = page.plan.replies[at];
  if (message.do === 'left') {
    const saving = page.offered.has(field.key)
      ? null
      : newAnswerFor(page.form, at, reply, message.value);
    if (saving) page.saving = saving;
    return { offer: Boolean(saving) };
  }
  // A menu beside the field: its answers, the new answer you last gave, to keep, or both. The new
  // answer waits for a menu with room for it.
  const answers = message.answers ? menuAnswers(field, reply) : [];
  const save = message.save ? page.saving : null;
  if (save) page.saving = null;
  if (answers.length === 0 && !save) {
    page.menu = null;
    return { answers: 0, save: false };
  }
  page.menu = { token: message.token, at, answers, save };
  return { answers: answers.length, save: Boolean(save) };
}

/** The page whose menu a frame names by its token, in the frame's own tab. */
function menuFor(tabId: number, token: string): { page: OnPage; menu: Menu } | null {
  const page = pages.get(tabId);
  const menu = page?.menu;
  return page && menu && menu.token === token ? { page, menu } : null;
}

/** Has the panel fill the form in a tab, if it's open, as it does when the click opens it. */
const tellPanel = (tabId: number, at: number) =>
  ext.runtime.sendMessage({ type: 'panel', do: 'fill', tabId, at } satisfies ToPanel).catch(() => {
    // The panel isn't open yet: it fills the form as it opens.
  });

/**
 * What the Fill button does, as clicking Fill does: Chrome's side panel opens and fills the form,
 * or fills it again if it was open (`opening`, which the click itself started). Firefox opens its
 * sidebar only from a click of its own, so where it's open, it fills this tab, and where it isn't,
 * the form is filled here, as the sidebar would fill it.
 */
async function fillButton(
  tab: Tab & { id: number },
  opening: Promise<boolean> | null,
): Promise<FilledHere> {
  const at = Date.now();
  if (opening) {
    if (!(await opening)) return fillHere(tab);
    void tellPanel(tab.id, at);
    return { did: 'panel' };
  }
  const open = await (ext.sidebarAction?.isOpen({ windowId: tab.windowId }) ?? false);
  if (!open) return fillHere(tab);
  void tellPanel(tab.id, at);
  return { did: 'panel' };
}

/** Fills the form in a tab as the panel would, without it, and says how it went. */
async function fillHere(tab: Tab & { id: number }): Promise<FilledHere> {
  const problem = (says: string) => ({ did: 'problem', says }) as const;
  if (!(await canReachComputer()) || !canSendNow()) {
    return problem(
      'Filling needs your OK to reach Factwright on this computer: click Factwright’s button, then Fill this application.',
    );
  }
  const form = await readForm(tab.id);
  if (!form) return problem('Factwright can’t read this page.');
  if (form.fields.length === 0) {
    return problem('There’s no form here. Open the application itself, then click Fill again.');
  }
  const { page } = await readTab(tab);
  const shows = { company: page.company, role: page.title };
  const plan = await planFill(form, shows);
  if (!plan.ok || plan.did !== 'fill') {
    return problem(plan.ok ? 'Factwright didn’t answer. Try again.' : plan.message);
  }
  const filled = new Map<string, FieldFilled>();
  const done = await fillInPasses({ tabId: tab.id, form, plan, shows, filled, stale: () => false });
  if (done === 'elsewhere') return problem('This tab has moved on from the form.');
  if (done !== true) return problem('Factwright can’t reach this page anymore.');
  const unsaved = plan.job ? '' : ' Save the job first to upload its resume.';
  return {
    did: 'filled',
    says: `${filledSummary(form, filled)}${unsaved} To check each answer, click Factwright’s button, then Fill this application.`,
  };
}

/** What the frame asks, answered, for its own tab's menu. */
export async function answerFrame(
  message: FromFrame,
  from: { tab: Tab & { id: number }; url: string },
  opening: Promise<boolean> | null = null,
): Promise<unknown> {
  const { tab, url } = from;
  if (!(await isAllowedPage(url))) return null;
  const tabId = tab.id;
  if (message.do === 'fill') {
    const done = await fillButton(tab, opening);
    // Filled here, the button says how it went, in room the script makes for it.
    if (done.did !== 'panel')
      await tellScript(tabId, { type: 'job-site', do: 'button', size: 'card' });
    return done;
  }
  if (message.do === 'hide-button') {
    await tellScript(tabId, { type: 'job-site', do: 'hide-button' });
    return {};
  }
  const found = menuFor(tabId, message.token);
  if (!found) return null;
  const { page, menu } = found;
  const field = page.form.fields[menu.at] as PageField;
  if (message.do === 'shows') {
    return {
      question: field.question,
      answers: menu.answers.map((each) => each.shown),
      save: menu.save
        ? { question: menu.save.question, text: menu.save.text, private: menu.save.private }
        : null,
    };
  }
  if (message.do === 'pick') {
    const picked = menu.answers[message.at];
    if (!picked) return { ok: false };
    page.menu = null;
    const written = (await tellScript(tabId, {
      type: 'job-site',
      do: 'write',
      answer: { ref: field.ref, key: field.key, ...picked.answer },
    })) as Written | null;
    return { ok: written?.filled?.ok === true };
  }
  if (message.do === 'save') {
    const save = menu.save;
    if (!save) return { ok: false };
    const kept = await askComputer({
      ask: 'remember',
      answers: [{ kind: save.kind, text: save.text }],
    });
    if (!kept.ok) return { ok: false, says: kept.message };
    page.offered.add(save.key);
    menu.save = null;
    return { ok: true };
  }
  // Not now, or Escape: it's not offered again on this page.
  if (menu.save) page.offered.add(menu.save.key);
  page.menu = null;
  await tellScript(tabId, { type: 'job-site', do: 'close', refocus: message.refocus });
  return {};
}

/**
 * Hears the script and the frame on the job sites you allowed, each checked as what it says it is,
 * from where it says it's from. Anything else is left for the background's other listener.
 */
export function onJobSiteMessage(
  message: unknown,
  sender: Sender,
  sendResponse: (answer: unknown) => void,
): boolean | undefined {
  const failed = () => sendResponse(null);
  if (isFromScript(message)) {
    const from = scriptSender(sender);
    if (!from) return undefined;
    answerScript(message, from).then(sendResponse, failed);
    return true;
  }
  if (isFromFrame(message)) {
    const from = frameSender(sender);
    if (!from) return undefined;
    // Chrome opens its side panel only straight from the click, before anything is waited on.
    const opening =
      message.do === 'fill' && ext.sidePanel
        ? openPanel(from.tab).then(
            () => true,
            () => false,
          )
        : null;
    answerFrame(message, from, opening).then(sendResponse, failed);
    return true;
  }
  return undefined;
}

/** Forgets a tab's form once it closes. */
export function forgetTab(tabId: number): void {
  pages.delete(tabId);
  scripts.delete(tabId);
}

/**
 * Tells the script on each page whose site isn't allowed anymore to stop, as once you turn a site
 * off: its Fill button and menus go at once. A page the background doesn't know of stops the next
 * time its script asks for anything.
 */
export async function stopWhereNotAllowed(): Promise<void> {
  for (const [tabId, url] of scripts) {
    if (await isAllowedPage(url)) continue;
    forgetTab(tabId);
    await tellScript(tabId, { type: 'job-site', do: 'stop' });
  }
}
