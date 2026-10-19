import type { AccountKeys } from '@factwright/sync';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allowComputer,
  canReachComputer,
  canSendNow,
  destination,
  findComputer,
  giveBackComputer,
  readAnswer,
  saveOnComputer,
} from '../src/computer.ts';
import type { JobToSave } from '../src/save.ts';

/**
 * The browser as the extension sees it: whether it may use native messaging, the helper's answers
 * when it does, and the extension's storage, with no account kept, as when it's never signed in.
 */
const browser = vi.hoisted(() => {
  const state = {
    native: false,
    allow: true,
    sent: [] as { application: string; message: Record<string, unknown> }[],
    answer: (_message: Record<string, unknown>): unknown => ({ ok: true, later: true }),
    items: {} as Record<string, unknown>,
  };
  const runtime: Record<string, unknown> = {};
  const nativeMessaging = (permissions?: string[]) =>
    permissions?.length === 1 && permissions[0] === 'nativeMessaging';
  /** Native messaging is there only while the browser lets the extension use it, as in Chrome. */
  const sync = () => {
    if (state.native) {
      runtime.sendNativeMessage = async (application: string, message: Record<string, unknown>) => {
        state.sent.push({ application, message });
        return state.answer(message);
      };
    } else {
      delete runtime.sendNativeMessage;
    }
  };
  (globalThis as { chrome?: unknown }).chrome = {
    runtime,
    permissions: {
      contains: async ({ permissions }: { permissions?: string[] }) =>
        nativeMessaging(permissions) && state.native,
      request: async ({ permissions }: { permissions?: string[] }) => {
        if (!nativeMessaging(permissions)) throw new Error('not in the manifest');
        state.native = state.allow;
        sync();
        return state.allow;
      },
      remove: async ({ permissions }: { permissions?: string[] }) => {
        if (nativeMessaging(permissions)) state.native = false;
        sync();
        return true;
      },
    },
    storage: {
      local: {
        get: async (key: string) =>
          key in state.items ? { [key]: structuredClone(state.items[key]) } : {},
        set: async (more: Record<string, unknown>) => {
          Object.assign(state.items, structuredClone(more));
        },
      },
    },
  };
  return { state, sync };
});

const JOB: JobToSave = {
  url: 'https://jobs.lever.co/harborpine/4f1c2b7e',
  site: 'jobs.lever.co',
  company: 'Harbor & Pine',
  role: 'Senior Product Manager, Data',
  pay: 'USD 165,000–190,000 a year',
  posting: 'About the role',
};

beforeEach(() => {
  Object.assign(browser.state, {
    native: false,
    allow: true,
    sent: [],
    answer: () => ({ ok: true, later: true }),
    items: {},
  });
  browser.sync();
});

describe('the browser’s OK to talk to Factwright on this computer', () => {
  it('is asked for, kept and given back as native messaging, and nothing else', async () => {
    expect(await canReachComputer()).toBe(false);
    expect(await allowComputer()).toBe(true);
    expect(await canReachComputer()).toBe(true);
    await giveBackComputer();
    expect(await canReachComputer()).toBe(false);
  });

  it('can be turned down', async () => {
    browser.state.allow = false;
    expect(await allowComputer()).toBe(false);
    expect(await canReachComputer()).toBe(false);
  });

  it('is turned down, not thrown, when the browser won’t ask', async () => {
    const permissions = (globalThis as unknown as { chrome: { permissions: { request: unknown } } })
      .chrome.permissions;
    const request = permissions.request;
    permissions.request = () => {
      throw new Error('This function must be called during a user gesture');
    };
    try {
      expect(await allowComputer()).toBe(false);
    } finally {
      permissions.request = request;
    }
  });
});

describe('where the extension saves', () => {
  it('is nowhere until setup says, then this computer once it’s chosen', async () => {
    expect(await destination()).toBeNull();
    browser.state.items.settings = { where: 'sync' };
    expect(await destination()).toBeNull();
    browser.state.items.settings = { where: 'computer' };
    expect(await destination()).toEqual({ to: 'computer' });
  });

  const account = {
    server: 'https://app.factwright.com',
    user: 'u1',
    email: 'sam@example.com',
    token: 't',
    keys: null,
  };

  it('is sync once a sign-in there is linked, whatever was chosen before', async () => {
    const keys = { id: 'k1' } as unknown as AccountKeys;
    for (const where of ['computer', 'sync', null]) {
      browser.state.items.settings = { where };
      expect(await destination(async () => ({ ...account, keys }))).toEqual({
        to: 'sync',
        account: { ...account, keys },
      });
    }
  });

  it('stays this computer while a sign-in to sync isn’t linked yet', async () => {
    browser.state.items.settings = { where: 'computer' };
    expect(await destination(async () => account)).toEqual({ to: 'computer' });
    browser.state.items.settings = { where: 'sync' };
    expect(await destination(async () => account)).toBeNull();
  });
});

