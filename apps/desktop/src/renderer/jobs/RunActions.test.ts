import { describe, expect, it } from 'vitest';
import { requestedRun } from './RunActions.tsx';

describe('a run the app asks for, as for drafts of a form’s questions', () => {
  it('starts once Claude Code is ready, while Claude isn’t busy', () => {
    for (const phase of ['idle', 'ready', 'done', 'stopped', 'failed'] as const) {
      expect(requestedRun(true, phase)).toBe('started');
    }
    for (const phase of ['starting', 'working', 'needs-answer'] as const) {
      expect(requestedRun(true, phase)).toBe('busy');
    }
    expect(requestedRun(false, 'idle')).toBe('not-ready');
  });
});
