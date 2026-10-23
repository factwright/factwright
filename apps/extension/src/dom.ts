/** What an element can hold: other elements, and text, which is always text, never markup. */
export type Child = Node | string | false | null | undefined;

type Props = {
  class?: string;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
} & Record<string, string | boolean | number | undefined | object>;

/** An element, with its attributes, listeners and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === 'on' && value && typeof value === 'object') {
      for (const [event, listener] of Object.entries(value)) {
        element.addEventListener(event, listener as EventListener);
      }
    } else if (name === 'class' && typeof value === 'string') {
      element.className = value;
    } else if (typeof value === 'boolean') {
      if (value) element.setAttribute(name, '');
    } else if (value !== undefined && typeof value !== 'object') {
      element.setAttribute(name, String(value));
    }
  }
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    element.append(child);
  }
  return element;
}

/** Puts what a page shows in place of what it showed. */
export function show(root: HTMLElement, ...children: Child[]): void {
  root.replaceChildren(...children.filter((child): child is Node | string => Boolean(child)));
}

/** The extension's name, with its icon, at the top of a page. */
export const heading = (text = 'Factwright') =>
  h('h1', {}, h('img', { src: 'icons/32.png', alt: '', width: 24, height: 24 }), text);
