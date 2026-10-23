import 'virtual:theme.css';
import './ui.css';
import { type AskedJob, type FieldReply, isLinkedIn, type LeftFor } from '@factwright/core';
import { askComputer, canReachComputer, saveOnComputer } from './computer.ts';
import { type Child, h, heading, show } from './dom.ts';
import { ext } from './ext.ts';
import {
  askForDrafts,
  draftable,
  draftsSoFar,
  type FillPlan,
  fetchFile,
  fieldsToRead,
  fillAnswers,
  fillForm,
  formValues,
  isCopyOnly,
  type NewAnswer,
  newAnswers,
  outlineFields,
  planFill,
  readForm,
  replyText,
  sentAnswers,
  showField,
} from './fill.ts';
import type { FieldFilled, FieldValue, PageField, PageForm } from './page/form.ts';
import { isWebPage, readTab } from './read-tab.ts';
import { settings } from './settings.ts';
import { toSave } from './tab-job.ts';

/**
 * The side panel beside the page, where filling an application form is checked. It reads the
 * form in the tab you clicked Fill on, asks Factwright on this computer for an answer to each
 * field, fills them, and lists every field with its answer and where the answer came from. What's
 * left for you is outlined in orange on the page. Once you've submitted the form on the site,
 * Mark as applied records what you sent. Factwright never submits anything.
 */

const app = document.getElementById('app') as HTMLElement;

/** How often it reads what's in the form, while the panel shows, to have what you sent. */
const LOOK_EVERY_MS = 3000;

/**
 * How many times it fills the form: once, then again for fields a form shows only once others
 * are answered, as a question about race once you've said whether you're Hispanic or Latino.
 */
const PASSES = 3;

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

/** A form being filled: the tab it's in, what was read and answered, and how filling went. */
interface Filling {
  tabId: number;
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
}

/** The form being filled, and only it: whatever an earlier start of filling was doing stops. */
let filling: Filling | null = null;
let looking: ReturnType<typeof setInterval> | null = null;
/** The next look at how your Claude's drafts are coming along. */
let following: ReturnType<typeof setTimeout> | null = null;
/** How many times filling has started, so an earlier start that's still going stops there. */
let starts = 0;

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
};

/** Whether two addresses are the same page, but for what's after their #. */
const samePage = (a: string, b: string) => a.split('#')[0] === b.split('#')[0];

/** What the form held, as read before, with what it holds now in place of it, field by field. */
function merged(before: readonly FieldValue[] | null, now: readonly FieldValue[]): FieldValue[] {
  const keys = new Set(now.map((each) => each.key));
  return [...(before ?? []).filter((each) => !keys.has(each.key)), ...now];
}

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

/** Where an answer came from, in words. */
function source(reply: FieldReply): string {
  if (reply.source === 'you') return leftFor(reply);
  if (
    reply.from &&
    (reply.source === 'sent' || reply.source === 'claude' || reply.source === 'resume')
  ) {
    return reply.from;
  }
  if (reply.file) return reply.file === 'resume' ? 'The job’s resume' : 'The job’s cover letter';
  if (reply.source === 'resume') return 'From the job’s resume';
  if (reply.source === 'job')
    return reply.kind === 'how-heard' ? 'Where you found the job' : 'From the job';
  return 'From Profile';
}

