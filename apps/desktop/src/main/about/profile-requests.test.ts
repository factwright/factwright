import { describe, expect, it } from 'vitest';
import { ProfileRequests } from './profile-requests.ts';

const NOW = new Date('2026-11-01T14:30:12.000Z');

describe('ProfileRequests', () => {
  it('holds what the user asked for the run on that part, which claims it once', () => {
    const held = new ProfileRequests(() => NOW);
    held.hold({ part: 'about', changes: 'Use my new email' });
    expect(held.claim('wants', undefined)).toBeNull();
    expect(held.claim('about', undefined)).toEqual({
      part: 'about',
      changes: 'Use my new email',
      at: NOW.toISOString(),
    });
    expect(held.claim('about', undefined)).toBeNull();
  });

  it('keeps each kind of job’s apart', () => {
    const held = new ProfileRequests(() => NOW);
    held.hold({ part: 'kind', kind: 'design', changes: 'Add UX' });
    held.hold({ part: 'kind', kind: 'product', changes: 'Add PM' });
    expect(held.claim('kind', 'product')?.changes).toBe('Add PM');
    expect(held.claim('kind', 'design')?.changes).toBe('Add UX');
  });

  it('finds them again when their run didn’t start, unless the user asked again since', () => {
    const held = new ProfileRequests(() => NOW);
    held.hold({ part: 'about', changes: 'First' });
    const claimed = held.claim('about', undefined);
    if (!claimed) throw new Error('Nothing held.');
    held.release(claimed);
    expect(held.claim('about', undefined)?.changes).toBe('First');
    held.hold({ part: 'about', changes: 'Second' });
    held.release(claimed);
    expect(held.claim('about', undefined)?.changes).toBe('Second');
  });
});
