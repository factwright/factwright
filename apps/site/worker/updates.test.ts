import { describe, expect, it } from 'vitest';
import type { Computer, Release } from './releases.ts';
import {
  countUpdate,
  INSTALLED_COPY,
  isPickup,
  type UpdateRequest,
  updateRequest,
} from './updates.ts';

/** Stands in for the Analytics Engine dataset, keeping what's written. */
function dataset() {
  const written: AnalyticsEngineDataPoint[] = [];
  return {
    written,
    writeDataPoint: (point?: AnalyticsEngineDataPoint) => written.push(point ?? {}),
  };
}

/** A request to downloads.factwright.com, as an installed copy's updater sends it unless told. */
function asked(path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Request(`https://downloads.factwright.com${path}`, {
    method,
    headers: { 'x-user-staging-id': INSTALLED_COPY, 'User-Agent': 'electron-builder', ...headers },
  });
}

const release = (version: string): Release => ({ version, date: null, size: null });

/** The newest release is 0.18.1 on both computers. */
const newest = async (_computer: Computer) => release('0.18.1');

const ok = () => new Response('', { status: 200 });

describe('an installed copy’s request', () => {
  it('is a look at its computer’s update feed', () => {
    // electron-updater adds a query of its own to each look, so nothing answers from a cache.
    expect(updateRequest(asked('/latest-mac.yml?noCache=1h2j3k'))).toEqual({
      kind: 'look',
      computer: 'mac',
    });
    expect(updateRequest(asked('/latest.yml'))).toEqual({ kind: 'look', computer: 'windows' });
  });

  it('is an update’s block map, or its whole file', () => {
    expect(updateRequest(asked('/Factwright-0.18.1-mac.zip.blockmap'))).toEqual({
      kind: 'blockmap',
      computer: 'mac',
      version: '0.18.1',
    });
    expect(updateRequest(asked('/Factwright-Setup-0.18.1.exe.blockmap'))).toEqual({
      kind: 'blockmap',
      computer: 'windows',
      version: '0.18.1',
    });
    expect(updateRequest(asked('/Factwright-0.19.0-beta.1-mac.zip'))).toEqual({
      kind: 'file',
      computer: 'mac',
      version: '0.19.0-beta.1',
    });
  });

  it('isn’t counted a range at a time', () => {
    expect(updateRequest(asked('/Factwright-0.18.1-mac.zip', { Range: 'bytes=0-99' }))).toBeNull();
    expect(updateRequest(asked('/Factwright-Setup-0.18.1.exe', { Range: 'bytes=0-99' }))).toBe(
      null,
    );
  });

  it('is nothing else', () => {
    // A browser downloading an installer, or anything else that reads the files.
    const browser = new Request('https://downloads.factwright.com/Factwright-0.18.1-mac.zip');
    expect(updateRequest(browser)).toBeNull();
    expect(updateRequest(asked('/latest.yml', { 'x-user-staging-id': 'f00d' }))).toBeNull();
    expect(updateRequest(asked('/latest.yml', {}, 'HEAD'))).toBeNull();
    for (const path of [
      '/Factwright-0.18.1.dmg',
      '/Factwright-0.18.1.dmg.blockmap',
      '/Factwright.dmg',
      '/Factwright-Setup.exe',
      '/latest-linux.yml',
      '/feeds/0.18.1/latest.yml',
    ]) {
      expect(updateRequest(asked(path))).toBeNull();
    }
  });
});

describe('picking up an update', () => {
  const file = (kind: 'blockmap' | 'file', computer: Computer, version = '0.18.1') =>
    ({ kind, computer, version }) satisfies UpdateRequest;

  it('is the newest version’s block map, on either computer', () => {
    expect(isPickup(file('blockmap', 'mac'), release('0.18.1'))).toBe(true);
    expect(isPickup(file('blockmap', 'windows'), release('0.18.1'))).toBe(true);
  });

  it('is the Mac’s whole zip, which it downloads without the last update to build on', () => {
    expect(isPickup(file('file', 'mac'), release('0.18.1'))).toBe(true);
  });

  it('isn’t Windows’s whole installer, which follows its block map only when building on fails', () => {
    expect(isPickup(file('file', 'windows'), release('0.18.1'))).toBe(false);
  });

  it('isn’t an older version, whose block map a copy builds on, nor a look', () => {
    expect(isPickup(file('blockmap', 'mac', '0.18.0'), release('0.18.1'))).toBe(false);
    expect(isPickup(file('blockmap', 'mac'), null)).toBe(false);
    expect(isPickup({ kind: 'look', computer: 'mac' }, release('0.18.1'))).toBe(false);
  });
});

describe('counting', () => {
  it('keeps each look’s computer, and nothing about the copy', async () => {
    const updates = dataset();
    await countUpdate(asked('/latest-mac.yml?noCache=abc'), ok(), { dataset: updates, newest });
    await countUpdate(asked('/latest.yml?noCache=abc'), ok(), { dataset: updates, newest });
    expect(updates.written).toEqual([
      { indexes: ['look'], blobs: ['look', 'mac'], doubles: [1] },
      { indexes: ['look'], blobs: ['look', 'windows'], doubles: [1] },
    ]);
  });

  it('keeps each update picked up, by computer and version', async () => {
    const updates = dataset();
    await countUpdate(asked('/Factwright-Setup-0.18.1.exe.blockmap'), ok(), {
      dataset: updates,
      newest,
    });
    // The block map of the version it builds on, and the parts that changed, a range at a time.
    await countUpdate(asked('/Factwright-Setup-0.18.0.exe.blockmap'), ok(), {
      dataset: updates,
      newest,
    });
    await countUpdate(
      asked('/Factwright-Setup-0.18.1.exe', { Range: 'bytes=0-99' }),
      new Response('', { status: 206 }),
      { dataset: updates, newest },
    );
    expect(updates.written).toEqual([
      { indexes: ['pickup'], blobs: ['pickup', 'windows', '0.18.1'], doubles: [1] },
    ]);
  });

  it('counts nothing that wasn’t answered, or without a dataset', async () => {
    const updates = dataset();
    await countUpdate(asked('/latest.yml'), new Response('', { status: 404 }), {
      dataset: updates,
      newest,
    });
    expect(updates.written).toEqual([]);
    await expect(countUpdate(asked('/latest.yml'), ok(), { dataset: undefined })).resolves.toBe(
      undefined,
    );
  });

  it('never throws, whatever goes wrong', async () => {
    const broken = {
      writeDataPoint: () => {
        throw new Error('Analytics Engine is down');
      },
    };
    await expect(
      countUpdate(asked('/latest.yml'), ok(), { dataset: broken, newest }),
    ).resolves.toBeUndefined();
    await expect(
      countUpdate(asked('/Factwright-0.18.1-mac.zip.blockmap'), ok(), {
        dataset: dataset(),
        newest: async () => {
          throw new Error('The feed can’t be read');
        },
      }),
    ).resolves.toBeUndefined();
  });
});
