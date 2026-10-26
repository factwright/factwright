import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FieldReply, InboxAsk } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ashbyActs } from '../scripts/sites-own-code.ts';
import { type FillPlan, fillInPasses } from '../src/fill.ts';
import type { FillWay } from '../src/fill-way.ts';
import { type FieldFilled, formPage, type PageForm } from '../src/page/form.ts';

/**
 * Filling Ashby's application, its own code acted out as a real form showed it (ashbyActs): a Yes
 * or No it keeps, and its server keeps a moment later, and Autofill from resume, which puts back
 * the form as its server had it when it started reading, so an answer given meanwhile is gone.
 * Fill waits for a reading to end before it picks, and picks again what the page took back.
 */

const HERE = 'https://jobs.ashbyhq.com/tidewater/1d1f0e3a/application';

/** The page the browser has, which the extension's function runs in. */
const page = vi.hoisted(() => ({ doc: null as Document | null }));

vi.hoisted(() => {
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: 'factwright',
      getURL: (path: string) => `chrome-extension://factwright/${path}`,
    },
    permissions: { contains: async () => true },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    scripting: {
      executeScript: async ({ func, args }: { func: unknown; args: unknown[] }) => {
        if (!page.doc) throw new Error('No page.');
        const formPage = func as (task: unknown, doc: Document, href: string) => Promise<unknown>;
        return [{ frameId: 0, result: await formPage(args[0], page.doc, HERE) }];
      },
    },
  };
});

/** A file list as a browser's, which jsdom lacks. */
class Files {
  list: File[] = [];
  items = { add: (file: File) => this.list.push(file) };
  get files() {
    return this.list;
  }
}

/** A file field that takes a file as a browser's does. */
function takesFiles(input: HTMLInputElement): void {
  let held: File[] = [];
  Object.defineProperty(input, 'files', {
    get: () => held,
    set: (list: File[]) => {
      held = [...list];
    },
    configurable: true,
  });
}

const READ_MS = 500;
const EU = 'Are you based in a EU or equivalent timezone?';

/** Ashby's application, as its page is, with its own code. */
function ashby(): Document {
  const doc = new DOMParser().parseFromString(
    readFileSync(join(import.meta.dirname, 'fixtures', 'ashby-application.html'), 'utf8'),
    'text/html',
  );
  for (const input of doc.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    takesFiles(input);
  }
  ashbyActs(doc, READ_MS);
  page.doc = doc;
  return doc;
}

