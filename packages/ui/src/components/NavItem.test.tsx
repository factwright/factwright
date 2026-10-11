import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NavItem } from './NavItem.tsx';

describe('NavItem', () => {
  it('marks the page the user is on', () => {
    render(<NavItem icon={null} label="Jobs" count={18} current />);
    expect(screen.getByRole('button', { name: 'Jobs 18' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('leaves other pages unmarked', () => {
    render(<NavItem icon={null} label="Fact bank" />);
    expect(screen.getByRole('button', { name: 'Fact bank' }).hasAttribute('aria-current')).toBe(
      false,
    );
  });
});
