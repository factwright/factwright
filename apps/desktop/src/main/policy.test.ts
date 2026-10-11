import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  isSafeExternalUrl,
  openableFile,
  parseTerminalSize,
  resolveInside,
} from './policy.ts';

describe('parseTerminalSize', () => {
  it('accepts whole numbers in range', () => {
    expect(parseTerminalSize({ cols: 120, rows: 30 })).toEqual({ cols: 120, rows: 30 });
  });

  it.each([
    null,
    'big',
    { cols: 120 },
    { cols: 1.5, rows: 30 },
    { cols: 0, rows: 30 },
    { cols: 120, rows: 9999 },
    { cols: '120', rows: '30' },
  ])('refuses %o', (value) => {
    expect(parseTerminalSize(value)).toBeNull();
  });
});

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
  it('lets https and email links out', () => {
    expect(isSafeExternalUrl('https://code.claude.com/docs/en/setup')).toBe(true);
    expect(isSafeExternalUrl('mailto:jobs@acme.example?subject=Staff%20Engineer')).toBe(true);
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

describe('openableFile', () => {
  const workspace = join(sep, 'data', 'workspace');

  it('opens resumes inside the workspace', () => {
    expect(openableFile(workspace, 'applications/acme/resume.pdf')).toBe(
      join(workspace, 'applications', 'acme', 'resume.pdf'),
    );
    expect(openableFile(workspace, 'applications/acme/Resume.DOCX')).toBe(
      join(workspace, 'applications', 'acme', 'Resume.DOCX'),
    );
  });

  it.each([
    'applications/acme/job.md',
    'applications/acme/run.command',
    '../outside.pdf',
    'applications/../../outside.pdf',
    `${sep}etc${sep}passwd.pdf`,
  ])('refuses %s', (path) => {
    expect(openableFile(workspace, path)).toBeNull();
  });
});
