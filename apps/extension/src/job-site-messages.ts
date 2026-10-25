import type {
  FieldAnswer,
  FieldFilled,
  FieldValue,
  PageAdder,
  PageField,
  PageForm,
} from './page/form.ts';

/**
 * What the extension's script on a job site you allowed (src/content.ts), its own frame there
 * (src/frame.ts) and its background (src/on-job-sites.ts) say to each other. The script asks for
 * what to show, and never holds an answer but the one you pick, as it writes it. The frame shows
 * the answers, which the page can't read. The background checks each message, as each one could
 * come from a page that's misbehaving, and answers only for a site you allowed. The script runs in
 * each frame from such a site, as a company's careers page shows an applicant system's form in
 * one, and the background tells each frame's apart, by the frame's own number, as the browser
 * gives it, and the frame's by the names its script gives them.
 */

/** What a menu shows: an answer, and where it came from. */
export interface MenuAnswer {
  text: string;
  from: string;
}

/** A new answer you gave, which the menu offers to keep in Profile. */
export interface SaveOffer {
  question: string;
  text: string;
  /** Whether Profile keeps it on this computer alone, as your equal-opportunity answers. */
  private: boolean;
}

/** What the background says of a field, as the script asks before it shows a menu. */
export interface FieldMenu {
  ref: number;
  key: string;
  /** How many answers its menu has. */
  answers: number;
  /** Whether what you give it is one Profile can keep, so leaving it may offer to save it. */
  keeps: boolean;
  /**
   * Whether it's one of the form's own questions nothing on file answers, whose menu offers to
   * have your Claude draft them, for a job you saved.
   */
  draft: boolean;
}

/**
 * Your Claude drafting a form's own questions, as a field's menu says it: the offer to, drafting,
 * waiting on you in Factwright, left with the job through sync, or why it couldn't, with how many
 * questions it's for.
 */
export interface DraftShows {
  is: 'offer' | 'drafting' | 'waiting' | 'left' | 'failed';
  questions: number;
  through: 'computer' | 'sync';
  /** What went wrong, as Factwright said it. */
  says?: string;
}

/** What the script asks the background. */
export type FromScript =
  /**
   * Whether it's on a site you allowed, as it starts, by its own name for the page it's on, and
   * the sites of the pages around it, as the browser says them, where it does: Chrome's.
   */
  | { type: 'job-site'; do: 'hello'; doc: string; around: string[] }
  /** The page it's on is going, as when its frame shows another. */
  | { type: 'job-site'; do: 'bye'; doc: string }
  /** The answers for the form's fields, read without what's in them, the first time you're in one. */
  | { type: 'job-site'; do: 'form'; form: PageForm; job: { company: string; role: string } }
  /**
   * To show a menu beside a field, by a token its frame names: the field's answers, the offer to
   * keep the new answer you last gave, or both, as there's room for.
   */
  | {
      type: 'job-site';
      do: 'menu';
      ref: number;
      key: string;
      token: string;
      answers: boolean;
      save: boolean;
    }
  /** You left a field Profile can keep the answer to, with what you gave it. */
  | { type: 'job-site'; do: 'left'; ref: number; key: string; value: string }
  /** The menu closed, as you clicked elsewhere. */
  | { type: 'job-site'; do: 'closed'; token: string }
  /**
   * On a page of an application that runs over several, as Workday's, you left one of its
   * fields, or the page went on to another in the same tab: the panel filling it looks at it now,
   * before what you typed is gone with the page.
   */
  | { type: 'job-site'; do: 'look'; doc: string }
  /**
   * You submitted the form, or pressed a page's own Save and Continue: what its fields held, and
   * whether its button sends the application (`final`), rather than going on to another page.
   */
  | {
      type: 'job-site';
      do: 'submitting';
      doc: string;
      form: PageForm;
      job: { company: string; role: string };
      values: FieldValue[];
      final: boolean;
    }
  /**
   * What the page shows since you submitted: whether it says the application went in, whether
   * it shows an application form, and whether it shows what's wrong with an answer.
   */
  | {
      type: 'job-site';
      do: 'outcome';
      doc: string;
      submitted: boolean;
      form: boolean;
      errors: boolean;
    };

