import { describe, expect, it } from 'vitest';
import { builtInTemplate, type Template } from '../templates.ts';
import { cssProblems, markupProblems } from './check.ts';
import { readTemplate, TEMPLATE_FILE, templateFile } from './file.ts';
import { parseTemplate } from './syntax.ts';

const classic = builtInTemplate('classic') as Template;

/** How long something takes, in milliseconds. */
function timed(work: () => unknown): number {
  const start = performance.now();
  work();
  return performance.now() - start;
}

describe('a template that tries to keep the app busy', () => {
  it('is checked in a moment, however big its pictures', () => {
    const css = `.a{background:url(data:image/png;base64,${'A'.repeat(1_490_000)})}`;
    let problems: string[] = [];
    expect(timed(() => (problems = cssProblems(css, 'css')))).toBeLessThan(2000);
    expect(problems).toEqual([]);
  });

  it('is read in a moment, however many tags or open braces it has', () => {
    const tags = '<div class="a" data-b="c"></div>'.repeat(3000);
    const read = parseTemplate(tags, 'body');
    expect(read.ok).toBe(true);
    expect(timed(() => read.ok && markupProblems(read.nodes, 'body'))).toBeLessThan(2000);
    let problems: string[] = [];
    expect(
      timed(() => {
        const open = parseTemplate('{{ '.repeat(30_000), 'body');
        problems = open.ok ? [] : open.problems;
      }),
    ).toBeLessThan(2000);
    expect(problems).toEqual(['body has a “{{” or “}}” that isn’t part of a tag.']);
  });

  it('can’t make a page that never ends, with parts that show each other over and over', () => {
    const parts = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `p${i}`,
        i < 39 ? `{{> p${i + 1}}}{{> p${i + 1}}}` : '·',
      ]),
    );
    const file = {
      ...JSON.parse(templateFile(classic)),
      ...TEMPLATE_FILE,
      body: '{{> p0}}',
      parts,
      letter: undefined,
    };
    let read: ReturnType<typeof readTemplate> | undefined;
    expect(timed(() => (read = readTemplate(file, 'doubles')))).toBeLessThan(5000);
    expect(read).toEqual({
      ok: false,
      problems: ['This template makes a page too long to print.'],
    });
    // Nor can a letter that shows them.
    const letter = { css: '', body: '{{> p0}}' };
    expect(
      timed(() => (read = readTemplate({ ...file, body: '·', letter }, 'doubles'))),
    ).toBeLessThan(5000);
    expect(read).toEqual({
      ok: false,
      problems: ['This template makes a page too long to print.'],
    });
  });
});
