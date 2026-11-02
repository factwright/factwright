import { describe, expect, it } from 'vitest';
import { ShellGuard } from './shell-guard.ts';

const pasted = (text: string) => `\x1b[200~${text}\x1b[201~`;

/** What Claude Code gets of each piece, one key or paste at a time, joined. */
const through = (...pieces: string[]) => {
  const guard = new ShellGuard();
  return pieces.map((piece) => guard.pass(piece)).join('');
};

describe('ShellGuard', () => {
  it('drops a "!" typed first in the box, leaving the rest as words', () => {
    expect(through('!', ' ', 'l', 's')).toBe(' ls');
    expect(through('! ls')).toBe(' ls');
  });

  it('drops every "!" that would still be first', () => {
    expect(through('!', '!', '!')).toBe('');
    expect(through('!!! ls')).toBe(' ls');
  });

  it('drops a "!" pasted first, keeping the marks of the paste', () => {
    expect(through(pasted('! ls'))).toBe(pasted(' ls'));
    expect(through(pasted('!!! ls'))).toBe(pasted(' ls'));
  });

  it('keeps only the text of a paste, so nothing in it hides what comes first', () => {
    expect(through(pasted('\x1b(B! ls'))).toBe(pasted('(B! ls'));
    expect(through(pasted('\x1b[0m! ls'))).toBe(pasted('[0m! ls'));
    expect(through(pasted('\x9b0m! ls'))).toBe(pasted('0m! ls'));
  });

  it('keeps a paste whole, whatever it holds', () => {
    expect(through(pasted('a\x1b[201~\rb'))).toBe(pasted('a[201~\rb'));
    expect(through(pasted('a\x1b[201~\r! b'), '!')).toBe(`${pasted('a[201~\r! b')}!`);
  });

  it('leaves a "!" after other words, typed or pasted', () => {
    expect(through('w', 'o', 'w', '!')).toBe('wow!');
    expect(through('wow!')).toBe('wow!');
    expect(through(pasted('wow!'))).toBe(pasted('wow!'));
    expect(through('a', pasted('! b'))).toBe(`a${pasted('! b')}`);
    expect(through(pasted('a'), '!')).toBe(`${pasted('a')}!`);
  });

  it('leaves a "!" after a space or a new line, which Claude Code reads as words', () => {
    expect(through(' ', '!')).toBe(' !');
    expect(through(pasted('  ! ls'))).toBe(pasted('  ! ls'));
    expect(through(pasted('\r! ls'))).toBe(pasted('\r! ls'));
  });

  it('counts a line break in a paste as text, not as sending the box', () => {
    expect(through(pasted('a\rb'), '!')).toBe(`${pasted('a\rb')}!`);
  });

  it('starts again once the box was sent or cleared', () => {
    expect(through('a', '\r', '!', 'b')).toBe('a\rb');
    expect(through('a', '\x03', '!', 'b')).toBe('a\x03b');
    expect(through('a', '\x15', '!', 'b')).toBe('a\x15b');
  });

  it('doesn’t take a "?" first in the box for text, as it opens a list instead', () => {
    expect(through('?', '!')).toBe('?');
    expect(through('a', '?', '!')).toBe('a?!');
    expect(through(pasted('?!'))).toBe(pasted('?!'));
  });

  it('goes on after a key it can’t follow, once another character has gone in', () => {
    expect(through('a', '\x7f', 'b', '!')).toBe('a\x7fb!');
    expect(through('a', '\x1b[D', 'b', '!')).toBe('a\x1b[Db!');
  });

  it.each([
    ['Backspace', '\x7f'],
    ['Backspace, another way', '\b'],
    ['Ctrl-A', '\x01'],
    ['Ctrl-W', '\x17'],
    ['Ctrl-K', '\x0b'],
    ['Tab', '\t'],
    ['Esc', '\x1b'],
    ['Alt-Backspace', '\x1b\x7f'],
    ['Alt-B', '\x1bb'],
    ['Home', '\x1b[H'],
    ['Home, another way', '\x1bOH'],
    ['the left arrow', '\x1b[D'],
    ['the up arrow', '\x1b[A'],
    ['Ctrl and the left arrow', '\x1b[1;5D'],
    ['Delete', '\x1b[3~'],
  ])('can’t follow %s, so a "!" after it is dropped', (_name, key) => {
    expect(through('a', 'b', key, '!')).toBe(`ab${key}`);
  });

  it('drops a "!" that comes straight after Esc, in one piece', () => {
    expect(through('a', '\x1b!')).toBe('a\x1b');
  });

  it('takes the window losing or getting the keyboard as no key at all', () => {
    expect(through('a', '\x1b[O', '\x1b[I', '!')).toBe('a\x1b[O\x1b[I!');
    expect(through('\x1b[I', '!')).toBe('\x1b[I');
  });

  it('passes the terminal’s own replies as they are, with nothing in them taken for typing', () => {
    expect(through('\x1b]10;rgb:ff/ff/ff\x07', '!')).toBe('\x1b]10;rgb:ff/ff/ff\x07');
    expect(through('\x1b[?1;2c', '!')).toBe('\x1b[?1;2c');
    expect(through('\x1bP1$r0m\x1b\\', '!')).toBe('\x1bP1$r0m\x1b\\');
  });

  it('leaves the app’s own prompts and a picture’s path as they are', () => {
    expect(through('/factwright:ask job acme-1 question q-1')).toBe(
      '/factwright:ask job acme-1 question q-1',
    );
    expect(through(pasted('"/tmp/pasted-1.png" '))).toBe(pasted('"/tmp/pasted-1.png" '));
  });
});
