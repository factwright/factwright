// Puts together the sync server ready to deploy, as github.com/factwright/sync-server holds it for
// people who run their own: the Worker as Wrangler bundled it, the web view, the accounts
// database's migrations, and settings for a free workers.dev address. It has no route, no APP_URL
// and no terms of Neatifai's, so it goes by its own address and names no legal pages.
// `pnpm --filter @factwright/server copy` builds the web view and bundles the Worker, then runs
// this, into dist/sync-server. sync-server's own workflow runs that on each release's source and
// publishes what it makes. Here, .github/workflows/sync-server.yml checks Wrangler takes it.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { experimental_readRawConfig } from 'wrangler';

/** The Worker's name, and so its address: https://factwright-sync.<subdomain>.workers.dev. */
export const NAME = 'factwright-sync';

/** Where the published copy lives, and the button that deploys it. */
export const REPOSITORY = 'https://github.com/factwright/sync-server';
export const DEPLOY_BUTTON = `https://deploy.workers.cloudflare.com/?url=${REPOSITORY}`;

/**
 * The secrets the server needs, which the Deploy to Cloudflare button asks for. Secrets, not
 * settings in wrangler.jsonc, so an update deployed later keeps them, the list of who may sign in
 * included.
 */
export const SECRETS = {
  BETTER_AUTH_SECRET:
    'Signs sign-ins. Any long random text, such as what `openssl rand -base64 32` prints.',
  GITHUB_CLIENT_ID: 'Your GitHub OAuth app’s client ID, for signing in with GitHub.',
  GITHUB_CLIENT_SECRET: 'Your GitHub OAuth app’s client secret.',
  ALLOWED_GITHUB_USERS:
    'Your GitHub user name, such as `octocat`: only the accounts named here can sign in. To let in someone else, add their user name after a comma. Left empty, anyone with GitHub can.',
} as const;

/**
 * Factwright's settings that only its own server has: its address, its legal pages, and how it
 * sells sync.
 */
const FACTWRIGHT_ONLY = new Set(['APP_URL', 'TERMS_URL', 'PRIVACY_URL', 'STRIPE_MANAGED_PAYMENTS']);

type Settings = Record<string, unknown>;

/**
 * Factwright's own settings, made into a server of your own's. It runs at its workers.dev
 * address, with no route and no preview addresses, so it goes by the address each request came
 * to. Its database and file bucket get names of their own. The Worker is the one Wrangler
 * bundled, uploaded as it is. The daily usage totals, which only Factwright counts, are left out.
 */
export function copySettings(own: Settings): Settings {
  const {
    $schema: _schema,
    name: _name,
    main: _main,
    routes: _routes,
    analytics_engine_datasets: _totals,
    vars = {},
    assets = {},
    d1_databases = [],
    r2_buckets = [],
    ...rest
  } = own as Settings & {
    vars?: Record<string, string>;
    assets?: Settings;
    d1_databases?: { binding: string }[];
    r2_buckets?: { binding: string }[];
  };
  return {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: NAME,
    main: 'worker/index.js',
    no_bundle: true,
    workers_dev: true,
    preview_urls: false,
    ...rest,
    assets: { ...assets, directory: 'web' },
    vars: Object.fromEntries(Object.entries(vars).filter(([key]) => !FACTWRIGHT_ONLY.has(key))),
    d1_databases: d1_databases.map(({ binding }) => ({
      binding,
      database_name: NAME,
      migrations_dir: 'migrations',
    })),
    r2_buckets: r2_buckets.map(({ binding }) => ({ binding, bucket_name: `${NAME}-files` })),
  };
}

/**
 * The copy's package.json: Wrangler, to deploy it, and what the Deploy button asks for. Its
 * scripts name the accounts database by its binding in the copy's settings, not by its name: the
 * Deploy button lets you rename the database, and changes wrangler.jsonc to match, but not these.
 */
export function copyPackage(version: string, wrangler: string, settings: Settings): Settings {
  const [database] = settings.d1_databases as { binding: string }[];
  if (!database) throw new Error('The sync server’s settings have no database to set up.');
  return {
    name: NAME,
    version,
    private: true,
    description: 'Factwright’s sync server, ready to deploy to your own Cloudflare account.',
    license: 'AGPL-3.0-only',
    scripts: {
      // The accounts database's tables first, so a new version never runs without them.
      deploy: `wrangler d1 migrations apply ${database.binding} --remote && wrangler deploy`,
      dev: `wrangler d1 migrations apply ${database.binding} --local && wrangler dev`,
    },
    devDependencies: { wrangler },
    cloudflare: {
      bindings: Object.fromEntries(
        Object.entries(SECRETS).map(([key, description]) => [key, { description }]),
      ),
    },
  };
}

