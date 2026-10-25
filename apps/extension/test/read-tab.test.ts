import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InjectionTarget } from '../src/ext.ts';
import type { PageJob } from '../src/page/read-job.ts';
import { readTab, withFrame } from '../src/read-tab.ts';

const html = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

/** A frame of a tab: the page it shows, by its address, and what's selected in it. */
interface Frame {
  frameId: number;
  url: string;
  html: string;
  select?: string;
}

/**
 * The browser as reading a tab sees it: each tab's frames, its top one 0, which the extension's
 * functions run in, each in a page of its own, as the browser runs them, with only what a page has.
 * A frame the browser keeps the extension out of isn't there. Each run is noted, by its frames.
 */
const browser = vi.hoisted(() => {
  const state = {
    frames: [] as Frame[],
    runs: [] as (number[] | 'all')[],
    run: (_frame: unknown, _func: string): unknown => null,
  };
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: 'test' },
    storage: { local: { get: async () => ({}) } },
    scripting: {
      executeScript: async ({ target, func }: { target: InjectionTarget; func: () => unknown }) => {
        state.runs.push(target.allFrames ? 'all' : (target.frameIds ?? [0]));
        const frames = state.frames.filter((frame) =>
          target.allFrames
            ? true
            : (target.frameIds ?? [0]).includes((frame as { frameId: number }).frameId),
        );
        return frames.map((frame) => ({
          frameId: (frame as { frameId: number }).frameId,
          result: state.run(frame, func.toString()),
        }));
      },
    },
  };
  return state;
});

/** Runs a function in a frame's own page, as the browser does, and hands back what it gives. */
browser.run = (frame, func) => {
  const { url, html: markup, select } = frame as Frame;
  const { window } = new JSDOM(markup, { url, runScripts: 'outside-only' });
  const selected = select && window.document.querySelector(select);
  if (selected) {
    const range = window.document.createRange();
    range.selectNodeContents(selected);
    window.getSelection()?.addRange(range);
  }
  // What it gives goes to the extension as the browser copies it, as plain values.
  return JSON.parse(JSON.stringify(window.eval(`(${func})()`)));
};

const ICIMS = 'https://careers-larkspurhealth.icims.com/jobs/8341/staff-software-engineer/job';

beforeEach(() => {
  browser.frames = [];
  browser.runs = [];
});

