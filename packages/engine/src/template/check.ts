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

/** The attributes a template may give them. No event handlers, links or sources. */
const ATTRIBUTES = new Set([
  'class',
  'id',
  'style',
  'title',
  'lang',
  'dir',
  'role',
  'colspan',
  'rowspan',
]);
const isAttribute = (name: string) =>
  ATTRIBUTES.has(name) || /^(?:aria|data)-[a-z][a-z0-9-]*$/.test(name);

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
const DATA_URL = /^\s*["']?data:(?:image\/(?:png|jpeg|gif|webp|svg\+xml)|font\/woff2)[;,]/i;

/**
 * What's wrong with a template's styles, if anything. They can't hold "<", so they can't end the
 * page's stylesheet early, and they load nothing: no @import, and url() only for a data: picture
 * or font. The page prints where it can't reach anything else anyway.
 */
export function cssProblems(css: string, where: string): string[] {
  const problems: string[] = [];
  if (css.includes('<')) problems.push(`${where} can’t hold “<”. Write \\3c in a string.`);
  if (/@import/i.test(css)) problems.push(`${where} can’t @import. Put every style in it.`);
  for (const match of css.matchAll(/url\(/gi)) {
    if (!DATA_URL.test(css.slice(match.index + match[0].length))) {
      problems.push(`${where}: url() can only hold a data: picture or WOFF2 font.`);
      break;
    }
  }
  return problems;
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
  while (i < text.length && problems.length === 0) {
    const char = text[i] as string;
    if (isMark(char)) {
      mark(char, 'text');
      i++;
      continue;
    }
    if (char !== '<') {
      i++;
      continue;
    }
    const rest = text.slice(i);
    // Browsers end a comment in more ways than one, such as "<!-->", so none is allowed.
    if (rest.startsWith('<!')) {
      problems.push(`${where}: HTML comments aren’t allowed. Write a note as {{! note }}.`);
      break;
    }
    const closing = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/.exec(rest);
    const opening = closing ? null : /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(rest);
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
      const space = /^\s*/.exec(text.slice(i))?.[0] ?? '';
      i += space.length;
      if (text.startsWith('/>', i)) {
        i += 2;
        break;
      }
      if (text[i] === '>') {
        i++;
        break;
      }
      const attribute = /^([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/.exec(text.slice(i));
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
          `${where}: <${name} ${attributeName}> isn’t allowed. Use class, style, id, title, colspan, rowspan, aria-* or data-*.`,
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
