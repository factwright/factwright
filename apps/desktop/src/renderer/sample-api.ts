import type { ClaudeStatus, FactwrightApi } from '../shared/api.ts';

const READY: ClaudeStatus = { state: 'ready', version: '2.1.296', plan: 'max' };

const SAMPLES: Readonly<Record<string, ClaudeStatus>> = {
  ready: READY,
  'signed-out': { state: 'signed-out', version: '2.1.296' },
  'too-old': { state: 'too-old', version: '2.0.12', minimum: '2.1.270' },
  missing: { state: 'missing' },
  unknown: { state: 'unknown' },
};

/**
 * Sample answers for checking the screens in a browser. The query string picks the state, such
 * as ?claude=signed-out&platform=win32. ?claude=checking never answers.
 */
export function sampleApi(): FactwrightApi {
  const query = new URLSearchParams(location.search);
  const claude = query.get('claude') ?? 'ready';
  return {
    platform: query.get('platform') ?? 'darwin',
    claudeStatus: () =>
      claude === 'checking' ? new Promise(() => {}) : Promise.resolve(SAMPLES[claude] ?? READY),
  };
}
