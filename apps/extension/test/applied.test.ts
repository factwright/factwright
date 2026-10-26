import type { FieldReply } from '@factwright/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FillPlan } from '../src/fill.ts';
import { onComputer } from '../src/fill-way.ts';
import type { PageField, PageForm } from '../src/page/form.ts';

/**
 * Applied, noticed as you submit, as the background hears it from the script on a job site you
 * allowed: what you sent on each page, then how the page said it went. Factwright on this computer
 * stands in, through its helper, and the browser keeps what's kept for a session in memory.
 */
const browser = vi.hoisted(() => {
  const state = {
    items: {} as Record<string, unknown>,
    session: {} as Record<string, unknown>,
    asks: [] as Record<string, unknown>[],
    /** What the helper answers an ask, by its kind. */
    answers: {} as Record<string, unknown>,
    put: [] as { tabId: number; frameIds?: number[]; args?: unknown[] }[],
  };
  const store = (items: Record<string, unknown>) => ({
    get: async (key: string) => (key in items ? { [key]: structuredClone(items[key]) } : {}),
    set: async (more: Record<string, unknown>) => {
      Object.assign(items, structuredClone(more));
    },
    remove: async () => {},
  });
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: 'factwright',
      getURL: (path: string) => `chrome-extension://factwright/${path}`,
      sendMessage: async () => {},
      sendNativeMessage: async (_helper: string, message: { request: string }) => {
        const ask = JSON.parse(message.request) as Record<string, unknown>;
        state.asks.push(ask);
        return state.answers[ask.ask as string] ?? { ok: false, reason: 'failed' };
      },
    },
    permissions: { contains: async () => true },
    storage: { local: store(state.items), session: store(state.session) },
    tabs: { sendMessage: async () => Promise.reject(new Error('No script here.')) },
    scripting: {
      executeScript: async ({
        target,
        args,
      }: {
        target: { tabId: number; frameIds?: number[] };
        args?: unknown[];
      }) => {
        state.put.push({ tabId: target.tabId, frameIds: target.frameIds, args });
        return [{ frameId: 0 }];
      },
    },
  };
  return state;
});

import {
  forgetApplying,
  left,
  markFromPopup,
  outcome,
  submitted,
  undoApplied,
  waitingAt,
} from '../src/applied.ts';
import type { FillWay } from '../src/fill-way.ts';
import { forgetFill, keepFill, keptFill } from '../src/kept-fill.ts';
import { forgetNotes, noteFor, notesOn, showNote } from '../src/notes.ts';

const URL = 'https://larkspur.wd5.myworkdayjobs.com/en-US/careers/job/apply';
const PLACE = { tabId: 4, frameId: 0 };
const D1 = '5b2e7c1a-9d3f-4e8b-a6c0-7f1e2d3c4b5a';
const D2 = '6c3f8d2b-0e4a-4f9c-b7d1-8a2f3e4d5c6b';
const D3 = '7d4a9e3c-1f5b-4a0d-c8e2-9b3a4f5e6d7c';

const field = (ref: number, question: string, more: Partial<PageField> = {}): PageField => ({
  ref,
  key: `TEXTAREA|||${question}|${question}`,
  question,
  hint: '',
  section: '',
  control: 'long',
  type: '',
  autocomplete: '',
  name: question,
  options: [],
  required: false,
  limit: null,
  ...more,
});

const page = (step: string, fields: PageField[]): PageForm => ({
  url: URL,
  title: 'Senior Product Manager',
  fields,
  submitted: false,
  step,
  adders: [],
});

const JOB = {
  id: 'larkspur--senior-pm',
  company: 'Larkspur Energy',
  role: 'Senior Product Manager',
  status: 'new',
  appliedOn: null,
};

const plan = (replies: FieldReply[], job: typeof JOB | null = JOB): FillPlan => ({
  ok: true,
  did: 'fill',
  job,
  replies,
  files: { resume: null, 'cover-letter': null },
});

const WHY = field(0, 'Why do you want to work at Larkspur Energy?');
const EMAIL = field(1, 'Email', { control: 'text', type: 'email' });

