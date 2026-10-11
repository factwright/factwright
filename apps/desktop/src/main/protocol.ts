import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { resolveInside } from './policy.ts';

const SCHEME = 'app';

/** Where the built screens are served from. A custom scheme keeps them off file:// URLs. */
export const APP_ORIGIN = `${SCHEME}://factwright`;

/** Lets app:// pages behave like a secure website. Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** Serves the built screens from `root`, with the content security policy on every response. */
export function serveApp(root: string, policy: string): void {
  protocol.handle(SCHEME, async (request) => {
    const file = resolveInside(root, new URL(request.url).pathname);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const response = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', policy);
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
