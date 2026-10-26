import { describe, expect, it } from 'vitest';
import { INBOX_JOB, readInboxAsk, readSavedJob } from './inbox.ts';

const job = {
  type: 'save',
  url: 'https://jobs.lever.co/harborpine/4f1c2b7e',
  site: 'jobs.lever.co',
  company: 'Harbor & Pine',
  role: 'Senior Product Manager, Data',
  pay: '$165k–$190k',
  posting: 'About the role\n\nLead the data platform’s roadmap.',
};

const read = (value: unknown) => readSavedJob(JSON.stringify(value));

describe('a job from the inbox', () => {
  it('reads a job, as the extension sends it, without its type', () => {
    const { type: _, ...fields } = job;
    expect(read(job)).toEqual(fields);
  });

  it('takes only a job: its six fields, each a string, and nothing else', () => {
    expect(readSavedJob('not JSON')).toBeNull();
    expect(read([job])).toBeNull();
    expect(read(null)).toBeNull();
    expect(read({ ...job, type: 'hello' })).toBeNull();
    expect(read({ ...job, cookies: 'session=1' })).toBeNull();
    expect(read({ ...job, pay: 165000 })).toBeNull();
    expect(read({ ...job, posting: { text: 'nested' } })).toBeNull();
    const { posting: _, ...noPosting } = job;
    expect(read(noPosting)).toBeNull();
  });

  it('takes only a link to a web page', () => {
    expect(read({ ...job, url: 'javascript:alert(1)' })).toBeNull();
    expect(read({ ...job, url: 'file:///etc/passwd' })).toBeNull();
    expect(read({ ...job, url: 'not a link' })).toBeNull();
    expect(read({ ...job, url: 'http://jobs.example.com/7' })?.url).toBe(
      'http://jobs.example.com/7',
    );
  });

  it('trims each field, and cuts it as Add job does', () => {
    const long = read({ ...job, company: `  ${'C'.repeat(500)}  `, posting: 'P'.repeat(200_000) });
    expect(long?.company).toBe('C'.repeat(200));
    expect(long?.posting).toHaveLength(100_000);
  });

  it('knows a waiting job by its file name', () => {
    expect(INBOX_JOB.test('1760745600000-3f9c2a7b1e4d5c6a.json')).toBe(true);
    expect(INBOX_JOB.test('.1760745600000-3f9c2a7b1e4d5c6a.tmp')).toBe(false);
    expect(INBOX_JOB.test('1760745600000-3f9c2a7b1e4d5c6a.done')).toBe(false);
    expect(INBOX_JOB.test('../1760745600000-3f9c2a7b1e4d5c6a.json')).toBe(false);
  });
});