beforeEach(async () => {
  // What the background keeps in its own memory, through sync, goes too.
  await Promise.all([
    forgetApplying(PLACE.tabId),
    forgetFill(PLACE.tabId),
    forgetNotes(PLACE.tabId),
  ]);
  for (const key of Object.keys(browser.session)) delete browser.session[key];
  browser.items.settings = { where: 'computer' };
  browser.asks.length = 0;
  browser.put.length = 0;
  browser.answers = {
    sent: { ok: true, did: 'sent', job: { ...JOB, status: 'applied' }, recorded: 1, marked: true },
    unsent: { ok: true, did: 'unsent', job: JOB, undone: true },
  };
});

/** Questions page, then Review, as Workday's application goes. */
async function sendTwoPages(job: typeof JOB | null = JOB) {
  await submitted({
    place: PLACE,
    doc: D1,
    form: page('Application Questions', [WHY, EMAIL]),
    plan: plan(
      [
        { kind: 'question', source: 'you', left: 'new' },
        { kind: 'email', text: 'ana@example.com', source: 'profile' },
      ],
      job,
    ),
    way: onComputer,
    values: [
      { ref: 0, key: WHY.key, value: 'Your grid work.' },
      { ref: 1, key: EMAIL.key, value: 'ana@example.com' },
    ],
    final: false,
  });
  await submitted({
    place: PLACE,
    doc: D1,
    form: page('Review', []),
    plan: plan([], job),
    way: onComputer,
    values: [],
    final: true,
  });
}

