import 'virtual:theme.css';
import './ui.css';
import {
  ASK_FIELDS,
  type AskedJob,
  type FieldReply,
  isLinkedIn,
  type LeftFor,
} from '@factwright/core';
import { allowSync } from './account.ts';
import {
  allowCareersSite,
  allowJobSites,
  careersSiteOf,
  chosen,
  framedSystem,
  isAllowedPage,
  onJobSite,
  removeCareersSite,
  runInFrames,
  stopJobSites,
} from './application-sites.ts';
import { canReachComputer, saveOnComputer } from './computer.ts';
import { type Child, h, heading, show } from './dom.ts';
import { ext } from './ext.ts';
import {
  addParts,
  answerSource,
  askForDrafts,
  draftable,
  draftsSoFar,
  type FillPlan,
  type FormPlace,
  type FormValues,
  fieldsToRead,
  fillAnswers,
  filledSummary,
  fillForm,
  fillInPasses,
  findForm,
  formValues,
  isCopyOnly,
  looksLikeApplication,
  type NewAnswer,
  newAnswers,
  outlineFields,
  planFill,
  replyText,
  sentAnswers,
  showField,
} from './fill.ts';
import { type FillWay, fillWays, firstAnswer } from './fill-way.ts';
import { isToPanel } from './job-site-messages.ts';
import { askToSave } from './messages.ts';
import type { FieldFilled, FieldValue, PageAdder, PageField, PageForm } from './page/form.ts';
import { isWebPage, readFormJob, readFormPage } from './read-tab.ts';
import { serverName } from './server.ts';
import { settings } from './settings.ts';
import {
  carriedOn,
  type Earlier,
  forApplication,
  joinOffers,
  joinSent,
  type NextPage,
  NO_EARLIER,
  nextPageOf,
  onSamePage,
  partsOffers,
} from './several-pages.ts';
import { toSave } from './tab-job.ts';

/**
 * The side panel beside the page, where filling an application form is checked. It reads the
 * form in the tab you clicked Fill on, asks Factwright on this computer, or your job hunt through
 * sync (src/fill-way.ts), for an answer to each field, fills them, and lists every field with its
 * answer and where the answer came from. What's left for you is outlined in orange on the page.
 * Once you've submitted the form on the site, Mark as applied records what you sent. Factwright
 * never submits anything.
 */

const app = document.getElementById('app') as HTMLElement;

/** How often it reads what's in the form, while the panel shows, to have what you sent. */
const LOOK_EVERY_MS = 3000;

/** Native messaging, which filling a form needs, to reach Factwright on this computer. */
const NATIVE = { permissions: ['nativeMessaging'] };

/** How often it asks how your Claude's drafts are coming along, while it drafts them. */
const DRAFTS_EVERY_MS = 3000;

/** How long it follows your Claude's drafts: a long application's take a few minutes. */
const DRAFTS_FOR_MS = 20 * 60 * 1000;

/** Your Claude drafting the form's own questions in Factwright, as the panel follows it. */
interface Drafting {
  /** The fields it's drafting, by their keys. */
  keys: Set<string>;
  /** Whether it's waiting on you in Factwright, for an answer or a permission. */
  waiting: boolean;
  /** When it started. */
  since: number;
}

/**
 * A form being filled: the tab it's in, and the frame, as a company's careers page can show an
 * applicant system's form in one, what was read and answered, and how filling went.
 */
interface Filling {
  tabId: number;
  place: FormPlace;
  /** The way its answers came: Factwright on this computer, or your job hunt through sync. */
  way: FillWay;
  /** Whether sync answered because Factwright on this computer wasn't there to. */
  instead: boolean;
  /**
   * Through sync, whether to offer Factwright on this computer, which the browser doesn't let the
   * extension reach yet.
   */
  offerComputer: boolean;
  form: PageForm;
  plan: FillPlan;
  /** The company and job title the page shows, which the job the form is for is found by. */
  shows: { company: string; role: string };
  /** How filling each field went, by its key, as a form's fields can move as it changes. */
  filled: Map<string, FieldFilled>;
  /** LinkedIn's or Indeed's own form, where it only gives answers to copy. */
  copyOnly: boolean;
  /** What was in the form when it last looked: what you sent, once you've submitted it. */
  values: FieldValue[] | null;
  /** Whether the tab has moved on from the form, as after you submit it. */
  moved: boolean;
  /** Whether another tab is in front, so the panel says which page it's for. */
  elsewhere: boolean;
  /** Whether it's filling the form now, when its buttons wait. */
  busy: boolean;
  /** What's happening now, said above the fields. */
  status: string;
  /** The job once you've marked it applied, and the answers it offers to keep. */
  applied: { job: AskedJob; offers: NewAnswer[]; saved: Set<string> } | null;
  /** Your Claude drafting the form's own questions, while it does. */
  drafting: Drafting | null;
  /** Through sync: how many of the form's questions it left with the job for your Claude. */
  left: number | null;
  /** Whether Factwright's menus and Fill button show on the form's site, as you allowed. */
  site: SiteChoice;
  /** What the application's earlier pages gave, for one that runs over several. */
  earlier: Earlier;
  /**
   * The page the application went on to in the tab, as you pressed its own Save and Continue, by
   * the name its steps give it, with how many fields it has: the panel offers to fill it.
   */
  next: NextPage | null;
  /**
   * How many looks in a row couldn't read the tab, on an application that runs over several
   * pages: one whose next page loads anew may leave the browser not letting the panel read it.
   */
  missed: number;
}

/**
 * How many looks in a row that can't read an application of several pages say the browser doesn't
 * let the panel read it now: more than a page takes to load.
 */
