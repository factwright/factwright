import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  allIdeas,
  castVote,
  changeIdea,
  type Db,
  declineIdea,
  forgetEmail,
  ID,
  LIMITS,
  MOVED_MAX,
  mergeIdea,
  readChange,
  readSuggestion,
  readVote,
  type Suggestion,
  shownIdeas,
  suggest,
  WAITING_MAX,
} from '../worker/ideas.ts';
import { ideasDb } from './d1.ts';

/** A browser's vote for an idea, as the roadmap page works it out. */
const hashOf = (voter: string, idea: string) =>
  createHash('sha256').update(`${voter}:${idea}`).digest('hex');

/** A browser's vote, or taking it back, for an idea and any merged into it. */
const voteOf = (voter: string, idea: string, vote = true, merged: string[] = []) => ({
  vote,
  hash: hashOf(voter, idea),
  moved: merged.map((each) => hashOf(voter, each)),
});

const IDEA: Suggestion = {
  title: 'Import jobs from a spreadsheet',
  words: 'I track jobs in a spreadsheet already.',
  email: null,
};

/** A suggestion's ID, once it's kept. */
async function suggested(db: Db, suggestion: Partial<Suggestion> = {}, at?: Date) {
  const made = await suggest(db, { ...IDEA, ...suggestion }, at);
  if (made === 'busy') throw new Error('Too many ideas wait');
  return made.id;
}

/** An approved idea's ID, with the votes of the browsers given. */
async function approved(db: Db, title: string, voters: string[] = [], status = 'considering') {
  const id = await suggested(db, { title });
  await changeIdea(db, id, { status: status as 'considering' });
  for (const voter of voters) await castVote(db, id, voteOf(voter, id));
  return id;
}

describe('reading a suggestion', () => {
  it('keeps the title on one line, and the lines with no more than one empty line between', () => {
    const read = readSuggestion({
      title: '  Dark   mode\nfor  PDFs ',
      words: 'First line.  \r\n\r\n\r\n\r\nSecond\tline.\n',
      email: '  sam@example.com ',
    });
    expect(read).toEqual({
      ok: true,
      value: {
        title: 'Dark mode for PDFs',
        words: 'First line.\n\nSecond line.',
        email: 'sam@example.com',
      },
    });
  });

  it('leaves out control characters, and the marks that turn text around', () => {
    const read = readSuggestion({ title: 'Safe\u0000 ‮title⁩', words: 'Fine\u0007.' });
    expect(read).toEqual({ ok: true, value: { title: 'Safe title', words: 'Fine.', email: null } });
  });

  it('needs a title and a few lines', () => {
    expect(readSuggestion({ title: ' ', words: 'Lines' })).toEqual({
      ok: false,
      problem: 'Give the idea a title.',
    });
    expect(readSuggestion({ title: 'A title', words: '\n \n' })).toEqual({
      ok: false,
      problem: 'Add a few lines about it.',
    });
    expect(readSuggestion(null)).toMatchObject({ ok: false });
    expect(readSuggestion({ title: 42, words: 'Lines' })).toMatchObject({ ok: false });
    expect(readSuggestion({ title: 'A title', words: ['Lines'] })).toMatchObject({ ok: false });
  });

  it('keeps each part to its length, as the form does', () => {
    expect(readSuggestion({ ...IDEA, title: 'x'.repeat(LIMITS.title) }).ok).toBe(true);
    expect(readSuggestion({ ...IDEA, title: 'x'.repeat(LIMITS.title + 1) })).toEqual({
      ok: false,
      problem: 'Keep the title to 100 characters.',
    });
    expect(readSuggestion({ ...IDEA, words: 'x'.repeat(LIMITS.words) }).ok).toBe(true);
    expect(readSuggestion({ ...IDEA, words: 'x'.repeat(LIMITS.words + 1) })).toEqual({
      ok: false,
      problem: 'Keep it to 1000 characters.',
    });
  });

  it('takes an email only if it looks like one, and none at all', () => {
    for (const email of [undefined, null, '', '   ']) {
      expect(readSuggestion({ ...IDEA, email })).toMatchObject({
        ok: true,
        value: { email: null },
      });
    }
    expect(readSuggestion({ ...IDEA, email: "o'brien+ideas@mail.example.co.uk" }).ok).toBe(true);
    expect(readSuggestion({ ...IDEA, email: 'zoë@exämple.de' }).ok).toBe(true);
    for (const email of [
      'sam',
      'sam@example',
      'sam @example.com',
      42,
      `${'x'.repeat(250)}@a.co`,
      // Anything that could add to the email Steve's mail app drafts.
      'sam@example.com?bcc=lee@example.com',
      'sam@example.com&subject=Hi',
      'sam@example.com#top',
      '"sam"@example.com',
      'sam@example..com',
    ]) {
      expect(readSuggestion({ ...IDEA, email }), String(email)).toEqual({
        ok: false,
        problem: 'That email doesn’t look right. Check it, or leave it empty.',
      });
    }
  });
});