describe('applied, as you submit', () => {
  it('marks the job applied once the page says it went in, with what you sent on each page, once', async () => {
    await sendTwoPages();
    expect(browser.asks).toEqual([]);
    await outcome({ place: PLACE, doc: D2, submitted: true, form: false, errors: false });
    expect(browser.asks).toEqual([
      {
        ask: 'sent',
        job: JOB.id,
        url: URL,
        answers: [{ question: WHY.question, text: 'Your grid work.' }],
      },
    ]);
    // A note on the page says so, with Undo: put there by the background, as no script's there.
    const [note] = await notesOn(PLACE.tabId);
    expect(note?.says).toEqual({
      is: 'applied',
      job: 'Senior Product Manager at Larkspur Energy',
      undo: 'can',
    });
    expect(browser.put).toEqual([
      { tabId: PLACE.tabId, frameIds: [0], args: [note?.token, 400, 56, 120_000] },
    ]);
    // Heard again, it's marked once.
    await outcome({ place: PLACE, doc: D3, submitted: true, form: false, errors: false });
    expect(browser.asks).toHaveLength(1);
  });

  it('marks nothing while the page still shows the form, or what’s wrong with an answer', async () => {
    await sendTwoPages();
    await outcome({ place: PLACE, doc: D1, submitted: false, form: true, errors: true });
    await outcome({ place: PLACE, doc: D1, submitted: false, form: false, errors: true });
    expect(browser.asks).toEqual([]);
  });

  it('takes no words on a page that still shows the application as its having gone in, but for the submit that sends it', async () => {
    await submitted({
      place: PLACE,
      doc: D1,
      form: page('Application Questions', [WHY]),
      plan: plan([{ kind: 'question', source: 'you', left: 'new' }]),
      way: onComputer,
      values: [],
      final: false,
    });
    // Its next page, which says what happens "once your application has been submitted".
    await outcome({ place: PLACE, doc: D1, submitted: true, form: true, errors: false });
    expect(browser.asks).toEqual([]);
  });

  it('takes the page moving on, once it showed what’s wrong with an answer, as you leaving it', async () => {
    await submitted({
      place: PLACE,
      doc: D1,
      form: page('', [WHY]),
      plan: plan([{ kind: 'question', source: 'you', left: 'new' }]),
      way: onComputer,
      values: [],
      final: true,
    });
    await outcome({ place: PLACE, doc: D1, submitted: false, form: true, errors: true });
    await outcome({ place: PLACE, doc: D2, submitted: false, form: false, errors: false });
    await left(PLACE, D1);
    expect(browser.asks).toEqual([]);
  });

  it('marks it once the page says it went in, after it showed what was wrong a moment', async () => {
    await submitted({
      place: PLACE,
      doc: D1,
      form: page('', [WHY]),
      plan: plan([{ kind: 'question', source: 'you', left: 'new' }]),
      way: onComputer,
      values: [],
      final: true,
    });
    // As a page that says "Submitting…" in an alert, then that it went in.
    await outcome({ place: PLACE, doc: D1, submitted: false, form: true, errors: true });
    await outcome({ place: PLACE, doc: D1, submitted: true, form: false, errors: false });
    expect(browser.asks.map((ask) => ask.ask)).toEqual(['sent']);
  });

  it('marks a form on one page you sent once the page moves on, with no form left', async () => {
    await submitted({
      place: PLACE,
      doc: D1,
      form: page('', [WHY]),
      plan: plan([{ kind: 'question', source: 'you', left: 'new' }]),
      way: onComputer,
      values: [{ ref: 0, key: WHY.key, value: 'Your grid work.' }],
      final: true,
    });
    await outcome({ place: PLACE, doc: D1, submitted: false, form: false, errors: false });
    expect(browser.asks.map((ask) => ask.ask)).toEqual(['sent']);
  });

  it('marks it once the page you sent goes, and no page of a site it runs on says how it went', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      await submitted({
        place: PLACE,
        doc: D1,
        form: page('', [WHY]),
        plan: plan([{ kind: 'question', source: 'you', left: 'new' }]),
        way: onComputer,
        values: [],
        final: true,
      });
      await left(PLACE, D1);
      expect(browser.asks).toEqual([]);
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.waitFor(() => expect(browser.asks.map((ask) => ask.ask)).toEqual(['sent']));
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes a page you leave a while after its submit as one it didn’t take', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      await submitted({
        place: PLACE,
        doc: D1,
        form: page('', [WHY]),
        plan: plan([{ kind: 'question', source: 'you', left: 'new' }]),
        way: onComputer,
        values: [],
        final: true,
      });
      await vi.advanceTimersByTimeAsync(40_000);
      await left(PLACE, D1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(browser.asks).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes it back with Undo, and says where the job is now', async () => {
    await sendTwoPages();
    await outcome({ place: PLACE, doc: D2, submitted: true, form: false, errors: false });
    const [note] = await notesOn(PLACE.tabId);
    if (!note) throw new Error('No note.');
    expect(await undoApplied(note)).toEqual({
      is: 'applied',
      job: 'Senior Product Manager at Larkspur Energy',
      undo: 'undone',
      says: 'Not applied: Senior Product Manager at Larkspur Energy is back to New.',
    });
    expect(browser.asks.at(-1)).toEqual({ ask: 'unsent', job: JOB.id });
    // Its note says so from now on, and Undo again does nothing more.
    const now = await noteFor(PLACE.tabId, note.token);
    expect(now?.says).toMatchObject({ undo: 'undone' });
    await undoApplied(now ?? note);
    expect(browser.asks.filter((ask) => ask.ask === 'unsent')).toHaveLength(1);
  });

  it('says to update Factwright, where one from before Undo doesn’t know it', async () => {
    browser.answers.unsent = { ok: false, reason: 'bad-message', message: 'Not an ask.' };
    await sendTwoPages();
    await outcome({ place: PLACE, doc: D2, submitted: true, form: false, errors: false });
    const [note] = await notesOn(PLACE.tabId);
    expect(note && (await undoApplied(note))).toMatchObject({
      undo: 'cannot',
      says: expect.stringMatching(/^Update Factwright/),
    });
  });

  it('keeps what you sent for a job applied to before, with no Undo', async () => {
    // As you marked it yourself, since the page's answers were read.
    browser.answers.sent = { ok: true, did: 'sent', job: JOB, recorded: 1, marked: false };
    await submitted({
      place: PLACE,
      doc: D1,
      form: page('', [WHY]),
      plan: plan([{ kind: 'question', source: 'you', left: 'new' }], { ...JOB, status: 'screen' }),
      way: onComputer,
      values: [{ ref: 0, key: WHY.key, value: 'Your grid work.' }],
      final: true,
    });
    await outcome({ place: PLACE, doc: D1, submitted: true, form: false, errors: false });
    const [note] = await notesOn(PLACE.tabId);
    expect(note?.says).toMatchObject({
      is: 'applied',
      undo: 'cannot',
      says: 'Kept what you sent with Senior Product Manager at Larkspur Energy.',
    });
  });

  it('offers no Undo where Factwright from before Undo doesn’t say it marked the job', async () => {
    browser.answers.sent = { ok: true, did: 'sent', job: JOB, recorded: 1 };
    await sendTwoPages();
    await outcome({ place: PLACE, doc: D2, submitted: true, form: false, errors: false });
    const [note] = await notesOn(PLACE.tabId);
    expect(note?.says).toEqual({
      is: 'applied',
      job: 'Senior Product Manager at Larkspur Energy',
      undo: 'cannot',
    });
  });

  it('keeps what it read through sync in the background’s memory alone, never in the browser’s storage', async () => {
    const throughSync: FillWay = {
      via: 'sync',
      ask: async () => ({ ok: false, reason: 'failed', message: 'Not here.' }),
    };
    await submitted({
      place: PLACE,
      doc: D1,
      form: page('', [WHY]),
      plan: plan([{ kind: 'question', source: 'you', left: 'new' }]),
      way: throughSync,
      values: [{ ref: 0, key: WHY.key, value: 'Your grid work.' }],
      final: true,
    });
    await keepFill({
      tabId: PLACE.tabId,
      place: PLACE,
      via: 'sync',
      instead: false,
      form: page('', [WHY]),
      plan: plan([{ kind: 'email', text: 'ana@example.com', source: 'profile' }]),
      shows: { company: 'Larkspur Energy', role: 'Senior Product Manager' },
      filled: [],
      at: Date.now(),
    });
    const token = await showNote(
      PLACE,
      { is: 'applied', job: 'Senior Product Manager at Larkspur Energy', undo: 'can' },
      { via: 'sync' },
    );
    expect(await waitingAt(PLACE)).toBe(true);
    expect((await keptFill(PLACE.tabId))?.via).toBe('sync');
    expect(await noteFor(PLACE.tabId, token)).not.toBeNull();
    expect(JSON.stringify(browser.session)).not.toMatch(/Larkspur|grid work|ana@example/);
  });

  it('marks no job you haven’t saved: the note says to save it', async () => {
    await sendTwoPages(null);
    await outcome({ place: PLACE, doc: D2, submitted: true, form: false, errors: false });
    expect(browser.asks).toEqual([]);
    const [note] = await notesOn(PLACE.tabId);
    expect(note?.says).toMatchObject({
      is: 'problem',
      says: expect.stringMatching(/^You applied\?/),
    });
  });
});

