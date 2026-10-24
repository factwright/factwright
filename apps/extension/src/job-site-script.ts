import { looksLikeApplication } from './application-form.ts';
import { ext } from './ext.ts';
import { BUTTON, BUTTON_CARD, MENU_WIDTH, menuHeight } from './frame-size.ts';
import {
  type FieldMenu,
  type FromScript,
  isToScript,
  MOST_AROUND,
  MOST_URL,
  type Written,
} from './job-site-messages.ts';
import { type FieldAnswer, type FormAnswer, formPage, type PageForm } from './page/form.ts';
import { readJobPage } from './page/read-job.ts';
import { type Area, type Box, EDGE, overlaps, placeButton, placeMenu, type Size } from './place.ts';

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
 * It runs in a frame from such a site too, as a company's careers page shows an applicant
 * system's form in one: there, the button and menus go in the part of the frame that shows, as
 * the page around it scrolls it, and the page around it, of another site, can't see in.
 */

/** How soon after your own click, or your Tab, a field you land in counts as one you chose. */
const YOURS_MS = 1000;

/** How far up from a field your click may be, on a box around it, and count as on it. */
const AROUND = 3;

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

/**
 * How long after a page has loaded it waits before it puts anything on it. A page its own code
 * builds, as a React one does, may still be checking the elements it has against those its site
 * sent, and anything added meanwhile would have it build the page again, and take that away too.
 */
const READY_MS = 1000;

/** How long after the page's look changes, as a list opening, it places the frame again. */
const RESTYLED_MS = 100;

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

/**
 * What may be a control the page made itself, which it can be clicked on, and takes the keyboard:
 * one as small as a control, never a box that holds the page's parts.
 */
const MAYBE_CONTROLS = '[tabindex]:not([tabindex="-1"]), [onclick]';

/**
 * What a page's own control looks like, at most: no wider than half the window, nor taller than a
 * quarter, or a quarter of the screen, in a frame as tall as its form.
 */
const controlSized = (box: Box) =>
  box.width <= innerWidth / 2 && box.height <= Math.min(innerHeight, screen.availHeight) / 4;

/** How finely it follows the part of its frame that shows: in steps of this much of the frame. */
const SHOWN_STEPS = 500;

/** How many pages around the frame it checks, as far as they're of its own site. */
const MOST_NESTED = 10;

/** The options a label can be for, which clicking anywhere on the label picks. */
const OPTIONS = 'input[type="checkbox"], input[type="radio"]';

interface Frame {
  host: HTMLElement;
  frame: HTMLIFrameElement;
}

/** The page's own controls, those it may have made itself, and its labels and legends. */
interface Found {
  controls: Element[];
  maybe: Element[];
  labels: Element[];
}

/** The script, running on a page, which stops when the extension tells it to. */
export interface Script {
  stop(): void;
}

/**
 * Starts the script on the page. What counts as yours, of what happens on the page, is what the
 * browser says came from you (`isTrusted`), never what the page's own code does: a test, which
 * can't make such events, says otherwise, and may have it put its frames on the page sooner.
 */
