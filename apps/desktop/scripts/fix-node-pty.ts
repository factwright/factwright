// node-pty 1.1.0 publishes its Mac spawn-helper without the executable bit, so opening a terminal
// fails with "posix_spawnp failed". This restores the bit after every install.
import { chmodSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
for (const platform of ['darwin-arm64', 'darwin-x64']) {
  const helper = join(root, 'prebuilds', platform, 'spawn-helper');
  if (existsSync(helper)) chmodSync(helper, 0o755);
}
