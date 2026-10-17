import type { Computer } from './downloads.ts';

/**
 * The guide to running your own sync server, own-server.html. The subdomain typed in step 1 fills
 * in every address on the page, each value gets a button that copies it, and Make one makes the
 * server's BETTER_AUTH_SECRET. All of it stays on the page: nothing is sent anywhere or kept, and
 * the site's security policy lets the page connect nowhere anyway. Without this script, the page
 * reads as plain steps, with "yourname" in each address.
 */

/** The Worker's name, which the Deploy button keeps, and so the start of the server's address. */
export const WORKER = 'factwright-sync';

/** What each address shows until a subdomain is typed. */
export const PLACEHOLDER = 'yourname';

/** What someone typed for their subdomain: nothing yet, one that works, or one that can't be. */
export type Typed = { state: 'empty' } | { state: 'ok'; subdomain: string } | { state: 'bad' };

/** Every Worker's address ends in this, after its own name and the account's subdomain. */
const WORKERS_DEV = '.workers.dev';

/** A subdomain is one part of an address: letters, digits and dashes, with no dash at either end. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A pasted address's scheme, such as https://, and the host after it. */
const PASTED = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/;

/**
 * The workers.dev subdomain in what someone typed or pasted, in any case: the subdomain itself,
 * such as "jane-doe", or a whole address, such as "https://factwright-sync.jane-doe.workers.dev/".
 * While they type an address out, such as "jane-doe.work", it's the part before the first dot. A
 * pasted address on another site, such as Cloudflare's dashboard, can't hold one.
 */
