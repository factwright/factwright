// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

/** The site's folder. Paths, since jsdom's URL isn't one Node's file reading accepts. */
const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Opens one of the site's pages in this test's document, without running its script. */
function open(page: string): Document {
  const parsed = new DOMParser().parseFromString(
    readFileSync(join(SITE, page), 'utf8'),
    'text/html',
  );
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
  return document;
}

/** Whether a file the page asks for, such as /templates/modern.webp, is in the site's public folder. */
const published = (path: string) => existsSync(join(SITE, 'public', path));

describe.each(['index.html', '404.html'])('%s', (page) => {
  it('passes an accessibility check', async () => {
    const doc = open(page);
    // jsdom can't lay out a page, so contrast is checked from the tokens in @factwright/ui.
    const results = await axe.run(doc, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });

  it('has one main heading, and never skips a heading level', () => {
    const doc = open(page);
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    let level = 0;
    for (const heading of doc.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const next = Number(heading.tagName[1]);
      expect(next, heading.textContent ?? '').toBeLessThanOrEqual(level + 1);
      level = next;
    }
  });

  it('links only to its own sections and the home page', () => {
    const doc = open(page);
    for (const link of doc.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') ?? '';
      if (href.startsWith('#')) expect(doc.getElementById(href.slice(1)), href).not.toBeNull();
      else expect(href).toBe('/');
    }
  });

  it('describes every picture, or hides it from screen readers', () => {
    const doc = open(page);
    for (const image of doc.querySelectorAll('img')) expect(image.hasAttribute('alt')).toBe(true);
    for (const svg of doc.querySelectorAll('svg')) {
      expect(svg.closest('[aria-hidden="true"]'), svg.outerHTML.slice(0, 80)).not.toBeNull();
    }
    for (const figure of doc.querySelectorAll('figure')) {
      expect(figure.querySelector('figcaption')?.textContent?.trim()).toBeTruthy();
    }
  });

  it('asks only for files the site publishes', () => {
    const doc = open(page);
    const paths = [
      ...[...doc.querySelectorAll('img[src], link[rel~="icon"], link[rel="apple-touch-icon"]')].map(
        (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
      ),
      ...[...doc.querySelectorAll('meta[property="og:image"]')].map((meta) =>
        new URL(meta.getAttribute('content') ?? '').pathname.toString(),
      ),
    ];
    for (const path of paths) expect(published(path), path).toBe(true);
  });

  it('says plainly that Factwright isn’t Anthropic’s', () => {
    const footer = open(page).querySelector('footer')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(footer).toContain('Factwright isn’t affiliated with Anthropic.');
    expect(footer).toContain('Claude and Claude Code are trademarks of Anthropic, PBC.');
  });
});

describe('the home page', () => {
  it('says whose Claude runs, and that runs count against its plan', () => {
    const footer = open('index.html').querySelector('footer')?.textContent?.replace(/\s+/g, ' ');
    expect(footer).toContain(
      'It uses your own Claude account, and its runs count against your plan.',
    );
  });

  it('shows the fact behind each resume line it offers', () => {
    const doc = open('index.html');
    const lines = [...doc.querySelectorAll<HTMLElement>('[data-fact]')];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(doc.querySelector(`[data-fact-card="${line.dataset.fact}"]`)).not.toBeNull();
    }
  });
});
