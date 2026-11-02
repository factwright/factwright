import { describe, expect, it } from 'vitest';
import { PROFILE_REQUEST } from '../../shared/profile-parts.ts';
import { ProfileRequests } from './profile-requests.ts';

const NOW = new Date('2026-11-01T14:30:12.000Z');

describe('ProfileRequests', () => {
  it('holds what the user asked by an ID of its own, for a run on that part alone', () => {
    const held = new ProfileRequests(() => NOW);
    const id = held.hold({ part: 'wants', changes: 'Add staff roles' });
    expect(id).toMatch(PROFILE_REQUEST);
    expect(held.find(id, 'wants', undefined)).toEqual({
      part: 'wants',
      changes: 'Add staff roles',
      at: NOW.toISOString(),
    });
    expect(held.find(id, 'beyond', undefined)).toBeNull();
    expect(held.find('0000000000000000', 'wants', undefined)).toBeNull();
  });

  it('finds the same words again, for Try again, and each request its own', () => {
    const held = new ProfileRequests(() => NOW);
    const first = held.hold({ part: 'wants', changes: 'First' });
    const second = held.hold({ part: 'wants', changes: 'Second' });
    expect(held.find(first, 'wants', undefined)?.changes).toBe('First');
    expect(held.find(first, 'wants', undefined)?.changes).toBe('First');
    expect(held.find(second, 'wants', undefined)?.changes).toBe('Second');
  });

  it('keeps each kind of job’s apart', () => {
    const held = new ProfileRequests(() => NOW);
    const design = held.hold({ part: 'kind', kind: 'design', changes: 'Add UX' });
    expect(held.find(design, 'kind', 'design')?.changes).toBe('Add UX');
    expect(held.find(design, 'kind', 'product')).toBeNull();
  });

  it('holds only the newest', () => {
    const held = new ProfileRequests(() => NOW);
    const oldest = held.hold({ part: 'wants', changes: 'Oldest' });
    let newest = oldest;
    for (let n = 0; n < 20; n++) newest = held.hold({ part: 'wants', changes: `Next ${n}` });
    expect(held.find(oldest, 'wants', undefined)).toBeNull();
    expect(held.find(newest, 'wants', undefined)?.changes).toBe('Next 19');
  });
});