describe('reading a tab', () => {
  it('reads an applicant system’s posting in its frame, and keeps the tab’s own address', async () => {
    browser.frames = [
      { frameId: 0, url: ICIMS, html: html('icims-wrapper.html') },
      { frameId: 7, url: `${ICIMS}?in_iframe=1`, html: html('icims-posting.html') },
    ];
    const { page, unread } = await readTab({ id: 1, url: ICIMS, title: 'Larkspur Health blog' });
    expect(unread).toBeNull();
    expect(page).toMatchObject<Partial<PageJob>>({
      url: ICIMS,
      pageUrl: ICIMS,
      pageTitle: 'Larkspur Health blog',
      title: 'Staff Software Engineer',
      company: 'Larkspur Health',
      location: 'Remote, US',
      employment: 'Full time',
      source: 'structured',
    });
    expect(page.posting).toContain('Larkspur Health is rebuilding how its members sign in');
    expect(browser.runs).toEqual([[0], 'all', [7]]);
  });

  it('keeps the tab’s clean address once iCIMS has put its frame’s address in it', async () => {
    const moved = `${ICIMS}?mobile=false&width=1140&height=500&bga=true&needsRedirect=false&jan1offset=-300&jun1offset=-240`;
    browser.frames = [
      { frameId: 0, url: moved, html: html('icims-wrapper.html') },
      {
        frameId: 7,
        url: `${ICIMS}?in_iframe=1&mobile=false&width=1140`,
        html: html('icims-posting.html'),
      },
    ];
    const { page } = await readTab({ id: 1, url: moved, title: 'Larkspur Health blog' });
    expect(page).toMatchObject({ url: ICIMS, pageUrl: moved, title: 'Staff Software Engineer' });
  });

  it('reads the text you selected in a frame as the posting, with the job the page shows', async () => {
    const posting = `<p id="posting">${'Build the routing engine that plans every delivery. '.repeat(6)}</p>`;
    browser.frames = [
      {
        frameId: 0,
        url: 'https://careers.lumen.example/jobs/routing-engineer',
        html: '<title>Routing Engineer | Lumen</title><main><h1>Routing Engineer</h1><p>Apply below.</p></main>',
      },
      {
        frameId: 3,
        url: 'https://careers.lumen.example/embed/posting',
        html: `<main>${posting}</main>`,
        select: '#posting',
      },
    ];
    const { page } = await readTab({
      id: 1,
      url: 'https://careers.lumen.example/jobs/routing-engineer',
    });
    expect(page).toMatchObject({
      url: 'https://careers.lumen.example/jobs/routing-engineer',
      title: 'Routing Engineer',
      source: 'selection',
    });
    expect(page.posting).toMatch(/^Build the routing engine that plans every delivery\./);
  });

  it('reads no frame for text you selected on the page itself, or where none is a posting’s', async () => {
    const posting = `<p id="posting">${'Plan every delivery. '.repeat(20)}</p>`;
    browser.frames = [
      {
        frameId: 0,
        url: 'https://careers.lumen.example/jobs/7',
        html: `<main><h1>Routing Engineer</h1>${posting}</main>`,
        select: '#posting',
      },
      { frameId: 3, url: 'https://careers.lumen.example/embed/map', html: '<p>A map</p>' },
    ];
    expect(
      (await readTab({ id: 1, url: 'https://careers.lumen.example/jobs/7' })).page.source,
    ).toBe('selection');
    expect(browser.runs).toEqual([[0]]);

    browser.runs = [];
    browser.frames = [
      { ...(browser.frames[0] as Frame), select: undefined },
      ...browser.frames.slice(1),
    ];
    const { page } = await readTab({ id: 1, url: 'https://careers.lumen.example/jobs/7' });
    expect(page.title).toBe('Routing Engineer');
    expect(browser.runs).toEqual([[0], 'all']);
  });

  it('never reads LinkedIn’s frames', async () => {
    browser.frames = [
      {
        frameId: 0,
        url: 'https://www.linkedin.com/jobs/view/4012345678/',
        html: '<div class="jobs-description__content">Build payments.</div>',
      },
      {
        frameId: 3,
        url: 'https://www.linkedin.com/ads/frame',
        html: `<p id="ad">${'Buy now. '.repeat(40)}</p>`,
        select: '#ad',
      },
    ];
    await readTab({ id: 1, url: 'https://www.linkedin.com/jobs/view/4012345678/' });
    expect(browser.runs).toEqual([[0]]);
  });
});

describe('a page with what its frame shows', () => {
  const page: PageJob = {
    url: ICIMS,
    pageUrl: ICIMS,
    site: 'careers-larkspurhealth.icims.com',
    pageTitle: 'Larkspur Health blog',
    title: 'Larkspur Health blog',
    company: 'Larkspurhealth',
    location: '',
    pay: '',
    employment: '',
    posted: '',
    posting: 'Join our team',
    source: 'main',
  };
  const framed: PageJob = {
    ...page,
    url: `${ICIMS}?in_iframe=1`,
    pageUrl: `${ICIMS}?in_iframe=1`,
    pageTitle: 'Staff Software Engineer in Remote | Careers at Larkspur Health',
    title: 'Staff Software Engineer',
    company: 'Larkspur Health',
    location: 'Remote, US',
    posting: 'Our Mission',
    source: 'structured',
  };

  it('takes an applicant system’s posting from the frame, at the page’s own address', () => {
    expect(withFrame(page, framed, true)).toEqual({
      ...framed,
      url: page.url,
      pageUrl: page.pageUrl,
      pageTitle: page.pageTitle,
    });
    // What the frame doesn't say, the page does.
    expect(withFrame(page, { ...framed, company: '' }, true).company).toBe('Larkspurhealth');
  });

  it('takes the posting you selected from any other frame, and what the page doesn’t say', () => {
    const selected = { ...framed, posting: 'What you selected', source: 'selection' as const };
    expect(withFrame(page, selected, false)).toEqual({
      ...page,
      location: 'Remote, US',
      posting: 'What you selected',
      source: 'selection',
    });
  });
});
