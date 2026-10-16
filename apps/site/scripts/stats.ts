// How often Factwright is downloaded, and how much sync is used: counts only, never who.
// FACTWRIGHT_STATS_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… pnpm --filter @factwright/site stats
// The token needs Account Analytics Read and nothing else. This app's README says how to make it.
import { PERMISSION, readStats } from './stats-read.ts';
import { report } from './stats-report.ts';

const token = process.env.FACTWRIGHT_STATS_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.error(
    [
      `Set FACTWRIGHT_STATS_TOKEN to a Cloudflare API token with only ${PERMISSION}, on the`,
      'account that runs factwright.com, and CLOUDFLARE_ACCOUNT_ID to that account’s ID.',
      'apps/site/README.md says how.',
    ].join('\n'),
  );
  process.exit(1);
}

const stats = await readStats({ fetch: (url, init) => fetch(url, init), token, account });
console.log(report(stats, new Date()));
