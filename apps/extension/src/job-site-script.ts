import { looksLikeApplication } from './application-form.ts';
import { ext } from './ext.ts';
import { BUTTON, BUTTON_CARD, MENU_WIDTH, menuHeight } from './frame-size.ts';
import { type FieldMenu, type FromScript, isToScript, type Written } from './job-site-messages.ts';
import { type FieldAnswer, type FormAnswer, formPage, type PageForm } from './page/form.ts';
import { readJobPage } from './page/read-job.ts';
import { type Box, EDGE, placeButton, placeMenu, type Size } from './place.ts';

/**
 * The extension's script on the job sites you allowed (src/application-sites.ts), and only there.
 * On a page with an application form, it puts a small Fill button in a corner of the window, which
 * fills the form as clicking Fill does. In a field you click or tab into where Factwright has an
 * answer, it shows a menu beside the field with the answers, and when you leave a field with a new
 * answer Profile can keep, it offers to save it. The menu and the button are the extension's own
 * frame, which the page can't read: the script never has an answer but the one you pick, which it
 * puts in the field only then, as typing would. Neither ever covers the page's own controls: where
 * there's no room, the menu doesn't show, and the panel has the same answers.
 * It reads the form as the panel does (page/form.ts), without what's in its fields, and what's in
 * a field only once you've typed in it and left it, for one whose answer Profile keeps, to offer
 * to save it. It never fills a password, never submits, and never clicks a button that would.
 */

/** How soon after your own click or key press a field you land in counts as one you chose. */
const YOURS_MS = 1000;

/**
 * How long it waits for the page to settle after it changes, before reading the form again, and
 * the longest it waits while the page keeps changing.
 */
const SETTLE_MS = 400;
const SETTLE_MAX_MS = 2000;

/** How long the Fill button says how filling went, before it's a button again. */
const CARD_MS = 15_000;

/** How long it waits before asking Factwright for answers again, once it couldn't. */
const AGAIN_MS = 30_000;

/** What the page's own controls are, which the frame never covers. */
const CONTROLS = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'iframe',
  'embed',
  'object',
  'video[controls]',
  'audio[controls]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  ...[
    'button',
    'link',
    'checkbox',
    'radio',
    'switch',
    'tab',
    'menuitem',
    'option',
    'combobox',
    'listbox',
    'menu',
    'textbox',
    'slider',
    'spinbutton',
    'searchbox',
  ].map((role) => `[role="${role}"]`),
].join(', ');

interface Frame {
  host: HTMLElement;
  frame: HTMLIFrameElement;
}

/** The script, running on a page, which stops when the extension tells it to. */
export interface Script {
  stop(): void;
}

/**
 * Starts the script on the page. What counts as yours, of what happens on the page, is what the
 * browser says came from you (`isTrusted`), never what the page's own code does: a test, which
 * can't make such events, says otherwise.
 */
