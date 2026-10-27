import { countUpdate } from './updates.ts';

interface Env {
  /** Installed copies' looks for an update and the updates they pick up, by computer and version. */
  UPDATES?: AnalyticsEngineDataset;
}

// The Worker in front of the update feeds and update files on downloads.factwright.com
// (wrangler.updates.jsonc). Every request goes on as it came, and its answer comes back as it is:
// ranges, ETags and caching alike. Counting happens once the answer has gone, and anything that
// goes wrong in here sends the request on as if there were no Worker.
// Workers read every export of this file as an entry point, so the logic lives in updates.ts.
export default {
  async fetch(request, env, context) {
    context.passThroughOnException();
    const answered = await fetch(request);
    context.waitUntil(countUpdate(request, answered, { dataset: env.UPDATES }));
    return answered;
  },
} satisfies ExportedHandler<Env>;
