import type { FieldReply } from '@factwright/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowedFrames, JOB_SITES } from '../src/application-sites.ts';
import { MENU_ROWS } from '../src/frame-size.ts';
import { isFromFrame, isFromScript, isToScript } from '../src/job-site-messages.ts';
import {
  answerFrame,
  answerScript,
  forgetTab,
  keepsAnswer,
  menuAnswers,
  newAnswerFor,
  stopWhereNotAllowed,
} from '../src/on-job-sites.ts';
import type { PageField, PageForm } from '../src/page/form.ts';

/**
 * The browser and Factwright on this computer, as the background on the job sites sees them: the
 * sites you allowed, the helper, which answers asks as the app would, and what the background
 * tells the script in a tab.
 */
const browser = vi.hoisted(() => {
  const state = {
    items: {} as Record<string, unknown>,
    granted: new Set<string>(),
    asks: [] as Record<string, unknown>[],
    replies: [] as FieldReply[],
    told: [] as { tabId: number; message: Record<string, unknown>; frameId?: number }[],
    session: {} as Record<string, unknown>,
  };
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: 'factwright',
      getURL: (path: string) => `chrome-extension://factwright/${path}`,
      sendNativeMessage: async (_helper: string, message: { request: string }) => {
        const ask = JSON.parse(message.request) as Record<string, unknown>;
        state.asks.push(ask);
        if (ask.ask === 'fill') {
          return {
            ok: true,
            did: 'fill',
            job: null,
            replies: state.replies,
            files: { resume: null, 'cover-letter': null },
          };
        }
        if (ask.ask === 'remember') return { ok: true, did: 'remember', saved: 1 };
        return { ok: false, reason: 'failed' };
      },
    },
    permissions: {
      contains: async ({ origins, permissions }: { origins?: string[]; permissions?: string[] }) =>
        (permissions ?? []).every((each) => each === 'nativeMessaging') &&
        (origins ?? []).every((site) => state.granted.has(site)),
    },
    storage: {
      local: {
        get: async (key: string) =>
          key in state.items ? { [key]: structuredClone(state.items[key]) } : {},
        set: async (more: Record<string, unknown>) => {
          Object.assign(state.items, structuredClone(more));
        },
      },
      session: {
        get: async (key: string) =>
          key in state.session ? { [key]: structuredClone(state.session[key]) } : {},
        set: async (more: Record<string, unknown>) => {
          Object.assign(state.session, structuredClone(more));
        },
        remove: async () => {},
      },
    },
    tabs: {
      sendMessage: async (
        tabId: number,
        message: Record<string, unknown>,
        options?: { frameId?: number },
      ) => {
        state.told.push({ tabId, message, frameId: options?.frameId });
        return message.do === 'write' ? { filled: { ref: 0, ok: true, shown: 'x', why: '' } } : {};
      },
    },
  };
  return state;
});

const PAGE = 'https://jobs.lever.co/acme/7a1c9e40/apply';
const TAB = 7;
const TOKEN = '0f3c9a8e-4b1d-4c2e-9f6a-1a2b3c4d5e6f';
/** The script's own name for the page it's on. */
const DOC = '5b2e7c1a-9d3f-4e8b-a6c0-7f1e2d3c4b5a';
const hello = {
  type: 'job-site' as const,
  do: 'hello' as const,
  doc: DOC,
  around: [] as string[],
};

/** A field, as the page's form function reads one. */
const field = (ref: number, question: string, more: Partial<PageField> = {}): PageField => ({
  ref,
  key: `INPUT|text||${question}|${question}`,
  question,
  hint: '',
  section: '',
  control: 'text',
  type: 'text',
  autocomplete: '',
  name: question,
  options: [],
  required: false,
  limit: null,
  ...more,
});

const FORM: PageForm = {
  url: PAGE,
  title: 'Acme - Engineer',
  submitted: false,
  fields: [
    field(0, 'Full name'),
    field(1, 'Phone', { type: 'tel' }),
    field(2, 'Gender', { control: 'choice', type: 'radio', options: ['Female', 'Male'] }),
    field(3, 'Why Acme?', { control: 'long', type: '' }),
  ],
};

const REPLIES: FieldReply[] = [
  { kind: 'full-name', text: 'Ana María Ruiz', source: 'profile' },
  { kind: 'phone', text: '(303) 555-0142', source: 'profile' },
  { kind: 'gender', pick: ['Woman', 'Female'], source: 'profile' },
  { kind: 'question', source: 'you', left: 'new' },
];

