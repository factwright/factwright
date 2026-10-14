import { describe, expect, it } from 'vitest';
import { type AboutYou, ANSWER_LIMITS, NO_ANSWERS, readAnswers } from './about.ts';
import {
  addKind,
  changeKind,
  firstKindName,
  hasKinds,
  kindName,
  kindsOf,
  removeKind,
  renameKind,
} from './kinds.ts';

const ONE = readAnswers({ roles: ['Staff Engineer'], levels: ['senior'], minPay: '$150,000' });

/** Applies a change that has to work. */
function apply(answers: AboutYou, edit: ReturnType<typeof addKind>): AboutYou {
  if (!edit.ok) throw new Error(edit.message);
  return readAnswers({ ...answers, ...edit.changes });
}

const TWO = apply(ONE, addKind(ONE, 'Project manager', 'Developer'));

describe('kinds of job', () => {
  it('are one, unnamed, until the user adds another', () => {
    expect(hasKinds(ONE)).toBe(false);
    expect(kindsOf(ONE)).toEqual([
      {
        id: '',
        name: '',
        roles: ['Staff Engineer'],
        fields: [],
        levels: ['senior'],
        minPay: '$150,000',
        targetPay: '',
        payFilter: false,
      },
    ]);
  });

  it('name the first when the second is added, keeping its answers where they were', () => {
    expect(hasKinds(TWO)).toBe(true);
    expect(TWO.firstKind).toEqual({ id: 'developer', name: 'Developer' });
    expect(kindsOf(TWO).map(({ id, name, roles }) => [id, name, roles])).toEqual([
      ['developer', 'Developer', ['Staff Engineer']],
      ['project-manager', 'Project manager', []],
    ]);
    expect(TWO.roles).toEqual(['Staff Engineer']);
  });

  it('name the first for its first title when the user doesn’t', () => {
    expect(firstKindName(ONE)).toBe('Staff Engineer');
    expect(firstKindName(readAnswers({ fields: ['other', 'design'] }))).toBe('Design and UX');
    const named = apply(ONE, addKind(ONE, 'Project manager'));
    expect(named.firstKind?.name).toBe('Staff Engineer');
    expect(apply(NO_ANSWERS, addKind(NO_ANSWERS, 'Designer')).firstKind?.name).toBe(
      'Your first kind of job',
    );
  });

  it('each keep their own titles, levels and pay', () => {
    const first = readAnswers({ ...TWO, ...changeKind(TWO, 'developer', { roles: ['Lead'] }) });
    expect(first.roles).toEqual(['Lead']);
    expect(first.otherKinds[0]?.roles).toEqual([]);
    const other = readAnswers({
      ...TWO,
      ...changeKind(TWO, 'project-manager', { roles: ['Program Manager'], payFilter: true }),
    });
    expect(other.roles).toEqual(['Staff Engineer']);
    expect(other.otherKinds[0]).toMatchObject({ roles: ['Program Manager'], payFilter: true });
  });

  it('get a name of their own, and keep their id when renamed', () => {
    expect(addKind(TWO, '  ')).toEqual({ ok: false, message: expect.stringContaining('name') });
    expect(addKind(TWO, 'project MANAGER')).toEqual({
      ok: false,
      message: 'You already have Project manager.',
    });
    expect(addKind(ONE, 'Developer', 'Developer')).toMatchObject({ ok: false });
    const renamed = apply(TWO, renameKind(TWO, 'project-manager', 'Program manager'));
    expect(renamed.otherKinds[0]).toMatchObject({ id: 'project-manager', name: 'Program manager' });
    const first = apply(TWO, renameKind(TWO, 'developer', 'Engineer'));
    expect(first.firstKind).toEqual({ id: 'developer', name: 'Engineer' });
    expect(renameKind(TWO, 'developer', 'Project manager')).toMatchObject({ ok: false });
  });

  it('get ids of their own, even with the same words', () => {
    const three = apply(TWO, addKind(TWO, 'Project-manager!'));
    expect(three.otherKinds.map((kind) => kind.id)).toEqual([
      'project-manager',
      'project-manager-2',
    ]);
  });

  it('stop at as many as the app keeps', () => {
    let many = TWO;
    for (let n = 3; n <= ANSWER_LIMITS.kinds; n++) many = apply(many, addKind(many, `Kind ${n}`));
    expect(kindsOf(many)).toHaveLength(ANSWER_LIMITS.kinds);
    expect(addKind(many, 'One more')).toMatchObject({ ok: false });
  });

  it('go back to one when the others are removed, with the first still named', () => {
    const back = readAnswers({ ...TWO, ...removeKind(TWO, 'project-manager') });
    expect(hasKinds(back)).toBe(false);
    expect(back.firstKind).toEqual({ id: 'developer', name: 'Developer' });
    // The first can't be removed this way.
    expect(removeKind(TWO, 'developer')).toEqual({ otherKinds: TWO.otherKinds });
    // Adding another later can name the first again, and it keeps its id for its jobs.
    const again = apply(back, addKind(back, 'Designer', 'Engineer'));
    expect(again.firstKind).toEqual({ id: 'developer', name: 'Engineer' });
    expect(apply(back, addKind(back, 'Designer')).firstKind?.name).toBe('Developer');
  });

  it('name a job’s kind by its id, or the first’s when it’s none of them', () => {
    expect(kindName(TWO, 'project-manager')).toBe('Project manager');
    expect(kindName(TWO, 'removed')).toBe('Developer');
    expect(kindName(TWO, null)).toBe('Developer');
  });
});
