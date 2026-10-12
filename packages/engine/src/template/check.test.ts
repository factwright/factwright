import { describe, expect, it } from 'vitest';
import { cssProblems, markupProblems } from './check.ts';
import { parseTemplate } from './syntax.ts';

function problems(source: string): string[] {
  const read = parseTemplate(source, 'body');
  if (!read.ok) throw new Error(read.problems.join(' '));
  return markupProblems(read.nodes, 'body');
}

const WORDS =
  'would print on every resume. Every word comes from the resume or the template’s titles; the markup holds tags, values, and marks such as · or |.';

describe('markupProblems', () => {
  it('passes text elements with values between tags and inside quotes', () => {
    expect(
      problems(
        '<section class="x {{kind}}" data-n="{{stats.length}}" lang="en"><h2>{{title}}</h2>{{! a note }}<br/><table><tr><td colspan="2">{{#a}}{{b}}{{/a}}</td></tr></table>{{> part}} · | — &middot; &amp; &#8226;</section>',
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
    expect(problems('<SCRIPT></SCRIPT>')[0]).toContain('<script> isn’t allowed');
  });

  it('refuses event handlers, links, sources, and attributes whose words could reach the PDF', () => {
    for (const attribute of [
      'onclick',
      'onload',
      'href',
      'src',
      'srcdoc',
      'action',
      'formaction',
      'xlink:href',
      'title',
      'aria-label',
    ]) {
      expect(problems(`<div ${attribute}="x"></div>`)[0]).toContain('isn’t allowed');
    }
    expect(problems('<div data-kind="phone" role="list" dir="ltr"></div>')).toEqual([]);
  });

  it('keeps values out of the tags themselves', () => {
    expect(problems('<div {{kind}}></div>')[0]).toContain('name="value"');
    expect(problems('<div class={{kind}}></div>')[0]).toContain('name="value"');
    expect(problems("<div class='{{kind}}'></div>")[0]).toContain('name="value"');
    expect(problems('<{{kind}}></div>')[0]).toContain('doesn’t start a tag');
    expect(problems('<div class="a" {{#x}}data-b="b"{{/x}}></div>')[0]).toContain('name="value"');
    expect(problems('<div class="{{> part}}"></div>')).toEqual([
      'body: a part can only go between tags.',
    ]);
  });

  it('keeps “<” out of attributes, where it could come alive if the quotes ended early', () => {
    expect(problems('<div data-x="{{summary}} <img src=x onerror=alert(1)>"></div>')).toEqual([
      'body: <div data-x> can’t hold “<”. Write &lt;.',
    ]);
    expect(problems('<div data-x="1 &lt; 2"></div>')).toEqual([]);
  });

  it('starts and ends each section in the same place', () => {
    expect(problems('<div data-x="{{#a}}">{{/a}}</div>')[0]).toContain(
      'start and end in the same place',
    );
    expect(problems('<div data-x="{{#a}}" class="{{/a}}"></div>')[0]).toContain('same place');
    expect(problems('<div class="a{{#b}} b{{/b}}">{{#c}}<i>•</i>{{/c}}</div>')).toEqual([]);
  });

  it('wants < written as &lt;, notes as Mustache comments, and tags finished', () => {
    expect(problems('· < ·')[0]).toContain('Write &lt;');
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
    // The browser reads "&#114;" as "r" before the stylesheet sees it.
    expect(problems('<div style="background:u&#114;l(https://x.example)"></div>')).toEqual([
      'body: style="" can’t hold “&”. Write the character itself.',
    ]);
  });

  it('keeps words out of the template’s own text, since they’d print on every resume', () => {
    expect(problems('<p>{{name}} Hire me</p>')).toEqual([`body: “Hire me” ${WORDS}`]);
    expect(problems('<p>2026</p>')).toEqual([`body: “2026” ${WORDS}`]);
    expect(problems('<p>&#72;&#x69;</p>')).toEqual([`body: “Hi” ${WORDS}`]);
    expect(problems('<p>&copy;</p>')).toEqual(['body: write &copy; as the character itself.']);
    expect(problems('<p>{{#a}}Hire{{/a}}</p>')).toEqual([`body: “Hire” ${WORDS}`]);
  });
});

describe('cssProblems', () => {
  it('passes styles that load nothing and print no words', () => {
    expect(
      cssProblems(
        '.a{color:red}.b::before{content:"\\2022"}@media print{.c{display:none}}ul{list-style-type:"–  "}',
        'css',
      ),
    ).toEqual([]);
    expect(
      cssProblems(
        '.a{background:url(data:image/png;base64,AAAA);font-family:"Factwright Sans",Calibri}@font-face{src:url("data:font/woff2;base64,AA")}.c:has([data-kind="phone"]){counter-increment:n}',
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
      'url(data:image/svg+xml,%3Csvg/>)',
      'url(file:///etc/passwd)',
    ]) {
      expect(cssProblems(`.a{background:${url}}`, 'css')).toEqual([
        'css: url() can only hold a data: picture (PNG, JPEG, GIF or WebP) or a WOFF2 font.',
      ]);
    }
  });

  it('reads the styles as the browser does, escapes, comments and all', () => {
    expect(cssProblems('.a{x:1}/* a note */content:"Hire"', 'css')[0]).toContain(
      'content would print “Hire”',
    );
    // A comment's marks inside a string are only text, and don't hide what follows.
    expect(
      cssProblems('.a{content:"/*"}.b{content:"Hire me"}.c{content:"*/"}', 'css')[0],
    ).toContain('content would print “Hire me”');
    expect(cssProblems('.a{cont\\65nt:"\\22 Hi"}', 'css')[0]).toContain('content would print');
    expect(cssProblems('.a{background:u\\72l(https://x.example)}', 'css')).toEqual([
      'css: url() can only hold a data: picture (PNG, JPEG, GIF or WebP) or a WOFF2 font.',
    ]);
    expect(cssProblems('@\\69mport "x.css";', 'css')).toEqual([
      'css can’t @import. Put every style in it.',
    ]);
  });

  it('refuses whatever else brings something in, or prints what the template chose', () => {
    for (const [css, name] of [
      ['.a{background-image:image-set("https://x.example/x.png" 1x)}', 'image-set'],
      ['.a{background:-webkit-image-set("https://x.example/x.png" 1x)}', '-webkit-image-set'],
      ['.a::after{content:attr(data-x)}', 'attr'],
      ['.a{background:cross-fade(url(data:image/png;base64,AA), red)}', 'cross-fade'],
    ] as const) {
      expect(cssProblems(css, 'css')[0]).toBe(`css: ${name}() isn’t allowed.`);
    }
    expect(cssProblems('@counter-style x{system:cyclic;symbols:"•"}', 'css')).toEqual([
      'css can’t use @counter-style.',
    ]);
  });

  it('keeps words out of the strings that print, such as content’s', () => {
    const prints = (property: string, words: string) =>
      `css: ${property} would print ${words} on every resume. Every word comes from the resume or the template’s titles; a string here can hold marks such as • or |.`;
    expect(cssProblems('.a::before{content:"Hire me "}', 'css')).toEqual([
      prints('content', '“Hire me”'),
    ]);
    expect(cssProblems('.a::before{content:"\\48 i"}', 'css')).toEqual([prints('content', '“Hi”')]);
    expect(cssProblems('ul{list-style-type:"Hire "}', 'css')).toEqual([
      prints('list-style-type', '“Hire”'),
    ]);
    expect(cssProblems('p{-webkit-text-emphasis-style:"x"}', 'css')).toEqual([
      prints('-webkit-text-emphasis-style', '“x”'),
    ]);
    expect(cssProblems('.a{--x:"Hire"}.a::before{content:var(--x)}', 'css')).toEqual([
      prints('content', 'something the stylesheet doesn’t show'),
    ]);
  });
});
