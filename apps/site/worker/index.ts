import { signedIn } from './access.ts';
import { answerBoard, type Limiter } from './board.ts';
import { countDownload } from './downloads.ts';
import type { Db } from './ideas.ts';
import { newestRelease } from './releases.ts';
import { respond } from './respond.ts';

interface Env {
  ASSETS: Fetcher;
  /** Each download, by computer and version only. A local preview's never reach Cloudflare. */
  DOWNLOADS?: AnalyticsEngineDataset;
  /** The ideas board's suggestions and votes (migrations/0001_ideas.sql). */
  IDEAS?: Db;
  /** How often one address can suggest, and vote. */
  SUGGEST_LIMIT?: Limiter;
  VOTE_LIMIT?: Limiter;
  /** The Cloudflare Access application in front of the admin page (access.ts). */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** For `pnpm serve` only, in .dev.vars: the admin page's address on localhost (access.ts). */
  LOCAL_ADMIN?: string;
}

// Workers read every export of this file as an entry point, so the logic lives in respond.ts.
export default {
  fetch: (request, env) =>
    respond(
      request,
      env.ASSETS,
      (computer) => newestRelease(computer),
      (computer, version) => countDownload(env.DOWNLOADS, computer, version),
      (asked, assets) =>
        answerBoard(asked, assets, {
          db: env.IDEAS,
          limits: { suggest: env.SUGGEST_LIMIT, vote: env.VOTE_LIMIT },
          admin: (signing) =>
            signedIn(signing, {
              teamDomain: env.ACCESS_TEAM_DOMAIN,
              aud: env.ACCESS_AUD,
              localAdmin: env.LOCAL_ADMIN,
            }),
        }),
    ),
} satisfies ExportedHandler<Env>;
