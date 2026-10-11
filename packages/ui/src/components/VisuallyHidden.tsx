import type { ReactNode } from 'react';
import a11y from '../a11y.module.css';

/** Text that screen readers read but the screen doesn't show, such as a label the design implies. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className={a11y.srOnly}>{children}</span>;
}
