import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, isSafeExternalUrl, resolveInside } from './policy.ts';

describe('contentSecurityPolicy', () => {
  it('allows only the app itself', () => {
    const policy = contentSecurityPolicy();
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self';");
    expect(policy).toContain("connect-src 'self';");
    expect(policy).toContain("object-src 'none'");
  });

  it("also allows Vite's dev server during development", () => {
    const policy = contentSecurityPolicy('http://localhost:5173/');
    expect(policy).toContain("script-src 'self' http://localhost:5173;");
    expect(policy).toContain("connect-src 'self' http://localhost:5173 ws://localhost:5173;");
  });
});

describe('isSafeExternalUrl', () => {
  it('lets https links out', () => {
    expect(isSafeExternalUrl('https://code.claude.com/docs/en/setup')).toBe(true);
  });

  it.each(['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url'])(
    'keeps %s in',
    (url) => {
      expect(isSafeExternalUrl(url)).toBe(false);
    },
  );
});

describe('resolveInside', () => {
  const root = join('/', 'Applications', 'Factwright.app', 'renderer');

  it('serves files inside the folder', () => {
    expect(resolveInside(root, '/assets/index.js')).toBe(join(root, 'assets', 'index.js'));
    expect(resolveInside(root, '/')).toBe(join(root, 'index.html'));
  });

  it.each(['/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/%E0%A4%A'])(
    'refuses %s',
    (path) => {
      expect(resolveInside(root, path)).toBeNull();
    },
  );
});
