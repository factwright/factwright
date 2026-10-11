import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusSelect } from './StatusSelect.tsx';

describe('StatusSelect', () => {
  it('shows the status, and offers every status in plain words', () => {
    render(<StatusSelect status="ghosted" label="Status for Acme" onChange={() => {}} />);
    const menu = screen.getByRole('combobox', { name: 'Status for Acme' }) as HTMLSelectElement;
    expect(menu.selectedOptions[0]?.textContent).toBe('No reply');
    expect(screen.getAllByRole('option')).toHaveLength(13);
  });

  it('reports the status the user picks', async () => {
    const onChange = vi.fn();
    render(<StatusSelect status="resume" label="Status" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Applied');
    expect(onChange).toHaveBeenCalledWith('applied');
  });
});
