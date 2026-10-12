import type { Node } from './syntax.ts';

/**
 * The elements a template may use: ones for text, lists and tables, which hold only text and
 * other elements. Nothing that runs a script, loads a file or takes input, such as <script>,
 * <img>, <iframe>, <a>, <style> or <svg>.
 */
const ELEMENTS = new Set(
  (
    'address article aside b blockquote br caption col colgroup dd div dl dt em figcaption ' +
    'figure footer h1 h2 h3 h4 h5 h6 header hr i li main mark nav ol p s section small span ' +
    'strong sub sup table tbody td tfoot th thead time tr u ul wbr'
  ).split(' '),
);

/**
 * The attributes a template may give them. No event handlers, links or sources, and none whose
 * words could reach the PDF, such as title or aria-label.
 */
const ATTRIBUTES = new Set(['class', 'id', 'style', 'lang', 'dir', 'role', 'colspan', 'rowspan']);
const isAttribute = (name: string) => ATTRIBUTES.has(name) || /^data-[a-z][a-z0-9-]*$/.test(name);

// Where the engine fills something in, marked in a template's markup while it's checked.
const VALUE = '\u0001';
const OPEN = '\u0002';
const CLOSE = '\u0003';
const PART = '\u0004';
const MARKS = new Set([VALUE, OPEN, CLOSE, PART]);
const isMark = (char: string) => MARKS.has(char);

/** A template's markup, with a mark where each value, section and part goes. */
function skeleton(nodes: readonly Node[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text') return node.text;
      if (node.kind === 'value') return VALUE;
      if (node.kind === 'part') return PART;
      return `${OPEN}${skeleton(node.nodes)}${CLOSE}`;
    })
    .join('');
}

/** The data: URLs a stylesheet may use: pictures and WOFF2 fonts, carried in the template. */
const DATA_URL = /^\s*["']?data:(?:image\/(?:png|jpeg|gif|webp)|font\/woff2)[;,]/i;

/** Letters and digits: words, which come only from the resume and the template's titles. */
const WORDS = /[\p{L}\p{N}]/u;

/**
 * CSS functions that bring something in from elsewhere, or print text the template chose: none
 * is needed to lay out a resume. url() is checked on its own.
 */
const FUNCTIONS = new Set([
  'attr',
  'src',
  'image',
  'image-set',
  '-webkit-image-set',
  'cross-fade',
  '-webkit-cross-fade',
  'element',
  '-moz-element',
]);

/** The properties whose strings print on the page, such as content: "•". */
const PRINTS =
  /(?:^|[;{\s])((?:-webkit-)?(?:content|quotes|list-style|list-style-type|text-emphasis|text-emphasis-style|hyphenate-character|text-overflow))\s*:([^;}]*)/gi;

/** Whether a number is a character a page can hold. */
const isCharacter = (code: number) =>
  code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);

/**
 * CSS as a browser reads it, so no check is fooled by how it's written: comments gone, escapes
 * undone ("u\72l(" is "url("), and each string's text kept whole, in double quotes.
 */
