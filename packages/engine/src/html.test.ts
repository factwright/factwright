import { describe, expect, it } from 'vitest';
import { FONT_FILES } from './fonts.ts';
import { renderHtml } from './html.ts';
import { sampleResume } from './sample.ts';
import { LAYOUTS } from './schema.ts';

/** A made-up font, just its WOFF2 signature, as the app passes fonts. */
const FONT = 'data:font/woff2;base64,d09GMgABAAAA';

describe('renderHtml', () => {
  it.each(LAYOUTS)('lays out the whole resume in %s', (layout) => {
    const html = renderHtml(sampleResume(), layout);
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

  it('heads the systems cards as the resume says, or plainly', () => {
    expect(renderHtml(sampleResume(), 'timeline')).toContain(
      '<h2>Key Systems Built at Tidewater</h2>',
    );
    const plain = { ...sampleResume(), systems_heading: undefined };
    expect(renderHtml(plain, 'executive')).toContain('<h2>Key Systems</h2>');
  });

  it('escapes what it shows, and marks placeholders', () => {
    const resume = {
      ...sampleResume(),
      headline: '<script>alert(1)</script>',
      summary: 'Led [[team size]] engineers.',
    };
    const html = renderHtml(resume, 'modern');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<mark class="ph">[team size]</mark>');
  });

  it('loads nothing from anywhere else, carrying its fonts in the page', () => {
    const fonts = Object.fromEntries(FONT_FILES.map((file) => [file, FONT]));
    for (const layout of LAYOUTS) {
      expect(renderHtml(sampleResume(), layout)).not.toMatch(/<(script|link|img|iframe)\b|url\(/i);
      const html = renderHtml(sampleResume(), layout, fonts);
      expect(html).not.toMatch(/<(script|link|img|iframe)\b/i);
      const urls = [...html.matchAll(/url\(([^)]*)\)/g)].map(([, url]) => url);
      expect(urls.length).toBeGreaterThan(2);
      expect(new Set(urls)).toEqual(new Set([FONT]));
    }
  });

  it('puts the bundled fonts first, ahead of the Windows fonts they stand in for', () => {
    expect(renderHtml(sampleResume(), 'executive')).toContain(
      'body{font-family:"Factwright Sans",Calibri,"Segoe UI",sans-serif;',
    );
    expect(renderHtml(sampleResume(), 'timeline')).toContain(
      '.name{font-family:Barlow,"Factwright Sans",Bahnschrift,"Segoe UI",sans-serif;',
    );
  });
});
