// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COPIED_MS,
  type GuideBrowser,
  makeSecret,
  ownServerGuide,
  PLACEHOLDER,
  readSubdomain,
  serverAddress,
  WORKER,
} from '../src/own-server.ts';

/** The site's folder. */
const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The script that makes sync-server's ready-to-deploy copy, which the guide's steps follow. */
const COPY_SCRIPT = readFileSync(
  join(SITE, '..', 'server', 'scripts', 'sync-server-copy.ts'),
  'utf8',
);

describe('readSubdomain', () => {
  it('reads a subdomain as it’s typed', () => {
    expect(readSubdomain('jane-doe')).toEqual({ state: 'ok', subdomain: 'jane-doe' });
    expect(readSubdomain('  Jane-Doe ')).toEqual({ state: 'ok', subdomain: 'jane-doe' });
    expect(readSubdomain('j')).toEqual({ state: 'ok', subdomain: 'j' });
    expect(readSubdomain('team42')).toEqual({ state: 'ok', subdomain: 'team42' });
  });

  it('reads it from a whole address pasted in', () => {
    for (const address of [
      'jane-doe.workers.dev',
      'https://jane-doe.workers.dev',
      'https://factwright-sync.jane-doe.workers.dev/',
      'https://factwright-sync.jane-doe.workers.dev/api/auth/callback/github',
      'HTTPS://FACTWRIGHT-SYNC.JANE-DOE.WORKERS.DEV',
      'https://another-worker.jane-doe.workers.dev?x=1#top',
      'jane-doe.workers.dev.',
    ]) {
      expect(readSubdomain(address), address).toEqual({ state: 'ok', subdomain: 'jane-doe' });
    }
  });

  it('follows along while an address is typed out', () => {
    for (const typing of ['jane-doe.', 'jane-doe.w', 'jane-doe.workers', 'jane-doe.workers.de']) {
      expect(readSubdomain(typing), typing).toEqual({ state: 'ok', subdomain: 'jane-doe' });
    }
    expect(readSubdomain(`${WORKER}.jane-doe`)).toEqual({ state: 'ok', subdomain: 'jane-doe' });
  });

  it('has nothing to read until something’s typed', () => {
    expect(readSubdomain('')).toEqual({ state: 'empty' });
    expect(readSubdomain('   ')).toEqual({ state: 'empty' });
  });

  it('turns away what can’t be a subdomain', () => {
    for (const typed of [
      'jane doe',
      'jane_doe',
      '-jane',
      'jane-',
      'jané',
      'a'.repeat(64),
      'workers.dev',
      '.workers.dev',
      'https://',
      // Cloudflare's dashboard, pasted by mistake.
      'https://dash.cloudflare.com/0123456789abcdef/workers-and-pages',
    ]) {
      expect(readSubdomain(typed), typed).toEqual({ state: 'bad' });
    }
    expect(readSubdomain('a'.repeat(63))).toEqual({ state: 'ok', subdomain: 'a'.repeat(63) });
  });
});

describe('serverAddress', () => {
  it('is where the Deploy button puts the server in that account', () => {
    expect(serverAddress('jane-doe')).toBe('https://factwright-sync.jane-doe.workers.dev');
  });

  it('uses the name sync-server’s copy gives the Worker', () => {
    expect(COPY_SCRIPT).toContain(`export const NAME = '${WORKER}';`);
  });
});

describe('makeSecret', () => {
  it('turns 32 random bytes into 43 characters that copy cleanly', () => {
    const secret = makeSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // More than enough for Better Auth, which wants 32 characters or more.
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it('takes every byte from the random generator, in base64url with no padding', () => {
    // In plain base64, these bytes are "+/v7" over and over, then "+/s=".
    const random = vi.fn((bytes: Uint8Array<ArrayBuffer>) => bytes.fill(0xfb));
    expect(makeSecret(random)).toBe(`${'-_v7'.repeat(10)}-_s`);
    expect(random).toHaveBeenCalledOnce();
    expect(random.mock.calls[0]?.[0]).toHaveLength(32);
  });

  it('makes a different one each time', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => makeSecret()));
    expect(secrets.size).toBe(50);
  });
});

