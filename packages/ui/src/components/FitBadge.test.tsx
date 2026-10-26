import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FitBadge } from './FitBadge.tsx';

describe('FitBadge', () => {
  it('shows the score and the tier', () => {
    render(<FitBadge score={78} tier="good" />);
    expect(screen.getByText('78 · Good')).toBeTruthy();
  });

  it('shows the tier alone when there is no score', () => {
    render(<FitBadge tier="worth" />);
    expect(screen.getByText('Worth a look')).toBeTruthy();
  });

  it('says so before Claude analyzes the job', () => {
    render(<FitBadge score={null} tier={null} />);
    expect(screen.getByText('Not checked yet')).toBeTruthy();
  });
});
