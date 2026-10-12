import { respond } from './respond.ts';

interface Env {
  ASSETS: Fetcher;
}

// Workers read every export of this file as an entry point, so the logic lives in respond.ts.
export default {
  fetch: (request, env) => respond(request, env.ASSETS),
} satisfies ExportedHandler<Env>;
