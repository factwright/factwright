import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowSync, canReachSync, letGo, readAccount } from '../src/account.ts';
import { DEFAULT_SERVER } from '../src/server.ts';

/** The browser's permissions, as the extension asks for them: what it's asked, and what it says. */
const permissions = vi.hoisted(() => {
  const calls: { call: 'contains' | 'request' | 'remove'; origins: string[] }[] = [];
  const answers = { contains: true, request: true, fails: false };
  const answer =
    (call: 'contains' | 'request' | 'remove', value: boolean) =>
    async ({ origins }: { origins: string[] }) => {
      calls.push({ call, origins });
      if (answers.fails) throw new Error('Only permissions specified in the manifest may be asked');
      return value;
    };
  (globalThis as { chrome?: unknown }).chrome = {
    permissions: {
      contains: (asked: { origins: string[] }) => answer('contains', answers.contains)(asked),
      request: (asked: { origins: string[] }) => answer('request', answers.request)(asked),
      remove: (asked: { origins: string[] }) => answer('remove', true)(asked),
    },
  };
  return { calls, answers };
});

const OWN = 'https://factwright-sync.sam.workers.dev:8443';

beforeEach(() => {
  permissions.calls.length = 0;
  Object.assign(permissions.answers, { contains: true, request: true, fails: false });
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
    expect(permissions.calls).toEqual([
      { call: 'request', origins: ['https://factwright-sync.sam.workers.dev/*'] },
    ]);
  });

  it('says when you turned it down, or the browser wouldn’t ask', async () => {
    permissions.answers.request = false;
    expect(await allowSync(OWN)).toBe(false);
    permissions.answers.fails = true;
    expect(await allowSync(OWN)).toBe(false);
  });

  it('checks the site of the server it’s signed in to', async () => {
    permissions.answers.contains = false;
    expect(await canReachSync(OWN)).toBe(false);
    expect(permissions.calls).toEqual([
      { call: 'contains', origins: ['https://factwright-sync.sam.workers.dev/*'] },
    ]);
  });

  it('gives back a server of your own once it’s done with it', async () => {
    await letGo(OWN);
    expect(permissions.calls).toEqual([
      { call: 'remove', origins: ['https://factwright-sync.sam.workers.dev/*'] },
    ]);
  });

  it('never gives back the server it was built for, which its manifest asks for', async () => {
    await letGo(DEFAULT_SERVER);
    expect(permissions.calls).toEqual([]);
  });

  it('carries on when the browser won’t give it back', async () => {
    permissions.answers.fails = true;
    await expect(letGo(OWN)).resolves.toBeUndefined();
  });
});
