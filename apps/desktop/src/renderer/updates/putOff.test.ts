import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '../../shared/updates.ts';
import { inBanner, isPutOff } from './putOff.ts';

const READY: UpdateStatus = { state: 'ready', version: '0.2.0', notes: null };

describe('inBanner', () => {
  it('shows an update that’s ready, and nothing else', () => {
    expect(inBanner(READY, null, '2026-10-26')).toBe(true);
    expect(inBanner({ state: 'none' }, null, '2026-10-26')).toBe(false);
    expect(
      inBanner({ state: 'downloading', version: '0.2.0', percent: 10 }, null, '2026-10-26'),
    ).toBe(false);
  });

  it('puts the update off for the rest of the day, until a newer one is ready', () => {
    const putOff = { version: '0.2.0', day: '2026-10-26' };
    expect(inBanner(READY, putOff, '2026-10-26')).toBe(false);
    expect(inBanner(READY, putOff, '2026-10-27')).toBe(true);
    expect(inBanner({ ...READY, version: '0.2.1' }, putOff, '2026-10-26')).toBe(true);
  });
});

describe('isPutOff', () => {
  it('reads what was kept, or nothing', () => {
    expect(isPutOff(null)).toBe(true);
    expect(isPutOff({ version: '0.2.0', day: '2026-10-26' })).toBe(true);
    expect(isPutOff({ version: '0.2.0' })).toBe(false);
    expect(isPutOff('0.2.0')).toBe(false);
  });
});
