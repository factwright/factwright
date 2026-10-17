import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SERVER } from '../src/server.ts';
import { changeSettings, settings } from '../src/settings.ts';

/** The extension's storage, as the browser keeps it: what's saved is a copy. */
const stored = vi.hoisted(() => {
  const items: Record<string, unknown> = {};
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => (key in items ? { [key]: structuredClone(items[key]) } : {}),
        set: async (more: Record<string, unknown>) => {
          Object.assign(items, structuredClone(more));
        },
      },
    },
  };
  return items;
});

const OWN = 'https://factwright-sync.sam.workers.dev';

beforeEach(() => {
  for (const key of Object.keys(stored)) delete stored[key];
});

describe('the sync server setting', () => {
  it('is the server the extension was built for, until you choose another', async () => {
    expect((await settings()).server).toBe(DEFAULT_SERVER);
  });

  it('keeps a server of your own you chose, beside your other settings', async () => {
    await changeSettings({ linkedInText: false });
    await changeSettings({ server: OWN });
    expect(await settings()).toEqual({ linkedInText: false, server: OWN });
    expect(stored.settings).toEqual({ linkedInText: false, server: OWN });
  });

  it('goes back to the server it was built for when what’s saved isn’t one it takes', async () => {
    for (const saved of [42, '', 'not an address', 'http://sync.example.com', `${OWN}/api`]) {
      stored.settings = { linkedInText: false, server: saved };
      expect(await settings()).toEqual({ linkedInText: false, server: DEFAULT_SERVER });
    }
  });

  it('keeps a saved server as its origin', async () => {
    stored.settings = { server: `${OWN}/` };
    expect((await settings()).server).toBe(OWN);
  });
});
