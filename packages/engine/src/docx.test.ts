import { type Document, Packer } from 'docx';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { letterDocument, resumeDocument } from './docx.ts';
import { sampleLetter, sampleResume } from './sample.ts';
import type { Resume } from './schema.ts';
import { builtInTemplate, TEMPLATES, type Template } from './templates.ts';

const classic = builtInTemplate('classic') as Template;
const minimal = builtInTemplate('minimal') as Template;

/** The text of a Word document's body, from its document.xml. */
async function xmlOf(document: Document): Promise<string> {
  const base64 = await Packer.toBase64String(document);
  const zip = await JSZip.loadAsync(base64, { base64: true });
  return (await zip.file('word/document.xml')?.async('string')) ?? '';
}

/** The text of a resume's Word document. */
const documentXml = (resume: Resume, template: Template) => xmlOf(resumeDocument(resume, template));

describe('resumeDocument', () => {
  it.each(TEMPLATES)('writes the whole resume as a Word file in $name', async (template) => {
    const xml = await documentXml(sampleResume(), template);
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
    expect(xml).toContain(template.word.nameCaps ? 'ALEX RIVERA' : 'Alex Rivera');
  });

  it.each(TEMPLATES)('writes education in $name, first when the resume asks', async (template) => {
    const resume: Resume = {
      ...sampleResume(),
      education: [{ degree: 'B.S., Physics', school: 'Lakeside University', end: '2015' }],
      skills_heading: 'Clinical Skills',
    };
    const xml = await documentXml(resume, template);
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
    const first = await documentXml({ ...resume, education_first: true }, template);
    expect(first.indexOf('B.S., Physics')).toBeLessThan(first.indexOf('Staff Engineer'));
  });

  it('bolds **text**, and highlights placeholders', async () => {
    const xml = await documentXml(
      { ...sampleResume(), summary: 'Led [[team size]] engineers.' },
      minimal,
    );
    expect(xml).toMatch(/<w:b\/>[\s\S]{0,200}?<w:t[^>]*>~40%<\/w:t>/);
    expect(xml).toMatch(
      /<w:highlight w:val="yellow"\/>[\s\S]{0,200}?<w:t[^>]*>\[team size\]<\/w:t>/,
    );
  });

  it('heads the systems plainly when the resume names no heading', async () => {
    const xml = await documentXml({ ...sampleResume(), systems_heading: undefined }, classic);
    expect(xml).toContain('>KEY SYSTEMS<');
  });

  it('takes its fonts, colors and section names from the template', async () => {
    const own: Template = {
      ...classic,
      titles: { ...classic.titles, experience: 'Work History' },
      word: { ...classic.word, head: 'Georgia', accent: '0A6E5C', nameCaps: false },
    };
    const xml = await documentXml(sampleResume(), own);
    expect(xml).toContain('WORK HISTORY');
    expect(xml).toContain('w:ascii="Georgia"');
    expect(xml).toContain('w:color w:val="0A6E5C"');
    expect(xml).toContain('>Alex Rivera<');
  });

  it('writes out letters typed as one character, such as “ﬁ”, in a resume and its letter', async () => {
    const resume: Resume = {
      ...sampleResume(),
      name: 'Alex Griﬃn',
      headline: 'Certiﬁed Planner',
      summary: 'The ﬁrst **ofﬁce** workﬂow.',
      impact_stats: [{ value: '5 ﬁrms', label: 'Staﬀ trained' }],
      systems_heading: 'Workﬂows',
      experience: sampleResume().experience.map((job) => ({
        ...job,
        bullet_groups: [{ heading: 'Staﬃng', bullets: [{ text: 'Aﬄuent clients.' }] }],
      })),
    };
    const plainName = { ...classic, word: { ...classic.word, nameCaps: false } };
    const letter = { ...sampleLetter(), paragraphs: ['The ﬁrst ofﬁce workﬂow.'] };
    const xml = [
      await documentXml(resume, plainName),
      await documentXml(resume, classic),
      await xmlOf(letterDocument(letter, minimal)),
    ];
    for (const each of xml) expect(each).not.toMatch(/[\uFB00-\uFB06]/);
    for (const text of [
      'Alex Griffin',
      'Certified Planner',
      '>office<',
      ' workflow.',
      '5 firms',
      'Staff trained',
      'WORKFLOWS',
      'STAFFING',
      'Affluent clients.',
    ]) {
      expect(xml[0]).toContain(text);
    }
    expect(xml[1]).toContain('ALEX GRIFFIN');
    expect(xml[2]).toContain('The first office workflow.');
  });
});
