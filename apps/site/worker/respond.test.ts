import { describe, expect, it } from 'vitest';
import { respond, SECURITY_HEADERS } from './respond.ts';

/** Stands in for the built pages: answers every request with its path, or a 404. */
function assets(found = true) {
  const asked: string[] = [];
  return {
    asked,
    fetch: async (request: Request) => {
      asked.push(request.url);
      return new Response(new URL(request.url).pathname, {
        status: found ? 200 : 404,
        headers: { 'Content-Type': 'text/html' },
      });
    },
  };
}

const get = (url: string) => new Request(url);

describe('the site', () => {
  it('sends www to the bare address, keeping the path and query', async () => {
    const pages = assets();
    const response = await respond(get('https://www.factwright.com/how?from=card'), pages);
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://factwright.com/how?from=card');
    expect(pages.asked).toEqual([]);
  });

  it('sends plain http to https, on either address', async () => {
    for (const url of ['http://factwright.com/', 'http://www.factwright.com/']) {
      const response = await respond(get(url), assets());
      expect(response.status).toBe(301);
      expect(response.headers.get('Location')).toBe('https://factwright.com/');
    }
  });

  it('leaves a local preview where it is', async () => {
    const response = await respond(get('http://localhost:8787/'), assets());
    expect(response.status).toBe(200);
  });

  it('serves the pages with the security headers', async () => {
    const response = await respond(get('https://factwright.com/'), assets());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('/');
    expect(response.headers.get('Content-Type')).toBe('text/html');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it('runs only its own scripts and styles, connects nowhere, and never shows inside another site', () => {
    const policy = SECURITY_HEADERS['Content-Security-Policy'];
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('connect-src');
    expect(policy).not.toContain('unsafe');
  });

  it('serves the not-found page with its status and the security headers', async () => {
    const response = await respond(get('https://factwright.com/nowhere'), assets(false));
    expect(response.status).toBe(404);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
