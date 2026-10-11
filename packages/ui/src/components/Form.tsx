import { ChevronDown } from 'lucide-react';
import { type ComponentPropsWithRef, type ReactNode, useId } from 'react';
import { cx } from '../cx.ts';
import styles from './Form.module.css';

/** What a field gives its control, so the label and the hint belong to it. */
export interface FieldControl {
  id: string;
  'aria-describedby'?: string;
}

export interface FieldProps {
  label: string;
  /** A short line under the control, such as what happens when it's filled in. */
  hint?: ReactNode;
  /** The control, given the id and description that tie it to the label and hint. */
  children: (control: FieldControl) => ReactNode;
  className?: string;
}

/** A form control with its label above it, and an optional hint below. */
export function Field({ label, hint, children, className }: FieldProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children(hint ? { id, 'aria-describedby': hintId } : { id })}
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** A text, date, time or number box. */
export function Input({ className, ...rest }: ComponentPropsWithRef<'input'>) {
  return <input className={cx(styles.control, className)} {...rest} />;
}

/** Longer text, such as notes. It grows taller if the user drags its corner. */
export function TextArea({ className, ...rest }: ComponentPropsWithRef<'textarea'>) {
  return <textarea className={cx(styles.control, styles.textArea, className)} {...rest} />;
}

/** A menu of choices, using the system's own menu. */
export function Select({ className, children, ...rest }: ComponentPropsWithRef<'select'>) {
  return (
    <span className={cx(styles.selectWrap, className)}>
      <select className={cx(styles.control, styles.select)} {...rest}>
        {children}
      </select>
      <ChevronDown className={styles.chevron} size={14} aria-hidden="true" />
    </span>
  );
}

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  label: string;
}

/** A checkbox with its label beside it. */
export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx(styles.checkbox, className)}>
      <input type="checkbox" {...rest} />
      {label}
    </label>
  );
}