/** What a note on a page says, as its frame shows it (src/notes.ts). */
export type NoteSays =
  /** Fill filled the form in place: how many fields, and how many need you, for a job you saved. */
  | { is: 'filled'; filled: number; need: number; job: boolean }
  /**
   * It noticed you submitted the job's application, by its title and company, and marked it
   * applied: Undo takes that back, and once it has, the note says where the job is now, or why
   * it couldn't.
   */
  | { is: 'applied'; job: string; undo: 'can' | 'undone' | 'cannot'; says?: string }
  /** What stopped it. */
  | { is: 'problem'; says: string };

/** What the frame asks the background. */
export type FromFrame =
  /** What the menu shows. */
  | { type: 'job-site'; do: 'shows'; token: string }
  /** You picked one of its answers. */
  | { type: 'job-site'; do: 'pick'; token: string; at: number }
  /** You chose to save the new answer it offered. */
  | { type: 'job-site'; do: 'save'; token: string }
  /** You closed it, with Not now, or with Escape, which puts the cursor back in its field. */
  | { type: 'job-site'; do: 'dismiss'; token: string; refocus: boolean }
  /** You chose to have your Claude draft the form's own questions nothing on file answers. */
  | { type: 'job-site'; do: 'draft'; token: string }
  /** You clicked the Fill button, which the script names by its own name for its page. */
  | { type: 'job-site'; do: 'fill'; token: string }
  /** You hid the Fill button on this page. */
  | { type: 'job-site'; do: 'hide-button'; token: string }
  /** What a note says, by the token it names. */
  | { type: 'job-site'; do: 'note'; token: string }
  /** You clicked a note's Details, which opens the panel. */
  | { type: 'job-site'; do: 'details'; token: string }
  /** You clicked a note's Undo, which takes back marking its job applied. */
  | { type: 'job-site'; do: 'undo'; token: string }
  /** You closed a note. */
  | { type: 'job-site'; do: 'unnote'; token: string };

/** What the background tells the script. */
export type ToScript =
  /** Put the answer you picked in its field. */
  | { type: 'job-site'; do: 'write'; answer: FieldAnswer }
  /** Close the menu, and put the cursor back in its field. */
  | { type: 'job-site'; do: 'close'; refocus: boolean }
  /** Hide the Fill button on this page. */
  | { type: 'job-site'; do: 'hide-button' }
  /** Put a note on the page, in place of the Fill button, by the token its frame names. */
  | { type: 'job-site'; do: 'note'; token: string }
  /** Take that note away, as you closed it. */
  | { type: 'job-site'; do: 'unnote'; token: string }
  /** Stop: the site isn't one you allow anymore. */
  | { type: 'job-site'; do: 'stop' };

/** What filling a form in its page came to, as the Fill button, the popup and the shortcut ask. */
export type FilledHere =
  | { did: 'filled'; filled: number; need: number; job: boolean }
  | { did: 'problem'; says: string };

/**
 * What the background tells the panel: a tab's form was filled in its page, which the panel shows
 * if it's beside that tab, or look at a tab's form now, as you left a field of an application that
 * runs over several, or its page changed.
 */
export type ToPanel =
  | { type: 'panel'; do: 'filled'; tabId: number }
  | { type: 'panel'; do: 'look'; tabId: number };

/** The most fields a form's message carries, and the longest of its words, as the form reads them. */
const MAX_FIELDS = 300;
const MAX_TEXT = 500;
const MAX_VALUE = 10_000;
const MAX_URL = 4000;

/** The longest address the script asks about a page at: no job's is longer. */
export const MOST_URL = MAX_URL;

/** The most pages around a frame the script names, by their sites: more than any page nests. */
export const MOST_AROUND = 20;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown, max = MAX_TEXT): value is string =>
  typeof value === 'string' && value.length <= max;

const isPlace = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_FIELDS;

/** A token, as the script makes one for each menu: random, and hard to guess. */
export const isToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f-]{32,40}$/i.test(value);

const CONTROLS = new Set([
  'text',
  'long',
  'number',
  'date',
  'choice',
  'choices',
  'check',
  'combo',
  'file',
]);

/** A field as the form read it, with only what a field has, each within its limit. */
function isPageField(value: unknown, at: number): value is PageField {
  if (!isObject(value)) return false;
  const { ref, key, question, hint, section, control, type, autocomplete, name, options } = value;
  return (
    ref === at &&
    isText(key) &&
    isText(question) &&
    isText(hint) &&
    isText(section) &&
    typeof control === 'string' &&
    CONTROLS.has(control) &&
    isText(type, 40) &&
    isText(autocomplete, 200) &&
    isText(name) &&
    Array.isArray(options) &&
    options.length <= MAX_FIELDS &&
    options.every((option) => isText(option)) &&
    typeof value.required === 'boolean' &&
    (value.limit === null ||
      (typeof value.limit === 'number' && Number.isInteger(value.limit) && value.limit > 0))
  );
}

