import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldMenu } from '../src/job-site-messages.ts';
import type { PageForm } from '../src/page/form.ts';

/**
 * The extension's script on a job site you allowed, on a page with a form, with the background
 * standing in: it says the site's allowed, or not, and what each field's menu has, and hears
 * everything the script says. The browser's own events can't be made in a test, so the script is
 * told which events are yours: all of them, which a test then makes, or none.
 */
const extension = vi.hoisted(() => {
  const state = {
    allowed: true,
    sent: [] as Record<string, unknown>[],
    listeners: [] as ((
      message: unknown,
      sender: { id?: string },
      reply: (answer: unknown) => void,
    ) => unknown)[],
    /** Each field's menu, by its question: how many answers, and whether Profile keeps it. */
    menus: {} as Record<string, { answers: number; keeps: boolean }>,
  };
  const answer = (message: Record<string, unknown>): unknown => {
    switch (message.do) {
      case 'hello':
        return { allowed: state.allowed };
      case 'form':
        return {
          menus: (message.form as PageForm).fields.map(
            (field): FieldMenu => ({
              ref: field.ref,
              key: field.key,
              answers: state.menus[field.question]?.answers ?? 0,
              keeps: state.menus[field.question]?.keeps ?? false,
            }),
          ),
        };
      case 'menu':
        return { answers: message.answers ? 1 : 0, save: message.save };
      case 'left':
        return { offer: false };
      default:
        return {};
    }
  };
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: 'factwright',
      getURL: (path: string) => `chrome-extension://factwright/${path}`,
      sendMessage: async (message: Record<string, unknown>) => {
        state.sent.push(structuredClone(message));
        return answer(message);
      },
      onMessage: {
        addListener: (listener: (typeof state.listeners)[number]) => state.listeners.push(listener),
        removeListener: (listener: (typeof state.listeners)[number]) => {
          state.listeners = state.listeners.filter((each) => each !== listener);
        },
      },
    },
  };
  return state;
});

import { type Script, startScript } from '../src/job-site-script.ts';

/** The shadow roots the script made, which are closed to the page. */
const roots = new Map<Element, ShadowRoot>();
const attach = Element.prototype.attachShadow;
/** Where each field is on the screen, as a browser would lay the form out. */
const boxes = new Map<string, DOMRect>();

let script: Script | null = null;

beforeEach(() => {
  document.body.innerHTML = `
    <form>
      <label for="name">Full name</label><input id="name" name="name" type="text">
      <label for="email">Email</label><input id="email" name="email" type="email">
      <label for="phone">Phone</label><input id="phone" name="phone" type="tel">
      <label for="note">Cover note</label><textarea id="note" name="note"></textarea>
      <label for="resume">Resume</label><input id="resume" name="resume" type="file">
    </form>`;
  for (const [at, id] of ['name', 'email', 'phone', 'note', 'resume'].entries()) {
    boxes.set(id, new DOMRect(40, 100 + at * 60, 200, 24));
  }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return boxes.get(this.id) ?? new DOMRect(0, 0, 0, 0);
  });
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = attach.call(this, init);
    roots.set(this, root);
    return root;
  });
  roots.clear();
  extension.allowed = true;
  extension.sent.length = 0;
  extension.menus = {
    'Full name': { answers: 1, keeps: false },
    Email: { answers: 1, keeps: true },
    Phone: { answers: 1, keeps: true },
  };
});

afterEach(() => {
  script?.stop();
  script = null;
  for (const host of roots.keys()) host.remove();
  vi.restoreAllMocks();
});

/** The script's frames on the page: each one's host, and the frame in it, which the page can't reach. */
const frames = () =>
  [...roots.entries()]
    .filter(([host]) => host.isConnected)
    .map(([host, root]) => ({
      host: host as HTMLElement,
      frame: root.querySelector('iframe') as HTMLIFrameElement,
    }));

const input = (id: string) => document.getElementById(id) as HTMLInputElement;

/** Clicks in a field, as you would: the pointer goes down on it, and the cursor's in it. */
const clickIn = (id: string) => {
  input(id).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  input(id).focus();
};

const sentOf = (kind: string) => extension.sent.filter((message) => message.do === kind);

/** What the background tells the script, as from the extension, or not. */
const tell = (message: unknown, from = 'factwright') =>
  new Promise((resolve) => {
    let answered = false;
    for (const listener of extension.listeners) {
      const later = listener(message, { id: from }, (answer) => {
        answered = true;
        resolve(answer);
      });
      if (later !== true && !answered) resolve(undefined);
    }
  });