/** How filling a field went, in words, when it didn't take. */
const NOT_FILLED: Record<Exclude<FieldFilled['why'], ''>, string> = {
  moved: 'The form changed. Click Fill again.',
  'no-option': 'None of its options matched. Pick one on the page.',
  'not-taken': 'The page didn’t take it. Copy it in.',
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
  // A choice shows the option the page picked, which may be another name for Factwright's answer.
  const picked =
    result?.ok && result.shown && (field.control === 'choice' || field.control === 'choices');
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
        source(reply),
      ),
      h(
        'div',
        { class: 'row-actions' },
        small(
          'Go to',
          () => void showField(state.tabId, field),
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

const answers = (count: number) => `${count} ${count === 1 ? 'answer' : 'answers'}`;

/**
 * What the panel says of your Claude's drafts: how they're coming along, or an offer to draft
 * the form's own questions that nothing on file answers.
 */
function draftLine(state: Filling): Child[] {
  if (!state.plan.job) return [];
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
  const filled = [...state.filled.values()].filter((each) => each.ok).length;
  const left = total - filled;
  return left > 0
    ? `Filled ${filled} of ${total} fields. ${left} ${left === 1 ? 'is' : 'are'} left for you.`
    : `Filled all ${total} fields. Check them, then submit it on the page.`;
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
    h('p', { class: 'muted small', role: 'status' }, state.status || summary(state)),
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
      !state.copyOnly && button('Fill again', () => void begin(), false, state.busy),
    ),
    h(
      'p',
      { class: 'small muted' },
      'Factwright never submits a form. Check each answer, then submit it on the page yourself.',
    ),
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
  const answer = await askComputer({
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
  const { page } = await readTab(tab);
  const saved = await saveOnComputer(toSave(page));
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
    : await formValues(state.tabId, fieldsToRead(state.form, state.plan.replies));
  if (filling !== state) return;
  // What it read as you went, with what's there now, when it's still the form.
  const values = merged(
    state.values,
    latest && samePage(latest.url, state.form.url) ? latest.values : [],
  );
  const answer = await askComputer({
    ask: 'sent',
    job: job.id,
    url: state.form.url,
    answers: sentAnswers(state.form, state.plan.replies, values),
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
    offers: newAnswers(state.form, state.plan.replies, values),
    saved: new Set(),
  };
  render(state);
}

function stopLooking(): void {
  if (looking) clearInterval(looking);
  looking = null;
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
  const asked = await askForDrafts(state.form, job.id, fields);
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
 * Asks how your Claude's drafts are coming along, every few seconds, and says when it's waiting
 * on you in Factwright. Once it's done, or has taken too long, it fills in what it drafted.
 */
async function followDrafts(state: Filling, drafting: Drafting): Promise<void> {
  following = null;
  const { job } = state.plan;
  if (filling !== state || state.drafting !== drafting || !job) return;
  const now = await draftsSoFar(job.id);
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
  const planned = await planFill({ ...state.form, fields }, state.shows);
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
    const read = await formValues(state.tabId, drafted);
    if (filling !== state) return;
    const typed = new Set(
      (read?.values ?? []).filter((each) => each.value.trim()).map((each) => each.key),
    );
    const empty = drafted.filter((field) => !typed.has(field.key));
    const filled = await fillForm(
      state.tabId,
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
    await outlineFields(state.tabId, left);
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
 * Reads what's in the form's own questions every few seconds while the panel shows, so it has
 * what you sent once you submit it, field by field: a field the form takes away, as a form of
 * steps does, keeps what it held. Once the tab leaves the form, as after submitting, or the page
 * says the application went in, the panel keeps what it read last.
 */
function keepLooking(state: Filling): void {
  stopLooking();
  const fields = fieldsToRead(state.form, state.plan.replies);
  looking = setInterval(() => {
    if (document.visibilityState !== 'visible' || state.moved || state.applied) return;
    void formValues(state.tabId, fields).then((read) => {
      if (filling !== state || state.moved || state.applied) return;
      if (!read || !samePage(read.url, state.form.url)) {
        state.moved = true;
        render(state);
        return;
      }
      state.values = merged(state.values, read.values);
      if (read.submitted && !state.form.submitted) {
        state.moved = true;
        render(state);
      }
    });
  }, LOOK_EVERY_MS);
}

/**
 * Fills the form with Factwright's answers, fetching the job's files to upload first, and says
 * whether it could. A form the tab has moved on from isn't filled.
 */
async function fill(state: Filling): Promise<boolean> {
  state.busy = true;
  const filled = await fillPasses(state).finally(() => {
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
async function fillPasses(state: Filling): Promise<true | 'elsewhere' | 'unreachable' | 'stale'> {
  const { job, files } = state.plan;
  const replies = state.plan.replies;
  const fetched: Partial<Record<'resume' | 'cover-letter', { name: string; base64: string }>> = {};
  if (job) {
    for (const kind of ['resume', 'cover-letter'] as const) {
      const offered = files[kind];
      if (!offered || !replies.some((reply) => reply.file === kind)) continue;
      state.status =
        kind === 'resume' ? 'Getting the job’s resume…' : 'Getting the job’s cover letter…';
      render(state);
      const base64 = await fetchFile(job.id, kind, offered);
      if (filling !== state) return 'stale';
      if (base64) fetched[kind] = { name: offered.name, base64 };
    }
  }
  state.status = 'Filling the form…';
  render(state);
  let from = 0;
  for (let pass = 0; pass < PASSES; pass++) {
    const fields = state.form.fields.slice(from);
    const answers = fillAnswers({ ...state.form, fields }, replies.slice(from), fetched);
    const filled = await fillForm(state.tabId, state.form.url, answers);
    if (filling !== state) return 'stale';
    if (filled === null) return 'unreachable';
    if (filled === 'elsewhere') return 'elsewhere';
    for (const each of filled) {
      const field = fields.find((one) => one.ref === each.ref);
      if (field) state.filled.set(field.key, each);
    }
    // Fields the form showed once others were answered, filled in the next pass.
    const again = await readForm(state.tabId);
    if (filling !== state) return 'stale';
    if (!again || !samePage(again.url, state.form.url)) break;
    const known = new Set(state.form.fields.map((field) => field.key));
    const added = again.fields.filter((field) => !known.has(field.key));
    if (added.length === 0) break;
    const planned = await planFill({ ...again, fields: added }, state.shows);
    if (filling !== state) return 'stale';
    if (!planned.ok || planned.did !== 'fill') break;
    from = state.form.fields.length;
    state.form.fields.push(...added);
    replies.push(...planned.replies);
    render(state);
  }
  // What's left for you, and needed, is outlined in orange on the page.
  const left = state.form.fields.filter(
    (field) => field.required && !state.filled.get(field.key)?.ok,
  );
  await outlineFields(state.tabId, left);
  return filling === state ? true : 'stale';
}

/**
 * Starts filling the form in the tab that's in front, from reading it to filling it. A start
 * made after it, as by Fill again, takes over: this one stops at what it's waiting on.
 */
async function begin(): Promise<void> {
  stopLooking();
  stopFollowing();
  filling = null;
  const start = ++starts;
  const later = () => start !== starts;
  show(app, heading('Fill this application'), h('p', { class: 'muted' }, 'Reading the form…'));
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (later()) return;
  if (!tab?.id || !isWebPage(tab.url)) {
    message(
      'Open an application form, then click the Factwright button and Fill this application.',
    );
    return;
  }
  const reachable = await canReachComputer();
  if (later()) return;
  if (!reachable) {
    message(
      'Filling a form needs Factwright on this computer, which the browser asks you to let Factwright reach.',
      h(
        'div',
        { class: 'actions' },
        button(
          'Allow it',
          () => {
            // The browser asks only straight from a click, before anything is waited on.
            void ext.permissions.request(NATIVE).then((allowed) => {
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
  const form = await readForm(tab.id);
  if (later()) return;
  if (!form) {
    message(
      'Factwright can’t read this page. Click the Factwright button on the application’s tab, then Fill this application.',
    );
    return;
  }
  if (form.fields.length === 0) {
    message(
      'There’s no form to fill on this page. Open the application itself, often behind an Apply button, then click Fill again.',
    );
    return;
  }
  const { page } = await readTab(tab);
  if (later()) return;
  const planned = await planFill(form, { company: page.company, role: page.title });
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
  const state: Filling = {
    tabId: tab.id,
    form,
    plan: planned,
    shows: { company: page.company, role: page.title },
    filled: new Map(),
    copyOnly: isCopyOnly(form.url),
    values: null,
    moved: false,
    elsewhere: false,
    busy: false,
    status: '',
    applied: null,
    drafting: null,
  };
  filling = state;
  render(state);
  // A form it couldn't fill isn't one you submitted: it only looks once it's filled.
  if (state.copyOnly || (await fill(state))) keepLooking(state);
}

// Another tab in front: the panel says which page it's for, until that tab's back.
ext.tabs.onActivated.addListener(({ tabId }) => {
  if (!filling || filling.applied) return;
  filling.elsewhere = tabId !== filling.tabId;
  render(filling);
});

void begin();
