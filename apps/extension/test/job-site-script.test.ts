import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { menuHeight } from '../src/frame-size.ts';
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
    /**
     * Each field's menu, by its question: how many answers, whether Profile keeps it, and whether
     * it offers your Claude's drafts.
     */
    menus: {} as Record<string, { answers: number; keeps: boolean; draft?: boolean }>,
    /** How many answers a menu the script opens has. */
    shown: 1,
    /** The form the script asked about last. */
    form: null as PageForm | null,
    /** Whether the background waits to hear how a submit on the page before this one went. */
    watch: false,
  };
  const answer = (message: Record<string, unknown>): unknown => {
    switch (message.do) {
      case 'hello':
        return { allowed: state.allowed, ...(state.watch && { watch: true }) };
      case 'form':
        state.form = message.form as PageForm;
        return {
          menus: state.form.fields.map(
            (field): FieldMenu => ({
              ref: field.ref,
              key: field.key,
              answers: state.menus[field.question]?.answers ?? 0,
              keeps: state.menus[field.question]?.keeps ?? false,
              draft: state.menus[field.question]?.draft ?? false,
            }),
          ),
        };
      case 'menu': {
        const asked = state.form?.fields[message.ref as number]?.question ?? '';
        if (message.answers && state.menus[asked]?.draft) {
          return { answers: 0, save: message.save, draft: true };
        }
        return { answers: message.answers ? state.shown : 0, save: message.save };
      }
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
    const placed = (this as HTMLElement).style;
    // The script's own frames are where it put them.
    if (placed?.getPropertyValue('position') === 'fixed') {
      const at = (name: string) => Number.parseFloat(placed.getPropertyValue(name)) || 0;
      return new DOMRect(at('left'), at('top'), at('width'), at('height'));
    }
    return boxes.get(this.id) ?? new DOMRect(0, 0, 0, 0);
  });
  // The browser's own test of what's at a place: the last thing put on the page, the menu, as
  // nothing of the page lies over it.
  document.elementFromPoint = () => document.documentElement.lastElementChild;
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
  extension.watch = false;
  extension.shown = 1;
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
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    const [{ host, frame }] = frames() as [{ host: HTMLElement; frame: HTMLIFrameElement }];
    // Named by the script's own name for the page, which it said hello by, as a frame of another
    // page's needs, and the sites of the pages around it, where the browser says them.
    const [said] = sentOf('hello') as [{ doc: string; around: string[] }];
    expect(said.doc).toMatch(/^[0-9a-f-]{36}$/);
    expect(said.around).toEqual([]);
    expect(frame.src).toBe(`chrome-extension://factwright/frame.html#button:${said.doc}`);
    // On the page itself, a box with a closed shadow root: the page can't open it.
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.shadowRoot).toBeNull();
  });

  it('puts nothing on the page until it has loaded and settled a moment, as one that builds itself may be checking its own', async () => {
    script = startScript(() => true, 200);
    await vi.waitFor(() =>
      expect(sentOf('form').length + sentOf('hello').length).toBeGreaterThan(0),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frames()).toHaveLength(0);
    expect(document.documentElement.querySelectorAll('div')).toHaveLength(0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
  });

  it('puts its Fill button back when the page takes it away, or builds itself again', async () => {
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    const [{ host }] = frames() as [{ host: HTMLElement; frame: HTMLIFrameElement }];
    host.remove();
    await vi.waitFor(() => expect(host.isConnected).toBe(true));
    // A page whose code puts a new root in place of its own, as React does once it can't match
    // the page its site sent.
    const root = document.createElement('html');
    root.append(document.createElement('head'), document.body.cloneNode(true));
    document.replaceChild(root, document.documentElement);
    await vi.waitFor(() => expect(host.parentElement).toBe(root));
  });

  it('says goodbye as its page goes, by its own name for it, and hello again as it comes back', async () => {
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(sentOf('hello')).toHaveLength(1));
    const [{ doc }] = sentOf('hello') as [{ doc: string }];
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(sentOf('bye')).toEqual([{ type: 'job-site', do: 'bye', doc }]);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await vi.waitFor(() => expect(sentOf('hello')).toHaveLength(2));
    expect(sentOf('hello')[1]).toMatchObject({ doc });
  });

  it('does nothing on a site the background doesn’t allow', async () => {
    extension.allowed = false;
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(sentOf('hello')).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    clickIn('name');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(frames()).toEqual([]);
    expect(extension.sent.map((message) => message.do)).toEqual(['hello']);
  });

  it('opens a menu where you click in, asking about the form without what’s in it, and fills nothing', async () => {
    input('note').value = 'My own words, which the page has';
    script = startScript(() => true, 0);
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

  it('opens the menu again on a click in the field the cursor’s in', async () => {
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    clickIn('name');
    await vi.waitFor(() => expect(frames()).toHaveLength(2));
    // Escape closes it, and the cursor stays in the field.
    input('name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    expect(document.activeElement).toBe(input('name'));
    // A click in it, with no focus to come, opens it again; one more, with it open, does nothing.
    input('name').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await vi.waitFor(() => expect(frames()).toHaveLength(2));
    input('name').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('menu')).toHaveLength(2);
  });

  it('goes just under its field, over the page, where there’s no room beside it', async () => {
    // A control of the page's everywhere beside the field, as in a narrow window.
    document.body.insertAdjacentHTML('beforeend', '<button id="everywhere">Chat</button>');
    boxes.set('everywhere', new DOMRect(0, 0, innerWidth, innerHeight));
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(sentOf('hello')).toHaveLength(1));
    clickIn('name');
    await vi.waitFor(() =>
      expect(frames().some(({ frame }) => frame.src.includes('#menu:'))).toBe(true),
    );
    const menu = frames().find(({ frame }) => frame.src.includes('#menu:'));
    expect(menu?.host.style.getPropertyValue('left')).toBe('40px');
    expect(menu?.host.style.getPropertyValue('top')).toBe(`${100 + 24 + 6}px`);
  });

  it('offers your Claude’s drafts in one of the form’s own questions with no answer', async () => {
    extension.menus['Cover note'] = { answers: 0, keeps: false, draft: true };
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    clickIn('note');
    await vi.waitFor(() => expect(frames()).toHaveLength(2));
    expect(sentOf('menu')[0]).toMatchObject({ ref: 3, answers: true, save: false });
    // As big as a menu of answers, so the page can't tell them apart.
    expect(frames()[1]?.host.style.getPropertyValue('height')).toBe(`${menuHeight(true, false)}px`);
  });

  it('is the same size however many answers it has, so the page can’t count them', async () => {
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    clickIn('name');
    await vi.waitFor(() => expect(frames()).toHaveLength(2));
    const one = frames()[1]?.host.style.getPropertyValue('height');
    extension.shown = 3;
    clickIn('email');
    await vi.waitFor(() => expect(sentOf('menu')).toHaveLength(2));
    await vi.waitFor(() => expect(frames()).toHaveLength(2));
    expect(frames()[1]?.host.style.getPropertyValue('height')).toBe(one);
    expect(one).toBe(`${menuHeight(true, false)}px`);
  });

  it('opens where you tab to, or click a field’s label, and nowhere the page moves the cursor as you type', async () => {
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    // You type in one field, and the page puts the cursor in another.
    input('note').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    input('email').focus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('menu')).toEqual([]);
    // You click the name's label, and the browser puts the cursor in its field.
    const label = document.querySelector('label[for="name"]') as HTMLLabelElement;
    label.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    input('name').focus();
    await vi.waitFor(() => expect(sentOf('menu')).toHaveLength(1));
    // You press Tab to the next field.
    input('name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    input('phone').focus();
    await vi.waitFor(() => expect(sentOf('menu')).toHaveLength(2));
    expect(sentOf('menu')[1]).toMatchObject({ ref: 2 });
  });

  it('opens nothing where the page puts the cursor itself', async () => {
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    input('name').focus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('menu')).toEqual([]);
    expect(frames()).toHaveLength(1);
  });

  it('takes no event the page makes as yours', async () => {
    script = startScript(() => false, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    clickIn('name');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('menu')).toEqual([]);
  });

  it('puts the answer you picked in its field, as the background says, and closes the menu', async () => {
    script = startScript(() => true, 0);
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

  it('puts nothing in the field when the page faded the menu, or put something over it', async () => {
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    clickIn('name');
    await vi.waitFor(() => expect(frames()).toHaveLength(2));
    const key = (sentOf('menu')[0]?.key as string) ?? '';
    const pick = { type: 'job-site', do: 'write', answer: { ref: 0, key, text: 'Ana María Ruiz' } };
    document.documentElement.style.filter = 'opacity(0.3)';
    expect(await tell(pick)).toEqual({ filled: null });
    expect(input('name').value).toBe('');
    document.documentElement.style.filter = '';
    // Something the page put on top of the menu, where it was.
    input('name').blur();
    clickIn('name');
    await vi.waitFor(() => expect(frames()).toHaveLength(2));
    const menuBox = frames()[1]?.host.getBoundingClientRect() as DOMRect;
    const cover = document.createElement('div');
    cover.id = 'cover';
    boxes.set('cover', new DOMRect(menuBox.left + 10, menuBox.top + 10, 50, 20));
    document.documentElement.append(cover);
    const key2 = (sentOf('menu')[1]?.key as string) ?? '';
    expect(
      await tell({ type: 'job-site', do: 'write', answer: { ref: 0, key: key2, text: 'Ana' } }),
    ).toEqual({ filled: null });
    expect(input('name').value).toBe('');
    cover.remove();
  });

  it('reads what you gave a field only once you leave it, and only for one Profile keeps', async () => {
    script = startScript(() => true, 0);
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
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    input('email').value = 'ana@example.com';
    clickIn('email');
    clickIn('phone');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('left')).toEqual([]);
    // A form on one page has the panel read it only as it does every few seconds.
    expect(sentOf('look')).toEqual([]);
  });

  it('follows an application that runs over several pages, as Workday swaps its own in, and tells the panel', async () => {
    const step = (n: number, name: string, fields: string) => `
      <div data-automation-id="progressBar"><ol>
        <li data-automation-id="progressBarActiveStep"><div>current step ${n} of 6</div><label>${name}</label></li>
      </ol></div>
      <main>${fields}</main>`;
    document.body.innerHTML = step(
      3,
      'Application Questions',
      '<label for="why">Why us?</label><textarea id="why"></textarea>',
    );
    script = startScript(() => true, 0);
    // A page of the application, with no file or email on it: its Fill button shows. A page of
    // one loaded anew, as the next page of an application that loads each is, has the panel
    // filling it, if it's open, look at once.
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    const [{ doc }] = sentOf('hello') as [{ doc: string }];
    expect(sentOf('look')).toEqual([{ type: 'job-site', do: 'look', doc }]);
    // Leaving one of its fields has the panel read it at once, before the page can go on, as
    // when you press Save and Continue straight after typing.
    const why = document.getElementById('why') as HTMLTextAreaElement;
    why.focus();
    why.value = 'Your grid work.';
    why.blur();
    await vi.waitFor(() => expect(sentOf('look')).toHaveLength(2));
    expect(sentOf('look')).toEqual([
      { type: 'job-site', do: 'look', doc },
      { type: 'job-site', do: 'look', doc },
    ]);
    // What you typed goes nowhere: the panel reads it, if it's filling the form.
    expect(JSON.stringify(extension.sent)).not.toContain('Your grid work.');
    // Workday swaps its next page in, in the same tab, as you press its Save and Continue.
    document.body.innerHTML = step(
      4,
      'Voluntary Disclosures',
      '<label for="gender">Gender</label><button id="gender" type="button" aria-haspopup="listbox">Select One</button>',
    );
    await vi.waitFor(() => expect(sentOf('look')).toHaveLength(3));
    expect(frames()).toHaveLength(1);
    // Its Review, with nothing to fill, has no Fill button.
    document.body.innerHTML = step(6, 'Review', '<p>Check your application.</p>');
    await vi.waitFor(() => expect(frames()).toHaveLength(0));
    expect(sentOf('look')).toHaveLength(4);
  });

  it('opens a menu in a field inside a component, where the page leaves it open', async () => {
    document.body.innerHTML = '<form><x-field></x-field></form>';
    const host = document.querySelector('x-field') as HTMLElement;
    const inside = host.attachShadow({ mode: 'open' });
    inside.innerHTML = '<label for="work-email">Email</label><input id="work-email" type="email">';
    boxes.set('work-email', new DOMRect(40, 100, 200, 24));
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(sentOf('hello')).toHaveLength(1));
    // You click in the field: the page hears it as the component, and the script finds the field.
    const box = inside.getElementById('work-email') as HTMLInputElement;
    box.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    box.focus();
    await vi.waitFor(() => expect(sentOf('menu')).toHaveLength(1));
    expect(sentOf('form')[0]).toMatchObject({
      form: { fields: [expect.objectContaining({ question: 'Email' })] },
    });
  });

  it('never has the panel look at a form on one page as it loads', async () => {
    script = startScript(() => true, 0);
    // The form this file starts with, on one page: its Fill button shows, and the panel isn't told.
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    expect(sentOf('look')).toEqual([]);
  });

  it('says what the form held as you submit it, and whether its button sends the application', async () => {
    document
      .querySelector('form')
      ?.insertAdjacentHTML(
        'beforeend',
        '<button id="add" type="button">Add another</button><button id="next" type="button">Save and Continue</button><button id="send" type="button">Submit application</button>',
      );
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    input('note').value = 'Gear that lasts.';
    // A button that adds a part, or uploads, says nothing.
    document.getElementById('add')?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('submitting')).toEqual([]);
    document.getElementById('next')?.click();
    await vi.waitFor(() => expect(sentOf('submitting')).toHaveLength(1));
    expect(sentOf('submitting')[0]).toMatchObject({ final: false });
    document.getElementById('send')?.click();
    await vi.waitFor(() => expect(sentOf('submitting')).toHaveLength(2));
    const [, sent] = sentOf('submitting') as [
      unknown,
      { final: boolean; values: { value: string }[] },
    ];
    expect(sent.final).toBe(true);
    expect(sent.values.map((each) => each.value)).toContain('Gear that lasts.');
    // A click the page made itself isn't yours.
    script.stop();
    script = startScript(() => false, 0);
    document.getElementById('send')?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('submitting')).toHaveLength(2);
  });

  it('says how a submit went once the page moves on: the form gone, or the words that it went in', async () => {
    document
      .querySelector('form')
      ?.insertAdjacentHTML('beforeend', '<button id="send">Submit</button>');
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    document.getElementById('send')?.click();
    await vi.waitFor(() => expect(sentOf('submitting')).toHaveLength(1));
    // The page swaps its form for what it says once the application's in.
    document.body.innerHTML = '<main><h1>Thank you for applying!</h1></main>';
    await vi.waitFor(() =>
      expect(sentOf('outcome').at(-1)).toMatchObject({ submitted: true, form: false }),
    );
  });

  it('says how a submit went on the page after it, as the background asks', async () => {
    extension.watch = true;
    document.body.innerHTML = '<main><p>Your application was submitted successfully.</p></main>';
    script = startScript(() => true, 0);
    await vi.waitFor(() =>
      expect(sentOf('outcome')).toEqual([
        expect.objectContaining({ submitted: true, form: false, errors: false }),
      ]),
    );
  });

  it('hears only the application form’s own buttons, never a posting’s Apply above it', async () => {
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<button id="apply" type="button">Apply</button>',
    );
    document.body.insertAdjacentHTML(
      'beforeend',
      `<form id="search"><input name="q" type="search"><button id="find">Submit</button></form>
      <form id="news"><label for="news-email">Your email</label><input id="news-email" type="email"><button id="join">Submit</button></form>
      <div id="similar" role="button">Apply</div>`,
    );
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    // A posting's Apply above the form, a search box's, a newsletter's and a similar job's below
    // it, aren't its.
    document.getElementById('apply')?.click();
    document.getElementById('find')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('join')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('similar')?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('submitting')).toEqual([]);
  });

  it('hears a page’s own button after its fields, where it keeps them in no form', async () => {
    document.body.innerHTML = `
      <div role="button" id="apply">Apply</div>
      <main>
        <label for="name">Full name</label><input id="name" type="text">
        <label for="email">Email</label><input id="email" type="email">
        <label for="phone">Phone</label><input id="phone" type="tel">
      </main>
      <footer><div role="button" id="send">Submit application</div></footer>`;
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    document.getElementById('apply')?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('submitting')).toEqual([]);
    document.getElementById('send')?.click();
    await vi.waitFor(() => expect(sentOf('submitting')).toHaveLength(1));
    expect(sentOf('submitting')[0]).toMatchObject({ final: true });
  });

  it('hears the form sent as you press Enter in one of its boxes, never one the page sends itself', async () => {
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    const form = document.querySelector('form') as HTMLFormElement;
    form.addEventListener('submit', (event) => event.preventDefault());
    // The page's own code sends it, with no key of yours.
    form.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('submitting')).toEqual([]);
    // Enter for a new line in its box of several, then the page's code sends it: not yours either.
    input('note').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    form.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('submitting')).toEqual([]);
    // Enter, in one of its one-line boxes.
    input('name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    form.requestSubmit();
    await vi.waitFor(() => expect(sentOf('submitting')).toHaveLength(1));
  });

  it('hears the Submit on Workday’s Review, with nothing to fill, and waits for the page to go on', async () => {
    const step = (n: number, name: string, body: string) => `
      <div data-automation-id="progressBar"><ol>
        <li><div>step ${n - 1} of 6</div><label>Self Identify</label></li>
        <li data-automation-id="progressBarActiveStep"><div>current step ${n} of 6</div><label>${name}</label></li>
      </ol></div>
      <main>${body}</main>`;
    document.body.innerHTML = step(
      6,
      'Review',
      '<p>Check your application.</p><button id="send" type="button">Submit</button>',
    );
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(sentOf('hello')).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    document.getElementById('send')?.click();
    await vi.waitFor(() => expect(sentOf('submitting')).toHaveLength(1));
    expect(sentOf('submitting')[0]).toMatchObject({ final: true, values: [] });
    // Review, as Workday sends what's on it, is still the page you submitted, not one it went on to.
    document.querySelector('main')?.insertAdjacentHTML('beforeend', '<p>Submitting…</p>');
    await vi.waitFor(() => expect(sentOf('outcome')).toHaveLength(1));
    expect(sentOf('outcome')[0]).toMatchObject({ submitted: false, form: true });
    document.body.innerHTML = '<main><h2>Application Submitted</h2></main>';
    await vi.waitFor(() =>
      expect(sentOf('outcome').at(-1)).toMatchObject({ submitted: true, form: false }),
    );
  });

  it('puts a note in the Fill button’s place, as the background says, and takes it away', async () => {
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    const token = '0f3c9a8e-4b1d-4c2e-9f6a-1a2b3c4d5e6f';
    await tell({ type: 'job-site', do: 'note', token });
    await vi.waitFor(() => expect(frames()).toHaveLength(2));
    const shown = frames().filter(({ host }) => host.style.getPropertyValue('display') !== 'none');
    expect(shown.map(({ frame }) => frame.src)).toEqual([
      `chrome-extension://factwright/frame.html#note:${token}`,
    ]);
    await tell({ type: 'job-site', do: 'unnote', token });
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    expect(frames()[0]?.host.style.getPropertyValue('display')).toBe('block');
  });

  it('stops when the background says so, taking its frames away', async () => {
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(frames()).toHaveLength(1));
    await tell({ type: 'job-site', do: 'stop' });
    expect(frames()).toEqual([]);
    const before = extension.sent.length;
    clickIn('name');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(extension.sent).toHaveLength(before);
  });
});

