import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPLICANT_SYSTEMS,
  COPY_ONLY_SITES,
  careersSite,
  isCopyOnlySite,
  jobSites,
  NOT_JOB_SITES,
  onAnySite,
  onSite,
} from '../src/applicant-systems.ts';
import {
  allowCareersSite,
  allowedSites,
  allowJobSites,
  chosen,
  isAllowedPage,
  isChosenSite,
  JOB_SITES,
  registerScripts,
  removeCareersSite,
  stopJobSites,
} from '../src/application-sites.ts';
import type { ContentScript } from '../src/ext.ts';
import { hostPattern } from '../src/manifest.ts';
import { DEFAULT_SERVER } from '../src/server.ts';

/**
 * The browser as the job application sites see it: the sites it lets the extension reach, which a
 * prompt grants as you answer it, the extension's storage, the scripts it registered, and the tabs
 * that are open, each a page on a site.
 */
const browser = vi.hoisted(() => {
  const state = {
    granted: new Set<string>(),
    /** Whether the prompt says yes. */
    allow: true,
    /** Sites the browser won't give back, as one it grants at install. */
    required: new Set<string>(),
    items: {} as Record<string, unknown>,
    scripts: [] as ContentScript[],
    tabs: [] as { id: number; url: string }[],
    calls: [] as string[],
    ran: [] as { tabId: number; files: string[] }[],
  };
  const covers = (granted: string, site: string) => granted === site || granted === 'https://*/*';
  (globalThis as { chrome?: unknown }).chrome = {
    permissions: {
      contains: async ({ origins = [] }: { origins?: string[] }) =>
        origins.every((site) => [...state.granted].some((each) => covers(each, site))),
      request: async ({ origins = [] }: { origins?: string[] }) => {
        state.calls.push(`request ${origins.join(' ')}`);
        if (state.allow) for (const site of origins) state.granted.add(site);
        return state.allow;
      },
      remove: async ({ origins = [] }: { origins?: string[] }) => {
        state.calls.push(`remove ${origins.join(' ')}`);
        if (origins.some((site) => state.required.has(site))) {
          throw new Error('You cannot remove required permissions.');
        }
        for (const site of origins) state.granted.delete(site);
        return true;
      },
      getAll: async () => ({ origins: [...state.granted] }),
    },
    storage: {
      local: {
        get: async (key: string) =>
          key in state.items ? { [key]: structuredClone(state.items[key]) } : {},
        set: async (more: Record<string, unknown>) => {
          state.calls.push(`set ${Object.keys(more).join(' ')}`);
          Object.assign(state.items, structuredClone(more));
        },
      },
    },
    scripting: {
      getRegisteredContentScripts: async ({ ids }: { ids?: string[] } = {}) =>
        structuredClone(state.scripts.filter((each) => !ids || ids.includes(each.id))),
      registerContentScripts: async (scripts: ContentScript[]) => {
        state.calls.push('register');
        for (const script of scripts) {
          if (state.scripts.some((each) => each.id === script.id)) {
            throw new Error(`Duplicate script ID '${script.id}'`);
          }
          state.scripts.push(structuredClone(script));
        }
      },
      updateContentScripts: async (scripts: ContentScript[]) => {
        state.calls.push('update');
        for (const script of scripts) {
          const at = state.scripts.findIndex((each) => each.id === script.id);
          state.scripts[at] = structuredClone(script);
        }
      },
      unregisterContentScripts: async ({ ids }: { ids?: string[] } = {}) => {
        state.calls.push('unregister');
        state.scripts = state.scripts.filter((each) => ids && !ids.includes(each.id));
      },
      executeScript: async ({ target, files }: { target: { tabId: number }; files: string[] }) => {
        state.ran.push({ tabId: target.tabId, files });
        return [];
      },
    },
    tabs: {
      // Only tabs on sites the extension may reach say where they are.
      query: async ({ url = [] }: { url?: string[] }) =>
        state.tabs.filter((tab) => url.some((pattern) => onSite(tab.url, pattern))),
    },
  };
  return state;
});

const LEVER = 'https://jobs.lever.co/*';
const CAREERS = 'https://careers.example.com/*';

