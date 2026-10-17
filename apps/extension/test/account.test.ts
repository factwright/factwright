import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowSync, canReachSync, reachOnly, readAccount } from '../src/account.ts';
import { hostPattern } from '../src/manifest.ts';
import { DEFAULT_SERVER } from '../src/server.ts';

/**
 * The browser's permissions, as the extension asks for them: the sites it may reach, what it's
 * asked, and how it answers.
 */
const browser = vi.hoisted(() => {
  const granted = new Set<string>();
  const calls: { call: string; origins: string[] }[] = [];
  const answers = { allow: true, fails: false, wontGiveBack: new Set<string>() };
  const fail = () => {
    throw new Error('Only permissions specified in the manifest may be requested.');
  };
  (globalThis as { chrome?: unknown }).chrome = {
    permissions: {
      contains: async ({ origins }: { origins: string[] }) => {
        calls.push({ call: 'contains', origins });
        if (answers.fails) fail();
        return origins.every((origin) => granted.has(origin));
      },
      request: async ({ origins }: { origins: string[] }) => {
        calls.push({ call: 'request', origins });
        if (answers.fails) fail();
        if (answers.allow) for (const origin of origins) granted.add(origin);
        return answers.allow;
      },
      remove: async ({ origins }: { origins: string[] }) => {
        calls.push({ call: 'remove', origins });
        if (answers.fails || origins.some((origin) => answers.wontGiveBack.has(origin))) fail();
        for (const origin of origins) granted.delete(origin);
        return true;
      },
      getAll: async () => {
        if (answers.fails) fail();
        return { origins: [...granted], permissions: ['activeTab', 'storage'] };
      },
    },
  };
  return { granted, calls, answers };
});

const OWN = 'https://factwright-sync.sam.workers.dev:8443';
const OWN_SITE = 'https://factwright-sync.sam.workers.dev/*';
const BUILT_FOR = hostPattern(DEFAULT_SERVER);

beforeEach(() => {
  browser.granted.clear();
  browser.granted.add(BUILT_FOR);
  browser.calls.length = 0;
  Object.assign(browser.answers, { allow: true, fails: false, wontGiveBack: new Set() });
});

describe('the account it keeps', () => {
  const saved = { user: 'u1', email: 'sam@example.com', token: 't', keys: null };

  it('keeps the server its sign-in is for', () => {
    expect(readAccount({ ...saved, server: OWN })).toEqual({ ...saved, server: OWN });
  });

  it('takes one saved before you could choose a server as the one it was built for', () => {
    expect(readAccount(saved)).toEqual({ ...saved, server: DEFAULT_SERVER });
  });

  it('has none until it’s signed in', () => {
    expect(readAccount(undefined)).toBeNull();
    expect(readAccount(null)).toBeNull();
  });
});

describe('the browser’s permission to reach a sync server', () => {
  it('asks for a server of your own’s site alone, on any of its ports', async () => {
    expect(await allowSync(OWN)).toBe(true);
    expect(browser.calls).toEqual([{ call: 'request', origins: [OWN_SITE] }]);
  });

  it('says when you turned it down, or the browser wouldn’t ask', async () => {
    browser.answers.allow = false;
    expect(await allowSync(OWN)).toBe(false);
    browser.answers.fails = true;
    expect(await allowSync(OWN)).toBe(false);
  });

  it('checks the site of the server it’s signed in to', async () => {
    expect(await canReachSync(OWN)).toBe(false);
    browser.granted.add(OWN_SITE);
    expect(await canReachSync(OWN)).toBe(true);
    expect(browser.calls.map((each) => each.origins)).toEqual([[OWN_SITE], [OWN_SITE]]);
  });
});

describe('reaching only the server it’s signed in to', () => {
  const STRAYS = ['https://sync.exmaple.com/*', 'https://old-sync.example.org/*'];

  it('gives back every other server of your own, and keeps its own and the one it’s built for', async () => {
    for (const site of [OWN_SITE, ...STRAYS]) browser.granted.add(site);
    await reachOnly(OWN);
    expect([...browser.granted].sort()).toEqual([BUILT_FOR, OWN_SITE].sort());
    expect(browser.calls.filter((each) => each.call === 'remove')).toEqual(
      STRAYS.map((site) => ({ call: 'remove', origins: [site] })),
    );
  });

  it('signed out, keeps only the one it’s built for, which its manifest asks for', async () => {
    for (const site of [OWN_SITE, ...STRAYS]) browser.granted.add(site);
    await reachOnly(null);
    expect([...browser.granted]).toEqual([BUILT_FOR]);
    expect(browser.calls.some((each) => each.origins.includes(BUILT_FOR))).toBe(false);
  });

  it('keeps a server of your own on the same site as the one it’s built for', async () => {
    await reachOnly(`${DEFAULT_SERVER.replace(/:\d+$/, '')}:8443`);
    await reachOnly(null);
    expect([...browser.granted]).toEqual([BUILT_FOR]);
    expect(browser.calls).toEqual([]);
  });

  it('gives back the rest when the browser won’t give one back', async () => {
    for (const site of STRAYS) browser.granted.add(site);
    browser.answers.wontGiveBack.add(STRAYS[0] as string);
    await expect(reachOnly(null)).resolves.toBeUndefined();
    expect([...browser.granted].sort()).toEqual([BUILT_FOR, STRAYS[0]].sort());
  });

  it('carries on when the browser can’t say what it has', async () => {
    browser.answers.fails = true;
    await expect(reachOnly(null)).resolves.toBeUndefined();
  });
});
