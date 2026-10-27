import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { answerBoard, type Board, type Limiter, limitKey } from '../worker/board.ts';
import { castVote, changeIdea, type Db, ID, suggest, WAITING_MAX } from '../worker/ideas.ts';
import { ideasSlot } from '../worker/roadmap.ts';
import { ideasDb } from './d1.ts';

const SITE = 'https://factwright.com';

/** The built pages: the roadmap page with its lists to fill in, and the admin page. */
function pages() {
  const asked: string[] = [];
  return {
    asked,
    fetch: async (request: Request) => {
      const { pathname } = new URL(request.url);
      asked.push(pathname);
      if (pathname === '/roadmap') {
        return new Response(`<ol ${ideasSlot('considering')}<ol ${ideasSlot('planned')}`, {
          headers: { 'Content-Type': 'text/html', ETag: '"abc"', 'Content-Length': '99' },
        });
      }
      if (pathname === '/roadmap/admin') {
        return new Response('<h1>Admin</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
      return new Response('Not found', { status: 404 });
    },
  };
}

/** A limit that lets the first few through, noting the key each request was counted by. */
function limiter(allowing = Number.POSITIVE_INFINITY) {
  const keys: string[] = [];
  const limit: Limiter = {
    limit: async ({ key }) => {
      keys.push(key);
      return { success: keys.length <= allowing };
    },
  };
  return { keys, limit };
}

/** The board, on a database of its own, with Steve signed in or not. */
function board(fields: Partial<Board> & { signedIn?: boolean } = {}) {
  const { signedIn = false, ...rest } = fields;
  const db = ideasDb();
  const suggestLimit = limiter();
  const voteLimit = limiter();
  const site: Board = {
    db,
    limits: { suggest: suggestLimit.limit, vote: voteLimit.limit },
    admin: async () => (signedIn ? 'steve@factwright.com' : null),
    now: () => new Date('2026-10-27T15:00:00.000Z'),
    ...rest,
  };
  const assets = pages();
  const answer = (request: Request) => answerBoard(request, assets, site);
  return { db, site, assets, answer, suggestLimit, voteLimit };
}

/** A request the roadmap page's or the admin page's script sends, as a browser does. */
function sent(path: string, body: unknown, headers: Record<string, string> = {}, method = 'POST') {
  return new Request(`${SITE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: SITE,
      'Sec-Fetch-Site': 'same-origin',
      'CF-Connecting-IP': '203.0.113.7',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const SUGGESTION = { title: 'Dark mode for PDFs', words: 'For printing at night.', email: '' };

const hashOf = (voter: string, idea: string) =>
  createHash('sha256').update(`${voter}:${idea}`).digest('hex');

/** An idea Steve approved, with the votes of the browsers given. */
async function approvedIdea(db: Db, voters: string[] = []) {
  const made = await suggest(db, {
    title: 'Import jobs',
    words: 'From a spreadsheet.',
    email: null,
  });
  if (made === 'busy') throw new Error('busy');
  await changeIdea(db, made.id, { status: 'considering' });
  for (const voter of voters) {
    await castVote(db, made.id, { vote: true, hash: hashOf(voter, made.id), moved: [] });
  }
  return made.id;
}

/** An answer's JSON. */
const read = async (response: Response | null) =>
  (await response?.json()) as Record<string, unknown>;

describe('the roadmap page', () => {
  it('comes filled in with the ideas, asked for again each time', async () => {
    const { db, answer } = board();
    await approvedIdea(db, ['sam']);
    const response = await answer(new Request(`${SITE}/roadmap`));
    expect(response?.status).toBe(200);
    const html = (await response?.text()) ?? '';
    expect(html).toContain('Import jobs');
    expect(html).toContain('Nothing planned yet.');
    expect(response?.headers.get('Cache-Control')).toBe('no-cache');
    expect(response?.headers.get('ETag')).toBeNull();
    expect(response?.headers.get('Content-Length')).toBeNull();
    expect(response?.headers.get('Content-Type')).toBe('text/html');
  });

  it('says so when the ideas can’t be read, and still shows', async () => {
    const broken: Db = {
      prepare: () => {
        throw new Error('D1 is down');
      },
      batch: async () => {
        throw new Error('D1 is down');
      },
    };
    for (const db of [broken, undefined]) {
      const { answer } = board({ db });
      const response = await answer(new Request(`${SITE}/roadmap`));
      expect(response?.status).toBe(200);
      expect(await response?.text()).toContain('This couldn’t load just now.');
    }
  });

  it('gives a HEAD the same headers, without reading the ideas', async () => {
    const reads: string[] = [];
    const db = ideasDb();
    const watched: Db = {
      prepare: (query) => {
        reads.push(query);
        return db.prepare(query);
      },
      batch: (statements) => db.batch(statements),
    };
    const { answer } = board({ db: watched });
    const response = await answer(new Request(`${SITE}/roadmap`, { method: 'HEAD' }));
    expect(response?.status).toBe(200);
    expect(response?.headers.get('Cache-Control')).toBe('no-cache');
    expect(response?.headers.get('ETag')).toBeNull();
    expect(response?.body).toBeNull();
    expect(reads).toEqual([]);
  });

  it('leaves anything but a GET or HEAD, and the site’s other pages, to the pages', async () => {
    const { answer, assets } = board();
    expect(await answer(new Request(`${SITE}/roadmap`, { method: 'POST' }))).toBeNull();
    expect(await answer(new Request(`${SITE}/roadmap/`))).toBeNull();
    expect(await answer(new Request(`${SITE}/sync`))).toBeNull();
    expect(await answer(new Request(`${SITE}/apis`))).toBeNull();
    expect(assets.asked).toEqual([]);
  });
});

describe('a suggestion', () => {
  it('waits for Steve, and its ID goes back to the browser, which votes for it', async () => {
    const { db, answer } = board();
    const response = await answer(sent('/api/ideas', SUGGESTION));
    expect(response?.status).toBe(201);
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    const { id } = await read(response);
    expect(id).toMatch(ID);
    expect(db.sqlite.prepare('SELECT title, status, email FROM ideas').all()).toEqual([
      { title: 'Dark mode for PDFs', status: 'new', email: null },
    ]);
    const vote = await answer(
      sent(`/api/ideas/${id}/vote`, { vote: true, hash: hashOf('sam', String(id)) }),
    );
    expect(await read(vote)).toEqual({ voted: true, votes: 1 });
  });

  it('says what’s wrong with it, in words for the page to show', async () => {
    const { db, answer } = board();
    const response = await answer(sent('/api/ideas', { ...SUGGESTION, title: '' }));
    expect(response?.status).toBe(400);
    expect(await read(response)).toEqual({
      error: 'bad-request',
      message: 'Give the idea a title.',
    });
    for (const body of ['not json', 'x'.repeat(17_000)]) {
      expect((await answer(sent('/api/ideas', body)))?.status).toBe(400);
    }
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM ideas').get()).toEqual({ count: 0 });
  });

  it('is turned away for a while when too many wait already', async () => {
    const { db, answer } = board();
    for (let n = 0; n < WAITING_MAX; n += 1) await suggest(db, { ...SUGGESTION, email: null });
    const response = await answer(sent('/api/ideas', SUGGESTION));
    expect(response?.status).toBe(503);
    expect(await read(response)).toMatchObject({ error: 'busy' });
  });
});

describe('the roadmap page’s API', () => {
  it('takes only what the site’s own page sends: JSON, from factwright.com', async () => {
    const { db, answer } = board();
    const refused = async (request: Request, status: number) =>
      expect((await answer(request))?.status).toBe(status);
    await refused(sent('/api/ideas', SUGGESTION, { 'Content-Type': 'text/plain' }), 415);
    await refused(sent('/api/ideas', SUGGESTION, { Origin: 'https://example.com' }), 403);
    await refused(sent('/api/ideas', SUGGESTION, { 'Sec-Fetch-Site': 'cross-site' }), 403);
    await refused(sent('/api/ideas', SUGGESTION, { Origin: 'http://factwright.com' }), 403);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM ideas').get()).toEqual({ count: 0 });
    // A request that doesn't say where it's from, as a script outside a browser sends, counts.
    const plain = new Request(`${SITE}/api/ideas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SUGGESTION),
    });
    await refused(plain, 201);
  });

  it('limits each address, suggestions and votes apart, by the address it came from', async () => {
    const { db, answer, suggestLimit, voteLimit } = board();
    const id = await approvedIdea(db);
    await answer(sent('/api/ideas', SUGGESTION));
    await answer(sent(`/api/ideas/${id}/vote`, { vote: true, hash: hashOf('sam', id) }));
    await answer(
      sent(
        `/api/ideas/${id}/vote`,
        { vote: true, hash: hashOf('ana', id) },
        {
          'CF-Connecting-IP': '2001:db8:1:2:aaaa::1',
        },
      ),
    );
    expect(suggestLimit.keys).toEqual(['203.0.113.7']);
    expect(voteLimit.keys).toEqual(['203.0.113.7', '2001:db8:1:2::/64']);
  });

  it('turns away an address past its limit, with when to try again, saving nothing', async () => {
    const limited = limiter(0);
    const { db, answer } = board({ limits: { suggest: limited.limit, vote: limited.limit } });
    const id = await approvedIdea(db);
    for (const request of [
      sent('/api/ideas', SUGGESTION),
      sent(`/api/ideas/${id}/vote`, { vote: true, hash: hashOf('sam', id) }),
    ]) {
      const response = await answer(request);
      expect(response?.status).toBe(429);
      expect(response?.headers.get('Retry-After')).toBe('60');
      expect(await read(response)).toMatchObject({ error: 'too-many' });
    }
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM ideas').get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM votes').get()).toEqual({ count: 0 });
  });

  it('lets a request through when the limit can’t be told, or there is none', async () => {
    const failing: Limiter = {
      limit: async () => {
        throw new Error('Rate limiting is down');
      },
    };
    for (const limits of [{ suggest: failing }, {}]) {
      const { answer } = board({ limits });
      expect((await answer(sent('/api/ideas', SUGGESTION)))?.status).toBe(201);
    }
  });

  it('casts a vote and takes it back, saying where it stands', async () => {
    const { db, answer } = board();
    const id = await approvedIdea(db, ['ana']);
    const vote = (body: unknown) => answer(sent(`/api/ideas/${id}/vote`, body));
    expect(await read(await vote({ vote: true, hash: hashOf('sam', id) }))).toEqual({
      voted: true,
      votes: 2,
    });
    expect(await read(await vote({ vote: false, hash: hashOf('sam', id), moved: [] }))).toEqual({
      voted: false,
      votes: 1,
    });
    expect((await vote({ vote: 'yes', hash: hashOf('sam', id) }))?.status).toBe(400);
  });

  it('says when an idea isn’t there, or voting on it has closed', async () => {
    const { db, answer } = board();
    const id = await approvedIdea(db);
    const vote = (idea: string) =>
      answer(sent(`/api/ideas/${idea}/vote`, { vote: true, hash: hashOf('sam', idea) }));
    expect((await vote('not-an-id'))?.status).toBe(404);
    expect((await vote(crypto.randomUUID()))?.status).toBe(404);
    await changeIdea(db, id, { status: 'shipped', version: '0.19.0' });
    const closed = await vote(id);
    expect(closed?.status).toBe(409);
    expect(await read(closed)).toMatchObject({ message: 'Voting has closed on this idea.' });
  });

  it('answers anything else under /api with not found, and only POST for its two', async () => {
    const { db, answer } = board();
    const id = await approvedIdea(db);
    for (const path of ['/api', '/api/', '/api/ideas/', `/api/ideas/${id}`, '/api/votes']) {
      const response = await answer(new Request(`${SITE}${path}`));
      expect(response?.status, path).toBe(404);
      expect(await read(response), path).toMatchObject({ error: 'not-found' });
    }
    for (const path of ['/api/ideas', `/api/ideas/${id}/vote`]) {
      const response = await answer(new Request(`${SITE}${path}`));
      expect(response?.status, path).toBe(405);
      expect(response?.headers.get('Allow')).toBe('POST');
    }
  });

  it('says it can’t save when there’s no database, or it fails', async () => {
    const { answer } = board({ db: undefined });
    const response = await answer(sent('/api/ideas', SUGGESTION));
    expect(response?.status).toBe(503);
    expect(await read(response)).toMatchObject({ error: 'unavailable' });
    const failing = ideasDb();
    failing.sqlite.exec('DROP TABLE votes; DROP TABLE ideas;');
    const broken = board({ db: failing });
    expect((await broken.answer(sent('/api/ideas', SUGGESTION)))?.status).toBe(503);
  });
});