beforeEach(() => {
  browser.granted.clear();
  browser.granted.add(hostPattern(DEFAULT_SERVER));
  browser.required.clear();
  browser.allow = true;
  for (const key of Object.keys(browser.items)) delete browser.items[key];
  browser.scripts = [];
  browser.tabs = [];
  browser.calls.length = 0;
  browser.ran.length = 0;
});

describe('the job application sites', () => {
  it('are the applicant systems’ application sites, each an https site by its name', () => {
    const sites = jobSites(false);
    expect(sites.length).toBeGreaterThan(15);
    expect(new Set(sites).size).toBe(sites.length);
    for (const site of sites) {
      // Never every site, any scheme, or a path: a site, as the browser's permissions name one.
      expect(site).toMatch(/^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\*$/);
    }
    expect(sites).not.toContain('<all_urls>');
    expect(sites).not.toContain('https://*/*');
    for (const name of ['Greenhouse', 'Lever', 'Ashby', 'Workday', 'iCIMS', 'SmartRecruiters']) {
      expect(APPLICANT_SYSTEMS.map((system) => system.name)).toContain(name);
    }
  });

  it('cover each system’s application forms, and never its own home page', () => {
    for (const page of [
      'https://boards.greenhouse.io/acme/jobs/4567890',
      'https://job-boards.greenhouse.io/acme/jobs/4567890',
      'https://jobs.lever.co/acme/7a1c9e40-2b6d-4f1e-9c3a-5d8e0f2b4a71/apply',
      'https://jobs.ashbyhq.com/acme/1b2c3d4e/application',
      'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Denver/Engineer_R123/apply',
      'https://careers-acme.icims.com/jobs/1234/engineer/job',
      'https://jobs.smartrecruiters.com/Acme/123456-engineer',
      'https://apply.workable.com/acme/j/ABC123/apply/',
    ]) {
      expect(onAnySite(page, jobSites(false))).toBe(true);
    }
    for (const page of [
      'https://www.greenhouse.io/demo',
      'https://www.lever.co/',
      'https://www.ashbyhq.com/',
      'https://www.icims.com/request-demo',
      'https://icims.com/',
      'https://www.workday.com/',
      'https://example.com/careers',
    ]) {
      expect(onAnySite(page, jobSites(false))).toBe(false);
    }
  });

  it('are never LinkedIn or Indeed, where it only gives answers to copy', () => {
    for (const page of [
      'https://www.linkedin.com/jobs/view/4012345678/',
      'https://linkedin.com/jobs/',
      'https://www.indeed.com/viewjob?jk=a1b2c3d4e5',
      'https://smartapply.indeed.com/beta/indeedapply/form/questions/1',
    ]) {
      expect(isCopyOnlySite(page)).toBe(true);
      expect(onAnySite(page, [...jobSites(false), 'https://*/*'])).toBe(false);
    }
    expect(NOT_JOB_SITES).toEqual(expect.arrayContaining(COPY_ONLY_SITES));
  });

  it('take this computer’s site only in a build for testing', () => {
    expect(jobSites(false).some((site) => site.startsWith('http:'))).toBe(false);
    expect(jobSites(true)).toEqual([...jobSites(false), 'http://127.0.0.1/*']);
    expect(JOB_SITES).toEqual(jobSites(false));
  });
});

describe('a site, as the browser matches one', () => {
  it('takes the host, or one under it for "*.", on any port, with the same scheme', () => {
    expect(onSite('https://acme.wd5.myworkdayjobs.com/x', 'https://*.myworkdayjobs.com/*')).toBe(
      true,
    );
    expect(onSite('https://myworkdayjobs.com/', 'https://*.myworkdayjobs.com/*')).toBe(true);
    expect(onSite('https://notmyworkdayjobs.com/', 'https://*.myworkdayjobs.com/*')).toBe(false);
    expect(onSite('https://jobs.lever.co:8443/acme', LEVER)).toBe(true);
    expect(onSite('http://jobs.lever.co/acme', LEVER)).toBe(false);
    expect(onSite('https://jobs.lever.co.evil.com/acme', LEVER)).toBe(false);
    expect(onSite('http://indeed.com/', '*://indeed.com/*')).toBe(true);
    expect(onSite('ftp://indeed.com/', '*://indeed.com/*')).toBe(false);
  });

  it('takes a path, with * for anything', () => {
    expect(
      onSite('https://acme.example.com/careers/123?x=1', 'https://*.example.com/careers*'),
    ).toBe(true);
    expect(onSite('https://acme.example.com/admin', 'https://*.example.com/careers*')).toBe(false);
  });

  it('takes nothing that isn’t an address or a pattern', () => {
    expect(onSite('not a page', LEVER)).toBe(false);
    expect(onSite('https://jobs.lever.co/', 'jobs.lever.co')).toBe(false);
  });
});

