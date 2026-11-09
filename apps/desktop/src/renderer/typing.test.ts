// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { typingOutside } from './typing.ts';

afterEach(() => {
  document.body.replaceChildren();
});

/** An element on the page, made from its HTML. */
function made(html: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const element = holder.firstElementChild as HTMLElement;
  document.body.append(element);
  return element;
}

describe('typingOutside', () => {
  it('says the user is typing in a box elsewhere, and not on a button or in the element', () => {
    const terminal = made('<div><textarea aria-label="Terminal input"></textarea></div>');
    expect(typingOutside(terminal)).toBe(false);
    made('<textarea aria-label="Your reply"></textarea>').focus();
    expect(typingOutside(terminal)).toBe(true);
    made('<input type="search">').focus();
    expect(typingOutside(terminal)).toBe(true);
    made('<input type="checkbox">').focus();
    expect(typingOutside(terminal)).toBe(false);
    made('<button type="button">Send</button>').focus();
    expect(typingOutside(terminal)).toBe(false);
    terminal.querySelector('textarea')?.focus();
    expect(typingOutside(terminal)).toBe(false);
  });
});