export function startScript(
  yourOwn: (event: Event) => boolean = (event) => event.isTrusted,
): Script {
  let stopped = false;
  /** The form as last read, and each field's elements, by its place. */
  let form: PageForm | null = null;
  let elements: HTMLElement[][] = [];
  /** What the background said of each field's menu, once it's asked Factwright for the form. */
  let menus: FieldMenu[] | null = null;
  let planning: Promise<FieldMenu[] | null> | null = null;
  /** When asking Factwright last failed, so it waits a while before asking again. */
  let failedAt = 0;
  /** The menu that's open, for one field, by its token. */
  let menu: (Frame & { at: number; token: string; size: Size }) | null = null;
  let button: (Frame & { card: boolean }) | null = null;
  let buttonHidden = false;
  let cardTimer: ReturnType<typeof setTimeout> | null = null;
  /** The field whose new answer the background will offer to keep, in the next menu. */
  let pendingSave: number | null = null;
  /** The fields you've typed in or picked an answer in, by their keys. */
  const typed = new Set<string>();
  /** When you last clicked or pressed a key in the page. */
  let lastInput = 0;
  /**
   * The field it's putting your pick in, and the control it puts the cursor in itself: landing
   * there is its own doing, not yours, so neither opens a menu.
   */
  let writing: number | null = null;
  let ownFocus: Element | null = null;
  let settle: ReturnType<typeof setTimeout> | null = null;
  /** When the page first changed since the form was last read. */
  let changedAt = 0;
  let frameQueued = false;
  /** Its own frames, which coming and going isn't the page changing. */
  const mine = new WeakSet<Node>();
  /**
   * Messages to the background go one after the other, as you leave one field for the next: what
   * you gave the one you left is heard before the next one's menu.
   */
  let queue: Promise<unknown> = Promise.resolve();

  const send = async <Answer>(message: FromScript): Promise<Answer | null> => {
    if (stopped) return null;
    try {
      return ((await ext.runtime.sendMessage(message)) as Answer | undefined) ?? null;
    } catch {
      // The extension was updated or turned off: this copy of the script is done.
      stop();
      return null;
    }
  };

  /** A step that takes its turn, after the messages before it, and before those after. */
  const inTurn = <Result>(step: () => Promise<Result>): Promise<Result | null> => {
    const next = queue.then(() => (stopped ? null : step()));
    queue = next.catch(() => {});
    return next;
  };

  const ask = <Answer>(message: FromScript) => inTurn(() => send<Answer>(message));

  /** Stops, as told to, or once the site isn't allowed: the button and menu go. */
  const stopIf = (said: unknown) => {
    if (said && typeof said === 'object' && 'stop' in said) stop();
  };

  // --- The form -------------------------------------------------------------------------------

  const pageUrl = () => location.href.split('#')[0] ?? location.href;
  let readAt = '';

  /** Reads the form, as the panel does, with each field's elements, and shows the Fill button. */
  async function look(): Promise<void> {
    if (stopped) return;
    const seen: HTMLElement[][] = [];
    let answer: FormAnswer;
    try {
      answer = await formPage({ do: 'read' }, document, location.href, seen);
    } catch {
      return;
    }
    if (stopped || answer.did !== 'read') return;
    const before = form;
    form = answer.form;
    elements = seen;
    // Another page, or the same with other fields: the background is asked again for its answers.
    const same =
      before !== null &&
      readAt === pageUrl() &&
      before.fields.length === form.fields.length &&
      before.fields.every((field, at) => field.key === form?.fields[at]?.key);
    if (!same) {
      menus = null;
      planning = null;
      pendingSave = null;
      if (readAt !== pageUrl()) typed.clear();
      closeMenu();
    }
    readAt = pageUrl();
    if (looksLikeApplication(form) && !buttonHidden) showButton();
    else removeButton();
  }

  /** The field an element is one of, or inside, by its place, or -1. */
  const fieldOf = (element: Element): number =>
    elements.findIndex((controls) =>
      controls.some((control) => control === element || control.contains(element)),
    );

  /**
   * What the background says of each field's menu, once it's asked Factwright for the form's
   * answers, which it does the first time you're in one of its fields.
   */
  function plan(again = false): Promise<FieldMenu[] | null> {
    if (menus && !again) return Promise.resolve(menus);
    if (planning && !again) return planning;
    if (!form || (!again && Date.now() - failedAt < AGAIN_MS)) return Promise.resolve(null);
    const asked = form;
    const job = readJobPage(document, location.href, '');
    planning = ask<{ menus: FieldMenu[] | null }>({
      type: 'job-site',
      do: 'form',
      form: asked,
      job: { company: job.company.slice(0, 500), role: job.title.slice(0, 500) },
    }).then((said) => {
      stopIf(said);
      if (form !== asked) return null;
      menus = said?.menus ?? null;
      if (!menus) failedAt = Date.now();
      return menus;
    });
    return planning;
  }

  // --- The menu -------------------------------------------------------------------------------

  /** A box on the screen for each element, as the page lays it out now. */
  const boxOf = (element: Element): Box => {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
  };

  /** The box around a field: its control, or for options, the group they're in. */
  function fieldBox(at: number): Box | null {
    const controls = elements[at] ?? [];
    const [first] = controls;
    if (!first?.isConnected) return null;
    const group =
      controls.length > 1
        ? first.closest('fieldset, [role="radiogroup"], [role="group"], ul, ol')
        : null;
    const boxes = (group ? [group] : controls).map(boxOf).filter((box) => box.width > 0);
    if (boxes.length === 0) return null;
    const left = Math.min(...boxes.map((box) => box.left));
    const top = Math.min(...boxes.map((box) => box.top));
    const right = Math.max(...boxes.map((box) => box.left + box.width));
    const bottom = Math.max(...boxes.map((box) => box.top + box.height));
    return { left, top, width: right - left, height: bottom - top };
  }

  /** Whether a box is in the window, at least in part. */
  const inView = (box: Box) =>
    box.width > 0 &&
    box.height > 0 &&
    box.left < innerWidth &&
    box.top < innerHeight &&
    box.left + box.width > 0 &&
    box.top + box.height > 0;

  /**
   * The page's own controls in the window, as boxes: each control, and the words of each label,
   * as a label can be as wide as its row, around its field.
   */
  function controlBoxes(): Box[] {
    const boxes: Box[] = [];
    for (const element of document.querySelectorAll(CONTROLS)) {
      const box = boxOf(element);
      if (!inView(box)) continue;
      const visible = (element as HTMLElement).checkVisibility?.({
        visibilityProperty: true,
        opacityProperty: true,
      });
      if (visible === false) continue;
      boxes.push(box);
    }
    const range = document.createRange();
    for (const label of document.querySelectorAll('label, legend')) {
      const words = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      for (let node = words.nextNode(); node; node = words.nextNode()) {
        if (!node.textContent?.trim()) continue;
        range.selectNodeContents(node);
        for (const rect of range.getClientRects?.() ?? []) {
          const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
          if (inView(box)) boxes.push(box);
        }
      }
    }
    return boxes;
  }

  /** The extension's frame, in a box of its own on top of the page, which the page can't open. */
  function makeFrame(src: string, title: string): Frame {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent =
      ':host{all:initial}iframe{display:block;width:100%;height:100%;border:0;margin:0;padding:0;background:transparent;color-scheme:light dark}';
    const frame = document.createElement('iframe');
    frame.title = title;
    frame.src = src;
    root.append(style, frame);
    mine.add(host);
    for (const [name, value] of Object.entries({
      position: 'fixed',
      'z-index': '2147483647',
      display: 'block',
      margin: '0',
      padding: '0',
      border: '0',
      opacity: '1',
      visibility: 'visible',
      transform: 'none',
    })) {
      host.style.setProperty(name, value, 'important');
    }
    document.documentElement.append(host);
    return { host, frame };
  }

  /** Puts a frame at a place, at a size, or hides it where there's no room. */
  function put(frame: Frame, size: Size, place: { left: number; top: number } | null): void {
    const { style } = frame.host;
    if (!place) {
      style.setProperty('display', 'none', 'important');
      return;
    }
    style.setProperty('display', 'block', 'important');
    style.setProperty('left', `${Math.round(place.left)}px`, 'important');
    style.setProperty('top', `${Math.round(place.top)}px`, 'important');
    style.setProperty('width', `${size.width}px`, 'important');
    style.setProperty('height', `${size.height}px`, 'important');
  }

  /** What the menu mustn't cover: the page's own controls, and the Fill button. */
  const forMenu = () => [...controlBoxes(), ...(button ? [boxOf(button.host)] : [])];

  /** Places the open menu beside its field again, or closes it once there's no room. */
  function placeOpenMenu(): void {
    if (!menu) return;
    const field = fieldBox(menu.at);
    const place =
      field && inView(field)
        ? placeMenu(menu.size, field, forMenu(), { width: innerWidth, height: innerHeight })
        : null;
    if (!place) {
      closeMenu();
      return;
    }
    put(menu, menu.size, place);
  }

  /** What a menu shows: a field's answers, the offer to keep a new one you gave, or both. */
  interface Shown {
    /** The field it's beside. */
    at: number;
    answers: boolean;
    save: boolean;
  }

  /** The menu's size, for some answers, with or without the offer to keep one. */
  const sizeFor = (answers: number, save: boolean): Size => ({
    width: Math.min(MENU_WIDTH, innerWidth - 2 * EDGE),
    height: menuHeight(answers, save),
  });

  /** Where a menu goes beside a field, or null where there's no room that covers nothing. */
  const placeFor = (at: number, size: Size) => {
    const box = fieldBox(at);
    return box && inView(box)
      ? placeMenu(size, box, forMenu(), { width: innerWidth, height: innerHeight })
      : null;
  };

  /**
   * Shows the menu for where you are (`at`, the field you're in, or null): its answers, with the
   * offer to keep the new one you gave the field you left. Where there's no room for both, the
   * offer goes beside the field you left, alone, or, where there's no room for that either, waits
   * for the next menu, and the answers show alone. Where there's no room for anything, no menu
   * shows: the panel has the same answers.
   */
  async function showMenu(at: number | null, again = false): Promise<void> {
    // After what you gave the field you left is heard, which may offer to keep it.
    await inTurn(() => Promise.resolve());
    if (stopped) return;
    const answers = at !== null ? (menus?.[at]?.answers ?? 0) : 0;
    const saveAt = pendingSave;
    const tries: Shown[] = [];
    if (at !== null && answers > 0 && saveAt !== null)
      tries.push({ at, answers: true, save: true });
    if (saveAt !== null) tries.push({ at: saveAt, answers: false, save: true });
    if (at !== null && answers > 0) tries.push({ at, answers: true, save: false });
    const fits = tries.find(
      (each) => placeFor(each.at, sizeFor(each.answers ? answers : 0, each.save)) !== null,
    );
    const field = fits ? form?.fields[fits.at] : null;
    if (!fits || !field) {
      closeMenu();
      return;
    }
    const token = crypto.randomUUID();
    const said = await ask<{ answers: number; save: boolean; again?: boolean; stop?: boolean }>({
      type: 'job-site',
      do: 'menu',
      ref: field.ref,
      key: field.key,
      token,
      answers: fits.answers,
      save: fits.save,
    });
    stopIf(said);
    if (stopped) return;
    if (said?.again && !again) {
      // The background started again since, and forgot the form: it's asked again.
      if (await plan(true)) await showMenu(at, true);
      return;
    }
    if (!said || (said.answers === 0 && !said.save)) {
      closeMenu();
      return;
    }
    if (said.save) pendingSave = null;
    closeMenu();
    // What the background has to show, which is what it was asked for, unless that's changed.
    const size = sizeFor(said.answers, said.save);
    const place = placeFor(fits.at, size);
    if (!place) {
      void ask({ type: 'job-site', do: 'closed', token });
      return;
    }
    const frame = makeFrame(`${ext.runtime.getURL('frame.html')}#menu:${token}`, 'Factwright');
    menu = { ...frame, at: fits.at, token, size };
    put(menu, size, place);
  }

  function closeMenu(): void {
    if (!menu) return;
    const { host, token } = menu;
    menu = null;
    host.remove();
    void ask({ type: 'job-site', do: 'closed', token });
  }

  /** Puts the cursor back in a field, without opening its menu again. */
  function refocus(at: number): void {
    const [control] = elements[at] ?? [];
    if (!control?.isConnected) return;
    ownFocus = control;
    try {
      control.focus({ preventScroll: true });
    } finally {
      ownFocus = null;
    }
  }

  /** Puts the answer you picked in its field, as typing would, and says how it went. */
  async function write(answer: FieldAnswer): Promise<Written> {
    const at = menu?.at ?? fieldOf(elements[answer.ref]?.[0] ?? document.body);
    closeMenu();
    writing = at;
    let filled: Written['filled'] = null;
    try {
      const done = await formPage({ do: 'fill', url: location.href, answers: [answer] });
      filled = done.did === 'fill' ? (done.filled[0] ?? null) : null;
    } catch {
      filled = null;
    } finally {
      writing = null;
    }
    if (at >= 0) refocus(at);
    return { filled };
  }

  // --- Where you are --------------------------------------------------------------------------

  const yours = () => Date.now() - lastInput < YOURS_MS;

  /** You're in a field: its menu, if Factwright has answers, or the offer to keep a new one. */
  async function arrived(element: Element): Promise<void> {
    let at = fieldOf(element);
    if (at < 0) {
      await look();
      at = fieldOf(element);
    }
    if (at < 0) {
      await showMenu(null);
      return;
    }
    if (menu?.at === at) return;
    const said = await plan();
    if (stopped || !said) return;
    await showMenu(at);
  }

  /** Whether the cursor is in one of the form's fields. */
  const inAField = () => {
    const now = document.activeElement;
    return now !== null && fieldOf(now) >= 0;
  };

  /**
   * You left a field: one you typed in or picked in, whose answer Profile keeps, may be offered
   * to keep, in the next field's menu, or on its own beside the field you left. It takes its turn
   * at once, so the next field's menu waits for it.
   */
  function left(element: Element): void {
    const at = fieldOf(element);
    const field = form?.fields[at];
    const info = menus?.[at];
    if (!field || !info?.keeps || !typed.has(field.key)) return;
    typed.delete(field.key);
    void inTurn(async () => {
      const read = await formPage({ do: 'values', fields: [{ ref: field.ref, key: field.key }] });
      const value = read.did === 'values' ? (read.values[0]?.value ?? '') : '';
      if (!value.trim()) return;
      const said = await send<{ offer: boolean }>({
        type: 'job-site',
        do: 'left',
        ref: field.ref,
        key: field.key,
        value,
      });
      stopIf(said);
      if (!said?.offer) return;
      pendingSave = at;
      // Nowhere else to show it: beside the field you left. A field you're in shows it with its own.
      if (!inAField() && !menu) void showMenu(null);
    });
  }

  // --- The Fill button ------------------------------------------------------------------------

  function placeTheButton(): void {
    if (!button) return;
    const size = button.card ? BUTTON_CARD : BUTTON;
    const covered = [...controlBoxes(), ...(menu ? [boxOf(menu.host)] : [])];
    put(button, size, placeButton(size, covered, { width: innerWidth, height: innerHeight }));
  }

  function showButton(): void {
    if (!button) {
      button = {
        ...makeFrame(`${ext.runtime.getURL('frame.html')}#button`, 'Factwright'),
        card: false,
      };
    }
    placeTheButton();
  }

  function removeButton(): void {
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = null;
    button?.host.remove();
    button = null;
  }

  /** The button says how filling went, for a while, then it's a button again. */
  function showCard(): void {
    if (!button) return;
    button.card = true;
    placeTheButton();
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = setTimeout(() => {
      if (!button) return;
      button.card = false;
      placeTheButton();
    }, CARD_MS);
  }

  // --- Listening ------------------------------------------------------------------------------

  const onInput = (event: Event) => {
    if (!yourOwn(event)) return;
    lastInput = Date.now();
  };
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || mine.has(target) || target === ownFocus) return;
    if (!yours() || (writing !== null && fieldOf(target) === writing)) return;
    void arrived(target);
  };
  const onFocusOut = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || mine.has(target)) return;
    left(target);
    // Into the menu, it stays open; into another field, that field's menu follows; anywhere
    // else, it closes, unless it offers to keep what you gave the field you left.
    setTimeout(() => {
      if (!menu || document.activeElement === menu.host || inAField()) return;
      if (pendingSave !== null && pendingSave === menu.at) return;
      closeMenu();
    }, 0);
  };
  const onTyped = (event: Event) => {
    if (!yourOwn(event) || !(event.target instanceof Element)) return;
    const field = form?.fields[fieldOf(event.target)];
    if (field) typed.add(field.key);
  };
  const onKey = (event: KeyboardEvent) => {
    onInput(event);
    if (!menu || !yourOwn(event)) return;
    if (event.key === 'Escape') {
      closeMenu();
      return;
    }
    // Down from a box of words goes into the menu, as it does in a browser's own suggestions. A
    // number's or a date's box, or one that offers its own choices, keeps the key for itself.
    const target = event.target;
    if (
      event.key === 'ArrowDown' &&
      target instanceof HTMLInputElement &&
      /^(text|email|tel|url|search)$/.test(target.type) &&
      target.getAttribute('role') !== 'combobox' &&
      !target.getAttribute('aria-autocomplete') &&
      fieldOf(target) === menu.at
    ) {
      event.preventDefault();
      menu.frame.focus();
      menu.frame.contentWindow?.focus();
    }
  };
  /** Places the frame again once the page moves under it, at most once a frame. */
  const onMove = () => {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      if (stopped) return;
      placeOpenMenu();
      placeTheButton();
    });
  };
  const observer = new MutationObserver((changes) => {
    const ours = (node: Node) => mine.has(node);
    if (
      changes.every(
        (change) => [...change.addedNodes].every(ours) && [...change.removedNodes].every(ours),
      )
    ) {
      return;
    }
    onMove();
    // The form is read again once the page settles, or every couple of seconds while it doesn't.
    const now = Date.now();
    if (!settle) changedAt = now;
    if (settle) clearTimeout(settle);
    const wait = Math.max(0, Math.min(SETTLE_MS, changedAt + SETTLE_MAX_MS - now));
    settle = setTimeout(() => {
      settle = null;
      void look();
    }, wait);
  });

  const onMessage = (
    message: unknown,
    sender: { id?: string; tab?: unknown },
    sendResponse: (answer: unknown) => void,
  ) => {
    // Only the extension's own background tells the script anything.
    if (sender.id !== ext.runtime.id || sender.tab || !isToScript(message)) return undefined;
    if (message.do === 'write') {
      void write(message.answer).then(sendResponse);
      return true;
    }
    if (message.do === 'close') {
      const at = menu?.at;
      closeMenu();
      if (message.refocus && at !== undefined) refocus(at);
    } else if (message.do === 'button') {
      if (message.size === 'card') showCard();
    } else if (message.do === 'hide-button') {
      buttonHidden = true;
      removeButton();
    } else {
      stop();
    }
    sendResponse({});
    return undefined;
  };

  function stop(): void {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    if (settle) clearTimeout(settle);
    removeButton();
    menu?.host.remove();
    menu = null;
    removeEventListener('pointerdown', onInput, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('focusin', onFocusIn, true);
    removeEventListener('focusout', onFocusOut, true);
    removeEventListener('input', onTyped, true);
    removeEventListener('change', onTyped, true);
    removeEventListener('scroll', onMove, true);
    removeEventListener('resize', onMove);
    try {
      ext.runtime.onMessage.removeListener?.(onMessage);
    } catch {
      // The extension's gone already.
    }
  }

  const script: Script = { stop };
  addEventListener('pointerdown', onInput, true);
  addEventListener('keydown', onKey, true);
  addEventListener('focusin', onFocusIn, true);
  addEventListener('focusout', onFocusOut, true);
  addEventListener('input', onTyped, true);
  addEventListener('change', onTyped, true);
  addEventListener('scroll', onMove, { capture: true, passive: true });
  addEventListener('resize', onMove, { passive: true });
  ext.runtime.onMessage.addListener(onMessage);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  void ask<{ allowed: boolean }>({ type: 'job-site', do: 'hello' }).then((said) => {
    if (said?.allowed) void look();
    else stop();
  });
  return script;
}
