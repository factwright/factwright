import {
  ASK_FIELDS,
  type AskedJob,
  JOB_STATUS_LABELS,
  readStatus,
  SENT_STATUSES,
} from '@factwright/core';
import { ext } from './ext.ts';
import { type FillPlan, type FormPlace, fieldsToRead, formValues, sentAnswers } from './fill.ts';
import { type FillWay, fillWays } from './fill-way.ts';
import type { NoteSays } from './job-site-messages.ts';
import { keptFill } from './kept-fill.ts';
import { changeNote, type Note, showNote } from './notes.ts';
import type { FieldValue, PageForm } from './page/form.ts';
import { forApplication, joinSent, NO_EARLIER, type SentAnswer } from './several-pages.ts';

/**
 * Applied, noticed as you submit, on the job sites you allowed: the extension's script there says
 * what the form's fields held as you submitted it, or pressed a page's Save and Continue, as an
 * application that runs over several pages goes on, and then what the page showed once it moved
 * on. A page that says the application went in, as "Thank you for applying", or one with no form
 * left, once you submitted a form on one page, has the job marked Applied, with what you sent, and
 * a note on the page offers Undo. One that still shows the form, as with an answer it wants, isn't.
 * Elsewhere, Mark as applied is in the popup. Only a job you saved is marked: Factwright keeps
 * nothing of a job it doesn't have.
 */

/** An application you're sending, in one frame of a tab, as its pages go by. */
interface Applying {
  tabId: number;
  frameId: number;
  /** The job it's for, as Factwright found it, or null for one you haven't saved. */
  job: AskedJob | null;
  via: FillWay['via'];
  /** Its address, as the page you last submitted had it. */
  url: string;
  /** What you sent on its pages so far, for its own questions. */
  sent: SentAnswer[];
  /** A submit waiting for the page to say how it went. */
  pending: { at: number; final: boolean; onePage: boolean; doc: string } | null;
  /** Whether it's been marked applied. */
  marked: boolean;
}

/** Where the applications are kept: in the browser's memory, while it runs, never on the disk. */
const APPLYING = 'applying';

/** How long after a submit the page has to say how it went: longer than any page takes to load. */
const OUTCOME_MS = 60_000;

/**
 * How long after the page you submitted went away, as it loaded another, the next one has to say
 * how it went before the page counts as having moved on: one on a site the extension doesn't run
 * on says nothing.
 */
const GONE_MS = 10_000;

const keyOf = (place: FormPlace) => `${place.tabId}:${place.frameId}`;

let queue: Promise<unknown> = Promise.resolve();

async function allApplying(): Promise<Record<string, Applying>> {
  const session = ext.storage.session;
  if (!session) return memory;
  const { [APPLYING]: kept } = await session
    .get(APPLYING)
    .catch(() => ({}) as Record<string, unknown>);
  return kept && typeof kept === 'object' ? (kept as Record<string, Applying>) : {};
}

/** Where they're kept in a browser that keeps nothing for a session. */
const memory: Record<string, Applying> = {};

/** Changes an application, after the changes before it, and says what it is now. */
function changeApplying(
  place: FormPlace,
  apply: (now: Applying | null) => Applying | null,
): Promise<Applying | null> {
  const next = queue.then(async () => {
    const all = await allApplying();
    const now = apply(all[keyOf(place)] ?? null);
    if (now) all[keyOf(place)] = now;
    else delete all[keyOf(place)];
    if (ext.storage.session) await ext.storage.session.set({ [APPLYING]: all });
    else Object.assign(memory, all);
    return now;
  });
  queue = next.catch(() => {});
  return next;
}

/** Forgets a tab's applications, as it closes. */
export async function forgetApplying(tabId: number): Promise<void> {
  const all = await allApplying();
  for (const key of Object.keys(all)) {
    const [tab] = key.split(':');
    if (Number(tab) === tabId) await changeApplying(all[key] as Applying, () => null);
  }
}

/** Whether a frame of a tab is waiting to hear how a submit went, which its next page then says. */
export async function waitingAt(place: FormPlace): Promise<boolean> {
  await queue;
  const pending = (await allApplying())[keyOf(place)]?.pending;
  return Boolean(pending && Date.now() - pending.at < OUTCOME_MS);
}

