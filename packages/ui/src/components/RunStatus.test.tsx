import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunStatus } from './RunStatus.tsx';

describe('RunStatus', () => {
  it.each([
    ['working', 'Working'],
    ['needs-answer', 'Needs your answer'],
    ['done', 'Done'],
    ['stopped', 'Stopped'],
    ['failed', 'Didn’t finish'],
  ] as const)('reads "%s" as "%s"', (state, label) => {
    render(<RunStatus state={state} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});