/** Drops a resume in Autofill from resume, as you might, which Ashby then reads. */
function drop(doc: Document): void {
  const input = doc.querySelector<HTMLInputElement>(
    '.ashby-application-form-autofill-pane input[type="file"]',
  );
  if (!input) throw new Error('No Autofill from resume');
  input.files = [new File(['%PDF'], 'MyResume.pdf')] as unknown as FileList;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** What Ashby's server keeps for the EU question, and the button the page shows pressed. */
const server = (doc: Document) =>
  (doc as unknown as { ashbyServer: Record<string, boolean | null> }).ashbyServer;
const pressed = (doc: Document) =>
  [...doc.querySelectorAll('.ashby-application-form-input-yesno')][0]
    ?.querySelector('[aria-pressed="true"]')
    ?.textContent?.trim() ?? '';
const EU_NAME = '9fd0020d-14f0-47f3-b076-f31e5eaa8295';

/** The EU question's No, and how many times it's clicked from now on. */
function noClicks(doc: Document) {
  const no = [...doc.querySelectorAll('.ashby-application-form-input-yesno button')].find(
    (button) => button.textContent?.trim() === 'No',
  );
  if (!no) throw new Error('No No');
  const counted = { no, clicks: 0 };
  no.addEventListener('click', () => {
    counted.clicks += 1;
  });
  return counted;
}

async function read(doc: Document): Promise<PageForm> {
  const answer = await formPage({ do: 'read' }, doc, HERE);
  if (answer.did !== 'read') throw new Error('It didn’t read the form.');
  return answer.form;
}

/** Factwright's answers: the name, the job's resume and No for the EU question. */
function planFor(form: PageForm): FillPlan {
  const replies = form.fields.map((field): FieldReply => {
    if (field.question === 'Name')
      return { kind: 'full-name', text: 'Ana Ruiz', source: 'profile' };
    if (field.question === 'Resume') return { kind: 'resume', file: 'resume', source: 'job' };
    if (field.question === EU) return { kind: 'question', pick: ['No'], source: 'sent' };
    return { kind: 'question', source: 'you', left: 'new' };
  });
  return {
    ok: true,
    did: 'fill',
    job: {
      id: 'tidewater--staff',
      company: 'Tidewater',
      role: 'Staff',
      status: 'new',
      appliedOn: null,
    },
    replies,
    files: {
      resume: { name: 'AnaRuizResume10252026_Tidewater.pdf', size: 8, parts: 1, version: 'v1' },
      'cover-letter': null,
    },
  };
}

/** Factwright on this computer, as the fill asks it for the job's resume. */
const way: FillWay = {
  via: 'computer',
  ask: async (ask: InboxAsk) =>
    ask.ask === 'file'
      ? { ok: true, did: 'file', part: 0, parts: 1, base64: 'JVBERi0xLjc=' }
      : { ok: false, reason: 'failed', message: 'Not asked here.' },
};

async function fillAll(doc: Document) {
  const form = await read(doc);
  const filled = new Map<string, FieldFilled>();
  const done = await fillInPasses({
    place: { tabId: 1, frameId: 0 },
    way,
    form,
    plan: planFor(form),
    shows: { company: 'Tidewater', role: 'Staff' },
    filled,
    stale: () => false,
  });
  return { done, filled, form };
}

const settle = (ms = 300) => new Promise((done) => setTimeout(done, ms));

beforeEach(() => {
  (globalThis as { DataTransfer?: unknown }).DataTransfer = Files;
});

afterEach(() => {
  delete (globalThis as { DataTransfer?: unknown }).DataTransfer;
  page.doc = null;
});

describe('Ashby’s application', () => {
  it('takes back a Yes or No picked while it reads a resume, as the real form did', async () => {
    const doc = ashby();
    const form = await read(doc);
    const eu = form.fields.find((field) => field.question === EU);
    if (!eu) throw new Error('No EU question');
    drop(doc);
    // Picked straight away, as Fill did, while Ashby reads the resume.
    await formPage(
      { do: 'fill', url: HERE, answers: [{ ref: eu.ref, key: eu.key, pick: ['No'] }] },
      doc,
      HERE,
    );
    expect(pressed(doc)).toBe('No');
    await settle(READ_MS + 300);
    expect(pressed(doc)).toBe('');
    expect(server(doc)[EU_NAME]).toBeNull();
  });

  it('waits while Ashby reads a resume you dropped in, then picks No, which holds', async () => {
    const doc = ashby();
    const no = noClicks(doc);
    drop(doc);
    const { done } = await fillAll(doc);
    expect(done).toBe(true);
    await settle();
    // Once, after the reading: nothing took it back.
    expect(no.clicks).toBe(1);
    expect(pressed(doc)).toBe('No');
    expect(server(doc)[EU_NAME]).toBe(false);
    expect((doc.getElementById('_systemfield_name') as HTMLInputElement).value).toBe('Ana Ruiz');
  });

  it('picks again a Yes or No the page took back once it was filled', async () => {
    const doc = ashby();
    // You drop your resume in just as Fill picks No: once Ashby has read it, No is gone.
    const no = noClicks(doc);
    no.no.addEventListener('click', () => drop(doc), { once: true });
    const { done, filled, form } = await fillAll(doc);
    expect(done).toBe(true);
    expect((doc as unknown as { ashbyParses: number }).ashbyParses).toBe(1);
    await settle();
    // Picked, taken back, and picked again a moment later.
    expect(no.clicks).toBe(2);
    expect(pressed(doc)).toBe('No');
    expect(server(doc)[EU_NAME]).toBe(false);
    const eu = form.fields.find((field) => field.question === EU);
    expect(filled.get(eu?.key ?? '')).toMatchObject({ ok: true, shown: 'No' });
  });

  it('puts the job’s resume in its Resume field under its own name, and keeps one you attached', async () => {
    const doc = ashby();
    const { filled, form } = await fillAll(doc);
    const field = form.fields.find((each) => each.question === 'Resume');
    expect(filled.get(field?.key ?? '')).toMatchObject({
      ok: true,
      shown: 'AnaRuizResume10252026_Tidewater.pdf',
    });
    // Another page, where you attached your own.
    const yours = ashby();
    const input = yours.getElementById('_systemfield_resume') as HTMLInputElement;
    input.files = [new File(['%PDF'], 'SteveHillyerResume.pdf')] as unknown as FileList;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const again = await fillAll(yours);
    expect(again.filled.get(field?.key ?? '')).toMatchObject({
      ok: true,
      shown: 'SteveHillyerResume.pdf',
      kept: true,
    });
    expect([...(input.files ?? [])].map((file) => file.name)).toEqual(['SteveHillyerResume.pdf']);
  });
});