export function readSubdomain(typed: string): Typed {
  const text = typed.trim().toLowerCase();
  const pasted = PASTED.exec(text);
  const host = (pasted ? (pasted[1] ?? '') : text.replace(/[/?#].*$/s, ''))
    .replace(/:\d*$/, '')
    .replace(/\.+$/, '');
  if (!host) return pasted ? { state: 'bad' } : { state: 'empty' };
  let subdomain: string | undefined;
  if (host.endsWith(WORKERS_DEV)) {
    // A Worker's address ends in its account's subdomain, then .workers.dev.
    subdomain = host.slice(0, -WORKERS_DEV.length).split('.').at(-1);
  } else if (pasted || host === WORKERS_DEV.slice(1)) {
    return { state: 'bad' };
  } else {
    const [first, second] = host.split('.');
    subdomain = first === WORKER && second ? second : first;
  }
  return subdomain && LABEL.test(subdomain) ? { state: 'ok', subdomain } : { state: 'bad' };
}

/** The server's address, as the Deploy button makes it in the account with this subdomain. */
export const serverAddress = (subdomain: string) => `https://${WORKER}.${subdomain}${WORKERS_DEV}`;

/** How many random bytes a secret holds: 256 bits, as `openssl rand -base64 32` makes. */
const SECRET_BYTES = 32;

/** Fills bytes with random ones, as the browser's own generator does. */
export type Random = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

/**
 * A new BETTER_AUTH_SECRET, from the browser's own random generator: 32 bytes as base64url, 43
 * letters, digits, dashes and underscores, so it copies and pastes cleanly anywhere.
 */
export function makeSecret(random: Random = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(SECRET_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** How long a Copy button says "Copied". Saying which keys to press instead stays twice as long. */
export const COPIED_MS = 2000;

/** What the guide needs from the browser, which the tests can stand in for. */
export interface GuideBrowser {
  /** Puts text on the clipboard, or rejects when the browser won't. Missing when it can't at all. */
  copy?: ((text: string) => Promise<void>) | undefined;
  random?: Random;
  /**
   * The keys that copy what's selected, for when copying by button fails, such as "⌘C". Null
   * where they can't be told, such as on a phone, which copies from the selection's own menu.
   */
  copyKeys?: string | null;
}

/** What the browser this page is in can do, on the computer the page is on, if it can be told. */
export function thisBrowser(computer: Computer | null): GuideBrowser {
  const clipboard =
    typeof navigator.clipboard?.writeText === 'function' ? navigator.clipboard : null;
  return {
    copy: clipboard ? (text) => clipboard.writeText(text) : undefined,
    copyKeys: computer === 'mac' ? '⌘C' : computer === 'windows' ? 'Ctrl+C' : null,
  };
}

/** Says why an address can't be copied yet, beside the subdomain's field. */
const TYPE_FIRST = 'Type your subdomain here first, and this page fills it in everywhere.';

/**
 * Sets the guide up on its page: shows the parts that need this script, and hides what stands in
 * for them, fills each address in as the subdomain is typed, copies each value with its button,
 * and makes a secret when asked.
 */
export function ownServerGuide(root: HTMLElement, browser: GuideBrowser = {}): void {
  const { copy, random, copyKeys = null } = browser;
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector);
  const field = find<HTMLInputElement>('[data-subdomain-field]');
  const problem = find('[data-subdomain-problem]');
  const status = find('[data-own-status]');
  const secret = find('[data-secret]');
  const make = find<HTMLButtonElement>('[data-make-secret]');
  if (!field || !problem) return;
  const badText = problem.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  for (const part of root.querySelectorAll<HTMLElement>('[data-needs-script]')) {
    // Copy buttons stay hidden where the browser can't copy: each value is easy to select instead.
    part.hidden = !copy && part.hasAttribute('data-copy');
  }
  for (const part of root.querySelectorAll<HTMLElement>('[data-without-script]')) {
    part.hidden = true;
  }

  /** Says something to screen readers, which the page shows in other ways. */
  const say = (words: string) => {
    if (status) status.textContent = words;
  };

  let subdomain: string | null = null;
  const fill = (typed: Typed) => {
    subdomain = typed.state === 'ok' ? typed.subdomain : null;
    for (const part of root.querySelectorAll<HTMLElement>('[data-subdomain]')) {
      part.textContent = subdomain ?? PLACEHOLDER;
      part.classList.toggle('is-filled', subdomain !== null);
    }
    for (const link of root.querySelectorAll<HTMLAnchorElement>('[data-server-link]')) {
      const text = link.querySelector('[data-server-link-text]');
      if (subdomain) link.href = serverAddress(subdomain);
      else link.removeAttribute('href');
      if (text) text.textContent = subdomain ? serverAddress(subdomain) : '';
      // The words around the link go with it.
      const words = link.closest<HTMLElement>('[data-needs-script]');
      if (words) words.hidden = !subdomain;
    }
  };
  // The problem describes the field only while it shows, so screen readers don't read it otherwise.
  const help = field.getAttribute('aria-describedby') ?? '';
  const showProblem = (words: string | null) => {
    problem.hidden = words === null;
    if (words === null) {
      field.removeAttribute('aria-invalid');
      field.setAttribute('aria-describedby', help);
    } else {
      problem.textContent = words;
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', `${help} ${problem.id}`.trim());
    }
  };

  // While someone types, the addresses follow along, and a problem waits until they move on.
  field.addEventListener('input', () => {
    const typed = readSubdomain(field.value);
    fill(typed);
    if (typed.state !== 'bad') showProblem(null);
  });
  field.addEventListener('change', () => {
    const typed = readSubdomain(field.value);
    fill(typed);
    showProblem(typed.state === 'bad' ? badText : null);
    // The person has moved on from the field, so screen readers hear the problem from here.
    if (typed.state === 'bad') say(badText);
    // A whole address pasted in shows as the subdomain read from it.
    if (typed.state === 'ok') field.value = typed.subdomain;
  });
  // The browser may have kept what was typed, such as when coming back to the page.
  const typed = readSubdomain(field.value);
  fill(typed);
  if (typed.state === 'bad') showProblem(badText);

  const timers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();
  const label = (button: HTMLButtonElement, words: string, copied: boolean) => {
    const text = button.querySelector('[data-copy-label]');
    if (text) text.textContent = words;
    button.classList.toggle('is-copied', copied);
  };
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
    button.addEventListener('click', async () => {
      const value = root.ownerDocument.getElementById(button.dataset.copy ?? '');
      if (!value || !copy) return;
      // An address isn't worth copying with "yourname" in it.
      if (value.querySelector('[data-subdomain]') && !subdomain) {
        showProblem(readSubdomain(field.value).state === 'bad' ? badText : TYPE_FIRST);
        field.focus();
        return;
      }
      const name = button.querySelector('.visually-hidden')?.textContent?.trim() ?? '';
      clearTimeout(timers.get(button));
      let shown = COPIED_MS;
      try {
        await copy(value.textContent ?? '');
        label(button, 'Copied', true);
        say(`Copied ${name}.`);
      } catch {
        // Where the browser won't copy, the value is selected, to copy with the keyboard.
        root.ownerDocument.getSelection()?.selectAllChildren(value);
        label(button, copyKeys ? `Press ${copyKeys}` : 'Selected', false);
        say(
          copyKeys
            ? `Selected ${name}. Press ${copyKeys} to copy it.`
            : `Selected ${name}, to copy.`,
        );
        shown *= 2;
      }
      timers.set(
        button,
        setTimeout(() => label(button, 'Copy', false), shown),
      );
    });
  }

  make?.addEventListener('click', () => {
    if (!secret) return;
    secret.textContent = makeSecret(random);
    secret.hidden = false;
    const copySecret = root.querySelector<HTMLButtonElement>(`button[data-copy="${secret.id}"]`);
    if (copySecret) {
      copySecret.hidden = !copy;
      label(copySecret, 'Copy', false);
    }
    const words = make.querySelector('[data-make-label]');
    if (words) words.textContent = 'Make another';
    say(
      copy
        ? 'Made a new secret. Copy it with the button beside it.'
        : 'Made a new secret, beside the button.',
    );
  });
}
