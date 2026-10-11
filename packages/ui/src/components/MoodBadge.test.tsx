import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MoodBadge } from './MoodBadge.tsx';
import { ScoreBar } from './ScoreBar.tsx';

describe('MoodBadge', () => {
  it('says what people say in plain words', () => {
    render(
      <>
        <MoodBadge mood="liked" />
        <MoodBadge mood="thin" />
      </>,
    );
    expect(screen.getByText('People like it')).toBeTruthy();
    expect(screen.getByText('Little to go on')).toBeTruthy();
  });
});

describe('ScoreBar', () => {
  it('shows the points and fills the bar to match', () => {
    const { container } = render(
      <ScoreBar label="Work" points={33} max={40}>
        Build tooling at scale
      </ScoreBar>,
    );
    expect(screen.getByText('33 of 40')).toBeTruthy();
    expect(screen.getByText('Build tooling at scale')).toBeTruthy();
    const fill = container.querySelector('[aria-hidden="true"] > div') as HTMLElement;
    expect(fill.style.width).toBe('83%');
  });

  it('keeps the bar in bounds', () => {
    const { container } = render(<ScoreBar label="Stack" points={30} max={20} />);
    expect((container.querySelector('[aria-hidden="true"] > div') as HTMLElement).style.width).toBe(
      '100%',
    );
  });
});
