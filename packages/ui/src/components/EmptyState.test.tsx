import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState.tsx';

describe('EmptyState', () => {
  it('shows the title, the explanation and the next step', () => {
    render(
      <EmptyState title="No jobs yet" action={<button type="button">Find jobs</button>}>
        Jobs you find show up here.
      </EmptyState>,
    );
    expect(screen.getByText('No jobs yet')).toBeTruthy();
    expect(screen.getByText('Jobs you find show up here.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Find jobs' })).toBeTruthy();
  });
});