/**
 * Each applicant system's own page, as the fixtures have it, and the button that sends it, or
 * goes on to its next page: what the script says as you press it.
 */
describe('submitting, on each applicant system’s own pages', () => {
  const FIXTURES = join(import.meta.dirname, 'fixtures');
  const cases: [page: string, button: string, final: boolean][] = [
    ['greenhouse-application', 'Submit application', true],
    ['lever-application', 'Submit application', true],
    ['ashby-application', 'Submit Application', true],
    ['smartrecruiters-application', 'Next', false],
    ['smartrecruiters-screening', 'Submit', true],
    ['successfactors-application', 'Apply', true],
    ['icims-candidate', 'Submit Profile', false],
    ['icims-questions', 'Submit', false],
    ['icims-eeo', 'Submit', true],
    ['taleo-personal', 'Save and Continue', false],
    ['taleo-esignature', 'Save and Continue', false],
    ['workday-my-information', 'Save and Continue', false],
    ['workday-application-questions', 'Save and Continue', false],
    ['workday-review', 'Submit', true],
  ];
  it.each(cases)('%s: %s', async (name, words, final) => {
    const html = readFileSync(join(FIXTURES, `${name}.html`), 'utf8');
    document.documentElement.innerHTML = new DOMParser()
      .parseFromString(html, 'text/html')
      .documentElement.innerHTML.replace(/<script[\s\S]*?<\/script>/gi, '')
      // Without the page's own handlers, whose code the fixtures don't have.
      .replace(/\son[a-z]+="[^"]*"/gi, '');
    script = startScript(() => true, 0);
    await vi.waitFor(() => expect(sentOf('hello')).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The button by its words, as you see it: a page's own kind of button by the words inside it.
    const button = [
      ...document.querySelectorAll(
        'button, input[type="submit"], input[type="button"], [role="button"], spl-button span',
      ),
    ]
      .reverse()
      .find(
        (each) =>
          (each.textContent?.trim() || (each as HTMLInputElement).value || '').replace(
            /\s+/g,
            ' ',
          ) === words,
      ) as HTMLElement | undefined;
    if (!button) throw new Error(`No ${words} on ${name}.`);
    button.click();
    await vi.waitFor(() => expect(sentOf('submitting')).toHaveLength(1));
    expect(sentOf('submitting')[0]).toMatchObject({ final });
  });
});
