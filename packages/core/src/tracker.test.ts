import { describe, expect, it } from 'vitest';
import {
  CALL_STAGE,
  effectiveStatus,
  JOB_STATUS_LABELS,
  JOB_STATUSES,
  readStatus,
  STATUS_RANK,
} from './tracker.ts';

describe('tracker', () => {
  it('maps every call kind to a known status that has a rank', () => {
    for (const status of Object.values(CALL_STAGE)) {
      expect(JOB_STATUSES).toContain(status);
      expect(STATUS_RANK[status]).toBeTypeOf('number');
    }
  });

  it('ranks the steps of a hunt in order', () => {
    const steps = ['new', 'review', 'apply', 'applied', 'screen', 'interview', 'offer'] as const;
    expect(steps.map((step) => STATUS_RANK[step])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(STATUS_RANK.later).toBeUndefined();
  });

  it('names each status in the words the views use', () => {
    expect(JOB_STATUSES.map((status) => JOB_STATUS_LABELS[status])).toEqual([
      'New',
      'To review',
      'To apply',
      'Later',
      'Applied',
      'Screen',
      'Interview',
      'Offer',
      'Accepted',
      'Declined',
      'Rejected',
      'No reply',
      'Withdrawn',
      'Passed',
      'Role closed',
    ]);
  });
});

describe('readStatus', () => {
  it('reads every status this version has', () => {
    for (const status of JOB_STATUSES) expect(readStatus(status)).toBe(status);
  });

  it('reads the statuses Claude’s work used to set as To review', () => {
    expect(readStatus('checked')).toBe('review');
    expect(readStatus('resume')).toBe('review');
  });

  it('reads none, or one only a newer version knows, as none', () => {
    expect(readStatus(null)).toBeNull();
    expect(readStatus('')).toBeNull();
    expect(readStatus('shortlisted')).toBeNull();
    expect(readStatus('constructor')).toBeNull();
    expect(readStatus(3)).toBeNull();
  });
});

describe('effectiveStatus', () => {
  it('shows what Claude’s work did until the user sets a status', () => {
    expect(effectiveStatus(null, 'new')).toBe('new');
    expect(effectiveStatus(null, 'review')).toBe('review');
  });

  it('moves a job the user left at New to To review once Claude works on it', () => {
    expect(effectiveStatus('new', 'review')).toBe('review');
  });

  it('keeps the user’s own status otherwise', () => {
    expect(effectiveStatus('review', 'new')).toBe('review');
    expect(effectiveStatus('apply', 'review')).toBe('apply');
    expect(effectiveStatus('later', 'review')).toBe('later');
    expect(effectiveStatus('passed', 'new')).toBe('passed');
    expect(effectiveStatus('applied', 'review')).toBe('applied');
  });
});
