import {
  type AboutYou,
  ANSWER_LIMITS,
  type AnswerChanges,
  FIELDS,
  type JobKind,
  type KindAnswers,
  kindIdFor,
  kindNameKey,
  kindNameText,
  labelOf,
} from './about.ts';

/**
 * Every kind of job the user wants, in order. The first is their answers' own titles, kinds of
 * work, levels and pay, named once there's another. With one kind, it's that one, unnamed.
 */
export function kindsOf(answers: AboutYou): JobKind[] {
  const first: JobKind = {
    id: answers.firstKind?.id ?? '',
    name: answers.firstKind?.name ?? '',
    roles: answers.roles,
    fields: answers.fields,
    levels: answers.levels,
    minPay: answers.minPay,
    targetPay: answers.targetPay,
    payFilter: answers.payFilter,
  };
  return [first, ...answers.otherKinds];
}

/** Whether the user wants more than one kind of job, so the app shows their kinds. */
export const hasKinds = (answers: Pick<AboutYou, 'otherKinds'>) => answers.otherKinds.length > 0;

/** A change to the kinds of job, or why it can't be made, in words the user can act on. */
export type KindEdit = { ok: true; changes: AnswerChanges } | { ok: false; message: string };

/**
 * What the first kind of job is called before the user names it: for its first title, or else
 * its kind of work.
 */
export function firstKindName(answers: AboutYou): string {
  const field = answers.fields.find((each) => each !== 'other');
  const name = answers.roles[0] ?? (field ? labelOf(FIELDS, field) : '');
  return kindNameText(name).slice(0, ANSWER_LIMITS.kindName).trim();
}

/**
 * Why a name won't do for a kind of job, or null when it will. Names are told apart as the app
 * keeps them, on one line and in any case, so "Project  manager" is the same as "project manager".
 */
function badName(name: string, kinds: readonly JobKind[], id?: string): string | null {
  if (!name) return 'Give it a name, such as Project manager.';
  if (name.length > ANSWER_LIMITS.kindName) return 'That name’s too long. Try a shorter one.';
  const same = kinds.find((kind) => kindNameKey(kind.name) === kindNameKey(name));
  return same && same.id !== id ? `You already have ${same.name}.` : null;
}

/**
 * The changes that add a kind of job by its name, with nothing told about it yet. When it's the
 * second, the first is named too: as the user named it now, or before, or for its first title.
 * A first kind named before keeps its id, so jobs put under it stay there.
 */
export function addKind(answers: AboutYou, name: string, firstName = ''): KindEdit {
  const named = kindNameText(name);
  const second = !hasKinds(answers);
  const firstNamed =
    (second && kindNameText(firstName)) ||
    answers.firstKind?.name ||
    firstKindName(answers) ||
    'Your first kind of job';
  const firstKind = {
    id: answers.firstKind?.id ?? kindIdFor(firstNamed, []),
    name: firstNamed,
  };
  const kinds = [{ ...kindsOf(answers)[0], ...firstKind } as JobKind, ...answers.otherKinds];
  if (kinds.length >= ANSWER_LIMITS.kinds) {
    return { ok: false, message: `That’s as many kinds of job as Factwright keeps.` };
  }
  const firstProblem = badName(firstKind.name, answers.otherKinds);
  if (firstProblem) return { ok: false, message: firstProblem };
  const problem = badName(named, kinds);
  if (problem) return { ok: false, message: problem };
  const taken = [firstKind.id, ...answers.otherKinds.map((kind) => kind.id)];
  const added: JobKind = {
    id: kindIdFor(named, taken),
    name: named,
    roles: [],
    fields: [],
    levels: [],
    minPay: '',
    targetPay: '',
    payFilter: false,
  };
  return { ok: true, changes: { firstKind, addedKinds: [added] } };
}

/** The changes that rename a kind of job. Its id stays, since its jobs and resumes go by it. */
export function renameKind(answers: AboutYou, id: string, name: string): KindEdit {
  const named = kindNameText(name);
  const problem = badName(named, kindsOf(answers), id);
  if (problem) return { ok: false, message: problem };
  if (answers.firstKind?.id === id) {
    return { ok: true, changes: { firstKind: { ...answers.firstKind, name: named } } };
  }
  return { ok: true, changes: { kindChanges: [{ id, name: named }] } };
}

/**
 * The changes that set some of one kind of job's own answers. The first kind's are the answers'
 * own, as they were before there was a second. Another kind's change goes by its id, alone.
 */
export function changeKind(
  answers: AboutYou,
  id: string,
  changes: Partial<KindAnswers>,
): AnswerChanges {
  const other = answers.otherKinds.some((kind) => kind.id === id);
  return other ? { kindChanges: [{ id, ...changes }] } : changes;
}

/**
 * The changes that remove a kind of job after the first. Its jobs go under the first, and its
 * starting resumes stay in its folder in base/. The first is named still, for next time.
 */
export function removeKind(answers: AboutYou, id: string): AnswerChanges {
  return answers.otherKinds.some((kind) => kind.id === id) ? { removedKinds: [id] } : {};
}
