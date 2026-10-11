import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { cx } from '../cx.ts';
import styles from './Dialog.module.css';
import { IconButton } from './IconButton.tsx';

export interface DialogProps {
  title: string;
  /** A line under the title, saying what the dialog is for. */
  description?: string;
  /** Called once the dialog has closed, by its close button, Escape, or a call to close it. */
  onClose: () => void;
  /** "lg" for reading, such as a saved posting. */
  size?: 'md' | 'lg';
  /** What's inside. As a function, it's given a way to close the dialog, such as after saving. */
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * A window over the app for one task, such as adding a job. It's the browser's own modal
 * dialog, so focus stays inside it and returns where it was when it closes. It starts on the
 * element marked data-autofocus, if there is one.
 */
export function Dialog({ title, description, onClose, size = 'md', children }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    // A form's first field can ask for focus with data-autofocus, so typing starts there.
    dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);
  const close = () => dialog.current?.close();
  return (
    <dialog
      ref={dialog}
      className={cx(styles.dialog, styles[size])}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      // Escape closes this dialog only, not anything behind it that also listens for it.
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation();
      }}
    >
      <div className={styles.head}>
        <div className={styles.titles}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          )}
        </div>
        <IconButton
          label="Close"
          variant="quiet"
          icon={<X size={16} aria-hidden="true" />}
          onClick={close}
        />
      </div>
      <div className={styles.body}>
        {typeof children === 'function' ? children(close) : children}
      </div>
    </dialog>
  );
}

/** The buttons along the bottom of a dialog, with the main one last. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