/** A button that adds a part to a form, as the script read it. */
const isPageAdder = (value: unknown): value is PageAdder =>
  isObject(value) && isText(value.section) && isText(value.words);

/**
 * A form as the script read it: its address, title and fields, in order, each as a field is, the
 * page of its application it's on, and its buttons that add a part.
 */
function isPageForm(value: unknown): value is PageForm {
  if (!isObject(value)) return false;
  const { url, title, fields, submitted, step, adders } = value;
  return (
    isText(url, MAX_URL) &&
    isText(title, 1000) &&
    typeof submitted === 'boolean' &&
    isText(step) &&
    Array.isArray(adders) &&
    adders.length <= MAX_FIELDS &&
    adders.every(isPageAdder) &&
    Array.isArray(fields) &&
    fields.length <= MAX_FIELDS &&
    fields.every(isPageField)
  );
}

/** Whether a message is one the script sends, with everything as it has it. */
export function isFromScript(message: unknown): message is FromScript {
  if (!isObject(message) || message.type !== 'job-site') return false;
  switch (message.do) {
    case 'hello':
      return (
        isToken(message.doc) &&
        Array.isArray(message.around) &&
        message.around.length <= MOST_AROUND &&
        message.around.every((site) => isText(site, MAX_URL))
      );
    case 'bye':
    case 'look':
      return isToken(message.doc);
    case 'form':
      return (
        isPageForm(message.form) &&
        isObject(message.job) &&
        isText(message.job.company) &&
        isText(message.job.role)
      );
    case 'menu':
      return (
        isPlace(message.ref) &&
        isText(message.key) &&
        isToken(message.token) &&
        typeof message.answers === 'boolean' &&
        typeof message.save === 'boolean'
      );
    case 'left':
      return isPlace(message.ref) && isText(message.key) && isText(message.value, MAX_VALUE);
    case 'closed':
      return isToken(message.token);
    case 'submitting':
      return (
        isToken(message.doc) &&
        isPageForm(message.form) &&
        isObject(message.job) &&
        isText(message.job.company) &&
        isText(message.job.role) &&
        typeof message.final === 'boolean' &&
        Array.isArray(message.values) &&
        message.values.length <= MAX_FIELDS &&
        message.values.every(
          (each) =>
            isObject(each) &&
            isPlace(each.ref) &&
            isText(each.key) &&
            isText(each.value, MAX_VALUE),
        )
      );
    case 'outcome':
      return (
        isToken(message.doc) &&
        typeof message.submitted === 'boolean' &&
        typeof message.form === 'boolean' &&
        typeof message.errors === 'boolean'
      );
    default:
      return false;
  }
}

/** Whether a message is one the frame sends. */
export function isFromFrame(message: unknown): message is FromFrame {
  if (!isObject(message) || message.type !== 'job-site') return false;
  switch (message.do) {
    case 'shows':
    case 'save':
    case 'draft':
      return isToken(message.token);
    case 'dismiss':
      return isToken(message.token) && typeof message.refocus === 'boolean';
    case 'pick':
      return isToken(message.token) && isPlace(message.at);
    case 'fill':
    case 'hide-button':
    case 'note':
    case 'details':
    case 'undo':
    case 'unnote':
      return isToken(message.token);
    default:
      return false;
  }
}

/** Whether a message is one the background sends the script. */
export function isToScript(message: unknown): message is ToScript {
  if (!isObject(message) || message.type !== 'job-site') return false;
  switch (message.do) {
    case 'write':
      return isObject(message.answer) && isPlace(message.answer.ref) && isText(message.answer.key);
    case 'close':
      return typeof message.refocus === 'boolean';
    case 'hide-button':
    case 'stop':
      return true;
    case 'note':
    case 'unnote':
      return isToken(message.token);
    default:
      return false;
  }
}

/** Whether a message is the background's, for the panel to show a fill, or look at a form again. */
export function isToPanel(message: unknown): message is ToPanel {
  if (!isObject(message) || message.type !== 'panel' || typeof message.tabId !== 'number') {
    return false;
  }
  return message.do === 'look' || message.do === 'filled';
}

/** How writing a picked answer went, as the script says it. */
export interface Written {
  filled: FieldFilled | null;
}
