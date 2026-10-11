import { describe, expect, it } from 'vitest';
import { readApplySteps } from './apply-steps.ts';

describe('readApplySteps', () => {
  it('reads the alert, the email, the subject and the steps', () => {
    const steps = readApplySteps(
      [
        '# How to apply',
        '- **Alert:** Email the founder, not the form. Mention `Platform`.',
        '- **Email:** `jobs@copperleaf.example`',
        '- **Subject:** "Principal Engineer: platform"',
        '',
        '1. Attach the resume as a PDF.',
        '2. Keep it short.',
      ].join('\n'),
    );
    expect(steps).toEqual({
      alert: 'Email the founder, not the form. Mention `Platform`.',
      email: 'jobs@copperleaf.example',
      subject: 'Principal Engineer: platform',
      steps: '1. Attach the resume as a PDF.\n2. Keep it short.',
    });
  });

  it('drops an email that isn’t a whole address', () => {
    const steps = readApplySteps('- **Email:** the founder at their site');
    expect(steps).toEqual({ alert: null, email: null, subject: null, steps: '' });
  });
});
