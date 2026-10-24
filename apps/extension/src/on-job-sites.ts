import {
  type FieldReply,
  isEqualOpportunity,
  isRemembered,
  type RememberedKind,
} from '@factwright/core';
import { isCopyOnlySite } from './applicant-systems.ts';
import { forgetFrame, isAllowedPage, keepFrame, keptFrame } from './application-sites.ts';
import { askComputer, canReachComputer, canSendNow } from './computer.ts';
import { ext, type Sender, type Tab } from './ext.ts';
import {
  answerSource,
  type FillPlan,
  type FormPlace,
  filledSummary,
  fillInPasses,
  isPlace,
  newAnswers,
  picksOf,
  placeNames,
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
import { readFormJob } from './read-tab.ts';

/**
 * The background's side of the job sites you allowed: what each field's menu offers, from
 * Factwright's answers for the form, which it asks Factwright on this computer for the first time
 * you're in one of its fields; the new answers you gave, which it offers to keep; and the Fill
 * button. The answers stay here, and in the extension's own frame, which shows them: the script in
 * the page gets only the one you pick, to put in its field. Each message is checked, and answered
 * only for a site you allowed. The script runs in each frame of a tab from such a site, as a
 * company's careers page shows an applicant system's form in one, so what's known of a form is
 * kept by its tab and its frame, and the frames are kept for the panel to find their forms.
 */

/** One of a menu's answers: what it shows, and what goes in the field if you pick it. */
export interface Offered {
  shown: MenuAnswer;
  answer: Omit<FieldAnswer, 'ref' | 'key'>;
}

/** An option's words, as compared, as the page's form function compares them. */
const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
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
 * with it, as the panel would fill them, each in the form's own words for the options it would
 * pick. None for a field that's left for you, a file, a box to tick, or a password. None for an
 * equal-opportunity question either, which keeps the panel's rules: Fill picks your answer among
 * its options, as you set it in Profile, and a menu that showed only where you set one would tell
 * the site you had.
 */
export function menuAnswers(field: PageField, reply: FieldReply | undefined): Offered[] {
  if (!reply || reply.source === 'you' || reply.file || isEqualOpportunity(reply.kind)) return [];
  if (field.control === 'check' || field.control === 'file' || field.type === 'password') return [];
  const asked: FieldReply[] = [
    reply,
    ...(reply.others ?? []).map((other) => ({ kind: reply.kind, ...other })),
  ];
  const offered = asked.flatMap((each): Offered[] => {
    const from = answerSource(each);
    if (each.pick?.length) {
      // The form's own words for each option it would pick: one of a choice's, or each of a set
      // of boxes' that one of the picks names, as filling it ticks them all.
      const options =
        field.options.length === 0
          ? each.pick.slice(0, 1)
          : field.control === 'choices'
            ? [
                ...new Set(
                  each.pick.flatMap((pick) => optionFor(field.options, [pick], each.exact) ?? []),
                ),
              ]
            : [optionFor(field.options, each.pick, each.exact) ?? ''].filter(Boolean);
      if (options.length === 0) return [];
      return [
        {
          shown: { text: options.join(', '), from },
          answer: {
            pick: picksOf({ kind: reply.kind, pick: each.pick }),
            ...(each.exact && { exact: true }),
            ...(isPlace(reply.kind) && { place: true }),
          },
        },
      ];
    }
    // A choice takes only its own options.
    if (choosing(field) || !each.text?.trim()) return [];
    // A place in a box that offers places as you type is one of its own to pick.
    const answer =
      isPlace(reply.kind) && field.control === 'combo'
        ? { pick: placeNames([each.text]), place: true }
        : { text: each.text };
    return [{ shown: { text: each.text, from }, answer }];
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
 * kind Profile keeps, never a file or a password. Never an equal-opportunity answer, which the
 * panel offers to keep when you mark the job applied, as the menu's offer would show the site
 * whether Profile had it.
 */
export function keepsAnswer(field: PageField, reply: FieldReply | undefined): boolean {
  if (!reply || !isRemembered(reply.kind) || isEqualOpportunity(reply.kind)) return false;
  return field.control !== 'file' && field.control !== 'check' && field.type !== 'password';
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

/** Where a script runs: a tab, a frame in it, its top frame being 0, and the page it's on. */
interface ScriptAt extends FormPlace {
  url: string;
  /** The script's own name for its page, which its Fill button's frame says. */
  doc: string;
}

/** A page on a site you allowed whose form the background answered, in one frame of a tab. */
interface OnPage {
  place: FormPlace;
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

/** A frame of a tab, as the background keeps what it knows of each. */
const keyOf = (place: FormPlace) => `${place.tabId}:${place.frameId}`;

const pages = new Map<string, OnPage>();

/** The frames the script said hello from, to tell it to stop once its site isn't allowed. */
const scripts = new Map<string, ScriptAt>();

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

/** Has the panel filling a tab's form look at it again, if it's open. */
const tellPanelStep = (tabId: number) =>
  ext.runtime.sendMessage({ type: 'panel', do: 'step', tabId } satisfies ToPanel).catch(() => {
    // No panel's open.
  });

/** Sends the script in a frame of a tab a message, and its answer, or null. */
const tellScript = (place: FormPlace, message: ToScript) =>
  ext.tabs.sendMessage(place.tabId, message, { frameId: place.frameId }).catch(() => null);

/**
 * Where the script is, when the message is the script's: its tab, its frame, the page it's on, and
 * the address of the tab's own page, where the browser gives it.
 */
function scriptSender(sender: Sender): (FormPlace & { url: string; top: string }) | null {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  if (sender.id !== ext.runtime.id || tabId === undefined || !Number.isInteger(frameId)) {
    return null;
  }
  const url = sender.url ?? '';
  if (!/^https?:\/\//i.test(url)) return null;
  return { tabId, frameId: frameId as number, url, top: sender.tab?.url ?? '' };
}

/**
 * The frame's tab, when the message is the extension's own frame's. Chrome names the frame by an
 * address of the session's own as a page loads it, but by the extension's own as it runs, which
 * `getURL('frame.html')` doesn't give, as it gives the session's.
 */
function frameSender(sender: Sender): { tab: Tab & { id: number } } | null {
  const tab = sender.tab;
  if (sender.id !== ext.runtime.id || tab?.id === undefined) return null;
  if (!(sender.url ?? '').startsWith(`${ext.runtime.getURL('')}frame.html#`)) return null;
  return { tab: { ...tab, id: tab.id } };
}

/** Asks Factwright on this computer for the form's answers, keeping those it has, by field. */
async function answer(
  place: FormPlace,
  form: PageForm,
  job: { company: string; role: string },
): Promise<OnPage | string> {
  const url = pageOf(form.url);
  const key = keyOf(place);
  const before = pages.get(key);
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
      pages.set(key, page);
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
    place,
    url,
    form,
    plan: planned,
    menu: null,
    saving: null,
    offered: before?.url === url ? before.offered : new Set(),
  };
  pages.set(key, page);
  return page;
}

/**
 * Whether a frame's script is in a page of LinkedIn's or Indeed's, where the extension only ever
 * gives answers to copy: by the tab's own address, where the browser gives it, and the sites of
 * the pages around the frame, where the browser says them.
 */
const inCopyOnly = (top: string, around: readonly string[]) =>
  [top, ...around].some((url) => url !== '' && isCopyOnlySite(url));

/** Forgets what the background knows of a frame's page. */
function forgetPage(place: FormPlace): void {
  pages.delete(keyOf(place));
  scripts.delete(keyOf(place));
}

/** What the script asks, answered: or undefined when it isn't on a site you allowed. */
export async function answerScript(
  message: FromScript,
  from: FormPlace & { url: string; top: string },
): Promise<unknown> {
  const { url } = from;
  const place = { tabId: from.tabId, frameId: from.frameId };
  const key = keyOf(place);
  if (message.do === 'bye') {
    if (scripts.get(key)?.doc === message.doc) forgetPage(place);
    await forgetFrame(place.tabId, { frameId: place.frameId, doc: message.doc });
    return {};
  }
  const around = message.do === 'hello' ? message.around : [];
  if (!(await isAllowedPage(url)) || inCopyOnly(from.top, around)) {
    forgetPage(place);
    return message.do === 'hello' ? { allowed: false } : { stop: true };
  }
  if (message.do === 'hello') {
    scripts.set(key, { ...place, url, doc: message.doc });
    await keepFrame(place.tabId, { frameId: place.frameId, url, doc: message.doc });
    return { allowed: true };
  }
  if (message.do === 'step') {
    // The page of an application that runs over several went on to another: the panel filling
    // the tab's form, if it's open, looks at it again, to offer to fill this one.
    if (scripts.get(key)?.doc === message.doc) void tellPanelStep(place.tabId);
    return {};
  }
  if (message.do === 'form') {
    // Only the form on the page the script is on.
    if (pageOf(message.form.url) !== pageOf(url)) return { menus: null };
    const page = await answer(place, message.form, message.job);
    return typeof page === 'string' ? { menus: null, problem: page } : { menus: menusOf(page) };
  }
  const page = pages.get(key);
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

/** The page whose menu a frame names by its token, in one of the frame's own tab's frames. */
function menuFor(tabId: number, token: string): { page: OnPage; menu: Menu } | null {
  for (const page of pages.values()) {
    const menu = page.menu;
    if (page.place.tabId === tabId && menu && menu.token === token) return { page, menu };
  }
  return null;
}

/**
 * The script whose Fill button a frame is, by the name it gave its page, in the frame's own tab:
 * as the background knows it, or as the browser keeps it, once the background has started again.
 */
async function buttonFor(tabId: number, token: string): Promise<ScriptAt | null> {
  for (const script of scripts.values()) {
    if (script.tabId === tabId && script.doc === token) return script;
  }
  const kept = await keptFrame(tabId, token);
  return kept ? { tabId, ...kept } : null;
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
  place: FormPlace,
  opening: Promise<boolean> | null,
): Promise<FilledHere> {
  const at = Date.now();
  if (opening) {
    if (!(await opening)) return fillHere(tab, place);
    void tellPanel(tab.id, at);
    return { did: 'panel' };
  }
  const open = await (ext.sidebarAction?.isOpen({ windowId: tab.windowId }) ?? false);
  if (!open) return fillHere(tab, place);
  void tellPanel(tab.id, at);
  return { did: 'panel' };
}

/** Fills the form in a tab's frame as the panel would, without it, and says how it went. */
async function fillHere(tab: Tab & { id: number }, place: FormPlace): Promise<FilledHere> {
  const problem = (says: string) => ({ did: 'problem', says }) as const;
  if (!(await canReachComputer()) || !canSendNow()) {
    return problem(
      'Filling needs your OK to reach Factwright on this computer: click Factwright’s button, then Fill this application.',
    );
  }
  const form = await readForm(place);
  if (!form) return problem('Factwright can’t read this page.');
  if (form.fields.length === 0) {
    return problem('There’s no form here. Open the application itself, then click Fill again.');
  }
  const shows = await readFormJob(tab, place.frameId);
  const plan = await planFill(form, shows);
  if (!plan.ok || plan.did !== 'fill') {
    return problem(plan.ok ? 'Factwright didn’t answer. Try again.' : plan.message);
  }
  const filled = new Map<string, FieldFilled>();
  const done = await fillInPasses({ place, form, plan, shows, filled, stale: () => false });
  if (done === 'elsewhere') return problem('This tab has moved on from the form.');
  if (done !== true) return problem('Factwright can’t reach this page anymore.');
  const unsaved = plan.job ? '' : ' Save the job first to upload its resume.';
  return {
    did: 'filled',
    says: `${filledSummary(form, filled)}${unsaved} To check each answer, click Factwright’s button, then Fill this application.`,
  };
}

/** What the frame asks, answered, for the script in its own tab that shows it. */
export async function answerFrame(
  message: FromFrame,
  from: { tab: Tab & { id: number } },
  opening: Promise<boolean> | null = null,
): Promise<unknown> {
  const { tab } = from;
  const tabId = tab.id;
  if (message.do === 'fill' || message.do === 'hide-button') {
    const script = await buttonFor(tabId, message.token);
    if (!script || !(await isAllowedPage(script.url))) return null;
    const place = { tabId, frameId: script.frameId };
    if (message.do === 'hide-button') {
      await tellScript(place, { type: 'job-site', do: 'hide-button' });
      return {};
    }
    const done = await fillButton(tab, place, opening);
    // Filled here, the button says how it went, in room the script makes for it.
    if (done.did !== 'panel')
      await tellScript(place, { type: 'job-site', do: 'button', size: 'card' });
    return done;
  }
  const found = menuFor(tabId, message.token);
  if (!found || !(await isAllowedPage(found.page.url))) return null;
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
    const written = (await tellScript(page.place, {
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
  await tellScript(page.place, { type: 'job-site', do: 'close', refocus: message.refocus });
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

/** Forgets a tab's forms, in each of its frames, once it closes. */
export function forgetTab(tabId: number): void {
  for (const [key, page] of pages) if (page.place.tabId === tabId) pages.delete(key);
  for (const [key, script] of scripts) if (script.tabId === tabId) scripts.delete(key);
  void forgetFrame(tabId);
}

/**
 * Tells the script on each page whose site isn't allowed anymore to stop, as once you turn a site
 * off: its Fill button and menus go at once. A page the background doesn't know of stops the next
 * time its script asks for anything.
 */
export async function stopWhereNotAllowed(): Promise<void> {
  for (const script of [...scripts.values()]) {
    if (await isAllowedPage(script.url)) continue;
    forgetPage(script);
    await tellScript(script, { type: 'job-site', do: 'stop' });
  }
}
