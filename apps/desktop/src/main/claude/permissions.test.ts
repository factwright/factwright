import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASK_FIRST } from '../../shared/permissions.ts';
import { loadPermissions, savePermissions } from './permissions.ts';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factwright-permissions-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('what Claude may do without asking', () => {
  it('asks first until the user chooses otherwise', async () => {
    expect(await loadPermissions(dataDir)).toEqual(ASK_FIRST);
  });

  it('keeps what the user chose', async () => {
    await savePermissions(dataDir, { anyFile: true, anySite: false });
    expect(await loadPermissions(dataDir)).toEqual({ anyFile: true, anySite: false });
  });

  it('asks first when the file is damaged or holds anything else', async () => {
    const file = join(dataDir, 'claude-permissions.json');
    for (const text of ['not json', '{"anyFile": "yes", "anySite": true}', '[]', 'null']) {
      writeFileSync(file, text);
      expect(await loadPermissions(dataDir)).toEqual(ASK_FIRST);
    }
  });
});