describe('an ask from the inbox', () => {
  const field = {
    question: 'Email',
    hint: '',
    control: 'text',
    type: 'email',
    autocomplete: 'email',
    name: 'email',
    options: [],
    required: true,
    limit: null,
  };
  const fill = {
    ask: 'fill',
    url: 'https://job-boards.greenhouse.io/harborpine/jobs/4567890',
    title: 'Job Application for Account Executive at Harbor & Pine',
    company: 'Harbor & Pine',
    role: 'Account Executive',
    fields: [field],
  };
  /** An ask as the helper writes it: the extension's message, as it came. */
  const message = (request: unknown) =>
    JSON.stringify({ type: 'ask', request: JSON.stringify(request) });

  it('reads a form to fill, with its fields and nothing in them', () => {
    const parted = { ...fill, fields: [{ ...field, section: 'Contact details' }] };
    expect(readInboxAsk(message(parted))).toEqual(parted);
    // An extension from before it read the parts of a form sends none.
    expect(readInboxAsk(message(fill))).toEqual({ ...fill, fields: [{ ...field, section: '' }] });
  });

  it('reads asks for a part of a file, what was sent, and answers to keep', () => {
    const file = {
      ask: 'file',
      job: 'harbor-pine--account-executive',
      file: 'resume',
      version: '0f1e2d3c4b5a6978',
      part: 0,
    };
    expect(readInboxAsk(message(file))).toEqual(file);
    const sent = {
      ask: 'sent',
      job: 'harbor-pine--account-executive',
      url: fill.url,
      answers: [{ question: 'Why Harbor & Pine?', text: 'Gear that lasts.' }],
    };
    expect(readInboxAsk(message(sent))).toEqual(sent);
    const remember = { ask: 'remember', answers: [{ kind: 'phone', text: '(303) 555-0142' }] };
    expect(readInboxAsk(message(remember))).toEqual(remember);
  });

  it('reads an ask for drafts of a form’s own questions, and one for how they’re coming', () => {
    const draft = {
      ask: 'draft',
      job: 'harbor-pine--account-executive',
      url: fill.url,
      questions: [{ ...field, question: 'Why Harbor & Pine?', control: 'long', section: '' }],
    };
    expect(readInboxAsk(message(draft))).toEqual(draft);
    const drafts = { ask: 'drafts', job: 'harbor-pine--account-executive' };
    expect(readInboxAsk(message(drafts))).toEqual(drafts);
    expect(readInboxAsk(message({ ...draft, questions: [] }))).toBeNull();
    expect(readInboxAsk(message({ ...draft, questions: Array(51).fill(field) }))).toBeNull();
    expect(readInboxAsk(message({ ...draft, job: '../../etc' }))).toBeNull();
    expect(readInboxAsk(message({ ...draft, url: 'file:///etc/passwd' }))).toBeNull();
    expect(
      readInboxAsk(message({ ...draft, questions: [{ ...field, value: 'Gear that lasts.' }] })),
    ).toBeNull();
    expect(readInboxAsk(message({ ...drafts, answers: [] }))).toBeNull();
  });

  it('reads Undo for marking a job Applied, by the job alone', () => {
    const unsent = { ask: 'unsent', job: 'harbor-pine--account-executive' };
    expect(readInboxAsk(message(unsent))).toEqual(unsent);
    expect(readInboxAsk(message({ ...unsent, job: '../../etc' }))).toBeNull();
    // What sync needs to put back, which the app keeps in the job's history itself.
    expect(
      readInboxAsk(
        message({ ...unsent, undo: { line: 'a', row: { status: null, status_on: null } } }),
      ),
    ).toBeNull();
  });

  it('reads an ask for the job a page is for: its address, company and title, and no more', () => {
    const job = {
      ask: 'job',
      url: 'https://jobs.lever.co/harborpine/4f1c2b7e/apply',
      company: 'Harbor & Pine',
      role: 'Senior PM, Data',
    };
    expect(readInboxAsk(message(job))).toEqual(job);
    expect(readInboxAsk(message({ ...job, company: '', role: '' }))).toEqual({
      ...job,
      company: '',
      role: '',
    });
    expect(readInboxAsk(message({ ...job, url: 'javascript:alert(1)' }))).toBeNull();
    expect(readInboxAsk(message({ ...job, company: 'x'.repeat(201) }))).toBeNull();
    expect(readInboxAsk(message({ ...job, posting: 'About the role' }))).toBeNull();
    const { role: _, ...untitled } = job;
    expect(readInboxAsk(message(untitled))).toBeNull();
  });

  it('takes only an ask, as the helper passes it on', () => {
    expect(readInboxAsk('not JSON')).toBeNull();
    expect(
      readInboxAsk(JSON.stringify({ type: 'save', request: JSON.stringify(fill) })),
    ).toBeNull();
    expect(readInboxAsk(JSON.stringify({ type: 'ask', request: fill }))).toBeNull();
    expect(
      readInboxAsk(JSON.stringify({ type: 'ask', request: JSON.stringify(fill), more: '' })),
    ).toBeNull();
    expect(readInboxAsk(message('fill'))).toBeNull();
  });

  it('checks each kind of ask has its own fields, each as it should be, and no others', () => {
    expect(readInboxAsk(message({ ...fill, cookies: 'session=1' }))).toBeNull();
    expect(readInboxAsk(message({ ...fill, url: 'javascript:alert(1)' }))).toBeNull();
    expect(
      readInboxAsk(message({ ...fill, fields: [{ ...field, control: 'password' }] })),
    ).toBeNull();
    expect(
      readInboxAsk(message({ ...fill, fields: [{ ...field, value: 'ana@example.com' }] })),
    ).toEqual(
      // A field's value is never part of an ask: one that carries it isn't a field.
      null,
    );
    expect(readInboxAsk(message({ ...fill, fields: Array(301).fill(field) }))).toBeNull();
    expect(readInboxAsk(message({ ...fill, fields: [{ ...field, section: 3 }] }))).toBeNull();
    expect(
      readInboxAsk(message({ ...fill, fields: [{ ...field, section: 'x'.repeat(501) }] })),
    ).toBeNull();
    const file = {
      ask: 'file',
      job: 'harbor-pine--account-executive',
      file: 'resume',
      version: '0f1e2d3c4b5a6978',
      part: 0,
    };
    expect(readInboxAsk(message({ ...file, file: '../tracker.db' }))).toBeNull();
    expect(readInboxAsk(message({ ...file, job: '../../etc' }))).toBeNull();
    expect(readInboxAsk(message({ ...file, part: 30 }))).toBeNull();
    expect(readInboxAsk(message({ ...file, part: 1.5 }))).toBeNull();
    expect(readInboxAsk(message({ ...file, version: '../resume.pdf' }))).toBeNull();
    const { version: _, ...unversioned } = file;
    expect(readInboxAsk(message(unversioned))).toBeNull();
    expect(
      readInboxAsk(
        message({
          ask: 'sent',
          job: 'harbor-pine--account-executive',
          url: fill.url,
          answers: [{ question: 'Why?', text: 'Because.', field: 3 }],
        }),
      ),
    ).toBeNull();
  });
});