/** Opens the guide as the build makes it, without its script. */
function openGuide(): HTMLElement {
  const parsed = new DOMParser().parseFromString(
    readFileSync(join(SITE, 'own-server.html'), 'utf8'),
    'text/html',
  );
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
  const root = document.querySelector<HTMLElement>('[data-own-server]');
  if (!root) throw new Error('The guide has no [data-own-server].');
  return root;
}

const field = () =>
  document.querySelector<HTMLInputElement>('[data-subdomain-field]') as HTMLInputElement;
const problem = () =>
  document.querySelector<HTMLElement>('[data-subdomain-problem]') as HTMLElement;
const status = () => document.querySelector('[data-own-status]')?.textContent;
const text = (id: string) => document.getElementById(id)?.textContent;
const copyButton = (id: string) =>
  document.querySelector<HTMLButtonElement>(`button[data-copy="${id}"]`) as HTMLButtonElement;
const label = (button: HTMLButtonElement) => button.querySelector('[data-copy-label]')?.textContent;

/** Types into the subdomain's field, as a person would, then maybe moves on. */
function typeIn(value: string, moveOn = false) {
  field().value = value;
  field().dispatchEvent(new Event('input', { bubbles: true }));
  if (moveOn) field().dispatchEvent(new Event('change', { bubbles: true }));
}

/** Clicks a button, and lets what it started finish: copying waits on the clipboard. */
async function click(button: HTMLButtonElement) {
  button.click();
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
}

/** The four addresses on the page, and what each should say for a subdomain. */
const ADDRESSES = {
  'server-address': (sub: string) => serverAddress(sub),
  'homepage-url': (sub: string) => serverAddress(sub),
  'callback-url': (sub: string) => `${serverAddress(sub)}/api/auth/callback/github`,
  'connect-address': (sub: string) => serverAddress(sub),
};

