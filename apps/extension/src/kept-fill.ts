import type { FillPlan, FormPlace } from './fill.ts';
import { keptState } from './kept-state.ts';
import type { FieldFilled, PageForm } from './page/form.ts';

/**
 * A form Fill filled in its page, as the panel shows it once you open it: from the note's Details,
 * or the popup. The background keeps it, by tab, and the panel shows it as it was, without filling
 * it again over what you've typed since. One from Factwright on this computer is kept in the
 * browser's memory while it runs, as the background may be stopped and started meanwhile. One
 * through sync, which holds what it read from your job hunt, stays in the background's own memory
 * alone (kept-state.ts).
 */
export interface KeptFill {
  tabId: number;
  place: FormPlace;
  /** The way its answers came: Factwright on this computer, or your job hunt through sync. */
  via: 'computer' | 'sync';
  /** Whether sync answered because Factwright on this computer wasn't there to. */
  instead: boolean;
  form: PageForm;
  plan: FillPlan;
  /** The company and job title the page shows, which the job the form is for is found by. */
  shows: { company: string; role: string };
  /** How filling each field went, by its key. */
  filled: [string, FieldFilled][];
  /** When it was filled. */
  at: number;
}

/** The most tabs whose fills are kept: more than anyone fills at once. */
const MOST_TABS = 20;

const fills = keptState<KeptFill>(
  'fills',
  (fill) => fill.via === 'sync',
  MOST_TABS,
  (fill) => fill.at,
);

/** Keeps a tab's fill, in place of the one before. */
export const keepFill = (fill: KeptFill) =>
  fills.change((all) => {
    all[fill.tabId] = fill;
  });

/** A tab's fill, as kept, or null. */
export async function keptFill(tabId: number): Promise<KeptFill | null> {
  return (await fills.all())[tabId] ?? null;
}

/** Forgets a tab's fill, as the tab closes. */
export const forgetFill = (tabId: number) =>
  fills.change((all) => {
    delete all[tabId];
  });

/**
 * How many fields a fill filled, left as they were, and needs you for: those needed and left for
 * you, and those whose answer didn't take. What it left as it was, as a file you attached, doesn't.
 */
export function counted(
  form: PageForm,
  replies: FillPlan['replies'],
  filled: ReadonlyMap<string, FieldFilled>,
): { filled: number; kept: number; need: number } {
  let done = 0;
  let kept = 0;
  let need = 0;
  form.fields.forEach((field, at) => {
    const result = filled.get(field.key);
    if (result?.ok) {
      if (result.kept) kept += 1;
      else done += 1;
    } else if (result || (replies[at]?.source === 'you' && field.required)) {
      need += 1;
    }
  });
  return { filled: done, kept, need };
}