const fromScript = { tabId: TAB, frameId: 0, url: PAGE, top: PAGE };
const fromFrame = { tab: { id: TAB, url: PAGE, windowId: 1 } };
const job = { company: 'Acme', role: 'Engineer' };

beforeEach(() => {
  forgetTab(TAB);
  for (const key of Object.keys(browser.session)) delete browser.session[key];
  for (const key of Object.keys(browser.items)) delete browser.items[key];
  browser.items.jobSites = { all: true, sites: [] };
  browser.granted = new Set(JOB_SITES);
  browser.asks.length = 0;
  browser.told.length = 0;
  browser.replies = REPLIES;
});

describe('what a field’s menu offers', () => {
  it('Factwright’s answer, and where it came from', () => {
    expect(menuAnswers(field(0, 'Full name'), REPLIES[0])).toEqual([
      {
        shown: { text: 'Ana María Ruiz', from: 'From Profile' },
        answer: { text: 'Ana María Ruiz' },
      },
    ]);
  });

  it('nothing for a field left for you, a file, a box to tick, or a password', () => {
    expect(menuAnswers(field(0, 'Why?'), { kind: 'question', source: 'you', left: 'new' })).toEqual(
      [],
    );
    expect(
      menuAnswers(field(0, 'Resume', { control: 'file' }), {
        kind: 'resume',
        file: 'resume',
        source: 'job',
      }),
    ).toEqual([]);
    expect(
      menuAnswers(field(0, 'I agree', { control: 'check' }), {
        kind: 'consent',
        source: 'you',
        left: 'consent',
      }),
    ).toEqual([]);
    expect(
      menuAnswers(field(0, 'Password', { type: 'password' }), {
        kind: 'email',
        text: 'ana@example.com',
        source: 'profile',
      }),
    ).toEqual([]);
  });

  it('nothing for an equal-opportunity question, whatever’s on file, which Fill answers as the panel does', () => {
    const gender = FORM.fields[2] as PageField;
    // Set in Profile, picked among its options by Fill: a menu showing only where you set one
    // would tell the site you had.
    expect(menuAnswers(gender, REPLIES[2])).toEqual([]);
    expect(
      menuAnswers(field(0, 'Your gender'), { kind: 'gender', text: 'Woman', source: 'profile' }),
    ).toEqual([]);
    expect(menuAnswers(gender, { kind: 'gender', source: 'you', left: 'sensitive' })).toEqual([]);
  });

  it('a choice in the form’s own words, and for a set of boxes, each one picking it ticks', () => {
    const pick = field(0, 'Will you need sponsorship?', {
      control: 'choice',
      type: 'radio',
      options: ['Yes, now', 'No, never'],
    });
    expect(
      menuAnswers(pick, { kind: 'sponsorship', pick: ['No'], source: 'profile' })[0]?.shown,
    ).toEqual({ text: 'No, never', from: 'From Profile' });
    const tools = field(0, 'Which tools do you use?', {
      control: 'choices',
      type: 'checkbox',
      options: ['SQL', 'Python', 'Excel'],
    });
    const drafted: FieldReply = {
      kind: 'question',
      pick: ['SQL', 'Python'],
      exact: true,
      source: 'claude',
      from: 'Your Claude’s draft for this job',
    };
    expect(menuAnswers(tools, drafted)).toEqual([
      {
        shown: { text: 'SQL, Python', from: 'Your Claude’s draft for this job' },
        answer: { pick: ['SQL', 'Python'], exact: true },
      },
    ]);
  });

  it('a choice only as one of its own options', () => {
    const pick = field(0, 'Sponsorship', {
      control: 'choice',
      type: 'radio',
      options: ['Yes', 'No'],
    });
    expect(menuAnswers(pick, { kind: 'sponsorship', pick: ['Maybe'], source: 'profile' })).toEqual(
      [],
    );
    expect(menuAnswers(pick, { kind: 'sponsorship', text: 'No', source: 'profile' })).toEqual([]);
  });

  it('every answer on file that fits, each with where it came from, once each', () => {
    const asked = field(0, 'Why do you want this job?', { control: 'long', type: '' });
    const reply: FieldReply = {
      kind: 'question',
      text: 'I build data products.',
      source: 'sent',
      from: 'From your Northwind application, Oct 12',
      others: [
        { text: 'I build data products.', source: 'sent', from: 'From your Fernway application' },
        { text: 'A draft.', source: 'claude', from: 'Your Claude’s draft for this job' },
        ...Array.from({ length: 6 }, (_, at) => ({
          text: `Another, ${at}`,
          source: 'sent' as const,
          from: `From your application ${at}`,
        })),
      ],
    };
    const offered = menuAnswers(asked, reply);
    expect(offered.slice(0, 2).map((each) => each.shown)).toEqual([
      { text: 'I build data products.', from: 'From your Northwind application, Oct 12' },
      { text: 'A draft.', from: 'Your Claude’s draft for this job' },
    ]);
    expect(offered).toHaveLength(MENU_ROWS);
  });
});

