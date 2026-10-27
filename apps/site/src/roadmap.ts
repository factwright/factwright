/**
 * The roadmap page, roadmap.html, once the Worker has filled in its ideas (worker/roadmap.ts).
 * This turns on each idea's vote button and sends suggestions, to the site's own API.
 *
 * Votes need no account. The first time someone votes or suggests, the browser makes a random
 * voter ID and keeps it in its own storage, never in a cookie, with the ideas it voted for. A vote
 * sends only SHA-256 of that ID and the idea's, so the ID never leaves the browser, and the
 * server can't tell one browser's votes are the same one's. Clicking again takes the vote back.
 */

/** Where the browser keeps its voter ID, and the ideas it voted for. */
export const VOTER_KEY = 'factwright.roadmap.voter';
export const VOTED_KEY = 'factwright.roadmap.voted';

/** How long a note about a vote that didn't go through stays. */
export const NOTE_MS = 5000;

/** What the page needs from the browser, which the tests stand in for. */
export interface RoadmapBrowser {
  /** The site's storage in this browser, or null where it keeps nothing. */
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Sends JSON to the site's API, and gives its answer. */
  send: (path: string, body: unknown) => Promise<Response>;
  /** SHA-256 of some text, in hex. */
  hash: (text: string) => Promise<string>;
  /** A new random voter ID. */
  newVoter: () => string;
}

/** What this browser can do. Some won't give the page its storage at all. */
export function roadmapBrowser(): RoadmapBrowser {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    // Kept for this visit only.
  }
  return {
    storage,
    send: (path, body) =>
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    hash: async (text) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    },
    newVoter: () => crypto.randomUUID(),
  };
}

/** The browser's voter ID and the ideas it voted for, kept in its storage where it can be. */
interface Ballot {
  /** The voter ID, made the first time it's needed. */
  voter(): string;
  /** Whether this browser voted for an idea, or for one merged into it, whose vote came along. */
  votedFor(ids: readonly string[]): boolean;
  /** Notes a vote cast for an idea, or taken back, with any that came along with a merge. */
  mark(ids: readonly string[], voted: boolean): void;
}

function ballotIn({ storage, newVoter }: RoadmapBrowser): Ballot {
  const read = (key: string) => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string) => {
    try {
      storage?.setItem(key, value);
    } catch {
      // Full, or not allowed: it lasts this visit.
    }
  };
  let voter = read(VOTER_KEY);
  let kept: unknown = [];
  try {
    kept = JSON.parse(read(VOTED_KEY) ?? '[]');
  } catch {
    // Unreadable, so it starts again.
  }
  const voted = new Set(
    Array.isArray(kept) ? kept.filter((id): id is string => typeof id === 'string') : [],
  );
  return {
    voter: () => {
      if (!voter) {
        voter = newVoter();
        write(VOTER_KEY, voter);
      }
      return voter;
    },
    votedFor: (ids) => ids.some((id) => voted.has(id)),
    mark: ([id, ...merged], vote) => {
      if (!id) return;
      if (vote) voted.add(id);
      else for (const each of [id, ...merged]) voted.delete(each);
      write(VOTED_KEY, JSON.stringify([...voted]));
    },
  };
}

/** What an answer from the API says went wrong, if it says, or null. */
async function problemIn(response: Response): Promise<string | null> {
  try {
    const { message } = (await response.json()) as { message?: unknown };
    return typeof message === 'string' ? message : null;
  } catch {
    return null;
  }
}

/** Shows where a vote stands on its button: pressed, and the count, in words for screen readers. */
function showVote(button: HTMLButtonElement, voted: boolean, votes: number): void {
  button.setAttribute('aria-pressed', String(voted));
  const count = button.querySelector('[data-votes]');
  const word = button.querySelector('[data-votes-word]');
  if (count) count.textContent = String(votes);
  if (word) word.textContent = votes === 1 ? ' vote' : ' votes';
}

/**
 * Sets the roadmap page up: shows each vote this browser cast, turns the vote buttons on, and
 * sends the form's suggestions. Without this script, the counts show, and the form stays hidden.
 */