describe('a careers site, added with one click', () => {
  it('is the page’s site alone, its https address without its port or path', () => {
    expect(careersSite('https://Careers.Example.com:8443/jobs/123?utm=x#apply', false)).toBe(
      CAREERS,
    );
  });

  it('is never LinkedIn, Indeed, an http site, an IP address, or not a page at all', () => {
    for (const page of [
      'https://www.linkedin.com/jobs/view/1',
      'https://www.indeed.com/viewjob?jk=1',
      'http://careers.example.com/jobs',
      'https://203.0.113.7/jobs',
      'https://localhost/jobs',
      'chrome://extensions',
      'not a page',
    ]) {
      expect(careersSite(page, false)).toBeNull();
    }
  });

  it('may be this computer’s site over http only in a build for testing', () => {
    expect(careersSite('http://localhost:8080/apply', true)).toBe('http://localhost/*');
    expect(careersSite('http://127.0.0.1:8080/apply', true)).toBe('http://127.0.0.1/*');
    expect(careersSite('http://localhost:8080/apply', false)).toBeNull();
    expect(careersSite('http://example.com/apply', true)).toBeNull();
  });
});

describe('turning the job application sites on and off', () => {
  it('asks the browser for them alone, on the click itself, and keeps your choice once it allows them', async () => {
    const asked = allowJobSites();
    // Before anything is waited on, as Firefox wants.
    expect(browser.calls).toEqual([`request ${JOB_SITES.join(' ')}`]);
    expect(await asked).toBe(true);
    expect(await chosen()).toEqual({ all: true, sites: [] });
    expect(await allowedSites()).toEqual(JOB_SITES);
    expect(await isAllowedPage('https://jobs.lever.co/acme/123/apply')).toBe(true);
  });

  it('keeps nothing when you turn the browser down', async () => {
    browser.allow = false;
    expect(await allowJobSites()).toBe(false);
    expect(await chosen()).toEqual({ all: false, sites: [] });
    expect(await allowedSites()).toEqual([]);
  });

  it('counts only sites you chose, never one the browser lets it reach for another reason', async () => {
    // Every https site, allowed in the browser's own settings, and a sync server of your own.
    browser.granted.add('https://*/*');
    browser.granted.add('https://sync.example.com/*');
    expect(await allowedSites()).toEqual([]);
    expect(await isAllowedPage('https://jobs.lever.co/acme/123/apply')).toBe(false);
  });

  it('counts a site you chose only while the browser lets it reach it', async () => {
    await allowJobSites();
    browser.granted.delete(LEVER);
    expect(await allowedSites()).not.toContain(LEVER);
    expect(await isAllowedPage('https://jobs.lever.co/acme/123/apply')).toBe(false);
    expect(await isAllowedPage('https://jobs.ashbyhq.com/acme/1/application')).toBe(true);
  });

  it('turned off, gives back each site, but a careers site you added and the sync server', async () => {
    await allowJobSites();
    expect(await allowCareersSite('https://jobs.lever.co/acme/123')).toBe(true);
    browser.calls.length = 0;
    await stopJobSites();
    expect(await chosen()).toEqual({ all: false, sites: [LEVER] });
    const removed = browser.calls.filter((call) => call.startsWith('remove'));
    expect(removed).toEqual(
      JOB_SITES.filter((site) => site !== LEVER).map((site) => `remove ${site}`),
    );
    expect(browser.granted.has(hostPattern(DEFAULT_SERVER))).toBe(true);
    expect(await allowedSites()).toEqual([LEVER]);
  });

  it('turned off, carries on past a site the browser won’t give back', async () => {
    await allowJobSites();
    browser.required.add(LEVER);
    await expect(stopJobSites()).resolves.toBeUndefined();
    expect(await chosen()).toEqual({ all: false, sites: [] });
    // The browser still lets it reach the site, but it's not one you chose now.
    expect(browser.granted.has(LEVER)).toBe(true);
    expect(await allowedSites()).toEqual([]);
  });
});

