// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_API, type AdminBrowser, adminPage, CONFIRM_MS, writeTo } from '../src/admin-page.ts';
import type { AdminIdea } from '../worker/ideas.ts';

/** The page, as it's built. Paths, since jsdom's URL isn't one Node's file reading accepts. */
const PAGE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'roadmap', 'admin.html'),
  'utf8',
);

/** The admin page in this test's document, without its script. */
function open(): HTMLElement {
  const parsed = new DOMParser().parseFromString(PAGE, 'text/html');
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
  return document.querySelector<HTMLElement>('[data-admin]') as HTMLElement;
}

let made = 0;
function idea(fields: Partial<AdminIdea> = {}): AdminIdea {
  made += 1;
  return {
    id: `00000000-0000-4000-8000-${String(made).padStart(12, '0')}`,
    title: `Idea ${made}`,
    words: 'Some lines.',
    status: 'considering',
    version: null,
    votes: 0,
    merged: [],
    email: null,
    created: '2026-10-26T15:00:00.000Z',
    updated: '2026-10-26T15:00:00.000Z',
    ...fields,
  };
}

const YOU = 'steve@factwright.com';

/** The admin API, answering with every idea after each change, as the Worker does. */
function api(ideas: AdminIdea[], change?: (path: string, body: unknown) => Response | null) {
  const sent: [string, unknown][] = [];
  const browser: AdminBrowser = {
    load: async () => Response.json({ you: YOU, ideas }),
    send: async (path, body) => {
      sent.push([path, body]);
      return change?.(path, body) ?? Response.json({ you: YOU, ideas });
    },
  };
  return { sent, browser };
}

const said = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();

const titles = (list: string) =>
  [...document.querySelectorAll(`[data-admin-list="${list}"] .admin-idea-title`)].map(said);

/** A card's button, by its words. */
const button = (id: string, words: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(`[data-idea="${id}"] button`)].find(
    (each) => said(each) === words,
  ) as HTMLButtonElement;

const dialog = (name: string) =>
  document.querySelector<HTMLDialogElement>(`[data-admin-dialog="${name}"]`) as HTMLDialogElement;

const field = (name: string, form = 'edit') =>
  dialog(form).querySelector<HTMLInputElement>(`[name="${name}"]`) as HTMLInputElement;

const submit = (name: string) =>
  dialog(name)
    .querySelector('form')
    ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

