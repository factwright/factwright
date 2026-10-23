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
  /** For a file field: the file, as base64. */
  file?: { name: string; type: string; base64: string };
}

/** How filling one field went: whether it took, and what it shows now. */
export interface FieldFilled {
  ref: number;
  ok: boolean;
  /** What the field holds now, as the page shows it: the text, or the option picked. */
  shown: string;
  /**
   * Why it didn't take: the field wasn't there anymore, none of its options was the answer, or
   * the page didn't keep what was put in it.
   */
  why: '' | 'moved' | 'no-option' | 'not-taken';
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
 * fields, or show a field. It fills only the form at the address it read it at.
 */
export type FormTask =
  | { do: 'read' }
  | { do: 'fill'; url: string; answers: FieldAnswer[] }
  | { do: 'values'; fields: FieldRef[] }
  | { do: 'outline'; fields: FieldRef[] }
  | { do: 'show'; ref: number; key: string };

/**
 * What each task gives back. A form the tab has moved on from, to another address, isn't filled:
 * it's elsewhere. What's in fields comes with whether the page says an application went in.
 */
export type FormAnswer =
  | { did: 'read'; form: PageForm }
  | { did: 'fill'; filled: FieldFilled[] }
  | { did: 'elsewhere' }
  | { did: 'values'; url: string; submitted: boolean; values: FieldValue[] }
  | { did: 'outline' }
  | { did: 'show'; found: boolean };

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
 * The page's words are data, never instructions.
 */
export async function formPage(
  task: FormTask,
  doc: Document = document,
  href: string = location.href,
): Promise<FormAnswer> {
  /** The most fields it reads, and options of each: a long application has a hundred or so. */
  const MAX_FIELDS = 300;
  /** The longest question, hint or option it keeps. */
  const MAX_TEXT = 500;
  /** The longest answer it reads back, as Factwright keeps what you sent. */
  const MAX_VALUE = 10_000;
  /** Inputs that are buttons, or kept from you, which are never fields. */
  const NOT_FIELDS = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'search']);
  /** The page's own parts around its content, where a site's search and sign-up boxes are. */
  const AROUND = 'header, nav, footer, [role="banner"], [role="navigation"], [role="search"]';
  /** A label that only says how to add a file, not which file. */
  const UPLOAD_WORDS =
    /^(attach|upload|choose( a)? file|browse|select( a)? file|drop( files?)?( here)?|add( a)? file|or|enter manually)( |$)/i;
  /** Words a box shows before you type, which say nothing of what it asks. */
  const PLACEHOLDERS =
    /^(type here|select|choose|start typing|please select|search|enter|write here)\b|\.\.\.$|…$/i;
  /** What a page says once an application went in. */
  const SUBMITTED =
    /thank(s| you) for (applying|your application|submitting)|application (has been |was )?(submitted|received|sent)|we(’|')?ve received your application|we have received your application|you(’|')?ve (successfully )?applied|your application is (in|complete)/i;
  /** Orange, as the app marks what needs you. */
  const ORANGE = '#e8590c';

  const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
  const cut = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

  /** Whether the page has layout, as a browser's does, and a test's page doesn't. */
  const laidOut =
    typeof (doc.documentElement as HTMLElement & { checkVisibility?: unknown }).checkVisibility ===
    'function';

  /**
   * Whether an element is shown: not hidden, see-through, or kept from you and your screen reader,
   * as what's around a dialog is while it's open. The browser says, where it can. In a page
   * without layout, as in a test, what hides it is an attribute or style on it or around it.
   */
  const shown = (element: Element): boolean => {
    if (element.closest('[aria-hidden="true"], [inert]')) return false;
    if (laidOut) {
      return (element as HTMLElement).checkVisibility({
        visibilityProperty: true,
        opacityProperty: true,
        contentVisibilityAuto: true,
        checkVisibilityCSS: true,
        checkOpacity: true,
      } as CheckVisibilityOptions);
    }
    for (let up: Element | null = element; up; up = up.parentElement) {
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
    for (let up = element.parentElement; up && up !== doc.body; up = up.parentElement) {
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

  /** An element's words, without the controls, options and scripts inside it. */
  const wordsOf = (element: Element | null): string => {
    if (!element) return '';
    let text = '';
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? '';
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const each = node as Element;
      const tag = each.tagName;
      if (/^(INPUT|SELECT|TEXTAREA|OPTION|SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|BUTTON)$/.test(tag)) {
        return;
      }
      if (each !== element && each.matches('[role="listbox"], [role="option"]')) return;
      // Words the page hides, such as a status it shows only after an upload, aren't the label's.
      if (each !== element && each.hasAttribute('hidden')) return;
      if (each !== element && typeof (each as HTMLElement).checkVisibility === 'function') {
        if (!(each as HTMLElement).checkVisibility()) return;
      }
      if (/^(P|DIV|LI|BR|H[1-6]|LABEL|LEGEND)$/.test(tag)) text += ' ';
      for (const child of each.childNodes) walk(child);
      if (/^(P|DIV|LI|H[1-6]|LABEL|LEGEND)$/.test(tag)) text += ' ';
    };
    walk(element);
    return squash(text);
  };

  /**
   * A question without what only marks it as required: "Email *" is "Email". A label that runs on
   * after its mark, as "Resume/CV ✱ Attach resume/CV" does, ends at the mark.
   */
  const cleanQuestion = (text: string) => {
    // A page's words are cut short first, so no label, however long, can slow what follows.
    const words = squash(text).slice(0, MAX_TEXT * 2);
    const [before = ''] = words.split(/\s*[*✱]+(?:\s|$)/);
    return (before.trim() || words)
      .replace(/\s*[*✱]+\s*$/, '')
      .replace(/\s*\((required|optional)\)\s*$/i, '')
      .replace(/\s+required$/i, '')
      .trim();
  };

  /** Whether the words around a field mark it as one you must answer. */
  const marksRequired = (text: string) =>
    /[*✱]\s*$|\(required\)\s*$/i.test(squash(text).slice(-MAX_TEXT));

  /** Elements named in an attribute such as aria-labelledby, by their IDs. */
  const named = (element: Element, attribute: string): Element[] =>
    (element.getAttribute(attribute) ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => doc.getElementById(id))
      .filter((each): each is HTMLElement => each !== null && each !== element);

  /** The labels that name a control: those for its ID, and the one it's inside. */
  const labelsOf = (control: Element): HTMLLabelElement[] => {
    const found: HTMLLabelElement[] = [];
    const id = control.getAttribute('id');
    if (id) {
      for (const label of doc.querySelectorAll('label[for]')) {
        if (label.getAttribute('for') === id) found.push(label as HTMLLabelElement);
      }
    }
    const around = control.closest('label');
    if (around && !found.includes(around)) found.push(around);
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
        const holds = before.querySelector('input:not([type="hidden"]), select, textarea');
        if (holds) return '';
        const words = wordsOf(before);
        // A button's own label, such as "Attach", says how, not what: the question is further up.
        if (words && !UPLOAD_WORDS.test(words)) return words.length > MAX_TEXT ? '' : words;
      }
      up = up.parentElement;
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

  /** The longest name of a part of the form: one longer is a sentence, not a name. */
  const MAX_SECTION = 120;
  /** What a part of the form holds, as fields. */
  const CONTROLS =
    'input:not([type="hidden"]), select, textarea, [role="combobox"]:not(input), [contenteditable="true"][role="textbox"]';
  /** Node.DOCUMENT_POSITION_FOLLOWING: what compareDocumentPosition says of an element after. */
  const FOLLOWS = 4;

  /**
   * The page's headings, in its order, each with the box it names: the nearest one around it
   * that holds fields. A heading in a label or legend is a question's, not a part's.
   */
  let headings: { heading: Element; words: string; names: Element }[] | null = null;
  const headingsOf = () => {
    headings ??= [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].flatMap(
      (heading) => {
        if (heading.closest(`${AROUND}, label, legend`) || !shown(heading)) return [];
        const words = wordsOf(heading);
        let names = heading.parentElement;
        while (names && !names.querySelector(CONTROLS)) names = names.parentElement;
        return words && words.length <= MAX_SECTION && names ? [{ heading, words, names }] : [];
      },
    );
    return headings;
  };

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
    let heading: { words: string; names: Element } | null = null;
    for (const each of headingsOf()) {
      if (!(each.heading.compareDocumentPosition(first) & FOLLOWS)) break;
      if (each.names.contains(first) && each.words !== question) heading = each;
    }
    let set = first.parentElement?.closest(SETS) ?? null;
    let named = '';
    for (; set; set = set.parentElement?.closest(SETS) ?? null) {
      const others = [...set.querySelectorAll<HTMLElement>(CONTROLS)].filter(
        (each) => !members.includes(each),
      );
      named = others.length >= 3 ? groupWords(set) : '';
      if (named && named.length <= MAX_SECTION) break;
      named = '';
    }
    const names =
      !heading || !set
        ? [heading?.words ?? '', named]
        : heading.names.contains(set)
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
      const words = label.contains(control)
        ? wordsBefore(label, control) || wordsOf(label)
        : wordsOf(label);
      if (take(words) && !UPLOAD_WORDS.test(words))
        return { question: cleanQuestion(words), raw: words };
    }
    const aria = control.getAttribute('aria-label') ?? '';
    if (take(aria) && !UPLOAD_WORDS.test(aria)) return { question: cleanQuestion(aria), raw: aria };
    // A file field's own label often only says how to add one: the question is the group's.
    const group = groupWords(control.closest('[role="group"], [role="radiogroup"], fieldset'));
    if (take(group) && !UPLOAD_WORDS.test(group))
      return { question: cleanQuestion(group), raw: group };
    const above = wordsAbove(control.closest('label') ?? control);
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
      .filter((words) => words && !PLACEHOLDERS.test(words))
      .join(' ');
    if (described) return cut(described);
    // Words between a field's label and the field, as a form puts what it's for under its label.
    const [label] = labelsOf(control);
    if (label && !label.contains(control)) {
      let between = '';
      for (let next = label.nextElementSibling; next; next = next.nextElementSibling) {
        if (next.contains(control) || next.matches('input, select, textarea')) break;
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
    for (const label of labelsOf(control)) {
      const words = wordsOf(label);
      if (words) return cut(words);
    }
    const aria = control.getAttribute('aria-label') ?? control.getAttribute('value') ?? '';
    if (aria && aria !== 'on') return cut(squash(aria));
    const next = control.nextSibling?.textContent ?? '';
    return cut(squash(next));
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

  /** The list a box that offers choices shows once it's open, and the options in it. */
  const listOf = (control: Element): Element[] => {
    const lists = [
      ...named(control, 'aria-controls'),
      ...named(control, 'aria-owns'),
      ...[
        ...(control
          .closest('[class*="select"], [class*="combobox"], [class*="dropdown"]')
          ?.querySelectorAll('[role="listbox"]') ?? []),
      ],
    ];
    for (const list of lists) {
      const options = [...list.querySelectorAll('[role="option"]')].filter(shown);
      if (options.length > 0) return options;
    }
    return [];
  };

  /** The box a box that offers choices shows as, around its own input, which may be see-through. */
  const comboBox = (control: Element): Element | null =>
    control.closest(
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
    /** The control, or for radio buttons and checkboxes, each of the group's. */
    controls: HTMLElement[];
  }

  /** Whether a control is one of the form's fields: shown, outside the page's own parts. */
  const isField = (control: HTMLElement): boolean => {
    const type = (control.getAttribute('type') ?? '').toLowerCase();
    if (control instanceof HTMLInputElement && NOT_FIELDS.has(type)) return false;
    if ((control as HTMLInputElement).disabled) return false;
    if (control.closest(AROUND)) return false;
    // A captcha's box, and a box only a page's own code fills, such as a picker's hidden one.
    if (
      /captcha/i.test(control.getAttribute('name') ?? '') ||
      control.closest('[class*="captcha"]')
    ) {
      return false;
    }
    // A box with no name and nothing naming it, such as one a page keeps for dropping files on
    // anywhere, is the page's own, not a question.
    const nameless =
      !control.getAttribute('id') &&
      !control.getAttribute('name') &&
      !control.getAttribute('aria-label') &&
      !control.getAttribute('aria-labelledby') &&
      !control.closest('label');
    if (nameless && (type === 'file' || control.getAttribute('tabindex') === '-1')) return false;
    // Kept from you, as what's around a dialog is while it's open, it's never a field.
    if (control.closest('[aria-hidden="true"], [inert]')) return false;
    // A file field, a radio button or a checkbox is often hidden behind the page's own button or
    // box, and its label is what you see. A box that offers choices may be see-through, inside
    // the box it shows as.
    if (type === 'file' || type === 'radio' || type === 'checkbox') {
      return visible(control) || labelsOf(control).some(visible);
    }
    if (control.getAttribute('role') === 'combobox' && !visible(control)) {
      const box = comboBox(control);
      return box !== null && visible(box);
    }
    return visible(control);
  };

  /** Every field on the form, in the page's order, with radio buttons and checkboxes grouped. */
  const readFields = (): Found[] => {
    const controls = [
      ...doc.querySelectorAll<HTMLElement>(
        'input, select, textarea, [role="combobox"]:not(input), [contenteditable="true"][role="textbox"]',
      ),
    ].filter(isField);
    const groups = new Map<string, HTMLElement[]>();
    for (const control of controls) {
      const type = (control.getAttribute('type') ?? '').toLowerCase();
      const name = control.getAttribute('name');
      if ((type === 'radio' || type === 'checkbox') && name) {
        const key = `${type}:${name}`;
        groups.set(key, [...(groups.get(key) ?? []), control]);
      }
    }
    const found: Found[] = [];
    const done = new Set<HTMLElement>();
    for (const control of controls) {
      if (done.has(control) || found.length >= MAX_FIELDS) continue;
      const type = (control.getAttribute('type') ?? '').toLowerCase();
      const name = control.getAttribute('name') ?? '';
      const id = control.getAttribute('id') ?? '';
      const group = groups.get(`${type}:${name}`);
      let field: Omit<PageField, 'ref' | 'key' | 'section'>;
      let members = [control];
      if (group && (type === 'radio' || group.length > 1)) {
        members = group;
        for (const each of group) done.add(each);
        // The group's question is above its options: a legend, a group's label, or the words before it.
        const set = control.closest('fieldset');
        const role = control.closest('[role="radiogroup"], [role="group"]');
        let common: Element | null = control.parentElement;
        while (common && !group.every((each) => common?.contains(each)))
          common = common.parentElement;
        // The words before the first option, inside the group's own box, or else above the box.
        const first = control.closest('label') ?? control;
        const raw =
          wordsOf(set?.querySelector('legend') ?? null) ||
          groupWords(role) ||
          (common ? wordsBefore(common, first) || wordsAbove(common) : '') ||
          '';
        field = {
          question: cut(cleanQuestion(raw)),
          hint: '',
          control: type === 'radio' ? 'choice' : 'choices',
          type: type.slice(0, 40),
          autocomplete: '',
          name: cut(squash(`${name} ${id}`)),
          options: group.slice(0, MAX_FIELDS).map(optionWords),
          required: group.some((each) => (each as HTMLInputElement).required) || marksRequired(raw),
          limit: null,
        };
      } else {
        done.add(control);
        const own = questionOf(control);
        // A date's parts, such as "Month" and "Year", are asked by the set they're in, such as
        // "Start date *", which may mark them as required.
        const set = /^(day|month|year)$/i.test(own.question)
          ? groupWords(control.closest('fieldset, [role="group"]'))
          : '';
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
              : role === 'combobox' || control.getAttribute('aria-autocomplete') === 'list'
                ? 'combo'
                : type === 'checkbox'
                  ? 'check'
                  : type === 'radio'
                    ? 'choice'
                    : type === 'file'
                      ? 'file'
                      : type === 'number'
                        ? 'number'
                        : type === 'date'
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
            control.closest('[role="group"][aria-required="true"]') !== null ||
            marksRequired(raw),
          limit: limitOf(control, `${raw} ${hint}`),
        };
      }
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

  /** An option's words, as compared: lowercase, with only its letters and digits. */
  const plain = (text: string) =>
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
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
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    if (leave) box.blur();
  };

  /**
   * Clicks an element as a person would: the mouse goes down, comes up, then it's a click. A
   * button that would submit its form only has the mouse go down and up on it, never the click.
   */
  const press = (element: Element) => {
    const view = doc.defaultView;
    const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    const like = {
      bubbles: true,
      cancelable: true,
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
    if (!submits(element)) (element as HTMLElement).click();
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
   * The words a box that offers choices shows: what's typed in it, or the option picked, which
   * such a box shows beside its input. The nearest box around it with words, and no other field,
   * says it. Words that only say to pick, as "Select…", are none.
   */
  const comboShows = (control: HTMLElement): string => {
    const value = (control as HTMLInputElement).value ?? '';
    let up = control.parentElement;
    for (let level = 0; level < 4 && up && up !== doc.body; level++, up = up.parentElement) {
      const fields = up.querySelectorAll(
        'input:not([type="hidden"]):not([aria-hidden="true"]), select, textarea',
      );
      if (fields.length > 1) break;
      const words = wordsOf(up);
      if (words) return PLACEHOLDERS.test(words) ? value : squash(`${value} ${words}`);
    }
    return value;
  };

  /** What a field shows now: its text, the option picked, or the file's name. */
  const shownIn = (found: Found): string => {
    const [control] = found.controls;
    if (!control) return '';
    const { field } = found;
    if (field.control === 'choice' || field.control === 'choices') {
      if (control instanceof HTMLSelectElement) {
        // An option with no value, such as "Select…", is none picked.
        return [...control.selectedOptions]
          .filter((option) => option.value !== '')
          .map((option) => squash(option.text))
          .join(', ');
      }
      return found.controls
        .filter((each) => (each as HTMLInputElement).checked)
        .map(optionWords)
        .join(', ');
    }
    if (field.control === 'check') return (control as HTMLInputElement).checked ? 'Checked' : '';
    if (field.control === 'file') {
      return [...((control as HTMLInputElement).files ?? [])].map((file) => file.name).join(', ');
    }
    if (field.control === 'combo') return comboShows(control);
    if (field.type === 'password') return '';
    if (control.isContentEditable) return squash(control.textContent ?? '');
    return (control as HTMLInputElement).value ?? '';
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
    if (answer.file && field.control === 'file') {
      const bytes = Uint8Array.from(atob(answer.file.base64), (char) => char.charCodeAt(0));
      const files = new DataTransfer();
      files.items.add(new File([bytes], answer.file.name, { type: answer.file.type }));
      const input = control as HTMLInputElement;
      input.files = files.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return done((input.files?.length ?? 0) === 1);
    }
    const picks = answer.pick ?? (answer.text !== undefined ? [answer.text] : []);
    if (field.control === 'choice' || field.control === 'choices') {
      if (control instanceof HTMLSelectElement) {
        const option = pickOf([...control.options], (each) => each.text, picks, answer.exact);
        if (!option) return done(false, 'no-option');
        option.selected = true;
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
        return done(option.selected);
      }
      if (field.control === 'choice') {
        const option = pickOf(controls, optionWords, picks, answer.exact);
        if (!option) return done(false, 'no-option');
        if (!(option as HTMLInputElement).checked) press(option);
        return done((option as HTMLInputElement).checked);
      }
      let any = false;
      for (const pick of picks) {
        const option = pickOf(controls, optionWords, [pick], answer.exact);
        if (!option) continue;
        if (!(option as HTMLInputElement).checked) press(option);
        any = any || (option as HTMLInputElement).checked;
      }
      return done(any, 'no-option');
    }
    if (field.control === 'check') return done(false, 'not-taken');
    if (field.control === 'combo') {
      const box = control as HTMLInputElement;
      const optionWords = (each: Element) => each.textContent ?? '';
      /**
       * Picks an option, as a person would, and says whether the box shows it then: its words, or
       * anything new, as a box for a phone's country shows only its code.
       */
      const choose = async (option: Element) => {
        const words = squash(option.textContent ?? '');
        const before = comboShows(box);
        press(option);
        const took = await waitFor(() => {
          const shows = comboShows(box);
          return plain(shows).includes(plain(words)) || (shows !== '' && shows !== before);
        }, 1000);
        box.blur();
        return Boolean(took);
      };
      // Opened with a press, as a person would: its list shows at once when it's the page's own.
      press(box);
      const listed = await waitFor(
        () => pickOf(listOf(box), optionWords, picks, answer.exact),
        800,
      );
      if (listed && (await choose(listed))) return done(true);
      // A list that comes from the site's own server, such as of places, shows as you type, in a
      // box you can see.
      for (const pick of picks.slice(0, 3)) {
        if (!pick || !(box instanceof HTMLInputElement) || !visible(box)) continue;
        if (box.getAttribute('aria-expanded') !== 'true') press(box);
        typeInto(box, pick, false);
        const option = await waitFor(
          () => pickOf(listOf(box), optionWords, picks, answer.exact),
          3000,
        );
        if (option && (await choose(option))) return done(true);
      }
      box.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
      );
      if (box instanceof HTMLInputElement && box.value) typeInto(box, '');
      box.blur();
      return done(false, picks.length > 0 ? 'no-option' : 'not-taken');
    }
    const text = answer.text ?? picks[0] ?? '';
    if (control.isContentEditable) {
      control.focus({ preventScroll: true });
      control.textContent = text;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.blur();
      return done(squash(control.textContent ?? '') === squash(text));
    }
    const box = control as HTMLInputElement | HTMLTextAreaElement;
    typeInto(box, field.limit && text.length > field.limit ? text.slice(0, field.limit) : text);
    // A page may tidy what's typed, such as a phone number's spaces: the same digits and letters took.
    return done(
      plain(box.value) === plain(text) ||
        plain(box.value).replace(/ /g, '') === plain(text).replace(/ /g, ''),
    );
  };

  /** Outlines a field in orange, as what's left for you, until it has an answer. */
  const outline = (found: Found) => {
    const [first] = found.controls;
    if (!first) return;
    const target =
      found.controls.length > 1
        ? (found.controls[0]?.closest('fieldset, [role="radiogroup"], [role="group"], ul, ol') ??
          first)
        : found.field.control === 'combo'
          ? (first.closest('[class*="control"]') ?? first)
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
    }
  };

  const fields = readFields();
  if (task.do === 'read') {
    const words = squash(doc.body?.innerText ?? doc.body?.textContent ?? '');
    return {
      did: 'read',
      form: {
        url: href,
        title: doc.title,
        fields: fields.map(({ field }) => field),
        submitted: SUBMITTED.test(words.slice(0, 20_000)),
      },
    };
  }
  if (task.do === 'fill') {
    // Only the form it read, at the same address, but for what's after its #.
    if (task.url.split('#')[0] !== href.split('#')[0]) return { did: 'elsewhere' };
    // Nothing done here submits the form: a page's own code that would is stopped meanwhile.
    const view = doc.defaultView;
    const stop = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    view?.addEventListener('submit', stop, true);
    try {
      const filled: FieldFilled[] = [];
      for (const answer of task.answers) {
        const found = findField(fields, answer.ref, answer.key);
        if (!found) {
          filled.push({ ref: answer.ref, ok: false, shown: '', why: 'moved' });
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
    };
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