describe('the guide on its page', () => {
  let copied: string[];
  let browser: GuideBrowser;

  beforeEach(() => {
    copied = [];
    browser = {
      copy: async (words) => {
        copied.push(words);
      },
      random: (bytes) => bytes.fill(7),
      copyKeys: '⌘C',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows its tools, and hides what stands in for them without the script', () => {
    const root = openGuide();
    const needs = [...root.querySelectorAll<HTMLElement>('[data-needs-script]')];
    const without = [...root.querySelectorAll<HTMLElement>('[data-without-script]')];
    expect(needs.length).toBeGreaterThan(4);
    expect(without.length).toBeGreaterThan(1);
    expect(needs.every((part) => part.hidden)).toBe(true);
    expect(without.some((part) => part.hidden)).toBe(false);
    ownServerGuide(root, browser);
    expect(field().closest<HTMLElement>('[hidden]')).toBeNull();
    expect(without.every((part) => part.hidden)).toBe(true);
    for (const id of Object.keys(ADDRESSES)) expect(copyButton(id).hidden, id).toBe(false);
    // The secret and its button wait until one's made, and the check's link until there's an
    // address to open.
    expect(document.querySelector<HTMLElement>('[data-secret]')?.hidden).toBe(true);
    expect(copyButton('secret').hidden).toBe(true);
    expect(
      document.querySelector('[data-server-link]')?.closest<HTMLElement>('[hidden]'),
    ).not.toBeNull();
  });

  it('shows “yourname” in every address until a subdomain is typed', () => {
    ownServerGuide(openGuide(), browser);
    for (const [id, address] of Object.entries(ADDRESSES))
      expect(text(id), id).toBe(address(PLACEHOLDER));
  });

  it('fills in every address as the subdomain is typed', () => {
    ownServerGuide(openGuide(), browser);
    typeIn('jane-doe');
    for (const [id, address] of Object.entries(ADDRESSES))
      expect(text(id), id).toBe(address('jane-doe'));
    for (const part of document.querySelectorAll('[data-subdomain]')) {
      expect(part.classList).toContain('is-filled');
    }
    const link = document.querySelector<HTMLAnchorElement>('[data-server-link]');
    expect(link?.getAttribute('href')).toBe(serverAddress('jane-doe'));
    expect(link?.querySelector('[data-server-link-text]')?.textContent).toBe(
      serverAddress('jane-doe'),
    );
    expect(link?.closest<HTMLElement>('[hidden]')).toBeNull();
    // Clearing it puts "yourname" back, and takes the link away.
    typeIn('');
    expect(text('server-address')).toBe(serverAddress(PLACEHOLDER));
    expect(link?.hasAttribute('href')).toBe(false);
    expect(link?.closest<HTMLElement>('[hidden]')).not.toBeNull();
  });

  it('shows a pasted address as the subdomain read from it', () => {
    ownServerGuide(openGuide(), browser);
    typeIn('https://factwright-sync.jane-doe.workers.dev/', true);
    expect(field().value).toBe('jane-doe');
    expect(text('callback-url')).toBe(ADDRESSES['callback-url']('jane-doe'));
  });

  it('says what’s wrong with a subdomain once the person moves on, not while they type', () => {
    ownServerGuide(openGuide(), browser);
    typeIn('jane_doe');
    expect(problem().hidden).toBe(true);
    expect(text('server-address')).toBe(serverAddress(PLACEHOLDER));
    typeIn('jane_doe', true);
    expect(problem().hidden).toBe(false);
    expect(problem().textContent).toContain('letters, numbers and dashes');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-describedby')).toBe('subdomain-help subdomain-problem');
    // Fixing it takes the problem away as they type.
    typeIn('jane-doe');
    expect(problem().hidden).toBe(true);
    expect(field().hasAttribute('aria-invalid')).toBe(false);
    expect(field().getAttribute('aria-describedby')).toBe('subdomain-help');
  });

  it('picks up a subdomain the browser kept, such as on coming back to the page', () => {
    const root = openGuide();
    field().value = 'jane-doe';
    ownServerGuide(root, browser);
    expect(text('connect-address')).toBe(serverAddress('jane-doe'));
  });

  it('copies each value exactly, and says so for a moment', async () => {
    vi.useFakeTimers();
    ownServerGuide(openGuide(), browser);
    typeIn('jane-doe');
    for (const [id, address] of Object.entries(ADDRESSES)) {
      await click(copyButton(id));
      expect(copied.at(-1), id).toBe(address('jane-doe'));
    }
    await click(copyButton('app-name'));
    expect(copied.at(-1)).toBe('Factwright sync');
    const button = copyButton('homepage-url');
    await click(button);
    expect(label(button)).toBe('Copied');
    expect(button.classList).toContain('is-copied');
    expect(status()).toBe('Copied the homepage URL.');
    vi.advanceTimersByTime(COPIED_MS);
    expect(label(button)).toBe('Copy');
    expect(button.classList).not.toContain('is-copied');
  });

  it('won’t copy an address with “yourname” in it, and asks for the subdomain instead', async () => {
    ownServerGuide(openGuide(), browser);
    await click(copyButton('callback-url'));
    expect(copied).toEqual([]);
    expect(document.activeElement).toBe(field());
    expect(problem().hidden).toBe(false);
    expect(problem().textContent).toContain('Type your subdomain here first');
    // The application name has no subdomain in it, so it copies.
    await click(copyButton('app-name'));
    expect(copied).toEqual(['Factwright sync']);
  });

  it('selects the value to copy with the keyboard when the browser won’t copy it', async () => {
    ownServerGuide(openGuide(), {
      ...browser,
      copy: () => Promise.reject(new Error('Not allowed')),
    });
    typeIn('jane-doe');
    const button = copyButton('server-address');
    await click(button);
    expect(document.getSelection()?.toString()).toBe(serverAddress('jane-doe'));
    expect(label(button)).toBe('Press ⌘C');
    expect(status()).toBe('Selected your server’s address. Press ⌘C to copy it.');
  });

  it('leaves the Copy buttons out where the browser can’t copy at all', () => {
    ownServerGuide(openGuide(), { ...browser, copy: undefined });
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
      expect(button.hidden, button.dataset.copy).toBe(true);
    }
    typeIn('jane-doe');
    expect(text('server-address')).toBe(serverAddress('jane-doe'));
  });

  it('makes a secret on the page, to copy', async () => {
    ownServerGuide(openGuide(), browser);
    const make = document.querySelector<HTMLButtonElement>(
      '[data-make-secret]',
    ) as HTMLButtonElement;
    expect(make.hidden).toBe(false);
    await click(make);
    const secret = document.querySelector<HTMLElement>('[data-secret]');
    const expected = makeSecret((bytes) => bytes.fill(7));
    expect(secret?.hidden).toBe(false);
    expect(secret?.textContent).toBe(expected);
    expect(make.querySelector('[data-make-label]')?.textContent).toBe('Make another');
    expect(copyButton('secret').hidden).toBe(false);
    await click(copyButton('secret'));
    expect(copied).toEqual([expected]);
    // A secret that needs no subdomain copies before one's typed.
    expect(status()).toBe('Copied the secret.');
  });

  it('keeps everything on the page: nothing sent, stored or written into an address', async () => {
    const fetch = vi.fn();
    const open = vi.spyOn(XMLHttpRequest.prototype, 'open');
    vi.stubGlobal('fetch', fetch);
    try {
      localStorage.clear();
      sessionStorage.clear();
      ownServerGuide(openGuide(), { ...browser, random: undefined });
      typeIn('jane-doe', true);
      await click(
        document.querySelector<HTMLButtonElement>('[data-make-secret]') as HTMLButtonElement,
      );
      await click(copyButton('secret'));
      const secret = document.querySelector('[data-secret]')?.textContent ?? '';
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(fetch).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(localStorage.length + sessionStorage.length).toBe(0);
      expect(location.href).not.toContain(secret);
      expect(location.href).not.toContain('jane-doe');
      // The secret is in its own place on the page, and nowhere else, not even an attribute.
      const html = document.documentElement.outerHTML;
      expect(html.split(secret)).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
      open.mockRestore();
    }
  });
});

