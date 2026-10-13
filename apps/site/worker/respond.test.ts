import { describe, expect, it } from 'vitest';
import { installerUrl, type Release, releaseLine } from './releases.ts';
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

/** A built download page, as the Worker gets it: links to the newest installers, and no versions. */
const DOWNLOAD_PAGE = [
  `<a href="${installerUrl('mac', null)}" data-direct>Download for Mac</a>`,
  releaseLine('mac'),
  `<a href="${installerUrl('windows', null)}">Download for Windows</a>`,
  releaseLine('windows'),
].join('\n');

/** Stands in for the built pages, each with the validators an asset comes with. */
function pages() {
  return {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === '/download/') {
        return new Response(null, { status: 307, headers: { Location: '/download' } });
      }
      return new Response(path.startsWith('/download') ? DOWNLOAD_PAGE : '<h1>Factwright</h1>', {
        headers: { 'Content-Type': 'text/html', ETag: '"abc"', 'Content-Length': '999' },
      });
    },
  };
}

const RELEASE: Release = { version: '0.1.0', date: '2026-10-13T15:04:05.000Z', size: 231_456_789 };

/** The newest release for each computer, noting which were asked for. */
function releases(release: Release | null = RELEASE) {
  const asked: string[] = [];
  return {
    asked,
    newest: async (computer: string) => {
      asked.push(computer);
      return release;
    },
  };
}

describe('the download pages', () => {
  it('fill in the newest release, which browsers ask for again each time', async () => {
    const known = releases();
    const response = await respond(
      get('https://factwright.com/download/mac'),
      pages(),
      known.newest,
    );
    expect(known.asked).toEqual(['mac']);
    const html = await response.text();
    expect(html).toContain('href="https://downloads.factwright.com/Factwright-0.1.0.dmg"');
    expect(html).toContain('>Version 0.1.0 · 231 MB · October 13, 2026</p>');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('ETag')).toBeNull();
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(response.headers.get('Content-Type')).toBe('text/html');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it('ask only for the computers they offer', async () => {
    for (const [path, computers] of [
      ['/download', ['mac', 'windows']],
      ['/download/mac', ['mac']],
      ['/download/windows', ['windows']],
    ] as const) {
      const known = releases();
      await respond(get(`https://factwright.com${path}`), pages(), known.newest);
      expect(known.asked, path).toEqual(computers);
    }
  });

  it('keep the newest installer, and no version, when the release can’t be told', async () => {
    const response = await respond(
      get('https://factwright.com/download/windows'),
      pages(),
      releases(null).newest,
    );
    expect(await response.text()).toBe(DOWNLOAD_PAGE);
  });

  it('leave every other page, and any redirect, as it is', async () => {
    const known = releases();
    const home = await respond(get('https://factwright.com/'), pages(), known.newest);
    expect(await home.text()).toBe('<h1>Factwright</h1>');
    expect(home.headers.get('ETag')).toBe('"abc"');
    const slash = await respond(get('https://factwright.com/download/'), pages(), known.newest);
    expect(slash.status).toBe(307);
    expect(known.asked).toEqual([]);
  });
});
