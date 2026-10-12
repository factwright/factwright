import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MARK, MARK_SMALL } from '../brand.ts';
import { Logo } from './Logo.tsx';

describe('Logo', () => {
  it('draws the heavier cut at small sizes, so the rings stay open', () => {
    const ringStroke = (size: number) =>
      render(<Logo size={size} />)
        .container.querySelector('circle')
        ?.getAttribute('stroke-width');
    expect(ringStroke(24)).toBe(String(MARK_SMALL.ringStroke));
    expect(ringStroke(36)).toBe(String(MARK.ringStroke));
  });

  it('stays out of the way of screen readers, beside the name it marks', () => {
    const { container } = render(<Logo />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