describe('looking for Factwright on this computer', () => {
  it('finds it by the helper’s answer, with its version', async () => {
    await allowComputer();
    browser.state.answer = () => ({ ok: true, version: '0.9.0' });
    expect(await findComputer()).toEqual({ ok: true, version: '0.9.0' });
    expect(browser.state.sent).toEqual([
      { application: 'com.factwright.save', message: { type: 'hello' } },
    ]);
  });

  it('says it’s missing when the browser can’t find or start the helper', async () => {
    await allowComputer();
    // Chrome's words, then Firefox's, as scripts/e2e-firefox.ts sees Firefox say them: for a
    // helper that isn't registered, then for one that isn't where its registration says.
    for (const said of [
      'Specified native messaging host not found.',
      'Access to the specified native messaging host is forbidden.',
      'Failed to start native messaging host.',
      'No such native application com.factwright.save',
      'An unexpected error occurred',
    ]) {
      browser.state.answer = () => {
        throw new Error(said);
      };
      expect(await findComputer()).toMatchObject({ ok: false, missing: true });
    }
  });

  it('says it didn’t answer when the helper stops short', async () => {
    await allowComputer();
    browser.state.answer = () => {
      throw new Error('Native host has exited.');
    };
    expect(await findComputer()).toMatchObject({ ok: false, missing: false });
    // Only Firefox's words for something unexpected, whole, read as Factwright missing.
    browser.state.answer = () => {
      throw new Error('Saving failed: an unexpected error occurred while writing');
    };
    expect(await findComputer()).toMatchObject({ ok: false, missing: false });
    browser.state.answer = () => ({ ok: true });
    expect(await findComputer()).toMatchObject({ ok: false, missing: false });
  });

  it('can’t look without the browser’s OK', async () => {
    expect(await findComputer()).toMatchObject({ ok: false });
    expect(browser.state.sent).toEqual([]);
  });
});

describe('saving to Factwright on this computer', () => {
  it('sends the job’s own data, field by field, and nothing else', async () => {
    await allowComputer();
    const extra = { ...JOB, cookies: 'session=1', html: '<p>page</p>' } as JobToSave;
    expect(await saveOnComputer(extra)).toEqual({ ok: true, later: true });
    expect(browser.state.sent).toEqual([
      { application: 'com.factwright.save', message: { type: 'save', ...JOB } },
    ]);
  });

  it('cuts the posting to the longest the app takes', async () => {
    await allowComputer();
    await saveOnComputer({ ...JOB, posting: 'x'.repeat(150_000) });
    expect(String(browser.state.sent[0]?.message.posting)).toHaveLength(100_000);
  });

  it('says when Factwright is open but busy, so it adds the job in a moment', async () => {
    await allowComputer();
    browser.state.answer = () => ({ ok: true, later: true, open: true });
    expect(await saveOnComputer(JOB)).toEqual({ ok: true, later: true, open: true });
    browser.state.answer = () => ({ ok: true, later: true, open: 'yes' });
    expect(await saveOnComputer(JOB)).toEqual({ ok: true, later: true });
  });

  it('passes on Factwright’s own answer when it’s open', async () => {
    await allowComputer();
    browser.state.answer = () => ({
      ok: true,
      id: 'harbor-and-pine--senior-product-manager-data',
      already: true,
      posting: 'kept',
    });
    expect(await saveOnComputer(JOB)).toEqual({
      ok: true,
      id: 'harbor-and-pine--senior-product-manager-data',
      already: true,
      posting: 'kept',
    });
  });

  it('says to open it again where the browser allowed it but this page can’t send yet', async () => {
    // As Chrome leaves a page, or the background, that used chrome.runtime before it was allowed.
    browser.state.native = true;
    expect(canSendNow()).toBe(false);
    expect(await saveOnComputer(JOB)).toEqual({
      ok: false,
      reason: 'failed',
      message: 'Close this, then click the Factwright button again to save it.',
    });
    browser.sync();
    expect(canSendNow()).toBe(true);
  });

  it('says the browser doesn’t let it, without trying, once the OK is taken away', async () => {
    expect(await saveOnComputer(JOB)).toMatchObject({ ok: false, reason: 'no-access' });
    expect(browser.state.sent).toEqual([]);
  });

  it('says Factwright isn’t there when the browser can’t find the helper', async () => {
    await allowComputer();
    for (const said of [
      'Specified native messaging host not found.',
      'An unexpected error occurred',
    ]) {
      browser.state.answer = () => {
        throw new Error(said);
      };
      expect(await saveOnComputer(JOB)).toEqual({
        ok: false,
        reason: 'no-app',
        message:
          'Save to Factwright couldn’t find Factwright on this computer. Install it from factwright.com, or update it, and open it. On a Mac, then choose Browser extension in its sidebar, and set up this browser.',
      });
    }
  });
});

describe('the helper’s answers', () => {
  it('reads each of its reasons as words', () => {
    expect(readAnswer({ ok: false, reason: 'no-factwright' })).toMatchObject({
      reason: 'no-app',
      message: 'Open Factwright on this computer once, then save it again.',
    });
    expect(readAnswer({ ok: false, reason: 'full' })).toMatchObject({ reason: 'full' });
    expect(readAnswer({ ok: false, reason: 'too-big' })).toMatchObject({
      reason: 'failed',
      message: expect.stringContaining('too long'),
    });
    for (const reason of ['failed', 'bad-message', 'toString', '__proto__', 'new-reason']) {
      expect(readAnswer({ ok: false, reason })).toMatchObject({ ok: false, reason: 'failed' });
    }
  });

  it('passes on what Factwright said when it couldn’t add a job', () => {
    expect(
      readAnswer({ ok: false, reason: 'failed', message: 'Too many jobs with that company.' }),
    ).toEqual({ ok: false, reason: 'failed', message: 'Too many jobs with that company.' });
  });

  it('takes nothing else for a job that saved', () => {
    for (const answer of [
      null,
      'ok',
      { ok: true },
      { ok: true, id: 7, already: false, posting: 'saved' },
      { ok: true, id: 'job--general', already: 'no', posting: 'saved' },
      { ok: true, id: 'job--general', already: false, posting: 'lost' },
    ]) {
      expect(readAnswer(answer)).toMatchObject({ ok: false, reason: 'failed' });
    }
  });
});