const MISSES = 3;

/**
 * The form's site, as the panel offers Factwright's menus and Fill button on it: one of the job
 * application sites, or a careers site, allowed or not. LinkedIn's and Indeed's never are.
 */
type SiteChoice =
  | { is: 'never' }
  | { is: 'job-site' | 'careers-site'; allowed: boolean; site: string };

/** The form being filled, and only it: whatever an earlier start of filling was doing stops. */
let filling: Filling | null = null;
let looking: ReturnType<typeof setInterval> | null = null;
/** A look at the form now, as it's read every few seconds, while it is. */
let lookNow: (() => void) | null = null;
/** The next look at how your Claude's drafts are coming along. */
let following: ReturnType<typeof setTimeout> | null = null;
/** How many times filling has started, so an earlier start that's still going stops there. */
let starts = 0;
/** When filling last started, so a Fill button clicked before then doesn't start it again. */
let startedAt = 0;

const button = (text: string, click: () => void, primary = false, disabled = false) =>
  h(
    'button',
    {
      type: 'button',
      class: primary ? 'primary' : '',
      disabled,
      on: { click },
    },
    text,
  );

const small = (text: string, click: () => void, label: string) =>
  h('button', { type: 'button', class: 'small-button', 'aria-label': label, on: { click } }, text);

function message(text: string, ...more: Child[]): void {
  stopLooking();
  stopFollowing();
  show(app, heading('Fill this application'), h('p', {}, text), ...more);
}