/** The secrets, as the Deploy button reads them: each one it should ask for, left empty. */
export function devVarsExample(): string {
  return [
    '# The secrets the server needs. The Deploy to Cloudflare button asks for each one.',
    '# To run it on your computer, copy this file to .dev.vars and fill them in.',
    ...Object.keys(SECRETS).map((key) => `${key}=`),
    '',
  ].join('\n');
}

/** The copy's README: what it is, where its source is, and how to deploy it. */
export function copyReadme(version: string, commit: string): string {
  const address = `https://${NAME}.<subdomain>.workers.dev`;
  return `# Factwright’s sync server, ready to deploy

Factwright’s sync server, built and ready to run in your own Cloudflare account, for free. Factwright, Save to Factwright and the web view on your phone can all sync through it, end-to-end encrypted: the server only ever holds locked data.

This is the server from Factwright ${version}, made from [apps/server at ${commit.slice(0, 7)}](https://github.com/factwright/factwright/tree/${commit}/apps/server) with nothing changed. Its source is there, under the AGPL.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](${DEPLOY_BUTTON})

## Before you deploy

You need a free Cloudflare account and a GitHub account.

1. **Your address.** In Cloudflare, open Workers & Pages and find your workers.dev subdomain. If it asks, pick one. Your server will be at \`${address}\`.
2. **A GitHub sign-in app.** At [github.com/settings/applications/new](https://github.com/settings/applications/new), make an OAuth app with:
   - Homepage URL: \`${address}\`
   - Authorization callback URL: \`${address}/api/auth/callback/github\`

   Then generate a client secret.
3. **Deploy.** Click Deploy to Cloudflare above, and keep the server’s name, \`${NAME}\`: your address and your GitHub app use it. It makes the database and the file storage, which can have any names. When it asks for:
${Object.entries(SECRETS)
  .map(([key, description]) => `   - \`${key}\`: ${description}`)
  .join('\n')}

It runs on Cloudflare’s free plan. Cloudflare may ask for a payment method before it turns on file storage (R2), even within the free allowance.

## Using it

Open your server’s address to sign in. To sync Factwright through it, follow [Running your own](https://github.com/factwright/factwright/blob/main/apps/server/README.md#running-your-own).

## Deploying from a terminal

\`\`\`bash
npm install
npx wrangler login
npx wrangler deploy   # the first time, to make the database and the file storage
${Object.keys(SECRETS)
  .map((key) => `npx wrangler secret put ${key}`)
  .join('\n')}
npm run deploy        # sets up the database's tables, then deploys
\`\`\`

Each Factwright release puts its server here.
`;
}

/** Makes the copy in dist/sync-server, from the bundle the copy script had Wrangler make. */
function make(): void {
  const server = new URL('../', import.meta.url);
  const out = new URL('dist/sync-server/', server);
  const version = (
    JSON.parse(readFileSync(new URL('../desktop/package.json', server), 'utf8')) as {
      version: string;
    }
  ).version;
  const wrangler = (
    JSON.parse(readFileSync(new URL('node_modules/wrangler/package.json', server), 'utf8')) as {
      version: string;
    }
  ).version;
  // The commit it's made from, even in sync-server's workflow, where this is a checkout of its own.
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: fileURLToPath(server),
    encoding: 'utf8',
  }).trim();
  const { rawConfig } = experimental_readRawConfig({
    config: fileURLToPath(new URL('wrangler.jsonc', server)),
  });

  rmSync(out, { recursive: true, force: true });
  mkdirSync(new URL('worker/', out), { recursive: true });
  cpSync(new URL('dist/bundle/index.js', server), new URL('worker/index.js', out));
  cpSync(new URL('../web/dist/', server), new URL('web/', out), { recursive: true });
  cpSync(new URL('migrations/', server), new URL('migrations/', out), { recursive: true });
  cpSync(new URL('../../LICENSE', server), new URL('LICENSE', out));
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const settings = copySettings(rawConfig as Settings);
  writeFileSync(new URL('wrangler.jsonc', out), json(settings));
  writeFileSync(new URL('package.json', out), json(copyPackage(version, wrangler, settings)));
  writeFileSync(new URL('.dev.vars.example', out), devVarsExample());
  writeFileSync(new URL('.gitignore', out), 'node_modules/\n.wrangler/\n.dev.vars\n');
  writeFileSync(new URL('README.md', out), copyReadme(version, commit));
  console.info(`Made the sync server's copy, from Factwright ${version}, in ${fileURLToPath(out)}`);
}

if (import.meta.main) make();
