import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPill } from './StatusPill.tsx';

describe('StatusPill', () => {
  it('shows the status in plain words', () => {
    render(
      <>
        <StatusPill status="resume" />
        <StatusPill status="ghosted" />
      </>,
    );
    expect(screen.getByText('Resume ready')).toBeTruthy();
    expect(screen.getByText('No reply')).toBeTruthy();
  });
});
