import { describe, expect, it } from 'vitest';
import { Html, isShown, type Node, parseTemplate, renderNodes, type Value } from './syntax.ts';

function render(source: string, view: Value, parts: Record<string, string> = {}): string {
  const parse = (text: string): Node[] => {
    const read = parseTemplate(text, 'test');
    if (!read.ok) throw new Error(read.problems.join(' '));
    return read.nodes;
  };
  const parsed = new Map(Object.entries(parts).map(([name, text]) => [name, parse(text)]));
  return renderNodes(parse(source), [view], parsed);
}

const problems = (source: string) => {
  const read = parseTemplate(source, 'body');
  return read.ok ? [] : read.problems;
};

describe('parseTemplate', () => {
  it('reads values, sections, inverted sections, parts and comments', () => {
    expect(
      parseTemplate(
        '<b>{{name}}</b>{{#jobs}}{{title}}{{/jobs}}{{^jobs}}none{{/jobs}}{{> top}}{{! note }}',
        'body',
      ),
    ).toEqual({
      ok: true,
      nodes: [
        { kind: 'text', text: '<b>' },
        { kind: 'value', name: 'name' },
        { kind: 'text', text: '</b>' },
        {
          kind: 'section',
          name: 'jobs',
          inverted: false,
          nodes: [{ kind: 'value', name: 'title' }],
        },
        { kind: 'section', name: 'jobs', inverted: true, nodes: [{ kind: 'text', text: 'none' }] },
        { kind: 'part', name: 'top' },
      ],
    });
  });

  it('refuses markup that isn’t made safe, and other delimiters', () => {
    expect(problems('{{{summary}}}')).toEqual([
      'body: {{{summary}} isn’t allowed. Write {{name}}: every value is made safe.',
    ]);
    expect(problems('{{& summary}}')[0]).toContain('isn’t allowed');
    expect(problems('{{=<% %>=}}')).toEqual(['body: the delimiters can’t change. Keep {{ and }}.']);
  });

  it('says which sections don’t close, or close out of turn', () => {
    expect(problems('{{#jobs}}{{#groups}}{{/jobs}}')).toEqual([
      'body: {{/jobs}} closes {{#groups}}. Close the inner one first.',
      'body: {{#jobs}} is never closed.',
    ]);
    expect(problems('{{/jobs}}')).toEqual(['body: {{/jobs}} closes a section that isn’t open.']);
  });

  it('refuses names that aren’t names', () => {
    expect(problems('{{Name}}{{a..b}}{{> ../x}}')).toEqual([
      'body: {{Name}} doesn’t name a value. Names are like name or titles.summary.',
      'body: {{a..b}} doesn’t name a value. Names are like name or titles.summary.',
      'body: “../x” isn’t a part’s name.',
    ]);
    expect(problems('a }} b')).toEqual(['body has a “{{” or “}}” that isn’t part of a tag.']);
  });
});

describe('renderNodes', () => {
  it('escapes text, and shows the engine’s own markup as it is', () => {
    expect(
      render('<p>{{a}} {{b}}</p>', { a: '<i>"x" & y</i>', b: new Html('<strong>z</strong>') }),
    ).toBe('<p>&lt;i&gt;&quot;x&quot; &amp; y&lt;/i&gt; <strong>z</strong></p>');
  });

  it('repeats a section for each item in a list, and looks up from the inside out', () => {
    const view = {
      name: 'Alex',
      jobs: [{ title: 'Lead' }, { title: 'Dev', name: 'Co' }],
    };
    expect(render('{{#jobs}}[{{title}} {{name}}]{{/jobs}}', view)).toBe('[Lead Alex][Dev Co]');
  });

  it('shows a section once for a value, and an inverted one for nothing', () => {
    const view = { tagline: 'Hi', none: new Html(''), zero: 0, list: [], yes: true };
    expect(render('{{#tagline}}<i>{{tagline}}</i>{{/tagline}}', view)).toBe('<i>Hi</i>');
    expect(
      render(
        '{{#none}}x{{/none}}{{#zero}}x{{/zero}}{{#list}}x{{/list}}{{#missing}}x{{/missing}}',
        view,
      ),
    ).toBe('');
    expect(render('{{^none}}a{{/none}}{{^list}}b{{/list}}{{^yes}}c{{/yes}}', view)).toBe('ab');
  });

  it('follows dotted names, such as a list’s length, and shows the item itself as .', () => {
    const view = { titles: { summary: 'Profile' }, stats: ['a', 'b', 'c'] };
    expect(render('{{titles.summary}} {{stats.length}} {{#stats}}{{.}}{{/stats}}', view)).toBe(
      'Profile 3 abc',
    );
    expect(render('{{titles.missing}}{{nothing.here}}', view)).toBe('');
  });

  it('looks only at the view’s own names, never what every object has', () => {
    expect(
      render(
        '{{constructor}}{{__proto__}}{{#constructor}}x{{/constructor}}{{#a}}{{constructor}}{{/a}}',
        { a: 1 },
      ),
    ).toBe('');
    expect(render('{{#item}}{{html}}{{/item}}', { item: new Html('<b>x</b>') })).toBe('');
  });

  it('shows parts by name, with the same values', () => {
    expect(
      render(
        '{{#jobs}}{{> job}}{{/jobs}}',
        { jobs: [{ title: 'A' }, { title: 'B' }] },
        { job: '<li>{{title}}</li>' },
      ),
    ).toBe('<li>A</li><li>B</li>');
  });

  it('shows yes, no, lists and groups as nothing', () => {
    expect(render('{{a}}{{b}}{{c}}{{d}}', { a: true, b: false, c: [1], d: { e: 1 } })).toBe('');
    expect(isShown(new Html('x'))).toBe(true);
  });
});