describe('Mark as applied, from the popup', () => {
  it('sends what the form Fill filled holds now, where it’s still on the page', async () => {
    await keepFill({
      tabId: PLACE.tabId,
      place: PLACE,
      via: 'computer',
      instead: false,
      form: page('', [WHY]),
      plan: plan([{ kind: 'question', source: 'you', left: 'new' }]),
      shows: { company: 'Larkspur Energy', role: 'Senior Product Manager' },
      filled: [],
      at: Date.now(),
    });
    // The page, as the panel's own function reads it.
    const chrome = (globalThis as unknown as { chrome: { scripting: { executeScript: unknown } } })
      .chrome;
    const put = chrome.scripting.executeScript;
    chrome.scripting.executeScript = async ({ args }: { args?: { do: string }[] }) =>
      args?.[0]?.do === 'values'
        ? [
            {
              frameId: 0,
              result: {
                did: 'values',
                url: URL,
                submitted: false,
                values: [{ ref: 0, key: WHY.key, value: 'Your grid work.' }],
                step: '',
                fields: 1,
              },
            },
          ]
        : (put as (injection: unknown) => Promise<unknown>)({ target: PLACE, args });
    try {
      const said = await markFromPopup(PLACE.tabId, JOB, 'computer', URL);
      expect(said.says).toMatchObject({ is: 'applied', undo: 'can' });
      expect(browser.asks).toEqual([
        {
          ask: 'sent',
          job: JOB.id,
          url: URL,
          answers: [{ question: WHY.question, text: 'Your grid work.' }],
        },
      ]);
    } finally {
      chrome.scripting.executeScript = put;
    }
  });
});