describe('what you give a field, offered to keep', () => {
  it('only for a field whose answer Profile keeps, never an equal-opportunity one', () => {
    expect(keepsAnswer(FORM.fields[1] as PageField, REPLIES[1])).toBe(true);
    // The panel offers that one when you mark the job applied, out of the site's sight.
    expect(keepsAnswer(FORM.fields[2] as PageField, REPLIES[2])).toBe(false);
    expect(keepsAnswer(field(0, 'Your gender'), { kind: 'gender', source: 'you' })).toBe(false);
    expect(keepsAnswer(FORM.fields[3] as PageField, REPLIES[3])).toBe(false);
    expect(keepsAnswer(field(0, 'Name'), REPLIES[0])).toBe(false);
    expect(
      keepsAnswer(field(0, 'Phone', { type: 'password' }), { kind: 'phone', source: 'profile' }),
    ).toBe(false);
  });

  it('only when it’s new, and kept on this computer alone where Profile keeps it there', () => {
    expect(newAnswerFor(FORM, 1, REPLIES[1], '(303) 555-0142')).toBeNull();
    expect(newAnswerFor(FORM, 1, REPLIES[1], '(720) 555-0123')).toMatchObject({
      kind: 'phone',
      text: '(720) 555-0123',
      private: false,
      question: 'Phone',
    });
    expect(newAnswerFor(FORM, 1, REPLIES[1], 'x'.repeat(201))).toBeNull();
    expect(newAnswerFor(FORM, 3, REPLIES[3], 'Because.')).toBeNull();
    expect(
      newAnswerFor(FORM, 2, { kind: 'gender', source: 'you', left: 'sensitive' }, 'Female'),
    ).toBeNull();
    const street: PageForm = { ...FORM, fields: [field(0, 'Street address')] };
    expect(
      newAnswerFor(street, 0, { kind: 'street', source: 'you', left: 'unset' }, '1420 Larimer St'),
    ).toMatchObject({ kind: 'street', text: '1420 Larimer St', private: true });
  });
});

