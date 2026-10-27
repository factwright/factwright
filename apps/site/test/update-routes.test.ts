import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The routes of the Worker that counts updates on downloads.factwright.com (wrangler.updates.jsonc).
describe('the Worker’s routes', () => {
  const config = readFileSync(new URL('../wrangler.updates.jsonc', import.meta.url), 'utf8');
  const routes = [...config.matchAll(/"pattern": "([^"]+)"/g)].map(([, pattern]) => pattern ?? '');
  /** Whether a route takes a request for this address, as Cloudflare matches one. */
  const routed = (address: string) =>
    routes.some((route) =>
      route.endsWith('*') ? address.startsWith(route.slice(0, -1)) : address === route,
    );
  const { version } = JSON.parse(
    readFileSync(new URL('../../desktop/package.json', import.meta.url), 'utf8'),
  ) as { version: string };

  it('take the feeds and the app’s own version’s update files', () => {
    for (const path of [
      'latest.yml',
      'latest-mac.yml',
      `Factwright-${version}-mac.zip`,
      `Factwright-${version}-mac.zip.blockmap`,
      `Factwright-Setup-${version}.exe`,
      `Factwright-Setup-${version}.exe.blockmap`,
    ]) {
      expect(routed(`downloads.factwright.com/${path}`), path).toBe(true);
    }
  });

  it('leave the installers under fixed names to their Cache Rule', () => {
    expect(routed('downloads.factwright.com/Factwright.dmg')).toBe(false);
    expect(routed('downloads.factwright.com/Factwright-Setup.exe')).toBe(false);
  });

  it('count in the dataset the stats command reads', () => {
    expect(config).toContain('{ "binding": "UPDATES", "dataset": "factwright_updates" }');
  });
});