const settle = () => new Promise((done) => setTimeout(done, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('the admin page', () => {
  it('lists new suggestions first, then the page’s ideas by where they stand', async () => {
    const root = open();
    const ideas = [
      idea({ title: 'Waiting', status: 'new' }),
      idea({ title: 'Started', status: 'in-progress' }),
      idea({ title: 'Coming', status: 'planned' }),
      idea({ title: 'Loved', votes: 3 }),
      idea({ title: 'Out', status: 'shipped', version: '0.19.0' }),
    ];
    await adminPage(root, api(ideas).browser);
    expect(titles('new')).toEqual(['Waiting']);
    expect(titles('in-progress')).toEqual(['Started']);
    expect(titles('planned')).toEqual(['Coming']);
    expect(titles('considering')).toEqual(['Loved']);
    expect(titles('shipped')).toEqual(['Out']);
    expect(said(document.querySelector('[data-admin-summary]'))).toBe(
      '1 new suggestion · 4 on the page',
    );
    expect(said(document.querySelector('[data-admin-you]'))).toBe(YOU);
    // Nothing's off the page, so its part isn't shown.
    expect(document.querySelector<HTMLElement>('[data-admin-section="not-planned"]')?.hidden).toBe(
      true,
    );
    expect(said(document.querySelector('[data-admin-list="shipped"] .admin-idea-meta'))).toContain(
      'Shipped in 0.19.0',
    );
  });

  it('says when there’s nothing new, or nothing in a list', async () => {
    const root = open();
    await adminPage(root, api([idea({ status: 'not-planned', title: 'Off' })]).browser);
    expect(said(document.querySelector('[data-admin-list="new"]'))).toBe(
      'Nothing new. You’re all caught up.',
    );
    expect(said(document.querySelector('[data-admin-list="planned"]'))).toBe('None yet.');
    expect(titles('not-planned')).toEqual(['Off']);
    expect(said(document.querySelector('[data-admin-summary]'))).toBe(
      'Nothing new · 0 on the page · 1 not planned',
    );
  });

  it('keeps every heading a level below its list’s', async () => {
    const root = open();
    await adminPage(root, api([idea({ status: 'new' }), idea({ status: 'planned' })]).browser);
    let level = 0;
    for (const heading of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const next = Number(heading.tagName[1]);
      expect(next, heading.textContent ?? '').toBeLessThanOrEqual(level + 1);
      level = next;
    }
  });

  it('shows what people wrote as text, whatever it holds', async () => {
    const root = open();
    await adminPage(
      root,
      api([idea({ status: 'new', title: '<img src=x onerror=alert(1)>', words: '<b>hi</b>' })])
        .browser,
    );
    expect(document.querySelector('main img, main b')).toBeNull();
    expect(titles('new')).toEqual(['<img src=x onerror=alert(1)>']);
  });

  it('offers to write to whoever left an email, in Steve’s own mail app', async () => {
    const root = open();
    const asking = idea({ status: 'new', title: 'Referrals', email: 'sam@example.com' });
    await adminPage(root, api([asking]).browser);
    const link = document.querySelector<HTMLAnchorElement>(
      `[data-idea="${asking.id}"] .admin-email a`,
    );
    expect(said(link)).toBe('sam@example.com');
    expect(link?.getAttribute('href')).toBe(writeTo(asking));
    const draft = new URL(writeTo(asking));
    expect(draft.protocol).toBe('mailto:');
    expect(draft.pathname).toBe('sam@example.com');
    expect(draft.searchParams.get('subject')).toBe('Your idea for Factwright: Referrals');
    expect(draft.searchParams.get('body')).toContain('Thanks for suggesting “Referrals”');
  });

  it('approves a suggestion with its words edited, and goes to it where it is now', async () => {
    const root = open();
    const fresh = idea({ status: 'new', title: 'Refferals', words: 'Who referred me.' });
    const after = { ...fresh, title: 'Keep track of referrals', status: 'planned' as const };
    const { sent, browser } = api([fresh], () => Response.json({ you: YOU, ideas: [after] }));
    await adminPage(root, browser);
    button(fresh.id, 'Approve…').click();
    expect(dialog('edit').open).toBe(true);
    expect(said(dialog('edit').querySelector('h2'))).toBe('Approve this idea');
    expect(field('title').value).toBe('Refferals');
    expect(field('words').value).toBe('Who referred me.');
    expect(field('status').value).toBe('considering');
    field('title').value = 'Keep track of referrals';
    field('status').value = 'planned';
    field('status').dispatchEvent(new Event('change'));
    submit('edit');
    await settle();
    expect(sent).toEqual([
      [
        `${ADMIN_API}/${fresh.id}`,
        { title: 'Keep track of referrals', words: 'Who referred me.', status: 'planned' },
      ],
    ]);
    expect(dialog('edit').open).toBe(false);
    expect(titles('planned')).toEqual(['Keep track of referrals']);
    expect(document.activeElement).toBe(button(fresh.id, 'Change…'));
    expect(said(document.querySelector('[data-road-note]'))).toBe('Approved. It’s on the page.');
  });

  it('needs the version to ship, and says first that shipping forgets the suggester’s email', async () => {
    const root = open();
    const planned = idea({ status: 'planned', title: 'Referrals', email: 'sam@example.com' });
    const { sent, browser } = api([planned]);
    await adminPage(root, browser);
    button(planned.id, 'Change…').click();
    const version = dialog('edit').querySelector<HTMLElement>('[data-edit-version]');
    const closing = dialog('edit').querySelector<HTMLElement>('[data-admin-closing]');
    expect(version?.hidden).toBe(true);
    expect(closing?.hidden).toBe(true);
    field('status').value = 'shipped';
    field('status').dispatchEvent(new Event('change'));
    expect(version?.hidden).toBe(false);
    expect(field('version').required).toBe(true);
    expect(said(closing)).toBe(
      'They left their email, sam@example.com, which is forgotten once it’s shipped. Write to them first?',
    );
    expect(closing?.querySelector('a')?.getAttribute('href')).toBe(writeTo(planned));
    field('version').value = '0.19.0';
    submit('edit');
    await settle();
    expect(sent[0]?.[1]).toEqual({
      title: 'Referrals',
      words: 'Some lines.',
      status: 'shipped',
      version: '0.19.0',
    });
  });

  it('keeps the dialog open with what went wrong when a change doesn’t save', async () => {
    const root = open();
    const planned = idea({ status: 'planned' });
    const { browser } = api([planned], () =>
      Response.json({ error: 'bad-request', message: 'Give the idea a title.' }, { status: 400 }),
    );
    await adminPage(root, browser);
    button(planned.id, 'Change…').click();
    field('title').value = '';
    submit('edit');
    await settle();
    expect(dialog('edit').open).toBe(true);
    expect(said(dialog('edit').querySelector('[data-admin-dialog-problem]'))).toBe(
      'Give the idea a title.',
    );
  });

  it('merges an idea into one Steve approved, and goes to that one', async () => {
    const root = open();
    const fresh = idea({ status: 'new', title: 'Dark popup', email: 'lee@example.com' });
    const other = idea({ status: 'new', title: 'Another new one' });
    const target = idea({ title: 'Dark mode', votes: 2 });
    const merged = { ...target, votes: 3, merged: [fresh.id] };
    const { sent, browser } = api([fresh, other, target], () =>
      Response.json({ you: YOU, ideas: [other, merged] }),
    );
    await adminPage(root, browser);
    button(fresh.id, 'Merge…').click();
    expect(said(dialog('merge').querySelector('h2'))).toBe('Merge “Dark popup”');
    const options = [...dialog('merge').querySelectorAll('option')];
    expect(options.map((option) => [option.value, said(option)])).toEqual([
      [target.id, 'Dark mode · To vote on · 2 votes'],
    ]);
    expect(said(dialog('merge').querySelector('[data-admin-closing]'))).toContain(
      'which is forgotten once it’s merged',
    );
    submit('merge');
    await settle();
    expect(sent).toEqual([[`${ADMIN_API}/${fresh.id}/merge`, { into: target.id }]]);
    expect(titles('new')).toEqual(['Another new one']);
    expect(document.activeElement).toBe(button(target.id, 'Change…'));
    expect(said(document.querySelector('[data-road-note]'))).toBe('Merged into “Dark mode”.');
  });

  it('can’t merge until there’s an approved idea to merge into', async () => {
    const root = open();
    const fresh = idea({ status: 'new' });
    await adminPage(root, api([fresh, idea({ status: 'new' })]).browser);
    button(fresh.id, 'Merge…').click();
    expect(
      dialog('merge').querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(true);
    expect(said(dialog('merge').querySelector('[data-admin-dialog-problem]'))).toBe(
      'Approve another idea first, to merge this one into.',
    );
  });

  it('declines a suggestion once Steve’s sure, starting on Cancel', async () => {
    const root = open();
    const fresh = idea({ status: 'new', title: 'Spam' });
    const { sent, browser } = api([fresh], () => Response.json({ you: YOU, ideas: [] }));
    await adminPage(root, browser);
    button(fresh.id, 'Decline…').click();
    expect(said(dialog('decline').querySelector('h2'))).toBe('Decline “Spam”?');
    expect(document.activeElement).toBe(dialog('decline').querySelector('[data-admin-cancel]'));
    expect(dialog('decline').querySelector<HTMLElement>('[data-admin-closing]')?.hidden).toBe(true);
    submit('decline');
    await settle();
    expect(sent).toEqual([[`${ADMIN_API}/${fresh.id}/decline`, {}]]);
    expect(titles('new')).toEqual([]);
    expect(document.activeElement).toBe(document.querySelector('[data-admin-title]'));
  });

  it('closes a dialog on Cancel, sending nothing', async () => {
    const root = open();
    const fresh = idea({ status: 'new' });
    const { sent, browser } = api([fresh]);
    await adminPage(root, browser);
    button(fresh.id, 'Decline…').click();
    dialog('decline').querySelector<HTMLButtonElement>('[data-admin-cancel]')?.click();
    expect(dialog('decline').open).toBe(false);
    expect(sent).toEqual([]);
  });

  it('forgets an email only on a second click, soon after the first', async () => {
    vi.useFakeTimers();
    const root = open();
    const asking = idea({ status: 'planned', email: 'sam@example.com' });
    const { sent, browser } = api([asking], () =>
      Response.json({ you: YOU, ideas: [{ ...asking, email: null }] }),
    );
    await adminPage(root, browser);
    const forget = () =>
      document.querySelector<HTMLButtonElement>(`[data-idea="${asking.id}"] .admin-forget`);
    expect(forget()?.getAttribute('aria-label')).toBe('Forget sam@example.com');
    forget()?.click();
    expect(said(forget())).toBe('Click again to forget');
    await vi.advanceTimersByTimeAsync(CONFIRM_MS);
    expect(said(forget())).toBe('Forget');
    expect(sent).toEqual([]);
    forget()?.click();
    forget()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([[`${ADMIN_API}/${asking.id}/forget-email`, {}]]);
    expect(forget()).toBeNull();
    expect(said(document.querySelector('[data-road-note]'))).toBe('Their email is forgotten.');
  });

  it('says why the ideas didn’t load, and tries again when asked', async () => {
    const root = open();
    let answer: () => Promise<Response> = async () => new Response('No', { status: 403 });
    const browser: AdminBrowser = {
      load: () => answer(),
      send: async () => Response.json({}),
    };
    await adminPage(root, browser);
    const problem = document.querySelector<HTMLElement>('[data-admin-problem]');
    expect(problem?.hidden).toBe(false);
    expect(said(problem?.querySelector('p'))).toBe(
      'Sign in through Cloudflare Access to see the ideas.',
    );
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    document.querySelector<HTMLButtonElement>('[data-admin-retry]')?.click();
    await settle();
    expect(said(problem?.querySelector('p'))).toBe(
      'The ideas couldn’t load. Check your connection, then try again.',
    );
    answer = async () =>
      Response.json({ you: YOU, ideas: [idea({ status: 'new', title: 'Back' })] });
    document.querySelector<HTMLButtonElement>('[data-admin-retry]')?.click();
    await settle();
    expect(problem?.hidden).toBe(true);
    expect(titles('new')).toEqual(['Back']);
  });
});
