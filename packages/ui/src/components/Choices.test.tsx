import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChipGroup } from './ChipGroup.tsx';
import { FileDrop } from './FileDrop.tsx';
import { Field } from './Form.tsx';
import { Steps } from './Steps.tsx';
import { TagInput } from './TagInput.tsx';

const LEVELS = [
  { value: 'mid', label: 'Mid level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead or principal' },
] as const;

/** A tag input that keeps what it's given, like a form would. */
function Titles({ start = [], max }: { start?: string[]; max?: number }) {
  const [value, setValue] = useState<string[]>(start);
  return (
    <Field label="Job titles" hint="Press Enter after each one.">
      {(control) => (
        <TagInput
          {...control}
          value={value}
          onChange={setValue}
          placeholder="Such as Product Designer"
          {...(max && { max })}
        />
      )}
    </Field>
  );
}

describe('ChipGroup', () => {
  it('turns options on and off, keeping their order', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ChipGroup
        label="Levels"
        hint="Pick any."
        options={LEVELS}
        value={['lead']}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('group', { name: 'Levels' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Lead or principal' }).getAttribute('aria-pressed'),
    ).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Mid level' }));
    expect(onChange).toHaveBeenLastCalledWith(['mid', 'lead']);
    rerender(
      <ChipGroup label="Levels" options={LEVELS} value={['mid', 'lead']} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lead or principal' }));
    expect(onChange).toHaveBeenLastCalledWith(['mid']);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});

describe('TagInput', () => {
  it('adds what’s typed on Enter or a comma, and takes it back on Backspace', async () => {
    const { container } = render(<Titles />);
    const box = screen.getByRole('textbox', { name: 'Job titles' });
    await userEvent.type(box, 'Product Designer{Enter}UX Designer,');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Product Designer',
      'UX Designer',
    ]);
    await userEvent.type(box, 'product designer{Enter}');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await userEvent.type(box, '{Backspace}');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Product Designer',
    ]);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('removes one with its button, and keeps what’s typed when the user moves on', async () => {
    render(<Titles start={['Chicago', 'Austin']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Chicago' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Job titles' }), 'Denver');
    await userEvent.tab();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Austin',
      'Denver',
    ]);
  });

  it('splits a pasted list, and stops at its most', async () => {
    render(<Titles max={3} />);
    const box = screen.getByRole('textbox', { name: 'Job titles' });
    await userEvent.click(box);
    await userEvent.paste('Boston, Denver\nAustin, Miami');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Boston',
      'Denver',
      'Austin',
    ]);
    expect((box as HTMLInputElement).disabled).toBe(true);
  });
});

describe('FileDrop', () => {
  it('takes dropped files, or the ones picked in the file picker', async () => {
    const onFiles = vi.fn();
    const { container } = render(
      <FileDrop
        title="Drop your resumes here"
        hint="PDF or Word"
        buttonLabel="Choose files"
        accept=".pdf,.docx"
        onFiles={onFiles}
      />,
    );
    const resume = new File(['%PDF-1.7'], 'resume.pdf', { type: 'application/pdf' });
    fireEvent.drop(screen.getByText('Drop your resumes here').parentElement as HTMLElement, {
      dataTransfer: { files: [resume], types: ['Files'] },
    });
    expect(onFiles).toHaveBeenLastCalledWith([resume]);

    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker.accept).toBe('.pdf,.docx');
    const click = vi.spyOn(picker, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Choose files' }));
    expect(click).toHaveBeenCalled();
    await userEvent.upload(picker, [resume]);
    expect(onFiles).toHaveBeenCalledTimes(2);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('takes nothing while it’s off', () => {
    const onFiles = vi.fn();
    render(<FileDrop title="Drop files" buttonLabel="Choose files" disabled onFiles={onFiles} />);
    fireEvent.drop(screen.getByText('Drop files').parentElement as HTMLElement, {
      dataTransfer: { files: [new File(['x'], 'a.txt')], types: ['Files'] },
    });
    expect(onFiles).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'Choose files' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('Steps', () => {
  it('marks the step showing and the ones done, and opens only steps reached', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Steps
        label="Getting started"
        steps={['Welcome', 'About you', 'Your files', 'Ready']}
        current={1}
        reached={2}
        onSelect={onSelect}
      />,
    );
    const steps = screen.getAllByRole('button');
    expect(steps.map((step) => step.textContent)).toEqual([
      'Welcome (done)',
      '2About you',
      '3Your files',
      '4Ready',
    ]);
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
    expect((steps[3] as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /Welcome/ }));
    expect(onSelect).toHaveBeenCalledWith(0);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
