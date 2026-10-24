/** How a field takes its answer. */
export type FieldControl =
  /** One line of text, an email address, a phone number or a link. */
  | 'text'
  /** A box for paragraphs. */
  | 'long'
  | 'number'
  | 'date'
  /** One of a list: a select, or radio buttons. */
  | 'choice'
  /** Any of a list: checkboxes, or a select that takes several. */
  | 'choices'
  /** One checkbox, such as "I agree". */
  | 'check'
  /** A box that offers choices as you type, whose list shows only once it's open. */
  | 'combo'
  | 'file';

/** A field on an application form, as the extension read it from the page. */
export interface PageField {
  /** Its place among the fields read, to find it again. */
  ref: number;
  /**
   * What says which field it is: its tag, type, id, name and question. Filling checks the field
   * at its place still has it, as a page can add and take away fields as you go.
   */
  key: string;
  /** What it asks, as the page puts it: its label, or the words just before it. */
  question: string;
  /** What the page says under or around it, such as "500 characters max". */
  hint: string;
  /**
   * The part of the form it's in, as the page names it, such as "Work experience" or "Education
   * 2", or "" when the page doesn't say.
   */
  section: string;
  control: FieldControl;
  /** Its own type, as an input has one, such as "email" or "tel". */
  type: string;
  /** What the page says the browser may fill it with, such as "given-name". */
  autocomplete: string;
  /** Its name and id, which often say what it's for, such as "first_name" or "urls[LinkedIn]". */
  name: string;
  /** For a choice: the options, as the page shows them. A combo's show only once it's open. */
  options: string[];
  required: boolean;
  /** The most characters it takes, when the page says. */
  limit: number | null;
}

/** An application form, as read from the page. */
export interface PageForm {
  /** The page's address, as it is. */
  url: string;
  /** The page's title in the browser's tab. */
  title: string;
  fields: PageField[];
  /** Whether the page says an application went in, such as "Thank you for applying". */
  submitted: boolean;
  /**
   * The page of an application that runs over several in one tab, as Workday's does, by the name
   * its steps give it, such as "My Experience", or "" for a form on one page.
   */
  step: string;
  /**
   * The form's buttons that add a part to it, such as another job's, as Workday's Add does: each
   * by the part of the form it's in, and its words.
   */
  adders: PageAdder[];
}

/** A button that adds a part to a form, as another job's or another school's. */
export interface PageAdder {
  /** The part of the form it adds to, as a field's section names it, such as "Work Experience". */
  section: string;
  /** What it says, such as "Add Another". */
  words: string;
}

/** What to put in a field. */
export interface FieldAnswer {
  ref: number;
  key: string;
  /** Text to type. */
  text?: string;
  /** For a choice: the options to pick, best first, by their words. */
  pick?: string[];
  /** Pick only an option with these words exactly, as for an answer given to another form. */
  exact?: boolean;
  /**
   * A place, as a city: a box that offers places from the site's own server gets each pick, or
   * its city alone, typed in, and the place it offers whose words start the same and say the rest
   * in order, as "Denver, Colorado, United States" for "Denver, Colorado".
   */
  place?: boolean;
  /** For a file field: the file, as base64. */
  file?: { name: string; type: string; base64: string };
  /**
   * Only where the field is empty, as on a form of several pages, which its site may have filled
   * from your resume, as Workday does: what's there stays as it is.
   */
  ifEmpty?: boolean;
  /**
   * The part of the form for a job or school it's in, by its heading, and whether it names that
   * job or school, as a title, a company or a school's name does. A part that holds another one,
   * as a site filled it in from your resume in its own order, keeps its empty fields empty: none
   * of the fields that name it agrees with the answers.
   */
  part?: string;
  names?: boolean;
}

/** How filling one field went: whether it took, and what it shows now. */
export interface FieldFilled {
  ref: number;
  ok: boolean;
  /** What the field holds now, as the page shows it: the text, or the option picked. */
  shown: string;
  /**
   * Why it didn't take: the field wasn't there anymore, none of its options was the answer, the
   * page didn't keep what was put in it, its part holds another job or school (`part`), or the
   * page's own code sends the page away as it changes, as Taleo's do some lists and iCIMS's its
   * resume box, which would stop filling midway, so it's left for you (`reloads`).
   */
  why: '' | 'moved' | 'no-option' | 'not-taken' | 'other-part' | 'reloads';
  /** Whether it held an answer already, which it left as it was (`ifEmpty`). */
  kept?: boolean;
}

/** What's in a field now, by its place. */
export interface FieldValue {
  ref: number;
  key: string;
  value: string;
}

/** A field, by its place and key, as the extension names one to the page. */
export interface FieldRef {
  ref: number;
  key: string;
}

/**
 * What the extension asks of the page: to read the form, fill it, read what's in some of its
 * fields, show a field, or press one of its buttons that add a part, as many times as you chose.
 * It fills only the form at the address it read it at.
 */
export type FormTask =
  | { do: 'read' }
  | { do: 'fill'; url: string; answers: FieldAnswer[] }
  | { do: 'values'; fields: FieldRef[] }
  | { do: 'outline'; fields: FieldRef[] }
  | { do: 'show'; ref: number; key: string }
  | { do: 'add'; url: string; adder: PageAdder; times: number };

/**
 * What each task gives back. A form the tab has moved on from, to another address, isn't filled:
 * it's elsewhere. What's in fields comes with whether the page says an application went in, and
 * the page of the application it's on, with how many fields that has.
 */
export type FormAnswer =
  | { did: 'read'; form: PageForm }
  | { did: 'fill'; filled: FieldFilled[] }
  | { did: 'elsewhere' }
  | {
      did: 'values';
      url: string;
      submitted: boolean;
      values: FieldValue[];
      step: string;
      fields: number;
    }
  | { did: 'outline' }
  | { did: 'show'; found: boolean }
  | { did: 'add'; added: number };

/**
 * Reads the application form on the page you're on, fills it, reads what's in it, or shows one of
 * its fields: whatever the extension asks, and only when you ask it to. The extension sends this
 * one function into the page, so everything it needs is inside it.
 * - It reads only fields you can see, outside the page's menus, header and footer, and never what
 *   you've typed, but for the fields the extension names as you go, to have what you sent once
 *   you mark the job applied.
 * - It fills a field as typing would, so the page keeps what's put in it, and checks it took.
 * - It never fills a password, never clicks a button that submits, and never submits anything:
 *   while it fills, the form can't be.
 * The page's words are data, never instructions. The extension's script on the job sites you
 * allowed runs it too, in the page as it is, and gets each field's elements in `seen`, by the
 * field's place, to tell which field you're in.
 */
