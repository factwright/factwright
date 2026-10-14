import { kindNamesIn } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import {
  type AboutYou,
  ANSWER_LIMITS,
  type AnswerChanges,
  applyChanges,
  type JobKind,
  mergeChanges,
  NO_ANSWERS,
  parseAnswerChanges,
  readAnswers,
} from './about.ts';
import {
  addKind,
  changeKind,
  firstKindName,
  hasKinds,
  type KindEdit,
  kindsOf,
  removeKind,
  renameKind,
} from './kinds.ts';

const ONE = readAnswers({ roles: ['Staff Engineer'], levels: ['senior'], minPay: '$150,000' });

/** Applies a change that has to work. */
function apply(answers: AboutYou, edit: ReturnType<typeof addKind>): AboutYou {
  if (!edit.ok) throw new Error(edit.message);
  return applyChanges(answers, edit.changes);
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
    const first = applyChanges(TWO, changeKind(TWO, 'developer', { roles: ['Lead'] }));
    expect(first.roles).toEqual(['Lead']);
    expect(first.otherKinds[0]?.roles).toEqual([]);
    const change = changeKind(TWO, 'project-manager', { roles: ['Program Manager'] });
    // Another kind's change goes by its id, a field at a time.
    expect(change).toEqual({
      kindChanges: [{ id: 'project-manager', roles: ['Program Manager'] }],
    });
    const other = applyChanges(TWO, change);
    expect(other.roles).toEqual(['Staff Engineer']);
    expect(other.otherKinds[0]).toMatchObject({ roles: ['Program Manager'], payFilter: false });
  });

  it('change a field at a time, so changes made elsewhere meanwhile stay', () => {
    // The user changes the titles while Claude saves the same kind's pay.
    const typed = changeKind(TWO, 'project-manager', { roles: ['Program Manager'] });
    const elsewhere = applyChanges(TWO, changeKind(TWO, 'project-manager', { targetPay: '$170k' }));
    expect(applyChanges(elsewhere, typed).otherKinds[0]).toMatchObject({
      roles: ['Program Manager'],
      targetPay: '$170k',
    });
    // Changes typed one after another join, by kind.
    const joined = mergeChanges(
      mergeChanges(typed, changeKind(TWO, 'project-manager', { levels: ['senior'] })),
      { quiet: true },
    );
    expect(joined).toEqual({
      quiet: true,
      kindChanges: [{ id: 'project-manager', roles: ['Program Manager'], levels: ['senior'] }],
    });
    // A change to a kind removed meanwhile does nothing.
    const removed = applyChanges(TWO, removeKind(TWO, 'project-manager'));
    expect(applyChanges(removed, typed).otherKinds).toEqual([]);
    // Adding a kind never undoes a change made to another meanwhile.
    const adding = addKind(TWO, 'Designer');
    if (!adding.ok) throw new Error(adding.message);
    expect(applyChanges(elsewhere, adding.changes).otherKinds).toMatchObject([
      { id: 'project-manager', targetPay: '$170k' },
      { id: 'designer', name: 'Designer' },
    ]);
  });

  it('never stand two by one name or id, even when changes cross on two computers', () => {
    // Another computer added a "Designer" meanwhile; this one's own "designer" stays out.
    const elsewhere = apply(TWO, addKind(TWO, 'Designer'));
    const here = addKind(TWO, 'designer ');
    if (!here.ok) throw new Error(here.message);
    expect(applyChanges(elsewhere, here.changes).otherKinds.map((kind) => kind.name)).toEqual([
      'Project manager',
      'Designer',
    ]);
    // A rename to a name another kind took meanwhile keeps the old name, and the rest changes.
    const renamed = mergeChanges(changeKind(TWO, 'project-manager', { roles: ['TPM'] }), {
      kindChanges: [{ id: 'project-manager', name: 'Designer' }],
    });
    expect(applyChanges(elsewhere, renamed).otherKinds[0]).toMatchObject({
      name: 'Project manager',
      roles: ['TPM'],
    });
    // So does the first kind.
    expect(
      applyChanges(elsewhere, { firstKind: { id: 'developer', name: 'designer' } }).firstKind,
    ).toEqual({ id: 'developer', name: 'Developer' });
    // Names differing only in spaces are the same name, in the window as in the app.
    expect(addKind(TWO, 'Project\u00a0 manager')).toEqual({
      ok: false,
      message: 'You already have Project manager.',
    });
    expect(renameKind(TWO, 'developer', 'project  MANAGER')).toMatchObject({ ok: false });
  });

  it('come out the same however the changes were batched, as after a save that failed', () => {
    const three = apply(
      apply(TWO, addKind(TWO, 'Alpha')),
      addKind(apply(TWO, addKind(TWO, 'Alpha')), 'Beta'),
    );
    const names = (answers: AboutYou) => kindsOf(answers).map((kind) => kind.name);
    expect(names(three)).toEqual(['Developer', 'Project manager', 'Alpha', 'Beta']);
    // Beta's name goes to Gamma and Alpha takes Beta's, in either order, in one go.
    for (const kindChanges of [
      [
        { id: 'beta', name: 'Gamma' },
        { id: 'alpha', name: 'Beta' },
      ],
      [
        { id: 'alpha', name: 'Beta' },
        { id: 'beta', name: 'Gamma' },
      ],
    ]) {
      expect(names(applyChanges(three, { kindChanges }))).toEqual([
        'Developer',
        'Project manager',
        'Beta',
        'Gamma',
      ]);
    }
    // Two kinds trading names keep their own.
    expect(
      names(
        applyChanges(three, {
          kindChanges: [
            { id: 'alpha', name: 'Beta' },
            { id: 'beta', name: 'Alpha' },
          ],
        }),
      ),
    ).toEqual(['Developer', 'Project manager', 'Alpha', 'Beta']);
    // A kind renamed and a new one given its old name, in one go.
    const designer = addKind(three, 'Designer');
    if (!designer.ok) throw new Error(designer.message);
    const batch = mergeChanges(
      { kindChanges: [{ id: 'alpha', name: 'Lead' }] },
      {
        addedKinds: [{ ...(designer.changes.addedKinds?.[0] as JobKind), name: 'Alpha' }],
      },
    );
    expect(names(applyChanges(three, batch))).toContain('Alpha');
    expect(names(applyChanges(three, batch))).toContain('Lead');
    // A kind added and given its titles in one go keeps them.
    expect(
      applyChanges(
        three,
        mergeChanges(designer.changes, changeKind(three, 'designer', { roles: ['UX'] })),
      ).otherKinds.at(-1),
    ).toMatchObject({ id: 'designer', roles: ['UX'] });
    // A kind that's gone, as on a screen not yet up to date, changes nothing, the first included.
    expect(applyChanges(three, changeKind(three, 'gone', { roles: ['UX'] }))).toEqual(three);
  });

  it('add a kind as it’s now named when it was renamed before saving', () => {
    // Changes typed one after another before a save, as the window joins and shows them.
    const typing = () => {
      let typed: AnswerChanges = {};
      return {
        type(change: AnswerChanges | KindEdit) {
          if ('ok' in change && !change.ok) throw new Error(change.message);
          typed = mergeChanges(typed, 'ok' in change ? change.changes : change);
          return applyChanges(TWO, typed);
        },
      };
    };
    // Added as Gamma, given a title, renamed Delta, and then another kind takes Gamma: the new
    // kind keeps its name and title.
    const one = typing();
    let shown = one.type(addKind(TWO, 'Gamma'));
    shown = one.type(changeKind(shown, 'gamma', { roles: ['Analyst'] }));
    shown = one.type(renameKind(shown, 'gamma', 'Delta'));
    shown = one.type(renameKind(shown, 'project-manager', 'Gamma'));
    expect(shown.otherKinds).toMatchObject([
      { id: 'project-manager', name: 'Gamma' },
      { id: 'gamma', name: 'Delta', roles: ['Analyst'] },
    ]);
    // Added as Gamma, renamed Delta, and Gamma added again: both are there.
    const two = typing();
    shown = two.type(addKind(TWO, 'Gamma'));
    shown = two.type(renameKind(shown, 'gamma', 'Delta'));
    shown = two.type(addKind(shown, 'Gamma'));
    expect(kindsOf(shown).map((kind) => kind.name)).toEqual([
      'Developer',
      'Project manager',
      'Delta',
      'Gamma',
    ]);
  });

  it('keep the first kind’s id when another computer names it otherwise', () => {
    const renamed = applyChanges(TWO, { firstKind: { id: 'engineer', name: 'Engineer' } });
    expect(renamed.firstKind).toEqual({ id: 'developer', name: 'Engineer' });
  });

  it('never let the first kind and another share a name or an id', () => {
    const names = (answers: AboutYou) => kindsOf(answers).map((kind) => kind.name);
    // The first takes a name another kind holds, while that kind takes the first's: neither lands.
    const crossed = applyChanges(TWO, {
      firstKind: { id: 'developer', name: 'Project manager' },
      kindChanges: [{ id: 'project-manager', name: 'Developer' }],
    });
    expect(names(crossed)).toEqual(['Developer', 'Project manager']);
    // A first kind sent with another kind's id only renames the first, which keeps its own id.
    const lead = applyChanges(TWO, { firstKind: { id: 'project-manager', name: 'Lead' } });
    expect(kindsOf(lead).map(({ id, name }) => [id, name])).toEqual([
      ['developer', 'Lead'],
      ['project-manager', 'Project manager'],
    ]);
  });

  it('leave out adds that clash or run past the limit, without refusing the rest', () => {
    // Another computer added a kind with this one's id meanwhile, so this add is left out, and
    // the same name added again under a new id lands.
    const synced = applyChanges(TWO, {
      addedKinds: [{ ...(TWO.otherKinds[0] as JobKind), id: 'designer', name: 'UX' }],
    });
    const first = addKind(TWO, 'Designer');
    const again = addKind(applyChanges(TWO, first.ok ? first.changes : {}), 'Designer');
    expect(again).toMatchObject({ ok: false });
    const batch = mergeChanges(first.ok ? first.changes : {}, {
      addedKinds: [{ ...(TWO.otherKinds[0] as JobKind), id: 'designer-2', name: 'Designer' }],
    });
    expect(parseAnswerChanges(batch)).not.toBeNull();
    expect(kindsOf(applyChanges(synced, batch)).map((kind) => kind.id)).toEqual([
      'developer',
      'project-manager',
      'designer',
      'designer-2',
    ]);
    expect(
      applyChanges(synced, batch).otherKinds.find((kind) => kind.id === 'designer')?.name,
    ).toBe('UX');
    // Removing the kind that came from elsewhere still removes it.
    const removing = mergeChanges(first.ok ? first.changes : {}, { removedKinds: ['designer'] });
    expect(applyChanges(synced, removing).otherKinds.map((kind) => kind.id)).toEqual([
      'project-manager',
    ]);
    // No more than the app keeps.
    const many = Array.from({ length: 8 }, (_, n) => ({
      ...(TWO.otherKinds[0] as JobKind),
      id: `kind-${n}`,
      name: `Kind ${n}`,
    }));
    expect(applyChanges(TWO, { addedKinds: many }).otherKinds).toHaveLength(
      ANSWER_LIMITS.kinds - 1,
    );
  });

  it('join changes made one after another, dropping what a later removal undid', () => {
    const adding = addKind(TWO, 'Designer');
    if (!adding.ok) throw new Error(adding.message);
    const typed = mergeChanges(
      adding.changes,
      changeKind(TWO, 'project-manager', { roles: ['TPM'] }),
    );
    // Added and removed again before saving: the add goes, and removing nothing does nothing.
    expect(mergeChanges(adding.changes, { removedKinds: ['designer'] })).toEqual({
      firstKind: TWO.firstKind,
      removedKinds: ['designer'],
    });
    // A removed kind's changes go with it.
    expect(mergeChanges(typed, removeKind(TWO, 'project-manager'))).toEqual({
      firstKind: TWO.firstKind,
      addedKinds: adding.changes.addedKinds,
      removedKinds: ['project-manager'],
    });
  });

  it('are named as core names them from the kinds file, for the web view', () => {
    const file = {
      first: TWO.firstKind,
      others: [
        ...TWO.otherKinds,
        { id: 'bad id', name: 'x' },
        { id: 'pm', name: 'project MANAGER' },
      ],
    };
    const read = readAnswers({ ...TWO, firstKind: file.first, otherKinds: file.others });
    expect(kindNamesIn(file, TWO.roles[0])).toEqual(
      kindsOf(read).map(({ id, name }) => ({ id, name })),
    );
    // A first kind the file leaves out is named the same way in both.
    const noFirst = readAnswers({ roles: ['Staff Engineer'], otherKinds: file.others });
    expect(kindNamesIn({ others: file.others }, 'Staff Engineer')).toEqual(
      kindsOf(noFirst).map(({ id, name }) => ({ id, name })),
    );
  });

  it('get ids Windows can hold as folder names', () => {
    const nurse = apply(ONE, addKind(ONE, 'PRN', 'Developer'));
    expect(nurse.otherKinds[0]).toMatchObject({ id: 'prn-jobs', name: 'PRN' });
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
    const back = applyChanges(TWO, removeKind(TWO, 'project-manager'));
    expect(hasKinds(back)).toBe(false);
    expect(back.firstKind).toEqual({ id: 'developer', name: 'Developer' });
    // The first can't be removed this way.
    expect(removeKind(TWO, 'developer')).toEqual({});
    // Adding another later can name the first again, and it keeps its id for its jobs.
    const again = apply(back, addKind(back, 'Designer', 'Engineer'));
    expect(again.firstKind).toEqual({ id: 'developer', name: 'Engineer' });
    expect(apply(back, addKind(back, 'Designer')).firstKind?.name).toBe('Developer');
  });
});