export function roadmap(root: HTMLElement, browser: RoadmapBrowser = roadmapBrowser()): void {
  const ballot = ballotIn(browser);
  const note = noteFor(root.querySelector<HTMLElement>('[data-road-note]'));

  /** Casts or takes back this browser's vote for an idea, by its hash with each idea it covers. */
  async function send(ids: readonly string[], vote: boolean) {
    const [id = '', ...merged] = ids;
    const voter = ballot.voter();
    const [hash, ...moved] = await Promise.all(
      [id, ...merged].map((each) => browser.hash(`${voter}:${each}`)),
    );
    return browser.send(`/api/ideas/${id}/vote`, { vote, hash, moved });
  }

  for (const item of root.querySelectorAll<HTMLElement>('[data-idea]')) {
    const button = item.querySelector<HTMLButtonElement>('[data-vote]');
    const id = item.dataset.idea;
    if (!button || !id) continue;
    const ids = [id, ...(item.dataset.merged ?? '').split(' ').filter(Boolean)];
    const votes = () => Number(button.querySelector('[data-votes]')?.textContent) || 0;
    if (ballot.votedFor(ids)) button.setAttribute('aria-pressed', 'true');
    button.disabled = false;
    button.addEventListener('click', async () => {
      if (button.getAttribute('aria-busy') === 'true') return;
      const was = { voted: button.getAttribute('aria-pressed') === 'true', votes: votes() };
      const vote = !was.voted;
      // It shows at once, and the server's count follows.
      showVote(button, vote, Math.max(0, was.votes + (vote ? 1 : -1)));
      button.classList.toggle('is-voting', vote);
      button.setAttribute('aria-busy', 'true');
      try {
        const response = await send(ids, vote);
        if (!response.ok) {
          showVote(button, was.voted, was.votes);
          note(
            (await problemIn(response)) ?? 'Your vote didn’t go through. Try again in a moment.',
          );
          return;
        }
        const answer = (await response.json()) as { voted: boolean; votes: number };
        showVote(button, answer.voted, answer.votes);
        ballot.mark(ids, answer.voted);
      } catch {
        showVote(button, was.voted, was.votes);
        note('Your vote didn’t go through. Check your connection, then try again.');
      } finally {
        button.removeAttribute('aria-busy');
      }
    });
  }

  for (const part of root.querySelectorAll<HTMLElement>('[data-needs-script]')) part.hidden = false;
  for (const part of root.querySelectorAll<HTMLElement>('[data-without-script]')) {
    part.hidden = true;
  }
  const form = root.querySelector<HTMLFormElement>('[data-suggest-form]');
  if (form) {
    suggestions(form, root, browser, async (id) => {
      // The suggester's own vote, for when it's put up. Nobody else can vote on it till then.
      try {
        const response = await send([id], true);
        if (response.ok) ballot.mark([id], true);
      } catch {
        // The idea's kept all the same.
      }
    });
  }
}

/** Sends the form's suggestion, says thanks, and lets someone suggest another. */
function suggestions(
  form: HTMLFormElement,
  root: HTMLElement,
  browser: RoadmapBrowser,
  voteFor: (id: string) => Promise<void>,
): void {
  const send = form.querySelector<HTMLButtonElement>('[data-suggest-send]');
  const problem = form.querySelector<HTMLElement>('[data-suggest-problem]');
  const thanks = root.querySelector<HTMLElement>('[data-suggest-thanks]');
  const thanksTitle = root.querySelector<HTMLElement>('[data-suggest-thanks-title]');
  const again = root.querySelector<HTMLButtonElement>('[data-suggest-again]');
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
  let sending = false;

  const say = (words: string) => {
    if (problem) problem.textContent = words;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    sending = true;
    say('');
    if (send) send.disabled = true;
    form.setAttribute('aria-busy', 'true');
    try {
      const response = await browser.send('/api/ideas', {
        title: field('title')?.value ?? '',
        words: field('words')?.value ?? '',
        email: field('email')?.value ?? '',
      });
      if (response.status !== 201) {
        say((await problemIn(response)) ?? 'Your idea didn’t send. Try again in a moment.');
        return;
      }
      const { id } = (await response.json()) as { id: string };
      form.reset();
      form.hidden = true;
      if (thanks) thanks.hidden = false;
      thanksTitle?.focus();
      await voteFor(id);
    } catch {
      say('Your idea didn’t send. Check your connection, then try again.');
    } finally {
      sending = false;
      if (send) send.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });

  again?.addEventListener('click', () => {
    if (thanks) thanks.hidden = true;
    form.hidden = false;
    field('title')?.focus();
  });
}

/** Says something briefly, at the foot of the page, as a vote that didn't go through. */
function noteFor(place: HTMLElement | null): (words: string) => void {
  let timer = 0;
  return (words) => {
    if (!place) return;
    place.textContent = words;
    place.classList.add('is-shown');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      place.classList.remove('is-shown');
      place.textContent = '';
    }, NOTE_MS);
  };
}