describe('the guide’s steps', () => {
  it('ask for every secret sync-server’s copy needs, by name', () => {
    const block = /export const SECRETS = \{([\s\S]*?)\} as const;/.exec(COPY_SCRIPT)?.[1] ?? '';
    const secrets = [...block.matchAll(/^\s+([A-Z_]+):/gm)].map((match) => match[1]);
    expect(secrets).toEqual(['BETTER_AUTH_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']);
    openGuide();
    const asked = [...document.querySelectorAll('#deploy .own-field dt code')].map(
      (code) => code.textContent,
    );
    expect(asked).toEqual(secrets);
  });

  it('send the Deploy button to sync-server’s copy', () => {
    expect(COPY_SCRIPT).toContain(
      "export const REPOSITORY = 'https://github.com/factwright/sync-server';",
    );
    expect(COPY_SCRIPT).toMatch(
      /export const DEPLOY_BUTTON = `https:\/\/deploy\.workers\.cloudflare\.com\/\?url=\$\{REPOSITORY\}`;/,
    );
    openGuide();
    expect(document.querySelector('#deploy a.button')?.getAttribute('href')).toBe(
      'https://deploy.workers.cloudflare.com/?url=https://github.com/factwright/sync-server',
    );
  });

  it('give GitHub the callback the server signs in through', () => {
    openGuide();
    expect(text('callback-url')).toBe(`${serverAddress(PLACEHOLDER)}/api/auth/callback/github`);
    const routes = readFileSync(join(SITE, '..', 'server', 'src', 'auth-options.ts'), 'utf8');
    expect(routes).toContain("basePath: '/api/auth',");
  });
});