describe('careers sites you add', () => {
  it('asks the browser for the page’s site alone, and keeps it once it allows it', async () => {
    expect(await allowCareersSite('https://careers.example.com/jobs/123')).toBe(true);
    expect(browser.calls[0]).toBe(`request ${CAREERS}`);
    expect(await chosen()).toEqual({ all: false, sites: [CAREERS] });
    expect(await isAllowedPage('https://careers.example.com/jobs/456/apply')).toBe(true);
    expect(await isAllowedPage('https://example.com/careers')).toBe(false);
    expect(await isChosenSite(CAREERS)).toBe(true);
  });

  it('never asks for LinkedIn or Indeed', async () => {
    expect(await allowCareersSite('https://www.linkedin.com/jobs/view/1')).toBe(false);
    expect(browser.calls).toEqual([]);
  });

  it('removed, is given back', async () => {
    await allowCareersSite('https://careers.example.com/jobs/123');
    await removeCareersSite(CAREERS);
    expect(await chosen()).toEqual({ all: false, sites: [] });
    expect(browser.granted.has(CAREERS)).toBe(false);
  });

  it('keeps only careers sites as you chose them, from what the extension saved', async () => {
    browser.items.jobSites = {
      all: 'yes',
      sites: [CAREERS, 'https://*/*', '<all_urls>', 'https://www.linkedin.com/*', 42, CAREERS],
    };
    expect(await chosen()).toEqual({ all: false, sites: [CAREERS] });
  });
});

describe('the script on the sites you allowed', () => {
  it('is registered for those sites alone, in their pages’ top frame, never LinkedIn or Indeed', async () => {
    await allowJobSites();
    expect(await registerScripts()).toEqual(JOB_SITES);
    expect(browser.scripts).toEqual([
      {
        id: 'job-sites',
        matches: JOB_SITES,
        excludeMatches: NOT_JOB_SITES,
        js: ['content.js'],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
  });

  it('is registered for nothing before you allow a site', async () => {
    expect(await registerScripts()).toEqual([]);
    expect(browser.scripts).toEqual([]);
    expect(browser.calls).not.toContain('register');
  });

  it('runs at once on pages open on a site you just allowed, and nowhere else', async () => {
    browser.tabs = [
      { id: 1, url: 'https://jobs.lever.co/acme/123/apply' },
      { id: 2, url: 'https://www.icims.com/' },
      { id: 3, url: 'https://example.com/' },
    ];
    await allowJobSites();
    await registerScripts();
    expect(browser.ran).toEqual([{ tabId: 1, files: ['content.js'] }]);
    // Once registered, a page that loads gets it from the browser.
    browser.ran.length = 0;
    await registerScripts();
    expect(browser.ran).toEqual([]);
  });

  it('follows the sites as they change, and is unregistered once there are none', async () => {
    await allowJobSites();
    await registerScripts();
    await allowCareersSite('https://careers.example.com/jobs');
    await registerScripts();
    expect(browser.scripts[0]?.matches).toEqual([...JOB_SITES, CAREERS]);
    expect(browser.calls.filter((call) => call === 'update')).toHaveLength(1);
    await stopJobSites();
    await registerScripts();
    expect(browser.scripts[0]?.matches).toEqual([CAREERS]);
    // The browser takes the last one away, as from its own settings.
    browser.granted.delete(CAREERS);
    expect(await registerScripts()).toEqual([]);
    expect(browser.scripts).toEqual([]);
  });

  it('registers once, however many changes come at once', async () => {
    await allowJobSites();
    await Promise.all([registerScripts(), registerScripts(), registerScripts()]);
    expect(browser.calls.filter((call) => call === 'register')).toHaveLength(1);
    expect(browser.scripts).toHaveLength(1);
  });
});
