import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTheme, saveTheme } from './appearance.ts';

describe('the theme kept on this computer', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'factwright-appearance-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('follows the system until one is chosen', async () => {
    expect(await loadTheme(dataDir)).toBe('system');
  });

  it('keeps the one chosen', async () => {
    await saveTheme(dataDir, 'tokyo-night');
    expect(await loadTheme(dataDir)).toBe('tokyo-night');
  });

  it('keeps the last of two quick choices', async () => {
    void saveTheme(dataDir, 'nord');
    await saveTheme(dataDir, 'dark');
    expect(await loadTheme(dataDir)).toBe('dark');
  });

  it.each([
    ['isn’t JSON', 'not json'],
    ['holds nothing', 'null'],
    ['names a theme Factwright doesn’t have', '{"theme":"neon"}'],
    ['names something that isn’t a theme', '{"theme":3}'],
  ])('follows the system when the file %s', async (_case, text) => {
    writeFileSync(join(dataDir, 'appearance.json'), text);
    expect(await loadTheme(dataDir)).toBe('system');
  });
});
