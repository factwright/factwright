import { describe, expect, it, vi } from 'vitest';
import { Desk } from './desk.ts';

interface Item {
  id: string;
  what: string;
}

const item = (id: string): Item => ({ id, what: `Asked ${id}` });
const shownIds = (show: ReturnType<typeof vi.fn>) =>
  show.mock.calls.map(([shown]) => (shown as Item | null)?.id ?? null);

describe('Desk', () => {
  it('shows the oldest thing waiting, and settles each with the user’s answer', async () => {
    const show = vi.fn();
    const desk = new Desk<Item, string>(show);
    const first = desk.ask(item('a'), new AbortController().signal);
    const second = desk.ask(item('b'), new AbortController().signal);
    expect(desk.current()?.id).toBe('a');
    expect(shownIds(show)).toEqual(['a']);
    expect(desk.answer('a', 'yes')).toBe(true);
    await expect(first).resolves.toBe('yes');
    expect(desk.current()?.id).toBe('b');
    expect(desk.answer('b', null)).toBe(true);
    await expect(second).resolves.toBeNull();
    expect(shownIds(show)).toEqual(['a', 'b', null]);
    expect(desk.answer('b', 'yes')).toBe(false);
    expect(desk.find('b')).toBeNull();
  });

  it('lets something go once Claude Code stops waiting for it', async () => {
    const show = vi.fn();
    const desk = new Desk<Item, string>(show);
    const stopped = new AbortController();
    const waiting = desk.ask(item('a'), stopped.signal);
    stopped.abort();
    await expect(waiting).resolves.toBeNull();
    expect(desk.current()).toBeNull();
    expect(show).toHaveBeenLastCalledWith(null);
    expect(desk.answer('a', 'yes')).toBe(false);
    const already = new AbortController();
    already.abort();
    await expect(desk.ask(item('b'), already.signal)).resolves.toBeNull();
    expect(desk.current()).toBeNull();
  });

  it('replaces something asked again, and lets the oldest go past ten', async () => {
    const desk = new Desk<Item, string>(() => {});
    const before = desk.ask(item('a'), new AbortController().signal);
    const again = desk.ask(item('a'), new AbortController().signal);
    await expect(before).resolves.toBeNull();
    const waits = Array.from({ length: 10 }, (_, n) =>
      desk.ask(item(`r${n}`), new AbortController().signal),
    );
    await expect(again).resolves.toBeNull();
    expect(desk.current()?.id).toBe('r0');
    expect(desk.find('r9')).not.toBeNull();
    for (let n = 0; n < 10; n += 1) desk.answer(`r${n}`, null);
    await Promise.all(waits);
  });
});