describe('reading a vote', () => {
  const hash = hashOf('voter', 'idea');

  it('takes a vote or taking one back, with any merged ideas’ hashes, each once', () => {
    const other = hashOf('voter', 'other');
    expect(readVote({ vote: true, hash })).toEqual({
      ok: true,
      value: { vote: true, hash, moved: [] },
    });
    expect(readVote({ vote: false, hash, moved: [other, other, hash] })).toEqual({
      ok: true,
      value: { vote: false, hash, moved: [other] },
    });
  });

  it('turns away anything that isn’t a vote', () => {
    for (const body of [
      null,
      { hash },
      { vote: 'yes', hash },
      { vote: true },
      { vote: true, hash: hash.toUpperCase() },
      { vote: true, hash: hash.slice(1) },
      { vote: true, hash, moved: 'abc' },
      { vote: true, hash, moved: ['abc'] },
      {
        vote: true,
        hash,
        moved: Array.from({ length: MOVED_MAX + 1 }, (_, n) => hashOf('v', `${n}`)),
      },
    ]) {
      expect(readVote(body).ok, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('reading a change on the admin page', () => {
  it('takes what it changes, and leaves the rest out', () => {
    expect(readChange({ status: 'planned' })).toEqual({ ok: true, value: { status: 'planned' } });
    expect(readChange({ words: '' })).toEqual({ ok: true, value: { words: '' } });
    expect(readChange({ title: ' New  title ', status: 'shipped', version: ' 0.19.0 ' })).toEqual({
      ok: true,
      value: { title: 'New title', status: 'shipped', version: '0.19.0' },
    });
  });

  it('turns away a status an idea can’t be moved to, or a version that isn’t one', () => {
    for (const status of ['new', 'merged', 'done', 3]) {
      expect(readChange({ status }).ok, String(status)).toBe(false);
    }
    for (const version of ['0.19', 'v0.19.0', '', 19]) {
      expect(readChange({ status: 'shipped', version }).ok, String(version)).toBe(false);
    }
    expect(readChange({ title: '' }).ok).toBe(false);
  });
});

describe('a suggestion', () => {
  it('waits for Steve, off the page, with its email', async () => {
    const db = ideasDb();
    const at = new Date('2026-10-27T15:00:00.000Z');
    const id = await suggested(db, { email: 'sam@example.com' }, at);
    expect(id).toMatch(ID);
    expect(await shownIdeas(db)).toEqual([]);
    expect(await allIdeas(db)).toEqual([
      {
        id,
        ...IDEA,
        email: 'sam@example.com',
        status: 'new',
        version: null,
        votes: 0,
        merged: [],
        created: at.toISOString(),
        updated: at.toISOString(),
      },
    ]);
  });

  it('is turned away while too many already wait, until Steve catches up', async () => {
    const db = ideasDb();
    const ids: string[] = [];
    for (let n = 0; n < WAITING_MAX; n += 1) ids.push(await suggested(db));
    expect(await suggest(db, IDEA)).toBe('busy');
    await declineIdea(db, ids[0] ?? '');
    expect(await suggest(db, IDEA)).toMatchObject({ id: expect.stringMatching(ID) });
  });
});

describe('a vote', () => {
  it('counts once from each browser, and clicking again takes it back', async () => {
    const db = ideasDb();
    const id = await approved(db, 'Dark mode for PDFs');
    expect(await castVote(db, id, voteOf('sam', id))).toEqual({ voted: true, votes: 1 });
    expect(await castVote(db, id, voteOf('sam', id))).toEqual({ voted: true, votes: 1 });
    expect(await castVote(db, id, voteOf('ana', id))).toEqual({ voted: true, votes: 2 });
    expect(await castVote(db, id, voteOf('sam', id, false))).toEqual({ voted: false, votes: 1 });
    expect(await castVote(db, id, voteOf('sam', id, false))).toEqual({ voted: false, votes: 1 });
    expect((await shownIdeas(db))[0]?.votes).toBe(1);
  });

  it('keeps only the hash, the idea and the day, with no row numbers', async () => {
    const db = ideasDb();
    const id = await approved(db, 'Dark mode for PDFs');
    await castVote(db, id, voteOf('sam', id), new Date('2026-10-27T15:04:05.000Z'));
    expect(db.sqlite.prepare('SELECT * FROM votes').all()).toEqual([
      { hash: hashOf('sam', id), idea: id, day: '2026-10-27' },
    ]);
    expect(() => db.sqlite.prepare('SELECT rowid FROM votes').all()).toThrow();
  });

  it('is open on a new suggestion, for its suggester’s own, and on the roadmap until it ships', async () => {
    const db = ideasDb();
    const id = await suggested(db);
    expect(await castVote(db, id, voteOf('sam', id))).toEqual({ voted: true, votes: 1 });
    for (const status of ['planned', 'in-progress'] as const) {
      await changeIdea(db, id, { status });
      expect(await castVote(db, id, voteOf('ana', id))).toEqual({ voted: true, votes: 2 });
      await castVote(db, id, voteOf('ana', id, false));
    }
    await changeIdea(db, id, { status: 'shipped', version: '0.19.0' });
    expect(await castVote(db, id, voteOf('ana', id))).toBe('closed');
    await changeIdea(db, id, { status: 'not-planned' });
    expect(await castVote(db, id, voteOf('ana', id))).toBe('closed');
  });

  it('isn’t for an idea that isn’t there, or was merged into another', async () => {
    const db = ideasDb();
    const into = await approved(db, 'Dark mode');
    const merged = await approved(db, 'A dark theme');
    await mergeIdea(db, merged, into);
    const missing = crypto.randomUUID();
    expect(await castVote(db, missing, voteOf('sam', missing))).toBe('not-found');
    expect(await castVote(db, merged, voteOf('sam', merged))).toBe('not-found');
  });
});

describe('merging', () => {
  it('moves the idea’s votes over, and a vote that came along counts as the browser’s own', async () => {
    const db = ideasDb();
    const into = await approved(db, 'Dark mode', ['ana']);
    const from = await approved(db, 'A dark theme', ['sam', 'lee']);
    expect(await mergeIdea(db, from, into)).toBe('merged');
    const shown = await shownIdeas(db);
    expect(shown).toEqual([expect.objectContaining({ id: into, votes: 3, merged: [from] })]);
    // Sam's vote came along: voting again changes nothing, and taking it back takes it away.
    expect(await castVote(db, into, voteOf('sam', into, true, [from]))).toEqual({
      voted: true,
      votes: 3,
    });
    expect(await castVote(db, into, voteOf('sam', into, false, [from]))).toEqual({
      voted: false,
      votes: 2,
    });
    expect(await castVote(db, into, voteOf('sam', into, true, [from]))).toEqual({
      voted: true,
      votes: 3,
    });
  });

  it('takes along what was merged into the idea before, so each merged idea points at a live one', async () => {
    const db = ideasDb();
    const first = await approved(db, 'Spreadsheets', ['sam']);
    const second = await approved(db, 'Import from Excel', ['ana']);
    const third = await approved(db, 'Import jobs', ['lee']);
    await mergeIdea(db, first, second);
    await mergeIdea(db, second, third);
    const [idea] = await shownIdeas(db);
    expect(idea?.id).toBe(third);
    expect(idea?.votes).toBe(3);
    expect(idea?.merged.sort()).toEqual([first, second].sort());
    expect(await castVote(db, third, voteOf('sam', third, false, idea?.merged))).toEqual({
      voted: false,
      votes: 2,
    });
  });

  it('merges a new suggestion, with its suggester’s vote, and forgets their email', async () => {
    const db = ideasDb();
    const into = await approved(db, 'Dark mode');
    const from = await suggested(db, { email: 'sam@example.com' });
    await castVote(db, from, voteOf('sam', from));
    await mergeIdea(db, from, into);
    expect(await allIdeas(db)).toEqual([expect.objectContaining({ id: into, votes: 1 })]);
    expect(db.sqlite.prepare('SELECT email FROM ideas WHERE id = ?').get(from)).toEqual({
      email: null,
    });
  });

  it('goes only into another idea Steve approved', async () => {
    const db = ideasDb();
    const idea = await approved(db, 'Dark mode');
    const fresh = await suggested(db);
    const gone = await approved(db, 'Gone');
    await mergeIdea(db, gone, idea);
    expect(await mergeIdea(db, idea, idea)).toEqual({
      problem: 'An idea can’t be merged into itself.',
    });
    expect(await mergeIdea(db, idea, fresh)).toEqual({
      problem: 'Merge it into an idea you’ve approved.',
    });
    expect(await mergeIdea(db, idea, gone)).toEqual({
      problem: 'Merge it into an idea you’ve approved.',
    });
    expect(await mergeIdea(db, gone, idea)).toBe('not-found');
    expect(await mergeIdea(db, crypto.randomUUID(), idea)).toBe('not-found');
  });
});

describe('the admin page’s changes', () => {
  it('approve a suggestion with its words edited, keeping its email', async () => {
    const db = ideasDb();
    const id = await suggested(db, { email: 'sam@example.com' });
    expect(await changeIdea(db, id, { title: 'Import jobs', words: '', status: 'planned' })).toBe(
      'changed',
    );
    expect(await shownIdeas(db)).toEqual([
      {
        id,
        title: 'Import jobs',
        words: '',
        status: 'planned',
        version: null,
        votes: 0,
        merged: [],
      },
    ]);
    expect((await allIdeas(db))[0]?.email).toBe('sam@example.com');
  });

  it('need the version to ship, and keep one only while it’s shipped', async () => {
    const db = ideasDb();
    const id = await approved(db, 'Dark mode');
    expect(await changeIdea(db, id, { status: 'shipped' })).toEqual({
      problem: 'Say which version it shipped in, such as 0.19.0.',
    });
    await changeIdea(db, id, { status: 'shipped', version: '0.19.0' });
    expect((await shownIdeas(db))[0]).toMatchObject({ status: 'shipped', version: '0.19.0' });
    // Its words can change, and it stays shipped in the same version.
    await changeIdea(db, id, { words: 'Now with a toggle.' });
    expect((await shownIdeas(db))[0]).toMatchObject({ status: 'shipped', version: '0.19.0' });
    await changeIdea(db, id, { status: 'in-progress', version: '0.20.0' });
    expect((await shownIdeas(db))[0]).toMatchObject({ status: 'in-progress', version: null });
  });

  it('forget whoever suggested it’s email once it ships or won’t be built', async () => {
    for (const [status, version] of [
      ['shipped', '0.19.0'],
      ['not-planned', undefined],
    ] as const) {
      const db = ideasDb();
      const id = await suggested(db, { email: 'sam@example.com' });
      await changeIdea(db, id, { status: 'planned' });
      expect((await allIdeas(db))[0]?.email).toBe('sam@example.com');
      await changeIdea(db, id, { status, ...(version && { version }) });
      expect((await allIdeas(db))[0]?.email, status).toBeNull();
    }
  });

  it('keep an idea that won’t be built off the page, with its votes, ready to bring back', async () => {
    const db = ideasDb();
    const id = await approved(db, 'Dark mode', ['sam']);
    await changeIdea(db, id, { status: 'not-planned' });
    expect(await shownIdeas(db)).toEqual([]);
    expect(await allIdeas(db)).toEqual([
      expect.objectContaining({ status: 'not-planned', votes: 1 }),
    ]);
    await changeIdea(db, id, { status: 'considering' });
    expect(await shownIdeas(db)).toEqual([expect.objectContaining({ id, votes: 1 })]);
  });

  it('decline only a new suggestion, deleting it with its vote', async () => {
    const db = ideasDb();
    const fresh = await suggested(db, { email: 'sam@example.com' });
    await castVote(db, fresh, voteOf('sam', fresh));
    const idea = await approved(db, 'Dark mode');
    expect(await declineIdea(db, idea)).toBe('not-found');
    expect(await declineIdea(db, fresh)).toBe('declined');
    expect(await declineIdea(db, fresh)).toBe('not-found');
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM votes').get()).toEqual({ count: 0 });
    expect((await allIdeas(db)).map((each) => each.id)).toEqual([idea]);
  });

  it('forget an email when asked', async () => {
    const db = ideasDb();
    const id = await suggested(db, { email: 'sam@example.com' });
    expect(await forgetEmail(db, id)).toBe('forgotten');
    expect((await allIdeas(db))[0]?.email).toBeNull();
    expect(await forgetEmail(db, crypto.randomUUID())).toBe('not-found');
  });

  it('can’t change a merged idea', async () => {
    const db = ideasDb();
    const into = await approved(db, 'Dark mode');
    const from = await approved(db, 'A dark theme');
    await mergeIdea(db, from, into);
    expect(await changeIdea(db, from, { status: 'planned' })).toBe('not-found');
    expect(await forgetEmail(db, from)).toBe('not-found');
  });
});

describe('the lists', () => {
  it('show the page’s ideas, most votes first, then the newest, and never an email', async () => {
    const db = ideasDb();
    const quiet = await approved(db, 'Quiet', [], 'planned');
    const loved = await approved(db, 'Loved', ['sam', 'ana']);
    const newer = await approved(db, 'Newer', [], 'in-progress');
    await suggested(db, { title: 'Waiting', email: 'sam@example.com' });
    const shown = await shownIdeas(db);
    expect(shown.map((idea) => idea.id)).toEqual([loved, newer, quiet]);
    expect(JSON.stringify(shown)).not.toContain('sam@example.com');
  });

  it('put new suggestions first on the admin page, oldest first, then the rest by votes', async () => {
    const db = ideasDb();
    const later = await suggested(db, { title: 'Later' }, new Date('2026-10-28T00:00:00Z'));
    const sooner = await suggested(db, { title: 'Sooner' }, new Date('2026-10-27T00:00:00Z'));
    const loved = await approved(db, 'Loved', ['sam']);
    const quiet = await approved(db, 'Quiet');
    expect((await allIdeas(db)).map((idea) => idea.id)).toEqual([sooner, later, loved, quiet]);
  });
});
