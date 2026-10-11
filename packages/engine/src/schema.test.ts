import { describe, expect, it } from 'vitest';
import { sampleResume } from './sample.ts';
import { readResume } from './schema.ts';

describe('readResume', () => {
  it('accepts a whole resume', () => {
    expect(readResume(sampleResume())).toEqual({ ok: true, resume: sampleResume() });
  });

  it('names each problem by where it is', () => {
    const resume: Record<string, unknown> = { ...sampleResume() };
    delete resume.headline;
    resume.summary = 42;
    resume.skills = 'TypeScript';
    resume.experience = [{ company: 'Tidewater', start: '2022', end: 'Now', bullet_groups: [{}] }];
    expect(readResume(resume)).toEqual({
      ok: false,
      problems: [
        'resume.headline is missing.',
        'resume.summary should be text.',
        'resume.experience[0].title is missing.',
        'resume.experience[0].bullet_groups[0].bullets is missing.',
        'resume.skills should be a list.',
      ],
    });
  });

  it('knows the layouts and formats', () => {
    expect(readResume({ ...sampleResume(), layout: 'fancy', format: 'rtf' })).toEqual({
      ok: false,
      problems: [
        'resume.layout should be timeline, executive, modern.',
        'resume.format should be pdf, docx, both.',
      ],
    });
    expect(readResume([])).toEqual({
      ok: false,
      problems: ['The resume should be a JSON object.'],
    });
  });
});
