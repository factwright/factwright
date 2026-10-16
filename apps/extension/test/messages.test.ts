import { describe, expect, it } from 'vitest';
import { askToSave, isSave } from '../src/messages.ts';
import type { JobToSave } from '../src/save.ts';

const JOB: JobToSave = {
  url: 'https://jobs.example.com/1',
  site: 'jobs.example.com',
  company: 'Fernway',
  role: 'Data Lead',
  pay: '',
  posting: 'Lead data.',
};

describe('asking the background to save', () => {
  it('takes only a save with every field a string', () => {
    expect(isSave({ type: 'save', job: JOB })).toBe(true);
    expect(isSave({ type: 'save', job: { ...JOB, posting: 42 } })).toBe(false);
    expect(isSave({ type: 'other', job: JOB })).toBe(false);
    expect(isSave(null)).toBe(false);
  });

  it('answers as a failed save when the background doesn’t, so the popup never waits forever', async () => {
    const failed = { ok: false, reason: 'failed' };
    expect(await askToSave(async () => undefined, JOB)).toMatchObject(failed);
    expect(
      await askToSave(async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }, JOB),
    ).toMatchObject(failed);
    const saved = { ok: true, id: 'fernway--data-lead', already: false, posting: 'saved' };
    expect(await askToSave(async () => saved, JOB)).toEqual(saved);
  });
});
