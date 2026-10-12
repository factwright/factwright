import { escapeHtml } from '../markup.ts';

/**
 * Markup the engine made safe itself, such as a resume's text with its **bold** marked up. A
 * template shows it as it is; anything else it shows is escaped first.
 */
export class Html {
  readonly html: string;
  constructor(html: string) {
    this.html = html;
  }
}

/** What a template can show: text, numbers, yes or no, lists, and groups of named values. */
export type Value =
  | string
  | number
  | boolean
  | Html
  | null
  | undefined
  | readonly Value[]
  | { readonly [name: string]: Value };

/** A piece of a template: its own markup, a value, a section, or one of its parts. */
export type Node =
  | { kind: 'text'; text: string }
  | { kind: 'value'; name: string; attribute?: boolean }
  | { kind: 'section'; name: string; inverted: boolean; nodes: Node[] }
  | { kind: 'part'; name: string };

/** A value's name: a word, such as "name", words joined by dots, such as "titles.summary", or ".". */
const NAME = /^(?:\.|[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*)$/;

/** A part's name, such as "job" or "contact-line". */
export const PART_NAME = /^[a-z][a-z0-9_-]{0,40}$/;

const TAG = /\{\{([\s\S]*?)\}\}/g;

/**
 * A template's pieces, in the syntax of Mustache: {{value}}, {{#section}}…{{/section}},
 * {{^inverted}}…{{/inverted}}, {{> part}} and {{! comment}}. Every value is made safe for the page,
 * so there's no {{{triple}}} or {{&value}}, and the delimiters stay {{ }}.
 */
export function parseTemplate(
  source: string,
  where: string,
): { ok: true; nodes: Node[] } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const root: Node[] = [];
  const open: { name: string; nodes: Node[] }[] = [];
  const into = () => open.at(-1)?.nodes ?? root;
  const addText = (text: string) => {
    if (!text) return;
    if (text.includes('{{') || text.includes('}}')) {
      problems.push(`${where} has a “{{” or “}}” that isn’t part of a tag.`);
    }
    into().push({ kind: 'text', text });
  };
  let at = 0;
  for (const match of source.matchAll(TAG)) {
    addText(source.slice(at, match.index));
    at = match.index + match[0].length;
    const tag = (match[1] ?? '').trim();
    const sigil = tag[0] ?? '';
    const name = '#^/>!'.includes(sigil) ? tag.slice(1).trim() : tag;
    if (sigil === '!') continue;
    if (sigil === '{' || sigil === '&') {
      problems.push(
        `${where}: {{${tag}}} isn’t allowed. Write {{name}}: every value is made safe.`,
      );
      continue;
    }
    if (sigil === '=') {
      problems.push(`${where}: the delimiters can’t change. Keep {{ and }}.`);
      continue;
    }
    if (sigil === '>') {
      if (!PART_NAME.test(name)) problems.push(`${where}: “${name}” isn’t a part’s name.`);
      else into().push({ kind: 'part', name });
      continue;
    }
    if (!NAME.test(name)) {
      problems.push(
        `${where}: {{${tag}}} doesn’t name a value. Names are like name or titles.summary.`,
      );
      continue;
    }
    if (sigil === '#' || sigil === '^') {
      const section: Node = { kind: 'section', name, inverted: sigil === '^', nodes: [] };
      into().push(section);
      open.push({ name, nodes: section.nodes });
    } else if (sigil === '/') {
      const last = open.pop();
      if (!last) problems.push(`${where}: {{/${name}}} closes a section that isn’t open.`);
      else if (last.name !== name) {
        problems.push(
          `${where}: {{/${name}}} closes {{#${last.name}}}. Close the inner one first.`,
        );
      }
    } else {
      into().push({ kind: 'value', name });
    }
  }
  addText(source.slice(at));
  for (const { name } of open) problems.push(`${where}: {{#${name}}} is never closed.`);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, nodes: root };
}

/** Whether a value holds names to look in: a group or a list, never markup. */
const isScope = (value: Value): value is { readonly [name: string]: Value } | readonly Value[] =>
  typeof value === 'object' && value !== null && !(value instanceof Html);

function own(scope: Value, name: string): { found: boolean; value: Value } {
  if (!isScope(scope) || !Object.hasOwn(scope, name)) return { found: false, value: undefined };
  return { found: true, value: (scope as Record<string, Value>)[name] };
}

/**
 * A name's value: its first word from the innermost section that has it, then each word after
 * from the one before. "." is the innermost section's own value.
 */
function lookup(stack: readonly Value[], name: string): Value {
  if (name === '.') return stack.at(-1);
  const [first = '', ...rest] = name.split('.');
  let value: Value;
  for (let i = stack.length - 1; i >= 0; i--) {
    const found = own(stack[i], first);
    if (found.found) {
      value = found.value;
      break;
    }
  }
  for (const word of rest) value = own(value, word).value;
  return value;
}

/** Whether a section shows: no value, false, empty text or markup, 0 and an empty list don't. */
export function isShown(value: Value): boolean {
  if (value instanceof Html) return value.html !== '';
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

/**
 * A value as the page shows it: escaped, or the engine's own markup as it is. Inside an
 * attribute's quotes, that markup's tags are left out, leaving its escaped text.
 */
function shown(value: Value, attribute = false): string {
  if (value instanceof Html) return attribute ? value.html.replace(/<[^>]*>/g, '') : value.html;
  if (typeof value === 'string' || typeof value === 'number') return escapeHtml(value);
  return '';
}

/**
 * Fills in a template's pieces from a view of the data. Parts come from `parts`, already parsed;
 * a template whose parts call each other in a circle never gets this far.
 */
export function renderNodes(
  nodes: readonly Node[],
  stack: readonly Value[],
  parts: ReadonlyMap<string, readonly Node[]>,
): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') out += node.text;
    else if (node.kind === 'value') out += shown(lookup(stack, node.name), node.attribute);
    else if (node.kind === 'part') out += renderNodes(parts.get(node.name) ?? [], stack, parts);
    else {
      const value = lookup(stack, node.name);
      if (node.inverted) {
        if (!isShown(value)) out += renderNodes(node.nodes, stack, parts);
      } else if (Array.isArray(value)) {
        for (const item of value) out += renderNodes(node.nodes, [...stack, item], parts);
      } else if (isShown(value)) {
        out += renderNodes(node.nodes, [...stack, value], parts);
      }
    }
  }
  return out;
}
