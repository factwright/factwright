import { describe, expect, it } from 'vitest';
import { INBOX_JOB, readSavedJob } from './inbox.ts';

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
