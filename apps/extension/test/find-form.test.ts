import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB_SITES } from '../src/application-sites.ts';
import { findForm } from '../src/fill.ts';
import type { PageField, PageForm } from '../src/page/form.ts';

/**
 * A tab as the panel finds its form: its frames, the top one 0, each a page on a site with a form,
 * which the browser lets the extension read only on a site it reaches, and the job sites you
 * chose. Chrome reaches no frame of a tab whose own page it can't reach.
 */
const browser = vi.hoisted(() => {
  const state = {
    granted: new Set<string>(),
    items: {} as Record<string, unknown>,
    session: {} as Record<string, unknown>,
    frames: [] as { frameId: number; url: string; form: PageForm }[],
    read: [] as number[],
  };
  const reaches = (url: string) =>
    [...state.granted].some((site) => site.endsWith('/*') && url.startsWith(site.slice(0, -1)));
  const store = (items: Record<string, unknown>) => ({
    get: async (key: string) => (key in items ? { [key]: structuredClone(items[key]) } : {}),
    set: async (more: Record<string, unknown>) => {
      Object.assign(items, structuredClone(more));
    },
    remove: async () => {},
  });
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: 'factwright',
      getURL: (path: string) => `chrome-extension://factwright/${path}`,
    },
    permissions: {
      contains: async ({ origins = [] }: { origins?: string[] }) =>
        origins.every((site) => state.granted.has(site)),
    },
    storage: { local: store(state.items), session: store(state.session) },
    scripting: {
      executeScript: async ({
        target,
      }: {
        target: { tabId: number; frameIds?: number[]; allFrames?: boolean };
      }) => {
        const top = state.frames.find((frame) => frame.frameId === 0);
        if (target.allFrames) {
          if (!top || !reaches(top.url)) throw new Error('Cannot access contents of the page.');
          return state.frames
            .filter((frame) => reaches(frame.url))
            .map((frame) => ({ frameId: frame.frameId, result: frame.url }));
        }
        const [frameId = 0] = target.frameIds ?? [];
        const frame = state.frames.find((each) => each.frameId === frameId);
        if (!frame || !reaches(frame.url)) throw new Error('Cannot access contents of the page.');
        state.read.push(frameId);
        return [{ frameId, result: { did: 'read', form: frame.form } }];
      },
    },
  };
  return state;
});

const field = (ref: number, question: string, more: Partial<PageField> = {}): PageField => ({
  ref,
  key: `INPUT|text||${question}|${question}`,
  question,
  hint: '',
  section: '',
  control: 'text',
  type: 'text',
  autocomplete: '',
  name: question,
  options: [],
  required: false,
  limit: null,
  ...more,
});

/** An application form at an address, with this many fields, an email address among them. */
const application = (url: string, count = 3): PageForm => ({
  url,
  title: 'Apply',
  submitted: false,
  fields: [
    field(0, 'Name'),
    field(1, 'Email', { type: 'email' }),
    ...Array.from({ length: count - 2 }, (_, at) => field(at + 2, `Question ${at + 1}`)),
  ],
});

/** A company's careers page, which shows a job and a box to hear of new ones. */
const PAGE = 'https://careers.example.com/jobs/engineer';
const careers: PageForm = {
  url: PAGE,
  title: 'Careers',
  submitted: false,
  fields: [field(0, 'Email', { type: 'email' })],
};
const LEVER = 'https://jobs.lever.co/acme/7a1c9e40/apply';

beforeEach(() => {
  // The careers page is reached once you've clicked, as the browser lets the extension.
  browser.granted = new Set(['https://careers.example.com/*', ...JOB_SITES]);
  for (const key of Object.keys(browser.items)) delete browser.items[key];
  for (const key of Object.keys(browser.session)) delete browser.session[key];
  browser.items.jobSites = { all: true, sites: [] };
  browser.read.length = 0;
  browser.frames = [
    { frameId: 0, url: PAGE, form: careers },
    { frameId: 4, url: LEVER, form: application(LEVER) },
  ];
});

describe('finding the form in a tab', () => {
  it('takes the tab’s own page’s form, where it looks like an application', async () => {
    browser.frames[0] = { frameId: 0, url: PAGE, form: application(PAGE) };
    expect(await findForm(1)).toMatchObject({
      place: { tabId: 1, frameId: 0 },
      form: { url: PAGE },
    });
  });

  it('else the one in a frame from a job site you allowed, the one with most fields', async () => {
    expect(await findForm(1)).toMatchObject({
      place: { tabId: 1, frameId: 4 },
      form: { url: LEVER },
    });
    const other = 'https://jobs.lever.co/acme/1b2c3d4e/apply';
    browser.frames.push({ frameId: 9, url: other, form: application(other, 6) });
    expect(await findForm(1)).toMatchObject({ place: { frameId: 9 } });
  });

  it('reads no frame of a site you didn’t allow, nor one whose page moved there', async () => {
    browser.frames.push({
      frameId: 6,
      url: 'https://ads.example.net/slot',
      form: application('https://ads.example.net/slot', 9),
    });
    browser.granted.add('https://ads.example.net/*');
    browser.frames[1] = { frameId: 4, url: LEVER, form: application('https://ads.example.net/2') };
    expect(await findForm(1)).toMatchObject({ place: { frameId: 0 }, form: { url: PAGE } });
    expect(browser.read).not.toContain(6);
  });

  it('reads only the tab’s own page while the sites are off, as with your click alone', async () => {
    browser.items.jobSites = { all: false, sites: [] };
    expect(await findForm(1)).toMatchObject({ place: { frameId: 0 }, form: { url: PAGE } });
    expect(browser.read).toEqual([0]);
  });

  it('reads no frame in a page of LinkedIn’s or Indeed’s, where it gives answers to copy', async () => {
    const linkedIn = 'https://www.linkedin.com/jobs/view/4012345678/';
    browser.granted.add('https://www.linkedin.com/*');
    browser.frames[0] = { frameId: 0, url: linkedIn, form: { ...careers, url: linkedIn } };
    expect(await findForm(1)).toMatchObject({ place: { frameId: 0 }, form: { url: linkedIn } });
  });

  it('finds a frame’s form by the frames the script said hello from, where the page can’t be read', async () => {
    browser.granted.delete('https://careers.example.com/*');
    expect(await findForm(1)).toBeNull();
    browser.session.jobFrames = { 1: [{ frameId: 4, url: LEVER, doc: 'a' }] };
    expect(await findForm(1)).toMatchObject({ place: { frameId: 4 }, form: { url: LEVER } });
  });
});
