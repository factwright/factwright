import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.tsx';
import { IconButton } from './IconButton.tsx';

describe('Button', () => {
  it('is a plain button, so it never submits a form by accident', () => {
    render(<Button>Find jobs</Button>);
    expect(screen.getByRole('button', { name: 'Find jobs' }).getAttribute('type')).toBe('button');
  });

  it('runs its action when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Add job</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Add job' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does nothing while disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Run
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('is named by its label, which is also its tooltip', () => {
    render(<IconButton label="Settings" icon={<svg aria-hidden="true" />} />);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button.getAttribute('title')).toBe('Settings');
  });
});
