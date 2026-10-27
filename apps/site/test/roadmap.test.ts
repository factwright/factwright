// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTE_MS, type RoadmapBrowser, roadmap, VOTED_KEY, VOTER_KEY } from '../src/roadmap.ts';
import type { Idea } from '../worker/ideas.ts';
import { fillRoadmap } from '../worker/roadmap.ts';

/** The page, as it's built. Paths, since jsdom's URL isn't one Node's file reading accepts. */
const PAGE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'roadmap.html'),
  'utf8',
);

const LOVED = '11111111-1111-4111-8111-111111111111';
const MERGED = '22222222-2222-4222-8222-222222222222';
const PLANNED = '33333333-3333-4333-8333-333333333333';

const IDEAS: Idea[] = [
  {
    id: LOVED,
    title: 'Follow-up reminders',
    words: 'A nudge a week after I apply.',
    status: 'considering',
    version: null,
    votes: 4,
    merged: [MERGED],
  },
  {
    id: PLANNED,
    title: 'Import jobs',
    words: '',
    status: 'planned',
    version: null,
    votes: 1,
    merged: [],
  },
];

/** The page as the Worker serves it, in this test's document. */
function open(ideas = IDEAS): HTMLElement {
  const parsed = new DOMParser().parseFromString(fillRoadmap(PAGE, ideas), 'text/html');
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
  return document.querySelector<HTMLElement>('[data-roadmap]') as HTMLElement;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** A store like the browser's, with what's kept in it. */
function storage(kept: Record<string, string> = {}) {
  return {
    kept,
    getItem: (key: string) => kept[key] ?? null,
    setItem: (key: string, value: string) => {
      kept[key] = value;
    },
  };
}

/** The browser, sending to an API that answers as given, noting what was sent. */
function browser(
  answer: (path: string, body: Record<string, unknown>) => Response | Promise<Response>,
  fields: Partial<RoadmapBrowser> = {},
) {
  const sent: [string, Record<string, unknown>][] = [];
  const store = storage();
  const fake: RoadmapBrowser = {
    storage: store,
    send: async (path, body) => {
      sent.push([path, body as Record<string, unknown>]);
      return answer(path, body as Record<string, unknown>);
    },
    hash: async (text) => sha256(text),
    newVoter: () => 'voter-1',
    ...fields,
  };
  return { sent, store, fake };
}

/** An API that counts votes as the server would, from a starting count. */
const counting = (votes: number) => (_path: string, body: Record<string, unknown>) =>
  Response.json({ voted: body.vote, votes: body.vote ? votes + 1 : votes - 1 });

const voteButton = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-idea="${id}"] [data-vote]`) as HTMLButtonElement;

const said = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim();

/** Lets the page's script finish what a click started. */
const settle = () => new Promise((done) => setTimeout(done, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('the roadmap’s votes', () => {
  it('turn on once the script runs, showing the votes this browser cast', () => {
    const root = open();
    expect(voteButton(LOVED).disabled).toBe(true);
    const { fake, store } = browser(counting(4));
    // A vote for an idea that was merged into this one counts as this browser's.
    store.kept[VOTED_KEY] = JSON.stringify([MERGED]);
    roadmap(root, fake);
    expect(voteButton(LOVED).disabled).toBe(false);
    expect(voteButton(LOVED).getAttribute('aria-pressed')).toBe('true');
    expect(voteButton(PLANNED).getAttribute('aria-pressed')).toBe('false');
  });

  it('cast a vote with a hash of the voter ID and the idea’s, and nothing else', async () => {
    const root = open();
    const { fake, sent, store } = browser(counting(4));
    roadmap(root, fake);
    voteButton(LOVED).click();
    // It shows at once.
    expect(voteButton(LOVED).getAttribute('aria-pressed')).toBe('true');
    expect(said(voteButton(LOVED))).toBe('Vote, 5 votes');
    await settle();
    // This browser never voted for the idea merged into it, so the vote names no other.
    expect(sent).toEqual([
      [`/api/ideas/${LOVED}/vote`, { vote: true, hash: sha256(`voter-1:${LOVED}`), moved: [] }],
    ]);
    expect(JSON.stringify(sent)).not.toContain('voter-1"');
    expect(store.kept[VOTER_KEY]).toBe('voter-1');
    expect(JSON.parse(store.kept[VOTED_KEY] ?? '[]')).toEqual([LOVED]);
  });

  it('take a vote back, with any that came along with a merge', async () => {
    const root = open();
    const { fake, sent, store } = browser(counting(4));
    store.kept[VOTER_KEY] = 'voter-9';
    store.kept[VOTED_KEY] = JSON.stringify([MERGED, PLANNED]);
    roadmap(root, fake);
    voteButton(LOVED).click();
    await settle();
    // The vote that came along with the merge is named, so it's the one taken back.
    expect(sent[0]?.[1]).toEqual({
      vote: false,
      hash: sha256(`voter-9:${LOVED}`),
      moved: [sha256(`voter-9:${MERGED}`)],
    });
    expect(voteButton(LOVED).getAttribute('aria-pressed')).toBe('false');
    expect(said(voteButton(LOVED))).toBe('Vote, 3 votes');
    expect(JSON.parse(store.kept[VOTED_KEY] ?? '[]')).toEqual([PLANNED]);
  });

  it('still work on an idea with more merged into it than a vote can name', async () => {
    const many = Array.from(
      { length: 60 },
      (_, n) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`,
    );
    const root = open([{ ...(IDEAS[0] as Idea), merged: many }]);
    const { fake, sent, store } = browser(counting(4));
    store.kept[VOTER_KEY] = 'voter-9';
    store.kept[VOTED_KEY] = JSON.stringify([many[41]]);
    roadmap(root, fake);
    expect(voteButton(LOVED).getAttribute('aria-pressed')).toBe('true');
    voteButton(LOVED).click();
    await settle();
    expect(sent[0]?.[1]).toEqual({
      vote: false,
      hash: sha256(`voter-9:${LOVED}`),
      moved: [sha256(`voter-9:${many[41]}`)],
    });
  });

  it('show the server’s count, and say “vote” for one', async () => {
    const root = open();
    const { fake } = browser(() => Response.json({ voted: true, votes: 1 }));
    roadmap(root, fake);
    voteButton(LOVED).click();
    await settle();
    expect(said(voteButton(LOVED))).toBe('Vote, 1 vote');
  });

  it('go back as they were when a vote doesn’t go through, and say why', async () => {
    vi.useFakeTimers();
    const root = open();
    const { fake, store } = browser(() =>
      Response.json(
        { error: 'too-many', message: 'That’s a lot at once. Wait a minute, then try again.' },
        { status: 429 },
      ),
    );
    roadmap(root, fake);
    voteButton(LOVED).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(voteButton(LOVED).getAttribute('aria-pressed')).toBe('false');
    expect(said(voteButton(LOVED))).toBe('Vote, 4 votes');
    const note = document.querySelector('[data-road-note]');
    expect(note?.textContent).toBe('That’s a lot at once. Wait a minute, then try again.');
    expect(note?.classList).toContain('is-shown');
    expect(store.kept[VOTED_KEY]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(NOTE_MS);
    expect(note?.classList).not.toContain('is-shown');
  });

  it('say so plainly when the vote can’t reach the site', async () => {
    const root = open();
    const { fake } = browser(() => Promise.reject(new TypeError('Failed to fetch')));
    roadmap(root, fake);
    voteButton(PLANNED).click();
    await settle();
    expect(document.querySelector('[data-road-note]')?.textContent).toBe(
      'Your vote didn’t go through. Check your connection, then try again.',
    );
    expect(said(voteButton(PLANNED))).toBe('Vote, 1 vote');
  });

  it('wait for one vote to go through before the next click counts', async () => {
    const root = open();
    let finish: (response: Response) => void = () => {};
    const { fake, sent } = browser(
      () =>
        new Promise<Response>((done) => {
          finish = done;
        }),
    );
    roadmap(root, fake);
    voteButton(LOVED).click();
    await settle();
    voteButton(LOVED).click();
    await settle();
    expect(sent).toHaveLength(1);
    finish(Response.json({ voted: true, votes: 5 }));
    await settle();
    voteButton(LOVED).click();
    await settle();
    expect(sent).toHaveLength(2);
  });

  it('still work where the browser keeps nothing, for the visit', async () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    for (const kept of [null, throwing]) {
      const root = open();
      const { fake, sent } = browser(counting(4), { storage: kept });
      roadmap(root, fake);
      voteButton(LOVED).click();
      await settle();
      expect(sent).toHaveLength(1);
      expect(voteButton(LOVED).getAttribute('aria-pressed')).toBe('true');
    }
  });
});

