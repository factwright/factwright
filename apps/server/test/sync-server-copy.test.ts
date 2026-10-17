import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { experimental_readRawConfig } from 'wrangler';
import {
  copyPackage,
  copyReadme,
  copySettings,
  DEPLOY_BUTTON,
  devVarsExample,
  NAME,
  SECRETS,
} from '../scripts/sync-server-copy.ts';

/** Factwright's own settings, as wrangler.jsonc has them. */
const own = experimental_readRawConfig({
  config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
}).rawConfig as Record<string, unknown>;
const copy = copySettings(own);

describe('the sync server, ready to deploy', () => {
  it('runs at its own workers.dev address, with nothing of Factwright’s own server', () => {
    expect(copy).toMatchObject({ name: NAME, workers_dev: true, preview_urls: false });
    expect(copy).not.toHaveProperty('routes');
    expect(copy.vars).toEqual({ STORAGE_LIMIT_MB: '1024' });
    expect(JSON.stringify(copy)).not.toContain('factwright.com');
  });

  it('leaves out the usage totals, which only Factwright counts', () => {
    expect(copy).not.toHaveProperty('analytics_engine_datasets');
  });

  it('uploads the Worker Wrangler bundled, and serves the web view beside it', () => {
    expect(copy).toMatchObject({ main: 'worker/index.js', no_bundle: true });
    expect(copy.assets).toEqual({ ...(own.assets as object), directory: 'web' });
  });

  it('has a database and a file bucket of its own, with the same stores and daily job', () => {
    expect(copy.d1_databases).toEqual([
      { binding: 'DB', database_name: NAME, migrations_dir: 'migrations' },
    ]);
    expect(copy.r2_buckets).toEqual([{ binding: 'FILES', bucket_name: `${NAME}-files` }]);
    for (const same of [
      'compatibility_date',
      'compatibility_flags',
      'durable_objects',
      'migrations',
      'triggers',
      'observability',
    ]) {
      expect(copy[same]).toEqual(own[same]);
    }
  });

  it('sets up the database’s tables before each deploy, by its binding', () => {
    // The Deploy button lets you rename the database, and changes wrangler.jsonc to match but
    // not package.json, so its scripts name the database by its binding, never by its name.
    const { scripts, devDependencies } = copyPackage('0.9.0', '4.145.0', copy) as {
      scripts: { deploy: string; dev: string };
      devDependencies: { wrangler: string };
    };
    expect(scripts).toEqual({
      deploy: 'wrangler d1 migrations apply DB --remote && wrangler deploy',
      dev: 'wrangler d1 migrations apply DB --local && wrangler dev',
    });
    expect(devDependencies.wrangler).toBe('4.145.0');
  });

  it('has the Deploy button ask for each secret the server needs', () => {
    expect(devVarsExample().match(/^[A-Z_]+=$/gm)).toEqual([
      'BETTER_AUTH_SECRET=',
      'GITHUB_CLIENT_ID=',
      'GITHUB_CLIENT_SECRET=',
      'ALLOWED_GITHUB_USERS=',
    ]);
  });

  it('asks whose GitHub accounts may sign in, so a new server is its owner’s alone', () => {
    expect(SECRETS.ALLOWED_GITHUB_USERS).toContain('Your GitHub user name');
    const readme = copyReadme('0.9.0', 'a'.repeat(40));
    expect(readme).toContain(`\`ALLOWED_GITHUB_USERS\`: ${SECRETS.ALLOWED_GITHUB_USERS}`);
    for (const key of Object.keys(SECRETS)) {
      expect(readme).toContain(`npx wrangler secret put ${key}\n`);
    }
  });

  it('says which version it is, where its source is, and how to deploy it', () => {
    const commit = 'a'.repeat(40);
    const readme = copyReadme('0.9.0', commit);
    expect(readme).toContain('Factwright 0.9.0');
    expect(readme).toContain(`https://github.com/factwright/factwright/tree/${commit}/apps/server`);
    expect(readme).toContain(DEPLOY_BUTTON);
    expect(readme).toContain(`https://${NAME}.<subdomain>.workers.dev/api/auth/callback/github`);
  });
});
