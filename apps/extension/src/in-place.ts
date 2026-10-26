import { ext, type Tab } from './ext.ts';
import {
  type FormPlace,
  fillInPasses,
  findForm,
  isCopyOnly,
  planFill,
  readForm,
  topOf,
} from './fill.ts';
import { type FillWay, fillWays, firstAnswer } from './fill-way.ts';
import type { FilledHere, ToPanel } from './job-site-messages.ts';
import { counted, keepFill } from './kept-fill.ts';
import { showNote } from './notes.ts';
import type { FieldFilled } from './page/form.ts';
import { readFormJob } from './read-tab.ts';
import { serverName } from './server.ts';

/**
 * Fill, as the Fill button on a job site you allowed, the popup, the page's right-click menu and
 * the shortcut ask: the form in the tab is filled in its page, with no panel, and a small note on
 * the page says how it went, "Factwright filled 14 fields · 2 need you · Details". The fill is
 * kept, while the browser runs, for the panel to show once you open it, from the note's Details or
 * the popup. LinkedIn's and Indeed's forms are never filled: the panel gives their answers to copy.
 */

/**
 * What filling a form in its page came to, the frame it's in, for its note, and the way its
 * answers came, once there was one: through sync, the note is kept in memory alone.
 */
export type FilledPlace = FilledHere & { place: FormPlace; via?: FillWay['via'] };

/**
 * Fills the form in a tab, in its page: the one in the frame given, as the Fill button's, or the
 * one the panel would find. The browser lets the extension reach the tab as you clicked its
 * button, its menu item or its shortcut, and a frame on a job site you allowed always.
 */
export async function fillInPlace(tab: Tab & { id: number }, at?: FormPlace): Promise<FilledPlace> {
  const place = at ?? topOf(tab.id);
  const problem = (says: string, where = place): FilledPlace => ({
    did: 'problem',
    says,
    place: where,
  });
  const ways = await fillWays();
  if (!Array.isArray(ways)) {
    return problem(
      ways.why === 'sync'
        ? `Factwright needs your OK to reach ${serverName(ways.server)}: click its button, then Fill this application.`
        : 'Factwright needs your OK first: click its button, then Fill this application.',
    );
  }
  const found = at
    ? await readForm(at).then((form) => form && { place: at, form })
    : await findForm(tab.id);
  if (!found) return problem('Factwright can’t read this page.');
  const { form } = found;
  if (isCopyOnly(form.url)) {
    return problem(
      'LinkedIn and Indeed don’t allow filling their forms. Click Factwright’s button for answers to copy.',
      found.place,
    );
  }
  if (form.fields.length === 0) {
    return problem(
      'There’s no form here. Open the application itself, then click Fill again.',
      found.place,
    );
  }
  const shows = await readFormJob(tab, found.place.frameId);
  const {
    way,
    answer: plan,
    instead,
  } = await firstAnswer(ways, (each) => planFill(form, shows, each));
  if (!plan.ok || plan.did !== 'fill') {
    // A note has two lines: where there's no Factwright to ask, Factwright's button says how to
    // set it up, in full.
    const says = !plan.ok
      ? (plan as { missing?: true }).missing
        ? 'The extension couldn’t find Factwright on this computer. Click Factwright’s button to set it up.'
        : plan.message
      : 'Factwright didn’t answer. Try again.';
    return { ...problem(says, found.place), via: way.via };
  }
  const filled = new Map<string, FieldFilled>();
  const done = await fillInPasses({
    place: found.place,
    way,
    form,
    plan,
    shows,
    filled,
    stale: () => false,
  });
  if (done === 'elsewhere') {
    return { ...problem('This tab has moved on from the form.', found.place), via: way.via };
  }
  if (done !== true) {
    return { ...problem('Factwright can’t reach this page anymore.', found.place), via: way.via };
  }
  await keepFill({
    tabId: tab.id,
    place: found.place,
    via: way.via,
    instead,
    form,
    plan,
    shows,
    filled: [...filled],
    at: Date.now(),
  });
  // The panel beside the tab, if it's open, shows what was filled.
  await ext.runtime
    .sendMessage({ type: 'panel', do: 'filled', tabId: tab.id } satisfies ToPanel)
    .catch(() => {
      // No panel's open.
    });
  const { filled: took, need } = counted(form, plan.replies, filled);
  return {
    did: 'filled',
    filled: took,
    need,
    job: plan.job !== null,
    place: found.place,
    via: way.via,
  };
}

/** Fills the form in a tab in its page, and puts the note that says how it went on the page. */
export async function fillAndNote(tab: Tab & { id: number }, at?: FormPlace): Promise<FilledHere> {
  const { place, via, ...done } = await fillInPlace(tab, at);
  await showNote(
    place,
    done.did === 'filled'
      ? { is: 'filled', filled: done.filled, need: done.need, job: done.job }
      : { is: 'problem', says: done.says },
    { via },
  );
  return done;
}
