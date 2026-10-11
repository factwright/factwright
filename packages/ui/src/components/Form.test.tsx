import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Chip } from './Chip.tsx';
import { Dialog, DialogActions } from './Dialog.tsx';
import { Checkbox, Field, Input, Select, TextArea } from './Form.tsx';

beforeAll(() => {
  // jsdom doesn't open dialogs on its own.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

describe('Field', () => {
  it('ties its label and hint to the control', () => {
    render(
      <Field label="Next step" hint="With a date, it shows in Needs you.">
        {(control) => <Input {...control} defaultValue="Email Sam" />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Next step' });
    expect((input as HTMLInputElement).value).toBe('Email Sam');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('With a date, it shows in Needs you.').id).toBe(
      input.getAttribute('aria-describedby'),
    );
  });

  it('works with menus and longer text', async () => {
    const onChange = vi.fn();
    render(
      <>
        <Field label="Kind">
          {(control) => (
            <Select
              {...control}
              defaultValue="screen"
              onChange={(event) => onChange(event.target.value)}
            >
              <option value="screen">Recruiter screen</option>
              <option value="technical">Technical interview</option>
            </Select>
          )}
        </Field>
        <Field label="Notes">{(control) => <TextArea {...control} />}</Field>
      </>,
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Kind' }),
      'Technical interview',
    );
    expect(onChange).toHaveBeenCalledWith('technical');
    expect(screen.getByRole('textbox', { name: 'Notes' }).tagName).toBe('TEXTAREA');
  });
});

describe('Checkbox', () => {
  it('has its label beside it', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Show archived jobs" onChange={onChange} />);
    await userEvent.click(screen.getByText('Show archived jobs'));
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Show archived jobs' })).toBeTruthy();
  });
});

describe('Chip', () => {
  it('says whether it’s on, and takes its tone’s tint when it is', () => {
    render(
      <>
        <Chip pressed tone="green">
          Strong
        </Chip>
        <Chip pressed={false}>Skip</Chip>
      </>,
    );
    const on = screen.getByRole('button', { name: 'Strong' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(on.style.background).toBe('var(--fw-tone-green-bg)');
    expect(screen.getByRole('button', { name: 'Skip' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Dialog', () => {
  it('opens with its title and description, and closes with its button', async () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Add a job" description="For a job you found yourself." onClose={onClose}>
        <DialogActions>
          <button type="button">Add job</button>
        </DialogActions>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add a job' });
    expect(dialog.getAttribute('open')).not.toBeNull();
    expect(dialog.getAttribute('aria-describedby')).toBe(
      screen.getByText('For a job you found yourself.').id,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('starts on the field marked to take focus', () => {
    render(
      <Dialog title="Add a job" onClose={() => {}}>
        <input aria-label="Company" data-autofocus />
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Company' }));
  });

  it('gives its contents a way to close it', async () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Add a job" onClose={onClose}>
        {(close) => (
          <button type="button" onClick={close}>
            Cancel
          </button>
        )}
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps Escape to itself', async () => {
    const outside = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: listens for keys that bubble out of the dialog.
      <div onKeyDown={outside}>
        <Dialog title="Your journey" onClose={() => {}}>
          <button type="button">Copy</button>
        </Dialog>
      </div>,
    );
    screen.getByRole('button', { name: 'Copy' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(outside).not.toHaveBeenCalled();
  });
});