/** What you submitted on a form, as the script says it, with Factwright's answers for it. */
export interface Submitted {
  place: FormPlace;
  doc: string;
  form: PageForm;
  plan: FillPlan;
  way: FillWay;
  values: FieldValue[];
  /** Whether its button sends the application, rather than going on to another of its pages. */
  final: boolean;
}

/**
 * Keeps what you sent on a form as you submitted it, joined to what its application's earlier
 * pages sent, in the same frame of the same tab, and waits to hear how it went.
 */
export async function submitted(each: Submitted): Promise<void> {
  const { place, form, plan } = each;
  const sent = sentAnswers(form, plan.replies, each.values);
  await changeApplying(place, (now) => {
    const job = plan.job?.id ?? null;
    const earlier = now
      ? forApplication(
          { job: now.job?.id ?? null, url: now.url, sent: now.sent, offers: [] },
          job,
          form.url,
        )
      : NO_EARLIER;
    const same = now && earlier !== NO_EARLIER && !now.marked;
    return {
      tabId: place.tabId,
      frameId: place.frameId,
      job: plan.job ?? (same ? now.job : null),
      via: each.way.via,
      url: form.url,
      sent: joinSent(same ? now.sent : [], sent).slice(0, ASK_FIELDS),
      pending: { at: Date.now(), final: each.final, onePage: !form.step, doc: each.doc },
      marked: false,
    };
  });
}

/** What a page showed once you submitted, as the script there says it. */
export interface Outcome {
  place: FormPlace;
  doc: string;
  /** Whether it says the application went in, as "Thank you for applying". */
  submitted: boolean;
  /** Whether it shows an application form, the same or another page of it. */
  form: boolean;
  /** Whether it shows what's wrong with an answer, as a form does that wants another. */
  errors: boolean;
}

/**
 * How a submit went, as the page says: it went in, or the page you submitted, with one page to its
 * form, moved on, with no form and no errors showing. Then the job is marked Applied, once.
 */
export async function outcome(said: Outcome): Promise<void> {
  const all = await allApplying();
  const applying = all[keyOf(said.place)];
  const pending = applying?.pending;
  if (!applying || !pending || Date.now() - pending.at > OUTCOME_MS) return;
  const movedOn = !said.form && !said.errors && pending.final;
  if (said.submitted || movedOn) {
    await mark(said.place);
    return;
  }
  // Another page of the application, loaded anew, as its Save and Continue does: its next submit
  // is the one to hear about.
  if (said.doc !== pending.doc && said.form) {
    await changeApplying(said.place, (now) => (now ? { ...now, pending: null } : null));
  }
}

/**
 * The page you submitted went away, as it loaded another: unless the next one, in the same frame,
 * says how it went first, as one on a job site you allowed does, it moved on, to a page the
 * extension doesn't run on, which counts as applying for a form on one page that you sent.
 */
export async function left(place: FormPlace, doc: string): Promise<void> {
  const pending = (await allApplying())[keyOf(place)]?.pending;
  if (!pending || pending.doc !== doc || !pending.final || !pending.onePage) return;
  setTimeout(() => {
    void allApplying().then(async (all) => {
      const now = all[keyOf(place)]?.pending;
      if (now && now.at === pending.at) await mark(place);
    });
  }, GONE_MS);
}

/** A job's title and company, as a note says them. */
const named = (job: AskedJob) => [job.role, job.company].filter(Boolean).join(' at ');

/** The way an application's answers came, if there's still one, as Undo goes back that way. */
async function wayOf(via: FillWay['via']): Promise<FillWay | null> {
  const ways = await fillWays();
  return Array.isArray(ways) ? (ways.find((each) => each.via === via) ?? null) : null;
}

/**
 * Marks the job an application in a frame of a tab is for Applied, with what you sent, once, and
 * puts a note on the page that says so, with Undo. A job you haven't saved isn't marked: the note
 * says to save it.
 */
async function mark(place: FormPlace): Promise<void> {
  let applying: Applying | null = null;
  await changeApplying(place, (now) => {
    if (!now?.pending || now.marked) return now;
    applying = now;
    return { ...now, pending: null, marked: true };
  });
  const sending = applying as Applying | null;
  if (!sending) return;
  const { job } = sending;
  if (!job) {
    await showNote(place, {
      is: 'problem',
      says: 'You applied? This job isn’t in your job hunt, so Factwright didn’t mark it. Save it from Factwright’s button.',
    });
    return;
  }
  await markApplied(place, job, sending.via, sending.url, sending.sent);
}

