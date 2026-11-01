// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openLinksInBrowser } from './links.ts';

/** A link in the page, with some words inside it, as links in the app have. */
function link(href: string): HTMLElement {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.innerHTML = '<span>Words</span>';
  document.body.append(anchor);
  return anchor.querySelector('span') as HTMLElement;
}

const click = (target: Element, init: MouseEventInit) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe('openLinksInBrowser', () => {
  const open = vi.fn();

  beforeAll(() => {
    vi.stubGlobal('open', open);
    openLinksInBrowser(document);
  });

  afterEach(() => {
    open.mockClear();
    document.body.innerHTML = '';
  });

  it('opens a link clicked with Alt held as any other, rather than downloading it', () => {
    const event = click(link('https://example.com/jobs?q=a%20b'), { altKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      'https://example.com/jobs?q=a%20b',
      '_blank',
      'noreferrer',
    );
  });

  it('leaves a plain click to the link itself', () => {
    const event = click(link('https://example.com/'), {});
    expect(event.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('leaves alone anything that isn’t a link', () => {
    const button = document.body.appendChild(document.createElement('button'));
    const event = click(button, { altKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
