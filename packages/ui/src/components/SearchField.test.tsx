import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchField } from './SearchField.tsx';

describe('SearchField', () => {
  it('is a search box named by its label, which is also its placeholder', () => {
    render(<SearchField label="Search jobs" />);
    const input = screen.getByRole('searchbox', { name: 'Search jobs' });
    expect(input.getAttribute('placeholder')).toBe('Search jobs');
  });

  it('shows the shortcut without reading it aloud', () => {
    render(<SearchField label="Search jobs" shortcut="⌘K" />);
    expect(screen.getByText('⌘K').getAttribute('aria-hidden')).toBe('true');
  });
});