describe('suggesting a feature', () => {
  /** The form, filled in. */
  function fill(title: string, words: string, email = '') {
    const form = document.querySelector<HTMLFormElement>('[data-suggest-form]') as HTMLFormElement;
    (form.elements.namedItem('title') as HTMLInputElement).value = title;
    (form.elements.namedItem('words') as HTMLTextAreaElement).value = words;
    (form.elements.namedItem('email') as HTMLInputElement).value = email;
    return form;
  }

  const submit = (form: HTMLFormElement) =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  const NEW_ID = '44444444-4444-4444-8444-444444444444';

  it('shows the form once the script runs, in place of the email address', () => {
    const root = open();
    const form = document.querySelector<HTMLFormElement>('[data-suggest-form]');
    const without = document.querySelector<HTMLElement>('[data-without-script]');
    expect(form?.hidden).toBe(true);
    expect(without?.hidden).toBe(false);
    roadmap(root, browser(counting(0)).fake);
    expect(form?.hidden).toBe(false);
    expect(without?.hidden).toBe(true);
  });

  it('sends it, says thanks, and votes for it as this browser', async () => {
    const root = open();
    const { fake, sent, store } = browser((path) =>
      path === '/api/ideas'
        ? Response.json({ id: NEW_ID }, { status: 201 })
        : Response.json({ voted: true, votes: 1 }),
    );
    roadmap(root, fake);
    const form = fill('Practice questions', 'Ask me what they might.', 'sam@example.com');
    submit(form);
    await settle();
    await settle();
    expect(sent).toEqual([
      [
        '/api/ideas',
        { title: 'Practice questions', words: 'Ask me what they might.', email: 'sam@example.com' },
      ],
      [`/api/ideas/${NEW_ID}/vote`, { vote: true, hash: sha256(`voter-1:${NEW_ID}`), moved: [] }],
    ]);
    expect(form.hidden).toBe(true);
    const thanks = document.querySelector<HTMLElement>('[data-suggest-thanks]');
    expect(thanks?.hidden).toBe(false);
    expect(document.activeElement?.textContent).toBe('Thanks for the idea!');
    expect((form.elements.namedItem('title') as HTMLInputElement).value).toBe('');
    expect(JSON.parse(store.kept[VOTED_KEY] ?? '[]')).toEqual([NEW_ID]);
    // Suggest another brings the form back, empty, at its first field.
    document.querySelector<HTMLButtonElement>('[data-suggest-again]')?.click();
    expect(form.hidden).toBe(false);
    expect(thanks?.hidden).toBe(true);
    expect(document.activeElement?.id).toBe('idea-title');
  });

  it('says what the server says is wrong, and keeps what was typed', async () => {
    const root = open();
    const { fake } = browser(() =>
      Response.json(
        {
          error: 'bad-request',
          message: 'That email doesn’t look right. Check it, or leave it empty.',
        },
        { status: 400 },
      ),
    );
    roadmap(root, fake);
    const form = fill('Practice questions', 'Ask me.', 'sam@');
    submit(form);
    await settle();
    expect(document.querySelector('[data-suggest-problem]')?.textContent).toBe(
      'That email doesn’t look right. Check it, or leave it empty.',
    );
    expect(form.hidden).toBe(false);
    expect((form.elements.namedItem('title') as HTMLInputElement).value).toBe('Practice questions');
    expect(document.querySelector<HTMLButtonElement>('[data-suggest-send]')?.disabled).toBe(false);
  });

  it('says to check the connection when it can’t reach the site, and sends once at a time', async () => {
    const root = open();
    let fail: (error: Error) => void = () => {};
    const { fake, sent } = browser(
      () =>
        new Promise<Response>((_done, failed) => {
          fail = failed;
        }),
    );
    roadmap(root, fake);
    const form = fill('Practice questions', 'Ask me.');
    submit(form);
    submit(form);
    await settle();
    expect(sent).toHaveLength(1);
    expect(document.querySelector<HTMLButtonElement>('[data-suggest-send]')?.disabled).toBe(true);
    fail(new TypeError('Failed to fetch'));
    await settle();
    expect(document.querySelector('[data-suggest-problem]')?.textContent).toBe(
      'Your idea didn’t send. Check your connection, then try again.',
    );
  });

  it('thanks them even when their own vote doesn’t go through', async () => {
    const root = open();
    const { fake, store } = browser((path) =>
      path === '/api/ideas'
        ? Response.json({ id: NEW_ID }, { status: 201 })
        : Response.json({ error: 'too-many', message: 'Wait.' }, { status: 429 }),
    );
    roadmap(root, fake);
    submit(fill('Practice questions', 'Ask me.'));
    await settle();
    await settle();
    expect(document.querySelector<HTMLElement>('[data-suggest-thanks]')?.hidden).toBe(false);
    expect(store.kept[VOTED_KEY]).toBeUndefined();
  });
});

beforeEach(() => {
  document.body.innerHTML = '';
});
