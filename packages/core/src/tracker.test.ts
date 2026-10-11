import { describe, expect, it } from 'vitest';
import { CALL_STAGE, effectiveStatus, JOB_STATUSES, STATUS_RANK } from './tracker.ts';

describe('tracker', () => {
  it('maps every call kind to a known status that has a rank', () => {
    for (const status of Object.values(CALL_STAGE)) {
      expect(JOB_STATUSES).toContain(status);
      expect(STATUS_RANK[status]).toBeTypeOf('number');
    }
  });

  it('ranks the steps of a hunt in order', () => {
    const steps = ['new', 'checked', 'resume', 'applied', 'screen', 'interview', 'offer'] as const;
    expect(steps.map((step) => STATUS_RANK[step])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('effectiveStatus', () => {
  it('shows the skills’ stage until the user sets a status', () => {
    expect(effectiveStatus(null, 'resume')).toBe('resume');
  });

  it('moves past an early status the user set once the skills get further', () => {
    expect(effectiveStatus('checked', 'resume')).toBe('resume');
    expect(effectiveStatus('new', 'checked')).toBe('checked');
  });

  it('keeps the user’s own status otherwise', () => {
    expect(effectiveStatus('applied', 'resume')).toBe('applied');
    expect(effectiveStatus('passed', 'new')).toBe('passed');
    expect(effectiveStatus('resume', 'checked')).toBe('resume');
  });
});