describe('the script on a job site you allowed', () => {
  it('puts the Fill button on a page with an application form, in a frame of the extension’s own', async () => {
    script = startScript(() => true);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    const [{ host, frame }] = frames() as [{ host: HTMLElement; frame: HTMLIFrameElement }];
    expect(frame.src).toBe('chrome-extension://factwright/frame.html#button');
    // On the page itself, a box with a closed shadow root: the page can't open it.
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.shadowRoot).toBeNull();
  });

  it('does nothing on a site the background doesn’t allow', async () => {
    extension.allowed = false;
    script = startScript(() => true);
    await vi.waitFor(() => expect(sentOf('hello')).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    clickIn('name');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(frames()).toEqual([]);
    expect(extension.sent.map((message) => message.do)).toEqual(['hello']);
  });

  it('opens a menu where you click in, asking about the form without what’s in it, and fills nothing', async () => {
    input('note').value = 'My own words, which the page has';
    script = startScript(() => true);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    clickIn('name');
    await vi.waitFor(() => expect(frames()).toHaveLength(2));
    const [form] = sentOf('form');
    expect(JSON.stringify(form)).not.toContain('My own words');
    const [menu] = sentOf('menu');
    expect(menu).toMatchObject({ ref: 0, answers: true, save: false });
    const shown = frames().find(({ frame }) => frame.src.includes('#menu:'));
    expect(shown?.frame.src).toBe(`chrome-extension://factwright/frame.html#menu:${menu?.token}`);
    // Beside the field, to its right, as nothing of the page's is there.
    expect(shown?.host.style.getPropertyValue('left')).toBe(`${40 + 200 + 6}px`);
    expect(input('name').value).toBe('');
    // Nothing the script sends has an answer: the frame gets them from the background.
    expect(JSON.stringify(extension.sent)).not.toContain('Ana');
  });

  it('opens nothing where the page puts the cursor itself', async () => {
    script = startScript(() => true);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    input('name').focus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('menu')).toEqual([]);
    expect(frames()).toHaveLength(1);
  });

  it('takes no event the page makes as yours', async () => {
    script = startScript(() => false);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    clickIn('name');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('menu')).toEqual([]);
  });

  it('puts the answer you picked in its field, as the background says, and closes the menu', async () => {
    script = startScript(() => true);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    clickIn('name');
    await vi.waitFor(() => expect(frames()).toHaveLength(2));
    const key = (sentOf('menu')[0]?.key as string) ?? '';
    // Another extension's word, or a page's, puts nothing in it.
    await tell({ type: 'job-site', do: 'write', answer: { ref: 0, key, text: 'Ana' } }, 'other');
    expect(input('name').value).toBe('');
    const written = (await tell({
      type: 'job-site',
      do: 'write',
      answer: { ref: 0, key, text: 'Ana María Ruiz' },
    })) as { filled: { ok: boolean } };
    expect(written.filled.ok).toBe(true);
    expect(input('name').value).toBe('Ana María Ruiz');
    expect(input('email').value).toBe('');
    expect(frames()).toHaveLength(1);
  });

  it('reads what you gave a field only once you leave it, and only for one Profile keeps', async () => {
    script = startScript(() => true);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    clickIn('phone');
    await vi.waitFor(() => expect(sentOf('menu')).toHaveLength(1));
    input('phone').value = '(720) 555-0123';
    input('phone').dispatchEvent(new Event('input', { bubbles: true }));
    expect(sentOf('left')).toEqual([]);
    clickIn('note');
    await vi.waitFor(() => expect(sentOf('left')).toHaveLength(1));
    expect(sentOf('left')[0]).toMatchObject({ ref: 2, value: '(720) 555-0123' });
    // What you write in your own words, for a field Profile doesn't keep, is never read.
    input('note').value = 'My own words';
    input('note').dispatchEvent(new Event('input', { bubbles: true }));
    clickIn('name');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('left')).toHaveLength(1);
    expect(JSON.stringify(extension.sent)).not.toContain('My own words');
  });

  it('never reads a field you only went through', async () => {
    script = startScript(() => true);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    input('email').value = 'ana@example.com';
    clickIn('email');
    clickIn('phone');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('left')).toEqual([]);
  });

  it('stops when the background says so, taking its frames away', async () => {
    script = startScript(() => true);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    await tell({ type: 'job-site', do: 'stop' });
    expect(frames()).toEqual([]);
    const before = extension.sent.length;
    clickIn('name');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(extension.sent).toHaveLength(before);
  });
});