function readCss(css: string): string {
  let out = '';
  let i = 0;
  // At a backslash: the character it stands for, read as CSS does.
  const escaped = (): string => {
    const hex = /^[0-9a-fA-F]{1,6}/.exec(css.slice(i + 1, i + 7))?.[0];
    if (hex) {
      i += 1 + hex.length;
      if (/[ \t\r\n\f]/.test(css[i] ?? '')) i++;
      const code = Number.parseInt(hex, 16);
      return isCharacter(code) ? String.fromCodePoint(code) : '\ufffd';
    }
    const next = css[i + 1] ?? '';
    i += next ? 2 : 1;
    return /[\r\n\f]/.test(next) ? '' : next;
  };
  while (i < css.length) {
    const char = css[i] as string;
    if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      out += ' ';
    } else if (char === '"' || char === "'") {
      let text = '';
      i++;
      while (i < css.length && css[i] !== char && !/[\r\n\f]/.test(css[i] as string)) {
        text += css[i] === '\\' ? escaped() : (css[i++] as string);
      }
      if (css[i] === char) i++;
      out += `"${text.replaceAll('"', "'")}"`;
    } else if (char === '\\') {
      out += escaped();
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

/**
 * What's wrong with a template's styles, if anything, read as a browser reads them. They
 * can't hold "<", so they can't end the page's stylesheet early. They load nothing: no @import,
 * url() only for a data: picture or font, and nothing else that brings something in. And they
 * print no words: a string that prints, such as content's, holds marks such as • or |, never
 * letters or digits, and never var() or attr(). The page prints where it can't reach anything
 * else anyway.
 */
export function cssProblems(css: string, where: string): string[] {
  const problems: string[] = [];
  if (css.includes('<')) problems.push(`${where} can’t hold “<”. Write \\3c in a string.`);
  const read = readCss(css);
  if (/@import/i.test(read)) problems.push(`${where} can’t @import. Put every style in it.`);
  if (/@counter-style/i.test(read)) problems.push(`${where} can’t use @counter-style.`);
  // Each function by the name just before its "(": a few characters back, however long the
  // styles, such as a picture's data.
  for (let at = read.indexOf('('); at >= 0; at = read.indexOf('(', at + 1)) {
    const name = /[-a-z]+$/i.exec(read.slice(Math.max(0, at - 24), at))?.[0]?.toLowerCase();
    if (name === undefined) continue;
    if (name === 'url') {
      if (!DATA_URL.test(read.slice(at + 1, at + 64))) {
        problems.push(
          `${where}: url() can only hold a data: picture (PNG, JPEG, GIF or WebP) or a WOFF2 font.`,
        );
        break;
      }
    } else if (FUNCTIONS.has(name)) {
      problems.push(`${where}: ${name}() isn’t allowed.`);
      break;
    }
  }
  for (const [, property, value] of read.matchAll(PRINTS)) {
    const strings = [...(value ?? '').matchAll(/"([^"]*)"|'([^']*)'/g)].map(
      ([, double, single]) => double ?? single ?? '',
    );
    const words = strings.find((each) => WORDS.test(each));
    if (words !== undefined || /\b(?:var|attr)\(/i.test(value ?? '')) {
      problems.push(
        `${where}: ${(property as string).toLowerCase()} would print ${words === undefined ? 'something the stylesheet doesn’t show' : `“${words.trim()}”`} on every resume. Every word comes from the resume or the template’s titles; a string here can hold marks such as • or |.`,
      );
      break;
    }
  }
  return problems;
}

/** The named characters a template's own text may use, and what each one is. */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  middot: '·',
  bull: '•',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  verbar: '|',
  sol: '/',
};

/**
 * What's wrong with a template's own text between tags: words, which come only from the resume
 * and the template's titles, or a character named some way the page might not read.
 */
function textProblem(text: string, where: string): string | null {
  let unknown = '';
  const read = text.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (whole, name: string) => {
      if (name.startsWith('#')) {
        const code = Number.parseInt(
          name.slice(name[1] === 'x' || name[1] === 'X' ? 2 : 1),
          name[1] === 'x' || name[1] === 'X' ? 16 : 10,
        );
        return isCharacter(code) ? String.fromCodePoint(code) : '\ufffd';
      }
      const known = NAMED[name];
      if (known === undefined) unknown ||= whole;
      return known ?? '';
    },
  );
  if (unknown) return `${where}: write ${unknown} as the character itself.`;
  if (WORDS.test(read)) {
    return `${where}: “${read.trim().slice(0, 40)}” would print on every resume. Every word comes from the resume or the template’s titles; the markup holds tags, values, and marks such as · or |.`;
  }
  return null;
}

// What the scanner reads at one place in the markup, without copying the rest of it.
const CLOSING = /<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/y;
const OPENING = /<([a-zA-Z][a-zA-Z0-9]*)/y;
const SPACE = /\s*/y;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/y;

/** A sticky pattern's match right at one place in the text, if any. */
function matchAt(pattern: RegExp, text: string, index: number): RegExpExecArray | null {
  pattern.lastIndex = index;
  return pattern.exec(text);
}

/** Every value a template's markup shows, in the order the skeleton marks them. */
function valuesIn(nodes: readonly Node[]): Extract<Node, { kind: 'value' }>[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'value') return [node];
    return node.kind === 'section' ? valuesIn(node.nodes) : [];
  });
}

/**
 * Reads a template's markup as a browser would, element by element: what's wrong with it, if
 * anything, and whether each value it shows goes between tags or inside an attribute's quotes.
 */
