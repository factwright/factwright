import type { FactwrightApi } from '../shared/api.ts';

/**
 * The bridge to the main process. In a plain browser, during development only, sample answers
 * stand in so the screens can be checked by eye. Production builds leave the samples out.
 */
export async function loadApi(): Promise<FactwrightApi> {
  if (window.factwright) return window.factwright;
  if (import.meta.env.DEV) return (await import('./sample-api.ts')).sampleApi();
  throw new Error('Factwright’s screens only run inside the app.');
}
