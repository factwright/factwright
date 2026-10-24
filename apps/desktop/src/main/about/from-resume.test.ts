import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resumeDetails } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contactFromResume, newestResume, resumeOnFile } from './from-resume.ts';

let workspace: string;

/** A resume as Claude writes one, with only what a test sets. */
const resume = (name: string, more: Record<string, unknown> = {}) => ({
  name,
  headline: 'Product manager',
  summary: 'Ships data products.',
  contact: { email: `${name.split(' ')[0]?.toLowerCase()}@example.com`, location: 'Denver, CO' },
  experience: [
    {
      title: 'Senior Product Manager',
      company: 'Tidewater Analytics',
      start: '2021',
      end: 'Present',
    },
    { title: 'Product Manager', company: 'Fernway', start: '2018', end: '2021' },
  ],
  ...more,
});

/** Writes a resume, made a while ago, newer the higher `minutes` is. */
function write(path: string, value: unknown, minutes: number) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  const at = new Date(Date.UTC(2026, 9, 23, 12, minutes)).getTime() / 1000;
  utimesSync(path, at, at);
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factwright-from-resume-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('what the resumes say of you', () => {
  it('is nothing before Factwright has made a resume', async () => {
    expect(await newestResume(workspace)).toBeNull();
    expect(await contactFromResume(workspace)).toBeNull();
    expect(await resumeOnFile(workspace, 'nowhere')).toBeNull();
  });

  it('takes the newest resume, a job’s or a base one, passing over one that doesn’t hold up', async () => {
    write(join(workspace, 'base', 'startup-builder.json'), resume('Ana Old'), 1);
    write(join(workspace, 'applications', 'acme', 'resume.json'), resume('Ana Ruiz'), 5);
    write(join(workspace, 'applications', 'broken', 'resume.json'), '{"name": ', 9);
    expect((await newestResume(workspace))?.name).toBe('Ana Ruiz');
    expect(await contactFromResume(workspace)).toEqual({
      name: 'Ana Ruiz',
      email: 'ana@example.com',
      phone: '',
      location: 'Denver, CO',
      linkedin: '',
      website: '',
    });
  });

  it('takes the job’s own resume first, and says whose it is', async () => {
    write(join(workspace, 'applications', 'acme', 'resume.json'), resume('Ana Acme'), 1);
    write(join(workspace, 'base', 'startup-builder.json'), resume('Ana Base'), 9);
    expect(await resumeOnFile(workspace, 'acme')).toMatchObject({ from: 'job', name: 'Ana Acme' });
    expect(await resumeOnFile(workspace, 'globex')).toMatchObject({
      from: 'newest',
      name: 'Ana Base',
    });
  });

  it('says where you work now, your schools, skills and other sections', () => {
    expect(
      resumeDetails(
        {
          ...resume('Ana Ruiz'),
          education: [{ degree: 'B.S., Computer Science', school: 'CU Boulder', end: '2014' }],
          skills: [{ category: 'Data', items: ['SQL'] }],
          extra_sections: [{ heading: 'Certifications', items: ['CSPO'] }],
        } as never,
        'newest',
      ),
    ).toMatchObject({
      company: 'Tidewater Analytics',
      title: 'Senior Product Manager',
      since: '2021',
      education: [
        { school: 'CU Boulder', degree: 'B.S., Computer Science', start: '', end: '2014' },
      ],
      skills: [{ category: 'Data', items: ['SQL'] }],
      sections: [{ heading: 'Certifications', items: ['CSPO'] }],
      summary: 'Ships data products.',
    });
  });
});