export function startScript(
  yourOwn: (event: Event) => boolean = (event) => event.isTrusted,
  readyMs = READY_MS,
): Script {
  let stopped = false;
  /** Whether the page has loaded, and settled a moment, so the script may put its frames on it. */
  let ready = false;
  /** Its own name for the page it's on, which its Fill button's frame says, and its goodbye. */
  const doc = crypto.randomUUID();
  /** Whether it's in a frame of another page, as a company's careers page shows a form in one. */
  const framed = window !== window.top;
  /**
   * The part of its frame that shows, as the page around it scrolls it, once the browser says; the
   * window, for a tab's own page.
   */
  let shown: Box | null = null;
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
  /** Your last click in the page, when and on what, and your last Tab. */
  let lastPointer: { at: number; target: EventTarget | null } = { at: 0, target: null };
  let lastTab = 0;
  /** The page's own controls, and its labels and legends, as last found, until the page changes. */
  let found: Found | null = null;
  let restyled: ReturnType<typeof setTimeout> | null = null;
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
      // The extension was updated or turned off: this copy of the script is done. Any other
      // failure is only this message's.
      if (!ext.runtime?.id) stop();
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
    // Another page of an application that runs over several, as Workday swaps its own in, or one
    // loaded anew, as Taleo's next page is: the panel filling it, if it's open, looks at it now, to
    // offer to fill this one.
    if (form.step && form.step !== before?.step) {
      void send({ type: 'job-site', do: 'look', doc });
    }
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
    if (!looksLikeApplication(form) || buttonHidden) removeButton();
    else if (ready) showButton();
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
    // A page at an address longer than any job's gets no menus: the panel has its answers.
    if (form.url.length > MOST_URL) return Promise.resolve(null);
    const asked = form;
    const job = readJobPage(document, location.href, '');
    planning = ask<{ menus: FieldMenu[] | null }>({
      type: 'job-site',
      do: 'form',
      form: { ...asked, title: asked.title.slice(0, 1000) },
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

  /**
   * Where the frame may go: the window, or in a frame of another page, the part of it that shows.
   * Null while that's unknown, and where none of it shows.
   */
  const area = (): Area | null => {
    if (!framed) return { left: 0, top: 0, width: innerWidth, height: innerHeight };
    return shown && shown.width > 0 && shown.height > 0 ? shown : null;
  };

  /** Whether a box is in the window, or the part of the frame that shows, at least in part. */
  const inView = (box: Box) => {
    const room = area();
    if (!room) return false;
    const left = room.left ?? 0;
    const top = room.top ?? 0;
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.left < left + room.width &&
      box.top < top + room.height &&
      box.left + box.width > left &&
      box.top + box.height > top
    );
  };

  /**
   * The page's own controls, and its labels and legends: in the page, and in each part of it that
   * keeps its own elements, as a component does, where the page leaves that open.
   */
  function controlElements(): Found {
    if (found) return found;
    const all: Found = { controls: [], maybe: [], labels: [] };
    const collect = (root: Document | ShadowRoot) => {
      all.controls.push(...root.querySelectorAll(CONTROLS));
      all.maybe.push(...root.querySelectorAll(MAYBE_CONTROLS));
      all.labels.push(...root.querySelectorAll('label, legend'));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const inner = (node as Element).shadowRoot;
        if (inner && !mine.has(node)) collect(inner);
      }
    };
    collect(document);
    found = all;
    return all;
  }

  /** Whether the page shows an element, see-through or not: a box you can't see may still take a click. */
  const showsIt = (element: Element) =>
    (element as HTMLElement).checkVisibility?.({ visibilityProperty: true }) !== false;

  /**
   * The page's own controls in the window, as boxes: each control, and one the page made itself,
   * as small as a control; each option's label, which picks it, whole; and the words of each other
   * label and legend, as one can be as wide as its row, around its field.
   */
  function controlBoxes(): Box[] {
    const boxes: Box[] = [];
    const { controls, maybe, labels } = controlElements();
    for (const element of controls) {
      const box = boxOf(element);
      if (inView(box) && showsIt(element)) boxes.push(box);
    }
    for (const element of maybe) {
      const box = boxOf(element);
      if (inView(box) && controlSized(box) && showsIt(element)) boxes.push(box);
    }
    const range = document.createRange();
    for (const label of labels) {
      const option =
        label.matches('label') &&
        (label.querySelector(OPTIONS) !== null ||
          (label as HTMLLabelElement).control?.matches(OPTIONS) === true);
      if (option) {
        const box = boxOf(label);
        if (inView(box) && showsIt(label)) boxes.push(box);
        continue;
      }
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
    // The page's styles can't hide it, fade it or cut it, or let a click go through it.
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
      translate: 'none',
      rotate: 'none',
      scale: 'none',
      filter: 'none',
      'backdrop-filter': 'none',
      'clip-path': 'none',
      mask: 'none',
      'mix-blend-mode': 'normal',
      'pointer-events': 'auto',
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

  /** Places the open menu beside its field again, or closes it once there's no room, or it's gone. */
  function placeOpenMenu(): void {
    if (!menu) return;
    if (!menu.host.isConnected) {
      closeMenu();
      return;
    }
    const field = fieldBox(menu.at);
    const room = area();
    const place =
      field && room && inView(field) ? placeMenu(menu.size, field, forMenu(), room) : null;
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

  /**
   * The menu's size, with answers or without, and with the offer to keep one or without, however
   * many answers it has.
   */
  const sizeFor = (answers: boolean, save: boolean): Size => ({
    width: Math.min(MENU_WIDTH, (area()?.width ?? innerWidth) - 2 * EDGE),
    height: menuHeight(answers, save),
  });

  /** Where a menu goes beside a field, or null where there's no room that covers nothing. */
  const placeFor = (at: number, size: Size) => {
    const box = fieldBox(at);
    const room = area();
    return box && room && inView(box) ? placeMenu(size, box, forMenu(), room) : null;
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
    if (stopped || !ready) return;
    const answers = at !== null ? (menus?.[at]?.answers ?? 0) : 0;
    const saveAt = pendingSave;
    const tries: Shown[] = [];
    if (at !== null && answers > 0 && saveAt !== null)
      tries.push({ at, answers: true, save: true });
    if (saveAt !== null) tries.push({ at: saveAt, answers: false, save: true });
    if (at !== null && answers > 0) tries.push({ at, answers: true, save: false });
    const fits = tries.find((each) => placeFor(each.at, sizeFor(each.answers, each.save)) !== null);
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
    const size = sizeFor(said.answers > 0, said.save);
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

  /** Whether a computed style is one that leaves a box as it is: shown, whole, and not faded. */
  const leavesIt = (style: CSSStyleDeclaration) =>
    ['', 'visible'].includes(style.visibility) &&
    (style.opacity === '' || Number(style.opacity) >= 1) &&
    ['', 'none'].includes(style.filter) &&
    ['', 'none'].includes(style.clipPath) &&
    ['', 'none'].includes(style.maskImage) &&
    ['', 'normal'].includes(style.mixBlendMode);

  /**
   * Whether the menu showed as you picked from it, as far as the page's layout says: nothing of
   * the page fades, filters or cuts it, no dialog or note the browser puts over everything lies on
   * it, nothing the page put after it lies on it, and the browser's own test of what's at its
   * middle and its corners finds it there. Where it didn't, a page could have had you click it
   * unseen, so what you picked goes nowhere.
   */
  function menuShowed(frame: Frame): boolean {
    const view = document.defaultView;
    if (!view || !frame.host.isConnected) return false;
    if (
      ![document.documentElement, frame.host].every((each) => leavesIt(view.getComputedStyle(each)))
    ) {
      return false;
    }
    // What the page draws after everything else in it, which could lie over the menu, unseen by
    // the browser's test of what's where, as it lets clicks through.
    const after = view.getComputedStyle(document.documentElement, '::after');
    if (
      !['', 'none', 'normal'].includes(after.content) &&
      !['', 'static'].includes(after.position)
    ) {
      return false;
    }
    const box = boxOf(frame.host);
    const over = (element: Element) => overlaps(boxOf(element), box);
    let onTop: Element[] = [];
    try {
      onTop = [...document.querySelectorAll(':modal, :popover-open, :fullscreen')];
    } catch {
      // A browser without one of these has none of them open.
    }
    if (onTop.some(over)) return false;
    for (let next = frame.host.nextElementSibling; next; next = next.nextElementSibling) {
      if (mine.has(next)) continue;
      if (over(next) || [...next.querySelectorAll('*')].some(over)) return false;
    }
    if (typeof document.elementFromPoint !== 'function') return true;
    return (
      [
        [0.5, 0.5],
        [0.15, 0.15],
        [0.85, 0.15],
        [0.15, 0.85],
        [0.85, 0.85],
      ].every(
        ([x = 0, y = 0]) =>
          document.elementFromPoint(box.left + box.width * x, box.top + box.height * y) ===
          frame.host,
      ) && aroundShows(box)
    );
  }

  /**
   * Whether the pages around this one, as far as they're of its own site and could read what's
   * put in its form, show the frame they hold it in at the menu's place: nothing of theirs fades
   * it, filters it or cuts it, nothing else of theirs lies there, and their own test of what's at
   * the menu's middle finds the frame. A page of another site can't see into this one, nor read
   * what's put in its form, and Chrome's own check in the extension's frame takes it in too.
   */
  function aroundShows(box: Box): boolean {
    let view: Window = window;
    let at = box;
    for (let depth = 0; depth < MOST_NESTED && view !== view.parent; depth++) {
      let holder: Element | null = null;
      try {
        holder = view.frameElement;
      } catch {
        holder = null;
      }
      // A page of another site.
      if (!holder) return true;
      const page = holder.ownerDocument;
      const outer = page.defaultView;
      if (!outer) return false;
      for (let up: Element | null = holder; up; up = up.parentElement) {
        if (!leavesIt(outer.getComputedStyle(up))) return false;
      }
      const frameBox = boxOf(holder);
      at = {
        left: frameBox.left + holder.clientLeft + at.left,
        top: frameBox.top + holder.clientTop + at.top,
        width: at.width,
        height: at.height,
      };
      const there = at;
      const lies = [...page.querySelectorAll('body *')].some(
        (other) =>
          other !== holder &&
          !other.contains(holder) &&
          showsIt(other) &&
          overlaps(boxOf(other), there),
      );
      if (lies) return false;
      if (page.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2) !== holder) {
        return false;
      }
      view = outer;
    }
    return true;
  }

  /**
   * Puts the answer you picked in its field, as typing would, and says how it went: nothing at
   * all where the menu didn't show as you picked from it.
   */
  async function write(answer: FieldAnswer): Promise<Written> {
    const at = menu?.at ?? fieldOf(elements[answer.ref]?.[0] ?? document.body);
    const showed = menu !== null && menuShowed(menu);
    closeMenu();
    if (!showed) return { filled: null };
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

  /**
   * Whether you put the cursor in an element yourself: you pressed Tab, or clicked on it, its
   * label, or a box just around it, a moment ago. Never the page's own doing, as a page putting
   * the cursor in a field as you type elsewhere.
   */
  const yours = (element: Element): boolean => {
    const now = Date.now();
    if (now - lastTab < YOURS_MS) return true;
    const { at, target } = lastPointer;
    if (now - at >= YOURS_MS || !(target instanceof Node)) return false;
    if (target === element || element.contains(target)) return true;
    let up: Element | null = element;
    for (let level = 0; level < AROUND && up; level++) {
      // A box around it, or the component it's inside, where the page leaves that open.
      up = up.parentElement ?? (up.getRootNode() as Partial<ShadowRoot>).host ?? null;
      if (up === target) return true;
    }
    const label = (target instanceof Element ? target : target.parentElement)?.closest('label');
    return label instanceof HTMLLabelElement && label.control === element;
  };

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

  /**
   * The element the cursor's in, inside a component that keeps its own elements too, where the
   * page leaves that open, as the page names the component instead.
   */
  const focused = (): Element | null => {
    let now = document.activeElement;
    while (now?.shadowRoot?.activeElement) now = now.shadowRoot.activeElement;
    return now;
  };

  /** Whether the cursor is in one of the form's fields. */
  const inAField = () => {
    const now = focused();
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
    // A page that took it away, as one that builds itself again, gets it back.
    if (!button.host.isConnected) document.documentElement.append(button.host);
    const size = button.card ? BUTTON_CARD : BUTTON;
    const room = area();
    const covered = [...controlBoxes(), ...(menu ? [boxOf(menu.host)] : [])];
    put(button, size, room ? placeButton(size, covered, room) : null);
  }

  function showButton(): void {
    if (!button) {
      button = {
        ...makeFrame(`${ext.runtime.getURL('frame.html')}#button:${doc}`, 'Factwright'),
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

  /**
   * The element an event happened at: its target, or inside a component that keeps its own
   * elements, where the page leaves that open, the element inside it, as the page hears it as the
   * component itself.
   */
  const targetOf = (event: Event): EventTarget | null => event.composedPath?.()[0] ?? event.target;

  const onPointer = (event: Event) => {
    if (!yourOwn(event)) return;
    lastPointer = { at: Date.now(), target: targetOf(event) };
  };
  const onFocusIn = (event: FocusEvent) => {
    const target = targetOf(event);
    if (!(target instanceof Element) || mine.has(target) || target === ownFocus) return;
    if (!yours(target) || (writing !== null && fieldOf(target) === writing)) return;
    void arrived(target);
  };
  const onFocusOut = (event: FocusEvent) => {
    const target = targetOf(event);
    if (!(target instanceof Element) || mine.has(target)) return;
    // On a page of an application that runs over several, the panel filling it reads what you
    // gave the field now, before the page can go on, as when you press its Save and Continue.
    if (form?.step && fieldOf(target) >= 0) void send({ type: 'job-site', do: 'look', doc });
    left(target);
    // Into the menu, it stays open; into another field, that field's menu follows; anywhere
    // else, it closes, unless it offers to keep what you gave the field you left.
    setTimeout(() => {
      if (!menu || focused() === menu.host || inAField()) return;
      if (pendingSave !== null && pendingSave === menu.at) return;
      closeMenu();
    }, 0);
  };
  const onTyped = (event: Event) => {
    const target = targetOf(event);
    if (!yourOwn(event) || !(target instanceof Element)) return;
    const field = form?.fields[fieldOf(target)];
    if (field) typed.add(field.key);
  };
  const onKey = (event: KeyboardEvent) => {
    if (!yourOwn(event)) return;
    if (event.key === 'Tab') lastTab = Date.now();
    if (!menu) return;
    if (event.key === 'Escape') {
      closeMenu();
      return;
    }
    // Down from a box of words goes into the menu, as it does in a browser's own suggestions. A
    // number's or a date's box, or one that offers its own choices, keeps the key for itself.
    const target = targetOf(event);
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
      keepFollowing();
      placeOpenMenu();
      placeTheButton();
    });
  };
  /** Places the frame again a moment after the page's look changes, as a list of its own opens. */
  const onRestyled = () => {
    if (restyled) return;
    restyled = setTimeout(() => {
      restyled = null;
      onMove();
    }, RESTYLED_MS);
  };
  /** The part of its frame that shows, in a frame of another page, as the browser follows it. */
  const showing = framed
    ? new IntersectionObserver(
        (entries) => {
          const entry = entries.at(-1);
          if (!entry) return;
          const { left, top, width, height } = entry.intersectionRect;
          shown = entry.isIntersecting ? { left, top, width, height } : null;
          onMove();
        },
        { threshold: Array.from({ length: SHOWN_STEPS + 1 }, (_, step) => step / SHOWN_STEPS) },
      )
    : null;
  /**
   * What the browser follows the part that shows by: a box as big as the frame, unseen, and never
   * in the way.
   */
  const sentinel = framed ? document.createElement('div') : null;
  if (sentinel) {
    for (const [name, value] of Object.entries({
      all: 'initial',
      position: 'fixed',
      inset: '0',
      visibility: 'hidden',
      'pointer-events': 'none',
    })) {
      sentinel.style.setProperty(name, value, 'important');
    }
    mine.add(sentinel);
  }
  /**
   * Follows the part of its frame that shows, once it may put anything on the page, and again
   * once the page took away the box it follows it by.
   */
  function keepFollowing(): void {
    if (!ready || !sentinel || !showing || sentinel.isConnected) return;
    document.documentElement.append(sentinel);
    showing.unobserve(sentinel);
    showing.observe(sentinel);
  }

  /**
   * Says hello, by its own name for the page, and the sites of the pages around it, as Chrome
   * says them, or in Firefox, which doesn't, in a frame, the address the frame was opened from,
   * where the page around it gives it, which is that page's.
   */
  const hello = () => {
    const ancestors = (location as { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    const opener = framed && document.referrer ? [document.referrer.slice(0, MOST_URL)] : [];
    const around = (ancestors ? Array.from(ancestors) : opener).slice(0, MOST_AROUND);
    return ask<{ allowed: boolean }>({ type: 'job-site', do: 'hello', doc, around });
  };
  /** The page is going: the background forgets it, unless the browser keeps it to come back to. */
  const onHide = () => {
    void send({ type: 'job-site', do: 'bye', doc });
  };
  const onShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    void hello().then((said) => {
      if (said?.allowed) void look();
      else stop();
    });
  };

  const observer = new MutationObserver((changes) => {
    const ours = (node: Node) => mine.has(node);
    // The page took away one of its frames, as a page that tidies what it doesn't know of: it
    // goes back, where it's still wanted.
    if (changes.some((change) => [...change.removedNodes].some(ours))) onMove();
    const added = changes.filter(
      (change) =>
        change.type === 'childList' &&
        !([...change.addedNodes].every(ours) && [...change.removedNodes].every(ours)),
    );
    if (changes.some((change) => change.type === 'attributes' && !ours(change.target))) {
      onRestyled();
    }
    if (added.length === 0) return;
    found = null;
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
    if (restyled) clearTimeout(restyled);
    removeButton();
    menu?.host.remove();
    menu = null;
    removeEventListener('pointerdown', onPointer, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('focusin', onFocusIn, true);
    removeEventListener('focusout', onFocusOut, true);
    removeEventListener('input', onTyped, true);
    removeEventListener('change', onTyped, true);
    removeEventListener('scroll', onMove, true);
    removeEventListener('resize', onMove);
    removeEventListener('pagehide', onHide);
    removeEventListener('pageshow', onShow);
    showing?.disconnect();
    sentinel?.remove();
    try {
      ext.runtime.onMessage.removeListener?.(onMessage);
    } catch {
      // The extension's gone already.
    }
  }

  const script: Script = { stop };
  addEventListener('pointerdown', onPointer, true);
  addEventListener('keydown', onKey, true);
  addEventListener('focusin', onFocusIn, true);
  addEventListener('focusout', onFocusOut, true);
  addEventListener('input', onTyped, true);
  addEventListener('change', onTyped, true);
  addEventListener('scroll', onMove, { capture: true, passive: true });
  addEventListener('resize', onMove, { passive: true });
  addEventListener('pagehide', onHide);
  addEventListener('pageshow', onShow);
  ext.runtime.onMessage.addListener(onMessage);
  // The whole document, as a page may put another in place of its own root as it builds itself.
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-expanded', 'aria-hidden'],
  });
  const loaded = new Promise<void>((resolve) => {
    if (document.readyState === 'complete') resolve();
    else addEventListener('load', () => resolve(), { once: true });
  });
  void hello().then(async (said) => {
    if (!said?.allowed) {
      stop();
      return;
    }
    void look();
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, readyMs));
    if (stopped) return;
    ready = true;
    keepFollowing();
    await look();
  });
  return script;
}