function scan(
  nodes: readonly Node[],
  where: string,
): { problems: string[]; inAttribute: boolean[] } {
  const text = skeleton(nodes);
  const problems: string[] = [];
  const inAttribute: boolean[] = [];
  const opened: string[] = [];
  let attributes = 0;
  const mark = (char: string, at: string) => {
    if (char === VALUE) inAttribute.push(at !== 'text');
    if (char === PART && at !== 'text') problems.push(`${where}: a part can only go between tags.`);
    if (char === OPEN) opened.push(at);
    if (char === CLOSE && opened.pop() !== at) {
      problems.push(
        `${where}: a section has to start and end in the same place: both between tags, or both inside one attribute’s quotes.`,
      );
    }
  };
  let i = 0;
  let own = '';
  const endText = () => {
    const problem = textProblem(own, where);
    if (problem) problems.push(problem);
    own = '';
  };
  while (i < text.length && problems.length === 0) {
    const char = text[i] as string;
    if (isMark(char)) {
      mark(char, 'text');
      i++;
      continue;
    }
    if (char !== '<') {
      own += char;
      i++;
      continue;
    }
    endText();
    if (problems.length > 0) break;
    // Browsers end a comment in more ways than one, such as "<!-->", so none is allowed.
    if (text.startsWith('<!', i)) {
      problems.push(`${where}: HTML comments aren’t allowed. Write a note as {{! note }}.`);
      break;
    }
    const closing = matchAt(CLOSING, text, i);
    const opening = closing ? null : matchAt(OPENING, text, i);
    const tag = closing ?? opening;
    if (!tag) {
      problems.push(`${where}: a “<” doesn’t start a tag. Write &lt; to show the character.`);
      break;
    }
    const name = (tag[1] as string).toLowerCase();
    if (!ELEMENTS.has(name)) {
      problems.push(
        `${where}: <${name}> isn’t allowed. Use text elements: div, span, section, h2, ul, li, table and the like.`,
      );
      break;
    }
    i += tag[0].length;
    if (closing) continue;
    for (;;) {
      const space = matchAt(SPACE, text, i)?.[0] ?? '';
      i += space.length;
      if (text.startsWith('/>', i)) {
        i += 2;
        break;
      }
      if (text[i] === '>') {
        i++;
        break;
      }
      const attribute = matchAt(ATTRIBUTE, text, i);
      if (i >= text.length) {
        problems.push(`${where} ends inside <${name}>.`);
        break;
      }
      if (!attribute || !space) {
        problems.push(
          `${where}: <${name}>’s attributes have to be name="value", in double quotes, with values only inside the quotes.`,
        );
        break;
      }
      const attributeName = (attribute[1] as string).toLowerCase();
      if (!isAttribute(attributeName)) {
        problems.push(
          `${where}: <${name} ${attributeName}> isn’t allowed. Use class, style, id, lang, dir, role, colspan, rowspan or data-*.`,
        );
        break;
      }
      const value = attribute[2] as string;
      // Nothing in quotes needs markup, and none there could ever come alive.
      if (value.includes('<')) {
        problems.push(`${where}: <${name} ${attributeName}> can’t hold “<”. Write &lt;.`);
        break;
      }
      const at = `attribute ${attributes++}`;
      for (const each of value) if (isMark(each)) mark(each, at);
      if (attributeName === 'style' && value.includes('&')) {
        problems.push(`${where}: style="" can’t hold “&”. Write the character itself.`);
        break;
      }
      if (attributeName === 'style') {
        problems.push(
          ...cssProblems(
            [...value].filter((each) => !isMark(each)).join(''),
            `${where}’s style=""`,
          ),
        );
      }
      i += attribute[0].length;
    }
  }
  if (problems.length === 0) endText();
  return { problems, inAttribute };
}

/**
 * What's wrong with a template's markup, if anything. It must be elements from the list with
 * attributes from the list, each value in double quotes, with no "<" in them, and no HTML
 * comments. Values go between tags or inside an attribute's quotes, and a section starts and
 * ends in the same place. Parts go between tags. So whatever the data, the page is only these
 * elements, and no value can add markup.
 */
export function markupProblems(nodes: readonly Node[], where: string): string[] {
  return scan(nodes, where).problems;
}

/**
 * Marks each value that goes inside an attribute's quotes, which shows as plain text: the
 * resume's **bold** marked up there would end the quotes.
 */
export function markAttributeValues(nodes: Node[]): void {
  const { inAttribute } = scan(nodes, 'template');
  valuesIn(nodes).forEach((node, i) => {
    if (inAttribute[i]) node.attribute = true;
  });
}
