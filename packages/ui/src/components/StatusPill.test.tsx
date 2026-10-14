import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPill } from './StatusPill.tsx';

describe('StatusPill', () => {
  it('shows the status in plain words', () => {
    render(
      <>
        <StatusPill status="apply" />
        <StatusPill status="ghosted" />
        <StatusPill status="role-closed" />
      </>,
    );
    expect(screen.getByText('To apply')).toBeTruthy();
    expect(screen.getByText('No reply')).toBeTruthy();
    expect(screen.getByText('Role closed')).toBeTruthy();
  });
});
