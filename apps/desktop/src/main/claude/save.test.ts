import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveJson, settled } from './save.ts';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factwright-save-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

describe('saveJson', () => {
  it('keeps the last of several saves asked for at once, and leaves no drafts', async () => {
    const file = join(dataDir, 'claude-models.json');
    await Promise.all(['opus', 'sonnet', 'haiku'].map((main) => saveJson(file, { main })));
    expect(read(file)).toEqual({ main: 'haiku' });
    expect(readdirSync(dataDir)).toEqual(['claude-models.json']);
  });

  it('saves the same file again after a save of it failed', async () => {
    const folder = join(dataDir, 'later');
    const file = join(folder, 'claude-models.json');
    await expect(saveJson(file, { main: 'opus' })).rejects.toThrow();
    mkdirSync(folder);
    await saveJson(file, { main: 'sonnet' });
    expect(read(file)).toEqual({ main: 'sonnet' });
  });

  it('leaves no draft behind when it can’t move one into place', async () => {
    // A folder where the file should be, so the draft can't replace it.
    const file = join(dataDir, 'claude-effort.json');
    mkdirSync(file);
    await expect(saveJson(file, { main: null, tasks: {} })).rejects.toThrow();
    expect(readdirSync(dataDir)).toEqual(['claude-effort.json']);
  });

  it('lets a read wait for the saves asked for before it', async () => {
    const file = join(dataDir, 'claude-permissions.json');
    const saving = saveJson(file, { anyFile: true, anySite: false });
    await settled(file);
    expect(read(file)).toEqual({ anyFile: true, anySite: false });
    await saving;
  });
});
