/**
 * A small XML reader for the parts of a Word file. It reads in one pass, with no patterns that
 * can backtrack, so a file of any shape is read in time with its length. It's forgiving, as Word
 * is: an end tag that doesn't match closes back to the element it names, or is skipped.
 */

export interface XmlElement {
  /** Its name with its prefix, such as "w:p". */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Text with its entities, such as &amp; and &#8217;, turned back into characters. */
export function decodeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(
    /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g,
    (whole, name: string) => {
      if (name.startsWith('#')) {
        const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\u{FFFD}';
      }
      return ENTITIES[name] ?? whole;
    },
  );
}

/** Where a tag ends: the ">" after `from` that isn't inside quotes, or -1. */
function tagEnd(xml: string, from: number): number {
  let quote = '';
  for (let i = from; i < xml.length; i++) {
    const char = xml[i];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return -1;
}

/** A tag's attributes, from the text after its name. */
function attributesOf(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i] ?? '')) i++;
    const equals = text.indexOf('=', i);
    if (equals < 0) break;
    const name = text.slice(i, equals).trim();
    let start = equals + 1;
    while (start < text.length && /\s/.test(text[start] ?? '')) start++;
    const quote = text[start];
    if (quote !== '"' && quote !== "'") break;
    const end = text.indexOf(quote, start + 1);
    if (end < 0) break;
    if (name) attrs[name] = decodeXml(text.slice(start + 1, end));
    i = end + 1;
  }
  return attrs;
}

/** The document's root element, with every element and run of text under it. */
export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: '', attrs: {}, children: [] };
  const open: XmlElement[] = [root];
  const top = () => open[open.length - 1] ?? root;
  const openNames = new Map<string, number>();
  const count = (name: string, by: number) => openNames.set(name, (openNames.get(name) ?? 0) + by);
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      top().children.push(decodeXml(xml.slice(i)));
      break;
    }
    if (lt > i) top().children.push(decodeXml(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end < 0 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      top().children.push(xml.slice(lt + 9, end < 0 ? xml.length : end));
      i = end < 0 ? xml.length : end + 3;
      continue;
    }
    const gt = tagEnd(xml, lt + 1);
    if (gt < 0) break;
    const tag = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith('?') || tag.startsWith('!')) continue;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      // Only a name that's open is looked for, so an end tag that matches nothing costs nothing,
      // and each element closes once.
      if (!openNames.get(name)) continue;
      const at = open.findLastIndex((element) => element.name === name);
      for (const closed of open.splice(at)) count(closed.name, -1);
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const space = body.search(/\s/);
    const name = space < 0 ? body : body.slice(0, space);
    const element: XmlElement = {
      name,
      attrs: space < 0 ? {} : attributesOf(body.slice(space)),
      children: [],
    };
    top().children.push(element);
    if (!selfClosing) {
      open.push(element);
      count(name, 1);
    }
  }
  return root.children.find((node): node is XmlElement => typeof node !== 'string') ?? root;
}

/** An element's child elements, of one name or all of them. */
export function childrenOf(element: XmlElement, name?: string): XmlElement[] {
  return element.children.filter(
    (node): node is XmlElement => typeof node !== 'string' && (!name || node.name === name),
  );
}

/** An element's first child element of a name. */
export const childOf = (element: XmlElement, name: string): XmlElement | undefined =>
  childrenOf(element, name)[0];

/**
 * Every element of a name at any depth under an element, in document order. With `outermost`,
 * not those inside one already found, as a text box inside a text box is read with its box.
 */
export function descendantsOf(
  element: XmlElement,
  name: string,
  { outermost = false } = {},
): XmlElement[] {
  const found: XmlElement[] = [];
  // A list to visit rather than calls within calls, so no file nests deep enough to overflow.
  const next = childrenOf(element).reverse();
  for (let node = next.pop(); node; node = next.pop()) {
    if (node.name === name) {
      found.push(node);
      if (outermost) continue;
    }
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i--) next.push(children[i] as XmlElement);
  }
  return found;
}