describe('the script and the frame, as the background answers them', () => {
  it('is told to stop on a site you didn’t allow, or LinkedIn, whatever the browser allows', async () => {
    browser.items.jobSites = { all: false, sites: [] };
    expect(await answerScript(hello, fromScript)).toEqual({ allowed: false });
    browser.items.jobSites = { all: true, sites: [] };
    browser.granted.add('https://*.linkedin.com/*');
    const linkedIn = {
      tabId: TAB,
      frameId: 0,
      url: 'https://www.linkedin.com/jobs/view/1/apply',
      top: 'https://www.linkedin.com/jobs/view/1/apply',
    };
    expect(await answerScript(hello, linkedIn)).toEqual({ allowed: false });
    expect(await answerScript({ type: 'job-site', do: 'form', form: FORM, job }, linkedIn)).toEqual(
      { stop: true },
    );
    expect(browser.asks).toEqual([]);
  });

  it('asks Factwright about the form’s fields, never what’s in them, and only the page’s own', async () => {
    const said = await answerScript({ type: 'job-site', do: 'form', form: FORM, job }, fromScript);
    expect(said).toEqual({
      menus: [
        { ref: 0, key: FORM.fields[0]?.key, answers: 1, keeps: false },
        { ref: 1, key: FORM.fields[1]?.key, answers: 1, keeps: true },
        { ref: 2, key: FORM.fields[2]?.key, answers: 0, keeps: false },
        { ref: 3, key: FORM.fields[3]?.key, answers: 0, keeps: false },
      ],
    });
    expect(browser.asks).toHaveLength(1);
    expect(browser.asks[0]).toMatchObject({ ask: 'fill', url: PAGE });
    const fields = (browser.asks[0]?.fields ?? []) as Record<string, unknown>[];
    expect(fields).toHaveLength(FORM.fields.length);
    for (const asked of fields) {
      expect(Object.keys(asked)).not.toContain('value');
      expect(Object.keys(asked)).not.toContain('ref');
    }
    // Asked again for the same fields, it has them.
    await answerScript({ type: 'job-site', do: 'form', form: FORM, job }, fromScript);
    expect(browser.asks).toHaveLength(1);
    // A form from another page than the one the script is on isn't asked about.
    const elsewhere = { ...FORM, url: 'https://jobs.lever.co/other/1/apply' };
    expect(
      await answerScript({ type: 'job-site', do: 'form', form: elsewhere, job }, fromScript),
    ).toEqual({ menus: null });
  });

  it('shows a menu’s answers in the frame alone, and writes nothing until you pick one', async () => {
    await answerScript({ type: 'job-site', do: 'form', form: FORM, job }, fromScript);
    const ref = 0;
    const key = FORM.fields[0]?.key as string;
    expect(
      await answerScript(
        { type: 'job-site', do: 'menu', ref, key, token: TOKEN, answers: true, save: false },
        fromScript,
      ),
    ).toEqual({ answers: 1, save: false });
    // The script hears how many, never what: the frame asks for them.
    expect(await answerFrame({ type: 'job-site', do: 'shows', token: TOKEN }, fromFrame)).toEqual({
      question: 'Full name',
      answers: [{ text: 'Ana María Ruiz', from: 'From Profile' }],
      save: null,
    });
    // Only this tab's frame, by this menu's token.
    const other = { tab: { id: 8, url: PAGE, windowId: 1 } };
    expect(await answerFrame({ type: 'job-site', do: 'shows', token: TOKEN }, other)).toBeNull();
    expect(
      await answerFrame(
        { type: 'job-site', do: 'shows', token: '11111111-2222-3333-4444-555555555555' },
        fromFrame,
      ),
    ).toBeNull();
    expect(browser.told).toEqual([]);
    expect(
      await answerFrame({ type: 'job-site', do: 'pick', token: TOKEN, at: 0 }, fromFrame),
    ).toEqual({ ok: true });
    expect(browser.told).toEqual([
      {
        tabId: TAB,
        frameId: 0,
        message: {
          type: 'job-site',
          do: 'write',
          answer: { ref, key, text: 'Ana María Ruiz' },
        },
      },
    ]);
    // Picked, the menu's gone.
    expect(
      await answerFrame({ type: 'job-site', do: 'shows', token: TOKEN }, fromFrame),
    ).toBeNull();
  });

  it('offers a new answer you gave, and keeps it in Profile only once you choose Save', async () => {
    await answerScript({ type: 'job-site', do: 'form', form: FORM, job }, fromScript);
    const phone = FORM.fields[1] as PageField;
    expect(
      await answerScript(
        { type: 'job-site', do: 'left', ref: 1, key: phone.key, value: '(720) 555-0123' },
        fromScript,
      ),
    ).toEqual({ offer: true });
    // A menu without room for it leaves it for the next.
    await answerScript(
      {
        type: 'job-site',
        do: 'menu',
        ref: 0,
        key: FORM.fields[0]?.key as string,
        token: TOKEN,
        answers: true,
        save: false,
      },
      fromScript,
    );
    expect(
      (await answerFrame({ type: 'job-site', do: 'shows', token: TOKEN }, fromFrame)) as {
        save: unknown;
      },
    ).toMatchObject({ save: null });
    await answerScript(
      {
        type: 'job-site',
        do: 'menu',
        ref: 1,
        key: phone.key,
        token: TOKEN,
        answers: false,
        save: true,
      },
      fromScript,
    );
    expect(await answerFrame({ type: 'job-site', do: 'shows', token: TOKEN }, fromFrame)).toEqual({
      question: 'Phone',
      answers: [],
      save: { question: 'Phone', text: '(720) 555-0123', private: false },
    });
    expect(browser.asks.filter((ask) => ask.ask === 'remember')).toEqual([]);
    expect(await answerFrame({ type: 'job-site', do: 'save', token: TOKEN }, fromFrame)).toEqual({
      ok: true,
    });
    expect(browser.asks.filter((ask) => ask.ask === 'remember')).toEqual([
      { ask: 'remember', answers: [{ kind: 'phone', text: '(720) 555-0123' }] },
    ]);
    // It's offered once a page.
    expect(
      await answerScript(
        { type: 'job-site', do: 'left', ref: 1, key: phone.key, value: '(720) 555-0124' },
        fromScript,
      ),
    ).toEqual({ offer: false });
  });

  it('closes the menu with Escape or Not now, and offers that answer no more', async () => {
    await answerScript({ type: 'job-site', do: 'form', form: FORM, job }, fromScript);
    const phone = FORM.fields[1] as PageField;
    await answerScript(
      { type: 'job-site', do: 'left', ref: 1, key: phone.key, value: '(720) 555-0123' },
      fromScript,
    );
    await answerScript(
      {
        type: 'job-site',
        do: 'menu',
        ref: 1,
        key: phone.key,
        token: TOKEN,
        answers: true,
        save: true,
      },
      fromScript,
    );
    await answerFrame({ type: 'job-site', do: 'dismiss', token: TOKEN, refocus: true }, fromFrame);
    expect(browser.told).toEqual([
      { tabId: TAB, frameId: 0, message: { type: 'job-site', do: 'close', refocus: true } },
    ]);
    expect(
      await answerScript(
        { type: 'job-site', do: 'left', ref: 1, key: phone.key, value: '(720) 555-0199' },
        fromScript,
      ),
    ).toEqual({ offer: false });
  });

  it('asks the script to read the form again once the background has forgotten it', async () => {
    expect(
      await answerScript(
        {
          type: 'job-site',
          do: 'menu',
          ref: 0,
          key: 'x',
          token: TOKEN,
          answers: true,
          save: false,
        },
        fromScript,
      ),
    ).toEqual({ again: true });
  });
});

