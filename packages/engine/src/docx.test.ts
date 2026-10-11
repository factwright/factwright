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
    expect(xml).toContain(layout === 'modern' ? 'Alex Rivera' : 'ALEX RIVERA');
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
