// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Idea } from '../worker/ideas.ts';
import { countSlot, fillRoadmap, ideasSlot, LISTS, SHIPPED_SHOWN } from '../worker/roadmap.ts';

/** The page as the Worker gets it: each list and count empty, where it fills them in. */
const PAGE = LISTS.map((list) => `<h3><span ${countSlot(list)}</h3><ol ${ideasSlot(list)}`).join(
  '\n',
);

let made = 0;
/** An idea with a fresh ID, as given. */
function idea(fields: Partial<Idea> = {}): Idea {
  made += 1;
  return {
    id: `00000000-0000-4000-8000-${String(made).padStart(12, '0')}`,
    title: `Idea ${made}`,
    words: '',
    status: 'considering',
    version: null,
    votes: 0,
    merged: [],
    ...fields,
  };
}

/** The page, filled in, as a document to look through. */
function filled(ideas: readonly Idea[] | null): Document {
  return new DOMParser().parseFromString(fillRoadmap(PAGE, ideas), 'text/html');
}

const list = (doc: Document, name: string) =>
  [...doc.querySelectorAll(`[data-ideas="${name}"] > li`)].map((item) =>
    item.textContent?.replace(/\s+/g, ' ').trim(),
  );

describe('the roadmap page, filled in', () => {
  it('puts each idea in its list, with how many each column has', () => {
    const doc = filled([
      idea({ title: 'Vote on me', votes: 4 }),
      idea({ title: 'Coming', status: 'planned' }),
      idea({ title: 'Started', status: 'in-progress', votes: 1 }),
      idea({ title: 'Out', status: 'shipped', version: '0.19.0' }),
    ]);
    expect(list(doc, 'considering')).toEqual(['Vote, 4 votes Vote on me']);
    expect(list(doc, 'planned')).toEqual(['Coming Vote, 0 votes']);
    expect(list(doc, 'in-progress')).toEqual(['Started Vote, 1 vote']);
    expect(list(doc, 'shipped')).toEqual(['Out Shipped in 0.19.0']);
    expect(doc.querySelector('[data-ideas-count="planned"]')?.textContent).toBe('1');
    expect(doc.querySelector('[data-ideas-count="considering"]')?.textContent).toBe('1');
  });

  it('gives each idea it takes votes for a button its script turns on, which names it', () => {
    const shown = idea({ votes: 12, merged: ['a', 'b'] });
    const doc = filled([shown]);
    const item = doc.querySelector('.idea');
    expect(item?.getAttribute('data-idea')).toBe(shown.id);
    expect(item?.getAttribute('data-merged')).toBe('a b');
    const button = item?.querySelector<HTMLButtonElement>('button[data-vote]');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.type).toBe('button');
    expect(doc.getElementById(button?.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      shown.title,
    );
  });

  it('keeps what people wrote as text, whatever it holds', () => {
    const doc = filled([
      idea({ title: '<img src=x onerror=alert(1)>', words: 'Line one\n"two" & <b>three</b>' }),
    ]);
    expect(doc.querySelector('img, b')).toBeNull();
    expect(doc.querySelector('.idea-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(doc.querySelector('.idea-words')?.textContent).toBe('Line one\n"two" & <b>three</b>');
    // And never as a replacement pattern.
    const odd = filled([idea({ title: "$& and $' and $1" })]);
    expect(odd.querySelector('.idea-title')?.textContent).toBe("$& and $' and $1");
  });

  it('leaves out the lines of an idea that has none', () => {
    const doc = filled([idea({ words: '' }), idea({ status: 'planned', words: '' })]);
    expect(doc.querySelector('.idea-words, .road-card-words')).toBeNull();
  });

  it('links each shipped idea to the release it came in, and gives it no vote', () => {
    const doc = filled([idea({ status: 'shipped', version: '0.19.0' })]);
    const link = doc.querySelector('[data-ideas="shipped"] a');
    expect(link?.getAttribute('href')).toBe(
      'https://github.com/factwright/factwright/releases/tag/v0.19.0',
    );
    expect(
      doc.querySelector('[data-ideas="shipped"] button, [data-ideas="shipped"] [data-idea]'),
    ).toBeNull();
  });

  it('shows the newest shipped first, up to a few, with the rest on GitHub', () => {
    const versions = ['0.9.0', '0.20.0', '0.19.1', '0.20.0-beta.1', '0.19.0'];
    const doc = filled(
      versions.map((version) => idea({ status: 'shipped', version, title: version })),
    );
    expect(list(doc, 'shipped').map((text) => text?.split(' ')[0])).toEqual([
      '0.20.0',
      '0.20.0-beta.1',
      '0.19.1',
      '0.19.0',
      '0.9.0',
    ]);
    const many = Array.from({ length: SHIPPED_SHOWN + 2 }, (_, n) =>
      idea({ status: 'shipped', version: `0.${n}.0` }),
    );
    const long = filled(many);
    expect(long.querySelectorAll('[data-ideas="shipped"] .road-card')).toHaveLength(SHIPPED_SHOWN);
    expect(long.querySelector('[data-ideas="shipped"] .road-more a')?.getAttribute('href')).toBe(
      'https://github.com/factwright/factwright/releases',
    );
    expect(long.querySelector('[data-ideas-count="shipped"]')?.textContent).toBe(
      String(SHIPPED_SHOWN + 2),
    );
  });

  it('says so in each list that has nothing yet, with no count', () => {
    const doc = filled([]);
    expect(list(doc, 'planned')).toEqual(['Nothing planned yet.']);
    expect(list(doc, 'in-progress')).toEqual(['Nothing in progress right now.']);
    expect(list(doc, 'shipped')).toEqual(['Nothing shipped from here yet.']);
    expect(list(doc, 'considering')).toEqual(['No ideas to vote on yet. Suggest the first one.']);
    expect(doc.querySelector('[data-ideas="considering"] a')?.getAttribute('href')).toBe(
      '#suggest',
    );
    expect(doc.querySelector('[data-ideas-count="planned"]')?.textContent).toBe('');
  });

  it('says in each list when the ideas couldn’t be read', () => {
    const doc = filled(null);
    for (const each of LISTS) {
      expect(list(doc, each)).toEqual(['This couldn’t load just now. Try again in a minute.']);
    }
  });
});
