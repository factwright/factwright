import { countDownload } from './downloads.ts';
import { newestRelease } from './releases.ts';
import { respond } from './respond.ts';

interface Env {
  ASSETS: Fetcher;
  /** Each download, by computer and version only. A local preview's never reach Cloudflare. */
  DOWNLOADS?: AnalyticsEngineDataset;
}

// Workers read every export of this file as an entry point, so the logic lives in respond.ts.
export default {
  fetch: (request, env) =>
    respond(
      request,
      env.ASSETS,
      (computer) => newestRelease(computer),
      (computer, version) => countDownload(env.DOWNLOADS, computer, version),
    ),
} satisfies ExportedHandler<Env>;
