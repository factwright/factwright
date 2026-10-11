import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl.tsx';

const OPTIONS = [
  { value: 'active', label: 'Active', count: 7 },
  { value: 'closed', label: 'Closed', count: 11 },
] as const;

describe('SegmentedControl', () => {
  it('is a named group of radio buttons with the current one checked', () => {
    render(<SegmentedControl label="Views" options={OPTIONS} value="active" onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Views' })).toBeTruthy();
    const active = screen.getByRole('radio', { name: 'Active 7' }) as HTMLInputElement;
    const closed = screen.getByRole('radio', { name: 'Closed 11' }) as HTMLInputElement;
    expect(active.checked).toBe(true);
    expect(closed.checked).toBe(false);
  });

  it('reports the option the user picks', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Views" options={OPTIONS} value="active" onChange={onChange} />);
    await userEvent.click(screen.getByText('Closed'));
    expect(onChange).toHaveBeenCalledWith('closed');
  });

  it('keeps two groups on one page apart', () => {
    render(
      <>
        <SegmentedControl label="Views" options={OPTIONS} value="active" onChange={vi.fn()} />
        <SegmentedControl label="Archive" options={OPTIONS} value="closed" onChange={vi.fn()} />
      </>,
    );
    const names = new Set(screen.getAllByRole('radio').map((radio) => radio.getAttribute('name')));
    expect(names.size).toBe(2);
  });
});
