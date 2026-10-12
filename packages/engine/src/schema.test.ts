import { describe, expect, it } from 'vitest';
import { previewResume, sampleResume } from './sample.ts';
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

  it('checks education and the section headings', () => {
    expect(
      readResume({
        ...sampleResume(),
        education: [{ degree: 'B.A., History' }],
        education_first: 'yes',
        skills_heading: 3,
      }),
    ).toEqual({
      ok: false,
      problems: [
        'resume.education[0].school is missing.',
        'resume.education_first should be true or false.',
        'resume.skills_heading should be text.',
      ],
    });
  });

  it('accepts the resume every template is shown with', () => {
    expect(readResume(previewResume()).ok).toBe(true);
  });

  it('takes any template by its ID, and knows the formats', () => {
    for (const layout of ['classic', 'minimal', 'timeline', 'navy-sidebar-2']) {
      expect(readResume({ ...sampleResume(), layout }).ok).toBe(true);
    }
    expect(readResume({ ...sampleResume(), layout: 'Fancy One', format: 'rtf' })).toEqual({
      ok: false,
      problems: [
        'resume.layout should be a template’s ID, such as classic or minimal.',
        'resume.format should be pdf, docx, both.',
      ],
    });
    expect(readResume([])).toEqual({
      ok: false,
      problems: ['The resume should be a JSON object.'],
    });
  });
});
