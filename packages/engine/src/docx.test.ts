import { Packer } from 'docx';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { resumeDocument } from './docx.ts';
import { sampleResume } from './sample.ts';
import { LAYOUTS, type Resume } from './schema.ts';

/** The text of a Word document's body, from its document.xml. */
async function documentXml(resume: Resume, layout: (typeof LAYOUTS)[number]): Promise<string> {
  const base64 = await Packer.toBase64String(resumeDocument(resume, layout));
  const zip = await JSZip.loadAsync(base64, { base64: true });
  return (await zip.file('word/document.xml')?.async('string')) ?? '';
}

describe('resumeDocument', () => {
  it.each(LAYOUTS)('writes the whole resume as a Word file in %s', async (layout) => {
    const xml = await documentXml(sampleResume(), layout);
    for (const text of [
      'Staff Platform Engineer',
      'alex@example.com',
      'KEY SYSTEMS BUILT AT TIDEWATER',
      'Tidewater Analytics — Data tools',
      'Pipelines: ',
      'Cut deploy time by ',
      'Platform Days 2025',
    ]) {
      expect(xml).toContain(text);
    }
    const caps = ['timeline', 'executive', 'classic', 'banner'].includes(layout);
    expect(xml).toContain(caps ? 'ALEX RIVERA' : 'Alex Rivera');
  });

  it.each(LAYOUTS)('writes education in %s, first when the resume asks', async (layout) => {
    const resume: Resume = {
      ...sampleResume(),
      education: [{ degree: 'B.S., Physics', school: 'Lakeside University', end: '2015' }],
      skills_heading: 'Clinical Skills',
    };
    const xml = await documentXml(resume, layout);
    for (const text of [
      'EDUCATION',
      'B.S., Physics',
      'Lakeside University',
      '2015',
      'CLINICAL SKILLS',
    ]) {
      expect(xml).toContain(text);
    }
    expect(xml.indexOf('B.S., Physics')).toBeGreaterThan(xml.indexOf('Staff Engineer'));
    const first = await documentXml({ ...resume, education_first: true }, layout);
    expect(first.indexOf('B.S., Physics')).toBeLessThan(first.indexOf('Staff Engineer'));
  });

  it('bolds **text**, and highlights placeholders', async () => {
    const xml = await documentXml(
      { ...sampleResume(), summary: 'Led [[team size]] engineers.' },
      'timeline',
    );
    expect(xml).toMatch(/<w:b\/>[\s\S]{0,200}?<w:t[^>]*>~40%<\/w:t>/);
    expect(xml).toMatch(
      /<w:highlight w:val="yellow"\/>[\s\S]{0,200}?<w:t[^>]*>\[team size\]<\/w:t>/,
    );
  });

  it('heads the systems plainly when the resume names no heading', async () => {
    const xml = await documentXml({ ...sampleResume(), systems_heading: undefined }, 'executive');
    expect(xml).toContain('>KEY SYSTEMS<');
  });
});
