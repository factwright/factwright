import { describe, expect, it } from 'vitest';
import { FONT_FILES } from './fonts.ts';
import { renderHtml } from './html.ts';
import { sampleResume } from './sample.ts';
import type { Resume } from './schema.ts';
import { builtInTemplate, TEMPLATES, type Template } from './templates.ts';

const classic = builtInTemplate('classic') as Template;
const minimal = builtInTemplate('minimal') as Template;

/** A made-up font, just its WOFF2 signature, as the app passes fonts. */
const FONT = 'data:font/woff2;base64,d09GMgABAAAA';

describe('renderHtml', () => {
  it.each(TEMPLATES)('lays out the whole resume in $name', (template) => {
    const html = renderHtml(sampleResume(), template);
    for (const text of [
      'Alex Rivera',
      'Staff Platform Engineer',
      'alex@example.com',
      '<strong>developer platforms</strong>',
      'Staff Engineer',
      'Tidewater Analytics — Data tools',
      '03/2022 – Present',
      '<span class="lead">Pipelines:</span> Cut deploy time by <strong>~40%</strong>.',
      'Tidy',
      'TypeScript · Go',
      'Platform Days 2025',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('@page{size:Letter');
  });

  it.each(TEMPLATES)('shows education in $name, first when the resume asks', (template) => {
    const resume: Resume = {
      ...sampleResume(),
      education: [
        {
          degree: 'B.S., Physics',
          school: 'Lakeside University',
          start: '2011',
          end: '2015',
          note: 'Magna cum laude',
        },
      ],
    };
    const html = renderHtml(resume, template);
    for (const text of [
      '<h2>Education</h2>',
      'B.S., Physics',
      'Lakeside University',
      '2011 – 2015',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('Magna cum laude');
    expect(html.indexOf('B.S., Physics')).toBeGreaterThan(html.indexOf('Staff Engineer'));
    const first = renderHtml({ ...resume, education_first: true }, template);
    expect(first.indexOf('B.S., Physics')).toBeLessThan(first.indexOf('Staff Engineer'));
  });

  it.each(TEMPLATES)('heads the projects and skills as the resume says in $name', (template) => {
    const plain = renderHtml(sampleResume(), template);
    expect(plain).toContain('>Independent Projects</h2>');
    const named = renderHtml(
      { ...sampleResume(), projects_heading: 'Volunteer Work', skills_heading: 'Clinical Skills' },
      template,
    );
    expect(named).toContain('>Volunteer Work</h2>');
    expect(named).toContain('>Clinical Skills</h2>');
    expect(named).not.toContain('Independent Projects');
  });

  it('heads the systems cards as the resume says, or plainly', () => {
    expect(renderHtml(sampleResume(), classic)).toContain(
      '<h2>Key Systems Built at Tidewater</h2>',
    );
    const plain = { ...sampleResume(), systems_heading: undefined };
    expect(renderHtml(plain, minimal)).toContain('<h2>Key Systems</h2>');
  });

  it('escapes what it shows, and marks placeholders', () => {
    const resume = {
      ...sampleResume(),
      headline: '<script>alert(1)</script>',
      summary: 'Led [[team size]] engineers.',
    };
    const html = renderHtml(resume, minimal);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<mark class="ph">[team size]</mark>');
  });

  it('loads nothing from anywhere else, carrying its fonts in the page', () => {
    const fonts = Object.fromEntries(FONT_FILES.map((file) => [file, FONT]));
    for (const template of TEMPLATES) {
      expect(renderHtml(sampleResume(), template)).not.toMatch(
        /<(script|link|img|iframe)\b|url\(/i,
      );
      const html = renderHtml(sampleResume(), template, fonts);
      expect(html).not.toMatch(/<(script|link|img|iframe)\b/i);
      const urls = [...html.matchAll(/url\(([^)]*)\)/g)].map(([, url]) => url);
      expect(urls.length).toBeGreaterThan(2);
      expect(new Set(urls)).toEqual(new Set([FONT]));
    }
  });

  it('tells the browser to run no scripts and load nothing from elsewhere', () => {
    expect(renderHtml(sampleResume(), classic)).toContain(
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'\">",
    );
  });

  it('shows a value inside an attribute’s quotes as plain text, which can’t end them', () => {
    const own: Template = {
      ...classic,
      body: '<div class="sum" data-text="{{summary}} ·">{{summary}}</div>',
      parts: {},
    };
    const html = renderHtml({ ...sampleResume(), summary: 'Led **[[n]]** "teams"' }, own);
    expect(html).toContain(
      '<div class="sum" data-text="Led [n] &quot;teams&quot; ·">Led <strong><mark class="ph">[n]</mark></strong> &quot;teams&quot;</div>',
    );
  });

  it('puts the bundled fonts first, ahead of the Windows fonts they stand in for', () => {
    expect(renderHtml(sampleResume(), classic)).toContain(
      'body{font-family:Caladea,Cambria,Georgia,serif;',
    );
    expect(renderHtml(sampleResume(), minimal)).toContain(
      'body{font-family:Selawik,"Factwright Sans","Segoe UI",Calibri,sans-serif;',
    );
  });

  it('lays out a resume in a template of the user’s own', () => {
    const own: Template = {
      ...classic,
      id: 'two-tone',
      css: '.name{color:#123456}',
      body: '<header>{{> top}}</header>{{#experience}}<p class="job">{{title}} at {{company_line}}</p>{{/experience}}',
      parts: { top: '<h1 class="name">{{name}}</h1>{{#tagline}}<p>{{tagline}}</p>{{/tagline}}' },
    };
    const html = renderHtml(sampleResume(), own);
    expect(html).toContain('.name{color:#123456}');
    expect(html).toContain(
      '<header><h1 class="name">Alex Rivera</h1><p>Platforms · Developer Tools · Reliability</p></header>',
    );
    expect(html).toContain('<p class="job">Staff Engineer at Tidewater Analytics — Data tools</p>');
  });
});