describe('a form in a frame, as a company’s careers page shows an applicant system’s', () => {
  /** The script in a frame of a careers page you didn't allow, on Lever's site, which you did. */
  const inFrame = { tabId: TAB, frameId: 3, url: PAGE, top: '' };
  const careers = ['https://careers.example.com'];

  it('says hello from the frame of a site you allowed, which the panel can then find', async () => {
    expect(await answerScript({ ...hello, around: careers }, inFrame)).toEqual({ allowed: true });
    expect(await allowedFrames(TAB)).toEqual([{ frameId: 3, url: PAGE, doc: DOC }]);
    // Its page going, it's forgotten, but not the page it shows since, by its own name.
    const next = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
    await answerScript({ ...hello, doc: next }, inFrame);
    await answerScript({ type: 'job-site', do: 'bye', doc: DOC }, inFrame);
    expect(await allowedFrames(TAB)).toEqual([{ frameId: 3, url: PAGE, doc: next }]);
    await answerScript({ type: 'job-site', do: 'bye', doc: next }, inFrame);
    expect(await allowedFrames(TAB)).toEqual([]);
  });

  it('is told to stop in a page of LinkedIn’s or Indeed’s, as the browser or Chrome’s frame says', async () => {
    const underLinkedIn = { ...inFrame, top: 'https://www.linkedin.com/jobs/view/1' };
    expect(await answerScript(hello, underLinkedIn)).toEqual({ allowed: false });
    expect(await answerScript({ ...hello, around: ['https://www.indeed.com'] }, inFrame)).toEqual({
      allowed: false,
    });
    expect(await allowedFrames(TAB)).toEqual([]);
  });

  it('keeps each frame’s form and menu apart, and writes your pick in its own frame', async () => {
    await answerScript({ ...hello, around: careers }, inFrame);
    await answerScript({ type: 'job-site', do: 'form', form: FORM, job }, inFrame);
    const key = FORM.fields[0]?.key as string;
    // The tab's own page has no form the background knows of.
    expect(
      await answerScript(
        { type: 'job-site', do: 'menu', ref: 0, key, token: TOKEN, answers: true, save: false },
        fromScript,
      ),
    ).toEqual({ again: true });
    expect(
      await answerScript(
        { type: 'job-site', do: 'menu', ref: 0, key, token: TOKEN, answers: true, save: false },
        inFrame,
      ),
    ).toEqual({ answers: 1, save: false });
    expect(
      await answerFrame({ type: 'job-site', do: 'pick', token: TOKEN, at: 0 }, fromFrame),
    ).toEqual({ ok: true });
    expect(browser.told).toEqual([
      {
        tabId: TAB,
        frameId: 3,
        message: { type: 'job-site', do: 'write', answer: { ref: 0, key, text: 'Ana María Ruiz' } },
      },
    ]);
  });

  it('takes the Fill button’s clicks by its script’s name for its page, from its own tab alone', async () => {
    await answerScript({ ...hello, around: careers }, inFrame);
    expect(
      await answerFrame({ type: 'job-site', do: 'hide-button', token: TOKEN }, fromFrame),
    ).toBeNull();
    expect(
      await answerFrame(
        { type: 'job-site', do: 'hide-button', token: DOC },
        { tab: { id: 8, url: PAGE, windowId: 1 } },
      ),
    ).toBeNull();
    expect(browser.told).toEqual([]);
    expect(
      await answerFrame({ type: 'job-site', do: 'hide-button', token: DOC }, fromFrame),
    ).toEqual({});
    expect(browser.told).toEqual([
      { tabId: TAB, frameId: 3, message: { type: 'job-site', do: 'hide-button' } },
    ]);
  });

  it('finds the Fill button’s script once the background has started again, as the browser keeps it', async () => {
    await answerScript({ ...hello, around: careers }, inFrame);
    // The background, idle a while, starts again with nothing in its memory.
    vi.resetModules();
    const again = await import('../src/on-job-sites.ts');
    expect(
      await again.answerFrame({ type: 'job-site', do: 'hide-button', token: DOC }, fromFrame),
    ).toEqual({});
    expect(browser.told).toEqual([
      { tabId: TAB, frameId: 3, message: { type: 'job-site', do: 'hide-button' } },
    ]);
  });

  it('tells each frame’s script to stop once its site isn’t allowed', async () => {
    await answerScript({ ...hello, around: careers }, inFrame);
    browser.items.jobSites = { all: false, sites: [] };
    await stopWhereNotAllowed();
    expect(browser.told).toEqual([
      { tabId: TAB, frameId: 3, message: { type: 'job-site', do: 'stop' } },
    ]);
  });
});