/**
 * Marks a job Applied with what you sent, the way its form was filled, and puts a note on the page
 * that says so, with Undo where marking it changed it. Says the note's token, or what went wrong.
 */
export async function markApplied(
  place: FormPlace,
  job: AskedJob,
  via: FillWay['via'],
  url: string,
  sent: SentAnswer[],
): Promise<{ token: string | null; says: NoteSays }> {
  const way = await wayOf(via);
  const answer = way
    ? await way.ask({ ask: 'sent', job: job.id, url, answers: sent.slice(0, ASK_FIELDS) })
    : null;
  if (!answer?.ok || answer.did !== 'sent') {
    const says: NoteSays = {
      is: 'problem',
      says:
        answer && !answer.ok && answer.message
          ? `Factwright didn’t mark ${named(job)} applied: ${answer.message}`
          : `Factwright couldn’t mark ${named(job)} applied. Do it from Factwright’s button.`,
    };
    return { token: await showNote(place, says), says };
  }
  const before = readStatus(job.status);
  const changed = !(before && SENT_STATUSES.includes(before));
  const says: NoteSays = changed
    ? { is: 'applied', job: named(answer.job), undo: 'can' }
    : {
        is: 'applied',
        job: named(answer.job),
        undo: 'cannot',
        says: `Kept what you sent with ${named(answer.job)}.`,
      };
  const token = await showNote(place, says, {
    job: { ...job, status: before ?? 'new' },
    via,
    ...(answer.undo && { undo: answer.undo }),
  });
  return { token, says };
}

/**
 * Takes back marking a note's job Applied, as its Undo asks: the way it was marked, and through
 * sync with what puts it back. Says what the note says now.
 */
export async function undoApplied(note: Note): Promise<NoteSays> {
  const { applied } = note;
  if (note.says.is !== 'applied' || note.says.undo !== 'can' || !applied) return note.says;
  const way = await wayOf(applied.via);
  const answer = way
    ? await way.ask({
        ask: 'unsent',
        job: applied.job.id,
        ...(applied.via === 'sync' && applied.undo && { undo: applied.undo }),
      })
    : null;
  let says: NoteSays;
  if (answer?.ok && answer.did === 'unsent') {
    const status = readStatus(answer.job.status) ?? 'new';
    says = {
      ...note.says,
      undo: 'undone',
      says: answer.undone
        ? `Not applied: ${named(answer.job)} is back to ${JOB_STATUS_LABELS[status]}.`
        : `${named(answer.job)} has moved on since, so it’s as it is. Change it in Factwright.`,
    };
  } else {
    says = {
      ...note.says,
      undo: 'cannot',
      says:
        answer && !answer.ok && answer.reason === 'bad-message'
          ? 'Update Factwright on this computer to undo it here, or change its status in Factwright.'
          : `Couldn’t undo it: ${answer && !answer.ok ? (answer.message ?? 'try again') : 'Factwright didn’t answer'}. Change its status in Factwright.`,
    };
  }
  await changeNote(note.token, says);
  return says;
}

/**
 * Marks a job Applied from the popup, as on a site where the extension doesn't notice you submit:
 * with what the form you filled in the tab holds now, where it's still there, for its own
 * questions, and a note on the page that says so, with Undo.
 */
export async function markFromPopup(
  tabId: number,
  job: AskedJob,
  via: FillWay['via'],
  url: string,
): Promise<{ token: string | null; says: NoteSays }> {
  const kept = await keptFill(tabId);
  let sent: SentAnswer[] = [];
  let place: FormPlace = { tabId, frameId: 0 };
  if (kept && kept.plan.job?.id === job.id) {
    place = kept.place;
    const read = await formValues(kept.place, fieldsToRead(kept.form, kept.plan.replies));
    if (read) sent = sentAnswers(kept.form, kept.plan.replies, read.values);
  }
  return markApplied(place, job, kept?.plan.job?.id === job.id ? kept.via : via, url, sent);
}
