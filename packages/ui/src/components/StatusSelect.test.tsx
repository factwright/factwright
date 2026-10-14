import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusSelect } from './StatusSelect.tsx';

describe('StatusSelect', () => {
  it('shows the status, and offers every status in plain words', () => {
    render(<StatusSelect status="ghosted" label="Status for Acme" onChange={() => {}} />);
    const menu = screen.getByRole('combobox', { name: 'Status for Acme' }) as HTMLSelectElement;
    expect(menu.selectedOptions[0]?.textContent).toBe('No reply');
    expect(screen.getAllByRole('option')).toHaveLength(15);
  });

  it('groups the statuses: before applying, after applying, and closed', () => {
    render(<StatusSelect status="new" label="Status" onChange={() => {}} />);
    const groups = screen.getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('label'))).toEqual([
      'Before applying',
      'After applying',
      'Closed',
    ]);
    const words = (group: HTMLElement) =>
      within(group)
        .getAllByRole('option')
        .map((option) => option.textContent);
    expect(words(groups[0] as HTMLElement)).toEqual(['New', 'To review', 'To apply', 'Later']);
    expect(words(groups[2] as HTMLElement)).toContain('Role closed');
  });

  it('reports the status the user picks', async () => {
    const onChange = vi.fn();
    render(<StatusSelect status="apply" label="Status" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Applied');
    expect(onChange).toHaveBeenCalledWith('applied');
  });
});
