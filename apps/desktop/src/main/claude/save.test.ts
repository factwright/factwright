import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveJson } from './save.ts';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factwright-save-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('saveJson', () => {
  it('keeps the last of several saves asked for at once, and leaves no drafts', async () => {
    const file = join(dataDir, 'claude-models.json');
    await Promise.all(['opus', 'sonnet', 'haiku'].map((main) => saveJson(file, { main })));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ main: 'haiku' });
    expect(readdirSync(dataDir)).toEqual(['claude-models.json']);
  });

  it('saves again after one that failed', async () => {
    const file = join(dataDir, 'missing', 'claude-models.json');
    await expect(saveJson(file, { main: 'opus' })).rejects.toThrow();
    const other = join(dataDir, 'claude-effort.json');
    await saveJson(other, { main: null, tasks: {} });
    expect(JSON.parse(readFileSync(other, 'utf8'))).toEqual({ main: null, tasks: {} });
  });
});