/** A date as the panel says it: "Oct 12". */
const day = (on: string) =>
  new Date(`${on}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** Why a field is left for you, in words. */
const LEFT: Record<LeftFor, string> = {
  never: 'Factwright never fills this',
  consent: 'Yours to agree to',
  personal: 'Yours to answer. Factwright doesn’t keep it',
  unset: 'Not in Profile yet',
  sensitive: 'An equal-opportunity question, for you',
  new: 'A question for you',
  pick: 'Yours to pick on the page',
  private: 'Kept on your computer alone, not in sync',
};

/** What the form held, as read before, with what it holds now in place of it, field by field. */
function merged(before: readonly FieldValue[] | null, now: readonly FieldValue[]): FieldValue[] {
  const keys = new Set(now.map((each) => each.key));
  return [...(before ?? []).filter((each) => !keys.has(each.key)), ...now];
}

/**
 * What this page of an application that runs over several, and its earlier pages, gave, for the
 * next page the panel fills in the same tab (several-pages.ts).
 */
const carried = (state: Filling): Earlier =>
  carriedOn(
    {
      form: state.form,
      replies: state.plan.replies,
      filled: state.filled,
      values: state.values,
      job: state.plan.job?.id ?? null,
      copyOnly: state.copyOnly,
    },
    state.earlier,
  );

/** What only a resume answers, which a field Profile can't fill is left for when none says. */
const FROM_RESUMES = new Set<FieldReply['kind']>(['skills', 'certifications', 'summary']);

/** What a form asks that your work history in Profile says, or else your resumes: each job and school. */
const FROM_HISTORY = new Set<FieldReply['kind']>([
  'current-company',
  'current-title',
  'job-start',
  'job-end',
  'job-location',
  'job-summary',
  'school',
  'degree',
  'discipline',
  'graduation',
  'edu-start',
]);

/** Why a field is left for you, in words, as the field's kind says it best. */
function leftFor(reply: FieldReply): string {
  // Your Claude's reason, as "For you: your notice period isn't on file".
  if (reply.left === 'new' && reply.from) return reply.from;
  if (reply.left === 'unset') {
    if (reply.kind === 'resume') return 'This job has no resume yet';
    if (reply.kind === 'cover-letter') return 'This job has no cover letter yet';
    if (FROM_HISTORY.has(reply.kind)) return 'Not in your work history or resumes yet';
    if (FROM_RESUMES.has(reply.kind)) return 'Not on your resumes yet';
  }
  // A newer Factwright may have a reason this doesn't know yet.
  return LEFT[reply.left ?? 'new'] ?? LEFT.new;
}

/** Where an answer came from, in words, or why the field is left for you. */
const source = (reply: FieldReply): string =>
  reply.source === 'you' ? leftFor(reply) : answerSource(reply);

/** How filling a field went, in words, when it didn't take. */
const NOT_FILLED: Record<Exclude<FieldFilled['why'], ''>, string> = {
  moved: 'The form changed. Click Fill again.',
  'no-option': 'None of its options matched. Pick one on the page.',
  'not-taken': 'The page didn’t take it. Copy it in.',
  'other-part':
    'This part has another job or school in it, as the site filled it in. Fill it in yourself.',
  reloads:
    'The page sends itself when this changes, which would stop filling midway. Fill it in yourself, then Fill again.',
};

/** Copies an answer, and says so on the button for a moment. */
function copy(text: string, target: HTMLButtonElement): void {
  void navigator.clipboard.writeText(text).then(
    () => {
      target.textContent = 'Copied';
      setTimeout(() => {
        target.textContent = 'Copy';
      }, 1500);
    },
    () => {
      target.textContent = 'Couldn’t copy';
    },
  );
}

/** One field, as the panel lists it: its question, its answer, where it came from, and what to do. */
function fieldRow(state: Filling, at: number): HTMLElement {
  const field = state.form.fields[at];
  const reply = state.plan.replies[at];
  if (!field || !reply) return h('li', {});
  const result = state.filled.get(field.key);
  // A choice shows the option the page picked, which may be another name for Factwright's answer,
  // and a field that held an answer already, as a site may fill in from your resume, that one.
  const picked =
    result?.ok &&
    result.shown &&
    (result.kept || field.control === 'choice' || field.control === 'choices');
  const text = picked ? result.shown : replyText(reply);
  // Orange, as the app marks what needs you: what didn't take, and what's needed and left for
  // you. A field you may leave blank, with nothing on file for it, isn't.
  const yours = (result !== undefined && !result.ok) || (reply.source === 'you' && field.required);
  const note = result && !result.ok && result.why ? NOT_FILLED[result.why] : '';
  const copyButton = text
    ? h(
        'button',
        {
          type: 'button',
          class: 'small-button',
          'aria-label': `Copy the answer to ${field.question || 'this field'}`,
          on: {
            click: (event) => copy(text, event.currentTarget as HTMLButtonElement),
          },
        },
        'Copy',
      )
    : null;
  return h(
    'li',
    { class: `field${yours ? ' yours' : ''}` },
    h(
      'div',
      { class: 'question' },
      field.question || 'A field with no question',
      field.required && h('span', { class: 'muted' }, ' (required)'),
    ),
    text && h('div', { class: 'answer' }, text),
    note && h('div', { class: 'meta bad' }, note),
    h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'meta' },
        result?.ok && h('span', { class: 'ok', 'aria-label': 'Filled' }, '✓ '),
        result?.kept ? 'It had an answer already, which Factwright left as it was' : source(reply),
      ),
      h(
        'div',
        { class: 'row-actions' },
        small(
          'Go to',
          () => void showField(state.place, field),
          `Go to ${field.question || 'the field'} on the page`,
        ),
        copyButton,
      ),
    ),
  );
}

/** The line that says which job the form is for, or offers to save it first. */
function jobLine(state: Filling): Child[] {
  const { job } = state.plan;
  if (!job) {
    return [
      h(
        'p',
        { class: 'note' },
        'This job isn’t in your job hunt yet. Save it first, so Factwright uploads its resume and keeps what you send.',
      ),
      h(
        'div',
        { class: 'actions' },
        button('Save this job first', () => void saveFirst(state)),
      ),
    ];
  }
  return [
    h('p', { class: 'small' }, [job.role, job.company].filter(Boolean).join(' at ')),
    job.appliedOn &&
      h('p', { class: 'note', role: 'status' }, `You applied on ${day(job.appliedOn)}.`),
  ];
}

/** Where the answers came from, through sync: your job hunt, with Factwright closed here or not. */
function wayLine(state: Filling): Child[] {
  if (state.way.via !== 'sync') return [];
  return [
    h(
      'p',
      { class: 'small muted' },
      state.instead
        ? 'From your job hunt, through sync, as Factwright isn’t open on this computer.'
        : 'From your job hunt, through sync.',
    ),
  ];
}

const questions = (count: number) => `${count} ${count === 1 ? 'question' : 'questions'}`;

/**
 * Through sync, what the panel says of the form's own questions that nothing on file answers: an
 * offer to leave them with the job, for your Claude in Factwright to draft, or that they're left.
 */
function leaveLine(state: Filling): Child[] {
  if (state.left !== null) {
    return [
      h(
        'p',
        { class: 'note', role: 'status' },
        `Left ${questions(state.left)} with the job. In Factwright on your computer, the job’s Application questions has Draft them with your Claude. Once its drafts sync, click Fill again here.`,
      ),
    ];
  }
  const left = draftable(state.form, state.plan.replies, state.filled);
  if (left.length === 0) return [];
  return [
    h(
      'p',
      { class: 'small' },
      left.length === 1
        ? 'Nothing on file answers one of the form’s questions. Leave it with the job, and your Claude can draft it in Factwright on your computer.'
        : `Nothing on file answers ${left.length} of the form’s questions. Leave them with the job, and your Claude can draft them in Factwright on your computer.`,
    ),
    h(
      'div',
      { class: 'actions' },
      button(
        left.length === 1 ? 'Leave it for your Claude' : 'Leave them for your Claude',
        () => void leave(state),
        false,
        state.busy,
      ),
    ),
  ];
}

const answers = (count: number) => `${count} ${count === 1 ? 'answer' : 'answers'}`;

/**
 * What the panel says of your Claude's drafts: how they're coming along, or an offer to draft
 * the form's own questions that nothing on file answers.
 */
function draftLine(state: Filling): Child[] {
  if (!state.plan.job) return [];
  if (state.way.via === 'sync') return leaveLine(state);
  if (state.drafting) {
    return [
      h(
        'p',
        { class: 'note', role: 'status' },
        state.drafting.waiting
          ? 'Your Claude is waiting for you in Factwright. Answer it there, and it carries on.'
          : `Your Claude is drafting ${answers(state.drafting.keys.size)} in Factwright. They fill in here once they’re done.`,
      ),
    ];
  }
  // A page the application went on from has no questions to draft for now.
  if (state.next) return [];
  const left = draftable(state.form, state.plan.replies, state.filled);
  if (left.length === 0) return [];
  return [
    h(
      'p',
      { class: 'small' },
      left.length === 1
        ? 'Nothing on file answers one of the form’s questions. Your Claude can draft it in Factwright.'
        : `Nothing on file answers ${left.length} of the form’s questions. Your Claude can draft them in Factwright.`,
    ),
    h(
      'div',
      { class: 'actions' },
      button(
        left.length === 1 ? 'Draft it with your Claude' : 'Draft them with your Claude',
        () => void draft(state),
        false,
        state.busy,
      ),
    ),
  ];
}

/** How many fields were filled, and how many are left for you. */
function summary(state: Filling): string {
  const total = state.form.fields.length;
  if (state.copyOnly) {
    const answered = state.plan.replies.filter((reply) => reply.source !== 'you').length;
    return `Factwright has answers for ${answered} of ${total} fields.`;
  }
  return filledSummary(state.form, state.filled);
}

/**
 * Asks the browser to let the extension reach Factwright on this computer, straight from the
 * click, before anything is waited on, as Firefox wants, and once it does, fills the form again. A
 * page Chrome opened before then can't reach Factwright's helper, so the panel opens again first.
 */
const askForComputer = () =>
  void ext.permissions.request(NATIVE).then((allowed) => {
    if (allowed) location.reload();
  });

/**
 * Through sync, the offer of Factwright on this computer, where the browser doesn't let the
 * extension reach it yet: it answers more of a form.
 */
function computerLine(state: Filling): Child[] {
  if (!state.offerComputer) return [];
  return [
    h(
      'div',
      { class: 'card' },
      h(
        'p',
        { class: 'small' },
        'Is Factwright on this computer? Filling from it adds your street, postal code and equal-opportunity answers, and your Claude drafts new questions at once.',
      ),
      h('div', { class: 'actions' }, button('Use Factwright on this computer', askForComputer)),
    ),
  ];
}

/** The form's site, as the panel offers Factwright's menus and Fill button on it. */
async function siteChoice(url: string): Promise<SiteChoice> {
  if (isCopyOnly(url)) return { is: 'never' };
  const allowed = await isAllowedPage(url);
  if (onJobSite(url)) return { is: 'job-site', allowed, site: url };
  const site = careersSiteOf(url);
  if (!site) return { is: 'never' };
  // A careers site counts as allowed only as one you added, not as a job application site.
  const added = (await chosen()).sites.includes(site);
  return { is: 'careers-site', allowed: allowed && added, site };
}

/**
 * The offer of Factwright's menus and Fill button on the form's site, or a way to turn them off.
 * The browser is asked on the click itself, before anything is waited on, as Firefox wants.
 */
function siteLine(state: Filling): Child[] {
  const { site } = state;
  if (site.is === 'never') return [];
  const changed = (allowed: boolean) => {
    if (filling !== state) return;
    state.site = { ...site, allowed };
    render(state);
  };
  if (site.allowed) {
    return [
      h(
        'div',
        { class: 'card' },
        h(
          'p',
          { class: 'small' },
          site.is === 'job-site'
            ? 'Factwright’s menus and Fill button are on for job application sites.'
            : 'Factwright’s menus and Fill button are on for this site.',
        ),
        h(
          'div',
          { class: 'actions' },
          button(site.is === 'job-site' ? 'Turn them off' : 'Turn them off here', () => {
            void (site.is === 'job-site' ? stopJobSites() : removeCareersSite(site.site)).then(() =>
              changed(false),
            );
          }),
        ),
      ),
    ];
  }
  return [
    h(
      'div',
      { class: 'card' },
      h(
        'p',
        { class: 'small' },
        site.is === 'job-site'
          ? 'Factwright can show its answers in the fields of application forms on job application sites, as you fill them in, and put a Fill button on each. You choose each answer: nothing goes in a field until you pick it.'
          : 'Factwright can show its answers in this site’s form fields, as you fill them in, and put a Fill button on its forms. You choose each answer: nothing goes in a field until you pick it.',
      ),
      h(
        'div',
        { class: 'actions' },
        button(
          site.is === 'job-site' ? 'Turn on for job application sites' : 'Turn on for this site',
          () => {
            const asked =
              site.is === 'job-site' ? allowJobSites() : allowCareersSite(state.form.url);
            void asked.then(changed);
          },
        ),
      ),
    ),
  ];
}

/**
 * The offer to fill the page an application that runs over several went on to, in the same tab,
 * as you pressed its own Save and Continue, or what to do on one with nothing to fill, as its
 * Review is.
 */
function nextLine(state: Filling): Child[] {
  const { next } = state;
  if (!next && state.missed >= MISSES) {
    return [
      h(
        'p',
        { class: 'note', role: 'status' },
        'The application loaded another page, which the browser doesn’t let Factwright read yet. Click the Factwright button on the application’s tab, then Fill this application.',
      ),
    ];
  }
  if (!next) return [];
  if (next.fields === 0) {
    return [
      h(
        'p',
        { class: 'note', role: 'status' },
        `The application is on ${next.step} now, with nothing to fill. Check it, then submit it on the page yourself.`,
      ),
    ];
  }
  return [
    h(
      'div',
      { class: 'card' },
      h('p', { class: 'small', role: 'status' }, `The application is on ${next.step} now.`),
      h(
        'div',
        { class: 'actions' },
        button('Fill this page', () => void begin({ earlier: carried(state) }), true, state.busy),
      ),
    ),
  ];
}

/**
 * The offers to add a part to the form for each job, or school, on file that it has none for yet,
 * as Workday's My Experience starts with one, or none: the form's own Add is pressed only when
 * you choose this, and then the new parts are filled.
 */
function partsLine(state: Filling): Child[] {
  if (state.copyOnly || state.next) return [];
  return partsOffers(state.form, state.plan.blocks).map((offer) =>
    h(
      'div',
      { class: 'card' },
      h('p', { class: 'small' }, offer.says),
      h(
        'div',
        { class: 'actions' },
        button(offer.label, () => void addMore(state, offer.adder, offer.more), false, state.busy),
      ),
    ),
  );
}

function render(state: Filling): void {
  if (state.applied) {
    renderApplied(state);
    return;
  }
  show(
    app,
    heading('Fill this application'),
    ...jobLine(state),
    ...wayLine(state),
    state.copyOnly &&
      h(
        'p',
        { class: 'note' },
        'LinkedIn and Indeed don’t allow filling their forms, so Factwright fills nothing here. Copy each answer, and paste it in yourself.',
      ),
    state.elsewhere &&
      h(
        'p',
        { class: 'note' },
        `This is for “${state.form.title}”. Go back to its tab, or click Fill on this one.`,
      ),
    ...nextLine(state),
    h('p', { class: 'muted small', role: 'status' }, state.status || summary(state)),
    ...partsLine(state),
    ...draftLine(state),
    h(
      'ol',
      { class: 'fields', 'aria-label': 'The form’s fields' },
      ...state.form.fields.map((_, at) => fieldRow(state, at)),
    ),
    state.moved &&
      h('p', { class: 'note' }, 'Did you submit it? Mark as applied keeps what you sent.'),
    h(
      'div',
      { class: 'actions' },
      button('Mark as applied', () => void markApplied(state), state.moved, state.busy),
      // Not once the application went on to another page: that one has its own offer to fill it.
      !state.copyOnly &&
        !state.next &&
        button('Fill again', () => void begin({ earlier: state.earlier }), false, state.busy),
    ),
    h(
      'p',
      { class: 'small muted' },
      'Factwright never submits a form. Check each answer, then submit it on the page yourself.',
    ),
    ...computerLine(state),
    ...siteLine(state),
  );
}

/** What the panel says once you've marked the job applied: what it kept, and what it can keep. */
function renderApplied(state: Filling): void {
  const applied = state.applied;
  if (!applied) return;
  const offers = applied.offers;
  show(
    app,
    heading('Fill this application'),
    h('p', { class: 'ok', role: 'status' }, 'Marked applied.'),
    h(
      'p',
      { class: 'small' },
      `${[applied.job.role, applied.job.company].filter(Boolean).join(' at ')}. Factwright keeps what you sent with the job, and its resume and cover letter as they went out.`,
    ),
    offers.length > 0 && h('h2', {}, 'Keep for next time?'),
    offers.length > 0 &&
      h(
        'p',
        { class: 'small muted' },
        'You answered these, and Profile didn’t have them. Save any you’d like Factwright to fill next time.',
      ),
    offers.length > 0 &&
      h(
        'ul',
        { class: 'fields' },
        ...offers.map((offer) => {
          const saved = applied.saved.has(offer.field.key);
          return h(
            'li',
            { class: 'field' },
            h('div', { class: 'question' }, offer.field.question),
            h('div', { class: 'answer' }, offer.text),
            offer.private &&
              h('div', { class: 'meta' }, 'Kept on this computer only. Claude never sees it.'),
            h(
              'div',
              { class: 'row-actions' },
              saved
                ? h('span', { class: 'ok' }, 'Saved')
                : small(
                    'Save',
                    () => void keep(state, offer),
                    `Save your answer to ${offer.field.question}`,
                  ),
            ),
          );
        }),
      ),
  );
}

/** Keeps one new answer in Profile, as you chose. */
async function keep(state: Filling, offer: NewAnswer): Promise<void> {
  const answer = await state.way.ask({
    ask: 'remember',
    answers: [{ kind: offer.kind, text: offer.text }],
  });
  if (answer.ok && state.applied) {
    state.applied.saved.add(offer.field.key);
    render(state);
  }
}

/** Saves the job the form is for, as the popup would, then fills the form again with it. */
async function saveFirst(state: Filling): Promise<void> {
  state.status = 'Saving this job…';
  render(state);
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id !== state.tabId) {
    state.status = 'Go back to the application’s tab to save it.';
    render(state);
    return;
  }
  const page = await readFormPage(tab, state.place.frameId);
  // Saved the way the form's filled: to Factwright here, or through sync, as the background saves.
  const job = toSave(page);
  const saved =
    state.way.via === 'computer'
      ? await saveOnComputer(job)
      : await askToSave((message) => ext.runtime.sendMessage(message), job);
  if (filling !== state) return;
  if (!saved.ok) {
    state.status = saved.message;
    render(state);
    return;
  }
  await begin();
}

/** Records what you sent, marks the job applied, and offers to keep what Profile didn't have. */
async function markApplied(state: Filling): Promise<void> {
  const { job } = state.plan;
  if (!job) {
    state.status = 'Save this job first, so Factwright knows what you sent.';
    render(state);
    return;
  }
  const latest = state.moved
    ? null
    : await formValues(state.place, fieldsToRead(state.form, state.plan.replies));
  if (filling !== state) return;
  // What it read as you went, with what's there now, when it's still the form.
  const values = merged(
    state.values,
    latest && onSamePage(state.form, latest) ? latest.values : [],
  );
  // With what the application's earlier pages gave, for one that runs over several.
  const earlier = forApplication(state.earlier, job.id, state.form.url);
  const answer = await state.way.ask({
    ask: 'sent',
    job: job.id,
    url: state.form.url,
    answers: joinSent(earlier.sent, sentAnswers(state.form, state.plan.replies, values)).slice(
      0,
      ASK_FIELDS,
    ),
  });
  if (filling !== state) return;
  if (!answer.ok || answer.did !== 'sent') {
    state.status = answer.ok ? 'Factwright didn’t answer. Try again.' : answer.message;
    render(state);
    return;
  }
  stopLooking();
  state.applied = {
    job: answer.job,
    // Profile keeps new answers through Factwright on this computer alone.
    offers:
      state.way.via === 'computer'
        ? joinOffers(
            earlier.offers,
            newAnswers(state.form, state.plan.replies, values, state.filled),
          )
        : [],
    saved: new Set(),
  };
  render(state);
}

/**
 * Presses the form's own button that adds a part, for each job or school on file it has no part
 * for, as you chose, then reads the form again and fills it, leaving what's in its fields as it
 * is.
 */
async function addMore(state: Filling, adder: PageAdder, times: number): Promise<void> {
  state.busy = true;
  state.status = `Adding to ${adder.section}…`;
  render(state);
  const added = await addParts(state.place, state.form.url, adder, times);
  if (filling !== state) return;
  state.busy = false;
  if (typeof added !== 'number' || added === 0) {
    state.status =
      added === 'elsewhere'
        ? 'This tab has moved on from the form. Go back to it, then click Fill again.'
        : `${adder.section} didn’t add a part. Press its ${adder.words} yourself, then click Fill again.`;
    render(state);
    return;
  }
  await begin({ earlier: state.earlier, onlyEmpty: true });
}

function stopLooking(): void {
  if (looking) clearInterval(looking);
  looking = null;
  lookNow = null;
}

function stopFollowing(): void {
  if (following) clearTimeout(following);
  following = null;
}

/**
 * Has your Claude draft answers to the form's own questions that nothing on file answers, in
 * Factwright, then follows along until it's done, and fills them in.
 */
async function draft(state: Filling): Promise<void> {
  const { job } = state.plan;
  const fields = draftable(state.form, state.plan.replies, state.filled);
  if (!job || fields.length === 0) return;
  const drafting: Drafting = {
    keys: new Set(fields.map((field) => field.key)),
    waiting: false,
    since: Date.now(),
  };
  state.drafting = drafting;
  state.status = '';
  render(state);
  const asked = await askForDrafts(state.form, job.id, fields, state.way);
  if (filling !== state || state.drafting !== drafting) return;
  if (!asked.ok || asked.did !== 'draft') {
    state.drafting = null;
    state.status = asked.ok
      ? 'Factwright didn’t answer. Try again.'
      : asked.reason === 'bad-message'
        ? 'Update Factwright on this computer to have your Claude draft these.'
        : asked.message;
    render(state);
    return;
  }
  following = setTimeout(() => void followDrafts(state, drafting), DRAFTS_EVERY_MS);
}

/**
 * Through sync, leaves the form's own questions that nothing on file answers with the job, for
 * your Claude in Factwright on your computer to draft, as Factwright keeps a form's questions.
 */
async function leave(state: Filling): Promise<void> {
  const { job } = state.plan;
  const fields = draftable(state.form, state.plan.replies, state.filled);
  if (!job || fields.length === 0) return;
  state.busy = true;
  state.status = 'Leaving the questions with the job…';
  render(state);
  const asked = await askForDrafts(state.form, job.id, fields, state.way);
  state.busy = false;
  if (filling !== state) return;
  if (!asked.ok || asked.did !== 'draft') {
    state.status = asked.ok ? 'Sync didn’t answer. Try again.' : asked.message;
    render(state);
    return;
  }
  state.left = fields.length;
  state.status = '';
  render(state);
}

/**
 * Asks how your Claude's drafts are coming along, every few seconds, and says when it's waiting
 * on you in Factwright. Once it's done, or has taken too long, it fills in what it drafted.
 */
async function followDrafts(state: Filling, drafting: Drafting): Promise<void> {
  following = null;
  const { job } = state.plan;
  if (filling !== state || state.drafting !== drafting || !job) return;
  const now = await draftsSoFar(job.id, state.way);
  if (filling !== state || state.drafting !== drafting) return;
  const goOn = () => {
    following = setTimeout(() => void followDrafts(state, drafting), DRAFTS_EVERY_MS);
  };
  if (!now.ok || now.did !== 'drafts') {
    // Factwright was busy a moment: it asks again.
    if (!now.ok && now.reason === 'busy') {
      goOn();
      return;
    }
    state.drafting = null;
    state.status = now.ok ? 'Factwright didn’t answer. Click Fill again.' : now.message;
    render(state);
    return;
  }
  if (now.drafting && Date.now() - drafting.since < DRAFTS_FOR_MS) {
    if (now.waiting !== drafting.waiting) {
      drafting.waiting = now.waiting;
      render(state);
    }
    goOn();
    return;
  }
  await fillDrafts(state, drafting);
}

/**
 * Fills in your Claude's drafts: each field it drafted, unless you've typed in it meanwhile,
 * and says how many it drafted. What it left for you says why.
 */
async function fillDrafts(state: Filling, drafting: Drafting): Promise<void> {
  const places = state.form.fields.flatMap((field, at) =>
    drafting.keys.has(field.key) ? [at] : [],
  );
  const fields = places.flatMap((at) => state.form.fields[at] ?? []);
  const planned = await planFill({ ...state.form, fields }, state.shows, state.way);
  if (filling !== state || state.drafting !== drafting) return;
  state.drafting = null;
  if (!planned.ok || planned.did !== 'fill') {
    state.status = planned.ok ? 'Factwright didn’t answer. Click Fill again.' : planned.message;
    render(state);
    return;
  }
  places.forEach((at, i) => {
    const reply = planned.replies[i];
    if (reply) state.plan.replies[at] = reply;
  });
  const drafted = fields.filter((_, i) => planned.replies[i]?.source === 'claude');
  if (!state.copyOnly && drafted.length > 0) {
    // What you typed while your Claude drafted stays.
    const read = await formValues(state.place, drafted);
    if (filling !== state) return;
    const typed = new Set(
      (read?.values ?? []).filter((each) => each.value.trim()).map((each) => each.key),
    );
    const empty = drafted.filter((field) => !typed.has(field.key));
    const filled = await fillForm(
      state.place,
      state.form.url,
      fillAnswers({ ...state.form, fields: empty }, empty.map(replyFor(state)), {}),
    );
    if (filling !== state) return;
    if (Array.isArray(filled)) {
      for (const each of filled) {
        const field = empty.find((one) => one.ref === each.ref);
        if (field) state.filled.set(field.key, each);
      }
    }
    const left = state.form.fields.filter(
      (field) => field.required && !state.filled.get(field.key)?.ok,
    );
    await outlineFields(state.place, left);
    if (filling !== state) return;
  }
  state.status =
    drafted.length > 0
      ? `Your Claude drafted ${answers(drafted.length)}. Check each one before you submit.`
      : 'Your Claude didn’t draft any. Each field says why, or Factwright does.';
  render(state);
}

/** The reply for one of the form's fields, by its place in the form. */
const replyFor = (state: Filling) => (field: PageField) =>
  state.plan.replies[state.form.fields.indexOf(field)] ?? {
    kind: 'question' as const,
    source: 'you' as const,
  };

/**
 * Reads what's in the form's own questions as soon as it's filled, then every few seconds while
 * the panel shows, so it has what you sent once you submit it, field by field: a field the form
 * takes away, as a form of steps does, keeps what it held. Once the tab leaves the form, as after
 * submitting, or the page says the application went in, the panel keeps what it read last. An
 * application that runs over several pages in the tab, as Workday's does, going on to another,
 * has the panel offer to fill that one. The script on the job sites you allowed has the panel look
 * at once as you leave one of its fields, before the page can go on, and as the page changes. A
 * look that ends after a later one keeps nothing.
 */
function keepLooking(state: Filling): void {
  stopLooking();
  const fields = fieldsToRead(state.form, state.plan.replies);
  let looks = 0;
  let newest = 0;
  lookNow = () => {
    if (document.visibilityState !== 'visible' || state.moved || state.applied) return;
    const look = ++looks;
    void formValues(state.place, fields).then((read) => {
      if (look < newest) return;
      newest = look;
      heard(state, read);
    });
  };
  looking = setInterval(lookNow, LOOK_EVERY_MS);
  lookNow();
}

/**
 * What the form holds now, as last read: what you sent, the page the application went on to, or
 * that the tab moved on from the form.
 */
function heard(state: Filling, read: FormValues | null): void {
  if (filling !== state || state.moved || state.applied) return;
  // An application that runs over several pages, whose next one loads anew, as Taleo's does once
  // you press its Save and Continue, can't be read while it loads: that says nothing of where it
  // is. Some browsers don't let the panel read a page the tab loaded since you clicked Fill, which
  // the panel says once it's missed a few looks.
  if (!read && state.form.step) {
    state.missed += 1;
    if (state.missed === MISSES) render(state);
    return;
  }
  if (state.missed > 0) {
    const said = state.missed >= MISSES;
    state.missed = 0;
    if (said) render(state);
  }
  // Another page of the application: the panel offers to fill it, and keeps what it last read of
  // this one.
  const next = nextPageOf(state.form, read);
  if (next) {
    if (state.next?.step !== next.step || state.next.fields !== next.fields) {
      state.next = next;
      render(state);
    }
    return;
  }
  // Back on the page it filled.
  if (state.next) {
    state.next = null;
    render(state);
  }
  if (!read || !onSamePage(state.form, read)) {
    state.moved = true;
    render(state);
    return;
  }
  state.values = merged(state.values, read.values);
  if (read.submitted && !state.form.submitted) {
    state.moved = true;
    render(state);
  }
}

/**
 * Fills the form with Factwright's answers, fetching the job's files to upload first, and says
 * whether it could, or only its fields that are empty (`onlyEmpty`). A form the tab has moved on
 * from isn't filled.
 */
async function fill(state: Filling, onlyEmpty = false): Promise<boolean> {
  state.busy = true;
  const filled = await fillPasses(state, onlyEmpty).finally(() => {
    state.busy = false;
  });
  if (filling !== state) return false;
  if (filled !== true) {
    message(
      filled === 'elsewhere'
        ? 'This tab has moved on from the form. Go back to the application, then click Fill again.'
        : 'The browser doesn’t let Factwright reach this page anymore. Click the Factwright button on the application’s tab, then Fill this application again.',
    );
    return false;
  }
  state.status = '';
  render(state);
  return true;
}

/** Each pass of filling the form, then the outlines for what's left: or why it stopped. */
const fillPasses = (state: Filling, onlyEmpty: boolean) =>
  fillInPasses({
    place: state.place,
    way: state.way,
    form: state.form,
    plan: state.plan,
    shows: state.shows,
    filled: state.filled,
    onlyEmpty,
    stale: () => filling !== state,
    status: (text) => {
      state.status = text;
      render(state);
    },
    added: () => render(state),
  });

/** How filling starts, beyond reading the form in the tab that's in front. */
interface Start {
  /**
   * What the application's earlier pages gave, as its next page is filled, or this one again: by
   * default, what the panel had, for the same tab and site.
   */
  earlier?: Earlier;
  /** Whether it fills only the fields that are empty, as once parts were added to the form. */
  onlyEmpty?: boolean;
}

/**
 * Starts filling the form in the tab that's in front, from reading it to filling it. A start
 * made after it, as by Fill again, takes over: this one stops at what it's waiting on.
 */
async function begin(how: Start = {}): Promise<void> {
  const before = filling;
  stopLooking();
  stopFollowing();
  filling = null;
  const start = ++starts;
  startedAt = Date.now();
  const later = () => start !== starts;
  show(app, heading('Fill this application'), h('p', { class: 'muted' }, 'Reading the form…'));
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (later()) return;
  // The browser keeps the address of a page the extension wasn't clicked on from it, as a company's
  // careers page, opened beside the Fill button in a frame of it from a job site you allowed.
  if (!tab?.id || (tab.url !== undefined && !isWebPage(tab.url))) {
    message(
      'Open an application form, then click the Factwright button and Fill this application.',
    );
    return;
  }
  const ways = await fillWays();
  if (later()) return;
  if (!Array.isArray(ways)) {
    const { why } = ways;
    message(
      why === 'sync'
        ? `The browser doesn’t let the extension reach ${serverName(ways.server)}, which it fills forms from.`
        : 'Filling a form needs Factwright on this computer, which the browser asks you to let Factwright reach.',
      h(
        'div',
        { class: 'actions' },
        button(
          'Allow it',
          () => {
            if (why !== 'sync') {
              askForComputer();
              return;
            }
            // The browser asks only straight from a click, before anything is waited on.
            void allowSync(ways.server).then((allowed) => {
              if (allowed) void begin();
            });
          },
          true,
        ),
      ),
    );
    return;
  }
  // LinkedIn's link-only setting keeps the extension from reading LinkedIn's pages, its forms too.
  const linkOnly = isLinkedIn(tab.url ?? '') && !(await settings()).linkedInText;
  if (later()) return;
  if (linkOnly) {
    message(
      'You chose to save LinkedIn jobs by their link alone, so the extension doesn’t read LinkedIn’s pages. Change it in Settings.',
    );
    return;
  }
  const found = await findForm(tab.id);
  if (later()) return;
  if (!found) {
    message(
      'Factwright can’t read this page. Click the Factwright button on the application’s tab, then Fill this application.',
    );
    return;
  }
  const { place, form } = found;
  // The application is in a frame from an applicant system's site you haven't turned on, as a
  // company's careers page shows one: the panel offers to turn the sites on, to reach it.
  if (place.frameId === 0 && !isCopyOnly(form.url) && !looksLikeApplication(form)) {
    const system = await framedSystem(tab.id);
    if (later()) return;
    if (system) {
      offerFramed(tab.id, system);
      return;
    }
  }
  if (form.fields.length === 0) {
    message(
      'There’s no form to fill on this page. Open the application itself, often behind an Apply button, then click Fill again.',
    );
    return;
  }
  const shows = await readFormJob(tab, place.frameId);
  if (later()) return;
  if (ways[0]?.via === 'sync') {
    show(
      app,
      heading('Fill this application'),
      h('p', { class: 'muted' }, 'Reading your job hunt…'),
    );
  }
  const {
    way,
    answer: planned,
    instead,
  } = await firstAnswer(ways, (each) => planFill(form, shows, each));
  if (later()) return;
  const site = await siteChoice(form.url);
  const offerComputer = way.via === 'sync' && !(await canReachComputer());
  if (later()) return;
  if (!planned.ok || planned.did !== 'fill') {
    message(
      planned.ok ? 'Factwright didn’t answer. Try again.' : planned.message,
      h(
        'div',
        { class: 'actions' },
        button('Try again', () => void begin(), true),
      ),
    );
    return;
  }
  // An application's earlier pages, in the same tab, for the same application.
  const earlier = how.earlier ?? (before && before.tabId === tab.id ? carried(before) : NO_EARLIER);
  const state: Filling = {
    tabId: tab.id,
    place,
    way,
    instead,
    offerComputer,
    form,
    plan: planned,
    shows,
    filled: new Map(),
    copyOnly: isCopyOnly(form.url),
    values: null,
    moved: false,
    elsewhere: false,
    busy: false,
    status: '',
    applied: null,
    drafting: null,
    left: null,
    site,
    earlier: form.step ? forApplication(earlier, planned.job?.id ?? null, form.url) : NO_EARLIER,
    next: null,
    missed: 0,
  };
  filling = state;
  render(state);
  // A form it couldn't fill isn't one you submitted: it only looks once it's filled.
  if (state.copyOnly || (await fill(state, how.onlyEmpty))) keepLooking(state);
}

/**
 * The offer to turn on the job application sites, for an application a tab's page shows in a frame
 * from one of them, which the panel can reach only once they're on. The browser is asked on the
 * click itself, before anything is waited on, as Firefox wants.
 */
function offerFramed(tabId: number, system: string): void {
  message(
    `This page shows ${system}’s application form in a frame. To fill it, turn Factwright on for job application sites: then it can reach their forms, here too, and show its menus and Fill button on them.`,
    h(
      'div',
      { class: 'actions' },
      button(
        'Turn on for job application sites',
        () => {
          void allowJobSites().then(async (allowed) => {
            if (!allowed) return;
            await runInFrames(tabId);
            void begin();
          });
        },
        true,
      ),
    ),
  );
}

// Another tab in front: the panel says which page it's for, until that tab's back.
ext.tabs.onActivated.addListener(({ tabId }) => {
  if (!filling || filling.applied) return;
  filling.elsewhere = tabId !== filling.tabId;
  render(filling);
});

// The Fill button on a job site you allowed, clicked while the panel shows: the panel beside that
// tab fills its form, unless it started filling since, as it does when the click is what opened
// it. A panel in another window, beside another tab, carries on with its own form.
ext.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== ext.runtime.id || sender.tab || !isToPanel(message)) return undefined;
  // You left a field of an application that runs over several, or its page changed, as the script
  // on a job site you allowed saw: the panel filling it looks at once.
  if (message.do === 'look') {
    if (filling?.tabId === message.tabId) lookNow?.();
    return undefined;
  }
  if (message.at <= startedAt) return undefined;
  void ext.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.id === message.tabId && message.at > startedAt) void begin();
  });
  return undefined;
});

void begin();
