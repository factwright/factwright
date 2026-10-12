import { describe, expect, it } from 'vitest';
import { cssProblems, markupProblems } from './check.ts';
import { parseTemplate } from './syntax.ts';

function problems(source: string): string[] {
  const read = parseTemplate(source, 'body');
  if (!read.ok) throw new Error(read.problems.join(' '));
  return markupProblems(read.nodes, 'body');
}

describe('markupProblems', () => {
  it('passes text elements with values between tags and inside quotes', () => {
    expect(
      problems(
        '<section class="x {{kind}}" data-n="{{stats.length}}"><h2>{{title}}</h2>{{! a note }}<br/><table><tr><td colspan="2">{{#a}}{{b}}{{/a}}</td></tr></table>{{> part}}</section>',
      ),
    ).toEqual([]);
  });

  it('refuses elements that could run a script, load a file or take input', () => {
    for (const tag of [
      'script',
      'img',
      'iframe',
      'a',
      'style',
      'svg',
      'object',
      'embed',
      'link',
      'meta',
      'form',
      'input',
      'base',
      'template',
      'math',
      'textarea',
    ]) {
      expect(problems(`<div><${tag}></${tag}></div>`)[0]).toContain(`<${tag}> isn’t allowed`);
    }
    expect(problems('<SCRIPT>x</SCRIPT>')[0]).toContain('<script> isn’t allowed');
  });

  it('refuses event handlers, links and sources', () => {
    for (const attribute of [
      'onclick',
      'onload',
      'href',
      'src',
      'srcdoc',
      'action',
      'formaction',
      'xlink:href',
    ]) {
      expect(problems(`<div ${attribute}="x"></div>`)[0]).toContain('isn’t allowed');
    }
    expect(problems('<div aria-label="x" data-kind="y" role="list"></div>')).toEqual([]);
  });

  it('keeps values out of the tags themselves', () => {
    expect(problems('<div {{kind}}></div>')[0]).toContain('name="value"');
    expect(problems('<div class={{kind}}></div>')[0]).toContain('name="value"');
    expect(problems("<div class='{{kind}}'></div>")[0]).toContain('name="value"');
    expect(problems('<{{kind}}>x</div>')[0]).toContain('doesn’t start a tag');
    expect(problems('<div class="a" {{#x}}title="b"{{/x}}></div>')[0]).toContain('name="value"');
    expect(problems('<div class="{{> part}}"></div>')).toEqual([
      'body: a part can only go between tags.',
    ]);
  });

  it('keeps “<” out of attributes, where it could come alive if the quotes ended early', () => {
    expect(problems('<div title="{{summary}} <img src=x onerror=alert(1)>">x</div>')).toEqual([
      'body: <div title> can’t hold “<”. Write &lt;.',
    ]);
    expect(problems('<div title="1 &lt; 2">x</div>')).toEqual([]);
  });

  it('starts and ends each section in the same place', () => {
    expect(problems('<div title="{{#a}}">{{/a}}</div>')[0]).toContain(
      'start and end in the same place',
    );
    expect(problems('<div title="{{#a}}" class="{{/a}}"></div>')[0]).toContain('same place');
    expect(problems('<div class="a{{#b}} b{{/b}}">{{#c}}<i>c</i>{{/c}}</div>')).toEqual([]);
  });

  it('wants < written as &lt;, notes as Mustache comments, and tags finished', () => {
    expect(problems('a < b')[0]).toContain('Write &lt;');
    // A browser ends "<!-->" right there, so what follows would be markup, not a comment.
    for (const comment of ['<!-- note -->', '<!--><img src=x>-->', '<!--->', '<!DOCTYPE html>']) {
      expect(problems(comment)).toEqual([
        'body: HTML comments aren’t allowed. Write a note as {{! note }}.',
      ]);
    }
    expect(problems('<div class="a"')).toEqual(['body ends inside <div>.']);
    expect(problems('<div style="background:url(https://x.example/a.png)"></div>')[0]).toContain(
      'url()',
    );
  });
});

describe('cssProblems', () => {
  it('passes styles that load nothing', () => {
    expect(
      cssProblems('.a{color:red}.b::before{content:"\\2022"}@media print{.c{display:none}}', 'css'),
    ).toEqual([]);
    expect(
      cssProblems(
        '.a{background:url(data:image/png;base64,AAAA)}@font-face{src:url("data:font/woff2;base64,AA")}',
        'css',
      ),
    ).toEqual([]);
  });

  it('refuses <, which could end the stylesheet, @import, and url() to anywhere else', () => {
    expect(cssProblems('.a{}</style><script>', 'css')).toEqual([
      'css can’t hold “<”. Write \\3c in a string.',
    ]);
    expect(cssProblems('@IMPORT "x.css";', 'css')).toEqual([
      'css can’t @import. Put every style in it.',
    ]);
    for (const url of [
      'url(https://x.example/a.png)',
      'url( "http://x")',
      'url(data:text/html,hi)',
      'url(file:///etc/passwd)',
    ]) {
      expect(cssProblems(`.a{background:${url}}`, 'css')).toEqual([
        'css: url() can only hold a data: picture or WOFF2 font.',
      ]);
    }
  });
});
