import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_FOCUS, readFocus } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasFocus, parseFocus, saveFocus } from './focus.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-focus-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const FOCUS = {
  ...NO_FOCUS,
  stages: ['early' as const],
  payMin: 150_000,
  notes: 'Founding roles.',
};

describe('a search’s focus', () => {
  it('is kept in the workspace by a new ID each time, for the search to read', () => {
    const first = saveFocus(root, FOCUS, '2026-10-20');
    const second = saveFocus(root, FOCUS, '2026-10-20');
    expect(first).toMatch(/^2026-10-20-[0-9a-f]{4}$/);
    expect(second).not.toBe(first);
    const folder = join(root, 'searches', 'focus');
    expect(readdirSync(folder).sort()).toEqual([`${first}.json`, `${second}.json`].sort());
    expect(readFocus(JSON.parse(readFileSync(join(folder, `${first}.json`), 'utf8')))).toEqual(
      FOCUS,
    );
    expect(hasFocus(root, first)).toBe(true);
    expect(hasFocus(root, '2026-10-20-ffff0000')).toBe(false);
    expect(hasFocus(root, '../criteria')).toBe(false);
  });

  it('takes from the window only a focus that reads, with nothing it doesn’t know', () => {
    expect(parseFocus(FOCUS)).toEqual(FOCUS);
    expect(parseFocus({ ...FOCUS, also: 'delete everything' })).toBeNull();
    expect(parseFocus({ ...FOCUS, stages: ['seed'] })).toBeNull();
    expect(parseFocus('early startups')).toBeNull();
  });
});