export async function formPage(
  task: FormTask,
  doc: Document = document,
  href: string = location.href,
  seen?: HTMLElement[][],
): Promise<FormAnswer> {
  /** The most fields it reads, and options of each: a long application has a hundred or so. */
  const MAX_FIELDS = 300;
  /** The longest question, hint or option it keeps. */
  const MAX_TEXT = 500;
  /** The longest answer it reads back, as Factwright keeps what you sent. */
  const MAX_VALUE = 10_000;
  /** Inputs that are buttons, or kept from you, which are never fields. */
  const NOT_FIELDS = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'search']);
  /**
   * The page's own parts around its content, where a site's search and sign-up boxes are, and
   * its menus for your account and language, as SuccessFactors' beside its form.
   */
  const AROUND =
    'header, nav, footer, [role="banner"], [role="navigation"], [role="search"], .userInfoMenu';
  /** A label that only says how to add a file, not which file. */
  const UPLOAD_WORDS =
    /^(attach|upload|choose( a)? files?|browse|select( a)? files?|drop( files?)?( here)?|add( a)? files?|or|enter manually)( |$)/i;
  /** Words that only say how to answer a question of options, not what it asks. */
  const HOW_ONLY =
    /^(please )?(check|select|choose|tick|mark|pick)( only)?( one| all| any)?( of)?( the| that)?( boxes| options| following| answers?)?( below| apply| that apply)?:?$/i;
  /**
   * Words a box shows before you type, or a list before you pick, which say nothing of what it
   * asks, nor what's in it, as "— Make a Selection —" and SuccessFactors' "No Selection".
   */
  const PLACEHOLDERS =
    /^[-–—\s]*(type here|select|choose|start typing|please select|please choose|search|enter|write here|make a selection|no selection|type to search)\b|\.\.\.$|…$|^[-–—]+$/i;
  /** What a page says once an application went in. */
  const SUBMITTED =
    /thank(s| you) for (applying|your application|submitting)|application (has been |was )?(submitted|received|sent)|we(’|')?ve received your application|we have received your application|you(’|')?ve (successfully )?applied|your application is (in|complete)|\bview my submissions\b/i;
  /** Orange, as the app marks what needs you. */
  const ORANGE = '#e8590c';
  /**
   * How long a list that comes as you type may take to show, from the site's own server: a list
   * of places the longest. A list that's shown its options without the one, or said it found
   * none, for this long, has settled.
   */
  const LIST_MS = 3000;
  const PLACE_MS = 5000;
  const SETTLED_MS = 700;

  const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
  const cut = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

  /** Whether the page has layout, as a browser's does, and a test's page doesn't. */
  const laidOut =
    typeof (doc.documentElement as HTMLElement & { checkVisibility?: unknown }).checkVisibility ===
    'function';

  // A page can be built of components that keep their own elements, each in a part of the page of
  // its own, a shadow root, as SmartRecruiters' newer form's fields are. What's inside one the
  // page leaves open counts as the page's, where the component is, so a field inside one is read
  // as a field, by the words around it inside and out. A page with none is read as it always was.

  /** The component whose insides an element is in, or null for the page's own. */
  const hostOf = (node: Node): Element | null => {
    const root = node.getRootNode();
    return root.nodeType === 11 ? ((root as ShadowRoot).host ?? null) : null;
  };

  /** Whether the page has a component it leaves open, with anything inside. */
  const components = (() => {
    const walker = doc.createTreeWalker(doc, 1);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node as Element).shadowRoot) return true;
    }
    return false;
  })();

  /** The element around one: its parent, or for the top of a component's insides, the component. */
  const upOf = (element: Element): Element | null => element.parentElement ?? hostOf(element);

  /** The nearest element around one that matches, itself first, inside components and out. */
  const closestOf = (element: Element, selector: string): Element | null => {
    for (let at: Element | null = element; at; at = hostOf(at)) {
      const found = at.closest(selector);
      if (found) return found;
    }
    return null;
  };

  /** The nearest element around one that matches, not itself, inside components and out. */
  const aroundOf = (element: Element, selector: string): Element | null => {
    const up = upOf(element);
    return up ? closestOf(up, selector) : null;
  };

  /** Whether an element is, or is inside, another, inside components and out. */
  const within = (box: Element, element: Element): boolean => {
    if (!components) return box.contains(element);
    for (let at: Element | null = element; at; at = upOf(at)) {
      if (at === box) return true;
    }
    return false;
  };

  /**
   * The element with an ID, in the same part of the page as an element, or else in the parts
   * around it, as a component may name its list, which the component around it keeps.
   */
  const byId = (element: Node, id: string): Element | null => {
    for (let at: Node | null = element; at; at = hostOf(at)) {
      const root = at.getRootNode() as Document | ShadowRoot;
      const found =
        typeof root.getElementById === 'function'
          ? root.getElementById(id)
          : doc.getElementById(id);
      if (found) return found;
    }
    return null;
  };

  /**
   * The elements an element shows inside it, as the page lays them out: a component's insides,
   * with what the page put in it where its slots are, or else its own children.
   */
  const shownElements = (element: ParentNode): Element[] => {
    const inside = (element as Element).shadowRoot;
    if (inside) return [...inside.children];
    if ((element as Element).tagName === 'SLOT') {
      const slotted = (element as HTMLSlotElement).assignedElements({ flatten: true });
      if (slotted.length > 0) return slotted;
    }
    return [...element.children];
  };

  /**
   * The elements that match, in the page or in an element, inside the components in it that the
   * page leaves open too, in the order the page shows them: a component's insides where it is,
   * with what's put in its slots where they are.
   */
  const everyOf = <T extends Element = Element>(selector: string, from: ParentNode = doc): T[] => {
    if (!components) return [...from.querySelectorAll<T>(selector)];
    const found: T[] = [];
    const walk = (parent: ParentNode) => {
      for (const each of shownElements(parent)) {
        if (each.matches(selector)) found.push(each as T);
        walk(each);
      }
    };
    walk(from);
    return found;
  };

  /** Whether an element holds one that matches, inside components and out. */
  const holds = (box: Element, selector: string): boolean =>
    box.querySelector(selector) !== null || (components && everyOf(selector, box).length > 0);

  /** An element, and each component it's inside, the nearest first. */
  const hostsOf = (element: Element): Element[] => {
    const all = [element];
    for (let host = hostOf(element); host; host = hostOf(host)) all.push(host);
    return all;
  };

  /**
   * Whether an element comes after another in the page, inside components and out: as they are,
   * in the same part of the page, or else as the components they're inside are, where those are in
   * the same part. Inside a component is after the component itself.
   */
  const comesAfter = (before: Element, element: Element): boolean => {
    const theirs = hostsOf(element);
    for (const one of hostsOf(before)) {
      const root = one.getRootNode();
      const two = theirs.find((each) => each.getRootNode() === root);
      if (!two) continue;
      if (one === two) return one === before;
      return Boolean(one.compareDocumentPosition(two) & FOLLOWS);
    }
    return false;
  };

  /**
   * Whether an element is shown: not hidden, see-through, or kept from you and your screen reader,
   * as what's around a dialog is while it's open. The browser says, where it can. In a page
   * without layout, as in a test, what hides it is an attribute or style on it or around it.
   */
  const shown = (element: Element): boolean => {
    if (closestOf(element, '[aria-hidden="true"], [inert]')) return false;
    if (laidOut) {
      return (element as HTMLElement).checkVisibility({
        visibilityProperty: true,
        opacityProperty: true,
        contentVisibilityAuto: true,
        checkVisibilityCSS: true,
        checkOpacity: true,
      } as CheckVisibilityOptions);
    }
    for (let up: Element | null = element; up; up = upOf(up)) {
      if (up.hasAttribute('hidden')) return false;
      const style = (up as HTMLElement).style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      if (style && style.opacity !== '' && Number(style.opacity) === 0) return false;
    }
    return true;
  };

  /** Whether a box's clip, as one placed absolutely may have, cuts all of it away. */
  const clipsAll = (style: CSSStyleDeclaration): boolean => {
    const sides = /^rect\((.*)\)$/
      .exec(style.getPropertyValue('clip'))?.[1]
      ?.split(/[\s,]+/)
      .map((side) => (side === 'auto' ? null : Number.parseFloat(side)));
    if (sides?.length !== 4) return false;
    const [top = null, right = null, bottom = null, left = null] = sides;
    return (
      (right !== null && left !== null && right <= left) ||
      (bottom !== null && top !== null && bottom <= top)
    );
  };

  /**
   * Whether an element has room on the page: a box of some size, not put off the page, and not
   * cut away by a box around it that hides what overflows it, or by a clip, as a page hides a box
   * that's a trap for bots. A box that scrolls holds all it scrolls through, and one placed
   * absolutely is cut away only by the box it's placed in and those around that.
   */
  const hasRoom = (element: Element): boolean => {
    const view = doc.defaultView;
    if (!laidOut || !view) return true;
    let { left, top, right, bottom } = element.getBoundingClientRect();
    const roomy = () => right - left >= 2 && bottom - top >= 2;
    if (!roomy()) return false;
    const own = view.getComputedStyle(element);
    if (clipsAll(own)) return false;
    let placed = own.position;
    for (let up = upOf(element); up && up !== doc.body; up = upOf(up)) {
      if (placed === 'fixed') break;
      const style = view.getComputedStyle(up);
      if (placed === 'absolute' && style.position === 'static') continue;
      if (clipsAll(style)) return false;
      placed = style.position;
      const box = up.getBoundingClientRect();
      if (style.overflowX !== 'visible') {
        const scrolls = style.overflowX === 'auto' || style.overflowX === 'scroll';
        const from = scrolls ? box.left - up.scrollLeft : box.left;
        left = Math.max(left, from);
        right = Math.min(right, scrolls ? from + up.scrollWidth : box.right);
      }
      if (style.overflowY !== 'visible') {
        const scrolls = style.overflowY === 'auto' || style.overflowY === 'scroll';
        const from = scrolls ? box.top - up.scrollTop : box.top;
        top = Math.max(top, from);
        bottom = Math.min(bottom, scrolls ? from + up.scrollHeight : box.bottom);
      }
      if (!roomy()) return false;
    }
    // The page starts at its top left corner: a box put above it or left of it is off it.
    return right > -view.scrollX && bottom > -view.scrollY;
  };

  /** Whether you can see an element: shown, with room on the page. */
  const visible = (element: Element): boolean => shown(element) && hasRoom(element);

  /**
   * What shows inside an element: its children, or for a component, its insides, with what the
   * page put in it where its slots are.
   */
  const shownChildren = (element: Element): Node[] => {
    if (components && element.shadowRoot) return [...element.shadowRoot.childNodes];
    if (components && element.tagName === 'SLOT') {
      const slotted = (element as HTMLSlotElement).assignedNodes({ flatten: true });
      if (slotted.length > 0) return slotted;
    }
    return [...element.childNodes];
  };

  /**
   * An element's words, without the controls, options, tooltips and scripts inside it. A heading's
   * words are its button's too, as a section that opens and closes names itself with one, as
   * SuccessFactors' do, and so are a button's own.
   */
  const wordsOf = (element: Element | null): string => {
    if (!element) return '';
    let text = '';
    const buttons = element.matches('h1, h2, h3, h4, h5, h6, [role="heading"], button');
    const skips = buttons
      ? /^(INPUT|SELECT|TEXTAREA|OPTION|SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/
      : /^(INPUT|SELECT|TEXTAREA|OPTION|SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|BUTTON)$/;
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? '';
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const each = node as Element;
      const tag = each.tagName;
      if (skips.test(tag)) return;
      if (each !== element && each.matches('[role="listbox"], [role="option"], [role="tooltip"]')) {
        return;
      }
      // Words the page hides, such as a status it shows only after an upload, aren't the label's.
      if (each !== element && each.hasAttribute('hidden')) return;
      if (each !== element && typeof (each as HTMLElement).checkVisibility === 'function') {
        if (!(each as HTMLElement).checkVisibility()) return;
      }
      if (/^(P|DIV|LI|BR|H[1-6]|LABEL|LEGEND)$/.test(tag)) text += ' ';
      for (const child of shownChildren(each)) walk(child);
      if (/^(P|DIV|LI|H[1-6]|LABEL|LEGEND)$/.test(tag)) text += ' ';
    };
    walk(element);
    return squash(text);
  };

  /**
   * The words an element shows: its own text, or what a component shows through its slots, as
   * SmartRecruiters' options show theirs, whose own text is none.
   */
  const textOf = (element: Element): string =>
    squash(element.textContent ?? '') || (components ? wordsOf(element) : '');

  /**
   * A question without what only marks it as required: "Email *" is "Email", and "*First Name:",
   * as SuccessFactors puts its mark first, "First Name:". A label that runs on after its mark, as
   * "Resume/CV ✱ Attach resume/CV" does, ends at the mark.
   */
  const cleanQuestion = (text: string) => {
    // A page's words are cut short first, so no label, however long, can slow what follows.
    const words = squash(text)
      .slice(0, MAX_TEXT * 2)
      .replace(/^[*✱]+\s*/, '');
    const [before = ''] = words.split(/\s*[*✱]+(?:\s|$)/);
    return (before.trim() || words)
      .replace(/\s*[*✱]+\s*$/, '')
      .replace(/\s*\((required|optional)\)\s*$/i, '')
      .replace(/\s+required$/i, '')
      .trim();
  };

  /** Whether the words around a field mark it as one you must answer, before or after. */
  const marksRequired = (text: string) =>
    /^\s*[*✱]|[*✱]\s*$|\(required\)\s*$/i.test(squash(text).slice(-MAX_TEXT));

  /** Elements named in an attribute such as aria-labelledby, by their IDs. */
  const named = (element: Element, attribute: string): Element[] =>
    (element.getAttribute(attribute) ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => byId(element, id))
      .filter((each): each is HTMLElement => each !== null && each !== element);

  /** Whether a control is a button that opens a list to pick from, as Workday's dropdowns are. */
  const opensList = (control: Element): boolean =>
    control.getAttribute('aria-haspopup') === 'listbox' &&
    control.matches('button, [role="button"]');

  /**
   * Whether a control is a box a page made of its own that shows the option picked and opens a
   * list, as iCIMS's dropdowns are a link beside the list they keep hidden: a combobox that isn't
   * a box to type in.
   */
  const pickBox = (control: Element): boolean =>
    control.getAttribute('role') === 'combobox' &&
    !/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName);

  /**
   * Whether an element is a radio button a page made of its own, with no input of its own, as
   * SmartRecruiters' components and SuccessFactors' radios are: one with that role.
   */
  const ownRadio = (element: Element): boolean =>
    element.getAttribute('role') === 'radio' && element.tagName !== 'INPUT';

  /** Whether a box to tick, or a radio button, is ticked, as an input says, or a page's own. */
  const ticked = (element: Element): boolean =>
    (element as HTMLInputElement).checked === true ||
    element.getAttribute('aria-checked') === 'true';

  /**
   * The nearest element around one that matches, as the page shows it: through the slot a
   * component puts it in, as SmartRecruiters' radio buttons show inside their group's set.
   */
  const shownAround = (element: Element, selector: string): Element | null => {
    for (let at = element.assignedSlot ?? upOf(element); at; at = at.assignedSlot ?? upOf(at)) {
      if (at.matches(selector)) return at;
    }
    return null;
  };

  /**
   * Whether a control's own code sends the page away as it changes, as some of Taleo's lists post
   * the page, and iCIMS's resume box sends the form to read the resume into it: a field filling
   * would stop midway at, so it's left for you.
   */
  const sendsPage = (control: Element): boolean =>
    /\b(cmdSubmit|submit|__doPostBack|icims_setFileFieldValue)\s*\(/.test(
      `${control.getAttribute('onchange') ?? ''} ${control.getAttribute('onclick') ?? ''}`,
    );

  /**
   * Words that say a box takes a whole date, its day too, as "MM/DD/YYYY", "dd.MM.yyyy" or
   * "YYYY-MM-DD" do: three parts, a day, a month and a year.
   */
  const WHOLE_DATE =
    /^(?=.*\b(d{1,2}|t{1,2})\b)(?=.*\bm{1,2}\b)(?=.*\b(y{2,4}|j{2,4}|a{2,4})\b)[dmytja]+([./\- ][dmytja]+){2}$/i;

  /**
   * Whether a box of words takes a whole date, as its placeholder says, or the component it's in,
   * as SuccessFactors' calendars say "MM/DD/YYYY": a day, which a job's dates never have.
   */
  const takesDay = (control: Element): boolean =>
    (components ? hostsOf(control) : [control]).some((each) =>
      ['placeholder', 'format-pattern'].some((name) =>
        WHOLE_DATE.test(squash(each.getAttribute(name) ?? '')),
      ),
    );

  /**
   * Whether a box is one of Workday's lists you search, which looks up what's typed once you press
   * Enter, and keeps what you pick as a pill beside it: its own widget's box, which Workday names
   * "selectinput", or the box in its container, which names it "searchBox" only while it's open.
   */
  const searches = (control: Element): boolean =>
    control.matches(
      'input[data-uxi-widget-type="selectinput"], input[data-automation-id="searchBox"], [data-automation-id="multiselectInputContainer"] input',
    );

  /**
   * What a button that opens a list says it asks, without the option it shows and "Required",
   * which Workday's dropdowns add to their names, as iCIMS's do theirs: "Country/Region United
   * States of America Required" asks "Country/Region", and " Select One Required" nothing.
   */
  const askedBy = (button: Element): string => {
    const showing = squash(button.textContent ?? '');
    let words = squash(button.getAttribute('aria-label') ?? '').replace(/\s*\brequired$/i, '');
    if (showing && words.endsWith(showing)) words = words.slice(0, -showing.length);
    return words.trim();
  };

  /**
   * The labels that name a control: those for its ID, and the one it's inside, or for a control
   * inside a component, those for the component's.
   */
  const labelsOf = (control: Element): HTMLLabelElement[] => {
    const found: HTMLLabelElement[] = [];
    for (const each of components ? hostsOf(control) : [control]) {
      const id = each.getAttribute('id');
      if (!id) continue;
      const root = each.getRootNode() as Document | ShadowRoot;
      for (const label of root.querySelectorAll('label[for]')) {
        if (label.getAttribute('for') === id) found.push(label as HTMLLabelElement);
      }
    }
    const around = closestOf(control, 'label');
    if (around && !found.includes(around as HTMLLabelElement)) {
      found.push(around as HTMLLabelElement);
    }
    return found;
  };

  /** The words in a label before its control: a label can hold the control and more after it. */
  const wordsBefore = (label: Element, control: Element): string => {
    let text = '';
    let reached = false;
    const walk = (node: Node) => {
      if (reached) return;
      if (
        node === control ||
        (node.nodeType === Node.ELEMENT_NODE &&
          (node as Element).contains(control) === false &&
          /^(INPUT|SELECT|TEXTAREA)$/.test((node as Element).tagName))
      ) {
        if (node === control) reached = true;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? '';
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const each = node as Element;
      if (/^(SCRIPT|STYLE|SVG|BUTTON|OPTION)$/.test(each.tagName)) return;
      if (each !== label && each.hasAttribute('hidden')) return;
      if (/^(P|DIV|LI|BR|H[1-6]|SPAN)$/.test(each.tagName)) text += ' ';
      for (const child of each.childNodes) walk(child);
    };
    walk(label);
    return squash(text);
  };

  /**
   * The nearest words before an element, as a form puts its question above its box: the closest
   * earlier sibling with words and no other field in it, of the element or one of the few around
   * it.
   */
  const wordsAbove = (element: Element): string => {
    let up: Element | null = element;
    for (let level = 0; level < 5 && up && up !== doc.body; level++) {
      for (let before = up.previousElementSibling; before; before = before.previousElementSibling) {
        if (!shown(before)) continue;
        if (before.matches('input, select, textarea')) return '';
        if (holds(before, 'input:not([type="hidden"]), select, textarea')) return '';
        const words = wordsOf(before);
        // A button's own label, such as "Attach", says how, not what: the question is further up.
        if (words && !UPLOAD_WORDS.test(words)) return words.length > MAX_TEXT ? '' : words;
      }
      up = upOf(up);
    }
    return '';
  };

  /** The words a group of fields is named by: its legend, or what names its role. */
  const groupWords = (group: Element | null): string => {
    if (!group) return '';
    if (group.tagName === 'FIELDSET') {
      const legend = wordsOf(group.querySelector('legend'));
      if (legend) return legend;
    }
    const byIds = named(group, 'aria-labelledby')
      .map((each) => wordsOf(each))
      .join(' ');
    return squash(byIds || group.getAttribute('aria-label') || '');
  };

  /**
   * The legend of the nearest set around a control that has one: a set of boxes may be inside
   * another, as Workday's are, whose legend asks the question.
   */
  const legendOf = (control: Element): string => {
    for (let set = closestOf(control, 'fieldset'); set; set = aroundOf(set, 'fieldset')) {
      const legend = [...set.children].find((child) => child.tagName === 'LEGEND');
      if (legend) return wordsOf(legend);
    }
    return '';
  };

  /**
   * What a part of a date is the part of, as "From" for its Month: the legend of the set it's in,
   * or else the name of the nearest set around it that has one. Workday's names its date's own box
   * by what it holds now, so a legend comes first.
   */
  const datePartOf = (control: Element): string => {
    const legend = legendOf(control);
    if (legend) return legend;
    const SET = 'fieldset, [role="group"]';
    for (let set = closestOf(control, SET); set; set = aroundOf(set, SET)) {
      const words = groupWords(set);
      if (words) return words;
    }
    return '';
  };

  /** The longest name of a part of the form: one longer is a sentence, not a name. */
  const MAX_SECTION = 120;
  /** What a part of the form holds, as fields. */
  const CONTROLS =
    'input:not([type="hidden"]), select, textarea, [role="combobox"]:not(input), [contenteditable="true"][role="textbox"], button[aria-haspopup="listbox"], [role="button"][aria-haspopup="listbox"]';
  /** Node.DOCUMENT_POSITION_FOLLOWING: what compareDocumentPosition says of an element after. */
  const FOLLOWS = 4;

  /**
   * The page's headings, in its order, each with the box it names: the nearest one around it
   * that holds fields. A heading in a label or legend is a question's, not a part's.
   */
  let headings: { heading: Element; words: string; names: Element }[] | null = null;
  const headingsOf = () => {
    headings ??= everyOf('h1, h2, h3, h4, h5, h6, [role="heading"]').flatMap((heading) => {
      if (closestOf(heading, `${AROUND}, label, legend`) || !shown(heading)) return [];
      const words = wordsOf(heading);
      let names = upOf(heading);
      while (names && !holds(names, CONTROLS)) names = upOf(names);
      return words && words.length <= MAX_SECTION && names ? [{ heading, words, names }] : [];
    });
    return headings;
  };

  /**
   * The nearest heading before an element whose box holds it, but for one that only repeats its
   * question.
   */
  const headingAbove = (element: Element, question = '') => {
    let heading: { words: string; names: Element } | null = null;
    for (const each of headingsOf()) {
      if (!comesAfter(each.heading, element)) break;
      if (within(each.names, element) && each.words !== question) heading = each;
    }
    return heading;
  };

  /** The words of the nearest heading before an element whose box holds it. */
  const headingOver = (element: Element) => headingAbove(element)?.words ?? '';

  /** A set of fields, which may name a part of the form, or a question. */
  const SETS = 'fieldset, [role="group"], [role="region"]';

  /**
   * The part of the form a field is in, as the page names it, such as "Work experience" or
   * "Education 2": the nearest heading before it, in the box the heading names, and the name of
   * the nearest set of fields around it that holds others, the outer first, as "Work experience ›
   * Position 1". A set that holds only a few, such as a date's month and year, names a question,
   * not a part.
   */
  const sectionOf = (members: HTMLElement[], question: string): string => {
    const [first] = members;
    if (!first) return '';
    const heading = headingAbove(first, question);
    let set = aroundOf(first, SETS);
    let named = '';
    for (; set; set = aroundOf(set, SETS)) {
      const others = everyOf<HTMLElement>(CONTROLS, set).filter((each) => !members.includes(each));
      named = others.length >= 3 ? groupWords(set) : '';
      if (named && named.length <= MAX_SECTION) break;
      named = '';
    }
    const names =
      !heading || !set
        ? [heading?.words ?? '', named]
        : within(heading.names, set)
          ? [heading.words, named]
          : [named, heading.words];
    return [...new Set(names.filter(Boolean))].join(' › ');
  };

  /** What a control asks, and whether its words mark it as required. */
  const questionOf = (control: Element): { question: string; raw: string } => {
    const tried: string[] = [];
    const take = (text: string) => {
      const words = squash(text);
      if (words) tried.push(words);
      return words;
    };
    const byIds = named(control, 'aria-labelledby')
      .map((each) => wordsOf(each))
      .join(' ');
    if (take(byIds) && !UPLOAD_WORDS.test(byIds))
      return { question: cleanQuestion(byIds), raw: byIds };
    for (const label of labelsOf(control)) {
      const words = within(label, control)
        ? wordsBefore(label, control) || wordsOf(label)
        : wordsOf(label);
      if (take(words) && !UPLOAD_WORDS.test(words))
        return { question: cleanQuestion(words), raw: words };
    }
    const aria =
      opensList(control) || pickBox(control)
        ? askedBy(control)
        : (control.getAttribute('aria-label') ?? '');
    if (take(aria) && !UPLOAD_WORDS.test(aria)) return { question: cleanQuestion(aria), raw: aria };
    // A component may name what its field asks itself.
    for (const host of components ? hostsOf(control).slice(1) : []) {
      const said = host.getAttribute('aria-label') ?? '';
      if (take(said) && !UPLOAD_WORDS.test(said)) {
        return { question: cleanQuestion(said), raw: said };
      }
    }
    // A file field's own label often only says how to add one: the question is the group's.
    const group = groupWords(closestOf(control, '[role="group"], [role="radiogroup"], fieldset'));
    if (take(group) && !UPLOAD_WORDS.test(group))
      return { question: cleanQuestion(group), raw: group };
    const above = wordsAbove(closestOf(control, 'label') ?? control);
    if (take(above) && !UPLOAD_WORDS.test(above))
      return { question: cleanQuestion(above), raw: above };
    const placeholder = control.getAttribute('placeholder') ?? '';
    if (placeholder && !PLACEHOLDERS.test(placeholder.trim())) {
      return { question: cleanQuestion(placeholder), raw: placeholder };
    }
    const first = tried[0] ?? '';
    return { question: cleanQuestion(first), raw: first };
  };

  /** What a page says about a field, beside its question: what it's for, or its limits. */
  const hintOf = (control: Element, question: string): string => {
    const described = named(control, 'aria-describedby')
      .map((each) => wordsOf(each))
      // Words that only say what a box holds now, as Workday's date boxes and lists you search
      // say it, aren't a hint.
      .filter(
        (words) =>
          words &&
          !PLACEHOLDERS.test(words) &&
          !/^(current value is\b|(\d+|no) items? selected\b|expanded$)/i.test(words),
      )
      .join(' ');
    if (described) return cut(described);
    // Words between a field's label and the field, as a form puts what it's for under its label.
    const [label] = labelsOf(control);
    if (label && !within(label, control)) {
      let between = '';
      for (let next = label.nextElementSibling; next; next = next.nextElementSibling) {
        if (within(next, control) || next.matches('input, select, textarea')) break;
        if (shown(next)) between += ` ${wordsOf(next)}`;
      }
      const words = squash(between);
      if (words && words !== question && !PLACEHOLDERS.test(words)) return cut(words);
    }
    return '';
  };

  /** The most characters a field takes: its own limit, or the one its words give. */
  const limitOf = (control: Element, words: string): number | null => {
    const max = Number(control.getAttribute('maxlength'));
    if (Number.isInteger(max) && max > 0 && max < 1_000_000) return max;
    const said =
      /(\d[\d,]*)\s*(?:characters|chars)\b|max(?:imum)?\.?(?: of)?\s*(\d[\d,]*)\s*char/i.exec(
        words.slice(0, MAX_TEXT * 2),
      );
    const count = said ? Number((said[1] ?? said[2] ?? '').replace(/,/g, '')) : NaN;
    return Number.isInteger(count) && count > 0 ? count : null;
  };

  /** The words of an option of a radio button or checkbox: its label, or the words beside it. */
  const optionWords = (control: Element): string => {
    // A button that stays pressed, as Ashby's Yes and No, says its own.
    if (control.matches('button')) return cut(squash(control.textContent ?? ''));
    for (const label of labelsOf(control)) {
      const words = wordsOf(label);
      if (words) return cut(words);
    }
    // What names it, as a component's box names itself by its label's ID, or its own words.
    const labelled = squash(named(control, 'aria-labelledby').map(wordsOf).join(' '));
    if (labelled) return cut(labelled);
    const own = squash(control.getAttribute('aria-label') ?? control.getAttribute('label') ?? '');
    if (own) return cut(own);
    // A page's own radio button says its words itself, inside it.
    if (ownRadio(control)) return cut(wordsOf(control));
    // The words beside it, then its value, which may be a code, as iCIMS's forms' radios have.
    const next = squash(control.nextSibling?.textContent ?? '');
    if (next) return cut(next);
    const value = control.getAttribute('value') ?? '';
    return value && value !== 'on' ? cut(squash(value)) : '';
  };

  /** A select's options, as it shows them, without one that only says to pick. */
  const selectOptions = (select: HTMLSelectElement): string[] =>
    [...select.options]
      .filter((option) => !option.disabled || option.selected)
      .map((option) => squash(option.text))
      .filter(
        (text, at, all) =>
          text && !(at === 0 && PLACEHOLDERS.test(text)) && all.indexOf(text) === at,
      )
      .slice(0, MAX_FIELDS)
      .map(cut);

  /** The fields a box around a control holds besides it, but for those kept from you. */
  const holdsOther = (box: Element, control: Element) =>
    everyOf('input:not([type="hidden"]):not([aria-hidden="true"]), select, textarea', box).some(
      (each) => each !== control,
    );

  /** The boxes around a control that hold no other field, the nearest first, a few at most. */
  const ownBoxes = (control: Element): Element[] => {
    const boxes: Element[] = [];
    for (
      let up = upOf(control), level = 0;
      up && up !== doc.body && level < 6 && !holdsOther(up, control);
      up = upOf(up), level++
    ) {
      boxes.push(up);
    }
    return boxes;
  };

  /**
   * The suggestions a box of words shows of its own as you type, such as places from the site's
   * server, and takes only one of, as Lever's location does: a box of results beside it, and a
   * hidden field that keeps the one you pick, in the box around it that holds no other field.
   */
  const suggestionsOf = (
    control: Element,
  ): { results: Element; picked: HTMLInputElement } | null => {
    if (!(control instanceof HTMLInputElement) || control.type !== 'text') return null;
    if (control.getAttribute('role') === 'combobox') return null;
    for (const box of ownBoxes(control).slice(0, 3)) {
      const results = box.querySelector(
        '[class*="dropdown-results"], [class*="suggestions"], [class*="autocomplete-results"]',
      );
      const picked = box.querySelector<HTMLInputElement>('input[type="hidden"]');
      if (results && picked && !results.contains(control)) return { results, picked };
    }
    return null;
  };

  /**
   * The box at the page's end a list you search shows what it found in, as Workday ties it to the
   * list's widget, by the widget's ID.
   */
  const foundIn = (control: Element): Element[] => {
    const widget =
      control.getAttribute('data-uxi-multiselect-id') ??
      control.closest('[data-automation-id="multiSelectContainer"]')?.getAttribute('id');
    if (!widget) return [];
    return [...doc.querySelectorAll('[data-associated-widget]')].filter(
      (box) => box.getAttribute('data-associated-widget') === widget,
    );
  };

  /**
   * The lists a button opened that show now, wherever the page puts them, as Workday's dropdowns
   * do at the page's end, naming them nowhere: those that weren't there before it was pressed
   * (`before`), or while it says it's open, the one that shows. Never the list of picks beside a
   * list you search, nor one the page is still closing, as Workday's lingers a moment.
   */
  const openedBy = (control: Element, before?: ReadonlySet<Element>): Element[] => {
    const open = everyOf('[role="listbox"]').filter(
      (list) =>
        !within(list, control) &&
        !list.matches('[data-automation-id="selectedItemList"]') &&
        !closestOf(list, '[visibility="closing"], [visibility="close"]') &&
        shown(list),
    );
    if (before) return open.filter((list) => !before.has(list));
    return control.getAttribute('aria-expanded') === 'true' && open.length === 1 ? open : [];
  };

  /**
   * The list a box that offers choices shows once it's open, and the options in it: the one it
   * names, or one in the box around it, or the suggestions it shows as you type. A button that
   * opens a list may have the page show it elsewhere, as Workday's does at the page's end (see
   * `openedBy`), and a list you search shows what it found in a box of its own there.
   */
  const listOf = (control: Element, before?: ReadonlySet<Element>): Element[] => {
    const lists = [
      ...named(control, 'aria-controls'),
      ...named(control, 'aria-owns'),
      // Not the list of picks beside a list you search, as Workday's, which are no options.
      ...ownBoxes(control).flatMap((box) =>
        everyOf('[role="listbox"]:not([data-automation-id="selectedItemList"])', box),
      ),
      ...(opensList(control) ? openedBy(control, before) : []),
      ...(searches(control) ? foundIn(control) : []),
      // A box a page made of its own keeps its list in the box after it, as iCIMS's does.
      ...(pickBox(control) && control.nextElementSibling
        ? everyOf('[role="listbox"]', control.nextElementSibling)
        : []),
    ];
    for (const list of lists) {
      const options = everyOf('[role="option"]', list).filter(shown);
      if (options.length > 0) return options;
    }
    const suggests = suggestionsOf(control);
    if (!suggests) return [];
    return [...suggests.results.children].filter(
      (each) => shown(each) && squash(each.textContent ?? '') !== '',
    );
  };

  /**
   * The box that searches the list a box a page made of its own opens, as iCIMS's keeps one in
   * the box after it, with its list.
   */
  const searchBoxOf = (control: Element): HTMLInputElement | null => {
    for (const holder of [control.nextElementSibling, ...named(control, 'aria-controls')]) {
      const found = holder?.querySelector<HTMLInputElement>('input:not([type="hidden"])');
      if (found) return found;
    }
    return null;
  };

  /**
   * Whether the list a box offers says it's still looking, as one from the site's server loads,
   * or that it found none: as a notice in the list, or in the box around it, says it.
   */
  const listSays = (control: Element, words: RegExp): boolean =>
    [...named(control, 'aria-controls'), ...named(control, 'aria-owns'), ...ownBoxes(control)].some(
      (box) =>
        [...box.querySelectorAll('[class]')].some(
          (each) => words.test(each.getAttribute('class') ?? '') && shown(each),
        ),
    );

  /** The box a box that offers choices shows as, around its own input, which may be see-through. */
  const comboBox = (control: Element): Element | null =>
    closestOf(
      control,
      '[class*="control"], [class*="select"], [class*="combobox"], [class*="dropdown"]',
    );

  /** Whether clicking an element would submit its form: it is, or is inside, a button that submits. */
  const submits = (element: Element): boolean => {
    const button =
      element.closest('button') ?? (element instanceof HTMLInputElement ? element : null);
    if (button instanceof HTMLButtonElement)
      return button.type === 'submit' && button.form !== null;
    return (
      button instanceof HTMLInputElement &&
      (button.type === 'submit' || button.type === 'image') &&
      button.form !== null
    );
  };

  /** A field, found by reading the page, with the elements it's made of. */
  interface Found {
    field: PageField;
    /**
     * The control, or for radio buttons, checkboxes and buttons that stay pressed, each of the
     * group's.
     */
    controls: HTMLElement[];
    /** Whether its options are buttons that stay pressed, as Ashby's Yes and No. */
    pressed?: boolean;
  }

  /** The most buttons a set that stays pressed has, and the longest words of one. */
  const MOST_PRESSED = 12;
  const PRESSED_WORDS = 60;

  /** The sets a group of checkboxes may be in, as Workday puts its own in a grid. */
  const BOX_SETS = 'fieldset, [role="group"], [role="grid"], [role="radiogroup"]';
  /** A box to tick. */
  const OPTIONS = 'input[type="checkbox"]';

  /**
   * What marks the step an application that runs over several pages is on: Workday's progress
   * bar's, or any marked as the current step.
   */
  const STEP_NOW =
    '[data-automation-id="progressBarActiveStep"], [aria-current="step"], li.iCIMS_Steps_Current, .datatrain-focus .datatrain-wagon';
  /** Words that say a button adds a part to a form, as "Add", "Add Another" and "+ Add another job". */
  const ADDS = /^\+?\s*add\b(?!\s+(to|a file|file|files|attachment)\b)/i;
  /** The most parts it adds to a form at once, and how long it waits for each to show. */
  const MOST_ADDED = 10;
  const ADD_MS = 3000;

  /**
   * Sets of buttons that each stay pressed once clicked, as a form's Yes and No are on Ashby: two
   * or more side by side, each with a few words, as a choice of one of them. A hidden field beside
   * them, that keeps the answer for the page, isn't a field of its own.
   */
  const pressedSets = (): HTMLElement[][] => {
    const sets = new Map<Element, HTMLElement[]>();
    for (const button of everyOf<HTMLElement>('button[aria-pressed]')) {
      const parent = button.parentElement;
      if (!parent || closestOf(button, AROUND) || (button as HTMLButtonElement).disabled) continue;
      if (closestOf(button, '[aria-hidden="true"], [inert]') || !visible(button)) continue;
      const words = squash(button.textContent ?? '');
      if (!words || words.length > PRESSED_WORDS) continue;
      sets.set(parent, [...(sets.get(parent) ?? []), button]);
    }
    return [...sets.values()].filter((set) => set.length >= 2 && set.length <= MOST_PRESSED);
  };

  /** Whether a control is one of the form's fields: shown, outside the page's own parts. */
  const isField = (control: HTMLElement): boolean => {
    const type = (control.getAttribute('type') ?? '').toLowerCase();
    if (control instanceof HTMLInputElement && NOT_FIELDS.has(type)) return false;
    if ((control as HTMLInputElement).disabled) return false;
    if (closestOf(control, AROUND)) return false;
    // A captcha's box, and a box only a page's own code fills, such as a picker's hidden one.
    if (
      /captcha/i.test(control.getAttribute('name') ?? '') ||
      closestOf(control, '[class*="captcha"]')
    ) {
      return false;
    }
    // A box with no name and nothing naming it, such as one a page keeps for dropping files on
    // anywhere, is the page's own, not a question. A box around it, that holds no other field, may
    // name it, as Workday's for your resume does.
    const nameless =
      !control.getAttribute('id') &&
      !control.getAttribute('name') &&
      !control.getAttribute('aria-label') &&
      !control.getAttribute('aria-labelledby') &&
      !closestOf(control, 'label') &&
      !ownBoxes(control).some(
        (box) => box.hasAttribute('aria-labelledby') || box.hasAttribute('aria-label'),
      );
    if (nameless && (type === 'file' || control.getAttribute('tabindex') === '-1')) return false;
    // The box beside a button that opens a list, which keeps the option picked for the page, as
    // Workday's dropdowns have, is the button's, not a field of its own.
    const before = control.previousElementSibling;
    if (
      control instanceof HTMLInputElement &&
      before !== null &&
      opensList(before) &&
      !control.getAttribute('id') &&
      !control.getAttribute('name')
    ) {
      return false;
    }
    // So is the list a page keeps hidden beside its own box that shows the pick, as iCIMS's
    // dropdowns keep theirs, and the box that searches that box's list, in the box after it.
    const after = control.nextElementSibling;
    if (control.tagName === 'SELECT' && after !== null && pickBox(after)) return false;
    for (let up = control.parentElement, level = 0; up && level < 4; up = up.parentElement) {
      const list = up.previousElementSibling;
      if (list !== null && pickBox(list)) return false;
      level += 1;
    }
    // A box that reads your resume to fill the form in for you, as SmartRecruiters' Easy Apply
    // does, is the site's own way to apply: Factwright fills the form itself.
    if (closestOf(control, '[data-test="apply-with-resume-container"]')) return false;
    // Kept from you, as what's around a dialog is while it's open, it's never a field.
    if (closestOf(control, '[aria-hidden="true"], [inert]')) return false;
    // A file field, a radio button or a checkbox is often hidden behind the page's own button or
    // box, and its label is what you see. A box that offers choices may be see-through, inside
    // the box it shows as.
    if (type === 'file' || type === 'radio' || type === 'checkbox') {
      return visible(control) || labelsOf(control).some(visible);
    }
    // A radio button a page made of its own shows as itself, or its label does.
    if (ownRadio(control)) {
      return visible(control) || named(control, 'aria-labelledby').some(visible);
    }
    if (control.getAttribute('role') === 'combobox' && !visible(control)) {
      const box = comboBox(control);
      return box !== null && visible(box);
    }
    return visible(control);
  };

  /** Every field on the form, in the page's order, with radio buttons and checkboxes grouped. */
  const readFields = (): Found[] => {
    const pressed = pressedSets();
    const pressedFirst = new Map(pressed.map((set) => [set[0] as HTMLElement, set]));
    const holders = pressed.map((set) => set[0]?.parentElement as Element);
    const controls = everyOf<HTMLElement>(
      'input, select, textarea, [role="combobox"]:not(input), [contenteditable="true"][role="textbox"], button[aria-haspopup="listbox"], [role="button"][aria-haspopup="listbox"], [role="radio"]:not(input)',
    )
      .filter((control) => !holders.some((holder) => within(holder, control)))
      .filter(isField);
    // Each set of buttons that stays pressed goes in the page's order, by its first.
    for (const first of pressedFirst.keys()) {
      const after = controls.findIndex((control) => comesAfter(first, control));
      controls.splice(after < 0 ? controls.length : after, 0, first);
    }
    /**
     * The group a radio button or checkbox is one of: those with its name, or for a checkbox with
     * none, as Workday's, the nearest set around it that holds two or more checkboxes and nothing
     * else.
     */
    const sets = new Map<Element, number>();
    const groupOf = (control: HTMLElement): string => {
      const type = (control.getAttribute('type') ?? '').toLowerCase();
      const name = control.getAttribute('name');
      if ((type === 'radio' || type === 'checkbox') && name) return `${type}:${name}`;
      // A page's own radio buttons are one question by the set they show in.
      if (ownRadio(control)) {
        const set = shownAround(control, '[role="radiogroup"]') ?? control.parentElement;
        if (!set) return '';
        if (!sets.has(set)) sets.set(set, sets.size);
        return `radio:set:${sets.get(set)}`;
      }
      const set = type === 'checkbox' ? closestOf(control, BOX_SETS) : null;
      const inside = set ? everyOf(CONTROLS, set) : [];
      if (!set || inside.length < 2 || !inside.every((each) => each.matches(OPTIONS))) return '';
      if (!sets.has(set)) sets.set(set, sets.size);
      return `checkbox:set:${sets.get(set)}`;
    };
    const groups = new Map<string, HTMLElement[]>();
    for (const control of controls) {
      const key = groupOf(control);
      if (key) groups.set(key, [...(groups.get(key) ?? []), control]);
    }
    const found: Found[] = [];
    const done = new Set<HTMLElement>();
    for (const control of controls) {
      if (done.has(control) || found.length >= MAX_FIELDS) continue;
      const type = (control.getAttribute('type') ?? '').toLowerCase();
      const name = control.getAttribute('name') ?? '';
      const id = control.getAttribute('id') ?? '';
      const grouped = groupOf(control);
      const group = grouped ? groups.get(grouped) : undefined;
      let field: Omit<PageField, 'ref' | 'key' | 'section'>;
      let members = [control];
      const set = pressedFirst.get(control);
      if (set) {
        members = set;
        for (const each of set) done.add(each);
        const holder = control.parentElement as Element;
        // The hidden field beside them, as the page keeps the answer in, names the question.
        const kept = holder.querySelector('input[name]')?.getAttribute('name') ?? '';
        const raw =
          groupWords(closestOf(control, '[role="radiogroup"], [role="group"]')) ||
          groupWords(holder) ||
          wordsAbove(holder);
        const own = cut(squash(`${kept} ${holder.getAttribute('id') ?? ''}`));
        const question = cut(cleanQuestion(raw));
        const ref = found.length;
        found.push({
          field: {
            ref,
            key: cut(`BUTTON|pressed||${own}|${question}`),
            question,
            hint: '',
            section: sectionOf(members, question),
            control: 'choice',
            type: '',
            autocomplete: '',
            name: own,
            options: set.map(optionWords),
            required: holder.getAttribute('aria-required') === 'true' || marksRequired(raw),
            limit: null,
          },
          controls: members,
          pressed: true,
        });
        continue;
      }
      const radio = type === 'radio' || ownRadio(control);
      if (group && (radio || group.length > 1)) {
        members = group;
        for (const each of group) done.add(each);
        // The group's question is above its options: a legend, a group's label, or the words before
        // it. A page's own radio buttons show in their set through a component's slot.
        const role = ownRadio(control)
          ? shownAround(control, '[role="radiogroup"]')
          : closestOf(control, '[role="radiogroup"], [role="group"]');
        let common: Element | null = upOf(control);
        while (common && !group.every((each) => common !== null && within(common, each)))
          common = upOf(common);
        // The words before the first option, inside the group's own box, or else above the box.
        const first = closestOf(control, 'label') ?? control;
        const raw =
          legendOf(control) ||
          groupWords(role) ||
          (common ? wordsBefore(common, first) || wordsAbove(common) : '') ||
          '';
        // Words that only say how to answer, as "Please check one of the boxes below:", ask what
        // the heading over them does, as a self-identification form's.
        const how = HOW_ONLY.test(cleanQuestion(raw)) ? headingOver(control) : '';
        field = {
          question: cut(cleanQuestion(how || raw)),
          hint: how ? cut(cleanQuestion(raw)) : '',
          control: radio ? 'choice' : 'choices',
          type: type.slice(0, 40),
          autocomplete: '',
          name: cut(squash(`${name} ${id}`)),
          options: group.slice(0, MAX_FIELDS).map(optionWords),
          required:
            group.some((each) => (each as HTMLInputElement).required) ||
            role?.getAttribute('aria-required') === 'true' ||
            marksRequired(raw),
          limit: null,
        };
      } else {
        done.add(control);
        const own = questionOf(control);
        // A date's parts, such as "Month" and "Year", are asked by the set they're in, such as
        // "Start date *", which may mark them as required.
        const set = /^(day|month|year)$/i.test(own.question) ? datePartOf(control) : '';
        const question = set ? `${cleanQuestion(set)} ${own.question}` : own.question;
        const raw = set ? `${own.raw} ${set}` : own.raw;
        const tag = control.tagName;
        const role = control.getAttribute('role');
        const control_: FieldControl =
          tag === 'TEXTAREA' || control.isContentEditable
            ? 'long'
            : tag === 'SELECT'
              ? (control as HTMLSelectElement).multiple
                ? 'choices'
                : 'choice'
              : role === 'combobox' ||
                  control.getAttribute('aria-autocomplete') === 'list' ||
                  opensList(control) ||
                  searches(control) ||
                  suggestionsOf(control) !== null
                ? 'combo'
                : type === 'checkbox'
                  ? 'check'
                  : type === 'radio'
                    ? 'choice'
                    : type === 'file'
                      ? 'file'
                      : type === 'number' || role === 'spinbutton'
                        ? 'number'
                        : type === 'date' || takesDay(control)
                          ? 'date'
                          : 'text';
        const hint = hintOf(control, question);
        field = {
          question: cut(
            control_ === 'check' ? cleanQuestion(optionWords(control) || question) : question,
          ),
          hint,
          control: control_,
          type: type.slice(0, 40),
          autocomplete: (control.getAttribute('autocomplete') ?? '').toLowerCase().slice(0, 200),
          name: cut(squash(`${name} ${id}`)),
          options:
            tag === 'SELECT'
              ? selectOptions(control as HTMLSelectElement)
              : control_ === 'combo'
                ? listOf(control)
                    .slice(0, MAX_FIELDS)
                    .map((option) => cut(squash(option.textContent ?? '')))
                : [],
          required:
            (control as HTMLInputElement).required ||
            control.getAttribute('aria-required') === 'true' ||
            closestOf(control, '[role="group"][aria-required="true"]') !== null ||
            marksRequired(raw),
          limit: limitOf(control, `${raw} ${hint}`),
        };
      }
      // A box to tick that says nothing of its own, as Workday's for texts to your phone, whose
      // only words are its part's, isn't a question.
      if (field.control === 'check' && (!field.question || !optionWords(control))) continue;
      const ref = found.length;
      const key = cut(`${control.tagName}|${type}|${id}|${name}|${field.question}`);
      const section = sectionOf(members, field.question);
      found.push({ field: { ref, key, ...field, section }, controls: members });
    }
    return found;
  };

  /** The field with an answer's place and key, or the one with its key that moved. */
  const findField = (fields: Found[], ref: number, key: string): Found | undefined => {
    const at = fields[ref];
    if (at && at.field.key === key) return at;
    const same = fields.filter((each) => each.field.key === key);
    return same.length === 1 ? same[0] : undefined;
  };

  /**
   * An option's words, as compared: lowercase, with only its letters and digits, and no
   * apostrophes, so "Bachelor's" is a site's "Bachelors", as core compares words too.
   */
  const plain = (text: string) =>
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/['’]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();

  /**
   * The option that's the answer: the first of the answer's picks that an option says exactly,
   * then one an option starts with, as a word.
   */
  const pickOf = <T>(
    options: T[],
    words: (option: T) => string,
    picks: string[],
    exact = false,
  ): T | undefined => {
    const each = options.map((option) => ({ option, said: plain(words(option)) }));
    for (const pick of picks.map(plain).filter(Boolean)) {
      const same = each.find(({ said }) => said === pick);
      if (same) return same.option;
    }
    if (exact) return undefined;
    for (const pick of picks.map(plain).filter(Boolean)) {
      const starts = each.find(({ said }) => said.startsWith(`${pick} `));
      if (starts) return starts.option;
    }
    return undefined;
  };

  /**
   * The option that's a place, each pick in turn, the first best: one that says it exactly, then
   * one that starts with it, as a word, then one that starts with its first word and says the
   * rest in order, as a site's list of places puts a county between a city and its state.
   */
  const placeOf = (options: Element[], picks: string[]): Element | undefined => {
    const each = options.map((option) => {
      const said = plain(option.textContent ?? '');
      return { option, said, words: said.split(' ') };
    });
    for (const pick of picks.map(plain).filter(Boolean)) {
      const [first, ...rest] = pick.split(' ');
      const found =
        each.find(({ said }) => said === pick) ??
        each.find(({ said }) => said.startsWith(`${pick} `)) ??
        each.find(({ words }) => {
          if (words[0] !== first) return false;
          let at = 1;
          for (const word of rest) {
            const next = words.indexOf(word, at);
            if (next < 0) return false;
            at = next + 1;
          }
          return true;
        });
      if (found) return found.option;
    }
    return undefined;
  };

  /** A place's city, as it starts: "Denver" of "Denver, CO". */
  const cityOf = (place: string) => (place.split(',')[0] ?? '').trim();

  /**
   * How a key, and what it types, go up through the page, as a keyboard's do: from inside a
   * component too, which a change, as the browser makes it, doesn't leave.
   */
  const KEYED = { bubbles: true, cancelable: true, composed: true } as const;
  const TYPED = { bubbles: true, composed: true } as const;

  /** Puts text in a box as typing would, so the page's own code keeps it. */
  const typeInto = (box: HTMLInputElement | HTMLTextAreaElement, text: string, leave = true) => {
    const proto =
      box instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    box.focus({ preventScroll: true });
    const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (set) set.call(box, text);
    else box.value = text;
    box.dispatchEvent(new Event('input', TYPED));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    if (leave) box.blur();
  };

  /**
   * Clicks an element as a person would: the mouse goes down, comes up, then it's a click. A
   * button that would submit its form only has the mouse go down and up on it, never the click,
   * but for one of a pair that stays pressed, as Ashby's Yes and No, which a page may leave to
   * submit, as a button in a form does unless it says otherwise: filling stops the form being
   * submitted meanwhile (`evenSubmit`).
   */
  const press = (element: Element, evenSubmit = false) => {
    const view = doc.defaultView;
    const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    const like = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      pointerType: 'mouse',
      isPrimary: true,
    };
    for (const kind of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      const Kind = kind.startsWith('pointer') ? Pointer : MouseEvent;
      let event: MouseEvent;
      try {
        event = new Kind(kind, { ...like, view });
      } catch {
        // A window events don't take as theirs, as a test's can be: the event goes without it.
        event = new Kind(kind, like);
      }
      element.dispatchEvent(event);
    }
    if (evenSubmit || !submits(element)) (element as HTMLElement).click();
  };

  /** Waits for something to show, looking every so often, up to a limit. */
  const waitFor = async <T>(
    look: () => T | undefined | null | false,
    ms: number,
  ): Promise<T | undefined> => {
    const until = Date.now() + ms;
    for (;;) {
      const found = look();
      if (found) return found;
      if (Date.now() >= until) return undefined;
      await sleep(50);
    }
  };

  /**
   * Types words in a box that offers what it has as you type, as typing ends: the key goes down,
   * the words are in, the key comes up, as the page's own code may look for either. Nothing says
   * it changed, as typing doesn't till you leave the box.
   */
  const typeToFind = (box: HTMLInputElement, text: string) => {
    box.focus({ preventScroll: true });
    const key = text.slice(-1);
    box.dispatchEvent(new KeyboardEvent('keydown', { key, ...KEYED }));
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (set) set.call(box, text);
    else box.value = text;
    box.dispatchEvent(new InputEvent('input', { ...TYPED, inputType: 'insertText', data: text }));
    box.dispatchEvent(new KeyboardEvent('keyup', { key, ...KEYED }));
  };

  /**
   * Types text in a box a key at a time, as a keyboard does, for a box whose page builds what's in
   * it from each key, as a date's month and year boxes may: each key goes down, then goes in unless
   * the page took it itself, and comes up. What was in it goes first.
   */
  const typeKeys = (box: HTMLInputElement, text: string) => {
    box.focus({ preventScroll: true });
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const put = (value: string) => {
      if (set) set.call(box, value);
      else box.value = value;
    };
    const key = (kind: string, name: string) => {
      const event = new KeyboardEvent(kind, { key: name, ...KEYED });
      box.dispatchEvent(event);
      return !event.defaultPrevented;
    };
    if (box.value && key('keydown', 'Backspace')) {
      put('');
      box.dispatchEvent(new InputEvent('input', { ...TYPED, inputType: 'deleteContent' }));
    }
    for (const each of text) {
      if (key('keydown', each)) {
        put(`${box.value}${each}`);
        box.dispatchEvent(
          new InputEvent('input', { ...TYPED, inputType: 'insertText', data: each }),
        );
      }
      key('keyup', each);
    }
    box.dispatchEvent(new Event('change', { bubbles: true }));
    box.blur();
  };

  /** What a box's list says while it looks, and once it found nothing. */
  const LOOKING = /loading|searching/i;
  const NONE = /no[-_]?(options|results)/i;

  /**
   * Waits for the option to pick in a list that shows as you type, from the site's own server:
   * until it shows, or the list settles without it, no longer looking, with other options, or
   * saying it found none, as it didn't before the words went in.
   */
  const waitForList = async (
    box: Element,
    find: () => Element | undefined,
    ms: number,
    noneBefore: boolean,
  ): Promise<Element | undefined> => {
    const until = Date.now() + ms;
    let looked = false;
    let settledAt = 0;
    for (;;) {
      const found = find();
      if (found) return found;
      const now = Date.now();
      if (now >= until) return undefined;
      const looking = listSays(box, LOOKING);
      looked = looked || looking;
      const none = listSays(box, NONE) && (looked || !noneBefore);
      const settled = !looking && (listOf(box).length > 0 || none);
      if (!settled) settledAt = 0;
      else if (!settledAt) settledAt = now;
      else if (now - settledAt >= SETTLED_MS) return undefined;
      await sleep(50);
    }
  };

  /**
   * The words a box that offers choices shows: what's typed in it, or the option picked, which
   * such a box shows beside its input. The nearest box around it with words, and no other field,
   * says it. Words that only say to pick, as "Select…", are none.
   */
  const comboShows = (control: HTMLElement): string => {
    // A button that opens a list shows the option picked as its own words, or words that only
    // say to pick, as Workday's "Select One", and so does a box a page made of its own, as iCIMS's.
    if (opensList(control) || pickBox(control)) {
      const words = squash(
        shownChildren(control)
          .map((node) =>
            node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '') : wordsOf(node as Element),
          )
          .join(' '),
      );
      return PLACEHOLDERS.test(words) ? '' : words;
    }
    // A list you search shows each option picked as a pill beside its box.
    if (searches(control)) {
      const box = control.closest('[data-automation-id="multiselectInputContainer"]');
      return [...(box?.querySelectorAll('[data-automation-id="selectedItem"]') ?? [])]
        .map((pill) => wordsOf(pill))
        .filter(Boolean)
        .join(', ');
    }
    const value = (control as HTMLInputElement).value ?? '';
    // A box that takes one of its own suggestions shows the one picked in itself.
    if (suggestionsOf(control)) return value;
    let up = upOf(control);
    for (let level = 0; level < 4 && up && up !== doc.body; level++, up = upOf(up)) {
      const fields = everyOf(
        'input:not([type="hidden"]):not([aria-hidden="true"]), select, textarea',
        up,
      );
      if (fields.length > 1) break;
      const words = wordsOf(up);
      if (words) return PLACEHOLDERS.test(words) ? value : squash(`${value} ${words}`);
    }
    return value;
  };

  /**
   * What a part of a date holds: the digits its page shows beside its box, as Workday shows "03"
   * while its box says "3", and as only its own keys put them there, or else the number the box
   * says it holds, or what's in it. Words that only say what goes there, as "MM", are nothing.
   */
  const spinShows = (box: HTMLElement): string => {
    const display = box.parentElement?.querySelector('[data-automation-id$="-display"]');
    if (display) {
      const digits = squash(display.textContent ?? '');
      return /^\d+$/.test(digits) ? digits : '';
    }
    return box.getAttribute('aria-valuenow') ?? (box as HTMLInputElement).value ?? '';
  };

  /** What a field shows now: its text, the option picked, or the file's name. */
  const shownIn = (found: Found): string => {
    const [control] = found.controls;
    if (!control) return '';
    const { field } = found;
    if (found.pressed) {
      return found.controls
        .filter((each) => each.getAttribute('aria-pressed') === 'true')
        .map(optionWords)
        .join(', ');
    }
    if (field.control === 'choice' || field.control === 'choices') {
      if (control instanceof HTMLSelectElement) {
        // An option with no value, or that only says to pick, as "Select…" or iCIMS's "Please
        // select a country", is none picked.
        return [...control.selectedOptions]
          .filter((option) => option.value !== '' && !PLACEHOLDERS.test(squash(option.text)))
          .map((option) => squash(option.text))
          .join(', ');
      }
      // A radio button that only says none is picked, as SuccessFactors' "No Selection", isn't one.
      return found.controls
        .filter(ticked)
        .map(optionWords)
        .filter((words) => !PLACEHOLDERS.test(words))
        .join(', ');
    }
    if (field.control === 'check') return ticked(control) ? 'Checked' : '';
    if (field.control === 'file') {
      // With the files the page took already, as Workday lists each one it uploaded beside it.
      const uploaded = new Set(
        ownBoxes(control).flatMap((box) => [
          ...box.querySelectorAll('[data-automation-id="file-upload-item-name"]'),
        ]),
      );
      return [
        ...[...((control as HTMLInputElement).files ?? [])].map((file) => file.name),
        ...[...uploaded].map((each) => squash(each.textContent ?? '')),
      ]
        .filter(Boolean)
        .join(', ');
    }
    if (field.control === 'combo') return comboShows(control);
    if (control.getAttribute('role') === 'spinbutton') return spinShows(control);
    if (field.type === 'password') return '';
    if (control.isContentEditable) return squash(control.textContent ?? '');
    return (control as HTMLInputElement).value ?? '';
  };

  /** The most groups of a list you search it looks through, for an option that isn't found. */
  const MOST_GROUPS = 12;

  /**
   * The options of a list you search that are groups of others, as Workday's How Did You Hear
   * About Us? puts its sources in groups, such as Job Board.
   */
  const groupsIn = (box: Element) =>
    listOf(box).filter(
      (row) =>
        row.matches('[data-uxi-multiselectlistitem-type="2"]') ||
        row.querySelector('[data-uxi-multiselectlistitem-type="2"]') !== null,
    );

  /**
   * Looks through a list you search group by group, for the option that's the answer, as each
   * group shows its own once it's picked, and goes back to the groups after each: the option, or
   * nothing once none has it.
   */
  const browse = async (
    box: HTMLInputElement,
    find: () => Element | undefined,
  ): Promise<Element | undefined> => {
    press(box);
    let first = await waitFor(() => groupsIn(box).length > 0 && groupsIn(box), 800);
    // Some of Workday's sites open the list from its icon beside the box, not the box.
    const icon = box
      .closest('[data-automation-id="multiselectInputContainer"]')
      ?.querySelector('[data-automation-id="promptIcon"]');
    if (!first && icon) {
      press(icon);
      first = await waitFor(() => groupsIn(box).length > 0 && groupsIn(box), 800);
    }
    if (!first) return undefined;
    const names = first.map((row) => squash(row.textContent ?? '')).slice(0, MOST_GROUPS);
    for (const name of names) {
      const group = groupsIn(box).find((row) => squash(row.textContent ?? '') === name);
      if (!group) continue;
      press(group.querySelector('[data-automation-id="promptOption"]') ?? group);
      const found = await waitFor(find, 1500);
      if (found) return found;
      const back = foundIn(box)
        .flatMap((list) => [...list.querySelectorAll('[data-automation-id="backButton"]')])
        .find(shown);
      if (back) press(back);
      else press(box);
      await waitFor(() => groupsIn(box).length > 0, 800);
    }
    return undefined;
  };

  /** The newest pill a list you search shows, for the pick it kept last, as Workday's does. */
  const newestPill = (box: Element): Element | undefined => {
    const pills = box
      .closest('[data-automation-id="multiselectInputContainer"]')
      ?.querySelectorAll('[data-automation-id="selectedItem"]');
    return pills?.[pills.length - 1];
  };

  /**
   * Takes back a pick a list you search kept itself, that isn't the answer, as Workday's keeps
   * the one it found on Enter: its newest pill's own button to clear it, till the list shows what
   * it did before.
   */
  const unpick = async (box: Element, had: string) => {
    const clear = newestPill(box)?.querySelector('[data-automation-id="DELETE_charm"]');
    if (!clear) return;
    press(clear);
    await waitFor(() => comboShows(box as HTMLElement) === had, 1000);
  };

  /** Puts an answer in a field, and says how it went. */
  const fill = async (found: Found, answer: FieldAnswer): Promise<FieldFilled> => {
    const { field, controls } = found;
    const [control] = controls;
    const done = (ok: boolean, why: FieldFilled['why'] = '') => ({
      ref: answer.ref,
      ok,
      shown: cut(shownIn(found)),
      why: ok ? ('' as const) : why || ('not-taken' as const),
    });
    if (!control || field.type === 'password') return done(false, 'not-taken');
    // A field that holds an answer already, as a site may fill in from your resume, stays as it is.
    if (answer.ifEmpty && shownIn(found).trim() !== '') return { ...done(true), kept: true };
    // A field whose own code sends the page away as it changes is left for you, as filling would
    // stop there, and the page might throw away what went in before it.
    if (controls.some(sendsPage)) return done(false, 'reloads');
    if (answer.file && field.control === 'file') {
      const bytes = Uint8Array.from(atob(answer.file.base64), (char) => char.charCodeAt(0));
      const files = new DataTransfer();
      files.items.add(new File([bytes], answer.file.name, { type: answer.file.type }));
      const input = control as HTMLInputElement;
      input.files = files.files;
      input.dispatchEvent(new Event('input', TYPED));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return done((input.files?.length ?? 0) === 1);
    }
    const picks = answer.pick ?? (answer.text !== undefined ? [answer.text] : []);
    if (found.pressed) {
      const option = pickOf(controls, optionWords, picks, answer.exact);
      if (!option) return done(false, 'no-option');
      if (option.getAttribute('aria-pressed') !== 'true') press(option, true);
      const took = await waitFor(() => option.getAttribute('aria-pressed') === 'true', 1000);
      return done(Boolean(took));
    }
    if (field.control === 'choice' || field.control === 'choices') {
      if (control instanceof HTMLSelectElement) {
        const find = () => pickOf([...control.options], (each) => each.text, picks, answer.exact);
        // A list with no options of its own yet may be getting them from the page's site, as a
        // state's does once the country is picked: it gets a moment to.
        const option =
          find() ?? (control.options.length <= 1 ? await waitFor(find, LIST_MS) : undefined);
        if (!option) return done(false, 'no-option');
        option.selected = true;
        control.dispatchEvent(new Event('input', TYPED));
        control.dispatchEvent(new Event('change', { bubbles: true }));
        return done(option.selected);
      }
      if (field.control === 'choice') {
        const option = pickOf(controls, optionWords, picks, answer.exact);
        if (!option) return done(false, 'no-option');
        if (!ticked(option)) press(option);
        // A page's own radio button may take a moment to say it's picked.
        return done(ticked(option) || Boolean(await waitFor(() => ticked(option), 1000)));
      }
      let any = false;
      for (const pick of picks) {
        const option = pickOf(controls, optionWords, [pick], answer.exact);
        if (!option) continue;
        if (!ticked(option)) press(option);
        any = any || ticked(option);
      }
      return done(any, 'no-option');
    }
    if (field.control === 'check') return done(false, 'not-taken');
    if (field.control === 'combo') {
      const box = control as HTMLInputElement;
      const optionWords = (each: Element) => textOf(each);
      const suggests = suggestionsOf(box);
      const search = searches(box);
      /** The lists on the page before a button that opens one was pressed, to tell its own. */
      let before: ReadonlySet<Element> | undefined;
      const find = () =>
        answer.place && !answer.exact
          ? placeOf(listOf(box, before), picks)
          : pickOf(listOf(box, before), optionWords, picks, answer.exact);
      /** Whether a pick a list you search kept itself is the answer, as its option would be. */
      const keptIt = (pill: Element | undefined) => {
        if (!pill) return false;
        if (!answer.place || answer.exact) {
          return pickOf([pill], wordsOf, picks, answer.exact) !== undefined;
        }
        const said = doc.createElement('span');
        said.textContent = wordsOf(pill);
        return placeOf([said], picks) !== undefined;
      };
      /**
       * Picks an option, as a person would, and says whether the box shows it then: its words, or
       * anything new, as a box for a phone's country shows only its code. A box that takes only
       * one of its own suggestions keeps the one picked in its hidden field too. An option of a
       * list you search takes a click on its words, as Workday's do, or else on its own radio
       * button.
       */
      const choose = async (option: Element) => {
        const words = textOf(option);
        const shownBefore = comboShows(box);
        const took = () => {
          if (suggests && suggests.picked.value === '') return false;
          const shows = comboShows(box);
          return plain(shows).includes(plain(words)) || (shows !== '' && shows !== shownBefore);
        };
        // An option's own link, as SuccessFactors' lists have, is what picks it.
        press(
          option.querySelector('[data-automation-id="promptOption"]') ??
            option.querySelector(':scope > a') ??
            option,
        );
        let picked = await waitFor(took, 1000);
        const radio = option.querySelector('input[type="radio"], input[type="checkbox"]');
        if (!picked && radio) {
          press(radio);
          picked = await waitFor(took, 1000);
        }
        box.blur();
        return Boolean(picked);
      };
      const pressEscape = () =>
        box.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', ...KEYED }),
        );
      // Opened with a press, as a person would: its list shows at once when it's the page's own.
      // A box that only suggests as you type has nothing to show till then. A button's list may
      // take a moment, as Workday's asks its site for the options.
      if (!suggests) {
        before = opensList(box) ? new Set(everyOf('[role="listbox"]')) : undefined;
        press(box);
        const listed = await waitFor(find, opensList(box) ? LIST_MS : 800);
        if (listed && (await choose(listed))) return done(true);
        before = undefined;
      }
      // A list that comes from the site's own server, such as of places, shows as you type, in a
      // box you can see: a place's picks, and its city alone, as a site's list may name it its
      // own way. A list you search shows what it found once Enter is pressed, and may keep the
      // one it found then itself, as Workday's does: one that isn't the answer goes again.
      const typed = answer.place
        ? [...new Set([picks[0] ?? '', cityOf(picks[0] ?? ''), ...picks.slice(1)])]
        : picks;
      const had = comboShows(box);
      for (const pick of typed.filter(Boolean).slice(0, 3)) {
        if (box instanceof HTMLInputElement && !visible(box)) continue;
        if (search) pressEscape();
        else if (!suggests && box.getAttribute('aria-expanded') !== 'true') press(box);
        // A box a page made of its own, as iCIMS's, is searched in its list's own box.
        const typing = box instanceof HTMLInputElement ? box : searchBoxOf(box);
        if (!typing || !visible(typing)) continue;
        const noneBefore = listSays(box, NONE);
        typeToFind(typing, pick);
        if (search) {
          box.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              ...KEYED,
            }),
          );
        }
        const option = await waitForList(box, find, answer.place ? PLACE_MS : LIST_MS, noneBefore);
        if (option && (await choose(option))) return done(true);
        if (search && comboShows(box) !== had) {
          if (keptIt(newestPill(box))) {
            box.blur();
            return done(true);
          }
          await unpick(box, had);
        }
      }
      // A list you search may find nothing in its groups, as Workday's How Did You Hear About Us?
      // puts LinkedIn under Job Board: each group in turn.
      if (search && box instanceof HTMLInputElement) {
        pressEscape();
        if (box.value) typeInto(box, '', false);
        const option = await browse(box, find);
        if (option && (await choose(option))) return done(true);
      }
      pressEscape();
      // A box that takes only one of its own suggestions never keeps what was typed.
      if (box instanceof HTMLInputElement && box.value) typeInto(box, '');
      box.blur();
      return done(false, picks.length > 0 ? 'no-option' : 'not-taken');
    }
    const text = answer.text ?? picks[0] ?? '';
    if (control.isContentEditable) {
      control.focus({ preventScroll: true });
      control.textContent = text;
      control.dispatchEvent(new Event('input', TYPED));
      control.blur();
      return done(squash(control.textContent ?? '') === squash(text));
    }
    const box = control as HTMLInputElement | HTMLTextAreaElement;
    const typed = field.limit && text.length > field.limit ? text.slice(0, field.limit) : text;
    // A part of a date, as Workday's month and year boxes, takes a key at a time, and holds what
    // it shows beside them.
    if (box instanceof HTMLInputElement && box.getAttribute('role') === 'spinbutton') {
      typeKeys(box, typed);
      return done(/^\d+$/.test(typed) && Number(spinShows(box)) === Number(typed));
    }
    typeInto(box, typed);
    // A page may tidy what's typed, such as a phone number's spaces: the same digits and letters took.
    return done(
      plain(box.value) === plain(text) ||
        plain(box.value).replace(/ /g, '') === plain(text).replace(/ /g, '') ||
        // A number the page writes its own way, as a month's "03" as "3".
        (field.control === 'number' && /\d/.test(text) && Number(box.value) === Number(text)),
    );
  };

  /** Outlines a field in orange, as what's left for you, until it has an answer. */
  const outline = (found: Found) => {
    const [first] = found.controls;
    if (!first) return;
    const target = found.pressed
      ? (first.parentElement ?? first)
      : found.controls.length > 1
        ? ((found.controls[0] &&
            closestOf(
              found.controls[0],
              'fieldset, [role="radiogroup"], [role="group"], ul, ol',
            )) ??
          first)
        : found.field.control === 'combo'
          ? (closestOf(first, '[class*="control"]') ?? first)
          : first;
    const element = target as HTMLElement;
    element.style.outline = `2px solid ${ORANGE}`;
    element.style.outlineOffset = '2px';
    const clear = () => {
      if (shownIn(found)) {
        element.style.outline = '';
        element.style.outlineOffset = '';
      }
    };
    for (const control of found.controls) {
      control.addEventListener('input', clear);
      control.addEventListener('change', clear);
      if (found.pressed) control.addEventListener('click', () => setTimeout(clear, 0));
    }
  };

  /**
   * The page of an application that marks no step, as some applicant systems' say it otherwise:
   * Taleo's by the page's name, which its title and a field it keeps for bookmarks give, as its
   * progress bar may be hidden; SuccessFactors' application, one page by the form's own name, so
   * what it filled in from your profile stays; and SmartRecruiters' newer form, its first page by
   * its title, "Easy apply", and the next by its heading, "Preliminary questions". "" elsewhere.
   */
  const ownStep = (): string => {
    if (
      doc.querySelector(
        '[id^="et-ef-content-ftf"], [id^="editTemplateMultipart-editForm-content-ftf"]',
      )
    ) {
      const kept = doc.getElementById('bookmarkNameHF') as HTMLInputElement | null;
      return squash(kept?.value || doc.title);
    }
    const form = doc.querySelector('#rcmJobApplicationCtr[aria-label]');
    if (form) return squash(form.getAttribute('aria-label') ?? '');
    const screening = doc.querySelector('oc-screening-questions');
    if (screening) return wordsOf(screening.querySelector('h2'));
    if (doc.querySelector('oc-oneclick-form')) return squash(doc.title.split(' - ')[0] ?? '');
    return '';
  };

  /**
   * The step an application that runs over several pages in one tab is on, as its progress bar
   * marks it, as Workday's does, by the name it gives it, such as "My Experience", without what
   * only counts it, as "current step 2 of 7". A narrow window may hide the bar, which still says.
   * "" for a form on one page.
   */
  const stepOf = (): string => {
    const marked = everyOf(STEP_NOW);
    const now = marked.find(shown) ?? marked[0];
    const said = now ? squash(now.textContent ?? '') : ownStep();
    if (!said) return '';
    const counted = /^(?:you are on |current )?(step \d+ (?:out )?of \d+)[\s:.,-]*/i.exec(said);
    const words = said
      .slice(counted?.[0].length ?? 0)
      .replace(/\s*\(?(current|current step|completed|in progress)\)?$/i, '');
    // A narrow window may show only the count, as "step 3 of 6", which still tells the pages apart.
    const name = words || (counted?.[1] ?? '');
    return name.length > MAX_SECTION ? '' : name.charAt(0).toUpperCase() + name.slice(1);
  };

  /**
   * The form's buttons that add a part to it, as another job's, in the page's order, each with the
   * part of the form it's in: one outside the page's own parts, whose words say it adds one, as
   * Workday's Add and Add Another do. A button made to submit its form never is, though one that
   * only would as a form's buttons do unless they say otherwise, as Workday's say nothing, may be:
   * pressing it, the page can't submit the form.
   */
  const addersOf = (): { adder: PageAdder; button: HTMLElement }[] =>
    everyOf<HTMLElement>('button, [role="button"]').flatMap((button) => {
      const madeToSubmit = /^(submit|image)$/i.test(button.getAttribute('type') ?? '');
      if (closestOf(button, AROUND) || madeToSubmit || (button as HTMLButtonElement).disabled) {
        return [];
      }
      if (closestOf(button, '[aria-hidden="true"], [inert]') || !visible(button)) return [];
      // One whose own code posts the page, as Taleo's Add does, would load it anew midway.
      if (sendsPage(button)) return [];
      // Its words, or what names it, or the component it's in, as SmartRecruiters' Add.
      const words =
        textOf(button) ||
        squash(button.getAttribute('aria-label') ?? '') ||
        squash(hostOf(button)?.getAttribute('aria-label') ?? '');
      if (!ADDS.test(words) || UPLOAD_WORDS.test(words) || words.length > PRESSED_WORDS) return [];
      const section = sectionOf([button], '');
      return section ? [{ adder: { section: cut(section), words: cut(words) }, button }] : [];
    });

  /**
   * Presses a button that adds a part to the form, the one in the same part, as many times as
   * asked, each once the part it added before shows, and says how many it added. A page may put
   * another button in its place, as Workday's Add becomes Add Another, so it's found again each
   * time.
   */
  const addParts = async (asked: PageAdder, times: number): Promise<number> => {
    let added = 0;
    for (let time = 0; time < Math.min(times, MOST_ADDED); time++) {
      const same = addersOf().filter(({ adder }) => adder.section === asked.section);
      const found = same.find(({ adder }) => adder.words === asked.words) ?? same[0];
      if (!found) break;
      const before = everyOf(CONTROLS).length;
      press(found.button, true);
      const grew = await waitFor(() => everyOf(CONTROLS).length > before, ADD_MS);
      if (!grew) break;
      added += 1;
    }
    return added;
  };

  const fields = readFields();
  seen?.push(...fields.map((each) => each.controls));
  if (task.do === 'read') {
    const words = squash(doc.body?.innerText ?? doc.body?.textContent ?? '');
    return {
      did: 'read',
      form: {
        url: href,
        title: doc.title,
        fields: fields.map(({ field }) => field),
        submitted: SUBMITTED.test(words.slice(0, 20_000)),
        step: stepOf(),
        adders: addersOf().map(({ adder }) => adder),
      },
    };
  }
  // Nothing done here submits the form: a page's own code that would is stopped meanwhile.
  const view = doc.defaultView;
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  if (task.do === 'fill') {
    // Only the form it read, at the same address, but for what's after its #.
    if (task.url.split('#')[0] !== href.split('#')[0]) return { did: 'elsewhere' };
    view?.addEventListener('submit', stop, true);
    try {
      const filled: FieldFilled[] = [];
      let now = fields;
      // The parts for a job or school whose names hold another one, as a site filled them in from
      // your resume in its own order: what names it holds something, and none of it agrees.
      const agrees = new Map<string, boolean>();
      for (const answer of task.answers) {
        if (answer.part === undefined || !answer.names) continue;
        const found = findField(now, answer.ref, answer.key);
        const shows = found ? plain(shownIn(found)) : '';
        if (!shows) continue;
        const said = plain(answer.text ?? answer.pick?.[0] ?? '');
        const same = said !== '' && (shows.includes(said) || said.includes(shows));
        agrees.set(answer.part, (agrees.get(answer.part) ?? false) || same);
      }
      for (const answer of task.answers) {
        let found = findField(now, answer.ref, answer.key);
        // A page that put a field in anew as another took its answer, as Workday's address does
        // once its country is picked, has it read again, to fill the one it shows.
        if (found && !found.controls.every((control) => control.isConnected)) {
          now = readFields();
          found = findField(now, answer.ref, answer.key);
        }
        if (!found) {
          filled.push({ ref: answer.ref, ok: false, shown: '', why: 'moved' });
          continue;
        }
        if (
          answer.ifEmpty &&
          answer.part !== undefined &&
          agrees.get(answer.part) === false &&
          shownIn(found).trim() === ''
        ) {
          filled.push({ ref: answer.ref, ok: false, shown: '', why: 'other-part' });
          continue;
        }
        filled.push(await fill(found, answer));
      }
      return { did: 'fill', filled };
    } finally {
      view?.removeEventListener('submit', stop, true);
    }
  }
  if (task.do === 'values') {
    const words = squash(doc.body?.innerText ?? doc.body?.textContent ?? '');
    return {
      did: 'values',
      url: href,
      submitted: SUBMITTED.test(words.slice(0, 20_000)),
      values: task.fields.flatMap((each) => {
        const found = findField(fields, each.ref, each.key);
        return found ? [{ ...each, value: shownIn(found).slice(0, MAX_VALUE) }] : [];
      }),
      step: stepOf(),
      fields: fields.length,
    };
  }
  if (task.do === 'add') {
    if (task.url.split('#')[0] !== href.split('#')[0]) return { did: 'elsewhere' };
    view?.addEventListener('submit', stop, true);
    try {
      return { did: 'add', added: await addParts(task.adder, task.times) };
    } finally {
      view?.removeEventListener('submit', stop, true);
    }
  }
  if (task.do === 'outline') {
    for (const each of task.fields) {
      const found = findField(fields, each.ref, each.key);
      if (found) outline(found);
    }
    return { did: 'outline' };
  }
  const found = findField(fields, task.ref, task.key);
  const [first] = found?.controls ?? [];
  if (first) {
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    first.focus({ preventScroll: true });
  }
  return { did: 'show', found: Boolean(first) };
}