describe('the admin page', () => {
  it('lets no one in without Access’s sign-in, whatever’s under it', async () => {
    const { answer, assets } = board();
    for (const path of [
      '/roadmap/admin',
      '/roadmap/admin/',
      '/roadmap/admin.html',
      '/roadmap/administrator',
      '/roadmap/admin/api/ideas',
    ]) {
      const response = await answer(new Request(`${SITE}${path}`));
      expect(response?.status, path).toBe(403);
      expect(response?.headers.get('Cache-Control'), path).toBe('no-store');
      expect(response?.headers.get('X-Robots-Tag'), path).toBe('noindex');
    }
    expect(assets.asked).toEqual([]);
  });

  it('shows Steve the page, kept out of caches and search engines', async () => {
    const { answer } = board({ signedIn: true });
    const response = await answer(new Request(`${SITE}/roadmap/admin`));
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe('<h1>Admin</h1>');
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    expect(response?.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(response?.headers.get('Content-Type')).toBe('text/html');
  });

  it('gives Steve every idea, emails too, and who’s signed in', async () => {
    const { db, answer } = board({ signedIn: true });
    await suggest(db, { ...SUGGESTION, email: 'sam@example.com' });
    const response = await answer(new Request(`${SITE}/roadmap/admin/api/ideas`));
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    expect(await read(response)).toEqual({
      you: 'steve@factwright.com',
      ideas: [expect.objectContaining({ title: 'Dark mode for PDFs', email: 'sam@example.com' })],
    });
  });

  it('approves, merges, declines and forgets an email, giving back every idea after', async () => {
    const { db, answer } = board({ signedIn: true });
    const target = await approvedIdea(db, ['ana']);
    const ids: string[] = [];
    for (const email of ['sam@example.com', 'lee@example.com', 'kim@example.com', null]) {
      const made = await suggest(db, { ...SUGGESTION, email });
      if (made !== 'busy') ids.push(made.id);
    }
    const [approve = '', merge = '', decline = '', forget = ''] = ids;
    const change = (path: string, body: unknown) =>
      answer(sent(`/roadmap/admin/api/ideas/${path}`, body));
    const approved = await read(
      await change(approve, { title: 'Dark mode', words: '', status: 'planned' }),
    );
    expect(approved.you).toBe('steve@factwright.com');
    expect(approved.ideas).toContainEqual(
      expect.objectContaining({ id: approve, title: 'Dark mode', status: 'planned' }),
    );
    const merged = await read(await change(`${merge}/merge`, { into: target }));
    expect(merged.ideas).not.toContainEqual(expect.objectContaining({ id: merge }));
    expect(merged.ideas).toContainEqual(expect.objectContaining({ id: target, merged: [merge] }));
    const declined = await read(await change(`${decline}/decline`, {}));
    expect(declined.ideas).not.toContainEqual(expect.objectContaining({ id: decline }));
    await change(`${approve}/forget-email`, {});
    const after = await read(await answer(new Request(`${SITE}/roadmap/admin/api/ideas`)));
    expect(after.ideas).toContainEqual(expect.objectContaining({ id: approve, email: null }));
    expect(after.ideas).toContainEqual(expect.objectContaining({ id: forget }));
  });

  it('says what’s wrong with a change, in words for the page to show', async () => {
    const { db, answer } = board({ signedIn: true });
    const id = await approvedIdea(db);
    const change = (path: string, body: unknown) =>
      answer(sent(`/roadmap/admin/api/ideas/${path}`, body));
    const shipped = await change(id, { status: 'shipped' });
    expect(shipped?.status).toBe(400);
    expect(await read(shipped)).toMatchObject({
      message: 'Say which version it shipped in, such as 0.19.0.',
    });
    expect(await read(await change(`${id}/merge`, {}))).toMatchObject({
      message: 'Choose the idea to merge it into.',
    });
    expect((await change(crypto.randomUUID(), { status: 'planned' }))?.status).toBe(404);
    expect((await change('not-an-id', { status: 'planned' }))?.status).toBe(404);
    expect((await change(`${id}/explode`, {}))?.status).toBe(404);
  });

  it('takes changes only from the admin page itself, which says it’s from factwright.com', async () => {
    const { db, answer } = board({ signedIn: true });
    const id = await approvedIdea(db);
    const path = `/roadmap/admin/api/ideas/${id}`;
    const body = { status: 'planned' };
    // Unlike the roadmap page's API, it needs to know where a change came from.
    const unsaid = new Request(`${SITE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    for (const request of [
      unsaid,
      sent(path, body, { Origin: 'https://example.com' }),
      sent(path, body, { 'Sec-Fetch-Site': 'same-site' }),
      sent(path, body, { 'Content-Type': 'text/plain' }),
    ]) {
      expect([403, 415]).toContain((await answer(request))?.status);
    }
    expect((await answer(sent(path, body, {}, 'PUT')))?.status).toBe(405);
    expect((await answer(sent('/roadmap/admin/api/ideas', {})))?.status).toBe(405);
    const [idea] = db.sqlite.prepare('SELECT status FROM ideas').all();
    expect(idea).toEqual({ status: 'considering' });
  });
});

describe('what a limit counts a request by', () => {
  it('is an IPv4 address, or an IPv6 address’s first half', () => {
    expect(limitKey('203.0.113.7')).toBe('203.0.113.7');
    expect(limitKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(limitKey('2001:0DB8:0000:0042:0000:ff00:0042:8329')).toBe('2001:db8:0:42::/64');
    expect(limitKey('2001:db8:1:2:3:4:5:6')).toBe(limitKey('2001:db8:1:2:9:9:9:9'));
    expect(limitKey('::1')).toBe('0:0:0:0::/64');
    expect(limitKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(limitKey(null)).toBe('unknown');
  });
});