describe('each message, checked', () => {
  it('takes only what the script sends, as it sends it', () => {
    expect(isFromScript(hello)).toBe(true);
    expect(isFromScript({ ...hello, around: ['https://careers.example.com'] })).toBe(true);
    expect(isFromScript({ type: 'job-site', do: 'bye', doc: DOC })).toBe(true);
    expect(isFromScript({ type: 'job-site', do: 'form', form: FORM, job })).toBe(true);
    for (const bad of [
      null,
      { type: 'save', do: 'hello' },
      { type: 'job-site', do: 'write' },
      { type: 'job-site', do: 'form', form: { ...FORM, fields: 'all' }, job },
      {
        type: 'job-site',
        do: 'form',
        form: { ...FORM, fields: [{ ...FORM.fields[0], ref: 5 }] },
        job,
      },
      {
        type: 'job-site',
        do: 'form',
        form: { ...FORM, fields: Array.from({ length: 301 }, (_, at) => field(at, 'Q')) },
        job,
      },
      { type: 'job-site', do: 'menu', ref: 0, key: 'k', token: 'guess', answers: true, save: true },
      { type: 'job-site', do: 'left', ref: -1, key: 'k', value: 'x' },
      { type: 'job-site', do: 'left', ref: 0, key: 'k', value: 'x'.repeat(10_001) },
      { type: 'job-site', do: 'hello' },
      { ...hello, doc: 'mine' },
      { ...hello, around: 'https://careers.example.com' },
      { ...hello, around: Array.from({ length: 21 }, () => 'https://careers.example.com') },
      { type: 'job-site', do: 'bye' },
    ]) {
      expect(isFromScript(bad)).toBe(false);
    }
  });

  it('takes only what the frame sends, and the background only what it sends the script', () => {
    expect(isFromFrame({ type: 'job-site', do: 'pick', token: TOKEN, at: 1 })).toBe(true);
    expect(isFromFrame({ type: 'job-site', do: 'pick', token: TOKEN, at: '1' })).toBe(false);
    expect(isFromFrame({ type: 'job-site', do: 'dismiss', token: TOKEN })).toBe(false);
    expect(isFromFrame({ type: 'job-site', do: 'fill', token: DOC })).toBe(true);
    expect(isFromFrame({ type: 'job-site', do: 'fill' })).toBe(false);
    expect(isFromFrame({ type: 'job-site', do: 'hide-button', token: 'guess' })).toBe(false);
    expect(isFromFrame({ type: 'job-site', do: 'write', answer: {} })).toBe(false);
    expect(
      isToScript({ type: 'job-site', do: 'write', answer: { ref: 0, key: 'k', text: 'x' } }),
    ).toBe(true);
    expect(isToScript({ type: 'job-site', do: 'write', answer: { key: 'k' } })).toBe(false);
    expect(isToScript({ type: 'job-site', do: 'hello' })).toBe(false);
  });
});
